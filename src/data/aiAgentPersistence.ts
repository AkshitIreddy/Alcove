/** SQLite-backed LangGraph checkpoints plus Alcove task/activity persistence. */
import type { RunnableConfig } from '@langchain/core/runnables';
import { BaseCheckpointSaver } from '@langchain/langgraph';
import {
  WRITES_IDX_MAP,
  getCheckpointId,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type {
  AgentActivityEvent,
  AgentState,
  SourceAttachmentRef,
} from '../features/aiAgent/types';
import {
  assertAgentStateIsCheckpointSafe,
  type AgentPersistence,
  type PersistedAgentTask,
} from '../features/aiAgent/persistence';
import { getDb, type Db } from './db';

interface CheckpointRow {
  id: string;
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint_type: string;
  checkpoint_data: string;
  metadata_type: string;
  metadata_data: string;
}

interface WriteRow {
  id: string;
  checkpoint_key: string;
  task_id: string;
  idx: number;
  channel: string;
  value_type: string;
  value_data: string;
}

interface TaskRow {
  id: string;
  state_json: string;
  saved_at: string;
}

interface TaskMetaRow {
  id: string;
  book_id: string;
  title: string;
  status: AgentTaskSummary['status'];
  updated_at: string;
}

export interface AgentTaskSummary {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly status: 'active' | 'paused' | 'complete' | 'error';
  readonly updatedAt: string;
}

interface EventRow {
  id: string;
  task_id: string;
  sequence: number;
  event_json: string;
}

let tablesReady: Promise<void> | null = null;

// Every AI persistence mutation runs through one short browser-process mutex.
// This closes the check-then-write race where a late LangGraph checkpoint could
// observe no tombstone, yield, and INSERT OR REPLACE after task deletion.
let persistenceMutationTail: Promise<void> = Promise.resolve();

async function withPersistenceMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = persistenceMutationTail;
  let release!: () => void;
  persistenceMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function ensureAgentPersistenceTables(db?: Db): Promise<void> {
  const database = db ?? (await getDb());
  tablesReady ??= (async () => {
    await database.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_checkpoints (' +
        'id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL, ' +
        'checkpoint_id TEXT NOT NULL, parent_checkpoint_id TEXT, ' +
        'checkpoint_type TEXT NOT NULL, checkpoint_data TEXT NOT NULL, ' +
        'metadata_type TEXT NOT NULL, metadata_data TEXT NOT NULL)',
    );
    await database.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_checkpoint_writes (' +
        'id TEXT PRIMARY KEY, checkpoint_key TEXT NOT NULL, task_id TEXT NOT NULL, ' +
        'idx INTEGER NOT NULL, channel TEXT NOT NULL, value_type TEXT NOT NULL, ' +
        'value_data TEXT NOT NULL)',
    );
    await database.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_tasks (' +
        'id TEXT PRIMARY KEY, state_json TEXT NOT NULL, saved_at TEXT NOT NULL)',
    );
    await database.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_task_meta (' +
        'id TEXT PRIMARY KEY, book_id TEXT NOT NULL, title TEXT NOT NULL, ' +
        'status TEXT NOT NULL, updated_at TEXT NOT NULL)',
    );
    await database.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_events (' +
        'id TEXT PRIMARY KEY, task_id TEXT NOT NULL, sequence INTEGER NOT NULL, ' +
        'event_json TEXT NOT NULL)',
    );
    await database.execute(
      'CREATE TABLE IF NOT EXISTS ai_agent_task_tombstones (' +
        'id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, deleted_at TEXT NOT NULL)',
    );
    await database.execute(
      'CREATE INDEX IF NOT EXISTS idx_ai_checkpoint_thread ' +
        'ON ai_agent_checkpoints (thread_id, checkpoint_ns, checkpoint_id)',
    );
    await database.execute(
      'CREATE INDEX IF NOT EXISTS idx_ai_checkpoint_writes_key ' +
        'ON ai_agent_checkpoint_writes (checkpoint_key, idx)',
    );
    await database.execute(
      'CREATE INDEX IF NOT EXISTS idx_ai_events_task_sequence ' +
        'ON ai_agent_events (task_id, sequence)',
    );
    await database.execute(
      'CREATE INDEX IF NOT EXISTS idx_ai_task_meta_book_updated ' +
        'ON ai_agent_task_meta (book_id, updated_at)',
    );
  })();
  return tablesReady;
}

function storageKey(threadId: string, namespace: string, checkpointId: string): string {
  return JSON.stringify([threadId, namespace, checkpointId]);
}

function byteJson(bytes: Uint8Array): string {
  return JSON.stringify(Array.from(bytes));
}

function bytesFromJson(raw: string): Uint8Array {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      Array.isArray(value) &&
      value.every(
        (part) =>
          typeof part === 'number' &&
          Number.isInteger(part) &&
          part >= 0 &&
          part <= 255,
      )
    ) {
      return Uint8Array.from(value);
    }
  } catch {
    // fall through
  }
  throw new Error('AI checkpoint contains invalid serialized bytes');
}

