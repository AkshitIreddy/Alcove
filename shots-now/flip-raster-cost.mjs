/**
 * shots-now/flip-raster-cost.mjs — what a page snapshot costs, measured on the
 * running app without lying to itself.
 *
 * WHY NOT flip-raster-perf.mjs — that probe calls html-to-image's
 * `getStyleProperties({})` before it times anything. That function memoizes the
 * FIRST list it is handed for the lifetime of the JS realm (`styleProps` in its
 * util.js), so every capture it then timed — including the "shipped
 * PageRasterCache" one — ran on the full 620-property list no matter what
 * rasterCache.ts passed. Its before/after numbers are therefore both "before".
 *
 * This probe pins the list ON PURPOSE, first thing in the realm, and says which
 * list it pinned. `--variant=app` pins nothing and reports whichever list the
 * app itself ended up with, which is the only number that describes what a
 * reader gets.
 *
 * Usage:
 *   node shots-now/flip-raster-cost.mjs --variant=app     [--label=…] [--reps=7]
 *   node shots-now/flip-raster-cost.mjs --variant=full
 *   node shots-now/flip-raster-cost.mjs --variant=narrow
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const VARIANT = opt('variant', 'app');
const LABEL = opt('label', VARIANT);
const REPS = Number(opt('reps', '7'));
const OUT = 'shots-now/flip-raster-cost';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1500, height: 950 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(120_000);
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 200));
});

/* CSSOM tap, installed before any app code runs. Counted, never timed — a
   clock around 100k calls distorts the thing it measures. */
await page.addInitScript(() => {
  const proto = CSSStyleDeclaration.prototype;
  const counts = { setProperty: 0, getPropertyValue: 0, getPropertyPriority: 0, gcs: 0, gcsPseudo: 0 };
  for (const name of ['setProperty', 'getPropertyValue', 'getPropertyPriority']) {
    const orig = proto[name];
    proto[name] = function (...rest) {
      counts[name] += 1;
      return orig.apply(this, rest);
    };
  }
  const origGCS = window.getComputedStyle;
  window.getComputedStyle = function (el, pseudo) {
    if (pseudo) counts.gcsPseudo += 1;
    else counts.gcs += 1;
    return origGCS.call(this, el, pseudo);
  };
  globalThis.__cssTap = {
    reset() { for (const k of Object.keys(counts)) counts[k] = 0; },
    read: () => ({ ...counts }),
  };
});

/* Pin the property list before the app's first capture, when asked. Runs as an
   init script so it beats every capture site in the app, not just the ones we
   know about. */
if (VARIANT === 'full' || VARIANT === 'narrow') {
  await page.addInitScript((variant) => {
    globalThis.__pinList = async () => {
      const util = await import('/node_modules/html-to-image/es/util.js');
      if (variant === 'full') return util.getStyleProperties({}).length;
      const raster = await import('/src/flip/rasterCache.ts');
      const list = raster.snapshotStyleProperties();
      if (list === undefined) throw new Error('snapshotStyleProperties() bailed');
      return util.getStyleProperties({ includeStyleProperties: list }).length;
    };
  }, VARIANT);
}

async function openBook() {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  if (VARIANT === 'full' || VARIANT === 'narrow') {
    // Stylesheets are all in by now (the world is up), so the derivation is
    // complete — and no capture has run yet.
    const pinned = await page.evaluate(() => globalThis.__pinList());
    console.log(`  pinned ${VARIANT} list: ${pinned} properties`);
  }
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
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
    await page.locator('[data-testid="pulled-book-hand"]').waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {});
    const read = page.getByRole('button', { name: 'read it' });
    if ((await read.count()) > 0) await read.click().catch(() => {});
    await page.locator('.nb-flip-surface').waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {});
  }
  await page.waitForSelector('.nb-flip-surface', { timeout: 30_000 });
  await page.waitForSelector('.nb-prose p', { timeout: 30_000 });
}

