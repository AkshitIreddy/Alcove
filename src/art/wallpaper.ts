/**
 * art/wallpaper.ts — the wallpaper library (docs/design/library-themes.md §2).
 *
 * Twelve tileable patterns, each `render(ctx, size, colourway, seed)`.
 * Pattern and colourway are fully independent, so the Book Studio can mix any
 * of the twelve patterns with any of the twelve colourways (144 walls) and a
 * theme's own pairing is just the default.
 *
 * House rules, enforced by construction:
 *  - **Seamless.** Every motif is stamped through `stamp()`, which repeats it
 *    at the eight neighbouring tile offsets, and every continuous line is
 *    periodic in the tile (integer wave counts, spacings that divide `size`).
 *    Nothing is sampled from a non-tiling noise field.
 *  - **Very low contrast.** Ink alphas live in 0.06–0.18. The wall must never
 *    fight the books; it should only be legible when you look for it.
 *  - **Pencil linework at 1–1.5px**, doubled and wobbled for the signature
 *    motifs, cheap seeded jitter for the high-count small ones.
 *  - **One accent motif per tile at low frequency** so the repeat is hard to
 *    read at a glance.
 *
 * Baked once per (pattern × colourway × size × DPR) through the bake.ts disk
 * cache, keyed with THEME_RECIPE_VERSION (bake.ts's RECIPE_VERSION belongs to
 * the shelf pipeline and is not ours to bump).
 */

import { bakeCached } from './bake';
import { mulberry32, type RandomFn } from './noise';
import type { Canvas2D, Ctx2D } from './spines';
import {
  THEME_RECIPE_VERSION,
  WALLPAPER_PATTERN_IDS,
  type ColourwayId,
  type WallpaperPatternId,
} from './themes';
import { doubleStroke } from './wobble';

/* ============================== colourways =============================== */

export interface Colourway {
  id: ColourwayId;
  name: string;
  /** Wall body colour. */
  base: string;
  /** Second body tone used for the soft mottling wash. */
  baseAlt: string;
  /** Primary pencil ink (already includes its alpha). */
  ink: string;
  /** Fainter ink for secondary/structural linework. */
  inkSoft: string;
  /** The one accent colour — gold pins, rose hearts, silver stars. */
  accent: string;
}

export const COLOURWAYS: Readonly<Record<ColourwayId, Colourway>> = {
  tobacco: {
    id: 'tobacco',
    name: 'Deep Tobacco',
    base: '#4a3826',
    baseAlt: '#5a4630',
    ink: 'rgba(226, 196, 148, 0.16)',
    inkSoft: 'rgba(226, 200, 156, 0.09)',
    accent: 'rgba(226, 182, 84, 0.24)',
  },
  eucalyptus: {
    id: 'eucalyptus',
    name: 'Pale Eucalyptus',
    base: '#dfe6d8',
    baseAlt: '#d2dbc9',
    ink: 'rgba(88, 112, 84, 0.17)',
    inkSoft: 'rgba(96, 118, 92, 0.1)',
    accent: 'rgba(150, 128, 92, 0.2)',
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Navy',
    base: '#1c2340',
    baseAlt: '#252d4e',
    ink: 'rgba(180, 200, 236, 0.15)',
    inkSoft: 'rgba(170, 192, 232, 0.08)',
    accent: 'rgba(238, 208, 122, 0.4)',
  },
  'rose-cream': {
    id: 'rose-cream',
    name: 'Rose on Cream',
    base: '#f2e6d6',
    baseAlt: '#ecdcc8',
    ink: 'rgba(158, 106, 100, 0.16)',
    inkSoft: 'rgba(150, 112, 96, 0.09)',
    accent: 'rgba(198, 122, 122, 0.26)',
  },
  limewash: {
    id: 'limewash',
    name: 'Limewash',
    base: '#e3dccb',
    baseAlt: '#d6ceba',
    ink: 'rgba(118, 106, 88, 0.12)',
    inkSoft: 'rgba(122, 110, 92, 0.07)',
    accent: 'rgba(146, 110, 78, 0.16)',
  },
  rice: {
    id: 'rice',
    name: 'Rice Paper',
    base: '#f2ece0',
    baseAlt: '#e9e1d2',
    ink: 'rgba(118, 116, 100, 0.12)',
    inkSoft: 'rgba(124, 122, 106, 0.07)',
    accent: 'rgba(196, 148, 156, 0.22)',
  },
  greyboard: {
    id: 'greyboard',
    name: 'Grey Board',
    base: '#cfc7ba',
    baseAlt: '#c0b8ab',
    ink: 'rgba(86, 80, 70, 0.15)',
    inkSoft: 'rgba(90, 84, 74, 0.09)',
    accent: 'rgba(140, 118, 88, 0.2)',
  },
  amber: {
    id: 'amber',
    name: 'Apothecary Amber',
    base: '#c99a52',
    baseAlt: '#bd8c46',
    ink: 'rgba(84, 50, 22, 0.17)',
    inkSoft: 'rgba(90, 56, 26, 0.1)',
    accent: 'rgba(60, 36, 16, 0.24)',
  },
  oxblood: {
    id: 'oxblood',
    name: 'Oxblood',
    base: '#59292a',
    baseAlt: '#663234',
    ink: 'rgba(232, 198, 178, 0.15)',
    inkSoft: 'rgba(230, 200, 182, 0.08)',
    accent: 'rgba(220, 176, 96, 0.24)',
  },
  'slate-blue': {
    id: 'slate-blue',
    name: 'Slate Blue',
    base: '#5c6b78',
    baseAlt: '#6a7986',
    ink: 'rgba(224, 234, 240, 0.15)',
    inkSoft: 'rgba(220, 232, 240, 0.08)',
    accent: 'rgba(226, 214, 178, 0.22)',
  },
  moss: {
    id: 'moss',
    name: 'Moss',
    base: '#5d6a4c',
    baseAlt: '#687656',
    ink: 'rgba(226, 232, 208, 0.14)',
    inkSoft: 'rgba(222, 230, 204, 0.08)',
    accent: 'rgba(214, 184, 112, 0.22)',
  },
  ivory: {
    id: 'ivory',
    name: 'Ivory',
    base: '#f4efe2',
    baseAlt: '#ebe4d4',
    ink: 'rgba(122, 108, 86, 0.13)',
    inkSoft: 'rgba(126, 112, 90, 0.08)',
    accent: 'rgba(178, 146, 92, 0.2)',
  },
};

