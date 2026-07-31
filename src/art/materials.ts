/**
 * materials.ts — the generated material library, as paint.
 *
 * `assets/generated/materials/` holds 1024² seamless tiles painted by the
 * local SDXL pipeline (see `docs/design/generated-assets.md`); the shipping
 * copies are 512² WebP under `public/materials/`, baked by
 * `scripts/prepare-assets.mjs`. This module is the bridge between those files
 * and `src/art/brush.ts`.
 *
 * ## Why the tiles are not used as textures
 *
 * The naive wiring — `ctx.drawImage(tile)` — is exactly the failure mode
 * `docs/design/painted-rendering.md` was written against. A photographic tile
 * pasted into a spine brings its own colour, its own lighting, and its own
 * value range, so a shelf of thirty books becomes a shelf of thirty unrelated
 * swatches, all at the same mid-tone, all lit from nowhere.
 *
 * What the tiles are actually good for is the one thing the brush engine is
 * bad at: *high-frequency material structure with real-world statistics.* The
 * pebbling of goatskin, the slubs in linen, the comb of a marbled sheet — a
 * procedural approximation of those costs hundreds of stamps and still reads
 * as noise. So this module strips the tile down to what it is uniquely good
 * at and throws the rest away:
 *
 *   1. **Value structure** — luminance divided by the tile's own mean, giving
 *      a shading factor around 1.0. That is the grain, with the tile's
 *      arbitrary exposure removed.
 *   2. **Hue character** — the tile's chroma, renormalised to the target
 *      value, mixed in at a per-material weight. `grain` materials keep almost
 *      none of it (a red book must stay red); `figure` materials — wood,
 *      marbled paper — keep most, because their figure *is* their colour.
 *
 * The book's pigment, the room's light, and the edges all still come from the
 * brush engine painting over the top. The tile only supplies the tooth.
 *
 * ## Degrading gracefully
 *
 * Every accessor returns `null` when a tile is missing, still loading, or the
 * environment cannot decode images (Node, tests, a stripped build). Callers
 * treat that as "paint it procedurally", which is what shipped before this
 * module existed — so a missing or corrupt WebP costs texture quality and
 * nothing else. There is no code path where a missing material throws.
 */
import * as P from './brush';

/* ========================================================================== *
 * 1. Manifest
 * ========================================================================== */

/** The five families the art code asks for by name. */
export type MaterialCategory = 'leather' | 'cloth' | 'paper' | 'wood' | 'marble';

/**
 * How much of the tile's own identity survives tinting.
 * - `grain`  — structure only. The pigment owns the hue. Leather, cloth, paper.
 * - `figure` — the pattern *is* the subject. Wood grain, marbled paper.
 */
export type MaterialRole = 'grain' | 'figure';

/**
 * Per-tile painting defaults, arrived at by rendering the whole library at
 * six repeat sizes and three strengths onto a 34 px strip — real spine
 * geometry — and reading the sheet (`qa/mat/scale.png`).
 *
 * The numbers are *not* interchangeable between tiles, which is the whole
 * reason they live here rather than at the call sites. Every tile was painted
 * at 1024² by a model that had its own idea of how big a pebble is: morocco's
 * grain is ~12 tile-px across and wants a 130 px repeat to read as pebbling on
 * a spine, while the rib in `cloth-ribbed` is ~3 tile-px and disappears
 * entirely below a 200 px repeat. Ask for "leather at spine scale" and let the
 * table sort it out.
 */
export interface MaterialPaintDefaults {
  /**
   * On-screen size of one full tile repeat, in px, for a book-sized object at
   * 1× world scale. {@link materialDefaults} scales it.
   */
  tilePx: number;
  /** Multiplier on the tile's value structure. Lifts flat tiles, tames busy ones. */
  contrast: number;
  /** How much of the tile's own hue survives tinting, 0..1. */
  colourMix: number;
}

export interface MaterialEntry {
  slug: string;
  category: MaterialCategory;
  role: MaterialRole;
  /** Filename under `public/materials/`. */
  file: string;
  /** Edge length of the shipped tile in px. */
  size: number;
  /** Mean luminance of the shipped pixels — the divisor that neutralises exposure. */
  mean: number;
  /** Standard deviation of luminance — how much contrast the tile carries. */
  spread: number;
  /** Mean HSV saturation — how much hue there is to borrow. */
  saturation: number;
  /** Tuned painting defaults — see {@link MaterialPaintDefaults}. */
  paint: MaterialPaintDefaults;
}

