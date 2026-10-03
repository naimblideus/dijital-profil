/* Google Takvim yardımcıları — harici paket yok, düz REST.
   İstanbul UTC+3 ve yaz saati uygulamıyor (2016'dan beri), sabit ofset güvenli. */

export const ISTANBUL_OFSET = 3;

const VARSAYILAN = {
  baslangicSaat: 9,      // 09:00
  baslangicDakika: 0,
  bitisSaat: 18,         // 18:00
  bitisDakika: 0,
  slotDakika: 30,
  oglePaydosBaslangic: 12 * 60 + 30,  // 12:30
  oglePaydosBitis: 13 * 60 + 30,      // 13:30
  ilerideGun: 14,        // kaç gün ileriye bakılsın
  enAzHaberSaat: 4,      // en erken kaç saat sonrası teklif edilsin
  gunBasinaEnFazla: 6    // bir günde gösterilecek en fazla slot
};

// Adresler ortamdan okunabilir: testler sahte Google sunucusuna yönlendirir.
export const tokenAdresi = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
export const takvimKoku = () => process.env.GOOGLE_API_KOK || 'https://www.googleapis.com';
export const gmailKoku = () => process.env.GOOGLE_GMAIL_KOK || 'https://gmail.googleapis.com';

export function ayarlar() {
  const s = (ad, varsayilan) => {
    const d = process.env[ad];
    return d === undefined || d === '' ? varsayilan : d;
  };
  const saatAyristir = (metin, vsSaat, vsDakika) => {
    const e = /^(\d{1,2}):(\d{2})$/.exec(String(metin || ''));
    return e ? { saat: +e[1], dakika: +e[2] } : { saat: vsSaat, dakika: vsDakika };
  };
  const bas = saatAyristir(s('CALISMA_BASLANGIC', ''), VARSAYILAN.baslangicSaat, VARSAYILAN.baslangicDakika);
  const bit = saatAyristir(s('CALISMA_BITIS', ''), VARSAYILAN.bitisSaat, VARSAYILAN.bitisDakika);
  return {
    ...VARSAYILAN,
    baslangicSaat: bas.saat, baslangicDakika: bas.dakika,
    bitisSaat: bit.saat, bitisDakika: bit.dakika,
    slotDakika: Number(s('SLOT_DAKIKA', VARSAYILAN.slotDakika)) || VARSAYILAN.slotDakika,
    ilerideGun: Number(s('ILERIDE_GUN', VARSAYILAN.ilerideGun)) || VARSAYILAN.ilerideGun,
    enAzHaberSaat: Number(s('EN_AZ_HABER_SAAT', VARSAYILAN.enAzHaberSaat)) || VARSAYILAN.enAzHaberSaat,
    takvimler: String(s('TAKVIM_IDLER', 'primary')).split(',').map(x => x.trim()).filter(Boolean)
  };
}

export function kimlikVarMi() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

// Sunucu süreci kalıcı: erişim jetonu süresi dolana kadar bellekte tutulur,
// her istekte Google'a ayrıca jeton sorulmaz.
let jetonBellek = null;

export function jetonBelleginiSil() { jetonBellek = null; }

/** Yenileme jetonunu erişim jetonuna çevirir. */
export async function erisimJetonu() {
  if (jetonBellek && jetonBellek.bitis > Date.now() + 60e3) return jetonBellek.jeton;
  const y = await fetch(tokenAdresi(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  if (!y.ok) throw new Error('jeton alinamadi: ' + y.status + ' ' + (await y.text()).slice(0, 200));
  const v = await y.json();
  jetonBellek = { jeton: v.access_token, bitis: Date.now() + (Number(v.expires_in) || 3600) * 1000 };
  return v.access_token;
}

/** İstanbul duvar saatinden gerçek (UTC tabanlı) Date üretir. */
export function istanbulDan(yil, ay, gun, saat, dakika) {
  return new Date(Date.UTC(yil, ay, gun, saat - ISTANBUL_OFSET, dakika, 0, 0));
}

/** Bir Date'in İstanbul'daki takvim parçaları. */
export function istanbulParcalari(d) {
  const k = new Date(d.getTime() + ISTANBUL_OFSET * 3600e3);
  return {
    yil: k.getUTCFullYear(), ay: k.getUTCMonth(), gun: k.getUTCDate(),
    saat: k.getUTCHours(), dakika: k.getUTCMinutes(), haftaGunu: k.getUTCDay()
  };
}

export async function mesgulAraliklar(jeton, takvimler, bas, bit) {
  const y = await fetch(takvimKoku() + '/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: bas.toISOString(),
      timeMax: bit.toISOString(),
      timeZone: 'Europe/Istanbul',
      items: takvimler.map(id => ({ id }))
    })
  });
  if (!y.ok) throw new Error('freeBusy hatasi: ' + y.status + ' ' + (await y.text()).slice(0, 200));
  const v = await y.json();
  const araliklar = [];
  for (const anahtar of Object.keys(v.calendars || {})) {
    for (const m of (v.calendars[anahtar].busy || [])) {
      araliklar.push({ bas: new Date(m.start), bit: new Date(m.end) });
    }
  }
  return araliklar;
}

export function cakisiyorMu(slotBas, slotBit, araliklar) {
  for (const a of araliklar) {
    if (slotBas < a.bit && slotBit > a.bas) return true;
  }
  return false;
}

/** Çalışma saatleri içinde, meşgul olmayan slotları günlere göre döner. */
export function slotlariUret(simdi, araliklar, a) {
  const enErken = new Date(simdi.getTime() + a.enAzHaberSaat * 3600e3);
  const gunler = [];

  for (let i = 0; i < a.ilerideGun; i++) {
    const temel = new Date(simdi.getTime() + i * 86400e3);
    const p = istanbulParcalari(temel);
    if (p.haftaGunu === 0 || p.haftaGunu === 6) continue;   // hafta sonu

    const slotlar = [];
    const basDk = a.baslangicSaat * 60 + a.baslangicDakika;
    const bitDk = a.bitisSaat * 60 + a.bitisDakika;

    for (let dk = basDk; dk + a.slotDakika <= bitDk; dk += a.slotDakika) {
      if (dk < a.oglePaydosBitis && dk + a.slotDakika > a.oglePaydosBaslangic) continue; // öğle
      const sBas = istanbulDan(p.yil, p.ay, p.gun, Math.floor(dk / 60), dk % 60);
      const sBit = new Date(sBas.getTime() + a.slotDakika * 60000);
      if (sBas < enErken) continue;
      if (cakisiyorMu(sBas, sBit, araliklar)) continue;
      slotlar.push({
        bas: sBas.toISOString(),
        etiket: String(Math.floor(dk / 60)).padStart(2, '0') + ':' + String(dk % 60).padStart(2, '0')
      });
      if (slotlar.length >= a.gunBasinaEnFazla) break;
    }
    if (slotlar.length) {
      gunler.push({
        tarih: `${p.yil}-${String(p.ay + 1).padStart(2, '0')}-${String(p.gun).padStart(2, '0')}`,
        haftaGunu: p.haftaGunu,
        slotlar
      });
    }
  }
  return gunler;
}

export function jsonCevap(veri, durum = 200) {
  return new Response(JSON.stringify(veri), {
    status: durum,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
