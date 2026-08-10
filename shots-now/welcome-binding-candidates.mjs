/**
 * Focused Welcome replacement board: exact spine + front cover through the
 * production resolvers, rendered against the existing Vite server.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1760, height: 980 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:1420/?fx=force', {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});

await page.evaluate(async () => {
  const [styleModule, spineModule, coverModule, seedModule] = await Promise.all([
    import('/src/art/bookStyle.ts'),
    import('/src/art/spines.ts'),
    import('/src/art/covers.ts'),
    import('/src/data/seed.ts'),
  ]);
  const { resolveBookStyle } = styleModule;
  const { renderSpine } = spineModule;
  const { renderCover } = coverModule;
  const { WELCOME_BINDING, WELCOME_SPINE_SEED } = seedModule;

  const quiet = {
    ...WELCOME_BINDING,
    headTail: false,
    charm: 'none',
    cornerProtectors: false,
    insetPlate: false,
  };
  const candidates = [
    {
      label: 'Current — Grand Crown Velvet',
      binding: 'velvet-ducal',
      style: quiet,
    },
    {
      label: 'Russia Folio — foliate lozenge',
      binding: 'russia-folio',
      style: { ...quiet, raisedBands: 2, ornament: 0, coverMedallion: 0, coverFrame: 48 },
    },
    {
      label: 'Oxford Calf — oak & acorn',
      binding: 'oxford-calf',
      style: { ...quiet, raisedBands: 2, ornament: 13, coverMedallion: 13, coverFrame: 6 },
    },
    {
      label: 'Gilt Quarto — foliate lozenge',
      binding: 'gilt-quarto',
      style: { ...quiet, raisedBands: 2, ornament: 0, coverMedallion: 0, coverFrame: 48 },
    },
    {
      label: 'Calf Compartments — starflower',
      binding: 'calf-compartments',
      style: { ...quiet, raisedBands: 0, ornament: 2, coverMedallion: 2, coverFrame: 35 },
    },
  ];

  document.head.innerHTML = `<style>
    *{box-sizing:border-box} body{margin:0;padding:24px;background:#7c5739;color:#2d211a;font-family:Georgia,serif}
    h1{margin:0 0 20px;color:#f7ead0;font-size:28px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}
    .card{background:#e8dac0;border:2px solid #35271f;border-radius:12px;padding:14px;box-shadow:0 6px 0 #4a3427}
    h2{height:48px;margin:0 0 12px;text-align:center;font-size:17px;line-height:1.25}
    .art{height:760px;display:flex;align-items:flex-end;justify-content:center;gap:10px}
    .spine{width:62px;height:500px;image-rendering:auto}.cover{width:240px;height:690px;object-fit:contain;image-rendering:auto}
  </style>`;
  document.body.innerHTML = '<h1>Welcome binding replacement — production pixels</h1><main class="grid"></main>';
  const grid = document.querySelector('.grid');
  for (const candidate of candidates) {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<h2>${candidate.label}</h2><div class="art"><canvas class="spine" width="124" height="1000"></canvas><img class="cover"></div>`;
    grid.append(card);
    const resolved = resolveBookStyle(
      WELCOME_SPINE_SEED,
      undefined,
      candidate.style,
      { binding: candidate.binding },
    );
    const spine = card.querySelector('.spine');
    renderSpine(spine.getContext('2d'), { ...resolved.spine, binding: candidate.binding }, 8, 18, 944, 2);
    const cover = renderCover(480, 690, resolved.cover, 'WELCOME TO ALCOVE ✎');
    card.querySelector('.cover').src = cover.toDataURL('image/png');
  }
});

await page.screenshot({ path: 'shots-now/out/welcome-binding-candidates.png', fullPage: true });
await browser.close();
console.log('shots-now/out/welcome-binding-candidates.png');
