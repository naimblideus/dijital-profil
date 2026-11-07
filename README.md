# Dijital profil — Mehmet Naim Çetin

Telefonla açılan dijital kartvizit. Ziyaretçi Google Takvim'deki boş saatleri görür,
birini seçer; görüşme takvime yazılır, sahibine e-posta gider. Takvim bağlı değilse
form talebi WhatsApp mesajı olarak gönderir.

Harici paket yok: düz HTML/CSS/JS + tek dosyalık Node sunucusu.

```
site/      statik kart (index.html, stil.css, kart.js, varlik/) · plan/ (DeepCore) · toplanti/
sunucu/    sunucu.mjs (statik + API) · takvim.mjs · musait.mjs · randevu.mjs · bildirim.mjs
           plan.mjs · plan-ayristir.mjs · toplanti.mjs · crm.mjs (Nexus CRM köprüsü)
araclar/   takvim-yetki.mjs — Google bağlantısı, bir kez · plan-yukle.mjs — plan.md'yi yükler
test/      sunucu.test.mjs · plan.test.mjs · toplanti.test.mjs · sahte-google.mjs · sahte-crm.mjs · yerel.mjs
```

## DeepCore planı — `/plan`

Şifreli kişisel plan: günlük görevler, tek dokunuşla bitir, yarına at, geçmişten kalanı
bugüne al. Telefon ve bilgisayar aynı veriyi görür. Veri sunucu diskinde (`PLAN_VERI`)
durur, **depoya asla girmez**; `PLAN_SIFRE` yoksa plan tamamen kapalıdır.

```bash
node araclar/plan-yukle.mjs [plan.md] [--deneme]   # plan.md → canlı (ayar: ~/.nextus-plan.json)
node test/yerel.mjs 3092 --takvimsiz --plan=plan.md # yerelde, şifre: yerel-sifre
```

Plan yeniden yüklenince kopya oluşmaz; yapılmış, taşınmış, elle düzeltilmiş görev korunur,
bilerek silinen geri gelmez, elle eklenene dokunulmaz. Günlük yedek `PLAN_VERI/yedek/` (30 gün).

## Toplantılar — `/toplanti`

Görüşmeleri tek ekrandan yönetmek için; **DeepCore ile aynı giriş** (ayrı şifre yok).

- **Liste:** önümüzdeki 30 günün toplantıları gün gün — kartın randevu formundan gelenler
  ("Kart randevusu"), bu ekrandan kurulanlar ve takvimdeki kişili davetler ("Takvimden").
  Son 3 günün toplantıları "Geride kalan"da; "Görüştük" denmemişse "Not bekliyor" yazar.
  Kişisiz etkinlikler (spor, odak bloğu) görünmez ama boş saatleri doldurur.
- **Yeni toplantı:** kişiyi CRM'den ara (ad, firma, telefonun son haneleri) ya da elle yaz →
  süre → boş saat (çakışan saat listede yok; "başka saat" yazılırsa ve çakışırsa sorar) →
  şekil (Google Meet varsayılan, telefon, yüz yüze) → not. E-posta yazıldıysa ve "davet
  gönder" açıksa Google daveti gider; başka hiçbir şey kendiliğinden gitmez.
- **Kurulunca:** takvim etkinliği (Meet linkiyle) + CRM'de firma kartına "Toplantı planlandı"
  + **hazır WhatsApp mesajı** (wa.me bağlantısı — gönder tuşuna sen basarsın).
  CRM'de birden çok kayıt uyarsa ekran hangisi olduğunu sorar; CRM'e ulaşılamazsa takvim
  yine tamamdır, "CRM'e yaz" sonra yapılır.
- **Her toplantıda:** Meet'e katıl · Ara · WhatsApp'tan hatırlat · CRM kartını aç ·
  Görüştük (kısa not CRM'e) · Ertele (davetliye takvimden haber, isteğe bağlı) · İptal et.
- **Randevu linki:** karşı tarafa `…/#randevu` bağlantılı hazır mesaj; link kartın randevu
  bölümünü doğrudan açar, seçtiği saat takvime ve CRM'e kendiliğinden düşer.

Ziyaretçinin kart üzerinden aldığı randevu da CRM'e yazılır ("Randevu alındı (kart)";
seçtiği çözüm ürünle eşleşirse fırsatı da açılır). CRM kapalı ya da hatalıysa randevu
bundan etkilenmez.

### iPhone: rehberden kişi seçip toplantı kurmak (Kestirmeler)

Safari web sayfasına rehberi açmaz; Kestirmeler açar. Kişi bilgisi **adrese yazılmaz**:
kestirme kişiyi sunucuya yollar, 10 dakikalık tek kullanımlık bir kimlik alır, sayfayı
`/toplanti/#t-<kimlik>` ile açar; form o kişiyle dolu gelir.

