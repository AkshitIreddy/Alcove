/**
 * tests/bookcases.test.ts — a library is a collection of bookcases.
 *
 * The four things that must not be got wrong:
 *
 *  1. **the migration** — every pre-bookcase book ends up in a case, exactly
 *     once, and re-running the migration (even with the version key wiped)
 *     changes nothing;
 *  2. **per-bookcase queries** — the shelf reads one case, the library-wide
 *     callers still read everything;
 *  3. **the floor default** — a fresh case is ten floors, and only grows when
 *     asked;
 *  4. **no leaking** — switching a bookcase cannot show the other case's
 *     books, not even for a frame.
 *
 * Every scenario runs on a fresh module registry so the MemoryDb singleton in
 * src/data/db.ts starts empty and the bookcase store's own caches are new.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------- harness ---------------------------------- */

async function freshLibrary() {
  vi.resetModules();
  const [books, bookcases, db, floors, constants, prefs] = await Promise.all([
    import('../src/data/books'),
    import('../src/data/bookcases'),
    import('../src/data/db'),
    import('../src/features/bookshelf/data'),
    import('../src/features/bookshelf/constants'),
    import('../src/features/bookshelf/libraryPrefs'),
  ]);
  return { books, bookcases, db, floors, constants, prefs };
}

type Library = Awaited<ReturnType<typeof freshLibrary>>;

/**
 * Insert a book the way the app did BEFORE bookcases existed: no
 * `bookcase_id` column at all. The browser stub stores exactly the columns it
 * is given, so this reproduces the orphan the migration has to adopt.
 */
async function insertLegacyBook(
  lib: Library,
  id: string,
  title: string,
  floor: number,
  slot: number,
): Promise<void> {
  const conn = await lib.db.getDb();
  const now = '2026-01-01T00:00:00.000Z';
  await conn.execute(
    'INSERT INTO books (id, title, floor, slot, spine_seed, cover_meta, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [id, title, floor, slot, 1234, null, now, now],
  );
}

async function setSetting(lib: Library, key: string, value: string): Promise<void> {
  const conn = await lib.db.getDb();
  await conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
    key,
    value,
  ]);
}

async function getSetting(lib: Library, key: string): Promise<string | null> {
  const conn = await lib.db.getDb();
  const rows = await conn.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [key],
  );
  return rows.length > 0 ? rows[0].value : null;
}

/** Re-run the migration as if the app had just started again. */
async function restart(lib: Library): Promise<void> {
  lib.bookcases.resetBookcaseMigrationForTests();
  await lib.bookcases.ensureBookcases();
  await lib.bookcases.loadBookcases();
}

beforeEach(() => {
  vi.resetModules();
});

/* ============================== the migration ============================= */

