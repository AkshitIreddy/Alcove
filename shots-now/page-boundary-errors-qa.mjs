/**
 * Exact `::page` preview + diagnostic-copy journey.
 * Uses the owner's newest downloaded note against the existing :1420 server.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sourcePath = 'C:/Users/akshi/Downloads/huffman-coding-kittens-notebook.md';
const source = readFileSync(sourcePath, 'utf8');
const out = 'shots-now/out/page-boundary-errors';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('nb-tutorial-done', '1');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof globalThis.__shelfAddBook === 'function');
await page.evaluate(async () => globalThis.__shelfWorld?.ready);
const bookId = await page.evaluate(() => globalThis.__shelfVisibleBooks?.()[0]?.id ?? null);
await page.evaluate(async (id) => {
  const app = await import('/src/state/app.ts');
  app.appState.openBook(id);
}, bookId);
await page.waitForSelector('.nb-book-view .nb-prose');
await page.waitForTimeout(900);
for (let attempt = 0; attempt < 3; attempt += 1) {
  const skip = page.getByText('skip the tour', { exact: true }).first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true });
  await page.waitForTimeout(150);
}
await page.locator('.nb-rail-button[data-tool="share"]').click();
await page.getByText('Paste a script in', { exact: true }).click();
const dialog = page.getByRole('dialog', { name: 'Insert script', exact: true });
const textarea = dialog.locator('textarea');
await textarea.fill(source);
await page.waitForTimeout(300);
const validWarnings = await dialog.locator('.nb-ins-warnings li').allTextContents();

// Add one deliberate real error solely to prove the new copy affordance.
await textarea.fill(`${source}\n\n::: definitely-not-a-real-container`);
await page.waitForFunction(() => document.querySelectorAll('.nb-ins-warnings li').length > 0);
const warningRows = await dialog.locator('.nb-ins-warnings li').allTextContents();
await dialog.getByRole('button', { name: 'Copy script errors' }).click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
await dialog.screenshot({ path: `${out}/copy-errors.png` });

const report = {
  sourcePath,
  pageDirectiveCount: (source.match(/^::page\s*$/gm) ?? []).length,
  validWarnings,
  warningRows,
  copied,
  pageErrors,
  ok:
    validWarnings.length === 0 &&
    warningRows.length > 0 &&
    copied.includes('**line ') &&
    copied.includes('definitely-not-a-real-container') &&
    !copied.includes("unknown container 'page'") &&
    pageErrors.length === 0,
};
writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
