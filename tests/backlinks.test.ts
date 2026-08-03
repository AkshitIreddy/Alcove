// @vitest-environment node
/**
 * tests/backlinks.test.ts — a page that links to another is findable from the
 * other end.
 *
 * Three layers, because the feature can break at any of them independently and
 * only the last one is visible to a reader:
 *
 *   1. EXTRACTION — a `pageLink` atom keeps its words in the indexed text (its
 *      label lives in an attribute, so the generic walk would index nothing)
 *      and its target in the footer line.
 *   2. THE GRAPH — dangling and self edges are dropped, names are derived, the
 *      picker ranks names above prose.
 *   3. THE WHOLE PATH — through `savePageDoc` → `indexPage` → the real
 *      `search_index` table (MemoryDb in node) → `loadBacklinks`. That is the
 *      one that catches "the footer was written but nobody reads it back",
 *      which is exactly the shape of failure a second link table would have.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { extractPageText, linksFromIndexedText } from '../src/search/extract';
import {
  backlinkCards,
  buildLinkGraph,
  pageBodyText,
  pageCardOf,
  pageTitleOf,
  rankPageCards,
  scorePageCard,
  type IndexedPageLike,
} from '../src/search/pageCards';
import {
  bumpLinkGraph,
  loadBacklinks,
  loadLinkTargets,
  loadOutgoingLinks,
  loadPageCard,
} from '../src/search/backlinks';
import { createBook } from '../src/data/books';
import { createPage, savePageDoc } from '../src/data/pages';
import type { PageDoc } from '../src/data/types';

// ---------------------------------------------------------------------------
// Doc builders
// ---------------------------------------------------------------------------

const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const heading = (value: string, level: number) => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const pageLink = (pageId: string, label: string, bookId = 'b1') => ({
  type: 'pageLink',
  attrs: { pageId, bookId, label },
});
const doc = (...content: unknown[]): PageDoc => ({ type: 'doc', content });

/** An index row, with everything the graph needs and nothing it does not. */
function row(over: Partial<IndexedPageLike> = {}): IndexedPageLike {
  return {
    pageId: 'p1',
    bookId: 'b1',
    ord: 0,
    text: '',
    headings: [],
    updatedAt: '2026-08-03T10:00:00.000Z',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. extraction
// ---------------------------------------------------------------------------

describe('extractPageText carries page links', () => {
  it('indexes the link label as ordinary words', () => {
    const out = extractPageText(
      doc(paragraph(text('see '), pageLink('p9', 'Photosynthesis'), text(' for it'))),
    );
    expect(out.text.split('\n')[0]).toBe('see Photosynthesis for it');
  });

  it('names every target in a footer line, deduped, in reading order', () => {
    const out = extractPageText(
      doc(
        paragraph(pageLink('p9', 'Nine')),
        paragraph(pageLink('p2', 'Two'), pageLink('p9', 'Nine again')),
      ),
    );
    expect(out.links).toEqual(['p9', 'p2']);
    expect(out.text.split('\n').pop()).toBe('↪ p9 p2');
  });

  it('round-trips the footer back out of the stored text', () => {
    const out = extractPageText(doc(paragraph(pageLink('p9', 'Nine'))));
    expect(linksFromIndexedText(out.text)).toEqual(['p9']);
  });

  it('reads no links out of a page that has none', () => {
    const out = extractPageText(doc(paragraph(text('nothing here'))));
    expect(out.links).toEqual([]);
    expect(linksFromIndexedText(out.text)).toEqual([]);
    // …and the page's own last line is not mistaken for a footer.
    expect(linksFromIndexedText('a line\nanother ↪ arrow')).toEqual([]);
  });

  it('ignores a link node with no target', () => {
    const out = extractPageText(
      doc(paragraph({ type: 'pageLink', attrs: { pageId: '', label: 'x' } })),
    );
    expect(out.links).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. naming, ranking, the graph
// ---------------------------------------------------------------------------

describe('a page gets a name it did not store', () => {
  it('prefers the most important heading', () => {
    const named = pageTitleOf(
      row({
        headings: [
          { text: 'Notes', level: 3 },
          { text: 'Mitosis', level: 1 },
        ],
        text: 'Notes\nMitosis\nbody',
      }),
    );
    expect(named).toEqual({ title: 'Mitosis', untitled: false });
  });

  it('falls back to the first line, then to the page number', () => {
    expect(pageTitleOf(row({ text: 'a wren sang at dawn' }))).toEqual({
      title: 'a wren sang at dawn',
      untitled: false,
    });
    expect(pageTitleOf(row({ ord: 3, text: '' }))).toEqual({
      title: 'page 4',
      untitled: true,
    });
  });

  it('never shows the reader the link footer', () => {
    const stored = extractPageText(
      doc(paragraph(text('hello')), paragraph(pageLink('p9', 'Nine'))),
    ).text;
    expect(pageBodyText(stored)).toBe('hello\nNine');
    const card = pageCardOf(row({ text: stored }), 'Field Notes');
    expect(card.title).toBe('hello');
    expect(card.preview).not.toContain('↪');
    expect(card.preview).not.toContain('p9');
  });

  it('names a book that has no title', () => {
    expect(pageCardOf(row(), '  ').bookTitle).toBe('Untitled book');
  });
});

describe('ranking link targets', () => {
  const cards = [
    pageCardOf(row({ pageId: 'a', headings: [{ text: 'Mitosis', level: 1 }] }), 'Biology'),
    pageCardOf(
      row({ pageId: 'b', text: 'the word mitosis appears in this prose' }),
      'Biology',
    ),
    pageCardOf(row({ pageId: 'c', headings: [{ text: 'Bread', level: 1 }] }), 'Kitchen'),
  ];

  it('puts the page CALLED that above the page that merely says it', () => {
    const ranked = rankPageCards(cards, 'mitosis');
    expect(ranked.map((card) => card.pageId)).toEqual(['a', 'b']);
  });

  it('finds pages by the book they live in', () => {
    expect(scorePageCard(cards[2]!, 'kitchen')).not.toBeNull();
    expect(scorePageCard(cards[2]!, 'zebra')).toBeNull();
  });

  it('answers an empty query with the most recently edited first', () => {
    const older = pageCardOf(row({ pageId: 'old', updatedAt: '2020-01-01T00:00:00.000Z' }), 'B');
    const newer = pageCardOf(row({ pageId: 'new', updatedAt: '2026-01-01T00:00:00.000Z' }), 'B');
    expect(rankPageCards([older, newer], '').map((c) => c.pageId)).toEqual([
      'new',
      'old',
    ]);
  });

  it('honours the limit', () => {
    expect(rankPageCards(cards, '', 2)).toHaveLength(2);
  });
});

describe('the link graph', () => {
  const pages = [
    row({ pageId: 'a', ord: 0, headings: [{ text: 'Alpha', level: 1 }] }),
    row({ pageId: 'b', ord: 1, headings: [{ text: 'Beta', level: 1 }] }),
    row({ pageId: 'c', bookId: 'b2', ord: 0, headings: [{ text: 'Gamma', level: 1 }] }),
  ];
  const titles = new Map([
    ['b1', 'Field Notes'],
    ['b2', 'Almanac'],
  ]);
  const edges: Record<string, string[]> = {
    a: ['b', 'ghost', 'a'],
    c: ['b', 'b'],
  };
  const graph = buildLinkGraph(pages, titles, (page) => edges[page.pageId] ?? []);

  it('links both ways round', () => {
    expect(graph.outgoing.get('a')).toEqual(['b']);
    expect(graph.incoming.get('b')).toEqual(['a', 'c']);
  });

  it('drops edges to pages that are gone, and to itself', () => {
    expect(graph.outgoing.get('a')).not.toContain('ghost');
    expect(graph.outgoing.get('a')).not.toContain('a');
    expect(graph.incoming.has('a')).toBe(false);
  });

  it('lists sources by book, then by page number', () => {
    const cards = backlinkCards(graph, 'b');
    expect(cards.map((card) => `${card.bookTitle}/${card.ord}`)).toEqual([
      'Almanac/0',
      'Field Notes/0',
    ]);
  });

  it('has nothing to say about a page nobody points at', () => {
    expect(backlinkCards(graph, 'c')).toEqual([]);
    expect(backlinkCards(graph, 'nobody')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. the whole path, through the real index (MemoryDb stub)
// ---------------------------------------------------------------------------

describe('backlinks through the search index (in-memory db)', () => {
  let bookId = '';
  let sourceId = '';
  let targetId = '';

  beforeAll(async () => {
    const book = await createBook({ title: 'Herbarium', floor: 0, slot: 0 });
    bookId = book.id;
    const target = await createPage({
      bookId,
      doc: doc(heading('Photosynthesis', 1), paragraph(text('light into sugar'))),
    });
    targetId = target.id;
    const source = await createPage({
      bookId,
      doc: doc(heading('Monday', 2), paragraph(text('start here'))),
    });
    sourceId = source.id;
  });

  it('finds nothing before anything links', async () => {
    bumpLinkGraph();
    expect(await loadBacklinks(targetId)).toEqual([]);
  });

  it('offers other pages as link targets, never the page itself', async () => {
    const targets = await loadLinkTargets({ query: 'photo', fromPageId: sourceId });
    expect(targets.map((card) => card.pageId)).toContain(targetId);
    const all = await loadLinkTargets({ query: '', fromPageId: sourceId, limit: 20 });
    expect(all.map((card) => card.pageId)).not.toContain(sourceId);
  });

  it('lists the source once the link is saved', async () => {
    await savePageDoc(
      sourceId,
      doc(
        heading('Monday', 2),
        paragraph(text('see '), pageLink(targetId, 'Photosynthesis', bookId)),
      ),
    );
    bumpLinkGraph();

    const back = await loadBacklinks(targetId);
    expect(back).toHaveLength(1);
    expect(back[0]!.pageId).toBe(sourceId);
    expect(back[0]!.title).toBe('Monday');
    expect(back[0]!.bookTitle).toBe('Herbarium');

    expect((await loadOutgoingLinks(sourceId)).map((c) => c.pageId)).toEqual([
      targetId,
    ]);
  });

  it('renames the chip when the target page is renamed', async () => {
    await savePageDoc(
      targetId,
      doc(heading('Photosynthesis, revisited', 1), paragraph(text('light into sugar'))),
    );
    bumpLinkGraph();
    const card = await loadPageCard(targetId);
    // The document still stores the old label; what the chip DRAWS is this.
    expect(card?.title).toBe('Photosynthesis, revisited');
  });

  it('forgets the backlink when the link is taken out again', async () => {
    await savePageDoc(sourceId, doc(heading('Monday', 2), paragraph(text('never mind'))));
    bumpLinkGraph();
    expect(await loadBacklinks(targetId)).toEqual([]);
  });

  it('answers an empty page id without touching the database', async () => {
    expect(await loadBacklinks('')).toEqual([]);
    expect(await loadOutgoingLinks('')).toEqual([]);
  });
});
