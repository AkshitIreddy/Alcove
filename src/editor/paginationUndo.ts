import type { PageDoc } from '../data/types';
import { appendBlocksToDoc } from '../views/spread';

export interface PaginationUndoLeg {
  readonly sourcePageId: string;
  readonly targetPageId: string;
  readonly moved: readonly Record<string, unknown>[];
  readonly targetBefore: PageDoc;
  readonly targetAfter: PageDoc;
  readonly createdTarget: boolean;
}

export function samePageDoc(left: PageDoc, right: PageDoc): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Reverse layout-only carry legs while leaving the authored edit in place.
 * ProseMirror can then undo that edit normally, preserving its redo history.
 */
export function reversePaginationLegs(
  current: ReadonlyMap<string, PageDoc>,
  legs: readonly PaginationUndoLeg[],
  fallbackAttrs: Record<string, unknown>,
): Map<string, PageDoc> | null {
  const next = new Map(current);
  for (const leg of [...legs].reverse()) {
    const source = next.get(leg.sourcePageId);
    const target = next.get(leg.targetPageId);
    if (source === undefined || target === undefined || !samePageDoc(target, leg.targetAfter)) {
      return null;
    }
    next.set(
      leg.sourcePageId,
      appendBlocksToDoc(source, leg.moved, fallbackAttrs),
    );
    next.set(leg.targetPageId, leg.targetBefore);
  }
  return next;
}
