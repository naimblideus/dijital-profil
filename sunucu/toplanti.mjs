/* Toplantı yönetimi — naim.nextusservis.com/toplanti
   Yalnız Mehmet: /plan ile AYNI giriş (oturum çerezi ya da Bearer PLAN_ANAHTAR). PLAN_SIFRE yoksa KAPALI.

   Takvim: Google Calendar REST, mevcut calendar.events izniyle (list, insert, patch, delete) — yeni izin yok.
   Kartın açtığı her etkinlik extendedProperties.private'ta kişiyi ve CRM firmasını taşır:
     kart: 'toplanti' (bu ekrandan) | 'randevu' (ziyaretçi formu), ad, firma, telefon, eposta, sekil,
     crmFirma (CRM'e yazılınca), durum: 'gorusuldu'.
   CRM (sunucu/crm.mjs): NEXUS_CRM_URL + NEXUS_CRM_TOKEN. Yoksa CRM özellikleri kapalı; takvim çalışır.

   Kişi verisi URL'ye ve günlüğe yazılmaz: arama da gövdede; günlükte yalnız etkinlik kimliği ve durum kodu.
   Dışarıya kendiliğinden mesaj gitmez: WhatsApp metni yalnız bağlantı olarak döner; Google daveti yalnız
   e-posta girilmiş ve "davet gönder" açıksa (ertele/iptalde yalnız zaten davetli kişiye, "haber ver" açıksa).

   iOS Kestirmeler: POST /api/toplanti/taslak (Bearer TOPLANTI_ANAHTAR — yalnız taslak açabilir, hiçbir şey
   okuyamaz) → kısa ömürlü kimlik → /toplanti/#t-<kimlik>. Kişi verisi adreste DEĞİL, sunucu belleğinde. */

import crypto from 'node:crypto';
import { ayarlar, kimlikVarMi, erisimJetonu, mesgulAraliklar, cakisiyorMu, slotlariUret, takvimKoku } from './takvim.mjs';
import { SEKIL_ADI, ofisAdresi, meetLinki, temizle } from './randevu.mjs';
import { planKurulduMu, planYetkili, anahtarEsit, kokenUyarMi } from './plan.mjs';
import { crmAyarli, crmAra, crmToplantiYaz, crmAdresi, crmIsler } from './crm.mjs';
import { mesaj, waLinki } from '../site/toplanti/mesaj.mjs';

const GOVDE_SINIRI = 16 * 1024;
export function toplantiGovdeSiniri() { return GOVDE_SINIRI; }

const EPOSTA_DESENI = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ETKINLIK_ID = /^[A-Za-z0-9_-]{3,200}$/;
const FIRMA_ID = /^[A-Za-z0-9_-]{1,60}$/;
const SURELER = [15, 30, 45, 60, 90, 120];
const GECMIS_GUN = 3;                         // "Görüştük" denebilsin diye son 3 günün toplantıları da gelir
const ILERI_GUN = 30;

const TASLAK_OMRU = 10 * 60e3;
const TASLAK_SINIRI = 20;
const TASLAK_ID = /^[A-Za-z0-9_-]{16}$/;
let taslaklar = new Map();                    // kimlik → { veri, bitis } — yalnız bellekte

export function toplantiBelleginiSifirla() { taslaklar = new Map(); }

class ToplantiHatasi extends Error {
  constructor(durum, sebep, ek) { super(sebep); this.durum = durum; this.sebep = sebep; this.ek = ek; }
}

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
  try { v = JSON.parse(ctx.govde.toString('utf8')); } catch { throw new ToplantiHatasi(400, 'json'); }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function kisayolAnahtari() {
  const s = process.env.TOPLANTI_ANAHTAR || '';
  return s.length >= 24 ? s : null;
}

function bearer(basliklar) {
  const y = String(basliklar.authorization || '');
  return /^Bearer\s+/i.test(y) ? y.replace(/^Bearer\s+/i, '').trim() : '';
}

export function randevuAdresi() {
  const kok = String(process.env.KART_ADRESI || 'https://naim.nextusservis.com/').trim().replace(/\/?$/, '/');
  return kok + '#randevu';
}

/* ======================= Google Takvim ======================= */

const takvimId = () => ayarlar().takvimler[0] || 'primary';
const takvimYolu = (id) => `/calendar/v3/calendars/${encodeURIComponent(takvimId())}/events${id ? '/' + encodeURIComponent(id) : ''}`;

