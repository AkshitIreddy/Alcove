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
import { normalizeNotebookScriptSubmission } from './draftCraft';
import {
  AgentProviderError,
  collectProviderTurn,
  deterministicRoutingToolName,
  isRetryableProviderError,
  modelHistoryToProviderProjection,
  type AgentProvider,
  type AgentProviderTurnRequest,
  type CollectedProviderTurn,
} from './provider';
import { buildAgentSystemPrompt } from './prompts';
import {
  agentRequestsNotebookMutation,
  latestReaderText,
  readerRequiresSourceEvidence,
} from './intent';
import {
  assertPrivatePlaceholdersRestorable,
  obfuscateProviderMessages,
  obfuscateProviderRequest,
  obfuscateTaskBrief,
  assertAgentTextPrivacyReceipt,
  restorePrivateText,
  textPrivacySystemInstruction,
} from './textPrivacy';
import {
  canCallAnotherProviderTurn,
  providerCallsInBudgetWindow,
  repairPassesInBudgetWindow,
  toolCallsInBudgetWindow,
} from './policy';
import { AgentToolCatalog, materialWorkFingerprint } from './tools';
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

/**
 * buildAgentSystemPrompt historically subtracts cumulative usage from the
 * configured limits. Give that read-only projection the current-window deltas
 * while preserving the real monotonic counts everywhere else in the graph.
 */
function promptStateWithWindowUsage(state: AgentState): AgentState {
  return {
    ...state,
    usage: {
      ...state.usage,
      providerCalls: providerCallsInBudgetWindow(state),
      toolCalls: toolCallsInBudgetWindow(state),
      repairPasses: repairPassesInBudgetWindow(state),
    },
  };
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

const NO_PROGRESS_WATCHDOG_RESULT = 'no_progress_warning';
const MAX_STAGNANT_TOOL_RESULTS = 3;

type NoProgressWatchdogDecision =
  | { readonly action: 'execute' }
  | {
      readonly action: 'warn' | 'stall';
      readonly signatureDigest: string;
      readonly previousCallId: string;
      readonly materialFingerprint: string;
      readonly reason: 'semantic_replay' | 'stagnant_phase';
    };

function jsonRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

/**
 * Collapse presentation-only whitespace for the no-progress signature without
 * changing the authoritative Notebook Script that is stored, hashed, rendered
 * or reviewed. Fenced and multiline-math bodies are deliberately opaque: code
 * blocks preserve indentation, blank lines, line endings and every character,
 * while diagrams and LaTeX can also attach meaning to whitespace. Only prose
 * outside those verbatim regions is normalized.
 */
function notebookScriptWatchdogText(
  script: string,
): readonly Readonly<{ kind: 'markup' | 'verbatim'; text: string }>[] {
  const source = normalizeNotebookScriptSubmission(script).script;
  const rows: Array<{ text: string; raw: string }> = [];
  const rowPattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  for (;;) {
    const match = rowPattern.exec(source);
    if (match === null) break;
    if (match[0].length === 0) break;
    rows.push({ text: match[1], raw: match[0] });
  }

  const blocks: Array<Readonly<{ kind: 'markup' | 'verbatim'; text: string }>> = [];
  let markup = '';
  const flushMarkup = (): void => {
    const lines = markup
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''));
    const compact: string[] = [];
    for (const line of lines) {
      if (line.length === 0 && compact[compact.length - 1] === '') continue;
      compact.push(line);
    }
    while (compact[0] === '') compact.shift();
    while (compact[compact.length - 1] === '') compact.pop();
    if (compact.length > 0) {
      blocks.push({ kind: 'markup', text: compact.join('\n') });
    }
    markup = '';
  };

  for (let index = 0; index < rows.length; index += 1) {
    const mathOpening = /^\s*\$\$(?:[ \t]*\{.*\})?\s*$/.test(rows[index].text);
    if (mathOpening) {
      flushMarkup();
      let math = rows[index].raw;
      while (index + 1 < rows.length) {
        index += 1;
        const row = rows[index];
        math += row.raw;
        if (/^\s*\$\$\s*$/.test(row.text)) break;
      }
      blocks.push({ kind: 'verbatim', text: math });
      continue;
    }
    const opening = /^\s*(`{3,})/.exec(rows[index].text);
    if (opening === null) {
      markup += rows[index].raw;
      continue;
    }
    flushMarkup();
    const openLength = opening[1].length;
    let fence = rows[index].raw;
    while (index + 1 < rows.length) {
      index += 1;
      const row = rows[index];
      fence += row.raw;
      const closing = /^\s*(`{2,})\s*$/.exec(row.text);
      if (
        closing !== null &&
        (openLength <= 3 || closing[1].length >= openLength)
      ) break;
    }
    blocks.push({ kind: 'verbatim', text: fence });
  }
  flushMarkup();
  return blocks;
}

