// wonderwhy.net üreticisi: src → docs. Bağımlılık yok (Node 22).
//
//   node build.mjs
//   FORCE_REDUCED_MOTION=1 node build.mjs   # hareket azaltmayı dene
//   APP_FLAGS=WONDERWHY_ADS,WONDERWHY_PREMIUM SITE_OUT=/tmp/x node build.mjs
//     # başka bayraklarla, başka klasöre (check.mjs --variants böyle çağırır)
//
// Tek ayar dosyası src/site.json; metinler src/strings/{en,tr,es,de}.json; hukuki
// metinler src/content/{dil}/*.html. Ayrıntı: docs/14-WEB-SITESI.md.
//
// Çıktı olduğu gibi yayınlanır (GitHub Pages, derlemesiz): iç bağlantılar
// göreli yazılır ki site hem wonderwhy.net'te hem GitHub'ın alt yolunda
// (sodawithoutlemon.github.io/Wonderwhy_web/) çalışsın. Yayın: publish.sh.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src');
// GitHub Pages bu reponun `main` dalındaki `docs/` klasörünü olduğu gibi sunar.
const DIST = process.env.SITE_OUT || join(HERE, 'docs');
const read = (p) => readFileSync(join(SRC, p), 'utf8');
const json = (p) => JSON.parse(read(p));

// Dört dil (24 Eki, ADR-072): uygulamanın arayüz dilleri. İlk dil x-default.
const LANGS = ['en', 'tr', 'es', 'de'];
const site = json('site.json');

// ---------------------------------------------------------------- uygulama bayrakları
//
// Hukuki metin uygulamanın o sürümde açık olan özelliklerini anlatır (ADR-062,
// 2.0.0 eki). `site.json › appFlags` uygulamanın bayrak adlarını taşır
// (`app/lib/config/feature_flags.dart`); yayın günü sürümde açılanlar `true`
// olur. Metinlerde (content/*.html ve strings/*.json değerleri):
//
//   <!--if WONDERWHY_ADS-->…<!--else-->…<!--end-->
//   <!--if !WONDERWHY_ADS-->…<!--end-->            (tersi)
//   <!--if WONDERWHY_ANALYTICS|WONDERWHY_CRASH_REPORTS-->…<!--end-->  (biri yeter)
//   <!--if WONDERWHY_ADS&WONDERWHY_PREMIUM-->…<!--end-->               (ikisi de; & önce)
//
// Bloklar iç içe olabilir. Kendi satırında duran işaret satırıyla birlikte düşer;
// satır içindekinde boşluğu bloğun içine yaz. Bilinmeyen bayrak ve kapanmamış
// blok derlemeyi durdurur. APP_FLAGS (virgüllü ad listesi) site.json'u ezer.
const FLAG_NAMES = Object.keys(site.appFlags);
const flags =
  process.env.APP_FLAGS === undefined
    ? site.appFlags
    : (() => {
        const on = process.env.APP_FLAGS.split(',').map((s) => s.trim()).filter(Boolean);
        for (const n of on) if (!FLAG_NAMES.includes(n)) throw new Error(`APP_FLAGS: bilinmeyen bayrak ${n}`);
        return Object.fromEntries(FLAG_NAMES.map((n) => [n, on.includes(n)]));
      })();
const COND = /<!--(?:if\s+([^>]*?)|(else)|(end))-->/g;
function flagExpr(expr, where) {
  return expr.split('|').some((all) =>
    all.split('&').every((term) => {
      const t = term.trim();
      const name = t.replace(/^!/, '');
      if (!FLAG_NAMES.includes(name)) throw new Error(`${where}: bilinmeyen bayrak "${name}" (site.json › appFlags)`);
      return t.startsWith('!') ? !flags[name] : flags[name];
    }),
  );
}
function cond(text, where) {
  let out = '';
  let at = 0;
  const open = []; // { on, inElse }; dıştan içe
  const shown = () => open.every((b) => b.on !== b.inElse);
  for (const m of text.matchAll(COND)) {
    let start = m.index;
    let end = start + m[0].length;
    // Kendi satırındaki işaret, satır sonuyla birlikte düşer.
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    if (lineStart >= at && /^[ \t]*$/.test(text.slice(lineStart, start)) && text[end] === '\n') {
      start = lineStart;
      end += 1;
    }
    if (shown()) out += text.slice(at, start);
    at = end;
    const top = open[open.length - 1];
    if (m[1] !== undefined) open.push({ on: flagExpr(m[1], where), inElse: false });
    else if (m[2]) {
      if (!top || top.inElse) throw new Error(`${where}: <!--if--> olmadan <!--else-->`);
      top.inElse = true;
    } else {
      if (!top) throw new Error(`${where}: <!--if--> olmadan <!--end-->`);
      open.pop();
    }
  }
  if (open.length) throw new Error(`${where}: kapanmamış <!--if-->`);
  return out + text.slice(at);
}
// strings/*.json'daki her metin değerine (bloklar tek bir değerin içinde kalır).
const condDeep = (v, where) =>
  typeof v === 'string'
    ? cond(v, where)
    : Array.isArray(v)
      ? v.map((x, i) => condDeep(x, `${where}[${i}]`))
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, condDeep(x, `${where}.${k}`)]))
        : v;

const S = Object.fromEntries(LANGS.map((l) => [l, condDeep(json(`strings/${l}.json`), `strings/${l}.json`)]));
const demo = json('data/demo.json');
const audio = json('data/audio.json');
const wall = Object.fromEntries(LANGS.map((l) => [l, json(`data/wall.${l}.json`)]));
const samples = Object.fromEntries(LANGS.map((l) => [l, json(`data/samples.${l}.json`)]));
const gallery = json('data/gallery.json'); // tools/gallery.sh

