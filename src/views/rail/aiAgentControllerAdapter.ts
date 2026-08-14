/**
 * Framework seam between the Solid-free agent runtime and AiAgentPanel.
 *
 * `features/aiAgent/controller.ts` is the durable workflow authority.  The
 * panel intentionally speaks a display-oriented contract (render URLs, named
 * placement choices, source chips, chronological cards).  This adapter is the
 * only translation root has to instantiate.  Provider keys and attachment
 * bytes are still handled by callbacks owned outside the UI lane.
 */
import {
  createSignal,
  getOwner,
  onCleanup,
  type Accessor,
} from 'solid-js';
import type {
  AgentActivityEvent,
  AgentContextPolicy,
  AgentImageRef,
  AgentInterrupt,
  AgentPhase,
  AgentRuntimeSnapshot,
  AiAgentController as CoreAiAgentController,
  NotebookInsertionTarget,
  NotebookPatchProposal,
  SourceAttachmentRef,
  SourceCitation,
  UserPreviewContract,
} from '../../features/aiAgent';
import type {
  AiAgentAttachmentView,
  AiAgentConnectionView,
  AiAgentContextView,
  AiAgentController,
  AiAgentDraftPreviewView,
  AiAgentPlacementView,
  AiAgentThreadView,
  AiAgentTimelineItem,
  AiAgentViewState,
  AiAgentKeySubmission,
} from './AiAgentPanel';
import { previewLayoutView } from './aiAgentPreviewGate';

export interface AiAgentPlacementOption extends AiAgentPlacementView {
  readonly target: NotebookInsertionTarget;
}

export interface AiAgentPanelAdapterOptions {
  readonly bookId: string;
  readonly bookTitle?: string;
  readonly connection: Accessor<AiAgentConnectionView>;
  readonly attachments?: Accessor<readonly AiAgentAttachmentView[]>;
  /** Core attachment references queued before the first task starts. */
  readonly sourceAttachments?: Accessor<readonly SourceAttachmentRef[]>;
  readonly context?: Accessor<readonly AiAgentContextView[]>;
  readonly threads?: Accessor<readonly AiAgentThreadView[]>;
  readonly activeThreadTitle?: Accessor<string | undefined>;
  readonly placements: Accessor<readonly AiAgentPlacementOption[]>;
  readonly defaultContextPolicy?: Accessor<AgentContextPolicy>;
  readonly preserveAllSourceInformation?: Accessor<boolean>;
  readonly obfuscatePrivateText?: Accessor<boolean>;
  readonly insertionTarget?: Accessor<NotebookInsertionTarget | undefined>;