/**
 * Mirrors `public/materials/manifest.json` (written by
 * `scripts/prepare-assets.mjs`). Kept in TypeScript as well as JSON so that
 * category lookup, seeded picking, and the unit tests all work with zero
 * network access — the JSON is the build record, this is the contract.
 * `tests/art-materials.test.ts` asserts the two agree.
 */
export const MATERIAL_MANIFEST: readonly MaterialEntry[] = [
  // Craquelure. The crack net is huge in tile space, so it needs a *large*
  // repeat to stay legible as cracks; squeeze it and it silts up into noise.
  { slug: 'leather-cracked', category: 'leather', role: 'grain', file: 'leather-cracked.webp', size: 512, mean: 0.53333, spread: 0.14209, saturation: 0.40528, paint: { tilePx: 150, contrast: 0.8, colourMix: 0.1 } },
  // The best tile in the set: tight pebbled goatskin, right at spine scale.
  { slug: 'leather-morocco', category: 'leather', role: 'grain', file: 'leather-morocco.webp', size: 512, mean: 0.48967, spread: 0.1154, saturation: 0.55479, paint: { tilePx: 130, contrast: 1, colourMix: 0.1 } },
  // Coloured slubs are linen's whole identity — it gets three times the hue
  // mix of the other grains so the flecks stay flecks and not dark specks.
  { slug: 'cloth-linen', category: 'cloth', role: 'grain', file: 'cloth-linen.webp', size: 512, mean: 0.63367, spread: 0.16191, saturation: 0.2899, paint: { tilePx: 170, contrast: 0.95, colourMix: 0.3 } },
  // Very fine warp: below a ~200 px repeat the rib mips away to nothing.
  { slug: 'cloth-ribbed', category: 'cloth', role: 'grain', file: 'cloth-ribbed.webp', size: 512, mean: 0.62206, spread: 0.18016, saturation: 0.34131, paint: { tilePx: 260, contrast: 1, colourMix: 0.12 } },
  { slug: 'paper-laid', category: 'paper', role: 'grain', file: 'paper-laid.webp', size: 512, mean: 0.72907, spread: 0.1522, saturation: 0.21837, paint: { tilePx: 200, contrast: 0.85, colourMix: 0.12 } },
  // Lowest spread in the library (0.088) — needs the contrast boost or it
  // lands as a flat fill, which is the exact failure this module exists for.
  { slug: 'vellum', category: 'paper', role: 'grain', file: 'vellum.webp', size: 512, mean: 0.68674, spread: 0.08751, saturation: 0.29918, paint: { tilePx: 150, contrast: 1.45, colourMix: 0.18 } },
  { slug: 'paper-marbled', category: 'marble', role: 'figure', file: 'paper-marbled.webp', size: 512, mean: 0.5791, spread: 0.20026, saturation: 0.50143, paint: { tilePx: 230, contrast: 0.85, colourMix: 0.62 } },
  { slug: 'wood-oak', category: 'wood', role: 'figure', file: 'wood-oak.webp', size: 512, mean: 0.54834, spread: 0.13535, saturation: 0.3773, paint: { tilePx: 300, contrast: 1, colourMix: 0.66 } },
  { slug: 'wood-walnut', category: 'wood', role: 'figure', file: 'wood-walnut.webp', size: 512, mean: 0.49364, spread: 0.18897, saturation: 0.51915, paint: { tilePx: 340, contrast: 0.9, colourMix: 0.66 } },
  { slug: 'wood-painted', category: 'wood', role: 'figure', file: 'wood-painted.webp', size: 512, mean: 0.57302, spread: 0.1893, saturation: 0.3414, paint: { tilePx: 320, contrast: 0.9, colourMix: 0.7 } },
];

/** Where the shipped tiles live, relative to the app root. */
export const MATERIAL_BASE_URL = '/materials/';

const BY_SLUG = new Map<string, MaterialEntry>(MATERIAL_MANIFEST.map((m) => [m.slug, m]));

