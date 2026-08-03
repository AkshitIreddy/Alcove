/**
 * Sortable tables — click a header cell's arrow to sort by that column:
 * ascending, then descending, then back to the order the rows were written in.
 *
 * THE SORT GOES THROUGH A TRANSACTION, WHICH IS THE WHOLE POINT. A table here
 * is a ProseMirror node; reordering its DOM behind PM's back would be undone
 * by the next re-render and would not be undoable at all. One `replaceWith` of
 * the table node puts the new order in the document, so Ctrl-Z takes it back,
 * the save hook picks it up, and the script exporter prints what the reader
 * sees. It is also why the sort is not a view-only "display order": a notebook
 * page IS its JSON (docs/design/block-editor.md §4), and a sort the file does
 * not know about is a sort that vanishes when the book is closed.
 *
 * WHY THE ARROW IS A WIDGET AND NOT THE WHOLE HEADER CELL. A header cell is
 * editable text — that is what makes it a header worth having. Binding sort to
 * a click anywhere in the cell would mean the reader cannot put a caret in
 * their own column title without reordering the table under it. So each
 * sortable header carries one small drawn chip, in the cell, at its right
 * edge: clicking the header's arrow sorts, clicking the header's words edits
 * them, and neither gesture has to know about the other.
 *
 * WHAT IS REFUSED, ON PURPOSE:
 *   - a table with no header row — there is nothing to click,
 *   - a table with a merged cell anywhere — column N is not a column once a
 *     cell spans two of them, and a sort that guesses would silently shuffle
 *     data into the wrong rows,
 *   - a table with fewer than two body rows — nothing can move.
 * In all three the chip is simply not drawn, so the affordance never lies.
 *
 * DOCUMENT ORDER IS REMEMBERED IN THE DOCUMENT. The third click has to restore
 * an order that no longer exists anywhere else, so the first sort stamps each
 * body row with the index it had (`docOrder`, a real node attribute that
 * serializes). A store on the side would be a second source of truth that the
 * pagination drain — which moves whole blocks between pages — could separate
 * from its table.
 */
import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { play } from '../../sound/engine';
import { nextSortState, sortedRowOrder, type SortDirection } from './sortRows';

const tableSortKey = new PluginKey('nb-table-sort');

const HEADER_CELL = 'tableHeader';

function isSortDirection(value: unknown): value is SortDirection {
  return value === 'asc' || value === 'desc';
}

// ---------------------------------------------------------------------------
// Reading a table
// ---------------------------------------------------------------------------

/** A table that can be sorted, and everything the sort needs to know. */
export interface SortableTable {
  /** Position of the table node itself. */
  readonly pos: number;
  readonly node: ProseMirrorNode;
  /** Column count, taken from the header row. */
  readonly columns: number;
  readonly sortCol: number | null;
  readonly sortDir: SortDirection | null;
}

function spansMoreThanOneCell(cell: ProseMirrorNode): boolean {
  const colspan = cell.attrs.colspan;
  const rowspan = cell.attrs.rowspan;
  return (
    (typeof colspan === 'number' && colspan > 1) ||
    (typeof rowspan === 'number' && rowspan > 1)
  );
}

/**
 * Read a table node into a `SortableTable`, or null when this table must not
 * offer sorting (see the refusals in the file header).
 */
export function describeSortableTable(
  node: ProseMirrorNode,
  pos: number,
): SortableTable | null {
  if (node.type.name !== 'table') return null;
  if (node.childCount < 3) return null; // header + at least two body rows

  const header = node.child(0);
  if (header.childCount === 0) return null;
  for (let i = 0; i < header.childCount; i += 1) {
    if (header.child(i).type.name !== HEADER_CELL) return null;
  }

  const columns = header.childCount;
  for (let r = 0; r < node.childCount; r += 1) {
    const row = node.child(r);
    if (row.childCount !== columns) return null; // ragged: not a grid
    for (let c = 0; c < row.childCount; c += 1) {
      if (spansMoreThanOneCell(row.child(c))) return null;
    }
  }

  const rawCol = node.attrs.sortCol;
  const sortCol =
    typeof rawCol === 'number' && Number.isInteger(rawCol) && rawCol >= 0 && rawCol < columns
      ? rawCol
      : null;
  const rawDir = node.attrs.sortDir;
  return {
    pos,
    node,
    columns,
    sortCol,
    sortDir: sortCol !== null && isSortDirection(rawDir) ? rawDir : null,
  };
}

/** Every sortable table in the document, in reading order. */
export function sortableTables(doc: ProseMirrorNode): SortableTable[] {
  const out: SortableTable[] = [];
  doc.descendants((node, pos) => {
    const table = describeSortableTable(node, pos);
    if (table !== null) out.push(table);
    // Tables can nest inside callouts and columns; keep walking either way.
    return true;
  });
  return out;
}

