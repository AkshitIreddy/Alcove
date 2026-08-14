/**
 * Production disposable preview workspace for the in-book AI agent.
 *
 * This module owns the deterministic half of the contract: tolerant Notebook
 * Script parsing, protected page boundaries, fetch resolution, mapping through
 * the real TipTap schema, validation, generation caching, opaque image storage
 * and cleanup. The DOM work is dynamically imported from draftSandboxMount.tsx
 * so logic tests and the shelf's first chunk never construct a PageEditor.
 */
import type { Schema } from '@tiptap/pm/model';
import {
  sqliteReviewedDraftReceiptStore,
  type ReviewedDraftReceiptStore,
} from '../../data/aiAgentReviewedDraft';
import { isTauri } from '../../data/db';
import {
  deleteAiAttachment,
  readAiAttachment,
  saveAiAttachment,
  type AiAttachmentData,
  type AiAttachmentMetadata,
} from '../../data/aiGateway';
import type { PageDoc } from '../../data/types';
import {
  stageFetchedImages,
  type FetchedImageAssetReceipt,
} from '../../editor/media/assets';
import { mountedSheetLayoutFingerprint } from '../../editor/script/exporters/pageGeometry';
import {
  analyzeNotebookScriptPages,
  parseNotebookScriptPages,
} from '../../editor/script/pageBoundaries';
import { docToScript } from '../../editor/script/fromTiptap';
import {
  resolveScriptFetchesWithManifest,
  type ScriptImageFetcher,
} from '../../editor/script/resolveFetches';
import { scriptDocToTiptap } from '../../editor/script/toTiptap';
import type { Block, Diag, ScriptDoc } from '../../script';
import type {
  AgentHashAdapter,
  DraftSandboxAdapter,
  DraftSandboxTargetPage,
} from './adapters';
import { webCryptoAgentHash } from './adapters';
import { jsonStorageCanonicalPageDoc } from './pageDocStorage';
import {
  REVIEWED_DRAFT_RECEIPT_VERSION,
  cloneReviewedDraftReceipt,
  createReviewedDraftReceipt,
  verifyReviewedDraftReceipt,
  type ReviewedDraftReceipt,
  type ReviewedDraftApplicationPlan,
} from './reviewedReceipt';
import type {
  AgentImageRef,
  DraftPreviewGeneration,
  DraftPreviewPage,
  NotebookDraft,
  NotebookInsertionTarget,
  NotebookScriptDiagnostic,
  NotebookScriptValidation,
  NotebookSnapshotRef,
} from './types';

// v4 makes the approval raster inherit the currently resolved page stock
// instead of the file exporter's fixed house parchment. Keeping this in the
// render identity prevents a pre-upgrade cream preview from being hydrated
// after the reader has moved to the faithful capture path.
export const DRAFT_SANDBOX_RENDERER_VERSION = 'alcove-page-editor-v4';

const MAX_SCRIPT_CHARACTERS = 2_000_000;
const MAX_AUTHORED_PAGES = 96;
const MAX_SCRIPT_BLOCKS = 3_000;
const MAX_FETCH_DIRECTIVES = 24;

const BLOCKING_PARSER_CODES = new Set<string>([
  'internal-error',
  'unknown-container',
  'container-unclosed',
  'container-stray-close',
  'container-two-colon-open',
  'col-outside-columns',
  'fence-unclosed',
  'image-missing-src',
  'fetch-missing-query',
  'html-not-script',
  'jsx-not-script',
  'import-not-script',
  'frontmatter-unclosed',
  'frontmatter-invalid',
  'attr-unclosed',
  'attr-unclosed-quote',
  'math-unclosed',
]);

export interface PreparedDraftPage {
  readonly authoredPageNumber: number;
  readonly source: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly doc: PageDoc;
}

export interface PreparedDraft {
  readonly draftHash: string;
  readonly pages: readonly PreparedDraftPage[];
  readonly parserDiagnostics: readonly NotebookScriptDiagnostic[];
  readonly staticDiagnostics: readonly NotebookScriptDiagnostic[];
  readonly imageDiagnostics: readonly NotebookScriptDiagnostic[];
  readonly pageLedgerDiagnostics: readonly NotebookScriptDiagnostic[];
}

/** A page after the real mounted PageEditor has completed its overflow drain. */
export interface MountedDraftPage {
  readonly doc: PageDoc;
  readonly pngBytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly sourceStart?: number;
  readonly sourceEnd?: number;
  readonly producedOverflow: boolean;
  readonly diagnostics: readonly NotebookScriptDiagnostic[];
}

export interface DraftPageMountRequest {
  readonly pages: readonly PreparedDraftPage[];
  readonly insertionSlot: number;
  /** Present only when the preview must include an existing target page. */
  readonly targetPage?: DraftSandboxTargetPage;
  readonly insertionTarget: NotebookInsertionTarget;
  readonly signal: AbortSignal;
}

export type DraftPageRenderer = (
  request: DraftPageMountRequest,
) => Promise<readonly MountedDraftPage[]>;

export interface DraftPreviewAssetStore {
  save(bytes: Uint8Array): Promise<AiAttachmentMetadata>;
  read(resourceId: string): Promise<AiAttachmentData>;
  delete(resourceId: string): Promise<boolean>;
}

export interface StoredDraftGeneration {
  readonly renderKey: string;
  /** Hash of the transform-free leaf and typography environment reviewed. */
  readonly renderEnvironmentDigest: string;
  readonly generation: DraftPreviewGeneration;
}