function assistantCallForToolResult(
  history: AgentState['modelHistory'],
  toolCallId: string,
): AgentModelToolCall | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn?.role !== 'assistant') continue;
    const call = turn.toolCalls.find((candidate) => candidate.id === toolCallId);
    if (call !== undefined) return call;
  }
  return undefined;
}

/**
 * Detect semantic replays inside one reader turn. A changed Notebook Script or
 * genuinely new observation changes the material fingerprint and remains a
 * legitimate repair. Alternating a blocked call with an unrelated no-op no
 * longer hides the earlier failure and burns the full 24-call budget.
 */
async function noProgressWatchdogDecision(
  state: AgentState,
  call: AgentModelToolCall,
  dependencies: AgentGraphDependencies,
): Promise<NoProgressWatchdogDecision> {
  const readerMessageId = state.budgetWindow?.readerMessageId;
  if (readerMessageId === undefined) return { action: 'execute' };
  let readerTurnIndex = -1;
  for (let index = state.modelHistory.length - 1; index >= 0; index -= 1) {
    if (state.modelHistory[index]?.id === readerMessageId) {
      readerTurnIndex = index;
      break;
    }
  }
  // Old/imported checkpoints without the current reader-message anchor fail
  // open. A repeated first action in a later reader turn is legitimate even
  // when its arguments happen to match an action from the prior turn.
  if (readerTurnIndex < 0) return { action: 'execute' };
  const currentReaderTurnHistory = state.modelHistory.slice(readerTurnIndex + 1);
  const semanticSignature = (candidate: AgentModelToolCall): unknown => {
    if (candidate.name !== 'submit_notebook_script') {
      return { name: candidate.name, arguments: candidate.arguments };
    }
    const args = jsonRecord(candidate.arguments);
    const script = typeof args?.script === 'string'
      ? notebookScriptWatchdogText(args.script)
      : args?.script;
    const citedUnitIds = Array.isArray(args?.citedUnitIds)
      ? [...new Set(args.citedUnitIds.filter(
          (unitId): unitId is string => typeof unitId === 'string',
        ))].sort()
      : [];
    // `reason` is explanatory metadata. Changing initial/repair wording, JSON
    // key order or citation order does not turn the same script into progress.
    return { name: candidate.name, script, citedUnitIds };
  };
  const currentDigest = await dependencies.adapters.hash.digestJson(
    semanticSignature(call),
  );
  const currentMaterialFingerprint = materialWorkFingerprint(state);
  const priorResults = currentReaderTurnHistory.filter(
    (turn): turn is AgentModelToolTurn => turn.role === 'tool',
  ).reverse();
  for (const [resultIndex, previousResult] of priorResults.entries()) {
    const previousCall = assistantCallForToolResult(
      currentReaderTurnHistory,
      previousResult.toolCallId,
    );
    if (previousCall === undefined) continue;
    const previousDigest = await dependencies.adapters.hash.digestJson(
      semanticSignature(previousCall),
    );
    if (currentDigest !== previousDigest) continue;
    const previousPayload = jsonRecord(previousResult.content);
    const sameMaterial =
      previousPayload?.materialFingerprint === currentMaterialFingerprint;
    const previouslyBlocked =
      previousResult.isError ||
      previousPayload?.doNotRepeat === true ||
      previousPayload?.watchdog === NO_PROGRESS_WATCHDOG_RESULT;
    // Preserve the original immediate-repeat guard for successful calls, and
    // additionally remember failed/blocked signatures across intervening
    // no-ops while the material state is identical.
    if (resultIndex !== 0 && !(sameMaterial && previouslyBlocked)) continue;
    return {
      action:
        previousPayload?.watchdog === NO_PROGRESS_WATCHDOG_RESULT &&
        previousPayload.signatureDigest === currentDigest &&
        (sameMaterial || resultIndex === 0)
          ? 'stall'
          : 'warn',
      signatureDigest: currentDigest,
      previousCallId: previousCall.id,
      materialFingerprint: currentMaterialFingerprint,
      reason: 'semantic_replay',
    };
  }
  const phaseDigest = await dependencies.adapters.hash.digestJson({
    kind: 'stagnant_agent_phase',
    materialFingerprint: currentMaterialFingerprint,
  });
  let stagnantResults = 0;
  for (const previousResult of priorResults) {
    const previousPayload = jsonRecord(previousResult.content);
    if (previousPayload?.materialFingerprint !== currentMaterialFingerprint) break;
    if (
      previousPayload.watchdog === NO_PROGRESS_WATCHDOG_RESULT &&
      previousPayload.signatureDigest === phaseDigest
    ) {
      return {
        action: 'stall',
        signatureDigest: phaseDigest,
        previousCallId: previousResult.toolCallId,
        materialFingerprint: currentMaterialFingerprint,
        reason: 'stagnant_phase',
      };
    }
    stagnantResults += 1;
    if (stagnantResults >= MAX_STAGNANT_TOOL_RESULTS) {
      return {
        action: 'warn',
        signatureDigest: phaseDigest,
        previousCallId: previousResult.toolCallId,
        materialFingerprint: currentMaterialFingerprint,
        reason: 'stagnant_phase',
      };
    }
  }
  return { action: 'execute' };
}

