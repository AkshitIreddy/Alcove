/** probe-worker.mjs — is the art worker actually alive? */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.split('=')[1] ?? 'http://localhost:1445';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 300)));
page.on('worker', (w) => console.log('[worker created]', w.url()));
await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForTimeout(20000);
console.log('workers:', page.workers().map((w) => w.url()));
const probe = await page.evaluate(async () => {
  const mod = await import('/src/features/bookshelf/artOffload.ts');
  const o = mod.artOffload();
  return { available: o.available, size: o.size, stats: o.stats() };
});
console.log('offload:', probe);
await browser.close();
