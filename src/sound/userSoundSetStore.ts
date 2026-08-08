/**
 * src/sound/userSoundSetStore.ts — importing and keeping the reader's own
 * sound sets.
 *
 * The registry (`userSoundSets.ts`) is pure so the engine can read it on the
 * play path. This is the other half: the file dialog, the bytes, the row in
 * `settings`, and the one module in `src/sound/` that is allowed to import
 * `src/data` — exactly the split `soundSetPrefs.ts` already makes for the
 * chosen set, and for the same reason.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE THE BYTES GO, AND WHY THEY GO THERE
 * ─────────────────────────────────────────────────────────────────────────
 * Straight through the existing asset store — `storeImageBytes` →
 * `save_image_asset` → `app_data_dir/assets/images/<contenthash>.<ext>` — the
 * same pipe `features/templates/userStickers.ts` puts a custom sticker down.
 * Three things make that the right pipe rather than a lazy one:
 *
 *   - The Rust command is a BYTE sink, not an image encoder. It sniffs the
 *     magic bytes, finds nothing it recognises in a WAV or an Ogg, and falls
 *     back to the extension it was handed. Nothing about it decodes an image.
 *   - `$APPDATA/assets/**` is the only path in `tauri.conf.json`'s asset
 *     protocol scope, so it is the only place on disk a `<audio>`/Web Audio
 *     fetch inside the app can reach at all.
 *   - Content hashing gives free de-duplication: the same thump assigned to
 *     three roles is one file.
 *
 * The honest wart: the row lands with `kind = 'image'` and the file sits in
 * `assets/images/`, because `recordAssetRow` hard-codes that and it belongs to
 * the editor's media pipeline rather than to sound. Widening it would be a
 * change in someone else's module for a cosmetic gain; the rows are told
 * apart by `meta.soundCue`, and `loadUserStickers()` — which scans exactly
 * these rows — keys off `meta.customSticker` and skips them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NOTHING CONDITIONS THESE FILES
 * ─────────────────────────────────────────────────────────────────────────
 * `scripts/gen-sounds.mjs` fits a warmth shelf, walks a lowpass lid down and
 * levels every shipped cue into one loudness hierarchy. That is a BUILD step
 * over ffmpeg-decoded float, not something the app can do to bytes at import
 * time, so a reader's file is played exactly as they recorded it. Their set's
 * base still applies its rate, gain and master-bus filter on top — but a cue
 * mastered 12 dB hotter than `pop-soft` will be 12 dB hotter than `pop-soft`.
 * The settings panel says so where the button is, rather than here only.
 */

import {
  FAMILY_NAMES,
  SOUND_FAMILIES,
  setSoundSet,
  type FamilyName,
} from './engine';
import { isSoundSetId, resolveSoundSetId, type SoundSetId } from './soundSets';
import {
  MAX_USER_SOUND_SETS,
  clearUserSoundSets,
  freeUserSoundSetId,
  isUserSoundSetId,
  registerUserSoundSet,
  snapshotUserSoundSets,
  unregisterUserSoundSet,
  userSoundSet,
  type UserCue,
  type UserSoundSet,
  type UserSoundSetId,
} from './userSoundSets';
import { getDb, isTauri } from '../data/db';
import { storeImageBytes } from '../editor/media/assets';
import {
  MISSING_ASSET_SRC,
  registerDevAssetUrl,
  resolveAssetSrc,
} from '../editor/media/resolver';
import { notify } from '../editor/script/exporters/toast';

const SETTINGS_KEY = 'userSoundSets';

/**
 * A cue is one event. Eight megabytes is already an absurd click and still
 * small enough that a reader who drops a whole album track in gets a refusal
 * instead of a five-second stall on every button press.
 */
export const MAX_CUE_BYTES = 8 * 1024 * 1024;

/**
 * What a browser will actually decode. Deliberately a list rather than
 * `audio/*`: the point of failure we can prevent is a file the reader picks
 * that then produces silence with no explanation, and the dialog filter is
 * the only place to prevent it.
 */
export const AUDIO_EXTENSIONS: readonly string[] = [
  'wav',
  'mp3',
  'ogg',
  'oga',
  'opus',
  'm4a',
  'aac',
  'flac',
  'webm',
];

/* ─────────────────────────── roles in plain English ─────────────────────── */

/**
 * What each role IS, for a reader who has never seen the family names. The
 * settings panel labels its rows from here, and the import matcher accepts
 * these words as aliases, so the naming rule the panel teaches is the naming
 * rule the matcher enforces.
 */
