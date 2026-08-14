/** Convert an approved Notebook Script proposal into real storage documents. */
import {
  sqliteReviewedDraftReceiptStore,
  type ReviewedDraftReceiptStore,
} from '../../data/aiAgentReviewedDraft';
import type { PageDoc } from '../../data/types';
import {
  promoteFetchedImageAssets,
  rollbackFetchedImageAssetPromotions,
  missingFetchedImageAssetIds,
  type FetchedImageAssetReceipt,
} from '../../editor/media/assets';
import type { AgentHashAdapter } from './adapters';
import { webCryptoAgentHash } from './adapters';
import { loadReviewedDraftReceipt } from './draftSandbox';
import type { NotebookPatchProposal } from './types';
import type { ReviewedDraftApplicationPlan } from './reviewedReceipt';
import { jsonStorageCanonicalPageDoc } from './pageDocStorage';

export { jsonStorageCanonicalPageDoc } from './pageDocStorage';

export interface PreparedAiProposalPage {
  readonly source: string;
  readonly doc: PageDoc;
  readonly protectedStart: boolean;
}

export interface PreparedAiProposalApplication {
  readonly pages: readonly PreparedAiProposalPage[];
  readonly plan: ReviewedDraftApplicationPlan;
  readonly promotedAssets: readonly FetchedImageAssetReceipt[];
  readonly newlyPromotedAssetIds: readonly string[];
}

export interface PrepareAiProposalOptions {
  readonly receiptStore?: ReviewedDraftReceiptStore;
  readonly hash?: AgentHashAdapter;
  readonly promoteAssets?: (
    assets: readonly FetchedImageAssetReceipt[],
  ) => Promise<void>;
}

export type ReviewedPagePlacement =
  | { readonly kind: 'at_start' }
  | { readonly kind: 'before'; readonly anchorPageId: string }
  | { readonly kind: 'after'; readonly anchorPageId: string }
  | { readonly kind: 'integrated'; readonly targetPageId: string };

/**
 * Prove that the reviewed page ids still form the exact run BookView placed.
 * Document receipts alone cannot detect an unrelated spill/reorder landing
 * between two reviewed leaves, or a structurally valid run appearing on the
 * wrong side of its reviewed anchor.
 */
export function verifyPreparedAiProposalPlacement(input: {
  readonly orderedPageIds: readonly string[];
  readonly reviewedPageIds: readonly string[];
  readonly placement: ReviewedPagePlacement;
}): void {
  const { orderedPageIds, reviewedPageIds, placement } = input;
  if (
    reviewedPageIds.length === 0 ||
    new Set(reviewedPageIds).size !== reviewedPageIds.length ||
    new Set(orderedPageIds).size !== orderedPageIds.length
  ) {
    throw new Error('The reviewed pages did not settle into one valid page run');
  }

  const firstIndex = orderedPageIds.indexOf(reviewedPageIds[0]!);
  const actualRun = firstIndex < 0
    ? []
    : orderedPageIds.slice(firstIndex, firstIndex + reviewedPageIds.length);
  if (
    firstIndex < 0 ||
    actualRun.length !== reviewedPageIds.length ||
    actualRun.some((pageId, index) => pageId !== reviewedPageIds[index])
  ) {
    throw new Error('The reviewed pages changed order while the application was settling');
  }

  if (placement.kind === 'at_start') {
    if (firstIndex !== 0) {
      throw new Error('The reviewed pages no longer begin this notebook');
    }
    return;
  }
  if (placement.kind === 'integrated') {
    if (reviewedPageIds[0] !== placement.targetPageId) {
      throw new Error('The reviewed integrated page no longer owns its target');
    }
    return;
  }

  const anchorIndex = orderedPageIds.indexOf(placement.anchorPageId);
  if (anchorIndex < 0) {
    throw new Error('The reviewed insertion anchor disappeared while settling');
  }
  const expectedFirst = placement.kind === 'before'
    ? anchorIndex - reviewedPageIds.length
    : anchorIndex + 1;
  if (firstIndex !== expectedFirst) {
    throw new Error('The reviewed pages moved away from their approved placement');
  }
}

