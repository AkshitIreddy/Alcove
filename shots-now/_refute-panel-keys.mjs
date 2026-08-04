/**
 * refute-panel-keys.mjs — independent check of the panel-keys guard.
 *
 * Asserts on the APPLIED state only: `__shelfWorld.keyboardSelection`,
 * `__shelfWorld.camera.zoom` and whether a book actually opened. Never on a
 * store this file imported.
 *
 * Three questions the committed probe does not ask:
 *   1. Enter — the key that PULLS A BOOK OUT and opens it on top of the sheet.
 *   2. Home  — throws the camera to the first floor.
 *   3. +/-/0 — the shelf's zoom keys, which sit BELOW the guard in world.ts.
 */
import { chromium } from 'playwright';

const URL_BASE = 'http://localhost:1420';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

const poll = async (fn, timeout = 120000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'the world bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y list');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);
await page.evaluate(() =>
  globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice', 'Watercolor Basics'], 0),
);
await page.waitForTimeout(1500);

const state = () =>
  page.evaluate(() => ({
    sel: JSON.stringify(globalThis.__shelfWorld.keyboardSelection),
    floor: Number(globalThis.__shelfWorld.centerFloor.toFixed(3)),
    zoom: Number((globalThis.__shelfWorld.camera?.zoom ?? -1).toFixed(4)),
    flag: document.documentElement.dataset.nbPanel ?? null,
    scene: document.querySelector('.nb-rail') !== null ? 'book' : 'shelf',
  }));

async function press(key) {
  await page.keyboard.press(key);
  await page.waitForTimeout(320);
}

/* ---- control: with nothing open every key must reach the shelf ------------ */
console.log('\n=== control (nothing open) ===');
await press('Home');
const c0 = await state();
await press('ArrowDown');
const c1 = await state();
await press('-');
const c2 = await state();
console.log(`  arrows: ${c0.sel} -> ${c1.sel}  ${c0.sel !== c1.sel ? 'moves' : 'DEAD'}`);
console.log(`  zoom  : ${c1.zoom} -> ${c2.zoom}  ${c1.zoom !== c2.zoom ? 'moves' : 'DEAD'}`);
const controlNav = c0.sel !== c1.sel;
const controlZoom = c1.zoom !== c2.zoom;

/* ---- each surface, every key the shelf binds ----------------------------- */
const rows = [];

async function surface(name, open, selector, close) {
  console.log(`\n${name}`);
  await press('Home');
  await page.waitForTimeout(300);
  await open();
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 20000 });
  } catch {
    console.log(`  UNREACHABLE (${selector})`);
    rows.push({ name, unreachable: true });
    return;
  }
  await page.waitForTimeout(800);
  const before = await state();

  await press('ArrowDown');
  await press('ArrowRight');
  const afterArrows = await state();
  const arrowLeak = before.sel !== afterArrows.sel || before.floor !== afterArrows.floor;

  await press('Enter');
  await page.waitForTimeout(1200);
  const afterEnter = await state();
  const enterLeak = afterEnter.scene === 'book';

  await press('-');
  await press('0');
  const afterZoom = await state();
  const zoomLeak = afterEnter.zoom !== afterZoom.zoom;

  console.log(`  flag=${before.flag ?? '(none)'}  sel ${before.sel} -> ${afterArrows.sel}`);
  console.log(`  arrows: ${arrowLeak ? 'LEAK' : 'held'}   Enter: ${enterLeak ? 'LEAK — a book opened' : 'held'}   zoom keys: ${zoomLeak ? `LEAK ${afterEnter.zoom} -> ${afterZoom.zoom}` : 'held'}`);

  if (enterLeak) {
    // Get back to the shelf so the rest of the run still means something.
    await page.evaluate(async () => {
      const app = await import('/src/state/app.ts');
      app.appState.closeBook?.();
    });
    await page.waitForTimeout(1500);
  } else {
    await close();
  }
  await page.waitForTimeout(900);
  rows.push({ name, arrowLeak, enterLeak, zoomLeak, flag: before.flag });
}

await surface(
  'Library studio (RailPanel)',
  () => page.locator('[data-shelf-dock="studio"]').click(),
  '.nb-library-studio',
  () => page.keyboard.press('Escape'),
);
await surface(
  'Trash drawer',
  () => page.locator('[data-shelf-dock="trash"]').click(),
  '.shelf-trash',
  () => page.keyboard.press('Escape'),
);
await surface(
  'Templates gallery',
  () => page.locator('[data-shelf-dock="templates"]').click(),
  '.nb-tpl-gallery',
  () => page.keyboard.press('Escape'),
);
await surface(
  'Settings sheet',
  () => page.locator('.nbs-gear-button').click(),
  '.nbs-sheet',
  () => page.keyboard.press('Escape'),
);
await surface(
  'Cheat sheet',
  () => page.keyboard.press('?'),
  '.nb-cheat-card',
  () => page.keyboard.press('Escape'),
);
await surface(
  'Quick switcher',
  () => page.keyboard.press('Control+k'),
  '.nb-qs-bar',
  () => page.keyboard.press('Escape'),
);

console.log('\n=== verdict ===');
console.log(`  control: arrows ${controlNav ? 'ok' : 'BROKEN PROBE'}, zoom ${controlZoom ? 'ok' : 'BROKEN PROBE'}`);
for (const r of rows) {
  if (r.unreachable) {
    console.log(`  n/a   ${r.name}`);
    continue;
  }
  console.log(
    `  ${r.arrowLeak ? 'ARROW-LEAK' : 'arrows-held'}  ${r.enterLeak ? 'ENTER-LEAK' : 'enter-held'}  ${r.zoomLeak ? 'ZOOM-LEAK' : 'zoom-held'}  [${r.flag ?? '    '}] ${r.name}`,
  );
}
console.log('\npage errors: ' + (errors.length === 0 ? 'none' : errors.join(' | ')));
await browser.close();
