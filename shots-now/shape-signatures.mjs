/**
 * shots-now/shape-signatures.mjs — how many of the fifty silhouettes are
 * actually DIFFERENT PICTURES at the size a spine is drawn on the shelf?
 *
 * `tests/book-bindings.test.ts` already gates the closest PAIR in raw pixels.
 * That number can rise while the table still reads as twenty variations on a
 * rectangle, because "328 pixels apart out of ten thousand" is a distance, not
 * a count — it says nothing about how many shapes fall inside one bucket.
 *
 * So this counts distinct signatures, the way `shots-now/lettering.mjs` counts
 * distinct type signatures: render, reduce to a signature, put them in a Set,
 * and name every collision. The reduction is deliberately COARSE — a spine is
 * 20–45 world px wide, and the question is not "do these differ" but "does a
 * reader scanning a shelf see two things".
 *
 * The signature is taken off the RGB RENDER, never off a ground/not-ground
 * mask. A mask reported `tight-back` and `double-hinge` as the same shape once,
 * because they share an outline and differ by the grooves drawn inside it, and
 * acting on that would have meant rebuilding two shapes that were already fine.
 *
 * Calibration, so the number means something: `--sweep` walks the grid from
 * 3×9 cells (a squint from across the room) to 16×52 (a spine held up close),
 * and the reported figure is one fixed point on that walk, held identical
 * before and after so the two numbers can be subtracted.
 *
 * Usage:
 *   node shots-now/shape-signatures.mjs                # the count + collisions
 *   node shots-now/shape-signatures.mjs --sweep        # counts at every grid
 *   node shots-now/shape-signatures.mjs --json         # machine-readable
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

/* The calibrated reduction: cells across × cells down over the whole render. */
const COLS = Number(opt('cols', 7));
const ROWS = Number(opt('rows', 22));

mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
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

/* -------------------------------------------------------------------------- *
 * render every silhouette once, at true shelf proportions, and bring the      *
 * pixels back. Everything after this is arithmetic in node.                   *
 * -------------------------------------------------------------------------- */
const shots = await page.evaluate(async () => {
  const bd = await import('/src/art/bookDesign.ts');

  // True shelf proportions, and the same magenta ground the vitest gate uses:
  // a colour the warm-parchment palette cannot make, so "ground" is provably
  // "nothing drawn" — but the signature reads the RGB, not the groundness.
  const W = 34;
  const H = 200;
  const PAD = 14;
  const cw = W + PAD * 2;
  const ch = H + PAD * 2;

  const base = bd.resolveBookDesign({ seed: 0x51e5, cloth: 3, accent: 11 });

  const out = [];
  for (const shape of bd.SPINE_SHAPES) {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, cw, ch);
    const design = { ...base, shape, material: 'smooth-cloth', decorations: ['plain'] };
    bd.drawBookSpine(ctx, PAD, PAD, W, H, design, { noContact: true });
    const px = ctx.getImageData(0, 0, cw, ch).data;
    out.push({
      id: shape,
      name: bd.SHAPES[shape].name,
      group: bd.SHAPES[shape].group,
      tier: bd.SHAPES[shape].tier,
      w: cw,
      h: ch,
      // The window the grid is laid over: the slot plus a couple of pixels of
      // ground on every side, so an outline that sits flush still has ground
      // beside it and a lip that overhangs is still counted.
      box: { x0: PAD - 3, y0: PAD - 4, x1: PAD + W + 3, y1: PAD + H + 4 },
      px: Array.from(px),
    });
  }
  return out;
});

await browser.close();

/* -------------------------------------------------------------------------- *
 *                            the reduction                                    *
 * -------------------------------------------------------------------------- */

/**
 * What one pixel of the render READS as, from its RGB.
 *
 * Five classes, not two. A ground/not-ground mask is the thing that must not be
 * used — it called `tight-back` and `double-hinge` identical because they share
 * an outline and differ by the grooves inside it. Ink is its own class, so a
 * groove, a cord, a clasp and a stitch line all move the signature; `pale` and
 * `dark` separate a proud cord from the cloth it stands on.
 */
