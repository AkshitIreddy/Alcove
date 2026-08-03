/**
 * shots-now/ornament-signatures.mjs — how many of the fifty binder's-brass
 * stamps are actually DIFFERENT MARKS at the size they are struck on a spine?
 *
 * Same question `shape-signatures.mjs` asks of the silhouettes, and the same
 * answer shape: render, reduce to a coarse signature, put them in a Set, name
 * every collision. Two things are different here and both matter.
 *
 * **The size is tiny and it is not negotiable.** `drawSpineOrnament` takes
 * `size = min(decor.w * 0.3, 13 * scale, …)`, so on an ordinary 34-world-px
 * octavo baked at the hi scale it is s ≈ 18 canvas px — a mark 37 canvas px
 * across, which the shelf then draws at its resting zoom of 0.8 and turns into
 * about FIFTEEN SCREEN PIXELS. Judging a stamp at 300px says nothing.
 *
 * **A stamp can render as NOTHING**, which a silhouette cannot: the ornament is
 * strokes and fills on cloth, not an outline against ground, so a mark made of
 * hairlines can simply not be there. So this reports INK COVERAGE per stamp
 * alongside the signature count, and anything under a floor is named — a stamp
 * that is four grey pixels is a worse bug than two stamps that look alike,
 * because nobody can even see that it failed.
 *
 * The signature is taken off the RGB render at resting size, downsampled the
 * way the GPU does it, never off an ink/not-ink mask: two stamps that differ
 * only in how solid they are are two different marks to a reader.
 *
 * Usage:
 *   node shots-now/ornament-signatures.mjs           # counts + collisions
 *   node shots-now/ornament-signatures.mjs --sweep   # counts at every grid
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
page.setDefaultTimeout(120000);
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

const shots = await page.evaluate(async () => {
  const sp = await import('/src/art/spines.ts');
  const flat = await import('/src/art/flat.ts');
  const noise = await import('/src/art/noise.ts');

  /* Exactly the numbers `drawSpineOrnament` uses on a 34-world-px octavo. */
  const WORLD_W = 34;
  const BAKE = 2;
  const REST = 0.8;
  const TILE = Math.round(WORLD_W * BAKE); // 68 baked texels across
  const S = Math.min(TILE * 0.9 * 0.3, 13 * BAKE);

  const cloth = flat.CLOTHS[7]?.[0] ?? '#8c4a3a';
  const ink = flat.FLAT.inkSoft;
  const out = [];

  for (let kind = 0; kind < sp.ORNAMENT_LABELS.length; kind++) {
    const c = document.createElement('canvas');
    c.width = TILE;
    c.height = TILE;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = cloth;
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.save();
    ctx.lineWidth = Math.max(1, S * 0.17);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    sp.drawOrnament(ctx, kind, TILE / 2, TILE / 2, S, noise.mulberry32((0x0c17 + kind) >>> 0));
    ctx.restore();

    // …then down to what the reader is handed at the shelf's resting zoom.
    const r = Math.round((TILE / BAKE) * REST);
    const d = document.createElement('canvas');
    d.width = r;
    d.height = r;
    const dc = d.getContext('2d', { willReadFrequently: true });
    dc.imageSmoothingEnabled = true;
    dc.imageSmoothingQuality = 'high';
    dc.drawImage(c, 0, 0, r, r);

    out.push({
      i: kind,
      name: sp.ORNAMENT_LABELS[kind],
      n: r,
      px: Array.from(dc.getImageData(0, 0, r, r).data),
      cloth,
      ink,
    });
  }
  return out;
});

await browser.close();

/* -------------------------------------------------------------------------- *
 *                             the reduction                                   *
 * -------------------------------------------------------------------------- */

const rgb = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const CLOTH = rgb(shots[0].cloth);
const INK = rgb(shots[0].ink);
/*
 * Normalised by the contrast that is ACTUALLY AVAILABLE — |ink − cloth| — not
 * by a constant. A fixed divisor measures how dark the room's cloth happens to
 * be, and it lied about this table completely: on oxblood, `FLAT.inkSoft` sits
 * only 34 of a possible 765 away from the cloth, so a solid stamp scored 0.2
 * and every one of the fifty reported as "renders as nothing". They do not.
 * What is true, and worth its own line in the report, is that eleven of the
 * fifty house cloths give the stamp under 35 points of luminance to work with.
 */
