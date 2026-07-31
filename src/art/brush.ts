/**
 * art/brush.ts — a painting toolkit: stamps, not fills.
 *
 * Per `docs/design/painted-rendering.md` Pillar 1, the root cause of our
 * "cheap" look is the drawing primitive itself. `ctx.fill()` gives a
 * mathematically perfect edge and one flat colour inside; every painted image
 * has broken, varied edges and colour that shifts *within* a single shape.
 *
 * This module replaces the fill with a brush. A **stamp** is a small alpha
 * kernel (radial falloff, optionally bristled or gritty). A **stroke** lays
 * many stamps along a path with per-stamp jitter in size, opacity, rotation
 * and hue. A shape is built from many low-opacity passes rather than one fill.
 *
 * ## Why a software rasteriser and not canvas 2D
 *
 * Everything paints into a `Surface`: a plain `Float32Array` of premultiplied
 * RGBA. That buys three things canvas 2D cannot give us:
 *
 * 1. **Per-stamp hue/saturation/value jitter** without a tint-canvas round
 *    trip per stamp (which is what makes the naive canvas version unusably
 *    slow and is why previous attempts fell back to flat fills).
 * 2. **Determinism** — identical bytes on every machine. Canvas antialiasing
 *    differs between platforms and GPU stacks, so baked art would drift.
 * 3. **Testability** — the whole engine runs in plain Node, so
 *    `tests/art-brush.test.ts` can assert on actual pixels: edge softness,
 *    internal colour variance, value histograms.
 *
 * Bridge back to the app with {@link surfaceToImageData} / {@link drawSurface}
 * (browser) — the cost is paid once at bake time, per the art pipeline.
 *
 * ## The toolkit
 *
 * | op | painter's equivalent |
 * |---|---|
 * | {@link stroke}   | a loaded brush dragged along a path, with taper and pressure |
 * | {@link scumble}  | dry broken colour dragged over a layer, letting it show through |
 * | {@link glaze}    | a thin transparent wash to unify or shift temperature |
 * | {@link blockIn}  | fast coarse mass with deliberately rough edges |
 * | {@link edgeVary} | some edges sharpened, some softened, some lost entirely |
 * | {@link dab}      | a single stamp — the atom the rest are built from |
 *
 * Every op is seeded and deterministic: pass `seed` (or your own `rng`) and
 * you get the same painting back, forever.
 */

import { mulberry32, type RandomFn } from './noise';

/* ========================================================================== *
 * 1. Colour
 * ========================================================================== */

/** Linear-ish sRGB triple, each channel 0..1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue 0..360, saturation 0..1, lightness 0..1. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Anything the brush ops accept as a colour. */
export type ColourLike = string | Rgb | Hsl;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Clamp to [lo, hi]. */
export function clampTo(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`, `hsl()/hsla()`. */
export function parseColour(input: ColourLike): Rgb {
  if (typeof input !== 'string') {
    if ('r' in input) return { r: clamp01(input.r), g: clamp01(input.g), b: clamp01(input.b) };
    return hslToRgb(input);
  }
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
      };
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
      };
    }
    return { r: 0, g: 0, b: 0 };
  }
  const nums = s.match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (s.startsWith('hsl')) {
    return hslToRgb({ h: nums[0] ?? 0, s: (nums[1] ?? 0) / 100, l: (nums[2] ?? 0) / 100 });
  }
  return { r: (nums[0] ?? 0) / 255, g: (nums[1] ?? 0) / 255, b: (nums[2] ?? 0) / 255 };
}

/** HSL → RGB (all components normalised as documented on {@link Hsl}). */
export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp01(s);
  const ll = clamp01(l);
  if (ss === 0) return { r: ll, g: ll, b: ll };
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
  return { r: r + m, g: g + m, b: b + m };
}

/** RGB → HSL. */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s: clamp01(s), l };
}

/** Linear interpolation between two colours in RGB. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Shift a colour in HSL space — the natural axis for painterly variation. */
export function shiftHsl(colour: ColourLike, dh: number, ds: number, dl: number): Rgb {
  const hsl = rgbToHsl(parseColour(colour));
  return hslToRgb({ h: hsl.h + dh, s: clamp01(hsl.s + ds), l: clamp01(hsl.l + dl) });
}

/** Perceptual-ish luminance of a colour, 0..1. Used by the value-first checks. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `#rrggbb` for a colour — for handing surfaces back to CSS/canvas land. */
export function toHex(c: Rgb): string {
  const ch = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}

/* ========================================================================== *
 * 2. Surfaces
 * ========================================================================== */

/**
 * A paintable buffer: premultiplied RGBA float, row-major, 4 floats per pixel.
 *
 * Premultiplied because that makes source-over a two-multiply-add per channel
 * with no divisions — and stamping is the hot loop.
 */
export interface Surface {
  width: number;
  height: number;
  /** length = width * height * 4, premultiplied RGBA in 0..1. */
  data: Float32Array;
}

/** Allocate a surface, optionally pre-filled with an opaque ground colour. */
export function createSurface(width: number, height: number, ground?: ColourLike): Surface {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const surface: Surface = { width: w, height: h, data: new Float32Array(w * h * 4) };
  if (ground !== undefined) fillSurface(surface, ground);
  return surface;
}

/** Flood a surface with an opaque colour (the ground / imprimatura). */
export function fillSurface(surface: Surface, colour: ColourLike, alpha = 1): void {
  const c = parseColour(colour);
  const a = clamp01(alpha);
  const d = surface.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = c.r * a;
    d[i + 1] = c.g * a;
    d[i + 2] = c.b * a;
    d[i + 3] = a;
  }
}

/** Deep copy — handy for A/B passes and for snapshotting before an experiment. */
export function cloneSurface(surface: Surface): Surface {
  return { width: surface.width, height: surface.height, data: new Float32Array(surface.data) };
}

/** Read one pixel as straight (un-premultiplied) RGBA. */
export function getPixel(surface: Surface, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const xi = Math.max(0, Math.min(surface.width - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(surface.height - 1, Math.round(y)));
  const i = (yi * surface.width + xi) * 4;
  const a = surface.data[i + 3];
  if (a <= 1e-6) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: surface.data[i] / a, g: surface.data[i + 1] / a, b: surface.data[i + 2] / a, a };
}

/**
 * Convert to 8-bit RGBA suitable for `ImageData`. Returns the raw array so
 * this works in Node too; in the browser use {@link surfaceToImageData}.
 */
export function surfaceToRGBA8(surface: Surface, background?: ColourLike): Uint8ClampedArray {
  const out = new Uint8ClampedArray(surface.width * surface.height * 4);
  const d = surface.data;
  const bg = background === undefined ? null : parseColour(background);
  for (let i = 0, o = 0; i < d.length; i += 4, o += 4) {
    let a = d[i + 3];
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    if (bg) {
      // Composite over an opaque backdrop.
      r += bg.r * (1 - a);
      g += bg.g * (1 - a);
      b += bg.b * (1 - a);
      a = 1;
    }
    if (a <= 1e-6) {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
      continue;
    }
    out[o] = clamp01(r / a) * 255;
    out[o + 1] = clamp01(g / a) * 255;
    out[o + 2] = clamp01(b / a) * 255;
    out[o + 3] = clamp01(a) * 255;
  }
  return out;
}

/** Browser bridge: surface → `ImageData`. */
export function surfaceToImageData(surface: Surface, background?: ColourLike): ImageData {
  return new ImageData(surfaceToRGBA8(surface, background), surface.width, surface.height);
}

/**
 * Browser bridge: blit a surface onto a 2D context at (x, y).
 *
 * Uses an intermediate canvas so the blit respects the context transform and
 * composite mode (unlike `putImageData`, which ignores both).
 */
export function drawSurface(ctx: CanvasRenderingContext2D, surface: Surface, x = 0, y = 0): void {
  const tmp = document.createElement('canvas');
  tmp.width = surface.width;
  tmp.height = surface.height;
  const tctx = tmp.getContext('2d')!;
  tctx.putImageData(surfaceToImageData(surface), 0, 0);
  ctx.drawImage(tmp, x, y);
}

/**
 * Composite one surface onto another at (x, y) — the layer stack.
 *
 * Painting a mass into its own small layer and compositing it lets the mass be
 * clipped to a silhouette *after* the strokes are laid, which is the only way
 * to get brushy interior texture and a controlled outline at the same time.
 */
export function compositeSurface(
  dst: Surface,
  src: Surface,
  x = 0,
  y = 0,
  alpha = 1,
  blend: BlendMode = 'normal',
): void {
  const ox = Math.round(x);
  const oy = Math.round(y);
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(dst.width, ox + src.width);
  const y1 = Math.min(dst.height, oy + src.height);
  const a = clamp01(alpha);
  if (a <= 0) return;
  for (let dy = y0; dy < y1; dy++) {
    for (let dx = x0; dx < x1; dx++) {
      const si = ((dy - oy) * src.width + (dx - ox)) * 4;
      const sa = src.data[si + 3];
      if (sa <= 0.002) continue;
      compositePixel(dst.data, (dy * dst.width + dx) * 4, src.data[si] / sa, src.data[si + 1] / sa, src.data[si + 2] / sa, sa * a, blend);
    }
  }
}

/**
 * Multiply a surface's alpha by a mask's coverage, with a feathered and
 * noise-perturbed boundary.
 *
 * `feather` widens the transition; `noise` displaces the boundary by up to
 * that many px of low-frequency noise, which is what keeps the outline from
 * reading as a vector path even though it is precisely controlled.
 */
