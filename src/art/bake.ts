/**
 * art/bake.ts — the ONLY place SVG filters are ever evaluated.
 *
 * Pipeline (per art-pipeline.md): serialize a self-contained SVG string
 * (art + <defs><filter>), load it as an Image via a blob URL, draw to an
 * OffscreenCanvas at the bake scale, transfer to ImageBitmap.
 *
 * Disk cache: baked canvases are persisted as PNG to
 * `appCacheDir()/art/{fnv1a(RECIPE_VERSION + params + dpr)}.png` via
 * @tauri-apps/plugin-fs, so the filter cost is paid once ever per
 * RECIPE_VERSION × params × DPR. Outside Tauri (plain vite dev in a browser,
 * vitest) every fs call degrades gracefully to the in-memory Map cache.
 */

import { BaseDirectory, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { fnv1a } from './noise';

/**
 * Bump to invalidate every disk-cached raster (recipe/parameter changes,
 * Chromium feTurbulence drift, etc.).
 * v2: under-plank shadow became a gradient strip; case back/rail/crown added.
 */
export const RECIPE_VERSION = 2;

const ART_DIR = 'art';

/** Cache key: fnv1a of (RECIPE_VERSION + params + dpr), as fixed-width hex. */
export function cacheKey(params: string, dpr: number): string {
  return fnv1a(`${RECIPE_VERSION}|${params}|${dpr}`).toString(16).padStart(8, '0');
}

/**
 * Rasterize a self-contained SVG string into an OffscreenCanvas at `scale`.
 * Internal building block for bakeSvg and for producers that post-process
 * the raster (tinting, compositing) before it is cached/transferred.
 */
export async function rasterizeSvg(
  svg: string,
  w: number,
  h: number,
  scale: number,
): Promise<OffscreenCanvas> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('bake: OffscreenCanvas 2d context unavailable');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Bake an SVG string to an ImageBitmap — the doc recipe, verbatim.
 * Uncached; prefer bakeCached for anything keyed and reusable.
 */
export async function bakeSvg(
  svg: string,
  w: number,
  h: number,
  scale: number,
): Promise<ImageBitmap> {
  const c = await rasterizeSvg(svg, w, h, scale);
  return c.transferToImageBitmap();
}

/* ------------------------------ disk cache ------------------------------- */

function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] !== undefined
  );
}

/** false once any fs interaction fails — from then on, memory cache only. */
let diskEnabled = isTauri();
let artDirReady: Promise<void> | null = null;

function ensureArtDir(): Promise<void> {
  artDirReady ??= mkdir(ART_DIR, { baseDir: BaseDirectory.AppCache, recursive: true });
  return artDirReady;
}

async function readDiskCache(key: string): Promise<ImageBitmap | null> {
  if (!diskEnabled) return null;
  try {
    await ensureArtDir();
  } catch {
    diskEnabled = false;
    return null;
  }
  try {
    const bytes = await readFile(`${ART_DIR}/${key}.png`, { baseDir: BaseDirectory.AppCache });
    return await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  } catch {
    // Plain cache miss (or unreadable/corrupt file) — fall through to a bake.
    return null;
  }
}

async function writeDiskCache(key: string, blob: Blob): Promise<void> {
  if (!diskEnabled) return;
  try {
    await ensureArtDir();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(`${ART_DIR}/${key}.png`, bytes, { baseDir: BaseDirectory.AppCache });
  } catch {
    diskEnabled = false;
  }
}

/* ----------------------------- memory cache ------------------------------ */

/**
 * Promise-valued so concurrent requests for the same key share one bake.
 * The resolved ImageBitmaps are shared — callers must never close() them.
 */
const memoryCache = new Map<string, Promise<ImageBitmap>>();

/** Drop every in-memory entry (debug/tests). Does not touch the disk cache. */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

/** A producer bakes the raster for a cache miss and hands back its canvas. */
export type CanvasProducer = () => Promise<OffscreenCanvas>;

/**
 * The cached bake path used by paper.ts / wood.ts / other bakers:
 *  1. in-memory Map hit → shared ImageBitmap
 *  2. disk hit → readFile → createImageBitmap
 *  3. miss → produce() → convertToBlob → writeFile (best-effort) →
 *     transferToImageBitmap
 */
export function bakeCached(
  params: string,
  dpr: number,
  produce: CanvasProducer,
): Promise<ImageBitmap> {
  const key = cacheKey(params, dpr);
  const hit = memoryCache.get(key);
  if (hit) return hit;

  const pending = (async () => {
    const fromDisk = await readDiskCache(key);
    if (fromDisk) return fromDisk;

    const canvas = await produce();
    if (diskEnabled) {
      // convertToBlob MUST precede transferToImageBitmap (transfer detaches
      // the canvas bitmap). The write itself is fire-and-forget.
      try {
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        void writeDiskCache(key, blob);
      } catch {
        diskEnabled = false;
      }
    }
    return canvas.transferToImageBitmap();
  })();

  // Do not poison the cache with rejected bakes.
  const wrapped = pending.catch((err: unknown) => {
    memoryCache.delete(key);
    throw err;
  });
  memoryCache.set(key, wrapped);
  return wrapped;
}

/**
 * Convenience: cached bake of a filtered SVG document (the common case).
 * `params` must uniquely describe the SVG content and target size.
 */
export function bakeSvgCached(
  params: string,
  dpr: number,
  svg: string,
  w: number,
  h: number,
): Promise<ImageBitmap> {
  return bakeCached(params, dpr, () => rasterizeSvg(svg, w, h, dpr));
}
