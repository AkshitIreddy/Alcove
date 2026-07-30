/**
 * Page history — periodic autosave snapshots with a restore picker
 * (roadmap #13, the "time-turner" panel).
 *
 * Storage design (documented decision):
 * - IN MEMORY: a ring of the last `MEMORY_CAP` (20) snapshots per page,
 *   fed by PageEditor's save flush (throttled to one snapshot per
 *   `MIN_SNAPSHOT_GAP_MS` so a typing burst does not shred the ring).
 * - PERSISTED: a lightweight tail of the ring — the last `PERSIST_CAP` (10)
 *   snapshots — stored in the existing `settings` table under the key
 *   `page_history:<pageId>` as one JSON blob. No schema change needed; the
 *   settings table is a plain key/value store and the app settings blob
 *   lives under the reserved key 'app'. Oversized docs are dropped from the
 *   persisted tail (never from memory) until the blob fits
 *   `PERSIST_MAX_JSON_CHARS`, so a page full of base64 images cannot bloat
 *   the database.
 *
 * All ring/trim logic is pure and exported for unit tests; only load/persist
 * touch the db.
 */
import { getDb } from '../../data/db';
import type { PageDoc } from '../../data/types';

export interface PageSnapshot {
  /** Capture time, ISO-8601. */
  readonly at: string;
  readonly doc: PageDoc;
}

export const MEMORY_CAP = 20;
export const PERSIST_CAP = 10;
export const MIN_SNAPSHOT_GAP_MS = 20_000;
export const PERSIST_MAX_JSON_CHARS = 240_000;

export const historyKey = (pageId: string): string => `page_history:${pageId}`;

/* ----------------------------------------------------------------------------
   Pure ring helpers (unit-tested in tests/editor-qol.test.ts)
   -------------------------------------------------------------------------- */

/**
 * Append `snapshot` to `ring` (newest last), dropping the oldest entries
 * beyond `cap`. Identical consecutive docs are skipped — a flush that saved
 * the same JSON adds nothing. Pure: returns a new array (or `ring` itself
 * when nothing changed).
 */
export function pushSnapshot(
  ring: readonly PageSnapshot[],
  snapshot: PageSnapshot,
  cap: number = MEMORY_CAP,
): readonly PageSnapshot[] {
  const last = ring[ring.length - 1];
  if (last && JSON.stringify(last.doc) === JSON.stringify(snapshot.doc)) {
    return ring;
  }
  const next = [...ring, snapshot];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * The persisted tail: newest `cap` snapshots, then oldest-first dropping
 * while the serialized blob would exceed `maxJsonChars`. Always keeps at
 * least the newest snapshot, however large.
 */
export function persistedTail(
  ring: readonly PageSnapshot[],
  cap: number = PERSIST_CAP,
  maxJsonChars: number = PERSIST_MAX_JSON_CHARS,
): readonly PageSnapshot[] {
  let tail = ring.slice(Math.max(0, ring.length - cap));
  while (tail.length > 1 && JSON.stringify(tail).length > maxJsonChars) {
    tail = tail.slice(1);
  }
  return tail;
}

/** Validate a stored blob back into snapshots (corrupt rows become []). */
export function parseStoredHistory(raw: unknown): PageSnapshot[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PageSnapshot =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { at?: unknown }).at === 'string' &&
        (entry as { doc?: { type?: unknown } }).doc?.type === 'doc',
    );
  } catch {
    return [];
  }
}

/* ----------------------------------------------------------------------------
   In-memory rings + throttle
   -------------------------------------------------------------------------- */

const rings = new Map<string, readonly PageSnapshot[]>();
const lastRecordedAt = new Map<string, number>();
/** Pages whose persisted history has been merged into the memory ring. */
const hydrated = new Set<string>();

/**
 * Record a snapshot of `doc` for `pageId` if the per-page throttle allows
 * it (or `force`). Persists the lightweight tail fire-and-forget.
 */
export function recordSnapshot(
  pageId: string,
  doc: PageDoc,
  options: { force?: boolean; now?: number } = {},
): void {
  const now = options.now ?? Date.now();
  const last = lastRecordedAt.get(pageId) ?? 0;
  if (!options.force && now - last < MIN_SNAPSHOT_GAP_MS) return;

  const ring = rings.get(pageId) ?? [];
  // Deep-copy through JSON so later editor mutations cannot reach into the
  // stored snapshot (doc JSON is plain data by contract).
  const snapshot: PageSnapshot = {
    at: new Date(now).toISOString(),
    doc: JSON.parse(JSON.stringify(doc)) as PageDoc,
  };
  const next = pushSnapshot(ring, snapshot);
  if (next === ring) return; // unchanged doc — no new snapshot, no persist
  rings.set(pageId, next);
  lastRecordedAt.set(pageId, now);
  void persist(pageId, next);
}

async function persist(
  pageId: string,
  ring: readonly PageSnapshot[],
): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      [historyKey(pageId), JSON.stringify(persistedTail(ring))],
    );
  } catch {
    // History persistence is best-effort; the in-memory ring still works.
  }
}

/**
 * Snapshots for a page, newest first (for the picker). Merges the persisted
 * tail (survives restarts) beneath the in-memory ring on first access.
 */
export async function listSnapshots(pageId: string): Promise<PageSnapshot[]> {
  if (!hydrated.has(pageId)) {
    hydrated.add(pageId);
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [historyKey(pageId)],
      );
      const stored = parseStoredHistory(rows[0]?.value);
      if (stored.length > 0) {
        const ring = rings.get(pageId) ?? [];
        const known = new Set(ring.map((s) => s.at));
        const merged = [...stored.filter((s) => !known.has(s.at)), ...ring]
          .sort((a, b) => a.at.localeCompare(b.at))
          .slice(-MEMORY_CAP);
        rings.set(pageId, merged);
      }
    } catch {
      // Unreadable history — the in-memory ring alone is fine.
    }
  }
  return [...(rings.get(pageId) ?? [])].reverse();
}

/** Test seam: drop all in-memory rings and hydration marks. */
export function resetHistoryForTests(): void {
  rings.clear();
  lastRecordedAt.clear();
  hydrated.clear();
}
