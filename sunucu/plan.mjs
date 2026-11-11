/* DeepCore planı — naim.nextusservis.com/plan
   Tek kullanıcı. Veri sunucu diskinde durur, depoya ASLA girmez (depo herkese açık).

   Ortam:
     PLAN_SIFRE    giriş şifresi (en az 8 karakter). Yoksa plan KAPALIDIR (503) — şifresiz açılmaz.
     PLAN_ANAHTAR  yükleme betiğinin anahtarı (en az 24 karakter). Yoksa yükleme yalnız oturumla.
     PLAN_VERI     veri klasörü. Üretimde Coolify kalıcı birimi (/app/veri); değilse
                   her yeniden dağıtımda silinir — arayüz bunu "kalıcı değil" diye gösterir.
     KAFA_ANAHTAR  "Kafama at" kestirmesinin anahtarı (en az 24 karakter). Yalnız bugüne saatsiz
                   iş EKLER, hiçbir şey okuyamaz. Yoksa uç kapalıdır (503).

   Şifre değişirse tüm oturumlar düşer (imza anahtarı şifreden türer). */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { planAyristir, gorevSatiri, gecerliGun, anahtar } from './plan-ayristir.mjs';
import { istanbulParcalari } from './takvim.mjs';
import { aynala, aynaAcikMi } from './plan-takvim.mjs';
import { isleriCikar, akilAcikMi } from './akil.mjs';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

const OTURUM_ADI = 'plan_oturum';
const OTURUM_OMRU = 180 * 24 * 3600e3;          // telefon bir kez girer, yarım yıl hatırlar
const YEDEK_SAYISI = 30;

const DENEME_KISI = 8;                          // aynı adresten 15 dakikada yanlış şifre
const DENEME_TOPLAM = 40;                       // herkesten 15 dakikada (adres değiştirmeye karşı)
const DENEME_PENCERE = 15 * 60e3;

const ISLEM_SINIRI = 16 * 1024;
const YUKLEME_SINIRI = 512 * 1024;

const GOREV_ID = /^[ep]-[0-9a-f]{10,12}$/;

/** Gövde sınırı yola göre: plan.md yüklemesi büyük olabilir, gerisi küçük. */
export function planGovdeSiniri(yol) {
  return yol === '/api/plan/yukle' ? YUKLEME_SINIRI : ISLEM_SINIRI;
}

class PlanHatasi extends Error {
  constructor(durum, sebep) { super(sebep); this.durum = durum; this.sebep = sebep; }
}

/* ======================= depolama ======================= */

let bellek = null;                              // { klasor, dosya, durum, uyari, kalici }
let zincir = Promise.resolve();                 // yazmalar sıraya girer: telefon + bilgisayar çakışmaz
let denemeKayit = new Map();
let toplamDeneme = [];

/** Testler için: bellekteki durumu ve deneme sayaçlarını sıfırlar (yeniden başlatmayı taklit eder). */
export function planBelleginiSifirla() {
  clearTimeout(aynaZaman);
  aynaZaman = null;
  aynaSuruyor = false;
  aynaTekrar = false;
  bellek = null;
  zincir = Promise.resolve();
  denemeKayit = new Map();
  toplamDeneme = [];
  kafaIzleri = [];
}

function veriKlasoru() {
  return path.resolve(process.env.PLAN_VERI || path.join(BURASI, '..', 'veri'));
}

function bosDurum() {
  return {
    surum: 1, guncellendi: null, haftalar: [], gorevler: [], silinenler: [],
    seanslar: [], kapanislar: [], ayarlar: { haftalikDerinHedef: 20 },
    takvimAyna: {},     // görev kimliği → { e: Google etkinliği, i: imza } (plan-takvim.mjs)
    odak: null          // { bas, bitis, baslik } — süren derin odak (Instagram kestirmesi sorar)
  };
}

const ODAK_EN_UZUN = 5 * 3600e3;                // unutulan odak en geç 5 saatte düşer
const ETKINLIK_ID = /^[A-Za-z0-9_-]{1,1024}$/;

const SEANS_ID = /^s-[0-9a-f]{10}$/;
const SAAT = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
function dakika(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }

/** Saat aralığı: ikisi birden null (saatsiz görev) ya da geçerli ve bit > bas. */
function saatAraligi(bas, bit) {
  if ((bas == null || bas === '') && (bit == null || bit === '')) return { bas: null, bit: null };
  if (typeof bas !== 'string' || !SAAT.test(bas) || bas === '24:00') throw new PlanHatasi(400, 'bas');
  if (typeof bit !== 'string' || !SAAT.test(bit)) throw new PlanHatasi(400, 'bit');
  if (dakika(bit) <= dakika(bas)) throw new PlanHatasi(400, 'aralik');
  return { bas, bit };
}

