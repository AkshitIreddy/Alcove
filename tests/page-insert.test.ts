import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/db')>();
  const memory = new actual.MemoryDb();
  return { ...actual, getDb: async () => memory };
});

import {
  createPage,
  insertPageAfter,
  insertPageBefore,
  listPages,
} from '../src/data/pages';

const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('inserting pages into an existing book', () => {
  it('opens an exact gap before or after the chosen page', async () => {
    const bookId = 'page-insert-book';
    const first = await createPage({ bookId, doc: doc('first') });
    const middle = await createPage({ bookId, doc: doc('middle') });
    const last = await createPage({ bookId, doc: doc('last') });

    const before = await insertPageBefore(middle.id, { doc: doc('before') });
    const after = await insertPageAfter(middle.id, { doc: doc('after') });

    expect((await listPages(bookId)).map((page) => [page.id, page.ord])).toEqual([
      [first.id, 0],
      [before?.id, 1],
      [middle.id, 2],
      [after?.id, 3],
      [last.id, 4],
    ]);
  });

  it('can insert before the first and after the last page', async () => {
    const bookId = 'page-insert-edges';
    const first = await createPage({ bookId, doc: doc('first') });
    const last = await createPage({ bookId, doc: doc('last') });

    const newFirst = await insertPageBefore(first.id, { doc: doc('new first') });
    const newLast = await insertPageAfter(last.id, { doc: doc('new last') });

    expect((await listPages(bookId)).map((page) => page.id)).toEqual([
      newFirst?.id,
      first.id,
      last.id,
      newLast?.id,
    ]);
  });
});
