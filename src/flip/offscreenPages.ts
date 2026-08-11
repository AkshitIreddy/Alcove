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
 * font-embed CSS cached by the family stacks each page actually uses.
 */

import { toCanvas } from 'html-to-image';
import type { PageDoc } from '../data/types';
import { DEFAULT_LINE_HEIGHT_PX } from '../editor/document';
import {
  measureMountedSheet,
  withOffscreenPage,
  type OffscreenLeafContext,
  type OffscreenPageSize,
} from '../editor/script/exporters/capture';
import {
  trailingCompanionCount,
  trailingOverflowCount,
} from '../editor/pagination';
import { loadBacklinks } from '../search/backlinks';
import { visualScale } from '../views/spread';
import { snapshotPixelRatio } from './math';
import { snapshotBackground } from './paperTone';
import {
  SNAPSHOTTING_CLASS,
  TRANSPARENT_PX,
  pageFontEmbedCSS,
  snapshotFilter,
  snapshotStyleProperties,
} from './rasterCache';
import { inlineSvgStyles } from './svgSnapshot';
import { snapshotGridCorrections } from './snapshotFidelity';
import { prepareSnapshotTableChrome } from './snapshotChrome';
import {
  freezeSnapshotBlockGeometry,
  freezeSnapshotInlineBoxes,
  freezeSnapshotListRows,
  freezeSnapshotNodeViewGeometry,
  measureSnapshotBlockGeometry,
  measureSnapshotInlineBoxes,
  measureSnapshotListRows,
  measureSnapshotNodeViewGeometry,
} from './snapshotGeometry';

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
  pageSize?(pageId: string): OffscreenPageSize | null;
  /**
   * Which physical leaf this page occupies in the scene. The spread has
   * side-specific fore-edge/padding rules, so omitting this can reflow text in
   * the texture even when width and document are otherwise identical.
   */
  pageSide?(pageId: string): 'left' | 'right' | undefined;
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

const ORDINARY_PROSE_SELECTOR = 'p, h1, h2, h3, h4, ul, ol, blockquote';

/**
 * Apply PageEditor's measured grid decoration to an owned staged sheet. The
 * staged read-only editor does not install the live plugin; without this
 * mirror its curl texture and the landed prose occupy different baselines.
 */
