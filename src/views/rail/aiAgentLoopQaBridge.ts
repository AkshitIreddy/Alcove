/**
 * Browser-only, provider-free QA bridge for the real Agent runtime and panel.
 *
 * Unlike the documentation demo, this runs AgentRuntime + LangGraph + the
 * production notebook reader/native draft sandbox. A deterministic provider
 * chooses only from the strict tools actually advertised on each turn. The
 * bridge is absent from Tauri and requires the exact
 * `?fx=force&qa=agent-loop` route, so it can neither spend Cohere quota nor
 * mutate a reader's notebook.
 */
import type {
  AgentAdapters,
  SourceManifestCapability,
} from '../../features/aiAgent/adapters';
import {
  randomAgentIds,
  systemAgentClock,
  webCryptoAgentHash,
} from '../../features/aiAgent/adapters';
import { createAiAgentController } from '../../features/aiAgent/controller';
import { createProductionDraftSandbox } from '../../features/aiAgent/draftSandbox';
import { InMemoryAgentPersistence } from '../../features/aiAgent/persistence';
import type {
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderStreamEvent,
  AgentProviderTurnRequest,
} from '../../features/aiAgent/provider';
import { AgentProviderError } from '../../features/aiAgent/provider';
import { AgentRuntime } from '../../features/aiAgent/runtime';
import type {
  AgentJsonValue,
  AgentSourceDescriptor,
  AgentState,
  NotebookInsertionTarget,
  SourceAttachmentRef,
  SourceManifest,
  SourceRead,
} from '../../features/aiAgent/types';
import { createProductionNotebookReadAdapter } from '../../features/aiAgent/productionNotebook';
import type {
  AiAgentAttachmentView,
  AiAgentConnectionView,
  AiAgentController,
} from './AiAgentPanel';
import {
  createAiAgentPanelController,
  type AiAgentPlacementOption,
} from './aiAgentControllerAdapter';

export type AiAgentLoopQaScenario =
  | 'healthy-targetless'
  | 'healthy-production-default'
  | 'provider-invalid-retry'
  | 'invalid-repeat'
  | 'preserve-all';

const EMPTY_MANIFEST: SourceManifest = {
  version: 1,
  createdAt: '2026-08-14T12:00:00.000Z',
  sources: [],
  totalEstimatedTokens: 0,
  digest: 'qa-empty-source-manifest-v1',
};

const QA_SOURCE: AgentSourceDescriptor = {
  id: 'qa-source',
  title: 'Two facts about rainfall.txt',
  kind: 'text',
  digest: 'qa-source-digest-v1',
  mediaType: 'text/plain',
  estimatedTokens: 28,
  byteSize: 126,
  extractionQuality: 'good',
  quarantined: true,
  promptInjectionWarnings: [],
  units: [
    {
      id: 'qa-source-u1',
      label: 'Fact 1',
      ordinal: 0,
      digest: 'qa-source-u1-digest',
      estimatedTokens: 14,
      characters: 63,
      hasText: true,
      hasVisual: false,
      visualEvidence: 'none',
      anchor: { sourceId: 'qa-source', unitId: 'qa-source-u1', start: 0, end: 63 },
    },
    {
      id: 'qa-source-u2',
      label: 'Fact 2',
      ordinal: 1,
      digest: 'qa-source-u2-digest',
      estimatedTokens: 14,
      characters: 63,
      hasText: true,
      hasVisual: false,
      visualEvidence: 'none',
      anchor: { sourceId: 'qa-source', unitId: 'qa-source-u2', start: 63, end: 126 },
    },
  ],
};

const QA_MANIFEST: SourceManifest = {
  version: 1,
  createdAt: EMPTY_MANIFEST.createdAt,
  sources: [QA_SOURCE],
  totalEstimatedTokens: QA_SOURCE.estimatedTokens,
  digest: 'qa-rainfall-source-manifest-v1',
};

const SOURCE_READ: SourceRead = {
  sourceId: QA_SOURCE.id,
  sourceDigest: QA_SOURCE.digest,
  units: [
    {
      unitId: 'qa-source-u1',
      anchor: QA_SOURCE.units[0]!.anchor,
      text: 'Warm air can hold more water vapour than cold air.',
      digest: QA_SOURCE.units[0]!.digest,
    },
    {
      unitId: 'qa-source-u2',
      anchor: QA_SOURCE.units[1]!.anchor,
      text: 'Cooling vapour condenses into droplets that can fall as rain.',
      digest: QA_SOURCE.units[1]!.digest,
    },
  ],
  truncated: false,
};

