/**
 * src/features/transfer/conflicts.ts — additive import, resolved item by item.
 *
 * The governing rule: **import never overwrites anything.** A bundle item that
 * already exists in the library is not "replaced"; the user picks one of
 *
 *   add as new   — a brand-new book, even though a namesake exists
 *   rename       — a brand-new book with a de-duplicated title
 *   add pages to — append the bundle's pages to the existing book
 *   skip         — nothing happens
 *
 * There is deliberately no "overwrite" resolution: the only way to lose data
 * would be a bug in the revert path, and even that is snapshotted.
 *
 * Everything here is pure and unit-tested in tests/transfer.test.ts.
 */

import type {
  BundleManifest,
  ManifestBook,
  ManifestBookcase,
  ManifestPage,
} from './format';
import type { LibrarySnapshot } from './scope';

export type BookConflict = 'none' | 'same-id' | 'same-title';
export type PageConflict = 'none' | 'same-id';
export type BookResolution = 'add-new' | 'rename' | 'merge' | 'skip';

export const BOOK_RESOLUTIONS: readonly BookResolution[] = [
  'add-new',
  'rename',
  'merge',
  'skip',
];

export const RESOLUTION_LABELS: Record<BookResolution, string> = {
  'add-new': 'add as new',
  rename: 'rename',
  merge: 'add pages to it',
  skip: 'skip',
};

// ---------------------------------------------------------------------------
// Library index
// ---------------------------------------------------------------------------

export interface LibraryIndex {
  bookIds: ReadonlySet<string>;
  pageIds: ReadonlySet<string>;
  /** lowercased title → id of the first book with that title. */
  titleToId: ReadonlyMap<string, string>;
  /** Lowercased titles, for `uniqueTitle`. */
  titles: ReadonlySet<string>;
}

export function buildLibraryIndex(snapshot: LibrarySnapshot): LibraryIndex {
  const bookIds = new Set<string>();
  const pageIds = new Set<string>();
  const titleToId = new Map<string, string>();
  const titles = new Set<string>();
  for (const book of snapshot.books) {
    bookIds.add(book.id);
    const key = book.title.trim().toLowerCase();
    titles.add(key);
    if (!titleToId.has(key)) titleToId.set(key, book.id);
    for (const page of book.pages) pageIds.add(page.id);
  }
  return { bookIds, pageIds, titleToId, titles };
}

// ---------------------------------------------------------------------------
// Detection + defaults
// ---------------------------------------------------------------------------

export function detectBookConflict(
  book: Pick<ManifestBook, 'id' | 'title'>,
  index: LibraryIndex,
): BookConflict {
  if (index.bookIds.has(book.id)) return 'same-id';
  if (index.titles.has(book.title.trim().toLowerCase())) return 'same-title';
  return 'none';
}

export function detectPageConflict(
  page: Pick<ManifestPage, 'id'>,
  index: LibraryIndex,
): PageConflict {
  return index.pageIds.has(page.id) ? 'same-id' : 'none';
}

/**
 * The safe default per conflict kind. An identical id means the same book
 * came from this library once — appending would double its pages, so the
 * default is a separate copy the user can compare and delete.
 */
export function defaultResolution(conflict: BookConflict): BookResolution {
  switch (conflict) {
    case 'same-id':
      return 'add-new';
    case 'same-title':
      return 'rename';
    default:
      return 'add-new';
  }
}

export const CONFLICT_BADGES: Record<BookConflict, string> = {
  none: '',
  'same-id': 'already imported',
  'same-title': 'same title',
};

