import { chromium } from 'playwright';

const url = 'http://127.0.0.1:1420';
const output = 'shots-now/out/book-emblems-imagegen.png';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const masters = [
  [0, 'Diamond', 'diamond'],
  [1, 'Broad laurel branch', 'broad-laurel-branch'],
  [2, 'Foliate starflower', 'foliate-starflower'],
  [5, 'Rising sun', 'rising-sun'],
  [12, 'Fleuron', 'fleuron'],
  [13, 'Oak and acorn spray', 'oak-and-acorn-spray'],
  [14, 'Thistle bloom', 'thistle-bloom'],
  [20, 'Crown', 'crown'],
  [23, 'Stemmed rosette', 'stemmed-rosette'],
  [26, 'Fleur-de-lis', 'fleur-de-lis'],
  [28, 'Acanthus volutes', 'acanthus-volutes'],
  [29, 'Wheat sheaf', 'wheat-sheaf'],
  [30, 'Split pomegranate', 'split-pomegranate'],
  [31, 'Open tulip', 'open-tulip'],
  [43, 'Five-leaf anthemion', 'five-leaf-anthemion'],
  [56, 'Split fern palmette', 'split-fern-palmette'],
  [66, 'Acanthus spear', 'acanthus-spear'],
  [67, 'Carnation bloom', 'carnation-bloom'],
  [68, 'Iris fan', 'iris-fan'],
  [70, 'Poppy seedhead', 'poppy-seedhead'],
  [71, 'Olive spray', 'olive-spray'],
  [74, 'Honeysuckle scroll', 'honeysuckle-scroll'],
  [75, 'Lotus palmette', 'lotus-palmette'],
  [78, 'Rowan spray', 'rowan-spray'],
  [80, 'Primrose stem', 'primrose-stem'],
  [81, 'Dog-rose branch', 'dog-rose-branch'],
  [83, 'Reed bundle', 'reed-bundle'],
  [84, 'Moresque knot', 'moresque-knot'],
  [85, 'Tudor rose standard', 'tudor-rose-standard'],
];

