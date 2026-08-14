import { describe, expect, it, vi } from 'vitest';
import type {
  AgentAdapters,
  AgentActivityEvent,
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderStreamEvent,
  AgentProviderTurnRequest,
  AgentRuntimeSnapshot,
  AgentState,
  AiAgentController as CoreAiAgentController,
  DraftPreviewGeneration,
  NotebookInsertionTarget,
  NotebookPatchProposal,
  SourceAttachmentRef,
  UserPreviewContract,
} from '../src/features/aiAgent';
import {
  AgentEventBus,
  AgentRuntime,
  AgentToolCatalog,
  InMemoryAgentPersistence,
  createInitialAgentState,
  createVisualReviewLedger,
  recordVisualImageExposures,
  recordVisualInspection,
  recordSourceCitations,
  canCompleteConversation,
  canSubmitNotebookPatch,
  availableAgentToolNames,
} from '../src/features/aiAgent';
import {
  buildAiAgentDiagnosticLog,
  createAiAgentPanelController,
  currentActivityTimeline,
  friendlyWorkingNote,
  latestTurnTimeline,
} from '../src/views/rail/aiAgentControllerAdapter';

const NOW = '2026-08-12T08:00:00.000Z';

function unreachable(): never {
  throw new Error('not used by this contract test');
}

function toolAdapters(): AgentAdapters {
  return {
    clock: { now: () => NOW },
    ids: { create: (prefix) => `${prefix}-1` },
    hash: {
      digestText: async (text) => `text:${text}`,
      digestJson: async (value) => `json:${JSON.stringify(value)}`,
    },
    notebook: {
      inspectNotebook: async () => unreachable(),
      inspectPage: async () => unreachable(),
      inspectPageRange: async () => unreachable(),
      inspectSelection: async () => unreachable(),
    },
    ingestion: { ingest: async () => unreachable() },
    sources: {
      getManifest: async () => unreachable(),
      getSource: async () => unreachable(),
      readUnitRange: async () => unreachable(),
      readFullSource: async () => unreachable(),
    },
    retrieval: {
      ensureIndexed: async () => unreachable(),
      search: async () => unreachable(),
      rerank: async () => unreachable(),
    },
    sandbox: {
      validate: async () => unreachable(),
      render: async () => unreachable(),
      getGeneration: async () => unreachable(),
      dispose: async () => undefined,
    },
  };
}

function reviewedGeneration(
  generationId = 'review-generation-1',
  draftHash = 'review-draft-1',
  layoutHash = 'review-layout-1',
): DraftPreviewGeneration {
  return {
    generationId,
    draftHash,
    layoutHash,
    rendererVersion: 'test-renderer',
    bookSnapshotRevision: 'current-revision',
    createdAt: NOW,
    parserValid: true,
    layoutValid: true,
    stale: false,
    pageCount: 1,
    pages: [{
      pageId: `${generationId}-page-1`,
      pageNumber: 1,
      width: 620,
      height: 720,
      image: {
        resourceId: `${generationId}-render-1`,
        mimeType: 'image/png',
        digest: `${generationId}-image-digest`,
        width: 620,
        height: 720,
      },
      textDigest: `${generationId}-text-digest`,
      layoutDigest: `${generationId}-page-layout`,
      paginationSpill: false,
      residualOverflow: false,
    }],
    diagnostics: [],
  };
}

function reviewReadyState(generation: DraftPreviewGeneration) {
  const initial = createInitialAgentState({
    identity: {
      taskId: 'task-visual-review',
      threadId: 'thread-visual-review',
      runId: 'run-visual-review',
      bookId: 'current-book',
    },
    goal: 'Build and review a page',
    now: NOW,
    userMessageId: 'message-visual-review',
  });
  return {
    ...initial,
    lifecycle: 'running' as const,
    notebookSnapshot: {
      bookId: 'current-book',
      bookRevision: 'current-revision',
      pageIds: ['owned-page'],
      pageRevisions: { 'owned-page': 'owned-revision' },
      capturedAt: NOW,
    },
    insertionTarget: { kind: 'book_end' as const },
    draft: {
      runId: initial.identity.runId,
      version: 1,
      script: '# Reviewed page',
      draftHash: generation.draftHash,
      sourceManifestDigest: undefined,
      createdAt: NOW,
    },
    validation: {
      draftHash: generation.draftHash,
      parserDiagnostics: [],
      staticDiagnostics: [],
      imageDiagnostics: [],
      pageLedgerDiagnostics: [],
      valid: true,
      checkedAt: NOW,
    },
    previewGeneration: generation,
    visualReview: createVisualReviewLedger(generation, NOW),
    usage: { ...initial.usage, providerCalls: 2 },
  };
}

function citationManifest() {
  return {
    version: 1 as const,
    createdAt: NOW,
    totalEstimatedTokens: 24,
    digest: 'citation-manifest',
    sources: [{
      id: 'trusted-source',
      title: 'Trusted Lecture Notes',
      kind: 'pdf' as const,
      digest: 'trusted-source-digest',
      mediaType: 'application/pdf',
      estimatedTokens: 24,
      quarantined: true,
      promptInjectionWarnings: [],
      units: [{
        id: 'trusted-unit-1',
        label: 'Prefix-code theorem',
        ordinal: 0,
        digest: 'trusted-unit-digest-1',
        estimatedTokens: 12,
        characters: 48,
        hasText: true,
        hasVisual: false,
        anchor: {
          sourceId: 'trusted-source',
          unitId: 'trusted-unit-1',
          pageNumber: 7,
          figure: 'Figure 2',
        },
      }, {
        id: 'trusted-unit-unread',
        label: 'Unread appendix',
        ordinal: 1,
        digest: 'trusted-unit-digest-2',
        estimatedTokens: 12,
        characters: 48,
        hasText: true,
        hasVisual: false,
        anchor: {
          sourceId: 'trusted-source',
          unitId: 'trusted-unit-unread',
          pageNumber: 9,
        },
      }],
    }],
  };
}

function citationReadyState() {
  const generation = reviewedGeneration('citation-generation', 'citation-draft');
  const base = reviewReadyState(generation);
  const manifest = citationManifest();
  const coverage = {
    manifestDigest: manifest.digest,
    mode: 'relevant' as const,
    requiredUnitIds: ['trusted-unit-1'],
    readUnitIds: ['trusted-unit-1'],
    readExposures: [{
      unitId: 'trusted-unit-1',
      providerCallCount: 1,
      exposedAt: NOW,
    }],
    citedUnitIds: ['trusted-unit-1'],
    omittedUnitIds: [],
    staleSourceIds: [],
    complete: true,
    updatedAt: NOW,
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
  return {
    ...base,
    sourceManifest: manifest,
    sourceCoverage: coverage,
    draft: {
      ...base.draft,
      sourceManifestDigest: manifest.digest,
      sourceReadUnitIds: ['trusted-unit-1'],
    },
    visualReview: reviewed,
  };
}

function panelApplyFixture() {
  const generation = reviewedGeneration('panel-apply-generation', 'panel-apply-draft', 'panel-apply-layout');
  const ready = reviewReadyState(generation);
  const preview: UserPreviewContract = {
    previewId: 'panel-apply-preview',
    generationId: generation.generationId,
    draftHash: generation.draftHash,
    layoutHash: generation.layoutHash,
    bookId: ready.identity.bookId,
    expectedBookRevision: ready.notebookSnapshot.bookRevision,
    insertionTarget: ready.insertionTarget,
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
      updatedAt: NOW,
    },
    visualReview: {
      ...ready.visualReview,
      imageExposures: generation.pages.map((page) => ({
        generationId: generation.generationId,
        pageId: page.pageId,
        imageDigest: page.image.digest,
        layoutDigest: page.layoutDigest,
        readRequestedAtProviderCall: 1,
        exposedAt: NOW,
      })),
      inspectedPageIds: generation.pages.map((page) => page.pageId),
      complete: true,
      passed: true,
    },
    validation: ready.validation,
  };
  const proposal: NotebookPatchProposal = {
    patchId: 'panel-apply-patch',
    idempotencyKey: 'panel-apply-idempotency',
    runId: ready.identity.runId,
    draftVersion: ready.draft.version,
    draftHash: ready.draft.draftHash,
    script: ready.draft.script,
    expectedBookRevision: ready.notebookSnapshot.bookRevision,
    insertionTarget: ready.insertionTarget,
    preview,
    status: 'waiting_for_approval',
    createdAt: NOW,
  };
  return { ready, preview, proposal };
}

