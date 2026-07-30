/**
 * src/editor/script/exporters/capture.ts — page rasterization for export.
 *
 * Reuses the flip snapshot approach (html-to-image toCanvas, font-embed CSS
 * cached once, chrome elements filtered out) at a fixed 2x pixel ratio —
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
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import type { PageDoc, PageStyle } from '../../../data/types';
import {
  DEFAULT_LINE_HEIGHT_PX,
  DEFAULT_PAGE_STYLE,
  isPageStyle,
  normalizePageDoc,
} from '../../document';
import { createEditorExtensions } from '../../extensions';

/** Export pixel ratio (roadmap: "reuse snapshot pipeline at 2x"). */
export const EXPORT_PIXEL_RATIO = 2;

/** tokens.css --paper-cream — captures must match the resting page color. */
const PAPER_CREAM = '#f7f1e3';

/** Interactive chrome that must never appear in an export. */
const EXPORT_EXCLUDE_SELECTOR =
  '.nb-drag-handle, .nb-style-switcher, .nb-page-full-hint, [data-snapshot-hide]';

/** 1×1 transparent PNG — stand-in for images that fail to inline. */
const TRANSPARENT_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABijPjAAAAAABJRU5ErkJggg==';

/**
 * Skip chrome and un-embeddable images. An `<img>` with an empty src (e.g.
 * a media node still resolving its asset) makes html-to-image's inline step
 * reject with a bare error Event — filtering it keeps exports total.
 */
function exportFilter(node: HTMLElement): boolean {
  if (
    node instanceof HTMLImageElement &&
    (node.getAttribute('src') ?? '') === ''
  ) {
    return false;
  }
  return (
    typeof node.matches !== 'function' ||
    !node.matches(EXPORT_EXCLUDE_SELECTOR)
  );
}

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

let fontCssPromise: Promise<string> | undefined;

async function captureCanvas(element: HTMLElement): Promise<HTMLCanvasElement> {
  if (!isCapturable(element)) {
    throw new Error(
      `capture: element has no layout (${element.clientWidth}×${element.clientHeight})`,
    );
  }
  fontCssPromise ??= getFontEmbedCSS(element).catch(() => '');
  const fontEmbedCSS = await fontCssPromise;
  element.classList.add('snapshotting');
  try {
    return await toCanvas(element, {
      pixelRatio: EXPORT_PIXEL_RATIO,
      backgroundColor: PAPER_CREAM,
      fontEmbedCSS,
      imagePlaceholder: TRANSPARENT_PX,
      filter: exportFilter,
    });
  } finally {
    element.classList.remove('snapshotting');
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

export interface OffscreenPageSize {
  /** CSS px, typically measured from a mounted `.nb-sheet-paper`. */
  width: number;
  height: number;
}

/**
 * Sheet size of the mounted book leaf, or a book-ish default. Scans every
 * mounted sheet (the collapsed left leaf of a single-page spread measures
 * 0×0) and takes the largest laid-out one.
 */
export function measureMountedSheet(): OffscreenPageSize {
  let best: OffscreenPageSize = { width: 620, height: 875 };
  let bestArea = 0;
  for (const paper of document.querySelectorAll<HTMLElement>(
    '.nb-sheet-paper:not(.nb-export-sheet)',
  )) {
    const { clientWidth: width, clientHeight: height } = paper;
    if (width < 120 || height < 160) continue;
    if (width * height > bestArea) {
      bestArea = width * height;
      best = { width, height };
    }
  }
  return best;
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
 */
export async function withOffscreenPage<T>(
  doc: PageDoc,
  size: OffscreenPageSize,
  run: (sheet: HTMLElement) => Promise<T>,
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

  const page = document.createElement('div');
  page.className = 'nb-page';
  page.dataset.style = docPageStyle(doc);
  page.style.setProperty('--page-line-height', `${docLineHeight(doc)}px`);

  const mount = document.createElement('div');
  mount.className = 'nb-page-editor';

  page.appendChild(mount);
  sheet.appendChild(page);
  host.appendChild(sheet);
  document.body.appendChild(host);

  let editor: Editor | null = null;
  try {
    editor = new Editor({
      element: mount,
      editable: false,
      extensions: createEditorExtensions(),
      content: normalizePageDoc(doc) as JSONContent,
      editorProps: { attributes: { class: 'nb-prose', spellcheck: 'false' } },
    });
    // Let node views mount, fonts resolve and images land before capturing.
    await nextFrame();
    await document.fonts?.ready.catch(() => undefined);
    await waitForImages(sheet);
    await nextFrame();
    return await run(sheet);
  } finally {
    editor?.destroy();
    host.remove();
  }
}
