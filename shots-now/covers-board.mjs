/**
 * shots-now/covers-board.mjs — every cover vocabulary on one sheet each.
 *
 * The cover is the one surface seen LARGE — the pull-out overlay and the open
 * book — so it is also the one where a lazy vocabulary is most obvious. Fifty
 * frames that turn out to be four frames with different corner dots would be
 * invisible in a count and unmissable on a board.
 *
 * ## It refuses to pass vacuously
 *
 * A grid of fifty cells proves nothing on its own: fifty names folding onto six
 * pictures produce a grid that LOOKS full. So every board hashes each cell's
 * pixels and reports how many of the fifty are actually distinct, naming the
 * ones that collide. That is the check the coverings needed most — they were
 * fifty names reaching only `MaterialSpec.body`, which is six tones, and the
 * board would have looked fine.
 *
 * Rendered through the real renderCoverInto, in a browser, because that is the
 * renderer that ships. The webfonts are LOADED first: canvas does not trigger a
 * font load, so a hands board drawn without this is fifty cells of the generic
 * fallback lying about a table that works.
 *
 * Usage: node shots-now/covers-board.mjs
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * `node shots-now/covers-board.mjs before` writes the size sheets under
 * `shots-now/out/before-*`; anything else (or nothing) writes `after-*`. The
 * grids at the top of this file always overwrite themselves — they are the
 * vacuity check, not the evidence.
 */
const TAG = process.argv[2] === 'before' ? 'before' : 'after';
mkdirSync('shots-now/out', { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });

// Served by the dev server, so the module graph resolves exactly as the app's.
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);

/** Every face a hand can ask for, at every weight and slope one asks for. */
await p.evaluate(async () => {
  const faces = [
    '"Caveat Variable"',
    '"Kalam"',
    '"Patrick Hand"',
    '"Architects Daughter"',
    '"Nunito Sans"',
  ];
  const jobs = [];
  for (const f of faces) {
    for (const w of [300, 400, 600, 700, 800]) {
      for (const s of ['', 'italic ']) jobs.push(document.fonts.load(`${s}${w} 30px ${f}`));
    }
  }
  await Promise.all(jobs.map((j) => j.catch(() => {})));
  await document.fonts.ready;
});

const failures = [];

/**
 * Draw one cell per label, hash each, screenshot the sheet.
 *
 * `cell(i)` returns the CoverParams for one cell; `labels[i]` is its caption
 * and the name a collision is reported under. `expect` is how many of the cells
 * must be visually distinct — a number below the count where two entries of the
 * vocabulary legitimately draw the same board, never as a way of excusing a
 * fold.
 */
