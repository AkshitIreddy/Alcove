/// <reference lib="webworker" />
/**
 * features/bookshelf/artWorker.ts — the painting thread.
 *
 * ## Why this exists
 *
 * The painted pipeline (`docs/design/painted-rendering.md`) buys its look with
 * CPU: a spine is thousands of brush dabs plus a text stencil read back off a
 * canvas, and a floor of flora is thousands more. A cold shelf measured
 * **42.6s of long tasks and a 15.5s single frozen frame** on the main thread —
 * the window was simply gone while the art landed.
 *
 * Slicing that work finer cannot fix it, because the atom is one spine and one
 * spine is seconds. The only way the window stays alive is for the painting to
 * happen somewhere else. So: this worker owns `renderSpine` and
 * `bakeFloraLayer`, and the main thread's entire share of a spine becomes one
 * `drawImage` of a finished `ImageBitmap` into the atlas page.
 *
 * ## What crosses the boundary
 *
 * Jobs are plain data (`artJobs.ts`); results are `ImageBitmap`s, **transferred**
 * rather than copied, so a 2048² page of spines costs no serialisation at all.
 *
 * ## Fonts
 *
 * `document.fonts` does not exist here and a worker does not inherit the
 * document's faces, so the three handwriting families are re-registered on
 * `self.fonts` from the same @fontsource woff2 files the app loads. If that
 * fails the worker still runs — `renderSpine` falls back to the generic
 * cursive face exactly as it already does when the document's fonts are slow,
 * and the host is told which faces made it (see {@link ArtReady.fonts}).
 *
 * ## Determinism
 *
 * Same seed, same bytes: nothing here reads time, randomness or DPI. A spine
 * baked in the worker is byte-identical to the same spine baked on the main
 * thread, which is what lets the fallback path be a silent one.
 */

// FIRST: `brush.drawSurface` reaches for `document.createElement('canvas')`,
// so without this every job in this file throws before it paints a pixel.
import './artWorkerDom';

import caveatUrl from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import kalamUrl from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';
import patrickUrl from '@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2?url';

import {
  bakeThemedBackPanel,
  bakeThemedCrown,
  bakeThemedPlank,
  bakeThemedRail,
  renderBackdrop,
  renderCaseSection,
} from '../../art/caseArt';
import { bakeFloraLayer } from '../../art/flora';
import { whenMaterialsReady } from '../../art/materials';
import { fnv1a } from '../../art/noise';
import {
  bakeBackPanel,
  bakeCrown,
  bakeShelfPlank,
  bakeShelfShadowStrip,
  bakeSideRail,
} from '../../art/wood';
import { renderSpine, type Ctx2D } from '../../art/spines';
import {
  getTheme,
  type BackdropId,
  type ThemeId,
  type ColourwayId,
  type WallpaperPatternId,
} from '../../art/themes';
import {
  ART_PROTOCOL_VERSION,
  type ArtJob,
  type ArtMessage,
  type CaseJob,
  type FloraJob,
  type SpineJob,
} from './artJobs';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/* ------------------------------- fonts ----------------------------------- */

/**
 * The faces `spines.ts` asks for by name. Weight/style are left at the
 * defaults; the variable Caveat file covers its whole weight axis, and the
 * spine renderer only ever asks for the regular of the other two.
 */
const FONT_FACES: ReadonlyArray<{ family: string; url: string; descriptors?: FontFaceDescriptors }> = [
  { family: 'Caveat Variable', url: caveatUrl, descriptors: { weight: '400 700' } },
  { family: 'Kalam', url: kalamUrl },
  { family: 'Patrick Hand', url: patrickUrl },
];

async function loadFonts(): Promise<string[]> {
  const set = (scope as unknown as { fonts?: FontFaceSet }).fonts;
  if (set === undefined || typeof FontFace === 'undefined') return [];
  const loaded: string[] = [];
  await Promise.all(
    FONT_FACES.map(async ({ family, url, descriptors }) => {
      try {
        const face = new FontFace(family, `url(${url}) format('woff2')`, descriptors);
        await face.load();
        set.add(face);
        loaded.push(family);
      } catch {
        // A missing face is survivable — the fallback cursive still draws.
      }
    }),
  );
  return loaded;
}

