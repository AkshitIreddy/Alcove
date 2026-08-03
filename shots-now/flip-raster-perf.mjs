/**
 * shots-now/flip-raster-perf.mjs — where do the 300-400ms of a page snapshot
 * actually go?
 *
 * The TODO claims "nearly all of it is html-to-image's cloneCSSStyle copying
 * every computed property of every node". That is a claim about a number, so
 * this measures it rather than believing it.
 *
 * HOW IT MEASURES — it does not guess at phases. html-to-image's toCanvas is
 * five steps (cloneNode → embedWebFonts → embedImages → nodeToDataURL →
 * createImage → drawImage) and every one of them is a separate ES module on
 * disk, so the probe imports those modules straight off the dev server and
 * re-runs the orchestration itself with a clock between each step. The numbers
 * below are therefore the real functions on the real live page element, not a
 * model of them.
 *
 * It ALSO times the shipped path (src/flip/rasterCache.ts's own capture, via a
 * throwaway PageRasterCache pointed at the same element) so the phase sum can
 * be checked against the end-to-end cost. If those two disagree badly the
 * breakdown is lying and the run says so.
 *
 * CSSOM traffic is counted (not timed — a clock around 100k calls distorts the
 * thing it measures) by tapping CSSStyleDeclaration.prototype before any app
 * code runs.
 *
 * Usage: node shots-now/flip-raster-perf.mjs [--url=http://localhost:1420]
 *                                            [--label=before]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const LABEL = opt('label', 'run');
const OUT = 'shots-now/flip-raster-perf';
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

/* --------------------------------------------------- CSSOM tap (pre-app) */

await page.addInitScript(() => {
  const proto = CSSStyleDeclaration.prototype;
  const counts = {
    setProperty: 0,
    getPropertyValue: 0,
    getPropertyPriority: 0,
    getComputedStyle: 0,
    getComputedStylePseudo: 0,
  };
  for (const name of ['setProperty', 'getPropertyValue', 'getPropertyPriority']) {
    const orig = proto[name];
    proto[name] = function (...rest) {
      counts[name] += 1;
      return orig.apply(this, rest);
    };
  }
  const origGCS = window.getComputedStyle;
  window.getComputedStyle = function (el, pseudo) {
    if (pseudo) counts.getComputedStylePseudo += 1;
    else counts.getComputedStyle += 1;
    return origGCS.call(this, el, pseudo);
  };
  globalThis.__cssTap = {
    reset() {
      for (const k of Object.keys(counts)) counts[k] = 0;
    },
    read: () => ({ ...counts }),
  };
});

/* ------------------------------------------------------------ open a book */

/** Same recipe as shots-now/flip-band.mjs; the dev server is shared, so retry. */
async function openBook() {
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
}

let opened = false;
for (let attempt = 0; attempt < 4 && !opened; attempt++) {
  try {
    await openBook();
    opened = true;
  } catch (error) {
    console.log(`  open attempt ${attempt + 1} failed: ${String(error).split('\n')[0]}`);
    await page.waitForTimeout(2000);
  }
}
if (!opened) throw new Error('could not open the seeded book');

// Let the app's own idle captures finish so they are not racing the probe.
await page.waitForTimeout(8000);

/* ---------------------------------------------------------- measurements */

const REPS = Number(opt('reps', '5'));

