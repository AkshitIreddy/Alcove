/**
 * src/flip/offscreenPages.ts — rasterize pages that are not in the DOM.
 *
 * The flip's back and revealed faces belong to the ADJACENT spread, which
 * is never mounted at rest (the mount contract gives the cache live
 * elements for the two current leaves only). Without a capture path for
 * them, CurlRenderer fell back to blank cream: the turning page's back
 * showed no text and the page uncovered beneath the curl popped into
 * existence only at the landing swap.
 *
 * Reuses the exporter's offscreen staging (withOffscreenPage): a read-only
 * TipTap editor parked at left:-12000px with the same sheet classes as a
 * live leaf, rasterized through the same html-to-image recipe the cache
 * uses for mounted pages — same device-memory-capped pixel ratio, the live
 * paper colour behind it (paperTone.ts), chrome elements filtered out,
 * font-embed CSS built once.
 */

import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import type { PageDoc } from '../data/types';
import {
  measureMountedSheet,
  withOffscreenPage,
  type OffscreenLeafContext,
  type OffscreenPageSize,
} from '../editor/script/exporters/capture';
import { trailingOverflowCount } from '../editor/pagination';
import { visualScale } from '../views/spread';
import { snapshotPixelRatio } from './math';
import { snapshotBackground } from './paperTone';
import {
  SNAPSHOTTING_CLASS,
  TRANSPARENT_PX,
  snapshotFilter,
} from './rasterCache';
import { inlineSvgStyles } from './svgSnapshot';

/*
 * The marker class, the chrome exclusion and the transparent placeholder are
 * the mounted path's — literally, now. This module's whole promise is that a
 * staged sheet rasterizes to the same picture a live one does, and it used to
 * keep that promise by typing the same three values out again (see the note
 * beside them in rasterCache.ts, where one of the copies had already rotted).
 */

export interface OffscreenPageCaptureOptions {
  /** Fetch a page's document from storage; null = page gone/unreadable. */
  loadPageDoc(pageId: string): Promise<PageDoc | null>;
  /**
   * Live leaf size (CSS px) to stage the sheet at so textures align 1:1
   * with the flip overlay. Null/omitted → the largest mounted sheet.
   */
  pageSize?(): OffscreenPageSize | null;
  /**
   * The live `.nb-spread` to stage inside. Without it the staged sheet keeps
   * its standalone geometry (wider side padding, deckled top tear) while the
   * live leaf uses the spread's, so every landing swapped a differently
   * wrapped page for the real one — see OffscreenLeafContext.
   */
  spreadRoot?(): HTMLElement | null;
  /**
   * Defaults to the raster cache's own formula (device ratio capped at 2,
   * 1.5 below 8GB deviceMemory) so offscreen and live bitmaps share texel
   * density. Pass the cache's ratio explicitly if it was overridden.
   */
  pixelRatio?: number;
  /**
   * The page's content budget, `BookView`'s `pageCapacityPx`. Given it, the
   * staged sheet is DRAINED before it is photographed — see `settleStaged`.
   * Omitted, the sheet is photographed exactly as its stored document stands.
   */
  pageCapacityPx?(): number;
  /**
   * Whether `pageId` is eligible for an ahead-of-reader drain NOW. Checked at
   * capture admission and again immediately before the drain is reported, so
   * a capture that straddles navigation cannot mutate a page that was mounted
   * for any part of its lifetime.
   */
  canSettlePage?(pageId: string): boolean;
  /**
   * "This exact source page holds `remove` real blocks more than fit." The
   * source is a compare-and-swap token; the host moves them only if it still
   * owns that document. A persisted final TrailingNode paragraph is named so
   * it can remain on the source. Called only when `remove` is at least 1.
   */
  onTrailingOverflow?(
    pageId: string,
    remove: number,
    source: PageDoc,
    trailingPhantom: 0 | 1,
  ): void;
}

