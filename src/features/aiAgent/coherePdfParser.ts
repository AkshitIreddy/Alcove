/**
 * Local PDF rasterization and page-scoped Cohere Parse orchestration.
 *
 * The PDF never crosses this provider seam. Each composed page is rendered to
 * a bounded JPEG locally, saved into Alcove's managed attachment store, and
 * only the resulting opaque attachment id is handed to `parsePage`.
 */
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import {
  extractAiPdfSource,
  parseAiImage,
  readAiAttachment,
  saveAiAttachment,
  type AiExtractedPdfPage,
  type AiExtractedPdfSource,
  type AiExtractedPdfVisual,
  type AiParseImageResponse,
} from '../../data/aiGateway';
/*
 * Keep the provider transport in aiGateway: it owns the credential and native
 * cancellation boundary. This module only orchestrates opaque attachment ids.
 */

const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 4;
let parseRunCounter = 0;

export const DEFAULT_COHERE_PDF_RESOURCE_LIMITS = {
  maxParsedPages: 24,
  maxProviderCalls: 24,
  maxPageTextBytes: 256 * 1024,
  maxTotalTextBytes: 8 * 1024 * 1024,
  maxDerivedRasterBytes: 48 * 1024 * 1024,
} as const;

export const DEFAULT_PDF_RASTER_LIMITS = {
  preferredScale: 2.25,
  maxEdge: 2_200,
  maxPixels: 4_000_000,
  maxBytes: 2_400_000,
} as const;

export interface PdfRasterLimits {
  readonly preferredScale: number;
  readonly maxEdge: number;
  readonly maxPixels: number;
  readonly maxBytes: number;
}

export interface RasterizedPdfPage {
  readonly pageNumber: number;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly mimeType: 'image/jpeg';
}

export interface PdfRasterSession {
  readonly pageCount: number;
  renderPage(pageNumber: number, signal: AbortSignal): Promise<RasterizedPdfPage>;
  destroy(): Promise<void>;
}

export type OpenPdfRasterSession = (
  pdfBytes: Uint8Array,
  signal: AbortSignal,
) => Promise<PdfRasterSession>;

export interface SavedPdfPageImage {
  readonly attachmentId: string;
  readonly sha256: string;
}

export interface CohereParsedPdfPage {
  readonly markdown: string;
}

export interface CoherePdfParsePageInput {
  readonly runId: string;
  readonly attachmentId: string;
  readonly pageNumber: number;
  readonly signal: AbortSignal;
}

export interface CoherePdfResourceLimits {
  readonly maxParsedPages: number;
  readonly maxProviderCalls: number;
  readonly maxPageTextBytes: number;
  readonly maxTotalTextBytes: number;
  readonly maxDerivedRasterBytes: number;
}

export interface CoherePdfPageImageLifecycle {
  /** Called immediately after a content-addressed image id is returned. */
  readonly onPageImageSaved?: (attachmentId: string) => void | Promise<void>;
  /** Must be reference-aware: identical rasters can share an attachment id. */
  readonly deletePageImage?: (attachmentId: string) => void | boolean | Promise<void | boolean>;
}

export interface CoherePdfPipelineInput {
  readonly runId: string;
  readonly pdfBytes: Uint8Array;
  readonly localSource: AiExtractedPdfSource;
  readonly signal: AbortSignal;
  readonly concurrency?: number;
  readonly resourceLimits?: Partial<CoherePdfResourceLimits>;
  readonly openRasterSession?: OpenPdfRasterSession;
  /** Save bytes in Alcove's managed store; the callback must not expose a path or key. */
  readonly savePageImage: (bytes: Uint8Array) => Promise<SavedPdfPageImage>;
  /** Provider transport owns credential lookup; this layer receives no raw key. */
  readonly parsePage: (
    input: CoherePdfParsePageInput,
  ) => Promise<CohereParsedPdfPage | string>;
  /** Optional ownership hooks supplied by the source repository. */
  readonly onPageImageSaved?: CoherePdfPageImageLifecycle['onPageImageSaved'];
  readonly deletePageImage?: CoherePdfPageImageLifecycle['deletePageImage'];
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    error instanceof Error && error.name === 'AbortError'
  );
}

function normalizedConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(value)));
}

function boundedInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function resourceLimits(
  overrides: Partial<CoherePdfResourceLimits> | undefined,
): CoherePdfResourceLimits {
  return {
    maxParsedPages: boundedInteger(
      overrides?.maxParsedPages,
      DEFAULT_COHERE_PDF_RESOURCE_LIMITS.maxParsedPages,
    ),
    maxProviderCalls: boundedInteger(
      overrides?.maxProviderCalls,
      DEFAULT_COHERE_PDF_RESOURCE_LIMITS.maxProviderCalls,
    ),
    maxPageTextBytes: boundedInteger(
      overrides?.maxPageTextBytes,
      DEFAULT_COHERE_PDF_RESOURCE_LIMITS.maxPageTextBytes,
    ),
    maxTotalTextBytes: boundedInteger(
      overrides?.maxTotalTextBytes,
      DEFAULT_COHERE_PDF_RESOURCE_LIMITS.maxTotalTextBytes,
    ),
    maxDerivedRasterBytes: boundedInteger(
      overrides?.maxDerivedRasterBytes,
      DEFAULT_COHERE_PDF_RESOURCE_LIMITS.maxDerivedRasterBytes,
    ),
  };
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function truncateUtf8(text: string, maxBytes: number): {
  readonly text: string;
  readonly textBytes: number;
} {
  if (maxBytes <= 0 || text.length === 0) return { text: '', textBytes: 0 };
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) return { text, textBytes: encoded.byteLength };
  let boundary = Math.min(maxBytes, encoded.byteLength);
  // `boundary` is the first omitted byte. If that byte is a UTF-8
  // continuation, walk back to the lead byte and omit the whole code point.
  while (boundary > 0 && (encoded[boundary]! & 0xc0) === 0x80) boundary -= 1;
  const truncated = new TextDecoder('utf-8', { fatal: true }).decode(encoded.slice(0, boundary));
  return { text: truncated, textBytes: boundary };
}

function capMergedPdfText(
  pages: readonly AiExtractedPdfPage[],
  maxTotalTextBytes: number,
): AiExtractedPdfPage[] {
  let remaining = maxTotalTextBytes;
  return pages.map((page) => {
    const actualBytes = utf8Bytes(page.text);
    if (actualBytes <= remaining) {
      remaining -= actualBytes;
      return page.textBytes === actualBytes ? page : { ...page, textBytes: actualBytes };
    }
    const truncated = truncateUtf8(page.text, remaining);
    remaining -= truncated.textBytes;
    return {
      ...page,
      text: truncated.text,
      textBytes: truncated.textBytes,
      truncated: true,
    };
  });
}

function parsedMarkdown(value: CohereParsedPdfPage | string): string | null {
  const raw = typeof value === 'string' ? value : value.markdown;
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  return normalized.length === 0 ? null : normalized;
}

function unresolvedPage(pageNumber: number): AiExtractedPdfPage {
  return {
    pageNumber,
    text: '',
    textBytes: 0,
    truncated: false,
    extractionFailed: true,
    hasEmbeddedImages: false,
    hasVectorGraphics: false,
    needsOcr: true,
    needsVisualReview: true,
    visualEvidence: 'unresolved',
    unresolvedVisualCount: 1,
    visuals: [],
  };
}

function pageWithRaster(
  localPage: AiExtractedPdfPage,
  raster: RasterizedPdfPage,
  saved: SavedPdfPageImage,
): AiExtractedPdfPage {
  const fullPageVisual: AiExtractedPdfVisual = {
    attachmentId: saved.attachmentId,
    mimeType: 'image/jpeg',
    sha256: saved.sha256,
    width: raster.width,
    height: raster.height,
  };
  return {
    ...localPage,
    // The raster is the complete composed page, so vector/form operations no
    // longer represent missing evidence even if local text extraction saw them.
    hasVectorGraphics: false,
    needsVisualReview: true,
    visualEvidence: 'available',
    unresolvedVisualCount: 0,
    // Embedded XObjects are subsets of this image and would duplicate evidence.
    visuals: [fullPageVisual],
  };
}

function pageWithParsedMarkdown(
  rasterizedPage: AiExtractedPdfPage,
  markdown: string,
): AiExtractedPdfPage {
  return {
    ...rasterizedPage,
    text: markdown,
    textBytes: utf8Bytes(markdown),
    truncated: false,
    extractionFailed: false,
    needsOcr: false,
    needsVisualReview: false,
  };
}

