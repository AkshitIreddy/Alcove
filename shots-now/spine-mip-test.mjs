/**
 * shots-now/spine-mip-test.mjs — is the softness the bake scale, or the mip?
 *
 * Same shelf, same zoom, three sampler settings on the LIVE spine atlas:
 *   a) as shipped            (autoGenerateMipmaps: true, mipmapFilter linear)
 *   b) mipmapFilter nearest  (no half-res blend, still anti-aliased far out)
 *   c) mipmaps off entirely
 * Three screenshots of the identical pixels; crop.py judges them.
 */
import { chromium } from 'playwright';

const dpr = Number(process.argv[2] ?? 2);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: dpr });
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
    const have = globalThis.__shelfVisibleBooks?.() ?? [];
    if (seed && have.length < 8) {
      await seed(
        ['Marginalia', 'The Long Coast', 'Quiet Machines', 'Ember & Ash',
         'Field Notes', 'The Paper Sea', 'Winterlight', 'Salt Almanac'],
        0,
      );
    }
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 12000));

const where = await p.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const list = globalThis.__shelfVisibleBooks?.() ?? [];
  const rects = list.map((bk) => ({ t: bk.title, r: globalThis.__shelfSpineRect?.(bk.id) }));
  return { zoom: w?.camera?.zoom, tier: w?.tier, res: w?.app?.renderer?.resolution, rects };
});
console.log(JSON.stringify(where));

const shot = async (name) => {
  await p.evaluate(() => {
    const w = globalThis.__shelfWorld;
    w.dirty = true;
  });
  await new Promise((r) => setTimeout(r, 1200));
  await p.screenshot({ path: name, timeout: 120000, animations: 'disabled', caret: 'hide' });
  console.log(`  -> ${name}`);
};

await shot('shots-now/mip-a-shipped.png');

await p.evaluate(() => {
  const w = globalThis.__shelfWorld;
  for (const src of w.factory.sources.values()) {
    src.style.mipmapFilter = 'nearest';
    src.style.update?.();
    src.update();
  }
  w.dirty = true;
});
await shot('shots-now/mip-b-nearest.png');

await p.evaluate(() => {
  const w = globalThis.__shelfWorld;
  for (const src of w.factory.sources.values()) {
    src.autoGenerateMipmaps = false;
    src.mipLevelCount = 1;
    src.style.mipmapFilter = 'nearest';
    src.style.update?.();
    src.update();
  }
  w.dirty = true;
});
await shot('shots-now/mip-c-nomips.png');

await b.close();