describe('AI insertion target boundaries', () => {
  it('keeps a provider pause in one recovery card instead of duplicating it in the transcript', () => {
    const failedState: AgentState = {
      ...createInitialAgentState({
        identity: {
          taskId: 'task-single-pause',
          threadId: 'thread-single-pause',
          runId: 'run-single-pause',
          bookId: 'current-book',
        },
        goal: 'explain cookies',
        now: NOW,
        userMessageId: 'message-single-pause',
      }),
      lifecycle: 'failed',
      phase: 'failed',
      lastError: {
        code: 'provider_invalid_response',
        message: 'The AI provider returned an unusable response.',
        retryable: true,
      },
    };
    const snapshot: AgentRuntimeSnapshot = {
      state: failedState,
      interrupt: null,
      busy: false,
    };
    let eventListener: ((event: AgentActivityEvent) => void) | undefined;
    const core = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: (listener: (event: AgentActivityEvent) => void) => {
        eventListener = listener;
        return () => { eventListener = undefined; };
      },
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      placements: () => [],
      renderUrlFor: (image) => `asset://${image.resourceId}`,
      onApprovedProposal: () => undefined,
    });

    try {
      eventListener?.({
        id: 'event-single-pause',
        sequence: 1,
        threadId: failedState.identity.threadId,
        taskId: failedState.identity.taskId,
        runId: failedState.identity.runId,
        at: NOW,
        type: 'run.failed',
        error: failedState.lastError!,
      });
      expect(controller.state().timeline.some((item) =>
        item.kind === 'activity' && item.label === 'Agent task paused'
      )).toBe(false);
      expect(controller.state().error).toMatchObject({
        title: 'The AI reply could not be used',
        detail: 'The AI provider returned an unusable response.',
        retryable: true,
      });
    } finally {
      controller.dispose();
    }
  });

  it('keeps a 48-page notebook snapshot local and sends one compact provider manifest', async () => {
    const pageIds = Array.from({ length: 48 }, (_, index) =>
      `page-${String(index + 1).padStart(2, '0')}-stable-id`);
    const pageRevisions = Object.fromEntries(pageIds.map((pageId, index) => [
      pageId,
      `revision-${index + 1}-${'r'.repeat(48)}`,
    ]));
    const inspection = {
      title: 'Forty-eight page notebook',
      snapshot: {
        bookId: 'current-book',
        bookRevision: 'book-revision-48',
        pageIds,
        pageRevisions,
        capturedAt: NOW,
      },
      pages: pageIds.map((pageId, ordinal) => ({
        pageId,
        ordinal,
        revision: pageRevisions[pageId]!,
        title: `Chapter ${ordinal + 1}`,
        estimatedTokens: 120 + ordinal,
      })),
    };
    const baseAdapters = toolAdapters();
    const identity = {
      taskId: 'task-compact-notebook-inspection',
      threadId: 'thread-compact-notebook-inspection',
      runId: 'run-compact-notebook-inspection',
      bookId: 'current-book',
    };
    const state = createInitialAgentState({
      identity,
      goal: 'Add a topic to my book',
      now: NOW,
      userMessageId: 'reader-compact-notebook-inspection',
    });
    const catalog = new AgentToolCatalog(
      {
        ...baseAdapters,
        notebook: {
          ...baseAdapters.notebook,
          inspectNotebook: async () => inspection,
        },
      },
      new AgentEventBus(identity, new InMemoryAgentPersistence(), () => NOW),
    );

    const inspected = await catalog.execute(state, {
      id: 'inspect-48-pages',
      name: 'inspect_notebook',
      arguments: {},
    }, new AbortController().signal);
    const providerJson = JSON.stringify(inspected.result);
    const formerDuplicatedJson = JSON.stringify(inspection);

    expect(inspected.state.notebookSnapshot).toEqual(inspection.snapshot);
    expect(inspected.result).toMatchObject({
      title: inspection.title,
      pageCount: 48,
      bookRevision: inspection.snapshot.bookRevision,
      capturedAt: NOW,
    });
    const providerPages = (inspected.result as unknown as {
      readonly pages: readonly Record<string, unknown>[];
    }).pages;
    expect(providerPages).toHaveLength(48);
    expect(providerPages[0]).toMatchObject({
      pageId: pageIds[0],
      ordinal: 0,
      title: 'Chapter 1',
      estimatedTokens: 120,
    });
    expect(providerJson).not.toContain('"snapshot"');
    expect(providerJson).not.toContain('"pageRevisions"');
    expect(providerJson).not.toContain('"revision"');
    expect(providerJson.length).toBeLessThan(7_500);
    expect(providerJson.length).toBeLessThan(formerDuplicatedJson.length / 2);
  });

  it('advertises only the next useful notebook-authoring gate', () => {
    const sourceTools = new Set([
      'list_source_manifest',
      'plan_source_retrieval',
      'read_source_range',
      'read_full_source',
      'search_source_index',
      'rerank_source_hits',
      'inspect_source_coverage',
    ]);
    const workflowTools = (tools: ReadonlySet<string>) => [...tools]
      .filter((name) => !sourceTools.has(name))
      .sort();
    const ready = citationReadyState();
    const mutation = {
      ...ready,
      taskBrief: { ...ready.taskBrief, goal: 'Add these notes into my book' },
      conversation: [{
        id: 'reader-mutation',
        role: 'user' as const,
        text: 'Add these notes into my book',
        createdAt: NOW,
      }],
    };
    const beforeDraft = {
      ...mutation,
      draft: undefined,
      validation: undefined,
      previewGeneration: undefined,
      visualReview: undefined,
      patchProposal: undefined,
    };
    const beforeDraftTools = availableAgentToolNames(beforeDraft);
    expect(beforeDraftTools.has('submit_notebook_script')).toBe(true);
    expect(beforeDraftTools.has('propose_insertion')).toBe(false);
    expect(beforeDraftTools.has('propose_notebook_patch')).toBe(false);
    expect(beforeDraftTools.has('finish_conversation')).toBe(false);

    const beforeValidation = {
      ...mutation,
      validation: undefined,
      previewGeneration: undefined,
      visualReview: undefined,
      patchProposal: undefined,
    };
    const validationTools = availableAgentToolNames(beforeValidation);
    expect(validationTools.has('validate_notebook_script')).toBe(true);
    expect(validationTools.has('submit_notebook_script')).toBe(false);
    expect(validationTools.has('propose_insertion')).toBe(false);
    expect(validationTools.has('propose_notebook_patch')).toBe(false);

    const readyToRender = {
      ...mutation,
      previewGeneration: undefined,
      visualReview: undefined,
      patchProposal: undefined,
    };
    const renderTools = availableAgentToolNames(readyToRender);
    expect(renderTools.has('render_draft_preview')).toBe(true);
    expect(renderTools.has('validate_notebook_script')).toBe(false);
    expect(renderTools.has('submit_notebook_script')).toBe(false);
    expect(renderTools.has('propose_insertion')).toBe(false);
    expect(workflowTools(renderTools)).toEqual(['render_draft_preview']);

    const reviewedTools = availableAgentToolNames(mutation);
    expect(reviewedTools.has('propose_notebook_patch')).toBe(true);
    expect(reviewedTools.has('submit_notebook_script')).toBe(false);
    expect(reviewedTools.has('record_visual_review')).toBe(false);

    expect(workflowTools(availableAgentToolNames({
      ...mutation,
      visualReview: undefined,
      patchProposal: undefined,
    }))).toEqual(['render_draft_preview']);

    const unreadPreview = {
      ...mutation,
      visualReview: createVisualReviewLedger(mutation.previewGeneration, NOW),
      patchProposal: undefined,
    };
    const unreadPreviewTools = availableAgentToolNames(unreadPreview);
    expect(unreadPreviewTools.has('read_draft_preview_pages')).toBe(true);
    expect(unreadPreviewTools.has('record_visual_review')).toBe(false);
    expect(unreadPreviewTools.has('get_draft_preview_manifest')).toBe(false);
    expect(unreadPreviewTools.has('propose_insertion')).toBe(false);
    expect(unreadPreviewTools.has('submit_notebook_script')).toBe(false);

    const exposedReview = recordVisualImageExposures(
      unreadPreview.visualReview,
      unreadPreview.previewGeneration,
      unreadPreview.previewGeneration.pages,
      { now: NOW, providerCallCount: 2 },
    );
    const exposedPreviewTools = availableAgentToolNames({
      ...unreadPreview,
      visualReview: exposedReview,
    });
    expect(exposedPreviewTools.has('record_visual_review')).toBe(true);
    expect(exposedPreviewTools.has('read_draft_preview_pages')).toBe(false);
    expect(exposedPreviewTools.has('get_draft_preview_manifest')).toBe(false);
    expect(exposedPreviewTools.has('propose_insertion')).toBe(false);
    expect(exposedPreviewTools.has('submit_notebook_script')).toBe(false);
    expect(workflowTools(exposedPreviewTools)).toEqual(['record_visual_review']);

    const invalidLayoutGeneration = {
      ...mutation.previewGeneration,
      layoutValid: false,
    };
    const invalidLayoutExposed = recordVisualImageExposures(
      createVisualReviewLedger(invalidLayoutGeneration, NOW),
      invalidLayoutGeneration,
      invalidLayoutGeneration.pages,
      { now: NOW, providerCallCount: 2 },
    );
    const invalidLayoutReviewed = recordVisualInspection(
      invalidLayoutExposed,
      invalidLayoutGeneration,
      {
        pageIds: invalidLayoutGeneration.pages.map((page) => page.pageId),
        findings: [],
        providerCallCount: 3,
        now: NOW,
      },
    );
    expect(invalidLayoutReviewed).toMatchObject({ complete: true, passed: false });
    expect(workflowTools(availableAgentToolNames({
      ...mutation,
      previewGeneration: invalidLayoutGeneration,
      visualReview: invalidLayoutReviewed,
      patchProposal: undefined,
    }))).toEqual(['submit_notebook_script']);

    const invalidParserGeneration = {
      ...mutation.previewGeneration,
      parserValid: false,
      layoutValid: true,
    };
    const invalidParserExposed = recordVisualImageExposures(
      createVisualReviewLedger(invalidParserGeneration, NOW),
      invalidParserGeneration,
      invalidParserGeneration.pages,
      { now: NOW, providerCallCount: 2 },
    );
    const invalidParserReviewed = recordVisualInspection(
      invalidParserExposed,
      invalidParserGeneration,
      {
        pageIds: invalidParserGeneration.pages.map((page) => page.pageId),
        findings: [],
        providerCallCount: 3,
        now: NOW,
      },
    );
    // A visual pass cannot overrule the renderer's parser receipt. The only
    // useful next phase is a materially changed script repair.
    expect(invalidParserReviewed).toMatchObject({ complete: true, passed: true });
    expect(workflowTools(availableAgentToolNames({
      ...mutation,
      previewGeneration: invalidParserGeneration,
      visualReview: invalidParserReviewed,
      patchProposal: undefined,
    }))).toEqual(['submit_notebook_script']);

    const inconsistentLegacyReview = {
      ...mutation.visualReview,
      // All required pages are present in inspectedPageIds, so this persisted
      // derived flag is impossible and must never leave the provider tool-less.
      complete: false,
      passed: false,
    };
    expect(workflowTools(availableAgentToolNames({
      ...mutation,
      visualReview: inconsistentLegacyReview,
      patchProposal: undefined,
    }))).toEqual(['render_draft_preview']);

    const wrongPageRequirement = {
      ...mutation.visualReview,
      requiredPageIds: [],
      complete: true,
      passed: true,
    };
    const wrongPageState = {
      ...mutation,
      visualReview: wrongPageRequirement,
      patchProposal: undefined,
    };
    expect(canSubmitNotebookPatch(wrongPageState)).toMatchObject({
      allowed: false,
      code: 'stale',
    });
    expect(workflowTools(availableAgentToolNames(wrongPageState)))
      .toEqual(['render_draft_preview']);
  });

  it('rerenders and resets an inconsistent legacy visual-review receipt', async () => {
    const generation = reviewedGeneration('legacy-review-generation', 'legacy-review-draft');
    const base = reviewReadyState(generation);
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
    const state = {
      ...base,
      taskBrief: { ...base.taskBrief, goal: 'Add a reviewed page to my book' },
      conversation: [{
        id: 'reader-legacy-review-recovery',
        role: 'user' as const,
        text: 'Add a reviewed page to my book',
        createdAt: NOW,
      }],
      visualReview: {
        ...reviewed,
        requiredPageIds: [],
        complete: true,
        passed: true,
      },
    };
    const baseAdapters = toolAdapters();
    const catalog = new AgentToolCatalog({
      ...baseAdapters,
      sandbox: {
        ...baseAdapters.sandbox,
        render: async () => generation,
      },
    }, new AgentEventBus(state.identity, new InMemoryAgentPersistence(), () => NOW));

    expect([...availableAgentToolNames(state)]).toEqual(['render_draft_preview']);
    const rerendered = await catalog.execute(state, {
      id: 'recover-legacy-review',
      name: 'render_draft_preview',
      arguments: {},
    }, new AbortController().signal);

    expect(rerendered.result).not.toMatchObject({ error: expect.anything() });
    expect(rerendered.state.visualReview).toMatchObject({
      generationId: generation.generationId,
      requiredPageIds: generation.pages.map((page) => page.pageId),
      inspectedPageIds: [],
      complete: false,
      passed: false,
    });
    expect([...availableAgentToolNames(rerendered.state)])
      .toEqual(['read_draft_preview_pages']);
  });

  it('allows a replacement draft only for a concrete repair or reader-feedback reason', () => {
    const ready = citationReadyState();
    const mutation = {
      ...ready,
      taskBrief: { ...ready.taskBrief, goal: 'Add these notes into my book' },
      conversation: [{
        id: 'reader-repair-mutation',
        role: 'user' as const,
        text: 'Add these notes into my book',
        createdAt: NOW,
      }],
      patchProposal: undefined,
    };
    const invalid = {
      ...mutation,
      validation: {
        ...mutation.validation,
        valid: false,
        staticDiagnostics: [{
          severity: 'error' as const,
          code: 'craft.semantic-variety-required',
          message: 'Use a meaning-bearing native structure.',
        }],
      },
      previewGeneration: undefined,
      visualReview: undefined,
    };
    expect(availableAgentToolNames(invalid).has('submit_notebook_script')).toBe(true);

    const page = mutation.previewGeneration.pages[0]!;
    const blockedReview = recordVisualInspection(mutation.visualReview, mutation.previewGeneration, {
      pageIds: [page.pageId],
      findings: [{
        id: 'reader-repair-blocking',
        generationId: mutation.previewGeneration.generationId,
        pageId: page.pageId,
        severity: 'blocking',
        category: 'clipping',
        summary: 'The final card is visibly clipped.',
        resolved: false,
      }],
      providerCallCount: 3,
      now: NOW,
    });
    expect(availableAgentToolNames({
      ...mutation,
      visualReview: blockedReview,
    }).has('submit_notebook_script')).toBe(true);

    expect(availableAgentToolNames({
      ...mutation,
      draft: { ...mutation.draft, sourceManifestDigest: 'older-source-context' },
    }).has('submit_notebook_script')).toBe(true);

    const feedbackState = {
      ...mutation,
      modelHistory: [
        ...mutation.modelHistory,
        {
          id: 'feedback-result-turn',
          role: 'tool' as const,
          toolCallId: 'feedback-call',
          toolName: 'submit_notebook_patch',
          content: { decision: 'feedback', feedback: 'Make the comparison clearer.' },
          isError: false,
          createdAt: NOW,
        },
      ],
    };
    expect(availableAgentToolNames(feedbackState).has('submit_notebook_script')).toBe(true);

    const feedbackConsumed = {
      ...feedbackState,
      modelHistory: [
        ...feedbackState.modelHistory,
        {
          id: 'replacement-draft-turn',
          role: 'assistant' as const,
          content: '',
          toolCalls: [{
            id: 'replacement-draft-call',
            name: 'submit_notebook_script',
            arguments: {
              script: mutation.draft.script,
              citedUnitIds: ['trusted-unit-1'],
              reason: 'reader feedback',
            },
          }],
          createdAt: NOW,
        },
        {
          id: 'replacement-draft-result',
          role: 'tool' as const,
          toolCallId: 'replacement-draft-call',
          toolName: 'submit_notebook_script',
          content: { draftHash: mutation.draft.draftHash },
          isError: false,
          createdAt: NOW,
        },
      ],
    };
    expect(availableAgentToolNames(feedbackConsumed).has('submit_notebook_script')).toBe(false);
  });

  it('prevents the logged calls 17-21 unchanged-submit loop after validation passes', async () => {
    const ready = citationReadyState();
    const state = {
      ...ready,
      taskBrief: { ...ready.taskBrief, goal: 'Add these notes into my book' },
      conversation: [{
        id: 'reader-loop-regression',
        role: 'user' as const,
        text: 'Add these notes into my book',
        createdAt: NOW,
      }],
      previewGeneration: undefined,
      visualReview: undefined,
      patchProposal: undefined,
    };
    const persistence = new InMemoryAgentPersistence();
    const catalog = new AgentToolCatalog(
      {
        ...toolAdapters(),
        hash: {
          ...toolAdapters().hash,
          digestText: async () => state.draft.draftHash,
        },
      },
      new AgentEventBus(state.identity, persistence, () => NOW),
    );

    const advertised = catalog.descriptorsForState(state).map((tool) => tool.name);
    expect(advertised).toContain('render_draft_preview');
    expect(advertised).not.toContain('submit_notebook_script');

    const staleCall = await catalog.execute(state, {
      id: 'logged-call-17',
      name: 'submit_notebook_script',
      arguments: {
        script: state.draft.script,
        citedUnitIds: state.sourceCoverage.citedUnitIds,
        reason: 'repair',
      },
    }, new AbortController().signal);
    expect(staleCall.result).toEqual({
      error: 'the current draft already passed validation; render it instead of submitting it again',
      retryable: true,
    });
    expect(staleCall.state.draft).toEqual(state.draft);
    expect(staleCall.state.usage.repairPasses).toBe(state.usage.repairPasses);
    expect(catalog.descriptorsForState(staleCall.state).map((tool) => tool.name))
      .not.toContain('submit_notebook_script');
  });

  it('marks a repeated identical invalid repair as do-not-repeat without spending repair passes', async () => {
    const ready = citationReadyState();
    const state = {
      ...ready,
      taskBrief: { ...ready.taskBrief, goal: 'Add these notes into my book' },
      conversation: [{
        id: 'reader-invalid-repair-loop',
        role: 'user' as const,
        text: 'Add these notes into my book',
        createdAt: NOW,
      }],
      validation: {
        ...ready.validation,
        valid: false,
        staticDiagnostics: [{
          severity: 'error' as const,
          code: 'craft.semantic-variety-required',
          message: 'Use a meaning-bearing native structure.',
        }],
      },
      previewGeneration: undefined,
      visualReview: undefined,
      patchProposal: undefined,
    };
    const persistence = new InMemoryAgentPersistence();
    const catalog = new AgentToolCatalog(
      {
        ...toolAdapters(),
        hash: {
          ...toolAdapters().hash,
          digestText: async (text) => text === state.draft.script
            ? state.draft.draftHash
            : 'materially-changed-repair-hash',
        },
      },
      new AgentEventBus(state.identity, persistence, () => NOW),
    );
    const repeatedCall = {
      name: 'submit_notebook_script',
      arguments: {
        script: state.draft.script,
        citedUnitIds: state.sourceCoverage.citedUnitIds,
        reason: 'repair',
      },
    };

    expect(catalog.descriptorsForState(state).map((tool) => tool.name))
      .toContain('submit_notebook_script');
    const first = await catalog.execute(state, {
      id: 'invalid-repeat-1',
      ...repeatedCall,
    }, new AbortController().signal);
    expect(first.result).toMatchObject({
      retryable: false,
      doNotRepeat: true,
      nextAction: expect.stringContaining('Revise the Notebook Script materially'),
    });
    expect(first.result).toMatchObject({
      error: expect.stringContaining('identical to the current draft'),
    });
    expect(first.state.draft).toEqual(state.draft);
    expect(first.state.usage.repairPasses).toBe(state.usage.repairPasses);
    expect(catalog.descriptorsForState(first.state).map((tool) => tool.name))
      .toContain('submit_notebook_script');

    const second = await catalog.execute(first.state, {
      id: 'invalid-repeat-2',
      ...repeatedCall,
    }, new AbortController().signal);
    expect(second.result).toMatchObject({
      error: expect.stringContaining('identical to the current draft'),
      retryable: false,
      doNotRepeat: true,
    });
    expect(second.state.draft).toEqual(state.draft);
    expect(second.state.draft?.version).toBe(state.draft.version);
    expect(second.state.usage.repairPasses).toBe(state.usage.repairPasses);

    expect(catalog.descriptorsForState(second.state).map((tool) => tool.name))
      .toContain('submit_notebook_script');
    const changed = await catalog.execute(second.state, {
      id: 'changed-repair-after-repeat',
      name: 'submit_notebook_script',
      arguments: {
        script: `${state.draft.script}\n\n::: callout {variant=tip}\nA concrete repair.\n:::`,
        citedUnitIds: state.sourceCoverage.citedUnitIds,
        reason: 'repair',
      },
    }, new AbortController().signal);
    expect(changed.result).not.toHaveProperty('error');
    expect(changed.state.draft?.draftHash).toBe('materially-changed-repair-hash');
    expect(changed.state.draft?.version).toBe(state.draft.version + 1);
    expect(changed.state.usage.repairPasses).toBe(state.usage.repairPasses + 1);
    expect(changed.state.lastError).toBeUndefined();
  });

  it('advertises only conversation completion for an answer-only turn', async () => {
    const identity = {
      taskId: 'task-capability-choice',
      threadId: 'thread-capability-choice',
      runId: 'run-capability-choice',
      bookId: 'current-book',
    };
    const tools = new AgentToolCatalog(
      toolAdapters(),
      new AgentEventBus(identity, new InMemoryAgentPersistence(), () => NOW),
    );
    const state = createInitialAgentState({
      identity,
      goal: 'What is mathematics?',
      now: NOW,
      userMessageId: 'reader-capability-choice',
    });

    expect(availableAgentToolNames(state).has('finish_conversation')).toBe(true);
    expect(availableAgentToolNames(state).has('submit_notebook_script')).toBe(false);
    const rejected = await tools.execute(state, {
      id: 'wrong-draft-choice',
      name: 'submit_notebook_script',
      arguments: {
        script: '::page\n# Mathematics',
        reason: 'initial',
        citedUnitIds: [],
      },
    }, new AbortController().signal);

    expect(rejected.result).toMatchObject({
      error: expect.stringMatching(/conversational answer/i),
      retryable: true,
    });
    expect(rejected.state.draft).toBeUndefined();
  });

  it('retires set_plan until material work changes instead of accepting paraphrase loops', async () => {
    const identity = {
      taskId: 'task-plan-watchdog',
      threadId: 'thread-plan-watchdog',
      runId: 'run-plan-watchdog',
      bookId: 'current-book',
    };
    const tools = new AgentToolCatalog(
      toolAdapters(),
      new AgentEventBus(identity, new InMemoryAgentPersistence(), () => NOW),
    );
    const initial = createInitialAgentState({
      identity,
      goal: 'Add this explanation to my book',
      now: NOW,
      userMessageId: 'reader-plan-watchdog',
    });
    const first = await tools.execute(initial, {
      id: 'plan-one',
      name: 'set_plan',
      arguments: {
        summary: 'Build reviewed pages',
        steps: [{ id: 'draft', title: 'Draft the pages' }],
      },
    }, new AbortController().signal);
    const repeated = await tools.execute(first.state, {
      id: 'plan-two',
      name: 'set_plan',
      arguments: {
        summary: 'Prepare polished notebook pages',
        steps: [{ id: 'compose', title: 'Compose the pages' }],
      },
    }, new AbortController().signal);

    expect(first.state.plan?.version).toBe(1);
    expect(repeated.state.plan).toEqual(first.state.plan);
    expect(repeated.result).toEqual({
      error: 'set_plan is not available in the current agent phase; use inspect_notebook instead',
      retryable: true,
    });
    expect(availableAgentToolNames(first.state).has('set_plan')).toBe(false);
    expect(availableAgentToolNames(first.state).has('inspect_notebook')).toBe(true);
  });

  it('keeps notebook intent through a natural clarification answer in a greeting-started task', () => {
    const initial = createInitialAgentState({
      identity: {
        taskId: 'task-intent-latch',
        threadId: 'thread-intent-latch',
        runId: 'run-intent-latch',
        bookId: 'current-book',
      },
      goal: 'hi',
      now: NOW,
      userMessageId: 'reader-hi',
    });
    const state = {
      ...initial,
      conversation: [
        ...initial.conversation,
        { id: 'agent-lions', role: 'assistant' as const, text: 'Lions live in prides.', createdAt: NOW },
        { id: 'reader-add', role: 'user' as const, text: 'add that to my book', createdAt: NOW },
        { id: 'agent-question', role: 'assistant' as const, text: 'Should I make this a short lesson?', createdAt: NOW },
        { id: 'reader-yes', role: 'user' as const, text: 'yes', createdAt: NOW },
      ],
    };
    const tools = availableAgentToolNames(state);

    expect(tools.has('inspect_notebook')).toBe(true);
    expect(tools.has('finish_conversation')).toBe(false);
  });

  it('starts a later ordinary question in conversation mode even when an old draft remains', () => {
    const priorNotebookState = citationReadyState();
    const state = {
      ...priorNotebookState,
      lifecycle: 'running' as const,
      conversation: [
        { id: 'reader-add-old', role: 'user' as const, text: 'Add this to my book', createdAt: NOW },
        { id: 'agent-done-old', role: 'assistant' as const, text: 'The reviewed pages were added.', createdAt: NOW },
        { id: 'reader-math-new', role: 'user' as const, text: 'What is mathematics?', createdAt: NOW },
      ],
      budgetWindow: {
        providerCallsAtStart: priorNotebookState.usage.providerCalls,
        toolCallsAtStart: priorNotebookState.usage.toolCalls,
        repairPassesAtStart: priorNotebookState.usage.repairPasses,
        startedAt: NOW,
        readerMessageId: 'reader-math-new',
      },
    };
    const tools = availableAgentToolNames(state);

    expect(tools.has('finish_conversation')).toBe(true);
    expect(tools.has('submit_notebook_script')).toBe(false);
  });

  it('does not force an unrelated later chat turn through an old attachment index', () => {
    const initial = createInitialAgentState({
      identity: {
        taskId: 'task-unrelated-source',
        threadId: 'thread-unrelated-source',
        runId: 'run-unrelated-source',
        bookId: 'current-book',
      },
      goal: 'Summarize the attached PDF',
      now: NOW,
      userMessageId: 'reader-source-old',
    });
    const manifest = citationManifest();
    const state = {
      ...initial,
      taskBrief: {
        ...initial.taskBrief,
        preserveAllSourceInformation: true,
      },
      sourceManifest: manifest,
      sourceCoverage: {
        manifestDigest: 'older-manifest-digest',
        mode: 'relevant' as const,
        requiredUnitIds: ['trusted-unit-1'],
        readUnitIds: ['trusted-unit-1'],
        citedUnitIds: ['trusted-unit-1'],
        omittedUnitIds: [],
        staleSourceIds: ['trusted-source'],
        complete: false,
        updatedAt: NOW,
      },
      conversation: [
        ...initial.conversation,
        {
          id: 'agent-source-old',
          role: 'assistant' as const,
          text: 'The PDF explains prefix coding.',
          citations: [{
            sourceId: 'trusted-source',
            sourceTitle: 'Trusted Lecture Notes',
            unitId: 'trusted-unit-1',
            label: 'Prefix-code theorem',
          }],
          createdAt: NOW,
        },
        { id: 'reader-math-new', role: 'user' as const, text: 'What is mathematics?', createdAt: NOW },
      ],
      budgetWindow: {
        ...initial.budgetWindow!,
        readerMessageId: 'reader-math-new',
      },
    };

    const tools = availableAgentToolNames(state);
    // The old attachment remains durable, but an unrelated current turn does
    // not even advertise source/RAG capabilities to the model.
    expect([...tools]).not.toEqual(expect.arrayContaining([
      'list_source_manifest',
      'plan_source_retrieval',
      'read_full_source',
      'read_source_range',
      'search_source_index',
      'rerank_source_hits',
    ]));
    expect(canCompleteConversation(state, [])).toEqual({ allowed: true });
  });

  it('treats the Preserve All toggle as a complete evidence gate without magic wording', () => {
    const initial = createInitialAgentState({
      identity: {
        taskId: 'task-preserve-toggle',
        threadId: 'thread-preserve-toggle',
        runId: 'run-preserve-toggle',
        bookId: 'current-book',
      },
      goal: 'Make notebook pages',
      preserveAllSourceInformation: true,
      now: NOW,
      userMessageId: 'reader-preserve-toggle',
    });
    const manifest = citationManifest();
    const state = {
      ...initial,
      sourceManifest: manifest,
      sourceCoverage: {
        manifestDigest: manifest.digest,
        mode: 'complete' as const,
        requiredUnitIds: ['trusted-unit-1'],
        readUnitIds: [],
        citedUnitIds: [],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: false,
        updatedAt: NOW,
      },
    };
    const tools = availableAgentToolNames(state);

    expect(tools.has('read_full_source')).toBe(true);
    expect(tools.has('inspect_notebook')).toBe(false);
    expect(tools.has('submit_notebook_script')).toBe(false);
    expect(tools.has('finish_conversation')).toBe(false);
  });

  it('keeps retrieval available and required when the current request names its source', async () => {
    const initial = createInitialAgentState({
      identity: {
        taskId: 'task-current-source',
        threadId: 'thread-current-source',
        runId: 'run-current-source',
        bookId: 'current-book',
      },
      goal: 'Find the prefix-code explanation in the attached PDF',
      now: NOW,
      userMessageId: 'reader-current-source',
    });
    const manifest = citationManifest();
    const state = {
      ...initial,
      sourceManifest: manifest,
      sourceCoverage: {
        manifestDigest: manifest.digest,
        mode: 'relevant' as const,
        requiredUnitIds: [],
        readUnitIds: [],
        citedUnitIds: [],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: false,
        updatedAt: NOW,
      },
    };
    const ensureIndexed = vi.fn(async () => []);
    const search = vi.fn(async () => [{
      sourceId: 'trusted-source',
      unitId: 'trusted-unit-1',
      anchor: manifest.sources[0]!.units[0]!.anchor,
      text: 'A prefix code assigns decodable bit strings.',
      digest: 'trusted-unit-digest-1',
      lexicalScore: 1,
    }]);
    const adapters = {
      ...toolAdapters(),
      retrieval: {
        ensureIndexed,
        search,
        rerank: async () => [],
      },
    } satisfies AgentAdapters;
    const catalog = new AgentToolCatalog(
      adapters,
      new AgentEventBus(state.identity, new InMemoryAgentPersistence(), () => NOW),
    );

    expect([...availableAgentToolNames(state)]).toEqual(expect.arrayContaining([
      'plan_source_retrieval',
      'read_full_source',
      'read_source_range',
      'search_source_index',
      'rerank_source_hits',
      'inspect_source_coverage',
    ]));
    expect(availableAgentToolNames(state).has('list_source_manifest')).toBe(false);
    expect(canCompleteConversation(state, [])).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/read and cite the attached source/i),
    });

    const result = await catalog.execute(state, {
      id: 'search-current-source',
      name: 'search_source_index',
      arguments: {
        query: 'prefix code',
        sourceIds: ['trusted-source'],
        limit: 4,
      },
    }, new AbortController().signal);
    expect(result.result).toMatchObject({ hits: [expect.objectContaining({
      unitId: 'trusted-unit-1',
    })] });
    expect(ensureIndexed).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('rejects a paraphrased second clarification after the reader already answered', async () => {
    const identity = {
      taskId: 'task-question-watchdog',
      threadId: 'thread-question-watchdog',
      runId: 'run-question-watchdog',
      bookId: 'current-book',
    };
    const tools = new AgentToolCatalog(
      toolAdapters(),
      new AgentEventBus(identity, new InMemoryAgentPersistence(), () => NOW),
    );
    const initial = createInitialAgentState({
      identity,
      goal: 'Add something to my book',
      now: NOW,
      userMessageId: 'reader-question-watchdog',
    });
    const firstCall = {
      id: 'ask-once',
      name: 'ask_user',
      arguments: {
        kind: 'requirements',
        question: 'What topic should I add?',
      },
    } as const;
    const stateWithAssistantCall = {
      ...initial,
      modelHistory: [
        ...initial.modelHistory,
        {
          id: 'assistant-ask-once',
          role: 'assistant' as const,
          content: '',
          toolCalls: [firstCall],
          createdAt: NOW,
        },
      ],
    };
    const first = await tools.execute(
      stateWithAssistantCall,
      firstCall,
      new AbortController().signal,
    );
    expect(first.interrupt?.kind).toBe('requirements');
    const resumed = await tools.completeInterrupt(
      first.state,
      firstCall,
      {
        kind: 'requirements_answer',
        response: 'Use the lion explanation.',
        userMessageId: 'reader-question-answer',
      },
      new AbortController().signal,
    );
    const stateWithAnswerReceipt = {
      ...resumed.state,
      modelHistory: [
        ...resumed.state.modelHistory,
        {
          id: 'tool-ask-once',
          role: 'tool' as const,
          toolCallId: firstCall.id,
          toolName: firstCall.name,
          content: resumed.result,
          isError: false,
          createdAt: NOW,
        },
      ],
    };
    const repeated = await tools.execute(
      stateWithAnswerReceipt,
      {
        ...firstCall,
        id: 'ask-twice',
        arguments: {
          kind: 'requirements',
          question: 'What specific topic would you like me to include?',
        },
      },
      new AbortController().signal,
    );

    expect(repeated.interrupt).toBeUndefined();
    expect(repeated.result).toMatchObject({
      error: expect.stringMatching(/already answered.*clarification/i),
      retryable: true,
    });
    expect(repeated.state.conversation.filter(
      (message) => message.role === 'assistant' && message.text === 'What topic should I add?',
    )).toHaveLength(1);
    const afterRejectedQuestion = {
      ...repeated.state,
      modelHistory: [
        ...repeated.state.modelHistory,
        {
          id: 'tool-ask-twice',
          role: 'tool' as const,
          toolCallId: 'ask-twice',
          toolName: 'ask_user',
          content: repeated.result,
          isError: true,
          createdAt: NOW,
        },
      ],
    };
    expect(availableAgentToolNames(afterRejectedQuestion).has('ask_user')).toBe(false);
  });

  it.each([
    { kind: 'before_page', pageId: 'foreign-page' },
    { kind: 'after_page', pageId: 'foreign-page' },
    { kind: 'new_pages', afterPageId: 'foreign-page' },
  ] satisfies readonly NotebookInsertionTarget[])(
    'rejects a foreign $kind anchor before it can become the reviewed target',
    async (target) => {
      const identity = {
        taskId: `task-${target.kind}`,
        threadId: `thread-${target.kind}`,
        runId: `run-${target.kind}`,
        bookId: 'current-book',
      };
      const persistence = new InMemoryAgentPersistence();
      const events = new AgentEventBus(identity, persistence, () => NOW);
      const tools = new AgentToolCatalog(toolAdapters(), events);
      const initial = createInitialAgentState({
        identity,
        goal: 'Add reviewed pages',
        now: NOW,
        userMessageId: 'message-1',
      });
      const state = {
        ...initial,
        lifecycle: 'running' as const,
        notebookSnapshot: {
          bookId: 'current-book',
          bookRevision: 'current-revision',
          pageIds: ['owned-page'],
          pageRevisions: { 'owned-page': 'owned-revision' },
          capturedAt: NOW,
        },
      };

      const result = await tools.execute(
        state,
        {
          id: `call-${target.kind}`,
          name: 'propose_insertion',
          arguments: { target },
        },
        new AbortController().signal,
      );

      expect(result.result).toEqual({
        error: 'the insertion page does not belong to the current notebook',
        retryable: true,
      });
      expect(result.state.insertionTarget).toBeUndefined();
    },
  );

  it.each([
    { requested: { kind: 'after_page' as const }, expected: { kind: 'after_page', pageId: 'owned-page-2' } },
    { requested: { kind: 'before_page' as const }, expected: { kind: 'before_page', pageId: 'owned-page-1' } },
    { requested: { kind: 'caret' as const }, expected: { kind: 'after_page', pageId: 'owned-page-2' } },
  ])('resolves an incomplete $requested.kind placement from the inspected notebook', async ({ requested, expected }) => {
    const identity = {
      taskId: `task-default-${requested.kind}`,
      threadId: `thread-default-${requested.kind}`,
      runId: `run-default-${requested.kind}`,
      bookId: 'current-book',
    };
    const persistence = new InMemoryAgentPersistence();
    const tools = new AgentToolCatalog(
      toolAdapters(),
      new AgentEventBus(identity, persistence, () => NOW),
    );
    const state = {
      ...createInitialAgentState({
        identity,
        goal: 'Insert this in the book',
        now: NOW,
        userMessageId: 'message-default-target',
      }),
      lifecycle: 'running' as const,
      notebookSnapshot: {
        bookId: 'current-book',
        bookRevision: 'current-revision',
        pageIds: ['owned-page-1', 'owned-page-2'],
        pageRevisions: { 'owned-page-1': 'revision-1', 'owned-page-2': 'revision-2' },
        capturedAt: NOW,
      },
    };

    const result = await tools.execute(state, {
      id: `call-default-${requested.kind}`,
      name: 'propose_insertion',
      arguments: { target: requested },
    }, new AbortController().signal);

    expect(result.result).not.toHaveProperty('error');
    expect(result.state.insertionTarget).toEqual(expected);
  });

  it('shows an explicit placement conflict instead of selecting the first option', () => {
    const preview: UserPreviewContract = {
      previewId: 'preview-1',
      generationId: 'generation-1',
      draftHash: 'draft-1',
      layoutHash: 'layout-1',
      bookId: 'current-book',
      expectedBookRevision: 'revision-1',
      insertionTarget: { kind: 'after_page', pageId: 'missing-page' },
      expectedPageCount: 1,
      pages: [{
        pageId: 'draft-page-1',
        pageNumber: 1,
        width: 620,
        height: 720,
        image: {
          resourceId: 'render-1',
          mimeType: 'image/png',
          digest: 'render-digest-1',
          width: 620,
          height: 720,
        },
        textDigest: 'text-digest-1',
        layoutDigest: 'page-layout-1',
        paginationSpill: false,
        residualOverflow: false,
      }],
      assumptions: [],
      citations: [],
      imageGenerationPrompts: [],
      sourceCoverage: {
        manifestDigest: 'manifest-1',
        mode: 'relevant',
        requiredUnitIds: [],
        readUnitIds: [],
        citedUnitIds: [],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: NOW,
      },
      visualReview: {
        generationId: 'generation-1',
        draftHash: 'draft-1',
        requiredPageIds: ['draft-page-1'],
        imageExposures: [],
        inspectedPageIds: ['draft-page-1'],
        findings: [],
        complete: true,
        passed: true,
        updatedAt: NOW,
      },
      validation: {
        draftHash: 'draft-1',
        parserDiagnostics: [],
        staticDiagnostics: [],
        imageDiagnostics: [],
        pageLedgerDiagnostics: [],
        valid: true,
        checkedAt: NOW,
      },
    };
    const state = {
      ...createInitialAgentState({
        identity: {
          taskId: 'task-preview',
          threadId: 'thread-preview',
          runId: 'run-preview',
          bookId: 'current-book',
        },
        goal: 'Build a reviewed note',
        now: NOW,
        userMessageId: 'message-preview',
      }),
      lifecycle: 'waiting_for_preview_decision' as const,
      phase: 'waiting_for_preview_decision' as const,
    };
    const snapshot: AgentRuntimeSnapshot = {
      state,
      interrupt: {
        kind: 'final_preview',
        title: 'Reviewed draft',
        preview,
        decisions: ['approve', 'reject', 'feedback', 'change_location'],
      },
      busy: false,
    };
    const changePlacement = vi.fn();
    const core = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: () => () => undefined,
      changePlacement,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({
        status: 'connected',
        provider: 'Cohere',
        firstUse: false,
      }),
      placements: () => [
        {
          id: 'book-end',
          label: 'At the end',
          target: { kind: 'book_end' },
        },
        {
          id: 'book-start',
          label: 'At the beginning',
          target: { kind: 'book_start' },
        },
      ],
      renderUrlFor: (image) => `asset://${image.resourceId}`,
      onApprovedProposal: () => undefined,
    });

    try {
      expect(controller.state().preview).toMatchObject({
        placementId: '',
        conflict: {
          title: 'This placement is no longer available',
        },
      });
      expect(controller.state().preview?.placements.map((item) => item.id)).toEqual([
        'book-end',
        'book-start',
      ]);
      expect(changePlacement).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it('applies one approved preview exactly once before marking the task complete', async () => {
    const { ready, preview, proposal } = panelApplyFixture();
    let snapshot: AgentRuntimeSnapshot = {
      state: {
        ...ready,
        lifecycle: 'waiting_for_preview_decision',
        phase: 'waiting_for_preview_decision',
        patchProposal: proposal,
      },
      interrupt: {
        kind: 'final_preview',
        title: 'Review the finished notebook draft',
        preview,
        decisions: ['approve', 'reject', 'feedback', 'change_location'],
      },
      busy: false,
    };
    let runtimeListener: ((value: AgentRuntimeSnapshot) => void) | undefined;
    const approvePreview = vi.fn(async () => {
      const approved = { ...proposal, status: 'approved_pending_apply' as const };
      snapshot = {
        state: { ...snapshot.state!, patchProposal: approved },
        interrupt: null,
        busy: false,
      };
      runtimeListener?.(snapshot);
      return approved;
    });
    const onApprovedProposal = vi.fn(async () => undefined);
    const finalizeApprovedPatch = vi.fn(async (
      _patchId: string,
      outcome: { readonly applied: boolean },
    ) => {
      expect(outcome).toEqual({ applied: true });
      snapshot = {
        state: {
          ...snapshot.state!,
          lifecycle: 'completed',
          phase: 'finished',
          patchProposal: { ...snapshot.state!.patchProposal!, status: 'applied' },
        },
        interrupt: null,
        busy: false,
      };
      runtimeListener?.(snapshot);
      return { state: snapshot.state! };
    });
    const sendUserMessage = vi.fn();
    const refreshFailedPreview = vi.fn();
    const core = {
      getSnapshot: () => snapshot,
      subscribe: (listener: (value: AgentRuntimeSnapshot) => void) => {
        runtimeListener = listener;
        return () => { runtimeListener = undefined; };
      },
      subscribeEvents: () => () => undefined,
      approvePreview,
      finalizeApprovedPatch,
      refreshFailedPreview,
      sendUserMessage,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: ready.identity.bookId,
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      placements: () => [{ id: 'book-end', label: 'At the end', target: { kind: 'book_end' } }],
      renderUrlFor: (image) => `asset://${image.resourceId}`,
      onApprovedProposal,
    });

    try {
      controller.approveInsert?.(preview.previewId);
      await vi.waitFor(() => expect(finalizeApprovedPatch).toHaveBeenCalledWith(
        proposal.patchId,
        { applied: true },
      ));
      expect(approvePreview).toHaveBeenCalledTimes(1);
      expect(onApprovedProposal).toHaveBeenCalledTimes(1);
      expect(onApprovedProposal).toHaveBeenCalledWith(expect.objectContaining({
        patchId: proposal.patchId,
        status: 'approved_pending_apply',
      }));
      expect(finalizeApprovedPatch).toHaveBeenCalledTimes(1);
      expect(snapshot.state?.patchProposal?.status).toBe('applied');
      expect(sendUserMessage).not.toHaveBeenCalled();
      expect(refreshFailedPreview).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it('routes a failed Insert through dedicated preview recovery instead of a synthetic chat turn', async () => {
    const generation = reviewedGeneration('apply-generation', 'apply-draft', 'apply-layout');
    const ready = reviewReadyState(generation);
    const preview: UserPreviewContract = {
      previewId: 'apply-preview',
      generationId: generation.generationId,
      draftHash: generation.draftHash,
      layoutHash: generation.layoutHash,
      bookId: ready.identity.bookId,
      expectedBookRevision: ready.notebookSnapshot.bookRevision,
      insertionTarget: ready.insertionTarget,
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
        updatedAt: NOW,
      },
      visualReview: {
        ...ready.visualReview,
        imageExposures: generation.pages.map((page) => ({
          generationId: generation.generationId,
          pageId: page.pageId,
          imageDigest: page.image.digest,
          layoutDigest: page.layoutDigest,
          readRequestedAtProviderCall: 1,
          exposedAt: NOW,
        })),
        inspectedPageIds: generation.pages.map((page) => page.pageId),
        complete: true,
        passed: true,
      },
      validation: ready.validation,
    };
    const proposal: NotebookPatchProposal = {
      patchId: 'apply-patch',
      idempotencyKey: 'apply-idempotency',
      runId: ready.identity.runId,
      draftVersion: ready.draft.version,
      draftHash: ready.draft.draftHash,
      script: ready.draft.script,
      expectedBookRevision: ready.notebookSnapshot.bookRevision,
      insertionTarget: ready.insertionTarget,
      preview,
      status: 'waiting_for_approval',
      createdAt: NOW,
    };
    let snapshot: AgentRuntimeSnapshot = {
      state: {
        ...ready,
        lifecycle: 'waiting_for_preview_decision',
        phase: 'waiting_for_preview_decision',
        patchProposal: proposal,
      },
      interrupt: {
        kind: 'final_preview',
        title: 'Review the finished notebook draft',
        preview,
        decisions: ['approve', 'reject', 'feedback', 'change_location'],
      },
      busy: false,
    };
    let runtimeListener: ((value: AgentRuntimeSnapshot) => void) | undefined;
    const sendUserMessage = vi.fn();
    const refreshFailedPreview = vi.fn(async () => ({ state: snapshot.state! }));
    const approvePreview = vi.fn(async () => {
      const approved = { ...proposal, status: 'approved_pending_apply' as const };
      snapshot = {
        state: { ...snapshot.state!, patchProposal: approved },
        interrupt: null,
        busy: false,
      };
      runtimeListener?.(snapshot);
      return approved;
    });
    const finalizeApprovedPatch = vi.fn(async (
      _patchId: string,
      outcome: { readonly applied: boolean; readonly message?: string },
    ) => {
      if (!outcome.applied) {
        snapshot = {
          state: {
            ...snapshot.state!,
            patchProposal: { ...snapshot.state!.patchProposal!, status: 'apply_failed' },
            lastError: {
              code: 'stale_context',
              message: outcome.message ?? 'apply failed',
              retryable: true,
            },
            lastApplyFailure: {
              patchId: proposal.patchId,
              previewId: preview.previewId,
              message: outcome.message ?? 'apply failed',
              failedAt: NOW,
            },
          },
          interrupt: null,
          busy: false,
        };
        runtimeListener?.(snapshot);
      }
      return { state: snapshot.state! };
    });
    const core = {
      getSnapshot: () => snapshot,
      subscribe: (listener: (value: AgentRuntimeSnapshot) => void) => {
        runtimeListener = listener;
        return () => { runtimeListener = undefined; };
      },
      subscribeEvents: () => () => undefined,
      approvePreview,
      finalizeApprovedPatch,
      refreshFailedPreview,
      sendUserMessage,
    } as unknown as CoreAiAgentController;
    const applyError = new Error('The notebook changed after this preview was reviewed.');
    const onError = vi.fn();
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      placements: () => [{
        id: 'book-end',
        label: 'At the end',
        target: { kind: 'book_end' },
      }],
      renderUrlFor: (image) => `asset://${image.resourceId}`,
      onApprovedProposal: async () => { throw applyError; },
      onError,
    });

    try {
      controller.approveInsert?.(preview.previewId);
      await vi.waitFor(() => expect(finalizeApprovedPatch).toHaveBeenCalledWith(
        proposal.patchId,
        { applied: false, message: applyError.message },
      ));
      expect(snapshot.state?.patchProposal?.status).toBe('apply_failed');

      controller.refreshAfterConflict?.(preview.previewId);
      await vi.waitFor(() => expect(refreshFailedPreview).toHaveBeenCalledTimes(1));
      expect(sendUserMessage).not.toHaveBeenCalled();
      expect(JSON.stringify(snapshot.state?.conversation)).not.toMatch(
        /Refresh the final preview against the notebook/i,
      );
      expect(buildAiAgentDiagnosticLog(
        snapshot,
        [],
        { status: 'connected', provider: 'Cohere', keyKind: 'trial' },
        [],
      )).toContain(applyError.message);
    } finally {
      controller.dispose();
    }
  });
});

