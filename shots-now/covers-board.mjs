/**
 * shots-now/covers-board.mjs — every cover frame and medallion on one sheet.
 *
 * The cover is the one surface seen LARGE — the pull-out overlay and the open
 * book — so it is also the one where a lazy vocabulary is most obvious. Fifty
 * frames that turn out to be four frames with different corner dots would be
 * invisible in a count and unmissable on a board.
 *
 * Rendered through the real renderCoverInto, in a browser, because that is the
 * renderer that ships. Usage: node shots-now/covers-board.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });

// Served by the dev server, so the module graph resolves exactly as the app's.
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);

const shot = async (mode, file, count, cols) => {
  await p.evaluate(
    async ([mode, count, cols]) => {
      const covers = await import('/src/art/covers.ts');
      document.body.innerHTML = '';
      document.body.style.cssText =
        'margin:0;background:#e9e2d0;display:flex;flex-wrap:wrap;gap:6px;padding:10px';
      const W = Math.floor((1480 - cols * 6) / cols);
      const H = Math.round(W / 0.72);
      for (let i = 0; i < count; i++) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        document.body.appendChild(c);
        covers.renderCoverInto(
          c.getContext('2d'),
          W,
          H,
          {
            seed: 0x51ee + i * 7919,
            palette: mode === 'frame' ? 12 : (i * 3) % 50,
            texture: 0,
            frame: mode === 'frame' ? i : 3,
            medallion: mode === 'frame' ? 0 : i,
            titleFont: 0,
            gilt: true,
          },
          'Bellanote',
        );
      }
    },
    [mode, count, cols],
  );
  await p.waitForTimeout(1500);
  await p.screenshot({ path: file, fullPage: true });
  console.log('->', file);
};

await shot('frame', 'shots-now/cover-frames.png', 50, 10);
await shot('medallion', 'shots-now/cover-medallions.png', 50, 10);
await b.close();
