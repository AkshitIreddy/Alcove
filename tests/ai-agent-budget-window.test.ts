import { describe, expect, it } from 'vitest';
import type { AgentAdapters } from '../src/features/aiAgent/adapters';
import { InMemoryAgentPersistence } from '../src/features/aiAgent/persistence';
import {
  canCallAnotherProviderTurn,
  canExecuteTool,
  providerCallsInBudgetWindow,
  repairPassesInBudgetWindow,
  toolCallsInBudgetWindow,
} from '../src/features/aiAgent/policy';
import type {
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderStreamEvent,
  AgentProviderTurnRequest,
} from '../src/features/aiAgent/provider';
import { AgentRuntime } from '../src/features/aiAgent/runtime';
import {
  createInitialAgentState,
  type AgentJsonValue,
  type AgentState,
  type SourceManifest,
} from '../src/features/aiAgent/types';

const NOW = '2026-08-14T08:00:00.000Z';

const EMPTY_MANIFEST: SourceManifest = {
  version: 1,
  createdAt: NOW,
  totalEstimatedTokens: 0,
  digest: 'empty-budget-window-manifest',
  sources: [],
};

class SequenceIds {
  private next = 0;

  create(prefix: string): string {
    this.next += 1;
    return `${prefix}-${this.next}`;
  }
}

function adapters(): AgentAdapters {
  return {
    ids: new SequenceIds(),
    clock: { now: () => NOW },
    ingestion: {
      ingest: async () => EMPTY_MANIFEST,
    },
    sources: {
      getManifest: async () => EMPTY_MANIFEST,
    },
    notebook: {
      inspectNotebook: async (bookId) => ({
        title: 'Budget notebook',
        snapshot: {
          bookId,
          bookRevision: 'budget-book-revision',
          pageIds: ['page-1'],
          pageRevisions: { 'page-1': 'budget-page-revision' },
          capturedAt: NOW,
        },
        pages: [{
          pageId: 'page-1',
          ordinal: 0,
          revision: 'budget-page-revision',
          title: 'Page one',
          estimatedTokens: 10,
        }],
      }),
    },
    hash: {
      digestText: async (text) => `text:${text}`,
      digestJson: async (value) => `json:${JSON.stringify(value)}`,
    },
    sandbox: {
      dispose: async () => undefined,
    },
  } as unknown as AgentAdapters;
}

type ProviderDecision =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'tool';
      readonly name: string;
      readonly args: AgentJsonValue;
    };

class BudgetProvider implements AgentProvider {
  readonly id = 'budget-provider';
  readonly requests: AgentProviderTurnRequest[] = [];

  constructor(private readonly decisions: ProviderDecision[]) {}

  capabilities(): Promise<AgentProviderCapabilities> {
    return Promise.resolve({
      providerId: this.id,
      modelId: 'budget-test-model',
      toolUse: true,
      streaming: true,
      imageInput: false,
      maxInputTokens: 32_000,
      maxOutputTokens: 4_000,
      supportsParallelToolCalls: false,
    });
  }

  async *streamTurn(
    request: AgentProviderTurnRequest,
  ): AsyncIterable<AgentProviderStreamEvent> {
    this.requests.push(request);
    const decision = this.decisions.shift();
    if (decision === undefined) throw new Error('budget test provider ran out of decisions');
    if (decision.kind === 'tool') {
      yield {
        type: 'tool_call',
        id: `budget-call-${this.requests.length}`,
        name: decision.name,
        arguments: decision.args,
      };
    }
    yield { type: 'usage', inputTokens: 10, outputTokens: 2 };
    yield {
      type: 'finish',
      reason: decision.kind === 'tool' ? 'tool_calls' : 'stop',
    };
  }
}

const finish = (answer: string): ProviderDecision => ({
  kind: 'tool',
  name: 'finish_conversation',
  args: { answer, citedUnitIds: [] },
});

