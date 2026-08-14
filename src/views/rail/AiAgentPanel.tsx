/**
 * AiAgentPanel — the in-book agent's entire reader-facing workspace.
 *
 * This module deliberately owns presentation, not orchestration.  The agent
 * runtime injects one reactive view model and a narrow set of intents through
 * `AiAgentController`; the panel never imports a provider, sees a stored key,
 * mutates a page, or decides that a draft is safe.  Most importantly, a draft
 * becomes approvable only after the controller reports that the native-page
 * visual review passed (`canPresentFinalPreview`).  Intermediate renders stay
 * with the agent instead of becoming QA homework for the reader.
 *
 * Native preview images are opaque render receipts from Alcove's renderer.
 * The panel does not reconstruct Notebook Script in miniature: the filmstrip,
 * spread and enlarged view all show the same `renderUrl` supplied by the core.
 */
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  AI_SPEC_STYLE_PRESETS,
  createCustomAiSpecStyle,
  loadAiSpecStyleState,
  resolveAiSpecStyle,
  saveAiSpecStyleState,
  type AiSpecStylePreset,
} from '../../editor/script/aiStylePresets';
import {
  IMAGE_GENERATION_ASPECT_LABELS,
  IMAGE_GENERATION_ROLE_LABELS,
} from '../../features/aiAgent/imageHandoff';
import type { ImageGenerationPrompt } from '../../features/aiAgent/types';
import {
  AGENT_SOURCE_FILE_ACCEPT,
  classifyAgentComposerPaste,
  pastedTextFile,
} from '../../features/aiAgent/attachmentIntake';
import { AgentIcon, CloseIcon } from './icons';
import { canPresentFinalPreview } from './aiAgentPreviewGate';
import AppScrollbar from '../AppScrollbar';
import { agentMessageInlineTokens } from './agentMessageMarkdown';
export { canPresentFinalPreview } from './aiAgentPreviewGate';

/* ========================================================================== *
 *                             controller contract                             *
 * ========================================================================== */

export type AiAgentStage =
  | 'idle'
  | 'intake'
  | 'working'
  | 'waiting'
  | 'reviewing'
  | 'ready'
  | 'applying'
  | 'complete'
  | 'cancelled'
  | 'conflict'
  | 'error';

export type AiAgentKeyKind = 'trial' | 'production';
export type AiAgentKeyPersistence = 'session' | 'secure-vault';

export interface AiAgentConnectionView {
  readonly status: 'unconfigured' | 'testing' | 'connected' | 'error';
  readonly provider: 'Cohere';
  readonly keyKind?: AiAgentKeyKind;
  readonly label?: string;
  readonly message?: string;
  /** True only on the first agent open. Settings owns later key management. */
  readonly firstUse?: boolean;
}

export interface AiAgentThreadView {
  readonly id: string;
  readonly title: string;
  readonly updatedLabel?: string;
  readonly status?: 'active' | 'paused' | 'complete' | 'error';
}

export interface AiAgentAttachmentView {
  readonly id: string;
  readonly name: string;
  readonly kind: 'image' | 'pdf' | 'document';
  readonly sizeLabel: string;
  readonly pages?: number;
  readonly previewUrl?: string;
  readonly status: 'reading' | 'ready' | 'warning' | 'error';
  readonly detail?: string;
}

export interface AiAgentContextView {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly selected: boolean;
  readonly locked?: boolean;
}

export interface AiAgentCitationView {
  readonly id: string;
  readonly source: string;
  readonly locator?: string;
  readonly excerpt?: string;
}

export interface AiAgentPlanStepView {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: 'pending' | 'active' | 'done' | 'changed' | 'blocked';
}

export type AiAgentTimelineItem =
  | {
      readonly id: string;
      readonly kind: 'message';
      readonly role: 'reader' | 'agent';
      readonly text: string;
      readonly citations?: readonly AiAgentCitationView[];
    }
  | {
      readonly id: string;
      readonly kind: 'question';
      readonly title: string;
      readonly text: string;
      readonly options?: readonly { id: string; label: string; detail?: string }[];
      readonly answered?: string;
      readonly allowDefaults?: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'plan';
      readonly title: string;
      readonly revision?: number;
      readonly steps: readonly AiAgentPlanStepView[];
    }
  | {
      readonly id: string;
      readonly kind: 'activity';
      readonly label: string;
      readonly detail?: string;
      readonly status: 'running' | 'done' | 'warning' | 'error';
      readonly progress?: number;
    }
  | {
      readonly id: string;
      readonly kind: 'tool';
      readonly name: string;
      readonly summary: string;
      readonly input?: string;
      readonly result?: string;
      readonly status: 'running' | 'done' | 'warning' | 'error';
    }
  | {
      readonly id: string;
      readonly kind: 'work-summary';
      readonly title: string;
      readonly bullets: readonly string[];
      readonly citations?: readonly AiAgentCitationView[];
    }
  | {
      readonly id: string;
      readonly kind: 'visual-review';
      readonly status: 'rendering' | 'inspecting' | 'revising' | 'passed' | 'blocked';
      readonly round: number;
      readonly pageCount?: number;
      readonly detail: string;
      readonly findings?: readonly string[];
    };

export interface AiAgentRenderedPageView {
  readonly id: string;
  readonly pageNumber: number;
  readonly label?: string;
  /** Exact image emitted by Alcove's native draft renderer. */
  readonly renderUrl: string;
  readonly width: number;
  readonly height: number;
  readonly alt?: string;
  readonly sourceCitationIds?: readonly string[];
}

export interface AiAgentVisualReviewView {
  readonly status: 'queued' | 'rendering' | 'inspecting' | 'revising' | 'passed' | 'blocked';
  readonly round: number;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly checkedAt?: string;
}

export interface AiAgentPlacementView {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
}

export interface AiAgentDraftPreviewView {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly summary: string;
  readonly pages: readonly AiAgentRenderedPageView[];
  readonly affectedPageCount: number;
  readonly parser: { readonly status: 'passed' | 'warning' | 'failed'; readonly label: string };
  readonly layout: { readonly status: 'passed' | 'warning' | 'failed'; readonly label: string };
  readonly review: AiAgentVisualReviewView;
  readonly citations: readonly AiAgentCitationView[];
  readonly imageGenerationPrompts: readonly ImageGenerationPrompt[];
  readonly placements: readonly AiAgentPlacementView[];
  readonly placementId: string;
  readonly assumptions?: readonly string[];
  readonly conflict?: {
    readonly title: string;
    readonly detail: string;
    readonly changedPages?: readonly string[];
  };
  /** An informational run receipt; the model never controls this value. */
  readonly isolated: true;
}

export interface AiAgentViewState {
  readonly connection: AiAgentConnectionView;
  readonly stage: AiAgentStage;
  readonly headline?: string;
  /** Friendly latency copy shown only when no concrete action is at the tail. */
  readonly workingNote?: string;
  readonly progress?: number;
  readonly threadId?: string;
  readonly threadTitle?: string;
  readonly threads?: readonly AiAgentThreadView[];
  readonly timeline: readonly AiAgentTimelineItem[];
  readonly attachments: readonly AiAgentAttachmentView[];
  readonly context: readonly AiAgentContextView[];
  readonly preview?: AiAgentDraftPreviewView;
  /** Immutable task receipt, not the mutable Settings preference. */
  readonly textPrivacy?: {
    readonly active: true;
    readonly replacementCount: number;
    readonly note: string;
  };
  /** Shown after the exact reviewed pages have been inserted. */
  readonly completedImageGenerationPrompts?: readonly ImageGenerationPrompt[];
  readonly error?: {
    readonly title: string;
    readonly detail: string;
    readonly retryable?: boolean;
    readonly tone?: 'paused' | 'stopped';
    readonly actionLabel?: string;
  };
  readonly canStop?: boolean;
  readonly canSend?: boolean;
  readonly composerPlaceholder?: string;
}

export interface AiAgentKeySubmission {
  readonly key: string;
  readonly kind: AiAgentKeyKind;
  readonly persistence: AiAgentKeyPersistence;
  readonly trialPrivacyAcknowledged: boolean;
}

export interface AiAgentController {
  /** Must be a Solid-reactive accessor. */
  readonly state: () => AiAgentViewState;
  readonly configureKey?: (input: AiAgentKeySubmission) => void | Promise<void>;
  readonly skipKeySetup?: () => void;
  readonly openIntegrationSettings?: () => void;
  readonly send?: (message: string) => void | Promise<void>;
  readonly attachFiles?: (files: readonly File[]) => void | Promise<void>;
  readonly removeAttachment?: (attachmentId: string) => void;
  readonly toggleContext?: (contextId: string, selected: boolean) => void;
  readonly setCreativeDirection?: (preset: AiSpecStylePreset) => void;
  readonly stop?: () => void;
  readonly retry?: () => void;
  readonly answerQuestion?: (itemId: string, optionId: string) => void;
  readonly useSensibleDefaults?: (itemId: string) => void;
  readonly startNewTask?: () => void;
  readonly selectThread?: (threadId: string) => void;
  readonly renameThread?: (threadId: string, title: string) => void;
  readonly deleteThread?: (threadId: string) => void;
  readonly openCitation?: (citationId: string) => void;
  readonly setPlacement?: (placementId: string) => void;
  /** Approves the immutable preview identified by its core-issued id. */
  readonly approveInsert?: (previewId: string) => void;
  /** Opens the revision composer for the immutable preview. */
  readonly requestChanges?: (previewId: string) => void;
  readonly refreshAfterConflict?: (draftId: string) => void;
  readonly copyText?: (text: string, successMessage: string) => void | Promise<void>;
}

