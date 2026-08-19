import { z } from 'zod';
import { parseNotebookScriptPages } from '../../editor/script/pageBoundaries';
import type { AgentAdapters, DraftSandboxTargetPage } from './adapters';
import {
  createSourceCoverageLedger,
  createVisualReviewLedger,
  recordRelevantUnits,
  recordSourceCitations,
  recordSourceReads,
  recordVisualImageExposures,
  recordVisualInspection,
  readerEvidenceUnitIds,
  sourceUnitsUnobservedBeforeProviderCall,
  visualImageExposurePageIds,
} from './coverage';
import {
  normalizeNotebookScriptSubmission,
  withNotebookCraftValidation,
} from './draftCraft';
import type { AgentEventBus } from './events';
import {
  generationIdsOwnedByState,
  localFinalGenerationIdsOwnedByState,
} from './generationOwnership';
import {
  buildImagePromptHandoff,
  extractPortableImageSlots,
  imagePromptHandoffMatchesDraft,
} from './imageHandoff';
import {
  assertPortableImagesRequested,
  explicitImageRequest,
} from './imageIntent';
import {
  agentRequestsNotebookMutation,
  currentAgentObjectiveMode,
  latestReaderText,
  readerRequestsConciseAttachedImage,
  readerIntentHint,
  readerRequiresCompleteSourceCoverage,
  readerRequiresSourceEvidence,
} from './intent';
import type { AgentToolDescriptor } from './provider';
import {
  buildPatchProposal,
  buildUserPreviewContract,
  canCompleteConversation,
  canExecuteTool,
  canSubmitNotebookPatch,
  repairPassesInBudgetWindow,
} from './policy';
import { planAdaptiveRetrieval } from './retrieval';
import { notebookPageOrderExtendsSnapshot } from './productionNotebook';
import {
  applyConciseManagedImageLayout,
  applyDominantManagedImageLayout,
  applyVagueManagedImageDefault,
  ensureRequiredManagedImagesInNotebookScript,
  missingRequiredManagedImageAssetPaths,
} from './sourceAssetPolicy';
import {
  assertPrivatePlaceholdersRestorable,
  obfuscatePageDocument,
  restorePrivateJson,
  restorePrivateText,
} from './textPrivacy';
import {
  normalizedVisualFindingSeverity,
  visualFindingRequiresRepair,
} from './visualFindingPolicy';
import type {
  AgentConversationMessage,
  AgentImageRef,
  AgentInterrupt,
  AgentJsonValue,
  AgentModelToolCall,
  AgentObjectiveMode,
  AgentResumeValue,
  AgentState,
  AgentToolBudget,
  DraftPreviewGeneration,
  DraftVisualFinding,
  DraftVisualReviewLedger,
  NotebookInsertionTarget,
  NotebookScriptDiagnostic,
  RetrievalHit,
  SourceRead,
  SourceCitation,
} from './types';

const MAX_PROVIDER_IMAGES_PER_TURN = 20;
const UNCHANGED_DRAFT_SUBMISSION_ERROR =
  'this Notebook Script is identical to the current draft; do not repeat it—make a material change that addresses the current diagnostics, visual finding or reader feedback first';
const NOTEBOOK_CONTENT_STALE_ERROR =
  'The notebook changed after it was inspected. Inspect it again, then rerender and review the draft.';
const NOTEBOOK_ORDER_STALE_ERROR =
  'The notebook page order changed after it was inspected. Inspect it again, then rerender and review the draft.';
const SOURCE_INPUT_STALE_ERROR =
  'A live notebook source changed after it was read. List the source manifest again and repeat the required reads.';
const PRIVATE_RESTORE_REPAIR_PREFIX =
  'The local private-text preview could not be prepared safely: ';

interface ToolFailureOptions {
  readonly errorCode?: string;
  readonly nextAction?: string;
  readonly suggestedTools?: readonly string[];
  readonly stateChanged?: boolean;
}

class ToolRecoveryError extends Error {
  constructor(
    message: string,
    readonly recovery: ToolFailureOptions,
  ) {
    super(message);
    this.name = 'ToolRecoveryError';
  }
}

function boundedToolFailureMessage(error: unknown): string {
  const limit = 1_200;
  const clean = (value: string): string => value
    .replace(/\bBearer\s+[^\s"']+/giu, 'Bearer [redacted]')
    .slice(0, limit);
  if (error instanceof Error && error.message.trim() !== '') {
    return clean(error.message.trim());
  }
  if (typeof error === 'string' && error.trim() !== '') return clean(error.trim());
  if (error !== null && typeof error === 'object') {
    const message = Reflect.get(error, 'message');
    if (typeof message === 'string' && message.trim() !== '') {
      return clean(message.trim());
    }
    try {
      const serialized = JSON.stringify(error, (key, value) =>
        /(?:api.?key|authorization|credential|secret|token)/iu.test(key)
          ? '[redacted]'
          : value,
      );
      if (serialized !== undefined && serialized !== '{}') return clean(serialized);
    } catch {
      // Fall through to the safe type-only description below.
    }
  }
  return `tool failed with ${Object.prototype.toString.call(error)}`;
}

function trailingToolImageCount(state: AgentState): number {
  let count = 0;
  for (let index = state.modelHistory.length - 1; index >= 0; index -= 1) {
    const turn = state.modelHistory[index];
    if (turn?.role !== 'tool') break;
    count += turn.imageRefs?.length ?? 0;
  }
  return count;
}

export interface AgentToolContext {
  readonly adapters: AgentAdapters;
  readonly events: AgentEventBus;
  readonly signal: AbortSignal;
  /** Exact model-authored call currently being executed. */
  readonly call?: AgentModelToolCall;
}

export interface AgentToolExecution {
  readonly state: AgentState;
  readonly result: AgentJsonValue;
  readonly summary: string;
  readonly imageRefs?: readonly AgentImageRef[];
  readonly imagePurpose?: 'source_analysis' | 'draft_visual_review';
  readonly interrupt?: AgentInterrupt;
}

interface ToolDefinition<Input> {
  readonly descriptor: AgentToolDescriptor;
  readonly schema: z.ZodType<Input>;
  execute(
    state: AgentState,
    input: Input,
    context: AgentToolContext,
  ): Promise<AgentToolExecution>;
}

function json(value: unknown): AgentJsonValue {
  return value as AgentJsonValue;
}

function providerPageInspection(
  page: Awaited<ReturnType<AgentAdapters['notebook']['inspectPage']>>,
): Omit<typeof page, 'document'> {
  const { document: _exactLocalDocument, ...visible } = page;
  return visible;
}

async function exactSandboxTarget(
  state: AgentState,
  context: AgentToolContext,
  visibility: 'provider_review' | 'local_final' = 'provider_review',
): Promise<{
  readonly targetPage: DraftSandboxTargetPage | undefined;
  readonly textPrivacy: AgentState['textPrivacy'];
}> {
  const target = state.insertionTarget;
  const snapshot = state.notebookSnapshot;
  if (
    snapshot === undefined ||
    target === undefined ||
    (target.kind !== 'caret' && target.kind !== 'replace_selection')
  ) {
    return { targetPage: undefined, textPrivacy: state.textPrivacy };
  }
  const page = await context.adapters.notebook.inspectPage(target.pageId, context.signal);
  if (page.document === undefined) {
    throw new Error(
      'This notebook adapter cannot expose the exact target page to the local preview sandbox.',
    );
  }
  if (
    snapshot.pageRevisions[target.pageId] !== page.revision ||
    (await context.adapters.hash.digestJson(page.document)) !== page.documentDigest
  ) {
    throw new Error(
      'The target page changed before the integrated preview could be rendered. Inspect the notebook again.',
    );
  }
  if (visibility === 'provider_review' && state.textPrivacy !== undefined) {
    const transformed = obfuscatePageDocument(
      page.document,
      state.textPrivacy,
      context.adapters.clock.now(),
    );
    return {
      targetPage: {
        pageId: page.pageId,
        revision: page.revision,
        documentDigest: await context.adapters.hash.digestJson(transformed.value),
        doc: transformed.value,
      },
      textPrivacy: transformed.receipt,
    };
  }
  return { targetPage: {
    pageId: page.pageId,
    revision: page.revision,
    documentDigest: page.documentDigest,
    doc: page.document,
  }, textPrivacy: state.textPrivacy };
}

function schemaJson(schema: z.ZodType): Readonly<Record<string, AgentJsonValue>> {
  const raw = z.toJSONSchema(schema) as Record<string, unknown>;
  /**
   * Cohere strict tools accept a deliberately small JSON-Schema vocabulary
   * and require every declared object property to appear in `required`.
   * Optional/defaulted local fields therefore travel as required-but-nullable
   * fields; `transportArguments` removes those null sentinels before the full
   * local Zod schema applies defaults and kind-specific validation.
   */
  const nullable = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { anyOf: [value, { type: 'null' }] };
    }
    const node = value as Record<string, unknown>;
    if (Array.isArray(node.anyOf)) {
      return {
        ...node,
        anyOf: [...node.anyOf, { type: 'null' }],
      };
    }
    if (typeof node.type === 'string') {
      return { ...node, type: [node.type, 'null'] };
    }
    if (Array.isArray(node.type)) {
      return node.type.includes('null')
        ? node
        : { ...node, type: [...node.type, 'null'] };
    }
    return { anyOf: [node, { type: 'null' }] };
  };
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value === null || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      if (
        key === '$schema' ||
        key === 'minimum' || key === 'maximum' ||
        key === 'exclusiveMinimum' || key === 'exclusiveMaximum' ||
        key === 'minItems' || key === 'maxItems' ||
        key === 'minLength' || key === 'maxLength' ||
        key === 'pattern' || key === 'format' ||
        key === 'default'
      ) continue;
      out[key] = sanitize(child);
    }
    if (
      out.properties !== null &&
      typeof out.properties === 'object' &&
      !Array.isArray(out.properties)
    ) {
      const properties = out.properties as Record<string, unknown>;
      const originallyRequired = new Set(
        Array.isArray(out.required)
          ? out.required.filter((item): item is string => typeof item === 'string')
          : [],
      );
      for (const key of Object.keys(properties)) {
        if (!originallyRequired.has(key)) {
          properties[key] = nullable(properties[key]);
        }
      }
      out.required = Object.keys(properties);
    }
    return out;
  };
  return sanitize(raw) as Readonly<Record<string, AgentJsonValue>>;
}

/** Convert Cohere's required nullable sentinels back to local optional fields. */
function transportArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(transportArguments);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === null) continue;
    out[key] = transportArguments(child);
  }
  return out;
}

function definition<Input>(input: {
  readonly name: string;
  readonly description: string;
  readonly effect: AgentToolDescriptor['effect'];
  readonly schema: z.ZodType<Input>;
  execute(
    state: AgentState,
    args: Input,
    context: AgentToolContext,
  ): Promise<AgentToolExecution>;
}): ToolDefinition<Input> {
  return {
    descriptor: {
      name: input.name,
      description: input.description,
      effect: input.effect,
      inputSchema: schemaJson(input.schema),
    },
    schema: input.schema,
    execute: input.execute,
  };
}

function touch(
  state: AgentState,
  context: AgentToolContext,
  update: Partial<AgentState>,
): AgentState {
  return {
    ...state,
    ...update,
    checkpointStep: state.checkpointStep + 1,
    updatedAt: context.adapters.clock.now(),
    cancellation: {
      ...state.cancellation,
      lastSafeCheckpointStep: state.checkpointStep + 1,
    },
  };
}

function currentCoverage(state: AgentState, now: string) {
  if (state.sourceManifest === undefined) return undefined;
  return (
    state.sourceCoverage ??
    createSourceCoverageLedger(
      state.sourceManifest,
      state.taskBrief.preserveAllSourceInformation ? 'complete' : 'relevant',
      now,
    )
  );
}

const NOTEBOOK_OBJECTIVE_TOOLS = new Set([
  'set_plan',
  'inspect_notebook',
  'inspect_page',
  'inspect_page_range',
  'inspect_selection',
  'propose_insertion',
  'submit_notebook_script',
  'validate_notebook_script',
  'render_draft_preview',
  'read_draft_preview_pages',
  'record_visual_review',
  'prepare_image_generation_prompts',
  'propose_notebook_patch',
  'submit_notebook_patch',
]);

function objectiveModeForTool(toolName: string): Exclude<AgentObjectiveMode, 'undecided'> | undefined {
  if (toolName === 'finish_conversation') return 'conversation';
  return NOTEBOOK_OBJECTIVE_TOOLS.has(toolName) ? 'notebook_change' : undefined;
}

function settleObjectiveForTool(
  state: AgentState,
  toolName: string,
  now: string,
): AgentState {
  if (currentAgentObjectiveMode(state) !== 'undecided') return state;
  const mode = objectiveModeForTool(toolName);
  if (mode === undefined) return state;
  const turnId = state.budgetWindow?.readerMessageId ??
    state.objective?.turnId ?? state.conversation[0]?.id ?? state.identity.runId;
  return {
    ...state,
    objective: {
      turnId,
      mode,
      decidedBy: 'model_action',
      reason: `Selected ${toolName}`,
      decidedAt: now,
    },
  };
}

function objectiveConflict(
  state: AgentState,
  toolName: string,
): {
  readonly attemptedMode: Exclude<AgentObjectiveMode, 'undecided'>;
  readonly hintedMode: Exclude<AgentObjectiveMode, 'undecided'>;
} | null {
  if (currentAgentObjectiveMode(state) !== 'undecided' || toolName === 'set_task_mode') {
    return null;
  }
  const attemptedMode = objectiveModeForTool(toolName);
  const hint = readerIntentHint(state);
  if (
    attemptedMode === undefined || hint === 'undecided' ||
    attemptedMode === hint
  ) return null;
  return { attemptedMode, hintedMode: hint };
}

/**
 * A plan may change after the reader answers or material work advances, not
 * merely because the model found new wording. Keeping this deliberately free
 * of clocks, usage counters, plan versions and lifecycle phases prevents
 * plan-only loops from manufacturing their own “progress”.
 */