export interface DraftGenerationMetadataStore {
  get(generationId: string): StoredDraftGeneration | null;
  put(value: StoredDraftGeneration): void;
  delete(generationId: string): void;
  list(): readonly StoredDraftGeneration[];
}

export interface ProductionDraftSandboxOptions {
  readonly hash?: AgentHashAdapter;
  readonly now?: () => string;
  readonly resolveFetches?: (doc: ScriptDoc) => Promise<ScriptDoc>;
  /** Test/provider seam; production stages through Rust without an asset row. */
  readonly stageImages?: ScriptImageFetcher;
  readonly renderPages?: DraftPageRenderer;
  /** Test seam; production omits it and derives availability from the full schema. */
  readonly hasNode?: (name: string) => boolean;
  readonly assets?: DraftPreviewAssetStore;
  readonly generations?: DraftGenerationMetadataStore;
  readonly receipts?: ReviewedDraftReceiptStore;
  /** Deterministic test/custom seam; production measures the current live leaf. */
  readonly renderEnvironment?: () => Record<string, unknown>;
}

export interface ProductionDraftSandbox {
  readonly adapter: DraftSandboxAdapter;
  /** Exact private render bytes used by the provider on the next review turn. */
  readAsset(resourceId: string): Promise<AiAttachmentData>;
  /** Synchronous lookup used by the panel after render/getGeneration hydrates it. */
  renderUrlFor(image: AgentImageRef): string;
  /** Revoke process-local object URLs while retaining resumable durable previews. */
  releaseUrls(): void;
  /** Dispose every preview generation owned by this sandbox instance/store. */
  disposeAll(): Promise<void>;
}

interface ResolvedPreparation {
  readonly prepared: PreparedDraft;
  readonly validation: NotebookScriptValidation;
  readonly fetchedAssets: readonly FetchedImageAssetReceipt[];
}

interface MemoryAttachment {
  readonly metadata: AiAttachmentMetadata;
  readonly bytes: Uint8Array;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new DOMException('The draft preview was cancelled.', 'AbortError');
}

