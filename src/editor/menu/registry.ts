/**
 * Right-click block context menu — pure item registry (no DOM, no Solid),
 * mirroring the slash registry so it unit-tests in Node.
 *
 * Groups (Notion-grade): Turn into ▸, Color ▸ (ink) , Highlight ▸ (washes),
 * Effects ▸ (quick-apply), Duplicate, Delete, Insert above/below, Copy block
 * as script.
 */
import type { Editor } from '@tiptap/core';
import {
  HIGHLIGHT_STYLES,
  HIGHLIGHT_STYLE_LABELS,
  highlightAttrs,
  type HighlightStyle,
} from '../highlightStyles';
import { HAND_SHORTLIST } from '../../features/settings/appearance';
import { COLUMN_GAPS, type ColumnGap } from '../nodes/columns';
import {
  applyEffectAt,
  blockToScript,
  blockTextRange,
  deleteBlock,
  duplicateBlock,
  insertParagraphNear,
  linkUrlAt,
  toggleEffectAt,
  topLevelBlockAt,
  withBlockSelection,
} from './blockOps';
import {
  insertMediaFilesInEditor,
  pickMediaFiles,
  readClipboardImageFile,
} from '../media/insert';
import {
  copyUsefulBlock,
  copyUsefulSelection,
  downloadUsefulBlock,
} from './blockPortability';

export interface ContextMenuContext {
  readonly editor: Editor;
  /** Position immediately before the right-clicked top-level block. */
  readonly pos: number;
  /** Toast/notify hook (clipboard feedback); optional. */
  readonly notify?: (message: string) => void;
  /** Exact cross-block reader selection retained through right click. */
  readonly selectionRange?: { readonly from: number; readonly to: number };
}

export interface ContextMenuItem {
  readonly kind: 'item';
  readonly id: string;
  readonly title: string;
  /** Kalam glyph shown in the leading box. */
  readonly glyph?: string;
  /** CSS color (token) — renders a round swatch instead of a glyph. */
  readonly swatch?: string;
  readonly danger?: boolean;
  /** The command intentionally consumes `selectionRange` when present. */
  readonly selectionAware?: boolean;
  run(context: ContextMenuContext): void;
}

export interface ContextMenuSubmenu {
  readonly kind: 'submenu';
  readonly id: string;
  readonly title: string;
  readonly glyph?: string;
  readonly items: readonly ContextMenuItem[];
}

export interface ContextMenuDivider {
  readonly kind: 'divider';
}

export type ContextMenuEntry =
  | ContextMenuItem
  | ContextMenuSubmenu
  | ContextMenuDivider;

// ---------------------------------------------------------------------------
// Turn into — all block types
// ---------------------------------------------------------------------------

function turnInto(
  id: string,
  title: string,
  glyph: string,
  command: (editor: Editor) => boolean,
): ContextMenuItem {
  return {
    kind: 'item',
    id: `turn-${id}`,
    title,
    glyph,
    run: ({ editor, pos }) => {
      withBlockSelection(editor, pos, command);
    },
  };
}

