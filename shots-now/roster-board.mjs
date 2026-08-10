/**
 * shots-now/roster-board.mjs — every customisation axis at the size it is
 * ACTUALLY MET, with a machine-checked answer to "are any two the same?".
 *
 * Every other board in this folder shows one vocabulary. This one shows all of
 * them, to one rule, so the axes can be compared against each other: a 50-entry
 * table that reads rich next to a 50-entry table that reads like four pictures
 * is exactly what a per-axis board can never tell you.
 *
 * ## The rule: draw it the way the app draws it, then shrink it the way the
 * ## GPU shrinks it
 *
 * Nothing here is drawn at "specimen size". Each cell is
 *
 *   1. drawn at the BAKE resolution the shipping code uses
 *      (`HI_SCALE_BASE = 2` device px per world px, `spineScale.ts`);
 *   2. downsampled — bilinear, as the sampler does — to the size it occupies
 *      on screen at the shelf's RESTING zoom of 0.8 (`world.ts`);
 *   3. and only then blown up ×2 nearest-neighbour, so a human can look at the
 *      pixels a reader is really handed rather than at a flattering redraw.
 *
 * So a 34-world-px octavo is 27 screen px wide here. A stamp on it is fifteen
 * pixels across. That is the fact the whole exercise exists to confront.
 *
 * Each axis emits two sheets:
 *   <axis>-true.png  1:1, shoulder to shoulder, no labels, no gaps. The only
 *                    board that can honestly answer "can you tell these apart".
 *   <axis>-mag.png   the same pixels ×2 nearest, captioned, oddities struck
 *                    through so a demoted entry is not mistaken for a failure.
 *
 * ## It refuses to pass vacuously
 *
 * A grid of fifty cells proves nothing: fifty names folding onto six pictures
 * make a grid that LOOKS full. So every axis is scored — each cell's TRUE-SIZE
 * pixels are reduced to a block signature and every pair compared. The run
 * prints, per axis, how many of the N are actually distinct and names every
 * colliding pair. That report is the deliverable; the PNGs are the evidence.
 *
 * Usage:
 *   node shots-now/roster-board.mjs                 # every axis
 *   node shots-now/roster-board.mjs --only=bindings,ornaments
 *   node shots-now/roster-board.mjs --url=http://localhost:1420
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const ONLY = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const OUT = 'shots-now/roster';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text());
});

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
// The boards draw straight out of `src/art/`; they never need the Pixi world,
// so waiting on `__shelfWorld` would make a measuring run hostage to whether
// the whole app happened to boot.
await page.waitForFunction(
  () =>
    import('/src/art/flat.ts').then(
      () => true,
      () => false,
    ),
  null,
  { polling: 400 },
);
// Canvas does not trigger a webfont load. A lettering board drawn without this
// is a board of the generic fallback, lying about a table that works.
await page.evaluate(async () => {
  const faces = ['"Caveat Variable"', '"Kalam"', '"Patrick Hand"', '"Architects Daughter"', '"Nunito Sans"'];
  const jobs = [];
  for (const f of faces) for (const w of [300, 400, 600, 700, 800]) {
    for (const s of ['', 'italic ']) jobs.push(document.fonts.load(`${s}${w} 30px ${f}`).catch(() => {}));
  }
  await Promise.all(jobs);
  await document.fonts.ready;
});

/* ========================================================================== *
 * The shared harness, installed once into the page.
 * ========================================================================== */
