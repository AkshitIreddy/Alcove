/**
 * shots-now/bookfit.mjs — thirty dice-rolled books against five carpentries,
 * and nothing may cross the woodwork.
 *
 * Reported, looking at `docs/readme/img/shelf.png`: *"the books are cutting
 * into the bookshelf design"*. They were. Every spine's height came out of the
 * flat plank-to-plank gap, which is the right number for a plain plank case
 * and wrong for the fifty-one builds whose opening has a shape — so under an
 * arcade the tall spines ran straight up past the arch heads into the board
 * above.
 *
 * `tests/shelf-headroom.test.ts` proves the arithmetic in node. This is the
 * other half, and the repo has a rule about the difference: a unit test proves
 * a module is self-consistent and says nothing about whether the app can
 * REACH it. So this drives the running shelf, saves each build through the
 * world's own `__shelfSaveDesign` bridge, and reads the APPLIED heights back
 * out of `__shelfBookFit` — the sprite's height beside the clear height of the
 * bay it is standing in, not what anybody stored.
 *
 * It also photographs each row, because "nothing crosses" is a number and
 * "the shelf still looks like a shelf" is not: trimming every tall book to
 * exactly the clear height would pass the assertion and leave an arcaded case
 * with a dead flat skyline.
 *
 * Usage:
 *   node shots-now/bookfit.mjs                     # the five named builds
 *   node shots-now/bookfit.mjs --builds=all        # every one of the 52
 *   node shots-now/bookfit.mjs --tag=after
 *
 * Outputs: shots-now/bookfit/<tag>-<build>.png  (+ -zoom.png), and a summary
 * line per build. Exit code 1 if any book crosses its carpentry.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const TAG = opt('tag', 'fit');
const PER_FLOOR = Number(opt('n', '15'));
/**
 * Photograph each build as well as measuring it. On by default, because the
 * number ("nothing crosses") and the picture ("and the row still looks like a
 * row") are two different questions. `--shots=0` is for the `--builds=all`
 * sweep, where a hundred and four PNGs is a worse artefact than none.
 */
const SHOTS = opt('shots', '1') !== '0';

/**
 * The five the reader named — one from each shape of head, plus the plain
 * plank as the control that must come out unchanged.
 *
 *   plank      no head at all       (the regression guard)
 *   arch       round arcade
 *   gothic     pointed arcade
 *   refectory  ogee arcade
 *   valance    scalloped pelmet
 *   chapel     trefoil tracery
 *   pigeonhole a flat grid of cubbies — the deepest head in the table
 */
const NAMED = ['plank', 'arch', 'gothic', 'refectory', 'valance', 'chapel', 'pigeonhole'];

const TITLES = [
  'Cell Biology', 'Kanji Practice', 'Watercolour', 'Tea Journal', 'Linear Algebra',
  'SQL Spellbook', 'Birdsong', 'Field Notes', 'The Long Walk', 'Sourdough',
  'Alpine Flora', 'Letters Home', 'The Salt Road', 'Recipes', 'Marginalia',
  'Cloud Atlas', 'Bee Keeping', 'Grammar', 'Night Sky', 'Ledger',
  'Poems', 'Sketches', 'Harbour Log', 'Dream Diary', 'Herbal',
  'Chess Games', 'Old Maps', 'Quiet Hours', 'The Orchard', 'Almanac',
];

mkdirSync('shots-now/bookfit', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  if (!errors.has(k)) console.log(`  pageerror: ${k}`);
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
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
await poll(() => globalThis.__shelfBookFit !== undefined, 120000, 'fit bridge');
for (let a = 0; a < 4; a += 1) {
  const card = page.locator('text=skip the tour').first();
  if ((await card.count()) === 0) break;
  await card.click({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
}
await page.waitForTimeout(1200);

// One shelf of books, dressed once, then rebuilt under five carpentries. Same
// thirty books throughout: the only thing that moves between the boards is the
// case, which is what makes them comparable.
await page.evaluate(() => globalThis.__shelfEmptyLibrary());
await page.waitForTimeout(1000);
const titles = [];
for (let i = 0; i < PER_FLOOR * 2; i += 1) titles.push(TITLES[i % TITLES.length]);
await page.evaluate(([t, n]) => globalThis.__shelfSeedBooks(t.slice(0, n), 0), [titles, PER_FLOOR]);
await page.evaluate(([t, n]) => globalThis.__shelfSeedBooks(t.slice(n), 1), [titles, PER_FLOOR]);
await page.waitForTimeout(3500);

const builds =
  opt('builds', '') === 'all'
    ? await page.evaluate(async () => (await import('/src/art/shelfDesign.ts')).BUILD_IDS)
    : opt('builds', '').length > 0
      ? opt('builds', '').split(',')
      : NAMED;

const report = [];
let bad = 0;

for (const build of builds) {
  await page.evaluate(
    (b) =>
      globalThis.__shelfSaveDesign({
        build: b,
        pattern: 'none',
        wallpaper: { pattern: 'plain', scale: 'medium', depth: 'flat', ink: 'paper' },
      }),
    build,
  );
  // The case re-bakes and every mounted floor is laid out again against the new
  // clear height; wait for the design the world says is APPLIED to be this one.
  await poll(
    (b) => globalThis.__shelfDesign().design.shelf?.build === b,
    30000,
    `${build} applied`,
  ).catch(() => {});
  await page.waitForTimeout(2600);

  const fit = await page.evaluate(() => globalThis.__shelfBookFit());
  const crossing = fit.filter((f) => f.crosses);
  const trimmed = fit.filter((f) => f.trimmed).length;
  const heights = fit.map((f) => Math.round(f.height));
  const distinct = new Set(heights).size;
  const clear = fit.length > 0 ? Math.round(Math.min(...fit.map((f) => f.clear))) : 0;
  const clearMax = fit.length > 0 ? Math.round(Math.max(...fit.map((f) => f.clear))) : 0;
  report.push({ build, books: fit.length, clear, clearMax, trimmed, distinct, crossing: crossing.length });
  if (crossing.length > 0) {
    bad += 1;
    console.log(
      `  ${build}: ${crossing.length} CROSSING — ` +
        crossing
          .slice(0, 5)
          .map((c) => `${c.title} ${Math.round(c.height)} > ${Math.round(c.clear)}`)
          .join(', '),
    );
  }
  console.log(
    `${build.padEnd(12)} books=${String(fit.length).padStart(2)} ` +
      `clear=${clear}..${clearMax} trimmed=${trimmed} distinct-heights=${distinct} ` +
      `crossing=${crossing.length}`,
  );

  // The picture, at the zoom the app opens on and then close enough to see an
  // arch line against a spine.
  if (!SHOTS) continue;
  await page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const cam = w.camera;
    cam.vx = 0;
    cam.vy = 0;
    cam.anchor = null;
    cam.zoom = 1;
    cam.logZoomTarget = 0;
    cam.x = 600;
    cam.y = 150;
    w.dirty = true;
  });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `shots-now/bookfit/${TAG}-${build}.png` });
  await page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const cam = w.camera;
    cam.zoom = 2.2;
    cam.logZoomTarget = Math.log(2.2);
    cam.x = 420;
    cam.y = 30;
    w.dirty = true;
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `shots-now/bookfit/${TAG}-${build}-zoom.png` });
}

writeFileSync(`shots-now/bookfit/${TAG}.json`, JSON.stringify(report, null, 1));
console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);
console.log(`\n${bad === 0 ? 'OK — nothing crosses the carpentry' : `${bad} build(s) with books through the woodwork`}`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