/** Resolve a colourway id (or a literal colourway) to a Colourway. */
export function getColourway(c: ColourwayId | Colourway): Colourway {
  return typeof c === 'string' ? (COLOURWAYS[c] ?? COLOURWAYS.ivory) : c;
}

/* ============================== primitives =============================== */

/**
 * Stamp a motif at (x, y) and at every neighbouring tile offset that could
 * overlap the tile, given the motif's bounding radius. This is what makes
 * every pattern seamless without any edge bookkeeping in the motif itself.
 */
function stamp(
  size: number,
  x: number,
  y: number,
  radius: number,
  draw: (cx: number, cy: number) => void,
): void {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const cx = x + ox;
      const cy = y + oy;
      if (cx + radius < 0 || cx - radius > size) continue;
      if (cy + radius < 0 || cy - radius > size) continue;
      draw(cx, cy);
    }
  }
}

/** Cheap hand-drawn polyline: quadratic segments with seeded jitter. */
function sketch(ctx: Ctx2D, pts: readonly (readonly [number, number])[], rnd: RandomFn, j = 0.9): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  const first = pts[0]!;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const mx = (a[0] + b[0]) / 2 + (rnd() * 2 - 1) * j;
    const my = (a[1] + b[1]) / 2 + (rnd() * 2 - 1) * j;
    ctx.quadraticCurveTo(mx, my, b[0], b[1]);
  }
  ctx.stroke();
}

/** Doubled, wobbled pencil pass for the signature motifs (uses wobble.ts). */
function pencil(ctx: Ctx2D, d: string, seed: number, amplitude = 0.6): void {
  const [a, b] = doubleStroke(d, { seed: seed >>> 0, amplitude, frequency: 0.035 });
  ctx.stroke(new Path2D(a));
  ctx.stroke(new Path2D(b));
}

/**
 * Wall ground: flat base plus a few very soft tonal blooms (stamped, so they
 * wrap) — stops every wall reading as a dead flat rectangle behind the case.
 */
function ground(ctx: Ctx2D, size: number, cw: Colourway, rnd: RandomFn, blooms = 5): void {
  ctx.fillStyle = cw.base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < blooms; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = size * (0.22 + rnd() * 0.28);
    stamp(size, x, y, r, (cx, cy) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, cw.baseAlt);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    });
  }
}

/** A small five-petal flower head. */
function flower(ctx: Ctx2D, cx: number, cy: number, r: number, rnd: RandomFn): void {
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI * 2 + rnd() * 0.2;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.46, r * 0.32, a, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
  ctx.stroke();
}

