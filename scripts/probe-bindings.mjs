/**
 * scripts/probe-bindings.mjs — the binding vocabulary, on the real shelf.
 *
 * `art/bookDesign.ts` was verified on its own specimen boards, drawn straight
 * to a canvas. This draws the same presets through the whole shelf pipeline
 * instead — `SpineFactory` → off-thread bake → atlas rect → Pixi sprite — at
 * the sizes the shelf actually uses, because that path is where a binding can
 * be lost: the params cache, the atlas key and the texture guard all had to
 * learn about a pin that is persisted outside `cover_meta`.
 *
 * It fills one floor with a row of books, pins each to a different preset, and
 * photographs the row at three zooms. What to look for: no two neighbours
 * identical, titles inside their plates (or stamped on the cloth for the
 * bindings that carry no plate), and nothing spilling out of its slot.
 *
 * Usage: node scripts/probe-bindings.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

const poll = async (fn, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'world hook');
await poll(() => globalThis.__shelfSaveBinding !== undefined, 120000, 'binding bridge');
await poll(
  () => document.querySelector('.shelf-a11y button') !== null,
  120000,
  'a11y mirror',
);
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(2000);

// A plain case and a plain wall: this board is about the BOOKS.
await page.evaluate(() =>
  globalThis.__shelfSaveDesign({
    build: 'plank',
    pattern: 'none',
    wallpaper: { pattern: 'plain', scale: 'medium', depth: 'flat', ink: 'paper' },
  }),
);

const TITLES = [
  'Cell Biology',
  'Kanji Practice',
  'Watercolor',
  'Tea Journal',
  'Linear Algebra',
  'SQL Spellbook',
  'Birdsong',
  'Field Notes',
  'The Long Winter',
  'Sourdough',
];

await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 0), TITLES);
await page.waitForTimeout(2000);

// Ten presets spread evenly across the vocabulary, so adjacent spines come
// from different corners of it rather than from one neighbourhood.
const pinned = await page.evaluate(async () => {
  const design = await import('/src/art/bookDesign.ts');
  const all = design.BOOK_PRESETS.map((p) => p.id);
  const ids = globalThis.__shelfWorld.store.get(0).map((b) => b.id);
  const out = [];
  for (let i = 0; i < ids.length; i += 1) {
    const preset = all[Math.floor((i * all.length) / ids.length) % all.length];
    await globalThis.__shelfSaveBinding(ids[i], preset);
    out.push(preset);
  }
  return out;
});
console.log('pinned bindings:');
for (const p of pinned) console.log('  -', p);

await page.waitForTimeout(3000);

/**
 * Frame floor 0 at a given zoom.
 *
 * The camera is driven directly rather than through `zoomIn`, which zooms
 * about the viewport centre and walks the row we came to look at off the top
 * of the screen. `camera` and its clamps are private to TypeScript only; at
 * runtime this is the same object the render loop reads.
 */
const shot = async (name, zoom) => {
  await page.evaluate((z) => {
    const w = globalThis.__shelfWorld;
    const cam = w.camera;
    cam.vx = 0;
    cam.vy = 0;
    cam.anchor = null;
    // BOTH, or the render loop's smoothing pulls `zoom` straight back to
    // whatever `logZoomTarget` still says — the camera lives in log-zoom space
    // and `zoom` is the smoothed read-out, not the source of truth.
    cam.zoom = z;
    cam.logZoomTarget = Math.log(z);
    // Row of books sits in the upper part of floor 0; a little headroom above
    // it keeps the crown in shot at the wide zoom.
    cam.y = -30;
    // SHELF_WIDTH is 1200; centre the case in the viewport at this zoom.
    cam.x = (1200 - w.vp.width / z) / 2;
    w.dirty = true;
  }, zoom);
  await page.waitForTimeout(2800);
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`shot qa/ui/${name}.png`);
};

await shot('binding-01-shelf-scale', 0.9);
await shot('binding-02-mid', 1.8);
await shot('binding-03-close', 3.2);

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

await browser.close();
process.exit(errors.size === 0 ? 0 : 1);
