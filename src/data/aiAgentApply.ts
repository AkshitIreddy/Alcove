/**
 * Recoverable journal for approved AI notebook proposals.
 *
 * Frontend page operations span several tables and mounted editors, so they
 * cannot share the SQL plugin's private connection transaction. The durable
 * authority is therefore a write-ahead snapshot: it is committed before the
 * first page mutation, retained as the Ctrl+Z receipt after success, and
 * replayed idempotently on the next open if the process stopped mid-apply.
 */
import type { Page } from './types';
import {
  deletePage,
  listPages,
  restorePageSnapshot,
  setPageFlowStart,
} from './pages';
import { getDb } from './db';

export interface AiPatchBookSnapshot {
  readonly bookId: string;
  readonly pages: readonly {
    readonly page: Page;
    readonly flowStart: boolean;
  }[];
}

export type AiPatchApplicationStatus = 'applying' | 'applied' | 'undoing';

interface AiPatchApplicationRow {
  readonly idempotency_key: string;
  readonly patch_id: string;
  readonly book_id: string;
  readonly status: string;
  readonly before_json: string;
  readonly claimed_at: string;
  readonly applied_at: string | null;
  readonly result_revision: string | null;
}

export interface AiPatchApplicationReceipt {
  readonly idempotencyKey: string;
  readonly patchId: string;
  readonly bookId: string;
  readonly status: AiPatchApplicationStatus;
  readonly before: AiPatchBookSnapshot;
  readonly claimedAt: string;
  readonly appliedAt: string | null;
  readonly resultRevision: string | null;
}

let tableReady: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    const db = await getDb();
    await db.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_patch_journal (' +
        'idempotency_key TEXT PRIMARY KEY, patch_id TEXT NOT NULL, ' +
        'book_id TEXT NOT NULL, status TEXT NOT NULL, before_json TEXT NOT NULL, ' +
        'claimed_at TEXT NOT NULL, applied_at TEXT, result_revision TEXT)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_ai_patch_journal_book ' +
        'ON ai_agent_patch_journal (book_id, claimed_at)',
    );
  })();
  await tableReady;
}

function receipt(row: AiPatchApplicationRow): AiPatchApplicationReceipt | null {
  try {
    const before = JSON.parse(row.before_json) as AiPatchBookSnapshot;
    if (before.bookId !== row.book_id || !Array.isArray(before.pages)) return null;
    if (
      row.status !== 'applying' &&
      row.status !== 'applied' &&
      row.status !== 'undoing'
    ) {
      return null;
    }
    return {
      idempotencyKey: row.idempotency_key,
      patchId: row.patch_id,
      bookId: row.book_id,
      status: row.status,
      before,
      claimedAt: row.claimed_at,
      appliedAt: row.applied_at,
      resultRevision: row.result_revision,
    };
  } catch {
    return null;
  }
}

/** Atomically reserve one proposal and durably store its rollback authority. */
export async function claimAiPatchApplication(input: {
  readonly idempotencyKey: string;
  readonly patchId: string;
  readonly bookId: string;
  readonly before: AiPatchBookSnapshot;
}): Promise<boolean> {
  if (input.before.bookId !== input.bookId) throw new Error('AI apply snapshot belongs to another book');
  await ensureTable();
  const db = await getDb();
  const result = await db.execute(
    'INSERT OR IGNORE INTO ai_agent_patch_journal ' +
      '(idempotency_key, patch_id, book_id, status, before_json, claimed_at, applied_at, result_revision) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)',
    [
      input.idempotencyKey,
      input.patchId,
      input.bookId,
      'applying',
      JSON.stringify(input.before),
      new Date().toISOString(),
    ],
  );
  return result.rowsAffected > 0;
}

export async function completeAiPatchApplication(
  idempotencyKey: string,
  resultRevision: string,
): Promise<void> {
  await ensureTable();
  const db = await getDb();
  await db.execute(
    'UPDATE ai_agent_patch_journal SET status = $1, applied_at = $2, result_revision = $3 ' +
      'WHERE idempotency_key = $4',
    ['applied', new Date().toISOString(), resultRevision, idempotencyKey],
  );
}

/** Release only an unfinished reservation after its snapshot was restored. */
export async function releaseAiPatchApplication(idempotencyKey: string): Promise<void> {
  await ensureTable();
  const db = await getDb();
  await db.execute(
    'DELETE FROM ai_agent_patch_journal WHERE idempotency_key = $1 AND status = $2',
    [idempotencyKey, 'applying'],
  );
}

