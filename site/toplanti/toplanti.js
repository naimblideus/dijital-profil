/* Toplantılar — naim.nextusservis.com/toplanti
   TEK EKRAN: önümüzdeki görüşmeler gün gün; altta iki eylem — "Yeni toplantı" ve "Randevu linki".
   /plan ile aynı giriş. Veri ASLA innerHTML'e girmez. Mesaj kendiliğinden gitmez: WhatsApp bağlantısını
   kullanıcı basar. Kişi verisi adrese yazılmaz (kestirme taslağı yalnız #t-<kimlik> taşır). */

import { mesaj, waLinki, istanbul } from './mesaj.mjs';

/* ======================= yardımcılar ======================= */

const GUN_UZUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const SEKIL = { meet: 'Google Meet', telefon: 'Telefon', yuzyuze: 'Yüz yüze' };

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

const IKON = {
  arti: ['M12 5v14', 'M5 12h14'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h10'],
  sag: ['M9 5l7 7-7 7'],
  baglanti: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
  video: ['M3 7h12v10H3z', 'M15 10l6-3v10l-6-3'],
  telefon: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'],
  mesaj: ['M4 5h16v11H8l-4 4z'],
  kart: ['M4 5h16v14H4z', 'M8 10h8', 'M8 14h5'],
  takvim: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  tik: ['M5 12.5l4.2 4.2L19 7'],
  saat: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 7v5l3 2'],
  carpi: ['M6 6l12 12', 'M18 6L6 18']
};
function ikon(ad) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ikon');
  for (const d of IKON[ad]) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

/** İstanbul gün anahtarı: "2026-11-12". */
function gunAnahtari(iso) {
  const p = istanbul(iso);
  return `${p.yil}-${String(p.ay + 1).padStart(2, '0')}-${String(p.gun).padStart(2, '0')}`;
}
const bugunAnahtari = () => gunAnahtari(new Date().toISOString());
function gunEkle(anahtar, n) {
  const [y, m, g] = anahtar.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, g + n));
  return d.toISOString().slice(0, 10);
}
function gunBasligi(anahtar) {
  const [y, m, g] = anahtar.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, g));
  return `${GUN_UZUN[d.getUTCDay()]}, ${g} ${AY[m - 1]}`;
}
function goreceli(anahtar) {
  const b = bugunAnahtari();
  return anahtar === b ? 'Bugün' : anahtar === gunEkle(b, 1) ? 'Yarın' : anahtar === gunEkle(b, -1) ? 'Dün' : '';
}
const saat = (iso) => istanbul(iso).saat;
const dakikaFarki = (a, b) => Math.round((new Date(b) - new Date(a)) / 60e3);
/** İstanbul tarihi + saatinden ISO (UTC+3 sabit). */
function istanbulISO(gun, hhmm) {
  const [y, m, g] = gun.split('-').map(Number);
  const [h, dk] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, g, h - 3, dk)).toISOString();
}

function kisiAdi(t) { return (t.kisi && (t.kisi.ad || t.kisi.firma)) || t.baslik || 'Toplantı'; }

/* ======================= durum ======================= */

const kok = document.getElementById('uygulama');
const D = {
  yuklendi: false, takvim: true, crm: false, randevuAdresi: '', ofisAdresi: '', sureler: [15, 30, 45, 60, 90],
  slotDakika: 30, toplantilar: [], slotlar: null, slotZamani: 0
};
let yenileZamanlayici = null;

/* ======================= sunucu ======================= */

async function istek(yol, govde) {
  try {
    const c = await fetch((yol.startsWith('/api/') ? '' : '/api/toplanti') + yol, {
      method: govde ? 'POST' : 'GET',
      headers: govde ? { 'Content-Type': 'application/json' } : undefined,
      body: govde ? JSON.stringify(govde) : undefined,
      credentials: 'same-origin', cache: 'no-store'
    });
    let v = null;
    try { v = await c.json(); } catch { /* boş */ }
    if (c.status === 401 && yol !== '/api/plan/giris') girisGoster(D.yuklendi ? 'Oturumun kapandı. Şifreni tekrar yaz.' : undefined);
    return { ok: c.ok, durum: c.status, v: v || {} };
  } catch {
    return { ok: false, durum: 0, v: {} };
  }
}

function hataMetni(r) {
  if (r.durum === 0) return 'Bağlantı yok. Tekrar dene.';
  const s = r.v.sebep;
  if (s === 'kisi') return 'Kiminle görüşeceğini yaz: ad ya da firma.';
  if (s === 'eposta') return 'E-posta adresi hatalı görünüyor.';
  if (s === 'telefon') return 'Telefon numarası eksik görünüyor.';
  if (s === 'gecmis-saat') return 'Geçmiş bir saat seçtin.';
  if (s === 'saat') return 'Bir saat seç.';
  if (s === 'kimlik-yok') return 'Takvim bağlı değil.';
  if (s === 'toplanti-yok') return 'Bu toplantı takvimde artık yok. Liste yenilendi.';
  if (s === 'duzenlenemez') return 'Bu toplantıyı başkası düzenliyor; takvimden değiştir.';
  if (s === 'takvim-hatasi') return 'Takvime ulaşılamadı. Biraz sonra tekrar dene.';
  return 'Olmadı. Tekrar dene.';
}

/* ======================= bildirim ======================= */

const bildirimKutusu = el('div', { class: 'bildirim', role: 'status', 'aria-live': 'polite' });
document.body.append(bildirimKutusu);
let bildirimZamani = null;
function bildir(metin, sure = 2600) {
  clearTimeout(bildirimZamani);
  bildirimKutusu.replaceChildren(el('span', { text: metin }));
  bildirimKutusu.classList.add('acik');
  bildirimZamani = setTimeout(() => bildirimKutusu.classList.remove('acik'), sure);
}

