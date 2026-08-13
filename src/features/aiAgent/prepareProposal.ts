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
      (await hash.digestJson(actual)) !==
        (await hash.digestJson(input.pages[index]!.doc))
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
