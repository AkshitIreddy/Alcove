/** Headless visual/interaction QA for context-menu settings and scroll chrome. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6)
  ?? 'http://localhost:1420';
const out = 'qa/context-menu-customization';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  await page.goto(`${base}/?fx=force&qa-silent=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('nb-tutorial-done', '1');
    localStorage.setItem('appState:tutorialCompleted', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const skipTour = page.getByText('skip the tour', { exact: false }).first();
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click({ force: true });
  await page.waitForFunction(() => typeof globalThis.__shelfSeedBooks === 'function');
  await page.evaluate(() => globalThis.__shelfSeedBooks(['Context menu QA'], 0));
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    app.appState.openBook(list[0].id);
  });
  await page.waitForSelector('.nb-prose');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('alcove:open-settings')));
  const settings = page.locator('.nbs-sheet');
  await settings.waitFor({ state: 'visible' });
  await settings.locator('.nbs-find-input').fill('context menu');
  await page.waitForTimeout(250);
  await settings.screenshot({ path: `${out}/settings-context-menu.png`, animations: 'disabled' });
  const settingChoices = await settings.locator('.nbs-context-menu-choice').count();
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await settings.waitFor({ state: 'hidden' });

  const paragraph = page.locator('.nb-prose p').first();
  await paragraph.click({ button: 'right', position: { x: 20, y: 12 } });
  const menu = page.locator('.nb-ctx-menu');
  await menu.waitFor({ state: 'visible' });
  const copyLinkCount = await menu.getByText('Copy link', { exact: true }).count();
  const removedLineActions =
    await menu.getByText('Insert line above', { exact: true }).count() === 0 &&
    await menu.getByText('Insert line below', { exact: true }).count() === 0;
  const duplicateHiddenByDefault = await menu.getByText('Duplicate', { exact: true }).count() === 0;
  await menu.getByText('Turn into', { exact: true }).hover();
  const submenu = page.locator('.nb-ctx-sub-wrap');
  await submenu.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/menu-scrollbar.png`, animations: 'disabled' });
  const scrollbar = await submenu.evaluate((host) => {
    const port = host.querySelector('.nb-ctx-sub');
    const track = host.querySelector('.nb-app-scrollbar');
    return {
      nativeWidth: port instanceof HTMLElement
        ? getComputedStyle(port, '::-webkit-scrollbar').width
        : null,
      drawnTrack: track instanceof HTMLElement,
      drawnTrackVisible: track instanceof HTMLElement && !track.hidden,
    };
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('alcove:open-settings')));
  await settings.waitFor({ state: 'visible' });
  await settings.locator('.nbs-find-input').fill('context menu');
  await settings.getByRole('switch', { name: 'show Effects' }).click();
  await settings.getByRole('switch', { name: 'show Copy as script' }).click();
  await settings.getByRole('switch', { name: 'show Duplicate' }).click();
  await settings.getByRole('switch', { name: 'compact context menu' }).click();
  await settings.getByRole('switch', { name: 'context menu icons' }).click();
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await settings.waitFor({ state: 'hidden' });
  await paragraph.click({ button: 'right', position: { x: 20, y: 12 } });
  await menu.waitFor({ state: 'visible' });
  const customized = {
    effectsHidden: await menu.getByText('Effects', { exact: true }).count() === 0,
    scriptHidden: await menu.getByText('Copy block as script', { exact: true }).count() === 0,
    compact: await page.locator('.nb-ctx-portal.is-compact').count() === 1,
    iconless: await page.locator('.nb-ctx-portal.is-iconless').count() === 1,
    duplicateEnabled: await menu.getByText('Duplicate', { exact: true }).count() === 1,
  };
  await page.screenshot({ path: `${out}/menu-customized.png`, animations: 'disabled' });

  const report = {
    settingChoices,
    copyLinkAbsent: copyLinkCount === 0,
    removedLineActions,
    duplicateHiddenByDefault,
    scrollbar,
    customized,
    errors,
  };
  console.log(JSON.stringify(report, null, 2));
  if (
    settingChoices < 15 || copyLinkCount !== 0 || !removedLineActions ||
    !duplicateHiddenByDefault || !scrollbar.drawnTrack ||
    Object.values(customized).some((value) => value !== true) || errors.length > 0
  ) process.exitCode = 1;
} finally {
  await browser.close();
}
