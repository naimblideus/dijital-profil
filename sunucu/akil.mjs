/* "Kafama at" cümlesini Claude ile işe çevirir: temiz başlık, önem/aciliyet önerisi, varsa gün ve saat.

   Ortam: ANTHROPIC_API_KEY (yoksa kapalı; cümle olduğu gibi tek iş olarak eklenir).
          AKIL_MODEL (varsayılan claude-opus-5-5)

   Bu depo bilerek harici paketsizdir (Dockerfile'da npm install yok), bu yüzden SDK yerine düz HTTP.
   Öneri yalnız ÖNERİDİR: kadranı kullanıcı onaylar. Hata, zaman aşımı ya da ret durumunda null döner
   ve çağıran cümleyi olduğu gibi ekler — sesle ekleme hiçbir koşulda kaybolmaz. */

const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;
const GUN = /^\d{4}-\d{2}-\d{2}$/;

export function akilAcikMi() {
  return String(process.env.ANTHROPIC_API_KEY || '').trim().length >= 20;
}

const kok = () => String(process.env.ANTHROPIC_API_KOK || 'https://api.anthropic.com').replace(/\/+$/, '');

const SEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isler'],
  properties: {
    isler: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['baslik', 'kadran', 'gun', 'bas', 'bit', 'toplanti'],
        properties: {
          baslik: { type: 'string' },
          kadran: { type: 'integer', enum: [1, 2, 3, 4] },
          gun: { type: ['string', 'null'] },
          bas: { type: ['string', 'null'] },
          bit: { type: ['string', 'null'] },
          toplanti: { type: 'boolean' }
        }
      }
    }
  }
};

const SISTEM = `Bir kurucunun (CEO ve CTO) sesle söylediği notu yapılacak işlere çeviriyorsun. Not Türkçe dikte edilmiştir; yazım hatası ve noktalama eksikliği olabilir.

Her iş için:
- baslik: kısa, eylemle başlayan, düzgün yazılmış Türkçe başlık. Kişi ve firma adlarını koru. Söylenmeyen ayrıntı ekleme.
- kadran (önem/aciliyet önerisi):
  1 = acil ve önemli (bugün yapılmalı, süresi dolan, müşteriyi ya da geliri doğrudan etkileyen)
  2 = önemli ama acil değil (ürün, strateji, ekip, öğrenme, sağlık; planlanmalı)
  3 = acil ama önemsiz (hızlı halledilecek ufak iş, başkasına da verilebilir)
  4 = ikisi de değil (yalnız açıkça gereksiz görünen)
  Emin değilsen 2 seç; 4'ü çok nadir kullan.
- gun: iş başka bir güne aitse o gün (YYYY-AA-GG); bugün için ya da gün belirtilmemişse null. "yarın", "cuma", "haftaya salı" gibi ifadeleri verilen bugünün tarihine göre çevir.
- bas ve bit: yalnız notta saat söylendiyse 24 saatlik "SS:DD". Bitiş söylenmediyse: görüşme için başlangıçtan 30 dakika, diğer işler için 60 dakika sonrası. Saat yoksa ikisi de null.
- toplanti: biriyle görüşme, toplantı ya da arama randevusuysa true.

Tek cümlede birden çok iş varsa ayır. Not iş içermiyorsa (boş laf, deneme) tek bir iş olarak aynen döndür, kadran 2.`;

/**
 * @param {string} metin dikte edilen cümle
 * @param {{ bugun: string, gunAdi: string, uclu: string[] }} baglam
 * @returns {Promise<null | { baslik: string, kadran: number, gun: string|null, bas: string|null, bit: string|null, toplanti: boolean }[]>}
 */
export async function isleriCikar(metin, baglam) {
  if (!akilAcikMi()) return null;
  try {
    const kullanici = [
      `Bugün: ${baglam.bugun} (${baglam.gunAdi}).`,
      baglam.uclu.length ? `Bugünün en önemli işleri: ${baglam.uclu.join(' · ')}` : null,
      '',
      'Not:',
      metin
    ].filter((x) => x !== null).join('\n');
    const y = await fetch(kok() + '/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': String(process.env.ANTHROPIC_API_KEY).trim(),
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01'
      },
      body: JSON.stringify({
        model: process.env.AKIL_MODEL || 'claude-opus-5-5',
        max_tokens: 2000,
        system: SISTEM,
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SEMA } },
        messages: [{ role: 'user', content: kullanici }]
      }),
      signal: AbortSignal.timeout(25_000)
    });
    if (!y.ok) {
      console.error('[akil] API', y.status);
      return null;
    }
    const v = await y.json();
    if (v.stop_reason !== 'end_turn') return null;                    // ret ya da kesilme: düz ekle
    const blok = (v.content || []).find((b) => b.type === 'text');
    const veri = JSON.parse(blok.text);
    const isler = [];
    for (const i of (veri.isler || []).slice(0, 8)) {
      const baslik = String(i.baslik || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!baslik) continue;
      let bas = typeof i.bas === 'string' && SAAT.test(i.bas) ? i.bas : null;
      let bit = typeof i.bit === 'string' && (SAAT.test(i.bit) || i.bit === '24:00') ? i.bit : null;
      if (!bas || !bit || bit <= bas) { bas = null; bit = null; }
      isler.push({
        baslik,
        kadran: [1, 2, 3, 4].includes(i.kadran) ? i.kadran : 2,
        gun: typeof i.gun === 'string' && GUN.test(i.gun) && !Number.isNaN(Date.parse(i.gun + 'T12:00:00Z')) ? i.gun : null,
        bas, bit,
        toplanti: i.toplanti === true
      });
    }
    return isler.length ? isler : null;
  } catch (h) {
    console.error('[akil]', String((h && h.name) || h).slice(0, 60));
    return null;
  }
}
