/**
 * shots-now/shape-board.mjs — the fifty silhouettes, at the size they are
 * really seen, and then big enough to work on.
 *
 * Two boards, because they answer different questions:
 *
 *   shapes-shelf.png   every shape at 34 world px wide, shoulder to shoulder,
 *                      the way a reader meets them. This is the one that tells
 *                      you whether a distinction exists; it is deliberately
 *                      unlabelled and unspaced, because a labelled specimen in
 *                      its own box will always look more distinct than it is.
 *   shapes-detail.png  the same draws upscaled with nearest-neighbour, so what
 *                      you are looking at is exactly the shelf's pixels rather
 *                      than a cleaner redraw at a bigger size.
 *
 * The order is `SPINE_SHAPES`, i.e. picker order: family, then tier. Anything
 * demoted to `oddity` sinks to the end of its family and is drawn with its
 * caption struck, so "the dice cannot hand this out" is visible on the board.
 *
 * Usage: node shots-now/shape-board.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });

await page.evaluate(async () => {
  const bd = await import('/src/art/bookDesign.ts');
  const flat = await import('/src/art/flat.ts');

  const W = 34;
  const H = 200;
  const PAD = 14;
  const base = bd.resolveBookDesign({ seed: 0x51e5, cloth: 3, accent: 11 });

  /** One shape, drawn at true shelf size onto its own little canvas. */
  function draw(shape) {
    const c = document.createElement('canvas');
    c.width = W + PAD * 2;
    c.height = H + PAD * 2;
    const ctx = c.getContext('2d');
    const design = { ...base, shape, material: 'smooth-cloth', decorations: ['plain'] };
    bd.drawBookSpine(ctx, PAD, PAD, W, H, design, { ownLabel: true, noContact: true });
    return c;
  }

  const ground = flat.FLAT?.recess ?? '#e9e2d0';
  document.body.innerHTML = '';
  document.body.style.cssText = `margin:0;background:${ground};`;

  /* ---- board 1: shoulder to shoulder, one to one ---- */
  const shelf = document.createElement('div');
  shelf.id = 'shelf-board';
  shelf.style.cssText =
    `display:flex;align-items:flex-end;gap:1px;padding:18px 14px;background:${ground};width:max-content;`;
  for (const id of bd.SPINE_SHAPES) shelf.append(draw(id));
  document.body.append(shelf);

  /* ---- board 2: the same pixels, four times up, captioned ---- */
  const detail = document.createElement('div');
  detail.id = 'detail-board';
  detail.style.cssText =
    `display:grid;grid-template-columns:repeat(10,1fr);gap:4px 2px;padding:14px;background:${ground};` +
    'width:max-content;font:11px "Nunito Sans",system-ui,sans-serif;color:#4f3120;';
  for (const id of bd.SPINE_SHAPES) {
    const spec = bd.SHAPES[id];
    const cell = document.createElement('div');
    cell.style.cssText = 'text-align:center;';
    const c = draw(id);
    c.style.cssText = `width:${c.width * 2.6}px;height:${c.height * 2.6}px;image-rendering:pixelated;`;
    const cap = document.createElement('div');
    cap.textContent = id;
    cap.style.cssText =
      'margin-top:2px;line-height:1.15;' +
      (spec.tier === 'oddity' ? 'text-decoration:line-through;opacity:.5;' : '');
    cell.append(c, cap);
    detail.append(cell);
  }
  document.body.append(detail);
});

await page.waitForTimeout(700);
await page.locator('#shelf-board').screenshot({ path: 'shots-now/out/shapes-shelf.png' });
await page.locator('#detail-board').screenshot({ path: 'shots-now/out/shapes-detail.png' });
console.log('  shot shots-now/out/shapes-shelf.png');
console.log('  shot shots-now/out/shapes-detail.png');
await browser.close();
