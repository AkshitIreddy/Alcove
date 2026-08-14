/**
 * Deterministic visual-demo bridge for the native AI Agent panel.
 *
 * This module is loaded only after an exact `?fx=force` opt-in. It never calls
 * Cohere, reads a credential or creates a task/source/application row. The
 * prose is a frozen, reviewed Cohere-authored fixture; its page pictures are
 * produced by Alcove's real disposable page renderer. When the filmed reader
 * presses Insert, BookView deliberately sends the frozen Script through its
 * real parser/page insertion seam, then restores the exact pre-demo notebook
 * snapshot during reset. That lets the public film show a truthful write while
 * keeping the fixture deterministic and reversible.
 */
import studyNotesScript from '../../../shots-now/fixtures/ai-agent-study-notes.md?raw';
import huffmanKittensUrl from '../../assets/demo/huffman-kittens.webp?url';
import { createSignal } from 'solid-js';
import type { ReviewedDraftReceiptStore } from '../../data/aiAgentReviewedDraft';
import { webCryptoAgentHash } from '../../features/aiAgent/adapters';
import {
  createProductionDraftSandbox,
  type DraftGenerationMetadataStore,
  type DraftPreviewAssetStore,
  type ProductionDraftSandbox,
  type StoredDraftGeneration,
} from '../../features/aiAgent/draftSandbox';
import type {
  DraftPreviewGeneration,
  NotebookDraft,
  NotebookSnapshotRef,
} from '../../features/aiAgent/types';
import type {
  AiAgentController,
  AiAgentDraftPreviewView,
  AiAgentTimelineItem,
  AiAgentViewState,
} from './AiAgentPanel';

export type AiAgentDemoScenario = 'study-notes' | 'conversation';
export type AiAgentDemoStage =
  | 'idle'
  | 'intake'
  | 'answer'
  | 'plan'
  | 'read'
  | 'draft'
  | 'review'
  | 'ready'
  | 'applying'
  | 'inserted';

export interface AiAgentDemoPublicState {
  readonly scenario: AiAgentDemoScenario;
  readonly stage: AiAgentDemoStage;
  readonly panelOpen: boolean;
  readonly renderedPages: number;
  readonly insertedPages: number;
  readonly fixture: 'frozen-cohere-output';
}

export interface AiAgentDemoPublicBridge {
  state(): AiAgentDemoPublicState;
  open(): void;
  advance(stage?: AiAgentDemoStage): Promise<void>;
  reset(scenario?: AiAgentDemoScenario): Promise<void>;
}

interface DemoBridgeOptions {
  readonly bookTitle: string;
  readonly openPanel: () => void;
  readonly closePanel: () => void;
  readonly insertReviewedPages: (script: string) => Promise<readonly string[]>;
  readonly restoreInsertedPages: () => Promise<boolean>;
}

export interface AiAgentDemoBridgeHandle extends AiAgentDemoPublicBridge {
  readonly controller: AiAgentController;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    __aiAgentDemo?: AiAgentDemoPublicBridge;
  }
}

const EXPLAIN_REQUEST =
  'Can you explain Huffman coding with kittens?';
const BUILD_REQUEST =
  'Great — turn that into three study-note pages and use this kitten infographic.';
const NATURAL_QUESTION =
  'I can turn the explanation above into notebook pages. Is there one detail you definitely want me to preserve?';

const EXPLAIN_ANSWER =
  'Imagine a kitten shelter giving every sound a tag. The loudest regular “meow” gets a tiny tag because staff hear it constantly; a rare squeak can use a longer one. Huffman coding does the same with bits: repeatedly pair the two least-frequent symbols, grow a binary tree, then read each symbol\'s root-to-leaf path. Common symbols end up close to the root, so the whole message becomes shorter, and the leaf paths stay prefix-free so decoding never has to guess. I kept this explanation in our conversation because you asked a question rather than asking me to change the notebook.';

let hydratedStudyNotesScript: string | null = null;

async function studyNotesWithKittenImage(): Promise<string> {
  if (hydratedStudyNotesScript !== null) return hydratedStudyNotesScript;
  const response = await fetch(huffmanKittensUrl);
  if (!response.ok) throw new Error('The local kitten infographic could not be loaded.');
  const localUrl = URL.createObjectURL(await response.blob());
  hydratedStudyNotesScript = studyNotesScript.replace(
    '__HUFFMAN_KITTENS_BLOB_URL__',
    localUrl,
  );
  return hydratedStudyNotesScript;
}

