/* Günün dersi — naim.nextusservis.com/ders
   Bilgisayardaki gece hattı (C:\Projeler\nextus-ders) seçtiği videoları buraya yükler; burada
   günde birkaç tanesi izlenir, her biri tek satırlık bir uygulamaya döner ve plana iş olarak düşer.
   /plan ile aynı giriş. Akış yok, öneri yok: günün dersleri bitince liste biter.

   Ortam:
     DERS_GUNLUK   günde kaç ders (varsayılan 3, en çok 10)
     PLAN_VERI     veri klasörü: ders.json + ders/<kimlik>.mp4
     PLAN_ANAHTAR  bilgisayarın yükleme anahtarı (yukle, geri, video yükleme yalnız bununla)
     KAFA_ANAHTAR  iPhone "Instagram açıldığında" otomasyonu /api/ders/kapi'yi bununla sorar

   Videolar yalnız girişli sahibine akar; kişisel izleme içindir, paylaşılmaz. */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  planKurulduMu, planYetkili, kokenUyarMi, anahtarEsit, istanbulBugun,
  planaIsEkle, planGorevDurumlari, planOdakta, planKafaYetkili, planKafaKuruluMu
} from './plan.mjs';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

const KIMLIK = /^[A-Za-z0-9_-]{3,40}$/;
const ISLEM_SINIRI = 16 * 1024;
const YUKLEME_SINIRI = 4 * 1024 * 1024;
const VIDEO_SINIRI = 40 * 1024 * 1024;
const TEKRAR_GUNLERI = [3, 10];
const TEKRAR_GUNLUK = 3;
const VIDEO_SAKLAMA_GUN = 7;
const DERS_SINIRI = 5000;

export function dersGovdeSiniri(yol) { return yol === '/api/ders/yukle' ? YUKLEME_SINIRI : ISLEM_SINIRI; }

class DersHatasi extends Error {
  constructor(durum, sebep) { super(sebep); this.durum = durum; this.sebep = sebep; }
}

/* ======================= depolama ======================= */

let bellek = null;                 // { klasor, dosya, durum }
let zincir = Promise.resolve();

/** Testler için: yeniden başlatmayı taklit eder. */
export function dersBelleginiSifirla() { bellek = null; zincir = Promise.resolve(); }

function veriKlasoru() { return path.resolve(process.env.PLAN_VERI || path.join(BURASI, '..', 'veri')); }
const videoYolu = (klasor, id) => path.join(klasor, 'ders', id + '.mp4');

function gunluk() {
  const n = Number(process.env.DERS_GUNLUK);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 3;
}

function yukle() {
  const klasor = veriKlasoru();
  if (bellek && bellek.klasor === klasor) return bellek;
  fs.mkdirSync(path.join(klasor, 'ders'), { recursive: true });
  const dosya = path.join(klasor, 'ders.json');
  let durum = { surum: 1, dersler: [], istekler: [] };
  if (fs.existsSync(dosya)) {
    try {
      const v = JSON.parse(fs.readFileSync(dosya, 'utf8'));
      durum.dersler = Array.isArray(v.dersler) ? v.dersler.filter((x) => x && typeof x.id === 'string' && KIMLIK.test(x.id)) : [];
      durum.istekler = Array.isArray(v.istekler) ? v.istekler.filter((x) => x && typeof x.konu === 'string').slice(-50) : [];
    } catch (h) {
      console.error('[ders] veri dosyası bozuk, saklandı:', String(h && h.message).slice(0, 120));
      try { fs.renameSync(dosya, path.join(klasor, `ders.bozuk-${Date.now()}.json`)); } catch { /* yoksay */ }
    }
  }
  bellek = { klasor, dosya, durum };
  return bellek;
}

/** Oku-değiştir-yaz sıralı ve atomik. Hiçbir şey değişmediyse diske dokunulmaz. */
function degistir(fn) {
  const is = zincir.then(async () => {
    const b = yukle();
    const once = JSON.stringify(b.durum);
    const kopya = JSON.parse(once);
    const sonuc = await fn(kopya, b);
    const sonra = JSON.stringify(kopya);
    if (sonra !== once) {
      await fsp.writeFile(b.dosya + '.gecici', sonra, 'utf8');
      await fsp.rename(b.dosya + '.gecici', b.dosya);
      b.durum = kopya;
    }
    return sonuc;
  });
  zincir = is.catch(() => {});
  return is;
}