describe('AI panel queued-source handoff', () => {
  it('rotates friendly working phrases deterministically and copies a key-free task trace', () => {
    const phrases = new Set(
      Array.from({ length: 12 }, (_, index) => friendlyWorkingNote('intake', `task-${index}`)),
    );
    expect(phrases.size).toBeGreaterThan(1);
    expect([...phrases].every((phrase) => phrase.endsWith('…'))).toBe(true);

    const state = citationReadyState();
    const log = buildAiAgentDiagnosticLog(
      { state, interrupt: null, busy: false },
      [{ id: 'reader-log', kind: 'message', role: 'reader', text: 'Add this to my book' }, {
        id: 'tool-log',
        kind: 'tool',
        name: 'validate_notebook_script',
        summary: 'deterministic checks passed',
        status: 'done',
      }],
      { status: 'connected', provider: 'Cohere', keyKind: 'trial' },
      [],
    );
    expect(log).toContain('Add this to my book');
    expect(log).toContain('validate_notebook_script');
    expect(log).toContain('providerCalls');
    expect(log).not.toContain('"apiKey"');
    expect(log).not.toContain('sourceCoverage');
  });

  it('collapses conversational completion chrome to the reader and answer only', () => {
    const initial = createInitialAgentState({
      identity: {
        taskId: 'task-conversation-cleanup',
        threadId: 'thread-conversation-cleanup',
        runId: 'run-conversation-cleanup',
        bookId: 'current-book',
      },
      goal: 'Explain Huffman coding',
      now: NOW,
      userMessageId: 'message-conversation-question',
    });
    const state = {
      ...initial,
      lifecycle: 'completed' as const,
      phase: 'finished' as const,
      conversation: [
        ...initial.conversation,
        {
          id: 'message-conversation-answer',
          role: 'assistant' as const,
          text: 'Huffman coding gives common symbols shorter bit patterns.',
          createdAt: NOW,
        },
      ],
    };
    let eventListener: ((event: AgentActivityEvent) => void) | undefined;
    const core = {
      getSnapshot: () => ({ state, interrupt: null, busy: false }),
      subscribe: () => () => undefined,
      subscribeEvents: (listener: (event: AgentActivityEvent) => void) => {
        eventListener = listener;
        return () => undefined;
      },
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      placements: () => [],
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
    });
    const base = {
      id: 'event-completion-chrome',
      sequence: 1,
      threadId: state.identity.threadId,
      taskId: state.identity.taskId,
      runId: state.identity.runId,
      at: NOW,
    };

    try {
      eventListener?.({ ...base, type: 'run.started', goal: state.taskBrief.goal });
      eventListener?.({ ...base, id: 'event-status', sequence: 2, type: 'status.changed', phase: 'intake', summary: 'Understanding the task' });
      eventListener?.({ ...base, id: 'event-complete', sequence: 3, type: 'run.completed', summary: 'No notebook mutation' });
      expect(controller.state().timeline).toHaveLength(2);
      expect(controller.state().timeline.every((item) => item.kind === 'message')).toBe(true);
    } finally {
      controller.dispose();
    }
  });

  it('never resurrects a completed turn’s progress bars during a follow-up', () => {
    const visible = latestTurnTimeline([
      { id: 'reader-old', kind: 'message', role: 'reader', text: 'hi' },
      { id: 'status-old', kind: 'activity', label: 'Understanding', status: 'running' },
      { id: 'agent-old', kind: 'message', role: 'agent', text: 'Hello!' },
      { id: 'complete-old', kind: 'activity', label: 'Agent work complete', status: 'done' },
      { id: 'reader-new', kind: 'message', role: 'reader', text: 'Explain lions' },
      { id: 'status-new', kind: 'activity', label: 'Reading', status: 'running' },
    ]);

    expect(visible.map((item) => item.id)).toEqual([
      'reader-old',
      'agent-old',
      'reader-new',
      'status-new',
    ]);
  });

  it('keeps only the current activity animated and settles every retained bar', () => {
    const timeline = [
      { id: 'reader', kind: 'message' as const, role: 'reader' as const, text: 'make notes' },
      {
        id: 'status-read',
        kind: 'activity' as const,
        label: 'Reading',
        status: 'running' as const,
        progress: 0.2,
      },
      {
        id: 'status-render',
        kind: 'activity' as const,
        label: 'Rendering',
        status: 'running' as const,
        progress: 0.72,
      },
    ];

    expect(currentActivityTimeline(timeline, true)).toEqual([
      timeline[0],
      expect.objectContaining({ id: 'status-read', status: 'done', progress: undefined }),
      timeline[2],
    ]);
    expect(currentActivityTimeline(timeline, false)).toEqual([
      timeline[0],
      expect.objectContaining({ id: 'status-read', status: 'done', progress: undefined }),
      expect.objectContaining({ id: 'status-render', status: 'done', progress: undefined }),
    ]);
  });

  it('shows a submitted reader message immediately and hides the internal completion tool', async () => {
    const state = createInitialAgentState({
      identity: {
        taskId: 'task-optimistic-message',
        threadId: 'thread-optimistic-message',
        runId: 'run-optimistic-message',
        bookId: 'current-book',
      },
      goal: 'Existing task',
      now: NOW,
      userMessageId: 'existing-message',
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let eventListener: ((event: AgentActivityEvent) => void) | undefined;
    const sendUserMessage = vi.fn(async () => {
      await pending;
      return { state };
    });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const core = {
      getSnapshot: () => ({ state, interrupt: null, busy: false }),
      subscribe: () => () => undefined,
      subscribeEvents: (listener: (event: AgentActivityEvent) => void) => {
        eventListener = listener;
        return () => undefined;
      },
      sendUserMessage,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      placements: () => [],
      insertionTarget: () => ({ kind: 'book_end' }),
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
    });

    try {
      const sending = controller.send?.('hello now');
      expect(controller.state().timeline).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'message', role: 'reader', text: 'hello now' }),
      ]));
      expect(sendUserMessage).not.toHaveBeenCalled();
      frames.shift()?.(0);
      await Promise.resolve();
      expect(sendUserMessage).not.toHaveBeenCalled();
      frames.shift()?.(16);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sendUserMessage).toHaveBeenCalledWith('hello now', expect.objectContaining({
        insertionTarget: { kind: 'book_end' },
        userMessageId: expect.stringMatching(/^msg-local-/),
      }));

      eventListener?.({
        type: 'tool.started',
        id: 'event-finish',
        runId: state.identity.runId,
        threadId: state.identity.threadId,
        taskId: state.identity.taskId,
        sequence: 1,
        at: NOW,
        toolCallId: 'finish-call',
        toolName: 'finish_conversation',
        summary: 'answered in chat',
      });
      expect(controller.state().timeline.some(
        (item) => item.kind === 'tool' && item.name === 'finish_conversation',
      )).toBe(false);
      release();
      await sending;
    } finally {
      release();
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('keeps one natural question in conversation and sends the exact free-text reply', async () => {
    const question = {
      id: 'message-question',
      role: 'assistant' as const,
      text: 'What specific topic should I turn into pages?',
      createdAt: NOW,
    };
    const state = {
      ...createInitialAgentState({
        identity: {
          taskId: 'task-requirement-panel',
          threadId: 'thread-requirement-panel',
          runId: 'run-requirement-panel',
          bookId: 'current-book',
        },
        goal: 'Insert content in the book',
        now: NOW,
        userMessageId: 'message-requirement-panel',
      }),
      lifecycle: 'waiting_for_user' as const,
      conversation: [
        ...createInitialAgentState({
          identity: {
            taskId: 'task-requirement-panel',
            threadId: 'thread-requirement-panel',
            runId: 'run-requirement-panel',
            bookId: 'current-book',
          },
          goal: 'Insert content in the book',
          now: NOW,
          userMessageId: 'message-requirement-panel',
        }).conversation,
        question,
      ],
    };
    const snapshot: AgentRuntimeSnapshot = {
      state,
      interrupt: {
        kind: 'requirements',
        title: 'A quick question',
        allowSensibleDefaults: false,
        questions: [{
          id: 'ask-call',
          prompt: question.text,
          allowFreeText: true,
        }],
        messageId: question.id,
      },
      busy: false,
    };
    const sendUserMessage = vi.fn(async () => ({ state }));
    const core = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: () => () => undefined,
      sendUserMessage,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      placements: () => [],
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
    });

    try {
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
      expect(controller.state().timeline).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: question.id,
          kind: 'message',
          role: 'agent',
          text: question.text,
        }),
      ]));
      expect(controller.state().timeline.map((item) => item.kind)).not.toContain('question');

      await controller.send?.('Use the lion explanation from above.');
      expect(sendUserMessage).toHaveBeenCalledWith(
        'Use the lion explanation from above.',
        expect.objectContaining({ userMessageId: expect.stringMatching(/^msg-local-/) }),
      );
      expect(controller.state().timeline.filter(
        (item) => item.kind === 'message' && item.role === 'reader' &&
          item.text === 'Use the lion explanation from above.',
      )).toHaveLength(1);
    } finally {
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('keeps stopped recovery visible and preserves a follow-up through the controller', async () => {
    const initial = createInitialAgentState({
      identity: {
        taskId: 'task-stopped-panel',
        threadId: 'thread-stopped-panel',
        runId: 'run-stopped-panel',
        bookId: 'current-book',
      },
      goal: 'Build a cheerful lesson',
      now: NOW,
      userMessageId: 'message-stopped-panel',
    });
    const stopped = {
      ...initial,
      lifecycle: 'cancelled' as const,
      cancellation: {
        requested: true,
        requestedAt: NOW,
        reason: 'Reader pressed Stop',
        lastSafeCheckpointStep: 2,
      },
      lastError: {
        code: 'cancelled' as const,
        message: 'Reader pressed Stop',
        retryable: true,
      },
    };
    const snapshot: AgentRuntimeSnapshot = {
      state: stopped,
      interrupt: null,
      busy: false,
    };
    const sendUserMessage = vi.fn(async () => ({ state: stopped }));
    const retry = vi.fn(async () => ({ state: stopped }));
    const core = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: () => () => undefined,
      sendUserMessage,
      retry,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({
        status: 'connected',
        provider: 'Cohere',
        firstUse: false,
      }),
      placements: () => [],
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
    });

    try {
      expect(controller.state()).toMatchObject({
        stage: 'cancelled',
        headline: 'Stopped safely',
        canSend: true,
        error: {
          title: 'Continue whenever you are ready',
          retryable: true,
          tone: 'stopped',
          actionLabel: 'Continue',
        },
      });
      expect(controller.state().error?.detail).toContain('last safe checkpoint');

      await controller.send?.('Please continue with a gentler visual style.');
      expect(sendUserMessage).toHaveBeenCalledWith(
        'Please continue with a gentler visual style.',
        expect.objectContaining({ preserveAllSourceInformation: false }),
      );

      controller.retry?.();
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      controller.dispose();
    }
  });

  it('registers changed queued attachments exactly once before the next provider turn', async () => {
    const state = {
      ...createInitialAgentState({
        identity: {
          taskId: 'task-queued',
          threadId: 'thread-queued',
          runId: 'run-queued',
          bookId: 'current-book',
        },
        goal: 'Continue this task',
        now: NOW,
        userMessageId: 'message-queued',
      }),
      lifecycle: 'waiting_for_user' as const,
    };
    const snapshot: AgentRuntimeSnapshot = {
      state,
      interrupt: null,
      busy: false,
    };
    let queued = [{
      kind: 'managed_asset' as const,
      assetId: 'queued-one',
      title: 'One.pdf',
      mediaType: 'application/pdf',
      digest: 'digest-one',
    }];
    const order: string[] = [];
    const registerAttachments = vi.fn(async (attachments) => {
      order.push(`register:${attachments.map((item) =>
        item.kind === 'managed_asset' ? item.assetId : item.kind).join(',')}`);
      return snapshot;
    });
    const sendUserMessage = vi.fn(async (message: string) => {
      order.push(`send:${message}`);
      return { state };
    });
    const core = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: () => () => undefined,
      registerAttachments,
      sendUserMessage,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({
        status: 'connected',
        provider: 'Cohere',
        firstUse: false,
      }),
      sourceAttachments: () => queued,
      placements: () => [],
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
    });

    try {
      await controller.send?.('first turn');
      expect(order).toEqual([
        'register:queued-one',
        'send:first turn',
      ]);

      await controller.send?.('same queue');
      expect(order).toEqual([
        'register:queued-one',
        'send:first turn',
        'send:same queue',
      ]);

      queued = [{
        kind: 'managed_asset',
        assetId: 'queued-two',
        title: 'Two.pdf',
        mediaType: 'application/pdf',
        digest: 'digest-two',
      }];
      await controller.send?.('changed queue');
      expect(order.slice(-2)).toEqual([
        'register:queued-two',
        'send:changed queue',
      ]);
      expect(registerAttachments).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenCalledTimes(3);
    } finally {
      controller.dispose();
    }
  });

  it('serializes rapid double-send behind one registration operation', async () => {
    const state = {
      ...createInitialAgentState({
        identity: {
          taskId: 'task-double-send',
          threadId: 'thread-double-send',
          runId: 'run-double-send',
          bookId: 'current-book',
        },
        goal: 'Continue safely',
        now: NOW,
        userMessageId: 'message-double-send',
      }),
      lifecycle: 'waiting_for_user' as const,
    };
    let busy = false;
    const snapshot = (): AgentRuntimeSnapshot => ({ state, interrupt: null, busy });
    let releaseRegistration!: () => void;
    const registrationBarrier = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    const registerAttachments = vi.fn(async () => {
      if (busy) throw new Error('stop or wait for the current turn before attaching more sources');
      busy = true;
      await registrationBarrier;
      busy = false;
      return snapshot();
    });
    const sendUserMessage = vi.fn(async () => ({ state }));
    const onError = vi.fn();
    const core = {
      getSnapshot: snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: () => () => undefined,
      registerAttachments,
      sendUserMessage,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      sourceAttachments: () => [{
        kind: 'managed_asset',
        assetId: 'double-send-pdf',
        title: 'Double send.pdf',
        mediaType: 'application/pdf',
        digest: 'double-send-digest',
      }],
      placements: () => [],
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
      onError,
    });

    try {
      const first = controller.send?.('first');
      await vi.waitFor(() => expect(registerAttachments).toHaveBeenCalledTimes(1));
      const second = controller.send?.('second');
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(sendUserMessage).not.toHaveBeenCalled();
      releaseRegistration();
      await Promise.all([first, second]);
      expect(registerAttachments).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(sendUserMessage).toHaveBeenCalledWith('first', expect.objectContaining({
        preserveAllSourceInformation: false,
      }));
    } finally {
      controller.dispose();
    }
  });

  it('does not send the turn when queued-source registration fails', async () => {
    const state = createInitialAgentState({
      identity: {
        taskId: 'task-register-failure',
        threadId: 'thread-register-failure',
        runId: 'run-register-failure',
        bookId: 'current-book',
      },
      goal: 'Continue safely',
      now: NOW,
      userMessageId: 'message-register-failure',
    });
    const snapshot: AgentRuntimeSnapshot = {
      state,
      interrupt: null,
      busy: false,
    };
    const error = new Error('attachment ingest failed');
    const registerAttachments = vi.fn(async () => Promise.reject(error));
    const sendUserMessage = vi.fn();
    const onError = vi.fn();
    const core = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: () => () => undefined,
      registerAttachments,
      sendUserMessage,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({
        status: 'connected',
        provider: 'Cohere',
        firstUse: false,
      }),
      sourceAttachments: () => [{
        kind: 'managed_asset',
        assetId: 'broken-source',
        title: 'Broken.pdf',
        mediaType: 'application/pdf',
        digest: 'broken-digest',
      }],
      placements: () => [],
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
      onError,
    });

    try {
      await controller.send?.('must wait for evidence');
      expect(registerAttachments).toHaveBeenCalledTimes(1);
      expect(sendUserMessage).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(error);
    } finally {
      controller.dispose();
    }
  });

  it('marks restored pending sources as durable without re-ingesting them on Delete', async () => {
    const state = {
      ...createInitialAgentState({
        identity: {
          taskId: 'task-restored-pending',
          threadId: 'thread-restored-pending',
          runId: 'run-restored-pending',
          bookId: 'current-book',
        },
        goal: 'Retry this source later',
        now: NOW,
        userMessageId: 'message-restored-pending',
      }),
      lifecycle: 'failed' as const,
    };
    const snapshot: AgentRuntimeSnapshot = { state, interrupt: null, busy: false };
    let queued: SourceAttachmentRef[] = [];
    const registerAttachments = vi.fn(async () => snapshot);
    const onSelectThread = vi.fn(async () => {
      queued = [{
        kind: 'managed_asset',
        assetId: 'pending-after-restart',
        title: 'Pending.pdf',
        mediaType: 'application/pdf',
        digest: 'pending-digest',
      }];
    });
    const onDeleteThread = vi.fn(async () => undefined);
    const core = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: () => () => undefined,
      registerAttachments,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      sourceAttachments: () => queued,
      placements: () => [],
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
      onSelectThread,
      onDeleteThread,
    });

    try {
      controller.selectThread?.('task-restored-pending');
      await vi.waitFor(() => expect(onSelectThread).toHaveBeenCalledTimes(1));
      controller.deleteThread?.('task-restored-pending');
      await vi.waitFor(() => expect(onDeleteThread).toHaveBeenCalledTimes(1));
      expect(registerAttachments).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it('does not re-ingest a durably pending initial queue when its failed task is deleted', async () => {
    const pending: SourceAttachmentRef[] = [{
      kind: 'managed_asset',
      assetId: 'pending-initial-failure',
      title: 'Failed.pdf',
      mediaType: 'application/pdf',
      digest: 'failed-digest',
    }];
    const failedState = {
      ...createInitialAgentState({
        identity: {
          taskId: 'task-initial-failure',
          threadId: 'thread-initial-failure',
          runId: 'run-initial-failure',
          bookId: 'current-book',
        },
        goal: 'Read this PDF',
        now: NOW,
        userMessageId: 'message-initial-failure',
      }),
      lifecycle: 'failed' as const,
      pendingSourceAttachments: pending,
    };
    let snapshot: AgentRuntimeSnapshot = { state: null, interrupt: null, busy: false };
    const startTask = vi.fn(async () => {
      snapshot = { state: failedState, interrupt: null, busy: false };
      throw new Error('PDF extraction failed');
    });
    const registerAttachments = vi.fn(async () => snapshot);
    const onDeleteThread = vi.fn(async () => undefined);
    const onError = vi.fn();
    const core = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: () => () => undefined,
      startTask,
      registerAttachments,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      sourceAttachments: () => pending,
      placements: () => [],
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
      onDeleteThread,
      onError,
    });

    try {
      await controller.send?.('Read this PDF');
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        message: 'PDF extraction failed',
      }));
      controller.deleteThread?.('task-initial-failure');
      await vi.waitFor(() => expect(onDeleteThread).toHaveBeenCalledTimes(1));
      expect(registerAttachments).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });
});

