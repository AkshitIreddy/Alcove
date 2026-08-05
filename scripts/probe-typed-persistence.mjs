/**
 * scripts/probe-typed-persistence.mjs — R3: does what you TYPE reach the disk?
 *
 * A REGRESSION probe, written before the fix it guards, and the important one
 * of the three. Duplication is additive corruption and can be cleaned up;
 * losing what somebody typed cannot be undone by anything.
 *
 * With `qa/wip/BookView.duplication-fix-v1.tsx` applied, typing twenty-two
 * numbered lines past the foot of a page stored ten. The markers were visible
 * in the DOM the whole time and never reached the database — not after nine
 * seconds of idling, not after closing the book (which flushes on unmount).
 *
 * The shape of that failure is what this probe is built around. On HEAD every
 * carry writes the target's row itself (`savePageDoc` inside `carryOverflow`).
 * v1 drops that write for any target that has a mounted editor: the blocks go
 * in as a transaction and the merged doc is published to the in-memory store,
 * so the row is then owed entirely to that editor's own 400ms debounce
 * (PageEditor's `scheduleSave`). Anything that disposes the editor before the
 * debounce is paid takes the content with it — and v1's carry disposes leaves
 * constantly, because a carried caret jumps the spread SYNCHRONOUSLY.
 *
 * So the probe types continuously, far enough past the foot of a page to
 * cascade across at least one spread boundary, and then reads the ROWS back.
 * Continuous is load-bearing: with a 60ms pause between lines every page gets
 * to settle and v1 keeps all forty, so a probe that pauses would have shipped
 * this regression. With no pause it drops a line on every run measured.
 *
 * Reading them: straight out of the browser stub's localStorage blob rather
 * than through `import('/src/data/pages.ts')`. On a dev server that has served
 * HMR updates a probe's own import can resolve to a SECOND copy of db.ts with
 * its own MemoryDb, and asking that copy what is stored is asking the wrong
 * object. `MemoryDb.persist()` writes the whole blob synchronously after every
 * mutation, so the blob IS the stored state — the same thing a reload would
 * find, which is precisely the question being asked.
 *
 * Two reads, both reported: after the idle wait, and again after the book has
 * been closed. The assertion is on the second, to give the fix every chance —
 * a marker that arrives late is still a marker that arrived.
 *
 * NOTE: this probe WRITES into the Welcome book (that is the only way to ask
 * the question). It types `ZQ<run>Lnn` marker lines, unique per run.
 *
 * Passes on HEAD. Fails with v1 applied. Exits non-zero on failure.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
/**
 * Enough lines to run off the foot of a page and cascade onto the NEXT SPREAD,
 * with room to spare — the loss only starts once the carry disposes an editor,
 * so lines typed after the first crossing are the ones that carry the evidence.
 * The run below reports where the crossing fell, so a too-small number shows
 * up as INCONCLUSIVE rather than as a pass. At forty the crossing lands around
 * line 23 in the Welcome book — twenty-two lines is NOT enough there, it never
 * leaves the first page at all.
 */
const LINES = Number(process.argv.find((a) => a.startsWith('--lines='))?.slice(8) ?? 40);
/**
 * Pause between lines — ZERO by default, and that is the whole sensitivity of
 * this probe. The 400ms save debounce is what stands between a typed line and
 * its row, so a probe that pauses between lines lets every page settle and
 * asks a far easier question than somebody actually typing does. Measured:
 * with a 60ms gap v1 keeps all forty lines; with no gap it drops one, every
 * run, while HEAD keeps all forty either way.
 */
const GAP = Number(process.argv.find((a) => a.startsWith('--gap='))?.slice(6) ?? 0);
const RUN = Date.now().toString(36).slice(-4).toUpperCase();
const marker = (i) => `ZQ${RUN}L${String(i).padStart(2, '0')}`;

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

/** Every stored page of the book, as one string per page — the rows, not the store. */
const readStored = async () =>
  page.evaluate((id) => {
    try {
      const blob = JSON.parse(localStorage.getItem('notebook.stubdb.v1') ?? '{}');
      return (blob.pages ?? [])
        .filter((r) => r.book_id === id)
        .sort((a, b) => a.ord - b.ord)
        .map((r) => String(r.doc_json ?? ''));
    } catch {
      return [];
    }
  }, bookId);

const storedMissing = (docs) => {
  const all = docs.join('\n');
  const missing = [];
  for (let i = 1; i <= LINES; i += 1) if (!all.includes(marker(i))) missing.push(marker(i));
  return missing;
};

