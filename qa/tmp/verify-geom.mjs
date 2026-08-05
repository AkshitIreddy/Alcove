/** Measure the real spread's cover/plate box, to compare with the fallback's. */
import { chromium } from 'playwright';
const URL_BASE = 'http://localhost:1420';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
const poll = async (fn, label) => {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() - t0 > 120000) throw new Error(`timeout ${label}`);
    await page.waitForTimeout(150);
  }
};
await poll(() => globalThis.__shelfWorld !== undefined, 'world');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 'a11y');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(2500);
const row = page.locator('.shelf-a11y button', { hasText: 'Welcome to Alcove' });
await row.first().dispatchEvent('click');
await poll(
  () => document.querySelector('.nb-book-view') !== null || document.querySelector('.pulled-book') !== null,
  'leaves shelf',
);
if ((await page.locator('.nb-book-view').count()) === 0) {
  await page.waitForTimeout(1400);
  await page.locator('.pulled-book').first().click();
}
await page.waitForSelector('.nb-prose', { timeout: 60000 });
await page.waitForTimeout(2500);
const m = await page.evaluate(() => {
  const r = (s) => {
    const n = document.querySelector(s);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
  };
  return {
    cover: r('.nb-book-cover'),
    plate: r('.nb-book-title-plate'),
    view: r('.nb-book-view'),
    stage: r('.nb-spread-stage'),
    rail: r('.nb-rail'),
  };
});
console.log(JSON.stringify(m, null, 1));
await browser.close();