describe('bookcase migration (the one that must not lose a library)', () => {
  it('fresh install: one default case, ten floors, version recorded', async () => {
    const lib = await freshLibrary();
    const home = await lib.bookcases.ensureBookcases();

    expect(home.id).toBe(lib.books.DEFAULT_BOOKCASE_ID);
    expect(home.floors).toBe(lib.bookcases.DEFAULT_FLOOR_COUNT);
    expect(home.floors).toBe(10);
    expect(await lib.bookcases.listBookcaseRows()).toHaveLength(1);
    expect(await getSetting(lib, lib.bookcases.BOOKCASE_VERSION_KEY)).toBe(
      String(lib.bookcases.BOOKCASE_VERSION),
    );
  });

  it('adopts every pre-bookcase book into the default case', async () => {
    const lib = await freshLibrary();
    await insertLegacyBook(lib, 'legacy-a', 'Cell Biology', 0, 0);
    await insertLegacyBook(lib, 'legacy-b', 'Kanji Practice', 2, 4);
    await insertLegacyBook(lib, 'legacy-c', 'Someday Projects', 5, 9);

    await lib.bookcases.ensureBookcases();

    const adopted = await lib.books.listBooksInBookcase(
      lib.books.DEFAULT_BOOKCASE_ID,
    );
    expect(adopted.map((b) => b.id).sort()).toEqual([
      'legacy-a',
      'legacy-b',
      'legacy-c',
    ]);
    for (const book of adopted) {
      expect(book.bookcaseId).toBe(lib.books.DEFAULT_BOOKCASE_ID);
    }
    // And nothing was lost on the way: the library-wide query still sees all.
    expect(await lib.books.listBooksByFloorRange(0, 999)).toHaveLength(3);
  });

  it('keeps a library that already went deeper than ten floors', async () => {
    const lib = await freshLibrary();
    await insertLegacyBook(lib, 'deep', 'Letters Never Sent', 13, 2);

    const home = await lib.bookcases.ensureBookcases();
    // Floor 13 exists, so the case is 14 floors tall — not 10.
    expect(home.floors).toBe(14);
  });

  it('opens in the room the reader left (legacy `library` blob)', async () => {
    const lib = await freshLibrary();
    const legacyRoom = JSON.stringify({ theme: 'reef', shelf: 'blossom', wall: null });
    await setSetting(lib, 'library', legacyRoom);

    await lib.bookcases.ensureBookcases();
    const home = (await lib.bookcases.listBookcaseRows())[0];
    expect(home.room).toBe(legacyRoom);

    // …and the studio's view of it is the same room, validated.
    const applied = await lib.prefs.loadLibraryPrefs();
    expect(applied.theme).toBe('reef');
    expect(applied.shelf).toBe('blossom');
    expect(applied.wall).toBeNull();
  });

  it('is idempotent: five restarts change nothing', async () => {
    const lib = await freshLibrary();
    await insertLegacyBook(lib, 'legacy-a', 'Watercolor Basics', 1, 1);
    await insertLegacyBook(lib, 'legacy-b', 'Tea Tasting Journal', 3, 2);
    await lib.bookcases.ensureBookcases();

    const before = await lib.bookcases.listBookcaseRows();
    for (let i = 0; i < 5; i += 1) await restart(lib);

    const after = await lib.bookcases.listBookcaseRows();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].floors).toBe(before[0].floors);
    expect(after[0].room).toBe(before[0].room);
    // Still two books, each in exactly one case.
    const all = await lib.books.listBooksByFloorRange(0, 999);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((b) => b.bookcaseId))).toEqual(
      new Set([lib.books.DEFAULT_BOOKCASE_ID]),
    );
  });

  it('a wiped version key cannot clobber choices made since', async () => {
    const lib = await freshLibrary();
    await setSetting(lib, 'library', JSON.stringify({ theme: 'reef' }));
    await lib.bookcases.ensureBookcases();
    const home = (await lib.bookcases.listBookcaseRows())[0];

    // The reader renames the case, repaints it and grows it.
    await lib.bookcases.renameBookcase(home.id, 'Attic');
    await lib.bookcases.setBookcaseRoom(
      home.id,
      JSON.stringify({ theme: 'apothecary', shelf: null, wall: null }),
    );
    await lib.bookcases.setBookcaseFloors(home.id, 18);

    // Then the version key is lost (corrupt settings row, restored backup…).
    await setSetting(lib, lib.bookcases.BOOKCASE_VERSION_KEY, '0');
    await restart(lib);

    const again = (await lib.bookcases.listBookcaseRows())[0];
    expect(again.name).toBe('Attic');
    expect(again.floors).toBe(18);
    expect(JSON.parse(again.room ?? '{}').theme).toBe('apothecary');
  });

  it('sweeps an orphan created after the migration (reverted import)', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.ensureBookcases();
    // features/transfer re-inserts historical rows verbatim on a revert, and
    // a row from before the column existed comes back without one.
    await insertLegacyBook(lib, 'reverted', 'Dream Journal (do not read)', 4, 0);

    expect(
      (await lib.books.getBook('reverted'))?.bookcaseId,
    ).toBe(lib.books.DEFAULT_BOOKCASE_ID); // read-time fallback…

    await restart(lib); // …and the next start writes it down for real.
    const shelved = await lib.books.listBooksByFloorRange(
      0,
      999,
      lib.books.DEFAULT_BOOKCASE_ID,
    );
    expect(shelved.map((b) => b.id)).toContain('reverted');
  });
});

