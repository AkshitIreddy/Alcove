/** Durable SQLite store for exact AI draft generations that passed review. */
import type { ReviewedDraftReceipt } from '../features/aiAgent/reviewedReceipt';
import { getDb } from './db';

interface ReceiptRow {
  readonly generation_id: string;
  readonly receipt_json: string;
}

let tableReady: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    const db = await getDb();
    await db.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_reviewed_drafts (' +
        'generation_id TEXT PRIMARY KEY, receipt_json TEXT NOT NULL, ' +
        'saved_at TEXT NOT NULL)',
    );
  })();
  await tableReady;
}

export interface ReviewedDraftReceiptStore {
  get(generationId: string): Promise<ReviewedDraftReceipt | null>;
  put(receipt: ReviewedDraftReceipt): Promise<void>;
  delete(generationId: string): Promise<void>;
}

export const sqliteReviewedDraftReceiptStore: ReviewedDraftReceiptStore = {
  async get(generationId) {
    await ensureTable();
    const db = await getDb();
    const rows = await db.select<ReceiptRow[]>(
      'SELECT generation_id, receipt_json FROM ai_agent_reviewed_drafts ' +
        'WHERE generation_id = $1 LIMIT 1',
      [generationId],
    );
    const raw = rows[0]?.receipt_json;
    if (raw === undefined) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return value !== null && typeof value === 'object'
        ? (value as ReviewedDraftReceipt)
        : null;
    } catch {
      return null;
    }
  },
  async put(receipt) {
    await ensureTable();
    const db = await getDb();
    await db.execute(
      'INSERT OR REPLACE INTO ai_agent_reviewed_drafts ' +
        '(generation_id, receipt_json, saved_at) VALUES ($1, $2, $3)',
      [receipt.generationId, JSON.stringify(receipt), new Date().toISOString()],
    );
  },
  async delete(generationId) {
    await ensureTable();
    const db = await getDb();
    await db.execute(
      'DELETE FROM ai_agent_reviewed_drafts WHERE generation_id = $1',
      [generationId],
    );
  },
};