await page.evaluate(() => {
  /** Device px per world px in a hi bake — `spineScale.HI_SCALE_BASE` × dpr 1. */
  const BAKE = 2;
  /** The shelf's resting zoom — `world.ts`. Screen px per world px. */
  const REST = 0.8;
  /** How much the magnified sheet enlarges the TRUE-SIZE pixels. */
  const MAG = 2;

  const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };

  /**
   * One cell: bake at 2×, downsample to the resting on-screen size.
   *
   * `paint(ctx, scale)` gets a context already scaled so that 1 unit = 1 WORLD
   * px is `scale` canvas px — callers do their own multiplication, exactly as
   * the shipping bakes do, because several of the drawers take a scale.
   */
  function cell(worldW, worldH, bg, paint) {
    const bakeC = mk(worldW * BAKE, worldH * BAKE);
    const bctx = bakeC.getContext('2d');
    bctx.lineJoin = 'round';
    bctx.lineCap = 'round';
    if (bg) {
      bctx.fillStyle = bg;
      bctx.fillRect(0, 0, bakeC.width, bakeC.height);
    }
    paint(bctx, BAKE);
    const t = mk(worldW * REST, worldH * REST);
    const tctx = t.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    if (bg) {
      tctx.fillStyle = bg;
      tctx.fillRect(0, 0, t.width, t.height);
    }
    tctx.drawImage(bakeC, 0, 0, t.width, t.height);
    return t;
  }

  /** The same pixels, ×MAG, nearest — no new information, just visible. */
  function magnify(t, m = MAG) {
    const c = mk(t.width * m, t.height * m);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t, 0, 0, c.width, c.height);
    return c;
  }

  /**
   * A cell's signature: block-averaged RGB over a fixed grid of its TRUE-SIZE
   * pixels. Fixed grid, so cells of different sizes are still comparable, and
   * block averages rather than a hash, so "almost the same" is measurable.
   */
  function signature(t, gw = 10, gh = 24) {
    const ctx = t.getContext('2d');
    const img = ctx.getImageData(0, 0, t.width, t.height).data;
    const sig = new Float64Array(gw * gh * 3);
    for (let by = 0; by < gh; by++) {
      const y0 = Math.floor((by * t.height) / gh);
      const y1 = Math.max(y0 + 1, Math.floor(((by + 1) * t.height) / gh));
      for (let bx = 0; bx < gw; bx++) {
        const x0 = Math.floor((bx * t.width) / gw);
        const x1 = Math.max(x0 + 1, Math.floor(((bx + 1) * t.width) / gw));
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * t.width + x) * 4;
            const a = img[i + 3] / 255;
            r += img[i] * a; g += img[i + 1] * a; b += img[i + 2] * a; n++;
          }
        }
        const o = (by * gw + bx) * 3;
        sig[o] = r / n; sig[o + 1] = g / n; sig[o + 2] = b / n;
      }
    }
    return sig;
  }

  /** RMS difference between two signatures, in 0..255 units. */
  function sigDist(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }
    return Math.sqrt(s / a.length);
  }

  /**
   * Lay out one axis and screenshot-ready DOM for it.
   *
   * `entries` is [{ id, label, oddity }], `draw(entry)` returns a true-size
   * canvas. Returns the collision report.
   */
  function board(key, entries, cells, perRow, gw, gh, opts = {}) {
    const ground = opts.ground ?? '#e9e2d0';
    const trueGap = opts.trueGap ?? 0;

    /* --- 1:1, shoulder to shoulder --- */
    const tru = document.createElement('div');
    tru.id = `${key}-true`;
    tru.style.cssText =
      `display:flex;flex-wrap:wrap;align-items:flex-end;gap:${trueGap}px;` +
      `padding:10px;background:${ground};width:${opts.trueWidth ?? 1400}px;box-sizing:border-box;`;
    for (const c of cells) tru.append(c);
    document.body.append(tru);

    /* --- ×2 nearest, captioned --- */
    const mag = document.createElement('div');
    mag.id = `${key}-mag`;
    mag.style.cssText =
      `display:grid;grid-template-columns:repeat(${perRow},max-content);gap:8px 3px;` +
      `padding:12px;background:${ground};width:max-content;box-sizing:border-box;` +
      'font:10px "Nunito Sans",system-ui,sans-serif;color:#3a2416;';
    entries.forEach((e, i) => {
      const box = document.createElement('div');
      box.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
      const m = magnify(cells[i], opts.mag ?? 2);
      m.style.cssText = 'display:block;';
      const cap = document.createElement('div');
      cap.textContent = e.label ?? e.id;
      cap.style.cssText =
        `max-width:${m.width + 8}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;` +
        'margin-top:2px;text-align:center;' +
        (e.oddity ? 'text-decoration:line-through;opacity:.5;' : '');
      box.append(m, cap);
      mag.append(box);
    });
    document.body.append(mag);

    /* --- the vacuity check --- */
    /*
     * Scored on the REGION THE AXIS LIVES IN, not on the whole cell.
     *
     * This is the difference between a measurement and a formality. An
     * ornament is ~15 of a spine's 5,000 pixels, so a whole-spine signature
     * calls fifty different stamps "one picture" — which is true of the spine
     * and says nothing about the stamps. `sigCrop` (fractions of the cell)
     * points the score at the stamp, the ribbon, the plate, the frieze.
     */
    const cropped = opts.sigCrop
      ? cells.map((c) => {
          const r = opts.sigCrop;
          const w = Math.max(2, Math.round(c.width * r.w));
          const h = Math.max(2, Math.round(c.height * r.h));
          const cut = mk(w, h);
          cut.getContext('2d').drawImage(
            c, Math.round(c.width * r.x), Math.round(c.height * r.y), w, h, 0, 0, w, h,
          );
          return cut;
        })
      : cells;
    const sigs = cropped.map((c) => signature(c, gw, gh));
    const pairs = [];
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const d = sigDist(sigs[i], sigs[j]);
        if (d < (opts.near ?? 6)) pairs.push({ a: entries[i].id, b: entries[j].id, d: +d.toFixed(2) });
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    // Distinct groups: union-find over pairs closer than the "same picture"
    // threshold. Two entries in one group are one picture with two names.
    const same = (opts.same ?? 2.0);
    const parent = entries.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        if (sigDist(sigs[i], sigs[j]) < same) parent[find(i)] = find(j);
      }
    }
    const groups = new Set(entries.map((_, i) => find(i)));
    return {
      key,
      count: entries.length,
      distinct: groups.size,
      cellPx: `${cells[0].width}x${cells[0].height}`,
      identical: pairs.filter((p) => p.d < same),
      near: pairs.filter((p) => p.d >= same).slice(0, 14),
    };
  }

  globalThis.__roster = { BAKE, REST, MAG, mk, cell, magnify, signature, sigDist, board };
});

