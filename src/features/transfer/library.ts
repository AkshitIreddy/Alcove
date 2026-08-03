/**
 * src/features/transfer/library.ts — the only file in this feature that talks
 * to the database.
 *
 * Reading:  `loadLibrarySnapshot()` mirrors books + pages + assets + theme
 *           into the plain `LibrarySnapshot` the pure modules consume.
 * Writing:  `applyImportPlan()` executes a plan additively and returns the
 *           restore point it recorded first; `revertRestorePoint()` undoes an
 *           import and records its own restore point so the revert is
 *           undoable in turn.
 *
 * Nothing here overwrites a user row on import: books are created (never
 * replaced) and pages are appended. The only path that ever writes over an
 * existing row is `revertRestorePoint`, and it writes a verbatim snapshot
 * back.
 */

import { nanoid } from 'nanoid';
import {
  DEFAULT_FLOOR_COUNT,
  activeBookcaseId,
  clampFloorCount,
  createBookcase,
  listBookcaseRows,
  loadBookcases,
  setBookcaseRoom,
  switchBookcase,
} from '../../data/bookcases';
import { getDb } from '../../data/db';
import {
  bookcaseOf,
  createBook,
  listBooksByFloorRange,
  nextFreeSlot,
  readActiveBookcaseId,
  updateBookPageCount,
} from '../../data/books';
import { createPage, listPages } from '../../data/pages';
import { settings } from '../../data/settings';
import type { PageDoc } from '../../data/types';
import { docToScript } from '../../editor/script/fromTiptap';
import type { BundleManifest, ManifestBook } from './format';
import { planBookcases, type BookcasePlan, type ImportPlan, type PlannedBook } from './conflicts';
import type {
  AssetSnapshot,
  BookSnapshot,
  BookcaseSnapshot,
  LibrarySnapshot,
  PageSnapshot,
} from './scope';
import {
  planRevert,
  type BookRowSnapshot,
  type BookcaseRowSnapshot,
  type CreatedPageRef,
  type LibraryRowIds,
  type PageRowSnapshot,
  type RestorePoint,
  type RevertPlan,
} from './restore';
import { addRestorePoint, getRestorePoint, patchRestorePoint } from './store';

// ---------------------------------------------------------------------------
// Pure doc helpers
// ---------------------------------------------------------------------------

interface DocNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

function nodeText(node: unknown): string {
  if (node === null || typeof node !== 'object') return '';
  const record = node as DocNode;
  if (typeof record.text === 'string') return record.text;
  if (!Array.isArray(record.content)) return '';
  return record.content.map(nodeText).join('');
}

/** First heading's text, else the first paragraph's, else "page N". */
export function pageTitleFromDoc(doc: PageDoc, index: number): string {
  const blocks = Array.isArray(doc.content) ? doc.content : [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue;
    if ((block as DocNode).type !== 'heading') continue;
    const text = nodeText(block).trim();
    if (text !== '') return text.slice(0, 80);
  }
  for (const block of blocks) {
    const text = nodeText(block).trim();
    if (text !== '') return text.slice(0, 60);
  }
  return `page ${index + 1}`;
}

/** Plain-text length of a document — the "how full" hint in the tree. */
export function docCharCount(doc: PageDoc): number {
  return nodeText({ content: doc.content ?? [] }).length;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

interface AssetRowLite {
  id: string;
  rel_path: string;
  kind: string;
  meta: string | null;
}

async function loadAssets(): Promise<AssetSnapshot[]> {
  try {
    const db = await getDb();
    const rows = await db.select<AssetRowLite[]>('SELECT * FROM assets');
    return rows.map((row) => {
      let meta: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = row.meta === null ? null : JSON.parse(row.meta);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        meta = null;
      }
      const size = meta?.bytes;
      return {
        id: row.id,
        relPath: row.rel_path,
        kind: row.kind,
        meta,
        // Unknown sizes estimate at 120 KB so the preview is not wildly low.
        bytes: typeof size === 'number' && Number.isFinite(size) ? size : 120_000,
      };
    });
  } catch {
    return [];
  }
}

/** The library-wide look, shipped when "include the library theme" is on. */
export function themeSnapshot(): Record<string, unknown> {
  return {
    theme: settings.theme,
    pageStyleDefault: settings.pageStyleDefault,
    inkColor: settings.inkColor,
    handwritingFont: settings.handwritingFont,
  };
}