const SILINEN_SINIRI = 500;

/** Diskten gelen veriyi savunmacı biçimde temizler; bozuk satır tüm planı düşürmez. */
function gecerliDurum(v) {
  const d = bosDurum();
  if (!v || typeof v !== 'object') return d;
  d.guncellendi = typeof v.guncellendi === 'string' ? v.guncellendi : null;
  d.haftalar = Array.isArray(v.haftalar)
    ? v.haftalar.filter((h) => h && gecerliGun(h.bas) && gecerliGun(h.son)).slice(-12)
    : [];
  d.gorevler = Array.isArray(v.gorevler)
    ? v.gorevler.filter((g) => g && typeof g.id === 'string' && GOREV_ID.test(g.id)
        && gecerliGun(g.gun) && typeof g.baslik === 'string')
    : [];
  d.silinenler = Array.isArray(v.silinenler)
    ? v.silinenler.filter((id) => typeof id === 'string' && GOREV_ID.test(id)).slice(-SILINEN_SINIRI)
    : [];
  d.seanslar = Array.isArray(v.seanslar)
    ? v.seanslar.filter((s) => s && SEANS_ID.test(s.id) && gecerliGun(s.gun) && Number.isFinite(s.dk)).slice(-5000)
    : [];
  d.kapanislar = Array.isArray(v.kapanislar) ? v.kapanislar.filter(gecerliGun).slice(-1000) : [];
  const hedef = v.ayarlar && Number(v.ayarlar.haftalikDerinHedef);
  d.ayarlar = { haftalikDerinHedef: Number.isFinite(hedef) && hedef >= 0 && hedef <= 80 ? hedef : 20 };
  if (v.takvimAyna && typeof v.takvimAyna === 'object') {
    for (const [id, k] of Object.entries(v.takvimAyna)) {
      if (GOREV_ID.test(id) && k && typeof k.e === 'string' && ETKINLIK_ID.test(k.e) && typeof k.i === 'string') {
        d.takvimAyna[id] = { e: k.e, i: k.i };
      }
    }
  }
  if (v.odak && typeof v.odak.bitis === 'string' && !Number.isNaN(Date.parse(v.odak.bitis))) {
    d.odak = { bas: String(v.odak.bas || ''), bitis: v.odak.bitis, baslik: String(v.odak.baslik || '').slice(0, 300) };
  }
  return d;
}

/** Odak sürüyor mu? Süresi geçmiş kayıt "sürmüyor" sayılır. */
function odakSuruyor(d, simdi = Date.now()) {
  return Boolean(d.odak && Date.parse(d.odak.bitis) > simdi);
}

/** Klasör ayrı bir dosya sisteminde mi? Coolify birimi bağlıysa evet; değilse veri her dağıtımda gider. */
function kaliciMi(klasor) {
  try { return fs.statSync(klasor).dev !== fs.statSync(path.dirname(klasor)).dev; }
  catch { return false; }
}

