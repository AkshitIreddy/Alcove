/**
 * Optional sqlite-vec + FTS5 retrieval index for AI source chunks.
 *
 * The ordinary `ai_agent_*` tables are always canonical. These virtual tables
 * are disposable acceleration structures: every hit is joined back to the
 * current source/chunk row (including its digest and task), and every public
 * operation fails closed to `null`/`false` so provider-independent ingestion
 * and the existing TypeScript cosine search remain available.
 */
import { getDb, isTauri, type Db } from './db';

export const AI_AGENT_EMBEDDING_DIMENSIONS = 512;
export const AI_AGENT_RETRIEVAL_SCHEMA = 'cohere-embed-v4.0-f32-512+fts5-rrf-v1';

const VECTOR_TABLE = 'ai_agent_chunk_vec_v1';
const FTS_TABLE = 'ai_agent_chunk_fts_v1';
const META_TABLE = 'ai_agent_retrieval_meta';
const STATE_TABLE = 'ai_agent_retrieval_source_state';
const DIRTY_TABLE = 'ai_agent_retrieval_dirty';
const DEFAULT_RRF_K = 60;
const MAX_CANDIDATE_MULTIPLIER = 8;

interface CanonicalChunkRow {
  id: string;
  source_id: string;
  thread_id: string;
  ordinal: number;
  locator: string;
  text: string;
  digest: string;
  embedding_json: string | null;
}

interface RankedRow extends CanonicalChunkRow {
  rank_value: number;
}

export interface AiAgentIndexedHit {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly ordinal: number;
  readonly locator: string;
  readonly text: string;
  readonly digest: string;
  readonly rrfScore: number;
  readonly lexicalRank?: number;
  readonly vectorRank?: number;
}

export interface AiAgentRetrievalQuery {
  readonly threadId: string;
  readonly sourceIds: readonly string[];
  readonly query: string;
  readonly queryEmbedding: readonly number[] | null;
  readonly limit: number;
  readonly signal?: AbortSignal;
}

let ready: Promise<Db> | null = null;

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

