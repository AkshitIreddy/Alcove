/**
 * features/bookshelf/libraryPrefs.ts — the "This library" half of the studio.
 *
 * Which room the shelf is, and nothing else. It used to be one JSON blob in
 * `settings` under key 'library'; a room now belongs to a BOOKCASE, and this
 * module is the validated view of whichever case is open. The public surface
 * is unchanged on purpose — the studio still reads `libraryPrefs` and calls
 * `saveLibraryPrefs`, and gets per-case rooms for free — but two consequences
 * are worth knowing:
 *
 *  - switching bookcase repaints the room, because the subscription below is
 *    fed by the bookcase store rather than by a single settings key;
 *  - saving writes to the OPEN case only, so decorating one bookcase never
 *    touches another.
 *
 * The old 'library' key is read exactly once, by the bookcase migration, so an
 * upgrading reader opens in the room they left.
 */

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import {
  DEFAULT_THEME_ID,
  getTheme,
  isThemeId,
  type ColourScheme,
  type LibraryTheme,
  type ThemeId,
} from '../../art/themes';
import {
  activeBookcaseId,
  loadBookcases,
  setBookcaseRoom,
  snapshotBookcases,
  subscribeBookcases,
  type BookcaseState,
} from '../../data/bookcases';
import { normaliseHex } from '../../art/customColour';
import { caseFaces, paleAbove } from '../../art/palette';
import { libraryKey } from './libraryKey';

/**
 * What a reader can change about their library: the room.
 *
 * It was five fields, then three. The wall carried `wallpaperPattern` and
 * `wallDepth` right up until this pass, and both had been inert since the flat
 * restyle — the wall is one flat fill, so eighteen patterns hung on nothing and
 * a "surface depth" slider drove a relief that is not drawn. Persisting a
 * control the app cannot honour is how the studio came to have knobs that do
 * nothing; a room's colour scheme is the one thing here that reaches the screen.
 */
export interface LibraryPrefs {
  /**
   * The whole-room preset. Picking one is the fast path, and it supplies the
   * default for each of the three parts below.
   */
  theme: ThemeId;
  /**
   * The three things actually on screen, each free to come from a different
   * room. `null` means "follow `theme`".
   *
   * A room used to be indivisible, which meant liking one room's timber and
   * another's books was not expressible — you took all three or none. These
   * are the same four schemes, just selectable per part, so the presets stay
   * one click while the parts stay independent.
   */
  shelf: ThemeId | null;
  wall: ThemeId | null;
  /**
   * Colours the READER typed, `#rrggbb`, overruling the room those two parts
   * would otherwise borrow. `null` — the normal case — means "whatever the
   * scheme says".
   *
   * Two fields and not five: a reader picks the TIMBER and the WALL, and the
   * turned face and the dark of the recess are derived from the timber by
   * `palette.caseFaces` rather than offered. That is not a shortcut. The fold
   * between a board's three faces is what makes the case read as one object,
   * and three independent hexes is three ways to break it — the sixty rooms
   * themselves are authored the same way, from one timber each.
   *
   * They are hexes and never theme ids because they are by definition not in
   * the table of sixty; `art/customColour.ts` states that rule for the whole
   * app and `normaliseHex` here is its normaliser, so a colour typed into a
   * callout can be pasted onto a bookcase.
   */
  timberHex: string | null;
  wallHex: string | null;
}

export const DEFAULT_LIBRARY_PREFS: LibraryPrefs = {
  theme: DEFAULT_THEME_ID,
  shelf: null,
  wall: null,
  timberHex: null,
  wallHex: null,
};

/**
 * The room each part actually comes from.
 *
 * There are two parts, not three. A `books` part existed here briefly and was
 * a mistake: it repainted every book on every shelf at once, which is exactly
 * what stops you recognising your own book. Book colour belongs to the book —
 * seeded from its own identity, changed one at a time in the book studio.
 */
