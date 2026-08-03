/** Custom colour persistence + a census of every colour chooser in the app. */
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
const openBook = async () => {
  await p.locator('.shelf-a11y button').first().dispatchEvent('click');
  await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(2500);
};
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);
await skipTour();
await openBook();

console.log('=== custom colour: set #2266aa on the welcome callout ===');
await p.locator('.nb-callout-tint').first().click({ force: true });
await p.waitForTimeout(1000);
const hex = p.locator('.nb-callout-tint-panel input[type=text], .nb-callout-tint-panel input:not([type=color])').first();
await hex.fill('#2266aa');
await p.keyboard.press('Enter');
await p.waitForTimeout(1800);
await shot('60-custom-set');
const applied = await p.evaluate(() => {
  const c = document.querySelector('.nb-callout, [data-tint]');
  return { tint: c?.getAttribute('data-tint'), style: c?.getAttribute('style')?.slice(0, 120), stored: localStorage.getItem('bellanote.customColours') };
});
console.log('applied:', JSON.stringify(applied));

await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
await skipTour();
await openBook();
const after = await p.evaluate(() => {
  const c = document.querySelector('.nb-callout, [data-tint]');
  return { tint: c?.getAttribute('data-tint'), style: c?.getAttribute('style')?.slice(0, 120), stored: localStorage.getItem('bellanote.customColours') };
});
console.log('after reload:', JSON.stringify(after));
console.log('CUSTOM COLOUR SURVIVES RELOAD:', after.stored === applied.stored && after.tint === applied.tint);
await p.locator('.nb-callout-tint').first().click({ force: true });
await p.waitForTimeout(1200);
await shot('61-custom-after-reload');

console.log('\n=== colour chooser census: book studio ===');
await p.keyboard.press('Escape');
await p.locator('.nb-rail-button[data-tool="customize"]').click({ force: true });
await p.waitForTimeout(3000);
await shot('62-book-studio');
console.log(JSON.stringify(await p.evaluate(() => {
  const panel = [...document.querySelectorAll('.nb-rail-panel')].find((e) => e.getAttribute('aria-hidden') === 'false');
  if (!panel) return 'none';
  const out = [];
  for (const grid of panel.querySelectorAll('.nb-swatch-grid, .nb-strip, .nb-chip-row')) {
    const label = grid.previousElementSibling?.textContent?.trim().slice(0, 30) ?? grid.getAttribute('aria-label') ?? '?';
    const more = [...grid.querySelectorAll('.nb-more, .nb-strip-more')].map((m) => m.textContent.trim());
    out.push({ label, swatches: grid.querySelectorAll('button').length, more, colorInput: !!grid.querySelector('input[type=color]') });
  }
  return { groups: out, colorInputsInPanel: panel.querySelectorAll('input[type=color]').length };
}), null, 1));

console.log('\n=== library studio (shelf) ===');
await p.keyboard.press('Escape');
await p.waitForTimeout(500);
await p.locator('.nb-back-button').click({ force: true });
await p.waitForTimeout(4000);
await p.locator('button:has-text("studio")').first().click({ force: true });
await p.waitForTimeout(3000);
console.log(JSON.stringify(await p.evaluate(() => {
  const panel = document.querySelector('.nb-rail-panel-body');
  if (!panel) return 'none';
  const out = [];
  for (const grid of panel.querySelectorAll('.nb-swatch-grid, .nb-strip, .nb-chip-row, .nbs-seg')) {
    const label = grid.previousElementSibling?.textContent?.trim().slice(0, 34) ?? '?';
    out.push({ label, tiles: grid.querySelectorAll('button').length, more: [...grid.querySelectorAll('.nb-more,.nb-strip-more')].map((m) => m.textContent.trim()) });
  }
  return { groups: out, colorInputs: panel.querySelectorAll('input[type=color]').length };
}), null, 1));
await b.close();