const CONNECTED = {
  status: 'connected' as const,
  provider: 'Cohere' as const,
  keyKind: 'production' as const,
  firstUse: false,
  label: 'Frozen demo fixture — no provider request is made during playback.',
};

const CONTEXT = [
  {
    id: 'current-page',
    label: 'Current page',
    detail: 'Starting scope for this demo task',
    selected: true,
  },
  { id: 'nearby-pages', label: 'Nearby pages', selected: false },
  { id: 'whole-book', label: 'Whole book', selected: false },
] as const;

const DEMO_ATTACHMENT = {
  id: 'demo-source-huffman-kittens',
  name: 'huffman-kittens.png',
  kind: 'image' as const,
  sizeLabel: '1536 × 1024 · attached infographic',
  previewUrl: huffmanKittensUrl,
  status: 'ready' as const,
  detail: 'Owner-supplied source; playback uses a local review derivative and uploads nothing.',
};

const CITATION = {
  id: 'demo-citation-huffman-kittens',
  source: 'Huffman Coding Explained with Kittens',
  locator: 'attached infographic · frequency table and final tree',
  excerpt: 'Meow 0.40 receives code 0; the final set is prefix-free.',
};

function forceEnabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('fx') === 'force'
  );
}

function assertForceEnabled(): void {
  if (!forceEnabled()) {
    throw new Error('The AI Agent demo bridge is available only with an exact ?fx=force opt-in.');
  }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}

function memoryAssetStore(): DraftPreviewAssetStore {
  const values = new Map<string, { bytes: Uint8Array; sha256: string }>();
  return {
    async save(bytes) {
      const stableBytes = Uint8Array.from(bytes);
      const sha256 = hex(await crypto.subtle.digest('SHA-256', stableBytes.buffer));
      const id = `demo-preview-${sha256.slice(0, 32)}`;
      values.set(id, { bytes: bytes.slice(), sha256 });
      return {
        id,
        kind: 'png',
        mimeType: 'image/png',
        sizeBytes: bytes.byteLength,
        sha256,
      };
    },
    async read(resourceId) {
      const value = values.get(resourceId);
      if (value === undefined) throw new Error('The frozen demo preview has been disposed.');
      return {
        metadata: {
          id: resourceId,
          kind: 'png',
          mimeType: 'image/png',
          sizeBytes: value.bytes.byteLength,
          sha256: value.sha256,
        },
        bytes: Array.from(value.bytes),
      };
    },
    async delete(resourceId) {
      return values.delete(resourceId);
    },
  };
}

function memoryGenerationStore(): DraftGenerationMetadataStore {
  const values = new Map<string, StoredDraftGeneration>();
  return {
    get: (id) => values.get(id) ?? null,
    put: (value) => void values.set(value.generation.generationId, value),
    delete: (id) => void values.delete(id),
    list: () => [...values.values()],
  };
}

function memoryReceiptStore(): ReviewedDraftReceiptStore {
  const values = new Map<string, Parameters<ReviewedDraftReceiptStore['put']>[0]>();
  return {
    get: async (id) => values.get(id) ?? null,
    put: async (receipt) => void values.set(receipt.generationId, receipt),
    delete: async (id) => void values.delete(id),
  };
}

function createDemoSandbox(): ProductionDraftSandbox {
  return createProductionDraftSandbox({
    assets: memoryAssetStore(),
    generations: memoryGenerationStore(),
    receipts: memoryReceiptStore(),
  });
}

const PLAN = (active: number): AiAgentTimelineItem => ({
  id: 'demo-plan',
  kind: 'plan',
  title: 'Turn the kitten analogy into three balanced pages',
  revision: 2,
  steps: [
    {
      id: 'demo-plan-read',
      label: 'Inspect the attached infographic',
      detail: 'Verify its frequencies, merge order and final prefix-free codes.',
      status: active > 0 ? 'done' : 'active',
    },
    {
      id: 'demo-plan-draft',
      label: 'Build a three-page lesson',
      detail: 'Overview, tree construction and decoding practice each get a clear job.',
      status: active > 1 ? 'done' : active === 1 ? 'active' : 'pending',
    },
    {
      id: 'demo-plan-review',
      label: 'Inspect every native page',
      detail: 'Repair clipping, dead space, hierarchy and infographic scale.',
      status: active > 2 ? 'done' : active === 2 ? 'active' : 'pending',
    },
  ],
});

