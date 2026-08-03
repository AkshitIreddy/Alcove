/**
 * tests/transfer-bookcases.test.ts — a bundle is a picture of a LIBRARY.
 *
 * tests/transfer.test.ts covers the pure half (the manifest, the plans). This
 * file drives the half that touches the database — `loadLibrarySnapshot`,
 * `applyImportPlan`, `revertRestorePoint` — because the bug this exists to
 * prevent only shows up there:
 *
 *  1. a two-case library exported and imported somewhere else arrived as ONE
 *     flat case, because the bundle carried a bookcase id and no way to build
 *     the bookcase;
 *  2. reverting an import re-inserted the historical book rows without their
 *     `bookcase_id`, so the start-up orphan sweep adopted them into whichever
 *     case sorts first — silently reshelving books a revert had promised to
 *     put back exactly as they were.
 *
 * Both are invisible: nothing throws, no row is lost, the library is just
 * quietly wrong. So the assertions here are all about WHERE things are.
 *
 * Every scenario runs on a fresh module registry, which gives the MemoryDb
 * singleton in src/data/db.ts an empty database and the bookcase store new
 * caches — that is what lets one test be the exporting machine and the next be
 * a machine that has never seen the library.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------- harness ---------------------------------- */

async function freshMachine() {
  vi.resetModules();
  const [books, bookcases, pages, db, library, scope, bundle, conflicts, store] =
    await Promise.all([
      import('../src/data/books'),
      import('../src/data/bookcases'),
      import('../src/data/pages'),
      import('../src/data/db'),
      import('../src/features/transfer/library'),
      import('../src/features/transfer/scope'),
      import('../src/features/transfer/bundle'),
      import('../src/features/transfer/conflicts'),
      import('../src/features/transfer/store'),
    ]);
  await bookcases.loadBookcases();
  return { books, bookcases, pages, db, library, scope, bundle, conflicts, store };
}

type Machine = Awaited<ReturnType<typeof freshMachine>>;

const OPTIONS = { losslessDocs: true } as const;

function docOf(title: string): { type: 'doc'; content: unknown[] } {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: title }],
      },
    ],
  };
}

/** Shelve a book with one page per title, in a named case. */
async function shelve(
  machine: Machine,
  bookcaseId: string,
  title: string,
  floor: number,
  pageTitles: string[],
): Promise<string> {
  const book = await machine.books.createBook({
    title,
    bookcaseId,
    floor,
    slot: 0,
  });
  for (const pageTitle of pageTitles) {
    await machine.pages.createPage({
      bookId: book.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc: docOf(pageTitle) as any,
    });
  }
  return book.id;
}

/** Build the .nbk contents `applyImportPlan` consumes, without any file I/O. */
function pack(machine: Machine, snapshot: ReturnType<never> | unknown) {
  const snap = snapshot as Parameters<typeof machine.scope.buildExportPlan>[0];
  const options = { ...machine.scope.DEFAULT_EXPORT_OPTIONS, ...OPTIONS };
  const plan = machine.scope.buildExportPlan(
    snap,
    machine.scope.resolveScopeSelection(snap, { kind: 'library' }),
    options,
  );
  const built = machine.bundle.buildBundleFiles({
    snapshot: snap,
    plan,
    options,
    label: 'The whole library',
    createdAt: '2026-08-03T09:00:00.000Z',
    appVersion: '0.1.0',
  });
  const texts = new Map<string, string>();
  const decoder = new TextDecoder();
  for (const entry of built.entries) {
    texts.set(entry.path, decoder.decode(entry.bytes));
  }
  return { exportPlan: plan, manifest: built.manifest, texts };
}

/** Run a whole import: plan every book, then apply it. */
async function importAll(
  machine: Machine,
  packed: { manifest: unknown; texts: Map<string, string> },
  source = 'library.nbk',
) {
  const manifest = packed.manifest as Parameters<
    typeof machine.conflicts.buildImportPlan
  >[0];
  const snapshot = await machine.library.loadLibrarySnapshot();
  const plan = machine.conflicts.buildImportPlan(
    manifest,
    machine.conflicts.buildLibraryIndex(snapshot),
    {
      pages: machine.conflicts.selectAllPages(manifest),
      resolutions: new Map(),
    },
  );
  return machine.library.applyImportPlan(
    { manifest, texts: packed.texts },
    plan,
    source,
  );
}

