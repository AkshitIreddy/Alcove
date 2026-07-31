/**
 * scripts/probe-themes.mjs — library-theme specimen board probe.
 *
 * One FRESH page load per theme: the room's prefs are injected into the
 * browser stub DB (localStorage key notebook.stubdb.v1) before the app boots,
 * so the shelf dresses directly in the target theme — no live-switch
 * crossfade, no re-bake storm racing the shutter. Books persist in the same
 * localStorage blob, so only the first page seeds.
 *
 *   <dir>/<id>-full.png   whole case at rest zoom (palette + light read)
 *   <dir>/<id>-crop.png   crown + floor 0 left half (motif/joinery detail)
 *
 * Usage:
 *   node scripts/probe-themes.mjs [--url=http://localhost:1420] [--dir=qa/themes-before]
 *                                 [--themes=robot,dino,...] [--skip-seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const DIR = opt('dir', 'qa/themes');
const SKIP_SEED = args.includes('--skip-seed');
const THEME_IDS = opt(
  'themes',
  'blossom,robot,dino,candy,reef,voyager,athenaeum,conservatory,observatory,cottage,scriptorium,sakura,attic,apothecary',
).split(',').map((s) => s.trim()).filter(Boolean);

mkdirSync(DIR, { recursive: true });

/** 66 titles across six floors — identical pins to probe-books.mjs. */
const TITLES = [
  'The Anatomy of Melancholy', 'Peregrine Pickle', 'A Glossary of Heraldry', 'Common Prayer',
  'The Compleat Angler', 'Religio Medici', 'Hydriotaphia', 'The Faerie Queene', 'Arcadia', 'Euphues',
  'The Anatomy of Abuses', 'Utopia', 'The Praise of Folly', 'Novum Organum', 'Leviathan',
  'Paradise Lost', 'Areopagitica', 'The Pilgrim’s Progress', 'Grace Abounding', 'The Temple',
  'Devotions', 'Pseudo-Martyr', 'Sermons', 'The Country Wife', 'The Way of the World',
  'The Rover', 'Oroonoko', 'The Spectator', 'The Tatler', 'Robinson Crusoe', 'Moll Flanders',
  'Gulliver’s Travels', 'Tom Jones', 'Clarissa', 'Tristram Shandy', 'Rasselas', 'Evelina',
  'The Mysteries of Udolpho', 'Frankenstein', 'Northanger Abbey', 'Emma', 'Waverley', 'Ivanhoe',
  'The Sketch Book', 'The Last of the Mohicans', 'Typee', 'Moby-Dick', 'Walden', 'Leaves of Grass',
  'Jane Eyre', 'Wuthering Heights', 'Vanity Fair', 'Bleak House', 'Middlemarch', 'Tess of the d’Urbervilles',
  'The Golden Bowl', 'The Wings of the Dove', 'Howards End', 'Sons and Lovers', 'Ulysses', 'Mrs Dalloway',
  'The Waves', 'Orlando', 'The Time Machine', 'The Island of Dr Moreau', 'Kim', 'Lord Jim',
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

let seeded = SKIP_SEED;

for (const id of THEME_IDS) {
  const t0 = Date.now();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror:${id}]`, e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[err:${id}]`, m.text());
  });

  // Dress the stub DB with the target room BEFORE the app reads its prefs.
  await page.addInitScript((themeId) => {
    const KEY = 'notebook.stubdb.v1';
    try {
      const raw = localStorage.getItem(KEY);
      const tables = raw ? JSON.parse(raw) : {};
      const settings = Array.isArray(tables.settings) ? tables.settings : [];
      const prefs = JSON.stringify({
        theme: themeId,
        wallpaperPattern: null,
        colourway: null,
        backdrop: null,
      });
      const hit = settings.find((r) => r && r.key === 'library');
      if (hit) hit.value = prefs;
      else settings.push({ key: 'library', value: prefs });
      tables.settings = settings;
      localStorage.setItem(KEY, JSON.stringify(tables));
    } catch (e) {
      console.log('[probe] prefs injection failed', String(e));
    }
  }, id);

  await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
  });
  await page
    .waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
      timeout: 300000,
      polling: 500,
    })
    .catch(() => console.log(`[warn:${id}] world object never appeared`));
  await page.evaluate(() => {
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page
    .waitForFunction(() => globalThis.__worldReady === true, null, {
      timeout: 300000,
      polling: 500,
    })
    .catch(() => console.log(`[warn:${id}] world.ready never resolved`));

  // Populate once; the stub DB persists across pages in this context.
  if (!seeded) {
    const created = await page.evaluate(async (titles) => {
      const w = globalThis.__shelfWorld;
      const store = w['store'];
      const existing = typeof store.totalBooks === 'function' ? store.totalBooks() : 0;
      if (existing >= 60) return 0;
      const books = await import('/src/data/books.ts');
      const per = Math.ceil(titles.length / 6);
      for (let i = 0; i < titles.length; i++) {
        await books.createBook({
          title: titles[i],
          floor: Math.floor(i / per),
          slot: i % per,
          spineSeed: (0x9e3779b1 * (i + 1)) >>> 0,
        });
      }
      await store.refreshAll();
      return titles.length;
    }, TITLES);
    if (created > 0) console.log(`seeded ${created} books across 6 floors`);
    seeded = true;
  }

  // Bake drain: profile quiet + world not dirty.
  let lastCount = -1;
  let stableSince = Date.now();
  const drainStart = Date.now();
  for (;;) {
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => {
      const samples = Array.isArray(globalThis.__bakeProfile) ? globalThis.__bakeProfile : [];
      const w = globalThis.__shelfWorld;
      return { n: samples.length, dirty: w ? w.dirty === true : false };
    });
    if (state.n !== lastCount) {
      lastCount = state.n;
      stableSince = Date.now();
    }
    const quiet = Date.now() - stableSince > 2500 && !state.dirty;
    if (quiet || Date.now() - drainStart > 150000) break;
  }

  // Sanity: the shelf must be wearing THIS room, not a fallback.
  const wearing = await page.evaluate(() => globalThis.__shelfWorld?.libraryKey ?? 'none');
  if (!wearing.startsWith(`${id}|`)) console.log(`[warn:${id}] shelf wearing ${wearing}`);

  await page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    w.zoomFit();
    w.dirty = true;
  });
  await page
    .waitForFunction(() => globalThis.__shelfWorld?.dirty === false, null, {
      timeout: 20000,
      polling: 250,
    })
    .catch(() => undefined);
  await page.waitForTimeout(900);

  async function shot(name, clip) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.screenshot({ path: `${DIR}/${name}.png`, clip, timeout: 45000 });
        console.log(`shot ${DIR}/${name}.png`);
        return;
      } catch {
        console.log(`[warn] shot ${name} attempt ${attempt + 1} timed out`);
        await page.waitForTimeout(1500);
      }
    }
  }

  await shot(`${id}-full`);

  const crop = await page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const cam = w['camera'];
    const rect = { x0: -60, y0: -95, x1: 700, y1: 330 };
    return {
      x: (rect.x0 - cam.x) * cam.zoom,
      y: (rect.y0 - cam.y) * cam.zoom,
      width: (rect.x1 - rect.x0) * cam.zoom,
      height: (rect.y1 - rect.y0) * cam.zoom,
    };
  });
  await shot(`${id}-crop`, crop);

  console.log(`theme ${id} dressed (${wearing}) + shot in ${Date.now() - t0}ms`);
  await page.close();
}

await browser.close();
console.log('done');
