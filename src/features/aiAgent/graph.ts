import {
  Annotation,
  END,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import type { AgentAdapters } from './adapters';
import type { AgentEventBus } from './events';
import type { AgentPersistence } from './persistence';
import {
  AgentProviderError,
  collectProviderTurn,
  isRetryableProviderError,
  modelHistoryToProviderMessages,
  type AgentProvider,
  type AgentProviderTurnRequest,
  type CollectedProviderTurn,
} from './provider';
import { buildAgentSystemPrompt } from './prompts';
import {
  assertPrivatePlaceholdersRestorable,
  obfuscateProviderMessages,
  obfuscateProviderRequest,
  obfuscateTaskBrief,
  assertAgentTextPrivacyReceipt,
  restorePrivateText,
  textPrivacySystemInstruction,
} from './textPrivacy';
import { canCallAnotherProviderTurn } from './policy';
import { AgentToolCatalog } from './tools';
import type {
  AgentConversationMessage,
  AgentInterrupt,
  AgentModelAssistantTurn,
  AgentModelToolCall,
  AgentModelToolTurn,
  AgentPublicError,
  AgentResumeValue,
  AgentState,
} from './types';

export interface AgentGraphExecutionContext {
  currentSignal(): AbortSignal;
  isCurrentRun(runId: string): boolean;
}

async function saveCurrentTask(
  state: AgentState,
  dependencies: AgentGraphDependencies,
): Promise<void> {
  const signal = dependencies.execution.currentSignal();
  if (signal.aborted || !dependencies.execution.isCurrentRun(state.identity.runId)) return;
  await dependencies.persistence.saveTask(state);
}

export interface AgentGraphDependencies {
  readonly provider: AgentProvider;
  readonly adapters: AgentAdapters;
  readonly persistence: AgentPersistence;
  readonly events: AgentEventBus;
  readonly execution: AgentGraphExecutionContext;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const AgentGraphState = Annotation.Root({
  agent: Annotation<AgentState>(),
  pendingInterrupt: Annotation<AgentInterrupt | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  pendingInterruptCall: Annotation<AgentModelToolCall | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  resumeValue: Annotation<AgentResumeValue | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

export type AlcoveAgentGraphState = typeof AgentGraphState.State;

/**
 * Human-interrupting calls are an exclusive turn boundary. A model may emit
 * siblings in the same parallel batch, but those calls were authored before
 * it saw the reader's answer/approval and therefore cannot execute afterward.
 * Trim the corresponding assistant call list too so the next provider turn
 * receives a valid one-result-per-retained-call history.
 */
function discardInterruptSiblings(
  state: AgentState,
  call: AgentModelToolCall,
): AgentState {
  let turnIndex = -1;
  let callIndex = -1;
  for (let index = state.modelHistory.length - 1; index >= 0; index -= 1) {
    const turn = state.modelHistory[index];
    if (turn?.role !== 'assistant') continue;
    const candidate = turn.toolCalls.findIndex((item) => item.id === call.id);
    if (candidate >= 0) {
      turnIndex = index;
      callIndex = candidate;
      break;
    }
  }
  const modelHistory = state.modelHistory.map((turn, index) =>
    index === turnIndex && turn.role === 'assistant'
      ? { ...turn, toolCalls: turn.toolCalls.slice(0, callIndex + 1) }
      : turn,
  );
  return { ...state, modelHistory, pendingToolCalls: [] };
}

function publicErrorFromProvider(error: unknown): AgentPublicError {
  if (!(error instanceof AgentProviderError)) {
    return {
      code: 'internal',
      message: error instanceof Error ? error.message : 'The agent stopped unexpectedly.',
      retryable: false,
    };
  }
  switch (error.code) {
    case 'auth':
      return {
        code: 'provider_auth',
        message: 'The AI provider did not accept the saved connection.',
        retryable: false,
        status: error.status,
      };
    case 'rate_limit':
      return {
        code: 'provider_rate_limit',
        message: 'The AI provider is rate-limited. Alcove kept the last safe checkpoint.',
        retryable: true,
        status: error.status,
      };
    case 'invalid_response':
      return {
        code: 'provider_invalid_response',
        message: 'The AI provider returned an unusable response.',
        retryable: true,
        status: error.status,
      };
    case 'cancelled':
      return { code: 'cancelled', message: 'The agent was stopped.', retryable: true };
    case 'timeout':
    case 'unavailable':
      return {
        code: 'provider_unavailable',
        message: 'The AI provider is temporarily unavailable. Alcove kept the last safe checkpoint.',
        retryable: true,
        status: error.status,
      };
  }
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function retryDelayMs(attempt: number, providerDelay?: number): number {
  if (providerDelay !== undefined) return Math.min(30_000, Math.max(0, providerDelay));
  return Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
}

async function invokeProviderWithRetry(
  state: AgentState,
  request: AgentProviderTurnRequest,
  dependencies: AgentGraphDependencies,
): Promise<{ readonly turn: CollectedProviderTurn; readonly retries: number }> {
  let attempt = 0;
  while (true) {
    const signal = dependencies.execution.currentSignal();
    try {
      const turn = await collectProviderTurn(
        dependencies.provider.streamTurn(request, { signal }),
      );
      return { turn, retries: attempt };
    } catch (error) {
      if (signal.aborted) throw error;
      if (
        !isRetryableProviderError(error) ||
        attempt >= state.budget.maxProviderRetries
      ) {
        throw error;
      }
      attempt += 1;
      const delayMs = retryDelayMs(
        attempt,
        error instanceof AgentProviderError ? error.retryAfterMs : undefined,
      );
      await dependencies.events.emit({
        type: 'retry.scheduled',
        attempt,
        delayMs,
        summary: 'The provider is temporarily unavailable; retrying from the safe checkpoint.',
      });
      await (dependencies.sleep ?? abortableSleep)(delayMs, signal);
    }
  }
}

export function createAlcoveAgentGraph(dependencies: AgentGraphDependencies) {
  const tools = new AgentToolCatalog(dependencies.adapters, dependencies.events);

  const modelNode = async (
    graphState: AlcoveAgentGraphState,
  ): Promise<Partial<AlcoveAgentGraphState>> => {
    const queuedUserTurns = graphState.agent.pendingUserTurns ?? [];
    const state: AgentState = queuedUserTurns.length === 0
      ? graphState.agent
      : (() => {
          const {
            pendingUserTurns: _consumedUserTurns,
            ...settledState
          } = graphState.agent;
          return {
            ...settledState,
            modelHistory: [...graphState.agent.modelHistory, ...queuedUserTurns],
            checkpointStep: graphState.agent.checkpointStep + 1,
            updatedAt: dependencies.adapters.clock.now(),
          };
        })();
    const policy = canCallAnotherProviderTurn(state);
    if (!policy.allowed) {
      const error: AgentPublicError = {
        code: policy.code === 'cancelled' ? 'cancelled' : 'budget_exhausted',
        message: policy.reason ?? 'Agent budget exhausted.',
        retryable: policy.code === 'cancelled',
      };
      const failed = {
        ...state,
        lifecycle: policy.code === 'cancelled' ? ('cancelled' as const) : ('failed' as const),
        lastError: error,
        updatedAt: dependencies.adapters.clock.now(),
      };
      await saveCurrentTask(failed, dependencies);
      await dependencies.events.emit({ type: 'run.failed', error });
      return { agent: failed };
    }
    if (!dependencies.execution.isCurrentRun(state.identity.runId)) {
      throw new Error('superseded agent run');
    }

    // This is the final no-network boundary even when a custom runtime invokes
    // the graph without going through AgentRuntime.restore().
    assertAgentTextPrivacyReceipt(state.textPrivacy);
    let providerState = state;
    let promptState = state;
    let providerMessages = modelHistoryToProviderMessages(state.modelHistory);
    if (state.textPrivacy !== undefined) {
      const now = dependencies.adapters.clock.now();
      const brief = obfuscateTaskBrief(state.taskBrief, state.textPrivacy, now);
      const messages = obfuscateProviderMessages(
        providerMessages,
        brief.receipt,
        now,
      );
      providerMessages = [...messages.value];
      providerState = {
        ...state,
        textPrivacy: messages.receipt,
        updatedAt: now,
      };
      // Only the provider projection receives the masked brief. The durable
      // local state retains the reader's exact words for its own UI/history.
      promptState = { ...providerState, taskBrief: brief.value };
    }
    const privacyInstruction = textPrivacySystemInstruction(
      providerState.textPrivacy,
    );
    let request: AgentProviderTurnRequest = {
      requestId: dependencies.adapters.ids.create('provider'),
      runId: providerState.identity.runId,
      threadId: providerState.identity.threadId,
      systemPrompt: [buildAgentSystemPrompt(promptState), privacyInstruction]
        .filter(Boolean)
        .join('\n\n'),
      messages: providerMessages,
      tools: tools.descriptors(),
      toolChoice: 'required',
    };
    if (providerState.textPrivacy !== undefined) {
      // Re-project the complete provider message envelope after building the
      // request. The prompt was built from the masked brief; request ids,
      // compact-state identities, tool names and schemas stay untouched.
      const projected = obfuscateProviderRequest(
        request,
        providerState.textPrivacy,
        dependencies.adapters.clock.now(),
      );
      request = projected.value;
      providerState = {
        ...providerState,
        textPrivacy: projected.receipt,
        updatedAt: dependencies.adapters.clock.now(),
      };
      // Persist every newly discovered substitution BEFORE transport. If the
      // app stops after the request, Retry reuses the identical placeholders.
      await saveCurrentTask(providerState, dependencies);
    }

    try {
      const { turn, retries } = await invokeProviderWithRetry(
        providerState,
        request,
        dependencies,
      );
      if (turn.toolCalls.length === 0) {
        throw new AgentProviderError({
          code: 'invalid_response',
          message: 'provider stopped without choosing a completion or work tool',
        });
      }
      const now = dependencies.adapters.clock.now();
      const assistantTurn: AgentModelAssistantTurn = {
        id: dependencies.adapters.ids.create('model'),
        role: 'assistant',
        content: turn.publicText,
        ...(turn.toolPlan === '' ? {} : { toolPlan: turn.toolPlan }),
        toolCalls: turn.toolCalls,
        createdAt: now,
      };
      assertPrivatePlaceholdersRestorable(
        turn.publicText,
        providerState.textPrivacy,
      );
      const publicMessage: AgentConversationMessage | undefined = turn.publicText.trim()
        ? {
            id: dependencies.adapters.ids.create('msg'),
            role: 'assistant',
            // Model history deliberately retains placeholders. Only the local
            // conversation projection restores private values.
            text: restorePrivateText(
              turn.publicText.trim(),
              providerState.textPrivacy,
            ),
            createdAt: now,
          }
        : undefined;
      if (publicMessage !== undefined) {
        await dependencies.events.emit({
          type: 'assistant.message',
          message: publicMessage,
        });
      }
      const next: AgentState = {
        ...providerState,
        lifecycle: 'running',
        conversation:
          publicMessage === undefined
            ? providerState.conversation
            : [...providerState.conversation, publicMessage],
        modelHistory: [...providerState.modelHistory, assistantTurn],
        pendingToolCalls: turn.toolCalls,
        usage: {
          ...providerState.usage,
          providerCalls: providerState.usage.providerCalls + 1,
          providerRetries: providerState.usage.providerRetries + retries,
          inputTokens: providerState.usage.inputTokens + turn.inputTokens,
          outputTokens: providerState.usage.outputTokens + turn.outputTokens,
        },
        retry: { attempt: 0 },
        lastError: undefined,
        checkpointStep: state.checkpointStep + 1,
        updatedAt: now,
      };
      await saveCurrentTask(next, dependencies);
      return { agent: next };
    } catch (error) {
      if (dependencies.execution.currentSignal().aborted) throw error;
      const publicError = publicErrorFromProvider(error);
      const failed: AgentState = {
        ...providerState,
        lifecycle: 'failed',
        lastError: publicError,
        retry: {
          ...providerState.retry,
          attempt: providerState.retry.attempt + 1,
          lastStatus: publicError.status,
          lastMessage: publicError.message,
        },
        updatedAt: dependencies.adapters.clock.now(),
      };
      await saveCurrentTask(failed, dependencies);
      await dependencies.events.emit({ type: 'run.failed', error: publicError });
      throw error;
    }
  };

  const toolNode = async (
    graphState: AlcoveAgentGraphState,
  ): Promise<Partial<AlcoveAgentGraphState>> => {
    const state = graphState.agent;
    const call = state.pendingToolCalls[0];
    if (call === undefined) return { agent: state };
    const signal = dependencies.execution.currentSignal();
    const executed = await tools.execute(state, call, signal);
    if (executed.interrupt !== undefined) {
      // Dynamic interrupt() relies on Node AsyncLocalStorage. Alcove runs this
      // graph in a WebView, so the durable pause is a native static breakpoint
      // before `human`. The proposal tool has already checkpointed exactly once;
      // resuming never replays it or duplicates its activity events.
      const interruptedState = discardInterruptSiblings(executed.state, call);
      await saveCurrentTask(interruptedState, dependencies);
      return {
        agent: interruptedState,
        pendingInterrupt: executed.interrupt,
        pendingInterruptCall: call,
      };
    }

    const toolTurn: AgentModelToolTurn = {
      id: dependencies.adapters.ids.create('tool'),
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: executed.result,
      isError:
        typeof executed.result === 'object' &&
        executed.result !== null &&
        !Array.isArray(executed.result) &&
        'error' in executed.result,
      imageRefs: executed.imageRefs,
      imagePurpose: executed.imagePurpose,
      createdAt: dependencies.adapters.clock.now(),
    };
    const nextState: AgentState = {
      ...executed.state,
      modelHistory: [...executed.state.modelHistory, toolTurn],
      pendingToolCalls: executed.state.pendingToolCalls.slice(1),
      updatedAt: dependencies.adapters.clock.now(),
    };
    await saveCurrentTask(nextState, dependencies);
    return { agent: nextState };
  };

  const humanNode = async (
    graphState: AlcoveAgentGraphState,
  ): Promise<Partial<AlcoveAgentGraphState>> => {
    const call = graphState.pendingInterruptCall;
    const resume = graphState.resumeValue;
    if (graphState.pendingInterrupt === null || call === null || resume === null) {
      throw new Error('durable agent interrupt resumed without its response');
    }
    const resumed = await tools.completeInterrupt(
      graphState.agent,
      call,
      resume,
      dependencies.execution.currentSignal(),
    );
    const toolTurn: AgentModelToolTurn = {
      id: dependencies.adapters.ids.create('tool'),
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: resumed.result,
      isError:
        typeof resumed.result === 'object' &&
        resumed.result !== null &&
        !Array.isArray(resumed.result) &&
        'error' in resumed.result,
      createdAt: dependencies.adapters.clock.now(),
    };
    const nextState: AgentState = {
      ...resumed.state,
      modelHistory: [...resumed.state.modelHistory, toolTurn],
      // An interrupt is a mandatory model-observation boundary. Sibling calls
      // were discarded before pausing, so resume always returns to the model.
      pendingToolCalls: [],
      updatedAt: dependencies.adapters.clock.now(),
    };
    await saveCurrentTask(nextState, dependencies);
    return {
      agent: nextState,
      pendingInterrupt: null,
      pendingInterruptCall: null,
      resumeValue: null,
    };
  };

  const afterModel = (state: AlcoveAgentGraphState): 'tools' | typeof END =>
    state.agent.lifecycle === 'failed' || state.agent.lifecycle === 'cancelled'
      ? END
      : state.agent.pendingToolCalls.length > 0
        ? 'tools'
        : END;

  const afterTool = (
    state: AlcoveAgentGraphState,
  ): 'tools' | 'model' | 'human' | typeof END => {
    if (state.pendingInterrupt !== null) return 'human';
    if (
      state.agent.lifecycle === 'completed' ||
      state.agent.lifecycle === 'cancelled' ||
      state.agent.lifecycle === 'failed'
    ) {
      return END;
    }
    // Cohere parallel tool calls belong to one assistant turn. Execute every
    // non-interrupt sibling and append every contiguous tool result before the
    // next provider request; a partial result set is invalid conversation
    // history. Interrupting calls deliberately discard their stale siblings.
    return state.agent.pendingToolCalls.length > 0 ? 'tools' : 'model';
  };

  const afterHuman = (
    state: AlcoveAgentGraphState,
  ): 'tools' | 'model' | typeof END => {
    if (state.agent.patchProposal?.status === 'approved_pending_apply') {
      return END;
    }
    if (
      state.agent.lifecycle === 'completed' ||
      state.agent.lifecycle === 'cancelled' ||
      state.agent.lifecycle === 'failed'
    ) {
      return END;
    }
    return state.agent.pendingToolCalls.length > 0 ? 'tools' : 'model';
  };

  return new StateGraph(AgentGraphState)
    .addNode('model', modelNode)
    .addNode('tools', toolNode)
    .addNode('human', humanNode)
    .addEdge(START, 'model')
    .addConditionalEdges('model', afterModel, ['tools', END])
    .addConditionalEdges('tools', afterTool, ['tools', 'model', 'human', END])
    .addConditionalEdges('human', afterHuman, ['tools', 'model', END])
    .compile({
      checkpointer: dependencies.persistence.checkpointer as BaseCheckpointSaver,
      interruptBefore: ['human'],
      name: 'alcove-notebook-agent',
    });
}
