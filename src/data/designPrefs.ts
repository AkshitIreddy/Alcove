/**
 * src/data/designPrefs.ts — where the studio keeps the three new
 * vocabularies: the bookcase's carpentry, the wall's paper, and each book's
 * binding.
 *
 * These are NOT colour. `libraryPrefs` owns the room's colour scheme and
 * validates its blob down to three fields, so a build id smuggled through it
 * would be silently dropped on the next read; `bookStyle.normalizeBookStyle-
 * Overrides` does the same to a binding id. Rather than widen either
 * validator from a file the studio does not own, the studio keeps its own
 * book of choices here, in the same `settings` table every other keyed
 * preference lives in.
 *
 * Two scopes, because the vocabularies have two natural owners:
 *  - the CASE owns its build, its timber pattern and its wallpaper, so
 *    switching bookcase walks into a differently-built room (the same way it
 *    already walks into a differently-coloured one);
 *  - the BOOK owns its binding, so a book that is Half Morocco is Half
 *    Morocco in whichever case it is standing in — the same rule that keeps
 *    books from following the room's colours.
 *
 * Every read is total. Values come back out of SQLite unvalidated and a bad
 * one has to give the house bookcase, never an exception inside a bake.
 */

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import {
  normaliseBookPresetId,
  type BookPresetId,
} from '../art/bookDesign';
import {
  DEFAULT_SHELF_DESIGN,
  isBuildId,
  isPatternId,
  type BuildId,
  type PatternId,
  type ShelfDesign,
} from '../art/shelfDesign';
import {
  DEFAULT_WALLPAPER_ID,
  WALLPAPER_DEPTHS,
  WALLPAPER_EDGES,
  WALLPAPER_INKS,
  WALLPAPER_PATTERNS,
  WALLPAPER_SCALES,
  WALLPAPER_TONES,
  wallpaperSpec,
  type WallpaperDepth,
  type WallpaperEdge,
  type WallpaperInk,
  type WallpaperPattern,
  type WallpaperScale,
  type WallpaperSpec,
  type WallpaperTone,
} from '../art/wallpaperDesign';
import { activeBookcaseId, loadBookcases, subscribeBookcases } from './bookcases';
import { getDb } from './db';

/** Everything about one room that is not its colours. */
export interface RoomDesign {
  build: BuildId;
  pattern: PatternId;
  wallpaper: WallpaperSpec;
}

/**
 * The authored house room for a new bookcase.
 *
 * These are opening defaults, not corruption fallbacks: the latter remain the
 * plain plank and bare wall in their owning vocabulary modules.
 */
export const DEFAULT_ROOM_DESIGN: RoomDesign = {
  build: DEFAULT_SHELF_DESIGN.build,
  pattern: DEFAULT_SHELF_DESIGN.pattern,
  wallpaper: wallpaperSpec(DEFAULT_WALLPAPER_ID),
};

/** The `ShelfDesign` half, ready for `drawCaseCard` and the four part drawers. */
export function shelfDesignOf(design: RoomDesign): ShelfDesign {
  return { build: design.build, pattern: design.pattern };
}

interface DesignBook {
  /** Keyed by bookcase id. */
  rooms: Record<string, RoomDesign>;
  /** Keyed by book id. Absent ⇒ the book's seed picks its own binding. */
  books: Record<string, BookPresetId>;
}

const SETTINGS_KEY = 'studioDesigns';

/**
 * Book Studio can persist one logical appearance across two storage lanes:
 * the binding in this settings blob and the style in the Book row. The store
 * remains optimistic so the Studio preview answers immediately, but the Pixi
 * world must not observe the binding half while the matching Book row is
 * still being written. Holds are per book so unrelated edits keep flowing.
 */
interface BookBindingPublicationHoldState {
  depth: number;
  commitRequested: boolean;
}

const bookBindingPublicationHolds = new Map<
  string,
  BookBindingPublicationHoldState
>();

/**
 * The binding generation renderers are allowed to see.
 *
 * `store.books` stays optimistic for the Studio controls. During a combined
 * write this map deliberately stays on the prior binding, so even an unrelated
 * room invalidation cannot bake a staged binding over the old Book style.
 */
const publishedBookBindings = new Map<string, BookPresetId>();

