/** Quick diagnostic: can we open the seeded book from the a11y mirror? */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console-err]', m.text().slice(0, 160));
});

const t0 = Date.now();
await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 500 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 500 });
console.log(`[boot] ready after ${Date.now() - t0}ms`);
await page.waitForTimeout(3000);

const dom = await page.evaluate(() => ({
  dock: document.querySelector('.shelf-dock') !== null,
  zoomPill: document.querySelector('.shelf-zoom-pill') !== null,
  a11yButtons: document.querySelectorAll('.shelf-a11y button').length,
  a11yTexts: [...document.querySelectorAll('.shelf-a11y button')].map((b) => b.textContent),
  shelfRoot: document.querySelector('.shelf-root') !== null,
  bodyClasses: document.body.className,
  url: location.href,
}));
console.log('[dom]', JSON.stringify(dom));

// Try dispatchEvent click (no actionability requirements).
const clicked = await page.evaluate(() => {
  const btn = document.querySelector('.shelf-a11y button');
  if (!btn) return false;
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
});
console.log('[click] dispatched:', clicked);
await page.waitForTimeout(2500);

const after = await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  return {
    openBookId: app.appState.openBookId(),
    flipSurface: document.querySelector('.nb-flip-surface') !== null,
    bookView: document.querySelector('.nb-book-view') !== null,
    bodyHasBook: document.body.innerHTML.includes('nb-flip'),
  };
});
console.log('[after]', JSON.stringify(after));

if (after.flipSurface) {
  await page.waitForSelector('.nb-prose', { timeout: 60000 });
  console.log(`[ok] book open + prose mounted after ${Date.now() - t0}ms`);
  await page.screenshot({ path: 'qa/ui/diag-bookopen.png', timeout: 60000 });
  console.log('[shot] diag-bookopen.png');
} else {
  // Second attempt via direct appState navigation to isolate click vs router.
  const nav = await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooks();
    const first = list[0];
    if (!first) return { nav: false, reason: 'no books', count: list.length };
    app.appState.openBook(first.id);
    return { nav: true, id: first.id, title: first.title, count: list.length };
  });
  console.log('[nav]', JSON.stringify(nav));
  await page.waitForTimeout(2500);
  const after2 = await page.evaluate(() => ({
    flipSurface: document.querySelector('.nb-flip-surface') !== null,
    prose: document.querySelectorAll('.nb-prose').length,
  }));
  console.log('[after2]', JSON.stringify(after2));
  if (after2.flipSurface) {
    await page.waitForSelector('.nb-prose', { timeout: 60000 });
    await page.screenshot({ path: 'qa/ui/diag-bookopen.png', timeout: 60000 });
    console.log('[shot] diag-bookopen.png (via appState)');
  }
}
await browser.close();
console.log('done');