try {
  const page = await browser.newPage({ viewport: { width: 1540, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.setContent(`<!doctype html>
    <html><head><style>
      @font-face { font-family: PatrickHand; src: url('${url}/node_modules/@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2'); }
      * { box-sizing: border-box; }
      body { margin: 0; background: #eadbbd; color: #432934; font-family: PatrickHand, sans-serif; }
      header { padding: 26px 34px 20px; border-bottom: 3px solid #432934; background: #f2e6ce; }
      h1 { margin: 0; font-size: 34px; font-weight: 400; letter-spacing: .02em; }
      header p { margin: 5px 0 0; font-size: 17px; color: #73595d; }
      main { display: grid; grid-template-columns: repeat(5, 1fr); gap: 13px; padding: 18px; }
      article { min-height: 235px; padding: 11px 11px 10px; background: #f2e6ce; border: 2px solid #432934; border-radius: 9px 7px 10px 8px; }
      canvas { display: block; width: 100%; height: 174px; }
      h2 { margin: 7px 0 0; font-size: 18px; line-height: 1.05; font-weight: 400; }
      small { display: block; margin-top: 3px; color: #7c6060; font: 10px/1.2 Nunito Sans, sans-serif; letter-spacing: .07em; text-transform: uppercase; }
    </style></head><body>
      <header><h1>Alcove · ImageGen binder’s tools</h1><p>29 original named masters · cover impression and true 24 px shelf spine · transparent artwork recoloured as gilt</p></header>
      <main id="board"></main>
    </body></html>`);

  const result = await page.evaluate(async ({ url, masters }) => {
    const catalogue = await import('/src/art/spines.ts');
    if (catalogue.ACTIVE_ORNAMENTS.length !== masters.length) {
      throw new Error(`catalogue count drift: ${catalogue.ACTIVE_ORNAMENTS.length} != ${masters.length}`);
    }
    for (let i = 0; i < masters.length; i += 1) {
      const [index, label] = masters[i];
      const active = catalogue.ACTIVE_ORNAMENTS[i];
      if (active.index !== index || active.label !== label) {
        throw new Error(`identity drift at slot ${i}: ${active.index}/${active.label} != ${index}/${label}`);
      }
    }

    const load = async (id) => {
      const response = await fetch(`${url}/assets/book-art/imagegen/emblems/${id}.png`);
      if (!response.ok) throw new Error(`${id} failed to load: ${response.status}`);
      return createImageBitmap(await response.blob());
    };
    const loaded = await Promise.all(masters.map(async ([index, label, id]) => ({ index, label, id, image: await load(id) })));
    const cloths = ['#455e63', '#813f47', '#6d6241', '#546147', '#614c68', '#31606b'];
    const inks = ['#f0ce78', '#f2e6ce', '#e7c85b'];
    const board = document.querySelector('#board');
    const signatures = new Set();

    const crop = (image) => {
      const source = new OffscreenCanvas(image.width, image.height);
      const ctx = source.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      let left = image.width;
      let top = image.height;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          if (data[(y * image.width + x) * 4 + 3] < 18) continue;
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
      if (right < left) throw new Error('transparent master has no visible pixels');
      return { source, left, top, width: right - left + 1, height: bottom - top + 1 };
    };

    const stamp = (ctx, cropped, cx, cy, maxWidth, maxHeight, colour) => {
      const scale = Math.min(maxWidth / cropped.width, maxHeight / cropped.height);
      const width = cropped.width * scale;
      const height = cropped.height * scale;
      const layer = new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
      const layerCtx = layer.getContext('2d');
      layerCtx.drawImage(cropped.source, cropped.left, cropped.top, cropped.width, cropped.height, 0, 0, layer.width, layer.height);
      layerCtx.globalCompositeOperation = 'source-in';
      layerCtx.fillStyle = colour;
      layerCtx.fillRect(0, 0, layer.width, layer.height);
      ctx.drawImage(layer, Math.round(cx - layer.width / 2), Math.round(cy - layer.height / 2));
    };

    for (const [position, master] of loaded.entries()) {
      const article = document.createElement('article');
      const canvas = document.createElement('canvas');
      canvas.width = 272;
      canvas.height = 174;
      const heading = document.createElement('h2');
      const meta = document.createElement('small');
      heading.textContent = master.label;
      meta.textContent = `${String(master.index).padStart(2, '0')} · ${master.id}`;
      article.append(canvas, heading, meta);
      board.append(article);

      const cropped = crop(master.image);
      const ctx = canvas.getContext('2d');
      const cloth = cloths[position % cloths.length];
      const ink = inks[position % inks.length];

      ctx.fillStyle = '#bfa785'; ctx.fillRect(14, 7, 128, 158);
      ctx.fillStyle = cloth; ctx.fillRect(11, 4, 126, 156);
      ctx.strokeStyle = '#432934'; ctx.lineWidth = 3; ctx.strokeRect(11, 4, 126, 156);
      ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(20, 13, 108, 138);
      ctx.beginPath(); ctx.moveTo(31, 39); ctx.lineTo(117, 39); ctx.moveTo(37, 46); ctx.lineTo(111, 46); ctx.stroke();
      stamp(ctx, cropped, 74, 99, 76, 84, ink);

      ctx.fillStyle = '#bfa785'; ctx.fillRect(207, 7, 26, 158);
      ctx.fillStyle = cloth; ctx.fillRect(204, 4, 24, 156);
      ctx.strokeStyle = '#432934'; ctx.lineWidth = 2; ctx.strokeRect(204, 4, 24, 156);
      ctx.strokeStyle = ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(208, 25); ctx.lineTo(224, 25); ctx.moveTo(208, 31); ctx.lineTo(224, 31); ctx.moveTo(208, 137); ctx.lineTo(224, 137); ctx.moveTo(208, 143); ctx.lineTo(224, 143); ctx.stroke();
      stamp(ctx, cropped, 216, 84, 16, 30, ink);

      const proof = new OffscreenCanvas(24, 36);
      const proofCtx = proof.getContext('2d', { willReadFrequently: true });
      stamp(proofCtx, cropped, 12, 18, 16, 30, '#000');
      const pixels = proofCtx.getImageData(0, 0, 24, 36).data;
      let occupied = 0;
      let signature = '';
      for (let i = 3; i < pixels.length; i += 4) {
        const on = pixels[i] > 24;
        if (on) occupied += 1;
        signature += on ? '1' : '0';
      }
      if (occupied < 18) throw new Error(`${master.id} disappears at spine scale (${occupied}px)`);
      if (signatures.has(signature)) throw new Error(`${master.id} duplicates another spine silhouette`);
      signatures.add(signature);

      ctx.fillStyle = '#6f5858'; ctx.font = '11px Nunito Sans, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('cover', 74, 171); ctx.fillText('24 px', 216, 171);
    }
    return { count: loaded.length, uniqueSpines: signatures.size };
  }, { url, masters });

  if (errors.length) throw new Error(errors.join('\n'));
  if (result.count !== 29 || result.uniqueSpines !== 29) throw new Error(JSON.stringify(result));
  await page.screenshot({ path: output, fullPage: true });
  console.log(`IMAGEGEN EMBLEM BOARD OK · ${result.count} masters · ${result.uniqueSpines} unique spine silhouettes · ${output}`);
} finally {
  await browser.close();
}