async function google(jeton, yontem, yol, govde) {
  const y = await fetch(takvimKoku() + yol, {
    method: yontem,
    headers: { Authorization: 'Bearer ' + jeton, ...(govde ? { 'Content-Type': 'application/json' } : {}) },
    body: govde ? JSON.stringify(govde) : undefined
  });
  if (y.status === 404 || y.status === 410) throw new ToplantiHatasi(404, 'toplanti-yok');
  if (!y.ok) throw new Error('takvim ' + yontem + ' ' + y.status);
  const t = y.status === 204 ? '' : await y.text();
  return t ? JSON.parse(t) : null;
}

/** Boş değerleri atar, her değeri Google'ın sınırına (1024) kırpar. */
function ozellikler(o) {
  const p = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') p[k] = String(v).slice(0, 1000);
  return p;
}

function satirAl(metin, etiket) {
  const m = new RegExp('^' + etiket + ': (.+)$', 'm').exec(metin || '');
  return m ? m[1].trim() : null;
}

/** Google etkinliği → ekranın satırı. Bizim olmayan ve kişisiz etkinlik (spor, odak bloğu) null. */
export function temsil(e) {
  if (!e || !e.start || !e.start.dateTime || !e.end || !e.end.dateTime) return null;   // tüm gün etkinliği
  const p = (e.extendedProperties && e.extendedProperties.private) || {};
  const digerleri = (e.attendees || []).filter((a) => !a.self && !a.resource);
  let kaynak;
  if (p.kart === 'toplanti') kaynak = 'toplanti';
  else if (p.kart === 'randevu' || /^Görüşme — /.test(e.summary || '')) kaynak = 'randevu';
  else if (digerleri.length) kaynak = 'takvim';
  else return null;

  let kisi = { ad: p.ad || null, firma: p.firma || null, telefon: p.telefon || null, eposta: p.eposta || null };
  let sekil = Object.hasOwn(SEKIL_ADI, p.sekil || '') ? p.sekil : null;
  if (kaynak === 'randevu' && !p.kart) {
    // Bu sürümden önce açılmış kart randevusu: kişi açıklamada (randevu.mjs'in yazdığı biçim)
    const d = e.description || '';
    kisi = { ad: satirAl(d, 'Kişi'), firma: satirAl(d, 'Firma'), telefon: satirAl(d, 'Telefon'), eposta: satirAl(d, 'E-posta') };
    const s = satirAl(d, 'Görüşme şekli') || '';
    sekil = /^Telefon/.test(s) ? 'telefon' : /^Yüz yüze/.test(s) ? 'yuzyuze' : 'meet';
  } else if (kaynak === 'takvim') {
    kisi = { ad: digerleri[0].displayName || null, firma: null, telefon: null, eposta: digerleri[0].email || null };
  }
  const meet = meetLinki(e);
  if (!sekil) sekil = meet ? 'meet' : null;
  return {
    id: e.id,
    baslik: e.summary || '',
    bas: new Date(e.start.dateTime).toISOString(),
    bit: new Date(e.end.dateTime).toISOString(),
    sekil, meet, yer: e.location || null, kisi, kaynak,
    duzenlenebilir: kaynak !== 'takvim' || Boolean(e.organizer && e.organizer.self),
    davetli: digerleri.length > 0,
    durum: p.durum === 'gorusuldu' ? 'gorusuldu' : null,
    crm: p.crmFirma && FIRMA_ID.test(p.crmFirma) ? { firmaId: p.crmFirma, adres: crmAdresi('/firma/' + p.crmFirma) } : null,
    takvimAdresi: /^https:\/\/(calendar\.google\.com|www\.google\.com\/calendar)\//.test(e.htmlLink || '') ? e.htmlLink : null
  };
}

async function etkinlikAl(jeton, id) {
  if (typeof id !== 'string' || !ETKINLIK_ID.test(id)) throw new ToplantiHatasi(400, 'id');
  const e = await google(jeton, 'GET', takvimYolu(id));
  // Google yeni silinmiş etkinliği 404 yerine status: cancelled ile döndürür.
  const t = e && e.status !== 'cancelled' ? temsil(e) : null;
  if (!t) throw new ToplantiHatasi(404, 'toplanti-yok');
  return { e, t };
}

/** Meşgul aralıklardan bir aralığı çıkarır (erteleme: toplantı kendi eski saatiyle çakışmasın). */
function aralikCikar(araliklar, bas, bit) {
  const sonuc = [];
  for (const a of araliklar) {
    if (a.bit <= bas || a.bas >= bit) { sonuc.push(a); continue; }
    if (a.bas < bas) sonuc.push({ bas: a.bas, bit: bas });
    if (a.bit > bit) sonuc.push({ bas: bit, bit: a.bit });
  }
  return sonuc;
}

