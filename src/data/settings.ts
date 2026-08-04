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
import { CURSOR_SET_IDS } from '../art/cursors';
import { SOUNDSCAPE_NAMES } from '../sound/engine';
import { APP_THEME_IDS } from '../features/settings/appearance';
import { DEFAULT_KEYBINDINGS, DEFAULT_SETTINGS } from './defaults';
import {
  FIXED_BINDING_REASONS,
  LISTED_ACTION_IDS,
  SHORTCUT_GROUPS,
  UNHANDLED_ACTION_IDS,
  bindingActionLabel,
  formatBinding,
  shortcutAction,
  type ShortcutGroupId,
} from './keybindings';
import { PAGE_STYLES } from './types';
import type {
  AnimationLevel,
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

/**
 * The rooms a stored blob may name.
 *
 * This was the four names in `ThemeName` and is now the whole appearance
 * vocabulary (`features/settings/appearance.ts`), for the same reason
 * `soundscape` above validates against `SOUNDSCAPE_NAMES` rather than a list
 * copied out of the engine: a picker and its validator that are typed out
 * twice drift, and the half that drifts is always the one the reader can see.
 *
 * The cast is deliberate and it is the whole design. `ThemeName` in
 * `data/types.ts` names the four hand-tuned rooms in `styles/settings.css`,
 * and it still does — a theme id is one of those rooms plus a paper and an
 * accent, and `applySettings` sets `data-theme` to the ROOM. Widening the
 * union would put a list of thirty ids in `data/`, where every new room would
 * then need a type edit in a file that owns none of the art. That is exactly
 * the coupling the three art vocabularies were built to remove.
 */
const THEMES = APP_THEME_IDS as readonly ThemeName[];
// `PAGE_STYLES` is imported, not restated — same reason as THEMES above, and
// it is the list the two page-style pickers iterate (see data/types.ts).
const ANIMATION_LEVELS: readonly AnimationLevel[] = ['full', 'reduced', 'off'];
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
      // An empty combo is not "unbound", it is a row of blank kbd chips in the
      // settings sheet and a `matchesBinding` that can never be true. A blob
      // holding one falls back to whatever the app ships for that action.
      if (typeof binding === 'string' && binding.trim() !== '') merged[action] = binding;
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
    // `library` is deliberately absent from the accepted list: the bed was
    // withdrawn, so a blob still holding it falls through to the default
    // rather than naming a loop that no longer ships.
    soundscape: takeEnum(
      s.soundscape,
      SOUNDSCAPE_NAMES,
      d.soundscape,
    ),
    typingSounds: takeBoolean(s.typingSounds, d.typingSounds),
    hourlyChime: takeBoolean(s.hourlyChime, d.hourlyChime),
    cursorStyle: takeEnum(
      s.cursorStyle,
      ['standard', 'pencil', 'quill'] as const,
      d.cursorStyle,
    ),
    // Validated against the art module's own list rather than a copy of it.
    // `CURSOR_SET_IDS` is typed `readonly CursorSetId[]`, so `takeEnum` returns
    // a `CursorSetId` — and assigning that to the union spelled out in
    // `data/types.ts` is what makes TypeScript refuse the day the two drift.
    cursorSet: takeEnum(s.cursorSet, CURSOR_SET_IDS, d.cursorSet),
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

// ---------------------------------------------------------------------------
// Rebinding
//
// The settings sheet lets the reader press a new combination onto a row. Three
// jobs live here rather than in the panel, because a combination that reaches
// storage is a promise every handler in the app then has to keep:
//
//   1. READING an event back into the storage grammar (`bindingFromEvent`).
//      This is the exact inverse of `matchesBinding` in ./keybindings.ts — the
//      key part is `event.key.toLowerCase()` and nothing prettier, because
//      that is the string the matcher compares against. A nicer spelling here
//      ("Space", "Plus") would store a combination that can never fire again.
//   2. REFUSING one that would cost the reader something they cannot get back
//      from inside a page (`bindingRefusal`) — a plain letter, Escape, the
//      clipboard — with the reason in words, never a silent no-op.
//   3. WRITING only what survived (1) and (2) (`rebind` / `resetBinding`), so
//      no other call site can put an unvalidated combo in the blob.
// ---------------------------------------------------------------------------

/**
 * Keys that are only ever HELD. A capture that accepted one would store
 * "mod+control", a combination no keyboard can produce a second time — so
 * seeing one means the reader is still reaching for the rest of the combo.
 */
const HELD_KEYS: ReadonlySet<string> = new Set([
  'control',
  'shift',
  'alt',
  'meta',
  'os',
  'altgraph',
  'capslock',
  'numlock',
  'scrolllock',
  'fn',
  'fnlock',
  'dead',
  'process',
  'unidentified',
]);

/** F1–F12 are the only keys that carry a shortcut with no modifier at all. */
const FUNCTION_KEY = /^f([1-9]|1[0-2])$/;

/** The order every stored combination is written in, so two can be compared. */
const MODIFIER_ORDER = ['mod', 'shift', 'alt'] as const;

/**
 * What the app would lose along with each of these. Not a taste list: every
 * one of them is something a reader does inside a page and has no other way
 * to do, so handing it to a shortcut takes it away for good.
 */
const RESERVED_COMBOS: Readonly<Record<string, string>> = {
  'mod+c': 'copies what you have selected',
  'mod+x': 'cuts what you have selected',
  'mod+v': 'pastes',
  'mod+a': 'selects the whole page',
  'mod+z': 'undoes the last thing you typed',
  'mod+y': 'redoes',
  'mod+shift+z': 'redoes',
};

/**
 * The combination a KeyboardEvent describes, in the stored grammar, or `null`
 * while nothing but modifiers is down.
 */
export function bindingFromEvent(event: KeyboardEvent): string | null {
  const key = (event.key ?? '').toLowerCase();
  if (key === '' || HELD_KEYS.has(key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('mod');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  parts.push(key);
  return parts.join('+');
}

/**
 * The same combination, always spelled the same way.
 *
 * `matchesBinding` takes modifiers in any order, which is right for reading a
 * hand-edited blob and wrong for deciding whether two rows collide: without
 * this, "mod+shift+e" and "shift+mod+e" are two different strings claiming one
 * key press, and the conflict check would wave them both through.
 */
export function canonicalBinding(binding: string): string {
  const parts = binding.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  const held = new Set(parts.slice(0, -1));
  return [...MODIFIER_ORDER.filter((mod) => held.has(mod)), key].join('+');
}

/**
 * An action id as the settings sheet says it out loud.
 *
 * Re-exported from the registry, which is where the words live now: the row
 * used to read "table of contents" because that happened to be the id with
 * its hyphens taken out, and an id that has to double as a sentence is an id
 * nobody can rename.
 */
export { bindingActionLabel };

// ---------------------------------------------------------------------------
// What the sheet is allowed to offer
//
// A row in the shortcut list is a promise that the combination printed on it
// is the combination that fires. While the list was a legend, an entry nothing
// honoured was merely wrong. Now that the same row CAPTURES a key, validates
// it, and saves it, an entry nothing honoured is worse than wrong: the reader
// watches the app accept their key and then does not get it. So each id in
// `DEFAULT_KEYBINDINGS` is one of three things, and only the first is a picker.
// ---------------------------------------------------------------------------

/**
 * Actions the map names that NO handler in the app performs.
 *
 * Derived from the registry's `handled: false` flag, so the set and the reason
 * for it sit on the same line as the action. `new-page` used to be in here —
 * it is a real command now — and only `toggle-handwriting` is left, because
 * `handwritingEnabled` is read by no code at all outside this file's merge.
 *
 * Such ids stay in the stored map (churning a reader's blob to delete a dead
 * key buys nothing) and out of the sheet, and they reserve no combination: a
 * key nothing listens for is a free key.
 */
const UNHANDLED_ACTIONS: ReadonlySet<string> = UNHANDLED_ACTION_IDS;

/**
 * Actions that DO happen on a key that cannot be moved, with the reason.
 *
 * `zoom-to-shelf` is BookView's literal `event.key === 'Escape'`. That is not
 * an oversight waiting on a rebind: Escape is also how every panel, dialog and
 * capture in the app gets out, which is why `bindingRefusal` will not hand it
 * to anything else either. The row is LISTED — the reader wants to know the
 * key — and it answers in words when pressed.
 */
const FIXED_BINDINGS: Readonly<Record<string, string>> = FIXED_BINDING_REASONS;

/** Why `action` cannot be moved off the combination it ships with, or `null`. */
export function fixedBindingReason(action: string): string | null {
  return FIXED_BINDINGS[action] ?? null;
}

/**
 * The action ids the shortcut list shows, in the order it shows them.
 *
 * Registry order — which is ROOM order (finding your way, the shelf, a book,
 * writing, the library) — rather than alphabetical. Twenty-one rows sorted by
 * their own names is a wall; sorted by where the reader is standing when they
 * want one, it is four short lists.
 *
 * Ordered here rather than in the panel so the row order is a property of the
 * data, and so `<For>` is handed plain strings that compare by value — a fresh
 * array of pairs per settings write rebuilds every row and takes the focus
 * ring off the button that was just pressed.
 *
 * A stored blob may hold ids the registry has never heard of (a hand edit, or
 * a build that shipped a shortcut this one dropped). Those are listed too,
 * after the known ones: a row the reader can see and reset is how they get rid
 * of it, and silently hiding a combination that still occupies a key would
 * make the conflict messages point at nothing.
 */
export function listedBindingActions(
  map: Readonly<Record<string, string>>,
): string[] {
  const known = LISTED_ACTION_IDS.filter((action) => action in map);
  const strays = Object.keys(map)
    .filter((action) => !UNHANDLED_ACTIONS.has(action) && shortcutAction(action) === null)
    .sort((a, b) => a.localeCompare(b));
  return [...known, ...strays];
}

/**
 * The same ids, split into the sheet's headings.
 *
 * Empty groups are dropped, and stray ids (see above) land under the group
 * they belong to least badly — "the whole library", which is where the sheet's
 * own file rows already are.
 */
export function listedBindingGroups(
  map: Readonly<Record<string, string>>,
): Array<{ id: ShortcutGroupId; title: string; blurb: string; actions: string[] }> {
  const listed = listedBindingActions(map);
  return SHORTCUT_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    blurb: group.blurb,
    actions: listed.filter(
      (action) => (shortcutAction(action)?.group ?? 'library') === group.id,
    ),
  })).filter((group) => group.actions.length > 0);
}

