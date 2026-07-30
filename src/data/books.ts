import { nanoid } from 'nanoid';
import { getDb } from './db';
import type {
  Book,
  BookRow,
  CreateBookInput,
  PageDoc,
  PageStyle,
  UpdateBookPatch,
} from './types';

function parseCoverMeta(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupt cover metadata is cosmetic only — drop it rather than crash.
  }
  return null;
}

function serializeCoverMeta(
  meta: Record<string, unknown> | null | undefined,
): string | null {
  return meta == null ? null : JSON.stringify(meta);
}

function rowToBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    floor: row.floor,
    slot: row.slot,
    spineSeed: row.spine_seed,
    coverMeta: parseCoverMeta(row.cover_meta),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function randomSpineSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/** Books on floors `startFloor..endFloor` (inclusive), ordered by floor then slot. */
export async function listBooksByFloorRange(
  startFloor: number,
  endFloor: number,
): Promise<Book[]> {
  const db = await getDb();
  const rows = await db.select<BookRow[]>(
    'SELECT * FROM books WHERE floor >= $1 AND floor <= $2 ORDER BY floor ASC, slot ASC',
    [startFloor, endFloor],
  );
  return rows.map(rowToBook);
}

export async function getBook(id: string): Promise<Book | null> {
  const db = await getDb();
  const rows = await db.select<BookRow[]>(
    'SELECT * FROM books WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows.length > 0 ? rowToBook(rows[0]) : null;
}

export async function createBook(input: CreateBookInput): Promise<Book> {
  const db = await getDb();
  const now = new Date().toISOString();
  const book: Book = {
    id: nanoid(),
    title: input.title,
    floor: input.floor,
    slot: input.slot,
    spineSeed: input.spineSeed ?? randomSpineSeed(),
    coverMeta: input.coverMeta ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.execute(
    'INSERT INTO books (id, title, floor, slot, spine_seed, cover_meta, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      book.id,
      book.title,
      book.floor,
      book.slot,
      book.spineSeed,
      serializeCoverMeta(book.coverMeta),
      book.createdAt,
      book.updatedAt,
    ],
  );
  return book;
}

/** Patch title / spine seed / cover metadata; bumps `updated_at`. */
export async function updateBook(
  id: string,
  patch: UpdateBookPatch,
): Promise<Book | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.title !== undefined) {
    binds.push(patch.title);
    sets.push(`title = $${binds.length}`);
  }
  if (patch.spineSeed !== undefined) {
    binds.push(patch.spineSeed);
    sets.push(`spine_seed = $${binds.length}`);
  }
  if (patch.coverMeta !== undefined) {
    binds.push(serializeCoverMeta(patch.coverMeta));
    sets.push(`cover_meta = $${binds.length}`);
  }
  if (sets.length === 0) return getBook(id);

  const db = await getDb();
  binds.push(new Date().toISOString());
  sets.push(`updated_at = $${binds.length}`);
  binds.push(id);
  await db.execute(
    `UPDATE books SET ${sets.join(', ')} WHERE id = $${binds.length}`,
    binds,
  );
  return getBook(id);
}

/** Reshelve a book to a new floor/slot; bumps `updated_at`. */
export async function moveBook(
  id: string,
  floor: number,
  slot: number,
): Promise<Book | null> {
  const db = await getDb();
  await db.execute(
    'UPDATE books SET floor = $1, slot = $2, updated_at = $3 WHERE id = $4',
    [floor, slot, new Date().toISOString(), id],
  );
  return getBook(id);
}

/* ----------------------------------------------------------------------------
   cover_meta helpers — the book's free-form JSON blob, sectioned:
     { cover: {...CoverOverrides},
       pageDefaults: {...BookPageDefaults},
       shelf: {...ShelfMeta} }
   The data layer stays art-agnostic: `cover` is passed through as loose JSON
   (validated by src/art/covers.normalizeCoverOverrides at the render site);
   `pageDefaults` is validated here because pages consume it directly;
   `shelf` (wave-2) carries library-life flags: pin star, last-opened time,
   cached page count (spine thickness), and the soft-delete bookkeeping.
   -------------------------------------------------------------------------- */

/** Per-book page defaults applied to current + future pages of the book. */
export interface BookPageDefaults {
  /** Line spacing in px (26–40 in the customize panel). */
  lineHeightPx?: number;
  pageStyle?: PageStyle;
  /** Ink token for this book's pages ('sepia' | 'graphite' | 'ink-blue'). */
  ink?: string;
}

