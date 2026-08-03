/**
 * shots-now/newbook-bake.mjs — a book made AFTER first paint is actually bound.
 *
 * The sibling of `welcome-bake.mjs`, which guards the book a library is born
 * with. This one guards the book a reader MAKES, and it was reported broken in
 * the same breath as the tour's first click:
 *
 *   "when i click on write m y first, it creates two books, basially the
 *    welcome book popups along with my new book, also for some reason the new
 *    book is white"
 *
 * Two failures in one action, and this checks both.
 *
 * ACT 1 — the count. On a brand-new install the shelf could believe the case
 * was BARE while the welcome book sat in the database: `ensureRange` (the
 * virtualizer, on the first frame) beat `seedIfEmpty` to page 0, came back
 * empty, and marked the page loaded, so `init`'s own read was refused at the
 * door. The reader got the first-run invitation on a library that already had
 * a book, and their first click appeared to create TWO — theirs, plus the
 * welcome book that `refreshAll()` finally revealed. So: after boot the case
 * must NOT claim to be bare, and one click must add exactly one book.
 *
 * ACT 2 — the bake. A spine with no baked texture draws as a flat placeholder,
 * which is what "white" means here. `invalidateAll` (any room repaint) threw
 * away the whole pending QUEUE and then announced only the books that already
 * held a texture — so a book whose first bake had not landed was dropped in
 * silence and nothing ever asked again. Same defect as the stale-epoch branch
 * fixed in 098375b, one door along. So: make a handful of books, repaint the
 * room under them, and every one must still end up bound.
 *
 * Both acts refuse to pass vacuously: act 1 fails if the shelf never showed
 * the welcome book at all, and act 2 fails if the repaint never actually
 * landed (the applied library key has to change).
 *
 * Usage: node shots-now/newbook-bake.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

const BOUND_MS = 30_000;
const fails = [];

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120_000 });
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120_000 });
for (;;) {
  if (await p.evaluate(() => globalThis.__shelfWorld !== undefined)) break;
  await p.waitForTimeout(100);
}
/**
 * Get the tour off the screen and CHECK that it went.
 *
 * Its card is centred and covers the case, which makes every screenshot below
 * worthless — and it can come back on a dev-server hot reload, so this is a
 * helper called before each shot rather than a one-off at boot.
 */
const tourCard = p.locator('.nbt-card');
async function dismissTour(where) {
  for (let i = 0; i < 12 && (await tourCard.count()) > 0; i += 1) {
    await p.locator('.nbt-btn--ghost').first().click({ timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(250);
  }
  if ((await tourCard.count()) > 0) {
    fails.push(`the tour card would not leave the screen (${where})`);
  }
}
await dismissTour('boot');

/** What the SHELF believes right now — never what a store merely saved. */
const sample = () =>
  p.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const books = globalThis.__shelfVisibleBooks?.() ?? [];
    return {
      n: books.length,
      titles: books.map((bk) => bk.title.slice(0, 28)),
      unbound: books
        .filter(
          (bk) =>
            w.factory.get(bk.id, 'hi') === undefined &&
            w.factory.get(bk.id, 'lo') === undefined,
        )
        .map((bk) => bk.title.slice(0, 28)),
      firstRun: globalThis.__shelfAddSpot?.()?.firstRun ?? null,
      libraryKey: globalThis.__shelfDesign?.().libraryKey ?? null,
    };
  });

/** Poll until `ok(sample)`, or give up and hand back the last sample seen. */
async function until(ok, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const s = await sample();
    if (ok(s)) return { at: Date.now() - t0, ...s };
    if (Date.now() - t0 > ms) {
      console.log(`  ! gave up waiting for ${what}:`, JSON.stringify(s));
      return { at: -1, ...s };
    }
    await p.waitForTimeout(250);
  }
}

/* ------------------------------ act 1: the count ------------------------- */

const seeded = await until((s) => s.n >= 1, BOUND_MS, 'the welcome book to appear');
if (seeded.at < 0) fails.push('the welcome book never reached the shelf at all');
if (seeded.n !== 1) fails.push(`a fresh library showed ${seeded.n} books, expected 1`);
if (seeded.firstRun === true) {
  fails.push(
    'the case claimed to be BARE while the welcome book was in it — ' +
      'the first-run invitation is showing on a library that has a book',
  );
}
console.log('  boot:', JSON.stringify(seeded));

// One click on the dock's own "new book" — the same call the tour's "write my
// first one" button makes. Driven by clicking, not by a bridge.
await p.locator('[data-shelf-dock="new-book"]').click();
const named = p.locator('[data-testid="shelf-spine-name"]');
await named.waitFor({ state: 'visible', timeout: 20_000 });

/* --------------------- act 2: the plate is not the book ------------------ */
/*
 * "the new book is white" — and it was not the spine. The inline title editor
 * is cream, and it used to be sized to the WHOLE spine (`max(rect.height, 132)`
 * long by the spine's full width), so the object standing on the plank the
 * instant a book was made was a white rectangle. It has to read as a label
 * plate ON a book, which means the book's own colour has to be left showing.
 */
