/**
 * shots-now/charm-covers.mjs — the CHARM as the pull-out board paints it.
 *
 * `art/covers.ts` used to fold the colourway index through a table of its own,
 * so a book's ribbon was one colour on the shelf and another in the hand. It
 * now reads `charms.charmCloth`, the same function the spine reads. This board
 * paints real covers through `renderCover` at a spread of colourways so that
 * disagreement, if it ever comes back, is visible rather than argued about.
 *
 * It also paints a row with a HEX in the colourway slot instead of an index —
 * the shape a reader's own colour will arrive in — to show the cover honours it
 * rather than falling back to the first entry.
 *
 * Usage: node shots-now/charm-covers.mjs [out.png]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'shots-now/charm-covers.png';

const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:1420/', { waitUntil: 'domcontentloaded' });

const size = await p.evaluate(async () => {
  const charms = await import('/src/art/charms.ts');
  const covers = await import('/src/art/covers.ts');
  const flat = await import('/src/art/flat.ts');

  document.body.innerHTML = '';
  document.body.style.margin = '0';

  const slots = [0, 3, 5, 8, 11, 14, 17, 20, 23, '#3f7a5c', '#b0184f', '#111111'];
  const CW = 168;
  const CH = Math.round(CW / covers.COVER_ASPECT);
  const cols = 6;
  const PAD = 24;
  const rows = Math.ceil(slots.length / cols);
  const W = PAD * 2 + cols * (CW + 18);
  const H = PAD * 2 + 46 + rows * (CH + 44);

  const cvs = document.createElement('canvas');
  cvs.width = W;
  cvs.height = H;
  cvs.style.width = `${W}px`;
  document.body.append(cvs);
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = flat.FLAT.wall;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = flat.FLAT.ink;
  ctx.font = '600 20px "Nunito Sans", system-ui, sans-serif';
  ctx.fillText('the charm on the board — nine table entries, then three raw hexes', PAD, PAD + 20);

  slots.forEach((slot, i) => {
    const x = PAD + (i % cols) * (CW + 18);
    const y = PAD + 46 + Math.floor(i / cols) * (CH + 44);
    const params = covers.deriveCoverParams(0x51f00d + i * 977, {
      charm: 'ribbon',
      charmColor: slot,
      palette: (i * 7) % covers.COVER_PALETTE_COUNT,
      gilt: true,
    });
    const board = covers.renderCover(CW, CH, params, 'Ribbon');
    ctx.drawImage(board, x, y);
    ctx.fillStyle = flat.FLAT.ink;
    ctx.font = '600 13px "Nunito Sans", system-ui, sans-serif';
    const name =
      typeof slot === 'number' ? `${slot}. ${charms.CHARM_COLOR_LABELS[slot]}` : `hex ${slot}`;
    ctx.fillText(name, x, y + CH + 18);
    ctx.fillStyle = flat.FLAT.inkSoft;
    ctx.font = '500 11px ui-monospace, monospace';
    ctx.fillText(charms.charmCloth(slot).join(' / '), x, y + CH + 34);
  });

  return { w: W, h: H };
});

await p.setViewportSize({ width: size.w, height: size.h });
await p.locator('canvas').first().screenshot({ path: out });
console.log(`done -> ${out} (${size.w}x${size.h})`);
await b.close();
