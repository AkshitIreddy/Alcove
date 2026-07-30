/**
 * Slash-menu command registry + fuzzy filter. Pure logic (no DOM, no Solid)
 * so it is unit-testable in a Node environment.
 */
import type { Editor, Range } from '@tiptap/core';
import { SLASH_DIAGRAM_COMMANDS } from '../../diagrams/slashCommands';
import { STICKER_IDS, type StickerId } from '../nodes/stickers';

export interface SlashCommandContext {
  readonly editor: Editor;
  readonly range: Range;
}

/** Icon shown in the menu: a Kalam glyph or raw SVG markup. */
export type SlashIcon =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'sticker'; readonly stickerId: StickerId };

export type SlashSection = 'blocks' | 'stickers' | 'turn-into';

export interface SlashCommand {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon: SlashIcon;
  readonly keywords: readonly string[];
  readonly section: SlashSection;
  run(context: SlashCommandContext): void;
}

export const SLASH_SECTION_LABELS: Record<SlashSection, string> = {
  blocks: 'Blocks',
  stickers: 'Stickers',
  'turn-into': 'Turn into',
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function glyph(text: string): SlashIcon {
  return { kind: 'text', text };
}

const blockCommands: SlashCommand[] = [
  {
    id: 'paragraph',
    title: 'Text',
    subtitle: 'Plain handwritten paragraph',
    icon: glyph('Aa'),
    keywords: ['text', 'paragraph', 'plain', 'body'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('paragraph').run(),
  },
  {
    id: 'heading-1',
    title: 'Heading 1',
    subtitle: 'Big chapter title',
    icon: glyph('H1'),
    keywords: ['h1', 'heading', 'title', 'big'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 1 })
        .run(),
  },
  {
    id: 'heading-2',
    title: 'Heading 2',
    subtitle: 'Section heading',
    icon: glyph('H2'),
    keywords: ['h2', 'heading', 'section', 'subtitle'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 2 })
        .run(),
  },
  {
    id: 'heading-3',
    title: 'Heading 3',
    subtitle: 'Small heading',
    icon: glyph('H3'),
    keywords: ['h3', 'heading', 'small', 'subheading'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 3 })
        .run(),
  },
  {
    id: 'bullet-list',
    title: 'Bullet list',
    subtitle: 'Simple dotted list',
    icon: glyph('•'),
    keywords: ['bullet', 'list', 'unordered', 'ul', 'dots'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ordered-list',
    title: 'Numbered list',
    subtitle: '1, 2, 3…',
    icon: glyph('1.'),
    keywords: ['numbered', 'ordered', 'list', 'ol', 'numbers'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'task-list',
    title: 'To-do list',
    subtitle: 'Checkboxes to tick off',
    icon: glyph('☐'),
    keywords: ['todo', 'task', 'checkbox', 'check', 'done', 'list'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'toggle',
    title: 'Toggle',
    subtitle: 'Collapsible details block',
    icon: glyph('▸'),
    keywords: ['toggle', 'details', 'collapse', 'fold', 'accordion'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setDetails().run(),
  },
  {
    id: 'blockquote',
    title: 'Quote',
    subtitle: 'Washi-taped quotation',
    icon: glyph('❝'),
    keywords: ['quote', 'blockquote', 'citation', 'washi'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'callout',
    title: 'Callout',
    subtitle: 'Watercolor wash with an icon',
    icon: { kind: 'sticker', stickerId: 'leaf' },
    keywords: ['callout', 'aside', 'note', 'info', 'wash', 'highlight box'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCallout().run(),
  },
  {
    id: 'code-block',
    title: 'Code block',
    subtitle: 'Monospace on aged paper',
    icon: glyph('{ }'),
    keywords: ['code', 'codeblock', 'snippet', 'monospace', 'pre'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'table',
    title: 'Table',
    subtitle: '3 × 3 grid with header row',
    icon: glyph('⊞'),
    keywords: ['table', 'grid', 'cells', 'rows', 'columns'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    subtitle: 'A hand-ruled line',
    icon: glyph('—'),
    keywords: ['divider', 'rule', 'hr', 'horizontal', 'separator', 'line'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

const STICKER_TILT: Record<StickerId, number> = {
  star: -6,
  bee: 5,
  leaf: -4,
  heart: 4,
  sparkle: -3,
  cat: 3,
  sun: -5,
  flower: 6,
};

const stickerCommands: SlashCommand[] = STICKER_IDS.map((stickerId) => ({
  id: `sticker-${stickerId}`,
  title: `${stickerId.charAt(0).toUpperCase()}${stickerId.slice(1)} sticker`,
  icon: { kind: 'sticker', stickerId },
  keywords: ['sticker', stickerId, 'doodle', 'decoration'],
  section: 'stickers',
  run: ({ editor, range }) =>
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertSticker({ stickerId, rotate: STICKER_TILT[stickerId] })
      .run(),
}));

const turnIntoCommands: SlashCommand[] = [
  {
    id: 'turn-text',
    title: 'Turn into text',
    icon: glyph('Aa'),
    keywords: ['turn', 'convert', 'text', 'paragraph', 'clear'],
    section: 'turn-into',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('paragraph')
        .run(),
  },
  {
    id: 'turn-heading-2',
    title: 'Turn into heading',
    icon: glyph('H2'),
    keywords: ['turn', 'convert', 'heading', 'h2'],
    section: 'turn-into',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 2 })
        .run(),
  },
  {
    id: 'turn-quote',
    title: 'Turn into quote',
    icon: glyph('❝'),
    keywords: ['turn', 'convert', 'quote', 'blockquote'],
    section: 'turn-into',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'turn-callout',
    title: 'Turn into callout',
    icon: { kind: 'sticker', stickerId: 'sparkle' },
    keywords: ['turn', 'convert', 'callout', 'wash'],
    section: 'turn-into',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCallout().run(),
  },
  {
    id: 'turn-toggle',
    title: 'Turn into toggle',
    icon: glyph('▸'),
    keywords: ['turn', 'convert', 'toggle', 'details', 'collapse'],
    section: 'turn-into',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setDetails().run(),
  },
  {
    id: 'turn-code',
    title: 'Turn into code',
    icon: glyph('{ }'),
    keywords: ['turn', 'convert', 'code', 'codeblock'],
    section: 'turn-into',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
];

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  ...blockCommands,
  ...SLASH_DIAGRAM_COMMANDS,
  ...stickerCommands,
  ...turnIntoCommands,
];

// ---------------------------------------------------------------------------
// Fuzzy filter
// ---------------------------------------------------------------------------

/**
 * Score `query` against `text`. Higher is better; null means no match.
 * Prefix > word-start prefix > substring > subsequence (gap-penalized).
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  if (t.startsWith(q)) return 100;
  const wordStart = t
    .split(/[\s-]+/)
    .some((word) => word.startsWith(q));
  if (wordStart) return 80;
  if (t.includes(q)) return 60;
  // Subsequence with gap penalty.
  let ti = 0;
  let gaps = 0;
  let lastMatch = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    if (lastMatch >= 0 && found > lastMatch + 1) gaps += 1;
    lastMatch = found;
    ti = found + 1;
  }
  const score = 40 - gaps * 6 - Math.max(0, t.length - q.length) * 0.25;
  return score > 0 ? score : 1;
}

function commandScore(query: string, command: SlashCommand): number | null {
  let best: number | null = fuzzyScore(query, command.title);
  for (const keyword of command.keywords) {
    const s = fuzzyScore(query, keyword);
    if (s !== null) {
      // Keyword hits rank slightly below identical title hits.
      const adjusted = s - 2;
      if (best === null || adjusted > best) best = adjusted;
    }
  }
  return best;
}

/**
 * Filter + rank the registry for a slash query. Empty query returns every
 * command in registry order. Ranking is stable for equal scores.
 */
export function filterSlashCommands(
  query: string,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): SlashCommand[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [...commands];
  const scored: Array<{ command: SlashCommand; score: number; index: number }> =
    [];
  commands.forEach((command, index) => {
    const score = commandScore(trimmed, command);
    if (score !== null) scored.push({ command, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.command);
}