const board = async (file, labels, cols, cell, expect, opts = {}) => {
  const { title = 'Bellanote', captions = true } = opts;
  const count = labels.length;
  const result = await p.evaluate(
    async ([count, cols, cellSrc, labels, title, captions]) => {
      const covers = await import('/src/art/covers.ts');
      const cell = new Function('return ' + cellSrc)();
      const label = (i) => labels[i];
      document.body.innerHTML = '';
      document.body.style.cssText =
        'margin:0;background:#e9e2d0;display:flex;flex-wrap:wrap;gap:6px;padding:10px;' +
        'font:11px system-ui;color:#4f3120';
      const W = Math.floor((1470 - cols * 10) / cols);
      const H = Math.round(W / 0.72);
      const hashes = [];
      for (let i = 0; i < count; i++) {
        const box = document.createElement('div');
        box.style.cssText = `width:${W}px;text-align:center`;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        box.appendChild(c);
        if (captions) {
          const cap = document.createElement('div');
          cap.textContent = `${i} ${label(i)}`;
          cap.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          box.appendChild(cap);
        }
        document.body.appendChild(box);
        const ctx = c.getContext('2d');
        covers.renderCoverInto(ctx, W, H, cell(i), title);
        // FNV-1a over every fourth pixel: enough to separate two boards that
        // differ by one run of grain, cheap enough to run fifty times.
        const px = ctx.getImageData(0, 0, W, H).data;
        let hash = 0x811c9dc5;
        for (let k = 0; k < px.length; k += 16) {
          hash ^= px[k];
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        hashes.push(hash);
      }
      const byHash = new Map();
      hashes.forEach((hsh, i) => byHash.set(hsh, [...(byHash.get(hsh) ?? []), i]));
      return {
        distinct: byHash.size,
        collisions: [...byHash.values()]
          .filter((g) => g.length > 1)
          .map((g) => g.map((i) => `${i} ${label(i)}`).join(' = ')),
      };
    },
    [count, cols, cell.toString(), labels, title, captions],
  );
  await p.waitForTimeout(600);
  await p.screenshot({ path: file, fullPage: true });
  const ok = result.distinct >= expect;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${file}: ${result.distinct}/${count} distinct (need ${expect})`,
  );
  for (const c of result.collisions) console.log(`       collide: ${c}`);
  if (!ok) failures.push(`${file}: only ${result.distinct}/${count} distinct, wanted ${expect}`);
};

/* ---- the two vocabularies that were already fifty ---- */

const FRAME_LABELS = await p.evaluate(async () => {
  const covers = await import('/src/art/covers.ts');
  return [...covers.FRAME_LABELS];
});

await board(
  'shots-now/cover-frames.png',
  FRAME_LABELS,
  10,
  (i) => ({
    seed: 0x51ee + i * 7919,
    palette: 12,
    texture: 0,
    covering: 0,
    frame: i,
    medallion: 0,
    titleFont: 0,
    gilt: true,
  }),
  FRAME_LABELS.length,
);

await board(
  'shots-now/cover-medallions.png',
  Array.from({ length: 50 }, (_, i) => `stamp ${i}`),
  10,
  (i) => ({
    seed: 0x51ee + i * 7919,
    palette: (i * 3) % 50,
    texture: 0,
    covering: 0,
    frame: 3,
    medallion: i,
    titleFont: 0,
    gilt: true,
  }),
  50,
  { captions: false },
);

/* ---- the coverings: fifty, on ONE book, so only the binding varies ---- */

const COVERING_LABELS = await p.evaluate(async () => {
  const covers = await import('/src/art/covers.ts');
  return [...covers.COVER_TEXTURE_LABELS];
});

await board(
  'shots-now/cover-coverings.png',
  COVERING_LABELS,
  10,
  (i) => ({
    seed: 0x51ee,
    palette: 4,
    texture: 0,
    covering: i,
    frame: 3,
    medallion: 9,
    titleFont: 0,
    gilt: true,
  }),
  // Fifty coverings, fifty boards. Two entries may share a body tone and a
  // grain and legitimately draw alike, so the bar is one short of the table —
  // anything lower means the vocabulary is folding again.
  COVERING_LABELS.length - 1,
);

/* ---- the hands: fifty settings of five faces, one title ---- */

const HAND_LABELS = await p.evaluate(async () => {
  const covers = await import('/src/art/covers.ts');
  return [...covers.COVER_FONTS];
});

await board(
  'shots-now/cover-hands.png',
  HAND_LABELS,
  10,
  (i) => ({
    seed: 0x51ee,
    palette: 12,
    texture: 0,
    covering: 0,
    frame: 0,
    medallion: 0,
    titleFont: i,
    gilt: true,
  }),
  HAND_LABELS.length - 1,
);

/* ---- and a book at a time, so the two faces can be compared ---- */

await p.evaluate(async () => {
  const covers = await import('/src/art/covers.ts');
  document.body.innerHTML = '';
  document.body.style.cssText =
    'margin:0;background:#e9e2d0;display:flex;flex-wrap:wrap;gap:12px;padding:14px;' +
    'font:12px system-ui;color:#4f3120';
  for (let i = 0; i < 12; i++) {
    const seed = (0xbe11a + i * 2654435761) >>> 0;
    const cell = document.createElement('div');
    cell.style.cssText = 'text-align:center';
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 306;
    cell.appendChild(c);
    const params = covers.deriveCoverParams(seed);
    const cap = document.createElement('div');
    cap.textContent = `#${seed.toString(16)} · ${covers.COVER_TEXTURE_LABELS[params.covering]} · ${covers.COVER_FONTS[params.titleFont]}`;
    cell.appendChild(cap);
    document.body.appendChild(cell);
    covers.renderCoverInto(c.getContext('2d'), 220, 306, params, 'Bellanote');
  }
});
await p.waitForTimeout(600);
await p.screenshot({ path: 'shots-now/cover-derived.png', fullPage: true });
console.log('->  shots-now/cover-derived.png (twelve books as the seed derives them)');

/* ------------------------------------------------------------------------- *
 * The size sheets — the boards that judge the DRAWING rather than the count.
 *
 * The grids above are ~137px wide, which is smaller than a cover is ever seen
 * and larger than nothing. A cover has exactly two real sizes and the drawing
 * has to hold at both:
 *
 *   studio preview   `BookStudio` PREVIEW_H 292 × STAGE_SCALE → a board about
 *                    160 × 222. The SMALL case: a corner tool that needs 6px
 *                    is a smudge here.
 *   pull-out overlay `centerLayout` — height min(vh*0.82, 720), width ×0.72,
 *                    so about 504 × 700 on a laptop. The LARGE case: this is
 *                    where "cheap" is decided, because nothing is hiding.
 *
 * So every sheet below is drawn at one of those two, 1:1, and the file names
 * say which. A frame approved on the 137px grid is a frame nobody looked at.
 * -------------------------------------------------------------------------- */

const STUDIO = [160, 222];
const PULLOUT = [420, 583];

/**
 * One row-major sheet of covers at a fixed pixel size.
 *
 * `cells` is `[caption, params]` pairs built in the page, because CoverParams
 * are plain data and the labels come off the module's own tables.
 */
