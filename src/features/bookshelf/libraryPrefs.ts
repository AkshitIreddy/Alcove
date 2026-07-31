/**
 * features/bookshelf/libraryPrefs.ts — the "This library" half of the studio.
 *
 * Which room the shelf is (theme), how its wall is finished (backdrop),
 * which wallpaper pattern x colourway hangs on it, how much flora grows and
 * how warm the lamps burn. Persisted as one JSON blob in the `settings` table
 * under key 'library', mirroring src/data/settings.ts's contract (validated
 * merge over defaults, Solid store for components, `subscribe` for the
 * non-reactive Pixi world).
 *
 * These live outside `Settings` on purpose: the settings module is owned by
 * another wave. Folding these six fields into `Settings` later is a drop-in
 * (see the integration note in the module docs) — nothing here reaches into
 * the shelf world directly.
 */

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import {
  DEFAULT_THEME_ID,
  getTheme,
  isThemeId,
  isWallpaperPatternId,
  resolveBackdrop,
  resolveWallpaper,
  type BackdropId,
  type LibraryTheme,
  type ThemeId,
  type WallpaperPatternId,
  type WallpaperSpec,
} from '../../art/themes';
import { getDb } from '../../data/db';
import { libraryKey } from './libraryKey';

const PREFS_KEY = 'library';

/**
 * What a reader can change about their library.
 *
 * There are exactly three things on the screen — the books, the shelf they
 * stand on, and the wall behind it — and the studio used to offer four
 * overlapping controls for the last one: `theme` (which baked its own wall),
 * `backdrop` (papered / panelled / plastered / boarded / shoji), plus
 * `wallpaperPattern` and `colourway`. Picking a wallpaper did nothing
 * whenever the backdrop was a finish with nowhere to put one, which is
 * exactly the "sometimes clicking wallpaper changes nothing" report. The
 * model was wrong, not the reader.
 *
 * So the wall is one thing with two knobs: an optional pattern that defaults
 * to none, and how much physical relief that pattern has.
 */
export interface LibraryPrefs {
  theme: ThemeId;
  /** `null` = a plain wall. The default, and it has to stay usable. */
  wallpaperPattern: WallpaperPatternId | null;
  /**
   * How raised the wall's surface reads, 0 (flat paint) → 1 (deep relief).
   * Drives the strength of the wall's own shading, not a separate texture.
   */
  wallDepth: number;
}

export const DEFAULT_LIBRARY_PREFS: LibraryPrefs = {
  theme: DEFAULT_THEME_ID,
  wallpaperPattern: null,
  wallDepth: 0.35,
};

/** Validated merge of an unknown stored blob over the defaults. Total. */
export function mergeLibraryPrefs(raw: unknown): LibraryPrefs {
  const d = DEFAULT_LIBRARY_PREFS;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...d };
  const s = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    theme: isThemeId(s.theme) ? s.theme : d.theme,
    wallpaperPattern: isWallpaperPatternId(s.wallpaperPattern) ? s.wallpaperPattern : null,
    wallDepth: num(s.wallDepth, d.wallDepth, 0, 1),
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
  theme: LibraryTheme;
  wallpaper: WallpaperSpec;
  backdrop: BackdropId;
  /** Cache/bake key — identical strings ⇒ identical case art. */
  key: string;
}

export function resolveLibrary(prefs: LibraryPrefs): ResolvedLibrary {
  const theme = getTheme(prefs.theme);
  // Colourway is no longer a control — the wall is one authored surface and
  // the pattern, if any, sits on top of it in the room's own colour.
  const wallpaper = resolveWallpaper(theme, {
    pattern: prefs.wallpaperPattern,
    colourway: null,
  });
  // Likewise the backdrop finish: it duplicated the wall and silently voided
  // the pattern picker. The room's own first choice stands.
  const backdrop = resolveBackdrop(theme, null);
  return {
    prefs,
    theme,
    wallpaper,
    backdrop,
    key: libraryKey(theme.id, wallpaper, backdrop),
  };
}
