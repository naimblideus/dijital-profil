import { ayarlar, kimlikVarMi, erisimJetonu, mesgulAraliklar, cakisiyorMu, jsonCevap, takvimKoku } from './takvim.mjs';
import { sahibeBildir } from './bildirim.mjs';
import { crmToplantiYaz } from './crm.mjs';
import { randomUUID } from 'node:crypto';

const EPOSTA_DESENI = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Ziyaretçi görüşme şeklini seçer; geçersiz ya da boşsa Meet.
export const SEKIL_ADI = { meet: 'Google Meet', telefon: 'Telefon', yuzyuze: 'Yüz yüze' };
export const ofisAdresi = () => process.env.OFIS_ADRESI || 'Medipol Teknopark, Ekinciler Cd. No: 19, Kavacık, 34810 Beykoz/İstanbul';

/** Google'dan gelen linki yalnız gerçek bir Meet adresiyse dışarı verir. */
export function meetLinki(e) {
  const aday = e.hangoutLink || ((e.conferenceData && e.conferenceData.entryPoints) || []).find((p) => p.entryPointType === 'video')?.uri;
  return /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(String(aday || '')) ? aday : null;
}

/** Etkinliğin özel alanları: boş değer yazılmaz. */
const ozel = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));

export function temizle(metin, enFazla) {
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
  const sekil = Object.hasOwn(SEKIL_ADI, govde.sekil) ? govde.sekil : 'meet';

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
      `Görüşme şekli: ${SEKIL_ADI[sekil]}${sekil === 'telefon' ? ' — bu numara aranacak' : ''}`,
      cozum ? `İlgilendiği çözüm: ${cozum}` : null,
      not ? `\nNot:\n${not}` : null,
      `\nDijital profil üzerinden talep edildi.`
    ].filter(Boolean);

    const etkinlik = {
      summary: `Görüşme — ${firma} (${SEKIL_ADI[sekil]})`,
      description: satirlar.join('\n'),
      start: { dateTime: bas.toISOString(), timeZone: 'Europe/Istanbul' },
      end: { dateTime: bit.toISOString(), timeZone: 'Europe/Istanbul' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }
    };
    if (eposta) etkinlik.attendees = [{ email: eposta, displayName: ad }];
    // Toplantı ekranı (/toplanti) kişiyi açıklamayı ayrıştırmadan buradan okur; CRM firması sonradan eklenir.
    etkinlik.extendedProperties = { private: ozel({ kart: 'randevu', ad, firma, telefon, eposta, sekil }) };
    if (sekil === 'meet') {
      etkinlik.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
    } else if (sekil === 'yuzyuze') {
      etkinlik.location = ofisAdresi();
    } else {
      etkinlik.location = `Telefon: ${telefon}`;
    }

    const takvimId = a.takvimler[0] || 'primary';
    const y = await fetch(
      `${takvimKoku()}/calendar/v3/calendars/${encodeURIComponent(takvimId)}/events?sendUpdates=${eposta ? 'all' : 'none'}${sekil === 'meet' ? '&conferenceDataVersion=1' : ''}`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json' },
        body: JSON.stringify(etkinlik)
      }
    );
    if (!y.ok) throw new Error('etkinlik yazilamadi: ' + y.status + ' ' + (await y.text()).slice(0, 200));
    const e = await y.json();
    const meet = sekil === 'meet' ? meetLinki(e) : null;
    console.log('[randevu] etkinlik acildi', e.id, sekil);

    // Bildirim gitmese de randevu açıldı; ziyaretçiye hata gösterilmez.
    const kime = process.env.BILDIRIM_EPOSTA;
    if (kime) {
      try {
        await sahibeBildir(jeton, kime, {
          ad, firma, telefon, eposta, cozum, bas, dakika: a.slotDakika, link: e.htmlLink,
          sekil, meet, adres: ofisAdresi()
        });
      } catch (h) {
        console.error('[randevu]', String(h.message || h).slice(0, 300));
      }
    }

    // CRM'e de yaz — yanıtı bekletmez, CRM hatası randevuyu bozmaz (ayar yoksa sessizce atlar).
    randevuyuCrmeYaz({ jeton, takvimId, e, ad, firma, telefon, eposta, cozum, not, bas, sekil, meet }).catch(() => {});

    return jsonCevap({ tamam: true, baslangic: bas.toISOString(), davet: Boolean(eposta), sekil, meet });
  } catch (h) {
    console.error('[randevu]', String(h.message || h).slice(0, 300));
    return jsonCevap({ tamam: false, sebep: 'takvim-hatasi' }, 502);
  }
};

// Karttaki "İlgilendiğiniz çözüm" → CRM ürün kodu. Eşleşen fırsat yoksa CRM açar; listede olmayan çözüm
// (Dekor, Klinik, Ar-Ge) fırsatsız yazılır, yalnız nota girer.
const COZUM_URUN = {
  'Nextus Servis': 'nexus-servis', Frigora: 'frigora', 'Nextus Makine': 'makine-takip',
  'Nextus Car': 'rent-a-car', 'Nextus Kredi': 'otoprime', 'Nextus Recete': 'recetemaliyet'
};

export async function randevuyuCrmeYaz(t) {
  const r = await crmToplantiYaz({
    islem: 'planla', kaynak: 'kart', etkinlikId: t.e.id, bas: t.bas.toISOString(), sekil: t.sekil, meet: t.meet,
    ad: t.ad, firma: t.firma, telefon: t.telefon, eposta: t.eposta || undefined,
    urun: COZUM_URUN[t.cozum] || undefined,
    not: [t.cozum ? `İlgilendiği çözüm: ${t.cozum}` : null, t.not || null].filter(Boolean).join(' · ') || undefined
  });
  if (r.durum !== 'yazildi') return r;
  // Toplantı ekranında "CRM kartı" bağlantısı için firmayı etkinliğe işle.
  const y = await fetch(
    `${takvimKoku()}/calendar/v3/calendars/${encodeURIComponent(t.takvimId)}/events/${encodeURIComponent(t.e.id)}?sendUpdates=none`,
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + t.jeton, 'Content-Type': 'application/json' },
      body: JSON.stringify({ extendedProperties: { private: ozel({ kart: 'randevu', ad: t.ad, firma: t.firma, telefon: t.telefon, eposta: t.eposta, sekil: t.sekil, crmFirma: r.firmaId }) } })
    }
  );
  if (!y.ok) console.error('[randevu] crm firmasi etkinlige yazilamadi', y.status);
  return r;
}
