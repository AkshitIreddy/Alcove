/**
 * shots-now/spine-res.mjs — photograph real spines at the zoom a reader rests
 * at, on a HiDPI display, so "the books feel low resolution" can be judged
 * rather than argued about.
 *
 * Seeds a full row, waits for the hi bakes to land, then screenshots the
 * canvas at deviceScaleFactor 2 and prints the screen rect of the first few
 * spines so crop.py can be pointed at one.
 *
 * Usage: node shots-now/spine-res.mjs out.png [dpr] [zoom]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'shots-now/spine-res.png';
const dpr = Number(process.argv[3] ?? 2);
const zoom = Number(process.argv[4] ?? 0);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({
  viewport: { width: 1500, height: 950 },
  deviceScaleFactor: dpr,
});
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 9000));
for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
}

await p
  .evaluate(async () => {
    const seed = globalThis.__shelfSeedBooks;
    if (!seed) return;
    const have = globalThis.__shelfVisibleBooks?.() ?? [];
    if (have.length >= 8) return;
    await seed(
      ['Marginalia', 'The Long Coast', 'Quiet Machines', 'Ember & Ash',
       'Field Notes', 'The Paper Sea', 'Winterlight', 'Salt Almanac'],
      0,
    );
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 5000));

if (zoom > 0) {
  await p.evaluate((z) => {
    const w = globalThis.__shelfWorld;
    if (!w) return;
    w.camera.zoom = z;
    w.camera.logZoomTarget = Math.log(z);
    w.dirty = true;
  }, zoom);
}
// Long settle: the hi bake queue must drain before the picture means anything.
await new Promise((r) => setTimeout(r, 9000));

const info = await p.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const list = globalThis.__shelfVisibleBooks?.() ?? [];
  const rect = globalThis.__shelfSpineRect;
  return {
    zoom: w?.camera?.zoom ?? 0,
    tier: w?.tier ?? -1,
    res: w?.app?.renderer?.resolution ?? 1,
    hi: w?.factory?.hiTextures?.size ?? -1,
    lo: w?.factory?.loTextures?.size ?? -1,
    books: list.slice(0, 6).map((bk) => ({ title: bk.title, r: rect?.(bk.id) ?? null })),
  };
});
console.log(JSON.stringify(info, null, 1));

await p.screenshot({ path: out, timeout: 120000, animations: 'disabled', caret: 'hide' });
console.log(`done -> ${out}`);
await b.close();