export const ROLE_LABELS: Record<FamilyName, string> = {
  'click-soft': 'pressing a button',
  'pop-soft': 'opening a panel',
  'tick-hover': 'hovering over something',
  'check-done': 'ticking a box',
  'page-flip': 'turning a page',
  'book-pull': 'taking a book off the shelf',
  'book-return': 'putting a book back',
  'drop-thump': 'something landing',
  'crumple-delete': 'deleting',
  'shelf-whoosh': 'the camera moving',
  'typing-tick': 'a keystroke',
  confetti: 'a celebration',
  'chime-hour': 'the hour',
};

/**
 * Extra words a file name may use instead of the family name.
 *
 * No bare "tick": it is in three role names at once (`tick-hover`,
 * `typing-tick`, and what a reader would call ticking a box), and a matcher
 * that has to guess between them will guess wrong for somebody. Every alias
 * here belongs to exactly one role.
 */
const ROLE_ALIASES: Record<FamilyName, readonly string[]> = {
  'click-soft': ['click', 'button', 'press'],
  'pop-soft': ['pop', 'panel', 'menu', 'open'],
  'tick-hover': ['hover'],
  'check-done': ['check', 'done', 'checkbox', 'complete'],
  'page-flip': ['page', 'flip', 'turn'],
  'book-pull': ['pull', 'take-book', 'bookout'],
  'book-return': ['return', 'shelve', 'bookback'],
  'drop-thump': ['drop', 'thump', 'thud', 'land'],
  'crumple-delete': ['delete', 'crumple', 'trash', 'bin'],
  'shelf-whoosh': ['whoosh', 'swoosh', 'camera'],
  'typing-tick': ['typing', 'type', 'keystroke', 'keypress'],
  // No 'confetti' here: `roleVocabulary` already prepends the family name,
  // and a word that appears twice is a word that could appear under two roles.
  confetti: ['celebrate', 'cheer', 'sparkle'],
  'chime-hour': ['chime', 'hour', 'bell'],
};

/** Every word the matcher understands, for the panel's own explanation. */
export function roleVocabulary(role: FamilyName): readonly string[] {
  return [role, ...ROLE_ALIASES[role]];
}

const normalize = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Which role a file name is asking for, or null.
 *
 * Two passes, and the order is the whole correctness of it. An exact family
 * name (with or without a `-2` take number) is unambiguous and wins outright;
 * only then do the substring aliases get a turn, longest first, so
 * `book-return.wav` cannot be captured by `book-pull`'s shorter alias while
 * a longer, more specific word is sitting right there.
 */
export function roleFromFileName(fileName: string): FamilyName | null {
  const stem = normalize(fileName);
  if (stem === '') return null;

  for (const role of FAMILY_NAMES) {
    if (stem === role) return role;
    // The shipped take names — `page-flip-3`, `click-soft-2` — so a reader
    // who exported the app's own set, edited it and brought it back works.
    if ((SOUND_FAMILIES[role] as readonly string[]).some((take) => stem === normalize(take))) {
      return role;
    }
  }

  let best: { role: FamilyName; length: number } | null = null;
  for (const role of FAMILY_NAMES) {
    for (const word of roleVocabulary(role)) {
      if (!stem.includes(word)) continue;
      if (best === null || word.length > best.length) best = { role, length: word.length };
    }
  }
  return best?.role ?? null;
}

/* ───────────────────────────── persistence ──────────────────────────────── */

interface StoredCue {
  relPath: string;
  fileName: string;
}

interface StoredSet {
  id: string;
  name: string;
  base: string;
  cues: Record<string, StoredCue>;
}

let loadPromise: Promise<readonly UserSoundSet[]> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate one stored set and resolve its files. Total: anything malformed
 * comes back as null and the set is simply not there, which is the same
 * answer `resolveShelfDesign` gives a corrupt row.
 *
 * A cue whose file no longer resolves is DROPPED rather than registered with
 * a placeholder src. A dropped cue falls through to the base set and the
 * reader hears the app; a registered-but-broken one would be a decoded sound that
 * fails to decode, i.e. one role that is silent forever with nothing on
 * screen to say why.
 */
