/**
 * shots-now/ornaments-board.mjs — every binder's-brass stamp at the size
 * they are actually struck, and then big enough to work on.
 *
 * The size matters more here than anywhere else in the app. A stamp is
 * `min(decor.w * 0.3, 13 * scale, …)` half-size, so on an ordinary 34-world-px
 * octavo baked at the hi scale (2 device px per world px) it is s ≈ 18 canvas
 * px — a mark 37 canvas px across, which the shelf then draws at its resting
 * zoom of 0.8 and turns into FIFTEEN SCREEN PIXELS. Judging these at 300px is
 * how a table of fifty came to contain marks that are four grey pixels.
 *
 * Three boards (the count is read from `ORNAMENT_LABELS`, never typed here):
 *   ornaments-<tag>-rest.png    every stamp at the resting on-screen size,
 *                               downsampled the way the GPU does it, then
 *                               blown up 4× nearest-neighbour so a human can
 *                               see the pixels that a reader actually gets.
 *   ornaments-<tag>-bake.png    the baked texels 1:1 (what max zoom shows),
 *                               captioned.
 *   ornaments-<tag>-row.png     shoulder to shoulder at resting size, no
 *                               labels, no gaps — the only board that can tell
 *                               you whether two stamps are distinguishable.
 *
 * Usage: node shots-now/ornaments-board.mjs [--tag=before] [--url=…]
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
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
/*
 * These four boards draw straight out of `art/`; they never touch the shelf, so
 * waiting on `__shelfWorld` made them hostage to whether the whole app happened
 * to boot. It stopped a measuring run dead while another agent's half-saved
 * module was on the dev server, and the thing being measured was fine the whole
 * time. Wait for the module the board actually imports instead.
 */
await page.waitForFunction(
  () =>
    import('/src/art/flat.ts').then(
      () => true,
      () => false,
    ),
  null,
  { polling: 500 },
);

await page.evaluate(async () => {
  const sp = await import('/src/art/spines.ts');
  const flat = await import('/src/art/flat.ts');
  const noise = await import('/src/art/noise.ts');

  /* The numbers `drawSpineOrnament` really uses on a 34-world-px octavo. */
  const WORLD_W = 34;
  const BAKE = 2; // HI_SCALE_BASE × dpr 1
  const REST = 0.8; // the shelf's resting zoom
  const TILE_W = Math.round(WORLD_W * BAKE); // 68 baked texels across
  const TILE_H = 84;
  const S = Math.min(TILE_W * 0.9 * 0.3, 13 * BAKE); // ≈ 18

  const cloth = flat.CLOTHS[7]?.[0] ?? '#8c4a3a'; // oxblood, a mid cloth
  const ink = flat.FLAT.inkSoft;

  /** One stamp, baked exactly as the spine bakes it. */
  function bakeStamp(kind) {
    const c = document.createElement('canvas');
    c.width = TILE_W;
    c.height = TILE_H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = cloth;
    ctx.fillRect(0, 0, TILE_W, TILE_H);
    ctx.save();
    ctx.lineWidth = Math.max(1, S * 0.17);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    sp.drawOrnament(ctx, kind, TILE_W / 2, TILE_H / 2, S, noise.mulberry32((0x0c17 + kind) >>> 0));
    ctx.restore();
    return c;
  }

  /** The same pixels as the reader gets them at rest: bake → GPU downscale. */
  function restStamp(baked) {
    const w = Math.round(WORLD_W * REST);
    const h = Math.round((TILE_H / BAKE) * REST);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(baked, 0, 0, w, h);
    return c;
  }

  const ground = flat.FLAT?.recess ?? '#e9e2d0';
  document.body.innerHTML = '';
  document.body.style.cssText = `margin:0;background:${ground};`;
  const cap = (t) => {
    const d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = 'margin-top:2px;line-height:1.1;text-align:center;';
    return d;
  };

  const baked = sp.ORNAMENT_LABELS.map((_, i) => bakeStamp(i));

  /* ---- board 1: resting size, blown up 4× nearest-neighbour ---- */
  const rest = document.createElement('div');
  rest.id = 'rest-board';
  rest.style.cssText =
    `display:grid;grid-template-columns:repeat(10,1fr);gap:6px 4px;padding:14px;background:${ground};` +
    'width:max-content;font:11px "Nunito Sans",system-ui,sans-serif;color:#4f3120;';
  baked.forEach((b, i) => {
    const cell = document.createElement('div');
    const r = restStamp(b);
    r.style.cssText = `width:${r.width * 4}px;height:${r.height * 4}px;image-rendering:pixelated;display:block;`;
    cell.append(r, cap(`${i} ${sp.ORNAMENT_LABELS[i]}`));
    rest.append(cell);
  });
  document.body.append(rest);

  /* ---- board 2: baked texels 1:1, 2× so the grid is readable ---- */
  const bake = document.createElement('div');
  bake.id = 'bake-board';
  bake.style.cssText = rest.style.cssText;
  baked.forEach((b, i) => {
    const cell = document.createElement('div');
    b.style.cssText = `width:${b.width * 2}px;height:${b.height * 2}px;image-rendering:pixelated;display:block;`;
    cell.append(b, cap(`${i} ${sp.ORNAMENT_LABELS[i]}`));
    bake.append(cell);
  });
  document.body.append(bake);

  /* ---- board 3: shoulder to shoulder at resting size, unlabelled ---- */
  const row = document.createElement('div');
  row.id = 'row-board';
  row.style.cssText =
    `display:flex;flex-wrap:wrap;width:${Math.round(WORLD_W * REST) * 25}px;padding:12px;background:${ground};`;
  sp.ORNAMENT_LABELS.forEach((_, i) => row.append(restStamp(bakeStamp(i))));
  document.body.append(row);
});

await page.waitForTimeout(600);
for (const [id, name] of [
  ['#rest-board', 'rest'],
  ['#bake-board', 'bake'],
  ['#row-board', 'row'],
]) {
  const path = `shots-now/out/ornaments-${TAG}-${name}.png`;
  await page.locator(id).screenshot({ path });
  console.log(`  shot ${path}`);
}
await browser.close();
