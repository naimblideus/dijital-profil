/* DeepCore planı — node --test test/plan.test.mjs
   Gerçek sunucu açılır, veri geçici klasöre yazılır; hiçbir dış servise dokunulmaz. */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sunucuOlustur } from '../sunucu/sunucu.mjs';
import { planBelleginiSifirla, oturumUret, birlestir } from '../sunucu/plan.mjs';
import { planAyristir, gorevSatiri, gecerliGun, anahtar } from '../sunucu/plan-ayristir.mjs';

const SIFRE = 'deneme-sifre-123';
const ANAHTAR = 'makine-anahtari-0123456789abcdef';

let sunucu, adres, klasor;

before(async () => {
  klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-test-'));
  Object.assign(process.env, { PLAN_SIFRE: SIFRE, PLAN_ANAHTAR: ANAHTAR, PLAN_VERI: klasor });
  sunucu = sunucuOlustur();
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  adres = `http://127.0.0.1:${sunucu.address().port}`;
});

after(async () => {
  await new Promise((r) => sunucu.close(r));
  fs.rmSync(klasor, { recursive: true, force: true });
});

beforeEach(() => {
  // Her test temiz başlar: veri klasörü boşaltılır, bellek ve deneme sayaçları sıfırlanır.
  process.env.PLAN_SIFRE = SIFRE;
  process.env.PLAN_ANAHTAR = ANAHTAR;
  process.env.PLAN_VERI = klasor;
  for (const f of fs.readdirSync(klasor)) fs.rmSync(path.join(klasor, f), { recursive: true, force: true });
  planBelleginiSifirla();
});

let ipSayac = 0;
function ham(yol, { yontem = 'GET', basliklar = {}, govde } = {}) {
  return new Promise((coz, reddet) => {
    const u = new URL(adres);
    const i = http.request({ host: u.hostname, port: u.port, path: yol, method: yontem,
      headers: { 'X-Forwarded-For': `10.1.0.${(++ipSayac % 250) + 1}`, ...basliklar } }, (c) => {
      const p = [];
      c.on('data', (x) => p.push(x));
      c.on('end', () => {
        const metin = Buffer.concat(p).toString('utf8');
        let v = null;
        try { v = JSON.parse(metin); } catch { /* html */ }
        coz({ durum: c.statusCode, basliklar: c.headers, metin, v });
      });
    });
    i.on('error', reddet);
    i.end(govde);
  });
}

const json = (v) => JSON.stringify(v);
const JSONB = { 'Content-Type': 'application/json' };

async function giris(ip = '10.9.9.9') {
  const c = await ham('/api/plan/giris', { yontem: 'POST', basliklar: { ...JSONB, 'X-Forwarded-For': ip }, govde: json({ sifre: SIFRE }) });
  assert.equal(c.durum, 200);
  return String(c.basliklar['set-cookie'][0]).split(';')[0];
}

async function api(yol, govde, cerez) {
  return ham(yol, {
    yontem: govde ? 'POST' : 'GET',
    basliklar: { ...(govde ? JSONB : {}), ...(cerez ? { Cookie: cerez } : { Authorization: 'Bearer ' + ANAHTAR }) },
    govde: govde ? json(govde) : undefined
  });
}

const PLAN = [
  '﻿# Haftalık Plan — 10 – 18 Ekim 2026   ·   KAPI 1 HAFTASI',
  '# Düzenle, sonra çalıştır:  node plan-to-deepcore.cjs --yeni',
  '# Biçim:  - [Alan] Başlık | dakika | not',
  '#',
  '# ══════════════════════',
  '# RİTİM:  Cmt+Paz = MAKER   ·   Pzt-Cum = SAHA',
  '#',
  '# KAPI 1 = 18 EKİM.',
  '# ══════════════════════',
  '',
  '## 2026-10-13 Salı',
  '- [Nexus Servis] 08:30-09:30 — kendi 10 araman | 60 | Açılış: "Geçen ay kaç makinenin sayacını alamadınız?"',
  '- [Büyüme] Dekor — 3 mağazaya kare | 60 | önce görsel | sonra ara',
  '- [Kişisel] Haftayı kapat | 10 |',
  '',
  '## 2026-10-14 Çarşamba',
  '- [Bilinmeyen Etiket] MEDİPOL YÜKLENİCİSİ | 120 | Kurucu gider.',
  '- Etiketsiz görev | sadece not'
].join('\r\n');