async function hydrate(raw: unknown): Promise<UserSoundSet | null> {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  if (!isUserSoundSetId(id)) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : id;
  const base: SoundSetId = isSoundSetId(raw.base) ? raw.base : resolveSoundSetId(raw.base);

  const cues: Partial<Record<FamilyName, UserCue>> = {};
  if (isRecord(raw.cues)) {
    for (const [role, entry] of Object.entries(raw.cues)) {
      if (!(FAMILY_NAMES as readonly string[]).includes(role)) continue;
      if (!isRecord(entry)) continue;
      const relPath = typeof entry.relPath === 'string' ? entry.relPath : '';
      const fileName = typeof entry.fileName === 'string' ? entry.fileName : 'sound';
      if (relPath === '') continue;
      const src = await resolveAssetSrc(relPath);
      if (src === MISSING_ASSET_SRC) continue;
      cues[role as FamilyName] = { src, relPath, fileName };
    }
  }
  return { id, name, base, cues };
}

function toStored(set: UserSoundSet): StoredSet {
  const cues: Record<string, StoredCue> = {};
  for (const [role, cue] of Object.entries(set.cues)) {
    if (cue === undefined) continue;
    cues[role] = { relPath: cue.relPath, fileName: cue.fileName };
  }
  return { id: set.id, name: set.name, base: set.base, cues };
}

async function persist(): Promise<void> {
  const payload = JSON.stringify({ sets: snapshotUserSoundSets().map(toStored) });
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      SETTINGS_KEY,
      payload,
    ]);
  } catch {
    // Best effort, like every other keyed preference in this app.
  }
}

/**
 * Read every stored set and register it. Idempotent — the settings panel and
 * `soundSetPrefs.loadSoundSet()` both kick it, and the second caller must not
 * re-resolve every asset path.
 */
export function loadUserSoundSets(): Promise<readonly UserSoundSet[]> {
  loadPromise ??= (async () => {
    let stored: unknown = null;
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [SETTINGS_KEY],
      );
      const raw = rows[0]?.value;
      stored = typeof raw === 'string' ? JSON.parse(raw) : null;
    } catch {
      // No row, no table, bad JSON: the reader simply has no sets of their own.
    }
    const list = isRecord(stored) && Array.isArray(stored.sets) ? stored.sets : [];
    clearUserSoundSets();
    const hydrated: UserSoundSet[] = [];
    for (const entry of list.slice(0, MAX_USER_SOUND_SETS)) {
      const set = await hydrate(entry);
      if (set !== null) hydrated.push(registerUserSoundSet(set));
    }
    return hydrated;
  })();
  return loadPromise;
}

/* ─────────────────────────────── mutation ───────────────────────────────── */

/** Register + persist in one step, and re-apply if this set is the live one. */
async function commit(set: UserSoundSet): Promise<UserSoundSet> {
  registerUserSoundSet(set);
  await persist();
  // A set whose cues changed under a stable id has to be re-applied, or the
  // engine keeps playing the base for a role the reader just filled.
  setSoundSet(set.id);
  return set;
}

export async function createUserSoundSet(
  displayName: string,
  base: SoundSetId,
): Promise<UserSoundSet | null> {
  await loadUserSoundSets();
  if (snapshotUserSoundSets().length >= MAX_USER_SOUND_SETS) {
    notify(`that is ${MAX_USER_SOUND_SETS} sets — forget one first`);
    return null;
  }
  const name = displayName.trim() === '' ? 'My Set' : displayName.trim();
  const set: UserSoundSet = {
    id: freeUserSoundSetId(name),
    name,
    base: resolveSoundSetId(base),
    cues: {},
  };
  registerUserSoundSet(set);
  await persist();
  return set;
}

/** Re-base a set: every role the reader did not fill changes character. */
export async function setUserSoundSetBase(id: UserSoundSetId, base: string): Promise<void> {
  const set = userSoundSet(id);
  if (set === null) return;
  await commit({ ...set, base: resolveSoundSetId(base) });
}

export async function clearUserCue(id: UserSoundSetId, role: FamilyName): Promise<void> {
  const set = userSoundSet(id);
  if (set === null || set.cues[role] === undefined) return;
  const cues = { ...set.cues };
  delete cues[role];
  await commit({ ...set, cues });
}

export async function forgetUserSoundSet(id: UserSoundSetId): Promise<boolean> {
  const gone = unregisterUserSoundSet(id);
  if (gone) await persist();
  return gone;
}

/* ─────────────────────────────── importing ──────────────────────────────── */

/** One picked file, before it is known which role (if any) it is for. */
interface PickedFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

function extOf(nameOrPath: string): string | null {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(nameOrPath.trim())?.[1]?.toLowerCase();
  return ext !== undefined && AUDIO_EXTENSIONS.includes(ext) ? ext : null;
}