const TURN_INTO_ITEMS: readonly ContextMenuItem[] = [
  turnInto('text', 'Text', 'Aa', (e) =>
    e.chain().setNode('paragraph').run(),
  ),
  turnInto('heading-1', 'Heading 1', 'H1', (e) =>
    e.chain().setNode('heading', { level: 1 }).run(),
  ),
  turnInto('heading-2', 'Heading 2', 'H2', (e) =>
    e.chain().setNode('heading', { level: 2 }).run(),
  ),
  turnInto('heading-3', 'Heading 3', 'H3', (e) =>
    e.chain().setNode('heading', { level: 3 }).run(),
  ),
  turnInto('bullet-list', 'Bullet list', '•', (e) =>
    e.chain().toggleBulletList().run(),
  ),
  turnInto('ordered-list', 'Numbered list', '1.', (e) =>
    e.chain().toggleOrderedList().run(),
  ),
  turnInto('task-list', 'To-do list', '☐', (e) =>
    e.chain().toggleTaskList().run(),
  ),
  turnInto('toggle', 'Toggle', '▸', (e) => e.chain().setDetails().run()),
  turnInto('quote', 'Quote', '❝', (e) => e.chain().toggleBlockquote().run()),
  turnInto('callout', 'Callout', '✦', (e) => e.chain().setCallout().run()),
  turnInto('code-block', 'Code block', '{ }', (e) =>
    e.chain().toggleCodeBlock().run(),
  ),
  turnInto('sticky-note', 'Sticky note', '▤', (e) =>
    e.chain().wrapIn('sticky-note').run(),
  ),
  turnInto('washi-box', 'Washi box', '▦', (e) =>
    e.chain().wrapIn('washi-box').run(),
  ),
  turnInto('card', 'Card', '▢', (e) => e.chain().wrapIn('card').run()),
  turnInto('quote-card', 'Quote card', '❞', (e) =>
    e.chain().wrapIn('quote-card').run(),
  ),
  turnInto('banner', 'Banner', '⚑', (e) => e.chain().wrapIn('banner').run()),
  turnInto('spoiler', 'Spoiler', '…', (e) => e.chain().wrapIn('spoiler').run()),
];

// ---------------------------------------------------------------------------
// Color (ink) + Highlight (washes)
// ---------------------------------------------------------------------------

/** Ink colors (script vocab INK_COLORS) → CSS tokens stored in the mark. */
export const INK_COLOR_TOKENS = {
  sepia: 'var(--ink-sepia)',
  graphite: 'var(--ink-graphite)',
  'ink-blue': 'var(--ink-blue)',
} as const;

export type InkColor = keyof typeof INK_COLOR_TOKENS;

/** The 7 highlight washes with a mark[data-color] rule in editor.css. */
export const HIGHLIGHT_WASHES = [
  'amber',
  'terracotta',
  'moss',
  'lemon',
  'sky',
  'blush',
  'plum',
] as const;

export type HighlightWash = (typeof HIGHLIGHT_WASHES)[number];

function contextualRange(
  editor: Editor,
  pos: number,
  selectionRange?: { readonly from: number; readonly to: number },
): { from: number; to: number } | null {
  if (selectionRange !== undefined) return selectionRange;
  const block = topLevelBlockAt(editor, pos + 1) ?? topLevelBlockAt(editor, pos);
  return block ? blockTextRange(block) : null;
}

function applyInk(
  editor: Editor,
  pos: number,
  ink: InkColor | null,
  selectionRange?: { readonly from: number; readonly to: number },
): void {
  const range = contextualRange(editor, pos, selectionRange);
  if (range === null) return;
  const chain = editor.chain().setTextSelection(range);
  if (ink === null) chain.unsetColor();
  else chain.setColor(INK_COLOR_TOKENS[ink]);
  chain.focus().run();
}

/** Write the whole block in `hand`, or give it back to the page's own. */
function applyFace(
  editor: Editor,
  pos: number,
  hand: string | null,
  selectionRange?: { readonly from: number; readonly to: number },
): void {
  const range = contextualRange(editor, pos, selectionRange);
  if (range === null) return;
  const chain = editor.chain().setTextSelection(range);
  if (hand === null) chain.unsetFace();
  else chain.setFace(hand);
  chain.focus().run();
}

function applyHighlight(
  editor: Editor,
  pos: number,
  wash: HighlightWash | null,
  style: HighlightStyle = 'marker',
  selectionRange?: { readonly from: number; readonly to: number },
): void {
  const range = contextualRange(editor, pos, selectionRange);
  if (range === null) return;
  const chain = editor.chain().setTextSelection(range);
  if (wash === null) chain.unsetHighlight();
  else chain.setHighlight(highlightAttrs(wash, style));
  chain.focus().run();
}

/** The wash of the current highlight mark near `pos`, or amber. */
function currentWash(editor: Editor): HighlightWash {
  const color: unknown = editor.getAttributes('highlight').color;
  return typeof color === 'string' &&
    (HIGHLIGHT_WASHES as readonly string[]).includes(color)
    ? (color as HighlightWash)
    : 'amber';
}

