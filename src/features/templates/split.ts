/**
 * src/features/templates/split.ts — pure page-splitting for imported
 * Markdown / template scripts (roadmap item 25: "one page per H1 or
 * capacity split"). DOM-free; unit-tested in tests/export.test.ts.
 *
 * Strategy: walk the parsed ScriptDoc's top-level blocks.
 * - A level-1 heading starts a new page (unless the current page is empty).
 * - Each block gets an estimated line cost; when a page's total would blow
 *   past the budget, the page is cut *before* the block (capacity split) —
 *   so headingless documents still split into book-sized pages.
 */
import type { Block, Inline, ListItem, ScriptDoc } from '../../script/types';

/** Rough lines-per-page budget of a book leaf (26px lines on ~780px). */
export const PAGE_LINE_BUDGET = 26;

/** ~chars per rendered line of body text on a leaf. */
const CHARS_PER_LINE = 62;

export function inlineText(content: readonly Inline[]): string {
  let out = '';
  for (const node of content) {
    if (node.kind === 'text' || node.kind === 'code') out += node.text;
    else if (node.kind === 'math' || node.kind === 'footnote') out += node.text;
    else if (node.kind === 'pageref') out += node.label;
    else out += inlineText(node.children);
  }
  return out;
}

function textLines(content: readonly Inline[]): number {
  const length = inlineText(content).length;
  return Math.max(1, Math.ceil(length / CHARS_PER_LINE));
}

function listLines(items: readonly ListItem[]): number {
  let lines = 0;
  for (const item of items) {
    lines += textLines(item.content);
    lines += listLines(item.children);
  }
  return lines;
}

/** Estimated rendered line cost of one block. */
export function blockLineCost(block: Block): number {
  switch (block.kind) {
    case 'heading':
      return block.level === 1 ? 3 : 2;
    case 'paragraph':
      return textLines(block.content) + 1;
    case 'quote':
      return textLines(block.content) + 1;
    case 'divider':
      return 1;
    case 'list':
    case 'taskList':
      return listLines(block.items) + 1;
    case 'table':
      return block.rows.length + (block.header !== null ? 1 : 0) + 2;
    case 'image':
      return 9;
    case 'mathBlock':
      // An equation is drawn a good deal taller than the line it sits on, and
      // a multi-line aligned environment taller again.
      return 2 + block.latex.split('\n').length;
    case 'diagram':
      return 10;
    case 'fetchDirective':
      return 9;
    case 'container': {
      // Side-by-side columns are as tall as their tallest column — and so is
      // an image row, which is the same layout with pictures in it. Summing
      // its children counted a row of three kittens as three full-width
      // photographs and cut the page before it.
      if (block.name === 'columns' || block.name === 'image-row') {
        let tallest = 0;
        for (const child of block.children) {
          tallest = Math.max(tallest, blockLineCost(child));
        }
        return 2 + tallest;
      }
      let lines = 2;
      for (const child of block.children) lines += blockLineCost(child);
      return lines;
    }
  }
}

export interface SplitOptions {
  /** Line budget per page (default PAGE_LINE_BUDGET). */
  maxLines?: number;
  /** Start a new page on every level-1 heading (default true). */
  splitOnH1?: boolean;
}

/**
 * Split top-level blocks into page-sized runs. Always returns at least one
 * page (an empty doc yields one empty page).
 */
export function splitBlocksIntoPages(
  blocks: readonly Block[],
  options: SplitOptions = {},
): Block[][] {
  const maxLines = options.maxLines ?? PAGE_LINE_BUDGET;
  const splitOnH1 = options.splitOnH1 ?? true;

  const pages: Block[][] = [];
  let current: Block[] = [];
  let currentLines = 0;

  const flush = (): void => {
    if (current.length > 0) {
      pages.push(current);
      current = [];
      currentLines = 0;
    }
  };

  for (const block of blocks) {
    const isH1 = block.kind === 'heading' && block.level === 1;
    if (splitOnH1 && isH1) flush();

    const cost = blockLineCost(block);
    if (current.length > 0 && currentLines + cost > maxLines) flush();

    current.push(block);
    currentLines += cost;
  }
  flush();

  if (pages.length === 0) pages.push([]);
  return pages;
}

/** Book title: frontmatter `title:`, else the first H1, else the fallback. */
export function deriveBookTitle(doc: ScriptDoc, fallback: string): string {
  const fromFrontmatter = doc.frontmatter.title?.trim();
  if (fromFrontmatter !== undefined && fromFrontmatter !== '') {
    return fromFrontmatter.slice(0, 80);
  }
  for (const block of doc.blocks) {
    if (block.kind === 'heading' && block.level === 1) {
      const text = inlineText(block.content).trim();
      if (text !== '') return text.slice(0, 80);
    }
  }
  const clean = fallback.trim();
  return clean === '' ? 'Imported notes' : clean.slice(0, 80);
}

/** `notes.study.md` → `notes.study`; path separators tolerated. */
export function titleFromFileName(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return base.replace(/\.(md|markdown|txt)$/i, '');
}

// ---------------------------------------------------------------------------
// Shelf placement — first free slot scanning floors downward.
// ---------------------------------------------------------------------------

/** Matches the shelf world geometry (bookshelf/constants.ts): ~19 slots. */
export const SLOTS_PER_FLOOR = 19;

export interface ShelfSpot {
  floor: number;
  slot: number;
}

/** First free slot on the lowest-indexed floor with room. Pure. */
export function nextShelfSpot(
  books: ReadonlyArray<{ floor: number; slot: number }>,
  slotsPerFloor = SLOTS_PER_FLOOR,
): ShelfSpot {
  const used = new Map<number, Set<number>>();
  for (const book of books) {
    let slots = used.get(book.floor);
    if (slots === undefined) {
      slots = new Set();
      used.set(book.floor, slots);
    }
    slots.add(book.slot);
  }
  for (let floor = 0; floor < 10_000; floor += 1) {
    const slots = used.get(floor);
    if (slots === undefined) return { floor, slot: 0 };
    for (let slot = 0; slot < slotsPerFloor; slot += 1) {
      if (!slots.has(slot)) return { floor, slot };
    }
  }
  return { floor: 0, slot: 0 };
}
