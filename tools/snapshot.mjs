// Uygulamanın onboarding içeriğinden sitenin dondurulmuş kopyasını üretir.
//
//   node tools/snapshot.mjs
//   APP_ROOT=/yol/uygulama-reposu node tools/snapshot.mjs
//
// Okur:  <uygulama>/app/assets/onboarding/{stories,stories_en,stories_world,demo}.json,
//        İspanya ve Almanya için Firestore'un herkese açık
//        `editions/{es,de}/days/{gün}/items/{id}` belgeleri (onboarding'de Almanca
//        set yok, İspanya seti 27 Eyl'den ve görsellerinin çoğu çerez koyuyor; ADR-072),
//        tools/picks.json (elle eleme, yazım düzeltmeleri, örnek haberler)
// Yazar: src/data/wall.{en,tr,es,de}.json, src/data/samples.{es,de}.json
//        (picks'te `samples` olan diller), src/data/demo.json
//
// Uygulama reposu varsayılan olarak bu reponun bir üstü: bu repo uygulama
// reposunun içindeki `website/` klasörüne klonlanıyor.
//
// Site uygulamanın dosyalarını build sırasında OKUMAZ: onboarding içeriği
// yeniden seçildiğinde sitede kendiliğinden görünmesin, gözden geçirilsin.
//
// Duvarın fotoğrafları yayıncının adresinde kalır (kopyalanmaz, telif; ADR-034,
// 24 Eki ADR-072). Her görsel tarayıcı gibi, Referer'sız istenip ölçülür;
// açılmayan, ağır ya da fotoğraf olmayan (takip pikseli, logo) atlanır.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = process.env.APP_ROOT ?? join(site, '..');
const onboarding = join(appRoot, 'app', 'assets', 'onboarding');
const out = join(site, 'src', 'data');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 2) + '\n');

const picks = read(join(site, 'tools', 'picks.json'));

// Baskı → kaynak ve metin dili (uygulamada Edition).
const EDITIONS = {
  tr: { file: 'stories.json', lang: 'tr' },
  us: { file: 'stories_en.json', lang: 'en' },
  world: { file: 'stories_world.json', lang: 'en' },
  es: { firestore: 'es', lang: 'es' },
  de: { firestore: 'de', lang: 'de' },
};
// Sayfa dili → duvarın baskıları (EN sayfada ABD ve Dünya sırayla).
const WALL = { tr: ['tr'], en: ['us', 'world'], es: ['es'], de: ['de'] };
const WALL_MAX = 24; // 3 sütun × 8 karo
const WALL_MAX_KB = 300; // duvar süs: ağır görselin haberi duvara girmez
// Duvara hiç girmeyen bölüm: siyasetçi fotoğrafı riski (ADR-034).
const WALL_SKIP_CATEGORIES = new Set(['siyaset']);
// Node'dan 200 dönüp tarayıcıda açılmayan yayıncılar (24 Eki, Chrome'da ölçüldü:
// Penske Media'nın sunucusu Referer'sız tarayıcı isteğini reddediyor).
const BLOCKED_HOSTS = new Set(['variety.com', 'deadline.com']);

// Yayıncının kendi küçük boyu (29 Eyl'de ölçüldü: variety 1606→53 KB, deadline
// 1082→21, verge 578→71, NASA 367→140, MarketWatch 825→157). Aday yalnız 200 +
// image/* dönüp gerçekten küçükse kullanılır.
const RESIZE = [
  [(u) => u.pathname.includes('/wp-content/uploads/'), (u) => u.searchParams.set('w', '640')],
  [(u) => u.host === 'assets.science.nasa.gov', (u) => { u.search = '?w=800'; }],
  [(u) => u.host === 'images.mktw.net', (u) => u.searchParams.set('width', '640')],
  // Phys.org akışı 90×90 küçük resim veriyor; aynı görselin 800×450'si ~18 KB (ölçüldü).
  [(u) => u.host === 'scx1.b-cdn.net' && u.pathname.includes('/tmb/'), (u) => { u.pathname = u.pathname.replace('/tmb/', '/800a/'); }, { upgrade: true }],
];
const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15',
  accept: 'image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5',
};

/**
 * Görseli Referer göndermeden ister: {ok, kb, status, cookie}. Çerez koyan
 * sunucunun görseli atlanır (24 Eki, Lighthouse'ta ölçüldü: Yahoo'nun
 * media.zenfs.com'u, El País'in imagenes.elpais.com'u); site çerezsiz kalmalı.
 */
async function measure(url) {
  try {
    const res = await fetch(url, { headers: BROWSER, referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) });
    const kb = Math.round((await res.arrayBuffer()).byteLength / 1024);
    const cookie = res.headers.has('set-cookie');
    return { ok: res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('image/') && !cookie, kb, status: cookie ? 'çerez koyuyor' : res.status };
  } catch (e) {
    return { ok: false, kb: 0, status: e.cause?.code ?? e.message };
  }
}

/** RSS'ten gelen `&#038;` gibi kırıntıları temizler, varsa küçük boyu seçer. */
async function bestImage(raw) {
  const original = raw.replaceAll('&#038;', '&').replaceAll('&amp;', '&');
  const base = await measure(original);
  const u = new URL(original);
  const rule = RESIZE.find(([match]) => match(u));
  if (rule) {
    const [, change, { upgrade = false } = {}] = rule;
    change(u);
    const alt = await measure(u.href);
    if (alt.ok && (upgrade || !base.ok || alt.kb < base.kb)) return { url: u.href, ...alt };
  }
  return { url: original, ...base };
}

