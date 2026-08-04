import { chromium } from 'playwright';

const URL_BASE = 'http://localhost:1431';
const F0 = ['Field Notes','Kanji Practice','Watercolour Basics','Cell Biology','Recipes','Dream Journal','The Long Walk','Chess Openings','Garden Log','Letters Home','Bird Counts'];
const F1 = ['Sourdough','Astronomy','Icelandic','Weekly Review','Short Stories','Tax 2026','Piano Scales','Sketchbook','Quotes','Marginalia','Trail Notes'];
const F2 = ['Wine Notes','Knots','Latin','Reading Log','House Plants','Film Diary','Mushrooms','Old Letters','Recipes II','Sea Glass'];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.setDefaultTimeout(60000);
page.on('pageerror', (e) => console.log('PAGEERR', e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 140)); });

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click({ force: true });
await page.waitForTimeout(1200);

await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 0), F0);
await page.waitForTimeout(1500);
await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 1), F1);
await page.waitForTimeout(1500);
await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 2), F2);
await page.waitForTimeout(4500);

await page.mouse.move(6, 934);
await page.screenshot({ path: 'shots-now/_probe-a.png', animations: 'disabled', caret: 'hide' });

const btns = await page.evaluate(() =>
  [...document.querySelectorAll('button')].map((b, i) => {
    const r = b.getBoundingClientRect();
    return { i, n: b.getAttribute('aria-label') || b.textContent.trim().slice(0, 30), box: [r.x|0, r.y|0, r.width|0, r.height|0] };
  }).filter((b) => /studio/i.test(b.n)),
);
console.log('buttons:', JSON.stringify(btns));

const target = page.getByRole('button', { name: /^Library studio$/ }).first();
console.log('count', await page.getByRole('button', { name: /^Library studio$/ }).count());
await target.click({ force: true });

for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => {
    const el = document.querySelector('.nb-library-studio');
    const dock = document.querySelector('.shelf-dock');
    return {
      panel: el ? 'present' : 'absent',
      panelBox: el ? (() => { const r = el.getBoundingClientRect(); return [r.x|0,r.y|0,r.width|0,r.height|0]; })() : null,
      sheets: [...document.querySelectorAll('[class*="nb-"][class*="sheet"], .nb-rail-panel')].length,
      dock: dock ? 'yes' : 'no',
    };
  });
  console.log(i, JSON.stringify(info));
  if (info.panel === 'present') break;
}
await page.screenshot({ path: 'shots-now/_probe-b.png' });
await browser.close();
