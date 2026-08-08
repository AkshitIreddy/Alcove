/**
 * Slash-menu command registry + fuzzy filter. Pure logic (no DOM, no Solid)
 * so it is unit-testable in a Node environment.
 */
import type { Editor, Range } from '@tiptap/core';
import { SLASH_DIAGRAM_COMMANDS } from '../../diagrams/slashCommands';
import { openToday } from '../journal';
import { STICKER_IDS, STICKER_TAGS, type StickerId } from '../nodes/stickers';
import { CODE_LANGUAGE_SHORTLIST } from '../codeLanguages';

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
    subtitle: 'Highlighted, with a language on it',
    icon: glyph('{ }'),
    keywords: ['code', 'codeblock', 'snippet', 'monospace', 'pre', 'syntax'],
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
  {
    id: 'sticky-note',
    title: 'Sticky note',
    subtitle: 'A lemon post-it, slightly tilted',
    icon: glyph('▤'),
    keywords: ['sticky', 'note', 'postit', 'post-it', 'sticky-note', 'reminder'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('sticky-note').run(),
  },
  {
    id: 'polaroid',
    title: 'Polaroid',
    subtitle: 'White-framed photo with caption',
    icon: glyph('▣'),
    keywords: ['polaroid', 'photo', 'picture', 'frame', 'caption', 'snapshot'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('polaroid').run(),
  },
  {
    id: 'washi-box',
    title: 'Washi box',
    subtitle: 'Held down by two tape strips',
    icon: glyph('▦'),
    keywords: ['washi', 'box', 'tape', 'washi-box', 'taped'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('washi-box').run(),
  },
  {
    id: 'card',
    title: 'Card',
    subtitle: 'A clean aged-paper card',
    icon: glyph('▢'),
    keywords: ['card', 'box', 'panel', 'definition', 'aside'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('card').run(),
  },
  {
    id: 'quote-card',
    title: 'Quote card',
    subtitle: 'Decorated pull-quote',
    icon: glyph('❞'),
    keywords: ['quote', 'quotecard', 'quote-card', 'pull', 'blockquote', 'saying'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('quote-card').run(),
  },
  {
    id: 'banner',
    title: 'Banner',
    subtitle: 'Full-width ribbon with chevron ends',
    icon: glyph('⚑'),
    keywords: ['banner', 'ribbon', 'header', 'strip', 'week'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('banner').run(),
  },
  {
    id: 'spoiler',
    title: 'Spoiler',
    subtitle: 'Blurred until clicked',
    icon: glyph('…'),
    keywords: ['spoiler', 'hidden', 'details', 'reveal', 'blur', 'answer'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('spoiler').run(),
  },
  /* --- the stationery drawer (script vocab: index-card … marginalia) ------ */
  {
    id: 'index-card',
    title: 'Index card',
    subtitle: 'Ruled card with a red header rule',
    icon: glyph('▭'),
    keywords: ['index', 'card', 'recipe', 'flashcard', 'file', 'ruled'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('index-card').run(),
  },
  {
    id: 'envelope',
    title: 'Envelope',
    subtitle: 'Paper envelope with the flap open',
    icon: glyph('✉'),
    keywords: ['envelope', 'letter', 'mail', 'post', 'keepsake'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('envelope').run(),
  },
  {
    id: 'stamp',
    title: 'Stamp',
    subtitle: 'Perforated postage stamp with a postmark',
    icon: glyph('❖'),
    keywords: ['stamp', 'postage', 'postmark', 'postcard', 'perforated'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('stamp').run(),
  },
  {
    id: 'tag',
    title: 'Tag',
    subtitle: 'A luggage label on a string',
    icon: glyph('⌁'),
    keywords: ['tag', 'label', 'luggage', 'name', 'title'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('tag').run(),
  },
  {
    id: 'marginalia',
    title: 'Margin note',
    subtitle: 'A small afterthought beside the text',
    icon: glyph('❘'),
    keywords: ['margin', 'marginalia', 'aside', 'side', 'note', 'afterthought'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('marginalia').run(),
  },
  /* --- the keepsake drawer (things kept IN a notebook, not written on) ---- */
  {
    id: 'pressed-flower',
    title: 'Pressed flower',
    subtitle: 'A specimen taped to a mount card, with its label',
    icon: { kind: 'sticker', stickerId: 'flower' },
    keywords: [
      'pressed',
      'flower',
      'specimen',
      'herbarium',
      'botanical',
      'plant',
      'leaf',
      'nature',
    ],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('pressed-flower').run(),
  },
  {
    id: 'ticket-stub',
    title: 'Ticket stub',
    subtitle: 'Torn along the perforation, stub still attached',
    icon: glyph('⌗'),
    keywords: [
      'ticket',
      'stub',
      'admit',
      'concert',
      'cinema',
      'train',
      'perforated',
      'torn',
    ],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('ticket-stub').run(),
  },
  {
    id: 'postcard',
    title: 'Postcard',
    subtitle: 'Divided back — message left, address right',
    icon: glyph('▤'),
    keywords: [
      'postcard',
      'post',
      'card',
      'holiday',
      'address',
      'greetings',
      'divided',
      'mail',
    ],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertPostcard().run(),
  },
  {
    id: 'ledger',
    title: 'Ledger',
    subtitle: 'Ruled accounts strip with a figures column',
    icon: glyph('₤'),
    keywords: [
      'ledger',
      'accounts',
      'money',
      'budget',
      'expenses',
      'tally',
      'spending',
      'figures',
      'total',
    ],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertLedger().run(),
  },
  {
    id: 'photo-corner',
    title: 'Photo corners',
    subtitle: 'A print held down by four paper corners',
    icon: glyph('◹'),
    keywords: [
      'photo',
      'corner',
      'corners',
      'mount',
      'album',
      'print',
      'snapshot',
      'picture',
      'scrapbook',
    ],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('photo-corner').run(),
  },
  /* --- the two fastenings (they arrive ON TOP of writing, not around it) -- */
  {
    id: 'wax-seal',
    title: 'Wax seal',
    subtitle: 'A blob of sealing wax pressed over a ribbon',
    icon: glyph('◉'),
    keywords: [
      'wax',
      'seal',
      'sealed',
      'sealing',
      'monogram',
      'letter',
      'promise',
      'oath',
      'signed',
      'ribbon',
    ],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('wax-seal').run(),
  },
  {
    id: 'map-pin',
    title: 'Map pin',
    subtitle: 'A place, pinned, with the walk in behind it',
    icon: { kind: 'sticker', stickerId: 'pin' },
    keywords: [
      'map',
      'pin',
      'place',
      'location',
      'travel',
      'trip',
      'where',
      'waypoint',
      'visited',
    ],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn('map-pin').run(),
  },
  {
    id: 'today',
    title: 'Today',
    subtitle: "Jump to today's journal page",
    icon: glyph('☀'),
    keywords: ['today', 'journal', 'daily', 'diary', 'date', 'day'],
    section: 'blocks',
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      // Fire-and-forget: resolves the Journal book, creates-or-finds the
      // dated page and navigates (src/editor/journal.ts).
      void openToday();
    },
  },
  // Columns go through `setColumns`, not a literal insertContent: the command
  // carries the block the caret was on into the first column, nests when the
  // caret is already inside one, and is the same path the right-click menu
  // takes — three columns from the menu and three from here cannot drift.
  {
    id: 'columns',
    title: 'Columns',
    subtitle: 'Two columns, side by side',
    icon: glyph('▥'),
    keywords: ['columns', 'col', 'layout', 'side', 'split', 'two'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setColumns(2).run(),
  },
  {
    id: 'columns-three',
    title: 'Three columns',
    subtitle: 'A third of the page each',
    icon: glyph('▥'),
    keywords: ['columns', 'three', 'col', 'layout', 'split', 'thirds'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setColumns(3).run(),
  },
  {
    id: 'equation',
    title: 'Equation',
    subtitle: 'Maths on its own line — \\frac, \\sqrt, \\sum',
    icon: glyph('∑'),
    keywords: [
      'equation',
      'math',
      'maths',
      'formula',
      'latex',
      'tex',
      'algebra',
      'fraction',
      'display',
    ],
    section: 'blocks',
    // The node view opens its own source field when it arrives empty, so
    // there is nothing to chase here.
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertEquation().run(),
  },
  {
    id: 'math-inline',
    title: 'Inline maths',
    subtitle: 'A formula inside the sentence — or just type $x^2$',
    icon: glyph('√'),
    keywords: ['math', 'maths', 'inline', 'formula', 'latex', 'tex', 'symbol'],
    section: 'blocks',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertInlineMath().run(),
  },
  {
    id: 'footnote',
    title: 'Footnote',
    subtitle: 'A small number here, the note at the foot of the page',
    icon: glyph('¹'),
    keywords: [
      'footnote',
      'note',
      'aside',
      'reference',
      'citation',
      'source',
      'annotation',
      'asterisk',
    ],
    section: 'blocks',
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertFootnote().run();
      // The note is written at the foot of the page, so that is where the
      // caret belongs — the marker itself is an atom with nothing to type in.
      // The rail is rebuilt by the transaction above; focus it on the next
      // frame, once its entry exists.
      requestAnimationFrame(() => {
        const page = editor.view.dom.parentElement;
        const notes = page?.querySelectorAll('.nb-footnote-note');
        const last = notes?.[notes.length - 1];
        if (last instanceof HTMLElement) last.focus();
      });
    },
  },
  {
    id: 'page-link',
    title: 'Link to a page',
    subtitle: 'Point at another page — it will list this one back',
    icon: glyph('[['),
    keywords: [
      'link',
      'page',
      'backlink',
      'reference',
      'mention',
      'wiki',
      'connect',
      'jump',
    ],
    section: 'blocks',
    // Types the shorthand rather than opening a second picker of its own: the
    // `[[` suggestion (src/editor/links/extension.ts) matches on the text
    // before the caret, so inserting the brackets IS opening the picker — and
    // the reader who came in through the menu is shown the shorthand they can
    // use next time, in the line they are writing.
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent('[[').run(),
  },
];

/**
 * The tilt a sticker lands at.
 *
 * Was a hand-written table of eight. A table cannot survive a sheet of fifty —
 * `Record<StickerId, number>` makes every new sticker a compile error, and the
 * only honest fix is a number nobody chose anyway. Seeded from the name, so a
 * given sticker always lands at the same angle (a rubber stamp, not a dice
 * roll) and no two neighbours in the sheet share one.
 */
export function stickerTilt(stickerId: StickerId): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < stickerId.length; i += 1) {
    hash ^= stickerId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // −7°…+7°, never dead flat: a sticker laid down by hand is never square.
  const unit = ((hash >>> 0) % 1000) / 999;
  const tilt = Math.round((unit * 2 - 1) * 70) / 10;
  return tilt === 0 ? 3 : tilt;
}

const stickerCommands: SlashCommand[] = STICKER_IDS.map((stickerId) => ({
  id: `sticker-${stickerId}`,
  title: `${stickerId.charAt(0).toUpperCase()}${stickerId.slice(1)} sticker`,
  icon: { kind: 'sticker', stickerId },
  keywords: ['sticker', stickerId, 'doodle', 'decoration', ...STICKER_TAGS[stickerId]],
  section: 'stickers',
  run: ({ editor, range }) =>
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertSticker({ stickerId, rotate: stickerTilt(stickerId) })
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

/**
 * One command per everyday language: `/python` makes a Python block.
 *
 * Derived from the shortlist rather than typed out, so a language promoted to
 * `signature` in `editor/codeLanguages.ts` arrives here without anybody
 * remembering this file exists. Only the signatures — all seventy-six would
 * bury every other block command in the menu, and the picker ON the block is
 * where the long list belongs.
 *
 * The generic "Code block" above stays: a reader who does not know what they
 * are about to paste should not have to choose a language first.
 */
const codeLanguageCommands: SlashCommand[] = CODE_LANGUAGE_SHORTLIST.filter(
  (spec) => spec.id !== 'plaintext',
).map((spec) => ({
  id: `code-${spec.id}`,
  title: `${spec.label} block`,
  subtitle: 'A code block, already set to this language',
  icon: glyph('{ }'),
  keywords: ['code', 'codeblock', 'snippet', spec.id, spec.label],
  section: 'blocks',
  run: ({ editor, range }) =>
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .toggleCodeBlock({ language: spec.id })
      .run(),
}));

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  ...blockCommands,
  ...codeLanguageCommands,
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
