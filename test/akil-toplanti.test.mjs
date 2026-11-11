/* Claude ile iş çıkarma ("Kafama at") + toplantı hatırlatması.
   node --test test/akil-toplanti.test.mjs — sahte Claude, sahte Google, sahte Telegram; dışarıya hiçbir istek gitmez. */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sunucuOlustur } from '../sunucu/sunucu.mjs';
import { planBelleginiSifirla, istanbulBugun } from '../sunucu/plan.mjs';
import { hatirlatKontrol, hatirlaticiSifirla, toplantiMetni } from '../sunucu/hatirlatici.mjs';
import { jetonBelleginiSil } from '../sunucu/takvim.mjs';
import { sahteGoogleBaslat } from './sahte-google.mjs';

const PLAN_ANAHTAR = 'makine-anahtari-0123456789abcdef';
const KAFA = 'kafa-anahtari-0123456789abcdefgh';

let sunucu, adres, klasor, google, sahte, sahteAdres;
let claudeIstekleri = [], claudeCevap = null, claudeDurum = 200;
let tgMesajlar = [];

function yerelSunucu(isleyici) {
  return new Promise((coz) => {
    const s = http.createServer((i, c) => {
      const p = [];
      i.on('data', (x) => p.push(x));
      i.on('end', () => isleyici(i, c, Buffer.concat(p).toString('utf8')));
    });
    s.listen(0, '127.0.0.1', () => coz(s));
  });
}

before(async () => {
  klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'akil-test-'));
  google = await sahteGoogleBaslat();
  // Tek sahte sunucu: /v1/messages = Claude, /bot…/sendMessage = Telegram
  sahte = await yerelSunucu((i, c, govde) => {
    if (i.url === '/v1/messages') {
      claudeIstekleri.push({ basliklar: i.headers, govde: JSON.parse(govde) });
      c.writeHead(claudeDurum, { 'Content-Type': 'application/json' });
      return c.end(JSON.stringify(claudeDurum === 200 ? claudeCevap : { error: { type: 'overloaded_error' } }));
    }
    tgMesajlar.push(JSON.parse(govde));
    c.writeHead(200, { 'Content-Type': 'application/json' });
    c.end(JSON.stringify({ ok: true }));
  });
  sahteAdres = `http://127.0.0.1:${sahte.address().port}`;
  sunucu = sunucuOlustur();
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  adres = `http://127.0.0.1:${sunucu.address().port}`;
});

after(async () => {
  await new Promise((r) => sunucu.close(r));
  await new Promise((r) => sahte.close(r));
  await google.kapat();
  fs.rmSync(klasor, { recursive: true, force: true });
});

beforeEach(() => {
  Object.assign(process.env, {
    PLAN_SIFRE: 'deneme-sifre-123', PLAN_ANAHTAR: PLAN_ANAHTAR, PLAN_VERI: klasor, KAFA_ANAHTAR: KAFA,
    PLAN_TAKVIM: 'kapali',
    ANTHROPIC_API_KEY: 'sahte-anahtar-0123456789abcdef', ANTHROPIC_API_KOK: sahteAdres,
    TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabc', TELEGRAM_CHAT_ID: '42', TELEGRAM_API: sahteAdres,
    GOOGLE_CLIENT_ID: 'sahte-id', GOOGLE_CLIENT_SECRET: 'sahte-gizli', GOOGLE_REFRESH_TOKEN: 'sahte-yenileme',
    GOOGLE_TOKEN_URL: google.kok + '/token', GOOGLE_API_KOK: google.kok
  });
  delete process.env.HATIRLAT_TOPLANTI;
  delete process.env.AKIL_MODEL;
  for (const f of fs.readdirSync(klasor)) fs.rmSync(path.join(klasor, f), { recursive: true, force: true });
  planBelleginiSifirla();
  hatirlaticiSifirla();
  jetonBelleginiSil();
  google.durum.kayitlar.clear();
  google.durum.takvimHata = false;
  claudeIstekleri = []; claudeDurum = 200; tgMesajlar = [];
  claudeCevap = cevapKur([{ baslik: 'Kabim sunumunu bitir', kadran: 1, gun: null, bas: null, bit: null, toplanti: false }]);
});

function cevapKur(isler, stop = 'end_turn') {
  return { stop_reason: stop, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ isler }) }] };
}

