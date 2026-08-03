/**
 * shots-now/preset-bakes.mjs — one room preset click costs ONE bake.
 *
 * A room lives in two stores (colours on the bookcase, carpentry + paper in
 * the studio's settings), so applying a preset is two writes and the world
 * used to re-apply — and re-bake the case and the wall — once per write.
 * `libraryGen` made the wasted bake harmless, not free.
 *
 * The world now folds notifications that land in one tick into a single
 * application. The only honest way to check that is to COUNT bakes across a
 * real click, which is what `__shelfDesign().bakes` is for.
 *
 * Drives the studio by clicking, not through the write bridges: the bridges
 * would let a probe reproduce the two-write pattern by hand and prove nothing
 * about the path a reader actually takes.
 *
 * Usage: node shots-now/preset-bakes.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const poll = async (fn, timeout, label) => {
  const t0 = Date.now();
  for (;;) {
    const v = await p.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await p.waitForTimeout(250);
  }
};

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, 120000, 'design bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y');
const skip = p.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await p.waitForTimeout(1500);

await p.getByRole('button', { name: /studio/i }).first().click();
await p.waitForSelector('.nb-library-studio', { timeout: 20000 });
await p.waitForTimeout(1200);

// The preset strip. Clicking a card writes BOTH stores — that is the point.
const strip = p.locator('[aria-label="Room preset"], [aria-label="Room presets"]').first();
if ((await strip.count()) === 0) {
  console.log('  FAIL — no room-preset strip found; selectors moved');
  await b.close();
  process.exit(1);
}
const cards = strip.locator('button.nb-strip-tile:not(.nb-strip-more)');
const n = await cards.count();
console.log(`  preset cards on the strip: ${n}`);

const rows = [];
// Several DIFFERENT presets in a row: a repeat click is a no-op (the key does
// not change) and would score a flattering zero.
for (const i of [1, 2, 3]) {
  if (i >= n) break;
  const card = cards.nth(i);
  await card.scrollIntoViewIfNeeded();
  const name = (await card.textContent())?.trim().split('\n')[0];

  const before = await p.evaluate(() => globalThis.__shelfDesign());
  await card.click();
  // Wait for the applied key to settle, then a beat more, so a SECOND bake
  // would have had every chance to start before we read the counter.
  const t0 = Date.now();
  for (;;) {
    const now = await p.evaluate(() => globalThis.__shelfDesign().libraryKey);
    if (now !== before.libraryKey || Date.now() - t0 > 30000) break;
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(1800);
  const after = await p.evaluate(() => globalThis.__shelfDesign());

  const delta = after.bakes - before.bakes;
  const changed = after.libraryKey !== before.libraryKey;
  rows.push({ name, delta, changed });
  console.log(
    `  ${JSON.stringify(name)}  bakes +${delta}  ${changed ? 'room changed' : 'ROOM DID NOT CHANGE'}`,
  );
}

await b.close();

const applied = rows.filter((r) => r.changed);
const wasteful = applied.filter((r) => r.delta !== 1);
if (applied.length === 0) {
  console.log('\n  FAIL — no preset actually changed the room, so nothing was measured');
  process.exit(1);
}
console.log(
  wasteful.length === 0
    ? `\n  PASS — ${applied.length} preset changes, exactly one bake each`
    : `\n  FAIL — ${wasteful.map((r) => `${r.name}: ${r.delta} bakes`).join(', ')}`,
);
process.exit(wasteful.length === 0 ? 0 : 1);