/** Strict boundary used before any float array reaches vec_f32. */
export function isValidAiAgentEmbedding(value: unknown): value is readonly number[] {
  return Array.isArray(value) &&
    value.length === AI_AGENT_EMBEDDING_DIMENSIONS &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function parseEmbedding(raw: string | null): readonly number[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isValidAiAgentEmbedding(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Produce a conservative FTS5 expression. Quoting every Unicode word avoids
 * treating pasted punctuation, operators, column names or unmatched quotes as
 * FTS syntax. Empty/punctuation-only queries deliberately skip FTS.
 */
export function aiAgentFtsQuery(text: string): string | null {
  const terms = text.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (terms === null || terms.length === 0) return null;
  return [...new Set(terms)].slice(0, 32).map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
}

export interface ReciprocalRankItem<T> {
  readonly key: string;
  readonly value: T;
}

/** Deterministic local reciprocal-rank fusion; rank is one-based. */
export function reciprocalRankFuse<T>(
  lists: readonly (readonly ReciprocalRankItem<T>[])[],
  k = DEFAULT_RRF_K,
): Array<{ readonly key: string; readonly value: T; readonly score: number; readonly ranks: readonly (number | undefined)[] }> {
  const safeK = Number.isFinite(k) && k >= 0 ? k : DEFAULT_RRF_K;
  const fused = new Map<string, { value: T; score: number; ranks: Array<number | undefined> }>();
  lists.forEach((list, listIndex) => {
    const seen = new Set<string>();
    list.forEach((item, index) => {
      if (seen.has(item.key)) return;
      seen.add(item.key);
      const current = fused.get(item.key) ?? {
        value: item.value,
        score: 0,
        ranks: Array<number | undefined>(lists.length).fill(undefined),
      };
      const rank = index + 1;
      current.score += 1 / (safeK + rank);
      current.ranks[listIndex] = rank;
      fused.set(item.key, current);
    });
  });
  return [...fused.entries()]
    .map(([key, item]) => ({ key, ...item }))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
}

async function ensureSchema(): Promise<Db> {
  if (!isTauri()) throw new Error('sqlite-vec is available only in the Tauri SQLite process');
  ready ??= (async () => {
    const db = await getDb();
    // This is both a capability probe and a guard against silently creating a
    // database that can never query its vector table.
    await db.select<Array<{ version: string }>>('SELECT vec_version() AS version');
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${META_TABLE} (` +
        'key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (` +
        'source_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)',
    );
    const versions = await db.select<Array<{ value: string }>>(
      `SELECT value FROM ${META_TABLE} WHERE key = 'schema' LIMIT 1`,
    );
    if (versions[0]?.value !== AI_AGENT_RETRIEVAL_SCHEMA) {
      await db.execute(`DROP TABLE IF EXISTS ${VECTOR_TABLE}`);
      await db.execute(`DROP TABLE IF EXISTS ${FTS_TABLE}`);
      await db.execute(`DELETE FROM ${STATE_TABLE}`);
    }
    await db.execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${VECTOR_TABLE} USING vec0(` +
        'chunk_id TEXT PRIMARY KEY, embedding float[512] distance_metric=cosine, ' +
        'thread_id TEXT partition key, source_id TEXT, digest TEXT)',
    );
    await db.execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(` +
        'chunk_id UNINDEXED, thread_id UNINDEXED, source_id UNINDEXED, ' +
        "digest UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')",
    );
    await db.execute(
      `INSERT OR REPLACE INTO ${META_TABLE} (key, value) VALUES ('schema', $1)`,
      [AI_AGENT_RETRIEVAL_SCHEMA],
    );
    return db;
  })().catch((error) => {
    // A transient pool/schema failure must be retryable later in the session.
    ready = null;
    throw error;
  });
  return ready;
}

async function canonicalChunksForSource(db: Db, sourceId: string): Promise<CanonicalChunkRow[]> {
  return db.select<CanonicalChunkRow[]>(
    'SELECT c.id, c.source_id, s.thread_id, c.ordinal, c.locator, c.text, c.digest, c.embedding_json ' +
      'FROM ai_agent_chunks c JOIN ai_agent_sources s ON s.id = c.source_id ' +
      'WHERE c.source_id = $1 ORDER BY c.ordinal ASC',
    [sourceId],
  );
}

async function canonicalRevision(db: Db, sourceId: string): Promise<number | null> {
  const revisions = await db.select<Array<{ revision: number }>>(
    `SELECT revision FROM ${DIRTY_TABLE} WHERE source_id = $1 LIMIT 1`,
    [sourceId],
  );
  return revisions[0]?.revision ?? null;
}

/**
 * Rebuild a derived snapshot without ever publishing it against a revision it
 * did not actually represent. Exported for a deterministic adversarial test.
 */
export async function reconcileRevisionedSnapshot<T>(input: {
  readonly readRevision: () => Promise<number | null>;
  readonly readSnapshot: () => Promise<T>;
  readonly invalidate: () => Promise<void>;
  readonly rebuild: (snapshot: T) => Promise<void>;
  readonly publish: (revision: number) => Promise<void>;
  readonly maxAttempts?: number;
}): Promise<void> {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? 2));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await input.readRevision();
    const snapshot = await input.readSnapshot();
    // The prior index must stop claiming completeness before the first delete
    // or insert. A failed rebuild therefore remains visibly dirty.
    await input.invalidate();
    await input.rebuild(snapshot);
    const after = await input.readRevision();
    if (before === after) {
      if (after !== null) await input.publish(after);
      return;
    }
    // A cross-connection write moved the canonical source while rebuilding.
    // STATE is still absent; retry from a fresh snapshot, then fail open.
  }
  throw new Error('AI retrieval source changed repeatedly during reconciliation');
}