Hazırlık (bir kez): Coolify'da `TOPLANTI_ANAHTAR` ortam değişkenine en az 24 karakterlik
rastgele bir değer koy (ör. `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`)
ve yeniden dağıt. Bu anahtar **yalnız taslak açabilir**, hiçbir toplantıyı ya da kişiyi okuyamaz.

1. **Kestirmeler** → sağ üstte **+** → adı: `Toplantı kur`.
2. **Eylem Ekle** → `Kişi Seç` (Select Contact).
3. **Eylem Ekle** → `URL İçeriğini Al` (Get Contents of URL):
   - URL: `https://naim.nextusservis.com/api/toplanti/taslak`
   - **Yöntem:** `POST`
   - **Başlıklar** → başlık ekle: `Authorization` = `Bearer ` + TOPLANTI_ANAHTAR değeri
   - **İstek Gövdesi:** `JSON` → alan ekle (hepsi Metin):
     `ad` = Kişi → Ad · `telefon` = Kişi → Telefon Numaraları · `eposta` = Kişi → E-posta Adresleri ·
     `firma` = Kişi → Şirket (değişken seçerken "Kişi"ye dokunup alanı seç; birden çok numara
     varsa ilki alınır)
4. **Eylem Ekle** → `Sözlük Değerini Al` (Get Dictionary Value): anahtar `adres`, kaynak: URL İçeriği.
5. **Eylem Ekle** → `URL'leri Aç` (Open URLs) → Sözlük Değeri.
6. İsteğe bağlı: kestirmenin ayarlarından **Ana Ekrana Ekle**; ya da **Paylaşım Sayfasında
   Göster → Kişiler** seçip 2. adımı `Kestirme Girdisi` yap — Rehber'de kişiyi açıp
   Paylaş → `Toplantı kur`.

İlk açılışta Safari DeepCore şifresini sorar; sonra 6 ay hatırlar. Kestirmeyi **kimseyle
paylaşma**: içinde anahtar var. Sızarsa Coolify'da `TOPLANTI_ANAHTAR`'ı değiştirip yeniden dağıt.

```bash
node test/yerel.mjs 3093 --toplanti           # sahte Google + sahte CRM + örnek toplantılar, şifre: yerel-sifre
node test/yerel.mjs 3093 --toplanti --crmsiz  # CRM kapalıyken
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
| `GET /api/plan` · `POST /api/plan/{giris,cikis,islem,yukle}` | DeepCore planı; oturum çerezi ya da `Bearer PLAN_ANAHTAR` |
| `GET /api/toplanti` · `GET /api/toplanti/slotlar` | Toplantı listesi (−3 / +30 gün) ve sahibin boş saatleri (4 saat kuralı yok); plan girişiyle |
| `POST /api/toplanti/{olustur,ertele,iptal,gorustuk,crm,ara,taslak-al}` | Kur (çakışmada 409, `zorla` ile geçer) · ertele · iptal · görüştük notu · CRM'e (yeniden) yaz · CRM'de kişi ara (sorgu gövdede) · kestirme taslağını bir kez oku |
| `POST /api/toplanti/taslak` | iOS kestirmesi: `Bearer TOPLANTI_ANAHTAR` ile kişi taslağı (10 dk, tek kullanımlık) → `{ adres }` |

Aynı adresten 10 dakikada en fazla 5, herkesten saatte en fazla 40 talep.

## Yayın (Coolify)

Public Repository → bu depo → Build Pack **Dockerfile** → Ports Exposes **3000** →
Domains `https://naim.nextusservis.com`. Plan için **Storages → Volume Mount →
`/app/veri`** (yoksa plan her yeniden dağıtımda silinir; arayüz "kalıcı değil" der).

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
| `PLAN_SIFRE` | plan için | En az 8 karakter. Yoksa `/plan` kapalı. Değişirse tüm cihazlardan çıkış |
| `PLAN_ANAHTAR` | yükleme için | En az 24 karakter; `plan-yukle.mjs` bununla yükler |
| `PLAN_VERI` | hayır | Dockerfile'da `/app/veri` — kalıcı birim buraya bağlanır |
| `NEXUS_CRM_URL` | CRM için | Ör. `https://crm.nextusservis.com`. Yoksa toplantılar yalnız takvime yazılır |
| `NEXUS_CRM_TOKEN` | CRM için | CRM'deki `WEBHOOK_TOKEN`'ın **aynısı** (`x-nexus-token`) |
| `TOPLANTI_ANAHTAR` | kestirme için | En az 24 karakter; yalnız `/api/toplanti/taslak` |
| `KART_ADRESI` | hayır | Randevu linkinin kökü; varsayılan `https://naim.nextusservis.com/` |

Google bulut projesinde OAuth onay ekranı **yayında (In production)** olmalı; "Testing"
durumunda yenileme jetonu 7 günde ölür.
