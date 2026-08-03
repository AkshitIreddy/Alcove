/**
 * shots-now/plate-signatures.mjs — do the fifty lettering-piece treatments read
 * as fifty different things, and can you read the TITLE on each of them?
 *
 * Two questions, because a plate can fail either way and only one of them is
 * what `shots-now/plates-board.mjs` shows you.
 *
 *   DISTINCTNESS  the label band, rendered by `renderSpine` on one seed with
 *                 only `titlePlate` changed, downsampled to the size the shelf
 *                 rests at, reduced to a coarse signature and counted. Same
 *                 method as `shape-signatures.mjs`.
 *
 *   LEGIBILITY    the same spine drawn TWICE, once with a title and once with
 *                 an empty one. Everything except the lettering is identical,
 *                 so the difference between the two IS the lettering — its
 *                 pixel count, and how far it stands off whatever it was set
 *                 on. A plate that renders beautifully and then sets its title
 *                 in a colour two steps from its own ground has failed, and no
 *                 specimen board will tell you so: your eye knows what the
 *                 word says before it reads it.
 *
 * Both are measured at REST (34 world px baked at 2, drawn at zoom 0.8), which
 * is where a reader meets a shelf. Judging a plate at 300px is how a table of
 * fifty comes to contain lettering nobody can read.
 *
 * Usage:
 *   node shots-now/plate-signatures.mjs          # counts, collisions, contrast
 *   node shots-now/plate-signatures.mjs --sweep  # counts at every coarseness
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () =>
    import('/src/art/flat.ts').then(
      () => true,
      () => false,
    ),
  null,
  { polling: 500 },
);
// An unloaded handwriting face falls back to a system serif and every
// legibility number below would be measured on the wrong letterforms.
await page.evaluate(() => document.fonts.ready);

const shots = await page.evaluate(async () => {
  const sp = await import('/src/art/spines.ts');
  const flat = await import('/src/art/flat.ts');

  const WORLD_W = 34;
  const WORLD_H = 190;
  const BAKE = 2;
  const REST = 0.8;
  const PAD = 6;
  const base = sp.deriveSpineParams(0x51e5a3);

  /** One spine, at bake scale, with `title` set and nothing else changed. */
  function bake(plate, title) {
    const w = Math.round(WORLD_W * BAKE);
    const h = Math.round(WORLD_H * BAKE);
    const c = document.createElement('canvas');
    c.width = w + PAD * 2;
    c.height = h + PAD * 2;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = flat.FLAT.recess;
    ctx.fillRect(0, 0, c.width, c.height);
    sp.renderSpine(
      ctx,
      {
        ...base,
        w: WORLD_W,
        binding: 'plain-cloth',
        titlePlate: plate,
        ornamentOn: false,
        charm: null,
        palette: 12,
        gilt: false,
      },
      PAD,
      PAD,
      h,
      BAKE,
      title,
      { hiRes: true },
    );
    return c;
  }

  /** …then down to what the reader is handed at the shelf's resting zoom. */
  function rest(baked) {
    const c = document.createElement('canvas');
    c.width = Math.round((baked.width / BAKE) * REST);
    c.height = Math.round((baked.height / BAKE) * REST);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(baked, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  const out = [];
  for (const id of sp.TITLE_PLATES) {
    const withTitle = rest(bake(id, 'Marginalia'));
    const bare = rest(bake(id, ''));
    out.push({
      id,
      w: withTitle.width,
      h: withTitle.height,
      titled: Array.from(withTitle.data),
      bare: Array.from(bare.data),
    });
  }
  return out;
});

await browser.close();

/* -------------------------------------------------------------------------- *
 *                              the reductions                                 *
 * -------------------------------------------------------------------------- */

/*
 * Where the plate actually is, found rather than guessed.
 *
 * A fixed band of the spine (0.24–0.62, the crop `plates-board.mjs` magnifies)
 * is about SIX TIMES taller than the plate inside it, so most cells of any grid
 * laid over it are bare cloth and identical for all fifty — measured that way
 * the count sat at 25 while whole families were plainly different on the board.
 *
 * The untitled render is the reference for the lettering anyway, so the rows
 * the title struck are free: they bracket the lettering exactly, and the plate
 * is that bracket grown by 70% of its own height at each end. Self-calibrating,
 * so it stays correct if `bookLabelBox` ever moves the seat.
 */
function bandOf(s) {
  let top = s.h;
  let bot = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = (y * s.w + x) * 4;
      const d =
        Math.abs(s.titled[i] - s.bare[i]) +
        Math.abs(s.titled[i + 1] - s.bare[i + 1]) +
        Math.abs(s.titled[i + 2] - s.bare[i + 2]);
      if (d > 12) {
        if (y < top) top = y;
        if (y > bot) bot = y;
        break;
      }
    }
  }
  if (bot <= top) return [Math.floor(s.h * 0.24), Math.floor(s.h * 0.62)];
  const grow = Math.round((bot - top) * 0.7);
  return [Math.max(0, top - grow), Math.min(s.h, bot + grow + 1)];
}

function lum(px, i) {
  return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
}

/**
 * The label band as a coarse picture.
 *
 * Read off the TITLED render, not the untitled one. `renderSpine` draws no
 * lettering-piece at all when there is no title to put on it — reasonably, a
 * plate is a seat for a word — so every one of the fifty untitled spines is the
 * same bare cloth, and taking the signature there reported 1 distinct plate of
 * 50 at every coarseness from 2×3 to 10×18. The untitled render still earns its
 * keep as the reference the lettering is measured against, below.
 */
