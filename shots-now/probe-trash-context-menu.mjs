/** Right-clicking the dock trash must offer a safe, two-step empty action. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'shots-now/out/trash-context-menu';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(60_000);
const report = { ok: false };

try {
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const trash = page.locator('[data-shelf-dock="trash"]');
  await trash.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Trash actions' });
  await menu.waitFor({ state: 'visible' });
  report.rows = await menu.locator('[role="menuitem"]').allTextContents();
  await page.screenshot({ path: `${OUT}/01-trash-right-click.png`, caret: 'hide' });

  await menu.locator('[data-trash-action="empty"]').click();
  report.confirmText = await menu.innerText();
  await page.screenshot({ path: `${OUT}/02-empty-confirmation.png`, caret: 'hide' });
  await menu.getByRole('button', { name: 'Keep' }).click();
  report.returnedToMenu = await menu.locator('[data-trash-action="empty"]').isVisible();
  await page.keyboard.press('Escape');
  report.closed = await menu.count() === 0;
  report.ok =
    report.rows.some((row) => row.includes('Open trash')) &&
    report.rows.some((row) => row.includes('Empty trash')) &&
    report.confirmText.includes('cannot be undone') &&
    report.returnedToMenu &&
    report.closed;
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
