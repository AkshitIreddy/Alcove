import { describe, expect, it } from 'vitest';
import {
  AgentRuntime,
  InMemoryAgentPersistence,
  createInitialAgentState,
  createSourceCoverageLedger,
  recordSourceCitations,
  recordSourceReads,
  type AgentAdapters,
  type AgentJsonValue,
  type AgentProvider,
  type AgentProviderCapabilities,
  type AgentProviderStreamEvent,
  type AgentProviderTurnRequest,
  type AgentSourceDescriptor,
  type AgentState,
  type DraftPreviewGeneration,
  type NotebookPatchProposal,
  type SourceManifest,
} from '../src/features/aiAgent';

const NOW = '2026-08-14T18:00:00.000Z';

const EMPTY_MANIFEST: SourceManifest = {
  version: 1,
  createdAt: NOW,
  totalEstimatedTokens: 0,
  digest: 'fresh-turn-empty-manifest',
  sources: [],
};

function sourceManifest(digest: string, sourceDigest: string): SourceManifest {
  const source: AgentSourceDescriptor = {
    id: 'old-reader-source',
    title: 'Earlier source.txt',
    kind: 'text',
    digest: sourceDigest,
    mediaType: 'text/plain',
    estimatedTokens: 12,
    quarantined: true,
    promptInjectionWarnings: [],
    units: [{
      id: 'old-reader-unit',
      label: 'Earlier source',
      ordinal: 0,
      digest: `${sourceDigest}-unit`,
      estimatedTokens: 12,
      characters: 48,
      hasText: true,
      hasVisual: false,
      anchor: {
        sourceId: 'old-reader-source',
        unitId: 'old-reader-unit',
      },
    }],
  };
  return {
    version: 1,
    createdAt: NOW,
    totalEstimatedTokens: 12,
    digest,
    sources: [source],
  };
}

class SequenceIds {
  private next = 0;

  create(prefix: string): string {
    this.next += 1;
    return `${prefix}-${this.next}`;
  }
}

interface ProviderDecision {
  readonly name: string;
  readonly args: AgentJsonValue;
}

class ScriptedProvider implements AgentProvider {
  readonly id = 'fresh-notebook-turn-provider';
  readonly requests: AgentProviderTurnRequest[] = [];

  constructor(private readonly decisions: ProviderDecision[]) {}

  capabilities(): Promise<AgentProviderCapabilities> {
    return Promise.resolve({
      providerId: this.id,
      modelId: 'fresh-notebook-turn-model',
      toolUse: true,
      streaming: true,
      imageInput: true,
      maxInputTokens: 128_000,
      maxOutputTokens: 16_000,
      supportsParallelToolCalls: false,
    });
  }

  async *streamTurn(
    request: AgentProviderTurnRequest,
  ): AsyncIterable<AgentProviderStreamEvent> {
    this.requests.push(request);
    const decision = this.decisions.shift();
    if (decision === undefined) {
      throw new Error('fresh-turn provider ran out of decisions');
    }
    yield {
      type: 'tool_call',
      id: `fresh-turn-call-${this.requests.length}`,
      name: decision.name,
      arguments: decision.args,
    };
    yield { type: 'usage', inputTokens: 10, outputTokens: 2 };
    yield { type: 'finish', reason: 'tool_calls' };
  }
}

interface AdapterHarness {
  readonly adapters: AgentAdapters;
  readonly getManifestCalls: () => number;
}