/* ========================================================================== *
 * The axes.
 * ========================================================================== *
 *
 * Each is `{ key, build }` where `build` runs in the page, draws every cell
 * through the app's own renderer, and hands the harness the report. Kept as
 * separate evaluate() calls so one broken vocabulary cannot take the run down.
 */
const AXES = [
  /* ---------------------------------------------------------------- spines */
  {
    key: 'shapes',
    note: '50 spine silhouettes, 34 world px wide, one cloth, no tooling',
    fn: async () => {
      const bd = await import('/src/art/bookDesign.ts');
      const flat = await import('/src/art/flat.ts');
      const R = globalThis.__roster;
      const base = bd.resolveBookDesign({ seed: 0x51e5, cloth: 12, accent: 22 });
      const entries = bd.SPINE_SHAPES.map((id) => ({
        id,
        label: bd.SHAPE_LABELS[id] ?? id,
        oddity: bd.SHAPES[id].tier === 'oddity',
      }));
      const cells = entries.map((e) =>
        R.cell(34, 232, flat.FLAT.recess, (ctx, s) => {
          bd.drawBookSpine(ctx, 0, 0, 34 * s, 232 * s, {
            ...base,
            shape: e.id,
            material: 'smooth-cloth',
            decorations: ['plain'],
            bands: 0,
            headTail: null,
          }, { noContact: true });
        }),
      );
      return R.board('shapes', entries, cells, 25, 10, 26);
    },
  },
  {
    key: 'coverings',
    note: '50 coverings, shape and colour held still',
    fn: async () => {
      const bd = await import('/src/art/bookDesign.ts');
      const flat = await import('/src/art/flat.ts');
      const R = globalThis.__roster;
      const base = bd.resolveBookDesign({ seed: 0x51e5, cloth: 12, accent: 22 });
      const entries = bd.MATERIAL_LOOKS.map((id) => ({
        id,
        label: bd.MATERIAL_LOOK_LABELS[id] ?? id,
        oddity: bd.MATERIALS[id].tier === 'oddity',
      }));
      const cells = entries.map((e) =>
        R.cell(34, 232, flat.FLAT.recess, (ctx, s) => {
          bd.drawBookSpine(ctx, 0, 0, 34 * s, 232 * s, {
            ...base, shape: 'flat', material: e.id, decorations: ['plain'], bands: 0, headTail: null,
          }, { noContact: true });
        }),
      );
      return R.board('coverings', entries, cells, 25, 10, 26);
    },
  },
  {
    key: 'tooling',
    note: '50 ornament/tooling marks, shape + covering held still',
    fn: async () => {
      const bd = await import('/src/art/bookDesign.ts');
      const flat = await import('/src/art/flat.ts');
      const R = globalThis.__roster;
      const base = bd.resolveBookDesign({ seed: 0x51e5, cloth: 12, accent: 22 });
      const entries = bd.DECORATIONS.map((id) => ({
        id,
        label: bd.DECORATION_LABELS[id] ?? id,
        oddity: bd.DECORS[id].tier === 'oddity',
      }));
      const cells = entries.map((e) =>
        R.cell(34, 232, flat.FLAT.recess, (ctx, s) => {
          bd.drawBookSpine(ctx, 0, 0, 34 * s, 232 * s, {
            ...base, shape: 'flat', material: 'smooth-cloth', decorations: [e.id], bands: 0, headTail: null,
          }, { noContact: true });
        }),
      );
      return R.board('tooling', entries, cells, 25, 10, 26);
    },
  },
  {
    key: 'bindings',
    note: 'every named binding preset, through renderSpine, titled',
    fn: async () => {
      const sp = await import('/src/art/spines.ts');
      const bd = await import('/src/art/bookDesign.ts');
      const flat = await import('/src/art/flat.ts');
      const R = globalThis.__roster;
      const params = sp.deriveSpineParams(0x51e5a3);
      const entries = bd.BOOK_PRESETS.map((p) => ({
        id: p.id,
        label: p.label ?? p.id,
        oddity: p.tier === 'oddity',
      }));
      const cells = entries.map((e) =>
        R.cell(34, 232, flat.FLAT.recess, (ctx, s) => {
          sp.renderSpine(ctx, { ...params, w: 34, binding: e.id }, 0, 0, 232 * s, s, {
            hiRes: true,
          });
        }),
      );
      return R.board('bindings', entries, cells, 25, 10, 26);
    },
  },
  /* ------------------------------------------------ the marks ON the spine */
  {
    key: 'ornaments',
    note: '50 brass stamps, on the spine, in the BEST compartment one ever gets',
    fn: async () => {
      const sp = await import('/src/art/spines.ts');
      const flat = await import('/src/art/flat.ts');
      const R = globalThis.__roster;
      // Deliberately the kindest spine in the vocabulary: a wide-ish octavo,
      // no raised cords crowding the panel. If a stamp cannot
      // be told apart HERE it cannot be told apart anywhere.
      const params = { ...sp.deriveSpineParams(0x51e5a3), raisedBands: 0, headTail: false };
      const entries = sp.ORNAMENT_LABELS.map((label, i) => ({ id: `${i} ${label}`, label, oddity: false }));
      const cells = entries.map((_, i) =>
        R.cell(34, 232, flat.FLAT.recess, (ctx, s) => {
          sp.renderSpine(
            ctx,
            { ...params, w: 34, ornament: i, ornamentOn: true, charm: 'none' },
            0, 0, 232 * s, s, { hiRes: true },
          );
        }),
      );
      // Scored on the free compartment where the stamp is struck.
      return R.board('ornaments', entries, cells, 25, 12, 12, {
        sigCrop: { x: 0.05, y: 0.5, w: 0.9, h: 0.34 },
      });
    },
  },
  {
    key: 'edges',
    /*
     * The edges are on the SHELF board only because that is where a reader
     * meets a book most. The result is the point: `params.edge` is read by
     * `art/covers.ts` and by nothing in `art/spines.ts`, so all fifty draw the
     * same spine. `params.pageBlock` is rolled by `deriveSpineParams` and read
     * by nothing at all. The `cover-edges` board below is where they DO draw.
     */
    note: '50 fore-edge treatments, on the shelved spine (where they are not drawn)',
    fn: async () => {
      const sp = await import('/src/art/spines.ts');
      const flat = await import('/src/art/flat.ts');
      const R = globalThis.__roster;
      const params = sp.deriveSpineParams(0x51e5a3);
      const entries = sp.EDGE_TREATMENTS.map((id) => ({
        id,
        label: sp.EDGE_LABELS[id] ?? id,
        oddity: false,
      }));
      const cells = entries.map((e) =>
        R.cell(34, 232, flat.FLAT.recess, (ctx, s) => {
          sp.renderSpine(ctx, { ...params, w: 34, edge: e.id, pageBlock: 0.2, charm: 'none' }, 0, 0, 232 * s, s, {
            hiRes: true,
          });
        }),
      );
      return R.board('edges', entries, cells, 25, 10, 26);
    },
  },
  {
    key: 'charms',
    note: 'every charm × a sample of colourways, at the head of a spine',
    fn: async () => {
      const sp = await import('/src/art/spines.ts');
      const ch = await import('/src/art/charms.ts');
      const flat = await import('/src/art/flat.ts');
      const R = globalThis.__roster;
      const params = sp.deriveSpineParams(0x51e5a3);
      const entries = [];
      ch.CHARM_KINDS_WITH_ART.forEach((kind) => {
        for (const col of [0, 7, 14]) {
          entries.push({ id: `${kind}/${col}`, label: `${ch.CHARM_LABELS[kind]} ${col}`, oddity: false });
          entries[entries.length - 1].kind = kind;
          entries[entries.length - 1].col = col;
        }
      });
      const cells = entries.map((e) =>
        R.cell(34, 232, flat.FLAT.recess, (ctx, s) => {
          sp.renderSpine(
            ctx,
            { ...params, w: 34, charm: e.kind, charmColor: e.col, ornamentOn: false },
            0, 0, 232 * s, s, { hiRes: true },
          );
        }),
      );
      // Scored on the head of the spine, which is the only place a charm goes.
      return R.board('charms', entries, cells, 18, 14, 10, {
        sigCrop: { x: 0, y: 0, w: 1, h: 0.2 },
      });
    },
  },
  {
    key: 'cloths',
    note: 'the 50 house cloths a spine may be bound in',
    fn: async () => {
      const bd = await import('/src/art/bookDesign.ts');
      const flat = await import('/src/art/flat.ts');
      const R = globalThis.__roster;
      const entries = flat.CLOTH_LABELS.map((label, i) => ({ id: `${i} ${label}`, label, oddity: false }));
      const cells = entries.map((_, i) =>
        R.cell(34, 232, flat.FLAT.recess, (ctx, s) => {
          const d = bd.resolveBookDesign({ seed: 0x51e5, cloth: i, accent: 22 });
          bd.drawBookSpine(ctx, 0, 0, 34 * s, 232 * s, {
            ...d, shape: 'flat', material: 'smooth-cloth', decorations: ['plain'], bands: 0, headTail: null,
          }, { noContact: true });
        }),
      );
      return R.board('cloths', entries, cells, 25, 10, 26);
    },
  },
];

