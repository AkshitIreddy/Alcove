/**
 * book-surprise-board.mjs — paired spine/cover specimens for every curated
 * Book Studio Surprise direction.
 *
 * This is deliberately a LOOKING surface, not a unit test. Each cell renders
 * one complete recipe through the same spine and cover painters the app uses,
 * at approximately the size a reader meets in the studio. The caption names
 * the chosen binding and its exact material, while the seven small swatches
 * expose the role palette. A mismatched covering, illegible title plate or
 * over-dressed thin spine is therefore visible in one glance.
 *
 * Usage: node shots-now/book-surprise-board.mjs [--url=http://localhost:1420]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const url = hit?.slice('--url='.length) || 'http://localhost:1420';
const output = 'shots-now/out/book-surprise-directions.png';
mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1460, height: 1000 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (error) => console.error('[pageerror]', error.message));
await page.goto(`${url}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 400,
});

const report = await page.evaluate(async () => {
  const design = await import('/src/art/bookDesign.ts');
  const surprise = await import('/src/art/bookSurprise.ts');
  const style = await import('/src/art/bookStyle.ts');
  const spines = await import('/src/art/spines.ts');
  const covers = await import('/src/art/covers.ts');
  const flat = await import('/src/art/flat.ts');

  await Promise.all([
    document.fonts.load('600 24px "Caveat Variable"'),
    document.fonts.load('400 16px "Patrick Hand"'),
    document.fonts.load('400 12px "Nunito Sans"'),
  ].map((job) => job.catch(() => {})));
  await document.fonts.ready;

  document.body.innerHTML = '';
  document.body.style.cssText =
    `margin:0;padding:18px;background:${flat.FLAT.recess};color:${flat.FLAT.ink};` +
    'font:12px "Nunito Sans",system-ui,sans-serif;';

  const heading = document.createElement('h1');
  heading.textContent = 'Book Studio — complete Surprise recipes';
  heading.style.cssText =
    'margin:0 0 4px;font:600 30px "Caveat Variable",cursive;letter-spacing:.01em;';
  const note = document.createElement('p');
  note.textContent =
    'Four deterministic books per direction · spine and cover share one recipe · seven role colours below each pair';
  note.style.cssText = 'margin:0 0 16px;opacity:.72;';
  const grid = document.createElement('main');
  grid.id = 'surprise-board';
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(4,332px);gap:14px;align-items:start;';
  document.body.append(heading, note, grid);

  const titles = ['Field Notes', 'The Lantern Atlas', 'Winter Herbarium', 'Small Histories'];
  const rows = [];
  for (let d = 0; d < design.BOOK_SURPRISE_DIRECTIONS.length; d += 1) {
    const direction = design.BOOK_SURPRISE_DIRECTIONS[d];
    for (let sample = 0; sample < 4; sample += 1) {
      const seed = (0x51e5a11 ^ Math.imul(d + 1, 0x9e3779b1) ^ Math.imul(sample + 3, 0x85ebca6b)) >>> 0;
      const recipe = surprise.surpriseBookRecipe(direction.id, seed);
      const resolved = style.resolveBookStyle(seed, undefined, recipe.style, {
        binding: recipe.preset,
      });
      const preset = design.bookPreset(recipe.preset);
      const title = titles[sample];
      const scale = Math.min(1, 226 / resolved.style.height);
      const bookH = resolved.style.height * scale;
      const boardW = bookH * 0.72;
      const spineW = resolved.style.thickness * scale;

      const cell = document.createElement('section');
      cell.style.cssText =
        'box-sizing:border-box;width:332px;padding:10px 10px 9px;background:#f5eee2;' +
        'border:1.5px solid #56392f;border-radius:14px 11px 15px 12px;' +
        'box-shadow:3px 4px 0 rgba(80,48,38,.12);';

      const label = document.createElement('header');
      label.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:baseline;';
      const name = document.createElement('strong');
      name.textContent = `${direction.label} ${sample + 1}`;
      name.style.cssText = 'font:600 21px "Caveat Variable",cursive;';
      const dims = document.createElement('small');
      dims.textContent = `${Math.round(resolved.style.thickness)} × ${Math.round(resolved.style.height)}`;
      dims.style.cssText = 'opacity:.66;';
      label.append(name, dims);

      const art = document.createElement('div');
      art.style.cssText =
        'height:238px;display:flex;gap:13px;align-items:flex-end;justify-content:center;' +
        'padding:4px 0 2px;overflow:hidden;';
      const spine = document.createElement('canvas');
      spine.width = Math.ceil(spineW + 8);
      spine.height = 234;
      spine.style.cssText = `width:${spine.width}px;height:${spine.height}px;`;
      const sctx = spine.getContext('2d');
      spines.renderSpine(
        sctx,
        { ...resolved.spine, binding: recipe.preset },
        4,
        232 - bookH,
        bookH,
        scale,
        { hiRes: true },
      );

      const cover = document.createElement('canvas');
      cover.width = Math.ceil(boardW + 4);
      cover.height = 234;
      cover.style.cssText = `width:${cover.width}px;height:${cover.height}px;`;
      covers.renderCoverInto(
        cover.getContext('2d'),
        boardW,
        bookH,
        resolved.cover,
        title,
      );
      // The cover renderer starts at (0,0); bottom-align its canvas beside the spine.
      cover.style.transform = `translateY(${232 - bookH}px)`;
      art.append(spine, cover);

      const binding = document.createElement('div');
      binding.textContent = `${preset.label} · ${preset.shape} · ${preset.material}`;
      binding.title = binding.textContent;
      binding.style.cssText =
        'margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;';
      const finish = document.createElement('div');
      finish.textContent = `${resolved.style.titlePlate} · ornament ${resolved.style.ornament} · ${resolved.style.edge}`;
      finish.style.cssText =
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;opacity:.7;';

      const swatches = document.createElement('div');
      swatches.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-top:7px;';
      const roleKeys = [
        'spineBaseHex', 'spineAccentHex', 'coverBaseHex', 'coverAccentHex',
        'toolingHex', 'emblemHex', 'hardwareHex',
      ];
      for (const key of roleKeys) {
        const chip = document.createElement('span');
        chip.title = `${key}: ${resolved.style[key]}`;
        chip.style.cssText =
          `height:9px;background:${resolved.style[key]};border:1px solid rgba(67,41,52,.42);border-radius:4px;`;
        swatches.append(chip);
      }
      cell.append(label, art, binding, finish, swatches);
      grid.append(cell);
      rows.push({
        direction: direction.id,
        preset: preset.id,
        material: preset.material,
        resolvedCoverMaterial:
          covers.COVER_TEXTURE_LABELS[resolved.cover.covering] ?? String(resolved.cover.covering),
      });
    }
  }
  return rows;
});

await page.locator('#surprise-board').screenshot({ path: output });
console.log(`-> ${output} (${report.length} paired recipes)`);
for (const row of report) {
  console.log(`${row.direction.padEnd(10)} ${row.preset.padEnd(26)} spine=${row.material.padEnd(18)} cover=${row.resolvedCoverMaterial}`);
}
await browser.close();
