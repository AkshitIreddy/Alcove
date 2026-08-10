/**
 * Label-free quality boards for the post-audit binding vocabulary.
 *
 * The PNGs intentionally contain no captions: a spine that needs its name to
 * read as a book does not pass. `curated-active-bindings-report.json` maps each
 * cell back to its preset/material/shape after the visual judgement is made.
 *
 * Usage: node shots-now/curated-active-bindings-board.mjs [--url=http://localhost:1420]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const url = hit?.slice('--url='.length) || 'http://localhost:1420';
const outDir = 'shots-now/out';
mkdirSync(outDir, { recursive: true });

const replacementIds = [
  'launder-patterned-sides',
  'stiff-vellum-quarto',
  'morocco-star-medallion',
  'armorial-calf',
  'damask-presentation',
  'velvet-presentation',
  'cased-stripe-almanac',
  'paste-paper-keepsake',
  'cased-nature-diary',
  'suede-field-book',
  'linen-sewn-journal',
  'rounded-roan-almanac',
  'felt-common-room',
  'archival-cloth',
  'linen-herbarium',
  'sailcloth-field-ledger',
  'canvas-corded-log',
  'canvas-daybook',
  'oilcloth-field-book',
];

const repairIds = [
  'felt-common-room',
  'velvet-presentation',
  'marbled-boards',
  'launder-patterned-sides',
  'archival-cloth',
  'morocco-star-medallion',
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (error) => console.error('[pageerror]', error.message));
await page.goto(`${url}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => import('/src/art/bookDesign.ts').then(() => true, () => false),
  null,
  { polling: 400 },
);

const report = await page.evaluate(
  async ({ replacementIds, repairIds }) => {
    const design = await import('/src/art/bookDesign.ts');
    const bookStyle = await import('/src/art/bookStyle.ts');
    const spines = await import('/src/art/spines.ts');
    const covers = await import('/src/art/covers.ts');
    const flat = await import('/src/art/flat.ts');

    await Promise.all([
      document.fonts.load('600 24px "Caveat Variable"'),
      document.fonts.load('400 14px "Patrick Hand"'),
    ].map((job) => job.catch(() => {})));
    await document.fonts.ready;

    const ground = flat.FLAT.recess;
    document.body.innerHTML = '';
    document.body.style.cssText = `margin:0;background:${ground};`;

    const titleFor = (id) => ({
      'launder-patterned-sides': 'Collected Letters',
      'stiff-vellum-quarto': 'Old Herbals',
      'morocco-star-medallion': 'Night Atlas',
      'armorial-calf': 'House Annals',
      'damask-presentation': 'Selected Poems',
      'velvet-presentation': 'Ceremonies',
      'cased-stripe-almanac': 'Little Almanac',
      'paste-paper-keepsake': 'Small Keepsakes',
      'cased-nature-diary': 'Field Flowers',
      'suede-field-book': 'Field Notes',
      'linen-sewn-journal': 'Commonplace',
      'rounded-roan-almanac': 'The Almanac',
      'felt-common-room': 'Reading List',
      'archival-cloth': 'Archive 1926',
      'linen-herbarium': 'Winter Herbarium',
      'sailcloth-field-ledger': 'Soundings',
      'canvas-corded-log': 'Expedition Log',
      'canvas-daybook': 'Workshop Daybook',
      'oilcloth-field-book': 'Weather Log',
    }[id] || 'Collected Notes');

    const seedFor = (id, offset = 0) => {
      let h = (0x811c9dc5 ^ offset) >>> 0;
      for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
      return h >>> 0;
    };

    const presetById = new Map(design.BOOK_PRESETS.map((preset) => [preset.id, preset]));
    const drawShelfSpine = (preset, index, width = 30, height = 164) => {
      const seed = seedFor(preset.id, index);
      const canvas = document.createElement('canvas');
      canvas.width = width + 8;
      canvas.height = height + 8;
      canvas.style.cssText = `display:block;width:${canvas.width}px;height:${canvas.height}px;`;
      const resolved = design.resolveBookDesign({ seed, preset: preset.id });
      design.drawBookSpine(canvas.getContext('2d'), 4, 4, width, height, resolved, {
        noContact: true,
      });
      canvas.dataset.id = preset.id;
      return canvas;
    };

    // Isolate silhouette quality from every other binding decision. Both
    // boards use the same quiet cloth, ornament-free face and seed; only the
    // active shape changes. A shape that needs a caption or ornate tooling to
    // read as a book does not pass this board.
    const drawNeutralShape = (shape, shelf = false) => {
      const width = shelf ? 26 : 58;
      const height = shelf ? 118 : 236;
      const pad = shelf ? 3 : 7;
      const canvas = document.createElement('canvas');
      canvas.width = width + pad * 2;
      canvas.height = height + pad * 2;
      const base = design.resolveBookDesign({
        seed: 0x51e5,
        preset: 'lettered-cloth',
        cloth: 12,
      });
      design.drawBookSpine(
        canvas.getContext('2d'),
        pad,
        pad,
        width,
        height,
        {
          ...base,
          shape,
          material: 'smooth-cloth',
          decorations: ['label-plate'],
          bands: 0,
          bandGilt: false,
          headTail: null,
          wear: 0,
        },
        { noContact: true },
      );
      canvas.dataset.id = shape;
      canvas.style.cssText = `display:block;width:${canvas.width}px;height:${canvas.height}px;`;
      return canvas;
    };

    const drawPair = (preset, index, shelf = false) => {
      const seed = seedFor(preset.id, index + (shelf ? 900 : 0));
      const height = shelf ? 118 : 230;
      const thickness = shelf ? 24 : 42;
      const width = shelf ? 78 : 166;
      const resolved = bookStyle.resolveBookStyle(
        seed,
        undefined,
        {
          height,
          thickness,
          wear: shelf ? 0.06 : 0,
          raisedBands: 0,
          charm: 'none',
          cornerProtectors: false,
          insetPlate: false,
        },
        { binding: preset.id },
      );
      const cell = document.createElement('div');
      cell.dataset.id = preset.id;
      cell.style.cssText =
        `box-sizing:border-box;display:flex;align-items:flex-end;justify-content:center;gap:${shelf ? 4 : 9}px;` +
        `width:${shelf ? 116 : 236}px;height:${shelf ? 132 : 248}px;padding:${shelf ? 4 : 8}px;overflow:hidden;`;

      const spine = document.createElement('canvas');
      spine.width = thickness + 8;
      spine.height = height + 8;
      spines.renderSpine(
        spine.getContext('2d'),
        { ...resolved.spine, binding: preset.id },
        4,
        4,
        height,
        1,
        { hiRes: !shelf },
      );

      const cover = document.createElement('canvas');
      cover.width = width;
      cover.height = height;
      covers.renderCoverInto(
        cover.getContext('2d'),
        width,
        height,
        resolved.cover,
        titleFor(preset.id),
      );
      spine.style.cssText = `display:block;width:${spine.width}px;height:${spine.height}px;`;
      cover.style.cssText = `display:block;width:${width}px;height:${height}px;`;
      cell.append(spine, cover);
      return cell;
    };

    const replacementPresets = replacementIds.map((id) => presetById.get(id)).filter(Boolean);
    const repairPresets = repairIds.map((id) => presetById.get(id)).filter(Boolean);

    const native = document.createElement('main');
    native.id = 'curated-replacements-native';
    native.style.cssText = `display:grid;grid-template-columns:repeat(6,236px);gap:12px;padding:18px;background:${ground};width:max-content;`;
    replacementPresets.forEach((preset, index) => native.append(drawPair(preset, index, false)));

    const shelf = document.createElement('main');
    shelf.id = 'curated-replacements-shelf';
    shelf.style.cssText = `display:grid;grid-template-columns:repeat(9,116px);gap:4px;padding:14px;background:${ground};width:max-content;`;
    replacementPresets.forEach((preset, index) => shelf.append(drawPair(preset, index, true)));

    const allActive = document.createElement('main');
    allActive.id = 'all-active-bindings-shelf';
    allActive.style.cssText = `display:grid;grid-template-columns:repeat(20,38px);gap:2px;padding:14px;background:${ground};width:max-content;align-items:end;`;
    design.BOOK_PRESETS.forEach((preset, index) => allActive.append(drawShelfSpine(preset, index)));

    const repairsNative = document.createElement('main');
    repairsNative.id = 'material-repairs-native';
    repairsNative.style.cssText = `display:grid;grid-template-columns:repeat(6,236px);gap:12px;padding:18px;background:${ground};width:max-content;`;
    repairPresets.forEach((preset, index) => repairsNative.append(drawPair(preset, index + 50, false)));

    const repairsShelf = document.createElement('main');
    repairsShelf.id = 'material-repairs-shelf';
    repairsShelf.style.cssText = `display:flex;align-items:flex-end;gap:2px;padding:14px;background:${ground};width:max-content;`;
    repairPresets.forEach((preset, index) => repairsShelf.append(drawShelfSpine(preset, index + 50, 30, 164)));

    const shapesNative = document.createElement('main');
    shapesNative.id = 'active-shapes-native';
    shapesNative.style.cssText = `display:flex;align-items:flex-end;gap:10px;padding:18px;background:${ground};width:max-content;`;
    design.ROLLABLE_SHAPES.forEach((shape) => shapesNative.append(drawNeutralShape(shape, false)));

    const shapesShelf = document.createElement('main');
    shapesShelf.id = 'active-shapes-shelf';
    shapesShelf.style.cssText = `display:flex;align-items:flex-end;gap:2px;padding:14px;background:${ground};width:max-content;`;
    design.ROLLABLE_SHAPES.forEach((shape) => shapesShelf.append(drawNeutralShape(shape, true)));

    document.body.append(native, shelf, allActive, repairsNative, repairsShelf, shapesNative, shapesShelf);
    return {
      counts: {
        shapes: design.ROLLABLE_SHAPES.length,
        materials: design.ROLLABLE_MATERIALS.length,
        decorations: design.ROLLABLE_DECORATIONS.length,
        activePresets: design.BOOK_PRESETS.length,
        retiredPresets: design.RETIRED_BOOK_PRESET_IDS.length,
        surpriseDirections: design.BOOK_SURPRISE_DIRECTIONS.length,
        surprisePoolEntries: design.BOOK_SURPRISE_DIRECTIONS.reduce((sum, direction) => sum + direction.presetIds.length, 0),
      },
      activeShapes: design.ROLLABLE_SHAPES,
      activeMaterials: design.ROLLABLE_MATERIALS,
      replacementIds: replacementPresets.map((preset) => preset.id),
      repairIds: repairPresets.map((preset) => preset.id),
      allActivePresetIds: design.BOOK_PRESETS.map((preset) => preset.id),
      retiredPresetIds: design.RETIRED_BOOK_PRESET_IDS,
      directions: Object.fromEntries(design.BOOK_SURPRISE_DIRECTIONS.map((direction) => [direction.id, direction.presetIds])),
    };
  },
  { replacementIds, repairIds },
);

const shots = [
  ['#curated-replacements-native', 'curated-bindings-replacements-native.png'],
  ['#curated-replacements-shelf', 'curated-bindings-replacements-shelf.png'],
  ['#all-active-bindings-shelf', 'curated-bindings-all-active-shelf.png'],
  ['#material-repairs-native', 'curated-material-repairs-native.png'],
  ['#material-repairs-shelf', 'curated-material-repairs-shelf.png'],
  ['#active-shapes-native', 'curated-active-shapes-native.png'],
  ['#active-shapes-shelf', 'curated-active-shapes-shelf.png'],
];
for (const [selector, filename] of shots) {
  await page.locator(selector).screenshot({ path: `${outDir}/${filename}` });
  console.log(`-> ${outDir}/${filename}`);
}
writeFileSync(`${outDir}/curated-active-bindings-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`-> ${outDir}/curated-active-bindings-report.json`);
console.log(JSON.stringify(report.counts));
await browser.close();
