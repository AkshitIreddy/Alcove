/** Overflow measurement, callout palette + custom hex, library studio colour row. */
import { chromium } from 'playwright';

const OUT = 'qa/verify';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png`, timeout: 60000 }); console.log('  shot', n); };
const skipTour = async () => {
  for (let i = 0; i < 4; i++) {
    const s = p.locator('text=skip the tour').first();
    if ((await s.count()) === 0) break;
    await s.click({ force: true, timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(700);
  }
};
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);
await skipTour();
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
await p.waitForTimeout(2500);

// --- ribbon panel more-row overflow
await p.locator('.nb-rail-button[data-tool="ribbon-style"]').click({ force: true });
await p.waitForTimeout(2500);
console.log('MORE-ROW BOXES:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.nb-more')].map((e) => {
  const r = e.getBoundingClientRect();
  const parent = e.parentElement;
  return { text: e.textContent.trim(), box: Math.round(r.width) + 'x' + Math.round(r.height), scrollW: e.scrollWidth, overflow: e.scrollWidth - Math.round(r.width), parentCols: getComputedStyle(parent).gridTemplateColumns, cls: e.className };
})), null, 1));

// --- callout: find the tint control on the seeded callout
await p.keyboard.press('Escape');
await p.waitForTimeout(600);
console.log('CALLOUT CONTROLS:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.nb-callout-tint,.nb-callout-icon')].map((e) => {
  const r = e.getBoundingClientRect();
  return { cls: e.className, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(e).visibility, op: getComputedStyle(e).opacity };
}))));
const tint = p.locator('.nb-callout-tint').first();
await tint.scrollIntoViewIfNeeded().catch(() => {});
await tint.click({ force: true }).catch((e) => console.log('  tint click:', e.message));
await p.waitForTimeout(1500);
await shot('50-callout-open');
console.log('POPUP:', JSON.stringify(await p.evaluate(() => {
  const cand = [...document.querySelectorAll('div,section')].filter((e) => /tint|palette|wash/i.test(e.className.toString()));
  return cand.slice(0, 6).map((e) => ({ cls: e.className.toString().slice(0, 50), n: e.querySelectorAll('button').length, hasColorInput: !!e.querySelector('input[type=color]') }));
})));

// expand + custom colour
const inputs = await p.evaluate(() => [...document.querySelectorAll('input[type=color]')].map((e) => ({ cls: e.className, id: e.id, vis: e.getBoundingClientRect().width })));
console.log('COLOR INPUTS in DOM:', JSON.stringify(inputs));

// --- library studio colour row (shelf side)
await p.keyboard.press('Escape');
await p.waitForTimeout(2500);
await b.close();
