/**
 * tests/search.test.ts — group C search & navigation unit tests.
 *
 * Pure logic (extract / fuzzy / rank) plus the search-index data layer
 * running against the in-memory dev stub (node env → MemoryDb).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { extractPageText } from '../src/search/extract';
import { fuzzyMatch } from '../src/search/fuzzy';
import { buildSnippet, scoreContent, tokenize } from '../src/search/rank';
import {
  ensureIndexFresh,
  indexPage,
  loadIndex,
  removePageIndex,
  searchContent,
} from '../src/data/search';
import { createBook } from '../src/data/books';
import { createPage, savePageDoc } from '../src/data/pages';
import type { PageDoc } from '../src/data/types';

// ---------------------------------------------------------------------------
// Doc builders
// ---------------------------------------------------------------------------

const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (value: string) => ({
  type: 'paragraph',
  content: [text(value)],
});
const heading = (value: string, level: number) => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const doc = (...content: unknown[]): PageDoc => ({ type: 'doc', content });

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------

describe('extractPageText', () => {
  it('flattens blocks to newline-separated text', () => {
    const out = extractPageText(
      doc(heading('Welcome', 1), paragraph('hello world'), paragraph('again')),
    );
    expect(out.text).toBe('Welcome\nhello world\nagain');
  });

  it('collects headings with levels, including nested ones', () => {
    const out = extractPageText(
      doc(heading('Top', 1), {
        type: 'callout',
        content: [heading('Inner note', 3), paragraph('body')],
      }),
    );
    expect(out.headings).toEqual([
      { text: 'Top', level: 1 },
      { text: 'Inner note', level: 3 },
    ]);
  });

  it('joins marked/split inline text without gluing blocks together', () => {
    const out = extractPageText(
      doc(
        {
          type: 'paragraph',
          content: [
            text('slash '),
            { type: 'text', text: 'menu', marks: [{ type: 'bold' }] },
          ],
        },
        paragraph('next'),
      ),
    );
    expect(out.text).toBe('slash menu\nnext');
  });

  it('never throws on malformed docs', () => {
    expect(extractPageText(null).text).toBe('');
    expect(extractPageText({ type: 'doc' }).text).toBe('');
    expect(
      extractPageText({ type: 'doc', content: [null, 42, 'x'] as unknown[] })
        .text,
    ).toBe('');
  });
});

// ---------------------------------------------------------------------------
// fuzzy
// ---------------------------------------------------------------------------

describe('fuzzyMatch', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyMatch('wlcm', 'Welcome to Alcove')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'Welcome to Alcove')).toBeNull();
  });

  it('ranks prefix > word-start > mid-word substring > scattered', () => {
    const prefix = fuzzyMatch('note', 'Notebook Script')!.score;
    const wordStart = fuzzyMatch('note', 'My Notebook')!.score;
    const scattered = fuzzyMatch('note', 'nap over tea elf')!.score;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(scattered);
  });

  it('prefers consecutive runs over scattered letters', () => {
    const tight = fuzzyMatch('diag', 'Diagrams')!.score;
    const loose = fuzzyMatch('diag', 'dog citrus algae grid')!.score;
    expect(tight).toBeGreaterThan(loose);
  });

  it('empty query matches everything with score 0', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });
});

// ---------------------------------------------------------------------------
// rank
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('lowercases, splits and dedupes', () => {
    expect(tokenize('Slash MENU slash!')).toEqual(['slash', 'menu']);
  });
});

describe('scoreContent', () => {
  const page = {
    text: 'press / on an empty line to open the slash menu',
    headings: [{ text: 'Writing', level: 1 }],
  };

  it('is 0 when no term matches, positive otherwise', () => {
    expect(scoreContent(page, ['zebra'], 'zebra')).toBe(0);
    expect(scoreContent(page, ['slash'], 'slash')).toBeGreaterThan(0);
  });

  it('rewards exact phrases and heading hits', () => {
    const phrase = scoreContent(page, ['slash', 'menu'], 'slash menu');
    const scattered = scoreContent(page, ['slash', 'menu'], 'menu … slash');
    expect(phrase).toBeGreaterThan(scattered);

    const headingHit = scoreContent(page, ['writing'], 'writing');
    const bodyOnly = scoreContent(page, ['empty'], 'empty');
    expect(headingHit).toBeGreaterThan(0);
    expect(bodyOnly).toBeGreaterThan(0);
  });
});

describe('buildSnippet', () => {
  const long =
    'aaa '.repeat(40) +
    'the quick brown fox jumps over the lazy dog ' +
    'zzz '.repeat(40);

  it('windows around the first hit and marks all matches', () => {
    const snippet = buildSnippet(long, ['fox', 'dog'])!;
    expect(snippet).not.toBeNull();
    const joined = snippet.segments.map((s) => s.text).join('');
    expect(joined).toContain('fox');
    expect(joined.length).toBeLessThan(200);
    const hits = snippet.segments.filter((s) => s.hit).map((s) => s.text);
    expect(hits).toContain('fox');
    expect(hits).toContain('dog');
    expect(snippet.leading).toBe(true);
    expect(snippet.trailing).toBe(true);
  });

  it('merges overlapping term hits', () => {
    const snippet = buildSnippet('notebooks everywhere', ['note', 'notebook'])!;
    const hits = snippet.segments.filter((s) => s.hit);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('notebook');
  });

  it('returns null when nothing matches', () => {
    expect(buildSnippet('hello world', ['zebra'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// data layer (MemoryDb stub)
// ---------------------------------------------------------------------------

describe('search index (in-memory db)', () => {
  let bookId = '';
  let pageId = '';

  beforeAll(async () => {
    const book = await createBook({ title: 'Field Notes', floor: 0, slot: 0 });
    bookId = book.id;
    const page = await createPage({
      bookId,
      doc: doc(heading('Birds', 1), paragraph('a wren sang at dawn')),
    });
    pageId = page.id;
  });

  it('ensureIndexFresh indexes pages created outside the save hook', async () => {
    await ensureIndexFresh(true);
    const rows = await loadIndex();
    const row = rows.find((r) => r.pageId === pageId);
    expect(row).toBeDefined();
    expect(row!.text).toContain('wren');
    expect(row!.headings).toEqual([{ text: 'Birds', level: 1 }]);
  });

  it('savePageDoc re-indexes through the hook (upsert, no duplicates)', async () => {
    await savePageDoc(
      pageId,
      doc(heading('Birds', 1), paragraph('a heron stood in the reeds')),
    );
    const rows = (await loadIndex()).filter((r) => r.pageId === pageId);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toContain('heron');
    expect(rows[0].text).not.toContain('wren');
  });

  it('searchContent ranks and snippets hits with the book title', async () => {
    const hits = await searchContent('heron reeds');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].pageId).toBe(pageId);
    expect(hits[0].bookTitle).toBe('Field Notes');
    const marked = hits[0].snippet.segments
      .filter((s) => s.hit)
      .map((s) => s.text.toLowerCase());
    expect(marked).toContain('heron');
  });

  it('searchContent returns nothing for empty/no-hit queries', async () => {
    expect(await searchContent('')).toEqual([]);
    expect(await searchContent('xylophone')).toEqual([]);
  });

  it('removePageIndex + freshness sweep drop orphans', async () => {
    await removePageIndex(pageId);
    expect((await loadIndex()).some((r) => r.pageId === pageId)).toBe(false);
    // Sweep re-indexes it (the page still exists)…
    await ensureIndexFresh(true);
    expect((await loadIndex()).some((r) => r.pageId === pageId)).toBe(true);
  });
});
