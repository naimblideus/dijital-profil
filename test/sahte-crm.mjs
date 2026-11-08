/* Sahte Nexus CRM: /api/toplanti/ara ve /api/toplanti uçları, jetonlu.
   Testler ve yerel deneme gerçek CRM'e dokunmadan bununla çalışır. */

import http from 'node:http';

export const SAHTE_KISILER = [
  { firmaId: 'f1', firma: 'Kobas Büro', kisi: 'Ayşe Yılmaz', telefon: '0532 000 00 01', eposta: 'ayse@ornek.com', yol: '/firma/f1', aranmasin: false },
  { firmaId: 'f2', firma: 'Sentez Ofis', kisi: 'Erkan Kaya', telefon: '0532 282 41 90', eposta: null, yol: '/firma/f2', aranmasin: false },
  { firmaId: 'f3', firma: 'Ak Matbaa', kisi: null, telefon: '0212 555 00 00', eposta: 'bilgi@akmatbaa.com', yol: '/firma/f3', aranmasin: true }
];

export async function sahteCrmBaslat({ jeton = 'sahte-crm-jetonu', port = 0 } = {}) {
  const durum = {
    istekler: [],          // { yol, url, jeton, govde }
    kisiler: SAHTE_KISILER.map((k) => ({ ...k })),
    hata: false,           // her POST /api/toplanti → 500
    yanitla: null,         // (govde) => null | { kod, govde } — planla yanıtını değiştirmek için
    sayac: 0,
    isler: [               // POST /api/deepcore yanıtı
      { kaynak: 'gorev', tur: 'dogrula', id: 'g60', baslik: 'Doğrula: Kurulum provası', proje: 'nexus-servis', oncelik: 1, dk: 10, tarih: null, gecikti: false, yol: '/merkez/benim' },
      { kaynak: 'takip', tur: 'takip', id: 'fk1', baslik: 'Kobas Büro — teklifi sor', proje: 'Nextus Servis', oncelik: 1, dk: 15, tarih: new Date(Date.now() - 86400e3).toISOString(), gecikti: true, yol: '/firma/k1' },
      { kaynak: 'gorev', tur: 'oneri', id: 'g61', baslik: 'Saygılı ile paket limiti konuşmasını yap', proje: 'nexus-servis', oncelik: 1, dk: 30, tarih: null, gecikti: false, yol: '/merkez/benim' },
      { kaynak: 'gorev', tur: 'oneri', id: 'g27', baslik: 'Makine Takip Kapı 0 yayınını yap', proje: 'makine-takip', oncelik: 2, dk: 15, tarih: null, gecikti: false, yol: '/merkez/benim' }
    ]
  };

  const sunucu = http.createServer((istek, cevap) => {
    const parcalar = [];
    istek.on('data', (p) => parcalar.push(p));
    istek.on('end', () => {
      const gonder = (kod, veri) => {
        cevap.writeHead(kod, { 'Content-Type': 'application/json' });
        cevap.end(JSON.stringify(veri));
      };
      let govde = {};
      try { govde = JSON.parse(Buffer.concat(parcalar).toString('utf8') || '{}'); } catch { return gonder(400, { ok: false, hata: 'gecersiz-json' }); }
      const url = new URL(istek.url, 'http://sahte');
      durum.istekler.push({ yol: url.pathname, url: istek.url, jeton: istek.headers['x-nexus-token'], govde });
      if (istek.headers['x-nexus-token'] !== jeton) return gonder(401, { ok: false, hata: 'yetkisiz' });
      if (istek.method !== 'POST') return gonder(405, { ok: false });

      if (url.pathname === '/api/deepcore') {
        if (govde.kisi !== 'Mehmet Naim') return gonder(404, { ok: false, hata: 'kisi-yok' });
        return gonder(200, { ok: true, kisi: govde.kisi, isler: durum.isler });
      }
      if (url.pathname === '/api/toplanti/ara') {
        const q = String(govde.q || '').toLocaleLowerCase('tr-TR');
        const rakam = q.replace(/\D/g, '');
        const sonuclar = durum.kisiler.filter((k) =>
          (rakam.length >= 3 && String(k.telefon || '').replace(/\D/g, '').includes(rakam)) ||
          `${k.kisi || ''} ${k.firma}`.toLocaleLowerCase('tr-TR').includes(q)).slice(0, 10);
        return gonder(200, { ok: true, sonuclar });
      }
      if (url.pathname === '/api/toplanti') {
        if (durum.hata) return gonder(500, { ok: false, hata: 'ic' });
        const ozel = durum.yanitla && durum.yanitla(govde);
        if (ozel) return gonder(ozel.kod, ozel.govde);
        const tel = String(govde.telefon || '').replace(/\D/g, '').slice(-10);
        const bilinen = tel ? durum.kisiler.find((k) => String(k.telefon || '').replace(/\D/g, '').slice(-10) === tel) : null;
        const firmaId = govde.firmaId || (bilinen ? bilinen.firmaId : 'fyeni' + (++durum.sayac));
        return gonder(200, { ok: true, firmaId, firsatId: null, aktiviteId: 'a' + durum.istekler.length, yol: '/firma/' + firmaId, ...(bilinen || govde.firmaId ? {} : { yeniFirma: true }) });
      }
      gonder(404, { ok: false, hata: 'yok' });
    });
  });

  await new Promise((coz) => sunucu.listen(port, '127.0.0.1', coz));
  return {
    durum,
    jeton,
    kok: `http://127.0.0.1:${sunucu.address().port}`,
    kapat: () => new Promise((coz) => sunucu.close(coz))
  };
}
