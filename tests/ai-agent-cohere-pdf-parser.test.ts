import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiExtractedPdfSource } from '../src/data/aiGateway';
import {
  DEFAULT_COHERE_PDF_RESOURCE_LIMITS,
  enrichPdfSourceWithCohere,
  extractAiPdfSourceWithCohere,
  type PdfRasterSession,
  type RasterizedPdfPage,
} from '../src/features/aiAgent/coherePdfParser';

const gatewayMocks = vi.hoisted(() => ({
  extractPdf: vi.fn(),
  readAttachment: vi.fn(),
}));

vi.mock('../src/data/aiGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/aiGateway')>()),
  extractAiPdfSource: gatewayMocks.extractPdf,
  readAiAttachment: gatewayMocks.readAttachment,
}));

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
  beforeEach(() => {
    gatewayMocks.extractPdf.mockReset();
    gatewayMocks.readAttachment.mockReset();
  });

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

  it('applies explicit conservative default provider and output budgets', () => {
    expect(DEFAULT_COHERE_PDF_RESOURCE_LIMITS).toEqual({
      maxParsedPages: 24,
      maxProviderCalls: 24,
      maxPageTextBytes: 256 * 1024,
      maxTotalTextBytes: 8 * 1024 * 1024,
      maxDerivedRasterBytes: 48 * 1024 * 1024,
    });
  });

  it('does not render, save, or parse pages beyond page and provider-call limits', async () => {
    const renderPage = vi.fn(async (pageNumber: number) => raster(pageNumber));
    const savePageImage = vi.fn(async (bytes: Uint8Array) => ({
      attachmentId: `saved-${bytes[2]}`,
      sha256: `digest-${bytes[2]}`,
    }));
    const parsePage = vi.fn(async ({ pageNumber }: { pageNumber: number }) =>
      ({ markdown: `Parsed ${pageNumber}` }));
    const source = localSource(5);

    const result = await enrichPdfSourceWithCohere({
      runId: 'run-page-cap',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: source,
      signal: new AbortController().signal,
      openRasterSession: async () => session(5, renderPage),
      savePageImage,
      parsePage,
      resourceLimits: {
        ...DEFAULT_COHERE_PDF_RESOURCE_LIMITS,
        maxParsedPages: 3,
        maxProviderCalls: 2,
      },
    });

    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(savePageImage).toHaveBeenCalledTimes(2);
    expect(parsePage).toHaveBeenCalledTimes(2);
    expect(result.pages.map((page) => page.text)).toEqual([
      'Parsed 1',
      'Parsed 2',
      'Local text for page 3',
      'Local text for page 4',
      'Local text for page 5',
    ]);
    expect(result.pages[2]).toEqual(source.pages[2]);
  });

  it('rejects oversized parsed text and cleans its unreturned page image', async () => {
    const deletePageImage = vi.fn(async () => true);
    const source = localSource(1);
    const result = await enrichPdfSourceWithCohere({
      runId: 'run-page-text-cap',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: source,
      signal: new AbortController().signal,
      openRasterSession: async () => session(1),
      savePageImage: async () => ({ attachmentId: 'saved-1', sha256: 'digest-1' }),
      deletePageImage,
      parsePage: async () => ({ markdown: '123456789' }),
      resourceLimits: {
        ...DEFAULT_COHERE_PDF_RESOURCE_LIMITS,
        maxPageTextBytes: 8,
        maxTotalTextBytes: 32,
      },
    });

    expect(result.pages[0]).toEqual(source.pages[0]);
    expect(deletePageImage).toHaveBeenCalledExactlyOnceWith('saved-1');
  });

  it('reserves aggregate text capacity before work and leaves excess pages local', async () => {
    const renderPage = vi.fn(async (pageNumber: number) => raster(pageNumber));
    const savePageImage = vi.fn(async (bytes: Uint8Array) => ({
      attachmentId: `saved-${bytes[2]}`,
      sha256: `digest-${bytes[2]}`,
    }));
    const parsePage = vi.fn(async () => ({ markdown: '123456' }));
    const base = localSource(3);
    const pages = [
      base.pages[0]!,
      { ...base.pages[1]!, text: 'L2', textBytes: 2 },
      { ...base.pages[2]!, text: 'L3', textBytes: 2 },
    ];
    const source: AiExtractedPdfSource = {
      ...base,
      pages,
      totalTextBytes: pages.reduce((sum, page) => sum + page.textBytes, 0),
    };

    const result = await enrichPdfSourceWithCohere({
      runId: 'run-total-text-cap',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: source,
      signal: new AbortController().signal,
      openRasterSession: async () => session(3, renderPage),
      savePageImage,
      parsePage,
      resourceLimits: {
        ...DEFAULT_COHERE_PDF_RESOURCE_LIMITS,
        maxPageTextBytes: 6,
        maxTotalTextBytes: 10,
      },
    });

    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(savePageImage).toHaveBeenCalledTimes(1);
    expect(parsePage).toHaveBeenCalledTimes(1);
    expect(result.pages.map((page) => page.text)).toEqual([
      '123456',
      'L2',
      'L3',
    ]);
  });

  it('caps the final merged text across parsed and local fallback pages on UTF-8 boundaries', async () => {
    const base = localSource(3);
    const pages = [
      base.pages[0]!,
      { ...base.pages[1]!, text: 'éééé', textBytes: 8 },
      { ...base.pages[2]!, text: 'tail', textBytes: 4 },
    ];
    const source: AiExtractedPdfSource = {
      ...base,
      pages,
      totalTextBytes: pages.reduce((sum, page) => sum + page.textBytes, 0),
    };

    const result = await enrichPdfSourceWithCohere({
      runId: 'run-final-text-cap',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: source,
      signal: new AbortController().signal,
      concurrency: 1,
      openRasterSession: async () => session(3),
      savePageImage: async () => ({ attachmentId: 'saved-1', sha256: 'digest-1' }),
      parsePage: async () => ({ markdown: 'Parsed' }),
      resourceLimits: {
        ...DEFAULT_COHERE_PDF_RESOURCE_LIMITS,
        maxPageTextBytes: 8,
        maxTotalTextBytes: 12,
      },
    });

    expect(result.totalTextBytes).toBe(12);
    expect(result.pages.map((page) => page.text)).toEqual(['Parsed', 'ééé', '']);
    expect(result.pages.map((page) => page.textBytes)).toEqual([6, 6, 0]);
    expect(result.pages.map((page) => page.truncated)).toEqual([false, true, true]);
    expect(result.pages[1]).toMatchObject({
      visualEvidence: source.pages[1]!.visualEvidence,
      unresolvedVisualCount: source.pages[1]!.unresolvedVisualCount,
      visuals: source.pages[1]!.visuals,
      hasVectorGraphics: source.pages[1]!.hasVectorGraphics,
    });
  });

  it('stops saving and parsing once the aggregate raster budget is exhausted', async () => {
    const renderPage = vi.fn(async (pageNumber: number) => raster(pageNumber));
    const savePageImage = vi.fn(async (bytes: Uint8Array) => ({
      attachmentId: `saved-${bytes[2]}`,
      sha256: `digest-${bytes[2]}`,
    }));
    const parsePage = vi.fn(async ({ pageNumber }: { pageNumber: number }) =>
      ({ markdown: `Parsed ${pageNumber}` }));
    const source = localSource(4);

    const result = await enrichPdfSourceWithCohere({
      runId: 'run-raster-byte-cap',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: source,
      signal: new AbortController().signal,
      concurrency: 1,
      openRasterSession: async () => session(4, renderPage),
      savePageImage,
      parsePage,
      resourceLimits: {
        ...DEFAULT_COHERE_PDF_RESOURCE_LIMITS,
        maxDerivedRasterBytes: 5,
      },
    });

    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(savePageImage).toHaveBeenCalledTimes(1);
    expect(parsePage).toHaveBeenCalledTimes(1);
    expect(result.pages[0]!.text).toBe('Parsed 1');
    expect(result.pages.slice(1)).toEqual(source.pages.slice(1));
  });

  it('cleans a staged image when cancellation arrives immediately after save', async () => {
    const controller = new AbortController();
    const deletePageImage = vi.fn(async () => true);
    const onPageImageSaved = vi.fn(() => controller.abort());
    const parsePage = vi.fn();

    const work = enrichPdfSourceWithCohere({
      runId: 'run-abort-after-save',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: localSource(1),
      signal: controller.signal,
      openRasterSession: async () => session(1),
      savePageImage: async () => ({ attachmentId: 'saved-1', sha256: 'digest-1' }),
      onPageImageSaved,
      deletePageImage,
      parsePage,
    });

    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(onPageImageSaved).toHaveBeenCalledExactlyOnceWith('saved-1');
    expect(deletePageImage).toHaveBeenCalledExactlyOnceWith('saved-1');
    expect(parsePage).not.toHaveBeenCalled();
  });

  it('settles both workers before destroying the session during cancellation', async () => {
    const controller = new AbortController();
    let activeParsers = 0;
    let activeAtDestroy = -1;
    const deletePageImage = vi.fn(async () => true);
    const destroy = vi.fn(async () => { activeAtDestroy = activeParsers; });
    const parsePage = vi.fn(({ pageNumber, signal }: {
      pageNumber: number;
      signal: AbortSignal;
    }) => new Promise<{ markdown: string }>((_resolve, reject) => {
      activeParsers += 1;
      signal.addEventListener('abort', () => {
        setTimeout(() => {
          activeParsers -= 1;
          reject(new DOMException(`cancelled ${pageNumber}`, 'AbortError'));
        }, pageNumber === 1 ? 0 : 15);
      }, { once: true });
    }));

    const work = enrichPdfSourceWithCohere({
      runId: 'run-two-worker-cancel',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      localSource: localSource(4),
      signal: controller.signal,
      concurrency: 2,
      openRasterSession: async () => ({
        pageCount: 4,
        renderPage: async (pageNumber) => raster(pageNumber),
        destroy,
      }),
      savePageImage: async (bytes) => ({
        attachmentId: `saved-${bytes[2]}`,
        sha256: `digest-${bytes[2]}`,
      }),
      deletePageImage,
      parsePage,
    });

    await vi.waitFor(() => expect(parsePage).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(activeAtDestroy).toBe(0);
    expect(deletePageImage).toHaveBeenCalledTimes(2);
    expect(deletePageImage.mock.calls.flat()).toEqual(expect.arrayContaining(['saved-1', 'saved-2']));
  });

  it('keeps omitted and explicit-false cloud permission local without reading bytes', async () => {
    const source = localSource(2);
    gatewayMocks.extractPdf.mockResolvedValue(source);
    gatewayMocks.readAttachment.mockRejectedValue(new Error('must not read attachment'));

    await expect(extractAiPdfSourceWithCohere(
      'pdf-source',
      new AbortController().signal,
    )).resolves.toBe(source);
    await expect(extractAiPdfSourceWithCohere(
      'pdf-source',
      new AbortController().signal,
      false,
    )).resolves.toBe(source);
    expect(gatewayMocks.extractPdf).toHaveBeenCalledTimes(2);
    expect(gatewayMocks.extractPdf).toHaveBeenNthCalledWith(1, 'pdf-source');
    expect(gatewayMocks.extractPdf).toHaveBeenNthCalledWith(2, 'pdf-source');
    expect(gatewayMocks.readAttachment).not.toHaveBeenCalled();
  });
});
