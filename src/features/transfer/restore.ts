/**
 * src/features/transfer/restore.ts — restore points: the "undo an import,
 * months later" guarantee.
 *
 * Before an import touches a single row, the affected rows are snapshotted
 * into a restore point: every row the import will CREATE (so revert can
 * delete exactly those) and a verbatim copy of every row it will MODIFY (so
 * revert can put them back). Points are stored durably by ./store and kept
 * for a long time — 90 days / last 20 by default, configurable up to
 * "forever".
 *
 * Reverting is itself an operation that gets its own restore point, so
 * "revert the revert" works too.
 *
 * All logic here is pure: retention, revert planning, and labelling.
 */

// ---------------------------------------------------------------------------
// Row snapshots — verbatim SQLite shapes, so restoring is a plain upsert
// ---------------------------------------------------------------------------

export interface BookRowSnapshot {
  id: string;
  title: string;
  floor: number;
  slot: number;
  spine_seed: number;
  cover_meta: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageRowSnapshot {
  id: string;
  book_id: string;
  ord: number;
  doc_json: string;
  script_source: string | null;
  source_dirty: number;
  updated_at: string;
}

export type RestorePointKind = 'import' | 'revert';

/**
 * A row the operation created. The owning book id travels with it so revert
 * can tell "delete this page" from "its whole book is going anyway".
 */
export interface CreatedPageRef {
  id: string;
  bookId: string;
}

export interface RestorePoint {
  id: string;
  /** User-facing label ("Imported study-notes.nbk"). */
  label: string;
  createdAt: string;
  kind: RestorePointKind;
  /** Bundle file name / source description. */
  source: string;
  counts: { books: number; pages: number };
  /** Rows the operation created — revert deletes these. */
  createdBooks: string[];
  createdPages: CreatedPageRef[];
  /** Verbatim rows as they were BEFORE the operation — revert re-inserts. */
  priorBooks: BookRowSnapshot[];
  priorPages: PageRowSnapshot[];
  /** For `kind: 'revert'`, the point this one undid. */
  revertOf: string | null;
  /** Set once this point has been reverted. */
  revertedAt: string | null;
  /** Id of the restore point produced by that revert. */
  revertedBy: string | null;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  /** Days to keep a point; 0 means forever. */
  maxAgeDays: number;
  /** Newest N points to keep; 0 means unlimited. */
  maxCount: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { maxAgeDays: 90, maxCount: 20 };

export const RETENTION_AGE_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: 'a year' },
  { value: 0, label: 'forever' },
];

export const RETENTION_COUNT_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 10, label: 'last 10' },
  { value: 20, label: 'last 20' },
  { value: 50, label: 'last 50' },
  { value: 0, label: 'all' },
];

export function normalizeRetention(raw: unknown): RetentionPolicy {
  const record =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const age = record.maxAgeDays;
  const count = record.maxCount;
  return {
    maxAgeDays:
      typeof age === 'number' && Number.isFinite(age) && age >= 0
        ? Math.round(age)
        : DEFAULT_RETENTION.maxAgeDays,
    maxCount:
      typeof count === 'number' && Number.isFinite(count) && count >= 0
        ? Math.round(count)
        : DEFAULT_RETENTION.maxCount,
  };
}

const DAY_MS = 86_400_000;

/**
 * Split points into keepers and expirees. Newest first on the way in and out.
 *
 * Two safety rails: a point that a kept revert points back at is always kept
 * (history must stay readable), and a point that has never been reverted and
 * is the only record of its rows is still subject to the policy — but the
 * policy defaults are deliberately generous.
 */
export function applyRetention(
  points: readonly RestorePoint[],
  policy: RetentionPolicy,
  now: Date = new Date(),
): { keep: RestorePoint[]; drop: RestorePoint[] } {
  const sorted = [...points].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  const nowMs = now.getTime();
  const keep: RestorePoint[] = [];
  const drop: RestorePoint[] = [];

  sorted.forEach((point, index) => {
    const age = nowMs - Date.parse(point.createdAt);
    const tooOld =
      policy.maxAgeDays > 0 && Number.isFinite(age) && age > policy.maxAgeDays * DAY_MS;
    const tooMany = policy.maxCount > 0 && index >= policy.maxCount;
    (tooOld || tooMany ? drop : keep).push(point);
  });

  // Rescue points referenced by a kept revert.
  const referenced = new Set(
    keep.map((point) => point.revertOf).filter((id): id is string => id !== null),
  );
  for (let i = drop.length - 1; i >= 0; i -= 1) {
    if (referenced.has(drop[i].id)) keep.push(...drop.splice(i, 1));
  }
  keep.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { keep, drop };
}

/**
 * Second-stage guard: history lives in one settings row, so a runaway import
 * must not balloon it. Drops oldest points until the serialized size fits.
 * Always keeps at least the newest point.
 */
