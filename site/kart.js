(function () {
  'use strict';
  var D = document;

  /* ---------- sözlük dışı metinler ---------- */
  var WA = {
    tr: 'https://wa.me/905526961703?text=' + encodeURIComponent('Merhaba Naim Bey, '),
    en: 'https://wa.me/905526961703?text=' + encodeURIComponent('Hello Mr. Çetin, ')
  };
  var HATA = {
    tr: 'Talep gönderilemedi. Lütfen tekrar deneyin ya da doğrudan arayın.',
    en: 'The request could not be sent. Please try again or call directly.'
  };
  var GONDERILIYOR = { tr: 'Gönderiliyor…', en: 'Sending…' };
  var SAAT_SEC = { tr: 'Lütfen bir saat seçin.', en: 'Please pick a time.' };
  var SLOT_DOLU = {
    tr: 'O saat az önce doldu. Başka bir saat seçin.',
    en: 'That time was just taken. Please pick another.'
  };
  var GUNLER = {
    tr: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  };
  var AYLAR = {
    tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  };
  var RANDEVU_ONAY = {
    tr: function (m) { return m + ' — görüşme takvime yazıldı.'; },
    en: function (m) { return m + ' — the meeting is booked.'; }
  };
  var RANDEVU_ALT = {
    tr: 'Görüşmeyi takvimime yazdım. E-posta verdiyseniz davet de gönderildi.',
    en: 'The meeting is on my calendar. If you gave an email, an invite has been sent.'
  };
  // Başarı ekranında görüşmenin nasıl olacağı.
  var SEKIL_ALT = {
    meet: {
      tr: 'Görüşme Google Meet’te. Saatinde aşağıdaki linke tıklamanız yeterli; e-posta verdiyseniz link davette de var.',
      en: 'The meeting is on Google Meet. Just open the link below at the time; if you gave an email, it is in the invite too.'
    },
    meetLinksiz: {
      tr: 'Görüşme Google Meet’te. Link takvim davetinde olacak; e-posta vermediyseniz arayıp linki ileteceğim.',
      en: 'The meeting is on Google Meet. The link will be in the calendar invite; if you gave no email, I will call and send it.'
    },
    telefon: {
      tr: 'Seçtiğiniz saatte sizi yazdığınız numaradan arayacağım.',
      en: 'I will call you at the number you gave, at the time you picked.'
    },
    yuzyuze: {
      tr: 'Görüşme Medipol Teknopark’taki ofisimizde: Ekinciler Cd. No: 19, Kavacık, Beykoz.',
      en: 'We meet at our office in Medipol Teknopark: Ekinciler Cd. No: 19, Kavacık, Beykoz.'
    }
  };
  // Takvim bağlı değilken talep WhatsApp mesajı olarak gider.
  var WA_GONDER = { tr: 'WhatsApp ile gönder', en: 'Send via WhatsApp' };
  var WA_GIRIS = { tr: 'Merhaba Naim Bey, görüşme talebim:', en: 'Hello Mr. Çetin, my meeting request:' };
  var WA_ETIKET = {
    tr: { ad: 'Ad Soyad', firma: 'Firma', telefon: 'Telefon', cozum: 'İlgilendiğim çözüm', sekil: 'Görüşme şekli', zaman: 'Uygun zamanım' },
    en: { ad: 'Name', firma: 'Company', telefon: 'Phone', cozum: 'Solution', sekil: 'Meeting type', zaman: 'Preferred time' }
  };
  var WA_BASLIK = { tr: 'Son adım WhatsApp’ta.', en: 'Last step is in WhatsApp.' };
  var WA_ALT = {
    tr: 'Mesaj hazır. WhatsApp’ta gönder’e bastığınızda talebiniz bana ulaşır.',
    en: 'The message is ready. Your request reaches me once you tap send in WhatsApp.'
  };

  /* ---------- dil ---------- */
  var dilBtn = { tr: D.getElementById('dil-tr'), en: D.getElementById('dil-en') };
  var cevrilecek = D.querySelectorAll('[data-tr]');
  var yerTutucular = D.querySelectorAll('[data-ph-tr]');
  var dil = 'tr';

  function dilUygula(l) {
    dil = l;
    for (var i = 0; i < cevrilecek.length; i++) {
      var t = cevrilecek[i].getAttribute('data-' + l);
      if (t !== null) cevrilecek[i].textContent = t;
    }
    for (var j = 0; j < yerTutucular.length; j++) {
      var ph = yerTutucular[j].getAttribute('data-ph-' + l);
      if (ph !== null) yerTutucular[j].setAttribute('placeholder', ph);
    }
    D.documentElement.lang = l;
    dilBtn.tr.setAttribute('aria-pressed', l === 'tr' ? 'true' : 'false');
    dilBtn.en.setAttribute('aria-pressed', l === 'en' ? 'true' : 'false');
    var wa = D.getElementById('wa'), wa2 = D.getElementById('wa-satir');
    if (wa) wa.href = WA[l];
    if (wa2) wa2.href = WA[l];
    try { localStorage.setItem('dil', l); } catch (e) {}
  }
  dilBtn.tr.addEventListener('click', function () { dilUygula('tr'); });
  dilBtn.en.addEventListener('click', function () { dilUygula('en'); });

  var kayitli = null;
  try { kayitli = localStorage.getItem('dil'); } catch (e) {}
  var otomatik = ((navigator.language || 'tr') + '').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en';
  var ilk = (kayitli === 'tr' || kayitli === 'en') ? kayitli : otomatik;
  if (ilk !== 'tr') dilUygula(ilk);

  /* ---------- kopyala + toast ---------- */
  var toast = D.getElementById('toast');
  var toastZaman = null;
  function toastGoster() {
    if (toastZaman) { clearTimeout(toastZaman); toastZaman = null; }
    toast.classList.remove('cikiyor');
    toast.hidden = false;
    toastZaman = setTimeout(function () {
      toast.classList.add('cikiyor');
      setTimeout(function () { toast.hidden = true; toast.classList.remove('cikiyor'); }, 170);
    }, 1400);
  }
  function kopyala(metin) {
    function eski() {
      var ta = D.createElement('textarea');
      ta.value = metin; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      D.body.appendChild(ta); ta.select();
      try { D.execCommand('copy'); } catch (e) {}
      D.body.removeChild(ta);
      toastGoster();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(metin).then(toastGoster, eski);
    } else { eski(); }
  }
  var kopyaBtn = D.querySelectorAll('.kopyala');
  for (var k = 0; k < kopyaBtn.length; k++) {
    kopyaBtn[k].addEventListener('click', function () { kopyala(this.getAttribute('data-kopya')); });
  }

  /* ---------- ortak alt sayfa yönetimi ---------- */
  var zemin = D.getElementById('sheet-zemin');
  var acikSheet = null;
  var sonOdak = null;

  function sheetAc(sheet, odakEl) {
    sonOdak = D.activeElement;
    acikSheet = sheet;
    zemin.hidden = false; sheet.hidden = false;
    D.body.style.overflow = 'hidden';
    (odakEl || sheet.querySelector('button, [href], input, select')).focus();
  }
  function sheetKapat() {
    if (!acikSheet) return;
    acikSheet.hidden = true; zemin.hidden = true; acikSheet = null;
    D.body.style.overflow = '';
    if (sonOdak && sonOdak.focus) sonOdak.focus();
  }
  zemin.addEventListener('click', sheetKapat);
  D.addEventListener('keydown', function (e) {
    if (!acikSheet) return;
    if (e.key === 'Escape') { sheetKapat(); return; }
    if (e.key === 'Tab') {
      var odaklanabilir = acikSheet.querySelectorAll('button:not([disabled]), [href], input:not([tabindex="-1"]), select, textarea');
      if (!odaklanabilir.length) return;
      var ilkO = odaklanabilir[0], sonO = odaklanabilir[odaklanabilir.length - 1];
      if (e.shiftKey && D.activeElement === ilkO) { e.preventDefault(); sonO.focus(); }
      else if (!e.shiftKey && D.activeElement === sonO) { e.preventDefault(); ilkO.focus(); }
    }
  });

  /* ---------- QR ---------- */
  var qrSheet = D.getElementById('qr-sheet');
  var qrAc = D.getElementById('qr-ac');
  var qrKapat = D.getElementById('qr-kapat');
  var qrKutu = D.getElementById('qr-kutu');
  var qrUrl = D.getElementById('qr-url');
  var linkKopyala = D.getElementById('link-kopyala');
  var qrHazir = false;

  function sayfaAdresi() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }
  function qrUret() {
    if (qrHazir || typeof qrcode !== 'function') return;
    var adres = sayfaAdresi();
    var qr = qrcode(0, 'H');
    qr.addData(adres);
    qr.make();
    var logo = qrKutu.querySelector('.qr-logo');
    qrKutu.insertAdjacentHTML('afterbegin', qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }));
    var el = qrKutu.querySelector('svg');
    if (el) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'QR'); }
    if (logo) qrKutu.appendChild(logo);
    qrUrl.textContent = adres.replace(/^https?:\/\//, '').replace(/\/$/, '');
    qrHazir = true;
  }
  qrAc.addEventListener('click', function () { qrUret(); sheetAc(qrSheet, qrKapat); });
  qrKapat.addEventListener('click', sheetKapat);
  linkKopyala.addEventListener('click', function () { kopyala(sayfaAdresi()); });

  /* ---------- randevu ---------- */
  var rSheet = D.getElementById('randevu-sheet');
  var rAc = D.getElementById('randevu-ac');
  var rKapat = D.getElementById('randevu-kapat');
  var rForm = D.getElementById('randevu-form');
  var rGonder = D.getElementById('randevu-gonder');
  var rHata = D.getElementById('randevu-hata');
  var rBasarili = D.getElementById('randevu-basarili');

  var slotYukleniyor = D.getElementById('slot-yukleniyor');
  var slotlarKutu = D.getElementById('slotlar');
  var gunSerit = D.getElementById('gun-serit');
  var saatIzgara = D.getElementById('saat-izgara');
  var alanZaman = D.getElementById('alan-zaman');
  var alanEposta = D.getElementById('alan-eposta');
  var basAlan = D.getElementById('r-baslangic');
  var basariRandevu = D.getElementById('basari-randevu');
  var basariAlt = D.getElementById('basari-alt');
  var basariBaslik = rBasarili.querySelector('.basari-baslik');
  var basariMeet = D.getElementById('basari-meet');
  var basariMeetAdres = D.getElementById('basari-meet-adres');

  var takvimKipi = false;   // true: canlı slot seçimi, false: serbest metin + WhatsApp

  /** Dil değişince de doğru kalsın diye metni data-tr/data-en ile birlikte yazar. */
  function metinAyarla(el, sozluk) {
    el.setAttribute('data-tr', sozluk.tr);
    el.setAttribute('data-en', sozluk.en);
    el.textContent = sozluk[dil];
  }
  var gunlerVerisi = [];
  var secilenGun = 0;
  var slotlarYuklendi = false;

  function tarihEtiketi(tarihMetni, haftaGunu) {
    var p = tarihMetni.split('-');
    return { gunAdi: GUNLER[dil][haftaGunu], gunNo: +p[2], ay: AYLAR[dil][+p[1] - 1] };
  }

  function saatleriCiz() {
    saatIzgara.innerHTML = '';
    basAlan.value = '';
    var gun = gunlerVerisi[secilenGun];
    if (!gun) return;
    gun.slotlar.forEach(function (s) {
      var d = D.createElement('button');
      d.type = 'button';
      d.className = 'saat';
      d.textContent = s.etiket;
      d.setAttribute('aria-pressed', 'false');
      d.addEventListener('click', function () {
        var hepsi = saatIzgara.querySelectorAll('.saat');
        for (var i = 0; i < hepsi.length; i++) hepsi[i].setAttribute('aria-pressed', 'false');
        d.setAttribute('aria-pressed', 'true');
        basAlan.value = s.bas;
        rHata.hidden = true;
      });
      saatIzgara.appendChild(d);
    });
  }

  function gunleriCiz() {
    gunSerit.innerHTML = '';
    gunlerVerisi.forEach(function (g, i) {
      var e = tarihEtiketi(g.tarih, g.haftaGunu);
      var d = D.createElement('button');
      d.type = 'button';
      d.className = 'gun';
      d.setAttribute('role', 'tab');
      d.setAttribute('aria-selected', i === secilenGun ? 'true' : 'false');
      d.innerHTML = '<b>' + e.gunNo + ' ' + e.ay + '</b><span>' + e.gunAdi + '</span>';
      d.addEventListener('click', function () {
        secilenGun = i;
        var hepsi = gunSerit.querySelectorAll('.gun');
        for (var j = 0; j < hepsi.length; j++) hepsi[j].setAttribute('aria-selected', j === i ? 'true' : 'false');
        saatleriCiz();
      });
      gunSerit.appendChild(d);
    });
    saatleriCiz();
  }

  function serbestKipeGec() {
    takvimKipi = false;
    slotYukleniyor.hidden = true;
    slotlarKutu.hidden = true;
    alanZaman.hidden = false;
    alanEposta.hidden = true;
    metinAyarla(rGonder.querySelector('span'), WA_GONDER);
  }

  function slotlariYukle() {
    if (slotlarYuklendi) return;
    slotlarYuklendi = true;
    slotYukleniyor.hidden = false;
    fetch('/api/musait', { headers: { Accept: 'application/json' } })
      .then(function (y) { return y.ok ? y.json() : Promise.reject(new Error('durum ' + y.status)); })
      .then(function (v) {
        if (!v.hazir || !v.gunler || !v.gunler.length) { serbestKipeGec(); return; }
        takvimKipi = true;
        gunlerVerisi = v.gunler;
        secilenGun = 0;
        slotYukleniyor.hidden = true;
        slotlarKutu.hidden = false;
        alanZaman.hidden = true;
        alanEposta.hidden = false;
        gunleriCiz();
      })
      .catch(serbestKipeGec);
  }

  rAc.addEventListener('click', function () {
    sheetAc(rSheet, D.getElementById('r-ad'));
    slotlariYukle();
  });
  rKapat.addEventListener('click', sheetKapat);

  function basariGoster(saatMetni, whatsappKipi, sonuc) {
    rForm.hidden = true;
    rBasarili.hidden = false;
    if (saatMetni) {
      basariRandevu.textContent = RANDEVU_ONAY[dil](saatMetni);
      basariRandevu.hidden = false;
      metinAyarla(basariAlt, RANDEVU_ALT);
    }
    if (whatsappKipi) {
      metinAyarla(basariBaslik, WA_BASLIK);
      metinAyarla(basariAlt, WA_ALT);
    }
    if (sonuc) {
      var anahtar = sonuc.sekil === 'meet' ? (sonuc.meet ? 'meet' : 'meetLinksiz') : sonuc.sekil;
      if (SEKIL_ALT[anahtar]) metinAyarla(basariAlt, SEKIL_ALT[anahtar]);
      if (sonuc.meet && /^https:\/\/meet\.google\.com\//.test(sonuc.meet)) {
        basariMeet.href = sonuc.meet;
        basariMeet.hidden = false;
        basariMeetAdres.textContent = sonuc.meet.replace('https://', '');
        basariMeetAdres.hidden = false;
      }
    }
    rSheet.scrollTop = 0;
  }

  rForm.addEventListener('submit', function (e) {
    e.preventDefault();
    rHata.hidden = true;

    if (takvimKipi && !basAlan.value) {
      rHata.textContent = SAAT_SEC[dil];
      rHata.hidden = false;
      return;
    }

    var etiket = rGonder.querySelector('span');
    var eskiMetin = etiket.textContent;
    rGonder.disabled = true;
    etiket.textContent = GONDERILIYOR[dil];

    function basarisiz(mesaj) {
      rHata.textContent = mesaj || HATA[dil];
      rHata.hidden = false;
      rGonder.disabled = false;
      etiket.textContent = eskiMetin;
    }

    if (takvimKipi) {
      var gun = gunlerVerisi[secilenGun];
      var secili = saatIzgara.querySelector('.saat[aria-pressed="true"]');
      var e2 = tarihEtiketi(gun.tarih, gun.haftaGunu);
      var okunur = e2.gunNo + ' ' + e2.ay + ' ' + e2.gunAdi + ', ' + (secili ? secili.textContent : '');

      fetch('/api/randevu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ad: D.getElementById('r-ad').value,
          firma: D.getElementById('r-firma').value,
          telefon: D.getElementById('r-telefon').value,
          eposta: D.getElementById('r-eposta').value,
          cozum: D.getElementById('r-cozum').value,
          baslangic: basAlan.value,
          sekil: D.getElementById('r-sekil').value,
          sirketAdi: D.getElementById('r-sirket').value
        })
      }).then(function (y) {
        return y.json().then(function (v) { return { durum: y.status, v: v }; });
      }).then(function (c) {
        if (c.durum === 409) {
          basarisiz(SLOT_DOLU[dil]);
          slotlarYuklendi = false;
          slotlariYukle();
          return;
        }
        if (!c.v.tamam) throw new Error(c.v.sebep || 'bilinmeyen');
        basariGoster(okunur, false, c.v);
      }).catch(function () { basarisiz(); });
      return;
    }

    var et = WA_ETIKET[dil];
    var deger = function (id) { return D.getElementById(id).value.trim(); };
    var satirlar = [
      WA_GIRIS[dil], '',
      et.ad + ': ' + deger('r-ad'),
      et.firma + ': ' + deger('r-firma'),
      et.telefon + ': ' + deger('r-telefon')
    ];
    var cozumSecim = D.getElementById('r-cozum');
    if (cozumSecim.value) satirlar.push(et.cozum + ': ' + cozumSecim.options[cozumSecim.selectedIndex].textContent);
    var sekilSecim = D.getElementById('r-sekil');
    satirlar.push(et.sekil + ': ' + sekilSecim.options[sekilSecim.selectedIndex].textContent);
    if (deger('r-zaman')) satirlar.push(et.zaman + ': ' + deger('r-zaman'));
    var waAdres = 'https://wa.me/905526961703?text=' + encodeURIComponent(satirlar.join('\n'));
    var pencere = window.open(waAdres, '_blank');
    if (pencere) { try { pencere.opener = null; } catch (h) {} }
    else window.location.href = waAdres;
    rGonder.disabled = false;
    etiket.textContent = eskiMetin;
    basariGoster(null, true);
  });

  /* ---------- ident video ---------- */
  var video = D.getElementById('ident');
  if (video) {
    var azHareket = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var kaynak = (window.innerWidth < 700) ? 'varlik/video/ident-720.mp4' : 'varlik/video/ident-1080.mp4';
    var yuklendi = false;
    function yukle() { if (yuklendi) return; yuklendi = true; video.src = kaynak; video.load(); }
    function oynat() {
      yukle();
      var p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
    if (!azHareket && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (girdiler) {
        for (var i = 0; i < girdiler.length; i++) {
          if (girdiler[i].isIntersecting) { oynat(); io.disconnect(); break; }
        }
      }, { threshold: 0.4 });
      io.observe(video);
    }
    video.addEventListener('click', function () {
      if (!yuklendi) { oynat(); return; }
      video.currentTime = 0; oynat();
    });
  }
})();
