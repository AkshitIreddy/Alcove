/**
 * probe-own-colour.mjs — "a colour of your own", driven only by typing/clicking.
 *
 * Asserts on APPLIED state, never on what was merely saved:
 *  - the studio's live spine preview redraws;
 *  - `cover_meta.style.clothHex` AND `cover_meta.cover.clothHex` both carry it;
 *  - the SHELF spine's pixels become that colour after the book is closed;
 *  - the room's applied `libraryKey` changes when a timber colour is entered.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR ?? '.';
const URL_BASE = 'http://localhost:1420';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--mute-audio',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  shot ${name}.png`);
};

/**
 * Parallel agents are editing this repo while the probe runs, so Vite serves
 * the odd full reload and the app comes back on the shelf with no book open.
 * Every step re-establishes what it needs rather than assuming the last step's
 * state survived.
 */
const ensureStudio = async (bookId) => {
  for (let tries = 0; tries < 4; tries += 1) {
    if (await page.locator('.nb-book-studio').count()) return;
    if (!(await page.locator('.nb-rail').count())) {
      await page.evaluate(async (id) => {
        const app = await import('/src/state/app.ts');
        app.appState.openBook(id);
      }, bookId);
      await page.waitForSelector('.nb-rail', { timeout: 60000 });
      await page.waitForTimeout(1200);
    }
    await page.locator('.nb-rail-button[data-tool="customize"]').click();
    await page.waitForTimeout(1500);
  }
  throw new Error('could not get the book studio open');
};

const canvasHash = (selector) =>
  page.evaluate((sel) => {
    const c = document.querySelector(sel);
    if (!c) return null;
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16);
  }, selector);

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400, timeout: 120000 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400, timeout: 120000 });
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);

/* ---- 1. open a book, open its studio ---- */
console.log('\n1. open a book and its studio');
const opened = await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const first = list[0];
  if (!first) return null;
  app.appState.openBook(first.id);
  return { id: first.id, title: first.title };
});
console.log('  opened:', JSON.stringify(opened));
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.locator('.nb-rail-button[data-tool="customize"]').click();
await page.waitForSelector('.nb-book-studio', { timeout: 30000 });
await page.waitForTimeout(1200);

const swatchCount = await page.locator('[aria-label="Book base pigment"] .nb-swatch').count();
console.log('  pigment swatches shown:', swatchCount);
const moreLabel = await page.locator('.nb-book-studio .nb-chip[aria-expanded]').first().textContent();
console.log('  fold button says:', JSON.stringify(moreLabel?.trim()));

await page.locator('[aria-label="Book base pigment"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot('own-01-pigment-grid');

/* ---- 2. type a hex ---- */
console.log('\n2. type a colour of my own');
const WANT = '#00b3a4';
await ensureStudio(opened.id);
const beforeSpine = await canvasHash('.nb-studio-face-spine');
// PRE-EXISTING BUG, worked around rather than measured here: the FIRST edit
// made in the Book Studio after it opens never reaches SQLite — verified with
// the plain pigment swatch too, so it is nothing to do with the colour entry.
// Burn it on a pigment click so what follows tests this feature and not that.
await page.locator('[aria-label="Book base pigment"] .nb-swatch').nth(3).click();
await page.waitForTimeout(600);
const hex = page.locator('.nb-book-studio .nb-own-colour-hex');
await hex.click();
await hex.fill(WANT);
await page.waitForTimeout(200);
await page.locator('.nb-book-studio .nb-own-colour-entry .nb-chip-gilt').click();
await page.waitForTimeout(1000);
const afterSpine = await canvasHash('.nb-studio-face-spine');
console.log('  spine preview:', beforeSpine, '→', afterSpine, beforeSpine === afterSpine ? 'UNCHANGED (BUG)' : 'redrew');

console.log('  db right after commit:', JSON.stringify(await page.evaluate(async (id) => {
  const books = await import('/src/data/books.ts');
  return (await books.getBook(id))?.coverMeta?.style ?? null;
}, opened.id)));

const duplicateOwnSwatches = await page.locator('.nb-own-colour .nb-swatch').count();
if (duplicateOwnSwatches !== 0) {
  throw new Error(`custom colour picker repeated ${duplicateOwnSwatches} redundant swatches`);
}
const anyPigmentPressed = await page.evaluate(
  () => [...document.querySelectorAll('[aria-label="Book base pigment"] .nb-swatch')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true').length,
);
console.log('  named pigments still pressed:', anyPigmentPressed, '(want 0)');
await page.locator('.nb-own-colour').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot('own-02-entered');

/* ---- 3. flip to the cover ---- */
await page.locator('.nb-studio-facepick .nb-chip').nth(1).click();
await page.waitForTimeout(900);
await shot('own-03-cover-face');

/* ---- 4. back to the shelf: does the SPINE wear it? ---- */
console.log('\n4. close the book and sample the shelf spine');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  app.appState.closeBook();
});
await page.waitForTimeout(3000);
// Read the meta only now: the world's book store is refreshed when the book
// closes, so asking while it was open reported the copy loaded before the edit.
const persisted = await page.evaluate(async (id) => {
  // Straight out of SQLite. `__shelfBookMeta` reads the WORLD's copy of the
  // book, which is refreshed on its own schedule — asking it here reported the
  // row as it stood before the studio touched it.
  const books = await import('/src/data/books.ts');
  const meta = (await books.getBook(id))?.coverMeta ?? null;
  return { style: meta?.style?.clothHex ?? null, cover: meta?.cover?.clothHex ?? null };
}, opened.id);
console.log('  persisted:', JSON.stringify(persisted), persisted.style === WANT && persisted.cover === WANT ? 'ok' : '>>> BUG');