let opened = false;
for (let attempt = 0; attempt < 4 && !opened; attempt++) {
  try { await openBook(); opened = true; }
  catch (error) {
    console.log(`  open attempt ${attempt + 1} failed: ${String(error).split('\n')[0]}`);
    await page.waitForTimeout(2000);
  }
}
if (!opened) throw new Error('could not open the seeded book');

// Let the app's own idle captures land so they are not racing the clock.
await page.waitForTimeout(8000);

const result = await page.evaluate(async (reps) => {
  const sheet = document.querySelector('.nb-flip-leaf-right .nb-sheet-paper');
  if (!sheet) throw new Error('no .nb-sheet-paper under the right leaf');

  const util = await import('/node_modules/html-to-image/es/util.js');
  const raster = await import('/src/flip/rasterCache.ts');

  // Whatever is pinned by now IS what the app is using. Asking with {} cannot
  // change it once set, so this read is safe here (after every capture site
  // has had its chance) and would not have been safe before.
  const pinnedList = util.getStyleProperties({});
  const derived = raster.snapshotStyleProperties();

  const now = () => performance.now();
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  /* ---- end to end: the shipped path on the live mounted sheet ---- */
  const cache = new raster.PageRasterCache({ getElement: () => sheet, capacity: 2, pixelRatio: 2 });
  const shipped = [];
  for (let i = 0; i < reps; i++) {
    cache.invalidate('probe');
    globalThis.__cssTap.reset();
    const s = now();
    await cache.ensure('probe');
    shipped.push({ ms: +(now() - s).toFixed(1), css: globalThis.__cssTap.read() });
  }
  cache.dispose();

  /* ---- phase breakdown, same list, same element ---- */
  const cloneMod = await import('/node_modules/html-to-image/es/clone-node.js');
  const fontsMod = await import('/node_modules/html-to-image/es/embed-webfonts.js');
  const imagesMod = await import('/node_modules/html-to-image/es/embed-images.js');
  const styleMod = await import('/node_modules/html-to-image/es/apply-style.js');
  const flipMod = await import('/src/flip/svgSnapshot.ts');

  const TRANSPARENT_PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABijPjAAAAAABJRU5ErkJggg==';
  const EXCLUDE = '.nb-drag-handle, .nb-style-switcher, .nb-page-full-hint, [data-snapshot-hide]';
  const filter = (node) => {
    if (node instanceof HTMLImageElement && (node.getAttribute('src') ?? '') === '') return false;
    return typeof node.matches !== 'function' || !node.matches(EXCLUDE);
  };

  // Whatever the shipped module builds today — the raw html-to-image CSS, or a
  // trimmed one if rasterCache has grown a builder. Both are reported so a
  // trim can never be claimed without the raw number beside it.
  const rawFontCss = await fontsMod.getWebFontCSS(sheet, {});
  const tFont = now();
  const fontEmbedCSS =
    typeof raster.snapshotFontEmbedCSS === 'function'
      ? await raster.snapshotFontEmbedCSS(sheet)
      : rawFontCss;
  const fontCssMs = now() - tFont;

  const options = {
    pixelRatio: 2,
    backgroundColor: '#f7f1e3',
    fontEmbedCSS,
    imagePlaceholder: TRANSPARENT_PX,
    filter,
  };

  const phases = [];
  for (let i = 0; i < reps; i++) {
    const restoreSvg = flipMod.inlineSvgStyles(sheet);
    const tInline = now();

    const a = now();
    const clone = await cloneMod.cloneNode(sheet, options, true);
    const cloneMs = now() - a;

    const b = now();
    await fontsMod.embedWebFonts(clone, options);
    const fontsMs = now() - b;

    const c = now();
    await imagesMod.embedImages(clone, options);
    const imagesMs = now() - c;

    styleMod.applyStyle(clone, options);

    const d = now();
    const width = sheet.clientWidth;
    const height = sheet.clientHeight;
    const dataUrl = await util.nodeToDataURL(clone, width, height);
    const serializeMs = now() - d;

    const e = now();
    const img = await util.createImage(dataUrl);
    const decodeMs = now() - e;

    const f = now();
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f7f1e3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const drawMs = now() - f;

    const g = now();
    const bitmap = await createImageBitmap(canvas);
    const bitmapMs = now() - g;
    bitmap.close();
    restoreSvg();

    phases.push({
      inlineSvgMs: +(a - tInline).toFixed(1),
      cloneMs: +cloneMs.toFixed(1),
      fontsMs: +fontsMs.toFixed(1),
      imagesMs: +imagesMs.toFixed(1),
      serializeMs: +serializeMs.toFixed(1),
      decodeMs: +decodeMs.toFixed(1),
      drawMs: +drawMs.toFixed(1),
      bitmapMs: +bitmapMs.toFixed(1),
      totalMs: +(now() - tInline).toFixed(1),
      dataUrlChars: dataUrl.length,
    });
  }

  const pick = (k) => median(phases.map((r) => r[k]));
  return {
    elements: sheet.querySelectorAll('*').length,
    svgDescendants: [...sheet.querySelectorAll('svg')].reduce((n, s) => n + s.querySelectorAll('*').length, 0),
    pinnedCount: pinnedList.length,
    derivedCount: derived === undefined ? null : derived.length,
    fontCssMs: +fontCssMs.toFixed(1),
    fontCssChars: fontEmbedCSS.length,
    rawFontCssChars: rawFontCss.length,
    shipped,
    shippedMedianMs: median(shipped.map((r) => r.ms)),
    phases,
    phaseMedian: Object.fromEntries(
      ['inlineSvgMs', 'cloneMs', 'fontsMs', 'imagesMs', 'serializeMs', 'decodeMs', 'drawMs', 'bitmapMs', 'totalMs', 'dataUrlChars'].map((k) => [k, pick(k)]),
    ),
  };
}, REPS);