export function clipToMask(
  surface: Surface,
  mask: Mask,
  opts: { offsetX?: number; offsetY?: number; feather?: number; noise?: number; noiseScale?: number; seed?: number } = {},
): void {
  const ox = opts.offsetX ?? 0;
  const oy = opts.offsetY ?? 0;
  const feather = Math.max(0.25, opts.feather ?? 1.2);
  const noise = opts.noise ?? 0;
  const noiseScale = opts.noiseScale ?? 9;
  const seed = (opts.seed ?? 0x0c11) >>> 0;
  const d = surface.data;
  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      const i = (y * surface.width + x) * 4;
      if (d[i + 3] <= 0.002) continue;
      const sx = x + ox;
      const sy = y + oy;
      let dist = maskDistanceAt(mask, sx, sy);
      if (noise > 0) dist -= (clamp01((fbm(sx / noiseScale, sy / noiseScale, seed, 3) - 0.26) / 0.48) - 0.5) * 2 * noise;
      // dist < 0 inside; ramp out across `feather`.
      const k = clamp01(0.5 - dist / (feather * 2));
      if (k >= 0.999) continue;
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k;
      d[i + 3] *= k;
    }
  }
}

/** Browser bridge: read an existing canvas region into a surface. */
export function surfaceFromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): Surface {
  const ctx = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const surface = createSurface(canvas.width, canvas.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    surface.data[i] = (img.data[i] / 255) * a;
    surface.data[i + 1] = (img.data[i + 1] / 255) * a;
    surface.data[i + 2] = (img.data[i + 2] / 255) * a;
    surface.data[i + 3] = a;
  }
  return surface;
}

/* ========================================================================== *
 * 3. Blending
 * ========================================================================== */

/** Separable blend modes, the subset a painter actually reaches for. */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'softlight'
  | 'lighten'
  | 'darken'
  | 'add'
  | 'erase';

function blendChannel(mode: BlendMode, cd: number, cs: number): number {
  switch (mode) {
    case 'multiply':
      return cd * cs;
    case 'screen':
      return cd + cs - cd * cs;
    case 'overlay':
      return cd <= 0.5 ? 2 * cd * cs : 1 - 2 * (1 - cd) * (1 - cs);
    case 'softlight': {
      // W3C soft-light.
      const dd = cd <= 0.25 ? ((16 * cd - 12) * cd + 4) * cd : Math.sqrt(cd);
      return cs <= 0.5 ? cd - (1 - 2 * cs) * cd * (1 - cd) : cd + (2 * cs - 1) * (dd - cd);
    }
    case 'lighten':
      return Math.max(cd, cs);
    case 'darken':
      return Math.min(cd, cs);
    case 'add':
      return cd + cs;
    default:
      return cs;
  }
}

/**
 * Composite one source sample onto the surface at index `i` (premultiplied
 * storage). This is the innermost function in the engine; keep it branchy but
 * flat — V8 inlines it well.
 */
function compositePixel(d: Float32Array, i: number, r: number, g: number, b: number, aS: number, mode: BlendMode): void {
  if (aS <= 0) return;
  const aD = d[i + 3];

  if (mode === 'erase') {
    const keep = 1 - aS;
    d[i] *= keep;
    d[i + 1] *= keep;
    d[i + 2] *= keep;
    d[i + 3] = aD * keep;
    return;
  }

  if (mode === 'normal' || aD <= 1e-6) {
    const inv = 1 - aS;
    d[i] = r * aS + d[i] * inv;
    d[i + 1] = g * aS + d[i + 1] * inv;
    d[i + 2] = b * aS + d[i + 2] * inv;
    d[i + 3] = aS + aD * inv;
    return;
  }

  // Un-premultiply the backdrop for the blend function, then re-composite.
  const cdR = d[i] / aD;
  const cdG = d[i + 1] / aD;
  const cdB = d[i + 2] / aD;
  const bR = blendChannel(mode, cdR, r);
  const bG = blendChannel(mode, cdG, g);
  const bB = blendChannel(mode, cdB, b);
  // Cs' = (1 - aD) * Cs + aD * B(Cd, Cs)
  const mR = (1 - aD) * r + aD * bR;
  const mG = (1 - aD) * g + aD * bG;
  const mB = (1 - aD) * b + aD * bB;
  const inv = 1 - aS;
  d[i] = mR * aS + d[i] * inv;
  d[i + 1] = mG * aS + d[i + 1] * inv;
  d[i + 2] = mB * aS + d[i + 2] * inv;
  d[i + 3] = aS + aD * inv;
}

/* ========================================================================== *
 * 4. Stamp kernels
 * ========================================================================== */

/** The bristle character of a brush head. */
export type BrushKind =
  /** Airbrush-ish radial falloff. The workhorse for soft masses and glow. */
  | 'soft'
  /** Round hog-hair: streaks of bristle with gaps between them. */
  | 'bristle'
  /** Dry chalk/conté: gritty, high-frequency, bites the paper tooth. */
  | 'chalk'
  /** Flat/filbert: wide, short, leaves a directional ribbon. */
  | 'flat'
  /** Chisel edge: alpha ramps across the width, one crisp side. */
  | 'blade'
  /** Clumped natural sponge — for foliage mass and stone. */
  | 'sponge'
  /** A hard round with only a pixel of feather — for the few crisp accents. */
  | 'ink';

/** A precomputed alpha footprint, square, centred. */
export interface Kernel {
  size: number;
  /** length = size * size, 0..1 */
  alpha: Float32Array;
}

const KERNEL_CACHE = new Map<number, Kernel>();

const KIND_INDEX: Record<BrushKind, number> = {
  soft: 0,
  bristle: 1,
  chalk: 2,
  flat: 3,
  blade: 4,
  sponge: 5,
  ink: 6,
};

/** Deterministic value noise — self-contained, no dependency, no allocation. */
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const e = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (e - c) * u) * v;
}

/** Fractal value noise, 3 octaves. Exposed because siblings want it too. */
export function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(fx, fy, seed + o * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.01;
  }
  return sum / norm;
}

/**
 * Build (and cache) an alpha kernel.
 *
 * `variant` exists so a single brush can cycle several slightly different
 * heads — a real brush never lands identically twice, and repeating one
 * footprint is instantly readable as "computer".
 */
export function makeKernel(kind: BrushKind, size: number, hardness = 0.5, grain = 0.5, variant = 0): Kernel {
  const px = Math.max(3, Math.ceil(size) | 1); // odd, so there's a true centre
  const hB = Math.round(clamp01(hardness) * 20);
  const gB = Math.round(clamp01(grain) * 20);
  // Numeric key, not a template string: `dab` is called hundreds of thousands
  // of times per bake and building a string per call dominated the profile.
  const key = ((((KIND_INDEX[kind] * 258 + px) * 21 + hB) * 21 + gB) * 8) + (variant & 7);
  const hit = KERNEL_CACHE.get(key);
  if (hit) return hit;

  const alpha = new Float32Array(px * px);
  const c = (px - 1) / 2;
  const seed = (variant & 7) * 7919 + px * 31 + hB * 101;
  const rand = mulberry32(seed);

  // Per-variant personality: a slight squash and tilt so no two heads match.
  const squash = 1 + (rand() - 0.5) * 0.28;
  const tilt = (rand() - 0.5) * 0.5;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);

  // Bristle layout for 'bristle' / 'flat': positions and weights across the head.
  const bristleCount = 5 + Math.floor(rand() * 7);
  const bristleY: number[] = [];
  const bristleW: number[] = [];
  for (let i = 0; i < bristleCount; i++) {
    bristleY.push((i / (bristleCount - 1) - 0.5) * 2 + (rand() - 0.5) * 0.18);
    bristleW.push(0.35 + rand() * 0.65);
  }

  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx0 = (x - c) / c;
      const dy0 = (y - c) / c;
      // Local, variant-rotated coordinates.
      const lx = (dx0 * cosT + dy0 * sinT) * squash;
      const ly = (-dx0 * sinT + dy0 * cosT) / squash;
      let a = 0;

      switch (kind) {
        case 'soft': {
          const r = Math.hypot(lx, ly);
          if (r >= 1) break;
          // hardness pushes the falloff exponent: 0 = wide haze, 1 = tight core.
          const exp = 1.05 + hardness * 5.5;
          a = Math.pow(1 - r, exp);
          break;
        }
        case 'ink': {
          const r = Math.hypot(lx, ly);
          const edge = 1 - Math.max(0, Math.min(1, (r - (0.82 - hardness * 0.12)) / 0.2));
          a = edge;
          break;
        }
        case 'bristle': {
          const r = Math.hypot(lx, ly);
          if (r >= 1) break;
          const body = Math.pow(1 - r, 0.8 + hardness * 2.4);
          // Streaks run along local x; gaps between bristles are the point.
          let streak = 0;
          for (let i = 0; i < bristleCount; i++) {
            const d = Math.abs(ly - bristleY[i]);
            const w = 0.06 + 0.09 * bristleW[i];
            if (d < w * 2.6) streak = Math.max(streak, bristleW[i] * Math.exp(-(d * d) / (2 * w * w)));
          }
          // Along the bristle, splatter thins toward the tip.
          const along = 0.55 + 0.45 * (1 - Math.abs(lx));
          a = body * (0.18 + 0.95 * streak) * along;
          break;
        }
        case 'chalk': {
          const r = Math.hypot(lx, ly);
          if (r >= 1) break;
          const body = Math.pow(1 - r, 0.55 + hardness * 1.9);
          const n = fbm((x + seed) * 0.85, (y - seed) * 0.85, seed, 3);
          // Grain carves holes in the deposit — the paper shows through.
          const bite = 1 - grain;
          const tooth = Math.max(0, (n - 0.34 * grain) / (1 - 0.34 * grain));
          a = body * (bite + (1 - bite) * tooth * 1.35);
          break;
        }
        case 'flat': {
          // Wide ribbon: full across local x, short across local y.
          const ax = Math.abs(lx);
          const ay = Math.abs(ly) / 0.42;
          if (ax >= 1 || ay >= 1) break;
          const endFall = Math.pow(1 - ax, 0.35 + (1 - hardness) * 1.4);
          const sideFall = Math.pow(1 - ay, 0.3 + (1 - hardness) * 1.6);
          let streak = 1;
          for (let i = 0; i < bristleCount; i++) {
            const d = Math.abs(ly / 0.42 - bristleY[i]);
            if (d < 0.1) streak = Math.min(streak, 0.55 + bristleW[i] * 0.45);
          }
          a = endFall * sideFall * streak;
          break;
        }
        case 'blade': {
          const ax = Math.abs(lx);
          const ay = Math.abs(ly) / 0.34;
          if (ax >= 1 || ay >= 1) break;
          // One side crisp (the chisel), the other feathered.
          const crisp = ly < 0 ? 1 : Math.pow(1 - ay, 1.6);
          a = Math.pow(1 - ax, 0.3) * crisp * (1 - ay * 0.35);
          break;
        }
        case 'sponge': {
          const r = Math.hypot(lx, ly);
          if (r >= 1) break;
          const body = Math.pow(1 - r, 0.7);
          const n = fbm((x + seed * 0.5) * 0.5, (y + seed * 0.7) * 0.5, seed + 5, 3);
          const clump = Math.max(0, (n - 0.42) / 0.58);
          a = body * clump * 1.8;
          break;
        }
      }

      // A whisper of per-pixel noise on every head — kills banding in the
      // falloff and stops the stamp reading as a gradient primitive.
      if (a > 0) {
        const jn = hash2(x * 7 + variant, y * 13 - variant, seed + 991);
        a *= 1 - grain * 0.22 * jn;
      }
      alpha[y * px + x] = a > 1 ? 1 : a < 0 ? 0 : a;
    }
  }

  const kernel: Kernel = { size: px, alpha };
  // The cache is bounded in practice (a bake uses a few dozen distinct heads),
  // but stay honest about it rather than growing without limit.
  if (KERNEL_CACHE.size > 512) KERNEL_CACHE.clear();
  KERNEL_CACHE.set(key, kernel);
  return kernel;
}