function adapterHarness(
  retainedManifest: SourceManifest,
  liveManifest: SourceManifest = retainedManifest,
): AdapterHarness {
  let manifestReads = 0;
  const generations = new Map<string, DraftPreviewGeneration>();
  const previewFor = (draftHash: string): DraftPreviewGeneration => ({
    generationId: 'fresh-turn-generation',
    draftHash,
    layoutHash: 'fresh-turn-layout',
    rendererVersion: 'fresh-turn-renderer',
    bookSnapshotRevision: 'current-book-revision',
    createdAt: NOW,
    parserValid: true,
    layoutValid: true,
    stale: false,
    pageCount: 1,
    pages: [{
      pageId: 'fresh-turn-preview-page',
      pageNumber: 1,
      width: 800,
      height: 1100,
      image: {
        resourceId: 'fresh-turn-preview-image',
        mimeType: 'image/png',
        digest: 'fresh-turn-preview-image-digest',
        width: 800,
        height: 1100,
      },
      textDigest: 'fresh-turn-text-digest',
      layoutDigest: 'fresh-turn-page-layout',
      paginationSpill: false,
      residualOverflow: false,
    }],
    diagnostics: [],
  });
  return {
    getManifestCalls: () => manifestReads,
    adapters: {
      ids: new SequenceIds(),
      clock: { now: () => NOW },
      hash: {
        digestText: async (text) => `text:${text.length}:${text.slice(0, 12)}`,
        digestJson: async (value) => `json:${JSON.stringify(value)}`,
      },
      notebook: {
        inspectNotebook: async (bookId) => ({
          title: 'Fresh-turn notebook',
          snapshot: {
            bookId,
            bookRevision: 'current-book-revision',
            pageIds: ['page-1'],
            pageRevisions: { 'page-1': 'current-page-revision' },
            capturedAt: NOW,
          },
          pages: [{
            pageId: 'page-1',
            ordinal: 0,
            revision: 'current-page-revision',
            title: 'Current page',
            estimatedTokens: 20,
          }],
        }),
        inspectPage: async (pageId) => ({
          pageId,
          ordinal: 0,
          revision: 'current-page-revision',
          plainText: 'Existing notebook page.',
          documentDigest: 'current-document-digest',
        }),
        inspectPageRange: async () => [],
        inspectSelection: async () => null,
      },
      ingestion: {
        ingest: async () => retainedManifest,
      },
      sources: {
        getManifest: async () => {
          manifestReads += 1;
          return liveManifest;
        },
        getSource: async (sourceId) =>
          retainedManifest.sources.find((source) => source.id === sourceId) ?? null,
        readUnitRange: async () => ({
          sourceId: 'old-reader-source',
          sourceDigest: retainedManifest.sources[0]?.digest ?? '',
          units: [],
          truncated: false,
        }),
        readFullSource: async () => ({
          sourceId: 'old-reader-source',
          sourceDigest: retainedManifest.sources[0]?.digest ?? '',
          units: [],
          truncated: false,
        }),
      },
      retrieval: {
        ensureIndexed: async () => [],
        search: async () => [],
        rerank: async (_query, candidates) => candidates,
      },
      sandbox: {
        validate: async (draft) => ({
          draftHash: draft.draftHash,
          parserDiagnostics: [],
          staticDiagnostics: [],
          imageDiagnostics: [],
          pageLedgerDiagnostics: [],
          valid: true,
          checkedAt: NOW,
        }),
        render: async (draft) => {
          const generation = previewFor(draft.draftHash);
          generations.set(generation.generationId, generation);
          return generation;
        },
        getGeneration: async (generationId) => generations.get(generationId) ?? null,
        dispose: async (generationId) => {
          generations.delete(generationId);
        },
      },
    },
  };
}

