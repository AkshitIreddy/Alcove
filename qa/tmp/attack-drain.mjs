/**
 * qa/tmp/attack-drain.mjs — attack the pagination drain by MOVING THE CAPACITY.
 *
 * The fix under test publishes a drain's removal to the store before handing
 * the blocks up. It was measured on the opening spread of a fresh book. This
 * moves the capacity underneath a book that is already open — window resize,
 * a rail sheet, back again — and asks two questions after every move:
 *
 *   1. did content DUPLICATE (same block text on two pages / twice on one)?
 *   2. does a mounted leaf KEEP overflow (content taller than its capacity,
 *      under `overflow: hidden` — the no-scrollbars contract)?
 *
 * Both are read the way the app reads them: the docs come out of
 * /src/data/pages.ts, the overflow out of the same getBoundingClientRect math
 * `extractOverflow` uses (block bottoms + surviving padding vs the leaf's
 * capacity in DRAWN px).
 */
import { chromium } from 'playwright';

const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) ?? 'run';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

await page.addInitScript(
  ([storageKey, tutorialKey]) => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const blob = raw === null ? {} : JSON.parse(raw);
      const rows = Array.isArray(blob.settings) ? blob.settings : [];
      const at = rows.findIndex((r) => r?.key === tutorialKey);
      const row = { key: tutorialKey, value: '1' };
      if (at >= 0) rows[at] = row;
      else rows.push(row);
      blob.settings = rows;
      window.localStorage.setItem(storageKey, JSON.stringify(blob));
    } catch {}
  },
  ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
);

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
await page.evaluate(() => window.__nbTutorial?.stop?.());
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }

/** Every page of the Welcome book, as plain text per top-level block. */
const readBook = () =>
  page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pagesMod = await import('/src/data/pages.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
    const pages = await pagesMod.listPages(welcome.id);
    const textOf = (node) => {
      if (node === null || typeof node !== 'object') return '';
      if (typeof node.text === 'string') return node.text;
      return (node.content ?? []).map(textOf).join('');
    };
    return pages.map((pg, i) => ({
      i,
      id: pg.id,
      blocks: (pg.doc?.content ?? []).map((b) => textOf(b).trim()).filter((t) => t.length > 8),
    }));
  });

/** The live leaves, measured exactly the way the drain measures them. */
const readLeaves = () =>
  page.evaluate(() => {
    const visualScale = (drawn, laidOut) =>
      laidOut > 0 && drawn > 0 ? drawn / laidOut : 1;
    const out = [];
    for (const paper of document.querySelectorAll('.nb-leaf-paper')) {
      const side = paper.getAttribute('data-side');
      const root = paper.querySelector('.nb-prose');
      if (!root) { out.push({ side, mounted: false }); continue; }
      const ps = getComputedStyle(paper);
      const laidOut =
        paper.clientHeight -
        (parseFloat(ps.paddingTop) || 0) -
        (parseFloat(ps.paddingBottom) || 0);
      const scale = visualScale(paper.getBoundingClientRect().height, paper.clientHeight);
      const capacity = Math.floor(laidOut * scale);
      const rect = root.getBoundingClientRect();
      const kids = Array.from(root.children);
      const bottoms = kids.map((c) => c.getBoundingClientRect().bottom - rect.top);
      const padBottom = (parseFloat(getComputedStyle(root).paddingBottom) || 0) * scale;
      // Ignore the TrailingNode empty paragraph the drain also ignores.
      let real = bottoms;
      const last = kids[kids.length - 1];
      if (kids.length > 1 && last?.tagName === 'P' && last.textContent === '') {
        real = bottoms.slice(0, -1);
      }
      const content = (real[real.length - 1] ?? 0) + padBottom;
      out.push({
        side,
        mounted: true,
        blocks: kids.length,
        capacity,
        content: Math.round(content),
        over: Math.round(content - capacity),
        scrollOver: root.scrollHeight - root.clientHeight,
      });
    }
    return out;
  });

