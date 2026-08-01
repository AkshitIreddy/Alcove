/**
 * src/features/transfer/scope.ts — what goes into an export.
 *
 * Pure, DOM-free, database-free. The UI hands us a `LibrarySnapshot` (built
 * by ./library) plus a scope + options, and gets back an `ExportPlan`: the
 * exact item tree, counts, and an estimated archive size — which is what the
 * "preview of exactly what will be included" panel renders.
 *
 * Scope is only a *starting selection*: picking "this book" seeds the page
 * set, and the user is then free to untick individual pages. That is why the
 * selection is carried as an explicit page-id set rather than re-derived.
 */

import {
  BUNDLE_EXTENSION,
  MANIFEST_PATH,
  THEME_PATH,
  pageFilePath,
  slugify,
  type BundleLayout,
  type BundleScopeKind,
  type BundleVariant,
} from './format';

// ---------------------------------------------------------------------------
// Snapshot model — a plain, serializable mirror of the library
// ---------------------------------------------------------------------------

export interface PageSnapshot {
  id: string;
  bookId: string;
  ord: number;
  /** First heading of the page, else "page N". */
  title: string;
  /** Canonical Notebook Script for the page body. */
  script: string;
  /** Serialized TipTap document JSON (lossless round-trip). */
  docJson: string;
  /** Plain-text length, used for the "how full is this page" hint. */
  chars: number;
}

export interface BookSnapshot {
  id: string;
  title: string;
  /** Which bookcase it stood in. Null for a library that predates cases. */
  bookcaseId: string | null;
  floor: number;
  slot: number;
  spineSeed: number;
  coverMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  pages: PageSnapshot[];
}

export interface AssetSnapshot {
  id: string;
  relPath: string;
  kind: string;
  meta: Record<string, unknown> | null;
  bytes: number;
}