const m = result.phaseMedian;
console.log(`\n  === ${LABEL} ===`);
console.log(`  sheet: ${result.elements} elements (${result.svgDescendants} inside <svg>)`);
console.log(`  property list IN USE: ${result.pinnedCount}   (snapshotStyleProperties() would give ${result.derivedCount})`);
console.log(`  font-embed CSS: ${(result.fontCssChars / 1024).toFixed(1)} KiB used, ${(result.rawFontCssChars / 1024).toFixed(1)} KiB raw, built in ${result.fontCssMs}ms`);
console.log(`\n  shipped PageRasterCache.ensure(): ${result.shippedMedianMs} ms median`);
console.log(`    reps: ${result.shipped.map((r) => r.ms).join(', ')}`);
const c = result.shipped[Math.floor(result.shipped.length / 2)].css;
console.log(`    CSSOM: setProperty ${c.setProperty}, getPropertyValue ${c.getPropertyValue}, getPropertyPriority ${c.getPropertyPriority}, getComputedStyle ${c.gcs} (+${c.gcsPseudo} pseudo)`);
console.log('\n  phase breakdown (median), ms:');
for (const k of ['inlineSvgMs', 'cloneMs', 'fontsMs', 'imagesMs', 'serializeMs', 'decodeMs', 'drawMs', 'bitmapMs']) {
  const pct = ((m[k] / m.totalMs) * 100).toFixed(1).padStart(5);
  console.log(`    ${k.replace(/Ms$/, '').padEnd(12)} ${String(m[k]).padStart(8)}  ${pct}%`);
}
console.log(`    ${'TOTAL'.padEnd(12)} ${String(m.totalMs).padStart(8)}`);
console.log(`    data URL: ${(m.dataUrlChars / 1024).toFixed(0)} KiB`);

const drift = Math.abs(result.shippedMedianMs - m.totalMs) / result.shippedMedianMs;
console.log(`\n  phase-sum vs shipped: ${m.totalMs} vs ${result.shippedMedianMs} ms (${(drift * 100).toFixed(0)}% apart)` +
  (drift > 0.35 ? '  <-- breakdown does not model the shipped path; do not trust it' : ''));

writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(result, null, 2));
console.log(`\n  wrote ${OUT}/${LABEL}.json`);
await browser.close();
