/**
 * shots-now/pan.mjs — reproduce the white corners reported while moving around.
 *
 * Drags the shelf hard in several directions and shoots after each, because
 * the report is specifically about motion: a still screenshot of the resting
 * shelf has never shown it. Also zooms out, since the corners are furthest
 * from the case there.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'networkidle' });
await p.reload({ waitUntil: 'networkidle' });
await new Promise((r) => setTimeout(r, 6000));
for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
}

const drags = [
  ['right', 1100, 500, 300, 500],
  ['down', 800, 250, 800, 850],
  ['diag', 1200, 800, 350, 200],
];

for (const [name, x0, y0, x1, y1] of drags) {
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  // Many small steps: a single jump can be swallowed as a click, and the
  // report is about the state *during* movement.
  for (let s = 1; s <= 18; s++) {
    await p.mouse.move(x0 + ((x1 - x0) * s) / 18, y0 + ((y1 - y0) * s) / 18);
    if (s === 12) await p.screenshot({ path: `shots-now/pan-${name}-mid.png` });
  }
  await p.mouse.up();
  await new Promise((r) => setTimeout(r, 600));
  await p.screenshot({ path: `shots-now/pan-${name}.png` });
}

// Zoomed out, where the corners are emptiest.
await p.mouse.move(800, 500);
for (let i = 0; i < 6; i++) {
  await p.mouse.wheel(0, 400);
  await new Promise((r) => setTimeout(r, 200));
}
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: 'shots-now/pan-zoomout.png' });
console.log('done -> shots-now/pan-*.png');
await b.close();