function configString(config: RunnableConfig, key: string): string | undefined {
  const value = config.configurable?.[key];
  return typeof value === 'string' ? value : undefined;
}

async function isThreadTombstoned(db: Db, threadId: string): Promise<boolean> {
  const rows = await db.select<Array<{ id: string }>>(
    'SELECT id FROM ai_agent_task_tombstones WHERE thread_id = $1 LIMIT 1',
    [threadId],
  );
  return rows.length > 0;
}

async function deleteCheckpointThreadRows(db: Db, threadId: string): Promise<void> {
  const checkpoints = await db.select<Array<{ id: string }>>(
    'SELECT id FROM ai_agent_checkpoints WHERE thread_id = $1',
    [threadId],
  );
  for (const checkpoint of checkpoints) {
    await db.execute(
      'DELETE FROM ai_agent_checkpoint_writes WHERE checkpoint_key = $1',
      [checkpoint.id],
    );
  }
  await db.execute('DELETE FROM ai_agent_checkpoints WHERE thread_id = $1', [threadId]);
}

/**
 * Browser/Tauri-safe checkpointer. It uses the existing async SQL surface,
 * unlike Node-only sqlite savers that cannot run inside the WebView bundle.
 */
export class SqliteAgentCheckpointSaver extends BaseCheckpointSaver {
  private async db(): Promise<Db> {
    const db = await getDb();
    await ensureAgentPersistenceTables(db);
    return db;
  }

  private async deserialize<T>(type: string, data: string): Promise<T> {
    return this.serde.loadsTyped(type, bytesFromJson(data)) as Promise<T>;
  }

  private async pendingWrites(checkpointKey: string): Promise<CheckpointPendingWrite[]> {
    const db = await this.db();
    const rows = await db.select<WriteRow[]>(
      'SELECT * FROM ai_agent_checkpoint_writes WHERE checkpoint_key = $1 ORDER BY idx ASC',
      [checkpointKey],
    );
    return Promise.all(
      rows.map(async (row) => [
        row.task_id,
        row.channel,
        await this.deserialize(row.value_type, row.value_data),
      ] as CheckpointPendingWrite),
    );
  }

  private async tuple(row: CheckpointRow): Promise<CheckpointTuple> {
    const config: RunnableConfig = {
      configurable: {
        thread_id: row.thread_id,
        checkpoint_ns: row.checkpoint_ns,
        checkpoint_id: row.checkpoint_id,
      },
    };
    const tuple: CheckpointTuple = {
      config,
      checkpoint: await this.deserialize<Checkpoint>(
        row.checkpoint_type,
        row.checkpoint_data,
      ),
      metadata: await this.deserialize<CheckpointMetadata>(
        row.metadata_type,
        row.metadata_data,
      ),
      pendingWrites: await this.pendingWrites(row.id),
    };
    if (row.parent_checkpoint_id !== null) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = configString(config, 'thread_id');
    if (threadId === undefined) return undefined;
    const namespace = configString(config, 'checkpoint_ns') ?? '';
    const checkpointId = getCheckpointId(config);
    const db = await this.db();
    if (await isThreadTombstoned(db, threadId)) return undefined;
    const rows = checkpointId
      ? await db.select<CheckpointRow[]>(
          'SELECT * FROM ai_agent_checkpoints WHERE thread_id = $1 AND checkpoint_ns = $2 AND checkpoint_id = $3 LIMIT 1',
          [threadId, namespace, checkpointId],
        )
      : await db.select<CheckpointRow[]>(
          'SELECT * FROM ai_agent_checkpoints WHERE thread_id = $1 AND checkpoint_ns = $2 ORDER BY checkpoint_id DESC LIMIT 1',
          [threadId, namespace],
        );
    return rows[0] === undefined ? undefined : this.tuple(rows[0]);
  }

