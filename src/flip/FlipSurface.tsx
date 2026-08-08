/**
 * src/flip/FlipSurface.tsx — Solid wrapper around the page-flip engine.
 *
 * Renders the spread's two live leaves, the WebGL canvas overlay
 * (display:none at rest, z-index --z-flip) and the edge hotspots, and owns
 * the PageFlipController + PageRasterCache lifecycle.
 *
 * ============================== MOUNT CONTRACT ==============================
 * (for BookView integration — done by the orchestrator, not this module)
 *
 * ```tsx
 * <FlipSurface
 *   ref={(api) => (flipApi = api)}
 *   spreadIndex={spreadIndex()}
 *   pageIds={{
 *     left: leftPage()?.id ?? null,      // ids double as raster-cache keys
 *     right: rightPage()?.id ?? null,
 *     nextLeft: ..., nextRight: ...,     // pages behind the right leaf
 *     prevLeft: ..., prevRight: ...,     // pages before the left leaf
 *   }}
 *   getPageElement={(side) => sheetPaperEl(side)}  // the .nb-sheet-paper
 *   loadPageDoc={(id) => getPage(id).then((p) => p?.doc ?? null)}  // for flip backs
 *   onNavigate={(dir) => setSpreadIndex((i) => i + (dir === 'next' ? 1 : -1))}
 *   leftPage={<PageEditor pageId=... />}   // omit for single-page books
 *   rightPage={<PageEditor pageId=... />}
 * />
 * ```
 *
 * Rules the host must follow:
 * 1. LAYOUT — FlipSurface renders `.nb-flip-leaf-left` / `-right` wrappers
 *    side by side (flex). Each `<sidePage>` JSX must FILL its leaf wrapper,
 *    and `getPageElement(side)` must return that page's `.nb-sheet-paper`
 *    (the element html-to-image rasterizes; it should cover the leaf rect
 *    so textures align 1:1 with the DOM).
 * 2. KEYED REMOUNT — page content must be keyed by page id (PageEditor
 *    props are read once at mount, and it flushes its debounced save on
 *    unmount per docs/design/block-editor.md §8). `onNavigate` updates the
 *    host store; Solid remounts the leaves synchronously before the moving
 *    canvas is removed in that task — that unmount is what flushes pending
 *    edits.
 * 3. `onNavigate` must be SYNCHRONOUS store work (no await): the controller
 *    calls it, reveals the exact live leaves and removes the moving canvas in
 *    one task. The first flat paint is therefore the real destination. Page
 *    data should already be in memory (the host preloads adjacent pages).
 * 4. `pageIds` null means "no page there" (e.g. cover): flipping renders a
 *    plain cream face. Omit `nextLeft`+`nextRight` as null to disable
 *    forward flips (same for prev), or pass `canFlip` for custom gating.
 * 5. The surface must live inside the opened-book overlay (position
 *    relative context). The canvas overlays only this surface's box.
 * 6. Editors keep working at rest — the engine touches them only during a
 *    flip (blur on start, selection restore on cancel).
 * ===========================================================================
 */

import { createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import { PageFlipController, type FlipPages, type LeafSide } from './PageFlipController';
import { PageRasterCache, type RasterEntry } from './rasterCache';
import { createOffscreenPageCapture } from './offscreenPages';
import { measureUntransformedSheet } from '../editor/script/exporters/capture';
import type { PageDoc } from '../data/types';
import { type FlipDirection } from './math';
import { flipSnapshotSceneIds } from './scene';
import '../styles/flip.css';

export interface SpreadPageIds {
  left: string | null;
  right: string | null;
  /** Pages behind the current right leaf ('next' flip textures). */
  nextLeft?: string | null;
  nextRight?: string | null;
  /** Pages before the current left leaf ('prev' flip textures). */
  prevLeft?: string | null;
  prevRight?: string | null;
}

export interface FlipSurfaceApi {
  /** Animated flip forward. Not bound to a key — see the removal note above onMount. */
  flipNext(): void;
  /** Animated flip backward. Not bound to a key — see the removal note above onMount. */
  flipPrev(): void;
  /** Mark every known page snapshot stale and re-rasterize during idle. */
  invalidateSnapshots(): void;
  /**
   * Peek a page's cached snapshot without disturbing LRU order (thumbnails
   * strip, roadmap #10). Only pages that have been mounted since the book
   * opened can have one — callers need a placeholder fallback.
   */
  getSnapshot(pageId: string): RasterEntry | undefined;
  /**
   * Re-stage ONE page, by id, whether or not it is in the flip's own six-page
   * window — which is how a settle chases its own target.
   *
   * Staging a page drains it (`offscreenPages.settleStaged`) and reports what
   * came off, so the host can move it onward; that carry lands on the NEXT
   * page, which may be well outside the window and would otherwise not be
   * looked at until the reader had almost reached it. Measured with
   * `probe-turn-face.mjs`: without this the reflow ran exactly one spread ahead
   * of the reader and a probe turning every three seconds outran it twice in
   * six turns. `notifyEdited` rather than `ensure` because the doc has just
   * changed and the cached bitmap is of the old one.
   */
  settlePage(pageId: string): void;
}

export interface FlipSurfaceProps {
  /** Left page content; omit for single-page books (cover-style layouts). */
  leftPage?: JSX.Element;
  rightPage: JSX.Element;
  /** Snapshot root per side — the mounted page's `.nb-sheet-paper`. */
  getPageElement(side: LeafSide): HTMLElement | null;
  /** Commit navigation in the host store (synchronous). */
  onNavigate(direction: FlipDirection): void;
  /** Current spread index — changing it re-arms adjacent-page snapshots. */
  spreadIndex: number;
  /** Page ids (cache keys + navigability); see mount contract. */
  pageIds?: SpreadPageIds;
  /**
   * Resolve an unmounted page's document so its snapshot can be staged
   * offscreen. Without it the flip's back/revealed faces (the adjacent
   * spread, never in the DOM at rest) fall back to blank cream.
   */
  loadPageDoc?(pageId: string): Promise<PageDoc | null>;
  /**
   * The page content budget (`BookView`'s `pageCapacityPx`). With it, a page
   * staged for its snapshot is DRAINED first, so the faces of a flip show the
   * pages as they will stand once they mount rather than as they were stored
   * before the reader's window decided what fits (offscreenPages.settleStaged).
   */
  pageCapacityPx?: number;
  /**
   * "The page staged for its snapshot holds `remove` real blocks more than
   * fit." The exact source document is the compare-and-swap token; the host
   * moves the blocks only if that document is still current. A final persisted
   * TrailingNode paragraph is reported separately so it stays on the source.
   */
  onAheadOverflow?(
    pageId: string,
    remove: number,
    source: PageDoc,
    trailingPhantom: 0 | 1,
  ): void;
  /** QA-only state owned by the host's serialized ahead-page carry queue. */
  aheadWorkState?(): { pending: number; revision: number };
  /** Optional override for direction gating. */
  canFlip?(direction: FlipDirection): boolean;
  ref?: (api: FlipSurfaceApi) => void;
}

export default function FlipSurface(props: FlipSurfaceProps): JSX.Element {
  let rootEl!: HTMLDivElement;
  let leftLeafEl!: HTMLDivElement;
  let rightLeafEl!: HTMLDivElement;
  let canvasEl!: HTMLCanvasElement;

  /**
   * The leaf children are read EXACTLY ONCE (component bodies run untracked,
   * so this takes no dependency on the host's signals).
   *
   * Why this matters (wave-2 caret-carry bug): the host builds these props
   * with a call expression (`leafFace('left', leftPage)`), so Solid compiles
   * them into getters — and evaluating one MOUNTS a whole leaf, including a
   * live TipTap editor that registers itself in src/editor/instances. Any
   * second read (the old `props.leftPage === undefined` inside a classList
   * effect) built a throwaway duplicate leaf on every keystroke, whose
   * detached editor clobbered the registry entry the caret carry needs.
   * Per the mount contract the leaf JSX is stable; keyed remounts happen
   * INSIDE it.
   */
  const leftChild = props.leftPage;
  const rightChild = props.rightPage;
  const hasLeft = leftChild !== undefined;

  const ids = (): SpreadPageIds =>
    props.pageIds ?? {
      // No ids supplied: key snapshots by spread slot so the engine still
      // works; adjacent textures fall back to plain paper.
      left: `spread:${props.spreadIndex}:left`,
      right: `spread:${props.spreadIndex}:right`,
    };

  const canFlip = (dir: FlipDirection): boolean => {
    if (props.canFlip) return props.canFlip(dir);
    if (!props.pageIds) return true;
    const current = ids();
    return dir === 'next'
      ? (current.nextLeft ?? null) !== null || (current.nextRight ?? null) !== null
      : (current.prevLeft ?? null) !== null || (current.prevRight ?? null) !== null;
  };

  const getFlipPages = (dir: FlipDirection): FlipPages | null =>
    canFlip(dir) ? flipSnapshotSceneIds(dir, ids()) : null;

  const sideForPage = (pageId: string): 'left' | 'right' | undefined => {
    const current = ids();
    if (
      pageId === current.left ||
      pageId === current.nextLeft ||
      pageId === current.prevLeft
    ) {
      return 'left';
    }
    if (
      pageId === current.right ||
      pageId === current.nextRight ||
      pageId === current.prevRight
    ) {
      return 'right';
    }
    return undefined;
  };

  // Read once, like the leaf children: a plain function prop, not JSX.
  const loadPageDoc = props.loadPageDoc;
  const cache = new PageRasterCache({
    getElement: (pageId) => {
      const current = ids();
      if (pageId === current.left) return props.getPageElement('left');
      if (pageId === current.right) return props.getPageElement('right');
      return null; // adjacent pages are not mounted at rest
    },
    ...(loadPageDoc !== undefined
      ? {
          captureOffscreen: createOffscreenPageCapture({
            loadPageDoc: (pageId) => loadPageDoc(pageId),
            // Stage each page at the exact size of the PHYSICAL SIDE it will
            // occupy. This used to measure every texture from the right leaf;
            // fractional flex allocation and side-specific padding then made
            // a left snapshot rewrap/move text as soon as GL replaced DOM.
            pageSize: (pageId) => {
              const side = sideForPage(pageId) ?? 'right';
              const el = props.getPageElement(side);
              if (el === null) return null;
              const size = measureUntransformedSheet(el);
              return size.width > 1 && size.height > 1 ? size : null;
            },
            pageSide: sideForPage,
            // …and INSIDE the spread, so the staged sheet inherits the same
            // cascade a mounted leaf does. Staged on <body> it kept the
            // standalone sheet geometry, wrapped its text at different words,
            // and every landing swapped that for the live page — the flicker.
            spreadRoot: () => rootEl?.closest<HTMLElement>('.nb-spread') ?? null,
            // …and paginated like one. Without these two the faces of a flip
            // are the pages as they were STORED, which for anything the reader
            // has not reached yet is a page from further along the book (see
            // offscreenPages.settleStaged, and probe-turn-face.mjs).
            pageCapacityPx: () => props.pageCapacityPx ?? 0,
            // Only pages that stayed outside the mounted spread for the whole
            // capture may be drained here. createOffscreenPageCapture checks
            // this once at admission and once immediately before reporting.
            canSettlePage: (pageId) => {
              const current = ids();
              return pageId !== current.left && pageId !== current.right;
            },
            onTrailingOverflow: (pageId, remove, source, trailingPhantom) =>
              props.onAheadOverflow?.(pageId, remove, source, trailingPhantom),
          }),
        }
      : {}),
  });

  /*
   * QA BRIDGE — what the curl will actually have to draw with.
   *
   * The blank-page report ("a page I haven't seen before shows as a blank white
   * page during the turn") is invisible to every probe written so far, and the
   * reason is structural: during a curl the leaf is `visibility: hidden` and
   * what the reader sees is the CANVAS TEXTURE. A probe sampling the live DOM
   * sees inked leaves and reports nothing wrong, however blank the sheet on
   * screen is. Reading the WebGL canvas back is not an option either — the
   * context is created without `preserveDrawingBuffer`, so a read after the
   * frame returns empty and would manufacture the very bug being hunted.
   *
   * So the cache answers directly: for the faces a flip in `dir` needs, is
   * there a bitmap? A `null` here is exactly the condition that draws bare
   * paper. Handed out from the module that OWNS the cache, for the reason
   * CLAUDE.md gives for every other bridge — a probe's own import can resolve
   * to a second copy of the module on a dev server that has served HMR, and
   * that copy's cache is empty no matter what the app has.
   *
   * Gated on the same `?fx=force` override the shelf's bridges use, so it is
   * absent from an ordinary run.
   */
  onMount(() => {
    if (new URLSearchParams(window.location.search).get('fx') === null) return;
    (globalThis as Record<string, unknown>)['__flipCache'] = {
      /** Do the faces a flip in this direction needs have textures yet? */
      facesFor: (dir: FlipDirection) => {
        const pages = getFlipPages(dir);
        if (pages === null) return null;
        const has = (id: string | null): boolean =>
          id === null ? true : cache.get(id) !== undefined;
        const state = cache.qaState([
          pages.stationary,
          pages.front,
          pages.back,
          pages.revealed,
        ]);
        const ahead = props.aheadWorkState?.() ?? { pending: 0, revision: 0 };
        return {
          stationary: pages.stationary,
          front: pages.front,
          back: pages.back,
          revealed: pages.revealed,
          hasStationary: has(pages.stationary),
          hasFront: has(pages.front),
          hasBack: has(pages.back),
          hasRevealed: has(pages.revealed),
          fresh: state.fresh,
          quiet: state.quiet,
          aheadPending: ahead.pending,
          token: `${state.token}|ahead:${ahead.revision}`,
        };
      },
      /** Forget everything, so a probe can ask what a cold book does. */
      clear: () => cache.dispose(),
    };
  });

  let controller: PageFlipController | undefined;

  const api: FlipSurfaceApi = {
    flipNext: () => controller?.flipNext(),
    flipPrev: () => controller?.flipPrev(),
    invalidateSnapshots: () => {
      const current = ids();
      for (const id of [
        current.left,
        current.right,
        current.nextLeft,
        current.nextRight,
        current.prevLeft,
        current.prevRight,
      ]) {
        if (id) cache.notifyEdited(id);
      }
    },
    getSnapshot: (pageId) => cache.peek(pageId),
    settlePage: (pageId) => cache.notifyEdited(pageId),
  };

  /*
   * THERE USED TO BE A `window` keydown LISTENER HERE, arrow-turning the page
   * on its own — independent of, and unknown to, `arrowFlipAction` in
   * `views/spread.ts`. Two bindings doing the same thing from two files is how
   * the removal of arrow-key page turns (the owner's ruling — see spread.ts's
   * header) went in everywhere else and still left the arrows working here.
   *
   * Found by `tests/e2e/pages.spec.ts`'s "arrow keys do not turn the page",
   * which was written to invert the OLD passing test rather than delete it,
   * on the reasoning that a removal nothing watches is a removal that comes
   * back. It caught exactly that: red against a tree where every other arrow
   * binding was already gone. `--repeat-each=2 --retries=0` twice, not a
   * flake — 0 -> 1 on every ArrowRight, same assertion both times.
   *
   * Turning a page is `.nb-flip-hotspot-next`/`-prev` (pointer taps and drags,
   * both wired below) and the corner curl. Nothing here needs to see a key.
   */

  onMount(() => {
    controller = new PageFlipController({
      root: rootEl,
      canvas: canvasEl,
      cache,
      getLeafElement: (side) => (side === 'left' ? leftLeafEl : rightLeafEl),
      getFlipPages,
      navigate: (dir) => props.onNavigate(dir),
    });
    props.ref?.(api);
  });

  // Per-spread arming: eagerly rasterize the settled spread + neighbours
  // (both directions start instantly) and watch the live pages for edits
  // (debounce 300ms → idle re-rasterize, inside the cache).
  createEffect(() => {
    void props.spreadIndex; // track spread changes
    const current = ids();
    queueMicrotask(() => {
      cache.ensureAdjacent([
        current.left,
        current.right,
        current.nextLeft,
        current.nextRight,
        current.prevLeft,
        current.prevRight,
      ]);
    });

    const observers: MutationObserver[] = [];
    for (const side of ['left', 'right'] as const) {
      const pageId = side === 'left' ? current.left : current.right;
      const element = props.getPageElement(side);
      if (!pageId || !element) continue;
      const observer = new MutationObserver(() => cache.notifyEdited(pageId));
      observer.observe(element, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      observers.push(observer);
    }
    onCleanup(() => observers.forEach((observer) => observer.disconnect()));
  });

  /**
   * A settings change repaints every page and touches no page.
   *
   * `applySettings` writes `data-theme` / `data-ink` on `<html>`, the body font
   * stack and size as inline custom properties on the same element, and the
   * minimalist / no-doodles classes beside them. All of it re-renders the
   * leaves — a theme swaps every colour on the page, a font size re-wraps every
   * line — and NONE of it is a mutation inside `.nb-sheet-paper`, so the
   * per-leaf observers above never fire and the cached snapshots stay in the
   * old look. The reader then turns a page and watches it change colour and
   * change back, which is the report this exists for (see flip/paperTone.ts).
   *
   * Marking them edited runs the normal path: debounce, then re-rasterize at
   * idle. `paperToneTag()` in the cache's freshness check is the backstop for
   * the window before that lands.
   *
   * WHY A SIGNATURE RATHER THAN "the style attribute changed": `<html>`'s
   * inline style is also where `rail/panelPush.ts` publishes `--nb-panel-push`
   * on every GSAP tick of a panel slide. Watching the attribute alone would
   * hand this callback a hundred notifications per slide and re-rasterize both
   * leaves for a panel that changed nothing about the page. Only the six values
   * that can actually change a captured pixel are compared, and all of them are
   * read off the element itself — never through getComputedStyle, which would
   * force a style recalculation inside a mutation callback mid-tween.
   */
  onMount(() => {
    const root = document.documentElement;
    const lookSignature = (): string =>
      [
        root.getAttribute('data-theme') ?? '',
        root.getAttribute('data-ink') ?? '',
        root.className,
        root.style.getPropertyValue('--font-body'),
        root.style.getPropertyValue('--text-body'),
      ].join('|');

    let signature = lookSignature();
    const observer = new MutationObserver(() => {
      const next = lookSignature();
      if (next === signature) return;
      signature = next;
      api.invalidateSnapshots();
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-ink', 'style', 'class'],
    });
    onCleanup(() => observer.disconnect());
  });

  onCleanup(() => {
    controller?.destroy();
    controller = undefined;
    cache.dispose(); // drops every bitmap when the book closes
  });

  return (
    <div class="nb-flip-surface" ref={rootEl}>
      <div
        class="nb-flip-leaf nb-flip-leaf-left"
        classList={{ 'is-empty': !hasLeft }}
        ref={leftLeafEl}
      >
        {leftChild}
      </div>
      <div class="nb-flip-leaf nb-flip-leaf-right" ref={rightLeafEl}>
        {rightChild}
      </div>
      <div
        class="nb-flip-hotspot nb-flip-hotspot-prev"
        classList={{ 'is-disabled': !canFlip('prev') }}
        aria-hidden="true"
      />
      <div
        class="nb-flip-hotspot nb-flip-hotspot-next"
        classList={{ 'is-disabled': !canFlip('next') }}
        aria-hidden="true"
      />
      <canvas class="nb-flip-canvas" ref={canvasEl} aria-hidden="true" />
    </div>
  );
}
