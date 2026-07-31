/**
 * features/bookshelf/artOffload.ts — the main thread's half of the art worker.
 *
 * A small pool of {@link ../artWorker} instances, a promise per job, and a
 * hard rule: **failure is never fatal**. If workers are unavailable (no
 * `Worker`, no `OffscreenCanvas`, a bundler that could not build the module,
 * a job that threw or timed out) every entry point resolves to `null` and the
 * caller paints the piece itself on the main thread, exactly as before. The
 * worker is a performance path, not a correctness dependency.
 *
 * ## Pool size
 *
 * Painting is embarrassingly parallel — spines share nothing — so the pool is
 * sized from `hardwareConcurrency`, minus one for the main thread, capped at
 * {@link MAX_WORKERS}. The cap is not about the CPU: each worker holds its own
 * copy of the brush kernels and the leaf atlases, and four of those is already
 * a lot of memory to hand a note-taking app.
 *
 * ## Ordering
 *
 * A worker runs its own queue in arrival order, so the host round-robins and
 * lets the natural "nearest to the viewport is requested first" ordering of
 * `SpineFactory` survive the trip.
 */

import { ART_JOB_TIMEOUT_MS, type ArtJob, type ArtMessage, type FloraJob, type SpineJob } from './artJobs';
import type { Rect } from '../../art/flora';

/** Never spin up more than this many painting threads. */
export const MAX_WORKERS = 3;

export interface SpinePaint {
  bitmap: ImageBitmap;
  ms: number;
}

export interface FloraPaint {
  bitmap: ImageBitmap | null;
  bounds: Rect | null;
  ms: number;
}

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  worker: WorkerSlot;
}

interface WorkerSlot {
  worker: Worker;
  /** Jobs handed over and not yet answered — the round-robin cost function. */
  inFlight: number;
  ready: boolean;
  fonts: string[];
}

/* ----------------------------- capability -------------------------------- */

function queryFlag(name: string): string | null {
  if (typeof location === 'undefined') return null;
  const m = new RegExp(`[?&]${name}=([^&]*)`).exec(location.search);
  return m?.[1] ?? null;
}

/**
 * Workers are on unless the environment cannot host one or QA turns them off
 * with `?artworker=0` (which is how the freeze probe measures the before/after
 * without needing two builds).
 */
function offloadSupported(): boolean {
  if (queryFlag('artworker') === '0') return false;
  if (typeof Worker === 'undefined') return false;
  if (typeof OffscreenCanvas === 'undefined') return false;
  if (typeof createImageBitmap !== 'function') return false;
  return true;
}

function poolSize(): number {
  const cores =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4;
  const forced = Number(queryFlag('artworkers') ?? Number.NaN);
  if (Number.isFinite(forced) && forced >= 0) return Math.min(MAX_WORKERS, Math.max(0, forced));
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}

/* ------------------------------- the pool -------------------------------- */