/** Case name → the titles of the books standing in it, sorted. */
async function shelfMap(machine: Machine): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const bookcase of await machine.bookcases.listBookcaseRows()) {
    const inside = await machine.books.listBooksInBookcase(bookcase.id);
    out[bookcase.name] = inside.map((b) => b.title).sort();
  }
  return out;
}

/**
 * A two-case library, ready to export: an empty default case plus "Study" and
 * "Kitchen", each with its own room, height and books.
 *
 * The default case stays empty on purpose. Every library has `case-default`,
 * so a bundle whose books came from it would be adopted by id anywhere and the
 * interesting path — furniture that has to be BUILT — would never run.
 */
async function twoCaseMachine(): Promise<Machine> {
  const machine = await freshMachine();
  const study = await machine.bookcases.createBookcase({
    name: 'Study',
    floors: 12,
  });
  const kitchen = await machine.bookcases.createBookcase({
    name: 'Kitchen',
    floors: 8,
  });
  await machine.bookcases.setBookcaseRoom(
    study.id,
    JSON.stringify({ theme: 'parchment', shelf: null, wall: null }),
  );
  await shelve(machine, study.id, 'Cell biology', 3, ['Mitosis', 'Meiosis']);
  await shelve(machine, kitchen.id, 'Sourdough', 0, ['Starter']);
  return machine;
}

/* ------------------------------ the round trip ---------------------------- */

