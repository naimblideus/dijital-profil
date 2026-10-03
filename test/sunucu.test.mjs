/* Çalıştır:  node --test   (gerçek Google'a dokunmaz; sahte-google.mjs) */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sahteGoogleBaslat } from './sahte-google.mjs';
import { sunucuOlustur, hizSiniriniSifirla } from '../sunucu/sunucu.mjs';
import { jetonBelleginiSil, istanbulParcalari } from '../sunucu/takvim.mjs';

const PROJE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(PROJE, 'site');
const YENI_ADRES = 'https://naim.nextusservis.com/';

let sunucu, adres, google;

const GOOGLE_ORTAM = {
  GOOGLE_CLIENT_ID: 'sahte-id',
  GOOGLE_CLIENT_SECRET: 'sahte-gizli',
  GOOGLE_REFRESH_TOKEN: 'sahte-yenileme',
  BILDIRIM_EPOSTA: 'sahip@ornek.com'
};

function googleBagla() {
  Object.assign(process.env, GOOGLE_ORTAM, {
    GOOGLE_TOKEN_URL: google.kok + '/token',
    GOOGLE_API_KOK: google.kok,
    GOOGLE_GMAIL_KOK: google.kok
  });
  Object.assign(google.durum, { mesgul: [], etkinlikler: [], epostalar: [], jetonCagri: 0, takvimHata: false, gmailHata: false });
  jetonBelleginiSil();
}

function googleKopar() {
  for (const k of Object.keys(GOOGLE_ORTAM)) delete process.env[k];
  jetonBelleginiSil();
}

/** fetch yolu düzeltir; ham istek '..' gibi yolları olduğu gibi gönderir. */
function ham(yol, { yontem = 'GET', basliklar = {}, govde } = {}) {
  return new Promise((coz, reddet) => {
    const u = new URL(adres);
    const i = http.request({ host: u.hostname, port: u.port, path: yol, method: yontem, headers: basliklar }, (c) => {
      const p = [];
      c.on('data', (x) => p.push(x));
      c.on('end', () => coz({ durum: c.statusCode, basliklar: c.headers, govde: Buffer.concat(p) }));
    });
    i.on('error', reddet);
    i.end(govde);
  });
}

let ipSayac = 0;
async function randevuGonder(govde, ip) {
  const c = await ham('/api/randevu', {
    yontem: 'POST',
    basliklar: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || `10.0.0.${++ipSayac}` },
    govde: typeof govde === 'string' ? govde : JSON.stringify(govde)
  });
  return { durum: c.durum, v: JSON.parse(c.govde.toString('utf8') || '{}') };
}

async function musait() {
  const c = await ham('/api/musait');
  return { durum: c.durum, v: JSON.parse(c.govde.toString('utf8')) };
}

const GECERLI = { ad: 'Ayşe Yılmaz', firma: 'Örnek Fotokopi', telefon: '0532 000 00 00', eposta: 'ayse@ornek.com', cozum: 'Nextus Servis' };

before(async () => {
  google = await sahteGoogleBaslat();
  sunucu = sunucuOlustur();
  await new Promise((c) => sunucu.listen(0, '127.0.0.1', c));
  adres = `http://127.0.0.1:${sunucu.address().port}`;
});

after(async () => {
  await new Promise((c) => sunucu.close(c));
  await google.kapat();
});

/* ---------- statik site ---------- */

test('ana sayfa: html, aramaya kapalı, her açılışta yeniden doğrulanır', async () => {
  const c = await ham('/');
  assert.equal(c.durum, 200);
  assert.match(c.basliklar['content-type'], /text\/html/);
  assert.match(c.govde.toString('utf8'), /<title>Mehmet Naim Çetin/);
  assert.equal(c.basliklar['x-robots-tag'], 'noindex, nofollow');
  assert.equal(c.basliklar['x-content-type-options'], 'nosniff');
  assert.match(c.basliklar['cache-control'], /must-revalidate/);
  assert.ok(c.basliklar.etag);
});

