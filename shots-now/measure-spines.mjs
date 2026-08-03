/**
 * shots-now/measure-spines.mjs — how many texture pixels does a spine have
 * per device pixel it is drawn at?
 *
 * The reader said the books "feel very low resolution" on the shelf. Before
 * changing any bake scale this measures, in the RUNNING app, for every visible
 * book: the baked texture's width/height in texels, the sprite's world size,
 * the camera zoom, the renderer resolution (dpr) and therefore the sampling
 * ratio texels-per-device-pixel on both axes. < 1 means magnification, i.e.
 * blur. Also reports which bucket (lo/hi) each sprite is actually wearing.
 *
 * Usage: node shots-now/measure-spines.mjs [dpr] [zoom ...]
 */
import { chromium } from 'playwright';

const dpr = Number(process.argv[2] ?? 1);
const zooms = process.argv.slice(3).map(Number);
const ZOOMS = zooms.length > 0 ? zooms : [0.35, 0.7, 1.0, 1.6, 2.5];

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

// Make sure there is a row of books to measure.
await p
  .evaluate(async () => {
    const w = globalThis.__shelfWorld;
    const seed = globalThis.__shelfSeedBooks;
    if (!w || !seed) return;
    const have = globalThis.__shelfVisibleBooks?.() ?? [];
    if (have.length >= 8) return;
    await seed(
      ['Marginalia', 'The Long Coast', 'Quiet Machines', 'Ember & Ash',
       'Field Notes', 'The Paper Sea', 'Winterlight', 'Salt Almanac'],
      0,
    );
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 4000));

const atRest = await p.evaluate(() => {
  const w = globalThis.__shelfWorld;
  if (!w) return null;
  return {
    zoom: w.camera.zoom,
    tier: w.tier,
    res: w.app?.renderer?.resolution ?? 1,
    loPages: w.factory?.loAtlas?.pageCount ?? -1,
    hiPages: w.factory?.hiAtlas?.pageCount ?? -1,
    loTex: w.factory?.loTextures?.size ?? -1,
    hiTex: w.factory?.hiTextures?.size ?? -1,
  };
});
console.log('AT REST:', JSON.stringify(atRest));

const rows = [];
for (const zoom of ZOOMS) {
  await p.evaluate((z) => {
    const w = globalThis.__shelfWorld;
    if (!w) return;
    w.camera.zoom = z;
    w.camera.logZoomTarget = Math.log(z);
    w.dirty = true;
  }, zoom);
  await new Promise((r) => setTimeout(r, 3500));
  const sample = await p.evaluate(() => {
    const w = globalThis.__shelfWorld;
    if (!w) return null;
    const res = w.app?.renderer?.resolution ?? 1;
    const zoom = w.camera.zoom;
    const out = [];
    for (const fv of w.floors.values()) {
      for (const v of fv.visuals) {
        const tex = v.sprite.texture;
        const label = tex?.source?.label ?? '(white)';
        const tw = tex?.frame?.width ?? tex?.width ?? 0;
        const th = tex?.frame?.height ?? tex?.height ?? 0;
        out.push({
          title: v.book.title.slice(0, 22),
          bucket: label.includes('hi') ? 'hi' : label.includes('lo') ? 'lo' : 'placeholder',
          texW: Math.round(tw),
          texH: Math.round(th),
          worldW: Math.round(v.w * 10) / 10,
          worldH: Math.round(v.height * 10) / 10,
          paramsW: Math.round(v.params.w * 10) / 10,
          paramsH: Math.round((v.params.height ?? 0) * 10) / 10,
        });
      }
    }
    return {
      zoom,
      res,
      tier: w.tier,
      loPages: w.factory?.loAtlas?.pageCount ?? -1,
      hiPages: w.factory?.hiAtlas?.pageCount ?? -1,
      books: out,
    };
  });
  if (sample) rows.push(sample);
}

console.log(`\n=== deviceScaleFactor ${dpr} ===`);
for (const s of rows) {
  console.log(
    `\nzoom ${s.zoom.toFixed(2)}  tier ${s.tier}  renderer.resolution ${s.res}` +
      `   (device px per world px = ${(s.zoom * s.res).toFixed(2)})` +
      `   atlas pages lo=${s.loPages} hi=${s.hiPages}`,
  );
  const seen = s.books.slice(0, 8);
  for (const bk of seen) {
    const devW = bk.worldW * s.zoom * s.res;
    const devH = bk.worldH * s.zoom * s.res;
    const rx = bk.texW / devW;
    const ry = bk.texH / devH;
    const stretch = bk.texH > 0 ? bk.worldH / bk.worldW / (bk.texH / bk.texW) : 0;
    console.log(
      `  ${bk.title.padEnd(22)} ${bk.bucket.padEnd(11)} tex ${String(bk.texW).padStart(4)}x${String(
        bk.texH,
      ).padStart(4)}  world ${String(bk.worldW).padStart(5)}x${String(bk.worldH).padStart(5)}` +
        `  device ${devW.toFixed(0).padStart(4)}x${devH.toFixed(0).padStart(4)}` +
        `  texels/devpx ${rx.toFixed(2)}x / ${ry.toFixed(2)}y  aspect-stretch ${stretch.toFixed(2)}` +
        `  paramsH ${bk.paramsH}`,
    );
  }
}

await b.close();
