/**
 * columns / col — side-by-side layout, finished.
 *
 * The node pair already existed (it was declared in `containers.ts` beside the
 * stationery) and it was a schema and nothing else: two nodes, one `gap`
 * attribute, one `width` attribute that rendered `flex-grow` — and NO rule
 * anywhere in `src/styles` that ever made the container a flex box. A reader
 * who ran `/columns` got their two columns stacked one above the other, which
 * is a paragraph break with extra steps. There was also no way to add a third
 * column, no way to take one away, and no way to move the divider.
 *
 * So this file is the finish, not a second implementation:
 *
 * 1. LAYOUT lives in `editor.css` (`[data-type='columns']` is the flex row,
 *    `[data-type='col']` is `flex: 1 1 0`). `width` stays what it always was —
 *    a flex-grow weight — so documents written before today still open.
 * 2. COUNT is one command, `setColumnCount(n)`, rather than add/remove pair.
 *    It is total and content-preserving in both directions: growing appends
 *    empty columns, shrinking MERGES the surplus columns' blocks into the last
 *    surviving one. Nothing a reader typed can be destroyed by a menu click,
 *    which is what lets the right-click menu offer "2 / 3 / 4 columns" as
 *    plain radio-ish choices instead of a destructive "remove column".
 * 3. RESIZE is a plain ProseMirror plugin, not a node view. The gap between
 *    two columns is the only place where the columns element ITSELF is the
 *    pointer target (the dividing rule is a `::before` on the right-hand
 *    column with `pointer-events: none`), so a mousedown whose target is the
 *    container is unambiguously a grab of a divider. Dragging moves a ghost on
 *    a body-level layer — the same trick `dragHandle.ts` uses — and ONE
 *    transaction lands on mouseup. Nothing is written per frame, so the drag
 *    costs no re-render, no autosave and no pagination measurement, and undo
 *    takes the whole resize back in one press.
 *
 * The weight maths (`resizeColumnWeights`, `evenColumnWeights`) is pure and
 * DOM-free so it unit-tests in Node.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// ---------------------------------------------------------------------------
// Shape of the axis
// ---------------------------------------------------------------------------

export const COLUMN_GAPS = ['sm', 'md', 'lg'] as const;
export type ColumnGap = (typeof COLUMN_GAPS)[number];

/** The schema says `col{2,4}`; these two constants ARE that range. */
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

/**
 * The narrowest a column may be dragged, as a share of the pair it is being
 * resized against.
 *
 * Not a pixel floor on purpose: a pixel floor behaves differently on a narrow
 * page than a wide one, and the thing a reader is actually protecting against
 * is a column too thin to hold a word. A sixth of the pair is about four
 * characters at the body size on the narrowest page the spread allows.
 */
export const MIN_COLUMN_SHARE = 1 / 6;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Weights round to 3 decimals — enough for a smooth drag, short in the JSON. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** `count` equal weights (what "even widths" and a fresh columns block use). */
export function evenColumnWeights(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, () => 1);
}

/**
 * The weights after dragging the divider that sits between column `index` and
 * column `index + 1`, where `leftShare` is the fraction of THAT PAIR's total
 * width the left column should end up with.
 *
 * Only the two columns either side of the divider move: dragging one boundary
 * must not shuffle a column at the far end of the row, which is what a reader
 * expects from every other resizable thing they have used.
 */
export function resizeColumnWeights(
  weights: readonly number[],
  index: number,
  leftShare: number,
): number[] {
  const out = weights.map((w) =>
    typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 1,
  );
  if (index < 0 || index + 1 >= out.length) return out;
  if (!Number.isFinite(leftShare)) return out;
  const pair = out[index]! + out[index + 1]!;
  const share = clamp(leftShare, MIN_COLUMN_SHARE, 1 - MIN_COLUMN_SHARE);
  out[index] = round(pair * share);
  out[index + 1] = round(pair - pair * share);
  return out;
}