// Sayfa takımları: dil menüsü, hreflang ve sitemap hep buradan. Sonda "/" var.
// Bir sayfanın her dilde olması gerekmez (KVKK yalnız en ve tr).
const PAGES = {
  home: { en: '/', tr: '/tr/', es: '/es/', de: '/de/' },
  privacy: { en: '/privacy/', tr: '/tr/gizlilik/', es: '/es/privacidad/', de: '/de/datenschutz/' },
  terms: { en: '/terms/', tr: '/tr/kullanim-sartlari/', es: '/es/condiciones/', de: '/de/nutzungsbedingungen/' },
  support: { en: '/support/', tr: '/tr/destek/', es: '/es/soporte/', de: '/de/hilfe/' },
  // Hesap silme (Google Play Data safety bu adresi istiyor; ADR-043).
  deleteAccount: { en: '/delete-account/', tr: '/tr/hesap-silme/', es: '/es/eliminar-cuenta/', de: '/de/konto-loeschen/' },
  // Konu sayfası (Y3, 20 Eki): "compare news sources" / "haber kaynaklarını karşılaştırma".
  compare: {
    en: '/compare-news-sources/',
    tr: '/tr/kaynak-karsilastirma/',
    es: '/es/comparar-fuentes-de-noticias/',
    de: '/de/nachrichtenquellen-vergleichen/',
  },
  // KVKK md. 10 aydınlatma metni (Y3, 20 Eki): gizlilik politikasının KVKK düzenindeki özeti.
  kvkk: { en: '/kvkk-notice/', tr: '/tr/kvkk/' },
};
/** Sayfanın bulunduğu diller, LANGS sırasıyla. */
const langsOf = (key) => LANGS.filter((l) => PAGES[key][l]);
/** Sayfa o dilde yoksa İngilizcesi (ör. KVKK'ya İspanyolca politikadan bağlantı). */
const pageUrl = (key, lang) => PAGES[key][lang] ?? PAGES[key].en;
// İçeriği `content/{dil}/{anahtar}.html`'den gelen hukuki sayfalar.
const LEGAL_PAGES = ['privacy', 'terms', 'deleteAccount', 'kvkk'];
// Uygulamanın açtığı, dile bağlı olmayan adresler (LegalLinks). noindex.
const LEGAL_REDIRECTS = { '/legal/privacy/': 'privacy', '/legal/terms/': 'terms' };
// Uygulamanın paylaştığı haber bağlantısı (ADR-062): `/s/?e=<baskı>&d=<gün>&id=<haber>`.
// Uygulama yüklüyse iOS (apple-app-site-association) ve Android (assetlinks.json)
// haberi uygulamada açar; değilse bu durağan sayfa. noindex, sitemap'te yok.
// Yol ve sorgu uygulamadaki `StoryLink` ile aynı olmalı (app/lib/links).
const SHARE_PAGES = { en: '/s/', tr: '/tr/s/' };

const abs = (path) => site.origin + path;

/**
 * Kökten yolu (`/tr/gizlilik/#silme`) `pageUrl` sayfasından göreli yapar
 * (`../gizlilik/#silme`). Kökten yol yalnız alan adının kökünde çalışır;
 * göreli yol her taban adreste.
 */
function relTo(pageUrl, target) {
  const [, path, rest] = target.match(/^([^?#]*)(.*)$/);
  const fromDir = pageUrl.endsWith('/') ? pageUrl : posix.dirname(pageUrl) + '/';
  let rel = posix.relative(fromDir, path || '/');
  if (rel && path.endsWith('/')) rel += '/';
  return (rel || './') + rest;
}
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const lines = (s) => esc(s).replace(/\n/g, '<br>');
const plural = (lang, forms, n) =>
  fill(forms[new Intl.PluralRules(S[lang].locale).select(n)] ?? forms.other, { n });
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const dateText = (iso, lang) =>
  new Intl.DateTimeFormat(S[lang].locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso + 'T00:00:00Z'),
  );

/** Değer yoksa görünür yer tutucu (check.mjs `class="todo"` arar). */
const orTodo = (value, lang, key) => (value ? esc(value) : `<span class="todo">${esc(S[lang].placeholder[key])}</span>`);

// GÖREV 3'ün dosyaları gelince static/brand altına kopyalanır; varsa kullanılır.
const brandDir = join(SRC, 'static', 'brand');
const brand = new Set(existsSync(brandDir) ? readdirSync(brandDir) : []);
const ogImage = (lang) => [`og-${lang}.png`, 'og.png'].find((f) => brand.has(f));

let css = read('styles.css')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s*\n\s*/g, '\n')
  .replace(/\n+/g, '\n')
  .trim();
if (process.env.FORCE_REDUCED_MOTION) css = css.replace('@media (prefers-reduced-motion: reduce)', '@media all');

const icon = {
  play: '<svg class="i-play" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M5 2.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2A.8.8 0 0 0 5 2.8Z" fill="currentColor"/></svg>',
  pause: '<svg class="i-pause" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><rect x="3.5" y="2.5" width="4" height="13" rx="1.2" fill="currentColor"/><rect x="10.5" y="2.5" width="4" height="13" rx="1.2" fill="currentColor"/></svg>',
  mic: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="6.5" y="1.5" width="7" height="11" rx="3.5" fill="currentColor"/><path d="M3.8 9.5a6.2 6.2 0 0 0 12.4 0M10 15.7v2.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
};

// ---------------------------------------------------------------- iskelet

function head(lang, { title, description, page = null, noindex = false, jsonld = null, ogUrl = null }) {
  const t = S[lang];
  const tags = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(title)}</title>`,
  ];
  if (description) tags.push(`<meta name="description" content="${esc(description)}">`);
  if (noindex) tags.push('<meta name="robots" content="noindex">');
  // Paylaşım önizlemesi: dizinlenen sayfalarda canonical + hreflang ile; /s/
  // gibi noindex sayfalarda (ogUrl) yalnız og kartı.
  const url = page ? abs(PAGES[page][lang]) : ogUrl;
  if (page) {
    tags.push(`<link rel="canonical" href="${url}">`);
    for (const l of langsOf(page)) tags.push(`<link rel="alternate" hreflang="${l}" href="${abs(PAGES[page][l])}">`);
    tags.push(`<link rel="alternate" hreflang="x-default" href="${abs(PAGES[page].en)}">`);
  }
  if (url) {
    const og = ogImage(lang);
    tags.push(
      '<meta property="og:type" content="website">',
      `<meta property="og:site_name" content="${esc(site.brand)}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta property="og:locale" content="${t.ogLocale}">`,
      ...(page ? langsOf(page) : LANGS).filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${S[l].ogLocale}">`),
    );
    if (og) {
      tags.push(
        `<meta property="og:image" content="${abs('/brand/' + og)}">`,
        `<meta property="og:image:alt" content="${esc(title)}">`,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image">',
      );
    } else {
      tags.push('<meta name="twitter:card" content="summary">');
    }
  }
  tags.push(
    '<meta name="theme-color" content="#000000">',
    '<meta name="color-scheme" content="dark">',
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    '<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">',
  );
  if (brand.has('favicon.ico')) tags.push('<link rel="icon" href="/brand/favicon.ico" sizes="32x32">');
  if (brand.has('apple-touch-icon.png')) tags.push('<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">');
  tags.push('<link rel="manifest" href="/site.webmanifest">');
  if (site.stores.appStoreId) tags.push(`<meta name="apple-itunes-app" content="app-id=${esc(site.stores.appStoreId)}">`);
  if (jsonld) tags.push(`<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`);
  tags.push(
    '<script>document.documentElement.classList.add("js")</script>',
    `<script type="application/json" id="lang-hint">${JSON.stringify(Object.fromEntries(LANGS.map((l) => [l, S[l].hint])))}</script>`,
    `<style>${css}</style>`,
    '<script src="/site.js" defer></script>',
  );
  return tags.join('\n');
}

// Uygulama ikonu (S6, ADR-049): siyah karede dinleyen soru. Üst çubukta, ana
// sayfanın girişinde ve İndir'de; çevresini CSS çizer (siyah zeminde görünsün).
const appIcon = (size, cls = 'app-icon') =>
  `<img class="${cls}" src="/brand/icon-512.png" alt="" width="${size}" height="${size}" data-deco>`;

