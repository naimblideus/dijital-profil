/* "Kafama at" sırası: sesle eklenen cümle plana olduğu gibi düşer ve `bekliyor` işaretiyle sıraya girer.
   Kurucunun bilgisayarındaki Claude (kendi girişiyle, API anahtarı yok) sırayı alır, cümleyi işlere
   ayırıp önem/aciliyet önerir ve geri yazar: bkz. hat/plan-akil.mjs.

   Bu dosya yalnız geri gelen cevabı temizler. Öneri yalnız ÖNERİDİR: kadranı kullanıcı onaylar.
   Bilgisayar kapalıysa iş plandadır, yalnız önerisi gecikir — sesle ekleme hiçbir koşulda kaybolmaz. */

const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;
const GUN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {unknown} ham bilgisayardan gelen iş listesi
 * @returns {null | { baslik: string, kadran: number, gun: string|null, bas: string|null, bit: string|null }[]}
 */
export function isleriTemizle(ham) {
  if (!Array.isArray(ham)) return null;
  const isler = [];
  for (const i of ham.slice(0, 8)) {
    if (!i || typeof i !== 'object') continue;
    const baslik = String(i.baslik || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!baslik) continue;
    let bas = typeof i.bas === 'string' && SAAT.test(i.bas) ? i.bas : null;
    let bit = typeof i.bit === 'string' && (SAAT.test(i.bit) || i.bit === '24:00') ? i.bit : null;
    if (!bas || !bit || bit <= bas) { bas = null; bit = null; }
    isler.push({
      baslik,
      kadran: [1, 2, 3, 4].includes(i.kadran) ? i.kadran : 2,
      gun: typeof i.gun === 'string' && GUN.test(i.gun) && !Number.isNaN(Date.parse(i.gun + 'T12:00:00Z')) ? i.gun : null,
      bas, bit
    });
  }
  return isler.length ? isler : null;
}