function message(
  id: string,
  role: 'reader' | 'agent',
  text: string,
  citeSource = false,
): AiAgentTimelineItem {
  return role === 'agent'
    ? { id, kind: 'message', role, text, ...(citeSource ? { citations: [CITATION] } : {}) }
    : { id, kind: 'message', role, text };
}

/** The supplied image joins the task with the page-building follow-up, not the opening question. */
export function demoAttachmentVisible(sentMessageCount: number): boolean {
  return Number.isFinite(sentMessageCount) && sentMessageCount >= 2;
}

function timelineFor(
  stage: AiAgentDemoStage,
  sent: readonly string[],
  scenario: AiAgentDemoScenario,
): readonly AiAgentTimelineItem[] {
  if (stage === 'idle') return [];
  const first = sent[0] ?? EXPLAIN_REQUEST;
  const second = sent[1] ?? BUILD_REQUEST;
  const out: AiAgentTimelineItem[] = [message('demo-reader-explain', 'reader', first)];
  if (scenario === 'conversation') {
    if (stage === 'intake' && sent.length < 2) return out;
    out.push(message('demo-agent-natural-question', 'agent', NATURAL_QUESTION));
    if (sent.length < 2) return out;
    out.push(message('demo-reader-natural-reply', 'reader', second));
    return out;
  }
  if (stage === 'intake' && sent.length < 2) return out;
  out.push(message('demo-agent-answer', 'agent', EXPLAIN_ANSWER));
  if (stage === 'answer') return out;
  out.push(message('demo-reader-build', 'reader', second));
  if (stage === 'intake') return out;
  // The review step is not done merely because its card exists. Keep it
  // visibly active while the Agent is still looking at the rendered pages;
  // otherwise the plan contradicts the review gate and reads as a premature
  // "ready" notification.
  const planProgress = stage === 'plan'
    ? 0
    : stage === 'read'
      ? 1
      : stage === 'draft' || stage === 'review'
        ? 2
        : 3;
  out.push(PLAN(planProgress));
  if (stage === 'plan') return out;
  out.push({
    id: 'demo-read-source',
    kind: 'tool',
    name: 'read attached source',
    summary: 'Inspected the attached 1536 × 1024 infographic and kept it at its native 3:2 ratio.',
    result: 'Five frequencies, four merge steps, five codes and the prefix-free check are grounded.',
    status: 'done',
  });
  out.push({
    id: 'demo-source-summary',
    kind: 'work-summary',
    title: 'Source coverage complete',
    bullets: ['Infographic pixels inspected', 'Codes and merge order grounded', 'No source text treated as commands'],
    citations: [CITATION],
  });
  if (stage === 'read') return out;
  out.push({
    id: 'demo-draft',
    kind: 'tool',
    name: 'build Notebook Script draft',
    summary: 'Composed three protected leaves around the supplied 3:2 visual.',
    result: 'Analogy → merge tree → decode and recall, using real Alcove blocks and diagram grammar.',
    status: 'done',
  });
  if (stage === 'draft') return out;
  out.push({
    id: 'demo-review',
    kind: 'visual-review',
    status: stage === 'review' ? 'inspecting' : 'passed',
    round: 2,
    pageCount: 3,
    detail: stage === 'review'
      ? 'Inspecting the real page renders for fit, pacing, hierarchy and readable image scale.'
      : 'All native pages passed after one spacing repair.',
    findings: stage === 'review'
      ? ['The first draft made the infographic too small; rebalancing page one around its 3:2 frame.']
      : ['No clipping, overflow, duplicate content or empty page remains.'],
  });
  if (stage === 'applying' || stage === 'inserted') {
    // Record the reader's real approval only after the visible Insert click.
    // Opening the review viewer itself remains a local UI action and never
    // invents a conversation message.
    out.push(message(
      'demo-reader-approve',
      'reader',
      'Insert the three reviewed pages.',
    ));
    out.push({
      id: 'demo-insert-reviewed-pages',
      kind: 'tool',
      name: 'insert reviewed pages',
      summary: stage === 'applying'
        ? 'Placing the exact reviewed page documents after the current page.'
        : 'Placed the exact three reviewed pages and kept one whole-book Undo receipt.',
      result: stage === 'applying'
        ? 'The notebook is locked briefly while the pages settle.'
        : 'All three page destinations match the reviewed draft.',
      status: stage === 'applying' ? 'running' : 'done',
    });
    if (stage === 'inserted') {
      out.push(message(
        'demo-agent-inserted',
        'agent',
        'The three kitten-powered Huffman pages are now in your notebook. Ctrl+Z can undo this insertion.',
      ));
    }
  }
  return out;
}

