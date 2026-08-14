import { describe, expect, it } from 'vitest';
import {
  availableAgentToolNames,
  canCompleteConversation,
  createInitialAgentState,
  createSourceCoverageLedger,
  recordSourceReads,
  refreshCoverageAgainstManifest,
  type AgentSourceDescriptor,
  type SourceManifest,
} from '../src/features/aiAgent';

const NOW = '2026-08-14T12:00:00.000Z';

function source(
  kind: AgentSourceDescriptor['kind'],
  sourceId: string,
  unitIds: readonly string[],
  digest = `${sourceId}-digest`,
): AgentSourceDescriptor {
  return {
    id: sourceId,
    title: kind === 'notebook_script_spec' ? 'Notebook Script specification' : 'Lecture.pdf',
    kind,
    digest,
    mediaType: kind === 'pdf' ? 'application/pdf' : 'text/markdown',
    estimatedTokens: unitIds.length * 20,
    quarantined: kind !== 'notebook_script_spec',
    promptInjectionWarnings: [],
    units: unitIds.map((unitId, ordinal) => ({
      id: unitId,
      label: `unit ${ordinal + 1}`,
      ordinal,
      digest: `${unitId}-digest`,
      estimatedTokens: 20,
      characters: 80,
      hasText: true,
      hasVisual: false,
      anchor: { sourceId, unitId },
    })),
  };
}

function manifest(
  specDigest = 'spec-digest-v1',
  digest = 'manifest-v1',
): SourceManifest {
  return {
    version: 2,
    createdAt: NOW,
    digest,
    totalEstimatedTokens: 60,
    sources: [
      source('notebook_script_spec', 'canonical-spec', ['spec-unit'], specDigest),
      source('pdf', 'reader-pdf', ['pdf-unit-a', 'pdf-unit-b']),
    ],
  };
}

describe('canonical Notebook Script source boundary', () => {
  it('refreshes a legacy canonical manifest before advertising any read, retrieval or notebook tool', () => {
    const current = manifest();
    const base = createInitialAgentState({
      identity: {
        taskId: 'canonical-refresh-task',
        threadId: 'canonical-refresh-thread',
        runId: 'canonical-refresh-run',
        bookId: 'book-1',
      },
      goal: 'Use the attached PDF to add a concise note to my book.',
      now: NOW,
      userMessageId: 'reader-refresh-1',
    });
    const legacyState = {
      ...base,
      sourceManifest: current,
      sourceCoverage: createSourceCoverageLedger(current, 'relevant', NOW),
    };

    const advertised = [...availableAgentToolNames(legacyState)];
    expect(advertised).toEqual(['list_source_manifest']);
    expect(advertised).not.toEqual(expect.arrayContaining([
      'plan_source_retrieval',
      'read_source_range',
      'read_full_source',
      'search_source_index',
      'rerank_source_hits',
      'inspect_source_coverage',
      'inspect_notebook',
      'submit_notebook_script',
    ]));
  });

  it('requires every reader unit for complete coverage but never the canonical spec', () => {
    const current = manifest();
    let ledger = createSourceCoverageLedger(current, 'complete', NOW);

    expect(ledger.requiredUnitIds).toEqual(['pdf-unit-a', 'pdf-unit-b']);
    expect(ledger.omittedUnitIds).toEqual(['pdf-unit-a', 'pdf-unit-b']);

    ledger = recordSourceReads(ledger, current, [{
      sourceId: 'canonical-spec',
      sourceDigest: 'spec-digest-v1',
      units: [{
        unitId: 'spec-unit',
        anchor: current.sources[0]!.units[0]!.anchor,
        text: 'authoring syntax',
        digest: 'spec-unit-digest',
      }],
      truncated: false,
    }], NOW, 0);
    expect(ledger.readUnitIds).toEqual([]);
    expect(ledger.staleSourceIds).toEqual([]);

    ledger = recordSourceReads(ledger, current, [{
      sourceId: 'reader-pdf',
      sourceDigest: 'reader-pdf-digest',
      units: current.sources[1]!.units.map((unit) => ({
        unitId: unit.id,
        anchor: unit.anchor,
        text: unit.label,
        digest: unit.digest,
      })),
      truncated: false,
    }], NOW, 0);
    expect(ledger).toMatchObject({
      complete: true,
      omittedUnitIds: [],
      readUnitIds: ['pdf-unit-a', 'pdf-unit-b'],
    });

    expect(createSourceCoverageLedger(current, 'relevant', NOW, ['spec-unit']))
      .toMatchObject({ requiredUnitIds: [], complete: true });
  });

  it('does not stale reader evidence when only local authoring authority changes', () => {
    const previous = manifest('spec-digest-v1', 'manifest-v1');
    const current = manifest('spec-digest-v2', 'manifest-v2');
    const ledger = {
      ...createSourceCoverageLedger(previous, 'complete', NOW),
      readUnitIds: ['pdf-unit-a', 'pdf-unit-b'],
      omittedUnitIds: [],
      complete: true,
    };

    expect(refreshCoverageAgainstManifest(ledger, previous, current, NOW)).toMatchObject({
      manifestDigest: 'manifest-v2',
      staleSourceIds: [],
      complete: true,
    });
  });

  it('rejects canonical citations and ignores legacy spec omissions in preserve-all policy', () => {
    const current = manifest();
    const base = createInitialAgentState({
      identity: {
        taskId: 'canonical-boundary-task',
        threadId: 'canonical-boundary-thread',
        runId: 'canonical-boundary-run',
        bookId: 'book-1',
      },
      goal: 'Read every part of the attached PDF without leaving anything out.',
      now: NOW,
      userMessageId: 'reader-1',
    });
    const state = {
      ...base,
      sourceManifest: current,
      sourceCoverage: {
        manifestDigest: current.digest,
        mode: 'complete' as const,
        // Simulate a persisted ledger created before the source boundary was
        // introduced: the spec is still listed as required and omitted.
        requiredUnitIds: ['pdf-unit-a', 'pdf-unit-b', 'spec-unit'],
        readUnitIds: ['pdf-unit-a', 'pdf-unit-b', 'spec-unit'],
        readExposures: [
          { unitId: 'pdf-unit-a', providerCallCount: 0, exposedAt: NOW },
          { unitId: 'pdf-unit-b', providerCallCount: 0, exposedAt: NOW },
          { unitId: 'spec-unit', providerCallCount: 0, exposedAt: NOW },
        ],
        citedUnitIds: [],
        omittedUnitIds: ['spec-unit'],
        staleSourceIds: [],
        complete: false,
        updatedAt: NOW,
      },
      usage: { ...base.usage, providerCalls: 1 },
    };

    expect(canCompleteConversation(state, ['spec-unit'])).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/authoring guidance, not reader evidence/i),
    });
    expect(canCompleteConversation(state, ['pdf-unit-a', 'pdf-unit-b']))
      .toEqual({ allowed: true });
  });
});