function signature(s, cols, rows) {
  const [y0, y1] = bandOf(s);
  const cells = [];
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const a = y0 + Math.floor((ry * (y1 - y0)) / rows);
      const b = Math.max(a + 1, y0 + Math.floor(((ry + 1) * (y1 - y0)) / rows));
      const c = Math.floor((rx * s.w) / cols);
      const d = Math.max(c + 1, Math.floor(((rx + 1) * s.w) / cols));
      let sum = 0;
      let n = 0;
      for (let y = a; y < b; y++) {
        for (let x = c; x < d; x++) {
          sum += lum(s.titled, (y * s.w + x) * 4);
          n++;
        }
      }
      /*
       * Sixteen levels, not six. A plate covers about a quarter of the band it
       * sits in, so a cell's mean is mostly CLOTH and six buckets put all fifty
       * in the same one — the first run of this script reported 1 distinct
       * signature of 50 at every coarseness, which is a fact about the bucket
       * width and not about the plates.
       */
      cells.push(Math.min(15, Math.floor(sum / Math.max(1, n) / 16)).toString(16));
    }
  }
  return cells.join('');
}

/** The lettering: every pixel the title changed, and how far it moved them. */
function lettering(s) {
  const [y0, y1] = bandOf(s);
  const moves = [];
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = (y * s.w + x) * 4;
      const d =
        Math.abs(s.titled[i] - s.bare[i]) +
        Math.abs(s.titled[i + 1] - s.bare[i + 1]) +
        Math.abs(s.titled[i + 2] - s.bare[i + 2]);
      if (d > 12) moves.push(d);
    }
  }
  moves.sort((a, b) => a - b);
  /*
   * The STROKE CORE, not the mean.
   *
   * Handwriting set at eight pixels is mostly antialiased edge — two thirds of
   * every letter is a partial pixel — so the mean move over the struck pixels
   * measures how much edge the face has, and it lands at 40-90 out of 765 for
   * lettering that is perfectly readable. Measured that way this script called
   * twenty-one of the fifty plates illegible, `morocco-label` among them, which
   * is cream lettering on dark leather. The 85th percentile is the darkest
   * fifth of the mark — the middle of the strokes — and that is what a reader
   * resolves.
   */
  const core = moves.length > 0 ? moves[Math.floor(moves.length * 0.85)] : 0;
  return { struck: moves.length, core, peak: moves.length > 0 ? moves[moves.length - 1] : 0 };
}

const LADDER = [
  [3, 5],
  [4, 7],
  [5, 9],
];

if (flag('sweep')) {
  console.log('\n  distinct plate signatures rung by rung (of 50):\n');
  for (const [c, r] of [[2, 3], ...LADDER, [7, 12], [10, 18]]) {
    const set = new Set(shots.map((s) => signature(s, c, r)));
    console.log(
      `       ${c}×${String(r).padEnd(3)}  ${String(set.size).padStart(3)}` +
        (LADDER.some(([lc, lr]) => lc === c && lr === r) ? ' ←' : ''),
    );
  }
  console.log('');
}

const parent = shots.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const union = (a, b) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[ra] = rb;
};
for (const [c, r] of LADDER) {
  const seen = new Map();
  shots.forEach((s, i) => {
    const k = signature(s, c, r);
    if (seen.has(k)) union(seen.get(k), i);
    else seen.set(k, i);
  });
}
const groups = new Map();
shots.forEach((s, i) => {
  const root = find(i);
  groups.set(root, [...(groups.get(root) ?? []), s]);
});

console.log(
  `\n  distinct plate signatures: ${groups.size} of ${shots.length}` +
    `   (label band at resting size, merged over ${LADDER.length} coarsenesses)`,
);
const collided = [...groups.values()].filter((g) => g.length > 1);
if (collided.length > 0) {
  console.log(`\n  ${collided.length} clusters read as one plate:`);
  for (const g of collided.sort((a, b) => b.length - a.length)) {
    console.log(`      ${g.length}×  ${g.map((s) => s.id).join(', ')}`);
  }
}

/* -------------------------------- legibility ------------------------------ */

const letters = shots.map((s) => ({ id: s.id, ...lettering(s) }));
letters.sort((a, b) => a.core - b.core);

const DEAD = 40; // struck pixels below this and the title is not there at all
const FAINT = 75; // …and below this it is there and cannot be read

console.log(`\n  the title, as pixels it actually changed at resting size:\n`);
console.log('      plate                struck   stroke core   verdict');
for (let i = 0; i < letters.length; i++) {
  const l = letters[i];
  const verdict = l.struck < DEAD ? 'NOT DRAWN' : l.core < FAINT ? 'too faint to read' : '';
  if (verdict === '' && i > 13) continue;
  console.log(
    `      ${l.id.padEnd(20)} ${String(l.struck).padStart(5)}   ${String(l.core).padStart(9)}   ${verdict}`,
  );
}
const dead = letters.filter((l) => l.struck < DEAD);
const faint = letters.filter((l) => l.struck >= DEAD && l.core < FAINT);
console.log(
  `\n  ${dead.length} plates draw no title at all; ${faint.length} more set it too faint to read` +
    `   (of ${letters.length})`,
);
