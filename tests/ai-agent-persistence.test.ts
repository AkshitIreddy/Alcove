import { describe, expect, it } from 'vitest';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { Checkpoint, CheckpointMetadata } from '@langchain/langgraph-checkpoint';
import {
  countPendingAiAgentAttachmentReferences,
  pendingManagedAiAttachmentsInState,
  SqliteAgentCheckpointSaver,
  SqliteAgentPersistence,
} from '../src/data/aiAgentPersistence';
import {
  countAiAgentAttachmentReferences,
  forgetAiAgentSource,
  saveAiAgentSource,
} from '../src/data/aiAgent';
import { AGENT_STATE_VERSION, type AgentState } from '../src/features/aiAgent/types';

const config = (threadId: string, checkpointId?: string): RunnableConfig => ({
  configurable: {
    thread_id: threadId,
    checkpoint_ns: '',
    ...(checkpointId === undefined ? {} : { checkpoint_id: checkpointId }),
  },
});

function checkpoint(id: string, value: number): Checkpoint {
  return {
    v: 4,
    id,
    ts: new Date().toISOString(),
    channel_values: { value },
    channel_versions: { value },
    versions_seen: {},
  };
}

const metadata: CheckpointMetadata = {
  source: 'loop',
  step: 1,
  parents: {},
};

