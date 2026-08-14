import { describe, expect, it, vi } from 'vitest';
import type {
  AgentAdapters,
  AgentActivityEvent,
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderStreamEvent,
  AgentProviderTurnRequest,
  AgentRuntimeSnapshot,
  AiAgentController as CoreAiAgentController,
  DraftPreviewGeneration,
  NotebookInsertionTarget,
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
  canSubmitNotebookPatch,
  availableAgentToolNames,
} from '../src/features/aiAgent';
import {
  buildAiAgentDiagnosticLog,
  createAiAgentPanelController,
  friendlyWorkingNote,
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
    draft: { ...base.draft, sourceManifestDigest: manifest.digest },
    visualReview: reviewed,
  };
}

describe('AI insertion target boundaries', () => {
  it('advertises only workflow-valid notebook tools at each durable checkpoint', () => {
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

    const reviewedTools = availableAgentToolNames(mutation);
    expect(reviewedTools.has('propose_notebook_patch')).toBe(true);
    expect(reviewedTools.has('submit_notebook_script')).toBe(false);
    expect(reviewedTools.has('record_visual_review')).toBe(false);

    const unreadPreview = {
      ...mutation,
      visualReview: createVisualReviewLedger(mutation.previewGeneration, NOW),
      patchProposal: undefined,
    };
    const unreadPreviewTools = availableAgentToolNames(unreadPreview);
    expect(unreadPreviewTools.has('read_draft_preview_pages')).toBe(true);
    expect(unreadPreviewTools.has('record_visual_review')).toBe(false);
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

  it('collects all requirement choices before one resume and supports defaults for all remaining', async () => {
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
    };
    const snapshot: AgentRuntimeSnapshot = {
      state,
      interrupt: {
        kind: 'requirements',
        title: 'Choose the remaining details',
        allowSensibleDefaults: true,
        questions: [
          {
            id: 'placement',
            prompt: 'Where should it go?',
            choices: [
              { id: 'end', label: 'At the end' },
              { id: 'start', label: 'At the beginning' },
            ],
            sensibleDefault: 'At the end',
            allowFreeText: true,
          },
          {
            id: 'format',
            prompt: 'How should it look?',
            choices: [{ id: 'polished', label: 'Polished notes' }],
            sensibleDefault: 'Polished notes',
            allowFreeText: true,
          },
        ],
      },
      busy: false,
    };
    const answerRequirements = vi.fn(async () => ({ state }));
    const core = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      subscribeEvents: () => () => undefined,
      answerRequirements,
    } as unknown as CoreAiAgentController;
    const controller = createAiAgentPanelController(core, {
      bookId: 'current-book',
      connection: () => ({ status: 'connected', provider: 'Cohere', firstUse: false }),
      placements: () => [],
      renderUrlFor: () => '',
      onApprovedProposal: () => undefined,
    });

    try {
      const questions = () => controller.state().timeline.filter(
        (item) => item.kind === 'question',
      );
      expect(questions()).toHaveLength(2);
      expect(questions().filter((item) => item.kind === 'question' && item.allowDefaults))
        .toHaveLength(1);

      controller.answerQuestion?.('question:placement', 'start');
      expect(answerRequirements).not.toHaveBeenCalled();
      expect(questions()[0]).toMatchObject({ answered: 'At the beginning' });

      controller.useSensibleDefaults?.('question:placement');
      expect(answerRequirements).toHaveBeenCalledWith(
        { placement: 'At the beginning', format: 'Polished notes' },
        ['format'],
      );
    } finally {
      controller.dispose();
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
    const persistence = new InMemoryAgentPersistence();
    const events = new AgentEventBus(state.identity, persistence, () => NOW);
    const tools = new AgentToolCatalog(toolAdapters(), events);

    const result = await tools.execute(state, {
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
  it('treats an identical repaired draft as an idempotent no-op', async () => {
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

    expect(result.result).toMatchObject({ unchanged: true });
    expect(result.state.draft).toEqual(state.draft);
    expect(result.state.validation).toEqual(state.validation);
    expect(result.state.previewGeneration).toEqual(state.previewGeneration);
    expect(result.state.visualReview).toEqual(state.visualReview);
    expect(result.state.usage.repairPasses).toBe(state.usage.repairPasses);
  });

  it('requires a current read and citation from noncanonical task sources', () => {
    const ready = citationReadyState();
    const withoutReaderEvidence = {
      ...ready,
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
