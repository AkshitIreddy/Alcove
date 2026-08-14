/**
 * Durable, provider-neutral storage for in-book AI tasks and their sources.
 *
 * Secrets and raw source bytes do not belong here. A graph checkpoint is
 * opaque versioned JSON; attachments live under the library asset root and
 * this table retains only a relative path, digest and extraction metadata.
 * Source chunks keep stable page/unit locators so a coverage-sensitive task
 * can prove what it read instead of quietly substituting top-k retrieval.
 */
import { nanoid } from 'nanoid';
import { getDb } from './db';
import { countPendingAiAgentAttachmentReferences } from './aiAgentPersistence';
import {
  purgeAiAgentRetrievalSource,
  purgeAiAgentRetrievalThread,
  refreshAiAgentRetrievalSource,
} from './aiAgentRetrievalIndex';

export type AiAgentTaskStatus =
  | 'idle'
  | 'working'
  | 'waiting-user'
  | 'preview'
  | 'applying'
  | 'complete'
  | 'stopped'
  | 'failed';

export interface StoredAiAgentThread<State = unknown> {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly status: AiAgentTaskStatus;
  readonly stateVersion: number;
  readonly state: State;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AiAgentSourceKind = 'text' | 'markdown' | 'pdf' | 'image';

export interface StoredAiAgentSource<Meta = unknown> {
  readonly id: string;
  readonly threadId: string;
  readonly kind: AiAgentSourceKind;
  readonly name: string;
  /** Library-root-relative durable asset path; never an arbitrary host path. */
  readonly relPath: string | null;
  readonly digest: string;
  readonly byteLength: number;
  readonly unitCount: number;
  readonly meta: Meta;
  readonly createdAt: string;
}

export interface StoredAiAgentChunk {
  readonly id: string;
  readonly sourceId: string;
  readonly ordinal: number;
  /** Human/audit locator such as `page 7` or `lines 120-176`. */
  readonly locator: string;
  readonly text: string;
  readonly digest: string;
  /** Cached provider embedding. It is derived data and may be dropped. */
  readonly embedding: readonly number[] | null;
}

/**
 * Provider embeddings are derived, local-only acceleration data. They are
 * keyed by the embedding/index contract plus the exact chunk digest so the
 * same unchanged page can be reused by another Agent task without weakening
 * task/source capability boundaries.
 */
export interface StoredAiAgentEmbedding {
  readonly contentDigest: string;
  readonly embedding: readonly number[];
}

interface ThreadRow {
  id: string;
  book_id: string;
  title: string;
  status: string;
  state_version: number;
  state_json: string;
  created_at: string;
  updated_at: string;
}

interface SourceRow {
  id: string;
  thread_id: string;
  kind: string;
  name: string;
  rel_path: string | null;
  digest: string;
  byte_length: number;
  unit_count: number;
  meta_json: string;
  created_at: string;
}

interface ChunkRow {
  id: string;
  source_id: string;
  ordinal: number;
  locator: string;
  text: string;
  digest: string;
  embedding_json: string | null;
}

const THREAD_STATUSES: readonly AiAgentTaskStatus[] = [
  'idle',
  'working',
  'waiting-user',
  'preview',
  'applying',
  'complete',
  'stopped',
  'failed',
];

const SOURCE_KINDS: readonly AiAgentSourceKind[] = [
  'text',
  'markdown',
  'pdf',
  'image',
];

let tablesReady: Promise<void> | null = null;

async function ensureTables(): Promise<void> {
  tablesReady ??= (async () => {
    const db = await getDb();
    await db.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_threads (' +
        'id TEXT PRIMARY KEY, book_id TEXT NOT NULL, title TEXT NOT NULL, ' +
        'status TEXT NOT NULL, state_version INTEGER NOT NULL, ' +
        'state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
    );
    await db.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_sources (' +
        'id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, kind TEXT NOT NULL, ' +
        'name TEXT NOT NULL, rel_path TEXT, digest TEXT NOT NULL, ' +
        'byte_length INTEGER NOT NULL, unit_count INTEGER NOT NULL, ' +
        'meta_json TEXT NOT NULL, created_at TEXT NOT NULL)',
    );
    await db.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_chunks (' +
        'id TEXT PRIMARY KEY, source_id TEXT NOT NULL, ordinal INTEGER NOT NULL, ' +
        'locator TEXT NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL, ' +
        'embedding_json TEXT)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_ai_agent_threads_book_updated ' +
        'ON ai_agent_threads (book_id, updated_at)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_ai_agent_sources_thread ' +
        'ON ai_agent_sources (thread_id)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_ai_agent_chunks_source_ord ' +
        'ON ai_agent_chunks (source_id, ordinal)',
    );
    await db.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_embedding_cache (' +
        'index_version TEXT NOT NULL, content_digest TEXT NOT NULL, ' +
        'embedding_json TEXT NOT NULL, created_at TEXT NOT NULL, ' +
        'PRIMARY KEY (index_version, content_digest))',
    );
    // Ordinary SQLite revision ledger: unlike vec0/FTS this is safe even when
    // the optional extension is unavailable. Triggers catch writes from every
    // connection, so lazy reconciliation never relies on process-local memory.
    await db.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_retrieval_dirty (' +
        'source_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1)',
    );
    await db.execute(
      'INSERT OR IGNORE INTO ai_agent_retrieval_dirty (source_id, revision) ' +
        'SELECT id, 1 FROM ai_agent_sources',
    );
    await db.execute(
      'CREATE TRIGGER IF NOT EXISTS ai_agent_chunks_retrieval_insert ' +
        'AFTER INSERT ON ai_agent_chunks BEGIN ' +
        'INSERT INTO ai_agent_retrieval_dirty (source_id, revision) VALUES (NEW.source_id, 1) ' +
        'ON CONFLICT(source_id) DO UPDATE SET revision = revision + 1; END',
    );
    await db.execute(
      'CREATE TRIGGER IF NOT EXISTS ai_agent_chunks_retrieval_update ' +
        'AFTER UPDATE ON ai_agent_chunks BEGIN ' +
        'INSERT INTO ai_agent_retrieval_dirty (source_id, revision) VALUES (OLD.source_id, 1) ' +
        'ON CONFLICT(source_id) DO UPDATE SET revision = revision + 1; ' +
        'INSERT INTO ai_agent_retrieval_dirty (source_id, revision) VALUES (NEW.source_id, 1) ' +
        'ON CONFLICT(source_id) DO UPDATE SET revision = revision + 1; END',
    );
    await db.execute(
      'CREATE TRIGGER IF NOT EXISTS ai_agent_chunks_retrieval_delete ' +
        'AFTER DELETE ON ai_agent_chunks BEGIN ' +
        'INSERT INTO ai_agent_retrieval_dirty (source_id, revision) VALUES (OLD.source_id, 1) ' +
        'ON CONFLICT(source_id) DO UPDATE SET revision = revision + 1; END',
    );
    await db.execute(
      'CREATE TRIGGER IF NOT EXISTS ai_agent_sources_retrieval_insert ' +
        'AFTER INSERT ON ai_agent_sources BEGIN ' +
        'INSERT INTO ai_agent_retrieval_dirty (source_id, revision) VALUES (NEW.id, 1) ' +
        'ON CONFLICT(source_id) DO UPDATE SET revision = revision + 1; END',
    );
    await db.execute(
      'CREATE TRIGGER IF NOT EXISTS ai_agent_sources_retrieval_update ' +
        'AFTER UPDATE ON ai_agent_sources BEGIN ' +
        'INSERT INTO ai_agent_retrieval_dirty (source_id, revision) VALUES (NEW.id, 1) ' +
        'ON CONFLICT(source_id) DO UPDATE SET revision = revision + 1; END',
    );
  })();
  return tablesReady;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function statusOf(value: string): AiAgentTaskStatus {
  return (THREAD_STATUSES as readonly string[]).includes(value)
    ? (value as AiAgentTaskStatus)
    : 'failed';
}

function sourceKindOf(value: string): AiAgentSourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value)
    ? (value as AiAgentSourceKind)
    : 'text';
}

