/* Google Takvim bağlantısı — bir kez çalıştırılır.
   Kullanım:
     node araclar/takvim-yetki.mjs                      İndirilenler'deki en yeni client_secret_*.json'u bulur
     node araclar/takvim-yetki.mjs <client_secret.json>
     node araclar/takvim-yetki.mjs <CLIENT_ID> <CLIENT_SECRET>
   Tarayıcı açılır, izin verirsiniz. Coolify'a yapıştırılacak satırlar panoya
   kopyalanır; gizli değerler ekrana yazılmaz. */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';

const PORT = 8099;
const YONLENDIRME = `http://localhost:${PORT}`;
const KAPSAMLAR = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/gmail.send',   // yeni talep bildirimi
  'openid',
  'email'                                          // hangi hesabın bağlandığını göstermek için
].join(' ');

function istemciBilgisi(argumanlar) {
  if (argumanlar.length >= 2) return { id: argumanlar[0], gizli: argumanlar[1], kaynak: 'komut satırı' };
  let dosya = argumanlar[0];
  if (!dosya) {
    const klasor = path.join(os.homedir(), 'Downloads');
    const adaylar = fs.existsSync(klasor)
      ? fs.readdirSync(klasor).filter((f) => /^client_secret.*\.json$/i.test(f))
          .map((f) => path.join(klasor, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      : [];
    dosya = adaylar[0];
    if (!dosya) return null;
  }
  const v = JSON.parse(fs.readFileSync(dosya, 'utf8'));
  const k = v.installed || v.web || {};
  if (!k.client_id || !k.client_secret) throw new Error('Dosyada client_id / client_secret yok: ' + dosya);
  return { id: k.client_id, gizli: k.client_secret, kaynak: path.basename(dosya) };
}

function panoyaKopyala(metin) {
  const komut = process.platform === 'win32' ? ['clip', []]
    : process.platform === 'darwin' ? ['pbcopy', []]
    : ['xclip', ['-selection', 'clipboard']];
  return new Promise((coz) => {
    try {
      const s = spawn(komut[0], komut[1], { stdio: ['pipe', 'ignore', 'ignore'] });
      s.on('error', () => coz(false));
      s.on('close', (kod) => coz(kod === 0));
      s.stdin.end(metin);
    } catch { coz(false); }
  });
}

function hesapEpostasi(idJeton) {
  try {
    return JSON.parse(Buffer.from(String(idJeton).split('.')[1], 'base64url').toString('utf8')).email || null;
  } catch { return null; }
}

let istemci;
try { istemci = istemciBilgisi(process.argv.slice(2)); }
catch (h) { console.error(h.message); process.exit(1); }
if (!istemci) {
  console.error('Google istemci dosyası bulunamadı. İndirilenler klasöründe client_secret_....json olmalı,');
  console.error('ya da yolunu verin:  node araclar/takvim-yetki.mjs C:\\yol\\client_secret.json');
  process.exit(1);
}

const izinAdresi = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: istemci.id,
  redirect_uri: YONLENDIRME,
  response_type: 'code',
  scope: KAPSAMLAR,
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true'
});

const SAYFA = (baslik, metin, renk) => `<!doctype html><meta charset="utf-8">
<title>${baslik}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B1220;
color:#F2EFE8;font:500 17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
div{max-width:420px;padding:32px;background:#121C30;border-radius:18px;text-align:center}
b{display:block;font-size:22px;font-weight:700;margin-bottom:8px;color:${renk}}
p{margin:0;color:#A9B0BD;font-size:15px}</style>
<div><b>${baslik}</b><p>${metin}</p></div>`;

const sunucu = http.createServer(async (istek, cevap) => {
  const adres = new URL(istek.url, YONLENDIRME);
  const kod = adres.searchParams.get('code');
  const hata = adres.searchParams.get('error');

  if (hata) {
    cevap.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    cevap.end(SAYFA('İzin verilmedi', 'Pencereyi kapatıp tekrar deneyebilirsiniz.', '#E5876A'));
    console.error('\nİzin reddedildi:', hata);
    sunucu.close(); process.exit(1);
  }
  if (!kod) { cevap.writeHead(204); cevap.end(); return; }

  try {
    const y = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: kod, client_id: istemci.id, client_secret: istemci.gizli,
        redirect_uri: YONLENDIRME, grant_type: 'authorization_code'
      })
    });
    const v = await y.json();
    if (!v.refresh_token) throw new Error('Google yenileme jetonu vermedi (' + (v.error || y.status) + ').');

    const izinler = String(v.scope || '');
    const eposta = hesapEpostasi(v.id_token);

    // Jeton gerçekten çalışıyor mu: önümüzdeki 24 saatin boş/dolu bilgisini oku.
    const fb = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + v.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: new Date().toISOString(),
        timeMax: new Date(Date.now() + 86400e3).toISOString(),
        items: [{ id: 'primary' }]
      })
    });

    cevap.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    cevap.end(SAYFA('Bağlandı', 'Bu pencereyi kapatabilirsiniz. Gerisi terminalde.', '#3DB8BC'));
    sunucu.close();

    const satirlar = [
      `GOOGLE_CLIENT_ID=${istemci.id}`,
      `GOOGLE_CLIENT_SECRET=${istemci.gizli}`,
      `GOOGLE_REFRESH_TOKEN=${v.refresh_token}`,
      eposta ? `BILDIRIM_EPOSTA=${eposta}` : null
    ].filter(Boolean).join('\n') + '\n';

    console.log('\n=== GOOGLE BAĞLANDI ===');
    console.log('Hesap:              ' + (eposta || '(e-posta okunamadı)'));
    console.log('Takvim okuma:       ' + (fb.ok ? 'çalışıyor' : 'HATA ' + fb.status));
    console.log('Bildirim e-postası: ' + (izinler.includes('gmail.send')
      ? 'izin var'
      : 'İZİN VERİLMEDİ — talepler yine takvime düşer, e-posta gelmez'));

    if (await panoyaKopyala(satirlar)) {
      console.log('\nCoolify satırları PANOYA kopyalandı (gizli değerler ekrana yazılmadı).');
    } else {
      const dosya = path.join(os.homedir(), 'nextus-takvim-ortam.txt');
      fs.writeFileSync(dosya, satirlar, { mode: 0o600 });
      console.log('\nPanoya kopyalanamadı; satırlar şu dosyada: ' + dosya);
      console.log('Coolify\'a yapıştırdıktan sonra bu dosyayı SİLİN.');
    }
    console.log('\nŞimdi: Coolify → uygulama → Environment Variables → Developer view → yapıştır → Save → Redeploy.');
    process.exit(0);
  } catch (h) {
    cevap.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    cevap.end(SAYFA('Hata', String(h.message || h), '#E5876A'));
    console.error('\nHATA:', h.message || h);
    sunucu.close(); process.exit(1);
  }
});

sunucu.listen(PORT, () => {
  console.log('Google istemcisi: ' + istemci.kaynak);
  console.log('\nTarayıcı açılıyor. Google hesabınızla izin verin.');
  console.log('Açılmazsa şu adresi elle açın:\n\n' + izinAdresi + '\n');
  const komut = process.platform === 'win32' ? `start "" "${izinAdresi}"`
    : process.platform === 'darwin' ? `open "${izinAdresi}"` : `xdg-open "${izinAdresi}"`;
  exec(komut, () => {});
});