/* ------------------------------- painting -------------------------------- */

function paintSpine(job: SpineJob): ImageBitmap {
  const w = Math.max(1, Math.ceil(job.w));
  const h = Math.max(1, Math.ceil(job.h));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('artWorker: 2d context unavailable');
  renderSpine(ctx as unknown as Ctx2D, job.params, 0, 0, h, job.scale, job.title, {
    hiRes: job.hiRes,
    rowPhase: job.rowPhase,
    depth: job.depth,
    neighbourLeft: job.neighbourLeft,
    neighbourRight: job.neighbourRight,
  });
  return canvas.transferToImageBitmap();
}

/**
 * Copy a bitmap that someone else owns.
 *
 * `postMessage` with a transfer list DETACHES the bitmap, and everything that
 * comes back out of `bakeCached` is a shared cache entry — transferring one
 * would leave the worker's own cache holding a corpse and make the second
 * request for the same piece throw. A blit into a fresh canvas is a few
 * hundred microseconds off-thread and keeps the cache honest.
 */
function copyBitmap(source: ImageBitmap): ImageBitmap {
  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('artWorker: copy 2d context unavailable');
  ctx.drawImage(source, 0, 0);
  return canvas.transferToImageBitmap();
}

async function paintFlora(job: FloraJob): Promise<{ bitmap: ImageBitmap | null; bounds: unknown }> {
  const baked = await bakeFloraLayer(job.placements, job.dpr, { granulate: false });
  if (baked === null) return { bitmap: null, bounds: null };
  return { bitmap: copyBitmap(baked.bitmap), bounds: baked.bounds };
}

/**
 * The room's furniture.
 *
 * Four of the five parts already have baked wrappers in `caseArt.ts`, so this
 * just calls them and lets the worker's own memory cache dedupe. The wall
 * strip is composed here instead, because the host wants THREE floors of wall
 * in one raster (a taller strip pushes the visible repeat three times further
 * apart) and `bakeThemedBackdrop` only ever bakes one.
 */
