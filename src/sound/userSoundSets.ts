/**
 * src/sound/userSoundSets.ts — the reader's own sound sets: the registry.
 *
 * `soundSets.ts` ships twenty-eight named voicings, and every one of them is
 * a way of CONDITIONING the same licensed recordings. This is the other kind
 * of set: the reader brings their own audio files and says which cue each one
 * is. It is the sound half of what `features/templates/userStickers.ts` does
 * for the sticker palette, and it follows that module exactly — a `user:`
 * prefixed id, bytes through the existing asset store, and a session registry
 * that the rest of the app reads without knowing where the bytes came from.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT A READER'S SET IS, AND WHY IT IS NOT A WHOLE SET
 * ─────────────────────────────────────────────────────────────────────────
 * A reader's set is a BASE plus overrides:
 *
 *     { base: 'house', cues: { 'click-soft': <their file>, … } }
 *
 * Every role they did not fill is voiced by the base set exactly as it always
 * was, and the base's rate, gain, layering, pool and jitter still apply to
 * the roles they DID fill. That is the whole design decision here, and it is
 * the difference between a feature someone can finish and one they abandon:
 * a reader with a single typewriter sample gets a working set out of one
 * file, not thirteen, and everything they did not record still keeps the
 * mastered loudness hierarchy the built-in table is held to.
 *
 * It also makes the reverse true and worth stating: their file is played as
 * they recorded it. Nothing in the app conditions it — no warmth fit, no
 * lowpass lid, no levelling. `gen-sounds.mjs` does that to the shipped cues
 * on the way in, and it is not a runtime pass. A hot sample will be hot.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE HAS NO PERSISTENCE IN IT
 * ─────────────────────────────────────────────────────────────────────────
 * `engine.ts` documents that it never imports `src/data`, and the engine has
 * to be able to ask "does the active set have a file for this role?" on the
 * play path. So the registry — pure, synchronous, no I/O — lives here, and
 * `userSoundSetStore.ts` is the one module that touches both this and SQLite.
 * The dependency runs one way, exactly as `soundSetPrefs.ts` → `engine.ts`.
 *
 * For the same reason nothing here imports `engine.ts` at runtime: the engine
 * imports this, so a runtime edge back would be a cycle. `FamilyName` arrives
 * as a type, which is erased.
 */

import { createSignal } from 'solid-js';
import type { FamilyName } from './engine';
import { isSoundSetId, type SoundSetId } from './soundSets';

/**
 * `user:` mirrors the sticker registry's `user:<name>` ids and the book
 * studio's `own:…` bindings: one glance at a stored value says whether it
 * came out of a shipped table or out of the reader.
 */
export const USER_SET_PREFIX = 'user:';

export type UserSoundSetId = `${typeof USER_SET_PREFIX}${string}`;

/** Whichever kind of set is selected — a shipped id or a reader's own. */
export type AnySoundSetId = SoundSetId | UserSoundSetId;

/** One role, voiced by one of the reader's files. */
export interface UserCue {
  /** Displayable URL for this environment (asset protocol, or an object URL). */
  readonly src: string;
  /** Assets-root-relative path; '' in the browser dev shell, which has none. */
  readonly relPath: string;
  /** What the file was called when it was imported — the only label we have. */
  readonly fileName: string;
}

export interface UserSoundSet {
  readonly id: UserSoundSetId;
  readonly name: string;
  /**
   * The shipped set every unfilled role falls through to, and whose rate,
   * gain, pool, jitter and master-bus filter still apply to the filled ones.
   */
  readonly base: SoundSetId;
  readonly cues: Readonly<Partial<Record<FamilyName, UserCue>>>;
}

/**
 * A ceiling, because these are the reader's own bytes on their own disk and
 * nothing else in the app would ever notice them growing. Twelve sets is far
 * past what anyone will make and still a number the picker can draw.
 */
export const MAX_USER_SOUND_SETS = 12;

/* ─────────────────────────────── the registry ───────────────────────────── */

/**
 * A Solid signal rather than a bare Map so the settings panel re-renders when
 * an import lands, and `snapshotUserSoundSets()` for everyone else — the same
 * two-surface shape `soundSetPrefs.ts` uses for the chosen set.
 */
const [registry, setRegistry] = createSignal<readonly UserSoundSet[]>([]);

