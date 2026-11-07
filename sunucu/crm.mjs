/* Nexus CRM bağlantısı — sunucudan sunucuya, jetonlu.
   Ortam:
     NEXUS_CRM_URL    CRM kök adresi (ör. https://crm.nextusservis.com). Yoksa CRM özellikleri KAPALI.
     NEXUS_CRM_TOKEN  CRM'deki WEBHOOK_TOKEN'ın aynısı (x-nexus-token başlığı).
   CRM yoksa ya da hata verirse takvim tarafı yine çalışır; buradan hiçbir hata dışarı fırlamaz.
   Kişi verisi URL'ye konmaz (arama da POST gövdesinde) ve günlüğe yazılmaz: yalnız durum kodu. */

const ZAMAN_ASIMI = 6000;

export function crmAyarli() {
  return Boolean(crmKoku() && process.env.NEXUS_CRM_TOKEN);
}

/** Sondaki eğik çizgisiz kök; yalnız http(s). */
export function crmKoku() {
  const u = String(process.env.NEXUS_CRM_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(u) ? u : '';
}

/** CRM'deki göreli yolu (/firma/<id>) tam adrese çevirir; yalnız beklenen biçim geçer. */
export function crmAdresi(yol) {
  return typeof yol === 'string' && /^\/firma\/[A-Za-z0-9_-]{1,60}$/.test(yol) && crmKoku() ? crmKoku() + yol : null;
}

/** @returns {Promise<{ ok: boolean, durum: number, v: any }>}  durum 0 = ağ hatası ya da zaman aşımı */
async function crmIstek(yol, govde, zamanAsimi = ZAMAN_ASIMI) {
  if (!crmAyarli()) return { ok: false, durum: -1, v: {} };
  try {
    const c = await fetch(crmKoku() + yol, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nexus-token': process.env.NEXUS_CRM_TOKEN },
      body: JSON.stringify(govde),
      signal: AbortSignal.timeout(zamanAsimi)
    });
    let v = {};
    try { v = await c.json(); } catch { /* boş gövde */ }
    if (!c.ok) console.error('[crm]', yol, c.status);
    return { ok: c.ok, durum: c.status, v: v || {} };
  } catch (h) {
    console.error('[crm]', yol, h && h.name === 'TimeoutError' ? 'zaman-asimi' : 'ag-hatasi');
    return { ok: false, durum: 0, v: {} };
  }
}

/** Kişi/firma arama: en çok 10 satır, her satırda CRM kartının tam adresi. */
export async function crmAra(q) {
  const r = await crmIstek('/api/toplanti/ara', { q });
  if (!r.ok || !Array.isArray(r.v.sonuclar)) return { ok: false, durum: r.durum, sonuclar: [] };
  const metin = (x, n) => (typeof x === 'string' ? x.slice(0, n) : null);
  return {
    ok: true,
    sonuclar: r.v.sonuclar.slice(0, 10).map((s) => ({
      firmaId: metin(s.firmaId, 60),
      firma: metin(s.firma, 160),
      kisi: metin(s.kisi, 120),
      telefon: metin(s.telefon, 40),
      eposta: metin(s.eposta, 160),
      aranmasin: s.aranmasin === true,
      adres: crmAdresi(s.yol)
    })).filter((s) => s.firmaId)
  };
}

/**
 * Toplantıyı CRM'e yazar (planla | ertele | iptal | gorustuk) ve sonucu ekranın anlayacağı tek duruma indirir:
 *   yazildi  → { firmaId, adres }       belirsiz → { adaylar: [{ firmaId, ad, adres }] }
 *   yetersiz → telefon/e-posta/firma adı yok    bulunamadi → CRM bu toplantıyı tanımıyor
 *   kapali   → ayar yok                  hata     → CRM'e ulaşılamadı ya da jeton reddedildi
 */
export async function crmToplantiYaz(govde) {
  if (!crmAyarli()) return { durum: 'kapali' };
  const r = await crmIstek('/api/toplanti', govde);
  if (r.ok && typeof r.v.firmaId === 'string') {
    return { durum: 'yazildi', firmaId: r.v.firmaId, adres: crmAdresi(r.v.yol), yeniFirma: r.v.yeniFirma === true };
  }
  if (r.durum === 409 && Array.isArray(r.v.adaylar)) {
    return {
      durum: 'belirsiz',
      adaylar: r.v.adaylar.slice(0, 5)
        .filter((a) => a && typeof a.firmaId === 'string')
        .map((a) => ({ firmaId: a.firmaId.slice(0, 60), ad: String(a.ad || '').slice(0, 160), adres: crmAdresi(a.yol) }))
    };
  }
  if (r.durum === 422) return { durum: 'yetersiz' };
  if (r.durum === 404) return { durum: 'bulunamadi' };
  return { durum: 'hata' };
}