const BY_CATEGORY: Readonly<Record<MaterialCategory, readonly string[]>> = {
  leather: MATERIAL_MANIFEST.filter((m) => m.category === 'leather').map((m) => m.slug),
  cloth: MATERIAL_MANIFEST.filter((m) => m.category === 'cloth').map((m) => m.slug),
  paper: MATERIAL_MANIFEST.filter((m) => m.category === 'paper').map((m) => m.slug),
  wood: MATERIAL_MANIFEST.filter((m) => m.category === 'wood').map((m) => m.slug),
  marble: MATERIAL_MANIFEST.filter((m) => m.category === 'marble').map((m) => m.slug),
};

/** Slugs in a category, in manifest order. Empty array for an unknown name. */
export function materialSlugs(category?: MaterialCategory): readonly string[] {
  if (category === undefined) return MATERIAL_MANIFEST.map((m) => m.slug);
  return BY_CATEGORY[category] ?? [];
}

export function materialEntry(slug: string): MaterialEntry | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * Deterministically choose a member of a category.
 *
 * Two books with the same seed pick the same leather; two books with adjacent
 * seeds usually do not, which is what stops a shelf run reading as one long
 * printed sheet.
 */
export function pickMaterialSlug(category: MaterialCategory, seed: number): string | null {
  const list = BY_CATEGORY[category];
  if (!list || list.length === 0) return null;
  // xorshift-mix so adjacent seeds do not land on adjacent indices.
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h ^= h << 13;
  h >>>= 0;
  h ^= h >>> 17;
  h ^= h << 5;
  h >>>= 0;
  return list[h % list.length];
}

/**
 * The tuned defaults for a tile, scaled to the object being painted.
 *
 * `scale` is the art layer's usual world-px → canvas-px factor, so a hi-res
 * spine bake at 2× gets a 2× repeat and the grain stays the same physical
 * size on screen at every LOD. That is the property that stops the texture
 * from crawling when the camera zooms.
 *
 * Returns a neutral default for an unknown slug rather than throwing, so a
 * hand-registered experimental tile still paints.
 */
export function materialDefaults(slug: string, scale = 1): MaterialPaintDefaults {
  const e = BY_SLUG.get(slug);
  const k = Math.max(0.15, scale);
  if (!e) return { tilePx: 200 * k, contrast: 1, colourMix: 0.15 };
  return { tilePx: e.paint.tilePx * k, contrast: e.paint.contrast, colourMix: e.paint.colourMix };
}

/* ========================================================================== *
 * 2. Decoded tiles + mip chain
 * ========================================================================== */

/**
 * One level of a tile's mip pyramid. `rgb` is straight (non-premultiplied)
 * 8-bit colour, 3 bytes per pixel; `lum` is Rec.709 luminance, 1 byte.
 *
 * Both are byte arrays rather than floats on purpose: ten 512² tiles as
 * Float32 would be 42 MB resident for textures that only ever contribute a
 * shading factor. As bytes the whole library including mips is ~14 MB.
 */
interface MipLevel {
  size: number;
  rgb: Uint8Array;
  lum: Uint8Array;
}

export interface MaterialTile {
  slug: string;
  category: MaterialCategory;
  role: MaterialRole;
  /** Edge length of level 0. Tiles are always square. */
  size: number;
  /** Mean luminance 0..1 measured from the decoded pixels. */
  mean: number;
  /** Luminance standard deviation 0..1. */
  spread: number;
  /** Mean HSV saturation 0..1. */
  saturation: number;
  /** Level 0 first, each subsequent level half the edge, down to 16². */
  levels: readonly MipLevel[];
}

const TILES = new Map<string, MaterialTile>();
/** Slugs whose load already failed, so we do not retry them every bake. */
const FAILED = new Set<string>();

let enabled = true;
/**
 * Master switch. Off = every accessor behaves as if the library were missing,
 * which is how the A/B contact sheets render the procedural control without
 * two copies of the painting code.
 */
export function setMaterialsEnabled(on: boolean): void {
  enabled = on;
}
export function materialsEnabled(): boolean {
  return enabled;
}

/** A decoded tile, or `null` if it is missing / still loading / disabled. */
export function getMaterialTile(slug: string): MaterialTile | null {
  if (!enabled) return null;
  return TILES.get(slug) ?? null;
}

/** Category lookup + seeded pick + cache read, in one call. */
export function pickMaterialTile(category: MaterialCategory, seed: number): MaterialTile | null {
  if (!enabled) return null;
  const slug = pickMaterialSlug(category, seed);
  if (slug === null) return null;
  const hit = TILES.get(slug);
  if (hit) return hit;
  // The preferred tile has not arrived; any sibling beats falling back to
  // procedural, and the choice stays deterministic because the list order is.
  for (const s of BY_CATEGORY[category]) {
    const t = TILES.get(s);
    if (t) return t;
  }
  return null;
}

