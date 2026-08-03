/** Photograph the middle of a page turn and look for a shadow band on the ruled half. */
import { chromium } from 'playwright';

const OUT = 'qa/verify';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);
for (let i = 0; i < 4; i++) {
  const s = p.locator('text=skip the tour').first();
  if ((await s.count()) === 0) break;
  await s.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
await p.waitForTimeout(3000);

// Drag the outer edge of the right page leftwards, pausing mid-way.
const box = await p.locator('.nb-book-view').boundingBox();
const y = box.y + box.height * 0.55;
const x0 = box.x + box.width * 0.94;
await p.mouse.move(x0, y);
await p.mouse.down();
const stops = [0.80, 0.66, 0.52, 0.40];
for (let i = 0; i < stops.length; i++) {
  const x = box.x + box.width * stops[i];
  for (let s = 0; s < 6; s++) { await p.mouse.move(x + (x0 - x) * (1 - (s + 1) / 6), y - s * 2); await p.waitForTimeout(45); }
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/70-flip-${i}-${Math.round(stops[i] * 100)}.png`, timeout: 60000 });
  const info = await p.evaluate(() => {
    const c = document.querySelector('canvas.nb-flip-gl, .nb-flip canvas, canvas[data-flip]');
    const all = [...document.querySelectorAll('canvas')].map((k) => ({ cls: k.className, w: k.width, h: k.height, box: Math.round(k.getBoundingClientRect().width) }));
    return { flipCanvas: !!c, canvases: all, flipping: document.body.className, surf: !!document.querySelector('.nb-flip-surface') };
  });
  console.log('stop', stops[i], JSON.stringify(info).slice(0, 240));
}
await p.mouse.up();
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/70-flip-done.png`, timeout: 60000 });
console.log('done');
await b.close();