let ipSayac = 0;
function istek(yol, { yontem = 'GET', anahtar = PLAN_ANAHTAR, govde } = {}) {
  return new Promise((coz, reddet) => {
    const u = new URL(adres);
    const basliklar = { 'X-Forwarded-For': `10.4.0.${(++ipSayac % 250) + 1}`, Authorization: 'Bearer ' + anahtar };
    if (govde !== undefined) basliklar['Content-Type'] = 'application/json';
    const i = http.request({ host: u.hostname, port: u.port, path: yol, method: yontem, headers: basliklar }, (c) => {
      const p = [];
      c.on('data', (x) => p.push(x));
      c.on('end', () => { let v = null; try { v = JSON.parse(Buffer.concat(p).toString('utf8')); } catch { /* */ } coz({ durum: c.statusCode, v }); });
    });
    i.on('error', reddet);
    i.end(govde === undefined ? undefined : JSON.stringify(govde));
  });
}
const kafa = (metin) => istek('/api/plan/kafa', { yontem: 'POST', anahtar: KAFA, govde: { metin } });
const plan = async () => (await istek('/api/plan')).v.gorevler;
const gunSonra = (n) => { const d = new Date(istanbulBugun() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ======================= Claude ile iş çıkarma ======================= */

test('akıl: cümle birden çok işe ayrılır, öneri ve saat gelir, kadran onaysız kalır', async () => {
  const yarin = gunSonra(1);
  claudeCevap = cevapKur([
    { baslik: 'Kabim sunumunu bitir', kadran: 1, gun: null, bas: null, bit: null, toplanti: false },
    { baslik: 'Ahmet Bey ile görüşme', kadran: 2, gun: yarin, bas: '15:00', bit: '15:30', toplanti: true }
  ]);
  const r = await kafa('kabim sunumunu bitir bir de yarın üçte ahmet beyle görüşme');
  assert.equal(r.durum, 200);
  assert.equal(r.v.adet, 2);
  const g = await plan();
  const a = g.find((x) => x.baslik === 'Kabim sunumunu bitir');
  const b = g.find((x) => x.baslik === 'Ahmet Bey ile görüşme');
  assert.equal(a.oneri, 1);
  assert.equal(a.kadran, undefined);
  assert.equal(a.gun, istanbulBugun());
  assert.equal(b.gun, yarin);
  assert.equal(b.bas, '15:00');
  assert.equal(b.bit, '15:30');

  // istek biçimi: anahtar başlıkta, model ve yapılandırılmış çıktı gövdede, bugünün tarihi bağlamda
  const i = claudeIstekleri[0];
  assert.equal(i.basliklar['x-api-key'], 'sahte-anahtar-0123456789abcdef');
  assert.equal(i.basliklar['anthropic-version'], '2026-10-21');
  assert.equal(i.govde.model, 'claude-opus-5-5');
  assert.equal(i.govde.output_config.format.type, 'json_schema');
  assert.equal(i.govde.output_config.effort, 'low');
  assert.equal(i.govde.thinking, undefined);
  assert.match(i.govde.messages[0].content, new RegExp('Bugün: ' + istanbulBugun()));
  assert.match(i.govde.messages[0].content, /ahmet beyle görüşme/);
});

test('akıl: onaylayınca öneri düşer', async () => {
  await kafa('kabim sunumunu bitir');
  const [g] = await plan();
  const r = await istek('/api/plan/islem', { yontem: 'POST', govde: { islem: 'duzenle', id: g.id, kadran: 3 } });
  assert.equal(r.v.gorev.kadran, 3);
  assert.equal(r.v.gorev.oneri, undefined);
});

test('akıl: API hatası, ret ya da bozuk cevapta cümle olduğu gibi eklenir', async () => {
  claudeDurum = 529;
  assert.equal((await kafa('birinci iş')).durum, 200);
  claudeDurum = 200;
  claudeCevap = cevapKur([], 'refusal');
  assert.equal((await kafa('ikinci iş')).durum, 200);
  claudeCevap = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'json değil' }] };
  assert.equal((await kafa('üçüncü iş')).durum, 200);
  const g = await plan();
  assert.deepEqual(g.map((x) => x.baslik).sort(), ['birinci iş', 'ikinci iş', 'üçüncü iş']);
  assert.ok(g.every((x) => x.oneri === undefined && x.bas === null));
});

