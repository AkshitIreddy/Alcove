/**
 * shots-now/new-book-is-a-book.mjs — the first book a reader ever makes looks
 * like a BOOK the moment it appears.
 *
 * THE BUG. Reported twice. *"For some reason the new book is white."* Then,
 * after a first fix: *"A brand-new book STILL reads as a blank white slab."*
 * Both times the book itself was perfect — baked, bound, coloured, banded —
 * and what the reader was looking at was the inline title editor sitting on
 * top of it. It is cream with a dashed border, and it was sized
 *
 *     along  = clamp(rect.height * 0.62, 84, rect.height * 0.9)
 *     across = Math.max(rect.width, 26)          // ← the whole spine, always
 *
 * The first fix shortened the LENGTH and left the width alone, so over that
 * 62% the cloth was still covered edge to edge and the only colour on the
 * plank was two stubs poking out of the ends. Measured on the default room at
 * zoom 0.8: a 33.6 × 204 spine under a 33.6 × 126 plate.
 *
 * ## Why this is a probe and not just a unit test
 *
 * `tests/name-plate.test.ts` holds `namePlateBox` to the invariant in pure
 * numbers, and it would have caught this — but only once the arithmetic was
 * somewhere a test could reach. It was not: it was four expressions inside a
 * `<Show>` callback in BookshelfWorld.tsx, which is why two rounds of fixes
 * and 2351 green assertions never touched it. A unit test guards the module;
 * only pixels guard the fact that the module is what the shelf actually uses.
 *
 * So this asserts on PIXELS, through the real path: click the button a new
 * reader clicks, wait for the spine to actually bake, then photograph the
 * same rectangle twice — once with the editor up, once dismissed — and ask
 * how much of the drawn spine the reader can still see. Nothing here reads
 * the geometry module, the DOM box or the store.
 *
 * Four assertions, all on the drawn spine:
 *   1. it is BAKED — a placeholder rectangle would match itself and pass;
 *   2. the editor hides at most COVER_MAX of the spine's footprint;
 *   3. cloth reads down BOTH long sides on essentially every scanline, which
 *      is the defect in the exact shape it had;
 *   4. all of that for BOOKS_TO_MAKE books, not one. Spine thickness is a
 *      seeded roll from 8 to 58 world px and a single run can easily draw a
 *      sliver the editor could never have covered anyway.
 *
 * Usage: node shots-now/new-book-is-a-book.mjs      (needs npm run dev)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

/** How many books to make. Thickness is seeded; one book proves little. */
const BOOKS_TO_MAKE = 5;

/** Share of the spine's footprint the title editor may hide. Was 0.62. */
const COVER_MAX = 0.06;

/** Share of scanlines that must show cloth on BOTH sides of the editor. */
const EDGE_MIN = 0.98;

/** Per-channel difference two pixels may have and still count as the same. */
const TOL = 12;

