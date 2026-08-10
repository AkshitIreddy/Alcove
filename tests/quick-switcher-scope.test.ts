import { describe, expect, it } from 'vitest';
import { inSearchScope, searchScopeBookId } from '../src/features/quickswitch/model';

describe('Ctrl+K search scope', () => {
  const pages = [
    { bookId: 'open', title: 'Current page' },
    { bookId: 'other', title: 'Other page' },
  ];

  it('keeps the shelf global and scopes an open book to itself', () => {
    expect(searchScopeBookId('shelf', 'open')).toBeNull();
    expect(searchScopeBookId('book', 'open')).toBe('open');
    expect(inSearchScope(pages, null, (page) => page.bookId)).toHaveLength(2);
    expect(inSearchScope(pages, 'open', (page) => page.bookId)).toEqual([
      pages[0],
    ]);
  });

  it('does not invent a scope before an open book id exists', () => {
    expect(searchScopeBookId('book', null)).toBeNull();
  });
});
