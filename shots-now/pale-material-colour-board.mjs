/**
 * Focused Book Studio colour-role specimen.
 *
 * Shows the exact shelf-spine and pulled-cover painters for vellum and
 * parchment with an inherited shared cloth, explicit blue/red face roles, and
 * the persisted null reset. The first and last columns must be identical; the
 * middle columns must stay visibly pale while clearly taking their chosen hue.
 *
 * Usage: node shots-now/pale-material-colour-board.mjs [--url=http://localhost:1420]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.slice(2).find((arg) => arg.startsWith('--url='));
const baseUrl = hit?.slice('--url='.length) ?? 'http://localhost:1420';
const output = 'shots-now/out/pale-material-colour-roles.png';
mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1320, height: 820 } });
page.setDefaultTimeout(120_000);
page.on('pageerror', (error) => console.error('[pageerror]', error.message));

await page.goto(`${baseUrl}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 250 });

const report = await page.evaluate(async () => {
  const { resolveBookStyle } = await import('/src/art/bookStyle.ts');
  const { coverPainterColours, renderCoverInto } = await import('/src/art/covers.ts');
  const { bookPainterColours } = await import('/src/art/bookDesign.ts');
  const { renderSpine, resolveSpineBinding } = await import('/src/art/spines.ts');

  await Promise.all([
    document.fonts.load('600 28px "Caveat Variable"'),
    document.fonts.load('400 16px "Nunito Sans"'),
  ].map((job) => job.catch(() => undefined)));
  await document.fonts.ready;

  const seed = 0x4a112299;
  const choices = [
    { label: 'inherited cloth', overrides: { clothHex: '#31566f' } },
    {
      label: 'blue face',
      overrides: { clothHex: '#31566f', spineBaseHex: '#31566f', coverBaseHex: '#31566f' },
    },
    {
      label: 'red face',
      overrides: { clothHex: '#31566f', spineBaseHex: '#a24f48', coverBaseHex: '#a24f48' },
    },
    {
      label: 'reset to inherit',
      overrides: { clothHex: '#31566f', spineBaseHex: null, coverBaseHex: null },
    },
  ];
  const materials = [
    { label: 'Vellum', binding: 'gilt-vellum' },
    { label: 'Parchment', binding: 'parchment-cartulary' },
  ];

  document.body.innerHTML = '';
  document.body.style.cssText =
    'margin:0;padding:24px;background:#eee6dc;color:#432c32;' +
    'font:14px "Nunito Sans",system-ui,sans-serif;';
  const title = document.createElement('h1');
  title.textContent = 'Pale bindings — inherited, dyed, reset';
  title.style.cssText = 'margin:0 0 18px;font:600 32px "Caveat Variable",cursive;';
  document.body.append(title);

  const grid = document.createElement('div');
  grid.id = 'pale-colour-board';
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(4,290px);gap:14px;' +
    'width:max-content;align-items:start;';
  document.body.append(grid);

  const pixels = [];
  for (const material of materials) {
    for (const choice of choices) {
      const resolved = resolveBookStyle(seed, undefined, choice.overrides, {
        binding: material.binding,
      });
      const spine = { ...resolved.spine, binding: material.binding };
      const design = resolveSpineBinding(spine);
      const spineColours = bookPainterColours(design);
      const coverColours = coverPainterColours(resolved.cover);

      const cell = document.createElement('section');
      cell.style.cssText =
        'background:#f8f1e9;border:1px solid #b89ca5;border-radius:16px;padding:12px;' +
        'box-sizing:border-box;box-shadow:0 2px 0 #c9aeb3;';
      const caption = document.createElement('div');
      caption.innerHTML = `<strong>${material.label}</strong><br>${choice.label}`;
      caption.style.cssText = 'height:42px;line-height:1.3;text-align:center;';

      const art = document.createElement('div');
      art.style.cssText = 'display:flex;align-items:flex-end;justify-content:center;gap:12px;';
      const spineCanvas = document.createElement('canvas');
      spineCanvas.width = 96;
      spineCanvas.height = 238;
      const spineCtx = spineCanvas.getContext('2d');
      const scale = 1.9;
      const spineW = spine.w * scale;
      renderSpine(
        spineCtx,
        spine,
        (spineCanvas.width - spineW) / 2,
        4,
        226,
        scale,
        { hiRes: true },
      );

      const coverCanvas = document.createElement('canvas');
      coverCanvas.width = 150;
      coverCanvas.height = 214;
      renderCoverInto(
        coverCanvas.getContext('2d'),
        coverCanvas.width,
        coverCanvas.height,
        resolved.cover,
        'Field Notes',
      );
      art.append(spineCanvas, coverCanvas);

      const values = document.createElement('div');
      values.textContent = `${spineColours.base.toUpperCase()} · ${coverColours.visible.base.toUpperCase()}`;
      values.style.cssText = 'margin-top:8px;text-align:center;font-size:11px;letter-spacing:.04em;';
      cell.append(caption, art, values);
      grid.append(cell);
      pixels.push({
        material: material.binding,
        choice: choice.label,
        spine: spineColours.base,
        cover: coverColours.visible.base,
      });
    }
  }
  return pixels;
});

await page.locator('#pale-colour-board').screenshot({ path: output });
await browser.close();

const by = (material, choice) => report.find(
  (row) => row.material === material && row.choice === choice,
);
for (const material of ['gilt-vellum', 'parchment-cartulary']) {
  const inherited = by(material, 'inherited cloth');
  const reset = by(material, 'reset to inherit');
  if (inherited?.spine !== reset?.spine || inherited?.cover !== reset?.cover) {
    throw new Error(`${material}: reset did not restore inherited pixels`);
  }
}
console.log(JSON.stringify({ output, report }, null, 2));