// ---------------------------------------------------------------------------
// Finding the columns node the caret (or a NodeSelection) is in
// ---------------------------------------------------------------------------

export interface ColumnsRef {
  /** Position immediately before the columns node. */
  readonly pos: number;
  readonly node: ProseMirrorNode;
}

/**
 * The columns node the selection is inside, or that the selection IS.
 *
 * Both cases are real: the slash menu leaves the caret in a column, while the
 * right-click menu NodeSelects the whole block before it opens (see
 * `contextMenuController`), so a command that only handled the caret case
 * would silently do nothing from the menu that most needs it.
 */
export function columnsAround(state: EditorState): ColumnsRef | null {
  const { selection } = state;
  const selected = (selection as { node?: ProseMirrorNode }).node;
  if (selected !== undefined && selected.type.name === 'columns') {
    return { pos: selection.from, node: selected };
  }
  const $from = selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'columns') {
      return { pos: $from.before(depth), node };
    }
  }
  return null;
}

/** Index of the column the caret sits in, or null. */
export function columnIndexAt(state: EditorState): number | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'col') return $from.index(depth - 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The nodes
// ---------------------------------------------------------------------------

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      /** Wrap the selection in a `count`-column layout (2–4). */
      setColumns: (count?: number) => ReturnType;
      /**
       * Change how many columns the current layout has. Grows with empty
       * columns, shrinks by merging the surplus into the last survivor.
       */
      setColumnCount: (count: number) => ReturnType;
      /** Give every column the same width again. */
      evenColumns: () => ReturnType;
      /** Space between the columns. */
      setColumnGap: (gap: ColumnGap | null) => ReturnType;
      /** Unwrap the layout, leaving the columns' blocks stacked in order. */
      unsetColumns: () => ReturnType;
    };
  }
}

/** Every block inside a columns node, column by column, in reading order. */
function flattenColumns(node: ProseMirrorNode): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = [];
  node.forEach((col) => {
    col.forEach((block) => blocks.push(block));
  });
  return blocks;
}

