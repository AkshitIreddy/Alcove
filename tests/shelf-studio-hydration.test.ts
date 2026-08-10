import { describe, expect, it } from 'vitest';
import { createLatestBookHydrator } from '../src/views/rail/latestBookHydration';

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

describe('Shelf Studio book hydration authority', () => {
  it('keeps B authoritative when A resolves after it', async () => {
    const a = deferred<{ id: string } | null>();
    const b = deferred<{ id: string } | null>();
    const applied: string[] = [];
    const gate = createLatestBookHydrator(
      (id) => id === 'A' ? a.promise : b.promise,
      (id, value) => applied.push(`${id}:${value?.id ?? 'null'}`),
    );

    gate.select('A');
    gate.select('B');
    b.resolve({ id: 'B' });
    await b.promise;
    await Promise.resolve();
    a.resolve({ id: 'A' });
    await a.promise;
    await Promise.resolve();

    expect(applied).toEqual(['B:B']);
  });

  it('discards a pending result after clear or unmount', async () => {
    const a = deferred<{ id: string } | null>();
    const applied: string[] = [];
    const gate = createLatestBookHydrator(
      () => a.promise,
      (id) => applied.push(id),
    );

    gate.select('A');
    gate.select(null);
    a.resolve({ id: 'A' });
    await a.promise;
    await Promise.resolve();
    expect(applied).toEqual([]);

    const c = deferred<{ id: string } | null>();
    const cancelled = createLatestBookHydrator(() => c.promise, (id) => applied.push(id));
    cancelled.select('C');
    cancelled.cancel();
    c.resolve({ id: 'C' });
    await c.promise;
    await Promise.resolve();
    expect(applied).toEqual([]);
  });
});
