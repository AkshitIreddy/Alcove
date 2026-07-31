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

import caveatUrl from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import kalamUrl from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';
import patrickUrl from '@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2?url';

import { bakeFloraLayer } from '../../art/flora';
import { renderSpine, type Ctx2D } from '../../art/spines';
import {
  ART_PROTOCOL_VERSION,
  type ArtJob,
  type ArtMessage,
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

async function paintFlora(job: FloraJob): Promise<{ bitmap: ImageBitmap | null; bounds: unknown }> {
  const baked = await bakeFloraLayer(job.placements, job.dpr, { granulate: false });
  if (baked === null) return { bitmap: null, bounds: null };
  return { bitmap: baked.bitmap, bounds: baked.bounds };
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
      message: err instanceof Error ? err.message : String(err),
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
