import type { AgentAdapters, SourceAttachmentRef } from './adapters';
import { createSourceCoverageLedger } from './coverage';
import { AgentEventBus, type AgentEventListener } from './events';
import { createAlcoveAgentGraph } from './graph';
import {
  generationIdsOwnedByState,
  localFinalGenerationIdsOwnedByState,
} from './generationOwnership';
import type { AgentPersistence } from './persistence';
import type { AgentProvider } from './provider';
import { computeNotebookSelectionDigest } from './selectionDigest';
import {
  assertAgentTextPrivacyReceipt,
  createAgentTextPrivacyReceipt,
} from './textPrivacy';
import {
  createInitialAgentState,
  type AgentActivityEvent,
  type AgentInterrupt,
  type AgentContextPolicy,
  type AgentResumeValue,
  type AgentRunIdentity,
  type AgentRunResult,
  type AgentState,
  type AgentToolBudget,
  type NotebookInsertionTarget,
} from './types';

export interface StartAgentTaskInput {
  readonly taskId?: string;
  readonly threadId?: string;
  readonly runId?: string;
  readonly bookId: string;
  readonly goal: string;
  readonly desiredOutcome?: string;
  readonly creativeDirection?: string;
  readonly defaultContextPolicy?: AgentContextPolicy;
  readonly preserveAllSourceInformation?: boolean;
  readonly obfuscatePrivateText?: boolean;
  readonly attachments?: readonly SourceAttachmentRef[];
  readonly insertionTarget?: NotebookInsertionTarget;
  readonly budget?: Partial<AgentToolBudget>;
}

export interface AgentRuntimeSnapshot {
  readonly state: AgentState | null;
  readonly interrupt: AgentInterrupt | null;
  readonly busy: boolean;
}

export interface SelectionRewriteRequest {
  readonly bookId: string;
  readonly pageId: string;
  readonly from: number;
  readonly to: number;
  readonly pageRevision: string;
  readonly prompt: string;
  readonly selectedText?: string;
  readonly obfuscatePrivateText?: boolean;
}

interface RetryContinuationOptions {
  /** A reader follow-up typed after Stop; durably queued before work resumes. */
  readonly followUpMessage?: string;
  readonly preserveAllSourceInformation?: boolean;
}

export type AgentRuntimeListener = (snapshot: AgentRuntimeSnapshot) => void;

interface ActiveExecution {
  readonly identity: AgentRunIdentity;
  readonly bus: AgentEventBus;
  readonly graph: ReturnType<typeof createAlcoveAgentGraph>;
  readonly config: {
    readonly configurable: { readonly thread_id: string };
    readonly recursionLimit: number;
    readonly signal?: AbortSignal;
  };
  abort: AbortController;
  state: AgentState;
  interrupt: AgentInterrupt | null;
  busy: boolean;
  invocation: Promise<AgentRunResult> | null;
  /** Monotonic guard preventing an old invocation from committing into a retry. */
  epoch: number;
  /** Source-ingestion barrier for Stop racing the initial start() call. */
  setupSettled: Promise<void>;
}

function extractInterrupt(value: unknown): AgentInterrupt | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const pending = record.pendingInterrupt;
  if (pending !== null && typeof pending === 'object') {
    const kind = (pending as { kind?: unknown }).kind;
    if (kind === 'requirements' || kind === 'blocker' || kind === 'final_preview') {
      return pending as AgentInterrupt;
    }
  }
  const interrupts = record.__interrupt__;
  if (!Array.isArray(interrupts) || interrupts.length === 0) return null;
  const first = interrupts[0];
  if (first === null || typeof first !== 'object') return null;
  const payload = (first as { value?: unknown }).value;
  if (payload === null || typeof payload !== 'object') return null;
  const kind = (payload as { kind?: unknown }).kind;
  return kind === 'requirements' || kind === 'blocker' || kind === 'final_preview'
    ? (payload as AgentInterrupt)
    : null;
}

