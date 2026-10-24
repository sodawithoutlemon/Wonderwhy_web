# wonderwhy.net

wonderwhy uygulamasının sitesi: tanıtım, gizlilik politikası, kullanım
şartları, destek ve hesap silme sayfaları. İngilizce, Türkçe, İspanyolca ve
Almanca (KVKK aydınlatma metni yalnız Türkçe ve İngilizce).

Website of the Wonderwhy app (English, Turkish, Spanish and German).

## Yapı

- `docs/`: yayınlanan site. GitHub Pages bu klasörü olduğu gibi sunar
  (Settings › Pages › Deploy from a branch › `main` › `/docs`). Elle
  düzenlenmez; `build.mjs` üretir.
- `src/`: kaynak.
  - `site.json`: tek ayar dosyası (marka, adres, yayıncı, e-postalar, mağaza
    bağlantıları, hukuki metinlerin tarihi, `appFlags`).
  - `strings/{en,tr,es,de}.json`: arayüz metinleri (dört dil aynı anahtarları
    taşır); `content/{dil}/`: hukuki metinler.
  - `appFlags`: yayındaki uygulama sürümünde açık özellikler. Metinlerdeki
    `<!--if WONDERWHY_X-->…<!--else-->…<!--end-->` blokları bunlara göre
    derlenir (`!` tersi, `|` veya, `&` ve; iç içe olabilir). Ayrıntı
    `build.mjs` › `cond`.
  - `data/`, `static/`, `styles.css`.
- `build.mjs` (`src` → `docs`), `check.mjs` (denetim), `publish.sh` (derle,
  denetle, kaydet, gönder).
- `tools/`:
  - `crawl.mjs`: yayındaki siteyi gezer, her adresi ister;
  - `snapshot.mjs` ve `audio.sh`: uygulamanın onboarding içeriğini ve seslerini
    siteye kopyalar (Almanya'nın manşetleri Firestore'un herkese açık
    baskısından). `gallery.sh`: App Store'un iPhone 6,9" mağaza görsellerini
    "Uygulamadan" şeridine küçültür; mağaza seti değişince yeniden çalıştır.
    Uygulama reposu gerekir: varsayılan olarak bu reponun bir üstü, ya da
    `APP_ROOT`.

## Komutlar

```bash
node build.mjs && node check.mjs
node check.mjs --variants   # appFlags'in bütün birleşimleri
./publish.sh --dry-run
./publish.sh
node tools/crawl.mjs https://wonderwhy.net/
```

Bağımlılık yok; Node 22 yeterli. Kayıtlar `wonderwhy <hello@wonderwhy.net>`
kimliğiyle yapılır; `publish.sh` başka kimlikle gönderim yapmaz.
