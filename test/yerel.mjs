/* Yerel deneme — gerçek hesaba dokunmaz.
     node test/yerel.mjs [port]               sahte Google ile (takvim kipi)
     node test/yerel.mjs [port] --takvimsiz   Google yok (WhatsApp kipi) */

import { sahteGoogleBaslat } from './sahte-google.mjs';
import { sunucuOlustur } from '../sunucu/sunucu.mjs';
import { istanbulDan, istanbulParcalari } from '../sunucu/takvim.mjs';

const port = Number(process.argv[2]) || 3090;
const takvimsiz = process.argv.includes('--takvimsiz');

let not = 'Google yok — WhatsApp kipi';
if (!takvimsiz) {
  const google = await sahteGoogleBaslat();
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'sahte-id',
    GOOGLE_CLIENT_SECRET: 'sahte-gizli',
    GOOGLE_REFRESH_TOKEN: 'sahte-yenileme',
    BILDIRIM_EPOSTA: 'sahip@ornek.com',
    GOOGLE_TOKEN_URL: google.kok + '/token',
    GOOGLE_API_KOK: google.kok,
    GOOGLE_GMAIL_KOK: google.kok
  });
  // Görünür bir boşluk olsun: iki gün sonra 10:00–11:00 dolu.
  const p = istanbulParcalari(new Date(Date.now() + 2 * 86400e3));
  const bas = istanbulDan(p.yil, p.ay, p.gun, 10, 0);
  google.durum.mesgul.push({ start: bas.toISOString(), end: new Date(bas.getTime() + 3600e3).toISOString() });
  not = 'sahte Google: ' + google.kok;
}

sunucuOlustur().listen(port, () => console.log(`[yerel] http://localhost:${port} · ${not}`));
