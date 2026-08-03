/** Ribbon design really persists (cover_meta + generated <style>), and the more-pill overflow. */
import { chromium } from 'playwright';

const OUT = 'qa/verify';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
const skipTour = async () => { for (let i = 0; i < 4; i++) { const s = p.locator('text=skip the tour').first(); if ((await s.count()) === 0) break; await s.click({ force: true, timeout: 4000 }).catch(() => {}); await p.waitForTimeout(700); } };
const openBook = async () => { await p.locator('.shelf-a11y button').first().dispatchEvent('click'); await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {}); await p.waitForTimeout(2500); };
const ribbonStyle = () => p.evaluate(() => {
  const el = [...document.querySelectorAll('style')].find((s) => s.textContent.includes('.nb-ribbon['));
  return el ? el.textContent.replace(/\s+/g, ' ').slice(0, 240) : 'no generated ribbon style';
});
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
await skipTour();
await openBook();
console.log('DEFAULT :', (await ribbonStyle()).slice(0, 180));
await p.locator('.nb-rail-button[data-tool="ribbon-style"]').click({ force: true });
await p.waitForTimeout(2500);
const chose = await p.evaluate(() => {
  const panel = [...document.querySelectorAll('.nb-rail-panel')].find((e) => e.getAttribute('aria-hidden') === 'false');
  const t = [...panel.querySelectorAll('.nb-chip')].find((c) => /nautical/i.test(c.textContent));
  t?.click();
  return t?.textContent.trim() ?? 'no family chip';
});
await p.waitForTimeout(1200);
const chose2 = await p.evaluate(() => {
  const panel = [...document.querySelectorAll('.nb-rail-panel')].find((e) => e.getAttribute('aria-hidden') === 'false');
  const tiles = [...panel.querySelectorAll('.nb-strip-tile')].filter((t) => !t.classList.contains('is-active') && !t.classList.contains('nb-strip-more'));
  tiles[1]?.click();
  return tiles[1]?.getAttribute('title') ?? '?';
});
console.log('chose family/tile:', chose, '/', chose2);
await p.waitForTimeout(2500);
const before = await ribbonStyle();
console.log('AFTER PICK:', before.slice(0, 180));
const meta = await p.evaluate(async () => {
  const ids = globalThis.__shelfVisibleBooks?.() ?? [];
  return JSON.stringify(globalThis.__shelfBookMeta?.(ids[0]?.id)).slice(0, 300);
});
console.log('cover_meta:', meta);

// more-pill overflow, with real ink extents
console.log('MORE PILL:', JSON.stringify(await p.evaluate(() => {
  const el = [...document.querySelectorAll('.nb-more-row')].find((e) => e.closest('.nb-swatch-grid'));
  if (!el) return 'not found';
  const r = el.getBoundingClientRect();
  const kids = [...el.children].map((c) => c.getBoundingClientRect());
  const inkL = Math.min(...kids.map((k) => k.x));
  const inkR = Math.max(...kids.map((k) => k.x + k.width));
  const cs = getComputedStyle(el);
  return { pill: { x: +r.x.toFixed(1), w: +r.width.toFixed(1) }, ink: { x: +inkL.toFixed(1), w: +(inkR - inkL).toFixed(1) }, spillLeftPx: +(r.x + parseFloat(cs.paddingLeft) - inkL).toFixed(1), spillRightPx: +(inkR - (r.x + r.width - parseFloat(cs.paddingRight))).toFixed(1), gridCols: getComputedStyle(el.parentElement).gridTemplateColumns };
})));

await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
await skipTour();
await openBook();
const after = await ribbonStyle();
console.log('AFTER RELOAD:', after.slice(0, 180));
console.log('RIBBON PERSISTS:', before === after);
await p.screenshot({ path: `${OUT}/97-ribbon-after-reload.png`, timeout: 60000 });
await b.close();