mkdirSync('shots-now/out', { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (;;) {
  if (await p.evaluate(() => globalThis.__shelfWorld !== undefined)) break;
  await p.waitForTimeout(100);
}
/*
 * Get the tour off the screen and CHECK that it went — the card is centred
 * over the case, and worse, mounting one takes focus, which blurs the title
 * editor and commits the name out from under the photograph. A one-shot
 * `if (count) click` at boot is a race: the card may not have mounted yet,
 * and then it arrives in the middle of the first book.
 */
const tourCard = p.locator('.nbt-card');
for (let i = 0; i < 40 && (await tourCard.count()) === 0; i++) await p.waitForTimeout(100);
for (let i = 0; i < 12 && (await tourCard.count()) > 0; i++) {
  await p.locator('.nbt-btn--ghost').first().click({ timeout: 2000 }).catch(() => {});
  await p.waitForTimeout(250);
}
if ((await tourCard.count()) > 0) {
  console.log('  FAIL — the tour card would not leave the screen');
  await b.close();
  process.exit(1);
}
await p.waitForTimeout(400);

/** Decode two PNGs and diff them, in the browser that drew them. */
const diff = (a, c) =>
  p.evaluate(
    async ([one, two, tol]) => {
      const load = async (b64) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const g = cv.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return {
          d: g.getImageData(0, 0, bmp.width, bmp.height).data,
          w: bmp.width,
          h: bmp.height,
        };
      };
      const A = await load(one);
      const B = await load(two);
      const same = (x, y) => {
        const i = (y * A.w + x) * 4;
        return (
          Math.abs(A.d[i] - B.d[i]) <= tol &&
          Math.abs(A.d[i + 1] - B.d[i + 1]) <= tol &&
          Math.abs(A.d[i + 2] - B.d[i + 2]) <= tol
        );
      };
      let visible = 0;
      let total = 0;
      for (let y = 1; y < A.h - 1; y++) {
        for (let x = 1; x < A.w - 1; x++) {
          total++;
          if (same(x, y)) visible++;
        }
      }
      // The defect's own shape: the plate spanned the spine edge to edge, so
      // NO scanline had cloth to the left of it AND to the right of it.
      let bothSides = 0;
      let rows = 0;
      for (let y = 1; y < A.h - 1; y++) {
        rows++;
        if (same(1, y) && same(A.w - 2, y)) bothSides++;
      }
      return { w: A.w, h: A.h, visible: visible / total, bothSides: bothSides / rows };
    },
    [a, c, TOL],
  );

const fails = [];
const rows = [];
let firstShot = null;

for (let n = 0; n < BOOKS_TO_MAKE; n++) {
  // THE REAL PATH. The first book comes from the empty case's own invitation,
  // which is the button a brand-new reader meets; the rest from the dock's
  // "new book", which is the one they meet after that. Never __shelfAddBook.
  if (n === 0) {
    await p.evaluate(() => globalThis.__shelfEmptyLibrary());
    const invite = p.getByText('write my first one');
    for (let i = 0; i < 60; i++) {
      if (await invite.count()) break;
      await p.waitForTimeout(200);
    }
    if ((await invite.count()) === 0) {
      console.log('  FAIL — the empty case never offered "write my first one"');
      await b.close();
      process.exit(1);
    }
    await invite.first().click();
  } else {
    await p.click('[data-shelf-dock="new-book"]');
  }
  await p.waitForSelector('[data-testid="shelf-spine-name"]', { timeout: 15000 });

  // Assertion 1 — the spine has to be REAL before it is worth photographing.
  // A placeholder rectangle is one flat tint in both shots and sails through.
  let book = null;
  const t0 = Date.now();
  for (;;) {
    const seen = await p.evaluate((want) => {
      const w = globalThis.__shelfWorld;
      const all = (globalThis.__shelfVisibleBooks?.() ?? []).map((bk) => ({
        id: bk.id,
        hi: w.factory.get(bk.id, 'hi') !== undefined,
        lo: w.factory.get(bk.id, 'lo') !== undefined,
        rect: globalThis.__shelfSpineRect(bk.id),
      }));
      return { n: all.length, newest: all[want] ?? null, baked: all.every((r) => r.hi || r.lo) };
    }, n);
    if (seen.n === n + 1 && seen.baked && seen.newest !== null) {
      book = seen.newest;
      break;
    }
    if (Date.now() - t0 > 25000) {
      fails.push(`book ${n + 1} never baked (${JSON.stringify(seen)})`);
      break;
    }
    await p.waitForTimeout(200);
  }
  if (book === null) break;

  // The arrival tween and the tag's own fade both have to land.
  await p.waitForTimeout(1100);

  const clip = {
    x: Math.round(book.rect.x),
    y: Math.round(book.rect.y),
    width: Math.round(book.rect.width),
    height: Math.round(book.rect.height),
  };
  const naming = (await p.screenshot({ clip })).toString('base64');
  const side = await p.getAttribute('[data-testid="shelf-spine-name"]', 'data-side');
  if (n === 0) firstShot = await p.screenshot();

  // Escape does not rename, so the spine under the shot is byte-identical to
  // the spine that was under the tag a moment ago.
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-testid="shelf-spine-name"]', {
    state: 'detached',
    timeout: 5000,
  });
  await p.waitForTimeout(650);
  const moved = await p.evaluate((id) => globalThis.__shelfSpineRect(id), book.id);
  if (Math.round(moved.x) !== clip.x || Math.round(moved.y) !== clip.y) {
    fails.push(`book ${n + 1}: the spine moved between the two photographs`);
    continue;
  }
  const settled = (await p.screenshot({ clip })).toString('base64');

  const stat = await diff(naming, settled);
  const cover = 1 - stat.visible;
  rows.push(
    `   book ${n + 1}: spine ${stat.w}x${stat.h} tag=${side}  ` +
      `covered ${(cover * 100).toFixed(1)}%  cloth-both-sides ${(stat.bothSides * 100).toFixed(1)}%`,
  );
  if (cover > COVER_MAX) {
    fails.push(
      `book ${n + 1}: the title editor hides ${(cover * 100).toFixed(1)}% of the spine ` +
        `(max ${(COVER_MAX * 100).toFixed(0)}%)`,
    );
  }
  if (stat.bothSides < EDGE_MIN) {
    fails.push(
      `book ${n + 1}: only ${(stat.bothSides * 100).toFixed(1)}% of scanlines still show cloth ` +
        `on both sides (min ${(EDGE_MIN * 100).toFixed(0)}%) — something is over the book`,
    );
  }
  if (n === 0) {
    writeFileSync('shots-now/out/new-book-naming.png', Buffer.from(naming, 'base64'));
    writeFileSync('shots-now/out/new-book-settled.png', Buffer.from(settled, 'base64'));
  }
}

for (const r of rows) console.log(r);
if (firstShot !== null) writeFileSync('shots-now/out/new-book-is-a-book.png', firstShot);
if (fails.length === 0) {
  console.log(`  PASS — ${rows.length} new books each read as a book while being named`);
} else {
  for (const f of fails) console.log(`  FAIL — ${f}`);
}
console.log('  shots shots-now/out/new-book-{naming,settled,is-a-book}.png');

await b.close();
process.exit(fails.length === 0 ? 0 : 1);
