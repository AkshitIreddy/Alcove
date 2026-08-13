/**
 * src/editor/script/exporters/capture.ts — page rasterization for export.
 *
 * Reuses the flip snapshot approach (html-to-image toCanvas, font-embed CSS
 * cached by each page's used family stacks, chrome elements filtered out) at
 * a fixed 2x pixel ratio —
 * roadmap items 23/24 want print-quality output, not the flip's
 * device-memory-capped ratio.
 *
 * Two capture paths:
 * - `capturePagePng` / `capturePageJpeg`: rasterize a *mounted* page sheet.
 * - `withOffscreenPage`: mount a page doc into an offscreen read-only editor
 *   (same schema/extensions as the live editor, same sheet CSS classes),
 *   run a capture, dispose. Used by the whole-book PDF export where most
 *   pages are not in the DOM.
 */
import { Editor, type JSONContent } from '@tiptap/core';
import { toCanvas } from 'html-to-image';
import { settings } from '../../../data/settings';
import type { PageDoc, PageStyle } from '../../../data/types';
import {
  DEFAULT_LINE_HEIGHT_PX,
  DEFAULT_PAGE_STYLE,
  clampRuleGapPx,
  isPageStyle,
  normalizePageDoc,
} from '../../document';
import { mountMarginDoodles } from '../../effects/doodles';
import { createEditorExtensions } from '../../extensions';
import {
  SNAPSHOTTING_CLASS,
  TRANSPARENT_PX,
  pageFontEmbedCSS,
  snapshotFilter,
  snapshotStyleProperties,
} from '../../../flip/rasterCache';
import { inlineSvgStyles } from '../../../flip/svgSnapshot';
import type { OffscreenPageSize } from './pageGeometry';

export {
  measureMountedSheet,
  measureUntransformedSheet,
} from './pageGeometry';
export type { OffscreenPageSize } from './pageGeometry';

/** Export pixel ratio (roadmap: "reuse snapshot pipeline at 2x"). */
export const EXPORT_PIXEL_RATIO = 2;

/**
 * tokens.css --paper-cream — captures must match the resting page color.
 *
 * Deliberately NOT `paperTone.ts`'s live token, which is what the flip reads:
 * a flip has to match whatever paper is on screen this second, while an export
 * is a picture of a page ON PARCHMENT regardless of the room the reader
 * happens to be sitting in. That much an exporter is allowed to decide for
 * itself. What it is NOT allowed to decide for itself is what counts as
 * chrome and what stands in for an image that will not inline — those are
 * imported above, because an exported PNG and a mid-flip texture of the same
 * page are supposed to be the same picture.
 */
const PAPER_CREAM = '#f7f1e3';

export interface CapturedImage {
  bytes: Uint8Array;
  /** Canvas pixel width (CSS px × pixel ratio). */
  width: number;
  height: number;
}

/**
 * True when an element has real layout to rasterize. A leaf that is
 * mid-mount, collapsed (`.nb-flip-leaf-left.is-empty`) or hidden measures
 * 0×0 — html-to-image happily produces a 0×0 canvas for it and `toBlob`
 * then yields null, so callers must check first.
 */
export function isCapturable(element: HTMLElement | null): boolean {
  return (
    element !== null &&
    element.isConnected &&
    element.clientWidth > 1 &&
    element.clientHeight > 1
  );
}

async function captureCanvas(element: HTMLElement): Promise<HTMLCanvasElement> {
  if (!isCapturable(element)) {
    throw new Error(
      `capture: element has no layout (${element.clientWidth}×${element.clientHeight})`,
    );
  }
  const fontEmbedCSS = await pageFontEmbedCSS(element);
  element.classList.add(SNAPSHOTTING_CLASS);
  const restoreSvg = inlineSvgStyles(element);
  try {
    return await toCanvas(element, {
      pixelRatio: EXPORT_PIXEL_RATIO,
      backgroundColor: PAPER_CREAM,
      fontEmbedCSS,
      imagePlaceholder: TRANSPARENT_PX,
      filter: snapshotFilter,
      // html-to-image's style-property cache is global, so an export capture
      // must establish the same narrowed list as mounted/offscreen flip pages.
      includeStyleProperties: snapshotStyleProperties(),
    });
  } finally {
    restoreSvg();
    element.classList.remove(SNAPSHOTTING_CLASS);
  }
}

function canvasToBytes(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(
            new Error(
              `canvas.toBlob returned null (${canvas.width}×${canvas.height})`,
            ),
          );
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve(new Uint8Array(buffer)))
          .catch(reject);
      },
      type,
      quality,
    );
  });
}

