// @vitest-environment node
/**
 * tests/data-seed.test.ts — the welcome-book seed + its two migrations:
 *
 *  - isEmptyPageDoc(): what counts as "no user content"
 *  - isDeletableDemoBook(): kept/deleted decision matrix
 *  - welcome content: 4-6 pages, warning-free Notebook Script, real nodes
 *  - WELCOME_BINDING: the authored binding, and that it is a valid style
 *  - seedIfEmpty(): end-to-end migration against the in-memory dev DB
 *    (old demo books deleted only when pristine, welcome book created once,
 *    seedVersion recorded) and fresh-install seeding.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LEGACY_WELCOME_BOOK_TITLE,
  OLD_DEMO_TITLES,
  SEED_VERSION,
  SEED_VERSION_KEY,
  WELCOME_BINDING,
  WELCOME_BOOK_TITLE,
  WELCOME_PAGE_SOURCES,
  WELCOME_SPINE_SEED,
  buildWelcomePageDocs,
  isDeletableDemoBook,
  isEmptyPageDoc,
} from '../src/data/seed';
import { normalizeBookStyleOverrides } from '../src/art/bookStyle';
import { clothForPalette } from '../src/art/spines';
import { parse } from '../src/script';
import type { PageDoc } from '../src/data/types';

/* ------------------------------ doc helpers ------------------------------- */

const emptyDoc = (): PageDoc => ({ type: 'doc', content: [] });
const noContentKeyDoc = (): PageDoc => ({ type: 'doc' });
const emptyParagraphDoc = (): PageDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { id: 'b_x' } }],
});
const textDoc = (text: string): PageDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const headingDoc = (): PageDoc => ({
  type: 'doc',
  content: [{ type: 'heading', attrs: { level: 1 }, content: [] }],
});

/* ------------------------------ pure logic -------------------------------- */

describe('isEmptyPageDoc', () => {
  it('treats missing/empty content as empty', () => {
    expect(isEmptyPageDoc(emptyDoc())).toBe(true);
    expect(isEmptyPageDoc(noContentKeyDoc())).toBe(true);
  });

  it('treats content-less paragraphs (autosaved blank page) as empty', () => {
    expect(isEmptyPageDoc(emptyParagraphDoc())).toBe(true);
    expect(
      isEmptyPageDoc({
        type: 'doc',
        content: [
          { type: 'paragraph' },
          { type: 'paragraph', content: [] },
        ],
      }),
    ).toBe(true);
  });

  it('treats any text or non-paragraph block as content', () => {
    expect(isEmptyPageDoc(textDoc('hello'))).toBe(false);
    expect(isEmptyPageDoc(headingDoc())).toBe(false);
    expect(
      isEmptyPageDoc({
        type: 'doc',
        content: [{ type: 'paragraph' }, { type: 'horizontalRule' }],
      }),
    ).toBe(false);
  });
});

describe('isDeletableDemoBook (kept/deleted matrix)', () => {
  const demoTitle = OLD_DEMO_TITLES[0];

  it('deletes: old demo title + all pages empty', () => {
    expect(isDeletableDemoBook(demoTitle, [emptyDoc()])).toBe(true);
    expect(
      isDeletableDemoBook(demoTitle, [emptyDoc(), emptyParagraphDoc()]),
    ).toBe(true);
  });

  it('deletes: old demo title + zero pages', () => {
    expect(isDeletableDemoBook(demoTitle, [])).toBe(true);
  });

  it('keeps: old demo title with any written page', () => {
    expect(isDeletableDemoBook(demoTitle, [textDoc('my notes')])).toBe(false);
    expect(
      isDeletableDemoBook(demoTitle, [emptyDoc(), textDoc('x')]),
    ).toBe(false);
  });

  it('keeps: titles that are not in the old demo list', () => {
    expect(isDeletableDemoBook('My Own Ideas', [emptyDoc()])).toBe(false);
    expect(isDeletableDemoBook('', [emptyDoc()])).toBe(false);
  });

  it('keeps: the welcome book itself, always', () => {
    expect(isDeletableDemoBook(WELCOME_BOOK_TITLE, [emptyDoc()])).toBe(false);
  });

  it('covers every old demo title', () => {
    expect(OLD_DEMO_TITLES).toHaveLength(24);
    for (const title of OLD_DEMO_TITLES) {
      expect(isDeletableDemoBook(title, [emptyDoc()])).toBe(true);
      expect(isDeletableDemoBook(title, [textDoc('kept')])).toBe(false);
    }
  });
});

/* --------------------------- welcome content ------------------------------ */

