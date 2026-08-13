import type { AgentState } from './types';

/** Every disposable render generation durably owned by one task state. */
export function generationIdsOwnedByState(
  state: AgentState | null | undefined,
): readonly string[] {
  if (state === null || state === undefined) return [];
  return [...new Set([
    state.previewGeneration?.generationId,
    state.localRestoredFinal?.previewGeneration.generationId,
    state.patchProposal?.preview.generationId,
  ].filter((value): value is string => typeof value === 'string' && value !== ''))];
}

export function localFinalGenerationIdsOwnedByState(
  state: AgentState | null | undefined,
): readonly string[] {
  if (state === null || state === undefined) return [];
  const masked = state.previewGeneration?.generationId;
  return [...new Set([
    state.localRestoredFinal?.previewGeneration.generationId,
    state.patchProposal?.preview.generationId,
  ].filter(
    (value): value is string =>
      typeof value === 'string' && value !== '' && value !== masked,
  ))];
}
