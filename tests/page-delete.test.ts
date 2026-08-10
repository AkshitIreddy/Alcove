import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/db')>();
  const memory = new actual.MemoryDb();
  return { ...actual, getDb: async () => memory };
});

import { getDb } from '../src/data/db';
import {
  createPage,
  deletePage,
  isPageFlowStart,
  listPages,
  savePageDoc,
  setPageFlowStart,
} from '../src/data/pages';
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
    await setPageFlowStart(middle.id, true);

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
    expect(await isPageFlowStart(middle.id)).toBe(false);
  });

  it('migrates legacy flow metadata out of the document attrs', async () => {
    const bookId = 'legacy-page-flow-book';
    const page = await createPage({
      bookId,
      doc: {
        ...doc('anchored'),
        attrs: { pageStyle: 'ruled', flowStart: true },
      },
    });

    const [read] = await listPages(bookId);
    expect(read?.doc.attrs).toEqual({ pageStyle: 'ruled' });
    expect(await isPageFlowStart(page.id)).toBe(true);

    const db = await getDb();
    const rows = await db.select<Array<{ doc_json: string }>>(
      'SELECT doc_json FROM pages WHERE id = $1 LIMIT 1',
      [page.id],
    );
    expect(JSON.parse(rows[0]!.doc_json).attrs).toEqual({ pageStyle: 'ruled' });
  });
});