/** True once at least one tile is resident. */
export function materialsReady(): boolean {
  return enabled && TILES.size > 0;
}

/** How many tiles are resident — diagnostics and tests. */
export function materialCount(): number {
  return TILES.size;
}

/** Drop every decoded tile. Tests use this; the app never needs it. */
export function clearMaterialCache(): void {
  TILES.clear();
  FAILED.clear();
  readyResolved = false;
  readyPromise = null;
}

/* ------------------------------ registration ------------------------------ */

function buildLevels(rgba: Uint8Array | Uint8ClampedArray, size: number): { levels: MipLevel[]; mean: number; spread: number; saturation: number } {
  const n = size * size;
  const rgb = new Uint8Array(n * 3);
  const lum = new Uint8Array(n);
  let sum = 0;
  let sumSq = 0;
  let satSum = 0;
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) {
    const r = rgba[j];
    const g = rgba[j + 1];
    const b = rgba[j + 2];
    rgb[k] = r;
    rgb[k + 1] = g;
    rgb[k + 2] = b;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = l > 255 ? 255 : l < 0 ? 0 : l;
    const ln = l / 255;
    sum += ln;
    sumSq += ln * ln;
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    satSum += hi <= 0 ? 0 : (hi - lo) / hi;
  }
  const mean = sum / n;

  // Box-filter pyramid. A spine 30 px wide showing a 512² tile is minifying
  // 17×; point-sampling that is pure aliasing, and the craquelure in
  // `leather-cracked` turns into a field of random black dots that crawls as
  // the camera zooms. Mips cost 33% more memory and remove the problem.
  const levels: MipLevel[] = [{ size, rgb, lum }];
  let prev = levels[0];
  while (prev.size > 16) {
    const s2 = prev.size >> 1;
    const r2 = new Uint8Array(s2 * s2 * 3);
    const l2 = new Uint8Array(s2 * s2);
    for (let y = 0; y < s2; y++) {
      for (let x = 0; x < s2; x++) {
        const a = ((y * 2) * prev.size + x * 2) * 3;
        const b = ((y * 2) * prev.size + x * 2 + 1) * 3;
        const c = ((y * 2 + 1) * prev.size + x * 2) * 3;
        const d = ((y * 2 + 1) * prev.size + x * 2 + 1) * 3;
        const o = (y * s2 + x) * 3;
        r2[o] = (prev.rgb[a] + prev.rgb[b] + prev.rgb[c] + prev.rgb[d] + 2) >> 2;
        r2[o + 1] = (prev.rgb[a + 1] + prev.rgb[b + 1] + prev.rgb[c + 1] + prev.rgb[d + 1] + 2) >> 2;
        r2[o + 2] = (prev.rgb[a + 2] + prev.rgb[b + 2] + prev.rgb[c + 2] + prev.rgb[d + 2] + 2) >> 2;
        const la = (y * 2) * prev.size + x * 2;
        l2[y * s2 + x] =
          (prev.lum[la] + prev.lum[la + 1] + prev.lum[la + prev.size] + prev.lum[la + prev.size + 1] + 2) >> 2;
      }
    }
    const level: MipLevel = { size: s2, rgb: r2, lum: l2 };
    levels.push(level);
    prev = level;
  }

  return {
    levels,
    mean,
    spread: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
    saturation: satSum / n,
  };
}

/**
 * Install a tile from raw RGBA bytes.
 *
 * The browser loader calls this after decoding a WebP; Node (tests, offline
 * tools) calls it directly with synthesised or file-decoded pixels. Anything
 * that can produce RGBA can feed the library, which is why there is no
 * image-decoding dependency in this module at all.
 *
 * A slug not in the manifest is still accepted — it just needs its category
 * and role supplied — so an experiment can register a candidate tile without
 * a rebake of the whole set.
 */