/* ======================= yardımcılar ======================= */

function gunEkle(gun, n) {
  const d = new Date(gun + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** İstanbul'da bu haftanın pazartesi 00:00'ı (ISO, UTC). */
function haftaBasi(bugun) {
  const g = new Date(bugun + 'T12:00:00Z').getUTCDay();          // 0 = pazar
  return new Date(Date.parse(gunEkle(bugun, -((g + 6) % 7)) + 'T00:00:00Z') - 3 * 3600e3).toISOString();
}

const kisa = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const sayi = (v, alt, ust) => { const n = Number(v); return Number.isFinite(n) ? Math.min(ust, Math.max(alt, n)) : 0; };

/** Arama için: Türkçe küçült, sonra harfleri sadeleştir ("İŞ" = "is"). */
function sade(s) {
  return String(s || '').toLocaleLowerCase('tr-TR')
    .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİ]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function dersTemizle(v) {
  if (!v || typeof v.id !== 'string' || !KIMLIK.test(v.id)) return null;
  const baslik = kisa(v.baslik, 200);
  if (!baslik) return null;
  const url = kisa(v.url, 500);
  return {
    id: v.id, hesap: kisa(v.hesap, 60), url: /^https:\/\/[^\s]+$/.test(url) ? url : '',
    baslik, konu: kisa(v.konu, 60),
    ozet: Array.isArray(v.ozet) ? v.ozet.map((x) => kisa(x, 400)).filter(Boolean).slice(0, 5) : [],
    uygulama: kisa(v.uygulama, 300), soru: kisa(v.soru, 300),
    metin: typeof v.metin === 'string' ? v.metin.slice(0, 20000) : '',
    puan: sayi(v.puan, 0, 10), kat: sayi(v.kat, 0, 10000), sure: Math.round(sayi(v.sure, 0, 7200)),
    sira: sayi(v.sira, 0, 1e6), arsiv: v.arsiv === true
  };
}

const izlenebilir = (x) => x.video && !x.arsiv && !x.bitti;

/** Bugünün derslerini seçer: dünden yarım kalan havuza döner, en yüksek sıradakiler alınır,
    aynı hesaptan günde bir tane (stok yetmezse bu kural gevşer). */
function gunuKur(d, bugun) {
  for (const x of d.dersler) if (x.gun && x.gun < bugun && !x.bitti) { x.gun = null; delete x.gunSira; }
  const bugunku = d.dersler.filter((x) => x.gun === bugun);
  const hesaplar = new Set(bugunku.map((x) => x.hesap));
  const adaylar = d.dersler.filter((x) => !x.gun && izlenebilir(x))
    .sort((a, b) => b.sira - a.sira || String(a.eklendi).localeCompare(String(b.eklendi)));
  for (const tekHesap of [true, false]) {
    for (const a of adaylar) {
      if (bugunku.length >= gunluk()) break;
      if (a.gun || (tekHesap && hesaplar.has(a.hesap))) continue;
      a.gun = bugun; a.gunSira = bugunku.length;
      bugunku.push(a); hesaplar.add(a.hesap);
    }
  }
  return bugunku.sort((a, b) => (a.gunSira ?? 0) - (b.gunSira ?? 0));
}

function gorunum(x) {
  return {
    id: x.id, hesap: x.hesap, url: x.url, baslik: x.baslik, konu: x.konu, ozet: x.ozet,
    uygulama: x.uygulama, soru: x.soru, sure: x.sure, video: Boolean(x.video),
    bitti: Boolean(x.bitti), yaradi: x.yaradi ?? null, uygulamam: x.uygulamam || ''
  };
}

/** İzlenmiş dersin video dosyası bir hafta sonra silinir; kartı arşivde kalır. */
async function eskiVideolariSil(d, klasor, bugun) {
  const sinir = gunEkle(bugun, -VIDEO_SAKLAMA_GUN);
  for (const x of d.dersler) {
    if (x.video && x.bitti && x.bitti.slice(0, 10) < sinir) {
      await fsp.unlink(videoYolu(klasor, x.id)).catch(() => {});
      x.video = false;
    }
  }
}

/* ======================= uçlar ======================= */

async function bugun() {
  const gun = istanbulBugun();
  const v = await degistir(async (d, b) => {
    await eskiVideolariSil(d, b.klasor, gun);
    const dersler = gunuKur(d, gun);
    const tekrarlar = d.dersler
      .filter((x) => x.bitti && x.yaradi !== false && x.soru && (x.tekrar || []).some((t) => !t.tamam && t.gun <= gun))
      .slice(0, TEKRAR_GUNLUK)
      .map((x) => ({ id: x.id, baslik: x.baslik, hesap: x.hesap, soru: x.soru, ozet: x.ozet, uygulamam: x.uygulamam || '' }));
    return {
      gunluk: gunluk(), dersler: dersler.map(gorunum), tekrarlar,
      stok: d.dersler.filter((x) => izlenebilir(x) && !x.gun).length,
      isler: d.dersler.filter((x) => x.gorevId).map((x) => x.gorevId)
    };
  });
  const durumlar = await planGorevDurumlari(v.isler);
  const bas = haftaBasi(gun);
  const hafta = Object.values(durumlar).filter((z) => z && z >= bas).length;
  delete v.isler;
  return cevap(200, { ...v, hafta });
}

/** Sabah mesajı için: bugün izlenecek ders sayısı (seçimi de yapar). */
export async function dersBugunSayisi() {
  if (!planKurulduMu()) return 0;
  try {
    const gun = istanbulBugun();
    return await degistir((d) => gunuKur(d, gun).filter((x) => !x.bitti).length);
  } catch { return 0; }
}

async function bitir(ctx) {
  const v = jsonGovde(ctx);
  if (typeof v.id !== 'string' || !KIMLIK.test(v.id)) throw new DersHatasi(400, 'id');
  const yaradi = v.yaradi !== false;
  const uygulamam = kisa(v.uygulama, 300);
  // İşe yarayan ders bir uygulamaya dönmeden bitmez; yaramayan için cümle istenmez.
  if (yaradi && !uygulamam) throw new DersHatasi(400, 'uygulama');
  const gun = istanbulBugun();

  const once = await degistir((d) => {
    const x = d.dersler.find((y) => y.id === v.id);
    if (!x) throw new DersHatasi(404, 'ders');
    if (x.bitti) return { zaten: true };
    x.bitti = new Date().toISOString();
    x.yaradi = yaradi;
    x.uygulamam = yaradi ? uygulamam : '';
    x.tekrar = yaradi ? TEKRAR_GUNLERI.map((n) => ({ gun: gunEkle(gun, n), tamam: false })) : [];
    return { baslik: x.baslik, hesap: x.hesap };
  });
  if (once.zaten) return cevap(200, { tamam: true, zaten: true });

  let gorevId = null;
  if (yaradi) {
    gorevId = await planaIsEkle(uygulamam, `Günün dersi: ${once.baslik}${once.hesap ? ' (@' + once.hesap + ')' : ''}`);
    await degistir((d) => { const x = d.dersler.find((y) => y.id === v.id); if (x) x.gorevId = gorevId; });
  }
  return cevap(200, { tamam: true, gorevId });
}

async function tekrar(ctx) {
  const v = jsonGovde(ctx);
  const gun = istanbulBugun();
  await degistir((d) => {
    const x = d.dersler.find((y) => y.id === v.id);
    if (!x) throw new DersHatasi(404, 'ders');
    const t = (x.tekrar || []).find((z) => !z.tamam && z.gun <= gun);
    if (t) t.tamam = true;
  });
  return cevap(200, { tamam: true });
}

async function ara(ctx) {
  const v = jsonGovde(ctx);
  const kelimeler = sade(kisa(v.q, 100)).split(' ').filter((k) => k.length >= 2).slice(0, 6);
  if (!kelimeler.length) return cevap(200, { sonuclar: [] });
  await zincir;
  const sonuclar = yukle().durum.dersler
    .map((x) => {
      const ust = sade([x.baslik, x.konu, x.hesap, ...(x.ozet || []), x.uygulama].join(' '));
      const alt = sade(x.metin);
      if (!kelimeler.every((k) => ust.includes(k) || alt.includes(k))) return null;
      return { x, guc: kelimeler.filter((k) => ust.includes(k)).length };
    })
    .filter(Boolean)
    .sort((a, b) => b.guc - a.guc || b.x.puan - a.x.puan)
    .slice(0, 20)
    .map(({ x }) => gorunum(x));
  return cevap(200, { sonuclar });
}

/** "Şunu arıyorum": gece seçiminde bu konu öne alınır. */
async function istekEkle(ctx) {
  const konu = kisa(jsonGovde(ctx).konu, 100);
  if (!konu) throw new DersHatasi(400, 'konu');
  await degistir((d) => {
    d.istekler = d.istekler.filter((i) => sade(i.konu) !== sade(konu)).concat({ konu, zaman: new Date().toISOString() }).slice(-20);
  });
  return cevap(200, { tamam: true });
}

/** Bilgisayardan gelen ders kartları. Var olan kartın içeriği güncellenir, izlenme durumu korunur. */
async function kartYukle(ctx) {
  const v = jsonGovde(ctx);
  if (!Array.isArray(v.dersler) || v.dersler.length > 500) throw new DersHatasi(400, 'dersler');
  const temiz = v.dersler.map(dersTemizle).filter(Boolean);
  const ozet = await degistir((d) => {
    let eklenen = 0, guncellenen = 0;
    for (const t of temiz) {
      const var_ = d.dersler.find((x) => x.id === t.id);
      if (var_) { Object.assign(var_, t); guncellenen++; }
      else if (d.dersler.length < DERS_SINIRI) {
        d.dersler.push({ ...t, video: false, gun: null, bitti: null, yaradi: null, uygulamam: '', gorevId: null, tekrar: [], eklendi: new Date().toISOString() });
        eklenen++;
      }
    }
    return { eklenen, guncellenen, atlanan: v.dersler.length - temiz.length };
  });
  return cevap(200, { tamam: true, ...ozet });
}

/** Bilgisayar gece seçiminden önce bunu okur: stok, bilinen kimlikler, geri bildirim, istekler. */
async function geri() {
  await zincir;
  const d = yukle().durum;
  return cevap(200, {
    gunluk: gunluk(),
    stok: d.dersler.filter(izlenebilir).length,
    bilinen: d.dersler.map((x) => x.id),
    videosuz: d.dersler.filter((x) => !x.video && !x.arsiv && !x.bitti).map((x) => x.id),
    geri: d.dersler.filter((x) => x.bitti && x.yaradi !== null).map((x) => ({ hesap: x.hesap, konu: x.konu, yaradi: x.yaradi })),
    istekler: d.istekler.map((i) => i.konu)
  });
}

/** iPhone "Instagram açıldığında" otomasyonu sorar. Düz metin: "hayir" ya da açılacak adres.
    Derin odak sürüyorsa plan, bugünün dersi bitmediyse ders sayfası. */
async function kapi(ctx) {
  if (!planKafaYetkili(ctx.basliklar) && !planYetkili(ctx.basliklar)) {
    return cevap(planKafaKuruluMu() ? 401 : 503, { sebep: planKafaKuruluMu() ? 'anahtar' : 'kapali' });
  }
  const kok = String(process.env.KART_ADRESI || 'https://naim.nextusservis.com').trim().replace(/\/+$/, '');
  let govde = 'hayir';
  if (await planOdakta()) govde = kok + '/plan/';
  else if (await dersBugunSayisi()) govde = kok + '/ders/';
  return { durum: 200, basliklar: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, govde };
}

/* ======================= video (akış; sunucu.mjs doğrudan çağırır) ======================= */

function makineMi(basliklar) {
  const k = String(process.env.PLAN_ANAHTAR || '');
  const yetki = String(basliklar.authorization || '');
  return k.length >= 24 && /^Bearer\s+/i.test(yetki) && anahtarEsit(yetki.replace(/^Bearer\s+/i, '').trim(), k);
}

/** GET: girişli sahibine dosya yolunu, değilse durum kodunu döndürür. */
export function dersVideoDosyasi(basliklar, id) {
  if (!planKurulduMu()) return 503;
  if (!planYetkili(basliklar)) return 401;
  if (!KIMLIK.test(id)) return 404;
  const dosya = videoYolu(veriKlasoru(), id);
  return fs.existsSync(dosya) ? dosya : 404;
}

/** POST: bilgisayardan gelen mp4 belleğe alınmadan dosyaya akar. [durum, veri] döndürür. */
export async function dersVideoAl(istek, id) {
  if (!planKurulduMu()) return [503, { sebep: 'kurulmadi' }];
  if (!makineMi(istek.headers)) return [401, { sebep: 'anahtar' }];
  if (!KIMLIK.test(id)) return [400, { sebep: 'id' }];
  await zincir;
  const b = yukle();
  if (!b.durum.dersler.some((x) => x.id === id)) return [404, { sebep: 'ders' }];

  const hedef = videoYolu(b.klasor, id);
  const gecici = hedef + '.gecici';
  let boy = 0;
  try {
    await pipeline(istek, async function* (kaynak) {
      for await (const p of kaynak) {
        boy += p.length;
        if (boy > VIDEO_SINIRI) throw Object.assign(new Error('buyuk'), { durum: 413 });
        yield p;
      }
    }, fs.createWriteStream(gecici));
    // mp4 mü? Kutunun 4-8. baytları "ftyp" olur.
    const bas = Buffer.alloc(12);
    const f = await fsp.open(gecici, 'r');
    await f.read(bas, 0, 12, 0);
    await f.close();
    if (boy < 1024 || bas.toString('latin1', 4, 8) !== 'ftyp') throw Object.assign(new Error('tur'), { durum: 415 });
    await fsp.rename(gecici, hedef);
  } catch (h) {
    await fsp.unlink(gecici).catch(() => {});
    if (h && h.durum) return [h.durum, { sebep: h.message }];
    throw h;
  }
  await degistir((d) => { const x = d.dersler.find((y) => y.id === id); if (x) x.video = true; });
  return [200, { tamam: true, boy }];
}

/* ======================= HTTP ======================= */

function cevap(durum, veri) {
  return { durum, basliklar: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, govde: JSON.stringify(veri) };
}

function jsonGovde(ctx) {
  if (!ctx.govde || !ctx.govde.length) return {};
  let v;
  try { v = JSON.parse(ctx.govde.toString('utf8')); } catch { throw new DersHatasi(400, 'json'); }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// [yöntem, işleyici, kim]: 'sahip' = oturum ya da makine anahtarı · 'makine' = yalnız PLAN_ANAHTAR · 'kapi' = kendi denetimi
const ROTALAR = {
  '/api/ders/bugun': ['GET', bugun, 'sahip'],
  '/api/ders/bitir': ['POST', bitir, 'sahip'],
  '/api/ders/tekrar': ['POST', tekrar, 'sahip'],
  '/api/ders/ara': ['POST', ara, 'sahip'],
  '/api/ders/istek': ['POST', istekEkle, 'sahip'],
  '/api/ders/yukle': ['POST', kartYukle, 'makine'],
  '/api/ders/geri': ['GET', geri, 'makine'],
  '/api/ders/kapi': ['GET', kapi, 'kapi']
};

const DEPOLAMA_HATALARI = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'ENOSPC', 'EISDIR']);

/** @param {{ yontem: string, yol: string, basliklar: Record<string,string>, govde?: Buffer, ip: string }} ctx */
export async function dersIstegi(ctx) {
  if (!planKurulduMu()) return cevap(503, { sebep: 'kurulmadi' });
  if (ctx.yontem === 'POST') {
    if (!String(ctx.basliklar['content-type'] || '').toLowerCase().startsWith('application/json')) return cevap(415, { sebep: 'tur' });
    if (ctx.basliklar.origin && !kokenUyarMi(ctx.basliklar.origin, ctx.basliklar)) return cevap(403, { sebep: 'koken' });
  }
  try {
    const rota = ROTALAR[ctx.yol];
    if (!rota) return cevap(404, { sebep: 'yok' });
    if (ctx.yontem !== rota[0]) return cevap(405, { sebep: 'yontem' });
    if (rota[2] === 'sahip' && !planYetkili(ctx.basliklar)) return cevap(401, { sebep: 'oturum' });
    if (rota[2] === 'makine' && !makineMi(ctx.basliklar)) return cevap(401, { sebep: 'anahtar' });
    return await rota[1](ctx);
  } catch (h) {
    if (h instanceof DersHatasi) return cevap(h.durum, { sebep: h.sebep });
    if (h && h.durum && h.sebep) return cevap(h.durum, { sebep: h.sebep });     // plan.mjs'ten gelen (ör. depolama)
    if (h && DEPOLAMA_HATALARI.has(h.code)) {
      console.error('[ders] depolama:', h.code);
      bellek = null;
      return cevap(503, { sebep: 'depolama' });
    }
    throw h;
  }
}
