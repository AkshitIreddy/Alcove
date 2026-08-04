/**
 * refute-rulings-reach.mjs — the two other places PAGE_STYLES is iterated or
 * typed out, driven rather than read: the book studio's "pages of this book"
 * chip row and the settings sheet's "new pages are ruled" segment.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./shots-refute/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
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

await page.goto('http://localhost:1420/?fx=force&dev=1', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => window.__nbTutorial?.stop?.());
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 180000 });
await page.waitForTimeout(2500);

const tools = await page.$$eval('button[data-tool]', (n) =>
  n.map((x) => x.getAttribute('data-tool')),
);
console.log('rail tools:', tools.join(', '));

for (const tool of ['customize', 'studio', 'book']) {
  if (!tools.includes(tool)) continue;
  await page.locator(`button[data-tool="${tool}"]`).first().dispatchEvent('click');
  await page.waitForTimeout(1200);
  const n = await page.locator('[aria-label="Default page style"]').count();
  console.log(`tool "${tool}" -> chip row present: ${n}`);
  if (n) {
    const row = page.locator('[aria-label="Default page style"]').first();
    const chips = await row.locator('.nb-chip').allTextContents();
    console.log(`  chips (${chips.length}): ${chips.join(' | ')}`);
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}studio-page-style-chips.png` });
    break;
  }
}

await browser.close();