const INK_LABELS: Record<InkColor, string> = {
  sepia: 'Sepia ink',
  graphite: 'Graphite ink',
  'ink-blue': 'Fountain blue',
};

const COLOR_ITEMS: readonly ContextMenuItem[] = [
  ...(Object.keys(INK_COLOR_TOKENS) as InkColor[]).map(
    (ink): ContextMenuItem => ({
      kind: 'item',
      id: `ink-${ink}`,
      title: INK_LABELS[ink],
      swatch: INK_COLOR_TOKENS[ink],
      selectionAware: true,
      run: ({ editor, pos, selectionRange }) => applyInk(editor, pos, ink, selectionRange),
    }),
  ),
  {
    kind: 'item',
    id: 'ink-default',
    title: 'Default ink',
    glyph: '↺',
    selectionAware: true,
    run: ({ editor, pos, selectionRange }) => applyInk(editor, pos, null, selectionRange),
  },
];

/*
 * Highlighter styles (roadmap #15). The row names and glyphs come from
 * `highlightStyles.ts` — the same module the list of styles comes from — so
 * this menu and the selection toolbar cannot call the same style two things.
 */
const HIGHLIGHT_ITEMS: readonly ContextMenuItem[] = [
  ...HIGHLIGHT_WASHES.map(
    (wash): ContextMenuItem => ({
      kind: 'item',
      id: `highlight-${wash}`,
      title: `${wash.charAt(0).toUpperCase()}${wash.slice(1)} wash`,
      swatch: `var(--wash-${wash})`,
      selectionAware: true,
      run: ({ editor, pos, selectionRange }) => applyHighlight(editor, pos, wash, 'marker', selectionRange),
    }),
  ),
  // Style rows re-apply the block's current wash (amber when none) in the
  // chosen hand-drawn style.
  ...HIGHLIGHT_STYLES.map(
    (style): ContextMenuItem => ({
      kind: 'item',
      id: `highlight-style-${style}`,
      title: HIGHLIGHT_STYLE_LABELS[style].title,
      glyph: HIGHLIGHT_STYLE_LABELS[style].glyph,
      selectionAware: true,
      run: ({ editor, pos, selectionRange }) =>
        applyHighlight(editor, pos, currentWash(editor), style, selectionRange),
    }),
  ),
  {
    kind: 'item',
    id: 'highlight-none',
    title: 'No highlight',
    glyph: '↺',
    selectionAware: true,
    run: ({ editor, pos, selectionRange }) => applyHighlight(editor, pos, null, 'marker', selectionRange),
  },
];

// ---------------------------------------------------------------------------
// Lettering — the hand a whole block is written in (marks/face.ts)
//
// The same shape as Color above, and for the same reason: the selection
// toolbar sets a face on a RUN, and a reader who wants a whole paragraph in
// another hand should not have to select it first. Both read the hand table in
// `features/settings/appearance.ts`, so neither can offer a face the other has
// never heard of — the mistake the ink comment one screen up already warns
// about.
//
// Only the signature hands, and only the ones the app itself BUNDLES. This
// registry is pure and unit-tested in Node (`tests/editor.test.ts`), where
// there is no `document.fonts` to ask whether Windows has Gabriola; the
// toolbar's tray is the surface that can ask, and it offers all twenty-seven.
// ---------------------------------------------------------------------------

const LETTERING_ITEMS: readonly ContextMenuItem[] = [
  ...HAND_SHORTLIST.filter((spec) => spec.probe === undefined).map(
    (spec): ContextMenuItem => ({
      kind: 'item',
      id: `face-${spec.id}`,
      title: spec.label,
      glyph: 'Aa',
      selectionAware: true,
      run: ({ editor, pos, selectionRange }) => applyFace(editor, pos, spec.id, selectionRange),
    }),
  ),
  {
    kind: 'item',
    id: 'face-default',
    title: 'The page’s own hand',
    glyph: '↺',
    selectionAware: true,
    run: ({ editor, pos, selectionRange }) => applyFace(editor, pos, null, selectionRange),
  },
];