export function registerMaterialPixels(
  slug: string,
  rgba: Uint8Array | Uint8ClampedArray,
  size: number,
  meta?: { category?: MaterialCategory; role?: MaterialRole },
): MaterialTile | null {
  if (!Number.isFinite(size) || size < 2) return null;
  if (rgba.length < size * size * 4) return null;
  const entry = BY_SLUG.get(slug);
  const category = meta?.category ?? entry?.category;
  const role = meta?.role ?? entry?.role;
  if (!category || !role) return null;
  const built = buildLevels(rgba, size);
  const tile: MaterialTile = {
    slug,
    category,
    role,
    size,
    mean: built.mean,
    spread: built.spread,
    saturation: built.saturation,
    levels: built.levels,
  };
  TILES.set(slug, tile);
  FAILED.delete(slug);
  return tile;
}

/* ------------------------------- loading ---------------------------------- */

let readyPromise: Promise<void> | null = null;
let readyResolved = false;
const readyCallbacks = new Set<() => void>();

/**
 * Subscribe to "the library finished loading". Returns an unsubscribe.
 *
 * Bakes are sliced across frames and start as soon as the shelf has books, so
 * on a cold, slow disk a handful of spines can be painted before the WebPs
 * land. Those spines are correct — just procedural. A caller that wants them
 * repainted can hook this and invalidate its atlas; nothing is required to.
 */
export function onMaterialsReady(cb: () => void): () => void {
  if (readyResolved) {
    cb();
    return () => {};
  }
  readyCallbacks.add(cb);
  return () => readyCallbacks.delete(cb);
}

/** Resolves when the load settles (successfully or not). Never rejects. */
export function whenMaterialsReady(): Promise<void> {
  return preloadMaterials();
}

