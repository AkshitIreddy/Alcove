/**
 * src/data/bookcases.ts — a library is a COLLECTION of bookcases.
 *
 * Each bookcase is a piece of furniture with a name, a room (its own colour
 * scheme), a floor count, and its own books. Switching bookcase changes the
 * case AND the books standing in it; nothing is shared but the app.
 *
 * Three things live here, in this order:
 *
 *  1. the `bookcases` table (rows in, rows out — no reactivity);
 *  2. `ensureBookcases()`, the migration that folds a pre-bookcase library
 *     into one default case without losing a single book;
 *  3. the reactive store + the API the studio calls.
 *
 * The reactive half sits in src/data rather than src/features because
 * src/data/settings.ts already establishes the pattern (Solid store for
 * components, `subscribe` for the non-reactive Pixi world) and because the
 * shelf is not the only surface that will want the list.
 *
 * Import direction: this module imports src/data/books.ts (to cascade a
 * delete), and books.ts imports NOTHING from here — it reads the open case
 * straight out of `settings`. That keeps the two free of a cycle.
 */

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import { nanoid } from 'nanoid';
import { DEFAULT_THEME_ID, THEME_IDS, type ThemeId } from '../art/themes';
import {
  DEFAULT_BOOKCASE_ID,
  deleteBook,
  listBooksInBookcase,
  maxOccupiedFloor,
  readActiveBookcaseId,
  writeActiveBookcaseId,
} from './books';
import { getDb, type Db } from './db';

/* ============================== floor counts ============================== */

/**
 * Floors a fresh bookcase shows. Ten, not infinity.
 *
 * The shelf used to be endless downward, which sounds generous and reads as
 * unfinished: you could always scroll into more nothing, and the case had no
 * bottom to rest on. A bookcase is now a real object with a real height, and
 * "add a floor" is a thing the reader asks for once the ten are full.
 */
export const DEFAULT_FLOOR_COUNT = 10;

/** A bookcase always has at least one floor to stand books on. */
export const MIN_FLOOR_COUNT = 1;

/**
 * Upper bound on floors. Not a storage limit — a legibility one: past this the
 * whole-case zoom-out stops being a picture of a bookcase.
 */
export const MAX_FLOOR_COUNT = 60;

/** Total, never NaN. Anything unusable degrades to the default. */
export function clampFloorCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_FLOOR_COUNT;
  return Math.min(MAX_FLOOR_COUNT, Math.max(MIN_FLOOR_COUNT, Math.round(n)));
}

/* ================================ the model =============================== */

export interface Bookcase {
  id: string;
  name: string;
  /** Position in the picker (ascending). */
  ord: number;
  /**
   * The case's own room: a `LibraryPrefs` JSON blob, or null to follow the
   * app default. Opaque here on purpose — `features/bookshelf/libraryPrefs`
   * owns the shape and is the only thing that parses it, so the storage layer
   * can never disagree with the validator about what a room is.
   */
  room: string | null;
  /** How many floors this case shows (>= 1). */
  floors: number;
  createdAt: string;
  updatedAt: string;
}

/** Raw `bookcases` table row. */
export interface BookcaseRow {
  id: string;
  name: string;
  ord: number;
  room: string | null;
  floors: number;
  created_at: string;
  updated_at: string;
}

function rowToBookcase(row: BookcaseRow): Bookcase {
  return {
    id: row.id,
    name: typeof row.name === 'string' && row.name.length > 0 ? row.name : 'Bookcase',
    ord: Number.isFinite(row.ord) ? row.ord : 0,
    room: typeof row.room === 'string' && row.room.length > 0 ? row.room : null,
    floors: clampFloorCount(row.floors),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The case a brand-new library gets, before anything is stored. */
export function defaultBookcase(now = new Date().toISOString()): Bookcase {
  return {
    id: DEFAULT_BOOKCASE_ID,
    name: 'My Library',
    ord: 0,
    room: null,
    floors: DEFAULT_FLOOR_COUNT,
    createdAt: now,
    updatedAt: now,
  };
}

export { DEFAULT_BOOKCASE_ID };

/* ================================ the table =============================== */

/** Every bookcase, in picker order. Never throws — a broken read is []. */
export async function listBookcaseRows(): Promise<Bookcase[]> {
  try {
    const db = await getDb();
    const rows = await db.select<BookcaseRow[]>(
      'SELECT * FROM bookcases ORDER BY ord ASC',
    );
    return rows.map(rowToBookcase);
  } catch {
    return [];
  }
}

async function getBookcaseRow(id: string): Promise<Bookcase | null> {
  try {
    const db = await getDb();
    const rows = await db.select<BookcaseRow[]>(
      'SELECT * FROM bookcases WHERE id = $1 LIMIT 1',
      [id],
    );
    return rows.length > 0 ? rowToBookcase(rows[0]) : null;
  } catch {
    return null;
  }
}

async function insertBookcaseRow(bookcase: Bookcase): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT INTO bookcases (id, name, ord, room, floors, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      bookcase.id,
      bookcase.name,
      bookcase.ord,
      bookcase.room,
      bookcase.floors,
      bookcase.createdAt,
      bookcase.updatedAt,
    ],
  );
}