export class ArtOffload {
  private readonly slots: WorkerSlot[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private started = false;
  private disabled = !offloadSupported();
  private destroyed = false;
  /** Cumulative worker-side paint time, ms — reported by the perf probes. */
  private workerMs = 0;
  private jobsDone = 0;

  /** False when nothing can be offloaded and callers must paint inline. */
  get available(): boolean {
    return !this.disabled && !this.destroyed;
  }

  /** Live worker count (0 before the first job). */
  get size(): number {
    return this.slots.length;
  }

  /** {jobs, ms} painted off-thread so far. */
  stats(): { jobs: number; ms: number; workers: number } {
    return { jobs: this.jobsDone, ms: this.workerMs, workers: this.slots.length };
  }

  /**
   * Paint a spine off-thread. Resolves `null` when the caller must do it
   * itself; never rejects.
   */
  async spine(job: Omit<SpineJob, 'id' | 'kind'>): Promise<SpinePaint | null> {
    const res = await this.submit<{ bitmap: ImageBitmap; ms: number }>({ ...job, kind: 'spine' });
    return res === null ? null : { bitmap: res.bitmap, ms: res.ms };
  }

  /** Paint a flora layer off-thread. Resolves `null` to mean "do it yourself". */
  async flora(job: Omit<FloraJob, 'id' | 'kind'>): Promise<FloraPaint | null> {
    const res = await this.submit<{ bitmap: ImageBitmap | null; bounds: Rect | null; ms: number }>({
      ...job,
      kind: 'flora',
    });
    return res === null ? null : { bitmap: res.bitmap, bounds: res.bounds, ms: res.ms };
  }

  destroy(): void {
    this.destroyed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('artOffload: destroyed'));
    }
    this.pending.clear();
    for (const slot of this.slots) slot.worker.terminate();
    this.slots.length = 0;
  }

  /* ------------------------------ internals ------------------------------ */

  private async submit<T>(job: Omit<ArtJob, 'id'>): Promise<T | null> {
    if (!this.available) return null;
    this.ensureStarted();
    const slot = this.pickSlot();
    if (slot === undefined) return null;

    const id = this.nextId++;
    const message = { ...job, id } as ArtJob;
    slot.inFlight++;

    try {
      const value = await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          slot.inFlight = Math.max(0, slot.inFlight - 1);
          reject(new Error(`artOffload: job ${id} (${job.kind}) timed out`));
        }, ART_JOB_TIMEOUT_MS);
        this.pending.set(id, {
          resolve: resolve as (v: never) => void,
          reject,
          timer,
          worker: slot,
        });
        slot.worker.postMessage(message);
      });
      return value;
    } catch {
      // Every failure mode collapses to the same answer: the caller paints it.
      return null;
    }
  }

  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    const n = poolSize();
    if (n === 0) {
      this.disabled = true;
      return;
    }
    for (let i = 0; i < n; i++) {
      try {
        // Vite resolves this to a bundled module worker at build time; the
        // `new URL(..., import.meta.url)` form is what makes that work in both
        // dev (native ESM) and a production build.
        const worker = new Worker(new URL('./artWorker.ts', import.meta.url), {
          type: 'module',
          name: `notebook-art-${i}`,
        });
        const slot: WorkerSlot = { worker, inFlight: 0, ready: false, fonts: [] };
        worker.addEventListener('message', (event: MessageEvent<ArtMessage>) =>
          this.handle(slot, event.data),
        );
        worker.addEventListener('error', () => this.retire(slot));
        this.slots.push(slot);
      } catch {
        // A CSP or a bundler that cannot emit workers: give up on all of them.
        break;
      }
    }
    if (this.slots.length === 0) this.disabled = true;
  }

  /** Least-loaded slot; ties go to the earliest, which keeps order stable. */
  private pickSlot(): WorkerSlot | undefined {
    let best: WorkerSlot | undefined;
    for (const slot of this.slots) {
      if (best === undefined || slot.inFlight < best.inFlight) best = slot;
    }
    return best;
  }

  private handle(slot: WorkerSlot, message: ArtMessage): void {
    if (message.kind === 'ready') {
      slot.ready = true;
      slot.fonts = message.fonts;
      return;
    }
    const entry = this.pending.get(message.id);
    if (entry === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    slot.inFlight = Math.max(0, slot.inFlight - 1);
    if (message.ok) {
      this.jobsDone++;
      this.workerMs += message.ms;
      entry.resolve(message as never);
    } else {
      entry.reject(new Error(message.message));
    }
  }

  /** A worker that errored is dropped; its jobs fall back to the main thread. */
  private retire(slot: WorkerSlot): void {
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    for (const [id, entry] of [...this.pending]) {
      if (entry.worker !== slot) continue;
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(new Error('artOffload: worker died'));
    }
    try {
      slot.worker.terminate();
    } catch {
      /* already gone */
    }
    if (this.slots.length === 0) this.disabled = true;
  }
}

/**
 * The process-wide pool. One shelf world exists at a time, but the studio
 * preview and the QA probes also want spines painted, and they should share
 * the same three threads rather than starting three more.
 */
let shared: ArtOffload | null = null;

export function artOffload(): ArtOffload {
  shared ??= new ArtOffload();
  return shared;
}

/** Tear the shared pool down (tests / teardown). */
export function destroyArtOffload(): void {
  shared?.destroy();
  shared = null;
}
