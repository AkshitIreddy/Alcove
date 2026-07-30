/**
 * src/search/recents.ts — recently-opened books for recency-weighted results.
 *
 * A tiny localStorage-backed MRU list (most recent first, capped). Recorded
 * by the quick switcher and the search jump flow; exported so other features
 * (shelf "sort by recent", continue-reading ribbons) can reuse it.
 * Storage failures (private mode, quota) degrade to "no recency data".
 */

const STORAGE_KEY = 'nb-recent-books';
const MAX_RECENTS = 12;

/** Book ids, most recently opened first. */
export function recentBookIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === 'string')
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** Move `bookId` to the front of the MRU list. */
export function recordBookOpened(bookId: string): void {
  try {
    const next = [bookId, ...recentBookIds().filter((id) => id !== bookId)];
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(next.slice(0, MAX_RECENTS)),
    );
  } catch {
    // Best-effort — recency is a ranking nicety only.
  }
}

/**
 * Additive fuzzy-score boost for a book by MRU position (front ≈ +24,
 * decaying ~3 per step; 0 when not recent). Pass a prefetched list when
 * scoring many candidates.
 */
export function recencyBoost(bookId: string, recents?: readonly string[]): number {
  const list = recents ?? recentBookIds();
  const index = list.indexOf(bookId);
  return index < 0 ? 0 : Math.max(0, 24 - index * 3);
}