async function reconcileSource(db: Db, sourceId: string): Promise<void> {
  await reconcileRevisionedSnapshot({
    readRevision: () => canonicalRevision(db, sourceId),
    readSnapshot: () => canonicalChunksForSource(db, sourceId),
    invalidate: async () => {
      await db.execute(`DELETE FROM ${STATE_TABLE} WHERE source_id = $1`, [sourceId]);
    },
    rebuild: async (chunks) => {
      // Delete first so replacement, shrinking, and digest changes cannot
      // leave stale rows. Canonical joins reject even a partial rebuild.
      await db.execute(`DELETE FROM ${VECTOR_TABLE} WHERE source_id = $1`, [sourceId]);
      await db.execute(`DELETE FROM ${FTS_TABLE} WHERE source_id = $1`, [sourceId]);
      for (const chunk of chunks) {
        await db.execute(
          `INSERT INTO ${FTS_TABLE} (chunk_id, thread_id, source_id, digest, text) ` +
            'VALUES ($1, $2, $3, $4, $5)',
          [chunk.id, chunk.thread_id, chunk.source_id, chunk.digest, chunk.text],
        );
        const embedding = parseEmbedding(chunk.embedding_json);
        if (embedding === null) continue;
        await db.execute(
          `INSERT INTO ${VECTOR_TABLE} (chunk_id, embedding, thread_id, source_id, digest) ` +
            'VALUES ($1, vec_f32($2), $3, $4, $5)',
          [chunk.id, JSON.stringify(embedding), chunk.thread_id, chunk.source_id, chunk.digest],
        );
      }
    },
    publish: async (revision) => {
      await db.execute(
        `INSERT OR REPLACE INTO ${STATE_TABLE} (source_id, revision) VALUES ($1, $2)`,
        [sourceId, revision],
      );
    },
  });
}

async function sourceNeedsReconciliation(db: Db, sourceId: string): Promise<boolean> {
  const rows = await db.select<Array<{ dirty_revision: number; indexed_revision: number | null }>>(
    `SELECT d.revision AS dirty_revision, s.revision AS indexed_revision FROM ${DIRTY_TABLE} d ` +
      `LEFT JOIN ${STATE_TABLE} s ON s.source_id = d.source_id WHERE d.source_id = $1 LIMIT 1`,
    [sourceId],
  );
  return rows[0] === undefined || rows[0].indexed_revision !== rows[0].dirty_revision;
}

