/**
 * scripts/refute-page-fill-leaf.mjs — an INDEPENDENT reading of the leaf's
 * capacity, written to try and refute the page-fill claim:
 *
 *   ".nb-leaf-paper clientHeight less padding = 821px over 32px lines =
 *    25.66 lines at 1600x1000"
 *
 * It does not import the other probe or its JSON. It opens a real book in the
 * running app and reads the geometry three ways:
 *
 *   1. the BookView formula verbatim (clientHeight less the paper's padding)
 *   2. the prose root INSIDE it, whose padding is what block bottoms are
 *      actually measured from, so a leaf's usable height can be smaller than
 *      the number above
 *   3. behaviourally — hammer paragraphs into a leaf until the pagination
 *      contract carries one away, and count what the leaf kept
 *
 * Usage: node scripts/refute-page-fill-leaf.mjs [outDir]
 *   W=1600 H=1000   viewport
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/refute-page-fill';
mkdirSync(outDir, { recursive: true });
const W = Number(process.env.W ?? 1600);
const H = Number(process.env.H ?? 1000);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('  page error:', e.message));

const skipTour = async () => {
  for (let i = 0; i < 30; i++) {
    const skip = p.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) {
      if (i > 2) break;
    } else {
      await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    }
    await p.waitForTimeout(700);
  }
};

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 500,
  timeout: 90_000,
});
await p.waitForTimeout(4000);
await skipTour();

// Open whatever book the shelf is offering, by its own label.
const title = await p.evaluate(() => {
  const btn = document.querySelector('.shelf-a11y button');
  return btn === null ? null : (btn.textContent ?? '').trim();
});
console.log(`  opening: ${title}`);
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
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40_000 });
await p.waitForTimeout(2500);

const geometry = async () =>
  p.evaluate(() => {
    const out = [];
    for (const paper of document.querySelectorAll('.nb-leaf-paper')) {
      const ps = getComputedStyle(paper);
      const prose = paper.querySelector('.nb-prose');
      const capacity =
        paper.clientHeight -
        (Number.parseFloat(ps.paddingTop) || 0) -
        (Number.parseFloat(ps.paddingBottom) || 0);
      const rect = paper.getBoundingClientRect();
      const row = {
        side: paper.getAttribute('data-side') ?? '?',
        blank: paper.querySelector('.nb-leaf-blank') !== null,
        clientHeight: paper.clientHeight,
        padTop: Number.parseFloat(ps.paddingTop) || 0,
        padBottom: Number.parseFloat(ps.paddingBottom) || 0,
        capacity,
        drawnHeight: Number(rect.height.toFixed(2)),
        drawnScale: Number((rect.height / paper.clientHeight).toFixed(4)),
        lineVar: getComputedStyle(document.documentElement)
          .getPropertyValue('--page-line-height')
          .trim(),
      };
      if (prose !== null) {
        const rs = getComputedStyle(prose);
        const first = prose.querySelector('p, h1, h2, h3');
        row.prose = {
          line: Number.parseFloat(rs.lineHeight) || 0,
          padTop: Number.parseFloat(rs.paddingTop) || 0,
          padBottom: Number.parseFloat(rs.paddingBottom) || 0,
          clientHeight: prose.clientHeight,
          offsetHeight: prose.offsetHeight,
          clientWidth: prose.clientWidth,
          lineVar: rs.getPropertyValue('--page-line-height').trim(),
          firstLine:
            first === null ? null : Number.parseFloat(getComputedStyle(first).lineHeight) || 0,
        };
        // What PageEditor actually compares: block bottoms from the prose
        // root's top, plus the root's own bottom padding.
        const rootTop = prose.getBoundingClientRect().top;
        const kids = Array.from(prose.children);
        const last = kids[kids.length - 1];
        row.lastBottomFromRootTop =
          last === undefined
            ? null
            : Number((last.getBoundingClientRect().bottom - rootTop).toFixed(2));
        row.blocks = kids.length;
      }
      out.push(row);
    }
    return out;
  });

const before = await geometry();
console.log('');
console.log('  --- as laid out ---');
for (const r of before) console.log('  ', JSON.stringify(r));

await p
  .locator('.nb-book-view')
  .screenshot({ path: `${outDir}/opened.png`, animations: 'disabled', timeout: 15_000 })
  .catch(() => {});

// ---------------------------------------------------------------------------
// Behavioural: fill a leaf one line at a time and see where it stops.
// ---------------------------------------------------------------------------
// Go to the last spread so nothing is carried in from a page in front.
for (let i = 0; i < 40; i++) await p.keyboard.press('ArrowRight');
await p.waitForTimeout(2500);

const target = await p.evaluate(() => {
  const papers = Array.from(document.querySelectorAll('.nb-leaf-paper'));
  const live = papers.filter((el) => el.querySelector('.nb-prose') !== null);
  const last = live[live.length - 1];
  if (last === undefined) return null;
  return { side: last.getAttribute('data-side'), blocks: last.querySelector('.nb-prose').children.length };
});
console.log('');
console.log(`  filling the ${target?.side} leaf of the last spread (${target?.blocks} blocks on it)`);

const proseBox = await p.evaluate(() => {
  const papers = Array.from(document.querySelectorAll('.nb-leaf-paper'));
  const live = papers.filter((el) => el.querySelector('.nb-prose') !== null);
  const last = live[live.length - 1];
  const r = last.querySelector('.nb-prose').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height - 24 };
});
await p.mouse.click(proseBox.x, proseBox.y);
await p.waitForTimeout(600);
await p.keyboard.press('Control+End');
await p.waitForTimeout(400);

const countOnLeaves = async () =>
  p.evaluate(() =>
    Array.from(document.querySelectorAll('.nb-leaf-paper'))
      .filter((el) => el.querySelector('.nb-prose') !== null)
      .map((el) => {
        const prose = el.querySelector('.nb-prose');
        const rootTop = prose.getBoundingClientRect().top;
        const kids = Array.from(prose.children);
        const marks = kids.filter((k) => /^fill\d+$/.test((k.textContent ?? '').trim()));
        const last = kids[kids.length - 1];
        const paper = el;
        const ps = getComputedStyle(paper);
        return {
          side: el.getAttribute('data-side'),
          blocks: kids.length,
          fills: marks.length,
          firstFill: marks.length === 0 ? null : (marks[0].textContent ?? '').trim(),
          lastFill:
            marks.length === 0 ? null : (marks[marks.length - 1].textContent ?? '').trim(),
          lastBottom:
            last === undefined
              ? null
              : Number((last.getBoundingClientRect().bottom - rootTop).toFixed(1)),
          capacityDrawn: Number(
            (
              (paper.clientHeight -
                (Number.parseFloat(ps.paddingTop) || 0) -
                (Number.parseFloat(ps.paddingBottom) || 0)) *
              (paper.getBoundingClientRect().height / paper.clientHeight)
            ).toFixed(1),
          ),
        };
      }),
  );

const N = Number(process.env.FILL ?? 34);
for (let i = 1; i <= N; i++) {
  await p.keyboard.press('Enter');
  await p.keyboard.type(`fill${String(i).padStart(2, '0')}`);
  await p.waitForTimeout(120);
}
await p.waitForTimeout(3500);
const after = await countOnLeaves();
console.log('');
console.log('  --- after typing ---');
for (const r of after) console.log('  ', JSON.stringify(r));

await p
  .locator('.nb-book-view')
  .screenshot({ path: `${outDir}/filled.png`, animations: 'disabled', timeout: 15_000 })
  .catch(() => {});
// Whatever flowed onward lands on the NEXT spread.
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(2500);
const spilled = await countOnLeaves();
console.log('');
console.log('  --- the spread after ---');
for (const r of spilled) console.log('  ', JSON.stringify(r));
await p
  .locator('.nb-book-view')
  .screenshot({ path: `${outDir}/spilled.png`, animations: 'disabled', timeout: 15_000 })
  .catch(() => {});

writeFileSync(
  `${outDir}/reading.json`,
  `${JSON.stringify({ viewport: { W, H }, before, after, spilled }, null, 2)}\n`,
);
console.log('');
console.log(`  raw: ${outDir}/reading.json`);
await b.close();
