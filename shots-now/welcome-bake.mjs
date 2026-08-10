/**
 * shots-now/welcome-bake.mjs — a brand-new library's one book is actually bound.
 *
 * THE BUG. On a fresh library the single Welcome book rendered as a flat
 * placeholder rectangle, indefinitely. Measured: `hi:false, lo:false` and an
 * EMPTY factory queue thirty seconds in, so nothing was ever asking; a manual
 * `factory.request()` baked it instantly, and adding any second book baked the
 * first as a side effect.
 *
 * `requestSpines` reads `fv.visuals`, a floor mounted before its data lands has
 * none, and neither path that would ask later covers it — `handleFloorData`
 * skips a floor that is not mounted yet and never revisits it, and the mount
 * path asks with whatever the store held at that instant. On a stocked library
 * any later pan or floor load re-asks and it never showed. On a NEW one it was
 * the first thing a reader ever saw.
 *
 * This is the regression test, and it deliberately checks the ONE-BOOK case:
 * seeding a second book is exactly what used to paper over it. It also opens
 * that clean-seeded book without applying a QA style override, so the shelf
 * and held-cover shots prove the authored Welcome exterior itself.
 *
 * Usage: node shots-now/welcome-bake.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (;;) {
  if (await p.evaluate(() => globalThis.__shelfWorld !== undefined)) break;
  await p.waitForTimeout(100);
}
const skip = p.getByText('skip the tour');
if (await skip.count()) await skip.first().click().catch(() => {});

const sample = () =>
  p.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const books = globalThis.__shelfVisibleBooks?.() ?? [];
    return {
      n: books.length,
      rows: books.map((bk) => ({
        id: bk.id,
        title: bk.title.slice(0, 24),
        binding: globalThis.__shelfBinding?.(bk.id) ?? null,
        style: globalThis.__shelfBookMeta?.(bk.id)?.style ?? null,
        hi: w.factory.get(bk.id, 'hi') !== undefined,
        lo: w.factory.get(bk.id, 'lo') !== undefined,
      })),
    };
  });

let settled = null;
const t0 = Date.now();
for (;;) {
  const s = await sample();
  if (s.n > 0 && s.rows.every((r) => r.hi || r.lo)) {
    settled = { at: Date.now() - t0, ...s };
    break;
  }
  if (Date.now() - t0 > 25000) {
    settled = { at: -1, ...s };
    break;
  }
  await p.waitForTimeout(250);
}

console.log('  ', JSON.stringify(settled));
// NOTHING is seeded before this check, on purpose: adding a second book is
// what used to hide the bug.
const welcome = settled.rows[0] ?? null;
const style = welcome?.style ?? null;
const ok =
  settled.at >= 0 &&
  settled.n === 1 &&
  welcome?.title.startsWith('Welcome to Alcove') === true &&
  welcome.binding === 'gilt-quarto' &&
  style?.material === undefined &&
  style?.pigment === 29 &&
  style?.spineBaseHex === '#394c70' &&
  style?.coverBaseHex === '#475d82' &&
  style?.ornament === 0 &&
  style?.titlePlate === 'gilt-direct' &&
  style?.titleFont === 44 &&
  style?.coverFrame === 48 &&
  style?.coverMedallion === 0 &&
  style?.cornerProtectors === false &&
  style?.insetPlate === false &&
  style?.charm === 'none';
console.log(
  ok
    ? `  PASS — the lone Grand-blue quarto is baked ${settled.at}ms in`
    : '  FAIL — the clean-seeded welcome exterior is missing or unbaked',
);

await p.waitForTimeout(1500);
await p.screenshot({ path: 'shots-now/out/welcome-bake.png' });
console.log('  shot shots-now/out/welcome-bake.png');
if (welcome !== null) {
  await p.waitForFunction(() => globalThis.__shelfPullOut !== undefined, null, {
    timeout: 30000,
  });
  await p.evaluate((id) => globalThis.__shelfPullOut(id), welcome.id);
  // SwiftShader can take longer than the nominal GSAP duration. A fixed sleep
  // photographs the flight and makes a healthy cover look clipped or tiny;
  // the class is applied only when the book has actually landed.
  await p.locator('.pulled-book.is-held').waitFor({ state: 'visible', timeout: 30000 });
  await p.waitForTimeout(250);
  await p.screenshot({ path: 'shots-now/out/welcome-crown-held.png' });
  console.log('  shot shots-now/out/welcome-crown-held.png');
}
await b.close();
process.exit(ok ? 0 : 1);
