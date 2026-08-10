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
 * spine is a stack of silhouettes, material fields and tooling, and the main
 * thread's whole share of one is a `drawImage` of a finished `ImageBitmap`
 * into the atlas page.
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
 * ## Determinism
 *
 * Same seed, same bytes: nothing here reads time, randomness or DPI. A spine
 * drawn in the worker is byte-identical to the same spine drawn on the main
 * thread, which is what lets the fallback path be a silent one.
 */

import { setFlatScheme } from '../../art/flat';
import { renderSpine, type Ctx2D } from '../../art/spines';
import {
  ART_PROTOCOL_VERSION,
  type ArtJob,
  type ArtMessage,
  type SpineJob,
} from './artJobs';

const scope = self as unknown as DedicatedWorkerGlobalScope;

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
  renderSpine(ctx as unknown as Ctx2D, job.params, 0, 0, h, job.scale, {
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

function runNext(): void {
  if (running) return;
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

post({ kind: 'ready', version: ART_PROTOCOL_VERSION });
