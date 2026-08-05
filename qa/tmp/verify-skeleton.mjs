/**
 * Independent check of the "diagram falls back to its skeleton on a page turn"
 * fix. Written from scratch; does not import the implementer's probe.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'qa/tmp/verify-skeleton';
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
      const where = d.closest('.nb-export-offscreen') ? 'staged' : 'leaf';
      return `${where}:${state}`;
    }),
  );

// Walk forward until a spread with a diagram, recording the census after each turn.
let found = -1;
for (let k = 0; k < 12; k += 1) {
  const c = await census();
  if (c.some((s) => s.startsWith('leaf:'))) { found = k; break; }
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2200);
}
console.log(`diagram spread after ${found} turn(s): ${JSON.stringify(await census())}`);
await page.screenshot({ path: `${OUT}/00-rest.png` });

// Per-rAF trace across 6 turns (3 forward, 3 back), plus a polling sampler at
// 16ms via CDP-independent setInterval, because rAF is throttled under
// SwiftShader and can miss a one-frame swap.
let flashTurns = 0;
let stagedTurns = 0;
for (let i = 0; i < 6; i += 1) {
  const back = i % 2 === 1;
  await page.evaluate(() => {
    globalThis.__samples = [];
    const read = () =>
      [...document.querySelectorAll('.nb-diagram')].map((d) => {
        const state = d.querySelector('.nb-diagram-skeleton')
          ? 'skeleton'
          : d.querySelector('.nb-dg-svg')
            ? 'drawn'
            : 'empty';
        return `${d.closest('.nb-export-offscreen') ? 'staged' : 'leaf'}:${state}`;
      });
    globalThis.__timer = setInterval(() => {
      globalThis.__samples.push(read());
    }, 8);
    // Also catch it structurally: a MutationObserver fires on the exact insert.
    globalThis.__mut = [];
    globalThis.__mo = new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (n.nodeType === 1 && (n.classList?.contains('nb-diagram-skeleton') || n.querySelector?.('.nb-diagram-skeleton'))) {
            const el = n.classList?.contains('nb-diagram-skeleton') ? n : n.querySelector('.nb-diagram-skeleton');
            globalThis.__mut.push(el.closest('.nb-export-offscreen') ? 'staged' : 'leaf');
          }
        }
      }
    });
    globalThis.__mo.observe(document.body, { childList: true, subtree: true });
  });
  await page.keyboard.press(back ? 'ArrowLeft' : 'ArrowRight');
  await page.waitForTimeout(2800);
  const { samples, mut } = await page.evaluate(() => {
    clearInterval(globalThis.__timer);
    globalThis.__mo.disconnect();
    return { samples: globalThis.__samples, mut: globalThis.__mut };
  });
  const leafSk = samples.filter((s) => s.includes('leaf:skeleton')).length;
  const stagedSk = samples.filter((s) => s.includes('staged:skeleton')).length;
  if (leafSk > 0 || mut.includes('leaf')) flashTurns += 1;
  if (stagedSk > 0 || mut.includes('staged')) stagedTurns += 1;
  console.log(
    `  turn ${i + 1} (${back ? 'back' : 'fwd'}): ${samples.length} samples, ` +
      `leaf:skeleton in ${leafSk}, staged:skeleton in ${stagedSk}; ` +
      `skeleton elements INSERTED: ${JSON.stringify(mut)}`,
  );
}

// Land on the diagram spread and photograph it settling.
for (let k = 0; k < 12; k += 1) {
  const c = await census();
  if (c.some((s) => s.startsWith('leaf:'))) break;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2200);
}
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2600);
await page.keyboard.press('ArrowLeft');
let elapsed = 0;
for (const delay of [100, 200, 350, 600, 1000, 1800]) {
  await page.waitForTimeout(delay - elapsed);
  elapsed = delay;
  const st = await census();
  await page.screenshot({ path: `${OUT}/land-${String(delay).padStart(4, '0')}.png` });
  console.log(`  +${delay}ms ${JSON.stringify(st)}`);
}

// Hold a corner mid-curl and photograph the flip textures.
for (let k = 0; k < 12; k += 1) {
  const c = await census();
  if (c.some((s) => s.startsWith('leaf:'))) break;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2200);
}
await page.screenshot({ path: `${OUT}/10-before-curl.png` });
const surface = await page.locator('.nb-flip-surface').boundingBox();
if (surface) {
  const y = surface.y + surface.height * 0.5;
  await page.mouse.move(surface.x + surface.width - 12, y);
  await page.mouse.down();
  for (const [k, f] of [0.82, 0.62, 0.42].entries()) {
    await page.mouse.move(surface.x + surface.width * f, y, { steps: 12 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/curl-${k + 1}.png` });
    console.log(`  curl held at ${Math.round(f * 100)}%  ${JSON.stringify(await census())}`);
  }
  await page.mouse.move(surface.x + surface.width - 12, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
}
await page.screenshot({ path: `${OUT}/11-after-curl.png` });

console.log(`\nturns where a live leaf showed/inserted a skeleton: ${flashTurns} of 6`);
console.log(`turns where a staged sheet showed/inserted a skeleton: ${stagedTurns} of 6`);
console.log('page errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