/* ======================= ayrıştırıcı ======================= */

test('ayrıştırıcı: başlık, haftanın notu, günler ve görevler (CRLF + BOM)', () => {
  const p = planAyristir(PLAN);
  assert.equal(p.baslik, '10 – 18 Ekim 2026 · KAPI 1 HAFTASI');
  assert.equal(p.not, 'RİTİM: Cmt+Paz = MAKER · Pzt-Cum = SAHA\n\nKAPI 1 = 18 EKİM.', 'talimat satırları ve süsler nota girmez');
  assert.deepEqual(p.gunler.map((g) => g.gun), ['2026-10-13', '2026-10-14']);
  assert.equal(p.gunler[0].gorevler.length, 3);
  assert.deepEqual(p.gunler[0].gorevler[0], {
    alan: 'Nexus Servis', baslik: 'kendi 10 araman', dk: 60, bas: '08:30', bit: '09:30',
    not: 'Açılış: "Geçen ay kaç makinenin sayacını alamadınız?"'
  });
  assert.equal(p.gunler[0].gorevler[1].not, 'önce görsel | sonra ara', 'nottaki dikey çizgi korunur');
  assert.equal(p.gunler[0].gorevler[2].not, '');
  assert.equal(p.uyarilar.length, 0);
});

test('ayrıştırıcı: tanınmayan etiket ve etiketsiz görev DÜŞMEZ', () => {
  const g = planAyristir(PLAN).gunler[1].gorevler;
  assert.equal(g[0].alan, 'Bilinmeyen Etiket');
  assert.deepEqual(g[1], { alan: null, baslik: 'Etiketsiz görev', dk: null, not: 'sadece not' });
});

test('ayrıştırıcı: hatalı tarih, günsüz görev ve eski kimlik uyarı olarak raporlanır', () => {
  const p = planAyristir([
    '# Başlık',
    '- [X] gün başlığından önce',
    '## 2026-02-30 Olmayan gün',
    '- [X] atlanır',
    '## Notlar',
    '- not maddesi',
    '## 2026-10-20 Salı',
    '- [Deploy] #eski-kimlik'
  ].join('\n'));
  assert.deepEqual(p.gunler.map((g) => [g.gun, g.gorevler.length]), [['2026-10-20', 1]]);
  assert.equal(p.uyarilar.length, 4);
  assert.match(p.uyarilar.join('\n'), /gün başlığından önce/);
  assert.match(p.uyarilar.join('\n'), /2026-02-30/);
  assert.match(p.uyarilar.join('\n'), /eski DeepCore kimliği/);
});

test('ayrıştırıcı yardımcıları: tarih, anahtar, görev satırı', () => {
  assert.equal(gecerliGun('2026-02-28'), true);
  assert.equal(gecerliGun('2026-02-29'), false);
  assert.equal(gecerliGun('2026-13-01'), false);
  assert.equal(anahtar('OFİSJET — Teklif!'), anahtar('ofisjet teklif'), 'Türkçe İ ve noktalama farkı yok sayılır');
  assert.equal(anahtar('Çağrı Şeker Öğün Ilık'), 'cagri seker ogun ilik');
  assert.deepEqual(gorevSatiri('[Servis]  Ara | 1500 | uzun'), { alan: 'Servis', baslik: 'Ara', dk: null, not: '1500 | uzun' },
    '1440 üstü dakika sayılmaz, nota kalır');
});

/* ======================= kurulum ve giriş ======================= */

test('PLAN_SIFRE yoksa plan KAPALI: hiçbir uç şifresiz açılmaz', async () => {
  delete process.env.PLAN_SIFRE;
  for (const [yol, yontem] of [['/api/plan', 'GET'], ['/api/plan/giris', 'POST'], ['/api/plan/islem', 'POST'], ['/api/plan/yukle', 'POST']]) {
    const c = await ham(yol, { yontem, basliklar: { ...JSONB, Authorization: 'Bearer ' + ANAHTAR }, govde: yontem === 'POST' ? '{}' : undefined });
    assert.equal(c.durum, 503, yol);
    assert.equal(c.v.sebep, 'kurulmadi');
  }
});

test('kısa şifre kabul edilmez (plan kapalı kalır)', async () => {
  process.env.PLAN_SIFRE = '1234567';
  assert.equal((await ham('/api/plan')).durum, 503);
});