/**
 * The action already holding `combo`, if it is not `action` itself.
 *
 * Unhandled ids are skipped: they are not rows the reader can see, so naming
 * one in a refusal would send them looking for a row that is not there, to
 * free a key that was never taken.
 */
function conflictingAction(
  action: string,
  combo: string,
  current: Readonly<Record<string, string>>,
): string | null {
  for (const [other, held] of Object.entries(current)) {
    if (other === action || UNHANDLED_ACTIONS.has(other)) continue;
    if (canonicalBinding(held) === combo) return other;
  }
  return null;
}

/**
 * Why `binding` cannot be given to `action`, in words for the reader — or
 * `null` when it can.
 *
 * Pure: `current` is the map to check against, so the panel can ask before it
 * writes and `rebind` can ask again against what is actually stored.
 */
export function bindingRefusal(
  action: string,
  binding: string,
  current: Readonly<Record<string, string>>,
): string | null {
  // Read this off the RAW string, before the parts are split apart: a combo
  // whose key is '+' arrives as "mod++", and splitting it leaves an empty key
  // that would be reported as "not a key" — true, but not the truth the reader
  // needs, which is that this one character is spoken for by the notation.
  if (binding.endsWith('+')) {
    return 'a “+” is what holds a combination together, so it cannot also be one of the keys in it.';
  }

  const combo = canonicalBinding(binding);
  const parts = combo.split('+');
  const key = parts[parts.length - 1] ?? '';
  const held = parts.slice(0, -1);
  const mod = formatBinding('mod');

  if (key === '') return 'that is not a key this app can write down.';
  if (key === 'escape') {
    return 'Escape is the way out of every panel and every dialog here. It stays where it is.';
  }
  if (key === ' ' || key === 'spacebar') {
    return 'Space belongs to the page — it is how you put a gap between two words.';
  }
  if (key === 'tab') {
    return 'Tab walks between the controls on screen. A panel that ate it would shut you inside itself.';
  }
  if (!held.includes('mod') && !held.includes('alt') && !FUNCTION_KEY.test(key)) {
    return `“${formatBinding(combo)}” would just type into the page. Hold ${mod} or Alt down as well — or use an F key.`;
  }

  const reserved = RESERVED_COMBOS[combo];
  if (reserved !== undefined) {
    return `${formatBinding(combo)} already ${reserved}. Take it and a page has no other way to.`;
  }

  const clash = conflictingAction(action, combo, current);
  if (clash !== null) {
    return `${formatBinding(combo)} is already “${bindingActionLabel(clash)}”. Move that one first and this key is free.`;
  }
  return null;
}

