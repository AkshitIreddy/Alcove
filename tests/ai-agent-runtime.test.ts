import { describe, expect, it } from 'vitest';
import type {
  AgentAdapters,
  SourceAttachmentRef,
} from '../src/features/aiAgent/adapters';
import {
  createSourceCoverageLedger,
  createVisualReviewLedger,
  recordSourceReads,
  recordVisualImageExposures,
  recordVisualInspection,
} from '../src/features/aiAgent/coverage';
import { AgentEventBus } from '../src/features/aiAgent/events';
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
import { planAdaptiveRetrieval } from '../src/features/aiAgent/retrieval';
import { AgentRuntime } from '../src/features/aiAgent/runtime';
import { AgentToolCatalog } from '../src/features/aiAgent/tools';
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
        yield {
          type: 'tool_call',
          id: 'ask-after-inspection',
          name: 'ask_user',
          arguments: {
            kind: 'requirements',
            question: 'Which explanation from our conversation should I turn into pages?',
          },
        };
        yield { type: 'finish', reason: 'tool_calls' };
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
    expect(waiting.interrupt?.kind).toBe('requirements');
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
    expect(advertisedTools).toContain('submit_notebook_script');
    expect(advertisedTools).toContain('finish_conversation');
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
    const provider = new ScriptedProvider([{
      name: 'ask_user',
      args: {
        kind: 'requirements',
        question: 'Were the sources prepared before this question?',
      },
    }]);
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
    expect(provider.requests).toHaveLength(1);
    expect(providerSawPreparedState).toBe(true);
    expect(retried.state.pendingSourceAttachments).toBeUndefined();
    expect(retried.state.sourceManifest?.digest).toBe(manifest.digest);
    expect(retried.state.sourceCoverage).toMatchObject({
      requiredUnitIds: ['unit-1'],
      omittedUnitIds: ['unit-1'],
      complete: false,
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
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Is there anything else I should know about that evidence?',
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
    expect(resumed.interrupt?.kind).toBe('requirements');
    expect(resumed.state.sourceManifest?.digest).toBe(manifestWithUnits(1).digest);
    expect(resumed.state.taskBrief.preserveAllSourceInformation).toBe(true);
    expect(resumed.state.sourceCoverage).toMatchObject({
      mode: 'complete',
      requiredUnitIds: ['unit-1'],
      omittedUnitIds: ['unit-1'],
      complete: false,
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
      {
        name: 'ask_user',
        args: {
          kind: 'requirements',
          question: 'Should I continue after inspecting and planning?',
        },
      },
    ]);
    const { adapters } = fakeAdapters();
    const runtime = new AgentRuntime(provider, adapters, new InMemoryAgentPersistence());
    const waiting = await runtime.start({
      bookId: 'book-1',
      goal: 'Inspect and plan in one parallel tool batch.',
    });

    expect(waiting.interrupt?.kind).toBe('requirements');
    expect(provider.requests).toHaveLength(2);
    expect(waiting.state.plan?.summary).toBe('Inspect and plan together');
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
      { name: 'list_source_manifest', args: {} },
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
      // A local BookView apply conflict must invalidate the old render and
      // return to the real render/review/proposal tools. It must never become
      // an ordinary "refresh this" chat turn that can finish without a patch.
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
    const refreshed = await afterFailedApplyCrash.refreshFailedPreview();
    expect(refreshed.interrupt?.kind).toBe('final_preview');
    expect(refreshed.state.patchProposal).toMatchObject({
      status: 'waiting_for_approval',
    });
    expect(refreshed.state.conversation).toEqual(displayedConversationBeforeRefresh);
    expect(refreshed.state.conversation.filter((message) =>
      /refresh the final preview/i.test(message.text)
    )).toHaveLength(0);
    expect(refreshed.state.modelHistory.some((turn) =>
      turn.role === 'user' && /local apply did not commit/i.test(turn.content)
    )).toBe(true);
    const recoveryRequest = provider.requests.at(-5);
    expect(recoveryRequest?.systemPrompt).toMatch(/"intent":"notebook_change"/);
    expect(recoveryRequest?.tools.map((tool) => tool.name)).toContain('render_draft_preview');
    expect(recoveryRequest?.tools.map((tool) => tool.name)).not.toContain('get_draft_preview_manifest');

    const refreshedPreviewId = refreshed.interrupt?.kind === 'final_preview'
      ? refreshed.interrupt.preview.previewId
      : '';
    const retryPending = await afterFailedApplyCrash.approvePreview(refreshedPreviewId);
    expect(retryPending.state.patchProposal).toMatchObject({ status: 'approved_pending_apply' });
    const finalized = await afterFailedApplyCrash.finalizeApprovedPatch(
      retryPending.state.patchProposal!.patchId,
      { applied: true },
    );
    expect(finalized.state.patchProposal).toMatchObject({ status: 'applied' });
    expect(finalized.state.lifecycle).toBe('completed');
    // Recovery clears the active error but retains the original local failure
    // for a diagnostic copied after the replacement preview succeeds.
    expect(finalized.state.lastError).toBeUndefined();
    expect(finalized.state.lastApplyFailure?.message).toBe('target changed during apply');
    await afterFailedApplyCrash.clearActiveTask();
    const afterAppliedCrash = new AgentRuntime(provider, adapters, persistence);
    const restoredApplied = await afterAppliedCrash.restore('task-1');
    expect(restoredApplied.state?.patchProposal).toMatchObject({ status: 'applied' });
    expect(restoredApplied.state?.lifecycle).toBe('completed');
    expect(restoredApplied.interrupt).toBeNull();
  }, 20_000);

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
    expect(blocked.omittedUnitIds).toEqual([unit.id]);

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
      goal: 'Build a grounded note',
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
    const originalManifest = manifestWithUnits(0);
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
      sourceCoverage: createSourceCoverageLedger(originalManifest, 'relevant', NOW),
      insertionTarget: { kind: 'book_end' },
      draft: {
        runId: identity.runId,
        version: 1,
        script: '# Grounded draft',
        draftHash: 'draft-hash',
        sourceManifestDigest: originalManifest.digest,
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
    const changedManifest = manifestWithUnits(1);
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
      error: expect.stringMatching(/sources changed/i),
    });
    expect(result.state.patchProposal?.status).toBe('waiting_for_approval');
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