// ---------------------------------------------------------------------------
// Columns — count, widths, gap, unwrap
//
// One submenu that reads sensibly on ANY block, because the registry is built
// without knowing what was right-clicked (buildBlockContextMenu takes no
// context, and the controller that would supply one is not this file's to
// change). On a columns block "Three columns" recounts it; on a paragraph the
// same row wraps that paragraph into three. The rows that only make sense on
// an existing layout (widths, gap, unwrap) do nothing anywhere else, which is
// what a disabled row would have done anyway.
// ---------------------------------------------------------------------------

const COLUMN_GAP_LABELS: Record<ColumnGap, string> = {
  sm: 'Narrow gap',
  md: 'Medium gap',
  lg: 'Wide gap',
};

/** True when the top-level block at `pos` is a columns layout. */
function columnsBlockAt(editor: Editor, pos: number): boolean {
  return editor.state.doc.nodeAt(pos)?.type.name === 'columns';
}

/**
 * Run `command` with the columns block at `pos` node-selected.
 *
 * The columns commands find their node from the selection, and the menu's own
 * `withBlockSelection` drops a CARET inside the block — which for a nested
 * layout would find the inner columns rather than the one that was clicked.
 */
function withColumnsAt(
  editor: Editor,
  pos: number,
  command: (editor: Editor) => boolean,
): boolean {
  if (!columnsBlockAt(editor, pos)) return false;
  if (!editor.chain().focus().setNodeSelection(pos).run()) return false;
  return command(editor);
}

function columnCountItem(count: number, title: string): ContextMenuItem {
  return {
    kind: 'item',
    id: `columns-${count}`,
    title,
    glyph: '▥',
    run: ({ editor, pos }) => {
      if (columnsBlockAt(editor, pos)) {
        withColumnsAt(editor, pos, (e) => e.chain().setColumnCount(count).run());
      } else {
        withBlockSelection(editor, pos, (e) =>
          e.chain().setColumns(count).run(),
        );
      }
    },
  };
}

const COLUMN_ITEMS: readonly ContextMenuItem[] = [
  columnCountItem(2, 'Two columns'),
  columnCountItem(3, 'Three columns'),
  columnCountItem(4, 'Four columns'),
  {
    kind: 'item',
    id: 'columns-even',
    title: 'Even widths',
    glyph: '≡',
    run: ({ editor, pos }) => {
      withColumnsAt(editor, pos, (e) => e.chain().evenColumns().run());
    },
  },
  ...COLUMN_GAPS.map(
    (gap): ContextMenuItem => ({
      kind: 'item',
      id: `columns-gap-${gap}`,
      title: COLUMN_GAP_LABELS[gap],
      glyph: '⇔',
      run: ({ editor, pos }) => {
        withColumnsAt(editor, pos, (e) => e.chain().setColumnGap(gap).run());
      },
    }),
  ),
  {
    kind: 'item',
    id: 'columns-unwrap',
    title: 'Back to one column',
    glyph: '↺',
    run: ({ editor, pos }) => {
      withColumnsAt(editor, pos, (e) => e.chain().unsetColumns().run());
    },
  },
];

// ---------------------------------------------------------------------------
// Effects — quick-apply toggles (BlockEffects attrs)
// ---------------------------------------------------------------------------

function effectToggle(
  id: string,
  title: string,
  glyph: string,
  key: string,
  value: string | number,
): ContextMenuItem {
  return {
    kind: 'item',
    id: `effect-${id}`,
    title,
    glyph,
    run: ({ editor, pos }) => {
      toggleEffectAt(editor, pos, key, value);
    },
  };
}

