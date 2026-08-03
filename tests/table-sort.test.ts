// @vitest-environment node
/**
 * tests/table-sort.test.ts — click a header, the rows reorder.
 *
 * Three layers, because the feature fails differently at each and only the
 * last one is what a reader sees:
 *
 *   1. THE ORDERING RULES (src/editor/tables/sortRows.ts) — pure, and where
 *      the judgement calls live: a column of numbers with one "n/a" in it, a
 *      blank that must not float to the top when the arrow flips, a date that
 *      is only a date when it is unambiguous.
 *   2. WHAT REFUSES TO SORT (`describeSortableTable`) — a merged cell means
 *      column N is no longer a column, and a sort that guessed would shuffle
 *      data into the wrong rows silently. The chip is simply not drawn, so the
 *      affordance never lies; these assertions are what keep it from being
 *      drawn anyway.
 *   3. THE ATTRIBUTES ARE STORAGE, not view state. `sortCol`, `sortDir` and
 *      `docOrder` have to survive the schema round trip, or a book closed on a
 *      sorted table opens on an unsorted one — and worse, the third click's
 *      way home would be gone.
 *
 * The transaction itself (`cycleTableSort`) needs a live EditorView and is
 * driven in the running app instead; this file covers everything decidable
 * without one.
 */
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import {
  compareCells,
  nextSortState,
  readCell,
  sortedRowOrder,
} from '../src/editor/tables/sortRows';

