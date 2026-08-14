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

export interface TocRow {
  readonly slot: number;
  readonly level: number;
  readonly text: string;
  readonly isPageRow: boolean;
}

/**
 * Search spelling belongs here, beside the rows it searches, rather than in
 * the panel. NFKD separates a reader-facing letter from its accent and the
 * Unicode Mark class removes only that accent; words in non-Latin scripts are
 * left intact. Punctuation becomes a word boundary, so `p.12`, `page 12` and
 * a pasted heading with a curly dash all behave like ordinary search words.
 */
export function normalizeTocSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

/**
 * Preserve book order while matching every word in the query. Alongside the
 * visible row copy, each entry owns friendly page aliases: searching for
 * `page 7`, `p.7`, or simply `7` can all reach the seventh leaf even when its
 * heading does not contain a number.
 */
export function filterTocRows(
  rows: readonly TocRow[],
  query: string,
): TocRow[] {
  const normalizedQuery = normalizeTocSearch(query);
  const words = normalizedQuery.split(' ').filter(Boolean);
  if (words.length === 0) return [...rows];

  // A query made entirely from one page alias has exact numeric semantics.
  // Treating the alias as part of one concatenated haystack made `page 2`
  // match `page 12`, `page 20`, and so on because every word was tested as a
  // substring. A heading can still match the same words normally; the exact
  // rule applies only to the synthetic page-number alias.
  const exactPageAlias = normalizedQuery.match(/^(?:(?:page|p)\s+)?(\d+)$/u);

  return rows.filter((row) => {
    const page = row.slot + 1;
    const title = normalizeTocSearch(row.text);
    const titleMatches = words.every((word) => title.includes(word));
    if (exactPageAlias !== null) {
      return page === Number(exactPageAlias[1]) || title.includes(normalizedQuery);
    }
    if (titleMatches) return true;

    // Page aliases remain composable with title words (`worked 2`,
    // `appendix page 7`), but their tokens are exact. Ordinary title words
    // retain the forgiving substring behavior used before this fix.
    const aliasWords = new Set(['page', 'p', String(page)]);
    return words.every((word) => title.includes(word) || aliasWords.has(word));
  });
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

const nodeHasVisibleContent = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return false;
  const node = value as {
    type?: unknown;
    text?: unknown;
    content?: unknown;
  };
  if (node.type === 'text') {
    return typeof node.text === 'string' && node.text.trim() !== '';
  }
  if (
    Array.isArray(node.content) &&
    node.content.some((child) => nodeHasVisibleContent(child))
  ) {
    return true;
  }
  // TipTap's truly empty page is an empty paragraph. Atomic top-level blocks
  // (images, diagrams, dividers, tables, and so on) can be visible without
  // carrying text and therefore still make the page meaningful.
  return (
    typeof node.type === 'string' &&
    node.type !== 'doc' &&
    node.type !== 'paragraph' &&
    node.type !== 'heading' &&
    node.type !== 'hardBreak'
  );
};

export function pageHasVisibleContent(
  doc: PageDoc | null | undefined,
): boolean {
  return Boolean(
    doc &&
      Array.isArray(doc.content) &&
      doc.content.some((block) => nodeHasVisibleContent(block)),
  );
}

/**
 * Presentation rows for the rail. Trailing stocked blank leaves are omitted;
 * a heading-less continuation names the section it continues instead of
 * redundantly printing “page 5   p.5”. Intentional blank leaves inside the
 * authored range remain reachable.
 */
export function buildTocRows(pages: readonly Page[]): TocRow[] {
  let lastAuthoredSlot = -1;
  pages.forEach((page, slot) => {
    if (pageHasVisibleContent(page.doc)) lastAuthoredSlot = slot;
  });
  if (lastAuthoredSlot < 0) return [];

  const headings = buildBookToc(pages);
  const bySlot = new Map<number, TocEntry[]>();
  for (const heading of headings) {
    const list = bySlot.get(heading.slot) ?? [];
    list.push(heading);
    bySlot.set(heading.slot, list);
  }

  const rows: TocRow[] = [];
  let previousHeading = '';
  for (let slot = 0; slot <= lastAuthoredSlot; slot += 1) {
    const pageHeadings = bySlot.get(slot);
    if (pageHeadings && pageHeadings.length > 0) {
      for (const heading of pageHeadings) {
        rows.push({
          slot,
          level: heading.level,
          text: heading.text,
          isPageRow: false,
        });
        previousHeading = heading.text;
      }
      continue;
    }

    const visible = pageHasVisibleContent(pages[slot]?.doc);
    rows.push({
      slot,
      level: 0,
      text: visible
        ? previousHeading === ''
          ? 'untitled'
          : `continued — ${previousHeading}`
        : 'blank page',
      isPageRow: true,
    });
  }
  return rows;
}
