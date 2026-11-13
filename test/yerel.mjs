/* Yerel deneme — gerçek hesaba dokunmaz.
     node test/yerel.mjs [port]                       sahte Google ile (takvim kipi)
     node test/yerel.mjs [port] --takvimsiz           Google yok (WhatsApp kipi)
     node test/yerel.mjs [port] --plan[=plan.md]      DeepCore planı açık (şifre: yerel-sifre),
                                                       veri geçici klasörde; plan.md verilirse yüklenir
     node test/yerel.mjs [port] --toplanti            /toplanti: sahte Google + sahte CRM + örnek toplantılar
                                                       (şifre: yerel-sifre; --crmsiz ile CRM kapalı)
     node test/yerel.mjs [port] --ders=video.mp4      /ders: örnek dersler, hepsi verilen videoyla
                                                       (şifre: yerel-sifre) */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sahteGoogleBaslat } from './sahte-google.mjs';
import { sahteCrmBaslat } from './sahte-crm.mjs';
import { sunucuOlustur } from '../sunucu/sunucu.mjs';
import { istanbulDan, istanbulParcalari } from '../sunucu/takvim.mjs';

const port = Number(process.argv[2]) || 3090;
const takvimsiz = process.argv.includes('--takvimsiz');
const planArg = process.argv.find((a) => a === '--plan' || a.startsWith('--plan='));
const toplantiKipi = process.argv.includes('--toplanti');
const dersArg = process.argv.find((a) => a.startsWith('--ders='));
if (planArg || toplantiKipi || dersArg) {
  Object.assign(process.env, {
    PLAN_SIFRE: 'yerel-sifre',
    PLAN_ANAHTAR: 'yerel-anahtar-yalniz-bu-makinede-0',
    KAFA_ANAHTAR: 'yerel-kafa-anahtari-yalniz-bu-makinede',
    PLAN_VERI: fs.mkdtempSync(path.join(os.tmpdir(), 'plan-yerel-'))
  });
}

let not = 'Google yok — WhatsApp kipi';
let google = null;
if (toplantiKipi && !process.argv.includes('--crmsiz')) {
  const crm = await sahteCrmBaslat();
  Object.assign(process.env, { NEXUS_CRM_URL: crm.kok, NEXUS_CRM_TOKEN: crm.jeton, TOPLANTI_ANAHTAR: 'yerel-kisayol-anahtari-yalniz-bu-makinede' });
}
if (!takvimsiz) {
  google = await sahteGoogleBaslat();
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

/** Ekranda görülecek örnek toplantılar: bugün, yarın (kart randevusu), dün (not bekleyen). */
async function ornekToplantilar() {
  const yetki = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.PLAN_ANAHTAR };
  const gun = (n, saat, dk = 0) => {
    const p = istanbulParcalari(new Date(Date.now() + n * 86400e3));
    return istanbulDan(p.yil, p.ay, p.gun, saat, dk).toISOString();
  };
  const simdiSaat = istanbulParcalari(new Date()).saat;
  const ornekler = [
    { ad: 'Ayşe Yılmaz', firma: 'Kobas Büro', telefon: '0532 000 00 01', eposta: 'ayse@ornek.com', bas: gun(simdiSaat < 22 ? 0 : 1, Math.min(simdiSaat + 1, 22), 30), sekil: 'meet', not: 'Servis teklifi' },
    { ad: 'Erkan Kaya', firma: 'Sentez Ofis', telefon: '0532 282 41 90', bas: gun(2, 11), sekil: 'telefon' },
    { firma: 'Ak Matbaa', bas: gun(3, 15), sure: 60, sekil: 'yuzyuze' }
  ];
  for (const o of ornekler) {
    await fetch(`http://localhost:${port}/api/toplanti/olustur`, { method: 'POST', headers: yetki, body: JSON.stringify({ ...o, zorla: true }) });
  }
  await fetch(`http://localhost:${port}/api/randevu`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ad: 'Veli Demir', firma: 'Örnek Fotokopi', telefon: '0533 222 33 44', cozum: 'Nextus Servis', sekil: 'meet', baslangic: gun(1, 16) })
  });
  google.durum.kayitlar.set('gecmis1', {
    id: 'gecmis1', status: 'confirmed', organizer: { self: true }, summary: 'Toplantı — Zeynep Ak (Ak Ofis)',
    extendedProperties: { private: { kart: 'toplanti', ad: 'Zeynep Ak', firma: 'Ak Ofis', telefon: '0542 999 88 77', sekil: 'meet' } },
    start: { dateTime: gun(-1, 14) }, end: { dateTime: gun(-1, 14, 30) }, hangoutLink: 'https://meet.google.com/abc-defg-hij'
  });
}