export function pruneForSize(
  points: readonly RestorePoint[],
  maxBytes: number,
): { keep: RestorePoint[]; drop: RestorePoint[] } {
  const sorted = [...points].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  const keep: RestorePoint[] = [];
  const drop: RestorePoint[] = [];
  let used = 0;
  for (const point of sorted) {
    const size = JSON.stringify(point).length;
    if (keep.length > 0 && used + size > maxBytes) drop.push(point);
    else {
      keep.push(point);
      used += size;
    }
  }
  return { keep, drop };
}

// ---------------------------------------------------------------------------
// Revert planning
// ---------------------------------------------------------------------------

export interface LibraryRowIds {
  bookIds: ReadonlySet<string>;
  pageIds: ReadonlySet<string>;
}

export interface RevertPlan {
  /** Books this import created that are still on the shelf. */
  deleteBookIds: string[];
  /** Pages this import appended that still exist (in books we keep). */
  deletePageIds: string[];
  /** Rows to put back exactly as they were. */
  restoreBooks: BookRowSnapshot[];
  restorePages: PageRowSnapshot[];
  /** Rows that were already deleted by hand — reported, never an error. */
  missing: { books: number; pages: number };
  summary: string[];
  empty: boolean;
}

/**
 * Plan the undo of a restore point against the library as it stands *now*.
 *
 * Safety: only rows this point recorded as created are deleted, and only if
 * they still exist. Pages inside a book that is itself being deleted are not
 * listed separately (the book delete cascades) — but they are still counted.
 */
export function planRevert(
  point: RestorePoint,
  current: LibraryRowIds,
): RevertPlan {
  const deleteBookIds = point.createdBooks.filter((id) => current.bookIds.has(id));
  const doomed = new Set(deleteBookIds);
  const survivingPages = point.createdPages.filter((ref) => current.pageIds.has(ref.id));
  // Pages inside a book we are deleting need no separate DELETE (cascade),
  // but they still count as removed.
  const deletePageIds = survivingPages
    .filter((ref) => !doomed.has(ref.bookId))
    .map((ref) => ref.id);

  const restoreBooks = point.priorBooks;
  const restorePages = point.priorPages;
  const missing = {
    books: point.createdBooks.length - deleteBookIds.length,
    pages: point.createdPages.length - survivingPages.length,
  };

  const summary: string[] = [];
  if (deleteBookIds.length > 0) {
    summary.push(
      `Remove ${deleteBookIds.length} imported book${deleteBookIds.length === 1 ? '' : 's'} from the shelf`,
    );
  }
  if (deletePageIds.length > 0) {
    summary.push(
      `Remove ${deletePageIds.length} imported page${deletePageIds.length === 1 ? '' : 's'}`,
    );
  }
  if (restoreBooks.length > 0 || restorePages.length > 0) {
    summary.push(
      `Put back ${restoreBooks.length + restorePages.length} row${restoreBooks.length + restorePages.length === 1 ? '' : 's'} exactly as they were`,
    );
  }
  if (missing.books > 0 || missing.pages > 0) {
    summary.push(
      `${missing.books + missing.pages} item${missing.books + missing.pages === 1 ? ' was' : 's were'} already deleted by hand — left alone`,
    );
  }
  const empty =
    deleteBookIds.length === 0 &&
    deletePageIds.length === 0 &&
    restoreBooks.length === 0 &&
    restorePages.length === 0;
  if (empty) summary.push('Nothing left to undo — this import is already gone');

  return {
    deleteBookIds,
    deletePageIds,
    restoreBooks,
    restorePages,
    missing,
    summary,
    empty,
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** "just now" / "6 minutes ago" / "3 days ago" / "on 12 Mar 2026". */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'at an unknown time';
  const diff = now.getTime() - then;
  if (diff < 45_000) return 'just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(diff / DAY_MS);
  if (days <= 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const date = new Date(then);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `on ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

/** "3 books · 18 pages · 6 days ago" for the history row. */
export function describeRestorePoint(
  point: RestorePoint,
  now: Date = new Date(),
): string {
  const parts = [
    `${point.counts.books} book${point.counts.books === 1 ? '' : 's'}`,
    `${point.counts.pages} page${point.counts.pages === 1 ? '' : 's'}`,
    formatWhen(point.createdAt, now),
  ];
  return parts.join(' · ');
}

/** Days remaining before retention drops this point (null = forever). */
export function expiresInDays(
  point: RestorePoint,
  policy: RetentionPolicy,
  now: Date = new Date(),
): number | null {
  if (policy.maxAgeDays <= 0) return null;
  const age = now.getTime() - Date.parse(point.createdAt);
  if (!Number.isFinite(age)) return null;
  return Math.max(0, Math.ceil(policy.maxAgeDays - age / DAY_MS));
}
