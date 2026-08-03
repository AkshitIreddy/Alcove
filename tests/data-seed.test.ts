// @vitest-environment node
/**
 * tests/data-seed.test.ts — the welcome-book seed and every migration on it:
 *
 *  - isEmptyPageDoc(): what counts as "no user content"
 *  - isDeletableDemoBook(): kept/deleted decision matrix
 *  - welcome content: warning-free Notebook Script, real nodes, pages that
 *    fit on a leaf, and `[[…]]` references that resolve to pages of this book
 *  - WELCOME_BINDING: the authored binding, and that it is a valid style
 *  - isReplaceableWelcomeBook(): the v4 -> v5 decision, which is the one that
 *    can destroy somebody's writing if it is wrong
 *  - seedIfEmpty(): end-to-end against the in-memory dev DB — fresh install,
 *    the v1 demo cleanup, every past rename, and the v5 page swap on a
 *    library that already has a welcome book AND a book of the reader's own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LEGACY_WELCOME_BOOK_TITLE,
  LEGACY_WELCOME_BOOK_TITLES,
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
  isReplaceableWelcomeBook,
  isUnchangedSeededPage,
  welcomePageTitles,
  docFromSeededSource,
  LEGACY_WELCOME_PAGE_SOURCES,
} from '../src/data/seed';
import {
  PAGE_LINE_BUDGET,
  blockLineCost,
} from '../src/features/templates/split';
import { normalizeBookStyleOverrides } from '../src/art/bookStyle';
import { clothForPalette } from '../src/art/spines';
import { CLOTHS, CLOTH_LABELS } from '../src/art/flat';
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

/** Every node type the built welcome book actually contains. */
function welcomeNodeTypes(ids?: {
  bookId: string;
  pageIds: readonly string[];
}): Set<string> {
  const types = new Set<string>();
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes) {
      if (n === null || typeof n !== 'object') continue;
      const node = n as { type?: unknown; content?: unknown[] };
      if (typeof node.type === 'string') types.add(node.type);
      if (Array.isArray(node.content)) walk(node.content);
    }
  };
  for (const page of buildWelcomePageDocs(ids)) walk(page.doc.content ?? []);
  return types;
}

/** Every `pageLink` node in the built book, with ids supplied. */
function resolvedPageLinks(): number {
  const pageIds = WELCOME_PAGE_SOURCES.map((_, i) => `page-${i}`);
  let count = 0;
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes) {
      if (n === null || typeof n !== 'object') continue;
      const node = n as { type?: unknown; content?: unknown[] };
      if (node.type === 'pageLink') count += 1;
      if (Array.isArray(node.content)) walk(node.content);
    }
  };
  for (const page of buildWelcomePageDocs({ bookId: 'book-1', pageIds })) {
    walk(page.doc.content ?? []);
  }
  return count;
}