const result = await page.evaluate(async (reps) => {
  const sheet = document.querySelector('.nb-flip-leaf-right .nb-sheet-paper');
  if (!sheet) throw new Error('no .nb-sheet-paper under the right leaf');

  const elements = sheet.querySelectorAll('*').length;
  const allNodes = (() => {
    let n = 0;
    const walk = document.createTreeWalker(sheet, NodeFilter.SHOW_ALL);
    while (walk.nextNode()) n += 1;
    return n;
  })();
  const svgDescendants = (() => {
    let n = 0;
    for (const svg of sheet.querySelectorAll('svg')) n += svg.querySelectorAll('*').length;
    return n;
  })();

  const now = () => performance.now();
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  /* --- phase breakdown: html-to-image's own modules, one clock per step --- */

  const cloneMod = await import('/node_modules/html-to-image/es/clone-node.js');
  const fontsMod = await import('/node_modules/html-to-image/es/embed-webfonts.js');
  const imagesMod = await import('/node_modules/html-to-image/es/embed-images.js');
  const styleMod = await import('/node_modules/html-to-image/es/apply-style.js');
  const utilMod = await import('/node_modules/html-to-image/es/util.js');
  const flipMod = await import('/src/flip/svgSnapshot.ts');

  const TRANSPARENT_PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABijPjAAAAAABJRU1ErkJggg==';
  const EXCLUDE = '.nb-drag-handle, .nb-style-switcher, .nb-page-full-hint, [data-snapshot-hide]';
  const filter = (node) => {
    if (node instanceof HTMLImageElement && (node.getAttribute('src') ?? '') === '') return false;
    return typeof node.matches !== 'function' || !node.matches(EXCLUDE);
  };

  const t0 = now();
  const fontEmbedCSS = await fontsMod.getWebFontCSS(sheet, {});
  const fontCssMs = now() - t0;

  const baseOptions = {
    pixelRatio: 2,
    backgroundColor: '#f7f1e3',
    fontEmbedCSS,
    imagePlaceholder: TRANSPARENT_PX,
    filter,
  };

  // What the default property list actually is on this engine.
  const defaultProps = utilMod.getStyleProperties({});

  const phases = [];
  for (let i = 0; i < reps; i++) {
    globalThis.__cssTap.reset();
    const restoreSvg = flipMod.inlineSvgStyles(sheet);
    const tInline = now();

    const a = now();
    const clone = await cloneMod.cloneNode(sheet, baseOptions, true);
    const cloneMs = now() - a;

    const b = now();
    await fontsMod.embedWebFonts(clone, baseOptions);
    const fontsMs = now() - b;

    const c = now();
    await imagesMod.embedImages(clone, baseOptions);
    const imagesMs = now() - c;

    styleMod.applyStyle(clone, baseOptions);

    const d = now();
    const width = sheet.clientWidth;
    const height = sheet.clientHeight;
    const dataUrl = await utilMod.nodeToDataURL(clone, width, height);
    const serializeMs = now() - d;

    const e = now();
    const img = await utilMod.createImage(dataUrl);
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
    const css = globalThis.__cssTap.read();
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
      css,
    });
  }

  /* --------- end-to-end: the shipped path, same element, same options ---- */

  const rasterMod = await import('/src/flip/rasterCache.ts');
  const cache = new rasterMod.PageRasterCache({
    getElement: () => sheet,
    capacity: 2,
    pixelRatio: 2,
  });
  const shipped = [];
  for (let i = 0; i < reps; i++) {
    cache.invalidate('probe');
    globalThis.__cssTap.reset();
    const s = now();
    await cache.ensure('probe');
    shipped.push({ ms: +(now() - s).toFixed(1), css: globalThis.__cssTap.read() });
  }
  cache.dispose();

  const pick = (key, rows) => median(rows.map((r) => r[key]));
  return {
    elements,
    allNodes,
    svgDescendants,
    fontCssMs: +fontCssMs.toFixed(1),
    fontCssChars: fontEmbedCSS.length,
    defaultPropCount: defaultProps.length,
    defaultProps,
    phases,
    phaseMedian: Object.fromEntries(
      [
        'inlineSvgMs',
        'cloneMs',
        'fontsMs',
        'imagesMs',
        'serializeMs',
        'decodeMs',
        'drawMs',
        'bitmapMs',
        'totalMs',
        'dataUrlChars',
      ].map((k) => [k, pick(k, phases)]),
    ),
    shipped,
    shippedMedianMs: median(shipped.map((r) => r.ms)),
  };
}, REPS);

const m = result.phaseMedian;
console.log(`\n  === ${LABEL} ===`);
console.log(
  `  sheet: ${result.elements} elements (${result.allNodes} nodes total, ` +
    `${result.svgDescendants} inside <svg>)`,
);
console.log(
  `  computed-style longhands on this engine: ${result.defaultPropCount}` +
    `   font-embed CSS: ${(result.fontCssChars / 1024).toFixed(1)} KiB ` +
    `(built once in ${result.fontCssMs}ms)`,
);
console.log('\n  phase breakdown (median of ' + REPS + '), ms:');
for (const k of [
  'inlineSvgMs',
  'cloneMs',
  'fontsMs',
  'imagesMs',
  'serializeMs',
  'decodeMs',
  'drawMs',
  'bitmapMs',
]) {
  const pct = ((m[k] / m.totalMs) * 100).toFixed(1).padStart(5);
  console.log(`    ${k.replace(/Ms$/, '').padEnd(12)} ${String(m[k]).padStart(8)}  ${pct}%`);
}
console.log(`    ${'TOTAL'.padEnd(12)} ${String(m.totalMs).padStart(8)}`);
console.log(`    data URL: ${(m.dataUrlChars / 1024).toFixed(0)} KiB`);

const cssMed = result.phases[Math.floor(result.phases.length / 2)].css;
console.log('\n  CSSOM traffic per capture (phase run):');
for (const [k, v] of Object.entries(cssMed)) {
  console.log(`    ${k.padEnd(24)} ${String(v).padStart(9)}`);
}

console.log(`\n  shipped PageRasterCache.ensure(): ${result.shippedMedianMs} ms median`);
console.log(`    all reps: ${result.shipped.map((r) => r.ms).join(', ')}`);
const shippedCss = result.shipped[Math.floor(result.shipped.length / 2)].css;
console.log(
  `    setProperty ${shippedCss.setProperty}, getPropertyValue ${shippedCss.getPropertyValue}, ` +
    `getPropertyPriority ${shippedCss.getPropertyPriority}, ` +
    `getComputedStyle ${shippedCss.getComputedStyle} (+${shippedCss.getComputedStylePseudo} pseudo)`,
);

// The breakdown is only worth reading if it lands near the shipped cost.
const drift = Math.abs(result.shippedMedianMs - m.totalMs) / result.shippedMedianMs;
console.log(
  `\n  phase-sum vs shipped: ${m.totalMs} vs ${result.shippedMedianMs} ms ` +
    `(${(drift * 100).toFixed(0)}% apart)` +
    (drift > 0.35 ? '  <-- breakdown does not model the shipped path; do not trust it' : ''),
);

writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(result, null, 2));
console.log(`\n  wrote ${OUT}/${LABEL}.json`);

await browser.close();