function compactObservationDigest(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

const MATERIAL_OBSERVATION_TOOLS = new Set([
  'inspect_notebook',
  'inspect_page',
  'inspect_page_range',
  'inspect_selection',
  'list_source_manifest',
  'plan_source_retrieval',
  'read_source_range',
  'read_full_source',
  'search_source_index',
  'rerank_source_hits',
  'inspect_source_coverage',
]);

export function materialWorkFingerprint(state: AgentState): string {
  const latestConversationMessage = state.conversation[state.conversation.length - 1];
  const distinctObservations = [...new Set(currentReaderModelTurns(state).flatMap(
    (turn) => turn.role === 'tool' && !turn.isError &&
        MATERIAL_OBSERVATION_TOOLS.has(turn.toolName)
      ? [compactObservationDigest({ toolName: turn.toolName, content: turn.content })]
      : [],
  ))].sort();
  return JSON.stringify({
    latestConversationMessageId: latestConversationMessage?.id ?? null,
    notebookRevision: state.notebookSnapshot?.bookRevision ?? null,
    sourceManifestDigest: state.sourceManifest?.digest ?? null,
    readUnitIds: state.sourceCoverage?.readUnitIds ?? [],
    citedUnitIds: state.sourceCoverage?.citedUnitIds ?? [],
    distinctObservations,
    draftHash: state.draft?.draftHash ?? null,
    draftVersion: state.draft?.version ?? null,
    insertionTarget: state.insertionTarget ?? null,
    validation: state.validation === undefined
      ? null
      : { draftHash: state.validation.draftHash, valid: state.validation.valid },
    previewGenerationId: state.previewGeneration?.generationId ?? null,
    previewStale: state.previewGeneration?.stale ?? null,
    previewImageExposures: (state.visualReview?.imageExposures ?? [])
      .map((exposure) => ({
        generationId: exposure.generationId,
        pageId: exposure.pageId,
        imageDigest: exposure.imageDigest,
        layoutDigest: exposure.layoutDigest,
      }))
      .sort((left, right) => left.pageId.localeCompare(right.pageId)),
    inspectedPreviewPageIds: state.visualReview?.inspectedPageIds ?? [],
    visualReviewPassed: state.visualReview?.passed ?? null,
    patch: state.patchProposal === undefined
      ? null
      : { patchId: state.patchProposal.patchId, status: state.patchProposal.status },
    renderRecovery: state.renderRecovery === undefined
      ? null
      : { draftHash: state.renderRecovery.draftHash, message: state.renderRecovery.message },
  });
}

async function buildLocalRestoredFinal(
  state: AgentState,
  context: AgentToolContext,
): Promise<AgentState['localRestoredFinal']> {
  const privacy = state.textPrivacy;
  const maskedDraft = state.draft;
  if (privacy === undefined || privacy.entries.length === 0 || maskedDraft === undefined) {
    return undefined;
  }
  const cached = state.localRestoredFinal;
  if (
    cached !== undefined &&
    cached.maskedDraftHash === maskedDraft.draftHash &&
    cached.previewGeneration.bookSnapshotRevision === state.notebookSnapshot?.bookRevision &&
    !cached.previewGeneration.stale
  ) {
    return cached;
  }
  if (state.notebookSnapshot === undefined || state.insertionTarget === undefined) {
    throw new Error('notebook snapshot and insertion target are required');
  }
  const now = context.adapters.clock.now();
  assertPrivatePlaceholdersRestorable(maskedDraft.script, privacy);
  const restoredScript = restorePrivateText(maskedDraft.script, privacy);
  const restoredHash = await context.adapters.hash.digestText(restoredScript);
  const draft = {
    ...maskedDraft,
    script: restoredScript,
    draftHash: restoredHash,
    createdAt: now,
  };
  const rawTarget = await exactSandboxTarget(state, context, 'local_final');
  const validation = withNotebookCraftValidation(
    await context.adapters.sandbox.validate(draft, {
      bookSnapshot: state.notebookSnapshot,
      insertionTarget: state.insertionTarget,
      targetPage: rawTarget.targetPage,
      signal: context.signal,
    }),
    draft.script,
    state,
  );
  if (!validation.valid || validation.draftHash !== restoredHash) {
    throw new Error(
      'Restoring masked text changed the Notebook Script structure. Alcove kept the masked review and did not prepare an unsafe final preview.',
    );
  }
  const previewGeneration = await context.adapters.sandbox.render(draft, {
    bookSnapshot: state.notebookSnapshot,
    insertionTarget: state.insertionTarget,
    targetPage: rawTarget.targetPage,
    signal: context.signal,
  });
  try {
    if (
      previewGeneration.draftHash !== restoredHash ||
      !previewGeneration.parserValid ||
      !previewGeneration.layoutValid ||
      previewGeneration.stale
    ) {
      throw new Error(
        'Restored private text did not fit the validated fixed-page layout. Alcove did not show or apply a mismatched preview.',
      );
    }
    const imagePromptHandoff = state.imagePromptHandoff === undefined
      ? undefined
      : (() => {
          for (const prompt of state.imagePromptHandoff.prompts) {
            assertPrivatePlaceholdersRestorable(prompt.prompt, privacy);
            if (prompt.avoid !== undefined) {
              assertPrivatePlaceholdersRestorable(prompt.avoid, privacy);
            }
          }
          return buildImagePromptHandoff({
          draftHash: restoredHash,
          script: restoredScript,
          prompts: state.imagePromptHandoff.prompts.map((prompt) => ({
            slotId: prompt.slot.slotId,
            role: prompt.role,
            aspect: prompt.aspect,
            prompt: restorePrivateText(prompt.prompt, privacy),
            ...(prompt.avoid === undefined
              ? {}
              : { avoid: restorePrivateText(prompt.avoid, privacy) }),
          })),
          now,
          });
        })();
    if (
      cached !== undefined &&
      cached.previewGeneration.generationId !== previewGeneration.generationId
    ) {
      await context.adapters.sandbox.dispose(cached.previewGeneration.generationId);
    }
    return {
      maskedDraftHash: maskedDraft.draftHash,
      draft,
      validation,
      previewGeneration,
      imagePromptHandoff,
      finalizedAt: now,
    };
  } catch (error) {
    // A restored render contains the exact local private values. If any
    // post-render invariant fails before state can own it, destroy it here.
    await context.adapters.sandbox.dispose(previewGeneration.generationId)
      .catch(() => undefined);
    throw error;
  }
}

function sourceCapability(state: AgentState) {
  if (state.sourceManifest === undefined) throw new Error('list the source manifest first');
  return {
    taskId: state.identity.taskId,
    manifestDigest: state.sourceManifest.digest,
  };
}

function requireManifestSource(state: AgentState, sourceId: string): void {
  if (!state.sourceManifest?.sources.some((source) => source.id === sourceId)) {
    throw new Error('That source is not part of the current task manifest');
  }
}

/** Final asynchronous freshness gate; policy's remaining checks are pure. */
async function assertSubmissionInputsFresh(
  state: AgentState,
  context: AgentToolContext,
): Promise<void> {
  if (state.notebookSnapshot === undefined || state.sourceManifest === undefined) {
    throw new Error('inspect the current notebook and source manifest first');
  }
  const sourceAuthorityUsed =
    readerRequiresSourceEvidence(state) ||
    (state.sourceCoverage?.citedUnitIds.length ?? 0) > 0;
  const [notebook, manifest] = await Promise.all([
    context.adapters.notebook.inspectNotebook(state.identity.bookId, context.signal),
    sourceAuthorityUsed
      ? context.adapters.sources.getManifest(state.identity.taskId, context.signal)
      : Promise.resolve(state.sourceManifest),
  ]);
  if (notebook.snapshot.bookRevision !== state.notebookSnapshot.bookRevision) {
    throw new Error(NOTEBOOK_CONTENT_STALE_ERROR);
  }
  if (!notebookPageOrderExtendsSnapshot(
    state.notebookSnapshot.pageIds,
    notebook.snapshot.pageIds,
  )) {
    throw new Error(NOTEBOOK_ORDER_STALE_ERROR);
  }
  if (sourceAuthorityUsed && manifest.digest !== state.sourceManifest.digest) {
    throw new Error(SOURCE_INPUT_STALE_ERROR);
  }
}

function parserDiagnostics(source: string): {
  readonly pageCount: number;
  readonly blockCount: number;
  readonly diagnostics: readonly NotebookScriptDiagnostic[];
} {
  const parsed = parseNotebookScriptPages(source);
  return {
    pageCount: parsed.pages.length,
    blockCount: parsed.preview.blocks.length,
    diagnostics: parsed.preview.diagnostics.map((diagnostic) => ({
      severity: 'warning',
      code: diagnostic.code,
      message: diagnostic.message,
      line: diagnostic.line,
      column: diagnostic.column,
    })),
  };
}

function visualReviewLedgerIsDerivedConsistently(
  ledger: DraftVisualReviewLedger,
  generation: DraftPreviewGeneration,
): boolean {
  if (
    ledger.generationId !== generation.generationId ||
    ledger.draftHash !== generation.draftHash
  ) return false;
  const expectedPageIds = [...new Set(
    generation.pages.map((page) => page.pageId),
  )].sort();
  const requiredPageIds = [...new Set(ledger.requiredPageIds)].sort();
  if (
    expectedPageIds.length !== generation.pages.length ||
    requiredPageIds.length !== ledger.requiredPageIds.length ||
    JSON.stringify(requiredPageIds) !== JSON.stringify(expectedPageIds)
  ) return false;
  const expected = new Set(expectedPageIds);
  if (ledger.inspectedPageIds.some((pageId) => !expected.has(pageId))) return false;
  if (ledger.findings.some(
    (finding) =>
      finding.generationId !== generation.generationId ||
      !expected.has(finding.pageId),
  )) return false;
  const inspected = new Set(ledger.inspectedPageIds);
  const complete = ledger.requiredPageIds.every((pageId) => inspected.has(pageId));
  const blocking = ledger.findings.some(
    (finding) => finding.severity === 'blocking' && !finding.resolved,
  );
  const passed = complete && generation.layoutValid && !blocking;
  return ledger.complete === complete && ledger.passed === passed;
}

// Cohere strict tool schemas require at least one required parameter. A
// required literal keeps no-input actions strict and self-documenting without
// weakening local Zod validation.
const emptySchema = z.object({ request: z.literal('current') }).strict();
const taskModeSchema = z.object({
  mode: z.enum(['conversation', 'notebook_change']),
  reason: z.string().min(1).max(240),
}).strict();
const inspectPageSchema = z.object({ pageId: z.string().min(1) }).strict();
const inspectPageRangeSchema = z
  .object({
    startOrdinal: z.number().int().nonnegative(),
    endOrdinal: z.number().int().nonnegative(),
  })
  .strict();
const readSourceRangeSchema = z
  .object({
    sourceId: z.string().min(1),
    startOrdinal: z.number().int().nonnegative(),
    endOrdinal: z.number().int().nonnegative(),
  })
  .strict();
const readFullSourceSchema = z.object({ sourceId: z.string().min(1) }).strict();
const planRetrievalSchema = z
  .object({
    request: z.literal('plan'),
    sourceIds: z.array(z.string().min(1)).optional(),
    preserveAllInformation: z.boolean().optional(),
  })
  .strict();
const searchSchema = z
  .object({
    query: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).optional(),
    limit: z.number().int().min(1).max(80).default(36),
  })
  .strict();