/** `Notes` → `Notes (2)` against a taken set of lowercased titles. */
export function uniqueTitle(base: string, taken: ReadonlySet<string>): string {
  const trimmed = base.trim() === '' ? 'Untitled' : base.trim();
  if (!taken.has(trimmed.toLowerCase())) return trimmed;
  // Strip an existing " (n)" so repeated imports don't stack suffixes.
  const stem = /^(.*?)\s*\((\d+)\)$/.exec(trimmed)?.[1] ?? trimmed;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} (${Date.now()})`;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface PlannedPage {
  sourceId: string;
  title: string;
  ord: number;
  conflict: PageConflict;
}

export interface PlannedBook {
  sourceId: string;
  sourceTitle: string;
  conflict: BookConflict;
  resolution: BookResolution;
  /** What will actually happen once Apply is pressed. */
  action: 'create' | 'append' | 'skip';
  /** Final title (may be de-duplicated). Empty for skips. */
  title: string;
  /** Existing book that receives the pages, for `append`. */
  targetBookId: string | null;
  pages: PlannedPage[];
  /** Pages the user unticked. */
  skippedPages: number;
  /** One-line human description shown in "what will happen". */
  summary: string;
}

export interface ImportPlan {
  books: PlannedBook[];
  counts: {
    newBooks: number;
    appendedBooks: number;
    skippedBooks: number;
    pages: number;
  };
  /** Human-readable, ordered — the exact list the confirm step renders. */
  summary: string[];
  empty: boolean;
}

export interface ImportSelection {
  /** Page ids (bundle-side) the user wants. */
  pages: ReadonlySet<string>;
  /** Per-book resolution; missing entries fall back to `defaultResolution`. */
  resolutions: ReadonlyMap<string, BookResolution>;
}

/**
 * The full resolution matrix. Deterministic and side-effect free: the plan
 * this returns is exactly what `applyImportPlan` will execute, which is why
 * the UI can promise "show what will happen before it happens".
 */
export function buildImportPlan(
  manifest: BundleManifest,
  index: LibraryIndex,
  selection: ImportSelection,
): ImportPlan {
  // Titles claimed so far, so two renamed books in one bundle can't collide.
  const taken = new Set(index.titles);
  const books: PlannedBook[] = [];
  let newBooks = 0;
  let appendedBooks = 0;
  let skippedBooks = 0;
  let pageTotal = 0;

  for (const book of manifest.books) {
    const conflict = detectBookConflict(book, index);
    const resolution = selection.resolutions.get(book.id) ?? defaultResolution(conflict);
    const chosen = book.pages.filter((page) => selection.pages.has(page.id));
    const pages: PlannedPage[] = chosen.map((page) => ({
      sourceId: page.id,
      title: page.title,
      ord: page.ord,
      conflict: detectPageConflict(page, index),
    }));
    const skippedPages = book.pages.length - chosen.length;

    const pushSkip = (reason: string): void => {
      skippedBooks += 1;
      books.push({
        sourceId: book.id,
        sourceTitle: book.title,
        conflict,
        resolution: 'skip',
        action: 'skip',
        title: '',
        targetBookId: null,
        pages: [],
        skippedPages: book.pages.length,
        summary: reason,
      });
    };

    if (resolution === 'skip') {
      pushSkip(`Skip “${book.title}”`);
      continue;
    }
    if (pages.length === 0) {
      pushSkip(`Skip “${book.title}” — no pages ticked`);
      continue;
    }

    const targetId =
      conflict === 'same-id'
        ? book.id
        : (index.titleToId.get(book.title.trim().toLowerCase()) ?? null);

    if (resolution === 'merge' && targetId !== null) {
      appendedBooks += 1;
      pageTotal += pages.length;
      books.push({
        sourceId: book.id,
        sourceTitle: book.title,
        conflict,
        resolution,
        action: 'append',
        title: book.title,
        targetBookId: targetId,
        pages,
        skippedPages,
        summary: `Add ${pages.length} page${pages.length === 1 ? '' : 's'} to your existing “${book.title}”`,
      });
      continue;
    }

    // 'merge' without a match degrades to a plain create — never a no-op.
    const effective: BookResolution = resolution === 'merge' ? 'add-new' : resolution;
    const title =
      effective === 'rename' ? uniqueTitle(book.title, taken) : book.title.trim();
    taken.add(title.toLowerCase());
    newBooks += 1;
    pageTotal += pages.length;
    books.push({
      sourceId: book.id,
      sourceTitle: book.title,
      conflict,
      resolution,
      action: 'create',
      title,
      targetBookId: null,
      pages,
      skippedPages,
      summary:
        title === book.title.trim()
          ? `Shelve “${title}” as a new book with ${pages.length} page${pages.length === 1 ? '' : 's'}`
          : `Shelve “${book.title}” as “${title}” with ${pages.length} page${pages.length === 1 ? '' : 's'}`,
    });
  }

  return {
    books,
    counts: { newBooks, appendedBooks, skippedBooks, pages: pageTotal },
    summary: books.map((book) => book.summary),
    empty: pageTotal === 0,
  };
}

/** Everything ticked — the default selection when a bundle is first opened. */
export function selectAllPages(manifest: BundleManifest): Set<string> {
  const ids = new Set<string>();
  for (const book of manifest.books) {
    for (const page of book.pages) ids.add(page.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Bookcases — which furniture the import needs, and where it comes from
// ---------------------------------------------------------------------------

/**
 * What happens to one bookcase the bundle mentions.
 *
 * `adopt` — a case already standing here receives the books.
 * `create` — the case does not exist here and is built from the bundle.
 */
export type BookcaseAction = 'adopt' | 'create';

export interface PlannedBookcase {
  /** Id the case had in the library that exported it. */
  sourceId: string;
  /** Name the bundle recorded, or the source id when it recorded none. */
  sourceName: string;
  action: BookcaseAction;
  /**
   * How the case here was recognised:
   *
   * `id`   — the exporting library IS this library (or a copy of it);
   * `name` — a different library that has a case by the same name, which is
   *          what happens on the second import of the same bundle;
   * `null` — nothing matched, so it is being built.
   */
  matchedBy: 'id' | 'name' | null;
  /** The case here that receives the books; null until a `create` runs. */
  targetBookcaseId: string | null;
  /** The bundle's description of the case — the recipe for a `create`. */
  source: ManifestBookcase | null;
  summary: string;
}

export interface BookcasePlan {
  bookcases: PlannedBookcase[];
  /** Source case id → the id of a case already here. */
  adopted: ReadonlyMap<string, string>;
  /** Cases to build, in the exporting library's picker order. */
  create: ManifestBookcase[];
  summary: string[];
  /**
   * Whether any of this is worth telling the reader.
   *
   * False for the ordinary case — one library, one bookcase, a bundle that
   * lands in it — where “books from My Library go into your My Library” in
   * front of every import is noise that makes the lines under it harder to
   * read. True as soon as furniture is being BUILT, or the books are being
   * split across more than one case, which are the two things a reader would
   * be surprised by afterwards.
   */
  notable: boolean;
}

/** A bookcase as the library here knows it — the two fields matching needs. */
export interface ExistingBookcase {
  id: string;
  name: string;
}

/**
 * Which source cases this import actually needs.
 *
 * Only books being CREATED bring a case with them. A book being appended to
 * one already on the shelf keeps that book's case — moving a reader's book to
 * another room because a bundle said so would be the one destructive thing
 * this feature promises never to do.
 */
export function neededBookcaseIds(
  manifest: BundleManifest,
  plan: ImportPlan,
): Set<string> {
  const byId = new Map(manifest.books.map((book) => [book.id, book]));
  const needed = new Set<string>();
  for (const planned of plan.books) {
    if (planned.action !== 'create') continue;
    const source = byId.get(planned.sourceId);
    const caseId = source?.bookcaseId ?? null;
    if (caseId !== null) needed.add(caseId);
  }
  return needed;
}

/**
 * Resolve every case the import needs against the cases standing here.
 *
 * Pure and deterministic — `applyImportPlan` executes exactly this, and the
 * panel renders exactly this, so "build the bookcase Study" in the preview is
 * the same decision the writer will make.
 *
 * A case the bundle names but cannot describe (schema 2, which recorded the id
 * and nothing else) is adopted when the id happens to exist here and otherwise
 * left out entirely: there is no recipe to build it from, and its books fall
 * back to the active case just as they did before bundles carried furniture.
 */
export function planBookcases(
  manifest: BundleManifest,
  plan: ImportPlan,
  existing: ReadonlyArray<ExistingBookcase>,
): BookcasePlan {
  const needed = neededBookcaseIds(manifest, plan);
  const describedById = new Map(manifest.bookcases.map((c) => [c.id, c]));
  const existingById = new Map(existing.map((c) => [c.id, c]));
  const existingByName = new Map<string, ExistingBookcase>();
  for (const c of existing) {
    const key = c.name.trim().toLowerCase();
    if (!existingByName.has(key)) existingByName.set(key, c);
  }

  // Bundle order for the described ones, then any undescribed id, so the
  // preview reads in the order the exporting library's picker did.
  const ordered = [
    ...manifest.bookcases.filter((c) => needed.has(c.id)).map((c) => c.id),
    ...[...needed].filter((id) => !describedById.has(id)),
  ];

  const bookcases: PlannedBookcase[] = [];
  const adopted = new Map<string, string>();
  const create: ManifestBookcase[] = [];
  // A bundle may name two cases whose names both collapse onto one case here;
  // the second must not be told it is adopting furniture the first already took
  // — it still adopts, and both sets of books land in the same room, which is
  // what the reader asked for by having one case with that name.
  for (const sourceId of ordered) {
    const source = describedById.get(sourceId) ?? null;
    const name = source?.name ?? sourceId;

    const byId = existingById.get(sourceId);
    if (byId !== undefined) {
      adopted.set(sourceId, byId.id);
      bookcases.push({
        sourceId,
        sourceName: name,
        action: 'adopt',
        matchedBy: 'id',
        targetBookcaseId: byId.id,
        source,
        summary: `Books from “${name}” go back into your “${byId.name}”`,
      });
      continue;
    }

    if (source === null) {
      // Named but not described: nothing to build, nothing to match. The books
      // fall through to the active case, which is what a schema-2 bundle did.
      continue;
    }

    const byName = existingByName.get(source.name.trim().toLowerCase());
    if (byName !== undefined) {
      adopted.set(sourceId, byName.id);
      bookcases.push({
        sourceId,
        sourceName: name,
        action: 'adopt',
        matchedBy: 'name',
        targetBookcaseId: byName.id,
        source,
        summary: `Books from “${name}” join your own bookcase of that name`,
      });
      continue;
    }

    create.push(source);
    bookcases.push({
      sourceId,
      sourceName: name,
      action: 'create',
      matchedBy: null,
      targetBookcaseId: null,
      source,
      summary: `Build the bookcase “${source.name}” (${source.floors} floor${source.floors === 1 ? '' : 's'})`,
    });
  }

  return {
    bookcases,
    adopted,
    create,
    summary: bookcases.map((bookcase) => bookcase.summary),
    notable: create.length > 0 || new Set(adopted.values()).size > 1,
  };
}
