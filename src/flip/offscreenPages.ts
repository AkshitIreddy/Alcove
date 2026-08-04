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
