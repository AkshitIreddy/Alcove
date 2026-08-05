/**
 * scripts/probe-turn-advance.mjs — R1: does turning a page go ONE spread?
 *
 * A REGRESSION probe, written before the fix it guards.
 *
 * The first attempt at the page-duplication fix (`qa/wip/BookView.duplication-fix-v1.tsx`
 * — hand carried blocks to a live editor instead of rewriting its stored doc)
 * took the duplication to zero and broke reading instead: on the SECOND page
 * turn the reader was thrown roughly eighteen spreads forward and left looking
 * at a blank left page. That is worse than the bug it fixed — a reader who
 * turns a page and lands in the back matter has lost their place in the book.
 *
 * The mechanism to be suspicious of is `carryOverflow`'s cursor branch:
 * `cursorCarried` jumps the spread SYNCHRONOUSLY to wherever the carried
 * caret went (`setSpreadIndex(spreadOfSlot(slot + 1))`). If merely arriving on
 * a spread makes its leaves drain and claim the caret, every landing turns
 * into another jump and the jumps compound down the book. So this measures the
 * two things a reader would notice:
 *
 *   - the spread index moves by EXACTLY ONE per ArrowRight, never more;
 *   - both leaves that ought to hold a page are actually holding one.
 *
 * "Ought to" matters: the right leaf of the last spread is deliberately bare
 * (that is what the back of a notebook looks like), so a leaf is only required
 * to be filled when its slot is inside the book. The page count is re-read
 * from storage on every turn because turning near the end appends pages.
 *
 * Passes on HEAD. Fails with v1 applied. Exits non-zero on failure.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const TURNS = 6;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }

// Through the shelf bridges and a real click on the cover — the same way
// probe-turn-reflow opens a book, so this runs against a build as well.
const bookId = await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
  return w ? w.id : null;
});
if (!bookId) { console.error('FAIL: no book on the shelf to open'); await browser.close(); process.exit(1); }
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForSelector('.nb-spread-stage', { timeout: 60_000 });
await page.waitForTimeout(5000);
// The stage carries the spread index; without it there is nothing to measure,
// and a run that reports every turn as a non-advance would be blaming the
// fix for a book that never opened.
if (await page.locator('.nb-spread-stage').count() === 0) {
  console.error('FAIL: the book view is not on screen after opening it');
  await browser.close();
  process.exit(1);
}

/**
 * The spread as the reader sees it: which spread is on screen, how many pages
 * the book has RIGHT NOW (storage, not the in-memory store — a probe's own
 * import of src/data can resolve to a second module copy), and whether each
 * leaf that should hold a page is holding one.
 */
const readSpread = async () =>
  page.evaluate((id) => {
    const stage = document.querySelector('.nb-spread-stage');
    const index = stage ? Number(stage.getAttribute('data-spread-index')) : -1;
    let pageCount = -1;
    try {
      const blob = JSON.parse(localStorage.getItem('notebook.stubdb.v1') ?? '{}');
      pageCount = (blob.pages ?? []).filter((r) => r.book_id === id).length;
    } catch { /* storage unreadable: reported as -1 below */ }
    // The two LIVE leaves only. `.nb-spread` excludes the raster cache's
    // offscreen snapshot clones, which carry the same classes and would
    // otherwise be counted as extra (side-less) leaves.
    const live = ['left', 'right']
      .map((s) => document.querySelector(`.nb-spread .nb-sheet-paper[data-side="${s}"]:not(.nb-export-sheet)`))
      .filter((el) => el !== null);
    const leaves = live.map((el) => {
      const side = el.getAttribute('data-side') ?? '?';
      const prose = el.querySelector('.nb-prose');
      return {
        side,
        slot: index * 2 + (side === 'right' ? 1 : 0),
        bare: el.querySelector('.nb-leaf-blank') !== null, // no page behind it at all
        empty: prose !== null && prose.textContent.trim().length === 0,
        mounted: prose !== null,
      };
    });
    return { index, pageCount, leaves };
  }, bookId);

const start = await readSpread();
console.log(`opened at spread ${start.index} — ${start.pageCount} pages stored\n`);

let previous = start.index;
const jumps = [];
const blanks = [];
for (let i = 1; i <= TURNS; i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2600);
  const now = await readSpread();
  const delta = now.index - previous;
  // A leaf whose slot is inside the book must be showing that page.
  const bad = now.leaves.filter(
    (l) => l.slot < now.pageCount && (l.bare || !l.mounted || l.empty),
  );
  if (delta !== 1) jumps.push(`turn ${i}: spread ${previous} -> ${now.index} (delta ${delta})`);
  for (const l of bad) {
    blanks.push(
      `turn ${i}: ${l.side} leaf (slot ${l.slot} of ${now.pageCount}) is ` +
        `${l.bare ? 'bare paper' : l.mounted ? 'an empty editor' : 'not mounted'}`,
    );
  }
  console.log(
    `  ${delta === 1 && bad.length === 0 ? 'ok  ' : 'BAD '} turn ${i}: ` +
      `spread ${previous} -> ${now.index} (delta ${delta}), ` +
      `${now.pageCount} pages, leaves ` +
      now.leaves.map((l) => `${l.side}=${l.bare ? 'bare' : l.empty ? 'empty' : 'page'}`).join(' '),
  );
  previous = now.index;
}

console.log('\n--- R1: one spread per turn, no blank leaf inside the book ---');
console.log(`  jumps      : ${jumps.length}`);
for (const j of jumps) console.log(`     ${j}`);
console.log(`  blank leaves: ${blanks.length}`);
for (const b of blanks) console.log(`     ${b}`);
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');

const failed = jumps.length > 0 || blanks.length > 0;
console.log(failed ? '\nR1 FAIL' : '\nR1 PASS');
await browser.close();
process.exit(failed ? 1 : 0);
