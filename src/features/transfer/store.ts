/**
 * src/features/transfer/store.ts — durable storage for restore points.
 *
 * History lives in the `settings` table under its own key
 * (`transfer.history`), completely separate from the app settings blob
 * (`app`), so a settings reset never wipes undo history and vice versa.
 * Everything degrades: a corrupt blob reads as "no history yet" rather than
 * throwing, because losing the panel is better than blocking an import.
 *
 * Retention runs on every write: age + count policy first (./restore), then a
 * hard size guard so one enormous import cannot make the row unwritable.
 */

import { getDb } from '../../data/db';
import {
  DEFAULT_RETENTION,
  applyRetention,
  normalizeRetention,
  pruneForSize,
  type RestorePoint,
  type RetentionPolicy,
} from './restore';

export const HISTORY_KEY = 'transfer.history';
export const HISTORY_VERSION = 1;
/** ~12 MB of JSON: generous for text pages, far under SQLite's TEXT limit. */
export const MAX_HISTORY_BYTES = 12 * 1024 * 1024;

export interface TransferHistory {
  version: number;
  retention: RetentionPolicy;
  /** Newest first. */
  points: RestorePoint[];
}

export function emptyHistory(): TransferHistory {
  return { version: HISTORY_VERSION, retention: { ...DEFAULT_RETENTION }, points: [] };
}

// ---------------------------------------------------------------------------
// Validation (total)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Parse a stored point; returns null when it is too broken to be useful. */
function parsePoint(raw: unknown): RestorePoint | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = typeof record.id === 'string' ? record.id : null;
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : null;
  if (id === null || createdAt === null) return null;
  const counts = asRecord(record.counts) ?? {};
  const createdPages = Array.isArray(record.createdPages)
    ? record.createdPages
        .map((entry) => {
          const item = asRecord(entry);
          if (item === null) return null;
          const pageId = typeof item.id === 'string' ? item.id : null;
          const bookId = typeof item.bookId === 'string' ? item.bookId : '';
          return pageId === null ? null : { id: pageId, bookId };
        })
        .filter((entry): entry is { id: string; bookId: string } => entry !== null)
    : [];
  return {
    id,
    label: typeof record.label === 'string' ? record.label : 'Import',
    createdAt,
    kind: record.kind === 'revert' ? 'revert' : 'import',
    source: typeof record.source === 'string' ? record.source : '',
    counts: {
      books: typeof counts.books === 'number' ? counts.books : 0,
      pages: typeof counts.pages === 'number' ? counts.pages : 0,
    },
    createdBooks: asStringArray(record.createdBooks),
    createdPages,
    // Absent in every point written before bundles carried furniture. Empty is
    // the right reading: that import built no cases, so its revert takes none
    // down and puts none back.
    createdBookcases: asStringArray(record.createdBookcases),
    priorBooks: Array.isArray(record.priorBooks)
      ? (record.priorBooks.filter((row) => asRecord(row) !== null) as RestorePoint['priorBooks'])
      : [],
    priorPages: Array.isArray(record.priorPages)
      ? (record.priorPages.filter((row) => asRecord(row) !== null) as RestorePoint['priorPages'])
      : [],
    priorBookcases: Array.isArray(record.priorBookcases)
      ? (record.priorBookcases.filter(
          (row) => asRecord(row) !== null,
        ) as RestorePoint['priorBookcases'])
      : [],
    revertOf: typeof record.revertOf === 'string' ? record.revertOf : null,
    revertedAt: typeof record.revertedAt === 'string' ? record.revertedAt : null,
    revertedBy: typeof record.revertedBy === 'string' ? record.revertedBy : null,
  };
}

/** Validated merge of an unknown stored blob. Pure — exposed for tests. */
export function parseHistory(raw: unknown): TransferHistory {
  const record = asRecord(raw);
  if (record === null) return emptyHistory();
  const points: RestorePoint[] = [];
  for (const entry of Array.isArray(record.points) ? record.points : []) {
    const point = parsePoint(entry);
    if (point !== null) points.push(point);
  }
  points.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return {
    version: typeof record.version === 'number' ? record.version : HISTORY_VERSION,
    retention: normalizeRetention(record.retention),
    points,
  };
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

export async function loadHistory(): Promise<TransferHistory> {
  try {
    const db = await getDb();
    const rows = await db.select<Array<{ value: string }>>(
      'SELECT value FROM settings WHERE key = $1 LIMIT 1',
      [HISTORY_KEY],
    );
    if (rows.length === 0) return emptyHistory();
    return parseHistory(JSON.parse(rows[0].value));
  } catch {
    return emptyHistory();
  }
}

async function writeHistory(history: TransferHistory): Promise<void> {
  const db = await getDb();
  await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
    HISTORY_KEY,
    JSON.stringify(history),
  ]);
}

/** Apply both retention stages and persist. Returns the stored history. */
export async function commitHistory(
  history: TransferHistory,
  now: Date = new Date(),
): Promise<TransferHistory> {
  const byPolicy = applyRetention(history.points, history.retention, now);
  const bySize = pruneForSize(byPolicy.keep, MAX_HISTORY_BYTES);
  const next: TransferHistory = {
    version: HISTORY_VERSION,
    retention: history.retention,
    points: bySize.keep,
  };
  await writeHistory(next);
  return next;
}

/** Record a new restore point (newest first) and enforce retention. */
export async function addRestorePoint(
  point: RestorePoint,
  now: Date = new Date(),
): Promise<TransferHistory> {
  const history = await loadHistory();
  return commitHistory(
    { ...history, points: [point, ...history.points.filter((p) => p.id !== point.id)] },
    now,
  );
}

/** Patch one stored point (used to stamp `revertedAt` / `revertedBy`). */
export async function patchRestorePoint(
  id: string,
  patch: Partial<RestorePoint>,
  now: Date = new Date(),
): Promise<TransferHistory> {
  const history = await loadHistory();
  return commitHistory(
    {
      ...history,
      points: history.points.map((point) =>
        point.id === id ? { ...point, ...patch } : point,
      ),
    },
    now,
  );
}

export async function setRetention(
  retention: RetentionPolicy,
  now: Date = new Date(),
): Promise<TransferHistory> {
  const history = await loadHistory();
  return commitHistory({ ...history, retention: normalizeRetention(retention) }, now);
}

export async function getRestorePoint(id: string): Promise<RestorePoint | null> {
  const history = await loadHistory();
  return history.points.find((point) => point.id === id) ?? null;
}

/** Wipe all history (used by the panel's "forget history" action). */
export async function clearHistory(): Promise<TransferHistory> {
  const history = await loadHistory();
  const next: TransferHistory = { ...history, points: [], version: HISTORY_VERSION };
  await writeHistory(next);
  return next;
}
