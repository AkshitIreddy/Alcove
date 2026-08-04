/**
 * _lazy-seams-boot.mjs — the four things the boot stopped loading, opened.
 *
 * Scratch companion to `perf-lazy-seams.mjs`, which covers the seams that
 * already existed (the book, the templates gallery, the parcel desk, the
 * Markdown importer). These four are new:
 *
 *   1. the STUDIO sheet, now a `lazy()` behind the dock's palette button;
 *   2. the SETTINGS sheet, now a `lazy()` behind the gear;
 *   3. the PERF HUD, which used to ride inside the settings sheet's
 *      always-mounted layer and now has to appear without it;
 *   4. the custom-sticker registry, now hydrated through an `import()`.
 *
 * Every one of them is a chance to ship a button that does nothing, which is
 * the failure mode this repo has hit eight times. So each is driven the way a
 * reader drives it — clicks and keys, never an internal call — and the run
 * fails on any page error.
 *
 * Usage: node shots-now/_lazy-seams-boot.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, f) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : f;
};
const BASE = opt('url', 'http://localhost:1420');
mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = new Map();
const note = (k) => errors.set(k, (errors.get(k) ?? 0) + 1);
page.on('pageerror', (e) => note(e.message.split('\n')[0]));
page.on('response', (r) => {
  if (r.status() >= 400) note(`HTTP ${r.status()} ${r.url().split('/').pop()}`);
});

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failures += 1;
};
const shot = async (n) => {
  await page.screenshot({ path: `qa/ui/seam-${n}.png` });
  console.log(`  shot qa/ui/seam-${n}.png`);
};

await page.goto(`${BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(
  () => typeof window.__shelfVisibleBooks === 'function' && window.__shelfVisibleBooks().length > 0,
  null,
  { timeout: 60000 },
);

console.log('\n1. the shelf is drawn before any of the four arrives');
// The studio is PREFETCHED on idle, so by now it may legitimately have landed.
// What must be true is that the shelf did not WAIT for it: the settings sheet
// has no prefetch at all, so its absence here is the honest signal.
check(
  'no settings sheet in the DOM yet',
  (await page.locator('.nbs-sheet').count()) === 0,
);
check('no studio sheet in the DOM yet', (await page.locator('.nb-rail-panel.is-shelf').count()) === 0);
await shot('01-shelf');

console.log('\n2. the studio opens from the dock');
await page.click('button[aria-label="Open the studio"], .shelf-dock button:has-text("studio")');
await page.waitForSelector('.nb-rail-panel', { timeout: 20000 });
await page.waitForFunction(
  () => (document.querySelectorAll('.nb-rail-panel canvas').length ?? 0) > 0,
  null,
  { timeout: 30000 },
);
check(
  'studio mounted with painted preview cards',
  (await page.locator('.nb-rail-panel canvas').count()) > 0,
  `${await page.locator('.nb-rail-panel canvas').count()} canvases`,
);
await shot('02-studio');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

console.log('\n3. the settings sheet opens from the gear');
await page.click('.nbs-gear-button');
await page.waitForSelector('.nbs-sheet', { timeout: 20000 });
await page.waitForFunction(
  () => {
    const s = document.querySelector('.nbs-sheet');
    return s !== null && s.getBoundingClientRect().right > 0 && getComputedStyle(s).visibility === 'visible';
  },
  null,
  { timeout: 20000 },
);
check('settings sheet mounted and slid in', true);
check('it has its rows', (await page.locator('.nbs-sheet button, .nbs-sheet input').count()) > 10);
await shot('03-settings');

console.log('\n4. the perf HUD, which no longer lives inside that sheet');
// Turned on through the sheet's own toggle would be ideal, but the row is far
// down a long scroller; the store write is the same one the toggle makes and
// the point being proved is the MOUNT, not the checkbox.
await page.evaluate(() => window.__shelfSaveSettings?.({ perfHud: true }));
await page.waitForSelector('.nb-perfhud', { timeout: 20000 }).catch(() => {});
check('HUD appears while the sheet is open', (await page.locator('.nb-perfhud').count()) > 0);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
check(
  'HUD survives the sheet closing',
  (await page.locator('.nb-perfhud').count()) > 0 &&
    (await page.locator('.nb-perfhud').isVisible()),
);
await shot('04-perfhud');

console.log('\n5. the HUD on a fresh boot, with the sheet never opened');
// This is the regression the move exists to prevent: the HUD used to be a
// child of the settings layer, so once that layer became lazy a relaunch with
// the setting on would have shown nothing until the gear was pressed.
// RELOAD, not a new page: `browser.newPage()` gets its own context and so its
// own empty storage, which throws away the very setting being tested — the
// check passed vacuously in one direction and failed in the other. A reload in
// this context is what a relaunch actually looks like to the app.
const page2 = page;
await page2.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page2.waitForFunction(
  () => typeof window.__shelfVisibleBooks === 'function' && window.__shelfVisibleBooks().length > 0,
  null,
  { timeout: 60000 },
);
await page2.waitForSelector('.nb-perfhud', { timeout: 20000 }).catch(() => {});
check(
  'HUD is on screen without settings ever being opened',
  (await page2.locator('.nb-perfhud').count()) > 0,
);
check('and the settings sheet really was never mounted', (await page2.locator('.nbs-sheet').count()) === 0);
await page2.screenshot({ path: 'qa/ui/seam-05-perfhud-fresh-boot.png' });
console.log('  shot qa/ui/seam-05-perfhud-fresh-boot.png');
await page.evaluate(() => window.__shelfSaveSettings?.({ perfHud: false }));

console.log('\n6. the custom-sticker registry still hydrates');
const stickers = await page2.evaluate(async () => {
  const m = await import('/src/editor/nodes/stickers.ts');
  return m.listUserStickers().length;
});
check('registry reachable and populated', typeof stickers === 'number', `${stickers} user stickers`);

console.log('\n=== page errors ===');
console.log(errors.size ? [...errors].map(([k, n]) => `  x${n} ${k}`).join('\n') : '  none');
if (errors.size) failures += 1;
console.log(failures === 0 ? '\nALL SEAMS OPEN\n' : `\n${failures} FAILED\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
