/**
 * Browser-stub persistence (src/data/db.ts → MemoryDb).
 *
 * Outside Tauri the app runs on a SQL-dialect stub; its tables persist to
 * localStorage so a book created in the browser survives a reload exactly
 * like it would on the real SQLite file. Node (this test environment) has no
 * localStorage, which is also the stub's "stay purely in-memory" signal — so
 * these tests inject a minimal Web Storage fake and clean it up afterwards.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

function installStorage(): FakeStorage {
  const fake = new FakeStorage();
  (globalThis as Record<string, unknown>).localStorage = fake;
  return fake;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

async function freshStub() {
  // A new module registry per scenario so nothing caches across tests.
  vi.resetModules();
  const db = await import('../src/data/db');
  return db;
}

describe('MemoryDb localStorage persistence', () => {
  it('a fresh instance restores rows written by a previous one', async () => {
    installStorage();
    const { MemoryDb } = await freshStub();

    const first = new MemoryDb();
    await first.execute(
      'INSERT INTO books (id, title, floor, slot, spine_seed, cover_meta, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      ['b1', 'Field Notes', 0, 3, 42, null, 'now', 'now'],
    );

    const second = new MemoryDb();
    const rows = await second.select<Array<{ id: string; title: string }>>(
      'SELECT * FROM books WHERE floor = $1 ORDER BY slot ASC',
      [0],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Field Notes');
  });

  it('updates and deletes persist, including ON DELETE CASCADE', async () => {
    installStorage();
    const { MemoryDb } = await freshStub();

    const first = new MemoryDb();
    await first.execute(
      'INSERT INTO books (id, title, floor, slot) VALUES ($1, $2, $3, $4)',
      ['b1', 'Old Title', 0, 0],
    );
    await first.execute(
      'INSERT INTO pages (id, book_id, ord, doc_json) VALUES ($1, $2, $3, $4)',
      ['p1', 'b1', 0, '{}'],
    );
    await first.execute('UPDATE books SET title = $1 WHERE id = $2', [
      'New Title',
      'b1',
    ]);

    const second = new MemoryDb();
    expect(
      await second.select<Array<{ title: string }>>(
        'SELECT title FROM books WHERE id = $1 LIMIT 1',
        ['b1'],
      ),
    ).toEqual([{ title: 'New Title' }]);

    await second.execute('DELETE FROM books WHERE id = $1', ['b1']);

    const third = new MemoryDb();
    expect(await third.select('SELECT * FROM books')).toEqual([]);
    // The cascade removed the page too — and that removal persisted.
    expect(await third.select('SELECT * FROM pages')).toEqual([]);
  });

  it('settings round-trips with INSERT OR REPLACE semantics', async () => {
    installStorage();
    const { MemoryDb } = await freshStub();

    const first = new MemoryDb();
    await first.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      ['library', '{"theme":"athenaeum"}'],
    );
    await first.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      ['library', '{"theme":"observatory"}'],
    );

    const second = new MemoryDb();
    const rows = await second.select<Array<{ value: string }>>(
      'SELECT value FROM settings WHERE key = $1 LIMIT 1',
      ['library'],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.value ?? '{}')).toEqual({
      theme: 'observatory',
    });
  });

  it('a corrupt storage blob starts the stub empty, never throwing', async () => {
    const fake = installStorage();
    const { MemoryDb, STUB_STORAGE_KEY } = await freshStub();
    fake.setItem(STUB_STORAGE_KEY, '{not json at all');
    expect(() => new MemoryDb()).not.toThrow();
    fake.setItem(STUB_STORAGE_KEY, '["an","array"]');
    const db = new MemoryDb();
    expect(await db.select('SELECT * FROM books')).toEqual([]);
  });

  it('without localStorage the stub stays purely in-memory', async () => {
    const { MemoryDb } = await freshStub();
    const first = new MemoryDb();
    await first.execute(
      'INSERT INTO books (id, title, floor, slot) VALUES ($1, $2, $3, $4)',
      ['b1', 'Ephemeral', 0, 0],
    );
    const second = new MemoryDb();
    expect(await second.select('SELECT * FROM books')).toEqual([]);
  });
});

describe('seed survives a reload through the persisted stub', () => {
  it('seedIfEmpty seeds once; after "reload" the welcome book is still there', async () => {
    installStorage();
    const seed1 = await import('../src/data/seed');
    expect(await seed1.seedIfEmpty()).toBe(true);

    // Simulate a reload: fresh module registry, same localStorage.
    vi.resetModules();
    const seed2 = await import('../src/data/seed');
    const books2 = await import('../src/data/books');
    expect(await seed2.seedIfEmpty()).toBe(false);
    const found = await books2.listBooksByFloorRange(0, 7);
    expect(found.map((b) => b.title)).toContain(seed2.WELCOME_BOOK_TITLE);
  });
});
