/* Sahte Google: jeton, freeBusy, etkinlik yazma ve Gmail gönderme uçları.
   Testler ve yerel deneme gerçek hesaba dokunmadan bununla çalışır. */

import http from 'node:http';

export async function sahteGoogleBaslat(port = 0) {
  const durum = {
    mesgul: [],        // [{ start, end }] ISO — takvimdeki dolu aralıklar
    jetonCagri: 0,
    etkinlikler: [],   // { takvim, sendUpdates, govde }
    epostalar: [],     // çözülmüş ham ileti
    takvimHata: false,
    gmailHata: false
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
        durum.etkinlikler.push({ takvim: decodeURIComponent(e[1]), sendUpdates: url.searchParams.get('sendUpdates'), govde: etkinlik });
        durum.mesgul.push({ start: etkinlik.start.dateTime, end: etkinlik.end.dateTime });
        return gonder(200, { id: 'etk' + durum.etkinlikler.length, htmlLink: 'https://calendar.google.com/event?eid=sahte' });
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