/* ========================= per-bookcase book queries ====================== */

describe('per-bookcase book queries', () => {
  it('scopes list / nextFreeSlot / maxOccupiedFloor to one case', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });
    const home = lib.books.DEFAULT_BOOKCASE_ID;

    await lib.books.createBook({ title: 'Home 0', bookcaseId: home, floor: 0, slot: 0 });
    await lib.books.createBook({ title: 'Home 1', bookcaseId: home, floor: 0, slot: 1 });
    await lib.books.createBook({ title: 'Home deep', bookcaseId: home, floor: 6, slot: 0 });
    await lib.books.createBook({ title: 'Attic 0', bookcaseId: attic.id, floor: 0, slot: 0 });

    const homeBooks = await lib.books.listBooksByFloorRange(0, 20, home);
    const atticBooks = await lib.books.listBooksByFloorRange(0, 20, attic.id);
    expect(homeBooks.map((b) => b.title).sort()).toEqual([
      'Home 0',
      'Home 1',
      'Home deep',
    ]);
    expect(atticBooks.map((b) => b.title)).toEqual(['Attic 0']);

    // Unscoped still means the whole library (quick switcher, export bundle).
    expect(await lib.books.listBooksByFloorRange(0, 20)).toHaveLength(4);

    // Each case has its own slot 0 — the attic's next free slot is 1, not 2.
    expect(await lib.books.nextFreeSlot(0, 0, home)).toBe(2);
    expect(await lib.books.nextFreeSlot(0, 0, attic.id)).toBe(1);

    expect(await lib.books.maxOccupiedFloor(home)).toBe(6);
    expect(await lib.books.maxOccupiedFloor(attic.id)).toBe(0);
  });

  it('a new book lands in the OPEN case when none is named', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });

    const inHome = await lib.books.createBook({ title: 'Before', floor: 0, slot: 0 });
    expect(inHome.bookcaseId).toBe(lib.books.DEFAULT_BOOKCASE_ID);

    await lib.bookcases.switchBookcase(attic.id);
    const inAttic = await lib.books.createBook({ title: 'After', floor: 0, slot: 0 });
    expect(inAttic.bookcaseId).toBe(attic.id);
  });

  it('duplicate and trash stay inside their own case', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });

    const source = await lib.books.createBook({
      title: 'Field Notes',
      bookcaseId: attic.id,
      floor: 1,
      slot: 3,
    });
    const copy = await lib.books.duplicateBook(source.id);
    expect(copy?.bookcaseId).toBe(attic.id);

    await lib.books.trashBook(source.id);
    expect(
      (await lib.books.listTrashedBooksIn(attic.id)).map((b) => b.id),
    ).toEqual([source.id]);
    expect(await lib.books.listTrashedBooksIn(lib.books.DEFAULT_BOOKCASE_ID)).toEqual(
      [],
    );
    // The library-wide drawer (what the trash panel shows) still sees it.
    expect((await lib.books.listTrashedBooks()).map((b) => b.id)).toContain(
      source.id,
    );

    // Restore puts it back in the case it came from.
    await lib.books.restoreBook(source.id);
    expect((await lib.books.getBook(source.id))?.bookcaseId).toBe(attic.id);
  });

  it('moves a book between cases onto a free slot', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });
    const home = lib.books.DEFAULT_BOOKCASE_ID;

    await lib.books.createBook({ title: 'Squatter', bookcaseId: attic.id, floor: 2, slot: 5 });
    const traveller = await lib.books.createBook({
      title: 'Traveller',
      bookcaseId: home,
      floor: 2,
      slot: 5,
    });

    const moved = await lib.books.moveBookToBookcase(traveller.id, attic.id);
    expect(moved?.bookcaseId).toBe(attic.id);
    expect(moved?.floor).toBe(2);
    expect(moved?.slot).toBe(6); // 5 was taken in the attic
    expect(await lib.books.listBooksByFloorRange(0, 9, home)).toHaveLength(0);
    expect(await lib.books.listBooksByFloorRange(0, 9, attic.id)).toHaveLength(2);
  });
});

