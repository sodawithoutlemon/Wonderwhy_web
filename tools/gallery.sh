#!/usr/bin/env bash
# Ana sayfanın "Uygulamadan" şeridi: App Store'un iPhone 6,9" mağaza görselleri,
# olduğu gibi (başlık yazısı ve çerçeve dahil; 24 Eki 2026, ADR-072). Kaynak
# uygulama reposunun brand/store/screens/build.py çıktısı (gerçek arayüz +
# kurgusal içerik, ADR-057). Mağaza görselleri yeniden üretilince (ör. CarPlay,
# sesli komut kareleri) bu betik yeniden çalıştırılır; sıra ve adlar oradan gelir.
#
#   bash tools/gallery.sh
#   APP_ROOT=/yol/uygulama-reposu bash tools/gallery.sh
#
# Çıktı: src/static/gallery/{en,tr,es,de}/<ad>.{avif,jpg}  (480 px; CSS'te en çok 240)
#        src/data/gallery.json (sıra, adlar, piksel ölçüsü)
# ffmpeg ve macOS sips ister.
set -euo pipefail

SITE="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="${APP_ROOT:-$(cd "$SITE/.." && pwd)}"
SRC="$APP_ROOT/brand/store/screenshots/appstore-iphone-6.9"
OUT="$SITE/src/static/gallery"
JSON="$SITE/src/data/gallery.json"
[ -d "$SRC" ] || { echo "mağaza görselleri yok: $SRC (APP_ROOT ile uygulama reposunu göster)" >&2; exit 1; }
WIDTH=480

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rm -rf "$OUT"
names=()
for lang in en tr es de; do
  mkdir -p "$OUT/$lang"
  for in in "$SRC/$lang"/*.png; do
    name="$(basename "$in" .png)"
    name="${name#*-}" # 01-player_answer → player_answer
    [ "$lang" = en ] && names+=("$name")
    ffmpeg -v error -y -i "$in" -vf "scale=$WIDTH:-2:flags=lanczos" "$TMP/$name.png"
    sips -s format avif -s formatOptions 55 "$TMP/$name.png" --out "$OUT/$lang/$name.avif" >/dev/null
    ffmpeg -v error -y -i "$TMP/$name.png" -q:v 5 "$OUT/$lang/$name.jpg"
    printf '  %s/%-14s avif %3d KB · jpg %3d KB\n' "$lang" "$name" \
      $(($(wc -c <"$OUT/$lang/$name.avif") / 1024)) $(($(wc -c <"$OUT/$lang/$name.jpg") / 1024))
  done
  # Her dilde aynı kareler, aynı sırada (build.py › LANGS)
  [ "$(ls "$OUT/$lang" | sed 's/\..*//' | sort -u | wc -l | tr -d ' ')" = "${#names[@]}" ] || { echo "HATA $lang: kare sayısı farklı" >&2; exit 1; }
done
read -r W H < <(sips -g pixelWidth -g pixelHeight "$TMP/${names[0]}.png" | awk '/pixel/ { v[++n] = $2 } END { print v[1], v[2] }')
printf '{ "width": %s, "height": %s, "items": [%s] }\n' "$W" "$H" "$(printf '"%s",' "${names[@]}" | sed 's/,$//')" >"$JSON"
cat "$JSON"