function repeatedCallGuidance(call: AgentModelToolCall): string {
  return call.name === 'submit_notebook_script'
    ? 'Revise the Notebook Script materially from the current draft, then submit the changed complete script.'
    : 'Choose a different currently available action that advances the task state.';
}

async function checkpointWatchdogResult(
  state: AgentState,
  call: AgentModelToolCall,
  decision: Exclude<NoProgressWatchdogDecision, { readonly action: 'execute' }>,
  dependencies: AgentGraphDependencies,
): Promise<AgentState> {
  const stalled = decision.action === 'stall';
  const stagnantPhase = decision.reason === 'stagnant_phase';
  const message = stagnantPhase
    ? stalled
      ? 'The agent kept calling tools without changing the notebook, evidence, draft or review state.'
      : 'Alcove paused another tool call because several preceding calls made no material progress.'
    : stalled
      ? `The agent repeated ${call.name} after Alcove had already rejected that exact no-progress call.`
      : `Alcove skipped an exact repeated ${call.name} call because no new reader input or tool result could make it progress.`;
  const now = dependencies.adapters.clock.now();
  const toolTurn: AgentModelToolTurn = {
    id: dependencies.adapters.ids.create('tool'),
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: {
      error: message,
      retryable: true,
      doNotRepeat: true,
      watchdog: stalled ? 'agent_stalled' : NO_PROGRESS_WATCHDOG_RESULT,
      signatureDigest: decision.signatureDigest,
      previousCallId: decision.previousCallId,
      materialFingerprint: decision.materialFingerprint,
      nextAction: repeatedCallGuidance(call),
    },
    isError: true,
    createdAt: now,
  };
  const checkpointStep = state.checkpointStep + 1;
  const next: AgentState = {
    ...state,
    lifecycle: stalled ? 'failed' : state.lifecycle,
    modelHistory: [...state.modelHistory, toolTurn],
    pendingToolCalls: stalled ? [] : state.pendingToolCalls.slice(1),
    lastError: {
      code: stalled ? 'agent_stalled' : 'tool_error',
      message,
      retryable: true,
    },
    checkpointStep,
    cancellation: {
      ...state.cancellation,
      lastSafeCheckpointStep: checkpointStep,
    },
    updatedAt: now,
  };
  await saveCurrentTask(next, dependencies);
  await dependencies.events.emit({
    type: 'tool.failed',
    toolCallId: call.id,
    toolName: call.name,
    message,
  });
  if (stalled) {
    await dependencies.events.emit({
      type: 'run.failed',
      error: next.lastError!,
    });
  }
  return next;
}

/**
 * REQUIRED tool choice is sent on Agent requests, but the returned provider
 * stream is still untrusted. Preserve a narrow answer-only fallback for a
 * useful conversational completion that violates that request; it never gains
 * notebook authority. Explicit book-editing language still fails closed so a
 * prose response cannot silently replace requested pages.
 */
const SIMPLE_GREETING = /^(?:hi|hello|hey|hiya|howdy|good\s+(?:morning|afternoon|evening))[\s!,.?]*$/iu;
const SOURCE_ROUTING_TOOLS = new Set([
  'list_source_manifest',
  'plan_source_retrieval',
  'read_source_range',
  'read_full_source',
  'search_source_index',
  'rerank_source_hits',
  'inspect_source_coverage',
]);

function hasSourceRoutingTool(request: AgentProviderTurnRequest): boolean {
  return request.tools.some((tool) => SOURCE_ROUTING_TOOLS.has(tool.name));
}

function isNotebookDraftSubmissionTurn(request: AgentProviderTurnRequest): boolean {
  return request.tools.length === 1 &&
    request.tools[0]?.name === 'submit_notebook_script';
}

function notebookDraftFromProseFallback(
  state: AgentState,
  request: AgentProviderTurnRequest,
  turn: CollectedProviderTurn,
): AgentModelToolCall | undefined {
  if (!isNotebookDraftSubmissionTurn(request)) return undefined;
  const script = normalizeNotebookScriptSubmission(turn.publicText).script.trim();
  if (script === '') return undefined;
  return {
    id: `draft-prose-recovery-${state.identity.runId}-${state.checkpointStep + 1}`,
    name: 'submit_notebook_script',
    arguments: {
      script,
      citedUnitIds: [...new Set(state.sourceCoverage?.readUnitIds ?? [])],
      reason: state.draft === undefined ? 'initial' : 'repair',
    },
  };
}

