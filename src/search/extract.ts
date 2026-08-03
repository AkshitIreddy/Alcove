/**
 * src/search/extract.ts — plain-text + heading extraction from page docs.
 *
 * Pure and DOM-free (unit-tested in tests/search.test.ts). Walks the TipTap
 * document JSON (the storage format — see docs/design/block-editor.md) and
 * flattens every text node into newline-separated block lines, collecting
 * heading texts (any depth — headings can live inside callouts/columns) for
 * the quick switcher's "page headings" source.
 *
 * THE LINK FOOTER, AND WHY BACKLINKS LIVE IN THE FULL-TEXT INDEX
 *
 * A `pageLink` (src/editor/nodes/pageLink.ts) points at another page, and the
 * point of a backlink is to find that edge from the other end. The index that
 * would answer it already exists — one row per page, rebuilt by `indexPage`
 * on every save and swept by `ensureIndexFresh` for everything that bypasses
 * the save hook (seeding, script inserts, imports). A SECOND table of links
 * would need its own writer, its own sweep and its own orphan-collection, and
 * every one of those is a place for the two to disagree about a page that was
 * deleted.
 *
 * So the edges ride in the row that already exists: the extracted text ends
 * with one machine-readable line — `↪ <pageId> <pageId>` — and
 * `linksFromIndexedText` reads it back. The link's LABEL is emitted as
 * ordinary text as well, above the footer, because a reader searching for the
 * words they can see on the page should find that page.
 *
 * The cost is that the footer is searchable text: a query that happens to
 * contain a page id will match every page linking to it. That is a strange
 * search to type and a defensible answer when you do.
 */

import type { PageDoc } from '../data/types';

export interface PageHeading {
  text: string;
  /** 1–6; unknown/missing levels normalize to 1. */
  level: number;
}

export interface ExtractedPage {
  /** Newline-separated block text, whitespace-normalized, link footer last. */
  text: string;
  headings: PageHeading[];
  /** Page ids this page links to, in reading order, deduped. */
  links: string[];
}

/**
 * Opens the link footer. A character no keyboard puts in prose by accident and
 * that `tokenize` (src/search/rank.ts) discards as punctuation, so its
 * presence changes no search result on its own.
 */
export const LINK_FOOTER_MARK = '↪';

/** Read the link footer back out of an indexed page's stored text. */
export function linksFromIndexedText(text: string): string[] {
  const lines = text.split('\n');
  const footer = lines[lines.length - 1] ?? '';
  if (!footer.startsWith(`${LINK_FOOTER_MARK} `)) return [];
  const seen = new Set<string>();
  for (const id of footer.slice(LINK_FOOTER_MARK.length + 1).split(' ')) {
    if (id !== '') seen.add(id);
  }
  return [...seen];
}

interface LooseNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: unknown;
}

function headingLevel(attrs: unknown): number {
  if (attrs !== null && typeof attrs === 'object') {
    const level = (attrs as { level?: unknown }).level;
    if (typeof level === 'number' && Number.isFinite(level)) {
      return Math.min(6, Math.max(1, Math.round(level)));
    }
  }
  return 1;
}

/** A page id out of a pageLink node's attrs, or null. */
function linkTarget(attrs: unknown): { pageId: string; label: string } | null {
  if (attrs === null || typeof attrs !== 'object') return null;
  const record = attrs as { pageId?: unknown; label?: unknown };
  if (typeof record.pageId !== 'string' || record.pageId === '') return null;
  return {
    pageId: record.pageId,
    label: typeof record.label === 'string' ? record.label : '',
  };
}

/**
 * Recursive walk. `out` receives text fragments and '\n' block separators;
 * headings are pushed as they close (so nested headings are found too), and
 * every page link's target is collected for the footer.
 */
function gather(
  node: unknown,
  out: string[],
  headings: PageHeading[],
  links: string[],
): void {
  if (node === null || typeof node !== 'object') return;
  const n = node as LooseNode;

  if (typeof n.text === 'string') {
    out.push(n.text);
    return;
  }
  if (n.type === 'hardBreak') {
    out.push(' ');
    return;
  }
  if (n.type === 'pageLink') {
    // An atom: its words live in an attribute, so the generic walk below would
    // find nothing to index and the link would be invisible to search.
    const target = linkTarget(n.attrs);
    if (target !== null) {
      if (target.label !== '') out.push(target.label);
      if (!links.includes(target.pageId)) links.push(target.pageId);
    }
    return;
  }

  const isHeading = n.type === 'heading';
  const before = out.length;
  if (Array.isArray(n.content)) {
    for (const child of n.content) gather(child, out, headings, links);
  }
  if (isHeading) {
    const text = out
      .slice(before)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text !== '') headings.push({ text, level: headingLevel(n.attrs) });
  }
  // Every non-inline node ends a line so block texts never fuse together.
  out.push('\n');
}

/** Flatten a page document to searchable plain text, headings and links. */
export function extractPageText(doc: PageDoc | null | undefined): ExtractedPage {
  const out: string[] = [];
  const headings: PageHeading[] = [];
  const links: string[] = [];
  if (doc && Array.isArray(doc.content)) {
    for (const node of doc.content) gather(node, out, headings, links);
  }
  const lines = out
    .join('')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
  // The footer is LAST so a snippet window built around a prose hit never
  // reaches it, and so `linksFromIndexedText` can read one line rather than
  // scan the page.
  if (links.length > 0) lines.push(`${LINK_FOOTER_MARK} ${links.join(' ')}`);
  return { text: lines.join('\n'), headings, links };
}