function saatAl(deger, gecmiseIzin) {
  const bas = new Date(temizle(deger, 40));
  if (isNaN(bas.getTime())) throw new ToplantiHatasi(400, 'saat');
  if (!gecmiseIzin && bas.getTime() < Date.now() - 10 * 60e3) throw new ToplantiHatasi(400, 'gecmis-saat');
  return bas;
}

/** Çakışma: zorla değilse freeBusy'ye sor; çakışıyorsa 409 (ekran "yine de oluştur?" diye sorar). */
async function cakismaDenetle(jeton, bas, bit, haric) {
  let m = await mesgulAraliklar(jeton, ayarlar().takvimler, bas, bit);
  if (haric) m = aralikCikar(m, haric.bas, haric.bit);
  if (cakisiyorMu(bas, bit, m)) throw new ToplantiHatasi(409, 'cakisma');
}

/* ======================= CRM köprüsü ======================= */

async function crmPlanla(jeton, e, kisi, { bas, sekil, meet, not, firmaId }) {
  if (!crmAyarli()) return { durum: 'kapali' };
  const r = await crmToplantiYaz({
    islem: 'planla', kaynak: 'elle', etkinlikId: e.id, bas: bas.toISOString(), sekil: sekil || 'meet',
    meet: meet || undefined, ad: kisi.ad || undefined, firma: kisi.firma || undefined,
    telefon: kisi.telefon || undefined, eposta: kisi.eposta || undefined, not: not || undefined,
    firmaId: firmaId || undefined
  });
  if (r.durum === 'yazildi') {
    // CRM firmasını etkinliğe işle: liste "CRM kartı" bağlantısını buradan çizer.
    const p = { ...((e.extendedProperties && e.extendedProperties.private) || {}), crmFirma: r.firmaId };
    try {
      await google(jeton, 'PATCH', takvimYolu(e.id) + '?sendUpdates=none', { extendedProperties: { private: p } });
    } catch { console.error('[toplanti] crm firmasi etkinlige yazilamadi', e.id); }
    e.extendedProperties = { ...(e.extendedProperties || {}), private: p };
  }
  return r;
}

async function crmDurum(islem, t, ek = {}) {
  if (!crmAyarli()) return { durum: 'kapali' };
  return crmToplantiYaz({ islem, etkinlikId: t.id, firmaId: t.crm ? t.crm.firmaId : undefined, ...ek });
}

function wa(tur, t, ek) {
  if (!t) return null;
  const metin = mesaj(tur, t, { randevuAdresi: randevuAdresi(), ...ek });
  return { metin, adres: waLinki(t.kisi && t.kisi.telefon, metin) };
}

/* ======================= işlemler ======================= */

async function liste() {
  const a = ayarlar();
  const temel = { takvim: kimlikVarMi(), crm: crmAyarli(), randevuAdresi: randevuAdresi(), slotDakika: a.slotDakika, sureler: SURELER, ofisAdresi: ofisAdresi() };
  if (!temel.takvim) return { ...temel, toplantilar: [] };
  const jeton = await erisimJetonu();
  const simdi = Date.now();
  const q = new URLSearchParams({
    timeMin: new Date(simdi - GECMIS_GUN * 86400e3).toISOString(),
    timeMax: new Date(simdi + ILERI_GUN * 86400e3).toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '250'
  });
  const ogeler = [];
  for (let i = 0; i < 4; i++) {
    const v = await google(jeton, 'GET', takvimYolu() + '?' + q);
    ogeler.push(...((v && v.items) || []));
    if (!v || !v.nextPageToken) break;
    q.set('pageToken', v.nextPageToken);
  }
  const toplantilar = ogeler.filter((e) => e.status !== 'cancelled').map(temsil).filter(Boolean)
    .sort((x, y) => x.bas.localeCompare(y.bas));
  return { ...temel, toplantilar };
}

/** Önümüzdeki toplantılar (kart randevuları dahil) — Telegram hatırlatması okur. Takvim yoksa boş. */
export async function yaklasanToplantilar() {
  const v = await liste();
  return v.toplantilar || [];
}

