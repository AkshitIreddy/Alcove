import type {
  DraftPreviewGeneration,
  DraftPreviewPage,
  DraftVisualFinding,
  DraftVisualReviewLedger,
  SourceCoverageLedger,
  SourceManifest,
  SourceRead,
} from './types';

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function createSourceCoverageLedger(
  manifest: SourceManifest,
  mode: SourceCoverageLedger['mode'],
  now: string,
  relevantUnitIds: readonly string[] = [],
): SourceCoverageLedger {
  const everyUnit = manifest.sources.flatMap((source) =>
    source.units.map((unit) => unit.id),
  );
  const requiredUnitIds = sortedUnique(
    mode === 'complete' ? everyUnit : relevantUnitIds,
  );
  return {
    manifestDigest: manifest.digest,
    mode,
    requiredUnitIds,
    readUnitIds: [],
    readExposures: [],
    citedUnitIds: [],
    omittedUnitIds: requiredUnitIds,
    staleSourceIds: [],
    complete: requiredUnitIds.length === 0,
    updatedAt: now,
  };
}

export function recordSourceReads(
  ledger: SourceCoverageLedger,
  manifest: SourceManifest,
  reads: readonly SourceRead[],
  now: string,
  providerCallCount = 0,
): SourceCoverageLedger {
  if (!Number.isInteger(providerCallCount) || providerCallCount < 0) {
    throw new Error('source exposure has an invalid provider-call checkpoint');
  }
  const sourceDigests = new Map(
    manifest.sources.map((source) => [source.id, source.digest]),
  );
  const unitsById = new Map(
    manifest.sources.flatMap((source) =>
      source.units.map((unit) => [unit.id, unit] as const),
    ),
  );
  const staleSourceIds = new Set(ledger.staleSourceIds);
  const newlyRead: string[] = [];
  for (const read of reads) {
    if (sourceDigests.get(read.sourceId) !== read.sourceDigest) {
      staleSourceIds.add(read.sourceId);
      continue;
    }
    const unresolved = new Set(read.unresolvedVisualUnitIds ?? []);
    const visuallyExposed = new Set(
      (read.visualRefs ?? []).map((visual) => visual.anchor.unitId),
    );
    const visuallyExposedPages = new Set(
      (read.visualRefs ?? []).flatMap((visual) =>
        visual.anchor.pageNumber === undefined ? [] : [visual.anchor.pageNumber],
      ),
    );
    for (const unit of read.units) {
      const descriptor = unitsById.get(unit.unitId);
      const visualEvidence = descriptor?.visualEvidence ?? 'none';
      // Reading an extracted text placeholder is not equivalent to seeing the
      // required pixels. Search hits also flow through this function, so they
      // cannot silently satisfy visual source coverage. In relevant-only mode,
      // however, genuine extracted text remains readable/citable even though
      // the page's composed visual layout is unresolved. Complete mode keeps
      // the stricter whole-page guarantee and therefore fails closed.
      const visualEvidenceMissing =
        unresolved.has(unit.unitId) ||
        visualEvidence === 'unresolved' ||
        (visualEvidence === 'available' &&
          !visuallyExposed.has(unit.unitId) &&
          (unit.anchor.pageNumber === undefined ||
            !visuallyExposedPages.has(unit.anchor.pageNumber)));
      if (
        visualEvidenceMissing &&
        (ledger.mode === 'complete' || descriptor?.hasText !== true)
      ) {
        continue;
      }
      newlyRead.push(unit.unitId);
    }
  }
  const readUnitIds = sortedUnique([...ledger.readUnitIds, ...newlyRead]);
  const exposures = new Map(
    (ledger.readExposures ?? []).map((exposure) => [exposure.unitId, exposure]),
  );
  for (const unitId of newlyRead) {
    if (!exposures.has(unitId)) {
      exposures.set(unitId, { unitId, providerCallCount, exposedAt: now });
    }
  }
  const readSet = new Set(readUnitIds);
  const omittedUnitIds = ledger.requiredUnitIds.filter((id) => !readSet.has(id));
  return {
    ...ledger,
    readUnitIds,
    readExposures: [...exposures.values()].sort((left, right) =>
      left.unitId.localeCompare(right.unitId),
    ),
    omittedUnitIds,
    staleSourceIds: sortedUnique([...staleSourceIds]),
    complete: omittedUnitIds.length === 0 && staleSourceIds.size === 0,
    updatedAt: now,
  };
}