/**
 * Consume the exact post-pagination documents that produced the reviewed
 * render. There is deliberately no parser, search or network fallback here:
 * if the durable receipt is missing, stale or tampered with, the reader must
 * refresh the preview rather than apply different bytes than they approved.
 */
export async function prepareAiProposalApplication(
  proposal: Pick<
    NotebookPatchProposal,
    'draftHash' | 'expectedBookRevision' | 'preview'
  >,
  options: PrepareAiProposalOptions = {},
): Promise<PreparedAiProposalApplication> {
  const receipt = await loadReviewedDraftReceipt(
    {
      generationId: proposal.preview.generationId,
      draftHash: proposal.draftHash,
      layoutHash: proposal.preview.layoutHash,
      bookSnapshotRevision: proposal.expectedBookRevision,
      insertionTarget: proposal.preview.insertionTarget,
    },
    {
      store: options.receiptStore ?? sqliteReviewedDraftReceiptStore,
      hash: options.hash ?? webCryptoAgentHash,
    },
  );
  if (receipt === null) {
    throw new Error(
      'The exact reviewed draft is no longer available. Refresh the preview before inserting.',
    );
  }
  if (receipt.pages.length !== proposal.preview.expectedPageCount) {
    throw new Error(
      'The reviewed draft receipt no longer matches the preview page count.',
    );
  }
  const newlyPromotedAssetIds = await missingFetchedImageAssetIds(receipt.fetchedAssets);
  try {
    await (options.promoteAssets ?? promoteFetchedImageAssets)(receipt.fetchedAssets);
  } catch (error) {
    await rollbackFetchedImageAssetPromotions(
      receipt.fetchedAssets,
      newlyPromotedAssetIds,
    ).catch(() => undefined);
    throw error;
  }
  return {
    plan: JSON.parse(JSON.stringify(receipt.applicationPlan)) as ReviewedDraftApplicationPlan,
    promotedAssets: receipt.fetchedAssets.map((asset) => ({ ...asset })),
    newlyPromotedAssetIds,
    pages: receipt.pages.map((page) => ({
      source: page.source,
      doc: JSON.parse(JSON.stringify(page.doc)) as PageDoc,
      protectedStart: page.protectedStart,
    })),
  };
}

export async function rollbackPreparedAiProposalAssets(
  application: Pick<
    PreparedAiProposalApplication,
    'promotedAssets' | 'newlyPromotedAssetIds'
  >,
): Promise<void> {
  await rollbackFetchedImageAssetPromotions(
    application.promotedAssets,
    application.newlyPromotedAssetIds,
  );
}

/** Verify every settled destination against the immutable reviewed receipt. */
export async function verifyPreparedAiProposalDocuments(input: {
  readonly pageIds: readonly string[];
  readonly pages: readonly PreparedAiProposalPage[];
  readonly readPageDoc: (pageId: string) => PageDoc | null | Promise<PageDoc | null>;
  readonly hash?: AgentHashAdapter;
}): Promise<void> {
  if (input.pageIds.length !== input.pages.length) {
    throw new Error('The reviewed pages did not all install');
  }
  const hash = input.hash ?? webCryptoAgentHash;
  for (let index = 0; index < input.pageIds.length; index += 1) {
    const actual = await input.readPageDoc(input.pageIds[index]!);
    if (actual === null) throw new Error('A reviewed page disappeared while settling');
    if (
      (await hash.digestJson(jsonStorageCanonicalPageDoc(actual))) !==
        (await hash.digestJson(
          jsonStorageCanonicalPageDoc(input.pages[index]!.doc),
        ))
    ) {
      throw new Error(
        'A page changed while the exact reviewed application was settling. The notebook was restored.',
      );
    }
  }
}

/** Back-compatible page-only reader for structural consumers and focused QA. */
export async function prepareAiProposalPages(
  proposal: Pick<
    NotebookPatchProposal,
    'draftHash' | 'expectedBookRevision' | 'preview'
  >,
  options: PrepareAiProposalOptions = {},
): Promise<readonly PreparedAiProposalPage[]> {
  return (await prepareAiProposalApplication(proposal, options)).pages;
}