/** Sayfanın diğer dillerdeki sürümleri: `<a hreflang lang>` listesi. */
const langLinks = (lang, page) =>
  langsOf(page)
    .filter((l) => l !== lang)
    .map((l) => `<a href="${PAGES[page][l]}" hreflang="${l}" lang="${l}">${esc(S[l].langName)}</a>`);

function header(lang, page) {
  const t = S[lang];
  // Dil menüsü (24 Eki): dört dil; JS'siz çalışan <details>.
  const menu = page
    ? `<details class="lang-menu"><summary aria-label="${esc(t.nav.language)}: ${esc(t.langName)}">${esc(t.langName)}</summary><ul>${langLinks(lang, page)
        .map((a) => `<li>${a.replace('<a ', '<a class="lang-link" ')}</li>`)
        .join('')}</ul></details>`
    : '';
  return `<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="top"><div class="wrap">
<a class="wordmark" href="${PAGES.home[lang]}">${appIcon(28, 'mark')}<span>${esc(site.brand)}</span></a>
${menu}
</div></header>`;
}

function footer(lang, page) {
  const t = S[lang];
  const link = (p) => `<li><a href="${PAGES[p][lang]}">${esc(t.nav[p])}</a></li>`;
  const note = site.stores.appStore || site.stores.googlePlay ? '' : ` · ${esc(t.footer.notYet)}`;
  const langs = langLinks(lang, page).map((a) => `<li>${a}</li>`).join('');
  return `<footer class="foot"><div class="wrap">
<nav aria-label="${esc(t.footer.legal)}"><ul>${link('home')}${link('compare')}${link('privacy')}${link('terms')}${link('support')}</ul></nav>
<nav aria-label="${esc(t.footer.languages)}"><ul class="foot-langs">${langs}</ul></nav>
<p class="footnote">© ${site.year} ${esc(site.brand)}${note}</p>
${hasBadges() ? `<p class="footnote">${esc(t.footer.trademarks)}</p>\n` : ''}</div></footer>`;
}

function page(lang, { page: key, title, description, noindex, jsonld, body }) {
  return `<!doctype html>
<html lang="${lang}" dir="ltr">
<head>
${head(lang, { title, description, page: key, noindex, jsonld })}
</head>
<body>
${header(lang, key)}
${body}
${key ? footer(lang, key) : ''}
</body>
</html>
`;
}

// ---------------------------------------------------------------- ana sayfa

// Kayan haber duvarı (24 Eki, ADR-072; kullanıcı: "kayan haberlerde resim yok,
// bu kadar büyük olmasına gerek yok, kayan haber solda, bilgi sağda"). Geniş
// ekranda girişin solunda, telefonda yazının altında; düz, fotoğraflı küçük
// karolar. Fotoğraflar yayıncının adresinden, Referer'sız (kopya yok, ADR-034);
// açılmazsa karonun zemini ve yazısı kalır. Her manşet HTML'de bir kez; kesintisiz
// kayma (-50%) için izin ikinci kopyasını site.js üretir.
const SPEEDS = [12, 16, 14]; // px/sn; welcome.dart 10/15/12'ye yakın, biraz canlı
const TILE_PITCH = 196; // ortalama karo yüksekliği + 10 aralık (süre hesabı için)

function wallHtml(lang) {
  const items = wall[lang].items;
  const cols = [0, 1, 2].map((c) => items.filter((_, i) => i % 3 === c));
  const tile = (it) =>
    `<div class="tile"><img src="${esc(it.image)}" alt="" width="320" height="200" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" data-deco><div class="tile-text"><p class="tile-cat">${esc(S[lang].categories[it.category])}</p><p class="tile-head">${esc(it.headline)}</p></div></div>`;
  const dur = (n, c) => ((n * TILE_PITCH) / SPEEDS[c]).toFixed(1);
  return cols
    .map((col, c) => `<div class="wall-col"><div class="wall-track" style="--dur:${dur(col.length, c)}s">${col.map(tile).join('')}</div></div>`)
    .join('\n');
}

/**
 * Mağaza adresi, sayfanın kampanya adıyla (Y3, 20 Eki; site ASO'ya köprü).
 * App Store: `pt` (sağlayıcı) + `ct` App Store Connect › App Analytics ›
 * Kampanyalar'da görünür; `pt` yoksa adres yalın kalır. Play: `referrer`
 * UTM'si Play Console'un edinme raporunda. Kişisel veri yok, sitede dış istek
 * yok. Smart App Banner, JSON-LD ve manifest yalın adresi kullanır.
 */
function storeUrl(store, campaign) {
  const url = site.stores[store];
  if (!url || !campaign) return url;
  const u = new URL(url);
  if (store === 'appStore') {
    if (!site.stores.appStoreProvider) return url;
    u.searchParams.set('pt', site.stores.appStoreProvider);
    u.searchParams.set('ct', campaign);
    u.searchParams.set('mt', '8');
  } else {
    u.searchParams.set('referrer', `utm_source=${new URL(site.origin).host}&utm_medium=site&utm_campaign=${campaign}`);
  }
  return u.toString();
}

// Resmî mağaza rozetleri (Apple Marketing Tools, Google Play badges), dile göre;
// dosya yoksa metin düğme. Ölçüler dosyanın kendisinden (width/height, CLS yok).
const badgeDir = join(SRC, 'static', 'badges');
const badges = new Set(existsSync(badgeDir) ? readdirSync(badgeDir) : []);
function imageSize(file) {
  const buf = readFileSync(file);
  if (file.endsWith('.png')) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  const vb = buf.toString('utf8').match(/viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/);
  return { w: Math.round(+vb[1]), h: Math.round(+vb[2]) };
}
const BADGES = {
  appStore: (lang) => `app-store-${lang}.svg`,
  googlePlay: (lang) => `google-play-${lang}.png`,
};

function storeButtons(lang, campaign) {
  const t = S[lang].download;
  const one = (store) => {
    const name = t[store];
    const url = storeUrl(store, campaign);
    if (!url) return `<span class="pill-soon">${esc(name)} <span class="soon">${esc(t.soon)}</span></span>`;
    const file = BADGES[store](lang);
    if (!badges.has(file)) return `<a class="btn btn-primary" href="${esc(url)}">${esc(name)}</a>`;
    const { w, h } = imageSize(join(badgeDir, file));
    return `<a class="badge badge-${store}" href="${esc(url)}"><img src="/badges/${file}" alt="${esc(name)}" width="${w}" height="${h}"></a>`;
  };
  // Erişilebilir ad rozetlerin resmî ifadesi (SEO: "App Store"dan daha açıklayıcı, 3 Eki).
  return `<div class="stores">${one('appStore')}${one('googlePlay')}</div>`;
}
const hasBadges = () => LANGS.some((l) => Object.values(BADGES).some((f) => badges.has(f(l))));