describe('welcome book content', () => {
  it('has 4-6 pages', () => {
    expect(WELCOME_PAGE_SOURCES.length).toBeGreaterThanOrEqual(4);
    expect(WELCOME_PAGE_SOURCES.length).toBeLessThanOrEqual(6);
  });

  it('every page parses as warning-free Notebook Script', () => {
    for (const source of WELCOME_PAGE_SOURCES) {
      const doc = parse(source);
      expect(doc.diagnostics).toEqual([]);
      expect(doc.blocks.length).toBeGreaterThan(0);
    }
  });

  it('maps every page to a non-empty editor document', () => {
    const pages = buildWelcomePageDocs();
    expect(pages).toHaveLength(WELCOME_PAGE_SOURCES.length);
    for (const page of pages) {
      expect(page.doc.type).toBe('doc');
      expect(page.doc.content?.length ?? 0).toBeGreaterThan(0);
      expect(page.source.length).toBeGreaterThan(0);
      expect(isEmptyPageDoc(page.doc)).toBe(false);
    }
  });

  it('includes a real diagram node (showcase page)', () => {
    const pages = buildWelcomePageDocs();
    const types = new Set<string>();
    const walk = (nodes: unknown[]): void => {
      for (const n of nodes) {
        if (n === null || typeof n !== 'object') continue;
        const node = n as { type?: unknown; content?: unknown[] };
        if (typeof node.type === 'string') types.add(node.type);
        if (Array.isArray(node.content)) walk(node.content);
      }
    };
    for (const page of pages) walk(page.doc.content ?? []);
    expect(types.has('diagram')).toBe(true);
    // Effects showcase containers made it through as real nodes too.
    expect(types.has('sticky-note')).toBe(true);
    expect(types.has('callout')).toBe(true);
  });
});

describe('WELCOME_BINDING', () => {
  /**
   * The normalizer DROPS fields it does not recognise rather than throwing, so
   * a typo in the authored binding would not fail anywhere — the book would
   * just quietly go back to following the room, which is the bland default the
   * binding exists to replace. Every key has to survive the round trip.
   */
  it('survives normalization with every field intact', () => {
    const normalized = normalizeBookStyleOverrides({ ...WELCOME_BINDING });
    expect(normalized).not.toBeNull();
    expect(normalized).toMatchObject(WELCOME_BINDING);
    // Nothing may be DROPPED. The normalizer is allowed to ADD — setting
    // `format` derives the band's mid `height` — so this checks for silent
    // loss rather than pinning the exact key set.
    for (const key of Object.keys(WELCOME_BINDING)) {
      expect(normalized).toHaveProperty(key);
    }
  });

  /**
   * Pin the CLOTH, not the pigment index.
   *
   * "pigment !== 0" was the first version of this test and it passed while the
   * book shipped the wrong colour: twenty pigment names fold onto six flat
   * cloths, and the oxblood that was authored came out as terracotta — the
   * same cloth every unstyled book on the shelf already wears. The index is
   * not the thing anyone can see, so it is not the thing worth asserting.
   */
  it('lands on a cloth that is not the unstyled default', () => {
    const cloth = clothForPalette(WELCOME_BINDING.pigment as number);
    expect(cloth).toBe(2); // plum
    expect(cloth).not.toBe(clothForPalette(0)); // not amber→ochre
    expect(cloth).not.toBe(0); // not terracotta, the commonest cloth
  });

  it('derives a stable spine seed from the current title', () => {
    expect(WELCOME_SPINE_SEED).toBe(WELCOME_SPINE_SEED >>> 0);
    expect(Number.isInteger(WELCOME_SPINE_SEED)).toBe(true);
  });
});

describe('the rename migration', () => {
  it('keeps the legacy welcome title distinct from the current one', () => {
    expect(LEGACY_WELCOME_BOOK_TITLE).not.toBe(WELCOME_BOOK_TITLE);
  });

  /**
   * The legacy title is the identity check for libraries seeded before the
   * rename. If the demo cleanup treated it as deletable, a v2 library would
   * lose the welcome book it already had.
   */
  it('never deletes a legacy welcome book as a stale demo', () => {
    expect(isDeletableDemoBook(LEGACY_WELCOME_BOOK_TITLE, [emptyDoc()])).toBe(false);
  });
});

/* ------------------------- end-to-end migration ---------------------------- */

/**
 * Fresh module registry per scenario so the MemoryDb singleton in
 * src/data/db.ts starts empty each time (node env => isTauri() is false).
 */
async function freshDataLayer() {
  vi.resetModules();
  const [seed, books, pages, db] = await Promise.all([
    import('../src/data/seed'),
    import('../src/data/books'),
    import('../src/data/pages'),
    import('../src/data/db'),
  ]);
  return { seed, books, pages, db };
}