/**
 * Give `action` a new combination.
 *
 * Returns the refusal when there is one, having written nothing — the panel
 * says why out loud. Re-pressing the combination a row already has is a quiet
 * no-op rather than a conflict with itself.
 */
export async function rebind(action: string, binding: string): Promise<string | null> {
  // Asked here as well as in the panel, not instead of it: this is the only
  // door to the blob, so a row that cannot move must be unable to move through
  // any call site, not just through the one that draws a button.
  const fixed = fixedBindingReason(action);
  if (fixed !== null) return fixed;
  await load();
  const current = unwrap(store).keybindings;
  const combo = canonicalBinding(binding);
  if (canonicalBinding(current[action] ?? '') === combo) return null;
  const refusal = bindingRefusal(action, combo, current);
  if (refusal !== null) return refusal;
  await save({ keybindings: { [action]: combo } });
  return null;
}

/**
 * Put `action` back on the combination the app ships with.
 *
 * The shipped combo is allowed by definition — `zoom-to-shelf` IS Escape — so
 * this skips the "would shadow something essential" refusals and checks only
 * that no other row has since been given that key. If one has, say so: a
 * "reset" that silently leaves two rows claiming one press is worse than one
 * that explains itself.
 */
export async function resetBinding(action: string): Promise<string | null> {
  const shipped = DEFAULT_KEYBINDINGS[action];
  if (shipped === undefined) return null;
  await load();
  const current = unwrap(store).keybindings;
  const combo = canonicalBinding(shipped);
  if (canonicalBinding(current[action] ?? '') === combo) return null;
  const clash = conflictingAction(action, combo, current);
  if (clash !== null) {
    return `${formatBinding(combo)} is “${bindingActionLabel(clash)}” now. Move that one first and this row can have it back.`;
  }
  await save({ keybindings: { [action]: shipped } });
  return null;
}
