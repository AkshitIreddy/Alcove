/**
 * v3 — everything happens ON the tree spread ("A library of your own"), which
 * is one ArrowRight from the Welcome book's first spread.
 *
 *  1. hold a corner mid-curl there and photograph the flip textures
 *  2. turn away one spread and come straight back, with an 8ms sampler AND a
 *     MutationObserver watching for the exact moment a skeleton element is
 *     inserted, then photograph the landing
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'qa/tmp/vs3';
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

await page.keyboard.press('ArrowRight');
await page.waitForTimeout(3000);
const onTree = await page.evaluate(() => document.body.innerText.includes('A library of your own'));
console.log(`tree spread reached: ${onTree}; ${JSON.stringify(await census())}`);
await page.screenshot({ path: `${OUT}/00-rest.png` });

// ---- 1. hold the corner mid-curl ON this spread
const surface = await page.locator('.nb-flip-surface').boundingBox();
if (surface) {
  const y = surface.y + surface.height * 0.5;
  await page.mouse.move(surface.x + surface.width - 12, y);
  await page.mouse.down();
  for (const [k, f] of [0.86, 0.68, 0.5].entries()) {
    await page.mouse.move(surface.x + surface.width * f, y, { steps: 12 });
    await page.waitForTimeout(420);
    await page.screenshot({ path: `${OUT}/curl-${k + 1}.png` });
    console.log(`  curl ${Math.round(f * 100)}%  ${JSON.stringify(await census())}`);
  }
  await page.mouse.move(surface.x + surface.width - 12, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1600);
}
console.log('after releasing the corner:', JSON.stringify(await census()));

// ---- 2. away one spread and straight back, watching for the insert
const watch = async () => page.evaluate(() => {
  globalThis.__mut = [];
  globalThis.__samples = [];
  const read = () => [...document.querySelectorAll('.nb-diagram')].map((d) =>
    `${d.closest('.nb-export-offscreen') ? 'staged' : 'leaf'}:` +
    (d.querySelector('.nb-diagram-skeleton') ? 'skeleton' : d.querySelector('.nb-dg-svg') ? 'drawn' : 'empty'));
  globalThis.__timer = setInterval(() => globalThis.__samples.push(read()), 8);
  globalThis.__mo = new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      const el = n.classList?.contains('nb-diagram-skeleton') ? n : n.querySelector?.('.nb-diagram-skeleton');
      if (el) globalThis.__mut.push((el.closest('.nb-export-offscreen') ? 'staged' : 'leaf') + '@' + Math.round(performance.now()));
    }
  });
  globalThis.__mo.observe(document.body, { childList: true, subtree: true });
});
const stop = async () => page.evaluate(() => {
  clearInterval(globalThis.__timer);
  globalThis.__mo.disconnect();
  return { mut: globalThis.__mut, n: globalThis.__samples.length,
    leaf: globalThis.__samples.filter((s) => s.includes('leaf:skeleton')).length,
    staged: globalThis.__samples.filter((s) => s.includes('staged:skeleton')).length };
});

for (let round = 1; round <= 3; round += 1) {
  await watch();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(2800);
  const a = await stop();
  await watch();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2800);
  const b = await stop();
  await page.screenshot({ path: `${OUT}/round-${round}-landed.png` });
  console.log(`  round ${round}: away ${JSON.stringify(a)}  back ${JSON.stringify(b)}  now ${JSON.stringify(await census())}`);
}
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