/** A pointed leaf on a stem direction (dx, dy). */
function leaf(ctx: Ctx2D, x: number, y: number, dx: number, dy: number, w: number): void {
  const mx = x + dx * 0.5;
  const my = y + dy * 0.5;
  const nx = -dy;
  const ny = dx;
  const len = Math.hypot(nx, ny) || 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx + (nx / len) * w, my + (ny / len) * w, x + dx, y + dy);
  ctx.quadraticCurveTo(mx - (nx / len) * w, my - (ny / len) * w, x, y);
  ctx.stroke();
}

/* =============================== patterns ================================ */

export interface WallpaperPattern {
  id: WallpaperPatternId;
  name: string;
  /** One-line description for the studio picker. */
  blurb: string;
  /** Paint one seamless tile of `size × size` world px at the current origin. */
  render(ctx: Ctx2D, size: number, colourway: Colourway, seed: number): void;
}

/* --- 1. damask ----------------------------------------------------------- */

const damask: WallpaperPattern = {
  id: 'damask',
  name: 'Damask',
  blurb: 'Ogee lattice with a starburst medallion in every cell.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const half = size / 2;

    // Ogee lattice: an S-curve grid built from two half-cells so the tile
    // wraps in both axes.
    ctx.strokeStyle = cw.inkSoft;
    ctx.lineWidth = 1.2;
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        const x = gx * half;
        const y = gy * half;
        pencil(
          ctx,
          `M ${x} ${y + half / 2} C ${x + half * 0.16} ${y}, ${x + half * 0.84} ${y}, ${x + half} ${y + half / 2}`,
          seed + gx * 7 + gy * 31,
        );
        pencil(
          ctx,
          `M ${x} ${y + half / 2} C ${x + half * 0.16} ${y + half}, ${x + half * 0.84} ${y + half}, ${x + half} ${y + half / 2}`,
          seed + gx * 11 + gy * 41,
        );
      }
    }

    // Medallion: starburst + acanthus lobes at each cell centre.
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        const mx = gx * half + half / 2;
        const my = gy * half + half / 2;
        stamp(size, mx, my, 26, (cx, cy) => {
          ctx.strokeStyle = cw.ink;
          ctx.lineWidth = 1.1;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + 0.12;
            const r0 = i % 2 === 0 ? 18 : 10;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
            ctx.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
            ctx.stroke();
          }
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            leaf(ctx, cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, Math.cos(a) * 13, Math.sin(a) * 13, 4);
          }
          ctx.fillStyle = cw.accent;
          ctx.beginPath();
          ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    // Quatrefoil dots at the lattice crossings.
    ctx.fillStyle = cw.ink;
    for (const [dx, dy] of [[0, 0], [half, 0], [0, half], [half, half]] as const) {
      stamp(size, dx, dy, 6, (cx, cy) => {
        for (const [ox, oy] of [[-3.4, 0], [3.4, 0], [0, -3.4], [0, 3.4]] as const) {
          ctx.beginPath();
          ctx.arc(cx + ox, cy + oy, 1.15, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  },
};

/* --- 2. botanical toile -------------------------------------------------- */

const botanicalToile: WallpaperPattern = {
  id: 'botanical-toile',
  name: 'Botanical Toile',
  blurb: 'Scattered pressed-herbarium sprigs, ferns and seed heads.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.1;

    const sprig = (cx: number, cy: number, rot: number, len: number, kind: number): void => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.strokeStyle = cw.ink;
      sketch(ctx, [[0, len / 2], [0, 0], [0, -len / 2]], rnd, 1.1);
      const pairs = 4 + Math.floor(rnd() * 3);
      for (let i = 0; i < pairs; i++) {
        const t = -len / 2 + (len * (i + 0.5)) / pairs;
        const s = 5 + rnd() * 5;
        if (kind === 0) {
          // Simple opposite leaves.
          leaf(ctx, 0, t, s, -s * 0.5, 2.6);
          leaf(ctx, 0, t, -s, -s * 0.5, 2.6);
        } else if (kind === 1) {
          // Fern pinnae: a comb of short strokes down each side.
          for (const dir of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(0, t);
            ctx.lineTo(dir * s, t - s * 0.45);
            ctx.stroke();
          }
        } else {
          // Seed head: little berries on short stalks.
          for (const dir of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(0, t);
            ctx.lineTo(dir * s * 0.7, t - s * 0.4);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(dir * s * 0.7, t - s * 0.4, 1.6, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      // Tip flower on some sprigs.
      if (kind === 0) {
        ctx.strokeStyle = cw.accent;
        flower(ctx, 0, -len / 2 - 4, 4.5, rnd);
      }
      ctx.restore();
    };

    const count = 9;
    for (let i = 0; i < count; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const rot = (rnd() * 2 - 1) * 0.7;
      const len = 34 + rnd() * 30;
      const kind = i % 3;
      stamp(size, x, y, len, (cx, cy) => sprig(cx, cy, rot, len, kind));
    }

    // Accent: one small vignette wreath per tile.
    const wx = rnd() * size;
    const wy = rnd() * size;
    stamp(size, wx, wy, 22, (cx, cy) => {
      ctx.strokeStyle = cw.accent;
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        leaf(ctx, cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, -Math.sin(a) * 8, Math.cos(a) * 8, 2.6);
      }
    });
  },
};

/* --- 3. constellation ---------------------------------------------------- */

const constellation: WallpaperPattern = {
  id: 'constellation',
  name: 'Constellation',
  blurb: 'Tiny gold stars over faint zodiac linework.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 6);

    // Zodiac linework: a wandering polyline whose vertices are reused as the
    // bright stars, so the figure always connects real stars.
    const nodes: Array<[number, number]> = [];
    for (let i = 0; i < 7; i++) nodes.push([rnd() * size, rnd() * size]);
    ctx.strokeStyle = cw.inkSoft;
    ctx.lineWidth = 1;
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]!;
      const b = nodes[i]!;
      // Only draw the segment if it does not straddle an edge — a straddling
      // segment cannot wrap correctly, and a broken constellation reads fine.
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > size * 0.45) continue;
      ctx.beginPath();
      ctx.setLineDash([4, 5]);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Star field: many faint dots, a few bright accent stars with rays.
    const dots = 90;
    for (let i = 0; i < dots; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 0.5 + rnd() * 1.1;
      stamp(size, x, y, 3, (cx, cy) => {
        ctx.fillStyle = cw.ink;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    for (const [x, y] of nodes) {
      stamp(size, x, y, 8, (cx, cy) => {
        ctx.strokeStyle = cw.accent;
        ctx.fillStyle = cw.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 1.7, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * 2.4, cy + Math.sin(a) * 2.4);
          ctx.lineTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6);
          ctx.stroke();
        }
      });
    }

    // Accent motif: one small orbit ring per tile.
    const ox = rnd() * size;
    const oy = rnd() * size;
    stamp(size, ox, oy, 20, (cx, cy) => {
      ctx.strokeStyle = cw.inkSoft;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 17, 7, 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = cw.accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

/* --- 4. ditsy floral ----------------------------------------------------- */

const ditsyFloral: WallpaperPattern = {
  id: 'ditsy-floral',
  name: 'Ditsy Floral',
  blurb: 'A half-drop grid of tiny five-petal flowers and leaf pairs.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;

    const cols = 4;
    const step = size / cols;
    for (let row = 0; row < cols; row++) {
      for (let col = 0; col < cols; col++) {
        const half = row % 2 === 1 ? step / 2 : 0;
        const x = col * step + half + (rnd() * 2 - 1) * 3;
        const y = row * step + step / 2 + (rnd() * 2 - 1) * 3;
        const accent = (row * cols + col) % 5 === 2;
        stamp(size, x, y, 12, (cx, cy) => {
          ctx.strokeStyle = accent ? cw.accent : cw.ink;
          flower(ctx, cx, cy, 5.4, mulberry32((seed + row * 31 + col * 7) >>> 0));
          ctx.strokeStyle = cw.inkSoft;
          leaf(ctx, cx - 1, cy + 5, -7, 6, 2.4);
          leaf(ctx, cx + 1, cy + 5, 7, 6, 2.4);
        });
      }
    }
  },
};

/* --- 5. gingham over floral ---------------------------------------------- */

const ginghamFloral: WallpaperPattern = {
  id: 'gingham-floral',
  name: 'Gingham & Ditsy',
  blurb: 'A soft check with little flowers scattered over the top.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 3);

    // Gingham: translucent bands crossed both ways. Overlaps darken naturally,
    // which is exactly how real gingham reads.
    const bands = 8;
    const bw = size / bands;
    ctx.save();
    ctx.fillStyle = cw.ink;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < bands; i += 2) {
      ctx.fillRect(i * bw, 0, bw, size);
      ctx.fillRect(0, i * bw, size, bw);
    }
    ctx.restore();

    // Woven texture: faint threads along every band.
    ctx.strokeStyle = cw.inkSoft;
    ctx.lineWidth = 0.7;
    for (let i = 0; i < bands * 3; i++) {
      const t = (i / (bands * 3)) * size;
      ctx.beginPath();
      ctx.moveTo(0, t);
      ctx.lineTo(size, t);
      ctx.stroke();
    }

    // Ditsy flowers over the check, off the grid so they do not line up.
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      stamp(size, x, y, 12, (cx, cy) => {
        ctx.strokeStyle = i % 3 === 0 ? cw.accent : cw.ink;
        flower(ctx, cx, cy, 5 + rnd() * 2, rnd);
        ctx.strokeStyle = cw.inkSoft;
        leaf(ctx, cx, cy + 5, -6, 6, 2.2);
      });
    }
  },
};

/* --- 6. rice paper & bamboo ---------------------------------------------- */

const ricePaperBamboo: WallpaperPattern = {
  id: 'rice-paper-bamboo',
  name: 'Rice Paper & Bamboo',
  blurb: 'Kozo fibres with the shadow of bamboo behind the screen.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 3);

    // Bamboo shadow: soft vertical culms with node bands — a silhouette cast
    // on the far side of the paper, so it is soft-edged and very pale.
    const culms = 2;
    for (let i = 0; i < culms; i++) {
      const x = (i + 0.35 + rnd() * 0.3) * (size / culms);
      const w = 13 + rnd() * 7;
      for (const ox of [-size, 0, size]) {
        const cx = x + ox;
        if (cx + w < 0 || cx - w > size) continue;
        const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
        g.addColorStop(0, 'rgba(0, 0, 0, 0)');
        g.addColorStop(0.5, cw.inkSoft);
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - w, 0, w * 2, size);
        // Nodes: spacing divides the tile so they wrap.
        ctx.strokeStyle = cw.inkSoft;
        ctx.lineWidth = 1.4;
        for (let n = 0; n < 3; n++) {
          const y = (n * size) / 3 + (i * size) / 7;
          ctx.beginPath();
          ctx.moveTo(cx - w * 0.8, y % size);
          ctx.lineTo(cx + w * 0.8, (y % size) - 1.5);
          ctx.stroke();
        }
      }
    }

    // A couple of leaf shadows.
    ctx.strokeStyle = cw.inkSoft;
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const a = (rnd() * 2 - 1) * 1.1;
      stamp(size, x, y, 26, (cx, cy) => {
        leaf(ctx, cx, cy, Math.cos(a) * 24, Math.sin(a) * 24, 4.5);
      });
    }

    // Kozo fibres: short pale hairs suspended in the sheet.
    for (let i = 0; i < 120; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const a = rnd() * Math.PI;
      const len = 3 + rnd() * 12;
      stamp(size, x, y, len, (cx, cy) => {
        ctx.strokeStyle = rnd() < 0.5 ? cw.ink : 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
      });
    }

    // Accent: one pale blossom, very sparse.
    stamp(size, rnd() * size, rnd() * size, 10, (cx, cy) => {
      ctx.strokeStyle = cw.accent;
      ctx.lineWidth = 1;
      flower(ctx, cx, cy, 6, rnd);
    });
  },
};

