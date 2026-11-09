/* DeepCore → Google Takvim aynası: saati olan plan işi telefonun Takvim'inde de görünür.

   Tek yön (plan → takvim). Kurallar:
   - Etkinlik "boş" (transparent) işaretlenir: kart randevuları ve toplantı çakışma denetimi
     bu blokları dolu saymaz; kimse plan işin yüzünden randevu kaçırmaz.
   - extendedProperties.private.deepcore = görev kimliği. Toplantı ekranı kişisiz etkinliği
     zaten göstermez → plan ekranında iş iki kez görünmez.
   - Saat değişirse etkinlik taşınır, iş bitince başına "✓ " gelir, saat kaldırılır ya da iş
     silinirse etkinlik silinir. Eski günlerin etkinliğine dokunulmaz (geçmiş kayıt kalır).
   - Blok başlarken telefon bir kez uyarır (0 dakika hatırlatma).
   - Google bağlı değilse ya da PLAN_TAKVIM=kapali ise hiçbir şey yapmaz. Hata planı bozmaz;
     bir sonraki değişiklikte ya da 15 dakikalık turda yeniden dener. */

import { kimlikVarMi, erisimJetonu, takvimKoku, ayarlar, istanbulDan, istanbulParcalari } from './takvim.mjs';

const ILERI_GUN = 60;
const GERI_GUN = 1;

export function aynaAcikMi() {
  return String(process.env.PLAN_TAKVIM || '').toLowerCase() !== 'kapali' && kimlikVarMi();
}

/** Etkinliği değiştiren alanlar: biri değişince takvim güncellenir. */
export function imza(g) {
  return [g.baslik, g.gun, g.bas, g.bit, g.bitti ? 1 : 0].join('|');
}

function gunMetni(d) {
  const p = istanbulParcalari(d);
  return `${p.yil}-${String(p.ay + 1).padStart(2, '0')}-${String(p.gun).padStart(2, '0')}`;
}
function gunKaydir(gun, n) {
  const d = new Date(gun + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function an(gun, saat) {
  const [y, a, g] = gun.split('-').map(Number);
  const [h, m] = saat.split(':').map(Number);
  return istanbulDan(y, a - 1, g, h, m);                // 24:00 → ertesi gün 00:00, Date.UTC taşır
}

export function etkinlikGovdesi(g) {
  return {
    summary: (g.bitti ? '✓ ' : '') + g.baslik,
    description: 'DeepCore planı — naim.nextusservis.com/plan',
    start: { dateTime: an(g.gun, g.bas).toISOString(), timeZone: 'Europe/Istanbul' },
    end: { dateTime: an(g.gun, g.bit).toISOString(), timeZone: 'Europe/Istanbul' },
    transparency: 'transparent',
    colorId: '8',
    reminders: { useDefault: false, overrides: g.bitti ? [] : [{ method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { deepcore: g.id } }
  };
}

/**
 * Yapılacakları hesaplar (saf fonksiyon).
 * @param {object[]} gorevler planın tüm görevleri
 * @param {Record<string,{e:string,i:string}>} kayit görev kimliği → { e: etkinlik, i: imza }
 * @returns {{ ekle: object[], guncelle: {g:object,e:string}[], sil: {id:string,e:string}[] }}
 */
export function farkHesapla(gorevler, kayit, bugun) {
  const alt = gunKaydir(bugun, -GERI_GUN), ust = gunKaydir(bugun, ILERI_GUN);
  const byId = new Map(gorevler.map((g) => [g.id, g]));
  const ekle = [], guncelle = [], sil = [];
  for (const g of gorevler) {
    if (!g.bas || !g.bit) continue;
    const k = kayit[g.id];
    if (g.gun < alt || g.gun > ust) continue;           // pencere dışı: dokunma
    if (!k) ekle.push(g);
    else if (k.i !== imza(g)) guncelle.push({ g, e: k.e });
  }
  for (const [id, k] of Object.entries(kayit)) {
    const g = byId.get(id);
    if (!g || !g.bas || !g.bit) sil.push({ id, e: k.e });   // silindi ya da saati kalktı
  }
  return { ekle, guncelle, sil };
}

async function google(jeton, yontem, yol, govde) {
  const takvim = encodeURIComponent(ayarlar().takvimler[0] || 'primary');
  const y = await fetch(`${takvimKoku()}/calendar/v3/calendars/${takvim}/events${yol}`, {
    method: yontem,
    headers: { Authorization: 'Bearer ' + jeton, ...(govde ? { 'Content-Type': 'application/json' } : {}) },
    body: govde ? JSON.stringify(govde) : undefined,
    signal: AbortSignal.timeout(15_000)
  });
  if (y.status === 404 || y.status === 410) return { yok: true };
  if (!y.ok) throw new Error('takvim ' + yontem + ' ' + y.status);
  const t = y.status === 204 ? '' : await y.text();
  return t ? JSON.parse(t) : {};
}

/**
 * Farkı Google'a uygular. Başarılı her adım kayda işlenir; hata olan adım bir sonraki tura kalır.
 * @returns {Promise<{ kayit: object, sayilar: {eklendi:number, guncellendi:number, silindi:number, hata:number} }>}
 */
export async function aynala(gorevler, kayit, simdi = new Date()) {
  const yeni = { ...kayit };
  const sayilar = { eklendi: 0, guncellendi: 0, silindi: 0, hata: 0 };
  const f = farkHesapla(gorevler, yeni, gunMetni(simdi));
  if (!f.ekle.length && !f.guncelle.length && !f.sil.length) return { kayit: yeni, sayilar };
  const jeton = await erisimJetonu();
  for (const g of f.ekle) {
    try {
      const e = await google(jeton, 'POST', '?sendUpdates=none', etkinlikGovdesi(g));
      if (e && e.id) { yeni[g.id] = { e: e.id, i: imza(g) }; sayilar.eklendi++; }
    } catch { sayilar.hata++; }
  }
  for (const { g, e } of f.guncelle) {
    try {
      const r = await google(jeton, 'PATCH', '/' + encodeURIComponent(e) + '?sendUpdates=none', etkinlikGovdesi(g));
      if (r.yok) {                                       // takvimden elle silinmiş: yeniden aç
        const n = await google(jeton, 'POST', '?sendUpdates=none', etkinlikGovdesi(g));
        if (n && n.id) yeni[g.id] = { e: n.id, i: imza(g) };
      } else {
        yeni[g.id] = { e, i: imza(g) };
      }
      sayilar.guncellendi++;
    } catch { sayilar.hata++; }
  }
  for (const { id, e } of f.sil) {
    try {
      await google(jeton, 'DELETE', '/' + encodeURIComponent(e) + '?sendUpdates=none');
      delete yeni[id];
      sayilar.silindi++;
    } catch { sayilar.hata++; }
  }
  return { kayit: yeni, sayilar };
}