/** Reactive read — tracks inside a Solid computation. */
export function userSoundSets(): readonly UserSoundSet[] {
  return registry();
}

/** Detached read, for the engine and for QA bridges. */
export function snapshotUserSoundSets(): readonly UserSoundSet[] {
  return registry();
}

export function isUserSoundSetId(value: unknown): value is UserSoundSetId {
  return typeof value === 'string' && value.startsWith(USER_SET_PREFIX);
}

/** The registered set for an id, or null. Total for any input. */
export function userSoundSet(id: unknown): UserSoundSet | null {
  if (!isUserSoundSetId(id)) return null;
  return registry().find((s) => s.id === id) ?? null;
}

/**
 * Register (or replace) one set. Replacement is by id, so re-importing into
 * an existing set keeps its position in the picker rather than sending it to
 * the end of the row while the reader is looking at it.
 */
export function registerUserSoundSet(set: UserSoundSet): UserSoundSet {
  setRegistry((prev) => {
    const at = prev.findIndex((s) => s.id === set.id);
    if (at < 0) return [...prev, set];
    const next = prev.slice();
    next[at] = set;
    return next;
  });
  return set;
}

/** Drop one set from the registry. Returns whether anything was there. */
export function unregisterUserSoundSet(id: UserSoundSetId): boolean {
  let hit = false;
  setRegistry((prev) => {
    const next = prev.filter((s) => s.id !== id);
    hit = next.length !== prev.length;
    return hit ? next : prev;
  });
  return hit;
}

/** Forget every registered set (test seam, and the store's reload path). */
export function clearUserSoundSets(): void {
  setRegistry([]);
}

/* ───────────────────────────── lookups on the play path ─────────────────── */

/**
 * The reader's file for a role in the active set, or null.
 *
 * Called once per play, so it stays a small array scan over at most twelve
 * sets rather than anything that has to be invalidated.
 */
export function userCueFor(setId: unknown, role: FamilyName): UserCue | null {
  const set = userSoundSet(setId);
  if (set === null) return null;
  return set.cues[role] ?? null;
}

/**
 * The shipped set a selection ultimately resolves to for rate/gain/pool/
 * jitter/filter purposes: a reader's set answers with its base, a shipped one
 * with ITSELF, and an id that is neither takes the caller's fallback.
 *
 * The middle case is the whole point and was once missing: reading only the
 * registry means `userSoundSet()` answers null for every shipped id — they
 * carry no `user:` prefix — and the fallback was returned for all twenty-eight
 * of them. Nothing threw and nothing looked wrong: the picker still reported
 * the chosen set, the studio still previewed it, and the engine quietly played
 * the house voicing underneath every single one. Adding the reader's own sets
 * must not change what a shipped set resolves to, so the shipped id is
 * answered here before the fallback is ever reached.
 */
export function baseSetIdOf(setId: unknown, fallback: SoundSetId): SoundSetId {
  const set = userSoundSet(setId);
  if (set !== null) return set.base;
  return isSoundSetId(setId) ? setId : fallback;
}

/** How many roles a reader has actually filled in. */
export function userCueCount(set: UserSoundSet): number {
  return Object.keys(set.cues).length;
}

/* ──────────────────────────────── id minting ────────────────────────────── */

/** Lower-case, hyphenated, no surprises in a settings key or a DOM id. */
export function sanitizeSetName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/**
 * A free id for a display name, avoiding anything already registered AND
 * anything in `taken` — the store passes the ids it is about to write, which
 * matters when a whole file's worth of sets is being restored at once and the
 * registry is still empty.
 */
export function freeUserSoundSetId(
  displayName: string,
  taken: ReadonlySet<string> = new Set(),
): UserSoundSetId {
  const base = sanitizeSetName(displayName) || 'my-set';
  const used = new Set<string>([...taken, ...registry().map((s) => s.id)]);
  const candidate = `${USER_SET_PREFIX}${base}` as UserSoundSetId;
  if (!used.has(candidate)) return candidate;
  for (let i = 2; i < 1000; i += 1) {
    const next = `${USER_SET_PREFIX}${base}-${i}` as UserSoundSetId;
    if (!used.has(next)) return next;
  }
  return `${USER_SET_PREFIX}${base}-${Date.now().toString(36)}` as UserSoundSetId;
}