const PAGE_STYLE_VALUES: readonly string[] = ['ruled', 'grid', 'blank', 'dotted'];
const INK_VALUES: readonly string[] = ['sepia', 'graphite', 'ink-blue'];

/** Loose cover-art override JSON stored under `cover_meta.cover`, or null. */
export function readCoverOverrides(
  book: Pick<Book, 'coverMeta'> | null | undefined,
): Record<string, unknown> | null {
  const section = book?.coverMeta?.cover;
  if (section !== null && typeof section === 'object' && !Array.isArray(section)) {
    return section as Record<string, unknown>;
  }
  return null;
}

/** Validated per-book page defaults from `cover_meta.pageDefaults`, or null. */
export function readPageDefaults(
  book: Pick<Book, 'coverMeta'> | null | undefined,
): BookPageDefaults | null {
  const section = book?.coverMeta?.pageDefaults;
  if (section === null || typeof section !== 'object' || Array.isArray(section)) {
    return null;
  }
  const raw = section as Record<string, unknown>;
  const out: BookPageDefaults = {};
  if (
    typeof raw.lineHeightPx === 'number' &&
    Number.isFinite(raw.lineHeightPx)
  ) {
    out.lineHeightPx = Math.min(64, Math.max(24, Math.round(raw.lineHeightPx)));
  }
  if (typeof raw.pageStyle === 'string' && PAGE_STYLE_VALUES.includes(raw.pageStyle)) {
    out.pageStyle = raw.pageStyle as PageStyle;
  }
  if (typeof raw.ink === 'string' && INK_VALUES.includes(raw.ink)) {
    out.ink = raw.ink;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Wave-2 shelf/library metadata stored under `cover_meta.shelf`.
 * All fields optional; absent section reads as null.
 */
export interface ShelfMeta {
  /** Favorite: star charm on the spine + "favorites first" sort. */
  pinned?: boolean;
  /** ISO timestamp of the last time this book was opened. */
  lastOpenedAt?: string;
  /** Cached page count driving auto spine thickness. */
  pageCount?: number;
  /** Present only while the book sits in the trash drawer (floor -1). */
  deletedAt?: string;
  /** Shelf position to restore to when un-trashed. */
  prevFloor?: number;
  prevSlot?: number;
}

/** Validated shelf metadata from `cover_meta.shelf`, or null. */
export function readShelfMeta(
  book: Pick<Book, 'coverMeta'> | null | undefined,
): ShelfMeta | null {
  const section = book?.coverMeta?.shelf;
  if (section === null || typeof section !== 'object' || Array.isArray(section)) {
    return null;
  }
  const raw = section as Record<string, unknown>;
  const out: ShelfMeta = {};
  if (typeof raw.pinned === 'boolean') out.pinned = raw.pinned;
  if (typeof raw.lastOpenedAt === 'string') out.lastOpenedAt = raw.lastOpenedAt;
  if (typeof raw.pageCount === 'number' && Number.isFinite(raw.pageCount)) {
    out.pageCount = Math.max(0, Math.round(raw.pageCount));
  }
  if (typeof raw.deletedAt === 'string') out.deletedAt = raw.deletedAt;
  if (typeof raw.prevFloor === 'number' && Number.isFinite(raw.prevFloor)) {
    out.prevFloor = Math.round(raw.prevFloor);
  }
  if (typeof raw.prevSlot === 'number' && Number.isFinite(raw.prevSlot)) {
    out.prevSlot = Math.max(0, Math.round(raw.prevSlot));
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Pure merge of one section into an existing coverMeta blob (null-safe). */
export function mergeCoverMetaSection(
  meta: Record<string, unknown> | null,
  key: 'cover' | 'pageDefaults' | 'shelf',
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(meta ?? {}) };
  if (value === null || Object.keys(value).length === 0) delete next[key];
  else next[key] = value;
  return Object.keys(next).length > 0 ? next : null;
}

/** Persist cover-art overrides for a book (merging other sections through). */
export async function saveCoverOverrides(
  id: string,
  overrides: Record<string, unknown> | null,
): Promise<Book | null> {
  const book = await getBook(id);
  if (book === null) return null;
  return updateBook(id, {
    coverMeta: mergeCoverMetaSection(book.coverMeta, 'cover', overrides),
  });
}

/** Persist per-book page defaults (merging other sections through). */
export async function savePageDefaults(
  id: string,
  defaults: BookPageDefaults | null,
): Promise<Book | null> {
  const book = await getBook(id);
  if (book === null) return null;
  return updateBook(id, {
    coverMeta: mergeCoverMetaSection(
      book.coverMeta,
      'pageDefaults',
      defaults as Record<string, unknown> | null,
    ),
  });
}

/** Persist shelf metadata (merging other cover_meta sections through). */
export async function saveShelfMeta(
  id: string,
  meta: ShelfMeta | null,
): Promise<Book | null> {
  const book = await getBook(id);
  if (book === null) return null;
  return updateBook(id, {
    coverMeta: mergeCoverMetaSection(
      book.coverMeta,
      'shelf',
      meta as Record<string, unknown> | null,
    ),
  });
}

/** Patch shelf metadata fields (read-merge-write). */
async function patchShelfMeta(
  id: string,
  patch: ShelfMeta,
): Promise<Book | null> {
  const book = await getBook(id);
  if (book === null) return null;
  const merged = { ...(readShelfMeta(book) ?? {}), ...patch };
  // Drop keys explicitly set to undefined (used to clear trash bookkeeping).
  for (const key of Object.keys(merged) as Array<keyof ShelfMeta>) {
    if (merged[key] === undefined) delete merged[key];
  }
  return updateBook(id, {
    coverMeta: mergeCoverMetaSection(
      book.coverMeta,
      'shelf',
      merged as Record<string, unknown>,
    ),
  });
}

/**
 * Delete a book and all of its pages. Pages are removed explicitly (in
 * addition to the schema's ON DELETE CASCADE) so behavior does not depend
 * on the connection's foreign-key pragma.
 */
export async function deleteBook(id: string): Promise<boolean> {
  const db = await getDb();
  await db.execute('DELETE FROM pages WHERE book_id = $1', [id]);
  const result = await db.execute('DELETE FROM books WHERE id = $1', [id]);
  return result.rowsAffected > 0;
}

/* ----------------------------------------------------------------------------
   Wave-2 shelf & library life
   ----------------------------------------------------------------------------
   Trash convention: floor index -1 IS the trash drawer. The shelf only ever
   queries floors >= 0 (listBooksByFloorRange from the virtualizer), so a book
   moved to floor -1 disappears from the case without any schema change. Its
   former position + deletion time live in cover_meta.shelf so restore puts it
   back where it came from. Permanent deletion = deleteBook on a trashed id.
   -------------------------------------------------------------------------- */

/** The floor index that acts as the trash drawer. */
export const TRASH_FLOOR = -1;

/**
 * Auto spine thickness: multiplier for the baked spine width from the cached
 * page count. Gentle square-root growth, clamped so extreme books still read
 * as books (0 pages ≈ 0.85×, 5 ≈ 0.96×, 20 ≈ 1.07×, 100+ → 1.45× cap).
 */
export function thicknessScale(pageCount: number | null | undefined): number {
  if (pageCount === null || pageCount === undefined || !Number.isFinite(pageCount)) {
    return 1;
  }
  const scale = 0.85 + 0.05 * Math.sqrt(Math.max(0, pageCount));
  return Math.min(1.45, Math.max(0.85, scale));
}

/** Rename a book (bumps updated_at). */
export function renameBook(id: string, title: string): Promise<Book | null> {
  return updateBook(id, { title });
}

/** Pin/unpin a book (favorites star). */
export function setBookPinned(id: string, pinned: boolean): Promise<Book | null> {
  return patchShelfMeta(id, { pinned });
}

/** Record "opened now" for recent-sort and the continue-reading ribbon. */
export function touchBookOpened(id: string): Promise<Book | null> {
  return patchShelfMeta(id, { lastOpenedAt: new Date().toISOString() });
}

/** Re-count a book's pages into cover_meta.shelf.pageCount (spine thickness). */
export async function updateBookPageCount(id: string): Promise<Book | null> {
  const db = await getDb();
  const rows = await db.select<Array<{ id: string }>>(
    'SELECT id FROM pages WHERE book_id = $1',
    [id],
  );
  return patchShelfMeta(id, { pageCount: rows.length });
}

/** Books on a single floor, ordered by slot. */
async function listFloor(floor: number): Promise<Book[]> {
  const db = await getDb();
  const rows = await db.select<BookRow[]>(
    'SELECT * FROM books WHERE floor = $1 ORDER BY slot ASC',
    [floor],
  );
  return rows.map(rowToBook);
}

/**
 * Smallest free slot index on a floor at or after `from`.
 * Slots are sparse integers; gaps are expected and fine.
 */
export async function nextFreeSlot(floor: number, from = 0): Promise<number> {
  const taken = new Set((await listFloor(floor)).map((b) => b.slot));
  let slot = Math.max(0, Math.round(from));
  while (taken.has(slot)) slot += 1;
  return slot;
}

/**
 * Duplicate a book (title gets a " copy" suffix) with all of its pages,
 * landing on the next free slot of the same floor. Returns the new book.
 */
export async function duplicateBook(id: string): Promise<Book | null> {
  const source = await getBook(id);
  if (source === null) return null;
  const db = await getDb();
  const slot = await nextFreeSlot(source.floor, source.slot + 1);
  const copy = await createBook({
    title: `${source.title} copy`,
    floor: source.floor,
    slot,
    coverMeta: source.coverMeta,
  });
  const pages = await db.select<
    Array<{ ord: number; doc_json: string; script_source: string | null; source_dirty: number }>
  >('SELECT * FROM pages WHERE book_id = $1 ORDER BY ord ASC', [id]);
  const now = new Date().toISOString();
  for (const page of pages) {
    await db.execute(
      'INSERT INTO pages (id, book_id, ord, doc_json, script_source, source_dirty, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [nanoid(), copy.id, page.ord, page.doc_json, page.script_source, page.source_dirty, now],
    );
  }
  return copy;
}

/** Soft-delete: move the book to the trash drawer (floor -1). */
export async function trashBook(id: string): Promise<Book | null> {
  const book = await getBook(id);
  if (book === null || book.floor === TRASH_FLOOR) return book;
  await patchShelfMeta(id, {
    deletedAt: new Date().toISOString(),
    prevFloor: book.floor,
    prevSlot: book.slot,
  });
  return moveBook(id, TRASH_FLOOR, book.slot);
}

/**
 * Restore a trashed book to its former floor/slot (or the next free slot
 * there if it got taken). Clears the trash bookkeeping.
 */
export async function restoreBook(id: string): Promise<Book | null> {
  const book = await getBook(id);
  if (book === null || book.floor !== TRASH_FLOOR) return book;
  const meta = readShelfMeta(book);
  const floor = Math.max(0, meta?.prevFloor ?? 0);
  const slot = await nextFreeSlot(floor, meta?.prevSlot ?? 0);
  await patchShelfMeta(id, {
    deletedAt: undefined,
    prevFloor: undefined,
    prevSlot: undefined,
  });
  return moveBook(id, floor, slot);
}

/** Books currently in the trash drawer, most recently deleted first. */
export async function listTrashedBooks(): Promise<Book[]> {
  const books = await listFloor(TRASH_FLOOR);
  return books.sort((a, b) => {
    const da = readShelfMeta(a)?.deletedAt ?? '';
    const db_ = readShelfMeta(b)?.deletedAt ?? '';
    return da < db_ ? 1 : da > db_ ? -1 : 0;
  });
}

/** Permanently delete every book in the trash drawer. Returns count. */
export async function emptyTrash(): Promise<number> {
  const books = await listFloor(TRASH_FLOOR);
  for (const book of books) await deleteBook(book.id);
  return books.length;
}

/** Highest occupied shelf floor (>= 0), or 0 for an empty library. */
export async function maxOccupiedFloor(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<Array<{ floor: number }>>(
    'SELECT floor FROM books WHERE floor >= 0 ORDER BY floor DESC LIMIT 1',
  );
  return rows.length > 0 ? rows[0].floor : 0;
}

/**
 * True when a page document holds any real content (used by delete flows to
 * decide whether a confirm is even needed — kept here for reuse).
 */
export function pageDocHasContent(doc: PageDoc): boolean {
  const content = doc.content;
  if (content === undefined || content.length === 0) return false;
  return !content.every((node) => {
    if (node === null || typeof node !== 'object') return false;
    const block = node as { type?: unknown; content?: unknown };
    if (block.type !== 'paragraph') return false;
    const inner = block.content;
    return inner === undefined || (Array.isArray(inner) && inner.length === 0);
  });
}
