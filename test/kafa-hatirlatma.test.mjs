/* "Kafama at" kestirmesi + Telegram hatırlatması — node --test test/kafa-hatirlatma.test.mjs
   Gerçek sunucu açılır, veri geçici klasöre yazılır; Telegram yerel sahte sunucudur, dışarıya mesaj gitmez. */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sunucuOlustur } from '../sunucu/sunucu.mjs';
import { planBelleginiSifirla, istanbulBugun } from '../sunucu/plan.mjs';
import {
  hatirlatKontrol, hatirlaticiSifirla, hatirlaticiAcikMi, sabahMetni, aksamMetni
} from '../sunucu/hatirlatici.mjs';

const SIFRE = 'deneme-sifre-123';
const PLAN_ANAHTAR = 'makine-anahtari-0123456789abcdef';
const KAFA = 'kafa-anahtari-0123456789abcdefgh';
const BOT = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabc';

let sunucu, adres, klasor, tg, tgAdres;
let tgMesajlar = [];
let tgDurum = 200;

before(async () => {
  klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'kafa-test-'));
  sunucu = sunucuOlustur();
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  adres = `http://127.0.0.1:${sunucu.address().port}`;
  // Sahte Telegram: gelen mesajı kaydeder, istenen durumu döndürür.
  tg = http.createServer((i, c) => {
    const p = [];
    i.on('data', (x) => p.push(x));
    i.on('end', () => {
      const govde = JSON.parse(Buffer.concat(p).toString('utf8') || '{}');
      if (tgDurum === 200) tgMesajlar.push({ yol: i.url, govde });
      c.writeHead(tgDurum, { 'Content-Type': 'application/json' });
      c.end(JSON.stringify({ ok: tgDurum === 200 }));
    });
  });
  await new Promise((r) => tg.listen(0, '127.0.0.1', r));
  tgAdres = `http://127.0.0.1:${tg.address().port}`;
});

after(async () => {
  await new Promise((r) => sunucu.close(r));
  await new Promise((r) => tg.close(r));
  fs.rmSync(klasor, { recursive: true, force: true });
});

beforeEach(() => {
  Object.assign(process.env, {
    PLAN_SIFRE: SIFRE, PLAN_ANAHTAR: PLAN_ANAHTAR, PLAN_VERI: klasor, KAFA_ANAHTAR: KAFA,
    TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_CHAT_ID: '42', TELEGRAM_API: tgAdres,
    KART_ADRESI: 'https://ornek.test'
  });
  delete process.env.HATIRLAT_SABAH;
  delete process.env.HATIRLAT_AKSAM;
  for (const f of fs.readdirSync(klasor)) fs.rmSync(path.join(klasor, f), { recursive: true, force: true });
  planBelleginiSifirla();
  hatirlaticiSifirla();
  tgMesajlar = [];
  tgDurum = 200;
});

let ipSayac = 0;
function istek(yol, { yontem = 'GET', anahtar, govde, tur = 'application/json' } = {}) {
  return new Promise((coz, reddet) => {
    const u = new URL(adres);
    const basliklar = { 'X-Forwarded-For': `10.2.0.${(++ipSayac % 250) + 1}` };
    if (anahtar) basliklar.Authorization = 'Bearer ' + anahtar;
    if (govde !== undefined) basliklar['Content-Type'] = tur;
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
    i.end(govde === undefined ? undefined : (typeof govde === 'string' ? govde : JSON.stringify(govde)));
  });
}

const planOku = () => istek('/api/plan', { anahtar: PLAN_ANAHTAR });
const islem = (v) => istek('/api/plan/islem', { yontem: 'POST', anahtar: PLAN_ANAHTAR, govde: v });

/** İstanbul saatiyle belirli bir an (UTC+3). */
const istanbul = (gun, saat) => new Date(`${gun}T${saat}:00+03:00`);

/* ======================= Kafama at ======================= */

test('kafa: doğru anahtarla bugüne saatsiz iş düşer', async () => {
  const r = await istek('/api/plan/kafa', { yontem: 'POST', anahtar: KAFA, govde: { metin: '  Ahmet Bey\'e\n teklif   gönder ' } });
  assert.equal(r.durum, 200);
  assert.equal(r.v.baslik, "Ahmet Bey'e teklif gönder");
  assert.deepEqual(Object.keys(r.v).sort(), ['baslik', 'tamam']);   // planla ilgili başka hiçbir şey dönmez
  const p = await planOku();
  const g = p.v.gorevler.find((x) => x.kaynak === 'kafa');
  assert.ok(g);
  assert.equal(g.gun, istanbulBugun());
  assert.equal(g.bas, null);
  assert.ok(!g.ust);
  assert.equal(g.bitti, false);
});

