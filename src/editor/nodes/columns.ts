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
 * 4. NESTING falls out of the schema (`col` holds `block+`, `columns` IS a
 *    block) but the INSERT command has to know which one the reader meant.
 *    `/columns` with the caret inside a column nests a new layout there;
 *    `setColumns` reaching a columns node it has SELECTED (the right-click
 *    menu NodeSelects the block) recounts that node instead. Past
 *    `MAX_COLUMN_DEPTH` nesting recounts too, rather than doing nothing:
 *    a command that silently no-ops reads as a broken menu item.
 * 5. GETTING OUT. `col` is `isolating`, which is what stops a backspace at the
 *    top of column two from eating column one. The arrow keys cross the
 *    divider by themselves — measured, not assumed: this file briefly carried
 *    a ←/→ keymap to "fix" that, and the fix never once ran because the
 *    browser had already moved the caret. What genuinely does not work is
 *    BACKSPACE in a layout with nothing in it: there is nothing to delete, so
 *    the key is inert and a reader who made a columns block by accident cannot
 *    unmake it from the keyboard. That one case is handled below.
 *
 * The weight maths (`resizeColumnWeights`, `evenColumnWeights`) and the count
 * change (`recountColumns`) are pure and DOM-free so they unit-test in Node.
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
 * How many columns blocks may sit inside one another.
 *
 * The schema places no limit (a `col` takes `block+`, and a `columns` IS a
 * block), and a page leaf is about 460px of writable width. Two levels is
 * already four-into-four in the worst case — sixteen slivers under 30px, which
 * is a column that can hold no word. Three would be a page of confetti, so the
 * insert command stops nesting here and recounts instead.
 */
export const MAX_COLUMN_DEPTH = 2;

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

/** How many columns blocks the selection sits inside (0 when it is in none). */
export function columnsDepthAt(state: EditorState): number {
  const $from = state.selection.$from;
  let depth = 0;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === 'columns') depth += 1;
  }
  return depth;
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

/**
 * `columns` with exactly `wanted` columns — the whole count change, pure.
 *
 * Content-preserving in both directions, which is the property the menu leans
 * on to offer "2 / 3 / 4 columns" as plain choices rather than a destructive
 * "remove column": growing appends empty columns, shrinking MERGES the surplus
 * columns' blocks onto the end of the last survivor. Nothing a reader typed
 * can be lost to a layout click.
 *
 * Widths reset on every count change. Keeping two hand-set weights and adding
 * a third would silently make the new column the odd one out, and the reader
 * asked for a column, not for a proportion.
 *
 * @returns the replacement node, or null when the count is already right or
 *          the request falls outside `col{2,4}`.
 */
export function recountColumns(
  node: ProseMirrorNode,
  wanted: number,
): ProseMirrorNode | null {
  if (!Number.isFinite(wanted)) return null;
  const target = clamp(Math.round(wanted), MIN_COLUMNS, MAX_COLUMNS);
  const current = node.childCount;
  if (target === current) return null;
  const colType = node.type.schema.nodes.col;
  if (colType === undefined) return null;

  const kept: ProseMirrorNode[] = [];
  for (let i = 0; i < Math.min(target, current); i += 1) {
    kept.push(colType.create(null, node.child(i).content));
  }
  if (target < current) {
    const spare: ProseMirrorNode[] = [];
    for (let i = target; i < current; i += 1) {
      node.child(i).forEach((block) => spare.push(block));
    }
    if (spare.length > 0 && kept.length > 0) {
      const last = kept[kept.length - 1]!;
      kept[kept.length - 1] = colType.create(
        null,
        last.content.append(Fragment.fromArray(spare)),
      );
    }
  } else {
    for (let i = current; i < target; i += 1) {
      const empty = colType.createAndFill();
      if (empty !== null) kept.push(empty);
    }
  }
  if (kept.length !== target) return null;
  return node.type.create(node.attrs, kept);
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
      mergeAttributes(HTMLAttributes, {
        'data-type': 'columns',
        'data-nb-block-flow': 'feature',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setColumns:
        (count = MIN_COLUMNS) =>
        ({ state, chain }) => {
          const wanted = clamp(Math.round(count), MIN_COLUMNS, MAX_COLUMNS);
          const selected = (state.selection as { node?: ProseMirrorNode }).node;
          // The right-click menu NodeSelects the block before it opens, so a
          // SELECTED columns node means "make this one N wide". A caret inside
          // a column means the reader is writing there and wants a nested
          // layout — until the nesting cap, past which recounting is the only
          // sane thing left to do.
          const recount =
            (selected !== undefined && selected.type.name === 'columns') ||
            columnsDepthAt(state) >= MAX_COLUMN_DEPTH;
          if (recount && columnsAround(state) !== null) {
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
          const replacement = recountColumns(ref.node, count);
          if (replacement === null) return false;
          if (!dispatch) return true;
          tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, replacement);
          tr.setSelection(
            TextSelection.near(
              tr.doc.resolve(Math.min(ref.pos + 2, tr.doc.content.size)),
            ),
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

  addKeyboardShortcuts() {
    return {
      // Escaping an empty layout: with nothing inside it to delete, a
      // backspace at the very start of column one is otherwise inert, and a
      // reader who made a columns block by accident is stuck with it.
      Backspace: ({ editor }) => dropEmptyColumns(editor.state, editor.view),
    };
  },

  addProseMirrorPlugins() {
    return [columnResizePlugin()];
  },
});

// ---------------------------------------------------------------------------
// Getting out of an empty layout (the keymap above)
// ---------------------------------------------------------------------------

/** The `col` the selection is in, with its depth, or null. */
function colAround(
  state: EditorState,
): { depth: number; node: ProseMirrorNode } | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'col') return { depth, node };
  }
  return null;
}

