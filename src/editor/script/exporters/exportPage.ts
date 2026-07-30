/**
 * src/editor/script/exporters/exportPage.ts — the export entry points the
 * rail buttons call (roadmap items 23 + 24).
 *
 * - `exportActivePagePng()`: rasterize the focused page at 2x and save it via
 *   dialog (Tauri) or download (browser dev). The mounted leaf is used when
 *   it has layout; otherwise the same document is rendered offscreen, so the
 *   export never fails just because the book view is mid-mount or the leaf
 *   is collapsed.
 * - `exportActivePagePdf()`: the same capture, wrapped as a one-page PDF
 *   (roadmap 23 asks for book *or* page).
 * - `exportOpenBookPdf()`: offscreen-render EVERY page of the open book at
 *   2x (consistent output, no caret/selection chrome), then assemble a PDF —
 *   in Tauri preferably via the `export_pdf` Rust command
 *   (src-tauri/src/export.rs), falling back to the pure TS assembler +
 *   plugin-fs; in the browser via the TS assembler + download.
 *
 * Both are standalone (resolve their own book/page context) so the rail
 * wiring is a one-line onClick per tool.
 */
import { isTauri } from '../../../data/db';
import { getBook, listBooksByFloorRange } from '../../../data/books';
import { listPages } from '../../../data/pages';
import type { Book, PageDoc } from '../../../data/types';
import { editorState } from '../../state';
import { activeEditor } from '../../insert/activeEditor';
import {
  capturePageJpeg,
  capturePagePng,
  isCapturable,
  measureMountedSheet,
  withOffscreenPage,
  type CapturedImage,
} from './capture';
import { buildJpegPdf, DEFAULT_PDF_PIXELS_PER_INCH, type PdfImagePage } from './pdf';
import { fileStem, saveBytes } from './saveFile';
import { notify } from './toast';

/**
 * The sheet under the caret, else the widest laid-out leaf. Only elements
 * with real layout qualify: a leaf that is mid-mount or collapsed (the
 * `.nb-flip-leaf-left.is-empty` of a single-page spread) measures 0×0 and
 * would rasterize to an empty canvas.
 */
export function activeSheetElement(): HTMLElement | null {
  const fromEditor =
    activeEditor()?.view.dom.closest<HTMLElement>('.nb-sheet-paper') ?? null;
  if (isCapturable(fromEditor)) return fromEditor;

  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const sheet of document.querySelectorAll<HTMLElement>(
    '.nb-sheet-paper:not(.nb-export-sheet)',
  )) {
    if (!isCapturable(sheet)) continue;
    const area = sheet.clientWidth * sheet.clientHeight;
    // Ties go to the left leaf (first in document order).
    if (area > bestArea) {
      bestArea = area;
      best = sheet;
    }
  }
  return best;
}

/**
 * Poll for a laid-out sheet — the book view's leaves can still be 0×0 for a
 * frame or two after mount (fonts, flip surface layout), and an export
 * triggered in that window must not fail.
 */
