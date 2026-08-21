/**
 * Cold-turn readiness regression: idle warming is deliberately held back so
 * the first pointer turn must pass through PageFlipController's preparation
 * barrier. Runs headlessly against localhost and uses only browser stub data.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'shots-now/out/cold-flip-readiness';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--mute-audio',
  ],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(120_000);
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.log(`[browser:${message.type()}]`, message.text().slice(0, 500));
  }
});
await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('nb-tutorial-done', '1');
  // Keep ordinary idle warming cold. Direct ensure() from pointerdown remains
  // live, which isolates the start-order behavior this probe is for.
  window.requestIdleCallback = () => 7;
  window.cancelIdleCallback = () => {};
});
await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof globalThis.__shelfVisibleBooks === 'function' && globalThis.__shelfWorld !== undefined,
  null,
  { polling: 250 },
);
const bookId = await page.evaluate(() => globalThis.__shelfVisibleBooks?.()[0]?.id ?? null);
if (bookId === null) throw new Error('Welcome book unavailable');
await page.evaluate(async (id) => {
  const app = await import('/src/state/app.ts');
  app.appState.openBook(id);
}, bookId);
await page.waitForSelector('.nb-flip-surface .ProseMirror');
for (let attempt = 0; attempt < 3; attempt += 1) {
  const skip = page.getByText('skip the tour', { exact: true }).first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true }).catch(() => {});
  await page.waitForTimeout(100);
}
await page.waitForFunction(() => globalThis.__flipCache?.facesFor?.('next') !== null);

await page.evaluate(() => {
  const root = document.querySelector('.nb-flip-surface');
  const stage = document.querySelector('.nb-spread-stage');
  globalThis.__coldFlipTrace = [];
  const sample = (label) => {
    globalThis.__coldFlipTrace.push({
      label,
      time: performance.now(),
      preparing: root?.classList.contains('is-flip-preparing') ?? false,
      flipping: document.querySelector('.nb-flip-canvas.is-flipping') !== null,
      spread: stage?.getAttribute('data-spread-index') ?? null,
    });
  };
  sample('before');
  const observer = new MutationObserver(() => sample('mutation'));
  if (root) observer.observe(root, { attributes: true, subtree: true, attributeFilter: ['class'] });
  if (stage) observer.observe(stage, { attributes: true, attributeFilter: ['data-spread-index'] });
  globalThis.__coldFlipObserver = observer;
});

const before = await page.locator('.nb-spread-stage').getAttribute('data-spread-index');
await page.locator('.nb-flip-hotspot-next').click({ force: true });
await page.waitForFunction(
  (start) =>
    document.querySelector('.nb-flip-canvas.is-flipping') !== null ||
    document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') !== start,
  before,
  { polling: 10 },
);
const during = await page.locator('.nb-spread-stage').getAttribute('data-spread-index');
const curled = await page.locator('.nb-flip-canvas.is-flipping').count() > 0;
if (curled) {
  await page.waitForTimeout(280);
  await page.locator('.nb-flip-surface').screenshot({ path: `${OUT}/curl.png` });
}
await page.waitForFunction(
  (start) =>
    document.querySelector('.nb-flip-canvas.is-flipping') === null &&
    document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') !== start,
  before,
  { polling: 20 },
);
const after = await page.locator('.nb-spread-stage').getAttribute('data-spread-index');
const trace = await page.evaluate(() => {
  globalThis.__coldFlipObserver?.disconnect();
  return globalThis.__coldFlipTrace ?? [];
});
const sawPreparing = trace.some((entry) => entry.preparing && entry.spread === before);
const sawCurlBeforeNavigation = trace.some((entry) => entry.flipping && entry.spread === before);
const report = { before, during, after, sawPreparing, sawCurlBeforeNavigation, trace };
writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!sawPreparing || !sawCurlBeforeNavigation || during !== before || after === before) {
  throw new Error('cold turn did not prepare, curl, and then navigate in order');
}
await browser.close();
