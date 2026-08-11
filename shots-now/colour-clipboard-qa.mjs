/**
 * Reader-path QA for copying one key book colour into another picker.
 * Uses the existing :1420 server; it neither starts nor stops one.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots-now/out';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);

try {
  await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 300 });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click().catch(() => {});

  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    if (list[0]) app.appState.openBook(list[0].id);
  });
  await page.waitForSelector('.nb-rail');
  await page.locator('.nb-rail-button[data-tool="customize"]').click();
  const studio = page.locator('.nb-book-studio');
  await studio.waitFor({ state: 'visible' });

  const group = studio.getByRole('group', { name: 'Key book colours' });
  const cards = group.locator('.nb-book-colour-role');
  if ((await cards.count()) !== 4) throw new Error('expected four key colour cards');

  const source = cards.nth(0);
  const destination = cards.nth(1);
  const chosen = await source.locator('input[type="color"]').inputValue();
  const before = await destination.locator('input[type="color"]').inputValue();

  await source.locator('.nb-colour-clipboard-button').nth(0).click();
  const systemText = await page.evaluate(() => navigator.clipboard.readText());
  if (systemText !== chosen) throw new Error(`system clipboard held ${systemText}, expected ${chosen}`);

  await destination.locator('.nb-colour-clipboard-button').nth(1).click();
  await page.waitForTimeout(900);
  const destinationValue = await destination.locator('input[type="color"]').inputValue();
  if (destinationValue === before && before !== chosen) {
    throw new Error(`destination remained ${destinationValue} after pasting ${chosen}`);
  }

  await group.screenshot({
    path: `${OUT}/colour-clipboard-key-colours.png`,
    animations: 'disabled',
  });
  console.log(JSON.stringify({ ok: true, copied: chosen, before, pasted: destinationValue }));
} finally {
  await browser.close();
}