describe('a two-case library survives export → import', () => {
  let packed: Awaited<ReturnType<typeof pack>>;

  beforeEach(async () => {
    const source = await twoCaseMachine();
    packed = pack(source, await source.library.loadLibrarySnapshot());
  });

  it('exports the furniture the books stood on', () => {
    expect(packed.manifest.bookcases.map((c) => c.name)).toEqual([
      'Study',
      'Kitchen',
    ]);
    // The empty default case has no books, so it does not travel.
    expect(packed.manifest.bookcases).toHaveLength(2);
    expect(packed.manifest.bookcases[0].floors).toBe(12);
  });

  /* THE test. A machine that has never seen this library gets it back whole. */
  it('rebuilds both bookcases on a machine that has never seen them', async () => {
    const target = await freshMachine();
    expect(await target.bookcases.listBookcaseRows()).toHaveLength(1);

    const outcome = await importAll(target, packed);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.createdBookcaseIds).toHaveLength(2);

    const cases = await target.bookcases.listBookcaseRows();
    expect(cases.map((c) => c.name).sort()).toEqual([
      'Kitchen',
      'My Library',
      'Study',
    ]);
    expect(await shelfMap(target)).toEqual({
      'My Library': [],
      Study: ['Cell biology'],
      Kitchen: ['Sourdough'],
    });
  });

  it('a rebuilt case keeps its height and its room', async () => {
    const target = await freshMachine();
    await importAll(target, packed);
    const cases = await target.bookcases.listBookcaseRows();
    const study = cases.find((c) => c.name === 'Study');
    const kitchen = cases.find((c) => c.name === 'Kitchen');
    expect(study?.floors).toBe(12);
    expect(kitchen?.floors).toBe(8);
    expect(JSON.parse(study?.room ?? 'null')).toMatchObject({ theme: 'parchment' });
  });

  /*
   * Which floor, not just which case. A rebuilt case is empty and arrived with
   * its own height, so there is nothing to pack around — the books go back
   * where they stood. Packing them from the top instead turned a study whose
   * books sat on floors 3 and 9 into two books on floors 1 and 2, which is a
   * different room from the one that was exported.
   */
  it('a rebuilt case puts its books back on the floors they stood on', async () => {
    const target = await freshMachine();
    await importAll(target, packed);
    const study = (await target.bookcases.listBookcaseRows()).find(
      (c) => c.name === 'Study',
    );
    const inside = await target.books.listBooksInBookcase(study!.id);
    expect(inside.map((b) => [b.title, b.floor])).toEqual([['Cell biology', 3]]);
  });

  /*
   * The other half of that rule. A case already standing here is someone's
   * room, and an arriving book joins the shelf under the deepest book already
   * in it rather than at whatever depth another library used — which could be
   * a screenful of empty floors below anything the reader owns.
   */
  it('books joining a case already standing here stack under its books', async () => {
    const target = await freshMachine();
    const study = await target.bookcases.createBookcase({
      name: 'Study',
      floors: 12,
    });
    await shelve(target, study.id, 'My own notes', 0, ['Page one']);
    const roomBefore = study.room;

    await importAll(target, packed);
    const inside = await target.books.listBooksInBookcase(study.id);
    expect(inside.find((b) => b.title === 'Cell biology')?.floor).toBe(1);
    /*
     * And the reader's own room survives the arrival. An adopted case is
     * furniture they already own: the bundle's Study was pinned to
     * `theme: parchment`, and repainting someone's room because a book moved
     * into it is the destructive act this feature promises never to commit.
     */
    const after = (await target.bookcases.listBookcaseRows()).find(
      (c) => c.id === study.id,
    );
    expect(after?.room).toBe(roomBefore);
    expect(after?.room ?? '').not.toContain('parchment');
  });

  it('every imported book lands on a floor its case actually draws', async () => {
    const target = await freshMachine();
    await importAll(target, packed);
    for (const bookcase of await target.bookcases.listBookcaseRows()) {
      for (const book of await target.books.listBooksInBookcase(bookcase.id)) {
        expect(book.floor).toBeGreaterThanOrEqual(0);
        expect(book.floor).toBeLessThan(bookcase.floors);
      }
    }
  });

  it('no imported book is left without a case for the orphan sweep to find', async () => {
    const target = await freshMachine();
    await importAll(target, packed);
    const conn = await target.db.getDb();
    const rows = await conn.select<Array<{ id: string; bookcase_id?: string | null }>>(
      'SELECT * FROM books',
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(typeof row.bookcase_id).toBe('string');
      expect(row.bookcase_id).not.toBe('');
    }
  });

  /*
   * The same bundle twice. Ids are private to a library, so the second import
   * cannot match on them — it matches on the name, and the reader ends up with
   * two copies of each book in ONE "Study", not two bookcases called "Study".
   */
  it('importing the same bundle twice fills one Study, not two', async () => {
    const target = await freshMachine();
    await importAll(target, packed);
    await importAll(target, packed);
    const names = (await target.bookcases.listBookcaseRows()).map((c) => c.name);
    expect(names.sort()).toEqual(['Kitchen', 'My Library', 'Study']);
    expect(await shelfMap(target)).toEqual({
      'My Library': [],
      Study: ['Cell biology', 'Cell biology (2)'],
      Kitchen: ['Sourdough', 'Sourdough (2)'],
    });
  });

  /* Back into the library it came from: the ids match, so nothing is built. */
  it('re-importing into its own library builds no new furniture', async () => {
    const source = await twoCaseMachine();
    const own = pack(source, await source.library.loadLibrarySnapshot());
    const before = (await source.bookcases.listBookcaseRows()).length;

    const outcome = await importAll(source, own);
    expect(outcome.createdBookcaseIds).toEqual([]);
    expect(await source.bookcases.listBookcaseRows()).toHaveLength(before);
    // A same-id clash defaults to "add as new", not "rename": the copy is a
    // second copy of a book this library already has, and the reader compares
    // the two rather than being handed a title they never chose.
    expect(await shelfMap(source)).toEqual({
      'My Library': [],
      Study: ['Cell biology', 'Cell biology'],
      Kitchen: ['Sourdough', 'Sourdough'],
    });
  });
});

/* --------------------------- older bundles still work --------------------- */