const HEALTHY_SCRIPT = [
  '# The Water Cycle at a Glance',
  '',
  'Water travels between sky, land and living things in a repeating cycle.',
  '',
  '::: callout {variant=tip title="Remember the loop"}',
  '**Evaporation lifts it, condensation gathers it, and precipitation brings it home.**',
  ':::',
].join('\n');

const PRESERVE_SCRIPT = [
  '# Why Rain Forms',
  '',
  'Warm air can carry more water vapour. As that air cools, vapour condenses into droplets.',
  '',
  '::: callout {variant=info title="The complete chain"}',
  'Cooling gathers droplets; when they become heavy enough, they fall as rain.',
  ':::',
].join('\n');

const STALLED_SCRIPT = '# Cats\n\nCats use their whiskers to sense nearby surfaces.';

function routeScenario(): AiAgentLoopQaScenario {
  const value = new URLSearchParams(window.location.search).get('scenario');
  return value === 'healthy-production-default' ||
    value === 'provider-invalid-retry' ||
    value === 'invalid-repeat' ||
    value === 'preserve-all'
    ? value
    : 'healthy-targetless';
}

function assertQaRoute(): void {
  if (
    !import.meta.env.DEV ||
    typeof window === 'undefined' ||
    '__TAURI_INTERNALS__' in window
  ) {
    throw new Error('The Agent loop QA bridge is browser-only.');
  }
  const query = new URLSearchParams(window.location.search);
  if (query.get('fx') !== 'force' || query.get('qa') !== 'agent-loop') {
    throw new Error('The Agent loop QA bridge requires ?fx=force&qa=agent-loop.');
  }
}

interface QaPreviewReceipt {
  readonly generationId: string;
  readonly pageIds: readonly string[];
}

function previewReceiptFromRequest(
  request: AgentProviderTurnRequest,
): QaPreviewReceipt | null {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (
      message?.role !== 'tool' ||
      (message.toolName !== 'render_draft_preview' &&
        message.toolName !== 'read_draft_preview_pages') ||
      message.isError === true
    ) continue;
    const text = message.content.find((part) => part.type === 'text')?.text;
    if (text === undefined) continue;
    try {
      const value = JSON.parse(text) as {
        readonly generationId?: unknown;
        readonly pages?: readonly { readonly pageId?: unknown }[];
      };
      const pageIds = value.pages?.flatMap((page) =>
        typeof page.pageId === 'string' ? [page.pageId] : [],
      ) ?? [];
      if (typeof value.generationId === 'string' && pageIds.length > 0) {
        return { generationId: value.generationId, pageIds };
      }
    } catch {
      // Continue to an earlier exact render/read receipt. The QA provider must
      // never guess an id from a controller snapshot that can lag the graph.
    }
  }
  return null;
}

function argsForTool(
  name: string,
  scenario: AiAgentLoopQaScenario,
  request: AgentProviderTurnRequest,
  submitCount: number,
): AgentJsonValue {
  switch (name) {
    case 'list_source_manifest':
    case 'inspect_notebook':
    case 'validate_notebook_script':
    case 'render_draft_preview':
    case 'propose_notebook_patch':
    case 'submit_notebook_patch':
      return {};
    case 'read_full_source':
      return { sourceId: QA_SOURCE.id };
    case 'propose_insertion':
      return { target: { kind: 'book_end' } };
    case 'submit_notebook_script':
      return {
        script: scenario === 'invalid-repeat'
          ? STALLED_SCRIPT
          : scenario === 'preserve-all'
            ? PRESERVE_SCRIPT
            : HEALTHY_SCRIPT,
        citedUnitIds: scenario === 'preserve-all'
          ? ['qa-source-u1', 'qa-source-u2']
          : [],
        reason: submitCount === 0 ? 'initial' : submitCount % 2 === 0 ? 'initial' : 'repair',
      };
    case 'read_draft_preview_pages': {
      const receipt = previewReceiptFromRequest(request);
      if (receipt === null) throw new Error('QA provider cannot find the current render receipt.');
      return {
        generationId: receipt.generationId,
        pageIds: receipt.pageIds,
      };
    }
    case 'record_visual_review': {
      const receipt = previewReceiptFromRequest(request);
      if (receipt === null) throw new Error('QA provider cannot find the current review receipt.');
      return {
        generationId: receipt.generationId,
        reviews: receipt.pageIds.map((pageId) => ({ pageId, findings: [] })),
      };
    }
    default:
      throw new Error(`QA provider has no deterministic arguments for ${name}.`);
  }
}