export const Columns = Node.create({
  name: 'columns',

  group: 'block',

  content: `col{${MIN_COLUMNS},${MAX_COLUMNS}}`,

  defining: true,

  isolating: true,

  draggable: true,

  addAttributes() {
    return {
      gap: {
        default: null as ColumnGap | null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-gap');
          return raw !== null && (COLUMN_GAPS as readonly string[]).includes(raw)
            ? (raw as ColumnGap)
            : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.gap === 'string' &&
          (COLUMN_GAPS as readonly string[]).includes(attributes.gap)
            ? { 'data-gap': attributes.gap }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'columns' }),
      0,
    ];
  },

  addCommands() {
    return {
      setColumns:
        (count = MIN_COLUMNS) =>
        ({ state, chain }) => {
          const wanted = clamp(Math.round(count), MIN_COLUMNS, MAX_COLUMNS);
          const existing = columnsAround(state);
          if (existing !== null) {
            return chain().setColumnCount(wanted).run();
          }
          const { $from, $to } = state.selection;
          const range = $from.blockRange($to);
          if (!range) return false;
          const slice = state.doc.slice(range.start, range.end);
          const carried =
            (slice.toJSON() as { content?: JSONContent[] } | null)?.content ??
            [];
          const first = carried.length > 0 ? carried : [{ type: 'paragraph' }];
          const rest = Array.from({ length: wanted - 1 }, () => ({
            type: 'col',
            content: [{ type: 'paragraph' }],
          }));
          return chain()
            .insertContentAt(
              { from: range.start, to: range.end },
              {
                type: 'columns',
                content: [{ type: 'col', content: first }, ...rest],
              },
            )
            // +2: past the columns node's own token and into the first col.
            .setTextSelection(range.start + 2)
            .run();
        },

      setColumnCount:
        (count) =>
        ({ state, tr, dispatch }) => {
          const ref = columnsAround(state);
          if (ref === null) return false;
          const wanted = clamp(Math.round(count), MIN_COLUMNS, MAX_COLUMNS);
          const current = ref.node.childCount;
          if (wanted === current) return false;
          if (!dispatch) return true;

          const colType = state.schema.nodes.col;
          const paragraph = state.schema.nodes.paragraph;
          if (colType === undefined || paragraph === undefined) return false;

          const kept: ProseMirrorNode[] = [];
          for (let i = 0; i < Math.min(wanted, current); i += 1) {
            // Widths reset on a count change: keeping two hand-set weights
            // and adding a third would silently make the new column the odd
            // one out, and the reader never asked for that.
            kept.push(colType.create(null, ref.node.child(i).content));
          }
          if (wanted < current) {
            // Merge the surplus columns' blocks into the last survivor rather
            // than dropping them — a layout choice must never eat prose.
            const spare: ProseMirrorNode[] = [];
            for (let i = wanted; i < current; i += 1) {
              ref.node.child(i).forEach((block) => spare.push(block));
            }
            if (spare.length > 0) {
              const last = kept[kept.length - 1]!;
              kept[kept.length - 1] = colType.create(
                null,
                last.content.append(Fragment.fromArray(spare)),
              );
            }
          } else {
            for (let i = current; i < wanted; i += 1) {
              const empty = colType.createAndFill();
              if (empty !== null) kept.push(empty);
            }
          }
          if (kept.length < MIN_COLUMNS) return false;

          const replacement = ref.node.type.create(ref.node.attrs, kept);
          tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, replacement);
          tr.setSelection(
            TextSelection.near(tr.doc.resolve(Math.min(ref.pos + 2, tr.doc.content.size))),
          );
          return true;
        },

      evenColumns:
        () =>
        ({ state, tr, dispatch }) => {
          const ref = columnsAround(state);
          if (ref === null) return false;
          if (!dispatch) return true;
          let pos = ref.pos + 1;
          ref.node.forEach((col) => {
            tr.setNodeMarkup(pos, undefined, { ...col.attrs, width: null });
            pos += col.nodeSize;
          });
          return true;
        },

      setColumnGap:
        (gap) =>
        ({ state, tr, dispatch }) => {
          const ref = columnsAround(state);
          if (ref === null) return false;
          if (!dispatch) return true;
          tr.setNodeMarkup(ref.pos, undefined, { ...ref.node.attrs, gap });
          return true;
        },

      unsetColumns:
        () =>
        ({ state, tr, dispatch }) => {
          const ref = columnsAround(state);
          if (ref === null) return false;
          const blocks = flattenColumns(ref.node);
          if (blocks.length === 0) return false;
          if (!dispatch) return true;
          tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, blocks);
          tr.setSelection(
            TextSelection.near(tr.doc.resolve(Math.min(ref.pos + 1, tr.doc.content.size))),
          );
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [columnResizePlugin()];
  },
});

export const Column = Node.create({
  name: 'col',

  // No group on purpose: a col may only live inside a columns node.
  content: 'block+',

  defining: true,

  isolating: true,

  addAttributes() {
    return {
      width: {
        default: null as number | null,
        parseHTML: (element: HTMLElement) => {
          const parsed = Number(element.getAttribute('data-width'));
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const value = attributes.width;
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return {};
          }
          return { 'data-width': String(value), style: `flex-grow: ${value}` };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="col"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'col' }), 0];
  },
});

// ---------------------------------------------------------------------------
// Drag-to-resize
// ---------------------------------------------------------------------------

const columnResizeKey = new PluginKey('nbColumnResize');

/** The column elements of a columns container, in order. */
function columnElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.type === 'col',
  );
}

/** Which divider the pointer is on, or null when it is on neither. */
function dividerIndexAt(columns: readonly HTMLElement[], clientX: number): number | null {
  for (let i = 0; i + 1 < columns.length; i += 1) {
    const left = columns[i]!.getBoundingClientRect().right;
    const right = columns[i + 1]!.getBoundingClientRect().left;
    if (clientX >= left - 2 && clientX <= right + 2) return i;
  }
  return null;
}

