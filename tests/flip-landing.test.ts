// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForLandingMedia } from '../src/flip/landingMedia';

type Listener = () => void;

function image(options: {
  complete?: boolean;
  decode?: () => Promise<void>;
} = {}): HTMLImageElement & { emit(type: 'load' | 'error'): void } {
  const listeners = new Map<string, Set<Listener>>();
  return {
    src: 'data:image/png;base64,AA==',
    currentSrc: 'data:image/png;base64,AA==',
    complete: options.complete ?? false,
    decode: options.decode,
    addEventListener: (type: string, fn: EventListenerOrEventListenerObject) => {
      const callback = fn as Listener;
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(callback);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(fn as Listener);
    },
    emit(type: 'load' | 'error') {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  } as unknown as HTMLImageElement & { emit(type: 'load' | 'error'): void };
}

function root(images: HTMLImageElement[]): ParentNode {
  return { querySelectorAll: () => images } as unknown as ParentNode;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('page-flip landing media barrier', () => {
  it('does not release the landing raster before a destination image decodes', async () => {
    let release!: () => void;
    const decoded = new Promise<void>((resolve) => {
      release = resolve;
    });
    let done = false;
    const waiting = waitForLandingMedia(root([image({ decode: () => decoded })]), 10_000)
      .then(() => {
        done = true;
      });

    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await waiting;
    expect(done).toBe(true);
  });

  it('falls back to load/error when decode rejects during a source change', async () => {
    const target = image({ decode: async () => Promise.reject(new Error('source changed')) });
    let done = false;
    const waiting = waitForLandingMedia(root([target]), 10_000).then(() => {
      done = true;
    });

    // Let the rejected decode cross the async catch and install its event
    // listeners before emitting the replacement source's load.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(false);
    target.emit('load');
    await waiting;
    expect(done).toBe(true);
  });

  it('uses the cap as a deadlock guard for a protocol that never settles', async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => {});
    let done = false;
    const waiting = waitForLandingMedia(root([image({ decode: () => never })]), 25).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(24);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });
});