/**
 * Write-ahead transition for Ctrl+Z. This must settle before the first page is
 * restored or deleted: an app stop after this point is repaired on next open.
 * Re-entering an already-started undo is deliberately idempotent.
 */
export async function beginAiPatchUndo(
  idempotencyKey: string,
): Promise<AiPatchApplicationReceipt> {
  await ensureTable();
  const db = await getDb();
  await db.execute(
    'UPDATE ai_agent_patch_journal SET status = $1 WHERE idempotency_key = $2 AND status = $3',
    ['undoing', idempotencyKey, 'applied'],
  );
  const current = await readAiPatchApplication(idempotencyKey);
  if (current?.status !== 'undoing') {
    throw new Error('The AI Undo receipt is missing or is not ready to restore');
  }
  return current;
}

/** Finalize a fully restored Ctrl+Z. Interrupted rows stay for startup repair. */
export async function completeAiPatchUndo(idempotencyKey: string): Promise<void> {
  await ensureTable();
  const db = await getDb();
  await db.execute(
    'DELETE FROM ai_agent_patch_journal WHERE idempotency_key = $1 AND status = $2',
    [idempotencyKey, 'undoing'],
  );
}

/**
 * Discard only an unused, completed Undo receipt after a later authored edit.
 * An undo already in progress is recovery authority and must never be erased
 * merely because a partially restored book no longer matches resultRevision.
 */
export async function forgetAiPatchApplication(idempotencyKey: string): Promise<void> {
  await ensureTable();
  const db = await getDb();
  await db.execute(
    'DELETE FROM ai_agent_patch_journal WHERE idempotency_key = $1 AND status = $2',
    [idempotencyKey, 'applied'],
  );
}

export async function readAiPatchApplication(
  idempotencyKey: string,
): Promise<AiPatchApplicationReceipt | null> {
  await ensureTable();
  const db = await getDb();
  const rows = await db.select<AiPatchApplicationRow[]>(
    'SELECT * FROM ai_agent_patch_journal WHERE idempotency_key = $1 LIMIT 1',
    [idempotencyKey],
  );
  return rows[0] === undefined ? null : receipt(rows[0]);
}

export async function latestAppliedAiPatch(
  bookId: string,
): Promise<AiPatchApplicationReceipt | null> {
  await ensureTable();
  const db = await getDb();
  const rows = await db.select<AiPatchApplicationRow[]>(
    'SELECT * FROM ai_agent_patch_journal WHERE book_id = $1 AND status = $2 ' +
      'ORDER BY claimed_at DESC LIMIT 1',
    [bookId, 'applied'],
  );
  return rows[0] === undefined ? null : receipt(rows[0]);
}

/** Idempotently restore one exact pre-apply book snapshot. */
export async function restoreAiPatchSnapshot(snapshot: AiPatchBookSnapshot): Promise<void> {
  const keep = new Set(snapshot.pages.map(({ page }) => page.id));
  const current = await listPages(snapshot.bookId);
  for (const page of current) {
    if (!keep.has(page.id)) await deletePage(page.id);
  }
  for (const saved of snapshot.pages) {
    const restored = await restorePageSnapshot(saved.page);
    if (restored === null) throw new Error('An original page needed for AI rollback is missing');
    await setPageFlowStart(saved.page.id, saved.flowStart);
  }
}

/** Repair every interrupted apply/Undo before BookView publishes the notebook. */
export async function recoverIncompleteAiPatchApplications(bookId: string): Promise<number> {
  await ensureTable();
  const db = await getDb();
  const rows = await db.select<AiPatchApplicationRow[]>(
    'SELECT * FROM ai_agent_patch_journal WHERE book_id = $1 AND status IN ($2, $3) ' +
      'ORDER BY claimed_at ASC',
    [bookId, 'applying', 'undoing'],
  );
  let recovered = 0;
  for (const row of rows) {
    const item = receipt(row);
    if (item === null) throw new Error('AI apply recovery journal is unreadable');
    await restoreAiPatchSnapshot(item.before);
    if (item.status === 'undoing') {
      await completeAiPatchUndo(item.idempotencyKey);
    } else {
      await releaseAiPatchApplication(item.idempotencyKey);
    }
    recovered += 1;
  }
  return recovered;
}