async function mapBounded<T>(
  count: number,
  concurrency: number,
  signal: AbortSignal,
  visit: (pageNumber: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let nextPageNumber = 1;

  async function worker(): Promise<void> {
    while (true) {
      abortIfNeeded(signal);
      const pageNumber = nextPageNumber;
      if (pageNumber > count) return;
      nextPageNumber += 1;
      results[pageNumber - 1] = await visit(pageNumber);
    }
  }

  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(count, concurrency) }, () => worker()),
  );
  const rejected = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected !== undefined) throw rejected.reason;
  return results;
}

async function cleanupStagedImages(
  stagedIds: ReadonlySet<string>,
  retainedIds: ReadonlySet<string>,
  deletePageImage: CoherePdfPageImageLifecycle['deletePageImage'],
): Promise<void> {
  if (deletePageImage === undefined) return;
  await Promise.allSettled(
    [...stagedIds]
      .filter((attachmentId) => !retainedIds.has(attachmentId))
      .map((attachmentId) => Promise.resolve().then(() => deletePageImage(attachmentId))),
  );
}

/**
 * Enhance local extraction page by page. Non-abort render, save, or provider
 * errors are contained to that page. This makes Cohere the normal path without
 * making a provider outage capable of discarding Alcove's local extraction.
 */
export async function enrichPdfSourceWithCohere(
  input: CoherePdfPipelineInput,
): Promise<AiExtractedPdfSource> {
  abortIfNeeded(input.signal);
  const openRasterSession = input.openRasterSession ?? openPdfJsRasterSession;
  let session: PdfRasterSession;
  try {
    session = await openRasterSession(input.pdfBytes, input.signal);
  } catch (error) {
    if (isAbort(error, input.signal)) throw abortError();
    return input.localSource;
  }

  const limits = resourceLimits(input.resourceLimits);
  const stagedImageIds = new Set<string>();
  try {
    abortIfNeeded(input.signal);
    const localPages = new Map(
      input.localSource.pages.map((page) => [page.pageNumber, page] as const),
    );
    // Reserving the full per-page allowance before work makes the aggregate
    // text cap deterministic under concurrency. With defaults, 24 pages can
    // each use the complete 256 KiB allowance and remain below 8 MiB.
    const textCapacityPages = limits.maxPageTextBytes === 0
      ? 0
      : Math.floor(limits.maxTotalTextBytes / limits.maxPageTextBytes);
    const workPageCount = Math.min(
      session.pageCount,
      limits.maxParsedPages,
      limits.maxProviderCalls,
      textCapacityPages,
    );
    let derivedRasterBytes = 0;
    let rasterBudgetExhausted = limits.maxDerivedRasterBytes === 0;
    const processed = await mapBounded(
      session.pageCount,
      normalizedConcurrency(input.concurrency),
      input.signal,
      async (pageNumber): Promise<{
        readonly page: AiExtractedPdfPage;
        readonly parsedByProvider: boolean;
      }> => {
        const localPage = localPages.get(pageNumber) ?? unresolvedPage(pageNumber);
        if (pageNumber > workPageCount || rasterBudgetExhausted) {
          return { page: localPage, parsedByProvider: false };
        }
        let raster: RasterizedPdfPage;
        try {
          raster = await session.renderPage(pageNumber, input.signal);
          abortIfNeeded(input.signal);
        } catch (error) {
          if (isAbort(error, input.signal)) throw abortError();
          return { page: localPage, parsedByProvider: false };
        }

        if (
          rasterBudgetExhausted ||
          raster.bytes.byteLength > limits.maxDerivedRasterBytes - derivedRasterBytes
        ) {
          rasterBudgetExhausted = true;
          return { page: localPage, parsedByProvider: false };
        }
        derivedRasterBytes += raster.bytes.byteLength;

        let saved: SavedPdfPageImage;
        try {
          saved = await input.savePageImage(raster.bytes);
          if (saved.attachmentId.trim() === '') {
            throw new Error('The managed page image did not return an id and digest');
          }
          stagedImageIds.add(saved.attachmentId);
          await input.onPageImageSaved?.(saved.attachmentId);
          abortIfNeeded(input.signal);
          if (saved.sha256.trim() === '') {
            throw new Error('The managed page image did not return an id and digest');
          }
        } catch (error) {
          if (isAbort(error, input.signal)) throw abortError();
          return { page: localPage, parsedByProvider: false };
        }

        const rasterizedPage = pageWithRaster(localPage, raster, saved);
        try {
          const parsed = await input.parsePage({
            runId: input.runId,
            attachmentId: saved.attachmentId,
            pageNumber,
            signal: input.signal,
          });
          abortIfNeeded(input.signal);
          const markdown = parsedMarkdown(parsed);
          if (markdown === null) {
            return { page: rasterizedPage, parsedByProvider: false };
          }
          if (utf8Bytes(markdown) > limits.maxPageTextBytes) {
            return { page: localPage, parsedByProvider: false };
          }
          return {
            page: pageWithParsedMarkdown(rasterizedPage, markdown),
            parsedByProvider: true,
          };
        } catch (error) {
          if (isAbort(error, input.signal)) throw abortError();
          return { page: rasterizedPage, parsedByProvider: false };
        }
      },
    );

    const pages = capMergedPdfText(
      processed.map((result) => result.page),
      limits.maxTotalTextBytes,
    );
    const totalTextBytes = pages.reduce((total, page) => total + page.textBytes, 0);
    const retainedImageIds = new Set(
      pages.flatMap((page) => page.visuals.map((visual) => visual.attachmentId)),
    );
    await cleanupStagedImages(stagedImageIds, retainedImageIds, input.deletePageImage);
    abortIfNeeded(input.signal);
    return {
      ...input.localSource,
      pageCount: session.pageCount,
      totalTextBytes,
      truncated: pages.some((page) => page.truncated) || (
        input.localSource.truncated &&
        processed.some((result) => !result.parsedByProvider)
      ),
      pages,
    };
  } catch (error) {
    await cleanupStagedImages(stagedImageIds, new Set(), input.deletePageImage);
    if (isAbort(error, input.signal)) throw abortError();
    throw error;
  } finally {
    await session.destroy().catch(() => undefined);
  }
}