/* ------------------------------------------------------------ carpentry --- */
const CARPENTRY = (which) => ({
  key: which,
  note:
    which === 'builds'
      ? '52 carpentry builds — a 300-world-px window on a real case, cropped from the full-width bake'
      : '50 timber patterns — the same window, one build',
  fn: async (which) => {
    const shelf = await import('/src/art/flatShelf.ts');
    const sd = await import('/src/art/shelfDesign.ts');
    const flat = await import('/src/art/flat.ts');
    const R = globalThis.__roster;

    /* The real world numbers, from features/bookshelf/constants.ts. */
    const SHELF_WIDTH = 1200, RAIL_W = 34, CROWN_H = 64, CROWN_LIP = 14, PLANK_H = 40;
    const WIN_W = 300, ZONE_H = 220, WIN_H = CROWN_H + ZONE_H + PLANK_H;

    /**
     * Draw the case at its REAL width and crop a window out of it.
     *
     * Not negotiable: `bakeFlatBack` hands `drawRecess` a frame of the whole
     * 1200px opening, so an arcade's springing, a valance's scallops and a
     * compartment run are all measured against 1200. Draw a 300px-wide case
     * and you get a build nobody can have.
     */
    function cropCase(design) {
      return R.cell(WIN_W, WIN_H, flat.FLAT.wall, (ctx, s) => {
        const full = R.mk((SHELF_WIDTH + CROWN_LIP * 2) * s, WIN_H * s);
        const f = full.getContext('2d');
        f.lineJoin = 'round';
        f.lineCap = 'round';
        f.fillStyle = flat.flatScheme().wall;
        f.fillRect(0, 0, full.width, full.height);
        const over = Math.max(SHELF_WIDTH, ZONE_H) * 0.05 + 8;
        f.save();
        f.translate(CROWN_LIP * s, CROWN_H * s);
        // recess, with the true full-width opening as its frame
        shelf.drawRecess(
          f, -over * s, -over * s, (SHELF_WIDTH + over * 2) * s, (ZONE_H + over * 2) * s,
          0x9c31, design, { x: RAIL_W * s, y: 0, w: (SHELF_WIDTH - RAIL_W * 2) * s, h: ZONE_H * s },
        );
        shelf.drawPlank(f, 0, ZONE_H * s, SHELF_WIDTH * s, PLANK_H * s, 0x51a1, design);
        const povr = RAIL_W * s * 0.3 + 4;
        shelf.drawPost(f, 0, -povr, RAIL_W * s, (ZONE_H + PLANK_H) * s + povr * 2, 0x2f19, design,
          { x: 0, y: 0, w: RAIL_W * s, h: (ZONE_H + PLANK_H) * s });
        shelf.drawPost(f, (SHELF_WIDTH - RAIL_W) * s, -povr, RAIL_W * s, (ZONE_H + PLANK_H) * s + povr * 2,
          0x2f19, design, { x: 0, y: 0, w: RAIL_W * s, h: (ZONE_H + PLANK_H) * s });
        f.restore();
        shelf.drawCrown(f, 0, 0, (SHELF_WIDTH + CROWN_LIP * 2) * s, CROWN_H * s, 0x7ab3, design);
        // The window: the left corner of the case, where the post, the crown's
        // lip and the opening's springing all meet — the busiest 300px there is.
        ctx.drawImage(full, 0, 0, WIN_W * s, WIN_H * s, 0, 0, WIN_W * s, WIN_H * s);
      });
    }

    let entries;
    let cells;
    if (which === 'builds') {
      entries = sd.BUILD_IDS.map((id) => ({
        id, label: sd.BUILDS[id].label ?? id, oddity: sd.BUILDS[id].tier === 'offcut',
      }));
      cells = entries.map((e) => cropCase({ build: e.id, pattern: 'bare' }));
    } else {
      entries = sd.PATTERN_IDS.map((id) => ({
        id, label: sd.PATTERNS[id].label ?? id, oddity: sd.PATTERNS[id].tier === 'offcut',
      }));
      cells = entries.map((e) => cropCase({ build: 'plank', pattern: e.id }));
    }
    // Scored on the frieze + post + board — the timber. Not on the recess,
    // which is 60% of the window, carries no pattern, and would otherwise
    // drown fifty different carvings in one flat green.
    return R.board(which, entries, cells, 6, 26, 8, {
      trueWidth: 1460,
      mag: 1,
      sigCrop: which === 'patterns' ? { x: 0, y: 0, w: 1, h: 0.22 } : null,
    });
  },
});

