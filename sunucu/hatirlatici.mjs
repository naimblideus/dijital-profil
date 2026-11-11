/* Telegram hatırlatması — sabah "Bugünün 3'ü", akşam "Yarını kur".

   Ortam:
     TELEGRAM_BOT_TOKEN  botun anahtarı      ┐ ikisi de yoksa hatırlatma tamamen KAPALI
     TELEGRAM_CHAT_ID    mesajın gideceği kişi ┘
     HATIRLAT_SABAH      varsayılan 08:30 (İstanbul)
     HATIRLAT_AKSAM      varsayılan 21:00 (İstanbul)
     KART_ADRESI         "Planı aç" düğmesinin kökü (varsayılan https://naim.nextusservis.com)
     HATIRLAT_TOPLANTI   toplantıdan kaç dakika önce haber verilsin (varsayılan 15; 0 = kapalı)

   Toplantılar: takvimdeki kişili her toplantı (kart randevuları dahil) başlamadan önce bir kez
   hatırlatılır ve sabah mesajında "Bugünkü görüşmeler" olarak listelenir.

   Kurallar:
   - Her mesaj günde EN ÇOK BİR KEZ. Gönderim kaydı plan klasöründe (hatirlatma.json) durur,
     sunucu yeniden başlasa da aynı gün ikinci kez gitmez.
   - Saatinden sonraki 90 dakika içinde gider; sunucu o arada kapalıysa o günkü mesaj atlanır
     (öğlen gelen "günaydın" işe yaramaz).
   - Telegram hata verirse plan da sunucu da etkilenmez; bir sonraki dakika yeniden denenir.
   - Anahtar hiçbir günlüğe yazılmaz. */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { istanbulParcalari } from './takvim.mjs';
import { planGorevleri } from './plan.mjs';
import { yaklasanToplantilar } from './toplanti.mjs';

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const PENCERE_DK = 90;
const SAAT = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TURLER = {
  sabah: { ortam: 'HATIRLAT_SABAH', varsayilan: '08:30' },
  aksam: { ortam: 'HATIRLAT_AKSAM', varsayilan: '21:00' }
};

let kayitBellek = null;            // { sabah: 'YYYY-AA-GG', aksam: 'YYYY-AA-GG' }
let calisiyor = false;
let hataGunu = {};                 // aynı hatayı her dakika günlüğe yazmamak için
let toplantiBellek = { zaman: 0, liste: [] };   // takvim her dakika sorulmaz: 5 dakikada bir

/** Testler için: yeniden başlatmayı taklit eder (bellek boşalır, disk kaydı kalır). */
export function hatirlaticiSifirla() { kayitBellek = null; calisiyor = false; hataGunu = {}; toplantiBellek = { zaman: 0, liste: [] }; }

function botAnahtari() {
  const t = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(t) ? t : null;
}
function sohbetKimligi() {
  const c = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  return /^-?\d{1,20}$/.test(c) ? c : null;
}
export function hatirlaticiAcikMi() { return Boolean(botAnahtari() && sohbetKimligi()); }

const telegramKoku = () => String(process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '');
const planAdresi = () =>
  String(process.env.KART_ADRESI || 'https://naim.nextusservis.com').trim().replace(/\/+$/, '') + '/plan/';

function saatDakikasi(tur) {
  const t = TURLER[tur];
  const m = SAAT.exec(String(process.env[t.ortam] || '').trim()) || SAAT.exec(t.varsayilan);
  return Number(m[1]) * 60 + Number(m[2]);
}