/** Rasterize a mounted page sheet to PNG bytes at 2x. */
export async function capturePagePng(
  element: HTMLElement,
): Promise<CapturedImage> {
  const canvas = await captureCanvas(element);
  return {
    bytes: await canvasToBytes(canvas, 'image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

/** Rasterize a mounted page sheet to JPEG bytes at 2x (PDF embedding). */
export async function capturePageJpeg(
  element: HTMLElement,
  quality = 0.92,
): Promise<CapturedImage> {
  const canvas = await captureCanvas(element);
  return {
    bytes: await canvasToBytes(canvas, 'image/jpeg', quality),
    width: canvas.width,
    height: canvas.height,
  };
}

// ---------------------------------------------------------------------------
// Offscreen page rendering (whole-book export)
// ---------------------------------------------------------------------------

/**
 * How faithfully the staged sheet has to impersonate a mounted leaf.
 *
 * A bare `.nb-sheet-paper` on `<body>` is NOT what a page looks like inside a
 * book: spread.css reshapes the sheet for life between covers through
 * DESCENDANT selectors (`.nb-spread .nb-sheet-paper`, `.nb-spread .nb-page`,
 * …) — tighter side padding, no deckled tear, flex column. Staged outside the
 * spread none of that applies, so the same document rasterized offscreen came
 * out with the text column 12px in from each side and every paragraph wrapped
 * at a different word. The flip's back and revealed faces are exactly those
 * offscreen rasters, so each landing swapped that mis-wrapped page for the
 * live one and the whole spread visibly jumped: the "flicker after a turn".
 *
 * Pass `host` (the live `.nb-spread`) and the staged sheet inherits the real
 * cascade instead of a copy of it that can rot.
 */
export interface OffscreenLeafContext {
  /** Ancestor to stage inside, so the same descendant rules apply. */
  host?: HTMLElement | null;
  /** `data-side` on the sheet — the spread styles each fore-edge separately. */
  side?: 'left' | 'right';
  /** Mirrors PageEditor's `data-paginated` on `.nb-page`. */
  paginated?: boolean;
  /** Page id — mounts the same deterministic margin doodles the live page has. */
  pageId?: string;
}

function docPageStyle(doc: PageDoc): PageStyle {
  const value = doc.attrs?.pageStyle;
  return isPageStyle(value) ? value : DEFAULT_PAGE_STYLE;
}

function docLineHeight(doc: PageDoc): number {
  const value = doc.attrs?.lineHeightPx;
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_LINE_HEIGHT_PX;
}

function docRuleGap(doc: PageDoc): number {
  const value = doc.attrs?.ruleGapPx;
  return value === undefined ? 0 : clampRuleGapPx(value);
}

/** Wait until every <img> under root has settled (or the cap elapses). */
async function waitForImages(root: HTMLElement, capMs = 4000): Promise<void> {
  const started = Date.now();
  const pending = (): HTMLImageElement[] =>
    Array.from(root.querySelectorAll('img')).filter(
      (img) => !img.complete && img.src !== '',
    );
  while (pending().length > 0 && Date.now() - started < capMs) {
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Render a page doc into an offscreen sheet (same DOM structure and CSS
 * classes as a live leaf: .nb-sheet-paper > .nb-page > .nb-page-editor >
 * .nb-prose), hand it to `run`, then tear everything down. The editor is
 * read-only and never registers as the active editor.
 *
 * `context` decides how closely the staging has to match a mounted leaf; see
 * OffscreenLeafContext. Omitted, the sheet stages on `<body>` in its
 * standalone form, which is what the whole-book export has always used.
 */
export async function withOffscreenPage<T>(
  doc: PageDoc,
  size: OffscreenPageSize,
  run: (sheet: HTMLElement) => Promise<T>,
  context: OffscreenLeafContext = {},
): Promise<T> {
  const host = document.createElement('div');
  host.className = 'nb-export-offscreen';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;pointer-events:none;' +
    `width:${size.width}px;height:${size.height}px;overflow:hidden;`;

  const sheet = document.createElement('div');
  sheet.className = 'nb-sheet-paper nb-leaf-paper nb-export-sheet';
  sheet.style.width = `${size.width}px`;
  sheet.style.height = `${size.height}px`;
  if (context.side !== undefined) sheet.dataset.side = context.side;

  const page = document.createElement('div');
  page.className = 'nb-page';
  page.dataset.style = docPageStyle(doc);
  if (context.paginated === true) page.dataset.paginated = 'true';
  page.style.setProperty('--page-line-height', `${docLineHeight(doc)}px`);
  page.style.setProperty('--page-rule-gap', `${docRuleGap(doc)}px`);

  const mount = document.createElement('div');
  mount.className = 'nb-page-editor';

  page.appendChild(mount);
  sheet.appendChild(page);
  host.appendChild(sheet);
  // Staged inside the live spread when the caller asks for it, so every
  // `.nb-spread …` rule reaches this sheet exactly as it reaches a real leaf.
  (context.host ?? document.body).appendChild(host);

  let editor: Editor | null = null;
  let unmountDoodles: (() => void) | undefined;
  try {
    editor = new Editor({
      element: mount,
      editable: false,
      extensions: createEditorExtensions(),
      content: normalizePageDoc(doc) as JSONContent,
      editorProps: { attributes: { class: 'nb-prose', spellcheck: 'false' } },
    });
    // The margins carry deterministic pencil doodles on a mounted page; a
    // staged sheet without them differs from the live one it stands in for.
    if (
      context.pageId !== undefined &&
      settings.showMarginDoodles &&
      !settings.minimalistMode
    ) {
      unmountDoodles = mountMarginDoodles(page, context.pageId);
    }
    // Let node views mount, fonts resolve and images land before capturing.
    await nextFrame();
    await document.fonts?.ready.catch(() => undefined);
    await waitForImages(sheet);
    await nextFrame();
    return await run(sheet);
  } finally {
    unmountDoodles?.();
    editor?.destroy();
    host.remove();
  }
}
