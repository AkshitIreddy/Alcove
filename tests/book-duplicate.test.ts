import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/db')>();
  const memory = new actual.MemoryDb();
  return { ...actual, getDb: async () => memory };
});

import {
  createBook,
  duplicateBook,
  readShelfMeta,
} from '../src/data/books';
import { createPage, listPages } from '../src/data/pages';
import {
  bookBinding,
  copyBookBinding,
  saveBookBinding,
} from '../src/data/designPrefs';

const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('book duplication', () => {
  it('copies the exact procedural exterior onto an empty book', async () => {
    const source = await createBook({
      id: 'duplicate-cover-source',
      title: 'Field Atlas',
      bookcaseId: 'case-a',
      floor: 2,
      slot: 4,
      spineSeed: 0x73a20b1f,
      coverMeta: {
        style: {
          ornament: 20,
          coverMedallion: 20,
          coverFrame: 48,
          pigment: 13,
        },
        shelf: { pageCount: 1, positionX: 814 },
      },
    });
    await createPage({ bookId: source.id, doc: doc('source page') });

    const copy = await duplicateBook(source.id, { includePages: false });

    expect(copy).not.toBeNull();
    expect(copy?.spineSeed).toBe(source.spineSeed);
    expect(copy?.coverMeta?.style).toEqual(source.coverMeta?.style);
    expect(readShelfMeta(copy ?? { coverMeta: null })?.positionX).toBeUndefined();
    expect(readShelfMeta(copy ?? { coverMeta: null })?.pageCount).toBe(0);
    expect(await listPages(copy!.id)).toEqual([]);
  });

  it('copies every page and its script provenance for a full duplicate', async () => {
    const source = await createBook({
      id: 'duplicate-full-source',
      title: 'Huffman Notes',
      bookcaseId: 'case-b',
      floor: 1,
      slot: 2,
      spineSeed: 0x4219ca7d,
      coverMeta: { style: { ornament: 13, pigment: 29 } },
    });
    await createPage({
      bookId: source.id,
      doc: doc('first'),
      scriptSource: '# first',
    });
    await createPage({
      bookId: source.id,
      doc: doc('second'),
      scriptSource: '# second',
    });

    const copy = await duplicateBook(source.id, { includePages: true });
    const pages = await listPages(copy!.id);

    expect(copy?.spineSeed).toBe(source.spineSeed);
    expect(copy?.coverMeta?.style).toEqual(source.coverMeta?.style);
    expect(pages.map((page) => page.doc)).toEqual([doc('first'), doc('second')]);
    expect(pages.map((page) => page.scriptSource)).toEqual([
      '# first',
      '# second',
    ]);
    expect(readShelfMeta(copy ?? { coverMeta: null })?.pageCount).toBe(2);
  });

  it('copies the separately persisted binding preset', async () => {
    await saveBookBinding('binding-source', 'royal-calf');

    await copyBookBinding('binding-source', 'binding-copy');

    expect(bookBinding('binding-copy')).toBe('royal-calf');
  });
});