/** Persist one file's bytes and return the cue that plays them. */
async function storeCue(file: PickedFile): Promise<UserCue | null> {
  const ext = extOf(file.fileName);
  if (ext === null) return null;
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_CUE_BYTES) return null;
  try {
    if (isTauri()) {
      const stored = await storeImageBytes(file.bytes, ext, {
        soundCue: true,
        fileName: file.fileName,
      });
      return { src: stored.src, relPath: stored.relPath, fileName: file.fileName };
    }
    // Browser dev has no filesystem: an object URL, registered under a
    // rel_path so the stored shape is identical. It will not survive a
    // reload, and `hydrate` drops it rather than registering a dead src.
    const relPath = `dev/sound-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const url = URL.createObjectURL(
      new Blob([file.bytes.slice().buffer], { type: `audio/${ext}` }),
    );
    registerDevAssetUrl(relPath, url);
    return { src: url, relPath, fileName: file.fileName };
  } catch {
    return null;
  }
}

async function pickTauriFiles(multiple: boolean): Promise<PickedFile[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple,
    filters: [{ name: 'Sound', extensions: [...AUDIO_EXTENSIONS] }],
  });
  if (picked === null) return [];
  const paths = Array.isArray(picked) ? picked : [picked];
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const files: PickedFile[] = [];
  for (const path of paths) {
    try {
      const fileName = path.replace(/\\/g, '/').split('/').pop() ?? path;
      files.push({ fileName, bytes: await readFile(path) });
    } catch {
      notify('could not read that sound');
    }
  }
  return files;
}

function pickBrowserFiles(multiple: boolean): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    document.querySelector('input[data-nb-sound-import]')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = AUDIO_EXTENSIONS.map((e) => `.${e}`).join(',') + ',audio/*';
    input.multiple = multiple;
    input.setAttribute('data-nb-sound-import', 'true');
    input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(input);

    let settled = false;
    const finish = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      const files: PickedFile[] = [];
      for (const file of Array.from(input.files ?? [])) {
        try {
          files.push({ fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        } catch {
          notify(`could not read ${file.name}`);
        }
      }
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => void finish());
    window.addEventListener('focus', () => setTimeout(() => void finish(), 1200), { once: true });
    input.click();
  });
}

const pickFiles = (multiple: boolean): Promise<PickedFile[]> =>
  isTauri() ? pickTauriFiles(multiple) : pickBrowserFiles(multiple);

/** What an import did, so the panel can say something specific. */
export interface ImportReport {
  readonly set: UserSoundSet | null;
  readonly assigned: readonly FamilyName[];
  readonly unmatched: readonly string[];
  readonly rejected: readonly string[];
}

const EMPTY_REPORT: ImportReport = { set: null, assigned: [], unmatched: [], rejected: [] };

/**
 * Pick files and fold them into `id` by name — the bulk path.
 *
 * A file whose name says nothing is NOT guessed at. Assigning leftovers to
 * whichever roles happened to be free would make the same folder import
 * differently depending on what was already in the set, and a reader would
 * have no way to predict or undo it. It is reported instead, and the per-role
 * buttons in the panel are the exact, unambiguous way to place it.
 */
export async function importIntoUserSoundSet(id: UserSoundSetId): Promise<ImportReport> {
  const target = userSoundSet(id);
  if (target === null) return EMPTY_REPORT;
  const files = await pickFiles(true);
  if (files.length === 0) return { ...EMPTY_REPORT, set: target };

  const cues: Partial<Record<FamilyName, UserCue>> = { ...target.cues };
  const assigned: FamilyName[] = [];
  const unmatched: string[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    const role = roleFromFileName(file.fileName);
    if (role === null) {
      unmatched.push(file.fileName);
      continue;
    }
    const cue = await storeCue(file);
    if (cue === null) {
      rejected.push(file.fileName);
      continue;
    }
    cues[role] = cue;
    assigned.push(role);
  }

  const next = await commit({ ...target, cues });
  return { set: next, assigned, unmatched, rejected };
}

/**
 * Pick ONE file for ONE role. No name matching, no ambiguity — the escape
 * hatch that makes the naming rule above a convenience rather than a wall.
 */
export async function assignUserCue(
  id: UserSoundSetId,
  role: FamilyName,
): Promise<UserCue | null> {
  const target = userSoundSet(id);
  if (target === null) return null;
  const [file] = await pickFiles(false);
  if (file === undefined) return null;
  const cue = await storeCue(file);
  if (cue === null) {
    notify(`${file.fileName} is not a sound this app can play`);
    return null;
  }
  await commit({ ...target, cues: { ...target.cues, [role]: cue } });
  return cue;
}

/**
 * The whole "add your own set" flow: pick files, name the set after the
 * folder they came from, fold them in.
 *
 * Creating the set FIRST and importing into it means a reader whose files
 * were all unmatched still ends up with a named set they can fill by hand,
 * rather than a toast and nothing to show for the dialog they just used.
 */
export async function addUserSoundSet(base: SoundSetId): Promise<ImportReport> {
  await loadUserSoundSets();
  const files = await pickFiles(true);
  if (files.length === 0) return EMPTY_REPORT;
  const created = await createUserSoundSet(setNameFor(files), base);
  if (created === null) return EMPTY_REPORT;

  const cues: Partial<Record<FamilyName, UserCue>> = {};
  const assigned: FamilyName[] = [];
  const unmatched: string[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const role = roleFromFileName(file.fileName);
    if (role === null) {
      unmatched.push(file.fileName);
      continue;
    }
    const cue = await storeCue(file);
    if (cue === null) {
      rejected.push(file.fileName);
      continue;
    }
    cues[role] = cue;
    assigned.push(role);
  }
  const set = await commit({ ...created, cues });
  return { set, assigned, unmatched, rejected };
}

/**
 * A name for a freshly imported set. The folder the files came from is the
 * name the reader already chose for this collection — `sounds/typewriter/…`
 * is a set called "typewriter" — and it is the only label in the whole flow
 * that was not invented by us.
 */
function setNameFor(files: readonly PickedFile[]): string {
  const first = files[0]?.fileName ?? '';
  const parts = first.replace(/\\/g, '/').split('/');
  const folder = parts.length > 1 ? parts[parts.length - 2] : '';
  const raw = folder !== '' ? folder : (parts[parts.length - 1] ?? '').replace(/\.[a-z0-9]+$/i, '');
  const cleaned = raw.replace(/[-_]+/g, ' ').trim();
  return cleaned === '' ? 'My Set' : cleaned.slice(0, 40);
}

/* --------------------------------- QA bridge ------------------------------- */

declare global {
  interface Window {
    __nbUserSoundSets?: {
      list: () => readonly UserSoundSet[];
      load: () => Promise<readonly UserSoundSet[]>;
      /** Make a set from URLs rather than a file dialog — a probe cannot click one. */
      seed: (
        name: string,
        base: string,
        cues: Record<string, string>,
      ) => Promise<UserSoundSet | null>;
      forget: (id: string) => Promise<boolean>;
      roleFor: (fileName: string) => FamilyName | null;
    };
  }
}

/**
 * Build a set from URLs rather than from a file dialog.
 *
 * The seam a probe and the unit suite both drive, and it exists because the
 * import flow's first step is an OS file dialog that no automated run can
 * answer. It takes URLs the page can already reach and builds exactly the
 * record the dialog would have built; everything downstream — persistence,
 * the registry, the engine's play path — is the real thing, so what it skips
 * is the picking and nothing else.
 *
 * The `registerDevAssetUrl` below is what makes that true of RELOADING too:
 * `storeCue`'s browser branch registers every object URL it mints under its
 * rel_path, and without the same line here a seeded set would come back from
 * `hydrate` with its cues dropped — a probe would then be measuring the dev
 * shell's lack of a filesystem rather than the reload path.
 */
export async function defineUserSoundSet(
  name: string,
  base: string,
  cues: Record<string, string>,
): Promise<UserSoundSet | null> {
  const created = await createUserSoundSet(name, resolveSoundSetId(base));
  if (created === null) return null;
  const table: Partial<Record<FamilyName, UserCue>> = {};
  for (const [role, url] of Object.entries(cues)) {
    if (!(FAMILY_NAMES as readonly string[]).includes(role)) continue;
    if (!isTauri()) registerDevAssetUrl(url, url);
    table[role as FamilyName] = {
      src: url,
      relPath: url,
      fileName: url.split('/').pop() ?? 'seeded.wav',
    };
  }
  return commit({ ...created, cues: table });
}

if (typeof window !== 'undefined') {
  window.__nbUserSoundSets = {
    list: snapshotUserSoundSets,
    load: loadUserSoundSets,
    seed: defineUserSoundSet,
    forget: (id: string) =>
      isUserSoundSetId(id) ? forgetUserSoundSet(id) : Promise.resolve(false),
    roleFor: roleFromFileName,
  };
}