async function waitForSheet(timeoutMs = 2500): Promise<HTMLElement | null> {
  const started = Date.now();
  for (;;) {
    const sheet = activeSheetElement();
    if (sheet !== null) return sheet;
    if (Date.now() - started >= timeoutMs) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * The document of the page being edited: the live editor's JSON when one is
 * registered, else the open book's first page. Feeds the offscreen fallback
 * used when no mounted leaf can be rasterized.
 */
async function activePageDoc(book: Book | null): Promise<PageDoc | null> {
  const editor = activeEditor();
  if (editor) return editor.getJSON() as PageDoc;
  if (book === null) return null;
  const pages = await listPages(book.id);
  return pages[0]?.doc ?? null;
}

/**
 * Rasterize the focused page: the mounted leaf when it has layout, else an
 * offscreen render of the same document (identical sheet DOM + CSS), so the
 * export is total no matter what the book view is doing.
 */
async function captureActivePage(
  book: Book | null,
  as: 'png' | 'jpeg',
): Promise<CapturedImage | null> {
  const grab = (sheet: HTMLElement): Promise<CapturedImage> =>
    as === 'png' ? capturePagePng(sheet) : capturePageJpeg(sheet);

  const sheet = await waitForSheet();
  if (sheet !== null) {
    try {
      return await grab(sheet);
    } catch {
      // Fall through to the offscreen path (leaf vanished mid-capture, …).
    }
  }
  const doc = await activePageDoc(book);
  if (doc === null) return null;
  return withOffscreenPage(doc, measureMountedSheet(), grab);
}

/** The open book, mirroring BookView's fallback to the first shelved book. */
async function resolveOpenBook(): Promise<Book | null> {
  const id = editorState.openBookId();
  if (id !== null) {
    const book = await getBook(id);
    if (book !== null) return book;
  }
  const shelved = await listBooksByFloorRange(0, 999);
  return shelved[0] ?? null;
}

/** Roadmap 24 — export the focused page as a 2x PNG. */
export async function exportActivePagePng(): Promise<boolean> {
  try {
    const book = await resolveOpenBook();
    const captured = await captureActivePage(book, 'png');
    if (captured === null) {
      notify('open a book first — nothing to export');
      return false;
    }
    const name = `${fileStem(book?.title ?? 'notebook')}-page.png`;
    const outcome = await saveBytes(captured.bytes, name, 'image/png', [
      { name: 'PNG image', extensions: ['png'] },
    ]);
    if (outcome === 'saved') notify('page exported as PNG');
    else if (outcome === 'failed') notify('could not save the PNG');
    return outcome === 'saved';
  } catch {
    notify('could not capture the page');
    return false;
  }
}

interface IpcPdfPage {
  jpeg: number[];
  width: number;
  height: number;
}

async function savePdfTauri(
  pages: PdfImagePage[],
  suggestedName: string,
): Promise<boolean> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });
  if (path === null) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const ipcPages: IpcPdfPage[] = pages.map((page) => ({
      jpeg: Array.from(page.jpeg),
      width: page.width,
      height: page.height,
    }));
    await invoke('export_pdf', {
      path,
      pages: ipcPages,
      pxPerInch: DEFAULT_PDF_PIXELS_PER_INCH,
    });
    return true;
  } catch {
    // Command unavailable (not yet registered) → assemble here, write there.
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, buildJpegPdf(pages));
    return true;
  }
}

/** Save assembled page images as a PDF (Rust command → dialog → download). */
async function savePdf(
  images: PdfImagePage[],
  name: string,
): Promise<boolean> {
  if (isTauri()) return savePdfTauri(images, name);
  const outcome = await saveBytes(
    buildJpegPdf(images),
    name,
    'application/pdf',
    [{ name: 'PDF document', extensions: ['pdf'] }],
  );
  return outcome === 'saved';
}

/** Roadmap 23 (page scope) — export just the focused page as a PDF. */
export async function exportActivePagePdf(): Promise<boolean> {
  try {
    const book = await resolveOpenBook();
    const captured = await captureActivePage(book, 'jpeg');
    if (captured === null) {
      notify('open a book first — nothing to export');
      return false;
    }
    const saved = await savePdf(
      [
        {
          jpeg: captured.bytes,
          width: captured.width,
          height: captured.height,
        },
      ],
      `${fileStem(book?.title ?? 'notebook')}-page.pdf`,
    );
    notify(saved ? 'page exported to PDF' : 'export cancelled');
    return saved;
  } catch {
    notify('could not assemble the PDF');
    return false;
  }
}

/** Roadmap 23 — export the whole open book as a print-quality PDF. */
export async function exportOpenBookPdf(): Promise<boolean> {
  const book = await resolveOpenBook();
  if (book === null) {
    notify('no book to export yet');
    return false;
  }
  const pages = await listPages(book.id);
  if (pages.length === 0) {
    notify('this book has no pages yet');
    return false;
  }
  notify(`rendering ${pages.length} page${pages.length === 1 ? '' : 's'}…`);
  try {
    const size = measureMountedSheet();
    const images: PdfImagePage[] = [];
    for (const page of pages) {
      const captured = await withOffscreenPage(page.doc, size, (sheet) =>
        capturePageJpeg(sheet),
      );
      images.push({
        jpeg: captured.bytes,
        width: captured.width,
        height: captured.height,
      });
    }
    const saved = await savePdf(images, `${fileStem(book.title)}.pdf`);
    notify(saved ? `“${book.title}” exported to PDF` : 'export cancelled');
    return saved;
  } catch {
    notify('could not assemble the PDF');
    return false;
  }
}