const SUPERVISED_EMPTY_ARGUMENT_TOOLS = new Set([
  'validate_notebook_script',
  'render_draft_preview',
  'propose_notebook_patch',
  'submit_notebook_patch',
]);
const VISUAL_FINDING_SEVERITIES = new Set(['info', 'warning', 'blocking']);
const VISUAL_FINDING_CATEGORIES = new Set([
  'overflow', 'clipping', 'collision', 'illegible', 'empty_page', 'bad_break',
  'missing_media', 'duplication', 'visual_hierarchy', 'other',
]);

function reviewCallIsUsable(
  state: AgentState,
  call: AgentModelToolCall,
): boolean {
  const generation = state.previewGeneration;
  const args = jsonRecord(call.arguments);
  if (
    generation === undefined || args?.generationId !== generation.generationId ||
    !Array.isArray(args.reviews) || args.reviews.length === 0
  ) return false;
  const pageIds = new Set(generation.pages.map((page) => page.pageId));
  return args.reviews.every((value) => {
    const review = jsonRecord(value);
    if (
      typeof review?.pageId !== 'string' || !pageIds.has(review.pageId) ||
      !Array.isArray(review.findings)
    ) return false;
    return review.findings.every((findingValue) => {
      const finding = jsonRecord(findingValue);
      return typeof finding?.severity === 'string' &&
        VISUAL_FINDING_SEVERITIES.has(finding.severity) &&
        typeof finding.category === 'string' &&
        VISUAL_FINDING_CATEGORIES.has(finding.category) &&
        typeof finding.summary === 'string' && finding.summary.trim() !== '' &&
        (finding.evidence === undefined || typeof finding.evidence === 'string');
    });
  });
}

function previewReadCallIsUsable(
  state: AgentState,
  call: AgentModelToolCall,
): boolean {
  const generation = state.previewGeneration;
  const args = jsonRecord(call.arguments);
  if (
    generation === undefined || args?.generationId !== generation.generationId ||
    !Array.isArray(args.pageIds) || args.pageIds.length === 0
  ) return false;
  const pageIds = new Set(generation.pages.map((page) => page.pageId));
  return args.pageIds.every((pageId) => typeof pageId === 'string' && pageIds.has(pageId));
}

function locallySupervisedSingletonCalls(
  state: AgentState,
  request: AgentProviderTurnRequest,
  calls: readonly AgentModelToolCall[],
): readonly AgentModelToolCall[] {
  if (request.tools.length !== 1) {
    const reviewToolNames = new Set(request.tools.map((tool) => tool.name));
    const reviewOnly = [...reviewToolNames].every((name) =>
      name === 'read_draft_preview_pages' || name === 'record_visual_review');
    const providerStayedInPhase = calls.length > 0 && calls.every((call) =>
      reviewToolNames.has(call.name));
    if (!reviewOnly || providerStayedInPhase) return calls;
    const generation = state.previewGeneration;
    if (generation === undefined) return calls;
    const exposed = new Set(
      (state.visualReview?.imageExposures ?? [])
        .filter((item) => item.generationId === generation.generationId)
        .map((item) => item.pageId),
    );
    const inspected = new Set(state.visualReview?.inspectedPageIds ?? []);
    const expected = generation.pages.some((page) =>
      exposed.has(page.pageId) && !inspected.has(page.pageId))
      ? 'record_visual_review'
      : 'read_draft_preview_pages';
    const descriptor = request.tools.find((tool) => tool.name === expected);
    return descriptor === undefined
      ? calls
      : locallySupervisedSingletonCalls(
          state,
          { ...request, tools: [descriptor] },
          [],
        );
  }
  const expected = request.tools[0]!.name;
  if (calls.length === 1 && calls[0]?.name === expected) {
    if (expected === 'record_visual_review' && reviewCallIsUsable(state, calls[0])) {
      return calls;
    }
    if (expected === 'read_draft_preview_pages' && previewReadCallIsUsable(state, calls[0])) {
      return calls;
    }
    if (
      expected !== 'record_visual_review' &&
      expected !== 'read_draft_preview_pages'
    ) return calls;
  }
  const id = `supervised-${expected}-${state.identity.runId}-${state.checkpointStep + 1}`;
  if (SUPERVISED_EMPTY_ARGUMENT_TOOLS.has(expected)) {
    return [{ id, name: expected, arguments: {} }];
  }
  if (expected === 'read_draft_preview_pages') {
    const generation = state.previewGeneration;
    if (generation === undefined) return calls;
    const exposed = new Set(
      (state.visualReview?.imageExposures ?? [])
        .filter((item) => item.generationId === generation.generationId)
        .map((item) => item.pageId),
    );
    const pageIds = generation.pages
      .map((page) => page.pageId)
      .filter((pageId) => !exposed.has(pageId))
      .slice(0, 20);
    if (pageIds.length === 0) return calls;
    return [{
      id,
      name: expected,
      arguments: { generationId: generation.generationId, pageIds },
    }];
  }
  if (expected === 'record_visual_review') {
    const generation = state.previewGeneration;
    if (generation === undefined) return calls;
    const exposed = new Set(
      (state.visualReview?.imageExposures ?? [])
        .filter((item) => item.generationId === generation.generationId)
        .map((item) => item.pageId),
    );
    const inspected = new Set(state.visualReview?.inspectedPageIds ?? []);
    const pageIds = generation.pages
      .map((page) => page.pageId)
      .filter((pageId) => exposed.has(pageId) && !inspected.has(pageId));
    if (pageIds.length === 0) return calls;
    return [{
      id,
      name: expected,
      arguments: {
        generationId: generation.generationId,
        reviews: pageIds.map((pageId) => ({ pageId, findings: [] })),
      },
    }];
  }
  return calls;
}

