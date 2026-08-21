/**
 * Tokenized preparation for a page turn whose raster faces are still cold.
 *
 * Snapshot capture is asynchronous and the reader can close the book, change
 * spread, or ask for the opposite direction while it runs.  This small owner
 * makes the completion conditional on the exact scene that requested it;
 * stale work is allowed to populate the cache but can never navigate.
 */
export interface FlipPreparation<TScene> {
  readonly scene: TScene;
  readonly sceneKey: string;
  readonly missingIds: readonly string[];
}

export type FlipStartPath = 'animate' | 'prepare' | 'crossfade';

/** Reduced motion is the only intentional veil; cold WebGL scenes prepare. */
export function flipStartPath(
  reducedMotion: boolean,
  usesWebGL: boolean,
  curlReady: boolean,
): FlipStartPath {
  if (reducedMotion) return 'crossfade';
  if (usesWebGL && !curlReady) return 'prepare';
  return 'animate';
}

export interface FlipPreparationCallbacks {
  readonly ready: () => void;
  readonly unavailable: () => void;
  readonly stale?: () => void;
}

export interface FlipPreparationOptions<TScene> {
  ensure(pageId: string): Promise<unknown>;
  sceneKeyNow(): string | null;
  isReady(scene: TScene): boolean;
  /** A capture invalidated by late node-view layout gets another settled pass. */
  scheduleRetry?(run: () => void): void;
  maxPasses?: number;
}

export class FlipReadinessGate<TScene> {
  private generation = 0;

  constructor(private readonly options: FlipPreparationOptions<TScene>) {}

  prepare(
    request: FlipPreparation<TScene>,
    callbacks: FlipPreparationCallbacks,
  ): number {
    const token = ++this.generation;
    const missing = [...new Set(request.missingIds)];
    const maxPasses = Math.max(1, this.options.maxPasses ?? 4);
    const run = (pass: number): void => {
      void Promise.allSettled(missing.map((pageId) => this.options.ensure(pageId))).then(() => {
        if (token !== this.generation) return;
        if (this.options.sceneKeyNow() !== request.sceneKey) {
          this.generation += 1;
          callbacks.stale?.();
          return;
        }
        if (this.options.isReady(request.scene)) {
          callbacks.ready();
          return;
        }
        if (pass >= maxPasses) {
          callbacks.unavailable();
          return;
        }
        const retry = (): void => {
          if (token === this.generation) run(pass + 1);
        };
        if (this.options.scheduleRetry) this.options.scheduleRetry(retry);
        else setTimeout(retry, 0);
      });
    };
    run(1);
    return token;
  }

  cancel(): void {
    this.generation += 1;
  }
}
