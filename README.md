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

### "Kafama at" — iPhone'dan sesle iş ekleme

`POST /api/plan/kafa` (`Authorization: Bearer <KAFA_ANAHTAR>`, gövde `{"metin": "…"}`) söylenen
cümleyi **bugüne, saatsiz** iş olarak ekler; ekranda "Kafamdakiler"de görünür. Anahtar yalnız
ekleyebilir: planı okuyamaz, düzenleyemez (dakikada en çok 20 ekleme).

Kestirmeler → **+** → adı **Kafama at**:
1. **Metni Dikte Et** (Dil: Türkçe, Dinlemeyi Durdur: Duraklamadan Sonra).
2. **URL'nin İçeriğini Al** → URL `https://naim.nextusservis.com/api/plan/kafa` · Yöntem **POST** ·
   Başlıklar: `Authorization` = `Bearer ` + anahtar · İstek Gövdesi **JSON** → anahtar `metin`, değer: *Dikte Edilen Metin*.
3. **Bildirim Göster**: `Kafana attım ✓`.

Sonra kestirmeyi **Ana Ekrana Ekle**; "Hey Siri, kafama at" de çalışır. Aynı uca paylaşım
menüsünden ya da Apple Watch'tan da metin gönderilebilir. Anahtar `KAFA_ANAHTAR` (en az 24 karakter);
kestirmeyi kimseyle paylaşma.

### Önem / aciliyet matrisi

Kafamdakiler'de sınıflanmamış iş varsa başlıkta **Sınıflandır · N** çıkar. Dokununca işler tek tek
gelir, 4 kutudan birine dokunulur, sıradaki gelir:
- **Acil + önemli** → Bugünün 3'üne (doluysa Kafamdakiler'in en üstüne)
- **Önemli** (acil değil) → saat seçilir, iş zaman ızgarasına ve takvime yerleşir
- **Acil, önemsiz** → "Hızlı" rozetiyle Kafamdakiler'de kalır
- **İkisi de değil** → silinir (5 sn geri alınabilir)

Bir işin sınıfı sonradan görev menüsündeki **Önemli mi, acil mi?** ile değişir (`kadran` 1–4).

### Takvim aynası

Google bağlıysa saati olan her plan işi Google Takvim'e de yazılır (iPhone Takvim'de görünür):
"boş" (transparent) olarak — kart randevularını ve toplantı çakışmasını engellemez; blok başlarken
telefon bir kez uyarır; bitince başına ✓ gelir; saat kalkınca ya da iş silinince etkinlik silinir.
Tek yön (plan → takvim). Kapatmak için `PLAN_TAKVIM=kapali`.

### Odakta Instagram engeli (iPhone)

Odaklan'a basınca plan sunucuya "odaktayım" der (hedef + 30 dk, en çok 5 saat); Bitir/Dağıldım ile
düşer. `GET /api/plan/odak` (`Authorization: Bearer <KAFA_ANAHTAR>`) düz metin `evet` / `hayir` döner.

Kestirmeler → **Otomasyon** → **+** → **Uygulama** → Instagram → **Açıldığında** → **Hemen Çalıştır**:
1. **URL'nin İçeriğini Al** → `https://naim.nextusservis.com/api/plan/odak` · Yöntem GET ·
   Başlık `Authorization` = `Bearer ` + anahtar.
2. **Eğer** *URL'nin İçeriği* **şudur** `evet`:
   **Bildirim Göster** "Odaktasın — işine dön" → **URL'leri Aç** `https://naim.nextusservis.com/plan/`.
3. **Eğer Sonu.**

Instagram her açıldığında sorar; odak yoksa hiçbir şey olmaz. Ana ekrandaki uygulama da Safari de
sayacı sunucudaki odaktan geri getirir.

### Telegram hatırlatması

`TELEGRAM_BOT_TOKEN` ve `TELEGRAM_CHAT_ID` varsa sunucu her gün iki kısa mesaj atar
(İstanbul saati, her biri günde en çok bir kez, yeniden başlatmada tekrarlamaz):
- **08:30** — Bugünün 3'ü, ilk saat bloğu, kafada bekleyen iş sayısı.
- **21:00** — Bugün kaç iş bitti; yarının 3'ü seçiliyse "Yarın hazır ✓", değilse "Yarını kur".

Her mesajda "Planı aç" düğmesi var. Saatten sonraki 90 dakika içinde gider; sunucu o arada
kapalıysa o günkü mesaj atlanır. Saatler `HATIRLAT_SABAH` / `HATIRLAT_AKSAM` ile değişir.
Sohbet kimliği: bota bir kez `/start` yaz, sonra `https://api.telegram.org/bot<anahtar>/getUpdates`
çıktısındaki `chat.id` (bot webhook kullanıyorsa bu boş döner; kimliği botun kendi kaydından al).

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
| `KAFA_ANAHTAR` | "Kafama at" için | En az 24 karakter; yalnız `/api/plan/kafa` (ekler, okuyamaz). Yoksa uç kapalı |
| `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID` | hatırlatma için | İkisi de yoksa hatırlatma kapalı |
| `HATIRLAT_SABAH` · `HATIRLAT_AKSAM` | hayır | Varsayılan `08:30` · `21:00` (İstanbul) |
| `PLAN_TAKVIM` | hayır | `kapali` yazılırsa saatli plan işleri Google Takvim'e yazılmaz |
| `KART_ADRESI` | hayır | Randevu linkinin kökü; varsayılan `https://naim.nextusservis.com/` |

Google bulut projesinde OAuth onay ekranı **yayında (In production)** olmalı; "Testing"
durumunda yenileme jetonu 7 günde ölür.
