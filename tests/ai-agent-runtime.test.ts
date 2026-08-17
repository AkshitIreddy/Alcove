import { describe, expect, it } from 'vitest';
import type {
  AgentAdapters,
  SourceAttachmentRef,
} from '../src/features/aiAgent/adapters';
import {
  createSourceCoverageLedger,
  createVisualReviewLedger,
  recordSourceCitations,
  recordSourceReads,
  recordVisualImageExposures,
  recordVisualInspection,
} from '../src/features/aiAgent/coverage';
import { AgentEventBus } from '../src/features/aiAgent/events';
import { notebookCraftDiagnostics } from '../src/features/aiAgent/draftCraft';
import { InMemoryAgentPersistence } from '../src/features/aiAgent/persistence';
import {
  buildPatchProposal,
  buildUserPreviewContract,
  canSubmitNotebookPatch,
} from '../src/features/aiAgent/policy';
import type {
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderStreamEvent,
  AgentProviderTurnRequest,
} from '../src/features/aiAgent/provider';
import { AgentProviderError } from '../src/features/aiAgent/provider';
import { planAdaptiveRetrieval } from '../src/features/aiAgent/retrieval';
import { AgentRuntime } from '../src/features/aiAgent/runtime';
import {
  AgentToolCatalog,
  availableAgentToolNames,
} from '../src/features/aiAgent/tools';
import {
  createInitialAgentState,
  type AgentActivityEvent,
  type AgentJsonValue,
  type AgentState,
  type DraftPreviewGeneration,
  type SourceManifest,
} from '../src/features/aiAgent/types';

const NOW = '2026-08-12T08:00:00.000Z';

function manifestWithUnits(count: number, tokenCount = 100): SourceManifest {
  return {
    version: 1,
    createdAt: NOW,
    totalEstimatedTokens: count * tokenCount,
    digest: `manifest-${count}-${tokenCount}`,
    sources: [
      {
        id: 'source-1',
        title: 'Source one',
        kind: 'pdf',
        digest: 'source-digest-1',
        mediaType: 'application/pdf',
        estimatedTokens: count * tokenCount,
        quarantined: true,
        promptInjectionWarnings: [],
        units: Array.from({ length: count }, (_, index) => ({
          id: `unit-${index + 1}`,
          label: `page ${index + 1}`,
          ordinal: index,
          digest: `unit-digest-${index + 1}`,
          estimatedTokens: tokenCount,
          characters: tokenCount * 4,
          hasText: true,
          hasVisual: false,
          anchor: {
            sourceId: 'source-1',
            unitId: `unit-${index + 1}`,
            pageNumber: index + 1,
          },
        })),
      },
    ],
  };
}

class SequenceIds {
  private value = 0;

  create(prefix: string): string {
    this.value += 1;
    return `${prefix}-${this.value}`;
  }
}

interface ScriptedTurn {
  readonly name: string;
  readonly args: AgentJsonValue;
  readonly text?: string;
  readonly siblings?: readonly {
    readonly name: string;
    readonly args: AgentJsonValue;
  }[];
}

class ScriptedProvider implements AgentProvider {
  readonly id = 'fake';
  readonly requests: AgentProviderTurnRequest[] = [];

  constructor(private readonly turns: ScriptedTurn[]) {}

  capabilities(): Promise<AgentProviderCapabilities> {
    return Promise.resolve({
      providerId: 'fake',
      modelId: 'fake-tool-model',
      toolUse: true,
      streaming: true,
      imageInput: true,
      maxInputTokens: 128_000,
      maxOutputTokens: 16_000,
      supportsParallelToolCalls: true,
    });
  }

  async *streamTurn(
    request: AgentProviderTurnRequest,
  ): AsyncIterable<AgentProviderStreamEvent> {
    this.requests.push(request);
    const turn = this.turns.shift();
    if (turn === undefined) throw new Error('fake provider ran out of tool decisions');
    if (turn.text !== undefined) {
      yield { type: 'public_text_delta', text: turn.text };
    }
    yield {
      type: 'tool_call',
      id: `call-${this.requests.length}`,
      name: turn.name,
      arguments: turn.args,
    };
    for (const [index, sibling] of (turn.siblings ?? []).entries()) {
      yield {
        type: 'tool_call',
        id: `call-${this.requests.length}-sibling-${index + 1}`,
        name: sibling.name,
        arguments: sibling.args,
      };
    }
    yield { type: 'usage', inputTokens: 100, outputTokens: 20 };
    yield { type: 'finish', reason: 'tool_calls' };
  }
}

function previewGeneration(draftHash: string): DraftPreviewGeneration {
  return {
    generationId: 'generation-1',
    draftHash,
    layoutHash: 'layout-1',
    rendererVersion: 'test-renderer-1',
    bookSnapshotRevision: 'book-revision-1',
    createdAt: NOW,
    parserValid: true,
    layoutValid: true,
    stale: false,
    pageCount: 1,
    pages: [
      {
        pageId: 'preview-page-1',
        pageNumber: 1,
        width: 800,
        height: 1100,
        image: {
          resourceId: 'rendered-preview-1',
          mimeType: 'image/png',
          digest: 'image-digest-1',
          width: 800,
          height: 1100,
        },
        textDigest: 'text-1',
        layoutDigest: 'page-layout-1',
        paginationSpill: false,
        residualOverflow: false,
      },
    ],
    diagnostics: [],
  };
}

function logShapedFailedApplyState(options: {
  readonly omitExposure?: boolean;
} = {}): AgentState {
  const identity = {
    taskId: 'task-48-page-recovery',
    threadId: 'thread-48-page-recovery',
    runId: 'run-48-page-recovery',
    bookId: 'book-48-page-recovery',
  };
  const base = createInitialAgentState({
    identity,
    goal: 'add to my book',
    now: NOW,
    userMessageId: 'reader-add-to-book',
  });
  const pageIds = Array.from({ length: 48 }, (_, index) => `page-${index + 1}`);
  const generation = {
    ...previewGeneration('draft-kirby-vs-powerpuff'),
    generationId: 'generation-failed-48',
    draftHash: 'draft-kirby-vs-powerpuff',
    bookSnapshotRevision: 'book-revision-48',
    pages: previewGeneration('draft-kirby-vs-powerpuff').pages.map((page) => ({
      ...page,
      pageId: 'generation-failed-48:page:1',
    })),
  };
  const exposed = recordVisualImageExposures(
    createVisualReviewLedger(generation, NOW),
    generation,
    generation.pages,
    { now: NOW, providerCallCount: 1 },
  );
  const reviewed = recordVisualInspection(exposed, generation, {
    pageIds: generation.pages.map((page) => page.pageId),
    findings: [],
    providerCallCount: 2,
    now: NOW,
  });
  const validation = {
    draftHash: generation.draftHash,
    parserDiagnostics: [],
    staticDiagnostics: [],
    imageDiagnostics: [],
    pageLedgerDiagnostics: [],
    valid: true,
    checkedAt: NOW,
  } as const;
  const insertionTarget = { kind: 'after_page' as const, pageId: pageIds[47]! };
  const preview = {
    previewId: 'preview-failed-48',
    generationId: generation.generationId,
    draftHash: generation.draftHash,
    layoutHash: generation.layoutHash,
    bookId: identity.bookId,
    expectedBookRevision: 'book-revision-48',
    expectedPageIds: pageIds,
    insertionTarget,
    expectedPageCount: generation.pageCount,
    pages: generation.pages,
    assumptions: [],
    citations: [],
    imageGenerationPrompts: [],
    sourceCoverage: createSourceCoverageLedger(manifestWithUnits(0), 'relevant', NOW),
    visualReview: options.omitExposure
      ? { ...reviewed, imageExposures: [] }
      : reviewed,
    validation,
  };
  return {
    ...base,
    lifecycle: 'waiting_for_preview_decision',
    phase: 'waiting_for_preview_decision',
    notebookSnapshot: {
      bookId: identity.bookId,
      bookRevision: 'book-revision-48',
      pageIds,
      pageRevisions: Object.fromEntries(pageIds.map((id, index) => [id, `revision-${index + 1}`])),
      capturedAt: NOW,
    },
    draft: {
      runId: identity.runId,
      version: 1,
      script: '# Kirby vs Powerpuff\n\n- Adaptability\n- Teamwork',
      draftHash: generation.draftHash,
      createdAt: NOW,
    },
    validation,
    previewGeneration: generation,
    visualReview: reviewed,
    insertionTarget,
    patchProposal: {
      patchId: 'patch-failed-48',
      idempotencyKey: 'idempotency-failed-48',
      runId: identity.runId,
      draftVersion: 1,
      draftHash: generation.draftHash,
      script: '# Kirby vs Powerpuff\n\n- Adaptability\n- Teamwork',
      expectedBookRevision: 'book-revision-48',
      expectedPageIds: pageIds,
      insertionTarget,
      preview,
      status: 'apply_failed',
      createdAt: NOW,
    },
    lastError: {
      code: 'stale_context',
      message: 'The exact reviewed draft is no longer available. Refresh the preview before inserting.',
      retryable: true,
    },
    lastApplyFailure: {
      patchId: 'patch-failed-48',
      previewId: 'preview-failed-48',
      message: 'The exact reviewed draft is no longer available. Refresh the preview before inserting.',
      failedAt: NOW,
    },
  };
}

