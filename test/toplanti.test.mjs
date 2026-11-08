/* Toplantı ekranı — node --test test/toplanti.test.mjs
   Gerçek sunucu açılır; Google ve CRM sahte (sahte-google.mjs, sahte-crm.mjs). Hiçbir dış servise dokunulmaz. */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sahteGoogleBaslat } from './sahte-google.mjs';
import { sahteCrmBaslat } from './sahte-crm.mjs';
import { sunucuOlustur, hizSiniriniSifirla } from '../sunucu/sunucu.mjs';
import { planBelleginiSifirla } from '../sunucu/plan.mjs';
import { toplantiBelleginiSifirla } from '../sunucu/toplanti.mjs';
import { jetonBelleginiSil, istanbulDan, istanbulParcalari } from '../sunucu/takvim.mjs';
import { mesaj, waNumara, waLinki, zamanMetni } from '../site/toplanti/mesaj.mjs';

const SIFRE = 'deneme-sifre-123';
const ANAHTAR = 'makine-anahtari-0123456789abcdef';
const KISAYOL = 'kisayol-anahtari-0123456789abcdef';

let sunucu, adres, google, crm, klasor, cerez;

before(async () => {
  klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'toplanti-test-'));
  google = await sahteGoogleBaslat();
  crm = await sahteCrmBaslat();
  Object.assign(process.env, {
    PLAN_SIFRE: SIFRE, PLAN_ANAHTAR: ANAHTAR, PLAN_VERI: klasor, TOPLANTI_ANAHTAR: KISAYOL,
    GOOGLE_CLIENT_ID: 'sahte-id', GOOGLE_CLIENT_SECRET: 'sahte-gizli', GOOGLE_REFRESH_TOKEN: 'sahte-yenileme',
    GOOGLE_TOKEN_URL: google.kok + '/token', GOOGLE_API_KOK: google.kok, GOOGLE_GMAIL_KOK: google.kok,
    KART_ADRESI: 'https://naim.ornek.test/'
  });
  sunucu = sunucuOlustur();
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  adres = `http://127.0.0.1:${sunucu.address().port}`;
  const c = await ham('/api/plan/giris', { yontem: 'POST', basliklar: JSONB, govde: JSON.stringify({ sifre: SIFRE }) });
  assert.equal(c.durum, 200);
  cerez = String(c.basliklar['set-cookie'][0]).split(';')[0];
});