const TOOL_PRIORITY = [
  'list_source_manifest',
  'read_full_source',
  'inspect_notebook',
  'propose_insertion',
  'submit_notebook_script',
  'validate_notebook_script',
  'render_draft_preview',
  'read_draft_preview_pages',
  'record_visual_review',
  'propose_notebook_patch',
  'submit_notebook_patch',
] as const;

class DeterministicLoopQaProvider implements AgentProvider {
  readonly id = 'alcove-agent-loop-qa';
  readonly requests: AgentProviderTurnRequest[] = [];
  readonly attemptedTools: string[] = [];
  readonly selectedTools: string[] = [];
  readonly invalidResponseTools: string[] = [];
  private sabotageAttempted = false;

  constructor(
    readonly scenario: AiAgentLoopQaScenario,
    readonly sabotageEarlyDraft: boolean,
  ) {}

  capabilities(): Promise<AgentProviderCapabilities> {
    return Promise.resolve({
      providerId: this.id,
      modelId: 'provider-free-scripted-qa',
      toolUse: true,
      streaming: true,
      imageInput: true,
      maxInputTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsParallelToolCalls: false,
    });
  }

  async *streamTurn(
    request: AgentProviderTurnRequest,
  ): AsyncIterable<AgentProviderStreamEvent> {
    this.requests.push(request);
    const names = new Set(request.tools.map((tool) => tool.name));
    const selected = this.sabotageEarlyDraft && !this.sabotageAttempted
      ? 'submit_notebook_script'
      : TOOL_PRIORITY.find((name) => names.has(name));
    if (selected === undefined) {
      throw new Error(`QA provider received no supported next tool: ${[...names].join(', ')}`);
    }
    this.attemptedTools.push(selected);
    if (this.sabotageEarlyDraft && !this.sabotageAttempted) {
      this.sabotageAttempted = true;
    }
    if (
      this.scenario === 'provider-invalid-retry' &&
      (selected === 'validate_notebook_script' || selected === 'read_draft_preview_pages') &&
      !this.invalidResponseTools.includes(selected)
    ) {
      this.invalidResponseTools.push(selected);
      throw new AgentProviderError({
        code: 'invalid_response',
        message: `QA injected an unusable provider response at ${selected}.`,
      });
    }
    const submitCount = this.selectedTools.filter(
      (name) => name === 'submit_notebook_script',
    ).length;
    this.selectedTools.push(selected);
    await new Promise((resolve) => setTimeout(resolve, 90));
    yield {
      type: 'tool_call',
      id: `qa-loop-call-${this.requests.length}`,
      name: selected,
      arguments: argsForTool(selected, this.scenario, request, submitCount),
    };
    yield { type: 'usage', inputTokens: 120, outputTokens: 24 };
    yield { type: 'finish', reason: 'tool_calls' };
  }
}

export interface AiAgentLoopQaState {
  readonly scenario: AiAgentLoopQaScenario;
  readonly providerId: 'alcove-agent-loop-qa';
  readonly sabotageEarlyDraft: boolean;
  readonly lifecycle: AgentState['lifecycle'] | null;
  readonly phase: AgentState['phase'] | null;
  readonly interruptKind: 'requirements' | 'blocker' | 'final_preview' | null;
  readonly providerCalls: number;
  readonly providerRetries: number;
  readonly providerRequestCount: number;
  readonly toolCalls: number;
  readonly repairPasses: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly attemptedTools: readonly string[];
  readonly selectedTools: readonly string[];
  readonly invalidResponseTools: readonly string[];
  readonly advertisedTools: readonly (readonly string[])[];
  readonly executedTools: readonly {
    readonly name: string;
    readonly isError: boolean;
  }[];
  readonly retrievalCalls: number;
  readonly sourceCoverageComplete: boolean | null;
  readonly draftSourceReadUnitIds: readonly string[];
  readonly previewPageCount: number;
  readonly draftVersion: number | null;
  readonly draftHash: string | null;
  readonly errorCode: string | null;
  readonly bridgeError: string | null;
}