/** Ekranda görülecek örnek dersler: üç hesap, bir de videosuz arşiv kartı. */
async function ornekDersler() {
  const kok = `http://localhost:${port}`;
  const yetki = { Authorization: 'Bearer ' + process.env.PLAN_ANAHTAR };
  const dersler = [
    { id: 'ornekA1', hesap: 'hormozi', konu: 'Teklif', baslik: 'Fiyatı düşürme, değeri büyüt', sira: 90, sure: 48,
      ozet: ['İndirim müşteriye “asıl fiyat buydu” der; güveni düşürür.', 'Aynı fiyata bir garanti ya da hızlı kurulum eklemek teklifi daha çekici yapar.', 'Müşteri fiyata değil, alacağı sonuca ve ne kadar çabuk alacağına bakar.'],
      uygulama: 'Bugünkü teklifte indirimi çıkar, yerine 45 dakikada kurulum sözünü yaz.', soru: 'İndirim yerine teklife ne eklenir, neden?' },
    { id: 'ornekB1', hesap: 'danmartell', konu: 'Zaman', baslik: 'Saatlik değerinin altındaki işi devret', sira: 80, sure: 55,
      ozet: ['Önce kendi saatlik değerini hesapla.', 'Bunun dörtte birine yaptırabileceğin her iş devredilecek iştir.', 'Devrederken sonucu tarif et, adımları değil.'],
      uygulama: 'Bu hafta üç kez yaptığım bir işi yazıp bir ekip arkadaşına devredeceğim.', soru: 'Hangi iş devredilir, hangi ölçüyle karar verilir?' },
    { id: 'ornekC1', hesap: 'leilahormozi', konu: 'Ekip', baslik: 'Geri bildirimi 24 saat içinde ver', sira: 70, sure: 40,
      ozet: ['Geç gelen geri bildirim ceza gibi algılanır.', 'Davranışı söyle, kişiliği değil.', 'Bir sonraki sefer ne beklediğini tek cümleyle bitir.'],
      uygulama: 'Dünkü aramayı dinleyip bugün tek cümle geri bildirim vereceğim.', soru: 'İyi geri bildirimin üç parçası nedir?' },
    { id: 'ornekD1', hesap: 'hormozi', konu: 'Satış', baslik: 'İtirazı cevaplamadan önce tekrar et', sira: 60, sure: 35,
      ozet: ['Müşterinin itirazını kendi cümlesiyle geri söyle.', 'Sonra “başka bir şey var mı” diye sor.', 'Asıl itiraz çoğu zaman ikinci söylenendir.'],
      uygulama: 'İlk “pahalı” itirazında önce tekrar edip sonra soracağım.', soru: 'İtiraz gelince ilk iki adım nedir?' },
    { id: 'ornekArsiv1', hesap: 'garyvee', konu: 'İçerik', baslik: 'Belgele, üretme', sira: 1, arsiv: true, url: 'https://www.instagram.com/garyvee/',
      ozet: ['Yaptığın işi kaydetmek, içerik uydurmaktan kolaydır.', 'Tutarlılık kaliteden önce gelir.'] }
  ];
  await fetch(kok + '/api/ders/yukle', { method: 'POST', headers: { ...yetki, 'Content-Type': 'application/json' }, body: JSON.stringify({ dersler }) });
  const video = fs.readFileSync(dersArg.slice('--ders='.length));
  for (const d of dersler) {
    if (!d.arsiv) await fetch(kok + '/api/ders/video/' + d.id, { method: 'POST', headers: { ...yetki, 'Content-Type': 'video/mp4' }, body: video });
  }
  console.log(`[yerel] dersler: ${kok}/ders/ · şifre: yerel-sifre`);
}

sunucuOlustur().listen(port, async () => {
  console.log(`[yerel] http://localhost:${port} · ${not}`);
  if (dersArg) await ornekDersler();
  if (toplantiKipi) {
    if (google) await ornekToplantilar();
    console.log(`[yerel] toplantılar: http://localhost:${port}/toplanti/ · şifre: yerel-sifre · CRM: ${process.env.NEXUS_CRM_URL ? 'sahte' : 'kapalı'}`);
  }
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
