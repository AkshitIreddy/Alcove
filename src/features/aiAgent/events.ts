import type { AgentPersistence } from './persistence';
import type {
  AgentActivityEvent,
  AgentRunIdentity,
  IsoTimestamp,
} from './types';

export type AgentEventListener = (event: AgentActivityEvent) => void;

type EventPayload = AgentActivityEvent extends infer Event
  ? Event extends AgentActivityEvent
    ? Omit<Event, 'id' | 'sequence' | 'threadId' | 'taskId' | 'runId' | 'at'>
    : never
  : never;

/** Ordered, de-duplicated live activity with an optional durable journal. */
export class AgentEventBus {
  private readonly listeners = new Set<AgentEventListener>();
  private readonly emittedIds = new Set<string>();
  private sequence = 0;
  private suppressed = false;

  constructor(
    private readonly identity: AgentRunIdentity,
    private readonly persistence: AgentPersistence,
    private readonly now: () => IsoTimestamp,
  ) {}

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(payload: EventPayload, stableSuffix?: string): Promise<AgentActivityEvent> {
    const id = `${this.identity.runId}:${stableSuffix ?? this.sequence + 1}`;
    const event = {
      ...payload,
      id,
      sequence: this.sequence + 1,
      threadId: this.identity.threadId,
      taskId: this.identity.taskId,
      runId: this.identity.runId,
      at: this.now(),
    } as AgentActivityEvent;
    if (this.emittedIds.has(id) || this.suppressed) return event;
    this.emittedIds.add(id);
    this.sequence += 1;
    await this.persistence.appendEvent(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  /** Stop all late provider/tool events after a run has been cancelled. */
  suppress(): void {
    this.suppressed = true;
  }

  resume(): void {
    this.suppressed = false;
  }

  async hydrateSequence(): Promise<void> {
    const events = await this.persistence.listEvents(this.identity.taskId);
    this.sequence = events.reduce(
      (highest, event) => Math.max(highest, event.sequence),
      0,
    );
    for (const event of events) this.emittedIds.add(event.id);
  }
}