function threadFromRow<State>(row: ThreadRow): StoredAiAgentThread<State> {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    status: statusOf(row.status),
    stateVersion: row.state_version,
    state: parseJson<State>(row.state_json, {} as State),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sourceFromRow<Meta>(row: SourceRow): StoredAiAgentSource<Meta> {
  return {
    id: row.id,
    threadId: row.thread_id,
    kind: sourceKindOf(row.kind),
    name: row.name,
    relPath: row.rel_path,
    digest: row.digest,
    byteLength: row.byte_length,
    unitCount: row.unit_count,
    meta: parseJson<Meta>(row.meta_json, {} as Meta),
    createdAt: row.created_at,
  };
}

function finiteEmbedding(raw: string | null): readonly number[] | null {
  if (raw === null) return null;
  const parsed = parseJson<unknown>(raw, null);
  return Array.isArray(parsed) && parsed.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? parsed
    : null;
}

function finiteEmbeddingValue(value: readonly number[]): boolean {
  return value.length > 0 && value.every((part) => Number.isFinite(part));
}

function chunkFromRow(row: ChunkRow): StoredAiAgentChunk {
  return {
    id: row.id,
    sourceId: row.source_id,
    ordinal: row.ordinal,
    locator: row.locator,
    text: row.text,
    digest: row.digest,
    embedding: finiteEmbedding(row.embedding_json),
  };
}

export async function createAiAgentThread<State>(input: {
  readonly bookId: string;
  readonly title?: string;
  readonly stateVersion: number;
  readonly state: State;
}): Promise<StoredAiAgentThread<State>> {
  await ensureTables();
  const now = new Date().toISOString();
  const thread: StoredAiAgentThread<State> = {
    id: nanoid(),
    bookId: input.bookId,
    title: input.title?.trim() || 'New AI task',
    status: 'idle',
    stateVersion: input.stateVersion,
    state: input.state,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  await db.execute(
    'INSERT INTO ai_agent_threads (id, book_id, title, status, state_version, state_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      thread.id,
      thread.bookId,
      thread.title,
      thread.status,
      thread.stateVersion,
      JSON.stringify(thread.state),
      thread.createdAt,
      thread.updatedAt,
    ],
  );
  return thread;
}

export async function saveAiAgentThread<State>(
  thread: StoredAiAgentThread<State>,
): Promise<StoredAiAgentThread<State>> {
  await ensureTables();
  const updated: StoredAiAgentThread<State> = {
    ...thread,
    updatedAt: new Date().toISOString(),
  };
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO ai_agent_threads (id, book_id, title, status, state_version, state_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      updated.id,
      updated.bookId,
      updated.title,
      updated.status,
      updated.stateVersion,
      JSON.stringify(updated.state),
      updated.createdAt,
      updated.updatedAt,
    ],
  );
  return updated;
}

