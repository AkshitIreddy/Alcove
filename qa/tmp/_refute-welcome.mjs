/**
 * Refutation probe for the "welcome book is now 32 pages" claim.
 *
 * Independent of scripts/probe-welcome.mjs: counts the leaves the READER gets
 * off the thumbnail strip (one `.nb-thumb` per row in the pages table), not off
 * the length of an imported constant, and looks for the node types the tour
 * claims to draw rather than for the words describing them. A page whose
 * `codeBlock` silently degraded to a paragraph reads identically in the source
 * and is invisible to a fill measurement.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/refute-welcome';
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
  console.log('  book view never opened');
  await p.screenshot({ path: `${outDir}/failed.png` });
  await b.close();
  process.exit(1);
}

const title = await p.locator('.nb-book-view').getAttribute('data-book-title').catch(() => null);
console.log('  book title attr:', title);

// --- how many leaves the book actually has, off the filmstrip -------------
await p.locator('button[aria-label^="Thumbnails strip"]').first().click({ timeout: 8000 }).catch(async () => {
  await p.locator('[title^="Thumbnails strip"]').first().click({ timeout: 8000 }).catch(() => {});
});
await p.waitForTimeout(2500);
const thumbs = await p.locator('.nb-thumb').count();
console.log('  thumbnails in the strip (= pages in the book):', thumbs);
await p.screenshot({ path: `${outDir}/thumbstrip.png` });
// close it again so it does not eat leaf height while walking
await p.locator('button[aria-label^="Thumbnails strip"]').first().click({ timeout: 8000 }).catch(() => {});
await p.waitForTimeout(1200);

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
      const rect = root.getBoundingClientRect();
      const drawn = rect.height / (root.clientHeight || rect.height || 1);
      const scale = Number.isFinite(drawn) && drawn > 0 ? drawn : 1;
      const padBottom = (Number.parseFloat(getComputedStyle(root).paddingBottom) || 0) * scale;
      const capacity = rect.height - padBottom;
      const kids = Array.from(root.children);
      const inked = (el) =>
        (el.textContent ?? '').trim() !== '' ||
        el.querySelector('img, svg, canvas, hr, table, pre') !== null;
      let bottom = 0;
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        if (!inked(kids[i])) continue;
        bottom = kids[i].getBoundingClientRect().bottom - rect.top;
        break;
      }
      const first = kids.find(inked);
      // what the leaf actually DREW, so a degraded node shows up as a missing tag
      const tags = {
        pre: paper.querySelectorAll('.nb-prose pre').length,
        svg: paper.querySelectorAll('.nb-prose svg').length,
        table: paper.querySelectorAll('.nb-prose table').length,
        img: paper.querySelectorAll('.nb-prose img').length,
        katex: paper.querySelectorAll('.nb-prose .katex').length,
      };
      const nodeTypes = [
        ...new Set(
          Array.from(paper.querySelectorAll('.nb-prose [data-node-type], .nb-prose [data-type]')).map(
            (el) => el.getAttribute('data-node-type') ?? el.getAttribute('data-type'),
          ),
        ),
      ];
      out.push({
        side,
        blank: bottom === 0,
        title: (paper.querySelector('.nb-prose h1, .nb-prose h2')?.textContent ?? '').trim().slice(0, 46),
        blocks: kids.length,
        carriedIn: first !== undefined && first.tagName !== 'H1',
        fill: capacity > 0 ? bottom / capacity : 0,
        overflowing: capacity > 0 && bottom > capacity,
        tags,
        nodeTypes,
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
      return before !== undefined && Math.abs((leaf.fill ?? 0) - (before.fill ?? 0)) < 0.01;
    });
    last = next;
    if (same) break;
  }
  return last;
};

const SPREADS = Number(process.env.SPREADS ?? 19);
const leaves = [];
let previous = '';
for (let spread = 0; spread < SPREADS; spread++) {
  await p.waitForTimeout(1500);
  let read = await readSettled();
  for (let retry = 0; retry < 3; retry++) {
    const signature = read.map((l) => l.title ?? '').join('|');
    if (spread === 0 || signature !== previous) break;
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(1500);
    read = await readSettled();
  }
  previous = read.map((l) => l.title ?? '').join('|');
  const shot = `${outDir}/spread-${String(spread + 1).padStart(2, '0')}.png`;
  await p
    .locator('.nb-book-view')
    .screenshot({ path: shot, animations: 'disabled', timeout: 20_000 })
    .catch(async () => {
      await p.screenshot({ path: shot });
    });
  for (const leaf of read) leaves.push({ ...leaf, spread: spread + 1, shot });
  console.log(
    `  spread ${spread + 1}  ` +
      read
        .map((l) =>
          l.blank
            ? `${l.side}: —`
            : `${l.side}: ${(l.fill * 100).toFixed(0)}% "${l.title}" [pre${l.tags.pre} svg${l.tags.svg} tbl${l.tags.table} img${l.tags.img} tex${l.tags.katex}]`,
        )
        .join('   '),
  );
  if (read.every((l) => l.blank)) break;
  await p.keyboard.press('ArrowRight');
}

const written = leaves.filter((l) => !l.blank);
const fills = written.map((l) => l.fill).sort((a, b) => a - b);
console.log('');
console.log(`  leaves with writing: ${written.length}`);
console.log(`  median fill: ${(fills[written.length >> 1] * 100).toFixed(0)}%`);
console.log(`  min fill: ${(fills[0] * 100).toFixed(0)}%   max: ${(fills[fills.length - 1] * 100).toFixed(0)}%`);
const thin = written.filter((l) => l.fill < 0.55);
console.log(`  under 55%: ${thin.length}`);
for (const l of thin) console.log(`    "${l.title}" ${(l.fill * 100).toFixed(0)}%  ${l.shot}`);
const over = written.filter((l) => l.overflowing || l.carriedIn);
console.log(`  overflowing/carried-in: ${over.length}`);
for (const l of over) console.log(`    "${l.title}" ${(l.fill * 100).toFixed(0)}%  ${l.shot}`);
console.log('');
console.log('  totals across the book:');
const total = (k) => written.reduce((n, l) => n + l.tags[k], 0);
for (const k of ['pre', 'svg', 'table', 'img', 'katex']) console.log(`    ${k}: ${total(k)}`);
const seenTypes = [...new Set(written.flatMap((l) => l.nodeTypes))].filter(Boolean).sort();
console.log('  node types drawn:', seenTypes.join(', '));
console.log('  titles:', written.map((l) => l.title).join(' | '));

await b.close();
