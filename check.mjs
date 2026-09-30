// wonderwhy.net denetimi: docs üzerinde çalışır (önce build.mjs).
//
//   node check.mjs
//
// Hata varsa 1 ile çıkar (publish.sh yayını durdurur). Yer tutucular yalnız uyarıdır.
// Bağımlılık yok: HTML'i küçük bir etiket tarayıcıyla okur; site kendi
// ürettiğimiz, düzenli bir HTML olduğu için bu yeterli.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'docs');
const site = JSON.parse(readFileSync(join(HERE, 'src', 'site.json'), 'utf8'));
const ORIGIN = site.origin;
const MAX_HTML_BYTES = 80_000;

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

if (!existsSync(DIST)) {
  console.error('docs yok: önce node build.mjs');
  process.exit(1);
}

// ---------------------------------------------------------------- okuma

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = walk(DIST).map((p) => '/' + relative(DIST, p).split(sep).join('/'));
const fileSet = new Set(files);
const urlOf = (file) => file.replace(/index\.html$/, '');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k.toLowerCase(), v ?? '']));
const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Etiketleri ve "sayfanın dilindeki" görünür metni çıkarır. */
function parse(html) {
  const pageLang = (html.match(/<html[^>]*\slang="([^"]+)"/) || [])[1];
  const tags = [];
  const text = [];
  const stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let m;
  const langNow = () => (stack.length ? stack[stack.length - 1].lang : pageLang);
  const hidden = () => stack.some((s) => s.tag === 'script' || s.tag === 'style' || s.tag === 'title');
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      if (!hidden() && langNow() === pageLang) text.push(decode(m[4]));
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((s) => s.tag).lastIndexOf(tag);
      if (i >= 0) stack.length = i;
      continue;
    }
    const a = attrs(m[3]);
    tags.push({ tag, a, lang: a.lang || langNow() });
    if (a['aria-label'] && (a.lang || langNow()) === pageLang) text.push(' ' + decode(a['aria-label']) + ' ');
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push({ tag, lang: a.lang || langNow() });
    if (tag === 'script' || tag === 'style') {
      // İçeriği atla.
      const end = html.indexOf(`</${tag}>`, re.lastIndex);
      re.lastIndex = end < 0 ? html.length : end;
    }
  }
  return { pageLang, tags, text: text.join(' ').replace(/\s+/g, ' ') };
}

// ---------------------------------------------------------------- sayfalar

const pages = new Map(); // url -> bilgi
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(DIST, file), 'utf8');
  const { pageLang, tags, text } = parse(html);
  const meta = (name) => tags.find((t) => t.tag === 'meta' && t.a.name === name)?.a.content;
  const noindex = /noindex/.test(meta('robots') || '');
  const canonical = tags.find((t) => t.tag === 'link' && t.a.rel === 'canonical')?.a.href;
  const alternates = Object.fromEntries(
    tags.filter((t) => t.tag === 'link' && t.a.rel === 'alternate' && t.a.hreflang).map((t) => [t.a.hreflang, t.a.href]),
  );
  const ids = tags.map((t) => t.a.id).filter(Boolean);
  pages.set(urlOf(file), { file, html, pageLang, tags, text, noindex, canonical, alternates, ids });

  if (!pageLang) err(file, '<html lang> yok');
  if (!/<title>[^<]+<\/title>/.test(html)) err(file, '<title> yok ya da boş');
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) err(file, `tekrarlanan id: ${[...new Set(dup)].join(', ')}`);
  const h1 = tags.filter((t) => t.tag === 'h1').length;
  if (h1 !== 1) err(file, `${h1} tane h1 var (1 olmalı)`);
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) err(file, `${Buffer.byteLength(html)} bayt (> ${MAX_HTML_BYTES})`);
  const todos = (html.match(/class="todo"/g) || []).length;
  if (todos) warn(file, `${todos} yer tutucu (site.json'da doldur)`);
  // Site olduğu gibi, GitHub'ın alt yolunda da sunuluyor: iç bağlantı göreli
  // olmalı. 404 istisna (her derinlikte aynı dosya; build.mjs › notFound).
  if (file !== '/404.html') {
    const rooted = [...new Set(tags.map((t) => t.a.href ?? t.a.src).filter((r) => r && /^\/(?!\/)/.test(r)))];
    if (rooted.length) err(file, `kökten başlayan bağlantı (göreli olmalı): ${rooted.slice(0, 4).join(', ')}`);
  }

  if (noindex) {
    if (canonical || Object.keys(alternates).length) err(file, 'noindex sayfada canonical/hreflang olmamalı');
  } else {
    if (!meta('description')) err(file, 'meta description yok');
    const expected = ORIGIN + urlOf(file);
    if (canonical !== expected) err(file, `canonical ${canonical} ≠ ${expected}`);
    for (const hl of ['en', 'tr', 'x-default']) if (!alternates[hl]) err(file, `hreflang="${hl}" yok`);
    if (alternates[pageLang] !== expected) err(file, `kendi dilinin hreflang'ı kendisini göstermiyor`);
    if (alternates['x-default'] !== alternates.en) err(file, 'x-default EN sürümü olmalı');
  }
}

