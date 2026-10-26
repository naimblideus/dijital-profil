/* DeepCore — naim.nextusservis.com/plan
   TEK EKRAN: saati olan görev = zaman bloğu. Tepede "Şimdi" kartı ve tek Odaklan düğmesi.
   Veri ASLA innerHTML'e girmez; her dokunuş anında görünür, sunucu reddederse geri alınır. */
'use strict';

(() => {
  /* ======================= yardımcılar ======================= */

  const GUN_UZUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const GUN_KISA = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'];
  const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

  const ALANLAR = [
    { ad: 'Servis', renk: '#4BA3E3', es: ['nexus servis', 'nextus servis', 'servis', 'srv'] },
    { ad: 'Saha', renk: '#4DB37E', es: ['büyüme', 'buyume', 'görüşme', 'gorusme', 'saha'] },
    { ad: 'Kod', renk: '#97A3B8', es: ['deploy', 'kod', 'maker'] },
    { ad: 'Kredi', renk: '#E26A7C', es: ['otoprime', 'op', 'kredi', 'nextus kredi'] },
    { ad: 'Ekip', renk: '#E8964A', es: ['ekip', 'eğitim', 'egitim', 'ik', 'hat'] },
    { ad: 'Kişisel', renk: '#D27BB0', es: ['kişisel', 'kisisel', 'spor', 'disiplin'] },
    { ad: 'AI', renk: '#D4AE3C', es: ['ai', 'yz'] },
    { ad: 'Dekor', renk: '#C88A4A', es: ['dekor', 'nextus dekor'] },
    { ad: 'Reçete', renk: '#9B82E0', es: ['reçete', 'recete', 'nextus reçete', 'nextus recete'] },
    { ad: 'Frigora', renk: '#4BC0CF', es: ['frigora', 'soğutma', 'sogutma'] },
    { ad: 'Nextus', renk: '#8890E6', es: ['nexus', 'nextus', 'nx'] }
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
  function goreceli(iso) {
    const f = gunFarki(bugun(), iso);
    return f === 0 ? 'Bugün' : f === 1 ? 'Yarın' : f === -1 ? 'Dün' : '';
  }
  const GECERLI_GUN = /^\d{4}-\d{2}-\d{2}$/;
  const SAAT = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
  function dkSaat(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
  function suAnDk() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function sureYaz(dk) {
    const h = Math.floor(dk / 60), m = Math.round(dk % 60);
    return h ? (m ? `${h} sa ${m} dk` : `${h} sa`) : `${m} dk`;
  }

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
    secili: bugun(), acikNotlar: new Set(), bekleyenSil: null
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

  function kalanlar() {
    const b = bugun();
    const sinir = gunEkle(b, -14);
    return D.gorevler.filter((g) => !g.bitti && !g.gecici && g.gun < b && g.gun >= sinir);
  }

  function gunDurumu(gun) {
    const l = D.gorevler.filter((g) => g.gun === gun);
    if (!l.length) return 'bos';
    const biten = l.filter((g) => g.bitti).length;
    return biten === l.length ? 'tamam' : biten ? 'yarim' : 'var';
  }

  function haftaNotu(gun) { return D.haftalar.filter((h) => h.bas <= gun && gun <= h.son).pop() || null; }

  function derinDk(gunler) {
    const k = new Set(gunler);
    return D.seanslar.filter((s) => s.derin !== false && k.has(s.gun)).reduce((t, s) => t + s.dk, 0);
  }

  /** Şimdi ne yapmalıyım? Saati şu ana düşen → sıradaki saatli → ilk saatsiz. */
  function simdikiIs() {
    const l = gunGorevleri(bugun()).filter((g) => !g.bitti && !g.gecici);
    const an = suAnDk();
    const icinde = l.find((g) => g.bas && dkSaat(g.bas) <= an && an < dkSaat(g.bit));
    if (icinde) return { g: icinde, tur: 'simdi' };
    const sonraki = l.find((g) => g.bas && dkSaat(g.bas) > an);
    const saatsiz = l.find((g) => !g.bas);
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

  /* ======================= çizim ======================= */

  let ekleCubugu = null, ekleGirdi = null, ekleDugme = null;

  function ciz() {
    kok.setAttribute('aria-busy', 'false');
    const secili = D.secili;
    const bugunMu = secili === bugun();
    const liste = gunGorevleri(secili);
    const biten = liste.filter((g) => g.bitti).length;
    const p = [];

    // üst
    p.push(el('header', { class: 'ust' },
      el('div', { class: 'ust-sol' },
        el('p', { class: 'goz', text: goreceli(secili) }),
        el('h1', { class: 'gun-baslik', text: gunBasligi(secili) })),
      el('div', { class: 'ust-dugmeler' },
        !bugunMu ? el('button', { class: 'bugune', type: 'button', onclick: () => gunSec(bugun()) }, 'Bugün') : null,
        el('button', { class: 'ikon-dugme', type: 'button', 'aria-label': 'Menü', onclick: menuAc }, ikon('menu')))));

    // tek satır skor: kaç iş bitti + derin saat (Newport skorbordu)
    const hafta = Array.from({ length: 7 }, (_, i) => gunEkle(haftaBasi(secili), i));
    const haftaDk = derinDk(hafta);
    const hedefDk = (D.ayarlar.haftalikDerinHedef || 0) * 60;
    const dolgu = el('i');
    dolgu.style.transform = `scaleX(${hedefDk ? Math.min(1, haftaDk / hedefDk) : 0})`;
    p.push(el('button', { class: 'skor', type: 'button', onclick: hedefSayfasi, 'aria-label': 'Haftalık derin iş hedefi' },
      el('span', { class: 'skor-satir' },
        el('span', {}, el('b', { text: String(biten) }), ` / ${liste.length} iş`),
        el('span', {}, 'Derin ', el('b', { text: sureYaz(derinDk([secili])) })),
        el('span', { class: 'hafta-saat' }, 'Hafta ', el('b', { text: (haftaDk / 60).toFixed(1).replace('.', ',') }), ` / ${D.ayarlar.haftalikDerinHedef} sa`)),
      el('span', { class: 'cubuk' }, dolgu)));

    // hafta şeridi
    const bas = haftaBasi(secili);
    const serit = el('nav', { class: 'serit', 'aria-label': 'Hafta' },
      el('button', { class: 'ok', type: 'button', 'aria-label': 'Önceki hafta', onclick: () => gunSec(gunEkle(secili, -7)) }, ikon('sol')));
    for (let i = 0; i < 7; i++) {
      const gun = gunEkle(bas, i);
      const d = tarih(gun);
      serit.append(el('button', {
        class: 'gun' + (gun === bugun() ? ' bugun' : ''), type: 'button',
        'data-gun': gun, 'data-durum': gunDurumu(gun),
        'aria-pressed': String(gun === secili), 'aria-current': gun === bugun() ? 'date' : null,
        'aria-label': gunBasligi(gun), onclick: () => gunSec(gun)
      }, el('span', { class: 'k', text: GUN_KISA[d.getDay()] }), el('span', { class: 'n', text: String(d.getDate()) }), el('span', { class: 'nokta' })));
    }
    serit.append(el('button', { class: 'ok', type: 'button', 'aria-label': 'Sonraki hafta', onclick: () => gunSec(gunEkle(secili, 7)) }, ikon('sag')));
    p.push(serit);

    // uyarılar
    if (!D.kalici) {
      p.push(el('div', { class: 'serit-uyari', role: 'status' },
        el('p', {}, 'Veriler kalıcı değil', el('small', { text: 'Sunucu yeniden kurulunca silinir. Coolify → Storages → /app/veri birimini ekle.' }))));
    }
    if (D.uyari) p.push(el('div', { class: 'serit-uyari', role: 'status' }, el('p', {}, D.uyari)));

    // ŞİMDİ kartı — tek düğme
    if (bugunMu && !acikOdak()) {
      const s = simdikiIs();
      if (s) {
        const g = s.g;
        const etiket = { simdi: 'Şimdi', sonraki: 'Sıradaki', saatsiz: 'Sıradaki iş', kacti: 'Saati geçti' }[s.tur];
        const zaman = g.bas ? `${g.bas}–${g.bit}` : (g.dk ? sureYaz(g.dk) : '');
        p.push(el('section', { class: 'simdi' + (s.tur === 'simdi' ? ' canli' : '') },
          el('p', { class: 'simdi-etiket' }, etiket, zaman ? el('span', { text: zaman }) : null),
          el('p', { class: 'simdi-baslik', text: g.baslik }),
          el('div', { class: 'simdi-dugmeler' },
            el('button', { class: 'odaklan', type: 'button', onclick: () => odakBaslat(g) }, ikon('oynat'), 'Odaklan'),
            el('button', { class: 'ikincil-dugme', type: 'button', onclick: () => isaretle(g) }, 'Bitti'))));
      } else if (liste.length) {
        p.push(el('section', { class: 'simdi bitti-kart' },
          el('p', { class: 'simdi-baslik', text: 'Bugünün işi bitti.' }),
          !D.kapanislar.includes(secili) ? el('p', { class: 'simdi-alt', text: 'Kapanışı yap, yarını çiz.' }) : null));
      }
    }

    // geçmişten kalan
    if (bugunMu) {
      const k = kalanlar();
      if (k.length) {
        const enEski = k.reduce((m, g) => (g.gun < m ? g.gun : m), k[0].gun);
        p.push(el('div', { class: 'serit-uyari kalan' },
          el('p', {}, `Geçmişten kalan ${k.length} görev`, el('small', { text: 'Yapılanları işaretle, kalanı bugüne al.' })),
          el('div', { class: 'dugmeler' },
            el('button', { type: 'button', class: 'ikincil', onclick: () => gunSec(enEski) }, 'Gözden geçir'),
            el('button', { type: 'button', onclick: kalanlariAl }, 'Hepsini bugüne al'))));
      }
    }

    // gün: tek liste (saatliler saat sütunuyla)
    if (liste.length) {
      const sm = bugunMu ? simdikiIs() : null;
      p.push(el('section', { class: 'liste', 'aria-label': 'Günün işleri' }, liste.map((g) => satir(g, sm && sm.tur === 'simdi' && sm.g === g))));
    } else {
      p.push(el('section', { class: 'liste' },
        el('div', { class: 'bos' },
          el('strong', { text: bugunMu ? 'Bugün boş' : 'Bu gün boş' }),
          'Aşağıya yaz. Saat de yazarsan bloğa girer:', el('br'), el('code', { text: '14:00-15:30 Teklif yaz' }))));
    }

    // kapanış ritüeli
    if (gunFarki(bugun(), secili) <= 0 && liste.length) {
      p.push(D.kapanislar.includes(secili)
        ? el('p', { class: 'kapandi' }, el('span', { class: 'kapandi-tik' }, ikon('tik')), 'Kapanış tamam')
        : el('button', { class: 'gunu-kapat', type: 'button', onclick: kapanisSayfasi }, 'Günü kapat'));
    }

    // haftanın notu (en altta, kapalı)
    const h = haftaNotu(secili);
    if (h && h.not) {
      const kutu = el('details', { class: 'hafta-notu' }, el('summary', {}, el('span', { text: h.baslik || 'Haftanın notu' })), el('p', { class: 'govde', text: h.not }));
      p.push(kutu);
    }

    const ipucu = kurulumIpucu();
    if (ipucu) p.push(ipucu);

    kok.replaceChildren(...p);
    ekleCubuguKur();
  }

  function satir(g, canli) {
    const alan = alanBul(g.alan);
    const acik = D.acikNotlar.has(g.id);
    const bilgi = el('span', { class: 'bilgi' });
    if (alan) {
      const a = el('span', { class: 'alan', text: alan.ad });
      if (alan.renk) a.style.setProperty('--renk', alan.renk);
      bilgi.append(a);
    }
    if (g.dk && !g.bas) bilgi.append(el('span', { class: 'dk', text: `${g.dk} dk` }));
    if (g.not && !acik) bilgi.append(el('span', { class: 'not-var', text: 'not' }));

    const metin = el('button', {
      class: 'metin', type: 'button', 'aria-expanded': g.not ? String(acik) : null, disabled: g.gecici || null,
      onclick: () => {
        if (!g.not) return gorevSayfasi(g);
        if (D.acikNotlar.has(g.id)) D.acikNotlar.delete(g.id); else D.acikNotlar.add(g.id);
        ciz();
      }
    }, el('span', { class: 'baslik', text: g.baslik }), bilgi.childNodes.length ? bilgi : null,
    acik && g.not ? el('span', { class: 'not', text: g.not }) : null);

    return el('div', {
      class: 'gorev' + (g.bitti ? ' bitti' : '') + (g.gecici ? ' gecici' : '') + (g.bas ? ' saatli' : '') + (canli ? ' canli' : ''),
      'data-id': g.id
    },
    el('button', {
      class: 'tik', type: 'button', 'aria-pressed': String(Boolean(g.bitti)),
      'aria-label': (g.bitti ? 'Geri al: ' : 'Bitti: ') + g.baslik, disabled: g.gecici || null, onclick: () => isaretle(g)
    }, el('i', {}, ikon('tik'))),
    g.bas ? el('span', { class: 'saat' }, el('b', { text: g.bas }), el('span', { text: g.bit })) : null,
    metin,
    el('button', { class: 'daha', type: 'button', 'aria-label': 'Seçenekler: ' + g.baslik, disabled: g.gecici || null, onclick: () => gorevSayfasi(g) }, ikon('daha')));
  }

  function ekleCubuguKur() {
    if (ekleCubugu && document.body.contains(ekleCubugu)) {
      ekleGirdi.placeholder = D.secili === bugun() ? 'Ekle · ör. 14:00-15:00 Teklif' : `${gunBasligi(D.secili)} — ekle…`;
      return;
    }
    ekleGirdi = el('input', { type: 'text', name: 'gorev', autocomplete: 'off', enterkeyhint: 'done', maxlength: '600', 'aria-label': 'Yeni görev' });
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
    else D.guncellendi = null;
  }

  async function ekle(metin) {
    const m = String(metin).trim();
    if (!m) return;
    const parca = satirAyir(m);
    if (!parca.baslik) return bildir('Başlık boş olamaz');
    const gun = D.secili;
    const gecici = { id: 'gecici-' + (++geciciSayac), gun, sira: 1e9, ...parca, bitti: false, gecici: true };
    D.gorevler.push(gecici);
    ciz();
    const r = await islem({ islem: 'ekle', gun, metin: m });
    D.gorevler = D.gorevler.filter((x) => x !== gecici);
    if (r.ok && r.v.gorev) {
      D.gorevler.push(r.v.gorev);
      D.guncellendi = null;
      ciz();
      if (r.v.gorev.bas) bildir(`${r.v.gorev.bas}–${r.v.gorev.bit} bloğuna eklendi`);
    } else {
      ciz();
      if (ekleGirdi && !ekleGirdi.value) { ekleGirdi.value = m; ekleDugme.disabled = false; }
      hataBildir(r);
    }
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
    bildir(`${liste.length} görev bugüne alındı`);
  }

  async function duzenle(g, degisiklik) {
    const eski = { baslik: g.baslik, not: g.not, bas: g.bas, bit: g.bit };
    Object.assign(g, degisiklik);
    ciz();
    const r = await islem({ islem: 'duzenle', id: g.id, ...degisiklik });
    if (!r.ok) { Object.assign(g, eski); ciz(); hataBildir(r); }
    else { Object.assign(g, r.v.gorev); D.guncellendi = null; }
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
          el('button', { class: 'secenek sade', type: 'button', onclick: () => odakBitir(true) }, 'Dağıldım, bırak'))));
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
    return el('button', { class: 'secenek' + (sinif ? ' ' + sinif : ''), type: 'button', onclick: is }, metin, ek ? el('small', { text: ek }) : null);
  }

  function gorevSayfasi(g) {
    if (g.gecici) return;
    const b = bugun();
    const yarin = gunEkle(b, 1);
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: g.baslik }),
      !g.bitti ? secenek('Odaklan', () => odakBaslat(g), g.bas ? `${g.bas}–${g.bit}` : (g.dk ? `${g.dk} dk` : '50 dk')) : null,
      g.gun !== b ? secenek('Bugüne al', () => { sayfaKapat(); tasi(g, b); }) : null,
      g.gun !== yarin ? secenek('Yarına at', () => { sayfaKapat(); tasi(g, yarin); }) : null,
      secenek('Başka güne…', () => gunSecSayfasi(g)),
      secenek('Düzenle', () => duzenleSayfasi(g), g.bas ? 'saat, başlık, not' : 'saat ver, başlık, not'),
      secenek('Sil', () => { sayfaKapat(); sil(g); }, null, 'tehlike'),
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
    const baslik = el('input', { id: 'd-baslik', type: 'text', maxlength: '300', value: g.baslik, required: true });
    const bas = el('input', { id: 'd-bas', type: 'time', step: '300', value: g.bas || '' });
    const bit = el('input', { id: 'd-bit', type: 'time', step: '300', value: g.bit && g.bit !== '24:00' ? g.bit : (g.bit ? '23:59' : '') });
    const not = el('textarea', { id: 'd-not', maxlength: '4000', placeholder: 'Not…' });
    not.value = g.not || '';
    const hata = el('p', { class: 'hata', role: 'alert' });
    const form = el('form', { class: 'duzen' },
      el('label', { for: 'd-baslik', text: 'Başlık' }), baslik,
      el('label', { for: 'd-bas', text: 'Saat (boş bırakırsan saatsiz)' }),
      el('div', { class: 'saat-satir' }, bas, el('span', { text: '–' }), bit),
      el('label', { for: 'd-not', text: 'Not' }), not, hata,
      el('button', { class: 'birincil', type: 'submit' }, 'Kaydet'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const b = baslik.value.trim();
      if (!b) return baslik.focus();
      let s1 = bas.value || null, s2 = bit.value || null;
      if (s2 === '23:59') s2 = '24:00';
      if (Boolean(s1) !== Boolean(s2)) { hata.textContent = 'Başlangıç ve bitişi birlikte yaz ya da ikisini de boş bırak.'; return; }
      if (s1 && s2 <= s1) { hata.textContent = 'Bitiş başlangıçtan sonra olmalı.'; return; }
      sayfaKapat();
      duzenle(g, { baslik: b, not: not.value.trim(), bas: s1, bit: s2 });
    });
    sayfaAc(form, secenek('Vazgeç', sayfaKapat, null, 'sade'));
  }

  function kapanisSayfasi() {
    const maddeler = ['Bugünün listesine son kez baktım', 'Kalanları yarına ya da başka güne attım', 'Yarının saatlerini çizdim'];
    const kutular = maddeler.map((m, i) => el('input', { type: 'checkbox', id: 'k-' + i }));
    const tamam = el('button', { class: 'birincil', type: 'button', disabled: true }, 'Kapanış tamam');
    kutular.forEach((k) => k.addEventListener('change', () => { tamam.disabled = !kutular.every((x) => x.checked); }));
    tamam.addEventListener('click', async () => {
      sayfaKapat();
      const gun = D.secili;
      D.kapanislar.push(gun);
      ciz();
      const r = await islem({ islem: 'kapanis', gun });
      if (!r.ok) { D.kapanislar = D.kapanislar.filter((x) => x !== gun); ciz(); return hataBildir(r); }
      bildir('Kapanış tamam. İş bitti, kafa boş.');
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
      el('p', { class: 'aciklama', text: 'Yalnız Odaklan ile geçen süre sayılır. Newport: tek ölçü derin saat.' }),
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
    sayfaAc(
      el('p', { class: 'sayfa-baslik', text: 'DeepCore' }),
      secenek('Yenile', async () => { sayfaKapat(); await senkron(true); bildir('Güncel'); }),
      secenek('Haftalık derin hedef', hedefSayfasi, `${D.ayarlar.haftalikDerinHedef} sa`),
      secenek('Yedeği indir', () => { sayfaKapat(); yedekIndir(); }, 'JSON'),
      secenek('Çıkış yap', async () => { sayfaKapat(); await silmeyiGonder(); await istek('/cikis', {}); girisGoster('Çıkış yapıldı.'); }, null, 'tehlike'),
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
      return el('div', { class: 'serit-uyari bilgi' },
        el('p', {}, 'Ana ekrana ekle', el('small', { text: 'Uygulama gibi tek dokunuşla açılır.' })),
        el('button', { type: 'button', onclick: async () => { kurulumOlayi.prompt(); await kurulumOlayi.userChoice.catch(() => null); kurulumOlayi = null; kapat(); } }, 'Ekle'));
    }
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) return null;
    return el('div', { class: 'serit-uyari bilgi' },
      el('p', {}, 'Ana ekrana ekle', el('small', { text: 'Safari’de Paylaş → Ana Ekrana Ekle. Uygulama gibi açılır.' })),
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
      el('p', { text: mesaj || 'Planına girmek için şifreni yaz. Bu cihaz 6 ay hatırlar.' }),
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
    const r = await istek('');
    if (!r.ok) return;
    if (!zorla && r.v.guncellendi && r.v.guncellendi === D.guncellendi) {
      if (D.secili === bugun()) ciz();                 // "Şimdi" kartı saatle değişir
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
      if (senkronZamanlayici) senkron(false);
    }
  });
  addEventListener('pagehide', () => silmeyiGonder(true));

  let sonBugun = bugun();
  setInterval(() => {
    const b = bugun();
    if (b !== sonBugun) { if (D.secili === sonBugun) D.secili = b; sonBugun = b; if (senkronZamanlayici && !odakEkrani) ciz(); }
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
      const o = acikOdak();
      if (o) odakGoster(o);                            // yarım kalan odak seansı geri gelir
      return;
    }
    if (r.durum === 401) return;
    if (r.durum === 503 && r.v.sebep === 'kurulmadi') {
      return durumEkrani('Kurulmadı', 'Sunucuda ', el('code', { text: 'PLAN_SIFRE' }), ' tanımlı değil. Coolify ortam değişkenlerine ekleyip yeniden dağıt.');
    }
    if (r.durum === 503 && r.v.sebep === 'depolama') {
      return durumEkrani('Kayıt yapılamıyor', 'Sunucu veri klasörüne yazamıyor. Coolify → Storages → ', el('code', { text: '/app/veri' }), ' birimini kontrol et.');
    }
    return durumEkrani('Bağlanılamadı', 'İnternet bağlantını kontrol et.');
  }

  baslat();
})();
