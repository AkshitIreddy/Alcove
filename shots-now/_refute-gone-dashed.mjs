/**
 * shots-now/_refute-gone-dashed.mjs — which rule wins on `.nb-cur-gone`.
 *
 * `.nb-cur-gone { border-style: dashed }` (curation.css) is the whole visual
 * difference between "an entry you removed but are still wearing" and an
 * ordinary member of the list. It is a single-class selector, and so is every
 * rule it has to beat — `.nb-chip { border: … }` in rail.css, `.nb-strip-tile
 * { border: … }` in studio.css — both of which use the border SHORTHAND, which
 * resets `border-style` on its way past. Equal specificity means source order
 * decides, and source order here is Vite's module-evaluation order.
 *
 * So this asks the browser rather than the stylesheet: it stamps the class onto
 * one chip and one strip tile and reads `getComputedStyle`. Diagnostic only —
 * it is not proof of anything a reader reached, which is why it lives beside
 * `_refute-curated-chips.mjs` rather than inside it.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';

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
await page.waitForTimeout(1000);

// The library studio has the strips; the book studio has the chip rows.
await page.locator('.nb-shelf-dock button[data-tool="studio"]').click().catch(() => {});
await page.waitForTimeout(1500);
const strip = await page.evaluate(() => {
  const tile = document.querySelector('.nb-strip-tile');
  if (tile === null) return null;
  const before = getComputedStyle(tile).borderStyle;
  tile.classList.add('nb-cur-gone');
  const after = getComputedStyle(tile).borderStyle;
  tile.classList.remove('nb-cur-gone');
  return { before, after };
});
console.log('strip tile  :', JSON.stringify(strip));

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  if (list[0]) app.appState.openBook(list[0].id);
});
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForTimeout(1000);
await page.locator('.nb-rail-button[data-tool="customize"]').click();
await page.waitForSelector('.nb-book-studio', { timeout: 30000 });
await page.waitForTimeout(900);

const chip = await page.evaluate(() => {
  const el = document.querySelector('[aria-label="Edge treatment"] .nb-chip');
  if (el === null) return null;
  const before = getComputedStyle(el).borderStyle;
  el.classList.add('nb-cur-gone');
  const after = getComputedStyle(el).borderStyle;
  el.classList.remove('nb-cur-gone');
  return { before, after };
});
console.log('studio chip :', JSON.stringify(chip));

// Which sheet lands later in the cascade — the answer to "why".
const order = await page.evaluate(() => {
  const out = [];
  for (const sheet of [...document.styleSheets]) {
    let rules;
    try {
      rules = [...sheet.cssRules];
    } catch {
      continue;
    }
    for (const rule of rules) {
      const sel = rule.selectorText;
      if (sel === '.nb-cur-gone' || sel === '.nb-chip' || sel === '.nb-strip-tile') {
        out.push(`${out.length}: ${sel}`);
      }
    }
  }
  return out;
});
console.log('cascade order:', order.join('  →  '));

await browser.close();
