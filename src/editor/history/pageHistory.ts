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
  readonly protected?: boolean;
  readonly doc: PageDoc;
}

export const MEMORY_CAP = 1536;
export const PERSIST_CAP = 1024;
export const MIN_SNAPSHOT_GAP_MS = 5_000;
export const PERSIST_MAX_JSON_CHARS = 16_000_000;

export const historyKey = (pageId: string): string => `page_history:${pageId}`;

/** Spell the unit out: the former `56w` looked exactly like “56 weeks”. */
export function historyWordLabel(words: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(words) ? words : 0));
  return `${safe} ${safe === 1 ? 'word' : 'words'}`;
}

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
  let tail = protectedRecoveryPoints(ring, cap);
  while (tail.length > 1 && JSON.stringify(tail).length > maxJsonChars) {
    tail = tail.slice(1);
  }
  return tail;
}

/**
 * Generous but bounded recovery retention. Keep every recent edit, then one
 * representative per hour/day/month as versions age. The newest snapshot is
 * invariant: size pressure drops older recovery points first, never "now".
 */
export function protectedRecoveryPoints(
  ring: readonly PageSnapshot[],
  cap: number = PERSIST_CAP,
  now: number = Date.now(),
): readonly PageSnapshot[] {
  if (ring.length <= cap) return [...ring];
  const newestFirst = [...ring].sort((a, b) => b.at.localeCompare(a.at));
  const protectedPoints = newestFirst.filter((snapshot) => snapshot.protected === true);
  const kept: PageSnapshot[] = [...protectedPoints];
  const protectedTimes = new Set(protectedPoints.map((snapshot) => snapshot.at));
  const buckets = new Set<string>();
  for (let index = 0; index < newestFirst.length; index += 1) {
    const snapshot = newestFirst[index]!;
    if (protectedTimes.has(snapshot.at)) continue;
    const at = new Date(snapshot.at).getTime();
    const age = Number.isFinite(at) ? Math.max(0, now - at) : 0;
    let bucket: string;
    if (index < 384) bucket = `dense:${index}`;
    else if (age < 30 * 24 * 60 * 60_000) bucket = `hour:${Math.floor(at / 3_600_000)}`;
    else if (age < 3 * 365 * 24 * 60 * 60_000) bucket = `day:${Math.floor(at / 86_400_000)}`;
    else if (age < 10 * 365 * 24 * 60 * 60_000) bucket = `week:${Math.floor(at / (7 * 86_400_000))}`;
    else bucket = `month:${new Date(at).getUTCFullYear()}-${new Date(at).getUTCMonth()}`;
    if (buckets.has(bucket)) continue;
    buckets.add(bucket);
    kept.push(snapshot);
    if (kept.length >= Math.max(cap, protectedPoints.length)) break;
  }
  return kept.sort((a, b) => a.at.localeCompare(b.at));
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
  options: { force?: boolean; now?: number; enabled?: boolean } = {},
): void {
  if (options.enabled === false) return;
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

/** Wait until the exact current ring is durable; used before destructive restore. */
export async function waitForPageHistory(pageId: string, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  requestPersist(pageId);
  while (dirty.has(pageId) || persistRunners.get(pageId)?.running === true) {
    if (Date.now() - started > timeoutMs) throw new Error('could not protect the current page before restoring');
    await new Promise((resolve) => globalThis.setTimeout(resolve, 8));
    requestPersist(pageId);
  }
}

export async function recordSnapshotDurably(
  pageId: string,
  doc: PageDoc,
  options: { now?: number } = {},
): Promise<void> {
  recordSnapshot(pageId, doc, { force: true, now: options.now, enabled: true });
  await waitForPageHistory(pageId);
}

export async function setPageSnapshotProtected(
  pageId: string,
  at: string,
  protectedValue: boolean,
): Promise<void> {
  await ensureHydrated(pageId);
  const ring = rings.get(pageId) ?? [];
  rings.set(pageId, ring.map((snapshot) =>
    snapshot.at === at ? { ...snapshot, protected: protectedValue || undefined } : snapshot,
  ));
  dirty.add(pageId);
  requestPersist(pageId);
  await waitForPageHistory(pageId);
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