/**
 * Patch one bookcase. Column names are from a closed set (never user input),
 * and placeholders are emitted in ascending order because SQLite numbers `$N`
 * by first appearance rather than by the digits.
 */
async function patchBookcaseRow(
  id: string,
  patch: Partial<Pick<Bookcase, 'name' | 'ord' | 'room' | 'floors'>>,
): Promise<Bookcase | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const push = (column: string, value: unknown): void => {
    binds.push(value);
    sets.push(`${column} = $${binds.length}`);
  };
  if (patch.name !== undefined) push('name', patch.name);
  if (patch.ord !== undefined) push('ord', patch.ord);
  if (patch.room !== undefined) push('room', patch.room);
  if (patch.floors !== undefined) push('floors', clampFloorCount(patch.floors));
  if (sets.length === 0) return getBookcaseRow(id);

  push('updated_at', new Date().toISOString());
  binds.push(id);
  try {
    const db = await getDb();
    await db.execute(
      `UPDATE bookcases SET ${sets.join(', ')} WHERE id = $${binds.length}`,
      binds,
    );
  } catch {
    return getBookcaseRow(id);
  }
  return getBookcaseRow(id);
}

async function deleteBookcaseRow(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM bookcases WHERE id = $1', [id]);
}

/* =============================== the migration ============================ */
/*
 * The riskiest change in the whole feature: every existing book has to end up
 * in a bookcase, exactly once, and a second run must be a no-op.
 *
 * Three independent guards, deliberately overlapping:
 *
 *  1. **SQLite does the assignment.** Migration 2 in src-tauri/src/lib.rs adds
 *     `bookcase_id TEXT NOT NULL DEFAULT 'case-default'`, which back-fills
 *     every existing row inside the migrator's transaction. There is no moment
 *     at which a book has no case, and sqlx will not replay the version.
 *  2. **A version key gates the one-time work** below (adopting the reader's
 *     old room, sizing the case to a library that already went deeper than ten
 *     floors). Cheap to check, and it is what "must not run twice" means.
 *  3. **Every step is independently idempotent anyway**, and the orphan sweep
 *     runs on EVERY start. Guard 2 could be wiped and nothing would double up;
 *     the browser-dev stub, which has no DDL and therefore no guard 1 at all,
 *     relies on exactly this.
 */

/** Bump when the bookcase back-fill needs to do something new. */
export const BOOKCASE_VERSION = 1;

/** `settings` key holding the last-applied bookcase migration version. */
export const BOOKCASE_VERSION_KEY = 'bookcaseVersion';

/** The pre-bookcase room blob, kept so an upgrade opens in the same library. */
const LEGACY_LIBRARY_KEY = 'library';

async function readBookcaseVersion(db: Db): Promise<number> {
  try {
    const rows = await db.select<Array<{ value: string }>>(
      'SELECT value FROM settings WHERE key = $1 LIMIT 1',
      [BOOKCASE_VERSION_KEY],
    );
    if (rows.length === 0) return 0;
    const parsed = Number.parseInt(rows[0].value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

async function writeBookcaseVersion(db: Db, version: number): Promise<void> {
  await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
    BOOKCASE_VERSION_KEY,
    String(version),
  ]);
}

/**
 * Guarantee at least one bookcase exists. On real SQLite the migration's
 * `INSERT OR IGNORE` already did this; the browser stub has no DDL, so the
 * row is born here instead.
 */
async function ensureDefaultBookcaseRow(): Promise<Bookcase> {
  const existing = await listBookcaseRows();
  if (existing.length > 0) return existing[0];
  const fresh = defaultBookcase();
  try {
    await insertBookcaseRow(fresh);
  } catch {
    // A racing writer got there first — re-read rather than assume.
  }
  return (await getBookcaseRow(fresh.id)) ?? fresh;
}

/**
 * The one-time part: an upgrading library keeps the room it was last in, and
 * a case that already used more than ten floors keeps its height.
 *
 * Both writes are conditional on the field still being untouched, so running
 * this twice cannot overwrite a choice the reader has since made.
 */
async function adoptLegacyLibrary(db: Db, target: Bookcase): Promise<void> {
  const patch: Partial<Pick<Bookcase, 'room' | 'floors'>> = {};

  if (target.room === null) {
    try {
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [LEGACY_LIBRARY_KEY],
      );
      const blob = rows[0]?.value;
      if (typeof blob === 'string' && blob.length > 0) patch.room = blob;
    } catch {
      // No legacy room: the case opens in the app default, which is fine.
    }
  }

  // A library that had books on floor 13 must not lose four floors of shelf.
  const deepest = await maxOccupiedFloor(target.id);
  const needed = clampFloorCount(Math.max(DEFAULT_FLOOR_COUNT, deepest + 1));
  if (needed > target.floors) patch.floors = needed;

  if (Object.keys(patch).length > 0) await patchBookcaseRow(target.id, patch);
}

