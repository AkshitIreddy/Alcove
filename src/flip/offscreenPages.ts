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
import { snapshotPixelRatio } from './math';
import { snapshotBackground } from './paperTone';
import { inlineSvgStyles } from './svgSnapshot';

/** Marker class while capturing; flip.css hides caret/selection under it. */
const SNAPSHOTTING_CLASS = 'snapshotting';

/** Same chrome exclusion as the mounted path, plus the page-full hint. */
const SNAPSHOT_EXCLUDE_SELECTOR =
  '.nb-drag-handle, .nb-style-switcher, .nb-page-full-hint, [data-snapshot-hide]';

/**
 * 1×1 transparent PNG — stand-in for images that fail to inline. As on the
 * mounted path, any alpha it leaves behind resolves to cream in the shader
 * (flip/curl.ts samplePage), never to black.
 */
const TRANSPARENT_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABijPjAAAAAABJRU5ErkJggg==';

/**
 * Skip chrome and un-embeddable images. An `<img>` with an empty src (a
 * media node still resolving its asset) makes html-to-image's inline step
 * reject with a bare error Event — filtering it keeps captures total.
 */
function snapshotFilter(node: HTMLElement): boolean {
  if (
    node instanceof HTMLImageElement &&
    (node.getAttribute('src') ?? '') === ''
  ) {
    return false;
  }
  return (
    typeof node.matches !== 'function' ||
    !node.matches(SNAPSHOT_EXCLUDE_SELECTOR)
  );
}

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
    } catch {
      return null; // staging/rasterization failure → caller's cream fallback
    }
  };
}
