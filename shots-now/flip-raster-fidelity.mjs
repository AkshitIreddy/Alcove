/**
 * shots-now/flip-raster-fidelity.mjs — does the narrowed property list change
 * a single pixel of a page snapshot?
 *
 * rasterCache.ts stopped copying all 620 computed properties onto every cloned
 * node and now copies only the ones the app's own CSS can reach (plus every
 * inherited property). The whole claim is that this is invisible, so this
 * probe rasterizes the SAME live page twice — once with html-to-image's full
 * list, once with the narrowed one — and diffs the two bitmaps.
 *
 * WHY TWO PAGES — html-to-image caches the first property list it is handed
 * for the lifetime of the JS realm (`styleProps` in its util.ts), so the two
 * variants cannot share one page. Two `browser.newPage()`s in the same browser
 * give two realms, the same fonts and the same dev server: everything that
 * could make the rasters differ is held equal except the list under test.
 *
 * The diff is done in the browser (canvas is the only PNG decoder available)
 * and reported as: exact-equal pixel count, worst per-channel delta, and the
 * bounding box of anything that moved. Both PNGs are written out so the claim
 * can also be looked at.
 *
 * Usage: node shots-now/flip-raster-fidelity.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'shots-now/flip-raster-perf';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

async function openBook(page) {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    polling: 400,
  });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  for (let i = 0; i < 4; i++) {
    const skip = page.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) break;
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await page.locator('.nb-flip-surface').count()) > 0) break;
    await page.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    await page
      .locator('[data-testid="pulled-book-hand"]')
      .waitFor({ state: 'visible', timeout: 25_000 })
      .catch(() => {});
    const read = page.getByRole('button', { name: 'read it' });
    if ((await read.count()) > 0) await read.click().catch(() => {});
    await page
      .locator('.nb-flip-surface')
      .waitFor({ state: 'visible', timeout: 25_000 })
      .catch(() => {});
  }
  await page.waitForSelector('.nb-flip-surface', { timeout: 30_000 });
  await page.waitForSelector('.nb-prose p', { timeout: 30_000 });
  await page.waitForTimeout(6000);
}

/** Rasterize the mounted right-hand sheet exactly as rasterCache does. */
async function rasterize(page, mode) {
  return page.evaluate(async (variant) => {
    const sheet = document.querySelector('.nb-flip-leaf-right .nb-sheet-paper');
    if (!sheet) throw new Error('no .nb-sheet-paper under the right leaf');

    const clone = await import('/node_modules/html-to-image/es/clone-node.js');
    const fonts = await import('/node_modules/html-to-image/es/embed-webfonts.js');
    const images = await import('/node_modules/html-to-image/es/embed-images.js');
    const applyStyle = await import('/node_modules/html-to-image/es/apply-style.js');
    const util = await import('/node_modules/html-to-image/es/util.js');
    const svgSnapshot = await import('/src/flip/svgSnapshot.ts');
    const rasterCache = await import('/src/flip/rasterCache.ts');

    const includeStyleProperties =
      variant === 'narrow'
        ? rasterCache.snapshotStyleProperties()
        : Array.from(getComputedStyle(document.documentElement));
    if (variant === 'narrow' && includeStyleProperties === undefined) {
      throw new Error('snapshotStyleProperties() bailed out — nothing to compare');
    }

    const TRANSPARENT_PX =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABijPjAAAAAABJRU5ErkJggg==';
    const EXCLUDE =
      '.nb-drag-handle, .nb-style-switcher, .nb-page-full-hint, [data-snapshot-hide]';
    const options = {
      pixelRatio: 2,
      backgroundColor: '#f7f1e3',
      fontEmbedCSS: await fonts.getWebFontCSS(sheet, {}),
      imagePlaceholder: TRANSPARENT_PX,
      filter: (node) => {
        if (node instanceof HTMLImageElement && (node.getAttribute('src') ?? '') === '')
          return false;
        return typeof node.matches !== 'function' || !node.matches(EXCLUDE);
      },
      includeStyleProperties,
    };

    sheet.classList.add('snapshotting');
    const restoreSvg = svgSnapshot.inlineSvgStyles(sheet);
    let dataUrl;
    try {
      const width = sheet.clientWidth;
      const height = sheet.clientHeight;
      const cloned = await clone.cloneNode(sheet, options, true);
      await fonts.embedWebFonts(cloned, options);
      await images.embedImages(cloned, options);
      applyStyle.applyStyle(cloned, options);
      const svgUrl = await util.nodeToDataURL(cloned, width, height);
      const img = await util.createImage(svgUrl);
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f7f1e3';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/png');
    } finally {
      restoreSvg();
      sheet.classList.remove('snapshotting');
    }
    return {
      dataUrl,
      propertyCount: includeStyleProperties.length,
      elements: sheet.querySelectorAll('*').length,
      text: (sheet.textContent ?? '').slice(0, 80).replace(/\s+/g, ' ').trim(),
    };
  }, mode);
}