function cohereLocalWorkflowCalls(
  state: AgentState,
  request: AgentProviderTurnRequest,
): readonly AgentModelToolCall[] {
  const create = (name: string, arguments_: AgentModelToolCall['arguments']) => ({
    id: `local-${name}-${state.identity.runId}-${state.checkpointStep + 1}`,
    name,
    arguments: arguments_,
  });
  if (request.tools.length === 1) {
    const supervised = locallySupervisedSingletonCalls(state, request, []);
    if (
      supervised.length > 0 &&
      (
        SUPERVISED_EMPTY_ARGUMENT_TOOLS.has(request.tools[0]!.name) ||
        request.tools[0]!.name === 'read_draft_preview_pages'
      )
    ) return supervised;
  }
  if (!agentRequestsNotebookMutation(state) || state.draft !== undefined) return [];
  const toolNames = new Set(request.tools.map((tool) => tool.name));
  if (state.notebookSnapshot === undefined && toolNames.has('inspect_notebook')) {
    return [create('inspect_notebook', {})];
  }
  const readerSources = state.sourceManifest?.sources.filter(
    (source) => source.kind !== 'notebook_script_spec',
  ) ?? [];
  if (
    readerRequiresSourceEvidence(state) &&
    (state.sourceCoverage?.readUnitIds.length ?? 0) === 0 &&
    readerSources.length === 1 &&
    toolNames.has('read_full_source')
  ) {
    return [create('read_full_source', { sourceId: readerSources[0]!.id })];
  }
  return [];
}

function localGreetingCompletion(state: AgentState): AgentModelToolCall | undefined {
  if (
    state.draft !== undefined ||
    state.previewGeneration !== undefined ||
    (state.patchProposal !== undefined && state.patchProposal.status !== 'applied')
  ) return undefined;
  const readerText = latestReaderText(state).trim();
  if (!SIMPLE_GREETING.test(readerText)) return undefined;
  return {
    id: `conversation-greeting-${state.identity.runId}-${state.checkpointStep + 1}`,
    name: 'finish_conversation',
    arguments: {
      answer: 'Hi! What would you like to explore, explain, or add to this notebook?',
      citedUnitIds: [],
    },
  };
}

function proseOnlyConversationFallback(
  state: AgentState,
  turn: CollectedProviderTurn,
): AgentModelToolCall | undefined {
  const answer = turn.publicText.trim();
  if (answer === '' || turn.finishReason !== 'stop') return undefined;
  if (
    state.draft !== undefined ||
    state.previewGeneration !== undefined ||
    (state.patchProposal !== undefined && state.patchProposal.status !== 'applied')
  ) {
    return undefined;
  }
  if (agentRequestsNotebookMutation(state)) return undefined;
  return {
    id: `conversation-fallback-${state.identity.runId}-${state.usage.providerCalls + 1}`,
    name: 'finish_conversation',
    arguments: { answer, citedUnitIds: [] },
  };
}

class ProviderCallBudgetExhaustedError extends Error {
  constructor(readonly limit: number) {
    super(`provider-call budget exhausted (${limit})`);
    this.name = 'ProviderCallBudgetExhaustedError';
  }
}

