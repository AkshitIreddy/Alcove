/**
 * Compare restrained Welcome spine constructions at both shelf and detail scale.
 * Uses the real renderer through the already-running Vite server.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1460, height: 840 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:1420/?fx=force', {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});

await page.evaluate(async () => {
  const [{ resolveBookStyle }, { renderSpine }] = await Promise.all([
    import('/src/art/bookStyle.ts'),
    import('/src/art/spines.ts'),
  ]);

  const current = {
    material: 'leather',
    pigment: 20,
    hueJitter: 0,
    raisedBands: 4,
    bandGilt: true,
    gilt: true,
    headTail: false,
    ornament: 20,
    titlePlate: 'gilt-direct',
    titleFont: 0,
    wear: 0.08,
    edge: 'gilt',
    format: 'quarto',
    thickness: 44,
    charm: 'none',
    coverFrame: 26,
    coverMedallion: 20,
    cornerProtectors: false,
    insetPlate: false,
  };
  const smooth = { ...current };
  delete smooth.material;
  const variants = [
    ['Current / Morocco grain', 'plain-cloth', current],
    ['Final / square smooth cloth', 'plain-cloth', smooth],
    ['Plain polished calf', 'plain-calf', smooth],
    ['Panelled polished calf', 'panelled-calf', smooth],
    ['Calf + measured gilt bands', 'own:rounded/polished-calf/gilt-bands/1', smooth],
  ];

  document.head.innerHTML = '<style>body{margin:0;background:#e8dcc5;color:#2f271f;font:600 16px system-ui;padding:28px}h1{margin:0 0 22px;font:700 26px Georgia}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:18px}.card{background:#f7efdD;border:2px solid #44382e;border-radius:15px;padding:16px;box-shadow:0 6px 0 #bca889}.card h2{height:46px;margin:0 0 14px;text-align:center;font:700 17px Georgia}.pair{height:580px;display:flex;align-items:flex-end;justify-content:center;gap:16px}.shelf{width:64px;height:430px}.detail{width:142px;height:580px}</style>';
  document.body.innerHTML = '<h1>Welcome spine — clean construction comparison</h1><div class="grid"></div>';
  const grid = document.querySelector('.grid');
  for (const [label, binding, overrides] of variants) {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<h2>${label}</h2><div class="pair"><canvas class="shelf" width="64" height="430"></canvas><canvas class="detail" width="142" height="580"></canvas></div>`;
    grid.append(card);
    const resolved = resolveBookStyle(0x41c0, undefined, overrides, { binding });
    const shelf = card.querySelector('.shelf');
    const detail = card.querySelector('.detail');
    const spine = { ...resolved.spine, binding };
    renderSpine(shelf.getContext('2d'), spine, 10, 18, 390, 1);
    renderSpine(detail.getContext('2d'), spine, 4, 12, 548, 3);
  }
});

await page.screenshot({ path: 'shots-now/out/welcome-spine-variants.png', fullPage: true });
await browser.close();
console.log('shots-now/out/welcome-spine-variants.png');