function player(lang, clip, stepTitle) {
  const t = S[lang].player;
  const sec = audio[lang][clip];
  const playLabel = `${t.play}: ${stepTitle}, ${mmss(sec)}`;
  const pauseLabel = `${t.pause}: ${stepTitle}`;
  return `<div class="player" data-player>
<button class="play" type="button" aria-label="${esc(playLabel)}" data-play-label="${esc(playLabel)}" data-pause-label="${esc(pauseLabel)}">${icon.play}${icon.pause}</button>
<span class="wave" aria-hidden="true">${'<i></i>'.repeat(9)}</span>
<span class="dur" aria-hidden="true">${mmss(sec)}</span>
<audio controls preload="none" src="/audio/${lang}/${clip}.m4a"></audio>
</div>`;
}

// Mağaza görselleri (24 Eki, ADR-072; tools/gallery.sh): App Store'un iPhone 6,9"
// seti olduğu gibi, başlık yazısıyla; kurgusal içerik (ADR-057). AVIF, yoksa JPEG.
// Kareler ve sıra gallery.json'dan; mağaza seti değişince betik yeniden çalışır.
const shotUrl = (lang, id, ext) => `/gallery/${lang}/${id}.${ext}`;
const shot = (lang, id, { eager = false } = {}) => `<picture class="shot">
<source type="image/avif" srcset="${shotUrl(lang, id, 'avif')}">
<img src="${shotUrl(lang, id, 'jpg')}" alt="${esc(S[lang].gallery.items[id])}" width="${gallery.width}" height="${gallery.height}"${eager ? '' : ' loading="lazy"'} decoding="async">
</picture>`;

function galleryHtml(lang) {
  const g = S[lang].gallery;
  const items = gallery.items.map((id) => `<li>${shot(lang, id)}</li>`).join('\n');
  return `<section id="screens" class="screens" aria-labelledby="screens-title"><div class="wrap">
<div class="section-head reveal"><p class="kicker">${esc(g.kicker)}</p><h2 id="screens-title" class="title1">${esc(g.title)}</h2></div>
</div>
<section class="gallery" aria-label="${esc(g.label)}" tabindex="0"><ul>
${items}
</ul></section>
<div class="wrap"><p class="footnote">${esc(g.note)}</p></div>
</section>`;
}

const seg = (tag, cls, start, end, html) =>
  `<${tag} class="${cls}" data-seg data-start="${start}" data-end="${end}">${html}</${tag}>`;

function howHtml(lang) {
  const t = S[lang];
  const h = t.how;
  const d = demo[lang];
  const a = audio[lang];
  const tagSample = `<span class="sample-tag">${esc(t.sample)}</span>`;
  const qEnd = (a.askQuestionEnd - 0.35).toFixed(2);
  // Kıyasla adımı konu sayfasına bağlanır (iç bağlantı, Y3).
  const more = (id) => (h[id].more ? ` <a href="${PAGES.compare[lang]}">${esc(h[id].more)}</a>` : '');
  const step = (i, id, title, body, card) => `<article class="step reveal" style="--i:${i}" aria-labelledby="step-${id}">
<div class="step-head"><h3 id="step-${id}" class="title3"><span class="step-no">${i + 1}</span>${esc(title)}</h3><p class="subhead">${esc(body)}${more(id)}</p></div>
<div class="card">${tagSample}
${card}
</div>
</article>`;
  const listen = `<p class="kicker">${esc(d.kicker)}</p>
<p class="headline">${esc(d.headline)}</p>
${player(lang, 'listen', h.listen.title)}
<div class="transcript" data-transcript><p class="kicker label">${esc(t.player.transcript)}</p>
${seg('p', 'callout', 0, a.listen, esc(d.listen))}</div>`;
  const ask = `${player(lang, 'ask', h.ask.title)}
<div class="transcript" data-transcript><p class="kicker label">${esc(t.player.transcript)}</p>
<div class="ask-row"><span class="mic" aria-hidden="true">${icon.mic}</span>${seg('p', 'bubble', 0, qEnd, `<span class="vh">${esc(h.ask.question)}: </span>${esc(d.question)}`)}</div>
${seg('p', 'subhead', a.askQuestionEnd, a.ask, `<span class="vh">${esc(h.ask.answer)}: </span>${esc(d.answer)}`)}</div>`;
  const src = (n, name, text) =>
    `<div class="src-row"><span class="src-no" aria-hidden="true">${n}</span><p class="kicker">${esc(name)}</p><p class="subhead">“${esc(text)}”</p></div>`;
  const compare = `${src(1, d.source1, d.frame1)}
${src(2, d.source2, d.frame2)}
<div class="tag"><p class="headline">${esc(d.frameTag)}</p><p class="footnote">${esc(d.frameNote)}</p></div>
<hr class="hair">
<p class="footnote">${esc(d.conflictQuestion)}</p>
<div class="claims"><div><p class="footnote">${esc(d.source1)}</p><p class="val">${esc(d.conflict1)}</p></div><div><p class="footnote">${esc(d.source2)}</p><p class="val">${esc(d.conflict2)}</p></div></div>
<div class="tag danger"><p class="headline">${esc(d.conflictTag)}</p></div>
${player(lang, 'compare', h.compare.title)}
<div class="transcript" data-transcript><p class="kicker label">${esc(h.compare.spoken)}</p>
${seg('p', 'subhead', 0, a.compare, esc(d.compareSpoken))}</div>`;
  return `<section id="how" aria-labelledby="how-title"><div class="wrap">
<div class="section-head reveal"><p class="kicker">${esc(h.kicker)}</p><h2 id="how-title" class="title1">${esc(h.title)}</h2><p class="lead">${esc(h.lead)}</p></div>
<div class="steps">
${step(0, 'listen', h.listen.title, h.listen.body, listen)}
${step(1, 'ask', h.ask.title, h.ask.body, ask)}
${step(2, 'compare', h.compare.title, h.compare.body, compare)}
</div>
</div></section>`;
}

function samplesHtml(lang) {
  const t = S[lang];
  const cards = samples[lang].items
    .map(
      (it, i) => `<article class="brief reveal" style="--i:${i}">
<div class="meta"><span class="sample-tag">${esc(t.sample)}</span><p class="kicker">${esc(t.categories[it.category])} · ${esc(plural(lang, t.sourcesCount, it.sources.length))}</p></div>
<h3 class="title3">${esc(it.headline)}</h3>
<p class="callout">${esc(it.text)}</p>
<p class="footnote">${esc(t.samples.sources)}: ${esc(it.sources.join(', '))}</p>
</article>`,
    )
    .join('\n');
  return `<section id="samples" aria-labelledby="samples-title"><div class="wrap">
<div class="section-head reveal"><p class="kicker">${esc(t.samples.kicker)}</p><h2 id="samples-title" class="title1">${esc(t.samples.title)}</h2><p class="lead">${esc(t.samples.lead)}</p></div>
<div class="samples">
${cards}
</div>
</div></section>`;
}

