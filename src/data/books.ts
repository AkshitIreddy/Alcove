import { nanoid } from 'nanoid';
import { freshBookStyleOverrides } from '../art/bookStyle';
import { getDb } from './db';
import { PAGE_STYLES } from './types';
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

/* ------------------------------- bookcases -------------------------------- */
/*
 * A library is a collection of bookcases, and every book stands in exactly
 * one of them. The bookcase TABLE lives in src/data/bookcases.ts; what is
 * here is only what a book needs to know about its case — the id of the one
 * every pre-bookcase library folds into, the settings key naming the open
 * case, and the scoping argument every shelf query now takes.
 *
 * The scoping argument is optional everywhere, and omitting it means EVERY
 * bookcase, not "the open one". That is deliberate: a dozen callers outside
 * this layer (quick switcher, export bundle, journal, script templates) want
 * the whole library, and silently narrowing them to one case would make books
 * vanish from search. The shelf — the one surface that must not leak books
 * between cases — always passes the id explicitly.
 */

/** The bookcase every library has, and the one a pre-bookcase library becomes. */
export const DEFAULT_BOOKCASE_ID = 'case-default';

/** `settings` key holding the id of the bookcase currently open. */
export const ACTIVE_BOOKCASE_KEY = 'activeBookcase';

/**
 * The case a book stands in. Absent ⇒ the default case: a book whose
 * `bookcase_id` never got written (a reverted import, a row from the stub
 * predating the migration) is still SOMEBODY's book, and showing it in the
 * default case beats dropping it on the floor.
 */
export function bookcaseOf(book: Pick<Book, 'bookcaseId'>): string {
  const id = book.bookcaseId;
  return typeof id === 'string' && id.length > 0 ? id : DEFAULT_BOOKCASE_ID;
}

/**
 * The open bookcase, read straight from `settings`.
 *
 * Read from the DB rather than from the reactive store on purpose: this
 * module must not import src/data/bookcases.ts (which imports this one to
 * cascade-delete a case's books), and one tiny keyed select per book creation
 * costs nothing next to the insert it precedes.
 */
export async function readActiveBookcaseId(): Promise<string> {
  try {
    const db = await getDb();
    const rows = await db.select<Array<{ value: string }>>(
      'SELECT value FROM settings WHERE key = $1 LIMIT 1',
      [ACTIVE_BOOKCASE_KEY],
    );
    const value = rows[0]?.value;
    return typeof value === 'string' && value.length > 0 ? value : DEFAULT_BOOKCASE_ID;
  } catch {
    return DEFAULT_BOOKCASE_ID;
  }
}

/** Record which bookcase is open. Best-effort; never throws. */
export async function writeActiveBookcaseId(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      ACTIVE_BOOKCASE_KEY,
      id,
    ]);
  } catch {
    // Persistence is best-effort; the session still shows the new case.
  }
}