export async function getAiAgentThread<State = unknown>(
  id: string,
): Promise<StoredAiAgentThread<State> | null> {
  await ensureTables();
  const db = await getDb();
  const rows = await db.select<ThreadRow[]>(
    'SELECT * FROM ai_agent_threads WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows[0] === undefined ? null : threadFromRow<State>(rows[0]);
}

export async function listAiAgentThreads<State = unknown>(
  bookId: string,
): Promise<Array<StoredAiAgentThread<State>>> {
  await ensureTables();
  const db = await getDb();
  const rows = await db.select<ThreadRow[]>(
    'SELECT * FROM ai_agent_threads WHERE book_id = $1 ORDER BY updated_at DESC',
    [bookId],
  );
  return rows.map(threadFromRow<State>);
}

export async function deleteAiAgentThread(id: string): Promise<void> {
  await ensureTables();
  const db = await getDb();
  const sources = await db.select<Array<{ id: string }>>(
    'SELECT id FROM ai_agent_sources WHERE thread_id = $1',
    [id],
  );
  for (const source of sources) {
    await db.execute('DELETE FROM ai_agent_chunks WHERE source_id = $1', [source.id]);
  }
  await db.execute('DELETE FROM ai_agent_sources WHERE thread_id = $1', [id]);
  await db.execute('DELETE FROM ai_agent_threads WHERE id = $1', [id]);
  // Derived index cleanup is fail-open and may be repaired lazily later.
  await purgeAiAgentRetrievalThread(id);
  await pruneUnreferencedAiAgentEmbeddings();
}

export async function saveAiAgentSource<Meta>(
  source: StoredAiAgentSource<Meta>,
): Promise<void> {
  await ensureTables();
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO ai_agent_sources (id, thread_id, kind, name, rel_path, digest, byte_length, unit_count, meta_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [
      source.id,
      source.threadId,
      source.kind,
      source.name,
      source.relPath,
      source.digest,
      source.byteLength,
      source.unitCount,
      JSON.stringify(source.meta),
      source.createdAt,
    ],
  );
  // Chunks are intentionally written before their source descriptor. This
  // second publication step is therefore where an existing/new source becomes
  // eligible for task-scoped vector and lexical retrieval.
  await refreshAiAgentRetrievalSource(source.id);
}

export async function listAiAgentSources<Meta = unknown>(
  threadId: string,
): Promise<Array<StoredAiAgentSource<Meta>>> {
  await ensureTables();
  const db = await getDb();
  const rows = await db.select<SourceRow[]>(
    'SELECT * FROM ai_agent_sources WHERE thread_id = $1 ORDER BY created_at ASC',
    [threadId],
  );
  return rows.map(sourceFromRow<Meta>);
}

const ATTACHMENT_REFERENCE_KEYS = new Set([
  'managedAttachmentId',
  // PDF extraction stores content-addressed child images below
  // `pdf.pages[].visuals[]` as AgentImageRef values.
  'attachmentId',
  'resourceId',
]);

/**
 * Collect opaque attachment ids from a source ledger without depending on one
 * metadata schema version. A source counts once even when the same
 * content-addressed image appears in several page units.
 */
export function aiAgentAttachmentIdsInMeta(meta: unknown): readonly string[] {
  const ids = new Set<string>();
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (ATTACHMENT_REFERENCE_KEYS.has(key) && typeof child === 'string' && child !== '') {
        ids.add(child);
      }
      visit(child);
    }
  };
  visit(meta);
  return [...ids].sort();
}

