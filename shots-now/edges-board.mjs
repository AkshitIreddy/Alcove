/**
 * shots-now/edges-board.mjs — the 50 text-block edge treatments, at the width
 * they are actually seen: a sliver.
 *
 * `art/covers.ts` lays the block at `pageW = max(4, w * 0.055)` and then covers
 * 38% of it with the board, so on the Book Studio's ~142px board the reader
 * sees a strip about FIVE PIXELS wide and the whole height of the book. That is
 * the entire canvas an edge treatment gets, and the reason the table's own
 * header says an entry is judged on one question: does it change the colour or
 * the rhythm of that sliver?
 *
 * Two boards:
 *   edges-<tag>-strip.png  the fore-edge column cropped out of a real cover
 *                          render, 50 of them side by side at 1:1 and then
 *                          again at 4× nearest-neighbour, captioned.
 *   edges-<tag>-cover.png  eight whole covers, so the strip is seen in place
 *                          rather than as an abstract ribbon.
 *
 * `--via=spec` boards `drawBlockEdge` (the drawer that lives with the specs in
 * `art/spines.ts`) instead of the cover, which is how the specs are looked at
 * before anything downstream reads them.
 *
 * Usage: node shots-now/edges-board.mjs [--tag=before] [--via=cover|spec] [--url=…]
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
const VIA = opt('via', 'cover');

mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => document.fonts.ready);

await page.evaluate(async (via) => {
  const sp = await import('/src/art/spines.ts');
  const cv = await import('/src/art/covers.ts');
  const flat = await import('/src/art/flat.ts');

  /* The Book Studio's real preview geometry, at dpr 1. */
  const BOOK_H = 197;
  const BOARD_W = Math.round(BOOK_H * cv.COVER_ASPECT); // ≈ 142
  const PAGE_W = Math.max(4, BOARD_W * 0.055); // ≈ 7.8, of which 62% shows
  const CROP = Math.ceil(PAGE_W) + 6; // the sliver plus a little board

  const base = cv.deriveCoverParams(0x51e5a3);

  function bakeCover(edgeId) {
    const c = document.createElement('canvas');
    c.width = BOARD_W;
    c.height = BOOK_H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = flat.FLAT.recess;
    ctx.fillRect(0, 0, c.width, c.height);
    cv.renderCoverInto(ctx, BOARD_W, BOOK_H, { ...base, edge: edgeId, palette: 12 }, 'Marginalia');
    return c;
  }

  /** The fore-edge column, cropped out of whatever painted it. */
  function stripOf(edgeId) {
    const c = document.createElement('canvas');
    c.width = CROP;
    c.height = BOOK_H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = flat.FLAT.recess;
    ctx.fillRect(0, 0, c.width, c.height);
    if (via === 'spec' && typeof sp.drawBlockEdge === 'function') {
      const pad = BOARD_W * 0.016;
      sp.drawBlockEdge(
        ctx,
        CROP - Math.ceil(PAGE_W) - 2,
        BOOK_H * 0.03,
        PAGE_W,
        BOOK_H * 0.93,
        sp.edgeSpec(edgeId),
        0x51e5a3 + 21,
      );
    } else {
      ctx.drawImage(bakeCover(edgeId), BOARD_W - CROP, 0, CROP, BOOK_H, 0, 0, CROP, BOOK_H);
    }
    return c;
  }

  const ground = flat.FLAT.recess;
  document.body.innerHTML = '';
  document.body.style.cssText = `margin:0;background:${ground};`;

  /** The top third of a strip, blown up so the marks can be counted. */
  function zoomOf(strip, factor) {
    const srcH = Math.round(BOOK_H / 3);
    const c = document.createElement('canvas');
    c.width = strip.width * factor;
    c.height = srcH * factor;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(strip, 0, 0, strip.width, srcH, 0, 0, c.width, c.height);
    return c;
  }

  /* ---- board 1: fifty slivers at 1:1, each beside its own 5× head ---- */
  const board = document.createElement('div');
  board.id = 'strip-board';
  board.style.cssText =
    `display:grid;grid-template-columns:repeat(17,1fr);gap:10px 8px;padding:14px;background:${ground};` +
    'width:max-content;font:9px "Nunito Sans",system-ui,sans-serif;color:#4f3120;';
  for (const id of sp.EDGE_TREATMENTS) {
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
    const one = stripOf(id);
    const five = zoomOf(one, 5);
    one.style.cssText = 'display:block;';
    five.style.cssText = 'display:block;image-rendering:pixelated;';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:flex-start;gap:5px;';
    wrap.append(one, five);
    const cap = document.createElement('div');
    cap.textContent = id;
    cap.style.cssText = 'margin-top:2px;text-align:center;max-width:110px;line-height:1.1;';
    cell.append(wrap, cap);
    board.append(cell);
  }
  document.body.append(board);

  /* ---- board 2: eight whole covers ---- */
  const covers = document.createElement('div');
  covers.id = 'cover-board';
  covers.style.cssText =
    `display:flex;gap:8px;padding:14px;background:${ground};width:max-content;` +
    'font:10px "Nunito Sans",system-ui,sans-serif;color:#4f3120;';
  for (const id of ['plain', 'gilt', 'marbled', 'sprinkled', 'deckle', 'two-tone', 'painted-fore-edge', 'foxed']) {
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
    const c = bakeCover(id);
    c.style.cssText = `width:${BOARD_W * 1.6}px;height:${BOOK_H * 1.6}px;image-rendering:pixelated;display:block;`;
    const cap = document.createElement('div');
    cap.textContent = id;
    cap.style.cssText = 'margin-top:3px;';
    cell.append(c, cap);
    covers.append(cell);
  }
  document.body.append(covers);
}, VIA);

await page.waitForTimeout(700);
const suffix = VIA === 'spec' ? '-spec' : '';
for (const [id, name] of [
  ['#strip-board', 'strip'],
  ['#cover-board', 'cover'],
]) {
  const path = `shots-now/out/edges-${TAG}-${name}${suffix}.png`;
  await page.locator(id).screenshot({ path });
  console.log(`  shot ${path}`);
}
await browser.close();