describe('bundles that predate the case list', () => {
  it('lands in the active case, exactly as it did before', async () => {
    const source = await twoCaseMachine();
    const packed = pack(source, await source.library.loadLibrarySnapshot());

    // Strip the manifest back to what a schema-2 writer produced: book rows
    // still cite a case id, but there is nothing to build one from.
    const older = {
      ...(JSON.parse(JSON.stringify(packed.manifest)) as Record<string, unknown>),
      schemaVersion: 2,
      bookcases: [],
    };
    const { parseManifest } = await import('../src/features/transfer/format');
    const manifest = parseManifest(older).manifest;
    expect(manifest).not.toBeNull();

    const target = await freshMachine();
    const outcome = await importAll(target, { manifest, texts: packed.texts });
    expect(outcome.createdBookcaseIds).toEqual([]);
    expect(await shelfMap(target)).toEqual({
      'My Library': ['Cell biology', 'Sourdough'],
    });
  });

  it('a bundle with no case recorded at all still imports', async () => {
    const source = await twoCaseMachine();
    const packed = pack(source, await source.library.loadLibrarySnapshot());
    const raw = JSON.parse(JSON.stringify(packed.manifest)) as {
      schemaVersion: number;
      bookcases: unknown[];
      books: Array<Record<string, unknown>>;
    };
    raw.schemaVersion = 1;
    raw.bookcases = [];
    for (const book of raw.books) delete book.bookcaseId;

    const { parseManifest } = await import('../src/features/transfer/format');
    const manifest = parseManifest(raw).manifest;
    const target = await freshMachine();
    await importAll(target, { manifest, texts: packed.texts });
    expect(await shelfMap(target)).toEqual({
      'My Library': ['Cell biology', 'Sourdough'],
    });
  });
});

/* --------------------------------- revert --------------------------------- */