function hasErrors(diagnostics: readonly NotebookScriptDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

function parserDiagnostic(diag: Diag, pageNumber?: number): NotebookScriptDiagnostic {
  const expected = diag.expected === undefined ? '' : ` Expected ${diag.expected}.`;
  return {
    severity: BLOCKING_PARSER_CODES.has(diag.code) ? 'error' : 'warning',
    code: `parser.${diag.code}`,
    message: `${diag.message}${expected}`,
    line: diag.line,
    column: diag.column,
    ...(pageNumber === undefined ? {} : { pageNumber }),
  };
}

function pageNumberAtOffset(
  pages: readonly { readonly sourceStart: number; readonly sourceEnd: number }[],
  offset: number,
): number | undefined {
  const index = pages.findIndex(
    (page) => offset >= page.sourceStart && offset <= page.sourceEnd,
  );
  return index < 0 ? undefined : index + 1;
}

function walkBlocks(blocks: readonly Block[], visit: (block: Block) => void): void {
  for (const block of blocks) {
    visit(block);
    if (block.kind === 'container') walkBlocks(block.children, visit);
  }
}

function countBlocks(doc: ScriptDoc): number {
  let count = 0;
  walkBlocks(doc.blocks, () => {
    count += 1;
  });
  return count;
}

function countFetches(doc: ScriptDoc): number {
  let count = 0;
  walkBlocks(doc.blocks, (block) => {
    if (block.kind === 'fetchDirective') count += 1;
  });
  return count;
}

function mediaDiagnostics(
  pages: readonly { readonly doc: ScriptDoc }[],
): NotebookScriptDiagnostic[] {
  const out: NotebookScriptDiagnostic[] = [];
  pages.forEach((page, pageIndex) => {
    walkBlocks(page.doc.blocks, (block) => {
      if (block.kind === 'fetchDirective') {
        out.push({
          severity: 'error',
          code: 'image.fetch-unresolved',
          message: `Image search for “${block.query}” was not resolved into an image or upload card.`,
          pageNumber: pageIndex + 1,
        });
        return;
      }
      if (block.kind !== 'image') return;
      const placeholder =
        typeof block.attrs.placeholder === 'string'
          ? block.attrs.placeholder.trim()
          : '';
      const asset =
        typeof block.attrs.asset === 'string' ? block.attrs.asset.trim() : '';
      const source = block.src.trim();
      if (source === '' && asset === '' && placeholder === '') {
        out.push({
          severity: 'error',
          code: 'image.missing-source',
          message: 'An image block has neither an image, a managed asset, nor an upload prompt.',
          pageNumber: pageIndex + 1,
        });
        return;
      }
      if (placeholder !== '') {
        out.push({
          severity: 'warning',
          code: 'image.awaiting-upload',
          message: `The preview contains an upload card for “${placeholder}”.`,
          pageNumber: pageIndex + 1,
        });
      }
      if (/^(?:javascript|file|vbscript):/i.test(source) || /^http:/i.test(source)) {
        out.push({
          severity: 'error',
          code: 'image.unsafe-source',
          message: 'Image sources must use HTTPS, a managed asset, or an image data URL.',
          pageNumber: pageIndex + 1,
        });
      }
      if (/^https:/i.test(source) && asset === '') {
        out.push({
          severity: 'error',
          code: 'image.remote-source-unstaged',
          message:
            'Remote images must be resolved through a fetch directive into a verified managed asset before preview.',
          pageNumber: pageIndex + 1,
        });
      }
      if (/^data:/i.test(source) && !/^data:image\/(?:png|jpeg|webp|gif);/i.test(source)) {
        out.push({
          severity: 'error',
          code: 'image.invalid-data-url',
          message: 'Only PNG, JPEG, WebP, or GIF image data URLs can be rendered.',
          pageNumber: pageIndex + 1,
        });
      }
    });
  });
  return out;
}

function normalizedSource(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function meaningfulNode(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  const value = node as { type?: unknown; text?: unknown; content?: unknown[] };
  if (typeof value.text === 'string' && value.text.trim() !== '') return true;
  if (
    typeof value.type === 'string' &&
    [
      'image',
      'video',
      'diagram',
      'sticker',
      'pageMark',
      'math',
      'mathInline',
    ].includes(value.type)
  ) {
    return true;
  }
  return Array.isArray(value.content) && value.content.some(meaningfulNode);
}

export function pageDocIsMeaningful(doc: PageDoc): boolean {
  return Array.isArray(doc.content) && doc.content.some(meaningfulNode);
}

function pageLedgerDiagnostics(
  sources: readonly string[],
  docs: readonly PageDoc[],
): NotebookScriptDiagnostic[] {
  const out: NotebookScriptDiagnostic[] = [];
  const seenSources = new Map<string, number>();
  docs.forEach((doc, index) => {
    if (!pageDocIsMeaningful(doc)) {
      out.push({
        severity: 'error',
        code: 'page.empty',
        message: 'This protected page has no readable or visual content.',
        pageNumber: index + 1,
      });
    }
    const normalized = normalizedSource(sources[index] ?? '');
    if (normalized.length < 160) return;
    const earlier = seenSources.get(normalized);
    if (earlier !== undefined) {
      out.push({
        severity: 'error',
        code: 'page.duplicate-authored-section',
        message: `This authored page repeats page ${earlier + 1} verbatim.`,
        pageNumber: index + 1,
      });
    } else {
      seenSources.set(normalized, index);
    }
  });
  return out;
}

function structuralBoundaryOffsets(source: string, maskedSource: string): number[] {
  const originalLines = source.replace(/\r\n?/g, '\n').split('\n');
  const maskedLines = maskedSource.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  originalLines.forEach((line, index) => {
    if (
      /^\s*::page\s*(?:#.*)?$/.test(line) &&
      maskedLines[index] === ' '.repeat(line.length)
    ) {
      offsets.push(offset);
    }
    offset += line.length + (index < originalLines.length - 1 ? 1 : 0);
  });
  return offsets;
}

function emptyBoundaryDiagnostics(source: string, maskedSource: string): NotebookScriptDiagnostic[] {
  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const lineStarts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }
  const offsets = structuralBoundaryOffsets(normalized, maskedSource);
  const boundaryLines = offsets.map((offset) => {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= offset) line += 1;
    return line;
  });
  const out: NotebookScriptDiagnostic[] = [];
  const ranges: { startLine: number; endLine: number; markerLine?: number }[] = [];
  let startLine = 0;
  for (const markerLine of boundaryLines) {
    ranges.push({ startLine, endLine: markerLine, markerLine });
    startLine = markerLine + 1;
  }
  ranges.push({ startLine, endLine: lines.length });
  ranges.forEach((range, pageIndex) => {
    const segment = lines.slice(range.startLine, range.endLine).join('\n').trim();
    if (segment !== '') return;
    out.push({
      severity: 'error',
      code: 'page.empty-boundary',
      message: 'A ::page boundary creates an empty page. Remove it or add page content.',
      line: (range.markerLine ?? range.startLine) + 1,
      column: 1,
      pageNumber: pageIndex + 1,
    });
  });
  return out;
}

function stripVolatileIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileIdentity);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (key === 'id' && record === (value as Record<string, unknown>)) {
      // UniqueID block attributes are mount-local and do not describe content.
      continue;
    }
    out[key] = stripVolatileIdentity(record[key]);
  }
  return out;
}

function canonicalBlock(block: unknown): string {
  return JSON.stringify(stripVolatileIdentity(block));
}

function plainText(value: unknown): string {
  if (value === null || typeof value !== 'object') return '';
  if (Array.isArray(value)) return value.map(plainText).join(' ');
  const node = value as { text?: unknown; content?: unknown[] };
  const own = typeof node.text === 'string' ? node.text : '';
  const nested = Array.isArray(node.content) ? node.content.map(plainText).join(' ') : '';
  return `${own} ${nested}`.replace(/\s+/g, ' ').trim();
}

function renderedDuplicationDiagnostics(
  pages: readonly MountedDraftPage[],
): NotebookScriptDiagnostic[] {
  const out: NotebookScriptDiagnostic[] = [];
  const seenPages = new Map<string, number>();
  const seenBlocks = new Map<string, number>();
  pages.forEach((page, pageIndex) => {
    const text = plainText(page.doc);
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.length >= 120) {
      const earlier = seenPages.get(normalized);
      if (earlier !== undefined) {
        out.push({
          severity: 'error',
          code: 'layout.duplicate-page',
          message: `The rendered page repeats the readable content of page ${earlier + 1}.`,
          pageNumber: pageIndex + 1,
        });
      } else {
        seenPages.set(normalized, pageIndex);
      }
    }
    for (const block of page.doc.content ?? []) {
      const signature = canonicalBlock(block);
      if (signature.length < 240 || plainText(block).length < 72) continue;
      const earlier = seenBlocks.get(signature);
      if (earlier !== undefined && earlier !== pageIndex) {
        out.push({
          severity: 'warning',
          code: 'layout.duplicate-block',
          message: `A substantial block also appears on rendered page ${earlier + 1}. Check that it was not copied during pagination.`,
          pageNumber: pageIndex + 1,
        });
      } else {
        seenBlocks.set(signature, pageIndex);
      }
    }
  });
  return out;
}