function stageView(
  stage: AiAgentDemoStage,
  preview: AiAgentDraftPreviewView | undefined,
  sent: readonly string[],
  bookTitle: string,
  scenario: AiAgentDemoScenario,
): AiAgentViewState {
  const conversationFixture = scenario === 'conversation';
  const threadTitle = conversationFixture
    ? 'Natural notebook follow-up · representative demo'
    : 'Huffman coding with kittens · representative demo';
  const working = ['intake', 'plan', 'read', 'draft'].includes(stage);
  const reviewing = stage === 'review';
  const ready = stage === 'ready';
  const applying = stage === 'applying';
  const inserted = stage === 'inserted';
  const progress = stage === 'intake'
    ? 0.12
    : stage === 'plan'
      ? 0.24
      : stage === 'read'
        ? 0.48
        : stage === 'draft'
          ? 0.7
          : stage === 'review'
            ? 0.88
            : ready || applying || inserted || stage === 'answer'
              ? 1
              : undefined;
  const visiblePreview = reviewing && preview !== undefined
    ? {
        ...preview,
        review: {
          ...preview.review,
          status: 'inspecting' as const,
          summary: 'Inspecting the current native renders before the final preview is allowed through.',
          findings: ['The infographic now keeps its 3:2 ratio at a readable page-one scale; checking the repaired render.'],
        },
      }
    : ready || applying
      ? preview
      : undefined;
  return {
    connection: CONNECTED,
    stage: ready
      ? 'ready'
      : applying
        ? 'applying'
        : reviewing
          ? 'reviewing'
          : working
            ? 'working'
            : inserted || stage === 'answer'
              ? 'complete'
              : 'idle',
    headline: conversationFixture && stage === 'answer'
      ? 'Waiting for your reply'
      : ready
        ? 'Three pages are ready for your decision'
        : applying
          ? 'Adding the three reviewed pages'
          : inserted
            ? 'Three reviewed pages were added'
            : reviewing
              ? 'Looking at every page before you do'
              : stage === 'answer'
                ? 'Answered here — the notebook is unchanged'
                : working
                  ? conversationFixture
                    ? 'Shaping your notebook request'
                    : 'Working through the kitten infographic'
                  : 'Frozen demo ready — no request sent',
    workingNote: stage === 'intake'
      ? sent.length < 2
        ? 'Finding a cute way into the idea…'
        : conversationFixture
          ? 'Connecting your reply to the notebook tools…'
          : 'Imagining three little study pages…'
      : undefined,
    progress,
    threadId: 'demo-task-huffman-kittens',
    threadTitle,
    threads: [{
      id: 'demo-task-huffman-kittens',
      title: conversationFixture
        ? 'Natural notebook follow-up · demo'
        : 'Huffman coding with kittens · demo',
      updatedLabel: 'frozen example',
      status: inserted || stage === 'answer' ? 'complete' : ready ? 'paused' : 'active',
    }],
    timeline: timelineFor(stage, sent, scenario),
    attachments: scenario === 'study-notes' && demoAttachmentVisible(sent.length)
      ? [DEMO_ATTACHMENT]
      : [],
    context: CONTEXT,
    preview: visiblePreview,
    canStop: working || reviewing || applying,
    canSend: !working && !reviewing && !ready && !applying,
    composerPlaceholder: conversationFixture && stage === 'answer'
      ? 'Reply naturally in your own words…'
      : ready
      ? 'Describe any changes you want in these reviewed demo pages…'
      : `Ask a question or describe what to make in ${bookTitle}…`,
  };
}

