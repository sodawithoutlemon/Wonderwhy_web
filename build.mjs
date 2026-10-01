// wonderwhy.net üreticisi: src → docs. Bağımlılık yok (Node 22).
//
//   node build.mjs
//   FORCE_REDUCED_MOTION=1 node build.mjs   # hareket azaltmayı dene
//
// Tek ayar dosyası src/site.json; metinler src/strings/{en,tr}.json; hukuki
// metinler src/content/{en,tr}/*.html. Ayrıntı: docs/14-WEB-SITESI.md.
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
const DIST = join(HERE, 'docs');
const read = (p) => readFileSync(join(SRC, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const LANGS = ['en', 'tr'];
const other = (lang) => (lang === 'en' ? 'tr' : 'en');
const site = json('site.json');
const S = Object.fromEntries(LANGS.map((l) => [l, json(`strings/${l}.json`)]));
const demo = json('data/demo.json');
const audio = json('data/audio.json');
const wall = Object.fromEntries(LANGS.map((l) => [l, json(`data/wall.${l}.json`)]));
const samples = Object.fromEntries(LANGS.map((l) => [l, json(`data/samples.${l}.json`)]));

// Sayfa çiftleri: dil değiştirici, hreflang ve sitemap hep buradan. Sonda "/" var.
const PAGES = {
  home: { en: '/', tr: '/tr/' },
  privacy: { en: '/privacy/', tr: '/tr/gizlilik/' },
  terms: { en: '/terms/', tr: '/tr/kullanim-sartlari/' },
  support: { en: '/support/', tr: '/tr/destek/' },
  // Hesap silme (Google Play Data safety bu adresi istiyor; ADR-043).
  deleteAccount: { en: '/delete-account/', tr: '/tr/hesap-silme/' },
};
// İçeriği `content/{dil}/{anahtar}.html`'den gelen hukuki sayfalar.
const LEGAL_PAGES = ['privacy', 'terms', 'deleteAccount'];
// Uygulamanın açtığı, dile bağlı olmayan adresler (LegalLinks). noindex.
const LEGAL_REDIRECTS = { '/legal/privacy/': 'privacy', '/legal/terms/': 'terms' };

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

function head(lang, { title, description, page = null, noindex = false, jsonld = null }) {
  const t = S[lang];
  const tags = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(title)}</title>`,
  ];
  if (description) tags.push(`<meta name="description" content="${esc(description)}">`);
  if (noindex) tags.push('<meta name="robots" content="noindex">');
  if (page) {
    const url = abs(PAGES[page][lang]);
    tags.push(`<link rel="canonical" href="${url}">`);
    for (const l of LANGS) tags.push(`<link rel="alternate" hreflang="${l}" href="${abs(PAGES[page][l])}">`);
    tags.push(`<link rel="alternate" hreflang="x-default" href="${abs(PAGES[page].en)}">`);
    const og = ogImage(lang);
    tags.push(
      '<meta property="og:type" content="website">',
      `<meta property="og:site_name" content="${esc(site.brand)}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta property="og:locale" content="${t.ogLocale}">`,
      `<meta property="og:locale:alternate" content="${S[other(lang)].ogLocale}">`,
    );
    if (og) {
      tags.push(
        `<meta property="og:image" content="${abs('/brand/' + og)}">`,
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

function header(lang, page) {
  const t = S[lang];
  const o = other(lang);
  const alt = page
    ? `<a class="lang-link" href="${PAGES[page][o]}" hreflang="${o}" lang="${o}">${esc(S[o].langName)}</a>`
    : '';
  return `<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="top"><div class="wrap">
<a class="wordmark kicker" href="${PAGES.home[lang]}">${esc(site.brand)}</a>
${alt}
</div></header>`;
}

function footer(lang, page) {
  const t = S[lang];
  const o = other(lang);
  const link = (p) => `<li><a href="${PAGES[p][lang]}">${esc(t.nav[p])}</a></li>`;
  const alt = `<li><a href="${PAGES[page][o]}" hreflang="${o}" lang="${o}">${esc(S[o].langName)}</a></li>`;
  const note = site.stores.appStore || site.stores.googlePlay ? '' : ` · ${esc(t.footer.notYet)}`;
  return `<footer class="foot"><div class="wrap">
<nav aria-label="${esc(t.footer.legal)}"><ul>${link('home')}${link('privacy')}${link('terms')}${link('support')}${alt}</ul></nav>
<p class="footnote">© ${site.year} ${esc(site.brand)}${note}</p>
</div></footer>`;
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

const SPEEDS = [10, 15, 12, 14, 11]; // px/sn; welcome.dart 10/15/12, geniş ekranda iki sütun daha
const TILE_PITCH = 160; // 150 yükseklik + 10 aralık

function wallHtml(lang) {
  const items = wall[lang].items;
  const cols = [0, 1, 2].map((c) => items.filter((_, i) => i % 3 === c));
  cols.push(rotate(cols[0], 4), rotate(cols[1], 4)); // yalnız geniş ekranda görünür
  const tile = (it) =>
    `<div class="tile"><p class="kicker">${esc(S[lang].categories[it.category])}</p><p class="footnote">${esc(it.headline)}</p></div>`;
  return cols
    .map((col, c) => {
      const dur = ((col.length * TILE_PITCH) / SPEEDS[c]).toFixed(1);
      const tiles = col.map(tile).join('');
      return `<div class="wall-col"><div class="wall-track" style="--dur:${dur}s">${tiles}${tiles}</div></div>`;
    })
    .join('\n');
}
const rotate = (arr, n) => arr.slice(n).concat(arr.slice(0, n));

function storeButtons(lang) {
  const t = S[lang].download;
  const one = (name, url) =>
    url
      ? `<a class="btn btn-primary" href="${esc(url)}">${esc(name)}</a>`
      : `<span class="pill-soon">${esc(name)} <span class="soon">${esc(t.soon)}</span></span>`;
  return `<div class="stores">${one('App Store', site.stores.appStore)}${one('Google Play', site.stores.googlePlay)}</div>`;
}

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

const seg = (tag, cls, start, end, html) =>
  `<${tag} class="${cls}" data-seg data-start="${start}" data-end="${end}">${html}</${tag}>`;

function howHtml(lang) {
  const t = S[lang];
  const h = t.how;
  const d = demo[lang];
  const a = audio[lang];
  const tagSample = `<span class="sample-tag">${esc(t.sample)}</span>`;
  const qEnd = (a.askQuestionEnd - 0.35).toFixed(2);
  const step = (i, id, title, body, card) => `<article class="step reveal" style="--i:${i}" aria-labelledby="step-${id}">
<div class="step-head"><h3 id="step-${id}" class="title3"><span class="step-no">${i + 1}</span>${esc(title)}</h3><p class="subhead">${esc(body)}</p></div>
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

function homeBody(lang) {
  const t = S[lang];
  const released = site.stores.appStore || site.stores.googlePlay;
  const heroActions = released
    ? storeButtons(lang)
    : `<a class="btn btn-primary" href="#how">${esc(t.hero.cta)}</a><p class="footnote">${esc(t.hero.soon)}</p>`;
  const faqVars = {
    privacy: PAGES.privacy[lang],
    support: PAGES.support[lang],
    hello: esc(site.email.hello),
  };
  const faq = t.faq.items
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
<section class="hero" aria-labelledby="hero-title">
<button class="wall-toggle" type="button" aria-pressed="false" aria-label="${esc(t.wall.pause)}">${icon.pause}${icon.play}</button>
<div class="wall" aria-hidden="true"><div class="wall-tilt">
${wallHtml(lang)}
</div></div>
<div class="hero-text wrap">
<p class="kicker rise" style="--i:0">${esc(t.hero.kicker)}</p>
<h1 id="hero-title" class="large-title rise" style="--i:1">${lines(t.hero.title)}</h1>
<p class="body rise" style="--i:3">${esc(t.hero.body)}</p>
<div class="hero-actions rise" style="--i:5">${heroActions}</div>
</div>
</section>
${howHtml(lang)}
${samplesHtml(lang)}
<section id="editions" aria-labelledby="editions-title"><div class="wrap">
<div class="section-head reveal"><p class="kicker">${esc(t.editions.kicker)}</p><h2 id="editions-title" class="title1">${esc(t.editions.title)}</h2><p class="lead">${esc(t.editions.lead)}</p></div>
<ul class="choices">
${editions}
</ul>
</div></section>
<section id="download" aria-labelledby="download-title"><div class="wrap download">
<div class="section-head reveal"><p class="kicker">${esc(d.kicker)}</p><h2 id="download-title" class="title1">${esc(d.title)}</h2><p class="lead">${esc(d.lead)}</p></div>
${storeButtons(lang)}
<a class="btn btn-quiet" href="${esc(mail)}">${esc(d.notify)}</a>
<p class="footnote">${esc(d.notifyNote)} <a href="${PAGES.privacy[lang]}">${esc(t.pages.privacy.heading)}</a></p>
</div></section>
<section id="faq" aria-labelledby="faq-title"><div class="wrap">
<div class="section-head reveal"><p class="kicker">${esc(t.faq.kicker)}</p><h2 id="faq-title" class="title1">${esc(t.faq.title)}</h2></div>
<div class="faq">
${faq}
</div>
</div></section>
</main>`;
}

function homeJsonLd() {
  const org = { '@type': 'Organization', '@id': abs('/#org'), name: site.brand, url: abs('/'), email: site.email.hello };
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
    graph.push({
      '@type': 'MobileApplication',
      name: site.brand,
      applicationCategory: 'NewsApplication',
      operatingSystem: site.stores.googlePlay ? 'iOS, Android' : 'iOS',
      inLanguage: LANGS,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      installUrl: offers,
      publisher: { '@id': abs('/#org') },
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

// ---------------------------------------------------------------- hukuki ve destek

function legalBody(lang, key) {
  const t = S[lang];
  const o = other(lang);
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
    updated: dateText(site.legalUpdated, lang),
  };
  const content = fill(read(`content/${lang}/${key}.html`), vars);
  const toc = [...content.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)]
    .map(([, id, text]) => `<li><a href="#${id}">${text}</a></li>`)
    .join('');
  return `<main id="main" class="doc"><div class="wrap narrow">
<div class="doc-head"><p class="kicker">${esc(t.legal.kicker)}</p><h1 class="large-title">${esc(t.pages[key].heading)}</h1>
<p class="footnote">${esc(fill(t.legal.updated, { date: vars.updated }))} · <a href="${PAGES[key][o]}" hreflang="${o}" lang="${o}">${esc(S[o].legal.versionLink)}</a></p></div>
${site.legalDraft ? `<p class="draft callout">${esc(t.legal.draft)}</p>\n` : ''}<nav class="toc" aria-labelledby="toc-title"><p id="toc-title" class="headline">${esc(t.legal.contents)}</p><ol>${toc}</ol></nav>
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
    faq: PAGES.home[lang] + '#faq',
  };
  const box = (title, html) => `<div class="info"><h2 class="headline">${esc(title)}</h2><p>${fill(html, vars)}</p></div>`;
  return `<main id="main" class="doc"><div class="wrap narrow">
<div class="doc-head"><p class="kicker">${esc(s.kicker)}</p><h1 class="large-title">${esc(t.pages.support.heading)}</h1><p>${esc(s.lead)}</p></div>
<div class="info-list">
${box(s.contactTitle, s.contactHtml)}
${box(s.privacyTitle, s.privacyHtml)}
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
  const tr = S.tr.pages.notFound;
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
${head('en', { title: en.title, noindex: true })}
<script>(function(){var r=location.pathname.split("/")[1];if(!/\\.github\\.io$/.test(location.hostname)||!r)return;addEventListener("DOMContentLoaded",function(){[].forEach.call(document.querySelectorAll('a[href^="/"]'),function(a){a.setAttribute("href","/"+r+a.getAttribute("href"))})})})();</script>
</head>
<body>
<a class="skip" href="#main">${esc(S.en.skip)}</a>
<header class="top"><div class="wrap"><a class="wordmark kicker" href="/">${esc(site.brand)}</a></div></header>
<main id="main" class="wrap notfound">
<p class="kicker">404</p>
<h1 class="large-title">${esc(en.heading)}</h1>
<p>${esc(en.body)}</p>
<p><a class="btn btn-primary" href="/">${esc(en.home)}</a></p>
<div lang="tr" style="display:grid;gap:12px;margin-top:32px">
<h2 class="title2">${esc(tr.heading)}</h2>
<p>${esc(tr.body)}</p>
<p><a class="btn btn-quiet" href="/tr/">${esc(tr.home)}</a></p>
</div>
</main>
</body>
</html>
`;
}

/** /legal/*: dile göre yönlendiren, JS yoksa iki bağlantıyı gösteren küçük sayfa. */
function legalRedirect(key, from) {
  const en = relTo(from, PAGES[key].en);
  const tr = relTo(from, PAGES[key].tr);
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(S.en.redirect[key])} · ${esc(S.tr.redirect[key])}</title>
<script>(function(){var l=((navigator.languages&&navigator.languages[0])||navigator.language||"").toLowerCase();location.replace((l.indexOf("tr")===0?"${tr}":"${en}")+location.hash);})();</script>
<style>body{margin:0;background:#000;color:#ebeced;font:400 17px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif}main{max-width:560px;margin:0 auto;padding:48px 20px;display:grid;gap:12px}a{color:#0a84ff}</style>
</head>
<body>
<main>
<h1 style="font-size:22px;color:#fff;margin:0">${esc(S.en.redirect[key])} <span lang="tr">· ${esc(S.tr.redirect[key])}</span></h1>
<p>${esc(S.en.redirect.choose)} <span lang="tr">/ ${esc(S.tr.redirect.choose)}</span></p>
<p><a href="${en}" hreflang="en">${esc(S.en.redirect[key])} (English)</a></p>
<p lang="tr"><a href="${tr}" hreflang="tr">${esc(S.tr.redirect[key])} (Türkçe)</a></p>
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- yardımcı dosyalar

function sitemap() {
  const urls = [];
  for (const [key, paths] of Object.entries(PAGES)) {
    const lastmod = LEGAL_PAGES.includes(key) ? `\n    <lastmod>${site.legalUpdated}</lastmod>` : '';
    const alts = [...LANGS.map((l) => [l, paths[l]]), ['x-default', paths.en]]
      .map(([hl, p]) => `\n    <xhtml:link rel="alternate" hreflang="${hl}" href="${abs(p)}"/>`)
      .join('');
    for (const l of LANGS) urls.push(`  <url>\n    <loc>${abs(paths[l])}</loc>${lastmod}${alts}\n  </url>`);
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
  return JSON.stringify(
    { name: site.brand, short_name: site.brand, start_url: './', display: 'browser', background_color: '#000000', theme_color: '#000000', icons },
    null,
    2,
  ) + '\n';
}

// ---------------------------------------------------------------- yaz

// Sayfalardaki kökten href/src'ler göreli olur (404 hariç, yukarıda).
// Mutlak adresler (canonical, hreflang, og, JSON-LD) dokunulmadan kalır.
const ROOT_REF = /(\s(?:href|src))="\/(?!\/)([^"]*)"/g;

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
  out(PAGES.home[lang], page(lang, { page: 'home', ...t.pages.home, jsonld: homeJsonLd(), body: homeBody(lang) }));
  for (const key of LEGAL_PAGES) {
    out(PAGES[key][lang], page(lang, { page: key, ...t.pages[key], body: legalBody(lang, key) }));
  }
  out(PAGES.support[lang], page(lang, { page: 'support', ...t.pages.support, body: supportBody(lang) }));
}
for (const [path, key] of Object.entries(LEGAL_REDIRECTS)) out(path, legalRedirect(key, path));
out('404.html', notFound());
out('sitemap.xml', sitemap());
out('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
out('site.webmanifest', manifest());

console.log(`docs hazır${process.env.FORCE_REDUCED_MOTION ? ' (hareket azaltma zorlandı)' : ''}`);
