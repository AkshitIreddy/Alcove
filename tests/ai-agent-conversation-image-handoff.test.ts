import { describe, expect, it } from 'vitest';

import type { AgentAdapters } from '../src/features/aiAgent/adapters';
import { AgentEventBus } from '../src/features/aiAgent/events';
import {
  buildImagePromptHandoff,
  extractPortableImageSlots,
  imagePromptHandoffMatchesDraft,
} from '../src/features/aiAgent/imageHandoff';
import { explicitImageRequest } from '../src/features/aiAgent/imageIntent';
import { buildAgentSystemPrompt } from '../src/features/aiAgent/prompts';
import { InMemoryAgentPersistence } from '../src/features/aiAgent/persistence';
import { canCompleteConversation } from '../src/features/aiAgent/policy';
import type {
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderStreamEvent,
  AgentProviderTurnRequest,
} from '../src/features/aiAgent/provider';
import { AgentRuntime } from '../src/features/aiAgent/runtime';
import { AgentToolCatalog } from '../src/features/aiAgent/tools';
import {
  createInitialAgentState,
  type AgentState,
  type SourceManifest,
} from '../src/features/aiAgent/types';

const NOW = '2026-08-12T16:00:00.000Z';

const SCRIPT = [
  '# Tiny ecosystems',
  '',
  '![A round pond food web](){placeholder="generate a friendly pond food web", caption="Who eats whom", style=polaroid, width=72}',
  '',
  '::page',
  '',
  '::: card',
  '',
  '![A fox librarian sorting facts](){placeholder="generate the fox librarian analogy", caption="Memory as a library", width=46}',
  '',
  ':::',
].join('\n');

function manifest(): SourceManifest {
  return {
    version: 1,
    createdAt: NOW,
    digest: 'manifest-1',
    totalEstimatedTokens: 40,
    sources: [{
      id: 'pdf-1',
      title: 'Field guide.pdf',
      kind: 'pdf',
      digest: 'pdf-digest',
      mediaType: 'application/pdf',
      estimatedTokens: 40,
      quarantined: false,
      promptInjectionWarnings: [],
      units: [{
        id: 'pdf-page-1',
        label: 'page 1',
        ordinal: 0,
        digest: 'unit-digest',
        estimatedTokens: 40,
        characters: 160,
        hasText: true,
        hasVisual: false,
        anchor: {
          sourceId: 'pdf-1',
          unitId: 'pdf-page-1',
          pageNumber: 1,
        },
      }],
    }],
  };
}

function adapters(onDispose: (generationId: string) => void = () => undefined): AgentAdapters {
  let id = 0;
  const unavailable = async (): Promise<never> => {
    throw new Error('adapter not used by this focused test');
  };
  return {
    clock: { now: () => NOW },
    ids: { create: (prefix) => `${prefix}-${++id}` },
    hash: {
      digestText: async (text) => `hash:${text.length}`,
      digestJson: async (value) => `json:${JSON.stringify(value).length}`,
    },
    notebook: {
      inspectNotebook: unavailable,
      inspectPage: unavailable,
      inspectPageRange: unavailable,
      inspectSelection: unavailable,
    },
    ingestion: {
      ingest: async () => ({
        version: 1,
        createdAt: NOW,
        digest: 'empty-manifest',
        totalEstimatedTokens: 0,
        sources: [],
      }),
    },
    sources: {
      getManifest: async () => ({
        version: 1,
        createdAt: NOW,
        digest: 'empty-manifest',
        totalEstimatedTokens: 0,
        sources: [],
      }),
      getSource: unavailable,
      readUnitRange: unavailable,
      readFullSource: unavailable,
    },
    retrieval: {
      ensureIndexed: unavailable,
      search: unavailable,
      rerank: unavailable,
    },
    sandbox: {
      validate: unavailable,
      render: unavailable,
      getGeneration: unavailable,
      dispose: async (generationId) => onDispose(generationId),
    },
  } as AgentAdapters;
}

