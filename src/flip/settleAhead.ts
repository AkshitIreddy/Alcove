/**
 * Pure document surgery for offscreen pagination.
 *
 * The staged sheet may discover overflow before its page mounts. The caller
 * still owns the book, so this helper is deliberately a compare-and-swap: it
 * returns a plan only when the in-memory document is byte-for-byte the source
 * that was measured. A block count is not enough; an equal-length edit would
 * otherwise move the wrong tail.
 */
import type { PageDoc } from '../data/types';

export interface AheadSettlement {
  readonly trimmed: PageDoc;
  readonly moved: unknown[];
}

export function planAheadSettlement(
  current: PageDoc | undefined,
  source: PageDoc,
  remove: number,
  trailingPhantom: 0 | 1,
): AheadSettlement | null {
  if (current === undefined) return null;
  const content = current.content;
  const sourceContent = source.content;
  if (!Array.isArray(content) || !Array.isArray(sourceContent)) return null;
  if (!Number.isInteger(remove) || remove < 1) return null;
  if (JSON.stringify(current) !== JSON.stringify(source)) return null;

  const realEnd = content.length - trailingPhantom;
  if (realEnd < 2 || remove >= realEnd) return null;
  const cut = realEnd - remove;

  return {
    // A persisted TrailingNode paragraph stays at the source's tail. The live
    // PageEditor drain removes real blocks immediately before it too.
    trimmed: {
      ...current,
      content: [...content.slice(0, cut), ...content.slice(realEnd)],
    },
    moved: content.slice(cut, realEnd),
  };
}