/** Drop cached kernels. Only needed by tests measuring cold-build cost. */
export function clearKernelCache(): void {
  KERNEL_CACHE.clear();
}

/* ------------------------------ quality scale ----------------------------- */

let PAINT_QUALITY = 1;

/**
 * Global stamp-budget multiplier, 0.2–2 (default 1).
 *
 * Painting cost is dominated by stamp count, so this is the one knob that
 * trades bake time against texture fidelity. Lowering it reduces the number of
 * stamps and raises each one's opacity to compensate, so *values* hold and
 * only the fineness of the texture degrades — which is what you want for a
 * fast first paint that is later re-baked at full quality.
 *
 * Deterministic: a given quality always produces the same image for a seed.
 */
export function setPaintQuality(q: number): void {
  PAINT_QUALITY = clampTo(q, 0.2, 2);
}

/** The current stamp-budget multiplier. */
export function getPaintQuality(): number {
  return PAINT_QUALITY;
}

/* ========================================================================== *
 * 5. Brushes
 * ========================================================================== */

/** How far each stamped attribute is allowed to wander from the brush spec. */
export interface BrushJitter {
  /** ± fraction of size, e.g. 0.3 = ±30%. */
  size: number;
  /** ± fraction of opacity. */
  opacity: number;
  /** ± radians added to the stamp rotation. */
  angle: number;
  /** ± degrees of hue. */
  hue: number;
  /** ± absolute saturation. */
  sat: number;
  /** ± absolute lightness. This is the one that stops shapes reading flat. */
  lum: number;
  /** ± px of positional wander, on top of `scatter`. */
  position: number;
}

/** A fully-specified brush. Build with {@link brush}; never hand-roll. */
export interface Brush {
  kind: BrushKind;
  /** Stamp diameter in px. */
  size: number;
  /** 0 = wide haze, 1 = tight core. */
  hardness: number;
  /** Per-stamp alpha before jitter — keep this LOW (0.05–0.3) and build up. */
  opacity: number;
  /** Stamp step as a fraction of size. < 0.25 for solid, > 0.5 for broken. */
  spacing: number;
  /** Perpendicular wander as a fraction of size. */
  scatter: number;
  /** Base head rotation in radians (ignored when `followPath`). */
  angle: number;
  /** Rotate each stamp to the path tangent — what a real brush does. */
  followPath: boolean;
  /** Multiplier applied to every stamp's alpha. Fade a whole pass with this. */
  flow: number;
  /** 0..1 texture bite baked into the kernel. */
  grain: number;
  colour: Rgb;
  blend: BlendMode;
  jitter: BrushJitter;
  /** How many distinct heads to cycle (1–8). */
  variants: number;
}

const KIND_DEFAULTS: Record<BrushKind, Partial<Brush>> = {
  soft: { hardness: 0.35, opacity: 0.1, spacing: 0.16, grain: 0.25, scatter: 0.05 },
  bristle: { hardness: 0.55, opacity: 0.16, spacing: 0.2, grain: 0.55, scatter: 0.09 },
  chalk: { hardness: 0.5, opacity: 0.14, spacing: 0.26, grain: 0.85, scatter: 0.14 },
  flat: { hardness: 0.6, opacity: 0.18, spacing: 0.14, grain: 0.45, scatter: 0.04, followPath: true },
  blade: { hardness: 0.85, opacity: 0.3, spacing: 0.1, grain: 0.25, scatter: 0.02, followPath: true },
  sponge: { hardness: 0.4, opacity: 0.12, spacing: 0.42, grain: 0.9, scatter: 0.35 },
  ink: { hardness: 0.95, opacity: 0.55, spacing: 0.08, grain: 0.1, scatter: 0.01 },
};

const DEFAULT_JITTER: BrushJitter = {
  size: 0.3,
  opacity: 0.4,
  angle: 0.35,
  hue: 7,
  sat: 0.07,
  lum: 0.07,
  position: 0.6,
};

/**
 * Build a brush from a kind plus overrides.
 *
 * ```ts
 * const leafBrush = brush('bristle', { size: 22, colour: '#4a6b32', opacity: 0.13 });
 * ```
 *
 * The defaults are deliberately *low opacity, high jitter*: the engine is
 * meant to be used by building up many passes, not by laying one opaque one.
 */
export function brush(kind: BrushKind, overrides: Partial<Omit<Brush, 'colour' | 'jitter'>> & {
  colour?: ColourLike;
  jitter?: Partial<BrushJitter>;
} = {}): Brush {
  const kd = KIND_DEFAULTS[kind];
  const { colour, jitter, ...rest } = overrides;
  return {
    kind,
    size: 18,
    hardness: 0.5,
    opacity: 0.14,
    spacing: 0.2,
    scatter: 0.08,
    angle: 0,
    followPath: false,
    flow: 1,
    grain: 0.5,
    blend: 'normal',
    variants: 6,
    ...kd,
    ...rest,
    colour: parseColour(colour ?? '#6b5a44'),
    jitter: { ...DEFAULT_JITTER, ...(jitter ?? {}) },
  };
}

/** Copy a brush with tweaks — the usual way to derive a lighter/darker pass. */
export function withBrush(base: Brush, overrides: Partial<Omit<Brush, 'colour' | 'jitter'>> & {
  colour?: ColourLike;
  jitter?: Partial<BrushJitter>;
}): Brush {
  const { colour, jitter, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    colour: colour === undefined ? base.colour : parseColour(colour),
    jitter: { ...base.jitter, ...(jitter ?? {}) },
  };
}

/* ========================================================================== *
 * 6. The atom: one stamp
 * ========================================================================== */

/** Everything a single stamp needs. All fields optional bar position. */
export interface DabOptions {
  /** Overrides `brush.size` for this stamp. */
  size?: number;
  /** Overrides `brush.opacity` for this stamp (before flow). */
  opacity?: number;
  /** Absolute rotation in radians. */
  angle?: number;
  /** Overrides `brush.colour`. */
  colour?: ColourLike;
  /** Which cached head to use; defaults to a hash of the position. */
  variant?: number;
  blend?: BlendMode;
}

/**
 * Lay one stamp. Sub-pixel positioned, rotated by inverse-mapping the kernel
 * with bilinear sampling, so stamps never snap to the pixel grid.
 */
export function dab(surface: Surface, x: number, y: number, b: Brush, opts: DabOptions = {}): void {
  const size = Math.max(1.2, opts.size ?? b.size);
  const alphaMul = clamp01((opts.opacity ?? b.opacity) * b.flow);
  if (alphaMul <= 0.0006) return;
  const angle = opts.angle ?? b.angle;
  const colour = opts.colour === undefined ? b.colour : parseColour(opts.colour);
  const blend = opts.blend ?? b.blend;
  const variant =
    opts.variant ?? Math.floor(hash2(Math.round(x * 3.1), Math.round(y * 3.7), 4919) * b.variants);

  const kernel = makeKernel(b.kind, Math.min(256, Math.max(3, Math.round(size))), b.hardness, b.grain, variant);
  const k = kernel.size;
  const kc = (k - 1) / 2;
  // The kernel is built at its own pixel size; scale maps surface px → kernel px.
  const scale = k / size;

  const half = size * 0.5 * Math.SQRT2 + 1;
  const x0 = Math.max(0, Math.floor(x - half));
  const x1 = Math.min(surface.width - 1, Math.ceil(x + half));
  const y0 = Math.max(0, Math.floor(y - half));
  const y1 = Math.min(surface.height - 1, Math.ceil(y + half));
  if (x1 < x0 || y1 < y0) return;

  // Inverse rotation, stepped incrementally along each row: `dab` runs
  // hundreds of thousands of times per bake, so the inner loop is two adds
  // per pixel rather than four multiplies.
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const stepX = cos * scale;
  const stepY = sin * scale;
  const d = surface.data;
  const ka = kernel.alpha;
  const { r, g, b: bl } = colour;
  const kMax = k - 1;
  const w = surface.width;
  // Bilinear matters on big heads; below ~14px the extra 4 reads and 6 mults
  // per pixel buy nothing you can see.
  const bilinear = size >= 14;
  const normal = blend === 'normal';

  for (let py = y0; py <= y1; py++) {
    const dy = py + 0.5 - y;
    const dx0 = x0 + 0.5 - x;
    let kx = (dx0 * cos - dy * sin) * scale + kc;
    let ky = (dx0 * sin + dy * cos) * scale + kc;
    let idx = (py * w + x0) * 4;
    for (let px = x0; px <= x1; px++, kx += stepX, ky += stepY, idx += 4) {
      if (kx < 0 || ky < 0 || kx > kMax || ky > kMax) continue;
      const ix = kx | 0;
      const iy = ky | 0;
      let a: number;
      if (bilinear) {
        const fx = kx - ix;
        const fy = ky - iy;
        const ix1 = ix + 1 < k ? ix + 1 : ix;
        const iy1 = iy + 1 < k ? iy + 1 : iy;
        const row0 = iy * k;
        const row1 = iy1 * k;
        a =
          (ka[row0 + ix] * (1 - fx) + ka[row0 + ix1] * fx) * (1 - fy) +
          (ka[row1 + ix] * (1 - fx) + ka[row1 + ix1] * fx) * fy;
      } else {
        a = ka[iy * k + ix];
      }
      if (a <= 0.0008) continue;
      const aS = a * alphaMul;
      if (normal) {
        // Inlined source-over: the overwhelmingly common case, and the call
        // overhead was measurable against three multiply-adds.
        const inv = 1 - aS;
        d[idx] = r * aS + d[idx] * inv;
        d[idx + 1] = g * aS + d[idx + 1] * inv;
        d[idx + 2] = bl * aS + d[idx + 2] * inv;
        d[idx + 3] = aS + d[idx + 3] * inv;
      } else {
        compositePixel(d, idx, r, g, bl, aS, blend);
      }
    }
  }
}