function publicErrorFromProvider(error: unknown): AgentPublicError {
  if (error instanceof ProviderCallBudgetExhaustedError) {
    return {
      code: 'budget_exhausted',
      message: error.message,
      retryable: false,
    };
  }
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
        diagnosticDetail: error.message
          .replace(/\bBearer\s+[^\s"']+/giu, 'Bearer [redacted]')
          .slice(0, 1_200),
        // A malformed/incomplete stream has no gateway retry verdict and may
        // succeed when the reader tries again. A normalized HTTP 4xx request
        // is different: the gateway explicitly marks it non-retryable, so do
        // not offer a Retry button that can only resend the same rejected
        // envelope.
        retryable: error.retryable ?? true,
        status: error.status,
      };
    case 'cancelled':
      return { code: 'cancelled', message: 'The agent was stopped.', retryable: true };
    case 'timeout':
    case 'unavailable':
      return {
        code: 'provider_unavailable',
        message: 'The AI provider is temporarily unavailable. Alcove kept the last safe checkpoint.',
        diagnosticDetail: error.message
          .replace(/\bBearer\s+[^\s"']+/giu, 'Bearer [redacted]')
          .slice(0, 1_200),
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
  usage: {
    providerCalls: number;
    providerRetries: number;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<CollectedProviderTurn> {
  let attempt = 0;
  const callsAtInvocationStart = providerCallsInBudgetWindow(state);
  while (true) {
    if (
      callsAtInvocationStart + usage.providerCalls >=
        state.budget.maxProviderCalls
    ) {
      throw new ProviderCallBudgetExhaustedError(state.budget.maxProviderCalls);
    }
    const signal = dependencies.execution.currentSignal();
    usage.providerCalls += 1;
    try {
      const turn = await collectProviderTurn(
        dependencies.provider.streamTurn(request, { signal }),
      );
      usage.inputTokens += turn.inputTokens;
      usage.outputTokens += turn.outputTokens;
      return turn;
    } catch (error) {
      if (signal.aborted) throw error;
      if (
        !isRetryableProviderError(error) ||
        attempt >= state.budget.maxProviderRetries
      ) {
        throw error;
      }
      if (
        callsAtInvocationStart + usage.providerCalls >=
          state.budget.maxProviderCalls
      ) {
        throw new ProviderCallBudgetExhaustedError(state.budget.maxProviderCalls);
      }
      attempt += 1;
      usage.providerRetries += 1;
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

    // This is the final boundary even when a custom runtime invokes the graph
    // without going through AgentRuntime.restore(). Local greeting completion
    // must not bypass receipt-integrity checks either.
    assertAgentTextPrivacyReceipt(state.textPrivacy);

    // Greetings should feel instant and must not fail merely because Command
    // A+ chose an empty prose turn instead of the optional completion tool.
    // This narrow local response has no notebook or source authority.
    const greetingCall = localGreetingCompletion(state);
    if (greetingCall !== undefined) {
      const now = dependencies.adapters.clock.now();
      const assistantTurn: AgentModelAssistantTurn = {
        id: dependencies.adapters.ids.create('model'),
        role: 'assistant',
        content: '',
        toolCalls: [greetingCall],
        createdAt: now,
      };
      const next: AgentState = {
        ...state,
        modelHistory: [...state.modelHistory, assistantTurn],
        pendingToolCalls: [greetingCall],
        lastError: undefined,
        checkpointStep: state.checkpointStep + 1,
        updatedAt: now,
      };
      await saveCurrentTask(next, dependencies);
      return { agent: next };
    }

    let providerState = state;
    let promptState = state;
    // Keep the durable transcript complete for restart/debugging, but never
    // resend every superseded repair script on every provider hop. The
    // projection preserves one exact current script and every tool pairing.
    let providerMessages = [...modelHistoryToProviderProjection(
      state.modelHistory,
      state.draft,
      state.sourceManifest,
    ).messages];
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
    const strictToolTurn =
      agentRequestsNotebookMutation(providerState) ||
      readerRequiresSourceEvidence(providerState);
    let request: AgentProviderTurnRequest = {
      requestId: dependencies.adapters.ids.create('provider'),
      runId: providerState.identity.runId,
      threadId: providerState.identity.threadId,
      systemPrompt: [
        buildAgentSystemPrompt(promptStateWithWindowUsage(promptState)),
        privacyInstruction,
      ]
        .filter(Boolean)
        .join('\n\n'),
      messages: providerMessages,
      tools: tools.descriptorsForState(providerState),
      // An ordinary source-free explanation is allowed to arrive as natural
      // prose and is wrapped into Alcove's local finish tool below. Notebook
      // work and grounded source work remain forced tool turns.
      toolChoice: strictToolTurn ? 'required' : 'auto',
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

    const invocationUsage = {
      providerCalls: 0,
      providerRetries: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    const deterministicTool = deterministicRoutingToolName(request);
    try {
      let turn: CollectedProviderTurn;
      const localWorkflowCalls = dependencies.provider.id === 'cohere'
        ? cohereLocalWorkflowCalls(providerState, request)
        : [];
      if (localWorkflowCalls.length > 0) {
        turn = {
          publicText: '',
          // Command A+ rejects synthetic assistant history carrying tool_plan.
          // The locally authorized call/result pair is complete without it.
          toolPlan: '',
          toolCalls: localWorkflowCalls,
          citations: [],
          inputTokens: 0,
          outputTokens: 0,
          finishReason: 'tool_calls',
        };
      } else try {
        turn = await invokeProviderWithRetry(
          providerState,
          request,
          dependencies,
          invocationUsage,
        );
      } catch (error) {
        if (
          !strictToolTurn &&
          error instanceof AgentProviderError &&
          error.code === 'invalid_response'
        ) {
          // Some provider/schema combinations can reject or corrupt an
          // otherwise harmless optional-tool envelope. Conversation-only
          // turns have no notebook or source authority, so make one bounded
          // plain-prose request and validate/wrap its complete STOP response
          // through finish_conversation locally. The failed first attempt is
          // still counted against the provider-call budget.
          turn = await invokeProviderWithRetry(
            providerState,
            {
              ...request,
              requestId: dependencies.adapters.ids.create('provider'),
              tools: [],
              toolChoice: 'auto',
              systemPrompt: `${request.systemPrompt}\n\nThe optional conversation-tool envelope was not usable. Answer the reader's current request directly in complete reader-facing prose. Do not describe tools, workflow, or this recovery instruction.`,
            },
            dependencies,
            invocationUsage,
          );
        } else if (
          error instanceof AgentProviderError &&
          error.code === 'invalid_response' &&
          error.status === undefined &&
          error.retryable !== false &&
          isNotebookDraftSubmissionTurn(request) &&
          providerCallsInBudgetWindow(providerState) + invocationUsage.providerCalls <
            providerState.budget.maxProviderCalls
        ) {
          // The model has already observed the source, but Cohere occasionally
          // corrupts the single submit_notebook_script tool envelope. Preserve
          // model agency by asking the same model for raw Notebook Script over
          // a plain content turn, then let the local supervisor synthesize the
          // draft-only tool call. Validation/render/review and reader approval
          // remain unchanged; this fallback cannot write to the notebook.
          turn = await invokeProviderWithRetry(
            providerState,
            {
              ...request,
              requestId: dependencies.adapters.ids.create('provider'),
              tools: [],
              toolChoice: 'auto',
              systemPrompt: `${request.systemPrompt}\n\nThe previous draft tool envelope could not be parsed and was not executed. Return only the complete raw Notebook Script now—no prose preface, no outer code fence, and no manual insertion instructions. Use the source pixels/text already supplied and keep the reader's requested amount of write-up. Alcove will validate, render and review this draft locally before showing any Insert action.`,
            },
            dependencies,
            invocationUsage,
          );
        } else if (
          error instanceof AgentProviderError &&
          error.code === 'invalid_response' &&
          error.status === undefined &&
          error.retryable !== false &&
          request.tools.length === 1 &&
          request.tools[0]?.name === 'record_visual_review'
        ) {
          // The native generation already passed parser/layout/media checks
          // and its exact pixels were exposed. If Cohere corrupts only the
          // review-call JSON, let the phase supervisor build the complete
          // empty-finding ledger instead of throwing away the whole draft.
          turn = {
            publicText: '',
            toolPlan: '',
            toolCalls: [],
            citations: [],
            inputTokens: 0,
            outputTokens: 0,
            finishReason: 'stop',
          };
        } else if (
          error instanceof AgentProviderError &&
          error.code === 'invalid_response' &&
          error.status === undefined &&
          error.retryable !== false &&
          hasSourceRoutingTool(request) &&
          providerCallsInBudgetWindow(providerState) + invocationUsage.providerCalls <
            providerState.budget.maxProviderCalls
        ) {
          // A malformed/incomplete source-routing stream contains no tool
          // result for the model to analyse. Make exactly one counted
          // corrective model turn with the same local capability boundary;
          // never retry a normalized HTTP 4xx envelope rejection here.
          turn = await invokeProviderWithRetry(
            providerState,
            {
              ...request,
              requestId: dependencies.adapters.ids.create('provider'),
              systemPrompt: `${request.systemPrompt}\n\nYour previous source-routing response could not be parsed and was not executed. Choose exactly one currently advertised source or notebook tool with complete valid arguments. If source pixels or text have not been read, plan or read the named source now. Do not answer in prose and do not repeat a coverage inspection that changed no state.`,
            },
            dependencies,
            invocationUsage,
          );
        } else {
        // A malformed provider stream normally fails closed. These four
        // argument-free singleton phases are different: local policy already
        // selected the only authorized transition, and each tool rechecks its
        // own freshness/safety boundary. Preserve the failed call in usage,
        // then route the deterministic local capability instead of pausing on
        // malformed JSON or an incomplete tool stream.
          if (
          deterministicTool === undefined ||
          !(error instanceof AgentProviderError) ||
          error.code !== 'invalid_response'
        ) throw error;
          turn = {
            publicText: '',
            toolPlan: '',
            toolCalls: [],
            citations: [],
            inputTokens: 0,
            outputTokens: 0,
            finishReason: 'stop',
          };
        }
      }
      let fallbackCall = turn.toolCalls.length === 0
        ? proseOnlyConversationFallback(providerState, turn) ??
          notebookDraftFromProseFallback(providerState, request, turn)
        : undefined;
      let toolCalls = fallbackCall === undefined
        ? turn.toolCalls
        : [fallbackCall];
      toolCalls = [...locallySupervisedSingletonCalls(
        providerState,
        request,
        toolCalls,
      )];
      if (toolCalls.length === 0 && deterministicTool !== undefined) {
        toolCalls = [{
          id: `deterministic-${deterministicTool}-${providerState.identity.runId}-${providerState.checkpointStep + 1}`,
          name: deterministicTool,
          arguments: {},
        }];
      }
      const notebookToolRepair =
        toolCalls.length === 0 && agentRequestsNotebookMutation(providerState);
      if (
        toolCalls.length === 0 &&
        turn.finishReason === 'stop' &&
        (turn.publicText.trim() === '' || notebookToolRepair) &&
        providerCallsInBudgetWindow(providerState) + invocationUsage.providerCalls <
          providerState.budget.maxProviderCalls
      ) {
        turn = await invokeProviderWithRetry(
          providerState,
          {
            ...request,
            requestId: dependencies.adapters.ids.create('provider'),
            systemPrompt: notebookToolRepair
              ? `${request.systemPrompt}\n\nYour previous turn tried to answer a notebook-change request with prose. That prose was not shown. Do not paste Notebook Script or manual insertion instructions into chat. Choose the concrete notebook capability that advances the current work, and continue until the immutable final preview is presented.`
              : `${request.systemPrompt}\n\nYour previous turn ended without visible prose or a tool call. Complete this turn now: use finish_conversation with a complete answer for conversation-only intent, or choose the next valid work tool for notebook intent.`,
          },
          dependencies,
          invocationUsage,
        );
        fallbackCall = turn.toolCalls.length === 0
          ? proseOnlyConversationFallback(providerState, turn) ??
            notebookDraftFromProseFallback(providerState, request, turn)
          : undefined;
        toolCalls = fallbackCall === undefined ? turn.toolCalls : [fallbackCall];
        toolCalls = [...locallySupervisedSingletonCalls(
          providerState,
          request,
          toolCalls,
        )];
      }
      if (toolCalls.length === 0) {
        throw new AgentProviderError({
          code: 'invalid_response',
          message: 'provider stopped without choosing a completion or work tool',
        });
      }
      const now = dependencies.adapters.clock.now();
      const publicTextIsOwnedByTool = toolCalls.some(
        (call) => call.name === 'finish_conversation' || call.name === 'ask_user',
      );
      const publicTextShouldStayInternal =
        publicTextIsOwnedByTool || agentRequestsNotebookMutation(providerState);
      const assistantTurn: AgentModelAssistantTurn = {
        id: dependencies.adapters.ids.create('model'),
        role: 'assistant',
        // These tools carry the sole reader-visible prose in their validated
        // arguments. Dropping incidental streamed prose prevents the next
        // provider turn from seeing a duplicate question/answer formulation.
        content: publicTextShouldStayInternal ? '' : turn.publicText,
        ...(turn.toolPlan === '' ? {} : { toolPlan: turn.toolPlan }),
        toolCalls,
        createdAt: now,
      };
      assertPrivatePlaceholdersRestorable(
        turn.publicText,
        providerState.textPrivacy,
      );
      const publicMessage: AgentConversationMessage | undefined =
        !publicTextShouldStayInternal && turn.publicText.trim()
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
        pendingToolCalls: toolCalls,
        usage: {
          ...providerState.usage,
          providerCalls: providerState.usage.providerCalls + invocationUsage.providerCalls,
          providerRetries:
            providerState.usage.providerRetries + invocationUsage.providerRetries,
          inputTokens: providerState.usage.inputTokens + invocationUsage.inputTokens,
          outputTokens: providerState.usage.outputTokens + invocationUsage.outputTokens,
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
        usage: {
          ...providerState.usage,
          providerCalls: providerState.usage.providerCalls + invocationUsage.providerCalls,
          providerRetries:
            providerState.usage.providerRetries + invocationUsage.providerRetries,
          inputTokens: providerState.usage.inputTokens + invocationUsage.inputTokens,
          outputTokens: providerState.usage.outputTokens + invocationUsage.outputTokens,
        },
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
      // Return the graph's fully current failure state. Throwing here makes
      // AgentRuntime's outer catch rebuild from its pre-resume snapshot,
      // which can erase the exact reader reply and durable question that were
      // already checkpointed by the human node.
      return { agent: failed };
    }
  };

  const toolNode = async (
    graphState: AlcoveAgentGraphState,
  ): Promise<Partial<AlcoveAgentGraphState>> => {
    const state = graphState.agent;
    const call = state.pendingToolCalls[0];
    if (call === undefined) return { agent: state };
    const watchdog = await noProgressWatchdogDecision(
      state,
      call,
      dependencies,
    );
    if (watchdog.action !== 'execute') {
      return {
        agent: await checkpointWatchdogResult(
          state,
          call,
          watchdog,
          dependencies,
        ),
      };
    }
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

    const resultRecord = jsonRecord(executed.result);
    const toolTurn: AgentModelToolTurn = {
      id: dependencies.adapters.ids.create('tool'),
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content:
        executed.watchdogMaterialFingerprint !== undefined && resultRecord !== undefined
          ? {
              ...resultRecord,
              materialFingerprint: executed.watchdogMaterialFingerprint,
            }
          : executed.result,
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
