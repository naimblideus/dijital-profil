/* Günün dersi — node --test test/ders.test.mjs
   Gerçek sunucu açılır, veri geçici klasöre yazılır. Video olarak mp4 başlıklı küçük bir tampon kullanılır. */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sunucuOlustur } from '../sunucu/sunucu.mjs';
import { planBelleginiSifirla, istanbulBugun, oturumUret } from '../sunucu/plan.mjs';
import { dersBelleginiSifirla, dersBugunSayisi } from '../sunucu/ders.mjs';
import { sabahMetni } from '../sunucu/hatirlatici.mjs';

const SIFRE = 'deneme-sifre-123';
const ANAHTAR = 'makine-anahtari-0123456789abcdef';
const KAFA = 'kafa-anahtari-0123456789abcdefgh';
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(4000, 7)]);

let sunucu, adres, klasor;

before(async () => {
  klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'ders-test-'));
  sunucu = sunucuOlustur();
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  adres = `http://127.0.0.1:${sunucu.address().port}`;
});
after(async () => {
  await new Promise((r) => sunucu.close(r));
  fs.rmSync(klasor, { recursive: true, force: true });
});
beforeEach(() => {
  Object.assign(process.env, { PLAN_SIFRE: SIFRE, PLAN_ANAHTAR: ANAHTAR, PLAN_VERI: klasor, KAFA_ANAHTAR: KAFA, KART_ADRESI: 'https://ornek.test' });
  delete process.env.DERS_GUNLUK;
  for (const f of fs.readdirSync(klasor)) fs.rmSync(path.join(klasor, f), { recursive: true, force: true });
  planBelleginiSifirla();
  dersBelleginiSifirla();
});

function istek(yol, { yontem = 'GET', anahtar, cerez, govde, tur = 'application/json', basliklar = {} } = {}) {
  return new Promise((coz, reddet) => {
    const u = new URL(adres);
    const b = { ...basliklar };
    if (anahtar) b.Authorization = 'Bearer ' + anahtar;
    if (cerez) b.Cookie = 'plan_oturum=' + cerez;
    if (govde !== undefined) b['Content-Type'] = tur;
    const i = http.request({ host: u.hostname, port: u.port, path: yol, method: yontem, headers: b }, (c) => {
      const p = [];
      c.on('data', (x) => p.push(x));
      c.on('end', () => {
        const ham = Buffer.concat(p);
        let v = null;
        try { v = JSON.parse(ham.toString('utf8')); } catch { /* boş */ }
        coz({ durum: c.statusCode, v, ham, basliklar: c.headers });
      });
    });
    i.on('error', reddet);
    i.end(govde === undefined ? undefined : (Buffer.isBuffer(govde) || typeof govde === 'string' ? govde : JSON.stringify(govde)));
  });
}

const ders = (id, hesap, sira, ek = {}) => ({
  id, hesap, url: 'https://www.instagram.com/reel/' + id + '/', baslik: 'Başlık ' + id, konu: 'satış',
  ozet: ['Birinci madde', 'İkinci madde', 'Üçüncü madde'], uygulama: 'Bugünkü aramada dene', soru: id + ' neyi anlatıyordu?',
  metin: 'fiyat itirazı gelince önce değeri hatırlat', puan: 8, kat: 3, sure: 45, sira, ...ek
});

async function yukle(dersler, videolu = true) {
  const r = await istek('/api/ders/yukle', { yontem: 'POST', anahtar: ANAHTAR, govde: { dersler } });
  assert.equal(r.durum, 200);
  if (videolu) {
    for (const d of dersler) {
      if (d.arsiv) continue;
      const v = await istek('/api/ders/video/' + d.id, { yontem: 'POST', anahtar: ANAHTAR, govde: MP4, tur: 'video/mp4' });
      assert.equal(v.durum, 200, 'video ' + d.id);
    }
  }
  return r.v;
}
const bugun = () => istek('/api/ders/bugun', { anahtar: ANAHTAR });
const bitir = (v) => istek('/api/ders/bitir', { yontem: 'POST', anahtar: ANAHTAR, govde: v });
const plan = () => istek('/api/plan', { anahtar: ANAHTAR });