/**
 * Sweep books that somehow have no case into `homeId`. Runs on every start,
 * not just on the migration: the stub writes rows without the column, and a
 * reverted import (features/transfer) re-inserts historical rows verbatim.
 * `WHERE bookcase_id IS NULL` matches a missing key in the stub and a real
 * NULL in SQLite, and touches nothing once the sweep is clean.
 */
async function adoptOrphanBooks(db: Db, homeId: string): Promise<number> {
  let adopted = 0;
  for (const where of ['bookcase_id IS NULL', "bookcase_id = ''"]) {
    try {
      const result = await db.execute(
        `UPDATE books SET bookcase_id = $1 WHERE ${where}`,
        [homeId],
      );
      adopted += result.rowsAffected;
    } catch {
      // A dialect that cannot run one of these still gets the other.
    }
  }
  return adopted;
}

let migrationPromise: Promise<Bookcase> | null = null;

/**
 * Make the bookcase world consistent, once per session. Returns the case that
 * orphans were adopted into (the first one in picker order).
 */
export function ensureBookcases(): Promise<Bookcase> {
  migrationPromise ??= (async () => {
    const db = await getDb();
    const home = await ensureDefaultBookcaseRow();
    // Adoption comes FIRST. Sizing the case to its deepest book is a scoped
    // query, and a book with no case is invisible to one — do this the other
    // way round and an upgrading fourteen-floor library silently opens at ten.
    await adoptOrphanBooks(db, home.id);
    if ((await readBookcaseVersion(db)) < BOOKCASE_VERSION) {
      await adoptLegacyLibrary(db, home);
      try {
        await writeBookcaseVersion(db, BOOKCASE_VERSION);
      } catch {
        // Unwritable version key: the guards above still hold, so the next
        // start simply re-runs work that is a no-op by construction.
      }
    }
    return (await getBookcaseRow(home.id)) ?? home;
  })();
  return migrationPromise;
}

/** Test hook: forget that the migration ran (fresh module registry equivalent). */
export function resetBookcaseMigrationForTests(): void {
  migrationPromise = null;
  loadPromise = null;
}

/* ============================== reactive store ============================ */

export interface BookcaseState {
  /** Every bookcase, in picker order. Never empty after `loadBookcases()`. */
  list: Bookcase[];
  /** The open bookcase's id. Always present in `list`. */
  activeId: string;
}

const [store, setStore] = createStore<BookcaseState>({
  list: [defaultBookcase()],
  activeId: DEFAULT_BOOKCASE_ID,
});
const [revision, setRevision] = createSignal(0);

/** Reactive read-only view for Solid components. */
export const bookcases: BookcaseState = store;

let loadPromise: Promise<BookcaseState> | null = null;

/** Push a freshly read list into the store and wake every listener. */
function publish(list: Bookcase[], activeId: string): BookcaseState {
  const safeList = list.length > 0 ? list : [defaultBookcase()];
  const safeActive = safeList.some((c) => c.id === activeId)
    ? activeId
    : safeList[0].id;
  setStore(reconcile({ list: safeList, activeId: safeActive }));
  setRevision((r) => r + 1);
  return snapshotBookcases();
}

/** Re-read the table and the open-case pointer, then publish. */
async function refresh(): Promise<BookcaseState> {
  const list = await listBookcaseRows();
  const activeId = await readActiveBookcaseId();
  const state = publish(list, activeId);
  // A pointer at a case that no longer exists is repaired on disk, not just
  // in memory, so the next start does not have to guess again.
  if (state.activeId !== activeId) await writeActiveBookcaseId(state.activeId);
  return state;
}