/* ============================== floor defaults =========================== */

describe('floors: ten per bookcase, growing only on request', () => {
  it('a fresh case is ten floors and the shelf is no longer endless', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });
    expect(attic.floors).toBe(10);
    expect(lib.constants.DEFAULT_FLOOR_COUNT).toBe(10);
    // Ten floors of 320 world px, and no further.
    expect(lib.constants.caseBottomY(attic.floors)).toBe(10 * lib.constants.FLOOR_H);
  });

  it('addBookcaseFloor grows by one and persists', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });

    expect(await lib.bookcases.addBookcaseFloor(attic.id)).toBe(11);
    expect(await lib.bookcases.addBookcaseFloor(attic.id)).toBe(12);

    await restart(lib);
    const reread = (await lib.bookcases.listBookcaseRows()).find(
      (c) => c.id === attic.id,
    );
    expect(reread?.floors).toBe(12);
    // The other case did not grow with it.
    const home = (await lib.bookcases.listBookcaseRows()).find(
      (c) => c.id === lib.books.DEFAULT_BOOKCASE_ID,
    );
    expect(home?.floors).toBe(10);
  });

  it('clamps nonsense floor counts instead of trusting them', async () => {
    const lib = await freshLibrary();
    const { clampFloorCount, MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } = lib.bookcases;
    expect(clampFloorCount(10)).toBe(10);
    expect(clampFloorCount(0)).toBe(MIN_FLOOR_COUNT);
    expect(clampFloorCount(-4)).toBe(MIN_FLOOR_COUNT);
    expect(clampFloorCount(9999)).toBe(MAX_FLOOR_COUNT);
    expect(clampFloorCount(Number.NaN)).toBe(10);
    expect(clampFloorCount('nonsense')).toBe(10);
    expect(clampFloorCount(7.6)).toBe(8);
  });

  it('yMaxFor stops at the plinth, never above Y_MIN', async () => {
    const lib = await freshLibrary();
    const { yMaxFor, caseFootY, BASE_CLEARANCE, FLOOR_H, BASE_H, Y_MIN } = lib.constants;
    // Ten floors plus the plinth board and a sliver of wall under it.
    expect(caseFootY(10)).toBe(10 * FLOOR_H + BASE_H);
    expect(yMaxFor(10, 800, 1)).toBe(10 * FLOOR_H + BASE_H + BASE_CLEARANCE - 800);
    // A case shorter than the screen has nowhere to scroll to.
    expect(yMaxFor(1, 4000, 1)).toBe(Y_MIN);
  });
});

/* ============================ switching bookcases ======================== */

