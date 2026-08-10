/**
 * True-size active BOOK vocabulary board. Uses the existing :1420 server.
 * It deliberately does not start, stop, seed or mutate the running app.
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
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
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

  const draw = (over, seed = 0x51e5, width = 30, height = 164) => {
    const pad = 4;
    const canvas = document.createElement('canvas');
    canvas.width = width + pad * 2;
    canvas.height = height + pad * 2;
    const base = design.resolveBookDesign({
      seed,
      preset: 'plain-cloth',
      cloth: '#8b3c4c',
      accent: '#d4b45f',
      tooling: '#e7c65f',
      emblem: '#e7c65f',
      gilt: true,
    });
    design.drawBookSpine(
      canvas.getContext('2d'),
      pad,
      pad,
      width,
      height,
      {
        ...base,
        shape: 'square',
        material: 'smooth-cloth',
        decorations: ['plain'],
        bands: 0,
        headTail: null,
        wear: 0,
        ...over,
      },
      { noContact: true },
    );
    canvas.style.cssText = `display:block;width:${canvas.width}px;height:${canvas.height}px`;
    return canvas;
  };

  const makeBoard = (id, ids, drawOne, columns) => {
    const board = document.createElement('main');
    board.id = id;
    board.style.cssText =
      `display:grid;grid-template-columns:repeat(${columns},38px);gap:2px;` +
      `align-items:end;width:max-content;padding:14px;background:${ground}`;
    ids.forEach((entry, index) => {
      const canvas = drawOne(entry, index);
      canvas.dataset.id = entry;
      board.append(canvas);
    });
    document.body.append(board);
  };

  makeBoard(
    'apocalypse-shapes',
    design.ROLLABLE_SHAPES,
    (shape, index) => draw({ shape }, 0x5a0000 + index),
    design.ROLLABLE_SHAPES.length,
  );
  makeBoard(
    'apocalypse-materials',
    design.ROLLABLE_MATERIALS,
    (material, index) => draw({ material }, 0x51e500 + index),
    design.ROLLABLE_MATERIALS.length,
  );
  makeBoard(
    'apocalypse-decorations',
    design.ROLLABLE_DECORATIONS,
    (decoration, index) => draw({ decorations: [decoration] }, 0xdec000 + index),
    15,
  );
  makeBoard(
    'apocalypse-bindings',
    design.BOOK_PRESETS.map((preset) => preset.id),
    (id, index) => {
      const preset = design.bookPreset(id);
      return draw(
        {
          shape: preset.shape,
          material: preset.material,
          decorations: preset.decorations,
          gilt: preset.gilt,
        },
        0xb10000 + index,
      );
    },
    20,
  );

  return {
    materials: design.ROLLABLE_MATERIALS,
    decorations: design.ROLLABLE_DECORATIONS,
    focalDecorations: design.FOCAL_TOOL_DECORATIONS,
    namedBindings: design.BOOK_PRESET_IDS,
  };
});

for (const [selector, filename] of [
  ['#apocalypse-shapes', 'book-apocalypse-shapes.png'],
  ['#apocalypse-materials', 'book-apocalypse-materials.png'],
  ['#apocalypse-decorations', 'book-apocalypse-decorations.png'],
  ['#apocalypse-bindings', 'book-apocalypse-bindings.png'],
]) {
  await page.locator(selector).screenshot({ path: `${outDir}/${filename}` });
  console.log(`-> ${outDir}/${filename}`);
}
writeFileSync(
  `${outDir}/book-apocalypse-board.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(`-> ${outDir}/book-apocalypse-board.json`);
await browser.close();
