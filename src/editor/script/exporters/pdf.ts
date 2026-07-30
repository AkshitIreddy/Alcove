/**
 * src/editor/script/exporters/pdf.ts — dependency-free PDF assembly.
 *
 * `buildJpegPdf` turns a list of JPEG page images (the flip-snapshot pipeline
 * captured at 2x) into a complete PDF byte stream: one PDF page per image,
 * image embedded verbatim as a DCTDecode XObject (PDF understands raw JPEG),
 * page size derived from the capture's pixel density.
 *
 * Pure and synchronous — unit-tested in tests/export.test.ts (header, xref
 * offsets, page count, verbatim payloads). The Rust twin lives in
 * src-tauri/src/export.rs (used in the Tauri shell); keep the object layout
 * in sync so both emit byte-equivalent structures.
 */

export interface PdfImagePage {
  /** Raw JPEG bytes (SOI…EOI), embedded verbatim. */
  jpeg: Uint8Array;
  /** Pixel width of the JPEG. */
  width: number;
  /** Pixel height of the JPEG. */
  height: number;
}

/** Captures run at 2x of CSS px (96dpi), so a page prints at 192 px/inch. */
export const DEFAULT_PDF_PIXELS_PER_INCH = 192;

const PDF_POINTS_PER_INCH = 72;

/** ASCII/latin-1 string + binary chunk sink tracking byte offsets. */
class ByteSink {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;

  get length(): number {
    return this.size;
  }

  pushText(text: string): void {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    this.pushBytes(bytes);
  }

  pushBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** Fixed-point points value (2 decimals, no trailing zeros needed by spec). */
function pts(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/**
 * Assemble a PDF (version 1.4) from JPEG page images. Pages keep their
 * aspect ratio; `pixelsPerInch` maps capture pixels onto paper points.
 * Throws only on an empty page list.
 */
export function buildJpegPdf(
  pages: readonly PdfImagePage[],
  pixelsPerInch: number = DEFAULT_PDF_PIXELS_PER_INCH,
): Uint8Array {
  if (pages.length === 0) {
    throw new Error('buildJpegPdf: at least one page image is required');
  }
  const density =
    Number.isFinite(pixelsPerInch) && pixelsPerInch > 0
      ? pixelsPerInch
      : DEFAULT_PDF_PIXELS_PER_INCH;
  const scale = PDF_POINTS_PER_INCH / density;

  const sink = new ByteSink();
  const offsets: number[] = []; // offsets[i] = byte offset of object i+1

  const beginObject = (id: number): void => {
    offsets[id - 1] = sink.length;
    sink.pushText(`${id} 0 obj\n`);
  };

  // Object ids: 1 catalog, 2 pages, then per page i (0-based):
  //   3+3i page, 4+3i image XObject, 5+3i content stream.
  const pageObjectId = (i: number): number => 3 + 3 * i;
  const imageObjectId = (i: number): number => 4 + 3 * i;
  const contentObjectId = (i: number): number => 5 + 3 * i;
  const objectCount = 2 + pages.length * 3;

  sink.pushText('%PDF-1.4\n');
  // Binary comment line so transfer tools treat the file as binary.
  sink.pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  beginObject(1);
  sink.pushText('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  beginObject(2);
  const kids = pages.map((_, i) => `${pageObjectId(i)} 0 R`).join(' ');
  sink.pushText(
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`,
  );

  pages.forEach((page, i) => {
    const w = pts(Math.max(1, page.width) * scale);
    const h = pts(Math.max(1, page.height) * scale);

    beginObject(pageObjectId(i));
    sink.pushText(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imageObjectId(i)} 0 R >> >> ` +
        `/Contents ${contentObjectId(i)} 0 R >>\nendobj\n`,
    );

    beginObject(imageObjectId(i));
    sink.pushText(
      `<< /Type /XObject /Subtype /Image /Width ${Math.max(1, page.width)} ` +
        `/Height ${Math.max(1, page.height)} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\n` +
        `stream\n`,
    );
    sink.pushBytes(page.jpeg);
    sink.pushText('\nendstream\nendobj\n');

    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
    beginObject(contentObjectId(i));
    sink.pushText(
      `<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    );
  });

  const xrefOffset = sink.length;
  sink.pushText(`xref\n0 ${objectCount + 1}\n`);
  sink.pushText('0000000000 65535 f \n');
  for (let i = 0; i < objectCount; i += 1) {
    sink.pushText(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  sink.pushText(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  return sink.toBytes();
}