/** Apply this brush's jitter to a colour. Exported so callers can match tone. */
export function jitterColour(b: Brush, rng: RandomFn): Rgb {
  const j = b.jitter;
  if (j.hue === 0 && j.sat === 0 && j.lum === 0) return b.colour;
  const hsl = rgbToHsl(b.colour);
  return hslToRgb({
    h: hsl.h + (rng() * 2 - 1) * j.hue,
    s: clamp01(hsl.s + (rng() * 2 - 1) * j.sat),
    l: clamp01(hsl.l + (rng() * 2 - 1) * j.lum),
  });
}

/* ========================================================================== *
 * 7. Paths
 * ========================================================================== */

export interface Vec2 {
  x: number;
  y: number;
}

/** A resampled path sample: position, tangent angle and 0..1 arc parameter. */
export interface PathSample {
  x: number;
  y: number;
  /** Tangent direction in radians. */
  angle: number;
  /** Normalised arc length, 0 at the start, 1 at the end. */
  t: number;
}

/** Total polyline length. */
export function pathLength(pts: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** Centripetal Catmull-Rom smoothing — turns 4 hand-placed points into a curve. */
export function smoothPath(pts: readonly Vec2[], subdivisions = 8): Vec2[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out: Vec2[] = [];
  const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < subdivisions; s++) {
      const t = s / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

/** Walk a polyline at fixed arc-length intervals, reporting tangent and t. */
export function resamplePath(pts: readonly Vec2[], step: number): PathSample[] {
  const out: PathSample[] = [];
  if (pts.length === 0) return out;
  const total = pathLength(pts);
  if (pts.length === 1 || total < 1e-6) {
    out.push({ x: pts[0].x, y: pts[0].y, angle: 0, t: 0 });
    return out;
  }
  const s = Math.max(0.15, step);
  let travelled = 0;
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-9) continue;
    const angle = Math.atan2(dy, dx);
    let d = carry;
    while (d <= segLen) {
      const u = d / segLen;
      out.push({ x: a.x + dx * u, y: a.y + dy * u, angle, t: (travelled + d) / total });
      d += s;
    }
    carry = d - segLen;
    travelled += segLen;
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  out.push({ x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x), t: 1 });
  return out;
}

/* ========================================================================== *
 * 8. stroke — a loaded brush dragged along a path
 * ========================================================================== */

/** Shapes the width/alpha profile along a stroke. */
export type PressureFn = (t: number) => number;

/** Ready-made pressure curves, since hand-rolling them every time is tedious. */
export const PRESSURE = {
  /** Constant. */
  flat: (): number => 1,
  /** Heavy in the middle, tapered at both ends — a natural single stroke. */
  arc: (t: number): number => Math.sin(Math.PI * clamp01(t)) ** 0.55,
  /** Lands hard, lifts off — a flick. */
  flick: (t: number): number => Math.pow(1 - clamp01(t), 0.7),
  /** Lifts on, presses down — for stems thickening into a trunk. */
  swell: (t: number): number => Math.pow(clamp01(t), 0.7),
  /** Two accents with a thin waist — a leaf ridge or a decorative rule. */
  double: (t: number): number => 0.45 + 0.55 * Math.abs(Math.cos(Math.PI * clamp01(t))),
} satisfies Record<string, PressureFn>;

export interface StrokeOptions {
  /** Width/alpha profile along the stroke. Default `PRESSURE.arc`. */
  pressure?: PressureFn;
  /** Taper fraction at [start, end]; a number applies to both. Default 0.12. */
  taper?: number | [number, number];
  /** How many overlapping passes to lay. 2–3 reads far more like paint. */
  passes?: number;
  /** Per-pass lateral offset in px — passes that overlay exactly look printed. */
  passOffset?: number;
  /** Low-frequency deviation from the path, in px. Default `brush.size * 0.06`. */
  wobble?: number;
  /** Seed for this stroke. Same seed ⇒ same stroke. */
  seed?: number;
  rng?: RandomFn;
  /** Multiply the whole stroke's alpha. */
  alpha?: number;
  /** Treat the path as closed (joins last point back to first). */
  closed?: boolean;
  /** Smooth the input polyline with Catmull-Rom first. Default true. */
  smooth?: boolean;
  /**
   * Shift hue/lightness along the stroke — a stem that warms toward the light
   * in one gesture. `(t) => ({ dh, dl })`, both optional.
   */
  gradient?: (t: number) => { dh?: number; ds?: number; dl?: number };
}

/**
 * Drag a brush along a path.
 *
 * The single most useful op in the file. A stroke is *not* a stroked path: it
 * is N stamps, each jittered in size, opacity, rotation, position and hue,
 * over M passes. Even at defaults the result has soft varied edges and colour
 * that moves inside the line.
 */
export function stroke(surface: Surface, path: readonly Vec2[], b: Brush, opts: StrokeOptions = {}): void {
  if (path.length === 0) return;
  const rng = opts.rng ?? mulberry32((opts.seed ?? 0x51ed) >>> 0);
  const passes = Math.max(1, Math.round(opts.passes ?? 2));
  const taper = typeof opts.taper === 'number' ? ([opts.taper, opts.taper] as const) : (opts.taper ?? [0.12, 0.12]);
  const pressure = opts.pressure ?? PRESSURE.arc;
  const wobbleAmp = opts.wobble ?? b.size * 0.06;
  const alphaMul = opts.alpha ?? 1;

  let pts = path.map((p) => ({ ...p }));
  if (opts.closed && pts.length > 2) pts.push({ ...pts[0]! });
  if ((opts.smooth ?? true) && pts.length >= 3) pts = smoothPath(pts, 6);

  const step = Math.max(0.4, b.size * b.spacing);
  const samples = resamplePath(pts, step);
  if (samples.length === 0) return;

  const hsl = rgbToHsl(b.colour);

  for (let pass = 0; pass < passes; pass++) {
    const passSeedX = rng() * 1000;
    const passSeedY = rng() * 1000;
    // Later passes ride slightly off-centre and lighter, like reloading.
    const lateral = pass === 0 ? 0 : (rng() * 2 - 1) * (opts.passOffset ?? b.size * 0.16);
    const passAlpha = pass === 0 ? 1 : 0.62 + rng() * 0.3;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const j = b.jitter;

      // --- width / alpha profile -------------------------------------------
      let profile = pressure(s.t);
      const [tIn, tOut] = taper;
      if (tIn > 0 && s.t < tIn) profile *= Math.pow(s.t / tIn, 0.6);
      if (tOut > 0 && s.t > 1 - tOut) profile *= Math.pow((1 - s.t) / tOut, 0.6);
      if (profile <= 0.008) continue;

      // --- position ---------------------------------------------------------
      const nx = -Math.sin(s.angle);
      const ny = Math.cos(s.angle);
      const wob = wobbleAmp === 0 ? 0 : (fbm(s.t * 7 + passSeedX, passSeedY, 17, 2) - 0.5) * 2 * wobbleAmp;
      const scat = (rng() * 2 - 1) * b.scatter * b.size;
      const off = lateral + wob + scat;
      const jx = (rng() * 2 - 1) * j.position;
      const jy = (rng() * 2 - 1) * j.position;
      const x = s.x + nx * off + jx;
      const y = s.y + ny * off + jy;

      // --- size / opacity / angle -------------------------------------------
      const size = b.size * profile * (1 + (rng() * 2 - 1) * j.size);
      const opacity = b.opacity * passAlpha * alphaMul * (0.55 + 0.45 * profile) * (1 + (rng() * 2 - 1) * j.opacity);
      const angle = (b.followPath ? s.angle + b.angle : b.angle) + (rng() * 2 - 1) * j.angle;

      // --- colour ------------------------------------------------------------
      const grad = opts.gradient?.(s.t);
      const colour = hslToRgb({
        h: hsl.h + (rng() * 2 - 1) * j.hue + (grad?.dh ?? 0),
        s: clamp01(hsl.s + (rng() * 2 - 1) * j.sat + (grad?.ds ?? 0)),
        l: clamp01(hsl.l + (rng() * 2 - 1) * j.lum + (grad?.dl ?? 0)),
      });

      dab(surface, x, y, b, { size, opacity, angle, colour, variant: Math.floor(rng() * b.variants) });
    }
  }
}

/* ========================================================================== *
 * 9. Shapes and masks
 * ========================================================================== */

/**
 * A rasterised region: antialiased coverage plus a signed distance field
 * (negative inside). The distance field is what lets {@link scumble} bias
 * texture toward edges and {@link edgeVary} find the boundary band.
 */
export interface Mask {
  /** Bounding box origin in surface space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 coverage, length = width * height. */
  coverage: Float32Array;
  /** Signed distance in px; negative inside, positive outside. */
  distance: Float32Array;
}