function gunMetni(p) {
  return `${p.yil}-${String(p.ay + 1).padStart(2, '0')}-${String(p.gun).padStart(2, '0')}`;
}
function ertesiGun(gun) {
  const d = new Date(gun + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ---------- gönderim kaydı ---------- */

function kayitDosyasi() {
  const klasor = path.resolve(process.env.PLAN_VERI || path.join(BURASI, '..', 'veri'));
  return path.join(klasor, 'hatirlatma.json');
}
function kayitOku() {
  if (kayitBellek) return kayitBellek;
  try {
    const v = JSON.parse(fs.readFileSync(kayitDosyasi(), 'utf8'));
    kayitBellek = {
      sabah: typeof v.sabah === 'string' ? v.sabah : null, aksam: typeof v.aksam === 'string' ? v.aksam : null,
      toplanti: Array.isArray(v.toplanti) ? v.toplanti.filter((x) => typeof x === 'string').slice(-200) : []
    };
  } catch {
    kayitBellek = { sabah: null, aksam: null, toplanti: [] };
  }
  return kayitBellek;
}
async function kayitYaz(k) {
  kayitBellek = k;                                   // diske yazılamasa da bu süreçte tekrar gitmez
  try {
    const dosya = kayitDosyasi();
    await fsp.mkdir(path.dirname(dosya), { recursive: true });
    await fsp.writeFile(dosya + '.gecici', JSON.stringify(k), 'utf8');
    await fsp.rename(dosya + '.gecici', dosya);
  } catch (h) {
    console.error('[hatirlatma] kayıt yazılamadı:', h && h.code);
  }
}

/* ---------- mesaj metni ---------- */

function siraIle(a, b) {
  return (a.sira ?? 0) - (b.sira ?? 0) || String(a.olusturuldu || '').localeCompare(String(b.olusturuldu || ''));
}
const ucu = (gorevler) => gorevler.filter((g) => g.ust).sort(siraIle).slice(0, 3);

function saatYaz(iso) {
  const p = istanbulParcalari(new Date(iso));
  return `${String(p.saat).padStart(2, '0')}:${String(p.dakika).padStart(2, '0')}`;
}
function toplantiAdi(t) {
  const k = t.kisi || {};
  const ad = [k.ad, k.firma ? `(${k.firma})` : null].filter(Boolean).join(' ');
  return ad || t.baslik || 'Toplantı';
}
const SEKIL = { meet: 'Google Meet', telefon: 'Telefon', yuzyuze: 'Yüz yüze' };

/** Toplantı başlamadan önce giden kısa mesaj. */
export function toplantiMetni(t, dk) {
  const satirlar = [`${dk <= 1 ? 'Şimdi' : dk + ' dk sonra'}: ${toplantiAdi(t)}`, `${saatYaz(t.bas)}–${saatYaz(t.bit)}${SEKIL[t.sekil] ? ' · ' + SEKIL[t.sekil] : ''}`];
  if (t.sekil === 'telefon' && t.kisi && t.kisi.telefon) satirlar.push('Ara: ' + t.kisi.telefon);
  if (t.sekil === 'yuzyuze' && t.yer) satirlar.push(t.yer);
  return satirlar.join('\n');
}

async function toplantilariAl(simdi) {
  if (simdi.getTime() - toplantiBellek.zaman < 5 * 60e3) return toplantiBellek.liste;
  try {
    toplantiBellek = { zaman: simdi.getTime(), liste: await yaklasanToplantilar() };
  } catch (h) {
    toplantiBellek = { zaman: simdi.getTime(), liste: toplantiBellek.liste };
    if (hataGunu.takvim !== 1) { hataGunu.takvim = 1; console.error('[hatirlatma] takvim okunamadı'); }
  }
  return toplantiBellek.liste;
}

/** Sabah: bugünün 3'ü, ilk saat bloğu, kafada bekleyen iş sayısı. */
export function sabahMetni(bugun, toplantilar = []) {
  const satirlar = [];
  const uc = ucu(bugun);
  if (uc.length) {
    satirlar.push("Günaydın. Bugünün 3'ü:");
    uc.forEach((g, i) => satirlar.push(`${i + 1}. ${g.bitti ? '✓ ' : ''}${g.baslik}`));
  } else {
    satirlar.push("Günaydın. Bugünün 3'ünü henüz seçmedin; bir dakikada seç.");
  }
  const ilk = bugun.filter((g) => !g.bitti && g.bas).sort((a, b) => a.bas.localeCompare(b.bas))[0];
  if (ilk) satirlar.push('', `İlk blok: ${ilk.bas}–${ilk.bit} ${ilk.baslik}`);
  const kafada = bugun.filter((g) => !g.bitti && !g.bas && !g.ust).length;
  if (kafada) satirlar.push(`Kafanda ${kafada} iş bekliyor.`);
  if (toplantilar.length) {
    satirlar.push('', 'Bugünkü görüşmeler:');
    toplantilar.forEach((t) => satirlar.push(`• ${saatYaz(t.bas)} ${toplantiAdi(t)}`));
  }
  return satirlar.join('\n');
}

/** Akşam: bugün kaç iş bitti, yarın kurulu mu. */
export function aksamMetni(bugun, yarin) {
  const satirlar = [];
  if (bugun.length) satirlar.push(`Bugün ${bugun.filter((g) => g.bitti).length}/${bugun.length} iş bitti.`);
  const uc = ucu(yarin);
  if (uc.length >= 3) {
    satirlar.push("Yarın hazır ✓");
    uc.forEach((g, i) => satirlar.push(`${i + 1}. ${g.baslik}`));
  } else {
    satirlar.push("Yarını kur (2 dakika): 3 işini seç, saatlere yerleştir.");
    if (uc.length) {
      satirlar.push(`Seçili ${uc.length}/3:`);
      uc.forEach((g, i) => satirlar.push(`${i + 1}. ${g.baslik}`));
    }
  }
  return satirlar.join('\n');
}

/* ---------- gönderim ---------- */

async function gonder(metin, dugme) {
  const y = await fetch(`${telegramKoku()}/bot${botAnahtari()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: sohbetKimligi(),
      text: metin,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[dugme || { text: 'Planı aç', url: planAdresi() }]] }
    }),
    signal: AbortSignal.timeout(10_000)
  });
  const j = await y.json().catch(() => ({}));
  if (!y.ok || !j.ok) throw new Error('telegram ' + y.status);
}

/**
 * Şu an gönderilmesi gereken hatırlatma varsa gönderir.
 * @returns {Promise<string[]>} bu çağrıda gidenler ('sabah' | 'aksam')
 */
export async function hatirlatKontrol(simdi = new Date()) {
  if (!hatirlaticiAcikMi() || calisiyor) return [];
  calisiyor = true;
  const giden = [];
  try {
    const p = istanbulParcalari(simdi);
    const gun = gunMetni(p);
    const dk = p.saat * 60 + p.dakika;
    for (const tur of Object.keys(TURLER)) {
      const bas = saatDakikasi(tur);
      if (dk < bas || dk >= bas + PENCERE_DK) continue;
      const kayit = kayitOku();
      if (kayit[tur] === gun) continue;
      try {
        const bugun = await planGorevleri(gun);
        const gunun = tur === 'sabah'
          ? (await toplantilariAl(simdi)).filter((t) => gunMetni(istanbulParcalari(new Date(t.bas))) === gun && t.durum !== 'gorusuldu')
          : [];
        const metin = tur === 'sabah' ? sabahMetni(bugun, gunun) : aksamMetni(bugun, await planGorevleri(ertesiGun(gun)));
        await gonder(metin);
        await kayitYaz({ ...kayit, [tur]: gun });
        giden.push(tur);
      } catch (h) {
        if (hataGunu[tur] !== gun) {
          hataGunu[tur] = gun;
          console.error('[hatirlatma]', tur, String((h && h.message) || h).slice(0, 120));
        }
      }
    }
    // Toplantı hatırlatması: başlamasına N dakika kala, her toplantı için bir kez.
    const once = Number.isFinite(Number(process.env.HATIRLAT_TOPLANTI)) && process.env.HATIRLAT_TOPLANTI !== ''
      ? Number(process.env.HATIRLAT_TOPLANTI) : 15;
    if (once > 0) {
      for (const t of await toplantilariAl(simdi)) {
        const kalan = (Date.parse(t.bas) - simdi.getTime()) / 60e3;
        if (kalan > once || kalan < -2 || t.durum === 'gorusuldu') continue;
        const anahtar = t.id + '@' + t.bas;                // ertelenirse yeni saat için yeniden hatırlatır
        const kayit = kayitOku();
        if ((kayit.toplanti || []).includes(anahtar)) continue;
        try {
          await gonder(toplantiMetni(t, Math.max(0, Math.round(kalan))), t.meet ? { text: 'Meet’e katıl', url: t.meet } : null);
          await kayitYaz({ ...kayit, toplanti: [...(kayit.toplanti || []), anahtar].slice(-200) });
          giden.push('toplanti');
        } catch (h) {
          if (hataGunu.toplanti !== gun) { hataGunu.toplanti = gun; console.error('[hatirlatma] toplanti', String((h && h.message) || h).slice(0, 120)); }
        }
      }
    }
  } finally {
    calisiyor = false;
  }
  return giden;
}

/** Sunucu açılırken çağrılır; ortam yoksa hiçbir şey yapmaz. */
export function hatirlaticiBaslat() {
  if (!hatirlaticiAcikMi()) {
    console.log('[hatirlatma] kapalı (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID yok)');
    return null;
  }
  const calis = () => { hatirlatKontrol().catch(() => {}); };
  setTimeout(calis, 5_000).unref();
  const t = setInterval(calis, 60_000);
  t.unref();
  const saat = (tur) => { const d = saatDakikasi(tur); return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`; };
  console.log(`[hatirlatma] açık · sabah ${saat('sabah')} · akşam ${saat('aksam')}`);
  return t;
}
