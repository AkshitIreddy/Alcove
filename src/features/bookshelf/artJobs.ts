/**
 * features/bookshelf/artJobs.ts — the wire format shared by the art worker
 * and its host.
 *
 * Kept in its own module (no Pixi, no DOM, no `src/art` import) so both sides
 * can type the protocol without dragging the other's dependencies in, and so
 * the unit tests can exercise the scheduler with hand-built messages.
 *
 * Everything crossing the boundary is structured-cloneable by construction:
 * `SpineParams` and `FloraPlacement` are plain data, and the results travel as
 * transferable `ImageBitmap`s (zero-copy — the pixels are never serialised).
 */

import type { FloraPlacement, Rect } from '../../art/flora';
import type { SpineParams } from '../../art/spines';

/** Bump when a job's meaning changes so a stale worker bundle is obvious. */
export const ART_PROTOCOL_VERSION = 1;

/* --------------------------------- jobs ---------------------------------- */

export interface SpineJob {
  kind: 'spine';
  id: number;
  params: SpineParams;
  title: string;
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
}

export interface FloraJob {
  kind: 'flora';
  id: number;
  placements: FloraPlacement[];
  dpr: number;
}

/**
 * One piece of the room's furniture: a shelf plank, a side rail, the cornice,
 * the back panel, or a multi-floor strip of the wall behind it.
 *
 * These are single big paints (a themed plank measured ~1s, the cornice ~0.5s)
 * that all land in the same first second as the spines, so leaving them on the
 * main thread would keep a visible hitch right where the shelf appears.
 */
export type CasePart =
  /* themed (art/caseArt.ts) — the room the user picked */
  | 'plank'
  | 'rail'
  | 'crown'
  | 'back'
  | 'wall'
  /* untinted base case (art/wood.ts, art/paper.ts) — the fallback the shelf
   * shows before a theme lands, and the source every wood stain derives from */
  | 'base-plank'
  | 'base-shadow'
  | 'base-paper'
  | 'base-back'
  | 'base-rail'
  | 'base-crown'
  | 'base-wallpaper'
  /* a whole little case in one raster — the Library Studio's theme cards and
   * any other room preview (`caseArt.renderCaseSection`) */
  | 'card';

export interface CaseJob {
  kind: 'case';
  id: number;
  part: CasePart;
  themeId: string;
  /** Wall only: which backdrop renderer and which paper to hang on it. */
  backdrop: string;
  wallpaper: { pattern: string; colourway: string; tile: number };
  /** Design size in world px. */
  w: number;
  h: number;
  /** Wall only: the floor pitch its vertical features repeat on. */
  floorH: number;
  /** Card only: text for the floor plate ('' leaves it blank). */
  label?: string;
  /** Card only: draw books on the shelf. Default true. */
  books?: boolean;
  dpr: number;
}

export type ArtJob = SpineJob | FloraJob | CaseJob;

/* -------------------------------- results -------------------------------- */

export interface SpineResult {
  kind: 'spine';
  id: number;
  ok: true;
  bitmap: ImageBitmap;
  /** Wall-clock cost inside the worker, ms — feeds the perf HUD. */
  ms: number;
}

export interface FloraResult {
  kind: 'flora';
  id: number;
  ok: true;
  /** null when nothing grows (an empty layer is a legitimate answer). */
  bitmap: ImageBitmap | null;
  bounds: Rect | null;
  ms: number;
}

export interface CaseResult {
  kind: 'case';
  id: number;
  ok: true;
  bitmap: ImageBitmap;
  ms: number;
}

export interface ArtFailure {
  kind: 'error';
  id: number;
  ok: false;
  message: string;
}

/** Sent once when the worker's fonts have settled and it can take jobs. */
export interface ArtReady {
  kind: 'ready';
  version: number;
  /** Which of the three handwriting faces actually loaded in the worker. */
  fonts: string[];
}

export type ArtResult = SpineResult | FloraResult | CaseResult | ArtFailure;
export type ArtMessage = ArtResult | ArtReady;

/**
 * How long a single job may run before the host gives up on it and bakes the
 * piece itself. Generous: a titled hi-res spine on a software renderer has
 * been measured at 6s, and killing a merely-slow worker would trade an
 * off-thread stall for an on-thread one.
 */
export const ART_JOB_TIMEOUT_MS = 30_000;