async function paintCase(job: CaseJob): Promise<ImageBitmap> {
  const id = job.themeId as ThemeId;
  const dpr = job.dpr;
  switch (job.part) {
    case 'plank':
      return copyBitmap(await bakeThemedPlank(id, job.w, dpr));
    case 'rail':
      return copyBitmap(await bakeThemedRail(id, job.h, dpr));
    case 'crown':
      return copyBitmap(await bakeThemedCrown(id, job.w, dpr));
    case 'back':
      return copyBitmap(await bakeThemedBackPanel(id, job.w, job.h, dpr));
    case 'wall': {
      const theme = getTheme(id);
      // The wall hangs a graded printed sheet out of the generated wallpaper
      // library, so the WebPs have to be resident before a single tile is
      // laid — otherwise the worker silently falls back to the procedural
      // pattern and the whole room comes out flat.
      //
      // Every other part here goes through `caseArt.bakePart`, which already
      // waits; this one composes its own canvas (three floors of wall in one
      // raster) and so has to wait for itself. The worker has no `window`, so
      // the module's auto-preload never fired — this call is what starts it.
      await whenMaterialsReady();
      const canvas = new OffscreenCanvas(Math.ceil(job.w * dpr), Math.ceil(job.h * dpr));
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('artWorker: wall 2d context unavailable');
      ctx.scale(dpr, dpr);
      renderBackdrop(ctx as unknown as Ctx2D, theme, job.backdrop as BackdropId, job.w, job.h, {
        seed: fnv1a(`${id}|${job.backdrop}|wall`),
        floorH: job.floorH,
        wallpaper: {
          pattern: job.wallpaper.pattern as WallpaperPatternId,
          colourway: job.wallpaper.colourway as ColourwayId,
          // The cache key the host routed from records the pattern and the
          // colourway but not the tile size, because those two ARE the
          // identity — so fall back to the room's own tile, which is what
          // every caller passes anyway.
          tile: job.wallpaper.tile > 0 ? job.wallpaper.tile : theme.wallpaper.tile,
        },
      });
      return canvas.transferToImageBitmap();
    }
    case 'card': {
      // A room preview: wall, cornice, rail, plank, books — the whole case in
      // one small raster. Eight of these paint at once when the Library Studio
      // opens, which is ~3s of brush work; here it is three parallel threads.
      const theme = getTheme(id);
      const canvas = new OffscreenCanvas(Math.ceil(job.w * dpr), Math.ceil(job.h * dpr));
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('artWorker: card 2d context unavailable');
      ctx.scale(dpr, dpr);
      renderCaseSection(ctx as unknown as Ctx2D, theme, job.w, job.h, fnv1a(`${id}|card`), {
        label: job.label ?? '',
        books: job.books ?? true,
        backdrop: job.backdrop as BackdropId,
        wallpaper: {
          pattern: job.wallpaper.pattern as WallpaperPatternId,
          colourway: job.wallpaper.colourway as ColourwayId,
          tile: job.wallpaper.tile > 0 ? job.wallpaper.tile : theme.wallpaper.tile,
        },
      });
      return canvas.transferToImageBitmap();
    }
    /* --- the untinted base case: plain oak + paper, no room applied --- */
    case 'base-plank':
      return copyBitmap(await bakeShelfPlank(job.w, dpr));
    case 'base-shadow':
      return copyBitmap(await bakeShelfShadowStrip(dpr));
    case 'base-back':
      return copyBitmap(await bakeBackPanel(job.w, job.h, dpr));
    case 'base-rail':
      return copyBitmap(await bakeSideRail(job.w, job.h, dpr));
    case 'base-crown':
      return copyBitmap(await bakeCrown(job.w, job.h, dpr));
    case 'base-paper':
    case 'base-wallpaper':
      // Both rasterise an SVG through `new Image()`, which does not exist in a
      // worker; `artRoutes` never sends them, and this makes that explicit.
      throw new Error(`artWorker: ${job.part} cannot be painted off-thread`);
  }
}

/* ------------------------------ dispatch --------------------------------- */

/**
 * Jobs are handled strictly one at a time, in arrival order.
 *
 * A worker that interleaves is a worker whose per-job latency is the whole
 * queue's latency, and the host's whole scheduling story (nearest-to-viewport
 * first) depends on jobs finishing in the order they were sent.
 */
const queue: ArtJob[] = [];
let running = false;
let ready = false;

async function runNext(): Promise<void> {
  if (running || !ready) return;
  const job = queue.shift();
  if (job === undefined) return;
  running = true;
  const t0 = performance.now();
  try {
    if (job.kind === 'spine') {
      const bitmap = paintSpine(job);
      post({ kind: 'spine', id: job.id, ok: true, bitmap, ms: performance.now() - t0 }, [bitmap]);
    } else if (job.kind === 'case') {
      const bitmap = await paintCase(job);
      post({ kind: 'case', id: job.id, ok: true, bitmap, ms: performance.now() - t0 }, [bitmap]);
    } else {
      const { bitmap, bounds } = await paintFlora(job);
      post(
        {
          kind: 'flora',
          id: job.id,
          ok: true,
          bitmap,
          bounds: bounds as never,
          ms: performance.now() - t0,
        },
        bitmap === null ? [] : [bitmap],
      );
    }
  } catch (err) {
    post({
      kind: 'error',
      id: job.id,
      ok: false,
      // The stack, not just the message: a job that fails inside 5000 lines of
      // art code is undiagnosable from "document is not defined" alone, and
      // this string is the only thing that crosses back to the main thread.
      message: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  } finally {
    running = false;
    // Yield to the event loop so a cancel/priority message posted while the
    // last job ran is seen before the next one starts.
    setTimeout(() => void runNext(), 0);
  }
}

function post(message: ArtMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

scope.addEventListener('message', (event: MessageEvent<ArtJob>) => {
  queue.push(event.data);
  void runNext();
});

void loadFonts().then((fonts) => {
  ready = true;
  post({ kind: 'ready', version: ART_PROTOCOL_VERSION, fonts });
  void runNext();
});
