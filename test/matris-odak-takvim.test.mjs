/* Önem/aciliyet sınıfı + odak durumu (Instagram kestirmesi) + plan → Google Takvim aynası.
   node --test test/matris-odak-takvim.test.mjs — gerçek sunucu, sahte Google, geçici veri klasörü. */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sunucuOlustur } from '../sunucu/sunucu.mjs';
import { planBelleginiSifirla, planAynasiniCalistir, istanbulBugun } from '../sunucu/plan.mjs';
import { farkHesapla, imza, etkinlikGovdesi } from '../sunucu/plan-takvim.mjs';
import { jetonBelleginiSil } from '../sunucu/takvim.mjs';
import { sahteGoogleBaslat } from './sahte-google.mjs';

const SIFRE = 'deneme-sifre-123';
const PLAN_ANAHTAR = 'makine-anahtari-0123456789abcdef';
const KAFA = 'kafa-anahtari-0123456789abcdefgh';

let sunucu, adres, klasor, google;

before(async () => {
  klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'matris-test-'));
  google = await sahteGoogleBaslat();
  sunucu = sunucuOlustur();
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  adres = `http://127.0.0.1:${sunucu.address().port}`;
});

after(async () => {
  await new Promise((r) => sunucu.close(r));
  await google.kapat();
  fs.rmSync(klasor, { recursive: true, force: true });
});

beforeEach(() => {
  Object.assign(process.env, {
    PLAN_SIFRE: SIFRE, PLAN_ANAHTAR: PLAN_ANAHTAR, PLAN_VERI: klasor, KAFA_ANAHTAR: KAFA,
    GOOGLE_CLIENT_ID: 'sahte-id', GOOGLE_CLIENT_SECRET: 'sahte-gizli', GOOGLE_REFRESH_TOKEN: 'sahte-yenileme',
    GOOGLE_TOKEN_URL: google.kok + '/token', GOOGLE_API_KOK: google.kok
  });
  delete process.env.PLAN_TAKVIM;
  delete process.env.TAKVIM_IDLER;
  for (const f of fs.readdirSync(klasor)) fs.rmSync(path.join(klasor, f), { recursive: true, force: true });
  planBelleginiSifirla();
  jetonBelleginiSil();
  google.durum.kayitlar.clear();
  google.durum.etkinlikler.length = 0;
  google.durum.islemler.length = 0;
  google.durum.mesgul.length = 0;
});

let ipSayac = 0;
function istek(yol, { yontem = 'GET', anahtar = PLAN_ANAHTAR, govde } = {}) {
  return new Promise((coz, reddet) => {
    const u = new URL(adres);
    const basliklar = { 'X-Forwarded-For': `10.3.0.${(++ipSayac % 250) + 1}` };
    if (anahtar) basliklar.Authorization = 'Bearer ' + anahtar;
    if (govde !== undefined) basliklar['Content-Type'] = 'application/json';
    const i = http.request({ host: u.hostname, port: u.port, path: yol, method: yontem, headers: basliklar }, (c) => {
      const p = [];
      c.on('data', (x) => p.push(x));
      c.on('end', () => {
        const metin = Buffer.concat(p).toString('utf8');
        let v = null;
        try { v = JSON.parse(metin); } catch { /* düz metin */ }
        coz({ durum: c.statusCode, v, metin, tur: c.headers['content-type'] });
      });
    });
    i.on('error', reddet);
    i.end(govde === undefined ? undefined : JSON.stringify(govde));
  });
}
const islem = (v) => istek('/api/plan/islem', { yontem: 'POST', govde: v });
const plan = () => istek('/api/plan');
async function ekle(gun, metin) {
  const r = await islem({ islem: 'ekle', gun, metin });
  assert.equal(r.durum, 200);
  return r.v.gorev;
}

/* ======================= önem / aciliyet ======================= */

test('kadran: 1–4 ve null kabul, başka değer 400', async () => {
  const g = await ekle(istanbulBugun(), 'Teklif yaz');
  for (const k of [1, 2, 3, 4, null]) {
    const r = await islem({ islem: 'duzenle', id: g.id, kadran: k });
    assert.equal(r.durum, 200);
    assert.equal(r.v.gorev.kadran, k);
  }
  assert.equal((await islem({ islem: 'duzenle', id: g.id, kadran: 5 })).durum, 400);
  assert.equal((await islem({ islem: 'duzenle', id: g.id, kadran: '1' })).durum, 400);
  await islem({ islem: 'duzenle', id: g.id, kadran: 3 });
  planBelleginiSifirla();                                  // diskten yeniden okununca da kalır
  assert.equal((await plan()).v.gorevler.find((x) => x.id === g.id).kadran, 3);
});

/* ======================= odak ======================= */

test('odak: başlayınca kestirme "evet", bitince "hayir" görür', async () => {
  const sor = () => istek('/api/plan/odak', { anahtar: KAFA });
  let r = await sor();
  assert.equal(r.durum, 200);
  assert.equal(r.metin, 'hayir');
  assert.match(r.tur, /^text\/plain/);

  const bitis = new Date(Date.now() + 50 * 60e3).toISOString();
  assert.equal((await islem({ islem: 'odak', bitis, baslik: 'Teklif' })).durum, 200);
  assert.equal((await sor()).metin, 'evet');
  const p = await plan();
  assert.equal(p.v.odak.baslik, 'Teklif');

  assert.equal((await islem({ islem: 'odak', bitis: null })).durum, 200);
  assert.equal((await sor()).metin, 'hayir');
  assert.equal((await plan()).v.odak, null);
});

