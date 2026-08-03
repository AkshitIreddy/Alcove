/** Panel-open main-thread cost with the caps in place, plus slash/context-menu caps. */
import { chromium } from 'playwright';

const OUT = 'qa/verify';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
for (let i = 0; i < 4; i++) {
  const s = p.locator('text=skip the tour').first();
  if ((await s.count()) === 0) break;
  await s.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}

const measure = async (label, openSel, closeKey = 'Escape') => {
  const res = await p.evaluate(async ({ openSel }) => {
    const long = [];
    const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); });
    try { obs.observe({ entryTypes: ['longtask'] }); } catch { /* not supported */ }
    const btn = document.querySelector(openSel) ?? [...document.querySelectorAll('button')].find((x) => new RegExp(openSel, 'i').test(x.textContent));
    if (!btn) return 'no button';
    const t0 = performance.now();
    btn.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const paint = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 2000));
    obs.disconnect();
    const panel = document.querySelector('.nb-rail-panel[aria-hidden="false"], .nb-library-studio, .nbs-sheet');
    return {
      firstPaintMs: +paint.toFixed(1),
      longTasks: long,
      longTaskTotalMs: long.reduce((a, c) => a + c, 0),
      canvases: panel ? panel.querySelectorAll('canvas').length : 0,
      buttons: panel ? panel.querySelectorAll('button').length : 0,
      domNodes: panel ? panel.querySelectorAll('*').length : 0,
    };
  }, { openSel });
  console.log(`${label}:`, JSON.stringify(res));
  await p.keyboard.press(closeKey);
  await p.waitForTimeout(1200);
};

await measure('shelf studio (cold)', 'studio');
await measure('shelf studio (warm)', 'studio');

// open the book and measure its panels
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
await p.waitForTimeout(2500);
await measure('book studio (cold)', '.nb-rail-button[data-tool="customize"]');
await measure('catalogue (cold)', '.nb-rail-button[data-tool="catalogue"]');
await measure('ribbons (cold)', '.nb-rail-button[data-tool="ribbon-style"]');

// slash menu cap
await p.locator('.nb-leaf-paper').first().click({ position: { x: 200, y: 600 } }).catch(() => {});
await p.waitForTimeout(600);
await p.keyboard.type('/');
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/95-slash.png`, timeout: 60000 });
console.log('SLASH MENU:', JSON.stringify(await p.evaluate(() => {
  const m = document.querySelector('.nb-slash, [class*=slash]');
  if (!m) return 'none';
  return { items: m.querySelectorAll('[role=option],button,li').length, text: m.textContent.replace(/\s+/g, ' ').slice(0, 200) };
})));
await p.keyboard.press('Escape');
await p.waitForTimeout(600);

// context menu cap
await p.locator('.nb-leaf-paper').first().click({ button: 'right', position: { x: 200, y: 300 } }).catch(() => {});
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/96-ctx.png`, timeout: 60000 });
console.log('CONTEXT MENU:', JSON.stringify(await p.evaluate(() => {
  const m = document.querySelector('.nb-ctx, [class*=ctx-menu], [class*=context]');
  if (!m) return 'none';
  return { items: m.querySelectorAll('button,[role=menuitem]').length, text: m.textContent.replace(/\s+/g, ' ').slice(0, 240) };
})));
await b.close();
