import { gmailKoku, istanbulParcalari } from './takvim.mjs';

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** "6 Ekim Pazartesi, 11:00" — İstanbul saatiyle. */
export function istanbulMetni(d) {
  const p = istanbulParcalari(d);
  return `${p.gun} ${AYLAR[p.ay]} ${GUNLER[p.haftaGunu]}, ${String(p.saat).padStart(2, '0')}:${String(p.dakika).padStart(2, '0')}`;
}

const b64 = (metin) => Buffer.from(metin, 'utf8').toString('base64');

/**
 * Yeni talebi sahibine e-postayla bildirir (Gmail API, gmail.send izni).
 * Takvime API'yle yazılan etkinlik sahibine bildirim düşürmediği için bu
 * olmadan talep ancak takvim açılınca görülür.
 */
export async function sahibeBildir(jeton, kime, t) {
  const alici = String(kime).replace(/[\r\n]/g, '').trim();
  const zaman = istanbulMetni(t.bas);
  const satirlar = [
    `${t.ad} (${t.firma}) görüşme istedi.`,
    '',
    `Zaman: ${zaman} (İstanbul, ${t.dakika} dk)`,
    `Telefon: ${t.telefon}`,
    t.eposta ? `E-posta: ${t.eposta} — takvim daveti gönderildi` : 'E-posta vermedi, davet gitmedi.',
    t.cozum ? `İlgilendiği çözüm: ${t.cozum}` : null,
    '',
    t.link ? `Takvimde aç: ${t.link}` : null,
    'Uymuyorsa etkinliği takvimde taşı ya da sil.'
  ].filter((s) => s !== null);

  const govde = b64(satirlar.join('\r\n')).match(/.{1,76}/g).join('\r\n');
  const ileti = [
    `To: ${alici}`,
    `Subject: =?UTF-8?B?${b64(`Randevu talebi: ${t.firma} — ${zaman}`)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    govde
  ].join('\r\n');

  const y = await fetch(gmailKoku() + '/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(ileti, 'utf8').toString('base64url') })
  });
  if (!y.ok) throw new Error('bildirim gonderilemedi: ' + y.status + ' ' + (await y.text()).slice(0, 200));
}