function textVeiledFailedApplyState(options: {
  readonly forgePreviewReviewGeneration?: boolean;
} = {}): AgentState {
  const failed = logShapedFailedApplyState();
  const placeholder = '⟦ALCOVE_PRIVATE_EMAIL_VEILTEST01_0001⟧';
  const exactScript = `${failed.patchProposal!.script}\n\nContact alice@example.com`;
  const maskedScript = `${failed.patchProposal!.script}\n\nContact ${placeholder}`;
  const exactHash = 'draft-exact-private';
  const maskedHash = 'draft-masked-private';
  const exactGeneration: DraftPreviewGeneration = {
    ...failed.previewGeneration!,
    draftHash: exactHash,
  };
  const maskedGeneration: DraftPreviewGeneration = {
    ...failed.previewGeneration!,
    generationId: 'generation-masked-private',
    draftHash: maskedHash,
    layoutHash: 'layout-masked-private',
    pages: failed.previewGeneration!.pages.map((page) => ({
      ...page,
      pageId: 'generation-masked-private:page:1',
      image: {
        ...page.image,
        resourceId: 'rendered-masked-private',
        digest: 'image-digest-masked-private',
      },
      textDigest: 'text-digest-masked-private',
      layoutDigest: 'layout-digest-masked-private',
    })),
  };
  const exposed = recordVisualImageExposures(
    createVisualReviewLedger(maskedGeneration, NOW),
    maskedGeneration,
    maskedGeneration.pages,
    { now: NOW, providerCallCount: 1 },
  );
  const maskedReview = recordVisualInspection(exposed, maskedGeneration, {
    pageIds: maskedGeneration.pages.map((page) => page.pageId),
    findings: [],
    providerCallCount: 2,
    now: NOW,
  });
  const exactValidation = {
    ...failed.validation!,
    draftHash: exactHash,
  };
  const maskedValidation = {
    ...failed.validation!,
    draftHash: maskedHash,
  };
  const exactDraft = {
    ...failed.draft!,
    script: exactScript,
    draftHash: exactHash,
  };
  const maskedDraft = {
    ...failed.draft!,
    script: maskedScript,
    draftHash: maskedHash,
  };
  const previewVisualReview = options.forgePreviewReviewGeneration
    ? { ...maskedReview, generationId: 'generation-forged-private-review' }
    : maskedReview;
  return {
    ...failed,
    draft: maskedDraft,
    validation: maskedValidation,
    previewGeneration: maskedGeneration,
    visualReview: maskedReview,
    textPrivacy: {
      version: 1,
      enabled: true,
      namespace: 'VEILTEST01',
      entries: [{
        placeholder,
        value: 'alice@example.com',
        kind: 'email',
        createdAt: NOW,
      }],
      textOnly: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
    localRestoredFinal: {
      maskedDraftHash: maskedHash,
      draft: exactDraft,
      validation: exactValidation,
      previewGeneration: exactGeneration,
      finalizedAt: NOW,
    },
    patchProposal: {
      ...failed.patchProposal!,
      draftHash: exactHash,
      script: exactScript,
      preview: {
        ...failed.patchProposal!.preview,
        draftHash: exactHash,
        pages: exactGeneration.pages,
        visualReview: previewVisualReview,
        validation: exactValidation,
      },
    },
  };
}

function exactThreePageDiagnosticFailedApplyState(): AgentState {
  const failed = logShapedFailedApplyState();
  const script = [
    '# Kirby vs The Powerpuff Girls',
    '',
    '## Kirby',
    '- **Origin:** Dream Land',
    '- **Abilities:** Inhales enemies and copies their powers',
    '- **Personality:** Cheerful, innocent, and determined',
    '',
    '::page',
    '',
    '## The Powerpuff Girls',
    '- **Origin:** Townsville',
    '- **Abilities:** Flight, strength, speed, and teamwork',
    '- **Personality:** Blossom leads, Bubbles cares, Buttercup fights',
    '',
    '::page',
    '',
    '## Key differences',
    '- Kirby adapts by copying powers; the girls have innate powers',
    '- Kirby adventures solo; the girls protect their city as a team',
    '- Both turn childlike charm into surprising strength',
  ].join('\n');
  const draftHash = 'draft-exact-log-three-pages';
  const generationId = 'generation-failed-log-three-pages';
  const seedPage = failed.previewGeneration!.pages[0]!;
  const pages = [1, 2, 3].map((pageNumber) => ({
    ...seedPage,
    pageId: `${generationId}:page:${pageNumber}`,
    pageNumber,
    image: {
      ...seedPage.image,
      resourceId: `rendered-log-three-pages-${pageNumber}`,
      digest: `image-digest-log-three-pages-${pageNumber}`,
    },
    textDigest: `text-digest-log-three-pages-${pageNumber}`,
    layoutDigest: `layout-digest-log-three-pages-${pageNumber}`,
  }));
  const generation: DraftPreviewGeneration = {
    ...failed.previewGeneration!,
    generationId,
    draftHash,
    layoutHash: 'layout-log-three-pages',
    pageCount: pages.length,
    pages,
  };
  const exposed = recordVisualImageExposures(
    createVisualReviewLedger(generation, NOW),
    generation,
    generation.pages,
    { now: NOW, providerCallCount: 1 },
  );
  const review = recordVisualInspection(exposed, generation, {
    pageIds: generation.pages.map((page) => page.pageId),
    findings: [],
    providerCallCount: 2,
    now: NOW,
  });
  const validation = { ...failed.validation!, draftHash };
  const draft = {
    ...failed.draft!,
    script,
    draftHash,
  };
  return {
    ...failed,
    draft,
    validation,
    previewGeneration: generation,
    visualReview: review,
    patchProposal: {
      ...failed.patchProposal!,
      draftHash,
      script,
      preview: {
        ...failed.patchProposal!.preview,
        generationId,
        draftHash,
        layoutHash: generation.layoutHash,
        expectedPageCount: pages.length,
        pages,
        visualReview: review,
        validation,
      },
    },
  };
}

function fakeAdapters(manifest: SourceManifest = manifestWithUnits(0)): {
  readonly adapters: AgentAdapters;
  readonly ingested: SourceAttachmentRef[][];
} {
  const ids = new SequenceIds();
  const ingested: SourceAttachmentRef[][] = [];
  return {
    ingested,
    adapters: {
      ids,
      clock: { now: () => NOW },
      hash: {
        digestText: async (text) => `hash:${text.length}:${text.slice(0, 8)}`,
        digestJson: async (value) => `json:${JSON.stringify(value)}`,
      },
      notebook: {
        inspectNotebook: async (bookId) => ({
          title: 'Test notebook',
          snapshot: {
            bookId,
            bookRevision: 'book-revision-1',
            pageIds: ['page-1'],
            pageRevisions: { 'page-1': 'page-revision-1' },
            capturedAt: NOW,
          },
          pages: [
            {
              pageId: 'page-1',
              ordinal: 0,
              revision: 'page-revision-1',
              title: 'Page one',
              estimatedTokens: 20,
            },
          ],
        }),
        inspectPage: async (pageId) => ({
          pageId,
          ordinal: 0,
          revision: 'page-revision-1',
          plainText: 'Existing page',
          documentDigest: 'document-1',
        }),
        inspectPageRange: async () => [],
        inspectSelection: async () => null,
      },
      ingestion: {
        ingest: async (attachments, context) => {
          ingested.push([...attachments]);
          context.onProgress?.({
            phase: 'indexing',
            completed: attachments.length,
            total: attachments.length,
            summary: 'Source manifest ready',
          });
          return manifest;
        },
      },
      sources: {
        getManifest: async () => manifest,
        getSource: async (sourceId) =>
          manifest.sources.find((source) => source.id === sourceId) ?? null,
        readUnitRange: async (sourceId, start, end) => ({
          sourceId,
          sourceDigest: 'source-digest-1',
          units: manifest.sources[0]?.units
            .filter((unit) => unit.ordinal >= start && unit.ordinal <= end)
            .map((unit) => ({
              unitId: unit.id,
              anchor: unit.anchor,
              text: `text for ${unit.id}`,
              digest: unit.digest,
            })) ?? [],
          truncated: false,
        }),
        readFullSource: async (sourceId) => ({
          sourceId,
          sourceDigest: 'source-digest-1',
          units: manifest.sources[0]?.units.map((unit) => ({
            unitId: unit.id,
            anchor: unit.anchor,
            text: `text for ${unit.id}`,
            digest: unit.digest,
          })) ?? [],
          truncated: false,
          visualRefs:
            manifest.sources[0]?.units[0] === undefined
              ? []
              : [
                  {
                    image: {
                      resourceId: 'source-page-image-1',
                      mimeType: 'image/png' as const,
                      digest: 'source-page-image-digest-1',
                      width: 1000,
                      height: 1400,
                    },
                    anchor: manifest.sources[0].units[0].anchor,
                    label: 'PDF page 1',
                  },
                ],
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
        render: async (draft) => previewGeneration(draft.draftHash),
        getGeneration: async (generationId) =>
          generationId === 'generation-1' ? previewGeneration('unused') : null,
        dispose: async () => undefined,
      },
    },
  };
}

describe('Alcove autonomous notebook agent runtime', () => {
  it('answers a simple greeting locally instead of failing on an empty provider turn', async () => {
    const provider = new ScriptedProvider([]);
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const result = await runtime.start({
      taskId: 'task-local-greeting',
      threadId: 'thread-local-greeting',
      runId: 'run-local-greeting',
      bookId: 'book-1',
      goal: 'hi',
      // Every real panel supplies a default placement even for conversation.
      // That context must not turn a greeting into notebook work.
      insertionTarget: { kind: 'book_end' },
    });

    expect(provider.requests).toHaveLength(0);
    expect(result.state.lifecycle).toBe('completed');
    expect(result.state.conversation.at(-1)).toMatchObject({
      role: 'assistant',
      text: expect.stringMatching(/^Hi!/),
    });
  });

  it('recovers an ordinary explanation through one plain conversation turn after a rejected tool envelope', async () => {
    const requests: AgentProviderTurnRequest[] = [];
    const provider: AgentProvider = {
      id: 'conversation-envelope-recovery',
      capabilities: async () => ({
        providerId: 'conversation-envelope-recovery',
        modelId: 'test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 128_000,
        maxOutputTokens: 16_000,
        supportsParallelToolCalls: false,
      }),
      async *streamTurn(request) {
        requests.push(request);
        if (requests.length === 1) {
          throw new AgentProviderError({
            code: 'invalid_response',
            message: 'scripted rejected strict conversation envelope',
            status: 400,
            retryable: false,
          });
        }
        yield {
          type: 'public_text_delta',
          text: 'Cookies are small pieces of data that websites store in your browser. ',
        };
        yield {
          type: 'public_text_delta',
          text: 'They remember sessions, preferences, and sometimes analytics identifiers.',
        };
        yield { type: 'usage', inputTokens: 42, outputTokens: 24 };
        yield { type: 'finish', reason: 'stop' };
      },
    };
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const greeting = await runtime.start({
      taskId: 'task-conversation-envelope-recovery',
      threadId: 'thread-conversation-envelope-recovery',
      runId: 'run-conversation-envelope-recovery',
      bookId: 'book-1',
      goal: 'hi',
      insertionTarget: { kind: 'book_end' },
    });
    expect(greeting.state.lifecycle).toBe('completed');
    expect(requests).toHaveLength(0);

    const result = await runtime.sendUserMessage('explain cookies', {
      userMessageId: 'reader-explain-cookies',
    });

    expect(result.state.lifecycle).toBe('completed');
    expect(result.state.lastError).toBeUndefined();
    expect(result.state.usage).toMatchObject({ providerCalls: 2, inputTokens: 42, outputTokens: 24 });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ toolChoice: 'auto' });
    expect(requests[0]?.tools.map((tool) => tool.name)).toEqual([
      'ask_user',
      'finish_conversation',
    ]);
    expect(requests[1]).toMatchObject({ toolChoice: 'auto', tools: [] });
    expect(result.state.conversation.filter((message) =>
      message.role === 'assistant' && /Cookies are small pieces of data/u.test(message.text)
    )).toHaveLength(1);
  });

  it('does not offer a useless Retry for a non-retryable provider request rejection', async () => {
    const requests: AgentProviderTurnRequest[] = [];
    const provider: AgentProvider = {
      id: 'non-retryable-provider-request',
      capabilities: async () => ({
        providerId: 'non-retryable-provider-request',
        modelId: 'test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 128_000,
        maxOutputTokens: 16_000,
        supportsParallelToolCalls: false,
      }),
      async *streamTurn(request) {
        requests.push(request);
        throw new AgentProviderError({
          code: 'invalid_response',
          message: 'scripted HTTP 400 request rejection',
          status: 400,
          retryable: false,
        });
      },
    };
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const result = await runtime.start({
      taskId: 'task-non-retryable-provider-request',
      threadId: 'thread-non-retryable-provider-request',
      runId: 'run-non-retryable-provider-request',
      bookId: 'book-1',
      goal: 'Add the cookie explanation to my book.',
      insertionTarget: { kind: 'book_end' },
    });

    expect(requests).toHaveLength(1);
    expect(result.state).toMatchObject({
      lifecycle: 'failed',
      lastError: {
        code: 'provider_invalid_response',
        retryable: false,
        status: 400,
      },
    });
  });

  it('repairs one empty provider turn before pausing an ordinary conversation', async () => {
    let calls = 0;
    const provider: AgentProvider = {
      id: 'empty-then-answer',
      capabilities: async () => ({
        providerId: 'empty-then-answer',
        modelId: 'test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 128_000,
        maxOutputTokens: 16_000,
        supportsParallelToolCalls: true,
      }),
      async *streamTurn() {
        calls += 1;
        if (calls === 1) {
          yield { type: 'usage', inputTokens: 30, outputTokens: 1 };
          yield { type: 'finish', reason: 'stop' };
          return;
        }
        yield {
          type: 'tool_call',
          id: 'finish-after-empty',
          name: 'finish_conversation',
          arguments: { answer: 'Mathematics studies patterns, quantities, structures, and change.', citedUnitIds: [] },
        };
        yield { type: 'usage', inputTokens: 35, outputTokens: 12 };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    };
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const result = await runtime.start({
      taskId: 'task-empty-provider-repair',
      threadId: 'thread-empty-provider-repair',
      runId: 'run-empty-provider-repair',
      bookId: 'book-1',
      goal: 'What is mathematics?',
    });

    expect(calls).toBe(2);
    expect(result.state.lifecycle).toBe('completed');
    expect(result.state.usage).toMatchObject({ providerCalls: 2, inputTokens: 65, outputTokens: 13 });
    expect(result.state.conversation.at(-1)?.text).toMatch(/patterns, quantities/i);
  });

  it('safely advances the sole deterministic phase when the provider returns no call after storing a draft', async () => {
    const requests: AgentProviderTurnRequest[] = [];
    const successfulTurns: ScriptedTurn[] = [
      { name: 'inspect_notebook', args: {} },
      {
        name: 'submit_notebook_script',
        args: {
          script: '# Water cycle\n\nWater evaporates, condenses, and falls again.',
          citedUnitIds: [],
          reason: 'initial',
        },
      },
      {
        name: 'read_draft_preview_pages',
        args: { generationId: 'generation-1', pageIds: ['preview-page-1'] },
      },
      {
        name: 'record_visual_review',
        args: {
          generationId: 'generation-1',
          reviews: [{ pageId: 'preview-page-1', findings: [] }],
        },
      },
      { name: 'propose_notebook_patch', args: {} },
      { name: 'submit_notebook_patch', args: {} },
    ];
    let rejectedRenderProtocol = false;
    const provider: AgentProvider = {
      id: 'empty-deterministic-routing',
      capabilities: async () => ({
        providerId: 'empty-deterministic-routing',
        modelId: 'test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 128_000,
        maxOutputTokens: 16_000,
        supportsParallelToolCalls: false,
      }),
      async *streamTurn(request) {
        requests.push(request);
        if (
          request.tools.length === 1 &&
          request.tools[0]?.name === 'validate_notebook_script'
        ) {
          yield { type: 'usage', inputTokens: 44, outputTokens: 2 };
          yield { type: 'finish', reason: 'stop' };
          return;
        }
        if (
          !rejectedRenderProtocol &&
          request.tools.length === 1 &&
          request.tools[0]?.name === 'render_draft_preview'
        ) {
          rejectedRenderProtocol = true;
          throw new AgentProviderError({
            code: 'invalid_response',
            message: 'scripted incomplete render tool stream',
          });
        }
        const turn = successfulTurns.shift();
        if (turn === undefined) throw new Error('provider ran out of deterministic QA turns');
        yield {
          type: 'tool_call',
          id: `empty-routing-${requests.length}`,
          name: turn.name,
          arguments: turn.args,
        };
        yield { type: 'usage', inputTokens: 60, outputTokens: 12 };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    };
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const waiting = await runtime.start({
      taskId: 'task-empty-post-draft-routing',
      threadId: 'thread-empty-post-draft-routing',
      runId: 'run-empty-post-draft-routing',
      bookId: 'book-1',
      goal: 'Put a short water-cycle explanation in my book.',
      insertionTarget: { kind: 'book_end' },
      budget: { maxProviderCalls: 10 },
    });

    expect(waiting.interrupt).toMatchObject({ kind: 'final_preview' });
    expect(waiting.state.lifecycle).toBe('waiting_for_preview_decision');
    expect(requests).toHaveLength(8);
    expect(requests[2]?.tools.map((tool) => tool.name)).toEqual([
      'validate_notebook_script',
    ]);
    expect(waiting.state.usage).toMatchObject({ providerCalls: 8, toolCalls: 8 });
    const locallyRouted = waiting.state.modelHistory.flatMap((turn) =>
      turn.role === 'assistant'
        ? turn.toolCalls
            .filter((call) => call.id.startsWith('deterministic-'))
            .map((call) => call.name)
        : [],
    );
    expect(locallyRouted).toEqual([
      'validate_notebook_script',
      'render_draft_preview',
    ]);
  });

  it('restores and restarts a terminal invalid-provider checkpoint without replaying the stored draft', async () => {
    const requests: AgentProviderTurnRequest[] = [];
    let rejectedValidate = false;
    const successfulTurns: ScriptedTurn[] = [
      { name: 'inspect_notebook', args: {} },
      {
        name: 'submit_notebook_script',
        args: {
          script: '# Osmosis\n\nWater crosses a selective membrane toward the more concentrated side.',
          citedUnitIds: [],
          reason: 'initial',
        },
      },
      { name: 'validate_notebook_script', args: {} },
      { name: 'render_draft_preview', args: {} },
      {
        name: 'read_draft_preview_pages',
        args: { generationId: 'generation-1', pageIds: ['preview-page-1'] },
      },
      {
        name: 'record_visual_review',
        args: {
          generationId: 'generation-1',
          reviews: [{ pageId: 'preview-page-1', findings: [] }],
        },
      },
      { name: 'propose_notebook_patch', args: {} },
      { name: 'submit_notebook_patch', args: {} },
    ];
    const provider: AgentProvider = {
      id: 'retry-terminal-invalid-response',
      capabilities: async () => ({
        providerId: 'retry-terminal-invalid-response',
        modelId: 'test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 128_000,
        maxOutputTokens: 16_000,
        supportsParallelToolCalls: false,
      }),
      async *streamTurn(request) {
        requests.push(request);
        if (
          !rejectedValidate &&
          request.tools.length === 1 &&
          request.tools[0]?.name === 'read_draft_preview_pages'
        ) {
          rejectedValidate = true;
          throw new AgentProviderError({
            code: 'invalid_response',
            message: 'scripted malformed provider stream',
          });
        }
        const turn = successfulTurns.shift();
        if (turn === undefined) throw new Error('provider ran out of Retry QA turns');
        yield {
          type: 'tool_call',
          id: `retry-terminal-${requests.length}`,
          name: turn.name,
          arguments: turn.args,
        };
        yield { type: 'usage', inputTokens: 70, outputTokens: 14 };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    };
    const { adapters } = fakeAdapters();
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    const failed = await runtime.start({
      taskId: 'task-terminal-invalid-retry',
      threadId: 'thread-terminal-invalid-retry',
      runId: 'run-terminal-invalid-retry',
      bookId: 'book-1',
      goal: 'Put an osmosis explanation in my book.',
      insertionTarget: { kind: 'book_end' },
      budget: { maxProviderCalls: 12 },
    });

    expect(failed.state.lifecycle).toBe('failed');
    expect(failed.state.lastError?.code).toBe('provider_invalid_response');
    expect(failed.state.usage).toMatchObject({ providerCalls: 5, toolCalls: 4 });
    expect(failed.state.draft).toMatchObject({ version: 1 });
    const failedDraftHash = failed.state.draft?.draftHash;

    await runtime.clearActiveTask();
    const restarted = new AgentRuntime(provider, adapters, persistence);
    const restored = await restarted.restore('task-terminal-invalid-retry');
    expect(restored).toMatchObject({
      busy: false,
      interrupt: null,
      state: {
        lifecycle: 'failed',
        lastError: { code: 'provider_invalid_response', retryable: true },
        draft: { version: 1, draftHash: failedDraftHash },
      },
    });
    const requestCountBeforeRetry = requests.length;

    const waiting = await restarted.retry();
    expect(waiting.interrupt).toMatchObject({ kind: 'final_preview' });
    expect(waiting.state.lifecycle).toBe('waiting_for_preview_decision');
    expect(waiting.state.draft).toMatchObject({ version: 1, draftHash: failedDraftHash });
    expect(waiting.state.usage).toMatchObject({ providerCalls: 9, toolCalls: 8 });
    expect(requests).toHaveLength(9);
    expect(requests.length).toBeGreaterThan(requestCountBeforeRetry);
    expect(requests.slice(requestCountBeforeRetry).map((request) =>
      request.tools.map((tool) => tool.name)
    )).toEqual([
      ['read_draft_preview_pages'],
      ['record_visual_review'],
      ['propose_notebook_patch'],
      ['submit_notebook_patch'],
    ]);
    const successfulToolNames = waiting.state.modelHistory.flatMap((turn) =>
      turn.role === 'assistant' ? turn.toolCalls.map((call) => call.name) : [],
    );
    expect(successfulToolNames.filter((name) => name === 'inspect_notebook')).toHaveLength(1);
    expect(successfulToolNames.filter((name) => name === 'submit_notebook_script')).toHaveLength(1);
    const settled = restarted.getSnapshot();
    expect(
      settled.state?.lifecycle === 'running' &&
      !settled.busy &&
      settled.state.lastError === undefined &&
      settled.interrupt === null
    ).toBe(false);
  });

  it('never lets retryable provider attempts cross the reader-turn call budget', async () => {
    const requests: AgentProviderTurnRequest[] = [];
    const provider: AgentProvider = {
      id: 'retry-budget-boundary',
      capabilities: async () => ({
        providerId: 'retry-budget-boundary',
        modelId: 'test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 128_000,
        maxOutputTokens: 16_000,
        supportsParallelToolCalls: false,
      }),
      async *streamTurn(request) {
        requests.push(request);
        throw new AgentProviderError({
          code: 'rate_limit',
          message: 'scripted retryable rate limit',
          retryAfterMs: 0,
        });
      },
    };
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, fakeAdapters().adapters, persistence);
    const failed = await runtime.start({
      taskId: 'task-provider-retry-budget',
      threadId: 'thread-provider-retry-budget',
      runId: 'run-provider-retry-budget',
      bookId: 'book-1',
      goal: 'Explain osmosis.',
      budget: { maxProviderCalls: 2, maxProviderRetries: 4 },
    });

    expect(requests).toHaveLength(2);
    expect(failed.state).toMatchObject({
      lifecycle: 'failed',
      lastError: {
        code: 'budget_exhausted',
        retryable: false,
        message: 'provider-call budget exhausted (2)',
      },
      usage: { providerCalls: 2, providerRetries: 1 },
    });
    expect((await persistence.listEvents('task-provider-retry-budget')).filter(
      (event) => event.type === 'retry.scheduled',
    )).toHaveLength(1);
  });

  it('never publishes Notebook Script prose as the answer to a notebook-change request', async () => {
    const requests: AgentProviderTurnRequest[] = [];
    const provider: AgentProvider = {
      id: 'notebook-prose-repair',
      capabilities: async () => ({
        providerId: 'notebook-prose-repair',
        modelId: 'test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 128_000,
        maxOutputTokens: 16_000,
        supportsParallelToolCalls: true,
      }),
      async *streamTurn(request) {
        requests.push(request);
        if (requests.length === 1) {
          yield { type: 'public_text_delta', text: '# Copy this into Insert Script\n\nLion notes.' };
          yield { type: 'finish', reason: 'stop' };
          return;
        }
        yield {
          type: 'tool_call',
          id: 'repair-uses-tool',
          name: 'ask_user',
          arguments: {
            kind: 'requirements',
            question: 'Should I preserve the examples from the explanation above?',
          },
        };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    };
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const waiting = await runtime.start({
      taskId: 'task-notebook-prose-repair',
      threadId: 'thread-notebook-prose-repair',
      runId: 'run-notebook-prose-repair',
      bookId: 'book-1',
      goal: 'Add the lion explanation into my book.',
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.systemPrompt).toMatch(/prose was not shown|concrete notebook capability/i);
    expect(waiting.interrupt?.kind).toBe('requirements');
    expect(waiting.state.conversation.some((message) =>
      /copy this into insert script/i.test(message.text)
    )).toBe(false);
    expect(waiting.state.lifecycle).toBe('waiting_for_user');
  });

  it('keeps manual Notebook Script prose hidden even when the same turn uses a valid notebook tool', async () => {
    const requests: AgentProviderTurnRequest[] = [];
    const provider: AgentProvider = {
      id: 'notebook-tool-with-prose',
      capabilities: async () => ({
        providerId: 'notebook-tool-with-prose',
        modelId: 'test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 128_000,
        maxOutputTokens: 16_000,
        supportsParallelToolCalls: true,
      }),
      async *streamTurn(request) {
        requests.push(request);
        if (requests.length === 1) {
          yield {
            type: 'public_text_delta',
            text: '# Copy this into Insert Script\n\nThis prose must remain internal.',
          };
          yield {
            type: 'tool_call',
            id: 'inspect-with-manual-prose',
            name: 'inspect_notebook',
            arguments: { request: 'current' },
          };
          yield { type: 'finish', reason: 'tool_calls' };
          return;
        }
        throw new Error('bounded provider stop after the inspection assertion');
      },
    };
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const waiting = await runtime.start({
      taskId: 'task-tool-with-manual-prose',
      threadId: 'thread-tool-with-manual-prose',
      runId: 'run-tool-with-manual-prose',
      bookId: 'book-1',
      goal: 'Add the explanation above into my book.',
    });

    expect(requests).toHaveLength(2);
    expect(waiting.state.lifecycle).toBe('failed');
    expect(waiting.state.conversation.some((message) =>
      /copy this into insert script|prose must remain internal/i.test(message.text)
    )).toBe(false);
    expect(JSON.stringify(requests[1]?.messages)).not.toMatch(
      /copy this into insert script|prose must remain internal/i,
    );
  });

  it('keeps one natural question durable and records the exact free-form reply once', async () => {
    const provider = new ScriptedProvider([
      {
        name: 'ask_user',
        text: 'One thing before I begin…',
        args: {
          kind: 'requirements',
          context: 'I can turn that into a polished notebook section.',
          question: 'Which explanation should I add?',
        },
      },
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Would you like any examples included?',
        },
      },
    ]);
    const { adapters } = fakeAdapters();
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    const waiting = await runtime.start({
      taskId: 'task-natural-question',
      threadId: 'thread-natural-question',
      runId: 'run-natural-question',
      bookId: 'book-1',
      goal: 'Insert something in the book.',
    });
    expect(waiting.interrupt).toMatchObject({
      kind: 'requirements',
      allowSensibleDefaults: false,
      questions: [{
        prompt: 'I can turn that into a polished notebook section.\n\nWhich explanation should I add?',
        allowFreeText: true,
      }],
    });
    const originalQuestion = waiting.state.conversation.at(-1);
    expect(originalQuestion).toMatchObject({
      role: 'assistant',
      text: 'I can turn that into a polished notebook section.\n\nWhich explanation should I add?',
    });
    expect(waiting.state.conversation.some(
      (message) => message.text === 'One thing before I begin…',
    )).toBe(false);

    const reply = 'Use the lion explanation from our conversation.';
    const resumed = await runtime.sendUserMessage(reply, { userMessageId: 'reader-reply-1' });
    const secondRequest = provider.requests[1];
    const providerHistory = JSON.stringify(secondRequest?.messages);
    expect(providerHistory).toContain(reply);
    expect(providerHistory).not.toContain(`response: ${reply}`);
    expect(providerHistory).not.toContain('One thing before I begin');
    expect(resumed.state.conversation.filter((message) => message.text === reply))
      .toEqual([expect.objectContaining({ id: 'reader-reply-1', role: 'user' })]);
    expect(resumed.state.conversation).toContainEqual(originalQuestion);
    expect((await persistence.loadTask('task-natural-question'))?.state.conversation)
      .toContainEqual(originalQuestion);
  });

  it('restores a pending conversational question without turning it into a form', async () => {
    const provider = new ScriptedProvider([
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'What topic would you like me to turn into pages?',
        },
      },
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Anything else I should keep in mind?',
        },
      },
    ]);
    const { adapters } = fakeAdapters();
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    const waiting = await runtime.start({
      taskId: 'task-restored-question',
      threadId: 'thread-restored-question',
      runId: 'run-restored-question',
      bookId: 'book-1',
      goal: 'Insert in book.',
    });
    const questionMessage = waiting.state.conversation.at(-1);
    await runtime.clearActiveTask();

    const restarted = new AgentRuntime(provider, adapters, persistence);
    const restored = await restarted.restore('task-restored-question');
    expect(restored.interrupt).toMatchObject({
      kind: 'requirements',
      allowSensibleDefaults: false,
      questions: [{
        prompt: 'What topic would you like me to turn into pages?',
      }],
    });
    const restoredQuestion = restored.interrupt?.kind === 'requirements'
      ? restored.interrupt.questions[0]
      : undefined;
    expect(restoredQuestion).not.toHaveProperty('choices');
    expect(restoredQuestion).not.toHaveProperty('sensibleDefault');
    expect(restored.state?.conversation).toContainEqual(questionMessage);
    const resumed = await restarted.sendUserMessage('Osmosis, with cute analogies.');
    expect(resumed.state.conversation).toContainEqual(questionMessage);
  });

  it('carries notebook intent through a natural clarification reply in a greeting-started task', async () => {
    const provider = new ScriptedProvider([
      {
        name: 'finish_conversation',
        args: {
          answer: 'Lions are social big cats that live together in prides.',
          citedUnitIds: [],
        },
      },
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Should I turn the lion explanation into a notebook page?',
        },
      },
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Would you like a short recap box as well?',
        },
      },
    ]);
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const greeted = await runtime.start({
      taskId: 'task-greeting-to-notebook',
      threadId: 'thread-greeting-to-notebook',
      runId: 'run-greeting-to-notebook',
      bookId: 'book-1',
      goal: 'hi',
    });
    expect(greeted.state.lifecycle).toBe('completed');
    expect(provider.requests).toHaveLength(0);

    await runtime.sendUserMessage('explain lions');
    const waiting = await runtime.sendUserMessage('add into my book');
    expect(waiting.interrupt).toMatchObject({
      kind: 'requirements',
      questions: [{ prompt: 'Should I turn the lion explanation into a notebook page?' }],
    });
    const question = waiting.state.conversation.at(-1);

    const resumed = await runtime.sendUserMessage('yes', { userMessageId: 'reader-yes' });
    expect(provider.requests).toHaveLength(3);
    const resumedRequest = provider.requests[2]!;
    const advertisedTools = resumedRequest.tools.map((tool) => tool.name);
    expect(advertisedTools).toContain('inspect_notebook');
    expect(advertisedTools).not.toContain('finish_conversation');
    const resumedProviderHistory = JSON.stringify(resumedRequest.messages);
    expect(resumedProviderHistory).not.toMatch(/response\s*:\s*yes/iu);
    const readerReplyResult = resumedRequest.messages.find((message) =>
      message.role === 'tool' && message.toolName === 'ask_user'
    );
    const readerReplyText = readerReplyResult?.role === 'tool'
      ? readerReplyResult.content.find((part) => part.type === 'text')?.text
      : undefined;
    expect(readerReplyText === undefined ? undefined : JSON.parse(readerReplyText))
      .toMatchObject({ kind: 'reader_reply', response: 'yes' });
    expect(resumed.state.conversation.filter((message) => message.text === 'yes'))
      .toEqual([expect.objectContaining({ id: 'reader-yes', role: 'user' })]);
    expect(resumed.state.conversation).toContainEqual(question);
  });

  it('cannot miss an immediate Stop while start is still hydrating source setup', async () => {
    const provider = new ScriptedProvider([{
      name: 'ask_user',
      args: {
        kind: 'requirements',
        question: 'Retry reached the provider?',
      },
    }]);
    const { adapters } = fakeAdapters();
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);

    const starting = runtime.start({
      taskId: 'task-immediate-stop',
      threadId: 'thread-immediate-stop',
      runId: 'run-immediate-stop',
      bookId: 'book-1',
      goal: 'This must not reach the provider.',
    });
    await runtime.stop('Stopped immediately');
    const result = await starting;

    expect(result.state.lifecycle).toBe('cancelled');
    expect(provider.requests).toHaveLength(0);
    expect((await persistence.loadTask('task-immediate-stop'))?.state.lifecycle)
      .toBe('cancelled');
    const restarted = new AgentRuntime(provider, adapters, persistence);
    const restored = await restarted.restore('task-immediate-stop');
    expect(restored.state?.lifecycle).toBe('cancelled');
    expect(restored.state?.cancellation.requested).toBe(true);
    expect(restored.interrupt).toBeNull();

    const retried = await restarted.retry();
    expect(provider.requests).toHaveLength(1);
    expect(retried.state.lifecycle).toBe('waiting_for_user');
    expect(retried.interrupt).toMatchObject({
      kind: 'requirements',
      questions: [{ prompt: 'Retry reached the provider?' }],
    });
  });

  it('restarts a failed initial ingestion and retries its durable source refs before the provider', async () => {
    const manifest = manifestWithUnits(1);
    const { adapters } = fakeAdapters(manifest);
    const originalIngest = adapters.ingestion.ingest.bind(adapters.ingestion);
    let ingestionCalls = 0;
    let providerSawPreparedState = false;
    adapters.ingestion.ingest = async (attachments, context) => {
      ingestionCalls += 1;
      if (ingestionCalls === 1) throw new Error('transient PDF extractor failure');
      return originalIngest(attachments, context);
    };
    const attachment: SourceAttachmentRef = {
      kind: 'managed_asset',
      assetId: 'retry-ingestion-pdf',
      title: 'Retry ingestion.pdf',
      mediaType: 'application/pdf',
      digest: 'retry-ingestion-digest',
    };
    const provider = new ScriptedProvider([
      {
        name: 'read_full_source',
        args: { sourceId: 'source-1' },
      },
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Were the sources prepared before this question?',
        },
      },
    ]);
    const originalStream = provider.streamTurn.bind(provider);
    provider.streamTurn = async function* (request, context) {
      const restored = await persistence.loadTask('task-ingestion-retry');
      providerSawPreparedState =
        restored?.state.pendingSourceAttachments === undefined &&
        restored?.state.sourceManifest?.digest === manifest.digest &&
        restored?.state.sourceCoverage?.requiredUnitIds.includes('unit-1') === true;
      yield* originalStream(request, context);
    };
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await expect(runtime.start({
      taskId: 'task-ingestion-retry',
      threadId: 'thread-ingestion-retry',
      runId: 'run-ingestion-retry',
      bookId: 'book-1',
      goal: 'Read this PDF after a transient extractor failure.',
      attachments: [attachment],
      preserveAllSourceInformation: true,
    })).rejects.toThrow('transient PDF extractor failure');
    expect(provider.requests).toHaveLength(0);
    expect((await persistence.loadTask('task-ingestion-retry'))?.state)
      .toMatchObject({
        lifecycle: 'failed',
        pendingSourceAttachments: [attachment],
      });
    await runtime.clearActiveTask();

    const restarted = new AgentRuntime(provider, adapters, persistence);
    expect((await restarted.restore('task-ingestion-retry')).state)
      .toMatchObject({
        lifecycle: 'failed',
        pendingSourceAttachments: [attachment],
      });
    const retried = await restarted.retry();

    expect(ingestionCalls).toBe(2);
    expect(provider.requests).toHaveLength(2);
    expect(providerSawPreparedState).toBe(true);
    expect(retried.state.pendingSourceAttachments).toBeUndefined();
    expect(retried.state.sourceManifest?.digest).toBe(manifest.digest);
    expect(retried.state.sourceCoverage).toMatchObject({
      requiredUnitIds: ['unit-1'],
      readUnitIds: ['unit-1'],
      omittedUnitIds: [],
      complete: true,
    });
  });

  it('registers sources while paused and carries them into the very next resumed turn', async () => {
    const provider = new ScriptedProvider([
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Would you like to add any other evidence?',
        },
      },
      {
        name: 'read_full_source',
        args: {
          sourceId: 'source-1',
        },
      },
      {
        name: 'finish_conversation',
        args: {
          answer: 'I read the complete attached evidence and kept every source unit in scope.',
          citedUnitIds: ['unit-1'],
        },
      },
    ]);
    const { adapters, ingested } = fakeAdapters(manifestWithUnits(1));
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const first = await runtime.start({
      taskId: 'task-queued-source',
      threadId: 'thread-queued-source',
      runId: 'run-queued-source',
      bookId: 'book-1',
      goal: 'Use my evidence.',
    });
    expect(first.interrupt?.kind).toBe('requirements');
    await runtime.registerAttachments([{
      kind: 'managed_asset',
      assetId: 'queued-private-source',
      title: 'Queued source.pdf',
      mediaType: 'application/pdf',
      digest: 'queued-digest',
    }]);
    expect(ingested).toHaveLength(2);
    expect(ingested[1]).toMatchObject([{ assetId: 'queued-private-source' }]);
    const resumed = await runtime.sendUserMessage(
      "I don't want to lose any information from the attached source.",
      { preserveAllSourceInformation: true },
    );
    expect(resumed.interrupt).toBeUndefined();
    expect(resumed.state.lifecycle).toBe('completed');
    expect(provider.requests[1]?.tools.map((tool) => tool.name)).toContain(
      'read_full_source',
    );
    expect(resumed.state.sourceManifest?.digest).toBe(manifestWithUnits(1).digest);
    expect(resumed.state.taskBrief.preserveAllSourceInformation).toBe(true);
    expect(resumed.state.sourceCoverage).toMatchObject({
      mode: 'complete',
      requiredUnitIds: ['unit-1'],
      omittedUnitIds: [],
      complete: true,
    });
  });

  it('makes existing-task registration durable and Stop-settled before any provider turn', async () => {
    const provider = new ScriptedProvider([
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Do you have any more evidence to add?',
        },
      },
    ]);
    const { adapters } = fakeAdapters(manifestWithUnits(1));
    let registrationEntered!: () => void;
    const registrationStarted = new Promise<void>((resolve) => {
      registrationEntered = resolve;
    });
    const baseIngest = adapters.ingestion.ingest.bind(adapters.ingestion);
    let ingestCalls = 0;
    adapters.ingestion.ingest = async (attachments, context) => {
      ingestCalls += 1;
      if (ingestCalls === 1) return baseIngest(attachments, context);
      registrationEntered();
      await new Promise<void>((_resolve, reject) => {
        context.signal.addEventListener(
          'abort',
          () => reject(context.signal.reason),
          { once: true },
        );
      });
      return manifestWithUnits(1);
    };
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await runtime.start({
      taskId: 'task-stop-registration',
      threadId: 'thread-stop-registration',
      runId: 'run-stop-registration',
      bookId: 'book-1',
      goal: 'Pause before another upload.',
    });
    const attachment: SourceAttachmentRef = {
      kind: 'managed_asset',
      assetId: 'stop-registration-pdf',
      title: 'Stop registration.pdf',
      mediaType: 'application/pdf',
      digest: 'stop-registration-digest',
    };

    const registering = runtime.registerAttachments([attachment]);
    await registrationStarted;
    expect(runtime.getSnapshot().busy).toBe(true);
    expect((await persistence.loadTask('task-stop-registration'))?.state)
      .toMatchObject({
        phase: 'reading_sources',
        pendingSourceAttachments: [attachment],
      });
    await expect(runtime.registerAttachments([attachment])).rejects.toThrow(
      /stop or wait/i,
    );
    await runtime.stop('Notebook closed');
    await registering;

    expect(runtime.getSnapshot()).toMatchObject({
      busy: false,
      state: {
        lifecycle: 'cancelled',
        pendingSourceAttachments: [attachment],
      },
    });
    expect((await persistence.loadTask('task-stop-registration'))?.state)
      .toMatchObject({
        lifecycle: 'cancelled',
        pendingSourceAttachments: [attachment],
      });
    expect(provider.requests).toHaveLength(1);
  });

  it('re-ingests pending registration before sending one exact follow-up to the provider', async () => {
    const provider = new ScriptedProvider([
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Are you ready to add the source?',
        },
      },
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Did the recovered evidence look right?',
        },
      },
    ]);
    const manifest = manifestWithUnits(1);
    const { adapters } = fakeAdapters(manifest);
    const baseIngest = adapters.ingestion.ingest.bind(adapters.ingestion);
    let ingestCalls = 0;
    adapters.ingestion.ingest = async (attachments, context) => {
      ingestCalls += 1;
      if (ingestCalls === 2) throw new Error('temporary registration failure');
      return baseIngest(attachments, context);
    };
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await runtime.start({
      taskId: 'task-follow-up-pending-registration',
      threadId: 'thread-follow-up-pending-registration',
      runId: 'run-follow-up-pending-registration',
      bookId: 'book-1',
      goal: 'Wait for additional evidence.',
    });
    const attachment: SourceAttachmentRef = {
      kind: 'managed_asset',
      assetId: 'pending-registration-pdf',
      title: 'Pending registration.pdf',
      mediaType: 'application/pdf',
      digest: 'pending-registration-digest',
    };
    await expect(runtime.registerAttachments([attachment])).rejects.toThrow(
      'temporary registration failure',
    );
    const followUp = 'Use the newly attached evidence exactly once.';
    const result = await runtime.sendUserMessage(followUp);

    expect(ingestCalls).toBe(3);
    expect(result.state.pendingSourceAttachments).toBeUndefined();
    expect(result.state.sourceManifest?.digest).toBe(manifest.digest);
    expect(provider.requests).toHaveLength(2);
    const userTexts = provider.requests[1]!.messages.flatMap((message) =>
      message.role === 'user'
        ? message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
        : [],
    );
    expect(userTexts.filter((text) => text === followUp)).toHaveLength(1);
    expect(result.interrupt).toMatchObject({
      kind: 'requirements',
      questions: [{ prompt: 'Did the recovered evidence look right?' }],
    });
  });

  it('discards parallel sibling calls across a human interrupt before the model sees the answer', async () => {
    class InterruptSiblingProvider implements AgentProvider {
      readonly id = 'interrupt-sibling';
      readonly requests: AgentProviderTurnRequest[] = [];
      capabilities = async (): Promise<AgentProviderCapabilities> => ({
        providerId: this.id,
        modelId: this.id,
        toolUse: true,
        streaming: true,
        imageInput: false,
        maxInputTokens: 10_000,
        maxOutputTokens: 1_000,
        supportsParallelToolCalls: true,
      });
      async *streamTurn(request: AgentProviderTurnRequest): AsyncIterable<AgentProviderStreamEvent> {
        this.requests.push(request);
        if (this.requests.length === 1) {
          yield {
            type: 'tool_call',
            id: 'ask-before-answer',
            name: 'ask_user',
            arguments: {
              kind: 'requirements',
              question: 'Which direction should I take?',
            },
          };
          yield {
            type: 'tool_call',
            id: 'stale-sibling-plan',
            name: 'set_plan',
            arguments: {
              summary: 'This was authored before the answer',
              steps: [{ id: 'stale', title: 'Must never execute' }],
            },
          };
        } else {
          yield {
            type: 'tool_call',
            id: 'ask-after-answer',
            name: 'ask_user',
            arguments: {
              kind: 'requirements',
              question: 'Would you like anything else adjusted?',
            },
          };
        }
        yield { type: 'finish', reason: 'tool_calls' };
      }
    }
    const provider = new InterruptSiblingProvider();
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const waiting = await runtime.start({
      bookId: 'book-1',
      goal: 'Ask, then plan using my answer.',
    });
    expect(waiting.interrupt?.kind).toBe('requirements');
    expect(waiting.state.plan).toBeUndefined();
    expect(waiting.state.pendingToolCalls).toEqual([]);

    const resumed = await runtime.sendUserMessage('Use the playful direction.');
    expect(provider.requests).toHaveLength(2);
    expect(resumed.state.plan).toBeUndefined();
    expect(resumed.state.modelHistory.some((turn) =>
      turn.role === 'tool' && turn.toolCallId === 'stale-sibling-plan'
    )).toBe(false);
    const firstAssistant = resumed.state.modelHistory.find((turn) =>
      turn.role === 'assistant' && turn.toolCalls.some((call) => call.id === 'ask-before-answer')
    );
    expect(firstAssistant?.role === 'assistant' ? firstAssistant.toolCalls : []).toMatchObject([
      { id: 'ask-before-answer' },
    ]);
  });

  it('executes every non-interrupt parallel sibling before returning to the provider', async () => {
    const provider = new ScriptedProvider([
      {
        name: 'inspect_notebook',
        args: {},
        siblings: [{
          name: 'set_plan',
          args: {
            summary: 'Inspect and plan together',
            steps: [{ id: 'draft', title: 'Draft after inspection' }],
          },
        }],
      },
    ]);
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const result = await runtime.start({
      bookId: 'book-1',
      goal: 'Add a new notebook page; inspect my notebook and plan it in one parallel tool batch.',
    });

    expect(result.state.lifecycle).toBe('failed');
    expect(provider.requests).toHaveLength(2);
    expect(result.state.plan?.summary).toBe('Inspect and plan together');
    const secondHistory = provider.requests[1]?.messages ?? [];
    const assistantIndex = secondHistory.findIndex((message) =>
      message.role === 'assistant' && message.toolCalls?.length === 2
    );
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(secondHistory.slice(assistantIndex + 1).map((message) => message.role))
      .toEqual(['tool', 'tool']);
    expect(secondHistory.slice(assistantIndex + 1).map((message) =>
      message.role === 'tool' ? message.toolCallId : undefined
    )).toEqual(['call-1', 'call-1-sibling-1']);
  });

  it('lets the model route tools, self-review every rendered page, and returns only an approved proposal', async () => {
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      { name: 'read_full_source', args: { sourceId: 'source-1' } },
      {
        name: 'set_plan',
        args: {
          summary: 'Build and review a concise note',
          steps: [{ id: 'draft', title: 'Draft and inspect' }],
        },
      },
      { name: 'propose_insertion', args: { target: { kind: 'book_end' } } },
      {
        name: 'submit_notebook_script',
        args: {
          script: '# Reviewed notes\n\nA grounded paragraph.',
          citedUnitIds: ['unit-1'],
          reason: 'initial',
        },
      },
      { name: 'validate_notebook_script', args: {} },
      { name: 'render_draft_preview', args: {} },
      {
        // Deliberate adversarial control: naming a current-generation page is
        // not proof that its rendered pixels were ever shown to the model.
        name: 'record_visual_review',
        args: {
          generationId: 'generation-1',
          reviews: [{ pageId: 'preview-page-1', findings: [] }],
        },
      },
      {
        name: 'read_draft_preview_pages',
        args: {
          generationId: 'generation-1',
          pageIds: ['preview-page-1'],
        },
      },
      {
        name: 'record_visual_review',
        args: {
          generationId: 'generation-1',
          reviews: [{ pageId: 'preview-page-1', findings: [] }],
        },
      },
      { name: 'propose_notebook_patch', args: {} },
      {
        name: 'submit_notebook_patch',
        args: {},
        siblings: [{
          name: 'set_plan',
          args: {
            summary: 'Stale plan authored before the preview decision',
            steps: [{ id: 'stale-preview-sibling', title: 'Must never execute' }],
          },
        }],
      },
    ]);
    const { adapters, ingested } = fakeAdapters(manifestWithUnits(1));
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    const events: AgentActivityEvent[] = [];
    runtime.subscribeEvents((event) => events.push(event));

    const waiting = await runtime.start({
      taskId: 'task-1',
      threadId: 'thread-1',
      runId: 'run-1',
      bookId: 'book-1',
      goal: 'Turn my material into a notebook page.',
      creativeDirection: 'Clear study guide',
      defaultContextPolicy: 'current_page',
      attachments: [
        {
          kind: 'managed_asset',
          assetId: 'asset-1',
          title: 'Lecture PDF',
          mediaType: 'application/pdf',
          digest: 'attachment-digest',
        },
      ],
      budget: { maxProviderCalls: 16 },
    });

    expect(ingested).toHaveLength(1);
    expect(ingested[0]?.[0]?.kind).toBe('managed_asset');
    expect(waiting.interrupt?.kind).toBe('final_preview');
    expect(waiting.state.visualReview).toMatchObject({
      complete: true,
      passed: true,
      imageExposures: [
        expect.objectContaining({
          generationId: 'generation-1',
          pageId: 'preview-page-1',
          imageDigest: 'image-digest-1',
          layoutDigest: 'page-layout-1',
          readRequestedAtProviderCall: expect.any(Number),
        }),
      ],
      inspectedPageIds: ['preview-page-1'],
    });
    const visualReviewTurns = waiting.state.modelHistory.filter(
      (turn) => turn.role === 'tool' && turn.toolName === 'record_visual_review',
    );
    expect(visualReviewTurns).toHaveLength(2);
    expect(visualReviewTurns[0]).toMatchObject({
      role: 'tool',
      isError: true,
      content: {
        error: expect.stringMatching(/read_draft_preview_pages/i),
      },
    });
    expect(visualReviewTurns[1]).toMatchObject({ role: 'tool', isError: false });
    expect(waiting.state.patchProposal?.status).toBe('waiting_for_approval');
    expect(waiting.state.pendingToolCalls).toEqual([]);
    expect(waiting.state.plan?.summary).toBe('Build and review a concise note');
    expect(waiting.state.modelHistory.some((turn) =>
      turn.role === 'assistant' && turn.toolCalls.some((call) =>
        call.id.includes('sibling')
      )
    )).toBe(false);
    expect(provider.requests.map((request) => request.tools.length).every(Boolean)).toBe(true);
    expect(
      provider.requests[1]?.messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.toolCalls?.some((call) => call.id === 'call-1') === true,
      ),
    ).toBe(true);
    const firstToolNames = provider.requests[0]?.tools.map((tool) => tool.name) ?? [];
    expect(firstToolNames).toEqual(
      expect.arrayContaining([
        'inspect_notebook',
        'read_full_source',
        'search_source_index',
      ]),
    );
    expect(firstToolNames).not.toEqual(
      expect.arrayContaining([
        'render_draft_preview',
        'read_draft_preview_pages',
        'record_visual_review',
        'propose_notebook_patch',
        'submit_notebook_patch',
      ]),
    );
    const advertisedAcrossWorkflow = provider.requests.flatMap((request) =>
      request.tools.map((tool) => tool.name),
    );
    expect(advertisedAcrossWorkflow).toEqual(
      expect.arrayContaining([
        'render_draft_preview',
        'read_draft_preview_pages',
        'record_visual_review',
        'propose_notebook_patch',
        'submit_notebook_patch',
      ]),
    );
    const previewReadRequest = provider.requests.find((request) =>
      request.messages.some((message) =>
        message.content.some((part) => part.type === 'image_ref'),
      ),
    );
    expect(previewReadRequest).toBeDefined();
    const imagePurposes = provider.requests.flatMap((request) =>
      request.messages.flatMap((message) =>
        message.content
          .filter((part) => part.type === 'image_ref')
          .map((part) => part.purpose),
      ),
    );
    expect(imagePurposes).toEqual(
      expect.arrayContaining(['source_analysis', 'draft_visual_review']),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'plan.updated',
        'preview.ready',
        'preview.page_inspected',
        'approval.requested',
      ]),
    );
    expect(JSON.stringify(events)).not.toMatch(/chain.of.thought|hidden.reasoning/i);

    // “New task” detaches from the active task without deleting its durable
    // state; the task drawer can restore it later.
    await runtime.clearActiveTask();
    expect(runtime.getSnapshot().state).toBeNull();
    expect(await persistence.loadTask('task-1')).not.toBeNull();

    // A fresh runtime recovers the LangGraph interrupt from the checkpointer.
    const restored = new AgentRuntime(provider, adapters, persistence);
    await restored.restore('task-1');
    const restoredSnapshot = restored.getSnapshot();
    expect(restoredSnapshot.interrupt?.kind).toBe('final_preview');
    const previewId = restoredSnapshot.interrupt?.kind === 'final_preview'
      ? restoredSnapshot.interrupt.preview.previewId
      : '';
    const approved = await restored.approvePreview(previewId);
    expect(approved.state.patchProposal).toMatchObject({
      status: 'approved_pending_apply',
    });
    expect(approved.state.lifecycle).toBe('waiting_for_preview_decision');
    // Core returns a proposal; no notebook mutation adapter exists to call.
    expect(approved.state.patchProposal?.script).toContain('# Reviewed notes');
    // Crash/reload between approval and BookView apply retains the exact final
    // preview in a durable pending-apply state.
    await restored.clearActiveTask();
    const afterApplyCrash = new AgentRuntime(provider, adapters, persistence);
    const recovered = await afterApplyCrash.restore('task-1');
    expect(recovered.state?.patchProposal).toMatchObject({
      status: 'approved_pending_apply',
    });
    const keptPreview = await afterApplyCrash.finalizeApprovedPatch(
      approved.state.patchProposal!.patchId,
      { applied: false, message: 'target changed during apply' },
    );
    expect(keptPreview.state.patchProposal).toMatchObject({
      status: 'apply_failed',
    });
    expect(keptPreview.state.lifecycle).toBe('waiting_for_preview_decision');
    expect(keptPreview.state.lastError?.message).toContain('target changed');
    expect(keptPreview.state.lastApplyFailure).toMatchObject({
      patchId: approved.state.patchProposal!.patchId,
      previewId,
      message: 'target changed during apply',
      failedAt: NOW,
    });
    await afterApplyCrash.clearActiveTask();
    const afterFailedApplyCrash = new AgentRuntime(provider, adapters, persistence);
    const restoredFailure = await afterFailedApplyCrash.restore('task-1');
    expect(restoredFailure.state?.patchProposal).toMatchObject({ status: 'apply_failed' });
    expect(restoredFailure.state?.lastError?.message).toContain('target changed');
    const displayedConversationBeforeRefresh = restoredFailure.state?.conversation ?? [];
    const modelHistoryBeforeRefresh = restoredFailure.state?.modelHistory ?? [];
    const requestsBeforeRefresh = provider.requests.length;
    const usageBeforeRefresh = restoredFailure.state?.usage;
    const refreshed = await afterFailedApplyCrash.refreshFailedPreview();
    expect(refreshed.interrupt?.kind).toBe('final_preview');
    expect(refreshed.state.patchProposal).toMatchObject({
      status: 'waiting_for_approval',
    });
    expect(refreshed.state.conversation).toEqual(displayedConversationBeforeRefresh);
    expect(refreshed.state.conversation.filter((message) =>
      /refresh the final preview/i.test(message.text)
    )).toHaveLength(0);
    expect(refreshed.state.modelHistory).toEqual(modelHistoryBeforeRefresh);
    expect(provider.requests).toHaveLength(requestsBeforeRefresh);
    expect(refreshed.state.usage).toEqual(usageBeforeRefresh);
    expect(refreshed.state.applyRecovery).toMatchObject({
      failedPatchId: approved.state.patchProposal!.patchId,
      failedPreviewId: previewId,
      refreshedPatchId: refreshed.state.patchProposal!.patchId,
      refreshedPreviewId: refreshed.state.patchProposal!.preview.previewId,
      attempt: 1,
    });
    expect(refreshed.state.lastApplyFailure?.message).toBe('target changed during apply');

    const refreshedPreviewId = refreshed.interrupt?.kind === 'final_preview'
      ? refreshed.interrupt.preview.previewId
      : '';
    // A crash after local refresh reconstructs this replacement interrupt
    // from applyRecovery instead of restoring the stale graph proposal.
    await afterFailedApplyCrash.clearActiveTask();
    const afterRefreshCrash = new AgentRuntime(provider, adapters, persistence);
    const restoredRefresh = await afterRefreshCrash.restore('task-1');
    expect(restoredRefresh.interrupt).toMatchObject({
      kind: 'final_preview',
      preview: { previewId: refreshedPreviewId },
    });
    const conversationBeforeRecoveredApproval = restoredRefresh.state?.conversation ?? [];
    const retryPending = await afterRefreshCrash.approvePreview(refreshedPreviewId);
    expect(retryPending.state.patchProposal).toMatchObject({ status: 'approved_pending_apply' });
    expect(retryPending.state.conversation).toEqual(conversationBeforeRecoveredApproval);
    const finalized = await afterRefreshCrash.finalizeApprovedPatch(
      retryPending.state.patchProposal!.patchId,
      { applied: true },
    );
    expect(finalized.state.patchProposal).toMatchObject({ status: 'applied' });
    expect(finalized.state.lifecycle).toBe('completed');
    // Recovery clears the active error but retains the original local failure
    // for a diagnostic copied after the replacement preview succeeds.
    expect(finalized.state.lastError).toBeUndefined();
    expect(finalized.state.lastApplyFailure?.message).toBe('target changed during apply');
    await afterRefreshCrash.clearActiveTask();
    const afterAppliedCrash = new AgentRuntime(provider, adapters, persistence);
    const restoredApplied = await afterAppliedCrash.restore('task-1');
    expect(restoredApplied.state?.patchProposal).toMatchObject({ status: 'applied' });
    expect(restoredApplied.state?.lifecycle).toBe('completed');
    expect(restoredApplied.interrupt).toBeNull();
  }, 20_000);

  it('recovers the exact 48-page log shape locally, disposes before publish, and never spends provider budget', async () => {
    const failed = logShapedFailedApplyState();
    const originalPage = failed.patchProposal!.preview.pages[0]!;
    const recoveredGeneration: DraftPreviewGeneration = {
      ...failed.previewGeneration!,
      generationId: 'generation-recovered-48',
      bookSnapshotRevision: failed.notebookSnapshot!.bookRevision,
      pages: [{
        ...originalPage,
        pageId: 'generation-recovered-48:page:1',
        image: { ...originalPage.image, resourceId: 'rendered-recovered-48' },
      }],
    };
    const order: string[] = [];
    class OrderedPersistence extends InMemoryAgentPersistence {
      override async saveTask(state: AgentState): Promise<void> {
        order.push(`save:${state.patchProposal?.status ?? 'none'}`);
        await super.saveTask(state);
      }
    }
    const persistence = new OrderedPersistence();
    await persistence.saveTask(failed);
    order.length = 0;
    const provider = new ScriptedProvider([]);
    const { adapters: defaults } = fakeAdapters();
    const adapters: AgentAdapters = {
      ...defaults,
      notebook: {
        ...defaults.notebook,
        inspectNotebook: async () => ({
          title: '48-page notebook',
          snapshot: failed.notebookSnapshot!,
          pages: failed.notebookSnapshot!.pageIds.map((pageId, index) => ({
            pageId,
            ordinal: index,
            revision: failed.notebookSnapshot!.pageRevisions[pageId]!,
            estimatedTokens: 10,
          })),
        }),
      },
      sandbox: {
        validate: async (draft) => ({ ...failed.validation!, draftHash: draft.draftHash }),
        render: async () => recoveredGeneration,
        getGeneration: async () => recoveredGeneration,
        dispose: async (generationId) => {
          order.push(`dispose:${generationId}`);
        },
      },
    };
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await runtime.restore(failed.identity.taskId);
    const conversationBefore = runtime.getSnapshot().state!.conversation;
    const usageBefore = runtime.getSnapshot().state!.usage;
    const refreshed = await runtime.refreshFailedPreview();

    expect(refreshed.interrupt).toMatchObject({ kind: 'final_preview' });
    expect(refreshed.state.patchProposal).toMatchObject({
      status: 'waiting_for_approval',
      insertionTarget: failed.insertionTarget,
    });
    expect(refreshed.state.conversation).toEqual(conversationBefore);
    expect(refreshed.state.usage).toEqual(usageBefore);
    expect(provider.requests).toHaveLength(0);
    expect(order.indexOf('dispose:generation-failed-48')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('dispose:generation-failed-48')).toBeLessThan(
      order.indexOf('save:waiting_for_approval'),
    );
    expect(refreshed.state.lastApplyFailure).toEqual(failed.lastApplyFailure);

    // Reader-selected structural relocation is another one-pass local render,
    // never a return to propose_insertion or submit_notebook_script.
    const relocated = await runtime.changePlacement(
      refreshed.state.patchProposal!.preview.previewId,
      { kind: 'book_start' },
    );
    expect(relocated.interrupt).toMatchObject({ kind: 'final_preview' });
    expect(relocated.state.patchProposal?.insertionTarget).toEqual({ kind: 'book_start' });
    expect(relocated.state.applyRecovery?.attempt).toBe(2);
    expect(provider.requests).toHaveLength(0);

    const approvalConversation = relocated.state.conversation;
    const previewId = relocated.state.patchProposal!.preview.previewId;
    const firstApproval = await runtime.approvePreview(previewId);
    const secondApproval = await runtime.approvePreview(previewId);
    expect(firstApproval.state.patchProposal?.status).toBe('approved_pending_apply');
    expect(secondApproval.state.patchProposal?.status).toBe('approved_pending_apply');
    expect(secondApproval.state.conversation).toEqual(approvalConversation);
  });

  it('reaches the immutable preview in nine bounded turns without source or repair churn', async () => {
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      { name: 'propose_insertion', args: { target: { kind: 'book_end' } } },
      {
        name: 'submit_notebook_script',
        args: {
          script: [
            '# Why cats have whiskers',
            '',
            'Whiskers help cats sense nearby surfaces and changes in air movement.',
          ].join('\n'),
          citedUnitIds: [],
          reason: 'initial',
        },
      },
      { name: 'validate_notebook_script', args: {} },
      { name: 'render_draft_preview', args: {} },
      {
        name: 'read_draft_preview_pages',
        args: {
          generationId: 'generation-1',
          pageIds: ['preview-page-1'],
        },
      },
      {
        name: 'record_visual_review',
        args: {
          generationId: 'generation-1',
          reviews: [{ pageId: 'preview-page-1', findings: [] }],
        },
      },
      { name: 'propose_notebook_patch', args: {} },
      { name: 'submit_notebook_patch', args: {} },
    ]);
    const runtime = new AgentRuntime(
      provider,
      fakeAdapters().adapters,
      new InMemoryAgentPersistence(),
    );

    const waiting = await runtime.start({
      taskId: 'task-bounded-happy-path',
      threadId: 'thread-bounded-happy-path',
      runId: 'run-bounded-happy-path',
      bookId: 'book-1',
      goal: 'Add the cat-whisker explanation to my book.',
      budget: { maxProviderCalls: 10 },
    });

    expect(waiting.interrupt).toMatchObject({ kind: 'final_preview' });
    expect(waiting.state.lifecycle).toBe('waiting_for_preview_decision');
    expect(provider.requests).toHaveLength(9);
    expect(waiting.state.usage).toMatchObject({
      providerCalls: 9,
      repairPasses: 0,
    });

    const expectedRequiredActions = [
      'inspect_notebook',
      'propose_insertion',
      'submit_notebook_script',
      'validate_notebook_script',
      'render_draft_preview',
      'read_draft_preview_pages',
      'record_visual_review',
      'propose_notebook_patch',
      'submit_notebook_patch',
    ];
    for (const [index, requiredAction] of expectedRequiredActions.entries()) {
      const advertised = provider.requests[index]?.tools.map((tool) => tool.name) ?? [];
      expect(advertised, `provider turn ${index + 1}`).toContain(requiredAction);
      if (index >= 2) {
        expect(
          advertised.filter((tool) =>
            ![
              'list_source_manifest',
              'plan_source_retrieval',
              'read_source_range',
              'read_full_source',
              'search_source_index',
              'rerank_source_hits',
              'inspect_source_coverage',
            ].includes(tool)
          ),
          `provider turn ${index + 1} non-source actions`,
        ).toEqual([requiredAction]);
      }
    }
  });

  it('grandfathers the exact reviewed three-page headings-and-bullets log during receipt recovery', async () => {
    const failed = exactThreePageDiagnosticFailedApplyState();
    expect(notebookCraftDiagnostics(failed.patchProposal!.script, failed)).toEqual([
      expect.objectContaining({ code: 'craft.semantic-variety-required' }),
    ]);
    const recoveredGeneration: DraftPreviewGeneration = {
      ...failed.previewGeneration!,
      generationId: 'generation-recovered-log-three-pages',
      pages: failed.previewGeneration!.pages.map((page) => ({
        ...page,
        pageId: `generation-recovered-log-three-pages:page:${page.pageNumber}`,
        image: {
          ...page.image,
          resourceId: `rendered-recovered-log-three-pages-${page.pageNumber}`,
        },
      })),
    };
    const provider = new ScriptedProvider([]);
    const disposed: string[] = [];
    const { adapters: defaults } = fakeAdapters();
    const adapters: AgentAdapters = {
      ...defaults,
      notebook: {
        ...defaults.notebook,
        inspectNotebook: async () => ({
          title: '48-page notebook from copied diagnostic',
          snapshot: failed.notebookSnapshot!,
          pages: [],
        }),
      },
      sandbox: {
        // Native parser/schema/layout validation still runs. Only the newer
        // editorial craft floor is intentionally not retroactive here.
        validate: async (draft) => ({ ...failed.validation!, draftHash: draft.draftHash }),
        render: async () => recoveredGeneration,
        getGeneration: async () => recoveredGeneration,
        dispose: async (generationId) => { disposed.push(generationId); },
      },
    };
    const persistence = new InMemoryAgentPersistence();
    await persistence.saveTask(failed);
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await runtime.restore(failed.identity.taskId);
    const refreshed = await runtime.refreshFailedPreview();

    expect(refreshed.interrupt).toMatchObject({
      kind: 'final_preview',
      preview: { expectedPageCount: 3 },
    });
    expect(refreshed.state.patchProposal).toMatchObject({
      status: 'waiting_for_approval',
      script: failed.patchProposal!.script,
      insertionTarget: failed.patchProposal!.insertionTarget,
    });
    expect(refreshed.state.patchProposal?.preview.pages).toHaveLength(3);
    expect(provider.requests).toHaveLength(0);
    expect(disposed).toEqual([failed.previewGeneration!.generationId]);
    expect(refreshed.state.lastApplyFailure).toEqual(failed.lastApplyFailure);
  });

  it('refreshes a Text Veil final while preserving its masked review generation', async () => {
    const failed = textVeiledFailedApplyState();
    const exactPage = failed.patchProposal!.preview.pages[0]!;
    const recoveredGeneration: DraftPreviewGeneration = {
      ...failed.localRestoredFinal!.previewGeneration,
      generationId: 'generation-recovered-private-exact',
      pages: [{
        ...exactPage,
        pageId: 'generation-recovered-private-exact:page:1',
        image: { ...exactPage.image, resourceId: 'rendered-recovered-private-exact' },
      }],
    };
    const disposed: string[] = [];
    const provider = new ScriptedProvider([]);
    const { adapters: defaults } = fakeAdapters();
    const adapters: AgentAdapters = {
      ...defaults,
      notebook: {
        ...defaults.notebook,
        inspectNotebook: async () => ({
          title: '48-page private notebook',
          snapshot: failed.notebookSnapshot!,
          pages: [],
        }),
      },
      sandbox: {
        validate: async (draft) => ({
          ...failed.localRestoredFinal!.validation,
          draftHash: draft.draftHash,
        }),
        render: async () => recoveredGeneration,
        getGeneration: async () => recoveredGeneration,
        dispose: async (generationId) => { disposed.push(generationId); },
      },
    };
    const persistence = new InMemoryAgentPersistence();
    await persistence.saveTask(failed);
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await runtime.restore(failed.identity.taskId);
    const refreshed = await runtime.refreshFailedPreview();

    expect(refreshed.interrupt).toMatchObject({ kind: 'final_preview' });
    expect(refreshed.state.patchProposal?.preview).toMatchObject({
      generationId: recoveredGeneration.generationId,
      visualReview: {
        generationId: failed.previewGeneration!.generationId,
        requiredPageIds: failed.previewGeneration!.pages.map((page) => page.pageId),
      },
    });
    expect(refreshed.state.visualReview).toEqual(failed.visualReview);
    expect(refreshed.state.previewGeneration?.generationId).toBe(
      failed.previewGeneration!.generationId,
    );
    expect(refreshed.state.localRestoredFinal?.previewGeneration.generationId).toBe(
      recoveredGeneration.generationId,
    );
    expect(disposed).toContain(failed.localRestoredFinal!.previewGeneration.generationId);
    expect(disposed).not.toContain(failed.previewGeneration!.generationId);
    expect(provider.requests).toHaveLength(0);
  });

  it('fails closed when a Text Veil preview forges the masked review generation', async () => {
    const failed = textVeiledFailedApplyState({
      forgePreviewReviewGeneration: true,
    });
    const exactPage = failed.patchProposal!.preview.pages[0]!;
    const forgedRecovery: DraftPreviewGeneration = {
      ...failed.localRestoredFinal!.previewGeneration,
      generationId: 'generation-forged-private-recovery',
      pages: [{
        ...exactPage,
        pageId: 'generation-forged-private-recovery:page:1',
        image: { ...exactPage.image, resourceId: 'rendered-forged-private-recovery' },
      }],
    };
    const disposed: string[] = [];
    const provider = new ScriptedProvider([]);
    const { adapters: defaults } = fakeAdapters();
    const adapters: AgentAdapters = {
      ...defaults,
      notebook: {
        ...defaults.notebook,
        inspectNotebook: async () => ({
          title: '48-page private notebook',
          snapshot: failed.notebookSnapshot!,
          pages: [],
        }),
      },
      sandbox: {
        validate: async (draft) => ({
          ...failed.localRestoredFinal!.validation,
          draftHash: draft.draftHash,
        }),
        render: async () => forgedRecovery,
        getGeneration: async () => forgedRecovery,
        dispose: async (generationId) => { disposed.push(generationId); },
      },
    };
    const persistence = new InMemoryAgentPersistence();
    await persistence.saveTask(failed);
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await runtime.restore(failed.identity.taskId);
    const refused = await runtime.refreshFailedPreview();

    expect(refused.state.patchProposal?.status).toBe('apply_failed');
    expect(refused.state.lastError?.message).toMatch(/private-text preview/i);
    expect(disposed).toEqual([forgedRecovery.generationId]);
    expect(refused.state.lastApplyFailure).toEqual(failed.lastApplyFailure);
    expect(provider.requests).toHaveLength(0);
  });

  it('keeps private-preview repair durable across provider checkpoints and unchanged drafts', async () => {
    const sourceManifest = manifestWithUnits(1);
    const sourceCoverage = recordSourceReads(
      createSourceCoverageLedger(sourceManifest, 'relevant', NOW),
      sourceManifest,
      [{
        sourceId: 'source-1',
        sourceDigest: 'source-digest-1',
        units: [{
          unitId: 'unit-1',
          anchor: sourceManifest.sources[0]!.units[0]!.anchor,
          text: 'Reader evidence.',
          digest: 'unit-digest-1',
        }],
        truncated: false,
      }],
      NOW,
      0,
    );
    const veiled = textVeiledFailedApplyState();
    const state: AgentState = {
      ...veiled,
      lifecycle: 'running',
      phase: 'reviewing_preview',
      sourceManifest,
      sourceCoverage,
      draft: {
        ...veiled.draft!,
        sourceManifestDigest: sourceManifest.digest,
        sourceReadUnitIds: ['unit-1'],
      },
      localRestoredFinal: undefined,
      patchProposal: undefined,
      applyRecovery: undefined,
      lastError: undefined,
      lastApplyFailure: undefined,
      usage: { ...veiled.usage, providerCalls: 2 },
    };
    const { adapters: defaults } = fakeAdapters(sourceManifest);
    const adapters: AgentAdapters = {
      ...defaults,
      hash: {
        ...defaults.hash,
        digestText: async (text) =>
          text === state.draft!.script ? state.draft!.draftHash : `restored:${text.length}`,
      },
      notebook: {
        ...defaults.notebook,
        inspectNotebook: async () => ({
          title: '48-page private notebook',
          snapshot: state.notebookSnapshot!,
          pages: [],
        }),
      },
      sources: {
        ...defaults.sources,
        getManifest: async () => sourceManifest,
      },
      sandbox: {
        ...defaults.sandbox,
        validate: async (draft) => ({
          draftHash: draft.draftHash,
          parserDiagnostics: [],
          staticDiagnostics: [{
            severity: 'error',
            code: 'test.private-restored-layout',
            message: 'Restored text changes the fixed-page structure.',
          }],
          imageDiagnostics: [],
          pageLedgerDiagnostics: [],
          valid: false,
          checkedAt: NOW,
        }),
      },
    };
    const tools = new AgentToolCatalog(
      adapters,
      new AgentEventBus(state.identity, new InMemoryAgentPersistence(), () => NOW),
    );
    const failed = await tools.execute(state, {
      id: 'private-proposal-fails',
      name: 'propose_notebook_patch',
      arguments: {},
    }, new AbortController().signal);

    expect(failed.result).toMatchObject({
      recovered: true,
      nextAction: expect.stringMatching(/revise the Notebook Script/i),
    });
    expect(failed.state.proposalRecovery).toMatchObject({
      kind: 'private_restore',
      draftHash: state.draft!.draftHash,
    });
    expect([...availableAgentToolNames({
      ...failed.state,
      // Provider checkpoints deliberately clear this transient field.
      lastError: undefined,
    })]).toEqual(['submit_notebook_script']);

    const unchanged = await tools.execute({
      ...failed.state,
      lastError: undefined,
    }, {
      id: 'private-unchanged-repair',
      name: 'submit_notebook_script',
      arguments: {
        script: state.draft!.script,
        citedUnitIds: [],
        reason: 'repair',
      },
    }, new AbortController().signal);
    expect(unchanged.result).toMatchObject({ doNotRepeat: true });
    expect(unchanged.state.proposalRecovery).toEqual(failed.state.proposalRecovery);
    expect([...availableAgentToolNames({
      ...unchanged.state,
      lastError: undefined,
    })]).toEqual(['submit_notebook_script']);

    const citationOnly = await tools.execute({
      ...failed.state,
      lastError: undefined,
    }, {
      id: 'private-citation-only-repair',
      name: 'submit_notebook_script',
      arguments: {
        script: state.draft!.script,
        citedUnitIds: ['unit-1'],
        reason: 'repair',
      },
    }, new AbortController().signal);
    expect(citationOnly.result).not.toMatchObject({ error: expect.anything() });
    expect(citationOnly.state.proposalRecovery).toEqual(failed.state.proposalRecovery);
    expect([...availableAgentToolNames({
      ...citationOnly.state,
      lastError: undefined,
    })]).toEqual(['submit_notebook_script']);
  });

  it('fails closed and disposes a new render when prior visual exposure cannot map', async () => {
    const failed = logShapedFailedApplyState({ omitExposure: true });
    const originalPage = failed.patchProposal!.preview.pages[0]!;
    const newGeneration: DraftPreviewGeneration = {
      ...failed.previewGeneration!,
      generationId: 'generation-unreviewed-recovery',
      pages: [{
        ...originalPage,
        pageId: 'generation-unreviewed-recovery:page:1',
        image: { ...originalPage.image, resourceId: 'rendered-unreviewed-recovery' },
      }],
    };
    const disposed: string[] = [];
    const provider = new ScriptedProvider([]);
    const { adapters: defaults } = fakeAdapters();
    const adapters: AgentAdapters = {
      ...defaults,
      notebook: {
        ...defaults.notebook,
        inspectNotebook: async () => ({
          title: '48-page notebook',
          snapshot: failed.notebookSnapshot!,
          pages: [],
        }),
      },
      sandbox: {
        validate: async (draft) => ({ ...failed.validation!, draftHash: draft.draftHash }),
        render: async () => newGeneration,
        getGeneration: async () => newGeneration,
        dispose: async (generationId) => { disposed.push(generationId); },
      },
    };
    const persistence = new InMemoryAgentPersistence();
    await persistence.saveTask(failed);
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await runtime.restore(failed.identity.taskId);
    const result = await runtime.refreshFailedPreview();

    expect(result.state.patchProposal?.status).toBe('apply_failed');
    expect(result.state.lastError?.message).toMatch(/exact preview generation/i);
    expect(result.state.lastApplyFailure).toEqual(failed.lastApplyFailure);
    expect(disposed).toEqual(['generation-unreviewed-recovery']);
    expect(provider.requests).toHaveLength(0);
  });

  it('disposes a pixel-mismatched recovery and permits one clean local retry', async () => {
    const failed = logShapedFailedApplyState();
    const originalPage = failed.patchProposal!.preview.pages[0]!;
    let mismatch = true;
    let renderAttempt = 0;
    const disposed: string[] = [];
    const provider = new ScriptedProvider([]);
    const { adapters: defaults } = fakeAdapters();
    const adapters: AgentAdapters = {
      ...defaults,
      notebook: {
        ...defaults.notebook,
        inspectNotebook: async () => ({
          title: '48-page notebook',
          snapshot: failed.notebookSnapshot!,
          pages: [],
        }),
      },
      sandbox: {
        validate: async (draft) => ({ ...failed.validation!, draftHash: draft.draftHash }),
        render: async () => {
          renderAttempt += 1;
          return {
            ...failed.previewGeneration!,
            generationId: `generation-pixel-retry-${renderAttempt}`,
            pages: [{
              ...originalPage,
              pageId: `generation-pixel-retry-${renderAttempt}:page:1`,
              image: {
                ...originalPage.image,
                resourceId: `rendered-pixel-retry-${renderAttempt}`,
                digest: mismatch ? 'different-png-digest' : originalPage.image.digest,
              },
            }],
          };
        },
        getGeneration: async () => null,
        dispose: async (generationId) => { disposed.push(generationId); },
      },
    };
    const persistence = new InMemoryAgentPersistence();
    await persistence.saveTask(failed);
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await runtime.restore(failed.identity.taskId);

    const refused = await runtime.refreshFailedPreview();
    expect(refused.state.patchProposal?.status).toBe('apply_failed');
    expect(refused.state.lastError?.message).toMatch(/changed the reviewed pixels/i);
    expect(disposed).toEqual(['generation-pixel-retry-1']);
    expect(refused.state.lastApplyFailure).toEqual(failed.lastApplyFailure);
    expect(provider.requests).toHaveLength(0);

    mismatch = false;
    const retried = await runtime.refreshFailedPreview();
    expect(retried.interrupt).toMatchObject({ kind: 'final_preview' });
    expect(retried.state.patchProposal?.status).toBe('waiting_for_approval');
    expect(disposed).toEqual([
      'generation-pixel-retry-1',
      'generation-failed-48',
    ]);
    expect(provider.requests).toHaveLength(0);
  });

  it('handles recovered reject and feedback outside the stale graph interrupt', async () => {
    const recoveredState = (): AgentState => {
      const failed = logShapedFailedApplyState();
      const proposal = {
        ...failed.patchProposal!,
        status: 'waiting_for_approval' as const,
      };
      return {
        ...failed,
        patchProposal: proposal,
        lastError: undefined,
        applyRecovery: {
          failedPatchId: 'earlier-failed-patch',
          failedPreviewId: 'earlier-failed-preview',
          refreshedPatchId: proposal.patchId,
          refreshedPreviewId: proposal.preview.previewId,
          attempt: 1,
          recoveredAt: NOW,
        },
      };
    };

    const rejectedState = recoveredState();
    const rejectedDisposed: string[] = [];
    const rejectProvider = new ScriptedProvider([]);
    const { adapters: rejectDefaults } = fakeAdapters();
    const rejectPersistence = new InMemoryAgentPersistence();
    await rejectPersistence.saveTask(rejectedState);
    const rejectRuntime = new AgentRuntime(rejectProvider, {
      ...rejectDefaults,
      sandbox: {
        ...rejectDefaults.sandbox,
        dispose: async (generationId) => { rejectedDisposed.push(generationId); },
      },
    }, rejectPersistence);
    const restoredReject = await rejectRuntime.restore(rejectedState.identity.taskId);
    expect(restoredReject.interrupt).toMatchObject({ kind: 'final_preview' });
    const rejected = await rejectRuntime.rejectPreview(
      rejectedState.patchProposal!.preview.previewId,
    );
    expect(rejected.state.lifecycle).toBe('completed');
    expect(rejected.state.patchProposal?.status).toBe('rejected');
    expect(rejected.state.applyRecovery).toBeUndefined();
    expect(rejectedDisposed).toContain('generation-failed-48');
    expect(rejectProvider.requests).toHaveLength(0);

    const feedbackState = recoveredState();
    const feedbackProvider = new ScriptedProvider([{
      name: 'ask_user',
      args: {
        kind: 'requirements',
        question: 'Should the refreshed headings feel warmer throughout?',
      },
    }]);
    const { adapters: feedbackAdapters } = fakeAdapters();
    const feedbackPersistence = new InMemoryAgentPersistence();
    await feedbackPersistence.saveTask(feedbackState);
    const feedbackRuntime = new AgentRuntime(
      feedbackProvider,
      feedbackAdapters,
      feedbackPersistence,
    );
    await feedbackRuntime.restore(feedbackState.identity.taskId);
    const feedback = await feedbackRuntime.sendUserMessage('Make the headings warmer.');
    expect(feedback.interrupt).toMatchObject({ kind: 'requirements' });
    expect(feedback.state.applyRecovery).toBeUndefined();
    expect(feedback.state.conversation.filter((message) =>
      message.role === 'user' && message.text === 'Make the headings warmer.'
    )).toHaveLength(1);
    expect(feedbackProvider.requests).toHaveLength(1);
    expect(JSON.stringify(feedbackProvider.requests[0]?.messages)).not.toMatch(
      /Refresh the final preview against the notebook/i,
    );
  });

  it('settles a deferred local Refresh before Stop resolves and never resurrects its captured failed state', async () => {
    const failed = logShapedFailedApplyState();
    const originalPage = failed.patchProposal!.preview.pages[0]!;
    const deferredGeneration: DraftPreviewGeneration = {
      ...failed.previewGeneration!,
      generationId: 'generation-deferred-refresh-stop',
      pages: [{
        ...originalPage,
        pageId: 'generation-deferred-refresh-stop:page:1',
        image: {
          ...originalPage.image,
          resourceId: 'rendered-deferred-refresh-stop',
        },
      }],
    };
    let markRenderStarted!: () => void;
    const renderStarted = new Promise<void>((resolve) => {
      markRenderStarted = resolve;
    });
    let releaseRender!: (generation: DraftPreviewGeneration) => void;
    const renderGate = new Promise<DraftPreviewGeneration>((resolve) => {
      releaseRender = resolve;
    });
    let markCancellationSaved!: () => void;
    const cancellationSaved = new Promise<void>((resolve) => {
      markCancellationSaved = resolve;
    });
    const saves: Array<{
      readonly lifecycle: AgentState['lifecycle'];
      readonly proposalStatus: string | undefined;
      readonly errorCode: string | undefined;
    }> = [];
    let cancellationSaveWitnessed = false;
    class RecordingPersistence extends InMemoryAgentPersistence {
      override async saveTask(state: AgentState): Promise<void> {
        saves.push({
          lifecycle: state.lifecycle,
          proposalStatus: state.patchProposal?.status,
          errorCode: state.lastError?.code,
        });
        await super.saveTask(state);
        if (state.lifecycle === 'cancelled' && !cancellationSaveWitnessed) {
          cancellationSaveWitnessed = true;
          markCancellationSaved();
        }
      }
    }
    const persistence = new RecordingPersistence();
    await persistence.saveTask(failed);
    saves.length = 0;
    const disposed: string[] = [];
    const provider = new ScriptedProvider([]);
    const { adapters: defaults } = fakeAdapters();
    const adapters: AgentAdapters = {
      ...defaults,
      notebook: {
        ...defaults.notebook,
        inspectNotebook: async () => ({
          title: '48-page notebook',
          snapshot: failed.notebookSnapshot!,
          pages: [],
        }),
      },
      sandbox: {
        validate: async (draft) => ({ ...failed.validation!, draftHash: draft.draftHash }),
        // Deliberately ignores AbortSignal to witness Stop's settlement
        // barrier rather than merely testing cooperative cancellation.
        render: async () => {
          markRenderStarted();
          return renderGate;
        },
        getGeneration: async () => deferredGeneration,
        dispose: async (generationId) => { disposed.push(generationId); },
      },
    };
    const runtime = new AgentRuntime(provider, adapters, persistence);
    await runtime.restore(failed.identity.taskId);

    const refreshing = runtime.refreshFailedPreview();
    await renderStarted;
    let stopResolved = false;
    const stopping = runtime.stop('Reader stopped a local preview refresh')
      .then(() => { stopResolved = true; });
    await cancellationSaved;
    // Give an implementation with no Refresh settlement barrier a full turn
    // to resolve Stop; the deliberately uncooperative render is still gated.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stopResolved).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({
      busy: true,
      state: {
        lifecycle: 'cancelled',
        cancellation: { requested: true },
        lastError: { code: 'cancelled' },
      },
    });

    releaseRender(deferredGeneration);
    const [refreshResult] = await Promise.all([refreshing, stopping]);
    expect(stopResolved).toBe(true);
    expect(refreshResult.state.lifecycle).toBe('cancelled');
    expect(runtime.getSnapshot()).toMatchObject({
      busy: false,
      interrupt: null,
      state: {
        lifecycle: 'cancelled',
        lastError: { code: 'cancelled' },
      },
    });
    expect((await persistence.loadTask(failed.identity.taskId))?.state).toMatchObject({
      lifecycle: 'cancelled',
      cancellation: { requested: true },
      lastError: { code: 'cancelled' },
    });
    const firstCancelledSave = saves.findIndex((save) => save.lifecycle === 'cancelled');
    expect(firstCancelledSave).toBeGreaterThanOrEqual(0);
    expect(saves.slice(firstCancelledSave).every((save) =>
      save.lifecycle === 'cancelled' &&
      save.proposalStatus === 'apply_failed' &&
      save.errorCode === 'cancelled'
    )).toBe(true);
    expect(disposed).toContain(deferredGeneration.generationId);
    expect(provider.requests).toHaveLength(0);
  });

  it('aborts a live provider stream and keeps the last safe state for retry', async () => {
    class BlockingProvider implements AgentProvider {
      readonly id = 'blocking';
      capabilities = async (): Promise<AgentProviderCapabilities> => ({
        providerId: 'blocking',
        modelId: 'blocking',
        toolUse: true,
        streaming: true,
        imageInput: false,
        maxInputTokens: 10_000,
        maxOutputTokens: 1_000,
        supportsParallelToolCalls: false,
      });

      async *streamTurn(
        _request: AgentProviderTurnRequest,
        context: { signal: AbortSignal },
      ): AsyncIterable<AgentProviderStreamEvent> {
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(context.signal.reason),
            { once: true },
          );
        });
      }
    }

    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(
      new BlockingProvider(),
      adapters,
      new InMemoryAgentPersistence(),
    );
    const running = runtime.start({
      bookId: 'book-1',
      goal: 'Wait for a provider result.',
    });
    for (let attempt = 0; attempt < 30 && !runtime.getSnapshot().busy; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await runtime.stop('Reader pressed Stop');
    const result = await running;
    expect(result.state.lifecycle).toBe('cancelled');
    expect(result.state.cancellation).toMatchObject({
      requested: true,
      reason: 'Reader pressed Stop',
    });
  });

  it('restarts a stopped checkpoint as runnable state and reaches the provider on Retry', async () => {
    let firstProviderEntered!: () => void;
    const firstProviderStarted = new Promise<void>((resolve) => {
      firstProviderEntered = resolve;
    });
    class RetryAfterRestartProvider implements AgentProvider {
      readonly id = 'retry-after-restart';
      calls = 0;

      capabilities = async (): Promise<AgentProviderCapabilities> => ({
        providerId: this.id,
        modelId: this.id,
        toolUse: true,
        streaming: true,
        imageInput: false,
        maxInputTokens: 10_000,
        maxOutputTokens: 1_000,
        supportsParallelToolCalls: false,
      });

      async *streamTurn(
        _request: AgentProviderTurnRequest,
        context: { signal: AbortSignal },
      ): AsyncIterable<AgentProviderStreamEvent> {
        this.calls += 1;
        if (this.calls === 1) {
          firstProviderEntered();
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => reject(context.signal.reason),
              { once: true },
            );
          });
          return;
        }
        yield {
          type: 'tool_call',
          id: 'retry-requirements',
          name: 'ask_user',
          arguments: {
            kind: 'requirements',
            question: 'Did the restored retry reach the provider?',
          },
        };
        yield { type: 'finish', reason: 'tool_calls' };
      }
    }

    const provider = new RetryAfterRestartProvider();
    const { adapters } = fakeAdapters();
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    const running = runtime.start({
      taskId: 'task-stopped-checkpoint-retry',
      threadId: 'thread-stopped-checkpoint-retry',
      runId: 'run-stopped-checkpoint-retry',
      bookId: 'book-1',
      goal: 'Stop after graph checkpoint, then retry after restart.',
    });
    await firstProviderStarted;
    await runtime.stop('Stop after checkpoint');
    expect((await running).state.lifecycle).toBe('cancelled');
    await runtime.clearActiveTask();

    const restarted = new AgentRuntime(provider, adapters, persistence);
    const restored = await restarted.restore('task-stopped-checkpoint-retry');
    expect(restored.state?.lifecycle).toBe('cancelled');
    const retried = await restarted.retry();

    expect(provider.calls).toBe(2);
    expect(retried.state.lifecycle).toBe('waiting_for_user');
    expect(retried.interrupt).toMatchObject({
      kind: 'requirements',
      questions: [{ prompt: 'Did the restored retry reach the provider?' }],
    });
  });

  it('durably preserves a follow-up after Stop and reaches the provider with cancellation cleared', async () => {
    let firstProviderEntered!: () => void;
    const firstProviderStarted = new Promise<void>((resolve) => {
      firstProviderEntered = resolve;
    });
    class FollowUpAfterStopProvider implements AgentProvider {
      readonly id = 'follow-up-after-stop';
      readonly requests: AgentProviderTurnRequest[] = [];

      capabilities = async (): Promise<AgentProviderCapabilities> => ({
        providerId: this.id,
        modelId: this.id,
        toolUse: true,
        streaming: true,
        imageInput: false,
        maxInputTokens: 10_000,
        maxOutputTokens: 1_000,
        supportsParallelToolCalls: false,
      });

      async *streamTurn(
        request: AgentProviderTurnRequest,
        context: { signal: AbortSignal },
      ): AsyncIterable<AgentProviderStreamEvent> {
        this.requests.push(request);
        if (this.requests.length === 1) {
          firstProviderEntered();
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => reject(context.signal.reason),
              { once: true },
            );
          });
          return;
        }
        yield {
          type: 'tool_call',
          id: 'follow-up-received',
          name: 'ask_user',
          arguments: {
            kind: 'requirements',
            question: 'Did the follow-up reach the provider?',
          },
        };
        yield { type: 'finish', reason: 'tool_calls' };
      }
    }

    const provider = new FollowUpAfterStopProvider();
    const { adapters } = fakeAdapters();
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    const running = runtime.start({
      taskId: 'task-follow-up-after-stop',
      threadId: 'thread-follow-up-after-stop',
      runId: 'run-follow-up-after-stop',
      bookId: 'book-1',
      goal: 'Begin the original notebook task.',
    });
    await firstProviderStarted;
    await runtime.stop('Reader pressed Stop');
    expect((await running).state.lifecycle).toBe('cancelled');
    await runtime.clearActiveTask();

    const restarted = new AgentRuntime(provider, adapters, persistence);
    expect((await restarted.restore('task-follow-up-after-stop')).state).toMatchObject({
      lifecycle: 'cancelled',
      cancellation: { requested: true },
    });
    const followUp = 'Continue, but make the examples more playful.';
    const continued = await restarted.sendUserMessage(followUp);

    expect(provider.requests).toHaveLength(2);
    const userTexts = provider.requests[1]!.messages.flatMap((message) =>
      message.role === 'user'
        ? message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
        : [],
    );
    expect(userTexts.filter((text) => text === followUp)).toHaveLength(1);
    expect(continued.state).toMatchObject({
      lifecycle: 'waiting_for_user',
      cancellation: { requested: false },
    });
    expect(continued.state.pendingUserTurns).toBeUndefined();
    expect(continued.interrupt).toMatchObject({
      kind: 'requirements',
      questions: [{ prompt: 'Did the follow-up reach the provider?' }],
    });

    const durable = await persistence.loadTask('task-follow-up-after-stop');
    expect(durable?.state.cancellation.requested).toBe(false);
    expect(durable?.state.conversation.filter((message) => message.text === followUp))
      .toHaveLength(1);
    const followUpEvents = (await persistence.listEvents('task-follow-up-after-stop'))
      .filter((event) => event.type === 'user.message' && event.message.text === followUp);
    expect(followUpEvents).toHaveLength(1);
  });

  it('awaits late provider settlement and tombstones a deleted task against resurrection', async () => {
    let releaseLate!: () => void;
    const entered = new Promise<void>((resolve) => { releaseLate = resolve; });
    let providerEntered!: () => void;
    const providerStarted = new Promise<void>((resolve) => { providerEntered = resolve; });
    class LateProvider implements AgentProvider {
      readonly id = 'late';
      capabilities = async (): Promise<AgentProviderCapabilities> => ({
        providerId: 'late',
        modelId: 'late',
        toolUse: true,
        streaming: true,
        imageInput: false,
        maxInputTokens: 10_000,
        maxOutputTokens: 1_000,
        supportsParallelToolCalls: false,
      });
      async *streamTurn(): AsyncIterable<AgentProviderStreamEvent> {
        providerEntered();
        await entered;
        yield { type: 'tool_call', id: 'late-call', name: 'inspect_notebook', arguments: {} };
        yield { type: 'finish', reason: 'tool_calls' };
      }
    }
    const { adapters } = fakeAdapters();
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(new LateProvider(), adapters, persistence);
    const running = runtime.start({
      taskId: 'task-late-delete',
      threadId: 'thread-late-delete',
      runId: 'run-late-delete',
      bookId: 'book-1',
      goal: 'Wait for a late result.',
    });
    await providerStarted;
    const deleting = runtime.deleteTask('task-late-delete');
    let deletionSettled = false;
    void deleting.then(() => { deletionSettled = true; });
    await Promise.resolve();
    expect(deletionSettled).toBe(false);
    releaseLate();
    await deleting;
    await running;
    expect(runtime.getSnapshot().state).toBeNull();
    expect(await persistence.loadTask('task-late-delete')).toBeNull();
    expect(await persistence.listEvents('task-late-delete')).toEqual([]);
  });

  it('refuses a selection rewrite when the page changed before handoff', async () => {
    const provider = new ScriptedProvider([]);
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(
      provider,
      adapters,
      new InMemoryAgentPersistence(),
    );

    await expect(runtime.requestSelectionRewrite({
      bookId: 'book-1',
      pageId: 'page-1',
      from: 1,
      to: 5,
      pageRevision: 'an-older-document',
      prompt: 'Make this clearer',
      selectedText: 'Text',
    })).rejects.toThrow('selected page changed');
    expect(provider.requests).toHaveLength(0);
    expect(runtime.getSnapshot().state).toBeNull();
  });

  it('stops a semantically identical invalid-draft replay despite reason churn', async () => {
    const script = '# Cats\n\nCats use their whiskers to sense nearby surfaces.';
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      { name: 'propose_insertion', args: { target: { kind: 'book_end' } } },
      {
        name: 'submit_notebook_script',
        args: { script, citedUnitIds: [], reason: 'initial' },
      },
      { name: 'validate_notebook_script', args: {} },
      {
        name: 'submit_notebook_script',
        args: { script, citedUnitIds: [], reason: 'initial' },
      },
      {
        name: 'submit_notebook_script',
        args: { script, citedUnitIds: [], reason: 'repair' },
      },
      {
        name: 'submit_notebook_script',
        args: { script, citedUnitIds: [], reason: 'repair' },
      },
    ]);
    const base = fakeAdapters().adapters;
    const adapters: AgentAdapters = {
      ...base,
      sandbox: {
        ...base.sandbox,
        validate: async (draft) => ({
          draftHash: draft.draftHash,
          parserDiagnostics: [],
          staticDiagnostics: [{
            severity: 'error',
            code: 'test.invalid-draft-for-watchdog',
            message: 'Add one meaning-bearing native structure.',
          }],
          imageDiagnostics: [],
          pageLedgerDiagnostics: [],
          valid: false,
          checkedAt: NOW,
        }),
      },
    };
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters, persistence);
    const result = await runtime.start({
      taskId: 'task-no-progress-watchdog',
      threadId: 'thread-no-progress-watchdog',
      runId: 'run-no-progress-watchdog',
      bookId: 'book-1',
      goal: 'Add this cat explanation to my book.',
      budget: { maxProviderCalls: 24 },
    });

    expect(provider.requests).toHaveLength(7);
    expect(result.state).toMatchObject({
      lifecycle: 'failed',
      lastError: {
        code: 'agent_stalled',
        retryable: true,
      },
      usage: {
        providerCalls: 7,
        toolCalls: 5,
        repairPasses: 0,
      },
      draft: { version: 1 },
    });
    const repeatedResults = result.state.modelHistory.filter(
      (turn): turn is Extract<AgentState['modelHistory'][number], { role: 'tool' }> =>
        turn.role === 'tool' && turn.toolName === 'submit_notebook_script',
    );
    expect(repeatedResults).toHaveLength(4);
    expect(repeatedResults.at(-2)?.content).toMatchObject({
      retryable: true,
      doNotRepeat: true,
      watchdog: 'no_progress_warning',
      nextAction: expect.stringContaining('Revise the Notebook Script materially'),
    });
    expect(repeatedResults.at(-1)?.content).toMatchObject({
      retryable: true,
      doNotRepeat: true,
      watchdog: 'agent_stalled',
    });
    expect((await persistence.listEvents('task-no-progress-watchdog')).filter(
      (event) => event.type === 'run.failed',
    )).toHaveLength(1);
  });

  it('stalls whitespace-only invalid-draft churn before the full provider budget', async () => {
    const script = '# Cats\n\nCats use their whiskers to sense nearby surfaces.';
    const whitespaceVariants = [
      '# Cats  \n\nCats use their whiskers to sense nearby surfaces.\t',
      '\n# Cats\n\n\nCats use their whiskers to sense nearby surfaces.\n\n',
      '# Cats\r\n\r\nCats use their whiskers to sense nearby surfaces.',
      '# Cats\n \n\t\nCats use their whiskers to sense nearby surfaces.',
      '# Cats\t\n\nCats use their whiskers to sense nearby surfaces. ',
      '\n\n# Cats\n\nCats use their whiskers to sense nearby surfaces.\n',
      '# Cats \r\n\r\n\r\nCats use their whiskers to sense nearby surfaces.\t',
    ];
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      { name: 'propose_insertion', args: { target: { kind: 'book_end' } } },
      {
        name: 'submit_notebook_script',
        args: { script, citedUnitIds: [], reason: 'initial' },
      },
      { name: 'validate_notebook_script', args: {} },
      ...whitespaceVariants.flatMap((variant) => ([
        {
          name: 'submit_notebook_script',
          args: { script: variant, citedUnitIds: [], reason: 'repair' },
        },
        { name: 'validate_notebook_script', args: {} },
      ])),
    ]);
    const base = fakeAdapters().adapters;
    const adapters: AgentAdapters = {
      ...base,
      sandbox: {
        ...base.sandbox,
        validate: async (draft) => ({
          draftHash: draft.draftHash,
          parserDiagnostics: [],
          staticDiagnostics: [{
            severity: 'error',
            code: 'test.invalid-whitespace-churn',
            message: 'Whitespace does not address the missing native structure.',
          }],
          imageDiagnostics: [],
          pageLedgerDiagnostics: [],
          valid: false,
          checkedAt: NOW,
        }),
      },
    };
    const persistence = new InMemoryAgentPersistence();
    const result = await new AgentRuntime(
      provider,
      adapters,
      persistence,
    ).start({
      taskId: 'task-whitespace-watchdog',
      threadId: 'thread-whitespace-watchdog',
      runId: 'run-whitespace-watchdog',
      bookId: 'book-1',
      goal: 'Add this cat explanation to my book.',
      budget: { maxProviderCalls: 24 },
    });

    expect(provider.requests.length).toBeLessThan(24);
    expect(result.state).toMatchObject({
      lifecycle: 'failed',
      lastError: { code: 'agent_stalled' },
    });
    expect(result.state.usage.repairPasses).toBeLessThanOrEqual(4);
    expect((await persistence.listEvents('task-whitespace-watchdog')).filter(
      (event) => event.type === 'run.failed',
    )).toHaveLength(1);
  });

  it('treats a blank-line change inside a fenced code body as material', async () => {
    const firstScript = [
      '# Greeting code',
      '',
      '```python',
      'def greet():',
      '    return "hello"',
      '```',
    ].join('\n');
    const changedScript = [
      '# Greeting code',
      '',
      '```python',
      'def greet():',
      '',
      '    return "hello"',
      '```',
    ].join('\n');
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      { name: 'propose_insertion', args: { target: { kind: 'book_end' } } },
      {
        name: 'submit_notebook_script',
        args: { script: firstScript, citedUnitIds: [], reason: 'initial' },
      },
      { name: 'validate_notebook_script', args: {} },
      {
        name: 'submit_notebook_script',
        args: { script: changedScript, citedUnitIds: [], reason: 'repair' },
      },
    ]);
    const base = fakeAdapters().adapters;
    const adapters: AgentAdapters = {
      ...base,
      sandbox: {
        ...base.sandbox,
        validate: async (draft) => ({
          draftHash: draft.draftHash,
          parserDiagnostics: [],
          staticDiagnostics: [{
            severity: 'error',
            code: 'test.keep-repairing',
            message: 'Keep this focused run inside the repair phase.',
          }],
          imageDiagnostics: [],
          pageLedgerDiagnostics: [],
          valid: false,
          checkedAt: NOW,
        }),
      },
    };
    const result = await new AgentRuntime(
      provider,
      adapters,
      new InMemoryAgentPersistence(),
    ).start({
      taskId: 'task-fenced-code-watchdog',
      threadId: 'thread-fenced-code-watchdog',
      runId: 'run-fenced-code-watchdog',
      bookId: 'book-1',
      goal: 'Add this code example to my book.',
      budget: { maxProviderCalls: 5 },
    });

    expect(provider.requests).toHaveLength(5);
    expect(result.state).toMatchObject({
      lifecycle: 'failed',
      lastError: { code: 'budget_exhausted' },
      draft: {
        version: 2,
        script: changedScript,
      },
      usage: { repairPasses: 1 },
    });
  });

  it('treats a blank-line change inside multiline math as material', async () => {
    const firstScript = [
      '# Coupled equations',
      '',
      '$${align=left}',
      '\\begin{aligned}',
      'a &= b + c \\\\',
      'd &= e + f',
      '\\end{aligned}',
      '$$',
    ].join('\n');
    const changedScript = [
      '# Coupled equations',
      '',
      '$${align=left}',
      '\\begin{aligned}',
      'a &= b + c \\\\',
      '',
      'd &= e + f',
      '\\end{aligned}',
      '$$',
    ].join('\n');
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      { name: 'propose_insertion', args: { target: { kind: 'book_end' } } },
      {
        name: 'submit_notebook_script',
        args: { script: firstScript, citedUnitIds: [], reason: 'initial' },
      },
      { name: 'validate_notebook_script', args: {} },
      {
        name: 'submit_notebook_script',
        args: { script: changedScript, citedUnitIds: [], reason: 'repair' },
      },
    ]);
    const base = fakeAdapters().adapters;
    const adapters: AgentAdapters = {
      ...base,
      sandbox: {
        ...base.sandbox,
        validate: async (draft) => ({
          draftHash: draft.draftHash,
          parserDiagnostics: [],
          staticDiagnostics: [{
            severity: 'error',
            code: 'test.keep-math-repairing',
            message: 'Keep this focused run inside the repair phase.',
          }],
          imageDiagnostics: [],
          pageLedgerDiagnostics: [],
          valid: false,
          checkedAt: NOW,
        }),
      },
    };
    const result = await new AgentRuntime(
      provider,
      adapters,
      new InMemoryAgentPersistence(),
    ).start({
      taskId: 'task-math-watchdog',
      threadId: 'thread-math-watchdog',
      runId: 'run-math-watchdog',
      bookId: 'book-1',
      goal: 'Add these equations to my book.',
      budget: { maxProviderCalls: 5 },
    });

    expect(provider.requests).toHaveLength(5);
    expect(result.state).toMatchObject({
      lifecycle: 'failed',
      lastError: { code: 'budget_exhausted' },
      draft: {
        version: 2,
        script: changedScript,
      },
      usage: { repairPasses: 1 },
    });
  });

  it('stops a blocked call alternating with an unchanged observation', async () => {
    const invalidPlacement = {
      name: 'propose_insertion',
      args: { target: { kind: 'after_page' } },
    };
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      invalidPlacement,
      { name: 'inspect_selection', args: {} },
      invalidPlacement,
      { name: 'inspect_selection', args: {} },
      invalidPlacement,
      { name: 'inspect_selection', args: {} },
      invalidPlacement,
    ]);
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(
      provider,
      fakeAdapters().adapters,
      persistence,
    );
    const result = await runtime.start({
      taskId: 'task-alternating-no-progress',
      threadId: 'thread-alternating-no-progress',
      runId: 'run-alternating-no-progress',
      bookId: 'book-1',
      goal: 'Add a short cat explanation to my book.',
      budget: { maxProviderCalls: 24 },
    });

    expect(provider.requests.length).toBeLessThan(24);
    expect(provider.requests.length).toBeLessThanOrEqual(8);
    expect(result.state).toMatchObject({
      lifecycle: 'failed',
      lastError: { code: 'agent_stalled' },
    });
    expect((await persistence.listEvents('task-alternating-no-progress')).filter(
      (event) => event.type === 'run.failed',
    )).toHaveLength(1);
  });

  it('stalls varied invalid arguments after a bounded no-material streak', async () => {
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      ...Array.from({ length: 12 }, (_, index) => ({
        name: 'propose_insertion',
        args: {
          target: { kind: 'after_page' },
          [`irrelevantAttempt${index + 1}`]: ` ${index + 1} `,
        },
      })),
    ]);
    const persistence = new InMemoryAgentPersistence();
    const result = await new AgentRuntime(
      provider,
      fakeAdapters().adapters,
      persistence,
    ).start({
      taskId: 'task-varied-invalid-watchdog',
      threadId: 'thread-varied-invalid-watchdog',
      runId: 'run-varied-invalid-watchdog',
      bookId: 'book-1',
      goal: 'Add a short cat explanation to my book.',
      budget: { maxProviderCalls: 24 },
    });

    expect(provider.requests.length).toBeLessThanOrEqual(6);
    expect(result.state).toMatchObject({
      lifecycle: 'failed',
      lastError: { code: 'agent_stalled' },
    });
    expect(result.state.usage.toolCalls).toBeLessThanOrEqual(4);
    expect((await persistence.listEvents('task-varied-invalid-watchdog')).filter(
      (event) => event.type === 'run.failed',
    )).toHaveLength(1);
  });

  it('allows a materially changed script after an unchanged repair is rejected', async () => {
    const firstScript = '# Cats\n\nA plain explanation that needs a native structure.';
    const changedScript = [
      '# Cats',
      '',
      '::: callout {variant=tip}',
      'Whiskers help cats sense nearby surfaces.',
      ':::',
    ].join('\n');
    const provider = new ScriptedProvider([
      { name: 'inspect_notebook', args: {} },
      { name: 'propose_insertion', args: { target: { kind: 'book_end' } } },
      {
        name: 'submit_notebook_script',
        args: { script: firstScript, citedUnitIds: [], reason: 'initial' },
      },
      { name: 'validate_notebook_script', args: {} },
      {
        name: 'submit_notebook_script',
        args: { script: firstScript, citedUnitIds: [], reason: 'repair' },
      },
      {
        name: 'submit_notebook_script',
        args: { script: changedScript, citedUnitIds: [], reason: 'repair' },
      },
    ]);
    const base = fakeAdapters().adapters;
    const runtime = new AgentRuntime(
      provider,
      {
        ...base,
        sandbox: {
          ...base.sandbox,
          validate: async (draft) => ({
            draftHash: draft.draftHash,
            parserDiagnostics: [],
            staticDiagnostics: [{
              severity: 'error',
              code: 'test.invalid-draft-for-watchdog',
              message: 'Add one meaning-bearing native structure.',
            }],
            imageDiagnostics: [],
            pageLedgerDiagnostics: [],
            valid: false,
            checkedAt: NOW,
          }),
        },
      },
      new InMemoryAgentPersistence(),
    );
    const result = await runtime.start({
      taskId: 'task-changed-repair-after-repeat',
      threadId: 'thread-changed-repair-after-repeat',
      runId: 'run-changed-repair-after-repeat',
      bookId: 'book-1',
      goal: 'Add this cat explanation to my book.',
      // End immediately after the changed repair so this focused regression
      // does not need to script the unrelated validate/render/review tail.
      budget: { maxProviderCalls: 6 },
    });

    expect(provider.requests).toHaveLength(6);
    expect(result.state.lastError?.code).toBe('budget_exhausted');
    expect(result.state.draft).toMatchObject({
      version: 2,
      script: changedScript,
    });
    expect(result.state.usage.repairPasses).toBe(1);
    const changedResult = result.state.modelHistory.find((turn) =>
      turn.role === 'tool' && turn.toolCallId === 'call-6'
    );
    expect(changedResult).toMatchObject({
      role: 'tool',
      toolName: 'submit_notebook_script',
      isError: false,
    });
  });

  it('does not carry an exact-call warning across a new reader-turn boundary', async () => {
    const repeatedAnswer = {
      answer: 'Four.',
      citedUnitIds: [],
    };
    const provider = new ScriptedProvider([
      { name: 'finish_conversation', args: repeatedAnswer },
      { name: 'finish_conversation', args: repeatedAnswer },
    ]);
    const runtime = new AgentRuntime(
      provider,
      fakeAdapters().adapters,
      new InMemoryAgentPersistence(),
    );
    const first = await runtime.start({
      taskId: 'task-watchdog-reader-window',
      threadId: 'thread-watchdog-reader-window',
      runId: 'run-watchdog-reader-window',
      bookId: 'book-1',
      goal: 'What is two plus two?',
    });
    expect(first.state.lifecycle).toBe('completed');

    const second = await runtime.sendUserMessage('What is two plus two?', {
      userMessageId: 'reader-repeated-question-new-window',
    });
    expect(provider.requests).toHaveLength(2);
    expect(second.state.lifecycle).toBe('completed');
    expect(second.state.lastError).toBeUndefined();
    expect(second.state.modelHistory.filter(
      (turn) => turn.role === 'tool' && turn.toolName === 'finish_conversation',
    )).toHaveLength(2);
    expect(second.state.modelHistory.some((turn) =>
      turn.role === 'tool' &&
      turn.content !== null &&
      typeof turn.content === 'object' &&
      !Array.isArray(turn.content) &&
      (turn.content as Readonly<Record<string, AgentJsonValue>>).watchdog ===
        'no_progress_warning'
    )).toBe(false);
  });
});

