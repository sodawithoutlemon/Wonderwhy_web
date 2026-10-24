// wonderwhy.net denetimi: docs üzerinde çalışır (önce build.mjs).
//
//   node check.mjs
//   node check.mjs --variants   # site.json › appFlags'in bütün birleşimlerini
//                               # geçici klasörlere derler ve her birini denetler
//
// Hata varsa 1 ile çıkar (publish.sh yayını durdurur). Yer tutucular yalnız uyarıdır.
// Bağımlılık yok: HTML'i küçük bir etiket tarayıcıyla okur; site kendi
// ürettiğimiz, düzenli bir HTML olduğu için bu yeterli.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(readFileSync(join(HERE, 'src', 'site.json'), 'utf8'));

// Hukuki metin bayrağa bağlı (build.mjs › cond): yayın günü hangi bayraklar
// açılırsa açılsın metin bozuk çıkmasın diye her birleşim derlenip denetlenir.
if (process.argv.includes('--variants')) {
  const names = Object.keys(site.appFlags);
  const root = mkdtempSync(join(tmpdir(), 'wonderwhy-variants-'));
  const failed = [];
  for (let mask = 0; mask < 1 << names.length; mask++) {
    const on = names.filter((_, i) => mask & (1 << i));
    const out = join(root, String(mask));
    const env = { ...process.env, APP_FLAGS: on.join(','), SITE_OUT: out };
    const build = spawnSync(process.execPath, [join(HERE, 'build.mjs')], { env, encoding: 'utf8' });
    const check = build.status === 0 && spawnSync(process.execPath, [join(HERE, 'check.mjs')], { env, encoding: 'utf8' });
    if (build.status !== 0 || check.status !== 0) {
      failed.push(on.join(',') || '(hepsi kapalı)');
      const log = build.status !== 0 ? build.stderr : check.stdout;
      console.log(`HATA   [${on.join(',') || 'hepsi kapalı'}]\n${log.split('\n').filter((l) => /HATA|Error/.test(l)).join('\n')}`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
  console.log(`${1 << names.length} birleşim (${names.join(', ')}): ${failed.length ? `${failed.length} hatalı` : 'hepsi temiz'}`);
  process.exit(failed.length ? 1 : 0);
}

const DIST = process.env.SITE_OUT || join(HERE, 'docs');
const ORIGIN = site.origin;
const MAX_HTML_BYTES = 80_000;
const MAX_IMAGE_BYTES = 120_000; // tek görsel (ekranlar ~30 KB AVIF, ~60–80 KB JPEG)

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
// Bir etiketin gösterdiği adresler (srcset tek adres: build.mjs › shot).
const refsOf = (t) => [t.a.href, t.a.src, t.a.srcset].filter((r) => r !== undefined);

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
  // Bayrak blokları (build.mjs › cond) iz bırakmamalı: işaret, boş öğe, düşen
  // bloğun arkasında kalan çift boşluk ya da noktalama.
  if (/<!--(?:if\b|else-->|end-->)/.test(html)) err(file, 'bayrak işareti kalmış (<!--if/else/end-->)');
  const empty = html.match(/<(li|p|td|h2|h3|strong)(?:\s[^>]*)?>\s*<\/\1>/);
  if (empty) err(file, `boş <${empty[1]}> (bayrak bloğu?)`);
  const body = (html.match(/<main[\s\S]*<\/main>/) || [''])[0].replace(/<[^>]+>/g, '');
  // Kısaltmadan sonra virgül (U.S., EE. UU.,) hata değil: büyük harften sonraki nokta atlanır.
  const loose = body.match(/[^\s] {2,}[^\s]| [.,;:)]|(?<![A-ZÄÖÜ])[.,;:]{2}|\( /);
  if (loose) err(file, `metinde boşluk ya da noktalama hatası: "${loose[0]}"`);
  // Site olduğu gibi, GitHub'ın alt yolunda da sunuluyor: iç bağlantı göreli
  // olmalı. 404 istisna (her derinlikte aynı dosya; build.mjs › notFound).
  if (file !== '/404.html') {
    const rooted = [...new Set(tags.flatMap(refsOf).filter((r) => r && /^\/(?!\/)/.test(r)))];
    if (rooted.length) err(file, `kökten başlayan bağlantı (göreli olmalı): ${rooted.slice(0, 4).join(', ')}`);
  }

  if (noindex) {
    if (canonical || Object.keys(alternates).length) err(file, 'noindex sayfada canonical/hreflang olmamalı');
  } else {
    if (!meta('description')) err(file, 'meta description yok');
    const expected = ORIGIN + urlOf(file);
    if (canonical !== expected) err(file, `canonical ${canonical} ≠ ${expected}`);
    // Her sayfa her dilde olmayabilir (KVKK yalnız en, tr): en, x-default ve kendisi şart.
    for (const hl of new Set(['en', 'x-default', pageLang])) if (!alternates[hl]) err(file, `hreflang="${hl}" yok`);
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
const externalImages = new Set(); // duvarın yayıncı fotoğrafları (crawl.mjs --images ister)
for (const [url, p] of pages) {
  for (const t of p.tags) {
    if (t.tag === 'link' && /canonical|alternate/.test(t.a.rel)) continue;
    for (const ref of refsOf(t)) {
      if (/^(mailto:|https?:)/.test(ref)) {
        if (ref.startsWith(ORIGIN)) checkInternal(p, ref.slice(ORIGIN.length));
        else if (t.tag === 'img') externalImages.add(ref);
        else external.add(ref.split('?')[0]);
        continue;
      }
      checkInternal(p, ref);
    }
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

// ---------------------------------------------------------------- görseller

// Her <img> alt (boş değil), width ve height taşır (yer ayrılır, sayfa kaymaz);
// görsel dosyaları sınırı aşmaz. Süs görseli (`data-deco`: ikon, aria-hidden
// duvarın fotoğrafları) boş alt taşır. Dış görsel (yayıncının fotoğrafı, ADR-034)
// https ve Referer'sız istenir: ziyaretçinin hangi sayfada olduğu yayıncıya gitmez.
for (const [url, p] of pages) {
  for (const t of p.tags.filter((t) => t.tag === 'img')) {
    if (!t.a.alt && !('data-deco' in t.a && t.a.alt === '')) err(p.file, `<img src="${t.a.src}"> alt yok ya da boş`);
    for (const k of ['width', 'height']) if (!/^\d+$/.test(t.a[k] ?? '')) err(p.file, `<img src="${t.a.src}"> ${k} yok`);
    if (/^(https?:)?\/\//.test(t.a.src ?? '')) {
      if (!t.a.src.startsWith('https://')) err(p.file, `dış görsel https değil: ${t.a.src}`);
      if (t.a.referrerpolicy !== 'no-referrer') err(p.file, `dış görselde referrerpolicy="no-referrer" yok: ${t.a.src}`);
    }
  }
}
for (const f of files.filter((f) => /\.(avif|jpe?g|png|webp|svg)$/.test(f))) {
  const bytes = statSync(join(DIST, f)).size;
  if (bytes > MAX_IMAGE_BYTES) err(f, `${bytes} bayt (> ${MAX_IMAGE_BYTES})`);
}

// ---------------------------------------------------------------- dil sızıntısı

// EN sayfalarında Türkçe, İspanyolca ya da Almanca harf; TR, ES ve DE
// sayfalarında İngilizce bağlaç ve zamir; ES ve DE sayfalarında Türkçeye özgü
// harf (24 Eki: dört dil). Başka dildeki parçalar lang özniteliğiyle işaretli
// olmalı (dil bağlantısı gibi).
const TR_LETTERS = /[çğıöşüÇĞİÖŞÜñÑ¿¡ßäÄ]/;
const TR_ONLY = /[ğışĞİŞ]/; // ç İspanyolcada da var (Barça)
// Özel adlar: yer adı ve yayıncının adı (site.json'dan; ör. "Yiğit Özdemir").
const EN_ALLOW = new Set(['Türkiye', ...(site.publisher.name ?? '').split(/[^\p{L}]+/u).filter(Boolean)]);
const EN_WORDS = /\b(the|and|with|your|you|this|that|are|is|of|for|to|from|when|what|how)\b/i;
const TR_ALLOW = [/Firebase[\w ]*/g, /Google[\w ]*/g, /Cloud [A-Z]\w+/g, /App (Store|Check)/g, /GitHub[\w ]*/g, /Phys\.org/g, /Android Auto/g];
for (const [url, p] of pages) {
  const words = p.text.split(/[^\p{L}]+/u);
  if (p.pageLang === 'en') {
    const bad = [...new Set(words.filter((w) => TR_LETTERS.test(w) && !EN_ALLOW.has(w)))];
    if (bad.length) err(p.file, `EN sayfada başka dil: ${bad.slice(0, 8).join(', ')}`);
    continue;
  }
  let t = p.text;
  for (const re of TR_ALLOW) t = t.replace(re, ' ');
  const bad = [...new Set(t.match(new RegExp(EN_WORDS.source, 'gi')) || [])];
  if (bad.length) err(p.file, `${p.pageLang.toUpperCase()} sayfada İngilizce: ${bad.slice(0, 8).join(', ')}`);
  if (p.pageLang !== 'tr') {
    const trBad = [...new Set(words.filter((w) => TR_ONLY.test(w) && !EN_ALLOW.has(w)))];
    if (trBad.length) err(p.file, `${p.pageLang.toUpperCase()} sayfada Türkçe: ${trBad.slice(0, 8).join(', ')}`);
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
// app-ads.txt (AdMob, IAB biçimi): varsa her satır "alan, pub-…, DIRECT|RESELLER[, kimlik]".
// AdMob dosyayı mağaza sayfasındaki geliştirici sitesinin kökünde arar.
if (fileSet.has('/app-ads.txt')) {
  const rows = readFileSync(join(DIST, 'app-ads.txt'), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  if (!rows.length) err('app-ads.txt', 'boş');
  for (const r of rows)
    if (!/^[a-z0-9.-]+\.[a-z]{2,}, pub-\d{16}, (DIRECT|RESELLER)(, [0-9a-f]+)?$/.test(r)) err('app-ads.txt', `biçim: ${r}`);
  if (!rows.some((r) => r.startsWith('google.com, pub-') && r.includes(', DIRECT, f08c47fec0942fa0')))
    err('app-ads.txt', 'AdMob satırı yok (google.com, pub-…, DIRECT, f08c47fec0942fa0)');
}

// ---------------------------------------------------------------- Universal Links / App Links

// ADR-062. Uygulama kimliği, paket ve yollar uygulamadaki `StoryLink` ile aynı
// olmalı (app/lib/links; uygulamanın sözleşme testi de bu değerleri kilitliyor).
// Yanlış bir dosya yayına girerse bağlantılar sessizce tarayıcıda açılır.
const APP_ID = '8NPLHMAKXW.com.ay.wonderwhy';
const PACKAGE = 'com.ay.wonderwhy';
const SHARE_PATHS = ['/s/', '/tr/s/'];
const readJson = (f) => {
  if (!fileSet.has(f)) return err(f, 'yok'), null;
  try {
    return JSON.parse(readFileSync(join(DIST, f), 'utf8'));
  } catch (e) {
    return err(f, `geçersiz JSON: ${e.message}`), null;
  }
};
{
  const f = '/.well-known/apple-app-site-association';
  const aasa = readJson(f);
  const details = aasa?.applinks?.details ?? [];
  if (aasa && !details.some((d) => d.appIDs?.includes(APP_ID))) err(f, `${APP_ID} yok`);
  const paths = details.flatMap((d) => (d.components ?? []).map((c) => c['/']));
  for (const p of SHARE_PATHS) if (aasa && !paths.includes(p + '*')) err(f, `${p}* yolu yok`);
  if (paths.some((p) => !SHARE_PATHS.some((s) => p === s + '*'))) err(f, `beklenmeyen yol: ${paths.join(', ')}`);
}
{
  const f = '/.well-known/assetlinks.json';
  const links = readJson(f);
  const target = Array.isArray(links) ? links.find((l) => l.target?.package_name === PACKAGE)?.target : null;
  if (links && !target) err(f, `${PACKAGE} yok`);
  const prints = target?.sha256_cert_fingerprints ?? [];
  if (target && !prints.length) err(f, 'parmak izi yok');
  for (const fp of prints) if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp)) err(f, `parmak izi biçimi: ${fp}`);
}
for (const p of SHARE_PATHS) {
  const page = pages.get(p);
  if (!page) err(p, 'paylaşım sayfası yok');
  else if (!page.noindex) err(p, 'paylaşım sayfası noindex olmalı');
}

// ---------------------------------------------------------------- rapor

const indexable = [...pages.values()].filter((p) => !p.noindex).length;
console.log(`${pages.size} sayfa (${indexable} dizinlenir), sitemap'te ${entries.length} adres`);
console.log(`dış bağlantılar: ${[...external].sort().join(', ') || 'yok'}`);
console.log(`dış görseller (yayıncı fotoğrafları): ${externalImages.size}`);
for (const w of warnings) console.log(`uyarı  ${w}`);
for (const e of errors) console.log(`HATA   ${e}`);
console.log(errors.length ? `${errors.length} hata` : 'denetim temiz');
process.exit(errors.length ? 1 : 0);
