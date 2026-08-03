/** Deep scroll + preset application + wall/case change. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'qa/verify';
const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);
for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png`, timeout: 60000 }); console.log('  shot', n); };
const design = () => p.evaluate(() => globalThis.__shelfDesign?.() ?? null);

await p.locator('button:has-text("studio")').first().click({ force: true });
await p.waitForTimeout(2200);

// --- expand every "more" in the panel so the sheet is genuinely long
const moreCount = await p.locator('.nb-rail-panel-body .nb-more, .nb-rail-panel-body .nb-strip-more').count();
console.log('more-controls in studio body:', moreCount);

// scroll the panel body to the bottom
await p.evaluate(() => {
  const el = document.querySelector('.nb-rail-panel-body');
  if (el) el.scrollTop = el.scrollHeight;
});
await p.waitForTimeout(1200);
await shot('11-studio-scrolled-bottom');

const closeVis = await p.evaluate(() => {
  const btn = document.querySelector('.nb-rail-panel-close');
  if (!btn) return 'missing';
  const r = btn.getBoundingClientRect();
  const mid = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), hitIsClose: btn.contains(mid) || mid === btn, body: document.querySelector('.nb-rail-panel-body').scrollTop };
});
console.log('close after deep scroll:', JSON.stringify(closeVis));

// --- apply a room preset that is NOT the default, from the "more" sheet
const before = await design();
console.log('BEFORE', before?.shelf, '|', before?.design?.wallpaper?.pattern, '|', before?.libraryKey?.slice(0, 30));

// open the presets "more"
await p.evaluate(() => { const el = document.querySelector('.nb-rail-panel-body'); if (el) el.scrollTop = 0; });
await p.waitForTimeout(400);
const more = p.locator('.nb-rail-panel-body button:has-text("more")').first();
console.log('presets more label:', (await more.textContent().catch(() => '')) ?? '');
await more.click({ force: true }).catch((e) => console.log('more click failed', e.message));
await p.waitForTimeout(2500);
await shot('12-preset-sheet');

const sheet = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('.nb-picker-card, .nbp-card, [class*=picker] button')];
  return { n: cards.length, sample: cards.slice(0, 6).map((c) => c.textContent.trim().slice(0, 40)) };
});
console.log('picker sheet:', JSON.stringify(sheet));

await b.close();
