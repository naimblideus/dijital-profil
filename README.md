# Dijital profil — Mehmet Naim Çetin

Telefonla açılan dijital kartvizit. Ziyaretçi Google Takvim'deki boş saatleri görür,
birini seçer; görüşme takvime yazılır, sahibine e-posta gider. Takvim bağlı değilse
form talebi WhatsApp mesajı olarak gönderir.

Harici paket yok: düz HTML/CSS/JS + tek dosyalık Node sunucusu.

```
site/      statik kart (index.html, stil.css, kart.js, varlik/)
sunucu/    sunucu.mjs (statik + API) · takvim.mjs · musait.mjs · randevu.mjs · bildirim.mjs
araclar/   takvim-yetki.mjs — Google bağlantısı, bir kez
test/      sunucu.test.mjs · sahte-google.mjs · yerel.mjs
```

## Yerelde

```bash
npm start                              # http://localhost:3000
npm test                               # gerçek Google'a dokunmaz
node test/yerel.mjs 3090               # sahte Google ile takvim kipi
node test/yerel.mjs 3091 --takvimsiz   # WhatsApp kipi
```

## Uçlar

| Yol | İş |
|---|---|
| `GET /api/musait` | Önümüzdeki 14 günün boş 30 dakikalık slotları — varsayılan her gün 08:00–24:00, en erken 4 saat sonrası |
| `POST /api/randevu` | Slotu yazmadan önce tekrar sorar (çakışmada 409), etkinliği açar (`sekil`: `meet` varsayılan → Google Meet linki; `telefon`; `yuzyuze` → ofis adresi), e-posta verildiyse davet gönderir, sahibine e-posta atar |
| `GET /saglik` | Docker sağlık kontrolü |

Aynı adresten 10 dakikada en fazla 5, herkesten saatte en fazla 40 talep.

## Yayın (Coolify)

Public Repository → bu depo → Build Pack **Dockerfile** → Ports Exposes **3000** →
Domains `https://naim.nextusservis.com`.

## Ortam değişkenleri

| Ad | Gerekli | Not |
|---|---|---|
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `GOOGLE_REFRESH_TOKEN` | takvim için | `node araclar/takvim-yetki.mjs` üretir ve panoya kopyalar |
| `BILDIRIM_EPOSTA` | önerilir | Yeni talep e-postasının gideceği adres (araç bağlanan hesabı yazar) |
| `CALISMA_BASLANGIC` / `CALISMA_BITIS` | hayır | Varsayılan `08:00` / `24:00`, hafta sonu dahil |
| `HAFTA_SONU` · `OGLE_ARASI` · `GUN_BASINA_EN_FAZLA` | hayır | `kapali` · `12:30-13:30` · `6` yazılırsa daralır; varsayılan açık, yok, sınırsız |
| `SLOT_DAKIKA` · `ILERIDE_GUN` · `EN_AZ_HABER_SAAT` | hayır | 30 · 14 · 4 |
| `OFIS_ADRESI` | hayır | Yüz yüze görüşmede etkinliğe yazılan adres (varsayılan Medipol Teknopark) |
| `TAKVIM_IDLER` | hayır | Virgülle; boş/dolu hepsinden okunur, etkinlik ilkine yazılır. Varsayılan `primary` |

Google bulut projesinde OAuth onay ekranı **yayında (In production)** olmalı; "Testing"
durumunda yenileme jetonu 7 günde ölür.