await dismissTour('the naming plate');
// The new spine slides in from the right; photograph it where it lands.
await p.waitForTimeout(1200);
await p.screenshot({ path: 'shots-now/out/newbook-naming.png' });
const plate = await p.evaluate(() => {
  const el = document.querySelector('[data-testid="shelf-spine-name"]');
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const fresh = books[books.length - 1];
  const spine = fresh === undefined ? null : globalThis.__shelfSpineRect(fresh.id);
  if (el === null || spine === null) return null;
  const box = el.getBoundingClientRect();
  // The editor is rotated -90°, so its on-screen height is what covers the
  // spine's height. getBoundingClientRect already reports the rotated box.
  return { covers: box.height / spine.height, spineH: spine.height };
});
console.log('  naming plate:', JSON.stringify(plate));
if (plate === null) {
  fails.push('could not measure the naming plate against the spine it stands on');
} else if (plate.covers > 0.8) {
  fails.push(
    `the naming plate covers ${(plate.covers * 100).toFixed(0)}% of the new ` +
      'spine — the book a reader just made reads as a white rectangle',
  );
}

// Naming it also invalidates the spine, while that spine's very first bake may
// still be pending.
await named.fill('Field Notes');
await named.press('Enter');

const after = await until((s) => s.n >= 2 && s.unbound.length === 0, BOUND_MS, 'two bound books');
console.log('  after one click:', JSON.stringify(after));
if (after.n !== 2) {
  fails.push(`one click left ${after.n} books on the shelf, expected 2 (${after.titles})`);
}
if (after.unbound.length > 0) {
  fails.push(`unbaked after creation: ${after.unbound.join(', ')}`);
}
await dismissTour('the made book');
await p.screenshot({ path: 'shots-now/out/newbook-bake.png' });

/* ------------------------ act 3: a repaint mid-bake ---------------------- */

const before = await sample();
/*
 * The shape of this act is not arbitrary, and a looser version of it passed
 * against the broken code. `requestSpines` asks for a WHOLE FLOOR at a time,
 * so as long as one book on a floor still holds a texture, the announcement it
 * generates drags its neighbours' requests back with it. A dropped bake is
 * only visible on a book with nobody to carry it — which is exactly why the
 * sibling defect hid until a library had precisely one book in it.
 *
 * So: fill floor 0 first (the worker pool saturates and the surplus piles up
 * in the queue), then put ONE new book on an otherwise bare floor, then
 * repaint the room while its bake is still waiting. Nothing on that floor can
 * speak for it.
 */
const lone = await p.evaluate(async () => {
  const titles = [];
  for (let i = 0; i < 26; i += 1) titles.push(`Ledger ${i + 1}`);
  await globalThis.__shelfSeedBooks(titles, 0);
  const made = await globalThis.__shelfAddBook(2);
  const f = globalThis.__shelfWorld.factory;
  const id = made.book.id;
  const at = {
    id,
    queue: f.queue.size,
    waiting: f.queue.has(`lo|${id}`) || f.queue.has(`hi|${id}`),
    already: f.get(id, 'lo') !== undefined || f.get(id, 'hi') !== undefined,
  };
  await globalThis.__shelfSaveDesign({
    build: 'gothic',
    pattern: 'fluted',
    wallpaper: { pattern: 'damask', scale: 'large', depth: 'raised', ink: 'gilt' },
  });
  return at;
});
console.log('  the lone book at the repaint:', JSON.stringify(lone));
if (lone.already || !lone.waiting) {
  fails.push(
    'the lone book was not still waiting for its bake when the room was ' +
      'repainted — act 3 cannot prove a pending bake survives',
  );
}

const bound = (id) =>
  p.evaluate((bookId) => {
    const w = globalThis.__shelfWorld;
    return w.factory.get(bookId, 'lo') !== undefined || w.factory.get(bookId, 'hi') !== undefined;
  }, id);

const repainted = await until(
  (s) => s.n >= 29 && s.unbound.length === 0 && s.libraryKey !== before.libraryKey,
  BOUND_MS,
  'every book bound again after the repaint',
);
console.log('  after the repaint:', JSON.stringify({ ...repainted, titles: repainted.n }));
if (repainted.libraryKey === before.libraryKey) {
  fails.push('the repaint never reached the case — act 3 proved nothing');
}
if (!(await bound(lone.id))) {
  fails.push(
    'the book made on a bare floor never got a spine: its bake was thrown ' +
      'away by the repaint and nobody remembered it wanted one',
  );
}
if (repainted.unbound.length > 0) {
  fails.push(`unbaked after a room repaint: ${repainted.unbound.join(', ')}`);
}
await p.waitForTimeout(600);
await dismissTour('the repaint');
await p.screenshot({ path: 'shots-now/out/newbook-bake-repaint.png' });

console.log('  shots shots-now/out/newbook-bake.png, newbook-bake-repaint.png');
if (fails.length === 0) {
  console.log(`  PASS — a made book is counted once and bound, ${after.at}ms in`);
} else {
  for (const f of fails) console.log(`  FAIL — ${f}`);
}
await b.close();
process.exit(fails.length === 0 ? 0 : 1);