/** Number of durable task/source ledgers that still reference managed bytes. */
export async function countAiAgentAttachmentReferences(
  attachmentId: string,
): Promise<number> {
  await ensureTables();
  const db = await getDb();
  const [rows, pendingReferences] = await Promise.all([
    db.select<Array<{ meta_json: string }>>(
      'SELECT meta_json FROM ai_agent_sources',
    ),
    countPendingAiAgentAttachmentReferences(attachmentId),
  ]);
  const sourceReferences = rows.reduce((count, row) => {
    const meta = parseJson<Record<string, unknown>>(row.meta_json, {});
    return count + (aiAgentAttachmentIdsInMeta(meta).includes(attachmentId) ? 1 : 0);
  }, 0);
  return sourceReferences + pendingReferences;
}

export async function replaceAiAgentSourceChunks(
  sourceId: string,
  chunks: readonly StoredAiAgentChunk[],
): Promise<void> {
  await ensureTables();
  const db = await getDb();
  await db.execute('DELETE FROM ai_agent_chunks WHERE source_id = $1', [sourceId]);
  for (const chunk of chunks) {
    if (chunk.sourceId !== sourceId) {
      throw new Error('AI source chunk belongs to a different source');
    }
    await db.execute(
      'INSERT INTO ai_agent_chunks (id, source_id, ordinal, locator, text, digest, embedding_json) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        chunk.id,
        chunk.sourceId,
        chunk.ordinal,
        chunk.locator,
        chunk.text,
        chunk.digest,
        chunk.embedding === null ? null : JSON.stringify(chunk.embedding),
      ],
    );
  }
  await refreshAiAgentRetrievalSource(sourceId);
  await pruneUnreferencedAiAgentEmbeddings();
}