describe('source and visual coverage gates', () => {
  it('forces every source unit through a complete sweep and detects stale reads', () => {
    const manifest = manifestWithUnits(3);
    let ledger = createSourceCoverageLedger(manifest, 'complete', NOW);
    ledger = recordSourceReads(
      ledger,
      manifest,
      [
        {
          sourceId: 'source-1',
          sourceDigest: 'source-digest-1',
          units: [
            {
              unitId: 'unit-1',
              anchor: manifest.sources[0]!.units[0]!.anchor,
              text: 'one',
              digest: 'unit-digest-1',
            },
          ],
          truncated: true,
          nextUnitId: 'unit-2',
        },
      ],
      NOW,
    );
    expect(ledger.complete).toBe(false);
    expect(ledger.omittedUnitIds).toEqual(['unit-2', 'unit-3']);

    ledger = recordSourceReads(
      ledger,
      manifest,
      [
        {
          sourceId: 'source-1',
          sourceDigest: 'stale-digest',
          units: manifest.sources[0]!.units.slice(1).map((unit) => ({
            unitId: unit.id,
            anchor: unit.anchor,
            text: unit.label,
            digest: unit.digest,
          })),
          truncated: false,
        },
      ],
      NOW,
    );
    expect(ledger.complete).toBe(false);
    expect(ledger.staleSourceIds).toEqual(['source-1']);

    let fresh = createSourceCoverageLedger(manifest, 'complete', NOW);
    fresh = recordSourceReads(
      fresh,
      manifest,
      [
        {
          sourceId: 'source-1',
          sourceDigest: 'source-digest-1',
          units: manifest.sources[0]!.units.map((unit) => ({
            unitId: unit.id,
            anchor: unit.anchor,
            text: unit.label,
            digest: unit.digest,
          })),
          truncated: false,
        },
      ],
      NOW,
    );
    expect(fresh.complete).toBe(true);
  });

  it('does not let a parallel read tool authorize a citation in the same assistant batch', async () => {
    const manifest = manifestWithUnits(1);
    const identity = {
      taskId: 'task-source-observation',
      threadId: 'thread-source-observation',
      runId: 'run-source-observation',
      bookId: 'book-1',
    };
    const base = createInitialAgentState({
      identity,
      goal: 'Add the source accurately to notebook pages',
      now: NOW,
      userMessageId: 'message-source-observation',
    });
    const initial: AgentState = {
      ...base,
      notebookSnapshot: {
        bookId: identity.bookId,
        bookRevision: 'book-revision-source-observation',
        pageIds: ['page-1'],
        pageRevisions: { 'page-1': 'page-revision-source-observation' },
        capturedAt: NOW,
      },
      insertionTarget: { kind: 'book_end' },
      sourceManifest: manifest,
      sourceCoverage: createSourceCoverageLedger(manifest, 'relevant', NOW),
      usage: { ...base.usage, providerCalls: 1 },
    };
    const { adapters } = fakeAdapters(manifest);
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(adapters, events);
    const read = await tools.execute(initial, {
      id: 'parallel-read',
      name: 'read_full_source',
      arguments: { sourceId: 'source-1' },
    }, new AbortController().signal);
    expect(read.state.sourceCoverage?.readExposures).toMatchObject([{
      unitId: 'unit-1',
      providerCallCount: 1,
    }]);

    const uncitedSameBatchDraft = await tools.execute(read.state, {
      id: 'parallel-uncited-draft',
      name: 'submit_notebook_script',
      arguments: {
        script: '# Draft silently derived from a sibling source read',
        citedUnitIds: [],
        reason: 'initial',
      },
    }, new AbortController().signal);
    expect(uncitedSameBatchDraft.result).toMatchObject({
      error: expect.stringMatching(/later model turn.*observe/i),
    });
    expect(uncitedSameBatchDraft.state.draft).toBeUndefined();

    const sameBatchDraft = await tools.execute(read.state, {
      id: 'parallel-draft',
      name: 'submit_notebook_script',
      arguments: {
        script: '# Grounded note',
        citedUnitIds: ['unit-1'],
        reason: 'initial',
      },
    }, new AbortController().signal);
    expect(sameBatchDraft.result).toMatchObject({
      error: expect.stringMatching(/later model turn.*observe/i),
    });
    expect(sameBatchDraft.state.draft).toBeUndefined();

    const laterTurnDraft = await tools.execute({
      ...read.state,
      usage: { ...read.state.usage, providerCalls: 2 },
    }, {
      id: 'later-draft',
      name: 'submit_notebook_script',
      arguments: {
        script: '# Grounded note',
        citedUnitIds: ['unit-1'],
        reason: 'initial',
      },
    }, new AbortController().signal);
    expect(laterTurnDraft.result).not.toHaveProperty('error');
    expect(laterTurnDraft.state.sourceCoverage?.citedUnitIds).toEqual(['unit-1']);
  });

  it('never counts PDF text as complete coverage when required visual evidence is unresolved', () => {
    const base = manifestWithUnits(1);
    const source = base.sources[0]!;
    const unit = source.units[0]!;
    const manifest: SourceManifest = {
      ...base,
      sources: [{
        ...source,
        units: [{ ...unit, hasVisual: true, visualEvidence: 'unresolved' }],
      }],
    };
    const textualRead = {
      sourceId: source.id,
      sourceDigest: source.digest,
      units: [{
        unitId: unit.id,
        anchor: unit.anchor,
        text: 'Text extraction cannot stand in for scan pixels.',
        digest: unit.digest,
      }],
      truncated: false,
      unresolvedVisualUnitIds: [unit.id],
    } as const;
    const blocked = recordSourceReads(
      createSourceCoverageLedger(manifest, 'complete', NOW),
      manifest,
      [textualRead],
      NOW,
    );
    expect(blocked.complete).toBe(false);
    expect(blocked.readUnitIds).toEqual([]);
    expect(blocked.attemptedUnitIds).toEqual([unit.id]);
    expect(blocked.omittedUnitIds).toEqual([unit.id]);
    const preserveAllState = createInitialAgentState({
      identity: {
        taskId: 'task-unresolved-preserve-all',
        threadId: 'thread-unresolved-preserve-all',
        runId: 'run-unresolved-preserve-all',
        bookId: 'book-1',
      },
      goal: 'Make notebook pages from this source.',
      preserveAllSourceInformation: true,
      now: NOW,
      userMessageId: 'reader-unresolved-preserve-all',
    });
    expect([...new AgentToolCatalog(
      fakeAdapters(manifest).adapters,
      new AgentEventBus(),
    ).descriptorsForState({
      ...preserveAllState,
      sourceManifest: manifest,
      sourceCoverage: blocked,
    }).map((tool) => tool.name)]).toEqual(['ask_user']);

    const availableManifest: SourceManifest = {
      ...manifest,
      sources: [{
        ...manifest.sources[0]!,
        units: [{ ...manifest.sources[0]!.units[0]!, visualEvidence: 'available' }],
      }],
    };
    const stillBlocked = recordSourceReads(
      createSourceCoverageLedger(availableManifest, 'complete', NOW),
      availableManifest,
      [{ ...textualRead, unresolvedVisualUnitIds: undefined }],
      NOW,
    );
    expect(stillBlocked.complete).toBe(false);

    const exposed = recordSourceReads(
      createSourceCoverageLedger(availableManifest, 'complete', NOW),
      availableManifest,
      [{
        ...textualRead,
        unresolvedVisualUnitIds: undefined,
        visualRefs: [{
          image: {
            resourceId: 'att_scan.jpg',
            mimeType: 'image/jpeg',
            digest: 'scan-digest',
            width: 1200,
            height: 1600,
          },
          anchor: unit.anchor,
          label: 'PDF page 1 · embedded image 1',
        }],
      }],
      NOW,
    );
    expect(exposed.complete).toBe(true);
  });

  it('chooses direct, RAG, or complete sweep from size and the information guarantee', () => {
    expect(
      planAdaptiveRetrieval({
        manifest: manifestWithUnits(2, 100),
        goal: 'Summarize it',
        preserveAllSourceInformation: false,
      }).strategy,
    ).toBe('direct');
    expect(
      planAdaptiveRetrieval({
        manifest: manifestWithUnits(10, 10_000),
        goal: 'Find the discussion of mitochondria',
        preserveAllSourceInformation: false,
      }).strategy,
    ).toBe('rag');
    expect(
      planAdaptiveRetrieval({
        manifest: manifestWithUnits(10, 10_000),
        goal: 'Keep every fact',
        preserveAllSourceInformation: true,
      }).strategy,
    ).toBe('complete_sweep');
  });

  it('blocks a patch until the exact render generation has all-page visual coverage', () => {
    const base = createInitialAgentState({
      identity: {
        taskId: 'task-policy',
        threadId: 'thread-policy',
        runId: 'run-policy',
        bookId: 'book-policy',
      },
      goal: 'Build a note',
      now: NOW,
      userMessageId: 'message-policy',
    });
    const generation = previewGeneration('draft-hash');
    const sourceCoverage = createSourceCoverageLedger(manifestWithUnits(0), 'relevant', NOW);
    const state: AgentState = {
      ...base,
      notebookSnapshot: {
        bookId: 'book-policy',
        bookRevision: 'book-revision-1',
        pageIds: ['page-1'],
        pageRevisions: { 'page-1': 'page-revision-1' },
        capturedAt: NOW,
      },
      sourceCoverage,
      insertionTarget: { kind: 'book_end' },
      draft: {
        runId: 'run-policy',
        version: 1,
        script: '# Draft',
        draftHash: 'draft-hash',
        sourceManifestDigest: undefined,
        createdAt: NOW,
      },
      validation: {
        draftHash: 'draft-hash',
        parserDiagnostics: [],
        staticDiagnostics: [],
        imageDiagnostics: [],
        pageLedgerDiagnostics: [],
        valid: true,
        checkedAt: NOW,
      },
      previewGeneration: generation,
      visualReview: createVisualReviewLedger(generation, NOW),
    };
    expect(canSubmitNotebookPatch(state)).toMatchObject({
      allowed: false,
      code: 'incomplete',
    });
    expect(() =>
      recordVisualInspection(state.visualReview!, generation, {
        pageIds: ['preview-page-1'],
        findings: [],
        providerCallCount: 1,
        now: NOW,
      }),
    ).toThrow(/read_draft_preview_pages/i);
    const exposed = recordVisualImageExposures(
      state.visualReview!,
      generation,
      generation.pages,
      { now: NOW, providerCallCount: 1 },
    );
    expect(() =>
      recordVisualInspection(exposed, generation, {
        pageIds: ['preview-page-1'],
        findings: [],
        providerCallCount: 1,
        now: NOW,
      }),
    ).toThrow(/provider turn after read_draft_preview_pages/i);
    const reviewed = recordVisualInspection(exposed, generation, {
      pageIds: ['preview-page-1'],
      findings: [],
      providerCallCount: 2,
      now: NOW,
    });
    expect(canSubmitNotebookPatch({ ...state, visualReview: reviewed })).toEqual({
      allowed: true,
    });
    expect(
      canSubmitNotebookPatch({
        ...state,
        visualReview: reviewed,
        draft: { ...state.draft!, draftHash: 'newer-draft-hash' },
      }),
    ).toMatchObject({ allowed: false, code: 'stale' });
  });

  it('refuses approval when attachments changed after the final preview was prepared', async () => {
    const identity = {
      taskId: 'task-stale-preview-source',
      threadId: 'thread-stale-preview-source',
      runId: 'run-stale-preview-source',
      bookId: 'book-1',
    };
    const base = createInitialAgentState({
      identity,
      goal: 'Build a grounded note from the attached source',
      now: NOW,
      userMessageId: 'message-stale-preview-source',
    });
    const generation = previewGeneration('draft-hash');
    const exposed = recordVisualImageExposures(
      createVisualReviewLedger(generation, NOW),
      generation,
      generation.pages,
      { now: NOW, providerCallCount: 1 },
    );
    const reviewed = recordVisualInspection(exposed, generation, {
      pageIds: generation.pages.map((page) => page.pageId),
      findings: [],
      providerCallCount: 2,
      now: NOW,
    });
    const originalManifest = manifestWithUnits(1);
    const originalCoverage = recordSourceCitations(
      recordSourceReads(
        createSourceCoverageLedger(originalManifest, 'relevant', NOW),
        originalManifest,
        [{
          sourceId: 'source-1',
          sourceDigest: 'source-digest-1',
          units: [{
            unitId: 'unit-1',
            anchor: originalManifest.sources[0]!.units[0]!.anchor,
            text: 'Grounded source text.',
            digest: 'unit-digest-1',
          }],
          truncated: false,
        }],
        NOW,
        0,
      ),
      ['unit-1'],
      NOW,
    );
    const originalState: AgentState = {
      ...base,
      notebookSnapshot: {
        bookId: 'book-1',
        bookRevision: 'book-revision-1',
        pageIds: ['page-1'],
        pageRevisions: { 'page-1': 'page-revision-1' },
        capturedAt: NOW,
      },
      sourceManifest: originalManifest,
      sourceCoverage: originalCoverage,
      insertionTarget: { kind: 'book_end' },
      draft: {
        runId: identity.runId,
        version: 1,
        script: '# Grounded draft',
        draftHash: 'draft-hash',
        sourceManifestDigest: originalManifest.digest,
        sourceReadUnitIds: ['unit-1'],
        createdAt: NOW,
      },
      validation: {
        draftHash: 'draft-hash',
        parserDiagnostics: [],
        staticDiagnostics: [],
        imageDiagnostics: [],
        pageLedgerDiagnostics: [],
        valid: true,
        checkedAt: NOW,
      },
      previewGeneration: generation,
      visualReview: reviewed,
      usage: { ...base.usage, providerCalls: 3 },
    };
    const preview = buildUserPreviewContract({
      state: originalState,
      previewId: 'preview-before-new-attachment',
    });
    const proposal = buildPatchProposal({
      state: originalState,
      patchId: 'patch-before-new-attachment',
      idempotencyKey: 'idempotency-before-new-attachment',
      preview,
      now: NOW,
    });
    const changedManifest = manifestWithUnits(1, 101);
    const changedState: AgentState = {
      ...originalState,
      sourceManifest: changedManifest,
      sourceCoverage: createSourceCoverageLedger(changedManifest, 'relevant', NOW),
      patchProposal: proposal,
      lifecycle: 'waiting_for_preview_decision',
      phase: 'waiting_for_preview_decision',
    };
    const { adapters } = fakeAdapters(changedManifest);
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(adapters, events);

    const result = await tools.completeInterrupt(
      changedState,
      {
        id: 'call-submit-stale-preview',
        name: 'submit_notebook_patch',
        arguments: { request: 'current' },
      },
      {
        kind: 'preview_decision',
        decision: 'approve',
        previewId: preview.previewId,
      },
      new AbortController().signal,
    );

    expect(result.result).toMatchObject({
      error: expect.stringMatching(/source changed/i),
      recovered: true,
      nextAction: expect.stringMatching(/list the current source manifest/i),
    });
    expect(result.state.patchProposal).toBeUndefined();
    expect(result.state.sourceCoverage?.staleSourceIds).toContain('source-1');
    expect([...availableAgentToolNames(result.state)]).toEqual([
      'list_source_manifest',
    ]);
    expect(result.state.lifecycle).not.toBe('completed');
  });
});

