/**
 * shots-now/flip-raster-fontscan.mjs — what is actually inside the 569 KiB of
 * font-embed CSS that goes into every page snapshot's data URL, and how much of
 * it could a page ever draw with?
 *
 * Also answers "who pins html-to-image's one-shot property list first" by
 * tapping getStyleProperties before the app runs.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'shots-now/flip-raster-cost';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120_000);

// Who calls getStyleProperties first? Patch the module the moment it loads.
await page.addInitScript(() => {
  globalThis.__pinLog = [];
  const install = async () => {
    const util = await import('/node_modules/html-to-image/es/util.js');
    const orig = util.getStyleProperties;
    // The module namespace is frozen; wrap by redefining on the object Vite
    // hands out (dev serves it as a mutable ES module record proxy) — if that
    // fails, fall back to just recording the eventual length.
    try {
      Object.defineProperty(util, 'getStyleProperties', {
        value(options = {}) {
          globalThis.__pinLog.push({
            stack: new Error().stack.split('\n').slice(2, 6).join(' | '),
            hadList: Boolean(options && options.includeStyleProperties),
          });
          return orig(options);
        },
      });
    } catch (e) {
      globalThis.__pinLog.push({ patchFailed: String(e) });
    }
  };
  void install();
});

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
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
await page.waitForTimeout(8000);

const out = await page.evaluate(async () => {
  const sheet = document.querySelector('.nb-flip-leaf-right .nb-sheet-paper');
  const fonts = await import('/node_modules/html-to-image/es/embed-webfonts.js');
  const raster = await import('/src/flip/rasterCache.ts');
  const css = await fonts.getWebFontCSS(sheet, {});

  const blocks = css.split(/(?=@font-face)/).filter((b) => b.trim());
  const parseRange = (spec) =>
    spec.split(',').map((t) => t.trim()).map((t) => {
      const body = t.replace(/^U\+/i, '');
      if (body.includes('-')) {
        const [a, b] = body.split('-');
        return [parseInt(a, 16), parseInt(b, 16)];
      }
      if (body.includes('?')) {
        return [parseInt(body.replace(/\?/g, '0'), 16), parseInt(body.replace(/\?/g, 'F'), 16)];
      }
      const v = parseInt(body, 16);
      return [v, v];
    });

  const rows = blocks.map((b) => ({
    family: (/font-family:\s*([^;]+);/.exec(b)?.[1] ?? '?').replace(/["']/g, '').trim(),
    weight: (/font-weight:\s*([^;]+);/.exec(b)?.[1] ?? '').trim(),
    style: (/font-style:\s*([^;]+);/.exec(b)?.[1] ?? '').trim(),
    range: (/unicode-range:\s*([^;]+);/.exec(b)?.[1] ?? '').trim(),
    kib: +(b.length / 1024).toFixed(1),
  }));

  // Code points the whole document currently holds (a generous stand-in for
  // "anything a page could contain").
  const cps = new Set();
  for (const ch of document.body.textContent ?? '') cps.add(ch.codePointAt(0));
  const sheetCps = new Set();
  for (const ch of sheet.textContent ?? '') sheetCps.add(ch.codePointAt(0));

  const covers = (spec, set) => {
    if (!spec) return true;
    for (const [lo, hi] of parseRange(spec)) for (const cp of set) if (cp >= lo && cp <= hi) return true;
    return false;
  };
  let keptDocKib = 0, keptDocBlocks = 0, keptSheetKib = 0, keptSheetBlocks = 0;
  for (const r of rows) {
    if (covers(r.range, cps)) { keptDocKib += r.kib; keptDocBlocks += 1; }
    if (covers(r.range, sheetCps)) { keptSheetKib += r.kib; keptSheetBlocks += 1; }
  }

  return {
    pinnedCount: (await import('/node_modules/html-to-image/es/util.js')).getStyleProperties({}).length,
    derived: raster.snapshotStyleProperties() ?? null,
    pinLog: globalThis.__pinLog,
    totalKib: +(css.length / 1024).toFixed(1),
    blocks: rows.length,
    rows,
    docCodePoints: cps.size,
    sheetCodePoints: sheetCps.size,
    keptDocBlocks, keptDocKib: +keptDocKib.toFixed(1),
    keptSheetBlocks, keptSheetKib: +keptSheetKib.toFixed(1),
  };
});

console.log(`\n  property list pinned in this realm: ${out.pinnedCount}`);
console.log(`  snapshotStyleProperties() derives:  ${out.derived ? out.derived.length : 'null'}`);
console.log(`  getStyleProperties call log (${out.pinLog.length}):`);
for (const e of out.pinLog.slice(0, 6)) console.log('   ', JSON.stringify(e).slice(0, 400));

console.log(`\n  font-embed CSS: ${out.totalKib} KiB in ${out.blocks} @font-face blocks`);
const byFam = {};
for (const r of out.rows) {
  byFam[r.family] ??= { blocks: 0, kib: 0 };
  byFam[r.family].blocks += 1;
  byFam[r.family].kib = +(byFam[r.family].kib + r.kib).toFixed(1);
}
for (const [fam, v] of Object.entries(byFam)) console.log(`    ${fam.padEnd(24)} ${String(v.blocks).padStart(3)} blocks  ${String(v.kib).padStart(7)} KiB`);
console.log('\n  per block:');
for (const r of out.rows) console.log(`    ${r.family.padEnd(22)} w${r.weight.padEnd(9)} ${String(r.kib).padStart(6)} KiB  ${r.range.slice(0, 70)}`);
console.log(`\n  document holds ${out.docCodePoints} distinct code points, the sheet ${out.sheetCodePoints}`);
console.log(`  unicode-range filtered against the whole document: ${out.keptDocBlocks}/${out.blocks} blocks, ${out.keptDocKib} KiB`);
console.log(`  ...against just the sheet:                         ${out.keptSheetBlocks}/${out.blocks} blocks, ${out.keptSheetKib} KiB`);

writeFileSync(`${OUT}/fontscan.json`, JSON.stringify(out, null, 2));
console.log(`\n  wrote ${OUT}/fontscan.json`);
await browser.close();