// -------------------------------------------------------------------------
// Put the caret at the very end of the left page's text and type past the foot.
// Clicking the last block (rather than the ruled space below it) works whether
// or not the page still has room: a full page answers a click below its last
// line with a pulse, not a caret.
// -------------------------------------------------------------------------
const anchor = await page.evaluate(() => {
  // `.nb-spread` so this is the LIVE left leaf, not a raster-cache clone.
  const prose = document.querySelector('.nb-spread .nb-sheet-paper[data-side="left"] .nb-prose');
  const last = prose?.lastElementChild;
  if (!last) return null;
  const r = last.getBoundingClientRect();
  return { x: r.left + Math.min(r.width - 4, 40), y: r.top + r.height / 2 };
});
if (!anchor) { console.error('FAIL: no text on the left leaf to place a caret in'); await browser.close(); process.exit(1); }
await page.mouse.click(anchor.x, anchor.y);
await page.waitForTimeout(400);
await page.keyboard.press('Control+End');
await page.waitForTimeout(300);

const before = await readStored();
console.log(`typing ${LINES} lines (${marker(1)} … ${marker(LINES)}) into a ${before.length}-page book\n`);

const landed = [];
const carries = []; // lines where the caret was carried onto another spread
let vanishedAt = null;
let spread = -1;
for (let i = 1; i <= LINES; i += 1) {
  await page.keyboard.press('Enter');
  await page.keyboard.type(marker(i));
  await page.waitForTimeout(GAP);
  const now = await page.evaluate(
    (m) => ({
      seen: (document.querySelector('.nb-spread-stage')?.innerText ?? '').includes(m),
      spread: Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1),
    }),
    marker(i),
  );
  if (now.seen) landed.push(i);
  // -1 means the spread stage is not in the document at all: the book view
  // tore itself down mid-sentence, which is its own way of losing the rest.
  if (spread >= 0 && now.spread !== spread) carries.push(`${marker(i)}: spread ${spread} -> ${now.spread}`);
  if (now.spread < 0) vanishedAt = vanishedAt ?? marker(i);
  spread = now.spread;
}
if (vanishedAt) console.log(`  the book view VANISHED while typing, at ${vanishedAt}`);
console.log(`  typed and visible on screen: ${landed.length} of ${LINES}`);
// A carry that crosses a spread is the case that disposes the editor holding
// the carried text — if this list is empty the run proved nothing.
console.log(`  caret carried onto another spread: ${carries.length}`);
for (const c of carries) console.log(`     ${c}`);
if (landed.length < LINES) {
  const lost = [];
  for (let i = 1; i <= LINES; i += 1) if (!landed.includes(i)) lost.push(marker(i));
  console.log(`     never appeared: ${lost.join(' ')}`);
}

// The debounce is 400ms; nine seconds is the reader's "I waited, it's fine".
await page.waitForTimeout(9000);
const idle = await readStored();
const missingIdle = storedMissing(idle);
console.log(`\n  after 9s idle : ${LINES - missingIdle.length} of ${LINES} markers stored (${idle.length} pages)`);
if (missingIdle.length) console.log(`     missing: ${missingIdle.join(' ')}`);

// Closing the book unmounts every editor, which is supposed to flush.
try {
  await page.locator('.nb-back-button').first().click({ force: true, timeout: 8000 });
} catch {
  console.log('  (no back button to click — the book view is already gone)');
}
await page.waitForTimeout(3500);
const closed = await readStored();
const missingClosed = storedMissing(closed);
console.log(`  after close   : ${LINES - missingClosed.length} of ${LINES} markers stored (${closed.length} pages)`);
if (missingClosed.length) console.log(`     missing: ${missingClosed.join(' ')}`);

console.log('\n--- R3: everything typed is in the stored documents ---');
console.log(`  lines typed        : ${LINES}`);
console.log(`  reached the screen : ${landed.length}`);
console.log(`  reached storage    : ${LINES - missingClosed.length}`);
console.log(`  spread crossings   : ${carries.length}`);
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');

// No crossing means the typing never reached the case this probe exists to
// measure — report that as a failure rather than a green tick, or the fix
// gets declared done against a run that asked nothing.
if (carries.length === 0) {
  console.log('\nR3 INCONCLUSIVE — the caret never crossed a spread; raise LINES');
  await browser.close();
  process.exit(1);
}

const failed = missingClosed.length > 0 || vanishedAt !== null;
console.log(
  failed
    ? `\nR3 FAIL — ${missingClosed.length} typed line(s) never reached storage` +
        (vanishedAt ? `, and the book view vanished at ${vanishedAt}` : '')
    : '\nR3 PASS',
);
await browser.close();
process.exit(failed ? 1 : 0);