const dupOf = (pages) => {
  const where = new Map();
  for (const pg of pages) {
    for (const t of new Set(pg.blocks)) {
      if (!where.has(t)) where.set(t, []);
      where.get(t).push(pg.i);
    }
  }
  const across = [...where.entries()].filter(([, ps]) => ps.length > 1);
  const within = [];
  for (const pg of pages) {
    const seen = new Set();
    for (const t of pg.blocks) {
      if (seen.has(t)) within.push({ page: pg.i, text: t });
      seen.add(t);
    }
  }
  return { across, within, count: pages.length };
};

const marks = [];
const measure = async (label) => {
  const docs = await readBook();
  const d = dupOf(docs);
  const leaves = await readLeaves();
  const overflowing = leaves.filter((l) => l.mounted && l.over > 2);
  marks.push({ label, across: d.across.length, within: d.within.length, pages: d.count, overflowing: overflowing.length });
  console.log(`\n--- ${label} ---`);
  console.log(`  pages ${d.count} | dup across ${d.across.length} | dup within ${d.within.length}`);
  for (const [t, ps] of d.across.slice(0, 4)) console.log(`     ACROSS pages ${ps.join(', ')}: "${t.slice(0, 60)}"`);
  for (const w of d.within.slice(0, 4)) console.log(`     WITHIN page ${w.page}: "${w.text.slice(0, 60)}"`);
  for (const l of leaves) {
    console.log(
      l.mounted
        ? `     leaf ${l.side}: blocks ${l.blocks} content ${l.content} cap ${l.capacity} over ${l.over}${l.over > 2 ? '   <-- KEEPS OVERFLOW' : ''} scrollOver ${l.scrollOver}`
        : `     leaf ${l.side}: (blank)`,
    );
  }
  return { d, leaves };
};

const openBook = async () => {
  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const welcome = list.find((x) => /welcome/i.test(x.title)) ?? list[0];
    app.appState.openBook(welcome.id);
  });
  await page.waitForSelector('.nb-prose', { timeout: 60_000 });
  await page.waitForTimeout(6000);
};

console.log(`== attack-drain (${TAG}) ==`);
await measure('0. as stored, book never opened');
await openBook();
await measure('1. opened at 1440x900, settled');

// ATTACK A — shrink the WINDOW under an open book. The leaf box shrinks, so
// the capacity drops, and every mounted page must drain what no longer fits.
await page.setViewportSize({ width: 1100, height: 640 });
await page.waitForTimeout(4000);
await measure('2. window shrunk to 1100x640');

await page.waitForTimeout(4000);
await measure('3. + 4s more idle');

// ATTACK B — a rail sheet, which scales the spread down beside it.
await page.click('.nb-rail-button[data-tool="page-style"]').catch(() => {});
await page.waitForTimeout(3500);
await measure('4. page-style sheet open');

await page.click('.nb-rail-button[data-tool="page-style"]').catch(() => {});
await page.waitForTimeout(3500);
await measure('5. sheet closed again');

// ATTACK C — grow the window back. Nothing pulls carried blocks back, but
// nothing should duplicate either.
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(4000);
await measure('6. window back to 1440x900');

// ATTACK D — turn pages under the new geometry.
for (let i = 0; i < 6; i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2200);
}
await page.waitForTimeout(3000);
await measure('7. after six turns');

// ATTACK E — shrink hard while deeper in the book.
await page.setViewportSize({ width: 1000, height: 560 });
await page.waitForTimeout(5000);
await measure('8. window shrunk to 1000x560 mid-book');

await page.waitForTimeout(5000);
await measure('9. + 5s more idle');

console.log('\n=== summary ===');
for (const m of marks) {
  console.log(
    `  ${m.label.padEnd(38)} pages ${String(m.pages).padStart(3)}  across ${String(m.across).padStart(2)}  within ${String(m.within).padStart(2)}  leavesOverflowing ${m.overflowing}`,
  );
}
console.log('\nerrors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