async function kopyala(metin) {
  try { await navigator.clipboard.writeText(metin); bildir('Kopyalandı'); }
  catch { bildir('Kopyalanamadı'); }
}

/* ======================= alt sayfa ======================= */

let acikSayfa = null;
/** İçerik dizileri düzleşir, boş (null/false) parçalar atlanır — "null" yazısı ekrana düşmesin. */
const parcalar = (icerik) => icerik.flat(2).filter((x) => x !== null && x !== undefined && x !== false);

function sayfaAc(...icerik) {
  sayfaKapat();
  const d = el('dialog', { class: 'sayfa' }, el('div', { class: 'sayfa-ic' }, el('div', { class: 'tutamac', 'aria-hidden': 'true' }), ...parcalar(icerik)));
  d.addEventListener('click', (e) => { if (e.target === d) sayfaKapat(); });
  d.addEventListener('close', () => { d.remove(); if (acikSayfa === d) acikSayfa = null; });
  document.body.append(d);
  acikSayfa = d;
  d.showModal();
  return d;
}
function sayfaKapat() {
  const d = acikSayfa;
  if (!d) return;
  acikSayfa = null;
  if (d.open) d.close();
  d.remove();
}
/** Açık sayfanın içeriğini değiştirir (adım adım akış: form → sonuç). */
function sayfaDegistir(...icerik) {
  if (!acikSayfa) return sayfaAc(...icerik);
  const ic = acikSayfa.querySelector('.sayfa-ic');
  ic.replaceChildren(el('div', { class: 'tutamac', 'aria-hidden': 'true' }), ...parcalar(icerik));
  ic.scrollTop = 0;
  return acikSayfa;
}

function secenek(metin, is, ek, sinif, ikonAdi) {
  return el('button', { class: 'secenek' + (sinif ? ' ' + sinif : ''), type: 'button', onclick: is },
    ikonAdi ? ikon(ikonAdi) : null, metin, ek ? el('small', { text: ek }) : null);
}
/** Dış bağlantı (Meet, WhatsApp, CRM, telefon): yeni sekmede, yönlendiren bilgisi gitmez. */
function bag(metin, adres, ek, sinif, ikonAdi) {
  const icerde = adres.startsWith('tel:') || adres.startsWith('/');
  return el('a', {
    class: 'secenek' + (sinif ? ' ' + sinif : ''), href: adres,
    target: icerde ? null : '_blank', rel: icerde ? null : 'noopener noreferrer'
  }, ikonAdi ? ikon(ikonAdi) : null, metin, ek ? el('small', { text: ek }) : null);
}
const vazgec = (metin = 'Vazgeç') => secenek(metin, sayfaKapat, null, 'sade');

/* ======================= ana ekran ======================= */

let altCubuk = null;
function altCubuguKur() {
  if (altCubuk) return;
  altCubuk = el('nav', { class: 'alt-cubuk', 'aria-label': 'Eylemler' },
    el('div', {},
      el('button', { class: 'yan', type: 'button', onclick: () => randevuLinkiSayfasi() }, ikon('baglanti'), 'Randevu linki'),
      el('button', { class: 'ana', type: 'button', onclick: () => yeniToplantiSayfasi() }, ikon('arti'), 'Yeni toplantı')));
  document.body.append(altCubuk);
}

function ciz() {
  kok.setAttribute('aria-busy', 'false');
  const simdi = Date.now();
  const b = bugunAnahtari();
  const gelen = D.toplantilar.filter((t) => new Date(t.bit).getTime() > simdi);
  const geride = D.toplantilar.filter((t) => new Date(t.bit).getTime() <= simdi).reverse();
  const p = [];

  p.push(el('header', { class: 'ust' },
    el('div', { class: 'ust-sol' },
      el('p', { class: 'goz', text: gunBasligi(b) }),
      el('h1', { class: 'gun-baslik', text: 'Toplantılar' })),
    el('div', { class: 'ust-dugmeler' },
      el('button', { class: 'ikon-dugme', type: 'button', 'aria-label': 'Menü', onclick: menuAc }, ikon('menu')))));

  if (!D.takvim) {
    p.push(el('div', { class: 'serit-uyari', role: 'status' },
      el('p', {}, 'Takvim bağlı değil', el('small', { text: 'Google bağlantısı kurulunca toplantılar burada görünür ve buradan kurulur.' }))));
  }
  if (!D.crm) {
    p.push(el('div', { class: 'serit-uyari bilgi', role: 'status' },
      el('p', {}, 'CRM bağlı değil', el('small', { text: 'Toplantılar yalnız takvime yazılır. Sunucuya NEXUS_CRM_URL ve NEXUS_CRM_TOKEN eklenince CRM\'e de düşer.' }))));
  }

  const hafta = gunEkle(b, 7);
  const bugunSay = gelen.filter((t) => gunAnahtari(t.bas) === b).length;
  const haftaSay = gelen.filter((t) => gunAnahtari(t.bas) < hafta).length;
  p.push(el('p', { class: 'ozet' },
    el('span', {}, 'Bugün ', el('b', { text: String(bugunSay) })),
    el('span', {}, '7 gün ', el('b', { text: String(haftaSay) })),
    el('span', {}, 'Toplam ', el('b', { text: String(gelen.length) }))));

  if (!gelen.length) {
    p.push(el('section', { class: 'liste' },
      el('div', { class: 'bos' },
        el('strong', { text: 'Önünde toplantı yok' }),
        'Aşağıdan yeni toplantı kur ya da birine randevu linki gönder.')));
  }

  const gunler = new Map();
  for (const t of gelen) {
    const k = gunAnahtari(t.bas);
    if (!gunler.has(k)) gunler.set(k, []);
    gunler.get(k).push(t);
  }
  for (const [k, l] of gunler) {
    const g = goreceli(k);
    p.push(el('section', { class: 'gun-bolum' + (k === b ? ' bugun' : ''), 'aria-label': gunBasligi(k) },
      el('h2', {}, g || gunBasligi(k), g ? el('span', { text: gunBasligi(k) }) : null),
      el('div', { class: 'liste' }, l.map((t) => satir(t)))));
  }

  if (geride.length) {
    p.push(el('section', { class: 'gun-bolum', 'aria-label': 'Geride kalan' },
      el('h2', {}, 'Geride kalan', el('span', { text: 'son 3 gün' })),
      el('div', { class: 'liste' }, geride.map((t) => satir(t, true)))));
  }

  kok.replaceChildren(...p);
  altCubuguKur();
}