// Özellik ikonları: SF Symbols'un çizgi üslubunda (web'de SF Symbols yok), 24 px.
const ICON_PATHS = {
  car: '<path d="M5 11l1.6-4.3A2 2 0 0 1 8.5 5.4h7a2 2 0 0 1 1.9 1.3L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6.5 17v2M17.5 17v2"/><circle cx="7.5" cy="14" r=".9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14" r=".9" fill="currentColor" stroke="none"/>',
  voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  speed: '<path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0"/><path d="M12 13.5l4.2-4.2"/><circle cx="12" cy="13.5" r="1.2" fill="currentColor" stroke="none"/>',
  narrator: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M17 6.2a4.2 4.2 0 0 1 0 5.6M19.7 3.8a7.8 7.8 0 0 1 0 10.4"/>',
  offline: '<path d="M12 3.5v11.5M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  editions: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.7 5.4 3.7 8.5s-1.3 5.9-3.7 8.5c-2.4-2.6-3.7-5.4-3.7-8.5S9.6 6.1 12 3.5Z"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
};
const svgIcon = (name, size = 24) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;

/** Bayrak bloğu düşünce boş kalan liste öğeleri ve SSS soruları atlanır. */
const faqItems = (lang) => S[lang].faq.items.filter((it) => it.q);

// 2.0.0'ın yenileri (24 Eki, ADR-072). Premium olanların yanında etiket.
function featuresHtml(lang) {
  const f = S[lang].features;
  const items = f.items
    .filter((it) => it.title)
    .map(
      (it, i) => `<li class="feature reveal" style="--i:${i}"><span class="f-icon">${svgIcon(it.key)}</span><div><h3 class="headline">${esc(it.title)}${it.premium && flags[it.premium] ? ` <span class="sample-tag">${esc(f.premium)}</span>` : ''}</h3><p class="subhead">${esc(it.body)}</p></div></li>`,
    )
    .join('\n');
  return `<section id="new" aria-labelledby="new-title"><div class="wrap">
<div class="section-head reveal"><p class="kicker">${esc(f.kicker)}</p><h2 id="new-title" class="title1">${esc(f.title)}</h2><p class="lead">${esc(f.lead)}</p></div>
<ul class="features">
${items}
</ul>
</div></section>`;
}

// Ücretsiz ve Premium (Y3b kararı: fiyat yok, fiyatı mağaza gösterir). Yalnız
// abonelik açıkken (WONDERWHY_PREMIUM).
function premiumHtml(lang) {
  const p = S[lang].premium;
  if (!p.kicker) return '';
  const list = (items) =>
    `<ul class="checks">${items.filter(Boolean).map((x) => `<li>${svgIcon('check', 18)}<span>${esc(x)}</span></li>`).join('')}</ul>`;
  const note = fill(p.noteHtml, { terms: `${PAGES.terms[lang]}#${S[lang].support.termsAnchor}` });
  return `<section id="premium" aria-labelledby="premium-title"><div class="wrap">
<div class="section-head reveal"><p class="kicker">${esc(p.kicker)}</p><h2 id="premium-title" class="title1">${esc(p.title)}</h2></div>
<div class="plans">
<div class="plan reveal"><h3 class="title3">${esc(p.free.name)}</h3>${list(p.free.items)}</div>
<div class="plan plan-plus reveal" style="--i:1"><h3 class="title3">${esc(p.plus.name)}</h3>${list(p.plus.items)}</div>
</div>
<p class="footnote plans-note">${note}</p>
</div></section>`;
}

function homeBody(lang) {
  const t = S[lang];
  const released = site.stores.appStore || site.stores.googlePlay;
  const heroActions = released
    ? storeButtons(lang, 'web-home')
    : `<a class="btn btn-primary" href="#how">${esc(t.hero.cta)}</a><p class="footnote">${esc(t.hero.soon)}</p>`;
  const faqVars = {
    privacy: PAGES.privacy[lang],
    support: PAGES.support[lang],
    supportSub: `${PAGES.support[lang]}#subscription`,
    hello: esc(site.email.hello),
  };
  const faq = faqItems(lang)
    .map(
      (it, i) =>
        `<details class="reveal" style="--i:${i}"><summary>${esc(it.q)}</summary><div class="answer"><p>${it.aHtml ? fill(it.aHtml, faqVars) : esc(it.a)}</p></div></details>`,
    )
    .join('\n');
  const editions = t.editions.items
    .map(
      (e, i) =>
        `<li class="choice reveal" style="--i:${i}"><p class="headline">${esc(e.name)}</p><p class="footnote">${esc(e.detail)}</p></li>`,
    )
    .join('\n');
  const d = t.download;
  const mail = `mailto:${site.email.hello}?subject=${encodeURIComponent(d.notifySubject)}`;
  return `<main id="main">
<section class="hero" aria-labelledby="hero-title"><div class="wrap hero-grid">
<div class="hero-text">
<div class="rise" style="--i:0">${appIcon(64)}</div>
<p class="kicker rise" style="--i:1">${esc(t.hero.kicker)}</p>
<h1 id="hero-title" class="large-title rise" style="--i:2">${lines(t.hero.title)}</h1>
<p class="body rise" style="--i:3">${esc(t.hero.body)}</p>
<div class="hero-actions rise" style="--i:4">${heroActions}</div>
<p class="rise" style="--i:5"><a class="new-link" href="#new">${esc(t.hero.newLink)} <span aria-hidden="true">›</span></a></p>
</div>
<div class="wall-panel">
<button class="wall-toggle" type="button" aria-pressed="false" aria-label="${esc(t.wall.pause)}">${icon.pause}${icon.play}</button>
<div class="wall" aria-hidden="true" data-nosnippet>
${wallHtml(lang)}
</div>
</div>
</div></section>
${galleryHtml(lang)}
${featuresHtml(lang)}
${howHtml(lang)}
${samplesHtml(lang)}
${premiumHtml(lang)}
<section id="editions" aria-labelledby="editions-title"><div class="wrap">
<div class="section-head reveal"><p class="kicker">${esc(t.editions.kicker)}</p><h2 id="editions-title" class="title1">${esc(t.editions.title)}</h2><p class="lead">${esc(t.editions.lead)}</p></div>
<ul class="choices">
${editions}
</ul>
</div></section>
<section id="download" aria-labelledby="download-title"><div class="wrap download">
${appIcon(72)}
<div class="section-head reveal"><p class="kicker">${esc(d.kicker)}</p><h2 id="download-title" class="title1">${esc(d.title)}</h2><p class="lead">${esc(d.lead)}</p></div>
${storeButtons(lang, 'web-home')}
${released ? '' : `<a class="btn btn-quiet" href="${esc(mail)}">${esc(d.notify)}</a>
<p class="footnote">${esc(d.notifyNote)} <a href="${PAGES.privacy[lang]}">${esc(t.pages.privacy.heading)}</a></p>`}
</div></section>
<section id="faq" aria-labelledby="faq-title"><div class="wrap">
<div class="section-head reveal"><p class="kicker">${esc(t.faq.kicker)}</p><h2 id="faq-title" class="title1">${esc(t.faq.title)}</h2></div>
<div class="faq">
${faq}
</div>
</div></section>
</main>`;
}