/** Run the migration, then load the list. Idempotent; safe to call anywhere. */
export function loadBookcases(): Promise<BookcaseState> {
  loadPromise ??= (async () => {
    try {
      await ensureBookcases();
    } catch {
      // Even a failed migration must not stop the shelf from drawing.
    }
    return refresh();
  })();
  return loadPromise;
}

/** Detached snapshot (non-Solid readers, QA hooks). */
export function snapshotBookcases(): BookcaseState {
  const raw = unwrap(store);
  return { list: raw.list.map((c) => ({ ...c })), activeId: raw.activeId };
}

/** The open bookcase's id. Synchronous; defaults before the first load. */
export function activeBookcaseId(): string {
  return store.activeId;
}

/** The open bookcase, or the first one if the pointer is somehow stale. */
export function activeBookcase(): Bookcase {
  const raw = unwrap(store);
  const found = raw.list.find((c) => c.id === raw.activeId);
  return { ...(found ?? raw.list[0] ?? defaultBookcase()) };
}

/** Floors the open bookcase shows. The shelf's vertical extent comes from here. */
export function activeFloorCount(): number {
  return clampFloorCount(activeBookcase().floors);
}

/**
 * Subscribe from non-Solid code (the Pixi world). Fires immediately with the
 * current snapshot, then after every load/create/rename/delete/switch.
 */
export function subscribeBookcases(
  listener: (state: BookcaseState) => void,
): () => void {
  return createRoot((dispose) => {
    createEffect(on(revision, () => listener(snapshotBookcases())));
    return dispose;
  });
}

/* ================================== API =================================== */

