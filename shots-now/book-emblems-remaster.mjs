import { chromium } from 'playwright';

const url = 'http://127.0.0.1:1420';
const output = 'shots-now/out/book-emblems-remaster.png';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
      header { padding: 28px 34px 21px; border-bottom: 3px solid #432934; background: #f2e6ce; }
      h1 { margin: 0; font-size: 34px; font-weight: 400; letter-spacing: .02em; }
      header p { margin: 5px 0 0; font-size: 17px; color: #73595d; }
      main { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; padding: 20px; }
      article { min-height: 235px; padding: 14px 14px 12px; background: #f2e6ce; border: 2px solid #432934; border-radius: 9px 7px 10px 8px; }
      canvas { display: block; width: 100%; height: 166px; }
      h2 { margin: 8px 0 0; font-size: 20px; line-height: 1.05; font-weight: 400; }
      small { display: block; margin-top: 3px; color: #7c6060; font: 11px/1.2 Nunito Sans, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
    </style></head><body>
      <header><h1>Alcove · remastered binder’s tools</h1><p>Every active emblem · the same authored master on a cover and a true 24 px shelf spine</p></header>
      <main id="board"></main>
    </body></html>`);

  const result = await page.evaluate(async () => {
    const module = await import('/src/art/bookEmblemArtwork.ts');
    const catalogue = await import('/src/art/spines.ts');
    const expected = [
      0, 1, 2, 5, 12, 13, 14, 20, 23, 26, 28, 29, 30, 31, 43, 56,
      66, 67, 68, 70, 71, 74, 75, 78, 80, 81, 83, 84, 85,
      86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
      102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114,
      115, 116, 117,
    ];
    if (JSON.stringify(module.REMASTERED_EMBLEM_INDICES) !== JSON.stringify(expected)) {
      throw new Error(`catalogue drift: ${module.REMASTERED_EMBLEM_INDICES.join(',')}`);
    }
    if (JSON.stringify(module.REMASTERED_EMBLEM_INDICES) !== JSON.stringify(catalogue.ACTIVE_ORNAMENT_INDICES)) {
      throw new Error('remastered indices no longer match the live studio catalogue');
    }
    for (const { index, label } of catalogue.ACTIVE_ORNAMENTS) {
      if (module.BOOK_EMBLEM_MASTERS[index]?.label !== label) {
        throw new Error(`identity drift at ${index}: ${module.BOOK_EMBLEM_MASTERS[index]?.label} != ${label}`);
      }
    }
    const sources = module.REMASTERED_EMBLEM_INDICES.map((index) => module.BOOK_EMBLEM_MASTERS[index].source);
    if (new Set(sources).size !== expected.length) throw new Error('two catalogue entries share one SVG master');
    const cloths = ['#455e63', '#813f47', '#6d6241', '#546147', '#614c68', '#31606b'];
    const inks = ['#f0ce78', '#f2e6ce', '#e7c85b'];
    const board = document.querySelector('#board');

    const spineSilhouettes = new Set();
    for (const [position, index] of module.REMASTERED_EMBLEM_INDICES.entries()) {
      const master = module.BOOK_EMBLEM_MASTERS[index];
      const article = document.createElement('article');
      const canvas = document.createElement('canvas');
      canvas.width = 310;
      canvas.height = 166;
      const heading = document.createElement('h2');
      const meta = document.createElement('small');
      heading.textContent = master.label;
      meta.textContent = `${String(index).padStart(2, '0')} · ${master.id}`;
      article.append(canvas, heading, meta);
      board.append(article);

      const ctx = canvas.getContext('2d');
      const cloth = cloths[position % cloths.length];
      const ink = inks[position % inks.length];

      // Cover specimen: 124 x 154 CSS px. The emblem is 76 px across.
      ctx.fillStyle = '#bfa785';
      ctx.fillRect(23, 7, 126, 156);
      ctx.fillStyle = cloth;
      ctx.fillRect(20, 4, 124, 154);
      ctx.strokeStyle = '#432934';
      ctx.lineWidth = 3;
      ctx.strokeRect(20, 4, 124, 154);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(29, 13, 106, 136);
      ctx.beginPath();
      ctx.moveTo(40, 41); ctx.lineTo(124, 41);
      ctx.moveTo(46, 48); ctx.lineTo(118, 48);
      ctx.stroke();
      module.paintRemasteredEmblem(ctx, index, 82, 101, 38, ink);

      // Real shelf specimen: a deliberately narrow 24 x 154 CSS px spine.
      ctx.fillStyle = '#bfa785';
      ctx.fillRect(215, 7, 26, 156);
      ctx.fillStyle = cloth;
      ctx.fillRect(212, 4, 24, 154);
      ctx.strokeStyle = '#432934';
      ctx.lineWidth = 2;
      ctx.strokeRect(212, 4, 24, 154);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(216, 25); ctx.lineTo(232, 25);
      ctx.moveTo(216, 31); ctx.lineTo(232, 31);
      ctx.moveTo(216, 137); ctx.lineTo(232, 137);
      ctx.moveTo(216, 143); ctx.lineTo(232, 143);
      ctx.stroke();
      module.paintRemasteredEmblem(ctx, index, 224, 83, 8, ink);

      // Guard the real-scale contract independently of the decorative board:
      // every master must leave a visible and distinct 16 px impression.
      const proof = document.createElement('canvas');
      proof.width = 24;
      proof.height = 24;
      const proofCtx = proof.getContext('2d');
      module.paintRemasteredEmblem(proofCtx, index, 12, 12, 8, '#000000');
      const pixels = proofCtx.getImageData(0, 0, 24, 24).data;
      let occupied = 0;
      let signature = '';
      for (let i = 3; i < pixels.length; i += 4) {
        const on = pixels[i] > 24;
        if (on) occupied += 1;
        signature += on ? '1' : '0';
      }
      if (occupied < 18) throw new Error(`${index}:${master.id} disappears at spine scale (${occupied}px)`);
      if (spineSilhouettes.has(signature)) throw new Error(`${index}:${master.id} duplicates another spine silhouette`);
      spineSilhouettes.add(signature);

      ctx.fillStyle = '#6f5858';
      ctx.font = '12px Nunito Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('cover', 82, 164);
      ctx.fillText('24 px', 224, 164);
    }
    return { count: module.REMASTERED_EMBLEM_INDICES.length, uniqueSpines: spineSilhouettes.size };
  });

  if (errors.length) throw new Error(errors.join('\n'));
  if (result.count !== 61) throw new Error(`expected 61 masters, got ${result.count}`);
  if (result.uniqueSpines !== 61) throw new Error(`expected 61 unique spine silhouettes, got ${result.uniqueSpines}`);
  await page.screenshot({ path: output, fullPage: true });
  console.log(`BOOK EMBLEM BOARD OK · ${result.count} masters · ${result.uniqueSpines} unique spine silhouettes · ${output}`);
} finally {
  await browser.close();
}