async function renderFixture(
  sandbox: ProductionDraftSandbox,
): Promise<DraftPreviewGeneration> {
  const renderedScript = await studyNotesWithKittenImage();
  const draftHash = await webCryptoAgentHash.digestText(renderedScript);
  const timestamp = '2026-08-13T00:00:00.000Z';
  const draft: NotebookDraft = {
    runId: 'demo-run-huffman-kittens',
    version: 2,
    script: renderedScript,
    draftHash,
    createdAt: timestamp,
  };
  const snapshot: NotebookSnapshotRef = {
    bookId: 'demo-open-book',
    bookRevision: 'demo-book-revision-v1',
    pageIds: [],
    pageRevisions: {},
    capturedAt: timestamp,
  };
  const signal = new AbortController().signal;
  const context = {
    bookSnapshot: snapshot,
    insertionTarget: { kind: 'book_end' as const },
    signal,
  };
  const validation = await sandbox.adapter.validate(draft, context);
  if (!validation.valid) {
    throw new Error('The frozen AI Agent fixture no longer passes Notebook Script validation.');
  }
  const generation = await sandbox.adapter.render(draft, context);
  if (
    !generation.parserValid ||
    !generation.layoutValid ||
    generation.pageCount !== 3 ||
    generation.pages.length !== 3
  ) {
    const summary = generation.diagnostics
      .map((diagnostic) =>
        `${diagnostic.severity}:${diagnostic.code}` +
        `${diagnostic.pageNumber === undefined ? '' : `@page${diagnostic.pageNumber}`}: ` +
        diagnostic.message
      )
      .join(' | ');
    const residual = generation.pages
      .filter((page) => page.residualOverflow)
      .map((page) => page.pageNumber)
      .join(',');
    throw new Error(
      `The frozen AI Agent fixture no longer produces exactly three safe native pages ` +
      `(parser=${generation.parserValid}, layout=${generation.layoutValid}, ` +
      `pages=${generation.pageCount}, residual=${residual || 'none'}` +
      `${summary === '' ? '' : `; ${summary}`}).`,
    );
  }
  return generation;
}

function previewView(
  sandbox: ProductionDraftSandbox,
  generation: DraftPreviewGeneration,
): AiAgentDraftPreviewView {
  return {
    id: 'demo-preview-huffman-kittens-v3',
    version: 2,
    title: 'Huffman Coding with Kittens',
    summary: 'A readable 3:2 source visual, the exact merge tree and a compact decode-and-check page.',
    pages: generation.pages.map((page) => ({
      id: page.pageId,
      pageNumber: page.pageNumber,
      label: `study page ${page.pageNumber}`,
      renderUrl: sandbox.renderUrlFor(page.image),
      width: page.width,
      height: page.height,
      alt: `Native Alcove render of the kitten Huffman study-note fixture, page ${page.pageNumber}`,
      sourceCitationIds: [CITATION.id],
    })),
    affectedPageCount: generation.pageCount,
    parser: { status: 'passed', label: 'Script clean' },
    layout: { status: 'passed', label: 'Fixed pages fit' },
    review: {
      status: 'passed',
      round: 2,
      summary: 'Every current native render was inspected. The infographic was kept at a legible 3:2 scale and the construction table was balanced in the second pass; no clipping, empty page, duplicate section or unresolved overflow remains.',
      findings: ['The supplied infographic is already placed; no external image prompt or empty picture slot was added.'],
      checkedAt: '2026-08-13T00:00:00.000Z',
    },
    citations: [CITATION],
    imageGenerationPrompts: [],
    placements: [
      {
        id: 'after-current-page',
        label: 'After the current page',
        detail: 'Start these reviewed leaves on the next page.',
      },
      {
        id: 'book-end',
        label: 'At the end',
        detail: 'Append them after the final written page.',
      },
    ],
    placementId: 'after-current-page',
    assumptions: [
      'Beginner audience; tree and prefix-free terminology are introduced in plain language.',
      'The attached infographic is source material and is reused at its original 3:2 aspect ratio.',
    ],
    isolated: true,
  };
}

