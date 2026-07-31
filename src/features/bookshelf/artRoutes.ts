/**
 * features/bookshelf/artRoutes.ts — which baked recipes can be painted
 * off-thread, and how.
 *
 * `bake.ts` is the one door every piece of baked art walks through, and it
 * accepts a single {@link BakeOffloader} hook. This module is that hook: it
 * reads the cache key a producer was registered under and, when it recognises
 * the recipe, dispatches an equivalent job to the art worker instead of
 * letting the producer run here.
 *
 * ## Why route on the key rather than at the call sites
 *
 * Because the call sites are everywhere and most of them are not ours. The
 * shelf asks for the case; the Library Studio asks for a small case per theme
 * card; previews and exporters ask for their own. Profiling a cold boot found
 * **2.5 seconds of brush work inside the studio's theme-card grid alone** —
 * a panel that has no idea a worker exists and should not have to. One router
 * at the choke point fixes every caller at once, including future ones.
 *
 * ## Fail-safe by construction
 *
 * A key that does not match any pattern returns `null`, which `bakeCached`
 * reads as "paint it yourself" — exactly the behaviour before this file
 * existed. So a recipe whose key format drifts does not break: it merely stops
 * being offloaded, and the profile says so. That matters, because these keys
 * belong to modules this one does not own (`wood.ts` gained an `m1` segment
 * mid-flight while this was being written, which is precisely why every
 * pattern below tolerates extra segments rather than pinning an exact shape).
 *
 * ## What is NOT routed here
 *
 * Flora. Its key is a digest of a placement list, and a digest cannot be run
 * backwards into the placements the worker would need. `floraTextures.ts`
 * dispatches those explicitly, where the placements are still in hand.
 */

import { setBakeOffloader } from '../../art/bake';
import { artOffload } from './artOffload';
import type { CasePart } from './artJobs';

/** A recipe the worker can reproduce from its cache key alone. */
interface Route {
  test: RegExp;
  /** Build the job from the regex captures, or null to decline. */
  build(m: RegExpMatchArray): {
    part: CasePart;
    themeId?: string;
    backdrop?: string;
    wallpaper?: { pattern: string; colourway: string; tile: number };
    w: number;
    h: number;
    floorH?: number;
  } | null;
}

const int = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Themed case parts, as `caseArt.bakePart` writes them:
 *   `theme{N}|crown|{themeId}|{w}x{h}`
 *   `theme{N}|rail|{themeId}|{w}x{h}`
 *   `theme{N}|plank|{themeId}|{w}x{h}`
 *   `theme{N}|back-v2|{themeId}|{w}x{h}`
 * The part segment tolerates a `-vN` suffix so a recipe bump keeps routing.
 */
const THEMED = /^theme\d+\|(crown|rail|plank|back)(?:-v\d+)?\|([^|]+)\|(\d+)x(\d+)$/;

/**
 * Untinted base case, as `wood.ts` writes it — with an optional material
 * segment in the middle (`wood|m1|plank|1200x40`).
 */
const BASE_WOOD = /^wood\|(?:[^|]+\|)?(plank|back|rail|crown|shadow)\|(\d+)x(\d+)$/;

/*
 * NOT routed: `paper|aged|…` and `wallpaper|damask|…`.
 *
 * Those two go through `rasterizeSvg`, which needs `new Image()` to decode a
 * blob URL — and there is no `Image` constructor in a worker. (`createImageBitmap`
 * on an SVG blob is not a reliable substitute across renderers, and this is
 * not the place to find out.) They are also the two cheapest bakes in the app,
 * ~30ms for the pair, so there is nothing to win.
 */

/**
 * The shelf's multi-floor wall strip, written by `textures.bakeWallStrip`:
 *   `wall|[vN|]{themeId}|{backdrop}|{pattern}|{colourway}|{w}x{h}`
 * The optional recipe-version segment is not decoration — the key gained a
 * `v2` the same afternoon this router was written, and a pattern that did not
 * tolerate it would have silently stopped routing the single largest bake in
 * the case.
 *
 * `tile` is absent from the key on purpose (the pattern and colourway are the
 * identity), so the worker uses the theme's own tile size, which is what every
 * caller passes.
 */
