#!/usr/bin/env bash
# Ana sayfanın "Nasıl çalışır?" adımlarındaki uygulama ekranları (Y3, 20 Eki 2026).
# Kaynak: uygulama reposunun mağaza görselleri (brand/store/screens/build.py,
# gerçek arayüz + kurgusal içerik, ADR-057). Yalnız telefonun ekranı kırpılır;
# görseldeki başlık yazısı sitede HTML'de durur, çerçeveyi CSS çizer.
#
#   bash tools/screens.sh
#   APP_ROOT=/yol/uygulama-reposu bash tools/screens.sh
#
# Çıktı: src/static/screens/{en,tr}/{listen,ask,compare}.{avif,jpg}
#        src/data/screens.json (piksel ölçüsü; build.mjs width/height yazar)
# Ekranın yeri ölçüldü (iPhone 6.9", 1320×2868): çerçeve x 160–193 / 1126–1159,
# y 640–673 / 2699–2732, ekran 932×2025 @ (194, 674). Çerçeve rengi yerinde
# değilse (görsel hattı değişmiş) durur.
set -euo pipefail

SITE="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="${APP_ROOT:-$(cd "$SITE/.." && pwd)}"
SRC="$APP_ROOT/brand/store/screenshots/appstore-iphone-6.9"
OUT="$SITE/src/static/screens"
JSON="$SITE/src/data/screens.json"
[ -d "$SRC" ] || { echo "mağaza görselleri yok: $SRC (APP_ROOT ile uygulama reposunu göster)" >&2; exit 1; }

CROP="crop=932:2025:194:674"
WIDTH=560 # CSS'te en çok 280 px, 2x
# Adım → mağaza görseli (kullanıcı seçti, 20 Eki).
SHOTS=("listen:02-home" "ask:01-player_answer" "compare:03-story_compare")

pixel() { # pixel <dosya> <x> <y> → "r g b"
  ffmpeg -v error -i "$1" -vf "crop=1:1:$2:$3" -f rawvideo -pix_fmt rgb24 - | od -An -tu1 | xargs
}
bezel() { # çerçevenin koyu gri iç halkası (17,17,19) ± 4
  local p; p=$(pixel "$1" "$2" "$3")
  awk -v p="$p" -v f="$1" -v x="$2" -v y="$3" 'BEGIN { split(p, c, " ");
    if (c[1]<13||c[1]>21||c[2]<13||c[2]>21||c[3]<15||c[3]>23) { printf "HATA %s: (%s,%s) çerçeve değil: %s\n", f, x, y, p; exit 1 } }'
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for lang in en tr; do
  mkdir -p "$OUT/$lang"
  for pair in "${SHOTS[@]}"; do
    name="${pair%%:*}"
    in="$SRC/$lang/${pair#*:}.png"
    [ -f "$in" ] || { echo "yok: $in" >&2; exit 1; }
    bezel "$in" 180 1400 && bezel "$in" 1140 1400 && bezel "$in" 660 660 && bezel "$in" 660 2710
    ffmpeg -v error -y -i "$in" -vf "$CROP,scale=$WIDTH:-2:flags=lanczos" "$TMP/$name.png"
    sips -s format avif -s formatOptions 50 "$TMP/$name.png" --out "$OUT/$lang/$name.avif" >/dev/null
    ffmpeg -v error -y -i "$TMP/$name.png" -q:v 5 "$OUT/$lang/$name.jpg"
    printf '  %s/%-8s avif %3d KB · jpg %3d KB\n' "$lang" "$name" \
      $(($(wc -c <"$OUT/$lang/$name.avif") / 1024)) $(($(wc -c <"$OUT/$lang/$name.jpg") / 1024))
  done
done
read -r W H < <(sips -g pixelWidth -g pixelHeight "$TMP/listen.png" | awk '/pixel/ { v[++n] = $2 } END { print v[1], v[2] }')
printf '{ "width": %s, "height": %s }\n' "$W" "$H" >"$JSON"
echo "screens.json: ${W}×${H}"