export interface AiAgentPanelProps {
  readonly controller?: AiAgentController;
  readonly bookTitle?: string;
  readonly onNotify?: (message: string) => void;
  /** Guided-tour-only, read-only look at the panel. Never opens key setup. */
  readonly tourPreview?: boolean;
  /** The rail body remains mounted while hidden; setup follows visibility. */
  readonly panelOpen?: boolean;
}

const EMPTY_STATE: AiAgentViewState = {
  connection: {
    status: 'unconfigured',
    provider: 'Cohere',
    firstUse: true,
  },
  stage: 'idle',
  timeline: [],
  attachments: [],
  context: [
    { id: 'current-page', label: 'Current page', selected: true },
    { id: 'nearby-pages', label: 'Nearby pages', selected: false },
    { id: 'whole-book', label: 'Whole book', selected: false },
  ],
  canSend: false,
};

const stageLabel = (stage: AiAgentStage): string => {
  switch (stage) {
    case 'intake': return 'understanding the task';
    case 'working': return 'working in the notebook';
    case 'waiting': return 'waiting for you';
    case 'reviewing': return 'reviewing every page';
    case 'ready': return 'ready for your decision';
    case 'applying': return 'placing pages safely';
    case 'complete': return 'finished';
    case 'cancelled': return 'stopped';
    case 'conflict': return 'book changed';
    case 'error': return 'needs attention';
    default: return 'ready when you are';
  }
};

const runningStage = (stage: AiAgentStage): boolean =>
  stage === 'intake' || stage === 'working' || stage === 'reviewing' || stage === 'applying';

const isVisibleLiveWork = (item: AiAgentTimelineItem | undefined): boolean => {
  if (item === undefined) return false;
  if (item.kind === 'activity' || item.kind === 'tool') return item.status === 'running';
  if (item.kind === 'visual-review') {
    return item.status === 'rendering' || item.status === 'inspecting' || item.status === 'revising';
  }
  if (item.kind === 'plan') return item.steps.some((step) => step.status === 'active');
  return false;
};

/* ========================================================================== *
 *                              small drawn marks                              *
 * ========================================================================== */

const icon = (children: JSX.Element, className = 'nb-ai-inline-icon'): JSX.Element => (
  <svg viewBox="0 0 24 24" class={className} aria-hidden="true">
    {children}
  </svg>
);

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.8,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

function SendIcon(): JSX.Element {
  return icon(<><path d="M 3.8 11.5 C 8.9 8.8 14 6.2 20.1 3.8 C 18.2 9.6 16 14.9 13.4 20.2 C 12.5 17.6 11.6 15.3 10.5 13.2 C 8.3 12.7 6.1 12.2 3.8 11.5 Z" {...STROKE}/><path d="M 10.7 13 C 13.6 10.3 16.2 8 19.4 4.4" {...STROKE} stroke-width="1.35"/></>);
}

function AttachIcon(): JSX.Element {
  return icon(<path d="M 9 7.2 C 9.3 4.6 12.4 3.4 14.4 5 C 15.7 6 15.9 8 14.9 9.3 L 9.1 16.4 C 8.2 17.6 6.3 17.7 5.3 16.7 C 4.4 15.8 4.4 14.3 5.2 13.3 L 11 6.4 M 8 14.3 L 13.5 7.6" {...STROKE}/>);
}

function ExpandIcon(): JSX.Element {
  return icon(<path d="M 9.4 4.6 C 7.6 4.5 6.1 4.6 4.7 4.9 C 4.4 6.3 4.3 7.7 4.5 9.4 M 14.7 4.5 C 16.5 4.4 18.1 4.6 19.5 4.9 C 19.7 6.4 19.8 7.9 19.5 9.5 M 4.5 14.6 C 4.3 16.4 4.5 18 4.8 19.4 C 6.2 19.7 7.7 19.8 9.4 19.6 M 19.5 14.5 C 19.8 16.3 19.6 17.9 19.3 19.3 C 17.9 19.6 16.4 19.7 14.6 19.5" {...STROKE}/>);
}

function StopIcon(): JSX.Element {
  return icon(<path d="M 7 6.8 C 10.4 6.5 13.8 6.5 17.2 6.9 C 17.5 10.3 17.5 13.7 17.1 17.2 C 13.7 17.5 10.3 17.5 6.8 17.1 C 6.5 13.7 6.5 10.3 7 6.8 Z" {...STROKE}/>);
}

function SparkIcon(): JSX.Element {
  return icon(<><path d="M 12 3.3 C 12.6 7.4 14.7 9.6 18.9 10.4 C 14.8 11.1 12.6 13.4 11.9 17.6 C 11.2 13.4 9 11.2 4.9 10.4 C 9.1 9.6 11.2 7.4 12 3.3 Z" {...STROKE}/><path d="M 18.7 15.7 C 18.9 17.2 19.7 18 21.1 18.3 C 19.6 18.6 18.8 19.4 18.6 20.9 C 18.3 19.4 17.5 18.6 16 18.3 C 17.5 18 18.3 17.2 18.7 15.7 Z" {...STROKE} stroke-width="1.25"/></>);
}

function ChevronIcon(): JSX.Element {
  return icon(<path d="M 7.1 9.5 C 8.8 11 10.4 12.6 12 14.4 C 13.7 12.6 15.3 11 16.9 9.5" {...STROKE}/>);
}

function RetryIcon(): JSX.Element {
  return icon(<><path d="M 18.6 8.7 C 17 5.6 13.3 4.1 9.9 5 C 6.1 6 3.9 9.8 4.8 13.6 C 5.7 17.4 9.5 19.7 13.3 18.8 C 16.2 18.1 18.2 15.8 18.7 13" {...STROKE}/><path d="M 18.7 4.8 C 18.7 6.3 18.6 7.7 18.5 9.1 C 17 9.1 15.5 9 14.1 8.8" {...STROKE}/></>);
}

function EyeIcon(): JSX.Element {
  return icon(<><path d="M 3.5 12 C 6 8.5 8.8 6.8 12 6.8 C 15.3 6.8 18.1 8.6 20.5 12.1 C 18 15.5 15.2 17.2 11.9 17.1 C 8.7 17 5.9 15.3 3.5 12 Z" {...STROKE}/><path d="M 14.3 12 C 14.3 13.4 13.3 14.4 11.9 14.4 C 10.5 14.4 9.5 13.3 9.5 12 C 9.5 10.6 10.6 9.6 12 9.6 C 13.3 9.6 14.3 10.7 14.3 12 Z" {...STROKE}/></>);
}

function CheckIcon(): JSX.Element {
  return icon(<path d="M 4.8 12.3 C 6.7 14.1 8.5 15.8 10.2 17.3 C 13.1 13.2 16.2 9.4 19.5 5.9" {...STROKE} stroke-width="2.1"/>);
}

function PageGlyph(): JSX.Element {
  return icon(<><path d="M 6.5 3.8 C 10.2 3.5 13.9 3.5 17.5 3.9 C 17.8 9.3 17.8 14.8 17.4 20.2 C 13.7 20.5 10 20.5 6.4 20.1 C 6.1 14.7 6.1 9.2 6.5 3.8 Z" {...STROKE}/><path d="M 8.8 8 C 11 7.8 13.2 7.8 15.2 8 M 8.8 11.4 C 11.1 11.2 13.2 11.2 15.2 11.4 M 8.8 14.8 C 10.3 14.6 11.9 14.6 13.5 14.8" {...STROKE} stroke-width="1.25"/></>);
}

function CopyIcon(): JSX.Element {
  return icon(<><path d="M 8 6 C 8.1 4.8 8.7 4.2 10 4.1 C 12.9 3.8 15.7 4 18.2 4.4 C 18.6 7.1 18.6 10 18.2 12.8 C 17.9 14 17.2 14.6 16 14.7" {...STROKE}/><path d="M 5.4 9.1 C 8.3 8.7 11.4 8.8 14.3 9.2 C 14.7 12.3 14.7 15.5 14.2 18.7 C 11.2 19.1 8.3 19.1 5.3 18.6 C 4.9 15.5 4.9 12.3 5.4 9.1 Z" {...STROKE}/></>);
}

/* ========================================================================== *
 *                                 component                                  *
 * ========================================================================== */

