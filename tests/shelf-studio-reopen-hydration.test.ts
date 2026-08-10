import { describe, expect, it } from 'vitest';
import { createShelfStudioHydration } from '../src/views/rail/latestBookHydration';

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Shelf Studio reopen hydration', () => {
  it('re-reads the same book after close instead of reusing its old snapshot', async () => {
    const a1 = deferred<{ id: string; revision: string } | null>();
    const a2 = deferred<{ id: string; revision: string } | null>();
    let read = 0;
    const events: string[] = [];
    const hydration = createShelfStudioHydration(
      () => ++read === 1 ? a1.promise : a2.promise,
      () => events.push('clear'),
      (_id, value) => events.push(`apply:${value?.revision ?? 'missing'}`),
    );

    hydration.update(true, 'A');
    a1.resolve({ id: 'A', revision: 'A1' });
    await flushPromises();
    hydration.update(false, 'A');

    // Closing revokes the read authority but deliberately preserves A1 for the
    // rail's exit tween. The clear belongs to the next rising edge, immediately
    // before A2 starts loading.
    expect(events).toEqual(['clear', 'apply:A1']);

    hydration.update(true, 'A');
    expect(events).toEqual(['clear', 'apply:A1', 'clear']);

    // The old row stays absent until the fresh, externally edited row arrives.
    a2.resolve({ id: 'A', revision: 'A2' });
    await flushPromises();

    expect(events).toEqual(['clear', 'apply:A1', 'clear', 'apply:A2']);
  });

  it('clears A immediately and rejects its late response after selecting B', async () => {
    const a = deferred<{ id: string } | null>();
    const b = deferred<{ id: string } | null>();
    const events: string[] = [];
    const hydration = createShelfStudioHydration(
      (id) => id === 'A' ? a.promise : b.promise,
      () => events.push('clear'),
      (id, value) => events.push(`apply:${id}:${value?.id ?? 'missing'}`),
    );

    hydration.update(true, 'A');
    hydration.update(true, 'B');
    b.resolve({ id: 'B' });
    await flushPromises();
    a.resolve({ id: 'A' });
    await flushPromises();

    expect(events).toEqual(['clear', 'clear', 'apply:B:B']);
  });

  it('rejects a response that lands while the rail is closed', async () => {
    const a = deferred<{ id: string } | null>();
    const applied: string[] = [];
    const hydration = createShelfStudioHydration(
      () => a.promise,
      () => undefined,
      (id) => applied.push(id),
    );

    hydration.update(true, 'A');
    hydration.update(false, 'A');
    a.resolve({ id: 'A' });
    await flushPromises();

    expect(applied).toEqual([]);
  });
});