function extractSnapshotInterrupt(snapshot: unknown): AgentInterrupt | null {
  if (snapshot === null || typeof snapshot !== 'object') return null;
  const tasks = (snapshot as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return null;
  for (const task of tasks) {
    if (task === null || typeof task !== 'object') continue;
    const interrupts = (task as { interrupts?: unknown }).interrupts;
    if (!Array.isArray(interrupts)) continue;
    for (const item of interrupts) {
      const interrupt = extractInterrupt({ __interrupt__: [item] });
      if (interrupt !== null) return interrupt;
    }
  }
  return null;
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError');
}

function cloneSourceAttachmentRefs(
  attachments: readonly SourceAttachmentRef[],
): readonly SourceAttachmentRef[] {
  return attachments.map((attachment) =>
    attachment.kind === 'canonical_spec'
      ? {
          ...attachment,
          sectionIds: attachment.sectionIds === undefined
            ? undefined
            : [...attachment.sectionIds],
        }
      : { ...attachment },
  );
}

const OUT_OF_GRAPH_PATCH_STATUSES = new Set([
  'approved_pending_apply',
  'apply_failed',
  'applied',
]);

/** Product-side Stop/apply settlement happens outside LangGraph. Those durable
 * transitions must dominate an older graph checkpoint after a process restart. */
function durableStateDominatesCheckpoint(
  durable: AgentState,
  checkpoint: AgentState,
): boolean {
  if (durable.lifecycle === 'cancelled' || durable.cancellation.requested) return true;
  if (
    durable.patchProposal !== undefined &&
    OUT_OF_GRAPH_PATCH_STATUSES.has(durable.patchProposal.status)
  ) {
    return true;
  }
  return durable.checkpointStep > checkpoint.checkpointStep;
}

/**
 * One active task runtime. It owns cancellation generations and LangGraph
 * invocation while exposing framework-neutral state/event subscriptions.
 */
export class AgentRuntime {
  private readonly stateListeners = new Set<AgentRuntimeListener>();
  private readonly eventListeners = new Set<AgentEventListener>();
  private active: ActiveExecution | null = null;

  constructor(
    private readonly provider: AgentProvider,
    private readonly adapters: AgentAdapters,
    private readonly persistence: AgentPersistence,
  ) {}

  getSnapshot(): AgentRuntimeSnapshot {
    return {
      state: this.active?.state ?? null,
      interrupt: this.active?.interrupt ?? null,
      busy: this.active?.busy ?? false,
    };
  }

  subscribe(listener: AgentRuntimeListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getSnapshot());
    return () => this.stateListeners.delete(listener);
  }

  subscribeEvents(listener: AgentEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async start(input: StartAgentTaskInput): Promise<AgentRunResult> {
    if (this.active !== null) {
      throw new Error('finish, restore, or start a fresh agent task first');
    }
    const identity: AgentRunIdentity = {
      taskId: input.taskId ?? this.adapters.ids.create('task'),
      threadId: input.threadId ?? this.adapters.ids.create('thread'),
      runId: input.runId ?? this.adapters.ids.create('run'),
      bookId: input.bookId,
    };
    const now = this.adapters.clock.now();
    const pendingSourceAttachments = cloneSourceAttachmentRefs(
      input.attachments ?? [],
    );
    let initial = createInitialAgentState({
      identity,
      goal: input.goal,
      desiredOutcome: input.desiredOutcome,
      creativeDirection: input.creativeDirection,
      defaultContextPolicy: input.defaultContextPolicy,
      preserveAllSourceInformation: input.preserveAllSourceInformation,
      budget: input.budget,
      now,
      userMessageId: this.adapters.ids.create('msg'),
    });
    initial = {
      ...initial,
      lifecycle: 'running',
      phase: 'reading_sources',
      insertionTarget: input.insertionTarget,
      // Persist byte-free ownership refs before ingestion starts. A failed or
      // interrupted extractor can then be retried after a full app restart.
      pendingSourceAttachments,
      ...(input.obfuscatePrivateText
        ? {
            textPrivacy: createAgentTextPrivacyReceipt({
              namespace: `${identity.taskId}-${identity.runId}`,
              now,
            }),
          }
        : {}),
    };

    const bus = new AgentEventBus(identity, this.persistence, () =>
      this.adapters.clock.now(),
    );
    bus.subscribe((event) => {
      if (this.active !== null && this.active.identity.runId !== event.runId) return;
      for (const listener of this.eventListeners) listener(event);
    });
    const abort = new AbortController();
    let resolveSetup!: () => void;
    const setupSettled = new Promise<void>((resolve) => { resolveSetup = resolve; });
    const execution = {
      currentSignal: (): AbortSignal => this.active?.abort.signal ?? abort.signal,
      isCurrentRun: (runId: string): boolean =>
        this.active?.identity.runId === runId && !this.active.abort.signal.aborted,
    };
    const graph = createAlcoveAgentGraph({
      provider: this.provider,
      adapters: this.adapters,
      persistence: this.persistence,
      events: bus,
      execution,
    });
    this.active = {
      identity,
      bus,
      graph,
      config: {
        configurable: { thread_id: identity.threadId },
        recursionLimit: Math.max(40, initial.budget.maxToolCalls * 3),
      },
      abort,
      state: initial,
      interrupt: null,
      busy: true,
      invocation: null,
      epoch: 0,
      setupSettled,
    };
    try {
      // Active is installed before this first await so Stop cannot miss a task
      // that is still hydrating its event sequence/source setup.
      await bus.hydrateSequence();
      if (abort.signal.aborted) {
        throw new DOMException('Agent task stopped during source preparation', 'AbortError');
      }
      await this.persistence.saveTask(initial);
      this.notify();
      await bus.emit({ type: 'run.started', goal: input.goal }, 'run:started');
      await bus.emit({
        type: 'status.changed',
        phase: 'reading_sources',
        summary: 'Preparing the selected notebook context and attachments',
      });
      const manifest = await this.adapters.ingestion.ingest(
        pendingSourceAttachments,
        {
          taskId: identity.taskId,
          signal: abort.signal,
          onProgress: (progress) => {
            void bus.emit({
              type: 'source.ingestion',
              phase: progress.phase,
              completed: progress.completed,
              total: progress.total,
              summary: progress.summary,
            });
          },
        },
      );
      if (this.active?.identity.runId !== identity.runId || abort.signal.aborted) {
        throw new DOMException('Agent task stopped during source preparation', 'AbortError');
      }
      initial = {
        ...this.active.state,
        phase: 'intake',
        pendingSourceAttachments: undefined,
        sourceManifest: manifest,
        sourceCoverage: createSourceCoverageLedger(
          manifest,
          input.preserveAllSourceInformation ? 'complete' : 'relevant',
          this.adapters.clock.now(),
        ),
        updatedAt: this.adapters.clock.now(),
      };
      this.active.state = initial;
      await this.persistence.saveTask(initial);
      await bus.emit({
        type: 'status.changed',
        phase: 'intake',
        summary: 'Understanding the notebook task',
      });
      this.notify();
    } catch (error) {
      if (isAbortError(error, abort.signal)) {
        const stopped = this.active;
        if (
          stopped?.identity.runId === identity.runId &&
          stopped.state.lifecycle === 'cancelled'
        ) {
          resolveSetup();
          return { state: stopped.state };
        }
        resolveSetup();
        throw error;
      }
      const active = this.active;
      if (active?.identity.runId === identity.runId) {
        active.busy = false;
        active.state = {
          ...active.state,
          lifecycle: 'failed',
          lastError: {
            code: 'tool_error',
            message: error instanceof Error ? error.message : 'Could not prepare the selected sources',
            retryable: true,
          },
          updatedAt: this.adapters.clock.now(),
        };
        await this.persistence.saveTask(active.state);
        this.notify();
      }
      resolveSetup();
      throw error;
    }
    const invocation = this.invoke({
      agent: initial,
      pendingInterrupt: null,
      pendingInterruptCall: null,
      resumeValue: null,
    });
    resolveSetup();
    return invocation;
  }

  async registerAttachments(
    attachments: readonly SourceAttachmentRef[],
  ): Promise<AgentRuntimeSnapshot> {
    const active = this.requireActive();
    if (active.busy || active.invocation !== null) {
      throw new Error('stop or wait for the current turn before attaching more sources');
    }
    if (attachments.length === 0) return this.getSnapshot();
    const pendingAttachments = cloneSourceAttachmentRefs(attachments);
    const registrationAbort = new AbortController();
    active.abort = registrationAbort;
    let settleRegistration!: () => void;
    active.setupSettled = new Promise<void>((resolve) => {
      settleRegistration = resolve;
    });
    active.bus.resume();
    active.busy = true;
    active.state = {
      ...active.state,
      phase: 'reading_sources',
      // This write is the ownership claim. It must precede ingestion's first
      // await so Stop/close/Delete and crash recovery all see the queued bytes.
      pendingSourceAttachments: pendingAttachments,
      updatedAt: this.adapters.clock.now(),
    };
    this.notify();

    try {
      await this.persistence.saveTask(active.state);
      if (
        this.active !== active ||
        active.abort !== registrationAbort ||
        registrationAbort.signal.aborted
      ) {
        throw new DOMException('Source registration was stopped', 'AbortError');
      }
      const manifest = await this.adapters.ingestion.ingest(pendingAttachments, {
        taskId: active.identity.taskId,
        signal: registrationAbort.signal,
        onProgress: (progress) => {
          void active.bus.emit({
            type: 'source.ingestion',
            phase: progress.phase,
            completed: progress.completed,
            total: progress.total,
            summary: progress.summary,
          });
        },
      });
      if (
        this.active !== active ||
        active.abort !== registrationAbort ||
        registrationAbort.signal.aborted
      ) {
        throw new DOMException('Source registration was stopped', 'AbortError');
      }
      const changed = manifest.digest !== active.state.sourceManifest?.digest;
      const staleLocalFinalGenerationIds =
        changed && active.interrupt?.kind !== 'final_preview'
          ? localFinalGenerationIdsOwnedByState(active.state)
          : [];
      // Destroy exact-text preview pixels before the durable checkpoint drops
      // their ownership. A failed later save leaves a recoverable stale
      // preview reference; the inverse ordering can orphan private pixels.
      for (const generationId of staleLocalFinalGenerationIds) {
        await this.adapters.sandbox.dispose(generationId);
      }
      const registeredState: AgentState = changed
        ? {
            ...active.state,
            phase: active.interrupt === null
              ? 'intake'
              : active.interrupt.kind === 'final_preview'
                ? 'waiting_for_preview_decision'
                : 'waiting_for_user',
            pendingSourceAttachments: undefined,
            sourceManifest: manifest,
            sourceCoverage: createSourceCoverageLedger(
              manifest,
              active.state.taskBrief.preserveAllSourceInformation ||
                active.state.retrievalPlan?.requiresCompleteCoverage === true
                ? 'complete'
                : 'relevant',
              this.adapters.clock.now(),
            ),
            retrievalPlan: undefined,
            // While a final-preview interrupt is pending, its resume handler
            // needs the old proposal id to accept feedback. It clears that
            // proposal before the next model turn; deterministic coverage blocks
            // any approval based on the newly expanded source set.
            patchProposal: active.interrupt?.kind === 'final_preview'
              ? active.state.patchProposal
              : undefined,
            localRestoredFinal: active.interrupt?.kind === 'final_preview'
              ? active.state.localRestoredFinal
              : undefined,
            checkpointStep: active.state.checkpointStep + 1,
            updatedAt: this.adapters.clock.now(),
          }
        : {
            ...active.state,
            phase: active.interrupt === null
              ? 'intake'
              : active.interrupt.kind === 'final_preview'
                ? 'waiting_for_preview_decision'
                : 'waiting_for_user',
            pendingSourceAttachments: undefined,
            checkpointStep: active.state.checkpointStep + 1,
            sourceManifest: manifest,
            updatedAt: this.adapters.clock.now(),
          };
      if (
        this.active !== active ||
        active.abort !== registrationAbort ||
        registrationAbort.signal.aborted
      ) {
        throw new DOMException('Source registration was stopped', 'AbortError');
      }
      // Replace only the agent state channel at the settled checkpoint. This
      // preserves a pending human interrupt and prevents restore from falling
      // back to a pre-registration manifest.
      if (active.interrupt !== null || active.epoch > 0) {
        await active.graph.updateState(active.config, { agent: registeredState });
      }
      if (
        this.active !== active ||
        active.abort !== registrationAbort ||
        registrationAbort.signal.aborted
      ) {
        throw new DOMException('Source registration was stopped', 'AbortError');
      }
      active.state = registeredState;
      await this.persistence.saveTask(registeredState);
      active.busy = false;
      this.notify();
      return this.getSnapshot();
    } catch (error) {
      if (!isAbortError(error, registrationAbort.signal)) {
        active.state = {
          ...active.state,
          lifecycle: 'failed',
          lastError: {
            code: 'tool_error',
            message: error instanceof Error ? error.message : 'Could not prepare the selected sources',
            retryable: true,
          },
          updatedAt: this.adapters.clock.now(),
        };
        await this.persistence.saveTask(active.state);
      }
      if (this.active === active) {
        active.busy = false;
        this.notify();
      }
      if (isAbortError(error, registrationAbort.signal)) return this.getSnapshot();
      throw error;
    } finally {
      settleRegistration();
      if (this.active === active && active.abort === registrationAbort) {
        active.busy = false;
        this.notify();
      }
    }
  }

  async requestSelectionRewrite(
    request: SelectionRewriteRequest,
  ): Promise<AgentRunResult> {
    if (request.to <= request.from) throw new Error('selection range is empty');
    const anchoredPage = await this.adapters.notebook.inspectPage(
      request.pageId,
      new AbortController().signal,
    );
    if (anchoredPage.documentDigest !== request.pageRevision) {
      throw new Error('the selected page changed before the AI task could start');
    }
    const selectionDigest = await computeNotebookSelectionDigest({
      pageId: request.pageId,
      from: request.from,
      to: request.to,
      documentDigest: request.pageRevision,
    }, this.adapters.hash);
    const goal = [
      request.prompt.trim(),
      request.selectedText === undefined
        ? ''
        : `\nThe anchored selected text is:\n${request.selectedText}`,
      `\nSelection anchor: page ${request.pageId}, revision ${request.pageRevision}, range ${request.from}-${request.to}.`,
    ]
      .filter(Boolean)
      .join('\n');
    return this.start({
      bookId: request.bookId,
      goal,
      desiredOutcome: 'Propose a before/after selection rewrite for final approval.',
      insertionTarget: {
        kind: 'replace_selection',
        pageId: request.pageId,
        from: request.from,
        to: request.to,
        selectionDigest,
      },
      obfuscatePrivateText: request.obfuscatePrivateText,
    });
  }

  async restore(taskId: string): Promise<AgentRuntimeSnapshot> {
    if (this.active?.busy) throw new Error('cannot restore while an agent task is running');
    const persisted = await this.persistence.loadTask(taskId);
    if (persisted === null) throw new Error(`agent task ${taskId} was not found`);
    let state = persisted.state;
    const bus = new AgentEventBus(state.identity, this.persistence, () =>
      this.adapters.clock.now(),
    );
    await bus.hydrateSequence();
    bus.subscribe((event) => {
      if (this.active !== null && this.active.identity.runId !== event.runId) return;
      for (const listener of this.eventListeners) listener(event);
    });
    const abort = new AbortController();
    const graph = createAlcoveAgentGraph({
      provider: this.provider,
      adapters: this.adapters,
      persistence: this.persistence,
      events: bus,
      execution: {
        currentSignal: () => this.active?.abort.signal ?? abort.signal,
        isCurrentRun: (runId) =>
          this.active?.identity.runId === runId && !this.active.abort.signal.aborted,
      },
    });
    const config = {
      configurable: { thread_id: state.identity.threadId },
      recursionLimit: Math.max(40, state.budget.maxToolCalls * 3),
    };
    const graphSnapshot = await graph.getState(config);
    const checkpointValues = graphSnapshot.values as {
      readonly agent?: AgentState;
      readonly pendingInterrupt?: AgentInterrupt | null;
    };
    const checkpointAgent = checkpointValues.agent;
    const restoredInterrupt =
      checkpointValues.pendingInterrupt ?? extractSnapshotInterrupt(graphSnapshot);
    const durableWins = checkpointAgent !== undefined &&
      durableStateDominatesCheckpoint(persisted.state, checkpointAgent);
    if (checkpointAgent !== undefined) {
      state = durableWins ? persisted.state : checkpointAgent;
      if (!durableWins && restoredInterrupt !== null) {
        state = {
          ...state,
          lifecycle:
            restoredInterrupt.kind === 'final_preview'
              ? 'waiting_for_preview_decision'
              : 'waiting_for_user',
          phase:
            restoredInterrupt.kind === 'final_preview'
              ? 'waiting_for_preview_decision'
              : 'waiting_for_user',
        };
      }
    }
    // Receipts carry the only reversible mapping from provider-safe tokens to
    // local text. A corrupt/tampered checkpoint must never be guessed through
    // or allowed to reach the provider boundary.
    assertAgentTextPrivacyReceipt(state.textPrivacy);
    const durableSettled = state.lifecycle === 'cancelled' ||
      state.patchProposal?.status === 'applied';
    const effectiveInterrupt = durableSettled ? null : restoredInterrupt;
    if (effectiveInterrupt === null && durableSettled) {
      state = {
        ...state,
        phase: state.lifecycle === 'completed' ? 'finished' : state.phase,
      };
    }
    // Repair the state channel immediately so a second restart cannot repeat
    // the stale checkpoint overlay. Interrupt fields are retained for
    // pending-apply/apply-failed retries but cleared for Stop/applied states.
    if (
      durableWins
    ) {
      await graph.updateState(config, {
        agent: state,
        ...(durableSettled
          ? { pendingInterrupt: null, pendingInterruptCall: null, resumeValue: null }
          : {}),
      });
    }
    this.active = {
      identity: state.identity,
      bus,
      graph,
      config,
      abort,
      state,
      interrupt: effectiveInterrupt,
      busy: false,
      invocation: null,
      epoch: 0,
      setupSettled: Promise.resolve(),
    };
    this.notify();
    return this.getSnapshot();
  }

  async resume(value: AgentResumeValue): Promise<AgentRunResult> {
    const active = this.requireActive();
    if (active.invocation !== null) {
      throw new Error('wait for the previous agent invocation to settle');
    }
    if (active.interrupt === null) throw new Error('agent is not waiting for input');
    if (active.bus === undefined) throw new Error('agent event bus is unavailable');
    active.abort = new AbortController();
    active.bus.resume();
    active.busy = true;
    active.interrupt = null;
    this.notify();
    await active.graph.updateState(active.config, { resumeValue: value });
    return this.invoke(null);
  }

  async sendUserMessage(
    text: string,
    options: {
      readonly preserveAllSourceInformation?: boolean;
      readonly obfuscatePrivateText?: boolean;
    } = {},
  ): Promise<AgentRunResult> {
    const active = this.requireActive();
    if (active.invocation !== null) {
      throw new Error('wait for the previous agent invocation to settle');
    }
    const trimmed = text.trim();
    if (trimmed === '') throw new Error('message is empty');
    if (
      active.state.lifecycle === 'cancelled' ||
      active.state.cancellation.requested ||
      active.state.pendingSourceAttachments !== undefined ||
      (active.state.pendingUserTurns?.length ?? 0) > 0
    ) {
      // Stop deliberately leaves an aborted controller and a cancellation
      // tombstone in the durable checkpoint. A plain new turn would therefore
      // be cancelled by policy before it reached the provider. Route through
      // the real retry path, but queue the reader's exact text first so it is
      // neither lost nor inserted between an assistant tool call and its
      // mandatory tool result.
      return this.retry({
        followUpMessage: trimmed,
        preserveAllSourceInformation: options.preserveAllSourceInformation,
      });
    }
    if (
      options.preserveAllSourceInformation === true &&
      !active.state.taskBrief.preserveAllSourceInformation
    ) {
      const now = this.adapters.clock.now();
      active.state = {
        ...active.state,
        taskBrief: {
          ...active.state.taskBrief,
          preserveAllSourceInformation: true,
        },
        // Upgrading is monotonic and fail-closed. Rebuild the ledger in
        // complete mode so prior selective reads cannot masquerade as an
        // exhaustive sweep; the model may re-read them in bounded batches.
        sourceCoverage: active.state.sourceManifest === undefined
          ? active.state.sourceCoverage
          : createSourceCoverageLedger(
              active.state.sourceManifest,
              'complete',
              now,
            ),
        retrievalPlan: undefined,
        updatedAt: now,
      };
      await active.graph.updateState(active.config, { agent: active.state });
      await this.persistence.saveTask(active.state);
    }
    if (active.interrupt?.kind === 'requirements') {
      return this.resume({
        kind: 'requirements_answer',
        answers: { response: trimmed },
        useSensibleDefaults: false,
      });
    }
    if (active.interrupt?.kind === 'blocker') {
      return this.resume({ kind: 'blocker_answer', response: trimmed });
    }
    if (active.interrupt?.kind === 'final_preview') {
      return this.resume({
        kind: 'preview_decision',
        decision: 'feedback',
        feedback: trimmed,
        previewId: active.interrupt.preview.previewId,
      });
    }
    if (active.busy) throw new Error('wait for the current agent turn or stop it first');

    for (const generationId of localFinalGenerationIdsOwnedByState(active.state)) {
      await this.adapters.sandbox.dispose(generationId);
    }
    const now = this.adapters.clock.now();
    const message = {
      id: this.adapters.ids.create('msg'),
      role: 'user' as const,
      text: trimmed,
      createdAt: now,
    };
    const queuedUserTurns = active.state.pendingUserTurns ?? [];
    const userTurn = {
      id: message.id,
      role: 'user' as const,
      content: trimmed,
      createdAt: now,
    };
    const state: AgentState = {
      ...active.state,
      lifecycle: 'running',
      phase: 'intake',
      conversation: [...active.state.conversation, message],
      modelHistory: queuedUserTurns.length === 0
        ? [...active.state.modelHistory, userTurn]
        : active.state.modelHistory,
      ...(queuedUserTurns.length === 0
        ? {}
        : { pendingUserTurns: [...queuedUserTurns, userTurn] }),
      pendingToolCalls: [],
      patchProposal: undefined,
      localRestoredFinal: undefined,
      updatedAt: now,
    };
    active.state = state;
    active.abort = new AbortController();
    active.bus.resume();
    active.busy = true;
    await active.bus.emit({ type: 'user.message', message });
    await this.persistence.saveTask(state);
    this.notify();
    return this.invoke({
      agent: state,
      pendingInterrupt: null,
      pendingInterruptCall: null,
      resumeValue: null,
    });
  }

  async useSensibleDefaults(): Promise<AgentRunResult> {
    const active = this.requireActive();
    if (active.interrupt?.kind !== 'requirements') {
      throw new Error('the agent is not waiting for requirements');
    }
    return this.resume({
      kind: 'requirements_answer',
      answers: {},
      useSensibleDefaults: true,
    });
  }

  async approvePreview(previewId: string): Promise<AgentRunResult> {
    const active = this.requireActive();
    const proposal = active.state.patchProposal;
    if (
      proposal?.preview.previewId === previewId &&
      ['approved_pending_apply', 'apply_failed', 'approved'].includes(proposal.status)
    ) {
      const decisionMessage = {
        id: this.adapters.ids.create('msg'),
        role: 'user' as const,
        text: 'Insert these reviewed pages into my notebook.',
        createdAt: this.adapters.clock.now(),
      };
      await active.bus.emit({ type: 'user.message', message: decisionMessage });
      active.state = {
        ...active.state,
        conversation: [...active.state.conversation, decisionMessage],
        lifecycle: 'waiting_for_preview_decision',
        phase: 'waiting_for_preview_decision',
        patchProposal: { ...proposal, status: 'approved_pending_apply' },
        lastError: undefined,
        checkpointStep: active.state.checkpointStep + 1,
        updatedAt: this.adapters.clock.now(),
      };
      await this.persistence.saveTask(active.state);
      this.notify();
      return { state: active.state };
    }
    return this.resumePreviewDecision(previewId, 'approve');
  }

  /** Complete or reopen the durable approval only after BookView settles. */
  async finalizeApprovedPatch(
    patchId: string,
    outcome: { readonly applied: boolean; readonly message?: string },
  ): Promise<AgentRunResult> {
    const active = this.requireActive();
    const proposal = active.state.patchProposal;
    if (proposal === undefined || proposal.patchId !== patchId) {
      throw new Error('the approved patch is no longer the active proposal');
    }
    if (
      !['approved_pending_apply', 'apply_failed', 'approved', 'applied'].includes(
        proposal.status,
      )
    ) {
      throw new Error('the proposal has not been approved for application');
    }
    if (outcome.applied && proposal.status === 'applied') {
      return { state: active.state };
    }
    const now = this.adapters.clock.now();
    const appliedMessage = outcome.applied
      ? {
          id: this.adapters.ids.create('msg'),
          role: 'assistant' as const,
          text: `The ${proposal.preview.expectedPageCount === 1 ? 'reviewed page is' : `${proposal.preview.expectedPageCount} reviewed pages are`} now in your notebook. Ctrl+Z can undo this insertion.`,
          createdAt: now,
        }
      : undefined;
    active.interrupt = null;
    active.state = outcome.applied
      ? {
          ...active.state,
          conversation: appliedMessage === undefined
            ? active.state.conversation
            : [...active.state.conversation, appliedMessage],
          lifecycle: 'completed',
          phase: 'finished',
          patchProposal: { ...proposal, status: 'applied' },
          lastError: undefined,
          checkpointStep: active.state.checkpointStep + 1,
          updatedAt: now,
        }
      : {
          ...active.state,
          lifecycle: 'waiting_for_preview_decision',
          phase: 'waiting_for_preview_decision',
          patchProposal: { ...proposal, status: 'apply_failed' },
          lastError: {
            code: 'stale_context',
            message:
              outcome.message ??
              'The notebook could not accept the reviewed pages. The final preview was kept so you can retry safely.',
            retryable: true,
          },
          checkpointStep: active.state.checkpointStep + 1,
          updatedAt: now,
        };
    await this.persistence.saveTask(active.state);
    if (outcome.applied) {
      await active.bus.emit({
        type: 'run.completed',
        summary: 'The exact reviewed pages were inserted successfully.',
        patchId: proposal.patchId,
      });
    }
    this.notify();
    return { state: active.state };
  }

  rejectPreview(previewId: string, feedback?: string): Promise<AgentRunResult> {
    return this.resumePreviewDecision(previewId, 'reject', feedback);
  }

  revisePreview(previewId: string, feedback: string): Promise<AgentRunResult> {
    return this.resumePreviewDecision(previewId, 'feedback', feedback);
  }

  changePlacement(
    previewId: string,
    insertionTarget: NotebookInsertionTarget,
  ): Promise<AgentRunResult> {
    const locked = this.requireActive().state.insertionTarget;
    if (
      locked?.kind === 'replace_selection' &&
      JSON.stringify(locked) !== JSON.stringify(insertionTarget)
    ) {
      throw new Error('A selected-text task stays anchored to that exact selection');
    }
    return this.resumePreviewDecision(
      previewId,
      'change_location',
      undefined,
      insertionTarget,
    );
  }

  async stop(reason = 'Stopped by the reader'): Promise<void> {
    const active = this.active;
    if (active === null) return;
    active.abort.abort(new DOMException(reason, 'AbortError'));
    const now = this.adapters.clock.now();
    active.state = {
      ...active.state,
      lifecycle: 'cancelled',
      cancellation: {
        ...active.state.cancellation,
        requested: true,
        requestedAt: now,
        reason,
      },
      lastError: { code: 'cancelled', message: reason, retryable: true },
      updatedAt: now,
    };
    // Keep the runtime non-resumable until both source setup and the captured
    // graph invocation have settled and the final cancelled state is durable.
    active.busy = true;
    active.interrupt = null;
    let stopError: unknown;
    try {
      try {
        // Start the one public cancellation event synchronously, then suppress
        // the bus before awaiting persistence so an uncooperative provider
        // cannot slip a late assistant/tool event through that await window.
        const cancellationEvent = active.bus.emit(
          { type: 'run.cancelled', reason },
          'run:cancelled',
        );
        active.bus.suppress();
        await cancellationEvent;
      } catch (error) {
        stopError = error;
      }
      try {
        await this.persistence.saveTask(active.state);
      } catch (error) {
        stopError ??= error;
      }
      this.notify();
      // Stop is a settlement barrier: after it resolves, no provider/tool from
      // this epoch can still persist or mutate runtime state.
      await active.setupSettled;
      const settling = active.invocation;
      if (settling !== null) await settling.catch(() => undefined);
      // A provider may ignore AbortSignal. Persist cancellation again only
      // after its invocation has settled so Stop's resolution is the final
      // durable write barrier, not merely an abort request.
      try {
        await this.persistence.saveTask(active.state);
      } catch (error) {
        stopError ??= error;
      }
    } finally {
      if (this.active === active) {
        active.busy = false;
        this.notify();
      }
    }
    if (stopError !== undefined) throw stopError;
  }

  async retry(options: RetryContinuationOptions = {}): Promise<AgentRunResult> {
    const active = this.requireActive();
    if (active.busy || active.invocation !== null) {
      throw new Error('wait for the previous agent invocation to settle');
    }
    if (options.followUpMessage !== undefined) {
      for (const generationId of localFinalGenerationIdsOwnedByState(active.state)) {
        await this.adapters.sandbox.dispose(generationId);
      }
    }
    active.abort = new AbortController();
    const retryAbort = active.abort;
    let settleRetrySetup!: () => void;
    active.setupSettled = new Promise<void>((resolve) => {
      settleRetrySetup = resolve;
    });
    active.bus.resume();
    active.interrupt = null;
    active.busy = true;
    const now = this.adapters.clock.now();
    const followUpMessage = options.followUpMessage === undefined
      ? undefined
      : {
          id: this.adapters.ids.create('msg'),
          role: 'user' as const,
          text: options.followUpMessage,
          createdAt: now,
        };
    const queuedUserTurns = followUpMessage === undefined
      ? active.state.pendingUserTurns
      : [
          ...(active.state.pendingUserTurns ?? []),
          {
            id: followUpMessage.id,
            role: 'user' as const,
            content: followUpMessage.text,
            createdAt: followUpMessage.createdAt,
          },
        ];
    const preserveAllSourceInformation =
      options.preserveAllSourceInformation === true ||
      active.state.taskBrief.preserveAllSourceInformation;
    active.state = {
      ...active.state,
      lifecycle: 'running',
      ...(followUpMessage === undefined
        ? {}
        : {
            phase: 'intake' as const,
            conversation: [...active.state.conversation, followUpMessage],
            patchProposal: undefined,
            localRestoredFinal: undefined,
          }),
      ...(queuedUserTurns === undefined
        ? {}
        : { pendingUserTurns: queuedUserTurns }),
      taskBrief: preserveAllSourceInformation === active.state.taskBrief.preserveAllSourceInformation
        ? active.state.taskBrief
        : {
            ...active.state.taskBrief,
            preserveAllSourceInformation: true,
          },
      sourceCoverage:
        preserveAllSourceInformation &&
        !active.state.taskBrief.preserveAllSourceInformation &&
        active.state.sourceManifest !== undefined
          ? createSourceCoverageLedger(active.state.sourceManifest, 'complete', now)
          : active.state.sourceCoverage,
      retrievalPlan:
        preserveAllSourceInformation && !active.state.taskBrief.preserveAllSourceInformation
          ? undefined
          : active.state.retrievalPlan,
      cancellation: {
        requested: false,
        lastSafeCheckpointStep: active.state.cancellation.lastSafeCheckpointStep,
      },
      lastError: undefined,
      checkpointStep: active.state.checkpointStep + 1,
      updatedAt: now,
    };
    try {
      await this.persistence.saveTask(active.state);
      if (followUpMessage !== undefined) {
        await active.bus.emit({ type: 'user.message', message: followUpMessage });
      }
      this.notify();

      const pendingAttachments = active.state.pendingSourceAttachments;
      if (pendingAttachments !== undefined) {
        active.state = {
          ...active.state,
          phase: 'reading_sources',
          updatedAt: this.adapters.clock.now(),
        };
        await this.persistence.saveTask(active.state);
        await active.bus.emit({
          type: 'status.changed',
          phase: 'reading_sources',
          summary: 'Retrying source preparation from the durable attachment list',
        });
        const manifest = await this.adapters.ingestion.ingest(
          cloneSourceAttachmentRefs(pendingAttachments),
          {
            taskId: active.identity.taskId,
            signal: retryAbort.signal,
            onProgress: (progress) => {
              void active.bus.emit({
                type: 'source.ingestion',
                phase: progress.phase,
                completed: progress.completed,
                total: progress.total,
                summary: progress.summary,
              });
            },
          },
        );
        if (
          this.active !== active ||
          active.abort !== retryAbort ||
          retryAbort.signal.aborted
        ) {
          throw new DOMException('Agent retry stopped during source preparation', 'AbortError');
        }
        const now = this.adapters.clock.now();
        active.state = {
          ...active.state,
          phase: 'intake',
          pendingSourceAttachments: undefined,
          sourceManifest: manifest,
          sourceCoverage: createSourceCoverageLedger(
            manifest,
            active.state.taskBrief.preserveAllSourceInformation ? 'complete' : 'relevant',
            now,
          ),
          retrievalPlan: undefined,
          checkpointStep: active.state.checkpointStep + 1,
          updatedAt: now,
        };
        await this.persistence.saveTask(active.state);
        await active.bus.emit({
          type: 'status.changed',
          phase: 'intake',
          summary: 'Source preparation recovered; understanding the notebook task',
        });
        this.notify();
      }

      const assertRetryCurrent = (): void => {
        if (
          this.active !== active ||
          active.abort !== retryAbort ||
          retryAbort.signal.aborted
        ) {
          throw new DOMException('Agent retry was stopped', 'AbortError');
        }
      };
      assertRetryCurrent();

      const graphSnapshot = await active.graph.getState(active.config);
      assertRetryCurrent();
      const hasCheckpoint = (
        graphSnapshot.values as { readonly agent?: AgentState }
      ).agent !== undefined;
      const runnableGraphState = {
        agent: active.state,
        pendingInterrupt: null,
        pendingInterruptCall: null,
        resumeValue: null,
      };
      if (hasCheckpoint) {
        // Stop is settled in product storage outside LangGraph. A restored
        // terminal checkpoint therefore still contains cancellation unless we
        // durably replace its state channel before asking the pending node to
        // continue. Preserve its next-node position (including a safe pending
        // tool call), but make the state runnable again.
        await active.graph.updateState(active.config, runnableGraphState);
        assertRetryCurrent();
        const invocation = this.invoke(null);
        settleRetrySetup();
        return invocation;
      }

      // An immediate Stop can win before LangGraph writes its first START
      // checkpoint. There is nothing to resume in that case, so seed the
      // complete durable state as a fresh graph input and enter the model.
      const invocation = this.invoke(runnableGraphState);
      settleRetrySetup();
      return invocation;
    } catch (error) {
      if (isAbortError(error, retryAbort.signal)) {
        settleRetrySetup();
        return { state: active.state };
      }
      try {
        active.state = {
          ...active.state,
          lifecycle: 'failed',
          lastError: {
            code: 'tool_error',
            message: error instanceof Error ? error.message : 'Could not prepare the selected sources',
            retryable: true,
          },
          updatedAt: this.adapters.clock.now(),
        };
        await this.persistence.saveTask(active.state);
        active.busy = false;
        this.notify();
        return { state: active.state };
      } finally {
        settleRetrySetup();
      }
    }
  }

  async clearActiveTask(): Promise<void> {
    if (this.active?.busy || this.active?.invocation !== null) {
      throw new Error('wait for the current agent turn or stop it before starting a new task');
    }
    // This is intentionally not deleteTask(): the task, public activity and
    // LangGraph checkpoint remain available from the per-book task drawer.
    this.active = null;
    this.notify();
  }

  async deleteTask(taskId?: string): Promise<void> {
    const target = taskId ?? this.active?.identity.taskId;
    if (target === undefined) return;
    const activeTarget = this.active?.identity.taskId === target ? this.active : null;
    const persistedTarget = activeTarget === null
      ? await this.persistence.loadTask(target)
      : null;
    const generationIds = generationIdsOwnedByState(
      activeTarget?.state ?? persistedTarget?.state,
    );
    let deletionError: unknown;
    const captureDeletionError = (error: unknown): void => {
      deletionError ??= error;
    };
    if (this.active?.identity.taskId === target) {
      const deleting = this.active;
      deleting.abort.abort(new DOMException('Task deleted', 'AbortError'));
      // The tombstone is visible to every late graph/event write before Stop
      // waits for settlement, so INSERT OR REPLACE cannot resurrect the task.
      try {
        await (this.persistence.tombstoneTask?.(
          target,
          deleting.identity.threadId,
        ) ?? Promise.resolve());
      } catch (error) {
        captureDeletionError(error);
      }
      try {
        await this.stop('Task deleted');
      } catch (error) {
        captureDeletionError(error);
      }
      // Clear any checkpointer implementation that ignored the first
      // tombstone while its invocation was unwinding. This second sweep runs
      // after Stop's settlement barrier, so nothing can write behind it.
      try {
        await (this.persistence.tombstoneTask?.(
          target,
          deleting.identity.threadId,
        ) ?? Promise.resolve());
      } catch (error) {
        captureDeletionError(error);
      }
      if (this.active === deleting) this.active = null;
    }
    for (const generationId of generationIds) {
      await this.adapters.sandbox.dispose(generationId).catch(() => undefined);
    }
    try {
      await Promise.all([
        this.persistence.deleteTask(target),
        this.adapters.sources.forgetTaskSources?.(target) ?? Promise.resolve(),
      ]);
    } catch (error) {
      captureDeletionError(error);
    }
    this.notify();
    if (deletionError !== undefined) throw deletionError;
  }

  private async resumePreviewDecision(
    previewId: string,
    decision: 'approve' | 'reject' | 'feedback' | 'change_location',
    feedback?: string,
    insertionTarget?: NotebookInsertionTarget,
  ): Promise<AgentRunResult> {
    const active = this.requireActive();
    if (
      active.interrupt?.kind !== 'final_preview' ||
      active.interrupt.preview.previewId !== previewId
    ) {
      throw new Error('final preview is stale or the agent is not waiting for it');
    }
    return this.resume({
      kind: 'preview_decision',
      decision,
      feedback,
      insertionTarget,
      previewId,
    });
  }

  private async invoke(input: unknown): Promise<AgentRunResult> {
    const active = this.requireActive();
    if (active.invocation !== null) {
      throw new Error('an agent invocation is already settling');
    }
    const abort = active.abort;
    const epoch = active.epoch + 1;
    active.epoch = epoch;
    const isCurrent = (): boolean =>
      this.active === active && active.epoch === epoch && active.abort === abort;
    let invocation: Promise<AgentRunResult>;
    invocation = (async (): Promise<AgentRunResult> => {
      try {
        const result = await active.graph.invoke(input as never, {
          ...active.config,
          signal: abort.signal,
        });
        if (!isCurrent() || abort.signal.aborted) {
          return { state: active.state };
        }
        const graphResult = result as unknown as { readonly agent?: AgentState };
        const interrupt = extractInterrupt(result);
        if (!isCurrent()) return { state: active.state };
        if (graphResult.agent !== undefined) active.state = graphResult.agent;
        active.interrupt = interrupt;
        active.busy = false;
        if (interrupt !== null) {
          active.state = {
            ...active.state,
            lifecycle:
              interrupt.kind === 'final_preview'
                ? 'waiting_for_preview_decision'
                : 'waiting_for_user',
            phase:
              interrupt.kind === 'final_preview'
                ? 'waiting_for_preview_decision'
                : 'waiting_for_user',
            updatedAt: this.adapters.clock.now(),
          };
        } else if (active.state.lifecycle === 'completed') {
          await active.bus.emit({
            type: 'run.completed',
            summary:
              active.state.patchProposal?.status === 'approved'
                ? 'Final preview approved; patch is ready for the separate apply service.'
                : 'Agent task completed without a notebook mutation.',
            patchId: active.state.patchProposal?.patchId,
          });
        }
        if (!isCurrent()) return { state: active.state };
        await this.persistence.saveTask(active.state);
        if (!isCurrent()) return { state: active.state };
        this.notify();
        return { state: active.state, interrupt: interrupt ?? undefined };
      } catch (error) {
        if (isAbortError(error, abort.signal)) {
          return { state: active.state };
        }
        if (!isCurrent()) return { state: active.state };
        active.busy = false;
        active.state = {
          ...active.state,
          lifecycle: 'failed',
          lastError:
            active.state.lastError ?? {
              code: 'internal',
              message: error instanceof Error ? error.message : 'The agent stopped unexpectedly.',
              retryable: false,
            },
          updatedAt: this.adapters.clock.now(),
        };
        if (!isCurrent()) return { state: active.state };
        await this.persistence.saveTask(active.state);
        this.notify();
        return { state: active.state };
      } finally {
        if (active.epoch === epoch) {
          active.invocation = null;
        }
      }
    })();
    active.invocation = invocation;
    return invocation;
  }

  private requireActive(): ActiveExecution {
    if (this.active === null) throw new Error('no active agent task');
    return this.active;
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.stateListeners) listener(snapshot);
  }
}

export type { AgentActivityEvent };