/** "Bookcase 2", "Bookcase 3", … — the first free number, not a count. */
export function nextBookcaseName(existing: readonly Bookcase[]): string {
  const taken = new Set(existing.map((c) => c.name));
  for (let n = existing.length + 1; ; n += 1) {
    const name = `Bookcase ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * The room a new case opens in when the caller does not pick one.
 *
 * Cycling the presets rather than repeating the default is the point: a
 * bookcase you switch into should look like somewhere else. This does not
 * violate "a book keeps its own colours" — a book lives in exactly one case,
 * so it only ever sees one room, and it is the OTHER books that appear.
 */
export function defaultThemeForOrd(ord: number): ThemeId {
  const ids = THEME_IDS;
  /*
   * Strided, not consecutive.
   *
   * `THEME_IDS` is grouped by FAMILY so the picker reads as a palette, which
   * means ids 0..n next to each other are shades of the same timber. Walking it
   * one at a time gave a reader who made four cases in a row four browns and
   * the impression the feature did nothing.
   *
   * 23 is coprime with 60, so it still visits all sixty before repeating — the
   * cycle is preserved, only the order changes. It stays coprime for any table
   * size not divisible by 23, and the `% ids.length` keeps it total if it ever
   * is not.
   */
  const STRIDE = 23;
  const index = ((Math.round(ord) * STRIDE) % ids.length + ids.length) % ids.length;
  return ids[index] ?? DEFAULT_THEME_ID;
}

/** Serialize a room choice into the `room` column's blob. */
function roomBlob(theme: ThemeId | null): string | null {
  return theme === null ? null : JSON.stringify({ theme, shelf: null, wall: null });
}

export interface CreateBookcaseInput {
  name?: string;
  /** Room preset; omit for the next preset in rotation, null to follow default. */
  theme?: ThemeId | null;
  floors?: number;
}

/** Add a bookcase to the library. Does NOT switch to it — that is a decision. */
export async function createBookcase(
  input: CreateBookcaseInput = {},
): Promise<Bookcase> {
  await loadBookcases();
  const existing = snapshotBookcases().list;
  const ord = existing.reduce((max, c) => Math.max(max, c.ord + 1), 0);
  const now = new Date().toISOString();
  const wanted = input.name === undefined ? '' : input.name.trim();
  const bookcase: Bookcase = {
    id: `case-${nanoid(10)}`,
    name: wanted.length > 0 ? wanted.slice(0, 60) : nextBookcaseName(existing),
    ord,
    room: roomBlob(input.theme === undefined ? defaultThemeForOrd(ord) : input.theme),
    floors: clampFloorCount(input.floors ?? DEFAULT_FLOOR_COUNT),
    createdAt: now,
    updatedAt: now,
  };
  try {
    await insertBookcaseRow(bookcase);
  } catch {
    // Insert failed (duplicate id, unwritable db): the refresh below reports
    // the truth rather than this optimistic object.
  }
  await refresh();
  return (await getBookcaseRow(bookcase.id)) ?? bookcase;
}

/** Rename a bookcase. Empty names are refused (the picker needs a label). */
export async function renameBookcase(
  id: string,
  name: string,
): Promise<Bookcase | null> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return getBookcaseRow(id);
  const updated = await patchBookcaseRow(id, { name: trimmed.slice(0, 60) });
  await refresh();
  return updated;
}

/**
 * Persist a bookcase's room blob. Called by
 * `features/bookshelf/libraryPrefs.saveLibraryPrefs` — the studio should go
 * through that, not through here, so the blob stays validated.
 */
export async function setBookcaseRoom(
  id: string,
  room: string | null,
): Promise<Bookcase | null> {
  const updated = await patchBookcaseRow(id, { room });
  await refresh();
  return updated;
}

/** Set a bookcase's floor count (clamped to 1..MAX_FLOOR_COUNT). */
export async function setBookcaseFloors(
  id: string,
  floors: number,
): Promise<Bookcase | null> {
  const updated = await patchBookcaseRow(id, { floors: clampFloorCount(floors) });
  await refresh();
  return updated;
}

/**
 * Grow a bookcase by one floor and return the new count. This is what the
 * "add floor" control does now: floors are finite, so the control matters
 * exactly when the ten are full.
 */
export async function addBookcaseFloor(id?: string): Promise<number> {
  const targetId = id ?? activeBookcaseId();
  const current = (await getBookcaseRow(targetId))?.floors ?? DEFAULT_FLOOR_COUNT;
  const next = clampFloorCount(current + 1);
  if (next !== current) await setBookcaseFloors(targetId, next);
  return next;
}

export type DeleteBookcaseOutcome =
  | {
      ok: true;
      /** The case that was removed. */
      deleted: Bookcase;
      /** Books (and their pages) deleted along with it. */
      booksDeleted: number;
      /** The case that is open now. */
      activeId: string;
    }
  | {
      ok: false;
      /**
       * `last-bookcase` — a library always has at least one case.
       * `not-empty`   — it still holds books; pass `withBooks` to mean it.
       * `unknown`     — no such case.
       */
      reason: 'last-bookcase' | 'not-empty' | 'unknown';
      /** How many books stand in it (0 for `unknown`). */
      bookCount: number;
    };

/**
 * Remove a bookcase.
 *
 * **Refuses when the case still holds books**, and says how many, so the UI
 * can ask "delete 12 books too?" rather than guessing on the reader's behalf.
 * Pass `{ withBooks: true }` to go ahead — the books and every one of their
 * pages go with the case. The last remaining bookcase is never deletable: a
 * library with no furniture in it has nowhere to put the next book.
 */
export async function deleteBookcase(
  id: string,
  options: { withBooks?: boolean } = {},
): Promise<DeleteBookcaseOutcome> {
  await loadBookcases();
  const state = snapshotBookcases();
  const target = state.list.find((c) => c.id === id);
  if (target === undefined) return { ok: false, reason: 'unknown', bookCount: 0 };
  if (state.list.length <= 1) {
    return {
      ok: false,
      reason: 'last-bookcase',
      bookCount: (await listBooksInBookcase(id)).length,
    };
  }

  const books = await listBooksInBookcase(id);
  if (books.length > 0 && options.withBooks !== true) {
    return { ok: false, reason: 'not-empty', bookCount: books.length };
  }
  for (const book of books) await deleteBook(book.id);
  await deleteBookcaseRow(id);

  // Deleting the open case moves the reader to a neighbour rather than
  // leaving them staring at furniture that no longer exists.
  if (state.activeId === id) {
    const fallback = state.list.find((c) => c.id !== id);
    if (fallback !== undefined) await writeActiveBookcaseId(fallback.id);
  }
  const next = await refresh();
  return {
    ok: true,
    deleted: target,
    booksDeleted: books.length,
    activeId: next.activeId,
  };
}

/**
 * Open a different bookcase. Persists the pointer and notifies every
 * subscriber; the shelf world drops its floors and reloads from the new case,
 * and `libraryPrefs` repaints the room from the new case's blob.
 */
export async function switchBookcase(id: string): Promise<Bookcase> {
  await loadBookcases();
  const known = snapshotBookcases().list.some((c) => c.id === id);
  if (known) await writeActiveBookcaseId(id);
  await refresh();
  return activeBookcase();
}
