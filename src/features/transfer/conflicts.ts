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

import type { BundleManifest, ManifestBook, ManifestPage } from './format';
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
