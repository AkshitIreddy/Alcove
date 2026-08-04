/**
 * Does growing PAGE_STYLES from 4 to 27 spill into the OTHER picker that
 * iterates it — the book studio's "pages of this book" default-style row?
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./rev2/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(90000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript(
  ([storageKey, tutorialKey]) => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const blob = raw === null ? {} : JSON.parse(raw);
      const rows = Array.isArray(blob.settings) ? blob.settings : [];
      const at = rows.findIndex((r) => r?.key === tutorialKey);
      const row = { key: tutorialKey, value: '1' };
      if (at >= 0) rows[at] = row;
      else rows.push(row);
      blob.settings = rows;
      window.localStorage.setItem(storageKey, JSON.stringify(blob));
    } catch {}
  },
  ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
);

await page.goto('http://localhost:1420/?fx=force&dev=1', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => window.__nbTutorial?.stop?.());
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 180000 });
await page.waitForTimeout(2500);

await page.locator('button[data-tool="customize"]').first().dispatchEvent('click');
await page.waitForTimeout(1200);

const row = page.locator('[aria-label="Default page style"]');
const n = await row.locator('.nb-chip').count();
const chips = await row.locator('.nb-chip').allTextContents();
console.log(`default-page-style chips: ${n}`);
console.log(chips.join(' | '));
const box = await row.boundingBox().catch(() => null);
console.log('row box:', JSON.stringify(box));

await row.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}customize-pagestyle-row.png`, clip: { x: 0, y: 0, width: 460, height: 900 } });

await browser.close();
