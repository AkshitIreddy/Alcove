import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1200 }, deviceScaleFactor: 1.25 });
page.on('pageerror', (error) => console.error('[pageerror]', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('[console]', message.text());
});

await page.goto('http://127.0.0.1:1420', { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const { REMASTERED_FRAME_MASTERS, paintRemasteredFrame } = await import('/src/art/bookFrameArtwork.ts?frameqa=2');
  if (REMASTERED_FRAME_MASTERS.length !== 18) throw new Error('Expected all 18 active cover frames');
  const palettes = [
    { face: '#384f49', ground: '#273c38', ink: '#172826', tooling: '#e0c17d' },
    { face: '#7f4038', ground: '#69322d', ink: '#3a2425', tooling: '#e5c582' },
    { face: '#263f5b', ground: '#1c3048', ink: '#142438', tooling: '#d9b66c' },
    { face: '#6a5940', ground: '#564831', ink: '#30291f', tooling: '#ecd49b' },
  ];

  document.head.innerHTML = `<style>
    *{box-sizing:border-box} body{margin:0;background:#e9dcc4;color:#3d2930;font-family:Georgia,serif}
    main{padding:30px 34px 42px} h1{margin:0;font-size:30px;font-weight:400;letter-spacing:.02em}
    .dek{margin:7px 0 24px;color:#725c56;font-size:15px}
    .board{display:grid;grid-template-columns:repeat(6,1fr);gap:18px}
    figure{margin:0;padding:12px 12px 10px;background:#f4ead7;border:1px solid #c9b894;border-radius:4px}
    canvas{display:block;width:100%;height:auto;border-radius:2px}
    figcaption{min-height:44px;padding:9px 2px 0;text-align:center;font-size:13px;line-height:1.25}
    figcaption b{display:block;font-size:14px;font-weight:400} figcaption small{color:#927a6e}
  </style>`;
  document.body.innerHTML = `<main><h1>Alcove · remastered cover frames</h1>
    <p class="dek">All 18 reader-facing identities · individual authored masters · live canvas renderer</p>
    <div class="board"></div></main>`;
  const board = document.querySelector('.board');
  for (const [position, master] of REMASTERED_FRAME_MASTERS.entries()) {
    const a = master.titleAperture;
    if (a.x < 0 || a.y < 0 || a.width <= 0 || a.height <= 0 || a.x + a.width > 1 || a.y + a.height > 1) {
      throw new Error(`Unsafe title aperture for ${master.id}`);
    }
    const palette = palettes[position % palettes.length];
    const figure = document.createElement('figure');
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 560;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = palette.face;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!paintRemasteredFrame(ctx, 15, 14, 370, 532, master.index, palette, true)) {
      throw new Error(`Missing painter for ${master.id}`);
    }
    figure.append(canvas);
    figure.insertAdjacentHTML('beforeend', `<figcaption><b>${master.label}</b><small>${master.index} · ${master.id}</small></figcaption>`);
    board.append(figure);
  }
});

await page.locator('main').screenshot({ path: 'shots-now/out/book-frame-remaster-v2.png' });
await browser.close();