/** Every bookcase in the library, in picker order. A broken read is []. */
async function loadBookcaseSnapshots(): Promise<BookcaseSnapshot[]> {
  return (await listBookcaseRows()).map((bookcase) => ({
    id: bookcase.id,
    name: bookcase.name,
    ord: bookcase.ord,
    room: bookcase.room,
    floors: bookcase.floors,
    createdAt: bookcase.createdAt,
    updatedAt: bookcase.updatedAt,
  }));
}

/** Read every shelved book (trash floor excluded) with its pages. */
export async function loadLibrarySnapshot(): Promise<LibrarySnapshot> {
  const books = await listBooksByFloorRange(0, 9999);
  const out: BookSnapshot[] = [];
  for (const book of books) {
    const pages = await listPages(book.id);
    const snapshots: PageSnapshot[] = pages.map((page, index) => ({
      id: page.id,
      bookId: book.id,
      ord: page.ord,
      title: pageTitleFromDoc(page.doc, index),
      script:
        page.scriptSource !== null && !page.sourceDirty
          ? page.scriptSource
          : docToScript(page.doc),
      docJson: JSON.stringify(page.doc),
      chars: docCharCount(page.doc),
    }));
    out.push({
      id: book.id,
      title: book.title,
      bookcaseId: book.bookcaseId ?? null,
      floor: book.floor,
      slot: book.slot,
      spineSeed: book.spineSeed,
      coverMeta: book.coverMeta,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
      pages: snapshots,
    });
  }
  return {
    bookcases: await loadBookcaseSnapshots(),
    books: out,
    assets: await loadAssets(),
    theme: themeSnapshot(),
  };
}

// ---------------------------------------------------------------------------
// Raw row access (revert needs verbatim rows, not model objects)
// ---------------------------------------------------------------------------

async function bookRows(ids: readonly string[]): Promise<BookRowSnapshot[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const out: BookRowSnapshot[] = [];
  for (const id of ids) {
    const rows = await db.select<BookRowSnapshot[]>(
      'SELECT * FROM books WHERE id = $1 LIMIT 1',
      [id],
    );
    if (rows.length > 0) out.push(rows[0]);
  }
  return out;
}

async function pageRowsOfBooks(ids: readonly string[]): Promise<PageRowSnapshot[]> {
  const db = await getDb();
  const out: PageRowSnapshot[] = [];
  for (const id of ids) {
    const rows = await db.select<PageRowSnapshot[]>(
      'SELECT * FROM pages WHERE book_id = $1 ORDER BY ord ASC',
      [id],
    );
    out.push(...rows);
  }
  return out;
}

async function pageRows(ids: readonly string[]): Promise<PageRowSnapshot[]> {
  const db = await getDb();
  const out: PageRowSnapshot[] = [];
  for (const id of ids) {
    const rows = await db.select<PageRowSnapshot[]>(
      'SELECT * FROM pages WHERE id = $1 LIMIT 1',
      [id],
    );
    if (rows.length > 0) out.push(rows[0]);
  }
  return out;
}

async function bookcaseRows(ids: readonly string[]): Promise<BookcaseRowSnapshot[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const out: BookcaseRowSnapshot[] = [];
  for (const id of ids) {
    const rows = await db.select<BookcaseRowSnapshot[]>(
      'SELECT * FROM bookcases WHERE id = $1 LIMIT 1',
      [id],
    );
    if (rows.length > 0) out.push(rows[0]);
  }
  return out;
}

/** Ids currently in the library — the "as it stands now" side of a revert. */
export async function currentRowIds(): Promise<LibraryRowIds> {
  const db = await getDb();
  const books = await db.select<Array<{ id: string; bookcase_id: string | null }>>(
    'SELECT * FROM books',
  );
  const pages = await db.select<Array<{ id: string }>>('SELECT id FROM pages');
  const bookcases = await db.select<Array<{ id: string }>>('SELECT id FROM bookcases');

  // Occupancy, counted the same way the shelf does: a row with no case reads
  // as the default case (`bookcaseOf`), so a book the orphan sweep has not got
  // to yet is still counted somewhere rather than nowhere.
  const bookCountByBookcase = new Map<string, number>();
  const bookcaseOfBook = new Map<string, string>();
  for (const row of books) {
    const home = bookcaseOf({ bookcaseId: row.bookcase_id ?? undefined });
    bookcaseOfBook.set(row.id, home);
    bookCountByBookcase.set(home, (bookCountByBookcase.get(home) ?? 0) + 1);
  }

  return {
    bookIds: new Set(books.map((row) => row.id)),
    pageIds: new Set(pages.map((row) => row.id)),
    bookcaseIds: new Set(bookcases.map((row) => row.id)),
    bookCountByBookcase,
    bookcaseOfBook,
  };
}

