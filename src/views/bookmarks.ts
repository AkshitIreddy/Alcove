/**
 * Ribbon bookmarks (roadmap #19) — per-book colored ribbons stored inside
 * the book's free-form `cover_meta` JSON under the `bookmarks` key:
 *
 *   cover_meta: { ..., bookmarks: [{ pageId, color, addedAt }, ...] }
 *
 * src/data/books.ts (group A territory) has no bookmark helpers yet, so we
 * code defensively against the raw blob here: reads validate every entry,
 * writes go through the public `updateBook` patch API and spread the rest
 * of cover_meta through untouched (cover art overrides, page defaults...).
 * The closed-book cover art can pick the same key up later.
 */
import { getBook, updateBook } from '../data/books';
import type { Book } from '../data/types';

/** Ribbon palette — wash tokens with a matching deep edge for the fold. */
export const RIBBON_COLORS = [
  'terracotta',
  'moss',
  'sky',
  'plum',
  'amber',
  'blush',
] as const;

export type RibbonColor = (typeof RIBBON_COLORS)[number];

export interface Bookmark {
  readonly pageId: string;
  readonly color: RibbonColor;
  /** ISO-8601 timestamp. */
  readonly addedAt: string;
}

const isRibbonColor = (value: unknown): value is RibbonColor =>
  typeof value === 'string' &&
  (RIBBON_COLORS as readonly string[]).includes(value);

/** Validated bookmarks from a book's cover_meta (corrupt entries dropped). */
export function readBookmarks(
  book: Pick<Book, 'coverMeta'> | null | undefined,
): Bookmark[] {
  const raw = book?.coverMeta?.bookmarks;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Bookmark[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const { pageId, color, addedAt } = entry as Record<string, unknown>;
    if (typeof pageId !== 'string' || pageId === '' || seen.has(pageId)) {
      continue;
    }
    seen.add(pageId);
    out.push({
      pageId,
      color: isRibbonColor(color) ? color : 'terracotta',
      addedAt: typeof addedAt === 'string' ? addedAt : new Date(0).toISOString(),
    });
  }
  return out;
}

/**
 * Toggle a page's bookmark in a list (pure). Adding picks the next palette
 * color by cycle so neighbouring ribbons differ.
 */
export function toggleBookmark(
  bookmarks: readonly Bookmark[],
  pageId: string,
  now: Date = new Date(),
): Bookmark[] {
  const existing = bookmarks.filter((mark) => mark.pageId !== pageId);
  if (existing.length !== bookmarks.length) return existing;
  const color = RIBBON_COLORS[bookmarks.length % RIBBON_COLORS.length];
  return [...bookmarks, { pageId, color, addedAt: now.toISOString() }];
}

/** Merge a bookmark list into a cover_meta blob (pure, null-safe). */
export function mergeBookmarksIntoMeta(
  meta: Record<string, unknown> | null,
  bookmarks: readonly Bookmark[],
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(meta ?? {}) };
  if (bookmarks.length === 0) delete next.bookmarks;
  else next.bookmarks = bookmarks.map((mark) => ({ ...mark }));
  return Object.keys(next).length > 0 ? next : null;
}

/** Persist a book's bookmark list (re-reads cover_meta to merge fresh). */
export async function saveBookmarks(
  bookId: string,
  bookmarks: readonly Bookmark[],
): Promise<void> {
  const book = await getBook(bookId);
  if (book === null) return;
  await updateBook(bookId, {
    coverMeta: mergeBookmarksIntoMeta(book.coverMeta, bookmarks),
  });
}