function satir(t, gecti) {
  const simdi = Date.now();
  const canli = !gecti && new Date(t.bas).getTime() <= simdi && simdi < new Date(t.bit).getTime();
  const alt = [];
  if (t.kisi && t.kisi.ad && t.kisi.firma) alt.push(el('span', { text: t.kisi.firma }));
  if (t.sekil) alt.push(el('span', { class: 'sekil', text: SEKIL[t.sekil] }));
  if (t.durum === 'gorusuldu') alt.push(el('span', { class: 'rozet yesil', text: 'Görüşüldü' }));
  else if (gecti) alt.push(el('span', { class: 'rozet sari', text: 'Not bekliyor' }));
  if (t.kaynak === 'randevu') alt.push(el('span', { class: 'rozet', text: 'Kart randevusu' }));
  if (t.kaynak === 'takvim') alt.push(el('span', { class: 'rozet', text: 'Takvimden' }));
  if (canli) alt.unshift(el('span', { class: 'rozet yesil', text: 'Şimdi' }));
  return el('button', {
    class: 'tp' + (canli ? ' canli' : '') + (gecti ? ' gecti' : ''), type: 'button',
    'aria-label': `${saat(t.bas)} ${kisiAdi(t)}`, onclick: () => toplantiSayfasi(t)
  },
    el('span', { class: 'tp-saat' }, el('b', { text: gecti ? `${istanbul(t.bas).gun} ${AY[istanbul(t.bas).ay].slice(0, 3)}` : saat(t.bas) }),
      gecti ? saat(t.bas) : `${dakikaFarki(t.bas, t.bit)} dk`),
    el('span', { class: 'tp-govde' }, el('span', { class: 'tp-ad', text: kisiAdi(t) }), alt.length ? el('span', { class: 'tp-alt' }, alt) : null),
    el('span', { class: 'tp-ok' }, ikon('sag')));
}

function menuAc() {
  sayfaAc(
    el('p', { class: 'sayfa-baslik', text: 'Toplantılar' }),
    secenek('Yenile', async () => { sayfaKapat(); await yenile(true); bildir('Güncel'); }),
    bag('DeepCore planına geç', '/plan/', null, null),
    secenek('Çıkış yap', async () => { sayfaKapat(); await istek('/api/plan/cikis', {}); girisGoster('Çıkış yapıldı.'); }, null, 'tehlike'),
    vazgec('Kapat'));
}

/* ======================= bir toplantı ======================= */

function zamanSatiri(t) {
  return `${gunBasligi(gunAnahtari(t.bas))} · ${saat(t.bas)}–${saat(t.bit)}${t.sekil ? ' · ' + SEKIL[t.sekil] : ''}`;
}

function toplantiSayfasi(t) {
  const gelecek = new Date(t.bit).getTime() > Date.now();
  const tel = t.kisi && t.kisi.telefon;
  sayfaAc(
    el('p', { class: 'sayfa-soru', text: kisiAdi(t) }),
    el('p', { class: 'sayfa-baslik', text: zamanSatiri(t) + (t.kisi && t.kisi.ad && t.kisi.firma ? ` · ${t.kisi.firma}` : '') }),
    t.meet ? bag('Meet\'e katıl', t.meet, null, gelecek ? 'ana' : null, 'video') : null,
    tel ? bag('Ara', 'tel:' + tel.replace(/[^\d+]/g, ''), tel, null, 'telefon') : null,
    gelecek ? bag('WhatsApp\'tan hatırlat', waLinki(tel, mesaj('hatirlat', t)), tel ? null : 'kişi seçersin', null, 'mesaj') : null,
    t.crm && t.crm.adres ? bag('CRM kartını aç', t.crm.adres, null, null, 'kart')
      : (D.crm && t.duzenlenebilir ? secenek('CRM\'e yaz', () => crmeYaz(t), 'kayıt yok', null, 'kart') : null),
    t.duzenlenebilir && !t.durum ? secenek('Görüştük', () => gorustukSayfasi(t), 'kısa not', null, 'tik') : null,
    t.duzenlenebilir && gelecek ? secenek('Ertele', () => erteleSayfasi(t), 'yeni saat', null, 'saat') : null,
    t.takvimAdresi ? bag('Takvimde aç', t.takvimAdresi, null, null, 'takvim') : null,
    t.duzenlenebilir && gelecek ? secenek('İptal et', () => iptalSayfasi(t), null, 'tehlike', 'carpi') : null,
    !t.duzenlenebilir ? el('p', { class: 'ipucu', text: 'Bu toplantıyı başkası düzenliyor; saatini takvimden değiştir.' }) : null,
    vazgec('Kapat'));
}

