/**
 * Focused cover-construction specimen.
 *
 * This deliberately holds ornamental furniture quiet.  The question is
 * whether cloth, paper, skin and split bindings read as constructed books
 * before a decorative frame or a second emblem is allowed to help them.
 *
 * Usage:
 *   node shots-now/cover-construction-board.mjs before
 *   node shots-now/cover-construction-board.mjs after
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const tag = process.argv[2] === 'before' ? 'before' : 'after';
const out = `shots-now/out/cover-construction-${tag}.png`;
mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1180, height: 900 },
  deviceScaleFactor: 1,
});

page.on('pageerror', (error) => console.error('[pageerror]', error.message));
await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  await Promise.all([
    document.fonts.load('700 28px "Caveat Variable"'),
    document.fonts.load('600 24px "Kalam"'),
    document.fonts.load('400 24px "Patrick Hand"'),
  ]);
  await document.fonts.ready;
});

await page.evaluate(async () => {
  const covers = await import('/src/art/covers.ts');
  const samples = [
    ['Smooth cloth', 'smooth-cloth', 'blind-lettered', -1],
    ['Linen', 'linen', 'label', -1],
    ['Canvas duck', 'canvas', 'blind-lettered', -1],
    ['Felt', 'felt', 'label', -1],
    ['Paste paper', 'paste-paper', 'label', -1],
    ['Marbled paper', 'marbled-paper', 'morocco-label', -1],
    ['Block print', 'block-print', 'paper-slip', -1],
    ['Paper wrapper', 'paper-wrapper', 'paper-slip', -1],
    ['Morocco', 'morocco-grain', 'gilt-direct', 12],
    ['Polished calf', 'polished-calf', 'morocco-label', 27],
    ['Vellum', 'vellum', 'label', -1],
    ['Parchment', 'parchment', 'blind-lettered', -1],
    ['Half bound', 'half-bound', 'morocco-label', 19],
    ['Linen & sprig paper', 'sprig-paper-sides', 'label', -1],
    ['Sailcloth', 'sailcloth', 'linen-tag', -1],
    ['Library buckram', 'buckram', 'gilt-direct', 35],
  ];

  document.body.innerHTML = '';
  document.body.style.cssText =
    'margin:0;background:#e9e2d0;display:grid;grid-template-columns:repeat(4,260px);' +
    'gap:14px;padding:16px;justify-content:start;font:13px "Nunito Sans",system-ui;color:#4f3120';

  for (let i = 0; i < samples.length; i++) {
    const [label, material, titlePlate, medallion] = samples[i];
    const box = document.createElement('figure');
    box.style.cssText = 'margin:0;width:260px;text-align:center';
    const canvas = document.createElement('canvas');
    canvas.width = 250;
    canvas.height = 347;
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    caption.style.cssText = 'margin-top:4px;font-weight:700';
    box.append(canvas, caption);
    document.body.append(box);

    const covering = covers.COVER_TEXTURES.indexOf(material);
    covers.renderCoverInto(
      canvas.getContext('2d'),
      canvas.width,
      canvas.height,
      {
        seed: (0x51ee + i * 2654435761) >>> 0,
        palette: (8 + i * 7) % covers.COVER_PALETTE_COUNT,
        texture: 0,
        covering,
        frame: 0,
        medallion,
        titleFont: i % 3,
        gilt: i % 3 !== 2,
        titlePlate,
        edge: i % 4 === 0 ? 'speckled' : i % 4 === 1 ? 'gilt' : 'plain',
      },
      label,
    );
  }
});

await page.screenshot({ path: out, fullPage: true });
console.log(`-> ${out}`);
await browser.close();
