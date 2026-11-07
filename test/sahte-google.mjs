/* Sahte Google: jeton, freeBusy, etkinlik yazma/listeleme/güncelleme/silme ve Gmail gönderme uçları.
   Testler ve yerel deneme gerçek hesaba dokunmadan bununla çalışır. */

import http from 'node:http';

export async function sahteGoogleBaslat(port = 0) {
  const durum = {
    mesgul: [],        // [{ start, end }] ISO — takvimdeki dolu aralıklar
    jetonCagri: 0,
    etkinlikler: [],   // { takvim, sendUpdates, govde }
    epostalar: [],     // çözülmüş ham ileti
    takvimHata: false,
    gmailHata: false,
    meetYok: false,    // Google Meet linkini hemen vermezse
    kayitlar: new Map(), // id → etkinlik kaynağı (liste/oku/güncelle/sil bunu görür)
    islemler: [],      // { yontem: 'PATCH'|'DELETE', id, sendUpdates, govde }
    sayac: 0           // etkinlik kimliği sayacı (sıfırlamalarda da tekrar etmez)
  };

  const sunucu = http.createServer((istek, cevap) => {
    const parcalar = [];
    istek.on('data', (p) => parcalar.push(p));
    istek.on('end', () => {
      const govde = Buffer.concat(parcalar).toString('utf8');
      const url = new URL(istek.url, 'http://sahte');
      const gonder = (kod, veri) => {
        cevap.writeHead(kod, { 'Content-Type': 'application/json' });
        cevap.end(JSON.stringify(veri));
      };

      if (url.pathname === '/token') {
        const p = new URLSearchParams(govde);
        if (p.get('grant_type') !== 'refresh_token' || p.get('refresh_token') !== 'sahte-yenileme') {
          return gonder(400, { error: 'invalid_grant' });
        }
        durum.jetonCagri++;
        return gonder(200, { access_token: 'sahte-erisim', expires_in: 3600, token_type: 'Bearer' });
      }
      if (istek.headers.authorization !== 'Bearer sahte-erisim') return gonder(401, { error: 'yetkisiz' });

      if (url.pathname === '/calendar/v3/freeBusy') {
        if (durum.takvimHata) return gonder(500, { error: 'ic hata: gizli ayrinti' });
        const g = JSON.parse(govde);
        const bas = new Date(g.timeMin), bit = new Date(g.timeMax);
        const calendars = {};
        for (const i of g.items) {
          calendars[i.id] = { busy: durum.mesgul.filter((m) => new Date(m.end) > bas && new Date(m.start) < bit) };
        }
        return gonder(200, { calendars });
      }

      const e = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
      if (e && istek.method === 'POST') {
        const etkinlik = JSON.parse(govde);
        const surum = url.searchParams.get('conferenceDataVersion');
        durum.etkinlikler.push({ takvim: decodeURIComponent(e[1]), sendUpdates: url.searchParams.get('sendUpdates'), surum, govde: etkinlik });
        const id = 'etk' + (++durum.sayac);
        durum.mesgul.push({ start: etkinlik.start.dateTime, end: etkinlik.end.dateTime, etkinlikId: id });
        const cevapGovde = { id, htmlLink: 'https://calendar.google.com/event?eid=sahte' };
        if (surum === '1' && etkinlik.conferenceData && etkinlik.conferenceData.createRequest && !durum.meetYok) {
          cevapGovde.hangoutLink = 'https://meet.google.com/abc-defg-hij';
        }
        const kaynak = { ...etkinlik, ...cevapGovde, status: 'confirmed', organizer: { self: true } };
        delete kaynak.conferenceData;
        durum.kayitlar.set(id, kaynak);
        return gonder(200, kaynak);
      }
      if (e && istek.method === 'GET') {
        if (durum.takvimHata) return gonder(500, { error: 'ic hata: gizli ayrinti' });
        const bas = new Date(url.searchParams.get('timeMin')), bit = new Date(url.searchParams.get('timeMax'));
        const items = [...durum.kayitlar.values()]
          .filter((k) => !k.start.dateTime || (new Date(k.end.dateTime) > bas && new Date(k.start.dateTime) < bit))
          .sort((a, b) => String(a.start.dateTime || a.start.date).localeCompare(String(b.start.dateTime || b.start.date)));
        return gonder(200, { kind: 'calendar#events', items });
      }

      const tek = /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(url.pathname);
      if (tek) {
        const id = decodeURIComponent(tek[2]);
        const k = durum.kayitlar.get(id);
        if (!k) return gonder(404, { error: 'notFound' });
        if (istek.method === 'GET') return gonder(200, k);
        if (istek.method === 'PATCH') {
          const yama = JSON.parse(govde);
          durum.islemler.push({ yontem: 'PATCH', id, sendUpdates: url.searchParams.get('sendUpdates'), govde: yama });
          // Gerçek API gibi: alt nesneler birleşir, verilen alan değişir.
          for (const [a, d] of Object.entries(yama)) {
            k[a] = d && typeof d === 'object' && !Array.isArray(d) && k[a] && typeof k[a] === 'object' ? { ...k[a], ...d } : d;
          }
          const m = durum.mesgul.find((x) => x.etkinlikId === id);
          if (m) { m.start = k.start.dateTime; m.end = k.end.dateTime; }
          return gonder(200, k);
        }
        if (istek.method === 'DELETE') {
          durum.islemler.push({ yontem: 'DELETE', id, sendUpdates: url.searchParams.get('sendUpdates') });
          durum.kayitlar.delete(id);
          durum.mesgul = durum.mesgul.filter((x) => x.etkinlikId !== id);
          cevap.writeHead(204);
          return cevap.end();
        }
      }

      if (url.pathname === '/gmail/v1/users/me/messages/send') {
        if (durum.gmailHata) return gonder(403, { error: 'insufficientPermissions' });
        durum.epostalar.push(Buffer.from(JSON.parse(govde).raw, 'base64url').toString('utf8'));
        return gonder(200, { id: 'm' + durum.epostalar.length });
      }

      gonder(404, { error: 'yok' });
    });
  });

  await new Promise((coz) => sunucu.listen(port, '127.0.0.1', coz));
  return {
    durum,
    kok: `http://127.0.0.1:${sunucu.address().port}`,
    kapat: () => new Promise((coz) => sunucu.close(coz))
  };
}
