import { ayarlar, kimlikVarMi, erisimJetonu, mesgulAraliklar, slotlariUret, jsonCevap } from './takvim.mjs';

/** GET /api/musait — çalışma saatleri içindeki boş slotlar, günlere göre. */
export default async () => {
  if (!kimlikVarMi()) {
    // Kimlik bilgileri henüz kurulmadı — ön yüz WhatsApp kipine düşer.
    return jsonCevap({ hazir: false, sebep: 'kimlik-yok' }, 503);
  }
  try {
    const a = ayarlar();
    const jeton = await erisimJetonu();
    const simdi = new Date();
    const bitis = new Date(simdi.getTime() + (a.ilerideGun + 1) * 86400e3);
    const mesgul = await mesgulAraliklar(jeton, a.takvimler, simdi, bitis);
    const gunler = slotlariUret(simdi, mesgul, a);
    return jsonCevap({
      hazir: true,
      saatDilimi: 'Europe/Istanbul',
      slotDakika: a.slotDakika,
      gunler
    });
  } catch (h) {
    console.error('[musait]', String(h.message || h).slice(0, 300));
    return jsonCevap({ hazir: false, sebep: 'takvim-hatasi' }, 502);
  }
};