describe('Cohere strict tool schema contract', () => {
  it('emits only supported structural keywords and a required root field', () => {
    const catalog = new AgentToolCatalog({} as AgentAdapters, new AgentEventBus());
    const forbidden = new Set([
      '$schema', 'oneOf', 'allOf', 'not',
      'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
      'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format',
      'default',
    ]);
    const visit = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }
      if (value === null || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      if (
        object.properties !== null &&
        typeof object.properties === 'object' &&
        !Array.isArray(object.properties)
      ) {
        const properties = Object.keys(object.properties as Record<string, unknown>);
        expect(object.required, `${path}.required`).toEqual(properties);
      }
      for (const [key, child] of Object.entries(object)) {
        expect(forbidden.has(key), `${path}.${key}`).toBe(false);
        visit(child, `${path}.${key}`);
      }
    };
    for (const tool of catalog.descriptors()) {
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema.type, tool.name).toBe('object');
      expect(Array.isArray(schema.required), tool.name).toBe(true);
      expect((schema.required as unknown[]).length, tool.name).toBeGreaterThan(0);
      visit(schema, tool.name);
    }
  });

  it('turns required nullable transport sentinels back into local optional defaults', async () => {
    const manifest = manifestWithUnits(2);
    const identity = {
      taskId: 'task-nullable-transport',
      threadId: 'thread-nullable-transport',
      runId: 'run-nullable-transport',
      bookId: 'book-1',
    };
    const base = createInitialAgentState({
      identity,
      goal: 'Plan how to read the attached source',
      now: NOW,
      userMessageId: 'message-nullable-transport',
    });
    const state: AgentState = {
      ...base,
      sourceManifest: manifest,
      sourceCoverage: createSourceCoverageLedger(manifest, 'relevant', NOW),
    };
    const { adapters } = fakeAdapters(manifest);
    const persistence = new InMemoryAgentPersistence();
    const catalog = new AgentToolCatalog(
      adapters,
      new AgentEventBus(identity, persistence, () => NOW),
    );

    const result = await catalog.execute(state, {
      id: 'nullable-transport-call',
      name: 'plan_source_retrieval',
      arguments: {
        request: 'plan',
        sourceIds: null,
        preserveAllInformation: null,
      },
    }, new AbortController().signal);

    expect(result.result).not.toHaveProperty('error');
    expect(result.state.retrievalPlan).toBeDefined();
  });
});