test('oturumsuz istek 401; yanlış şifre 401; doğru şifre güvenli çerez verir', async () => {
  assert.equal((await ham('/api/plan')).durum, 401);
  const yanlis = await ham('/api/plan/giris', { yontem: 'POST', basliklar: JSONB, govde: json({ sifre: 'yanlis' }) });
  assert.equal(yanlis.durum, 401);
  assert.equal(yanlis.v.sebep, 'sifre');

  const c = await ham('/api/plan/giris', { yontem: 'POST', basliklar: { ...JSONB, 'X-Forwarded-Proto': 'https' }, govde: json({ sifre: SIFRE }) });
  assert.equal(c.durum, 200);
  const cerez = String(c.basliklar['set-cookie'][0]);
  assert.match(cerez, /^plan_oturum=v1\./);
  for (const bayrak of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(cerez.includes(bayrak), bayrak);
  assert.match(cerez, /Max-Age=15552000/, '180 gün');

  const durum = await api('/api/plan', null, cerez.split(';')[0]);
  assert.equal(durum.durum, 200);
  assert.deepEqual(durum.v.gorevler, []);
  assert.equal(typeof durum.v.kalici, 'boolean');
});

test('oynanmış, süresi dolmuş ya da başka şifreyle imzalanmış çerez reddedilir', async () => {
  const gecerli = await giris();
  const bozuk = gecerli.slice(0, -2) + (gecerli.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await api('/api/plan', null, bozuk)).durum, 401);

  const eski = 'plan_oturum=' + oturumUret(SIFRE, Date.now() - 200 * 24 * 3600e3);
  assert.equal((await api('/api/plan', null, eski)).durum, 401);

  process.env.PLAN_SIFRE = 'yeni-sifre-degisti';
  assert.equal((await api('/api/plan', null, gecerli)).durum, 401, 'şifre değişince tüm oturumlar düşer');
});

test('yanlış şifre kilidi: aynı adresten 8 hata → doğru şifre bile 429; başka adres etkilenmez', async () => {
  const ip = '10.5.5.5';
  for (let i = 0; i < 8; i++) {
    const c = await ham('/api/plan/giris', { yontem: 'POST', basliklar: { ...JSONB, 'X-Forwarded-For': ip }, govde: json({ sifre: 'yanlis' + i }) });
    assert.equal(c.durum, 401);
  }
  const kilitli = await ham('/api/plan/giris', { yontem: 'POST', basliklar: { ...JSONB, 'X-Forwarded-For': ip }, govde: json({ sifre: SIFRE }) });
  assert.equal(kilitli.durum, 429);
  assert.ok(kilitli.v.dakika >= 1 && kilitli.v.dakika <= 15);
  await giris('10.6.6.6');
});

test('makine anahtarı: doğrusu yükler, yanlışı 401', async () => {
  const yanlis = await ham('/api/plan/yukle', { yontem: 'POST', basliklar: { ...JSONB, Authorization: 'Bearer yanlis-anahtar-yanlis-anahtar-x' }, govde: json({ metin: PLAN }) });
  assert.equal(yanlis.durum, 401);
  const c = await api('/api/plan/yukle', { metin: PLAN });
  assert.equal(c.durum, 200);
  assert.deepEqual(c.v.ozet, { eklenen: 5, guncellenen: 0, silinen: 0, korunan: 0, atlanan: 0 });
});

/* ======================= istek sahteciliği ve sınırlar ======================= */

test('JSON olmayan POST 415; başka siteden Origin 403; aynı köken geçer', async () => {
  const cerez = await giris();
  const duz = await ham('/api/plan/islem', { yontem: 'POST', basliklar: { 'Content-Type': 'text/plain', Cookie: cerez }, govde: '{}' });
  assert.equal(duz.durum, 415);
  const form = await ham('/api/plan/giris', { yontem: 'POST', basliklar: { 'Content-Type': 'application/x-www-form-urlencoded' }, govde: 'sifre=' + SIFRE });
  assert.equal(form.durum, 415, 'form ile giriş denenemez');

  const kotu = await ham('/api/plan/islem', { yontem: 'POST', basliklar: { ...JSONB, Cookie: cerez, Origin: 'https://kotu.example' }, govde: json({ islem: 'ekle', gun: '2026-10-14', metin: 'x' }) });
  assert.equal(kotu.durum, 403);

  const u = new URL(adres);
  const iyi = await ham('/api/plan/islem', { yontem: 'POST', basliklar: { ...JSONB, Cookie: cerez, Origin: `http://${u.host}` }, govde: json({ islem: 'ekle', gun: '2026-10-14', metin: 'x' }) });
  assert.equal(iyi.durum, 200);
});

