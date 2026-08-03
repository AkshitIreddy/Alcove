/** Book rail: ribbons, customize, tooltips, caps, persistence. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'qa/verify';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png`, timeout: 60000 }); console.log('  shot', n); };

async function boot() {
  await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(8000);
  for (let i = 0; i < 4; i++) {
    const s = p.locator('text=skip the tour').first();
    if ((await s.count()) === 0) break;
    await s.click({ force: true, timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(700);
  }
}
async function openBook() {
  await p.locator('.shelf-a11y button').first().dispatchEvent('click');
  await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(2500);
}
await boot();
await openBook();

// --- rail buttons + tooltips
const rail = await p.evaluate(() => [...document.querySelectorAll('.nb-rail-button')].map((e) => {
  const r = e.getBoundingClientRect();
  return { tool: e.dataset.tool, label: e.getAttribute('aria-label'), x: Math.round(r.x), y: Math.round(r.y), describedby: e.getAttribute('aria-describedby'), title: e.getAttribute('title') };
}));
console.log('rail buttons:', JSON.stringify(rail));

// tooltip: focus a rail button by keyboard and see what appears + layout shift
const before = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, boxes: [...document.querySelectorAll('.nb-rail-button')].map((e) => Math.round(e.getBoundingClientRect().x)) }));
await p.locator('.nb-rail-button').first().focus();
await p.waitForTimeout(900);
const tip = await p.evaluate(() => {
  const t = document.querySelector('.nb-tip, [role=tooltip], .nb-tooltip');
  const nativeTitles = [...document.querySelectorAll('[title]')].length;
  if (!t) return { found: false, nativeTitles };
  const r = t.getBoundingClientRect();
  const cs = getComputedStyle(t);
  return { found: true, cls: t.className.toString(), role: t.getAttribute('role'), text: t.textContent.trim().slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), pos: cs.position, bg: cs.backgroundColor, font: cs.fontFamily.slice(0, 40), nativeTitles };
});
console.log('tooltip on keyboard focus:', JSON.stringify(tip));
const after = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, boxes: [...document.querySelectorAll('.nb-rail-button')].map((e) => Math.round(e.getBoundingClientRect().x)) }));
console.log('layout shift:', JSON.stringify({ same: JSON.stringify(before) === JSON.stringify(after), before, after }));
await shot('30-tooltip-keyboard');

// hover tooltip too
await p.locator('.nb-rail-button').nth(3).hover({ force: true });
await p.waitForTimeout(900);
await shot('31-tooltip-hover');

// --- open the bookmark/ribbon panel
const tools = rail.map((r) => r.tool);
console.log('tools:', tools.join(','));
for (const t of ['bookmarks', 'ribbons', 'marks']) {
  const btn = p.locator(`.nb-rail-button[data-tool="${t}"]`);
  if ((await btn.count()) > 0) { await btn.first().click({ force: true }); break; }
}
await p.waitForTimeout(2500);
await shot('32-ribbons-panel');
const ribbonPanel = await p.evaluate(() => {
  const panel = [...document.querySelectorAll('.nb-rail-panel')].find((e) => e.getAttribute('aria-hidden') === 'false');
  if (!panel) return 'none open';
  return {
    label: panel.getAttribute('aria-label'),
    tiles: panel.querySelectorAll('button').length,
    more: [...panel.querySelectorAll('button')].filter((x) => /more/i.test(x.textContent)).map((x) => x.textContent.trim()),
    closeX: Math.round(panel.querySelector('.nb-rail-panel-close')?.getBoundingClientRect().x ?? -1),
    panelX: Math.round(panel.getBoundingClientRect().x),
    panelW: Math.round(panel.getBoundingClientRect().width),
  };
});
console.log('open panel:', JSON.stringify(ribbonPanel));
await b.close();
