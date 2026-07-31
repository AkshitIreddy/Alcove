/**
 * render/testScene.ts — the proving scene for the deferred pass.
 *
 * A deliberately *stupid* scene: flat coloured rectangles standing on a flat
 * plank, painted with `fillRect` and nothing else. No gradients, no bevels, no
 * texture, no shading of any kind — if this scene comes out looking
 * three-dimensional, the depth is coming from the light pass and only from the
 * light pass. That is the claim the contact sheet has to prove, and a scene
 * with any shading baked into its albedo could not prove it.
 *
 * It emits the two buffers the pass consumes:
 *
 *  - **albedo** — flat local colour;
 *  - **NHB** — one `roundedBox` per book, one `bevel` per plank, a `plane`
 *    for the case back, via `render/normals.ts`.
 *
 * The composition follows the reference photograph: densely packed books with
 * wildly varied widths and an irregular skyline, a couple of leaning, some
 * pulled proud and some pushed back, and leaf domes framing the edges rather
 * than covering the middle.
 */

import { mulberry32 } from '../art/noise';
import {
  emitBackplane,
  emitHeight,
  type NormalCanvas,
  type NormalCtx,
} from './normals';

export interface TestSceneOptions {
  width: number;
  height: number;
  seed?: number;
  /** Rows of books. Default 2. */
  shelves?: number;
  /** Leaf domes down the left and right margins. Default true. */
  foliage?: boolean;
  /**
   * Paint the albedo in flat mid-tones only, with no value structure at all —
   * the harshest test, and the state the app was actually in.
   */
  flatAlbedo?: boolean;
}

export interface TestScene {
  albedo: NormalCanvas;
  normals: NormalCanvas;
  width: number;
  height: number;
}

/* -------------------------------------------------------------------------- */

/**
 * Book cloth colours, straight from the reference: oxblood, navy, forest, tan,
 * cream, plum. Deliberately *unlit* — mid-value local colour, the thing the
 * pass has to turn into a range.
 */
const BOOK_COLOURS: readonly string[] = [
  '#6d2b28',
  '#7d3b2a',
  '#2f3a52',
  '#24303a',
  '#2f4436',
  '#3f5340',
  '#8a6b3f',
  '#a08355',
  '#c8b48a',
  '#d9cba6',
  '#54324a',
  '#3a2b3f',
  '#7a3f31',
  '#455a63',
  '#6b5330',
];

const WOOD = '#5a4230';
const BACK = '#2b2119';
const LEAF = '#3d5a33';
const LEAF_LIGHT = '#587a3c';

function makeCanvas(w: number, h: number): NormalCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: NormalCanvas): NormalCtx {
  return c.getContext('2d') as NormalCtx;
}

/* -------------------------------------------------------------------------- */

interface Book {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  lean: number;
  proud: number;
  bands: number;
}

/**
 * Lay out one shelf's worth of books.
 *
 * The rhythm matters more than any single book: runs of thin volumes, then a
 * fat tome, then a gap, then a leaner. A row of equal-width rectangles is the
 * thing that reads as a barcode no matter how well it is lit.
 */
function layoutShelf(
  rnd: () => number,
  x0: number,
  x1: number,
  baseline: number,
  maxHeight: number,
): Book[] {
  const books: Book[] = [];
  let x = x0;
  let guard = 0;
  while (x < x1 - 6 && guard++ < 400) {
    // Occasional gap — the reference has them and they read as air.
    if (rnd() < 0.05 && x > x0 + 40 && x < x1 - 80) {
      x += 6 + rnd() * 16;
      continue;
    }
    const roll = rnd();
    const w =
      roll < 0.28
        ? 6 + rnd() * 6 // slivers
        : roll < 0.78
          ? 12 + rnd() * 14 // the bulk
          : 28 + rnd() * 20; // tomes
    if (x + w > x1) break;
    const h = maxHeight * (0.68 + rnd() * 0.32);
    const lean = rnd() < 0.08 ? (rnd() - 0.5) * 0.16 : 0;
    books.push({
      x,
      y: baseline - h,
      w,
      h,
      colour: BOOK_COLOURS[Math.floor(rnd() * BOOK_COLOURS.length)] as string,
      lean,
      // Proudness: most flush, a few pulled forward, a few pushed back. This
      // is what gives the shadow march something to march over.
      proud: rnd() < 0.2 ? 0.85 + rnd() * 0.15 : rnd() < 0.25 ? 0.2 + rnd() * 0.2 : 0.45 + rnd() * 0.25,
      bands: w > 20 && rnd() < 0.45 ? 3 + Math.floor(rnd() * 3) : 0,
    });
    x += w + 0.6;
  }
  return books;
}

/**
 * Build the scene.
 *
 * Deterministic for a given seed, so a contact sheet compares *lighting*
 * across cells rather than accidentally comparing two different shelves.
 */