describe('AI agent per-reader-turn budget windows', () => {
  it('uses a zero baseline for legacy state while keeping new initial baselines durable', () => {
    const initial = createInitialAgentState({
      identity: {
        taskId: 'budget-legacy-task',
        threadId: 'budget-legacy-thread',
        runId: 'budget-legacy-run',
        bookId: 'book-1',
      },
      goal: 'Explain something.',
      budget: { maxProviderCalls: 2, maxToolCalls: 3 },
      now: NOW,
      userMessageId: 'reader-initial',
    });
    expect(initial.budgetWindow).toEqual({
      providerCallsAtStart: 0,
      toolCallsAtStart: 0,
      repairPassesAtStart: 0,
      startedAt: NOW,
      readerMessageId: 'reader-initial',
    });

    const { budgetWindow: _oldCheckpointHadNoWindow, ...legacyFields } = initial;
    const legacy: AgentState = {
      ...legacyFields,
      usage: { ...initial.usage, providerCalls: 2, toolCalls: 3 },
    };
    expect(providerCallsInBudgetWindow(legacy)).toBe(2);
    expect(toolCallsInBudgetWindow(legacy)).toBe(3);
    expect(repairPassesInBudgetWindow(legacy)).toBe(0);
    expect(canCallAnotherProviderTurn(legacy)).toMatchObject({
      allowed: false,
      code: 'budget',
    });
    expect(canExecuteTool(legacy)).toMatchObject({
      allowed: false,
      code: 'budget',
    });
  });

  it('opens a durable new window for a settled follow-up and preserves cumulative epochs', async () => {
    const provider = new BudgetProvider([
      { kind: 'empty' },
      finish('First answer.'),
      { kind: 'empty' },
      finish('Second answer.'),
    ]);
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(provider, adapters(), persistence);
    const first = await runtime.start({
      taskId: 'budget-follow-up-task',
      threadId: 'budget-follow-up-thread',
      runId: 'budget-follow-up-run',
      bookId: 'book-1',
      goal: 'Explain the first topic.',
      budget: { maxProviderCalls: 2, maxToolCalls: 1 },
    });
    expect(first.state.lifecycle).toBe('completed');
    expect(first.state.usage).toMatchObject({ providerCalls: 2, toolCalls: 1 });

    const second = await runtime.sendUserMessage('Now explain a second topic.', {
      userMessageId: 'reader-follow-up',
    });
    expect(second.state.lifecycle).toBe('completed');
    expect(second.state.usage).toMatchObject({ providerCalls: 4, toolCalls: 2 });
    expect(second.state.budgetWindow).toEqual({
      providerCallsAtStart: 2,
      toolCallsAtStart: 1,
      repairPassesAtStart: 0,
      startedAt: NOW,
      readerMessageId: 'reader-follow-up',
    });
    expect(providerCallsInBudgetWindow(second.state)).toBe(2);
    expect(toolCallsInBudgetWindow(second.state)).toBe(1);
    expect(repairPassesInBudgetWindow(second.state)).toBe(0);
    expect(provider.requests).toHaveLength(4);
    expect(provider.requests[2]?.systemPrompt).toMatch(
      /"budgetRemaining"[\s\S]*"providerCalls":\s*2[\s\S]*"toolCalls":\s*1/,
    );
    expect((await persistence.loadTask('budget-follow-up-task'))?.state.budgetWindow)
      .toEqual(second.state.budgetWindow);
  });

  it('starts a settled follow-up with a clean authoring workspace and fresh repair allowance', async () => {
    const provider = new BudgetProvider([finish('Mathematics studies patterns and structure.')]);
    const persistence = new InMemoryAgentPersistence();
    const initial = createInitialAgentState({
      identity: {
        taskId: 'budget-clean-workspace-task',
        threadId: 'budget-clean-workspace-thread',
        runId: 'budget-clean-workspace-run',
        bookId: 'book-1',
      },
      goal: 'Add an old topic to my book.',
      budget: { maxProviderCalls: 3, maxToolCalls: 3, maxRepairPasses: 4 },
      now: NOW,
      userMessageId: 'reader-old-notebook-turn',
    });
    const completedWithOldDraft: AgentState = {
      ...initial,
      lifecycle: 'completed',
      phase: 'finished',
      draft: {
        runId: initial.identity.runId,
        version: 5,
        script: '::page\n# Old draft',
        draftHash: 'old-draft-hash',
        createdAt: NOW,
      },
      plan: {
        version: 1,
        summary: 'Old notebook plan',
        steps: [{ id: 'old', title: 'Old work', status: 'completed' }],
        createdAt: NOW,
        updatedAt: NOW,
      },
      insertionTarget: { kind: 'book_end' },
      usage: { ...initial.usage, providerCalls: 8, toolCalls: 12, repairPasses: 4 },
    };
    await persistence.saveTask(completedWithOldDraft);
    const runtime = new AgentRuntime(provider, adapters(), persistence);
    await runtime.restore(completedWithOldDraft.identity.taskId);

    const result = await runtime.sendUserMessage('What is mathematics?', {
      userMessageId: 'reader-new-conversation-turn',
    });

    expect(result.state.lifecycle).toBe('completed');
    expect(result.state.draft).toBeUndefined();
    expect(result.state.plan).toBeUndefined();
    expect(result.state.insertionTarget).toBeUndefined();
    expect(result.state.usage.repairPasses).toBe(4);
    expect(result.state.budgetWindow).toMatchObject({
      providerCallsAtStart: 8,
      toolCallsAtStart: 12,
      repairPassesAtStart: 4,
      readerMessageId: 'reader-new-conversation-turn',
    });
    expect(repairPassesInBudgetWindow(result.state)).toBe(0);
    expect(provider.requests[0]?.tools.map((tool) => tool.name)).toContain('finish_conversation');
    expect(provider.requests[0]?.tools.map((tool) => tool.name)).not.toContain(
      'submit_notebook_script',
    );
    expect(provider.requests[0]?.systemPrompt).toMatch(
      /"currentTurn"[\s\S]*"objectiveMode":\s*"undecided"[\s\S]*"intentHint":\s*"conversation"/,
    );
    expect(provider.requests[0]?.systemPrompt).not.toContain('"task":{"goal":"hi"');
  });

  it('keeps ask_user clarification inside the same exhausted window', async () => {
    const provider = new BudgetProvider([{
      kind: 'tool',
      name: 'ask_user',
      args: {
        kind: 'requirements',
        context: null,
        question: 'Which topic should I explain?',
      },
    }]);
    const runtime = new AgentRuntime(
      provider,
      adapters(),
      new InMemoryAgentPersistence(),
    );
    const waiting = await runtime.start({
      taskId: 'budget-clarification-task',
      threadId: 'budget-clarification-thread',
      runId: 'budget-clarification-run',
      bookId: 'book-1',
      goal: 'Explain a topic.',
      budget: { maxProviderCalls: 1, maxToolCalls: 4 },
    });
    expect(waiting.state.lifecycle).toBe('waiting_for_user');
    expect(waiting.state.budgetWindow?.providerCallsAtStart).toBe(0);

    const resumed = await runtime.sendUserMessage('Osmosis.', {
      userMessageId: 'reader-clarification',
    });
    expect(provider.requests).toHaveLength(1);
    expect(resumed.state.lifecycle).toBe('failed');
    expect(resumed.state.lastError).toMatchObject({ code: 'budget_exhausted' });
    expect(resumed.state.budgetWindow).toEqual(waiting.state.budgetWindow);
    expect(resumed.state.usage.providerCalls).toBe(1);
  });

  it('opens a new window when a stopped task is retried with a reader follow-up', async () => {
    const provider = new BudgetProvider([finish('Recovered answer.')]);
    const persistence = new InMemoryAgentPersistence();
    const stoppedBase = createInitialAgentState({
      identity: {
        taskId: 'budget-stop-task',
        threadId: 'budget-stop-thread',
        runId: 'budget-stop-run',
        bookId: 'book-1',
      },
      goal: 'Give the initial answer.',
      budget: { maxProviderCalls: 2, maxToolCalls: 2 },
      now: NOW,
      userMessageId: 'reader-before-stop',
    });
    const stoppedState: AgentState = {
      ...stoppedBase,
      lifecycle: 'cancelled',
      usage: {
        ...stoppedBase.usage,
        providerCalls: 7,
        toolCalls: 9,
      },
      cancellation: {
        requested: true,
        requestedAt: NOW,
        reason: 'Reader pressed Stop',
        lastSafeCheckpointStep: 12,
      },
      checkpointStep: 12,
    };
    await persistence.saveTask(stoppedState);

    const runtime = new AgentRuntime(provider, adapters(), persistence);
    const restored = await runtime.restore('budget-stop-task');
    expect(restored.state).toMatchObject({
      lifecycle: 'cancelled',
      usage: { providerCalls: 7, toolCalls: 9 },
      cancellation: { requested: true },
    });

    const recovered = await runtime.sendUserMessage('Start over from this follow-up.');
    const followUpMessage = recovered.state.conversation.find(
      (message) => message.text === 'Start over from this follow-up.',
    );
    expect(recovered.state.lifecycle).toBe('completed');
    expect(recovered.state.usage).toMatchObject({ providerCalls: 8, toolCalls: 10 });
    expect(recovered.state.budgetWindow).toMatchObject({
      providerCallsAtStart: 7,
      toolCallsAtStart: 9,
      repairPassesAtStart: 0,
      readerMessageId: followUpMessage?.id,
    });
    expect(provider.requests).toHaveLength(1);
    expect((await persistence.loadTask('budget-stop-task'))?.state.budgetWindow)
      .toEqual(recovered.state.budgetWindow);
  });
});
