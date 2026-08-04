/**
 * scripts/probe-page-cost.mjs — what a seeded page ACTUALLY costs its leaf,
 * in the same unit `blockLineCost` is written in, so the estimator can be
 * checked against a number of the same kind rather than against a fill.
 *
 * Why not just use the fill `probe-welcome.mjs` reports: a fill is the bottom
 * of the last INKED block over the leaf's capacity. An estimator's total is a
 * sum of what each block spends, which includes the margin under the last one
 * and the space above the first — so a page whose ink reaches 69% of the leaf
 * may still cost 71% of it, and calibrating one against the other builds that
 * difference into the constants. This walks the same leaves and sums the same
 * thing the estimator sums: for each top-level block, the distance to the top
 * of the next one (margins collapse, so that IS what the page spends on it),
 * and for the last one its own box plus the margin under it.
 *
 * Laid-out pixels throughout (`offsetTop`/`offsetHeight`), divided by the
 * leaf's own `--page-line-height`. A leaf carries a 3D transform, so drawn px
 * and CSS px differ by whatever the spread is scaled to and only laid-out px
 * are in the same units as the line height they are divided by.
 *
 * Usage: node scripts/probe-page-cost.mjs [outFile]
 *   SPREADS=20   how many spreads to turn through
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const outFile = process.argv[2] ?? 'qa/tmp/page-cost.json';
mkdirSync(dirname(outFile), { recursive: true });
const SPREADS = Number(process.env.SPREADS ?? 18);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('  page error:', e.message));
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

// The first-run tour's scrim swallows pointer events and its Enter handler
// eats the keypress that opens a book, and it does not always arrive before
// the shelf does — so poll for the skip link rather than waiting a fixed time.
for (let i = 0; i < 30; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) {
    if (i > 2) break;
  } else {
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  }
  await p.waitForTimeout(800);
}

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

if ((await p.locator('.nb-book-view').count()) === 0) {
  console.log('  book view never opened — is the dev server up on :1420?');
  await b.close();
  process.exit(1);
}

const readSpread = async () =>
  p.evaluate(() => {
    const out = [];
    for (const paper of document.querySelectorAll('.nb-leaf-paper')) {
      const root = paper.querySelector('.nb-prose');
      if (paper.querySelector('.nb-leaf-blank') !== null || root === null) continue;
      const ps = getComputedStyle(paper);
      const line = Number.parseFloat(getComputedStyle(root).lineHeight) || 32;
      const capacity =
        paper.clientHeight -
        (Number.parseFloat(ps.paddingTop) || 0) -
        (Number.parseFloat(ps.paddingBottom) || 0);

      // Trailing empty blocks are not content: StarterKit keeps a paragraph
      // after a container so a reader can always type past one, and counting
      // it would report every page that ends in a card as costing a line more
      // than it does.
      const kids = Array.from(root.children).filter((el) => el.nodeType === 1);
      const inked = (el) =>
        (el.textContent ?? '').trim() !== '' ||
        el.querySelector('img, svg, canvas, hr, table') !== null;
      let last = kids.length - 1;
      while (last >= 0 && !inked(kids[last])) last -= 1;

      let cost = 0;
      const blocks = [];
      for (let i = 0; i <= last; i += 1) {
        const el = kids[i];
        const next = kids[i + 1];
        const spend =
          i < last && next !== undefined
            ? next.offsetTop - el.offsetTop
            : el.offsetHeight +
              (Number.parseFloat(getComputedStyle(el).marginBottom) || 0);
        cost += spend;
        blocks.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('data-type'),
          lines: spend / line,
          text: (el.textContent ?? '').trim().slice(0, 30),
        });
      }
      const heading = paper.querySelector('.nb-prose h1, .nb-prose h2');
      out.push({
        side: paper.getAttribute('data-side') ?? '?',
        title: (heading?.textContent ?? '').trim(),
        blocks,
        lines: cost / line,
        capacityLines: capacity / line,
        // A page whose first inked block is not its own H1 has been handed the
        // tail of the page before it — the overflow contract firing.
        carriedIn: kids.find(inked)?.tagName !== 'H1',
      });
    }
    return out;
  });

const readSettled = async () => {
  let last = await readSpread();
  for (let i = 0; i < 6; i++) {
    await p.waitForTimeout(800);
    const next = await readSpread();
    const same =
      next.length === last.length &&
      next.every((leaf, j) => Math.abs(leaf.lines - last[j].lines) < 0.02);
    last = next;
    if (same) break;
  }
  return last;
};

const leaves = [];
let previous = '';
for (let spread = 0; spread < SPREADS; spread++) {
  await p.waitForTimeout(1400);
  let read = await readSettled();
  for (let retry = 0; retry < 3; retry++) {
    const signature = read.map((l) => l.title).join('|');
    if (spread === 0 || signature !== previous) break;
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(1400);
    read = await readSettled();
  }
  previous = read.map((l) => l.title).join('|');
  // Past the last written leaf the book shows empty paper; a leaf with
  // nothing on it is the end of the walk, not a page costing nothing.
  read = read.filter((l) => l.lines > 0.01);
  if (read.length === 0) break;
  for (const leaf of read) leaves.push(leaf);
  console.log(
    `  spread ${String(spread + 1).padStart(2)}  ` +
      read
        .map((l) => `${l.side}: ${l.lines.toFixed(2)} lines  "${l.title.slice(0, 34)}"`)
        .join('   '),
  );
  await p.keyboard.press('ArrowRight');
}

const carried = leaves.filter((l) => l.carriedIn);
console.log('');
console.log(`  leaves: ${leaves.length}, capacity ${leaves[0]?.capacityLines.toFixed(2)} lines`);
console.log(
  `  cost: min ${Math.min(...leaves.map((l) => l.lines)).toFixed(2)} ` +
    `max ${Math.max(...leaves.map((l) => l.lines)).toFixed(2)}`,
);
if (carried.length > 0) {
  console.log(`  OVERFLOWED onto: ${carried.map((l) => `"${l.title}"`).join(', ')}`);
} else {
  console.log('  no leaf is carrying another page\'s tail.');
}
writeFileSync(outFile, `${JSON.stringify(leaves, null, 2)}\n`);
console.log(`  raw: ${outFile}`);

await b.close();
