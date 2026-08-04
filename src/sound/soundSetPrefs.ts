/**
 * src/sound/soundSetPrefs.ts — where the reader's chosen sound set lives.
 *
 * Its own key in the `settings` table, exactly like `data/designPrefs.ts`
 * keeps the studio's vocabularies out of `data/settings.ts`. The reason is the
 * same one: `data/settings.ts` validates its blob field by field, so a value
 * it does not know about is silently dropped on the next read, and widening a
 * validator this module does not own to carry one string is the wrong trade.
 *
 * It also keeps the layering honest. `engine.ts` documents that it never
 * imports `src/data`; this module is the one place that touches both, and it
 * only ever pushes one way — store → `setSoundSet()`.
 *
 * Every read is total: junk out of SQLite gives the house set, never a throw
 * and never an unvoiced engine.
 */

import { createSignal } from 'solid-js';
import { getDb } from '../data/db';
import { setSoundSet } from './engine';
import { DEFAULT_SOUND_SET_ID, resolveSoundSetId } from './soundSets';
import {
  isUserSoundSetId,
  userSoundSet,
  type AnySoundSetId,
} from './userSoundSets';
import { loadUserSoundSets } from './userSoundSetStore';

const SETTINGS_KEY = 'soundSet';

const [current, setCurrent] = createSignal<AnySoundSetId>(DEFAULT_SOUND_SET_ID);

let loadPromise: Promise<AnySoundSetId> | null = null;

/**
 * Total for either kind of id. A `user:` choice is honoured only while the
 * set behind it is REGISTERED, which is what makes "the reader deleted their
 * set" and "the assets did not come back with the database" the same,
 * survivable case: the house set, not an unvoiced app.
 */
function resolveAnySetId(value: unknown): AnySoundSetId {
  if (isUserSoundSetId(value) && userSoundSet(value) !== null) return value;
  return resolveSoundSetId(value);
}

/** Reactive read — tracks inside a Solid computation. */
export function activeSoundSetId(): AnySoundSetId {
  return current();
}

/** Detached read, for non-Solid callers (QA bridges, the preview helper). */
export function snapshotSoundSetId(): AnySoundSetId {
  return current();
}

/**
 * Read the stored choice once and push it into the engine.
 *
 * Idempotent, and safe to call from anywhere that runs at start-up: it is
 * kicked from `installUiClickSounds()` (which App.tsx already calls on mount)
 * and again from the settings sheet, because a reader who never opens
 * settings must still hear the set they chose last week.
 */
export function loadSoundSet(): Promise<AnySoundSetId> {
  loadPromise ??= (async () => {
    // The reader's own sets have to be in the registry BEFORE the stored id
    // is resolved, or a `user:` choice would fail its registration check on
    // every boot and silently fall back to the house set.
    await loadUserSoundSets();
    let stored: unknown = null;
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [SETTINGS_KEY],
      );
      stored = rows[0]?.value ?? null;
    } catch {
      // No row, no table, no database: the house set is a fine answer.
    }
    const id = resolveAnySetId(parseStored(stored));
    setCurrent(id);
    setSoundSet(id);
    return id;
  })();
  return loadPromise;
}

/**
 * The stored value is a bare id, but tolerate a JSON-wrapped one: an earlier
 * hand-set QA value or a future blob shape should degrade to the house set
 * rather than being read as a nonsense id.
 */
function parseStored(raw: unknown): unknown {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('"')) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return (parsed as Record<string, unknown>).set;
    }
  } catch {
    // Not JSON after all — fall through to the house set.
  }
  return null;
}

/**
 * Choose a set. Optimistic: the engine and the picker move on the frame the
 * reader clicked, and the write lands afterwards — the same bargain
 * `saveRoomDesign` makes, for the same reason (a set that forgets itself
 * beats a click that waits on SQLite).
 */
export async function saveSoundSet(id: AnySoundSetId | string): Promise<AnySoundSetId> {
  const resolved = resolveAnySetId(id);
  await loadSoundSet();
  setCurrent(resolved);
  setSoundSet(resolved);
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      SETTINGS_KEY,
      resolved,
    ]);
  } catch {
    // Best effort, like every other keyed preference in this app.
  }
  return resolved;
}

/** Test seam: forget the load so a fresh database is read again. */
export function resetSoundSetPrefsForTests(): void {
  loadPromise = null;
  setCurrent(DEFAULT_SOUND_SET_ID);
  setSoundSet(DEFAULT_SOUND_SET_ID);
}

/* --------------------------------- QA bridge ------------------------------- */

/**
 * The bridge a probe should drive, handed out from the module that owns the
 * write path. `save` goes through the store, so what it asserts is the
 * APPLIED state and not merely what was persisted.
 */
declare global {
  interface Window {
    __nbSoundSets?: {
      get: () => AnySoundSetId;
      save: (id: string) => Promise<AnySoundSetId>;
      load: () => Promise<AnySoundSetId>;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__nbSoundSets = {
    get: snapshotSoundSetId,
    save: saveSoundSet,
    load: loadSoundSet,
  };
}