function insertionSlot(
  target: NotebookInsertionTarget,
  snapshot: NotebookSnapshotRef,
): number {
  const indexOf = (pageId: string): number => {
    const index = snapshot.pageIds.indexOf(pageId);
    return index < 0 ? snapshot.pageIds.length : index;
  };
  switch (target.kind) {
    case 'book_start':
      return 0;
    case 'book_end':
      return snapshot.pageIds.length;
    case 'before_page':
      return indexOf(target.pageId);
    case 'after_page':
      return indexOf(target.pageId) + 1;
    case 'caret':
    case 'replace_selection':
      return indexOf(target.pageId);
    case 'new_pages':
      return target.afterPageId === undefined ? snapshot.pageIds.length : indexOf(target.afterPageId) + 1;
  }
}

function integratedTarget(
  target: NotebookInsertionTarget,
): target is Extract<NotebookInsertionTarget, { readonly kind: 'caret' | 'replace_selection' }> {
  return target.kind === 'caret' || target.kind === 'replace_selection';
}

async function assertExactTargetPage(
  target: NotebookInsertionTarget,
  targetPage: DraftSandboxTargetPage | undefined,
  snapshot: NotebookSnapshotRef,
  hash: AgentHashAdapter,
): Promise<void> {
  if (!integratedTarget(target)) {
    if (targetPage !== undefined) {
      throw new Error('A structural preview must not carry an integrated target page.');
    }
    return;
  }
  if (
    targetPage === undefined ||
    targetPage.pageId !== target.pageId ||
    snapshot.pageRevisions[target.pageId] !== targetPage.revision ||
    !snapshot.pageIds.includes(target.pageId)
  ) {
    throw new Error(
      'The exact caret/selection target no longer matches the inspected notebook snapshot.',
    );
  }
  if ((await hash.digestJson(targetPage.doc)) !== targetPage.documentDigest) {
    throw new Error('The exact target page document failed its content digest check.');
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function previewUrl(bytes: Uint8Array, mimeType: string): string {
  try {
    if (typeof URL.createObjectURL === 'function') {
      return URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
    }
  } catch {
    // Web Storage/privacy modes can disable blob URLs; a data URL remains local.
  }
  return `data:${mimeType};base64,${base64(bytes)}`;
}

function revokePreviewUrl(url: string): void {
  if (!url.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // A tearing-down WebView may have already released its URL registry.
  }
}

function randomId(prefix: string): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
}

function createMemoryAssetStore(hash: AgentHashAdapter): DraftPreviewAssetStore {
  const values = new Map<string, MemoryAttachment>();
  return {
    async save(bytes) {
      const sha256 = await hash.digestText(base64(bytes));
      const id = `preview_${sha256.slice(0, 32)}`;
      const metadata: AiAttachmentMetadata = {
        id,
        kind: 'png',
        mimeType: 'image/png',
        sizeBytes: bytes.byteLength,
        sha256,
      };
      values.set(id, { metadata, bytes: bytes.slice() });
      return metadata;
    },
    async read(resourceId) {
      const value = values.get(resourceId);
      if (value === undefined) throw new Error('preview image is no longer available');
      return { metadata: value.metadata, bytes: Array.from(value.bytes) };
    },
    async delete(resourceId) {
      return values.delete(resourceId);
    },
  };
}

function defaultAssetStore(hash: AgentHashAdapter): DraftPreviewAssetStore {
  if (!isTauri()) return createMemoryAssetStore(hash);
  return {
    save: (bytes) => saveAiAttachment(bytes, 'preview'),
    read: readAiAttachment,
    delete: deleteAiAttachment,
  };
}

const GENERATION_PREFIX = 'alcove.ai.preview.v2.';

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isGeneration(value: unknown): value is DraftPreviewGeneration {
  if (value === null || typeof value !== 'object') return false;
  const generation = value as Partial<DraftPreviewGeneration>;
  return (
    typeof generation.generationId === 'string' &&
    typeof generation.draftHash === 'string' &&
    typeof generation.layoutHash === 'string' &&
    generation.rendererVersion === DRAFT_SANDBOX_RENDERER_VERSION &&
    Array.isArray(generation.pages) &&
    generation.pages.every(
      (page) =>
        page !== null &&
        typeof page === 'object' &&
        typeof page.pageId === 'string' &&
        typeof page.paginationSpill === 'boolean' &&
        typeof page.residualOverflow === 'boolean' &&
        page.image !== null &&
        typeof page.image === 'object' &&
        typeof page.image.resourceId === 'string',
    )
  );
}

export function createBrowserDraftGenerationStore(): DraftGenerationMetadataStore {
  const memory = new Map<string, StoredDraftGeneration>();
  const storage = browserStorage();
  const parse = (raw: string | null): StoredDraftGeneration | null => {
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as Partial<StoredDraftGeneration>;
      return (
        typeof value.renderKey === 'string' &&
        typeof value.renderEnvironmentDigest === 'string' &&
        isGeneration(value.generation)
      )
        ? (value as StoredDraftGeneration)
        : null;
    } catch {
      return null;
    }
  };
  return {
    get(generationId) {
      const inMemory = memory.get(generationId);
      if (inMemory !== undefined) return inMemory;
      const stored = parse(storage?.getItem(`${GENERATION_PREFIX}${generationId}`) ?? null);
      if (stored !== null) memory.set(generationId, stored);
      return stored;
    },
    put(value) {
      memory.set(value.generation.generationId, value);
      try {
        storage?.setItem(
          `${GENERATION_PREFIX}${value.generation.generationId}`,
          JSON.stringify(value),
        );
      } catch {
        // Metadata is an optimization; active in-memory previews still work.
      }
    },
    delete(generationId) {
      memory.delete(generationId);
      try {
        storage?.removeItem(`${GENERATION_PREFIX}${generationId}`);
      } catch {
        // Best-effort cleanup in storage-denied WebViews.
      }
    },
    list() {
      if (storage !== null) {
        try {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key === null || !key.startsWith(GENERATION_PREFIX)) continue;
            const value = parse(storage.getItem(key));
            if (value !== null) memory.set(value.generation.generationId, value);
          }
        } catch {
          // Return the metadata already available in memory.
        }
      }
      return [...memory.values()];
    },
  };
}