/* --- 7. lath & plaster --------------------------------------------------- */

const lathPlaster: WallpaperPattern = {
  id: 'lath-plaster',
  name: 'Lath & Plaster',
  blurb: 'Old plaster peeled back to the slats underneath.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);

    // Under-layer: horizontal laths with dark keying gaps.
    const laths = 8;
    const lh = size / laths;
    for (let i = 0; i < laths; i++) {
      const y = i * lh;
      ctx.fillStyle = i % 2 === 0 ? cw.baseAlt : cw.base;
      ctx.fillRect(0, y, size, lh - 2);
      ctx.fillStyle = 'rgba(24, 20, 16, 0.42)';
      ctx.fillRect(0, y + lh - 2, size, 2);
      // Nail heads on the laths.
      for (let n = 0; n < 2; n++) {
        const x = ((n + 0.5) * size) / 2 + (rnd() * 2 - 1) * 20;
        stamp(size, x, y + lh / 2, 3, (cx, cy) => {
          ctx.fillStyle = 'rgba(40, 34, 28, 0.5)';
          ctx.beginPath();
          ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      // Wood streaks along each lath.
      ctx.strokeStyle = 'rgba(40, 32, 24, 0.14)';
      ctx.lineWidth = 0.8;
      for (let s = 0; s < 3; s++) {
        const sy = y + 2 + rnd() * (lh - 6);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(size, sy + (rnd() * 2 - 1) * 1.5);
        ctx.stroke();
      }
    }

    // Plaster skin over most of it, torn open in a couple of places. The tear
    // shape is stamped, so the hole wraps across tile edges.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    const holes = 2;
    for (let i = 0; i < holes; i++) {
      const hx = rnd() * size;
      const hy = rnd() * size;
      const hr = size * (0.14 + rnd() * 0.12);
      stamp(size, hx, hy, hr * 1.6, (cx, cy) => {
        ctx.moveTo(cx + hr, cy);
        const pts = 11;
        for (let p = 1; p <= pts; p++) {
          const a = (p / pts) * Math.PI * 2;
          const rr = hr * (0.6 + rnd() * 0.7);
          ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8);
        }
        ctx.closePath();
      });
    }
    ctx.clip('evenodd');
    ctx.fillStyle = '#e6ded0';
    ctx.fillRect(0, 0, size, size);
    // Plaster mottling + hairline cracks.
    ctx.globalAlpha = 0.5;
    ground(ctx, size, { ...cw, base: 'rgba(0,0,0,0)', baseAlt: 'rgba(150, 142, 128, 0.5)' }, rnd, 5);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(120, 110, 96, 0.3)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 5; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const pts: Array<[number, number]> = [[x, y]];
      let px = x;
      let py = y;
      for (let s = 0; s < 5; s++) {
        px += (rnd() * 2 - 1) * 18;
        py += (rnd() * 2 - 1) * 18;
        pts.push([px, py]);
      }
      sketch(ctx, pts, rnd, 1.6);
    }
    ctx.restore();

    // Shadowed torn edge around each hole.
    ctx.strokeStyle = 'rgba(60, 52, 42, 0.3)';
    ctx.lineWidth = 1.6;
  },
};