/** Axis-aligned rectangle as a polygon. */
export function rectShape(x: number, y: number, w: number, h: number): Vec2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Ellipse as a polygon, `segments` points around. */
export function ellipseShape(cx: number, cy: number, rx: number, ry: number, segments = 48, rotation = 0): Vec2[] {
  const out: Vec2[] = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const px = Math.cos(a) * rx;
    const py = Math.sin(a) * ry;
    out.push({ x: cx + px * cos - py * sin, y: cy + px * sin + py * cos });
  }
  return out;
}

/**
 * A leaf blade: pointed tip, rounded shoulder, slight asymmetry.
 * `bulge` moves the widest point toward the tip (0.5 = middle).
 */
export function leafShape(
  cx: number,
  cy: number,
  length: number,
  width: number,
  angle = 0,
  bulge = 0.42,
  asymmetry = 0.12,
  segments = 28,
): Vec2[] {
  const out: Vec2[] = [];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Skew t so the bell peaks at `bulge` with no kink there — a piecewise
  // linear ramp leaves a visible corner at the widest point, which is exactly
  // the kind of tell that makes procedural foliage look manufactured.
  const skew = Math.log(0.5) / Math.log(clampTo(bulge, 0.08, 0.92));
  const side = (t: number, sign: number) => {
    const p = Math.sin(Math.PI * Math.pow(clamp01(t), skew));
    const w = Math.pow(Math.max(0, p), 0.72) * (width / 2) * (1 + sign * asymmetry);
    const lx = t * length - length / 2;
    const ly = sign * w + Math.sin(t * Math.PI) * width * 0.05;
    return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
  };
  for (let i = 0; i <= segments; i++) out.push(side(i / segments, 1));
  for (let i = segments; i >= 0; i--) out.push(side(i / segments, -1));
  return out;
}

/** Offset every vertex outward along its normal — grow or shrink a shape. */
export function offsetShape(shape: readonly Vec2[], amount: number): Vec2[] {
  let cx = 0;
  let cy = 0;
  for (const p of shape) {
    cx += p.x;
    cy += p.y;
  }
  cx /= shape.length;
  cy /= shape.length;
  return shape.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
  });
}

/**
 * Insert vertices so no edge is longer than `maxSegment`.
 *
 * Required before roughening anything with few vertices: displacing the four
 * corners of a rectangle leaves four mathematically straight edges, which is
 * the exact tell the roughening was meant to remove.
 */
export function densifyShape(shape: readonly Vec2[], maxSegment: number): Vec2[] {
  const out: Vec2[] = [];
  const n = shape.length;
  const step = Math.max(0.5, maxSegment);
  for (let i = 0; i < n; i++) {
    const a = shape[i];
    const b = shape[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const parts = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < parts; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / parts, y: a.y + ((b.y - a.y) * k) / parts });
    }
  }
  return out;
}

/**
 * Displace a shape's outline with low-frequency noise so no silhouette is
 * mathematically clean. Cheap, and it removes the loudest "vector" tell.
 *
 * Densifies first, so it works on rectangles and other coarse polygons.
 */
export function roughenShape(shape: readonly Vec2[], amount: number, seed = 1, frequency = 2.2): Vec2[] {
  let perimeter = 0;
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i];
    const b = shape[(i + 1) % shape.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (shape.length < perimeter / Math.max(2, amount * 2.5)) {
    shape = densifyShape(shape, Math.max(2, amount * 2.5));
  }
  const n = shape.length;
  let cx = 0;
  let cy = 0;
  for (const p of shape) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  return shape.map((p, i) => {
    const t = (i / n) * frequency * Math.PI * 2;
    const d = (fbm(Math.cos(t) * 2 + 4, Math.sin(t) * 2 + 4, seed, 2) - 0.5) * 2 * amount;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * d, y: p.y + (dy / len) * d };
  });
}

/** Even-odd point-in-polygon test. */
export function pointInShape(shape: readonly Vec2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const xi = shape[i].x;
    const yi = shape[i].y;
    const xj = shape[j].x;
    const yj = shape[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Rasterise a polygon into a {@link Mask}, 3×3 supersampled, with a chamfer
 * distance transform. `pad` grows the bounding box (leave room for soft edges).
 */
export function rasterizeShape(shape: readonly Vec2[], pad = 8): Mask {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of shape) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x0 = Math.floor(minX - pad);
  const y0 = Math.floor(minY - pad);
  const w = Math.max(1, Math.ceil(maxX + pad) - x0);
  const h = Math.max(1, Math.ceil(maxY + pad) - y0);
  const coverage = new Float32Array(w * h);

  // Scanline fill with 4 sub-rows and analytic horizontal coverage.
  // (The obvious per-pixel point-in-polygon is O(area × edges) — for a 400px
  // leaf with 80 vertices that is >100M tests per shape, which alone would
  // blow the bake budget.)
  const SUB = 4;
  const subWeight = 1 / SUB;
  const xs: number[] = [];
  const n = shape.length;
  for (let sy = 0; sy < h * SUB; sy++) {
    const py = y0 + (sy + 0.5) / SUB;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = shape[i].y;
      const yj = shape[j].y;
      if (yi > py === yj > py) continue;
      xs.push(shape[i].x + ((py - yi) / (yj - yi)) * (shape[j].x - shape[i].x));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = (sy / SUB) | 0;
    const rowBase = row * w;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let xa = xs[k] - x0;
      let xb = xs[k + 1] - x0;
      if (xb <= 0 || xa >= w) continue;
      if (xa < 0) xa = 0;
      if (xb > w) xb = w;
      const ia = Math.floor(xa);
      const ib = Math.floor(xb - 1e-9);
      if (ia === ib) {
        coverage[rowBase + ia] += (xb - xa) * subWeight;
        continue;
      }
      coverage[rowBase + ia] += (ia + 1 - xa) * subWeight;
      for (let px = ia + 1; px < ib; px++) coverage[rowBase + px] += subWeight;
      coverage[rowBase + ib] += (xb - ib) * subWeight;
    }
  }
  for (let i = 0; i < coverage.length; i++) if (coverage[i] > 1) coverage[i] = 1;

  return { x: x0, y: y0, width: w, height: h, coverage, distance: chamferSDF(coverage, w, h) };
}

/** Two-pass chamfer signed distance from a coverage field. */
function chamferSDF(coverage: Float32Array, w: number, h: number): Float32Array {
  const BIG = 1e9;
  const inner = new Float32Array(w * h);
  const outer = new Float32Array(w * h);
  for (let i = 0; i < coverage.length; i++) {
    const solid = coverage[i] >= 0.5;
    inner[i] = solid ? BIG : 0;
    outer[i] = solid ? 0 : BIG;
  }
  const sweep = (f: Float32Array) => {
    const D1 = 1;
    const D2 = 1.41421356;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = f[i];
        if (x > 0) v = Math.min(v, f[i - 1] + D1);
        if (y > 0) v = Math.min(v, f[i - w] + D1);
        if (x > 0 && y > 0) v = Math.min(v, f[i - w - 1] + D2);
        if (x < w - 1 && y > 0) v = Math.min(v, f[i - w + 1] + D2);
        f[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let v = f[i];
        if (x < w - 1) v = Math.min(v, f[i + 1] + D1);
        if (y < h - 1) v = Math.min(v, f[i + w] + D1);
        if (x < w - 1 && y < h - 1) v = Math.min(v, f[i + w + 1] + D2);
        if (x > 0 && y < h - 1) v = Math.min(v, f[i + w - 1] + D2);
        f[i] = v;
      }
    }
  };
  sweep(inner);
  sweep(outer);
  const sdf = new Float32Array(w * h);
  for (let i = 0; i < sdf.length; i++) sdf[i] = outer[i] > 0 ? outer[i] : -inner[i];
  return sdf;
}

/** Sample a mask's coverage in surface coordinates (0 outside the bbox). */
export function maskCoverageAt(mask: Mask, x: number, y: number): number {
  const mx = Math.round(x) - mask.x;
  const my = Math.round(y) - mask.y;
  if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) return 0;
  return mask.coverage[my * mask.width + mx];
}

/** Sample a mask's signed distance in surface coordinates. */
export function maskDistanceAt(mask: Mask, x: number, y: number): number {
  const mx = Math.round(x) - mask.x;
  const my = Math.round(y) - mask.y;
  if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) return 1e9;
  return mask.distance[my * mask.width + mx];
}

/* ========================================================================== *
 * 10. blockIn — the coarse mass
 * ========================================================================== */

export interface BlockInOptions {
  /** Brush to lay the mass with. Default: a big chalk of the region's size. */
  brush?: Brush;
  /** How many crossing passes. 3 is the sweet spot; 1 reads thin. Default 3. */
  passes?: number;
  /** ± lightness spread across the mass — this is what kills flatness. Default 0.09. */
  valueSpread?: number;
  /** ± hue spread in degrees across the mass. Default 10. */
  hueSpread?: number;
  /** Silhouette displacement in px before painting. Default `size * 0.04`. */
  roughness?: number;
  /** How far strokes are allowed past the silhouette, in px. Default 2.5. */
  overshoot?: number;
  /** Direction of the block-in strokes, radians. Default: along the long axis. */
  direction?: number;
  /** 0 = totally opaque mass, 1 = the ground reads through everywhere. Default 0.08. */
  openness?: number;
  /**
   * Gap between block-in rows as a fraction of brush size. Default 0.5.
   *
   * This is the knob that decides "smooth" vs "you can see the marks": below
   * ~0.3 every pixel receives so many overlapping stamps that the per-stamp
   * jitter averages out and the mass turns into a gradient.
   */
  rowFactor?: number;
  /** Silhouette feather in px after clipping. Small = crisp. Default 1.4. */
  feather?: number;
  /** Noise displacement of the clipped boundary, px. Default `roughness * 0.6`. */
  edgeNoise?: number;
  seed?: number;
  blend?: BlendMode;
}

