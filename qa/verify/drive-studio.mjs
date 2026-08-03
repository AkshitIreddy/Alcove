/** Drive the Library Studio: presets, scroll depth, back control, applied state. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'qa/verify';
const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);

const log = (...a) => console.log(...a);
const shot = async (name) => { await p.screenshot({ path: `${OUT}/${name}.png`, timeout: 60000 }); log('  shot', name); };

// tour
for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}

const design = async () => p.evaluate(() => (globalThis.__shelfDesign ? globalThis.__shelfDesign() : null));
log('design before:', JSON.stringify(await design()));

// ---- open studio
const t0 = Date.now();
await p.locator('button:has-text("studio")').first().click({ force: true });
await p.waitForTimeout(120);
await p.waitForFunction(() => document.querySelector('.nb-studio, .nb-rail-panel') !== null, { timeout: 8000 }).catch(() => {});
log('studio open in', Date.now() - t0, 'ms (incl. waits)');
await p.waitForTimeout(1800);
await shot('10-studio-open');

// enumerate panel structure
const struct = await p.evaluate(() => {
  const panel = document.querySelector('.nb-rail-panel, .nb-studio')?.closest('aside,div[class*=panel]') ?? document.querySelector('.nb-rail-panel');
  const pick = (sel) => [...document.querySelectorAll(sel)].map((e) => {
    const r = e.getBoundingClientRect();
    return { t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 50), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cls: e.className.toString().slice(0, 60) };
  });
  return {
    buttons: pick('button').filter((b) => b.w > 0),
    scrollers: [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 100).map((e) => ({ cls: e.className.toString().slice(0, 70), sh: e.scrollHeight, ch: e.clientHeight })),
  };
});
fs.writeFileSync(`${OUT}/10-studio-struct.json`, JSON.stringify(struct, null, 2));
log('buttons in studio:', struct.buttons.length, ' scrollers:', JSON.stringify(struct.scrollers));

await b.close();
if (errs.length) console.log('PAGE ERRORS:', errs);
