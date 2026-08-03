/** Apply a room preset from the sheet and read the APPLIED shelf state. */
import { chromium } from 'playwright';

const OUT = 'qa/verify';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);
for (let i = 0; i < 4; i++) {
  const s = p.locator('text=skip the tour').first();
  if ((await s.count()) === 0) break;
  await s.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png`, timeout: 60000 }); console.log('  shot', n); };
const design = () => p.evaluate(() => globalThis.__shelfDesign?.() ?? null);

await p.locator('button:has-text("studio")').first().click({ force: true });
await p.waitForTimeout(2200);
await p.locator('.nb-rail-panel-body button:has-text("more")').first().click({ force: true });
await p.waitForTimeout(2200);

const before = await design();
console.log('BEFORE', JSON.stringify(before.design), '\n  theme:', before.libraryKey.split('|')[0]);

// pick a preset far from the default: search "coastal"
await p.locator('input[placeholder*="search"]').first().fill('coastal').catch(() => {});
await p.waitForTimeout(1500);
await shot('13-preset-search');
const names = await p.evaluate(() => [...document.querySelectorAll('.nb-rail-panel-body button')].map((x) => x.textContent.trim().slice(0, 30)).filter((t) => t.length > 2).slice(0, 20));
console.log('search hits:', JSON.stringify(names));

// click the first card after the back control
const card = p.locator('.nb-rail-panel-body button').filter({ hasNotText: 'back' }).nth(0);
const label = await card.textContent();
console.log('clicking card:', label.slice(0, 60));
await card.click({ force: true });
await p.waitForTimeout(3500);
const after = await design();
console.log('AFTER ', JSON.stringify(after.design), '\n  theme:', after.libraryKey.split('|')[0]);
console.log('build changed :', before.design.build !== after.design.build);
console.log('pattern changed:', before.design.pattern !== after.design.pattern);
console.log('wall changed  :', JSON.stringify(before.design.wallpaper) !== JSON.stringify(after.design.wallpaper));
console.log('theme changed :', before.libraryKey.split('|')[0] !== after.libraryKey.split('|')[0]);
await shot('14-preset-applied');

// close panel, look at bare shelf
await p.locator('.nb-rail-panel-close').first().click({ force: true }).catch(() => {});
await p.waitForTimeout(2500);
await shot('15-preset-applied-shelf');
await b.close();