function nextParseRunId(): string {
  parseRunCounter += 1;
  return `pdf-parse-${Date.now().toString(36)}-${parseRunCounter.toString(36)}`;
}

/**
 * Default production PDF extractor. Alcove always completes its local
 * extraction first, then enhances it page by page when provider use is
 * permitted. Provider, raster, or per-page failures therefore degrade to the
 * local source instead of making an attached PDF unusable.
 */
export async function extractAiPdfSourceWithCohere(
  attachmentId: string,
  signal: AbortSignal = new AbortController().signal,
  allowCloud = false,
  pageImageLifecycle: CoherePdfPageImageLifecycle = {},
): Promise<AiExtractedPdfSource> {
  abortIfNeeded(signal);
  const localSource = await extractAiPdfSource(attachmentId);
  abortIfNeeded(signal);
  if (!allowCloud) return localSource;

  const attachment = await readAiAttachment(attachmentId);
  abortIfNeeded(signal);
  if (attachment.metadata.kind !== 'pdf' || attachment.metadata.mimeType !== 'application/pdf') {
    throw new Error('Cohere PDF parsing requires a managed PDF attachment');
  }
  if (attachment.metadata.sha256.toLowerCase() !== localSource.sha256.toLowerCase()) {
    throw new Error('The PDF changed between local extraction and page parsing');
  }

  return enrichPdfSourceWithCohere({
    runId: nextParseRunId(),
    pdfBytes: new Uint8Array(attachment.bytes),
    localSource,
    signal,
    async savePageImage(bytes) {
      const saved = await saveAiAttachment(bytes);
      return { attachmentId: saved.id, sha256: saved.sha256 };
    },
    onPageImageSaved: pageImageLifecycle.onPageImageSaved,
    deletePageImage: pageImageLifecycle.deletePageImage,
    async parsePage(input): Promise<AiParseImageResponse> {
      // Pages run concurrently, while the native run registry requires each
      // active provider request to have a distinct cancellation id.
      return parseAiImage({
        runId: `${input.runId}-p${input.pageNumber}`,
        attachmentId: input.attachmentId,
      }, input.signal);
    },
  });
}

