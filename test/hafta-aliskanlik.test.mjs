/* Haftayı kur (en çok 3 hedef, işler hedefe bağlanır) + 5 alışkanlık + Telegram satırları.
   node --test test/hafta-aliskanlik.test.mjs — gerçek sunucu, geçici veri klasörü. */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sunucuOlustur } from '../sunucu/sunucu.mjs';
import { planBelleginiSifirla, istanbulBugun, haftaBasi, gunAliskanliklari, planGunOzeti } from '../sunucu/plan.mjs';
import { sabahMetni, aksamMetni, aliskanlikSatiri } from '../sunucu/hatirlatici.mjs';

const SIFRE = 'deneme-sifre-123';
const PLAN_ANAHTAR = 'makine-anahtari-0123456789abcdef';

let sunucu, adres, klasor;

before(async () => {
  klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'hafta-test-'));
  sunucu = sunucuOlustur();
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  adres = `http://127.0.0.1:${sunucu.address().port}`;
});

after(async () => {
  await new Promise((r) => sunucu.close(r));
  fs.rmSync(klasor, { recursive: true, force: true });
});

beforeEach(() => {
  Object.assign(process.env, { PLAN_SIFRE: SIFRE, PLAN_ANAHTAR, PLAN_VERI: klasor, PLAN_TAKVIM: 'kapali' });
  for (const f of fs.readdirSync(klasor)) fs.rmSync(path.join(klasor, f), { recursive: true, force: true });
  planBelleginiSifirla();
});

