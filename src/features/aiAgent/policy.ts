import type {
  AgentState,
  NotebookPatchProposal,
  UserPreviewContract,
} from './types';
import {
  readerEvidenceSources,
  readerEvidenceUnitIds,
  sourceUnitsUnobservedBeforeProviderCall,
  visualImageExposurePageIds,
} from './coverage';
import { imagePromptHandoffMatchesDraft } from './imageHandoff';
import { explicitImageRequest } from './imageIntent';
import {
  readerRequestsNotebookMutation,
  readerRequiresCompleteSourceCoverage,
  readerRequiresSourceEvidence,
} from './intent';

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly code?: 'cancelled' | 'budget' | 'approval_required' | 'stale' | 'incomplete';
  readonly reason?: string;
}

function usageSinceWindowStart(current: number, baseline: number | undefined): number {
  // Legacy checkpoints have no window and therefore retain the historical
  // zero baseline. Clamp corrupt/future baselines so policy never creates a
  // negative allowance or mutates the monotonic cumulative counters.
  const safeCurrent = Math.max(0, current);
  const safeBaseline = Math.min(safeCurrent, Math.max(0, baseline ?? 0));
  return safeCurrent - safeBaseline;
}

export function providerCallsInBudgetWindow(state: AgentState): number {
  return usageSinceWindowStart(
    state.usage.providerCalls,
    state.budgetWindow?.providerCallsAtStart,
  );
}

export function toolCallsInBudgetWindow(state: AgentState): number {
  return usageSinceWindowStart(
    state.usage.toolCalls,
    state.budgetWindow?.toolCallsAtStart,
  );
}

export function repairPassesInBudgetWindow(state: AgentState): number {
  return usageSinceWindowStart(
    state.usage.repairPasses,
    state.budgetWindow?.repairPassesAtStart,
  );
}

export function canCallAnotherProviderTurn(state: AgentState): PolicyDecision {
  if (state.cancellation.requested) {
    return { allowed: false, code: 'cancelled', reason: 'this run was stopped' };
  }
  if (providerCallsInBudgetWindow(state) >= state.budget.maxProviderCalls) {
    return {
      allowed: false,
      code: 'budget',
      reason: `provider-call budget exhausted (${state.budget.maxProviderCalls})`,
    };
  }
  return { allowed: true };
}

export function canExecuteTool(state: AgentState): PolicyDecision {
  if (state.cancellation.requested) {
    return { allowed: false, code: 'cancelled', reason: 'this run was stopped' };
  }
  if (toolCallsInBudgetWindow(state) >= state.budget.maxToolCalls) {
    return {
      allowed: false,
      code: 'budget',
      reason: `tool-call budget exhausted (${state.budget.maxToolCalls})`,
    };
  }
  return { allowed: true };
}

function readerSourceIds(state: AgentState): ReadonlySet<string> {
  return new Set(
    state.sourceManifest === undefined
      ? []
      : readerEvidenceSources(state.sourceManifest).map((source) => source.id),
  );
}

function canonicalUnitIds(state: AgentState): ReadonlySet<string> {
  return new Set(
    state.sourceManifest?.sources
      .filter((source) => source.kind === 'notebook_script_spec')
      .flatMap((source) => source.units.map((unit) => unit.id)) ?? [],
  );
}

function completeReaderCoverage(state: AgentState): boolean {
  const coverage = state.sourceCoverage;
  const manifest = state.sourceManifest;
  if (coverage === undefined || manifest === undefined) return false;
  const read = new Set(coverage.readUnitIds);
  const sources = readerSourceIds(state);
  return readerEvidenceUnitIds(manifest).every((unitId) => read.has(unitId)) &&
    !coverage.staleSourceIds.some((sourceId) => sources.has(sourceId));
}

/**
 * Conversation is a first-class terminal outcome. It deliberately has no
 * notebook-snapshot, draft, render or approval requirements, but source
 * guarantees remain binding and read evidence must have reached a later model
 * turn before it can support the answer.
 */
