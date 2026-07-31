/** shots-now/buttons.mjs — what is actually clickable on the shelf? */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'networkidle' });
await p.evaluate(() => { try { localStorage.setItem('nb-tutorial-done', '1'); } catch {} });
await p.reload({ waitUntil: 'networkidle' });
await new Promise((r) => setTimeout(r, 8000));

const info = await p.evaluate(() =>
  [...document.querySelectorAll('button')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? '',
      box: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      visible: r.width > 0 && r.height > 0,
    };
  }),
);
for (const i of info) console.log(`${i.visible ? 'Y' : 'n'} [${i.box}] ${i.label}`);
console.log('overlays:', await p.evaluate(() => document.querySelectorAll('[role="dialog"], .nb-modal').length));
await b.close();