// Yapılandırılmış veri (3 Eki, SEO denetimi): dile göre; yayıncı Yelkovan.ai, uygulama
// mağaza adresleri varken, SSS her zaman. Puan (aggregateRating) gerçek puan gelene kadar yok.
function homeJsonLd(lang) {
  const t = S[lang];
  const pub = site.publisher;
  const org = {
    '@type': 'Organization',
    '@id': abs('/#org'),
    name: pub.org ?? site.brand,
    url: abs('/'),
    email: site.email.hello,
    brand: { '@type': 'Brand', name: site.brand },
  };
  if (pub.person) org.founder = { '@type': 'Person', name: pub.person };
  if (brand.has('icon-512.png')) org.logo = abs('/brand/icon-512.png');
  const graph = [
    org,
    {
      '@type': 'WebSite',
      '@id': abs('/#website'),
      name: site.brand,
      url: abs('/'),
      inLanguage: LANGS,
      publisher: { '@id': abs('/#org') },
    },
  ];
  const offers = [site.stores.appStore, site.stores.googlePlay].filter(Boolean);
  if (offers.length) {
    const app = {
      '@type': 'MobileApplication',
      '@id': abs('/#app'),
      name: site.brand,
      url: abs(PAGES.home[lang]),
      description: t.pages.home.description,
      applicationCategory: 'NewsApplication',
      operatingSystem: site.stores.googlePlay ? 'iOS, iPadOS, Android' : 'iOS, iPadOS',
      inLanguage: LANGS,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      installUrl: offers,
      downloadUrl: offers,
      sameAs: offers,
      publisher: { '@id': abs('/#org') },
    };
    if (brand.has('icon-512.png')) app.image = abs('/brand/icon-512.png');
    app.screenshot = gallery.items.map((id) => abs(shotUrl(lang, id, 'jpg')));
    if (pub.person) app.author = { '@type': 'Person', name: pub.person };
    graph.push(app);
  }
  const faqVars = {
    privacy: abs(PAGES.privacy[lang]),
    support: abs(PAGES.support[lang]),
    supportSub: abs(`${PAGES.support[lang]}#subscription`),
    hello: site.email.hello,
  };
  graph.push({
    '@type': 'FAQPage',
    '@id': abs(PAGES.home[lang] + '#faq'),
    inLanguage: lang,
    mainEntity: faqItems(lang).map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.aHtml ? fill(it.aHtml, faqVars).replace(/<[^>]+>/g, '') : it.a },
    })),
  });
  return { '@context': 'https://schema.org', '@graph': graph };
}

// ---------------------------------------------------------------- konu sayfası

/**
 * "Kaynak karşılaştırma" (Y3, 20 Eki): aramadan gelen ziyaretçiyi mağazaya
 * taşıyan sayfa (kullanıcı: "SEO, ASO'ya köprü"). Metin uygulamanın kendi
 * etiketleriyle (ARB compare*, ADR-035, ADR-050); renkli noktalar Signal
 * jetonları (ADR-046), yazı renklenmez. Söylenmeyecekler: docs/15.
 */
function compareBody(lang) {
  const t = S[lang];
  const c = t.compare;
  const kinds = c.kinds
    .map((k, i) => `<li class="kind reveal" style="--i:${i}"><span class="dot dot-${k.key}" aria-hidden="true"></span><div><p class="headline">${esc(k.name)}</p><p class="subhead">${esc(k.body)}</p></div></li>`)
    .join('\n');
  const steps = c.steps
    .map((st, i) => `<li class="reveal" style="--i:${i}"><span class="step-no">${i + 1}</span><div><h3 class="headline">${esc(st.title)}</h3><p class="subhead">${esc(st.body)}</p></div></li>`)
    .join('\n');
  const ex = c.example;
  const sources = ex.sources
    .map((src, i) => `<div class="src-row"><span class="src-no" aria-hidden="true">${i + 1}</span><p class="kicker" translate="no">${esc(src.name)}</p><p class="subhead">${esc(src.title)}</p></div>`)
    .join('\n');
  const label = (key) => c.kinds.find((k) => k.key === key).name;
  const faq = c.faq
    .map((it, i) => `<details class="reveal" style="--i:${i}"><summary>${esc(it.q)}</summary><div class="answer"><p>${esc(it.a)}</p></div></details>`)
    .join('\n');
  return `<main id="main">
<section class="topic-hero" aria-labelledby="topic-title"><div class="wrap topic">
<div class="topic-text">
<p class="kicker rise" style="--i:0">${esc(c.kicker)}</p>
<h1 id="topic-title" class="large-title rise" style="--i:1">${esc(c.title)}</h1>
<p class="lead rise" style="--i:3">${esc(c.lead)}</p>
<div class="rise" style="--i:5">${storeButtons(lang, 'web-compare')}</div>
</div>
${shot(lang, 'story_compare', { eager: true })}
</div></section>
<section id="kinds" aria-labelledby="kinds-title"><div class="wrap">
<div class="section-head reveal"><h2 id="kinds-title" class="title1">${esc(c.kindsTitle)}</h2></div>
<ul class="kinds">
${kinds}
</ul>
<p class="footnote kinds-note">${esc(c.kindsNote)}</p>
</div></section>
<section id="how" aria-labelledby="how-title"><div class="wrap">
<div class="section-head reveal"><h2 id="how-title" class="title1">${esc(c.stepsTitle)}</h2></div>
<ol class="topic-steps">
${steps}
</ol>
</div></section>
<section id="example" aria-labelledby="example-title"><div class="wrap">
<div class="section-head reveal"><h2 id="example-title" class="title1">${esc(c.exampleTitle)}</h2><p class="lead">${esc(c.exampleLead)}</p></div>
<div class="card example reveal"><span class="sample-tag">${esc(t.sample)}</span>
<p class="headline">${esc(ex.headline)}</p>
${sources}
<hr class="hair">
<div class="tag danger"><p class="headline">${esc(label('conflict'))}</p><p class="footnote">${esc(ex.conflict)}</p></div>
<div class="tag detail"><p class="headline">${esc(label('detail'))}</p><p class="footnote">${esc(ex.detail)}</p></div>
</div>
</div></section>
<section id="limits" aria-labelledby="limits-title"><div class="wrap">
<div class="section-head reveal"><h2 id="limits-title" class="title1">${esc(c.limitsTitle)}</h2></div>
<ul class="limits">
${c.limits.map((l) => `<li>${esc(l)}</li>`).join('\n')}
</ul>
</div></section>
<section id="faq" aria-labelledby="faq-title"><div class="wrap">
<div class="section-head reveal"><h2 id="faq-title" class="title1">${esc(c.faqTitle)}</h2></div>
<div class="faq">
${faq}
</div>
</div></section>
<section id="download" aria-labelledby="download-title"><div class="wrap download">
<div class="section-head reveal"><h2 id="download-title" class="title1">${esc(c.ctaTitle)}</h2><p class="lead">${esc(c.ctaLead)}</p></div>
${storeButtons(lang, 'web-compare')}
<p class="footnote"><a href="${PAGES.home[lang]}#how">${esc(c.homeLink)}</a></p>
</div></section>
</main>`;
}

