/**
 * Word / character counting over stored page docs (roadmap #11).
 *
 * Pure JSON walkers — no editor instance needed, so the rail footer can
 * count every page of the book from the in-memory page list (BookView keeps
 * docs current through onDocChange) and the whole thing unit-tests in Node.
 */
import type { PageDoc } from '../data/types';

/** Depth-first concatenation of every text node, blocks joined by newlines. */
export function docPlainText(doc: PageDoc | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return '';
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const { text, content } = node as { text?: unknown; content?: unknown };
    if (typeof text === 'string') parts.push(text);
    if (Array.isArray(content)) {
      for (const child of content) walk(child);
      parts.push('\n');
    }
  };
  for (const block of doc.content) {
    walk(block);
    parts.push('\n');
  }
  return parts.join('');
}

export interface TextCounts {
  readonly words: number;
  readonly chars: number;
}

/** Unicode-aware word + character counts (chars exclude whitespace). */
export function countText(text: string): TextCounts {
  const words = text.match(/[\p{L}\p{N}'’-]+/gu);
  const chars = text.replace(/\s+/gu, '').length;
  return { words: words?.length ?? 0, chars };
}

/** Counts for one page doc. */
export function countDoc(doc: PageDoc | null | undefined): TextCounts {
  return countText(docPlainText(doc));
}

/** Summed counts across a book's docs. */
export function countBook(
  docs: ReadonlyArray<PageDoc | null | undefined>,
): TextCounts {
  let words = 0;
  let chars = 0;
  for (const doc of docs) {
    const counts = countDoc(doc);
    words += counts.words;
    chars += counts.chars;
  }
  return { words, chars };
}