  async *list(
    config: RunnableConfig,
    options: CheckpointListOptions = {},
  ): AsyncGenerator<CheckpointTuple> {
    const db = await this.db();
    const threadId = configString(config, 'thread_id');
    const namespace = configString(config, 'checkpoint_ns');
    const exactId = configString(config, 'checkpoint_id');
    const rows = threadId === undefined
      ? await db.select<CheckpointRow[]>(
          'SELECT * FROM ai_agent_checkpoints ORDER BY checkpoint_id DESC',
        )
      : namespace === undefined
        ? await db.select<CheckpointRow[]>(
            'SELECT * FROM ai_agent_checkpoints WHERE thread_id = $1 ORDER BY checkpoint_id DESC',
            [threadId],
          )
        : await db.select<CheckpointRow[]>(
            'SELECT * FROM ai_agent_checkpoints WHERE thread_id = $1 AND checkpoint_ns = $2 ORDER BY checkpoint_id DESC',
            [threadId, namespace],
          );
    const before = options.before ? getCheckpointId(options.before) : undefined;
    let remaining = options.limit ?? Number.POSITIVE_INFINITY;
    for (const row of rows) {
      if (remaining <= 0) break;
      if (exactId !== undefined && row.checkpoint_id !== exactId) continue;
      if (before !== undefined && row.checkpoint_id >= before) continue;
      const tuple = await this.tuple(row);
      if (
        options.filter !== undefined &&
        !Object.entries(options.filter).every(
          ([key, value]) =>
            (tuple.metadata as Record<string, unknown> | undefined)?.[key] === value,
        )
      ) {
        continue;
      }
      remaining -= 1;
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = configString(config, 'thread_id');
    if (threadId === undefined) {
      throw new Error('AI checkpoint is missing its thread_id');
    }
    const namespace = configString(config, 'checkpoint_ns') ?? '';
    const parentId = getCheckpointId(config) || null;
    const key = storageKey(threadId, namespace, checkpoint.id);
    await withPersistenceMutation(async () => {
      const db = await this.db();
      if (await isThreadTombstoned(db, threadId)) return;
      const [[checkpointType, checkpointBytes], [metadataType, metadataBytes]] =
        await Promise.all([
          this.serde.dumpsTyped(checkpoint),
          this.serde.dumpsTyped(metadata),
        ]);
      await db.execute(
        'INSERT OR REPLACE INTO ai_agent_checkpoints (id, thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_type, checkpoint_data, metadata_type, metadata_data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          key,
          threadId,
          namespace,
          checkpoint.id,
          parentId,
          checkpointType,
          byteJson(checkpointBytes),
          metadataType,
          byteJson(metadataBytes),
        ],
      );
    });
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: namespace,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = configString(config, 'thread_id');
    const namespace = configString(config, 'checkpoint_ns') ?? '';
    const checkpointId = getCheckpointId(config);
    if (threadId === undefined || !checkpointId) {
      throw new Error('AI pending write is missing its checkpoint identity');
    }
    const checkpointKey = storageKey(threadId, namespace, checkpointId);
    await withPersistenceMutation(async () => {
      const db = await this.db();
      if (await isThreadTombstoned(db, threadId)) return;
      for (let position = 0; position < writes.length; position += 1) {
        const [channel, value] = writes[position]!;
        const idx = WRITES_IDX_MAP[channel] ?? position;
        const id = JSON.stringify([checkpointKey, taskId, idx]);
        const existing = await db.select<Array<{ id: string }>>(
          'SELECT id FROM ai_agent_checkpoint_writes WHERE id = $1 LIMIT 1',
          [id],
        );
        // Ordinary writes are append-once. Special negative channels may update.
        if (idx >= 0 && existing.length > 0) continue;
        const [type, bytes] = await this.serde.dumpsTyped(value);
        await db.execute(
          'INSERT OR REPLACE INTO ai_agent_checkpoint_writes (id, checkpoint_key, task_id, idx, channel, value_type, value_data) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, checkpointKey, taskId, idx, channel, type, byteJson(bytes)],
        );
      }
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await withPersistenceMutation(async () => {
      await deleteCheckpointThreadRows(await this.db(), threadId);
    });
  }
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export type PendingManagedAiAttachment = Extract<
  SourceAttachmentRef,
  { readonly kind: 'managed_asset' }
>;

/**
 * Read the byte-free upload ownership ledger from a persisted task state.
 *
 * Treat persisted JSON as untrusted/forward-versioned input: malformed rows
 * retain no host-file capability, and repeated refs count only once per task.
 */
export function pendingManagedAiAttachmentsInState(
  state: unknown,
): readonly PendingManagedAiAttachment[] {
  if (state === null || typeof state !== 'object') return [];
  const pending = (state as { readonly pendingSourceAttachments?: unknown })
    .pendingSourceAttachments;
  if (!Array.isArray(pending)) return [];

  const attachments = new Map<string, PendingManagedAiAttachment>();
  for (const value of pending) {
    if (value === null || typeof value !== 'object') continue;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.kind !== 'managed_asset' ||
      typeof candidate.assetId !== 'string' || candidate.assetId === '' ||
      typeof candidate.title !== 'string' ||
      typeof candidate.mediaType !== 'string' || candidate.mediaType === '' ||
      typeof candidate.digest !== 'string' || candidate.digest === ''
    ) {
      continue;
    }
    attachments.set(candidate.assetId, {
      kind: 'managed_asset',
      assetId: candidate.assetId,
      title: candidate.title,
      mediaType: candidate.mediaType,
      digest: candidate.digest,
    });
  }
  return [...attachments.values()];
}

/** Number of durable product task rows that still own one queued upload. */
export async function countPendingAiAgentAttachmentReferences(
  attachmentId: string,
): Promise<number> {
  if (attachmentId === '') return 0;
  const db = await getDb();
  await ensureAgentPersistenceTables(db);
  const rows = await db.select<TaskRow[]>('SELECT * FROM ai_agent_tasks');
  return rows.reduce((count, row) => {
    const state = parseJson<unknown>(row.state_json);
    return count + (
      pendingManagedAiAttachmentsInState(state).some(
        (attachment) => attachment.assetId === attachmentId,
      )
        ? 1
        : 0
    );
  }, 0);
}

export class SqliteAgentPersistence implements AgentPersistence {
  readonly checkpointer = new SqliteAgentCheckpointSaver();

  private async db(): Promise<Db> {
    const db = await getDb();
    await ensureAgentPersistenceTables(db);
    return db;
  }

  async loadTask(taskId: string): Promise<PersistedAgentTask | null> {
    const db = await this.db();
    const rows = await db.select<TaskRow[]>(
      'SELECT * FROM ai_agent_tasks WHERE id = $1 LIMIT 1',
      [taskId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    const state = parseJson<AgentState>(row.state_json);
    return state === null ? null : { state, savedAt: row.saved_at };
  }

  async saveTask(state: AgentState): Promise<void> {
    assertAgentStateIsCheckpointSafe(state);
    await withPersistenceMutation(async () => {
      const db = await this.db();
      const tombstone = await db.select<Array<{ id: string }>>(
        'SELECT id FROM ai_agent_task_tombstones WHERE id = $1 LIMIT 1',
        [state.identity.taskId],
      );
      if (tombstone.length > 0) return;
      await db.execute(
        'INSERT OR REPLACE INTO ai_agent_tasks (id, state_json, saved_at) VALUES ($1, $2, $3)',
        [state.identity.taskId, JSON.stringify(state), state.updatedAt],
      );
      const existing = await db.select<TaskMetaRow[]>(
        'SELECT * FROM ai_agent_task_meta WHERE id = $1 LIMIT 1',
        [state.identity.taskId],
      );
      const status: AgentTaskSummary['status'] = state.lifecycle === 'completed'
        ? 'complete'
        : state.lifecycle === 'failed'
          ? 'error'
          : state.lifecycle === 'cancelled' || state.lifecycle === 'waiting_for_user' ||
              state.lifecycle === 'waiting_for_preview_decision'
            ? 'paused'
            : 'active';
      await db.execute(
        'INSERT OR REPLACE INTO ai_agent_task_meta (id, book_id, title, status, updated_at) ' +
          'VALUES ($1, $2, $3, $4, $5)',
        [
          state.identity.taskId,
          state.identity.bookId,
          existing[0]?.title ?? state.taskBrief.goal.slice(0, 80),
          status,
          state.updatedAt,
        ],
      );
    });
  }

  async listTasksForBook(bookId: string): Promise<readonly AgentTaskSummary[]> {
    const db = await this.db();
    const rows = await db.select<TaskMetaRow[]>(
      'SELECT * FROM ai_agent_task_meta WHERE book_id = $1 ORDER BY updated_at DESC',
      [bookId],
    );
    return rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
    }));
  }

  async renameTask(taskId: string, title: string): Promise<void> {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (clean === '') throw new Error('task title is empty');
    const db = await this.db();
    await db.execute(
      'UPDATE ai_agent_task_meta SET title = $1 WHERE id = $2',
      [clean, taskId],
    );
  }

  async deleteTask(taskId: string): Promise<void> {
    const db = await this.db();
    const rows = await db.select<TaskRow[]>(
      'SELECT * FROM ai_agent_tasks WHERE id = $1 LIMIT 1',
      [taskId],
    );
    const state = rows[0] === undefined
      ? null
      : parseJson<AgentState>(rows[0].state_json);
    if (state !== null) {
      await this.tombstoneTask(taskId, state.identity.threadId);
      return;
    }
    await db.execute('DELETE FROM ai_agent_events WHERE task_id = $1', [taskId]);
    await db.execute('DELETE FROM ai_agent_tasks WHERE id = $1', [taskId]);
    await db.execute('DELETE FROM ai_agent_task_meta WHERE id = $1', [taskId]);
  }

  async tombstoneTask(taskId: string, threadId: string): Promise<void> {
    await withPersistenceMutation(async () => {
      const db = await this.db();
      await db.execute(
        'INSERT OR REPLACE INTO ai_agent_task_tombstones (id, thread_id, deleted_at) VALUES ($1, $2, $3)',
        [taskId, threadId, new Date().toISOString()],
      );
      await db.execute('DELETE FROM ai_agent_events WHERE task_id = $1', [taskId]);
      await db.execute('DELETE FROM ai_agent_tasks WHERE id = $1', [taskId]);
      await db.execute('DELETE FROM ai_agent_task_meta WHERE id = $1', [taskId]);
      await deleteCheckpointThreadRows(db, threadId);
    });
  }

  async appendEvent(event: AgentActivityEvent): Promise<void> {
    assertAgentStateIsCheckpointSafe(event);
    await withPersistenceMutation(async () => {
      const db = await this.db();
      const tombstone = await db.select<Array<{ id: string }>>(
        'SELECT id FROM ai_agent_task_tombstones WHERE id = $1 LIMIT 1',
        [event.taskId],
      );
      if (tombstone.length > 0) return;
      await db.execute(
        'INSERT OR REPLACE INTO ai_agent_events (id, task_id, sequence, event_json) VALUES ($1, $2, $3, $4)',
        [event.id, event.taskId, event.sequence, JSON.stringify(event)],
      );
    });
  }

  async listEvents(
    taskId: string,
    afterSequence = -1,
  ): Promise<readonly AgentActivityEvent[]> {
    const db = await this.db();
    const rows = await db.select<EventRow[]>(
      'SELECT * FROM ai_agent_events WHERE task_id = $1 AND sequence > $2 ORDER BY sequence ASC',
      [taskId, afterSequence],
    );
    return rows
      .map((row) => parseJson<AgentActivityEvent>(row.event_json))
      .filter((event): event is AgentActivityEvent => event !== null);
  }
}
