/** Verify the two logical custom-colour homes without redundant swatch grids. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const base = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const out = 'shots-now/out/own-colour-layout';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--mute-audio',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

try {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('nb-tutorial-done', '1');
  });
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof globalThis.__shelfWorld !== 'undefined');
  const skipTour = page.getByText('skip the tour', { exact: true });
  if (await skipTour.count()) {
    await skipTour.first().click();
    await skipTour.first().waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: 'Library studio', exact: true }).click();
  await page.locator('.nb-library-studio').waitFor({ state: 'visible' });

  const studio = page.locator('.nb-library-studio');
  const result = {
    pickerCount: await studio.locator('.nb-own-colour').count(),
    colourWellCount: await studio.locator('.nb-own-colour-well').count(),
    hexInputCount: await studio.locator('.nb-own-colour-hex').count(),
    redundantSwatchCount: await studio.locator('.nb-own-colour .nb-swatch').count(),
    titles: await studio.locator('.nb-own-colour-title').allTextContents(),
    pageErrors,
  };
  if (
    result.pickerCount !== 2 ||
    result.colourWellCount !== 2 ||
    result.hexInputCount !== 2 ||
    result.redundantSwatchCount !== 0 ||
    pageErrors.length > 0
  ) throw new Error(`custom-colour layout regression: ${JSON.stringify(result)}`);

  await studio.locator('.nb-own-colour').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/01-two-pickers-no-swatch-shelf.png`, caret: 'hide' });
  writeFileSync(`${out}/report.json`, JSON.stringify({ ok: true, ...result }, null, 2));
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  await browser.close();
}
