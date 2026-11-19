/* DeepCore — çevrimdışı yardımcı (service worker), kapsam /plan/.
   İnternet varken HER ŞEY ağdan gelir (güncelleme hemen görünür); yalnız ağ yoksa son kopya kullanılır.
     Kabuk  : sayfa, js, css, ikonlar → ağ önce, yoksa saklanan kopya.
     Veri   : /api/plan + toplantılar + CRM işleri (yalnız GET, yalnız 200) → ağ önce, yoksa son kopya;
              son kopyaya "X-Cevrimdisi: 1" başlığı eklenir, ekran "çevrimdışı" şeridi gösterir.
     Yazma  : POST'lara dokunulmaz; ağ yoksa ekran "Bağlantı yok — kaydedilmedi" der.
   Oturum düşünce (401) ya da çıkış yapılınca saklanan veri silinir. */
'use strict';

const SURUM = 'deepcore-1';
const KABUK = ['/plan/', '/plan/plan.js', '/plan/plan.css', '/plan/manifest.webmanifest',
  '/varlik/ikon-192.png', '/varlik/ikon-512.png', '/varlik/apple-touch-icon.png', '/varlik/favicon-32.png'];
const VERI = new Set(['/api/plan', '/api/toplanti', '/api/toplanti/isler']);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SURUM).then((c) => c.addAll(KABUK)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((l) => Promise.all(l.filter((k) => k !== SURUM).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function veriyiSil() {
  const c = await caches.open(SURUM);
  await Promise.all([...VERI].map((y) => c.delete(y)));
}

self.addEventListener('message', (e) => {
  if (e.data === 'veriyi-sil') e.waitUntil(veriyiSil());
});

/** Ağ önce; ağ yoksa saklanan kopya. anahtar = önbellekteki ad. */
async function agOnce(istek, anahtar, veriMi) {
  const c = await caches.open(SURUM);
  try {
    const r = await fetch(istek);
    if (r.ok) await c.put(anahtar, r.clone());
    else if (veriMi && r.status === 401) await veriyiSil();
    return r;
  } catch (h) {
    const m = await c.match(anahtar);
    if (!m) throw h;
    if (!veriMi) return m;
    const b = new Headers(m.headers);
    b.set('X-Cevrimdisi', '1');
    return new Response(await m.blob(), { status: m.status, statusText: m.statusText, headers: b });
  }
}

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (VERI.has(u.pathname)) return e.respondWith(agOnce(r, u.pathname, true));
  if (r.mode === 'navigate' && (u.pathname === '/plan' || u.pathname === '/plan/')) return e.respondWith(agOnce(r, '/plan/', false));
  if (KABUK.includes(u.pathname)) return e.respondWith(agOnce(r, u.pathname, false));
});