describe('reverting an import puts the library back', () => {
  it('takes down the bookcases the import built', async () => {
    const source = await twoCaseMachine();
    const packed = pack(source, await source.library.loadLibrarySnapshot());
    const target = await freshMachine();
    const outcome = await importAll(target, packed);

    const revert = await target.library.revertRestorePoint(
      outcome.restorePoint.id,
    );
    expect(revert?.removedBooks).toBe(2);
    expect(revert?.removedBookcases).toBe(2);
    expect((await target.bookcases.listBookcaseRows()).map((c) => c.name)).toEqual([
      'My Library',
    ]);
    expect(await target.books.listBooksByFloorRange(0, 9999)).toHaveLength(0);
  });

  /*
   * A restore point is written before the first mutation so a crash mid-import
   * is still undoable — and building a bookcase IS a mutation. Recorded only in
   * the final patch, an import that died between the carpentry and the books
   * left cases standing that no revert could find: furniture the reader never
   * asked for, with no way to take it down from the history panel.
   *
   * The interruption is staged at the database, by refusing the very first
   * `INSERT INTO books` — which is exactly where a real one (a disk error, a
   * closed window) lands: after the cases exist, before anything stands on
   * them.
   */
  it('records the furniture it built before shelving anything on it', async () => {
    const source = await twoCaseMachine();
    const packed = pack(source, await source.library.loadLibrarySnapshot());

    const target = await freshMachine();
    const conn = await target.db.getDb();
    const realExecute = conn.execute.bind(conn);
    conn.execute = async (query: string, binds?: unknown[]) => {
      if (query.startsWith('INSERT INTO books')) throw new Error('interrupted');
      return realExecute(query, binds);
    };
    try {
      await expect(importAll(target, packed)).rejects.toThrow('interrupted');
    } finally {
      conn.execute = realExecute;
    }

    // The cases are real, and the newest point knows their ids.
    expect(await target.bookcases.listBookcaseRows()).toHaveLength(3);
    const point = (await target.store.loadHistory()).points[0];
    expect(point.createdBookcases).toHaveLength(2);

    const revert = await target.library.revertRestorePoint(point.id);
    expect(revert?.removedBookcases).toBe(2);
    expect((await target.bookcases.listBookcaseRows()).map((c) => c.name)).toEqual([
      'My Library',
    ]);
  });

  it('keeps a built bookcase the reader has since put their own book in', async () => {
    const source = await twoCaseMachine();
    const packed = pack(source, await source.library.loadLibrarySnapshot());
    const target = await freshMachine();
    const outcome = await importAll(target, packed);

    const study = (await target.bookcases.listBookcaseRows()).find(
      (c) => c.name === 'Study',
    );
    expect(study).toBeDefined();
    await shelve(target, study!.id, 'My own notes', 0, ['Page one']);

    const revert = await target.library.revertRestorePoint(
      outcome.restorePoint.id,
    );
    expect(revert?.removedBookcases).toBe(1);
    expect(await shelfMap(target)).toEqual({
      'My Library': [],
      Study: ['My own notes'],
    });
  });

  /*
   * The second bug. A revert restores the book rows it snapshotted, and that
   * statement was missing `bookcase_id` — so a book that had stood in "Kitchen"
   * for a year came back belonging to no case at all, and the next start-up
   * swept it into whichever case sorts first.
   */
  it('restores a merged book to the case it actually stood in', async () => {
    const machine = await twoCaseMachine();
    const kitchen = (await machine.bookcases.listBookcaseRows()).find(
      (c) => c.name === 'Kitchen',
    );
    expect(kitchen).toBeDefined();

    // A bundle holding one book with the SAME title, merged into the existing
    // one — which is what makes the revert snapshot the reader's book row.
    const donor = await freshMachine();
    const donorCase = await donor.bookcases.createBookcase({ name: 'Somewhere' });
    await shelve(donor, donorCase.id, 'Sourdough', 0, ['Rye variation']);
    const packed = pack(donor, await donor.library.loadLibrarySnapshot());

    const manifest = packed.manifest as Parameters<
      typeof machine.conflicts.buildImportPlan
    >[0];
    const snapshot = await machine.library.loadLibrarySnapshot();
    const plan = machine.conflicts.buildImportPlan(
      manifest,
      machine.conflicts.buildLibraryIndex(snapshot),
      {
        pages: machine.conflicts.selectAllPages(manifest),
        resolutions: new Map([[manifest.books[0].id, 'merge' as const]]),
      },
    );
    expect(plan.books[0].action).toBe('append');

    const outcome = await machine.library.applyImportPlan(
      { manifest, texts: packed.texts },
      plan,
      'donor.nbk',
    );
    await machine.library.revertRestorePoint(outcome.restorePoint.id);

    const conn = await machine.db.getDb();
    const rows = await conn.select<
      Array<{ id: string; title: string; bookcase_id?: string | null }>
    >('SELECT * FROM books');
    const restored = rows.find((r) => r.title === 'Sourdough');
    expect(restored?.bookcase_id).toBe(kitchen!.id);
    // And nothing anywhere is waiting on the orphan sweep.
    for (const row of rows) expect(typeof row.bookcase_id).toBe('string');
    expect(await shelfMap(machine)).toEqual({
      'My Library': [],
      Study: ['Cell biology'],
      Kitchen: ['Sourdough'],
    });
  });

  /*
   * Undo the undo. The case the revert took down has to come back — otherwise
   * the books it puts back are orphans, which is the very bug this file exists
   * for, arrived at from the other direction.
   */
  it('undoing a revert brings the bookcase back with its books', async () => {
    const source = await twoCaseMachine();
    const packed = pack(source, await source.library.loadLibrarySnapshot());
    const target = await freshMachine();
    const imported = await importAll(target, packed);

    const undone = await target.library.revertRestorePoint(
      imported.restorePoint.id,
    );
    expect(undone?.restorePoint).not.toBeNull();
    expect(await target.bookcases.listBookcaseRows()).toHaveLength(1);

    await target.library.revertRestorePoint(undone!.restorePoint!.id);

    expect(await shelfMap(target)).toEqual({
      'My Library': [],
      Study: ['Cell biology'],
      Kitchen: ['Sourdough'],
    });
    const conn = await target.db.getDb();
    const rows = await conn.select<Array<{ bookcase_id?: string | null }>>(
      'SELECT * FROM books',
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(typeof row.bookcase_id).toBe('string');
  });
});
