/* plan.md → yapı. Harici paket yok; sunucu ve yerel yükleme betiği aynı kodu kullanır.

   Biçim:
     # Başlık satırı
     # ...haftanın notu (yorum satırları)...
     ## 2026-10-13 Salı
     - [Alan] Başlık | dakika | not

   Hiçbir görev sessizce düşmez: tanınmayan alan etiketi olduğu gibi kalır,
   okunamayan her şey `uyarilar` listesine yazılır. */

const TARIH = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Gerçek bir takvim günü mü? (2026-02-30 hayır) */
export function gecerliGun(s) {
  const m = TARIH.exec(String(s || ''));
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
}

/** Karşılaştırma anahtarı: büyük/küçük harf, Türkçe harf ve noktalama farkı yok sayılır.
    Önce tr-TR küçültülür (İ → i), sonra ASCII'ye katlanır. */
export function anahtar(s) {
  return String(s || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tek görev gövdesi: "[Alan] Başlık | dk | not". Etiket ve dakika isteğe bağlı. */
export function gorevSatiri(govde) {
  let s = String(govde || '').trim();
  let alan = null;
  const a = /^\[([^\]]{1,40})\]\s*/.exec(s);
  if (a) {
    alan = a[1].trim() || null;
    s = s.slice(a[0].length);
  }
  const parcalar = s.split('|');
  const baslik = parcalar[0].trim();
  let dk = null;
  let not = '';
  if (parcalar.length > 1) {
    const ikinci = parcalar[1].trim();
    if (/^\d{1,4}$/.test(ikinci) && Number(ikinci) <= 1440) {
      dk = Number(ikinci);
      not = parcalar.slice(2).join('|').trim();
    } else {
      not = parcalar.slice(1).join('|').trim();
    }
  }
  // "08:30-09:30 — Başlık" → zaman bloğu. Saat yoksa bas/bit alanı hiç eklenmez.
  const z = /^(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})\s*(?:[—–-]\s*)?/.exec(baslik);
  if (z) {
    const s = (h, m) => `${String(+h).padStart(2, '0')}:${m}`;
    const bas = s(z[1], z[2]);
    const bit = s(z[3], z[4]);
    const gecerli = (x) => /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(x);
    if (gecerli(bas) && gecerli(bit) && bit > bas && baslik.slice(z[0].length).trim()) {
      return { alan, baslik: baslik.slice(z[0].length).trim(), dk, not, bas, bit };
    }
  }
  return { alan, baslik, dk, not };
}

function temizBaslik(s) {
  return s.replace(/^haftal[ıi]k plan\s*[—–-]\s*/i, '').replace(/\s{2,}/g, ' ').trim().slice(0, 200);
}

const SUS = /^[═─━=\-#*·\s]*$/;
const TALIMAT = /^(düzenle|duzenle|biçim|bicim|alanlar|yükle|yukle)\b/i;
const KOMUT = /\bnode\s+\S+\.[cm]?js\b/;

/**
 * @returns {{ baslik: string, not: string, gunler: {gun: string, gorevler: object[]}[], uyarilar: string[] }}
 */
export function planAyristir(metin) {
  const satirlar = String(metin || '').replace(/^﻿/, '').split(/\r?\n/);
  let baslik = '';
  const notSatirlari = [];
  const gunler = [];
  const uyarilar = [];
  let gun = null;
  let gunBolumuGoruldu = false;

  satirlar.forEach((ham, i) => {
    const satir = ham.trim();
    const no = i + 1;
    if (!satir) return;

    const g = /^##\s+(\S+)/.exec(satir);
    if (g) {
      gunBolumuGoruldu = true;
      if (gecerliGun(g[1])) {
        gun = gunler.find((x) => x.gun === g[1]);
        if (!gun) { gun = { gun: g[1], gorevler: [] }; gunler.push(gun); }
      } else {
        uyarilar.push(`${no}. satır: "## ${g[1]}" bir tarih değil — altındaki satırlar görev sayılmadı`);
        gun = null;
      }
      return;
    }

    if (satir.startsWith('#')) {
      if (gunBolumuGoruldu) return;           // gün bölümlerinin içindeki yorumlar yok sayılır
      const ic = satir.replace(/^#+\s?/, '');
      if (!baslik) { baslik = temizBaslik(ic); return; }
      if (SUS.test(ic)) { notSatirlari.push(''); return; }   // süs çizgisi = paragraf arası
      if (TALIMAT.test(ic.trim()) || KOMUT.test(ic)) return;  // betik talimatları nota girmez
      notSatirlari.push(ic.replace(/(\S)\s{2,}/g, '$1 ').trimEnd());
      return;
    }

    const t = /^[-*]\s+(.*)$/.exec(satir);
    if (!t) return;
    if (!gun) {
      if (!gunBolumuGoruldu) uyarilar.push(`${no}. satır: gün başlığından önce görev — atlandı`);
      return;
    }
    const gs = gorevSatiri(t[1]);
    if (!gs.baslik) { uyarilar.push(`${no}. satır: başlıksız görev — atlandı`); return; }
    if (/^#\S+$/.test(gs.baslik)) uyarilar.push(`${no}. satır: "${gs.baslik}" eski DeepCore kimliği — başlık olarak alındı`);
    gun.gorevler.push({ ...gs, baslik: gs.baslik.slice(0, 300), not: gs.not.slice(0, 4000) });
  });

  const not = notSatirlari.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
  return { baslik, not, gunler, uyarilar };
}