describe('AI native-page visual review authority', () => {
  it('rejects a preview-image batch above the provider-native 20 image limit', async () => {
    const generation = reviewedGeneration();
    const state = reviewReadyState(generation);
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(state.identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(toolAdapters(), events);
    const result = await tools.execute(state, {
      id: 'call-too-many-preview-pages',
      name: 'read_draft_preview_pages',
      arguments: {
        generationId: generation.generationId,
        pageIds: Array.from({ length: 21 }, (_, index) => `page-${index + 1}`),
      },
    }, new AbortController().signal);

    expect(result.result).toEqual({
      error: 'invalid read_draft_preview_pages arguments',
      retryable: true,
    });
    expect(result.imageRefs).toBeUndefined();
    expect(result.state.visualReview?.imageExposures).toEqual([]);
  });

  it('rejects a model-authored resolved flag instead of trusting it', async () => {
    const generation = reviewedGeneration();
    const state = reviewReadyState(generation);
    const exposedState = {
      ...state,
      visualReview: recordVisualImageExposures(
        state.visualReview,
        generation,
        generation.pages,
        { now: NOW, providerCallCount: 1 },
      ),
    };
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(state.identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(toolAdapters(), events);

    const result = await tools.execute(exposedState, {
      id: 'call-forged-resolution',
      name: 'record_visual_review',
      arguments: {
        generationId: generation.generationId,
        reviews: [{
          pageId: generation.pages[0]!.pageId,
          findings: [{
            severity: 'blocking',
            category: 'clipping',
            summary: 'The footer is clipped.',
            resolved: true,
          }],
        }],
      },
    }, new AbortController().signal);

    expect(result.result).toEqual({
      error: 'invalid record_visual_review arguments',
      retryable: true,
    });
    expect(result.state.visualReview?.findings).toEqual([]);
  });

  it('keeps a blocking finding failed across repeated inspection and an identical rerender', async () => {
    const generation = reviewedGeneration();
    const page = generation.pages[0]!;
    const exposed = recordVisualImageExposures(
      createVisualReviewLedger(generation, NOW),
      generation,
      [page],
      { now: NOW, providerCallCount: 1 },
    );
    const blocked = recordVisualInspection(exposed, generation, {
      pageIds: [page.pageId],
      findings: [{
        id: 'blocking-1',
        generationId: generation.generationId,
        pageId: page.pageId,
        severity: 'blocking',
        category: 'clipping',
        summary: 'The footer is clipped.',
        resolved: false,
      }],
      providerCallCount: 2,
      now: NOW,
    });
    expect(blocked).toMatchObject({ complete: true, passed: false });

    const repeated = recordVisualInspection(blocked, generation, {
      pageIds: [page.pageId],
      findings: [],
      providerCallCount: 3,
      now: NOW,
    });
    expect(repeated).toMatchObject({ complete: true, passed: false });
    expect(repeated.findings).toEqual([expect.objectContaining({ id: 'blocking-1' })]);

    const base = reviewReadyState(generation);
    const state = { ...base, visualReview: repeated };
    const adapters: AgentAdapters = {
      ...toolAdapters(),
      sandbox: {
        validate: async () => state.validation,
        render: async () => generation,
        getGeneration: async () => generation,
        dispose: async () => undefined,
      },
    };
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(state.identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(adapters, events);
    const rendered = await tools.execute(state, {
      id: 'call-identical-rerender',
      name: 'render_draft_preview',
      arguments: {},
    }, new AbortController().signal);

    expect(rendered.state.visualReview).toMatchObject({
      generationId: generation.generationId,
      complete: true,
      passed: false,
      findings: [expect.objectContaining({ id: 'blocking-1', resolved: false })],
    });
  });

  it('starts an empty review ledger only for a changed draft and new generation', async () => {
    const oldGeneration = reviewedGeneration();
    const oldPage = oldGeneration.pages[0]!;
    const exposed = recordVisualImageExposures(
      createVisualReviewLedger(oldGeneration, NOW),
      oldGeneration,
      [oldPage],
      { now: NOW, providerCallCount: 1 },
    );
    const oldBlocked = recordVisualInspection(exposed, oldGeneration, {
      pageIds: [oldPage.pageId],
      findings: [{
        id: 'old-blocker',
        generationId: oldGeneration.generationId,
        pageId: oldPage.pageId,
        severity: 'blocking',
        category: 'collision',
        summary: 'Two blocks overlap.',
        resolved: false,
      }],
      providerCallCount: 2,
      now: NOW,
    });
    const newGeneration = reviewedGeneration(
      'review-generation-2',
      'review-draft-2',
      'review-layout-2',
    );
    const base = reviewReadyState(newGeneration);
    const state = {
      ...base,
      previewGeneration: oldGeneration,
      visualReview: oldBlocked,
    };
    const disposed: string[] = [];
    const adapters: AgentAdapters = {
      ...toolAdapters(),
      sandbox: {
        validate: async () => state.validation,
        render: async () => newGeneration,
        getGeneration: async () => newGeneration,
        dispose: async (generationId) => { disposed.push(generationId); },
      },
    };
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(state.identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(adapters, events);
    const rendered = await tools.execute(state, {
      id: 'call-new-generation',
      name: 'render_draft_preview',
      arguments: {},
    }, new AbortController().signal);

    expect(rendered.state.visualReview).toEqual({
      generationId: newGeneration.generationId,
      draftHash: newGeneration.draftHash,
      requiredPageIds: [newGeneration.pages[0]!.pageId],
      imageExposures: [],
      inspectedPageIds: [],
      findings: [],
      complete: false,
      passed: false,
      updatedAt: NOW,
    });
    await vi.waitFor(() => expect(disposed).toEqual([oldGeneration.generationId]));
  });
});

describe('AI task cancellation settlement', () => {
  it('waits for an uncooperative provider and permits no late persistence after Stop resolves', async () => {
    let providerEntered!: () => void;
    const providerStarted = new Promise<void>((resolve) => { providerEntered = resolve; });
    let releaseProvider!: () => void;
    const providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });
    class UncooperativeProvider implements AgentProvider {
      readonly id = 'uncooperative';
      capabilities(): Promise<AgentProviderCapabilities> {
        return Promise.resolve({
          providerId: this.id,
          modelId: 'uncooperative-test',
          toolUse: true,
          streaming: true,
          imageInput: false,
          maxInputTokens: 10_000,
          maxOutputTokens: 1_000,
          supportsParallelToolCalls: false,
        });
      }

      async *streamTurn(
        _request: AgentProviderTurnRequest,
      ): AsyncIterable<AgentProviderStreamEvent> {
        providerEntered();
        // Deliberately ignore AbortSignal to prove runtime Stop is a true
        // settlement barrier even when a provider transport finishes late.
        await providerRelease;
        yield {
          type: 'tool_call',
          id: 'late-tool-call',
          name: 'inspect_notebook',
          arguments: {},
        };
        yield { type: 'finish', reason: 'tool_calls' };
      }
    }

    const base = toolAdapters();
    const adapters: AgentAdapters = {
      ...base,
      ingestion: {
        ingest: async () => ({
          version: 1,
          createdAt: NOW,
          totalEstimatedTokens: 0,
          digest: 'empty-manifest',
          sources: [],
        }),
      },
    };
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(
      new UncooperativeProvider(),
      adapters,
      persistence,
    );
    const running = runtime.start({
      taskId: 'task-stop-settlement',
      threadId: 'thread-stop-settlement',
      runId: 'run-stop-settlement',
      bookId: 'current-book',
      goal: 'Wait for the late provider.',
    });
    await providerStarted;

    let stopSettled = false;
    const stopping = runtime.stop('Reader pressed Stop').then(() => {
      stopSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    releaseProvider();
    await stopping;
    const result = await running;
    expect(result.state.lifecycle).toBe('cancelled');
    expect(runtime.getSnapshot()).toMatchObject({ busy: false });
    expect(runtime.getSnapshot().state?.lifecycle).toBe('cancelled');
    expect((await persistence.loadTask('task-stop-settlement'))?.state).toMatchObject({
      lifecycle: 'cancelled',
      cancellation: {
        requested: true,
        reason: 'Reader pressed Stop',
      },
    });
    const eventsAtSettlement = await persistence.listEvents('task-stop-settlement');
    expect(eventsAtSettlement.map((event) => event.type)).toContain('run.cancelled');
    expect(eventsAtSettlement.map((event) => event.type)).not.toEqual(
      expect.arrayContaining([
        'tool.started',
        'tool.completed',
        'run.completed',
        'run.failed',
      ]),
    );

    // A completed Stop promise is the public guarantee: another microtask
    // cannot append a delayed tool/event or replace the cancelled checkpoint.
    await Promise.resolve();
    expect(await persistence.listEvents('task-stop-settlement')).toEqual(eventsAtSettlement);
    expect((await persistence.loadTask('task-stop-settlement'))?.state.lifecycle).toBe('cancelled');
  });
});

describe('AI source citation provenance', () => {
  it('rejects an identical repaired draft once the current preview is already reviewed', async () => {
    const state = citationReadyState();
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(state.identity, persistence, () => NOW);
    const adapters = toolAdapters();
    const tools = new AgentToolCatalog({
      ...adapters,
      hash: {
        ...adapters.hash,
        digestText: async (text) =>
          text === state.draft.script
            ? state.draft.draftHash
            : adapters.hash.digestText(text),
      },
    }, events);
    const result = await tools.execute(state, {
      id: 'call-identical-repair',
      name: 'submit_notebook_script',
      arguments: {
        script: state.draft.script,
        citedUnitIds: state.sourceCoverage.citedUnitIds,
        reason: 'repair',
      },
    }, new AbortController().signal);

    expect(result.result).toEqual({
      error: 'the current preview must be inspected, reviewed or proposed; do not resubmit the unchanged draft',
      retryable: true,
    });
    expect(result.state.draft).toEqual(state.draft);
    expect(result.state.validation).toEqual(state.validation);
    expect(result.state.previewGeneration).toEqual(state.previewGeneration);
    expect(result.state.visualReview).toEqual(state.visualReview);
    expect(result.state.usage.repairPasses).toBe(state.usage.repairPasses);
  });

  it('requires a current read and citation from noncanonical task sources', () => {
    const base = citationReadyState();
    const ready = {
      ...base,
      taskBrief: { ...base.taskBrief, goal: 'Turn the attached PDF into notebook pages' },
      conversation: [{
        id: 'reader-current-pdf-pages',
        role: 'user' as const,
        text: 'Turn the attached PDF into notebook pages',
        createdAt: NOW,
      }],
      budgetWindow: {
        ...base.budgetWindow!,
        readerMessageId: 'reader-current-pdf-pages',
      },
    };
    const withoutReaderEvidence = {
      ...ready,
      draft: {
        ...ready.draft,
        sourceReadUnitIds: [],
      },
      sourceCoverage: {
        ...ready.sourceCoverage,
        readUnitIds: [],
        readExposures: [],
        citedUnitIds: [],
      },
    };
    expect(canSubmitNotebookPatch(withoutReaderEvidence)).toMatchObject({
      allowed: false,
      code: 'incomplete',
      reason: expect.stringMatching(/read and cite/i),
    });
    expect(canSubmitNotebookPatch({
      ...ready,
      draft: { ...ready.draft, sourceManifestDigest: 'older-manifest' },
    })).toMatchObject({
      allowed: false,
      code: 'stale',
      reason: expect.stringMatching(/older source manifest/i),
    });
  });

  it('reopens draft submission to attach a late grounded citation without rewriting reviewed pages', async () => {
    const base = citationReadyState();
    const readerMessageId = 'reader-late-source-citation';
    const state = {
      ...base,
      taskBrief: {
        ...base.taskBrief,
        goal: 'Use the attached PDF to make these notebook pages.',
      },
      conversation: [{
        id: readerMessageId,
        role: 'user' as const,
        text: 'Use the attached PDF to make these notebook pages.',
        createdAt: NOW,
      }],
      budgetWindow: {
        ...base.budgetWindow!,
        readerMessageId,
      },
      sourceCoverage: {
        ...base.sourceCoverage,
        citedUnitIds: [],
      },
    };

    expect([...availableAgentToolNames(state)]).toEqual([
      'submit_notebook_script',
    ]);
    expect(canSubmitNotebookPatch(state)).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/read and cite/i),
    });

    const adapters = toolAdapters();
    const persistence = new InMemoryAgentPersistence();
    const tools = new AgentToolCatalog({
      ...adapters,
      hash: {
        ...adapters.hash,
        digestText: async (text) =>
          text === state.draft.script
            ? state.draft.draftHash
            : adapters.hash.digestText(text),
      },
    }, new AgentEventBus(state.identity, persistence, () => NOW));
    const result = await tools.execute(state, {
      id: 'call-late-source-citation',
      name: 'submit_notebook_script',
      arguments: {
        script: state.draft.script,
        citedUnitIds: ['trusted-unit-1'],
        reason: 'repair',
      },
    }, new AbortController().signal);

    expect(result.result).not.toHaveProperty('error');
    expect(result.state.draft?.script).toBe(state.draft.script);
    expect(result.state.draft?.draftHash).toBe(state.draft.draftHash);
    expect(result.state.validation).toEqual(state.validation);
    expect(result.state.previewGeneration).toEqual(state.previewGeneration);
    expect(result.state.visualReview).toEqual(state.visualReview);
    expect(result.state.sourceCoverage?.citedUnitIds).toEqual(['trusted-unit-1']);
    expect(canSubmitNotebookPatch(result.state)).toEqual({ allowed: true });
  });

  it('cannot propose a preserve-all draft that predates later required source reads', async () => {
    const base = citationReadyState();
    const readerMessageId = 'reader-preserve-all-late-read';
    const state = {
      ...base,
      taskBrief: {
        ...base.taskBrief,
        goal: 'Add every detail from the attached PDF into my book.',
        preserveAllSourceInformation: true,
      },
      conversation: [{
        id: readerMessageId,
        role: 'user' as const,
        text: 'Add every detail from the attached PDF into my book.',
        createdAt: NOW,
      }],
      budgetWindow: {
        ...base.budgetWindow!,
        readerMessageId,
      },
      sourceCoverage: {
        ...base.sourceCoverage,
        mode: 'complete' as const,
        requiredUnitIds: ['trusted-unit-1', 'trusted-unit-unread'],
        readUnitIds: ['trusted-unit-1', 'trusted-unit-unread'],
        readExposures: [
          ...(base.sourceCoverage.readExposures ?? []),
          {
            unitId: 'trusted-unit-unread',
            providerCallCount: 1,
            exposedAt: NOW,
          },
        ],
        omittedUnitIds: [],
        complete: true,
      },
      // The reviewed pixels were authored when only the first unit was known.
      draft: {
        ...base.draft,
        sourceReadUnitIds: ['trusted-unit-1'],
      },
    };

    expect(canSubmitNotebookPatch(state)).toMatchObject({
      allowed: false,
      code: 'stale',
      reason: expect.stringMatching(/predates current source reads/i),
    });
    expect([...availableAgentToolNames(state)]).toEqual([
      'submit_notebook_script',
    ]);

    const adapters = toolAdapters();
    const tools = new AgentToolCatalog({
      ...adapters,
      hash: {
        ...adapters.hash,
        digestText: async (text) =>
          text === state.draft.script
            ? state.draft.draftHash
            : adapters.hash.digestText(text),
      },
    }, new AgentEventBus(
      state.identity,
      new InMemoryAgentPersistence(),
      () => NOW,
    ));
    const blocked = await tools.execute(state, {
      id: 'call-stamp-complete-source-set',
      name: 'submit_notebook_script',
      arguments: {
        script: state.draft.script,
        citedUnitIds: ['trusted-unit-1'],
        reason: 'repair',
      },
    }, new AbortController().signal);
    expect(blocked.result).toMatchObject({
      error: expect.stringMatching(/revise the script or cite newly read units/i),
    });

    const affirmed = await tools.execute(blocked.state, {
      id: 'call-affirm-complete-source-set',
      name: 'submit_notebook_script',
      arguments: {
        script: state.draft.script,
        citedUnitIds: ['trusted-unit-1', 'trusted-unit-unread'],
        reason: 'repair',
      },
    }, new AbortController().signal);

    expect(affirmed.result).not.toHaveProperty('error');
    expect(affirmed.state.draft?.sourceReadUnitIds).toEqual([
      'trusted-unit-1',
      'trusted-unit-unread',
    ]);
    expect(canSubmitNotebookPatch(affirmed.state)).toEqual({ allowed: true });
  });

  it.each([
    ['foreign', 'foreign-unit'],
    ['unread', 'trusted-unit-unread'],
  ])('rejects a %s cited unit before accepting the draft', async (_kind, citedUnitId) => {
    const base = citationReadyState();
    const state = {
      ...base,
      // This call represents a new draft before validation/render review.
      draft: undefined,
      validation: undefined,
      previewGeneration: undefined,
      visualReview: undefined,
      patchProposal: undefined,
    };
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(state.identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(toolAdapters(), events);
    const result = await tools.execute(state, {
      id: `call-citation-${_kind}`,
      name: 'submit_notebook_script',
      arguments: {
        script: '# Grounded draft',
        citedUnitIds: [citedUnitId],
        reason: 'initial',
      },
    }, new AbortController().signal);

    expect(result.result).toEqual({
      error: 'citations must name source units read in this task',
      retryable: true,
    });
    expect(result.state.draft).toBeUndefined();
    expect(result.state.sourceCoverage?.citedUnitIds).toEqual(['trusted-unit-1']);
  });

  it('replaces stale citation intent when a repaired draft cites a different read unit set', async () => {
    const manifest = citationManifest();
    const base = citationReadyState();
    const state = {
      ...base,
      validation: {
        ...base.validation,
        valid: false,
        staticDiagnostics: [{
          severity: 'error' as const,
          code: 'craft.semantic-variety-required',
          message: 'Repair the draft structure.',
        }],
      },
      previewGeneration: undefined,
      visualReview: undefined,
      patchProposal: undefined,
      sourceCoverage: {
        ...base.sourceCoverage,
        readUnitIds: ['trusted-unit-1', 'trusted-unit-unread'],
        readExposures: [
          ...(base.sourceCoverage?.readExposures ?? []),
          {
            unitId: 'trusted-unit-unread',
            providerCallCount: 1,
            exposedAt: NOW,
          },
        ],
        citedUnitIds: ['trusted-unit-1'],
      },
    };
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(state.identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(toolAdapters(), events);
    const result = await tools.execute(state, {
      id: 'call-repair-citations',
      name: 'submit_notebook_script',
      arguments: {
        script: '# Repaired draft cites only the appendix',
        citedUnitIds: ['trusted-unit-unread'],
        reason: 'repair',
      },
    }, new AbortController().signal);

    expect(manifest.sources[0]?.units.map((unit) => unit.id)).toContain('trusted-unit-unread');
    expect(result.result).not.toHaveProperty('error');
    expect(result.state.sourceCoverage?.citedUnitIds).toEqual(['trusted-unit-unread']);
    expect(result.state.sourceCoverage?.citedUnitIds).not.toContain('trusted-unit-1');
  });

  it('rejects spoofed proposal citation metadata and derives preview labels from the trusted manifest', async () => {
    const state = citationReadyState();
    const adapters: AgentAdapters = {
      ...toolAdapters(),
      notebook: {
        ...toolAdapters().notebook,
        inspectNotebook: async () => ({
          title: 'Current book',
          snapshot: state.notebookSnapshot,
          pages: [{
            pageId: 'owned-page',
            ordinal: 0,
            revision: 'owned-revision',
            estimatedTokens: 10,
          }],
        }),
      },
      sources: {
        ...toolAdapters().sources,
        getManifest: async () => state.sourceManifest,
      },
    };
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(state.identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(adapters, events);
    const spoofed = await tools.execute(state, {
      id: 'call-spoofed-citation',
      name: 'propose_notebook_patch',
      arguments: {
        citations: [{
          sourceId: 'foreign-source',
          sourceTitle: 'Made-up source title',
          unitId: 'foreign-unit',
          label: 'Made-up locator',
          pageNumber: 999,
        }],
      },
    }, new AbortController().signal);
    expect(spoofed.result).toEqual({
      error: 'invalid propose_notebook_patch arguments',
      retryable: true,
    });
    expect(spoofed.state.patchProposal).toBeUndefined();

    const trusted = await tools.execute(state, {
      id: 'call-trusted-citation',
      name: 'propose_notebook_patch',
      arguments: {},
    }, new AbortController().signal);
    expect(trusted.result).not.toHaveProperty('error');
    expect(trusted.state.patchProposal?.preview.citations).toEqual([{
      sourceId: 'trusted-source',
      sourceTitle: 'Trusted Lecture Notes',
      unitId: 'trusted-unit-1',
      label: 'Prefix-code theorem',
      pageNumber: 7,
      figure: 'Figure 2',
    }]);
  });

  it('turns late notebook drift into one inspect recovery instead of a proposal loop', async () => {
    const state = citationReadyState();
    const disposed: string[] = [];
    const changedSnapshot = {
      ...state.notebookSnapshot!,
      bookRevision: 'book-revision-changed-after-review',
      capturedAt: '2026-08-12T08:01:00.000Z',
    };
    const base = toolAdapters();
    const adapters: AgentAdapters = {
      ...base,
      notebook: {
        ...base.notebook,
        inspectNotebook: async () => ({
          title: 'Current book',
          snapshot: changedSnapshot,
          pages: changedSnapshot.pageIds.map((pageId, ordinal) => ({
            pageId,
            ordinal,
            revision: changedSnapshot.pageRevisions[pageId]!,
            estimatedTokens: 12,
          })),
        }),
      },
      sources: {
        ...base.sources,
        getManifest: async () => state.sourceManifest!,
      },
      sandbox: {
        ...base.sandbox,
        dispose: async (generationId) => {
          disposed.push(generationId);
        },
      },
    };
    const tools = new AgentToolCatalog(
      adapters,
      new AgentEventBus(state.identity, new InMemoryAgentPersistence(), () => NOW),
    );
    const failed = await tools.execute(state, {
      id: 'proposal-after-notebook-drift',
      name: 'propose_notebook_patch',
      arguments: {},
    }, new AbortController().signal);

    expect(failed.result).toMatchObject({
      error: expect.stringMatching(/notebook changed after it was inspected/i),
      recovered: true,
      nextAction: expect.stringMatching(/inspect the current notebook/i),
    });
    expect(failed.state).toMatchObject({
      lifecycle: 'running',
      phase: 'intake',
    });
    expect(failed.state.notebookSnapshot).toBeUndefined();
    expect(failed.state.insertionTarget).toBeUndefined();
    expect(failed.state.validation).toBeUndefined();
    expect(failed.state.previewGeneration).toBeUndefined();
    expect(failed.state.visualReview).toBeUndefined();
    expect(failed.state.patchProposal).toBeUndefined();
    expect(disposed).toContain(state.previewGeneration!.generationId);
    expect(tools.descriptorsForState(failed.state).map((tool) => tool.name)).toEqual([
      'inspect_notebook',
    ]);
  });

  it('uses replacement semantics directly in the deterministic coverage ledger', () => {
    const initial = citationReadyState().sourceCoverage;
    const replaced = recordSourceCitations(
      initial,
      ['trusted-unit-unread'],
      NOW,
    );
    expect(replaced.citedUnitIds).toEqual(['trusted-unit-unread']);
  });
});