/* --- 8. apothecary labels ------------------------------------------------ */

const apothecaryLabels: WallpaperPattern = {
  id: 'apothecary-labels',
  name: 'Apothecary Labels',
  blurb: 'Faint printed label cartouches with botanical plates.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd);
    ctx.lineCap = 'round';

    const cols = 2;
    const step = size / cols;
    for (let row = 0; row < cols; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * step + step / 2 + (rnd() * 2 - 1) * 8;
        const y = row * step + step / 2 + (rnd() * 2 - 1) * 8;
        const w = 46 + rnd() * 14;
        const h = 32 + rnd() * 10;
        const oval = (row + col) % 2 === 0;
        stamp(size, x, y, Math.max(w, h), (cx, cy) => {
          ctx.strokeStyle = cw.ink;
          ctx.lineWidth = 1.2;
          if (oval) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = cw.inkSoft;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.ellipse(cx, cy, w / 2 - 3, h / 2 - 3, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            pencil(ctx, `M ${cx - w / 2} ${cy - h / 2} L ${cx + w / 2} ${cy - h / 2} L ${cx + w / 2} ${cy + h / 2} L ${cx - w / 2} ${cy + h / 2} Z`, seed + row * 17 + col, 0.5);
            ctx.strokeStyle = cw.inkSoft;
            ctx.lineWidth = 0.8;
            ctx.strokeRect(cx - w / 2 + 3, cy - h / 2 + 3, w - 6, h - 6);
          }
          // Faux script: three ruled squiggles standing in for the name.
          ctx.strokeStyle = cw.ink;
          ctx.lineWidth = 1;
          for (let l = 0; l < 3; l++) {
            const ly = cy - h / 4 + (l * h) / 5;
            const lw = (w - 16) * (l === 0 ? 1 : 0.6 + rnd() * 0.3);
            const pts: Array<[number, number]> = [];
            for (let s = 0; s <= 6; s++) {
              pts.push([cx - lw / 2 + (lw * s) / 6, ly + (s % 2 === 0 ? -0.9 : 0.9)]);
            }
            sketch(ctx, pts, rnd, 0.5);
          }
          // Accent: a tiny botanical plate under the script on some labels.
          if ((row * cols + col) % 3 === 1) {
            ctx.strokeStyle = cw.accent;
            ctx.lineWidth = 0.9;
            const sy = cy + h / 2 - 7;
            ctx.beginPath();
            ctx.moveTo(cx, sy);
            ctx.lineTo(cx, sy - 8);
            ctx.stroke();
            leaf(ctx, cx, sy - 3, 6, -4, 2);
            leaf(ctx, cx, sy - 3, -6, -4, 2);
          }
        });
      }
    }
  },
};