const sourceAnchorSchema = z
  .object({
    sourceId: z.string(),
    unitId: z.string(),
    pageNumber: z.number().int().positive().optional(),
    figure: z.string().optional(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
    pageId: z.string().optional(),
    blockId: z.string().optional(),
  })
  .strict();
const retrievalHitSchema = z
  .object({
    sourceId: z.string(),
    unitId: z.string(),
    anchor: sourceAnchorSchema,
    text: z.string(),
    digest: z.string(),
    lexicalScore: z.number().optional(),
    semanticScore: z.number().optional(),
    rerankScore: z.number().optional(),
  })
  .strict();
const rerankSchema = z
  .object({
    query: z.string().min(1),
    candidates: z.array(retrievalHitSchema).min(1).max(80),
    limit: z.number().int().min(1).max(30).default(14),
    quality: z.enum(['fast', 'pro']).default('fast'),
  })
  .strict();
const planSchema = z
  .object({
    summary: z.string().min(1),
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            description: z.string().optional(),
            sourceUnitIds: z.array(z.string()).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict();
const submitScriptSchema = z
  .object({
    script: z.string().min(1),
    citedUnitIds: z.array(z.string()).default([]),
    reason: z.enum(['initial', 'repair', 'user_feedback']).default('initial'),
  })
  .strict();
const imagePromptSchema = z
  .object({
    prompts: z
      .array(
        z
          .object({
            slotId: z.string().min(1),
            role: z.enum([
              'hero',
              'explanatory_diagram',
              'concept_illustration',
              'analogy_scene',
              'reference',
              'decorative',
            ]),
            aspect: z.enum([
              'square_1_1',
              'landscape_4_3',
              'landscape_3_2',
              'wide_16_9',
              'portrait_4_5',
              'portrait_3_4',
              'banner_3_1',
            ]),
            prompt: z.string().min(24),
            avoid: z.string().optional(),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();
const finishConversationSchema = z
  .object({
    answer: z.string().min(1),
    citedUnitIds: z.array(z.string().min(1)).max(256).default([]),
  })
  .strict();
const insertionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('caret'), pageId: z.string(), position: z.number().int().nonnegative() }).strict(),
  z
    .object({
      kind: z.literal('replace_selection'),
      pageId: z.string(),
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
      selectionDigest: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal('before_page'), pageId: z.string() }).strict(),
  z.object({ kind: z.literal('after_page'), pageId: z.string() }).strict(),
  z.object({ kind: z.literal('book_start') }).strict(),
  z.object({ kind: z.literal('book_end') }).strict(),
  z.object({ kind: z.literal('new_pages'), afterPageId: z.string().optional() }).strict(),
]);
// Provider-facing shape avoids strict-output `oneOf`; local execution below
// parses the nested value with the discriminated union before using it.
const insertionTargetTransportSchema = z.object({
  kind: z.enum([
    'caret',
    'replace_selection',
    'before_page',
    'after_page',
    'book_start',
    'book_end',
    'new_pages',
  ]),
  pageId: z.string().optional(),
  position: z.number().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  selectionDigest: z.string().optional(),
  afterPageId: z.string().optional(),
}).strict();
const proposeInsertionSchema = z.object({ target: insertionTargetTransportSchema }).strict();
const previewPagesSchema = z
  .object({
    generationId: z.string().min(1),
    // Cohere's native request boundary is 20 images total. Keep one tool
    // result within that exact transport budget and review larger drafts in
    // successive model turns.
    pageIds: z.array(z.string().min(1)).min(1).max(20),
  })
  .strict();
const findingSchema = z
  .object({
    severity: z.enum(['info', 'warning', 'blocking']),
    category: z.enum([
      'overflow',
      'clipping',
      'collision',
      'illegible',
      'empty_page',
      'bad_break',
      'missing_media',
      'duplication',
      'visual_hierarchy',
      'other',
    ]),
    summary: z.string().min(1),
    evidence: z.string().optional(),
  })
  .strict();
const recordVisualSchema = z
  .object({
    generationId: z.string().min(1),
    reviews: z
      .array(
        z
          .object({
            pageId: z.string().min(1),
            findings: z.array(findingSchema).default([]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const askUserSchema = z
  .object({
    kind: z.enum(['requirements', 'blocker']),
    /** One ordinary conversational question, rendered as an assistant bubble. */
    question: z.string().min(1),
    /** Optional short context, not a second question or an option list. */
    context: z.string().optional(),
  })
  .strict();

function questionNeedFingerprint(question: string): string {
  const normalized = question
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const semanticNeed: readonly [string, RegExp][] = [
    ['image', /\b(?:image|picture|photo|illustration|visual)\b/u],
    ['placement', /\b(?:where|placement|location|before|after|beginning|end|which page)\b/u],
    ['length', /\b(?:length|long|short|concise|detailed|how many|page count|number of pages)\b/u],
    ['style', /\b(?:style|tone|format|layout|look|direction|playful|formal|cute)\b/u],
    ['detail', /\b(?:example|analogy|detail|preserve|recap|summary|exercise|practice|anything else|keep in mind)\b/u],
    ['content', /\b(?:topic|subject|content|material|information|text|explanation|what to add|what should i add|what would you like me to include)\b/u],
  ];
  return semanticNeed.find(([, pattern]) => pattern.test(normalized))?.[0]
    ?? `literal:${normalized}`;
}

function currentReaderModelTurns(state: AgentState): AgentState['modelHistory'] {
  const anchorId = state.budgetWindow?.readerMessageId;
  const anchorIndex = anchorId === undefined
    ? 0
    : state.modelHistory.findIndex(
        (turn) => turn.role === 'user' && turn.id === anchorId,
      );
  return state.modelHistory.slice(anchorIndex >= 0 ? anchorIndex : state.modelHistory.length);
}

interface CurrentImageConversationContext {
  readonly sourceId: string;
  readonly unitIds: readonly string[];
}

function currentImageConversationContext(
  state: AgentState,
): CurrentImageConversationContext | undefined {
  const mode = currentAgentObjectiveMode(state);
  if (mode !== 'conversation' && readerIntentHint(state) !== 'conversation') return undefined;
  const currentText = currentReaderModelTurns(state)
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content)
    .join('\n');
  if (!/\b(?:image|picture|photo|infographic|diagram|visual)\b/iu.test(currentText)) {
    return undefined;
  }
  const manifest = state.sourceManifest;
  const coverage = state.sourceCoverage;
  if (
    manifest === undefined || coverage === undefined ||
    coverage.manifestDigest !== manifest.digest ||
    coverage.staleSourceIds.length > 0
  ) return undefined;
  const readerSources = manifest.sources.filter(
    (source) => source.kind !== 'notebook_script_spec' && source.units.length > 0,
  );
  if (readerSources.length !== 1 || readerSources[0]?.kind !== 'image') return undefined;
  const source = readerSources[0];
  const read = new Set(coverage.readUnitIds);
  const unitIds = source.units.map((unit) => unit.id);
  if (unitIds.length === 0 || !unitIds.every((unitId) => read.has(unitId))) return undefined;
  return { sourceId: source.id, unitIds };
}

function currentTurnSuccessfullyReadImage(
  state: AgentState,
  context: CurrentImageConversationContext,
): boolean {
  return currentReaderModelTurns(state).some((turn) => {
    if (turn.role !== 'tool' || turn.isError || turn.toolName !== 'read_full_source') {
      return false;
    }
    const result = turn.content !== null && typeof turn.content === 'object' &&
        !Array.isArray(turn.content)
      ? turn.content as Readonly<Record<string, AgentJsonValue>>
      : undefined;
    return result?.sourceId === context.sourceId;
  });
}

function implicitCurrentImageConversationCitations(state: AgentState): readonly string[] {
  const context = currentImageConversationContext(state);
  return context !== undefined && currentTurnSuccessfullyReadImage(state, context)
    ? context.unitIds
    : [];
}

function answeredEquivalentQuestionExistsInCurrentReaderTurn(
  state: AgentState,
  question: string,
): boolean {
  const currentTurns = currentReaderModelTurns(state);
  const answeredCallIds = new Set(
    currentTurns.flatMap((turn) =>
      turn.role === 'tool' && turn.toolName === 'ask_user' && !turn.isError
        ? [turn.toolCallId]
        : [],
    ),
  );
  if (answeredCallIds.size === 0) return false;
  const requestedNeed = questionNeedFingerprint(question);
  return currentTurns.some((turn) =>
    turn.role === 'assistant' && turn.toolCalls.some((call) => {
      if (call.name !== 'ask_user' || !answeredCallIds.has(call.id)) return false;
      const parsed = askUserSchema.safeParse(transportArguments(call.arguments));
      return parsed.success &&
        questionNeedFingerprint(parsed.data.question) === requestedNeed;
    }),
  );
}

function answeredQuestionExistsInCurrentReaderTurn(state: AgentState): boolean {
  return currentReaderModelTurns(state).some(
    (turn) => turn.role === 'tool' && turn.toolName === 'ask_user' && !turn.isError,
  );
}

function failedQuestionExistsInCurrentReaderTurn(state: AgentState): boolean {
  return currentReaderModelTurns(state).some(
    (turn) => turn.role === 'tool' && turn.toolName === 'ask_user' && turn.isError,
  );
}
const proposePatchSchema = emptySchema;

function verifiedPreviewCitations(state: AgentState): readonly SourceCitation[] {
  const manifest = state.sourceManifest;
  const coverage = state.sourceCoverage;
  if (manifest === undefined || coverage === undefined) return [];
  const read = new Set(coverage.readUnitIds);
  const byUnit = new Map(
    manifest.sources.flatMap((source) => source.units.map((unit) => [
      unit.id,
      { source, unit },
    ] as const)),
  );
  return coverage.citedUnitIds.map((unitId) => {
    const found = byUnit.get(unitId);
    if (found === undefined || !read.has(unitId)) {
      throw new Error('a draft citation does not belong to source evidence read in this task');
    }
    return {
      sourceId: found.source.id,
      sourceTitle: found.source.title,
      unitId,
      label: found.unit.label,
      ...(found.unit.anchor.pageNumber === undefined
        ? {}
        : { pageNumber: found.unit.anchor.pageNumber }),
      ...(found.unit.anchor.figure === undefined
        ? {}
        : { figure: found.unit.anchor.figure }),
    };
  });
}

function verifiedConversationCitations(
  state: AgentState,
  unitIds: readonly string[],
): readonly SourceCitation[] {
  const manifest = state.sourceManifest;
  const coverage = state.sourceCoverage;
  if (unitIds.length === 0) return [];
  if (manifest === undefined || coverage === undefined) {
    throw new Error('conversation citations require source evidence read in this task');
  }
  const read = new Set(coverage.readUnitIds);
  const byUnit = new Map(
    manifest.sources.flatMap((source) => source.units.map((unit) => [
      unit.id,
      { source, unit },
    ] as const)),
  );
  return unitIds.map((unitId) => {
    const found = byUnit.get(unitId);
    if (found === undefined || !read.has(unitId)) {
      throw new Error('conversation citations must name source evidence read in this task');
    }
    return {
      sourceId: found.source.id,
      sourceTitle: found.source.title,
      unitId,
      label: found.unit.label,
      ...(found.unit.anchor.pageNumber === undefined
        ? {}
        : { pageNumber: found.unit.anchor.pageNumber }),
      ...(found.unit.anchor.figure === undefined
        ? {}
        : { figure: found.unit.anchor.figure }),
    };
  });
}

function createDefinitions(): readonly ToolDefinition<unknown>[] {
  return [
    definition({
      name: 'set_task_mode',
      description:
        'Declare conversation or notebook_change when overriding the advisory intent hint or correcting an earlier semantic choice. This never grants write authority.',
      effect: 'read',
      schema: taskModeSchema,
      async execute(state, args, context) {
        if (
          currentAgentObjectiveMode(state) === 'notebook_change' &&
          args.mode === 'conversation' &&
          (state.draft !== undefined || state.previewGeneration !== undefined ||
            state.patchProposal !== undefined)
        ) {
          throw new Error(
            'Notebook authoring has already produced material work. Finish or revise that work instead of silently changing the task to conversation.',
          );
        }
        const turnId = state.budgetWindow?.readerMessageId ??
          state.objective?.turnId ?? state.conversation[0]?.id ?? state.identity.runId;
        return {
          state: touch(state, context, {
            objective: {
              turnId,
              mode: args.mode,
              decidedBy: 'model_declaration',
              reason: args.reason.trim(),
              decidedAt: context.adapters.clock.now(),
            },
            ...(args.mode === 'conversation'
              ? {
                  plan: undefined,
                  notebookSnapshot: undefined,
                  insertionTarget: undefined,
                }
              : {}),
          }),
          result: json({
            mode: args.mode,
            accepted: true,
            writeAuthorityGranted: false,
            nextAction: args.mode === 'conversation'
              ? 'Answer with finish_conversation.'
              : 'Inspect the notebook and continue through reviewed preview.',
          }),
          summary: args.mode === 'conversation'
            ? 'confirmed a conversational answer'
            : 'confirmed notebook authoring',
        };
      },
    }),
    definition({
      name: 'inspect_notebook',
      description:
        'Read the current book manifest and revision before planning or proposing any insertion.',
      effect: 'read',
      schema: emptySchema,
      async execute(state, _args, context) {
        const notebook = await context.adapters.notebook.inspectNotebook(
          state.identity.bookId,
          context.signal,
        );
        // The full revision map is durable local authority and belongs only in
        // state. Repeating snapshot.pageIds plus pageRevisions in the provider
        // result made a 48-page inspection several thousand tokens larger
        // without giving the model any additional routing information.
        const providerManifest = {
          title: notebook.title,
          pageCount: notebook.pages.length,
          bookRevision: notebook.snapshot.bookRevision,
          capturedAt: notebook.snapshot.capturedAt,
          pages: notebook.pages.map((page) => ({
            pageId: page.pageId,
            ordinal: page.ordinal,
            ...(page.title === undefined ? {} : { title: page.title }),
            estimatedTokens: page.estimatedTokens,
          })),
        };
        return {
          state: touch(state, context, {
            notebookSnapshot: notebook.snapshot,
            phase: 'reading_sources',
          }),
          result: json(providerManifest),
          summary: `inspected ${notebook.pages.length} notebook pages`,
        };
      },
    }),
    definition({
      name: 'inspect_page',
      description: 'Read one notebook page with stable page/revision anchors.',
      effect: 'read',
      schema: inspectPageSchema,
      async execute(state, args, context) {
        const notebook = await context.adapters.notebook.inspectNotebook(
          state.identity.bookId,
          context.signal,
        );
        if (!notebook.pages.some((page) => page.pageId === args.pageId)) {
          throw new Error('That page is outside the current notebook');
        }
        const page = await context.adapters.notebook.inspectPage(args.pageId, context.signal);
        return {
          state: touch(state, context, {}),
          result: json(providerPageInspection(page)),
          summary: `read notebook page ${page.ordinal + 1}`,
        };
      },
    }),
    definition({
      name: 'inspect_page_range',
      description: 'Read a bounded ordinal range of pages from the current notebook.',
      effect: 'read',
      schema: inspectPageRangeSchema,
      async execute(state, args, context) {
        const pages = await context.adapters.notebook.inspectPageRange(
          state.identity.bookId,
          args.startOrdinal,
          args.endOrdinal,
          context.signal,
        );
        return {
          state: touch(state, context, {}),
          result: json({ pages: pages.map(providerPageInspection) }),
          summary: `read ${pages.length} notebook pages`,
        };
      },
    }),
    definition({
      name: 'inspect_selection',
      description:
        'Read the current selection and its page revision/digest; use before proposing a selection replacement.',
      effect: 'read',
      schema: emptySchema,
      async execute(state, _args, context) {
        const selection = await context.adapters.notebook.inspectSelection(
          state.identity.bookId,
          context.signal,
        );
        return {
          state: touch(state, context, {}),
          result: json({ selection }),
          summary: selection === null ? 'no active selection' : 'inspected the active selection',
        };
      },
    }),
    definition({
      name: 'list_source_manifest',
      description:
        'List every attached/notebook/spec source and its anchored units before choosing direct context, search, or a complete sweep.',
      effect: 'read',
      schema: emptySchema,
      async execute(state, _args, context) {
        const manifest = await context.adapters.sources.getManifest(
          state.identity.taskId,
          context.signal,
        );
        const coverage =
          state.sourceCoverage?.manifestDigest === manifest.digest
            ? state.sourceCoverage
            : createSourceCoverageLedger(
                manifest,
                readerRequiresCompleteSourceCoverage(state) ? 'complete' : 'relevant',
                context.adapters.clock.now(),
              );
        return {
          state: touch(state, context, {
            sourceManifest: manifest,
            sourceCoverage: coverage,
            phase: 'reading_sources',
          }),
          result: json(manifest),
          summary: `listed ${manifest.sources.length} sources`,
        };
      },
    }),
    definition({
      name: 'plan_source_retrieval',
      description:
        'Choose direct grounded context, local retrieval/reranking, or a complete iterative source sweep from the actual manifest size and task guarantee.',
      effect: 'read',
      schema: planRetrievalSchema,
      async execute(state, args, context) {
        if (state.sourceManifest === undefined) throw new Error('list the source manifest first');
        const requestedSourceIds = args.sourceIds ?? state.sourceManifest.sources.map((source) => source.id);
        const retrievalPlan = planAdaptiveRetrieval({
          manifest: state.sourceManifest,
          goal: latestReaderText(state),
          preserveAllSourceInformation:
            args.preserveAllInformation ?? readerRequiresCompleteSourceCoverage(state),
          sourceIds: requestedSourceIds,
        });
        let coverage = currentCoverage(state, context.adapters.clock.now());
        if (coverage !== undefined && retrievalPlan.requiresCompleteCoverage) {
          coverage = createSourceCoverageLedger(
            state.sourceManifest,
            'complete',
            context.adapters.clock.now(),
          );
        } else if (coverage !== undefined && retrievalPlan.strategy === 'direct') {
          const selectedSourceIds = new Set(retrievalPlan.sourceIds);
          coverage = recordRelevantUnits(
            coverage,
            state.sourceManifest.sources
              .filter((source) => selectedSourceIds.has(source.id))
              .flatMap((source) => source.units.map((unit) => unit.id)),
            context.adapters.clock.now(),
          );
        }
        return {
          state: touch(state, context, { retrievalPlan, sourceCoverage: coverage }),
          result: json(retrievalPlan),
          summary: `selected ${retrievalPlan.strategy.replace('_', ' ')}`,
        };
      },
    }),
    definition({
      name: 'read_source_range',
      description:
        'Read an anchored range of source units. Repeated bounded calls are the required path for a complete sweep.',
      effect: 'read',
      schema: readSourceRangeSchema,
      async execute(state, args, context) {
        if (state.sourceManifest === undefined) throw new Error('list the source manifest first');
        requireManifestSource(state, args.sourceId);
        const read = await context.adapters.sources.readUnitRange(
          args.sourceId,
          args.startOrdinal,
          args.endOrdinal,
          state.budget.maxSourceCharactersPerToolResult,
          context.signal,
          sourceCapability(state),
        );
        const currentLedger = currentCoverage(state, context.adapters.clock.now())!;
        const selectedLedger = currentLedger.mode === 'relevant'
          ? recordRelevantUnits(
              currentLedger,
              read.units.map((unit) => unit.unitId),
              context.adapters.clock.now(),
            )
          : currentLedger;
        const ledger = recordSourceReads(
          selectedLedger,
          state.sourceManifest,
          [read],
          context.adapters.clock.now(),
          state.usage.providerCalls,
        );
        await context.events.emit({ type: 'source.coverage', ledger });
        return {
          state: touch(state, context, { sourceCoverage: ledger }),
          result: json(read),
          imageRefs: read.visualRefs?.map((visual) => visual.image),
          imagePurpose: 'source_analysis',
          summary: `read ${read.units.length} anchored source units`,
        };
      },
    }),
    definition({
      name: 'read_full_source',
      description:
        'Read a complete small source in one call. If truncated, switch to read_source_range until coverage is complete.',
      effect: 'read',
      schema: readFullSourceSchema,
      async execute(state, args, context) {
        if (state.sourceManifest === undefined) throw new Error('list the source manifest first');
        requireManifestSource(state, args.sourceId);
        const read = await context.adapters.sources.readFullSource(
          args.sourceId,
          state.budget.maxSourceCharactersPerToolResult,
          context.signal,
          sourceCapability(state),
        );
        const currentLedger = currentCoverage(state, context.adapters.clock.now())!;
        const selectedLedger = currentLedger.mode === 'relevant'
          ? recordRelevantUnits(
              currentLedger,
              read.units.map((unit) => unit.unitId),
              context.adapters.clock.now(),
            )
          : currentLedger;
        const ledger = recordSourceReads(
          selectedLedger,
          state.sourceManifest,
          [read],
          context.adapters.clock.now(),
          state.usage.providerCalls,
        );
        await context.events.emit({ type: 'source.coverage', ledger });
        return {
          state: touch(state, context, { sourceCoverage: ledger }),
          result: json(read),
          imageRefs: read.visualRefs?.map((visual) => visual.image),
          imagePurpose: 'source_analysis',
          summary: read.truncated
            ? `read ${read.units.length} units; source continues`
            : `read complete source (${read.units.length} units)`,
        };
      },
    }),
    definition({
      name: 'search_source_index',
      description:
        'Run local lexical/semantic candidate retrieval over anchored source units. Use for large relevant-only tasks, not as a substitute for required complete coverage.',
      effect: 'read',
      schema: searchSchema,
      async execute(state, args, context) {
        if (state.sourceManifest === undefined) throw new Error('list the source manifest first');
        const requestedSourceIds = args.sourceIds ?? state.sourceManifest.sources.map((source) => source.id);
        const selected = state.sourceManifest.sources.filter((source) =>
          requestedSourceIds.includes(source.id),
        );
        if (selected.length !== new Set(requestedSourceIds).size) {
          throw new Error('One or more search sources are not part of the current task manifest');
        }
        const sourceIds = selected.map((source) => source.id);
        const providerTextMode = state.textPrivacy === undefined
          ? 'allow' as const
          : 'local_only' as const;
        await context.adapters.retrieval.ensureIndexed(
          selected,
          context.signal,
          { providerTextMode },
        );
        const localQuery = restorePrivateText(args.query, state.textPrivacy);
        const hits = await context.adapters.retrieval.search(localQuery, {
          sourceIds,
          limit: args.limit,
          signal: context.signal,
          capability: sourceCapability(state),
          providerTextMode,
        });
        const reads = hitsToReads(hits, state);
        let ledger = currentCoverage(state, context.adapters.clock.now())!;
        ledger = recordRelevantUnits(
          ledger,
          hits.map((hit) => hit.unitId),
          context.adapters.clock.now(),
        );
        ledger = recordSourceReads(
          ledger,
          state.sourceManifest,
          reads,
          context.adapters.clock.now(),
          state.usage.providerCalls,
        );
        return {
          state: touch(state, context, { sourceCoverage: ledger }),
          result: json({ hits }),
          summary: `found ${hits.length} grounded candidates`,
        };
      },
    }),
    definition({
      name: 'rerank_source_hits',
      description:
        'Rerank an existing bounded candidate set. Fast is the default; use pro only for a quality-sensitive final evidence pass.',
      effect: 'read',
      schema: rerankSchema,
      async execute(state, args, context) {
        const localQuery = restorePrivateText(args.query, state.textPrivacy);
        const localCandidates = state.textPrivacy === undefined
          ? args.candidates as readonly RetrievalHit[]
          : restorePrivateJson(
              args.candidates as unknown as AgentJsonValue,
              state.textPrivacy,
            ) as unknown as readonly RetrievalHit[];
        const hits = await context.adapters.retrieval.rerank(
          localQuery,
          localCandidates,
          {
            limit: args.limit,
            quality: args.quality,
            signal: context.signal,
            providerTextMode: state.textPrivacy === undefined ? 'allow' : 'local_only',
          },
        );
        return {
          state: touch(state, context, {}),
          result: json({ hits }),
          summary: `reranked ${args.candidates.length} candidates to ${hits.length}`,
        };
      },
    }),
    definition({
      name: 'inspect_source_coverage',
      description:
        'Inspect the deterministic coverage ledger, including unread required units and stale sources.',
      effect: 'read',
      schema: emptySchema,
      async execute(state, _args, context) {
        const ledger = currentCoverage(state, context.adapters.clock.now());
        if (ledger === undefined) throw new Error('list the source manifest first');
        return {
          state: touch(state, context, { sourceCoverage: ledger }),
          result: json(ledger),
          summary: ledger.complete
            ? 'source coverage complete'
            : `${ledger.omittedUnitIds.length} required source units remain`,
        };
      },
    }),
    definition({
      name: 'set_plan',
      description:
        'Publish one concise user-visible work plan, or update it only after the reader or material notebook work changes. Do not restate the same plan or include private reasoning.',
      effect: 'draft',
      schema: planSchema,
      async execute(state, args, context) {
        const now = context.adapters.clock.now();
        const workFingerprint = materialWorkFingerprint(state);
        if (state.plan?.workFingerprint === workFingerprint) {
          return {
            state,
            result: json({
              accepted: false,
              unchanged: true,
              version: state.plan.version,
              next: 'Choose a concrete read, inspect, draft, validation, render, review, or presentation tool.',
            }),
            summary: 'kept the current plan; material work has not changed',
          };
        }
        const presentationFields = [
          args.summary,
          ...args.steps.flatMap((step) => [step.title, step.description ?? '']),
        ];
        for (const field of presentationFields) {
          assertPrivatePlaceholdersRestorable(field, state.textPrivacy);
        }
        const restoreDisplay = (value: string): string =>
          restorePrivateText(value, state.textPrivacy);
        const plan = {
          version: (state.plan?.version ?? 0) + 1,
          summary: restoreDisplay(args.summary),
          steps: args.steps.map((step, index) => ({
            ...step,
            title: restoreDisplay(step.title),
            ...(step.description === undefined
              ? {}
              : { description: restoreDisplay(step.description) }),
            status: index === 0 ? ('in_progress' as const) : ('pending' as const),
          })),
          workFingerprint,
          createdAt: state.plan?.createdAt ?? now,
          updatedAt: now,
        };
        await context.events.emit({ type: 'plan.updated', plan });
        return {
          state: touch(state, context, { plan, phase: 'planning' }),
          result: json({ accepted: true, version: plan.version }),
          summary: `published a ${plan.steps.length}-step plan`,
        };
      },
    }),
    definition({
      name: 'propose_insertion',
      description:
        'Set the proposed deterministic insertion location. This never mutates the notebook and is reconfirmed in the final preview.',
      effect: 'propose',
      schema: proposeInsertionSchema,
      async execute(state, args, context) {
        if (state.notebookSnapshot === undefined) {
          throw new Error('inspect the current notebook before proposing placement');
        }
        const pageIds = state.notebookSnapshot.pageIds;
        const firstPageId = pageIds[0];
        const lastPageId = pageIds[pageIds.length - 1];
        let candidate: unknown = args.target;
        let parsedTarget = insertionTargetSchema.safeParse(candidate);
        if (!parsedTarget.success) {
          // Command A+ strict transport cannot express a discriminated union,
          // so it occasionally selects a location kind but omits that kind's
          // anchor fields. Resolve only non-destructive placement omissions
          // from the inspected current notebook. Never guess a selection.
          if (args.target.kind === 'after_page' || args.target.kind === 'caret') {
            const pageId = args.target.pageId ?? lastPageId;
            candidate = pageId === undefined
              ? { kind: 'book_end' }
              : { kind: 'after_page', pageId };
          } else if (args.target.kind === 'before_page') {
            candidate = firstPageId === undefined
              ? { kind: 'book_start' }
              : { kind: 'before_page', pageId: firstPageId };
          } else if (
            args.target.kind === 'replace_selection' &&
            state.insertionTarget?.kind === 'replace_selection'
          ) {
            candidate = state.insertionTarget;
          }
          parsedTarget = insertionTargetSchema.safeParse(candidate);
        }
        if (!parsedTarget.success) {
          throw new Error(
            args.target.kind === 'replace_selection'
              ? 'inspect and preserve the active selection before proposing a replacement'
              : 'the insertion target is incomplete for its selected kind',
          );
        }
        const target = parsedTarget.data as NotebookInsertionTarget;
        const targetPageId = target.kind === 'caret' ||
          target.kind === 'replace_selection' ||
          target.kind === 'before_page' ||
          target.kind === 'after_page'
          ? target.pageId
          : target.kind === 'new_pages'
            ? target.afterPageId
            : undefined;
        if (
          targetPageId !== undefined &&
          !state.notebookSnapshot.pageIds.includes(targetPageId)
        ) {
          throw new Error('the insertion page does not belong to the current notebook');
        }
        if (
          state.insertionTarget?.kind === 'replace_selection' &&
          JSON.stringify(state.insertionTarget) !== JSON.stringify(target)
        ) {
          throw new Error('the selected-text task is locked to its original page and range');
        }
        const changed = JSON.stringify(state.insertionTarget) !== JSON.stringify(target);
        if (changed) {
          for (const generationId of generationIdsOwnedByState(state)) {
            await context.adapters.sandbox.dispose(generationId);
          }
        }
        return {
          state: touch(state, context, {
            insertionTarget: target,
            validation: changed ? undefined : state.validation,
            previewGeneration: changed ? undefined : state.previewGeneration,
            visualReview: changed ? undefined : state.visualReview,
            patchProposal: undefined,
            localRestoredFinal: undefined,
          }),
          result: json({ target, mutationPerformed: false }),
          summary: `proposed insertion at ${target.kind.replace('_', ' ')}`,
        };
      },
    }),
    definition({
      name: 'submit_notebook_script',
      description:
        'Submit a complete raw Notebook Script draft into the disposable agent workspace. This creates no book write. A single exact outer markdown/notebook-script presentation fence is removed locally; intentional inner code and diagram fences remain. For supplied-material formatting, first submit faithful natural pagination; after rendered inspection, a repair may add at most one compact relevant enrichment to an awkward gap only when rearranging content would harm a semantic boundary. Use again after visual/parser repair, within the repair budget.',
      effect: 'draft',
      schema: submitScriptSchema,
      async execute(state, args, context) {
        if (!agentRequestsNotebookMutation(state)) {
          throw new Error(
            'the current reader turn asks for a conversational answer, not notebook pages; answer with finish_conversation instead',
          );
        }
        if (!availableAgentToolNames(state).has('submit_notebook_script')) {
          if (state.lastError?.message === UNCHANGED_DRAFT_SUBMISSION_ERROR) {
            throw new Error(UNCHANGED_DRAFT_SUBMISSION_ERROR);
          }
          const validationCurrent = state.draft !== undefined &&
            state.validation?.draftHash === state.draft.draftHash;
          const previewCurrent = validationCurrent && state.validation?.valid === true &&
            state.previewGeneration?.draftHash === state.draft?.draftHash &&
            state.previewGeneration.stale !== true;
          throw new Error(
            !validationCurrent
              ? 'the current draft is already stored; validate it instead of submitting it again'
              : !previewCurrent
                ? 'the current draft already passed validation; render it instead of submitting it again'
                : 'the current preview must be inspected, reviewed or proposed; do not resubmit the unchanged draft',
          );
        }
        const normalizedSubmission = normalizeNotebookScriptSubmission(args.script);
        const sourceAssetRepair = ensureRequiredManagedImagesInNotebookScript(
          state,
          normalizedSubmission.script,
        );
        const dominantImageLayout = applyDominantManagedImageLayout(
          state,
          sourceAssetRepair.script,
        );
        const conciseImageLayout = applyConciseManagedImageLayout(
          state,
          dominantImageLayout.script,
        );
        const vagueImageDefault = applyVagueManagedImageDefault(
          state,
          conciseImageLayout.script,
        );
        const submittedScript = vagueImageDefault.script;
        const conciseImageIntent = readerRequestsConciseAttachedImage(state);
        const normalizedPageCount = parseNotebookScriptPages(submittedScript).pages.length;
        if (conciseImageIntent && normalizedPageCount > 2) {
          throw new Error(
            `the concise attached-image contract produced ${normalizedPageCount} authored pages; keep exactly one image-led page and at most one complete notes page`,
          );
        }
        const isRepair = state.draft !== undefined;
        const portableImageSlots = extractPortableImageSlots(submittedScript);
        if (portableImageSlots.length > 0) assertPortableImagesRequested(state);
        const draftHash = await context.adapters.hash.digestText(submittedScript);
        const changedDraft = state.draft?.draftHash !== draftHash;
        const sourceContextChanged =
          state.draft?.sourceManifestDigest !== state.sourceManifest?.digest;
        const readerUnitIds = new Set(
          state.sourceManifest === undefined
            ? []
            : readerEvidenceUnitIds(state.sourceManifest),
        );
        const sourceReadUnitIds = [...new Set(
          (state.sourceCoverage?.readUnitIds ?? []).filter(
            (unitId) => readerUnitIds.has(unitId),
          ),
        )].sort();
        const requestedCitations = [...new Set(args.citedUnitIds)].sort();
        const validRequestedCitations = requestedCitations.filter((unitId) =>
          readerUnitIds.has(unitId) && sourceReadUnitIds.includes(unitId));
        const invalidCitationsDropped = requestedCitations.filter(
          (unitId) => !validRequestedCitations.includes(unitId),
        );
        const priorValidCitations = (state.sourceCoverage?.citedUnitIds ?? [])
          .filter((unitId) => readerUnitIds.has(unitId) && sourceReadUnitIds.includes(unitId));
        const sourceCitationsAutoAttached =
          readerRequiresSourceEvidence(state) && sourceReadUnitIds.length > 0 &&
          !validRequestedCitations.some((unitId) => readerUnitIds.has(unitId));
        const nextCitations = [...new Set([
          ...validRequestedCitations,
          ...(sourceCitationsAutoAttached ? sourceReadUnitIds : []),
          ...(invalidCitationsDropped.length > 0 && validRequestedCitations.length === 0 &&
              !sourceCitationsAutoAttached
            ? priorValidCitations
            : []),
        ])].sort();
        const priorCitations = [...(state.sourceCoverage?.citedUnitIds ?? [])].sort();
        const citationsChanged = JSON.stringify(priorCitations) !== JSON.stringify(nextCitations);
        const coverageBeforeSubmission = currentCoverage(
          state,
          context.adapters.clock.now(),
        );
        if (
          coverageBeforeSubmission !== undefined &&
          sourceUnitsUnobservedBeforeProviderCall(
            coverageBeforeSubmission,
            coverageBeforeSubmission.readUnitIds,
            state.usage.providerCalls,
          ).length > 0
        ) {
          throw new Error(
            'a later model turn must observe source reads before submitting a draft',
          );
        }
        const priorSourceReadUnitIds = [...(state.draft?.sourceReadUnitIds ?? [])].sort();
        const sourceReadsChanged =
          JSON.stringify(sourceReadUnitIds) !== JSON.stringify(priorSourceReadUnitIds);
        if (sourceReadsChanged && !changedDraft && !citationsChanged) {
          throw new Error(
            'source evidence advanced after this draft; revise the script or cite newly read units before reaffirming it',
          );
        }
        if (
          isRepair && !changedDraft && !sourceContextChanged &&
          !citationsChanged && !sourceReadsChanged
        ) {
          throw new Error(UNCHANGED_DRAFT_SUBMISSION_ERROR);
        }
        if (
          isRepair &&
          changedDraft &&
          repairPassesInBudgetWindow(state) >= state.budget.maxRepairPasses
        ) {
          throw new Error(`repair budget exhausted (${state.budget.maxRepairPasses})`);
        }
        if (changedDraft || sourceContextChanged) {
          const staleGenerationIds = changedDraft
            ? generationIdsOwnedByState(state)
            : localFinalGenerationIdsOwnedByState(state);
          for (const generationId of staleGenerationIds) {
            await context.adapters.sandbox.dispose(generationId);
          }
        }
        const now = context.adapters.clock.now();
        const draft = {
          runId: state.identity.runId,
          version: (state.draft?.version ?? 0) + 1,
          script: submittedScript,
          draftHash,
          sourceManifestDigest: state.sourceManifest?.digest,
          sourceReadUnitIds,
          createdAt: now,
        };
        let ledger = currentCoverage(state, now);
        if (ledger !== undefined && nextCitations.length > 0) {
          const manifestUnitIds = new Set(
            state.sourceManifest?.sources.flatMap((source) =>
              source.units.map((unit) => unit.id),
            ) ?? [],
          );
          const readUnitIds = new Set(ledger.readUnitIds);
          if (nextCitations.some((id) => !manifestUnitIds.has(id) || !readUnitIds.has(id))) {
            throw new Error('citations must name source units read in this task');
          }
          if (
            sourceUnitsUnobservedBeforeProviderCall(
              ledger,
              nextCitations,
              state.usage.providerCalls,
            ).length > 0
          ) {
            throw new Error(
              'a later model turn must observe source reads before citing them',
            );
          }
          ledger = recordSourceCitations(ledger, nextCitations, now);
        } else if (ledger !== undefined) {
          ledger = recordSourceCitations(ledger, [], now);
        }
        await context.events.emit({
          type: 'draft.updated',
          draftVersion: draft.version,
          draftHash,
          reason: args.reason,
        });
        return {
          state: touch(state, context, {
            draft,
            lastError: undefined,
            imagePromptHandoff: changedDraft ? undefined : state.imagePromptHandoff,
            sourceCoverage: ledger,
            validation:
              changedDraft || sourceContextChanged ? undefined : state.validation,
            previewGeneration: changedDraft ? undefined : state.previewGeneration,
            visualReview: changedDraft ? undefined : state.visualReview,
            patchProposal:
              changedDraft || sourceContextChanged || citationsChanged || sourceReadsChanged
                ? undefined
                : state.patchProposal,
            // A private restored render failed because local values changed
            // the exact page bytes/layout. Citations and source receipts do
            // not repair those bytes, so only changed script clears the phase.
            proposalRecovery: changedDraft ? undefined : state.proposalRecovery,
            renderRecovery: changedDraft ? undefined : state.renderRecovery,
            localRestoredFinal:
              changedDraft || sourceContextChanged || citationsChanged
                ? undefined
                : state.localRestoredFinal,
            phase: isRepair ? 'repairing' : 'checking_script',
            usage: {
              ...state.usage,
              repairPasses:
                state.usage.repairPasses + (isRepair && changedDraft ? 1 : 0),
            },
          }),
          result: json({
            draftVersion: draft.version,
            draftHash,
            portableImageSlots,
            managedSourceAssetsInserted: sourceAssetRepair.insertedPaths,
            conciseImageIntent,
            conciseImageDraftCompacted: conciseImageLayout.compacted,
            normalizedPageCount,
            vagueImageDraftCompacted: vagueImageDefault.compacted,
            sourceCitationsAutoAttached,
            invalidCitationsDropped,
            outerDocumentFenceRemoved: normalizedSubmission.outerDocumentFenceRemoved,
            mutationPerformed: false,
          }),
          summary: sourceAssetRepair.insertedPaths.length > 0
            ? isRepair
              ? `stored repaired draft ${draft.version} with the required attached image`
              : 'stored initial draft with the required attached image'
            : isRepair
              ? `stored repaired draft ${draft.version}`
              : 'stored initial draft',
        };
      },
    }),
    definition({
      name: 'prepare_image_generation_prompts',
      description:
        'For the current Notebook Script draft, prepare exactly one ready-to-copy prompt for every empty portable image slot. Include the image role and intended aspect; Alcove appends the exact selected width x height pixels and aspect ratio to the copyable prompt text and metadata. This never generates or uploads an image.',
      effect: 'draft',
      schema: imagePromptSchema,
      async execute(state, args, context) {
        if (state.draft === undefined) throw new Error('submit a draft first');
        assertPortableImagesRequested(state);
        if (state.patchProposal !== undefined) {
          throw new Error(
            'image prompts are immutable once a preview proposal exists; request changes and revise the draft first',
          );
        }
        const slots = extractPortableImageSlots(state.draft.script);
        if (slots.length === 0 && args.prompts.length > 0) {
          throw new Error('the current draft has no portable image slots');
        }
        const imagePromptHandoff = buildImagePromptHandoff({
          draftHash: state.draft.draftHash,
          script: state.draft.script,
          prompts: args.prompts,
          now: context.adapters.clock.now(),
        });
        const changed = JSON.stringify(state.imagePromptHandoff?.prompts ?? []) !==
          JSON.stringify(imagePromptHandoff.prompts);
        if (changed) {
          for (const generationId of localFinalGenerationIdsOwnedByState(state)) {
            await context.adapters.sandbox.dispose(generationId).catch(() => undefined);
          }
        }
        return {
          state: touch(state, context, {
            imagePromptHandoff,
            patchProposal: changed ? undefined : state.patchProposal,
            localRestoredFinal: changed ? undefined : state.localRestoredFinal,
          }),
          result: json({
            draftHash: imagePromptHandoff.draftHash,
            slots: imagePromptHandoff.prompts.map((prompt) => ({
              slotId: prompt.slot.slotId,
              pageNumber: prompt.slot.pageNumber,
              role: prompt.role,
              aspect: prompt.aspect,
              widthPx: prompt.widthPx,
              heightPx: prompt.heightPx,
            })),
          }),
          summary: imagePromptHandoff.prompts.length === 0
            ? 'confirmed the draft has no portable image slots'
            : `prepared ${imagePromptHandoff.prompts.length} portable image prompts`,
        };
      },
    }),
    definition({
      name: 'parse_notebook_script',
      description:
        'Run Alcove’s real tolerant Notebook Script parser/page-boundary pass on the current draft and return concrete diagnostics.',
      effect: 'read',
      schema: emptySchema,
      async execute(state, _args, context) {
        if (state.draft === undefined) throw new Error('submit a draft first');
        const result = parserDiagnostics(state.draft.script);
        return {
          state: touch(state, context, { phase: 'checking_script' }),
          result: json(result),
          summary: `${result.pageCount} authored pages, ${result.diagnostics.length} parser warnings`,
        };
      },
    }),
    definition({
      name: 'validate_notebook_script',
      description:
        'Run deterministic parser, image-reference, page-ledger, semantic catalogue-craft and dry-layout preparation checks in the disposable sandbox.',
      effect: 'draft',
      schema: emptySchema,
      async execute(state, _args, context) {
        if (state.draft === undefined) throw new Error('submit a draft first');
        if (state.notebookSnapshot === undefined) throw new Error('inspect the notebook first');
        if (state.insertionTarget === undefined) throw new Error('propose an insertion target first');
        const sandboxTarget = await exactSandboxTarget(state, context);
        const validation = withNotebookCraftValidation(
          await context.adapters.sandbox.validate(state.draft, {
            bookSnapshot: state.notebookSnapshot,
            insertionTarget: state.insertionTarget,
            targetPage: sandboxTarget.targetPage,
            signal: context.signal,
          }),
          state.draft.script,
          state,
          state.previewGeneration?.draftHash === state.draft.draftHash
            ? state.previewGeneration.pageCount
            : undefined,
        );
        return {
          state: touch(state, context, {
            validation,
            textPrivacy: sandboxTarget.textPrivacy,
            phase: 'checking_script',
          }),
          result: json(validation),
          summary: validation.valid ? 'deterministic checks passed' : 'draft needs deterministic repair',
        };
      },
    }),
    definition({
      name: 'render_draft_preview',
      description:
        'Build a disposable real parser/pagination/layout render of the current draft. It never edits the notebook. Afterward inspect every rendered page image.',
      effect: 'draft',
      schema: emptySchema,
      async execute(state, _args, context) {
        if (state.draft === undefined) throw new Error('submit a draft first');
        if (state.validation?.draftHash !== state.draft.draftHash || !state.validation.valid) {
          throw new Error('validate the current draft successfully before rendering');
        }
        if (state.notebookSnapshot === undefined || state.insertionTarget === undefined) {
          throw new Error('notebook snapshot and insertion target are required');
        }
        await context.events.emit({ type: 'preview.rendering', draftHash: state.draft.draftHash });
        const previousGenerationIds = generationIdsOwnedByState(state);
        const sandboxTarget = await exactSandboxTarget(state, context);
        const generation = await context.adapters.sandbox.render(state.draft, {
          bookSnapshot: state.notebookSnapshot,
          insertionTarget: state.insertionTarget,
          targetPage: sandboxTarget.targetPage,
          signal: context.signal,
        });
        if (generation.draftHash !== state.draft.draftHash) {
          throw new Error('sandbox returned a preview for the wrong draft');
        }
        const renderedValidation = withNotebookCraftValidation(
          state.validation,
          state.draft.script,
          state,
          generation.pageCount,
        );
        if (!renderedValidation.valid) {
          for (const generationId of previousGenerationIds) {
            if (generationId !== generation.generationId) {
              await context.adapters.sandbox.dispose(generationId).catch(() => undefined);
            }
          }
          return {
            state: touch(state, context, {
              validation: renderedValidation,
              previewGeneration: generation,
              visualReview: undefined,
              patchProposal: undefined,
              localRestoredFinal: undefined,
              phase: 'checking_script',
            }),
            result: json({
              generationId: generation.generationId,
              draftHash: generation.draftHash,
              pageCount: generation.pageCount,
              diagnostics: renderedValidation.staticDiagnostics.filter((diagnostic) =>
                diagnostic.code.startsWith('craft.'),
              ),
            }),
            summary: 'native pagination exposed a multi-page draft that needs semantic composition',
          };
        }
        const sameGeneration =
          state.previewGeneration?.generationId === generation.generationId &&
          state.previewGeneration.draftHash === generation.draftHash &&
          state.previewGeneration.layoutHash === generation.layoutHash;
        const reusableVisualReview =
          sameGeneration &&
          state.visualReview !== undefined &&
          visualReviewLedgerIsDerivedConsistently(state.visualReview, generation);
        const visualReview = reusableVisualReview && state.visualReview !== undefined
          ? state.visualReview
          : createVisualReviewLedger(generation, context.adapters.clock.now());
        await context.events.emit({ type: 'preview.ready', generation });
        for (const generationId of previousGenerationIds) {
          if (generationId !== generation.generationId) {
            await context.adapters.sandbox.dispose(generationId).catch(() => undefined);
          }
        }
        return {
          state: touch(state, context, {
            validation: renderedValidation,
            previewGeneration: generation,
            textPrivacy: sandboxTarget.textPrivacy,
            visualReview,
            patchProposal: undefined,
            localRestoredFinal: undefined,
            phase: 'reviewing_preview',
          }),
          result: json({
            generationId: generation.generationId,
            draftHash: generation.draftHash,
            layoutHash: generation.layoutHash,
            pageCount: generation.pageCount,
            pages: generation.pages.map((page) => ({
              pageId: page.pageId,
              pageNumber: page.pageNumber,
              imageDigest: page.image.digest,
              paginationSpill: page.paginationSpill,
              residualOverflow: page.residualOverflow,
            })),
            diagnostics: generation.diagnostics,
          }),
          summary: `rendered ${generation.pageCount} disposable preview pages`,
        };
      },
    }),
    definition({
      name: 'get_draft_preview_manifest',
      description:
        'Read the current preview generation, page manifest, stale hashes, review coverage and findings without loading images.',
      effect: 'read',
      schema: emptySchema,
      async execute(state, _args, context) {
        return {
          state: touch(state, context, {}),
          result: json({
            generation: state.previewGeneration ?? null,
            visualReview: state.visualReview ?? null,
          }),
          summary: state.previewGeneration === undefined
            ? 'no preview generation exists'
            : `preview has ${state.previewGeneration.pageCount} pages`,
        };
      },
    }),
    definition({
      name: 'read_draft_preview_pages',
      description:
        'Load rendered page images from the current disposable generation for multimodal self-review. Batch pages; do not make a provider call per page.',
      effect: 'read',
      schema: previewPagesSchema,
      async execute(state, args, context) {
        const generation = state.previewGeneration;
        if (generation === undefined || generation.generationId !== args.generationId) {
          throw new Error('requested preview generation is stale');
        }
        const ledger = state.visualReview;
        if (
          ledger === undefined ||
          ledger.generationId !== generation.generationId ||
          ledger.draftHash !== generation.draftHash
        ) {
          throw new Error('visual review ledger is stale or missing');
        }
        const selected = generation.pages.filter((page) => args.pageIds.includes(page.pageId));
        if (selected.length !== new Set(args.pageIds).size) {
          throw new Error('one or more requested preview pages do not exist');
        }
        const visualReview = recordVisualImageExposures(
          ledger,
          generation,
          selected,
          {
            now: context.adapters.clock.now(),
            providerCallCount: state.usage.providerCalls,
          },
        );
        return {
          state: touch(state, context, {
            visualReview,
            phase: 'reviewing_preview',
          }),
          result: json({
            generationId: generation.generationId,
            draftHash: generation.draftHash,
            pages: selected.map((page) => ({
              pageId: page.pageId,
              pageNumber: page.pageNumber,
              imageDigest: page.image.digest,
              layoutDigest: page.layoutDigest,
              paginationSpill: page.paginationSpill,
              residualOverflow: page.residualOverflow,
            })),
          }),
          imageRefs: selected.map((page) => page.image),
          imagePurpose: 'draft_visual_review',
          summary: `loaded ${selected.length} rendered pages for visual review`,
        };
      },
    }),
    definition({
      name: 'record_visual_review',
      description:
        'Record observable findings after actually viewing rendered pages. Every page in the current generation must be inspected; blocking findings require draft repair and a new render. Unused space is a finding only when it is visibly awkward, not when it is intentional breathing room; prefer semantic rearrangement before one compact relevant enrichment.',
      effect: 'draft',
      schema: recordVisualSchema,
      async execute(state, args, context) {
        const generation = state.previewGeneration;
        const ledger = state.visualReview;
        if (
          generation === undefined ||
          ledger === undefined ||
          generation.generationId !== args.generationId
        ) {
          throw new Error('visual review belongs to a stale generation');
        }
        const findings: DraftVisualFinding[] = [];
        for (const review of args.reviews) {
          for (const item of review.findings) {
            assertPrivatePlaceholdersRestorable(item.summary, state.textPrivacy);
            if (item.evidence !== undefined) {
              assertPrivatePlaceholdersRestorable(item.evidence, state.textPrivacy);
            }
            findings.push({
              id: context.adapters.ids.create('finding'),
              generationId: generation.generationId,
              pageId: review.pageId,
              ...item,
              severity: normalizedVisualFindingSeverity({
                ...item,
                resolved: false,
              }),
              summary: restorePrivateText(item.summary, state.textPrivacy),
              ...(item.evidence === undefined
                ? {}
                : { evidence: restorePrivateText(item.evidence, state.textPrivacy) }),
              // Findings describe the immutable pixels the model just saw.
              // A blocking defect can only disappear in a new draft/render;
              // the reporting turn has no trusted repair capability.
              resolved: false,
            });
          }
        }
        const updated = recordVisualInspection(ledger, generation, {
          pageIds: args.reviews.map((review) => review.pageId),
          findings,
          providerCallCount: state.usage.providerCalls,
          now: context.adapters.clock.now(),
        });
        for (const review of args.reviews) {
          const page = generation.pages.find((candidate) => candidate.pageId === review.pageId)!;
          await context.events.emit({
            type: 'preview.page_inspected',
            generationId: generation.generationId,
            pageId: review.pageId,
            pageNumber: page.pageNumber,
          });
        }
        for (const finding of findings) {
          await context.events.emit({ type: 'preview.visual_finding', finding });
        }
        return {
          state: touch(state, context, { visualReview: updated }),
          result: json(updated),
          summary: updated.complete
            ? updated.passed
              ? 'all preview pages visually passed'
              : 'visual review found issues requiring repair'
            : `${updated.requiredPageIds.length - updated.inspectedPageIds.length} preview pages remain`,
        };
      },
    }),
    definition({
      name: 'ask_user',
      description:
        'Pause for exactly one materially necessary reader answer. Write one concise natural-language question; never make a form, option list, defaults menu, or ask about placement/style that can be inferred safely.',
      effect: 'interrupt',
      schema: askUserSchema,
      async execute(state, args, context) {
        if (answeredEquivalentQuestionExistsInCurrentReaderTurn(state, args.question)) {
          throw new Error(
            'the reader already answered this turn’s clarification; interpret that reply and continue with the next useful tool instead of asking again',
          );
        }
        const presentationFields = [args.context ?? '', args.question];
        for (const field of presentationFields) {
          assertPrivatePlaceholdersRestorable(field, state.textPrivacy);
        }
        const restoreDisplay = (value: string): string =>
          restorePrivateText(value, state.textPrivacy);
        const question = [args.context?.trim(), args.question.trim()]
          .filter((part): part is string => part !== undefined && part !== '')
          .map(restoreDisplay)
          .join('\n\n');
        const message: AgentConversationMessage = {
          id: context.adapters.ids.create('msg'),
          role: 'assistant',
          text: question,
          createdAt: context.adapters.clock.now(),
        };
        await context.events.emit({ type: 'assistant.message', message });
        const interrupt: AgentInterrupt =
          args.kind === 'requirements'
            ? {
                kind: 'requirements',
                title: 'A quick question',
                questions: [{
                  id: context.call?.id ?? 'reader-reply',
                  prompt: question,
                  allowFreeText: true,
                }],
                allowSensibleDefaults: false,
                messageId: message.id,
              }
            : {
                kind: 'blocker',
                title: 'I need your direction',
                message: question,
              };
        return {
          state: touch(state, context, {
            lifecycle: 'waiting_for_user',
            phase: 'waiting_for_user',
            conversation: [...state.conversation, message],
          }),
          result: json({ waitingForUser: true }),
          summary: 'waiting for the reader’s reply',
          interrupt,
        };
      },
    }),
    definition({
      name: 'finish_conversation',
      description:
        'Finish an answer-only conversational turn without drafting, previewing, proposing or mutating notebook pages. Put the complete friendly reader-facing answer in `answer`; pass only grounded source unit ids actually used.',
      effect: 'propose',
      schema: finishConversationSchema,
      async execute(state, args, context) {
        if (
          state.sourceManifest !== undefined &&
          (readerRequiresSourceEvidence(state) || args.citedUnitIds.length > 0)
        ) {
          const currentManifest = await context.adapters.sources.getManifest(
            state.identity.taskId,
            context.signal,
          );
          if (currentManifest.digest !== state.sourceManifest.digest) {
            throw new Error(SOURCE_INPUT_STALE_ERROR);
          }
        }
        const implicitImageCitations = args.citedUnitIds.length === 0
          ? implicitCurrentImageConversationCitations(state)
          : [];
        const citedUnitIds = args.citedUnitIds.length === 0 && implicitImageCitations.length > 0
          ? implicitImageCitations
          : args.citedUnitIds;
        const currentCall = context.call;
        const modelTurnIndex = [...state.modelHistory]
          .map((turn, index) => ({ turn, index }))
          .reverse()
          .find(({ turn }) => turn.role === 'assistant')?.index;
        const modelTurn = modelTurnIndex === undefined
          ? undefined
          : state.modelHistory[modelTurnIndex];
        const trailingTurns = modelTurnIndex === undefined
          ? []
          : state.modelHistory.slice(modelTurnIndex + 1);
        assertPrivatePlaceholdersRestorable(args.answer, state.textPrivacy);
        const restoredCurrentAnswer = restorePrivateText(
          args.answer.trim(),
          state.textPrivacy,
        );
        if (modelTurn?.role === 'assistant') {
          assertPrivatePlaceholdersRestorable(modelTurn.content, state.textPrivacy);
        }
        const currentTurnOwnsCall =
          currentCall?.name === 'finish_conversation' &&
          modelTurn?.role === 'assistant' &&
          modelTurn.toolCalls.some(
            (call) => call.id === currentCall.id && call.name === currentCall.name,
          ) &&
          trailingTurns.every(
            (turn) => turn.role === 'tool' &&
              modelTurn.toolCalls.some((call) => call.id === turn.toolCallId),
          );
        if (
          !currentTurnOwnsCall ||
          modelTurn?.role !== 'assistant' ||
          restoredCurrentAnswer === ''
        ) {
          throw new Error(
            'write the complete reader-facing answer in this finish call before finishing the conversation',
          );
        }
        const decision = canCompleteConversation(state, citedUnitIds);
        if (!decision.allowed) {
          throw new Error(decision.reason ?? 'conversation completion blocked');
        }
        let sourceCoverage = state.sourceCoverage;
        if (sourceCoverage !== undefined) {
          sourceCoverage = recordSourceCitations(
            sourceCoverage,
            citedUnitIds,
            context.adapters.clock.now(),
          );
        }
        const citations = verifiedConversationCitations(state, citedUnitIds);
        const answerMessage: AgentConversationMessage = {
          id: context.adapters.ids.create('msg'),
          role: 'assistant',
          text: restoredCurrentAnswer,
          createdAt: context.adapters.clock.now(),
          ...(citations.length === 0 ? {} : { citations }),
        };
        await context.events.emit({
          type: 'assistant.message',
          message: answerMessage,
        });
        const conversation = [...state.conversation, answerMessage];
        const retainedPatch =
          state.patchProposal?.status === 'applied' ||
          state.patchProposal?.status === 'waiting_for_approval'
            ? state.patchProposal
            : undefined;
        if (retainedPatch === undefined) {
          for (const generationId of generationIdsOwnedByState(state)) {
            await context.adapters.sandbox.dispose(generationId);
          }
        }
        return {
          state: touch(state, context, {
            lifecycle: 'completed',
            phase: 'finished',
            sourceCoverage,
            conversation,
            // A reviewed proposal is a durable outbox, not conversation
            // scratch space. Keep its exact draft, render and review while a
            // reader asks a side question; only truly abandoned work is
            // disposed. Applied proposals remain immutable history as before.
            draft: retainedPatch === undefined ? undefined : state.draft,
            validation: retainedPatch === undefined ? undefined : state.validation,
            previewGeneration:
              retainedPatch === undefined ? undefined : state.previewGeneration,
            visualReview: retainedPatch === undefined ? undefined : state.visualReview,
            insertionTarget:
              retainedPatch === undefined ? undefined : state.insertionTarget,
            imagePromptHandoff:
              retainedPatch === undefined ? undefined : state.imagePromptHandoff,
            localRestoredFinal:
              retainedPatch === undefined ? undefined : state.localRestoredFinal,
            patchProposal: retainedPatch,
          }),
          result: json({
            completed: true,
            outcome: 'conversation',
            mutationPerformed: false,
            citedUnitIds,
            sourceCitationsAutoAttached: implicitImageCitations.length > 0,
          }),
          summary: 'answered in the conversation without changing the notebook',
        };
      },
    }),
    definition({
      name: 'propose_notebook_patch',
      description:
        'After complete source and visual review, build the final user preview and idempotent patch proposal. This still performs no notebook mutation.',
      effect: 'propose',
      schema: proposePatchSchema,
      async execute(state, _args, context) {
        await assertSubmissionInputsFresh(state, context);
        const decision = canSubmitNotebookPatch(state);
        if (!decision.allowed) throw new Error(decision.reason ?? 'proposal blocked');
        let localRestoredFinal: AgentState['localRestoredFinal'];
        try {
          localRestoredFinal = await buildLocalRestoredFinal(state, context);
        } catch (error) {
          throw new Error(
            `${PRIVATE_RESTORE_REPAIR_PREFIX}${
              error instanceof Error ? error.message : 'the restored page failed its safety gate'
            }`,
          );
        }
        const ownsNewRestoredGeneration =
          localRestoredFinal !== undefined &&
          localRestoredFinal.previewGeneration.generationId !==
            state.localRestoredFinal?.previewGeneration.generationId;
        try {
          const proposalState = localRestoredFinal === undefined
            ? state
            : { ...state, localRestoredFinal };
          const proposalDraft = localRestoredFinal?.draft ?? state.draft!;
          const idempotencyKey = await context.adapters.hash.digestJson({
            runId: state.identity.runId,
            draftHash: proposalDraft.draftHash,
            bookRevision: state.notebookSnapshot!.bookRevision,
            pageIds: state.notebookSnapshot!.pageIds,
            insertionTarget: state.insertionTarget,
          });
          const previewId = `preview_${idempotencyKey.slice(0, 24)}`;
          const preview = buildUserPreviewContract({
            state: proposalState,
            previewId,
            citations: verifiedPreviewCitations(state),
          });
          const proposal = buildPatchProposal({
            state: proposalState,
            patchId: `patch_${idempotencyKey.slice(0, 24)}`,
            idempotencyKey,
            preview,
            now: context.adapters.clock.now(),
          });
          return {
            state: touch(state, context, {
              patchProposal: proposal,
              proposalRecovery: undefined,
              localRestoredFinal,
              phase: 'building_preview',
            }),
            result: json({
              patchId: proposal.patchId,
              previewId,
              idempotencyKey,
              mutationPerformed: false,
            }),
            summary: `prepared a ${preview.expectedPageCount}-page final preview`,
          };
        } catch (error) {
          if (ownsNewRestoredGeneration && localRestoredFinal !== undefined) {
            await context.adapters.sandbox.dispose(
              localRestoredFinal.previewGeneration.generationId,
            ).catch(() => undefined);
          }
          throw error;
        }
      },
    }),
    definition({
      name: 'submit_notebook_patch',
      description:
        'Present the one final preview/insertion decision. This interrupts for approval and never applies the patch itself.',
      effect: 'interrupt',
      schema: emptySchema,
      async execute(state, _args, context) {
        const proposal = state.patchProposal;
        if (proposal === undefined || proposal.status !== 'waiting_for_approval') {
          throw new Error('prepare a current notebook patch proposal first');
        }
        await assertSubmissionInputsFresh(state, context);
        const ready = canSubmitNotebookPatch(state);
        if (!ready.allowed) throw new Error(ready.reason ?? 'patch is no longer current');
        await context.events.emit({
          type: 'approval.requested',
          preview: proposal.preview,
        }, `approval:${proposal.patchId}`);
        return {
          state: touch(state, context, {
            lifecycle: 'waiting_for_preview_decision',
            phase: 'waiting_for_preview_decision',
          }),
          result: json({ waitingForPreviewDecision: true }),
          summary: 'waiting for the final preview decision',
          interrupt: {
            kind: 'final_preview',
            title: 'Review the finished notebook draft',
            preview: proposal.preview,
            decisions: ['approve', 'reject', 'feedback', 'change_location'],
          },
        };
      },
    }),
  ];
}

function hitsToReads(hits: readonly RetrievalHit[], state: AgentState): SourceRead[] {
  const manifest = state.sourceManifest;
  if (manifest === undefined) return [];
  const bySource = new Map<string, RetrievalHit[]>();
  for (const hit of hits) {
    const list = bySource.get(hit.sourceId) ?? [];
    list.push(hit);
    bySource.set(hit.sourceId, list);
  }
  return [...bySource].map(([sourceId, sourceHits]) => ({
    sourceId,
    sourceDigest:
      manifest.sources.find((source) => source.id === sourceId)?.digest ?? '',
    units: sourceHits.map((hit) => ({
      unitId: hit.unitId,
      anchor: hit.anchor,
      text: hit.text,
      digest: hit.digest,
    })),
    truncated: false,
  }));
}

export interface ToolCallResult {
  readonly state: AgentState;
  readonly result: AgentJsonValue;
  /**
   * Graph-private receipt used by the no-progress watchdog. It is deliberately
   * kept out of the tool's public/provider result contract until the graph
   * checkpoints the turn, so callers still receive the stable documented
   * `{ error, retryable, ... }` shape.
   */
  readonly watchdogMaterialFingerprint?: string;
  readonly imageRefs?: readonly AgentImageRef[];
  readonly imagePurpose?: 'source_analysis' | 'draft_visual_review';
  readonly interrupt?: AgentInterrupt;
}

const ALWAYS_AVAILABLE_TOOLS = new Set<string>();

/**
 * Final-preview feedback is the one intentional escape hatch from the normal
 * phase gate. Once the model has submitted a replacement draft, the feedback
 * has been consumed; keeping `submit_notebook_script` advertised after that
 * point is exactly how an unchanged full draft can be submitted forever.
 */
function explicitReaderFeedbackPending(state: AgentState): boolean {
  const currentTurnId = state.budgetWindow?.readerMessageId;
  if (
    currentTurnId !== undefined &&
    state.objective?.turnId === currentTurnId &&
    state.objective.mode === 'notebook_change' &&
    state.objective.reason === 'reader_preview_feedback'
  ) {
    const turnIndex = state.modelHistory.findIndex((turn) => turn.id === currentTurnId);
    if (turnIndex >= 0) {
      return !state.modelHistory.slice(turnIndex + 1).some((turn) =>
        turn.role === 'tool' && turn.toolName === 'submit_notebook_script' &&
        !turn.isError
      );
    }
  }
  for (let index = state.modelHistory.length - 1; index >= 0; index -= 1) {
    const turn = state.modelHistory[index];
    if (
      turn?.role === 'tool' &&
      turn.toolName === 'submit_notebook_script' &&
      !turn.isError
    ) {
      return false;
    }
    if (
      turn?.role === 'tool' &&
      turn.toolName === 'submit_notebook_patch' &&
      turn.content !== null &&
      typeof turn.content === 'object' &&
      !Array.isArray(turn.content) &&
      (turn.content as Readonly<Record<string, AgentJsonValue>>).decision === 'feedback'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The catalogue is a deterministic phase gate. The model retains editorial
 * judgment inside the current phase, while impossible, opposite-intent and
 * no-progress transitions stay out of Cohere's strict tool surface entirely.
 * Irreversible apply authority never appears here at all.
 */
export function availableAgentToolNames(state: AgentState): ReadonlySet<string> {
  const available = new Set(ALWAYS_AVAILABLE_TOOLS);
  const objectiveMode = currentAgentObjectiveMode(state);
  const sourceEvidenceRequired = readerRequiresSourceEvidence(state);
  const sourceAuthorityRequired = sourceEvidenceRequired ||
    (state.sourceCoverage?.citedUnitIds.length ?? 0) > 0;
  const completeSourceBeforeDraft =
    readerRequiresCompleteSourceCoverage(state) ||
    state.retrievalPlan?.requiresCompleteCoverage === true;
  const legacyCanonicalManifest = state.sourceManifest?.sources.some(
    (source) => source.kind === 'notebook_script_spec',
  ) === true;
  // A pre-boundary checkpoint can still carry the local Notebook Script
  // authoring specification as if it were reader evidence. Refresh that
  // manifest before exposing *any* other tool: otherwise the same provider
  // turn can select an obsolete read/search path (or start drafting) against
  // authority that must never leave Alcove's local prompt boundary.
  if (legacyCanonicalManifest) {
    available.add('list_source_manifest');
    return available;
  }
  const sourceManifestNeedsRefresh = state.sourceManifest === undefined ||
    (state.sourceCoverage?.staleSourceIds.length ?? 0) > 0;
  if (sourceAuthorityRequired && sourceManifestNeedsRefresh) {
    available.add('list_source_manifest');
    if (
      completeSourceBeforeDraft ||
      (state.sourceCoverage?.staleSourceIds.length ?? 0) > 0
    ) return available;
  }
  const imageConversation = currentImageConversationContext(state);
  if (
    imageConversation !== undefined &&
    !currentTurnSuccessfullyReadImage(state, imageConversation)
  ) {
    // Cohere can see the turn-scoped pixels, but one exact local read gives
    // the conversational answer a current anchored unit and prevents it from
    // guessing citation ids. Do not expose RAG/search for a single image, and
    // retire this capability immediately after its successful tool result.
    available.add('read_full_source');
    return available;
  }
  const sourceWorkIncomplete = state.sourceCoverage === undefined ||
    state.sourceCoverage.readUnitIds.length === 0 ||
    !state.sourceCoverage.complete;
  const attemptedSourceUnits = new Set(
    state.sourceCoverage?.attemptedUnitIds ?? [],
  );
  const exhaustedUnresolvedCompleteCoverage =
    completeSourceBeforeDraft &&
    state.sourceCoverage !== undefined &&
    !state.sourceCoverage.complete &&
    state.sourceCoverage.omittedUnitIds.length > 0 &&
    state.sourceCoverage.omittedUnitIds.every((unitId) =>
      attemptedSourceUnits.has(unitId)
    );
  if (sourceEvidenceRequired && exhaustedUnresolvedCompleteCoverage) {
    // A composed PDF page can be extractable as text yet impossible to certify
    // visually without a full-page raster/OCR path. Re-reading the same bytes
    // cannot satisfy Preserve All, so pause once for the reader to disable that
    // toggle or cancel rather than spending the provider budget in a loop.
    available.add('ask_user');
    return available;
  }
  if (
    sourceEvidenceRequired &&
    state.sourceManifest !== undefined &&
    !sourceManifestNeedsRefresh &&
    sourceWorkIncomplete
  ) {
    if (state.retrievalPlan === undefined) available.add('plan_source_retrieval');
    available.add('read_source_range');
    available.add('read_full_source');
    if (state.retrievalPlan?.strategy === 'rag') {
      available.add('search_source_index');
      available.add('rerank_source_hits');
    } else if (state.retrievalPlan === undefined) {
      // Planning may choose RAG for a large source, so search remains a valid
      // initial alternative. Rerank requires concrete candidates first.
      available.add('search_source_index');
    }
    if (
      state.retrievalPlan !== undefined ||
      state.sourceCoverage !== undefined &&
        ((state.sourceCoverage.attemptedUnitIds?.length ?? 0) > 0 ||
          state.sourceCoverage.readUnitIds.length > 0)
    ) {
      available.add('inspect_source_coverage');
    }
    if (completeSourceBeforeDraft) return available;
    if (agentRequestsNotebookMutation(state)) {
      if (state.notebookSnapshot === undefined) available.add('inspect_notebook');
      return available;
    }
  }
  if (objectiveMode === 'undecided') available.add('set_task_mode');
  // Until a successful mode-specific action settles the objective, expose one
  // safe entry point for each outcome. The model owns semantic routing; local
  // policy still owns every prerequisite and the final Insert boundary.
  if (objectiveMode === 'undecided') {
    if (
      !failedQuestionExistsInCurrentReaderTurn(state) &&
      !answeredQuestionExistsInCurrentReaderTurn(state)
    ) available.add('ask_user');
    if (state.plan === undefined) available.add('set_plan');
    available.add('finish_conversation');
    available.add('inspect_notebook');
    return available;
  }
  if (objectiveMode === 'conversation') {
    if (
      !failedQuestionExistsInCurrentReaderTurn(state) &&
      !answeredQuestionExistsInCurrentReaderTurn(state)
    ) available.add('ask_user');
    available.add('finish_conversation');
    return available;
  }

  if (
    state.notebookSnapshot === undefined &&
    (
      state.lastError?.message === NOTEBOOK_CONTENT_STALE_ERROR ||
      state.lastError?.message === NOTEBOOK_ORDER_STALE_ERROR
    )
  ) {
    available.add('inspect_notebook');
    return available;
  }

  // Planning is an optional intake aid, not a workflow action that should
  // compete with drafting and validation. Keep it through the initial inspect
  // + placement batch (parallel siblings were authored against that surface),
  // then retire it as soon as placement is concrete.
  if (state.insertionTarget === undefined && state.plan === undefined) {
    available.add('set_plan');
  }

  if (state.notebookSnapshot === undefined) {
    if (
      !failedQuestionExistsInCurrentReaderTurn(state) &&
      !answeredQuestionExistsInCurrentReaderTurn(state)
    ) available.add('ask_user');
    available.add('inspect_notebook');
    return available;
  }

  const feedbackPending = explicitReaderFeedbackPending(state);
  if (state.insertionTarget === undefined) {
    available.add('inspect_page');
    available.add('inspect_page_range');
    available.add('inspect_selection');
    available.add('propose_insertion');
    return available;
  }

  const draft = state.draft;
  if (draft === undefined) {
    available.add('submit_notebook_script');
    return available;
  }

  const validationCurrent = draft !== undefined &&
    state.validation?.draftHash === draft.draftHash;
  const validationPassed = validationCurrent && state.validation?.valid === true;
  const previewCurrent = validationPassed &&
    state.previewGeneration?.draftHash === draft?.draftHash &&
    state.previewGeneration.stale !== true;
  const reviewCurrent = draft !== undefined &&
    state.previewGeneration?.draftHash === draft.draftHash &&
    state.previewGeneration.stale !== true &&
    state.visualReview?.draftHash === draft.draftHash &&
    state.visualReview.generationId === state.previewGeneration.generationId;
  const blockingReview = reviewCurrent &&
    state.visualReview.findings.some(
      (finding) => visualFindingRequiresRepair(finding),
    ) === true;
  const failedCompleteReview = reviewCurrent &&
    state.visualReview.complete &&
    (
      !state.visualReview.passed ||
      state.previewGeneration?.parserValid === false ||
      state.previewGeneration?.layoutValid === false
    );
  const reviewRepairRequired = blockingReview || failedCompleteReview;
  const sourceContextChanged = draft !== undefined &&
    draft.sourceManifestDigest !== state.sourceManifest?.digest;
  const readerUnitIds = new Set(
    state.sourceManifest === undefined
      ? []
      : readerEvidenceUnitIds(state.sourceManifest),
  );
  const readerEvidenceRead = state.sourceCoverage?.readUnitIds.some(
    (unitId) => readerUnitIds.has(unitId),
  ) === true;
  const readerEvidenceCited = state.sourceCoverage?.citedUnitIds.some(
    (unitId) => readerUnitIds.has(unitId),
  ) === true;
  const sourceCitationUpdateRequired =
    sourceEvidenceRequired &&
    readerUnitIds.size > 0 &&
    readerEvidenceRead &&
    !readerEvidenceCited;
  const currentReaderReadUnitIds = [...new Set(
    (state.sourceCoverage?.readUnitIds ?? []).filter(
      (unitId) => readerUnitIds.has(unitId),
    ),
  )].sort();
  const draftedReaderReadUnitIds = [...(draft.sourceReadUnitIds ?? [])].sort();
  const sourceReadSetUpdateRequired =
    JSON.stringify(currentReaderReadUnitIds) !==
    JSON.stringify(draftedReaderReadUnitIds);
  const portableImageSlots = extractPortableImageSlots(draft.script);
  const imagePermissionRevoked =
    portableImageSlots.length > 0 && !explicitImageRequest(state).requested;
  const privateRestoreRepairRequired =
    state.proposalRecovery?.kind === 'private_restore' &&
    state.proposalRecovery.draftHash === draft.draftHash;
  const nativeRenderRepairRequired =
    state.renderRecovery?.draftHash === draft.draftHash;
  const requiredManagedAssetMissing =
    missingRequiredManagedImageAssetPaths(state, draft.script).length > 0;
  const draftSubmissionUseful =
    sourceContextChanged ||
    sourceCitationUpdateRequired ||
    sourceReadSetUpdateRequired ||
    imagePermissionRevoked ||
    privateRestoreRepairRequired ||
    nativeRenderRepairRequired ||
    requiredManagedAssetMissing ||
    (validationCurrent && state.validation?.valid === false) ||
    reviewRepairRequired ||
    feedbackPending;
  if (draftSubmissionUseful) {
    if (
      repairPassesInBudgetWindow(state) >= state.budget.maxRepairPasses
    ) {
      // A changed repair would now be rejected deterministically. Advertising
      // submit_notebook_script as the sole capability makes the model spend
      // every remaining provider call on an impossible transition. Pause once
      // through the legal human boundary instead; no book mutation or stale
      // preview can escape while the reader decides whether to simplify or
      // begin a fresh task.
      available.add('ask_user');
      return available;
    }
    // The tool stays available because it is also the only path for a
    // materially changed repair. Its executor deterministically rejects the
    // current exact script with a non-retryable doNotRepeat receipt; the graph
    // watchdog then stops an identical-signature provider loop.
    available.add('submit_notebook_script');
    return available;
  }

  if (
    previewCurrent &&
    (
      state.visualReview === undefined ||
      !visualReviewLedgerIsDerivedConsistently(
        state.visualReview,
        state.previewGeneration!,
      )
    )
  ) {
    // Missing/impossible derived review fields are a legacy/corrupt receipt,
    // not model-authored visual feedback. Rerender resets the ledger against
    // the exact current page ids before any image/review tool is exposed.
    available.add('render_draft_preview');
    return available;
  }

  if (!validationCurrent) {
    available.add('validate_notebook_script');
    return available;
  }

  if (validationPassed && !previewCurrent) {
    available.add('render_draft_preview');
    return available;
  }

  if (previewCurrent && !reviewRepairRequired) {
    if (state.patchProposal?.status === 'waiting_for_approval') {
      available.add('submit_notebook_patch');
      return available;
    }

    const exposedPageIds = state.visualReview !== undefined &&
        state.previewGeneration !== undefined
      ? visualImageExposurePageIds(state.visualReview, state.previewGeneration)
      : [];
    const exposed = new Set(exposedPageIds);
    const inspected = new Set(state.visualReview?.inspectedPageIds ?? []);
    const unexposedPageIds = state.previewGeneration?.pages
      .map((page) => page.pageId)
      .filter((pageId) => !exposed.has(pageId)) ?? [];
    const exposedUninspectedPageIds = exposedPageIds.filter(
      (pageId) => !inspected.has(pageId),
    );

    if (unexposedPageIds.length > 0) {
      available.add('read_draft_preview_pages');
      if (exposedUninspectedPageIds.length > 0) {
        available.add('record_visual_review');
      }
      return available;
    }
    if (exposedUninspectedPageIds.length > 0) {
      available.add('record_visual_review');
      return available;
    }

    if (
      portableImageSlots.length > 0 &&
      explicitImageRequest(state).requested &&
      !imagePromptHandoffMatchesDraft(
        state.imagePromptHandoff,
        draft.draftHash,
        draft.script,
      )
    ) {
      // Image prompts are themselves a prerequisite of patch submission.
      // Advertising them only after canSubmitNotebookPatch() succeeds creates
      // an impossible circular phase: the policy waits for the handoff while
      // the catalogue withholds its only authoring tool. Keep this transition
      // singular so the model cannot skip ahead or redraft an already passed
      // native preview.
      available.add('prepare_image_generation_prompts');
      return available;
    }

    if (canSubmitNotebookPatch(state).allowed) {
      available.add('propose_notebook_patch');
      return available;
    }
  }

  // Defensive fallback for a legacy checkpoint whose derived ledgers do not
  // match any current phase. A current preview with an inconsistent review
  // receipt is rerendered; render resets that receipt before pixels are exposed
  // again. Revalidation remains the fallback before any current preview exists.
  if (validationPassed && previewCurrent) {
    available.add('render_draft_preview');
    return available;
  }
  if (!validationCurrent) {
    available.add('validate_notebook_script');
  }
  return available;
}

function unavailableToolMessage(
  state: AgentState,
  toolName: string,
  available: ReadonlySet<string>,
): string {
  if (toolName === 'finish_conversation' && agentRequestsNotebookMutation(state)) {
    return 'the current reader turn requests a notebook change; continue the notebook workflow instead of finishing in conversation';
  }
  if (toolName === 'submit_notebook_script') {
    if (!agentRequestsNotebookMutation(state)) {
      return 'the current reader turn asks for a conversational answer, not notebook pages; answer with finish_conversation instead';
    }
    if (state.notebookSnapshot === undefined) return 'inspect the notebook before drafting';
    if (state.insertionTarget === undefined) return 'propose an insertion target before drafting';
    if (
      state.draft !== undefined &&
      repairPassesInBudgetWindow(state) >= state.budget.maxRepairPasses
    ) {
      return 'the repair budget is exhausted; pause with one concise blocker question instead of submitting another draft';
    }
    const validationCurrent = state.draft !== undefined &&
      state.validation?.draftHash === state.draft.draftHash;
    const previewCurrent = validationCurrent && state.validation?.valid === true &&
      state.previewGeneration?.draftHash === state.draft?.draftHash &&
      state.previewGeneration.stale !== true;
    return !validationCurrent
      ? 'the current draft is already stored; validate it instead of submitting it again'
      : !previewCurrent
        ? 'the current draft already passed validation; render it instead of submitting it again'
        : 'the current preview must be inspected, reviewed or proposed; do not resubmit the unchanged draft';
  }
  if (toolName === 'ask_user' && state.draft !== undefined) {
    return 'ask_user is not available after concrete notebook work has begun; advance the current draft workflow instead';
  }
  if (toolName === 'ask_user' && answeredQuestionExistsInCurrentReaderTurn(state)) {
    return 'the reader already answered this turn’s clarification; interpret that reply and continue with the next useful tool instead of asking again';
  }
  const next = [...available].filter((name) =>
    name !== 'set_plan' && name !== 'ask_user');
  return next.length === 0
    ? `${toolName} is not available in the current agent phase`
    : `${toolName} is not available in the current agent phase; use ${next.join(' or ')} instead`;
}

export class AgentToolCatalog {
  private readonly definitions = new Map<string, ToolDefinition<unknown>>();

  constructor(
    private readonly adapters: AgentAdapters,
    private readonly events: AgentEventBus,
  ) {
    for (const item of createDefinitions()) {
      this.definitions.set(item.descriptor.name, item);
    }
  }

  descriptors(): readonly AgentToolDescriptor[] {
    return [...this.definitions.values()].map((item) => item.descriptor);
  }

  descriptorsForState(state: AgentState): readonly AgentToolDescriptor[] {
    const available = availableAgentToolNames(state);
    return [...this.definitions.values()]
      .filter((item) => available.has(item.descriptor.name))
      .map((item) => item.descriptor);
  }

  async execute(
    state: AgentState,
    call: AgentModelToolCall,
    signal: AbortSignal,
  ): Promise<ToolCallResult> {
    const policy = canExecuteTool(state);
    if (!policy.allowed) {
      return this.failure(state, call, policy.reason ?? 'tool call blocked');
    }
    const tool = this.definitions.get(call.name);
    if (tool === undefined) return this.failure(state, call, `unknown tool ${call.name}`);
    const available = availableAgentToolNames(state);
    const redundantModeDeclaration = call.name === 'set_task_mode' && (() => {
      const parsedMode = taskModeSchema.safeParse(transportArguments(call.arguments));
      return parsedMode.success &&
        parsedMode.data.mode === currentAgentObjectiveMode(state);
    })();
    if (!available.has(call.name) && !redundantModeDeclaration) {
      return this.failure(
        state,
        call,
        unavailableToolMessage(state, call.name, available),
        {
          errorCode: 'tool_unavailable',
          suggestedTools: [...available].filter((name) => name !== 'ask_user'),
          nextAction: 'Choose one currently available tool; do not repeat the unavailable call.',
        },
      );
    }
    const conflict = objectiveConflict(state, call.name);
    if (conflict !== null) {
      return this.failure(
        state,
        call,
        `The attempted ${conflict.attemptedMode} action conflicts with the local ${conflict.hintedMode} intent hint. The hint is advisory, so re-evaluate the reader request and declare the intended mode before continuing.`,
        {
          errorCode: 'intent_conflict',
          suggestedTools: ['set_task_mode'],
          nextAction:
            `Call set_task_mode with ${conflict.hintedMode} if the hint is right, or explicitly override it with ${conflict.attemptedMode} and a concise reason.`,
        },
      );
    }
    // Older durable checkpoints and deterministic test providers may carry
    // `{}` for an action that historically had no parameters. Cohere sees the
    // required literal in the strict JSON schema; locally upgrade the legacy
    // representation without accepting any unknown arguments.
    const transported = transportArguments(call.arguments);
    const candidateArguments = tool.schema === emptySchema &&
      transported !== null &&
      typeof transported === 'object' &&
      !Array.isArray(transported) &&
      Object.keys(transported).length === 0
      ? { request: 'current' }
      : transported;
    const parsed = tool.schema.safeParse(candidateArguments);
    if (!parsed.success) {
      return this.failure(state, call, `invalid ${call.name} arguments`, {
        errorCode: 'invalid_arguments',
        suggestedTools: [call.name],
        nextAction: 'Correct the arguments to match the advertised schema, then retry once with changed arguments.',
      });
    }
    const routedState = settleObjectiveForTool(
      state,
      call.name,
      this.adapters.clock.now(),
    );
    await this.events.emit(
      {
        type: 'tool.started',
        toolCallId: call.id,
        toolName: call.name,
        summary: tool.descriptor.description,
      },
      `tool:${call.id}:started`,
    );
    try {
      const executed = await tool.execute(routedState, parsed.data, {
        adapters: this.adapters,
        events: this.events,
        signal,
        call,
      });
      const outgoingImageCount =
        trailingToolImageCount(routedState) + (executed.imageRefs?.length ?? 0);
      if (outgoingImageCount > MAX_PROVIDER_IMAGES_PER_TURN) {
        throw new Error(
          `This model turn can inspect at most ${MAX_PROVIDER_IMAGES_PER_TURN} images. Continue with the remaining images in the next turn.`,
        );
      }
      const nextState = {
        ...executed.state,
        usage: {
          ...executed.state.usage,
          toolCalls: executed.state.usage.toolCalls + 1,
        },
      };
      await this.events.emit(
        {
          type: 'tool.completed',
          toolCallId: call.id,
          toolName: call.name,
          summary: executed.summary,
        },
        `tool:${call.id}:completed`,
      );
      return {
        state: nextState,
        result: executed.result,
        watchdogMaterialFingerprint: materialWorkFingerprint(state),
        imageRefs: executed.imageRefs,
        imagePurpose: executed.imagePurpose,
        interrupt: executed.interrupt,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      const recovery = error instanceof ToolRecoveryError
        ? error.recovery
        : {
            errorCode: 'tool_execution_failed',
            stateChanged:
              currentAgentObjectiveMode(routedState) !== currentAgentObjectiveMode(state),
            nextAction:
              'Read the error and current availableTools, then change arguments or call the missing prerequisite. Do not repeat this call unchanged.',
          } satisfies ToolFailureOptions;
      return this.failure(
        routedState,
        call,
        boundedToolFailureMessage(error),
        recovery,
      );
    }
  }

  async completeInterrupt(
    state: AgentState,
    call: AgentModelToolCall,
    resume: AgentResumeValue,
    signal: AbortSignal,
  ): Promise<ToolCallResult> {
    if (call.name === 'ask_user') {
      const text =
        resume.kind === 'requirements_answer'
          ? resume.response?.trim() ||
            Object.values(resume.answers ?? {}).map((answer) => answer.trim()).filter(Boolean).join('\n') ||
            'Continue with the supplied requirements.'
          : resume.kind === 'blocker_answer'
            ? resume.response
            : 'Continue.';
      const userMessageId =
        resume.kind === 'requirements_answer' || resume.kind === 'blocker_answer'
          ? resume.userMessageId
          : undefined;
      const message = {
        id: userMessageId ?? this.adapters.ids.create('msg'),
        role: 'user' as const,
        text,
        createdAt: this.adapters.clock.now(),
      };
      const alreadyRecorded = state.conversation.some((item) => item.id === message.id);
      if (!alreadyRecorded) await this.events.emit({ type: 'user.message', message });
      const latestConversationMessage = state.conversation[state.conversation.length - 1];
      return {
        state: {
          ...state,
          lifecycle: 'running',
          phase: 'intake',
          conversation: alreadyRecorded
            ? state.conversation
            : [...state.conversation, message],
          sourceIntentTurnId: state.sourceIntentPending
            ? message.id
            : state.sourceIntentTurnId,
          sourceIntentPending: undefined,
          checkpointStep: state.checkpointStep + 1,
          updatedAt: this.adapters.clock.now(),
        },
        result: json({
          kind: 'reader_reply',
          response: text,
          answeredQuestionMessageId:
            latestConversationMessage?.role === 'assistant'
              ? latestConversationMessage.id
              : null,
        }),
      };
    }
    if (call.name !== 'submit_notebook_patch') {
      return this.failure(state, call, 'unexpected interrupt resume');
    }
    if (resume.kind !== 'preview_decision') {
      return this.failure(state, call, 'preview decision required');
    }
    const proposal = state.patchProposal;
    if (proposal === undefined || proposal.preview.previewId !== resume.previewId) {
      return this.failure(state, call, 'preview is stale');
    }
    if (resume.decision === 'defer_for_conversation') {
      const text = resume.feedback?.trim();
      if (text === undefined || text === '') {
        return this.failure(state, call, 'a side conversation message is required');
      }
      const now = this.adapters.clock.now();
      const userMessage = {
        id: resume.userMessageId ?? this.adapters.ids.create('msg'),
        role: 'user' as const,
        text,
        createdAt: now,
      };
      const alreadyRecorded = state.conversation.some(
        (message) => message.id === userMessage.id,
      );
      if (!alreadyRecorded) {
        await this.events.emit({ type: 'user.message', message: userMessage });
      }
      return {
        state: {
          ...state,
          lifecycle: 'running',
          phase: 'intake',
          conversation: alreadyRecorded
            ? state.conversation
            : [...state.conversation, userMessage],
          // The model node consumes this only after the human node records the
          // mandatory result for submit_notebook_patch. Cohere therefore sees
          // a valid tool pair followed by a genuinely fresh user turn.
          pendingUserTurns: [
            ...(state.pendingUserTurns ?? []),
            {
              id: userMessage.id,
              role: 'user' as const,
              content: userMessage.text,
              createdAt: userMessage.createdAt,
            },
          ],
          objective: {
            turnId: userMessage.id,
            mode: 'conversation',
            reason: 'reader_side_conversation',
            decidedAt: now,
          },
          sourceIntentTurnId: state.sourceIntentPending
            ? userMessage.id
            : state.sourceIntentTurnId,
          sourceIntentPending: undefined,
          retrievalPlan: undefined,
          sourceCoverage: state.sourceCoverage === undefined
            ? undefined
            : {
                ...state.sourceCoverage,
                citedUnitIds: [],
                updatedAt: now,
              },
          budgetWindow: {
            providerCallsAtStart: state.usage.providerCalls,
            toolCallsAtStart: state.usage.toolCalls,
            repairPassesAtStart: state.usage.repairPasses,
            startedAt: now,
            readerMessageId: userMessage.id,
          },
          // patchProposal, draft, validation, native render and visual review
          // deliberately remain byte-for-byte owned by this state.
          lastError: undefined,
          checkpointStep: state.checkpointStep + 1,
          updatedAt: now,
        },
        result: json({
          decision: 'defer_for_conversation',
          patchId: proposal.patchId,
          previewId: proposal.preview.previewId,
          mutationPerformed: false,
          previewStillPending: true,
        }),
      };
    }
    if (resume.decision === 'approve' || resume.decision === 'reject') {
      const approved = resume.decision === 'approve';
      if (approved) {
        try {
          await assertSubmissionInputsFresh(state, {
            adapters: this.adapters,
            events: this.events,
            signal,
          });
          const sourceAuthorityUsed =
            readerRequiresSourceEvidence(state) ||
            (state.sourceCoverage?.citedUnitIds.length ?? 0) > 0;
          if (
            sourceAuthorityUsed &&
            proposal.preview.sourceCoverage.manifestDigest !==
              state.sourceManifest?.digest
          ) {
            throw new Error(SOURCE_INPUT_STALE_ERROR);
          }
          const ready = canSubmitNotebookPatch(state);
          if (!ready.allowed) {
            throw new Error(ready.reason ?? 'the preview is no longer safe to approve');
          }
        } catch (error) {
          return this.failure(
            state,
            call,
            error instanceof Error ? error.message : 'the preview is no longer safe to approve',
          );
        }
      }
      if (!approved) {
        for (const generationId of generationIdsOwnedByState(state)) {
          await this.adapters.sandbox.dispose(generationId).catch(() => undefined);
        }
      }
      const decisionMessage = {
        id: this.adapters.ids.create('msg'),
        role: 'user' as const,
        text: approved
          ? 'Insert these reviewed pages into my notebook.'
          : 'Do not insert this reviewed draft.',
        createdAt: this.adapters.clock.now(),
      };
      await this.events.emit({ type: 'user.message', message: decisionMessage });
      return {
        state: {
          ...state,
          conversation: [...state.conversation, decisionMessage],
          patchProposal: {
            ...proposal,
            status: approved ? 'approved_pending_apply' : 'rejected',
          },
          localRestoredFinal: approved ? state.localRestoredFinal : undefined,
          previewGeneration: approved ? state.previewGeneration : undefined,
          visualReview: approved ? state.visualReview : undefined,
          // Approval is a durable pending-apply state, not task completion.
          // BookView owns the only mutation seam and explicitly finalizes this
          // state after its journaled whole-book operation succeeds.
          lifecycle: approved ? 'waiting_for_preview_decision' : 'completed',
          phase: approved ? 'waiting_for_preview_decision' : 'finished',
          checkpointStep: state.checkpointStep + 1,
          updatedAt: this.adapters.clock.now(),
        },
        result: json({
          decision: resume.decision,
          patchId: proposal.patchId,
          mutationPerformed: false,
        }),
      };
    }
    const feedback = resume.feedback?.trim();
    const userMessage = feedback
      ? {
          id: resume.userMessageId ?? this.adapters.ids.create('msg'),
          role: 'user' as const,
          text: feedback,
          createdAt: this.adapters.clock.now(),
        }
      : undefined;
    if (userMessage !== undefined) {
      const alreadyRecorded = state.conversation.some(
        (message) => message.id === userMessage.id,
      );
      if (!alreadyRecorded) {
        await this.events.emit({ type: 'user.message', message: userMessage });
      }
    }
    const staleGenerationIds = resume.decision === 'change_location'
      ? generationIdsOwnedByState(state)
      : localFinalGenerationIdsOwnedByState(state);
    for (const generationId of staleGenerationIds) {
      await this.adapters.sandbox.dispose(generationId).catch(() => undefined);
    }
    return {
      state: {
        ...state,
        lifecycle: 'running',
        phase: resume.decision === 'change_location' ? 'checking_script' : 'repairing',
        insertionTarget: resume.insertionTarget ?? state.insertionTarget,
        conversation:
          userMessage === undefined
            ? state.conversation
            : state.conversation.some((message) => message.id === userMessage.id)
              ? state.conversation
              : [...state.conversation, userMessage],
        sourceIntentTurnId:
          state.sourceIntentPending && userMessage !== undefined
            ? userMessage.id
            : state.sourceIntentTurnId,
        sourceIntentPending: userMessage === undefined
          ? state.sourceIntentPending
          : undefined,
        patchProposal: undefined,
        localRestoredFinal: undefined,
        validation:
          resume.decision === 'change_location' ? undefined : state.validation,
        previewGeneration:
          resume.decision === 'change_location' ? undefined : state.previewGeneration,
        visualReview:
          resume.decision === 'change_location' ? undefined : state.visualReview,
        checkpointStep: state.checkpointStep + 1,
        updatedAt: this.adapters.clock.now(),
      },
      result: json({ decision: resume.decision, feedback: feedback ?? null }),
    };
  }

  private async failure(
    state: AgentState,
    call: AgentModelToolCall,
    message: string,
    options: ToolFailureOptions = {},
  ): Promise<ToolCallResult> {
    const doNotRepeat = message === UNCHANGED_DRAFT_SUBMISSION_ERROR;
    const notebookFreshnessFailure =
      message === NOTEBOOK_CONTENT_STALE_ERROR ||
      message === NOTEBOOK_ORDER_STALE_ERROR;
    const sourceFreshnessFailure = message === SOURCE_INPUT_STALE_ERROR;
    const privateRestoreFailure = message.startsWith(PRIVATE_RESTORE_REPAIR_PREFIX);
    const nativeRenderFailure =
      call.name === 'render_draft_preview' &&
      state.draft !== undefined &&
      options.errorCode === 'tool_execution_failed';
    const retryable = !doNotRepeat;
    const now = this.adapters.clock.now();
    let recoveredState = state;
    if (notebookFreshnessFailure || sourceFreshnessFailure || privateRestoreFailure) {
      for (const generationId of generationIdsOwnedByState(state)) {
        await this.adapters.sandbox.dispose(generationId).catch(() => undefined);
      }
    }
    if (notebookFreshnessFailure) {
      // The live inspection that detected drift is authority only for rejecting
      // this terminal action. Re-enter through the ordinary inspect tool so its
      // compact provider receipt and exact snapshot are checkpointed together.
      recoveredState = {
        ...state,
        lifecycle: 'running',
        phase: 'intake',
        notebookSnapshot: undefined,
        insertionTarget: undefined,
        validation: undefined,
        previewGeneration: undefined,
        visualReview: undefined,
        patchProposal: undefined,
        localRestoredFinal: undefined,
      };
    } else if (sourceFreshnessFailure) {
      const manifest = state.sourceManifest;
      const mode = state.sourceCoverage?.mode ??
        (state.taskBrief.preserveAllSourceInformation ? 'complete' : 'relevant');
      const baseCoverage = manifest === undefined
        ? undefined
        : state.sourceCoverage ?? createSourceCoverageLedger(manifest, mode, now);
      const staleSourceIds = manifest?.sources
        .filter((source) => source.kind !== 'notebook_script_spec')
        .map((source) => source.id) ?? [];
      recoveredState = {
        ...state,
        lifecycle: 'running',
        phase: 'reading_sources',
        sourceCoverage: baseCoverage === undefined
          ? undefined
          : {
              ...baseCoverage,
              staleSourceIds: [...new Set([
                ...baseCoverage.staleSourceIds,
                ...staleSourceIds,
              ])].sort(),
              complete: false,
              updatedAt: now,
            },
        retrievalPlan: undefined,
        validation: undefined,
        previewGeneration: undefined,
        visualReview: undefined,
        patchProposal: undefined,
        localRestoredFinal: undefined,
      };
    } else if (privateRestoreFailure) {
      recoveredState = {
        ...state,
        lifecycle: 'running',
        phase: 'repairing',
        validation: undefined,
        previewGeneration: undefined,
        visualReview: undefined,
        patchProposal: undefined,
        localRestoredFinal: undefined,
        proposalRecovery: {
          kind: 'private_restore',
          draftHash: state.draft?.draftHash ?? '',
          message,
          createdAt: now,
        },
      };
    } else if (nativeRenderFailure) {
      recoveredState = {
        ...state,
        lifecycle: 'running',
        phase: 'repairing',
        previewGeneration: undefined,
        visualReview: undefined,
        patchProposal: undefined,
        localRestoredFinal: undefined,
        renderRecovery: {
          draftHash: state.draft!.draftHash,
          message,
          createdAt: now,
        },
      };
    }
    await this.events.emit(
      {
        type: 'tool.failed',
        toolCallId: call.id,
        toolName: call.name,
        message,
      },
      `tool:${call.id}:failed`,
    );
    const availableTools = [...availableAgentToolNames(recoveredState)].sort();
    const suggestedTools = [...new Set(
      options.suggestedTools ?? availableTools.filter((name) => name !== 'ask_user'),
    )].filter((name) => availableTools.includes(name));
    const errorCode = doNotRepeat
        ? 'no_progress'
        : notebookFreshnessFailure
          ? 'notebook_stale'
          : sourceFreshnessFailure
            ? 'source_stale'
            : privateRestoreFailure
              ? 'private_restore_failed'
              : nativeRenderFailure
                ? 'native_render_failed'
                : options.errorCode ?? 'tool_execution_failed';
    const stateChanged = options.stateChanged ??
      materialWorkFingerprint(recoveredState) !== materialWorkFingerprint(state);
    return {
      state: {
        ...recoveredState,
        lastError: { code: 'tool_error', message, retryable },
        usage: { ...recoveredState.usage, toolCalls: recoveredState.usage.toolCalls + 1 },
        checkpointStep: recoveredState.checkpointStep + 1,
        updatedAt: now,
      },
      result: json({
        error: message,
        errorCode,
        failedTool: call.name,
        retryable,
        stateChanged,
        availableTools,
        suggestedTools,
        nextAction: options.nextAction ??
          'Choose a suggested available tool or retry once with materially changed arguments.',
        ...(notebookFreshnessFailure
          ? {
              recovered: true,
              nextAction:
                'Inspect the current notebook, choose a current placement, then validate, render and review again.',
            }
          : sourceFreshnessFailure
            ? {
                recovered: true,
                nextAction:
                  'List the current source manifest and repeat the required source reads before continuing.',
              }
            : privateRestoreFailure
              ? {
                  recovered: true,
                  nextAction:
                    'Revise the Notebook Script so restored private text keeps the same safe structure and fixed-page fit, then validate and review it again.',
                }
            : nativeRenderFailure
              ? {
                  recovered: true,
                  nextAction:
                    `Revise the Notebook Script to address the native renderer failure, then validate the changed draft again. Renderer error: ${message}`,
                }
            : {}),
        ...(doNotRepeat
          ? {
              doNotRepeat: true,
              nextAction:
                'Revise the Notebook Script materially from the current draft before submitting again.',
            }
          : {}),
      }),
      watchdogMaterialFingerprint: materialWorkFingerprint(state),
    };
  }
}

export function mergeBudget(
  base: AgentToolBudget,
  update: Partial<AgentToolBudget> | undefined,
): AgentToolBudget {
  return update === undefined ? base : { ...base, ...update };
}
