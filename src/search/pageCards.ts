/**
 * src/search/pageCards.ts — a page as something a reader can point at.
 *
 * Pure and DOM-free (tests/backlinks.test.ts pins it in Node), because both
 * consumers need the same answer and neither can be trusted to compute it
 * twice the same way: the `[[` picker (src/editor/links) offers pages to link
 * TO, and the backlinks tab (src/editor/backlinks) lists the pages that link
 * back. If those two disagreed about what a page is called, the reader would
 * follow a link to a page with a different name on it.
 *
 * A PAGE HAS NO TITLE, WHICH IS THE WHOLE PROBLEM. `pages` rows carry an id,
 * a book, an ord and a document — nothing a person would call a name. So a
 * name is DERIVED, in the order a reader's eye finds one:
 *
 *   1. the page's most important heading (lowest level, earliest at that
 *      level) — what anyone would read off the page,
 *   2. failing that, its first line of prose, clipped,
 *   3. failing that, "page N", which is at least true.
 *
 * Derived and not stored, on purpose. A stored title would go stale the
 * moment the heading was edited, and a link labelled with last week's heading
 * is worse than no label. The label the LINK carries is a separate thing and
 * is a snapshot by design (see src/editor/nodes/pageLink.tsx) — it is what
 * the reader wrote, not what the page is called.
 */

import { LINK_FOOTER_MARK, type PageHeading } from './extract';
import { fuzzyMatch } from './fuzzy';
import { tokenize } from './rank';

/**
 * The shape this module needs out of one `search_index` row.
 *
 * Structural rather than an import of `IndexedPage` (src/data/search.ts) so
 * nothing here drags the SQLite layer into a Node test.
 */
export interface IndexedPageLike {
  readonly pageId: string;
  readonly bookId: string;
  /** 0-based position of the page in its book. */
  readonly ord: number;
  /** Flattened page text, link footer included (see extract.ts). */
  readonly text: string;
  readonly headings: readonly PageHeading[];
  readonly updatedAt: string;
}

/** One page, named and described well enough to pick from a list. */
export interface PageCard {
  readonly pageId: string;
  readonly bookId: string;
  readonly bookTitle: string;
  /** 0-based; display as `ord + 1`. */
  readonly ord: number;
  /** Derived name — never empty (see the file header for the ladder). */
  readonly title: string;
  /** True when `title` is the "page N" fallback rather than the page's words. */
  readonly untitled: boolean;
  /** A line of the page's prose, for the second row of a picker entry. */
  readonly preview: string;
  readonly updatedAt: string;
}

const TITLE_MAX = 72;
const PREVIEW_MAX = 96;

/** Clip on a word boundary, with an ellipsis when anything was dropped. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The page's prose without the machine-readable link footer.
 *
 * The footer is the last line and starts with a mark no keyboard produces by
 * accident, so this is a one-line check rather than a scan — and a page whose
 * genuine last line happened to start with that mark would only lose one line
 * of preview text, never a link.
 */
export function pageBodyText(text: string): string {
  const cut = text.lastIndexOf(`\n${LINK_FOOTER_MARK} `);
  const body = cut >= 0 ? text.slice(0, cut) : text;
  return body.startsWith(`${LINK_FOOTER_MARK} `) ? '' : body;
}

/**
 * The heading a reader would call the page's name: the most important one
 * (lowest level), and among equals the first.
 */
function bestHeading(headings: readonly PageHeading[]): string {
  let best: PageHeading | null = null;
  for (const heading of headings) {
    const text = heading.text.trim();
    if (text === '') continue;
    if (best === null || heading.level < best.level) best = { ...heading, text };
  }
  return best?.text ?? '';
}

/** Derived page name + whether it had to fall back to "page N". */
export function pageTitleOf(page: IndexedPageLike): {
  title: string;
  untitled: boolean;
} {
  const heading = bestHeading(page.headings);
  if (heading !== '') return { title: clip(heading, TITLE_MAX), untitled: false };

  const firstLine = pageBodyText(page.text)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (firstLine !== undefined && firstLine !== '') {
    return { title: clip(firstLine, TITLE_MAX), untitled: false };
  }
  return { title: `page ${page.ord + 1}`, untitled: true };
}