function yedekler(klasor) {
  try {
    return fs.readdirSync(path.join(klasor, 'yedek'))
      .filter((f) => /^plan-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
  } catch { return []; }
}

function yukle() {
  const klasor = veriKlasoru();
  if (bellek && bellek.klasor === klasor) return bellek;

  fs.mkdirSync(klasor, { recursive: true });
  const deneme = path.join(klasor, '.yazma-denemesi');
  fs.writeFileSync(deneme, 'x');               // yazılamıyorsa burada patlar → 503 depolama
  fs.unlinkSync(deneme);

  const dosya = path.join(klasor, 'plan.json');
  let durum = bosDurum();
  let uyari = null;
  if (fs.existsSync(dosya)) {
    try {
      durum = gecerliDurum(JSON.parse(fs.readFileSync(dosya, 'utf8')));
    } catch (h) {
      console.error('[plan] veri dosyası bozuk:', String(h && h.message).slice(0, 200));
      try { fs.renameSync(dosya, path.join(klasor, `plan.bozuk-${Date.now()}.json`)); } catch { /* yoksay */ }
      const son = yedekler(klasor).pop();
      if (son) {
        try {
          durum = gecerliDurum(JSON.parse(fs.readFileSync(path.join(klasor, 'yedek', son), 'utf8')));
          uyari = `Veri dosyası bozuktu; ${son.slice(5, 15)} yedeğinden açıldı.`;
        } catch { uyari = 'Veri dosyası ve son yedek bozuk; boş başlandı. Bozuk dosya saklandı.'; }
      } else {
        uyari = 'Veri dosyası bozuktu ve yedek yok; boş başlandı. Bozuk dosya saklandı.';
      }
    }
  }
  bellek = { klasor, dosya, durum, uyari, kalici: kaliciMi(klasor) };
  return bellek;
}

async function diskeYaz(b, durum) {
  // Günlük yedek: bugünün yedeği yoksa, üzerine yazmadan ÖNCE mevcut dosya kopyalanır.
  if (fs.existsSync(b.dosya)) {
    const klasor = path.join(b.klasor, 'yedek');
    const hedef = path.join(klasor, `plan-${new Date().toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(hedef)) {
      await fsp.mkdir(klasor, { recursive: true });
      await fsp.copyFile(b.dosya, hedef);
      const liste = yedekler(b.klasor);
      for (const eski of liste.slice(0, Math.max(0, liste.length - YEDEK_SAYISI))) {
        await fsp.unlink(path.join(klasor, eski)).catch(() => {});
      }
    }
  }
  // Atomik yazma: yarım kalan yazma eski dosyayı bozamaz.
  const gecici = b.dosya + '.gecici';
  await fsp.writeFile(gecici, JSON.stringify(durum), 'utf8');
  await fsp.rename(gecici, b.dosya);
}

/** Oku-değiştir-yaz tek parça ve sıralı: aynı anda iki cihazdan gelen değişiklik kaybolmaz.
    Önce kopya değiştirilir, diske yazılınca belleğe geçer — yazma düşerse bellek bozulmaz. */
function degistir(fn) {
  const is = zincir.then(async () => {
    const b = yukle();
    const kopya = structuredClone(b.durum);
    const sonuc = fn(kopya);
    kopya.guncellendi = new Date().toISOString();
    await diskeYaz(b, kopya);
    b.durum = kopya;
    return sonuc;
  });
  zincir = is.catch(() => {});
  return is;
}

/* ======================= kimlik ======================= */

function sifre() {
  const s = process.env.PLAN_SIFRE || '';
  return s.length >= 8 ? s : null;
}

function makineAnahtari() {
  const s = process.env.PLAN_ANAHTAR || '';
  return s.length >= 24 ? s : null;
}

/** "Kafama at" kestirmesinin dar yetkili anahtarı: yalnız ekleyebilir. */
function kafaAnahtari() {
  const s = process.env.KAFA_ANAHTAR || '';
  return s.length >= 24 ? s : null;
}

function kafaYetkili(ctx) {
  const k = kafaAnahtari();
  const yetki = String(ctx.basliklar.authorization || '');
  return Boolean(k) && /^Bearer\s+/i.test(yetki) && esit(yetki.replace(/^Bearer\s+/i, '').trim(), k);
}

/** İstanbul'da bugünün tarihi (YYYY-AA-GG). */
export function istanbulBugun(simdi = new Date()) {
  const p = istanbulParcalari(simdi);
  return `${p.yil}-${String(p.ay + 1).padStart(2, '0')}-${String(p.gun).padStart(2, '0')}`;
}

// Anahtar sızarsa planı çöple doldurmasın: dakikada en çok bu kadar ekleme.
const KAFA_DAKIKA_SINIRI = 20;
let kafaIzleri = [];

/** Sabit süreli karşılaştırma; uzunluk farkı da sızmaz. */
function esit(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function imzala(govde, s) {
  const k = crypto.createHash('sha256').update('dijital-profil/plan/oturum/v1\0' + s).digest();
  return crypto.createHmac('sha256', k).update(govde).digest('base64url');
}

export function oturumUret(s, simdi = Date.now()) {
  const govde = 'v1.' + (simdi + OTURUM_OMRU);
  return govde + '.' + imzala(govde, s);
}

function oturumGecerliMi(deger, s, simdi = Date.now()) {
  const m = /^(v1\.(\d{10,16}))\.([A-Za-z0-9_-]{43})$/.exec(String(deger || ''));
  if (!m || Number(m[2]) <= simdi) return false;
  return esit(m[3], imzala(m[1], s));
}

function cerezOku(basliklar) {
  for (const p of String(basliklar.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0 && p.slice(0, i).trim() === OTURUM_ADI) return p.slice(i + 1).trim();
  }
  return null;
}

function yetkili(ctx) {
  const s = sifre();
  if (!s) return false;
  const k = makineAnahtari();
  const yetki = String(ctx.basliklar.authorization || '');
  if (k && /^Bearer\s+/i.test(yetki) && esit(yetki.replace(/^Bearer\s+/i, '').trim(), k)) return true;
  return oturumGecerliMi(cerezOku(ctx.basliklar), s);
}

function cerezBasligi(deger, ctx, omurMs) {
  const https = String(ctx.basliklar['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const guvenli = process.env.NODE_ENV === 'production' || https;
  return `${OTURUM_ADI}=${deger}; Path=/; Max-Age=${Math.floor(omurMs / 1000)}; HttpOnly; SameSite=Strict${guvenli ? '; Secure' : ''}`;
}

/** Kilitliyse kalan dakikayı, değilse 0'ı döndürür. Yalnız YANLIŞ denemeler sayılır. */
function kilitDakikasi(ip) {
  const simdi = Date.now();
  toplamDeneme = toplamDeneme.filter((t) => simdi - t < DENEME_PENCERE);
  const izler = (denemeKayit.get(ip) || []).filter((t) => simdi - t < DENEME_PENCERE);
  if (izler.length) denemeKayit.set(ip, izler); else denemeKayit.delete(ip);
  const dolu = izler.length >= DENEME_KISI ? izler : toplamDeneme.length >= DENEME_TOPLAM ? toplamDeneme : null;
  if (!dolu) return 0;
  return Math.max(1, Math.ceil((DENEME_PENCERE - (simdi - Math.min(...dolu))) / 60e3));
}

function yanlisKaydet(ip) {
  const simdi = Date.now();
  if (denemeKayit.size > 5000) denemeKayit = new Map();
  const izler = denemeKayit.get(ip) || [];
  izler.push(simdi);
  denemeKayit.set(ip, izler);
  toplamDeneme.push(simdi);
}

/* ======================= takvim aynası ======================= */

let aynaZaman = null;
let aynaSuruyor = false;
let aynaTekrar = false;

/** Plan değişti: kısa bir beklemeyle takvimi güncelle (art arda değişiklikler tek tura iner). */
function aynaTetikle() {
  if (!aynaAcikMi()) return;
  clearTimeout(aynaZaman);
  aynaZaman = setTimeout(() => { planAynasiniCalistir().catch(() => {}); }, 1500);
  aynaZaman.unref?.();
}

/** Planın saatli işlerini Google Takvim'e yansıtır. Testler doğrudan çağırır. */
export async function planAynasiniCalistir(simdi = new Date()) {
  if (!aynaAcikMi()) return null;
  if (aynaSuruyor) { aynaTekrar = true; return null; }
  aynaSuruyor = true;
  try {
    await zincir;
    const b = yukle();
    const { kayit, sayilar } = await aynala(b.durum.gorevler, b.durum.takvimAyna || {}, simdi);
    const degisti = JSON.stringify(kayit) !== JSON.stringify(b.durum.takvimAyna || {});
    if (degisti) {
      // Bu arada silinen/eklenen görev olabilir: yalnız kaydı birleştir, görevlere dokunma.
      await degistir((d) => { d.takvimAyna = kayit; });
    }
    if (sayilar.hata) console.error('[plan] takvim aynası:', sayilar.hata, 'adım sonraki tura kaldı');
    return sayilar;
  } catch (h) {
    console.error('[plan] takvim aynası:', String((h && h.message) || h).slice(0, 160));
    return null;
  } finally {
    aynaSuruyor = false;
    if (aynaTekrar) { aynaTekrar = false; aynaTetikle(); }
  }
}

/** Sunucu açılınca: hemen bir tur, sonra 15 dakikada bir (kaçan adımlar için). */
export function planAynasiBaslat() {
  if (!aynaAcikMi()) return null;
  setTimeout(() => { planAynasiniCalistir().catch(() => {}); }, 8_000).unref();
  const t = setInterval(() => { planAynasiniCalistir().catch(() => {}); }, 15 * 60e3);
  t.unref();
  return t;
}

/** Bir günün görevleri (kopya) — Telegram hatırlatması okur, yazmaz. */
export async function planGorevleri(gun) {
  await zincir;
  const b = yukle();
  return b.durum.gorevler.filter((g) => g.gun === gun).map((g) => ({ ...g }));
}

/* Toplantı ekranı (/toplanti) AYNI girişi kullanır: ayrı şifre yok, aynı çerez, aynı makine anahtarı. */
export function planKurulduMu() { return Boolean(sifre()); }
export function planYetkili(basliklar) { return yetkili({ basliklar }); }
/** Makine anahtarı (Bearer PLAN_ANAHTAR) sabit süreli karşılaştırma için dışarı da açık. */
export function anahtarEsit(gelen, beklenen) { return Boolean(gelen && beklenen) && esit(gelen, beklenen); }

/** Başka siteden gelen istek mi? Origin varsa ana makineyle aynı olmalı. */
export function kokenUyarMi(koken, b) {
  let h;
  try { h = new URL(koken).host; } catch { return false; }
  const ileri = String(b['x-forwarded-host'] || '').split(',')[0].trim();
  return h === b.host || (ileri !== '' && h === ileri);
}

/* ======================= plan işlemleri ======================= */

function gunDogrula(s) { if (!gecerliGun(s)) throw new PlanHatasi(400, 'gun'); return s; }

function metin(s, ad, sinir) {
  if (typeof s !== 'string' || s.length > sinir) throw new PlanHatasi(400, ad);
  return s;
}

function gorevBul(d, id) {
  if (typeof id !== 'string' || !GOREV_ID.test(id)) throw new PlanHatasi(400, 'id');
  const g = d.gorevler.find((x) => x.id === id);
  if (!g) throw new PlanHatasi(404, 'gorev');
  return g;
}

function sonSira(d, gun) {
  return d.gorevler.reduce((m, g) => (g.gun === gun && Number.isFinite(g.sira) ? Math.max(m, g.sira) : m), -1);
}

function tasi(d, g, gun) {
  if (g.gun === gun) return;
  const sira = sonSira(d, gun) + 1;          // görev yeni güne geçmeden ÖNCE: kendi eski sırasını saymasın
  g.gun = gun;
  g.sira = sira;
}

function islemUygula(d, v) {
  const simdi = new Date().toISOString();
  switch (v.islem) {
    case 'isaretle': {
      const g = gorevBul(d, v.id);
      g.bitti = v.bitti === true;
      g.bittiZaman = g.bitti ? simdi : null;
      return { gorev: g };
    }
    case 'ekle': {
      const gun = gunDogrula(v.gun);
      const gs = gorevSatiri(metin(v.metin, 'metin', 600));
      if (!gs.baslik) throw new PlanHatasi(400, 'metin');
      const g = {
        id: 'e-' + crypto.randomBytes(5).toString('hex'),
        gun, gunIlk: gun, sira: sonSira(d, gun) + 1,
        alan: gs.alan, baslik: gs.baslik.slice(0, 300), dk: gs.dk, not: gs.not.slice(0, 4000),
        bas: gs.bas || null, bit: gs.bit || null,
        bitti: false, bittiZaman: null, kaynak: 'elle', olusturuldu: simdi
      };
      d.gorevler.push(g);
      return { gorev: g };
    }
    case 'tasi': {
      const g = gorevBul(d, v.id);
      tasi(d, g, gunDogrula(v.gun));
      return { gorev: g };
    }
    case 'tasiCok': {                                   // "geçmişten kalanı bugüne al"
      const gun = gunDogrula(v.gun);
      if (!Array.isArray(v.idler) || v.idler.length > 300) throw new PlanHatasi(400, 'idler');
      const tasinan = [];
      for (const id of v.idler) {
        if (typeof id !== 'string' || !GOREV_ID.test(id)) continue;
        const g = d.gorevler.find((x) => x.id === id);
        if (g && !g.bitti && g.gun !== gun) { tasi(d, g, gun); tasinan.push(g); }
      }
      return { gorevler: tasinan };
    }
    case 'sil': {
      const i = d.gorevler.findIndex((x) => x.id === v.id);
      if (typeof v.id !== 'string' || !GOREV_ID.test(v.id)) throw new PlanHatasi(400, 'id');
      if (i < 0) throw new PlanHatasi(404, 'gorev');
      const [g] = d.gorevler.splice(i, 1);
      // Bilerek silinen plan görevi, plan yeniden yüklenince dirilmesin.
      if (g.kaynak === 'plan') d.silinenler = [...(d.silinenler || []), g.id].slice(-SILINEN_SINIRI);
      return { gorev: g };
    }
    case 'duzenle': {
      const g = gorevBul(d, v.id);
      if (v.baslik !== undefined) {
        const b = metin(v.baslik, 'baslik', 300).trim();
        if (!b) throw new PlanHatasi(400, 'baslik');
        g.baslik = b;
      }
      if (v.not !== undefined) g.not = metin(v.not, 'not', 4000).trim();
      if (v.dk !== undefined) {
        if (v.dk !== null && (!Number.isInteger(v.dk) || v.dk < 0 || v.dk > 1440)) throw new PlanHatasi(400, 'dk');
        g.dk = v.dk;
      }
      if (v.bas !== undefined || v.bit !== undefined) Object.assign(g, saatAraligi(v.bas ?? null, v.bit ?? null));
      if (v.ust !== undefined) g.ust = v.ust === true;      // "Bugünün 3'ü"
      if (v.kadran !== undefined) {                          // önem/aciliyet: 1 acil+önemli · 2 önemli · 3 acil · 4 ikisi de değil
        if (v.kadran !== null && ![1, 2, 3, 4].includes(v.kadran)) throw new PlanHatasi(400, 'kadran');
        g.kadran = v.kadran;
        delete g.oneri;                                      // karar verildi: öneri düşer
      }
      g.duzenlendi = true;               // sonraki plan yüklemesi elle düzeltmeyi ezmez
      return { gorev: g };
    }
    /* ---------- derin odak seansı ---------- */
    case 'seansKaydet': {
      const gun = gunDogrula(v.gun);
      if (!Number.isInteger(v.dk) || v.dk < 1 || v.dk > 600) throw new PlanHatasi(400, 'dk');
      if (v.gorevId != null && !(typeof v.gorevId === 'string' && GOREV_ID.test(v.gorevId))) throw new PlanHatasi(400, 'gorevId');
      const s = {
        id: 's-' + crypto.randomBytes(5).toString('hex'), gun, dk: v.dk,
        baslik: metin(v.baslik ?? '', 'baslik', 300).trim(),
        gorevId: v.gorevId || null,
        derin: v.derin !== false, kesildi: v.kesildi === true, bitti: simdi
      };
      d.seanslar.push(s);
      d.seanslar = d.seanslar.slice(-5000);
      return { seans: s };
    }
    case 'kapanis': {
      const gun = gunDogrula(v.gun);
      if (!d.kapanislar.includes(gun)) d.kapanislar.push(gun);
      return { gun };
    }
    case 'odak': {
      // Derin odak başladı/bitti. Instagram kestirmesi /api/plan/odak ile bunu sorar.
      if (v.bitis === null) { d.odak = null; return { odak: null }; }
      const bitis = Date.parse(v.bitis);
      if (typeof v.bitis !== 'string' || Number.isNaN(bitis)) throw new PlanHatasi(400, 'bitis');
      const simdiMs = Date.now();
      if (bitis <= simdiMs) { d.odak = null; return { odak: null }; }
      d.odak = {
        bas: new Date(simdiMs).toISOString(),
        bitis: new Date(Math.min(bitis, simdiMs + ODAK_EN_UZUN)).toISOString(),
        baslik: metin(v.baslik ?? '', 'baslik', 300).trim()
      };
      return { odak: d.odak };
    }
    case 'hedef': {
      if (!Number.isInteger(v.saat) || v.saat < 0 || v.saat > 80) throw new PlanHatasi(400, 'saat');
      d.ayarlar.haftalikDerinHedef = v.saat;
      return { ayarlar: d.ayarlar };
    }
    default:
      throw new PlanHatasi(400, 'islem');
  }
}

/**
 * plan.md'yi mevcut duruma işler.
 * - Plan görevinin kimliği İLK günü + başlığından türer → aynı plan tekrar yüklenince kopya oluşmaz.
 * - Yapılmış, taşınmış ya da elle düzeltilmiş görev planda yoksa bile SİLİNMEZ.
 * - Kullanıcının sildiği plan görevi geri GETİRİLMEZ (atlanan).
 * - Elle eklenen görevlere (kaynak: elle) hiç dokunulmaz.
 */
export function birlestir(d, p, simdi = new Date().toISOString()) {
  const ozet = { eklenen: 0, guncellenen: 0, silinen: 0, korunan: 0, atlanan: 0 };
  const aralik = new Set(p.gunler.map((g) => g.gun));
  const gorulen = new Set();
  const silinmis = new Set(d.silinenler || []);

  for (const gun of p.gunler) {
    const sayac = new Map();
    gun.gorevler.forEach((t, i) => {
      const k = anahtar(t.baslik);
      const n = sayac.get(k) || 0;
      sayac.set(k, n + 1);
      const id = 'p-' + crypto.createHash('sha256').update(gun.gun + '|' + k + (n ? '|#' + n : '')).digest('hex').slice(0, 12);
      gorulen.add(id);
      if (silinmis.has(id)) { ozet.atlanan++; return; }
      const var_ = d.gorevler.find((g) => g.id === id);
      if (var_) {
        let degisti = false;
        if (!var_.duzenlendi) {
          for (const a of ['baslik', 'alan', 'dk', 'not', 'bas', 'bit']) {
            const yeni = t[a] ?? null;
            if ((var_[a] ?? null) !== yeni) { var_[a] = yeni; degisti = true; }
          }
        }
        if (var_.gun === gun.gun) var_.sira = i;
        if (degisti) ozet.guncellenen++; else ozet.korunan++;
      } else {
        d.gorevler.push({
          id, gun: gun.gun, gunIlk: gun.gun, sira: i,
          alan: t.alan, baslik: t.baslik, dk: t.dk, not: t.not, bas: t.bas || null, bit: t.bit || null,
          bitti: false, bittiZaman: null, kaynak: 'plan', olusturuldu: simdi
        });
        ozet.eklenen++;
      }
    });
  }

  d.gorevler = d.gorevler.filter((g) => {
    if (g.kaynak !== 'plan' || !aralik.has(g.gunIlk) || gorulen.has(g.id)) return true;
    if (g.bitti || g.duzenlendi || g.gun !== g.gunIlk) { ozet.korunan++; return true; }
    ozet.silinen++;
    return false;
  });

  const gunler = [...aralik].sort();
  const hafta = { bas: gunler[0], son: gunler[gunler.length - 1], baslik: p.baslik, not: p.not, yuklendi: simdi };
  d.haftalar = d.haftalar.filter((h) => h.bas !== hafta.bas).concat(hafta)
    .sort((a, b) => a.bas.localeCompare(b.bas)).slice(-12);
  return ozet;
}

/* ======================= HTTP ======================= */

function cevap(durum, veri, ek = {}) {
  return {
    durum,
    basliklar: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...ek },
    govde: JSON.stringify(veri)
  };
}

function jsonGovde(ctx) {
  if (!ctx.govde || !ctx.govde.length) return {};
  let v;
  try { v = JSON.parse(ctx.govde.toString('utf8')); } catch { throw new PlanHatasi(400, 'json'); }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

const DEPOLAMA_HATALARI = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'ENOSPC', 'EEXIST', 'EISDIR']);

/**
 * @param {{ yontem: string, yol: string, basliklar: Record<string,string>, govde?: Buffer, ip: string }} ctx
 * @returns {Promise<{ durum: number, basliklar: Record<string,string>, govde: string }>}
 */
export async function planIstegi(ctx) {
  const s = sifre();
  if (!s) return cevap(503, { sebep: 'kurulmadi' });

  if (ctx.yontem === 'POST') {
    // İstek sahteciliğine karşı: form JSON gönderemez, başka siteden gelen Origin reddedilir.
    if (!String(ctx.basliklar['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return cevap(415, { sebep: 'tur' });
    }
    if (ctx.basliklar.origin && !kokenUyarMi(ctx.basliklar.origin, ctx.basliklar)) {
      return cevap(403, { sebep: 'koken' });
    }
  }

  try {
    switch (ctx.yol) {
      case '/api/plan': {
        if (ctx.yontem !== 'GET') return cevap(405, { sebep: 'yontem' });
        if (!yetkili(ctx)) return cevap(401, { sebep: 'oturum' });
        await zincir;                                   // okuma, kendinden önce gelen her yazmayı görür
        const b = yukle();
        return cevap(200, {
          kalici: b.kalici, uyari: b.uyari, guncellendi: b.durum.guncellendi,
          haftalar: b.durum.haftalar, gorevler: b.durum.gorevler,
          seanslar: b.durum.seanslar.slice(-1500),
          kapanislar: b.durum.kapanislar, ayarlar: b.durum.ayarlar,
          odak: odakSuruyor(b.durum) ? b.durum.odak : null,
          takvimAyna: aynaAcikMi()
        });
      }
      case '/api/plan/kestirme': {
        // Kestirme kurulum sayfası (menü → iPhone kestirmeleri): giriş yapmış sahibine anahtarı verir ki
        // telefonda kopyala-yapıştırla kursun. Kestirme anahtarının kendisi bunu OKUYAMAZ.
        if (ctx.yontem !== 'GET') return cevap(405, { sebep: 'yontem' });
        if (!yetkili(ctx)) return cevap(401, { sebep: 'oturum' });
        return cevap(200, { anahtar: kafaAnahtari() });
      }
      case '/api/plan/odak': {
        // iPhone otomasyonu "Instagram açıldığında" bunu sorar: düz metin "evet" / "hayir".
        if (ctx.yontem !== 'GET') return cevap(405, { sebep: 'yontem' });
        if (!kafaYetkili(ctx) && !yetkili(ctx)) {
          return cevap(kafaAnahtari() ? 401 : 503, { sebep: kafaAnahtari() ? 'anahtar' : 'kapali' });
        }
        await zincir;
        const odakta = odakSuruyor(yukle().durum);
        return { durum: 200, basliklar: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, govde: odakta ? 'evet' : 'hayir' };
      }
      case '/api/plan/giris': {
        if (ctx.yontem !== 'POST') return cevap(405, { sebep: 'yontem' });
        const kilit = kilitDakikasi(ctx.ip);
        if (kilit) return cevap(429, { sebep: 'kilit', dakika: kilit });
        const v = jsonGovde(ctx);
        if (typeof v.sifre !== 'string' || !esit(v.sifre, s)) {
          yanlisKaydet(ctx.ip);
          return cevap(401, { sebep: 'sifre' });
        }
        denemeKayit.delete(ctx.ip);
        return cevap(200, { tamam: true }, { 'Set-Cookie': cerezBasligi(oturumUret(s), ctx, OTURUM_OMRU) });
      }
      case '/api/plan/cikis': {
        if (ctx.yontem !== 'POST') return cevap(405, { sebep: 'yontem' });
        return cevap(200, { tamam: true }, { 'Set-Cookie': cerezBasligi('', ctx, 0) });
      }
      case '/api/plan/islem': {
        if (ctx.yontem !== 'POST') return cevap(405, { sebep: 'yontem' });
        if (!yetkili(ctx)) return cevap(401, { sebep: 'oturum' });
        const v = jsonGovde(ctx);
        const sonuc = await degistir((d) => islemUygula(d, v));
        aynaTetikle();
        return cevap(200, { tamam: true, ...sonuc });
      }
      case '/api/plan/kafa': {
        // iPhone "Kafama at" kestirmesi: dikte edilen metin bugüne saatsiz iş olarak düşer.
        // Kestirmenin anahtarı yalnız buraya yetkilidir; plana ait hiçbir şeyi döndürmez.
        if (ctx.yontem !== 'POST') return cevap(405, { sebep: 'yontem' });
        if (!kafaYetkili(ctx) && !yetkili(ctx)) {
          return cevap(kafaAnahtari() ? 401 : 503, { sebep: kafaAnahtari() ? 'anahtar' : 'kapali' });
        }
        const simdi = Date.now();
        kafaIzleri = kafaIzleri.filter((t) => simdi - t < 60e3);
        if (kafaIzleri.length >= KAFA_DAKIKA_SINIRI) return cevap(429, { sebep: 'cok-fazla' });
        const v = jsonGovde(ctx);
        if (typeof v.metin !== 'string') throw new PlanHatasi(400, 'metin');
        const baslik = v.metin.replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!baslik) throw new PlanHatasi(400, 'metin');
        kafaIzleri.push(simdi);
        const bugun = istanbulBugun();
        // Claude bağlıysa cümleyi işlere ayırır, önem/aciliyet önerir, söylenen gün ve saati çıkarır.
        // Bağlı değilse ya da hata verirse cümle olduğu gibi tek iş olur: sesle ekleme kaybolmaz.
        let isler = null;
        if (akilAcikMi()) {
          await zincir;
          const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
          const uclu = yukle().durum.gorevler.filter((g) => g.gun === bugun && g.ust && !g.bitti).map((g) => g.baslik).slice(0, 3);
          isler = await isleriCikar(baslik, { bugun, gunAdi: GUNLER[new Date(bugun + 'T12:00:00Z').getUTCDay()], uclu });
        }
        const eklenecek = isler || [{ baslik, kadran: null, gun: null, bas: null, bit: null, toplanti: false }];
        await degistir((d) => {
          const zaman = new Date().toISOString();
          for (const i of eklenecek) {
            const gun = i.gun && i.gun >= bugun ? i.gun : bugun;
            const g = {
              id: 'e-' + crypto.randomBytes(5).toString('hex'),
              gun, gunIlk: gun, sira: sonSira(d, gun) + 1,
              alan: null, baslik: i.baslik, dk: null, not: '',
              bas: i.bas, bit: i.bit,
              bitti: false, bittiZaman: null, kaynak: 'kafa', olusturuldu: zaman
            };
            if (i.kadran) g.oneri = i.kadran;          // öneri: kullanıcı onaylayınca kadran olur
            d.gorevler.push(g);
          }
        });
        aynaTetikle();
        return cevap(200, { tamam: true, baslik: eklenecek.map((i) => i.baslik).join(' · '), adet: eklenecek.length });
      }
      case '/api/plan/yukle': {
        if (ctx.yontem !== 'POST') return cevap(405, { sebep: 'yontem' });
        if (!yetkili(ctx)) return cevap(401, { sebep: 'oturum' });
        const v = jsonGovde(ctx);
        if (typeof v.metin !== 'string' || !v.metin.trim()) throw new PlanHatasi(400, 'metin');
        const p = planAyristir(v.metin);
        if (!p.gunler.length) return cevap(422, { sebep: 'bos', uyarilar: p.uyarilar });
        const ozet = await degistir((d) => birlestir(d, p));
        aynaTetikle();
        return cevap(200, { tamam: true, ozet, uyarilar: p.uyarilar });
      }
      default:
        return cevap(404, { sebep: 'yok' });
    }
  } catch (h) {
    if (h instanceof PlanHatasi) return cevap(h.durum, { sebep: h.sebep });
    if (h && DEPOLAMA_HATALARI.has(h.code)) {
      console.error('[plan] depolama:', h.code, String(h.message).slice(0, 200));
      bellek = null;                                    // birim sonradan bağlanırsa yeniden dener
      return cevap(503, { sebep: 'depolama' });
    }
    throw h;
  }
}