function classOf(r, g, b) {
  if (r > 200 && b > 200 && g < 90) return 'g'; // the magenta ground
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 92) return 'k'; // ink, and anything as dark as ink
  if (lum < 140) return 'd'; // a turned face, a shadowed groove
  if (lum < 196) return 'm'; // the cloth itself
  return 'p'; // gilt, cream, bare cord, a pale mark
}

/**
 * The DOMINANT class of each cell of a cols×rows grid over the whole render.
 *
 * Dominant, not mean: a mean has to be quantised, and a quantised mean sits on
 * a bucket edge — sweeping the level count gave 22, 12, 43, 42 for the same
 * table, which is a measurement of where the edges fell, not of the shapes. A
 * cell's dominant class only changes when most of that cell changes, so the
 * count moves when the drawing moves and stays put when it does not.
 */
function signature(shot, cols, rows) {
  // Anchored on the SLOT, not on the canvas: the padding is only there to catch
  // a yapp lip or a scroll's knob, and letting it into the grid meant a column
  // boundary landed on the ink edge at one coarseness and beside it at the
  // next, which moved the count by sixteen without moving a single drawing.
  const { w, px, box } = shot;
  const cw = box.x1 - box.x0;
  const chh = box.y1 - box.y0;
  const cells = [];
  for (let ry = 0; ry < rows; ry++) {
    const y0 = box.y0 + Math.floor((ry * chh) / rows);
    const y1 = Math.max(y0 + 1, box.y0 + Math.floor(((ry + 1) * chh) / rows));
    for (let rx = 0; rx < cols; rx++) {
      const x0 = box.x0 + Math.floor((rx * cw) / cols);
      const x1 = Math.max(x0 + 1, box.x0 + Math.floor(((rx + 1) * cw) / cols));
      const tally = { g: 0, k: 0, d: 0, m: 0, p: 0 };
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          tally[classOf(px[i], px[i + 1], px[i + 2])]++;
        }
      }
      let best = 'g';
      for (const k of ['k', 'd', 'm', 'p', 'g']) if (tally[k] > tally[best]) best = k;
      cells.push(best);
    }
  }
  return cells.join('');
}

function countDistinct(cols, rows) {
  const seen = new Map();
  for (const s of shots) {
    const key = signature(s, cols, rows);
    seen.set(key, [...(seen.get(key) ?? []), s]);
  }
  return seen;
}

/** The vitest gate's own measure, so this can't be improved at its expense. */
function pixelsDiffering(a, b) {
  let n = 0;
  for (let i = 0; i < a.px.length; i += 4) {
    const d =
      Math.abs(a.px[i] - b.px[i]) +
      Math.abs(a.px[i + 1] - b.px[i + 1]) +
      Math.abs(a.px[i + 2] - b.px[i + 2]);
    if (d > 24) n++;
  }
  return n;
}

/* -------------------------------------------------------------------------- *
 *                               the report                                    *
 * -------------------------------------------------------------------------- */

/**
 * The ladder: one signature is one viewing coarseness, and no single coarseness
 * is the honest one.
 *
 * Reported at a single grid the count jumped 42 → 26 between 6×18 and 8×26 with
 * nothing redrawn, because a pair separates at the coarseness whose cell edge
 * happens to fall on the difference between them. So the headline merges: two
 * shapes are the SAME PICTURE if they collide at any rung, and the count is the
 * number of groups left. A shape only counts as its own picture if it holds
 * apart from everything else at every coarseness a reader might see it at.
 */
const LADDER = [
  [4, 12],
  [5, 15],
  [6, 18],
  [7, 22],
  [8, 26],
];

if (flag('sweep')) {
  console.log('\n  distinct signatures rung by rung (of 50):\n');
  for (const [c, r] of [[3, 9], ...LADDER, [10, 32], [12, 40], [16, 52]]) {
    const on = LADDER.some(([lc]) => lc === c) ? ' ←' : '';
    console.log(
      `       ${String(c).padStart(2)}×${String(r).padEnd(3)}   ${String(countDistinct(c, r).size).padStart(3)}${on}`,
    );
  }
  console.log('');
}