/**
 * Load only a receipt whose content digest and reviewed-generation identity
 * still match the immutable preview contract.
 */
export async function loadReviewedDraftReceipt(
  expected: {
    readonly generationId: string;
    readonly draftHash: string;
    readonly layoutHash: string;
    readonly bookSnapshotRevision: string;
    readonly insertionTarget?: NotebookInsertionTarget;
  },
  options: {
    readonly store?: ReviewedDraftReceiptStore;
    readonly hash?: AgentHashAdapter;
  } = {},
): Promise<ReviewedDraftReceipt | null> {
  const store = options.store ?? sqliteReviewedDraftReceiptStore;
  const hash = options.hash ?? webCryptoAgentHash;
  const receipt = await store.get(expected.generationId);
  if (receipt === null) return null;
  try {
    return (await verifyReviewedDraftReceipt(receipt, expected, hash))
      ? cloneReviewedDraftReceipt(receipt)
      : null;
  } catch {
    return null;
  }
}

let schemaPromise: Promise<Schema> | null = null;

function realSchema(): Promise<Schema> {
  schemaPromise ??= Promise.all([
    import('@tiptap/core'),
    import('../../editor/extensions'),
  ]).then(([{ getSchema }, { createEditorExtensions }]) =>
    getSchema(createEditorExtensions()),
  );
  return schemaPromise;
}

async function defaultPageRenderer(
  request: DraftPageMountRequest,
): Promise<readonly MountedDraftPage[]> {
  const module = await import('./draftSandboxMount');
  return module.renderDraftPagesInSandbox(request);
}

function environmentFingerprint(): Record<string, unknown> {
  if (typeof document === 'undefined') return { environment: 'no-dom' };
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return {
    dataset: Object.fromEntries(Object.entries(root.dataset).sort(([a], [b]) => a.localeCompare(b))),
    devicePixelRatio: globalThis.devicePixelRatio ?? 1,
    bodyFontSize: style.getPropertyValue('--page-text-size').trim(),
    bodyScale: style.getPropertyValue('--page-text-scale').trim(),
    bodyFace: style.getPropertyValue('--font-body').trim(),
    tracking: style.getPropertyValue('--tracking-body').trim(),
    paper: style.getPropertyValue('--paper-cream').trim(),
    ink: style.getPropertyValue('--ink-sepia').trim(),
    // Computed sheet dimensions are layout geometry. Drawn rectangles are not:
    // rail-panel fit, focus zoom and the README camera all use transforms and
    // must leave a reviewed generation reusable at the same fixed leaf size.
    pageLayout: mountedSheetLayoutFingerprint(),
  };
}

/**
 * Build the production sandbox and its synchronous image-URL resolver.
 *
 * `adapter` is passed to AgentRuntime. `renderUrlFor` is passed to the panel.
 * The optional seams exist for focused tests; omitting them uses Tauri-managed
 * attachments and the real hidden Solid/PageEditor capture implementation.
 */