test('kafa: anahtarsız ya da yanlış anahtarla 401', async () => {
  assert.equal((await istek('/api/plan/kafa', { yontem: 'POST', govde: { metin: 'x' } })).durum, 401);
  assert.equal((await istek('/api/plan/kafa', { yontem: 'POST', anahtar: 'yanlis-anahtar-0123456789abcdef', govde: { metin: 'x' } })).durum, 401);
  assert.equal((await planOku()).v.gorevler.length, 0);
});

test('kafa: anahtar planı okuyamaz, işlem yapamaz', async () => {
  assert.equal((await istek('/api/plan', { anahtar: KAFA })).durum, 401);
  assert.equal((await istek('/api/plan/islem', { yontem: 'POST', anahtar: KAFA, govde: { islem: 'ekle', gun: istanbulBugun(), metin: 'x' } })).durum, 401);
  assert.equal((await istek('/api/plan/yukle', { yontem: 'POST', anahtar: KAFA, govde: { metin: '## 2026-11-10 Pzt\n- x' } })).durum, 401);
});

test('kafa: boş metin 400, uzun metin 300 karaktere kırpılır', async () => {
  assert.equal((await istek('/api/plan/kafa', { yontem: 'POST', anahtar: KAFA, govde: { metin: '   ' } })).durum, 400);
  assert.equal((await istek('/api/plan/kafa', { yontem: 'POST', anahtar: KAFA, govde: {} })).durum, 400);
  const r = await istek('/api/plan/kafa', { yontem: 'POST', anahtar: KAFA, govde: { metin: 'a'.repeat(900) } });
  assert.equal(r.durum, 200);
  assert.equal(r.v.baslik.length, 300);
});

test('kafa: JSON olmayan gövde 415, GET 405', async () => {
  assert.equal((await istek('/api/plan/kafa', { yontem: 'POST', anahtar: KAFA, govde: 'metin=x', tur: 'application/x-www-form-urlencoded' })).durum, 415);
  assert.equal((await istek('/api/plan/kafa', { anahtar: KAFA })).durum, 405);
});

test('kafa: KAFA_ANAHTAR yoksa uç kapalı (503), plan anahtarı yine de ekleyebilir', async () => {
  delete process.env.KAFA_ANAHTAR;
  assert.equal((await istek('/api/plan/kafa', { yontem: 'POST', anahtar: KAFA, govde: { metin: 'x' } })).durum, 503);
  assert.equal((await istek('/api/plan/kafa', { yontem: 'POST', anahtar: PLAN_ANAHTAR, govde: { metin: 'x' } })).durum, 200);
});

test('kafa: dakikada en çok 20 ekleme', async () => {
  for (let i = 0; i < 20; i++) {
    assert.equal((await istek('/api/plan/kafa', { yontem: 'POST', anahtar: KAFA, govde: { metin: 'iş ' + i } })).durum, 200);
  }
  assert.equal((await istek('/api/plan/kafa', { yontem: 'POST', anahtar: KAFA, govde: { metin: 'fazla' } })).durum, 429);
});

test('kestirme kurulumu: anahtarı yalnız plan sahibi görür', async () => {
  const r = await istek('/api/plan/kestirme', { anahtar: PLAN_ANAHTAR });
  assert.equal(r.durum, 200);
  assert.equal(r.v.anahtar, KAFA);
  assert.equal((await istek('/api/plan/kestirme', { anahtar: KAFA })).durum, 401);
  assert.equal((await istek('/api/plan/kestirme')).durum, 401);
  delete process.env.KAFA_ANAHTAR;
  assert.equal((await istek('/api/plan/kestirme', { anahtar: PLAN_ANAHTAR })).v.anahtar, null);
});

/* ======================= Telegram hatırlatması ======================= */

async function ucuKur(gun, basliklar, { saatli } = {}) {
  for (const b of basliklar) {
    const r = await islem({ islem: 'ekle', gun, metin: b });
    assert.equal(r.durum, 200);
    assert.equal((await islem({ islem: 'duzenle', id: r.v.gorev.id, ust: true })).durum, 200);
  }
  if (saatli) {
    const r = await islem({ islem: 'ekle', gun, metin: saatli.baslik });
    await islem({ islem: 'duzenle', id: r.v.gorev.id, bas: saatli.bas, bit: saatli.bit });
  }
}

