/**
 * scripts/probe-addbook.mjs — visual QA probe for the add-book affordances
 * and the studio wiring.
 *
 * Drives the REAL UI (no QA-hook shortcuts for interactions): rail "new
 * book" → inline spine naming, the dashed ghost slot, the right-click shelf
 * spot menu, "add floor", and the rail's studio button → theme card pick.
 * Screenshots every state under qa/ui/addbook-*.png and finishes by reloading
 * to prove the created book + picked theme survive (localStorage-backed stub
 * in browser mode, real SQLite in Tauri).
 *
 * Usage: node scripts/probe-addbook.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text());
});

const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`shot qa/ui/${name}.png`);
};

const poll = async (fn, arg, timeout = 45000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(400);
  }
};

const shelfTitles = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.shelf-a11y button')].map((b) => b.textContent),
  );

await page.goto(`${URL_BASE}/?fx=force`, {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await poll(() => globalThis.__shelfWorld !== undefined, null, 120000, 'world hook');
await poll(
  () => document.querySelector('.shelf-a11y button') !== null,
  null,
  120000,
  'a11y mirror',
);
await page.waitForTimeout(2500); // let the bake storm settle for a clean frame
await shot('addbook-01-shelf-at-rest');

/* 1 — the rail: new book / studio / add floor -------------------------- */
await shot('addbook-02-rail');

/* 2 — the ghost slot standing on the plank ------------------------------ */
const ghost = page.locator('[data-testid="shelf-addslot"]');
await ghost.waitFor({ state: 'visible', timeout: 30000 });
await ghost.scrollIntoViewIfNeeded();
await shot('addbook-03-ghost-slot');

/* 3 — rail "new book" → inline spine naming ---------------------------- */
await page.locator('[data-shelf-dock="new-book"]').click();
const naming = page.locator('[data-testid="shelf-spine-name"]');
await naming.waitFor({ state: 'visible', timeout: 15000 });
await naming.fill('Window Seat Notes');
await page.waitForTimeout(400);
await shot('addbook-04-naming-on-spine');
await naming.press('Enter');
await poll(
  () =>
    [...document.querySelectorAll('.shelf-a11y button')].some(
      (b) => b.textContent === 'Window Seat Notes',
    ),
  null,
  30000,
  'named book on the shelf',
);
await page.waitForTimeout(1200);
await shot('addbook-05-book-landed');

/* 4 — right-click bare plank → the shelf's own menu --------------------- */
const cam = await page.evaluate(() => {
  const c = globalThis.__shelfWorld.camera;
  return { x: c.x, y: c.y, zoom: c.zoom };
});
const pt = { x: (950 - cam.x) * cam.zoom, y: (290 - cam.y) * cam.zoom };
await page.mouse.click(pt.x, pt.y, { button: 'right' });
await page.locator('.shelf-menu--spot').waitFor({ state: 'visible', timeout: 15000 });
await page.waitForTimeout(400);
await shot('addbook-06-spot-menu');
await page.keyboard.press('Escape');

/* 5 — add floor flies the camera down ---------------------------------- */
const yBefore = (await page.evaluate(() => globalThis.__shelfWorld.camera.y));
await page.locator('[data-shelf-dock="add-floor"]').click();
await poll(
  (target) => globalThis.__shelfWorld.camera.y > target,
  yBefore + 80,
  30000,
  'camera flight to the new floor',
);
await page.waitForTimeout(1000);
await shot('addbook-07-add-floor');

/* 6 — studio opens; theme cards from the real art ----------------------- */
await page.locator('[data-shelf-dock="studio"]').click();
await page.locator('.nb-library-studio').waitFor({ state: 'visible', timeout: 15000 });
await page.locator('.nb-theme-card').first().waitFor({ state: 'visible', timeout: 30000 });
// Give the card art a beat to bake before the portrait.
await page.waitForTimeout(2500);
await shot('addbook-08-studio-cards');

await page.locator('.nb-theme-card', { hasText: 'Moonlit' }).click();
await poll(
  () => globalThis.__libraryPrefs?.current()?.theme === 'observatory',
  null,
  30000,
  'theme pref in the store',
);
await poll(
  () => (globalThis.__shelfWorld.libraryKey ?? '').includes('observatory'),
  null,
  60000,
  'shelf re-theme',
);
await page.waitForTimeout(1500); // crossfade dissolves
await shot('addbook-09-rethemed-shelf');
await page.keyboard.press('Escape');

/* 7 — reload: the book and the room both survive ------------------------ */
await page.reload({ waitUntil: 'domcontentloaded' });
await poll(() => globalThis.__shelfWorld !== undefined, null, 120000, 'world hook (reload)');
await poll(
  () =>
    [...document.querySelectorAll('.shelf-a11y button')].some(
      (b) => b.textContent === 'Window Seat Notes',
    ),
  null,
  60000,
  'created book after reload',
);
await poll(
  () => globalThis.__libraryPrefs?.current()?.theme === 'observatory',
  null,
  60000,
  'theme pref after reload',
);
await page.waitForTimeout(2500);
await shot('addbook-10-after-reload');

console.log('titles after reload:', JSON.stringify(await shelfTitles()));
console.log('PROBE OK');
await browser.close();