/** CRM sonucunu tek satıra çevirir; belirsizse adaylardan seçtirir, hata ise tekrar denetir. */
function crmDurumu(crm, t, yenilendi) {
  if (!crm || crm.durum === 'kapali') return null;
  if (crm.durum === 'yazildi') {
    return [
      el('p', { class: 'durum-satir iyi' }, crm.yeniFirma ? 'CRM\'e yazıldı · yeni kart açıldı' : 'CRM\'e yazıldı'),
      crm.adres ? bag('CRM kartını aç', crm.adres, null, null, 'kart') : null
    ];
  }
  if (crm.durum === 'belirsiz') {
    return [
      el('p', { class: 'durum-satir dikkat' }, 'CRM\'de birden çok kayıt uydu', el('small', { text: 'Hangisi? Seçince toplantı o karta yazılır.' })),
      ...crm.adaylar.map((a) => secenek(a.ad || 'Adsız kayıt', () => crmeYaz(t, a.firmaId, yenilendi), 'bu', null, 'kart'))
    ];
  }
  if (crm.durum === 'yetersiz') {
    return [el('p', { class: 'durum-satir dikkat' }, 'CRM\'e yazılmadı', el('small', { text: 'Telefon, e-posta ya da firma adı olmadan yeni kart açılmaz.' }))];
  }
  if (crm.durum === 'bulunamadi') {
    return [el('p', { class: 'durum-satir dikkat' }, 'CRM bu toplantıyı tanımıyor', el('small', { text: 'Önce "CRM\'e yaz" ile kaydet.' }))];
  }
  return [
    el('p', { class: 'durum-satir dikkat' }, 'CRM\'e ulaşılamadı', el('small', { text: 'Takvim tamam. CRM\'e sonra yazabilirsin.' })),
    t ? secenek('CRM\'e tekrar dene', () => crmeYaz(t, null, yenilendi), null, null, 'kart') : null
  ];
}

async function crmeYaz(t, firmaId, sonra) {
  sayfaDegistir(el('p', { class: 'sayfa-soru', text: 'CRM\'e yazılıyor…' }));
  const r = await istek('/crm', { id: t.id, ...(firmaId ? { firmaId } : {}) });
  if (!r.ok) { sayfaDegistir(el('p', { class: 'sayfa-soru', text: 'Olmadı' }), el('p', { class: 'ipucu', text: hataMetni(r) }), vazgec('Kapat')); return; }
  await yenile(true);
  sayfaDegistir(
    el('p', { class: 'sayfa-soru', text: kisiAdi(r.v.toplanti || t) }),
    crmDurumu(r.v.crm, r.v.toplanti || t, sonra),
    sonra ? sonra() : null,
    vazgec('Tamam'));
}

/* ======================= saat seçici ======================= */

async function slotlariGetir() {
  if (D.slotlar && Date.now() - D.slotZamani < 60e3) return D.slotlar;
  const r = await istek('/slotlar');
  if (!r.ok) return null;
  D.slotlar = r.v;
  D.slotZamani = Date.now();
  return D.slotlar;
}

/**
 * Gün şeridi + boş saatler + "Başka saat". Seçim S.bas'a yazılır; süre değişince ızgara yeniden süzülür.
 * Boş saat: süre boyunca art arda gelen yarım saatlerin hepsi boşsa.
 */
function saatSecici(S, degisti) {
  const kutu = el('div', { class: 'duzen' });
  const ozet = el('p', { class: 'secim-ozeti', 'aria-live': 'polite' });
  const cipler = el('div', { class: 'cipler', role: 'group', 'aria-label': 'Gün' });
  const saatler = el('div', { class: 'saatler', role: 'group', 'aria-label': 'Saat' });
  const serbestKutu = el('div', { class: 'ikili', hidden: true });
  const tarihGirdi = el('input', { class: 'girdi', type: 'date', 'aria-label': 'Tarih', min: bugunAnahtari() });
  const saatGirdi = el('input', { class: 'girdi', type: 'time', 'aria-label': 'Saat', step: '300' });
  serbestKutu.append(tarihGirdi, saatGirdi);
  const serbestDugme = el('button', { class: 'baglanti', type: 'button' }, 'Listede yok — başka saat yaz');
  let veri = null;
  let gunIdx = 0;

  function ozetYaz() {
    if (!S.bas) { ozet.textContent = ''; return; }
    const bit = new Date(new Date(S.bas).getTime() + S.sure * 60e3).toISOString();
    ozet.textContent = `${gunBasligi(gunAnahtari(S.bas))}, ${saat(S.bas)}–${saat(bit)}`;
  }
  function uygunMu(bos, bas) {
    const adim = (veri && veri.slotDakika) || 30;
    for (let k = 0; k * adim < S.sure; k++) if (!bos.has(new Date(new Date(bas).getTime() + k * adim * 60e3).toISOString())) return false;
    return true;
  }
  function ciz() {
    cipler.replaceChildren();
    saatler.replaceChildren();
    if (!veri) { saatler.append(el('p', { class: 'yok', text: 'Boş saatler alınamadı. Aşağıdan saat yazabilirsin.' })); return; }
    const bos = new Set(veri.gunler.flatMap((g) => g.slotlar.map((s) => s.bas)));
    const gunler = veri.gunler.map((g) => ({ ...g, uygun: g.slotlar.filter((s) => uygunMu(bos, s.bas)) })).filter((g) => g.uygun.length);
    if (gunIdx >= gunler.length) gunIdx = 0;
    gunler.forEach((g, i) => {
      const [, m, gn] = g.tarih.split('-').map(Number);
      cipler.append(el('button', {
        class: 'cip', type: 'button', 'aria-pressed': String(i === gunIdx),
        'aria-label': gunBasligi(g.tarih), onclick: () => { gunIdx = i; ciz(); }
      }, goreceli(g.tarih) || GUN_KISA[g.haftaGunu], el('b', { text: String(gn) }), AY[m - 1].slice(0, 3)));
    });
    const g = gunler[gunIdx];
    if (!g) { saatler.append(el('p', { class: 'yok', text: 'Bu süre için boş saat yok. Aşağıdan saat yaz.' })); return; }
    for (const s of g.uygun) {
      saatler.append(el('button', {
        type: 'button', 'aria-pressed': String(S.bas === s.bas && !S.serbest),
        onclick: () => { S.bas = s.bas; S.serbest = false; ciz(); ozetYaz(); degisti && degisti(); }
      }, s.etiket));
    }
  }
  function serbestOku() {
    if (!tarihGirdi.value || !/^\d{2}:\d{2}/.test(saatGirdi.value)) { S.bas = null; ozetYaz(); return; }
    S.bas = istanbulISO(tarihGirdi.value, saatGirdi.value.slice(0, 5));
    S.serbest = true;
    ciz(); ozetYaz(); degisti && degisti();
  }
  tarihGirdi.addEventListener('change', serbestOku);
  saatGirdi.addEventListener('change', serbestOku);
  serbestDugme.addEventListener('click', () => {
    serbestKutu.hidden = !serbestKutu.hidden;
    serbestDugme.textContent = serbestKutu.hidden ? 'Listede yok — başka saat yaz' : 'Listeden seç';
    if (!serbestKutu.hidden) { tarihGirdi.value = tarihGirdi.value || (S.bas ? gunAnahtari(S.bas) : bugunAnahtari()); tarihGirdi.focus(); }
  });

  saatler.append(el('p', { class: 'yok', text: 'Boş saatler geliyor…' }));
  kutu.append(cipler, saatler, serbestDugme, serbestKutu, ozet);
  slotlariGetir().then((v) => { veri = v; ciz(); ozetYaz(); });
  return { kutu, yenidenCiz: () => { ciz(); ozetYaz(); } };
}

