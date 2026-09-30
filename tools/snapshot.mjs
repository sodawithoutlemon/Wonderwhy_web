// Uygulamanın onboarding içeriğinden sitenin dondurulmuş kopyasını üretir.
//
//   node tools/snapshot.mjs
//   APP_ROOT=/yol/uygulama-reposu node tools/snapshot.mjs
//
// Okur:  <uygulama>/app/assets/onboarding/{stories.json, stories_en.json, demo.json},
//        tools/picks.json (elle seçilmiş kimlikler)
// Yazar: src/data/{wall,samples}.{tr,en}.json, src/data/demo.json
//
// Uygulama reposu varsayılan olarak bu reponun bir üstü: bu repo uygulama
// reposunun içindeki `website/` klasörüne klonlanıyor.
//
// Site uygulamanın dosyalarını build sırasında OKUMAZ: onboarding içeriği
// yeniden seçildiğinde sitede kendiliğinden görünmesin, gözden geçirilsin.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = process.env.APP_ROOT ?? join(site, '..');
const onboarding = join(appRoot, 'app', 'assets', 'onboarding');
const out = join(site, 'src', 'data');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (name, data) =>
  writeFileSync(join(out, name), JSON.stringify(data, null, 2) + '\n');

const picks = read(join(site, 'tools', 'picks.json'));
const files = { tr: 'stories.json', en: 'stories_en.json' };

for (const lang of ['tr', 'en']) {
  const { curatedAt, items } = read(join(onboarding, files[lang]));
  const byId = new Map(items.map((it) => [it.id, it]));
  const fixes = Object.entries(picks[lang].fixes ?? {});
  const fix = (s) => fixes.reduce((t, [a, b]) => t.replaceAll(a, b), s);
  const pick = (id) => {
    const it = byId.get(id);
    if (!it) throw new Error(`${lang}: ${id} ${files[lang]} içinde yok`);
    return it;
  };

  write(`wall.${lang}.json`, {
    curatedAt,
    items: picks[lang].wall.map(pick).map((it) => ({
      id: it.id,
      category: it.category,
      headline: fix(it.headline[lang]),
    })),
  });

  write(`samples.${lang}.json`, {
    curatedAt,
    items: picks[lang].samples.map(pick).map((it) => {
      const text = it.scriptShort?.[lang];
      if (!text) throw new Error(`${lang}: ${it.id} kısa metni yok`);
      return {
        id: it.id,
        category: it.category,
        day: it.dayId,
        headline: fix(it.headline[lang]),
        text: fix(text),
        sources: [...new Set((it.sources ?? []).map((s) => s.name))],
      };
    }),
  });
}

// Honda tanıtımı: yalnız tr ve en, publisher görseli (imageUrl) alınmaz.
const demo = read(join(onboarding, 'demo.json'));
write('demo.json', { _note: demo._note, category: demo.category, tr: demo.tr, en: demo.en });

console.log('website/src/data güncellendi');