/** Body rows as plain text, one array of cell strings per row. */
function bodyText(node: ProseMirrorNode, columns: number): string[][] {
  const rows: string[][] = [];
  for (let r = 1; r < node.childCount; r += 1) {
    const row = node.child(r);
    const cells: string[] = [];
    for (let c = 0; c < columns; c += 1) cells.push(row.child(c).textContent);
    rows.push(cells);
  }
  return rows;
}

/** The `docOrder` a row was stamped with, or null when it never has been. */
function docOrderOf(row: ProseMirrorNode): number | null {
  const raw = row.attrs.docOrder;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

// ---------------------------------------------------------------------------
// The transaction
// ---------------------------------------------------------------------------

/**
 * Advance `col`'s sort by one step and write the new row order into the doc.
 * Returns false (changing nothing) when the table refuses sorting.
 */
export function cycleTableSort(editor: Editor, tablePos: number, col: number): boolean {
  const state = editor.state;
  const node = state.doc.nodeAt(tablePos);
  if (node === null) return false;
  const table = describeSortableTable(node, tablePos);
  if (table === null || col < 0 || col >= table.columns) return false;

  const next = nextSortState({ col: table.sortCol, dir: table.sortDir }, col);

  const header = node.child(0);
  const bodyRows: ProseMirrorNode[] = [];
  for (let r = 1; r < node.childCount; r += 1) bodyRows.push(node.child(r));

  // The first sort of this table's life is what records where the rows were.
  // Once stamped, the stamps stay — re-stamping mid-sort would record the
  // SORTED order as the document order and lose the way home for good.
  const alreadyStamped = bodyRows.every((row) => docOrderOf(row) !== null);
  const stamps = alreadyStamped
    ? bodyRows.map((row) => docOrderOf(row) ?? 0)
    : bodyRows.map((_, index) => index);

  let order: number[];
  if (next.dir === null) {
    // Home again: back to the written order, and the stamps come off with it.
    order = bodyRows
      .map((_, index) => index)
      .sort((a, b) => (stamps[a] ?? 0) - (stamps[b] ?? 0));
  } else {
    order = sortedRowOrder(bodyText(node, table.columns), col, next.dir);
  }

  const rows: ProseMirrorNode[] = [header];
  order.forEach((sourceIndex) => {
    const row = bodyRows[sourceIndex];
    if (row === undefined) return;
    const docOrder = next.dir === null ? null : (stamps[sourceIndex] ?? sourceIndex);
    rows.push(row.type.create({ ...row.attrs, docOrder }, row.content, row.marks));
  });
  if (rows.length !== node.childCount) return false; // never ship a shorter table

  const sorted = node.type.create(
    { ...node.attrs, sortCol: next.col, sortDir: next.dir },
    Fragment.from(rows),
    node.marks,
  );

  const tr = state.tr.replaceWith(tablePos, tablePos + node.nodeSize, sorted);
  tr.setMeta('nbTableSort', true);
  editor.view.dispatch(tr);
  return true;
}

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

const ARROWS: Record<'none' | SortDirection, string> = {
  // Unsorted: two small chevrons, the universal "this can be sorted".
  none:
    "<path d='M8 10.4 C 9.4 8.9 10.7 7.7 12 6.6 C 13.3 7.7 14.6 8.9 16 10.4'/>" +
    "<path d='M8 13.6 C 9.4 15.1 10.7 16.3 12 17.4 C 13.3 16.3 14.6 15.1 16 13.6'/>",
  asc:
    "<path d='M12 3.6 C 12.4 8.4 12.4 13.4 12 18.4'/>" +
    "<path d='M7.4 8.4 C 9.2 6.4 10.8 4.8 12 3.6 C 13.2 4.8 14.8 6.4 16.6 8.4'/>",
  desc:
    "<path d='M12 3.6 C 12.4 8.6 12.4 13.6 12 18.4'/>" +
    "<path d='M7.4 13.6 C 9.2 15.6 10.8 17.2 12 18.4 C 13.2 17.2 14.8 15.6 16.6 13.6'/>",
};

const NEXT_WORDS: Record<'none' | SortDirection, string> = {
  none: 'Sort A→Z',
  asc: 'Sort Z→A',
  desc: 'Back to written order',
};

function chipDom(
  view: EditorView,
  getPos: () => number | undefined,
  column: number,
  dir: SortDirection | null,
): HTMLElement {
  const state: 'none' | SortDirection = dir ?? 'none';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nb-th-sort';
  button.contentEditable = 'false';
  button.dataset.dir = state;
  button.dataset.column = String(column);
  button.setAttribute('aria-label', NEXT_WORDS[state]);
  button.setAttribute('data-tooltip', NEXT_WORDS[state]);
  button.setAttribute('data-tooltip-side', 'top');
  button.innerHTML =
    "<svg viewBox='0 0 24 24' aria-hidden='true' fill='none' " +
    "stroke='currentColor' stroke-width='1.9' stroke-linecap='round' " +
    `stroke-linejoin='round'>${ARROWS[state]}</svg>`;

  button.addEventListener('mousedown', (event) => {
    // The caret belongs wherever the reader left it; a sort is not a click
    // into the header's words.
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const pos = getPos();
    if (pos === undefined) return;
    const found = tableAround(view.state, pos);
    if (found === null) return;
    const editor: Editor | undefined = (view as unknown as { nbEditor?: Editor }).nbEditor;
    if (editor === undefined) return;
    if (cycleTableSort(editor, found.tablePos, column)) void play('pop-soft');
  });
  return button;
}

/** Walk up from `pos` to the table it sits in. */
function tableAround(
  state: EditorState,
  pos: number,
): { tablePos: number } | null {
  const $pos = state.doc.resolve(Math.min(pos, state.doc.content.size));
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'table') {
      return { tablePos: $pos.before(depth) };
    }
  }
  return null;
}