test('gövde sınırı: işlem 16 KB, plan yüklemesi 512 KB', async () => {
  const cerez = await giris();
  const buyuk = await ham('/api/plan/islem', { yontem: 'POST', basliklar: { ...JSONB, Cookie: cerez }, govde: json({ islem: 'ekle', gun: '2026-10-14', metin: 'x'.repeat(20000) }) });
  assert.equal(buyuk.durum, 413);

  const satirlar = ['# Büyük plan'];
  for (let g = 1; g <= 28; g++) {
    satirlar.push(`## 2026-11-${String(g).padStart(2, '0')} Gün`);
    for (let i = 0; i < 12; i++) satirlar.push(`- [Kod] Görev ${g}-${i} | 30 | ${'açıklama '.repeat(25)}`);
  }
  const metin = satirlar.join('\n');
  assert.ok(Buffer.byteLength(metin) > 16 * 1024);
  const c = await api('/api/plan/yukle', { metin });
  assert.equal(c.durum, 200);
  assert.equal(c.v.ozet.eklenen, 28 * 12);
});

test('/plan → /plan/ yönlendirmesi; kabuk çerçeveye alınamaz ve önbelleğe takılmaz', async () => {
  const y = await ham('/plan?x=1');
  assert.equal(y.durum, 308);
  assert.equal(y.basliklar.location, '/plan/?x=1');
  const k = await ham('/plan/');
  assert.equal(k.durum, 200);
  assert.equal(k.basliklar['x-frame-options'], 'DENY');
  assert.equal(k.basliklar['cache-control'], 'no-cache');
  assert.equal(k.basliklar['x-robots-tag'], 'noindex, nofollow');
  assert.match(k.metin, /<title>DeepCore<\/title>/);
  assert.doesNotMatch(k.metin, /Ofisjet|AKSA|KAPI 1/, 'kabukta veri yok — veri yalnız oturumla gelir');
});

/* ======================= işlemler ======================= */

