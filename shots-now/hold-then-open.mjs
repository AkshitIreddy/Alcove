/**
 * shots-now/hold-then-open.mjs — a pulled book RESTS before it opens.
 *
 *   "the book is auto opening when i click it should isntead just come in
 *    foreview and only if user clicks on it does it go inside , with a back
 *    button on top left"
 *
 * So one click takes the book out of the case and leaves it there, face on, in
 * the room. A second click on the cover opens it. The way back is the arrow in
 * the TOP-LEFT corner, which is where every exit in this app lives.
 *
 * Three things to prove, and the first is the one that regressed:
 *
 *  1. the flight LANDS and stops — no book view, however long you wait;
 *  2. the corner arrow is really in the corner, and really sends it home;
 *  3. the cover is still the way in — one click on it opens the pages.
 *
 * It refuses to pass vacuously: if the book never leaves the shelf at all,
 * step 1 "passes" for the wrong reason, so the held cover has to be on screen
 * before anything is asserted about it.
 *
 * Usage: node shots-now/hold-then-open.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

/** Every control this repo insists lives in the top-left corner. */
const CORNER_X = 480;
const CORNER_Y = 220;

const fails = [];
const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

async function boot(clear) {
  await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (clear) {
    await p.evaluate(() => localStorage.clear());
    await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  }
  for (;;) {
    if (await p.evaluate(() => globalThis.__shelfWorld !== undefined)) break;
    await p.waitForTimeout(100);
  }
  const card = p.locator('.nbt-card');
  for (let i = 0; i < 12 && (await card.count()) > 0; i += 1) {
    await p.locator('.nbt-btn--ghost').first().click({ timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(250);
  }
  // A spine has to exist before any of this means anything.
  for (let i = 0; i < 200; i += 1) {
    const n = await p.evaluate(() => (globalThis.__shelfVisibleBooks?.() ?? []).length);
    if (n > 0) return;
    await p.waitForTimeout(150);
  }
  fails.push('no book ever reached the shelf — nothing could be pulled out');
}

/** Take the top book off the shelf the way a click on its spine does. */
async function pull() {
  // A dev server serving HMR under a parallel agent can reload the page out
  // from under this; wait for a shelf with a book on it before asking.
  for (let i = 0; i < 200; i += 1) {
    const ready = await p
      .evaluate(() => (globalThis.__shelfVisibleBooks?.() ?? []).length > 0)
      .catch(() => false);
    if (ready) break;
    await p.waitForTimeout(150);
  }
  // Retried, because the world refuses a pull while the previous book is
  // still flying home — and the DOM overlay unmounts before that lands.
  const held = p.locator('[data-testid="pulled-book"]');
  for (let i = 0; i < 30; i += 1) {
    await p.evaluate(() => {
      const books = globalThis.__shelfVisibleBooks?.() ?? [];
      if (books[0]) globalThis.__shelfPullOut(books[0].id);
    });
    await p.waitForTimeout(500);
    if ((await held.count()) > 0) break;
  }
  await held.waitFor({ state: 'visible', timeout: 30_000 });
}

/* ---------------- 1. it lands, and it stays landed ----------------------- */

await boot(true);
await pull();
const back = p.locator('[data-testid="pulled-book-back"]');
await back.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
if ((await back.count()) === 0) {
  fails.push('the book never came to rest — no way back appeared beside it');
}
// Well past the flight (~0.7s) and past anything that could open it late.
await p.waitForTimeout(3000);
if ((await p.locator('.nb-book-view').count()) > 0) {
  fails.push('the book opened itself — a pull is supposed to bring it forward, no more');
}
if ((await p.locator('[data-testid="pulled-book"]').count()) === 0) {
  fails.push('the held book vanished on its own');
}
await p.screenshot({ path: 'shots-now/out/hold-then-open.png' });

const box = await back.boundingBox().catch(() => null);
if (box === null) {
  fails.push('the way back has no box to measure');
} else if (box.x >= CORNER_X || box.y >= CORNER_Y) {
  fails.push(
    `the way back is at ${Math.round(box.x)},${Math.round(box.y)} — every exit ` +
      'in this app is anchored to the top-left corner',
  );
}

/* ---------------- 2. the corner arrow sends it home ---------------------- */

await back.click();
await p
  .locator('[data-testid="pulled-book"]')
  .waitFor({ state: 'detached', timeout: 30_000 })
  .catch(() => fails.push('the way back did not put the book back'));
if ((await p.locator('.nb-book-view').count()) > 0) {
  fails.push('putting the book back opened it instead');
}

/* ---------------- 3. a click on the cover opens it ----------------------- */

await pull();
await back.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await p.locator('[data-testid="pulled-book"]').click();
await p
  .locator('.nb-book-view')
  .waitFor({ state: 'visible', timeout: 30_000 })
  .catch(() => fails.push('clicking the resting cover did not open the book'));
await p.waitForTimeout(1200);
await p.screenshot({ path: 'shots-now/out/hold-then-open-opened.png' });

console.log('  shots shots-now/out/hold-then-open.png, hold-then-open-opened.png');
if (fails.length === 0) console.log('  PASS — one click holds it, a second opens it, the corner sends it home');
else for (const f of fails) console.log(`  FAIL — ${f}`);
await b.close();
process.exit(fails.length === 0 ? 0 : 1);