const WALL = /^wall\|(?:v\d+\|)?([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|(\d+)x(\d+)$/;

const ROUTES: readonly Route[] = [
  {
    test: THEMED,
    build: (m) => ({
      part: m[1] as CasePart,
      themeId: m[2] as string,
      w: int(m[3]),
      h: int(m[4]),
    }),
  },
  {
    test: BASE_WOOD,
    build: (m) => ({
      part: `base-${m[1]}` as CasePart,
      w: int(m[2]),
      h: int(m[3]),
    }),
  },
  {
    test: WALL,
    build: (m) => ({
      part: 'wall',
      themeId: m[1] as string,
      backdrop: m[2] as string,
      wallpaper: { pattern: m[3] as string, colourway: m[4] as string, tile: 0 },
      w: int(m[5]),
      h: int(m[6]),
      // Vertical features repeat on one floor; the strip is three of them.
      floorH: Math.round(int(m[6]) / 3),
    }),
  },
];

/**
 * The hook itself. Returns a painted bitmap, or null to let the caller paint.
 *
 * Note the `dpr` passthrough: the worker bakes at exactly the density asked
 * for, so an offloaded raster is byte-identical to the local one and both
 * share the same disk-cache entry.
 */
async function route(params: string, dpr: number): Promise<ImageBitmap | null> {
  const offload = artOffload();
  if (!offload.available) return null;
  for (const { test, build } of ROUTES) {
    const m = test.exec(params);
    if (m === null) continue;
    const spec = build(m);
    if (spec === null) return null;
    const painted = await offload.casePart({
      part: spec.part,
      themeId: spec.themeId ?? '',
      backdrop: spec.backdrop ?? '',
      wallpaper: spec.wallpaper ?? { pattern: '', colourway: '', tile: 0 },
      w: spec.w,
      h: spec.h,
      floorH: spec.floorH ?? 0,
      dpr,
    });
    return painted?.bitmap ?? null;
  }
  return null;
}

let installed = false;

/**
 * Point `bake.ts` at the worker. Idempotent — every module that might be the
 * first to bake something calls this, and only the first call does anything.
 */
export function installArtRoutes(): void {
  if (installed) return;
  installed = true;
  setBakeOffloader(route);
}

/** Undo the install (tests / teardown). */
export function uninstallArtRoutes(): void {
  installed = false;
  setBakeOffloader(null);
}

/**
 * Paint a room preview (`caseArt.renderCaseSection`) off-thread.
 *
 * Not a route — the Library Studio's theme cards call `renderCaseSection`
 * directly rather than through `bakeCached`, so there is no cache key for the
 * router to recognise. Measured: eight cards is ~2.9s of brush work, and it
 * lands during boot, which makes it the single largest remaining hitch.
 *
 * Drop-in for the body of a card's paint:
 *
 * ```ts
 * const bitmap = await paintThemeCard({ theme, backdrop, wallpaper, w, h, dpr, label: '' });
 * if (bitmap === null) { …paint it here as before… }
 * ```
 *
 * Returns `null` when there is no worker, so the caller keeps its existing
 * inline path as the fallback.
 */
export async function paintThemeCard(opts: {
  themeId: string;
  backdrop: string;
  wallpaper: { pattern: string; colourway: string; tile: number };
  w: number;
  h: number;
  dpr: number;
  label?: string;
  books?: boolean;
}): Promise<ImageBitmap | null> {
  const offload = artOffload();
  if (!offload.available) return null;
  const painted = await offload.casePart({
    part: 'card',
    themeId: opts.themeId,
    backdrop: opts.backdrop,
    wallpaper: opts.wallpaper,
    w: opts.w,
    h: opts.h,
    floorH: opts.h,
    dpr: opts.dpr,
    label: opts.label ?? '',
    books: opts.books ?? true,
  });
  return painted?.bitmap ?? null;
}

/** Exposed for the unit tests: does this key have an off-thread route? */
export function routeFor(params: string): CasePart | null {
  for (const { test, build } of ROUTES) {
    const m = test.exec(params);
    if (m === null) continue;
    return build(m)?.part ?? null;
  }
  return null;
}
