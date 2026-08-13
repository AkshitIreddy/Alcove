import type {
  AgentSourceDescriptor,
  DraftPreviewGeneration,
  NotebookDraft,
  NotebookInsertionTarget,
  NotebookPageInspection,
  NotebookScriptValidation,
  NotebookSelectionInspection,
  NotebookSnapshotRef,
  RetrievalHit,
  SourceAttachmentRef,
  SourceManifest,
  SourceRead,
} from './types';
export type { SourceAttachmentRef } from './types';
import type { PageDoc } from '../../data/types';

export interface AgentClock {
  now(): string;
}

export interface AgentIdFactory {
  create(prefix: string): string;
}

export interface AgentHashAdapter {
  digestText(text: string): Promise<string>;
  digestJson(value: unknown): Promise<string>;
}

export interface NotebookManifestPage {
  readonly pageId: string;
  readonly ordinal: number;
  readonly revision: string;
  readonly title?: string;
  readonly estimatedTokens: number;
}

export interface NotebookInspection {
  readonly snapshot: NotebookSnapshotRef;
  readonly title: string;
  readonly pages: readonly NotebookManifestPage[];
}

/** Read-only bridge implemented by BookView/data modules later. */
export interface NotebookReadAdapter {
  inspectNotebook(bookId: string, signal: AbortSignal): Promise<NotebookInspection>;
  inspectPage(pageId: string, signal: AbortSignal): Promise<NotebookPageInspection>;
  inspectPageRange(
    bookId: string,
    startOrdinal: number,
    endOrdinal: number,
    signal: AbortSignal,
  ): Promise<readonly NotebookPageInspection[]>;
  inspectSelection(
    bookId: string,
    signal: AbortSignal,
  ): Promise<NotebookSelectionInspection | null>;
}

export interface SourceIngestionProgress {
  readonly sourceId?: string;
  readonly phase: 'hashing' | 'extracting' | 'quarantining' | 'indexing';
  readonly completed: number;
  readonly total: number;
  readonly summary: string;
}

/**
 * Ingestion owns file caps, extraction, page anchoring and prompt-injection
 * quarantine. The runtime passes managed references, never File/Blob bytes.
 */
export interface SourceIngestionAdapter {
  /** Returns the complete current task manifest, including earlier attachments. */
  ingest(
    attachments: readonly SourceAttachmentRef[],
    context: {
      readonly taskId: string;
      readonly signal: AbortSignal;
      readonly onProgress?: (progress: SourceIngestionProgress) => void;
    },
  ): Promise<SourceManifest>;
}

/** Unforgeable-by-model scope supplied from the current persisted agent state. */
export interface SourceManifestCapability {
  readonly taskId: string;
  readonly manifestDigest: string;
}

export interface SourceRepositoryAdapter {
  getManifest(taskId: string, signal: AbortSignal): Promise<SourceManifest>;
  getSource(
    sourceId: string,
    signal: AbortSignal,
    capability: SourceManifestCapability,
  ): Promise<AgentSourceDescriptor | null>;
  readUnitRange(
    sourceId: string,
    startOrdinal: number,
    endOrdinal: number,
    maxCharacters: number,
    signal: AbortSignal,
    capability: SourceManifestCapability,
  ): Promise<SourceRead>;
  readFullSource(
    sourceId: string,
    maxCharacters: number,
    signal: AbortSignal,
    capability: SourceManifestCapability,
  ): Promise<SourceRead>;
  forgetTaskSources?(taskId: string): Promise<void>;
}

export interface SourceIndexStatus {
  readonly sourceId: string;
  readonly sourceDigest: string;
  readonly indexedUnits: number;
  readonly reusedUnits: number;
  readonly indexVersion: string;
}

export type ProviderTextMode = 'allow' | 'local_only';

/** Local lexical/semantic retrieval with an optional paid reranking hop. */
export interface SourceRetrievalAdapter {
  ensureIndexed(
    sources: readonly AgentSourceDescriptor[],
    signal: AbortSignal,
    options?: { readonly providerTextMode?: ProviderTextMode },
  ): Promise<readonly SourceIndexStatus[]>;
  search(
    query: string,
    options: {
      readonly sourceIds: readonly string[];
      readonly limit: number;
      readonly signal: AbortSignal;
      readonly capability: SourceManifestCapability;
      readonly providerTextMode?: ProviderTextMode;
    },
  ): Promise<readonly RetrievalHit[]>;
  rerank(
    query: string,
    candidates: readonly RetrievalHit[],
    options: {
      readonly limit: number;
      readonly quality: 'fast' | 'pro';
      readonly signal: AbortSignal;
      readonly providerTextMode?: ProviderTextMode;
    },
  ): Promise<readonly RetrievalHit[]>;
}

/**
 * Disposable, non-mutating render environment. Implementations must run the
 * real tolerant parser, page-boundary logic, TipTap mapping, pagination and
 * layout renderer—not an estimate—and return opaque rendered image refs.
 */
export interface DraftSandboxAdapter {
  validate(
    draft: NotebookDraft,
    context: {
      readonly bookSnapshot: NotebookSnapshotRef;
      readonly insertionTarget: NotebookInsertionTarget;
      readonly targetPage?: DraftSandboxTargetPage;
      readonly signal: AbortSignal;
    },
  ): Promise<NotebookScriptValidation>;
  render(
    draft: NotebookDraft,
    context: {
      readonly bookSnapshot: NotebookSnapshotRef;
      readonly insertionTarget: NotebookInsertionTarget;
      readonly targetPage?: DraftSandboxTargetPage;
      readonly signal: AbortSignal;
    },
  ): Promise<DraftPreviewGeneration>;
  /** Rehydrate or verify a persisted generation before its images are used. */
  getGeneration(
    generationId: string,
    signal: AbortSignal,
  ): Promise<DraftPreviewGeneration | null>;
  dispose(generationId: string): Promise<void>;
}

/** Exact, non-provider target captured in the same read as its revision. */
export interface DraftSandboxTargetPage {
  readonly pageId: string;
  readonly revision: string;
  readonly documentDigest: string;
  readonly doc: PageDoc;
}

/**
 * Optional durable proposal outbox. It stores a proposal by idempotency key;
 * it is explicitly not allowed to edit a page or invoke an editor command.
 */
export interface PatchProposalOutbox<TProposal> {
  put(proposal: TProposal): Promise<'created' | 'already_exists'>;
  deleteForTask?(taskId: string): Promise<void>;
}

export interface AgentAdapters {
  readonly notebook: NotebookReadAdapter;
  readonly ingestion: SourceIngestionAdapter;
  readonly sources: SourceRepositoryAdapter;
  readonly retrieval: SourceRetrievalAdapter;
  readonly sandbox: DraftSandboxAdapter;
  readonly clock: AgentClock;
  readonly ids: AgentIdFactory;
  readonly hash: AgentHashAdapter;
}

export const systemAgentClock: AgentClock = {
  now: () => new Date().toISOString(),
};

export const randomAgentIds: AgentIdFactory = {
  create(prefix: string): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid !== undefined) return `${prefix}_${uuid}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  },
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}

export const webCryptoAgentHash: AgentHashAdapter = {
  digestText: sha256,
  digestJson: (value) => sha256(stableJson(value)),
};
