/**
 * shots-now/_refute-starred-menu.mjs — one question, asked on its own.
 *
 * In the four-row run, every right-click on a plain chip opened that chip's own
 * menu, and the first right-click on a STARRED chip opened a menu with no name
 * in it — which is the LIST menu, i.e. the entry handler never ran. If that is
 * real, a reader can star something and then never remove or un-star it again.
 *
 * So: star a chip, right-click it, and print what actually opened.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('qa/tmp', { recursive: true });
const URL_BASE = 'http://localhost:1420';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(60000);

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  app.appState.openBook(list[0].id);
});
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForTimeout(1200);
await page.locator('.nb-rail-button[data-tool="customize"]').click();
await page.waitForSelector('.nb-book-studio', { timeout: 30000 });
await page.waitForTimeout(1000);

const dump = async (tag) => {
  const menus = await page.$$eval('.nb-cur-menu', (list) =>
    list.map((m) => ({
      label: m.getAttribute('aria-label'),
      name: m.querySelector('.nb-cur-menu-name')?.textContent?.trim() ?? null,
      items: [...m.querySelectorAll('.nb-cur-menu-item')].map((b) => b.textContent?.trim()),
    })),
  );
  console.log(`  [${tag}] ${menus.length} menu(s):`, JSON.stringify(menus));
};

// Star the LAST cover-frame chip (a four-chip row: nothing scrolls under it,
// so a scroll cannot be what closes the menu).
const row = '[aria-label="Cover frame"] .nb-chip';
await page.locator(row).first().scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const n = await page.locator(row).count();
console.log(`Cover frame has ${n} chips`);
await page.locator(row).nth(n - 1).click({ button: 'right' });
await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
await dump('menu on an UNSTARRED chip');
await page.locator('.nb-cur-menu button.nb-cur-menu-item', { hasText: 'first of them all' }).click();
await page.waitForTimeout(700);

const words = await page.$$eval(row, (c) => c.map((x) => x.textContent?.trim()));
console.log('  row after starring:', words.join(' | '));

// …and now right-click the starred one, which is at the head of the row.
await page.locator(row).first().click({ button: 'right' });
await page.waitForTimeout(1000);
await dump('menu on the STARRED chip');
await page.screenshot({ path: 'qa/tmp/refute-starred-menu.png' });

// Second attempt, in case the first was a race with the re-order.
await page.locator(row).first().click({ button: 'right' });
await page.waitForTimeout(1000);
await dump('second right-click on the STARRED chip');

await browser.close();