function istek(yol, { yontem = 'GET', govde } = {}) {
  return new Promise((coz, reddet) => {
    const u = new URL(adres);
    const basliklar = { Authorization: 'Bearer ' + PLAN_ANAHTAR };
    if (govde !== undefined) basliklar['Content-Type'] = 'application/json';
    const i = http.request({ host: u.hostname, port: u.port, path: yol, method: yontem, headers: basliklar }, (c) => {
      const p = [];
      c.on('data', (x) => p.push(x));
      c.on('end', () => {
        let v = null;
        try { v = JSON.parse(Buffer.concat(p).toString('utf8')); } catch { /* boş */ }
        coz({ durum: c.statusCode, v });
      });
    });
    i.on('error', reddet);
    i.end(govde === undefined ? undefined : JSON.stringify(govde));
  });
}
const islem = (v) => istek('/api/plan/islem', { yontem: 'POST', govde: v });
const plan = () => istek('/api/plan');
function gunEkle(gun, n) { const t = new Date(gun + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

test('haftaBasi: pazartesiye iner', () => {
  assert.equal(haftaBasi('2026-11-16'), '2026-11-16');
  assert.equal(haftaBasi('2026-11-19'), '2026-11-16');
  assert.equal(haftaBasi('2026-11-22'), '2026-11-16');
  assert.equal(haftaBasi('2026-11-23'), '2026-11-23');
});

test('haftaKur: en çok 3 hedef, boşlar düşer, aynı hafta üzerine yazılır', async () => {
  const bas = haftaBasi(istanbulBugun());
  let r = await islem({ islem: 'haftaKur', bas, hedefler: ['  Servora   10 demo ', '', 'Teklif'] });
  assert.equal(r.durum, 200);
  assert.deepEqual(r.v.hafta.hedefler, ['Servora 10 demo', 'Teklif']);
  assert.equal(r.v.hafta.kuruldu, istanbulBugun());
  r = await islem({ islem: 'haftaKur', bas, hedefler: ['Tek hedef'] });
  assert.equal(r.durum, 200);
  const p = await plan();
  assert.equal(p.v.hedefHaftalar.length, 1);
  assert.deepEqual(p.v.hedefHaftalar[0].hedefler, ['Tek hedef']);

  assert.equal((await islem({ islem: 'haftaKur', bas, hedefler: ['a', 'b', 'c', 'd'] })).durum, 400);
  assert.equal((await islem({ islem: 'haftaKur', bas: gunEkle(bas, 1), hedefler: ['a'] })).durum, 400, 'pazartesi olmayan başlangıç');
  assert.equal((await islem({ islem: 'haftaKur', bas, hedefler: [5] })).durum, 400);
});

test('iş hedefe bağlanır: ekle ve duzenle hedef alır, null bağı kaldırır', async () => {
  const gun = istanbulBugun();
  let r = await islem({ islem: 'ekle', gun, metin: 'Demo ara', hedef: 2 });
  assert.equal(r.durum, 200);
  assert.equal(r.v.gorev.hedef, 2);
  const id = r.v.gorev.id;
  r = await islem({ islem: 'duzenle', id, hedef: 1 });
  assert.equal(r.v.gorev.hedef, 1);
  r = await islem({ islem: 'duzenle', id, hedef: null });
  assert.equal(r.v.gorev.hedef, undefined);
  assert.equal((await islem({ islem: 'ekle', gun, metin: 'x', hedef: 4 })).durum, 400);
  assert.equal((await islem({ islem: 'duzenle', id, hedef: 'bir' })).durum, 400);
});

test('alışkanlıklar: plan, derin, kapanış kendiliğinden; hareket elle', async () => {
  const gun = istanbulBugun();
  let o = await planGunOzeti(gun);
  assert.deepEqual(o.aliskanlik, { plan: false, derin: false, hareket: false, kapanis: false, hafta: false });

  const g = (await islem({ islem: 'ekle', gun, metin: 'Önemli iş' })).v.gorev;
  await islem({ islem: 'duzenle', id: g.id, ust: true });
  await islem({ islem: 'seansKaydet', gun, dk: 60, baslik: 'a' });
  o = await planGunOzeti(gun);
  assert.equal(o.aliskanlik.plan, true);
  assert.equal(o.aliskanlik.derin, false, '60 dk yetmez');
  await islem({ islem: 'seansKaydet', gun, dk: 30, baslik: 'b' });
  await islem({ islem: 'kapanis', gun });
  assert.equal((await islem({ islem: 'aliskanlik', gun, ad: 'hareket', yapildi: true })).durum, 200);
  o = await planGunOzeti(gun);
  assert.deepEqual(o.aliskanlik, { plan: true, derin: true, hareket: true, kapanis: true, hafta: false });

  assert.equal((await islem({ islem: 'aliskanlik', gun, ad: 'hareket', yapildi: false })).durum, 200);
  assert.equal((await planGunOzeti(gun)).aliskanlik.hareket, false);
  const p = await plan();
  assert.equal(p.v.aliskanlik[gun], undefined, 'boş gün kaydı silinir');
});

test('alışkanlık: yalnız hareket ve derin elle; gelecek gün reddedilir', async () => {
  const gun = istanbulBugun();
  assert.equal((await islem({ islem: 'aliskanlik', gun, ad: 'kapanis', yapildi: true })).durum, 400);
  assert.equal((await islem({ islem: 'aliskanlik', gun, ad: 'plan', yapildi: true })).durum, 400);
  assert.equal((await islem({ islem: 'aliskanlik', gun: gunEkle(gun, 1), ad: 'hareket', yapildi: true })).durum, 400);
  assert.equal((await islem({ islem: 'aliskanlik', gun: gunEkle(gun, -3), ad: 'hareket', yapildi: true })).durum, 200, 'unutulan dün işaretlenebilir');
  assert.equal((await islem({ islem: 'aliskanlik', gun, ad: 'derin', yapildi: true })).durum, 200);
  assert.equal((await planGunOzeti(gun)).aliskanlik.derin, true);
});

test('haftalık gözden geçirme: Pazar kurulan yeni hafta iki haftayı da işaretler', () => {
  const d = {
    gorevler: [], seanslar: [], kapanislar: [], aliskanlik: {},
    hedefHaftalar: [{ bas: '2026-11-23', hedefler: ['x'], kuruldu: '2026-11-22' }]   // Pazar 22 Kasım
  };
  assert.equal(gunAliskanliklari(d, '2026-11-21').hafta, false, 'kurulmadan önceki gün');
  assert.equal(gunAliskanliklari(d, '2026-11-22').hafta, true, 'biten hafta (Pazar)');
  assert.equal(gunAliskanliklari(d, '2026-11-25').hafta, true, 'yeni hafta');
  assert.equal(gunAliskanliklari(d, '2026-12-01').hafta, false, 'sonraki hafta kurulmadı');
});

test('eski plan.json (hedef/alışkanlık yok) açılır; bozuk alanlar temizlenir', async () => {
  fs.writeFileSync(path.join(klasor, 'plan.json'), JSON.stringify({
    surum: 1, gorevler: [], haftalar: [], seanslar: [], kapanislar: ['2026-11-18'],
    hedefHaftalar: [{ bas: 'bozuk', hedefler: ['a'] }, { bas: '2026-11-16', hedefler: ['a', 'b', 'c', 'd'], kuruldu: '2026-11-16' }],
    aliskanlik: { '2026-11-18': ['hareket', 'uydurma'], 'x': ['hareket'] }
  }));
  planBelleginiSifirla();
  const p = await plan();
  assert.equal(p.durum, 200);
  assert.deepEqual(p.v.hedefHaftalar, [{ bas: '2026-11-16', hedefler: ['a', 'b', 'c'], kuruldu: '2026-11-16' }]);
  assert.deepEqual(p.v.aliskanlik, { '2026-11-18': ['hareket'] });

  fs.writeFileSync(path.join(klasor, 'plan.json'), JSON.stringify({ surum: 1, gorevler: [] }));
  planBelleginiSifirla();
  const q = await plan();
  assert.deepEqual(q.v.hedefHaftalar, []);
  assert.deepEqual(q.v.aliskanlik, {});
});

test('Telegram: sabah haftanın hedefleri, akşam tek satır alışkanlık', () => {
  assert.match(sabahMetni([], [], 0, { hedefler: ['A', 'B'] }), /^Bu hafta: A · B\n/);
  assert.doesNotMatch(sabahMetni([], [], 0, { hedefler: [] }), /Bu hafta/);
  const a = { plan: true, derin: false, hareket: true, kapanis: false, hafta: true };
  assert.equal(aliskanlikSatiri(a), 'Alışkanlık 3/5 · eksik: 90 dk derin, Günü kapat');
  assert.equal(aliskanlikSatiri({ plan: true, derin: true, hareket: true, kapanis: true, hafta: true }), 'Alışkanlık 5/5 ✓');
  assert.match(aksamMetni([{ bitti: true }], [], { aliskanlik: a }), /^Bugün 1\/1 iş bitti\.\nAlışkanlık 3\/5/);
  assert.match(aksamMetni([], []), /^Yarını kur/, 'özet yoksa eskisi gibi');
});