/**
 * Lay a coarse mass of colour inside a shape, edges deliberately rough.
 *
 * This is the replacement for `ctx.fill()`. The mass is built from crossing
 * chalk/flat strokes that overshoot the silhouette in places and fall short in
 * others, with lightness and hue drifting across it. Follow it with
 * {@link scumble} for texture and {@link edgeVary} to decide which edges the
 * viewer's eye is allowed to lock onto.
 */
export function blockIn(surface: Surface, shape: readonly Vec2[], colour: ColourLike, opts: BlockInOptions = {}): Mask {
  const seed = (opts.seed ?? 0x81ac) >>> 0;
  const rng = mulberry32(seed);
  const base = parseColour(colour);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of shape) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const short = Math.min(bw, bh);

  const rough = opts.roughness ?? Math.max(0.6, short * 0.04);
  const silhouette = rough > 0 ? roughenShape(shape, rough, seed, 2.6) : shape.map((p) => ({ ...p }));
  const mask = rasterizeShape(silhouette, Math.max(6, short * 0.25));

  const overshoot = opts.overshoot ?? Math.max(1.2, short * 0.05);
  // Two passes, not three: a third crossing pass at a different angle weaves a
  // visible moiré, and the extra overlap averages the jitter back out.
  const passes = Math.max(1, Math.round(opts.passes ?? 2));
  const valueSpread = opts.valueSpread ?? 0.11;
  const hueSpread = opts.hueSpread ?? 12;
  const openness = clamp01(opts.openness ?? 0.08);

  const b =
    opts.brush ??
    brush('chalk', {
      size: Math.max(4, short * 0.5),
      // Sparse and opaque, not dense and faint. Dense/faint is what turned the
      // mass into a gradient in the first zoom test.
      opacity: 0.5,
      spacing: 0.2,
      grain: 0.62,
      hardness: 0.42,
      jitter: { size: 0.3, opacity: 0.4, angle: 0.4, hue: 6, sat: 0.06, lum: 0.08, position: short * 0.02 },
    });
  const dir = opts.direction ?? (bw >= bh ? 0 : Math.PI / 2);
  const hsl = rgbToHsl(base);

  // The mass is painted into its own layer so it can be clipped to the
  // silhouette *after* the strokes land. Painting straight onto the target
  // and relying on stroke clipping alone leaves a half-brush-wide halo — the
  // "fog instead of object" failure.
  const layer = createSurface(mask.width, mask.height);
  const lox = mask.x;
  const loy = mask.y;

  // --- underpainting -------------------------------------------------------
  // A dense, quiet pass at a value below the target, purely to make the mass
  // *opaque*. Without it the textured passes leave a ~55%-alpha core, which
  // looks fine over an opaque ground and falls apart the moment the mass is
  // composited as a layer. Painters do exactly this (dead colour first); it
  // also means the visible passes can stay sparse and marky.
  if ((opts.openness ?? 0.08) < 0.5) {
    const under = withBrush(b, {
      kind: 'soft',
      hardness: 0.3,
      grain: 0.15,
      opacity: 0.62,
      spacing: 0.12,
      scatter: 0.04,
      colour: hslToRgb({ h: hsl.h, s: clamp01(hsl.s * 0.95), l: clamp01(hsl.l - valueSpread * 0.55) }),
      blend: 'normal',
      jitter: { size: 0.16, opacity: 0.2, angle: 0.3, hue: 3, sat: 0.03, lum: 0.03, position: 0.6 },
    });
    const uStep = Math.max(1.2, (under.size * 0.26) / Math.min(1, PAINT_QUALITY));
    const uHsl = rgbToHsl(under.colour);
    const margin = under.size * 0.6;
    // Rows run axis-aligned and are clipped to each scanline's actual span
    // inside the mask. Sweeping the bbox *diagonal* (as the crossing passes
    // below must) costs 7× on a tall thin spine for no visible gain.
    const uy0 = Math.max(0, Math.floor(minY - loy - margin));
    const uy1 = Math.min(mask.height - 1, Math.ceil(maxY - loy + margin));
    for (let ly = uy0; ly <= uy1; ly += uStep) {
      const row = Math.max(0, Math.min(mask.height - 1, Math.round(ly)));
      let rx0 = -1;
      let rx1 = -1;
      for (let mx = 0; mx < mask.width; mx++) {
        if (mask.coverage[row * mask.width + mx] > 0.02) {
          if (rx0 < 0) rx0 = mx;
          rx1 = mx;
        }
      }
      if (rx0 < 0) continue;
      const drift = fbm((ly + loy) * 0.02, ly * 0.013, seed + 61, 3) - 0.5;
      stroke(layer, [
        { x: rx0 - margin, y: ly },
        { x: rx1 + margin, y: ly },
      ], withBrush(under, {
        colour: hslToRgb({
          h: uHsl.h + drift * hueSpread * 1.6,
          s: clamp01(uHsl.s + drift * 0.07),
          l: clamp01(uHsl.l + drift * valueSpread * 1.5),
        }),
      }), {
        pressure: PRESSURE.flat,
        taper: 0,
        passes: 1,
        smooth: false,
        wobble: 0,
        rng,
        gradient: (t) => ({ dl: (t - 0.5) * valueSpread * 0.9, dh: (t - 0.5) * hueSpread * 0.8 }),
      });
    }
  }

  // Crossing passes: each pass sweeps at a slightly different angle so the
  // deposit builds a woven, non-directional mass.
  for (let pass = 0; pass < passes; pass++) {
    const angle = dir + (pass - (passes - 1) / 2) * 0.18 + (rng() * 2 - 1) * 0.08;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const span = Math.hypot(bw, bh) / 2 + overshoot + b.size;
    const rowStep = Math.max(1.2, b.size * (opts.rowFactor ?? 0.55));

    for (let vRow = -span; vRow <= span; vRow += rowStep) {
      const lineSeed = rng();
      // Rows on an exact lattice + a second pass at a fixed angle = basket
      // weave, which is as much a "computer" tell as a flat fill. Jitter the
      // row offset and give each row its own slight angle.
      const v = vRow + (rng() * 2 - 1) * rowStep * 0.4;
      const rowAngle = angle + (rng() * 2 - 1) * 0.09;
      const rcos = Math.cos(rowAngle);
      const rsin = Math.sin(rowAngle);
      const path: Vec2[] = [];
      for (let u = -span; u <= span; u += Math.max(2, b.size * 0.5)) {
        path.push({ x: cx + u * rcos - v * rsin, y: cy + u * rsin + v * rcos });
      }
      // Clip the row to the mask, allowing `overshoot` px of slop outside.
      const kept: Vec2[][] = [];
      let run: Vec2[] = [];
      for (const p of path) {
        const d = maskDistanceAt(mask, p.x, p.y);
        const slop = overshoot * (0.35 + 0.65 * fbm(p.x * 0.05, p.y * 0.05, seed + 3, 2));
        if (d < slop) run.push(p);
        else if (run.length) {
          kept.push(run);
          run = [];
        }
      }
      if (run.length) kept.push(run);

      for (const seg of kept) {
        if (seg.length < 2) continue;
        // Where in the mass are we? Drives the value/hue drift.
        const mid = seg[Math.floor(seg.length / 2)];
        const gx = (mid.x - minX) / bw - 0.5;
        const gy = (mid.y - minY) / bh - 0.5;
        const drift = fbm(mid.x * 0.02 + lineSeed * 10, mid.y * 0.02, seed + 11, 3) - 0.5;
        const passBias = (pass / Math.max(1, passes - 1) - 0.5) * 0.4;
        const colourHere = hslToRgb({
          h: hsl.h + (drift + gx * 0.5) * hueSpread * 2,
          s: clamp01(hsl.s + drift * 0.06),
          l: clamp01(hsl.l + (drift * 1.4 + gy * 0.5 + passBias) * valueSpread),
        });
        // Flat pressure, minimal taper: the *clip* against the roughened mask
        // makes the edges, not a per-row taper (which hollows out the mass).
        const local = seg.map((p) => ({ x: p.x - lox, y: p.y - loy }));
        stroke(layer, local, withBrush(b, { colour: colourHere, blend: 'normal' }), {
          pressure: PRESSURE.flat,
          taper: 0.03,
          passes: 1,
          smooth: false,
          alpha: 1 - openness * fbm(mid.x * 0.03, mid.y * 0.03, seed + 21, 2),
          rng,
          wobble: b.size * 0.1,
        });
      }
    }
  }

  clipToMask(layer, mask, {
    offsetX: lox,
    offsetY: loy,
    feather: opts.feather ?? 1.4,
    noise: opts.edgeNoise ?? rough * 0.6,
    noiseScale: Math.max(4, short * 0.16),
    seed: seed + 41,
  });
  compositeSurface(surface, layer, lox, loy, 1, opts.blend ?? 'normal');

  return mask;
}

/* ========================================================================== *
 * 11. scumble — broken, textured coverage
 * ========================================================================== */

export interface ScumbleOptions {
  /** 0..1 — how much of the region gets covered. Default 0.55. */
  coverage?: number;
  /** How many scattered passes. Default 2. */
  passes?: number;
  /** Multiply stamp density (stamps per px²). Default 1. */
  density?: number;
  /** Bias toward edges (+1) or the interior (-1). Default 0 (even). */
  edgeBias?: number;
  /** Scale of the clumping noise, px. Larger = broader patches. Default 26. */
  patchScale?: number;
  /** ± size variation multiplier on top of brush jitter. Default 0.5. */
  sizeSpread?: number;
  /** Directional streak: if set, stamps orient this way ± jitter. */
  direction?: number;
  /**
   * Per-position weight 0..1 in surface coordinates, multiplying both the
   * chance a stamp survives and its opacity.
   *
   * This is how you aim a pass: a lit-side scumble is the same call as a
   * shadow-side one with the weight reversed, which is what keeps a whole
   * scene agreeing about where the light comes from.
   */
  weight?: (x: number, y: number) => number;
  /** Restrict to coverage above this threshold. Default 0.35. */
  threshold?: number;
  /**
   * How solid the deposit gets *where paint lands*, 0..1. Default 0.5.
   *
   * Distinct from `coverage`, which decides *where* it lands. The default
   * suits the common case — a texture veil over a block-in that should still
   * read through. Raise toward 0.9 when scumbling *is* the mass.
   */
  targetBuildup?: number;
  seed?: number;
  /** Multiply the whole pass's alpha. */
  alpha?: number;
}