/** Units that the model has not observed in a completed earlier turn. */
export function sourceUnitsUnobservedBeforeProviderCall(
  ledger: SourceCoverageLedger,
  unitIds: readonly string[],
  providerCallCount: number,
): readonly string[] {
  const exposureByUnit = new Map(
    (ledger.readExposures ?? []).map((exposure) => [exposure.unitId, exposure]),
  );
  return sortedUnique(unitIds).filter((unitId) => {
    const exposure = exposureByUnit.get(unitId);
    return exposure === undefined || exposure.providerCallCount >= providerCallCount;
  });
}

export function recordRelevantUnits(
  ledger: SourceCoverageLedger,
  unitIds: readonly string[],
  now: string,
): SourceCoverageLedger {
  if (ledger.mode === 'complete') return ledger;
  const requiredUnitIds = sortedUnique([...ledger.requiredUnitIds, ...unitIds]);
  const read = new Set(ledger.readUnitIds);
  const omittedUnitIds = requiredUnitIds.filter((id) => !read.has(id));
  return {
    ...ledger,
    requiredUnitIds,
    omittedUnitIds,
    complete: omittedUnitIds.length === 0 && ledger.staleSourceIds.length === 0,
    updatedAt: now,
  };
}

export function recordSourceCitations(
  ledger: SourceCoverageLedger,
  unitIds: readonly string[],
  now: string,
): SourceCoverageLedger {
  return {
    ...ledger,
    // Citation intent belongs to the current complete draft. Replacing it
    // prevents repaired drafts from retaining stale citations to claims that
    // no longer appear.
    citedUnitIds: sortedUnique(unitIds),
    updatedAt: now,
  };
}

export function refreshCoverageAgainstManifest(
  ledger: SourceCoverageLedger,
  previous: SourceManifest,
  current: SourceManifest,
  now: string,
): SourceCoverageLedger {
  const oldDigests = new Map(previous.sources.map((source) => [source.id, source.digest]));
  const staleSourceIds = current.sources
    .filter((source) => oldDigests.get(source.id) !== source.digest)
    .map((source) => source.id);
  if (current.digest === ledger.manifestDigest && staleSourceIds.length === 0) {
    return ledger;
  }
  return {
    ...ledger,
    manifestDigest: current.digest,
    staleSourceIds: sortedUnique([...ledger.staleSourceIds, ...staleSourceIds]),
    complete: false,
    updatedAt: now,
  };
}

export function createVisualReviewLedger(
  generation: DraftPreviewGeneration,
  now: string,
): DraftVisualReviewLedger {
  return {
    generationId: generation.generationId,
    draftHash: generation.draftHash,
    requiredPageIds: generation.pages.map((page) => page.pageId),
    imageExposures: [],
    inspectedPageIds: [],
    findings: [],
    complete: generation.pages.length === 0,
    passed: generation.pages.length === 0 && generation.layoutValid,
    updatedAt: now,
  };
}

function assertCurrentVisualGeneration(
  ledger: DraftVisualReviewLedger,
  generation: DraftPreviewGeneration,
): void {
  if (
    ledger.generationId !== generation.generationId ||
    ledger.draftHash !== generation.draftHash
  ) {
    throw new Error('visual review belongs to a stale preview generation');
  }
}

function exposureMatchesPage(
  exposure: DraftVisualReviewLedger['imageExposures'][number],
  generation: DraftPreviewGeneration,
  page: DraftPreviewPage,
): boolean {
  return (
    exposure.generationId === generation.generationId &&
    exposure.pageId === page.pageId &&
    exposure.imageResourceId === page.image.resourceId &&
    exposure.imageDigest === page.image.digest &&
    exposure.layoutDigest === page.layoutDigest &&
    Number.isInteger(exposure.readRequestedAtProviderCall) &&
    exposure.readRequestedAtProviderCall >= 0
  );
}

/**
 * Record exact rendered-image receipts after the read tool has selected the
 * current generation's pages. This is intentionally separate from visual
 * inspection: loading pixels permits review; it does not claim review.
 */
