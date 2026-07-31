/**
 * scripts/probe-vocabularies.mjs — does a design choice reach the SHELF?
 *
 * The three vocabularies (carpentry, wallpaper, binding) were landed with
 * their own specimen boards, so each one is known to draw well in isolation.
 * What no board could show is the seam: the studio persists a choice, and the
 * Pixi world has to notice and re-bake. For a while it did not — the pickers
 * stored and previewed truthfully while the shelf kept drawing a plain plank
 * case against a bare wall.
 *
 * So this probe asserts on the APPLIED side (`__shelfDesign()`, which reads
 * what `EnvTextures` and the backdrop are actually holding) and screenshots
 * the result, rather than trusting that a saved preference means a repaint.
 *
 * Usage: node scripts/probe-vocabularies.mjs [--url=http://localhost:1420]
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

let step = 'boot';
const errors = new Map();
page.on('pageerror', (e) => {
  const key = `${step} :: ${e.message.split('\n')[0]}`;
  errors.set(key, (errors.get(key) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const key = `${step} :: console ${m.text().split('\n')[0]}`;
    errors.set(key, (errors.get(key) ?? 0) + 1);
  }
});

const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

const poll = async (fn, arg, timeout = 60000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

const applied = () => page.evaluate(() => globalThis.__shelfDesign());

/** Wait until the world reports the design it was asked for. */
const awaitApplied = async (want, label) => {
  const got = await poll(
    (w) => {
      const d = globalThis.__shelfDesign();
      return d.shelf === w.shelf && d.wallpaperKey.includes(w.paper) ? d : null;
    },
    want,
    45000,
    label,
  );
  console.log(`  applied: shelf=${got.shelf} paper=${want.paper}`);
  return got;
};

/* ---------------------------------- boot --------------------------------- */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });

await poll(() => globalThis.__shelfWorld !== undefined, null, 120000, 'world hook');
await poll(() => globalThis.__shelfDesign !== undefined, null, 120000, 'design bridge');
await poll(
  () => document.querySelector('.shelf-a11y button') !== null,
  null,
  120000,
  'a11y mirror',
);
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(2000);

await page.evaluate(async () => {
  await globalThis.__shelfSeedBooks(
    ['Cell Biology', 'Kanji Practice', 'Watercolor Basics', 'Tea Tasting Journal'],
    0,
  );
  await globalThis.__shelfSeedBooks(['Linear Algebra', 'SQL Spellbook'], 1);
});
await page.waitForTimeout(1800);

console.log('\n1. the house room (plank + none, plain paper)');
console.log('  ', JSON.stringify(await applied()));
await shot('vocab-01-house');

/* ------------------------- 2. the carpentry axis -------------------------- */

const dress = async (patch) => {
  step = `dress ${JSON.stringify(patch)}`;
  await page.evaluate(async (p) => {
    await globalThis.__shelfSaveDesign(p);
  }, patch);
};

console.log('\n2. a gothic case, fluted, against a damask wall');
await dress({
  build: 'gothic',
  pattern: 'fluted',
  wallpaper: { pattern: 'damask', scale: 'large', depth: 'raised', ink: 'timber' },
});
await awaitApplied({ shelf: 'gothic.fluted', paper: 'damask' }, 'gothic case');
await page.waitForTimeout(1200);
await shot('vocab-02-gothic-damask');

console.log('\n3. an apothecary case, chequer, star wall');
await dress({
  build: 'apothecary',
  pattern: 'chequer',
  wallpaper: { pattern: 'star', scale: 'medium', depth: 'low', ink: 'deep' },
});
await awaitApplied({ shelf: 'apothecary.chequer', paper: 'star' }, 'apothecary case');
await page.waitForTimeout(1200);
await shot('vocab-03-apothecary-stars');

console.log('\n4. a colonnade case, rope, trellis wall — zoomed in');
await dress({
  build: 'colonnade',
  pattern: 'rope',
  wallpaper: { pattern: 'trellis', scale: 'small', depth: 'carved', ink: 'recess' },
});
await awaitApplied({ shelf: 'colonnade.rope', paper: 'trellis' }, 'colonnade case');
await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  w.zoomIn();
  w.zoomIn();
});
await page.waitForTimeout(1500);
await shot('vocab-04-colonnade-trellis-zoomed');