function rowToBook(row: BookRow): Book {
  return {
    id: row.id,
    bookcaseId:
      typeof row.bookcase_id === 'string' && row.bookcase_id.length > 0
        ? row.bookcase_id
        : DEFAULT_BOOKCASE_ID,
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

/**
 * Books on floors `startFloor..endFloor` (inclusive), ordered by floor then
 * slot. Pass `bookcaseId` to scope to one case; omit it for the whole library.
 */
export async function listBooksByFloorRange(
  startFloor: number,
  endFloor: number,
  bookcaseId?: string,
): Promise<Book[]> {
  const db = await getDb();
  const rows =
    bookcaseId === undefined
      ? await db.select<BookRow[]>(
          'SELECT * FROM books WHERE floor >= $1 AND floor <= $2 ORDER BY floor ASC, slot ASC',
          [startFloor, endFloor],
        )
      : await db.select<BookRow[]>(
          // Placeholders must appear in ascending order: SQLite numbers `$N`
          // by first appearance, not by the digits, so a query reading
          // `... = $3 AND ... >= $1` binds the arguments to the wrong columns.
          'SELECT * FROM books WHERE floor >= $1 AND floor <= $2 AND bookcase_id = $3 ORDER BY floor ASC, slot ASC',
          [startFloor, endFloor, bookcaseId],
        );
  return rows.map(rowToBook);
}

/** Every book in one bookcase, trash included. Used by the delete flow. */
export async function listBooksInBookcase(bookcaseId: string): Promise<Book[]> {
  const db = await getDb();
  const rows = await db.select<BookRow[]>(
    'SELECT * FROM books WHERE bookcase_id = $1 ORDER BY floor ASC, slot ASC',
    [bookcaseId],
  );
  return rows.map(rowToBook);
}

/** How many books stand in a bookcase (trash included). */
export async function countBooksInBookcase(bookcaseId: string): Promise<number> {
  return (await listBooksInBookcase(bookcaseId)).length;
}

/**
 * Reshelve a book into another bookcase, landing on the next free slot of
 * `floor` there. Returns the moved book, or null when it does not exist.
 *
 * ## Why a move can repaint a book, and what `keepAppearance` is for
 *
 * A room carries a spine bias (`themeSpineDefaults`): an unstyled book draws
 * its pigment from the ROOM's ramp, which is what makes one case read
 * midnight-and-silver and another blush-and-butter. That is deliberate, and it
 * rests on an assumption written down in `defaultThemeForOrd` — that a book
 * lives in exactly one case and therefore only ever sees one room.
 *
 * This function breaks that assumption. A book will come out a different colour
 * in its new case, and recognising a spine is how a reader finds a book — so
 * the object they were looking for stops being the object they remember.
 *
 * `keepAppearance` is the face to pin before moving, so the book keeps the look
 * it had. The caller supplies it because resolving a style needs `src/art`, and
 * the data layer does not import art. Pass `null` (the default) when the reader
 * has asked for the book to take on its new room.
 *
 * WHAT is in that blob is the caller's judgement, not this function's: the
 * shelf's `ShelfWorld.faceToPin` sends only the fields the target room would
 * have resolved differently (today, `{ pigment }`), because a blob that pins
 * more than that changes how the book DRAWS — `spineParamsFor` reads
 * `pinned.has('material')` as "the reader chose this covering". This function
 * takes whatever it is given and treats every key the same way.
 *
 * ## It is a FLOOR under the book's own style, not a replacement for it
 *
 * This started as all-or-nothing — pin the whole blob, but only for a book
 * with no `cover_meta.style` at all — and that guard protected almost nothing.
 * `createBook` dresses every new book with `freshBookStyleOverrides`, which
 * pins a restrained structural recipe and *deliberately drops `material`,
 * `pigment` and `hueJitter`* so the exact named binding and the room's colour
 * remain authoritative. So the typical book has a style, was therefore
 * skipped, and went on being repainted by the very colour field the guard
 * existed to hold still.
 *
 * So the merge runs the other way: the resolved face fills the gaps and the
 * book's own entries win outright, which keeps the older rule ("an explicit
 * per-book override always wins", library-themes.md §4) exactly as it was
 * while finally covering the fields nobody chose.
 */
export async function moveBookToBookcase(
  id: string,
  bookcaseId: string,
  floor?: number,
  keepAppearance: Record<string, unknown> | null = null,
): Promise<Book | null> {
  const book = await getBook(id);
  if (book === null) return null;

  // Freeze first, move second: if the write below succeeds and the style write
  // does not, the book is already in the new room wearing the new room's
  // colours, which is the state this exists to prevent.
  if (keepAppearance !== null) {
    const own = readBookStyleOverrides(book);
    if (own === null) {
      await saveBookStyleOverrides(id, keepAppearance);
    } else if (Object.keys(keepAppearance).some((key) => !(key in own))) {
      await saveBookStyleOverrides(id, { ...keepAppearance, ...own });
    }
    // else: the book already pins everything the caller resolved. Writing an
    // identical blob would only bump `updated_at` and re-sort "recent".
  }

  const targetFloor = Math.max(0, floor ?? book.floor);
  const slot = await nextFreeSlot(targetFloor, book.slot, bookcaseId);
  const db = await getDb();
  await db.execute(
    'UPDATE books SET bookcase_id = $1, floor = $2, slot = $3, updated_at = $4 WHERE id = $5',
    [bookcaseId, targetFloor, slot, new Date().toISOString(), id],
  );
  return getBook(id);
}

export async function getBook(id: string): Promise<Book | null> {
  const db = await getDb();
  const rows = await db.select<BookRow[]>(
    'SELECT * FROM books WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows.length > 0 ? rowToBook(rows[0]) : null;
}

/**
 * Shelve a new book. Without an explicit `bookcaseId` it lands in the case
 * that is currently OPEN — unlike the list queries, whose default is the whole
 * library. A new book has to stand somewhere, and "the case you are looking
 * at" is the only answer that is ever right.
 */
export async function createBook(input: CreateBookInput): Promise<Book> {
  const db = await getDb();
  const now = new Date().toISOString();
  const spineSeed = input.spineSeed ?? randomSpineSeed();
  const book: Book = {
    id: input.id ?? nanoid(),
    bookcaseId: input.bookcaseId ?? (await readActiveBookcaseId()),
    title: input.title,
    floor: input.floor,
    slot: input.slot,
    spineSeed,
    // A new book arrives with a character of its own — see
    // `freshBookStyleOverrides`. A caller that brought its own cover metadata
    // (the seeded Welcome book, an import, a duplicate) is left alone: it has
    // already said what the book should look like.
    coverMeta:
      input.coverMeta ??
      ({ style: freshBookStyleOverrides(spineSeed) } as Record<string, unknown>),
    createdAt: now,
    updatedAt: now,
  };
  await db.execute(
    'INSERT INTO books (id, bookcase_id, title, floor, slot, spine_seed, cover_meta, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      book.id,
      book.bookcaseId,
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

/**
 * Reshelve a book to a new floor/slot; bumps `updated_at`.
 *
 * `positionX` is supplied only by the visual Move interaction. It is written
 * in the same statement as floor/slot so a failed move cannot leave a book in
 * its old slot with a new visual anchor.
 */
export async function moveBook(
  id: string,
  floor: number,
  slot: number,
  options: { positionX?: number } = {},
): Promise<Book | null> {
  const positionX =
    typeof options.positionX === 'number' &&
    Number.isFinite(options.positionX)
      ? Math.max(0, options.positionX)
      : null;
  const db = await getDb();
  const now = new Date().toISOString();
  if (positionX === null) {
    await db.execute(
      'UPDATE books SET floor = $1, slot = $2, updated_at = $3 WHERE id = $4',
      [floor, slot, now, id],
    );
  } else {
    const book = await getBook(id);
    if (book === null) return null;
    const shelf = { ...(readShelfMeta(book) ?? {}), positionX };
    const coverMeta = mergeCoverMetaSection(
      book.coverMeta,
      'shelf',
      shelf as Record<string, unknown>,
    );
    await db.execute(
      'UPDATE books SET floor = $1, slot = $2, cover_meta = $3, updated_at = $4 WHERE id = $5',
      [floor, slot, serializeCoverMeta(coverMeta), now, id],
    );
  }
  return getBook(id);
}

/* ----------------------------------------------------------------------------
   cover_meta helpers — the book's free-form JSON blob, sectioned:
     { cover: {...CoverOverrides},
       pageDefaults: {...BookPageDefaults},
       shelf: {...ShelfMeta},
       style: {...BookStyleOverrides},
       studio: {...BookStudioPrefs} }
   The data layer stays art-agnostic: `cover` is passed through as loose JSON
   (validated by src/art/covers.normalizeCoverOverrides at the render site);
   `pageDefaults` is validated here because pages consume it directly;
   `shelf` (wave-2) carries library-life flags: pin star, last-opened time,
   cached page count (spine thickness), and the soft-delete bookkeeping;
   `style` is the renderer's canonical spine-and-cover appearance;
   `studio` is an art-owned, loosely typed preference envelope. The art layer
   validates that section so this persistence module stays independent of the
   renderer and old/new clients can safely share a library.
   -------------------------------------------------------------------------- */

/** Per-book page defaults applied to current + future pages of the book. */
export interface BookPageDefaults {
  /** Line spacing in px (26–40 in the customize panel). */
  lineHeightPx?: number;
  pageStyle?: PageStyle;
  /** Ink token for this book's pages ('sepia' | 'graphite' | 'ink-blue'). */
  ink?: string;
}

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
  if (
    typeof raw.pageStyle === 'string' &&
    (PAGE_STYLES as readonly string[]).includes(raw.pageStyle)
  ) {
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
  /** Present only while the book sits in the trash (floor -1). */
  deletedAt?: string;
  /** Shelf position to restore to when un-trashed. */
  prevFloor?: number;
  prevSlot?: number;
  /**
   * World-space spine centre chosen with the shelf's Move interaction.
   *
   * Automatic books omit this and keep the authored clustered composition;
   * once a reader points at a particular gap, that visible choice outranks
   * the automatic composition and must survive refreshes and restarts.
   */
  positionX?: number;
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
  if (typeof raw.positionX === 'number' && Number.isFinite(raw.positionX)) {
    out.positionX = Math.max(0, raw.positionX);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Book Studio overrides stored under `cover_meta.style` (library-themes.md §4).
 *
 * Kept as loose JSON here — `src/art/bookStyle.normalizeBookStyleOverrides`
 * is the validator, and it is total, so a corrupt blob degrades to "follow the
 * room" rather than throwing. This section supersedes `cover` for books that
 * have one: the studio writes a single style covering spine AND cover, so the
 * two can never drift apart.
 */
export function readBookStyleOverrides(
  book: Pick<Book, 'coverMeta'> | null | undefined,
): Record<string, unknown> | null {
  const section = book?.coverMeta?.style;
  if (section !== null && typeof section === 'object' && !Array.isArray(section)) {
    return section as Record<string, unknown>;
  }
  return null;
}

/** Persist Book Studio overrides (merging other cover_meta sections through). */
export async function saveBookStyleOverrides(
  id: string,
  overrides: Record<string, unknown> | null,
): Promise<Book | null> {
  return mutateBookCoverMeta(id, (meta) =>
    mergeCoverMetaSection(meta, 'style', overrides),
  );
}

/** Pure merge of one section into an existing coverMeta blob (null-safe). */
export function mergeCoverMetaSection(
  meta: Record<string, unknown> | null,
  key: CoverMetaSection,
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return mergeCoverMetaSections(meta, { [key]: value });
}

export type CoverMetaSection =
  | 'cover'
  | 'pageDefaults'
  | 'shelf'
  | 'style'
  | 'studio';

/**
 * Several independent features share the one `cover_meta` JSON column. A
 * patch names only the sections it owns; an omitted section is never touched.
 */
export type CoverMetaSectionsPatch = Partial<
  Record<CoverMetaSection, Record<string, unknown> | null>
>;

/** Merge several owned sections in one pure operation. */
export function mergeCoverMetaSections(
  meta: Record<string, unknown> | null,
  patch: CoverMetaSectionsPatch,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(meta ?? {}) };
  for (const key of Object.keys(patch) as CoverMetaSection[]) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null || Object.keys(value).length === 0) delete next[key];
    else next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : null;
}

export type BookCoverMetaMutation = (
  current: Record<string, unknown> | null,
) => Record<string, unknown> | null;

export interface BookCoverMetaMutationDeps {
  read(bookId: string): Promise<Pick<Book, 'coverMeta'> | null>;
  write(
    bookId: string,
    coverMeta: Record<string, unknown> | null,
  ): Promise<Book | null>;
}

/**
 * Build a per-book transaction lane for `cover_meta` read/merge/write calls.
 *
 * SQLite serializes statements, not a SELECT followed later by an UPDATE. A
 * style edit, page-default edit and ribbon edit could therefore all read the
 * same old JSON and let the last UPDATE erase the other two. Every mutation
 * now re-reads only after the previous mutation for that book has committed.
 * Different books retain independent lanes, and one failed mutation cannot
 * poison the book's next edit.
 */
export function createBookCoverMetaMutationLane(
  deps: BookCoverMetaMutationDeps,
): (bookId: string, mutate: BookCoverMetaMutation) => Promise<Book | null> {
  const tails = new Map<string, Promise<void>>();

  return (bookId, mutate) => {
    const previous = tails.get(bookId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const book = await deps.read(bookId);
      if (book === null) return null;
      return deps.write(bookId, mutate(book.coverMeta));
    });
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    tails.set(bookId, tail);
    void tail.then(() => {
      if (tails.get(bookId) === tail) tails.delete(bookId);
    });
    return operation;
  };
}

const mutateCoverMetaInOrder = createBookCoverMetaMutationLane({
  read: (bookId) => getBook(bookId),
  write: (bookId, coverMeta) => updateBook(bookId, { coverMeta }),
});

/** Shared authority for every feature that mutates one book's cover metadata. */
export function mutateBookCoverMeta(
  bookId: string,
  mutate: BookCoverMetaMutation,
): Promise<Book | null> {
  return mutateCoverMetaInOrder(bookId, mutate);
}

/**
 * Commit the canonical Book Studio style and its compatibility cover as one
 * row mutation. No observer can persist or read a half-old pair between them.
 */
export function saveBookAppearanceOverrides(
  bookId: string,
  style: Record<string, unknown> | null,
  cover: Record<string, unknown> | null,
): Promise<Book | null> {
  return mutateBookCoverMeta(bookId, (meta) =>
    mergeCoverMetaSections(meta, { style, cover }),
  );
}

/** Persist cover-art overrides for a book (merging other sections through). */
export async function saveCoverOverrides(
  id: string,
  overrides: Record<string, unknown> | null,
): Promise<Book | null> {
  return mutateBookCoverMeta(id, (meta) =>
    mergeCoverMetaSection(meta, 'cover', overrides),
  );
}

/** Persist per-book page defaults (merging other sections through). */
export async function savePageDefaults(
  id: string,
  defaults: BookPageDefaults | null,
): Promise<Book | null> {
  return mutateBookCoverMeta(id, (meta) =>
    mergeCoverMetaSection(
      meta,
      'pageDefaults',
      defaults as Record<string, unknown> | null,
    ),
  );
}

/** Perform one shelf metadata patch after this book's preceding patch settles. */
function patchShelfMeta(
  id: string,
  patch: ShelfMeta,
): Promise<Book | null> {
  return mutateBookCoverMeta(id, (meta) => {
    const merged = { ...(readShelfMeta({ coverMeta: meta }) ?? {}), ...patch };
    // Drop keys explicitly set to undefined (used to clear trash bookkeeping).
    for (const key of Object.keys(merged) as Array<keyof ShelfMeta>) {
      if (merged[key] === undefined) delete merged[key];
    }
    return mergeCoverMetaSection(
      meta,
      'shelf',
      merged as Record<string, unknown>,
    );
  });
}

/**
 * Delete a book and all of its pages. Pages are removed explicitly (in
 * addition to the schema's ON DELETE CASCADE) so behavior does not depend
 * on the connection's foreign-key pragma.
 */
export async function deleteBook(id: string): Promise<boolean> {
  const db = await getDb();
  const pageRows = await db.select<Array<{ id: string }>>(
    'SELECT id FROM pages WHERE book_id = $1',
    [id],
  );
  for (const page of pageRows) {
    await db.execute(
      'DELETE FROM settings WHERE key = $1 OR key = $2',
      [`page_history:${page.id}`, `page_flow_start:${page.id}`],
    );
  }
  await db.execute('DELETE FROM pages WHERE book_id = $1', [id]);
  await db.execute('DELETE FROM settings WHERE key = $1', [`book_history:${id}`]);
  const result = await db.execute('DELETE FROM books WHERE id = $1', [id]);
  return result.rowsAffected > 0;
}

/* ----------------------------------------------------------------------------
   Wave-2 shelf & library life
   ----------------------------------------------------------------------------
   Trash convention: floor index -1 IS the trash. The shelf only ever
   queries floors >= 0 (listBooksByFloorRange from the virtualizer), so a book
   moved to floor -1 disappears from the case without any schema change. Its
   former position + deletion time live in cover_meta.shelf so restore puts it
   back where it came from. Permanent deletion = deleteBook on a trashed id.

   A trashed book keeps its `bookcase_id`: each case has its own floor -1, so
   restore knows which case to put the book back into, and deleting a case
   takes its drawer with it.
   -------------------------------------------------------------------------- */

/** The floor index that acts as the trash. */
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

/** Books on a single floor, ordered by slot; scoped to one case when given. */
async function listFloor(floor: number, bookcaseId?: string): Promise<Book[]> {
  const db = await getDb();
  const rows =
    bookcaseId === undefined
      ? await db.select<BookRow[]>(
          'SELECT * FROM books WHERE floor = $1 ORDER BY slot ASC',
          [floor],
        )
      : await db.select<BookRow[]>(
          'SELECT * FROM books WHERE floor = $1 AND bookcase_id = $2 ORDER BY slot ASC',
          [floor, bookcaseId],
        );
  return rows.map(rowToBook);
}

/**
 * Smallest free slot index on a floor at or after `from`.
 * Slots are sparse integers; gaps are expected and fine.
 *
 * Scope it to a bookcase whenever the answer is about to be written back as a
 * position: two cases each have their own slot 0, and an unscoped call would
 * push a book sideways to dodge a neighbour standing in a different room.
 */
export async function nextFreeSlot(
  floor: number,
  from = 0,
  bookcaseId?: string,
): Promise<number> {
  const taken = new Set((await listFloor(floor, bookcaseId)).map((b) => b.slot));
  let slot = Math.max(0, Math.round(from));
  while (taken.has(slot)) slot += 1;
  return slot;
}

export interface DuplicateBookOptions {
  /** False copies the complete exterior onto a fresh, empty book. */
  readonly includePages?: boolean;
}

/**
 * Duplicate a book, landing beside it in the same bookcase.
 *
 * The procedural seed is part of the exterior. Omitting it was the subtle
 * defect behind copies that kept an explicitly chosen colour but rerolled
 * their emblem, material construction and other seed-owned decisions.
 * Binding presets live in designPrefs and are copied by the shelf action after
 * this row exists; this layer owns the row metadata and optional page bodies.
 */
export async function duplicateBook(
  id: string,
  options: DuplicateBookOptions = {},
): Promise<Book | null> {
  const source = await getBook(id);
  if (source === null) return null;
  const includePages = options.includePages !== false;
  const db = await getDb();
  const home = bookcaseOf(source);
  const slot = await nextFreeSlot(source.floor, source.slot + 1, home);
  const copy = await createBook({
    title: `${source.title} copy`,
    bookcaseId: home,
    floor: source.floor,
    slot,
    spineSeed: source.spineSeed,
    coverMeta: source.coverMeta,
  });
  // A duplicate belongs beside its source in ordering, but not literally on
  // top of the source's reader-authored visual anchor.
  if (readShelfMeta(source)?.positionX !== undefined) {
    await patchShelfMeta(copy.id, { positionX: undefined });
  }
  if (includePages) {
    const pages = await db.select<
      Array<{
        ord: number;
        doc_json: string;
        script_source: string | null;
        source_dirty: number;
      }>
    >('SELECT * FROM pages WHERE book_id = $1 ORDER BY ord ASC', [id]);
    const now = new Date().toISOString();
    for (const page of pages) {
      await db.execute(
        'INSERT INTO pages (id, book_id, ord, doc_json, script_source, source_dirty, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          nanoid(),
          copy.id,
          page.ord,
          page.doc_json,
          page.script_source,
          page.source_dirty,
          now,
        ],
      );
    }
  }
  return (await updateBookPageCount(copy.id)) ?? copy;
}

/** Soft-delete: move the book to the trash (floor -1). */
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
  const slot = await nextFreeSlot(floor, meta?.prevSlot ?? 0, bookcaseOf(book));
  await patchShelfMeta(id, {
    deletedAt: undefined,
    prevFloor: undefined,
    prevSlot: undefined,
  });
  return moveBook(id, floor, slot);
}

function byDeletedAtDesc(a: Book, b: Book): number {
  const da = readShelfMeta(a)?.deletedAt ?? '';
  const db_ = readShelfMeta(b)?.deletedAt ?? '';
  return da < db_ ? 1 : da > db_ ? -1 : 0;
}

/**
 * Every trashed book in the library, most recently deleted first.
 *
 * **The trash is ONE drawer for the whole library, and that is the decision,
 * not an accident of this signature.** A reader opens the trash because
 * something they wrote is gone, and the one thing they reliably do not
 * remember is which bookcase it was standing in; a per-case drawer would
 * answer "it is not here" about a book two clicks away. What the panel owes
 * them in exchange is a LABEL — `features/bookshelf/TrashPanel.tsx` names the
 * case on every row, because `restoreBook` puts a book back in its own case
 * and that can be a shelf the reader is not looking at.
 *
 * Deliberately parameterless as well: the panel passes this straight to
 * `createResource`, and an optional argument there would be bound to the
 * resource's source value rather than to a bookcase. Use
 * `listTrashedBooksIn()` for one case.
 */
export async function listTrashedBooks(): Promise<Book[]> {
  return (await listFloor(TRASH_FLOOR)).sort(byDeletedAtDesc);
}

/**
 * One bookcase's trash drawer. A trashed book never leaves the case it came
 * from — that is what lets restore put it back where it stood.
 *
 * Scoped in SQL, so a row whose `bookcase_id` never got written is in NOBODY's
 * drawer here, while `bookcaseOf` folds it into the default case. The panel's
 * "this bookcase" filter therefore narrows the library-wide list with
 * `bookcaseOf` rather than calling this, so the filter and the case chip can
 * never disagree; this stays for callers that want the indexed query and can
 * assume the orphan sweep in `ensureBookcases()` has run.
 */
export async function listTrashedBooksIn(bookcaseId: string): Promise<Book[]> {
  return (await listFloor(TRASH_FLOOR, bookcaseId)).sort(byDeletedAtDesc);
}

/**
 * Permanently delete every book in the trash. Returns count.
 *
 * Scope it to the rows the reader is actually looking at: unscoped means the
 * WHOLE library's drawer, and a confirm shown over one bookcase's list that
 * then shreds another case's books is the reason the panel names its scope.
 */
export async function emptyTrash(bookcaseId?: string): Promise<number> {
  const books = await listFloor(TRASH_FLOOR, bookcaseId);
  for (const book of books) await deleteBook(book.id);
  return books.length;
}

/** Highest occupied shelf floor (>= 0), or 0 for an empty case/library. */
export async function maxOccupiedFloor(bookcaseId?: string): Promise<number> {
  const db = await getDb();
  const rows =
    bookcaseId === undefined
      ? await db.select<Array<{ floor: number }>>(
          'SELECT floor FROM books WHERE floor >= 0 ORDER BY floor DESC LIMIT 1',
        )
      : await db.select<Array<{ floor: number }>>(
          'SELECT floor FROM books WHERE floor >= 0 AND bookcase_id = $1 ORDER BY floor DESC LIMIT 1',
          [bookcaseId],
        );
  return rows.length > 0 ? rows[0].floor : 0;
}