/** Create a private controller plus the four deliberately tiny QA commands. */
export function createAiAgentDemoBridge(options: DemoBridgeOptions): AiAgentDemoBridgeHandle {
  assertForceEnabled();
  let scenario: AiAgentDemoScenario = 'study-notes';
  let stage: AiAgentDemoStage = 'idle';
  let panelOpen = false;
  let sandbox: ProductionDraftSandbox | null = null;
  let preview: AiAgentDraftPreviewView | undefined;
  let sent: string[] = [];
  let insertedPageIds: readonly string[] = [];
  let insertionPromise: Promise<readonly string[]> | null = null;
  let disposed = false;
  const [readState, publishState] = createSignal<AiAgentViewState>(
    stageView(stage, preview, sent, options.bookTitle, scenario),
  );

  const publish = (): void => {
    if (disposed) return;
    publishState(stageView(stage, preview, sent, options.bookTitle, scenario));
  };

  const disposeSandbox = async (): Promise<void> => {
    const prior = sandbox;
    sandbox = null;
    preview = undefined;
    if (prior === null) return;
    await prior.disposeAll();
    prior.releaseUrls();
  };

  const reset = async (nextScenario: AiAgentDemoScenario = 'study-notes'): Promise<void> => {
    assertForceEnabled();
    if (disposed) throw new Error('The AI Agent demo bridge has been disposed.');
    options.closePanel();
    panelOpen = false;
    if (insertionPromise !== null) await insertionPromise.catch(() => []);
    const hadInsertedPages = insertedPageIds.length > 0;
    if (hadInsertedPages) {
      const restored = await options.restoreInsertedPages();
      if (!restored) {
        throw new Error('The AI Agent demo could not restore its reversible page insertion.');
      }
    }
    insertedPageIds = [];
    insertionPromise = null;
    await disposeSandbox();
    scenario = nextScenario;
    stage = 'idle';
    sent = [];
    publish();
  };

  const advance = async (nextStage?: AiAgentDemoStage): Promise<void> => {
    assertForceEnabled();
    if (disposed) throw new Error('The AI Agent demo bridge has been disposed.');
    const order: readonly AiAgentDemoStage[] = [
      'idle',
      'intake',
      'answer',
      'plan',
      'read',
      'draft',
      'review',
      'ready',
      'applying',
      'inserted',
    ];
    const next = nextStage ?? order[Math.min(order.length - 1, order.indexOf(stage) + 1)]!;
    if ((next === 'review' || next === 'ready') && preview === undefined) {
      if (scenario !== 'study-notes') throw new Error('Conversation-only demo has no notebook preview.');
      sandbox ??= createDemoSandbox();
      preview = previewView(sandbox, await renderFixture(sandbox));
    }
    stage = next;
    publish();
  };

  const controller: AiAgentController = {
    state: readState,
    send: (text) => {
      assertForceEnabled();
      const clean = text.trim();
      if (clean === '') return;
      sent = [...sent, clean].slice(-2);
      stage = 'intake';
      publish();
    },
    startNewTask: () => void reset(scenario),
    stop: () => {
      stage = 'idle';
      publish();
    },
    retry: () => void advance('plan'),
    setPlacement: () => undefined,
    requestChanges: () => undefined,
    approveInsert: () => {
      if ((stage !== 'ready' && stage !== 'applying') || insertedPageIds.length > 0) return;
      if (hydratedStudyNotesScript === null) {
        throw new Error('The reviewed kitten fixture has not been rendered yet.');
      }
      stage = 'applying';
      publish();
      insertionPromise = options.insertReviewedPages(hydratedStudyNotesScript);
      void insertionPromise.then((pageIds) => {
        if (disposed) return;
        if (pageIds.length !== 3) {
          throw new Error(`The demo inserted ${pageIds.length} pages instead of the three reviewed pages.`);
        }
        insertedPageIds = pageIds;
        stage = 'inserted';
        publish();
      }).catch((error) => {
        if (disposed) return;
        stage = 'ready';
        publishState({
          ...stageView(stage, preview, sent, options.bookTitle, scenario),
          error: {
            title: 'Could not place the demo pages',
            detail: error instanceof Error ? error.message : 'The reversible demo insertion failed.',
            retryable: true,
          },
        });
      });
    },
    copyText: async (text) => {
      await navigator.clipboard.writeText(text);
    },
    copyDiagnosticLog: async () => {
      await navigator.clipboard.writeText(JSON.stringify({
        logVersion: 1,
        notice: 'Frozen offline demo trace. No provider request or saved API credential exists.',
        scenario,
        stage,
        sent,
        renderedPages: preview?.pages.length ?? 0,
        insertedPages: insertedPageIds.length,
      }, null, 2));
    },
  };

  const handle: AiAgentDemoBridgeHandle = {
    controller,
    state: () => ({
      scenario,
      stage,
      panelOpen,
      renderedPages: preview?.pages.length ?? 0,
      insertedPages: insertedPageIds.length,
      fixture: 'frozen-cohere-output',
    }),
    open: () => {
      assertForceEnabled();
      panelOpen = true;
      options.openPanel();
    },
    advance,
    reset,
    async dispose() {
      if (disposed) return;
      disposed = true;
      options.closePanel();
      panelOpen = false;
      if (insertionPromise !== null) await insertionPromise.catch(() => []);
      const hadInsertedPages = insertedPageIds.length > 0;
      if (hadInsertedPages) {
        const restored = await options.restoreInsertedPages();
        if (!restored) {
          throw new Error('The AI Agent demo could not restore its reversible page insertion.');
        }
      }
      insertedPageIds = [];
      insertionPromise = null;
      await disposeSandbox();
    },
  };
  publish();
  return handle;
}