function appliedState(
  manifest: SourceManifest,
  sourceCoverage = createSourceCoverageLedger(manifest, 'relevant', NOW),
): AgentState {
  const base = createInitialAgentState({
    identity: {
      taskId: 'fresh-turn-task',
      threadId: 'fresh-turn-thread',
      runId: 'fresh-turn-run',
      bookId: 'book-1',
    },
    goal: 'Add the earlier material to my book.',
    now: NOW,
    userMessageId: 'old-reader-message',
  });
  const validation = {
    draftHash: 'old-draft-hash',
    parserDiagnostics: [],
    staticDiagnostics: [],
    imageDiagnostics: [],
    pageLedgerDiagnostics: [],
    valid: true,
    checkedAt: NOW,
  };
  const page = {
    pageId: 'old-preview-page',
    pageNumber: 1,
    width: 800,
    height: 1100,
    image: {
      resourceId: 'old-preview-image',
      mimeType: 'image/png' as const,
      digest: 'old-preview-image-digest',
      width: 800,
      height: 1100,
    },
    textDigest: 'old-text-digest',
    layoutDigest: 'old-page-layout',
    paginationSpill: false,
    residualOverflow: false,
  };
  const review = {
    generationId: 'old-generation',
    draftHash: 'old-draft-hash',
    requiredPageIds: [page.pageId],
    imageExposures: [{
      generationId: 'old-generation',
      pageId: page.pageId,
      imageResourceId: page.image.resourceId,
      imageDigest: page.image.digest,
      layoutDigest: page.layoutDigest,
      readRequestedAtProviderCall: 1,
      exposedAt: NOW,
    }],
    inspectedPageIds: [page.pageId],
    findings: [],
    complete: true,
    passed: true,
    updatedAt: NOW,
  };
  const preview = {
    previewId: 'old-preview',
    generationId: 'old-generation',
    draftHash: 'old-draft-hash',
    layoutHash: 'old-layout',
    bookId: base.identity.bookId,
    expectedBookRevision: 'stale-book-revision',
    expectedPageIds: ['stale-page'],
    insertionTarget: { kind: 'after_page' as const, pageId: 'stale-page' },
    expectedPageCount: 1,
    pages: [page],
    assumptions: [],
    citations: [],
    imageGenerationPrompts: [],
    sourceCoverage,
    visualReview: review,
    validation,
  };
  const proposal: NotebookPatchProposal = {
    patchId: 'old-applied-patch',
    idempotencyKey: 'old-applied-idempotency-key',
    runId: base.identity.runId,
    draftVersion: 1,
    draftHash: 'old-draft-hash',
    script: '# Old applied page',
    expectedBookRevision: 'stale-book-revision',
    expectedPageIds: ['stale-page'],
    insertionTarget: preview.insertionTarget,
    preview,
    status: 'applied',
    createdAt: NOW,
  };
  return {
    ...base,
    lifecycle: 'completed',
    phase: 'finished',
    notebookSnapshot: {
      bookId: base.identity.bookId,
      bookRevision: 'stale-book-revision',
      pageIds: ['stale-page'],
      pageRevisions: { 'stale-page': 'stale-page-revision' },
      capturedAt: NOW,
    },
    insertionTarget: preview.insertionTarget,
    sourceManifest: manifest,
    sourceCoverage,
    draft: {
      runId: base.identity.runId,
      version: 1,
      script: proposal.script,
      draftHash: proposal.draftHash,
      sourceManifestDigest: manifest.digest,
      sourceReadUnitIds: sourceCoverage.readUnitIds,
      createdAt: NOW,
    },
    validation,
    previewGeneration: {
      generationId: 'old-generation',
      draftHash: proposal.draftHash,
      layoutHash: preview.layoutHash,
      rendererVersion: 'old-renderer',
      bookSnapshotRevision: 'stale-book-revision',
      createdAt: NOW,
      parserValid: true,
      layoutValid: true,
      stale: false,
      pageCount: 1,
      pages: [page],
      diagnostics: [],
    },
    visualReview: review,
    patchProposal: proposal,
  };
}

async function restoreApplied(
  state: AgentState,
  provider: AgentProvider,
  harness: AdapterHarness,
): Promise<AgentRuntime> {
  const persistence = new InMemoryAgentPersistence();
  await persistence.saveTask(state);
  const runtime = new AgentRuntime(provider, harness.adapters, persistence);
  await runtime.restore(state.identity.taskId);
  return runtime;
}

