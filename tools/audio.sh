#!/usr/bin/env bash
# Uygulamanın tanıtım seslerini siteye uygun AAC'ye çevirir ve süreleri ölçer.
# Kaynak: ham mu-law, 24 kHz, mono, başlıksız (tool/demo_audio.py).
#
#   bash tools/audio.sh
#   APP_ROOT=/yol/uygulama-reposu bash tools/audio.sh
#
# Çıktı: src/static/audio/{en,tr}/{listen,ask,compare}.m4a
#        src/data/audio.json (ölçülen süreler, saniye)
# Uygulama reposu varsayılan olarak bu reponun bir üstü (README).
# ask.m4a = soru + 0.35 sn sessizlik + cevap (uygulamadaki sıra).
# Ölçülen süre, .ulaw boyutu ÷ 24000'den 0.2 sn'den fazla saparsa durur.
set -euo pipefail

SITE="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="${APP_ROOT:-$(cd "$SITE/.." && pwd)}"
SRC="$APP_ROOT/app/assets/onboarding/audio"
OUT="$SITE/src/static/audio"
JSON="$SITE/src/data/audio.json"
[ -d "$SRC" ] || { echo "uygulama sesleri yok: $SRC (APP_ROOT ile uygulama reposunu göster)" >&2; exit 1; }
GAP=0.35
IN=(-f mulaw -ar 24000 -ac 1)
ENC=(-c:a aac -b:a 64k -movflags +faststart -map_metadata -1)

secs() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
ulaw_secs() { echo "scale=3; $(wc -c <"$1") / 24000" | bc; }
check() { # check <ölçülen> <beklenen> <ad>
  awk -v a="$1" -v b="$2" -v n="$3" 'BEGIN { d=a-b; if (d<0) d=-d;
    if (d>0.2) { printf "HATA %s: ölçülen %.2f, beklenen %.2f\n", n, a, b; exit 1 }
    printf "  %-8s %.2f sn (beklenen %.2f)\n", n, a, b }'
}

mkdir -p "$(dirname "$JSON")"
echo "{" >"$JSON.tmp"
first=1
for lang in en tr; do
  mkdir -p "$OUT/$lang"
  for clip in listen compare; do
    ffmpeg -loglevel error -y "${IN[@]}" -i "$SRC/$lang/$clip.ulaw" "${ENC[@]}" "$OUT/$lang/$clip.m4a"
  done
  ffmpeg -loglevel error -y \
    "${IN[@]}" -i "$SRC/$lang/question.ulaw" \
    -f lavfi -t "$GAP" -i anullsrc=r=24000:cl=mono \
    "${IN[@]}" -i "$SRC/$lang/answer.ulaw" \
    -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]" -map "[a]" \
    "${ENC[@]}" "$OUT/$lang/ask.m4a"

  echo "$lang:"
  l=$(secs "$OUT/$lang/listen.m4a"); check "$l" "$(ulaw_secs "$SRC/$lang/listen.ulaw")" listen
  c=$(secs "$OUT/$lang/compare.m4a"); check "$c" "$(ulaw_secs "$SRC/$lang/compare.ulaw")" compare
  q=$(ulaw_secs "$SRC/$lang/question.ulaw"); r=$(ulaw_secs "$SRC/$lang/answer.ulaw")
  a=$(secs "$OUT/$lang/ask.m4a"); check "$a" "$(echo "$q + $GAP + $r" | bc)" ask
  [ $first = 1 ] || echo "," >>"$JSON.tmp"
  first=0
  # askQuestionEnd: cevabın başladığı an (döküm vurgusu soru → cevap geçişi)
  printf '  "%s": { "listen": %.2f, "ask": %.2f, "compare": %.2f, "askQuestionEnd": %.2f }' \
    "$lang" "$l" "$a" "$c" "$(echo "$q + $GAP" | bc)" >>"$JSON.tmp"
done
printf '\n}\n' >>"$JSON.tmp"
mv "$JSON.tmp" "$JSON"
ls -l "$OUT"/*/*.m4a | awk '{ print "  " $5 " B  " $9 }'