function state(taskId: string, threadId: string): AgentState {
  const now = new Date().toISOString();
  return {
    schemaVersion: AGENT_STATE_VERSION,
    identity: { threadId, taskId, runId: `run-${taskId}`, bookId: 'book-agent' },
    lifecycle: 'idle',
    phase: 'intake',
    taskBrief: {
      goal: 'Make a useful note',
      assumptions: [],
      preserveAllSourceInformation: false,
    },
    conversation: [],
    modelHistory: [],
    pendingToolCalls: [],
    budget: {
      maxProviderCalls: 12,
      maxToolCalls: 40,
      maxRepairPasses: 4,
      maxProviderRetries: 2,
      maxSourceCharactersPerToolResult: 60_000,
    },
    usage: {
      providerCalls: 0,
      toolCalls: 0,
      repairPasses: 0,
      providerRetries: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    retry: { attempt: 0 },
    cancellation: { requested: false, lastSafeCheckpointStep: 0 },
    checkpointStep: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe('SQLite AI Agent persistence', () => {
  it('round-trips LangGraph checkpoints and pending writes', async () => {
    const saver = new SqliteAgentCheckpointSaver();
    const threadId = `checkpoint-${Date.now()}`;
    const first = checkpoint('0001', 1);
    const second = checkpoint('0002', 2);
    const firstConfig = await saver.put(config(threadId), first, metadata, {});
    await saver.putWrites(firstConfig, [['messages', { text: 'hello' }]], 'task-a');
    await saver.put(firstConfig, second, { ...metadata, step: 2 }, {});

    expect((await saver.getTuple(config(threadId)))?.checkpoint.id).toBe('0002');
    const exact = await saver.getTuple(config(threadId, '0001'));
    expect(exact?.checkpoint.channel_values).toEqual({ value: 1 });
    expect(exact?.pendingWrites).toEqual([
      ['task-a', 'messages', { text: 'hello' }],
    ]);

    const ids: string[] = [];
    for await (const item of saver.list(config(threadId))) {
      ids.push(item.checkpoint.id);
    }
    expect(ids).toEqual(['0002', '0001']);

    await saver.deleteThread(threadId);
    expect(await saver.getTuple(config(threadId))).toBeUndefined();
  });

  it('persists product state and ordered public activity without secrets', async () => {
    const persistence = new SqliteAgentPersistence();
    const taskId = `task-${Date.now()}`;
    const threadId = `thread-${Date.now()}`;
    const stored = state(taskId, threadId);
    await persistence.saveTask(stored);
    expect((await persistence.loadTask(taskId))?.state.identity).toEqual(
      stored.identity,
    );
    expect(await persistence.listTasksForBook('book-agent')).toEqual([
      expect.objectContaining({
        id: taskId,
        title: 'Make a useful note',
        status: 'active',
      }),
    ]);
    await persistence.renameTask(taskId, 'A renamed notebook task');
    expect((await persistence.listTasksForBook('book-agent'))[0]?.title).toBe(
      'A renamed notebook task',
    );

    await persistence.appendEvent({
      id: 'event-2',
      sequence: 2,
      threadId,
      taskId,
      runId: stored.identity.runId,
      at: stored.updatedAt,
      type: 'status.changed',
      phase: 'planning',
      summary: 'Planning the note',
    });
    await persistence.appendEvent({
      id: 'event-1',
      sequence: 1,
      threadId,
      taskId,
      runId: stored.identity.runId,
      at: stored.updatedAt,
      type: 'run.started',
      goal: stored.taskBrief.goal,
    });
    expect((await persistence.listEvents(taskId)).map((event) => event.sequence)).toEqual([
      1,
      2,
    ]);

    await expect(
      persistence.saveTask({ ...stored, apiKey: 'must-not-persist' } as AgentState),
    ).rejects.toThrow(/forbidden field/i);

    await persistence.deleteTask(taskId);
    expect(await persistence.loadTask(taskId)).toBeNull();
    expect(await persistence.listEvents(taskId)).toEqual([]);
    expect(await persistence.listTasksForBook('book-agent')).toEqual([]);
  });

  it('keeps failed-ingestion uploads owned until both pending task and source ledgers release them', async () => {
    const persistence = new SqliteAgentPersistence();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const taskId = `task-pending-upload-${suffix}`;
    const threadId = `thread-pending-upload-${suffix}`;
    const attachmentId = `attachment-pending-upload-${suffix}`;
    const sourceId = `source-pending-upload-${suffix}`;
    const stored: AgentState = {
      ...state(taskId, threadId),
      lifecycle: 'failed',
      pendingSourceAttachments: [{
        kind: 'managed_asset',
        assetId: attachmentId,
        title: 'Recovery source.pdf',
        mediaType: 'application/pdf',
        digest: 'sha256:pending-recovery-source',
      }],
    };

    await persistence.saveTask(stored);
    expect(pendingManagedAiAttachmentsInState(
      (await persistence.loadTask(taskId))?.state,
    )).toEqual(stored.pendingSourceAttachments);
    expect(await countPendingAiAgentAttachmentReferences(attachmentId)).toBe(1);
    expect(await countAiAgentAttachmentReferences(attachmentId)).toBe(1);

    // During the successful-ingestion hand-off, both ledgers may briefly own
    // the same bytes. Reference counting must remain conservative.
    await saveAiAgentSource({
      id: sourceId,
      threadId: taskId,
      kind: 'pdf',
      name: 'Recovery source.pdf',
      relPath: null,
      digest: 'sha256:pending-recovery-source',
      byteLength: 1024,
      unitCount: 1,
      meta: { managedAttachmentId: attachmentId },
      createdAt: new Date().toISOString(),
    });
    expect(await countAiAgentAttachmentReferences(attachmentId)).toBe(2);

    // Deleting an inactive failed task releases its pending ledger, while a
    // committed source row still protects the bytes until source cleanup.
    await persistence.deleteTask(taskId);
    expect(await countPendingAiAgentAttachmentReferences(attachmentId)).toBe(0);
    expect(await countAiAgentAttachmentReferences(attachmentId)).toBe(1);
    await forgetAiAgentSource(sourceId);
    expect(await countAiAgentAttachmentReferences(attachmentId)).toBe(0);
  });

  it('rejects every late task, event, checkpoint, and pending-write resurrection after tombstone', async () => {
    const persistence = new SqliteAgentPersistence();
    const taskId = `task-tombstone-${Date.now()}`;
    const threadId = `thread-tombstone-${Date.now()}`;
    const stored = state(taskId, threadId);
    await persistence.saveTask(stored);
    await persistence.checkpointer.put(
      config(threadId),
      checkpoint('before-delete', 1),
      metadata,
      {},
    );

    await persistence.tombstoneTask(taskId, threadId);

    const lateConfig = await persistence.checkpointer.put(
      config(threadId),
      checkpoint('after-delete', 2),
      { ...metadata, step: 2 },
      {},
    );
    await persistence.checkpointer.putWrites(
      lateConfig,
      [['messages', { text: 'late' }]],
      taskId,
    );
    await persistence.saveTask({ ...stored, lifecycle: 'completed' });
    await persistence.appendEvent({
      id: `event-late-${taskId}`,
      sequence: 99,
      threadId,
      taskId,
      runId: stored.identity.runId,
      at: stored.updatedAt,
      type: 'run.completed',
      summary: 'must not survive deletion',
    });

    expect(await persistence.loadTask(taskId)).toBeNull();
    expect(await persistence.listEvents(taskId)).toEqual([]);
    expect(await persistence.checkpointer.getTuple(config(threadId))).toBeUndefined();
    expect((await persistence.listTasksForBook('book-agent')).some((task) =>
      task.id === taskId,
    )).toBe(false);
  });
});
