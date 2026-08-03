// @vitest-environment node
/**
 * tests/open-anywhere.test.ts — a search hit in another bookcase takes you there.
 *
 * Search and the quick switcher are library-wide on purpose, so a book never
 * vanishes from search because the reader is standing somewhere else. The gap
 * that left: picking a hit from another case opened the book, and CLOSING it
 * dropped the reader onto a shelf that does not contain it. The book opens
 * fine, which is why nothing caught this — it is only wrong on the way out.
 *
 * The decision is small and entirely about ORDER and about which cases are
 * worth switching to, so it is tested at that level rather than by driving the
 * app: the shelf reload that makes the order matter is exactly the part a
 * browser test would have to stub anyway.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const active = { id: 'case-open' };
const books = new Map<string, { id: string; bookcaseId?: string | null } | null>();
const calls: string[] = [];

vi.mock('../src/data/bookcases', () => ({
  activeBookcase: () => active,
  switchBookcase: async (id: string) => {
    calls.push(`switch:${id}`);
    active.id = id;
    return { id };
  },
}));

vi.mock('../src/data/books', () => ({
  getBook: async (id: string) => {
    if (id === 'explodes') throw new Error('db is having a day');
    return books.get(id) ?? null;
  },
}));

vi.mock('../src/state/app', () => ({
  appState: {
    openBook: (id: string) => {
      calls.push(`open:${id}`);
    },
  },
}));

const { caseToSwitchTo, openBookAnywhere } = await import(
  '../src/features/bookshelf/openAnywhere'
);

describe('opening a book that lives somewhere else', () => {
  beforeEach(() => {
    calls.length = 0;
    active.id = 'case-open';
    books.clear();
    books.set('here', { id: 'here', bookcaseId: 'case-open' });
    books.set('elsewhere', { id: 'elsewhere', bookcaseId: 'case-other' });
    books.set('homeless', { id: 'homeless', bookcaseId: null });
  });

  it('switches to the book’s case BEFORE opening it', async () => {
    await openBookAnywhere('elsewhere');
    // Order is the whole point: switchBookcase reloads the shelf's store, and
    // opening first would have the world resolving the book against the old
    // case's floors.
    expect(calls).toEqual(['switch:case-other', 'open:elsewhere']);
  });

  it('does not switch for a book already in the open case', async () => {
    await openBookAnywhere('here');
    expect(calls).toEqual(['open:here']);
  });

  it('leaves a book with no case where it is', async () => {
    // The start-up orphan sweep owns adopting these. Racing it here would be a
    // second, quieter implementation of the same policy.
    await openBookAnywhere('homeless');
    expect(calls).toEqual(['open:homeless']);
  });

  it('still opens the book when the lookup fails', async () => {
    await openBookAnywhere('explodes');
    expect(calls).toEqual(['open:explodes']);
  });

  it('still opens the book when the switch fails', async () => {
    const mod = await import('../src/data/bookcases');
    const spy = vi
      .spyOn(mod, 'switchBookcase')
      .mockRejectedValueOnce(new Error('nope'));
    await openBookAnywhere('elsewhere');
    // Failing to travel must not swallow the book — the reader still gets it,
    // on the shelf they were already standing in.
    expect(calls).toContain('open:elsewhere');
    spy.mockRestore();
  });

  it('reports the case worth switching to, and nothing else', async () => {
    expect(await caseToSwitchTo('elsewhere')).toBe('case-other');
    expect(await caseToSwitchTo('here')).toBeNull();
    expect(await caseToSwitchTo('homeless')).toBeNull();
    expect(await caseToSwitchTo('missing')).toBeNull();
    expect(await caseToSwitchTo('explodes')).toBeNull();
  });
});