describe('switching a bookcase does not leak books', () => {
  it('the floor store shows only the open case, both ways', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });
    const home = lib.books.DEFAULT_BOOKCASE_ID;

    await lib.books.createBook({ title: 'Home A', bookcaseId: home, floor: 0, slot: 0 });
    await lib.books.createBook({ title: 'Home B', bookcaseId: home, floor: 1, slot: 0 });
    await lib.books.createBook({ title: 'Attic A', bookcaseId: attic.id, floor: 0, slot: 0 });

    const store = new lib.floors.FloorStore();
    await store.init(home);
    const titlesOn = (floor: number): string[] =>
      (store.get(floor) ?? []).map((b) => b.title);

    expect(store.bookcaseId).toBe(home);
    expect(titlesOn(0)).toContain('Home A');
    expect(titlesOn(0)).not.toContain('Attic A');
    expect(titlesOn(1)).toEqual(['Home B']);

    await store.setBookcase(attic.id);
    expect(store.bookcaseId).toBe(attic.id);
    expect(titlesOn(0)).toEqual(['Attic A']);
    // Floor 1 held a home book a moment ago; the attic's floor 1 is bare.
    expect(titlesOn(1)).toEqual([]);
    expect(store.findBook('Home A')).toBeNull();

    await store.setBookcase(home);
    expect(titlesOn(0)).toContain('Home A');
    expect(titlesOn(0)).not.toContain('Attic A');
    store.destroy();
  });

  it('notifies every floor that was loaded, so mounted views empty out', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });
    await lib.books.createBook({
      title: 'Home A',
      bookcaseId: lib.books.DEFAULT_BOOKCASE_ID,
      floor: 3,
      slot: 0,
    });

    const store = new lib.floors.FloorStore();
    await store.init(lib.books.DEFAULT_BOOKCASE_ID);

    const notified: number[] = [];
    const off = store.onChange((floorIndices) => notified.push(...floorIndices));
    await store.setBookcase(attic.id);
    off();

    // Floor 3 was showing a book and must be told it is empty now.
    expect(notified).toContain(3);
    expect(store.get(3)).toEqual([]);
    store.destroy();
  });

  it('does not invent a demo library for a second, genuinely empty case', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });

    const store = new lib.floors.FloorStore();
    await store.init(lib.books.DEFAULT_BOOKCASE_ID);
    await store.setBookcase(attic.id);

    let total = 0;
    for (let floor = 0; floor < 8; floor += 1) total += (store.get(floor) ?? []).length;
    expect(total).toBe(0);
    store.destroy();
  });

  it('the room follows the case, and saving one never repaints the other', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic', theme: 'reef' });

    await lib.prefs.loadLibraryPrefs();
    await lib.prefs.saveLibraryPrefs({ theme: 'blossom' });
    expect(lib.prefs.snapshotLibraryPrefs().theme).toBe('blossom');

    await lib.bookcases.switchBookcase(attic.id);
    expect(lib.prefs.snapshotLibraryPrefs().theme).toBe('reef');

    await lib.bookcases.switchBookcase(lib.books.DEFAULT_BOOKCASE_ID);
    expect(lib.prefs.snapshotLibraryPrefs().theme).toBe('blossom');
    expect(lib.prefs.prefsForBookcase(attic.id).theme).toBe('reef');
  });
});

/* ================================ the API ================================ */

