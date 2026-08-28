/**
 * The bottom filmstrip of real page miniatures.
 *
 * Every visible thumbnail is a low-density capture of the same staged
 * PageEditor used by the flip engine: real text wrapping, images, diagrams,
 * cards, free-layer marks and page ruling. The strip keeps the tiny pixels,
 * never the full page texture, and IntersectionObserver requests only the
 * portion the reader can actually see.
 */
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import type { Page } from '../data/types';
import {
  pageThumbnailLookSignature,
  type PageThumbnailKey,
} from './pageThumbnails';
import { extractHeadings } from './toc';
import { thumbnailPairNeedsRecentre } from './thumbScroll';

export interface ThumbStripProps {
  pages: readonly Page[];
  currentSpread: number;
  requestPreview(
    pageId: string,
    key: PageThumbnailKey,
    signal?: AbortSignal,
  ): Promise<ImageBitmap | null>;
  onJump(slot: number): void;
}

type PreviewState = 'idle' | 'loading' | 'refreshing' | 'ready' | 'stale';

function drawPageRaster(canvas: HTMLCanvasElement, bitmap: ImageBitmap): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  let paper = '#f8f0dc';
  try {
    paper = getComputedStyle(canvas).getPropertyValue('--paper-cream').trim() || paper;
  } catch {
    // Detached test doubles use parchment.
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (canvas.width - width) / 2,
    (canvas.height - height) / 2,
    width,
    height,
  );
}