export function alignStagedProse(sheet: HTMLElement, pitch: number): number {
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  if (prose === null) return 0;
  const children = Array.from(prose.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  for (const child of children) {
    child.removeAttribute('data-nb-grid-snap');
    child.style.removeProperty('--nb-grid-snap');
  }
  const rootRect = prose.getBoundingClientRect();
  const scale = visualScale(rootRect.height, prose.clientHeight);
  const corrections = snapshotGridCorrections(
    children.map((child) => ({
      ordinary: child.matches(ORDINARY_PROSE_SELECTOR),
      top: (child.getBoundingClientRect().top - rootRect.top) / scale,
    })),
    pitch,
  );
  for (const { index, pixels } of corrections) {
    const child = children[index]!;
    const value = pixels.toFixed(2);
    child.dataset.nbGridSnap = value;
    child.style.setProperty('--nb-grid-snap', `${value}px`);
  }
  return corrections.length;
}

/**
 * Preserve list row advance through html-to-image's computed-style clone.
 *
 * Page prose uses positive top padding plus an equal negative bottom margin
 * to place glyphs on the printed rule without changing the 32px flow rhythm.
 * html-to-image copies an LI's computed border-box height as an explicit
 * height, defeating that overlap in its clone: four one-line rows become four
 * 39.5px rows and the last is painted underneath the following card.
 *
 * Staged sheets are hidden and owned by the snapshot pipeline. Freeze each
 * measured source-DOM row advance there—not at a fixed pitch—so wrapped and
 * nested list items keep their real geometry without touching the live editor.
 */
export function freezeStagedListRows(sheet: HTMLElement): number {
  return freezeSnapshotListRows(sheet);
}

/**
 * Make the staged top-level flow independent of margin collapsing.
 *
 * html-to-image does not carry the app stylesheet into its foreignObject. It
 * copies every element's computed height and margins as inline declarations.
 * That sounds equivalent, but it changes CSS margin-collapsing: an auto-sized
 * node view followed by a list loses the half-line that separated them in the
 * live editor, and every later block is painted 8px high. The source staging
 * DOM can therefore measure perfectly while the bitmap it produces still
 * jumps as soon as the GL scene replaces the live leaves.
 *
 * This sheet is owned and hidden by the snapshot pipeline, so freeze its
 * measured border boxes into one unambiguous flow before cloning: every block
 * gets the exact measured top, left, width and height as absolute geometry.
 * Negative heading overlaps are preserved just as deliberately as positive
 * feature gaps. The clone now has one layout answer in both documents.
 */
export function freezeStagedBlockFlow(sheet: HTMLElement): number {
  return freezeSnapshotBlockGeometry(sheet).length;
}

function backlinkWords(count: number): string {
  return count === 1 ? '1 page links here' : `${count} pages link here`;
}

/**
 * Mount the collapsed page furniture that PageEditor normally owns outside
 * `.nb-page-editor`. Adjacent leaves have no PageEditor, so the offscreen
 * stage must supply it before pagination and rasterization.
 */
export function mountStagedBacklinks(sheet: HTMLElement, count: number): void {
  const page = sheet.querySelector<HTMLElement>('.nb-page');
  if (page === null || count < 1 || !Number.isFinite(count)) return;

  page.style.setProperty('--nb-backlink-rail', 'var(--nb-backlink-tab-h)');
  const backlinks = document.createElement('div');
  backlinks.className = 'nb-backlinks';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nb-backlink-tab';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', backlinkWords(count));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'nb-backlink-mark');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = (d: string, join = false): SVGPathElement => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    element.setAttribute('d', d);
    element.setAttribute('fill', 'none');
    element.setAttribute('stroke', 'currentColor');
    element.setAttribute('stroke-width', '1.9');
    element.setAttribute('stroke-linecap', 'round');
    if (join) element.setAttribute('stroke-linejoin', 'round');
    return element;
  };
  svg.append(
    path('M20 5.4 C 20.6 9.2 19.4 12.6 16.4 14.4 C 13.2 16.3 9.4 16.8 5.2 16.4'),
    path('M9.6 11.6 C 7.9 13.2 6.4 14.8 5.2 16.4 C 6.6 17.9 8.2 19.3 10 20.6', true),
  );

  const label = document.createElement('span');
  label.className = 'nb-backlink-count font-ui';
  label.textContent = backlinkWords(count);
  button.append(svg, label);
  backlinks.append(button);
  page.append(backlinks);
}

/**
 * Restore the leaf-owned portal target before offscreen node views finish
 * mounting. Free stickers and page marks are document nodes, but their pixels
 * live in this sibling layer on a real BookView leaf; without it the snapshot
 * scene silently loses them while ordinary inline node views remain.
 */
export function mountStagedFreeLayer(sheet: HTMLElement): HTMLElement {
  const existing = sheet.querySelector<HTMLElement>(':scope > .nb-free-layer');
  if (existing !== null) return existing;
  const layer = document.createElement('div');
  layer.className = 'nb-free-layer';
  layer.setAttribute('role', 'group');
  layer.setAttribute('aria-label', 'Stickers and trim placed on this page');
  sheet.prepend(layer);
  return layer;
}

const snapshotFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

function mediaReady(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve();
  const loadOrError = (): Promise<void> => new Promise((resolve) => {
    const done = (): void => resolve();
    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
  });
  if (typeof image.decode !== 'function') return loadOrError();
  return image.decode().catch(() => (image.complete ? undefined : loadOrError()));
}

/**
 * Scene readiness barrier for portalled/custom node views and their media.
 * withOffscreenPage's first image wait happens before this callback; the free
 * layer is deliberately added here, so its node-view images need their own
 * bounded decode pass before html-to-image clones the sheet.
 */
