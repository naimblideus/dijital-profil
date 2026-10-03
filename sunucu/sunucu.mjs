/* Dijital profil sunucusu — statik site + iki takvim ucu. Harici paket yok.
   Çalıştır:  node sunucu/sunucu.mjs   (PORT varsayılan 3000) */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import musait from './musait.mjs';
import randevu from './randevu.mjs';

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.resolve(process.env.SITE_KOK || path.join(BURASI, '..', 'site'));

const TURLER = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.vcf': 'text/vcard; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4'
};

// Netlify'daki _headers dosyasının karşılığı.
const ORTAK_BASLIKLAR = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Robots-Tag': 'noindex, nofollow'
};

const GOVDE_SINIRI = 16 * 1024;

/* ---------- hız sınırı: takvimi bot doldurmasın ---------- */
const KISI_SINIRI = 5;            // aynı adresten 10 dakikada en fazla
const KISI_PENCERE = 10 * 60e3;
const TOPLAM_SINIRI = 40;         // herkesten bir saatte en fazla
const TOPLAM_PENCERE = 60 * 60e3;
let kisiKayit = new Map();
let toplamKayit = [];

export function hizSiniriniSifirla() { kisiKayit = new Map(); toplamKayit = []; }

function istemciAdresi(istek) {
  const cf = istek.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = istek.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return istek.socket.remoteAddress || '?';
}

function sinirAsildiMi(adres) {
  const simdi = Date.now();
  toplamKayit = toplamKayit.filter((t) => simdi - t < TOPLAM_PENCERE);
  if (toplamKayit.length >= TOPLAM_SINIRI) return true;
  if (kisiKayit.size > 5000) kisiKayit = new Map();
  const izler = (kisiKayit.get(adres) || []).filter((t) => simdi - t < KISI_PENCERE);
  if (izler.length >= KISI_SINIRI) { kisiKayit.set(adres, izler); return true; }
  izler.push(simdi);
  kisiKayit.set(adres, izler);
  toplamKayit.push(simdi);
  return false;
}

/* ---------- yardımcılar ---------- */
function yaz(cevap, durum, basliklar, govde, yalnizBaslik) {
  cevap.writeHead(durum, { ...ORTAK_BASLIKLAR, ...basliklar });
  cevap.end(yalnizBaslik ? undefined : govde);
}

function json(cevap, durum, veri) {
  yaz(cevap, durum, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(veri));
}

function govdeOku(istek) {
  return new Promise((coz, reddet) => {
    const parcalar = [];
    let boy = 0;
    const yukle = (p) => {
      boy += p.length;
      if (boy > GOVDE_SINIRI) {
        // Soketi koparmadan reddet: yanıt istemciye ulaşsın, kalan gövde boşa akar.
        istek.off('data', yukle);
        istek.resume();
        reddet(Object.assign(new Error('buyuk'), { durum: 413 }));
        return;
      }
      parcalar.push(p);
    };
    istek.on('data', yukle);
    istek.on('end', () => coz(Buffer.concat(parcalar)));
    istek.on('error', reddet);
  });
}

/** Web standardı (Request → Response) işleyiciyi Node isteğine bağlar. */
async function webIsleyici(isleyici, istek, cevap) {
  let govde;
  if (istek.method === 'POST') {
    try { govde = await govdeOku(istek); }
    catch (h) { json(cevap, h.durum || 400, { tamam: false, sebep: h.durum === 413 ? 'buyuk' : 'govde' }); return; }
  }
  const webIstek = new Request('http://yerel' + istek.url, {
    method: istek.method,
    headers: { 'Content-Type': String(istek.headers['content-type'] || '') },
    body: govde
  });
  const webCevap = await isleyici(webIstek);
  const basliklar = {};
  webCevap.headers.forEach((d, a) => { basliklar[a] = d; });
  yaz(cevap, webCevap.status, basliklar, Buffer.from(await webCevap.arrayBuffer()));
}

/** URL yolunu site klasörü içinde güvenli bir dosya yoluna çevirir; dışarı çıkan her şey null. */
function dosyaYolu(urlYolu) {
  let y;
  try { y = decodeURIComponent(urlYolu); } catch { return null; }
  if (y.includes('\0')) return null;
  if (y.split(/[\\/]/).some((p) => p === '..' || p.startsWith('.'))) return null;
  if (y.endsWith('/')) y += 'index.html';
  const tam = path.resolve(KOK, '.' + y);
  if (tam !== KOK && !tam.startsWith(KOK + path.sep)) return null;
  return tam;
}

function onbellekKurali(urlYolu, uzanti, dosya) {
  if (urlYolu.startsWith('/varlik/')) return { 'Cache-Control': 'public, max-age=31536000, immutable' };
  if (uzanti === '.vcf') {
    return {
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': `attachment; filename="${path.basename(dosya)}"`
    };
  }
  return { 'Cache-Control': 'public, max-age=0, must-revalidate' };
}

