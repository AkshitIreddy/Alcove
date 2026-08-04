/**
 * scripts/probe-split-fill.mjs — does the SPLITTER put the right amount on a
 * page? Not "does a block draw at the height the table says" (that is
 * probe-block-heights) but the thing the estimator exists to decide: a long
 * document goes in, pages come out, and every one of them has to fit the leaf
 * it lands on and fill enough of it to be worth turning to.
 *
 * The failure it exists to catch is invisible from the source and from the
 * unit tests, because both sides of it are silent:
 *
 *  - **A page cut too late** does not clip. Leaves never scroll; the excess
 *    FLOWS onto the next leaf, so the book quietly comes back longer than the
 *    splitter made it and every page after the guilty one has somebody else's
 *    tail on top of it. `carriedIn` below is that, seen from the DOM.
 *  - **A page cut too early** is just a leaf that stops halfway down, which no
 *    assertion anywhere had ever been able to see.
 *
 * The document is built to be all capacity split and no headings — one `#` in
 * the whole thing — so the cuts are the estimator's own decisions rather than
 * the author's. It goes in through `createBookFromScript`, which is the same
 * call the Markdown import and the templates gallery make.
 *
 * Usage: node scripts/probe-split-fill.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/split-fill';
mkdirSync(outDir, { recursive: true });

/*
 * A document of the shape people actually import: prose, lists, a few asides,
 * a table, some code, and keepsakes — the two ends of the range the old
 * estimator got wrong in opposite directions, mixed on purpose so a single
 * fudge factor cannot rescue both.
 */
const PARA =
  'The estimator has to decide this without a browser, which is the whole ' +
  'difficulty: it is handed a parsed block and has to say how much of a leaf ' +
  'the block will take once a font it cannot see has wrapped it in a column ' +
  'it cannot measure.';
const SHORT = 'A short line on its own.';

const parts = ['# A long import with no headings in it\n'];
for (let i = 0; i < 22; i += 1) {
  parts.push(`${PARA} Section ${i}.\n`);
  if (i % 3 === 0) parts.push(`::: callout {variant=tip}\n${SHORT}\n:::\n`);
  if (i % 4 === 1) parts.push(`- ${SHORT}\n- ${SHORT}\n- ${SHORT}\n`);
  if (i % 5 === 2) parts.push(`::: index-card {title="A keepsake"}\n${PARA}\n:::\n`);
  if (i % 7 === 3) {
    parts.push('| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n');
  }
  if (i % 6 === 4) parts.push('```js\nconst a = 1;\nconst b = 2;\n```\n');
  if (i % 8 === 5) parts.push(`::: postcard {title="WISH YOU WERE HERE"}\n${SHORT}\n:::\n`);
  if (i % 9 === 6) parts.push(`${SHORT}\n`);
}
const SOURCE = parts.join('\n');

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
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

const made = await p.evaluate(async (source) => {
  const mod = await import('/src/features/templates/createFromScript.ts');
  const res = await mod.createBookFromScript(source, 'Imported');
  return { title: res.book.title, pages: res.pages.length };
}, SOURCE);
console.log(`  the splitter made ${made.pages} pages of "${made.title}"`);

await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 500,
  timeout: 90_000,
});
await p.waitForTimeout(4000);
await skipTour();

for (let attempt = 0; attempt < 6; attempt++) {
  if ((await p.locator('.nb-book-view').count()) > 0) break;
  if ((await p.locator('[data-testid="pulled-book-hand"]').count()) === 0) {
    await p
      .locator('.shelf-a11y button', { hasText: made.title })
      .first()
      .dispatchEvent('click')
      .catch(() => {});
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
  await p.screenshot({ path: `${outDir}/failed.png` });
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
      const kids = Array.from(root.children).filter((el) => el.nodeType === 1);
      const inked = (el) =>
        (el.textContent ?? '').trim() !== '' ||
        el.querySelector('img, svg, canvas, hr, table') !== null;
      let last = kids.length - 1;
      while (last >= 0 && !inked(kids[last])) last -= 1;
      if (last < 0) continue;
      const bottom = kids[last].offsetTop + kids[last].offsetHeight;
      out.push({
        first: (kids.find(inked)?.textContent ?? '').trim().slice(0, 26),
        blocks: last + 1,
        fill: bottom / capacity,
        overflowing: bottom > capacity,
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
      next.every((l, j) => Math.abs(l.fill - last[j].fill) < 0.01);
    last = next;
    if (same) break;
  }
  return last;
};

const leaves = [];
let previous = '';
for (let spread = 0; spread < 20; spread++) {
  await p.waitForTimeout(1300);
  let read = await readSettled();
  for (let retry = 0; retry < 3; retry++) {
    const signature = read.map((l) => l.first).join('|');
    if (spread === 0 || signature !== previous) break;
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(1300);
    read = await readSettled();
  }
  previous = read.map((l) => l.first).join('|');
  if (read.length === 0) break;
  for (const leaf of read) leaves.push(leaf);
  console.log(
    `  spread ${String(spread + 1).padStart(2)}  ` +
      read.map((l) => `${(l.fill * 100).toFixed(0)}%`).join('  '),
  );
  await p
    .locator('.nb-book-view')
    .screenshot({
      path: `${outDir}/spread-${String(spread + 1).padStart(2, '0')}.png`,
      animations: 'disabled',
      timeout: 15_000,
    })
    .catch(() => {});
  await p.keyboard.press('ArrowRight');
}

const fills = leaves.map((l) => l.fill).sort((a, b) => a - b);
const over = leaves.filter((l) => l.overflowing);
console.log('');
console.log(`  leaves the splitter's pages landed on: ${leaves.length} (it made ${made.pages})`);
console.log(
  `  fill: min ${(fills[0] * 100).toFixed(0)}%  median ${(
    fills[fills.length >> 1] * 100
  ).toFixed(0)}%  max ${(fills[fills.length - 1] * 100).toFixed(0)}%`,
);
if (leaves.length > made.pages) {
  console.log(
    `  OVERFLOWED: the book grew ${leaves.length - made.pages} leaves after it was made`,
  );
}
if (over.length > 0) {
  console.log(`  ${over.length} leaf/leaves is drawn past its capacity`);
}
if (leaves.length <= made.pages && over.length === 0) {
  console.log('  no page overflowed on arrival.');
}

await b.close();
