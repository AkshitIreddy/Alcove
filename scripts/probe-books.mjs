/**
 * scripts/probe-books.mjs — shelf-populating visual QA probe.
 *
 * Loads the shelf headless (SwiftShader, ?fx=force&bakeprof=1), makes sure a
 * representative library exists (creates ~66 seeded books across six floors
 * when the in-memory dev DB only has the Welcome book), waits for the spine
 * bake storm to drain, then captures:
 *
 *   <shot>-full.png           whole case at rest zoom
 *   <shot>-row<f>.png         floor f at high zoom (materials/bands/foil)
 *   <shot>-wide<f>.png        floor f edge-to-edge (skyline/thickness mix)
 *
 * and prints the spine bake-cost stats (samples, p50/p95/max) + longtasks.
 *
 * Usage: node scripts/probe-books.mjs [--url=http://localhost:1420] [--shot=qa/books] [--rows=0,1,2]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const SHOT = opt('shot', 'qa/books');
const ROWS = opt('rows', '0,1,2')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

/** 66 titles across six floors — varied lengths so thin/fat spines all carry legible titles. */
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text());
});

await page.addInitScript(() => {
  window.__longtasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__longtasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* unsupported */ }
});

const t0 = Date.now();
await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  timeout: 300000,
  polling: 500,
});
console.log(`world object after ${Date.now() - t0}ms`);

await page.evaluate(() => {
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, {
  timeout: 300000,
  polling: 500,
});
console.log(`world.ready after ${Date.now() - t0}ms`);

/* ------------------------------ populate ------------------------------- */
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
      // Pinned seeds: before/after probe runs render the SAME books, so any
      // visual delta is the renderer's, not the dice's.
      spineSeed: (0x9e3779b1 * (i + 1)) >>> 0,
    });
  }
  await store.refreshAll();
  return titles.length;
}, TITLES);
if (created > 0) console.log(`seeded ${created} books across 6 floors`);

/* ---------------------------- bake drain ------------------------------- */
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
  if (quiet || Date.now() - drainStart > 90000) break;
}
console.log(`bake drain settled after ${Date.now() - drainStart}ms (${lastCount} samples)`);
await page.waitForTimeout(1200);

/* ---------------------------- diagnostics ------------------------------ */
const diag = await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const store = w['store'];
  const floors = [];
  for (let f = 0; f <= 7; f++) {
    const books = store.get(f);
    floors.push({ floor: f, stored: books === undefined ? 'unloaded' : books.length });
  }
  const mounted = [];
  for (const [idx, fv] of w['floors']) mounted.push({ floor: idx, visuals: fv.visuals.length });
  const cam = w['camera'];
  return { maxFloor: store.maxFloor, floors, mounted, cam: { x: cam.x, y: cam.y, zoom: cam.zoom } };
});
console.log('diag', JSON.stringify(diag));

/* ---------------------------- screenshots ------------------------------ */
async function shot(name, clip) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.screenshot({ path: `${SHOT}-${name}.png`, clip, timeout: 45000 });
      console.log(`shot ${SHOT}-${name}.png`);
      return;
    } catch {
      console.log(`[warn] shot ${name} attempt ${attempt + 1} timed out`);
      await page.waitForTimeout(1500);
    }
  }
}

// A stable, clamp-proof viewpoint: fit the case, read back the REAL camera
// state, then crop floor rows out of the page with Playwright's clip (the
// DPR-2 backing store keeps crops crisp at 3-4x inspection zoom).
await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  w.zoomFit();
  w.dirty = true;
});
await page.waitForFunction(() => globalThis.__shelfWorld?.dirty === false, null, {
  timeout: 20000,
  polling: 250,
}).catch(() => undefined);
await page.waitForTimeout(700);

await shot('full');

/** Screen rect (CSS px) of a world rect, via the app's own camera math. */
async function worldRectToScreen(x0, y0, x1, y1) {
  return page.evaluate(
    ([wx0, wy0, wx1, wy1]) => {
      const w = globalThis.__shelfWorld;
      const cam = w['camera'];
      return {
        x: (wx0 - cam.x) * cam.zoom,
        y: (wy0 - cam.y) * cam.zoom,
        width: (wx1 - wx0) * cam.zoom,
        height: (wy1 - wy0) * cam.zoom,
      };
    },
    [x0, y0, x1, y1],
  );
}

for (const f of ROWS) {
  // Whole book zone of floor f, edge to edge.
  const zone = await worldRectToScreen(0, f * 320, 1200, f * 320 + 320);
  await shot(`wide${f}`, zone);
  // The middle 520 world px of the same row — a ~3.4x crop at DPR 2.
  const mid = await worldRectToScreen(340, f * 320, 860, f * 320 + 320);
  await shot(`row${f}`, mid);
}

/* ------------------------------ bake stats ----------------------------- */
const report = await page.evaluate(() => {
  const samples = Array.isArray(globalThis.__bakeProfile) ? globalThis.__bakeProfile : [];
  const tasks = Array.isArray(window.__longtasks) ? window.__longtasks : [];
  return { samples, tasks };
});
await browser.close();

const spines = report.samples.filter((s) => s.kind === 'spine').map((s) => s.ms).sort((a, b) => a - b);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);
console.log(
  `\nspine bakes: ${spines.length}  p50=${pct(spines, 50).toFixed(1)}ms  p95=${pct(spines, 95).toFixed(1)}ms  max=${(spines[spines.length - 1] ?? 0).toFixed(1)}ms`,
);
const worst = [...report.tasks].sort((a, b) => b.dur - a.dur).slice(0, 5);
console.log(`longtasks: ${report.tasks.length}`);
for (const t of worst) console.log(`  task @${t.start}ms dur=${t.dur}ms`);
