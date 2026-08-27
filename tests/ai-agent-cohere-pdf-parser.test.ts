import { describe, expect, it, vi } from 'vitest';
import type { AiExtractedPdfSource } from '../src/data/aiGateway';
import {
  enrichPdfSourceWithCohere,
  type PdfRasterSession,
  type RasterizedPdfPage,
} from '../src/features/aiAgent/coherePdfParser';

function localSource(pageCount: number): AiExtractedPdfSource {
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const pageNumber = index + 1;
    const text = `Local text for page ${pageNumber}`;
    return {
      pageNumber,
      text,
      textBytes: new TextEncoder().encode(text).byteLength,
      truncated: false,
      extractionFailed: false,
      hasEmbeddedImages: pageNumber === 2,
      hasVectorGraphics: true,
      needsOcr: pageNumber === 2,
      needsVisualReview: true,
      visualEvidence: 'unresolved' as const,
      unresolvedVisualCount: 1,
      visuals: [],
    };
  });
  return {
    attachmentId: 'pdf-source',
    sha256: 'pdf-source-digest',
    pageCount,
    totalTextBytes: pages.reduce((sum, page) => sum + page.textBytes, 0),
    truncated: false,
    pages,
  };
}

function raster(pageNumber: number): RasterizedPdfPage {
  return {
    pageNumber,
    bytes: new Uint8Array([0xff, 0xd8, pageNumber, 0xff, 0xd9]),
    width: 1_200,
    height: 1_600,
    mimeType: 'image/jpeg',
  };
}

function session(
  pageCount: number,
  renderPage: PdfRasterSession['renderPage'] = async (pageNumber) => raster(pageNumber),
): PdfRasterSession {
  return { pageCount, renderPage, destroy: vi.fn(async () => undefined) };
}

describe('Cohere PDF page parser', () => {
  it('rasterizes, saves and parses every page with bounded concurrency', async () => {
    let active = 0;
    let peak = 0;
    const renderPage = vi.fn(async (pageNumber: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 4));
      active -= 1;
      return raster(pageNumber);
    });
    const savePageImage = vi.fn(async (bytes: Uint8Array) => ({
      attachmentId: `saved-${bytes[2]}`,
      sha256: `digest-${bytes[2]}`,
    }));
    const parsePage = vi.fn(async ({ pageNumber }: { pageNumber: number }) => ({
      markdown: `# Parsed page ${pageNumber}\n\nA table and its reading order.`,
    }));

    const result = await enrichPdfSourceWithCohere({
      runId: 'run-success',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: localSource(5),
      signal: new AbortController().signal,
      concurrency: 2,
      openRasterSession: async () => session(5, renderPage),
      savePageImage,
      parsePage,
    });

    expect(peak).toBe(2);
    expect(renderPage).toHaveBeenCalledTimes(5);
    expect(savePageImage).toHaveBeenCalledTimes(5);
    expect(parsePage).toHaveBeenCalledTimes(5);
    expect(parsePage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      runId: 'run-success',
      attachmentId: 'saved-1',
      pageNumber: 1,
    }));
    expect(result.pages.map((page) => page.text)).toEqual([
      '# Parsed page 1\n\nA table and its reading order.',
      '# Parsed page 2\n\nA table and its reading order.',
      '# Parsed page 3\n\nA table and its reading order.',
      '# Parsed page 4\n\nA table and its reading order.',
      '# Parsed page 5\n\nA table and its reading order.',
    ]);
    expect(result.pages[0]).toMatchObject({
      textBytes: new TextEncoder().encode('# Parsed page 1\n\nA table and its reading order.').byteLength,
      extractionFailed: false,
      needsOcr: false,
      visualEvidence: 'available',
      unresolvedVisualCount: 0,
      hasVectorGraphics: false,
      visuals: [{
        attachmentId: 'saved-1',
        mimeType: 'image/jpeg',
        sha256: 'digest-1',
        width: 1_200,
        height: 1_600,
      }],
    });
  });

  it('keeps the full-page raster and local text when one parse fails', async () => {
    const result = await enrichPdfSourceWithCohere({
      runId: 'run-partial',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: localSource(3),
      signal: new AbortController().signal,
      openRasterSession: async () => session(3),
      savePageImage: async (bytes) => ({
        attachmentId: `saved-${bytes[2]}`,
        sha256: `digest-${bytes[2]}`,
      }),
      parsePage: async ({ pageNumber }) => {
        if (pageNumber === 2) throw new Error('provider timeout');
        return { markdown: `Parsed ${pageNumber}` };
      },
    });

    expect(result.pages.map((page) => page.text)).toEqual([
      'Parsed 1',
      'Local text for page 2',
      'Parsed 3',
    ]);
    expect(result.pages[1]).toMatchObject({
      needsOcr: true,
      needsVisualReview: true,
      visualEvidence: 'available',
      unresolvedVisualCount: 0,
      visuals: [{ attachmentId: 'saved-2', sha256: 'digest-2' }],
    });
  });

  it('leaves only a locally unrenderable page unresolved', async () => {
    const parsePage = vi.fn(async ({ pageNumber }: { pageNumber: number }) =>
      ({ markdown: `Parsed ${pageNumber}` }));
    const result = await enrichPdfSourceWithCohere({
      runId: 'run-render-failure',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: localSource(3),
      signal: new AbortController().signal,
      openRasterSession: async () => session(3, async (pageNumber) => {
        if (pageNumber === 2) throw new Error('unsupported page paint operation');
        return raster(pageNumber);
      }),
      savePageImage: async (bytes) => ({
        attachmentId: `saved-${bytes[2]}`,
        sha256: `digest-${bytes[2]}`,
      }),
      parsePage,
    });

    expect(result.pages.map((page) => page.text)).toEqual([
      'Parsed 1',
      'Local text for page 2',
      'Parsed 3',
    ]);
    expect(result.pages[1]).toMatchObject({
      visualEvidence: 'unresolved',
      unresolvedVisualCount: 1,
      visuals: [],
      hasVectorGraphics: true,
    });
    expect(parsePage).not.toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 2 }));
  });

  it('falls back to all local text when every provider parse fails', async () => {
    const source = localSource(2);
    const result = await enrichPdfSourceWithCohere({
      runId: 'run-provider-down',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: source,
      signal: new AbortController().signal,
      openRasterSession: async () => session(2),
      savePageImage: async (bytes) => ({
        attachmentId: `saved-${bytes[2]}`,
        sha256: `digest-${bytes[2]}`,
      }),
      parsePage: async () => { throw new Error('provider unavailable'); },
    });

    expect(result.pages.map((page) => page.text)).toEqual(source.pages.map((page) => page.text));
    expect(result.pages.every((page) => page.visualEvidence === 'available')).toBe(true);
    expect(result.pages.every((page) => page.visuals.length === 1)).toBe(true);
  });

  it('propagates cancellation and does not turn it into a local fallback', async () => {
    const controller = new AbortController();
    const savePageImage = vi.fn();
    const parsePage = vi.fn();
    const renderPage = vi.fn((_pageNumber: number, signal: AbortSignal) =>
      new Promise<RasterizedPdfPage>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        }, { once: true });
      }));
    const work = enrichPdfSourceWithCohere({
      runId: 'run-cancel',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: localSource(4),
      signal: controller.signal,
      concurrency: 1,
      openRasterSession: async () => session(4, renderPage),
      savePageImage,
      parsePage,
    });

    await vi.waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(savePageImage).not.toHaveBeenCalled();
    expect(parsePage).not.toHaveBeenCalled();
  });
});