describe('fresh notebook turns after an applied task', () => {
  it('drops the stale notebook snapshot, keeps the explicit default target and re-enters through inspect_notebook', async () => {
    const provider = new ScriptedProvider([{
      name: 'ask_user',
      args: {
        kind: 'requirements',
        context: null,
        question: 'What tone should the new notebook note use?',
      },
    }]);
    const harness = adapterHarness(EMPTY_MANIFEST);
    const runtime = await restoreApplied(
      appliedState(EMPTY_MANIFEST),
      provider,
      harness,
    );
    const explicitTarget = { kind: 'book_end' as const };

    const waiting = await runtime.sendUserMessage(
      'Add a fresh notebook note about cat whiskers.',
      {
        insertionTarget: explicitTarget,
        userMessageId: 'new-notebook-turn',
      },
    );

    expect(waiting.interrupt).toMatchObject({ kind: 'requirements' });
    expect(waiting.state.notebookSnapshot).toBeUndefined();
    expect(waiting.state.insertionTarget).toEqual(explicitTarget);
    expect(provider.requests).toHaveLength(1);
    const firstSurface = provider.requests[0]!.tools.map((tool) => tool.name);
    expect(firstSurface).toContain('inspect_notebook');
    expect(firstSurface).not.toContain('submit_notebook_script');
    expect(firstSurface).not.toContain('propose_insertion');
    expect(firstSurface.filter((name) => !['ask_user', 'set_plan'].includes(name)))
      .toEqual(['inspect_notebook']);
  });

  it('does not revive stale source freshness for an unrelated edit with only old uncited reads', async () => {
    const retainedManifest = sourceManifest(
      'retained-old-manifest',
      'retained-old-source-digest',
    );
    const changedLiveManifest = sourceManifest(
      'changed-live-manifest',
      'changed-live-source-digest',
    );
    const coverage = recordSourceCitations(
      recordSourceReads(
        createSourceCoverageLedger(
          retainedManifest,
          'relevant',
          NOW,
          ['old-reader-unit'],
        ),
        retainedManifest,
        [{
          sourceId: 'old-reader-source',
          sourceDigest: 'retained-old-source-digest',
          units: [{
            unitId: 'old-reader-unit',
            anchor: retainedManifest.sources[0]!.units[0]!.anchor,
            text: 'Old evidence retained only for audit history.',
            digest: 'retained-old-source-digest-unit',
          }],
          truncated: false,
        }],
        NOW,
        1,
      ),
      ['old-reader-unit'],
      NOW,
    );
    expect(coverage).toMatchObject({
      readUnitIds: ['old-reader-unit'],
      citedUnitIds: ['old-reader-unit'],
      complete: true,
      staleSourceIds: [],
    });
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      {
        name: 'submit_notebook_script',
        args: {
          script: '# Cat whiskers\n\nWhiskers help cats sense nearby surfaces.',
          citedUnitIds: [],
          reason: 'initial',
        },
      },
      { name: 'validate_notebook_script', args: {} },
      { name: 'render_draft_preview', args: {} },
      {
        name: 'read_draft_preview_pages',
        args: {
          generationId: 'fresh-turn-generation',
          pageIds: ['fresh-turn-preview-page'],
        },
      },
      {
        name: 'record_visual_review',
        args: {
          generationId: 'fresh-turn-generation',
          reviews: [{ pageId: 'fresh-turn-preview-page', findings: [] }],
        },
      },
      { name: 'propose_notebook_patch', args: {} },
      { name: 'submit_notebook_patch', args: {} },
    ]);
    const harness = adapterHarness(retainedManifest, changedLiveManifest);
    const runtime = await restoreApplied(
      appliedState(retainedManifest, coverage),
      provider,
      harness,
    );

    const result = await runtime.sendUserMessage(
      'Add a new notebook page explaining cat whiskers.',
      {
        insertionTarget: { kind: 'book_end' },
        userMessageId: 'unrelated-new-edit',
      },
    );

    expect(result.interrupt).toMatchObject({ kind: 'final_preview' });
    expect(result.state.lifecycle).toBe('waiting_for_preview_decision');
    expect(result.state.lastError).toBeUndefined();
    expect(harness.getManifestCalls()).toBe(0);
    expect(provider.requests).toHaveLength(8);
    expect(provider.requests.flatMap((request) => request.tools.map((tool) => tool.name)))
      .not.toEqual(expect.arrayContaining([
        'list_source_manifest',
        'read_source_range',
        'read_full_source',
        'search_source_index',
        'rerank_source_hits',
      ]));
    expect(result.state.modelHistory.filter(
      (turn) => turn.role === 'tool' && turn.isError,
    )).toEqual([]);
    expect(result.state.sourceManifest?.digest).toBe(retainedManifest.digest);
    expect(result.state.sourceCoverage).toMatchObject({
      readUnitIds: ['old-reader-unit'],
      citedUnitIds: [],
      staleSourceIds: [],
    });

    const previewId = result.interrupt?.kind === 'final_preview'
      ? result.interrupt.preview.previewId
      : '';
    const approved = await runtime.resume({
      kind: 'preview_decision',
      decision: 'approve',
      previewId,
    });
    expect(approved.state.patchProposal?.status).toBe('approved_pending_apply');
    expect(approved.state.lastError).toBeUndefined();
    expect(harness.getManifestCalls()).toBe(0);
  });
});