/** One indexed page → the card both the picker and the backlinks tab draw. */
export function pageCardOf(page: IndexedPageLike, bookTitle: string): PageCard {
  const { title, untitled } = pageTitleOf(page);
  const body = pageBodyText(page.text);
  // The preview must not repeat the title back at the reader, so the line the
  // title came from is skipped — but only that one line.
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const rest = lines.filter((line) => clip(line, TITLE_MAX) !== title);
  return {
    pageId: page.pageId,
    bookId: page.bookId,
    bookTitle: bookTitle.trim() === '' ? 'Untitled book' : bookTitle,
    ord: page.ord,
    title,
    untitled,
    preview: clip(rest.join(' · '), PREVIEW_MAX),
    updatedAt: page.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Ranking, for the `[[` picker
// ---------------------------------------------------------------------------

/** A ranked card plus the number that ranked it (exposed for tests). */
export interface RankedPageCard {
  readonly card: PageCard;
  readonly score: number;
}

/**
 * Bonus added to a title hit so a page whose NAME matches always outranks a
 * page that merely mentions the words. Larger than any realistic gap between
 * two fuzzy scores, because "the one called that" is not a close call.
 */
const TITLE_WEIGHT = 24;
/** A page that only mentions every word somewhere in its prose. */
const BODY_SCORE = 3;

/**
 * Score one card against a query. Null = no match at all.
 *
 * Three tiers, in the order a reader means them: the page's own name, then the
 * book it lives in (typing a book name to see its pages is a real gesture),
 * then the page's prose — the last of which is a containment test rather than
 * a fuzzy one, because fuzzy-matching a whole page of text matches everything.
 */
export function scorePageCard(card: PageCard, query: string): number | null {
  const q = query.trim();
  if (q === '') return 0;

  const byTitle = fuzzyMatch(q, card.title);
  const byBook = fuzzyMatch(q, card.bookTitle);
  let score = Number.NEGATIVE_INFINITY;
  if (byTitle !== null) score = byTitle.score + TITLE_WEIGHT;
  if (byBook !== null) score = Math.max(score, byBook.score);
  if (score > Number.NEGATIVE_INFINITY) return score;

  const terms = tokenize(q);
  if (terms.length === 0) return null;
  const haystack = card.preview.toLowerCase();
  return terms.every((term) => haystack.includes(term)) ? BODY_SCORE : null;
}

/**
 * Best pages for `query`, best first.
 *
 * An EMPTY query is the state the picker opens in, and it answers with the
 * most recently edited pages — the ones a reader is most likely to be joining
 * up right now. Ties anywhere fall back to the same recency order, so the list
 * never reshuffles between two keystrokes that scored the same.
 */
export function rankPageCards(
  cards: readonly PageCard[],
  query: string,
  limit = 8,
): PageCard[] {
  const scored: RankedPageCard[] = [];
  for (const card of cards) {
    const score = scorePageCard(card, query);
    if (score !== null) scored.push({ card, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.card.updatedAt.localeCompare(a.card.updatedAt);
  });
  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.card);
}

// ---------------------------------------------------------------------------
// The link graph
// ---------------------------------------------------------------------------

/** Which page points at which, both ways round, with every page named. */
export interface LinkGraph {
  /** Every indexed page, by id. */
  readonly cards: ReadonlyMap<string, PageCard>;
  /** pageId → the pages it links to (reading order, deduped). */
  readonly outgoing: ReadonlyMap<string, readonly string[]>;
  /** pageId → the pages that link to it. */
  readonly incoming: ReadonlyMap<string, readonly string[]>;
}

export const EMPTY_LINK_GRAPH: LinkGraph = {
  cards: new Map(),
  outgoing: new Map(),
  incoming: new Map(),
};

/**
 * Build the graph from the index rows.
 *
 * DANGLING EDGES ARE DROPPED. A link whose target has been deleted still sits
 * in the source page's footer (nothing rewrites a page because another one
 * died), and a backlinks tab that counted it would promise a page that cannot
 * open. The edge stays in the document, so restoring the target from a backup
 * brings the backlink back on the next sweep.
 *
 * SELF-LINKS ARE DROPPED for the same honesty: "linked from" listing the page
 * you are standing on tells the reader nothing they can act on.
 */
export function buildLinkGraph(
  pages: readonly IndexedPageLike[],
  bookTitles: ReadonlyMap<string, string>,
  linksOf: (page: IndexedPageLike) => readonly string[],
): LinkGraph {
  const cards = new Map<string, PageCard>();
  for (const page of pages) {
    cards.set(page.pageId, pageCardOf(page, bookTitles.get(page.bookId) ?? ''));
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const page of pages) {
    const targets: string[] = [];
    for (const target of linksOf(page)) {
      if (target === page.pageId || !cards.has(target)) continue;
      if (targets.includes(target)) continue;
      targets.push(target);
      const back = incoming.get(target);
      if (back === undefined) incoming.set(target, [page.pageId]);
      else if (!back.includes(page.pageId)) back.push(page.pageId);
    }
    if (targets.length > 0) outgoing.set(page.pageId, targets);
  }
  return { cards, outgoing, incoming };
}

/**
 * The pages that link to `pageId`, as cards.
 *
 * Ordered by book title, then by page number — a reader scanning the list is
 * looking for a place, and a place is "which book, how far in". Ordering by
 * edit time instead would reshuffle the list every time one of them was
 * touched.
 */
export function backlinkCards(graph: LinkGraph, pageId: string): PageCard[] {
  const sources = graph.incoming.get(pageId) ?? [];
  const cards: PageCard[] = [];
  for (const id of sources) {
    const card = graph.cards.get(id);
    if (card !== undefined) cards.push(card);
  }
  cards.sort(
    (a, b) =>
      a.bookTitle.localeCompare(b.bookTitle) || a.ord - b.ord ||
      a.pageId.localeCompare(b.pageId),
  );
  return cards;
}
