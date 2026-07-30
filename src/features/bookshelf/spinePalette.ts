/**
 * features/bookshelf/spinePalette.ts — the 12 curated spine pigments, as
 * plain numbers. Pure (no Pixi), so both the atlas factory and the theme
 * bias adapter can use it and unit tests can import it in node.
 */

import { clamp } from '../../art/noise';
import type { SpineParams } from '../../art/spines';

/**
 * The 12 curated palette duos from art/spines.ts (top, bottom), duplicated
 * here as HSL tuples because art/ does not export them. Used only for flat
 * placeholder tints and the DOM overlay cover — drift is cosmetic.
 */
const PALETTE_DUOS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [38, 62, 52, 30, 58, 38], // amber
  [16, 55, 48, 10, 52, 34], // terracotta
  [95, 28, 42, 100, 30, 30], // moss
  [210, 26, 48, 214, 30, 34], // dusty blue
  [315, 24, 40, 320, 28, 28], // plum
  [44, 60, 46, 40, 55, 33], // ochre
  [130, 16, 52, 135, 18, 38], // sage
  [22, 60, 40, 18, 58, 28], // rust
  [28, 38, 52, 24, 36, 38], // clay
  [70, 30, 38, 66, 32, 27], // olive
  [200, 18, 42, 204, 20, 30], // slate
  [355, 32, 56, 350, 30, 42], // blush
];

function hslToRgbInt(h: number, s: number, l: number): number {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return (to255(r) << 16) | (to255(g) << 8) | to255(b);
}

/** Flat placeholder tint (0xRRGGBB) for a spine before its bake lands. */
export function placeholderTint(params: SpineParams): number {
  const duo = PALETTE_DUOS[params.palette % PALETTE_DUOS.length];
  return hslToRgbInt(duo[0] + params.hueJitter, duo[1], duo[2]);
}

/** CSS colors for the DOM pulled-book cover (top → bottom gradient). */
export function paletteCss(params: SpineParams): { top: string; bottom: string } {
  const duo = PALETTE_DUOS[params.palette % PALETTE_DUOS.length];
  const f = (h: number, s: number, l: number) =>
    `hsl(${(((h + params.hueJitter) % 360) + 360) % 360} ${s}% ${l}%)`;
  return { top: f(duo[0], duo[1], duo[2]), bottom: f(duo[3], duo[4], duo[5]) };
}


/**
 * The 12 pigments as their MID tone in HSL — the average of each duo's top and
 * bottom stop, which is what a spine actually reads as at shelf size.
 */
const PIGMENT_HSL = PALETTE_DUOS.map((duo) => ({
  h: duo[0],
  s: (duo[1] + duo[4]) / 2,
  l: (duo[2] + duo[5]) / 2,
}));

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return null;
  const n = Number.parseInt(m[1] as string, 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

/**
 * Perceptual-ish distance from a colour to one of the 12 pigments.
 *
 * Hue dominates — a book is recognised by its colour FAMILY — but hue is
 * meaningless on a near-grey, so its weight fades with the lower of the two
 * saturations. Lightness barely counts: `art/themes.ts` writes its ramps as
 * deep pigment-in-the-pot values while the spine renderer lightens them, and
 * matching on lightness would collapse every room onto the darkest few.
 */
function pigmentDistance(t: { h: number; s: number; l: number }, i: number): number {
  const p = PIGMENT_HSL[i] as { h: number; s: number; l: number };
  let dh = Math.abs(t.h - p.h);
  if (dh > 180) dh = 360 - dh;
  const hueWeight = Math.min(t.s, p.s) / 45;
  const ds = t.s - p.s;
  const dl = t.l - p.l;
  return dh * dh * 0.02 * hueWeight + ds * ds * 0.02 + dl * dl * 0.004;
}

/**
 * Nearest pigment index to an arbitrary hex colour. `art/themes.ts` describes
 * a room's spine ramp in HEX (it is a design document as much as data), while
 * `resolveBookStyle` biases by pigment INDEX — this is the bridge between the
 * two vocabularies, so "midnight blue, plum, silver-leaf" actually lands on
 * the observatory's books.
 */
export function nearestPigmentIndex(hex: string): number {
  const t = hexToHsl(hex);
  if (t === null) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < PIGMENT_HSL.length; i++) {
    const d = pigmentDistance(t, i);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Map a whole themed ramp onto DISTINCT pigment indices.
 *
 * Matching each hex independently collapses a room onto one or two pigments
 * (five shades of plum all sit nearest "plum"), and a shelf of one colour
 * reads as a bug, not a room. Assigning greedily without replacement keeps the
 * family while restoring the spread the theme author wrote.
 */
export function mapPigmentRamp(hexes: readonly string[]): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  for (const hex of hexes) {
    const t = hexToHsl(hex);
    if (t === null) {
      out.push(0);
      continue;
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < PIGMENT_HSL.length; i++) {
      if (used.has(i)) continue;
      const d = pigmentDistance(t, i);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) best = nearestPigmentIndex(hex);
    used.add(best);
    out.push(best);
  }
  return out;
}

/** Number of curated pigments (mirrors art/spines.PIGMENT_COUNT). */
export const SPINE_PIGMENT_COUNT = PALETTE_DUOS.length;
