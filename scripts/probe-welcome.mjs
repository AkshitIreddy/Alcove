/**
 * scripts/probe-welcome.mjs — walk the seeded welcome book in the RUNNING app
 * and measure how much of each leaf the page actually covers.
 *
 * Two defects this exists to catch, and neither is visible from the source:
 *
 *  - **A page that stops halfway down its leaf.** The owner's report was
 *    exactly this ("a lot of pages have empty space at the second half"), and
 *    nothing in the suite could see it: `tests/data-seed.test.ts` costs a page
 *    with the pagination estimator and only refuses one that is OVER budget, so
 *    a page at a third of its capacity passes every gate there is. The measure
 *    here is the one the pagination contract itself uses — the bottom of the
 *    last block against `pageCapacityPx` (BookView.measureCapacity), in DRAWN
 *    pixels, because that is what PageEditor compares block bottoms against.
 *
 *  - **A page that overflowed and rearranged the tour.** Leaves never scroll;
 *    excess FLOWS onward, so an over-long page silently pushes its tail into
 *    the next leaf and the book comes back with more pages than
 *    `WELCOME_PAGE_SOURCES` has entries. Counting the leaves the book actually
 *    grew is the only way to see it.
 *
 * Measured off the live DOM rather than through an `import('/src/data/…')`:
 * a probe's own import can resolve to a SECOND copy of a module on a dev
 * server that has served HMR updates, and rendered pixels cannot lie about
 * which copy drew them.
 *
 * Usage: node scripts/probe-welcome.mjs [outDir]
 *   SPREADS=12   how many spreads to turn through (default 14)
 *   FILL=0.55    the fill ratio below which a leaf is called half empty
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/welcome';
const SPREADS = Number(process.env.SPREADS ?? 14);
const FILL_FLOOR = Number(process.env.FILL ?? 0.55);
mkdirSync(outDir, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  page error:', e.message));
// Headless Chromium can report reduced motion, which swaps the real page-edge
// flip for a crossfade. This probe is meant to walk the reader's normal path.
await p.emulateMedia({ reducedMotion: 'no-preference' });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

// The first-run tour auto-starts and does not always arrive before the shelf
// does, so this POLLS for the skip link. Its scrim swallows pointer events and
// its Enter handler eats the keypress that opens a book — nothing below works
// until it is gone.
for (let i = 0; i < 30; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) {
    if (i > 2) break;
  } else {
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  }
  await p.waitForTimeout(800);
}

// Pull, then open — two separate gestures. The pull is a GSAP flight that first
// run can interrupt; the open is Enter on the resting book, which is the one
// path that does not depend on where the flight parked it.
for (let attempt = 0; attempt < 6; attempt++) {
  if ((await p.locator('.nb-book-view').count()) > 0) break;
  if ((await p.locator('[data-testid="pulled-book-hand"]').count()) === 0) {
    await p.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    await p
      .locator('[data-testid="pulled-book-hand"]')
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
  }
  await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
}
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40_000 }).catch(() => {});
await p.waitForTimeout(2500);

const view = p.locator('.nb-book-view');
if ((await view.count()) === 0) {
  console.log('  book view never opened — is the dev server up on :1420?');
  await p.screenshot({ path: `${outDir}/failed.png` });
  await b.close();
  process.exit(1);
}

/**
 * Both leaves of the current spread, and how far down each one the writing
 * reaches.
 *
 * Measured against the PROSE ROOT rather than the leaf's own client box. The
 * spread stretches the root to fill the leaf (PageEditor says so where it
 * refuses to trust `scrollHeight` for the same reason), so the root's drawn
 * rect IS the room a page has — and it is in the same drawn pixels as the block
 * bottoms, which the leaf's laid-out `clientHeight` is not: a leaf carries a 3D
 * transform, and dividing its bounding box by its client height to recover the
 * scale reported pages at half the fill anyone could see on the screenshot.
 *
 * Reading the trailing empty paragraph as content would report every page that
 * ends in a container as fuller than it is — StarterKit keeps one there so a
 * reader can always type past a table — so the scan walks back over blocks with
 * no ink in them.
 */
