/** Focused flip-path diagnostic: which code path does a drag take, and why? */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const t0 = Date.now();
await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 500 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 500 });
console.log(`[boot] ready ${Date.now() - t0}ms`);

const env = await page.evaluate(() => ({
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  webgl2: document.createElement('canvas').getContext('webgl2') !== null,
  ua: navigator.userAgent.slice(0, 80),
}));
console.log('[env]', JSON.stringify(env));

// Open the book.
await page.waitForSelector('.shelf-a11y button', { state: 'attached', timeout: 30000 });
await page.locator('.shelf-a11y button').first().dispatchEvent('click');
await page.waitForSelector('.nb-flip-surface', { timeout: 45000 });
await page.waitForSelector('.nb-prose', { timeout: 45000 });
console.log(`[book] open ${Date.now() - t0}ms`);
await page.waitForTimeout(4000);

// Instrument the controller prototype: which paths run, with what p values.
await page.evaluate(async () => {
  const m = await import('/src/flip/PageFlipController.ts');
  if (globalThis.__patched) return;
  globalThis.__patched = true;
  globalThis.__flipLog = [];
  const log = (name, detail) => {
    globalThis.__flipLog.push(`${Math.round(performance.now())} ${name} ${detail}`);
  };
  const P = m.PageFlipController.prototype;
  for (const name of ['beginFlip', 'settle', 'land', 'crossfadeNavigate']) {
    const orig = P[name];
    P[name] = function (...args) {
      log(name, JSON.stringify({ args: args.slice(0, 2), p: this.flip?.p, phase: this.phase, webgl: this.usesWebGL }));
      return orig.apply(this, args);
    };
  }
});

// Also check the canvas context + reduced-motion inside the book view.
const env2 = await page.evaluate(() => {
  const c = document.querySelector('.nb-flip-canvas');
  return {
    canvasPresent: c !== null,
    canvasCtx: c ? c.getContext('webgl2') !== null : null,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
});
console.log('[env2]', JSON.stringify(env2));

const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
console.log('[drag] leaf', JSON.stringify(leaf));
const midY = leaf.y + leaf.height * 0.55;
const startX = leaf.x + leaf.width - 12;
await page.mouse.move(startX, midY);
await page.mouse.down();
console.log('[drag] down');
for (const p of [0.3, 0.6, 0.9]) {
  const x = leaf.x + leaf.width * (1 - 2 * p);
  await page.mouse.move(x, midY, { steps: 8 });
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({
    flipping: document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping'),
    editors: document.querySelectorAll('.nb-prose').length,
  }));
  console.log(`[drag] at p=${p}:`, JSON.stringify(state));
}
await page.mouse.up();
console.log('[drag] up');
await page.waitForTimeout(3000);

const flipLog = await page.evaluate(() => globalThis.__flipLog ?? []);
console.log('[flipLog]');
for (const line of flipLog) console.log('  ', line);
const after = await page.evaluate(() => ({
  editors: document.querySelectorAll('.nb-prose').length,
  flipping: document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping'),
}));
console.log('[after]', JSON.stringify(after));
await browser.close();
console.log('done');