  /** Resolve an opaque native render resource without copying bytes to state. */
  readonly renderUrlFor: (image: AgentImageRef) => string;
  readonly configureKey?: (input: AiAgentKeySubmission) => void | Promise<void>;
  readonly skipKeySetup?: () => void | Promise<void>;
  readonly openIntegrationSettings?: () => void;
  readonly attachFiles?: (files: readonly File[]) => void | Promise<void>;
  readonly removeAttachment?: (attachmentId: string) => void;
  readonly toggleContext?: (contextId: string, selected: boolean) => void;
  readonly openCitation?: (citationId: string) => void;
  readonly onApprovedProposal: (proposal: NotebookPatchProposal) => void | Promise<void>;
  readonly onStartNewTask?: () => void | Promise<void>;
  readonly onSelectThread?: (threadId: string) => void | Promise<void>;
  readonly onRenameThread?: (threadId: string, title: string) => void | Promise<void>;
  readonly onDeleteThread?: (threadId: string) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export interface AiAgentPanelControllerHandle extends AiAgentController {
  /** Unsubscribe when the book session unmounts. */
  dispose(): void;
}

const DEFAULT_CONTEXT: readonly AiAgentContextView[] = [
  { id: 'current-page', label: 'Current page', selected: true },
  { id: 'nearby-pages', label: 'Nearby pages', selected: false },
  { id: 'whole-book', label: 'Whole book', selected: false },
];

/**
 * Lossless-source requests are a product guarantee, not a suggestion for the
 * model.  Readers naturally put a few words between the negation and the
 * action ("I don't want to lose …"), or use a gerund ("without losing …"), so
 * this intentionally recognizes meaning rather than one exact prompt phrase.
 */
export const asksForCompleteSourcePreservation = (text: string): boolean => {
  const normalized = text
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return [
    // “I don't want to lose any information” / “this must not leave out facts”.
    /\b(?:do not|don't|does not|doesn't|must not|should not|cannot|can't|never)\b(?:\s+[\w'-]+){0,5}\s+\b(?:lose|omit|skip|drop|exclude|discard|leave out)\b/i,
    /\b(?:do not|don't|does not|doesn't|must not|should not|cannot|can't|never)\b(?:\s+[\w'-]+){0,5}\s+\bleave\b(?:\s+[\w'-]+){0,3}\s+\bout\b/i,
    // “without losing anything” / “without omitting a single detail”.
    /\bwithout\s+(?:losing|omitting|skipping|dropping|excluding|discarding|leaving out)\b/i,
    // Positive, explicit completeness requests.
    /\b(?:preserve|retain|include|read|cover|capture)\s+(?:absolutely\s+)?(?:all|every)\s+(?:the\s+)?(?:information|info|facts?|details?|content|pages?|sources?|pieces? of information)\b/i,
    /\b(?:preserve|retain|include|read|cover|capture|keep)\s+(?:absolutely\s+)?(?:everything|every\s+single\s+(?:fact|detail|page|piece of information))\b/i,
    /\b(?:every|all)\s+(?:the\s+)?(?:information|info|facts?|details?|content|pages?|sources?|pieces? of information)\b/i,
    /\bcomplete(?:ly)?\s+(?:preserve|retain|read|cover|capture)\b/i,
    /\b(?:no|not a single)\s+(?:piece of\s+)?(?:information|info|fact|detail|page)\b(?:\s+[\w'-]+){0,4}\s+\b(?:lost|omitted|skipped|dropped|excluded|discarded)\b/i,
    /\b(?:make sure|ensure)\b(?:\s+[\w'-]+){0,4}\s+\bnothing\b(?:\s+[\w'-]+){0,4}\s+\b(?:lost|omitted|skipped|dropped|excluded|discarded|left out)\b/i,
    /\b(?:need|want|use|include|preserve|retain|keep)\s+all\s+of\s+(?:it|this|that)\b/i,
    /\b(?:lossless|verbatim|exhaustive|full[- ]coverage)\b/i,
  ].some((pattern) => pattern.test(normalized));
};

const phaseHeadline = (phase: AgentPhase | undefined): string | undefined => {
  switch (phase) {
    case 'intake': return 'Understanding your task';
    case 'reading_sources': return 'Reading the selected sources';
    case 'planning': return 'Planning the notebook';
    case 'drafting': return 'Building Notebook Script';
    case 'checking_script': return 'Checking syntax and page flow';
    case 'rendering_preview': return 'Rendering native Alcove pages';
    case 'reviewing_preview': return 'Inspecting every rendered page';
    case 'repairing': return 'Repairing what the review found';
    case 'building_preview': return 'Preparing the final preview';
    case 'waiting_for_user': return 'Waiting for one detail from you';
    case 'waiting_for_preview_decision': return 'The reviewed draft is ready';
    case 'finished': return 'The task is complete';
    default: return undefined;
  }
};

const phaseWorkingNote = (phase: AgentPhase | undefined): string => {
  switch (phase) {
    case 'intake': return 'Gathering your thoughts…';
    case 'reading_sources': return 'Reading with a pencil in hand…';
    case 'planning': return 'Sketching a gentle plan…';
    case 'drafting': return 'Imagining the pages…';
    case 'checking_script': return 'Checking the little details…';
    case 'rendering_preview': return 'Turning the ideas into pages…';
    case 'reviewing_preview': return 'Looking with a careful eye…';
    case 'repairing': return 'Tidying the rough edges…';
    case 'building_preview': return 'Tying the ribbon on the preview…';
    default: return 'Thinking it through…';
  }
};

const phaseProgress = (phase: AgentPhase | undefined): number | undefined => {
  switch (phase) {
    case 'intake': return 0.08;
    case 'reading_sources': return 0.2;
    case 'planning': return 0.34;
    case 'drafting': return 0.5;
    case 'checking_script': return 0.63;
    case 'rendering_preview': return 0.72;
    case 'reviewing_preview': return 0.8;
    case 'repairing': return 0.68;
    case 'building_preview': return 0.92;
    case 'waiting_for_preview_decision': return 1;
    case 'finished': return 1;
    default: return undefined;
  }
};

const stageOf = (snapshot: AgentRuntimeSnapshot): AiAgentViewState['stage'] => {
  const state = snapshot.state;
  if (state === null) return 'idle';
  if (snapshot.interrupt?.kind === 'final_preview') return 'ready';
  if (state.patchProposal?.status === 'apply_failed') return 'conflict';
  if (
    state.patchProposal?.status === 'approved_pending_apply' ||
    state.patchProposal?.status === 'approved'
  ) return 'ready';
  if (snapshot.interrupt !== null) return 'waiting';
  if (state.lastError?.code === 'stale_context') return 'conflict';
  if (state.lifecycle === 'cancelled') return 'cancelled';
  if (state.lifecycle === 'failed') return 'error';
  if (state.lifecycle === 'completed') return 'complete';
  if (state.phase === 'reviewing_preview' || state.phase === 'rendering_preview' || state.phase === 'repairing' || state.phase === 'building_preview') return 'reviewing';
  if (state.lifecycle === 'running') return state.phase === 'intake' ? 'intake' : 'working';
  return 'idle';
};

const citationView = (citation: SourceCitation) => ({
  id: `${citation.sourceId}:${citation.unitId}`,
  source: citation.sourceTitle,
  locator: citation.pageNumber === undefined
    ? citation.label
    : `page ${citation.pageNumber}${citation.figure ? ` · ${citation.figure}` : ''}`,
  excerpt: citation.excerpt,
});

const targetKey = (target: NotebookInsertionTarget | undefined): string =>
  target === undefined ? '' : JSON.stringify(target);

function visualReviewStatus(preview: UserPreviewContract): AiAgentDraftPreviewView['review']['status'] {
  if (preview.visualReview.passed) return 'passed';
  if (!preview.visualReview.complete) return 'inspecting';
  return 'blocked';
}

function previewView(
  preview: UserPreviewContract,
  snapshot: AgentRuntimeSnapshot,
  options: AiAgentPanelAdapterOptions,
): AiAgentDraftPreviewView {
  const state = snapshot.state;
  const placements = options.placements();
  const selectedTarget = targetKey(preview.insertionTarget);
  const selected = placements.find((option) => targetKey(option.target) === selectedTarget);
  const targetConflict = selected === undefined
    ? {
        title: 'This placement is no longer available',
        detail: 'Choose a valid location in this notebook and ask the agent to refresh the preview.',
      }
    : undefined;
  const diagnostics = preview.validation.parserDiagnostics.length +
    preview.validation.staticDiagnostics.length +
    preview.validation.imageDiagnostics.length +
    preview.validation.pageLedgerDiagnostics.length;
  const unresolved = preview.visualReview.findings.filter((finding) => !finding.resolved);
  const layout = previewLayoutView(preview.pages);
  return {
    id: preview.previewId,
    version: state?.draft?.version ?? state?.patchProposal?.draftVersion ?? 1,
    title: state?.taskBrief.goal ?? 'Notebook draft',
    summary: state?.plan?.summary ?? state?.taskBrief.desiredOutcome ?? 'A reviewed set of Alcove pages, ready to place.',
    pages: preview.pages.map((page) => ({
      id: page.pageId,
      pageNumber: page.pageNumber,
      renderUrl: options.renderUrlFor(page.image),
      width: page.width,
      height: page.height,
      alt: `Exact rendered Alcove draft page ${page.pageNumber}`,
    })),
    affectedPageCount: preview.expectedPageCount,
    parser: {
      status: preview.validation.valid ? diagnostics > 0 ? 'warning' : 'passed' : 'failed',
      label: preview.validation.valid
        ? diagnostics === 0 ? 'Parser passed' : `${diagnostics} parser notes`
        : 'Parser needs repair',
    },
    layout,
    review: {
      status: visualReviewStatus(preview),
      round: Math.max(1, state?.usage.repairPasses === undefined ? 1 : state.usage.repairPasses + 1),
      summary: preview.visualReview.passed
        ? state?.textPrivacy !== undefined && state.textPrivacy.entries.length > 0
          ? `Every one of the ${preview.visualReview.inspectedPageIds.length} masked native page renders was inspected; Alcove then restored the text locally and reran parser and fixed-page layout validation for this exact preview.`
          : `Every one of the ${preview.visualReview.inspectedPageIds.length} native page renders was inspected; blocking findings were repaired before this preview.`
        : `${preview.visualReview.inspectedPageIds.length} of ${preview.visualReview.requiredPageIds.length} native page renders inspected.`,
      findings: unresolved.length === 0
        ? ['No unresolved clipping, overflow, duplication, empty-page or visual-hierarchy findings.']
        : unresolved.map((finding) => finding.summary),
      checkedAt: preview.visualReview.updatedAt,
    },
    citations: preview.citations.map(citationView),
    imageGenerationPrompts: preview.imageGenerationPrompts ?? [],
    placements: placements.map(({ target: _target, ...view }) => view),
    placementId: selected?.id ?? '',
    assumptions: preview.assumptions,
    conflict: targetConflict ?? (state?.lastError?.code === 'stale_context'
      ? {
          title: 'The target changed after this render',
          detail: state.lastError.message,
        }
      : undefined),
    isolated: true,
  };
}

function questionItems(interrupt: AgentInterrupt | null): readonly AiAgentTimelineItem[] {
  if (interrupt?.kind === 'requirements') {
    return interrupt.questions.map((question) => ({
      id: `question:${question.id}`,
      kind: 'question' as const,
      title: interrupt.title,
      text: question.whyItMatters === undefined
        ? question.prompt
        : `${question.prompt} ${question.whyItMatters}`,
      options: question.choices?.map((choice) => ({ id: choice.id, label: choice.label })),
      allowDefaults: false,
    }));
  }
  if (interrupt?.kind === 'blocker') {
    return [{
      id: 'question:blocker',
      kind: 'question',
      title: interrupt.title,
      text: interrupt.message,
      options: interrupt.recoveryChoices?.map((label, index) => ({ id: `recovery:${index}`, label })),
      allowDefaults: false,
    }];
  }
  return [];
}

function eventItem(event: AgentActivityEvent): AiAgentTimelineItem | null {
  switch (event.type) {
    case 'run.started':
      return { id: event.id, kind: 'activity', label: 'Task started', detail: event.goal, status: 'done' };
    case 'status.changed':
      return { id: event.id, kind: 'activity', label: event.summary, status: event.phase === 'finished' ? 'done' : 'running', progress: phaseProgress(event.phase) };
    case 'plan.updated':
      return {
        id: event.id,
        kind: 'plan',
        title: event.plan.summary,
        revision: event.plan.version,
        steps: event.plan.steps.map((step) => ({
          id: step.id,
          label: step.title,
          detail: step.description,
          status: step.status === 'in_progress' ? 'active' : step.status === 'completed' ? 'done' : step.status,
        })),
      };
    case 'user.message':
    case 'assistant.message':
      return {
        id: event.message.id,
        kind: 'message',
        role: event.message.role === 'user' ? 'reader' : 'agent',
        text: event.message.text,
        citations: event.message.citations?.map(citationView),
      };
    case 'tool.started':
      if (event.toolName === 'finish_conversation') return null;
      return { id: event.toolCallId, kind: 'tool', name: event.toolName, summary: event.summary, status: 'running' };
    case 'tool.completed':
      if (event.toolName === 'finish_conversation') return null;
      return { id: event.toolCallId, kind: 'tool', name: event.toolName, summary: event.summary, status: 'done' };
    case 'tool.failed':
      if (event.toolName === 'finish_conversation') return null;
      return { id: event.toolCallId, kind: 'tool', name: event.toolName, summary: event.message, status: 'error' };
    case 'source.coverage':
      return {
        id: event.id,
        kind: 'work-summary',
        title: event.ledger.complete ? 'Source coverage complete' : 'Source coverage in progress',
        bullets: [
          `${event.ledger.readUnitIds.length} of ${event.ledger.requiredUnitIds.length} required source units read`,
          `${event.ledger.citedUnitIds.length} source units cited`,
          event.ledger.omittedUnitIds.length === 0 ? 'No required units silently omitted' : `${event.ledger.omittedUnitIds.length} units still to inspect`,
        ],
      };
    case 'draft.updated':
      return { id: event.id, kind: 'activity', label: `Draft version ${event.draftVersion}`, detail: event.reason === 'repair' ? 'Rebuilt after review findings' : event.reason.replace('_', ' '), status: 'done' };
    case 'preview.rendering':
      return { id: event.id, kind: 'visual-review', status: 'rendering', round: 1, detail: 'Rendering the draft through Alcove’s native page renderer.' };
    case 'preview.ready':
      return { id: event.id, kind: 'visual-review', status: 'inspecting', round: 1, pageCount: event.generation.pageCount, detail: `${event.generation.pageCount} exact page renders are ready for the agent’s own inspection.` };
    case 'preview.page_inspected':
      return { id: event.id, kind: 'activity', label: `Inspected page ${event.pageNumber}`, detail: 'Native render checked', status: 'done' };
    case 'preview.visual_finding':
      return {
        id: event.id,
        kind: 'visual-review',
        status: event.finding.severity === 'blocking' ? 'revising' : 'inspecting',
        round: 1,
        detail: event.finding.resolved ? `Resolved: ${event.finding.summary}` : event.finding.summary,
        findings: event.finding.evidence === undefined ? undefined : [event.finding.evidence],
      };
    case 'approval.requested':
      return { id: event.id, kind: 'visual-review', status: 'passed', round: 1, pageCount: event.preview.pages.length, detail: 'The complete native-page visual review passed. Showing the final preview now.' };
    case 'retry.scheduled':
      return { id: event.id, kind: 'activity', label: `Retry ${event.attempt}`, detail: event.summary, status: 'warning' };
    case 'run.cancelled':
      return { id: event.id, kind: 'activity', label: 'Stopped safely', detail: event.reason, status: 'warning' };
    case 'run.completed':
      return { id: event.id, kind: 'activity', label: 'Agent work complete', detail: event.summary, status: 'done' };
    case 'run.failed':
      return { id: event.id, kind: 'activity', label: 'Agent task paused', detail: event.error.message, status: 'error' };
  }
  return null;
}

/**
 * Create inside a Solid owner (BookView or a wrapper component). The returned
 * handle also exposes `dispose()` for non-Solid hosts; under a Solid owner the
 * subscriptions are released automatically.
 */
export function createAiAgentPanelController(
  core: CoreAiAgentController,
  options: AiAgentPanelAdapterOptions,
): AiAgentPanelControllerHandle {
  const [snapshot, setSnapshot] = createSignal(core.getSnapshot());
  const [timeline, setTimeline] = createSignal<readonly AiAgentTimelineItem[]>([]);
  const [applyingApprovedPatch, setApplyingApprovedPatch] = createSignal(false);
  let creativeDirection: { name: string; prompt: string } | undefined;
  let registeredAttachmentFingerprint = '';
  let requirementAnswers: Readonly<Record<string, string>> = {};
  let requirementDefaultIds: readonly string[] = [];

  const attachmentFingerprint = (refs: readonly SourceAttachmentRef[]): string =>
    refs.map((ref) => {
      if (ref.kind === 'managed_asset') return `${ref.kind}:${ref.assetId}:${ref.digest}`;
      if (ref.kind === 'notebook_selection') {
        return `${ref.kind}:${ref.pageId}:${ref.selectionDigest}`;
      }
      if (ref.kind === 'notebook_book') return `${ref.kind}:${ref.bookId}`;
      if (ref.kind === 'notebook_page') return `${ref.kind}:${ref.pageId}`;
      return `${ref.kind}:${(ref.sectionIds ?? []).join(',')}`;
    }).sort().join('|');

  const registerQueuedSources = async (): Promise<void> => {
    if (core.getSnapshot().state === null) return;
    const queued = options.sourceAttachments?.() ?? [];
    const fingerprint = attachmentFingerprint(queued);
    if (fingerprint === registeredAttachmentFingerprint) return;
    await core.registerAttachments(queued);
    registeredAttachmentFingerprint = fingerprint;
  };

  const append = (item: AiAgentTimelineItem | null): void => {
    if (item === null) return;
    setTimeline((current) => {
      const at = current.findIndex((existing) => existing.id === item.id);
      if (at < 0) return [...current, item];
      const next = [...current];
      next[at] = item;
      return next;
    });
  };

  const optimisticReaderMessage = (text: string): string => {
    const id = `msg-local-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
    append({ id, kind: 'message', role: 'reader', text });
    return id;
  };

  const afterOptimisticPaint = (): Promise<void> => new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      // A promise resolved inside one RAF continues in that frame's microtask
      // checkpoint, still *before* the browser presents pixels.  Starting
      // notebook inspection there can therefore hide the optimistic reader
      // bubble behind first-run setup work.  The second RAF proves one full
      // presentation boundary elapsed before any provider/runtime work begins.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      return;
    }
    setTimeout(resolve, 0);
  });

  // A restored runtime may have conversation but no live event replay. Seed
  // the transcript once, then live events update/append by stable ids.
  for (const message of core.getSnapshot().state?.conversation ?? []) {
    append({
      id: message.id,
      kind: 'message',
      role: message.role === 'user' ? 'reader' : 'agent',
      text: message.text,
      citations: message.citations?.map(citationView),
    });
  }

  const unsubscribeState = core.subscribe((next) => {
    setSnapshot(next);
    for (const message of next.state?.conversation ?? []) {
      append({
        id: message.id,
        kind: 'message',
        role: message.role === 'user' ? 'reader' : 'agent',
        text: message.text,
        citations: message.citations?.map(citationView),
      });
    }
    if (next.state?.plan !== undefined) {
      append({
        id: `plan:${next.state.plan.version}`,
        kind: 'plan',
        title: next.state.plan.summary,
        revision: next.state.plan.version,
        steps: next.state.plan.steps.map((step) => ({
          id: step.id,
          label: step.title,
          detail: step.description,
          status: step.status === 'in_progress' ? 'active' : step.status === 'completed' ? 'done' : step.status,
        })),
      });
    }
  });
  const unsubscribeEvents = core.subscribeEvents((event) => append(eventItem(event)));

  const dispose = (): void => {
    unsubscribeState();
    unsubscribeEvents();
  };
  if (getOwner() !== null) onCleanup(dispose);

  const report = (error: unknown): void => {
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    ) return;
    options.onError?.(error);
  };
  const safely = (operation: () => void | Promise<unknown>): void => {
    try {
      void Promise.resolve(operation()).catch(report);
    } catch (error) {
      report(error);
    }
  };

  const activePreview = (): UserPreviewContract | undefined => {
    const interrupt = snapshot().interrupt;
    // The graph interrupt is actionable before approval. After approval, the
    // proposal itself is the durable outbox: a crash or failed BookView apply
    // must keep these exact renders visible for recovery/retry.
    if (interrupt?.kind === 'final_preview') return interrupt.preview;
    const proposal = snapshot().state?.patchProposal;
    return proposal !== undefined &&
      ['approved_pending_apply', 'apply_failed', 'approved'].includes(proposal.status)
      ? proposal.preview
      : undefined;
  };

  const connectionReady = (): boolean => options.connection().status === 'connected';
  const viewState = (): AiAgentViewState => {
    const current = snapshot();
    const state = current.state;
    const remainingRequirements = current.interrupt?.kind === 'requirements'
      ? current.interrupt.questions.filter(
          (question) => requirementAnswers[question.id] === undefined,
        )
      : [];
    const defaultsOwner =
      remainingRequirements.length > 0 &&
      remainingRequirements.every((question) => question.sensibleDefault !== undefined)
        ? remainingRequirements[0]?.id
        : undefined;
    const interruptItems = questionItems(current.interrupt).map((item) => {
      if (item.kind !== 'question') return item;
      const questionId = item.id.replace('question:', '');
      return {
        ...item,
        answered: requirementAnswers[questionId],
        allowDefaults: questionId === defaultsOwner,
      };
    });
    const existing = new Set(timeline().map((item) => item.id));
    const visibleTimeline = [...timeline(), ...interruptItems.filter((item) => !existing.has(item.id))];
    const conversationOnlySettled =
      state?.lifecycle === 'completed' &&
      state.patchProposal === undefined &&
      state.draft === undefined;
    const readerTimeline = conversationOnlySettled
      ? visibleTimeline.filter((item) => item.kind === 'message')
      : visibleTimeline;
    const preview = activePreview();
    return {
      connection: options.connection(),
      stage: applyingApprovedPatch() ? 'applying' : stageOf(current),
      headline: applyingApprovedPatch()
        ? 'Placing the reviewed pages safely'
        : state?.lifecycle === 'cancelled'
          ? 'Stopped safely'
        : phaseHeadline(state?.phase),
      workingNote: current.busy ? phaseWorkingNote(state?.phase) : undefined,
      progress: applyingApprovedPatch()
        ? 1
        : current.busy ? phaseProgress(state?.phase) : undefined,
      // The panel calls these “threads” for reader-facing continuity, while
      // the core restore/delete API is deliberately keyed by durable task id.
      threadId: state?.identity.taskId,
      threadTitle: options.activeThreadTitle?.() ?? state?.taskBrief.goal,
      threads: options.threads?.() ?? [],
      timeline: readerTimeline,
      attachments: options.attachments?.() ?? [],
      context: options.context?.() ?? DEFAULT_CONTEXT,
      preview: preview === undefined ? undefined : previewView(preview, current, options),
      textPrivacy: state?.textPrivacy === undefined
        ? undefined
        : {
            active: true,
            replacementCount: state.textPrivacy.entries.length,
            note:
              'Risk reduction, not anonymization. Recognizable text is replaced locally with task-stable placeholders, but context-dependent details and text baked into image or scanned-PDF pixels may still reach Cohere. Masked dates and identifiers can also reduce comparison or calculation quality.',
          },
      completedImageGenerationPrompts:
        state?.patchProposal?.status === 'applied'
          ? state.patchProposal.preview.imageGenerationPrompts ?? []
          : [],
      error: state?.lastError === undefined
        ? undefined
        : state.lastError.code === 'cancelled'
          ? {
              title: 'Continue whenever you are ready',
              detail: `${state.lastError.message} Nothing was inserted, and the last safe checkpoint is ready to continue.`,
              retryable: true,
              tone: 'stopped',
              actionLabel: 'Continue',
            }
          : {
              title: state.lastError.code === 'stale_context' ? 'The book changed' : 'The agent paused safely',
              detail: state.lastError.message,
              retryable: state.lastError.retryable,
              tone: 'paused',
            },
      canStop: current.busy && !applyingApprovedPatch(),
      canSend: connectionReady() && !current.busy && !applyingApprovedPatch(),
      composerPlaceholder: current.interrupt?.kind === 'requirements'
        ? 'Answer in your own words, or choose sensible defaults above…'
        : current.interrupt?.kind === 'final_preview'
          ? 'Describe the changes you want in the final draft…'
          : 'Describe what you want this notebook to become…',
    };
  };

  const controller: AiAgentPanelControllerHandle = {
    state: viewState,
    configureKey: options.configureKey,
    skipKeySetup: () => safely(() => options.skipKeySetup?.()),
    openIntegrationSettings: options.openIntegrationSettings,
    send: (message) => {
      const userMessageId = optimisticReaderMessage(message);
      return (async () => {
        // Yield a real paint boundary before graph construction/source setup.
        // Without this, the signal updates immediately but the first message
        // cannot become pixels until the expensive first-task work yields.
        await afterOptimisticPaint();
        const current = snapshot();
        if (current.state === null) {
          const startingAttachments = options.sourceAttachments?.() ?? [];
          const startingFingerprint = attachmentFingerprint(startingAttachments);
          const direction = creativeDirection === undefined
            ? undefined
            : `${creativeDirection.name}: ${creativeDirection.prompt}`;
          await core.startTask({
            bookId: options.bookId,
            goal: message,
            creativeDirection: direction,
            defaultContextPolicy: options.defaultContextPolicy?.(),
            preserveAllSourceInformation:
              options.preserveAllSourceInformation?.() === true ||
              asksForCompleteSourcePreservation(message),
            obfuscatePrivateText: options.obfuscatePrivateText?.() === true,
            attachments: startingAttachments,
            insertionTarget: options.insertionTarget?.(),
            userMessageId,
          });
          registeredAttachmentFingerprint = startingFingerprint;
          return;
        }
        await registerQueuedSources();
        await core.sendUserMessage(message, {
          preserveAllSourceInformation: asksForCompleteSourcePreservation(message),
          insertionTarget: options.insertionTarget?.(),
          userMessageId,
        });
      })().then(() => undefined, (error) => {
        // Initial ingestion can fail before any source rows exist. The
        // runtime persists the exact queued refs in pendingSourceAttachments
        // for Retry; mark that same queue registered so Remove/Delete/New
        // task actions do not silently run ingestion again.
        const durablePending = core.getSnapshot().state?.pendingSourceAttachments ?? [];
        const queuedFingerprint = attachmentFingerprint(options.sourceAttachments?.() ?? []);
        if (attachmentFingerprint(durablePending) === queuedFingerprint) {
          registeredAttachmentFingerprint = queuedFingerprint;
        }
        report(error);
      });
    },
    attachFiles: options.attachFiles,
    removeAttachment: options.removeAttachment,
    toggleContext: options.toggleContext,
    setCreativeDirection: (preset) => {
      creativeDirection = { name: preset.name, prompt: preset.prompt };
    },
    stop: () => safely(() => core.stop()),
    retry: () => safely(() => core.retry()),
    answerQuestion: (_itemId, optionId) => {
      const interrupt = snapshot().interrupt;
      if (interrupt?.kind === 'requirements') {
        const questionId = _itemId.replace('question:', '');
        const question = interrupt.questions.find((item) => item.id === questionId);
        const choice = question?.choices?.find((option) => option.id === optionId);
        if (question === undefined || choice === undefined) return;
        requirementAnswers = { ...requirementAnswers, [questionId]: choice.label };
        requirementDefaultIds = requirementDefaultIds.filter((id) => id !== questionId);
        const unanswered = interrupt.questions.filter(
          (item) => requirementAnswers[item.id] === undefined,
        );
        if (unanswered.length > 0) {
          setSnapshot({ ...snapshot() });
          return;
        }
        const answers = requirementAnswers;
        requirementAnswers = {};
        requirementDefaultIds = [];
        safely(() => core.answerRequirements?.(answers, []) ?? core.sendUserMessage(
          Object.values(answers).join('\n'),
        ));
      } else if (interrupt?.kind === 'blocker') {
        const index = Number(optionId.replace('recovery:', ''));
        safely(() => core.sendUserMessage(interrupt.recoveryChoices?.[index] ?? optionId));
      }
    },
    useSensibleDefaults: (_itemId) => {
      const interrupt = snapshot().interrupt;
      if (interrupt?.kind !== 'requirements') return;
      const unanswered = interrupt.questions.filter(
        (question) => requirementAnswers[question.id] === undefined,
      );
      for (const question of unanswered) {
        if (question.sensibleDefault === undefined) continue;
        requirementAnswers = {
          ...requirementAnswers,
          [question.id]: question.sensibleDefault,
        };
        requirementDefaultIds = [...new Set([...requirementDefaultIds, question.id])];
      }
      const unresolved = interrupt.questions.filter(
        (question) => requirementAnswers[question.id] === undefined,
      );
      if (unresolved.length > 0) {
        setSnapshot({ ...snapshot() });
        return;
      }
      const answers = requirementAnswers;
      const defaults = requirementDefaultIds;
      requirementAnswers = {};
      requirementDefaultIds = [];
      safely(() => core.answerRequirements?.(answers, defaults) ?? core.useSensibleDefaults());
    },
    startNewTask: () => {
      setTimeline([]);
      safely(async () => {
        await registerQueuedSources();
        await core.clearActiveTask();
        registeredAttachmentFingerprint = '';
        await options.onStartNewTask?.();
      });
    },
    selectThread: options.onSelectThread === undefined ? undefined : (id) => {
      setTimeline([]);
      safely(async () => {
        await registerQueuedSources();
        registeredAttachmentFingerprint = '';
        await options.onSelectThread?.(id);
        // onSelectThread hydrates that task's committed and still-pending
        // managed refs into the tray. They already belong to durable state;
        // mark the restored set registered so Delete or another non-Send
        // action cannot accidentally retry ingestion as a side effect.
        registeredAttachmentFingerprint = attachmentFingerprint(
          options.sourceAttachments?.() ?? [],
        );
      });
    },
    renameThread: options.onRenameThread === undefined ? undefined : (id, title) => safely(() => options.onRenameThread?.(id, title)),
    deleteThread: (id) => safely(async () => {
      const current = core.getSnapshot();
      if (current.state?.identity.taskId === id) {
        if (current.busy) await core.stop('Task deleted');
        await registerQueuedSources();
      }
      await (options.onDeleteThread?.(id) ?? core.deleteTask(id));
      if (core.getSnapshot().state === null) registeredAttachmentFingerprint = '';
    }),
    openCitation: options.openCitation,
    setPlacement: (placementId) => {
      const preview = activePreview();
      const placement = options.placements().find((item) => item.id === placementId);
      if (preview !== undefined && placement !== undefined) {
        safely(() => core.changePlacement(preview.previewId, placement.target));
      }
    },
    approveInsert: (previewId) => {
      safely(async () => {
        if (applyingApprovedPatch()) return;
        setApplyingApprovedPatch(true);
        try {
          // A file may have finished uploading while the model was completing
          // its last turn. Register that evidence before approval so the core
          // can invalidate stale coverage/preview state instead of silently
          // inserting a draft that never considered the visible attachment.
          await registerQueuedSources();
          const proposal = await core.approvePreview(previewId);
          try {
            await options.onApprovedProposal(proposal);
            await core.finalizeApprovedPatch(proposal.patchId, { applied: true });
          } catch (error) {
            await core.finalizeApprovedPatch(proposal.patchId, {
              applied: false,
              message: error instanceof Error
                ? error.message
                : 'The notebook could not accept the reviewed pages yet.',
            });
            throw error;
          }
        } finally {
          setApplyingApprovedPatch(false);
        }
      });
    },
    // Clicking “Ask for changes” only focuses the composer. Sending its text
    // calls core.sendUserMessage(), which resumes the final-preview interrupt
    // as feedback in one step. No intermediate rejection is needed.
    requestChanges: (_previewId) => undefined,
    refreshAfterConflict: () => safely(() => {
      if (snapshot().state?.patchProposal?.status === 'apply_failed') {
        return core.sendUserMessage(
          'Refresh the final preview against the notebook as it exists now, then ask me to approve it again.',
        );
      }
      return core.retry();
    }),
    dispose,
  };
  return controller;
}
