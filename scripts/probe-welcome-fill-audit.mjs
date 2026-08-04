/**
 * scripts/probe-welcome-fill-audit.mjs — measure the welcome book's leaf fill
 * against the denominator the PAGINATION CONTRACT uses, not the one
 * `probe-welcome.mjs` picked.
 *
 * Why a second measure exists at all: `probe-welcome.mjs` divides the bottom of
 * the last inked block by `proseRoot.height - proseRoot.paddingBottom`, and the
 * ProseMirror root carries `padding-bottom: 30vh` (editor.css) purely so a
 * reader can click below the last line. That is 300 drawn px on a 1000 px
 * window subtracted from a leaf that is only ~800 px tall — a denominator that
 * can flatter a page by twenty points or more. `BookView.measureCapacity` uses
 * `paper.clientHeight - paper padding`, scaled by how much the leaf is drawn
 * at, and THAT is the number `PageEditor` compares block bottoms against when
 * it decides to peel a block onto the next leaf.
 *
 * So this reports both, per leaf, plus the purely visual one a reader would
 * describe: how far down the paper's own visible box the writing reaches.
 * A claim about "fill" that only survives under one of the three is not a
 * claim about what anybody sees.
 *
 * Usage: node scripts/probe-welcome-fill-audit.mjs [outDir]
 *   SPREADS=20   how many spreads to turn through
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/welcome-fill-audit';
const SPREADS = Number(process.env.SPREADS ?? 20);
mkdirSync(outDir, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  page error:', e.message));
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

// The first-run tour's scrim swallows pointer events and its Enter handler eats
// the keypress that opens a book, and it does not always arrive before the
// shelf does — so poll for the skip link rather than waiting a fixed time.
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
      const paperRect = paper.getBoundingClientRect();
      const ps = getComputedStyle(paper);
      // The leaf carries a 3D transform, so laid-out px and drawn px are not
      // the same number — BookView.measureCapacity scales for exactly this and
      // a fill that forgets to is off by however much the spread is zoomed.
      const scale = paperRect.height / (paper.clientHeight || paperRect.height || 1);
      const padT = (Number.parseFloat(ps.paddingTop) || 0) * scale;
      const padB = (Number.parseFloat(ps.paddingBottom) || 0) * scale;
      const paginationCapacity = paperRect.height - padT - padB;

      const rootRect = root.getBoundingClientRect();
      const rootPadB =
        (Number.parseFloat(getComputedStyle(root).paddingBottom) || 0) * scale;
      const proseCapacity = rootRect.height - rootPadB;

      const kids = Array.from(root.children);
      let bottomAbs = 0;
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        const el = kids[i];
        const inked =
          (el.textContent ?? '').trim() !== '' ||
          el.querySelector('img, svg, canvas, hr, table') !== null;
        if (!inked) continue;
        bottomAbs = el.getBoundingClientRect().bottom;
        break;
      }
      const heading = paper.querySelector('.nb-prose h1, .nb-prose h2');
      out.push({
        side,
        blank: bottomAbs === 0,
        title: (heading?.textContent ?? '').trim().slice(0, 46),
        // What probe-welcome.mjs reports.
        proseFill: proseCapacity > 0 ? (bottomAbs - rootRect.top) / proseCapacity : 0,
        // What PageEditor actually measures against.
        pageFill:
          paginationCapacity > 0
            ? (bottomAbs - (paperRect.top + padT)) / paginationCapacity
            : 0,
        // What a reader describes: how far down the visible sheet the ink goes.
        inkedToPaperBottom:
          paperRect.height > 0 ? (bottomAbs - paperRect.top) / paperRect.height : 0,
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
      return before !== undefined && Math.abs((leaf.pageFill ?? 0) - (before.pageFill ?? 0)) < 0.01;
    });
    last = next;
    if (same) break;
  }
  return last;
};

const leaves = [];
let previous = '';
for (let spread = 0; spread < SPREADS; spread++) {
  await p.waitForTimeout(1500);
  let read = await readSettled();
  // A turn that did not take reports the previous spread twice — the key is
  // swallowed while the curl is still running. Press again rather than
  // counting a leaf the reader never reached.
  for (let retry = 0; retry < 3; retry++) {
    const signature = read.map((l) => l.title ?? '').join('|');
    if (spread === 0 || signature !== previous) break;
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(1500);
    read = await readSettled();
  }
  previous = read.map((l) => l.title ?? '').join('|');
  for (const leaf of read) leaves.push({ ...leaf, spread: spread + 1 });
  console.log(
    `  spread ${spread + 1}  ` +
      read
        .map((l) =>
          l.blank
            ? `${l.side}: —`
            : `${l.side}: prose ${(l.proseFill * 100).toFixed(0)}% / page ${(
                l.pageFill * 100
              ).toFixed(0)}% / sheet ${(l.inkedToPaperBottom * 100).toFixed(0)}%  "${l.title}"`,
        )
        .join('   '),
  );
  if (read.every((l) => l.blank)) break;
  await p.keyboard.press('ArrowRight');
}

const written = leaves.filter((l) => !l.blank);
const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
console.log('');
console.log(`  written leaves: ${written.length}`);
for (const [name, key] of [
  ['probe-welcome denominator (prose root − 30vh)', 'proseFill'],
  ['pagination denominator (BookView.measureCapacity)', 'pageFill'],
  ['visible sheet (what a reader sees)', 'inkedToPaperBottom'],
]) {
  const xs = written.map((l) => l[key]);
  console.log(
    `  ${name}: median ${(med(xs) * 100).toFixed(0)}%  min ${(
      Math.min(...xs) * 100
    ).toFixed(0)}%  max ${(Math.max(...xs) * 100).toFixed(0)}%  under-55%: ${
      xs.filter((x) => x < 0.55).length
    }`,
  );
}

await b.close();
