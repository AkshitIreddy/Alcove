/**
 * Settings persistence + reactive access.
 *
 * Stored as a single JSON blob in the `settings` table under key 'app'.
 * `load()` merges the stored JSON over `DEFAULT_SETTINGS` with per-field
 * validation, so unknown keys, wrong types, and removed options degrade
 * gracefully. A Solid store backs the reactive surface: components read the
 * exported `settings` proxy; non-Solid code uses `subscribe()`.
 */

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import { getDb } from './db';
import { DEFAULT_SETTINGS } from './defaults';
import type {
  AnimationLevel,
  BookPalette,
  PageStyle,
  Settings,
  ThemeName,
} from './types';

const SETTINGS_KEY = 'app';

type MutableSettings = { -readonly [K in keyof Settings]: Settings[K] };

function cloneSettings(source: Settings): MutableSettings {
  // All fields are primitives except `keybindings`.
  return { ...source, keybindings: { ...source.keybindings } };
}

const [store, setStore] = createStore<MutableSettings>(
  cloneSettings(DEFAULT_SETTINGS),
);
const [revision, setRevision] = createSignal(0);

/**
 * Reactive read-only view of the current settings (fine-grained: reading
 * `settings.theme` inside a Solid computation tracks just that field).
 */
export const settings: Settings = store;

// ---------------------------------------------------------------------------
// Validated merge of stored JSON over defaults
// ---------------------------------------------------------------------------

const THEMES: readonly ThemeName[] = ['parchment', 'pastel', 'botanical', 'night'];
const PAGE_STYLES: readonly PageStyle[] = ['ruled', 'grid', 'blank', 'dotted'];
const ANIMATION_LEVELS: readonly AnimationLevel[] = ['full', 'reduced', 'off'];
const BOOK_PALETTES: readonly BookPalette[] = [
  'amber',
  'terracotta',
  'moss',
  'lemon',
  'sky',
  'blush',
  'plum',
  'peach',
  'sage',
  'lavender',
  'sand',
  'slate',
];

function takeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function takeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function takeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function takeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function takeKeybindings(
  value: unknown,
  fallback: Record<string, string>,
): Record<string, string> {
  const merged = { ...fallback };
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [action, binding] of Object.entries(value as Record<string, unknown>)) {
      if (typeof binding === 'string') merged[action] = binding;
    }
  }
  return merged;
}

function mergeStored(raw: unknown): MutableSettings {
  const d = DEFAULT_SETTINGS;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return cloneSettings(d);
  }
  const s = raw as Record<string, unknown>;
  return {
    theme: takeEnum(s.theme, THEMES, d.theme),
    handwritingEnabled: takeBoolean(s.handwritingEnabled, d.handwritingEnabled),
    handwritingFont: takeString(s.handwritingFont, d.handwritingFont),
    bodyFontSize: takeNumber(s.bodyFontSize, d.bodyFontSize),
    pageStyleDefault: takeEnum(s.pageStyleDefault, PAGE_STYLES, d.pageStyleDefault),
    inkColor: takeString(s.inkColor, d.inkColor),
    animationLevel: takeEnum(s.animationLevel, ANIMATION_LEVELS, d.animationLevel),
    minimalistMode: takeBoolean(s.minimalistMode, d.minimalistMode),
    showMarginDoodles: takeBoolean(s.showMarginDoodles, d.showMarginDoodles),
    confettiOnComplete: takeBoolean(s.confettiOnComplete, d.confettiOnComplete),
    defaultBookPalette: takeEnum(s.defaultBookPalette, BOOK_PALETTES, d.defaultBookPalette),
    soundMaster: takeNumber(s.soundMaster, d.soundMaster),
    soundUi: takeNumber(s.soundUi, d.soundUi),
    soundPages: takeNumber(s.soundPages, d.soundPages),
    soundShelf: takeNumber(s.soundShelf, d.soundShelf),
    soundAmbient: takeNumber(s.soundAmbient, d.soundAmbient),
    muteAll: takeBoolean(s.muteAll, d.muteAll),
    ambientLoop: takeBoolean(s.ambientLoop, d.ambientLoop),
    reducedSound: takeBoolean(s.reducedSound, d.reducedSound),
    autostart: takeBoolean(s.autostart, d.autostart),
    zoomSensitivity: takeNumber(s.zoomSensitivity, d.zoomSensitivity),
    dragMomentum: takeNumber(s.dragMomentum, d.dragMomentum),
    autosaveIntervalMs: takeNumber(s.autosaveIntervalMs, d.autosaveIntervalMs),
    backupEnabled: takeBoolean(s.backupEnabled, d.backupEnabled),
    backupIntervalDays: takeNumber(s.backupIntervalDays, d.backupIntervalDays),
    spellcheck: takeBoolean(s.spellcheck, d.spellcheck),
    keybindings: takeKeybindings(s.keybindings, d.keybindings),
    wheelMode: takeEnum(s.wheelMode, ['zoom', 'scroll'] as const, d.wheelMode),
    shelfSort: takeEnum(
      s.shelfSort,
      ['manual', 'recent', 'favorites'] as const,
      d.shelfSort,
    ),
    soundscape: takeEnum(
      s.soundscape,
      ['library', 'rain', 'fireplace', 'crickets', 'none'] as const,
      d.soundscape,
    ),
    typingSounds: takeBoolean(s.typingSounds, d.typingSounds),
    hourlyChime: takeBoolean(s.hourlyChime, d.hourlyChime),
    cursorStyle: takeEnum(
      s.cursorStyle,
      ['standard', 'pencil', 'quill'] as const,
      d.cursorStyle,
    ),
    journalBookId:
      typeof s.journalBookId === 'string' ? s.journalBookId : d.journalBookId,
    thumbnailsStrip: takeBoolean(s.thumbnailsStrip, d.thumbnailsStrip),
    launchIntoLastBook: takeBoolean(s.launchIntoLastBook, d.launchIntoLastBook),
    trayQuickCapture: takeBoolean(s.trayQuickCapture, d.trayQuickCapture),
    backupFolder:
      typeof s.backupFolder === 'string' ? s.backupFolder : d.backupFolder,
    perfHud: takeBoolean(s.perfHud, d.perfHud),
    telemetry: false,
  };
}