test('değişmeyen dosyaya 304, HEAD gövdesiz', async () => {
  const ilk = await ham('/stil.css');
  assert.match(ilk.basliklar['content-type'], /text\/css/);
  const ikinci = await ham('/stil.css', { basliklar: { 'If-None-Match': ilk.basliklar.etag } });
  assert.equal(ikinci.durum, 304);
  assert.equal(ikinci.govde.length, 0);
  const bas = await ham('/kart.js', { yontem: 'HEAD' });
  assert.equal(bas.durum, 200);
  assert.equal(bas.govde.length, 0);
  assert.equal(Number(bas.basliklar['content-length']), fs.statSync(path.join(SITE, 'kart.js')).size);
});

test('varlik/ bir yıl önbellekte, vCard indirme olarak iner', async () => {
  const v = await ham('/varlik/og.jpg');
  assert.equal(v.durum, 200);
  assert.equal(v.basliklar['content-type'], 'image/jpeg');
  assert.match(v.basliklar['cache-control'], /max-age=31536000, immutable/);
  const k = await ham('/mehmet-naim-cetin.vcf');
  assert.match(k.basliklar['content-type'], /text\/vcard/);
  assert.equal(k.basliklar['content-disposition'], 'attachment; filename="mehmet-naim-cetin.vcf"');
});

test('video parça isteği 206 (iPhone bununla oynatır), aralık dışı 416', async () => {
  const boy = fs.statSync(path.join(SITE, 'varlik/video/ident-720.mp4')).size;
  const p = await ham('/varlik/video/ident-720.mp4', { basliklar: { Range: 'bytes=0-1' } });
  assert.equal(p.durum, 206);
  assert.equal(p.basliklar['content-range'], `bytes 0-1/${boy}`);
  assert.equal(p.govde.length, 2);
  const son = await ham('/varlik/video/ident-720.mp4', { basliklar: { Range: 'bytes=-10' } });
  assert.equal(son.durum, 206);
  assert.equal(son.govde.length, 10);
  const disari = await ham('/varlik/video/ident-720.mp4', { basliklar: { Range: `bytes=${boy}-` } });
  assert.equal(disari.durum, 416);
  assert.equal(disari.basliklar['content-range'], `bytes */${boy}`);
});

test('★ site klasörünün dışına çıkılamaz', async () => {
  const yollar = [
    '/../sunucu/sunucu.mjs',
    '/%2e%2e/sunucu/sunucu.mjs',
    '/..%2fsunucu%2fsunucu.mjs',
    '/..%5csunucu%5csunucu.mjs',
    '/varlik/../../sunucu/sunucu.mjs',
    '/varlik/%2e%2e/%2e%2e/sunucu/sunucu.mjs',
    '/%00',
    '/kart.js%00.png',
    '/.gizli'
  ];
  for (const y of yollar) {
    const c = await ham(y);
    assert.notEqual(c.durum, 200, y);
    assert.ok(!c.govde.toString('utf8').includes('sunucuOlustur'), y);
  }
});

test('bilinmeyen sayfa 404, statik sayfaya POST 405, sağlık ucu', async () => {
  assert.equal((await ham('/yok-boyle-sayfa')).durum, 404);
  assert.equal((await ham('/', { yontem: 'POST', govde: 'x' })).durum, 405);
  const s = await ham('/saglik');
  assert.equal(s.durum, 200);
  assert.equal(s.govde.toString(), 'ok');
});

/* ---------- Google bağlı değilken ---------- */

test('kimlik yokken: müsait 503 (ön yüz WhatsApp kipine düşer), randevu 503', async () => {
  googleKopar();
  const m = await musait();
  assert.equal(m.durum, 503);
  assert.deepEqual(m.v, { hazir: false, sebep: 'kimlik-yok' });
  assert.equal((await randevuGonder(GECERLI)).durum, 503);
  assert.equal((await ham('/api/randevu')).durum, 405);
  assert.equal((await ham('/api/yok')).durum, 404);
});

/* ---------- sahte Google ile ---------- */