async function slotlar() {
  if (!kimlikVarMi()) throw new ToplantiHatasi(503, 'kimlik-yok');
  // Kartın ziyaretçi kuralı (en erken 4 saat sonrası) sahibine uygulanmaz: bir saat sonrasına da kurabilir.
  const a = { ...ayarlar(), enAzHaberSaat: 0 };
  const jeton = await erisimJetonu();
  const simdi = new Date();
  const mesgul = await mesgulAraliklar(jeton, a.takvimler, simdi, new Date(simdi.getTime() + (a.ilerideGun + 1) * 86400e3));
  return { slotDakika: a.slotDakika, gunler: slotlariUret(simdi, mesgul, a) };
}

function ilkSatir(v, n) { return temizle(String(v == null ? '' : v).split(/[\r\n;]/)[0], n); }

function kisiAl(v) {
  const k = {
    ad: temizle(v.ad, 120), firma: temizle(v.firma, 120),
    telefon: ilkSatir(v.telefon, 40), eposta: ilkSatir(v.eposta, 160).toLowerCase()
  };
  if (!k.ad && !k.firma) throw new ToplantiHatasi(400, 'kisi');
  if (k.eposta && !EPOSTA_DESENI.test(k.eposta)) throw new ToplantiHatasi(400, 'eposta');
  if (k.telefon && k.telefon.replace(/\D/g, '').length < 7) throw new ToplantiHatasi(400, 'telefon');
  return k;
}

async function olustur(v) {
  if (!kimlikVarMi()) throw new ToplantiHatasi(503, 'kimlik-yok');
  const k = kisiAl(v);
  const bas = saatAl(v.bas, false);
  const sure = SURELER.includes(Number(v.sure)) ? Number(v.sure) : ayarlar().slotDakika;
  const bit = new Date(bas.getTime() + sure * 60e3);
  const sekil = typeof v.sekil === 'string' && Object.hasOwn(SEKIL_ADI, v.sekil) ? v.sekil : 'meet';
  const yer = sekil === 'yuzyuze' ? (temizle(v.yer, 200) || ofisAdresi()) : null;
  const not = temizle(v.not, 1000);
  const davet = Boolean(k.eposta) && v.davet === true;
  const firmaId = FIRMA_ID.test(String(v.crmFirmaId || '')) ? String(v.crmFirmaId) : null;

  const jeton = await erisimJetonu();
  if (v.zorla !== true) await cakismaDenetle(jeton, bas, bit);

  const gorunen = k.ad || k.firma;
  const etkinlik = {
    summary: `Toplantı — ${gorunen}${k.ad && k.firma ? ` (${k.firma})` : ''}`,
    description: [
      k.ad ? `Kişi: ${k.ad}` : null,
      k.firma ? `Firma: ${k.firma}` : null,
      k.telefon ? `Telefon: ${k.telefon}` : null,
      k.eposta ? `E-posta: ${k.eposta}${davet ? ' — davet gönderildi' : ''}` : null,
      `Görüşme şekli: ${SEKIL_ADI[sekil]}${sekil === 'telefon' ? ' — sen arayacaksın' : ''}`,
      not ? `\nNot:\n${not}` : null,
      '\nToplantı ekranından açıldı.'
    ].filter(Boolean).join('\n'),
    start: { dateTime: bas.toISOString(), timeZone: 'Europe/Istanbul' },
    end: { dateTime: bit.toISOString(), timeZone: 'Europe/Istanbul' },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
    extendedProperties: { private: ozellikler({ kart: 'toplanti', ...k, sekil, crmFirma: firmaId }) }
  };
  if (davet) etkinlik.attendees = [{ email: k.eposta, displayName: gorunen }];
  if (sekil === 'meet') {
    etkinlik.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  } else if (sekil === 'yuzyuze') {
    etkinlik.location = yer;
  } else if (k.telefon) {
    etkinlik.location = `Telefon: ${k.telefon}`;
  }

  const e = await google(jeton, 'POST',
    takvimYolu() + `?sendUpdates=${davet ? 'all' : 'none'}${sekil === 'meet' ? '&conferenceDataVersion=1' : ''}`, etkinlik);
  console.log('[toplanti] olusturuldu', e.id, sekil);
  const crm = await crmPlanla(jeton, e, k, { bas, sekil, meet: meetLinki(e), not, firmaId });
  const t = temsil(e);
  return { tamam: true, toplanti: t, crm, wa: wa('planla', t, { davet }) };
}

