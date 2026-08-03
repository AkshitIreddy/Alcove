/**
 * shots-now/own-binding.mjs — the per-axis binding pickers reach the shelf.
 *
 * The three axes (shape, covering, marks) are now pickable one at a time, and
 * a composed choice is stored as an `own:…` id rather than as a new shape of
 * value. That design is only worth anything if the id survives the whole trip:
 * studio → designPrefs → the spine factory's params key → the drawn spine.
 *
 * A specimen board would prove none of it. So this clicks the real strips and
 * asserts on the APPLIED state, then reloads to prove it persisted.
 *
 * The trap it is built to catch: picking ONE axis must keep the other three.
 * That is the entire point of a per-axis picker, and it is exactly what a
 * careless `saveBookBinding` would lose.
 *
 * Usage: node shots-now/own-binding.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

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
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, 120000, 'design bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y');
const skip = p.getByText('skip the tour');
if (await skip.count()) await skip.first().click().catch(() => {});
await p.waitForTimeout(1500);

// The book id has to be taken BEFORE the book is opened: `__shelfVisibleBooks`
// lists what the SHELF is showing, and once a book is pulled that list is
// empty. Reading it afterwards returned null for every check on the first run
// of this file, which looked exactly like the feature being broken.
const BOOK_ID = await p.evaluate(() => globalThis.__shelfVisibleBooks?.()[0]?.id ?? null);
if (BOOK_ID === null) {
  console.log('  FAIL — no book on the shelf to dress');
  await b.close();
  process.exit(1);
}

// Open a book, then its studio — the per-axis strips live on the book sheet.
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.waitForTimeout(3500);

const dress = p.getByRole('button', { name: /dress|studio|book/i }).first();
await dress.click({ timeout: 15000 }).catch(() => {});
await p.waitForTimeout(1200);

const strip = (label) => p.locator(`[aria-label="${label}"]`).first();
if ((await strip('Spine shape').count()) === 0) {
  console.log('  FAIL — the per-axis strips are not on screen; the book studio never opened');
  await p.screenshot({ path: 'shots-now/out/own-binding-fail.png' });
  await b.close();
  process.exit(1);
}

/**
 * The binding id currently pinned, read through the world's own bridge.
 *
 * The book id has to come from the shelf too — an earlier version of this file
 * read `__shelfBookcases.books()`, which does not exist, so every check
 * "failed" on a null that meant nothing. `__shelfVisibleBooks` is the list the
 * shelf is actually showing.
 */
const pinned = async () =>
  p.evaluate((b) => globalThis.__shelfBinding?.(b) ?? null, BOOK_ID);

const pick = async (label, nth) => {
  const s = strip(label);
  const card = s.locator('button.nb-strip-tile:not(.nb-strip-more)').nth(nth);
  await card.scrollIntoViewIfNeeded();
  const name = (await card.textContent())?.trim().split('\n')[0];
  await card.click();
  await p.waitForTimeout(900);
  return name;
};

const parse = (id) => {
  if (typeof id !== 'string' || !id.startsWith('own:')) return null;
  const [shape, material, decoration, foil] = id.slice(4).split('/');
  return { shape, material, decoration, foil };
};

let failed = 0;
const note = (ok, msg) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

const shapeName = await pick('Spine shape', 2);
const afterShape = parse(await pinned());
console.log(`  picked shape ${JSON.stringify(shapeName)} -> ${JSON.stringify(afterShape)}`);
note(afterShape !== null, 'picking a shape pins a composed binding');

const matName = await pick('Covering', 3);
const afterMat = parse(await pinned());
console.log(`  picked covering ${JSON.stringify(matName)} -> ${JSON.stringify(afterMat)}`);
note(afterMat !== null, 'picking a covering pins a composed binding');
note(
  afterMat !== null && afterShape !== null && afterMat.shape === afterShape.shape,
  `the covering pick KEPT the shape (${afterShape?.shape} -> ${afterMat?.shape})`,
);

const markName = await pick('Marks', 2);
const afterMark = parse(await pinned());
console.log(`  picked mark ${JSON.stringify(markName)} -> ${JSON.stringify(afterMark)}`);
note(
  afterMark !== null && afterMat !== null &&
    afterMark.shape === afterMat.shape && afterMark.material === afterMat.material,
  'the mark pick kept the shape AND the covering',
);

// The gilt chip is the fourth axis, and it must not disturb the other three.
const giltBefore = afterMark?.foil;
await p.getByRole('button', { name: /struck in gilt|blind tooled/ }).first().click().catch(() => {});
await p.waitForTimeout(900);
const afterGilt = parse(await pinned());
note(
  afterGilt !== null && afterGilt.foil !== giltBefore,
  `the tooling chip flipped the foil (${giltBefore} -> ${afterGilt?.foil})`,
);
note(
  afterGilt !== null && afterMark !== null &&
    afterGilt.shape === afterMark.shape &&
    afterGilt.material === afterMark.material &&
    afterGilt.decoration === afterMark.decoration,
  'the tooling chip kept the other three axes',
);

await p.screenshot({ path: 'shots-now/out/own-binding.png' });

// And it survives a reload — the id is persisted, not just held in a signal.
const before = await pinned();
await p.reload({ waitUntil: 'domcontentloaded' });
await poll(() => globalThis.__shelfDesign !== undefined, 120000, 'design bridge after reload');
await p.waitForTimeout(2500);
const after = await pinned();
// Guarded, because `null === null` would otherwise be a passing reload check
// on a run where nothing was ever pinned.
note(
  before !== null && after === before,
  `survives a reload (${String(before)} === ${String(after)})`,
);

await b.close();
console.log(failed === 0 ? '\n  the composed binding travels' : `\n  ${failed} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
