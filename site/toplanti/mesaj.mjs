/* Toplantı ekranının WhatsApp metinleri — sunucu (yanıt ve test) ile sayfa AYNI dosyayı kullanır.
   Mesaj KENDİLİĞİNDEN GİTMEZ: yalnız wa.me bağlantısı üretilir, kullanıcı WhatsApp'ta kendisi basar.
   Saatler İstanbul'a göre (UTC+3, yaz saati yok) — cihazın saat diliminden bağımsız. */

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const IMZA = 'Mehmet Naim Çetin';

/** İstanbul duvar saati parçaları. */
export function istanbul(iso) {
  const d = new Date(new Date(iso).getTime() + 3 * 3600e3);
  return {
    yil: d.getUTCFullYear(), ay: d.getUTCMonth(), gun: d.getUTCDate(), haftaGunu: d.getUTCDay(),
    saat: String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0')
  };
}

/** "12 Kasım Perşembe, 14:00" */
export function zamanMetni(iso) {
  const p = istanbul(iso);
  return `${p.gun} ${AYLAR[p.ay]} ${GUNLER[p.haftaGunu]}, ${p.saat}`;
}

/** WhatsApp numarası: yalnız rakam, Türkiye numarası 90 önekli. Geçersizse null. */
export function waNumara(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = '90' + d.slice(1);
  else if (d.length === 10 && d.startsWith('5')) d = '90' + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** Numara yoksa wa.me/?text= — WhatsApp kişi seçtirir. */
export function waLinki(tel, metin) {
  const n = waNumara(tel);
  return `https://wa.me/${n || ''}?text=${encodeURIComponent(metin)}`;
}

function selam(ad) {
  const ilk = String(ad || '').trim().split(/\s+/)[0];
  return ilk ? `Merhaba ${ilk},` : 'Merhaba,';
}

function sekilSatiri(t) {
  if (t.sekil === 'telefon') return 'Sizi telefonla arayacağım.';
  if (t.sekil === 'yuzyuze') return t.yer ? `Yer: ${t.yer}` : 'Yüz yüze görüşeceğiz.';
  if (t.sekil === 'meet' || t.meet) return t.meet ? `Google Meet: ${t.meet}` : 'Google Meet bağlantısı takvim davetinde.';
  return null;
}

/**
 * @param {'planla'|'hatirlat'|'ertele'|'iptal'|'randevu'} tur
 * @param {{ kisi?: { ad?: string }, bas?: string, sekil?: string, meet?: string, yer?: string }} t
 * @param {{ davet?: boolean, randevuAdresi?: string }} [ek]
 */
export function mesaj(tur, t, ek = {}) {
  const ad = t && t.kisi ? t.kisi.ad || t.kisi.firma : null;
  const s = [selam(ad)];
  if (tur === 'randevu') {
    s.push('size uygun bir görüşme saatini buradan seçebilirsiniz:', ek.randevuAdresi || '', '', IMZA);
  } else if (tur === 'iptal') {
    s.push(`${zamanMetni(t.bas)} görüşmemizi iptal etmem gerekti, kusura bakmayın.`);
    if (ek.randevuAdresi) s.push('Size uygun yeni bir saati buradan seçebilirsiniz:', ek.randevuAdresi);
    s.push('', IMZA);
  } else {
    s.push(tur === 'ertele' ? 'görüşmemizin saatini değiştirdim.' : tur === 'hatirlat' ? 'görüşmemizi hatırlatmak istedim.' : 'görüşmemizi takvime ekledim.', '');
    s.push(`${tur === 'ertele' ? 'Yeni zaman' : 'Zaman'}: ${zamanMetni(t.bas)}`);
    const sk = sekilSatiri(t);
    if (sk) s.push(sk);
    if (tur === 'planla' && ek.davet) s.push('Takvim davetini e-postanıza da gönderdim.');
    s.push('', tur === 'ertele' ? 'Uymazsa haber verin, yeni saate birlikte bakarız.' : 'Görüşmek üzere,', IMZA);
  }
  return s.join('\n');
}
