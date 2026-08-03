/**
 * shots-now/dice-shelf.mjs — a shelf of books the DICE dressed, photographed
 * at the zoom the app opens on.
 *
 * The reader has now twice said the randomiser hands out spines that are "too
 * weird". The first pass answered that on a specimen board — every binding
 * drawn once, side by side, at a size chosen to show it off. That is the wrong
 * instrument: a board asks "is this a good drawing of a comb binding?" and the
 * answer is yes. The question the reader is actually asking is "does this read
 * as a book standing in a row of books I did not ask for?", and only a shelf
 * can answer it.
 *
 * ## Why the seeds are fixed
 *
 * `createBook` rolls a fresh seed per book, so two runs are two different
 * shelves and a before/after tells you nothing. Instead this seeds thirty books
 * and then dresses each one from a FIXED seed through the two functions the app
 * itself uses — `presetForSeed` for the binding and `freshBookStyleOverrides`
 * for the plate, edge, ornament and charm — applied through the world's own
 * bridges. Same thirty seeds before and after, so the only thing that moves
 * between the two boards is what the roll pools contain.
 *
 * Both of those are pure functions, which is why importing them in-page is safe
 * here: the second-module-copy trap that `__shelfSaveDesign` exists to dodge is
 * about STORES, and nothing is written through the imported copy.
 *
 * Usage:
 *   node shots-now/dice-shelf.mjs --tag=before
 *   node shots-now/dice-shelf.mjs --tag=after --runs=3
 *
 * Outputs, per run r:  shots-now/dice/<tag>-r<r>-open.png     opening zoom
 *                      shots-now/dice/<tag>-r<r>-f<0|1>-<a|b|c>.png  close
 *                      shots-now/dice/<tag>-r<r>.json         what each rolled
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const TAG = opt('tag', 'shelf');
const PER_FLOOR = Number(opt('n', '15'));
const RUNS = Number(opt('runs', '1'));
/**
 * Skip the fixed-seed dressing and photograph the books exactly as `createBook`
 * left them.
 *
 * The fixed-seed board is the one you compare before against after with, but it
 * PINS each binding through `__shelfSaveBinding`, which means it proves the
 * pool changed and not that an undressed book draws from it. `--organic` closes
 * that seam: nothing is pinned, so every spine on screen came out of
 * `presetForSeed` inside `renderSpine` on the real bake path. The cost is that
 * two runs are two different shelves, which is exactly why it is not the
 * default.
 */
const ORGANIC = args.includes('--organic');

mkdirSync('shots-now/dice', { recursive: true });

/** Ordinary titles — nothing here should be the reason a spine looks odd. */
const TITLES = [
  'Cell Biology', 'Kanji Practice', 'Watercolour', 'Tea Journal', 'Linear Algebra',
  'SQL Spellbook', 'Birdsong', 'Field Notes', 'The Long Winter', 'Sourdough',
  'Alpine Flora', 'Letters Home', 'The Salt Road', 'Recipes', 'Marginalia',
  'Cloud Atlas', 'Bee Keeping', 'Grammar', 'Night Sky', 'Ledger',
  'Poems', 'Sketches', 'Harbour Log', 'Dream Diary', 'Herbal',
  'Chess Games', 'Old Maps', 'Quiet Hours', 'The Orchard', 'Almanac',
];