/** Same DOM shim as tests/editor-depth.test.ts — node views register roots. */
const globals = globalThis as Record<string, unknown>;
if (typeof globals.window === 'undefined') {
  globals.window = globals;
  globals.document = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

const { createEditorExtensions } = await import('../src/editor/extensions');
const { describeSortableTable, sortableTables } = await import(
  '../src/editor/tables/sortable'
);
const schema = getSchema(createEditorExtensions());

// ---------------------------------------------------------------------------
// 1. the ordering rules
// ---------------------------------------------------------------------------

describe('reading one cell', () => {
  it('reads the numbers people actually write in tables', () => {
    expect(readCell('12')).toMatchObject({ kind: 'number', n: 12 });
    expect(readCell('1,250')).toMatchObject({ kind: 'number', n: 1250 });
    expect(readCell('£4.50')).toMatchObject({ kind: 'number', n: 4.5 });
    expect(readCell('12%')).toMatchObject({ kind: 'number', n: 12 });
    expect(readCell('(300)')).toMatchObject({ kind: 'number', n: -300 });
    expect(readCell('-2.5')).toMatchObject({ kind: 'number', n: -2.5 });
  });

  it('refuses to call a word a number because it starts with one', () => {
    expect(readCell('3 cats').kind).toBe('text');
    expect(readCell('12a').kind).toBe('text');
    // Not a grouping position: "1,5" is not fifteen hundred anywhere.
    expect(readCell('1,5').kind).toBe('text');
  });

  it('takes ISO dates as dates and every other date shape as words', () => {
    expect(readCell('2026-08-03').kind).toBe('date');
    expect(readCell('2026-08-03T09:30').kind).toBe('date');
    // Third of August or eighth of March? A notebook cannot ask.
    expect(readCell('03/08/2026').kind).toBe('text');
  });

  it('calls whitespace blank', () => {
    expect(readCell('').kind).toBe('blank');
    expect(readCell('   ').kind).toBe('blank');
  });
});

describe('ordering a column', () => {
  const col = (...cells: string[]): string[][] => cells.map((c) => [c]);

  it('sorts numbers as numbers, not as strings', () => {
    const order = sortedRowOrder(col('110', '3', '12'), 0, 'asc');
    expect(order.map((i) => ['110', '3', '12'][i])).toEqual(['3', '12', '110']);
  });

  it('files words the way a hand would — case and accents folded', () => {
    const rows = col('pear', 'Apple', 'Éclair');
    const order = sortedRowOrder(rows, 0, 'asc');
    expect(order.map((i) => rows[i]![0])).toEqual(['Apple', 'Éclair', 'pear']);
  });

  it('puts "page 2" before "page 10"', () => {
    const rows = col('page 10', 'page 2');
    expect(sortedRowOrder(rows, 0, 'asc').map((i) => rows[i]![0])).toEqual([
      'page 2',
      'page 10',
    ]);
  });

  it('keeps a numeric column numeric when one cell is words', () => {
    const rows = col('12', 'n/a', '3');
    expect(sortedRowOrder(rows, 0, 'asc').map((i) => rows[i]![0])).toEqual([
      '3',
      '12',
      'n/a',
    ]);
  });

  it('sinks blanks in BOTH directions', () => {
    const rows = col('b', '', 'a');
    expect(sortedRowOrder(rows, 0, 'asc').map((i) => rows[i]![0])).toEqual([
      'a',
      'b',
      '',
    ]);
    expect(sortedRowOrder(rows, 0, 'desc').map((i) => rows[i]![0])).toEqual([
      'b',
      'a',
      '',
    ]);
  });

  it('leaves ties in the order they were written', () => {
    const rows = [
      ['same', 'first'],
      ['same', 'second'],
      ['same', 'third'],
    ];
    expect(sortedRowOrder(rows, 0, 'asc')).toEqual([0, 1, 2]);
    // …and flipping the arrow does not shuffle equal rows either.
    expect(sortedRowOrder(rows, 0, 'desc')).toEqual([0, 1, 2]);
  });

  it('treats a missing cell as blank rather than throwing', () => {
    expect(sortedRowOrder([['a'], []], 0, 'asc')).toEqual([0, 1]);
    expect(sortedRowOrder([['a']], 5, 'asc')).toEqual([0]);
  });

  it('ranks kinds before values, so numbers precede words precede blanks', () => {
    expect(compareCells(readCell('9'), readCell('a'))).toBeLessThan(0);
    expect(compareCells(readCell('a'), readCell(''))).toBeLessThan(0);
  });
});

describe('the click cycle', () => {
  it('walks unsorted → ascending → descending → written order', () => {
    let state: { col: number | null; dir: 'asc' | 'desc' | null } = {
      col: null,
      dir: null,
    };
    state = nextSortState(state, 1);
    expect(state).toEqual({ col: 1, dir: 'asc' });
    state = nextSortState(state, 1);
    expect(state).toEqual({ col: 1, dir: 'desc' });
    state = nextSortState(state, 1);
    expect(state).toEqual({ col: null, dir: null });
  });

  it('starts a different column at ascending, whatever the last one was', () => {
    expect(nextSortState({ col: 0, dir: 'desc' }, 2)).toEqual({
      col: 2,
      dir: 'asc',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. what refuses to sort
// ---------------------------------------------------------------------------

const cell = (text: string, attrs: Record<string, unknown> = {}) => ({
  type: 'tableCell',
  attrs,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const head = (text: string, attrs: Record<string, unknown> = {}) => ({
  type: 'tableHeader',
  attrs,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const row = (...cells: unknown[]) => ({ type: 'tableRow', content: cells });
const table = (...rows: unknown[]) => ({ type: 'table', content: rows });

function node(json: Record<string, unknown>): ProseMirrorNode {
  return schema.nodeFromJSON(json);
}

/** A well-formed two-column table with `bodyRows` body rows. */
function grid(bodyRows: number): Record<string, unknown> {
  const rows: unknown[] = [row(head('Fruit'), head('Count'))];
  for (let i = 0; i < bodyRows; i += 1) {
    rows.push(row(cell(`name ${i}`), cell(String(i))));
  }
  return table(...rows) as Record<string, unknown>;
}

describe('which tables offer sorting', () => {
  it('describes a plain header + two body rows', () => {
    const found = describeSortableTable(node(grid(2)), 0);
    expect(found).not.toBeNull();
    expect(found?.columns).toBe(2);
    expect(found?.sortCol).toBeNull();
  });

  it('refuses a table with nothing that can move', () => {
    expect(describeSortableTable(node(grid(1)), 0)).toBeNull();
  });

  it('refuses a table whose first row is not a header row', () => {
    const noHead = table(
      row(cell('Fruit'), cell('Count')),
      row(cell('pear'), cell('12')),
      row(cell('apple'), cell('3')),
    );
    expect(describeSortableTable(node(noHead as Record<string, unknown>), 0)).toBeNull();
  });

  it('refuses a table with a merged cell — column N is not a column', () => {
    const merged = table(
      row(head('Fruit'), head('Count')),
      row(cell('pear', { colspan: 2 })),
      row(cell('apple'), cell('3')),
    );
    expect(describeSortableTable(node(merged as Record<string, unknown>), 0)).toBeNull();

    const spanned = table(
      row(head('Fruit'), head('Count')),
      row(cell('pear', { rowspan: 2 }), cell('12')),
      row(cell('apple'), cell('3')),
    );
    expect(describeSortableTable(node(spanned as Record<string, unknown>), 0)).toBeNull();
  });

  it('refuses a ragged table', () => {
    const ragged = table(
      row(head('Fruit'), head('Count')),
      row(cell('pear')),
      row(cell('apple'), cell('3')),
    );
    expect(describeSortableTable(node(ragged as Record<string, unknown>), 0)).toBeNull();
  });

  it('is not fooled by anything that is not a table', () => {
    expect(
      describeSortableTable(
        node({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }),
        0,
      ),
    ).toBeNull();
  });

  it('finds tables nested inside other blocks', () => {
    const doc = node({
      type: 'doc',
      content: [
        { type: 'paragraph' },
        grid(2),
        { type: 'callout', attrs: { icon: 'leaf', tint: 'moss' }, content: [grid(3)] },
      ],
    });
    expect(sortableTables(doc)).toHaveLength(2);
  });

  it('ignores a stored sort column the table no longer has', () => {
    const over = { ...grid(2), attrs: { sortCol: 9, sortDir: 'asc' } };
    const found = describeSortableTable(node(over), 0);
    expect(found?.sortCol).toBeNull();
    expect(found?.sortDir).toBeNull();
  });

  it('ignores a stored direction that is not one', () => {
    const junk = { ...grid(2), attrs: { sortCol: 0, sortDir: 'sideways' } };
    expect(describeSortableTable(node(junk), 0)?.sortDir).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. the sort is in the document, not beside it
// ---------------------------------------------------------------------------

describe('a sorted table is still sorted after a round trip', () => {
  it('keeps sortCol, sortDir and every row stamp through the schema', () => {
    const sorted = {
      type: 'table',
      attrs: { sortCol: 1, sortDir: 'desc' },
      content: [
        row(head('Fruit'), head('Count')),
        { type: 'tableRow', attrs: { docOrder: 2 }, content: [cell('quince'), cell('110')] },
        { type: 'tableRow', attrs: { docOrder: 0 }, content: [cell('pear'), cell('12')] },
        { type: 'tableRow', attrs: { docOrder: 1 }, content: [cell('apple'), cell('3')] },
      ],
    };
    const back = node(sorted as Record<string, unknown>).toJSON() as {
      attrs: Record<string, unknown>;
      content: Array<{ attrs?: Record<string, unknown> }>;
    };
    expect(back.attrs.sortCol).toBe(1);
    expect(back.attrs.sortDir).toBe('desc');
    expect(back.content.slice(1).map((r) => r.attrs?.docOrder)).toEqual([2, 0, 1]);

    // …and the stamps are enough on their own to find the way home.
    const stamps = [2, 0, 1];
    const home = stamps.map((_, i) => i).sort((a, b) => stamps[a]! - stamps[b]!);
    expect(home.map((i) => ['quince', 'pear', 'apple'][i])).toEqual([
      'pear',
      'apple',
      'quince',
    ]);
  });

  it('leaves an unsorted table carrying no sort attributes at all', () => {
    const back = node(grid(2)).toJSON() as { attrs: Record<string, unknown> };
    expect(back.attrs.sortCol ?? null).toBeNull();
    expect(back.attrs.sortDir ?? null).toBeNull();
  });
});