// WebPage + BreadcrumbList + FAQPage; uygulama ve site ana sayfadaki @id'lerle bağlı.
function compareJsonLd(lang) {
  const t = S[lang];
  const c = t.compare;
  const url = abs(PAGES.compare[lang]);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': url + '#page',
        url,
        name: t.pages.compare.title,
        description: t.pages.compare.description,
        inLanguage: lang,
        isPartOf: { '@id': abs('/#website') },
        about: { '@id': abs('/#app') },
        primaryImageOfPage: abs(shotUrl(lang, 'story_compare', 'jpg')),
        breadcrumb: { '@id': url + '#breadcrumb' },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': url + '#breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: site.brand, item: abs(PAGES.home[lang]) },
          { '@type': 'ListItem', position: 2, name: c.kicker, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': url + '#faq',
        inLanguage: lang,
        mainEntity: c.faq.map((it) => ({ '@type': 'Question', name: it.q, acceptedAnswer: { '@type': 'Answer', text: it.a } })),
      },
    ],
  };
}

// ---------------------------------------------------------------- hukuki ve destek

function legalBody(lang, key) {
  const t = S[lang];
  const vars = {
    brand: esc(site.brand),
    domain: esc(new URL(site.origin).host),
    publisher: orTodo(site.publisher.name, lang, 'publisher'),
    // Adres isteğe bağlı: yoksa cümleden düşüyor, yer tutucu çıkmıyor (ADR-044;
    // uygulama ücretsiz ve satışsız, Play adres istemiyor).
    address: site.publisher.address ? `, ${esc(site.publisher.address)}` : '',
    emailProvider: orTodo(site.emailProvider, lang, 'emailProvider'),
    emailPrivacy: esc(site.email.privacy),
    emailHello: esc(site.email.hello),
    privacy: PAGES.privacy[lang],
    terms: PAGES.terms[lang],
    support: PAGES.support[lang],
    deleteAccount: PAGES.deleteAccount[lang],
    // KVKK aydınlatma metni yalnız en ve tr: es/de politika İngilizcesine bağlanır.
    kvkk: pageUrl('kvkk', lang),
    updated: dateText(site.legalUpdated, lang),
  };
  const file = `content/${lang}/${key}.html`;
  const content = fill(cond(read(file), file), vars);
  const toc = [...content.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)]
    .map(([, id, text]) => `<li><a href="#${id}">${text}</a></li>`)
    .join('');
  return `<main id="main" class="doc"><div class="wrap narrow">
<div class="doc-head"><p class="kicker">${esc(t.legal.kicker)}</p><h1 class="large-title">${esc(t.pages[key].heading)}</h1>
<p class="footnote">${esc(fill(t.legal.updated, { date: vars.updated }))} · ${esc(t.legal.otherLanguages)}: ${langLinks(lang, key).join(', ')}</p></div>
${site.legalDraft ? `<p class="draft callout">${esc(t.legal.draft)}</p>\n` : ''}${t.legal.translationNote ? `<p class="draft callout">${esc(t.legal.translationNote)}</p>\n` : ''}<nav class="toc" aria-labelledby="toc-title"><p id="toc-title" class="headline">${esc(t.legal.contents)}</p><ol>${toc}</ol></nav>
<div class="prose">
${content}
</div>
</div></main>`;
}

function supportBody(lang) {
  const t = S[lang];
  const s = t.support;
  const vars = {
    hello: esc(site.email.hello),
    privacy: esc(site.email.privacy),
    privacyPage: PAGES.privacy[lang],
    deletePage: PAGES.deleteAccount[lang],
    termsSub: `${PAGES.terms[lang]}#${s.termsAnchor}`,
    faq: PAGES.home[lang] + '#faq',
  };
  const box = (title, html, id) =>
    title ? `<div class="info"${id ? ` id="${id}"` : ''}><h2 class="headline">${esc(title)}</h2><p>${fill(html, vars)}</p></div>` : '';
  return `<main id="main" class="doc"><div class="wrap narrow">
<div class="doc-head"><p class="kicker">${esc(s.kicker)}</p><h1 class="large-title">${esc(t.pages.support.heading)}</h1><p>${esc(s.lead)}</p></div>
<div class="info-list">
${box(s.contactTitle, s.contactHtml)}
${box(s.privacyTitle, s.privacyHtml)}
${box(s.subscriptionTitle, s.subscriptionHtml, 'subscription')}
${box(s.deleteTitle, s.deleteHtml)}
${box(s.guestTitle, s.guestHtml)}
</div>
<p class="footnote" style="margin-top:24px">${fill(s.faqHtml, vars)}</p>
</div></main>`;
}

/**
 * İki dilli 404. GitHub her derinlikteki eksik adrese aynı dosyayı sunduğu
 * için bağlantılar kökten kalır (göreli yol istenen adrese göre kayardı).
 * `kullanıcı.github.io/repo/` alt yolunda küçük betik başlarına repo adını
 * ekler; wonderwhy.net'te hiçbir şey yapmaz.
 */
function notFound() {
  const en = S.en.pages.notFound;
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
${head('en', { title: en.title, noindex: true })}
<script>(function(){var r=location.pathname.split("/")[1];if(!/\\.github\\.io$/.test(location.hostname)||!r)return;addEventListener("DOMContentLoaded",function(){[].forEach.call(document.querySelectorAll('a[href^="/"]'),function(a){a.setAttribute("href","/"+r+a.getAttribute("href"))})})})();</script>
</head>
<body>
<a class="skip" href="#main">${esc(S.en.skip)}</a>
<header class="top"><div class="wrap"><a class="wordmark" href="/">${appIcon(28, 'mark')}<span>${esc(site.brand)}</span></a></div></header>
<main id="main" class="wrap notfound">
<p class="kicker">404</p>
<h1 class="large-title">${esc(en.heading)}</h1>
<p>${esc(en.body)}</p>
<p><a class="btn btn-primary" href="/">${esc(en.home)}</a></p>
${LANGS.filter((l) => l !== 'en')
  .map((l) => {
    const n = S[l].pages.notFound;
    return `<div lang="${l}" style="display:grid;gap:12px;margin-top:32px">
<h2 class="title2">${esc(n.heading)}</h2>
<p>${esc(n.body)}</p>
<p><a class="btn btn-quiet" href="${PAGES.home[l]}">${esc(n.home)}</a></p>
</div>`;
  })
  .join('\n')}
</main>
</body>
</html>
`;
}

/** /legal/*: dile göre yönlendiren, JS yoksa bütün dilleri gösteren küçük sayfa. */
function legalRedirect(key, from) {
  const to = Object.fromEntries(LANGS.map((l) => [l, relTo(from, PAGES[key][l])]));
  const others = LANGS.filter((l) => l !== 'en');
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${LANGS.map((l) => esc(S[l].redirect[key])).join(' · ')}</title>
<script>(function(){var to=${JSON.stringify(to)};var l=((navigator.languages&&navigator.languages[0])||navigator.language||"").toLowerCase().slice(0,2);location.replace((to[l]||to.en)+location.hash);})();</script>
<style>body{margin:0;background:#000;color:#ebeced;font:400 17px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif}main{max-width:560px;margin:0 auto;padding:48px 20px;display:grid;gap:12px}a{color:#0a84ff}</style>
</head>
<body>
<main>
<h1 style="font-size:22px;color:#fff;margin:0">${esc(S.en.redirect[key])}${others.map((l) => ` <span lang="${l}">· ${esc(S[l].redirect[key])}</span>`).join('')}</h1>
<p>${esc(S.en.redirect.choose)}${others.map((l) => ` <span lang="${l}">/ ${esc(S[l].redirect.choose)}</span>`).join('')}</p>
${LANGS.map((l) => `<p${l === 'en' ? '' : ` lang="${l}"`}><a href="${to[l]}" hreflang="${l}">${esc(S[l].redirect[key])} (${esc(S[l].langName)})</a></p>`).join('\n')}
</main>
</body>
</html>
`;
}