describe('agent persistence and event safety', () => {
  it('clones checkpoints, rejects credential-shaped state, and deduplicates replay events', async () => {
    const persistence = new InMemoryAgentPersistence();
    const state = createInitialAgentState({
      identity: {
        taskId: 'task-persist',
        threadId: 'thread-persist',
        runId: 'run-persist',
        bookId: 'book-persist',
      },
      goal: 'Persist safely',
      now: NOW,
      userMessageId: 'message-persist',
    });
    await persistence.saveTask(state);
    const first = await persistence.loadTask('task-persist');
    const second = await persistence.loadTask('task-persist');
    expect(first).toEqual(second);
    expect(first?.state).not.toBe(second?.state);
    await expect(
      persistence.saveTask({ ...state, apiKey: 'do-not-store' } as AgentState),
    ).rejects.toThrow(/forbidden field/i);

    const ids = new SequenceIds();
    const bus = new AgentEventBus(state.identity, persistence, () => NOW);
    await bus.emit(
      { type: 'status.changed', phase: 'planning', summary: 'Planning' },
      'stable-plan-event',
    );
    await bus.emit(
      { type: 'status.changed', phase: 'planning', summary: 'Planning' },
      'stable-plan-event',
    );
    expect(await persistence.listEvents('task-persist')).toHaveLength(1);
    expect(ids.create('unused')).toBe('unused-1');
  });
});
