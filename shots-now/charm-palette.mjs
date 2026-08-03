/**
 * shots-now/charm-palette.mjs — specimen board for the charm colourways.
 *
 * Draws each of `art/charms.CHARM_COLORS` three times, in the three places the
 * app draws it: the studio's swatch chip, the ribbon at the head of a spine
 * (the same `flat.panel` call `spines.drawSpineRibbon` makes), and the cover's
 * ribbon-and-knot pair from `charms.charmCloth`. If those three ever stop
 * agreeing, this board is where you see it.
 *
 * It runs INSIDE the dev server so the modules are the app's own, not a copy
 * transpiled here. `art/spines.ts` is deliberately not imported — the mark it
 * makes is reproduced from its own source below — so the board still renders
 * while somebody else is mid-edit in the binding vocabulary.
 *
 * Usage: node shots-now/charm-palette.mjs [out.png]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'shots-now/charm-palette.png';

const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1480, height: 1180 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:1420/', { waitUntil: 'domcontentloaded' });

const size = await p.evaluate(async () => {
  const charms = await import('/src/art/charms.ts');
  const flat = await import('/src/art/flat.ts');
  const { CHARM_COLORS, CHARM_COLOR_LABELS, charmCloth } = charms;
  const { FLAT, CLOTHS, panel, inkWidth, contactShadow } = flat;

  document.body.innerHTML = '';
  document.body.style.margin = '0';
  const cvs = document.createElement('canvas');
  const cols = 4;
  const rows = Math.ceil(CHARM_COLORS.length / cols);
  const TW = 350;
  const TH = 152;
  const PAD = 26;
  const W = PAD * 2 + TW * cols;
  const H = PAD * 2 + 58 + TH * rows;
  cvs.width = W;
  cvs.height = H;
  cvs.style.width = `${W}px`;
  document.body.append(cvs);
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = FLAT.wall;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = FLAT.ink;
  ctx.font = '600 22px "Nunito Sans", system-ui, sans-serif';
  ctx.fillText(
    `${CHARM_COLORS.length} charm colourways — swatch · ribbon on the spine · cover ribbon + knot`,
    PAD,
    PAD + 24,
  );

  CHARM_COLORS.forEach((hex, i) => {
    const x = PAD + (i % cols) * TW;
    const y = PAD + 58 + Math.floor(i / cols) * TH;

    // --- 1. the studio swatch, painted with the raw table entry -------------
    panel(ctx, x, y + 14, 54, 54, hex, { radius: 13, seed: i * 7 + 1 });

    // --- 2. a spine fragment with the ribbon at its head --------------------
    // Cloth under it changes every tile, so no ribbon gets an easy background.
    const sx = x + 74;
    const sw = 46;
    const sh = 120;
    const cloth = CLOTHS[(i * 7 + 3) % CLOTHS.length];
    contactShadow(ctx, sx, y + sh + 12, sw, 5);
    panel(ctx, sx, y + 12, sw, sh, cloth[0], { radius: 6, seed: i * 13 + 2 });
    // the exact geometry of spines.drawSpineRibbon, at spine width sw
    const rw = Math.max(2, sw * 0.2);
    const rh = Math.min(sh * 0.16, rw * 6);
    panel(ctx, sx + sw * 0.56 - rw / 2, y + 12 - rh * 0.22, rw, rh, hex, {
      radius: rw * 0.42,
      seed: i + 5,
      width: Math.max(1, inkWidth(rw) * 0.8),
    });

    // --- 3. the cover's face + fold ----------------------------------------
    const [face, dark] = charmCloth(i);
    panel(ctx, x + 136, y + 14, 40, 54, face, { radius: 10, seed: i * 3 + 4 });
    panel(ctx, x + 178, y + 14, 40, 54, dark, { radius: 10, seed: i * 3 + 5 });

    ctx.fillStyle = FLAT.ink;
    ctx.font = '600 15px "Nunito Sans", system-ui, sans-serif';
    ctx.fillText(`${i}. ${CHARM_COLOR_LABELS[i]}`, x + 228, y + 32);
    ctx.fillStyle = FLAT.inkSoft;
    ctx.font = '500 12px ui-monospace, monospace';
    ctx.fillText(hex, x + 228, y + 50);
    ctx.fillText(dark, x + 228, y + 66);
  });

  return { w: W, h: H };
});

await p.setViewportSize({ width: size.w, height: size.h });
await p.locator('canvas').first().screenshot({ path: out });
console.log(`done -> ${out} (${size.w}x${size.h})`);
await b.close();
