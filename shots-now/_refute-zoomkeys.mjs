/**
 * _refute-zoomkeys.mjs — do the shelf's ZOOM keys respect the panel guard?
 *
 * world.ts checks `panelOwnsKeyboard()` only for handleNavKey (arrows / Home /
 * Enter). `classifyKeyZoom` runs after it, gated on `editing` alone. This
 * measures whether +/-/0 still reach the camera with a panel out, reading
 * `__shelfWorld.camera.zoom` after it has settled.
 */
import { chromium } from 'playwright';

const URL_BASE = 'http://localhost:1420';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

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
await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'world bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y list');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1500);

const zoom = async () => {
  // Let the camera tween land before reading, or a mid-flight number reads as
  // a leak that is really just the previous keystroke still settling.
  await page.waitForTimeout(1600);
  return page.evaluate(() => Number(globalThis.__shelfWorld.camera.zoom.toFixed(4)));
};

async function trial(name, open, selector, close) {
  // Reset to the default zoom with NOTHING open first: the camera clamps at a
  // floor, and a trial that starts already clamped reads "held" no matter what
  // the guard does — which is how this measurement lies if you skip it.
  await page.keyboard.press('0');
  await page.waitForTimeout(1600);
  if (open) {
    await open();
    await page.waitForSelector(selector, { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(900);
  }
  const flag = await page.evaluate(() => document.documentElement.dataset.nbPanel ?? '(none)');
  const before = await zoom();
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('+');
    await page.waitForTimeout(200);
  }
  const after = await zoom();
  console.log(
    `  ${name.padEnd(22)} flag=${flag.padEnd(6)} zoom ${before} -> ${after}  ${
      Math.abs(after - before) > 0.02 ? 'ZOOM KEY REACHED THE SHELF' : 'held'
    }`,
  );
  if (close) {
    await close();
    await page.waitForTimeout(900);
  }
}

console.log('\n=== the shelf zoom keys (+ - 0), which sit below the guard ===');
await trial('control: nothing open', null, null, null);
await trial(
  'trash drawer',
  () => page.locator('[data-shelf-dock="trash"]').click(),
  '.shelf-trash',
  () => page.keyboard.press('Escape'),
);
await trial(
  'library studio',
  () => page.locator('[data-shelf-dock="studio"]').click(),
  '.nb-library-studio',
  () => page.keyboard.press('Escape'),
);
await trial(
  'cheat sheet',
  () => page.keyboard.press('?'),
  '.nb-cheat-card',
  () => page.keyboard.press('Escape'),
);

await browser.close();
