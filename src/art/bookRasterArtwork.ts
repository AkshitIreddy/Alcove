/**
 * Runtime bridge for generated book artwork.
 *
 * Image generation happens offline. The shipped PNGs stay untouched on disk;
 * this module decodes them once, reduces oversized sources to a bounded
 * in-memory working copy, discovers their true alpha bounds, and prepares a
 * single-ink version for the canvas painters. Both the DOM renderer and the
 * OffscreenCanvas spine worker run this exact module in their own realm.
 *
 * The painter is deliberately synchronous. Call `preloadBookRasterArtwork`
 * before rendering, then a hot draw is only a cache lookup and one `drawImage`.
 * No filters, blend modes, lighting passes, network reads or pixel loops occur
 * inside `paintBookRasterArtwork`.
 */

import type { FlatCtx } from './flat';

const generatedUrls = import.meta.glob<string>(
  '../../assets/book-art/imagegen/{emblems,frames,titles}/*.png',
  { eager: true, query: '?url', import: 'default' },
);

export type BookRasterArtworkCategory = 'emblems' | 'frames' | 'titles';

export interface BookRasterArtworkManifestEntry {
  /** Stable runtime id, for example `emblems/tudor-crown`. */
  readonly id: string;
  readonly category: BookRasterArtworkCategory;
  readonly url: string;
}

function manifestEntry(path: string, url: string): BookRasterArtworkManifestEntry {
  const match = /\/imagegen\/(emblems|frames|titles)\/([^/]+)\.png$/i.exec(path.replace(/\\/g, '/'));
  if (!match) throw new Error(`bookRasterArtwork: unsupported generated asset path ${path}`);
  const category = match[1]!.toLowerCase() as BookRasterArtworkCategory;
  return Object.freeze({ id: `${category}/${match[2]}`, category, url });
}

/**
 * Build-time manifest. Adding a PNG beneath one of the three imagegen folders
 * is enough for Vite to include it in the main bundle and the module worker.
 */
export const BOOK_RASTER_ARTWORK_MANIFEST: readonly BookRasterArtworkManifestEntry[] =
  Object.freeze(
    Object.entries(generatedUrls)
      .map(([path, url]) => manifestEntry(path, url))
      // Generation intermediates use an explicit suffix and are never runtime
      // identities. Only the final unsuffixed master is bundled and preloaded.
      .filter((entry) => !/-alpha$/i.test(entry.id))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

const manifestById = new Map<string, BookRasterArtworkManifestEntry>();
for (const entry of BOOK_RASTER_ARTWORK_MANIFEST) {
  if (manifestById.has(entry.id)) {
    throw new Error(`bookRasterArtwork: duplicate generated asset id ${entry.id}`);
  }
  manifestById.set(entry.id, entry);
}

export interface BookRasterAlphaBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type RasterCanvas = HTMLCanvasElement | OffscreenCanvas;

interface DecodedRasterArtwork {
  readonly canvas: RasterCanvas;
  readonly width: number;
  readonly height: number;
  readonly bounds: BookRasterAlphaBounds;
}

export interface PreparedBookRasterArtwork {
  readonly id: string;
  /** Full bounded working canvas. The alpha bounds below are its source crop. */
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly bounds: BookRasterAlphaBounds;
  /** Normalized `#rrggbbaa`, used as part of the memory-cache key. */
  readonly colour: string;
}

export interface PaintBookRasterArtworkOptions {
  /** Preserve aspect ratio inside the box by default. */
  readonly fit?: 'contain' | 'cover' | 'stretch';
  /** 0 = left, .5 = centre, 1 = right. */
  readonly alignX?: number;
  /** 0 = top, .5 = centre, 1 = bottom. */
  readonly alignY?: number;
}

/** Three flat semantic roles used by generated title furniture. */
export interface BookRasterArtworkPalette {
  readonly ground: string;
  readonly ink: string;
  readonly tooling: string;
}

/** A monochrome tool or a title-furniture three-role palette. */
export type BookRasterArtworkColours = string | BookRasterArtworkPalette;

export interface PreloadBookRasterArtworkOptions {
  /** Discard every decoded and recoloured working copy before loading. */
  readonly force?: boolean;
}

const MAX_WORKING_EDGE = 512;
/** At most 64 tinted 512px canvases (~64 MiB worst case) per JS realm. */
export const BOOK_RASTER_RECOLOUR_CACHE_LIMIT = 64;
let decodedById = new Map<string, DecodedRasterArtwork>();
let preparedByKey = new Map<string, PreparedBookRasterArtwork>();
let preloadInFlight: Promise<void> | null = null;
let cacheGeneration = 0;

function makeCanvas(width: number, height: number): RasterCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('bookRasterArtwork: no canvas implementation available');
}