async function ertele(v) {
  if (!kimlikVarMi()) throw new ToplantiHatasi(503, 'kimlik-yok');
  const jeton = await erisimJetonu();
  const { e, t } = await etkinlikAl(jeton, v.id);
  if (!t.duzenlenebilir) throw new ToplantiHatasi(403, 'duzenlenemez');
  const bas = saatAl(v.bas, false);
  const eskiBas = new Date(t.bas), eskiBit = new Date(t.bit);
  const sure = SURELER.includes(Number(v.sure)) ? Number(v.sure) : Math.round((eskiBit - eskiBas) / 60e3);
  const bit = new Date(bas.getTime() + sure * 60e3);
  if (v.zorla !== true) await cakismaDenetle(jeton, bas, bit, { bas: eskiBas, bit: eskiBit });
  const haber = v.haberVer !== false && t.davetli;
  const y = await google(jeton, 'PATCH', takvimYolu(e.id) + `?sendUpdates=${haber ? 'all' : 'none'}`, {
    start: { dateTime: bas.toISOString(), timeZone: 'Europe/Istanbul' },
    end: { dateTime: bit.toISOString(), timeZone: 'Europe/Istanbul' }
  });
  console.log('[toplanti] ertelendi', e.id);
  const yeni = temsil(y) || { ...t, bas: bas.toISOString(), bit: bit.toISOString() };
  const crm = await crmDurum('ertele', t, { bas: bas.toISOString(), not: temizle(v.not, 1000) || undefined });
  return { tamam: true, toplanti: yeni, crm, wa: wa('ertele', yeni) };
}

async function iptal(v) {
  if (!kimlikVarMi()) throw new ToplantiHatasi(503, 'kimlik-yok');
  const jeton = await erisimJetonu();
  const { e, t } = await etkinlikAl(jeton, v.id);
  if (!t.duzenlenebilir) throw new ToplantiHatasi(403, 'duzenlenemez');
  const haber = v.haberVer !== false && t.davetli;
  await google(jeton, 'DELETE', takvimYolu(e.id) + `?sendUpdates=${haber ? 'all' : 'none'}`);
  console.log('[toplanti] iptal', e.id);
  const crm = await crmDurum('iptal', t, { not: temizle(v.not, 1000) || undefined });
  return { tamam: true, crm, wa: wa('iptal', t) };
}

async function gorustuk(v) {
  if (!kimlikVarMi()) throw new ToplantiHatasi(503, 'kimlik-yok');
  const jeton = await erisimJetonu();
  const { e, t } = await etkinlikAl(jeton, v.id);
  if (!t.duzenlenebilir) throw new ToplantiHatasi(403, 'duzenlenemez');
  const not = temizle(v.not, 1000);
  const p = { ...((e.extendedProperties && e.extendedProperties.private) || {}), durum: 'gorusuldu' };
  const yama = { extendedProperties: { private: p } };
  if (not) yama.description = `${e.description || ''}\n\nGörüşme notu:\n${not}`.trim();
  const y = await google(jeton, 'PATCH', takvimYolu(e.id) + '?sendUpdates=none', yama);
  console.log('[toplanti] gorusuldu', e.id);
  const crm = await crmDurum('gorustuk', t, { not: not || undefined });
  return { tamam: true, toplanti: temsil(y) || { ...t, durum: 'gorusuldu' }, crm };
}

/** CRM'e (yeniden) yaz: CRM o an kapalıydı, ya da birden çok kayıt uydu ve kullanıcı birini seçti. */
async function crmeYaz(v) {
  if (!crmAyarli()) throw new ToplantiHatasi(503, 'crm-kapali');
  if (!kimlikVarMi()) throw new ToplantiHatasi(503, 'kimlik-yok');
  const jeton = await erisimJetonu();
  const { e, t } = await etkinlikAl(jeton, v.id);
  const firmaId = FIRMA_ID.test(String(v.firmaId || '')) ? String(v.firmaId) : null;
  const crm = await crmPlanla(jeton, e, t.kisi, { bas: new Date(t.bas), sekil: t.sekil, meet: t.meet, not: null, firmaId });
  return { tamam: true, toplanti: temsil(e), crm };
}

async function ara(v) {
  const q = temizle(v.q, 80);
  if (!crmAyarli()) return { crm: false, sonuclar: [] };
  if (q.length < 2) return { crm: true, sonuclar: [] };
  const r = await crmAra(q);
  return { crm: true, ok: r.ok, sonuclar: r.sonuclar };
}

/* ---------- Kestirmeler taslağı ---------- */