function segment(secenekler, deger, sec, etiket) {
  const k = el('div', { class: 'segment', role: 'group', 'aria-label': etiket });
  const ciz = () => {
    k.replaceChildren(...secenekler.map(([d, m]) => el('button', {
      type: 'button', 'aria-pressed': String(d === deger), onclick: () => { deger = d; sec(d); ciz(); }
    }, m)));
  };
  ciz();
  return k;
}

/* ======================= kişi seçici (CRM araması + elle) ======================= */

function kisiSecici(K, degisti) {
  const kutu = el('div', { class: 'duzen' });
  const ad = el('input', { class: 'girdi', type: 'text', placeholder: 'Ad soyad', autocomplete: 'off', 'aria-label': 'Ad soyad', value: K.ad || '' });
  const firma = el('input', { class: 'girdi', type: 'text', placeholder: 'Firma (isteğe bağlı)', autocomplete: 'off', 'aria-label': 'Firma', value: K.firma || '' });
  const telefon = el('input', { class: 'girdi', type: 'tel', inputmode: 'tel', placeholder: 'Telefon', autocomplete: 'off', 'aria-label': 'Telefon', value: K.telefon || '' });
  const eposta = el('input', { class: 'girdi', type: 'email', inputmode: 'email', placeholder: 'E-posta (davet için)', autocomplete: 'off', 'aria-label': 'E-posta', value: K.eposta || '' });
  const secili = el('div');
  const sonuclar = el('div', { class: 'sonuclar', role: 'list' });
  const ara = D.crm ? el('input', {
    class: 'girdi', type: 'search', enterkeyhint: 'search', autocomplete: 'off',
    placeholder: 'CRM\'de ara: ad, firma ya da telefon', 'aria-label': 'CRM\'de ara'
  }) : null;

  const oku = () => {
    K.ad = ad.value.trim(); K.firma = firma.value.trim(); K.telefon = telefon.value.trim(); K.eposta = eposta.value.trim();
    degisti && degisti();
  };
  for (const g of [ad, firma, telefon, eposta]) g.addEventListener('input', () => {
    // Elle değiştirilen kişi artık seçilen CRM kaydı olmayabilir: bağ kopar, CRM kendisi eşler.
    if (K.crmFirmaId && (g === ad || g === firma)) { K.crmFirmaId = null; seciliCiz(); }
    oku();
  });

  function seciliCiz() {
    secili.replaceChildren(K.crmFirmaId ? el('div', { class: 'secili-kisi' },
      el('p', {}, K.crmEtiket || 'CRM kaydı', el('small', { text: 'CRM\'deki karta yazılacak' })),
      el('button', { type: 'button', onclick: () => { K.crmFirmaId = null; seciliCiz(); } }, 'Kaldır')) : '');
  }
  function sec(s) {
    ad.value = s.kisi || ''; firma.value = s.firma || ''; telefon.value = s.telefon || ''; eposta.value = s.eposta || '';
    K.crmFirmaId = s.firmaId;
    K.crmEtiket = [s.firma, s.kisi].filter(Boolean).join(' · ');
    sonuclar.replaceChildren();
    if (ara) ara.value = '';
    seciliCiz();
    oku();
  }

  let zaman = null, sira = 0;
  if (ara) {
    ara.addEventListener('input', () => {
      clearTimeout(zaman);
      const q = ara.value.trim();
      if (q.length < 2) { sonuclar.replaceChildren(); return; }
      zaman = setTimeout(async () => {
        const benim = ++sira;
        const r = await istek('/ara', { q });
        if (benim !== sira) return;                     // yazmaya devam etti: eski cevap ekrana basılmaz
        const l = (r.v && r.v.sonuclar) || [];
        sonuclar.replaceChildren(...(l.length ? l.map((s) => el('button', { class: 'sonuc', type: 'button', role: 'listitem', onclick: () => sec(s) },
          el('b', { text: s.kisi ? `${s.kisi} · ${s.firma}` : s.firma }),
          el('span', { text: [s.telefon, s.eposta, s.aranmasin ? 'aranmasın işaretli' : null].filter(Boolean).join(' · ') || 'iletişim bilgisi yok' })))
          : [el('p', { class: 'sonuc-yok', text: r.ok ? 'CRM\'de bulunamadı. Aşağıya elle yaz; kart açılır.' : 'CRM\'e ulaşılamadı. Elle yazabilirsin.' })]));
      }, 280);
    });
  }

  const rehber = 'contacts' in navigator && 'ContactsManager' in window
    ? el('button', {
      class: 'baglanti', type: 'button', onclick: async () => {
        try {
          const [k] = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: false });
          if (!k) return;
          sec({ kisi: (k.name || [])[0] || '', firma: '', telefon: (k.tel || [])[0] || '', eposta: (k.email || [])[0] || '', firmaId: null });
        } catch { /* vazgeçti */ }
      }
    }, 'Rehberden seç') : null;

  seciliCiz();
  kutu.append(...[ara, sonuclar, secili, rehber, ad, el('div', { class: 'ikili' }, telefon, firma), eposta].filter(Boolean));
  return { kutu, odak: () => (ara || ad).focus() };
}