export async function listAiAgentSourceChunks(
  sourceId: string,
): Promise<StoredAiAgentChunk[]> {
  await ensureTables();
  const db = await getDb();
  const rows = await db.select<ChunkRow[]>(
    'SELECT * FROM ai_agent_chunks WHERE source_id = $1 ORDER BY ordinal ASC',
    [sourceId],
  );
  return rows.map(chunkFromRow);
}

/** Load exact-content embedding hits without exposing any source text. */
export async function listAiAgentCachedEmbeddings(
  indexVersion: string,
  contentDigests: readonly string[],
): Promise<StoredAiAgentEmbedding[]> {
  await ensureTables();
  const digests = [...new Set(contentDigests.filter(Boolean))];
  if (digests.length === 0) return [];
  const db = await getDb();
  const placeholders = digests.map((_, index) => `$${index + 2}`).join(', ');
  const rows = await db.select<Array<{
    content_digest: string;
    embedding_json: string;
  }>>(
    'SELECT content_digest, embedding_json FROM ai_agent_embedding_cache ' +
      `WHERE index_version = $1 AND content_digest IN (${placeholders})`,
    [indexVersion, ...digests],
  );
  return rows.flatMap((row) => {
    const embedding = finiteEmbedding(row.embedding_json);
    return embedding === null
      ? []
      : [{ contentDigest: row.content_digest, embedding }];
  });
}

/** Publish provider results only after the owning task's chunk write settles. */
export async function saveAiAgentCachedEmbeddings(
  indexVersion: string,
  entries: readonly StoredAiAgentEmbedding[],
): Promise<void> {
  await ensureTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const unique = new Map(entries.map((entry) => [entry.contentDigest, entry] as const));
  for (const entry of unique.values()) {
    if (entry.contentDigest === '' || !finiteEmbeddingValue(entry.embedding)) continue;
    await db.execute(
      'INSERT OR REPLACE INTO ai_agent_embedding_cache ' +
        '(index_version, content_digest, embedding_json, created_at) VALUES ($1, $2, $3, $4)',
      [indexVersion, entry.contentDigest, JSON.stringify(entry.embedding), now],
    );
  }
}

/** Cancellation cleanup for provider results that must not survive Stop. */
export async function forgetAiAgentCachedEmbeddings(
  indexVersion: string,
  contentDigests: readonly string[],
): Promise<void> {
  await ensureTables();
  const db = await getDb();
  for (const digest of new Set(contentDigests.filter(Boolean))) {
    await db.execute(
      'DELETE FROM ai_agent_embedding_cache WHERE index_version = $1 AND content_digest = $2',
      [indexVersion, digest],
    );
  }
}

/**
 * Forget-source remains truthful: an embedding is retained only while at
 * least one durable source chunk with the same exact digest still exists.
 */
async function pruneUnreferencedAiAgentEmbeddings(): Promise<void> {
  await ensureTables();
  const db = await getDb();
  await db.execute(
    'DELETE FROM ai_agent_embedding_cache WHERE NOT EXISTS (' +
      'SELECT 1 FROM ai_agent_chunks c ' +
      'WHERE c.digest = ai_agent_embedding_cache.content_digest)',
  );
}

/** Forget one source's index. The caller removes its durable asset separately. */
export async function forgetAiAgentSource(sourceId: string): Promise<void> {
  await ensureTables();
  const db = await getDb();
  await db.execute('DELETE FROM ai_agent_chunks WHERE source_id = $1', [sourceId]);
  await db.execute('DELETE FROM ai_agent_sources WHERE id = $1', [sourceId]);
  await purgeAiAgentRetrievalSource(sourceId);
  await pruneUnreferencedAiAgentEmbeddings();
}

/** Test/dev helper: a collision-resistant chunk id without leaking text. */
export function newAiAgentChunkId(): string {
  return nanoid();
}
