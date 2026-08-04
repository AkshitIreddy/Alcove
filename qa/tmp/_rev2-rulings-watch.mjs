/** Diagnostic: watch the card grid after every press. */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(60000);
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

const labels = () =>
  page.$$eval('.nb-pagestyle-card .nb-pagestyle-label', (n) => n.map((x) => x.textContent?.trim() ?? ''));

const start = await labels();
console.log(`expanded: ${start.length}`);

for (const label of start) {
  const card = page
    .locator('.nb-pagestyle-card')
    .filter({ has: page.locator('.nb-pagestyle-label', { hasText: label }) })
    .first();
  const n = await card.count();
  if (n === 0) {
    console.log(`!! "${label}" is GONE from the grid before it could be pressed`);
    console.log(`   grid now: ${(await labels()).join(', ')}`);
    break;
  }
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForTimeout(260);
  const now = await labels();
  const pageStyles = await page.evaluate(() =>
    [...document.querySelectorAll('.nb-page')].map((p) => p.getAttribute('data-style')).join('|'),
  );
  console.log(
    `pressed ${label.padEnd(20)} -> ${String(now.length).padStart(2)} cards, pages=[${pageStyles}]`,
  );
  if (now.length !== start.length) {
    console.log(`   grid now: ${now.join(', ')}`);
    break;
  }
}

await browser.close();
