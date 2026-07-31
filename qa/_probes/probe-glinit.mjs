/**
 * probe-glinit.mjs — attribute the one remaining startup stall.
 *
 * The lag sampler sees a ~2-3.5s hitch around t≈1s that the longtask observer
 * does NOT report, which means it is not JavaScript. This instruments the
 * WebGL entry points that block the renderer synchronously (context creation,
 * shader compile/link, texture upload, readback) and reports how much time
 * each accounted for in the first N seconds.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1441';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript(() => {
  window.__gl = {};
  window.__t0 = performance.now();
  const note = (name, ms, at) => {
    const e = (window.__gl[name] ??= { n: 0, ms: 0, worst: 0, worstAt: 0 });
    e.n++;
    e.ms += ms;
    if (ms > e.worst) {
      e.worst = ms;
      e.worstAt = at;
    }
  };
  const wrap = (obj, name, label) => {
    const orig = obj?.[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (...args) {
      const t = performance.now();
      const r = orig.apply(this, args);
      note(label, performance.now() - t, Math.round(t - window.__t0));
      return r;
    };
  };
  wrap(HTMLCanvasElement.prototype, 'getContext', 'canvas.getContext');
  if (typeof OffscreenCanvas !== 'undefined') wrap(OffscreenCanvas.prototype, 'getContext', 'offscreen.getContext');
  for (const proto of [globalThis.WebGL2RenderingContext?.prototype, globalThis.WebGLRenderingContext?.prototype]) {
    if (!proto) continue;
    for (const m of [
      'compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter',
      'texImage2D', 'texSubImage2D', 'drawElements', 'drawArrays', 'readPixels',
      'finish', 'flush', 'useProgram', 'bufferData',
    ]) wrap(proto, m, `gl.${m}`);
  }
  wrap(globalThis, 'createImageBitmap', 'createImageBitmap');
});

await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForTimeout(12000);

const gl = await page.evaluate(() => window.__gl);
await browser.close();

const rows = Object.entries(gl).sort((a, b) => b[1].ms - a[1].ms);
console.log('WebGL / canvas blocking in the first 12s:');
for (const [name, e] of rows) {
  if (e.ms < 5) continue;
  console.log(
    `  ${e.ms.toFixed(0).padStart(7)}ms total  n=${String(e.n).padStart(6)}  ` +
      `worst ${e.worst.toFixed(0)}ms @${e.worstAt}ms  ${name}`,
  );
}
