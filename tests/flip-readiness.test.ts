import { describe, expect, it, vi } from 'vitest';
import { FlipReadinessGate, flipStartPath } from '../src/flip/readiness';

interface Scene {
  readonly key: string;
  readonly required: readonly string[];
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('page-flip readiness gate', () => {
  it('reserves the crossfade for reduced motion and prepares an ordinary cold curl', () => {
    expect(flipStartPath(true, true, false)).toBe('crossfade');
    expect(flipStartPath(false, true, false)).toBe('prepare');
    expect(flipStartPath(false, true, true)).toBe('animate');
    expect(flipStartPath(false, false, false)).toBe('animate');
  });

  it('holds a cold turn until every unique required face settles and is ready', async () => {
    const front = deferred<void>();
    const revealed = deferred<void>();
    const jobs = new Map([
      ['front', front.promise],
      ['revealed', revealed.promise],
    ]);
    const usable = new Set<string>();
    let currentKey = 'spread-0-next';
    const ready = vi.fn();
    const unavailable = vi.fn();
    const gate = new FlipReadinessGate<Scene>({
      ensure: (id) => jobs.get(id) ?? Promise.resolve(),
      sceneKeyNow: () => currentKey,
      isReady: (scene) => scene.required.every((id) => usable.has(id)),
    });

    gate.prepare(
      {
        scene: { key: currentKey, required: ['front', 'revealed'] },
        sceneKey: currentKey,
        missingIds: ['front', 'revealed', 'front'],
      },
      { ready, unavailable },
    );
    front.resolve();
    usable.add('front');
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();

    usable.add('revealed');
    revealed.resolve();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(unavailable).not.toHaveBeenCalled();
    expect(currentKey).toBe('spread-0-next');
  });

  it('drops a completion when navigation changed the prepared scene', async () => {
    const capture = deferred<void>();
    let currentKey = 'spread-0-next';
    const ready = vi.fn();
    const unavailable = vi.fn();
    const stale = vi.fn();
    const gate = new FlipReadinessGate<Scene>({
      ensure: () => capture.promise,
      sceneKeyNow: () => currentKey,
      isReady: () => true,
    });

    gate.prepare(
      {
        scene: { key: currentKey, required: ['front'] },
        sceneKey: currentKey,
        missingIds: ['front'],
      },
      { ready, unavailable, stale },
    );
    currentKey = 'spread-1-next';
    capture.resolve();

    await vi.waitFor(() => expect(stale).toHaveBeenCalledOnce());
    expect(ready).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
  });

  it('lets a newer request supersede an older in-flight preparation', async () => {
    const oldCapture = deferred<void>();
    const newCapture = deferred<void>();
    let currentKey = 'old';
    const oldReady = vi.fn();
    const newReady = vi.fn();
    const gate = new FlipReadinessGate<Scene>({
      ensure: (id) => id === 'old-face' ? oldCapture.promise : newCapture.promise,
      sceneKeyNow: () => currentKey,
      isReady: () => true,
    });

    gate.prepare(
      { scene: { key: 'old', required: [] }, sceneKey: 'old', missingIds: ['old-face'] },
      { ready: oldReady, unavailable: vi.fn() },
    );
    currentKey = 'new';
    gate.prepare(
      { scene: { key: 'new', required: [] }, sceneKey: 'new', missingIds: ['new-face'] },
      { ready: newReady, unavailable: vi.fn() },
    );
    oldCapture.resolve();
    await Promise.resolve();
    expect(oldReady).not.toHaveBeenCalled();

    newCapture.resolve();
    await vi.waitFor(() => expect(newReady).toHaveBeenCalledOnce());
    expect(oldReady).not.toHaveBeenCalled();
  });

  it('retries a current scene when its first capture was invalidated during layout', async () => {
    let passes = 0;
    let usable = false;
    const ready = vi.fn();
    const unavailable = vi.fn();
    const gate = new FlipReadinessGate<Scene>({
      ensure: async () => {
        passes += 1;
        if (passes === 2) usable = true;
      },
      sceneKeyNow: () => 'same-scene',
      isReady: () => usable,
      scheduleRetry: (run) => queueMicrotask(run),
      maxPasses: 3,
    });

    gate.prepare(
      {
        scene: { key: 'same-scene', required: ['front'] },
        sceneKey: 'same-scene',
        missingIds: ['front'],
      },
      { ready, unavailable },
    );

    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(passes).toBe(2);
    expect(unavailable).not.toHaveBeenCalled();
  });
});