const readSpread = async () =>
  p.evaluate(() => {
    const out = [];
    for (const paper of document.querySelectorAll('.nb-leaf-paper')) {
      const side = paper.getAttribute('data-side') ?? '?';
      const root = paper.querySelector('.nb-prose');
      if (paper.querySelector('.nb-leaf-blank') !== null || root === null) {
        out.push({ side, blank: true });
        continue;
      }
      const rootRect = root.getBoundingClientRect();
      const drawn = rootRect.height / (root.clientHeight || rootRect.height || 1);
      const scale = Number.isFinite(drawn) && drawn > 0 ? drawn : 1;
      const padBottom =
        (Number.parseFloat(getComputedStyle(root).paddingBottom) || 0) * scale;
      const capacity = rootRect.height - padBottom;

      const kids = Array.from(root.children);
      let bottom = 0;
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        const el = kids[i];
        const inked =
          (el.textContent ?? '').trim() !== '' ||
          el.querySelector('img, svg, canvas, hr, table') !== null;
        if (!inked) continue;
        bottom = el.getBoundingClientRect().bottom - rootRect.top;
        break;
      }
      // Every seeded page opens with its own H1. So a leaf whose first inked
      // block is something else has been handed the TAIL of the page before
      // it — the overflow contract firing, which is the failure this probe
      // exists for and the one a fill reading cannot show: once the excess has
      // been carried away the guilty page measures a comfortable 96%.
      const first = kids.find(
        (el) =>
          (el.textContent ?? '').trim() !== '' ||
          el.querySelector('img, svg, canvas, hr, table') !== null,
      );
      const heading = paper.querySelector('.nb-prose h1, .nb-prose h2');
      out.push({
        side,
        blank: bottom === 0,
        title: (heading?.textContent ?? '').trim().slice(0, 46),
        blocks: kids.length,
        carriedIn: first !== undefined && first.tagName !== 'H1',
        fill: capacity > 0 ? bottom / capacity : 0,
        overflowing: capacity > 0 && bottom > capacity,
      });
    }
    return out;
  });

/**
 * Read until two readings agree.
 *
 * A leaf is not its final height the moment it mounts: the overflow drain
 * MOVES blocks between pages, diagram node views lay themselves out a frame
 * late, and a page photographed in between reports a fill it will not have a
 * second later. Two consecutive runs of this that differed by forty points on
 * a page nobody had edited are what put this loop here — a single reading is a
 * coin toss, not a measurement.
 */
const readSettled = async () => {
  let last = await readSpread();
  for (let i = 0; i < 6; i++) {
    await p.waitForTimeout(900);
    const next = await readSpread();
    const same = next.every((leaf, j) => {
      const before = last[j];
      return before !== undefined && Math.abs((leaf.fill ?? 0) - (before.fill ?? 0)) < 0.01;
    });
    last = next;
    if (same) break;
  }
  return last;
};

/** Turn through the same outer-edge pointer target a reader uses. */
const turnNext = async () => {
  await p.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await p.waitForTimeout(150);
  const hot = await p.locator('.nb-flip-hotspot-next').first().boundingBox();
  if (hot === null) throw new Error('no next hotspot — the book is not open');
  await p.mouse.click(hot.x + hot.width / 2, hot.y + hot.height / 2);
};

const leaves = [];
let previous = '';
for (let spread = 0; spread < SPREADS; spread++) {
  await p.waitForTimeout(1600);
  let read = await readSettled();
  // A turn that did not take photographs the previous spread twice and reports
  // a page as being in the book that is not — a pointer tap is ignored while
  // the prior flip is still settling. Tap the real edge again rather than
  // trusting the first attempt.
  for (let retry = 0; retry < 3; retry++) {
    const signature = read.map((l) => l.title ?? '').join('|');
    if (spread === 0 || signature !== previous) break;
    await turnNext();
    await p.waitForTimeout(1600);
    read = await readSettled();
  }
  previous = read.map((l) => l.title ?? '').join('|');
  const shot = `${outDir}/spread-${String(spread + 1).padStart(2, '0')}.png`;
  // `animations: 'disabled'` — the leaf has a resting shimmer that never
  // settles, and Playwright waits for stability until it times out.
  await view
    .screenshot({ path: shot, animations: 'disabled', timeout: 20_000 })
    .catch(async () => {
      await p.screenshot({ path: shot });
    });

  for (const leaf of read) leaves.push({ ...leaf, spread: spread + 1, shot });
  const line = read
    .map((l) =>
      l.blank
        ? `${l.side}: —`
        : `${l.side}: ${(l.fill * 100).toFixed(0)}% "${l.title}"`,
    )
    .join('   ');
  console.log(`  spread ${spread + 1}  ${line}`);

  if (read.every((l) => l.blank)) break;
  await turnNext();
}

const written = leaves.filter((l) => !l.blank);
const thin = written.filter((l) => l.fill < FILL_FLOOR);
const over = written.filter((l) => l.overflowing || l.carriedIn);

console.log('');
console.log(`  leaves with writing on them: ${written.length}`);
console.log(
  `  median fill: ${(
    written.map((l) => l.fill).sort((a, b) => a - b)[written.length >> 1] * 100
  ).toFixed(0)}%`,
);
if (thin.length > 0) {
  console.log(`  HALF EMPTY (< ${(FILL_FLOOR * 100).toFixed(0)}%):`);
  for (const l of thin) {
    console.log(`    p${written.indexOf(l) + 1} "${l.title}" ${(l.fill * 100).toFixed(0)}%  ${l.shot}`);
  }
}
if (over.length > 0) {
  console.log('  OVERFLOWED — a page tail is being carried onto this leaf:');
  for (const l of over) {
    console.log(
      `    before "${l.title}" (${(l.fill * 100).toFixed(0)}%)  ${l.shot}` +
        ` — the page BEFORE this one is the long one`,
    );
  }
}
if (thin.length === 0 && over.length === 0) {
  console.log('  every written leaf is filled and none of them overflow.');
}

await b.close();