/* ------------------------------------------------------------ wallpaper --- */
const WALLPAPER = {
  key: 'wallpapers',
  note: 'every paper, tiled, at the size the wall shows it (tileScale = zoom 0.8)',
  fn: async (_which, sheet) => {
    const wp = await import('/src/art/wallpaperDesign.ts');
    const flat = await import('/src/art/flat.ts');
    const R = globalThis.__roster;
    const PATCH = 210; // world px across a swatch of wall
    const all = wp.WALLPAPER_PRESETS;
    const roll = new Set(wp.WALLPAPER_ROLL.map((p) => p.id));
    const from = sheet * 63;
    const slice = all.slice(from, from + 63);
    const entries = slice.map((p) => ({ id: p.id, label: p.label ?? p.id, oddity: !roll.has(p.id) }));
    const cells = slice.map((p) => {
      const spec = wp.wallpaperSpec(p.id);
      const css = wp.wallpaperTilePx(spec, 1);
      const tile = R.mk(css, css);
      const tctx = tile.getContext('2d');
      wp.renderWallpaperTile(tctx, css, spec);
      return R.cell(PATCH, PATCH * 0.75, flat.FLAT.wall, (ctx, s) => {
        const pat = ctx.createPattern(tile, 'repeat');
        // The wall lays the tile down at ONE texel per world px (tileScale
        // tracks the camera), so the pattern is scaled by the bake factor only.
        ctx.save();
        ctx.scale(s, s);
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, PATCH, PATCH * 0.75);
        ctx.restore();
      });
    });
    return R.board(`wallpapers-${sheet}`, entries, cells, 9, 20, 15, { trueWidth: 1460, mag: 1 });
  },
};