/* ======================= yeni toplantı ======================= */

function yeniToplantiSayfasi(taslak) {
  if (!D.takvim) { bildir('Takvim bağlı değil'); return; }
  const K = { ad: '', firma: '', telefon: '', eposta: '', crmFirmaId: null, crmEtiket: '', ...(taslak || {}) };
  const S = { bas: null, sure: D.slotDakika === 30 ? 30 : D.slotDakika, serbest: false, sekil: 'meet', yer: D.ofisAdresi, not: '', davet: true };

  const hata = el('p', { class: 'hata-metni', role: 'alert' });
  const davetSatir = el('label', { class: 'tik-satir', hidden: !K.eposta },
    el('input', { type: 'checkbox', checked: true, onchange: (e) => { S.davet = e.target.checked; } }),
    'Takvim davetini e-postayla gönder');
  const kisi = kisiSecici(K, () => { davetSatir.hidden = !K.eposta; hata.textContent = ''; });
  const secici = saatSecici(S, () => { hata.textContent = ''; });
  const yer = el('input', { class: 'girdi', type: 'text', value: S.yer, 'aria-label': 'Yer', hidden: true, oninput: (e) => { S.yer = e.target.value; } });
  const not = el('textarea', { class: 'girdi', placeholder: 'Not (isteğe bağlı): konu, hazırlık…', 'aria-label': 'Not', oninput: (e) => { S.not = e.target.value; } });
  const dugme = el('button', { class: 'birincil', type: 'button' }, 'Toplantıyı kur');

  const sureler = D.sureler.filter((s) => s <= 90).map((s) => [s, s === 60 ? '1 sa' : s === 90 ? '1,5 sa' : `${s} dk`]);
  async function gonder(zorla) {
    if (!K.ad && !K.firma) { hata.textContent = 'Kiminle görüşeceğini yaz.'; return; }
    if (!S.bas) { hata.textContent = 'Bir saat seç.'; return; }
    dugme.disabled = true;
    hata.textContent = '';
    const r = await istek('/olustur', {
      ad: K.ad, firma: K.firma, telefon: K.telefon, eposta: K.eposta, crmFirmaId: K.crmFirmaId || undefined,
      bas: S.bas, sure: S.sure, sekil: S.sekil, yer: S.sekil === 'yuzyuze' ? S.yer : undefined,
      not: S.not, davet: Boolean(K.eposta) && S.davet, zorla: zorla === true
    });
    dugme.disabled = false;
    if (r.durum === 409 && r.v.sebep === 'cakisma') {
      hata.replaceChildren('Bu saatte takvimde başka bir şey var. ',
        el('button', { class: 'baglanti', type: 'button', onclick: () => gonder(true) }, 'Yine de kur'));
      return;
    }
    if (!r.ok) { hata.textContent = hataMetni(r); return; }
    D.slotlar = null;
    await yenile(true);
    sonucSayfasi(r.v);
  }
  dugme.addEventListener('click', () => gonder(false));

  sayfaAc(
    el('p', { class: 'sayfa-soru', text: 'Yeni toplantı' }),
    el('p', { class: 'alt-baslik', text: 'Kiminle' }), kisi.kutu,
    el('p', { class: 'alt-baslik', text: 'Ne kadar' }),
    segment(sureler, S.sure, (d) => { S.sure = d; secici.yenidenCiz(); }, 'Süre'),
    el('p', { class: 'alt-baslik', text: 'Ne zaman' }), secici.kutu,
    el('p', { class: 'alt-baslik', text: 'Nasıl' }),
    segment(Object.entries(SEKIL), S.sekil, (d) => { S.sekil = d; yer.hidden = d !== 'yuzyuze'; }, 'Görüşme şekli'),
    yer, not, davetSatir, hata, dugme, vazgec());
  if (!taslak) kisi.odak();
}

function sonucSayfasi(v) {
  const t = v.toplanti;
  sayfaDegistir(
    el('p', { class: 'sayfa-soru', text: 'Takvime eklendi' }),
    el('p', { class: 'sayfa-baslik', text: `${kisiAdi(t)} · ${zamanSatiri(t)}` }),
    crmDurumu(v.crm, t, () => (v.wa ? bag('WhatsApp\'ta mesajı aç', v.wa.adres, null, 'ana', 'mesaj') : null)),
    v.wa ? el('p', { class: 'alt-baslik', text: 'Hazır mesaj · sen gönderirsin' }) : null,
    v.wa ? el('pre', { class: 'mesaj-onizleme', text: v.wa.metin }) : null,
    v.wa ? bag('WhatsApp\'ta mesajı aç', v.wa.adres, t.kisi && t.kisi.telefon ? null : 'kişi seçersin', 'ana', 'mesaj') : null,
    v.wa ? secenek('Mesajı kopyala', () => kopyala(v.wa.metin)) : null,
    t.meet ? secenek('Meet linkini kopyala', () => kopyala(t.meet), null, null, 'video') : null,
    vazgec('Tamam'));
}

/* ======================= ertele / iptal / görüştük ======================= */