/**
 * One chip per sortable header cell, plus a class on the cell so the stylesheet
 * can reserve room for it.
 *
 * Widgets carry a `key` that encodes the column and its direction, so a
 * transaction that changes neither reuses the same DOM node — otherwise every
 * keystroke anywhere on the page would rebuild every chip in every table.
 */
function sortDecorations(state: EditorState): DecorationSet {
  const tables = sortableTables(state.doc);
  if (tables.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  for (const table of tables) {
    const header = table.node.child(0);
    // +1 steps inside the table node, another +1 inside the header row.
    let cellPos = table.pos + 2;
    for (let col = 0; col < header.childCount; col += 1) {
      const cell = header.child(col);
      const dir = table.sortCol === col ? table.sortDir : null;
      decorations.push(
        Decoration.node(cellPos, cellPos + cell.nodeSize, {
          class: 'nb-th-sortable',
          'data-sorted': dir ?? 'none',
        }),
      );
      decorations.push(
        Decoration.widget(
          cellPos + 1,
          (view, getPos) => chipDom(view, getPos, col, dir),
          {
            side: -1,
            key: `nb-sort-${col}-${dir ?? 'none'}`,
            ignoreSelection: true,
            stopEvent: () => true,
          },
        ),
      );
      cellPos += cell.nodeSize;
    }
  }
  return DecorationSet.create(state.doc, decorations);
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableSort: {
      /** Advance the sort of `column` in the table around the caret. */
      sortTableColumn: (column: number) => ReturnType;
    };
  }
}

export const TableSort = Extension.create({
  name: 'tableSort',

  addGlobalAttributes() {
    return [
      {
        types: ['table'],
        attributes: {
          sortCol: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.getAttribute('data-sort-col');
              if (raw === null) return null;
              const value = Number(raw);
              return Number.isInteger(value) && value >= 0 ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.sortCol === 'number'
                ? { 'data-sort-col': String(attributes.sortCol) }
                : {},
          },
          sortDir: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.getAttribute('data-sort-dir');
              return isSortDirection(raw) ? raw : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              isSortDirection(attributes.sortDir)
                ? { 'data-sort-dir': attributes.sortDir }
                : {},
          },
        },
      },
      {
        types: ['tableRow'],
        attributes: {
          docOrder: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.getAttribute('data-doc-order');
              if (raw === null) return null;
              const value = Number(raw);
              return Number.isInteger(value) && value >= 0 ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.docOrder === 'number'
                ? { 'data-doc-order': String(attributes.docOrder) }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      sortTableColumn:
        (column) =>
        ({ editor, state }) => {
          const found = tableAround(state, state.selection.head);
          if (found === null) return false;
          return cycleTableSort(editor, found.tablePos, column);
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: tableSortKey,
        view: (view) => {
          // The chip's click handler needs the Editor (for commands + history)
          // and a plugin view only ever gets the EditorView. Hanging it here
          // is how the two are joined without a module-level singleton, which
          // would be wrong the moment a spread mounts two editors.
          (view as unknown as { nbEditor?: Editor }).nbEditor = editor;
          return {
            destroy: () => {
              delete (view as unknown as { nbEditor?: Editor }).nbEditor;
            },
          };
        },
        props: {
          decorations: (state) => sortDecorations(state),
        },
      }),
    ];
  },
});