function baseState(): AgentState {
  return createInitialAgentState({
    identity: {
      threadId: 'thread-1',
      taskId: 'task-1',
      runId: 'run-1',
      bookId: 'book-1',
    },
    goal: 'Help me understand the attached PDF using cute analogies.',
    now: NOW,
    userMessageId: 'user-1',
  });
}

function baseImageState(): AgentState {
  const state = baseState();
  return {
    ...state,
    conversation: [
      ...state.conversation,
      {
        id: 'user-images',
        role: 'user',
        text: 'Turn it into notebook pages and include illustration slots I can fill later.',
        createdAt: NOW,
      },
    ],
  };
}

function adaptersForManifest(sourceManifest: SourceManifest): AgentAdapters {
  const base = adapters();
  return {
    ...base,
    sources: {
      ...base.sources,
      getManifest: async () => sourceManifest,
    },
  };
}

function catalog(
  adapterSet: AgentAdapters = adapters(),
): AgentToolCatalog {
  const persistence = new InMemoryAgentPersistence();
  const state = baseState();
  return new AgentToolCatalog(
    adapterSet,
    new AgentEventBus(state.identity, persistence, () => NOW),
  );
}

function withCurrentAnswer(
  state: AgentState,
  callId: string,
  text: string,
): AgentState {
  return {
    ...state,
    conversation: [
      ...state.conversation,
      { id: `answer-${callId}`, role: 'assistant', text, createdAt: NOW },
    ],
    modelHistory: [
      ...state.modelHistory,
      {
        id: `model-${callId}`,
        role: 'assistant',
        content: text,
        toolCalls: [{
          id: callId,
          name: 'finish_conversation',
          arguments: { answer: text, citedUnitIds: [] },
        }],
        createdAt: NOW,
      },
    ],
  };
}