const pageA = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
pageA.setDefaultTimeout(120_000);
await openBook(pageA);
const full = await rasterize(pageA, 'full');
console.log(`  full list:    ${full.propertyCount} properties, ${full.elements} elements`);
console.log(`  page text:    "${full.text}"`);

const pageB = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
pageB.setDefaultTimeout(120_000);
await openBook(pageB);
const narrow = await rasterize(pageB, 'narrow');
console.log(`  narrow list:  ${narrow.propertyCount} properties, ${narrow.elements} elements`);
console.log(`  page text:    "${narrow.text}"`);

if (full.text !== narrow.text) {
  console.log('\n  REFUSING TO COMPARE: the two loads opened different content.');
  await browser.close();
  process.exit(1);
}

const b64 = (u) => u.replace(/^data:image\/png;base64,/, '');
writeFileSync(`${OUT}/fidelity-full.png`, Buffer.from(b64(full.dataUrl), 'base64'));
writeFileSync(`${OUT}/fidelity-narrow.png`, Buffer.from(b64(narrow.dataUrl), 'base64'));

const diff = await pageB.evaluate(async ([a, b]) => {
  const decode = async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return { data: g.getImageData(0, 0, c.width, c.height), w: c.width, h: c.height };
  };
  const A = await decode(a);
  const B = await decode(b);
  if (A.w !== B.w || A.h !== B.h) return { sizeMismatch: [A.w, A.h, B.w, B.h] };
  const pa = A.data.data;
  const pb = B.data.data;
  let differing = 0;
  let worst = 0;
  let minX = A.w, minY = A.h, maxX = -1, maxY = -1;
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = A.w;
  diffCanvas.height = A.h;
  const dg = diffCanvas.getContext('2d');
  const out = dg.createImageData(A.w, A.h);
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(
      Math.abs(pa[i] - pb[i]),
      Math.abs(pa[i + 1] - pb[i + 1]),
      Math.abs(pa[i + 2] - pb[i + 2]),
      Math.abs(pa[i + 3] - pb[i + 3]),
    );
    if (d > 0) {
      differing += 1;
      if (d > worst) worst = d;
      const px = (i / 4) % A.w;
      const py = Math.floor(i / 4 / A.w);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    // amplified diff image: any change at all reads as a loud red
    out.data[i] = d > 0 ? 255 : 250;
    out.data[i + 1] = d > 0 ? Math.max(0, 200 - d * 8) : 245;
    out.data[i + 2] = d > 0 ? Math.max(0, 200 - d * 8) : 235;
    out.data[i + 3] = 255;
  }
  dg.putImageData(out, 0, 0);
  return {
    width: A.w,
    height: A.h,
    total: pa.length / 4,
    differing,
    worst,
    bbox: maxX < 0 ? null : [minX, minY, maxX, maxY],
    diffUrl: diffCanvas.toDataURL('image/png'),
  };
}, [full.dataUrl, narrow.dataUrl]);

if (diff.sizeMismatch) {
  console.log(`\n  FAIL: bitmaps differ in size ${JSON.stringify(diff.sizeMismatch)}`);
  await browser.close();
  process.exit(1);
}
writeFileSync(`${OUT}/fidelity-diff.png`, Buffer.from(b64(diff.diffUrl), 'base64'));

const pct = ((diff.differing / diff.total) * 100).toFixed(4);
console.log(`\n  ${diff.width}x${diff.height} = ${diff.total} pixels`);
console.log(`  differing: ${diff.differing} (${pct}%)  worst channel delta: ${diff.worst}`);
console.log(`  bbox of change: ${diff.bbox ? JSON.stringify(diff.bbox) : 'none'}`);
console.log(`  wrote ${OUT}/fidelity-{full,narrow,diff}.png`);

// A run where both rasters came back blank would "pass" while proving nothing.
const inkCheck = await pageB.evaluate(async (url) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 140) dark += 1;
  }
  return { dark, total: px.length / 4 };
}, narrow.dataUrl);
const inkPct = (inkCheck.dark / inkCheck.total) * 100;
console.log(`  ink coverage in the narrow raster: ${inkPct.toFixed(2)}% dark pixels`);

const blind = inkPct < 0.15;
if (blind) console.log('\n  REFUSING TO PASS: the raster is essentially blank — nothing was compared.');
const ok = diff.differing === 0 && !blind;
console.log(
  ok
    ? '\n  identical: narrowing the property list changed no pixel of the snapshot.'
    : `\n  DIFFERENT: ${diff.differing} pixels moved — look at ${OUT}/fidelity-diff.png`,
);

await browser.close();
process.exit(ok ? 0 : 1);