test('odak: süresi geçen odak düşer, en uzun 5 saat', async () => {
  await islem({ islem: 'odak', bitis: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await istek('/api/plan/odak', { anahtar: KAFA })).metin, 'hayir');
  const r = await islem({ islem: 'odak', bitis: new Date(Date.now() + 48 * 3600e3).toISOString() });
  assert.ok(Date.parse(r.v.odak.bitis) <= Date.now() + 5 * 3600e3 + 1000);
  assert.equal((await islem({ islem: 'odak', bitis: 'dun' })).durum, 400);
});

test('odak: anahtarsız 401, kestirme anahtarı odağı değiştiremez', async () => {
  assert.equal((await istek('/api/plan/odak', { anahtar: null })).durum, 401);
  assert.equal((await istek('/api/plan/odak', { anahtar: 'yanlis-0123456789abcdefghijk' })).durum, 401);
  const r = await istek('/api/plan/islem', { yontem: 'POST', anahtar: KAFA, govde: { islem: 'odak', bitis: null } });
  assert.equal(r.durum, 401);
  assert.equal((await istek('/api/plan/odak', { yontem: 'POST', anahtar: KAFA, govde: {} })).durum, 405);
});

/* ======================= takvim aynası ======================= */

test('ayna: saatli iş takvime "boş" etkinlik olarak yazılır, saatsiz yazılmaz', async () => {
  const gun = istanbulBugun();
  const g = await ekle(gun, '14:00-15:30 Teklif yaz');
  await ekle(gun, 'Saatsiz iş');
  const s = await planAynasiniCalistir();
  assert.deepEqual(s, { eklendi: 1, guncellendi: 0, silindi: 0, hata: 0 });
  assert.equal(google.durum.etkinlikler.length, 1);
  const e = google.durum.etkinlikler[0];
  assert.equal(e.sendUpdates, 'none');
  assert.equal(e.govde.summary, 'Teklif yaz');
  assert.equal(e.govde.transparency, 'transparent');
  assert.equal(e.govde.extendedProperties.private.deepcore, g.id);
  assert.equal(e.govde.start.dateTime, new Date(`${gun}T14:00:00+03:00`).toISOString());
  assert.equal(e.govde.end.dateTime, new Date(`${gun}T15:30:00+03:00`).toISOString());
  assert.equal(google.durum.mesgul.length, 0, 'boş etkinlik randevu saatlerini kapatmaz');
  // ikinci tur değişiklik yoksa hiçbir şey yapmaz
  assert.deepEqual(await planAynasiniCalistir(), { eklendi: 0, guncellendi: 0, silindi: 0, hata: 0 });
});

test('ayna: saat değişince taşınır, bitince ✓, saat kalkınca ve silinince etkinlik silinir', async () => {
  const gun = istanbulBugun();
  const g = await ekle(gun, '10:00-11:00 Derin iş');
  const h = await ekle(gun, '16:00-17:00 Arama');
  await planAynasiniCalistir();
  const [e1, e2] = [...google.durum.kayitlar.keys()];

  await islem({ islem: 'duzenle', id: g.id, bas: '12:00', bit: '13:00' });
  await islem({ islem: 'isaretle', id: h.id, bitti: true });
  let s = await planAynasiniCalistir();
  assert.equal(s.guncellendi, 2);
  assert.equal(google.durum.kayitlar.get(e1).start.dateTime, new Date(`${gun}T12:00:00+03:00`).toISOString());
  assert.equal(google.durum.kayitlar.get(e2).summary, '✓ Arama');

  await islem({ islem: 'duzenle', id: g.id, bas: null, bit: null });
  await islem({ islem: 'sil', id: h.id });
  s = await planAynasiniCalistir();
  assert.equal(s.silindi, 2);
  assert.equal(google.durum.kayitlar.size, 0);
});

test('ayna: takvimden elle silinen etkinlik değişiklikte yeniden açılır', async () => {
  const g = await ekle(istanbulBugun(), '09:00-10:00 Spor');
  await planAynasiniCalistir();
  google.durum.kayitlar.clear();
  await islem({ islem: 'duzenle', id: g.id, baslik: 'Spor salonu' });
  await planAynasiniCalistir();
  assert.equal(google.durum.kayitlar.size, 1);
  assert.equal([...google.durum.kayitlar.values()][0].summary, 'Spor salonu');
});

test('ayna: PLAN_TAKVIM=kapali ya da Google yoksa hiç çalışmaz', async () => {
  await ekle(istanbulBugun(), '09:00-10:00 Spor');
  process.env.PLAN_TAKVIM = 'kapali';
  assert.equal(await planAynasiniCalistir(), null);
  delete process.env.PLAN_TAKVIM;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  assert.equal(await planAynasiniCalistir(), null);
  assert.equal(google.durum.etkinlikler.length, 0);
  assert.equal((await plan()).v.takvimAyna, false);
});

test('ayna: plan değişince kendiliğinden (kısa beklemeyle) çalışır', async () => {
  await ekle(istanbulBugun(), '18:00-19:00 Okuma');
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(google.durum.etkinlikler.length, 1);
});

test('farkHesapla: pencere dışındaki eski işe dokunmaz', () => {
  const eski = { id: 'e-0000000001', gun: '2026-01-01', bas: '09:00', bit: '10:00', baslik: 'Eski' };
  const f = farkHesapla([eski], {}, '2026-11-10');
  assert.equal(f.ekle.length, 0);
  const kayitli = farkHesapla([{ ...eski, baslik: 'Değişti' }], { [eski.id]: { e: 'x', i: imza(eski) } }, '2026-11-10');
  assert.equal(kayitli.guncelle.length + kayitli.sil.length, 0);
  assert.equal(etkinlikGovdesi({ ...eski, bit: '24:00' }).end.dateTime, '2026-01-01T21:00:00.000Z');
});