/** ders.json'u doğrudan değiştirir (gün atlatmak için). */
function diskte(fn) {
  const dosya = path.join(klasor, 'ders.json');
  const v = JSON.parse(fs.readFileSync(dosya, 'utf8'));
  fn(v);
  fs.writeFileSync(dosya, JSON.stringify(v));
  dersBelleginiSifirla();
}
function gunEkle(gun, n) { const d = new Date(gun + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

test('giriş yoksa hiçbir uç açılmaz; yükleme yalnız makine anahtarıyla', async () => {
  assert.equal((await istek('/api/ders/bugun')).durum, 401);
  assert.equal((await istek('/api/ders/video/abc123')).durum, 401);
  assert.equal((await istek('/api/ders/yukle', { yontem: 'POST', govde: { dersler: [] } })).durum, 401);
  // Oturum çerezi olan sahip bile kart yükleyemez: o iş bilgisayarın.
  const cerez = oturumUret(SIFRE);
  assert.equal((await istek('/api/ders/yukle', { yontem: 'POST', cerez, govde: { dersler: [] } })).durum, 401);
  assert.equal((await istek('/api/ders/geri', { cerez })).durum, 401);
  assert.equal((await istek('/api/ders/bugun', { cerez })).durum, 200);
  assert.equal((await istek('/api/ders/video/abc123', { yontem: 'POST', govde: MP4, tur: 'video/mp4' })).durum, 401);
});

test('günde 3 ders: en yüksek sıra, aynı hesaptan bir tane; videosuz ve arşiv kartı girmez', async () => {
  await yukle([ders('aaa1', 'hormozi', 90), ders('aaa2', 'hormozi', 80), ders('bbb1', 'danmartell', 70), ders('ccc1', 'garyvee', 60), ders('ddd1', 'leila', 50)]);
  await yukle([ders('vid0', 'codie', 99)], false);
  await yukle([ders('ars1', 'codie', 99, { arsiv: true })], false);
  const r = await bugun();
  assert.equal(r.durum, 200);
  assert.deepEqual(r.v.dersler.map((x) => x.id), ['aaa1', 'bbb1', 'ccc1']);
  assert.equal(r.v.stok, 2);
  assert.equal(r.v.dersler[0].metin, undefined, 'yazıya dökülen metin ekrana gönderilmez');
  // İkinci okuma aynı listeyi verir.
  assert.deepEqual((await bugun()).v.dersler.map((x) => x.id), ['aaa1', 'bbb1', 'ccc1']);
});

test('stok tek hesaptansa kural gevşer; DERS_GUNLUK sayıyı değiştirir', async () => {
  process.env.DERS_GUNLUK = '2';
  await yukle([ders('aaa1', 'hormozi', 90), ders('aaa2', 'hormozi', 80), ders('aaa3', 'hormozi', 70)]);
  assert.deepEqual((await bugun()).v.dersler.map((x) => x.id), ['aaa1', 'aaa2']);
});

test('uygulama satırı olmadan ders bitmez; yazılınca plana iş düşer', async () => {
  await yukle([ders('aaa1', 'hormozi', 90)]);
  await bugun();
  assert.equal((await bitir({ id: 'aaa1', uygulama: '   ' })).durum, 400);
  assert.equal((await bitir({ id: 'yok999', uygulama: 'x' })).durum, 404);
  const r = await bitir({ id: 'aaa1', uygulama: '  15:00 aramasında   önce değeri soracağım ' });
  assert.equal(r.durum, 200);
  const p = await plan();
  const is = p.v.gorevler.find((g) => g.id === r.v.gorevId);
  assert.equal(is.baslik, '15:00 aramasında önce değeri soracağım');
  assert.equal(is.gun, istanbulBugun());
  assert.equal(is.kaynak, 'ders');
  assert.match(is.not, /Günün dersi: Başlık aaa1 \(@hormozi\)/);
  // İkinci kez bitirmek ikinci iş açmaz.
  assert.equal((await bitir({ id: 'aaa1', uygulama: 'tekrar' })).v.zaten, true);
  assert.equal((await plan()).v.gorevler.length, 1);
  const b = await bugun();
  assert.equal(b.v.dersler[0].bitti, true);
});

test('"işime yaramadı" cümle istemez, plana iş düşmez, tekrar sorusu gelmez', async () => {
  await yukle([ders('aaa1', 'hormozi', 90)]);
  await bugun();
  assert.equal((await bitir({ id: 'aaa1', yaradi: false })).durum, 200);
  assert.equal((await plan()).v.gorevler.length, 0);
  diskte((v) => { v.dersler[0].tekrar = [{ gun: istanbulBugun(), tamam: false }]; });
  assert.equal((await bugun()).v.tekrarlar.length, 0);
  const g = await istek('/api/ders/geri', { anahtar: ANAHTAR });
  assert.deepEqual(g.v.geri, [{ hesap: 'hormozi', konu: 'satış', yaradi: false }]);
});

test('tek sayı: plandaki iş bitince "bu hafta uygulanan" artar', async () => {
  await yukle([ders('aaa1', 'hormozi', 90), ders('bbb1', 'danmartell', 80)]);
  await bugun();
  const r = await bitir({ id: 'aaa1', uygulama: 'Teklifte garantiyi öne al' });
  await bitir({ id: 'bbb1', uygulama: 'Sabah bloğunu koru' });
  assert.equal((await bugun()).v.hafta, 0);
  await istek('/api/plan/islem', { yontem: 'POST', anahtar: ANAHTAR, govde: { islem: 'isaretle', id: r.v.gorevId, bitti: true } });
  assert.equal((await bugun()).v.hafta, 1);
});

test('3. gün kontrol sorusu gelir, "tamam" denince 10. güne kalır', async () => {
  await yukle([ders('aaa1', 'hormozi', 90)]);
  await bugun();
  await bitir({ id: 'aaa1', uygulama: 'Dene' });
  assert.equal((await bugun()).v.tekrarlar.length, 0);
  const gun = istanbulBugun();
  diskte((v) => { assert.deepEqual(v.dersler[0].tekrar.map((t) => t.gun), [gunEkle(gun, 3), gunEkle(gun, 10)]); v.dersler[0].tekrar[0].gun = gun; });
  const b = await bugun();
  assert.equal(b.v.tekrarlar.length, 1);
  assert.equal(b.v.tekrarlar[0].soru, 'aaa1 neyi anlatıyordu?');
  assert.equal(b.v.tekrarlar[0].uygulamam, 'Dene');
  assert.equal((await istek('/api/ders/tekrar', { yontem: 'POST', anahtar: ANAHTAR, govde: { id: 'aaa1' } })).durum, 200);
  assert.equal((await bugun()).v.tekrarlar.length, 0);
});

test('dünden yarım kalan ders havuza döner; biten ders ertesi gün yeniden gelmez', async () => {
  await yukle([ders('aaa1', 'hormozi', 90), ders('bbb1', 'danmartell', 80), ders('ccc1', 'garyvee', 70), ders('ddd1', 'leila', 60)]);
  await bugun();
  await bitir({ id: 'aaa1', uygulama: 'Dene' });
  const dun = gunEkle(istanbulBugun(), -1);
  diskte((v) => { for (const x of v.dersler) if (x.gun) x.gun = dun; });
  assert.deepEqual((await bugun()).v.dersler.map((x) => x.id), ['bbb1', 'ccc1', 'ddd1']);
});

test('video: mp4 olmayan gövde reddedilir; sahibine parça parça akar', async () => {
  await yukle([ders('aaa1', 'hormozi', 90)], false);
  const kotu = await istek('/api/ders/video/aaa1', { yontem: 'POST', anahtar: ANAHTAR, govde: Buffer.alloc(5000, 1), tur: 'video/mp4' });
  assert.equal(kotu.durum, 415);
  assert.equal((await bugun()).v.dersler.length, 0, 'videosu olmayan ders günün dersine girmez');
  assert.equal((await istek('/api/ders/video/yok999', { yontem: 'POST', anahtar: ANAHTAR, govde: MP4, tur: 'video/mp4' })).durum, 404);
  assert.equal((await istek('/api/ders/video/aaa1', { yontem: 'POST', anahtar: ANAHTAR, govde: MP4, tur: 'video/mp4' })).durum, 200);
  const cerez = oturumUret(SIFRE);
  const tam = await istek('/api/ders/video/aaa1', { cerez });
  assert.equal(tam.durum, 200);
  assert.equal(tam.basliklar['content-type'], 'video/mp4');
  assert.equal(tam.ham.length, MP4.length);
  const parca = await istek('/api/ders/video/aaa1', { cerez, basliklar: { Range: 'bytes=4-11' } });
  assert.equal(parca.durum, 206);
  assert.equal(parca.ham.toString('latin1'), 'ftypisom');
  assert.equal((await istek('/api/ders/video/..%2Fplan', { cerez })).durum, 404);
});

test('izlenmiş dersin videosu bir hafta sonra silinir, kartı aramada kalır', async () => {
  await yukle([ders('aaa1', 'hormozi', 90)]);
  await bugun();
  await bitir({ id: 'aaa1', uygulama: 'Dene' });
  diskte((v) => { v.dersler[0].bitti = new Date(Date.now() - 9 * 86400e3).toISOString(); });
  await bugun();
  assert.equal(fs.existsSync(path.join(klasor, 'ders', 'aaa1.mp4')), false);
  const r = await istek('/api/ders/ara', { yontem: 'POST', anahtar: ANAHTAR, govde: { q: 'başlık aaa1' } });
  assert.equal(r.v.sonuclar.length, 1);
  assert.equal(r.v.sonuclar[0].video, false);
});

test('arama: Türkçe harf ve büyük-küçük fark etmez; yazıya dökülen metinde de arar', async () => {
  await yukle([ders('aaa1', 'hormozi', 90, { baslik: 'İtiraz karşılama', metin: 'müşteri pahalı derse' }), ders('ars1', 'garyvee', 1, { arsiv: true, baslik: 'İçerik ritmi', metin: '' })], false);
  const ara = (q) => istek('/api/ders/ara', { yontem: 'POST', anahtar: ANAHTAR, govde: { q } });
  assert.deepEqual((await ara('ITIRAZ')).v.sonuclar.map((x) => x.id), ['aaa1']);
  assert.deepEqual((await ara('pahali musteri')).v.sonuclar.map((x) => x.id), ['aaa1']);
  assert.deepEqual((await ara('icerik')).v.sonuclar.map((x) => x.id), ['ars1']);
  assert.deepEqual((await ara('olmayan konu')).v.sonuclar, []);
  await istek('/api/ders/istek', { yontem: 'POST', anahtar: ANAHTAR, govde: { konu: 'fiyat artırma' } });
  await istek('/api/ders/istek', { yontem: 'POST', anahtar: ANAHTAR, govde: { konu: 'Fiyat Artırma' } });
  assert.deepEqual((await istek('/api/ders/geri', { anahtar: ANAHTAR })).v.istekler, ['Fiyat Artırma']);
});

test('yeniden yükleme kartı günceller, izlenme durumunu korur', async () => {
  await yukle([ders('aaa1', 'hormozi', 90)]);
  await bugun();
  await bitir({ id: 'aaa1', uygulama: 'Dene' });
  const r = await yukle([ders('aaa1', 'hormozi', 95, { baslik: 'Yeni başlık' })], false);
  assert.deepEqual([r.eklenen, r.guncellenen], [0, 1]);
  const b = await bugun();
  assert.equal(b.v.dersler[0].baslik, 'Yeni başlık');
  assert.equal(b.v.dersler[0].bitti, true);
  const g = await istek('/api/ders/geri', { anahtar: ANAHTAR });
  assert.deepEqual(g.v.bilinen, ['aaa1']);
  assert.equal(g.v.stok, 0);
});

test('Instagram kapısı: ders bitmediyse ders adresi, odakta plan, yoksa "hayir"', async () => {
  const kapi = (anahtar = KAFA) => istek('/api/ders/kapi', { anahtar });
  assert.equal((await kapi('yanlis-anahtar-0123456789abcdefgh')).durum, 401);
  assert.equal((await kapi()).ham.toString(), 'hayir');
  await yukle([ders('aaa1', 'hormozi', 90)]);
  assert.equal((await kapi()).ham.toString(), 'https://ornek.test/ders/');
  await istek('/api/plan/islem', { yontem: 'POST', anahtar: ANAHTAR, govde: { islem: 'odak', bitis: new Date(Date.now() + 3600e3).toISOString(), baslik: 'Kod' } });
  assert.equal((await kapi()).ham.toString(), 'https://ornek.test/plan/');
  await istek('/api/plan/islem', { yontem: 'POST', anahtar: ANAHTAR, govde: { islem: 'odak', bitis: null } });
  await bitir({ id: 'aaa1', uygulama: 'Dene' });
  assert.equal((await kapi()).ham.toString(), 'hayir');
  // Kestirme anahtarı dersleri okuyamaz.
  assert.equal((await istek('/api/ders/bugun', { anahtar: KAFA })).durum, 401);
});

test('sabah mesajı: ders varsa tek satır eklenir', async () => {
  assert.doesNotMatch(sabahMetni([], [], 0), /dersi/);
  assert.match(sabahMetni([], [], 3), /Günün dersi: 3 kısa video hazır\./);
  await yukle([ders('aaa1', 'hormozi', 90), ders('bbb1', 'danmartell', 80)]);
  assert.equal(await dersBugunSayisi(), 2);
});

test('sayfa ve yönlendirme', async () => {
  const y = await istek('/ders');
  assert.equal(y.durum, 308);
  assert.equal(y.basliklar.location, '/ders/');
  const s = await istek('/ders/');
  assert.equal(s.durum, 200);
  assert.equal(s.basliklar['x-frame-options'], 'DENY');
  assert.match(s.ham.toString('utf8'), /Günün dersi/);
});