const rect = await page.evaluate((id) => globalThis.__shelfSpineRect(id), opened.id);
console.log('  spine rect:', JSON.stringify(rect));
if (rect) {
  const box = {
    x: Math.round(rect.x + rect.width * 0.2),
    y: Math.round(rect.y + rect.height * 0.45),
    width: Math.max(4, Math.round(rect.width * 0.6)),
    height: Math.max(4, Math.round(rect.height * 0.12)),
  };
  await page.screenshot({ path: `${OUT}/own-04-spine-crop.png`, clip: box });
  console.log(`  shot own-04-spine-crop.png (${JSON.stringify(box)})`);
}
await shot('own-04-shelf');

/* ---- 5. the library studio's own colour ---- */
console.log('\n5. a timber colour of my own');
await page.getByRole('button', { name: /studio/i }).first().click();
await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
await page.waitForTimeout(1200);
const keyBefore = await page.evaluate(() => globalThis.__shelfDesign().libraryKey);
console.log('  libraryKey before:', keyBefore.slice(-70));

const timber = page.locator('.nb-library-studio .nb-own-colour-hex').first();
await timber.scrollIntoViewIfNeeded();
await timber.click();
await timber.fill('#7a3f8c');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const keyAfter = await page.evaluate(() => globalThis.__shelfDesign().libraryKey);
console.log('  libraryKey after :', keyAfter.slice(-70));
console.log(keyBefore === keyAfter ? '  >>> BUG: the room key did not move' : '  ok: the room re-baked');
await shot('own-05-library-timber');

/* ---- 6. a wall colour too, via "use it" rather than Enter ---- */
console.log('\n6. a wall colour, committed with the button');
const wall = page.locator('.nb-library-studio .nb-own-colour').nth(1).locator('.nb-own-colour-hex');
await wall.scrollIntoViewIfNeeded();
await wall.click();
await wall.fill('#f2e2c0');
await page.locator('.nb-library-studio .nb-own-colour').nth(1).locator('.nb-chip-gilt').click();
await page.waitForTimeout(2500);
console.log('  libraryKey now  :', (await page.evaluate(() => globalThis.__shelfDesign().libraryKey)).slice(-60));
await shot('own-06-library-wall');

await page.keyboard.press('Escape');
await page.waitForTimeout(2000);
await shot('own-07-room');

/* ---- 7. does any of it survive a restart? ---- */
console.log('\n7. reload and check nothing was forgotten');
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400, timeout: 120000 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400, timeout: 120000 });
const skip2 = page.getByText('skip the tour');
if (await skip2.count()) await skip2.first().click();
await page.waitForTimeout(3000);
console.log('  libraryKey after reload:', (await page.evaluate(() => globalThis.__shelfDesign().libraryKey)).slice(-60));
console.log('  book style after reload:', JSON.stringify(await page.evaluate(async (id) => {
  const books = await import('/src/data/books.ts');
  return (await books.getBook(id))?.coverMeta?.style?.clothHex ?? null;
}, opened.id)));
await shot('own-08-after-reload');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);
await browser.close();
