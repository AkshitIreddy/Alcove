/**
 * Caption-free release board for the authored spine reset.
 *
 * It uses the existing :1420 listener, mutates no app data, and renders every
 * finished preset directly through `drawBookSpine` at true shelf width (30px)
 * and a native 2x detail width (60px).  The JSON is the only cell-to-id map so
 * visual review happens before names can bias it.
 *
 * Usage:
 *   node shots-now/book-spine-reset-board.mjs --url=http://localhost:1420
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const url = hit?.slice('--url='.length) || 'http://localhost:1420';
const outDir = 'shots-now/out';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1900, height: 1200 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (error) => console.error('[pageerror]', error.message));
await page.goto(`${url}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => import('/src/art/bookDesign.ts').then(() => true, () => false),
  null,
  { polling: 300 },
);

const report = await page.evaluate(async () => {
  const design = await import('/src/art/bookDesign.ts');
  const flat = await import('/src/art/flat.ts');
  const ground = flat.FLAT.recess;
  document.body.innerHTML = '';
  document.body.style.cssText = `margin:0;background:${ground}`;

  const seedFor = (id, offset) => {
    let hash = (0x811c9dc5 ^ offset) >>> 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0;
    }
    return hash;
  };

  const draw = (preset, index, scale) => {
    const width = 30 * scale;
    const height = 164 * scale;
    const pad = 4 * scale;
    const canvas = document.createElement('canvas');
    canvas.width = width + pad * 2;
    canvas.height = height + pad * 2;
    const resolved = design.resolveBookDesign({
      seed: seedFor(preset.id, index),
      preset: preset.id,
      cloth: '#8b3c4c',
      accent: '#d1a84f',
      tooling: '#e8c75f',
      emblem: '#f1d57a',
      gilt: preset.gilt,
      bands: 0,
      headTail: null,
      wear: 0,
    });
    design.drawBookSpine(
      canvas.getContext('2d'),
      pad,
      pad,
      width,
      height,
      resolved,
      { noContact: true },
    );
    canvas.dataset.id = preset.id;
    canvas.style.cssText = `display:block;width:${canvas.width}px;height:${canvas.height}px`;
    return canvas;
  };

  const board = (id, scale, columns) => {
    const cellWidth = 38 * scale;
    const gap = 2 * scale;
    const root = document.createElement('main');
    root.id = id;
    root.style.cssText =
      `display:grid;grid-template-columns:repeat(${columns},${cellWidth}px);` +
      `gap:${gap}px;align-items:end;width:max-content;padding:${14 * scale}px;background:${ground}`;
    design.BOOK_PRESETS.forEach((preset, index) => root.append(draw(preset, index, scale)));
    document.body.append(root);
  };

  board('spine-reset-shelf', 1, 20);
  board('spine-reset-native', 2, 13);

  const programmes = design.BOOK_PRESETS.map((preset, index) => ({
    index,
    rowShelf: Math.floor(index / 20) + 1,
    colShelf: (index % 20) + 1,
    rowNative: Math.floor(index / 13) + 1,
    colNative: (index % 13) + 1,
    id: preset.id,
    label: preset.label,
    shape: preset.shape,
    material: preset.material,
    decoration: preset.decorations[0] ?? 'plain',
    gilt: preset.gilt,
  }));
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      presets: programmes.length,
      plain: programmes.filter((entry) => entry.decoration === 'plain').length,
      authored: programmes.filter((entry) => entry.decoration !== 'plain').length,
      uniqueProgrammes: new Set(programmes.map((entry) => entry.decoration)).size,
    },
    programmes,
  };
});

for (const [selector, filename] of [
  ['#spine-reset-shelf', 'book-spine-reset-shelf.png'],
  ['#spine-reset-native', 'book-spine-reset-native.png'],
]) {
  await page.locator(selector).screenshot({ path: `${outDir}/${filename}` });
  console.log(`-> ${outDir}/${filename}`);
}
writeFileSync(
  `${outDir}/book-spine-reset-report.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(`-> ${outDir}/book-spine-reset-report.json`);
console.log(JSON.stringify(report.counts));
await browser.close();