function context2d(canvas: RasterCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('bookRasterArtwork: 2d context unavailable');
  return ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

/** Pure alpha scan, exported so asset QA can validate transparent masters. */
export function alphaBoundsFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BookRasterAlphaBounds | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (rgba.length < width * height * 4) return null;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < left || bottom < top
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

interface InkRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  readonly key: string;
}

interface ParsedArtworkPalette {
  readonly ground: InkRgba;
  readonly ink: InkRgba;
  readonly tooling: InkRgba;
  readonly key: string;
}

function inkChannel(pair: string): number {
  return Number.parseInt(pair, 16);
}

/** Normalize the explicit hex colours used by the flat-art palette. */
function parseInkColour(value: string): InkRgba {
  const raw = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3}|[0-9a-f]{4})$/.exec(raw)?.[1];
  const expanded = short === undefined
    ? raw
    : `#${[...short].map((digit) => digit + digit).join('')}`;
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(expanded);
  if (!match) throw new Error(`bookRasterArtwork: ink must be #rgb, #rgba, #rrggbb or #rrggbbaa; got ${value}`);
  const rgb = match[1]!;
  const alpha = match[2] ?? 'ff';
  return {
    r: inkChannel(rgb.slice(0, 2)),
    g: inkChannel(rgb.slice(2, 4)),
    b: inkChannel(rgb.slice(4, 6)),
    a: inkChannel(alpha),
    key: `#${rgb}${alpha}`,
  };
}

function parseArtworkColours(value: BookRasterArtworkColours): InkRgba | ParsedArtworkPalette {
  if (typeof value === 'string') return parseInkColour(value);
  const ground = parseInkColour(value.ground);
  const ink = parseInkColour(value.ink);
  const tooling = parseInkColour(value.tooling);
  return {
    ground,
    ink,
    tooling,
    key: `palette:${ground.key}|${ink.key}|${tooling.key}`,
  };
}

const SOURCE_ROLE_REFERENCES = {
  ground: [0xf2, 0xe6, 0xce],
  ink: [0x43, 0x29, 0x34],
  tooling: [0xc5, 0xa4, 0x65],
} as const;

function colourDistanceSquared(
  r: number,
  g: number,
  b: number,
  reference: readonly [number, number, number],
): number {
  const dr = r - reference[0];
  const dg = g - reference[1];
  const db = b - reference[2];
  return dr * dr + dg * dg + db * db;
}

function nearestPaletteRole(
  r: number,
  g: number,
  b: number,
  palette: ParsedArtworkPalette,
): InkRgba {
  const groundDistance = colourDistanceSquared(r, g, b, SOURCE_ROLE_REFERENCES.ground);
  const inkDistance = colourDistanceSquared(r, g, b, SOURCE_ROLE_REFERENCES.ink);
  const toolingDistance = colourDistanceSquared(r, g, b, SOURCE_ROLE_REFERENCES.tooling);
  if (groundDistance <= inkDistance && groundDistance <= toolingDistance) return palette.ground;
  return inkDistance <= toolingDistance ? palette.ink : palette.tooling;
}

interface RasterDimensions {
  readonly width: number;
  readonly height: number;
}

