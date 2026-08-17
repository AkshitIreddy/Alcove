import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDb, STUB_STORAGE_KEY } from '../src/data/db';

describe('browser MemoryDb persistence', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
    key: vi.fn(() => null),
    get length() {
      return values.size;
    },
  } satisfies Storage;

  beforeEach(() => {
    values.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('coalesces a burst of mutations into one reload-safe snapshot', async () => {
    const db = new MemoryDb();
    await db.execute('INSERT INTO pages (id, ord) VALUES ($1, $2)', ['a', 0]);
    await db.execute('INSERT INTO pages (id, ord) VALUES ($1, $2)', ['b', 1]);
    await db.execute('UPDATE pages SET ord = $1 WHERE id = $2', [2, 'b']);

    expect(storage.setItem).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(
      STUB_STORAGE_KEY,
      expect.stringContaining('"id":"b","ord":2'),
    );

    const restored = new MemoryDb();
    await expect(restored.select('SELECT * FROM pages ORDER BY ord ASC'))
      .resolves.toEqual([{ id: 'a', ord: 0 }, { id: 'b', ord: 2 }]);
  });

  it('flushes a pending snapshot when the page reloads before its timer', async () => {
    const db = new MemoryDb();
    await db.execute('INSERT INTO pages (id, ord) VALUES ($1, $2)', ['latest', 0]);

    expect(storage.setItem).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(values.get(STUB_STORAGE_KEY)).toContain('"id":"latest"');

    await vi.runAllTimersAsync();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
});
