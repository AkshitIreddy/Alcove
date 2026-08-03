/**
 * src/search/backlinks.ts — the live half of page-to-page links.
 *
 * WHY THERE IS NO `page_links` TABLE. The edges already exist in a table that
 * is written on every save, swept for anything that bypassed the save hook,
 * and orphan-collected when a page dies: `search_index` (src/data/search.ts).
 * `extractPageText` ends each row's text with one machine-readable footer line
 * naming the pages that row links to, and `linksFromIndexedText` reads it back
 * (see src/search/extract.ts for the footer's shape and its one cost).
 *
 * A second table would need its own writer, its own freshness sweep and its
 * own orphan collection, and each of those is a place where the two could
 * disagree about a page that has been deleted — which is exactly the bug a
 * backlinks panel must not have, because the reader's only evidence is a list
 * of promises about pages they cannot see.
 *
 * THE GRAPH IS BUILT WHOLE, NOT QUERIED PER PAGE. A personal library is
 * hundreds of pages; walking all of them costs less than the round trip that
 * would ask SQLite to do it, and both consumers want the whole thing anyway
 * (the picker lists every page, the tab lists one page's sources). It is cached
 * behind a version counter so a spread showing two pages builds it once.
 */

import { createSignal } from 'solid-js';
import { getDb } from '../data/db';
import { ensureIndexFresh, loadIndex } from '../data/search';
import { linksFromIndexedText } from './extract';
import {
  EMPTY_LINK_GRAPH,
  backlinkCards,
  buildLinkGraph,
  rankPageCards,
  type IndexedPageLike,
  type LinkGraph,
  type PageCard,
} from './pageCards';

export type { PageCard } from './pageCards';

/**
 * How long a built graph is trusted without a bump.
 *
 * Short, because the cost of being wrong is a stale count on screen and the
 * cost of being right is one table scan. `bumpLinkGraph()` is what makes the
 * common case (this reader just saved this page) instant; the TTL only covers
 * writers that never call it — imports, script inserts, another window.
 */
const GRAPH_TTL_MS = 2500;

const [graphVersion, setGraphVersion] = createSignal(0);

/**
 * Reactive stamp that changes whenever the graph may have moved. Read it in a
 * Solid effect to re-query; it is deliberately a number and not the graph
 * itself, so a component that does not care about links pays nothing.
 */
export const linkGraphVersion = graphVersion;

interface CachedGraph {
  readonly graph: LinkGraph;
  readonly builtAt: number;
  readonly version: number;
}

let cached: CachedGraph | null = null;
let inFlight: Promise<LinkGraph> | null = null;

/**
 * Throw the cached graph away and tell every listener.
 *
 * Called after a page save (the index row has already been rewritten by then —
 * `savePageDoc` awaits `indexPage`) and after a link is inserted.
 */
export function bumpLinkGraph(): void {
  cached = null;
  setGraphVersion((n) => n + 1);
}

interface BookTitleRow {
  id: string;
  title: string;
}

async function bookTitles(): Promise<Map<string, string>> {
  try {
    const db = await getDb();
    const rows = await db.select<BookTitleRow[]>('SELECT id, title FROM books');
    return new Map(rows.map((row) => [row.id, row.title]));
  } catch {
    // A library with no titles still has pages worth linking to; the cards
    // fall back to "Untitled book" rather than the whole feature failing.
    return new Map();
  }
}

/**
 * The current link graph, cached.
 *
 * Never throws: a database that will not answer yields an empty graph, which
 * draws as "no backlinks" — the same as a page nobody has linked to. That is
 * the right failure for a panel that is decoration on top of the reader's
 * writing, not the writing itself.
 */
export async function loadLinkGraph(): Promise<LinkGraph> {
  const now = Date.now();
  if (
    cached !== null &&
    cached.version === graphVersion() &&
    now - cached.builtAt < GRAPH_TTL_MS
  ) {
    return cached.graph;
  }
  if (inFlight !== null) return inFlight;

  const version = graphVersion();
  inFlight = (async () => {
    try {
      // Cheap when warm (throttled to one sweep per 15s inside), and the only
      // thing that catches pages created by seeding, imports or script inserts
      // — none of which go through the editor's save hook.
      await ensureIndexFresh();
      const [pages, titles] = await Promise.all([loadIndex(), bookTitles()]);
      const graph = buildLinkGraph(
        pages as IndexedPageLike[],
        titles,
        (page) => linksFromIndexedText(page.text),
      );
      cached = { graph, builtAt: Date.now(), version };
      return graph;
    } catch {
      return EMPTY_LINK_GRAPH;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Pages that link to `pageId` — book order, then page order. */
export async function loadBacklinks(pageId: string): Promise<PageCard[]> {
  if (pageId === '') return [];
  const graph = await loadLinkGraph();
  return backlinkCards(graph, pageId);
}

/** Pages `pageId` points at, in the order they appear on it. */
export async function loadOutgoingLinks(pageId: string): Promise<PageCard[]> {
  if (pageId === '') return [];
  const graph = await loadLinkGraph();
  const out: PageCard[] = [];
  for (const id of graph.outgoing.get(pageId) ?? []) {
    const card = graph.cards.get(id);
    if (card !== undefined) out.push(card);
  }
  return out;
}

export interface LinkTargetQuery {
  /** What the reader has typed after `[[`. */
  readonly query: string;
  /** The page doing the linking — never offered as its own target. */
  readonly fromPageId?: string;
  readonly limit?: number;
}

/** Candidate pages for the `[[` picker, best first. */
export async function loadLinkTargets(
  options: LinkTargetQuery,
): Promise<PageCard[]> {
  const graph = await loadLinkGraph();
  const cards: PageCard[] = [];
  for (const card of graph.cards.values()) {
    if (card.pageId === options.fromPageId) continue;
    cards.push(card);
  }
  return rankPageCards(cards, options.query, options.limit ?? 8);
}

/** One page's card, for naming a link target that is already chosen. */
export async function loadPageCard(pageId: string): Promise<PageCard | null> {
  const graph = await loadLinkGraph();
  return graph.cards.get(pageId) ?? null;
}
