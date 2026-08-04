/**
 * scripts/probe-welcome-refute.mjs — an independent walk of the seeded welcome
 * book, written to check two things `probe-welcome.mjs` asserts about itself.
 *
 *  - **How far the book actually goes.** `probe-welcome.mjs` turns `SPREADS`
 *    spreads and defaults that to 14, then prints a verdict over the whole
 *    book. If the tour is longer than 14 spreads, running it the way its own
 *    header documents (`node scripts/probe-welcome.mjs`) declares every leaf
 *    filled while never having looked at the last ones. This one turns until
 *    the book runs out and says how many spreads that took.
 *
 *  - **Which capacity the fill is measured against.** `probe-welcome.mjs`
 *    divides by the prose root's drawn height minus the root's own
 *    padding-bottom. The pagination contract divides by
 *    `paper.clientHeight - paper padding`, scaled (BookView.measureCapacity),
 *    which is the number `PageEditor` compares block bottoms against. Both are
 *    reported here, per leaf, so the difference is a number rather than a
 *    reading of the CSS.
 *
 * Usage: node scripts/probe-welcome-refute.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir =
  process.argv[2] ?? 'qa/tmp/welcome-refute';
const SPREADS = Number(process.env.SPREADS ?? 24);
mkdirSync(outDir, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  page error:', e.message));
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

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
      const probeCapacity = rootRect.height - padBottom;

      // BookView.measureCapacity, verbatim — the number PageEditor compares
      // block bottoms against.
      const paperStyles = getComputedStyle(paper);
      const laidOut =
        paper.clientHeight -
        (Number.parseFloat(paperStyles.paddingTop) || 0) -
        (Number.parseFloat(paperStyles.paddingBottom) || 0);
      const paperRect = paper.getBoundingClientRect();
      const paperScale = paperRect.height / (paper.clientHeight || paperRect.height || 1);
      const contractCapacity = laidOut * paperScale;

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
      const heading = paper.querySelector('.nb-prose h1, .nb-prose h2');
      // What the READER sees left over: from the last ink to the inside foot
      // of the paper, as a fraction of the paper's drawn height.
      const blankTail =
        paperRect.height > 0
          ? (paperRect.bottom -
              (Number.parseFloat(paperStyles.paddingBottom) || 0) * paperScale -
              (rootRect.top + bottom)) /
            paperRect.height
          : 0;
      out.push({
        side,
        blank: bottom === 0,
        title: (heading?.textContent ?? '').trim().slice(0, 46),
        probeFill: probeCapacity > 0 ? bottom / probeCapacity : 0,
        contractFill: contractCapacity > 0 ? bottom / contractCapacity : 0,
        blankTail,
      });
    }
    return out;
  });

const readSettled = async () => {
  let last = await readSpread();
  for (let i = 0; i < 6; i++) {
    await p.waitForTimeout(900);
    const next = await readSpread();
    const same = next.every((leaf, j) => {
      const before = last[j];
      return (
        before !== undefined &&
        Math.abs((leaf.probeFill ?? 0) - (before.probeFill ?? 0)) < 0.01
      );
    });
    last = next;
    if (same) break;
  }
  return last;
};

const leaves = [];
let previous = '';
let walked = 0;
for (let spread = 0; spread < SPREADS; spread++) {
  await p.waitForTimeout(1600);
  let read = await readSettled();
  for (let retry = 0; retry < 3; retry++) {
    const signature = read.map((l) => l.title ?? '').join('|');
    if (spread === 0 || signature !== previous) break;
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(1600);
    read = await readSettled();
  }
  previous = read.map((l) => l.title ?? '').join('|');
  walked = spread + 1;
  await p
    .locator('.nb-book-view')
    .screenshot({
      path: `${outDir}/spread-${String(spread + 1).padStart(2, '0')}.png`,
      animations: 'disabled',
      timeout: 20_000,
    })
    .catch(() => {});
  for (const leaf of read) leaves.push({ ...leaf, spread: spread + 1 });
  console.log(
    `  spread ${spread + 1}  ` +
      read
        .map((l) =>
          l.blank
            ? `${l.side}: —`
            : `${l.side}: probe ${(l.probeFill * 100).toFixed(0)}% / contract ${(
                l.contractFill * 100
              ).toFixed(0)}% / blank tail ${(l.blankTail * 100).toFixed(0)}% "${l.title}"`,
        )
        .join('   '),
  );
  if (read.every((l) => l.blank)) break;
  await p.keyboard.press('ArrowRight');
}

const written = leaves.filter((l) => !l.blank);
const lastWritten = written[written.length - 1];
console.log('');
console.log(`  spreads walked: ${walked}`);
console.log(`  written leaves: ${written.length}`);
console.log(`  last written leaf is on spread ${lastWritten?.spread} ("${lastWritten?.title}")`);
console.log(
  `  median probe fill ${(
    written.map((l) => l.probeFill).sort((a, c) => a - c)[written.length >> 1] * 100
  ).toFixed(0)}%   median contract fill ${(
    written.map((l) => l.contractFill).sort((a, c) => a - c)[written.length >> 1] * 100
  ).toFixed(0)}%`,
);
const thin = written.filter((l) => l.contractFill < 0.55);
console.log(`  leaves under 55% by the contract measure: ${thin.length}`);
for (const l of thin) {
  console.log(`    spread ${l.spread} ${l.side} "${l.title}" ${(l.contractFill * 100).toFixed(0)}%`);
}
console.log(
  `  leaves the shipped default (SPREADS=14) never reaches: ${
    written.filter((l) => l.spread > 14).length
  }`,
);
for (const l of written.filter((c) => c.spread > 14)) {
  console.log(`    spread ${l.spread} ${l.side} "${l.title}"`);
}

await b.close();