export interface LibrarySnapshot {
  books: BookSnapshot[];
  assets: AssetSnapshot[];
  /** Library theme settings blob (theme name, wood stain, wallpaper…). */
  theme: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Scope + options
// ---------------------------------------------------------------------------

export interface ExportScope {
  kind: BundleScopeKind;
  /** Book id for `kind: 'book'`. */
  bookId?: string | null;
  /** Floor index for `kind: 'floor'`. */
  floor?: number | null;
}

export interface ExportOptions {
  /** Ship referenced media files alongside the pages. */
  includeAssets: boolean;
  /** Ship each book's cover/spine styling (`cover_meta`). */
  includeCoverStyling: boolean;
  /** Ship the library theme (wood stain, wallpaper, palette…). */
  includeLibraryTheme: boolean;
  /** Also ship the lossless editor JSON, not just the script text. */
  losslessDocs: boolean;
  /** `bundle` = Notebook Script; `markdown` = plain Markdown, no directives. */
  variant: BundleVariant;
  /** One file per page, or one file per book. */
  layout: BundleLayout;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeAssets: true,
  includeCoverStyling: true,
  includeLibraryTheme: false,
  losslessDocs: true,
  variant: 'bundle',
  layout: 'per-page',
};

/** Seed the page selection from a scope. */
export function resolveScopeSelection(
  snapshot: LibrarySnapshot,
  scope: ExportScope,
): Set<string> {
  const selected = new Set<string>();
  for (const book of snapshot.books) {
    const match =
      scope.kind === 'library' ||
      scope.kind === 'selection' ||
      (scope.kind === 'book' && book.id === scope.bookId) ||
      (scope.kind === 'floor' && book.floor === scope.floor);
    if (!match) continue;
    for (const page of book.pages) selected.add(page.id);
  }
  return selected;
}

/** Floors that actually hold books, ascending — drives the floor chips. */
export function occupiedFloors(snapshot: LibrarySnapshot): number[] {
  const floors = new Set<number>();
  for (const book of snapshot.books) {
    if (book.floor >= 0) floors.add(book.floor);
  }
  return [...floors].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface ExportPlanPage {
  id: string;
  ord: number;
  title: string;
  /** Archive path this page will be written to. */
  file: string;
  bytes: number;
  chars: number;
}

export interface ExportPlanBook {
  id: string;
  title: string;
  floor: number;
  slot: number;
  /** Only the *selected* pages. */
  pages: ExportPlanPage[];
  /** Pages of this book the user left out. */
  omittedPages: number;
  bytes: number;
}

export interface ExportPlan {
  books: ExportPlanBook[];
  assets: AssetSnapshot[];
  counts: { books: number; pages: number; assets: number };
  /** Estimated size of the produced file, in bytes. */
  estimatedBytes: number;
  /** True when nothing is selected — the export button stays disabled. */
  empty: boolean;
}

/** Per-entry ZIP overhead: local header + central record + the name twice. */
function entryOverhead(path: string): number {
  return 30 + 46 + path.length * 2;
}

const utf8 = new TextEncoder();

function byteLength(text: string): number {
  return utf8.encode(text).length;
}

/**
 * The exact tree + estimated size for a selection. Deterministic: the same
 * snapshot/selection/options always produce the same plan, which is what the
 * preview panel and the writer both consume.
 */
export function buildExportPlan(
  snapshot: LibrarySnapshot,
  selectedPageIds: ReadonlySet<string>,
  options: ExportOptions,
): ExportPlan {
  const books: ExportPlanBook[] = [];
  let totalBytes = 0;
  let pageCount = 0;

  const usedSlugs = new Map<string, number>();
  for (const book of snapshot.books) {
    const chosen = book.pages.filter((page) => selectedPageIds.has(page.id));
    if (chosen.length === 0) continue;

    // Two books called "Notes" must not collide in the archive.
    const baseSlug = slugify(book.title, 'book');
    const seen = usedSlugs.get(baseSlug) ?? 0;
    usedSlugs.set(baseSlug, seen + 1);
    const bookSlug = seen === 0 ? baseSlug : `${baseSlug}-${seen + 1}`;

    const pages: ExportPlanPage[] = [];
    let bookBytes = 0;
    chosen.forEach((page, index) => {
      const file =
        options.layout === 'single-file'
          ? `pages/${bookSlug}.${options.variant === 'markdown' ? 'md' : 'nbs'}`
          : pageFilePath(bookSlug, index, page.title, options.variant);
      let bytes = byteLength(page.script);
      if (options.losslessDocs && options.variant === 'bundle') {
        bytes += byteLength(page.docJson) + entryOverhead(`docs/${page.id}.json`);
      }
      if (options.layout === 'per-page') bytes += entryOverhead(file);
      pages.push({
        id: page.id,
        ord: page.ord,
        title: page.title,
        file,
        bytes,
        chars: page.chars,
      });
      bookBytes += bytes;
    });
    if (options.layout === 'single-file') {
      bookBytes += entryOverhead(`pages/${bookSlug}`);
    }

    pageCount += pages.length;
    totalBytes += bookBytes;
    books.push({
      id: book.id,
      title: book.title,
      floor: book.floor,
      slot: book.slot,
      pages,
      omittedPages: book.pages.length - chosen.length,
      bytes: bookBytes,
    });
  }

  const assets = options.includeAssets && books.length > 0 ? snapshot.assets : [];
  for (const asset of assets) {
    totalBytes += asset.bytes + entryOverhead(`assets/${asset.relPath}`);
  }
  if (options.includeLibraryTheme && snapshot.theme !== null) {
    totalBytes +=
      byteLength(JSON.stringify(snapshot.theme)) + entryOverhead(THEME_PATH);
  }

  // Manifest: ~220 bytes of envelope, ~150 per book, ~190 per page entry.
  const manifestBytes =
    books.length === 0
      ? 0
      : 220 +
        books.length * (150 + (options.includeCoverStyling ? 120 : 0)) +
        pageCount * 190 +
        assets.length * 120 +
        entryOverhead(MANIFEST_PATH);

  return {
    books,
    assets,
    counts: { books: books.length, pages: pageCount, assets: assets.length },
    estimatedBytes: totalBytes + manifestBytes,
    empty: books.length === 0,
  };
}

/** Suggested file name for a plan (`study-notes.nbk`, `library.nbk`, …). */
export function suggestedFileName(
  plan: ExportPlan,
  scope: ExportScope,
  options: ExportOptions,
): string {
  const single = options.variant === 'markdown' && options.layout === 'single-file';
  const ext = single ? 'md' : BUNDLE_EXTENSION;
  if (scope.kind === 'library') return `notebook-library.${ext}`;
  if (scope.kind === 'floor') return `notebook-floor-${(scope.floor ?? 0) + 1}.${ext}`;
  if (plan.books.length === 1) return `${slugify(plan.books[0].title, 'notebook')}.${ext}`;
  return `notebook-selection.${ext}`;
}

/** Header line for the export preview: "2 books · 9 pages · ~34 KB". */
export function planLabel(plan: ExportPlan, scope: ExportScope): string {
  switch (scope.kind) {
    case 'library':
      return 'The whole library';
    case 'floor':
      return `Floor ${(scope.floor ?? 0) + 1}`;
    case 'book':
      return plan.books[0]?.title ?? 'One book';
    default:
      return plan.books.length === 1
        ? plan.books[0].title
        : `${plan.books.length} books`;
  }
}
