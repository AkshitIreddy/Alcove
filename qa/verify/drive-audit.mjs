/** Title-vs-data-tooltip census, ribbon persistence, sound sets, callout palette + custom colour. */
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

console.log('\n=== TITLE vs data-tooltip census ===');
console.log(JSON.stringify(await p.evaluate(() => {
  const t = [...document.querySelectorAll('[title]')];
  const both = t.filter((e) => e.hasAttribute('data-tooltip'));
  const onlyTitle = t.filter((e) => !e.hasAttribute('data-tooltip'));
  const byCls = {};
  for (const e of onlyTitle) { const k = e.className.toString().split(' ')[0] || e.tagName; byCls[k] = (byCls[k] ?? 0) + 1; }
  return { titles: t.length, alsoDataTooltip: both.length, onlyNativeTitle: onlyTitle.length, byClass: byCls, dataTooltips: document.querySelectorAll('[data-tooltip]').length };
}), null, 1));

console.log('\n=== RIBBON: change and reload ===');
await p.locator('.nb-rail-button[data-tool="ribbon-style"]').click({ force: true });
await p.waitForTimeout(2500);
// press a non-active preset tile
const picked = await p.evaluate(() => {
  const panel = [...document.querySelectorAll('.nb-rail-panel')].find((e) => e.getAttribute('aria-hidden') === 'false');
  const tiles = [...panel.querySelectorAll('.nb-strip-tile')].filter((t) => !t.classList.contains('is-active') && !t.classList.contains('nb-strip-more'));
  const t = tiles[3] ?? tiles[0];
  t.click();
  return t.getAttribute('title') ?? t.textContent.trim();
});
console.log('picked ribbon:', picked);
await p.waitForTimeout(2500);
const cssBefore = await p.evaluate(() => {
  const st = [...document.querySelectorAll('style')].map((s) => s.textContent).filter((t) => t.includes('nb-ribbon')).join('').slice(0, 200);
  return st;
});
console.log('ribbon css head:', cssBefore.replace(/\s+/g, ' ').slice(0, 160));
await shot('40-ribbon-picked');
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
await skipTour();
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
await p.waitForTimeout(2500);
const cssAfter = await p.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).filter((t) => t.includes('nb-ribbon')).join('').slice(0, 200));
console.log('after reload  :', cssAfter.replace(/\s+/g, ' ').slice(0, 160));
console.log('RIBBON PERSISTED:', cssBefore.slice(0, 200) === cssAfter.slice(0, 200));

console.log('\n=== CUSTOM COLOUR: callout tint, then reload ===');
// insert a callout via slash menu? simpler: the welcome page already has one
await p.locator('.nb-callout-tint').first().click({ force: true }).catch((e) => console.log('  no callout tint button', e.message));
await p.waitForTimeout(1200);
await shot('41-callout-palette');
const pal = await p.evaluate(() => {
  const pop = document.querySelector('.nb-callout-palette, [class*=palette]');
  if (!pop) return 'no palette';
  const sw = [...pop.querySelectorAll('button')];
  return { buttons: sw.length, labels: sw.map((s) => (s.getAttribute('title') || s.textContent).trim().slice(0, 18)).slice(0, 40), hasColorInput: !!pop.querySelector('input[type=color]') };
});
console.log('callout palette:', JSON.stringify(pal, null, 1));

console.log('\n=== SOUND SETS ===');
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
await p.locator('.nb-settings-fab, [aria-label*="ettings"]').first().click({ force: true }).catch((e) => console.log('  settings open failed', e.message));
await p.waitForTimeout(2500);
await shot('42-settings');
const snd = await p.evaluate(() => {
  const sec = [...document.querySelectorAll('.nbs-section')].find((s) => /sound/i.test(s.textContent.slice(0, 40)));
  if (!sec) return 'no sound section';
  return {
    text: sec.textContent.replace(/\s+/g, ' ').slice(0, 500),
    buttons: [...sec.querySelectorAll('button')].map((x) => (x.getAttribute('aria-label') || x.textContent).trim().slice(0, 30)).slice(0, 40),
  };
});
console.log(JSON.stringify(snd, null, 1));
await b.close();