/* ------------------- 5. the wallpaper scale axis is visible --------------- */

console.log('\n5. the scale axis: petite vs grand, same paper');
await page.evaluate(() => globalThis.__shelfWorld.zoomReset());
await dress({ wallpaper: { pattern: 'sprig', scale: 'petite', depth: 'low', ink: 'deep' } });
await awaitApplied({ shelf: 'colonnade.rope', paper: 'sprig' }, 'petite sprig');
await page.waitForTimeout(1200);
await shot('vocab-05-sprig-petite');

await dress({ wallpaper: { pattern: 'sprig', scale: 'grand', depth: 'low', ink: 'deep' } });
await poll(
  () => globalThis.__shelfDesign().design.wallpaper.scale === 'grand',
  null,
  30000,
  'grand sprig',
);
await page.waitForTimeout(1400);
await shot('vocab-06-sprig-grand');

/* ------------------------- 7. bindings on the books ----------------------- */

console.log('\n7. bindings: pin every visible book to a distinct preset');
step = 'bindings';
const pinned = await page.evaluate(async () => {
  const design = await import('/src/art/bookDesign.ts');
  const ids = globalThis.__shelfWorld.store
    .get(0)
    .map((b) => b.id)
    .slice(0, 4);
  const all = design.BOOK_PRESETS.map((p) => p.id);
  // Four presets far apart in the vocabulary, so the row cannot look uniform
  // by accident: spaced across the list rather than named, since the ids are
  // the other agent's to choose.
  const picks = [all[0], all[Math.floor(all.length * 0.3)], all[Math.floor(all.length * 0.6)], all[all.length - 1]];
  const chosen = [];
  for (let i = 0; i < ids.length; i += 1) {
    const preset = picks[i % picks.length];
    await globalThis.__shelfSaveBinding(ids[i], preset);
    chosen.push(preset);
  }
  return chosen;
});
console.log('  pinned:', pinned.join(', '));
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  w.zoomIn();
  w.zoomIn();
});
await page.waitForTimeout(2000);
await shot('vocab-07-bindings');

/* --------------------- 8. per-bookcase: a switch redresses ---------------- */

console.log('\n8. a second bookcase carries its OWN carpentry and paper');
step = 'second-case';
const made = await page.evaluate(async () => {
  await globalThis.__shelfWorld.zoomReset();
  const c = await globalThis.__shelfBookcases.create('Observatory');
  await globalThis.__shelfSaveDesign(
    {
      build: 'valance',
      pattern: 'lattice',
      wallpaper: { pattern: 'moonstar', scale: 'large', depth: 'raised', ink: 'gilt' },
    },
    c.id,
  );
  await globalThis.__shelfBookcases.switch(c.id);
  return c;
});
await awaitApplied({ shelf: 'valance.lattice', paper: 'moonstar' }, 'observatory case');
await page.evaluate(async () => {
  await globalThis.__shelfSeedBooks(['Star Atlas', 'Lunar Notes'], 0);
});
await page.waitForTimeout(2200);
await shot('vocab-08-second-case');

console.log('\n9. switching BACK restores the first case, undisturbed');
step = 'switch-back';
await page.evaluate(async () => {
  const list = globalThis.__shelfBookcases.list();
  const first = list.list.find((c) => c.id !== list.activeId);
  await globalThis.__shelfBookcases.switch(first.id);
});
await awaitApplied({ shelf: 'colonnade.rope', paper: 'sprig' }, 'back to case one');
await page.waitForTimeout(2200);
await shot('vocab-09-back-to-first');

/* ------------------------------- 10. reload ------------------------------- */

console.log('\n10. everything survives a reload');
step = 'reload';
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, null, 120000, 'design bridge');
await poll(
  () => document.querySelector('.shelf-a11y button') !== null,
  null,
  120000,
  'a11y mirror',
);
const skip2 = page.getByText('skip the tour');
if (await skip2.count()) await skip2.first().click();
await awaitApplied({ shelf: 'colonnade.rope', paper: 'sprig' }, 'survived reload');
await page.waitForTimeout(2000);
await shot('vocab-10-after-reload');

/* -------------------------------- verdict -------------------------------- */

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

await browser.close();
process.exit(errors.size === 0 ? 0 : 1);