/** Doc position + node for the columns element under the pointer. */
function columnsAtElement(
  view: EditorView,
  element: HTMLElement,
): ColumnsRef | null {
  let inner: number;
  try {
    inner = view.posAtDOM(element, 0);
  } catch {
    return null;
  }
  if (inner < 0 || inner > view.state.doc.content.size) return null;
  const $inner = view.state.doc.resolve(inner);
  for (let depth = $inner.depth; depth > 0; depth -= 1) {
    const node = $inner.node(depth);
    if (node.type.name === 'columns') {
      return { pos: $inner.before(depth), node };
    }
  }
  return null;
}

/**
 * The drag ghost — one hairline on a body-level layer.
 *
 * On <body> rather than in the page for the same reason the drag handle's
 * layer is: the page clips its own overflow in the spread, and a divider
 * dragged to the edge of a leaf would be cut in half by it.
 */
function createGhost(): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'nb-col-resize-ghost';
  document.body.appendChild(ghost);
  return ghost;
}

function columnResizePlugin(): Plugin {
  return new Plugin({
    key: columnResizeKey,
    props: {
      handleDOMEvents: {
        mousedown: (view: EditorView, event: Event): boolean => {
          if (!(event instanceof MouseEvent) || event.button !== 0) return false;
          if (!view.editable) return false;
          const target = event.target;
          if (!(target instanceof HTMLElement)) return false;
          // The gap is the ONLY part of a columns block whose pointer target
          // is the container itself — the dividing rule is a pseudo-element
          // and the columns own everything else.
          if (target.dataset.type !== 'columns') return false;

          const columns = columnElements(target);
          const index = dividerIndexAt(columns, event.clientX);
          if (index === null) return false;
          const ref = columnsAtElement(view, target);
          if (ref === null || ref.node.childCount !== columns.length) return false;

          const trackRect = target.getBoundingClientRect();
          const pairLeft = columns[index]!.getBoundingClientRect().left;
          const pairRight = columns[index + 1]!.getBoundingClientRect().right;
          const span = pairRight - pairLeft;
          if (span <= 0) return false;

          const weights: number[] = [];
          ref.node.forEach((col) => {
            const value: unknown = col.attrs.width;
            weights.push(
              typeof value === 'number' && Number.isFinite(value) && value > 0
                ? value
                : 1,
            );
          });

          const ghost = createGhost();
          const placeGhost = (clientX: number): void => {
            ghost.style.left = `${clientX}px`;
            ghost.style.top = `${trackRect.top}px`;
            ghost.style.height = `${trackRect.height}px`;
          };
          let share = (event.clientX - pairLeft) / span;
          placeGhost(event.clientX);
          document.documentElement.setAttribute('data-nb-col-resizing', 'true');

          const onMove = (move: MouseEvent): void => {
            share = clamp(
              (move.clientX - pairLeft) / span,
              MIN_COLUMN_SHARE,
              1 - MIN_COLUMN_SHARE,
            );
            placeGhost(pairLeft + share * span);
          };

          const onUp = (): void => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
            document.documentElement.removeAttribute('data-nb-col-resizing');
            ghost.remove();
            const next = resizeColumnWeights(weights, index, share);
            const state = view.state;
            const node = state.doc.nodeAt(ref.pos);
            if (node === null || node.type.name !== 'columns') return;
            if (node.childCount !== next.length) return;
            const tr = state.tr;
            let pos = ref.pos + 1;
            node.forEach((col, _offset, childIndex) => {
              tr.setNodeMarkup(pos, undefined, {
                ...col.attrs,
                width: next[childIndex],
              });
              pos += col.nodeSize;
            });
            if (tr.docChanged) view.dispatch(tr);
          };

          document.addEventListener('mousemove', onMove, true);
          document.addEventListener('mouseup', onUp, true);
          event.preventDefault();
          return true;
        },
      },
    },
  });
}
