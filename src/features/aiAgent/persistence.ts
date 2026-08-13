import { MemorySaver, type BaseCheckpointSaver } from '@langchain/langgraph';
import type { AgentActivityEvent, AgentState } from './types';

export interface PersistedAgentTask {
  readonly state: AgentState;
  readonly savedAt: string;
}

/**
 * Product-level task persistence around LangGraph's step checkpointer. The
 * SQLite implementation can bind both halves to Alcove's database later.
 */
export interface AgentPersistence {
  readonly checkpointer: BaseCheckpointSaver;
  loadTask(taskId: string): Promise<PersistedAgentTask | null>;
  saveTask(state: AgentState): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  /** Atomically prevent all future state/event/checkpoint resurrection. */
  tombstoneTask?(taskId: string, threadId: string): Promise<void>;
  appendEvent(event: AgentActivityEvent): Promise<void>;
  listEvents(taskId: string, afterSequence?: number): Promise<readonly AgentActivityEvent[]>;
}

const FORBIDDEN_KEY = /^(apiKey|api_key|authorization|credential|secret|rawBytes|blob|abortSignal|editorHandle|databaseHandle)$/i;

export function assertAgentStateIsCheckpointSafe(value: unknown): void {
  const seen = new Set<object>();
  const visit = (current: unknown, path: string): void => {
    if (typeof current === 'string' && /^data:/i.test(current)) {
      throw new Error(`agent checkpoint contains a data URL at ${path}`);
    }
    if (current === null || typeof current !== 'object') return;
    if (seen.has(current)) throw new Error(`agent checkpoint contains a cycle at ${path}`);
    seen.add(current);
    if (
      current instanceof ArrayBuffer ||
      ArrayBuffer.isView(current) ||
      (typeof Blob !== 'undefined' && current instanceof Blob) ||
      (typeof AbortSignal !== 'undefined' && current instanceof AbortSignal)
    ) {
      throw new Error(`agent checkpoint contains a runtime/binary value at ${path}`);
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else {
      for (const [key, item] of Object.entries(current)) {
        if (FORBIDDEN_KEY.test(key)) {
          throw new Error(`agent checkpoint contains forbidden field ${path}.${key}`);
        }
        visit(item, `${path}.${key}`);
      }
    }
    seen.delete(current);
  };
  visit(value, '$');
  try {
    JSON.stringify(value);
  } catch {
    throw new Error('agent checkpoint is not JSON serializable');
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryAgentPersistence implements AgentPersistence {
  readonly checkpointer: BaseCheckpointSaver;
  private readonly tasks = new Map<string, PersistedAgentTask>();
  private readonly events = new Map<string, AgentActivityEvent[]>();
  private readonly tombstones = new Set<string>();

  constructor(checkpointer: BaseCheckpointSaver = new MemorySaver()) {
    this.checkpointer = checkpointer;
  }

  loadTask(taskId: string): Promise<PersistedAgentTask | null> {
    const task = this.tasks.get(taskId);
    return Promise.resolve(task === undefined ? null : clone(task));
  }

  async saveTask(state: AgentState): Promise<void> {
    assertAgentStateIsCheckpointSafe(state);
    if (this.tombstones.has(state.identity.taskId)) return;
    this.tasks.set(state.identity.taskId, {
      state: clone(state),
      savedAt: state.updatedAt,
    });
  }

  deleteTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
    this.events.delete(taskId);
    return Promise.resolve();
  }

  tombstoneTask(taskId: string): Promise<void> {
    this.tombstones.add(taskId);
    this.tasks.delete(taskId);
    this.events.delete(taskId);
    return Promise.resolve();
  }

  appendEvent(event: AgentActivityEvent): Promise<void> {
    assertAgentStateIsCheckpointSafe(event);
    if (this.tombstones.has(event.taskId)) return Promise.resolve();
    const list = this.events.get(event.taskId) ?? [];
    if (!list.some((existing) => existing.id === event.id)) {
      list.push(clone(event));
      list.sort((a, b) => a.sequence - b.sequence);
      this.events.set(event.taskId, list);
    }
    return Promise.resolve();
  }

  listEvents(taskId: string, afterSequence = -1): Promise<readonly AgentActivityEvent[]> {
    return Promise.resolve(
      clone(
        (this.events.get(taskId) ?? []).filter(
          (event) => event.sequence > afterSequence,
        ),
      ),
    );
  }
}
