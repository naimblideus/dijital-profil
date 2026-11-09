/* Telegram hatırlatması — sabah "Bugünün 3'ü", akşam "Yarını kur".

   Ortam:
     TELEGRAM_BOT_TOKEN  botun anahtarı      ┐ ikisi de yoksa hatırlatma tamamen KAPALI
     TELEGRAM_CHAT_ID    mesajın gideceği kişi ┘
     HATIRLAT_SABAH      varsayılan 08:30 (İstanbul)
     HATIRLAT_AKSAM      varsayılan 21:00 (İstanbul)
     KART_ADRESI         "Planı aç" düğmesinin kökü (varsayılan https://naim.nextusservis.com)

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

/** Testler için: yeniden başlatmayı taklit eder (bellek boşalır, disk kaydı kalır). */
export function hatirlaticiSifirla() { kayitBellek = null; calisiyor = false; hataGunu = {}; }

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
    kayitBellek = { sabah: typeof v.sabah === 'string' ? v.sabah : null, aksam: typeof v.aksam === 'string' ? v.aksam : null };
  } catch {
    kayitBellek = { sabah: null, aksam: null };
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

/** Sabah: bugünün 3'ü, ilk saat bloğu, kafada bekleyen iş sayısı. */
export function sabahMetni(bugun) {
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

async function gonder(metin) {
  const y = await fetch(`${telegramKoku()}/bot${botAnahtari()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: sohbetKimligi(),
      text: metin,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: 'Planı aç', url: planAdresi() }]] }
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
        const metin = tur === 'sabah' ? sabahMetni(bugun) : aksamMetni(bugun, await planGorevleri(ertesiGun(gun)));
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
