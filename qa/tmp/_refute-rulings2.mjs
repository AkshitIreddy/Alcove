/**
 * qa/tmp/_refute-rulings2.mjs — follow-up on the one FAIL from the first pass:
 * a page that reloaded read `data-style=blank`. Is that a page whose ruling
 * failed to travel, or simply the ruling that page is stored with? Opens a
 * FRESH profile (no writes from the earlier run) and lists every page.
 */
import { chromium } from 'playwright';

const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(
  ([storageKey, tutorialKey]) => {
    try {
      const blob = { settings: [{ key: tutorialKey, value: '1' }] };
      window.localStorage.setItem(storageKey, JSON.stringify(blob));
    } catch {
      /* backstop below */
    }
  },
  ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
);

await page.goto(`${URL_BASE}/?fx=force&dev=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => window.__nbTutorial?.stop?.());
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 180000 });
await page.waitForTimeout(3000);

const pages = await page.$$eval('.nb-page[data-style]', (els) =>
  els.map((el) => {
    const prose = el.querySelector('.nb-page-editor .ProseMirror');
    return {
      style: el.getAttribute('data-style'),
      pitch: getComputedStyle(el).getPropertyValue('--page-line-height').trim(),
      bg: prose ? getComputedStyle(prose).backgroundImage.slice(0, 90) : 'NO PROSE',
    };
  }),
);
console.log('untouched pages on a fresh profile:');
for (const p of pages) console.log(`  data-style=${p.style} pitch=${p.pitch}\n    ${p.bg}`);
await page.screenshot({ path: 'qa/tmp/refute-rulings/fresh-untouched.png' });
await browser.close();
