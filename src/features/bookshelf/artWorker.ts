/// <reference lib="webworker" />
/**
 * features/bookshelf/artWorker.ts — the spine-drawing thread.
 *
 * ## Why this exists
 *
 * A cold shelf measured **42.6s of long tasks and a 15.5s single frozen frame**
 * on the main thread — the window was simply gone while the art landed. Slicing
 * that work finer could not fix it, because the atom is one spine and one spine
 * was seconds. The only way the window stays alive is for the drawing to happen
 * somewhere else.
 *
 * The art is far cheaper since the flat restyle, but the shape still holds: a
 * spine is a stack of shapes plus a text stencil read back off a canvas, and
 * the main thread's whole share of one is a `drawImage` of a finished
 * `ImageBitmap` into the atlas page.
 *
 * This worker used to paint the case furniture and the flora layers too. It
 * does not any more: the case is a few dozen flat path fills (cheaper to draw
 * inline than to post a job about) and flora is retired, so `artJobs.ts` is
 * down to the one job kind.
 *
 * ## What crosses the boundary
 *
 * Jobs are plain data (`artJobs.ts`); results are `ImageBitmap`s, **transferred**
 * rather than copied, so a 2048² page of spines costs no serialisation at all.
 *
 * ## No DOM shim
 *
 * This used to import `artWorkerDom` first, because `brush.drawSurface` — the
 * one function every painted surface went through — allocated its scratch
 * canvas with a bare `document.createElement('canvas')`, and a worker with no
 * `document` therefore could not paint a single spine. The brush engine is
 * gone, and everything left in `src/art` reaches for `OffscreenCanvas` first,
 * so the shim went with it.
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
 * drawn in the worker is byte-identical to the same spine drawn on the main
 * thread, which is what lets the fallback path be a silent one.
 */

import caveatUrl from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import kalamUrl from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';
import patrickUrl from '@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2?url';

import { setFlatScheme } from '../../art/flat';
import { renderSpine, type Ctx2D } from '../../art/spines';
import {
  ART_PROTOCOL_VERSION,
  type ArtJob,
  type ArtMessage,
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

/* ------------------------------- drawing --------------------------------- */

function paintSpine(job: SpineJob): ImageBitmap {
  const w = Math.max(1, Math.ceil(job.w));
  const h = Math.max(1, Math.ceil(job.h));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('artWorker: 2d context unavailable');
  // The room rides on the job. A worker is its own module instance, so the
  // main thread's `setFlatScheme` never reached it and every off-thread spine
  // used to come out in the house palette regardless of the room on screen.
  setFlatScheme(job.scheme);
  renderSpine(ctx as unknown as Ctx2D, job.params, 0, 0, h, job.scale, job.title, {
    hiRes: job.hiRes,
    rowPhase: job.rowPhase,
    depth: job.depth,
    neighbourLeft: job.neighbourLeft,
    neighbourRight: job.neighbourRight,
  });
  return canvas.transferToImageBitmap();
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

function runNext(): void {
  if (running || !ready) return;
  const job = queue.shift();
  if (job === undefined) return;
  running = true;
  const t0 = performance.now();
  try {
    const bitmap = paintSpine(job);
    post({ kind: 'spine', id: job.id, ok: true, bitmap, ms: performance.now() - t0 }, [bitmap]);
  } catch (err) {
    post({
      kind: 'error',
      id: job.id,
      ok: false,
      // The stack, not just the message: a job that fails inside the art code
      // is undiagnosable from "document is not defined" alone, and this string
      // is the only thing that crosses back to the main thread.
      message: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  } finally {
    running = false;
    // Yield to the event loop so a message posted while the last job ran is
    // seen before the next one starts.
    setTimeout(() => runNext(), 0);
  }
}

function post(message: ArtMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

scope.addEventListener('message', (event: MessageEvent<ArtJob>) => {
  queue.push(event.data);
  runNext();
});

void loadFonts().then((fonts) => {
  ready = true;
  post({ kind: 'ready', version: ART_PROTOCOL_VERSION, fonts });
  runNext();
});