describe('portable generated-image handoff', () => {
  it('requires an explicit reader image request and lets the latest directive revoke it', async () => {
    const ordinary = baseState();
    expect(explicitImageRequest(ordinary)).toEqual({ requested: false });
    expect(buildAgentSystemPrompt(ordinary)).toContain(
      'has not explicitly requested external images',
    );

    const rejected = await catalog().execute({
      ...ordinary,
      lifecycle: 'running',
    }, {
      id: 'unrequested-slots',
      name: 'submit_notebook_script',
      arguments: { script: SCRIPT, citedUnitIds: [], reason: 'initial' },
    }, new AbortController().signal);
    expect(rejected.result).toMatchObject({
      error: expect.stringMatching(/require an explicit reader request/i),
    });
    expect(rejected.state.draft).toBeUndefined();

    const requested = baseImageState();
    expect(explicitImageRequest(requested)).toMatchObject({
      requested: true,
      messageId: 'user-images',
    });
    expect(buildAgentSystemPrompt(requested)).toContain(
      'reader explicitly requested external images',
    );
    expect(explicitImageRequest({
      ...ordinary,
      conversation: [{
        id: 'user-illustrate',
        role: 'user',
        text: 'Please illustrate these study notes.',
        createdAt: NOW,
      }],
    })).toMatchObject({ requested: true, messageId: 'user-illustrate' });
    for (const text of [
      "I don't want any images.",
      'Do not add any picture slots.',
      'I did not ask for illustrations.',
      'Remove the image placeholders.',
    ]) {
      expect(explicitImageRequest({
        ...ordinary,
        conversation: [{ id: `negative-${text}`, role: 'user', text, createdAt: NOW }],
      }), text).toMatchObject({ requested: false });
    }
    const revoked: AgentState = {
      ...requested,
      conversation: [
        ...requested.conversation,
        { id: 'user-no-images', role: 'user', text: 'Actually, use no images.', createdAt: NOW },
      ],
    };
    expect(explicitImageRequest(revoked)).toMatchObject({
      requested: false,
      messageId: 'user-no-images',
    });
  });

  it('extracts nested slots in protected-page reading order', () => {
    expect(extractPortableImageSlots(SCRIPT)).toEqual([
      {
        slotId: 'page-1-image-1',
        pageNumber: 1,
        ordinal: 1,
        alt: 'A round pond food web',
        placeholder: 'generate a friendly pond food web',
        caption: 'Who eats whom',
        frame: 'polaroid',
        displayWidthPercent: 72,
      },
      {
        slotId: 'page-2-image-1',
        pageNumber: 2,
        ordinal: 2,
        alt: 'A fox librarian sorting facts',
        placeholder: 'generate the fox librarian analogy',
        caption: 'Memory as a library',
        displayWidthPercent: 46,
      },
    ]);
  });

  it('builds exact prompts with app-selected dimensions and rejects incomplete maps', () => {
    const prompts = [
      {
        slotId: 'page-1-image-1',
        role: 'explanatory_diagram' as const,
        aspect: 'landscape_4_3' as const,
        prompt: 'A warm, clear pond food web with friendly species and legible arrows, no labels cropped.',
        avoid: 'photoreal gore, tiny unreadable text',
      },
      {
        slotId: 'page-2-image-1',
        role: 'analogy_scene' as const,
        aspect: 'portrait_4_5' as const,
        prompt: 'A charming fox librarian sorting glowing fact cards in a cozy archive, simple clear composition.',
      },
    ];
    const handoff = buildImagePromptHandoff({
      draftHash: 'draft-1',
      script: SCRIPT,
      prompts,
      now: NOW,
    });

    expect(handoff.prompts).toMatchObject([
      { widthPx: 1536, heightPx: 1152, slot: { slotId: 'page-1-image-1' } },
      { widthPx: 1024, heightPx: 1280, slot: { slotId: 'page-2-image-1' } },
    ]);
    expect(handoff.prompts[0]?.prompt).toContain(
      'Output exactly 1536 x 1152 pixels (Landscape 4:3 aspect ratio).',
    );
    expect(handoff.prompts[1]?.prompt).toContain(
      'Output exactly 1024 x 1280 pixels (Portrait 4:5 aspect ratio).',
    );
    const rebuilt = buildImagePromptHandoff({
      draftHash: 'draft-1',
      script: SCRIPT,
      prompts: handoff.prompts.map((prompt) => ({
        slotId: prompt.slot.slotId,
        role: prompt.role,
        aspect: prompt.aspect,
        prompt: prompt.prompt,
        ...(prompt.avoid === undefined ? {} : { avoid: prompt.avoid }),
      })),
      now: NOW,
    });
    expect(rebuilt.prompts[0]?.prompt.match(/Output exactly/g)).toHaveLength(1);
    expect(imagePromptHandoffMatchesDraft(handoff, 'draft-1', SCRIPT)).toBe(true);
    expect(imagePromptHandoffMatchesDraft(handoff, 'draft-2', SCRIPT)).toBe(false);
    const reversed = buildImagePromptHandoff({
      draftHash: 'draft-1',
      script: SCRIPT,
      prompts: [...prompts].reverse(),
      now: NOW,
    });
    expect(reversed.prompts.map((prompt) => prompt.slot.slotId)).toEqual([
      'page-1-image-1',
      'page-2-image-1',
    ]);
    expect(imagePromptHandoffMatchesDraft(reversed, 'draft-1', SCRIPT)).toBe(true);
    expect(imagePromptHandoffMatchesDraft({
      ...handoff,
      prompts: handoff.prompts.map((prompt, index) => index === 0
        ? { ...prompt, prompt: 'Legacy prompt without dimensions in its copyable text.' }
        : prompt),
    }, 'draft-1', SCRIPT)).toBe(false);
    expect(() => buildImagePromptHandoff({
      draftHash: 'draft-1',
      script: SCRIPT,
      prompts: prompts.slice(0, 1),
      now: NOW,
    })).toThrow(/missing page-2-image-1/i);
  });

  it('does not confuse exact attached-image reuse with external image permission', () => {
    const ordinary = baseState();
    const attachedOnly: AgentState = {
      ...ordinary,
      conversation: [{
        id: 'use-attached',
        role: 'user',
        text: 'Please include the image I attached in these pages.',
        createdAt: NOW,
      }],
    };
    expect(explicitImageRequest(attachedOnly)).toEqual({ requested: false });

    const attachedAndExternal: AgentState = {
      ...ordinary,
      conversation: [{
        id: 'attached-and-new',
        role: 'user',
        text: 'Use the attached photo, and also generate another illustration.',
        createdAt: NOW,
      }],
    };
    expect(explicitImageRequest(attachedAndExternal)).toMatchObject({
      requested: true,
      messageId: 'attached-and-new',
    });
  });

  it('stores a durable prompt handoff and invalidates it when the draft changes', async () => {
    const tools = catalog();
    const state: AgentState = {
      ...baseImageState(),
      lifecycle: 'running',
      draft: {
        runId: 'run-1',
        version: 1,
        script: SCRIPT,
        draftHash: 'draft-1',
        createdAt: NOW,
      },
    };
    const prepared = await tools.execute(state, {
      id: 'prepare-prompts',
      name: 'prepare_image_generation_prompts',
      arguments: {
        prompts: [
          {
            slotId: 'page-1-image-1',
            role: 'explanatory_diagram',
            aspect: 'landscape_4_3',
            prompt: 'A clear pond food web with friendly animals and generous spacing around every arrow.',
            avoid: null,
          },
          {
            slotId: 'page-2-image-1',
            role: 'analogy_scene',
            aspect: 'portrait_4_5',
            prompt: 'A cute fox librarian arranging fact cards into labelled shelves, warm and uncluttered.',
            avoid: null,
          },
        ],
      },
    }, new AbortController().signal);

    expect(prepared.state.imagePromptHandoff?.prompts).toHaveLength(2);
    const changed = await tools.execute(prepared.state, {
      id: 'replace-draft',
      name: 'submit_notebook_script',
      arguments: {
        script: '# A new draft without the old slots',
        citedUnitIds: [],
        reason: 'repair',
      },
    }, new AbortController().signal);
    expect(changed.state.imagePromptHandoff).toBeUndefined();
  });

  it('does not let a later tool call rewrite the immutable prompts on a proposal', async () => {
    const initial = baseImageState();
    const state: AgentState = {
      ...initial,
      lifecycle: 'running',
      draft: {
        runId: initial.identity.runId,
        version: 1,
        script: SCRIPT,
        draftHash: 'draft-1',
        createdAt: NOW,
      },
      patchProposal: {
        patchId: 'patch-1',
        idempotencyKey: 'key-1',
        runId: initial.identity.runId,
        draftVersion: 1,
        draftHash: 'draft-1',
        script: SCRIPT,
        expectedBookRevision: 'book-revision-1',
        insertionTarget: { kind: 'book_end' },
        preview: {
          previewId: 'preview-1',
          generationId: 'generation-1',
          draftHash: 'draft-1',
          layoutHash: 'layout-1',
          bookId: 'book-1',
          expectedBookRevision: 'book-revision-1',
          insertionTarget: { kind: 'book_end' },
          expectedPageCount: 0,
          pages: [],
          assumptions: [],
          citations: [],
          imageGenerationPrompts: [],
          sourceCoverage: {
            manifestDigest: '', mode: 'relevant', requiredUnitIds: [], readUnitIds: [],
            citedUnitIds: [], omittedUnitIds: [], staleSourceIds: [], complete: true, updatedAt: NOW,
          },
          visualReview: {
            generationId: 'generation-1', draftHash: 'draft-1', requiredPageIds: [],
            imageExposures: [], inspectedPageIds: [], findings: [], complete: true, passed: true,
            updatedAt: NOW,
          },
          validation: {
            draftHash: 'draft-1', parserDiagnostics: [], staticDiagnostics: [],
            imageDiagnostics: [], pageLedgerDiagnostics: [], valid: true, checkedAt: NOW,
          },
        },
        status: 'proposed',
        createdAt: NOW,
      },
    };
    const result = await catalog().execute(state, {
      id: 'late-prompts',
      name: 'prepare_image_generation_prompts',
      arguments: { prompts: [] },
    }, new AbortController().signal);

    expect(result.result).toMatchObject({
      error: expect.stringMatching(/immutable once a preview proposal exists/i),
    });
    expect(result.state.patchProposal).toBe(state.patchProposal);
  });
});