// Firestore REST değerini düz JSON'a çevirir.
const value = (v) =>
  'stringValue' in v ? v.stringValue
  : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue
  : 'timestampValue' in v ? v.timestampValue
  : 'nullValue' in v ? null
  : 'arrayValue' in v ? (v.arrayValue.values ?? []).map(value)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, value(x)]))
  : undefined;
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/newsai-abb2d/databases/(default)/documents';
async function firestoreItems(edition, refs) {
  return Promise.all(
    refs.map(async (ref) => {
      const [day, id] = ref.split('/');
      const res = await fetch(`${FIRESTORE}/editions/${edition}/days/${day}/items/${id}`);
      if (!res.ok) throw new Error(`Firestore ${edition}/${ref}: ${res.status} (haberler 7 gün saklanıyor; picks.json'u yenile)`);
      const doc = await res.json();
      return { id, dayId: day, ...Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, value(v)])) };
    }),
  );
}

async function load(edition) {
  const e = EDITIONS[edition];
  if (e.firestore) {
    const refs = picks[edition]?.firestore ?? [];
    const items = await firestoreItems(e.firestore, refs);
    return { curatedAt: refs.map((r) => r.split('/')[0]).sort().at(-1), items };
  }
  return read(join(onboarding, e.file));
}

const sources = {};
for (const edition of Object.keys(EDITIONS)) sources[edition] = await load(edition);

const fixer = (edition) => {
  const fixes = Object.entries(picks[edition]?.fixes ?? {});
  return (s) => fixes.reduce((t, [a, b]) => t.replaceAll(a, b), s);
};

// ---------------------------------------------------------------- duvar

for (const [pageLang, editions] of Object.entries(WALL)) {
  const lists = await Promise.all(
    editions.map(async (edition) => {
      const { lang } = EDITIONS[edition];
      const { exclude = [] } = picks[edition] ?? {};
      const { items } = sources[edition];
      for (const id of exclude) {
        if (!items.some((it) => it.id === id)) throw new Error(`${edition}: ${id} kaynakta yok (picks.json › exclude)`);
      }
      const fix = fixer(edition);
      const blocked = (url) => BLOCKED_HOSTS.has(new URL(url).host.replace(/^www\./, ''));
      const candidates = items.filter(
        (it) => !exclude.includes(it.id) && !WALL_SKIP_CATEGORIES.has(it.category) && it.headline?.[lang] && !(it.imageUrl && blocked(it.imageUrl)),
      );
      const measured = await Promise.all(
        candidates.map(async (it) => ({ it, img: it.imageUrl?.startsWith('https://') ? await bestImage(it.imageUrl) : { ok: false, status: 'https değil' } })),
      );
      const kept = [];
      for (const { it, img } of measured) {
        const notPhoto = img.ok && (img.kb === 0 || /pixel|default|logo/i.test(new URL(img.url).pathname));
        if (!img.ok || img.kb > WALL_MAX_KB || notPhoto) {
          const why = !img.ok ? img.status : notPhoto ? 'haber fotoğrafı değil' : img.kb + ' KB';
          console.warn(`  atlandı ${edition} ${it.id}: görsel ${why} (${it.headline[lang].slice(0, 50)})`);
          continue;
        }
        kept.push({ id: it.id, category: it.category, headline: fix(it.headline[lang]), source: it.source, image: img.url, kb: img.kb });
      }
      return kept;
    }),
  );
  // Baskıları sırayla karıştır (ABD, Dünya, ABD…); her baskının içinde bölümlere
  // dağıt ki aynı bölüm peş peşe yığılmasın.
  const spread = (list) => {
    const byCat = new Map();
    for (const it of list) byCat.set(it.category, [...(byCat.get(it.category) ?? []), it]);
    const res = [];
    while (res.length < list.length) for (const q of byCat.values()) if (q.length) res.push(q.shift());
    return res;
  };
  const queues = lists.map(spread);
  const items = [];
  while (items.length < WALL_MAX && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && items.length < WALL_MAX) items.push(q.shift());
  }
  const curatedAt = editions.map((e) => sources[e].curatedAt).sort().at(-1);
  write(`wall.${pageLang}.json`, { curatedAt, items });
  console.log(`duvar ${pageLang}: ${items.length} haber, görseller ${items.reduce((s, it) => s + it.kb, 0)} KB`);
}

// ---------------------------------------------------------------- örnek haberler

for (const [edition, { lang }] of Object.entries(EDITIONS)) {
  const ids = picks[edition]?.samples;
  if (!ids) continue; // bu dilin örnekleri elle donduruldu (tr, en: Eylül 2026)
  const fix = fixer(edition);
  const { curatedAt, items } = sources[edition];
  write(`samples.${lang}.json`, {
    curatedAt,
    items: ids.map((id) => {
      const it = items.find((x) => x.id === id);
      if (!it) throw new Error(`${edition}: örnek ${id} kaynakta yok`);
      const text = it.scriptShort?.[lang];
      if (!text) throw new Error(`${edition}: ${id} kısa metni yok`);
      return {
        id,
        category: it.category,
        day: it.dayId,
        headline: fix(it.headline[lang]),
        text: fix(text),
        sources: [...new Set((it.sources ?? []).map((s) => s.name))],
      };
    }),
  });
  console.log(`örnekler ${lang}: ${ids.length}`);
}

// Honda tanıtımı, dört dilde; yayıncı görseli (imageUrl) alınmaz.
const demo = read(join(onboarding, 'demo.json'));
write('demo.json', { _note: demo._note, category: demo.category, tr: demo.tr, en: demo.en, es: demo.es, de: demo.de });

console.log('src/data güncellendi');
