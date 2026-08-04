/** Diagnostic scaffold — replaced by the real probe below once the face lands. */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 500 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 500 });

const nav = await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 999);
  const first = list[0];
  if (!first) return { nav: false };
  app.appState.openBook(first.id);
  return { nav: true, id: first.id, title: first.title };
});
console.log('[nav]', JSON.stringify(nav));
await page.waitForSelector('.nb-prose', { timeout: 60000 });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const seen = new Map();
  for (const prose of document.querySelectorAll('.nb-prose')) {
    for (const el of prose.querySelectorAll('*')) {
      if (el.textContent.trim() === '') continue;
      const s = getComputedStyle(el);
      const key = `${s.fontFamily.split(',')[0]} @ ${s.fontSize}`;
      if (!seen.has(key)) {
        seen.set(key, {
          tag: el.tagName.toLowerCase(),
          cls: el.className.toString().slice(0, 60),
          text: el.textContent.trim().slice(0, 40),
        });
      }
    }
  }
  return {
    fontsLoaded: {
      patrick: document.fonts.check('20px "Patrick Hand"'),
      caveat: document.fonts.check('20px "Caveat Variable"'),
      kalam: document.fonts.check('20px "Kalam"'),
      lora: document.fonts.check('20px "Lora"'),
    },
    families: [...seen.entries()].map(([k, v]) => ({ face: k, ...v })),
  };
});
console.log('[families]', JSON.stringify(info, null, 2));

await browser.close();
console.log('done');