describe('seedIfEmpty (in-memory end-to-end)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('fresh install: creates only the welcome book and records the version', async () => {
    const { seed, books, pages, db } = await freshDataLayer();

    await expect(seed.seedIfEmpty()).resolves.toBe(true);

    const shelved = await books.listBooksByFloorRange(0, 999);
    expect(shelved).toHaveLength(1);
    const welcome = shelved[0];
    expect(welcome.title).toBe(seed.WELCOME_BOOK_TITLE);
    expect(welcome.floor).toBe(0);
    expect(welcome.spineSeed).toBe(seed.WELCOME_SPINE_SEED);

    const welcomePages = await pages.listPages(welcome.id);
    expect(welcomePages).toHaveLength(seed.WELCOME_PAGE_SOURCES.length);
    for (const page of welcomePages) {
      expect(page.scriptSource).not.toBeNull();
      expect(seed.isEmptyPageDoc(page.doc)).toBe(false);
    }

    const conn = await db.getDb();
    const rows = await conn.select<Array<{ value: string }>>(
      'SELECT value FROM settings WHERE key = $1 LIMIT 1',
      [seed.SEED_VERSION_KEY],
    );
    expect(rows).toEqual([{ value: String(seed.SEED_VERSION) }]);

    // Second run is a no-op.
    await expect(seed.seedIfEmpty()).resolves.toBe(false);
    expect(await books.listBooksByFloorRange(0, 999)).toHaveLength(1);
  });

  it('v1 install: deletes pristine demo books, keeps written + user books', async () => {
    const { seed, books, pages } = await freshDataLayer();

    // Simulate the old v1 seed plus some user activity.
    const pristine = await books.createBook({
      title: 'Cell Biology',
      floor: 0,
      slot: 0,
    });
    await pages.createPage({ bookId: pristine.id, ord: 0 });

    const written = await books.createBook({
      title: 'SQL Spellbook',
      floor: 1,
      slot: 8,
    });
    await pages.createPage({ bookId: written.id, ord: 0 });
    const writtenPage = (await pages.listPages(written.id))[0];
    await pages.savePageDoc(writtenPage.id, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'SELECT *' }] },
      ],
    });

    const userBook = await books.createBook({
      title: 'My Own Ideas',
      floor: 2,
      slot: 1,
    });
    await pages.createPage({ bookId: userBook.id, ord: 0 });

    await expect(seed.seedIfEmpty()).resolves.toBe(true);

    const shelved = await books.listBooksByFloorRange(0, 999);
    const titles = shelved.map((b) => b.title).sort();
    expect(titles).toEqual(
      ['My Own Ideas', 'SQL Spellbook', seed.WELCOME_BOOK_TITLE].sort(),
    );

    // The pristine demo book's pages are gone with it.
    expect(await pages.listPages(pristine.id)).toEqual([]);
    // The written demo book kept its content.
    const keptPage = (await pages.listPages(written.id))[0];
    expect(seed.isEmptyPageDoc(keptPage.doc)).toBe(false);
  });

  it('welcome book already present (partial migration): not duplicated', async () => {
    const { seed, books } = await freshDataLayer();

    await books.createBook({
      title: seed.WELCOME_BOOK_TITLE,
      floor: 0,
      slot: 3,
    });

    // Welcome existed already, so this run created nothing.
    await expect(seed.seedIfEmpty()).resolves.toBe(false);
    const shelved = await books.listBooksByFloorRange(0, 999);
    expect(
      shelved.filter((b) => b.title === seed.WELCOME_BOOK_TITLE),
    ).toHaveLength(1);
  });

  /**
   * The v2 → v3 hazard, and the reason the rename is a migration rather than a
   * constant edit: a library seeded before the app was renamed holds the OLD
   * welcome title. Change the constant without handling that and the existence
   * check finds nothing, so every existing reader gets a second welcome book
   * on the shelf next to the one they have been writing in.
   */
  it('v2 install: retitles the welcome book in place, does not duplicate it', async () => {
    const { seed, books, pages } = await freshDataLayer();

    const legacy = await books.createBook({
      title: seed.LEGACY_WELCOME_BOOK_TITLE,
      floor: 0,
      slot: 3,
    });
    // The reader wrote in it — this book is theirs now, not ours to replace.
    await pages.createPage({ bookId: legacy.id, ord: 0 });
    const page = (await pages.listPages(legacy.id))[0];
    await pages.savePageDoc(page.id, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'my notes' }] },
      ],
    });

    await expect(seed.seedIfEmpty()).resolves.toBe(false);

    const shelved = await books.listBooksByFloorRange(0, 999);
    expect(shelved).toHaveLength(1);
    expect(shelved[0].id).toBe(legacy.id);
    expect(shelved[0].title).toBe(seed.WELCOME_BOOK_TITLE);

    // Their writing survived the retitle.
    const kept = (await pages.listPages(legacy.id))[0];
    expect(seed.isEmptyPageDoc(kept.doc)).toBe(false);
  });
});

// Re-exported constants stay wired (guards against accidental renames).
it('exports the current seed version constants', () => {
  expect(SEED_VERSION).toBe(3);
  expect(SEED_VERSION_KEY).toBe('seedVersion');
});