function replacePublishedBookBindings(next: Record<string, BookPresetId>): void {
  publishedBookBindings.clear();
  for (const [bookId, binding] of Object.entries(next)) {
    publishedBookBindings.set(bookId, binding);
  }
}

function publishBookBindingSnapshot(bookId: string): void {
  const binding = unwrap(store).books[bookId];
  if (binding === undefined) publishedBookBindings.delete(bookId);
  else publishedBookBindings.set(bookId, binding);
}

/**
 * Withhold `subscribeBookBindings` delivery for one book until the caller
 * releases the hold.
 *
 * Suppressed changes are deliberately not replayed here. A combined
 * appearance writer publishes the canonical `BookAppearance` event after its
 * Book row has landed, and that event refreshes the row before invalidating
 * the spine. Replaying the binding event first would recreate the exact
 * new-binding + old-style frame this hold exists to prevent.
 */
export function holdBookBindingPublication(
  bookId: string,
): (commit?: boolean) => void {
  const state = bookBindingPublicationHolds.get(bookId);
  if (state === undefined) {
    bookBindingPublicationHolds.set(bookId, {
      depth: 1,
      commitRequested: false,
    });
  } else {
    state.depth += 1;
  }
  let released = false;
  return (commit = false) => {
    if (released) return;
    released = true;
    const current = bookBindingPublicationHolds.get(bookId);
    if (current === undefined) return;
    if (commit) current.commitRequested = true;
    current.depth -= 1;
    if (current.depth > 0) return;
    bookBindingPublicationHolds.delete(bookId);
    if (current.commitRequested) publishBookBindingSnapshot(bookId);
  };
}

function bookBindingPublicationHeld(bookId: string): boolean {
  return (bookBindingPublicationHolds.get(bookId)?.depth ?? 0) > 0;
}

/* ------------------------------- validation ------------------------------ */

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * The same, for an axis that is legitimately absent.
 *
 * `enumOr` with a hard fallback would write `tone: 'auto'` onto a paper that
 * never named one, which is the same picture but a different stored blob —
 * and, once the picker gains a "back to auto" chip, an unreachable state.
 */
function optEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T | undefined,
): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Total: any junk resolves to the default paper rather than to a blank wall. */
export function mergeWallpaperSpec(raw: unknown): WallpaperSpec {
  const d = DEFAULT_ROOM_DESIGN.wallpaper;
  // A bare string is a preset id — that is what an older blob (or a hand-set
  // QA value) is most likely to hold, and `wallpaperSpec` already aliases the
  // four retired names onto real papers.
  if (typeof raw === 'string') return wallpaperSpec(raw);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...d };
  const s = raw as Record<string, unknown>;
  return {
    pattern: enumOr<WallpaperPattern>(s.pattern, WALLPAPER_PATTERNS, d.pattern),
    scale: enumOr<WallpaperScale>(s.scale, WALLPAPER_SCALES, d.scale),
    depth: enumOr<WallpaperDepth>(s.depth, WALLPAPER_DEPTHS, d.depth),
    ink: enumOr<WallpaperInk>(s.ink, WALLPAPER_INKS, d.ink),
    // Optional on the spec, so they must be optional here too — but they still
    // have to survive the round trip. Rebuilding the spec field by field means
    // any axis missing from this list is silently dropped on the next read, so
    // a reader's chosen tone would hold for the session and be gone tomorrow.
    //
    // Absent falls back to ABSENT, not to the default paper's value. These are
    // properties of a particular paper, not house defaults: a reader who picks
    // a trellis and names no tone wants the trellis's own, and inheriting the
    // opening paper's would give them a pinstripe's. It read as correct for as
    // long as the default paper happened to name neither axis, and became
    // wrong the moment one did — which is the argument for not writing a
    // default you did not mean.
    tone: optEnum<WallpaperTone>(s.tone, WALLPAPER_TONES, undefined),
    edge: optEnum<WallpaperEdge>(s.edge, WALLPAPER_EDGES, undefined),
  };
}

