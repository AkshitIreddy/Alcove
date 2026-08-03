/**
 * shots-now/atlas-budget.mjs — what a raised bake scale actually costs.
 *
 * Fills six floors, parks the camera at the bottom of LOD tier 0 (the zoom
 * that puts the MOST books on hi-res at once) and reports how full the spine
 * atlas pages are. Arithmetic says a page holds N spines; shelf packing says
 * otherwise, and the difference is whether a pan re-bakes the whole shelf.
 *
 * Usage: node shots-now/atlas-budget.mjs [dpr] [booksPerFloor] [floors]
 */
import { chromium } from 'playwright';

const dpr = Number(process.argv[2] ?? 2);
const perFloor = Number(process.argv[3] ?? 20);
const floors = Number(process.argv[4] ?? 6);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: dpr });
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 9000));
for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
}

await p.evaluate(
  async ([n, f]) => {
    const seed = globalThis.__shelfSeedBooks;
    if (!seed) return;
    for (let floor = 0; floor < f; floor++) {
      const titles = [];
      for (let i = 0; i < n; i++) titles.push(`Volume ${floor}-${i}`);
      await seed(titles, floor);
    }
  },
  [perFloor, floors],
);
await new Promise((r) => setTimeout(r, 6000));

// Bottom of tier 0 (0.7 + hysteresis) — the most books on hi-res at once.
await p.evaluate(() => {
  const w = globalThis.__shelfWorld;
  w.camera.zoom = 0.74;
  w.camera.logZoomTarget = Math.log(0.74);
  w.camera.y = 0;
  w.dirty = true;
});

let last = null;
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  last = await p.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const f = w.factory;
    const visible = [...w.floors.values()].reduce((n, fv) => n + fv.visuals.length, 0);
    const wearing = { hi: 0, lo: 0, placeholder: 0 };
    for (const fv of w.floors.values()) {
      for (const v of fv.visuals) {
        const label = v.sprite.texture?.source?.label ?? '';
        if (label.includes('hi')) wearing.hi++;
        else if (label.includes('lo')) wearing.lo++;
        else wearing.placeholder++;
      }
    }
    return {
      zoom: Number(w.camera.zoom.toFixed(2)),
      tier: w.tier,
      res: w.app.renderer.resolution,
      dprBake: f.dpr,
      visible,
      wearing,
      queued: f.queue.size,
      inFlight: f.inFlight.size,
      loTex: f.loTextures.size,
      hiTex: f.hiTextures.size,
      lo: f.loAtlas.usage(),
      hi: f.hiAtlas.usage(),
    };
  });
  if (last.queued === 0 && last.inFlight === 0) break;
}

const fmt = (pages) =>
  pages
    .map((u) => `page ${u.id}: ${u.rects} rects, ${(u.fill * 100).toFixed(1)}% full`)
    .join('\n      ');
console.log(`\nbake dpr ${last.dprBake} (renderer ${last.res})  zoom ${last.zoom} tier ${last.tier}`);
console.log(`visible sprites ${last.visible}  wearing ${JSON.stringify(last.wearing)}`);
console.log(`lo textures ${last.loTex}  hi textures ${last.hiTex}`);
console.log(`  lo: ${last.lo.length} pages\n      ${fmt(last.lo)}`);
console.log(`  hi: ${last.hi.length} pages\n      ${fmt(last.hi)}`);
const perPage = (u) => (u.rects > 0 ? u.rects / u.fill : 0);
const cap = (arr) =>
  arr.length === 0 ? 0 : Math.round(arr.reduce((s, u) => s + perPage(u), 0) / arr.length);
console.log(`  extrapolated spines per full page — lo ${cap(last.lo)}  hi ${cap(last.hi)}`);
console.log(
  `  canvas memory: lo ${(last.lo.length * 16.78).toFixed(1)}MB  hi ${(last.hi.length * 16.78).toFixed(1)}MB`,
);

await b.close();