const sheet = async (file, size, cols, cellSrc, count, title = 'Bellanote') => {
  const [W, H] = size;
  await p.evaluate(
    async ([W, H, cols, cellSrc, count, title]) => {
      const covers = await import('/src/art/covers.ts');
      const cell = new Function('covers', 'return ' + cellSrc)(covers);
      document.body.innerHTML = '';
      document.body.style.cssText =
        `margin:0;background:#e9e2d0;display:grid;grid-template-columns:repeat(${cols},max-content);` +
        'gap:10px;padding:12px;justify-content:start;font:12px system-ui;color:#4f3120';
      for (let i = 0; i < count; i++) {
        const { label, params } = cell(i);
        const box = document.createElement('div');
        box.style.cssText = `width:${W}px;text-align:center`;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        box.appendChild(c);
        const cap = document.createElement('div');
        cap.textContent = label;
        cap.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        box.appendChild(cap);
        document.body.appendChild(box);
        covers.renderCoverInto(c.getContext('2d'), W, H, params, title);
      }
    },
    [W, H, cols, cellSrc.toString(), count, title],
  );
  await p.waitForTimeout(500);
  await p.screenshot({ path: file, fullPage: true });
  console.log(`->  ${file}`);
};

/** One book, everything held still but the knob under test. */
const BASE = {
  seed: 0x51ee,
  palette: 12,
  texture: 0,
  covering: 0,
  frame: 3,
  medallion: 9,
  titleFont: 0,
  gilt: true,
};

/* All fifty frames at the size the STUDIO shows them. If a corner tool cannot
 * be told from a plain rule here, the entry is a name with no picture. */
await sheet(
  `shots-now/out/${TAG}-frames-studio.png`,
  STUDIO,
  9,
  `(i) => ({
     label: i + ' ' + covers.FRAME_LABELS[i],
     params: { ...${JSON.stringify(BASE)}, frame: i },
   })`,
  50,
);

/* Twelve frames at PULL-OUT size — one per family, so the elaborate end and
 * the plain end are on the same sheet and the family resemblance is testable. */
const FRAME_PICKS = [0, 1, 4, 6, 7, 11, 13, 20, 30, 36, 45, 49];
await sheet(
  `shots-now/out/${TAG}-frames-pullout.png`,
  PULLOUT,
  4,
  `(i) => { const f = ${JSON.stringify(FRAME_PICKS)}[i];
     return { label: f + ' ' + covers.FRAME_LABELS[f],
              params: { ...${JSON.stringify(BASE)}, frame: f } }; }`,
  FRAME_PICKS.length,
);

/* Medallions at pull-out size: the stamp is the one mark on the lower half of
 * the board, so if it is a lonely glyph the whole board reads empty. */
await sheet(
  `shots-now/out/${TAG}-medallions-pullout.png`,
  PULLOUT,
  4,
  `(i) => ({ label: 'stamp ' + (i * 4),
             params: { ...${JSON.stringify(BASE)}, frame: 0, medallion: i * 4 } })`,
  12,
);

/* The fittings: corner plates, the sunk plate, the four fore-edges, and the
 * three title-plate treatments — everything that is a KNOB rather than a table. */
await sheet(
  `shots-now/out/${TAG}-fittings-pullout.png`,
  PULLOUT,
  4,
  `(i) => {
     const rows = [
       ['corners off', {}],
       ['corners on', { cornerProtectors: true }],
       ['corners, no gilt', { cornerProtectors: true, gilt: false }],
       ['inset plate', { insetPlate: true }],
       ['plate: label', { titlePlate: 'label' }],
       ['plate: gilt', { titlePlate: 'gilt' }],
       ['plate: debossed', { titlePlate: 'debossed' }],
       ['plate: none', { titlePlate: 'none' }],
       ['edge: gilt', { edge: 'gilt' }],
       ['edge: speckled', { edge: 'speckled' }],
       ['edge: marbled', { edge: 'marbled' }],
       ['worn 0.6', { wear: 0.6 }],
     ];
     return { label: rows[i][0], params: { ...${JSON.stringify(BASE)}, ...rows[i][1] } };
   }`,
  12,
);

/* And the same twelve seeded books the derived board shows, at pull-out size —
 * the honest "what does a reader actually hold" sheet. */
await sheet(
  `shots-now/out/${TAG}-books-pullout.png`,
  PULLOUT,
  4,
  `(i) => { const seed = (0xbe11a + i * 2654435761) >>> 0;
     const params = covers.deriveCoverParams(seed);
     return { label: covers.COVER_TEXTURE_LABELS[params.covering] + ' · frame ' +
                     covers.FRAME_LABELS[params.frame], params }; }`,
  8,
);

await b.close();
if (failures.length > 0) {
  for (const f of failures) console.error('FAILED', f);
  process.exit(1);
}