export function recordVisualImageExposures(
  ledger: DraftVisualReviewLedger,
  generation: DraftPreviewGeneration,
  pages: readonly DraftPreviewPage[],
  input: {
    readonly now: string;
    readonly providerCallCount: number;
  },
): DraftVisualReviewLedger {
  assertCurrentVisualGeneration(ledger, generation);
  if (!Number.isInteger(input.providerCallCount) || input.providerCallCount < 0) {
    throw new Error('preview image exposure has an invalid provider-call checkpoint');
  }
  const currentPages = new Map(generation.pages.map((page) => [page.pageId, page]));
  const exposures = new Map(
    (ledger.imageExposures ?? []).map((exposure) => [exposure.pageId, exposure]),
  );
  for (const page of pages) {
    const current = currentPages.get(page.pageId);
    if (
      current === undefined ||
      current.image.resourceId !== page.image.resourceId ||
      current.image.digest !== page.image.digest ||
      current.layoutDigest !== page.layoutDigest
    ) {
      throw new Error(`preview image exposure named stale or unknown page ${page.pageId}`);
    }
    const previous = exposures.get(page.pageId);
    if (previous !== undefined && !exposureMatchesPage(previous, generation, current)) {
      throw new Error(`preview image exposure for ${page.pageId} changed within one generation`);
    }
    // Keep the earliest exact-image receipt. Re-reading the same immutable
    // render in the turn that records findings must not erase proof that the
    // provider already saw it on an earlier turn.
    if (previous === undefined) {
      exposures.set(page.pageId, {
        generationId: generation.generationId,
        pageId: page.pageId,
        imageResourceId: page.image.resourceId,
        imageDigest: page.image.digest,
        layoutDigest: page.layoutDigest,
        readRequestedAtProviderCall: input.providerCallCount,
        exposedAt: input.now,
      });
    }
  }
  return {
    ...ledger,
    imageExposures: [...exposures.values()].sort((a, b) =>
      a.pageId.localeCompare(b.pageId),
    ),
    updatedAt: input.now,
  };
}

export function visualImageExposurePageIds(
  ledger: DraftVisualReviewLedger,
  generation: DraftPreviewGeneration,
): readonly string[] {
  if (
    ledger.generationId !== generation.generationId ||
    ledger.draftHash !== generation.draftHash
  ) {
    return [];
  }
  const exposureByPage = new Map(
    (ledger.imageExposures ?? []).map((exposure) => [exposure.pageId, exposure]),
  );
  return generation.pages
    .filter((page) => {
      const exposure = exposureByPage.get(page.pageId);
      return exposure !== undefined && exposureMatchesPage(exposure, generation, page);
    })
    .map((page) => page.pageId);
}

export function recordVisualInspection(
  ledger: DraftVisualReviewLedger,
  generation: DraftPreviewGeneration,
  input: {
    readonly pageIds: readonly string[];
    readonly findings: readonly DraftVisualFinding[];
    readonly providerCallCount: number;
    readonly now: string;
  },
): DraftVisualReviewLedger {
  assertCurrentVisualGeneration(ledger, generation);
  if (!Number.isInteger(input.providerCallCount) || input.providerCallCount < 0) {
    throw new Error('visual inspection has an invalid provider-call checkpoint');
  }
  const required = new Set(ledger.requiredPageIds);
  const currentExposures = (ledger.imageExposures ?? []).filter((exposure) => {
    const page = generation.pages.find((candidate) => candidate.pageId === exposure.pageId);
    return page !== undefined && exposureMatchesPage(exposure, generation, page);
  });
  const exposed = new Map(currentExposures.map((exposure) => [exposure.pageId, exposure]));
  for (const pageId of input.pageIds) {
    if (!required.has(pageId)) {
      throw new Error(`visual review named unknown page ${pageId}`);
    }
    const exposure = exposed.get(pageId);
    if (exposure === undefined) {
      throw new Error(
        `visual review page ${pageId} has not been exposed by read_draft_preview_pages for this generation`,
      );
    }
    if (input.providerCallCount <= exposure.readRequestedAtProviderCall) {
      throw new Error(
        `visual review page ${pageId} requires a provider turn after read_draft_preview_pages exposed its image`,
      );
    }
  }
  for (const finding of input.findings) {
    if (
      finding.generationId !== generation.generationId ||
      !required.has(finding.pageId)
    ) {
      throw new Error('visual finding belongs to a stale or unknown page');
    }
  }
  const inspectedPageIds = sortedUnique([
    ...ledger.inspectedPageIds,
    ...input.pageIds,
  ]);
  const findingById = new Map(ledger.findings.map((finding) => [finding.id, finding]));
  for (const finding of input.findings) findingById.set(finding.id, finding);
  const findings = [...findingById.values()];
  const complete = ledger.requiredPageIds.every((id) =>
    inspectedPageIds.includes(id),
  );
  const blocking = findings.some(
    (finding) => finding.severity === 'blocking' && !finding.resolved,
  );
  return {
    ...ledger,
    inspectedPageIds,
    findings,
    complete,
    passed: complete && generation.layoutValid && !blocking,
    updatedAt: input.now,
  };
}

export function visualPagesRemaining(
  ledger: DraftVisualReviewLedger,
): readonly string[] {
  const inspected = new Set(ledger.inspectedPageIds);
  return ledger.requiredPageIds.filter((id) => !inspected.has(id));
}
