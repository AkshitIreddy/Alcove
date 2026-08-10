/**
 * features/bookshelf/artJobs.ts — the wire format shared by the art worker
 * and its host.
 *
 * Kept in its own module (no Pixi, no DOM, no heavy `src/art` import) so both
 * sides can type the protocol without dragging the other's dependencies in,
 * and so the unit tests can exercise the scheduler with hand-built messages.
 *
 * Everything crossing the boundary is structured-cloneable by construction:
 * `SpineParams` is plain data, and results travel as transferable
 * `ImageBitmap`s (zero-copy — the pixels are never serialised).
 *
 * There is one job kind left. Case furniture and flora both used to come
 * through here; the case is drawn flat now (a few dozen path fills, cheaper to
 * do inline than to post) and flora is retired, so the whole `CaseJob` /
 * `FloraJob` half of the protocol went with the painting stack.
 */

import type { FlatScheme } from '../../art/flat';
import type { SpineParams } from '../../art/spines';

/**
 * Bump when a job's meaning changes. The host rejects a worker whose ready
 * handshake carries another value, so this is an enforced wire contract and
 * not merely a diagnostic label.
 */
// v6: titleless spine workers no longer load or report handwriting fonts.
export const ART_PROTOCOL_VERSION = 6;

/* --------------------------------- jobs ---------------------------------- */

export interface SpineJob {
  kind: 'spine';
  id: number;
  params: SpineParams;
  /** Destination bitmap size in texture px (already scaled). */
  w: number;
  h: number;
  /** Bake scale handed to renderSpine. */
  scale: number;
  hiRes: boolean;
  rowPhase: number | undefined;
  depth: number | undefined;
  neighbourLeft: string | null;
  neighbourRight: string | null;
  /**
   * The room's palette, carried per job.
   *
   * `setFlatScheme` is module state, and a worker is a separate module
   * instance — the main thread's swap simply does not reach it. Without this
   * the off-thread spines bake in the house palette while the inline fallback
   * bakes in the room's, and the same shelf comes out in two colour schemes
   * depending on which path each book happened to take.
   */
  scheme: FlatScheme;
}

export type ArtJob = SpineJob;

/* -------------------------------- results -------------------------------- */

export interface SpineResult {
  kind: 'spine';
  id: number;
  ok: true;
  bitmap: ImageBitmap;
  /** Wall-clock cost inside the worker, ms — feeds the perf HUD. */
  ms: number;
}

export interface ArtFailure {
  kind: 'error';
  id: number;
  ok: false;
  message: string;
}

/** Sent once when the worker module is initialised and can take jobs. */
export interface ArtReady {
  kind: 'ready';
  version: number;
}

export type ArtResult = SpineResult | ArtFailure;
export type ArtMessage = ArtResult | ArtReady;

/**
 * How long a single job may run before the host gives up on it and bakes the
 * piece itself. Generous: a detailed hi-res spine on a software renderer has
 * been measured at 6s, and killing a merely-slow worker would trade an
 * off-thread stall for an on-thread one.
 */
export const ART_JOB_TIMEOUT_MS = 30_000;