export function partTheme(prefs: LibraryPrefs, part: 'shelf' | 'wall'): ThemeId {
  return prefs[part] ?? prefs.theme;
}

/** Validated merge of an unknown stored blob over the defaults. Total. */
export function mergeLibraryPrefs(raw: unknown): LibraryPrefs {
  const d = DEFAULT_LIBRARY_PREFS;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...d };
  const s = raw as Record<string, unknown>;
  // Blobs written before this pass carry `wallpaperPattern`/`wallDepth`, and
  // libraries saved in one of the ten retired rooms carry a `theme` that is no
  // longer an id. Both are dropped here rather than migrated: the extra keys
  // never round-trip back out, and an unknown room resolves to the default.
  const part = (v: unknown): ThemeId | null => (isThemeId(v) ? v : null);
  return {
    theme: isThemeId(s.theme) ? s.theme : d.theme,
    shelf: part(s.shelf),
    wall: part(s.wall),
    // `normaliseHex` returns null for anything it cannot re-serialise as a
    // hex, which is exactly the value that means "follow the room" — so an
    // unreadable colour and an absent one land in the same place without a
    // second branch.
    timberHex: normaliseHex(s.timberHex),
    wallHex: normaliseHex(s.wallHex),
  };
}

const [store, setStore] = createStore<LibraryPrefs>({ ...DEFAULT_LIBRARY_PREFS });
const [revision, setRevision] = createSignal(0);

/** Reactive read-only view for Solid components. */
export const libraryPrefs: LibraryPrefs = store;

let loadPromise: Promise<LibraryPrefs> | null = null;
let wired = false;

/** Parse a bookcase's `room` column into validated prefs. Total. */
export function roomToPrefs(room: string | null | undefined): LibraryPrefs {
  if (typeof room !== 'string' || room.length === 0) {
    return { ...DEFAULT_LIBRARY_PREFS };
  }
  try {
    return mergeLibraryPrefs(JSON.parse(room));
  } catch {
    // A corrupt room blob opens the default room rather than a blank screen.
    return { ...DEFAULT_LIBRARY_PREFS };
  }
}

/** Publish the open case's room into the reactive store. */
function adopt(state: BookcaseState): LibraryPrefs {
  const open = state.list.find((c) => c.id === state.activeId);
  const next = roomToPrefs(open?.room);
  setStore(reconcile(next));
  setRevision((r) => r + 1);
  return { ...next };
}

export function loadLibraryPrefs(): Promise<LibraryPrefs> {
  loadPromise ??= (async () => {
    const state = await loadBookcases();
    if (!wired) {
      wired = true;
      // Fires immediately, and then on every case switch / room save. This is
      // what makes "switch bookcase" repaint the room without the studio or
      // the world knowing that a room is stored on a case at all.
      subscribeBookcases((next) => {
        adopt(next);
      });
    }
    return adopt(state);
  })();
  return loadPromise;
}

/**
 * Apply a patch to the OPEN bookcase's room and persist it.
 *
 * The store is updated optimistically before the write so the shelf repaints
 * on the same frame the reader clicks; `setBookcaseRoom` then notifies, and
 * `adopt` re-publishes the value that actually landed.
 */
export async function saveLibraryPrefs(
  patch: Partial<LibraryPrefs>,
): Promise<LibraryPrefs> {
  await loadLibraryPrefs();
  const next: LibraryPrefs = mergeLibraryPrefs({ ...unwrap(store), ...patch });
  setStore(reconcile(next));
  setRevision((r) => r + 1);
  await setBookcaseRoom(activeBookcaseId(), JSON.stringify(next));
  return { ...next };
}

/** The room of a specific bookcase, without opening it (picker previews). */
export function prefsForBookcase(id: string): LibraryPrefs {
  const found = snapshotBookcases().list.find((c) => c.id === id);
  return roomToPrefs(found?.room);
}

/** Detached snapshot of the current prefs (non-reactive readers, QA hooks). */
export function snapshotLibraryPrefs(): LibraryPrefs {
  return { ...unwrap(store) };
}