/**
 * Drain the staged sheet the way a mounted leaf drains itself, and say how
 * much came off.
 *
 * WHY A PICTURE OF A PAGE HAS TO KNOW ABOUT PAGINATION. The faces of a flip
 * belong to the adjacent spread, which is never mounted, so they are drawn
 * from the pages' STORED documents. A page that has not been mounted since the
 * reader's window last decided what fits has not been drained yet — and the
 * drain does not merely hide the tail, it MOVES it to the next page, which
 * moves that page's tail on again. So the stored document of every page ahead
 * of an unread reflow is a page from further along the book.
 *
 * That is precisely the defect the temporal review of the demo found five
 * times: the curl finishes and the right leaf shows, for two or three frames,
 * a spread the reader has no business being on — "Four kinds of aside" where
 * "The stationery drawer" was about to land — and then snaps.
 * `scripts/probe-turn-face.mjs` reproduces it on every turn of the Welcome
 * book at 1180×720, and it is invisible to every DOM probe, because during a
 * curl the DOM is not what anybody is looking at.
 *
 * Two things happen here, and they are deliberately different in kind:
 *
 *  - the staged sheet's own trailing children are REMOVED, so the picture that
 *    is about to be taken is the page as it will stand once it has mounted;
 *  - the count is reported to the host, which does the document surgery. This
 *    module owns a photograph, not the reader's book.
 *
 * The measurement is `PageEditor.extractOverflow`'s, in the same laid-out
 * pixels: rect distances divided by the leaf's drawn scale, the prose root's
 * own padding-bottom as the foot that survives the removal. The one case it
 * does NOT reproduce is `splitOverflowingBlock` — a single block taller than
 * the page, which needs the editor's own coordinate mapping to cut. Those
 * pages still settle when they mount, as they always did.
 */
/**
 * `?settleahead=0` puts the faces back to showing the stored document.
 *
 * The same trick as `?railpanels=eager` and `?artworker=0`, and for the reason
 * RailPanel gives: the before and the after of a fix have to be measurable
 * from ONE build, or the comparison quietly includes everything else that
 * changed in the tree between two of them. `scripts/probe-turn-face.mjs` runs
 * both ways at one window size against one book, which is the only way to say
 * that this is what fixed it.
 */
const SETTLE_AHEAD =
  typeof location === 'undefined' || !/[?&]settleahead=0\b/.test(location.search);

function settleStaged(
  sheet: HTMLElement,
  pageId: string,
  doc: PageDoc,
  options: OffscreenPageCaptureOptions,
  admitted: boolean,
): void {
  if (
    !SETTLE_AHEAD ||
    !admitted ||
    options.canSettlePage?.(pageId) === false
  ) {
    return;
  }
  const capacity = options.pageCapacityPx?.();
  const report = options.onTrailingOverflow;
  if (capacity === undefined || !Number.isFinite(capacity) || capacity <= 0) return;
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  const content = Array.isArray(doc.content) ? doc.content : [];
  if (prose === null || content.length < 2) return;

  /*
   * StarterKit's trailing empty paragraph is bookkeeping, whether it was
   * appended while staging OR was already persisted in the PageDoc. The live
   * drain reasons without it (PageEditor.extractOverflow); the staged drain
   * must do the same. Treating a persisted phantom as a real tail moved it to
   * the NEXT page, where it became a visible placeholder line and shifted the
   * whole landing down by 34px (`probe-turn-face`, turn 4).
   */
  const tail = content[content.length - 1] as
    | { type?: unknown; content?: unknown }
    | undefined;
  const trailingPhantom: 0 | 1 =
    content.length > 1 &&
    tail?.type === 'paragraph' &&
    (!Array.isArray(tail.content) || tail.content.length === 0)
      ? 1
      : 0;
  const realCount = content.length - trailingPhantom;
  if (realCount < 2) return;

  const children = Array.from(prose.children);
  // The staged editor gets StarterKit's TrailingNode too, so the DOM can carry
  // one more child than the document has blocks. Anything past the document's
  // own count is that empty line: it is bookkeeping, not ink, and the live
  // drain reasons about the page without it.
  if (children.length < content.length) return;
  const rootRect = prose.getBoundingClientRect();
  const scale = visualScale(rootRect.height, prose.clientHeight);
  const bottoms = children
    .slice(0, realCount)
    .map((child) => (child.getBoundingClientRect().bottom - rootRect.top) / scale);
  const padBottom = Number.parseFloat(getComputedStyle(prose).paddingBottom) || 0;

  const remove = Math.min(
    trailingOverflowCount(bottoms, capacity, padBottom),
    realCount - 1,
  );
  if (remove < 1) return;

  for (let i = realCount - remove; i < realCount; i += 1) {
    children[i]?.remove();
  }
  report?.(pageId, remove, doc, trailingPhantom);
}

