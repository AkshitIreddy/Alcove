/**
 * Audit the reader-facing spine silhouettes at actual shelf width and detail scale.
 * Uses the exact active shape/material renderer through the existing Vite server.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 770 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:1420/?fx=force', {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});

await page.evaluate(async () => {
  const [{ resolveBookStyle }, { renderSpine }, bookDesign] = await Promise.all([
    import('/src/art/bookStyle.ts'),
    import('/src/art/spines.ts'),
    import('/src/art/bookDesign.ts'),
  ]);
  const variants = bookDesign.ROLLABLE_SHAPES.map((shape) => [
    bookDesign.SHAPE_LABELS[shape],
    shape,
  ]);
  const overrides = {
    pigment: 20,
    hueJitter: 0,
    raisedBands: 0,
    bandGilt: false,
    gilt: false,
    headTail: false,
    ornament: -1,
    wear: 0,
    thickness: 44,
    charm: 'none',
  };

  document.head.innerHTML = '<style>body{margin:0;background:#e8dcc5;color:#2f271f;font:600 16px system-ui;padding:28px}h1{margin:0 0 20px;font:700 26px Georgia}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{background:#f7efdd;border:2px solid #44382e;border-radius:15px;padding:16px;box-shadow:0 6px 0 #bca889}.card h2{height:32px;margin:0 0 12px;text-align:center;font:700 18px Georgia}.pair{height:520px;display:flex;align-items:flex-end;justify-content:center;gap:18px}.shelf{width:64px;height:410px}.detail{width:142px;height:530px}.note{text-align:center;margin:12px 0 0;color:#675748;font:600 13px system-ui}</style>';
  document.body.innerHTML = '<h1>Active book silhouettes — same cloth, no decoration</h1><div class="grid"></div>';
  const grid = document.querySelector('.grid');
  for (const [label, shape] of variants) {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<h2>${label}</h2><div class="pair"><canvas class="shelf" width="64" height="410"></canvas><canvas class="detail" width="142" height="530"></canvas></div><p class="note">44 px shelf · 3× detail</p>`;
    grid.append(card);
    const binding = `own:${shape}/smooth-cloth/plain/0`;
    const resolved = resolveBookStyle(0x41c0, undefined, overrides, { binding });
    const spine = { ...resolved.spine, binding };
    renderSpine(card.querySelector('.shelf').getContext('2d'), spine, 10, 12, 372, 1);
    renderSpine(card.querySelector('.detail').getContext('2d'), spine, 4, 10, 500, 3);
  }
});

await page.screenshot({ path: 'shots-now/out/active-spine-shapes.png', fullPage: true });
await browser.close();
console.log('shots-now/out/active-spine-shapes.png');
