import { ayarlar, kimlikVarMi, erisimJetonu, mesgulAraliklar, cakisiyorMu, jsonCevap, takvimKoku } from './takvim.mjs';
import { sahibeBildir } from './bildirim.mjs';

const EPOSTA_DESENI = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function temizle(metin, enFazla) {
  return String(metin == null ? '' : metin).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, enFazla);
}

/** POST /api/randevu — seçilen slota takvimde görüşme açar. */
export default async (istek) => {
  if (istek.method !== 'POST') return jsonCevap({ tamam: false, sebep: 'yontem' }, 405);
  if (!kimlikVarMi()) return jsonCevap({ tamam: false, sebep: 'kimlik-yok' }, 503);

  let govde;
  try { govde = await istek.json(); }
  catch { return jsonCevap({ tamam: false, sebep: 'govde' }, 400); }
  if (!govde || typeof govde !== 'object') return jsonCevap({ tamam: false, sebep: 'govde' }, 400);

  // Bal küpü: insan bu alanı görmez; dolduran bot. Başarılı görünür, hiçbir şey yazılmaz.
  if (temizle(govde.sirketAdi, 200)) return jsonCevap({ tamam: true, davet: false });

  const ad = temizle(govde.ad, 120);
  const firma = temizle(govde.firma, 120);
  const telefon = temizle(govde.telefon, 40);
  const eposta = temizle(govde.eposta, 160);
  const cozum = temizle(govde.cozum, 80);
  const not = temizle(govde.not, 600);
  const basISO = temizle(govde.baslangic, 40);

  if (!ad || !firma || !telefon) return jsonCevap({ tamam: false, sebep: 'eksik-alan' }, 400);
  if (eposta && !EPOSTA_DESENI.test(eposta)) return jsonCevap({ tamam: false, sebep: 'eposta-gecersiz' }, 400);

  const bas = new Date(basISO);
  if (isNaN(bas.getTime())) return jsonCevap({ tamam: false, sebep: 'saat-gecersiz' }, 400);
  if (bas.getTime() < Date.now()) return jsonCevap({ tamam: false, sebep: 'gecmis-saat' }, 400);

  try {
    const a = ayarlar();
    const jeton = await erisimJetonu();
    const bit = new Date(bas.getTime() + a.slotDakika * 60000);

    // Yarış koşulu: aynı slotu iki kişi seçebilir — yazmadan hemen önce tekrar bak.
    const mesgul = await mesgulAraliklar(jeton, a.takvimler, bas, bit);
    if (cakisiyorMu(bas, bit, mesgul)) return jsonCevap({ tamam: false, sebep: 'slot-dolu' }, 409);

    const satirlar = [
      `Firma: ${firma}`,
      `Kişi: ${ad}`,
      `Telefon: ${telefon}`,
      eposta ? `E-posta: ${eposta}` : null,
      cozum ? `İlgilendiği çözüm: ${cozum}` : null,
      not ? `\nNot:\n${not}` : null,
      `\nDijital profil üzerinden talep edildi.`
    ].filter(Boolean);

    const etkinlik = {
      summary: `Görüşme — ${firma}`,
      description: satirlar.join('\n'),
      start: { dateTime: bas.toISOString(), timeZone: 'Europe/Istanbul' },
      end: { dateTime: bit.toISOString(), timeZone: 'Europe/Istanbul' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }
    };
    if (eposta) etkinlik.attendees = [{ email: eposta, displayName: ad }];

    const takvimId = a.takvimler[0] || 'primary';
    const y = await fetch(
      `${takvimKoku()}/calendar/v3/calendars/${encodeURIComponent(takvimId)}/events?sendUpdates=${eposta ? 'all' : 'none'}`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json' },
        body: JSON.stringify(etkinlik)
      }
    );
    if (!y.ok) throw new Error('etkinlik yazilamadi: ' + y.status + ' ' + (await y.text()).slice(0, 200));
    const e = await y.json();
    console.log('[randevu] etkinlik acildi', e.id);

    // Bildirim gitmese de randevu açıldı; ziyaretçiye hata gösterilmez.
    const kime = process.env.BILDIRIM_EPOSTA;
    if (kime) {
      try {
        await sahibeBildir(jeton, kime, { ad, firma, telefon, eposta, cozum, bas, dakika: a.slotDakika, link: e.htmlLink });
      } catch (h) {
        console.error('[randevu]', String(h.message || h).slice(0, 300));
      }
    }

    return jsonCevap({ tamam: true, baslangic: bas.toISOString(), davet: Boolean(eposta) });
  } catch (h) {
    console.error('[randevu]', String(h.message || h).slice(0, 300));
    return jsonCevap({ tamam: false, sebep: 'takvim-hatasi' }, 502);
  }
};