export function createProductionDraftSandbox(
  options: ProductionDraftSandboxOptions = {},
): ProductionDraftSandbox {
  const hash = options.hash ?? webCryptoAgentHash;
  const now = options.now ?? (() => new Date().toISOString());
  const resolver = options.resolveFetches;
  const stageImages = options.stageImages ?? stageFetchedImages;
  const renderer = options.renderPages ?? defaultPageRenderer;
  const assets = options.assets ?? defaultAssetStore(hash);
  const generations = options.generations ?? createBrowserDraftGenerationStore();
  const receipts = options.receipts ?? sqliteReviewedDraftReceiptStore;
  const readRenderEnvironment = options.renderEnvironment ?? environmentFingerprint;
  const preparedCache = new Map<string, Promise<ResolvedPreparation>>();
  const urls = new Map<string, string>();

  const hydrateUrl = (resourceId: string, bytes: Uint8Array, mimeType: string): void => {
    if (urls.has(resourceId)) return;
    urls.set(resourceId, previewUrl(bytes, mimeType));
  };

  const prepare = (
    draft: NotebookDraft,
    signal: AbortSignal,
  ): Promise<ResolvedPreparation> => {
    const cached = preparedCache.get(draft.draftHash);
    if (cached !== undefined) return cached;
    const task = (async (): Promise<ResolvedPreparation> => {
      throwIfAborted(signal);
      const parsed = parseNotebookScriptPages(draft.script);
      const analysis = analyzeNotebookScriptPages(draft.script);
      const pageRanges = analysis.pages.map((page) => ({
        sourceStart: page.start,
        sourceEnd: page.end,
      }));
      const parserDiagnostics = parsed.preview.diagnostics.map((diag) =>
        parserDiagnostic(diag, pageNumberAtOffset(pageRanges, diag.span.srcStart)),
      );
      const staticDiagnostics: NotebookScriptDiagnostic[] = [];
      if (draft.script.length > MAX_SCRIPT_CHARACTERS) {
        staticDiagnostics.push({
          severity: 'error',
          code: 'script.too-large',
          message: `The draft exceeds the ${MAX_SCRIPT_CHARACTERS.toLocaleString()} character sandbox limit.`,
        });
      }
      if (parsed.pages.length > MAX_AUTHORED_PAGES) {
        staticDiagnostics.push({
          severity: 'error',
          code: 'script.too-many-pages',
          message: `The draft has ${parsed.pages.length} authored pages; the preview limit is ${MAX_AUTHORED_PAGES}.`,
        });
      }
      const blockCount = countBlocks(parsed.preview);
      if (blockCount > MAX_SCRIPT_BLOCKS) {
        staticDiagnostics.push({
          severity: 'error',
          code: 'script.too-many-blocks',
          message: `The draft has ${blockCount} blocks; the preview limit is ${MAX_SCRIPT_BLOCKS}.`,
        });
      }
      const fetchCount = countFetches(parsed.preview);
      if (fetchCount > MAX_FETCH_DIRECTIVES) {
        staticDiagnostics.push({
          severity: 'error',
          code: 'script.too-many-image-searches',
          message: `The draft requests ${fetchCount} image searches; use at most ${MAX_FETCH_DIRECTIVES} in one generation.`,
        });
      }
      staticDiagnostics.push(...emptyBoundaryDiagnostics(draft.script, analysis.maskedSource));

      const canResolve =
        !hasErrors(parserDiagnostics) &&
        !hasErrors(staticDiagnostics) &&
        !signal.aborted;
      const resolvedDocs: ScriptDoc[] = [];
      const fetchedAssets: FetchedImageAssetReceipt[] = [];
      for (const page of parsed.pages) {
        throwIfAborted(signal);
        if (!canResolve) {
          resolvedDocs.push(page.doc);
        } else if (resolver !== undefined) {
          // Explicit test/custom seam owns any media receipt it needs. The
          // production path below is the one that stages searched assets.
          resolvedDocs.push(await resolver(page.doc));
        } else {
          const resolved = await resolveScriptFetchesWithManifest(
            page.doc,
            stageImages,
          );
          resolvedDocs.push(resolved.doc);
          fetchedAssets.push(...resolved.fetchedAssets);
        }
      }
      throwIfAborted(signal);

      const storageSchema = options.hasNode === undefined ? await realSchema() : null;
      const hasNode =
        options.hasNode ?? ((name: string) => storageSchema?.nodes[name] !== undefined);
      const docs = resolvedDocs.map((doc) =>
        scriptDocToTiptap(doc, {
          hasNode,
        }),
      );
      const imageDiagnostics = mediaDiagnostics(
        resolvedDocs.map((doc) => ({ doc })),
      );
      const ledgerDiagnostics = [
        ...pageLedgerDiagnostics(
          parsed.pages.map((page) => page.source),
          docs,
        ),
      ];
      const actualHash = await hash.digestText(draft.script);
      if (actualHash !== draft.draftHash) {
        staticDiagnostics.push({
          severity: 'error',
          code: 'script.hash-mismatch',
          message: 'The draft changed after its identity was calculated. Submit the current script again.',
        });
      }
      const preparedPages: PreparedDraftPage[] = docs.map((doc, index) => ({
        authoredPageNumber: index + 1,
        source: parsed.pages[index]?.source ?? '',
        sourceStart: analysis.pages[index]?.start ?? 0,
        sourceEnd: analysis.pages[index]?.end ?? draft.script.length,
        doc,
      }));
      const validation: NotebookScriptValidation = {
        draftHash: draft.draftHash,
        parserDiagnostics,
        staticDiagnostics,
        imageDiagnostics,
        pageLedgerDiagnostics: ledgerDiagnostics,
        valid: ![
          ...parserDiagnostics,
          ...staticDiagnostics,
          ...imageDiagnostics,
          ...ledgerDiagnostics,
        ].some((diagnostic) => diagnostic.severity === 'error'),
        checkedAt: now(),
      };
      return {
        prepared: {
          draftHash: draft.draftHash,
          pages: preparedPages,
          parserDiagnostics,
          staticDiagnostics,
          imageDiagnostics,
          pageLedgerDiagnostics: ledgerDiagnostics,
        },
        validation,
        fetchedAssets,
      };
    })();
    preparedCache.set(draft.draftHash, task);
    void task.catch(() => {
      if (preparedCache.get(draft.draftHash) === task) preparedCache.delete(draft.draftHash);
    });
    return task;
  };

  const renderEnvironmentDigest = (): Promise<string> =>
    hash.digestJson(readRenderEnvironment());

  const assertRenderEnvironmentCurrent = async (
    expectedDigest: string,
    signal: AbortSignal,
  ): Promise<void> => {
    const currentDigest = await renderEnvironmentDigest();
    throwIfAborted(signal);
    if (currentDigest !== expectedDigest) {
      throw new Error(
        'The notebook page size changed while the preview was rendering. Render it again in the settled layout.',
      );
    }
  };

  const getGeneration = async (
    generationId: string,
    signal: AbortSignal,
    expectedRenderEnvironmentDigest?: string,
  ): Promise<DraftPreviewGeneration | null> => {
    throwIfAborted(signal);
    const stored = generations.get(generationId);
    const currentRenderEnvironmentDigest =
      expectedRenderEnvironmentDigest ?? await renderEnvironmentDigest();
    throwIfAborted(signal);
    if (
      stored === null ||
      stored.renderEnvironmentDigest !== currentRenderEnvironmentDigest ||
      stored.generation.rendererVersion !== DRAFT_SANDBOX_RENDERER_VERSION
    ) {
      return null;
    }
    try {
      const receipt = await loadReviewedDraftReceipt(
        {
          generationId: stored.generation.generationId,
          draftHash: stored.generation.draftHash,
          layoutHash: stored.generation.layoutHash,
          bookSnapshotRevision: stored.generation.bookSnapshotRevision,
        },
        { store: receipts, hash },
      );
      if (receipt === null) return null;
      for (const page of stored.generation.pages) {
        throwIfAborted(signal);
        if (urls.has(page.image.resourceId)) continue;
        const data = await assets.read(page.image.resourceId);
        throwIfAborted(signal);
        if (
          data.metadata.sha256 !== page.image.digest ||
          data.metadata.mimeType !== page.image.mimeType
        ) {
          return null;
        }
        hydrateUrl(
          page.image.resourceId,
          new Uint8Array(data.bytes),
          page.image.mimeType,
        );
      }
      return stored.generation;
    } catch (error) {
      if (signal.aborted) throwIfAborted(signal);
      void error;
      return null;
    }
  };

  const dispose = async (generationId: string): Promise<void> => {
    const stored = generations.get(generationId);
    if (stored === null) {
      await receipts.delete(generationId).catch(() => undefined);
      return;
    }
    generations.delete(generationId);
    await receipts.delete(generationId).catch(() => undefined);
    const stillUsed = new Set(
      generations
        .list()
        .flatMap((entry) => entry.generation.pages.map((page) => page.image.resourceId)),
    );
    const resourceIds = new Set(stored.generation.pages.map((page) => page.image.resourceId));
    await Promise.all(
      [...resourceIds].map(async (resourceId) => {
        if (stillUsed.has(resourceId)) return;
        const url = urls.get(resourceId);
        if (url !== undefined) revokePreviewUrl(url);
        urls.delete(resourceId);
        await assets.delete(resourceId).catch(() => false);
      }),
    );
  };

  const adapter: DraftSandboxAdapter = {
    async validate(draft, context) {
      throwIfAborted(context.signal);
      await assertExactTargetPage(
        context.insertionTarget,
        context.targetPage,
        context.bookSnapshot,
        hash,
      );
      return (await prepare(draft, context.signal)).validation;
    },
    async render(draft, context) {
      throwIfAborted(context.signal);
      await assertExactTargetPage(
        context.insertionTarget,
        context.targetPage,
        context.bookSnapshot,
        hash,
      );
      const { prepared, validation, fetchedAssets } = await prepare(draft, context.signal);
      if (!validation.valid) {
        throw new Error('The draft must pass deterministic validation before rendering.');
      }
      const currentRenderEnvironment = readRenderEnvironment();
      const currentRenderEnvironmentDigest = await hash.digestJson(
        currentRenderEnvironment,
      );
      const renderKey = await hash.digestJson({
        rendererVersion: DRAFT_SANDBOX_RENDERER_VERSION,
        draftHash: draft.draftHash,
        bookRevision: context.bookSnapshot.bookRevision,
        insertionTarget: context.insertionTarget,
        targetDocumentDigest: context.targetPage?.documentDigest,
        environment: currentRenderEnvironment,
      });
      const cached = generations.list().find((entry) => entry.renderKey === renderKey);
      if (cached !== undefined) {
        const hydrated = await getGeneration(
          cached.generation.generationId,
          context.signal,
          currentRenderEnvironmentDigest,
        );
        if (hydrated !== null) return hydrated;
      }

      const mounted = await renderer({
        pages: prepared.pages,
        insertionSlot: insertionSlot(context.insertionTarget, context.bookSnapshot),
        insertionTarget: context.insertionTarget,
        targetPage: context.targetPage,
        signal: context.signal,
      });
      throwIfAborted(context.signal);
      // The offscreen host is explicitly sized from the leaf observed above.
      // If the real layout changed while those pages were mounting, retaining
      // them under either the old or new identity would misrepresent what the
      // reader will receive. No assets have been published yet, so fail cleanly
      // and let the next render start from the settled geometry.
      await assertRenderEnvironmentCurrent(
        currentRenderEnvironmentDigest,
        context.signal,
      );
      if (mounted.length === 0) {
        throw new Error('The draft renderer produced no reviewable page.');
      }
      const duplicationDiagnostics = renderedDuplicationDiagnostics(mounted);
      const layoutDiagnostics = [
        ...mounted.flatMap((page) => page.diagnostics),
        ...duplicationDiagnostics,
      ];
      const savedResourceIds: string[] = [];
      const previewPages: DraftPreviewPage[] = [];
      let savedGenerationId: string | null = null;
      try {
        for (let index = 0; index < mounted.length; index += 1) {
          const page = mounted[index]!;
          throwIfAborted(context.signal);
          const metadata = await assets.save(page.pngBytes);
          savedResourceIds.push(metadata.id);
          throwIfAborted(context.signal);
          hydrateUrl(metadata.id, page.pngBytes, 'image/png');
          const image: AgentImageRef = {
            resourceId: metadata.id,
            mimeType: 'image/png',
            digest: metadata.sha256,
            width: page.width,
            height: page.height,
          };
          const textDigest = await hash.digestText(plainText(page.doc));
          const residualOverflow = page.diagnostics.some(
            (diagnostic) => diagnostic.code === 'layout.residual-overflow',
          );
          const layoutDigest = await hash.digestJson({
            document: stripVolatileIdentity(page.doc),
            imageDigest: image.digest,
            width: page.width,
            height: page.height,
            paginationSpill: page.producedOverflow,
            residualOverflow,
            diagnostics: page.diagnostics,
          });
          previewPages.push({
            pageId: `preview-page-${index + 1}`,
            pageNumber: index + 1,
            width: page.width,
            height: page.height,
            image,
            textDigest,
            layoutDigest,
            ...(page.sourceStart === undefined ? {} : { sourceStart: page.sourceStart }),
            ...(page.sourceEnd === undefined ? {} : { sourceEnd: page.sourceEnd }),
            paginationSpill: page.producedOverflow,
            residualOverflow,
          });
        }
        const layoutHash = await hash.digestJson({
          renderKey,
          pages: previewPages.map((page) => ({
            image: page.image.digest,
            text: page.textDigest,
            layout: page.layoutDigest,
          })),
        });
        const generationId = randomId(`generation_${layoutHash.slice(0, 20)}`);
        const pages = previewPages.map((page) => ({
          ...page,
          pageId: `${generationId}:page:${page.pageNumber}`,
        }));
        const diagnostics = [
          ...prepared.parserDiagnostics,
          ...prepared.staticDiagnostics,
          ...prepared.imageDiagnostics,
          ...prepared.pageLedgerDiagnostics,
          ...layoutDiagnostics,
        ];
        const generation: DraftPreviewGeneration = {
          generationId,
          draftHash: draft.draftHash,
          layoutHash,
          rendererVersion: DRAFT_SANDBOX_RENDERER_VERSION,
          bookSnapshotRevision: context.bookSnapshot.bookRevision,
          createdAt: now(),
          parserValid: !hasErrors(prepared.parserDiagnostics),
          layoutValid: !hasErrors(layoutDiagnostics),
          stale: false,
          pageCount: pages.length,
          pages,
          diagnostics,
        };
        const fetchedById = new Map(
          fetchedAssets.map((asset) => [asset.id, asset]),
        );
        const applicationPlan: ReviewedDraftApplicationPlan = integratedTarget(
          context.insertionTarget,
        )
          ? {
              kind: 'integrated_target',
              insertionTarget: context.insertionTarget,
              targetPageId: context.insertionTarget.pageId,
              expectedTargetRevision: context.targetPage!.revision,
              expectedTargetDocumentDigest: context.targetPage!.documentDigest,
              reviewedTargetDocumentDigest: await hash.digestJson(
                jsonStorageCanonicalPageDoc(mounted[0]!.doc),
              ),
              targetPageIndex: 0,
              insertedPageStartIndex: 1,
            }
          : {
              kind: 'structural_pages',
              insertionTarget: context.insertionTarget,
            };
        const receipt = await createReviewedDraftReceipt(
          {
            version: REVIEWED_DRAFT_RECEIPT_VERSION,
            generationId,
            draftHash: draft.draftHash,
            layoutHash,
            bookSnapshotRevision: context.bookSnapshot.bookRevision,
            rendererVersion: DRAFT_SANDBOX_RENDERER_VERSION,
            applicationPlan,
            // These are the post-pagination docs captured in the screenshots,
            // not a second parse of the model's source. Spill pages therefore
            // apply exactly as they were reviewed.
            pages: mounted.map((page, index) => ({
              source: docToScript(page.doc),
              doc: page.doc,
              // The existing integrated target retains its current flow role;
              // every continuation is a reviewed fixed-page boundary.
              protectedStart: applicationPlan.kind === 'integrated_target'
                ? index !== 0
                : true,
            })),
            fetchedAssets: [...fetchedById.values()],
          },
          hash,
        );
        throwIfAborted(context.signal);
        savedGenerationId = generationId;
        await receipts.put(receipt);
        throwIfAborted(context.signal);
        // Asset encoding and receipt persistence can outlive a window resize.
        // Check once more at the publication boundary; the catch below revokes
        // every byte and receipt if this final identity no longer matches.
        await assertRenderEnvironmentCurrent(
          currentRenderEnvironmentDigest,
          context.signal,
        );
        generations.put({
          renderKey,
          renderEnvironmentDigest: currentRenderEnvironmentDigest,
          generation,
        });
        throwIfAborted(context.signal);
        return generation;
      } catch (error) {
        if (savedGenerationId !== null) {
          generations.delete(savedGenerationId);
          await receipts.delete(savedGenerationId).catch(() => undefined);
        }
        const resourcesOwnedByEarlierGenerations = new Set(
          generations
            .list()
            .flatMap((entry) =>
              entry.generation.pages.map((page) => page.image.resourceId),
            ),
        );
        await Promise.all(
          [...new Set(savedResourceIds)].map(async (resourceId) => {
            if (resourcesOwnedByEarlierGenerations.has(resourceId)) return;
            const url = urls.get(resourceId);
            if (url !== undefined) revokePreviewUrl(url);
            urls.delete(resourceId);
            await assets.delete(resourceId).catch(() => false);
          }),
        );
        throw error;
      }
    },
    getGeneration,
    dispose,
  };

  const releaseUrls = (): void => {
    for (const url of urls.values()) revokePreviewUrl(url);
    urls.clear();
    preparedCache.clear();
  };

  return {
    adapter,
    readAsset: (resourceId) => assets.read(resourceId),
    renderUrlFor(image) {
      return urls.get(image.resourceId) ?? '';
    },
    releaseUrls,
    async disposeAll() {
      const ids = generations.list().map((entry) => entry.generation.generationId);
      for (const id of ids) await dispose(id);
      releaseUrls();
    },
  };
}
