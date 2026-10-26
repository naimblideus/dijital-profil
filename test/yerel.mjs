/* Yerel deneme — gerçek hesaba dokunmaz.
     node test/yerel.mjs [port]                       sahte Google ile (takvim kipi)
     node test/yerel.mjs [port] --takvimsiz           Google yok (WhatsApp kipi)
     node test/yerel.mjs [port] --plan[=plan.md]      DeepCore planı açık (şifre: yerel-sifre),
                                                       veri geçici klasörde; plan.md verilirse yüklenir */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sahteGoogleBaslat } from './sahte-google.mjs';
import { sunucuOlustur } from '../sunucu/sunucu.mjs';
import { istanbulDan, istanbulParcalari } from '../sunucu/takvim.mjs';

const port = Number(process.argv[2]) || 3090;
const takvimsiz = process.argv.includes('--takvimsiz');
const planArg = process.argv.find((a) => a === '--plan' || a.startsWith('--plan='));
if (planArg) {
  Object.assign(process.env, {
    PLAN_SIFRE: 'yerel-sifre',
    PLAN_ANAHTAR: 'yerel-anahtar-yalniz-bu-makinede-0',
    PLAN_VERI: fs.mkdtempSync(path.join(os.tmpdir(), 'plan-yerel-'))
  });
}

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

sunucuOlustur().listen(port, async () => {
  console.log(`[yerel] http://localhost:${port} · ${not}`);
  if (!planArg) return;
  const dosya = planArg.includes('=') ? planArg.slice('--plan='.length) : null;
  if (dosya) {
    const c = await fetch(`http://localhost:${port}/api/plan/yukle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.PLAN_ANAHTAR },
      body: JSON.stringify({ metin: fs.readFileSync(dosya, 'utf8') })
    });
    const v = await c.json();
    console.log(`[yerel] plan yüklendi: ${c.status} ${JSON.stringify(v.ozet || v)}`);
  }
  console.log(`[yerel] plan: http://localhost:${port}/plan/ · şifre: yerel-sifre · veri: ${process.env.PLAN_VERI}`);
});
