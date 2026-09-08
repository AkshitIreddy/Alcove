/**
 * Complete reader-facing book-binding artwork board.
 *
 * Uses the already-running :1420 Vite app and mutates no stored data. Every
 * active silhouette, material, tooling programme and finished preset is drawn
 * through the production `drawBookSpine` path at true shelf size and at a
 * larger inspection size. Active materials are also pulled through the real
 * front-cover renderer with all optional furniture removed, so the binding
 * construction itself can be judged without a frame or title hiding it.
 *
 * Usage: node shots-now/book-binding-artwork-board.mjs [--url=http://localhost:1420]
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
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(`${url}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => import('/src/art/bookDesign.ts').then(() => true, () => false),
  null,
  { polling: 300 },
);

const report = await page.evaluate(async () => {
  const design = await import('/src/art/bookDesign.ts');
  const art = await import('/src/art/bookBindingArtwork.ts');
  const covers = await import('/src/art/covers.ts');
  const flat = await import('/src/art/flat.ts');
  document.body.innerHTML = '';
  document.body.style.cssText =
    `margin:0;background:${flat.FLAT.recess};color:${flat.FLAT.cream};` +
    'font:12px "Nunito Sans",system-ui,sans-serif;';

  const hash = (value, salt = 0) => {
    let h = (0x811c9dc5 ^ salt) >>> 0;
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  };

  const draw = ({ shape = 'square', material = 'smooth-cloth', decoration = 'plain', width = 36, height = 188, seed = 1 }) => {
    const pad = 5;
    const canvas = document.createElement('canvas');
    canvas.width = width + pad * 2;
    canvas.height = height + pad * 2;
    const resolved = design.resolveBookDesign({
      seed,
      preset: 'plain-cloth',
      cloth: '#8f3f54',
      accent: '#c6a252',
      tooling: '#e9bf55',
      emblem: '#e9bf55',
      wear: 0,
      bands: 0,
      headTail: null,
    });
    design.drawBookSpine(canvas.getContext('2d'), pad, pad, width, height, {
      ...resolved,
      shape,
      material,
      decorations: [decoration],
      gilt: !String(decoration).includes('blind') && decoration !== 'plain',
    }, { noContact: true });
    canvas.style.cssText = `display:block;width:${canvas.width}px;height:${canvas.height}px`;
    return canvas;
  };

  const section = (id, columns, cellWidth) => {
    const root = document.createElement('main');
    root.id = id;
    root.style.cssText =
      `display:grid;grid-template-columns:repeat(${columns},${cellWidth}px);gap:12px 8px;` +
      `align-items:end;width:max-content;padding:18px;background:${flat.FLAT.recess}`;
    document.body.append(root);
    return root;
  };

  const cell = (label, canvases, width) => {
    const figure = document.createElement('figure');
    figure.style.cssText = `margin:0;width:${width}px;display:flex;flex-direction:column;align-items:center`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-end;justify-content:center;gap:5px';
    canvases.forEach((canvas) => row.append(canvas));
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    caption.style.cssText = 'margin-top:5px;line-height:1.12;text-align:center;max-width:100%';
    figure.append(row, caption);
    return figure;
  };

  const materials = section('binding-materials', 9, 170);
  design.ROLLABLE_MATERIALS.forEach((material) => {
    const seed = hash(material, 0x1100);
    materials.append(cell(design.MATERIAL_LOOK_LABELS[material], [
      draw({ material, width: 28, height: 156, seed }),
      draw({ material, width: 56, height: 250, seed }),
    ], 170));
  });

  const coverMaterials = section('binding-cover-materials', 6, 198);
  design.ROLLABLE_MATERIALS.forEach((material) => {
    const seed = hash(material, 0x1180);
    const covering = covers.COVER_TEXTURES.indexOf(material);
    const params = covers.deriveCoverParams(seed, {
      material,
      covering,
      frame: 0,
      medallion: -1,
      titlePlate: 'none',
      edge: 'plain',
      charm: 'none',
      raisedBands: 0,
      headTail: false,
      wear: 0,
      coverBaseHex: '#8f3f54',
      coverAccentHex: '#4e6f69',
      toolingHex: '#e9bf55',
    });
    const cover = covers.renderCover(148, 206, params, '', { plate: false });
    cover.style.cssText = 'display:block;width:148px;height:206px';
    coverMaterials.append(cell(design.MATERIAL_LOOK_LABELS[material], [cover], 198));
  });

  const decorations = section('binding-decorations', 10, 164);
  design.ROLLABLE_DECORATIONS.forEach((decoration) => {
    const seed = hash(decoration, 0x2200);
    decorations.append(cell(design.DECORATION_LABELS[decoration], [
      draw({ decoration, width: 30, height: 164, seed }),
      draw({ decoration, width: 52, height: 236, seed }),
    ], 164));
  });

  const shapes = section('binding-shapes', 3, 280);
  design.ROLLABLE_SHAPES.forEach((shape) => {
    const seed = hash(shape, 0x3300);
    shapes.append(cell(design.SHAPE_LABELS[shape], [
      draw({ shape, width: 30, height: 164, seed }),
      draw({ shape, width: 70, height: 252, seed }),
    ], 280));
  });

  const presets = section('binding-presets', 13, 118);
  design.BOOK_PRESETS.forEach((preset, index) => {
    const seed = hash(preset.id, 0x4400 + index);
    presets.append(cell(preset.label, [draw({
      shape: preset.shape,
      material: preset.material,
      decoration: preset.decorations[0] || 'plain',
      width: 30,
      height: 164,
      seed,
    })], 118));
  });

  const authored = design.ROLLABLE_DECORATIONS.filter((id) => id !== 'plain');
  return {
    counts: {
      shapes: design.ROLLABLE_SHAPES.length,
      materials: design.ROLLABLE_MATERIALS.length,
      decorations: design.ROLLABLE_DECORATIONS.length,
      presets: design.BOOK_PRESETS.length,
      materialArtwork: art.ACTIVE_BINDING_MATERIAL_ARTWORK_IDS.length,
      programmeArtwork: art.ACTIVE_BINDING_ART_PROGRAM_IDS.length,
    },
    missingMaterials: design.ROLLABLE_MATERIALS.filter(
      (id) => !art.ACTIVE_BINDING_MATERIAL_ARTWORK_IDS.includes(id),
    ),
    missingProgrammes: authored.filter((id) => !art.ACTIVE_BINDING_ART_PROGRAM_IDS.includes(id)),
  };
});

for (const [selector, filename] of [
  ['#binding-materials', 'book-binding-materials-complete.png'],
  ['#binding-cover-materials', 'book-binding-cover-materials-complete.png'],
  ['#binding-decorations', 'book-binding-decorations-complete.png'],
  ['#binding-shapes', 'book-binding-shapes-complete.png'],
  ['#binding-presets', 'book-binding-presets-complete.png'],
]) {
  await page.locator(selector).screenshot({ path: `${outDir}/${filename}` });
  console.log(`-> ${outDir}/${filename}`);
}
const payload = { ...report, errors };
writeFileSync(`${outDir}/book-binding-artwork-report.json`, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify(payload));
await browser.close();
