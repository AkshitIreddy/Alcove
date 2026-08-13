/** Pure approval gate kept outside JSX so it can be pinned in Node tests. */
export interface AiAgentPreviewGateInput {
  readonly isolated: true;
  readonly review: { readonly status: string };
  readonly parser: { readonly status: string };
  readonly layout: { readonly status: string };
  readonly pages: readonly unknown[];
}

export interface AiAgentPreviewPageLayoutInput {
  /** Resolved flow onto a generated continuation leaf. */
  readonly paginationSpill?: boolean;
  /** Content still outside the fixed page after the drain settled. */
  readonly residualOverflow?: boolean;
}

export interface AiAgentPreviewLayoutView {
  readonly status: 'passed' | 'failed';
  readonly label: string;
}

/**
 * A generated continuation leaf is pagination doing its job. Only residual
 * overflow may fail the final-preview layout badge/gate.
 */
export function previewLayoutView(
  pages: readonly AiAgentPreviewPageLayoutInput[],
): AiAgentPreviewLayoutView {
  if (pages.some((page) => page.residualOverflow === true)) {
    return { status: 'failed', label: 'Unresolved page overflow' };
  }
  if (pages.some((page) => page.paginationSpill === true)) {
    return { status: 'passed', label: 'Pagination flowed safely' };
  }
  return { status: 'passed', label: 'Layout fits' };
}

export function canPresentFinalPreview<T extends AiAgentPreviewGateInput>(
  preview: T | undefined,
): preview is T {
  return (
    preview !== undefined &&
    preview.isolated === true &&
    preview.review.status === 'passed' &&
    preview.parser.status !== 'failed' &&
    preview.layout.status !== 'failed' &&
    preview.pages.length > 0
  );
}