function erteleSayfasi(t) {
  const S = { bas: null, sure: dakikaFarki(t.bas, t.bit), serbest: false, haberVer: true };
  const hata = el('p', { class: 'hata-metni', role: 'alert' });
  const secici = saatSecici(S, () => { hata.textContent = ''; });
  const dugme = el('button', { class: 'birincil', type: 'button' }, 'Yeni saate al');
  async function gonder(zorla) {
    if (!S.bas) { hata.textContent = 'Yeni saati seç.'; return; }
    dugme.disabled = true;
    const r = await istek('/ertele', { id: t.id, bas: S.bas, haberVer: S.haberVer, zorla: zorla === true });
    dugme.disabled = false;
    if (r.durum === 409 && r.v.sebep === 'cakisma') {
      hata.replaceChildren('Bu saatte başka bir şey var. ', el('button', { class: 'baglanti', type: 'button', onclick: () => gonder(true) }, 'Yine de al'));
      return;
    }
    if (!r.ok) { hata.textContent = hataMetni(r); if (r.durum === 404) yenile(true); return; }
    D.slotlar = null;
    await yenile(true);
    sayfaDegistir(
      el('p', { class: 'sayfa-soru', text: 'Saat değişti' }),
      el('p', { class: 'sayfa-baslik', text: `${kisiAdi(r.v.toplanti)} · ${zamanSatiri(r.v.toplanti)}` }),
      t.davetli && S.haberVer ? el('p', { class: 'durum-satir iyi' }, 'Davetliye takvimden haber gitti') : null,
      r.v.crm && r.v.crm.durum === 'yazildi' ? el('p', { class: 'durum-satir iyi' }, 'CRM\'e not düştü') : crmDurumu(r.v.crm, null),
      r.v.wa ? el('pre', { class: 'mesaj-onizleme', text: r.v.wa.metin }) : null,
      r.v.wa ? bag('WhatsApp\'ta haber ver', r.v.wa.adres, null, 'ana', 'mesaj') : null,
      vazgec('Tamam'));
  }
  dugme.addEventListener('click', () => gonder(false));
  sayfaAc(
    el('p', { class: 'sayfa-soru', text: 'Ertele' }),
    el('p', { class: 'sayfa-baslik', text: `${kisiAdi(t)} · şimdi: ${zamanSatiri(t)}` }),
    secici.kutu,
    t.davetli ? el('label', { class: 'tik-satir' },
      el('input', { type: 'checkbox', checked: true, onchange: (e) => { S.haberVer = e.target.checked; } }), 'Davetliye takvimden haber ver') : null,
    hata, dugme, vazgec());
}

function iptalSayfasi(t) {
  const S = { haberVer: true };
  const not = el('textarea', { class: 'girdi', placeholder: 'Neden? (isteğe bağlı, CRM\'e not düşer)', 'aria-label': 'İptal notu' });
  const hata = el('p', { class: 'hata-metni', role: 'alert' });
  const dugme = el('button', { class: 'secenek tehlike', type: 'button' }, 'Toplantıyı iptal et');
  dugme.addEventListener('click', async () => {
    dugme.disabled = true;
    const r = await istek('/iptal', { id: t.id, not: not.value.trim(), haberVer: S.haberVer });
    dugme.disabled = false;
    if (!r.ok) { hata.textContent = hataMetni(r); if (r.durum === 404) yenile(true); return; }
    D.slotlar = null;
    await yenile(true);
    sayfaDegistir(
      el('p', { class: 'sayfa-soru', text: 'İptal edildi' }),
      el('p', { class: 'sayfa-baslik', text: `${kisiAdi(t)} · ${zamanSatiri(t)}` }),
      t.davetli && S.haberVer ? el('p', { class: 'durum-satir iyi' }, 'Davetliye takvimden haber gitti') : null,
      r.v.crm && r.v.crm.durum === 'yazildi' ? el('p', { class: 'durum-satir iyi' }, 'CRM\'e not düştü') : crmDurumu(r.v.crm, null),
      r.v.wa ? el('pre', { class: 'mesaj-onizleme', text: r.v.wa.metin }) : null,
      r.v.wa ? bag('WhatsApp\'ta haber ver', r.v.wa.adres, null, 'ana', 'mesaj') : null,
      vazgec('Tamam'));
  });
  sayfaAc(
    el('p', { class: 'sayfa-soru', text: 'İptal edilsin mi?' }),
    el('p', { class: 'sayfa-baslik', text: `${kisiAdi(t)} · ${zamanSatiri(t)}` }),
    not,
    t.davetli ? el('label', { class: 'tik-satir' },
      el('input', { type: 'checkbox', checked: true, onchange: (e) => { S.haberVer = e.target.checked; } }), 'Davetliye takvimden haber ver') : null,
    hata, dugme, vazgec());
}

function gorustukSayfasi(t) {
  const not = el('textarea', { class: 'girdi', placeholder: 'Ne konuştunuz, sıradaki adım ne? (CRM\'e yazılır)', 'aria-label': 'Görüşme notu' });
  const hata = el('p', { class: 'hata-metni', role: 'alert' });
  const dugme = el('button', { class: 'birincil', type: 'button' }, 'Kaydet');
  dugme.addEventListener('click', async () => {
    dugme.disabled = true;
    const r = await istek('/gorustuk', { id: t.id, not: not.value.trim() });
    dugme.disabled = false;
    if (!r.ok) { hata.textContent = hataMetni(r); return; }
    await yenile(true);
    const crm = r.v.crm || {};
    if (crm.durum === 'yazildi' || crm.durum === 'kapali') {
      sayfaKapat();
      bildir(crm.durum === 'yazildi' ? 'Kaydedildi · CRM\'e yazıldı' : 'Kaydedildi');
      return;
    }
    sayfaDegistir(el('p', { class: 'sayfa-soru', text: 'Kaydedildi' }), crmDurumu(crm, t), vazgec('Tamam'));
  });
  sayfaAc(
    el('p', { class: 'sayfa-soru', text: 'Görüştük' }),
    el('p', { class: 'sayfa-baslik', text: `${kisiAdi(t)} · ${zamanSatiri(t)}` }),
    not, hata, dugme, vazgec());
  not.focus();
}