/** Total: an unknown build or pattern falls back to the house carpentry. */
export function mergeRoomDesign(raw: unknown): RoomDesign {
  const d = DEFAULT_ROOM_DESIGN;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...d, wallpaper: { ...d.wallpaper } };
  }
  const s = raw as Record<string, unknown>;
  return {
    build: isBuildId(s.build) ? s.build : d.build,
    pattern: isPatternId(s.pattern) ? s.pattern : d.pattern,
    wallpaper: mergeWallpaperSpec(s.wallpaper),
  };
}

function parseBook(raw: string | null | undefined): DesignBook {
  const empty: DesignBook = { rooms: {}, books: {} };
  if (typeof raw !== 'string' || raw.length === 0) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const s = parsed as Record<string, unknown>;
  const rooms: Record<string, RoomDesign> = {};
  if (s.rooms !== null && typeof s.rooms === 'object' && !Array.isArray(s.rooms)) {
    for (const [id, value] of Object.entries(s.rooms as Record<string, unknown>)) {
      rooms[id] = mergeRoomDesign(value);
    }
  }
  const books: Record<string, BookPresetId> = {};
  if (s.books !== null && typeof s.books === 'object' && !Array.isArray(s.books)) {
    for (const [id, value] of Object.entries(s.books as Record<string, unknown>)) {
      // Dropping a stale binding would hand authority back to this book's seed
      // and replace it with an arbitrary style. The binding vocabulary owns
      // the compatibility policy: retired/unknown strings recover to its
      // conservative formal book, while non-string junk remains absent.
      const safe = normaliseBookPresetId(value);
      if (safe !== null) books[id] = safe;
    }
  }
  return { rooms, books };
}

/* --------------------------------- store --------------------------------- */

const [store, setStore] = createStore<DesignBook>({ rooms: {}, books: {} });
const [revision, setRevision] = createSignal(0);

let loadPromise: Promise<void> | null = null;
let wired = false;

function bump(): void {
  setRevision((r) => r + 1);
}

/**
 * Write the whole book back.
 *
 * One blob rather than a row per choice: it is a handful of short strings per
 * bookcase, the studio writes it at click rate rather than at frame rate, and
 * a single key means a half-finished write can never leave a case with a
 * build from one room and a wallpaper from another.
 */
async function persist(): Promise<void> {
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      SETTINGS_KEY,
      JSON.stringify(unwrap(store)),
    ]);
  } catch {
    // Best effort, exactly like the active-bookcase pointer: the session still
    // shows the choice, and a wall that forgets its paper beats a crash.
  }
}

/** Read the book once. Idempotent; safe to call from every panel's onMount. */
export function loadDesignPrefs(): Promise<void> {
  loadPromise ??= (async () => {
    // The bookcase list has to exist before `activeBookcaseId()` means
    // anything, and the studio always wants both.
    await loadBookcases().catch(() => undefined);
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [SETTINGS_KEY],
      );
      const loaded = parseBook(rows[0]?.value);
      setStore(reconcile(loaded));
      replacePublishedBookBindings(loaded.books);
    } catch {
      // No row, no table, no database: the house room is a fine answer.
    }
    if (!wired) {
      wired = true;
      // A case switch changes what `activeRoomDesign()` resolves to without
      // changing this store at all, so non-Solid subscribers (the Pixi world)
      // have to be woken by the bookcase store as well as by our own writes.
      subscribeBookcases(() => bump());
    }
    bump();
  })();
  return loadPromise;
}

/* ------------------------------- room reads ------------------------------ */

/**
 * One case's design. Reactive inside a Solid computation — reading
 * `store.rooms[id]` tracks that key, so a card repaints when its own case is
 * redressed and not when a sibling is.
 */
export function roomDesign(bookcaseId: string): RoomDesign {
  return store.rooms[bookcaseId] ?? DEFAULT_ROOM_DESIGN;
}

/** The open case's design. Tracks the case pointer as well as the design. */
export function activeRoomDesign(): RoomDesign {
  return roomDesign(activeBookcaseId());
}

/** Detached copy, for non-Solid readers (the bake path, QA hooks). */
export function snapshotRoomDesign(bookcaseId?: string): RoomDesign {
  const id = bookcaseId ?? activeBookcaseId();
  const found = unwrap(store).rooms[id];
  const design = found ?? DEFAULT_ROOM_DESIGN;
  return { ...design, wallpaper: { ...design.wallpaper } };
}

