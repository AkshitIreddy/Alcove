/**
 * Durable whole-book recovery checkpoints.
 *
 * Page history answers "what did this leaf say?"; this answers structural
 * accidents—deleted/reordered pages, a large import, or a bad multi-page edit.
 * Checkpoints are full immutable page-row snapshots because partial/delta
 * recovery is the wrong place to save bytes. Retention is dense while work is
 * fresh and progressively spaced as it ages.
 */
import { getDb } from '../../data/db';
import type { Page } from '../../data/types';
import {
  deletePage,
  isPageFlowStart,
  listPages,
  restoreOrCreatePageSnapshot,
  setPageFlowStart,
} from '../../data/pages';

export interface BookRecoverySnapshot {
  readonly at: string;
  readonly protected?: boolean;
  readonly pages: readonly {
    readonly page: Page;
    readonly flowStart: boolean;
  }[];
}

export const BOOK_HISTORY_CAP = 512;
export const BOOK_HISTORY_GAP_MS = 60_000;
export const BOOK_HISTORY_MAX_JSON_CHARS = 64_000_000;

const historyKey = (bookId: string): string => `book_history:${bookId}`;
const lastRecordedAt = new Map<string, number>();
const queued = new Map<string, Promise<void>>();

function parse(raw: unknown): BookRecoverySnapshot[] {
  if (typeof raw !== 'string') return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is BookRecoverySnapshot =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as { at?: unknown }).at === 'string' &&
      Array.isArray((entry as { pages?: unknown }).pages),
    );
  } catch {
    return [];
  }
}

function sameBook(left: BookRecoverySnapshot | undefined, right: BookRecoverySnapshot): boolean {
  if (left === undefined || left.pages.length !== right.pages.length) return false;
  return JSON.stringify(left.pages) === JSON.stringify(right.pages);
}

/** Dense recent points, then hour/day/week/month representatives. */
export function retainBookRecoveryPoints(
  snapshots: readonly BookRecoverySnapshot[],
  cap: number = BOOK_HISTORY_CAP,
  now: number = Date.now(),
): BookRecoverySnapshot[] {
  const newest = [...snapshots].sort((a, b) => b.at.localeCompare(a.at));
  const buckets = new Set<string>();
  const protectedPoints = newest.filter((item) => item.protected === true);
  const kept: BookRecoverySnapshot[] = [...protectedPoints];
  const protectedTimes = new Set(protectedPoints.map((item) => item.at));
  for (let index = 0; index < newest.length; index += 1) {
    const item = newest[index]!;
    if (protectedTimes.has(item.at)) continue;
    const at = new Date(item.at).getTime();
    const age = Number.isFinite(at) ? Math.max(0, now - at) : 0;
    let bucket: string;
    if (index < 96) bucket = `dense:${index}`;
    else if (age < 14 * 24 * 60 * 60_000) bucket = `hour:${Math.floor(at / 3_600_000)}`;
    else if (age < 2 * 365 * 24 * 60 * 60_000) bucket = `day:${Math.floor(at / 86_400_000)}`;
    else if (age < 8 * 365 * 24 * 60 * 60_000) bucket = `week:${Math.floor(at / (7 * 86_400_000))}`;
    else bucket = `month:${new Date(at).getUTCFullYear()}-${new Date(at).getUTCMonth()}`;
    if (buckets.has(bucket)) continue;
    buckets.add(bucket);
    kept.push(item);
    if (kept.length >= Math.max(cap, protectedPoints.length)) break;
  }
  return kept.sort((a, b) => a.at.localeCompare(b.at));
}

async function write(bookId: string, pages: readonly Page[], now: number): Promise<void> {
  const flow = await Promise.all(pages.map((page) => isPageFlowStart(page.id)));
  const next: BookRecoverySnapshot = {
    at: new Date(now).toISOString(),
    pages: pages.map((page, index) => ({
      page: JSON.parse(JSON.stringify(page)) as Page,
      flowStart: flow[index] ?? false,
    })),
  };
  const db = await getDb();
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [historyKey(bookId)],
  );
  const current = parse(rows[0]?.value);
  if (sameBook(current[current.length - 1], next)) return;
  let kept = retainBookRecoveryPoints([...current, next]);
  while (kept.length > 1 && JSON.stringify(kept).length > BOOK_HISTORY_MAX_JSON_CHARS) {
    kept = kept.slice(1);
  }
  await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
    historyKey(bookId),
    JSON.stringify(kept),
  ]);
}

/** Queue a crash-safe full-book checkpoint. Existing history remains readable when disabled. */
export function recordBookCheckpoint(
  bookId: string,
  pages: readonly Page[],
  options: { force?: boolean; now?: number; enabled?: boolean } = {},
): Promise<void> {
  if (options.enabled === false || pages.length === 0) return Promise.resolve();
  const now = options.now ?? Date.now();
  if (!options.force && now - (lastRecordedAt.get(bookId) ?? 0) < BOOK_HISTORY_GAP_MS) return Promise.resolve();
  lastRecordedAt.set(bookId, now);
  const immutable = JSON.parse(JSON.stringify(pages)) as Page[];
  const previous = queued.get(bookId) ?? Promise.resolve();
  const job = previous.then(() => write(bookId, immutable, now));
  const tail = job.catch(() => undefined);
  queued.set(bookId, tail);
  void tail.finally(() => {
    if (queued.get(bookId) === tail) queued.delete(bookId);
  });
  return job;
}

export async function setBookCheckpointProtected(
  bookId: string,
  at: string,
  protectedValue: boolean,
): Promise<void> {
  await queued.get(bookId);
  const db = await getDb();
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [historyKey(bookId)],
  );
  const next = parse(rows[0]?.value).map((entry) =>
    entry.at === at ? { ...entry, protected: protectedValue || undefined } : entry,
  );
  await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
    historyKey(bookId),
    JSON.stringify(retainBookRecoveryPoints(next)),
  ]);
}

export async function listBookCheckpoints(bookId: string): Promise<BookRecoverySnapshot[]> {
  await queued.get(bookId);
  const db = await getDb();
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [historyKey(bookId)],
  );
  return parse(rows[0]?.value).reverse();
}

/** Restore exact page identities/order/content; deleted pages are recreated. */
export async function restoreBookCheckpoint(
  bookId: string,
  snapshot: BookRecoverySnapshot,
): Promise<Page[]> {
  const keep = new Set(snapshot.pages.map(({ page }) => page.id));
  for (const page of await listPages(bookId)) {
    if (!keep.has(page.id)) await deletePage(page.id);
  }
  for (const saved of snapshot.pages) {
    if (saved.page.bookId !== bookId) throw new Error('book history belongs to another notebook');
    await restoreOrCreatePageSnapshot(saved.page);
    await setPageFlowStart(saved.page.id, saved.flowStart);
  }
  return listPages(bookId);
}