/* --- 9. art nouveau vine ------------------------------------------------- */

const artNouveauVine: WallpaperPattern = {
  id: 'art-nouveau-vine',
  name: 'Art Nouveau Vine',
  blurb: 'Whiplash stems climbing the wall with stylised buds.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Vertical vines: each is periodic over the tile height (starts and ends
    // at the same x with the same tangent), so the wall climbs seamlessly.
    const vines = 3;
    for (let v = 0; v < vines; v++) {
      const x0 = (v + 0.5) * (size / vines) + (rnd() * 2 - 1) * 8;
      const sway = 16 + rnd() * 12;
      const draw = (offX: number): void => {
        ctx.strokeStyle = cw.ink;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let s = 0; s <= 48; s++) {
          const t = s / 48;
          const y = t * size;
          const x = x0 + offX + Math.sin(t * Math.PI * 2) * sway;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Buds + tendrils hung off the stem at fixed parameters.
        for (const t of [0.12, 0.38, 0.62, 0.88]) {
          const y = t * size;
          const x = x0 + offX + Math.sin(t * Math.PI * 2) * sway;
          const dir = Math.cos(t * Math.PI * 2) >= 0 ? 1 : -1;
          ctx.strokeStyle = cw.inkSoft;
          ctx.lineWidth = 1;
          // Tendril curl.
          ctx.beginPath();
          for (let s = 0; s <= 16; s++) {
            const a = (s / 16) * Math.PI * 2.2;
            const r = 9 * (1 - s / 20);
            const px = x + dir * (6 + Math.cos(a) * r);
            const py = y + Math.sin(a) * r * 0.6;
            if (s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          // Stylised bud.
          ctx.strokeStyle = cw.accent;
          ctx.lineWidth = 1.1;
          leaf(ctx, x, y, dir * 20, -12, 6);
          ctx.beginPath();
          ctx.ellipse(x + dir * 22, y - 13, 4.5, 7, dir * 0.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      };
      for (const ox of [-size, 0, size]) {
        if (x0 + ox + sway + 30 < 0 || x0 + ox - sway - 30 > size) continue;
        draw(ox);
      }
    }
  },
};

/* --- 10. marbled endpaper ------------------------------------------------ */

const marbledEndpaper: WallpaperPattern = {
  id: 'marbled-endpaper',
  name: 'Marbled Endpaper',
  blurb: 'Combed bookbinder marble in two tones.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 4);

    // Combed bands: each band's wave uses an integer number of cycles across
    // the tile, so left and right edges match exactly.
    const bands = 9;
    for (let i = 0; i < bands; i++) {
      const y0 = (i * size) / bands;
      const cycles = 1 + (i % 3);
      const amp = 5 + rnd() * 9;
      const thick = size / bands;
      const phase = rnd() * Math.PI * 2;
      const colour = i % 3 === 1 ? cw.accent : i % 3 === 0 ? cw.ink : cw.inkSoft;
      ctx.fillStyle = colour;
      ctx.beginPath();
      for (let s = 0; s <= 64; s++) {
        const x = (s / 64) * size;
        const y = y0 + Math.sin((s / 64) * Math.PI * 2 * cycles + phase) * amp;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let s = 64; s >= 0; s--) {
        const x = (s / 64) * size;
        const y =
          y0 + thick * 0.42 + Math.sin((s / 64) * Math.PI * 2 * cycles + phase + 0.6) * amp;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Comb teeth: fine vertical drags pulling the bands into peaks.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 0.8;
    const teeth = 16;
    for (let i = 0; i < teeth; i++) {
      const x = (i * size) / teeth;
      ctx.beginPath();
      for (let s = 0; s <= 24; s++) {
        const y = (s / 24) * size;
        ctx.lineTo(x + Math.sin((s / 24) * Math.PI * 4) * 3, y);
      }
      ctx.stroke();
    }

    // Accent: a few Stormont vein droplets.
    for (let i = 0; i < 6; i++) {
      stamp(size, rnd() * size, rnd() * size, 8, (cx, cy) => {
        ctx.strokeStyle = cw.ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 6, 3, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
  },
};

/* --- 11. pin dot --------------------------------------------------------- */

const pinDot: WallpaperPattern = {
  id: 'pin-dot',
  name: 'Pin Dot',
  blurb: 'The quietest wall in the house: a fine dotted grid.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 4);
    const cols = 16;
    const step = size / cols;
    for (let row = 0; row < cols; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * step + step / 2 + (row % 2 ? step / 2 : 0);
        const y = row * step + step / 2;
        const accent = (row * 5 + col * 3) % 17 === 0;
        stamp(size, x % size, y, 5, (cx, cy) => {
          if (accent) {
            ctx.strokeStyle = cw.accent;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.fillStyle = cw.ink;
          ctx.beginPath();
          ctx.arc(cx, cy, 1.15, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
  },
};

/* --- 12. plain limewash -------------------------------------------------- */

const plainLimewash: WallpaperPattern = {
  id: 'plain-limewash',
  name: 'Plain Limewash',
  blurb: 'Trowelled lime plaster — texture instead of pattern.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 7);

    // Trowel sweeps: broad soft arcs with a bright leading edge, the way a
    // float leaves lime plaster.
    for (let i = 0; i < 22; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 24 + rnd() * 46;
      const a0 = rnd() * Math.PI * 2;
      const span = 0.7 + rnd() * 1.1;
      stamp(size, x, y, r + 6, (cx, cy) => {
        ctx.strokeStyle = rnd() < 0.5 ? 'rgba(255, 255, 250, 0.1)' : cw.inkSoft;
        ctx.lineWidth = 3 + rnd() * 7;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a0 + span);
        ctx.stroke();
      });
    }

    // Pinholes and aggregate specks.
    for (let i = 0; i < 200; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      stamp(size, x, y, 2, (cx, cy) => {
        ctx.fillStyle = rnd() < 0.6 ? cw.inkSoft : 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(cx, cy, 0.4 + rnd() * 0.9, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Accent: one hairline settlement crack per tile.
    const cx0 = rnd() * size;
    ctx.strokeStyle = cw.ink;
    ctx.lineWidth = 0.9;
    const pts: Array<[number, number]> = [];
    for (let s = 0; s <= 8; s++) pts.push([cx0 + (rnd() * 2 - 1) * 12, (s / 8) * size]);
    sketch(ctx, pts, rnd, 2);
  },
};

/* =============================== registry ================================ */

export const WALLPAPER_PATTERNS: Readonly<Record<WallpaperPatternId, WallpaperPattern>> = {
  damask,
  'botanical-toile': botanicalToile,
  constellation,
  'ditsy-floral': ditsyFloral,
  'gingham-floral': ginghamFloral,
  'rice-paper-bamboo': ricePaperBamboo,
  'lath-plaster': lathPlaster,
  'apothecary-labels': apothecaryLabels,
  'art-nouveau-vine': artNouveauVine,
  'marbled-endpaper': marbledEndpaper,
  'pin-dot': pinDot,
  'plain-limewash': plainLimewash,
};

/** All twelve patterns in studio-picker order. */
export function allWallpaperPatterns(): readonly WallpaperPattern[] {
  return WALLPAPER_PATTERN_IDS.map((id) => WALLPAPER_PATTERNS[id]);
}

/**
 * Paint one seamless wallpaper tile at the current origin.
 * `size` is the tile edge in world px; the tile is opaque (it carries the
 * colourway's base) so it can be drawn straight onto the wall.
 */
export function renderWallpaper(
  ctx: Ctx2D,
  pattern: WallpaperPatternId,
  size: number,
  colourway: ColourwayId | Colourway,
  seed: number,
): void {
  const cw = getColourway(colourway);
  const p = WALLPAPER_PATTERNS[pattern] ?? WALLPAPER_PATTERNS['pin-dot'];
  ctx.save();
  // Clip so stamped neighbours cannot bleed outside the tile.
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  p.render(ctx, size, cw, seed);
  ctx.restore();
}

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Bake (or fetch from cache) one wallpaper tile as an ImageBitmap.
 * Returned bitmaps are shared — never close() them.
 */
export function bakeWallpaper(
  pattern: WallpaperPatternId,
  colourway: ColourwayId,
  size: number,
  dpr: number,
  seed = 0x5eed,
): Promise<ImageBitmap> {
  return bakeCached(
    `theme${THEME_RECIPE_VERSION}|wall|${pattern}|${colourway}|${size}|${seed}`,
    dpr,
    async () => {
      const dev = Math.ceil(size * dpr);
      const canvas = makeCanvas(dev, dev) as OffscreenCanvas;
      const ctx = canvas.getContext('2d') as Ctx2D | null;
      if (!ctx) throw new Error('wallpaper: 2d context unavailable');
      ctx.scale(dpr, dpr);
      renderWallpaper(ctx, pattern, size, colourway, seed);
      return canvas;
    },
  );
}

/**
 * Fill an arbitrary rect with a wallpaper by tiling the pattern. Convenience
 * for specimen boards and the studio's preview cards; the shelf should draw
 * the baked bitmap through a Pixi TilingSprite instead.
 */
export function tileWallpaper(
  ctx: Ctx2D,
  tile: CanvasImageSource,
  tileSize: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let ty = y; ty < y + h; ty += tileSize) {
    for (let tx = x; tx < x + w; tx += tileSize) {
      ctx.drawImage(tile, tx, ty, tileSize, tileSize);
    }
  }
  ctx.restore();
}