describe('answer-only agent completion', () => {
  it('blocks a same-assistant-batch read/finish bypass until a later model turn', () => {
    const sourceManifest = manifest();
    const state: AgentState = {
      ...baseState(),
      lifecycle: 'running',
      usage: { ...baseState().usage, providerCalls: 1 },
      sourceManifest,
      sourceCoverage: {
        manifestDigest: sourceManifest.digest,
        mode: 'relevant',
        requiredUnitIds: ['pdf-page-1'],
        readUnitIds: ['pdf-page-1'],
        readExposures: [{
          unitId: 'pdf-page-1',
          providerCallCount: 1,
          exposedAt: NOW,
        }],
        citedUnitIds: [],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: NOW,
      },
    };

    expect(canCompleteConversation(state, ['pdf-page-1'])).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/later model turn.*all current source reads/i),
    });
    expect(canCompleteConversation({
      ...state,
      usage: { ...state.usage, providerCalls: 2 },
    }, ['pdf-page-1']).allowed).toBe(true);
    expect(canCompleteConversation({
      ...state,
      usage: { ...state.usage, providerCalls: 2 },
      sourceManifest: { ...sourceManifest, digest: 'new-manifest' },
    }, ['pdf-page-1'])).toMatchObject({
      allowed: false,
      code: 'stale',
      reason: expect.stringMatching(/older task manifest/i),
    });
  });

  it('routes a real graph turn to conversation completion without entering notebook QA', async () => {
    const requests: AgentProviderTurnRequest[] = [];
    const provider: AgentProvider = {
      id: 'conversation-test',
      capabilities: async (): Promise<AgentProviderCapabilities> => ({
        providerId: 'conversation-test',
        modelId: 'conversation-test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 16_000,
        maxOutputTokens: 2_000,
        supportsParallelToolCalls: false,
      }),
      async *streamTurn(request): AsyncIterable<AgentProviderStreamEvent> {
        requests.push(request);
        yield {
          type: 'tool_call',
          id: 'finish-one',
          name: 'finish_conversation',
          arguments: {
            answer: 'At a high level, entropy is like measuring how surprised a kitten is by which toy appears next.',
            citedUnitIds: [],
          },
        };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    };
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters(), persistence);

    const result = await runtime.start({
      taskId: 'conversation-task',
      threadId: 'conversation-thread',
      runId: 'conversation-run',
      bookId: 'book-1',
      goal: 'What is entropy? Explain it with a cute analogy; do not add pages.',
    });

    expect(result.state.lifecycle).toBe('completed');
    expect(result.state.phase).toBe('finished');
    expect(result.state.draft).toBeUndefined();
    expect(result.state.previewGeneration).toBeUndefined();
    expect(result.state.patchProposal).toBeUndefined();
    expect(result.state.conversation.at(-1)?.text).toContain('kitten');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.tools.map((tool) => tool.name)).toContain('finish_conversation');
  });

  it('finishes safe prose-only chat when Command A+ omits the optional tool call', async () => {
    const provider: AgentProvider = {
      id: 'prose-only-conversation-test',
      capabilities: async (): Promise<AgentProviderCapabilities> => ({
        providerId: 'prose-only-conversation-test',
        modelId: 'prose-only-conversation-test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 16_000,
        maxOutputTokens: 2_000,
        supportsParallelToolCalls: false,
      }),
      async *streamTurn(): AsyncIterable<AgentProviderStreamEvent> {
        yield {
          type: 'public_text_delta',
          text: 'Math is the language we use to describe patterns, quantities, shapes, and change.',
        };
        yield { type: 'finish', reason: 'stop' };
      },
    };
    const runtime = new AgentRuntime(
      provider,
      adapters(),
      new InMemoryAgentPersistence(),
    );

    const result = await runtime.start({
      taskId: 'prose-only-task',
      threadId: 'prose-only-thread',
      runId: 'prose-only-run',
      bookId: 'book-1',
      goal: 'What is math?',
    });

    expect(result.state.lifecycle).toBe('completed');
    expect(result.state.conversation.at(-1)?.text).toContain('language');
    expect(result.state.patchProposal).toBeUndefined();
  });

  it('does not reinterpret prose-only output as completion for a notebook edit', async () => {
    const provider: AgentProvider = {
      id: 'prose-only-edit-test',
      capabilities: async (): Promise<AgentProviderCapabilities> => ({
        providerId: 'prose-only-edit-test',
        modelId: 'prose-only-edit-test',
        toolUse: true,
        streaming: true,
        imageInput: true,
        maxInputTokens: 16_000,
        maxOutputTokens: 2_000,
        supportsParallelToolCalls: false,
      }),
      async *streamTurn(): AsyncIterable<AgentProviderStreamEvent> {
        yield { type: 'public_text_delta', text: 'I can help with that.' };
        yield { type: 'finish', reason: 'stop' };
      },
    };
    const runtime = new AgentRuntime(
      provider,
      adapters(),
      new InMemoryAgentPersistence(),
    );

    const result = await runtime.start({
      taskId: 'prose-only-edit-task',
      threadId: 'prose-only-edit-thread',
      runId: 'prose-only-edit-run',
      bookId: 'book-1',
      goal: 'Create two notebook pages about math.',
    });
    expect(result.state.lifecycle).toBe('failed');
    expect(result.state.lastError?.message).toMatch(/without choosing a completion or work tool/i);
    expect(result.state.conversation).toHaveLength(1);
  });

  it('finishes a conversational answer without a draft, preview or mutation', async () => {
    const state = withCurrentAnswer({
      ...baseState(),
      lifecycle: 'running',
      phase: 'reading_sources',
    }, 'finish-chat', 'Think of compression as a kitten packing only its favourite toys into one tiny basket.');
    const result = await catalog().execute(state, {
      id: 'finish-chat',
      name: 'finish_conversation',
      arguments: {
        answer: 'Think of compression as a kitten packing only its favourite toys into one tiny basket.',
        citedUnitIds: [],
      },
    }, new AbortController().signal);

    expect(result.result).toMatchObject({
      completed: true,
      outcome: 'conversation',
      mutationPerformed: false,
    });
    expect(result.state.lifecycle).toBe('completed');
    expect(result.state.phase).toBe('finished');
    expect(result.state.draft).toBeUndefined();
    expect(result.state.patchProposal).toBeUndefined();
  });

  it('disposes and clears abandoned draft renders before answer-only completion', async () => {
    const disposed: string[] = [];
    const initial = baseState();
    const state = withCurrentAnswer({
      ...initial,
      lifecycle: 'running',
      draft: {
        runId: initial.identity.runId,
        version: 1,
        script: '# Abandoned draft',
        draftHash: 'abandoned-draft',
        createdAt: NOW,
      },
      previewGeneration: {
        generationId: 'private-generation-1',
        draftHash: 'abandoned-draft',
        layoutHash: 'layout-1',
        rendererVersion: 'test-renderer',
        bookSnapshotRevision: 'book-revision-1',
        createdAt: NOW,
        parserValid: true,
        layoutValid: true,
        stale: false,
        pageCount: 0,
        pages: [],
        diagnostics: [],
      },
      imagePromptHandoff: {
        draftHash: 'abandoned-draft',
        prompts: [],
        createdAt: NOW,
      },
    }, 'finish-after-draft', 'Here is the explanation in chat instead; I will not leave an old notebook preview behind.');
    const result = await catalog(adapters((id) => disposed.push(id))).execute(
      state,
      {
        id: 'finish-after-draft',
        name: 'finish_conversation',
        arguments: {
          answer: 'Here is the explanation in chat instead; I will not leave an old notebook preview behind.',
          citedUnitIds: [],
        },
      },
      new AbortController().signal,
    );

    expect(disposed).toEqual(['private-generation-1']);
    expect(result.state.draft).toBeUndefined();
    expect(result.state.previewGeneration).toBeUndefined();
    expect(result.state.visualReview).toBeUndefined();
    expect(result.state.imagePromptHandoff).toBeUndefined();
  });

  it('keeps an applied patch and its image prompts as immutable history', async () => {
    const disposed: string[] = [];
    const initial = baseState();
    const promptHandoff = buildImagePromptHandoff({
      draftHash: 'applied-draft',
      script: '![A kitten diagram](){placeholder="generate the kitten diagram", width=70}',
      prompts: [{
        slotId: 'page-1-image-1',
        role: 'explanatory_diagram',
        aspect: 'landscape_4_3',
        prompt: 'A clear friendly kitten diagram with generous spacing and no cropped explanatory details.',
      }],
      now: NOW,
    });
    const appliedPreview = {
      previewId: 'applied-preview',
      generationId: 'applied-generation',
      draftHash: 'applied-draft',
      layoutHash: 'applied-layout',
      bookId: 'book-1',
      expectedBookRevision: 'book-revision-1',
      insertionTarget: { kind: 'book_end' as const },
      expectedPageCount: 0,
      pages: [],
      assumptions: [],
      citations: [],
      imageGenerationPrompts: promptHandoff.prompts,
      sourceCoverage: {
        manifestDigest: '',
        mode: 'relevant' as const,
        requiredUnitIds: [],
        readUnitIds: [],
        citedUnitIds: [],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: NOW,
      },
      visualReview: {
        generationId: 'applied-generation',
        draftHash: 'applied-draft',
        requiredPageIds: [],
        imageExposures: [],
        inspectedPageIds: [],
        findings: [],
        complete: true,
        passed: true,
        updatedAt: NOW,
      },
      validation: {
        draftHash: 'applied-draft',
        parserDiagnostics: [],
        staticDiagnostics: [],
        imageDiagnostics: [],
        pageLedgerDiagnostics: [],
        valid: true,
        checkedAt: NOW,
      },
    };
    const state = withCurrentAnswer({
      ...initial,
      lifecycle: 'running',
      draft: {
        runId: initial.identity.runId,
        version: 1,
        script: '![A kitten diagram](){placeholder="generate the kitten diagram", width=70}',
        draftHash: 'applied-draft',
        createdAt: NOW,
      },
      imagePromptHandoff: promptHandoff,
      patchProposal: {
        patchId: 'applied-patch',
        idempotencyKey: 'applied-key',
        runId: initial.identity.runId,
        draftVersion: 1,
        draftHash: 'applied-draft',
        script: '![A kitten diagram](){placeholder="generate the kitten diagram", width=70}',
        expectedBookRevision: 'book-revision-1',
        insertionTarget: { kind: 'book_end' },
        preview: appliedPreview,
        status: 'applied',
        createdAt: NOW,
      },
    }, 'finish-after-apply', 'Of course — here is the follow-up explanation, while your inserted-page receipt stays available.');
    const result = await catalog(adapters((id) => disposed.push(id))).execute(
      state,
      {
        id: 'finish-after-apply',
        name: 'finish_conversation',
        arguments: {
          answer: 'Of course — here is the follow-up explanation, while your inserted-page receipt stays available.',
          citedUnitIds: [],
        },
      },
      new AbortController().signal,
    );

    expect(disposed).toEqual([]);
    expect(result.state.patchProposal?.status).toBe('applied');
    expect(result.state.patchProposal?.preview.imageGenerationPrompts).toHaveLength(1);
    expect(result.state.imagePromptHandoff?.prompts).toHaveLength(1);
  });

  it('derives source citations locally and attaches them to the visible answer', async () => {
    const sourceManifest = manifest();
    const state = withCurrentAnswer({
      ...baseState(),
      lifecycle: 'running',
      usage: { ...baseState().usage, providerCalls: 2 },
      sourceManifest,
      sourceCoverage: {
        manifestDigest: sourceManifest.digest,
        mode: 'relevant',
        requiredUnitIds: ['pdf-page-1'],
        readUnitIds: ['pdf-page-1'],
        readExposures: [{
          unitId: 'pdf-page-1',
          providerCallCount: 1,
          exposedAt: NOW,
        }],
        citedUnitIds: [],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: NOW,
      },
    }, 'finish-grounded-chat', 'The guide describes a compact food web; imagine a picnic where every guest also feeds another guest.');
    expect(canCompleteConversation(state, ['pdf-page-1']).allowed).toBe(true);
    const result = await catalog(adaptersForManifest(sourceManifest)).execute(state, {
      id: 'finish-grounded-chat',
      name: 'finish_conversation',
      arguments: {
        answer: 'The guide describes a compact food web; imagine a picnic where every guest also feeds another guest.',
        citedUnitIds: ['pdf-page-1'],
      },
    }, new AbortController().signal);

    expect(result.state.conversation.at(-1)?.citations).toEqual([{
      sourceId: 'pdf-1',
      sourceTitle: 'Field guide.pdf',
      unitId: 'pdf-page-1',
      label: 'page 1',
      pageNumber: 1,
    }]);
    expect(result.state.sourceCoverage?.citedUnitIds).toEqual(['pdf-page-1']);
  });

  it('rechecks the live source manifest before completing a grounded answer', async () => {
    const sourceManifest = manifest();
    const state = withCurrentAnswer({
      ...baseState(),
      lifecycle: 'running',
      usage: { ...baseState().usage, providerCalls: 2 },
      sourceManifest,
      sourceCoverage: {
        manifestDigest: sourceManifest.digest,
        mode: 'relevant',
        requiredUnitIds: ['pdf-page-1'],
        readUnitIds: ['pdf-page-1'],
        readExposures: [{
          unitId: 'pdf-page-1',
          providerCallCount: 1,
          exposedAt: NOW,
        }],
        citedUnitIds: [],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: NOW,
      },
    }, 'finish-stale-chat', 'The old source said the forest food web begins with photosynthesis.');
    const changedAdapters = adapters();
    const result = await catalog({
      ...changedAdapters,
      sources: {
        ...changedAdapters.sources,
        getManifest: async () => ({ ...sourceManifest, digest: 'live-changed-manifest' }),
      },
    }).execute(state, {
      id: 'finish-stale-chat',
      name: 'finish_conversation',
      arguments: {
        answer: 'The old source said the forest food web begins with photosynthesis.',
        citedUnitIds: ['pdf-page-1'],
      },
    }, new AbortController().signal);

    expect(result.result).toMatchObject({
      error: expect.stringMatching(/source changed after it was read/i),
    });
    expect(result.state.lifecycle).toBe('running');
  });

  it('refuses a silent completion and keeps strict Cohere schemas', async () => {
    const tools = catalog();
    const silent = await tools.execute(
      { ...baseState(), lifecycle: 'running' },
      {
        id: 'silent-finish',
        name: 'finish_conversation',
        arguments: { answer: ' ', citedUnitIds: [] },
      },
      new AbortController().signal,
    );
    expect(silent.result).toMatchObject({ error: expect.stringMatching(/complete reader-facing answer/i) });

    for (const name of ['finish_conversation', 'prepare_image_generation_prompts']) {
      const descriptor = tools.descriptors().find((tool) => tool.name === name);
      expect(descriptor).toBeDefined();
      const schema = descriptor!.inputSchema as { required?: unknown[] };
      expect(schema.required?.length).toBeGreaterThan(0);
      expect(JSON.stringify(schema)).not.toContain('"default"');
    }
  });
});