export function canCompleteConversation(
  state: AgentState,
  citedUnitIds: readonly string[],
): PolicyDecision {
  if (state.cancellation.requested) {
    return { allowed: false, code: 'cancelled', reason: 'this run was stopped' };
  }
  if (readerRequestsNotebookMutation(state)) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'the reader asked to change the notebook; complete the reviewed notebook workflow instead',
    };
  }
  const coverage = state.sourceCoverage;
  const sourceEvidenceRequired = readerRequiresSourceEvidence(state);
  const sourceAuthorityUsed = sourceEvidenceRequired || citedUnitIds.length > 0;
  if (
    sourceAuthorityUsed &&
    state.sourceManifest !== undefined &&
    coverage !== undefined &&
    coverage.manifestDigest !== state.sourceManifest.digest
  ) {
    return {
      allowed: false,
      code: 'stale',
      reason: 'source coverage belongs to an older task manifest',
    };
  }
  const readerSources = state.sourceManifest?.sources.filter(
    (source) => source.kind !== 'notebook_script_spec' && source.units.length > 0,
  ) ?? [];
  const readerUnitIds = new Set(
    readerSources.flatMap((source) => source.units.map((unit) => unit.id)),
  );
  const canonicalUnits = canonicalUnitIds(state);
  if (citedUnitIds.some((unitId) => canonicalUnits.has(unitId))) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'the Notebook Script specification is authoring guidance, not reader evidence',
    };
  }
  if (
    sourceEvidenceRequired &&
    readerUnitIds.size > 0 &&
    !citedUnitIds.some((unitId) => readerUnitIds.has(unitId))
  ) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'read and cite the attached source before finishing this answer',
    };
  }
  if (new Set(citedUnitIds).size !== citedUnitIds.length) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'conversation citations must not repeat source units',
    };
  }
  if (
    readerRequiresCompleteSourceCoverage(state) &&
    !completeReaderCoverage(state)
  ) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'complete source coverage is required before answering',
    };
  }
  const evidenceSourceIds = readerSourceIds(state);
  if (
    sourceAuthorityUsed &&
    coverage?.staleSourceIds.some((sourceId) => evidenceSourceIds.has(sourceId))
  ) {
    return {
      allowed: false,
      code: 'stale',
      reason: 'one or more sources changed after they were read',
    };
  }
  if (citedUnitIds.length > 0 && coverage === undefined) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'read source evidence before citing it',
    };
  }
  if (sourceAuthorityUsed && coverage !== undefined) {
    const read = new Set(coverage.readUnitIds);
    if (citedUnitIds.some((unitId) => !read.has(unitId))) {
      return {
        allowed: false,
        code: 'incomplete',
        reason: 'conversation citations must name source units read in this task',
      };
    }
    if (readerRequiresCompleteSourceCoverage(state)) {
      const cited = new Set(citedUnitIds);
      const uncited = [...readerUnitIds].filter((unitId) => !cited.has(unitId));
      if (uncited.length > 0) {
        return {
          allowed: false,
          code: 'incomplete',
          reason: 'a preserve-all answer must ground every required source unit',
        };
      }
    }
    if (
      sourceUnitsUnobservedBeforeProviderCall(
        coverage,
        coverage.readUnitIds.filter((unitId) => readerUnitIds.has(unitId)),
        state.usage.providerCalls,
      ).length > 0
    ) {
      return {
        allowed: false,
        code: 'incomplete',
        reason: 'a later model turn must observe all current source reads before answering',
      };
    }
  }
  return { allowed: true };
}

