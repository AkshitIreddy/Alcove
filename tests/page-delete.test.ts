import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/db')>();
  const memory = new actual.MemoryDb();
  return { ...actual, getDb: async () => memory };
});

import { getDb } from '../src/data/db';
import { createPage, deletePage, listPages, savePageDoc } from '../src/data/pages';
import { loadIndex } from '../src/data/search';

const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('page deletion', () => {
  it('removes the page, its history and search row, then closes ord gaps', async () => {
    const bookId = 'page-delete-book';
    const first = await createPage({ bookId, doc: doc('first') });
    const middle = await createPage({ bookId, doc: doc('middle') });
    const last = await createPage({ bookId, doc: doc('last') });
    await Promise.all([
      savePageDoc(first.id, first.doc),
      savePageDoc(middle.id, middle.doc),
      savePageDoc(last.id, last.doc),
    ]);
    const db = await getDb();
    await db.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      [`page_history:${middle.id}`, '[]'],
    );

    expect(await deletePage(middle.id)).toMatchObject({ id: middle.id });
    expect((await listPages(bookId)).map((page) => [page.id, page.ord])).toEqual([
      [first.id, 0],
      [last.id, 1],
    ]);
    expect((await loadIndex()).some((row) => row.pageId === middle.id)).toBe(false);
    expect(
      await db.select('SELECT value FROM settings WHERE key = $1 LIMIT 1', [
        `page_history:${middle.id}`,
      ]),
    ).toEqual([]);
  });
});
