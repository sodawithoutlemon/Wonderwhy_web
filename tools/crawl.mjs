// Yayındaki siteyi tarayıcısız gezer: her sayfadaki href/src'yi, /legal/*
// yönlendirme hedeflerini, manifest ikonlarını ve sitemap adreslerini sayfa
// adresine göre çözer, hepsini ister. 200 olmayanı ve tabanın dışına çıkan göreli
// bağlantıyı hata sayar.
//
//   node tools/crawl.mjs https://sodawithoutlemon.github.io/Wonderwhy_web/
//   node tools/crawl.mjs https://wonderwhy.net/
//   node tools/crawl.mjs http://localhost:8084/ --no-404   # yerel sunucu
//   --list: bulunan adresleri de yazar
//   --images: yayıncı görsellerini de ister (Referer'sız, tarayıcı gibi; 200 + image/*)
//
// Hata varsa 1 ile çıkar. Başka sitelere istek atmaz, yalnız sayar (--images hariç).
// Olmayan bir adresin bizim 404 sayfamızı 404 koduyla döndüğünü de dener
// (--no-404 atlar: python'un sunucusu 404.html'i kullanmaz).
// Bağımlılık yok, Node 22 fetch.

const args = process.argv.slice(2);
const baseArg = args.find((a) => !a.startsWith('--'));
if (!baseArg) {
  console.error('kullanım: node tools/crawl.mjs <taban-url> [--no-404] [--list] [--images]');
  process.exit(2);
}
const BASE = new URL(baseArg.endsWith('/') ? baseArg : baseArg + '/');
const CHECK_404 = !args.includes('--no-404');
const LIST = args.includes('--list');
const IMAGES = args.includes('--images');
const PARALLEL = 6;

const errors = [];
const external = new Set();
const images = new Set(); // yayıncı fotoğrafları (sayfalardaki <img> ve editions/*.json)
const seen = new Map(); // adres → neden istendi (ilk gören sayfa)
const queue = [];
let fetched = 0;

const inBase = (u) => u.origin === BASE.origin && u.pathname.startsWith(BASE.pathname);
const clean = (u) => {
  const c = new URL(u);
  c.hash = '';
  return c;
};

/** Bir başvuruyu sayfa adresine göre çözer ve kuyruğa koyar. */
function add(ref, from) {
  if (!ref || /^(mailto|tel|data|javascript):/i.test(ref) || ref.startsWith('#')) return;
  const absolute = /^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref);
  let u;
  try {
    u = clean(new URL(ref, from));
  } catch {
    errors.push(`${from}: çözülemeyen adres ${ref}`);
    return;
  }
  if (!inBase(u)) {
    // Mutlak adres (canonical, hreflang, sitemap) başka tabanda olabilir; göreli
    // bağlantı tabandan çıkıyorsa GitHub alt yolunda kırıktır.
    if (absolute) external.add(u.href);
    else errors.push(`${from}: ${ref} tabanın dışına çıkıyor → ${u.href}`);
    return;
  }
  if (!seen.has(u.href)) {
    seen.set(u.href, from);
    queue.push(u.href);
  }
}