/* Union-find over every rung of the ladder. */
const parent = shots.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const union = (a, b) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[ra] = rb;
};
for (const [c, r] of LADDER) {
  const bySig = new Map();
  shots.forEach((s, i) => {
    const key = signature(s, c, r);
    if (bySig.has(key)) union(bySig.get(key), i);
    else bySig.set(key, i);
  });
}
const groups = new Map();
shots.forEach((s, i) => {
  const root = find(i);
  groups.set(root, [...(groups.get(root) ?? []), s]);
});
const distinct = groups.size;

console.log(
  `\n  distinct silhouette signatures: ${distinct} of ${shots.length}` +
    `   (dominant class on the RGB render, merged over ${LADDER.length} coarsenesses)`,
);

const collided = [...groups.values()].filter((g) => g.length > 1);
if (collided.length > 0) {
  console.log(
    `\n  ${collided.length} clusters, ${collided.reduce((n, g) => n + g.length, 0)} shapes read as one of another:`,
  );
  for (const group of collided.sort((a, b) => b.length - a.length)) {
    console.log(`      ${group.length}×  ${group.map((s) => `${s.id}[${s.tier[0]}]`).join(', ')}`);
  }
}

/* The clusters above are a transitive closure and can chain. The PAIRS are what
 * a fix is aimed at, so name them and say how coarse a look it takes. */
const pairRungs = new Map();
for (const [c, r] of LADDER) {
  const bySig = new Map();
  for (const s of shots) {
    const key = signature(s, c, r);
    bySig.set(key, [...(bySig.get(key) ?? []), s.id]);
  }
  for (const group of bySig.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const k = `${group[i]} = ${group[j]}`;
        pairRungs.set(k, [...(pairRungs.get(k) ?? []), `${c}×${r}`]);
      }
    }
  }
}
if (pairRungs.size > 0) {
  console.log(`\n  ${pairRungs.size} colliding PAIRS (and the coarsenesses they collide at):`);
  for (const [k, rungs] of [...pairRungs].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`      ${k.padEnd(38)} ${rungs.join(' ')}`);
  }
}

/* Which shapes the dice can actually hand out, and how many of THOSE read. */
const rollable = shots.filter((s) => s.tier !== 'oddity');
const rollableGroups = new Set(rollable.map((s) => find(shots.indexOf(s))));
console.log(
  `\n  of the ${rollable.length} the dice may roll, ${rollableGroups.size} read as different pictures`,
);

/* The pairwise floor the vitest gate holds, recomputed here so a signature win
 * bought by making two shapes noisier rather than different shows up. */
let worst = Infinity;
let worstPair = '';
const dists = [];
for (let i = 0; i < shots.length; i++) {
  for (let j = i + 1; j < shots.length; j++) {
    const d = pixelsDiffering(shots[i], shots[j]);
    dists.push(d);
    if (d < worst) {
      worst = d;
      worstPair = `${shots[i].id} / ${shots[j].id}`;
    }
  }
}
dists.sort((a, b) => a - b);
console.log(
  `  closest pair ${worst}px (${worstPair}); median ${dists[dists.length >> 1]}px` +
    `   [vitest floor is 300]`,
);

const nearest = shots.map((s, i) => {
  let best = Infinity;
  let who = '';
  for (let j = 0; j < shots.length; j++) {
    if (i === j) continue;
    const d = pixelsDiffering(s, shots[j]);
    if (d < best) {
      best = d;
      who = shots[j].id;
    }
  }
  return { id: s.id, tier: s.tier, best, who };
});
nearest.sort((a, b) => a.best - b.best);
console.log('\n  the twelve shapes with the closest neighbour:');
for (const n of nearest.slice(0, 12)) {
  console.log(`      ${n.id.padEnd(18)} ${String(n.best).padStart(5)}px from ${n.who}  [${n.tier}]`);
}

if (flag('json')) {
  writeFileSync(
    'shots-now/out/shape-signatures.json',
    JSON.stringify(
      {
        distinct,
        rollableDistinct: rollableSigs.size,
        worst,
        worstPair,
        clusters: collided.map((g) => g.map((s) => s.id)),
        nearest,
      },
      null,
      2,
    ),
  );
  console.log('\n  wrote shots-now/out/shape-signatures.json');
}
