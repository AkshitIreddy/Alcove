/**
 * A bounded cache for the filmstrip's real page miniatures.
 *
 * Full page snapshots are expensive and the flip cache deliberately retains
 * only six of them. The filmstrip therefore owns much smaller bitmaps, but it
 * does not own another renderer: FlipSurface hands it low-density captures
 * made by the same offscreen PageEditor + html-to-image pipeline as a curl.
 *
 * Requests are serialized by default. Opening a strip over a long book must
 * not mount twenty hidden TipTap editors in one frame, and leaving the visible
 * part of the strip aborts work that has not started yet.
 */
import type { PageDoc } from '../data/types';

const PAGE_PIXEL_PREFIXES = [
  '--paper-',
  '--ink-',
  '--wash-',
  '--font-',
  '--text-',
  '--code-',
] as const;

/**
 * Exact global axes that can repaint a page snapshot. Animated panel-push
 * coordinates are filtered out so a rail slide never invalidates thumbnails.
 */
export function pageThumbnailLookSignature(root: HTMLElement): string {
  const pageVariables = Array.from(root.style)
    .filter((name) => PAGE_PIXEL_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .sort()
    .map((name) => `${name}:${root.style.getPropertyValue(name)}`);
  return [
    root.getAttribute('data-theme') ?? '',
    root.getAttribute('data-ink') ?? '',
    root.getAttribute('data-appearance') ?? '',
    root.getAttribute('data-code-frame') ?? '',
    root.getAttribute('data-code-numbers') ?? '',
    root.className,
    ...pageVariables,
  ].join('|');
}

export interface PageThumbnailKey {
  /** Immutable PageDoc identity; BookView replaces it on every authored edit. */
  readonly doc: PageDoc;
  /** Left/right leaf CSS differs at the fore edge, so side is a pixel axis. */
  readonly side: 'left' | 'right';
  /** Theme, ink, typography and minimalist/doodle presentation signature. */
  readonly look: string;
}

export interface PageThumbnailCacheOptions {
  /** Tiny retained bitmaps. 96 pages are roughly 5–8 MiB at filmstrip size. */
  readonly capacity?: number;
  /** Hidden page renders allowed at once. Keep this low: each mounts TipTap. */
  readonly concurrency?: number;
}

interface ClosableBitmap {
  close(): void;
}

interface ThumbnailEntry<T extends ClosableBitmap> {
  readonly key: PageThumbnailKey;
  readonly bitmap: T;
}

interface PendingEntry<T extends ClosableBitmap> {
  readonly key: PageThumbnailKey;
  readonly promise: Promise<T | null>;
}

interface QueuedRender<T extends ClosableBitmap> {
  readonly run: () => Promise<T | null>;
  readonly signal?: AbortSignal;
  readonly resolve: (value: T | null) => void;
  readonly reject: (reason: unknown) => void;
}

function sameKey(left: PageThumbnailKey, right: PageThumbnailKey): boolean {
  return left.doc === right.doc && left.side === right.side && left.look === right.look;
}

export class PageThumbnailCache<
  T extends ClosableBitmap = ImageBitmap,
> {
  private readonly capacity: number;
  private readonly concurrency: number;
  private readonly entries = new Map<string, ThumbnailEntry<T>>();
  private readonly pending = new Map<string, PendingEntry<T>>();
  private readonly queue: QueuedRender<T>[] = [];
  private active = 0;
  private disposed = false;

  constructor(options: PageThumbnailCacheOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 96));
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  }

  /**
   * Return or produce the thumbnail for one exact page presentation.
   * Concurrent equivalent calls share work. A newer key for the same page
   * supersedes the older job; pixels from the stale job are closed, never
   * published under the new document.
   */
  request(
    pageId: string,
    key: PageThumbnailKey,
    render: () => Promise<T | null>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    if (this.disposed || signal?.aborted === true) return Promise.resolve(null);

    const hit = this.entries.get(pageId);
    if (hit !== undefined && sameKey(hit.key, key)) {
      // Map insertion order is the LRU order. Observing a thumbnail is use.
      this.entries.delete(pageId);
      this.entries.set(pageId, hit);
      return Promise.resolve(hit.bitmap);
    }

    const inflight = this.pending.get(pageId);
    if (inflight !== undefined && sameKey(inflight.key, key)) return inflight.promise;

    let record!: PendingEntry<T>;
    const promise = this.enqueue(render, signal)
      .then((bitmap) => {
        if (bitmap === null) return null;
        const publish =
          !this.disposed &&
          signal?.aborted !== true &&
          this.pending.get(pageId) === record;
        if (!publish) {
          bitmap.close();
          return null;
        }

        const previous = this.entries.get(pageId);
        if (previous !== undefined && previous.bitmap !== bitmap) previous.bitmap.close();
        this.entries.delete(pageId);
        this.entries.set(pageId, { key, bitmap });
        this.trim();
        return bitmap;
      })
      .finally(() => {
        if (this.pending.get(pageId) === record) this.pending.delete(pageId);
      });
    record = { key, promise };
    this.pending.set(pageId, record);
    return promise;
  }

  /** Drop retained pages that no longer belong to the open book. */
  prune(livePageIds: ReadonlySet<string>): void {
    for (const [pageId, entry] of this.entries) {
      if (livePageIds.has(pageId)) continue;
      this.entries.delete(pageId);
      entry.bitmap.close();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.bitmap.close();
    this.entries.clear();
    this.pending.clear();
    // Work that has not started owns no pixels and can resolve immediately.
    for (const item of this.queue.splice(0)) item.resolve(null);
  }

  private enqueue(
    run: () => Promise<T | null>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      this.queue.push({ run, signal, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (!this.disposed && this.active < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      if (item.signal?.aborted === true) {
        item.resolve(null);
        continue;
      }
      this.active += 1;
      void item.run()
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }

  private trim(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.entries().next().value as
        | [string, ThumbnailEntry<T>]
        | undefined;
      if (oldest === undefined) return;
      this.entries.delete(oldest[0]);
      oldest[1].bitmap.close();
    }
  }
}