function taslakTemizle() {
  const simdi = Date.now();
  for (const [k, t] of taslaklar) if (t.bitis <= simdi) taslaklar.delete(k);
  while (taslaklar.size >= TASLAK_SINIRI) taslaklar.delete(taslaklar.keys().next().value);
}

function kartKoku(b) {
  if (process.env.KART_ADRESI) return String(process.env.KART_ADRESI).trim().replace(/\/+$/, '');
  const proto = String(b['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(b['x-forwarded-host'] || b.host || '').split(',')[0].trim();
  return /^[A-Za-z0-9.:[\]-]+$/.test(host) ? `${proto === 'https' ? 'https' : 'http'}://${host}` : '';
}

function taslakAc(v, ctx) {
  const veri = {
    ad: temizle(v.ad, 120), firma: temizle(v.firma, 120),
    telefon: ilkSatir(v.telefon, 40), eposta: ilkSatir(v.eposta, 160).toLowerCase()
  };
  if (!veri.ad && !veri.telefon && !veri.eposta) throw new ToplantiHatasi(400, 'kisi');
  if (veri.eposta && !EPOSTA_DESENI.test(veri.eposta)) veri.eposta = '';
  taslakTemizle();
  const id = crypto.randomBytes(12).toString('base64url');
  taslaklar.set(id, { veri, bitis: Date.now() + TASLAK_OMRU });
  return { tamam: true, id, adres: `${kartKoku(ctx.basliklar)}/toplanti/#t-${id}`, dakika: TASLAK_OMRU / 60e3 };
}

/** Tek kullanımlık: okununca silinir. */
function taslakAl(v) {
  taslakTemizle();
  const id = typeof v.id === 'string' && TASLAK_ID.test(v.id) ? v.id : null;
  const t = id ? taslaklar.get(id) : null;
  if (!t) throw new ToplantiHatasi(404, 'taslak-yok');
  taslaklar.delete(id);
  return { tamam: true, taslak: t.veri };
}

/* ======================= HTTP ======================= */

const ROTALAR = {
  '/api/toplanti': ['GET', liste],
  '/api/toplanti/slotlar': ['GET', slotlar],
  '/api/toplanti/ara': ['POST', ara],
  '/api/toplanti/olustur': ['POST', olustur],
  '/api/toplanti/ertele': ['POST', ertele],
  '/api/toplanti/iptal': ['POST', iptal],
  '/api/toplanti/gorustuk': ['POST', gorustuk],
  '/api/toplanti/crm': ['POST', crmeYaz],
  '/api/toplanti/taslak-al': ['POST', taslakAl],
  '/api/toplanti/isler': ['GET', crmIsler]
};

/**
 * @param {{ yontem: string, yol: string, basliklar: Record<string,string>, govde?: Buffer, ip: string }} ctx
 */
export async function toplantiIstegi(ctx) {
  if (!planKurulduMu()) return cevap(503, { sebep: 'kurulmadi' });

  if (ctx.yontem === 'POST') {
    // /plan ile aynı kalkan: form JSON gönderemez, başka siteden gelen Origin reddedilir.
    if (!String(ctx.basliklar['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return cevap(415, { sebep: 'tur' });
    }
    if (ctx.basliklar.origin && !kokenUyarMi(ctx.basliklar.origin, ctx.basliklar)) {
      return cevap(403, { sebep: 'koken' });
    }
  }

  try {
    if (ctx.yol === '/api/toplanti/taslak') {
      if (ctx.yontem !== 'POST') return cevap(405, { sebep: 'yontem' });
      const kisayol = kisayolAnahtari();
      if (!planYetkili(ctx.basliklar) && !(kisayol && anahtarEsit(bearer(ctx.basliklar), kisayol))) {
        return cevap(401, { sebep: 'oturum' });
      }
      return cevap(200, taslakAc(jsonGovde(ctx), ctx));
    }

    const rota = ROTALAR[ctx.yol];
    if (!rota) return cevap(404, { sebep: 'yok' });
    if (ctx.yontem !== rota[0]) return cevap(405, { sebep: 'yontem' });
    if (!planYetkili(ctx.basliklar)) return cevap(401, { sebep: 'oturum' });
    return cevap(200, await rota[1](rota[0] === 'POST' ? jsonGovde(ctx) : {}, ctx));
  } catch (h) {
    if (h instanceof ToplantiHatasi) return cevap(h.durum, { sebep: h.sebep, ...(h.ek || {}) });
    console.error('[toplanti]', String((h && h.message) || h).slice(0, 200));
    return cevap(502, { sebep: 'takvim-hatasi' });
  }
}
