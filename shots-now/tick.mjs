/**
 * shots-now/tick.mjs — is the app settling, or spinning?
 *
 * Screenshots started timing out after the flat swap while the page itself
 * loads fine and throws nothing. That pattern points at a render loop that
 * never goes idle: the compositor can never hand back a stable frame. This
 * counts animation frames over two windows a second apart — a settled app
 * ticks a handful of times and stops, a spinning one keeps pace with vsync.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'networkidle' });
await new Promise((r) => setTimeout(r, 8000));

const sample = async (label) => {
  const n = await p.evaluate(
    () =>
      new Promise((res) => {
        let frames = 0;
        const t0 = performance.now();
        const step = () => {
          frames++;
          if (performance.now() - t0 < 1000) requestAnimationFrame(step);
          else res(frames);
        };
        requestAnimationFrame(step);
      }),
  );
  console.log(`${label}: ${n} frames/s`);
  return n;
};

await sample('at rest (8s in)');
await new Promise((r) => setTimeout(r, 4000));
await sample('at rest (12s in)');

// What is still asking for frames?
const info = await p.evaluate(() => ({
  canvases: [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`),
  tickers: typeof window.__PIXI_APP__ !== 'undefined' ? 'pixi exposed' : 'n/a',
}));
console.log('canvases:', info.canvases.join(', '));
await b.close();