test('müsait saatler: hafta içi, mesai içinde, öğle arası ve dolu saat hariç', async () => {
  googleBagla();
  const ilk = await musait();
  assert.equal(ilk.durum, 200);
  assert.equal(ilk.v.hazir, true);
  assert.ok(ilk.v.gunler.length > 0);
  const enErken = Date.now() + 4 * 3600e3 - 60e3;
  for (const g of ilk.v.gunler) {
    for (const s of g.slotlar) {
      const p = istanbulParcalari(new Date(s.bas));
      const dk = p.saat * 60 + p.dakika;
      assert.ok(p.haftaGunu >= 1 && p.haftaGunu <= 5, 'hafta sonu: ' + s.bas);
      assert.ok(dk >= 9 * 60 && dk + 30 <= 18 * 60, 'mesai dışı: ' + s.bas);
      assert.ok(dk + 30 <= 12 * 60 + 30 || dk >= 13 * 60 + 30, 'öğle arası: ' + s.bas);
      assert.ok(new Date(s.bas).getTime() >= enErken, '4 saatten yakın: ' + s.bas);
    }
  }
  const secilen = ilk.v.gunler[0].slotlar[0].bas;
  google.durum.mesgul = [{ start: secilen, end: new Date(new Date(secilen).getTime() + 30 * 60e3).toISOString() }];
  const ikinci = await musait();
  const hepsi = ikinci.v.gunler.flatMap((g) => g.slotlar.map((s) => s.bas));
  assert.ok(!hepsi.includes(secilen), 'dolu saat hâlâ listede');
  assert.equal(google.durum.jetonCagri, 1, 'erişim jetonu bellekte tutulmalı');
});