/**
 * Subscribe from non-Solid code (the Pixi world). Fires immediately with the
 * current snapshot, then after every load/save. Snapshots are detached.
 */
export function subscribeLibraryPrefs(
  listener: (prefs: LibraryPrefs) => void,
): () => void {
  return createRoot((dispose) => {
    createEffect(on(revision, () => listener({ ...unwrap(store) })));
    return dispose;
  });
}

/* ------------------------------ derivations ------------------------------ */

/** Everything the shelf needs to bake a room, derived from one prefs blob. */
export interface ResolvedLibrary {
  prefs: LibraryPrefs;
  /**
   * The preset, kept for its name and spine bias. Its `scheme` is NOT what
   * gets drawn — `scheme` below is, and the two differ whenever a part has
   * been picked from another room.
   */
  theme: LibraryTheme;
  /** The colours actually drawn: shelf from one room, books and wall from any. */
  scheme: ColourScheme;
  /** Cache/bake key — identical strings ⇒ identical case art. */
  key: string;
}

/**
 * Compose the drawn scheme from up to three rooms.
 *
 * Each part takes only the fields it owns, so the seams are exactly where a
 * reader would expect them: the shelf is the timber and the recess behind it,
 * the wall is one flat colour, and the books are the six cloths. Nothing else
 * in the palette is per-room — the ink, cream and gilt are fixed everywhere,
 * which is what keeps a mixed room looking like one drawing rather than three.
 */
export function resolveLibrary(prefs: LibraryPrefs): ResolvedLibrary {
  const theme = getTheme(prefs.theme);
  const shelf = getTheme(partTheme(prefs, 'shelf')).scheme;
  const wall = getTheme(partTheme(prefs, 'wall')).scheme;

  /*
   * A colour of the reader's own displaces the borrowed room's, one part at a
   * time — and it is FOLDED, not pasted:
   *
   *  - `caseFaces` derives the turned face and the recess from the lit one,
   *    with the same measured OKLCh steps the sixty authored rooms use, and
   *    lifts the whole board if the reader's colour is so dark the recess
   *    would go under `FLAT.ink`. A flat hex in all three slots is a bookcase
   *    with no fold in it, which stops reading as a box.
   *  - `paleAbove` keeps the wall clear of the timber. That is not taste: the
   *    wall being the lightest thing on screen is what makes the case read as
   *    furniture standing in a room rather than as a hole cut in the backdrop,
   *    and it only bites when the reader's wall would have gone under their
   *    own case — a pale colour passes through untouched.
   *
   * Clamping rather than refusing, throughout. Refusing a colour a reader has
   * already chosen is the rudest thing a picker can do (see
   * `art/customColour.ts`), and every clamp here still lands on the colour
   * they asked for, only far enough into the band that the drawing survives.
   */
  const ownTimber = normaliseHex(prefs.timberHex);
  const board = ownTimber === null ? shelf : caseFaces(ownTimber);
  const ownWall = normaliseHex(prefs.wallHex);

  const scheme: ColourScheme = {
    timber: board.timber,
    timberDark: board.timberDark,
    recess: board.recess,
    wall: ownWall === null ? wall.wall : paleAbove(ownWall, board.timber),
    cloths: shelf.cloths,
  };
  return {
    prefs,
    theme,
    scheme,
    // Both parts are in the key: the bake cache validates nothing about a hit,
    // so a case baked with reef timber would otherwise be served to a room
    // that only borrowed reef's wall. The reader's own hexes are in it for the
    // same reason and are load-bearing in a way the part ids are not — a
    // custom colour does not change the room's NAME, so without them every
    // colour a reader mixed would share one key with the room it started from.
    key:
      `${libraryKey(theme)}|s=${partTheme(prefs, 'shelf')}|w=${partTheme(prefs, 'wall')}` +
      `|t#=${prefs.timberHex ?? '-'}|w#=${prefs.wallHex ?? '-'}`,
  };
}