/** Best-effort source replacement/backfill; safe to call repeatedly. */
export async function refreshAiAgentRetrievalSource(sourceId: string): Promise<boolean> {
  try {
    const db = await ensureSchema();
    await reconcileSource(db, sourceId);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort derived-row cleanup after canonical deletion. */
export async function purgeAiAgentRetrievalSource(sourceId: string): Promise<boolean> {
  try {
    const db = await ensureSchema();
    await db.execute(`DELETE FROM ${VECTOR_TABLE} WHERE source_id = $1`, [sourceId]);
    await db.execute(`DELETE FROM ${FTS_TABLE} WHERE source_id = $1`, [sourceId]);
    await db.execute(`DELETE FROM ${STATE_TABLE} WHERE source_id = $1`, [sourceId]);
    await db.execute(`DELETE FROM ${DIRTY_TABLE} WHERE source_id = $1`, [sourceId]);
    return true;
  } catch {
    return false;
  }
}

export async function purgeAiAgentRetrievalThread(threadId: string): Promise<boolean> {
  try {
    const db = await ensureSchema();
    await db.execute(`DELETE FROM ${VECTOR_TABLE} WHERE thread_id = $1`, [threadId]);
    await db.execute(`DELETE FROM ${FTS_TABLE} WHERE thread_id = $1`, [threadId]);
    await db.execute(
      `DELETE FROM ${STATE_TABLE} WHERE source_id NOT IN (SELECT id FROM ai_agent_sources)`,
    );
    await db.execute(
      `DELETE FROM ${DIRTY_TABLE} WHERE source_id NOT IN (SELECT id FROM ai_agent_sources)`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Cheap semantic-capability probe used to avoid materializing every 512-float
 * JSON vector in the WebView merely to decide whether a query embedding helps.
 */
export async function hasAiAgentRetrievalVectors(input: {
  readonly threadId: string;
  readonly sourceIds: readonly string[];
  readonly signal?: AbortSignal;
}): Promise<boolean | null> {
  try {
    const db = await ensureSchema();
    for (const sourceId of [...new Set(input.sourceIds)]) {
      abortIfNeeded(input.signal);
      if (await sourceNeedsReconciliation(db, sourceId)) {
        await reconcileSource(db, sourceId);
      }
      const rows = await db.select<Array<{ present: number }>>(
        `SELECT EXISTS(SELECT 1 FROM ${VECTOR_TABLE} i ` +
          'JOIN ai_agent_chunks c ON c.id = i.chunk_id AND c.digest = i.digest ' +
          'JOIN ai_agent_sources s ON s.id = c.source_id ' +
          'AND s.id = i.source_id AND s.thread_id = i.thread_id ' +
          'WHERE i.thread_id = $1 AND i.source_id = $2 ' +
          'AND s.thread_id = $1 AND s.id = $2 LIMIT 1) AS present',
        [input.threadId, sourceId],
      );
      if (Number(rows[0]?.present) === 1) return true;
    }
    return false;
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return null;
  }
}

function currentJoin(table: string): string {
  return ` FROM ${table} i ` +
    'JOIN ai_agent_chunks c ON c.id = i.chunk_id AND c.digest = i.digest ' +
    'JOIN ai_agent_sources s ON s.id = c.source_id AND s.id = i.source_id AND s.thread_id = i.thread_id ';
}

/**
 * Query selected task sources using FTS5 and vec0, then fuse locally. `null`
 * means the caller must use the existing TypeScript lexical/cosine path.
 */
export async function searchAiAgentRetrievalIndex(
  input: AiAgentRetrievalQuery,
): Promise<readonly AiAgentIndexedHit[] | null> {
  const sourceIds = [...new Set(input.sourceIds.filter(Boolean))];
  if (sourceIds.length === 0) return [];
  try {
    abortIfNeeded(input.signal);
    const db = await ensureSchema();
    // Scoped reconciliation both backfills pre-index installations and makes
    // same-PDF reuse/idempotent replacement visible without a global startup scan.
    for (const sourceId of sourceIds) {
      abortIfNeeded(input.signal);
      if (await sourceNeedsReconciliation(db, sourceId)) {
        await reconcileSource(db, sourceId);
      }
    }
    const pool = Math.max(8, Math.max(1, input.limit) * MAX_CANDIDATE_MULTIPLIER);
    const lexicalRows: RankedRow[] = [];
    const fts = aiAgentFtsQuery(input.query);
    if (fts !== null) {
      for (const sourceId of sourceIds) {
        lexicalRows.push(...await db.select<RankedRow[]>(
          'SELECT c.id, c.source_id, s.thread_id, c.ordinal, c.locator, c.text, c.digest, ' +
            `bm25(${FTS_TABLE}) AS rank_value` + currentJoin(FTS_TABLE) +
            'WHERE i.text MATCH $1 AND i.thread_id = $2 AND i.source_id = $3 ' +
            'AND s.thread_id = $2 AND s.id = $3 ORDER BY rank_value ASC LIMIT $4',
          [fts, input.threadId, sourceId, pool],
        ));
      }
    }
    lexicalRows.sort((left, right) => left.rank_value - right.rank_value || left.id.localeCompare(right.id));

    const vectorRows: RankedRow[] = [];
    if (isValidAiAgentEmbedding(input.queryEmbedding)) {
      for (const sourceId of sourceIds) {
        vectorRows.push(...await db.select<RankedRow[]>(
          'SELECT c.id, c.source_id, s.thread_id, c.ordinal, c.locator, c.text, c.digest, i.distance AS rank_value ' +
            currentJoin(
              `(SELECT chunk_id, thread_id, source_id, digest, distance FROM ${VECTOR_TABLE} ` +
                'WHERE embedding MATCH vec_f32($1) AND k = $2 AND thread_id = $3 AND source_id = $4)',
            ) +
            'WHERE s.thread_id = $3 AND s.id = $4 ORDER BY rank_value ASC',
          [JSON.stringify(input.queryEmbedding), pool, input.threadId, sourceId],
        ));
      }
    }
    vectorRows.sort((left, right) => left.rank_value - right.rank_value || left.id.localeCompare(right.id));
    abortIfNeeded(input.signal);
    const fused = reciprocalRankFuse([
      lexicalRows.map((row) => ({ key: row.id, value: row })),
      vectorRows.map((row) => ({ key: row.id, value: row })),
    ]);
    return fused.slice(0, Math.max(1, input.limit)).map((item) => ({
      chunkId: item.value.id,
      sourceId: item.value.source_id,
      ordinal: item.value.ordinal,
      locator: item.value.locator,
      text: item.value.text,
      digest: item.value.digest,
      rrfScore: item.score,
      lexicalRank: item.ranks[0],
      vectorRank: item.ranks[1],
    }));
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return null;
  }
}

/** Test helper: forget a successful capability probe after swapping DBs. */
export function resetAiAgentRetrievalIndexForTests(): void {
  ready = null;
}
