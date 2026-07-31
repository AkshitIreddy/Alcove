/**
 * Flip trace probe — intercepts the Vite module fetches for the flip engine
 * and appends instrumentation to the REAL module instances the app uses
 * (robust against ?t= HMR query strings), then drives a slow drag and dumps
 * the controller trace + raw pointer event stream.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const CONTROLLER_SNIPPET = `
;(function () {
  const P = PageFlipController.prototype;
  globalThis.__flipTrace = [];
  const T = (n, d) => { globalThis.__flipTrace.push(Math.round(performance.now()) + ' ' + n + ' ' + d); };
  for (const n of ['beginFlip', 'settle', 'land', 'crossfadeNavigate', 'programmaticFlip']) {
    const o = P[n];
    P[n] = function (...a) {
      T(n, JSON.stringify({ a: a.slice(0, 2), p: this.flip?.p, ph: this.phase, gl: this.usesWebGL }));
      return o.apply(this, a);
    };
  }
})();
`;
const CURL_SNIPPET = `
;(function () {
  const P = CurlRenderer.prototype;
  const o = P.setPageTextures;
  P.setPageTextures = function (f, b, r) {
    (globalThis.__texLog ??= []).push({ front: f ? f.width : 0, back: b ? b.width : 0, revealed: r ? r.width : 0 });
    return o.call(this, f, b, r);
  };
})();
`;

await page.route('**/src/flip/PageFlipController.ts*', async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  await route.fulfill({ response: res, body: body + CONTROLLER_SNIPPET });
});
await page.route('**/src/flip/curl.ts*', async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  await route.fulfill({ response: res, body: body + CURL_SNIPPET });
});

const t0 = Date.now();
await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 500 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 500 });
console.log(`[boot] ready ${Date.now() - t0}ms`);

await page.waitForSelector('.shelf-a11y button', { state: 'attached', timeout: 30000 });
await page.locator('.shelf-a11y button').first().dispatchEvent('click');
await page.waitForSelector('.nb-flip-surface', { timeout: 45000 });
await page.waitForSelector('.nb-prose', { timeout: 45000 });
console.log(`[book] open ${Date.now() - t0}ms`);
await page.waitForTimeout(4000);

// Raw pointer event stream on the flip root.
await page.evaluate(() => {
  globalThis.__ptrLog = [];
  const root = document.querySelector('.nb-flip-surface');
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
    root.addEventListener(type, (e) => {
      if (type === 'pointermove' && globalThis.__ptrLog.length > 60) return;
      globalThis.__ptrLog.push(`${Math.round(performance.now())} ${type} x=${Math.round(e.clientX)} y=${Math.round(e.clientY)} id=${e.pointerId} buttons=${e.buttons}`);
    }, { capture: true });
  }
});

const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
const midY = leaf.y + leaf.height * 0.55;
const startX = leaf.x + leaf.width - 12;
console.log('[drag] leaf', JSON.stringify(leaf), 'start', Math.round(startX), Math.round(midY));
await page.mouse.move(startX, midY);
await page.mouse.down();
for (const p of [0.3, 0.55, 0.8, 0.97]) {
  const x = leaf.x + leaf.width * (1 - 2 * p);
  await page.mouse.move(x, midY, { steps: 6 });
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => ({
    flipping: document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping'),
    editors: document.querySelectorAll('.nb-prose').length,
    rightHidden: document.querySelector('.nb-flip-leaf-right')?.style.visibility,
  }));
  console.log(`[drag] held p=${p}:`, JSON.stringify(state));
  await page.screenshot({ path: `qa/ui/trace-p${Math.round(p * 100)}.png`, timeout: 60000 });
}
await page.mouse.up();
await page.waitForTimeout(2500);

const trace = await page.evaluate(() => globalThis.__flipTrace ?? []);
const ptr = await page.evaluate(() => globalThis.__ptrLog ?? []);
const tex = await page.evaluate(() => globalThis.__texLog ?? []);
console.log('[trace]'); for (const l of trace) console.log('  ', l);
console.log('[ptr]'); for (const l of ptr.slice(0, 40)) console.log('  ', l);
console.log('[tex]', JSON.stringify(tex));
const after = await page.evaluate(() => ({
  editors: document.querySelectorAll('.nb-prose').length,
  flipping: document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping'),
  tab: [...document.querySelectorAll('.nb-book-tab, [class*=tab]')].map((t) => t.textContent?.trim()).slice(0, 6),
}));
console.log('[after]', JSON.stringify(after));
await page.screenshot({ path: 'qa/ui/trace-final.png', timeout: 60000 });
await browser.close();
console.log('done');