export function buildTestScene(opts: TestSceneOptions): TestScene {
  const W = Math.max(16, Math.round(opts.width));
  const H = Math.max(16, Math.round(opts.height));
  const rnd = mulberry32((opts.seed ?? 0x5eed) >>> 0);
  const shelves = Math.max(1, opts.shelves ?? 2);

  const albedo = makeCanvas(W, H);
  const normals = makeCanvas(W, H);
  const a = ctxOf(albedo);
  const n = ctxOf(normals);

  /* ---- case back ---------------------------------------------------------- */
  a.fillStyle = opts.flatAlbedo === true ? '#4a4038' : BACK;
  a.fillRect(0, 0, W, H);
  emitBackplane(n, W, H, 0.06);

  /* ---- side walls (they give the AO something to bite on) ----------------- */
  const wallW = Math.round(W * 0.045);
  a.fillStyle = opts.flatAlbedo === true ? '#4a4038' : '#4a3728';
  a.fillRect(0, 0, wallW, H);
  a.fillRect(W - wallW, 0, wallW, H);
  emitHeight(n, { kind: 'wedge', axis: 'x', from: 0.62, to: 0.1, round: 0.3 }, {
    x: 0,
    y: 0,
    width: wallW,
    height: H,
  });
  emitHeight(n, { kind: 'wedge', axis: 'x', from: 0.1, to: 0.62, round: 0.3 }, {
    x: W - wallW,
    y: 0,
    width: wallW,
    height: H,
  });

  /* ---- shelves ------------------------------------------------------------ */
  const margin = wallW + 4;
  const bandH = H / shelves;
  const plankH = Math.max(8, Math.round(bandH * 0.085));

  for (let s = 0; s < shelves; s++) {
    const top = s * bandH + bandH * 0.1;
    const baseline = (s + 1) * bandH - plankH;
    const maxBookH = baseline - top;

    const books = layoutShelf(rnd, margin, W - margin, baseline, maxBookH);
    for (const b of books) {
      a.save();
      if (b.lean !== 0) {
        a.translate(b.x + b.w / 2, b.y + b.h);
        a.rotate(b.lean);
        a.translate(-(b.x + b.w / 2), -(b.y + b.h));
      }
      a.fillStyle = opts.flatAlbedo === true ? '#8a7f6f' : b.colour;
      a.fillRect(b.x, b.y, b.w, b.h);
      a.restore();

      emitHeight(
        n,
        {
          kind: 'roundedBox',
          axis: 'x',
          radius: 0.26,
          height: 0.34 + b.proud * 0.52,
          edgeHeight: (0.34 + b.proud * 0.52) * 0.46,
          crossRadius: 0.03,
        },
        {
          x: b.x,
          y: b.y,
          width: b.w,
          height: b.h,
          rotation: b.lean,
        },
      );
      if (b.bands > 0) {
        emitHeight(
          n,
          { kind: 'ribs', axis: 'y', height: 0.5, amplitude: 0.07, count: b.bands, round: 0.85 },
          { x: b.x, y: b.y, width: b.w, height: b.h, opacity: 0.35, rotation: b.lean },
        );
      }
    }

    // The plank the row stands on: a bevelled board proud of the case back.
    a.fillStyle = opts.flatAlbedo === true ? '#7a6a58' : WOOD;
    a.fillRect(0, baseline, W, plankH);
    emitHeight(
      n,
      {
        kind: 'bevel',
        size: 0.3,
        height: 0.92,
        edgeHeight: 0.5,
        round: 0.6,
        edges: { top: true, bottom: true, left: false, right: false },
      },
      { x: 0, y: baseline, width: W, height: plankH },
    );
    // The joint where the plank meets the back — pure AO food.
    emitHeight(n, { kind: 'groove', axis: 'y', height: 0.2, depth: 0.19, width: 0.9, round: 0.7 }, {
      x: 0,
      y: baseline - plankH * 0.5,
      width: W,
      height: plankH * 0.5,
    });
  }

  /* ---- foliage at the edges (never over the middle) ----------------------- */
  if (opts.foliage !== false) {
    const clusters = 5;
    for (let c = 0; c < clusters; c++) {
      const left = c % 2 === 0;
      const cx = left ? wallW + W * (0.02 + rnd() * 0.06) : W - wallW - W * (0.02 + rnd() * 0.06);
      const cy = H * (0.1 + (c / clusters) * 0.8);
      const leaves = 7 + Math.floor(rnd() * 6);
      for (let i = 0; i < leaves; i++) {
        const ang = rnd() * Math.PI * 2;
        const rad = rnd() * W * 0.05;
        const size = W * (0.016 + rnd() * 0.026);
        const lx = cx + Math.cos(ang) * rad - size / 2;
        const ly = cy + Math.sin(ang) * rad - size / 2;
        const lit = rnd() < 0.4;
        a.fillStyle = opts.flatAlbedo === true ? '#6f8a55' : lit ? LEAF_LIGHT : LEAF;
        a.beginPath();
        a.ellipse(lx + size / 2, ly + size / 2, size * 0.5, size * 0.34, ang, 0, Math.PI * 2);
        a.fill();
        emitHeight(
          n,
          {
            kind: 'dome',
            height: 0.72 + rnd() * 0.2,
            edgeHeight: 0.5,
            power: 1.1,
            rib: 0.3,
            ribAxis: 'y',
            elongate: 0.35,
          },
          { x: lx, y: ly, width: size, height: size * 0.72, rotation: ang },
        );
      }
    }
  }

  return { albedo, normals, width: W, height: H };
}