const attrRefs = (html) => [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
// /legal/* sayfalarındaki location.replace hedefleri: satır içi betikteki göreli dizgeler.
const scriptRefs = (html) =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].flatMap((m) => [...m[1].matchAll(/"(\.\.?\/[^"]*)"/g)].map((s) => s[1]));

async function visit(href) {
  let res;
  try {
    res = await fetch(href, { redirect: 'manual' });
  } catch (e) {
    errors.push(`${href}: istek başarısız (${e.cause?.code ?? e.message}); ilk gören: ${seen.get(href)}`);
    return;
  }
  fetched++;
  if (res.status !== 200) {
    const to = res.headers.get('location');
    errors.push(`${href}: ${res.status}${to ? ` → ${to}` : ''}; ilk gören: ${seen.get(href)}`);
    return;
  }
  const type = res.headers.get('content-type') ?? '';
  const path = new URL(href).pathname;
  if (type.includes('text/html')) {
    const html = await res.text();
    // 404 sayfasının bağlantıları bilerek kökten; alt yolda satır içi betik düzeltir.
    if (path.endsWith('/404.html')) return;
    for (const [, src] of html.matchAll(/<img\b[^>]*\ssrc="(https:[^"]+)"/g)) images.add(src.replace(/&amp;/g, '&'));
    for (const ref of [...attrRefs(html), ...scriptRefs(html)]) add(ref, href);
  } else if (path.endsWith('.webmanifest')) {
    const m = JSON.parse(await res.text());
    add(m.start_url, href);
    for (const icon of m.icons ?? []) add(icon.src, href);
  } else if (/\/editions\/[a-z]+\.json$/.test(path)) {
    for (const it of JSON.parse(await res.text()).items) images.add(it.image);
  } else if (path.endsWith('/sitemap.xml')) {
    for (const [, loc] of (await res.text()).matchAll(/(?:<loc>|href=")([^<"]+)/g)) add(loc, href);
  } else if (path.endsWith('/robots.txt')) {
    for (const [, loc] of (await res.text()).matchAll(/^Sitemap:\s*(\S+)/gim)) add(loc, href);
  } else {
    await res.arrayBuffer();
  }
}

// /legal/* sayfalarına siteden bağlantı yok; onları uygulama (LegalLinks) açar.
// editions/*.json'u site.js yükler (yeni tasarımın baskı seçimi); bağlantısı
// yok. Yalnız yayındaki site.js onları anıyorsa isteniyor: bugünkü tasarımda
// dosyalar yok ve yokluk hata değil (30 Eyl, ADR-044).
const siteJs = await fetch(new URL('site.js', BASE)).then((r) => (r.ok ? r.text() : ''), () => '');
const EDITIONS = siteJs.includes('editions/') ? ['editions/tr.json', 'editions/us.json', 'editions/world.json'] : [];
const STARTS = ['./', 'robots.txt', 'sitemap.xml', '404.html', 'legal/privacy/', 'legal/terms/', ...EDITIONS];
for (const start of STARTS) add(start, BASE.href);
while (queue.length) {
  const batch = queue.splice(0, PARALLEL);
  await Promise.all(batch.map(visit));
}

if (CHECK_404) {
  const missing = new URL(`yok-${Date.now()}/`, BASE).href;
  const res = await fetch(missing, { redirect: 'manual' });
  const body = await res.text();
  if (res.status !== 404) errors.push(`${missing}: 404 beklenirdi, ${res.status} geldi`);
  else if (!body.includes('<meta name="robots" content="noindex">') || !/<title>[^<]*wonderwhy<\/title>/i.test(body))
    errors.push(`${missing}: 404 geldi ama gövde bizim 404 sayfamız değil`);
}

if (IMAGES) {
  const BROWSER = { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15', accept: 'image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5' };
  const list = [...images];
  for (let i = 0; i < list.length; i += PARALLEL) {
    await Promise.all(list.slice(i, i + PARALLEL).map(async (src) => {
      try {
        const res = await fetch(src, { headers: BROWSER, referrerPolicy: 'no-referrer' });
        await res.arrayBuffer();
        if (res.status !== 200 || !(res.headers.get('content-type') ?? '').startsWith('image/'))
          errors.push(`görsel ${res.status} ${res.headers.get('content-type')}: ${src} (picks.json › exclude)`);
      } catch (e) {
        errors.push(`görsel açılmadı (${e.cause?.code ?? e.message}): ${src}`);
      }
    }));
  }
}

console.log(`taban ${BASE.href}`);
console.log(`${fetched} adres istendi (${seen.size} bulundu)${CHECK_404 ? ', olmayan adres denendi' : ''}`);
if (external.size) console.log(`başka tabandaki mutlak adresler (istenmedi): ${external.size}`);
console.log(`yayıncı görselleri: ${images.size}${IMAGES ? ' (istendi)' : ' (istenmedi; --images)'}`);
if (LIST) for (const u of [...seen.keys()].sort()) console.log(`  ${u}`);
for (const e of errors) console.error(`hata   ${e}`);
if (errors.length) {
  console.error(`${errors.length} hata`);
  process.exit(1);
}
console.log('gezinti temiz');