/* ------------------------------- room writes ----------------------------- */

/**
 * Merge a patch into one case's design and persist it.
 *
 * Optimistic: the store moves before the write lands so the shelf repaints on
 * the frame the reader clicked, the same bargain `saveLibraryPrefs` makes.
 */
export async function saveRoomDesign(
  patch: Partial<RoomDesign>,
  bookcaseId?: string,
): Promise<RoomDesign> {
  await loadDesignPrefs();
  const id = bookcaseId ?? activeBookcaseId();
  const next = mergeRoomDesign({ ...snapshotRoomDesign(id), ...patch });
  setStore('rooms', id, next);
  bump();
  await persist();
  return next;
}

/** Patch only the wallpaper's axes, leaving the ones not named alone. */
export function saveWallpaper(
  patch: Partial<WallpaperSpec>,
  bookcaseId?: string,
): Promise<RoomDesign> {
  const id = bookcaseId ?? activeBookcaseId();
  return saveRoomDesign({ wallpaper: { ...snapshotRoomDesign(id).wallpaper, ...patch } }, id);
}

/* ------------------------------- book binding ---------------------------- */

/** The binding pinned to this book, or null when its seed still chooses. */
export function bookBinding(bookId: string | null | undefined): BookPresetId | null {
  if (typeof bookId !== 'string' || bookId.length === 0) return null;
  return store.books[bookId] ?? null;
}

/**
 * Binding visible to shelf/open-book renderers at the last complete appearance
 * boundary. Unlike `bookBinding`, this never exposes the optimistic first half
 * of a combined binding + style write.
 */
export function publishedBookBinding(
  bookId: string | null | undefined,
): BookPresetId | null {
  if (typeof bookId !== 'string' || bookId.length === 0) return null;
  return publishedBookBindings.get(bookId) ?? null;
}

/** Pin (or, with null, unpin) a book's binding. */
export async function saveBookBinding(
  bookId: string,
  preset: BookPresetId | null,
): Promise<void> {
  await loadDesignPrefs();
  const safe = normaliseBookPresetId(preset);
  if (safe === null) {
    setStore('books', bookId, undefined as unknown as BookPresetId);
  } else {
    setStore('books', bookId, safe);
  }
  if (!bookBindingPublicationHeld(bookId)) publishBookBindingSnapshot(bookId);
  bump();
  await persist();
}

/* ------------------------------- subscribe ------------------------------- */

/**
 * Subscribe from non-Solid code (the Pixi world's bake path). Fires
 * immediately with the open case's design, then after every change to it —
 * including a bookcase switch, which changes the answer without changing the
 * store.
 */
export function subscribeRoomDesign(
  listener: (design: RoomDesign, bookcaseId: string) => void,
): () => void {
  return createRoot((dispose) => {
    createEffect(
      on(revision, () => {
        const id = activeBookcaseId();
        listener(snapshotRoomDesign(id), id);
      }),
    );
    return dispose;
  });
}

/**
 * Subscribe from non-Solid code to BOOK binding changes, with the ids that
 * moved since the last call.
 *
 * The spine factory guards its bakes on "does this book already have a
 * texture", not on a key, so a re-key alone would never re-draw a restyled
 * book — it has to be told which ones to drop. Fires only for real changes,
 * because the underlying revision also ticks for room edits and bookcase
 * switches, and invalidating every spine on a wallpaper change would re-bake
 * the whole shelf for nothing.
 */
export function subscribeBookBindings(
  listener: (changedBookIds: readonly string[]) => void,
): () => void {
  let previous: Record<string, BookPresetId> = {};
  return createRoot((dispose) => {
    createEffect(
      on(revision, () => {
        const next = { ...unwrap(store).books };
        const changed: string[] = [];
        for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
          if (previous[id] !== next[id]) changed.push(id);
        }
        previous = next;
        // A combined binding + style edit owns its publication boundary. The
        // matching BookAppearance notification will refresh the canonical row
        // and invalidate once both halves are ready; publishing this optimistic
        // half would let the factory bake the new binding over the old style.
        const publishable = changed.filter((id) => !bookBindingPublicationHeld(id));
        if (publishable.length > 0) listener(publishable);
      }),
    );
    return dispose;
  });
}