after(async () => {
  await new Promise((r) => sunucu.close(r));
  await google.kapat();
  await crm.kapat();
  fs.rmSync(klasor, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.PLAN_SIFRE = SIFRE;
  crmBagla();
  Object.assign(google.durum, { mesgul: [], etkinlikler: [], epostalar: [], islemler: [], takvimHata: false, gmailHata: false, meetYok: false });
  google.durum.kayitlar.clear();
  Object.assign(crm.durum, { istekler: [], hata: false, yanitla: null });
  jetonBelleginiSil();
  planBelleginiSifirla();
  toplantiBelleginiSifirla();
  hizSiniriniSifirla();
});

function crmBagla() { Object.assign(process.env, { NEXUS_CRM_URL: crm.kok + '/', NEXUS_CRM_TOKEN: crm.jeton }); }
function crmKopar() { delete process.env.NEXUS_CRM_URL; delete process.env.NEXUS_CRM_TOKEN; }

const JSONB = { 'Content-Type': 'application/json' };
let ipSayac = 0;
function ham(yol, { yontem = 'GET', basliklar = {}, govde } = {}) {
  return new Promise((coz, reddet) => {
    const u = new URL(adres);
    const i = http.request({ host: u.hostname, port: u.port, path: yol, method: yontem,
      headers: { 'X-Forwarded-For': `10.2.0.${(++ipSayac % 250) + 1}`, ...basliklar } }, (c) => {
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

/** Oturumlu istek (telefondaki sayfa gibi). */
const api = (yol, govde, ek = {}) => ham(yol, {
  yontem: govde ? 'POST' : 'GET',
  basliklar: { ...(govde ? JSONB : {}), Cookie: cerez, ...ek },
  govde: govde ? JSON.stringify(govde) : undefined
});

/** Yarın İstanbul saatiyle hh:mm. */
function yarin(saat, dakika = 0, gunSonra = 1) {
  const p = istanbulParcalari(new Date(Date.now() + gunSonra * 86400e3));
  return istanbulDan(p.yil, p.ay, p.gun, saat, dakika).toISOString();
}

const KISI = { ad: 'Ayşe Yılmaz', firma: 'Kobas Büro', telefon: '0532 000 00 01', eposta: 'ayse@ornek.com' };

async function bekle(kosul, ms = 2000) {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (kosul()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return false;
}

/* ---------- giriş ve koruma ---------- */

test('★ yetkisiz erişim: oturumsuz 401, kestirme anahtarı listeyi okuyamaz, PLAN_SIFRE yoksa kapalı', async () => {
  assert.equal((await ham('/api/toplanti')).durum, 401);
  assert.equal((await ham('/api/toplanti', { basliklar: { Authorization: 'Bearer ' + KISAYOL } })).durum, 401);
  assert.equal((await ham('/api/toplanti/olustur', { yontem: 'POST', basliklar: JSONB, govde: '{}' })).durum, 401);
  assert.equal((await ham('/api/toplanti/taslak-al', { yontem: 'POST', basliklar: { ...JSONB, Authorization: 'Bearer ' + KISAYOL }, govde: '{}' })).durum, 401);
  assert.equal((await ham('/api/toplanti', { basliklar: { Authorization: 'Bearer ' + ANAHTAR } })).durum, 200, 'makine anahtarı plan gibi geçer');
  assert.equal((await api('/api/toplanti')).durum, 200, 'plan çerezi aynen geçer');
  delete process.env.PLAN_SIFRE;
  const k = await api('/api/toplanti');
  assert.equal(k.durum, 503);
  assert.equal(k.v.sebep, 'kurulmadi');
});

test('istek sahteciliğine karşı: JSON dışı 415, yabancı köken 403; yanlış yöntem 405, bilinmeyen yol 404', async () => {
  assert.equal((await ham('/api/toplanti/olustur', { yontem: 'POST', basliklar: { Cookie: cerez, 'Content-Type': 'text/plain' }, govde: '{}' })).durum, 415);
  assert.equal((await api('/api/toplanti/olustur', KISI, { Origin: 'https://kotu.example' })).durum, 403);
  assert.equal((await api('/api/toplanti/olustur')).durum, 405);
  assert.equal((await api('/api/toplanti/yok')).durum, 404);
});

test('sayfa: /toplanti → /toplanti/, çerçeveye alınamaz, her açılışta taze; modül betiği doğru türde', async () => {
  const y = await ham('/toplanti');
  assert.equal(y.durum, 308);
  assert.equal(y.basliklar.location, '/toplanti/');
  const s = await ham('/toplanti/');
  assert.equal(s.durum, 200);
  assert.match(s.metin, /<title>Toplantılar<\/title>/);
  assert.equal(s.basliklar['x-frame-options'], 'DENY');
  assert.equal(s.basliklar['cache-control'], 'no-cache');
  const m = await ham('/toplanti/mesaj.mjs');
  assert.match(m.basliklar['content-type'], /^text\/javascript/);
});

/* ---------- oluştur ---------- */

test('★ oluştur: Meet linkli etkinlik, CRM\'e yazılır, CRM firması etkinliğe işlenir, WhatsApp metni hazır (gönderilmez)', async () => {
  const bas = yarin(14);
  const c = await api('/api/toplanti/olustur', { ...KISI, bas, sure: 45, sekil: 'meet', not: 'Teklif', davet: false });
  assert.equal(c.durum, 200, c.metin);
  const [e] = google.durum.etkinlikler;
  assert.equal(google.durum.etkinlikler.length, 1);
  assert.equal(e.sendUpdates, 'none', 'davet kapalıyken kimseye bir şey gitmez');
  assert.equal(e.govde.attendees, undefined);
  assert.equal(e.surum, '1');
  assert.equal(e.govde.summary, 'Toplantı — Ayşe Yılmaz (Kobas Büro)');
  assert.equal(new Date(e.govde.end.dateTime) - new Date(bas), 45 * 60e3);
  assert.equal(e.govde.extendedProperties.private.kart, 'toplanti');
  assert.equal(e.govde.extendedProperties.private.telefon, '0532 000 00 01');

  const yazma = crm.durum.istekler.filter((i) => i.yol === '/api/toplanti');
  assert.equal(yazma.length, 1);
  assert.equal(yazma[0].jeton, crm.jeton);
  assert.deepEqual(
    { islem: yazma[0].govde.islem, kaynak: yazma[0].govde.kaynak, etkinlikId: yazma[0].govde.etkinlikId, bas: yazma[0].govde.bas, meet: yazma[0].govde.meet, ad: yazma[0].govde.ad, telefon: yazma[0].govde.telefon },
    { islem: 'planla', kaynak: 'elle', etkinlikId: c.v.toplanti.id, bas, meet: 'https://meet.google.com/abc-defg-hij', ad: 'Ayşe Yılmaz', telefon: '0532 000 00 01' });

  assert.deepEqual(c.v.crm, { durum: 'yazildi', firmaId: 'f1', adres: crm.kok + '/firma/f1', yeniFirma: false });
  const patch = google.durum.islemler.find((i) => i.yontem === 'PATCH');
  assert.equal(patch.govde.extendedProperties.private.crmFirma, 'f1');
  assert.equal(patch.sendUpdates, 'none');
  assert.equal(c.v.toplanti.crm.adres, crm.kok + '/firma/f1');
  assert.equal(c.v.toplanti.meet, 'https://meet.google.com/abc-defg-hij');

  assert.match(c.v.wa.adres, /^https:\/\/wa\.me\/905320000001\?text=/);
  assert.match(c.v.wa.metin, /^Merhaba Ayşe,\ngörüşmemizi takvime ekledim\./);
  assert.match(c.v.wa.metin, /Google Meet: https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.ok(!/davet/i.test(c.v.wa.metin), 'davet gitmediyse metin davetten söz etmez');
  assert.equal(google.durum.epostalar.length, 0, 'kendiliğinden e-posta yok');
});

test('davet açık ve e-posta varsa katılımcı eklenir; telefon ve yüz yüzede Meet açılmaz, yer yazılır', async () => {
  const d = await api('/api/toplanti/olustur', { ...KISI, bas: yarin(10), sekil: 'meet', davet: true });
  assert.equal(google.durum.etkinlikler[0].sendUpdates, 'all');
  assert.deepEqual(google.durum.etkinlikler[0].govde.attendees, [{ email: 'ayse@ornek.com', displayName: 'Ayşe Yılmaz' }]);
  assert.match(d.v.wa.metin, /Takvim davetini e-postanıza da gönderdim/);

  const t = await api('/api/toplanti/olustur', { ad: 'Can', telefon: '05551112233', bas: yarin(11), sekil: 'telefon', davet: true });
  assert.equal(t.durum, 200);
  assert.equal(google.durum.etkinlikler[1].sendUpdates, 'none', 'e-posta yoksa davet de yok');
  assert.equal(google.durum.etkinlikler[1].govde.conferenceData, undefined);
  assert.equal(google.durum.etkinlikler[1].govde.location, 'Telefon: 05551112233');
  assert.match(t.v.wa.metin, /Sizi telefonla arayacağım/);

  const y = await api('/api/toplanti/olustur', { firma: 'Ak Matbaa', bas: yarin(12), sekil: 'yuzyuze', yer: 'Ak Matbaa, Topkapı' });
  assert.equal(google.durum.etkinlikler[2].govde.location, 'Ak Matbaa, Topkapı');
  assert.equal(google.durum.etkinlikler[2].govde.summary, 'Toplantı — Ak Matbaa');
  assert.match(y.v.wa.adres, /^https:\/\/wa\.me\/\?text=/, 'numara yoksa WhatsApp kişi seçtirir');
});

test('★ çakışma: dolu saate 409 ve etkinlik açılmaz; "yine de" (zorla) ile açılır', async () => {
  const bas = yarin(15);
  google.durum.mesgul.push({ start: bas, end: new Date(new Date(bas).getTime() + 60 * 60e3).toISOString() });
  const c = await api('/api/toplanti/olustur', { ...KISI, bas });
  assert.equal(c.durum, 409);
  assert.equal(c.v.sebep, 'cakisma');
  assert.equal(google.durum.etkinlikler.length, 0);
  assert.equal(crm.durum.istekler.length, 0);
  const z = await api('/api/toplanti/olustur', { ...KISI, bas, zorla: true });
  assert.equal(z.durum, 200);
  assert.equal(google.durum.etkinlikler.length, 1);
});

test('doğrulama: kişisiz, bozuk e-posta, geçmiş saat, bozuk saat 400', async () => {
  assert.equal((await api('/api/toplanti/olustur', { bas: yarin(9) })).v.sebep, 'kisi');
  assert.equal((await api('/api/toplanti/olustur', { ad: 'A', eposta: 'bozuk@', bas: yarin(9) })).v.sebep, 'eposta');
  assert.equal((await api('/api/toplanti/olustur', { ad: 'A', bas: '2020-01-01T08:00:00.000Z' })).v.sebep, 'gecmis-saat');
  assert.equal((await api('/api/toplanti/olustur', { ad: 'A', bas: 'yarın' })).v.sebep, 'saat');
  assert.equal(google.durum.etkinlikler.length, 0);
});

/* ---------- liste ---------- */

test('★ liste: kartın toplantıları ve randevuları gün sırasıyla; kişisiz özel etkinlik görünmez, başkasının daveti salt okunur', async () => {
  await api('/api/toplanti/olustur', { ...KISI, bas: yarin(16) });
  // Bu sürümden önce açılmış kart randevusu: kişi yalnız açıklamada
  google.durum.kayitlar.set('eski1', {
    id: 'eski1', status: 'confirmed', organizer: { self: true }, summary: 'Görüşme — Örnek Fotokopi (Telefon)',
    description: 'Firma: Örnek Fotokopi\nKişi: Veli Demir\nTelefon: 0533 222 33 44\nGörüşme şekli: Telefon — bu numara aranacak',
    start: { dateTime: yarin(9) }, end: { dateTime: yarin(9, 30) }, htmlLink: 'https://calendar.google.com/event?eid=x'
  });
  google.durum.kayitlar.set('spor1', { id: 'spor1', status: 'confirmed', organizer: { self: true }, summary: 'Spor', start: { dateTime: yarin(7) }, end: { dateTime: yarin(8) } });
  google.durum.kayitlar.set('dis1', {
    id: 'dis1', status: 'confirmed', organizer: { email: 'baska@ornek.com' }, summary: 'Yatırımcı görüşmesi',
    attendees: [{ email: 'ben@ornek.com', self: true }, { email: 'yatirimci@fon.com', displayName: 'Fon Ortağı' }],
    start: { dateTime: yarin(18) }, end: { dateTime: yarin(19) }, hangoutLink: 'https://meet.google.com/xyz-abcd-efg'
  });
  google.durum.kayitlar.set('gun1', { id: 'gun1', status: 'confirmed', summary: 'Tatil', attendees: [{ email: 'x@y.com' }], start: { date: '2030-01-01' }, end: { date: '2030-01-02' } });

  const c = await api('/api/toplanti');
  assert.equal(c.durum, 200);
  assert.equal(c.v.takvim, true);
  assert.equal(c.v.crm, true);
  assert.equal(c.v.randevuAdresi, 'https://naim.ornek.test/#randevu');
  const l = c.v.toplantilar;
  assert.deepEqual(l.map((t) => t.kaynak), ['randevu', 'toplanti', 'takvim']);
  assert.deepEqual(l[0].kisi, { ad: 'Veli Demir', firma: 'Örnek Fotokopi', telefon: '0533 222 33 44', eposta: null });
  assert.equal(l[0].sekil, 'telefon');
  assert.equal(l[0].duzenlenebilir, true);
  assert.equal(l[1].crm.adres, crm.kok + '/firma/f1');
  assert.equal(l[2].duzenlenebilir, false, 'başkasının düzenlediği etkinlik ertelenemez');
  assert.equal(l[2].kisi.ad, 'Fon Ortağı');
  assert.equal(l[2].meet, 'https://meet.google.com/xyz-abcd-efg');
});

test('takvim bağlı değilken liste boş ve "takvim: false" döner; takvim hatası 502 (ayrıntı sızmaz)', async () => {
  const yedek = process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  try {
    const c = await api('/api/toplanti');
    assert.equal(c.durum, 200);
    assert.equal(c.v.takvim, false);
    assert.deepEqual(c.v.toplantilar, []);
    assert.equal((await api('/api/toplanti/olustur', { ...KISI, bas: yarin(9) })).durum, 503);
  } finally { process.env.GOOGLE_REFRESH_TOKEN = yedek; }
  google.durum.takvimHata = true;
  const h = await api('/api/toplanti');
  assert.equal(h.durum, 502);
  assert.ok(!h.metin.includes('gizli'));
});

test('boş saatler: ziyaretçinin 4 saat kuralı sahibe uygulanmaz, dolu saat çıkar', async () => {
  const p = istanbulParcalari(new Date());
  const bas = yarin(10);
  google.durum.mesgul.push({ start: bas, end: new Date(new Date(bas).getTime() + 30 * 60e3).toISOString() });
  const c = await api('/api/toplanti/slotlar');
  assert.equal(c.durum, 200);
  const hepsi = c.v.gunler.flatMap((g) => g.slotlar.map((s) => s.bas));
  assert.ok(!hepsi.includes(bas), 'dolu saat listede');
  assert.ok(hepsi.every((s) => new Date(s).getTime() >= Date.now() - 60e3));
  if (p.saat >= 8 && p.saat < 19) {
    assert.ok(hepsi.some((s) => new Date(s).getTime() < Date.now() + 2 * 3600e3), 'iki saat içindeki boş saat de gelmeli');
  }
});

/* ---------- ertele / iptal / görüştük ---------- */

test('★ ertele: kendi eski saatiyle çakışmaz, başka toplantıyla çakışırsa 409; CRM\'e ertele gider', async () => {
  const c = await api('/api/toplanti/olustur', { ...KISI, bas: yarin(14), sure: 60 });
  const id = c.v.toplanti.id;
  // 15 dk ileri: eski saatiyle örtüşür ama kendisi olduğu için engel değil
  const e = await api('/api/toplanti/ertele', { id, bas: yarin(14, 15) });
  assert.equal(e.durum, 200, e.metin);
  assert.equal(e.v.toplanti.bas, yarin(14, 15));
  assert.equal(new Date(e.v.toplanti.bit) - new Date(e.v.toplanti.bas), 60 * 60e3, 'süre korunur');
  const patch = google.durum.islemler.filter((i) => i.yontem === 'PATCH').pop();
  assert.equal(patch.sendUpdates, 'none', 'davetli yoksa kimseye haber gitmez');
  const yazma = crm.durum.istekler.filter((i) => i.yol === '/api/toplanti').pop();
  assert.deepEqual({ islem: yazma.govde.islem, etkinlikId: yazma.govde.etkinlikId, bas: yazma.govde.bas, firmaId: yazma.govde.firmaId },
    { islem: 'ertele', etkinlikId: id, bas: yarin(14, 15), firmaId: 'f1' });
  assert.match(e.v.wa.metin, /saatini değiştirdim/);

  google.durum.mesgul.push({ start: yarin(17), end: yarin(18) });
  const cak = await api('/api/toplanti/ertele', { id, bas: yarin(16, 30) });
  assert.equal(cak.durum, 409);
  assert.equal((await api('/api/toplanti/ertele', { id, bas: yarin(16, 30), zorla: true })).durum, 200);
  assert.equal((await api('/api/toplanti/ertele', { id: 'yok-boyle', bas: yarin(9) })).durum, 404);
});

test('davetli toplantıyı ertele/iptal: "haber ver" açıksa Google davetliye bildirir, kapalıysa bildirmez', async () => {
  const c = await api('/api/toplanti/olustur', { ...KISI, bas: yarin(9), davet: true });
  const id = c.v.toplanti.id;
  await api('/api/toplanti/ertele', { id, bas: yarin(9, 30, 2) });
  assert.equal(google.durum.islemler.filter((i) => i.yontem === 'PATCH').pop().sendUpdates, 'all');
  await api('/api/toplanti/ertele', { id, bas: yarin(10, 0, 2), haberVer: false });
  assert.equal(google.durum.islemler.filter((i) => i.yontem === 'PATCH').pop().sendUpdates, 'none');
  await api('/api/toplanti/iptal', { id, haberVer: false });
  assert.equal(google.durum.islemler.find((i) => i.yontem === 'DELETE').sendUpdates, 'none');
});

test('★ iptal: takvimden silinir, CRM\'e notla iptal gider, yeni saat için randevu linkli metin hazır', async () => {
  const c = await api('/api/toplanti/olustur', { ...KISI, bas: yarin(11) });
  const id = c.v.toplanti.id;
  const i = await api('/api/toplanti/iptal', { id, not: 'Hastalanmış' });
  assert.equal(i.durum, 200);
  assert.equal(google.durum.kayitlar.has(id), false);
  assert.equal(google.durum.islemler.find((x) => x.yontem === 'DELETE').sendUpdates, 'none');
  const yazma = crm.durum.istekler.filter((x) => x.yol === '/api/toplanti').pop();
  assert.deepEqual({ islem: yazma.govde.islem, not: yazma.govde.not }, { islem: 'iptal', not: 'Hastalanmış' });
  assert.match(i.v.wa.metin, /iptal etmem gerekti/);
  assert.match(i.v.wa.metin, /https:\/\/naim\.ornek\.test\/#randevu/);
  assert.equal((await api('/api/toplanti')).v.toplantilar.length, 0);
  assert.equal((await api('/api/toplanti/iptal', { id })).durum, 404, 'ikinci iptal: toplantı yok');
});

test('★ görüştük: etkinliğe işaret + not, CRM\'e görüştük; listede "görüşüldü" görünür', async () => {
  const c = await api('/api/toplanti/olustur', { ...KISI, bas: yarin(13) });
  const id = c.v.toplanti.id;
  const g = await api('/api/toplanti/gorustuk', { id, not: 'Fiyat istedi' });
  assert.equal(g.durum, 200);
  assert.equal(g.v.toplanti.durum, 'gorusuldu');
  const k = google.durum.kayitlar.get(id);
  assert.equal(k.extendedProperties.private.durum, 'gorusuldu');
  assert.equal(k.extendedProperties.private.crmFirma, 'f1', 'özel alanlar korunur');
  assert.match(k.description, /Görüşme notu:\nFiyat istedi$/);
  const yazma = crm.durum.istekler.filter((x) => x.yol === '/api/toplanti').pop();
  assert.deepEqual({ islem: yazma.govde.islem, not: yazma.govde.not, firmaId: yazma.govde.firmaId }, { islem: 'gorustuk', not: 'Fiyat istedi', firmaId: 'f1' });
  assert.equal((await api('/api/toplanti')).v.toplantilar[0].durum, 'gorusuldu');
});

test('başkasının etkinliği ertelenemez/iptal edilemez (403)', async () => {
  google.durum.kayitlar.set('dis2', {
    id: 'dis2', status: 'confirmed', organizer: { email: 'baska@ornek.com' }, summary: 'Dış',
    attendees: [{ email: 'ben@ornek.com', self: true }, { email: 'o@ornek.com' }],
    start: { dateTime: yarin(18) }, end: { dateTime: yarin(19) }
  });
  assert.equal((await api('/api/toplanti/ertele', { id: 'dis2', bas: yarin(20) })).durum, 403);
  assert.equal((await api('/api/toplanti/iptal', { id: 'dis2' })).durum, 403);
  assert.ok(google.durum.kayitlar.has('dis2'));
  // Google yeni silinmiş etkinliği "cancelled" diye döndürür: ertelenmez, listede görünmez
  google.durum.kayitlar.set('sil1', { id: 'sil1', status: 'cancelled', organizer: { self: true }, extendedProperties: { private: { kart: 'toplanti', ad: 'X' } }, start: { dateTime: yarin(9) }, end: { dateTime: yarin(10) } });
  assert.equal((await api('/api/toplanti/ertele', { id: 'sil1', bas: yarin(11) })).durum, 404);
  assert.ok(!(await api('/api/toplanti')).v.toplantilar.some((t) => t.id === 'sil1'));
});

/* ---------- CRM durumları ---------- */

test('★ CRM kapalıyken: toplantı yine açılır, CRM\'e istek gitmez, arama boş döner', async () => {
  crmKopar();
  const c = await api('/api/toplanti/olustur', { ...KISI, bas: yarin(10) });
  assert.equal(c.durum, 200);
  assert.deepEqual(c.v.crm, { durum: 'kapali' });
  assert.equal(c.v.toplanti.crm, null);
  const a = await api('/api/toplanti/ara', { q: 'ayşe' });
  assert.deepEqual(a.v, { crm: false, sonuclar: [] });
  assert.equal((await api('/api/toplanti')).v.crm, false);
  assert.equal((await api('/api/toplanti/gorustuk', { id: c.v.toplanti.id, not: 'x' })).v.crm.durum, 'kapali');
  assert.equal((await api('/api/toplanti/crm', { id: c.v.toplanti.id })).durum, 503);
  assert.equal(crm.durum.istekler.length, 0);
});

test('CRM hata verirse ya da ulaşılamazsa toplantı bozulmaz: crm "hata"', async () => {
  crm.durum.hata = true;
  const c = await api('/api/toplanti/olustur', { ...KISI, bas: yarin(10) });
  assert.equal(c.durum, 200);
  assert.equal(c.v.crm.durum, 'hata');
  assert.equal(google.durum.etkinlikler.length, 1);
  process.env.NEXUS_CRM_URL = 'http://127.0.0.1:9';   // kapalı kapı
  const d = await api('/api/toplanti/olustur', { ...KISI, bas: yarin(11) });
  assert.equal(d.durum, 200);
  assert.equal(d.v.crm.durum, 'hata');
  crmBagla();
  process.env.NEXUS_CRM_TOKEN = 'yanlis-jeton';
  const j = await api('/api/toplanti/olustur', { ...KISI, bas: yarin(12) });
  assert.equal(j.v.crm.durum, 'hata', 'jeton reddi de hata');
});

test('★ CRM belirsiz: adaylar döner, kullanıcı birini seçince aynı toplantı o firmaya yazılır', async () => {
  crm.durum.yanitla = (g) => (g.islem === 'planla' && !g.firmaId
    ? { kod: 409, govde: { ok: false, hata: 'belirsiz-firma', adaylar: [{ firmaId: 'fa', ad: 'A Büro', yol: '/firma/fa' }, { firmaId: 'fb', ad: 'B Büro', yol: '/firma/fb' }] } }
    : null);
  const c = await api('/api/toplanti/olustur', { ad: 'Ortak', telefon: '05331112233', bas: yarin(10) });
  assert.equal(c.durum, 200);
  assert.deepEqual(c.v.crm, { durum: 'belirsiz', adaylar: [
    { firmaId: 'fa', ad: 'A Büro', adres: crm.kok + '/firma/fa' },
    { firmaId: 'fb', ad: 'B Büro', adres: crm.kok + '/firma/fb' }] });
  assert.equal(c.v.toplanti.crm, null);

  const b = await api('/api/toplanti/crm', { id: c.v.toplanti.id, firmaId: 'fb' });
  assert.equal(b.durum, 200);
  assert.equal(b.v.crm.durum, 'yazildi');
  assert.equal(b.v.toplanti.crm.firmaId, 'fb');
  const son = crm.durum.istekler.filter((x) => x.yol === '/api/toplanti').pop();
  assert.equal(son.govde.firmaId, 'fb');
  assert.equal(son.govde.etkinlikId, c.v.toplanti.id);
  assert.equal(google.durum.kayitlar.get(c.v.toplanti.id).extendedProperties.private.crmFirma, 'fb');
});

test('★ kişi arama CRM üzerinden: sorgu adreste DEĞİL gövdede gider, sonuçta CRM kartı adresi', async () => {
  const a = await api('/api/toplanti/ara', { q: 'ayşe' });
  assert.equal(a.durum, 200);
  assert.equal(a.v.crm, true);
  assert.equal(a.v.sonuclar[0].kisi, 'Ayşe Yılmaz');
  assert.equal(a.v.sonuclar[0].adres, crm.kok + '/firma/f1');
  const i = crm.durum.istekler.find((x) => x.yol === '/api/toplanti/ara');
  assert.equal(i.url, '/api/toplanti/ara', 'adres satırında kişi verisi yok');
  assert.equal(i.govde.q, 'ayşe');
  assert.equal((await api('/api/toplanti/ara', { q: '41 90' })).v.sonuclar[0].firma, 'Sentez Ofis');
  assert.deepEqual((await api('/api/toplanti/ara', { q: 'a' })).v.sonuclar, []);
});

/* ---------- iOS Kestirmeler taslağı ---------- */

test('★ taslak: kestirme anahtarıyla açılır, adreste yalnız kimlik; sayfa bir kez okur', async () => {
  const t = await ham('/api/toplanti/taslak', {
    yontem: 'POST', basliklar: { ...JSONB, Authorization: 'Bearer ' + KISAYOL, Host: 'naim.ornek.test' },
    govde: JSON.stringify({ ad: 'Zeynep Ak', telefon: '+90 (542) 999 88 77\n0212 000 00 00', eposta: 'Zeynep@Ak.com' })
  });
  assert.equal(t.durum, 200, t.metin);
  assert.match(t.v.id, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(t.v.adres, `https://naim.ornek.test/toplanti/#t-${t.v.id}`);
  assert.ok(!/zeynep|542/i.test(t.v.adres), 'kişi verisi adreste yok');

  const a = await api('/api/toplanti/taslak-al', { id: t.v.id });
  assert.equal(a.durum, 200);
  assert.deepEqual(a.v.taslak, { ad: 'Zeynep Ak', firma: '', telefon: '+90 (542) 999 88 77', eposta: 'zeynep@ak.com' });
  assert.equal((await api('/api/toplanti/taslak-al', { id: t.v.id })).durum, 404, 'tek kullanımlık');
  assert.equal((await api('/api/toplanti/taslak-al', { id: '../../x' })).durum, 404);
});

test('taslak: anahtarsız ya da yanlış anahtarla 401; boş kişi 400; anahtar tanımsızsa yalnız oturum açar', async () => {
  const gonder = (yetki, govde = { ad: 'X' }) => ham('/api/toplanti/taslak', {
    yontem: 'POST', basliklar: { ...JSONB, ...(yetki ? { Authorization: yetki } : {}) }, govde: JSON.stringify(govde)
  });
  assert.equal((await gonder(null)).durum, 401);
  assert.equal((await gonder('Bearer yanlis-anahtar-0123456789abcdef')).durum, 401);
  assert.equal((await gonder('Bearer ' + KISAYOL, {})).durum, 400);
  delete process.env.TOPLANTI_ANAHTAR;
  try {
    assert.equal((await gonder('Bearer ' + KISAYOL)).durum, 401);
    assert.equal((await api('/api/toplanti/taslak', { ad: 'X' })).durum, 200);
  } finally { process.env.TOPLANTI_ANAHTAR = KISAYOL; }
});

/* ---------- kartın randevu formu → CRM ---------- */

test('★ ziyaretçi randevusu CRM\'e de yazılır (kaynak kart, çözüm → ürün), firma etkinliğe işlenir', async () => {
  const slot = (await ham('/api/musait')).v.gunler[0].slotlar[0].bas;
  const r = await ham('/api/randevu', {
    yontem: 'POST', basliklar: JSONB,
    govde: JSON.stringify({ ad: 'Ayşe Yılmaz', firma: 'Kobas Büro', telefon: '0532 000 00 01', cozum: 'Nextus Servis', baslangic: slot })
  });
  assert.equal(r.durum, 200);
  assert.ok(await bekle(() => google.durum.islemler.some((i) => i.yontem === 'PATCH')), 'CRM firması etkinliğe işlenmedi');
  const y = crm.durum.istekler.find((i) => i.yol === '/api/toplanti');
  assert.equal(y.govde.islem, 'planla');
  assert.equal(y.govde.kaynak, 'kart');
  assert.equal(y.govde.urun, 'nexus-servis');
  assert.equal(y.govde.not, 'İlgilendiği çözüm: Nextus Servis');
  const [id] = [...google.durum.kayitlar.keys()];
  const e = google.durum.kayitlar.get(id);
  assert.equal(e.extendedProperties.private.kart, 'randevu');
  assert.equal(e.extendedProperties.private.crmFirma, 'f1');
  const l = (await api('/api/toplanti')).v.toplantilar;
  assert.equal(l[0].kaynak, 'randevu');
  assert.equal(l[0].crm.adres, crm.kok + '/firma/f1');
});

test('★ CRM düşükken ya da kapalıyken ziyaretçi randevusu bozulmaz', async () => {
  crm.durum.hata = true;
  const slot = (await ham('/api/musait')).v.gunler[0].slotlar[0].bas;
  const r = await ham('/api/randevu', { yontem: 'POST', basliklar: JSONB, govde: JSON.stringify({ ad: 'A', firma: 'B', telefon: '0532 111 11 11', baslangic: slot }) });
  assert.equal(r.durum, 200);
  assert.equal(r.v.tamam, true);
  crmKopar();
  const slot2 = (await ham('/api/musait')).v.gunler[0].slotlar[1].bas;
  const r2 = await ham('/api/randevu', { yontem: 'POST', basliklar: JSONB, govde: JSON.stringify({ ad: 'A', firma: 'B', telefon: '0532 111 11 11', baslangic: slot2 }) });
  assert.equal(r2.durum, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(google.durum.islemler.length, 0, 'CRM yazılmadıysa etkinliğe firma işlenmez');
});

/* ---------- WhatsApp metinleri (sunucu ve sayfa aynı dosya) ---------- */

test('WhatsApp: numara tek biçime iner, metin İstanbul saatiyle; randevu linki metni', () => {
  assert.equal(waNumara('0532 000 00 01'), '905320000001');
  assert.equal(waNumara('+90 (532) 000 00 01'), '905320000001');
  assert.equal(waNumara('5320000001'), '905320000001');
  assert.equal(waNumara('0044 20 7946 0958'), '442079460958');
  assert.equal(waNumara('123'), null);
  assert.equal(zamanMetni('2026-11-12T11:00:00.000Z'), '12 Kasım Perşembe, 14:00');
  const m = mesaj('randevu', { kisi: { ad: 'Ayşe Yılmaz' } }, { randevuAdresi: 'https://naim.ornek.test/#randevu' });
  assert.equal(m, 'Merhaba Ayşe,\nsize uygun bir görüşme saatini buradan seçebilirsiniz:\nhttps://naim.ornek.test/#randevu\n\nMehmet Naim Çetin');
  assert.equal(waLinki(null, 'a b'), 'https://wa.me/?text=a%20b');
});

test('kartın randevu bölümü #randevu ile doğrudan açılır (gönderilen linkin hedefi)', () => {
  const js = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'kart.js'), 'utf8');
  assert.ok(js.includes("location.hash === '#randevu'"));
});

test('★ DeepCore ← CRM: bugünkü işlerim okunur, kişi verisi yok, adres CRM köküne bağlı; CRM yoksa kapalı', async () => {
  crmBagla();
  const r = await api('/api/toplanti/isler');
  assert.equal(r.durum, 200);
  assert.equal(r.v.durum, 'tamam');
  assert.equal(r.v.isler.length, 4);
  const takip = r.v.isler.find((i) => i.tur === 'takip');
  assert.equal(takip.gecikti, true);
  assert.equal(takip.adres, crm.kok + '/firma/k1');
  assert.equal(r.v.isler[0].adres, crm.kok + '/merkez/benim');
  const istek = crm.durum.istekler.find((i) => i.yol === '/api/deepcore');
  assert.deepEqual(istek.govde, { kisi: 'Mehmet Naim' });

  assert.equal((await ham('/api/toplanti/isler')).durum, 401);
  crmKopar();
  assert.equal((await api('/api/toplanti/isler')).v.durum, 'kapali');
  crmBagla();
});