export default function ThumbStrip(props: ThumbStripProps): JSX.Element {
  let stripEl: HTMLDivElement | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let lookObserver: MutationObserver | undefined;
  const canvases = new Map<string, HTMLCanvasElement>();
  const visible = new Set<string>();
  const painted = new Map<string, PageThumbnailKey>();
  const controllers = new Map<string, AbortController>();
  const retryTimers = new Map<string, number>();
  const retries = new Map<string, number>();
  const [states, setStates] = createSignal<Record<string, PreviewState>>({});
  const root = document.documentElement;
  const [look, setLook] = createSignal(pageThumbnailLookSignature(root));

  const sameKey = (left: PageThumbnailKey | undefined, right: PageThumbnailKey): boolean =>
    left !== undefined &&
    left.doc === right.doc &&
    left.side === right.side &&
    left.look === right.look;

  const setState = (pageId: string, state: PreviewState): void => {
    setStates((current) =>
      current[pageId] === state ? current : { ...current, [pageId]: state },
    );
  };

  const pageFor = (pageId: string): { page: Page; slot: number } | null => {
    const slot = props.pages.findIndex((page) => page.id === pageId);
    const page = props.pages[slot];
    return slot >= 0 && page !== undefined ? { page, slot } : null;
  };

  const request = (pageId: string, force = false): void => {
    if (!visible.has(pageId)) return;
    const canvas = canvases.get(pageId);
    const found = pageFor(pageId);
    if (canvas === undefined || found === null) return;
    const key: PageThumbnailKey = {
      doc: found.page.doc,
      side: found.slot % 2 === 0 ? 'left' : 'right',
      look: look(),
    };
    if (!force && sameKey(painted.get(pageId), key)) return;

    controllers.get(pageId)?.abort();
    const controller = new AbortController();
    controllers.set(pageId, controller);
    setState(pageId, painted.has(pageId) ? 'refreshing' : 'loading');

    void props.requestPreview(pageId, key, controller.signal)
      .then((bitmap) => {
        if (controller.signal.aborted || controllers.get(pageId) !== controller) return;
        controllers.delete(pageId);
        if (bitmap === null) throw new Error('page thumbnail capture returned no pixels');
        drawPageRaster(canvas, bitmap);
        painted.set(pageId, key);
        retries.delete(pageId);
        setState(pageId, 'ready');
      })
      .catch(() => {
        if (controller.signal.aborted || controllers.get(pageId) !== controller) return;
        controllers.delete(pageId);
        setState(pageId, painted.has(pageId) ? 'stale' : 'idle');
        const attempt = retries.get(pageId) ?? 0;
        if (attempt >= 2 || !visible.has(pageId)) return;
        retries.set(pageId, attempt + 1);
        const timer = window.setTimeout(() => {
          retryTimers.delete(pageId);
          request(pageId, true);
        }, attempt === 0 ? 250 : 1000);
        retryTimers.set(pageId, timer);
      });
  };

  const attachCanvas = (pageId: string, canvas: HTMLCanvasElement): void => {
    const previous = canvases.get(pageId);
    if (previous !== undefined && previous !== canvas) {
      intersectionObserver?.unobserve(previous);
      controllers.get(pageId)?.abort();
      painted.delete(pageId);
    }
    canvas.dataset.pageId = pageId;
    canvases.set(pageId, canvas);
    intersectionObserver?.observe(canvas);
  };

  createEffect(() => {
    const pages = props.pages;
    void look();
    const live = new Set(pages.map((page) => page.id));
    for (const [pageId, canvas] of canvases) {
      if (live.has(pageId)) continue;
      intersectionObserver?.unobserve(canvas);
      controllers.get(pageId)?.abort();
      controllers.delete(pageId);
      const timer = retryTimers.get(pageId);
      if (timer !== undefined) window.clearTimeout(timer);
      retryTimers.delete(pageId);
      retries.delete(pageId);
      canvases.delete(pageId);
      visible.delete(pageId);
      painted.delete(pageId);
    }
    for (const pageId of visible) request(pageId);
  });

  onMount(() => {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const canvas = entry.target as HTMLCanvasElement;
          const pageId = canvas.dataset.pageId;
          if (!pageId || canvases.get(pageId) !== canvas) continue;
          if (entry.isIntersecting) {
            visible.add(pageId);
            request(pageId);
          } else {
            visible.delete(pageId);
            controllers.get(pageId)?.abort();
            controllers.delete(pageId);
            const timer = retryTimers.get(pageId);
            if (timer !== undefined) window.clearTimeout(timer);
            retryTimers.delete(pageId);
          }
        }
      },
      { root: stripEl, rootMargin: '72px' },
    );
    for (const canvas of canvases.values()) intersectionObserver.observe(canvas);

    let signature = look();
    lookObserver = new MutationObserver(() => {
      const next = pageThumbnailLookSignature(root);
      if (next === signature) return;
      signature = next;
      setLook(next);
    });
    lookObserver.observe(root, {
      attributes: true,
      attributeFilter: [
        'data-theme',
        'data-ink',
        'data-appearance',
        'data-code-frame',
        'data-code-numbers',
        'style',
        'class',
      ],
    });
  });

  onCleanup(() => {
    intersectionObserver?.disconnect();
    lookObserver?.disconnect();
    for (const controller of controllers.values()) controller.abort();
    for (const timer of retryTimers.values()) window.clearTimeout(timer);
  });

  createEffect(() => {
    const spread = props.currentSpread;
    void props.pages.length;
    queueMicrotask(() => {
      const strip = stripEl;
      if (!strip || spread !== props.currentSpread) return;
      const thumbs = strip.querySelectorAll<HTMLElement>('.nb-thumb');
      const first = thumbs[spread * 2];
      const second = thumbs[spread * 2 + 1] ?? first;
      if (!first || !second) return;
      const stripRect = strip.getBoundingClientRect();
      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      if (
        !thumbnailPairNeedsRecentre(
          stripRect.left,
          stripRect.right,
          firstRect.left,
          secondRect.right,
        )
      ) {
        return;
      }
      const pairCenterInContent =
        strip.scrollLeft + (firstRect.left + secondRect.right) / 2 - stripRect.left;
      strip.scrollLeft = pairCenterInContent - strip.clientWidth / 2;
    });
  });

  const label = (page: Page | undefined, slot: number): string =>
    (page === undefined ? undefined : extractHeadings(page.doc)[0]?.text) ??
    `page ${slot + 1}`;

  return (
    <div
      class="nb-thumb-strip"
      data-testid="thumb-strip"
      aria-label="Page thumbnails"
      ref={stripEl}
    >
      <For each={props.pages.map((page) => page.id)}>
        {(pageId, slot) => {
          const page = (): Page | undefined => props.pages.find((item) => item.id === pageId);
          const state = (): PreviewState => states()[pageId] ?? 'idle';
          const hasRaster = (): boolean =>
            state() === 'ready' || state() === 'refreshing' || state() === 'stale';
          return (
            <button
              type="button"
              class="nb-thumb"
              classList={{
                'is-current': Math.floor(slot() / 2) === props.currentSpread,
              }}
              data-tooltip={label(page(), slot())}
              data-tooltip-side="top"
              aria-label={`Jump to ${label(page(), slot())}`}
              onClick={() => props.onJump(slot())}
            >
              <span
                class="nb-thumb-paper"
                classList={{ 'has-raster': hasRaster() }}
                data-thumbnail-source="page-raster"
                data-thumbnail-state={state()}
                data-page-id={pageId}
                aria-busy={state() === 'loading' || state() === 'refreshing'}
              >
                <canvas
                  width={104}
                  height={132}
                  aria-hidden="true"
                  ref={(canvas) => attachCanvas(pageId, canvas)}
                />
                <span class="nb-thumb-number font-label">{slot() + 1}</span>
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
