/**
 * shots-now/own-colour-look.mjs — a readable picture of the two colour doors.
 *
 * own-colour-book.mjs asserts; this one is only for looking at. It scrolls the
 * cloth section and then the charm section to the top of the sheet and shoots
 * the panel's own rectangle at 2x, because a full-element capture of a 5000px
 * panel comes back as a thumbnail nobody can judge.
 *
 * Usage: node shots-now/own-colour-look.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots-now/out';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(90_000);

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
for (let i = 0; i < 4; i++) {
  const skip = page.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(500);
}
await page.waitForTimeout(2500);

await page.locator('.shelf-a11y button').first().dispatchEvent('click');
await page.waitForTimeout(4000);
const readIt = page.getByRole('button', { name: 'read it' });
if (await readIt.count()) await readIt.click().catch(() => {});
await page.waitForSelector('.nb-rail', { timeout: 60_000 });
await page.locator('.nb-rail-button[data-tool="customize"]').click();
await page.waitForSelector('.nb-book-studio', { timeout: 30_000 });
await page.waitForTimeout(1800);

// Give the book a charm so its colour row exists.
const charmGroup = page.locator('.nb-book-studio [aria-label="Charm"]');
await charmGroup.scrollIntoViewIfNeeded();
await charmGroup.locator('.nb-chip').nth(1).click();
await page.waitForTimeout(1200);

const panel = page.locator('.nb-rail-panel').first();

/** Put a section title at the top of the scroller and shoot the panel. */
const shoot = async (name, titleText) => {
  await page.evaluate((text) => {
    const heads = [...document.querySelectorAll('.nb-book-studio .nb-panel-section-title')];
    const head = heads.find((h) => h.textContent?.trim().toLowerCase().startsWith(text));
    head?.scrollIntoView({ block: 'start' });
  }, titleText);
  await page.waitForTimeout(900);
  await panel.screenshot({ path: `${OUT}/${name}` });
  console.log('  wrote', name);
};

await shoot('look-1-pigment.png', 'pigment');
await shoot('look-2-charm.png', 'charm');

await browser.close();
