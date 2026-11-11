/* DeepCore — naim.nextusservis.com/plan
   Kâğıt timebox defteri gibi TEK EKRAN:
     Şimdi kartı  → şu an ne yapmalıyım (görev ya da toplantı), tek dokunuşla Odaklan
     Bugünün 3'ü  → günün en önemli üç işi
     Saatler      → zaman ızgarası: saatli görevler + takvimdeki toplantılar (kart randevuları dahil)
     Kafamdakiler → saatsiz işler + CRM'den gelenler (görevlerim, doğrulamam, bugünkü takipler)
   Veri ASLA innerHTML'e girmez; her dokunuş anında görünür, sunucu reddederse geri alınır. */
'use strict';

(() => {
  /* ======================= yardımcılar ======================= */

  const GUN_UZUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const GUN_KISA = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'];
  const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

  const ALANLAR = [
    { ad: 'Servis', renk: '#0A84FF', es: ['nexus servis', 'nextus servis', 'servis', 'srv', 'nexus-servis'] },
    { ad: 'Saha', renk: '#34C759', es: ['büyüme', 'buyume', 'görüşme', 'gorusme', 'saha'] },
    { ad: 'Kod', renk: '#8E8E93', es: ['deploy', 'kod', 'maker'] },
    { ad: 'Kredi', renk: '#FF375F', es: ['otoprime', 'op', 'kredi', 'nextus kredi'] },
    { ad: 'Ekip', renk: '#FF9F0A', es: ['ekip', 'eğitim', 'egitim', 'ik', 'hat'] },
    { ad: 'Kişisel', renk: '#BF5AF2', es: ['kişisel', 'kisisel', 'spor', 'disiplin'] },
    { ad: 'AI', renk: '#FFD60A', es: ['ai', 'yz'] },
    { ad: 'Dekor', renk: '#AC8E68', es: ['dekor', 'nextus dekor', 'nextus-dekor'] },
    { ad: 'Reçete', renk: '#5E5CE6', es: ['reçete', 'recete', 'nextus reçete', 'nextus recete', 'recetemaliyet'] },
    { ad: 'Frigora', renk: '#64D2FF', es: ['frigora', 'soğutma', 'sogutma'] },
    { ad: 'Makine', renk: '#FF6B00', es: ['makine', 'makine-takip', 'makine takip'] },
    { ad: 'Nextus', renk: '#8E8CF0', es: ['nexus', 'nextus', 'nx', 'genel'] }
  ];
  function alanBul(etiket) {
    if (!etiket) return null;
    const n = String(etiket).toLocaleLowerCase('tr-TR').trim();
    return ALANLAR.find((a) => a.es.includes(n)) || { ad: etiket, renk: '' };
  }

  function isoGun(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function tarih(iso) { const [y, m, g] = iso.split('-').map(Number); return new Date(y, m - 1, g); }
  function bugun() { return isoGun(new Date()); }
  function gunEkle(iso, n) { const d = tarih(iso); d.setDate(d.getDate() + n); return isoGun(d); }
  function gunFarki(a, b) { return Math.round((tarih(b) - tarih(a)) / 864e5); }
  function haftaBasi(iso) { return gunEkle(iso, -((tarih(iso).getDay() + 6) % 7)); }
  function gunBasligi(iso) { const d = tarih(iso); return `${GUN_UZUN[d.getDay()]}, ${d.getDate()} ${AY[d.getMonth()]}`; }
  function kisaTarih(iso) { const d = tarih(iso); return `${d.getDate()} ${AY[d.getMonth()]} ${GUN_UZUN[d.getDay()]}`; }
  function buyukBaslik(iso) {
    const f = gunFarki(bugun(), iso);
    return f === 0 ? 'Bugün' : f === 1 ? 'Yarın' : f === -1 ? 'Dün' : GUN_UZUN[tarih(iso).getDay()];
  }
  const GECERLI_GUN = /^\d{4}-\d{2}-\d{2}$/;
  const SAAT = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
  function dkSaat(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
  function saatDk(dk) { return `${String(Math.floor(dk / 60)).padStart(2, '0')}:${String(dk % 60).padStart(2, '0')}`; }
  function suAnDk() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function sureYaz(dk) {
    const h = Math.floor(dk / 60), m = Math.round(dk % 60);
    return h ? (m ? `${h} sa ${m} dk` : `${h} sa`) : `${m} dk`;
  }
  function yerelSaat(isoZaman) { const d = new Date(isoZaman); return { gun: isoGun(d), dk: d.getHours() * 60 + d.getMinutes() }; }

  /** Sunucudaki biçimin aynısı: "[Alan] 14:00-15:00 Başlık | dk | not". */
  function satirAyir(s) {
    let m = String(s).trim();
    let alan = null;
    const a = /^\[([^\]]{1,40})\]\s*/.exec(m);
    if (a) { alan = a[1].trim() || null; m = m.slice(a[0].length); }
    const p = m.split('|');
    const dkVar = p.length > 1 && /^\d{1,4}$/.test(p[1].trim()) && Number(p[1]) <= 1440;
    let baslik = p[0].trim();
    let bas = null, bit = null;
    const z = /^(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})\s*(?:[—–-]\s*)?/.exec(baslik);
    if (z) {
      const s2 = (h, mm) => `${String(+h).padStart(2, '0')}:${mm}`;
      const b1 = s2(z[1], z[2]), b2 = s2(z[3], z[4]);
      if (SAAT.test(b1) && SAAT.test(b2) && b2 > b1 && baslik.slice(z[0].length).trim()) {
        bas = b1; bit = b2; baslik = baslik.slice(z[0].length).trim();
      }
    }
    return { alan, baslik, bas, bit, dk: dkVar ? Number(p[1].trim()) : null, not: (dkVar ? p.slice(2) : p.slice(1)).join('|').trim() };
  }

  // CRM'den alınan iş notunun sonunda görünmez bir işaret taşır: ⟨crm:g61⟩. Böylece aynı iş iki kez gelmez.
  const CRM_ISARET = /⟨crm:([A-Za-z0-9_-]{1,64})⟩/;
  function crmIsareti(g) { const m = CRM_ISARET.exec(g.not || ''); return m ? m[1] : null; }
  function notGoster(not) { return String(not || '').replace(/\s*⟨crm:[^⟩]*⟩\s*/g, ' ').trim(); }

  function el(etiket, ozellik, ...cocuklar) {
    const e = document.createElement(etiket);
    if (ozellik) {
      for (const [k, v] of Object.entries(ozellik)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') e.style.cssText = v;
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
    tik: ['M5 12.5l4.2 4.2L19 7'],
    daha: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    sol: ['M15 5l-7 7 7 7'],
    sag: ['M9 5l7 7-7 7'],
    arti: ['M12 5v14', 'M5 12h14'],
    menu: ['M4 7h16', 'M4 12h16', 'M4 17h10'],
    oynat: ['M8 5.5v13l10.5-6.5z']
  };
  function ikon(ad) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'ikon');
    if (ad === 'daha') s.style.strokeWidth = '3.4';
    for (const d of IKON[ad]) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.append(p); }
    return s;
  }

  function depoOku(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function depoYaz(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* gizli sekme */ } }

  /* ======================= durum ======================= */

  const kok = document.getElementById('uygulama');
  const D = {
    gorevler: [], haftalar: [], seanslar: [], kapanislar: [], ayarlar: { haftalikDerinHedef: 20 },
    kalici: true, uyari: null, guncellendi: null,
    secili: bugun(), acikNotlar: new Set(), bekleyenSil: null,
    crm: { durum: 'yukleniyor', isler: [] },     // CRM'den bugünkü işlerim
    toplantilar: [],                             // takvimdeki kişili toplantılar (kart randevuları dahil)
    crmHepsi: false,
    odak: null,                                  // sunucudaki süren odak (Instagram kestirmesi bunu sorar)
    takvimAyna: false                            // saatli işler Google Takvim'e de yazılıyor mu
  };
  {
    const istenen = new URLSearchParams(location.search).get('gun');
    if (istenen && GECERLI_GUN.test(istenen)) D.secili = istenen;
  }
  let bekleyenIslem = 0;
  let geciciSayac = 0;
  let senkronZamanlayici = null;
  let kurulumOlayi = null;

  function bul(id) { return D.gorevler.find((g) => g.id === id); }

  /** Gün sırası: saatliler saate göre önce, saatsizler planın sırasıyla sonra. */
  function gunGorevleri(gun) {
    return D.gorevler.filter((g) => g.gun === gun).sort((a, b) => {
      if (a.bas && b.bas) return a.bas.localeCompare(b.bas);
      if (a.bas) return -1;
      if (b.bas) return 1;
      return (a.sira ?? 0) - (b.sira ?? 0) || String(a.olusturuldu || '').localeCompare(String(b.olusturuldu || ''));
    });
  }
  function ustler(gun) { return gunGorevleri(gun).filter((g) => g.ust).slice(0, 3); }

  function kalanlar() {
    const b = bugun();
    const sinir = gunEkle(b, -14);
    return D.gorevler.filter((g) => !g.bitti && !g.gecici && g.gun < b && g.gun >= sinir);
  }

  function gunToplantilari(gun) {
    return D.toplantilar.map((t) => {
      const b = yerelSaat(t.bas), e = yerelSaat(t.bit);
      return { t, gun: b.gun, b: b.dk, e: e.gun === b.gun ? e.dk : 1440 };
    }).filter((x) => x.gun === gun && x.e > x.b);
  }

  /** CRM'den gelen, henüz DeepCore'a alınmamış işler. Alınan iş bitince ertesi gün CRM hâlâ açık diyorsa geri gelir. */
  function crmBekleyen() {
    const b = bugun();
    return D.crm.isler.filter((i) => !D.gorevler.some((g) => crmIsareti(g) === i.id && (!g.bitti || g.gun === b)));
  }
  function crmIsi(id) { return D.crm.isler.find((i) => i.id === id) || null; }
  function crmKoku() {
    const a = D.crm.isler.find((i) => i.adres);
    try { return a ? new URL(a.adres).origin : null; } catch { return null; }
  }

  function haftaNotu(gun) { return D.haftalar.filter((h) => h.bas <= gun && gun <= h.son).pop() || null; }

  function derinDk(gunler) {
    const k = new Set(gunler);
    return D.seanslar.filter((s) => s.derin !== false && k.has(s.gun)).reduce((t, s) => t + s.dk, 0);
  }

  /** Şimdi ne yapmalıyım? Toplantı (15 dk içinde ya da sürüyor) → saati şu ana düşen blok → sıradaki saatli →
      Bugünün 3'ünden ilk açık → ilk saatsiz. */
  function simdikiIs() {
    const b = bugun();
    const an = suAnDk();
    const t = gunToplantilari(b).find((x) => x.b - 15 <= an && an < x.e);
    if (t) return { toplanti: t, tur: t.b <= an ? 'simdi' : 'sonraki' };
    const l = gunGorevleri(b).filter((g) => !g.bitti && !g.gecici);
    const icinde = l.find((g) => g.bas && dkSaat(g.bas) <= an && an < dkSaat(g.bit));
    if (icinde) return { g: icinde, tur: 'simdi' };
    const sonraki = l.find((g) => g.bas && dkSaat(g.bas) > an);
    const saatsiz = l.find((g) => !g.bas && g.ust) || l.find((g) => !g.bas);
    if (sonraki && (!saatsiz || dkSaat(sonraki.bas) - an <= 30)) return { g: sonraki, tur: 'sonraki' };
    if (saatsiz) return { g: saatsiz, tur: 'saatsiz' };
    if (sonraki) return { g: sonraki, tur: 'sonraki' };
    const kacirilan = l.find((g) => g.bas);
    return kacirilan ? { g: kacirilan, tur: 'kacti' } : null;
  }

  function veriAl(v) {
    D.gorevler = Array.isArray(v.gorevler) ? v.gorevler : [];
    D.haftalar = Array.isArray(v.haftalar) ? v.haftalar : [];
    D.seanslar = Array.isArray(v.seanslar) ? v.seanslar : [];
    D.kapanislar = Array.isArray(v.kapanislar) ? v.kapanislar : [];
    D.ayarlar = v.ayarlar || { haftalikDerinHedef: 20 };
    D.kalici = v.kalici !== false;
    D.uyari = v.uyari || null;
    D.guncellendi = v.guncellendi || null;
    D.odak = v.odak || null;
    D.takvimAyna = v.takvimAyna === true;
  }

  /* ======================= sunucu ======================= */

  async function istek(yol, govde, keepalive) {
    try {
      const c = await fetch('/api/plan' + yol, {
        method: govde ? 'POST' : 'GET',
        headers: govde ? { 'Content-Type': 'application/json' } : undefined,
        body: govde ? JSON.stringify(govde) : undefined,
        credentials: 'same-origin', cache: 'no-store', keepalive: Boolean(keepalive)
      });
      let v = null;
      try { v = await c.json(); } catch { /* boş */ }
      if (c.status === 401 && yol !== '/giris') girisGoster(senkronZamanlayici ? 'Oturumun kapandı. Şifreni tekrar yaz.' : undefined);
      return { ok: c.ok, durum: c.status, v: v || {} };
    } catch {
      return { ok: false, durum: 0, v: {} };
    }
  }

  async function islem(govde, keepalive) {
    bekleyenIslem++;
    try { return await istek('/islem', govde, keepalive); }
    finally { bekleyenIslem--; }
  }

  function hataBildir(r) {
    if (r.durum === 401) return;
    if (r.durum === 0) bildir('Bağlantı yok — kaydedilmedi');
    else if (r.durum === 503) bildir('Sunucu şu an yazamıyor — tekrar dene');
    else if (r.v.sebep === 'aralik') bildir('Bitiş saati başlangıçtan sonra olmalı');
    else bildir('Kaydedilemedi — tekrar dene');
  }

  /** Dış kaynaklar: CRM işleri + takvim toplantıları. Plan girişiyle aynı oturum; biri düşerse ekran yine çalışır. */
  let disZamani = 0;
  async function disYukle() {
    disZamani = Date.now();
    const al = async (yol) => {
      try {
        const c = await fetch(yol, { credentials: 'same-origin', cache: 'no-store' });
        return c.ok ? await c.json() : null;
      } catch { return null; }
    };
    const [isler, toplanti] = await Promise.all([al('/api/toplanti/isler'), al('/api/toplanti')]);
    D.crm = isler && Array.isArray(isler.isler) ? { durum: isler.durum || 'tamam', isler: isler.isler } : { durum: 'hata', isler: [] };
    D.toplantilar = toplanti && Array.isArray(toplanti.toplantilar) ? toplanti.toplantilar : D.toplantilar;
    if (senkronZamanlayici && !acikSayfa && !odakEkrani) ciz();
  }

  /* ======================= çizim ======================= */

  let ekleCubugu = null, ekleGirdi = null, ekleDugme = null;

  function ciz() {
    kok.setAttribute('aria-busy', 'false');
    const secili = D.secili;
    const bugunMu = secili === bugun();
    const liste = gunGorevleri(secili);
    const biten = liste.filter((g) => g.bitti).length;
    const p = [];

    // üst: ‹ tarih ›  ·  Bugün  ·  menü
    p.push(el('header', { class: 'ust' },
      el('div', { class: 'gezgin' },
        el('button', { type: 'button', 'aria-label': 'Önceki gün', onclick: () => gunSec(gunEkle(secili, -1)) }, ikon('sol')),
        el('span', { class: 'tarih-yazi', text: kisaTarih(secili) }),
        el('button', { type: 'button', 'aria-label': 'Sonraki gün', onclick: () => gunSec(gunEkle(secili, 1)) }, ikon('sag'))),
      el('div', { class: 'ust-sag' },
        !bugunMu ? el('button', { class: 'bugune', type: 'button', onclick: () => gunSec(bugun()) }, 'Bugün') : null,
        el('button', { class: 'ikon-dugme', type: 'button', 'aria-label': 'Menü', onclick: menuAc }, ikon('menu')))));
    p.push(el('h1', { class: 'buyuk-baslik', text: buyukBaslik(secili) }));

    const hafta = Array.from({ length: 7 }, (_, i) => gunEkle(haftaBasi(secili), i));
    const derinGun = derinDk([secili]);
    p.push(el('p', { class: 'ozet' },
      el('span', {}, el('b', { text: `${biten}/${liste.length}` }), ' bitti'),
      derinGun ? el('span', {}, 'Derin ', el('b', { text: sureYaz(derinGun) })) : null,
      el('span', {}, 'Hafta ', el('b', { text: (derinDk(hafta) / 60).toFixed(1).replace('.', ',') }), ` / ${D.ayarlar.haftalikDerinHedef} sa derin`)));

    // uyarılar
    if (!D.kalici) {
      p.push(el('div', { class: 'serit-uyari', role: 'status' },
        el('p', {}, 'Veriler kalıcı değil', el('small', { text: 'Coolify → Storages → /app/veri birimini ekle.' }))));
    }
    if (D.uyari) p.push(el('div', { class: 'serit-uyari', role: 'status' }, el('p', {}, D.uyari)));

    // ŞİMDİ
    if (bugunMu && !acikOdak()) {
      const kart = simdiKarti(liste);
      if (kart) p.push(kart);
    }

    // geçmişten kalan
    if (bugunMu) {
      const k = kalanlar();
      if (k.length) {
        const enEski = k.reduce((m, g) => (g.gun < m ? g.gun : m), k[0].gun);
        p.push(el('div', { class: 'serit-uyari' },
          el('p', {}, `Geçmişten ${k.length} iş kaldı`, el('small', { text: 'Yapılanı işaretle, kalanı bugüne al.' })),
          el('div', { class: 'dugmeler' },
            el('button', { type: 'button', class: 'ikincil', onclick: () => gunSec(enEski) }, 'Bak'),
            el('button', { type: 'button', onclick: kalanlariAl }, 'Bugüne al'))));
      }
    }

    p.push(ustBolumu(secili));
    const gorusmeler = gunToplantilari(secili);
    if (gorusmeler.length) {
      p.push(bolum('Görüşmeler', el('small', { text: `${gorusmeler.length} görüşme` }),
        el('div', { class: 'grup' }, gorusmeler.map((x) => el('button', { class: 'satir gorusme-satir', type: 'button', onclick: () => toplantiSayfasi(x.t, x.b, x.e) },
          el('span', { class: 'gorusme-saat', text: saatDk(x.b) }),
          el('span', { class: 'metin' }, el('span', { class: 'baslik', text: toplantiAdi(x.t).replace(/^Toplantı · /, '') }),
            el('span', { class: 'alt' }, el('span', { text: `${saatDk(x.b)}–${saatDk(x.e)}` }), x.t.meet ? el('span', { text: 'Meet' }) : null)))))));
    }
    p.push(saatBolumu(secili, liste));
    p.push(kafamBolumu(secili, liste));

    // kapanış ritüeli
    if (gunFarki(bugun(), secili) <= 0 && liste.length) {
      p.push(D.kapanislar.includes(secili)
        ? el('p', { class: 'kapandi' }, ikon('tik'), 'Gün kapandı')
        : el('button', { class: 'gunu-kapat', type: 'button', onclick: kapanisSayfasi }, 'Günü kapat'));
    }

    const h = haftaNotu(secili);
    if (h && h.not) {
      p.push(el('details', { class: 'bolum-not' }, el('summary', {}, h.baslik || 'Haftanın notu'), el('p', { class: 'not', text: h.not })));
    }

    const ipucu = kurulumIpucu();
    if (ipucu) p.push(ipucu);

    kok.replaceChildren(...p);
    ekleCubuguKur();
  }

  function simdiKarti(liste) {
    const s = simdikiIs();
    if (s && s.toplanti) {
      const { t, b, e } = s.toplanti;
      return el('section', { class: 'simdi toplanti-kart' + (s.tur === 'simdi' ? ' canli' : '') },
        el('p', { class: 'simdi-etiket' }, s.tur === 'simdi' ? 'Toplantı sürüyor' : 'Birazdan toplantı', el('span', { text: `${saatDk(b)}–${saatDk(e)}` })),
        el('p', { class: 'simdi-baslik', text: toplantiAdi(t) }),
        el('div', { class: 'simdi-dugmeler' },
          t.meet ? el('a', { class: 'odaklan', href: t.meet, target: '_blank', rel: 'noopener noreferrer' }, 'Meet’e katıl') : null,
          el('button', { class: t.meet ? 'ikincil-dugme' : 'odaklan', type: 'button', onclick: () => toplantiSayfasi(t, b, e) }, 'Ayrıntı')));
    }
    if (s) {
      const g = s.g;
      const etiket = { simdi: 'Şimdi', sonraki: 'Sıradaki', saatsiz: 'Sıradaki iş', kacti: 'Saati geçti' }[s.tur];
      const zaman = g.bas ? `${g.bas}–${g.bit}` : (g.dk ? sureYaz(g.dk) : '');
      return el('section', { class: 'simdi' + (s.tur === 'simdi' ? ' canli' : '') },
        el('p', { class: 'simdi-etiket' }, etiket, zaman ? el('span', { text: zaman }) : null),
        el('p', { class: 'simdi-baslik', text: g.baslik }),
        el('div', { class: 'simdi-dugmeler' },
          el('button', { class: 'odaklan', type: 'button', onclick: () => odakBaslat(g) }, ikon('oynat'), 'Odaklan'),
          el('button', { class: 'ikincil-dugme', type: 'button', onclick: () => isaretle(g) }, 'Bitti')));
    }
    if (liste.length) {
      return el('section', { class: 'simdi sakin' },
        el('p', { class: 'simdi-baslik', text: 'Bugünün işi bitti.' }),
        !D.kapanislar.includes(D.secili) ? el('p', { class: 'simdi-alt', text: 'Günü kapat, yarını çiz.' }) : null);
    }
    return null;
  }

  function bolum(baslik, sag, ...icerik) {
    return el('section', { class: 'bolum' }, el('div', { class: 'bolum-bas' }, el('h2', { text: baslik }), sag || null), ...icerik);
  }

  /* --- Bugünün 3'ü --- */
  function ustBolumu(gun) {
    const u = ustler(gun);
    const grup = el('div', { class: 'grup' });
    u.forEach((g, i) => grup.append(satir(g, { numara: i + 1 })));
    for (let i = u.length; i < 3; i++) {
      grup.append(el('button', { class: 'satir bos-satir', type: 'button', onclick: () => ustSecSayfasi(gun) },
        el('span', { class: 'numara', text: String(i + 1) }),
        el('span', { class: 'metin' }, el('span', { class: 'baslik', text: i === u.length ? 'En önemli işi seç' : '' }))));
    }
    return bolum('Bugünün 3’ü', u.length === 3 && u.every((g) => g.bitti) ? el('small', { text: 'Üçü de bitti' }) : null, grup);
  }

  /* --- Saatler: zaman ızgarası --- */
  const DK_PX = 46 / 60;
  function saatBolumu(gun, liste) {
    const bloklar = [
      ...liste.filter((g) => g.bas).map((g) => ({ tur: 'gorev', g, b: dkSaat(g.bas), e: dkSaat(g.bit) })),
      ...gunToplantilari(gun).map((x) => ({ tur: 'toplanti', t: x.t, b: x.b, e: x.e }))
    ].sort((x, y) => x.b - y.b || y.e - x.e);
    let h0 = 7, h1 = 23;
    for (const x of bloklar) { h0 = Math.min(h0, Math.floor(x.b / 60)); h1 = Math.max(h1, Math.ceil(x.e / 60)); }
    h1 = Math.min(24, h1);

    // çakışanları yan yana diz
    let grup = [], grupSon = -1, seritSon = [];
    const kapat = () => { const n = Math.max(...grup.map((x) => x.serit)) + 1; grup.forEach((x) => { x.n = n; }); grup = []; seritSon = []; };
    for (const x of bloklar) {
      if (grup.length && x.b >= grupSon) kapat();
      let s = seritSon.findIndex((son) => son <= x.b);
      if (s < 0) s = seritSon.length;
      seritSon[s] = x.e;
      x.serit = s;
      grup.push(x);
      grupSon = Math.max(grupSon, x.e);
    }
    if (grup.length) kapat();

    const izgara = el('div', { class: 'saatler' });
    for (let h = h0; h < h1; h++) {
      izgara.append(el('button', { class: 'saat-satir', type: 'button', 'aria-label': `${h}:00 saatine iş koy`, onclick: () => saateKoySayfasi(gun, h * 60) },
        el('span', { class: 's', text: `${String(h).padStart(2, '0')}:00` }), el('span', { class: 'c' })));
    }
    const katman = el('div', { class: 'bloklar' });
    const an = suAnDk();
    const sm = gun === bugun() ? simdikiIs() : null;
    for (const x of bloklar) {
      const ust = (x.b - h0 * 60) * DK_PX;
      const yuk = Math.max(20, (x.e - x.b) * DK_PX - 2);
      const kisa = yuk < 38;
      const zaman = `${saatDk(x.b)}–${saatDk(x.e)}`;
      const stil = `top:${ust}px;height:${yuk}px;left:calc(${(x.serit / x.n) * 100}% + 2px);width:calc(${100 / x.n}% - 4px)`;
      if (x.tur === 'toplanti') {
        katman.append(el('button', { class: 'blok toplanti' + (kisa ? ' kisa' : ''), type: 'button', style: stil, onclick: () => toplantiSayfasi(x.t, x.b, x.e) },
          el('b', { text: toplantiAdi(x.t) }), el('span', { text: zaman })));
      } else {
        const canli = sm && sm.g === x.g && sm.tur === 'simdi';
        katman.append(el('button', {
          class: 'blok' + (x.g.bitti ? ' bitti' : '') + (kisa ? ' kisa' : '') + (canli ? ' canli' : ''), type: 'button', style: stil,
          'data-id': x.g.id, onclick: () => gorevSayfasi(x.g)
        }, el('b', { text: x.g.baslik }), el('span', { text: zaman })));
      }
    }
    if (gun === bugun() && an >= h0 * 60 && an < h1 * 60) {
      katman.append(el('i', { class: 'simdi-cizgi', style: `top:${(an - h0 * 60) * DK_PX}px`, 'aria-hidden': 'true' }));
    }
    izgara.append(katman);
    return bolum('Saatler', bloklar.length ? null : el('small', { text: 'Boş bir saate dokun' }), izgara);
  }

  function toplantiAdi(t) {
    const k = t.kisi || {};
    const ad = [k.ad, k.firma ? `(${k.firma})` : null].filter(Boolean).join(' ');
    return ad ? `Toplantı · ${ad}` : (t.baslik || 'Toplantı');
  }

  /* --- Kafamdakiler: saatsiz işler + CRM --- */
  function kafamBolumu(gun, liste) {
    const saatsiz = liste.filter((g) => !g.bas && !g.ust);
    const KADRAN_SIRA = { 1: 0, 3: 1, 2: 2 };
    const acik = saatsiz.filter((g) => !g.bitti)
      .sort((a, b) => (KADRAN_SIRA[a.kadran] ?? 3) - (KADRAN_SIRA[b.kadran] ?? 3));
    const siniflanmamis = acik.filter((g) => !g.kadran && !g.gecici);
    const onerili = siniflanmamis.filter((g) => g.oneri);
    const bitmis = saatsiz.filter((g) => g.bitti);
    const parca = [];
    if (saatsiz.length) {
      parca.push(el('div', { class: 'grup' }, [...acik, ...bitmis].map((g) => satir(g))));
    }

    // CRM yalnız bugün görünür: "en güncel işlerim"
    if (gun === bugun()) {
      const crm = crmBekleyen();
      if (crm.length) {
        const sinir = D.crmHepsi ? crm.length : 5;
        const grup = el('div', { class: 'grup', style: saatsiz.length ? 'margin-top:12px' : null }, crm.slice(0, sinir).map(crmSatiri));
        if (crm.length > sinir) {
          grup.append(el('button', { class: 'daha-fazla', type: 'button', onclick: () => { D.crmHepsi = true; ciz(); } }, `${crm.length - sinir} iş daha`));
        }
        parca.push(el('p', { class: 'bolum-not', style: 'margin:14px 4px 8px', text: 'CRM’den — dokun, bugüne al' }), grup);
      } else if (D.crm.durum === 'bekliyor') {
        parca.push(el('p', { class: 'bolum-not', text: 'CRM bağlantısı yayın bekliyor.' }));
      }
    }
    if (!parca.length) {
      parca.push(el('div', { class: 'grup' }, el('div', { class: 'satir bos-satir' },
        el('span', { class: 'metin' }, el('span', { class: 'baslik', text: 'Aklındakini aşağıya yaz.' })))));
    }
    const sag = siniflanmamis.length
      ? el('button', { class: 'bolum-dugme', type: 'button', onclick: () => matrisSayfasi(siniflanmamis.map((g) => g.id)) },
        onerili.length ? `Önerileri gör · ${siniflanmamis.length}` : `Sınıflandır · ${siniflanmamis.length}`)
      : acik.length ? el('small', { text: `${acik.length} açık` }) : null;
    return bolum('Kafamdakiler', sag, ...parca);
  }

  function crmSatiri(i) {
    const TUR = { takip: 'Takip', dogrula: 'Doğrula', is: 'Görev', oneri: 'Öneri' };
    const alan = alanBul(i.proje);
    const alt = el('span', { class: 'alt' },
      el('span', { class: 'rozet ' + i.tur, text: TUR[i.tur] || 'CRM' }),
      alan ? el('span', {}, el('i', { class: 'renk', style: alan.renk ? `--renk:${alan.renk}` : null }), ' ', alan.ad) : null,
      i.gecikti ? el('span', { class: 'gecikti', text: 'gecikti' }) : null,
      i.dk ? el('span', { text: `${i.dk} dk` }) : null);
    return el('div', { class: 'satir' },
      el('button', { class: 'metin', type: 'button', onclick: () => crmSayfasi(i) }, el('span', { class: 'baslik', text: i.baslik }), alt),
      el('button', { class: 'sag-dugme ekle-dugme', type: 'button', 'aria-label': 'Bugüne al: ' + i.baslik, onclick: () => crmAl(i, {}) }, ikon('arti')));
  }

  function satir(g, { numara } = {}) {
    const alan = alanBul(g.alan);
    const acik = D.acikNotlar.has(g.id);
    const not = notGoster(g.not);
    const crmId = crmIsareti(g);
    const alt = el('span', { class: 'alt' });
    if (alan) alt.append(el('span', {}, el('i', { class: 'renk', style: alan.renk ? `--renk:${alan.renk}` : null }), ' ', alan.ad));
    if (g.bas) alt.append(el('span', { text: `${g.bas}–${g.bit}` }));
    else if (g.dk) alt.append(el('span', { text: `${g.dk} dk` }));
    if (crmId) alt.append(el('span', { class: 'rozet oneri', text: 'CRM' }));
    if (g.kadran && !g.bitti && !g.ust && KADRAN[g.kadran].rozet) alt.append(el('span', { class: 'rozet kadran-' + g.kadran, text: KADRAN[g.kadran].rozet }));
    else if (!g.kadran && g.oneri && !g.bitti && !g.ust) alt.append(el('span', { class: 'rozet oneri', text: 'Öneri: ' + KADRAN[g.oneri].kisa }));
    if (not && !acik) alt.append(el('span', { text: 'not' }));

    const metin = el('button', {
      class: 'metin', type: 'button', disabled: g.gecici || null,
      onclick: () => {
        if (!not) return gorevSayfasi(g);
        if (D.acikNotlar.has(g.id)) D.acikNotlar.delete(g.id); else D.acikNotlar.add(g.id);
        ciz();
      }
    }, el('span', { class: 'baslik', text: g.baslik }), alt.childNodes.length ? alt : null,
    acik && not ? el('span', { class: 'not', text: not }) : null);

    const tik = el('button', {
      class: 'tik', type: 'button', 'aria-pressed': String(Boolean(g.bitti)),
      'aria-label': (g.bitti ? 'Geri al: ' : 'Bitti: ') + g.baslik, disabled: g.gecici || null, onclick: () => isaretle(g)
    }, ikon('tik'));
    if (numara && !g.bitti) { tik.replaceChildren(); tik.classList.add('numara'); tik.textContent = String(numara); }

    return el('div', { class: 'satir' + (g.bitti ? ' bitti' : '') + (g.gecici ? ' gecici' : ''), 'data-id': g.id },
      tik, metin,
      el('button', { class: 'sag-dugme', type: 'button', 'aria-label': 'Seçenekler: ' + g.baslik, disabled: g.gecici || null, onclick: () => gorevSayfasi(g) }, ikon('daha')));
  }

  function ekleCubuguKur() {
    if (ekleCubugu && document.body.contains(ekleCubugu)) {
      ekleGirdi.placeholder = D.secili === bugun() ? 'Aklındakini yaz · 14:00-15:00 ile saate koy' : `${gunBasligi(D.secili)} — ekle…`;
      return;
    }
    ekleGirdi = el('input', { type: 'text', name: 'gorev', autocomplete: 'off', enterkeyhint: 'done', maxlength: '600', 'aria-label': 'Yeni iş' });
    ekleDugme = el('button', { type: 'submit', 'aria-label': 'Ekle', disabled: true }, ikon('arti'));
    ekleGirdi.addEventListener('input', () => { ekleDugme.disabled = !ekleGirdi.value.trim(); });
    const form = el('form', { autocomplete: 'off' }, ekleGirdi, ekleDugme);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = ekleGirdi.value;
      ekleGirdi.value = '';
      ekleDugme.disabled = true;
      ekle(v);
    });
    ekleCubugu = el('div', { class: 'ekle' }, form);
    document.body.append(ekleCubugu);
    ekleCubuguKur();
  }

  /* ======================= işlemler ======================= */

  function gunSec(gun) {
    if (!GECERLI_GUN.test(gun)) return;
    D.secili = gun;
    ciz();
    window.scrollTo({ top: 0 });
  }

  async function isaretle(g) {
    if (g.gecici) return;
    const yeni = !g.bitti;
    g.bitti = yeni;
    g.bittiZaman = yeni ? new Date().toISOString() : null;
    ciz();
    if (yeni && navigator.vibrate) navigator.vibrate(8);
    const r = await islem({ islem: 'isaretle', id: g.id, bitti: yeni });
    if (!r.ok) { g.bitti = !yeni; g.bittiZaman = null; ciz(); hataBildir(r); }
    else {
      D.guncellendi = null;
      const crmId = crmIsareti(g);
      if (yeni && crmId && crmIsi(crmId)?.adres) bildir('Bitti. CRM’de de kapat', 'Aç', () => window.open(crmIsi(crmId).adres, '_blank', 'noopener'), 4000);
    }
  }

  /** Sunucuya yeni görev yazar; ekranda geçici satır gösterir. Başarıda görevi döndürür. */
  async function ekleSunucu(m, gun) {
    const parca = satirAyir(m);
    if (!parca.baslik) { bildir('Başlık boş olamaz'); return null; }
    const gecici = { id: 'gecici-' + (++geciciSayac), gun, sira: 1e9, ...parca, bitti: false, gecici: true };
    D.gorevler.push(gecici);
    ciz();
    const r = await islem({ islem: 'ekle', gun, metin: m });
    D.gorevler = D.gorevler.filter((x) => x !== gecici);
    if (r.ok && r.v.gorev) {
      D.gorevler.push(r.v.gorev);
      D.guncellendi = null;
      ciz();
      return r.v.gorev;
    }
    ciz();
    hataBildir(r);
    return null;
  }

  async function ekle(metin) {
    const m = String(metin).trim();
    if (!m) return;
    const g = await ekleSunucu(m, D.secili);
    if (!g) {
      if (ekleGirdi && !ekleGirdi.value) { ekleGirdi.value = m; ekleDugme.disabled = false; }
      return;
    }
    if (g.bas) bildir(`${g.bas}–${g.bit} saatine kondu`);
  }

  /** CRM işini DeepCore'a al: bugüne, istenirse saatle ya da Bugünün 3'üne. */
  async function crmAl(i, { bas, bit, ust } = {}) {
    sayfaKapat();
    const alan = alanBul(i.proje);
    const baslik = i.baslik.replace(/\|/g, '/').replace(/[⟨⟩]/g, '');
    const m = `${alan && alan.renk ? `[${alan.ad}] ` : ''}${bas ? `${bas}-${bit} ` : ''}${baslik} | ${i.dk || ''} | ⟨crm:${i.id}⟩`.replace('|  |', '|');
    const g = await ekleSunucu(m, bugun());
    if (!g) return;
    if (ust) await ustYap(g, true);
    bildir(bas ? `${bas}–${bit} saatine kondu` : ust ? 'Bugünün 3’üne kondu' : 'Bugüne alındı');
  }

  async function ustYap(g, deger) {
    if (deger && !g.ust && ustler(g.gun).length >= 3) return bildir('Üç iş dolu — önce birini çıkar');
    const eski = g.ust;
    g.ust = deger;
    ciz();
    const r = await islem({ islem: 'duzenle', id: g.id, ust: deger });
    if (!r.ok) { g.ust = eski; ciz(); hataBildir(r); }
    else { Object.assign(g, r.v.gorev); D.guncellendi = null; }
  }

  async function tasi(g, gun) {
    if (g.gun === gun) return;
    const eski = { gun: g.gun, sira: g.sira };
    g.gun = gun;
    g.sira = 1e9;
    ciz();
    bildir(gun === bugun() ? 'Bugüne alındı' : gun === gunEkle(bugun(), 1) ? 'Yarına taşındı' : 'Taşındı → ' + gunBasligi(gun));
    const r = await islem({ islem: 'tasi', id: g.id, gun });
    if (!r.ok) { Object.assign(g, eski); ciz(); hataBildir(r); }
    else { Object.assign(g, r.v.gorev); D.guncellendi = null; }
  }

  async function kalanlariAl() {
    const liste = kalanlar();
    if (!liste.length) return;
    const b = bugun();
    const eski = liste.map((g) => [g, g.gun, g.sira]);
    liste.forEach((g, i) => { g.gun = b; g.sira = 1e9 + i; });
    ciz();
    const r = await islem({ islem: 'tasiCok', gun: b, idler: liste.map((g) => g.id) });
    if (!r.ok) { eski.forEach(([g, gun, sira]) => { g.gun = gun; g.sira = sira; }); ciz(); return hataBildir(r); }
    for (const s of r.v.gorevler || []) Object.assign(bul(s.id) || {}, s);
    D.guncellendi = null;
    bildir(`${liste.length} iş bugüne alındı`);
  }

  async function duzenle(g, degisiklik) {
    const eski = { baslik: g.baslik, not: g.not, bas: g.bas, bit: g.bit };
    Object.assign(g, degisiklik);
    ciz();
    const r = await islem({ islem: 'duzenle', id: g.id, ...degisiklik });
    if (!r.ok) { Object.assign(g, eski); ciz(); hataBildir(r); return false; }
    Object.assign(g, r.v.gorev);
    D.guncellendi = null;
    return true;
  }

  function sil(g) {
    silmeyiGonder();
    D.gorevler = D.gorevler.filter((x) => x.id !== g.id);
    D.acikNotlar.delete(g.id);
    ciz();
    const zaman = setTimeout(() => silmeyiGonder(), 5000);
    D.bekleyenSil = { gorev: g, zaman };
    bildir('Silindi', 'Geri al', () => {
      if (!D.bekleyenSil || D.bekleyenSil.gorev !== g) return;
      clearTimeout(zaman);
      D.bekleyenSil = null;
      D.gorevler.push(g);
      ciz();
    }, 5000);
  }

  async function silmeyiGonder(keepalive) {
    const b = D.bekleyenSil;
    if (!b) return;
    D.bekleyenSil = null;
    clearTimeout(b.zaman);
    const r = await islem({ islem: 'sil', id: b.gorev.id }, keepalive);
    if (!r.ok && r.durum !== 404 && !keepalive) { D.gorevler.push(b.gorev); ciz(); bildir('Silinemedi — geri getirildi'); }
    else if (r.ok) D.guncellendi = null;
  }

  /* ======================= saate koyma ======================= */

  /** O günün dolu aralıkları (dakika): saatli görevler + toplantılar; haric = yerleştirilen görevin kendisi. */
  function doluAraliklar(gun, haric) {
    return [
      ...gunGorevleri(gun).filter((g) => g.bas && g !== haric && !g.bitti).map((g) => [dkSaat(g.bas), dkSaat(g.bit)]),
      ...gunToplantilari(gun).map((x) => [x.b, x.e])
    ];
  }

  function bosBaslangiclar(gun, sure, haric, adet = 8) {
    const dolu = doluAraliklar(gun, haric);
    let bas = 9 * 60;
    if (gun === bugun()) bas = Math.max(7 * 60, Math.ceil((suAnDk() + 5) / 30) * 30);
    else if (gun < bugun()) bas = 9 * 60;
    const sonuc = [];
    for (let b = bas; b + sure <= 24 * 60 && sonuc.length < adet; b += 30) {
      if (!dolu.some(([x, y]) => b < y && x < b + sure)) sonuc.push(b);
    }
    return sonuc;
  }

  function varsayilanSure(dk) {
    if (!dk) return 60;
    return Math.max(15, Math.min(240, Math.round(dk / 15) * 15));
  }

  /** Bir işi saate koy: başlangıç ve süre çipleri. oge = { tur: 'gorev', g } | { tur: 'crm', i } */
  function yerlestirSayfasi(oge, sonra) {
    const gun = oge.tur === 'gorev' ? oge.g.gun : bugun();
    const baslik = oge.tur === 'gorev' ? oge.g.baslik : oge.i.baslik;
    const haric = oge.tur === 'gorev' ? oge.g : null;
    let sure = varsayilanSure(oge.tur === 'gorev' ? (oge.g.bas ? dkSaat(oge.g.bit) - dkSaat(oge.g.bas) : oge.g.dk) : oge.i.dk);
    let secili = null;
    const surelerKutu = el('div', { class: 'cipler' });
    const saatlerKutu = el('div', { class: 'cipler' });
    const ozet = el('p', { class: 'yerlestir-ozet' });
    const koy = el('button', { class: 'birincil', type: 'button', disabled: true, style: 'width:100%' }, 'Saate koy');

    const yenile = () => {
      surelerKutu.replaceChildren(...[15, 30, 45, 60, 90, 120, 180].map((s) => el('button', {
        class: 'cip', type: 'button', 'aria-pressed': String(s === sure), onclick: () => { sure = s; yenile(); }
      }, sureYaz(s))));
      const bos = bosBaslangiclar(gun, sure, haric);
      if (secili !== null && !bos.includes(secili)) secili = null;
      if (secili === null && bos.length) secili = bos[0];
      saatlerKutu.replaceChildren(...(bos.length ? bos.map((b) => el('button', {
        class: 'cip', type: 'button', 'aria-pressed': String(b === secili), onclick: () => { secili = b; yenile(); }
      }, saatDk(b))) : [el('p', { class: 'bolum-not', text: 'Bu süreye boş saat kalmadı. Süreyi kısalt.' })]));
      ozet.replaceChildren(...(secili !== null ? [el('b', { text: `${saatDk(secili)}–${saatDk(secili + sure)}` }), ` · ${sureYaz(sure)}`] : []));
      koy.disabled = secili === null;
    };
    koy.addEventListener('click', async () => {
      if (secili === null) return;
      const bas = saatDk(secili), bit = saatDk(secili + sure);
      if (oge.tur === 'crm') return crmAl(oge.i, { bas, bit });
      sayfaKapat();
      if (await duzenle(oge.g, { bas, bit })) bildir(`${bas}–${bit} saatine kondu${D.takvimAyna ? ' · takvimde' : ''}`);
      if (sonra) sonra();
    });
    yenile();
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: baslik }),
      el('p', { class: 'ara-baslik', text: 'Ne kadar sürer?' }), surelerKutu,
      el('p', { class: 'ara-baslik', text: 'Ne zaman?' }), saatlerKutu,
      ozet, koy,
      secenek(sonra ? 'Şimdilik saatsiz bırak' : 'Vazgeç', () => { sayfaKapat(); if (sonra) sonra(); }, null, 'sade'));
  }

  /** Boş saate dokununca: bu saate ne koyalım? Kafamdakiler + CRM + yeni yaz. */
  function saateKoySayfasi(gun, dk) {
    const bas = saatDk(dk);
    const adaylar = gunGorevleri(gun).filter((g) => !g.bas && !g.bitti && !g.gecici);
    const crm = gun === bugun() ? crmBekleyen().slice(0, 6) : [];
    const yaz = el('input', { type: 'text', maxlength: '300', placeholder: 'Yeni iş yaz…', enterkeyhint: 'done', 'aria-label': 'Yeni iş' });
    const form = el('form', { class: 'duzen' }, yaz);
    const koy = async (sure, fn) => {
      const s = Math.min(sure, 24 * 60 - dk);
      const bit = saatDk(dk + s);
      sayfaKapat();
      await fn(bas, bit);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = yaz.value.trim().replace(/\|/g, '/');
      if (!v) return yaz.focus();
      koy(60, async (b, e2) => { const g = await ekleSunucu(`${b}-${e2} ${v}`, gun); if (g) bildir(`${b}–${e2} saatine kondu`); });
    });
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: `${bas}’a ne koyalım?` }),
      el('p', { class: 'sayfa-soru', text: 'Bir iş seç ya da yenisini yaz. Süreyi sonra değiştirebilirsin.' }),
      form,
      adaylar.length ? el('p', { class: 'ara-baslik', text: 'Kafamdakiler' }) : null,
      adaylar.map((g) => secenek(g.baslik, () => koy(varsayilanSure(g.dk), async (b, e2) => { if (await duzenle(g, { bas: b, bit: e2 })) bildir(`${b}–${e2} saatine kondu`); }), g.dk ? `${g.dk} dk` : null)),
      crm.length ? el('p', { class: 'ara-baslik', text: 'CRM’den' }) : null,
      crm.map((i) => secenek(i.baslik, () => koy(varsayilanSure(i.dk), (b, e2) => crmAl(i, { bas: b, bit: e2 })), i.dk ? `${i.dk} dk` : null)),
      secenek('Vazgeç', sayfaKapat, null, 'sade'));
    setTimeout(() => { if (!adaylar.length && !crm.length) yaz.focus(); }, 50);
  }

  /** Bugünün 3'üne aday seç: günün açık işleri + CRM. */
  function ustSecSayfasi(gun) {
    const adaylar = gunGorevleri(gun).filter((g) => !g.ust && !g.bitti && !g.gecici);
    const crm = gun === bugun() ? crmBekleyen().slice(0, 8) : [];
    const yaz = el('input', { type: 'text', maxlength: '300', placeholder: 'Ya da yeni yaz…', enterkeyhint: 'done', 'aria-label': 'Yeni önemli iş' });
    const form = el('form', { class: 'duzen' }, yaz);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = yaz.value.trim();
      if (!v) return yaz.focus();
      sayfaKapat();
      const g = await ekleSunucu(v, gun);
      if (g) await ustYap(g, true);
    });
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: 'Bugünün en önemli işi' }),
      el('p', { class: 'sayfa-soru', text: 'Gün bittiğinde “bunu yaptım” demek istediğin iş.' }),
      form,
      adaylar.length ? el('p', { class: 'ara-baslik', text: 'Listende' }) : null,
      adaylar.map((g) => secenek(g.baslik, () => { sayfaKapat(); ustYap(g, true); }, g.bas ? `${g.bas}` : null)),
      crm.length ? el('p', { class: 'ara-baslik', text: 'CRM’den' }) : null,
      crm.map((i) => secenek(i.baslik, () => crmAl(i, { ust: true }), i.gecikti ? 'gecikti' : null)),
      secenek('Vazgeç', sayfaKapat, null, 'sade'));
  }

  /* ======================= derin odak ======================= */

  // Açık seans telefonda saklanır: sayfa kapanıp açılsa da sayaç kaldığı yerden devam eder.
  function acikOdak() {
    try { return JSON.parse(depoOku('dc_odak') || 'null'); } catch { return null; }
  }

  let odakEkrani = null, odakZamanlayici = null, ekranKilidi = null;

  function odakBaslat(g) {
    sayfaKapat();
    const an = suAnDk();
    let hedef;
    if (g.bas && dkSaat(g.bas) <= an && an < dkSaat(g.bit)) hedef = dkSaat(g.bit) - an;   // bloğun sonuna kadar
    else if (g.bas) hedef = dkSaat(g.bit) - dkSaat(g.bas);
    else hedef = g.dk || 50;
    const o = { baslangic: Date.now(), hedefDk: Math.max(5, Math.min(240, hedef)), baslik: g.baslik, gorevId: g.id, gun: bugun() };
    depoYaz('dc_odak', JSON.stringify(o));
    odakGoster(o);
    odakBildir(o);
  }

  /** Sunucuya "odaktayım" de: Instagram kestirmesi bunu sorar. Hedef + 30 dk sonra kendiliğinden düşer. */
  function odakBildir(o) {
    const bitis = o ? new Date(o.baslangic + (o.hedefDk + 30) * 60e3).toISOString() : null;
    D.odak = o ? { bas: new Date(o.baslangic).toISOString(), bitis, baslik: o.baslik } : null;
    islem({ islem: 'odak', bitis, baslik: o ? o.baslik : '' }, !o).catch(() => {});
  }

  async function ekranAcikKalsin() {
    try { if ('wakeLock' in navigator && !document.hidden) ekranKilidi = await navigator.wakeLock.request('screen'); } catch { /* izin yok */ }
  }

  function odakGoster(o) {
    if (odakEkrani) odakEkrani.remove();
    const kalan = el('p', { class: 'odak-sayac', 'aria-live': 'off' });
    const alt = el('p', { class: 'odak-alt' });
    const halka = el('i');
    odakEkrani = el('div', { class: 'odak', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Derin odak' },
      el('div', { class: 'odak-ic' },
        el('p', { class: 'goz', text: 'Derin odak' }),
        el('h2', { class: 'odak-baslik', text: o.baslik }),
        kalan, el('span', { class: 'odak-cubuk' }, halka), alt,
        el('p', { class: 'odak-kural', text: 'Telefonu bırak. Tek iş. Bitince bas.' }),
        el('div', { class: 'odak-dugmeler' },
          el('button', { class: 'birincil', type: 'button', onclick: () => odakBitir(false) }, 'Bitir'),
          el('button', { class: 'sade-beyaz', type: 'button', onclick: () => odakBitir(true) }, 'Dağıldım, bırak'))));
    document.body.append(odakEkrani);
    if (ekleCubugu) ekleCubugu.hidden = true;
    const tik = () => {
      const gecen = (Date.now() - o.baslangic) / 1000;
      const hedefSn = o.hedefDk * 60;
      const fark = Math.round(hedefSn - gecen);
      const m = Math.floor(Math.abs(fark) / 60), s = Math.abs(fark) % 60;
      const yazi = `${fark < 0 ? '+' : ''}${m}:${String(s).padStart(2, '0')}`;
      kalan.textContent = yazi;
      kalan.classList.toggle('asti', fark < 0);
      halka.style.transform = `scaleX(${Math.min(1, gecen / hedefSn)})`;
      alt.textContent = fark < 0 ? `Hedef ${o.hedefDk} dk doldu — istersen devam et` : `${o.hedefDk} dk hedef · ${sureYaz(Math.floor(gecen / 60))} geçti`;
      document.title = `${yazi} · DeepCore`;
      if (fark === 0 && navigator.vibrate) navigator.vibrate([120, 80, 120]);
    };
    tik();
    clearInterval(odakZamanlayici);
    odakZamanlayici = setInterval(tik, 1000);
    ekranAcikKalsin();
  }

  async function odakBitir(dagildi) {
    const o = acikOdak();
    clearInterval(odakZamanlayici);
    odakZamanlayici = null;
    try { await ekranKilidi?.release(); } catch { /* yoksay */ }
    ekranKilidi = null;
    depoYaz('dc_odak', null);
    odakBildir(null);
    document.title = 'DeepCore';
    if (odakEkrani) { odakEkrani.remove(); odakEkrani = null; }
    if (ekleCubugu) ekleCubugu.hidden = false;
    if (!o) return ciz();
    const dk = Math.floor((Date.now() - o.baslangic) / 60000);
    if (dk < 1) { ciz(); return bildir('1 dakikadan kısa — kaydedilmedi'); }
    const r = await islem({ islem: 'seansKaydet', gun: o.gun, dk, baslik: o.baslik, gorevId: o.gorevId || null, kesildi: dagildi });
    if (r.ok && r.v.seans) { D.seanslar.push(r.v.seans); D.guncellendi = null; }
    ciz();
    if (!r.ok) return hataBildir(r);
    const g = o.gorevId && bul(o.gorevId);
    if (g && !g.bitti && !dagildi) {
      sayfaAc(
        el('p', { class: 'sayfa-baslik', text: `${sureYaz(dk)} derin iş kaydedildi.` }),
        el('p', { class: 'sayfa-soru', text: g.baslik }),
        secenek('Bitti, işaretle', () => { sayfaKapat(); isaretle(g); }),
        secenek('Devam edecek', sayfaKapat, null, 'sade'));
    } else {
      bildir(`${sureYaz(dk)} derin iş kaydedildi`);
    }
  }

  /* ======================= alt sayfalar ======================= */

  let acikSayfa = null;

  function sayfaAc(...icerik) {
    sayfaKapat();
    document.querySelectorAll('dialog.sayfa').forEach((x) => x.remove());
    const d = el('dialog', { class: 'sayfa' }, el('div', { class: 'sayfa-ic' }, el('div', { class: 'tutamac', 'aria-hidden': 'true' }), ...icerik));
    d.addEventListener('click', (e) => { if (e.target === d) sayfaKapat(); });
    d.addEventListener('close', () => { d.remove(); if (acikSayfa === d) acikSayfa = null; });
    document.body.append(d);
    acikSayfa = d;
    d.showModal();
    return d;
  }

  /** Kapanış olayına güvenmez: diyalog anında kapanır VE DOM'dan çıkar. */
  function sayfaKapat() {
    const d = acikSayfa;
    if (!d) return;
    acikSayfa = null;
    if (d.open) d.close();
    d.remove();
  }

  function secenek(metin, is, ek, sinif) {
    return el('button', { class: 'secenek' + (sinif ? ' ' + sinif : ''), type: 'button', onclick: is }, el('span', { text: metin }), ek ? el('small', { text: ek }) : null);
  }
  function bag(metin, href, ek) {
    return el('a', { class: 'secenek', href, target: href.startsWith('/') ? null : '_blank', rel: 'noopener noreferrer', style: 'text-decoration:none' },
      el('span', { text: metin }), ek ? el('small', { text: ek }) : null);
  }

  /* ======================= önem / aciliyet ======================= */

  const KADRAN = {
    1: { ad: 'Acil + önemli', alt: 'Bugün yap', kisa: 'Acil + önemli', rozet: 'Acil · önemli' },
    2: { ad: 'Önemli', alt: 'Saate koy', kisa: 'Önemli', rozet: 'Önemli' },
    3: { ad: 'Acil, önemsiz', alt: 'Hızlı hallet', kisa: 'Hızlı hallet', rozet: 'Hızlı' },
    4: { ad: 'İkisi de değil', alt: 'Sil', kisa: 'Gereksiz', rozet: null }
  };

  /** Kafadakileri tek tek sınıflandır: her iş için 4 kutudan birine dokun, sıradaki gelir. */
  function matrisSayfasi(idler) {
    const kalan = idler.slice();
    const sonraki = () => {
      let g = null;
      while (kalan.length && !g) {
        const x = bul(kalan.shift());
        if (x && !x.bitti && !x.gecici) g = x;
      }
      if (!g) { sayfaKapat(); return bildir('Hepsi sınıflandı ✓'); }
      const sec = async (k) => {
        if (k === 4) { sayfaKapat(); sil(g); return setTimeout(sonraki, 50); }
        const ok = await duzenle(g, { kadran: k });
        if (!ok) return sayfaKapat();
        if (k === 1) {
          if (!g.ust && ustler(g.gun).length < 3) await ustYap(g, true);
          else if (!g.ust) bildir('Bugünün 3’ü dolu — Kafamdakiler’in en üstünde');
          return sonraki();
        }
        if (k === 2) return yerlestirSayfasi({ tur: 'gorev', g }, sonraki);
        return sonraki();
      };
      const kutu = (k) => el('button', { class: 'kadran kadran-' + k + (g.oneri === k ? ' onerilen' : ''), type: 'button', onclick: () => sec(k) },
        el('b', { text: KADRAN[k].ad }), el('span', { text: g.oneri === k ? 'Öneri · ' + KADRAN[k].alt : KADRAN[k].alt }));
      const bekleyenOneri = [g, ...kalan.map(bul)].filter((x) => x && x.oneri && !x.kadran && !x.bitti);
      const hepsiniOnayla = async () => {
        sayfaKapat();
        let n = 0;
        for (const x of bekleyenOneri) {
          if (x.oneri === 4) continue;                   // silmeyi toplu yapma: tek tek karar ver
          const k = x.oneri;
          if (!(await duzenle(x, { kadran: k }))) break;
          if (k === 1 && !x.ust && ustler(x.gun).length < 3) await ustYap(x, true);
          n++;
        }
        bildir(`${n} öneri onaylandı`);
      };
      sayfaAc(
        el('p', { class: 'sayfa-baslik', text: g.baslik }),
        el('p', { class: 'sayfa-soru', text: kalan.length ? `Bu iş ne? · ${kalan.length} iş daha` : 'Bu iş ne?' }),
        el('div', { class: 'matris' },
          el('div', { class: 'matris-eksen', 'aria-hidden': 'true' }, el('span', { text: 'Acil' }), el('span', { text: 'Acil değil' })),
          kutu(1), kutu(2), kutu(3), kutu(4)),
        bekleyenOneri.length > 1 ? secenek(`Önerilerin hepsini onayla · ${bekleyenOneri.length}`, hepsiniOnayla) : null,
        secenek('Sonra bakarım', () => sonraki(), null, 'sade'),
        secenek('Bitir', sayfaKapat, null, 'sade'));
    };
    sonraki();
  }

  function gorevSayfasi(g) {
    if (g.gecici) return;
    const b = bugun();
    const yarin = gunEkle(b, 1);
    const crmId = crmIsareti(g);
    const crmAdres = crmId && crmIsi(crmId)?.adres;
    const not = notGoster(g.not);
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: g.baslik }),
      not ? el('p', { class: 'sayfa-soru', text: not }) : null,
      !g.bitti ? secenek('Odaklan', () => odakBaslat(g), g.bas ? `${g.bas}–${g.bit}` : (g.dk ? `${g.dk} dk` : '50 dk')) : null,
      secenek(g.bitti ? 'Geri al' : 'Bitti', () => { sayfaKapat(); isaretle(g); }),
      secenek(g.ust ? 'Bugünün 3’ünden çıkar' : 'Bugünün 3’üne koy', () => { sayfaKapat(); ustYap(g, !g.ust); }),
      !g.bitti ? secenek('Önemli mi, acil mi?', () => matrisSayfasi([g.id]), g.kadran ? KADRAN[g.kadran].kisa : null) : null,
      secenek(g.bas ? 'Saati değiştir' : 'Saate koy', () => yerlestirSayfasi({ tur: 'gorev', g }), g.bas ? `${g.bas}–${g.bit}` : null),
      g.bas ? secenek('Saati kaldır', () => { sayfaKapat(); duzenle(g, { bas: null, bit: null }); }) : null,
      g.gun !== b ? secenek('Bugüne al', () => { sayfaKapat(); tasi(g, b); }) : null,
      g.gun !== yarin ? secenek('Yarına at', () => { sayfaKapat(); tasi(g, yarin); }) : null,
      secenek('Başka güne…', () => gunSecSayfasi(g)),
      secenek('Düzenle', () => duzenleSayfasi(g)),
      crmAdres ? bag('CRM’de aç', crmAdres) : null,
      secenek('Sil', () => { sayfaKapat(); sil(g); }, null, 'tehlike'),
      secenek('Vazgeç', sayfaKapat, null, 'sade'));
  }

  function crmSayfasi(i) {
    const TUR = { takip: 'Müşteri takibi', dogrula: 'Doğrulaman bekleniyor', is: 'Sana verilen görev', oneri: 'Sana önerilen görev' };
    const ek = [TUR[i.tur], i.proje, i.gecikti ? 'gecikti' : null].filter(Boolean).join(' · ');
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: i.baslik }),
      el('p', { class: 'sayfa-soru', text: ek }),
      secenek('Bugüne al', () => crmAl(i, {})),
      secenek('Bugünün 3’üne koy', () => crmAl(i, { ust: true })),
      secenek('Saate koy', () => yerlestirSayfasi({ tur: 'crm', i }), i.dk ? `${i.dk} dk` : null),
      i.adres ? bag('CRM’de aç', i.adres) : null,
      secenek('Vazgeç', sayfaKapat, null, 'sade'));
  }

  function toplantiSayfasi(t, b, e) {
    const k = t.kisi || {};
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: toplantiAdi(t) }),
      el('p', { class: 'sayfa-soru', text: [`${saatDk(b)}–${saatDk(e)}`, t.kaynak === 'randevu' ? 'Karttan randevu' : null, k.firma].filter(Boolean).join(' · ') }),
      t.meet ? bag('Meet’e katıl', t.meet) : null,
      t.crmAdres ? bag('CRM kartını aç', t.crmAdres) : null,
      bag('Toplantılar ekranında aç', '/toplanti/'),
      secenek('Vazgeç', sayfaKapat, null, 'sade'));
  }

  function gunSecSayfasi(g) {
    const bas = haftaBasi(bugun());
    const izgara = (ilk) => {
      const z = el('div', { class: 'gun-izgara' });
      for (let i = 0; i < 7; i++) {
        const gun = gunEkle(ilk, i);
        const d = tarih(gun);
        z.append(el('button', {
          type: 'button', class: gun === bugun() ? 'bugun' : null, 'aria-current': gun === g.gun ? 'true' : null,
          'aria-label': gunBasligi(gun), onclick: () => { sayfaKapat(); tasi(g, gun); }
        }, GUN_KISA[d.getDay()], el('b', { text: String(d.getDate()) })));
      }
      return z;
    };
    sayfaAc(el('p', { class: 'sayfa-baslik', text: g.baslik }),
      el('p', { class: 'ara-baslik', text: 'Bu hafta' }), izgara(bas),
      el('p', { class: 'ara-baslik', text: 'Gelecek hafta' }), izgara(gunEkle(bas, 7)),
      secenek('Vazgeç', sayfaKapat, null, 'sade'));
  }

  function duzenleSayfasi(g) {
    const isaret = crmIsareti(g);
    const baslik = el('input', { id: 'd-baslik', type: 'text', maxlength: '300', value: g.baslik, required: true });
    const not = el('textarea', { id: 'd-not', maxlength: '3900', placeholder: 'Not…' });
    not.value = notGoster(g.not);
    const form = el('form', { class: 'duzen' },
      el('label', { for: 'd-baslik', text: 'Başlık' }), baslik,
      el('label', { for: 'd-not', text: 'Not' }), not,
      el('button', { class: 'birincil', type: 'submit' }, 'Kaydet'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const b = baslik.value.trim();
      if (!b) return baslik.focus();
      sayfaKapat();
      const n = not.value.trim();
      duzenle(g, { baslik: b, not: isaret ? `${n}${n ? ' ' : ''}⟨crm:${isaret}⟩` : n });
    });
    sayfaAc(form, secenek('Vazgeç', sayfaKapat, null, 'sade'));
  }

  function kapanisSayfasi() {
    const maddeler = ['Bugünün listesine son kez baktım', 'Kalanları yarına ya da başka güne attım', 'Yarının 3’ünü ve saatlerini çizdim'];
    const kutular = maddeler.map((m, i) => el('input', { type: 'checkbox', id: 'k-' + i }));
    const tamam = el('button', { class: 'birincil', type: 'button', disabled: true, style: 'width:100%' }, 'Kapanış tamam');
    kutular.forEach((k) => k.addEventListener('change', () => { tamam.disabled = !kutular.every((x) => x.checked); }));
    tamam.addEventListener('click', async () => {
      sayfaKapat();
      const gun = D.secili;
      D.kapanislar.push(gun);
      ciz();
      const r = await islem({ islem: 'kapanis', gun });
      if (!r.ok) { D.kapanislar = D.kapanislar.filter((x) => x !== gun); ciz(); return hataBildir(r); }
      bildir('Gün kapandı. İş bitti, kafa boş.');
    });
    const acikSayi = gunGorevleri(D.secili).filter((g) => !g.bitti).length;
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: 'Günü kapat' }),
      acikSayi ? secenek(`Açık ${acikSayi} işi yarına at`, async () => {
        const yarin = gunEkle(D.secili, 1);
        for (const g of gunGorevleri(D.secili).filter((x) => !x.bitti)) await tasi(g, yarin);
        kapanisSayfasi();
      }) : null,
      el('div', { class: 'kontrol' }, maddeler.map((m, i) => el('label', { for: 'k-' + i }, kutular[i], el('span', { text: m })))),
      tamam, secenek('Vazgeç', sayfaKapat, null, 'sade'));
  }

  function hedefSayfasi() {
    const girdi = el('input', { id: 'h-saat', type: 'number', min: '0', max: '80', step: '1', inputmode: 'numeric', value: String(D.ayarlar.haftalikDerinHedef) });
    const form = el('form', { class: 'duzen' },
      el('label', { for: 'h-saat', text: 'Haftalık derin iş hedefi (saat)' }), girdi,
      el('p', { class: 'aciklama', text: 'Yalnız Odaklan ile geçen süre sayılır.' }),
      el('button', { class: 'birincil', type: 'submit' }, 'Kaydet'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saat = Math.max(0, Math.min(80, Math.round(Number(girdi.value))));
      sayfaKapat();
      const eski = D.ayarlar.haftalikDerinHedef;
      D.ayarlar.haftalikDerinHedef = saat;
      ciz();
      const r = await islem({ islem: 'hedef', saat });
      if (!r.ok) { D.ayarlar.haftalikDerinHedef = eski; ciz(); hataBildir(r); }
    });
    sayfaAc(form, secenek('Vazgeç', sayfaKapat, null, 'sade'));
  }

  function menuAc() {
    const crm = crmKoku();
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: 'DeepCore' }),
      secenek('Yenile', async () => { sayfaKapat(); await Promise.all([senkron(true), disYukle()]); bildir('Güncel'); }),
      bag('Toplantılar', '/toplanti/', 'takvim'),
      crm ? bag('Nexus CRM', crm + '/merkez/benim', 'işlerim') : null,
      bag('Dijital kart', '/', 'randevu linki'),
      secenek('iPhone kestirmeleri', kestirmeSayfasi, 'sesle ekle · Instagram engeli'),
      secenek('Haftalık derin hedef', hedefSayfasi, `${D.ayarlar.haftalikDerinHedef} sa`),
      secenek('Yedeği indir', () => { sayfaKapat(); yedekIndir(); }, 'JSON'),
      secenek('Çıkış yap', async () => { sayfaKapat(); await silmeyiGonder(); await istek('/cikis', {}); girisGoster('Çıkış yapıldı.'); }, null, 'tehlike'),
      secenek('Kapat', sayfaKapat, null, 'sade'));
  }

  /** iPhone Kestirmeler kurulumu: adres ve anahtar tek dokunuşla kopyalanır, adımlar altında. */
  async function kestirmeSayfasi() {
    sayfaKapat();
    const r = await istek('/kestirme');
    if (!r.ok) return hataBildir(r);
    if (!r.v.anahtar) {
      return sayfaAc(el('p', { class: 'sayfa-baslik', text: 'iPhone kestirmeleri' }),
        el('p', { class: 'sayfa-soru', text: 'Sunucuda KAFA_ANAHTAR tanımlı değil.' }), secenek('Kapat', sayfaKapat, null, 'sade'));
    }
    const kok = location.origin;
    const kopya = (ad, deger) => secenek(ad, async () => {
      try { await navigator.clipboard.writeText(deger); bildir('Kopyalandı'); }
      catch { prompt('Kopyala:', deger); }
    }, 'Kopyala');
    const adimlar = (...m) => el('ol', { class: 'adimlar' }, m.map((x) => el('li', { text: x })));
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: 'iPhone kestirmeleri' }),
      el('p', { class: 'sayfa-soru', text: 'Kestirmeler uygulamasında bir kez kur. Kopyala, oraya yapıştır.' }),

      el('p', { class: 'ara-baslik', text: '1 · Kafama at (sesle iş ekle)' }),
      kopya('Adres', kok + '/api/plan/kafa'),
      kopya('Anahtar', 'Bearer ' + r.v.anahtar),
      adimlar(
        'Kestirmeler → + → “Metni Dikte Et” ekle.',
        '“URL’nin İçeriğini Al” ekle → adresi yapıştır → Yöntem: POST.',
        'Başlıklar → yeni başlık: Anahtar “Authorization”, Değer: kopyaladığın anahtar.',
        'İstek Gövdesi: JSON → yeni alan “metin” → değer: Dikte Edilen Metin.',
        'Adını “Kafama at” yap → Ana Ekrana Ekle.'),

      el('p', { class: 'ara-baslik', text: '2 · Odakta Instagram engeli' }),
      kopya('Adres', kok + '/api/plan/odak'),
      kopya('Anahtar', 'Bearer ' + r.v.anahtar),
      kopya('Plan adresi', kok + '/plan/'),
      adimlar(
        'Kestirmeler → Otomasyon → + → Uygulama → Instagram → Açıldığında → Hemen Çalıştır.',
        '“URL’nin İçeriğini Al” ekle → adresi yapıştır → Başlıklar: “Authorization” = anahtar.',
        '“Eğer” ekle → URL’nin İçeriği · şudur · evet',
        'Eğer’in içine “URL’leri Aç” ekle → plan adresini yapıştır. Bitti.'),
      secenek('Kapat', sayfaKapat, null, 'sade'));
  }

  function yedekIndir() {
    const veri = JSON.stringify({ indirildi: new Date().toISOString(), haftalar: D.haftalar, gorevler: D.gorevler, seanslar: D.seanslar, kapanislar: D.kapanislar }, null, 2);
    const url = URL.createObjectURL(new Blob([veri], { type: 'application/json' }));
    const a = el('a', { href: url, download: `deepcore-plan-${bugun()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ======================= bildirim ======================= */

  const bildirimKutusu = el('div', { class: 'bildirim', role: 'status', 'aria-live': 'polite' });
  document.body.append(bildirimKutusu);
  let bildirimZamani = null;

  function bildir(metin, dugme, is, sure = 2400) {
    clearTimeout(bildirimZamani);
    bildirimKutusu.replaceChildren(...[
      el('span', { text: metin }),
      dugme ? el('button', { type: 'button', onclick: () => { is(); bildirimKutusu.classList.remove('acik'); } }, dugme) : null
    ].filter(Boolean));
    bildirimKutusu.classList.add('acik');
    bildirimZamani = setTimeout(() => bildirimKutusu.classList.remove('acik'), sure);
  }

  /* ======================= ana ekrana ekle ======================= */

  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); kurulumOlayi = e; if (senkronZamanlayici) ciz(); });

  function kurulumIpucu() {
    const bagimsiz = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (bagimsiz || depoOku('dc_ipucu') === 'gec') return null;
    const kapat = () => { depoYaz('dc_ipucu', 'gec'); ciz(); };
    if (kurulumOlayi) {
      return el('div', { class: 'serit-uyari', style: 'margin-top:18px' },
        el('p', {}, 'Ana ekrana ekle', el('small', { text: 'Uygulama gibi tek dokunuşla açılır.' })),
        el('button', { type: 'button', onclick: async () => { kurulumOlayi.prompt(); await kurulumOlayi.userChoice.catch(() => null); kurulumOlayi = null; kapat(); } }, 'Ekle'));
    }
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) return null;
    return el('div', { class: 'serit-uyari', style: 'margin-top:18px' },
      el('p', {}, 'Ana ekrana ekle', el('small', { text: 'Safari’de Paylaş → Ana Ekrana Ekle.' })),
      el('button', { type: 'button', onclick: kapat }, 'Tamam'));
  }

  /* ======================= giriş ve durum ekranları ======================= */

  function girisGoster(mesaj) {
    senkronDurdur();
    sayfaKapat();
    clearTimeout(bildirimZamani);
    bildirimKutusu.classList.remove('acik');
    bildirimKutusu.replaceChildren();
    if (ekleCubugu) { ekleCubugu.remove(); ekleCubugu = null; }
    const kullanici = el('input', { type: 'text', name: 'kullanici', autocomplete: 'username', value: 'deepcore', readonly: true, tabindex: '-1', class: 'gorunmez', 'aria-hidden': 'true' });
    const sifre = el('input', { type: 'password', name: 'sifre', autocomplete: 'current-password', required: true, enterkeyhint: 'go', 'aria-label': 'Şifre', placeholder: 'Şifre' });
    const hata = el('p', { class: 'hata', role: 'alert' });
    const dugme = el('button', { class: 'birincil', type: 'submit' }, 'Giriş');
    const form = el('form', { autocomplete: 'on' },
      el('h1', { text: 'DeepCore' }),
      el('p', { text: mesaj || 'Şifreni yaz. Bu cihaz 6 ay hatırlar.' }),
      kullanici, sifre, hata, dugme);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sifre.value) return sifre.focus();
      dugme.disabled = true;
      hata.textContent = '';
      const r = await istek('/giris', { sifre: sifre.value });
      dugme.disabled = false;
      if (r.ok) { sifre.value = ''; return baslat(); }
      if (r.durum === 429) hata.textContent = `Çok fazla yanlış deneme. ${r.v.dakika || 15} dakika sonra tekrar dene.`;
      else if (r.durum === 401) hata.textContent = 'Şifre yanlış.';
      else if (r.durum === 503) hata.textContent = 'Plan sunucuda henüz kurulmadı.';
      else hata.textContent = 'Bağlantı kurulamadı. Tekrar dene.';
      sifre.select();
    });
    kok.setAttribute('aria-busy', 'false');
    kok.replaceChildren(el('section', { class: 'giris' }, form));
    sifre.focus();
  }

  function durumEkrani(baslik, ...aciklama) {
    senkronDurdur();
    kok.setAttribute('aria-busy', 'false');
    kok.replaceChildren(el('section', { class: 'giris' },
      el('div', { class: 'durum-ekrani' }, el('h1', { text: baslik }), el('p', {}, ...aciklama),
        el('button', { class: 'birincil', type: 'button', onclick: baslat }, 'Tekrar dene'))));
  }

  /* ======================= eşitleme ======================= */

  async function senkron(zorla) {
    if (!zorla && (bekleyenIslem || D.bekleyenSil || document.hidden || acikSayfa || odakEkrani)) return;
    if (!zorla && Date.now() - disZamani > 5 * 60e3) disYukle();
    const r = await istek('');
    if (!r.ok) return;
    if (!zorla && r.v.guncellendi && r.v.guncellendi === D.guncellendi) {
      if (D.secili === bugun()) ciz();                 // "Şimdi" kartı ve şimdi çizgisi saatle değişir
      return;
    }
    if (!zorla && (bekleyenIslem || D.bekleyenSil)) return;
    veriAl(r.v);
    ciz();
  }

  function senkronBaslat() { senkronDurdur(); senkronZamanlayici = setInterval(() => senkron(false), 60e3); }
  function senkronDurdur() { clearInterval(senkronZamanlayici); senkronZamanlayici = null; }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) silmeyiGonder(true);
    else {
      if (odakEkrani) ekranAcikKalsin();
      if (senkronZamanlayici) { senkron(false); if (Date.now() - disZamani > 60e3) disYukle(); }
    }
  });
  addEventListener('pagehide', () => silmeyiGonder(true));

  let sonBugun = bugun();
  setInterval(() => {
    const b = bugun();
    if (b !== sonBugun) { if (D.secili === sonBugun) D.secili = b; sonBugun = b; if (senkronZamanlayici && !odakEkrani) { ciz(); disYukle(); } }
  }, 30e3);

  /* ======================= jestler ======================= */

  let dokunma = null;
  kok.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { dokunma = null; return; }
    dokunma = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  kok.addEventListener('touchend', (e) => {
    if (!dokunma || !senkronZamanlayici) return;
    const dx = e.changedTouches[0].clientX - dokunma.x;
    const dy = e.changedTouches[0].clientY - dokunma.y;
    const hizli = Date.now() - dokunma.t < 600;
    dokunma = null;
    if (hizli && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) gunSec(gunEkle(D.secili, dx < 0 ? 1 : -1));
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (!senkronZamanlayici || acikSayfa || odakEkrani || e.altKey || e.ctrlKey || e.metaKey) return;
    const h = e.target;
    if (h && (h.tagName === 'INPUT' || h.tagName === 'TEXTAREA' || h.isContentEditable)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); gunSec(gunEkle(D.secili, -1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); gunSec(gunEkle(D.secili, 1)); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); ekleGirdi?.focus(); }
  });

  /* ======================= başlat ======================= */

  async function baslat() {
    kok.setAttribute('aria-busy', 'true');
    const r = await istek('');
    if (r.ok) {
      veriAl(r.v);
      ciz();
      senkronBaslat();
      disYukle();
      let o = acikOdak();
      if (!o && D.odak) {                              // odak başka yerde (ana ekran uygulaması) başladı
        const bas = Date.parse(D.odak.bas), bitis = Date.parse(D.odak.bitis);
        o = { baslangic: bas, hedefDk: Math.max(5, Math.round((bitis - bas) / 60e3) - 30), baslik: D.odak.baslik, gorevId: null, gun: bugun() };
        depoYaz('dc_odak', JSON.stringify(o));
      }
      if (o) odakGoster(o);                            // yarım kalan odak seansı geri gelir
      return;
    }
    if (r.durum === 401) return;
    if (r.durum === 503 && r.v.sebep === 'kurulmadi') {
      return durumEkrani('Kurulmadı', 'Sunucuda ', el('code', { text: 'PLAN_SIFRE' }), ' tanımlı değil.');
    }
    if (r.durum === 503 && r.v.sebep === 'depolama') {
      return durumEkrani('Kayıt yapılamıyor', 'Sunucu veri klasörüne yazamıyor. Coolify → Storages → ', el('code', { text: '/app/veri' }), ' birimini kontrol et.');
    }
    return durumEkrani('Bağlanılamadı', 'İnternet bağlantını kontrol et.');
  }

  baslat();
})();
