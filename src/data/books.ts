import { nanoid } from 'nanoid';
import { getDb } from './db';
import type {
  Book,
  BookRow,
  CreateBookInput,
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
     { cover: {...CoverOverrides}, pageDefaults: {...BookPageDefaults} }
   The data layer stays art-agnostic: `cover` is passed through as loose JSON
   (validated by src/art/covers.normalizeCoverOverrides at the render site);
   `pageDefaults` is validated here because pages consume it directly.
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

/** Pure merge of one section into an existing coverMeta blob (null-safe). */
export function mergeCoverMetaSection(
  meta: Record<string, unknown> | null,
  key: 'cover' | 'pageDefaults',
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