/* ======================= randevu linki gönder ======================= */

function randevuLinkiSayfasi() {
  const K = { ad: '', firma: '', telefon: '', eposta: '', crmFirmaId: null };
  const onizleme = el('pre', { class: 'mesaj-onizleme' });
  const wa = bag('WhatsApp\'ta aç', '#', null, 'ana', 'mesaj');
  const metin = () => mesaj('randevu', { kisi: { ad: K.ad, firma: K.firma } }, { randevuAdresi: D.randevuAdresi });
  const tazele = () => {
    const m = metin();
    onizleme.textContent = m;
    wa.setAttribute('href', waLinki(K.telefon, m));
    wa.querySelector('small')?.remove();
    if (!K.telefon) wa.append(el('small', { text: 'kişi seçersin' }));
  };
  const kisi = kisiSecici(K, tazele);
  tazele();
  sayfaAc(
    el('p', { class: 'sayfa-soru', text: 'Randevu linki gönder' }),
    el('p', { class: 'ipucu', text: 'Karşı taraf linki açınca kartındaki boş saatlerden birini seçer; toplantı takvimine ve CRM\'e kendiliğinden düşer.' }),
    el('p', { class: 'alt-baslik', text: 'Kime' }), kisi.kutu,
    el('p', { class: 'alt-baslik', text: 'Mesaj · sen gönderirsin' }), onizleme,
    wa,
    secenek('Mesajı kopyala', () => kopyala(metin())),
    navigator.share ? secenek('Paylaş…', async () => { try { await navigator.share({ text: metin() }); } catch { /* vazgeçti */ } }) : null,
    vazgec());
}

/* ======================= giriş ======================= */

function girisGoster(mesajMetni) {
  durdur();
  sayfaKapat();
  if (altCubuk) { altCubuk.remove(); altCubuk = null; }
  const kullanici = el('input', { type: 'text', name: 'kullanici', autocomplete: 'username', value: 'deepcore', readonly: true, tabindex: '-1', class: 'gorunmez', 'aria-hidden': 'true' });
  const sifre = el('input', { type: 'password', name: 'sifre', autocomplete: 'current-password', required: true, enterkeyhint: 'go', 'aria-label': 'Şifre', placeholder: 'Şifre' });
  const hata = el('p', { class: 'hata', role: 'alert' });
  const dugme = el('button', { class: 'birincil', type: 'submit' }, 'Giriş');
  const form = el('form', { autocomplete: 'on' },
    el('h1', { text: 'Toplantılar' }),
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
  D.yuklendi = false;
  kok.setAttribute('aria-busy', 'false');
  kok.replaceChildren(el('section', { class: 'giris' }, form));
  sifre.focus();
}

function durumEkrani(baslik, ...aciklama) {
  durdur();
  kok.setAttribute('aria-busy', 'false');
  kok.replaceChildren(el('section', { class: 'giris' },
    el('div', { class: 'durum-ekrani' }, el('h1', { text: baslik }), el('p', {}, ...aciklama),
      el('button', { class: 'birincil', type: 'button', onclick: baslat }, 'Tekrar dene'))));
}

/* ======================= eşitleme ======================= */

function veriAl(v) {
  D.takvim = v.takvim !== false;
  D.crm = v.crm === true;
  D.randevuAdresi = v.randevuAdresi || '';
  D.ofisAdresi = v.ofisAdresi || '';
  D.sureler = Array.isArray(v.sureler) ? v.sureler : D.sureler;
  D.slotDakika = v.slotDakika || 30;
  D.toplantilar = Array.isArray(v.toplantilar) ? v.toplantilar : [];
}

async function yenile(zorla) {
  if (!zorla && (document.hidden || acikSayfa)) return;
  const r = await istek('');
  if (!r.ok) return;
  veriAl(r.v);
  ciz();
}
function durdur() { clearInterval(yenileZamanlayici); yenileZamanlayici = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && yenileZamanlayici) yenile(false); });

/** iOS Kestirmesinden gelen kişi: adreste yalnız #t-<kimlik>; kişi sunucudan bir kez okunur. */
async function taslakVarsaAc() {
  const m = /^#t-([A-Za-z0-9_-]{16})$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  const r = await istek('/taslak-al', { id: m[1] });
  if (r.ok && r.v.taslak) yeniToplantiSayfasi(r.v.taslak);
  else bildir('Kişi bilgisinin süresi doldu. Kestirmeyi tekrar çalıştır.', 4000);
}

// Sayfa zaten açıkken kestirme yeniden çalışırsa (aynı sekme, yalnız #t- değişir) yine açılsın.
addEventListener('hashchange', () => { if (D.yuklendi) taslakVarsaAc(); });

async function baslat() {
  kok.setAttribute('aria-busy', 'true');
  const r = await istek('');
  if (r.ok) {
    veriAl(r.v);
    D.yuklendi = true;
    ciz();
    durdur();
    yenileZamanlayici = setInterval(() => yenile(false), 60e3);
    taslakVarsaAc();
    return;
  }
  if (r.durum === 401) return;
  if (r.durum === 503 && r.v.sebep === 'kurulmadi') {
    return durumEkrani('Kurulmadı', 'Sunucuda ', el('code', { text: 'PLAN_SIFRE' }), ' tanımlı değil. Toplantılar DeepCore girişini kullanır.');
  }
  if (r.durum === 502) return durumEkrani('Takvime ulaşılamadı', 'Google Takvim şu an cevap vermiyor. Biraz sonra tekrar dene.');
  return durumEkrani('Bağlanılamadı', 'İnternet bağlantını kontrol et.');
}

baslat();
