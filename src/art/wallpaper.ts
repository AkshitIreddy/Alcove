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
  /* --- v3: the saturated six ------------------------------------------- */
  blossom: {
    id: 'blossom',
    name: 'Blossom Sky',
    base: '#8ed4f7',
    baseAlt: '#a8e2fa',
    ink: 'rgba(46, 116, 82, 0.17)',
    inkSoft: 'rgba(46, 116, 82, 0.1)',
    accent: 'rgba(255, 118, 168, 0.38)',
  },
  chrome: {
    id: 'chrome',
    name: 'Workshop Chrome',
    base: '#243444',
    baseAlt: '#2d4054',
    ink: 'rgba(110, 232, 255, 0.17)',
    inkSoft: 'rgba(110, 232, 255, 0.1)',
    accent: 'rgba(255, 82, 202, 0.38)',
  },
  jungle: {
    id: 'jungle',
    name: 'Volcano Jungle',
    base: '#c2561c',
    baseAlt: '#ad4718',
    ink: 'rgba(24, 74, 36, 0.18)',
    inkSoft: 'rgba(24, 74, 36, 0.1)',
    accent: 'rgba(86, 208, 118, 0.38)',
  },
  bubblegum: {
    id: 'bubblegum',
    name: 'Bubblegum',
    base: '#ffd4e6',
    baseAlt: '#ffc2dc',
    ink: 'rgba(214, 63, 140, 0.16)',
    inkSoft: 'rgba(214, 63, 140, 0.09)',
    accent: 'rgba(52, 208, 172, 0.4)',
  },
  lagoon: {
    id: 'lagoon',
    name: 'Lagoon',
    base: '#0f6e91',
    baseAlt: '#12809f',
    ink: 'rgba(178, 246, 255, 0.16)',
    inkSoft: 'rgba(178, 246, 255, 0.09)',
    accent: 'rgba(255, 132, 104, 0.4)',
  },
  nebula: {
    id: 'nebula',
    name: 'Nebula',
    base: '#1a1046',
    baseAlt: '#241458',
    ink: 'rgba(150, 200, 255, 0.16)',
    inkSoft: 'rgba(150, 200, 255, 0.09)',
    accent: 'rgba(255, 92, 214, 0.4)',
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
/**
 * A fully transparent version of `colour`.
 *
 * Canvas interpolates gradient stops in *un-premultiplied* RGBA, so a stop
 * pair of `#e3dccb → rgba(0,0,0,0)` passes through half-alpha dark grey and
 * paints a visible dark halo. Every soft-edged wash in this module must fade
 * to its own colour at zero alpha instead.
 */
function fade(colour: string): string {
  const rgb = /^\s*rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(colour);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, 0)`;
  const s = colour.replace('#', '').trim();
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 'rgba(0, 0, 0, 0)';
  const n = Number.parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0)`;
}

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
      g.addColorStop(1, fade(cw.baseAlt));
      ctx.save();
      // Deliberately weak: the ground is a whisper of unevenness in the paper,
      // never a visible blob. Anything stronger reads as a dirty photograph
      // and swallows the linework that carries the pattern.
      ctx.globalAlpha = 0.16;
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

    // Toile is a *dense* print — a herbarium sheet, not three lonely stems.
    // Half-drop jitter over a 4x4 lattice keeps coverage even without a
    // readable grid, and the stamp() call makes every sprig wrap.
    const cols = 4;
    const step = size / cols;
    let i = 0;
    for (let row = 0; row < cols; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * step + (row % 2 ? step * 0.5 : 0) + rnd() * step * 0.8;
        const y = row * step + rnd() * step * 0.8;
        const rot = (rnd() * 2 - 1) * 0.9;
        const len = 30 + rnd() * 26;
        stamp(size, x % size, y % size, len, (cx, cy) => sprig(cx, cy, rot, len, i % 3));
        i++;
      }
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
    // Two small figures per tile rather than one long wander, each drawn as a
    // continuous faint rule — real chart linework, not a dashed scribble.
    const nodes: Array<[number, number]> = [];
    for (let f = 0; f < 2; f++) {
      const ox = rnd() * size;
      const oy = rnd() * size;
      const fig: Array<[number, number]> = [];
      for (let i = 0; i < 5; i++) {
        fig.push([ox + (rnd() * 2 - 1) * size * 0.17, oy + (rnd() * 2 - 1) * size * 0.17]);
      }
      ctx.strokeStyle = cw.inkSoft;
      ctx.lineWidth = 0.9;
      for (let i = 1; i < fig.length; i++) {
        const a = fig[i - 1]!;
        const b = fig[i]!;
        stamp(size, 0, 0, size * 2, (ox2, oy2) => {
          ctx.beginPath();
          ctx.moveTo(a[0] + ox2, a[1] + oy2);
          ctx.lineTo(b[0] + ox2, b[1] + oy2);
          ctx.stroke();
        });
      }
      // The figure's own name, sketched as an unreadable ruled squiggle.
      ctx.strokeStyle = cw.inkSoft;
      ctx.lineWidth = 0.7;
      stamp(size, ox, oy + size * 0.2, 40, (cx, cy) => {
        const pts: Array<[number, number]> = [];
        for (let s = 0; s <= 8; s++) pts.push([cx - 18 + s * 4.5, cy + (s % 2 ? -1.2 : 1.2)]);
        sketch(ctx, pts, rnd, 0.4);
      });
      nodes.push(...fig);
    }

    // Star field: many faint dots, a few bright accent stars with rays.
    const dots = 150;
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
    // Bright stars sit ON the figure's vertices: a four-point gold twinkle,
    // small and sharp rather than a drawn X.
    for (const [x, y] of nodes) {
      stamp(size, x, y, 8, (cx, cy) => {
        ctx.fillStyle = cw.accent;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 === 0 ? 5.2 : 1.1;
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
        ctx.fill();
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

    // Half-drop lattice with generous jitter and mixed sizes — a printed
    // ditsy never lines up in visible columns, and a strict grid is the
    // single fastest way to make a wall look machine-made.
    const cols = 4;
    const step = size / cols;
    for (let row = 0; row < cols; row++) {
      for (let col = 0; col < cols; col++) {
        const half = row % 2 === 1 ? step / 2 : 0;
        const x = col * step + half + (rnd() * 2 - 1) * step * 0.3;
        const y = row * step + step / 2 + (rnd() * 2 - 1) * step * 0.3;
        const accent = (row * cols + col) % 5 === 2;
        const r = 4.2 + rnd() * 3;
        const tilt = rnd() * Math.PI;
        stamp(size, ((x % size) + size) % size, ((y % size) + size) % size, 14, (cx, cy) => {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(tilt);
          ctx.strokeStyle = accent ? cw.accent : cw.ink;
          flower(ctx, 0, 0, r, mulberry32((seed + row * 31 + col * 7) >>> 0));
          // A soft wash in the flower's throat gives it a centre of gravity.
          ctx.fillStyle = accent ? cw.accent : cw.inkSoft;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = cw.inkSoft;
          leaf(ctx, -1, r, -r * 1.3, r * 1.1, 2.4);
          leaf(ctx, 1, r, r * 1.3, r * 1.1, 2.4);
          ctx.restore();
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
      const x = (i + 0.28 + rnd() * 0.44) * (size / culms);
      const w = 15 + rnd() * 8;
      for (const ox of [-size, 0, size]) {
        const cx = x + ox;
        if (cx + w < 0 || cx - w > size) continue;
        // The culm is a *shadow*: soft either side, definite in the middle.
        // Three passes — the alphas in a colourway are low by design, so a
        // single fill of `ink` disappears at wall scale.
        const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
        g.addColorStop(0, 'rgba(0, 0, 0, 0)');
        g.addColorStop(0.22, cw.inkSoft);
        g.addColorStop(0.5, cw.ink);
        g.addColorStop(0.78, cw.inkSoft);
        g.addColorStop(1, fade(cw.inkSoft));
        for (let pass = 0; pass < 3; pass++) {
          ctx.fillStyle = g;
          ctx.fillRect(cx - w, 0, w * 2, size);
        }
        // Definite edges: the culm has a shape, not just a smudge.
        ctx.fillStyle = cw.ink;
        ctx.fillRect(cx - w * 0.62, 0, 1.2, size);
        ctx.fillRect(cx + w * 0.62, 0, 1.2, size);
        // Nodes: a dark collar with a pale gap above it, spacing divides the
        // tile so they wrap. One side shoot springs from every other node.
        for (let n = 0; n < 3; n++) {
          const y = ((n * size) / 3 + (i * size) / 7) % size;
          ctx.fillStyle = cw.ink;
          ctx.fillRect(cx - w * 0.8, y, w * 1.6, 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.fillRect(cx - w * 0.8, y - 2.4, w * 1.6, 1.4);
          if (n % 2 === 0) {
            ctx.strokeStyle = cw.inkSoft;
            ctx.lineWidth = 1.6;
            const dir = i % 2 === 0 ? 1 : -1;
            ctx.beginPath();
            ctx.moveTo(cx + dir * w * 0.7, y + 1);
            ctx.quadraticCurveTo(cx + dir * (w + 20), y - 10, cx + dir * (w + 38), y - 30);
            ctx.stroke();
          }
        }
      }
    }

    // Leaf shadows hanging off the culms: long lance-shaped bamboo leaves in
    // twos and threes, not a random scatter of ticks.
    for (let i = 0; i < 4; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      // Bamboo leaves hang: always sweeping downward from their node.
      const a = Math.PI * 0.28 + (rnd() * 2 - 1) * 0.4;
      const flip = rnd() < 0.5 ? -1 : 1;
      stamp(size, x, y, 52, (cx, cy) => {
        for (let k = 0; k < 3; k++) {
          const aa = a + k * 0.22;
          const len = 34 - k * 4;
          ctx.strokeStyle = k === 0 ? cw.ink : cw.inkSoft;
          ctx.lineWidth = 1.3;
          leaf(ctx, cx, cy, flip * Math.cos(aa) * len, Math.sin(aa) * len, 4.4);
        }
        // The twig they hang from.
        ctx.strokeStyle = cw.inkSoft;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - flip * 14, cy - 8);
        ctx.lineTo(cx, cy);
        ctx.stroke();
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

    // Under-layer: horizontal riven laths on an opaque ground. The ground
    // matters — without it the exposed lath composites over nothing and the
    // tear reads as a black hole punched in the wall.
    ctx.fillStyle = cw.baseAlt;
    ctx.fillRect(0, 0, size, size);
    const laths = 9;
    const lh = size / laths;
    const lathLight = 'rgba(168, 140, 104, 0.55)';
    const lathDark = 'rgba(124, 100, 72, 0.55)';
    for (let i = 0; i < laths; i++) {
      const y = i * lh;
      ctx.fillStyle = i % 2 === 0 ? lathLight : lathDark;
      ctx.fillRect(0, y, size, lh - 2.5);
      // Keying gap: plaster squeezed through between the laths, in shadow.
      ctx.fillStyle = 'rgba(40, 32, 24, 0.34)';
      ctx.fillRect(0, y + lh - 2.5, size, 2.5);
      // Split grain along each lath.
      ctx.strokeStyle = 'rgba(60, 46, 32, 0.22)';
      ctx.lineWidth = 0.8;
      for (let s = 0; s < 3; s++) {
        const sy = y + 2 + rnd() * (lh - 6);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(size, sy + (rnd() * 2 - 1) * 1.5);
        ctx.stroke();
      }
      // Nail heads, two per lath.
      for (let n = 0; n < 2; n++) {
        const x = ((n + 0.5) * size) / 2 + (rnd() * 2 - 1) * 22;
        stamp(size, x, y + lh / 2, 3, (cx, cy) => {
          ctx.fillStyle = 'rgba(52, 42, 32, 0.55)';
          ctx.beginPath();
          ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    // One big torn opening per tile (stamped, so it wraps), with a feathered
    // crumbling rim rather than a cut-out edge.
    const hx = rnd() * size;
    const hy = rnd() * size;
    const hr = size * 0.2;
    const holePath = (cx: number, cy: number, scale: number): void => {
      const pts = 13;
      const lobe = mulberry32((seed ^ 0x7ea2) >>> 0);
      ctx.moveTo(cx + hr * scale, cy);
      for (let p = 1; p <= pts; p++) {
        const a = (p / pts) * Math.PI * 2;
        const rr = hr * scale * (0.62 + lobe() * 0.62);
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.82);
      }
      ctx.closePath();
    };

    // Plaster skin everywhere EXCEPT the hole.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    stamp(size, hx, hy, hr * 2, (cx, cy) => holePath(cx, cy, 1));
    ctx.clip('evenodd');
    ctx.fillStyle = cw.base;
    ctx.fillRect(0, 0, size, size);
    ground(ctx, size, cw, rnd, 5);
    // Hairline crazing across the skin.
    ctx.strokeStyle = cw.ink;
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const pts: Array<[number, number]> = [[x, y]];
      let px = x;
      let py = y;
      for (let s = 0; s < 5; s++) {
        px += (rnd() * 2 - 1) * 20;
        py += (rnd() * 2 - 1) * 20;
        pts.push([px, py]);
      }
      sketch(ctx, pts, rnd, 1.6);
    }
    // Crumbling inner rim: a soft dark feather just inside the plaster edge.
    ctx.save();
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(56, 46, 34, 0.26)';
    ctx.beginPath();
    stamp(size, hx, hy, hr * 2, (cx, cy) => holePath(cx, cy, 1));
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 252, 244, 0.3)';
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // Shadow the plaster casts down into the opening.
    ctx.save();
    ctx.beginPath();
    stamp(size, hx, hy, hr * 2, (cx, cy) => holePath(cx, cy, 1));
    ctx.clip();
    const sg = ctx.createLinearGradient(0, hy - hr, 0, hy + hr);
    sg.addColorStop(0, 'rgba(30, 24, 16, 0.3)');
    sg.addColorStop(0.55, 'rgba(30, 24, 16, 0.05)');
    sg.addColorStop(1, 'rgba(30, 24, 16, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // Loose flakes of plaster still clinging around the tear.
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      const d = hr * (1.05 + rnd() * 0.35);
      stamp(size, hx + Math.cos(a) * d, hy + Math.sin(a) * d * 0.85, 8, (cx, cy) => {
        ctx.fillStyle = cw.baseAlt;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 2 + rnd() * 4, 1.5 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }
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
        // Whiplash stem: swelling from hairline at the top to a full stroke at
        // the waist, drawn as three overlaid passes so it reads at any zoom.
        for (const [width, style] of [
          [3.4, cw.inkSoft],
          [1.8, cw.ink],
          [0.9, cw.ink],
        ] as const) {
          ctx.strokeStyle = style;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (let s = 0; s <= 48; s++) {
            const t = s / 48;
            const y = t * size;
            const x = x0 + offX + Math.sin(t * Math.PI * 2) * sway;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
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
          // Stylised bud on a stalk, with a filled heart so the motif has
          // some weight against the stem.
          ctx.strokeStyle = cw.accent;
          ctx.lineWidth = 1.4;
          leaf(ctx, x, y, dir * 20, -12, 6);
          ctx.beginPath();
          ctx.ellipse(x + dir * 22, y - 13, 4.8, 7.4, dir * 0.6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = cw.accent;
          ctx.beginPath();
          ctx.ellipse(x + dir * 22, y - 13, 2.4, 3.8, dir * 0.6, 0, Math.PI * 2);
          ctx.fill();
          // A second leaf falling the other way keeps the vine from reading
          // as a comb of identical hooks.
          ctx.strokeStyle = cw.ink;
          ctx.lineWidth = 1.2;
          leaf(ctx, x, y, -dir * 14, 11, 5);
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
    // the tile, so left and right edges match exactly. Held well back in
    // alpha — marble this size would otherwise shout over the books.
    ctx.save();
    ctx.globalAlpha = 0.34;
    const bands = 20;
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
    ctx.restore();

    // Comb teeth: fine vertical drags pulling the bands into peaks.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 0.8;
    const teeth = 26;
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

/* --- 13. blossom sky ----------------------------------------------------- */

const blossomSky: WallpaperPattern = {
  id: 'blossom-sky',
  name: 'Blossom Sky',
  blurb: 'Cherry branches and drifting petals across an open spring sky.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 6);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Soft cloud banks: very pale blooms sitting low in the tile.
    for (let i = 0; i < 3; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = size * (0.16 + rnd() * 0.12);
      stamp(size, x, y, r, (cx, cy) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      });
    }

    // Two blossom branches crossing the tile — each is periodic in x, so the
    // branch continues straight into the next tile.
    for (const b of [0, 1]) {
      const y0 = size * (b ? 0.66 : 0.24);
      const amp = size * 0.06;
      ctx.strokeStyle = 'rgba(96, 62, 40, 0.34)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let s = 0; s <= 24; s++) {
        const t = s / 24;
        const x = t * size;
        const y = y0 + Math.sin(t * Math.PI * 2 + b * 1.7) * amp;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Twigs, leaves and blossom heads along the branch.
      const heads = 7;
      for (let i = 0; i < heads; i++) {
        const t = (i + 0.5) / heads;
        const x = t * size;
        const y = y0 + Math.sin(t * Math.PI * 2 + b * 1.7) * amp;
        const up = i % 2 === 0 ? -1 : 1;
        const tx = x + (rnd() * 2 - 1) * 6;
        const ty = y + up * (9 + rnd() * 9);
        ctx.strokeStyle = 'rgba(96, 62, 40, 0.26)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo((x + tx) / 2 + up * 3, (y + ty) / 2, tx, ty);
        ctx.stroke();
        // Blossom: five soft petals plus a stamen dot.
        stamp(size, tx, ty, 12, (cx, cy) => {
          ctx.fillStyle = cw.accent;
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2 + i;
            ctx.beginPath();
            ctx.ellipse(cx + Math.cos(a) * 3.6, cy + Math.sin(a) * 3.6, 3.4, 2.4, a, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = 'rgba(255, 230, 120, 0.5)';
          ctx.beginPath();
          ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        });
        // A green leaf on the opposite side.
        ctx.strokeStyle = cw.ink;
        ctx.lineWidth = 1.2;
        leaf(ctx, x, y, -up * 7, -up * 5, 3.4);
      }
    }

    // Loose petals falling between the branches.
    for (let i = 0; i < 14; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      stamp(size, x, y, 6, (cx, cy) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rnd() * Math.PI);
        ctx.fillStyle = cw.accent;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.ellipse(0, 0, 2.8, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }
  },
};

/* --- 14. circuit trace --------------------------------------------------- */

const circuitTrace: WallpaperPattern = {
  id: 'circuit-trace',
  name: 'Circuit Trace',
  blurb: 'Etched PCB routes, solder pads and the odd lit via.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 4);
    ctx.lineCap = 'square';
    ctx.lineJoin = 'round';
    const cells = 8;
    const step = size / cells;

    // Traces: staircase routes that always start and end on the tile grid, so
    // every run continues into the neighbouring tile.
    for (let i = 0; i < cells; i++) {
      const horizontal = i % 2 === 0;
      const lane = (i + 0.5) * step;
      ctx.strokeStyle = cw.ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let a = 0;
      let b = lane;
      ctx.moveTo(horizontal ? a : b, horizontal ? b : a);
      while (a < size) {
        const run = step * (1 + Math.floor(rnd() * 2));
        const jog = (rnd() < 0.5 ? -1 : 1) * step * 0.5;
        const na = Math.min(size, a + run);
        ctx.lineTo(horizontal ? na : b, horizontal ? b : na);
        if (na < size) {
          const nb = b + jog;
          // 45° corner, the way a router breaks a right angle.
          ctx.lineTo(horizontal ? na + step * 0.25 : nb, horizontal ? nb : na + step * 0.25);
          b = nb;
          a = na + step * 0.25;
        } else a = na;
      }
      ctx.stroke();
    }

    // Solder pads on the grid, with a drilled hole in the middle.
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        if ((gx * 3 + gy * 5) % 4 !== 0) continue;
        const x = (gx + 0.5) * step;
        const y = (gy + 0.5) * step;
        const lit = (gx + gy) % 7 === 0;
        stamp(size, x, y, 8, (cx, cy) => {
          ctx.fillStyle = lit ? cw.accent : cw.ink;
          ctx.beginPath();
          ctx.arc(cx, cy, lit ? 3.4 : 2.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = cw.base;
          ctx.beginPath();
          ctx.arc(cx, cy, 1.2, 0, Math.PI * 2);
          ctx.fill();
          if (lit) {
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 9);
            g.addColorStop(0, cw.accent);
            g.addColorStop(1, fade(cw.accent));
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = g;
            ctx.fillRect(cx - 9, cy - 9, 18, 18);
            ctx.globalAlpha = 1;
          }
        });
      }
    }

    // One little chip outline per tile: the accent motif.
    const chipX = rnd() * size;
    const chipY = rnd() * size;
    stamp(size, chipX, chipY, 26, (cx, cy) => {
      ctx.strokeStyle = cw.ink;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(cx - 13, cy - 9, 26, 18);
      ctx.lineWidth = 1.1;
      for (let p = 0; p < 4; p++) {
        const py = cy - 6 + p * 4;
        ctx.beginPath();
        ctx.moveTo(cx - 18, py);
        ctx.lineTo(cx - 13, py);
        ctx.moveTo(cx + 13, py);
        ctx.lineTo(cx + 18, py);
        ctx.stroke();
      }
      ctx.fillStyle = cw.inkSoft;
      ctx.beginPath();
      ctx.arc(cx - 9, cy - 5, 1.6, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

/* --- 15. fern & footprint ------------------------------------------------ */

const fernFootprint: WallpaperPattern = {
  id: 'fern-footprint',
  name: 'Fern & Footprint',
  blurb: 'Jungle fern silhouettes with three-toed tracks wandering through.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 6);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Fern fronds: a spine with pinnae stepping down both sides.
    for (let i = 0; i < 5; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const len = 34 + rnd() * 30;
      const ang = -Math.PI / 2 + (rnd() * 2 - 1) * 1.1;
      stamp(size, x, y, len + 14, (cx, cy) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.strokeStyle = cw.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(len * 0.3, -len * 0.24, len, -len * 0.16);
        ctx.stroke();
        const pinnae = 11;
        for (let p = 1; p <= pinnae; p++) {
          const t = p / (pinnae + 1);
          const px = t * len;
          const py = -t * len * 0.2 - Math.sin(t * Math.PI) * 2;
          const plen = (1 - t) * 13 + 4;
          ctx.lineWidth = 1.2;
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.quadraticCurveTo(px + plen * 0.5, py + side * plen * 0.7, px + plen * 0.7, py + side * plen);
            ctx.stroke();
          }
        }
        ctx.restore();
      });
    }

    // A trail of three-toed footprints crossing the tile diagonally.
    const prints = 5;
    for (let i = 0; i < prints; i++) {
      const t = (i + 0.4) / prints;
      const x = t * size;
      const y = ((t * size * 0.7) % size);
      const side = i % 2 === 0 ? -1 : 1;
      stamp(size, x + side * 7, y, 16, (cx, cy) => {
        ctx.fillStyle = cw.accent;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(0.6 + side * 0.2);
        // Heel pad plus three splayed toes.
        ctx.beginPath();
        ctx.ellipse(0, 4, 5.4, 4.4, 0, 0, Math.PI * 2);
        ctx.fill();
        for (const a of [-0.8, 0, 0.8]) {
          ctx.beginPath();
          ctx.ellipse(Math.sin(a) * 6.4, -4 - Math.cos(a) * 2.4, 2.4, 4.2, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    // Accent motif: one amber drop with a trapped speck.
    const ax = rnd() * size;
    const ay = rnd() * size;
    stamp(size, ax, ay, 14, (cx, cy) => {
      const g = ctx.createRadialGradient(cx - 2, cy - 3, 1, cx, cy, 9);
      g.addColorStop(0, 'rgba(255, 214, 122, 0.45)');
      g.addColorStop(1, 'rgba(255, 176, 60, 0.14)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 8, 10, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = cw.inkSoft;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  },
};

/* --- 16. peppermint stripe ----------------------------------------------- */

const peppermintStripe: WallpaperPattern = {
  id: 'peppermint-stripe',
  name: 'Peppermint Stripe',
  blurb: 'Diagonal sugar stripes with dots and sprinkles between them.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 4);

    // 45° stripes: drawn as a doubled run so the diagonal wraps at both edges.
    const bands = 8;
    const pitch = size / bands;
    ctx.save();
    ctx.lineCap = 'butt';
    for (let i = -bands; i < bands * 2; i++) {
      const off = i * pitch;
      ctx.strokeStyle = i % 2 === 0 ? cw.ink : cw.accent;
      ctx.lineWidth = i % 2 === 0 ? pitch * 0.42 : pitch * 0.2;
      ctx.beginPath();
      ctx.moveTo(off, -2);
      ctx.lineTo(off + size + 2, size + 2);
      ctx.stroke();
      // A thin sugar highlight riding the leading edge of each wide stripe.
      if (i % 2 === 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(off - pitch * 0.2, -2);
        ctx.lineTo(off + size - pitch * 0.2, size + 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Sprinkles: little rounded bars at jittered angles.
    for (let i = 0; i < 26; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      stamp(size, x, y, 8, (cx, cy) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rnd() * Math.PI);
        ctx.strokeStyle = rnd() < 0.5 ? 'rgba(255, 255, 255, 0.34)' : cw.accent;
        ctx.lineCap = 'round';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-3, 0);
        ctx.lineTo(3, 0);
        ctx.stroke();
        ctx.restore();
      });
    }

    // Accent motif: one wrapped mint per tile.
    const mx = rnd() * size;
    const my = rnd() * size;
    stamp(size, mx, my, 18, (cx, cy) => {
      ctx.strokeStyle = cw.ink;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
      ctx.stroke();
      for (let s = 0; s < 6; s++) {
        const a = (s / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * 7.5, cy + Math.sin(a) * 7.5);
        ctx.stroke();
      }
      // Wrapper twists either side.
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + dir * 7.5, cy);
        ctx.lineTo(cx + dir * 14, cy - 4);
        ctx.lineTo(cx + dir * 14, cy + 4);
        ctx.closePath();
        ctx.stroke();
      }
    });
  },
};

/* --- 17. reef bubbles ---------------------------------------------------- */

const reefBubble: WallpaperPattern = {
  id: 'reef-bubble',
  name: 'Reef & Bubbles',
  blurb: 'Kelp ribbons, coral fans and columns of rising bubbles.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 6);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Kelp: full-height ribbons, periodic in y so they run floor to ceiling.
    for (let i = 0; i < 4; i++) {
      const x0 = rnd() * size;
      const waves = 2;
      const amp = 9 + rnd() * 10;
      stamp(size, x0, size / 2, amp + 20, (cx) => {
        ctx.strokeStyle = cw.ink;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let s = 0; s <= 32; s++) {
          const t = s / 32;
          const x = cx + Math.sin(t * Math.PI * 2 * waves) * amp;
          const y = t * size;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Blades stepping off the stipe.
        ctx.lineWidth = 1.3;
        for (let s = 1; s < 10; s++) {
          const t = s / 10;
          const x = cx + Math.sin(t * Math.PI * 2 * waves) * amp;
          const y = t * size;
          const side = s % 2 === 0 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + side * 12, y + 3, x + side * 15, y + 12);
          ctx.stroke();
        }
      });
    }

    // Coral fans in the accent colour.
    for (let i = 0; i < 3; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      stamp(size, x, y, 24, (cx, cy) => {
        ctx.strokeStyle = cw.accent;
        ctx.lineWidth = 1.8;
        for (let b = 0; b < 6; b++) {
          const a = -Math.PI / 2 + (b - 2.5) * 0.3;
          const len = 12 + rnd() * 8;
          ctx.beginPath();
          ctx.moveTo(cx, cy + 6);
          ctx.quadraticCurveTo(
            cx + Math.cos(a) * len * 0.5,
            cy + 6 + Math.sin(a) * len * 0.6,
            cx + Math.cos(a) * len,
            cy + 6 + Math.sin(a) * len,
          );
          ctx.stroke();
          // Polyp tip.
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * len, cy + 6 + Math.sin(a) * len, 1.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // Bubbles: rings with a catchlight, in loose rising columns.
    for (let c = 0; c < 5; c++) {
      const bx = rnd() * size;
      const count = 4 + Math.floor(rnd() * 4);
      for (let i = 0; i < count; i++) {
        const x = bx + (rnd() * 2 - 1) * 9;
        const y = rnd() * size;
        const r = 1.8 + rnd() * 4;
        stamp(size, x, y, r + 3, (cx, cy) => {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.beginPath();
          ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
  },
};

/* --- 18. nebula ---------------------------------------------------------- */

const nebula: WallpaperPattern = {
  id: 'nebula',
  name: 'Nebula',
  blurb: 'Glowing gas clouds, neon constellations and a comet or two.',
  render(ctx, size, cw, seed) {
    const rnd = mulberry32(seed >>> 0);
    ground(ctx, size, cw, rnd, 4);

    // Nebula clouds: two coloured blooms, stamped so they wrap.
    for (let i = 0; i < 4; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = size * (0.2 + rnd() * 0.2);
      const tint = i % 2 === 0 ? cw.accent : 'rgba(90, 190, 255, 0.34)';
      stamp(size, x, y, r, (cx, cy) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, tint);
        g.addColorStop(1, fade(tint));
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
      });
    }

    // Star field: a lot of tiny ones, a few four-point flares.
    for (let i = 0; i < 150; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const big = rnd() < 0.09;
      stamp(size, x, y, big ? 7 : 2, (cx, cy) => {
        if (big) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx - 4.5, cy);
          ctx.lineTo(cx + 4.5, cy);
          ctx.moveTo(cx, cy - 4.5);
          ctx.lineTo(cx, cy + 4.5);
          ctx.stroke();
        }
        ctx.fillStyle = rnd() < 0.2 ? cw.accent : 'rgba(255, 255, 255, 0.55)';
        ctx.beginPath();
        ctx.arc(cx, cy, big ? 1.6 : 0.5 + rnd() * 0.8, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // One constellation per tile: joined stars with hairline rule lines.
    const nodes: Array<[number, number]> = [];
    const ox = rnd() * size;
    const oy = rnd() * size;
    for (let i = 0; i < 5; i++) nodes.push([ox + (rnd() * 2 - 1) * 40, oy + (rnd() * 2 - 1) * 40]);
    stamp(size, ox, oy, 60, (cx, cy) => {
      ctx.save();
      ctx.translate(cx - ox, cy - oy);
      ctx.strokeStyle = cw.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      nodes.forEach(([nx, ny], i) => (i === 0 ? ctx.moveTo(nx, ny) : ctx.lineTo(nx, ny)));
      ctx.stroke();
      for (const [nx, ny] of nodes) {
        ctx.fillStyle = cw.accent;
        ctx.beginPath();
        ctx.arc(nx, ny, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // A comet: a bright head with a tapering trail.
    const kx = rnd() * size;
    const ky = rnd() * size;
    stamp(size, kx, ky, 46, (cx, cy) => {
      const g = ctx.createLinearGradient(cx, cy, cx - 40, cy + 26);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx - 22, cy + 10, cx - 40, cy + 26);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
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
  'blossom-sky': blossomSky,
  'circuit-trace': circuitTrace,
  'fern-footprint': fernFootprint,
  'peppermint-stripe': peppermintStripe,
  'reef-bubble': reefBubble,
  nebula,
};

/** All eighteen patterns in studio-picker order. */
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