/* --------------------------------------------------------------- covers --- */
const COVERS = {
  key: 'covers',
  note: 'the pull-out cover — the one surface met LARGE',
  fn: async (_w, which) => {
    const cv = await import('/src/art/covers.ts');
    const sp = await import('/src/art/spines.ts');
    const flat = await import('/src/art/flat.ts');
    const R = globalThis.__roster;

    // The real pull-out: height = clamp(vh*0.82, 220..720), width = h*0.72.
    const H = 656, W = Math.round(H * 0.72);
    const base = cv.deriveCoverParams(sp.deriveSpineParams(0x51e5a3), 0x51e5a3);

    /** A cover at TRUE pull-out size, optionally cropped to one region. */
    function cover(over, crop) {
      const c = R.mk(crop ? crop.w : W, crop ? crop.h : H);
      const ctx = c.getContext('2d');
      const full = R.mk(W, H);
      const fctx = full.getContext('2d');
      fctx.fillStyle = flat.FLAT.paper ?? '#efe6d2';
      fctx.fillRect(0, 0, W, H);
      cv.renderCoverInto(fctx, W, H, { ...base, ...over }, 'Bellanote');
      if (crop) ctx.drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
      else ctx.drawImage(full, 0, 0);
      return c;
    }

    if (which === 'frames') {
      const entries = cv.FRAME_LABELS.map((label, i) => ({ id: `${i} ${label}`, label, oddity: false }));
      // A frame is the cover's EDGE, so the honest crop is a full-width band
      // top and bottom — at half the pull-out's size so fifty fit on a sheet.
      const cells = entries.map((_, i) => {
        const full = cover({ frame: i });
        const half = R.mk(Math.round(W / 2), Math.round(H / 2));
        const hctx = half.getContext('2d');
        hctx.imageSmoothingEnabled = true;
        hctx.imageSmoothingQuality = 'high';
        hctx.drawImage(full, 0, 0, half.width, half.height);
        return half;
      });
      // Scored on the top band, where a frame's rules and corner marks are —
      // the middle of the board carries the plate and the medallion, which do
      // not vary here and would otherwise swamp fifty different borders.
      return R.board('cover-frames', entries, cells, 8, 26, 6, {
        trueWidth: 1460, mag: 1, sigCrop: { x: 0.1, y: 0, w: 0.9, h: 0.16 },
      });
    }
    if (which === 'medallions') {
      const entries = sp.ORNAMENT_LABELS.map((label, i) => ({ id: `${i} ${label}`, label, oddity: false }));
      // TRUE size, cropped to the medallion field — the mark is ~9% of the
      // board, so a whole-cover grid would show fifty grey dots.
      const crop = { x: Math.round(W * 0.3), y: Math.round(H * 0.6), w: Math.round(W * 0.4), h: Math.round(W * 0.4) };
      const cells = entries.map((_, i) => cover({ medallion: i }, crop));
      return R.board('cover-medallions', entries, cells, 10, 16, 16, { trueWidth: 1460, mag: 1 });
    }
    if (which === 'charms') {
      // The charm KIND is drawn by `covers.paintCharm` and by nothing on the
      // spine — `spines.drawSpineRibbon` reads only `charmColor`. So this is
      // the only surface on which the six kinds are six pictures.
      const ch = await import('/src/art/charms.ts');
      const entries = ch.CHARM_KINDS_WITH_ART.map((k) => ({ id: k, label: ch.CHARM_LABELS[k], oddity: false }));
      const cells = entries.map((e) => cover({ charm: e.id, charmColor: 7 }));
      return R.board('cover-charms', entries, cells, 6, 20, 26, { trueWidth: 2900, mag: 1 });
    }
    if (which === 'edges') {
      // `paintTextBlock` puts the fore-edge strip down the RIGHT of the board.
      const entries = sp.EDGE_TREATMENTS.map((id) => ({ id, label: sp.EDGE_LABELS[id] ?? id, oddity: false }));
      const crop = { x: Math.round(W * 0.84), y: Math.round(H * 0.05), w: Math.round(W * 0.16), h: Math.round(H * 0.9) };
      const cells = entries.map((e) => cover({ edge: e.id }, crop));
      return R.board('cover-edges', entries, cells, 25, 6, 26, { trueWidth: 1460, mag: 1 });
    }
    if (which === 'hands') {
      const entries = cv.COVER_FONTS.map((label, i) => ({ id: `${i} ${label}`, label, oddity: false }));
      const crop = { x: Math.round(W * 0.08), y: Math.round(H * 0.24), w: Math.round(W * 0.84), h: Math.round(H * 0.2) };
      const cells = entries.map((_, i) => cover({ titleFont: i }, crop));
      return R.board('cover-hands', entries, cells, 3, 24, 10, { trueWidth: 1460, mag: 1 });
    }
    /* which === 'full': a handful at FULL pull-out size, the richness call. */
    const picks = [
      { seed: 0x51e5a3, frame: 3, medallion: 12, covering: 4, titleFont: 0 },
      { seed: 0x1234, frame: 17, medallion: 27, covering: 19, titleFont: 11, gilt: true },
      { seed: 0xbeef, frame: 33, medallion: 40, covering: 31, titleFont: 22, gilt: false },
      { seed: 0x9911, frame: 45, medallion: 6, covering: 44, titleFont: 33, gilt: true },
    ];
    const entries = picks.map((p, i) => ({ id: `pull-${i}`, label: `frame ${p.frame} · med ${p.medallion}`, oddity: false }));
    const cells = picks.map((p) => cover(p));
    return R.board('cover-full', entries, cells, 4, 20, 26, { trueWidth: 2000, mag: 1 });
  },
};

