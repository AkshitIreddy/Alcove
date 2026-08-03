/**
 * shots-now/plates-board.mjs — the 50 lettering-piece treatments, on a real
 * spine, at the size a reader meets them.
 *
 * Nothing synthetic: every cell is `renderSpine` on the same seed, the same
 * plain-cloth binding and the same title, with ONLY `titlePlate` changed. That
 * is the path the shelf takes, so a plate that the compartment refuses (a
 * sliver, a plate too small to letter) refuses here too instead of being
 * flattered by a specimen drawn on its own.
 *
 * A spine is 34 world px wide, baked at the hi scale (2 device px per world
 * px), and the shelf rests at zoom 0.8 — so the plate is about 27 SCREEN PIXELS
 * across and the lettering inside it about 16. Both boards are shown:
 *
 *   plates-<tag>-rest.png   resting on-screen size, downsampled the way the GPU
 *                           does it, then 4× nearest-neighbour so it is visible
 *   plates-<tag>-bake.png   the baked texels 1:1 at 2× — what max zoom shows
 *
 * Usage: node shots-now/plates-board.mjs [--tag=before] [--url=…]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const TAG = opt('tag', 'before');

mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
// The handwriting faces are what the title is set in; an unloaded face
// silently falls back to a system serif and the board lies about the fit.
await page.evaluate(() => document.fonts.ready);

await page.evaluate(async () => {
  const sp = await import('/src/art/spines.ts');
  const flat = await import('/src/art/flat.ts');

  const WORLD_W = 34;
  const WORLD_H = 190;
  const BAKE = 2;
  const REST = 0.8;
  const PAD = 6;

  const base = sp.deriveSpineParams(0x51e5a3);

  function bakeSpine(plate) {
    const w = Math.round(WORLD_W * BAKE);
    const h = Math.round(WORLD_H * BAKE);
    const c = document.createElement('canvas');
    c.width = w + PAD * 2;
    c.height = h + PAD * 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = flat.FLAT.recess;
    ctx.fillRect(0, 0, c.width, c.height);
    const params = {
      ...base,
      w: WORLD_W,
      binding: 'plain-cloth',
      titlePlate: plate,
      ornamentOn: false,
      charm: null,
      palette: 12,
      gilt: false,
    };
    sp.renderSpine(ctx, params, PAD, PAD, h, BAKE, 'Marginalia', { hiRes: true });
    return c;
  }

  function rest(baked) {
    const c = document.createElement('canvas');
    c.width = Math.round((baked.width / BAKE) * REST);
    c.height = Math.round((baked.height / BAKE) * REST);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(baked, 0, 0, c.width, c.height);
    return c;
  }

  const ground = flat.FLAT.recess;
  document.body.innerHTML = '';
  document.body.style.cssText = `margin:0;background:${ground};`;
  const cap = (t) => {
    const d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = 'margin-top:2px;line-height:1.1;text-align:center;width:100%;';
    return d;
  };

  const baked = sp.TITLE_PLATES.map((id) => [id, bakeSpine(id)]);

  const restBoard = document.createElement('div');
  restBoard.id = 'rest-board';
  restBoard.style.cssText =
    `display:grid;grid-template-columns:repeat(13,1fr);gap:8px 4px;padding:14px;background:${ground};` +
    'width:max-content;font:10px "Nunito Sans",system-ui,sans-serif;color:#4f3120;';
  for (const [id, b] of baked) {
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
    const r = rest(b);
    r.style.cssText = `width:${r.width * 3}px;height:${r.height * 3}px;image-rendering:pixelated;display:block;`;
    cell.append(r, cap(id));
    restBoard.append(cell);
  }
  document.body.append(restBoard);

  const bakeBoard = document.createElement('div');
  bakeBoard.id = 'bake-board';
  bakeBoard.style.cssText = restBoard.style.cssText;
  for (const [id, b] of baked) {
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
    b.style.cssText = `width:${b.width * 1.4}px;height:${b.height * 1.4}px;image-rendering:pixelated;display:block;`;
    cell.append(b, cap(id));
    bakeBoard.append(cell);
  }
  document.body.append(bakeBoard);
});

await page.waitForTimeout(700);
for (const [id, name] of [
  ['#rest-board', 'rest'],
  ['#bake-board', 'bake'],
]) {
  const path = `shots-now/out/plates-${TAG}-${name}.png`;
  await page.locator(id).screenshot({ path });
  console.log(`  shot ${path}`);
}
await browser.close();