/**
 * Drag broken colour across a region so the layer underneath shows through.
 *
 * Scumbling is what makes a painted surface look like a *material* rather than
 * a swatch: the coverage is patchy at a low frequency (clumps and gaps), and
 * every stamp shifts hue and value slightly. Use a lighter, cooler colour over
 * a dark block-in to build a lit face; use a darker one to sink a shadow side.
 */
export function scumble(surface: Surface, mask: Mask, b: Brush, opts: ScumbleOptions = {}): void {
  const seed = (opts.seed ?? 0x5c1b) >>> 0;
  const rng = mulberry32(seed);
  const coverage = clamp01(opts.coverage ?? 0.55);
  const passes = Math.max(1, Math.round(opts.passes ?? 2));
  const density = opts.density ?? 1;
  const edgeBias = opts.edgeBias ?? 0;
  const patchScale = opts.patchScale ?? 26;
  const sizeSpread = opts.sizeSpread ?? 0.5;
  const threshold = opts.threshold ?? 0.35;
  const alphaMul = opts.alpha ?? 1;
  const hsl = rgbToHsl(b.colour);

  // --- stamp budget --------------------------------------------------------
  // `coverage` must mean the same thing for a wispy soft head as for a dense
  // ink one, so the budget is derived from how much alpha this brush actually
  // deposits per stamp rather than from its nominal footprint. (A soft head at
  // hardness 0.35 deposits ~10% of its bounding square; budgeting by footprint
  // is why an earlier version needed a magic oversample fudge and *still* fell
  // short — and why `coverage` was applied twice and rejected every stamp.)
  //
  //   built-up alpha after N stamps ≈ 1 - exp(-N · perStamp · opacity / area)
  //
  // solved for the N that reaches `targetBuildup`. `coverage` controls *where*
  // paint lands (the broken-ness); this controls how solid it is where it does.
  const area = mask.width * mask.height;
  const budgetKernel = makeKernel(
    b.kind,
    Math.min(256, Math.max(3, Math.round(b.size))),
    b.hardness,
    b.grain,
    0,
  );
  let kSum = 0;
  for (const a of budgetKernel.alpha) kSum += a;
  const kMean = Math.max(0.02, kSum / budgetKernel.alpha.length);
  const perStamp = Math.max(1, b.size * b.size * kMean);
  const need = -Math.log(1 - Math.min(0.985, clamp01(opts.targetBuildup ?? 0.5)));
  // Quality trades stamp count against per-stamp opacity, so the built-up
  // value is preserved and only the texture's fineness changes.
  const q = PAINT_QUALITY;
  const flow = Math.max(0.06, Math.min(1, (b.opacity * b.flow) / q));
  const opacityScale = flow / Math.max(1e-6, b.opacity * b.flow);
  const total = Math.min(40000, Math.round((((area * need) / (perStamp * flow)) * density) / passes));
  if (total <= 0) return;

  // A cheap interior-extent estimate so edgeBias can normalise.
  let deepest = 1;
  for (let i = 0; i < mask.distance.length; i += 7) deepest = Math.min(deepest, mask.distance[i]);
  const depth = Math.max(2, -deepest);

  for (let pass = 0; pass < passes; pass++) {
    const px = rng() * 500;
    const py = rng() * 500;
    const passAlpha = 1 - pass * 0.12;
    for (let n = 0; n < total; n++) {
      const x = mask.x + rng() * mask.width;
      const y = mask.y + rng() * mask.height;
      const cov = maskCoverageAt(mask, x, y);
      if (cov < threshold) continue;

      const wgt = opts.weight ? clamp01(opts.weight(x, y)) : 1;
      if (wgt <= 0.01 || rng() > wgt) continue;

      // Low-frequency clumping: this is what makes it read as broken colour
      // rather than as uniform noise.
      // 3-octave fbm only spans roughly 0.25–0.75, so remap to a full 0..1
      // range before thresholding — otherwise `coverage` above ~0.25 rejects
      // everything and the pass silently does nothing.
      const patch = clamp01((fbm((x + px) / patchScale, (y + py) / patchScale, seed + pass * 37, 3) - 0.26) / 0.48);
      let keep = patch;
      if (edgeBias !== 0) {
        const d = -maskDistanceAt(mask, x, y) / depth; // 1 = deep inside, 0 = edge
        keep *= edgeBias > 0 ? 1 - d * edgeBias : 1 + d * edgeBias;
      }
      if (keep < 1 - coverage) continue;

      const size = b.size * (1 + (rng() * 2 - 1) * sizeSpread);
      const angle =
        (opts.direction ?? rng() * Math.PI * 2) + (rng() * 2 - 1) * (opts.direction === undefined ? 0 : b.jitter.angle);
      const opacity =
        b.opacity *
        opacityScale *
        passAlpha *
        alphaMul *
        cov *
        (0.5 + 0.5 * wgt) *
        (0.35 + 0.9 * keep) *
        (1 + (rng() * 2 - 1) * b.jitter.opacity);
      const colour = hslToRgb({
        h: hsl.h + (rng() * 2 - 1) * b.jitter.hue + (patch - 0.5) * b.jitter.hue * 1.6,
        s: clamp01(hsl.s + (rng() * 2 - 1) * b.jitter.sat),
        l: clamp01(hsl.l + (rng() * 2 - 1) * b.jitter.lum + (patch - 0.5) * b.jitter.lum * 1.8),
      });
      dab(surface, x, y, b, { size, opacity, angle, colour, variant: Math.floor(rng() * b.variants) });
    }
  }
}

/* ========================================================================== *
 * 12. glaze — a thin transparent wash
 * ========================================================================== */

export interface GlazeOptions {
  /** Blend mode. `multiply` deepens, `screen` lifts, `softlight` unifies. */
  blend?: BlendMode;
  /** Per-pixel weight 0..1 in surface coordinates — gradients, light falloff. */
  gradient?: (x: number, y: number) => number;
  /** Mottling amount 0..1 — a wash is never perfectly even. Default 0.18. */
  mottle?: number;
  /** Mottle noise scale in px. Default 90. */
  mottleScale?: number;
  /** Restrict to the mask (default true when a mask is given). */
  clip?: boolean;
  seed?: number;
}

/**
 * Lay a thin transparent colour pass over a region.
 *
 * This is the painter's tool for *unifying*: one warm glaze over everything in
 * the light and one cool glaze over everything in shadow pulls a scene of
 * independently-painted objects into a single room with a single light.
 *
 * Pass `mask = null` to glaze the whole surface.
 */
export function glaze(
  surface: Surface,
  mask: Mask | null,
  colour: ColourLike,
  alpha: number,
  opts: GlazeOptions = {},
): void {
  const c = parseColour(colour);
  const blend = opts.blend ?? 'normal';
  const mottle = opts.mottle ?? 0.18;
  const mottleScale = opts.mottleScale ?? 90;
  const seed = (opts.seed ?? 0x61a2) >>> 0;
  const clip = opts.clip ?? mask !== null;

  const x0 = mask && clip ? Math.max(0, mask.x) : 0;
  const y0 = mask && clip ? Math.max(0, mask.y) : 0;
  const x1 = mask && clip ? Math.min(surface.width, mask.x + mask.width) : surface.width;
  const y1 = mask && clip ? Math.min(surface.height, mask.y + mask.height) : surface.height;

  const d = surface.data;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let a = alpha;
      if (mask && clip) {
        const cov = mask.coverage[(y - mask.y) * mask.width + (x - mask.x)];
        if (cov <= 0.002) continue;
        a *= cov;
      }
      if (opts.gradient) {
        a *= opts.gradient(x, y);
        if (a <= 0.0008) continue;
      }
      if (mottle > 0) {
        a *= 1 - mottle + mottle * 2 * fbm(x / mottleScale, y / mottleScale, seed, 3);
      }
      if (a <= 0.0008) continue;
      compositePixel(d, (y * surface.width + x) * 4, c.r, c.g, c.b, a > 1 ? 1 : a, blend);
    }
  }
}

/* ========================================================================== *
 * 13. edgeVary — some edges crisp, some lost
 * ========================================================================== */

export interface EdgeVaryOptions {
  /** Fraction of the outline that stays crisp, 0..1. Default 0.3. */
  crisp?: number;
  /** Fraction that dissolves entirely, 0..1. Default 0.25. */
  lost?: number;
  /** Width of the treated band in px. Default 3. */
  band?: number;
  /** How far the crisp/lost decision varies along the edge (higher = choppier). Default 0.55. */
  frequency?: number;
  /** Colour of the crisp accent. Default: a darkened sample of the surface. */
  accent?: ColourLike;
  /** Strength of the crisp accent, 0..1. Default 0.45. */
  accentStrength?: number;
  /** Light direction in radians — edges facing it get the crisp accent lighter. */
  lightAngle?: number;
  /** Blur radius used for the lost edges. Default `band`. */
  softness?: number;
  seed?: number;
}

/**
 * Decide, along a silhouette, which edges the eye is allowed to lock onto.
 *
 * Uniform edge treatment is the second-loudest "computer" tell after flat
 * fills. A painter keeps a handful of crisp edges (usually where the light
 * hits, or at the focal point) and loses the rest into their surroundings.
 *
 * Walks the outline, and per segment either sharpens it with a thin accent,
 * leaves it alone, or dissolves it with a local blur.
 */
