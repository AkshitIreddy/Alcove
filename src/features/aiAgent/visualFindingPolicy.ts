import type { DraftVisualFinding } from './types';

type FindingLike = Pick<DraftVisualFinding, 'severity' | 'category' | 'summary' | 'resolved'>;

const ALWAYS_BLOCKING_CATEGORIES = new Set<DraftVisualFinding['category']>([
  'overflow',
  'clipping',
  'collision',
  'illegible',
  'empty_page',
  'missing_media',
  'duplication',
]);

const EMPTY_OR_PLACEHOLDER_RESULT =
  /\b(?:blank\s+page|empty\s+page|no\s+(?:actual\s+)?content|without\s+(?:actual\s+)?content|placeholder(?:\s+note)?|receipt\s+note|only\s+(?:the\s+)?(?:alcove\s+)?(?:draft\s+)?receipt|missing\s+(?:the\s+)?(?:image|picture|media|content)|image\s+(?:is\s+)?(?:absent|missing|broken)|failed\s+to\s+(?:load|render)|gibberish|unreadable)\b/iu;

/**
 * The model describes pixels, but it does not own safety severity. Empty,
 * missing-media and unreadable results are blocking regardless of whether the
 * model labels them `info`, `warning`, `other`, or something more accurate.
 */
export function visualFindingRequiresRepair(finding: FindingLike): boolean {
  if (finding.resolved) return false;
  return finding.severity === 'blocking' ||
    ALWAYS_BLOCKING_CATEGORIES.has(finding.category) ||
    EMPTY_OR_PLACEHOLDER_RESULT.test(finding.summary);
}

export function normalizedVisualFindingSeverity(
  finding: FindingLike,
): DraftVisualFinding['severity'] {
  return visualFindingRequiresRepair(finding) ? 'blocking' : finding.severity;
}
