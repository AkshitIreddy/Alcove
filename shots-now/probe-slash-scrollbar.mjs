/**
 * Silent localhost QA for the full slash catalogue's drawn AppScrollbar.
 * Uses a fresh browser database and never opens the installed/native app.
 *
 * Usage: node shots-now/probe-slash-scrollbar.mjs [--url=http://127.0.0.1:1420]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const base = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const out = 'shots-now/out/slash-scrollbar';
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
const context = await browser.newContext({
  viewport: { width: 1500, height: 980 },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

function check(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    location.reload();
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 300 });
  const tour = page.getByText('skip the tour');
  if (await tour.count()) await tour.first().click().catch(() => {});
  await page.waitForFunction(() => globalThis.__shelfVisibleBooks?.().length > 0, null, { polling: 300 });

  const book = await page.evaluate(() => globalThis.__shelfVisibleBooks()[0]);
  const cover = page.getByRole('button', { name: `Open ${book.title}`, exact: true });
  for (let attempt = 0; attempt < 30 && !(await cover.isVisible().catch(() => false)); attempt += 1) {
    await page.evaluate((id) => globalThis.__shelfPullOut(id), book.id);
    await page.waitForTimeout(500);
  }
  await cover.waitFor({ state: 'visible' });
  await cover.click();
  await page.locator('.nb-book-view').waitFor({ state: 'visible' });

  const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
  check(leaf !== null, 'right leaf was not available for slash-menu input');
  await page.mouse.click(leaf.x + leaf.width * 0.45, leaf.y + leaf.height * 0.86);
  await page.keyboard.type('/');

  const menu = page.getByRole('listbox', { name: 'Insert block', exact: true });
  await menu.waitFor({ state: 'visible' });
  const list = menu.locator('.nb-slash-list');
  const scrollbar = page.getByRole('scrollbar', { name: 'Slash menu position', exact: true });
  await scrollbar.waitFor({ state: 'visible' });

  const opening = await list.evaluate((element) => {
    const nativePseudo = getComputedStyle(element, '::-webkit-scrollbar');
    const track = document.querySelector('.nb-slash-scrollbar');
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      scrollbarWidth: getComputedStyle(element).scrollbarWidth,
      nativeWebkitWidth: nativePseudo.width,
      appScrollport: element.classList.contains('nb-app-scrollport'),
      drawnHidden: track instanceof HTMLElement ? track.hidden : null,
      drawnHeight: track instanceof HTMLElement ? track.getBoundingClientRect().height : 0,
      selectedIndex: Number(
        element.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('data-index') ?? -1,
      ),
    };
  });
  check(opening.scrollHeight > opening.clientHeight + 1,
    'full slash catalogue did not overflow, so the scrollbar check would be vacuous');
  check(opening.appScrollport, 'slash list was not wired to AppScrollbar');
  check(opening.scrollbarWidth === 'none',
    `native Firefox-style scrollbar was not suppressed (${opening.scrollbarWidth})`);
  check(opening.nativeWebkitWidth === '0px',
    `native WebKit scrollbar width was ${opening.nativeWebkitWidth}, expected 0px`);
  check(opening.drawnHidden === false && opening.drawnHeight > 20,
    'drawn slash scrollbar is missing or hidden despite overflowing content');
  // Negative control: remove only AppScrollbar's native-gutter suppression
  // and prove the same computed-width assertion turns red on this browser.
  const negativeControlWebkitWidth = await list.evaluate((element) => {
    element.classList.remove('nb-app-scrollport');
    const width = getComputedStyle(element, '::-webkit-scrollbar').width;
    element.classList.add('nb-app-scrollport');
    return width;
  });
  check(negativeControlWebkitWidth !== '0px',
    'native-scrollbar negative control was inert; width gate cannot be trusted');
  await page.screenshot({ path: `${out}/01-full-catalogue-top.png`, caret: 'hide' });

  for (let index = 0; index < 24; index += 1) await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => {
    const list = document.querySelector('.nb-slash-list');
    const selected = list?.querySelector('[role="option"][aria-selected="true"]');
    return (list?.scrollTop ?? 0) > 0 && Number(selected?.getAttribute('data-index') ?? -1) >= 20;
  });
  const afterKeys = await list.evaluate((element) => ({
    scrollTop: element.scrollTop,
    selectedIndex: Number(
      element.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('data-index') ?? -1,
    ),
    ariaNow: Number(document.querySelector('.nb-slash-scrollbar')?.getAttribute('aria-valuenow') ?? -1),
  }));
  check(afterKeys.scrollTop > opening.scrollTop,
    'keyboard selection advanced but did not scroll the slash catalogue');
  check(afterKeys.selectedIndex === 24,
    `keyboard selection landed on ${afterKeys.selectedIndex}, expected 24`);
  check(afterKeys.ariaNow > 0,
    'drawn scrollbar did not publish its keyboard-driven scroll position');
  await page.screenshot({ path: `${out}/02-keyboard-scrolled.png`, caret: 'hide' });

  const report = {
    ok: true,
    book: book.title,
    opening,
    negativeControlWebkitWidth,
    afterKeys,
    screenshots: [
      `${out}/01-full-catalogue-top.png`,
      `${out}/02-keyboard-scrolled.png`,
    ],
    pageErrors,
  };
  writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
}