describe('the bookcase API the studio calls', () => {
  it('creates, renames and switches', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();

    const attic = await lib.bookcases.createBookcase();
    expect(attic.name).toBe('Bookcase 2');
    expect(lib.bookcases.snapshotBookcases().list).toHaveLength(2);
    // Creating does not open — that is a separate decision.
    expect(lib.bookcases.activeBookcaseId()).toBe(lib.books.DEFAULT_BOOKCASE_ID);

    await lib.bookcases.renameBookcase(attic.id, '  Attic  ');
    expect(
      lib.bookcases.snapshotBookcases().list.find((c) => c.id === attic.id)?.name,
    ).toBe('Attic');
    // An empty name is refused: the picker needs a label.
    await lib.bookcases.renameBookcase(attic.id, '   ');
    expect(
      lib.bookcases.snapshotBookcases().list.find((c) => c.id === attic.id)?.name,
    ).toBe('Attic');

    await lib.bookcases.switchBookcase(attic.id);
    expect(lib.bookcases.activeBookcaseId()).toBe(attic.id);
    expect(lib.bookcases.activeBookcase().name).toBe('Attic');
    expect(lib.bookcases.activeFloorCount()).toBe(10);

    // The choice survives a restart.
    await restart(lib);
    expect(lib.bookcases.activeBookcaseId()).toBe(attic.id);
  });

  it('switching to an id that does not exist is a no-op', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    await lib.bookcases.switchBookcase('case-nonexistent');
    expect(lib.bookcases.activeBookcaseId()).toBe(lib.books.DEFAULT_BOOKCASE_ID);
  });

  it('refuses to delete a case that still holds books, and says how many', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });
    await lib.books.createBook({ title: 'Kept', bookcaseId: attic.id, floor: 0, slot: 0 });
    await lib.books.createBook({ title: 'Also kept', bookcaseId: attic.id, floor: 0, slot: 1 });

    const refused = await lib.bookcases.deleteBookcase(attic.id);
    expect(refused).toEqual({ ok: false, reason: 'not-empty', bookCount: 2 });
    expect(lib.bookcases.snapshotBookcases().list).toHaveLength(2);
    expect(await lib.books.countBooksInBookcase(attic.id)).toBe(2);
  });

  it('deletes with its books (and their pages) when told to mean it', async () => {
    const lib = await freshLibrary();
    const pages = await import('../src/data/pages');
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });
    const doomed = await lib.books.createBook({
      title: 'Doomed',
      bookcaseId: attic.id,
      floor: 0,
      slot: 0,
    });
    await pages.createPage({ bookId: doomed.id });
    const survivor = await lib.books.createBook({
      title: 'Survivor',
      bookcaseId: lib.books.DEFAULT_BOOKCASE_ID,
      floor: 0,
      slot: 0,
    });

    const outcome = await lib.bookcases.deleteBookcase(attic.id, { withBooks: true });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.booksDeleted).toBe(1);

    expect(lib.bookcases.snapshotBookcases().list).toHaveLength(1);
    expect(await lib.books.getBook(doomed.id)).toBeNull();
    expect(await pages.listPages(doomed.id)).toEqual([]);
    // The other case is untouched.
    expect(await lib.books.getBook(survivor.id)).not.toBeNull();
  });

  it('never deletes the last bookcase', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const only = lib.bookcases.activeBookcaseId();
    const outcome = await lib.bookcases.deleteBookcase(only);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('last-bookcase');
    expect(lib.bookcases.snapshotBookcases().list).toHaveLength(1);
  });

  it('deleting the open case moves the reader to a neighbour', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const attic = await lib.bookcases.createBookcase({ name: 'Attic' });
    await lib.bookcases.switchBookcase(attic.id);
    expect(lib.bookcases.activeBookcaseId()).toBe(attic.id);

    const outcome = await lib.bookcases.deleteBookcase(attic.id);
    expect(outcome.ok).toBe(true);
    expect(lib.bookcases.activeBookcaseId()).toBe(lib.books.DEFAULT_BOOKCASE_ID);
    // Persisted, not just in memory.
    expect(await getSetting(lib, lib.books.ACTIVE_BOOKCASE_KEY)).toBe(
      lib.books.DEFAULT_BOOKCASE_ID,
    );
  });

  it('deleting an unknown case reports it rather than throwing', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    await lib.bookcases.createBookcase({ name: 'Attic' });
    const outcome = await lib.bookcases.deleteBookcase('case-nope');
    expect(outcome).toEqual({ ok: false, reason: 'unknown', bookCount: 0 });
  });

  it('names new cases around the ones already there', async () => {
    const lib = await freshLibrary();
    const { nextBookcaseName, defaultBookcase } = lib.bookcases;
    const one = defaultBookcase();
    expect(nextBookcaseName([one])).toBe('Bookcase 2');
    expect(nextBookcaseName([one, { ...one, id: 'x', name: 'Bookcase 2' }])).toBe(
      'Bookcase 3',
    );
  });

  it('gives each new case a room of its own', async () => {
    const lib = await freshLibrary();
    await lib.bookcases.loadBookcases();
    const second = await lib.bookcases.createBookcase();
    const third = await lib.bookcases.createBookcase();
    expect(second.room).not.toBeNull();
    expect(second.room).not.toBe(third.room);
    // …unless the caller asks to follow the app default.
    const plain = await lib.bookcases.createBookcase({ theme: null });
    expect(plain.room).toBeNull();
  });
});
