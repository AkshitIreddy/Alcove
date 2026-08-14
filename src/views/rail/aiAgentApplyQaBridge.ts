/**
 * Browser-only, provider-free QA bridge for the production Agent apply seam.
 *
 * This is deliberately narrower than the README demo bridge: it creates one
 * real native draft receipt for the currently open book, presents that receipt
 * through the real Agent panel, then lets the panel's Insert button call
 * BookView's production `applyApprovedAiProposal` transaction. It is installed
 * only for the exact `?fx=force&qa=agent-apply` probe route and never in Tauri.
 */
import { createSignal } from 'solid-js';
import { webCryptoAgentHash } from '../../features/aiAgent/adapters';
import { createProductionDraftSandbox } from '../../features/aiAgent/draftSandbox';
import type {
  NotebookDraft,
  NotebookInsertionTarget,
  NotebookPatchProposal,
  UserPreviewContract,
} from '../../features/aiAgent/types';
import type {
  AiAgentController,
  AiAgentDraftPreviewView,
  AiAgentViewState,
} from './AiAgentPanel';
import { previewLayoutView } from './aiAgentPreviewGate';
import { createProductionNotebookReadAdapter } from '../../features/aiAgent/productionNotebook';

const DEFAULT_SCRIPT = [
  '# Profit in One Minute',
  '',
  'Profit is the money left after a business subtracts every cost from the money it earned.',
  '',
  '::: callout {variant=tip title="The pocket rule"}',
  '**Profit = revenue − costs.** If the result is positive, the business earned more than it spent.',
  ':::',
].join('\n');

export type AiAgentApplyQaStatus =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'applying'
  | 'applied'
  | 'failed';

export interface AiAgentApplyQaState {
  readonly status: AiAgentApplyQaStatus;
  readonly patchId?: string;
  readonly previewId?: string;
  readonly idempotencyKey?: string;
  readonly expectedPageCount?: number;
  readonly applyStartedAt?: number;
  readonly applyFinishedAt?: number;
  readonly applyDurationMs?: number;
  readonly approvalCalls: number;
  readonly error?: string;
}

export interface AiAgentApplyQaPublicBridge {
  state(): AiAgentApplyQaState;
  prepare(source?: string): Promise<void>;
  open(): void;
  cleanup(): Promise<boolean>;
}

export interface AiAgentApplyQaBridgeOptions {
  readonly bookId: () => string | undefined;
  readonly bookTitle: () => string | undefined;
  readonly insertionTarget: () => NotebookInsertionTarget | undefined;
  readonly applyApprovedProposal: (proposal: NotebookPatchProposal) => Promise<void>;
  readonly restoreAppliedProposal: () => Promise<boolean>;
  readonly openPanel: () => void;
}

export interface AiAgentApplyQaBridgeHandle extends AiAgentApplyQaPublicBridge {
  readonly controller: AiAgentController;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    __aiAgentApplyQa?: AiAgentApplyQaPublicBridge;
  }
}

function qaRouteEnabled(): boolean {
  if (typeof window === 'undefined' || '__TAURI_INTERNALS__' in window) return false;
  const query = new URLSearchParams(window.location.search);
  return query.get('fx') === 'force' && query.get('qa') === 'agent-apply';
}

function assertQaRoute(): void {
  if (!qaRouteEnabled()) {
    throw new Error('The Agent apply QA bridge requires ?fx=force&qa=agent-apply in a browser.');
  }
}

function readyPreview(
  preview: UserPreviewContract,
  renderUrlFor: (image: UserPreviewContract['pages'][number]['image']) => string,
): AiAgentDraftPreviewView {
  return {
    id: preview.previewId,
    version: 1,
    title: 'Production Insert transaction probe',
    summary: 'One exact native page prepared without a provider, ready for the real BookView apply transaction.',
    pages: preview.pages.map((page) => ({
      id: page.pageId,
      pageNumber: page.pageNumber,
      renderUrl: renderUrlFor(page.image),
      width: page.width,
      height: page.height,
      alt: `Exact Agent apply QA page ${page.pageNumber}`,
    })),
    affectedPageCount: preview.expectedPageCount,
    parser: { status: 'passed', label: 'Parser passed' },
    layout: previewLayoutView(preview.pages),
    review: {
      status: 'passed',
      round: 1,
      summary: 'Every native page in this provider-free transaction fixture was rendered and accepted for the apply gate.',
      findings: ['No unresolved clipping, overflow, duplication or empty-page findings.'],
      checkedAt: preview.visualReview.updatedAt,
    },
    citations: [],
    imageGenerationPrompts: [],
    placements: [{
      id: 'locked-qa-target',
      label: 'After the current page',
      detail: 'Locked by the production apply probe.',
    }],
    placementId: 'locked-qa-target',
    assumptions: ['Provider-free QA fixture; the receipt and insertion transaction are production code.'],
    isolated: true,
  };
}

