/**
 * shots-now/spine-ab.mjs — the same nine books, twice, in one session.
 *
 * A before/after across two browser launches compares different books: the
 * seeds are fresh each time and a laurel-and-gilt binding has more edges than
 * a plain cloth one, so the sharpness number would be measuring the roll.
 * This drives the live factory back to the old behaviour instead — bake dpr 1
 * (the world-px scales) and a trilinear mip filter — re-bakes, and shoots the
 * identical shelf. Same seeds, same layout, same pixels but the sampling.
 *
 * Usage: node shots-now/spine-ab.mjs [dpr] [zoom]
 */
import { chromium } from 'playwright';

const dpr = Number(process.argv[2] ?? 2);
const zoom = Number(process.argv[3] ?? 0);

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
    if (seed && have.length < 10) {
      await seed(
        ['Marginalia', 'The Long Coast', 'Quiet Machines', 'Ember & Ash', 'Field Notes',
         'The Paper Sea', 'Winterlight', 'Salt Almanac', 'Hollow Bell', 'Tin Orchard'],
        0,
      );
    }
  })
  .catch(() => {});
await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 60000 });
if (zoom > 0) {
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate((z) => {
    const w = globalThis.__shelfWorld;
    w.camera.zoom = z;
    w.camera.logZoomTarget = Math.log(z);
    w.dirty = true;
  }, zoom);
}

const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const busy = await p.evaluate(() => {
      const f = globalThis.__shelfWorld.factory;
      return f.queue.size + f.inFlight.size;
    });
    if (busy === 0) break;
  }
  await new Promise((r) => setTimeout(r, 1500));
};

await settle();
const state = await p.evaluate(() => {
  const w = globalThis.__shelfWorld;
  return {
    zoom: Number(w.camera.zoom.toFixed(2)),
    tier: w.tier,
    res: w.app.renderer.resolution,
    bakeDpr: w.factory.dpr,
    hi: w.factory.hiTextures.size,
  };
});
console.log('after-state', JSON.stringify(state));
await p.screenshot({ path: 'shots-now/ab-after.png', animations: 'disabled', timeout: 120000 });

// Roll the factory back to what shipped: world-px bake scales + trilinear.
await p.evaluate(() => {
  const w = globalThis.__shelfWorld;
  w.factory.dpr = 1;
  w.factory.invalidateAll();
  globalThis.__abTrilinear = () => {
    for (const src of w.factory.sources.values()) {
      src.style.mipmapFilter = 'linear';
      src.style.update?.();
    }
  };
});
await settle();
await p.evaluate(() => {
  globalThis.__abTrilinear();
  globalThis.__shelfWorld.dirty = true;
});
await new Promise((r) => setTimeout(r, 2000));
const before = await p.evaluate(() => {
  const w = globalThis.__shelfWorld;
  return { bakeDpr: w.factory.dpr, hi: w.factory.hiTextures.size };
});
console.log('before-state', JSON.stringify(before));
await p.screenshot({ path: 'shots-now/ab-before.png', animations: 'disabled', timeout: 120000 });
console.log('done -> shots-now/ab-before.png, shots-now/ab-after.png');

await b.close();