// hreflang karşılıklılığı: her alternatif aynı kümeyi geri göstermeli.
for (const [url, p] of pages) {
  if (p.noindex) continue;
  for (const [hl, href] of Object.entries(p.alternates)) {
    const target = pages.get(href.replace(ORIGIN, ''));
    if (!target) {
      err(p.file, `hreflang ${hl} → ${href} sayfası yok`);
      continue;
    }
    if (JSON.stringify(sortObj(target.alternates)) !== JSON.stringify(sortObj(p.alternates)))
      err(p.file, `hreflang kümesi ${href} ile aynı değil`);
  }
}
function sortObj(o) {
  return Object.fromEntries(Object.entries(o).sort());
}

// ---------------------------------------------------------------- bağlantılar

const external = new Set();
for (const [url, p] of pages) {
  for (const t of p.tags) {
    const ref = t.a.href ?? t.a.src;
    if (ref === undefined || t.tag === 'link' && /canonical|alternate/.test(t.a.rel)) continue;
    if (/^(mailto:|https?:)/.test(ref)) {
      if (ref.startsWith(ORIGIN)) checkInternal(p, ref.slice(ORIGIN.length));
      else external.add(ref.split('?')[0]);
      continue;
    }
    checkInternal(p, ref);
  }
}
function checkInternal(p, ref) {
  const [pathPart, hash] = ref.split('#');
  let path = pathPart === '' ? urlOf(p.file) : pathPart;
  if (!path.startsWith('/')) path = new URL(path, 'https://x' + urlOf(p.file)).pathname;
  const file = path.endsWith('/') ? path + 'index.html' : path;
  if (!fileSet.has(file)) return err(p.file, `kırık bağlantı: ${ref}`);
  if (hash) {
    const target = pages.get(urlOf(file));
    if (target && !target.ids.includes(hash)) err(p.file, `kırık çapa: ${ref}`);
  }
}

// ---------------------------------------------------------------- dil sızıntısı

// EN sayfalarında Türkçe harf; TR sayfalarında İngilizce bağlaç ve zamir.
// Başka dildeki parçalar lang özniteliğiyle işaretli olmalı (dil bağlantısı gibi).
const TR_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
// Özel adlar: yer adı ve yayıncının adı (site.json'dan; ör. "Yiğit Özdemir").
const EN_ALLOW = new Set(['Türkiye', ...(site.publisher.name ?? '').split(/[^\p{L}]+/u).filter(Boolean)]);
const EN_WORDS = /\b(the|and|with|your|you|this|that|are|is|of|for|to|from|when|what|how)\b/i;
const TR_ALLOW = [/Firebase[\w ]*/g, /Google[\w ]*/g, /Cloud [A-Z]\w+/g, /App (Store|Check)/g, /GitHub[\w ]*/g, /Phys\.org/g];
for (const [url, p] of pages) {
  if (p.pageLang === 'en') {
    const bad = [...new Set(p.text.split(/[^\p{L}]+/u).filter((w) => TR_LETTERS.test(w) && !EN_ALLOW.has(w)))];
    if (bad.length) err(p.file, `EN sayfada Türkçe: ${bad.slice(0, 8).join(', ')}`);
  } else if (p.pageLang === 'tr') {
    let t = p.text;
    for (const re of TR_ALLOW) t = t.replace(re, ' ');
    const bad = [...new Set(t.match(new RegExp(EN_WORDS.source, 'gi')) || [])];
    if (bad.length) err(p.file, `TR sayfada İngilizce: ${bad.slice(0, 8).join(', ')}`);
  }
}

// ---------------------------------------------------------------- sitemap, robots, CNAME

const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => ({
  loc: body.match(/<loc>([^<]+)<\/loc>/)[1],
  alts: Object.fromEntries([...body.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map(([, h, u]) => [h, u])),
}));
const inSitemap = new Set(entries.map((e) => e.loc));
for (const e of entries) {
  const p = pages.get(e.loc.replace(ORIGIN, ''));
  if (!p) err('sitemap.xml', `${e.loc} sayfası yok`);
  else if (p.noindex) err('sitemap.xml', `${e.loc} noindex ama sitemap'te`);
  else if (JSON.stringify(sortObj(e.alts)) !== JSON.stringify(sortObj(p.alternates)))
    err('sitemap.xml', `${e.loc} alternatifleri sayfadaki hreflang ile aynı değil`);
}
for (const [url, p] of pages) if (!p.noindex && !inSitemap.has(ORIGIN + url)) err('sitemap.xml', `${url} eksik`);

const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
if (!robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`)) err('robots.txt', 'Sitemap satırı yok');
if (/Disallow:\s*\/\S/.test(robots)) warn('robots.txt', 'Disallow var: noindex sayfaların taranabilmesi gerekir');
// CNAME her zaman: düşerse Pages alan adını bırakır (site github.io'ya döner).
{
  const cname = fileSet.has('/CNAME') ? readFileSync(join(DIST, 'CNAME'), 'utf8').trim() : '(yok)';
  if (cname !== new URL(ORIGIN).host) err('CNAME', `${cname} ≠ ${new URL(ORIGIN).host}`);
}
if (!fileSet.has('/.nojekyll')) err('.nojekyll', 'yok');

// ---------------------------------------------------------------- rapor

const indexable = [...pages.values()].filter((p) => !p.noindex).length;
console.log(`${pages.size} sayfa (${indexable} dizinlenir), sitemap'te ${entries.length} adres`);
console.log(`dış bağlantılar: ${[...external].sort().join(', ') || 'yok'}`);
for (const w of warnings) console.log(`uyarı  ${w}`);
for (const e of errors) console.log(`HATA   ${e}`);
console.log(errors.length ? `${errors.length} hata` : 'denetim temiz');
process.exit(errors.length ? 1 : 0);