test('★ randevu: doğru saatte etkinlik, davet, sahibine e-posta', async () => {
  googleBagla();
  const slot = (await musait()).v.gunler[0].slotlar[0].bas;
  const c = await randevuGonder({ ...GECERLI, baslangic: slot });
  assert.equal(c.durum, 200);
  assert.deepEqual(c.v, { tamam: true, baslangic: slot, davet: true });

  const [e] = google.durum.etkinlikler;
  assert.equal(google.durum.etkinlikler.length, 1);
  assert.equal(e.takvim, 'primary');
  assert.equal(e.sendUpdates, 'all');
  assert.equal(e.govde.start.dateTime, slot);
  assert.equal(new Date(e.govde.end.dateTime) - new Date(slot), 30 * 60e3);
  assert.equal(e.govde.summary, 'Görüşme — Örnek Fotokopi');
  assert.match(e.govde.description, /Telefon: 0532 000 00 00/);
  assert.deepEqual(e.govde.attendees, [{ email: 'ayse@ornek.com', displayName: 'Ayşe Yılmaz' }]);

  assert.equal(google.durum.epostalar.length, 1);
  const ileti = google.durum.epostalar[0];
  assert.match(ileti, /^To: sahip@ornek\.com\r\n/);
  const konu = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(ileti)[1];
  assert.match(Buffer.from(konu, 'base64').toString('utf8'), /^Randevu talebi: Örnek Fotokopi — /);
  const metin = Buffer.from(ileti.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(metin, /Ayşe Yılmaz \(Örnek Fotokopi\) görüşme istedi/);
  assert.match(metin, /Takvimde aç: https:\/\/calendar\.google\.com/);
});

test('aynı saati ikinci kişi seçerse 409, ikinci etkinlik açılmaz', async () => {
  googleBagla();
  const slot = (await musait()).v.gunler[0].slotlar[0].bas;
  assert.equal((await randevuGonder({ ...GECERLI, baslangic: slot })).durum, 200);
  const ikinci = await randevuGonder({ ...GECERLI, ad: 'Başka Biri', baslangic: slot });
  assert.equal(ikinci.durum, 409);
  assert.equal(ikinci.v.sebep, 'slot-dolu');
  assert.equal(google.durum.etkinlikler.length, 1);
});

test('doğrulama: eksik alan, bozuk e-posta, geçmiş saat, bozuk gövde, büyük gövde', async () => {
  googleBagla();
  const slot = (await musait()).v.gunler[0].slotlar[0].bas;
  assert.equal((await randevuGonder({ ...GECERLI, telefon: '', baslangic: slot })).v.sebep, 'eksik-alan');
  assert.equal((await randevuGonder({ ...GECERLI, eposta: 'bozuk@', baslangic: slot })).v.sebep, 'eposta-gecersiz');
  assert.equal((await randevuGonder({ ...GECERLI, baslangic: '2020-01-01T08:00:00.000Z' })).v.sebep, 'gecmis-saat');
  assert.equal((await randevuGonder({ ...GECERLI, baslangic: 'yarın' })).v.sebep, 'saat-gecersiz');
  assert.equal((await randevuGonder('{bozuk')).durum, 400);
  assert.equal((await randevuGonder('null')).durum, 400);
  assert.equal((await randevuGonder({ ...GECERLI, not: 'x'.repeat(20000), baslangic: slot })).durum, 413);
  assert.equal(google.durum.etkinlikler.length, 0);
});

test('bal küpü dolu: başarı görünür ama takvime ve e-postaya hiçbir şey yazılmaz', async () => {
  googleBagla();
  const slot = (await musait()).v.gunler[0].slotlar[0].bas;
  const c = await randevuGonder({ ...GECERLI, baslangic: slot, sirketAdi: 'bot doldurdu' });
  assert.equal(c.durum, 200);
  assert.equal(c.v.tamam, true);
  assert.equal(google.durum.etkinlikler.length, 0);
  assert.equal(google.durum.epostalar.length, 0);
});

test('e-posta izni yoksa randevu yine açılır', async () => {
  googleBagla();
  google.durum.gmailHata = true;
  const slot = (await musait()).v.gunler[0].slotlar[0].bas;
  const c = await randevuGonder({ ...GECERLI, eposta: '', baslangic: slot });
  assert.equal(c.durum, 200);
  assert.equal(c.v.davet, false);
  assert.equal(google.durum.etkinlikler.length, 1);
  assert.equal(google.durum.etkinlikler[0].sendUpdates, 'none');
  assert.equal(google.durum.etkinlikler[0].govde.attendees, undefined);
});

test('takvim hatası: 502 ve Google ayrıntısı dışarı sızmaz', async () => {
  googleBagla();
  google.durum.takvimHata = true;
  const m = await musait();
  assert.equal(m.durum, 502);
  assert.deepEqual(m.v, { hazir: false, sebep: 'takvim-hatasi' });
  const r = await randevuGonder({ ...GECERLI, baslangic: new Date(Date.now() + 86400e3).toISOString() });
  assert.equal(r.durum, 502);
  assert.ok(!JSON.stringify(r.v).includes('gizli'));
});

test('hız sınırı: aynı adresten 6. talep 429, başka adres etkilenmez', async () => {
  googleKopar();
  hizSiniriniSifirla();
  for (let i = 0; i < 5; i++) assert.equal((await randevuGonder(GECERLI, '203.0.113.7')).durum, 503);
  assert.equal((await randevuGonder(GECERLI, '203.0.113.7')).durum, 429);
  assert.equal((await randevuGonder(GECERLI, '203.0.113.8')).durum, 503);
  hizSiniriniSifirla();
});

/* ---------- ön yüz Netlify'dan ayrıldı ---------- */

test('ön yüz Netlify\'a bağlı değil, adresler yeni', () => {
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(SITE, 'kart.js'), 'utf8');
  const vcf = fs.readFileSync(path.join(SITE, 'mehmet-naim-cetin.vcf'), 'utf8');
  assert.ok(!/netlify/i.test(html + js + vcf));
  assert.ok(!js.includes("fetch('/',"), 'yedek kip hâlâ Netlify Forms\'a gönderiyor');
  assert.ok(html.includes(`<meta property="og:url" content="${YENI_ADRES}">`));
  assert.ok(vcf.includes(`URL:${YENI_ADRES}`));
  assert.ok(js.includes("sirketAdi: D.getElementById('r-sirket').value"), 'bal küpü takvim kipinde gönderilmiyor');
  assert.ok(!fs.existsSync(path.join(SITE, '_headers')), 'Netlify _headers dosyası yayında kalmamalı');
});
