# wonderwhy.net

wonderwhy uygulamasının sitesi: tanıtım, gizlilik politikası, kullanım
şartları, destek ve hesap silme sayfaları. Türkçe ve İngilizce.

Website of the wonderwhy app (Turkish and English).

## Yapı

- `docs/`: yayınlanan site. GitHub Pages bu klasörü olduğu gibi sunar
  (Settings › Pages › Deploy from a branch › `main` › `/docs`). Elle
  düzenlenmez; `build.mjs` üretir.
- `src/`: kaynak.
  - `site.json`: tek ayar dosyası (marka, adres, yayıncı, e-postalar, mağaza
    bağlantıları, hukuki metinlerin tarihi, `appFlags`).
  - `strings/{en,tr}.json`: arayüz metinleri; `content/{en,tr}/`: hukuki metinler.
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
    siteye kopyalar. Uygulama reposu gerekir: varsayılan olarak bu reponun bir
    üstü, ya da `APP_ROOT`.

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
