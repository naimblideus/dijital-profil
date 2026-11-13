/* Günün dersi — naim.nextusservis.com/ders
   TEK EKRAN, TEK İŞ: sıradaki videoyu izle, tek satır "bugün nerede uygulayacağım" yaz, bitir.
   Günün dersleri bitince liste biter; kaydıracak bir şey yoktur. /plan ile aynı giriş.
   Veri ASLA innerHTML'e girmez. */

function el(etiket, ozellik, ...cocuklar) {
  const e = document.createElement(etiket);
  if (ozellik) {
    for (const [k, v] of Object.entries(ozellik)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of cocuklar.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

const kok = document.getElementById('uygulama');
let D = null;                      // sunucudan gelen gün: { gunluk, dersler, tekrarlar, stok, hafta }
let aramaSonucu = null;            // { q, sonuclar }

async function istek(yol, govde) {
  try {
    const c = await fetch((yol.startsWith('/api/') ? '' : '/api/ders') + yol, {
      method: govde ? 'POST' : 'GET',
      headers: govde ? { 'Content-Type': 'application/json' } : undefined,
      body: govde ? JSON.stringify(govde) : undefined,
      credentials: 'same-origin', cache: 'no-store'
    });
    let v = null;
    try { v = await c.json(); } catch { /* boş */ }
    if (c.status === 401 && yol !== '/api/plan/giris') girisGoster(D ? 'Oturumun kapandı. Şifreni tekrar yaz.' : undefined);
    return { ok: c.ok, durum: c.status, v: v || {} };
  } catch {
    return { ok: false, durum: 0, v: {} };
  }
}

/* ======================= parçalar ======================= */

function ust(simdi) {
  const n = D.dersler.length;
  return [
    el('header', { class: 'ders-ust' },
      el('h1', { text: 'Günün dersi' }),
      el('a', { href: '/plan/', text: 'Plan' })),
    n ? el('div', { class: 'adim', role: 'img', 'aria-label': `${D.dersler.filter((x) => x.bitti).length} / ${n} ders bitti` },
      D.dersler.map((x, i) => el('i', { class: x.bitti ? 'tamam' : i === simdi ? 'simdi' : null }))) : null
  ];
}

function kimden(x) {
  return el('p', { class: 'kimden' }, x.hesap ? '@' + x.hesap : 'Ders', x.konu ? el('span', { text: ' · ' + x.konu }) : null);
}

function maddeler(x) {
  return x.ozet && x.ozet.length ? el('ol', { class: 'maddeler' }, x.ozet.map((m) => el('li', { text: m }))) : null;
}

/* ======================= ekranlar ======================= */

function tekrarEkrani(t) {
  const cevapKutu = el('div', { hidden: true }, maddeler(t),
    t.uygulamam ? el('p', { class: 'bos-sonuc', text: 'O gün yazdığın: ' + t.uygulamam }) : null);
  const goster = el('button', { class: 'birincil', type: 'button' }, 'Cevabı gör');
  const tamam = el('button', { class: 'birincil', type: 'button', hidden: true }, 'Tamam');
  goster.addEventListener('click', () => { cevapKutu.hidden = false; goster.hidden = true; tamam.hidden = false; });
  tamam.addEventListener('click', async () => {
    tamam.disabled = true;
    await istek('/tekrar', { id: t.id });
    D.tekrarlar = D.tekrarlar.filter((x) => x.id !== t.id);
    ciz();
  });
  kok.replaceChildren(...ust(-1).slice(0, 1),
    el('section', { class: 'kart' },
      el('p', { class: 'kimden' }, 'Hatırla', el('span', { text: t.hesap ? ' · @' + t.hesap : '' })),
      el('h2', { class: 'ders-baslik', text: t.soru }),
      el('p', { class: 'bos-sonuc', text: 'Önce kafandan cevapla, sonra bak.' }),
      cevapKutu,
      el('div', { class: 'dugmeler' }, goster, tamam)));
}

function dersEkrani(x, sira) {
  const yazi = el('textarea', {
    id: 'uygulama-yazi', maxlength: '300', rows: '2', enterkeyhint: 'done',
    placeholder: 'Örnek: 15:00’teki aramada fiyatı söylemeden önce bunu soracağım.'
  });
  const hata = el('p', { class: 'hata', role: 'alert' });
  const yaradi = el('button', { class: 'birincil', type: 'button' }, 'Plana ekle ve bitir');
  const yaramadi = el('button', { class: 'ikincil', type: 'button' }, 'İşime yaramadı, geç');

  async function bitir(ise) {
    const metin = yazi.value.replace(/\s+/g, ' ').trim();
    if (ise && !metin) { hata.textContent = 'Tek satır yaz: bunu bugün nerede kullanacaksın?'; return yazi.focus(); }
    yaradi.disabled = yaramadi.disabled = true;
    hata.textContent = '';
    const r = await istek('/bitir', { id: x.id, uygulama: metin, yaradi: ise });
    if (!r.ok) {
      yaradi.disabled = yaramadi.disabled = false;
      if (r.durum !== 401) hata.textContent = 'Kaydedilemedi. Tekrar dene.';
      return;
    }
    x.bitti = true;
    if (ise) D.eklenen = (D.eklenen || 0) + 1;
    window.scrollTo(0, 0);
    ciz();
  }
  yaradi.addEventListener('click', () => bitir(true));
  yaramadi.addEventListener('click', () => bitir(false));

  const oneri = x.uygulama ? el('button', { class: 'oneri', type: 'button', onclick: () => { yazi.value = x.uygulama; yazi.focus(); } },
    el('b', { text: 'Öneri · dokun, düzelt' }), x.uygulama) : null;

  kok.replaceChildren(...ust(sira),
    x.video ? el('div', { class: 'video-kutu' },
      el('video', { src: '/api/ders/video/' + encodeURIComponent(x.id), controls: true, playsinline: true, preload: 'metadata' })) : null,
    el('section', { class: 'kart' }, kimden(x), el('h2', { class: 'ders-baslik', text: x.baslik }), maddeler(x),
      !x.video && x.url ? el('a', { class: 'kaynak', href: x.url, target: '_blank', rel: 'noopener noreferrer', text: 'Kaynağı aç' }) : null),
    el('section', { class: 'kart uygula' },
      el('label', { for: 'uygulama-yazi', text: 'Bunu bugün nerede uygulayacaksın?' }),
      oneri, yazi, hata,
      el('div', { class: 'dugmeler' }, yaradi, yaramadi)));
}

function aramaBolumu() {
  const girdi = el('input', { type: 'search', name: 'q', placeholder: 'Ne arıyorsun? (itiraz, fiyat, kanca…)', 'aria-label': 'Derslerde ara', maxlength: '100', enterkeyhint: 'search', value: aramaSonucu ? aramaSonucu.q : null });
  const form = el('form', { role: 'search' }, girdi, el('button', { type: 'submit' }, 'Ara'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = girdi.value.trim();
    if (!q) return;
    const r = await istek('/ara', { q });
    if (!r.ok) return;
    aramaSonucu = { q, sonuclar: r.v.sonuclar || [] };
    ciz();
  });
  const sonuclar = !aramaSonucu ? null
    : aramaSonucu.sonuclar.length
      ? aramaSonucu.sonuclar.map((x) => el('article', { class: 'sonuc' }, kimden(x), el('h3', { text: x.baslik }), maddeler(x),
        x.url ? el('a', { class: 'kaynak', href: x.url, target: '_blank', rel: 'noopener noreferrer', text: 'Kaynağı aç' }) : null))
      : [el('p', { class: 'bos-sonuc', text: `“${aramaSonucu.q}” için kayıtlı ders yok.` }),
        el('button', { class: 'ikincil', type: 'button', onclick: async (e) => {
          const dugme = e.currentTarget;
          dugme.disabled = true;
          const r = await istek('/istek', { konu: aramaSonucu.q });
          dugme.textContent = r.ok ? 'Not alındı. Gece taramasında bu konu öne alınacak.' : 'Kaydedilemedi.';
        } }, 'Bunu benim için ara')];
  return el('section', { class: 'kart ara' }, form, sonuclar);
}

function bitisEkrani() {
  const hic = D.dersler.length === 0;
  kok.replaceChildren(...ust(-1),
    el('section', { class: 'kart bitis' },
      hic
        ? [el('h2', { text: 'Bugün ders yok' }),
           el('p', { text: 'Bilgisayardaki gece taraması yeni dersleri getirince burada görünür.' })]
        : [el('h2', { text: 'Bugünlük bu kadar.' }),
           el('p', { text: D.eklenen ? `${D.eklenen} iş planına eklendi. Dersi bitiren şey onu yapmak.` : 'Yarın yeni dersler gelir.' })],
      el('p', { class: 'sayi', text: String(D.hafta || 0) }),
      el('p', { text: 'bu hafta uygulanan ders' }),
      el('a', { class: 'birincil', href: '/plan/', text: 'Plana dön' })),
    aramaBolumu());
}

function ciz() {
  kok.setAttribute('aria-busy', 'false');
  if (D.tekrarlar && D.tekrarlar.length) return tekrarEkrani(D.tekrarlar[0]);
  const sira = D.dersler.findIndex((x) => !x.bitti);
  if (sira >= 0) return dersEkrani(D.dersler[sira], sira);
  bitisEkrani();
}

/* ======================= giriş ve durum ======================= */

function girisGoster(mesajMetni) {
  const kullanici = el('input', { type: 'text', name: 'kullanici', autocomplete: 'username', value: 'deepcore', readonly: true, tabindex: '-1', class: 'gorunmez', 'aria-hidden': 'true' });
  const sifre = el('input', { type: 'password', name: 'sifre', autocomplete: 'current-password', required: true, enterkeyhint: 'go', 'aria-label': 'Şifre', placeholder: 'Şifre' });
  const hata = el('p', { class: 'hata', role: 'alert' });
  const dugme = el('button', { class: 'birincil', type: 'submit' }, 'Giriş');
  const form = el('form', { autocomplete: 'on' },
    el('h1', { text: 'Günün dersi' }),
    el('p', { text: mesajMetni || 'DeepCore şifrenle gir. Bu cihaz 6 ay hatırlar.' }),
    kullanici, sifre, hata, dugme);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sifre.value) return sifre.focus();
    dugme.disabled = true;
    hata.textContent = '';
    const r = await istek('/api/plan/giris', { sifre: sifre.value });
    dugme.disabled = false;
    if (r.ok) { sifre.value = ''; return baslat(); }
    if (r.durum === 429) hata.textContent = `Çok fazla yanlış deneme. ${r.v.dakika || 15} dakika sonra tekrar dene.`;
    else if (r.durum === 401) hata.textContent = 'Şifre yanlış.';
    else if (r.durum === 503) hata.textContent = 'Giriş sunucuda henüz kurulmadı.';
    else hata.textContent = 'Bağlantı kurulamadı. Tekrar dene.';
    sifre.select();
  });
  D = null;
  kok.setAttribute('aria-busy', 'false');
  kok.replaceChildren(el('section', { class: 'giris' }, form));
  sifre.focus();
}

function durumEkrani(baslik, aciklama) {
  kok.setAttribute('aria-busy', 'false');
  kok.replaceChildren(el('section', { class: 'giris' },
    el('div', { class: 'durum-ekrani' }, el('h1', { text: baslik }), el('p', { text: aciklama }),
      el('button', { class: 'birincil', type: 'button', onclick: baslat }, 'Tekrar dene'))));
}

async function baslat() {
  kok.setAttribute('aria-busy', 'true');
  const r = await istek('/bugun');
  if (r.ok) { D = r.v; aramaSonucu = null; return ciz(); }
  if (r.durum === 401) return;
  if (r.durum === 503 && r.v.sebep === 'kurulmadi') return durumEkrani('Kurulmadı', 'Sunucuda PLAN_SIFRE tanımlı değil. Dersler DeepCore girişini kullanır.');
  return durumEkrani('Bağlanılamadı', 'İnternet bağlantını kontrol et.');
}

baslat();
