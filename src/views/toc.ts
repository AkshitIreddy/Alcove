/**
 * Table of contents (roadmap #9) — pure heading extraction over the book's
 * stored docs, DOM-free so it unit-tests in Node. The rail's TOC panel
 * renders the result; clicking an entry jumps the spread to its page.
 */
import type { Page, PageDoc } from '../data/types';

export interface TocEntry {
  readonly pageId: string;
  /** Page position in the book's ord-ascending list (spread math input). */
  readonly slot: number;
  /** Heading level 1-4; page rows without any heading get level 0. */
  readonly level: number;
  readonly text: string;
}

const textOf = (node: { content?: unknown }): string =>
  Array.isArray(node.content)
    ? node.content
        .map((child) =>
          child !== null &&
          typeof child === 'object' &&
          typeof (child as { text?: unknown }).text === 'string'
            ? (child as { text: string }).text
            : '',
        )
        .join('')
    : '';

/** Top-level headings of one doc, in document order. */
export function extractHeadings(
  doc: PageDoc | null | undefined,
): Array<{ level: number; text: string }> {
  if (!doc || !Array.isArray(doc.content)) return [];
  const out: Array<{ level: number; text: string }> = [];
  for (const block of doc.content) {
    if (block === null || typeof block !== 'object') continue;
    const node = block as { type?: unknown; attrs?: { level?: unknown }; content?: unknown };
    if (node.type !== 'heading') continue;
    const rawLevel = node.attrs?.level;
    const level =
      typeof rawLevel === 'number' && rawLevel >= 1 && rawLevel <= 6
        ? Math.round(rawLevel)
        : 1;
    const text = textOf(node).trim();
    if (text !== '') out.push({ level, text });
  }
  return out;
}

/**
 * The whole book's TOC: every heading of every page (slot = list index).
 * Pages without headings are skipped — the panel lists pages separately.
 */
export function buildBookToc(pages: readonly Page[]): TocEntry[] {
  const entries: TocEntry[] = [];
  pages.forEach((page, slot) => {
    for (const heading of extractHeadings(page.doc)) {
      entries.push({ pageId: page.id, slot, ...heading });
    }
  });
  return entries;
}
