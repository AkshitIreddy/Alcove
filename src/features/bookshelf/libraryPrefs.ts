/**
 * features/bookshelf/libraryPrefs.ts — the "This library" half of the studio.
 *
 * Which room the shelf is, and nothing else. Persisted as one JSON blob in the
 * `settings` table under key 'library', mirroring src/data/settings.ts's
 * contract (validated merge over defaults, Solid store for components,
 * `subscribe` for the non-reactive Pixi world).
 *
 * These live outside `Settings` on purpose: the settings module is owned by
 * another wave. Folding the field into `Settings` later is a drop-in — nothing
 * here reaches into the shelf world directly.
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
import { getDb } from '../../data/db';
import { libraryKey } from './libraryKey';

const PREFS_KEY = 'library';

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
}

export const DEFAULT_LIBRARY_PREFS: LibraryPrefs = {
  theme: DEFAULT_THEME_ID,
  shelf: null,
  wall: null,
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
  };
}

const [store, setStore] = createStore<LibraryPrefs>({ ...DEFAULT_LIBRARY_PREFS });
const [revision, setRevision] = createSignal(0);

/** Reactive read-only view for Solid components. */
export const libraryPrefs: LibraryPrefs = store;

let loadPromise: Promise<LibraryPrefs> | null = null;

export function loadLibraryPrefs(): Promise<LibraryPrefs> {
  loadPromise ??= (async () => {
    let raw: unknown = null;
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [PREFS_KEY],
      );
      if (rows.length > 0) raw = JSON.parse(rows[0].value);
    } catch {
      raw = null; // missing table / corrupt blob → defaults, never throw
    }
    const merged = mergeLibraryPrefs(raw);
    setStore(reconcile(merged));
    setRevision((r) => r + 1);
    return { ...merged };
  })();
  return loadPromise;
}

/** Apply a patch, update the reactive store, persist the whole blob. */
export async function saveLibraryPrefs(
  patch: Partial<LibraryPrefs>,
): Promise<LibraryPrefs> {
  await loadLibraryPrefs();
  const next: LibraryPrefs = mergeLibraryPrefs({ ...unwrap(store), ...patch });
  setStore(reconcile(next));
  setRevision((r) => r + 1);
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      PREFS_KEY,
      JSON.stringify(next),
    ]);
  } catch {
    // Persistence is best-effort; the session still shows the new room.
  }
  return { ...next };
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
  const scheme: ColourScheme = {
    timber: shelf.timber,
    timberDark: shelf.timberDark,
    recess: shelf.recess,
    wall: wall.wall,
    cloths: shelf.cloths,
  };
  return {
    prefs,
    theme,
    scheme,
    // Both parts are in the key: the disk cache validates nothing about a hit,
    // so a case baked with reef timber would otherwise be served to a room
    // that only borrowed reef's wall.
    key: `${libraryKey(theme)}|s=${partTheme(prefs, 'shelf')}|w=${partTheme(prefs, 'wall')}`,
  };
}