export async function settleStagedSnapshotScene(
  sheet: HTMLElement,
  capMs = 2000,
): Promise<void> {
  mountStagedFreeLayer(sheet);
  // useFreeLayer retries on rAF; one frame discovers the target, one commits
  // Solid's Portal children and custom-node-view paint.
  await snapshotFrame();
  await snapshotFrame();
  const media = Array.from(sheet.querySelectorAll<HTMLImageElement>('img')).filter(
    (image) => image.src !== '' || image.currentSrc !== '',
  );
  if (media.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, capMs));
    });
    await Promise.race([
      Promise.allSettled(media.map(mediaReady)).then(() => undefined),
      cap,
    ]);
    if (timer !== undefined) clearTimeout(timer);
  }
  await snapshotFrame();
}

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

  const overflowCount = Math.min(
    trailingOverflowCount(bottoms, capacity, padBottom),
    realCount - 1,
  );
  const textOf = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(textOf).join(' ');
    if (value === null || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    return `${typeof record.text === 'string' ? record.text : ''} ${textOf(record.content)}`
      .replace(/\s+/g, ' ')
      .trim();
  };
  const companionCount = trailingCompanionCount(
    content.slice(0, realCount).map((block) => {
      const record = block as Record<string, unknown>;
      return {
        type: typeof record.type === 'string' ? record.type : '',
        text: textOf(block),
      };
    }),
    overflowCount,
  );
  const remove = Math.min(overflowCount + companionCount, realCount - 1);
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
    const size = options.pageSize?.(pageId) ?? measureMountedSheet();
    // Everything a mounted leaf is: inside the spread's cascade, paginated,
    // and wearing its own margin doodles. Anything left out here shows up as
    // a jump on the frame the landing swaps this raster for the live page.
    const context: OffscreenLeafContext = {
      host: options.spreadRoot?.() ?? null,
      side: options.pageSide?.(pageId),
      paginated: true,
      pageId,
    };
    try {
      return await withOffscreenPage(doc, size, async (sheet) => {
        // BEFORE the font work and before the capture: everything below this
        // line is about photographing the sheet, and the sheet is not the page
        // yet (see settleStaged).
        mountStagedFreeLayer(sheet);
        const backlinks = await loadBacklinks(pageId);
        mountStagedBacklinks(sheet, backlinks.length);
        const storedPitch: unknown = doc.attrs?.lineHeightPx;
        const pitch =
          typeof storedPitch === 'number' && Number.isFinite(storedPitch)
            ? storedPitch
            : DEFAULT_LINE_HEIGHT_PX;
        alignStagedProse(sheet, pitch);
        settleStaged(sheet, pageId, doc, options, admitted);
        // The drain may remove the first ordinary block after a special one;
        // re-derive the decorations from the exact DOM that will be painted.
        alignStagedProse(sheet, pitch);
        await settleStagedSnapshotScene(sheet);
        // Portal/media/node-view paint may change a feature block's height.
        // Derive the grid and the frozen flow from the final pixels, not the
        // construction frame that preceded them.
        alignStagedProse(sheet, pitch);
        const blockGeometry = measureSnapshotBlockGeometry(sheet);
        const listGeometry = measureSnapshotListRows(sheet);
        const nodeViewGeometry = measureSnapshotNodeViewGeometry(sheet);
        const inlineGeometry = measureSnapshotInlineBoxes(sheet);
        freezeSnapshotListRows(sheet, listGeometry);
        freezeSnapshotInlineBoxes(sheet, inlineGeometry);
        // See the mounted path: node-view internals establish a relative
        // containing block, then the top-level pass remains final authority
        // over the card/diagram owner's page position.
        freezeSnapshotNodeViewGeometry(sheet, nodeViewGeometry);
        freezeSnapshotBlockGeometry(sheet, blockGeometry);
        const fontEmbedCSS = await pageFontEmbedCSS(sheet);
        sheet.classList.add(SNAPSHOTTING_CLASS);
        // Diagrams on a staged page hit exactly the same html-to-image hole
        // as on a mounted one: class-styled SVG children clone unstyled and
        // paint black (svgSnapshot.ts). No mutation guard needed here — this
        // sheet is ours and nothing is watching it for edits.
        const restoreSvg = inlineSvgStyles(sheet);
        const restoreTableChrome = prepareSnapshotTableChrome(sheet);
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
            // html-to-image caches the first property list process-wide. All
            // three page capture paths must therefore enter through the same
            // contract, regardless of which one happens to photograph first.
            includeStyleProperties: snapshotStyleProperties(),
          });
          return await createImageBitmap(canvas);
        } finally {
          restoreTableChrome();
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