function bulunamadi(cevap, yalnizBaslik) {
  yaz(cevap, 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    '<!doctype html><meta charset="utf-8"><title>Bulunamadı</title><p>Sayfa bulunamadı. <a href="/">Ana sayfa</a></p>', yalnizBaslik);
}

function statik(istek, cevap, urlYolu) {
  const yalnizBaslik = istek.method === 'HEAD';
  const dosya = dosyaYolu(urlYolu);
  if (!dosya) return bulunamadi(cevap, yalnizBaslik);

  let bilgi;
  try { bilgi = fs.statSync(dosya); } catch { return bulunamadi(cevap, yalnizBaslik); }
  if (!bilgi.isFile()) return bulunamadi(cevap, yalnizBaslik);

  const uzanti = path.extname(dosya).toLowerCase();
  const etiket = `W/"${bilgi.size.toString(16)}-${Math.floor(bilgi.mtimeMs).toString(16)}"`;
  const basliklar = {
    'Content-Type': TURLER[uzanti] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ETag: etiket,
    'Last-Modified': bilgi.mtime.toUTCString(),
    ...onbellekKurali(urlYolu, uzanti, dosya)
  };

  if (istek.headers['if-none-match'] === etiket) return yaz(cevap, 304, basliklar, undefined, true);

  // Parça isteği: iPhone Safari videoyu ancak bununla oynatır.
  const aralik = istek.headers.range;
  if (aralik) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(aralik).trim());
    let bas = NaN, bit = NaN;
    if (m && m[1] === '' && m[2] !== '') {
      bas = Math.max(0, bilgi.size - Number(m[2]));
      bit = bilgi.size - 1;
      if (Number(m[2]) === 0) bas = NaN;
    } else if (m && m[1] !== '') {
      bas = Number(m[1]);
      bit = m[2] === '' ? bilgi.size - 1 : Math.min(Number(m[2]), bilgi.size - 1);
    }
    if (!(bas <= bit) || bas >= bilgi.size) {
      return yaz(cevap, 416, { ...basliklar, 'Content-Range': `bytes */${bilgi.size}` }, undefined, true);
    }
    cevap.writeHead(206, {
      ...ORTAK_BASLIKLAR, ...basliklar,
      'Content-Range': `bytes ${bas}-${bit}/${bilgi.size}`,
      'Content-Length': bit - bas + 1
    });
    if (yalnizBaslik) return cevap.end();
    fs.createReadStream(dosya, { start: bas, end: bit }).on('error', () => cevap.destroy()).pipe(cevap);
    return;
  }

  cevap.writeHead(200, { ...ORTAK_BASLIKLAR, ...basliklar, 'Content-Length': bilgi.size });
  if (yalnizBaslik) return cevap.end();
  fs.createReadStream(dosya).on('error', () => cevap.destroy()).pipe(cevap);
}

/* ---------- yönlendirme ---------- */
export function sunucuOlustur() {
  return http.createServer(async (istek, cevap) => {
    let urlYolu;
    try { urlYolu = new URL(istek.url, 'http://yerel').pathname; }
    catch { return json(cevap, 400, { sebep: 'adres' }); }

    try {
      if (urlYolu === '/saglik') {
        return yaz(cevap, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'ok');
      }
      if (urlYolu === '/api/musait') {
        if (istek.method !== 'GET') return json(cevap, 405, { sebep: 'yontem' });
        return await webIsleyici(musait, istek, cevap);
      }
      if (urlYolu === '/api/randevu') {
        if (istek.method !== 'POST') return json(cevap, 405, { tamam: false, sebep: 'yontem' });
        if (sinirAsildiMi(istemciAdresi(istek))) return json(cevap, 429, { tamam: false, sebep: 'cok-fazla' });
        return await webIsleyici(randevu, istek, cevap);
      }
      if (urlYolu.startsWith('/api/')) return json(cevap, 404, { sebep: 'yok' });
      if (istek.method !== 'GET' && istek.method !== 'HEAD') {
        return yaz(cevap, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'yontem');
      }
      return statik(istek, cevap, urlYolu);
    } catch (h) {
      console.error('[sunucu]', String(h && h.message || h).slice(0, 300));
      if (!cevap.headersSent) json(cevap, 500, { sebep: 'sunucu' });
      else cevap.destroy();
    }
  });
}

// Doğrudan çalıştırılınca dinlemeye başlar; testler yalnız sunucuOlustur'u alır.
const dogrudan = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (dogrudan) {
  const port = Number(process.env.PORT) || 3000;
  const sunucu = sunucuOlustur();
  sunucu.listen(port, () => console.log(`[sunucu] ${port} dinleniyor · site: ${KOK}`));
  const kapat = () => sunucu.close(() => process.exit(0));
  process.on('SIGTERM', kapat);
  process.on('SIGINT', kapat);
}