export function edgeVary(surface: Surface, shape: readonly Vec2[], opts: EdgeVaryOptions = {}): void {
  const seed = (opts.seed ?? 0x3d6e) >>> 0;
  const rng = mulberry32(seed);
  const crispFrac = clamp01(opts.crisp ?? 0.3);
  const lostFrac = clamp01(opts.lost ?? 0.25);
  const band = Math.max(1, opts.band ?? 3);
  const frequency = opts.frequency ?? 0.55;
  const accentStrength = opts.accentStrength ?? 0.45;
  const softness = Math.max(1, opts.softness ?? band);

  const outline = smoothPath([...shape, shape[0], shape[1]], 4);
  const samples = resamplePath(outline, Math.max(1.2, band * 0.6));
  if (samples.length < 3) return;

  const accentBrush = brush('ink', {
    size: Math.max(1.8, band * 1.25),
    opacity: accentStrength,
    spacing: 0.35,
    scatter: 0.05,
    hardness: 0.95,
    followPath: true,
    jitter: { size: 0.35, opacity: 0.5, angle: 0.2, hue: 6, sat: 0.05, lum: 0.06, position: band * 0.25 },
  });

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // Low-frequency decision field: neighbouring samples agree, so crisp and
    // lost stretches are *runs*, not per-sample noise. Remapped to a true
    // 0..1 range so `crisp` and `lost` mean the fractions they claim to.
    const f = clamp01((fbm(s.x * frequency * 0.06, s.y * frequency * 0.06, seed, 2) - 0.24) / 0.52);

    if (f > 1 - crispFrac) {
      // --- crisp: a thin dark/light accent riding the edge -----------------
      let colour: Rgb;
      if (opts.accent !== undefined) {
        colour = parseColour(opts.accent);
      } else {
        const px = getPixel(surface, s.x, s.y);
        const hsl = rgbToHsl({ r: px.r, g: px.g, b: px.b });
        // Facing the light? lift it. Facing away? sink it.
        let lift = -0.16;
        if (opts.lightAngle !== undefined) {
          const nrm = s.angle - Math.PI / 2;
          const facing = Math.cos(nrm - (opts.lightAngle + Math.PI));
          lift = facing > 0.2 ? 0.14 * facing : -0.18;
        }
        colour = hslToRgb({ h: hsl.h + (lift > 0 ? -6 : 8), s: clamp01(hsl.s + 0.05), l: clamp01(hsl.l + lift) });
      }
      // Two dabs, offset either side of the boundary: one bites into the
      // object, one sits just outside it. A single centred dab reads as a
      // stroked outline rather than as a sharpened edge.
      const nx = -Math.sin(s.angle);
      const ny = Math.cos(s.angle);
      for (const side of [-0.35, 0.3]) {
        dab(surface, s.x + nx * band * side, s.y + ny * band * side, accentBrush, {
          colour,
          angle: s.angle,
          size: accentBrush.size * (0.7 + rng() * 0.7),
          opacity: accentStrength * (0.55 + rng() * 0.6),
        });
      }
    } else if (f < lostFrac) {
      // --- lost: dissolve the boundary into whatever surrounds it ----------
      blurDisc(surface, s.x, s.y, softness * (1.1 + rng() * 0.9), 0.9);
    }
    // else: leave the edge as the block-in left it (already imperfect).
  }
}

/**
 * Local box blur inside a disc — the mechanic behind lost edges and behind
 * atmospheric falloff at the frame's periphery.
 */
export function blurDisc(surface: Surface, cx: number, cy: number, radius: number, amount = 1): void {
  const r = Math.max(1, Math.round(radius));
  const x0 = Math.max(1, Math.floor(cx - r));
  const x1 = Math.min(surface.width - 2, Math.ceil(cx + r));
  const y0 = Math.max(1, Math.floor(cy - r));
  const y1 = Math.min(surface.height - 2, Math.ceil(cy + r));
  if (x1 <= x0 || y1 <= y0) return;
  const w = surface.width;
  const d = surface.data;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const src = new Float32Array(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    const from = ((y0 + y) * w + x0) * 4;
    src.set(d.subarray(from, from + bw * 4), y * bw * 4);
  }
  const kr = Math.max(1, Math.round(r * 0.4));
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      const dist = Math.hypot(sx + 0.5 - cx, sy + 0.5 - cy);
      if (dist > r) continue;
      const wgt = amount * (1 - dist / r);
      if (wgt <= 0.004) continue;
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;
      let n = 0;
      for (let ky = -kr; ky <= kr; ky++) {
        const yy = y + ky;
        if (yy < 0 || yy >= bh) continue;
        for (let kx = -kr; kx <= kr; kx++) {
          const xx = x + kx;
          if (xx < 0 || xx >= bw) continue;
          const i = (yy * bw + xx) * 4;
          ar += src[i];
          ag += src[i + 1];
          ab += src[i + 2];
          aa += src[i + 3];
          n++;
        }
      }
      if (n === 0) continue;
      const o = (sy * w + sx) * 4;
      const inv = 1 - wgt;
      d[o] = d[o] * inv + (ar / n) * wgt;
      d[o + 1] = d[o + 1] * inv + (ag / n) * wgt;
      d[o + 2] = d[o + 2] * inv + (ab / n) * wgt;
      d[o + 3] = d[o + 3] * inv + (aa / n) * wgt;
    }
  }
}

/* ========================================================================== *
 * 14. Surface-wide finishing passes
 * ========================================================================== */

/**
 * Canvas/paper tooth. A whisper of correlated grain over the whole surface
 * ties independently-painted elements into one physical support.
 */
export function addGrain(
  surface: Surface,
  amount = 0.05,
  scale = 1.6,
  seed = 7,
  mask: Mask | null = null,
): void {
  const d = surface.data;
  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      const i = (y * surface.width + x) * 4;
      if (d[i + 3] <= 0.002) continue;
      let k = amount;
      if (mask) {
        const cov = maskCoverageAt(mask, x, y);
        if (cov <= 0.002) continue;
        k *= cov;
      }
      const n = (fbm(x / scale, y / scale, seed, 2) - 0.5) * 2 * k;
      const m = 1 + n;
      d[i] = clamp01(d[i] * m);
      d[i + 1] = clamp01(d[i + 1] * m);
      d[i + 2] = clamp01(d[i + 2] * m);
    }
  }
}

/**
 * Push contrast toward a committed value structure: crush the darks, let the
 * brightest 5% run hot, and split-tone the two ends. This is Pillar 3's
 * "value-first" idea applied as a finishing grade.
 */
export function gradeSurface(
  surface: Surface,
  opts: {
    /** > 1 steepens the curve around `pivot`. Default 1.15. */
    contrast?: number;
    /** Where the curve pivots, 0..1. Default 0.42. */
    pivot?: number;
    /** Lift/crush the black point. Negative crushes. Default -0.02. */
    black?: number;
    /** Colour pushed into the shadows. */
    shadowTint?: ColourLike;
    /** Colour pushed into the highlights. */
    highlightTint?: ColourLike;
    /** 0..1 strength of the split tone. Default 0.12. */
    tintStrength?: number;
    /** Global saturation multiplier. Default 1.06. */
    saturation?: number;
  } = {},
): void {
  const contrast = opts.contrast ?? 1.15;
  const pivot = opts.pivot ?? 0.42;
  const black = opts.black ?? -0.02;
  const tintStrength = opts.tintStrength ?? 0.12;
  const sat = opts.saturation ?? 1.06;
  const shadow = parseColour(opts.shadowTint ?? '#2a3550');
  const highlight = parseColour(opts.highlightTint ?? '#ffd9a0');
  const d = surface.data;

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a <= 0.002) continue;
    let r = d[i] / a;
    let g = d[i + 1] / a;
    let b = d[i + 2] / a;

    // Contrast about the pivot.
    r = clamp01(pivot + (r - pivot) * contrast + black);
    g = clamp01(pivot + (g - pivot) * contrast + black);
    b = clamp01(pivot + (b - pivot) * contrast + black);

    // Split tone.
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sw = Math.pow(1 - lum, 2) * tintStrength;
    const hw = Math.pow(lum, 2) * tintStrength;
    r = clamp01(r * (1 - sw - hw) + shadow.r * sw + highlight.r * hw);
    g = clamp01(g * (1 - sw - hw) + shadow.g * sw + highlight.g * hw);
    b = clamp01(b * (1 - sw - hw) + shadow.b * sw + highlight.b * hw);

    // Saturation about the new luminance.
    if (sat !== 1) {
      const l2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = clamp01(l2 + (r - l2) * sat);
      g = clamp01(l2 + (g - l2) * sat);
      b = clamp01(l2 + (b - l2) * sat);
    }

    d[i] = r * a;
    d[i + 1] = g * a;
    d[i + 2] = b * a;
  }
}

/**
 * Luminance histogram of the painted (alpha > 0.5) pixels.
 *
 * Pillar 3 rejects themes that are mid-tone mush; this is the measurement that
 * makes that testable. Returns normalised bin weights summing to 1.
 */
export function valueHistogram(surface: Surface, bins = 16): Float32Array {
  const out = new Float32Array(bins);
  const d = surface.data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a <= 0.5) continue;
    const l = clamp01(0.2126 * (d[i] / a) + 0.7152 * (d[i + 1] / a) + 0.0722 * (d[i + 2] / a));
    out[Math.min(bins - 1, Math.floor(l * bins))]++;
    n++;
  }
  if (n > 0) for (let i = 0; i < bins; i++) out[i] /= n;
  return out;
}

/**
 * Summary statistics a value-structure test can assert on directly.
 * `spread` is the standard deviation of luminance; `darkMass` / `lightMass`
 * are the fractions below 0.22 and above 0.78.
 */
export function valueStats(surface: Surface): {
  mean: number;
  spread: number;
  darkMass: number;
  lightMass: number;
  min: number;
  max: number;
} {
  const d = surface.data;
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let light = 0;
  let min = 1;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a <= 0.5) continue;
    const l = clamp01(0.2126 * (d[i] / a) + 0.7152 * (d[i + 1] / a) + 0.0722 * (d[i + 2] / a));
    sum += l;
    sumSq += l * l;
    if (l < 0.22) dark++;
    if (l > 0.78) light++;
    if (l < min) min = l;
    if (l > max) max = l;
    n++;
  }
  if (n === 0) return { mean: 0, spread: 0, darkMass: 0, lightMass: 0, min: 0, max: 0 };
  const mean = sum / n;
  return {
    mean,
    spread: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
    darkMass: dark / n,
    lightMass: light / n,
    min,
    max,
  };
}
