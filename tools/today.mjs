// Bugünün gündemi (Z3, 15 Kas 2026, ADR-079): sayfa başına günün haberleri.
//
//   node tools/today.mjs            # src/data/today.{en,tr,es,de}.json
//   node tools/today.mjs --kuru     # yazmadan, ne çıkacağını basar
//
// Okur: Firestore'un herkese açık `editions/{baskı}/days/{gün}/items` belgeleri
// (uygulamanın okuduğu, kimliksiz REST; snapshot.mjs ile aynı yol).
// Yazar: dil başına bizim başlığımız, özetimizin (`scriptShort`) ilk cümlesi,
// bölüm adı ve kaynak sayısı. Kaynak metni, alıntı, görsel ve bağlantı YOK
// (kopya riski, ADR-034, ADR-050). Yalnız son gün: uygulamada da haberler
// 7 gün kalıyor, dosya her gün üzerine yazılıyor.
//
// Elenenler: `sensitive` haberler, başlığı ya da özeti o dilde olmayanlar.
// Sıra: önce çok kaynaklı haberler (aynı olayı birden çok yayın veriyor, ölçüldü:
// 15 Kas tr 244 haberin 41'i), sonra baskının sırası (`order`); bölüm başına
// en çok 3, toplam en çok 15.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(site, 'src', 'data');
const strings = (l) => JSON.parse(readFileSync(join(site, 'src', 'strings', `${l}.json`), 'utf8'));
const DRY = process.argv.includes('--kuru');

// Sayfa dili → baskı kimliği (uygulamada Edition: ABD'nin kimliği 'en').
const PAGE_EDITION = { en: 'en', tr: 'tr', es: 'es', de: 'de' };
const MAX = 15;
const MIN = 5; // bundan azsa gün henüz dolmamış: bir önceki gün
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/newsai-abb2d/databases/(default)/documents';

const value = (v) =>
  'stringValue' in v ? v.stringValue
  : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue
  : 'nullValue' in v ? null
  : 'arrayValue' in v ? (v.arrayValue.values ?? []).map(value)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, value(x)]))
  : undefined;

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function days(edition) {
  const d = await get(`${FIRESTORE}/editions/${edition}/days?pageSize=20&mask.fieldPaths=_`);
  return (d.documents ?? []).map((x) => x.name.split('/').pop()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().reverse();
}

const srcCount = (it) => Math.max(1, Array.isArray(it.sources) ? it.sources.length : 1);
const PER_CATEGORY = 3; // tek bölüm sayfayı doldurmasın

const FIELDS = ['headline', 'scriptShort', 'category', 'sources', 'order', 'sensitive'];
async function items(edition, day) {
  const mask = FIELDS.map((f) => `mask.fieldPaths=${f}`).join('&');
  const list = [];
  let token = '';
  do {
    const d = await get(`${FIRESTORE}/editions/${edition}/days/${day}/items?pageSize=300&${mask}${token && `&pageToken=${token}`}`);
    for (const doc of d.documents ?? []) list.push(Object.fromEntries(Object.entries(doc.fields ?? {}).map(([k, v]) => [k, value(v)])));
    token = d.nextPageToken ?? '';
  } while (token);
  return list;
}

/** En çok MAX haber, bölüm başına en çok PER_CATEGORY. */
function spread(all) {
  const per = {};
  const out = [];
  for (const it of all) {
    const c = it.category ?? '';
    if ((per[c] = (per[c] ?? 0) + 1) > PER_CATEGORY) continue;
    out.push(it);
    if (out.length === MAX) break;
  }
  return out;
}

/** Özetin ilk cümlesi; çok kısaysa ikincisi de. */
export function firstSentence(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const parts = clean.match(/[^.!?…]+[.!?…]+["”’)]*\s*/g) ?? [clean];
  let s = parts[0].trim();
  if (s.length < 60 && parts[1]) s = (s + ' ' + parts[1]).trim();
  return s.length > 280 ? s.slice(0, 279).trimEnd() + '…' : s;
}

for (const [lang, edition] of Object.entries(PAGE_EDITION)) {
  const cats = strings(lang).categories ?? {};
  let chosen = null;
  for (const day of (await days(edition)).slice(0, 2)) {
    const all = (await items(edition, day))
      .filter((it) => !it.sensitive && it.headline?.[lang] && it.scriptShort?.[lang])
      .sort((a, b) => srcCount(b) - srcCount(a) || (a.order ?? 999) - (b.order ?? 999));
    if (all.length >= MIN) {
      chosen = { day, all };
      break;
    }
  }
  const data = chosen
    ? {
        day: chosen.day,
        edition,
        items: spread(chosen.all).map((it) => ({
          category: cats[it.category] ?? it.category ?? '',
          headline: it.headline[lang].trim(),
          summary: firstSentence(it.scriptShort[lang]),
          sources: srcCount(it),
        })),
      }
    : { day: null, edition, items: [] };
  console.log(`${lang} (${edition}): ${data.day ?? 'yok'} · ${data.items.length} haber`);
  if (DRY) for (const it of data.items.slice(0, 3)) console.log(`   ${it.headline} — ${it.summary.slice(0, 90)}`);
  else writeFileSync(join(out, `today.${lang}.json`), JSON.stringify(data, null, 2) + '\n');
}
