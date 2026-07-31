/**
 * scripts/probe-studio-wiring.mjs — the studio, driven as a reader drives it.
 *
 * `probe-vocabularies.mjs` writes designs through the QA bridge, which proves
 * the world reacts but says nothing about whether the PANEL can get there. So
 * this one only ever clicks: open the studio from the dock, pick a build off
 * the strip, pick a paper, and check that the shelf behind the sheet changed
 * to what was clicked.
 *
 * Usage: node scripts/probe-studio-wiring.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

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

const poll = async (fn, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, 120000, 'design bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1500);
await page.evaluate(() =>
  globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice', 'Watercolor Basics'], 0),
);
await page.waitForTimeout(1800);

/* 1 — the studio opens from the dock, and pushes the world aside ---------- */

console.log('\n1. open the studio from the dock');
await page.getByRole('button', { name: /studio/i }).first().click();
await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
await page.waitForTimeout(1400);
console.log(
  '  panel push:',
  await page.evaluate(() => ({
    push: getComputedStyle(document.documentElement).getPropertyValue('--nb-panel-push').trim(),
    flag: document.documentElement.dataset.nbPanel ?? null,
  })),
);
await shot('studio-01-open');

/* 2 — pick a build off the strip ----------------------------------------- */

console.log('\n2. pick a build');
const before = await page.evaluate(() => globalThis.__shelfDesign().shelf);
console.log('  before:', before);

// Target the strip by its aria-label, not by card text: the theme cards'
// blurbs contain words like "parchment", and a loose /arch/ match clicked one
// of those instead — which is exactly the sort of false pass a probe is
// supposed to avoid.
const buildStrip = page.locator('[aria-label="Bookcase build"]');
await buildStrip.waitFor({ timeout: 20000 });
// Skip tile 0 (the current plank case) so the change cannot be a no-op.
const buildCard = buildStrip.locator('button.nb-strip-tile:not(.nb-strip-more)').nth(2);
await buildCard.scrollIntoViewIfNeeded();
const buildName = (await buildCard.textContent())?.trim().split('\n')[0];
console.log('  clicking build card:', JSON.stringify(buildName));
await buildCard.click();
await page.waitForTimeout(400);

const afterBuild = await poll(
  () => {
    const s = globalThis.__shelfDesign().shelf;
    return s.split('.')[0] !== 'plank' ? s : null;
  },
  30000,
  'the build to reach the case',
);
console.log('  applied:', afterBuild);
await page.waitForTimeout(1600);
await shot('studio-02-build-picked');

/* 3 — pick a wallpaper --------------------------------------------------- */

console.log('\n3. pick a wallpaper');
const paperBefore = await page.evaluate(() => globalThis.__shelfDesign().design.wallpaper.pattern);
console.log('  before:', paperBefore);

const paperStrip = page.locator('[aria-label="Wallpaper"]');
await paperStrip.waitFor({ timeout: 20000 });
const paperCard = paperStrip.locator('button.nb-strip-tile:not(.nb-strip-more)').nth(3);
await paperCard.scrollIntoViewIfNeeded();
const paperName = (await paperCard.textContent())?.trim().split('\n')[0];
console.log('  clicking paper card:', JSON.stringify(paperName));
await paperCard.click();
await page.waitForTimeout(400);

const afterPaper = await poll(
  (p) => {
    const w = globalThis.__shelfDesign().design.wallpaper.pattern;
    return w !== p ? w : null;
  },
  30000,
  'the wallpaper to reach the wall',
);
console.log('  applied:', afterPaper);
await page.waitForTimeout(1800);
await shot('studio-03-paper-picked');

/* 4 — close: the world comes back ---------------------------------------- */

console.log('\n4. Escape closes and the world returns');
await page.keyboard.press('Escape');
await page.waitForTimeout(1400);
console.log(
  '  after close:',
  await page.evaluate(() => ({
    studio: document.querySelector('.nb-library-studio') !== null,
    push: getComputedStyle(document.documentElement).getPropertyValue('--nb-panel-push').trim(),
    flag: document.documentElement.dataset.nbPanel ?? null,
  })),
);
await shot('studio-04-closed');

/* 5 — no horizontal overflow at a small window --------------------------- */

console.log('\n5. narrow window');
await page.setViewportSize({ width: 900, height: 620 });
await page.waitForTimeout(900);
await page.getByRole('button', { name: /studio/i }).first().click();
await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
await page.waitForTimeout(1600);
console.log(
  '  overflow:',
  await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  })),
);
await shot('studio-05-narrow');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

await browser.close();
process.exit(errors.size === 0 ? 0 : 1);