/** Hard deterministic gate. A model assertion cannot override any failure. */
export function canSubmitNotebookPatch(state: AgentState): PolicyDecision {
  if (state.cancellation.requested) {
    return { allowed: false, code: 'cancelled', reason: 'this run was stopped' };
  }
  if (!readerRequestsNotebookMutation(state)) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'the current reader turn did not ask to change the notebook',
    };
  }
  if (state.notebookSnapshot === undefined) {
    return { allowed: false, code: 'incomplete', reason: 'inspect the notebook first' };
  }
  if (state.insertionTarget === undefined) {
    return { allowed: false, code: 'incomplete', reason: 'choose an insertion target' };
  }
  if (state.draft === undefined) {
    return { allowed: false, code: 'incomplete', reason: 'draft Notebook Script first' };
  }
  if (state.draft.sourceManifestDigest !== state.sourceManifest?.digest) {
    return {
      allowed: false,
      code: 'stale',
      reason: 'the draft belongs to an older source manifest',
    };
  }
  if (readerRequiresSourceEvidence(state) && state.sourceManifest !== undefined) {
    const readerUnits = new Set(readerEvidenceUnitIds(state.sourceManifest));
    const currentReadUnitIds = [...new Set(
      (state.sourceCoverage?.readUnitIds ?? []).filter(
        (unitId) => readerUnits.has(unitId),
      ),
    )].sort();
    const draftedReadUnitIds = [...(state.draft.sourceReadUnitIds ?? [])].sort();
    if (JSON.stringify(currentReadUnitIds) !== JSON.stringify(draftedReadUnitIds)) {
      return {
        allowed: false,
        code: 'stale',
        reason: 'the draft predates current source reads; reaffirm or revise it after reviewing that evidence',
      };
    }
  }
  if (state.validation === undefined || !state.validation.valid) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'the current draft has not passed deterministic validation',
    };
  }
  if (state.validation.draftHash !== state.draft.draftHash) {
    return {
      allowed: false,
      code: 'stale',
      reason: 'validation belongs to an older draft',
    };
  }
  if (
    state.imagePromptHandoff !== undefined &&
    state.imagePromptHandoff.prompts.length > 0 &&
    !explicitImageRequest(state).requested
  ) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'remove portable image slots unless the reader explicitly requests images',
    };
  }
  if (
    !imagePromptHandoffMatchesDraft(
      state.imagePromptHandoff,
      state.draft.draftHash,
      state.draft.script,
    )
  ) {
    return {
      allowed: false,
      code: 'incomplete',
      reason:
        'prepare one current image-generation prompt for every portable image slot',
    };
  }
  const preview = state.previewGeneration;
  if (preview === undefined || preview.stale) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'render the current draft in the disposable preview sandbox',
    };
  }
  if (preview.draftHash !== state.draft.draftHash) {
    return { allowed: false, code: 'stale', reason: 'preview belongs to an older draft' };
  }
  if (
    preview.bookSnapshotRevision !== state.notebookSnapshot.bookRevision ||
    !preview.parserValid ||
    !preview.layoutValid
  ) {
    return {
      allowed: false,
      code: 'stale',
      reason: 'preview is stale or failed parser/layout checks',
    };
  }
  const visual = state.visualReview;
  if (
    visual === undefined ||
    visual.generationId !== preview.generationId ||
    visual.draftHash !== state.draft.draftHash
  ) {
    return {
      allowed: false,
      code: 'stale',
      reason: 'visually inspect every page in the current preview generation',
    };
  }
  const previewPageIds = preview.pages.map((page) => page.pageId);
  const uniquePreviewPageIds = [...new Set(previewPageIds)].sort();
  const uniqueRequiredPageIds = [...new Set(visual.requiredPageIds)].sort();
  if (
    uniquePreviewPageIds.length !== previewPageIds.length ||
    uniqueRequiredPageIds.length !== visual.requiredPageIds.length ||
    JSON.stringify(uniquePreviewPageIds) !== JSON.stringify(uniqueRequiredPageIds)
  ) {
    return {
      allowed: false,
      code: 'stale',
      reason: 'visual review page requirements do not match the current preview generation',
    };
  }
  const exposedPageIds = new Set(visualImageExposurePageIds(visual, preview));
  if (!previewPageIds.every((pageId) => exposedPageIds.has(pageId))) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'load every current rendered page with read_draft_preview_pages before recording visual review',
    };
  }
  const inspectedPageIds = new Set(visual.inspectedPageIds);
  const invalidFinding = visual.findings.some(
    (finding) =>
      finding.generationId !== preview.generationId ||
      !uniquePreviewPageIds.includes(finding.pageId),
  );
  const blockingFinding = visual.findings.some(
    (finding) => finding.severity === 'blocking' && !finding.resolved,
  );
  if (
    !visual.complete ||
    !visual.passed ||
    !previewPageIds.every((pageId) => inspectedPageIds.has(pageId)) ||
    invalidFinding ||
    blockingFinding
  ) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'current preview pages are not fully reviewed or have blocking findings',
    };
  }
  const sourceEvidenceRequired = readerRequiresSourceEvidence(state);
  const sourceAuthorityUsed = sourceEvidenceRequired ||
    (state.sourceCoverage?.citedUnitIds.length ?? 0) > 0;
  if (
    (readerRequiresCompleteSourceCoverage(state) ||
      state.retrievalPlan?.requiresCompleteCoverage === true) &&
    !completeReaderCoverage(state)
  ) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'complete source coverage is required and still has unread units',
    };
  }
  const evidenceSourceIds = readerSourceIds(state);
  if (
    sourceAuthorityUsed &&
    state.sourceCoverage?.staleSourceIds.some((sourceId) => evidenceSourceIds.has(sourceId))
  ) {
    return {
      allowed: false,
      code: 'stale',
      reason: 'one or more sources changed after they were read',
    };
  }
  const readerUnitIds = new Set(
    state.sourceManifest === undefined
      ? []
      : readerEvidenceUnitIds(state.sourceManifest),
  );
  const canonicalUnits = canonicalUnitIds(state);
  if (
    state.sourceCoverage?.citedUnitIds.some((unitId) => canonicalUnits.has(unitId))
  ) {
    return {
      allowed: false,
      code: 'incomplete',
      reason: 'the Notebook Script specification is authoring guidance, not reader evidence',
    };
  }
  if (sourceEvidenceRequired && readerUnitIds.size > 0) {
    const read = state.sourceCoverage?.readUnitIds.some((id) => readerUnitIds.has(id)) === true;
    const cited = state.sourceCoverage?.citedUnitIds.some((id) => readerUnitIds.has(id)) === true;
    if (!read || !cited) {
      return {
        allowed: false,
        code: 'incomplete',
        reason: 'read and cite at least one current unit from the attached source before proposing',
      };
    }
  }
  if (sourceAuthorityUsed && state.sourceCoverage !== undefined) {
    const observationRequired = [
      ...state.sourceCoverage.requiredUnitIds,
      ...state.sourceCoverage.readUnitIds,
      ...state.sourceCoverage.citedUnitIds,
    ].filter((unitId) => readerUnitIds.has(unitId));
    if (
      sourceUnitsUnobservedBeforeProviderCall(
        state.sourceCoverage,
        observationRequired,
        state.usage.providerCalls,
      ).length > 0
    ) {
      return {
        allowed: false,
        code: 'incomplete',
        reason: 'a later model turn must observe the current source reads before proposing',
      };
    }
  }
  return { allowed: true };
}