// ---------------------------------------------------------------------------
// Bundle page bodies → editor documents
// ---------------------------------------------------------------------------

let toTiptapCache: ((script: string) => PageDoc) | null = null;

/**
 * Script → editor JSON, using the REAL storage schema so containers and
 * diagrams become their true nodes. Loaded lazily (TipTap is heavy and the
 * pure modules must stay importable in a bare node test runner).
 */
async function scriptToDoc(script: string): Promise<PageDoc> {
  if (toTiptapCache === null) {
    const [{ getSchema }, { parse }, { scriptDocToTiptap }, { createEditorExtensions }] =
      await Promise.all([
        import('@tiptap/core'),
        import('../../script'),
        import('../../editor/script/toTiptap'),
        import('../../editor/extensions'),
      ]);
    const schema = getSchema(createEditorExtensions());
    toTiptapCache = (source: string) =>
      scriptDocToTiptap(parse(source), {
        hasNode: (name: string) => schema.nodes[name] !== undefined,
      });
  }
  return toTiptapCache(script);
}

function parseDocJson(text: string): PageDoc | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as { type?: unknown }).type === 'doc'
    ) {
      return parsed as PageDoc;
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface BundleContents {
  manifest: BundleManifest;
  /** Archive path → decoded text (page bodies, docs, theme). */
  texts: ReadonlyMap<string, string>;
  /** Archive path → raw bytes (assets). */
  binaries?: ReadonlyMap<string, Uint8Array>;
}

export interface ImportOutcome {
  restorePoint: RestorePoint;
  createdBookIds: string[];
  createdBookcaseIds: string[];
  createdPageCount: number;
  /** Book id to open once the panel closes, when there is an obvious one. */
  focusBookId: string | null;
  warnings: string[];
}

function manifestBookById(manifest: BundleManifest): Map<string, ManifestBook> {
  return new Map(manifest.books.map((book) => [book.id, book]));
}

/** How many floors a case here shows; the app default when it is not ours. */
interface BookcaseTarget {
  id: string;
  floors: number;
}

/**
 * Build every bookcase the import needs that is not already here, and return
 * the finished map from the bundle's case ids to this library's.
 *
 * Cases are made through `data/bookcases.createBookcase` rather than by
 * inserting a row from here, for two reasons: it is the only writer that keeps
 * the reactive store (and therefore the picker, the shelf and the studio) in
 * step, and it clamps name and floor count through the same validators a case
 * made by hand goes through. The consequence is that a rebuilt case gets a
 * FRESH id rather than the bundle's — which is right. Ids are private to a
 * library, two libraries can hold the same id for different furniture, and the
 * name is what a reader recognises. That is also why the plan matches on name
 * second: importing the same bundle twice fills one “Study”, not two.
 */
async function buildMissingBookcases(
  plan: BookcasePlan,
  warnings: string[],
): Promise<{
  targets: Map<string, BookcaseTarget>;
  created: string[];
}> {
  const targets = new Map<string, BookcaseTarget>();
  const created: string[] = [];

  const known = new Map((await listBookcaseRows()).map((c) => [c.id, c]));
  for (const [sourceId, localId] of plan.adopted) {
    const here = known.get(localId);
    if (here !== undefined) targets.set(sourceId, { id: here.id, floors: here.floors });
  }

  for (const source of plan.create) {
    try {
      const made = await createBookcase({
        name: source.name,
        floors: clampFloorCount(source.floors),
        // `theme: null` means "follow the app default" and is what a case with
        // no recorded room should open on. A case that HAS one gets it written
        // below — through the same setter the studio uses, so a blob this build
        // cannot parse still degrades to the default room instead of throwing.
        theme: null,
      });
      if (source.room !== null) await setBookcaseRoom(made.id, source.room);
      targets.set(source.id, { id: made.id, floors: made.floors });
      created.push(made.id);
    } catch {
      // A case that cannot be built is not a reason to lose its books: leave
      // it out of the map and they fall back to the active case.
      warnings.push(`could not build the bookcase “${source.name}”`);
    }
  }
  return { targets, created };
}

/**
 * Execute an import plan additively.
 *
 * Order matters: every row the operation will touch is snapshotted and the
 * restore point is written BEFORE the first mutation, so a crash mid-import
 * still leaves a usable undo entry.
 */
export async function applyImportPlan(
  contents: BundleContents,
  plan: ImportPlan,
  sourceName: string,
  now: Date = new Date(),
): Promise<ImportOutcome> {
  const warnings: string[] = [];
  const bookLookup = manifestBookById(contents.manifest);

  // --- snapshot the rows we are about to modify (append targets) ----------
  const appendTargets = plan.books
    .filter((book) => book.action === 'append' && book.targetBookId !== null)
    .map((book) => book.targetBookId as string);
  const priorBooks = await bookRows(appendTargets);

  const point: RestorePoint = {
    id: nanoid(),
    label: `Imported ${sourceName}`,
    createdAt: now.toISOString(),
    kind: 'import',
    source: sourceName,
    counts: {
      books: plan.counts.newBooks + plan.counts.appendedBooks,
      pages: plan.counts.pages,
    },
    createdBooks: [],
    createdPages: [],
    createdBookcases: [],
    priorBooks,
    priorPages: [],
    priorBookcases: [],
    revertOf: null,
    revertedAt: null,
    revertedBy: null,
  };
  await addRestorePoint(point, now);

  // --- the furniture, before anything is shelved on it --------------------
  /*
   * Cases come first because a book cannot be created without one. The plan is
   * the same pure function the panel showed in "what will happen", so what is
   * built here is what the reader was told would be built.
   */
  await loadBookcases();
  const casesHere = await listBookcaseRows();
  const casePlan = planBookcases(
    contents.manifest,
    plan,
    casesHere.map((c) => ({ id: c.id, name: c.name })),
  );
  const { targets: caseTargets, created: createdBookcases } =
    await buildMissingBookcases(casePlan, warnings);
  /*
   * The furniture is real now, so the undo entry has to know about it before
   * the first book is shelved on it. The point was written above with an empty
   * list because nothing had been built yet; leaving it empty until the final
   * patch would mean an import interrupted here leaves cases no revert can find
   * — furniture the reader never asked for and cannot take down from the
   * history panel.
   */
  if (createdBookcases.length > 0) {
    await patchRestorePoint(point.id, { createdBookcases }, now);
  }
  const rebuiltCases = new Set(createdBookcases);

  // Where a book with no resolvable case lands, and how tall that case is —
  // read from the same setting `createBook` consults, so the two agree.
  const fallbackHome = await readActiveBookcaseId();
  const fallbackFloors =
    casesHere.find((c) => c.id === fallbackHome)?.floors ?? DEFAULT_FLOOR_COUNT;

  // --- execute ------------------------------------------------------------
  const createdBooks: string[] = [];
  const createdPages: CreatedPageRef[] = [];
  let focusBookId: string | null = null;

  /*
   * One floor cursor PER CASE, not one for the library.
   *
   * A single cursor meant the second case's books started below the first
   * case's deepest book — in a case that may only be ten floors tall, which
   * put them on shelves that are not drawn. Each case fills from its own
   * highest occupied floor, and never past its own height.
   */
  const cursors = new Map<string, number>();
  for (const book of await listBooksByFloorRange(0, 9999)) {
    const home = bookcaseOf(book);
    cursors.set(home, Math.max(cursors.get(home) ?? 0, book.floor));
  }

  for (const planned of plan.books) {
    if (planned.action === 'skip') continue;
    const source = bookLookup.get(planned.sourceId);
    if (source === undefined) continue;

    let targetId = planned.targetBookId;
    if (planned.action === 'create') {
      /*
       * Where this book stands. `undefined` lets `createBook` fall back to the
       * active case, which is what a bundle that records no case at all gets —
       * and what a case that could not be matched or built falls back to.
       */
      const target = caseTargets.get(source.bookcaseId ?? '');
      const home = target?.id;
      const cursor = cursors.get(home ?? fallbackHome) ?? 0;
      // Never deeper than the case is tall: a book on a floor the case does
      // not draw is a book the reader cannot find.
      const ceiling = (target?.floors ?? fallbackFloors) - 1;
      /*
       * A case this import BUILT stands empty and came with its own height, so
       * its books go back on the floors they stood on — that is the whole point
       * of shipping the furniture, and packing them from the top instead turned
       * a study with books on floors 3, 7 and 9 into three books on floors 1, 2
       * and 3.
       *
       * Anywhere else the books are joining shelves that are already someone
       * else's, and there the cursor rule holds: land under the deepest book
       * already there rather than a screen's worth of empty floors below it.
       */
      const floor = rebuiltCases.has(home ?? '')
        ? Math.max(0, Math.min(source.floor, ceiling))
        : Math.max(0, Math.min(source.floor, cursor + 1, ceiling));
      const slot = await nextFreeSlot(floor, source.slot, home);
      const created = await createBook({
        title: planned.title,
        floor,
        slot,
        bookcaseId: home,
        spineSeed: source.spineSeed > 0 ? source.spineSeed : undefined,
        coverMeta: source.coverMeta,
      });
      cursors.set(bookcaseOf(created), Math.max(cursor, floor));
      targetId = created.id;
      createdBooks.push(created.id);
    }
    if (targetId === null) continue;
    focusBookId ??= targetId;

    for (const plannedPage of planned.pages) {
      const manifestPage = source.pages.find((page) => page.id === plannedPage.sourceId);
      if (manifestPage === undefined) continue;
      const body = contents.texts.get(manifestPage.file);
      const docText =
        manifestPage.docFile === null ? undefined : contents.texts.get(manifestPage.docFile);

      let doc: PageDoc | null = docText === undefined ? null : parseDocJson(docText);
      if (doc === null) {
        if (body === undefined) {
          warnings.push(`“${manifestPage.title}” had no body in the bundle — skipped`);
          continue;
        }
        try {
          doc = await scriptToDoc(body);
        } catch {
          warnings.push(`“${manifestPage.title}” could not be parsed — skipped`);
          continue;
        }
      }
      const page = await createPage({
        bookId: targetId,
        doc,
        scriptSource: body ?? null,
      });
      createdPages.push({ id: page.id, bookId: targetId });
    }
    await updateBookPageCount(targetId);
  }

  await importAssets(contents, warnings);

  const finalPoint: RestorePoint = {
    ...point,
    createdBooks,
    createdPages,
    createdBookcases,
    counts: { books: createdBooks.length + appendTargets.length, pages: createdPages.length },
  };
  await patchRestorePoint(point.id, finalPoint, now);

  return {
    restorePoint: finalPoint,
    createdBookIds: createdBooks,
    createdBookcaseIds: createdBookcases,
    createdPageCount: createdPages.length,
    focusBookId,
    warnings,
  };
}

/**
 * Additive asset import: only relPaths the library does not already know are
 * inserted, and bytes are written through the `bundle_write_asset` Rust
 * command when running in Tauri. Failures warn; they never abort an import.
 */
async function importAssets(
  contents: BundleContents,
  warnings: string[],
): Promise<void> {
  const assets = contents.manifest.assets;
  if (assets.length === 0) return;
  const db = await getDb();
  const existing = new Set(
    (
      await db.select<Array<{ rel_path: string }>>('SELECT rel_path FROM assets')
    ).map((row) => row.rel_path),
  );
  type Invoker = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  let invoke: Invoker | null = null;
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      invoke = (await import('@tauri-apps/api/core')).invoke as unknown as Invoker;
    } catch {
      invoke = null;
    }
  }
  for (const asset of assets) {
    if (existing.has(asset.relPath)) continue;
    const bytes = contents.binaries?.get(asset.file);
    if (bytes !== undefined && invoke !== null) {
      try {
        await invoke('bundle_write_asset', {
          relPath: asset.relPath,
          bytes: Array.from(bytes),
        });
      } catch {
        warnings.push(`could not save the asset “${asset.relPath}”`);
        continue;
      }
    } else if (bytes === undefined) {
      // Manifest-only asset (bundle exported without files): keep the row so
      // the reference resolves if the file shows up later.
      warnings.push(`“${asset.relPath}” was referenced but not included`);
    }
    await db.execute(
      'INSERT OR REPLACE INTO assets (id, rel_path, kind, meta, created_at) VALUES ($1, $2, $3, $4, $5)',
      [
        nanoid(),
        asset.relPath,
        asset.kind,
        asset.meta === null ? null : JSON.stringify(asset.meta),
        new Date().toISOString(),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

export interface RevertOutcome {
  plan: RevertPlan;
  /** The restore point created by this revert — undo the undo. */
  restorePoint: RestorePoint | null;
  removedBooks: number;
  removedPages: number;
  /** Bookcases the import built and this revert took down again. */
  removedBookcases: number;
  restoredRows: number;
}

/** Preview a revert without touching anything (drives the confirm copy). */
export async function previewRevert(pointId: string): Promise<RevertPlan | null> {
  const point = await getRestorePoint(pointId);
  if (point === null) return null;
  return planRevert(point, await currentRowIds());
}

/**
 * Undo an import. Snapshots every row it is about to remove or overwrite into
 * a fresh `kind: 'revert'` restore point first, so reverting is undoable.
 */
export async function revertRestorePoint(
  pointId: string,
  now: Date = new Date(),
): Promise<RevertOutcome | null> {
  const point = await getRestorePoint(pointId);
  if (point === null) return null;
  const plan = planRevert(point, await currentRowIds());
  if (plan.empty) {
    return {
      plan,
      restorePoint: null,
      removedBooks: 0,
      removedPages: 0,
      removedBookcases: 0,
      restoredRows: 0,
    };
  }

  // Snapshot everything this revert touches, *before* touching it.
  const doomedBooks = await bookRows(plan.deleteBookIds);
  const cascadedPages = await pageRowsOfBooks(plan.deleteBookIds);
  const doomedPages = await pageRows(plan.deletePageIds);
  const overwrittenBooks = await bookRows(plan.restoreBooks.map((row) => row.id));
  const overwrittenPages = await pageRows(plan.restorePages.map((row) => row.id));
  // The furniture too — including whatever room the reader gave it while it
  // was here, so undoing this revert brings back the case they were looking at
  // rather than the one the bundle described.
  const doomedBookcases = await bookcaseRows(plan.deleteBookcaseIds);
  const overwrittenBookcases = await bookcaseRows(
    plan.restoreBookcases.map((row) => row.id),
  );

  const undoPoint: RestorePoint = {
    id: nanoid(),
    label: `Reverted ${point.source === '' ? point.label : point.source}`,
    createdAt: now.toISOString(),
    kind: 'revert',
    source: point.source,
    counts: {
      books: doomedBooks.length + overwrittenBooks.length,
      pages: cascadedPages.length + doomedPages.length + overwrittenPages.length,
    },
    createdBooks: [],
    createdPages: [],
    // A revert creates no case of its own; the ones it PUTS BACK are recorded
    // as prior rows, which is what makes undoing the revert re-create them.
    createdBookcases: [],
    priorBooks: dedupeById([...doomedBooks, ...overwrittenBooks]),
    priorPages: dedupeById([...cascadedPages, ...doomedPages, ...overwrittenPages]),
    priorBookcases: dedupeById([...doomedBookcases, ...overwrittenBookcases]),
    revertOf: point.id,
    revertedAt: null,
    revertedBy: null,
  };
  await addRestorePoint(undoPoint, now);

  const db = await getDb();
  for (const id of plan.deletePageIds) {
    await db.execute('DELETE FROM pages WHERE id = $1', [id]);
  }
  for (const id of plan.deleteBookIds) {
    await db.execute('DELETE FROM pages WHERE book_id = $1', [id]);
    await db.execute('DELETE FROM books WHERE id = $1', [id]);
  }
  // Furniture goes back BEFORE the books that stand on it, and comes down
  // AFTER them, so there is no moment at which a restored book points at a
  // case that is not there for the orphan sweep to find.
  for (const row of plan.restoreBookcases) await upsertBookcaseRow(row);
  for (const row of plan.restoreBooks) await upsertBookRow(row);
  for (const row of plan.restorePages) await upsertPageRow(row);
  const removedBookcases = await removeEmptyBookcases(plan.deleteBookcaseIds);
  // Any furniture change at all: the picker, the shelf and the studio all read
  // the store, and none of them saw these writes.
  if (removedBookcases > 0 || plan.restoreBookcases.length > 0) {
    await refreshBookcaseStore();
  }

  await patchRestorePoint(
    point.id,
    { revertedAt: now.toISOString(), revertedBy: undoPoint.id },
    now,
  );
  // Undoing a revert puts the import back in force, so the import stops
  // counting as reverted and becomes revertable again.
  if (point.kind === 'revert' && point.revertOf !== null) {
    await patchRestorePoint(point.revertOf, { revertedAt: null, revertedBy: null }, now);
  }

  return {
    plan,
    restorePoint: undoPoint,
    removedBooks: plan.deleteBookIds.length,
    removedPages: plan.deletePageIds.length + cascadedPages.length,
    removedBookcases,
    restoredRows:
      plan.restoreBooks.length + plan.restorePages.length + plan.restoreBookcases.length,
  };
}

/**
 * Take down cases the import built, re-checking emptiness against the database
 * one last time.
 *
 * `planRevert` already decided these are empty, from a snapshot taken before
 * the deletes ran. This asks the rows themselves, immediately before the drop,
 * because the one thing that must never happen here is a case going away with
 * a book still standing in it. The last case in the library is never removed
 * either — a library with no furniture has nowhere to put the next book, which
 * is the same rule `deleteBookcase` enforces.
 */
async function removeEmptyBookcases(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await getDb();
  let removed = 0;
  for (const id of ids) {
    try {
      const standing = await db.select<Array<{ id: string }>>(
        'SELECT id FROM books WHERE bookcase_id = $1',
        [id],
      );
      if (standing.length > 0) continue;
      const all = await db.select<Array<{ id: string }>>('SELECT id FROM bookcases');
      if (all.length <= 1) continue;
      await db.execute('DELETE FROM bookcases WHERE id = $1', [id]);
      removed += 1;
    } catch {
      // A case that will not come down is cosmetic clutter, not lost data.
    }
  }
  return removed;
}

/**
 * Nudge the bookcase store to re-read after this module has written the
 * `bookcases` table directly.
 *
 * `data/bookcases` refreshes itself around its own writers and deliberately
 * exports no bare "refresh". `switchBookcase` handed the case that is already
 * open is the one public call that re-reads and changes nothing — and if the
 * open case is one this revert just took down, its own repair puts the reader
 * in a case that exists.
 */
async function refreshBookcaseStore(): Promise<void> {
  try {
    await switchBookcase(activeBookcaseId());
  } catch {
    // The store re-reads on the next load either way; the shelf is not lost.
  }
}

function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/**
 * Put a book row back exactly as it was — `bookcase_id` included.
 *
 * That column was missing from this statement, which meant every reverted row
 * came back with no case at all. Nothing failed: the start-up orphan sweep
 * (`data/bookcases.adoptOrphanBooks`) tidied them into whichever case sorts
 * first, so a revert quietly reshelved books into a room they had never been
 * in — and the reader's only clue was that their library looked wrong after a
 * restart. `bookcaseOf` supplies the default case for a point recorded before
 * the column travelled, which is the same answer the sweep would have reached,
 * only immediately and without a restart.
 */
async function upsertBookRow(row: BookRowSnapshot): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO books (id, bookcase_id, title, floor, slot, spine_seed, cover_meta, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      row.id,
      bookcaseOf({ bookcaseId: row.bookcase_id ?? undefined }),
      row.title,
      row.floor,
      row.slot,
      row.spine_seed,
      row.cover_meta,
      row.created_at,
      row.updated_at,
    ],
  );
}

/** Put a bookcase row back exactly as it was, room and height included. */
async function upsertBookcaseRow(row: BookcaseRowSnapshot): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO bookcases (id, name, ord, room, floors, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      row.id,
      row.name,
      row.ord,
      row.room,
      clampFloorCount(row.floors),
      row.created_at,
      row.updated_at,
    ],
  );
}

async function upsertPageRow(row: PageRowSnapshot): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO pages (id, book_id, ord, doc_json, script_source, source_dirty, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      row.id,
      row.book_id,
      row.ord,
      row.doc_json,
      row.script_source,
      row.source_dirty,
      row.updated_at,
    ],
  );
}

/** Convenience for the panel: what a planned book will do, in words. */
export function describePlannedBook(book: PlannedBook): string {
  return book.summary;
}