const EFFECT_ITEMS: readonly ContextMenuItem[] = [
  effectToggle('rotate', 'Tilt a little', '∠', 'rotate', -2),
  effectToggle('tape', 'Tape it down', '▬', 'tape', 'top'),
  effectToggle('washi', 'Washi strip', '▤', 'washi', 'top'),
  effectToggle('frame', 'Scallop frame', '◎', 'frame', 'scallop'),
  effectToggle('paper', 'Torn paper', '▨', 'paper', 'torn'),
  effectToggle('underline', 'Squiggle underline', '﹏', 'underline', 'squiggle'),
  {
    kind: 'item',
    id: 'effect-clear',
    title: 'Clear effects',
    glyph: '↺',
    run: ({ editor, pos }) => {
      for (const key of [
        'rotate',
        'tape',
        'washi',
        'shadow',
        'frame',
        'paper',
        'underline',
      ]) {
        applyEffectAt(editor, pos, key, null);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Insert — media paths share one persistence/insertion implementation
// ---------------------------------------------------------------------------

const INSERT_ITEMS: readonly ContextMenuItem[] = [
  {
    kind: 'item',
    id: 'insert-picture',
    title: 'Picture from file…',
    glyph: '▣',
    run: ({ editor, pos, notify }) => {
      void pickMediaFiles('image/*').then(async (files) => {
        if (files.length === 0) return;
        const block = editor.state.doc.nodeAt(pos);
        const count = await insertMediaFilesInEditor(
          editor,
          files,
          block === null ? editor.state.doc.content.size : pos + block.nodeSize,
        );
        notify?.(count > 0 ? (count === 1 ? 'picture added' : `${count} pictures added`) : 'picture could not be added');
      });
    },
  },
  {
    kind: 'item',
    id: 'insert-video',
    title: 'Video from file…',
    glyph: '▶',
    run: ({ editor, pos, notify }) => {
      void pickMediaFiles('video/*').then(async (files) => {
        if (files.length === 0) return;
        const block = editor.state.doc.nodeAt(pos);
        const count = await insertMediaFilesInEditor(
          editor,
          files,
          block === null ? editor.state.doc.content.size : pos + block.nodeSize,
        );
        notify?.(count > 0 ? (count === 1 ? 'video added' : `${count} videos added`) : 'video could not be added');
      });
    },
  },
  {
    kind: 'item',
    id: 'paste-image',
    title: 'Paste image',
    glyph: '▣',
    run: ({ editor, pos, notify }) => {
      void readClipboardImageFile().then(async (file) => {
        if (file === null) {
          notify?.('no image on the clipboard');
          return;
        }
        const block = editor.state.doc.nodeAt(pos);
        const count = await insertMediaFilesInEditor(
          editor,
          [file],
          block === null ? editor.state.doc.content.size : pos + block.nodeSize,
        );
        notify?.(count > 0 ? 'image pasted' : 'image could not be added');
      });
    },
  },
];

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

export interface PageContextMenuActions {
  readonly onMoveBlockToPrevious?: (context: ContextMenuContext) => void;
  readonly onInsertPageBefore?: () => void;
  readonly onInsertPageAfter?: () => void;
  readonly onDeletePage?: () => void;
}

export function buildBlockContextMenu(
  pageActions?: PageContextMenuActions,
): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [
    { kind: 'submenu', id: 'insert', title: 'Insert', glyph: '＋', items: INSERT_ITEMS },
    { kind: 'submenu', id: 'turn-into', title: 'Turn into', glyph: '⇄', items: TURN_INTO_ITEMS },
    { kind: 'submenu', id: 'color', title: 'Color', glyph: 'A', items: COLOR_ITEMS },
    { kind: 'submenu', id: 'lettering', title: 'Handwriting', glyph: 'Aa', items: LETTERING_ITEMS },
    { kind: 'submenu', id: 'highlight', title: 'Highlight', glyph: '▰', items: HIGHLIGHT_ITEMS },
    { kind: 'submenu', id: 'columns', title: 'Columns', glyph: '▥', items: COLUMN_ITEMS },
    { kind: 'submenu', id: 'effects', title: 'Effects', glyph: '✎', items: EFFECT_ITEMS },
    { kind: 'divider' },
    {
      kind: 'item',
      id: 'insert-above',
      title: 'Insert line above',
      glyph: '↥',
      run: ({ editor, pos }) => {
        insertParagraphNear(editor, pos, 'above');
      },
    },
    {
      kind: 'item',
      id: 'insert-below',
      title: 'Insert line below',
      glyph: '↧',
      run: ({ editor, pos }) => {
        insertParagraphNear(editor, pos, 'below');
      },
    },
    {
      kind: 'item',
      id: 'duplicate',
      title: 'Duplicate selection / block',
      glyph: '⧉',
      selectionAware: true,
      run: ({ editor, pos, selectionRange }) => {
        if (selectionRange === undefined) {
          duplicateBlock(editor, pos);
          return;
        }
        const slice = editor.state.doc.slice(selectionRange.from, selectionRange.to);
        const transaction = editor.state.tr.replaceRange(
          selectionRange.to,
          selectionRange.to,
          slice,
        );
        editor.view.dispatch(transaction.scrollIntoView());
      },
    },
    {
      kind: 'item',
      id: 'copy-useful-content',
      title: 'Copy content',
      glyph: '⧉',
      selectionAware: true,
      run: ({ editor, pos, notify, selectionRange }) => {
        void (selectionRange === undefined
          ? copyUsefulBlock(editor, pos)
          : copyUsefulSelection(editor, selectionRange))
          .then((message) => notify?.(message))
          .catch(() => notify?.('could not copy this block'));
      },
    },
    {
      kind: 'item',
      id: 'download-useful-content',
      title: 'Download / save…',
      glyph: '⇩',
      run: ({ editor, pos, notify }) => {
        void downloadUsefulBlock(editor, pos)
          .then((message) => notify?.(message))
          .catch(() => notify?.('could not save this block'));
      },
    },
    {
      kind: 'item',
      id: 'copy-link',
      title: 'Copy link',
      glyph: '↗',
      run: ({ editor, pos, notify }) => {
        const url = linkUrlAt(editor, pos);
        if (url === null) {
          notify?.('no link on this block');
          return;
        }
        void navigator.clipboard
          .writeText(url)
          .then(() => notify?.('link copied'))
          .catch(() => notify?.('could not reach the clipboard'));
      },
    },
    {
      kind: 'item',
      id: 'copy-script',
      title: 'Copy block as script',
      glyph: '𝒮',
      run: ({ editor, pos, notify }) => {
        const script = blockToScript(editor, pos);
        if (script === null) return;
        void navigator.clipboard
          .writeText(script)
          .then(() => notify?.('block copied as script'))
          .catch(() => notify?.('could not reach the clipboard'));
      },
    },
    { kind: 'divider' },
    {
      kind: 'item',
      id: 'delete',
      title: 'Delete selection / block',
      glyph: '✕',
      danger: true,
      selectionAware: true,
      run: ({ editor, pos, selectionRange }) => {
        if (selectionRange === undefined) deleteBlock(editor, pos);
        else editor.chain().focus().setTextSelection(selectionRange).deleteSelection().run();
      },
    },
  ];

  if (pageActions !== undefined) {
    entries.push({ kind: 'divider' });
    if (pageActions.onMoveBlockToPrevious !== undefined) {
      entries.push({
        kind: 'item',
        id: 'move-block-to-previous-page',
        title: 'Move to previous page',
        glyph: '↥',
        selectionAware: true,
        run: (context) => pageActions.onMoveBlockToPrevious?.(context),
      });
    }
    if (pageActions.onInsertPageBefore !== undefined) {
      entries.push({
        kind: 'item',
        id: 'insert-page-before',
        title: 'Add page before',
        glyph: '↤',
        run: () => pageActions.onInsertPageBefore?.(),
      });
    }
    if (pageActions.onInsertPageAfter !== undefined) {
      entries.push({
        kind: 'item',
        id: 'insert-page-after',
        title: 'Add page after',
        glyph: '↦',
        run: () => pageActions.onInsertPageAfter?.(),
      });
    }
    if (pageActions.onDeletePage !== undefined) {
      entries.push({
        kind: 'item',
        id: 'delete-page',
        title: 'Delete this page',
        glyph: '⌫',
        danger: true,
        run: () => pageActions.onDeletePage?.(),
      });
    }
  }

  return entries;
}