/* ========================================================================== *
 * Run.
 * ========================================================================== */
const reports = [];

async function emit(id, fn, a, b) {
  process.stdout.write(`  ${id} … `);
  let rep;
  try {
    rep = await page.evaluate(
      async ([src, a, b]) => {
        document.body.innerHTML = '';
        document.body.style.cssText = 'margin:0;background:#e9e2d0;';
        const fn = new Function('return ' + src)();
        return await fn(a, b);
      },
      [fn.toString(), a ?? null, b ?? null],
    );
  } catch (e) {
    console.log('FAILED —', String(e).split('\n')[0]);
    return;
  }
  await page.waitForTimeout(120);
  for (const kind of ['true', 'mag']) {
    const sel = `#${rep.key}-${kind}`;
    if ((await page.locator(sel).count()) === 0) continue;
    await page.locator(sel).screenshot({ path: `${OUT}/${rep.key}-${kind}.png` });
  }
  reports.push(rep);
  console.log(
    `${rep.count} entries, cell ${rep.cellPx}px, ${rep.distinct} distinct pictures` +
      (rep.identical.length ? `, ${rep.identical.length} colliding pairs` : ''),
  );
  if (rep.identical.length) {
    for (const p of rep.identical.slice(0, 12)) console.log(`      SAME  ${p.a}  ==  ${p.b}   (d=${p.d})`);
  }
  if (rep.near.length) {
    for (const p of rep.near.slice(0, 6)) console.log(`      near  ${p.a}  ~~  ${p.b}   (d=${p.d})`);
  }
}

const want = (k) => ONLY.length === 0 || ONLY.includes(k);

console.log(`roster-board → ${OUT}  (bake 2× · rest zoom 0.8 · magnified ×2 nearest)`);
for (const axis of AXES) if (want(axis.key)) await emit(axis.key, axis.fn);
for (const w of ['builds', 'patterns']) if (want(w)) await emit(w, CARPENTRY(w).fn, w);
for (const s of [0, 1]) if (want('wallpapers')) await emit(`wallpapers-${s}`, WALLPAPER.fn, null, s);
for (const w of ['full', 'frames', 'medallions', 'hands', 'charms', 'edges'])
  if (want('covers')) await emit(`cover-${w}`, COVERS.fn, null, w);

writeFileSync(`${OUT}/report.json`, JSON.stringify(reports, null, 2));
console.log(`\nwrote ${reports.length} axis reports → ${OUT}/report.json`);
await browser.close();