test('ekle: "[Alan] başlık | dk | not" biçimi tek kutudan çalışır', async () => {
  const cerez = await giris();
  const c = await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-14', metin: '[Servis] Ofisjet ara | 20 | teklif dönüşü' }, cerez);
  assert.equal(c.durum, 200);
  const g = c.v.gorev;
  assert.match(g.id, /^e-[0-9a-f]{10}$/);
  assert.deepEqual([g.alan, g.baslik, g.dk, g.not, g.kaynak, g.bitti], ['Servis', 'Ofisjet ara', 20, 'teklif dönüşü', 'elle', false]);

  const sade = await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-14', metin: 'Sadece başlık' }, cerez);
  assert.deepEqual([sade.v.gorev.alan, sade.v.gorev.dk, sade.v.gorev.sira], [null, null, 1], 'sona eklenir');

  assert.equal((await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-32', metin: 'x' }, cerez)).v.sebep, 'gun');
  assert.equal((await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-14', metin: '   ' }, cerez)).v.sebep, 'metin');
});

test('işaretle / taşı / düzenle / sil ve hatalı istekler', async () => {
  const cerez = await giris();
  const g = (await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-14', metin: 'Görev' }, cerez)).v.gorev;

  const bitti = await api('/api/plan/islem', { islem: 'isaretle', id: g.id, bitti: true }, cerez);
  assert.equal(bitti.v.gorev.bitti, true);
  assert.ok(Date.parse(bitti.v.gorev.bittiZaman));
  const geri = await api('/api/plan/islem', { islem: 'isaretle', id: g.id, bitti: false }, cerez);
  assert.deepEqual([geri.v.gorev.bitti, geri.v.gorev.bittiZaman], [false, null]);

  const tasindi = await api('/api/plan/islem', { islem: 'tasi', id: g.id, gun: '2026-10-15' }, cerez);
  assert.equal(tasindi.v.gorev.gun, '2026-10-15');
  assert.equal(tasindi.v.gorev.gunIlk, '2026-10-14', 'ilk gün kimlik için korunur');

  const duz = await api('/api/plan/islem', { islem: 'duzenle', id: g.id, baslik: '  Yeni başlık ', not: 'n', dk: 45 }, cerez);
  assert.deepEqual([duz.v.gorev.baslik, duz.v.gorev.not, duz.v.gorev.dk, duz.v.gorev.duzenlendi], ['Yeni başlık', 'n', 45, true]);
  assert.equal((await api('/api/plan/islem', { islem: 'duzenle', id: g.id, dk: 2000 }, cerez)).v.sebep, 'dk');
  assert.equal((await api('/api/plan/islem', { islem: 'duzenle', id: g.id, baslik: ' ' }, cerez)).v.sebep, 'baslik');

  assert.equal((await api('/api/plan/islem', { islem: 'sil', id: g.id }, cerez)).durum, 200);
  assert.equal((await api('/api/plan', null, cerez)).v.gorevler.length, 0);

  assert.equal((await api('/api/plan/islem', { islem: 'isaretle', id: 'e-0000000000', bitti: true }, cerez)).durum, 404);
  assert.equal((await api('/api/plan/islem', { islem: 'isaretle', id: '../x', bitti: true }, cerez)).durum, 400);
  assert.equal((await api('/api/plan/islem', { islem: 'uydurma' }, cerez)).v.sebep, 'islem');
  const bozukJson = await ham('/api/plan/islem', { yontem: 'POST', basliklar: { ...JSONB, Cookie: cerez }, govde: '{bozuk' });
  assert.equal(bozukJson.v.sebep, 'json');
});

test('tasiCok: geçmişten kalanları bugüne alır, yapılmışlara dokunmaz', async () => {
  const cerez = await giris();
  const ekle = async (gun, metin) => (await api('/api/plan/islem', { islem: 'ekle', gun, metin }, cerez)).v.gorev;
  const a = await ekle('2026-10-12', 'A');
  const b = await ekle('2026-10-13', 'B');
  const c = await ekle('2026-10-13', 'C');
  await api('/api/plan/islem', { islem: 'isaretle', id: c.id, bitti: true }, cerez);
  const r = await api('/api/plan/islem', { islem: 'tasiCok', gun: '2026-10-14', idler: [a.id, b.id, c.id, 'gecersiz'] }, cerez);
  assert.deepEqual(r.v.gorevler.map((g) => g.baslik), ['A', 'B']);
  const durum = (await api('/api/plan', null, cerez)).v.gorevler;
  assert.equal(durum.find((g) => g.id === c.id).gun, '2026-10-13', 'yapılmış görev yerinde kalır');
  assert.deepEqual(durum.filter((g) => g.gun === '2026-10-14').map((g) => g.sira), [0, 1]);
});

/* ======================= plan yükleme (birleştirme) ======================= */

test('aynı plan iki kez yüklenince kopya oluşmaz, yapılmış işaret korunur', async () => {
  const cerez = await giris();
  await api('/api/plan/yukle', { metin: PLAN });
  const ilk = (await api('/api/plan', null, cerez)).v.gorevler;
  await api('/api/plan/islem', { islem: 'isaretle', id: ilk[0].id, bitti: true }, cerez);

  const ikinci = await api('/api/plan/yukle', { metin: PLAN });
  assert.deepEqual(ikinci.v.ozet, { eklenen: 0, guncellenen: 0, silinen: 0, korunan: 5, atlanan: 0 });
  const son = (await api('/api/plan', null, cerez)).v.gorevler;
  assert.equal(son.length, 5);
  assert.equal(son.find((g) => g.id === ilk[0].id).bitti, true);
});

test('plan değişince: dokunulmamış görev silinir; yapılmış, taşınmış, düzeltilmiş ve elle eklenen KALIR', async () => {
  const cerez = await giris();
  const v1 = ['# H', '## 2026-10-13 Salı', '- [Kod] Yapılmış', '- [Kod] Taşınmış', '## 2026-10-14 Çar', '- [Kod] Düzeltilmiş', '- [Kod] Dokunulmamış'].join('\n');
  await api('/api/plan/yukle', { metin: v1 });
  const bul = async (b) => (await api('/api/plan', null, cerez)).v.gorevler.find((g) => g.baslik === b);
  await api('/api/plan/islem', { islem: 'isaretle', id: (await bul('Yapılmış')).id, bitti: true }, cerez);
  await api('/api/plan/islem', { islem: 'tasi', id: (await bul('Taşınmış')).id, gun: '2026-10-20' }, cerez);
  await api('/api/plan/islem', { islem: 'duzenle', id: (await bul('Düzeltilmiş')).id, not: 'elle yazdım' }, cerez);
  await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-13', metin: 'Elle eklenen' }, cerez);
  await api('/api/plan/yukle', { metin: ['# H', '## 2026-11-01 Cmt', '- [Kod] Başka hafta'].join('\n') });

  const v2 = ['# H2', '## 2026-10-13 Salı', '- [Servis] Yeni görev', '## 2026-10-14 Çar'].join('\n');
  const r = await api('/api/plan/yukle', { metin: v2 });
  assert.deepEqual(r.v.ozet, { eklenen: 1, guncellenen: 0, silinen: 1, korunan: 3, atlanan: 0 });

  const kalan = (await api('/api/plan', null, cerez)).v.gorevler.map((g) => g.baslik).sort();
  assert.deepEqual(kalan, ['Başka hafta', 'Düzeltilmiş', 'Elle eklenen', 'Taşınmış', 'Yapılmış', 'Yeni görev'].sort());
  assert.equal((await bul('Taşınmış')).gun, '2026-10-20', 'kullanıcının taşıdığı gün ezilmez');
});

test('plan içeriği güncellenir ama elle düzeltilen görev ezilmez', async () => {
  const cerez = await giris();
  await api('/api/plan/yukle', { metin: '# H\n## 2026-10-13 Salı\n- [Kod] A | 30 | eski not\n- [Kod] B | 30 | eski' });
  const b = (await api('/api/plan', null, cerez)).v.gorevler.find((g) => g.baslik === 'B');
  await api('/api/plan/islem', { islem: 'duzenle', id: b.id, not: 'benim notum' }, cerez);
  const r = await api('/api/plan/yukle', { metin: '# H\n## 2026-10-13 Salı\n- [Servis] A | 45 | yeni not\n- [Kod] B | 30 | plandan yeni' });
  assert.deepEqual(r.v.ozet, { eklenen: 0, guncellenen: 1, silinen: 0, korunan: 1, atlanan: 0 });
  const g = (await api('/api/plan', null, cerez)).v.gorevler;
  const a = g.find((x) => x.baslik === 'A');
  assert.deepEqual([a.alan, a.dk, a.not], ['Servis', 45, 'yeni not']);
  assert.equal(g.find((x) => x.baslik === 'B').not, 'benim notum');
});

test('bilerek silinen plan görevi, plan yeniden yüklenince DİRİLMEZ; değiştirilmiş hâli yeni görev sayılır', async () => {
  const cerez = await giris();
  await api('/api/plan/yukle', { metin: '# H\n## 2026-10-13 Salı\n- [Kod] Silinecek\n- [Kod] Kalacak' });
  const sil = (await api('/api/plan', null, cerez)).v.gorevler.find((g) => g.baslik === 'Silinecek');
  await api('/api/plan/islem', { islem: 'sil', id: sil.id }, cerez);
  await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-13', metin: 'Elle eklenip silinen' }, cerez);
  const elle = (await api('/api/plan', null, cerez)).v.gorevler.find((g) => g.kaynak === 'elle');
  await api('/api/plan/islem', { islem: 'sil', id: elle.id }, cerez);

  const r = await api('/api/plan/yukle', { metin: '# H\n## 2026-10-13 Salı\n- [Kod] Silinecek\n- [Kod] Kalacak' });
  assert.deepEqual(r.v.ozet, { eklenen: 0, guncellenen: 0, silinen: 0, korunan: 1, atlanan: 1 });
  assert.deepEqual((await api('/api/plan', null, cerez)).v.gorevler.map((g) => g.baslik), ['Kalacak']);

  planBelleginiSifirla();                                      // silme hafızası da diske yazılır
  const r2 = await api('/api/plan/yukle', { metin: '# H\n## 2026-10-13 Salı\n- [Kod] Silinecek — yeni hâli\n- [Kod] Kalacak' });
  assert.deepEqual(r2.v.ozet, { eklenen: 1, guncellenen: 0, silinen: 0, korunan: 1, atlanan: 0 }, 'başlık değişti = yeni görev');
});

test('aynı gün aynı başlık iki kez: iki ayrı görev; haftanın notu başlangıç gününe göre yenilenir', () => {
  const d = { surum: 1, guncellendi: null, haftalar: [], gorevler: [] };
  const ozet = birlestir(d, planAyristir('# Hafta A\n# not A\n## 2026-10-13 Salı\n- [Kod] Ara\n- [Kod] Ara'));
  assert.equal(ozet.eklenen, 2);
  assert.notEqual(d.gorevler[0].id, d.gorevler[1].id);
  birlestir(d, planAyristir('# Hafta A v2\n# not A2\n## 2026-10-13 Salı\n- [Kod] Ara\n- [Kod] Ara'));
  assert.deepEqual(d.haftalar.map((h) => [h.bas, h.son, h.baslik, h.not]), [['2026-10-13', '2026-10-13', 'Hafta A v2', 'not A2']]);
});

test('yükle: gün içermeyen metin 422 ve uyarılar; boş metin 400', async () => {
  const bos = await api('/api/plan/yukle', { metin: '# Sadece başlık\n- günsüz görev' });
  assert.equal(bos.durum, 422);
  assert.equal(bos.v.sebep, 'bos');
  assert.equal(bos.v.uyarilar.length, 1);
  assert.equal((await api('/api/plan/yukle', { metin: '  ' })).v.sebep, 'metin');
});

test('eşzamanlı yazma ve okuma: okuma kendinden önceki yazmayı görür; aynı anda 20 yazma kaybolmaz', async () => {
  const cerez = await giris();
  const g = (await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-14', metin: 'Yarış' }, cerez)).v.gorev;
  // Yazma ve okuma aynı anda yola çıkar; okuma yazmadan sonra sıraya girdiği için onu görmeli.
  const [yazma, okuma] = await Promise.all([
    api('/api/plan/islem', { islem: 'isaretle', id: g.id, bitti: true }, cerez),
    api('/api/plan', null, cerez)
  ]);
  assert.equal(yazma.durum, 200);
  assert.equal(okuma.v.gorevler.find((x) => x.id === g.id).bitti, true);

  // İki cihaz aynı anda 20 görev ekler: sıralı kuyruk sayesinde hiçbiri ezilmez.
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-15', metin: 'Eş ' + i }, cerez)));
  const son = (await api('/api/plan', null, cerez)).v.gorevler.filter((x) => x.gun === '2026-10-15');
  assert.equal(son.length, 20);
  assert.deepEqual(son.map((x) => x.sira).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i), 'sıra numaraları çakışmaz');
});

/* ======================= zaman bloğu · derin odak · kapanış ======================= */

test('saatli plan satırı = saatli görev; tekrar yüklemede elle değiştirilen saat ezilmez', async () => {
  const cerez = await giris();
  const metinP = '# H\n## 2026-10-27 Salı\n- [Servis] 08:30-09:30 — 10 arama | 60\n- [Kod] saatsiz görev';
  await api('/api/plan/yukle', { metin: metinP });
  let g = (await api('/api/plan', null, cerez)).v.gorevler;
  assert.deepEqual(g.map((x) => [x.baslik, x.bas, x.bit]), [['10 arama', '08:30', '09:30'], ['saatsiz görev', null, null]]);
  await api('/api/plan/islem', { islem: 'duzenle', id: g[0].id, bas: '09:00', bit: '10:00' }, cerez);
  await api('/api/plan/yukle', { metin: metinP });
  g = (await api('/api/plan', null, cerez)).v.gorevler;
  assert.equal(g.length, 2);
  assert.deepEqual([g[0].bas, g[0].bit], ['09:00', '10:00']);
});

test('tek kutudan saatli görev; saat düzenle/kaldır ve doğrulama', async () => {
  const cerez = await giris();
  const g = (await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-27', metin: '14:00-15:30 Teklif yaz' }, cerez)).v.gorev;
  assert.deepEqual([g.baslik, g.bas, g.bit], ['Teklif yaz', '14:00', '15:30']);
  const duz = async (ek) => api('/api/plan/islem', { islem: 'duzenle', id: g.id, ...ek }, cerez);
  assert.equal((await duz({ bas: '16:00', bit: '15:00' })).v.sebep, 'aralik');
  assert.equal((await duz({ bas: '25:00', bit: '26:00' })).v.sebep, 'bas');
  assert.equal((await duz({ bas: '23:00', bit: '24:00' })).durum, 200, '24:00 bitiş geçerli');
  const k = (await duz({ bas: null, bit: null })).v.gorev;
  assert.deepEqual([k.bas, k.bit], [null, null], 'saat kaldırılınca saatsiz görev');
  const z = (await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-27', metin: '[Servis] 9:00-9:45 — Arama | 45' }, cerez)).v.gorev;
  assert.deepEqual([z.alan, z.baslik, z.bas, z.bit, z.dk], ['Servis', 'Arama', '09:00', '09:45', 45]);
});

test('derin odak seansı, kapanış ritüeli ve haftalık hedef kaydedilir', async () => {
  const cerez = await giris();
  const s = (await api('/api/plan/islem', { islem: 'seansKaydet', gun: '2026-10-27', dk: 52, baslik: 'Teklif' }, cerez)).v.seans;
  assert.deepEqual([s.dk, s.derin, s.kesildi], [52, true, false]);
  assert.equal((await api('/api/plan/islem', { islem: 'seansKaydet', gun: '2026-10-27', dk: 0 }, cerez)).v.sebep, 'dk');
  await api('/api/plan/islem', { islem: 'kapanis', gun: '2026-10-27' }, cerez);
  await api('/api/plan/islem', { islem: 'kapanis', gun: '2026-10-27' }, cerez);
  await api('/api/plan/islem', { islem: 'hedef', saat: 15 }, cerez);
  assert.equal((await api('/api/plan/islem', { islem: 'hedef', saat: 200 }, cerez)).v.sebep, 'saat');
  planBelleginiSifirla();
  const v = (await api('/api/plan', null, await giris('10.4.4.4'))).v;
  assert.equal(v.seanslar.length, 1);
  assert.deepEqual(v.kapanislar, ['2026-10-27'], 'kapanış bir kez');
  assert.equal(v.ayarlar.haftalikDerinHedef, 15);
});

/* ======================= kalıcılık ======================= */

test('yeniden başlatma sonrası veri diskten gelir; günlük yedek alınır', async () => {
  const cerez = await giris();
  await api('/api/plan/yukle', { metin: PLAN });
  const g = (await api('/api/plan', null, cerez)).v.gorevler[0];
  await api('/api/plan/islem', { islem: 'isaretle', id: g.id, bitti: true }, cerez);

  planBelleginiSifirla();                                     // süreç yeniden başladı
  const c2 = await giris('10.7.7.7');
  const sonra = (await api('/api/plan', null, c2)).v;
  assert.equal(sonra.gorevler.length, 5);
  assert.equal(sonra.gorevler.find((x) => x.id === g.id).bitti, true);
  assert.equal(sonra.haftalar[0].baslik, '10 – 18 Ekim 2026 · KAPI 1 HAFTASI');

  const yedekler = fs.readdirSync(path.join(klasor, 'yedek'));
  assert.deepEqual(yedekler, [`plan-${new Date().toISOString().slice(0, 10)}.json`]);
  assert.ok(!fs.existsSync(path.join(klasor, 'plan.json.gecici')), 'atomik yazma artık bırakmaz');
});

test('bozuk veri dosyası: son yedekten açılır, bozuk dosya silinmez, kullanıcı uyarılır', async () => {
  const cerez = await giris();
  await api('/api/plan/yukle', { metin: PLAN });
  await api('/api/plan/islem', { islem: 'ekle', gun: '2026-10-14', metin: 'yedekten sonra' }, cerez);   // ikinci yazma → yedek
  fs.writeFileSync(path.join(klasor, 'plan.json'), '{bozuk');
  planBelleginiSifirla();
  const v = (await api('/api/plan', null, await giris('10.8.8.8'))).v;
  assert.match(v.uyari, /yedeğinden açıldı/);
  assert.equal(v.gorevler.length, 5, 'yedek, ikinci yazmadan önceki hâl');
  assert.equal(fs.readdirSync(klasor).filter((f) => f.startsWith('plan.bozuk-')).length, 1);
});

test('veri klasörü yazılamıyorsa plan 503 "depolama" der — kart ve randevu çalışmaya devam eder', async () => {
  const dosya = path.join(klasor, 'dosya-klasor-degil');
  fs.writeFileSync(dosya, 'x');
  process.env.PLAN_VERI = path.join(dosya, 'alt');
  planBelleginiSifirla();
  const cerez = await giris();
  const c = await api('/api/plan', null, cerez);
  assert.equal(c.durum, 503);
  assert.equal(c.v.sebep, 'depolama');
  assert.equal((await ham('/saglik')).durum, 200);
  assert.equal((await ham('/')).durum, 200);
});