test('hatırlatma: sabah 08:30 penceresinde bugünün 3\'ü + ilk blok gider', async () => {
  await ucuKur('2026-11-10', ['Teklif yaz', 'Kabim sunumu', 'Ekiple 1:1'], { saatli: { baslik: 'Derin çalışma', bas: '10:00', bit: '11:30' } });
  await islem({ islem: 'ekle', gun: '2026-11-10', metin: 'Fatura kes' });   // kafada bekleyen
  const giden = await hatirlatKontrol(istanbul('2026-11-10', '08:35'));
  assert.deepEqual(giden, ['sabah']);
  assert.equal(tgMesajlar.length, 1);
  const m = tgMesajlar[0];
  assert.equal(m.yol, `/bot${BOT}/sendMessage`);
  assert.equal(m.govde.chat_id, '42');
  assert.match(m.govde.text, /Bugünün 3'ü/);
  assert.match(m.govde.text, /1\. Teklif yaz\n2\. Kabim sunumu\n3\. Ekiple 1:1/);
  assert.match(m.govde.text, /İlk blok: 10:00–11:30 Derin çalışma/);
  assert.match(m.govde.text, /Kafanda 1 iş bekliyor/);
  assert.equal(m.govde.reply_markup.inline_keyboard[0][0].url, 'https://ornek.test/plan/');
});

test('hatırlatma: aynı gün ikinci kez gitmez, yeniden başlatmada da gitmez', async () => {
  await hatirlatKontrol(istanbul('2026-11-10', '08:31'));
  await hatirlatKontrol(istanbul('2026-11-10', '08:45'));
  hatirlaticiSifirla();                                   // sunucu yeniden başladı
  await hatirlatKontrol(istanbul('2026-11-10', '09:10'));
  assert.equal(tgMesajlar.length, 1);
  assert.ok(fs.existsSync(path.join(klasor, 'hatirlatma.json')));
  await hatirlatKontrol(istanbul('2026-11-11', '08:40'));   // ertesi gün yine gider
  assert.equal(tgMesajlar.length, 2);
});

test('hatırlatma: pencere dışında gitmez (erken ya da 90 dk sonrası)', async () => {
  assert.deepEqual(await hatirlatKontrol(istanbul('2026-11-10', '08:29')), []);
  assert.deepEqual(await hatirlatKontrol(istanbul('2026-11-10', '10:00')), []);
  assert.deepEqual(await hatirlatKontrol(istanbul('2026-11-10', '14:00')), []);
  assert.deepEqual(await hatirlatKontrol(istanbul('2026-11-10', '22:30')), []);
  assert.equal(tgMesajlar.length, 0);
});

test('hatırlatma: seçim yoksa sabah "seç" der', async () => {
  await hatirlatKontrol(istanbul('2026-11-10', '08:30'));
  assert.match(tgMesajlar[0].govde.text, /henüz seçmedin/);
});

test('hatırlatma: akşam yarın boşsa "Yarını kur", doluysa "Yarın hazır"', async () => {
  const r = await islem({ islem: 'ekle', gun: '2026-11-10', metin: 'Bitti iş' });
  await islem({ islem: 'isaretle', id: r.v.gorev.id, bitti: true });
  await islem({ islem: 'ekle', gun: '2026-11-10', metin: 'Kalan iş' });
  await hatirlatKontrol(istanbul('2026-11-10', '21:05'));
  assert.match(tgMesajlar[0].govde.text, /Bugün 1\/2 iş bitti\./);
  assert.match(tgMesajlar[0].govde.text, /Yarını kur/);

  await ucuKur('2026-11-12', ['A', 'B', 'C']);
  await hatirlatKontrol(istanbul('2026-11-11', '21:00'));
  assert.match(tgMesajlar[1].govde.text, /Yarın hazır ✓\n1\. A\n2\. B\n3\. C/);
});

test('hatırlatma: Telegram hata verirse kayıt düşmez, sonraki dakika yeniden dener', async () => {
  tgDurum = 500;
  assert.deepEqual(await hatirlatKontrol(istanbul('2026-11-10', '08:30')), []);
  tgDurum = 200;
  assert.deepEqual(await hatirlatKontrol(istanbul('2026-11-10', '08:31')), ['sabah']);
  assert.equal(tgMesajlar.length, 1);
  // sunucu bu arada ayakta
  assert.equal((await istek('/saglik')).durum, 200);
});

test('hatırlatma: ortam yoksa kapalı, saatler ortamdan değişir', async () => {
  delete process.env.TELEGRAM_CHAT_ID;
  assert.equal(hatirlaticiAcikMi(), false);
  assert.deepEqual(await hatirlatKontrol(istanbul('2026-11-10', '08:30')), []);
  process.env.TELEGRAM_CHAT_ID = '42';
  process.env.HATIRLAT_SABAH = '07:00';
  assert.deepEqual(await hatirlatKontrol(istanbul('2026-11-10', '08:30')), []);   // 07:00 + 90 dk = 08:30 hariç
  assert.deepEqual(await hatirlatKontrol(istanbul('2026-11-10', '07:10')), ['sabah']);
});

test('metinler: sabah ve akşam saf fonksiyonlar', () => {
  assert.match(sabahMetni([]), /henüz seçmedin/);
  assert.match(aksamMetni([], []), /^Yarını kur/);
  const g = [{ baslik: 'X', ust: true, sira: 0, bitti: true }];
  assert.match(sabahMetni(g), /1\. ✓ X/);
});
