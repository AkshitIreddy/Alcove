import type {
  AdaptiveRetrievalPlan,
  AgentSourceDescriptor,
  SourceManifest,
} from './types';

export interface AdaptiveRetrievalOptions {
  readonly directContextBudget: number;
  readonly reservedPromptTokens: number;
  readonly candidateLimit: number;
  readonly rerankLimit: number;
  readonly sweepBatchUnits: number;
}

export const DEFAULT_RETRIEVAL_OPTIONS: AdaptiveRetrievalOptions = {
  directContextBudget: 48_000,
  reservedPromptTokens: 10_000,
  candidateLimit: 36,
  rerankLimit: 14,
  sweepBatchUnits: 8,
};

export function planAdaptiveRetrieval(input: {
  readonly manifest: SourceManifest;
  readonly goal: string;
  readonly preserveAllSourceInformation: boolean;
  readonly sourceIds?: readonly string[];
  readonly options?: Partial<AdaptiveRetrievalOptions>;
}): AdaptiveRetrievalPlan {
  const options = { ...DEFAULT_RETRIEVAL_OPTIONS, ...input.options };
  const selected = selectSources(input.manifest.sources, input.sourceIds);
  const estimatedInputTokens = selected.reduce(
    (total, source) => total + source.estimatedTokens,
    0,
  );
  const safeDirectBudget = Math.max(
    1,
    options.directContextBudget - options.reservedPromptTokens,
  );

  if (estimatedInputTokens <= safeDirectBudget) {
    return {
      strategy: 'direct',
      rationale:
        'Every selected source fits in the safe grounded-context budget, so the agent can read it directly.',
      sourceIds: selected.map((source) => source.id),
      estimatedInputTokens,
      directContextBudget: safeDirectBudget,
      requiresCompleteCoverage: input.preserveAllSourceInformation,
    };
  }

  if (input.preserveAllSourceInformation) {
    return {
      strategy: 'complete_sweep',
      rationale:
        'The task requires complete source preservation and the sources exceed direct context, so every anchored unit must be read in bounded batches.',
      sourceIds: selected.map((source) => source.id),
      estimatedInputTokens,
      directContextBudget: safeDirectBudget,
      sweepBatchUnits: options.sweepBatchUnits,
      requiresCompleteCoverage: true,
    };
  }

  return {
    strategy: 'rag',
    rationale:
      'The selected sources exceed direct context; local candidate search followed by bounded reranking keeps the context grounded.',
    sourceIds: selected.map((source) => source.id),
    estimatedInputTokens,
    directContextBudget: safeDirectBudget,
    query: input.goal,
    candidateLimit: options.candidateLimit,
    rerankLimit: options.rerankLimit,
    requiresCompleteCoverage: false,
  };
}

function selectSources(
  sources: readonly AgentSourceDescriptor[],
  sourceIds: readonly string[] | undefined,
): readonly AgentSourceDescriptor[] {
  if (sourceIds === undefined) return sources;
  const allowed = new Set(sourceIds);
  return sources.filter((source) => allowed.has(source.id));
}

export function nextSweepBatch(
  manifest: SourceManifest,
  sourceIds: readonly string[],
  alreadyReadUnitIds: readonly string[],
  batchUnits: number,
): ReadonlyArray<{
  readonly sourceId: string;
  readonly startOrdinal: number;
  readonly endOrdinal: number;
  readonly unitIds: readonly string[];
}> {
  const read = new Set(alreadyReadUnitIds);
  const allowed = new Set(sourceIds);
  const remaining = manifest.sources
    .filter((source) => allowed.has(source.id))
    .flatMap((source) =>
      source.units
        .filter((unit) => !read.has(unit.id))
        .map((unit) => ({ sourceId: source.id, unit })),
    );
  if (remaining.length === 0) return [];

  const firstSourceId = remaining[0]!.sourceId;
  const contiguous = remaining
    .filter((item) => item.sourceId === firstSourceId)
    .slice(0, Math.max(1, batchUnits));
  return [
    {
      sourceId: firstSourceId,
      startOrdinal: contiguous[0]!.unit.ordinal,
      endOrdinal: contiguous[contiguous.length - 1]!.unit.ordinal,
      unitIds: contiguous.map((item) => item.unit.id),
    },
  ];
}