/** Read PNG IHDR dimensions without paying for a full-resolution decode. */
async function pngDimensions(blob: Blob, id: string): Promise<RasterDimensions> {
  const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  const validSignature = pngSignature.every((value, index) => bytes[index] === value);
  const validIhdr = bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82;
  if (bytes.length < 24 || !validSignature || !validIhdr) {
    throw new Error(`bookRasterArtwork: ${id} is not a valid PNG with an IHDR header`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) {
    throw new Error(`bookRasterArtwork: ${id} declares invalid dimensions ${width}x${height}`);
  }
  return { width, height };
}

async function decodeAsset(entry: BookRasterArtworkManifestEntry): Promise<DecodedRasterArtwork> {
  let response: Response;
  try {
    // Dev manifests use root-relative URLs. Resolve against this module rather
    // than the realm's location: a blob-backed module worker has a `blob:`
    // global URL even though this imported module still has an HTTP URL.
    response = await fetch(new URL(entry.url, import.meta.url).href);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`bookRasterArtwork: ${entry.id} failed to load: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`bookRasterArtwork: ${entry.id} failed to load (${response.status})`);
  }
  const blob = await response.blob();
  if (typeof createImageBitmap !== 'function') {
    throw new Error(`bookRasterArtwork: createImageBitmap unavailable while loading ${entry.id}`);
  }
  const sourceSize = await pngDimensions(blob, entry.id);
  const scale = Math.min(1, MAX_WORKING_EDGE / Math.max(sourceSize.width, sourceSize.height));
  const width = Math.max(1, Math.round(sourceSize.width * scale));
  const height = Math.max(1, Math.round(sourceSize.height * scale));
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`bookRasterArtwork: ${entry.id} is not a decodable PNG: ${detail}`);
  }
  try {
    const canvas = makeCanvas(width, height);
    const ctx = context2d(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    let hasTransparency = false;
    for (let i = 3; i < pixels.data.length; i += 4) {
      if (pixels.data[i] !== 255) {
        hasTransparency = true;
        break;
      }
    }
    if (!hasTransparency) {
      throw new Error(
        `bookRasterArtwork: ${entry.id} is fully opaque; export the final master with a transparent background`,
      );
    }
    const bounds = alphaBoundsFromRgba(pixels.data, width, height);
    if (bounds === null) throw new Error(`bookRasterArtwork: ${entry.id} has no visible alpha pixels`);
    return { canvas, width, height, bounds };
  } finally {
    bitmap.close();
  }
}

async function loadBatch(ids: readonly string[], generation: number): Promise<void> {
  const staged = new Map<string, DecodedRasterArtwork>();
  try {
    const loaded = await Promise.all(ids.map(async (id) => {
      const entry = manifestById.get(id);
      if (entry === undefined) throw new Error(`bookRasterArtwork: unknown asset ${id}`);
      return [id, await decodeAsset(entry)] as const;
    }));
    for (const [id, decoded] of loaded) staged.set(id, decoded);
    // A force reload may have started while these network reads were pending.
    // In that case this batch belongs to the old generation and must never
    // repopulate the cache with stale pixels.
    if (generation === cacheGeneration) {
      decodedById = new Map([...decodedById, ...staged]);
    }
  } catch (error) {
    // A partial generation must never coexist with pixels from the previous
    // generation. Drop every working copy and leave the preload retriable.
    clearBookRasterArtworkCache();
    throw error;
  }
}

/** Stable ids, optionally restricted to one folder/category. */
export function bookRasterArtworkIds(
  category?: BookRasterArtworkCategory,
): readonly string[] {
  return BOOK_RASTER_ARTWORK_MANIFEST
    .filter((entry) => category === undefined || entry.category === category)
    .map((entry) => entry.id);
}

/**
 * Decode requested masters before any synchronous painter uses them.
 * Concurrent callers serialize through one promise; failures clear that
 * promise and all pixel caches, so the next request can retry cleanly.
 */
export async function preloadBookRasterArtwork(
  ids: readonly string[] = bookRasterArtworkIds(),
  options: PreloadBookRasterArtworkOptions = {},
): Promise<void> {
  if (options.force) clearBookRasterArtworkCache();
  if (preloadInFlight !== null) {
    await preloadInFlight;
    return preloadBookRasterArtwork(ids);
  }
  const requested = [...new Set(ids)];
  for (const id of requested) {
    if (!manifestById.has(id)) throw new Error(`bookRasterArtwork: unknown asset ${id}`);
  }
  const missing = requested.filter((id) => !decodedById.has(id));
  if (missing.length === 0) return;
  const current = loadBatch(missing, cacheGeneration);
  preloadInFlight = current;
  try {
    await current;
  } finally {
    if (preloadInFlight === current) preloadInFlight = null;
  }
}

/**
 * Return a synchronous single-ink working image, or undefined until its
 * master has been preloaded. RGB conversion is direct pixel replacement;
 * source alpha and optional ink alpha are multiplied exactly once.
 */
export function getBookRasterArtwork(
  id: string,
  colour: BookRasterArtworkColours,
): PreparedBookRasterArtwork | undefined {
  const decoded = decodedById.get(id);
  if (decoded === undefined) return undefined;
  const colours = parseArtworkColours(colour);
  const key = `${id}|${colours.key}`;
  const cached = preparedByKey.get(key);
  if (cached !== undefined) {
    // Map insertion order is the LRU order. Touch without reallocating pixels.
    preparedByKey.delete(key);
    preparedByKey.set(key, cached);
    return cached;
  }

  const sourceCtx = context2d(decoded.canvas);
  const pixels = sourceCtx.getImageData(0, 0, decoded.width, decoded.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const sourceAlpha = data[i + 3]!;
    const target = 'ground' in colours
      ? nearestPaletteRole(data[i]!, data[i + 1]!, data[i + 2]!, colours)
      : colours;
    data[i] = target.r;
    data[i + 1] = target.g;
    data[i + 2] = target.b;
    data[i + 3] = Math.round((sourceAlpha * target.a) / 255);
  }
  const canvas = makeCanvas(decoded.width, decoded.height);
  context2d(canvas).putImageData(pixels, 0, 0);
  const prepared: PreparedBookRasterArtwork = Object.freeze({
    id,
    source: canvas as CanvasImageSource,
    width: decoded.width,
    height: decoded.height,
    bounds: decoded.bounds,
    colour: colours.key,
  });
  while (preparedByKey.size >= BOOK_RASTER_RECOLOUR_CACHE_LIMIT) {
    const oldest = preparedByKey.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    preparedByKey.delete(oldest);
  }
  preparedByKey.set(key, prepared);
  return prepared;
}

function clamp01(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value as number));
}

/**
 * Paint one preloaded master. The true alpha bounds are passed as the source
 * rectangle to `drawImage`, so arbitrary transparent generation margins do
 * not shrink the motif or require rewriting the PNG file.
 */
export function paintBookRasterArtwork(
  ctx: FlatCtx,
  id: string,
  colour: BookRasterArtworkColours,
  x: number,
  y: number,
  width: number,
  height: number,
  options: PaintBookRasterArtworkOptions = {},
): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  // Geometry contract tests use a deliberately tiny recording context with no
  // bitmap surface. Missing drawImage means "use the vector fallback", not a
  // broken generated master.
  if (typeof (ctx as { drawImage?: unknown }).drawImage !== 'function') return false;
  const prepared = getBookRasterArtwork(id, colour);
  if (prepared === undefined) return false;
  const source = prepared.bounds;
  const fit = options.fit ?? 'contain';
  let drawWidth = width;
  let drawHeight = height;
  if (fit !== 'stretch') {
    const scale = fit === 'cover'
      ? Math.max(width / source.width, height / source.height)
      : Math.min(width / source.width, height / source.height);
    drawWidth = source.width * scale;
    drawHeight = source.height * scale;
  }
  const drawX = x + (width - drawWidth) * clamp01(options.alignX, 0.5);
  const drawY = y + (height - drawHeight) * clamp01(options.alignY, 0.5);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    prepared.source,
    source.x,
    source.y,
    source.width,
    source.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );
  ctx.restore();
  return true;
}

/** Discard all realm-local decoded and recoloured working copies. */
export function clearBookRasterArtworkCache(): void {
  cacheGeneration++;
  decodedById.clear();
  preparedByKey.clear();
  preloadInFlight = null;
}

export function bookRasterArtworkStatus(): Readonly<{
  manifest: number;
  decoded: number;
  recoloured: number;
  decodedBytes: number;
  recolouredBytes: number;
  recolourLimit: number;
}> {
  const decodedBytes = [...decodedById.values()]
    .reduce((total, asset) => total + asset.width * asset.height * 4, 0);
  const recolouredBytes = [...preparedByKey.values()]
    .reduce((total, asset) => total + asset.width * asset.height * 4, 0);
  return Object.freeze({
    manifest: BOOK_RASTER_ARTWORK_MANIFEST.length,
    decoded: decodedById.size,
    recoloured: preparedByKey.size,
    decodedBytes,
    recolouredBytes,
    recolourLimit: BOOK_RASTER_RECOLOUR_CACHE_LIMIT,
  });
}