/**
 * Build the cache's `captureOffscreen` callback. Staging happens per call
 * (mount → settle two frames + fonts → rasterize → tear down); the cache
 * dedupes concurrent calls per page and LRU-caches the results.
 */
export function createOffscreenPageCapture(
  options: OffscreenPageCaptureOptions,
): (pageId: string) => Promise<ImageBitmap | null> {
  let fontCss: Promise<string> | undefined;
  const pixelRatio =
    options.pixelRatio ??
    snapshotPixelRatio(
      window.devicePixelRatio || 1,
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    );

  return async (pageId) => {
    // Eligibility is a lifetime property, not a callback-time property. A
    // slow stage can start while this is a live leaf and finish after the
    // reader turns; such a page was never ours to drain ahead.
    const admitted = options.canSettlePage?.(pageId) ?? true;
    const doc = await options.loadPageDoc(pageId);
    if (doc === null) return null;
    const size = options.pageSize?.() ?? measureMountedSheet();
    // Everything a mounted leaf is: inside the spread's cascade, paginated,
    // and wearing its own margin doodles. Anything left out here shows up as
    // a jump on the frame the landing swaps this raster for the live page.
    const context: OffscreenLeafContext = {
      host: options.spreadRoot?.() ?? null,
      paginated: true,
      pageId,
    };
    try {
      return await withOffscreenPage(doc, size, async (sheet) => {
        // BEFORE the font work and before the capture: everything below this
        // line is about photographing the sheet, and the sheet is not the page
        // yet (see settleStaged).
        settleStaged(sheet, pageId, doc, options, admitted);
        // Font-embed CSS is built once and reused — the biggest per-capture
        // cost, same policy as the mounted path.
        fontCss ??= getFontEmbedCSS(sheet).catch(() => '');
        const fontEmbedCSS = await fontCss;
        sheet.classList.add(SNAPSHOTTING_CLASS);
        // Diagrams on a staged page hit exactly the same html-to-image hole
        // as on a mounted one: class-styled SVG children clone unstyled and
        // paint black (svgSnapshot.ts). No mutation guard needed here — this
        // sheet is ours and nothing is watching it for edits.
        const restoreSvg = inlineSvgStyles(sheet);
        try {
          const canvas = await toCanvas(sheet, {
            pixelRatio,
            // The staged sheet is inside the live spread, so its own resolved
            // background IS the reader's paper — theme and all. A literal
            // cream here was the offscreen half of the mid-turn colour change
            // (see paperTone.ts).
            backgroundColor: snapshotBackground(sheet),
            fontEmbedCSS,
            imagePlaceholder: TRANSPARENT_PX,
            filter: snapshotFilter,
          });
          return await createImageBitmap(canvas);
        } finally {
          restoreSvg();
          sheet.classList.remove(SNAPSHOTTING_CLASS);
        }
      }, context);
    } catch (err) {
      /*
       * SAY WHY. A bare `catch { return null }` here hid a total failure of
       * this path for as long as it has existed: the back of every turning
       * sheet and every page revealed under a curl were drawn as bare cream,
       * and the only symptom was the reader saying a page they had not visited
       * "shows as a blank white page". Nothing was logged, so a path that threw
       * on every call and a path that was never called looked identical from
       * outside — including to the probes written to find this.
       */
      console.warn('[offscreenPages] staging failed for ' + pageId + ' :: ' + (err instanceof Error ? (err.stack ?? err.message) : String(err)));
      return null; // caller's cream fallback
    }
  };
}
