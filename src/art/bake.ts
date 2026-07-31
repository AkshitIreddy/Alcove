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
 * v3: magical-library overhaul — richer wood grain, joinery pegs, gold
 *     pinstripes, carved cornice, damask wallpaper tile, shelf props.
 */
export const RECIPE_VERSION = 3;

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

/* ------------------------------ profiling -------------------------------- */

/** One timed unit of bake work (a disk read or a producer run). */
export interface BakeSample {
  /** Truncated params (first 96 chars) — enough to identify the art piece. */
  what: string;
  ms: number;
  /** 'disk' = read back from the PNG cache; 'bake' = the producer ran. */
  kind: 'disk' | 'bake' | 'spine';
  at: number;
}

/**
 * Ring buffer of recent bake timings. Always on (numbers only, capped) so the
 * diagnostics log and the perf HUD can read it; exposed on globalThis for QA
 * probes when any ?fx= / ?bakeprof= flag is present.
 */
const PROFILE_CAP = 600;
const bakeSamples: BakeSample[] = [];

export function recordBakeSample(sample: BakeSample): void {
  bakeSamples.push(sample);
  if (bakeSamples.length > PROFILE_CAP) bakeSamples.splice(0, bakeSamples.length - PROFILE_CAP);
}

export function bakeProfile(): readonly BakeSample[] {
  return bakeSamples;
}

if (typeof location !== 'undefined' && /[?&](fx|bakeprof)=/.test(location.search)) {
  (globalThis as Record<string, unknown>)['__bakeProfile'] = bakeSamples;
}

/** Drop every in-memory entry (debug/tests). Does not touch the disk cache. */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

/* --------------------------- cooperative pump ----------------------------- */

/**
 * Art producers are heavy SYNCHRONOUS canvas work. Nothing stopped a dozen of
 * them resuming inside one microtask drain, which is how a cold cache used to
 * pin the main thread for a minute-plus with a white, unresponsive window.
 *
 * Every cache miss now waits its turn here. The pump runs at most ONE producer
 * per idle callback, so:
 *   - a producer can never chain onto the previous one inside a single task;
 *   - the browser gets a paint + input opportunity between every two bakes;
 *   - the worst-case block is one producer, not the whole storm.
 *
 * The `timeout` on requestIdleCallback guarantees progress on a thread that
 * never actually goes idle (the shelf renders continuously while art lands),
 * and the setTimeout fallback covers Safari/workers/vitest.
 *
 * Re-entrancy is safe: a producer that awaits another bakeCached simply queues
 * behind the pump and suspends — it holds no lock, so there is no deadlock.
 */
const PUMP_IDLE_TIMEOUT_MS = 90;

const pumpQueue: Array<() => void> = [];
let pumpScheduled = false;

function scheduleIdleTurn(cb: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => cb(), { timeout: PUMP_IDLE_TIMEOUT_MS });
    return;
  }
  setTimeout(cb, 0);
}

function pump(): void {
  if (pumpScheduled || pumpQueue.length === 0) return;
  pumpScheduled = true;
  scheduleIdleTurn(() => {
    pumpScheduled = false;
    // Release exactly one waiter. Its continuation (the producer) runs in this
    // task's microtask drain; the next waiter gets a fresh idle callback.
    pumpQueue.shift()?.();
    pump();
  });
}

/**
 * Resolve on the next idle turn, one caller per turn. Exported so other
 * bake-time producers (spine atlas slices) can share the same fairness queue.
 */
export function awaitBakeTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    pumpQueue.push(resolve);
    pump();
  });
}

/** How many producers are still waiting for a turn (perf HUD / QA probes). */
export function pendingBakeTurns(): number {
  return pumpQueue.length;
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
    const t0 = performance.now();
    const fromDisk = await readDiskCache(key);
    if (fromDisk) {
      recordBakeSample({ what: params.slice(0, 96), ms: performance.now() - t0, kind: 'disk', at: t0 });
      return fromDisk;
    }

    // Wait for a turn so this producer's synchronous cost lands in a task of
    // its own rather than chaining onto whatever bake just finished.
    await awaitBakeTurn();
    const t1 = performance.now();
    const canvas = await produce();
    recordBakeSample({ what: params.slice(0, 96), ms: performance.now() - t1, kind: 'bake', at: t1 });
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