const SPAN = Math.max(
  30,
  Math.abs(INK[0] - CLOTH[0]) + Math.abs(INK[1] - CLOTH[1]) + Math.abs(INK[2] - CLOTH[2]),
);

/** How far a pixel has been pushed off the bare cloth toward the ink, 0..1. */
function inkness(px, i) {
  const d =
    Math.abs(px[i] - CLOTH[0]) + Math.abs(px[i + 1] - CLOTH[1]) + Math.abs(px[i + 2] - CLOTH[2]);
  return Math.min(1, d / SPAN);
}

/** Three classes: bare cloth, a partly struck pixel, solid ink. */
function classOf(v) {
  if (v < 0.22) return '.';
  if (v < 0.62) return '-';
  return '#';
}

function signature(s, cells) {
  const out = [];
  for (let ry = 0; ry < cells; ry++) {
    for (let rx = 0; rx < cells; rx++) {
      const y0 = Math.floor((ry * s.n) / cells);
      const y1 = Math.max(y0 + 1, Math.floor(((ry + 1) * s.n) / cells));
      const x0 = Math.floor((rx * s.n) / cells);
      const x1 = Math.max(x0 + 1, Math.floor(((rx + 1) * s.n) / cells));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += inkness(s.px, (y * s.n + x) * 4);
          n++;
        }
      }
      out.push(classOf(sum / Math.max(1, n)));
    }
  }
  return out.join('');
}

/** Share of the stamp's own box that carries any ink at all. */
function coverage(s) {
  let on = 0;
  let n = 0;
  for (let y = 0; y < s.n; y++) {
    for (let x = 0; x < s.n; x++) {
      if (inkness(s.px, (y * s.n + x) * 4) > 0.22) on++;
      n++;
    }
  }
  return on / n;
}

/*
 * 5, 6, 8 — and NOT 4. The stamp is about fifteen screen pixels across inside a
 * 27px box, so a 4×4 grid gives the mark itself a two-cell view: at that rung
 * thirty-eight of the fifty report as one mark, which is a fact about the grid
 * and not about the drawings. Five cells is a three-cell view of the mark,
 * which is roughly what a reader scanning a shelf actually resolves.
 */
const LADDER = [5, 6, 8];

if (flag('sweep')) {
  console.log('\n  distinct stamp signatures rung by rung (of 50):\n');
  for (const c of [3, 4, ...LADDER, 10, 12]) {
    const set = new Set(shots.map((s) => signature(s, c)));
    console.log(
      `       ${String(c).padStart(2)}×${String(c).padEnd(3)}  ${String(set.size).padStart(3)}` +
        (LADDER.includes(c) ? ' ←' : ''),
    );
  }
  console.log('');
}

/* Union-find over every rung: two stamps are ONE MARK if they collide anywhere. */
const parent = shots.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const union = (a, b) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[ra] = rb;
};
for (const c of LADDER) {
  const seen = new Map();
  shots.forEach((s, i) => {
    const k = signature(s, c);
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
  `\n  distinct stamp signatures: ${groups.size} of ${shots.length}` +
    `   (RGB at resting size, merged over ${LADDER.length} coarsenesses)`,
);

const collided = [...groups.values()].filter((g) => g.length > 1);
if (collided.length > 0) {
  console.log(`\n  ${collided.length} clusters read as one mark:`);
  for (const g of collided.sort((a, b) => b.length - a.length)) {
    console.log(`      ${g.length}×  ${g.map((s) => `${s.i} ${s.name}`).join('  |  ')}`);
  }
}

/* The other failure, and the one a signature count cannot see. */
const cov = shots.map((s) => ({ i: s.i, name: s.name, c: coverage(s) }));
cov.sort((a, b) => a.c - b.c);
const FAINT = 0.05;
const faint = cov.filter((c) => c.c < FAINT);
console.log(
  `\n  ink coverage of the stamp's own box — the twelve faintest` +
    `   (under ${(FAINT * 100).toFixed(1)}% is a mark a reader will not see):`,
);
for (const c of cov.slice(0, 12)) {
  console.log(
    `      ${String(c.i).padStart(2)} ${c.name.padEnd(18)} ${(c.c * 100).toFixed(1)}%` +
      (c.c < FAINT ? '   ← too faint' : ''),
  );
}
console.log(`\n  ${faint.length} of ${shots.length} stamps are below the floor`);
