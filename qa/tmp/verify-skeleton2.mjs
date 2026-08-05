/**
 * Focused independent check: stay ON the diagram spread, turn away and back,
 * and hold a corner mid-curl there. Screenshots every 60ms across a turn so the
 * placeholder can be LOOKED at, not just counted.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'qa/tmp/vs2';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

await page.goto('http://localhost:1420/?fx=force&dev=0', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 300 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
});
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(5000);

const census = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.nb-diagram')].map((d) => {
      const state = d.querySelector('.nb-diagram-skeleton')
        ? 'skeleton'
        : d.querySelector('.nb-dg-svg')
          ? 'drawn'
          : 'empty';
      return `${d.closest('.nb-export-offscreen') ? 'staged' : 'leaf'}:${state}`;
    }),
  );

// one ArrowRight lands on the tree spread
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2600);
console.log('on tree spread:', JSON.stringify(await census()));
await page.screenshot({ path: `${OUT}/00-rest.png` });

// --- detector sensitivity check: force a skeleton by hand and confirm we see it
const sens = await page.evaluate(() => {
  const d = document.querySelector('.nb-diagram:not(.nb-export-offscreen .nb-diagram)');
  if (!d) return 'no diagram';
  const svg = d.querySelector('.nb-dg-svg');
  const fake = document.createElement('div');
  fake.className = 'nb-diagram-skeleton';
  svg.replaceWith(fake);
  return 'injected';
});
console.log('sensitivity inject:', sens, JSON.stringify(await census()));
await page.screenshot({ path: `${OUT}/01-injected-skeleton.png` });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 300 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
await page.waitForTimeout(2500);
{
  const s = page.getByText('skip the tour');
  if (await s.count()) { await s.first().click({ force: true }); await page.waitForTimeout(900); }
}
await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
});
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const c2 = await page.locator('.pulled-book').first().boundingBox();
if (c2) await page.mouse.click(c2.x + c2.width / 2, c2.y + c2.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(5000);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2600);
console.log('back on tree spread after reload:', JSON.stringify(await census()));

// --- turn away, come back, burst-screenshot the landing
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2600);
await page.evaluate(() => {
  globalThis.__mut = [];
  globalThis.__mo = new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      const el = n.classList?.contains('nb-diagram-skeleton') ? n : n.querySelector?.('.nb-diagram-skeleton');
      if (el) globalThis.__mut.push((el.closest('.nb-export-offscreen') ? 'staged' : 'leaf') + '@' + Math.round(performance.now()));
    }
  });
  globalThis.__mo.observe(document.body, { childList: true, subtree: true });
});
await page.keyboard.press('ArrowLeft');
for (let i = 0; i < 14; i += 1) {
  await page.screenshot({ path: `${OUT}/back-${String(i).padStart(2, '0')}.png` });
  const st = await census();
  if (st.includes('leaf:skeleton') || st.includes('staged:skeleton')) console.log(`  !! frame ${i}: ${JSON.stringify(st)}`);
}
console.log('skeleton inserts during return turn:', JSON.stringify(await page.evaluate(() => { globalThis.__mo.disconnect(); return globalThis.__mut; })));
await page.waitForTimeout(2000);
console.log('landed:', JSON.stringify(await census()));

// --- hold the corner mid-curl ON the tree spread
const surface = await page.locator('.nb-flip-surface').boundingBox();
if (surface) {
  const y = surface.y + surface.height * 0.5;
  await page.mouse.move(surface.x + surface.width - 12, y);
  await page.mouse.down();
  for (const [k, f] of [0.85, 0.66, 0.48].entries()) {
    await page.mouse.move(surface.x + surface.width * f, y, { steps: 12 });
    await page.waitForTimeout(420);
    await page.screenshot({ path: `${OUT}/curl-${k + 1}.png` });
    console.log(`  curl ${Math.round(f * 100)}%  ${JSON.stringify(await census())}`);
  }
  await page.mouse.move(surface.x + surface.width - 12, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
}
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
