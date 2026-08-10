/** Pure scope helpers for Ctrl+K. Kept outside Solid so the rule unit-tests. */

export type SearchRoom = 'shelf' | 'book';

/** The shelf searches the library; an open book searches only itself. */
export function searchScopeBookId(
  room: SearchRoom,
  openBookId: string | null,
): string | null {
  return room === 'book' ? openBookId : null;
}

export function inSearchScope<T>(
  rows: readonly T[],
  scopeBookId: string | null,
  bookIdOf: (row: T) => string,
): T[] {
  return scopeBookId === null
    ? [...rows]
    : rows.filter((row) => bookIdOf(row) === scopeBookId);
}
