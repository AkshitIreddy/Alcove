/**
 * Immutable handoff from native draft rendering to the approval apply seam.
 *
 * A receipt contains the exact post-pagination PageDocs the model inspected,
 * plus the content-addressed searched-image assets used to render them. It is
 * intentionally outside AgentState: large editor JSON and provider-neutral
 * checkpoints should not carry duplicate page bodies or mutable display URLs.
 */
import type { PageDoc } from '../../data/types';
import type { FetchedImageAssetReceipt } from '../../editor/media/assets';
import type { AgentHashAdapter } from './adapters';
import type { NotebookInsertionTarget } from './types';

export const REVIEWED_DRAFT_RECEIPT_VERSION = 2 as const;

export interface ReviewedDraftReceiptPage {
  readonly source: string;
  readonly doc: PageDoc;
  readonly protectedStart: boolean;
}

export type IntegratedNotebookInsertionTarget = Extract<
  NotebookInsertionTarget,
  { readonly kind: 'caret' | 'replace_selection' }
>;

export type StructuralNotebookInsertionTarget = Exclude<
  NotebookInsertionTarget,
  IntegratedNotebookInsertionTarget
>;

/**
 * Exact installation recipe whose output produced the reviewed screenshots.
 * An integrated target replaces one existing page with `pages[0]` and inserts
 * only the already-paginated continuation docs after it. Structural targets
 * retain the existing fresh-page insertion path.
 */
export type ReviewedDraftApplicationPlan =
  | {
      readonly kind: 'integrated_target';
      readonly insertionTarget: IntegratedNotebookInsertionTarget;
      readonly targetPageId: string;
      readonly expectedTargetRevision: string;
      readonly expectedTargetDocumentDigest: string;
      readonly reviewedTargetDocumentDigest: string;
      readonly targetPageIndex: 0;
      readonly insertedPageStartIndex: 1;
    }
  | {
      readonly kind: 'structural_pages';
      readonly insertionTarget: StructuralNotebookInsertionTarget;
    };

export interface ReviewedDraftReceiptBody {
  readonly version: typeof REVIEWED_DRAFT_RECEIPT_VERSION;
  readonly generationId: string;
  readonly draftHash: string;
  readonly layoutHash: string;
  readonly bookSnapshotRevision: string;
  readonly rendererVersion: string;
  readonly applicationPlan: ReviewedDraftApplicationPlan;
  readonly pages: readonly ReviewedDraftReceiptPage[];
  readonly fetchedAssets: readonly FetchedImageAssetReceipt[];
}

export interface ReviewedDraftReceipt extends ReviewedDraftReceiptBody {
  readonly receiptDigest: string;
}

/**
 * PageEditor documents are JSON storage documents, but a freshly mounted
 * node can still carry an optional property whose value is `undefined` (for
 * example a page's unset `ruleGapPx`). SQLite stores the receipt through
 * JSON.stringify, which omits that property. Hashing the pre-serialization
 * object and then verifying the parsed object therefore made a brand-new
 * review fail its own receipt.
 *
 * Canonicalize at this narrow handoff instead of changing the shared Agent
 * hash. Existing notebook/source/cache hashes keep their identities, while
 * the exact pages returned here are byte-for-byte the pages durable storage
 * will later return to the apply seam.
 */
function canonicalReceiptBody(
  body: ReviewedDraftReceiptBody,
): ReviewedDraftReceiptBody {
  return JSON.parse(JSON.stringify(body)) as ReviewedDraftReceiptBody;
}

export async function createReviewedDraftReceipt(
  body: ReviewedDraftReceiptBody,
  hash: AgentHashAdapter,
): Promise<ReviewedDraftReceipt> {
  const canonical = canonicalReceiptBody(body);
  return {
    ...canonical,
    receiptDigest: await hash.digestJson(canonical),
  };
}

export async function verifyReviewedDraftReceipt(
  receipt: ReviewedDraftReceipt,
  expected: {
    readonly generationId: string;
    readonly draftHash: string;
    readonly layoutHash: string;
    readonly bookSnapshotRevision: string;
    readonly insertionTarget?: NotebookInsertionTarget;
  },
  hash: AgentHashAdapter,
): Promise<boolean> {
  if (
    receipt === null ||
    typeof receipt !== 'object' ||
    receipt.version !== REVIEWED_DRAFT_RECEIPT_VERSION ||
    typeof receipt.receiptDigest !== 'string' ||
    receipt.generationId !== expected.generationId ||
    receipt.draftHash !== expected.draftHash ||
    receipt.layoutHash !== expected.layoutHash ||
    receipt.bookSnapshotRevision !== expected.bookSnapshotRevision ||
    !isApplicationPlan(receipt.applicationPlan) ||
    !Array.isArray(receipt.pages) ||
    receipt.pages.length === 0 ||
    !receipt.pages.every(
      (page) =>
        page !== null &&
        typeof page === 'object' &&
        typeof page.source === 'string' &&
        typeof page.protectedStart === 'boolean' &&
        page.doc !== null &&
        typeof page.doc === 'object',
    ) ||
    !Array.isArray(receipt.fetchedAssets)
  ) {
    return false;
  }
  if (
    expected.insertionTarget !== undefined &&
    (await hash.digestJson(receipt.applicationPlan.insertionTarget)) !==
      (await hash.digestJson(expected.insertionTarget))
  ) {
    return false;
  }
  if (
    receipt.applicationPlan.kind === 'integrated_target' &&
    (
      receipt.pages.length === 0 ||
      receipt.pages[0]?.protectedStart !== false ||
      receipt.applicationPlan.targetPageId !==
        receipt.applicationPlan.insertionTarget.pageId
    )
  ) {
    return false;
  }
  const { receiptDigest, ...body } = receipt;
  return (await hash.digestJson(body)) === receiptDigest;
}

function isApplicationPlan(value: unknown): value is ReviewedDraftApplicationPlan {
  if (value === null || typeof value !== 'object') return false;
  const plan = value as Partial<ReviewedDraftApplicationPlan> & {
    readonly insertionTarget?: Partial<NotebookInsertionTarget>;
  };
  if (plan.insertionTarget === null || typeof plan.insertionTarget !== 'object') {
    return false;
  }
  if (plan.kind === 'structural_pages') {
    return !['caret', 'replace_selection'].includes(
      String(plan.insertionTarget.kind ?? ''),
    );
  }
  return (
    plan.kind === 'integrated_target' &&
    ['caret', 'replace_selection'].includes(String(plan.insertionTarget.kind ?? '')) &&
    typeof plan.targetPageId === 'string' &&
    typeof plan.expectedTargetRevision === 'string' &&
    typeof plan.expectedTargetDocumentDigest === 'string' &&
    typeof plan.reviewedTargetDocumentDigest === 'string' &&
    plan.targetPageIndex === 0 &&
    plan.insertedPageStartIndex === 1
  );
}

/** Prevent a consumer from mutating the in-memory/store-owned receipt. */
export function cloneReviewedDraftReceipt(
  receipt: ReviewedDraftReceipt,
): ReviewedDraftReceipt {
  return JSON.parse(JSON.stringify(receipt)) as ReviewedDraftReceipt;
}