function targetScale(
  widthAtScaleOne: number,
  heightAtScaleOne: number,
  limits: PdfRasterLimits,
): number {
  const maxDimension = Math.max(widthAtScaleOne, heightAtScaleOne);
  const pixelsAtScaleOne = widthAtScaleOne * heightAtScaleOne;
  return Math.max(0.1, Math.min(
    limits.preferredScale,
    limits.maxEdge / maxDimension,
    Math.sqrt(limits.maxPixels / pixelsAtScaleOne),
  ));
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null || blob.type !== 'image/jpeg') {
        reject(new Error('Could not encode the PDF page as JPEG'));
        return;
      }
      resolve(blob);
    }, 'image/jpeg', quality);
  });
}

function reducedCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(source.width * scale));
  canvas.height = Math.max(1, Math.floor(source.height * scale));
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Could not resize the PDF page raster');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function boundedJpeg(
  initialCanvas: HTMLCanvasElement,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number }> {
  let canvas = initialCanvas;
  for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
    for (const quality of [0.9, 0.78, 0.66, 0.54]) {
      abortIfNeeded(signal);
      const blob = await canvasToJpeg(canvas, quality);
      abortIfNeeded(signal);
      if (blob.size <= maxBytes) {
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          width: canvas.width,
          height: canvas.height,
        };
      }
    }
    canvas = reducedCanvas(canvas, 0.78);
  }
  throw new Error('The PDF page raster could not be reduced to its transport cap');
}

async function renderPdfJsPage(
  page: PDFPageProxy,
  pageNumber: number,
  signal: AbortSignal,
  limits: PdfRasterLimits,
): Promise<RasterizedPdfPage> {
  if (typeof document === 'undefined') {
    throw new Error('This device cannot create a local PDF page raster');
  }
  abortIfNeeded(signal);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetScale(base.width, base.height, limits) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Could not create the PDF page renderer');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  let renderTask: RenderTask | null = null;
  const cancelRender = (): void => renderTask?.cancel();
  signal.addEventListener('abort', cancelRender, { once: true });
  try {
    renderTask = page.render({ canvas, viewport, background: '#ffffff' });
    await renderTask.promise;
    abortIfNeeded(signal);
    const encoded = await boundedJpeg(canvas, limits.maxBytes, signal);
    return { pageNumber, ...encoded, mimeType: 'image/jpeg' };
  } catch (error) {
    if (isAbort(error, signal)) throw abortError();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelRender);
    page.cleanup();
    canvas.width = 1;
    canvas.height = 1;
  }
}

/** Default browser/Tauri renderer. The worker and page pixels stay local. */
export async function openPdfJsRasterSession(
  pdfBytes: Uint8Array,
  signal: AbortSignal,
  limits: PdfRasterLimits = DEFAULT_PDF_RASTER_LIMITS,
): Promise<PdfRasterSession> {
  abortIfNeeded(signal);
  const pdfjs = await import('pdfjs-dist');
  abortIfNeeded(signal);
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let documentProxy: PDFDocumentProxy | null = null;
  const destroy = async (): Promise<void> => {
    if (documentProxy !== null) {
      const owned = documentProxy;
      documentProxy = null;
      await owned.destroy();
    } else if (loadingTask !== null) {
      await loadingTask.destroy();
    }
  };
  const cancelLoad = (): void => { void destroy(); };
  signal.addEventListener('abort', cancelLoad, { once: true });
  try {
    // PDF.js transfers typed-array ownership to its worker, so preserve the
    // caller's managed attachment buffer by handing it a private copy.
    loadingTask = pdfjs.getDocument({
      data: pdfBytes.slice(),
      // User PDFs are untrusted evidence. Font-expression evaluation is not
      // needed for extraction and remains disabled even on patched PDF.js.
      isEvalSupported: false,
    });
    documentProxy = await loadingTask.promise;
    abortIfNeeded(signal);
  } catch (error) {
    await destroy().catch(() => undefined);
    if (isAbort(error, signal)) throw abortError();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelLoad);
  }

  const pdfDocument = documentProxy;
  if (pdfDocument === null) throw new Error('PDF.js did not return a document');
  return {
    pageCount: pdfDocument.numPages,
    async renderPage(pageNumber, pageSignal) {
      abortIfNeeded(pageSignal);
      const page = await pdfDocument.getPage(pageNumber);
      abortIfNeeded(pageSignal);
      return renderPdfJsPage(page, pageNumber, pageSignal, limits);
    },
    async destroy() {
      await destroy();
    },
  };
}
