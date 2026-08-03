/** dpr2 spine sharpness, studio colour row, panel-open perf, all-controls census. */
import { chromium } from 'playwright';

const OUT = 'qa/verify';
const dpr = Number(process.argv[2] ?? 2);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: dpr });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
for (let i = 0; i < 4; i++) {
  const s = p.locator('text=skip the tour').first();
  if ((await s.count()) === 0) break;
  await s.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}
console.log('dpr:', await p.evaluate(() => devicePixelRatio), 'degraded:', await p.evaluate(() => globalThis.__shelfWorld?.degraded ?? '?'));
// seed a shelf full of books so we judge many spines
await p.evaluate(async () => {
  const names = ['Marginalia', 'The Long Field', 'Cold Comfort', 'Hedge Almanac', 'Fen Notes', 'Quarto', 'Salt & Ash', 'Winter Log', 'The Clockmaker', 'Ledger', 'Nightjar', 'Pilgrim', 'Harbour Book', 'Copperplate', 'Wren', 'Blue Hour', 'Foxglove', 'Kestrel', 'Mudlark', 'Tallow'];
  await globalThis.__shelfSeedBooks?.(names, 0);
  await globalThis.__shelfSeedBooks?.(names.map((n) => n + ' II'), 1);
});
await p.waitForTimeout(6000);
await p.screenshot({ path: `${OUT}/80-shelf-dpr${dpr}.png`, timeout: 90000 });
console.log('  shot 80-shelf-dpr' + dpr);

// sampling report from the module
console.log('sampling:', JSON.stringify(await p.evaluate(async () => {
  const m = await import('/src/features/bookshelf/spineScale.ts');
  const zoom = globalThis.__shelfWorld?.camera?.zoom ?? 1;
  const d = m.bakeDpr(false);
  return { zoom, bakeDpr: d, loScale: m.spineBakeScale('lo', d), hiScale: m.spineBakeScale('hi', d), samplingHiAtZoom: m.spineSampling('hi', zoom, d), samplingHiAt2_5: m.spineSampling('hi', 2.5, d) };
})));

// ---- perf: panel-open cost, measured
const perf = await p.evaluate(async () => {
  const btn = [...document.querySelectorAll('button')].find((x) => /studio/i.test(x.textContent));
  const out = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    btn.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t1 = performance.now();
    // let it settle, count canvases drawn
    await new Promise((r) => setTimeout(r, 1400));
    const canv = document.querySelectorAll('.nb-rail-panel canvas, .nb-library-studio canvas').length;
    const t2 = performance.now();
    out.push({ toFirstPaintMs: +(t1 - t0).toFixed(1), settleMs: +(t2 - t0).toFixed(1), canvases: canv });
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
  }
  return out;
});
console.log('PANEL OPEN COST:', JSON.stringify(perf));

// open studio, scroll to the colour row, shoot it
await p.locator('button:has-text("studio")').first().click({ force: true });
await p.waitForTimeout(2500);
await p.evaluate(() => {
  const lbl = [...document.querySelectorAll('.nb-rail-panel-body *')].find((e) => /^colour\b/i.test(e.textContent.trim()) && e.children.length === 0);
  lbl?.scrollIntoView({ block: 'start' });
});
await p.waitForTimeout(2200);
await p.screenshot({ path: `${OUT}/81-studio-colour-row.png`, timeout: 90000 });
console.log('  shot 81-studio-colour-row');
console.log('COLOUR ROW:', JSON.stringify(await p.evaluate(() => {
  const grids = [...document.querySelectorAll('.nb-rail-panel-body .nb-swatch-grid')];
  return grids.map((g) => ({ label: g.previousElementSibling?.textContent?.trim().slice(0, 40), n: g.querySelectorAll('button').length, more: [...g.querySelectorAll('.nb-more')].map((m) => m.textContent.trim()) }));
})));
await b.close();