describe('welcome book content', () => {
  it('is a proper tour, not a leaflet', () => {
    expect(WELCOME_PAGE_SOURCES.length).toBeGreaterThanOrEqual(10);
    expect(WELCOME_PAGE_SOURCES.length).toBeLessThanOrEqual(24);
  });

  /**
   * The book that teaches the language may not be written in slop — and this
   * is also the widest test the language has, because these pages reach into
   * nearly all of it.
   */
  it('every page parses as warning-free Notebook Script', () => {
    for (const source of WELCOME_PAGE_SOURCES) {
      const doc = parse(source);
      expect(doc.diagnostics, `page: ${source.slice(0, 60)}`).toEqual([]);
      expect(doc.blocks.length).toBeGreaterThan(0);
    }
  });

  /**
   * Leaves are fixed height and overflow FLOWS onward, so a page written past
   * its capacity does not clip — it rearranges the tour the first time anybody
   * opens the book. That is not hypothetical: pages authored at ~30 estimated
   * lines pushed their tails forward and left blank leaves behind, measured in
   * `shots-now/welcome-tour.mjs`, which is what this budget is calibrated from.
   */
  it('every page fits on a leaf', () => {
    const titles = welcomePageTitles();
    WELCOME_PAGE_SOURCES.forEach((source, i) => {
      const cost = parse(source).blocks.reduce(
        (n, block) => n + blockLineCost(block),
        0,
      );
      expect(
        cost,
        `page ${i + 1} "${titles[i]}" is too long for one leaf`,
      ).toBeLessThanOrEqual(PAGE_LINE_BUDGET);
    });
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

  /**
   * The showcase is the entire point of this book, and every one of these
   * arrives ONLY if `EDITOR_NODE_NAMES` in seed.ts knows about it. A name
   * missing from that set is not an error — it is a silent downgrade to a
   * paragraph, so nothing but a list like this one would ever notice.
   */
  it('contains a real node for everything it claims to show', () => {
    const types = welcomeNodeTypes();
    for (const type of [
      'diagram',
      'sticky-note',
      'callout',
      'banner',
      'card',
      'index-card',
      'quote-card',
      'envelope',
      'tag',
      'marginalia',
      'pressed-flower',
      'ticket-stub',
      'postcard',
      'wax-seal',
      'map-pin',
      'polaroid',
      'imageRow',
      'image',
      'columns',
      'col',
      'spoiler',
      'table',
      'taskList',
      // The four this rewrite exists for: an equation, maths in a sentence,
      // a note at the foot of the page, and a fold.
      'math',
      'mathInline',
      'footnote',
      'details',
    ]) {
      expect(types.has(type), `no ${type} node in the welcome book`).toBe(true);
    }
  });

  /**
   * `[[Maths, in a notebook hand]]` has to match page three's heading
   * character for character. When it does not the reference degrades to plain
   * words — which is the right behaviour and completely invisible, so counting
   * is the only way to know the backlinks page demonstrates anything at all.
   */
  it('resolves every [[page reference]] against its own pages', () => {
    const written =
      WELCOME_PAGE_SOURCES.join('\n').match(/\[\[[^\]]+\]\]/g) ?? [];
    expect(written.length).toBeGreaterThan(0);
    expect(resolvedPageLinks()).toBe(written.length);
  });

  /** With no ids there is nothing to point at, and the words survive instead. */
  it('degrades a page reference to its own words when nothing resolves', () => {
    expect(welcomeNodeTypes().has('pageLink')).toBe(false);
    expect(JSON.stringify(buildWelcomePageDocs())).toContain(
      'Maths, in a notebook hand',
    );
  });

  it('gives every page a title, and no two the same', () => {
    const titles = welcomePageTitles();
    expect(titles).toHaveLength(WELCOME_PAGE_SOURCES.length);
    for (const title of titles) expect(title.length).toBeGreaterThan(0);
    expect(new Set(titles).size).toBe(titles.length);
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
   * Pin the CLOTH, not the pigment index — and pin it by NAME AND HEX.
   *
   * "pigment !== 0" was the first version of this test and it passed while the
   * book shipped the wrong colour: the pigment names fold onto the flat cloths
   * through a table, and the oxblood that was authored came out as terracotta
   * — the same cloth every unstyled book on the shelf already wears. The index
   * is not the thing anyone can see, so it is not the thing worth asserting.
   *
   * The version after that pinned the raw slot (`toBe(2) // plum`), and that
   * went stale the moment `art/flat.ts` grew from six cloths to fifty: the
   * trailing `% CLOTHS.length` in `clothForPalette` stopped wrapping, so
   * pigment 20 stopped landing on slot 2 and started landing on slot 42. The
   * BOOK did not change colour — slot 42 is Claret `#a44c60`, exactly what
   * `seed.ts` authored and photographed — only the number did. So assert the
   * cloth's identity (its label and its two hexes), which is what a reader
   * sees, and let the slot be wherever the table puts it.
   */
  it('lands on a cloth that is not the unstyled default', () => {
    const cloth = clothForPalette(WELCOME_BINDING.pigment as number);
    expect(CLOTH_LABELS[cloth]).toBe('Claret');
    expect(CLOTHS[cloth]).toEqual(['#a44c60', '#8e3e53']);
    expect(cloth).not.toBe(clothForPalette(0)); // not whatever Amber paints
    expect(cloth).not.toBe(0); // not slot 0, the commonest cloth
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

/* --------------------- v4 -> v5: replace, or leave alone ------------------ */

/**
 * The decision that can destroy somebody's writing if it is wrong, so it is
 * tested from both sides: what it agrees to replace, and — far more important
 * — everything it refuses to touch.
 */
describe('isReplaceableWelcomeBook (the v5 swap decision)', () => {
  const seeded = () =>
    buildWelcomePageDocs().map((page) => ({
      scriptSource: page.source,
      doc: page.doc,
    }));

  it('replaces a book that is still exactly what was seeded', () => {
    expect(isReplaceableWelcomeBook(seeded())).toBe(true);
  });

  /**
   * Simply OPENING a page saves it once, because TipTap's UniqueID extension
   * mints a block id for every block that has none. That is why the decision
   * ignores `source_dirty` and compares documents with ids stripped: a book
   * the reader has merely LOOKED at must still count as untouched.
   */
  it('replaces a book whose blocks have picked up ids from being opened', () => {
    const withIds = seeded().map((page) => ({
      ...page,
      doc: {
        ...page.doc,
        content: (page.doc.content ?? []).map((node, i) => ({
          ...(node as Record<string, unknown>),
          attrs: {
            ...((node as { attrs?: Record<string, unknown> }).attrs ?? {}),
            id: `b_opened${i}`,
          },
        })),
      } as PageDoc,
    }));
    expect(isReplaceableWelcomeBook(withIds)).toBe(true);
  });

  it('replaces a book with a blank leaf somebody added and never filled', () => {
    expect(
      isReplaceableWelcomeBook([
        ...seeded(),
        { scriptSource: null, doc: emptyDoc() },
      ]),
    ).toBe(true);
  });

  it('refuses a book with one written page in it', () => {
    const pages = seeded();
    pages[2] = { scriptSource: pages[2].scriptSource, doc: textDoc('my notes') };
    expect(isReplaceableWelcomeBook(pages)).toBe(false);
  });

  it('refuses a book with an extra page the reader wrote', () => {
    expect(
      isReplaceableWelcomeBook([
        ...seeded(),
        { scriptSource: null, doc: textDoc('a shopping list') },
      ]),
    ).toBe(false);
  });

  it('refuses a page whose source is not one we ever shipped', () => {
    expect(
      isUnchangedSeededPage({
        scriptSource: '# Something the reader inserted',
        doc: textDoc('Something the reader inserted'),
      }),
    ).toBe(false);
  });

  it('refuses an empty book (nothing to recognise it by)', () => {
    expect(isReplaceableWelcomeBook([])).toBe(false);
    expect(
      isReplaceableWelcomeBook([{ scriptSource: null, doc: emptyDoc() }]),
    ).toBe(false);
  });
});

/* ------------------------- end-to-end migration ---------------------------- */

/**
 * Every title the welcome book has ever had, for the table-driven migration
 * case below. Read from the module rather than listed here so appending a
 * rename to `LEGACY_WELCOME_BOOK_TITLES` extends the test for free — a second
 * copy of the list is a second place to forget one.
 */
function seedTitlesForTest(): readonly string[] {
  return LEGACY_WELCOME_BOOK_TITLES;
}

/** The v4 welcome book, exactly as the v4 seeder wrote it. */
function legacyWelcomeSources(): readonly string[] {
  return LEGACY_WELCOME_PAGE_SOURCES;
}

const docFromLegacySource = docFromSeededSource;

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

  /**
   * The case a single legacy constant could not express, and the reason it is a
   * list now.
   *
   * Two renames in (Notebook → Bellanote → Alcove), a library that skipped the
   * middle one is sitting on the OLDEST title. Migrating only the most recent
   * old name leaves that book unrecognised — and unrecognised is precisely the
   * state that seeds a duplicate next to it.
   *
   * Runs over EVERY past title rather than naming one, so a third rename is
   * covered by appending to the list and nothing else.
   */
  /**
   * The v4 -> v5 case, and the one this rewrite exists for.
   *
   * A library that already ran the old seed is holding the five-page welcome
   * book AND a book the reader wrote themselves. The migration has to swap the
   * first for the new sixteen-page tour and not go anywhere near the second —
   * same book row, same id, same spine, new pages.
   */
  it('v4 install: swaps the old welcome pages, leaves the reader’s book alone', async () => {
    const { seed, books, pages, db } = await freshDataLayer();
    const conn = await db.getDb();

    // A library exactly as v4 left it: the old welcome book, verbatim.
    const welcome = await books.createBook({
      title: seed.WELCOME_BOOK_TITLE,
      floor: 0,
      slot: 3,
      spineSeed: seed.WELCOME_SPINE_SEED,
    });
    const oldSources = legacyWelcomeSources();
    for (let i = 0; i < oldSources.length; i += 1) {
      await pages.createPage({
        bookId: welcome.id,
        ord: i,
        doc: docFromLegacySource(oldSources[i]),
        scriptSource: oldSources[i],
      });
    }

    // …and a book of their own, with something in it.
    const theirs = await books.createBook({
      title: 'Recipes I actually make',
      floor: 1,
      slot: 2,
    });
    await pages.createPage({ bookId: theirs.id, ord: 0 });
    const theirPage = (await pages.listPages(theirs.id))[0];
    await pages.savePageDoc(theirPage.id, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'lemon, thyme' }] },
      ],
    });
    await conn.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      [seed.SEED_VERSION_KEY, '4'],
    );

    // Nothing was CREATED — the welcome book was already there.
    await expect(seed.seedIfEmpty()).resolves.toBe(false);

    // Same book row, new pages.
    const shelved = await books.listBooksByFloorRange(0, 999);
    expect(shelved.map((b) => b.title).sort()).toEqual(
      ['Recipes I actually make', seed.WELCOME_BOOK_TITLE].sort(),
    );
    const same = shelved.find((b) => b.title === seed.WELCOME_BOOK_TITLE);
    expect(same?.id).toBe(welcome.id);
    expect(same?.spineSeed).toBe(seed.WELCOME_SPINE_SEED);

    const fresh = await pages.listPages(welcome.id);
    expect(fresh).toHaveLength(seed.WELCOME_PAGE_SOURCES.length);
    expect(fresh.map((p) => p.scriptSource)).toEqual([
      ...seed.WELCOME_PAGE_SOURCES,
    ]);
    // The new pages are real documents, and their references resolved.
    expect(JSON.stringify(fresh.map((p) => p.doc))).toContain('pageLink');

    // Their book is untouched, down to the page id.
    const theirsAfter = await pages.listPages(theirs.id);
    expect(theirsAfter).toHaveLength(1);
    expect(theirsAfter[0].id).toBe(theirPage.id);
    expect(seed.isEmptyPageDoc(theirsAfter[0].doc)).toBe(false);
    expect(JSON.stringify(theirsAfter[0].doc)).toContain('lemon, thyme');
  });

  /**
   * The other half of the same decision, and the one worth being strict about:
   * a reader who wrote in their welcome book keeps every word of it, and the
   * nicer tour is simply not installed. A small loss against the alternative.
   */
  it('v4 install: a welcome book that was written in is left completely alone', async () => {
    const { seed, books, pages, db } = await freshDataLayer();
    const conn = await db.getDb();

    const welcome = await books.createBook({
      title: seed.WELCOME_BOOK_TITLE,
      floor: 0,
      slot: 3,
    });
    const oldSources = legacyWelcomeSources();
    for (let i = 0; i < oldSources.length; i += 1) {
      await pages.createPage({
        bookId: welcome.id,
        ord: i,
        doc: docFromLegacySource(oldSources[i]),
        scriptSource: oldSources[i],
      });
    }
    // They wrote on page two.
    const before = await pages.listPages(welcome.id);
    await pages.savePageDoc(before[1].id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'note to self: buy stamps' }],
        },
      ],
    });
    await conn.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      [seed.SEED_VERSION_KEY, '4'],
    );

    await expect(seed.seedIfEmpty()).resolves.toBe(false);

    const after = await pages.listPages(welcome.id);
    expect(after).toHaveLength(oldSources.length);
    expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
    expect(JSON.stringify(after[1].doc)).toContain('buy stamps');
  });

  it.each([...seedTitlesForTest()])(
    'a library still on %s is retitled, not duplicated',
    async (oldTitle: string) => {
      const { seed, books, pages } = await freshDataLayer();

      const legacy = await books.createBook({ title: oldTitle, floor: 0, slot: 3 });
      await pages.createPage({ bookId: legacy.id, ord: 0 });
      const page = (await pages.listPages(legacy.id))[0];
      await pages.savePageDoc(page.id, {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'years of notes' }] }],
      });

      await expect(seed.seedIfEmpty()).resolves.toBe(false);

      const shelved = await books.listBooksByFloorRange(0, 999);
      expect(shelved, `a second welcome book appeared beside the ${oldTitle} one`).toHaveLength(1);
      expect(shelved[0].id).toBe(legacy.id);
      expect(shelved[0].title).toBe(seed.WELCOME_BOOK_TITLE);
      expect(seed.isEmptyPageDoc((await pages.listPages(legacy.id))[0].doc)).toBe(false);
    },
  );
});

// Re-exported constants stay wired (guards against accidental renames).
it('exports the current seed version constants', () => {
  expect(SEED_VERSION).toBe(5);
  expect(SEED_VERSION_KEY).toBe('seedVersion');
});