export function createAiAgentApplyQaBridge(
  options: AiAgentApplyQaBridgeOptions,
): AiAgentApplyQaBridgeHandle {
  assertQaRoute();
  const notebook = createProductionNotebookReadAdapter();
  const sandbox = createProductionDraftSandbox();
  let disposed = false;
  let proposal: NotebookPatchProposal | undefined;
  let previewView: AiAgentDraftPreviewView | undefined;
  let applyState: AiAgentApplyQaState = { status: 'idle', approvalCalls: 0 };
  const [view, setView] = createSignal<AiAgentViewState>({
    connection: {
      status: 'connected',
      provider: 'Cohere',
      keyKind: 'production',
      firstUse: false,
      label: 'Provider-free production apply QA',
    },
    stage: 'idle',
    timeline: [],
    attachments: [],
    context: [{ id: 'current-page', label: 'Current page', selected: true, locked: true }],
    canSend: false,
  });

  const publishReady = (): void => {
    setView({
      connection: view().connection,
      stage: 'ready',
      headline: 'The reviewed draft is ready',
      timeline: [{
        id: 'qa-review-passed',
        kind: 'visual-review',
        status: 'passed',
        round: 1,
        pageCount: proposal?.preview.expectedPageCount,
        detail: 'The native-page review passed. This click uses the production application transaction.',
      }],
      attachments: [],
      context: view().context,
      preview: previewView,
      canSend: false,
    });
  };

  const prepare = async (source = DEFAULT_SCRIPT): Promise<void> => {
    assertQaRoute();
    if (disposed) throw new Error('The Agent apply QA bridge has been disposed.');
    if (applyState.status === 'applying') throw new Error('The prior apply is still settling.');
    applyState = { status: 'preparing', approvalCalls: applyState.approvalCalls };
    setView({
      ...view(),
      stage: 'working',
      headline: 'Preparing one exact production receipt',
      workingNote: 'Pressing the QA draft onto native paper…',
      progress: 0.6,
      preview: undefined,
    });
    const bookId = options.bookId();
    const insertionTarget = options.insertionTarget();
    if (bookId === undefined || insertionTarget === undefined) {
      throw new Error('Open a notebook page before preparing the Agent apply QA fixture.');
    }
    const inspected = await notebook.inspectNotebook(bookId, new AbortController().signal);
    const now = new Date().toISOString();
    const runId = `qa-agent-apply-${crypto.randomUUID()}`;
    const draft: NotebookDraft = {
      runId,
      version: 1,
      script: source,
      draftHash: await webCryptoAgentHash.digestText(source),
      createdAt: now,
    };
    const context = {
      bookSnapshot: inspected.snapshot,
      insertionTarget,
      signal: new AbortController().signal,
    };
    const validation = await sandbox.adapter.validate(draft, context);
    if (!validation.valid) throw new Error('The Agent apply QA fixture failed deterministic validation.');
    const generation = await sandbox.adapter.render(draft, context);
    const inspectedPageIds = generation.pages.map((page) => page.pageId);
    const visualReview = {
      generationId: generation.generationId,
      draftHash: generation.draftHash,
      requiredPageIds: inspectedPageIds,
      imageExposures: generation.pages.map((page) => ({
        generationId: generation.generationId,
        pageId: page.pageId,
        imageResourceId: page.image.resourceId,
        imageDigest: page.image.digest,
        layoutDigest: page.layoutDigest,
        readRequestedAtProviderCall: 0,
        exposedAt: now,
      })),
      inspectedPageIds,
      findings: [],
      complete: true,
      passed: true,
      updatedAt: now,
    } as const;
    const idempotencyKey = await webCryptoAgentHash.digestJson({
      qa: 'agent-apply',
      runId,
      draftHash: draft.draftHash,
      bookRevision: inspected.snapshot.bookRevision,
      pageIds: inspected.snapshot.pageIds,
      insertionTarget,
    });
    const previewId = `preview_${idempotencyKey.slice(0, 24)}`;
    const patchId = `patch_${idempotencyKey.slice(0, 24)}`;
    const preview: UserPreviewContract = {
      previewId,
      generationId: generation.generationId,
      draftHash: draft.draftHash,
      layoutHash: generation.layoutHash,
      bookId,
      expectedBookRevision: inspected.snapshot.bookRevision,
      expectedPageIds: [...inspected.snapshot.pageIds],
      insertionTarget,
      expectedPageCount: generation.pageCount,
      pages: generation.pages,
      assumptions: [],
      citations: [],
      imageGenerationPrompts: [],
      sourceCoverage: {
        manifestDigest: '',
        mode: 'relevant',
        requiredUnitIds: [],
        readUnitIds: [],
        citedUnitIds: [],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: now,
      },
      visualReview,
      validation,
    };
    proposal = {
      patchId,
      idempotencyKey,
      runId,
      draftVersion: 1,
      draftHash: draft.draftHash,
      script: source,
      expectedBookRevision: inspected.snapshot.bookRevision,
      expectedPageIds: [...inspected.snapshot.pageIds],
      insertionTarget,
      preview,
      status: 'approved_pending_apply',
      createdAt: now,
    };
    previewView = readyPreview(preview, sandbox.renderUrlFor);
    applyState = {
      status: 'ready',
      patchId,
      previewId,
      idempotencyKey,
      expectedPageCount: generation.pageCount,
      approvalCalls: applyState.approvalCalls,
    };
    publishReady();
  };

  const approve = (previewId: string): void => {
    if (
      proposal === undefined ||
      previewView === undefined ||
      proposal.preview.previewId !== previewId ||
      applyState.status !== 'ready'
    ) return;
    const started = performance.now();
    applyState = {
      ...applyState,
      status: 'applying',
      applyStartedAt: started,
      approvalCalls: applyState.approvalCalls + 1,
      error: undefined,
    };
    setView({
      ...view(),
      stage: 'applying',
      headline: 'Placing the reviewed pages safely',
      progress: 1,
    });
    void options.applyApprovedProposal(proposal).then(() => {
      const finished = performance.now();
      applyState = {
        ...applyState,
        status: 'applied',
        applyFinishedAt: finished,
        applyDurationMs: finished - started,
      };
      setView({
        ...view(),
        stage: 'complete',
        headline: 'The page is in your notebook',
        progress: undefined,
        preview: undefined,
        timeline: [{
          id: 'qa-applied',
          kind: 'message',
          role: 'agent',
          text: 'The reviewed QA page is now in this notebook.',
        }],
      });
    }).catch((error) => {
      const finished = performance.now();
      const message = error instanceof Error ? error.message : String(error);
      applyState = {
        ...applyState,
        status: 'failed',
        applyFinishedAt: finished,
        applyDurationMs: finished - started,
        error: message,
      };
      setView({
        ...view(),
        stage: 'conflict',
        headline: 'The book changed',
        progress: undefined,
        preview: { ...previewView!, conflict: { title: 'The apply transaction failed', detail: message } },
        error: { title: 'The book changed', detail: message, retryable: true },
      });
    });
  };

  const controller: AiAgentController = {
    state: view,
    approveInsert: approve,
    requestChanges: () => undefined,
    setPlacement: () => undefined,
    copyText: (text) => navigator.clipboard.writeText(text),
  };

  return {
    controller,
    state: () => ({ ...applyState }),
    prepare,
    open: options.openPanel,
    async cleanup() {
      if (applyState.status !== 'applied') return true;
      const restored = await options.restoreAppliedProposal();
      if (restored) {
        proposal = undefined;
        previewView = undefined;
        applyState = { status: 'idle', approvalCalls: applyState.approvalCalls };
        setView({
          ...view(),
          stage: 'idle',
          headline: undefined,
          preview: undefined,
          timeline: [],
        });
      }
      return restored;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await sandbox.disposeAll();
    },
  };
}