/** Thirty seeds per run, spread by a cheap hash so they are not neighbours. */
const seedsFor = (run) => {
  const out = [];
  for (let i = 0; i < 30; i += 1) {
    let h = (0x811c9dc5 ^ (run * 7919 + i)) >>> 0;
    for (let k = 0; k < 4; k += 1) {
      h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
      h = (h + 0x9e3779b9) >>> 0;
    }
    out.push(h >>> 0);
  }
  return out;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const errors = new Map();

for (let run = 0; run < RUNS; run += 1) {
  const SEEDS = seedsFor(run);
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (e) => {
    const k = e.message.split('\n')[0];
    if (!errors.has(k)) console.log(`  pageerror: ${k}`);
    errors.set(k, (errors.get(k) ?? 0) + 1);
  });
  // Another agent editing the tree mid-run leaves the dev server serving a 500
  // for one module, and the symptom downstream is only "timed out waiting for
  // world hook" — which reads like a probe bug. Say what actually failed.
  page.on('response', (r) => {
    if (r.status() >= 400) console.log(`  HTTP ${r.status()} ${r.url()}`);
  });

  const poll = async (fn, timeout = 120000, label = 'condition') => {
    const t0 = Date.now();
    for (;;) {
      const v = await page.evaluate(fn);
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
      await page.waitForTimeout(250);
    }
  };

  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => {
    try {
      localStorage.clear();
      localStorage.setItem('nb-tutorial-done', '1');
    } catch {}
  });
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'world hook');
  await poll(() => globalThis.__shelfSeedBooks !== undefined, 120000, 'seed bridge');
  await poll(() => globalThis.__shelfSaveDesign !== undefined, 120000, 'design bridge');
  await poll(() => globalThis.__shelfSetBookStyle !== undefined, 120000, 'style bridge');
  for (let a = 0; a < 4; a += 1) {
    const card = page.locator('text=skip the tour').first();
    if ((await card.count()) === 0) break;
    await card.click({ force: true, timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500);

  // A plain case and a bare wall. This is about the BOOKS: a patterned wall or
  // a carved case gives the eye somewhere else to go, and the whole question is
  // whether one spine in the row jumps out as not-a-book.
  await page.evaluate(() =>
    globalThis.__shelfSaveDesign({
      build: 'plank',
      pattern: 'none',
      wallpaper: { pattern: 'plain', scale: 'medium', depth: 'flat', ink: 'paper' },
    }),
  );
  await page.waitForTimeout(800);

  await page.evaluate(() => globalThis.__shelfEmptyLibrary());
  await page.waitForTimeout(1200);

  const titles = [];
  for (let i = 0; i < PER_FLOOR * 2; i += 1) titles.push(TITLES[i % TITLES.length]);
  await page.evaluate(
    ([t, n]) => globalThis.__shelfSeedBooks(t.slice(0, n), 0),
    [titles, PER_FLOOR],
  );
  await page.evaluate(
    ([t, n]) => globalThis.__shelfSeedBooks(t.slice(n), 1),
    [titles, PER_FLOOR],
  );
  await page.waitForTimeout(3500);

  // Dress each book from its fixed seed through the two functions a real new
  // book goes through, written back through the world's own bridges.
  const rolled = await page.evaluate(async ([seeds, organic]) => {
    const design = await import('/src/art/bookDesign.ts');
    const style = await import('/src/art/bookStyle.ts');
    const w = globalThis.__shelfWorld;
    const out = [];
    let n = 0;
    for (const floor of [0, 1]) {
      const books = [...(w.store.get(floor) ?? [])].sort((a, b) => a.slot - b.slot);
      for (const b of books) {
        // Organic: read the seed the book was BORN with and pin nothing, so
        // what is reported is what `renderSpine` independently resolved.
        const seed = (organic ? b.spineSeed : seeds[n % seeds.length]) >>> 0;
        n += 1;
        const preset = design.presetForSeed(seed);
        const dress = style.freshBookStyleOverrides(seed);
        if (!organic) {
          await globalThis.__shelfSaveBinding(b.id, preset.id);
          await globalThis.__shelfSetBookStyle(b.id, dress);
        }
        out.push({
          floor,
          slot: b.slot,
          title: b.title,
          seed,
          preset: preset.id,
          presetLabel: preset.label,
          tier: preset.tier,
          shape: preset.shape,
          material: preset.material,
          decorations: preset.decorations,
          plate: dress.titlePlate,
          edge: dress.edge,
          ornament: dress.ornament,
          charm: dress.charm,
          bands: dress.raisedBands,
          wear: Number((dress.wear ?? 0).toFixed(2)),
        });
      }
    }
    return out;
  }, [SEEDS, ORGANIC]);
  writeFileSync(`shots-now/dice/${TAG}-r${run}.json`, JSON.stringify(rolled, null, 1));
  // Say it out loud rather than leaving it to the JSON: an oddity reaching a
  // shelf through the real path is the failure this whole probe exists to see.
  const odd = rolled.filter((b) => b.tier === 'oddity');
  console.log(
    `run ${run}: ${rolled.length} books, ${odd.length} oddity` +
      (odd.length > 0 ? ` — ${odd.map((b) => b.preset).join(', ')}` : ''),
  );
  await page.waitForTimeout(4000);

  // 1. The shelf as the app hands it over — camera untouched.
  const open = await page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    w.dirty = true;
    return { zoom: w.camera.zoom };
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `shots-now/dice/${TAG}-r${run}-open.png` });
  console.log(`run ${run}: opening camera zoom=${open.zoom.toFixed(3)}`);

  // 2. Each row in three overlapping panels, close enough that a spine which
  //    reads as a stapler at 34px can actually be named in the shot.
  const panel = async (floor, part, x0, zoom) => {
    // A neighbouring agent saving a source file full-reloads the dev server's
    // page, and the world is rebuilt a few seconds later. Everything this probe
    // set up lives in SQLite, so the shelf comes back identical — only the
    // camera handle is gone, and re-polling for it is the whole recovery.
    await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'world hook');
    await page.evaluate(
      ([f, x, z]) => {
        const w = globalThis.__shelfWorld;
        const cam = w.camera;
        cam.vx = 0;
        cam.vy = 0;
        cam.anchor = null;
        cam.zoom = z;
        cam.logZoomTarget = Math.log(z);
        cam.y = -50 + f * 340;
        cam.x = x;
        w.dirty = true;
      },
      [floor, x0, zoom],
    );
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `shots-now/dice/${TAG}-r${run}-f${floor}${part}.png` });
  };
  for (const floor of [0, 1]) {
    await panel(floor, 'a', 150, 3.0);
    await panel(floor, 'b', 490, 3.0);
    await panel(floor, 'c', 810, 3.0);
  }

  console.log(`run ${run}: shots-now/dice/${TAG}-r${run}-*.png`);
  await page.close();
}

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

await browser.close();
