/**
 * shots-now/bookfit-studio.mjs — the other half of the fit, driven by clicking.
 *
 * `bookfit.mjs` proves the shelf never stands a book through the carpentry.
 * This proves the reader is TOLD when that happens and can refuse it — the
 * second half of the report, and the half a screenshot of the shelf cannot
 * show. Everything here goes through the UI: the book is opened by clicking
 * its spine, the studio by clicking the rail, the format by clicking a chip,
 * and "keep my height" by clicking the button. The only bridges used are the
 * two READ-only ones (`__shelfSaveDesign` to put a low case under the book in
 * the first place, `__shelfBookFit` to see what the shelf actually drew).
 *
 * Usage: node shots-now/bookfit-studio.mjs [--tag=after]
 * Outputs: shots-now/bookfit/<tag>-studio-*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const TAG = opt('tag', 'after');

mkdirSync('shots-now/bookfit', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});

const poll = async (fn, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => {
  try {
    localStorage.clear();
    localStorage.setItem('nb-tutorial-done', '1');
  } catch {}
});
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'world hook');
await poll(() => globalThis.__shelfSaveDesign !== undefined, 120000, 'design bridge');
for (let a = 0; a < 4; a += 1) {
  const card = page.locator('text=skip the tour').first();
  if ((await card.count()) === 0) break;
  await card.click({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
}

/**
 * A case with a deep head. The pigeonhole leaves 144px of the 280 and leaves it
 * everywhere, so the note quotes one number; `--build=gothic` is the other
 * shape of copy, where the arcade varies across the bay and the note has to say
 * "at least".
 */
const BUILD = opt('build', 'pigeonhole');
await page.evaluate(
  (b) =>
  globalThis.__shelfSaveDesign({
    build: b,
    pattern: 'none',
    wallpaper: { pattern: 'plain', scale: 'medium', depth: 'flat', ink: 'paper' },
  }),
  BUILD,
);
await page.waitForTimeout(2500);

/**
 * Open the first book on the shelf, the way `effects-sweep.mjs` does it: the
 * a11y mirror's button PULLS it out, and from there the held book is itself
 * the button. Two clicks, not one.
 */
async function openFirstBook() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator('.nb-prose').count()) > 0) return;
    await page.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    const held = page.locator('[data-testid="pulled-book"]');
    await held.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
    if ((await held.count()) > 0) await held.click({ timeout: 8000 }).catch(() => {});
    const read = page.getByRole('button', { name: 'read it' });
    if ((await read.count()) > 0) await read.click().catch(() => {});
    await page.locator('.nb-prose').waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  }
}

const first = await page.evaluate(() => {
  const fit = globalThis.__shelfBookFit();
  return fit.length === 0 ? null : fit[0].id;
});
if (first === null) throw new Error('no book on the shelf to open');
await openFirstBook();
await page.waitForTimeout(1500);

// The rail's Customize brush, then the book tab is already the default.
const brush = page.locator('[data-tool="customize"]').first();
await brush.click({ timeout: 8000 });
await page.waitForTimeout(1200);

const note = page.locator('.nb-fit-note');
const seen = await note.count();
console.log(`fit note present before choosing a format: ${seen > 0}`);

// Choose the tallest format there is — "folio" is 290px, twice what the
// pigeonhole can give.
const folio = page.locator('.nb-chip-row[aria-label="Book format"] .nb-chip').first();
await folio.scrollIntoViewIfNeeded();
await folio.click();
await page.waitForTimeout(1500);
await note.first().scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
console.log(`fit note after picking the tallest format: ${(await note.count()) > 0}`);
console.log(`  says: ${(await note.first().innerText()).replace(/\s+/g, ' ')}`);
await page.screenshot({ path: `shots-now/bookfit/${TAG}-studio-trimmed.png` });

/** The shelf's own account of this book, once the case has remounted. */
const applied = async () => {
  const t0 = Date.now();
  for (;;) {
    const hit = await page.evaluate(
      (id) => globalThis.__shelfBookFit?.().find((f) => f.id === id) ?? null,
      first,
    );
    if (hit !== null) return hit;
    if (Date.now() - t0 > 30000) {
      const all = await page.evaluate(() => globalThis.__shelfBookFit?.() ?? 'no bridge');
      console.log(`  (looking for ${first}; shelf reports ${JSON.stringify(all).slice(0, 400)})`);
      return null;
    }
    await page.waitForTimeout(400);
  }
};

/**
 * Back to the shelf. TWICE: the first Escape closes the rail's panel and the
 * second puts the book back, which is what the Welcome book's own text
 * promises ("Esc puts it back"). One press left the book open and every
 * measurement below reading null.
 */
async function backToShelf() {
  for (let i = 0; i < 5; i += 1) {
    if ((await page.locator('.nb-prose').count()) === 0) return;
    // Escape first (it closes the rail's panel), then the chip the spread
    // itself offers — Escape alone leaves the book open when the caret is in
    // the editor, which is exactly where clicking a studio control leaves it.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const back = page.getByRole('button', { name: /back to shelf/i }).first();
    if ((await back.count()) > 0) await back.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1400);
  }
}

await backToShelf();
await page.waitForTimeout(1500);
await page.screenshot({ path: `shots-now/bookfit/${TAG}-studio-back.png` });
const trimmedFit = await applied();
console.log(
  `trimmed on the shelf: height=${trimmedFit && Math.round(trimmedFit.height)} ` +
    `clear=${trimmedFit && Math.round(trimmedFit.clear)} crosses=${trimmedFit && trimmedFit.crosses}`,
);

// Back in, press "keep my height", and check the shelf obeys.
await openFirstBook();
await page.waitForTimeout(1500);
await brush.click({ timeout: 8000 });
await page.waitForTimeout(1200);
await note.first().scrollIntoViewIfNeeded();
await page.locator('.nb-fit-note .nb-chip').first().click();
await page.waitForTimeout(1200);
console.log(`  now says: ${(await note.first().innerText()).replace(/\s+/g, ' ')}`);
await page.screenshot({ path: `shots-now/bookfit/${TAG}-studio-kept.png` });

await backToShelf();
await page.waitForTimeout(1500);
const keptFit = await applied();
console.log(
  `kept on the shelf: height=${keptFit && Math.round(keptFit.height)} ` +
    `clear=${keptFit && Math.round(keptFit.clear)} crosses=${keptFit && keptFit.crosses}`,
);
await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  w.camera.zoom = 2.2;
  w.camera.logZoomTarget = Math.log(2.2);
  w.camera.x = 300;
  w.camera.y = 40;
  w.dirty = true;
});
await page.waitForTimeout(1800);
await page.screenshot({ path: `shots-now/bookfit/${TAG}-studio-shelf.png` });

const ok =
  trimmedFit !== null &&
  keptFit !== null &&
  !trimmedFit.crosses &&
  keptFit.height > trimmedFit.height + 10 &&
  keptFit.crosses;
console.log(`\n${ok ? 'OK — trimmed by default, kept on request' : 'FAILED'}`);
console.log('=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);
await browser.close();
process.exit(ok ? 0 : 1);
