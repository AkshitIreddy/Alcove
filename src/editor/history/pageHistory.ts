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
/** One shared database read per page while hydration is in flight. */
const hydrationJobs = new Map<string, Promise<boolean>>();
/** Pages with an in-memory change that has not reached the database yet. */
const dirty = new Set<string>();

interface PersistRunner {
  running: boolean;
  requested: boolean;
}

/** Per-page writers. A page's older tail must never land after its newer one. */
const persistRunners = new Map<string, PersistRunner>();

/** Invalidates asynchronous work left behind by resetHistoryForTests(). */
let historyGeneration = 0;

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
  if (options.force || now - last >= MIN_SNAPSHOT_GAP_MS) {
    const ring = rings.get(pageId) ?? [];
    // Deep-copy through JSON so later editor mutations cannot reach into the
    // stored snapshot (doc JSON is plain data by contract).
    const snapshot: PageSnapshot = {
      at: new Date(now).toISOString(),
      doc: JSON.parse(JSON.stringify(doc)) as PageDoc,
    };
    const next = pushSnapshot(ring, snapshot);
    if (next !== ring) {
      rings.set(pageId, next);
      lastRecordedAt.set(pageId, now);
      dirty.add(pageId);
    }
  }

  // Hydrate before the first write after launch. Requesting this even when the
  // snapshot was throttled also gives a previous transient DB failure a safe
  // retry point without manufacturing another history entry.
  if (!hydrated.has(pageId) || dirty.has(pageId)) requestPersist(pageId);
}

async function writePersistedTail(
  pageId: string,
  ring: readonly PageSnapshot[],
): Promise<boolean> {
  try {
    const db = await getDb();
    await db.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      [historyKey(pageId), JSON.stringify(persistedTail(ring))],
    );
    return true;
  } catch {
    // History persistence is best-effort; the in-memory ring still works.
    return false;
  }
}

/**
 * Merge the persisted tail exactly once. Concurrent readers and writers share
 * this promise. A failed read deliberately does NOT mark the page hydrated,
 * so the next edit/list request can retry instead of trusting an empty ring.
 */
function ensureHydrated(pageId: string): Promise<boolean> {
  if (hydrated.has(pageId)) return Promise.resolve(true);
  const pending = hydrationJobs.get(pageId);
  if (pending !== undefined) return pending;

  const generation = historyGeneration;
  const job = (async (): Promise<boolean> => {
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [historyKey(pageId)],
      );
      if (generation !== historyGeneration) return false;

      const stored = parseStoredHistory(rows[0]?.value);
      if (stored.length > 0) {
        const ring = rings.get(pageId) ?? [];
        const known = new Set(ring.map((snapshot) => snapshot.at));
        const merged = [...stored.filter((snapshot) => !known.has(snapshot.at)), ...ring]
          .sort((a, b) => a.at.localeCompare(b.at))
          .slice(-MEMORY_CAP);
        rings.set(pageId, merged);
      }
      hydrated.add(pageId);
      return true;
    } catch {
      return false;
    }
  })();

  hydrationJobs.set(pageId, job);
  void job.finally(() => {
    if (hydrationJobs.get(pageId) === job) hydrationJobs.delete(pageId);
  });
  return job;
}

/**
 * Coalesce writes per page, but never overlap them. If a snapshot arrives
 * during an execute, the loop writes the newer ring afterwards. Failures leave
 * `dirty` set; the next record/list call requests another attempt.
 */
function requestPersist(pageId: string): void {
  let runner = persistRunners.get(pageId);
  if (runner === undefined) {
    runner = { running: false, requested: false };
    persistRunners.set(pageId, runner);
  }
  runner.requested = true;
  if (runner.running) return;

  runner.running = true;
  const generation = historyGeneration;
  void (async () => {
    try {
      while (runner.requested && generation === historyGeneration) {
        runner.requested = false;
        if (!(await ensureHydrated(pageId))) return;
        if (!dirty.has(pageId)) continue;

        const ring = rings.get(pageId) ?? [];
        if (!(await writePersistedTail(pageId, ring))) return;
        if (rings.get(pageId) === ring) {
          dirty.delete(pageId);
        } else {
          // A later snapshot appeared while this tail was being written.
          runner.requested = true;
        }
      }
    } finally {
      runner.running = false;
      if (generation !== historyGeneration) return;
      if (runner.requested) {
        requestPersist(pageId);
      } else if (persistRunners.get(pageId) === runner) {
        persistRunners.delete(pageId);
      }
    }
  })();
}

/**
 * Snapshots for a page, newest first (for the picker). Merges the persisted
 * tail (survives restarts) beneath the in-memory ring on first access.
 */
export async function listSnapshots(pageId: string): Promise<PageSnapshot[]> {
  const ready = await ensureHydrated(pageId);
  if (ready && dirty.has(pageId)) requestPersist(pageId);
  return [...(rings.get(pageId) ?? [])].reverse();
}

/** Test seam: drop all in-memory rings and hydration marks. */
export function resetHistoryForTests(): void {
  historyGeneration += 1;
  rings.clear();
  lastRecordedAt.clear();
  hydrated.clear();
  hydrationJobs.clear();
  dirty.clear();
  persistRunners.clear();
}
