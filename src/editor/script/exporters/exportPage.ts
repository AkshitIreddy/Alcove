/**
 * src/editor/script/exporters/exportPage.ts — the export entry points the
 * rail buttons call (roadmap items 23 + 24).
 *
 * - `exportActivePagePng()`: rasterize the focused mounted page sheet at 2x
 *   and save it via dialog (Tauri) or download (browser dev).
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
import type { Book } from '../../../data/types';
import { editorState } from '../../state';
import { activeEditor } from '../../insert/activeEditor';
import {
  capturePageJpeg,
  capturePagePng,
  measureMountedSheet,
  withOffscreenPage,
} from './capture';
import { buildJpegPdf, DEFAULT_PDF_PIXELS_PER_INCH, type PdfImagePage } from './pdf';
import { fileStem, saveBytes } from './saveFile';
import { notify } from './toast';

/** The sheet under the caret, else any mounted leaf. Null off the book view. */
export function activeSheetElement(): HTMLElement | null {
  const fromEditor = activeEditor()
    ?.view.dom.closest<HTMLElement>('.nb-sheet-paper');
  if (fromEditor != null) return fromEditor;
  return (
    document.querySelector<HTMLElement>('.nb-leaf-paper[data-side="left"]') ??
    document.querySelector<HTMLElement>('.nb-sheet-paper')
  );
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
  const sheet = activeSheetElement();
  if (sheet === null) {
    notify('open a book first — nothing to export');
    return false;
  }
  try {
    const book = await resolveOpenBook();
    const captured = await capturePagePng(sheet);
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
    const name = `${fileStem(book.title)}.pdf`;
    let saved: boolean;
    if (isTauri()) {
      saved = await savePdfTauri(images, name);
    } else {
      const outcome = await saveBytes(
        buildJpegPdf(images),
        name,
        'application/pdf',
        [{ name: 'PDF document', extensions: ['pdf'] }],
      );
      saved = outcome === 'saved';
    }
    notify(saved ? `“${book.title}” exported to PDF` : 'export cancelled');
    return saved;
  } catch {
    notify('could not assemble the PDF');
    return false;
  }
}