/**
 * Validated merge of an unknown stored blob over `DEFAULT_SETTINGS`.
 * Pure — no store or db access. Exposed for the settings feature and tests.
 */
export function mergeSettings(raw: unknown): Settings {
  return mergeStored(raw);
}

// ---------------------------------------------------------------------------
// load / save / subscribe
// ---------------------------------------------------------------------------

let loadPromise: Promise<Settings> | null = null;

/**
 * Load stored settings (once; subsequent calls reuse the same promise),
 * merge them over defaults, and hydrate the reactive store.
 */
export function load(): Promise<Settings> {
  loadPromise ??= (async () => {
    const db = await getDb();
    let raw: unknown = null;
    const rows = await db.select<Array<{ value: string }>>(
      'SELECT value FROM settings WHERE key = $1 LIMIT 1',
      [SETTINGS_KEY],
    );
    if (rows.length > 0) {
      try {
        raw = JSON.parse(rows[0].value);
      } catch {
        raw = null; // corrupt blob -> defaults
      }
    }
    const merged = mergeStored(raw);
    setStore(reconcile(merged));
    setRevision((r) => r + 1);
    return cloneSettings(merged);
  })();
  return loadPromise;
}

/**
 * Apply a partial patch, update the reactive store, and persist the full
 * merged blob. `keybindings` merges per-action; `telemetry` is immutable.
 */
export async function save(patch: Partial<Settings>): Promise<Settings> {
  await load(); // never clobber stored settings with unhydrated defaults
  const next = cloneSettings(unwrap(store));
  for (const key of Object.keys(patch) as Array<keyof Settings>) {
    const value = patch[key];
    if (value === undefined || key === 'telemetry') continue;
    if (key === 'keybindings') {
      next.keybindings = {
        ...next.keybindings,
        ...(value as Record<string, string>),
      };
    } else {
      // Keys other than the two above are primitives; the Partial<Settings>
      // input already guarantees value matches the field's type.
      (next as Record<string, unknown>)[key] = value;
    }
  }
  setStore(reconcile(next));
  setRevision((r) => r + 1);
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
    [SETTINGS_KEY, JSON.stringify(next)],
  );
  return cloneSettings(next);
}

/**
 * Subscribe to settings changes from non-Solid code (Pixi, Howler, GSAP...).
 * Fires immediately with the current snapshot, then after every `load`/`save`.
 * Returns an unsubscribe function. Snapshots are detached copies — safe to
 * hold, never reactive.
 */
export function subscribe(listener: (current: Settings) => void): () => void {
  return createRoot((dispose) => {
    createEffect(on(revision, () => listener(cloneSettings(unwrap(store)))));
    return dispose;
  });
}
