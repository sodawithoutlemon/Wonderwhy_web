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
    bağlantıları, hukuki metinlerin tarihi).
  - `strings/{en,tr}.json`: arayüz metinleri; `content/{en,tr}/`: hukuki metinler.
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
./publish.sh --dry-run
./publish.sh
node tools/crawl.mjs https://wonderwhy.net/
```

Bağımlılık yok; Node 22 yeterli. Kayıtlar `wonderwhy <hello@wonderwhy.net>`
kimliğiyle yapılır; `publish.sh` başka kimlikle gönderim yapmaz.