async function decodeOne(entry: MaterialEntry, baseUrl: string): Promise<void> {
  if (TILES.has(entry.slug) || FAILED.has(entry.slug)) return;
  try {
    const res = await fetch(`${baseUrl}${entry.file}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const size = Math.min(bitmap.width, bitmap.height);
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(size, size)
        : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = (canvas as OffscreenCanvas).getContext('2d', {
      willReadFrequently: true,
    }) as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
    const img = ctx.getImageData(0, 0, size, size);
    bitmap.close?.();
    registerMaterialPixels(entry.slug, img.data, size);
  } catch {
    // Missing, corrupt, blocked by CSP, or no canvas — all the same to us.
    FAILED.add(entry.slug);
  }
}

/**
 * Fetch and decode every shipped tile. Idempotent; concurrent callers share
 * one promise. Resolves even when every single tile fails.
 */
export function preloadMaterials(baseUrl = MATERIAL_BASE_URL): Promise<void> {
  if (readyPromise) return readyPromise;
  const canDecode =
    typeof fetch === 'function' &&
    typeof createImageBitmap === 'function' &&
    (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined');
  if (!canDecode) {
    readyResolved = true;
    readyPromise = Promise.resolve();
    return readyPromise;
  }
  readyPromise = Promise.all(MATERIAL_MANIFEST.map((e) => decodeOne(e, baseUrl)))
    .then(() => {
      readyResolved = true;
      for (const cb of readyCallbacks) {
        try {
          cb();
        } catch {
          /* a listener must never break the load */
        }
      }
      readyCallbacks.clear();
    })
    .catch(() => {
      readyResolved = true;
    });
  return readyPromise;
}

// Start the fetch the moment anything in the art layer is imported. Spines are
// baked from a sliced queue that cannot begin until books have come back from
// SQLite, so in practice the 760 KB library is resident well before the first
// bake — and if it is not, the fallback is the look that shipped before.
if (typeof window !== 'undefined') {
  void preloadMaterials();
}

/* ========================================================================== *
 * 3. Sampling
 * ========================================================================== */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Pick the mip level whose texel:pixel ratio is closest to 1. */
function levelFor(tile: MaterialTile, texelsPerPixel: number): MipLevel {
  if (!(texelsPerPixel > 1)) return tile.levels[0];
  const idx = Math.min(tile.levels.length - 1, Math.max(0, Math.round(Math.log2(texelsPerPixel))));
  return tile.levels[idx];
}

/** Bilinear wrap-around fetch. Returns luminance in 0..1 and RGB in 0..1. */
function fetchTexel(
  level: MipLevel,
  x: number,
  y: number,
  out: { r: number; g: number; b: number; l: number },
): void {
  const s = level.size;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  let x0 = Math.floor(x) % s;
  let y0 = Math.floor(y) % s;
  if (x0 < 0) x0 += s;
  if (y0 < 0) y0 += s;
  const x1 = x0 + 1 === s ? 0 : x0 + 1;
  const y1 = y0 + 1 === s ? 0 : y0 + 1;
  const i00 = y0 * s + x0;
  const i10 = y0 * s + x1;
  const i01 = y1 * s + x0;
  const i11 = y1 * s + x1;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const rgb = level.rgb;
  out.r = (rgb[i00 * 3] * w00 + rgb[i10 * 3] * w10 + rgb[i01 * 3] * w01 + rgb[i11 * 3] * w11) / 255;
  out.g = (rgb[i00 * 3 + 1] * w00 + rgb[i10 * 3 + 1] * w10 + rgb[i01 * 3 + 1] * w01 + rgb[i11 * 3 + 1] * w11) / 255;
  out.b = (rgb[i00 * 3 + 2] * w00 + rgb[i10 * 3 + 2] * w10 + rgb[i01 * 3 + 2] * w01 + rgb[i11 * 3 + 2] * w11) / 255;
  out.l = (level.lum[i00] * w00 + level.lum[i10] * w10 + level.lum[i01] * w01 + level.lum[i11] * w11) / 255;
}

export interface SampleMaterialOptions {
  /**
   * The pigment the material is dyed to. Defaults to the tile's own average
   * colour, which is only useful for a swatch — art code should always pass
   * the book's or the case's colour.
   */
  tint?: P.ColourLike;
  /**
   * How much of the tile's value structure to keep, 0..1. 0 gives a flat
   * tint; 1 gives the tile's full contrast. Default 0.75.
   */
  strength?: number;
  /**
   * How much of the tile's own hue survives, 0..1. Defaults by role:
   * 0.12 for `grain` (just enough for linen's coloured slubs to show),
   * 0.65 for `figure` (wood must look like wood).
   */
  colourMix?: number;
  /**
   * Extra multiplier on the value structure, applied before `strength`.
   * Below 1 flattens a busy tile; above 1 bites harder. Default 1.
   */
  contrast?: number;
  /**
   * World-px → canvas-px factor for the object being painted. Multiplies the
   * tile's tuned repeat so the grain keeps its physical size across LODs.
   * Ignored when `tilePx` is given explicitly. Default 1.
   */
  scale?: number;
  /**
   * On-screen size, in output px, of one full tile repeat. Defaults to this
   * tile's tuned repeat from {@link MATERIAL_MANIFEST} times `scale` — a
   * spine wants ~130 px of morocco so its pebbling is pebbling, not boulders.
   */
  tilePx?: number;
  /** Independent horizontal repeat size; defaults to `tilePx`. */
  tilePxX?: number;
  /** Independent vertical repeat size; defaults to `tilePx`. */
  tilePxY?: number;
  /** Quarter-turns applied to the tile before sampling. Default 0. */
  rotate?: 0 | 90 | 180 | 270;
  /** Mirror the tile horizontally / vertically. */
  flipX?: boolean;
  flipY?: boolean;
  /** Crop offset in tile-space units (1 = one full repeat). */
  offsetX?: number;
  offsetY?: number;
  /**
   * When no explicit offset is given, this seeds a stable pseudo-random crop
   * so two neighbouring books cut different parts of the same sheet.
   */
  seed?: number;
  /** Output alpha, 0..1. Default 1. */
  alpha?: number;
  /**
   * Per-pixel weight in output coordinates, 0..1 — for feathering a material
   * in over a painted underlayer rather than dropping it on like a decal.
   */
  gradient?: (x: number, y: number) => number;
  /** Value floor, so a dark tile region never crushes to pure black. 0.04. */
  floor?: number;
  /** Value ceiling relative to the tint. Default 2.6. */
  ceiling?: number;
}

function hashSeed(seed: number): number {
  let h = (seed | 0) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Paint a rectangle of tinted material into a fresh {@link P.Surface}.
 *
 * The returned surface is ordinary paint: `compositeSurface` it, `glaze` over
 * it, `clipToMask` it to a silhouette, `scumble` brush marks on top. It is
 * *not* a texture the compositor has to know about — by the time it reaches
 * the canvas it has been through the same passes every other painted mass has.
 *
 * Returns `null` when the tile is unavailable, which is the caller's cue to
 * paint the material procedurally instead.
 */
export function sampleMaterial(
  source: MaterialTile | string,
  width: number,
  height: number,
  opts: SampleMaterialOptions = {},
): P.Surface | null {
  const tile = typeof source === 'string' ? getMaterialTile(source) : enabled ? source : null;
  if (!tile) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const tuned = materialDefaults(tile.slug, opts.scale ?? 1);
  const strength = clamp01(opts.strength ?? 0.75);
  const contrast = Math.max(0, opts.contrast ?? tuned.contrast);
  const colourMix = clamp01(opts.colourMix ?? tuned.colourMix);
  const alpha = clamp01(opts.alpha ?? 1);
  const floor = Math.max(0, opts.floor ?? 0.04);
  const ceiling = Math.max(1.05, opts.ceiling ?? 2.6);

  const tint = P.parseColour(opts.tint ?? '#8a8378');
  const tintL = Math.max(0.012, 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b);

  const repX = Math.max(4, opts.tilePxX ?? opts.tilePx ?? tuned.tilePx);
  const repY = Math.max(4, opts.tilePxY ?? opts.tilePx ?? tuned.tilePx);
  const rot = opts.rotate ?? 0;
  const flipX = opts.flipX === true;
  const flipY = opts.flipY === true;

  const hs = hashSeed(opts.seed ?? 0);
  const offX = opts.offsetX ?? (hs & 0xffff) / 0xffff;
  const offY = opts.offsetY ?? ((hs >>> 16) & 0xffff) / 0xffff;

  // Texels consumed per output pixel decides the mip; take the worse axis so a
  // stretched tile never aliases on its tight direction.
  const level = levelFor(tile, Math.max(tile.size / repX, tile.size / repY));
  const sx = level.size / repX;
  const sy = level.size / repY;
  const baseX = offX * level.size;
  const baseY = offY * level.size;

  const surface = P.createSurface(w, h);
  const d = surface.data;
  const mean = Math.max(0.02, tile.mean);
  const texel = { r: 0, g: 0, b: 0, l: 0 };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = alpha;
      if (opts.gradient) {
        a *= clamp01(opts.gradient(x, y));
        if (a <= 0.002) continue;
      }

      // Output → tile space, with the quarter-turn and mirrors folded in.
      let u = x * sx;
      let v = y * sy;
      if (flipX) u = -u;
      if (flipY) v = -v;
      let tu: number;
      let tv: number;
      switch (rot) {
        case 90:
          tu = -v;
          tv = u;
          break;
        case 180:
          tu = -u;
          tv = -v;
          break;
        case 270:
          tu = v;
          tv = -u;
          break;
        default:
          tu = u;
          tv = v;
      }
      fetchTexel(level, tu + baseX, tv + baseY, texel);

      // 1. Value structure, exposure removed: 1.0 is "average for this tile".
      let k = texel.l / mean;
      k = 1 + (k - 1) * contrast * strength;
      if (k < floor) k = floor;
      else if (k > ceiling) k = ceiling;

      // 2. Hue: the tile's colour renormalised to the tint's value, so mixing
      //    it in changes chroma without dragging the value around.
      let br = tint.r;
      let bg = tint.g;
      let bb = tint.b;
      if (colourMix > 0) {
        const tl = Math.max(0.02, texel.l);
        const norm = tintL / tl;
        const or_ = texel.r * norm;
        const og = texel.g * norm;
        const ob = texel.b * norm;
        br += (or_ - br) * colourMix;
        bg += (og - bg) * colourMix;
        bb += (ob - bb) * colourMix;
      }

      const i = (y * w + x) * 4;
      d[i] = clamp01(br * k) * a;
      d[i + 1] = clamp01(bg * k) * a;
      d[i + 2] = clamp01(bb * k) * a;
      d[i + 3] = a;
    }
  }
  return surface;
}

/* ========================================================================== *
 * 4. materialBase — the one call the art code actually makes
 * ========================================================================== */

export interface MaterialBaseOptions extends SampleMaterialOptions {
  /**
   * Which family to draw from. A specific `slug` overrides it.
   */
  category?: MaterialCategory;
  /** Force one particular tile. */
  slug?: string;
  /** Blend used to lay the material over what is already there. Default 'normal'. */
  blend?: P.BlendMode;
  /**
   * Feather, in px, of the mask edge. The material is clipped by mask
   * coverage; this softens the last few px so it never leaves a hard rim
   * inside the painted silhouette. Default 1.
   */
  feather?: number;
  /** Offset of the mask/material rect within the surface. Default 0,0. */
  originX?: number;
  originY?: number;
}

/**
 * Lay a tinted material over an already-blocked-in mass, clipped to its mask.
 *
 * Returns `true` if a real material was used and `false` if the library had
 * nothing to offer — the caller's signal to run its procedural passes at full
 * strength rather than the reduced strength it uses over a material base.
 *
 * Deliberately *not* a replacement for the block-in: the underpainting's hue
 * and value drift still shows through wherever the material's alpha or the
 * blend lets it, which is what keeps two books in the same leather from being
 * the same book.
 */
export function materialBase(
  surface: P.Surface,
  mask: P.Mask | null,
  opts: MaterialBaseOptions = {},
): boolean {
  if (!enabled) return false;
  const tile = opts.slug
    ? getMaterialTile(opts.slug)
    : opts.category
      ? pickMaterialTile(opts.category, opts.seed ?? 0)
      : null;
  if (!tile) return false;

  const ox = Math.round(opts.originX ?? (mask ? mask.x : 0));
  const oy = Math.round(opts.originY ?? (mask ? mask.y : 0));
  const w = mask ? mask.width : surface.width;
  const h = mask ? mask.height : surface.height;
  if (w <= 0 || h <= 0) return false;

  const patch = sampleMaterial(tile, w, h, opts);
  if (!patch) return false;

  const blend = opts.blend ?? 'normal';
  const feather = Math.max(0.01, opts.feather ?? 1);

  if (!mask) {
    P.compositeSurface(surface, patch, ox, oy, 1, blend);
    return true;
  }

  // Multiply the patch's alpha by mask coverage before compositing, so the
  // material stops exactly where the painted mass does — including the
  // noise-displaced boundary `clipToMask` gave the mass.
  const cov = mask.coverage;
  const pd = patch.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cov[y * mask.width + x];
      const k = feather >= 1 ? c : clamp01(c / feather);
      const i = (y * w + x) * 4;
      pd[i] *= k;
      pd[i + 1] *= k;
      pd[i + 2] *= k;
      pd[i + 3] *= k;
    }
  }
  P.compositeSurface(surface, patch, ox, oy, 1, blend);
  return true;
}

/**
 * Draw a tinted material straight onto a 2D canvas context.
 *
 * The pre-brush renderers (covers, case joinery, backdrops) are canvas-native
 * and are not going to be rewritten as surface stacks; this gives them the
 * same material base without that rewrite. Returns `false` when nothing was
 * available, exactly like {@link materialBase}.
 */
export function drawMaterialRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: MaterialBaseOptions & { globalAlpha?: number; composite?: GlobalCompositeOperation } = {},
): boolean {
  if (!enabled) return false;
  const tile = opts.slug
    ? getMaterialTile(opts.slug)
    : opts.category
      ? pickMaterialTile(opts.category, opts.seed ?? 0)
      : null;
  if (!tile) return false;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const patch = sampleMaterial(tile, w, h, opts);
  if (!patch) return false;

  const rgba = P.surfaceToRGBA8(patch);
  let img: ImageData;
  try {
    img = new ImageData(rgba, w, h);
  } catch {
    return false;
  }
  // `putImageData` ignores transform and composite mode, so route through a
  // scratch canvas — the same trick `brush.drawSurface` uses.
  const scratch =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const sctx = (scratch as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!sctx) return false;
  sctx.putImageData(img, 0, 0);

  ctx.save();
  if (opts.composite) ctx.globalCompositeOperation = opts.composite;
  if (opts.globalAlpha !== undefined) ctx.globalAlpha = clamp01(opts.globalAlpha);
  ctx.drawImage(scratch as unknown as CanvasImageSource, x, y);
  ctx.restore();
  return true;
}

/**
 * Average colour of a tile — for a swatch, a legend, or a fallback tint.
 * `null` when the tile is not resident.
 */
export function materialAverageColour(slug: string): P.Rgb | null {
  const tile = getMaterialTile(slug);
  if (!tile) return null;
  const top = tile.levels[tile.levels.length - 1];
  let r = 0;
  let g = 0;
  let b = 0;
  const n = top.size * top.size;
  for (let i = 0; i < n; i++) {
    r += top.rgb[i * 3];
    g += top.rgb[i * 3 + 1];
    b += top.rgb[i * 3 + 2];
  }
  return { r: r / n / 255, g: g / n / 255, b: b / n / 255 };
}