test('akıl: geçersiz saat ve geçmiş gün temizlenir, anahtar yoksa Claude çağrılmaz', async () => {
  claudeCevap = cevapKur([{ baslik: 'Rapor', kadran: 9, gun: '2020-01-01', bas: '25:00', bit: '26:00', toplanti: false }]);
  await kafa('rapor');
  let [g] = await plan();
  assert.equal(g.gun, istanbulBugun());
  assert.equal(g.bas, null);
  assert.equal(g.oneri, 2);

  delete process.env.ANTHROPIC_API_KEY;
  claudeIstekleri = [];
  await kafa('anahtarsız iş');
  assert.equal(claudeIstekleri.length, 0);
  assert.ok((await plan()).some((x) => x.baslik === 'anahtarsız iş'));
});

/* ======================= toplantı hatırlatması ======================= */

function toplantiKoy(id, basDk, { sure = 30, kisi = 'Ayşe Yılmaz', firma = 'Kobas Büro', meet = true } = {}, simdi = new Date()) {
  const bas = new Date(simdi.getTime() + basDk * 60e3);
  google.durum.kayitlar.set(id, {
    id, status: 'confirmed', summary: 'Görüşme — ' + kisi, organizer: { self: true },
    start: { dateTime: bas.toISOString() }, end: { dateTime: new Date(bas.getTime() + sure * 60e3).toISOString() },
    hangoutLink: meet ? 'https://meet.google.com/abc-defg-hij' : undefined,
    extendedProperties: { private: { kart: 'toplanti', ad: kisi, firma, sekil: meet ? 'meet' : 'telefon', telefon: '05320000001' } }
  });
}

test('toplantı: 15 dakika kala bir kez hatırlatır, Meet düğmesiyle', async () => {
  const simdi = new Date();
  toplantiKoy('t1', 12, {}, simdi);
  toplantiKoy('t2', 90, {}, simdi);                       // henüz erken
  const giden = await hatirlatKontrol(simdi);
  assert.ok(giden.includes('toplanti'));
  const m = tgMesajlar.filter((x) => /dk sonra/.test(x.text));
  assert.equal(m.length, 1);
  assert.match(m[0].text, /12 dk sonra: Ayşe Yılmaz \(Kobas Büro\)/);
  assert.match(m[0].text, /Google Meet/);
  assert.equal(m[0].reply_markup.inline_keyboard[0][0].url, 'https://meet.google.com/abc-defg-hij');

  hatirlaticiSifirla();                                   // yeniden başlatma: tekrar göndermez
  await hatirlatKontrol(new Date(simdi.getTime() + 60e3));
  assert.equal(tgMesajlar.filter((x) => /dk sonra/.test(x.text)).length, 1);
});

test('toplantı: ertelenince yeni saat için yeniden hatırlatır; kapalıysa hiç göndermez', async () => {
  const simdi = new Date();
  toplantiKoy('t1', 10, {}, simdi);
  await hatirlatKontrol(simdi);
  toplantiKoy('t1', 14, {}, simdi);                       // ertelendi
  hatirlaticiSifirla();
  await hatirlatKontrol(simdi);
  assert.equal(tgMesajlar.filter((x) => /dk sonra/.test(x.text)).length, 2);

  process.env.HATIRLAT_TOPLANTI = '0';
  toplantiKoy('t3', 5, {}, simdi);
  hatirlaticiSifirla();
  tgMesajlar = [];
  await hatirlatKontrol(simdi);
  assert.equal(tgMesajlar.length, 0);
});

test('toplantı: takvim hata verirse sunucu ayakta, telefon görüşmesinde numara yazar', async () => {
  google.durum.takvimHata = true;
  assert.deepEqual((await hatirlatKontrol(new Date())).filter((x) => x === 'toplanti'), []);
  assert.equal((await istek('/api/plan')).durum, 200);
  const t = { bas: new Date().toISOString(), bit: new Date(Date.now() + 30 * 60e3).toISOString(), sekil: 'telefon', kisi: { ad: 'Ali', telefon: '0532 000 00 01' } };
  assert.match(toplantiMetni(t, 0), /^Şimdi: Ali/);
  assert.match(toplantiMetni(t, 0), /Ara: 0532 000 00 01/);
});

test('sabah mesajı: bugünkü görüşmeler listelenir', async () => {
  const gun = istanbulBugun();
  const sabah = new Date(`${gun}T08:35:00+03:00`);
  toplantiKoy('t1', 0, { kisi: 'Zeki Karahan', firma: 'Kobas' }, new Date(`${gun}T14:00:00+03:00`));
  process.env.HATIRLAT_TOPLANTI = '0';
  await hatirlatKontrol(sabah);
  const m = tgMesajlar.find((x) => /Günaydın/.test(x.text));
  assert.match(m.text, /Bugünkü görüşmeler:\n• 14:00 Zeki Karahan \(Kobas\)/);
});
