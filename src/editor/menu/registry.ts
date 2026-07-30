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
  highlightAttrs,
  type HighlightStyle,
} from '../highlightStyles';
import {
  applyEffectAt,
  blockToScript,
  blockTextRange,
  deleteBlock,
  duplicateBlock,
  insertParagraphNear,
  toggleEffectAt,
  topLevelBlockAt,
  withBlockSelection,
} from './blockOps';

export interface ContextMenuContext {
  readonly editor: Editor;
  /** Position immediately before the right-clicked top-level block. */
  readonly pos: number;
  /** Toast/notify hook (clipboard feedback); optional. */
  readonly notify?: (message: string) => void;
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

function applyInk(editor: Editor, pos: number, ink: InkColor | null): void {
  const block = topLevelBlockAt(editor, pos + 1) ?? topLevelBlockAt(editor, pos);
  if (!block) return;
  const range = blockTextRange(block);
  const chain = editor.chain().setTextSelection(range);
  if (ink === null) chain.unsetColor();
  else chain.setColor(INK_COLOR_TOKENS[ink]);
  chain.focus().run();
}

function applyHighlight(
  editor: Editor,
  pos: number,
  wash: HighlightWash | null,
  style: HighlightStyle = 'marker',
): void {
  const block = topLevelBlockAt(editor, pos + 1) ?? topLevelBlockAt(editor, pos);
  if (!block) return;
  const range = blockTextRange(block);
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
      run: ({ editor, pos }) => applyInk(editor, pos, ink),
    }),
  ),
  {
    kind: 'item',
    id: 'ink-default',
    title: 'Default ink',
    glyph: '↺',
    run: ({ editor, pos }) => applyInk(editor, pos, null),
  },
];

/** Highlighter styles (roadmap #15) — labels for the style rows. */
const HIGHLIGHT_STYLE_LABELS: Record<HighlightStyle, { title: string; glyph: string }> = {
  marker: { title: 'Marker sweep', glyph: '▰' },
  squiggle: { title: 'Squiggle underline', glyph: '﹏' },
  circle: { title: 'Circle scribble', glyph: '◯' },
};

const HIGHLIGHT_ITEMS: readonly ContextMenuItem[] = [
  ...HIGHLIGHT_WASHES.map(
    (wash): ContextMenuItem => ({
      kind: 'item',
      id: `highlight-${wash}`,
      title: `${wash.charAt(0).toUpperCase()}${wash.slice(1)} wash`,
      swatch: `var(--wash-${wash})`,
      run: ({ editor, pos }) => applyHighlight(editor, pos, wash),
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
      run: ({ editor, pos }) =>
        applyHighlight(editor, pos, currentWash(editor), style),
    }),
  ),
  {
    kind: 'item',
    id: 'highlight-none',
    title: 'No highlight',
    glyph: '↺',
    run: ({ editor, pos }) => applyHighlight(editor, pos, null),
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
// The menu
// ---------------------------------------------------------------------------

export function buildBlockContextMenu(): ContextMenuEntry[] {
  return [
    { kind: 'submenu', id: 'turn-into', title: 'Turn into', glyph: '⇄', items: TURN_INTO_ITEMS },
    { kind: 'submenu', id: 'color', title: 'Color', glyph: 'A', items: COLOR_ITEMS },
    { kind: 'submenu', id: 'highlight', title: 'Highlight', glyph: '▰', items: HIGHLIGHT_ITEMS },
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
      title: 'Duplicate',
      glyph: '⧉',
      run: ({ editor, pos }) => {
        duplicateBlock(editor, pos);
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
      title: 'Delete block',
      glyph: '✕',
      danger: true,
      run: ({ editor, pos }) => {
        deleteBlock(editor, pos);
      },
    },
  ];
}