export default function AiAgentPanel(props: AiAgentPanelProps): JSX.Element {
  const state = createMemo<AiAgentViewState>(() => props.controller?.state() ?? EMPTY_STATE);
  const [setupOpen, setSetupOpen] = createSignal(
    props.panelOpen === true && !props.tourPreview && state().connection.firstUse === true,
  );
  const [threadMenuOpen, setThreadMenuOpen] = createSignal(false);
  const [directionMenuOpen, setDirectionMenuOpen] = createSignal(false);
  const [directionDetailOpen, setDirectionDetailOpen] = createSignal(false);
  const [expandedComposer, setExpandedComposer] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [previewPage, setPreviewPage] = createSignal(0);
  const [fullPreviewOpen, setFullPreviewOpen] = createSignal(false);
  const [previewZoom, setPreviewZoom] = createSignal<'fit' | number>('fit');
  const [placementMenuOpen, setPlacementMenuOpen] = createSignal(false);
  const [renameId, setRenameId] = createSignal<string | null>(null);
  const [renameDraft, setRenameDraft] = createSignal('');
  let transcriptRef: HTMLDivElement | undefined;
  let composerRef: HTMLTextAreaElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  let transcriptWasNearEnd = true;

  const storedDirections = loadAiSpecStyleState();
  const [directionId, setDirectionId] = createSignal(storedDirections.selectedId);
  const [customDirections, setCustomDirections] = createSignal<readonly AiSpecStylePreset[]>(
    storedDirections.customPresets,
  );
  const direction = createMemo(() => resolveAiSpecStyle(directionId(), customDirections()));

  createEffect(() => {
    if (props.tourPreview || props.panelOpen !== true) {
      setSetupOpen(false);
      return;
    }
    if (state().connection.status === 'connected') {
      setSetupOpen(false);
    } else if (
      state().connection.status === 'unconfigured' &&
      (state().connection.firstUse === true || import.meta.env.DEV)
    ) {
      setSetupOpen(true);
    }
  });

  createEffect(() => {
    const preview = state().preview;
    if (preview === undefined) return;
    setPreviewPage((current) => Math.min(current, Math.max(0, preview.pages.length - 1)));
  });

  const rememberTranscriptPosition = (): void => {
    const viewport = transcriptRef;
    if (viewport === undefined) return;
    transcriptWasNearEnd =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 180;
  };

  // Follow new work only when the reader was already near the end *before*
  // Solid appended it. Measuring after a plan/card grows the transcript makes
  // the same reader look 200px farther away and strands the new work below the
  // fold. Scroll events keep the pre-update intent without yanking somebody
  // who deliberately moved upward to read an older receipt.
  createEffect(() => {
    const count = state().timeline.length;
    state().headline;
    const viewport = transcriptRef;
    if (!viewport) return;
    if (!transcriptWasNearEnd) return;
    queueMicrotask(() => {
      if (count < 0) return;
      // Keep this atomic. A smooth scroll emits intermediate scroll events;
      // those can briefly look "not near the end" and disable following just
      // as a second tool receipt arrives. The panel's cards already animate,
      // so an immediate transcript catch-up reads cleanly and remains stable
      // during bursty parallel-tool updates.
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
      transcriptWasNearEnd = true;
    });
  });

  createEffect(() => {
    if (!expandedComposer() && !fullPreviewOpen() && !setupOpen()) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (fullPreviewOpen() && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const pages = currentPreview()?.pages.length ?? 0;
        if (pages === 0) return;
        event.preventDefault();
        event.stopPropagation();
        setPreviewPage((current) => Math.max(0, Math.min(pages - 1, current + (event.key === 'ArrowLeft' ? -1 : 1))));
        return;
      }
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (fullPreviewOpen()) setFullPreviewOpen(false);
      else if (expandedComposer()) setExpandedComposer(false);
      else if (setupOpen()) {
        setSetupOpen(false);
        props.controller?.skipKeySetup?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  createEffect(() => {
    const viewport = transcriptRef;
    if (viewport === undefined) return;
    const extent = state().timeline.length;
    if (extent < 0) return;
    queueMicrotask(() => viewport.dispatchEvent(new Event('scroll')));
  });

  const pickDirection = (preset: AiSpecStylePreset): void => {
    setDirectionId(preset.id);
    saveAiSpecStyleState({ selectedId: preset.id, customPresets: customDirections() });
    setDirectionMenuOpen(false);
    props.controller?.setCreativeDirection?.(preset);
  };

  const send = (): void => {
    const text = draft().trim();
    if (text === '' || state().canSend === false || state().connection.status !== 'connected') return;
    setDraft('');
    setExpandedComposer(false);
    void props.controller?.send?.(text);
  };

  const askForChanges = (): void => {
    const preview = state().preview;
    if (!canPresentFinalPreview(preview)) return;
    props.controller?.requestChanges?.(preview.id);
    setDraft('Please change ');
    queueMicrotask(() => composerRef?.focus());
  };

  const currentPreview = createMemo(() => {
    const preview = state().preview;
    return canPresentFinalPreview(preview) ? preview : undefined;
  });
  const workingWhisper = createMemo(() => {
    if (!runningStage(state().stage)) return undefined;
    const note = state().workingNote?.trim();
    if (note === undefined || note === '') return undefined;
    const tail = state().timeline[state().timeline.length - 1];
    return isVisibleLiveWork(tail) ? undefined : note;
  });

  return (
    <div class="nb-ai-agent" data-stage={state().stage}>
      <header class="nb-ai-agent-taskbar">
        <div class="nb-ai-agent-identity">
          <span class="nb-ai-agent-mark"><AgentIcon /></span>
          <div>
            <span class="nb-ai-agent-kicker font-ui">AI agent · {state().connection.provider}</span>
            <strong>{state().threadTitle ?? 'A fresh notebook task'}</strong>
          </div>
        </div>
        <div class="nb-ai-agent-task-actions">
          <button
            type="button"
            class="nb-ai-icon-button"
            aria-label="New AI task"
            data-tooltip="new task"
            data-tooltip-side="bottom"
            disabled={runningStage(state().stage)}
            onClick={() => props.controller?.startNewTask?.()}
          >
            <span aria-hidden="true">＋</span>
          </button>
          <button
            type="button"
            class="nb-ai-thread-button font-ui"
            aria-expanded={threadMenuOpen()}
            disabled={runningStage(state().stage)}
            onClick={() => setThreadMenuOpen((open) => !open)}
          >
            tasks <ChevronIcon />
          </button>
        </div>
        <Show when={threadMenuOpen()}>
          <ThreadMenu
            threads={state().threads ?? []}
            activeId={state().threadId}
            renameId={renameId()}
            renameDraft={renameDraft()}
            onRenameDraft={setRenameDraft}
            onClose={() => setThreadMenuOpen(false)}
            onSelect={(id) => {
              props.controller?.selectThread?.(id);
              setThreadMenuOpen(false);
            }}
            onBeginRename={(thread) => {
              setRenameId(thread.id);
              setRenameDraft(thread.title);
            }}
            onCommitRename={(id) => {
              const title = renameDraft().trim();
              if (title !== '') props.controller?.renameThread?.(id, title);
              setRenameId(null);
            }}
            onDelete={(id) => props.controller?.deleteThread?.(id)}
          />
        </Show>
      </header>

      <div class="nb-ai-agent-status" aria-live="polite">
        <span class="nb-ai-agent-status-mark" data-stage={state().stage} aria-hidden="true" />
        <div>
          <strong class="font-ui">{state().headline ?? stageLabel(state().stage)}</strong>
          <Show when={state().connection.status === 'connected'} fallback={
            props.tourPreview
              ? <span class="font-ui">tour preview · offline · nothing sent</span>
              : <button type="button" class="nb-ai-text-button font-ui" onClick={() => setSetupOpen(true)}>
                  not connected · set up Cohere
                </button>
          }>
            <span class="font-ui">{stageLabel(state().stage)}</span>
          </Show>
        </div>
        <Show when={runningStage(state().stage) && state().canStop}>
          <button type="button" class="nb-ai-stop font-ui" onClick={() => props.controller?.stop?.()}>
            <StopIcon /> Stop
          </button>
        </Show>
        <Show when={state().textPrivacy} keyed>
          {(privacy) => (
            <span
              class="nb-ai-text-veil font-ui"
              title={privacy.note}
              data-tooltip={privacy.note}
              aria-label={`Text veil active. ${privacy.note}`}
            >
              <span aria-hidden="true">◌</span>
              text veil · {privacy.replacementCount}
            </span>
          )}
        </Show>
        <Show when={state().progress !== undefined}>
          <span class="nb-ai-agent-progress" aria-label={`${Math.round((state().progress ?? 0) * 100)}% complete`}>
            <span style={{ width: `${Math.max(0, Math.min(1, state().progress ?? 0)) * 100}%` }} />
          </span>
        </Show>
      </div>

      <div class="nb-ai-agent-scroll-shell">
      <div class="nb-ai-agent-scroll" ref={transcriptRef} onScroll={rememberTranscriptPosition}>
        <Show when={state().timeline.length === 0 && state().stage === 'idle'}>
          <EmptyAgent
            bookTitle={props.bookTitle}
            connected={state().connection.status === 'connected'}
            tourPreview={props.tourPreview}
            onConnect={() => setSetupOpen(true)}
            onPrompt={(text) => {
              setDraft(text);
              queueMicrotask(() => composerRef?.focus());
            }}
          />
        </Show>

        <div class="nb-ai-transcript" role="log" aria-label="AI agent work log" aria-live="polite">
          <For each={state().timeline}>
            {(item) => (
              <TimelineItem
                item={item}
                onCitation={(id) => props.controller?.openCitation?.(id)}
                onAnswer={(optionId) => props.controller?.answerQuestion?.(item.id, optionId)}
                onDefaults={() => props.controller?.useSensibleDefaults?.(item.id)}
              />
            )}
          </For>
          <Show when={workingWhisper()} keyed>
            {(note) => <AgentWorkingWhisper note={note} />}
          </Show>
        </div>

        <Show when={state().error} keyed>
          {(error) => (
            <ErrorCard error={error} onRetry={() => props.controller?.retry?.()} />
          )}
        </Show>

        {/* Intermediate render bytes may already exist in state, but they are
            intentionally hidden until the agent's visual review passes. */}
        <Show when={state().preview !== undefined && !canPresentFinalPreview(state().preview)}>
          <VisualReviewGate review={state().preview?.review} />
        </Show>

        <Show when={currentPreview()} keyed>
          {(preview) => (
            <FinalPreviewCard
              preview={preview}
              selectedPage={previewPage()}
              onSelectPage={setPreviewPage}
              onOpen={() => {
                setPreviewZoom('fit');
                setFullPreviewOpen(true);
              }}
              placementMenuOpen={placementMenuOpen()}
              onTogglePlacement={() => setPlacementMenuOpen((open) => !open)}
              onPlacement={(id) => {
                props.controller?.setPlacement?.(id);
                setPlacementMenuOpen(false);
              }}
              onCitation={(id) => props.controller?.openCitation?.(id)}
              onCopy={(text, message) => {
                if (props.controller?.copyText !== undefined) {
                  void props.controller.copyText(text, message);
                  return;
                }
                void navigator.clipboard.writeText(text).then(
                  () => props.onNotify?.(message),
                  () => props.onNotify?.('Could not copy the prompt.'),
                );
              }}
              onChange={askForChanges}
              onApprove={() => props.controller?.approveInsert?.(preview.id)}
              onRefreshConflict={() => props.controller?.refreshAfterConflict?.(preview.id)}
            />
          )}
        </Show>

        <Show
          when={currentPreview() === undefined &&
            (state().completedImageGenerationPrompts?.length ?? 0) > 0}
        >
          <ImagePromptHandoffCard
            prompts={state().completedImageGenerationPrompts ?? []}
            onCopy={(text, message) => {
              if (props.controller?.copyText !== undefined) {
                void props.controller.copyText(text, message);
                return;
              }
              void navigator.clipboard.writeText(text).then(
                () => props.onNotify?.(message),
                () => props.onNotify?.('Could not copy the prompt.'),
              );
            }}
          />
        </Show>
      </div>
      <AppScrollbar
        target={() => transcriptRef}
        label="AI agent conversation position"
        class="nb-ai-transcript-scrollbar"
      />
      </div>

      <section class="nb-ai-composer-wrap" aria-label="Message the AI agent">
        <div class="nb-ai-context-row" aria-label="Notebook context">
          <For each={state().context}>
            {(context) => (
              <button
                type="button"
                class="nb-ai-context-chip font-ui"
                aria-pressed={context.selected}
                aria-label={context.detail === undefined ? context.label : `${context.label} — ${context.detail}`}
                disabled={context.locked}
                data-tooltip={context.detail}
                data-tooltip-side="top"
                onClick={() => props.controller?.toggleContext?.(context.id, !context.selected)}
              >
                <PageGlyph /> {context.label}
              </button>
            )}
          </For>
        </div>

        <AttachmentTray
          attachments={state().attachments}
          onRemove={(id) => props.controller?.removeAttachment?.(id)}
        />

        <div class="nb-ai-composer">
          <textarea
            ref={composerRef}
            aria-label="What should the agent do?"
            rows={3}
            maxlength={12_000}
            value={draft()}
            placeholder={state().composerPlaceholder ?? 'Describe what you want this notebook to become…'}
            disabled={state().connection.status !== 'connected'}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onPaste={(event) => {
              const text = event.clipboardData?.getData('text/plain') ?? '';
              if (classifyAgentComposerPaste(text).kind !== 'attachment') return;
              event.preventDefault();
              void props.controller?.attachFiles?.([pastedTextFile(text)]);
              props.onNotify?.('Large paste attached as Pasted text.');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div class="nb-ai-composer-toolbar">
            <input
              ref={fileInput}
              class="nb-ai-file-input"
              type="file"
              multiple
              accept={AGENT_SOURCE_FILE_ACCEPT}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                if (files.length > 0) void props.controller?.attachFiles?.(files);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              class="nb-ai-icon-button"
              aria-label="Attach a source"
              disabled={state().connection.status !== 'connected'}
              data-tooltip="attach a source"
              data-tooltip-side="top"
              onClick={() => fileInput?.click()}
            ><AttachIcon /></button>
            <button
              type="button"
              class="nb-ai-icon-button"
              aria-label="Open a larger writing sheet"
              disabled={state().connection.status !== 'connected'}
              data-tooltip="write in a larger sheet"
              data-tooltip-side="top"
              onClick={() => setExpandedComposer(true)}
            ><ExpandIcon /></button>

            <div class="nb-ai-direction-control">
              <button
                type="button"
                class="nb-ai-direction-button font-ui"
                aria-expanded={directionMenuOpen()}
                onClick={() => setDirectionMenuOpen((open) => !open)}
              >
                <SparkIcon /> {direction().name} <ChevronIcon />
              </button>
              <Show when={directionMenuOpen()}>
                <DirectionMenu
                  selectedId={directionId()}
                  customDirections={customDirections()}
                  onPick={pickDirection}
                  onInspect={() => {
                    setDirectionDetailOpen(true);
                    setDirectionMenuOpen(false);
                  }}
                  onClose={() => setDirectionMenuOpen(false)}
                />
              </Show>
            </div>

            <span class="nb-ai-composer-spacer" />
            <span class="nb-ai-send-hint font-ui">Ctrl ↵</span>
            <button
              type="button"
              class="nb-ai-send"
              aria-label="Send to AI agent"
              disabled={draft().trim() === '' || state().canSend === false || state().connection.status !== 'connected'}
              onClick={send}
            ><SendIcon /></button>
          </div>
        </div>
        <p class="nb-ai-privacy-line font-ui">
          <Show when={state().textPrivacy}>
            <span aria-hidden="true">◌</span>{' '}
            <span>Text veil reduces exposure in recognized text for this task. It may miss context-dependent details and cannot mask words or numbers baked into image or scanned-PDF pixels.</span>
          </Show>
          <Show when={state().connection.status === 'connected'}>
            <Show when={state().textPrivacy}>{' '}</Show>
            <button type="button" onClick={() => props.controller?.openIntegrationSettings?.()}>privacy & connection</button>
          </Show>
        </p>
      </section>

      <Show when={props.panelOpen === true && !props.tourPreview && setupOpen()}>
        <KeySetupSheet
          connection={state().connection}
          onClose={() => {
            setSetupOpen(false);
            props.controller?.skipKeySetup?.();
          }}
          onSkip={() => {
            setSetupOpen(false);
            props.controller?.skipKeySetup?.();
          }}
          onSubmit={(submission) => {
            void props.controller?.configureKey?.(submission);
          }}
        />
      </Show>

      <Show when={expandedComposer()}>
        <ExpandedComposer
          value={draft()}
          attachments={state().attachments}
          direction={direction()}
          canSend={state().canSend !== false && state().connection.status === 'connected'}
          onInput={setDraft}
          onPasteAttachment={(text) => {
            void props.controller?.attachFiles?.([pastedTextFile(text)]);
            props.onNotify?.('Large paste attached as Pasted text.');
          }}
          onClose={() => setExpandedComposer(false)}
          onSend={send}
          onAttach={() => fileInput?.click()}
        />
      </Show>

      <Show when={directionDetailOpen()}>
        <DirectionEditor
          selected={direction()}
          customDirections={customDirections()}
          onClose={() => setDirectionDetailOpen(false)}
          onSave={(preset) => {
            const next = preset.custom
              ? customDirections().some((item) => item.id === preset.id)
                ? customDirections().map((item) => item.id === preset.id ? preset : item)
                : [...customDirections(), preset]
              : customDirections();
            setCustomDirections(next);
            saveAiSpecStyleState({ selectedId: preset.id, customPresets: next });
            pickDirection(preset);
            setDirectionDetailOpen(false);
          }}
          onDelete={(id) => {
            const next = customDirections().filter((item) => item.id !== id);
            setCustomDirections(next);
            const fallback = AI_SPEC_STYLE_PRESETS[0];
            saveAiSpecStyleState({ selectedId: fallback.id, customPresets: next });
            pickDirection(fallback);
            setDirectionDetailOpen(false);
          }}
          onNotify={props.onNotify}
        />
      </Show>

      <Show when={fullPreviewOpen() && currentPreview()} keyed>
        {(preview) => (
          <FullPreviewSheet
            preview={preview}
            pageIndex={previewPage()}
            zoom={previewZoom()}
            onPage={setPreviewPage}
            onZoom={setPreviewZoom}
            onClose={() => setFullPreviewOpen(false)}
          />
        )}
      </Show>
    </div>
  );
}

function AgentWorkingWhisper(props: { note: string }): JSX.Element {
  return (
    <article class="nb-ai-working-whisper" role="status" aria-label={`${props.note}. The AI agent is still working.`}>
      <span class="nb-ai-working-whisper-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        <span class="nb-ai-message-role font-ui">Alcove agent</span>
        <strong>{props.note}</strong>
      </span>
    </article>
  );
}

/* ========================================================================== *
 *                              timeline pieces                               *
 * ========================================================================== */

function TimelineItem(props: {
  item: AiAgentTimelineItem;
  onCitation(id: string): void;
  onAnswer(optionId: string): void;
  onDefaults(): void;
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.item.kind === 'message' ? props.item : undefined} keyed>
        {(item) => (
          <article class="nb-ai-message" data-role={item.role}>
            <span class="nb-ai-message-role font-ui">{item.role === 'agent' ? 'Alcove agent' : 'You'}</span>
            <p class="nb-ai-message-copy">
              <For each={agentMessageInlineTokens(item.text)}>
                {(token) => (
                  <Switch>
                    <Match when={token.kind === 'text'}>{token.kind === 'text' ? token.text : ''}</Match>
                    <Match when={token.kind === 'strong'}><strong>{token.kind === 'strong' ? token.text : ''}</strong></Match>
                    <Match when={token.kind === 'emphasis'}><em>{token.kind === 'emphasis' ? token.text : ''}</em></Match>
                    <Match when={token.kind === 'code'}><code>{token.kind === 'code' ? token.text : ''}</code></Match>
                    <Match when={token.kind === 'break'}><br /></Match>
                  </Switch>
                )}
              </For>
            </p>
            <Citations citations={item.citations ?? []} onOpen={props.onCitation} />
          </article>
        )}
      </Match>
      <Match when={props.item.kind === 'question' ? props.item : undefined} keyed>
        {(item) => (
          <article class="nb-ai-question-card">
            <span class="nb-ai-card-kicker font-ui">one thing before I begin</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <Show when={item.answered} keyed>
              {(answer) => <p class="nb-ai-answer-receipt font-ui"><CheckIcon /> {answer}</p>}
            </Show>
            <div class="nb-ai-question-options">
              <For each={item.options ?? []}>
                {(option) => (
                  <button
                    type="button"
                    aria-pressed={item.answered === option.label}
                    classList={{ 'is-selected': item.answered === option.label }}
                    onClick={() => props.onAnswer(option.id)}
                  >
                    <strong>{option.label}</strong>
                    <Show when={option.detail}><span class="font-ui">{option.detail}</span></Show>
                  </button>
                )}
              </For>
              <Show when={item.allowDefaults}>
                <button
                  type="button"
                  class="is-defaults font-ui"
                  onClick={props.onDefaults}
                >
                  Use sensible defaults for all remaining
                </button>
              </Show>
            </div>
          </article>
        )}
      </Match>
      <Match when={props.item.kind === 'plan' ? props.item : undefined} keyed>
        {(item) => (
          <article class="nb-ai-plan-card">
            <header><span class="nb-ai-card-kicker font-ui">working plan{item.revision ? ` · revision ${item.revision}` : ''}</span><h3>{item.title}</h3></header>
            <ol>
              <For each={item.steps}>
                {(step) => (
                  <li data-status={step.status}>
                    <span class="nb-ai-plan-mark" aria-hidden="true">{step.status === 'done' ? '✓' : step.status === 'active' ? '→' : '·'}</span>
                    <div><strong>{step.label}</strong><Show when={step.detail}><span class="font-ui">{step.detail}</span></Show></div>
                  </li>
                )}
              </For>
            </ol>
          </article>
        )}
      </Match>
      <Match when={props.item.kind === 'activity' ? props.item : undefined} keyed>
        {(item) => (
          <article class="nb-ai-activity" data-status={item.status}>
            <span class="nb-ai-activity-mark" aria-hidden="true" />
            <div><strong>{item.label}</strong><Show when={item.detail}><span class="font-ui">{item.detail}</span></Show></div>
            <Show when={item.progress !== undefined}><span class="nb-ai-mini-progress"><span style={{ width: `${(item.progress ?? 0) * 100}%` }} /></span></Show>
          </article>
        )}
      </Match>
      <Match when={props.item.kind === 'tool' ? props.item : undefined} keyed>
        {(item) => (
          <details class="nb-ai-tool-card" data-status={item.status}>
            <summary>
              <span class="nb-ai-tool-glyph" aria-hidden="true">⌁</span>
              <span><strong>{item.name}</strong><span class="font-ui">{item.summary}</span></span>
              <span class="nb-ai-tool-status font-ui">{item.status}</span>
            </summary>
            <Show when={item.input}><div class="nb-ai-tool-detail"><span class="font-ui">asked</span><code>{item.input}</code></div></Show>
            <Show when={item.result}><div class="nb-ai-tool-detail"><span class="font-ui">found</span><p>{item.result}</p></div></Show>
          </details>
        )}
      </Match>
      <Match when={props.item.kind === 'work-summary' ? props.item : undefined} keyed>
        {(item) => (
          <article class="nb-ai-work-summary">
            <span class="nb-ai-card-kicker font-ui">work note</span>
            <h3>{item.title}</h3>
            <ul><For each={item.bullets}>{(bullet) => <li>{bullet}</li>}</For></ul>
            <Citations citations={item.citations ?? []} onOpen={props.onCitation} />
          </article>
        )}
      </Match>
      <Match when={props.item.kind === 'visual-review' ? props.item : undefined} keyed>
        {(item) => (
          <article class="nb-ai-review-activity" data-status={item.status}>
            <EyeIcon />
            <div>
              <span class="nb-ai-card-kicker font-ui">native page review · round {item.round}</span>
              <strong>{item.detail}</strong>
              <Show when={item.pageCount}><span class="font-ui">{item.pageCount} rendered pages inspected at their real proportions</span></Show>
              <Show when={(item.findings?.length ?? 0) > 0}>
                <ul><For each={item.findings}>{(finding) => <li>{finding}</li>}</For></ul>
              </Show>
            </div>
          </article>
        )}
      </Match>
    </Switch>
  );
}

function Citations(props: { citations: readonly AiAgentCitationView[]; onOpen(id: string): void }): JSX.Element {
  return (
    <Show when={props.citations.length > 0}>
      <div class="nb-ai-citations" aria-label="Sources">
        <For each={props.citations}>
          {(citation) => (
            <button
              type="button"
              class="font-ui"
              aria-label={citation.excerpt === undefined ? `${citation.source}${citation.locator ? `, ${citation.locator}` : ''}` : `${citation.source}${citation.locator ? `, ${citation.locator}` : ''} — ${citation.excerpt}`}
              data-tooltip={citation.excerpt}
              data-tooltip-side="top"
              onClick={() => props.onOpen(citation.id)}
            >
              <span aria-hidden="true">⌑</span> {citation.source}<Show when={citation.locator}> · {citation.locator}</Show>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

function ErrorCard(props: {
  error: NonNullable<AiAgentViewState['error']>;
  onRetry(): void;
}): JSX.Element {
  const stopped = (): boolean => props.error.tone === 'stopped';
  return (
    <article class="nb-ai-error-card" data-tone={props.error.tone ?? 'paused'} role="alert">
      <span class="nb-ai-card-kicker font-ui">
        {stopped() ? 'stopped · your place is saved' : 'the task paused safely'}
      </span>
      <h3>{props.error.title}</h3>
      <p>{props.error.detail}</p>
      <Show when={props.error.retryable}>
        <div class="nb-ai-recovery-actions">
          <button type="button" class="nb-ai-secondary-action font-ui" onClick={props.onRetry}>
            <RetryIcon /> {props.error.actionLabel ?? 'Try again'}
          </button>
          <Show when={stopped()}>
            <span class="font-ui">or write a follow-up below</span>
          </Show>
        </div>
      </Show>
    </article>
  );
}

function VisualReviewGate(props: { review?: AiAgentVisualReviewView }): JSX.Element {
  return (
    <article class="nb-ai-review-gate" aria-live="polite">
      <div class="nb-ai-review-orbit" aria-hidden="true"><EyeIcon /></div>
      <div>
        <span class="nb-ai-card-kicker font-ui">agent-only quality pass</span>
        <h3>{props.review?.status === 'revising' ? 'I found something worth fixing' : 'Reviewing the real pages'}</h3>
        <p>{props.review?.summary ?? 'Rendering the draft as Alcove pages, then checking every page before asking you to decide.'}</p>
        <Show when={(props.review?.findings.length ?? 0) > 0}>
          <ul><For each={props.review?.findings ?? []}>{(finding) => <li>{finding}</li>}</For></ul>
        </Show>
        <p class="nb-ai-review-promise font-ui">No approval yet — this is my review, not yours.</p>
      </div>
    </article>
  );
}

/* ========================================================================== *
 *                               final preview                                *
 * ========================================================================== */

function statusBadge(label: string, status: 'passed' | 'warning' | 'failed'): JSX.Element {
  return <span class="nb-ai-check-badge font-ui" data-status={status}><span aria-hidden="true">{status === 'passed' ? '✓' : status === 'warning' ? '!' : '×'}</span>{label}</span>;
}

function FinalPreviewCard(props: {
  preview: AiAgentDraftPreviewView;
  selectedPage: number;
  onSelectPage(index: number): void;
  onOpen(): void;
  placementMenuOpen: boolean;
  onTogglePlacement(): void;
  onPlacement(id: string): void;
  onCitation(id: string): void;
  onCopy(text: string, message: string): void;
  onChange(): void;
  onApprove(): void;
  onRefreshConflict(): void;
}): JSX.Element {
  const spreadStart = createMemo(() => Math.floor(props.selectedPage / 2) * 2);
  const shown = createMemo(() => props.preview.pages.slice(spreadStart(), spreadStart() + 2));
  const placement = createMemo(() => props.preview.placements.find((item) => item.id === props.preview.placementId));
  return (
    <article class="nb-ai-final-preview" aria-label="Final notebook preview">
      <header class="nb-ai-final-head">
        <div>
          <span class="nb-ai-card-kicker font-ui">reviewed draft · version {props.preview.version}</span>
          <h3>{props.preview.title}</h3>
          <p>{props.preview.summary}</p>
        </div>
        <span class="nb-ai-review-seal font-ui"><CheckIcon /> visually reviewed</span>
      </header>

      <div class="nb-ai-preview-safety font-ui">
        <span aria-hidden="true">◇</span>
        <strong>Preview only.</strong> These rendered pages are isolated; your book has not changed.
      </div>

      <div class="nb-ai-preview-checks">
        {statusBadge(props.preview.parser.label, props.preview.parser.status)}
        {statusBadge(props.preview.layout.label, props.preview.layout.status)}
        <span class="nb-ai-check-badge font-ui" data-status="passed"><EyeIcon /> review round {props.preview.review.round}</span>
        <span class="nb-ai-check-badge font-ui" data-status="neutral">{props.preview.affectedPageCount} affected {props.preview.affectedPageCount === 1 ? 'page' : 'pages'}</span>
      </div>

      <button type="button" class="nb-ai-preview-stage" onClick={props.onOpen} aria-label="Open the full page preview">
        <div class="nb-ai-preview-spread">
          <For each={shown()}>
            {(page) => <RenderedPage page={page} />}
          </For>
        </div>
        <span class="nb-ai-preview-open font-ui"><ExpandIcon /> open full preview</span>
      </button>

      <div class="nb-ai-preview-filmstrip" role="list" aria-label="Draft pages">
        <For each={props.preview.pages}>
          {(page, index) => (
            <button
              type="button"
              role="listitem"
              class="nb-ai-preview-thumb"
              classList={{ 'is-active': index() === props.selectedPage }}
              aria-label={`Show page ${page.pageNumber}`}
              aria-pressed={index() === props.selectedPage}
              onClick={() => props.onSelectPage(index())}
            >
              <img src={page.renderUrl} alt="" draggable={false} />
              <span class="font-ui">{page.label ?? `p. ${page.pageNumber}`}</span>
            </button>
          )}
        </For>
      </div>

      <section class="nb-ai-review-report">
        <span class="nb-ai-card-kicker font-ui">what I checked</span>
        <p>{props.preview.review.summary}</p>
        <Show when={props.preview.review.findings.length > 0}>
          <ul><For each={props.preview.review.findings}>{(finding) => <li>{finding}</li>}</For></ul>
        </Show>
      </section>

      <Show when={(props.preview.assumptions?.length ?? 0) > 0}>
        <details class="nb-ai-preview-assumptions">
          <summary class="font-ui">Assumptions used</summary>
          <ul><For each={props.preview.assumptions ?? []}>{(assumption) => <li>{assumption}</li>}</For></ul>
        </details>
      </Show>

      <Citations citations={props.preview.citations} onOpen={props.onCitation} />

      <ImagePromptHandoffCard
        prompts={props.preview.imageGenerationPrompts}
        onCopy={props.onCopy}
      />

      <section class="nb-ai-placement">
        <span class="nb-ai-card-kicker font-ui">where it will go</span>
        <button type="button" class="nb-ai-placement-button" aria-expanded={props.placementMenuOpen} onClick={props.onTogglePlacement}>
          <span><strong>{placement()?.label ?? 'Choose a location'}</strong><Show when={placement()?.detail}><span class="font-ui">{placement()?.detail}</span></Show></span>
          <ChevronIcon />
        </button>
        <Show when={props.placementMenuOpen}>
          <div class="nb-ai-placement-menu" role="menu">
            <For each={props.preview.placements}>
              {(option) => (
                <button type="button" role="menuitemradio" aria-checked={option.id === props.preview.placementId} onClick={() => props.onPlacement(option.id)}>
                  <span class="nb-ai-menu-tick" aria-hidden="true">{option.id === props.preview.placementId ? '✓' : ''}</span>
                  <span><strong>{option.label}</strong><Show when={option.detail}><small>{option.detail}</small></Show></span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </section>

      <Show when={props.preview.conflict} keyed>
        {(conflict) => (
          <div class="nb-ai-conflict-card" role="alert">
            <span class="nb-ai-card-kicker font-ui">your book changed while I worked</span>
            <h4>{conflict.title}</h4>
            <p>{conflict.detail}</p>
            <button type="button" class="nb-ai-secondary-action font-ui" onClick={props.onRefreshConflict}><RetryIcon /> Refresh the preview safely</button>
          </div>
        )}
      </Show>

      <footer class="nb-ai-final-actions">
        <button type="button" class="nb-ai-change-action font-ui" onClick={props.onChange}>Ask for changes</button>
        <button type="button" class="nb-ai-approve-action font-ui" disabled={props.preview.conflict !== undefined} onClick={props.onApprove}>
          <CheckIcon /> Insert {props.preview.affectedPageCount} {props.preview.affectedPageCount === 1 ? 'page' : 'pages'}
        </button>
      </footer>
    </article>
  );
}

function promptClipboardText(prompt: ImageGenerationPrompt): string {
  const sections = [
    prompt.prompt,
    `Format: ${IMAGE_GENERATION_ASPECT_LABELS[prompt.aspect]} · ${prompt.widthPx} × ${prompt.heightPx} px.`,
    `Notebook role: ${IMAGE_GENERATION_ROLE_LABELS[prompt.role]}.`,
    prompt.avoid === undefined ? undefined : `Avoid: ${prompt.avoid}`,
  ];
  return sections.filter((section): section is string => section !== undefined).join('\n');
}

function ImagePromptHandoffCard(props: {
  prompts: readonly ImageGenerationPrompt[];
  onCopy(text: string, message: string): void;
}): JSX.Element {
  const allPrompts = (): string => props.prompts
    .map((prompt, index) => [
      `IMAGE ${index + 1} — ${prompt.slot.placeholder}`,
      promptClipboardText(prompt),
    ].join('\n'))
    .join('\n\n');
  return (
    <Show when={props.prompts.length > 0}>
      <section class="nb-ai-image-handoff" aria-label="Image generation prompts">
        <header>
          <div>
            <span class="nb-ai-card-kicker font-ui">pictures to make elsewhere</span>
            <h4>{props.prompts.length} ready-to-copy {props.prompts.length === 1 ? 'prompt' : 'prompts'}</h4>
          </div>
          <button
            type="button"
            class="nb-ai-copy-all font-ui"
            onClick={() => props.onCopy(allPrompts(), 'Copied all image prompts.')}
          ><CopyIcon /> Copy all</button>
        </header>
        <p>
          I left portable picture slots in the pages because this agent cannot generate
          images. Use any image platform, then click or drop each result into its matching slot.
        </p>
        <div class="nb-ai-image-prompt-list">
          <For each={props.prompts}>
            {(prompt, index) => (
              <article class="nb-ai-image-prompt">
                <div class="nb-ai-image-prompt-number font-ui">{index() + 1}</div>
                <div>
                  <span class="nb-ai-image-prompt-role font-ui">
                    page {prompt.slot.pageNumber} · {IMAGE_GENERATION_ROLE_LABELS[prompt.role]}
                  </span>
                  <strong>{prompt.slot.placeholder}</strong>
                  <p>{prompt.prompt}</p>
                  <div class="nb-ai-image-prompt-meta font-ui">
                    <span>{IMAGE_GENERATION_ASPECT_LABELS[prompt.aspect]}</span>
                    <span>{prompt.widthPx} × {prompt.heightPx} px</span>
                    <Show when={prompt.slot.displayWidthPercent} keyed>
                      {(width) => <span>{width}% page width</span>}
                    </Show>
                  </div>
                  <Show when={prompt.avoid} keyed>
                    {(avoid) => <p class="nb-ai-image-prompt-avoid font-ui"><strong>Avoid:</strong> {avoid}</p>}
                  </Show>
                </div>
                <button
                  type="button"
                  class="nb-ai-image-prompt-copy font-ui"
                  aria-label={`Copy prompt for ${prompt.slot.placeholder}`}
                  onClick={() => props.onCopy(
                    promptClipboardText(prompt),
                    `Copied image prompt ${index() + 1}.`,
                  )}
                ><CopyIcon /> Copy</button>
              </article>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

function RenderedPage(props: { page: AiAgentRenderedPageView }): JSX.Element {
  return (
    <figure class="nb-ai-rendered-page" style={{ '--nb-ai-page-ratio': `${props.page.width} / ${props.page.height}` }}>
      <img src={props.page.renderUrl} alt={props.page.alt ?? `Rendered draft page ${props.page.pageNumber}`} draggable={false} />
      <figcaption class="font-ui">{props.page.label ?? `page ${props.page.pageNumber}`}</figcaption>
    </figure>
  );
}

function FullPreviewSheet(props: {
  preview: AiAgentDraftPreviewView;
  pageIndex: number;
  zoom: 'fit' | number;
  onPage(index: number): void;
  onZoom(zoom: 'fit' | number): void;
  onClose(): void;
}): JSX.Element {
  const page = createMemo(() => props.preview.pages[props.pageIndex] ?? props.preview.pages[0]);
  const numericZoom = (): number => props.zoom === 'fit' ? 0.85 : props.zoom;
  return (
    <Portal>
      <div class="nb-ai-modal-backdrop nb-ai-full-preview-backdrop">
        <section class="nb-ai-full-preview" role="dialog" aria-modal="true" aria-label="Full draft preview">
          <header>
            <button type="button" class="nb-ai-modal-close" aria-label="Close full preview" onClick={props.onClose}><CloseIcon /></button>
            <div><span class="nb-ai-card-kicker font-ui">exact Alcove render</span><h2>{props.preview.title}</h2></div>
            <div class="nb-ai-preview-zoom" role="group" aria-label="Preview zoom">
              <button type="button" aria-label="Zoom out" onClick={() => props.onZoom(Math.max(0.5, numericZoom() - 0.15))}>−</button>
              <button
                type="button"
                class="font-ui nb-ai-zoom-fit"
                aria-label="Fit reviewed page to window"
                aria-pressed={props.zoom === 'fit'}
                onClick={() => props.onZoom('fit')}
              >{props.zoom === 'fit' ? 'fit' : `${Math.round(props.zoom * 100)}%`}</button>
              <button type="button" aria-label="Zoom in" onClick={() => props.onZoom(Math.min(2.25, numericZoom() + 0.15))}>＋</button>
              <button type="button" class="font-ui" onClick={() => props.onZoom(1)}>actual</button>
            </div>
          </header>
          <div class="nb-ai-full-preview-body">
            <aside aria-label="Draft page filmstrip">
              <For each={props.preview.pages}>
                {(item, index) => (
                  <button type="button" classList={{ 'is-active': index() === props.pageIndex }} aria-label={`Open page ${item.pageNumber}`} onClick={() => props.onPage(index())}>
                    <img src={item.renderUrl} alt="" draggable={false} />
                    <span class="font-ui">{item.pageNumber}</span>
                  </button>
                )}
              </For>
            </aside>
            <div class="nb-ai-full-preview-canvas" classList={{ 'is-fit': props.zoom === 'fit' }}>
              <img
                src={page().renderUrl}
                alt={page().alt ?? `Rendered draft page ${page().pageNumber}`}
                draggable={false}
                style={props.zoom === 'fit' ? undefined : { width: `${Math.round(props.zoom * 100)}%` }}
              />
            </div>
          </div>
          <footer class="font-ui">
            <span><strong>Preview only.</strong> No page has been inserted.</span>
            <nav class="nb-ai-full-preview-nav" aria-label="Reviewed page navigation">
              <button
                type="button"
                aria-label="Previous reviewed page"
                disabled={props.pageIndex <= 0}
                onClick={() => props.onPage(Math.max(0, props.pageIndex - 1))}
              >← Previous</button>
              <span>page {page().pageNumber} of {props.preview.pages.length}</span>
              <button
                type="button"
                aria-label="Next reviewed page"
                disabled={props.pageIndex >= props.preview.pages.length - 1}
                onClick={() => props.onPage(Math.min(props.preview.pages.length - 1, props.pageIndex + 1))}
              >Next →</button>
            </nav>
          </footer>
        </section>
      </div>
    </Portal>
  );
}

/* ========================================================================== *
 *                            composer and sources                            *
 * ========================================================================== */

function AttachmentTray(props: {
  attachments: readonly AiAgentAttachmentView[];
  onRemove(id: string): void;
}): JSX.Element {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="nb-ai-attachment-tray" aria-label="Attached sources">
        <For each={props.attachments}>
          {(attachment) => (
            <div class="nb-ai-attachment" data-status={attachment.status}>
              <Show when={attachment.previewUrl} fallback={<span class="nb-ai-attachment-kind"><PageGlyph /></span>}>
                <img src={attachment.previewUrl} alt="" />
              </Show>
              <span class="nb-ai-attachment-copy">
                <strong>{attachment.name}</strong>
                <span class="font-ui">{attachment.kind.toUpperCase()} · {attachment.pages ? `${attachment.pages} pages · ` : ''}{attachment.sizeLabel}</span>
              </span>
              <span class="nb-ai-attachment-state font-ui">{attachment.status}</span>
              <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => props.onRemove(attachment.id)}>×</button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

function ExpandedComposer(props: {
  value: string;
  attachments: readonly AiAgentAttachmentView[];
  direction: AiSpecStylePreset;
  canSend: boolean;
  onInput(value: string): void;
  onPasteAttachment(text: string): void;
  onClose(): void;
  onSend(): void;
  onAttach(): void;
}): JSX.Element {
  let area: HTMLTextAreaElement | undefined;
  queueMicrotask(() => area?.focus());
  return (
    <Portal>
      <div class="nb-ai-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
        <section class="nb-ai-expanded-composer" role="dialog" aria-modal="true" aria-labelledby="nb-ai-expanded-title">
          <header>
            <button type="button" class="nb-ai-modal-close" aria-label="Close large writing sheet" onClick={props.onClose}><CloseIcon /></button>
            <div><span class="nb-ai-card-kicker font-ui">a larger writing desk</span><h2 id="nb-ai-expanded-title">Tell the agent what you need</h2></div>
          </header>
          <div class="nb-ai-expanded-meta">
            <span class="font-ui"><SparkIcon /> {props.direction.name}</span>
            <span class="font-ui"><AttachIcon /> {props.attachments.length} {props.attachments.length === 1 ? 'source' : 'sources'}</span>
          </div>
          <textarea
            ref={area}
            maxlength={12_000}
            value={props.value}
            placeholder="Describe the outcome, important sources, audience, depth, tone, and anything that must be preserved. The agent will ask if a genuinely important detail is missing."
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onPaste={(event) => {
              const text = event.clipboardData?.getData('text/plain') ?? '';
              if (classifyAgentComposerPaste(text).kind !== 'attachment') return;
              event.preventDefault();
              props.onPasteAttachment(text);
            }}
          />
          <footer>
            <span class="font-ui">Your draft and sources stay here when this sheet closes.</span>
            <button type="button" class="nb-ai-secondary-action font-ui" onClick={props.onAttach}><AttachIcon /> Attach</button>
            <button type="button" class="nb-ai-approve-action font-ui" disabled={!props.canSend || props.value.trim() === ''} onClick={props.onSend}><SendIcon /> Give the task</button>
          </footer>
        </section>
      </div>
    </Portal>
  );
}

/* ========================================================================== *
 *                             creative direction                             *
 * ========================================================================== */

function DirectionMenu(props: {
  selectedId: string;
  customDirections: readonly AiSpecStylePreset[];
  onPick(preset: AiSpecStylePreset): void;
  onInspect(): void;
  onClose(): void;
}): JSX.Element {
  createEffect(() => {
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('.nb-ai-direction-control') !== null) return;
      props.onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    onCleanup(() => window.removeEventListener('pointerdown', onDown, true));
  });
  return (
    <div class="nb-ai-direction-menu" role="menu" aria-label="Creative direction">
      <header><span class="nb-ai-card-kicker font-ui">creative direction</span><p class="font-ui">A feeling and quality brief — never a page recipe.</p></header>
      <div class="nb-ai-direction-options">
        <For each={[...AI_SPEC_STYLE_PRESETS, ...props.customDirections]}>
          {(preset) => (
            <button type="button" role="menuitemradio" aria-checked={preset.id === props.selectedId} onClick={() => props.onPick(preset)}>
              <span class="nb-ai-menu-tick" aria-hidden="true">{preset.id === props.selectedId ? '✓' : ''}</span>
              <span><strong>{preset.name}</strong><small>{preset.description}</small></span>
            </button>
          )}
        </For>
      </div>
      <button type="button" class="nb-ai-direction-create font-ui" onClick={props.onInspect}><SparkIcon /> Read, borrow or create a direction…</button>
    </div>
  );
}

function DirectionEditor(props: {
  selected: AiSpecStylePreset;
  customDirections: readonly AiSpecStylePreset[];
  onClose(): void;
  onSave(preset: AiSpecStylePreset): void;
  onDelete(id: string): void;
  onNotify?: (message: string) => void;
}): JSX.Element {
  const [mode, setMode] = createSignal<'inspect' | 'edit'>(props.selected.custom ? 'edit' : 'inspect');
  const [editingId, setEditingId] = createSignal<string | undefined>(props.selected.custom ? props.selected.id : undefined);
  const [name, setName] = createSignal(props.selected.custom ? props.selected.name : 'My creative direction');
  const [baseId, setBaseId] = createSignal(props.selected.basedOn ?? props.selected.id);
  const [prompt, setPrompt] = createSignal(props.selected.prompt);

  const beginBorrow = (): void => {
    setMode('edit');
    setEditingId(undefined);
    setName(`${props.selected.name} — mine`);
    setBaseId(props.selected.id);
    setPrompt(props.selected.prompt);
  };

  const save = (): void => {
    const created = createCustomAiSpecStyle({ id: editingId(), name: name(), prompt: prompt(), basedOn: baseId() });
    if (created === null) {
      props.onNotify?.('Give the direction a name and a little guidance.');
      return;
    }
    props.onSave(created);
  };

  return (
    <Portal>
      <div class="nb-ai-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
        <section class="nb-ai-direction-sheet" role="dialog" aria-modal="true" aria-labelledby="nb-ai-direction-title">
          <header>
            <button type="button" class="nb-ai-modal-close" aria-label="Close creative direction sheet" onClick={props.onClose}><CloseIcon /></button>
            <div><span class="nb-ai-card-kicker font-ui">art director's note</span><h2 id="nb-ai-direction-title">{mode() === 'inspect' ? props.selected.name : editingId() ? 'Edit your direction' : 'Create your direction'}</h2></div>
          </header>
          <Switch>
            <Match when={mode() === 'inspect'}>
              <div class="nb-ai-direction-inspect">
                <p class="nb-ai-direction-lede">{props.selected.description}</p>
                <div class="nb-ai-direction-prompt"><SparkIcon /><p>{props.selected.prompt}</p></div>
                <p class="font-ui">Alcove separately gives the agent the complete page, card, callout, lettering, diagram, sticker, tape and trim catalogue. This note steers taste without dictating furniture.</p>
              </div>
            </Match>
            <Match when={mode() === 'edit'}>
              <div class="nb-ai-direction-fields">
                <label class="font-ui"><span>Name</span><input maxlength={60} value={name()} onInput={(event) => setName(event.currentTarget.value)} /></label>
                <fieldset>
                  <legend class="font-ui">Borrow a starting mood</legend>
                  <div class="nb-ai-borrow-grid">
                    <For each={AI_SPEC_STYLE_PRESETS}>
                      {(preset) => (
                        <button type="button" aria-pressed={baseId() === preset.id} onClick={() => { setBaseId(preset.id); setPrompt(preset.prompt); }}>
                          <strong>{preset.name}</strong><span class="font-ui">{preset.description}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </fieldset>
                <label class="nb-ai-direction-writing font-ui"><span>Your direction</span><textarea rows={12} maxlength={2400} value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} /><small>{prompt().length}/2400 · guide atmosphere, audience, rhythm and quality; leave exact blocks open</small></label>
              </div>
            </Match>
          </Switch>
          <footer>
            <Show when={mode() === 'inspect'} fallback={
              <>
                <Show when={editingId()} keyed>{(id) => <button type="button" class="nb-ai-danger-action font-ui" onClick={() => props.onDelete(id)}>Delete</button>}</Show>
                <span />
                <button type="button" class="nb-ai-change-action font-ui" onClick={props.onClose}>Cancel</button>
                <button type="button" class="nb-ai-approve-action font-ui" onClick={save}><CheckIcon /> Save direction</button>
              </>
            }>
              <span />
              <button type="button" class="nb-ai-change-action font-ui" onClick={props.onClose}>Keep this</button>
              <button type="button" class="nb-ai-approve-action font-ui" onClick={beginBorrow}><SparkIcon /> Borrow & make mine</button>
            </Show>
          </footer>
        </section>
      </div>
    </Portal>
  );
}

/* ========================================================================== *
 *                                key setup                                   *
 * ========================================================================== */

function KeySetupSheet(props: {
  connection: AiAgentConnectionView;
  onClose(): void;
  onSkip(): void;
  onSubmit(input: AiAgentKeySubmission): void;
}): JSX.Element {
  const [kind, setKind] = createSignal<AiAgentKeyKind>('trial');
  const [persistence, setPersistence] = createSignal<AiAgentKeyPersistence>('session');
  const [key, setKey] = createSignal('');
  const [reveal, setReveal] = createSignal(false);
  const [acknowledged, setAcknowledged] = createSignal(false);
  let keyInput: HTMLInputElement | undefined;
  queueMicrotask(() => keyInput?.focus());
  const canSubmit = createMemo(() => {
    const candidate = key().trim();
    return (
      candidate.length >= 16 &&
      candidate.length <= 512 &&
      !/\s/.test(candidate) &&
      /^[\x21-\x7e]+$/.test(candidate) &&
      (kind() === 'production' || acknowledged())
    );
  });
  const submit = (): void => {
    if (!canSubmit()) return;
    const submission: AiAgentKeySubmission = {
      key: key().trim(),
      kind: kind(),
      persistence: persistence(),
      trialPrivacyAcknowledged: acknowledged(),
    };
    props.onSubmit(submission);
    // The WebView has no reason to retain key material after handing it to the
    // secure boundary, even while the controller is validating it.
    setKey('');
    if (keyInput) keyInput.value = '';
  };
  return (
    <Portal>
      <div class="nb-ai-modal-backdrop nb-ai-key-backdrop">
        <section class="nb-ai-key-sheet" role="dialog" aria-modal="true" aria-labelledby="nb-ai-key-title">
          <header>
            <button type="button" class="nb-ai-modal-close" aria-label="Skip AI setup for now" onClick={props.onClose}><CloseIcon /></button>
            <div class="nb-ai-key-lockup">
              <span class="nb-ai-key-mark"><AgentIcon /></span>
              <div><span class="nb-ai-card-kicker font-ui">first use · your own connection</span><h2 id="nb-ai-key-title">Invite the agent into this book</h2></div>
            </div>
          </header>
          <p class="nb-ai-key-intro">Alcove can plan, build and review notebook pages with Cohere. Connecting sends only a credential-validation request; no notebook or source content is sent until you start a task. On localhost, the key stays only in page memory and is forgotten on reload.</p>

          <fieldset class="nb-ai-key-kind">
            <legend class="font-ui">Which key are you using?</legend>
            <button type="button" aria-pressed={kind() === 'trial'} onClick={() => setKind('trial')}>
              <strong>Trial / evaluation</strong><span class="font-ui">Good for trying the workflow with non-sensitive material.</span>
            </button>
            <button type="button" aria-pressed={kind() === 'production'} onClick={() => setKind('production')}>
              <strong>Production / enterprise</strong><span class="font-ui">For your organisation's approved Cohere account.</span>
            </button>
          </fieldset>

          <label class="nb-ai-key-field font-ui">
            <span>Cohere API key</span>
            <div><input ref={keyInput} type={reveal() ? 'text' : 'password'} autocomplete="off" spellcheck={false} placeholder="Paste the key here" onInput={(event) => setKey(event.currentTarget.value)} /><button type="button" onClick={() => setReveal((shown) => !shown)}>{reveal() ? 'hide' : 'show'}</button></div>
            <small>The key leaves this field for the protected app boundary, is cleared here immediately, and never enters your notebooks or agent history.</small>
          </label>

          <fieldset class="nb-ai-key-storage">
            <legend class="font-ui">Keep it for…</legend>
            <button type="button" aria-pressed={persistence() === 'session'} onClick={() => setPersistence('session')}><span class="nb-ai-radio-mark" /> <span><strong>This session</strong><small>Forget it when Alcove closes.</small></span></button>
            <button type="button" aria-pressed={persistence() === 'secure-vault'} onClick={() => setPersistence('secure-vault')}><span class="nb-ai-radio-mark" /> <span><strong>Save securely</strong><small>Use your operating system's credential vault.</small></span></button>
          </fieldset>

          <Show when={kind() === 'trial'}>
            <label class="nb-ai-trial-notice font-ui">
              <input type="checkbox" checked={acknowledged()} onChange={(event) => setAcknowledged(event.currentTarget.checked)} />
              <span><strong>Trial privacy notice</strong> Cohere says trial inputs and outputs may be used for research and development, trial environments should not contain personal information, and its Products are not intended for personal or household use. I will evaluate with non-personal material.</span>
            </label>
          </Show>

          <div class="nb-ai-key-links font-ui">
            <a href="https://dashboard.cohere.com/api-keys" target="_blank" rel="noreferrer">Create or find a Cohere key ↗</a>
            <a href="https://cohere.com/privacy" target="_blank" rel="noreferrer">Cohere privacy policy ↗</a>
            <button type="button" onClick={props.onSkip}>Skip for now</button>
          </div>

          <footer>
            <p class="font-ui"><span aria-hidden="true">◇</span> You always preview the final Alcove pages before anything is inserted.</p>
            <button type="button" class="nb-ai-approve-action font-ui" disabled={!canSubmit() || props.connection.status === 'testing'} onClick={submit}>
              <Show when={props.connection.status === 'testing'} fallback={<><CheckIcon /> Test key & connect</>}><span class="nb-ai-button-spinner" /> Testing safely…</Show>
            </button>
          </footer>
          <Show when={props.connection.status === 'error' && props.connection.message}>
            <p class="nb-ai-key-error font-ui" role="alert">{props.connection.message}</p>
          </Show>
        </section>
      </div>
    </Portal>
  );
}

/* ========================================================================== *
 *                           empty and task drawer                            *
 * ========================================================================== */

function EmptyAgent(props: {
  bookTitle?: string;
  connected: boolean;
  tourPreview?: boolean;
  onConnect(): void;
  onPrompt(text: string): void;
}): JSX.Element {
  return (
    <section class="nb-ai-empty">
      <div class="nb-ai-empty-art" aria-hidden="true"><AgentIcon /><span><SparkIcon /></span></div>
      <span class="nb-ai-card-kicker font-ui">an agent for the open book</span>
      <h3>What should we make together?</h3>
      <p>Describe an outcome in ordinary words. I can explain something with you, study your sources, or build a notebook, inspect every native page and show you one finished preview.</p>
      <div class="nb-ai-starter-grid">
        <button type="button" disabled={!props.connected} onClick={() => props.onPrompt(`Build a clear, beautiful introduction in ${props.bookTitle ?? 'this book'} about `)}><strong>Build a new section</strong><span class="font-ui">from a topic or source</span></button>
        <button type="button" disabled={!props.connected} onClick={() => props.onPrompt('Study the attached material completely, then turn it into ')}><strong>Work from sources</strong><span class="font-ui">images or PDFs, cited</span></button>
        <button type="button" disabled={!props.connected} onClick={() => props.onPrompt('Review the current pages and improve ')}><strong>Improve these pages</strong><span class="font-ui">with a previewed revision</span></button>
      </div>
      <Show when={!props.connected && !props.tourPreview}>
        <button type="button" class="nb-ai-connect-callout font-ui" onClick={props.onConnect}><AgentIcon /> Connect Cohere to begin</button>
      </Show>
      <Show when={props.tourPreview}>
        <p class="nb-ai-tour-preview-note font-ui"><AgentIcon /> This is a quiet preview. Optional setup waits until you open the Agent yourself.</p>
      </Show>
    </section>
  );
}

function ThreadMenu(props: {
  threads: readonly AiAgentThreadView[];
  activeId?: string;
  renameId: string | null;
  renameDraft: string;
  onRenameDraft(value: string): void;
  onClose(): void;
  onSelect(id: string): void;
  onBeginRename(thread: AiAgentThreadView): void;
  onCommitRename(id: string): void;
  onDelete(id: string): void;
}): JSX.Element {
  createEffect(() => {
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('.nb-ai-agent-taskbar') !== null) return;
      props.onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    onCleanup(() => window.removeEventListener('pointerdown', onDown, true));
  });
  return (
    <div class="nb-ai-thread-menu" role="menu" aria-label="AI tasks">
      <header><span class="nb-ai-card-kicker font-ui">tasks in this book</span></header>
      <Show when={props.threads.length > 0} fallback={<p class="font-ui">Your first task will appear here.</p>}>
        <For each={props.threads}>
          {(thread) => (
            <div class="nb-ai-thread-row" classList={{ 'is-active': thread.id === props.activeId }}>
              <Show when={props.renameId === thread.id} fallback={
                <button type="button" class="nb-ai-thread-select" role="menuitem" onClick={() => props.onSelect(thread.id)}>
                  <span><strong>{thread.title}</strong><small class="font-ui">{thread.updatedLabel ?? thread.status}</small></span>
                  <span class="nb-ai-thread-state font-ui">{thread.status}</span>
                </button>
              }>
                <form onSubmit={(event) => { event.preventDefault(); props.onCommitRename(thread.id); }}>
                  <input value={props.renameDraft} maxlength={80} onInput={(event) => props.onRenameDraft(event.currentTarget.value)} />
                  <button type="submit" class="font-ui">save</button>
                </form>
              </Show>
              <div class="nb-ai-thread-row-actions">
                <button type="button" aria-label={`Rename ${thread.title}`} onClick={() => props.onBeginRename(thread)}>✎</button>
                <button type="button" aria-label={`Delete ${thread.title}`} onClick={() => props.onDelete(thread.id)}>×</button>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