export interface AiAgentLoopQaPublicBridge {
  state(): AiAgentLoopQaState;
  open(): void;
}

export interface AiAgentLoopQaBridgeHandle extends AiAgentLoopQaPublicBridge {
  readonly controller: AiAgentController;
  dispose(): Promise<void>;
}

export interface AiAgentLoopQaBridgeOptions {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly defaultInsertionTarget: () => NotebookInsertionTarget | undefined;
  readonly openPanel: () => void;
}

declare global {
  interface Window {
    __aiAgentLoopQa?: AiAgentLoopQaPublicBridge;
  }
}

export function createAiAgentLoopQaBridge(
  options: AiAgentLoopQaBridgeOptions,
): AiAgentLoopQaBridgeHandle {
  assertQaRoute();
  const scenario = routeScenario();
  const query = new URLSearchParams(window.location.search);
  const sabotageEarlyDraft =
    scenario === 'preserve-all' && query.get('sabotage') === 'early-draft';
  const provider = new DeterministicLoopQaProvider(scenario, sabotageEarlyDraft);
  const notebook = createProductionNotebookReadAdapter();
  const sandbox = createProductionDraftSandbox();
  const manifest = scenario === 'preserve-all' ? QA_MANIFEST : EMPTY_MANIFEST;
  let retrievalCalls = 0;
  const assertCapability = (capability: SourceManifestCapability): void => {
    if (capability.manifestDigest !== manifest.digest) {
      throw new Error('QA source capability is stale.');
    }
  };
  const adapters: AgentAdapters = {
    notebook,
    ingestion: {
      ingest: async () => manifest,
    },
    sources: {
      getManifest: async () => manifest,
      getSource: async (sourceId, _signal, capability) => {
        assertCapability(capability);
        return sourceId === QA_SOURCE.id ? QA_SOURCE : null;
      },
      readUnitRange: async (sourceId, start, end, _max, _signal, capability) => {
        assertCapability(capability);
        if (sourceId !== QA_SOURCE.id) throw new Error('Unknown QA source.');
        return {
          ...SOURCE_READ,
          units: SOURCE_READ.units.slice(start, end + 1),
        };
      },
      readFullSource: async (sourceId, _max, _signal, capability) => {
        assertCapability(capability);
        if (sourceId !== QA_SOURCE.id) throw new Error('Unknown QA source.');
        return SOURCE_READ;
      },
    },
    retrieval: {
      ensureIndexed: async () => {
        retrievalCalls += 1;
        return [];
      },
      search: async () => {
        retrievalCalls += 1;
        return [];
      },
      rerank: async (_query, candidates) => {
        retrievalCalls += 1;
        return candidates;
      },
    },
    sandbox: {
      ...sandbox.adapter,
      validate: async (draft, context) => scenario === 'invalid-repeat'
        ? {
            draftHash: draft.draftHash,
            parserDiagnostics: [],
            staticDiagnostics: [{
              severity: 'error',
              code: 'qa.invalid-draft-for-watchdog',
              message: 'Add one meaning-bearing native structure.',
            }],
            imageDiagnostics: [],
            pageLedgerDiagnostics: [],
            valid: false,
            checkedAt: systemAgentClock.now(),
          }
        : sandbox.adapter.validate(draft, context),
    },
    clock: systemAgentClock,
    ids: randomAgentIds,
    hash: webCryptoAgentHash,
  };
  const runtime = new AgentRuntime(
    provider,
    adapters,
    new InMemoryAgentPersistence(),
  );
  const core = createAiAgentController(runtime);
  let bridgeError: string | null = null;
  const placements = (): readonly AiAgentPlacementOption[] => {
    const productionDefault = options.defaultInsertionTarget();
    if (
      (scenario === 'healthy-production-default' || scenario === 'provider-invalid-retry') &&
      productionDefault !== undefined
    ) {
      return [{
        id: 'qa-production-default',
        label: 'After the current page',
        detail: 'The same focused-page default supplied by the production panel.',
        target: productionDefault,
      }];
    }
    return [{
      id: 'qa-book-end',
      label: 'At the end',
      detail: 'Provider-free QA target; no pages will be applied.',
      target: { kind: 'book_end' },
    }];
  };
  const sourceAttachments: readonly SourceAttachmentRef[] = scenario === 'preserve-all'
    ? [{
        kind: 'managed_asset',
        assetId: 'qa-source-attachment',
        title: QA_SOURCE.title,
        mediaType: QA_SOURCE.mediaType,
        digest: QA_SOURCE.digest,
      }]
    : [];
  const attachmentViews: readonly AiAgentAttachmentView[] = scenario === 'preserve-all'
    ? [{
        id: 'qa-source-attachment',
        name: QA_SOURCE.title,
        kind: 'document',
        sizeLabel: '126 B',
        status: 'ready',
      }]
    : [];
  const connection = (): AiAgentConnectionView => ({
    status: 'connected',
    provider: 'Cohere',
    keyKind: 'production',
    firstUse: false,
    label: 'Provider-free Agent runtime QA',
  });
  const panel = createAiAgentPanelController(core, {
    bookId: options.bookId,
    bookTitle: options.bookTitle,
    connection,
    attachments: () => attachmentViews,
    sourceAttachments: () => sourceAttachments,
    placements,
    preserveAllSourceInformation: () => scenario === 'preserve-all',
    insertionTarget: () =>
      scenario === 'healthy-production-default' || scenario === 'provider-invalid-retry'
      ? options.defaultInsertionTarget()
      : undefined,
    renderUrlFor: sandbox.renderUrlFor,
    onApprovedProposal: async () => {
      throw new Error('The Agent loop QA bridge never applies notebook pages.');
    },
    onError: (error) => {
      bridgeError = error instanceof Error ? error.message : String(error);
    },
  });

  return {
    controller: panel,
    open: options.openPanel,
    state: () => {
      const snapshot = core.getSnapshot();
      const state = snapshot.state;
      const historyTools = (state?.modelHistory ?? []).flatMap((turn) =>
        turn.role === 'tool'
          ? [{ name: turn.toolName, isError: turn.isError }]
          : [],
      );
      const finalSubmissionInterrupted =
        snapshot.interrupt?.kind === 'final_preview' &&
        provider.selectedTools[provider.selectedTools.length - 1] ===
          'submit_notebook_patch' &&
        historyTools[historyTools.length - 1]?.name !== 'submit_notebook_patch';
      return {
        scenario,
        providerId: provider.id,
        sabotageEarlyDraft,
        lifecycle: state?.lifecycle ?? null,
        phase: state?.phase ?? null,
        interruptKind: snapshot.interrupt?.kind ?? null,
        providerCalls: state?.usage.providerCalls ?? 0,
        providerRetries: state?.usage.providerRetries ?? 0,
        providerRequestCount: provider.requests.length,
        toolCalls: state?.usage.toolCalls ?? 0,
        repairPasses: state?.usage.repairPasses ?? 0,
        inputTokens: state?.usage.inputTokens ?? 0,
        outputTokens: state?.usage.outputTokens ?? 0,
        attemptedTools: [...provider.attemptedTools],
        selectedTools: [...provider.selectedTools],
        invalidResponseTools: [...provider.invalidResponseTools],
        advertisedTools: provider.requests.map((request) =>
          request.tools.map((tool) => tool.name),
        ),
        executedTools: finalSubmissionInterrupted
          ? [...historyTools, { name: 'submit_notebook_patch', isError: false }]
          : historyTools,
        retrievalCalls,
        sourceCoverageComplete: state?.sourceCoverage?.complete ?? null,
        draftSourceReadUnitIds: [...(state?.draft?.sourceReadUnitIds ?? [])],
        previewPageCount: state?.previewGeneration?.pageCount ?? 0,
        draftVersion: state?.draft?.version ?? null,
        draftHash: state?.draft?.draftHash ?? null,
        errorCode: state?.lastError?.code ?? null,
        bridgeError,
      };
    },
    async dispose() {
      panel.dispose();
      if (core.getSnapshot().busy) await core.stop('QA bridge disposed');
      await sandbox.disposeAll();
    },
  };
}
