#!/usr/bin/env bash
# wonderwhy.net'i yayınlar: derler, denetler, docs/'u kaydeder ve gönderir.
# GitHub Pages bu reponun `main` dalındaki `docs/` klasörünü olduğu gibi sunar
# (Settings › Pages › Deploy from a branch › main › /docs). GitHub'da derleme
# yapılmaz; yayınlanan her dosya bu repoda.
#
#   ./publish.sh             # derle, denetle, docs/'u kaydet, gönder
#   ./publish.sh --dry-run   # derle, denetle, farkı göster; kaydetme, gönderme
#
# Repo herkese açık: bütün kayıtlar `wonderwhy <hello@wonderwhy.net>` kimliğiyle.
# Farklı kimlikli ya da metninde kişisel adres taşıyan gönderilmemiş kayıt
# varsa durur. Zorla push yapılmaz.
set -euo pipefail
cd "$(dirname "$0")"

DRY=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=true ;;
    *) echo "bilinmeyen seçenek: $arg" >&2; exit 2 ;;
  esac
done

ID="wonderwhy <hello@wonderwhy.net>"
if [ "$(git config user.name) <$(git config user.email)>" != "$ID" ]; then
  echo "Repo kimliği ayarlı değil. Bu repoda bir kez:" >&2
  echo "  git config user.name wonderwhy && git config user.email hello@wonderwhy.net" >&2
  exit 1
fi

# Yayın bir kayda karşılık gelsin: kaynak değişiklikleri önce kaydedilmiş olmalı.
if [ -n "$(git status --porcelain -- . ':(exclude)docs')" ]; then
  echo "Kaydedilmemiş kaynak değişikliği var; önce commit et:" >&2
  git status --short -- . ':(exclude)docs' >&2
  exit 1
fi

git fetch -q origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "origin/main bu kopyada yok; önce: git pull --ff-only" >&2
  exit 1
fi

node build.mjs
node check.mjs

git add -A docs
if git diff --cached --quiet; then
  echo "docs/ değişmedi."
else
  git diff --cached --stat | tail -n 12
  if $DRY; then
    git reset -q -- docs
    echo "(deneme: kaydedilmedi, gönderilmedi)"
    exit 0
  fi
  git commit -qm "Site: derleme $(date -u +%Y-%m-%d)"
fi

if [ -z "$(git rev-list origin/main..HEAD)" ]; then
  echo "Gönderilecek kayıt yok; yayındaki site güncel."
  exit 0
fi

# Gönderilecek kayıtların kimliği ve metinlerindeki adresler.
BAD=$(git log --format="%an <%ae>|%cn <%ce>" origin/main..HEAD | grep -v -x -F "$ID|$ID" || true)
MAILS=$(git log --format=%B origin/main..HEAD \
  | grep -Eo '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
  | grep -v -E '^(hello|privacy)@wonderwhy\.net$|^noreply@anthropic\.com$' || true)
if [ -n "$BAD$MAILS" ]; then
  echo "Gönderilmedi: kayıtlarda site kimliği dışında ad ya da adres var." >&2
  [ -n "$BAD" ] && echo "$BAD" >&2
  [ -n "$MAILS" ] && echo "$MAILS" >&2
  exit 1
fi

git log --oneline origin/main..HEAD
if $DRY; then
  echo "(deneme: gönderilmedi)"
  exit 0
fi
git push -q origin HEAD:main
echo "Gönderildi. Pages birkaç dakikada günceller: https://wonderwhy.net/"
echo "Sonra: node tools/crawl.mjs https://wonderwhy.net/"