export function buildUserPreviewContract(input: {
  readonly state: AgentState;
  readonly previewId: string;
  readonly citations?: UserPreviewContract['citations'];
}): UserPreviewContract {
  const ready = canSubmitNotebookPatch(input.state);
  if (!ready.allowed) throw new Error(ready.reason ?? 'patch proposal blocked');
  const {
    draft: maskedDraft,
    previewGeneration: maskedPreviewGeneration,
    notebookSnapshot,
    insertionTarget,
    sourceCoverage,
    visualReview,
    validation,
  } = input.state;
  const localFinal = input.state.localRestoredFinal;
  const draft = localFinal?.draft ?? maskedDraft;
  const previewGeneration = localFinal?.previewGeneration ?? maskedPreviewGeneration;
  const finalValidation = localFinal?.validation ?? validation;
  if (
    draft === undefined ||
    previewGeneration === undefined ||
    notebookSnapshot === undefined ||
    insertionTarget === undefined ||
    visualReview === undefined ||
    finalValidation === undefined
  ) {
    throw new Error('proposal readiness invariant broken');
  }
  return {
    previewId: input.previewId,
    generationId: previewGeneration.generationId,
    draftHash: draft.draftHash,
    layoutHash: previewGeneration.layoutHash,
    bookId: notebookSnapshot.bookId,
    expectedBookRevision: notebookSnapshot.bookRevision,
    expectedPageIds: [...notebookSnapshot.pageIds],
    insertionTarget,
    expectedPageCount: previewGeneration.pageCount,
    pages: previewGeneration.pages,
    assumptions: input.state.taskBrief.assumptions,
    citations: input.citations ?? [],
    imageGenerationPrompts:
      localFinal?.imagePromptHandoff?.prompts ??
      input.state.imagePromptHandoff?.prompts ?? [],
    sourceCoverage:
      sourceCoverage ?? {
        manifestDigest: '',
        mode: 'relevant',
        requiredUnitIds: [],
        readUnitIds: [],
        citedUnitIds: [],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: input.state.updatedAt,
      },
    visualReview,
    validation: finalValidation,
  };
}

export function buildPatchProposal(input: {
  readonly state: AgentState;
  readonly patchId: string;
  readonly idempotencyKey: string;
  readonly preview: UserPreviewContract;
  readonly now: string;
}): NotebookPatchProposal {
  const draft = input.state.localRestoredFinal?.draft ?? input.state.draft;
  const target = input.state.insertionTarget;
  const snapshot = input.state.notebookSnapshot;
  if (draft === undefined || target === undefined || snapshot === undefined) {
    throw new Error('cannot build a patch without draft, target and snapshot');
  }
  if (
    input.preview.draftHash !== draft.draftHash ||
    input.preview.expectedBookRevision !== snapshot.bookRevision ||
    (input.preview.expectedPageIds !== undefined &&
      JSON.stringify(input.preview.expectedPageIds) !== JSON.stringify(snapshot.pageIds))
  ) {
    throw new Error('cannot build a patch from a stale preview');
  }
  return {
    patchId: input.patchId,
    idempotencyKey: input.idempotencyKey,
    runId: input.state.identity.runId,
    draftVersion: draft.version,
    draftHash: draft.draftHash,
    script: draft.script,
    expectedBookRevision: snapshot.bookRevision,
    expectedPageIds: [...snapshot.pageIds],
    insertionTarget: target,
    preview: input.preview,
    status: 'waiting_for_approval',
    createdAt: input.now,
  };
}
