import { describe, expect, it } from 'vitest';
import type { Page, PageDoc } from '../src/data/types';
import { mergePageOrderPreservingLiveDocs } from '../src/views/spread';

const doc = (text: string): PageDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const page = (id: string, ord: number, value: PageDoc): Page => ({
  id,
  bookId: 'book',
  ord,
  doc: value,
  scriptSource: null,
  sourceDirty: false,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
});

describe('page-order refresh', () => {
  it('takes durable ordinals but never resurrects a pre-overflow document', () => {
    const staleFull = doc('section still present at the source');
    const liveTrimmed = doc('source after overflow removal');
    const spill = doc('section moved into the new spill');
    const following = doc('protected following section');

    const merged = mergePageOrderPreservingLiveDocs(
      [
        page('source', 0, staleFull),
        page('spill', 1, spill),
        page('following', 2, following),
      ],
      [page('source', 0, liveTrimmed), page('following', 1, following)],
    );

    expect(merged.map(({ id, ord }) => ({ id, ord }))).toEqual([
      { id: 'source', ord: 0 },
      { id: 'spill', ord: 1 },
      { id: 'following', ord: 2 },
    ]);
    expect(merged[0]?.doc).toEqual(liveTrimmed);
    expect(merged[1]?.doc).toEqual(spill);
    expect(merged[2]?.doc).toEqual(following);
  });
});
