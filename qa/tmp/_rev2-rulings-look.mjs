/** Look at the rulings the claimant did NOT photograph, on the real page. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./rev2/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const LOOK = ['Engineering', 'Storyboard', 'Log paper', 'Hex dots', 'Graph paper', 'Guitar tab', 'Calligraphy slant', 'Legal pad'];

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
await page.locator('.nb-prose').first().click({ timeout: 30000 });
await page.waitForTimeout(400);
await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
await page.waitForSelector('.nb-pagestyle', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(700);
await page.locator('.nb-pagestyle-more').click();
await page.waitForTimeout(600);

for (const label of LOOK) {
  const card = page
    .locator('.nb-pagestyle-card')
    .filter({ has: page.locator('.nb-pagestyle-label', { hasText: label }) })
    .first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForTimeout(500);
  const id = await page.evaluate(
    () =>
      [...document.querySelectorAll('.nb-page')].find((p) =>
        p.querySelector('.nb-page-editor .ProseMirror'),
      )?.getAttribute('data-style') ?? '',
  );
  const file = `look-${label.toLowerCase().replace(/\s+/g, '-')}.png`;
  await page.screenshot({ path: `${OUT}${file}`, clip: { x: 430, y: 150, width: 500, height: 650 } });
  console.log(`${label} -> ${id} -> ${file}`);
}

await browser.close();