/**
 * True when the caret sits at the very first writable position of the column
 * at `colDepth`.
 *
 * NOT `pos === $from.start(colDepth)`: that is the position between the column
 * and its first block, and a text caret is never there — it is one further in,
 * inside the paragraph. Getting this wrong is silent (the shortcut simply
 * never fires) which is exactly how the arrow-key version of it survived long
 * enough to be measured and deleted.
 */
export function atColumnStart(state: EditorState, colDepth: number): boolean {
  const $from = state.selection.$from;
  if ($from.parentOffset !== 0) return false;
  for (let depth = $from.depth; depth > colDepth; depth -= 1) {
    if ($from.index(depth - 1) !== 0) return false;
  }
  return true;
}

/** True when nothing in `node` would be lost by deleting it. */
export function isEmptyLayout(node: ProseMirrorNode): boolean {
  if (node.textContent.trim().length > 0) return false;
  // An image, a diagram or a formula carries no text of its own.
  let heavy = false;
  node.descendants((child) => {
    if (child.isLeaf && child.type.name !== 'text') heavy = true;
    return !heavy;
  });
  return !heavy;
}

/**
 * Backspace at the start of the first column of an EMPTY layout removes the
 * layout. Empty is the whole test: a columns block with a word anywhere in it
 * is left alone, so this can never swallow prose.
 */
function dropEmptyColumns(
  state: EditorState,
  view: EditorView | undefined,
): boolean {
  const selection = state.selection;
  if (!selection.empty) return false;
  const found = colAround(state);
  if (found === null) return false;
  const $from = selection.$from;
  if (!atColumnStart(state, found.depth)) return false;
  const columnsDepth = found.depth - 1;
  if ($from.index(columnsDepth) !== 0) return false;
  const parent = $from.node(columnsDepth);
  if (parent.type.name !== 'columns') return false;
  if (!isEmptyLayout(parent)) return false;

  if (view !== undefined) {
    const pos = $from.before(columnsDepth);
    const paragraph = state.schema.nodes.paragraph;
    const tr = state.tr;
    if (paragraph === undefined) {
      tr.delete(pos, pos + parent.nodeSize);
    } else {
      tr.replaceWith(pos, pos + parent.nodeSize, paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
    }
    view.dispatch(tr.scrollIntoView());
  }
  return true;
}

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

/** Root attribute set while the pointer is inside a column gap. */
const DIVIDER_HOVER_ATTR = 'data-nb-col-divider';

/**
 * Say "the pointer is on a divider" — on the ROOT element, not on the columns
 * block.
 *
 * Two constraints meet here and only this satisfies both. The cursor cannot be
 * a plain `[data-type='columns'] { cursor: col-resize }` rule, because the
 * custom writing cursors (editor.css, settings.cursorStyle) are set on
 * `.nb-prose` and inherit down — a rule on the container would hand the resize
 * cursor to every word in the columns too. And a class on the columns element
 * does not survive: ProseMirror owns that DOM, and it was measurably gone
 * again by the next frame while the pointer had not moved.
 *
 * So the state goes on <html>, and editor.css intersects it with `:hover` to
 * get back to the one block the pointer is actually over.
 */
function markDividerHover(on: boolean): void {
  const root = document.documentElement;
  if (on) root.setAttribute(DIVIDER_HOVER_ATTR, 'true');
  else root.removeAttribute(DIVIDER_HOVER_ATTR);
}

function columnResizePlugin(): Plugin {
  return new Plugin({
    key: columnResizeKey,
    // A REAL listener on the editor's own element, not a `handleDOMEvents`
    // entry: ProseMirror only wires the DOM events it knows about plus the
    // ones present when it last ensured its listeners, and mousemove is not
    // in that set — the hover cursor silently never appeared.
    view: (view: EditorView) => {
      const onMove = (event: MouseEvent): void => {
        if (!view.editable) return;
        const target = event.target;
        if (
          !(target instanceof HTMLElement) ||
          target.dataset.type !== 'columns'
        ) {
          markDividerHover(false);
          return;
        }
        markDividerHover(
          dividerIndexAt(columnElements(target), event.clientX) !== null,
        );
      };
      const onLeave = (): void => markDividerHover(false);
      view.dom.addEventListener('mousemove', onMove);
      view.dom.addEventListener('mouseleave', onLeave);
      return {
        destroy: () => {
          view.dom.removeEventListener('mousemove', onMove);
          view.dom.removeEventListener('mouseleave', onLeave);
          markDividerHover(false);
        },
      };
    },
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