/**
 * Paylaşılan haberin web sayfası. Haberi göstermez (site durağan, haberler
 * uygulamada ve bir hafta saklanıyor): uygulamayı ve mağaza rozetlerini anlatır.
 * Önizleme kartı (og) dile göre; iMessage, WhatsApp gibi uygulamalar bunu
 * gösterir.
 */
function sharePage(lang) {
  const t = S[lang];
  const sh = t.share;
  return `<!doctype html>
<html lang="${lang}" dir="ltr">
<head>
${head(lang, { title: t.pages.share.title, description: t.pages.share.description, noindex: true, ogUrl: abs(SHARE_PAGES[lang]) })}
</head>
<body>
${header(lang, null)}
<main id="main" class="doc"><div class="wrap narrow share">
<div class="doc-head"><p class="kicker">${esc(sh.kicker)}</p><h1 class="large-title">${esc(sh.title)}</h1><p>${esc(sh.body)}</p></div>
${storeButtons(lang, 'web-share')}
<p class="footnote">${esc(sh.note)} <a href="${PAGES.home[lang]}">${esc(sh.more)}</a></p>
</div></main>
${footer(lang, 'home')}
</body>
</html>
`;
}

// ---------------------------------------------------------------- yardımcı dosyalar

function sitemap() {
  const urls = [];
  for (const [key, paths] of Object.entries(PAGES)) {
    const date = LEGAL_PAGES.includes(key) ? site.legalUpdated : { home: site.homeUpdated, compare: site.compareUpdated }[key] ?? null;
    const lastmod = date ? `\n    <lastmod>${date}</lastmod>` : '';
    const alts = [...langsOf(key).map((l) => [l, paths[l]]), ['x-default', paths.en]]
      .map(([hl, p]) => `\n    <xhtml:link rel="alternate" hreflang="${hl}" href="${abs(p)}"/>`)
      .join('');
    for (const l of langsOf(key)) urls.push(`  <url>\n    <loc>${abs(paths[l])}</loc>${lastmod}${alts}\n  </url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

// Manifest'teki adresler manifest'in kendi adresine göre çözülür; göreli yazılır.
function manifest() {
  const icons = [{ src: 'brand/favicon.svg', sizes: 'any', type: 'image/svg+xml' }];
  for (const [file, sizes, purpose] of [
    ['icon-192.png', '192x192'],
    ['icon-512.png', '512x512'],
    ['maskable-512.png', '512x512', 'maskable'],
  ]) {
    if (brand.has(file)) icons.push({ src: `brand/${file}`, sizes, type: 'image/png', ...(purpose && { purpose }) });
  }
  // Mağaza uygulamaları (Chrome'un yükleme önerisi uygulamayı da tanısın); site tercih edilmez.
  const related = [
    site.stores.googlePlay && { platform: 'play', id: 'com.ay.wonderwhy', url: site.stores.googlePlay },
    site.stores.appStore && { platform: 'itunes', url: site.stores.appStore },
  ].filter(Boolean);
  const apps = related.length ? { related_applications: related, prefer_related_applications: false } : {};
  return JSON.stringify(
    { name: site.brand, short_name: site.brand, start_url: './', display: 'browser', background_color: '#000000', theme_color: '#000000', icons, ...apps },
    null,
    2,
  ) + '\n';
}

// ---------------------------------------------------------------- yaz

// Sayfalardaki kökten href/src'ler göreli olur (404 hariç, yukarıda).
// Mutlak adresler (canonical, hreflang, og, JSON-LD) dokunulmadan kalır.
const ROOT_REF = /(\s(?:href|src|srcset))="\/(?!\/)([^"]*)"/g;

function out(path, content) {
  const file = path.endsWith('/') ? join(DIST, path, 'index.html') : join(DIST, path);
  if (file.endsWith('.html') && path !== '404.html') {
    const url = path.startsWith('/') ? path : '/' + path;
    content = content.replace(ROOT_REF, (_, attr, rest) => `${attr}="${relTo(url, '/' + rest)}"`);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

rmSync(DIST, { recursive: true, force: true });
cpSync(join(SRC, 'static'), DIST, { recursive: true });
// Alan adı kalıcı (wonderwhy.net). Pages dal yayınında alan adını yayın
// klasöründeki CNAME'den okur; dosya düşerse site github.io'ya geri döner.
out('CNAME', new URL(site.origin).host + '\n');

for (const lang of LANGS) {
  const t = S[lang];
  out(PAGES.home[lang], page(lang, { page: 'home', ...t.pages.home, jsonld: homeJsonLd(lang), body: homeBody(lang) }));
  for (const key of LEGAL_PAGES.filter((k) => PAGES[k][lang])) {
    out(PAGES[key][lang], page(lang, { page: key, ...t.pages[key], body: legalBody(lang, key) }));
  }
  out(PAGES.support[lang], page(lang, { page: 'support', ...t.pages.support, body: supportBody(lang) }));
  out(PAGES.compare[lang], page(lang, { page: 'compare', ...t.pages.compare, jsonld: compareJsonLd(lang), body: compareBody(lang) }));
}
for (const [path, key] of Object.entries(LEGAL_REDIRECTS)) out(path, legalRedirect(key, path));
// Paylaşım sayfaları yalnız en ve tr: uygulamanın StoryLink'i ve AASA bu yolları tanıyor.
for (const lang of Object.keys(SHARE_PAGES)) out(SHARE_PAGES[lang], sharePage(lang));
out('404.html', notFound());
out('sitemap.xml', sitemap());
out('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
out('site.webmanifest', manifest());

console.log(`docs hazır${process.env.FORCE_REDUCED_MOTION ? ' (hareket azaltma zorlandı)' : ''}`);
