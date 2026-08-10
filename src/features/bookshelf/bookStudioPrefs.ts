/**
 * Per-book Book Studio preferences.
 *
 * Appearance belongs to `cover_meta.style`; interaction intent does not. A
 * Surprise lock says "keep this decision next time" rather than changing how
 * a spine is rendered, so it lives in its own small, versioned `studio`
 * envelope. Keeping that distinction prevents renderer/cache keys from being
 * polluted by controls which do not affect pixels.
 */
import {
  BOOK_SURPRISE_LOCK_IDS,
  normalizeBookSurpriseLocks,
  type BookSurpriseLockSet,
} from '../../art/bookSurprise';
import {
  mergeCoverMetaSection,
  mutateBookCoverMeta,
} from '../../data/books';
import type { Book } from '../../data/types';

export const BOOK_STUDIO_PREFS_VERSION = 1 as const;

export interface BookStudioPrefs {
  version: typeof BOOK_STUDIO_PREFS_VERSION;
  surpriseLocks: BookSurpriseLockSet;
}

const EMPTY_LOCKS = Object.freeze([]) as BookSurpriseLockSet;
const KNOWN_LOCK_IDS = new Set<string>(BOOK_SURPRISE_LOCK_IDS);
/**
 * Locks from surfaces deliberately destroyed by the book reset. They are not
 * future extensions: preserving them would resurrect invisible promises in a
 * newer envelope and make Surprise behave as if deleted controls still exist.
 */
const RETIRED_LOCK_IDS = new Set<string>([
  'title.scale',
  'title.space',
  'charm.kind',
  'charm.colour',
  'cover.medallion',
  'cover.corners',
  'cover.inset',
]);

function objectRecord(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

/**
 * Values in a newer lock vocabulary are opaque to this build. Keep them byte
 * for byte (including order, duplicates, and non-string future encodings)
 * while replacing only the lock ids this build understands.
 */
function unknownLockEntries(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry) =>
    typeof entry !== 'string'
      || (!KNOWN_LOCK_IDS.has(entry) && !RETIRED_LOCK_IDS.has(entry)),
  );
}

function isFutureEnvelope(record: Record<string, unknown>): boolean {
  return typeof record.version === 'number'
    && Number.isFinite(record.version)
    && record.version > BOOK_STUDIO_PREFS_VERSION;
}

/**
 * Total reader for persisted Studio state. Unknown keys and obsolete lock ids
 * are discarded by the generator-owned normalizer rather than poisoning the
 * whole panel.
 */
export function normalizeBookStudioPrefs(raw: unknown): BookStudioPrefs {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      version: BOOK_STUDIO_PREFS_VERSION,
      surpriseLocks: EMPTY_LOCKS,
    };
  }
  const record = raw as Record<string, unknown>;
  return {
    version: BOOK_STUDIO_PREFS_VERSION,
    surpriseLocks: normalizeBookSurpriseLocks(record.surpriseLocks),
  };
}

/** Locks hydrated from a Book row already owned by the caller. */
export function bookSurpriseLocksFor(
  book: Pick<Book, 'coverMeta'> | null | undefined,
): BookSurpriseLockSet {
  return normalizeBookStudioPrefs(book?.coverMeta?.studio).surpriseLocks;
}

/** Pure persisted representation; an empty set removes the whole section. */
export function bookStudioPrefsSection(
  locks: BookSurpriseLockSet,
): Record<string, unknown> | null {
  const normalized = normalizeBookSurpriseLocks(locks);
  if (normalized.length === 0) return null;
  return {
    version: BOOK_STUDIO_PREFS_VERSION,
    surpriseLocks: [...normalized],
  };
}

/**
 * Merge the complete known-lock selection into an envelope read from disk.
 *
 * This build owns its declared lock ids, not the whole object. A future build
 * may add envelope fields or lock ids, so replacing `studio` with a freshly
 * serialized v1 object would silently erase state when an older app merely
 * toggled one familiar lock. The merge therefore:
 *
 * - replaces known ids with the caller's canonical known set;
 * - preserves every unknown lock entry and every unknown envelope field;
 * - never rewrites a future version number;
 * - removes a truly empty, plain v1 envelope, preserving existing v1 UX.
 */
export function mergeBookStudioPrefsSection(
  raw: unknown,
  locks: BookSurpriseLockSet,
): Record<string, unknown> | null {
  const current = objectRecord(raw);
  const known = [...normalizeBookSurpriseLocks(locks)];
  if (current === null) return bookStudioPrefsSection(known);

  const future = isFutureEnvelope(current);
  // A newer schema may stop using an array altogether. There is no truthful
  // way for v1 to edit that representation, so refuse the write instead of
  // replacing an opaque future value with a v1 array.
  if (
    future
    && Object.prototype.hasOwnProperty.call(current, 'surpriseLocks')
    && !Array.isArray(current.surpriseLocks)
  ) {
    return current;
  }

  const hadLockArray = Array.isArray(current.surpriseLocks);
  const unknownLocks = unknownLockEntries(current.surpriseLocks);
  const surpriseLocks = [...unknownLocks, ...known];
  const next: Record<string, unknown> = { ...current };

  // A future envelope remains a future envelope. Supported or legacy data is
  // upgraded to the current writer version when it has something to retain.
  if (!future) next.version = BOOK_STUDIO_PREFS_VERSION;

  if (surpriseLocks.length > 0 || (future && hadLockArray)) {
    next.surpriseLocks = surpriseLocks;
  }
  else delete next.surpriseLocks;

  if (future) return next;

  // `version` is structural, not user state. Match the original v1 behavior
  // by deleting an envelope containing no locks and no extension fields.
  const extensionKeys = Object.keys(next).filter((key) =>
    key !== 'version' && key !== 'surpriseLocks',
  );
  if (surpriseLocks.length === 0 && extensionKeys.length === 0) return null;
  return next;
}

/**
 * Save through the same per-book lane as style, cover, page and shelf writes.
 * A rapid lock press beside a Surprise press therefore cannot resurrect an
 * older `cover_meta` blob.
 */
export function saveBookSurpriseLocks(
  bookId: string,
  locks: BookSurpriseLockSet,
): Promise<Book | null> {
  return mutateBookCoverMeta(bookId, (meta) => {
    const section = mergeBookStudioPrefsSection(meta?.studio, locks);
    return mergeCoverMetaSection(meta, 'studio', section);
  });
}
