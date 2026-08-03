/**
 * src/sound/engine.ts — typed procedural-sound playback engine.
 *
 * Wraps Howler behind a small typed surface. Fully lazy: the howler module
 * is dynamically imported and Howl instances are created only when a sound
 * is first needed, so cold start pays nothing until the first play().
 *
 * The settings store drives this from outside via setVolumes / muteAll /
 * setReducedSound / setSoundCharacter — this module never imports src/data.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VARIANTS AND CHARACTER
 * ─────────────────────────────────────────────────────────────────────────
 * Every one-shot ships as a FAMILY of 3-6 separately synthesized takes
 * (see scripts/gen-sounds.mjs). `play('book-pull')` names the family and
 * gets a rotated variant, a per-play pitch nudge (±1.5-5% depending on
 * character) and a per-play level nudge, so the same interaction never
 * sounds mechanically identical twice. The first file of every family keeps
 * its historical name, so every existing call site still resolves.
 *
 * The sound-character preset (settings.soundCharacter) picks which half of
 * each family is in play, how wide the jitter is, how loud each category
 * sits, and which decorative sounds are dropped entirely:
 *
 *   calm     the reference voicing — every variant, gentle jitter (default)
 *   rich     the longer, more textured takes; wider jitter; fuller ambience
 *   minimal  the short takes only, quieter, and the decorative layer
 *            (hover ticks, typing ticks, pencil loop, confetti, whooshes)
 *            never plays at all
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SOUND SETS
 * ─────────────────────────────────────────────────────────────────────────
 * Above the character sits the reader-facing choice: a named SOUND SET
 * (`sound/soundSets.ts`) — the way a room has carpentry and a book has a
 * binding. A set decides, per ROLE, which family actually sounds, at what
 * playback rate and gain, with what (if anything) layered underneath, and
 * whether the role is heard at all. `play('book-pull')` therefore means
 * "the book-off-the-shelf role", and what the reader hears depends on their
 * set; `play('book-pull-2')` still means exactly that file.
 *
 * Sets add no new recordings — they condition the shipped, licensed cues at
 * play time. See the header of soundSets.ts for why, and for the credits
 * consequence (there is none: a set plays a cue, so it plays that cue's
 * provenance).
 *
 * For tests, the Howler dependency is injectable via setHowlerLoader() and
 * the jitter RNG via setPlayRngForTests().
 */

import {
  DEFAULT_SOUND_SET_ID,
  resolveSoundSetId,
  resolveVoice,
  soundSetJitterScale,
  soundSetPool,
  type SoundLayer,
  type SoundSetId,
  type SoundVoice,
} from './soundSets';

/* ------------------------------- sound names ------------------------------ */

export type SoundName =
  /* page turns */
  | 'page-flip-1'
  | 'page-flip-2'
  | 'page-flip-3'
  | 'page-flip-4'
  | 'page-flip-5'
  | 'page-flip-6'
  /* pulling a book out */
  | 'book-pull'
  | 'book-pull-2'
  | 'book-pull-3'
  | 'book-pull-4'
  /* putting one back */
  | 'book-return'
  | 'book-return-2'
  | 'book-return-3'
  | 'book-return-4'
  /* camera moves */
  | 'shelf-whoosh'
  | 'shelf-whoosh-2'
  | 'shelf-whoosh-3'
  /* menus and panels */
  | 'pop-soft'
  | 'pop-soft-2'
  | 'pop-soft-3'
  | 'pop-soft-4'
  | 'pop-soft-5'
  /* pressing a button */
  | 'click-soft'
  | 'click-soft-2'
  | 'click-soft-3'
  | 'click-soft-4'
  /* hover */
  | 'tick-hover'
  | 'tick-hover-2'
  | 'tick-hover-3'
  | 'tick-hover-4'
  | 'tick-hover-5'
  /* ticking a box */
  | 'check-done'
  | 'check-done-2'
  | 'check-done-3'
  | 'check-done-4'
  /* deleting */
  | 'crumple-delete'
  | 'crumple-delete-2'
  | 'crumple-delete-3'
  | 'crumple-delete-4'
  /* landing */
  | 'drop-thump'
  | 'drop-thump-2'
  | 'drop-thump-3'
  | 'drop-thump-4'
  /* the writing loop */
  | 'pencil-scratch'
  /* celebration */
  | 'confetti'
  | 'confetti-2'
  | 'confetti-3'
  /* ambience beds */
  | 'ambient-rain'
  | 'ambient-storm'
  | 'ambient-fireplace'
  | 'ambient-crickets'
  | 'ambient-night'
  | 'ambient-wind'
  | 'ambient-stream'
  | 'ambient-forest'
  | 'ambient-shore'
  | 'ambient-cafe'
  /* keystrokes */
  | 'typing-tick-1'
  | 'typing-tick-2'
  | 'typing-tick-3'
  | 'typing-tick-4'
  | 'typing-tick-5'
  | 'typing-tick-6'
  /* the hour */
  | 'chime-hour'
  | 'chime-hour-2'
  | 'chime-hour-3';

export type SoundCategory = 'ui' | 'pages' | 'shelf' | 'ambient';
export type VolumeKey = SoundCategory | 'master';
export type Volumes = Record<VolumeKey, number>;

/* -------------------------------- families -------------------------------- */

/**
 * Family key -> its variant takes, most-used first. `page-flip` and
 * `typing-tick` are virtual keys (no file of their own); every other key is
 * ALSO the name of its first variant, which is what keeps `play('book-pull')`
 * working exactly as before — only now it rotates.
 */
export const SOUND_FAMILIES = {
  'page-flip': ['page-flip-1', 'page-flip-2', 'page-flip-3', 'page-flip-4', 'page-flip-5', 'page-flip-6'],
  'book-pull': ['book-pull', 'book-pull-2', 'book-pull-3', 'book-pull-4'],
  'book-return': ['book-return', 'book-return-2', 'book-return-3', 'book-return-4'],
  'shelf-whoosh': ['shelf-whoosh', 'shelf-whoosh-2', 'shelf-whoosh-3'],
  'pop-soft': ['pop-soft', 'pop-soft-2', 'pop-soft-3', 'pop-soft-4', 'pop-soft-5'],
  'click-soft': ['click-soft', 'click-soft-2', 'click-soft-3', 'click-soft-4'],
  'tick-hover': ['tick-hover', 'tick-hover-2', 'tick-hover-3', 'tick-hover-4', 'tick-hover-5'],
  'check-done': ['check-done', 'check-done-2', 'check-done-3', 'check-done-4'],
  'crumple-delete': ['crumple-delete', 'crumple-delete-2', 'crumple-delete-3', 'crumple-delete-4'],
  'drop-thump': ['drop-thump', 'drop-thump-2', 'drop-thump-3', 'drop-thump-4'],
  confetti: ['confetti', 'confetti-2', 'confetti-3'],
  'typing-tick': ['typing-tick-1', 'typing-tick-2', 'typing-tick-3', 'typing-tick-4', 'typing-tick-5', 'typing-tick-6'],
  'chime-hour': ['chime-hour', 'chime-hour-2', 'chime-hour-3'],
} as const satisfies Record<string, readonly SoundName[]>;

export type FamilyName = keyof typeof SOUND_FAMILIES;

/** `play()` accepts a concrete file name or a family key. */
export type PlayableName = SoundName | FamilyName;

export const FAMILY_NAMES = Object.keys(SOUND_FAMILIES) as readonly FamilyName[];

/**
 * Which half of a family a take belongs to.
 *   plain — the shorter, leaner takes; what `minimal` plays
 *   full  — the longest, most textured takes; what `rich` leans on
 * Mirrors the `weight` field in scripts/gen-sounds.mjs; the unit suite
 * asserts the two stay in step by measuring the actual files.
 */
export type VariantWeight = 'plain' | 'full';

export const VARIANT_WEIGHTS: Record<SoundName, VariantWeight> = {
  'page-flip-1': 'plain',
  'page-flip-2': 'full',
  'page-flip-3': 'plain',
  'page-flip-4': 'full',
  'page-flip-5': 'plain',
  'page-flip-6': 'full',
  'book-pull': 'plain',
  'book-pull-2': 'full',
  'book-pull-3': 'plain',
  'book-pull-4': 'full',
  'book-return': 'plain',
  'book-return-2': 'full',
  'book-return-3': 'plain',
  'book-return-4': 'full',
  'shelf-whoosh': 'plain',
  'shelf-whoosh-2': 'full',
  'shelf-whoosh-3': 'plain',
  'pop-soft': 'plain',
  'pop-soft-2': 'full',
  'pop-soft-3': 'plain',
  'pop-soft-4': 'full',
  'pop-soft-5': 'plain',
  'click-soft': 'plain',
  'click-soft-2': 'full',
  'click-soft-3': 'plain',
  'click-soft-4': 'full',
  'tick-hover': 'plain',
  'tick-hover-2': 'full',
  'tick-hover-3': 'plain',
  'tick-hover-4': 'full',
  'tick-hover-5': 'plain',
  'check-done': 'plain',
  'check-done-2': 'full',
  'check-done-3': 'plain',
  'check-done-4': 'full',
  'crumple-delete': 'plain',
  'crumple-delete-2': 'full',
  'crumple-delete-3': 'plain',
  'crumple-delete-4': 'full',
  'drop-thump': 'plain',
  'drop-thump-2': 'full',
  'drop-thump-3': 'plain',
  'drop-thump-4': 'full',
  'pencil-scratch': 'plain',
  confetti: 'plain',
  'confetti-2': 'full',
  'confetti-3': 'plain',
  'ambient-rain': 'full',
  'ambient-storm': 'full',
  'ambient-fireplace': 'full',
  'ambient-crickets': 'full',
  'ambient-night': 'full',
  'ambient-wind': 'full',
  'ambient-stream': 'full',
  'ambient-forest': 'full',
  'ambient-shore': 'full',
  'ambient-cafe': 'full',
  'typing-tick-1': 'plain',
  'typing-tick-2': 'plain',
  'typing-tick-3': 'full',
  'typing-tick-4': 'plain',
  'typing-tick-5': 'full',
  'typing-tick-6': 'plain',
  'chime-hour': 'full',
  'chime-hour-2': 'plain',
  'chime-hour-3': 'full',
};

/** Historical aliases kept so nothing that imported them breaks. */
export const PAGE_FLIP_VARIANTS = SOUND_FAMILIES['page-flip'];
export const TYPING_TICK_VARIANTS = SOUND_FAMILIES['typing-tick'];

/**
 * The user-facing soundscape choice (settings.soundscape).
 *
 * `library` was here and is gone: it was the one bed built from a synthesized
 * loop rather than a field recording, and review's word for it was "creepy".
 * `mergeSettings` maps the stored value onto `rain`.
 */
export type SoundscapeName =
  | 'rain'
  | 'storm'
  | 'fireplace'
  | 'crickets'
  | 'night'
  | 'wind'
  | 'stream'
  | 'forest'
  | 'shore'
  | 'cafe'
  | 'none';

/** Soundscape -> the seamless ambient loop that realizes it. */
export const SOUNDSCAPE_LOOPS = {
  rain: 'ambient-rain',
  storm: 'ambient-storm',
  fireplace: 'ambient-fireplace',
  crickets: 'ambient-crickets',
  night: 'ambient-night',
  wind: 'ambient-wind',
  stream: 'ambient-stream',
  forest: 'ambient-forest',
  shore: 'ambient-shore',
  cafe: 'ambient-cafe',
} as const satisfies Record<Exclude<SoundscapeName, 'none'>, SoundName>;

/** Every selectable soundscape, in the order the settings row lays them out. */
export const SOUNDSCAPE_NAMES = [
  ...(Object.keys(SOUNDSCAPE_LOOPS) as Exclude<SoundscapeName, 'none'>[]),
  'none',
] as const satisfies readonly SoundscapeName[];

/** One-line description per soundscape, for the settings row's tooltips. */
export const SOUNDSCAPE_BLURBS: Record<SoundscapeName, string> = {
  rain: 'rain on the window',
  storm: 'light rain, thunder a long way off',
  fireplace: 'a fire in the grate',
  crickets: 'a field full of crickets',
  night: 'crickets, with wind in the far trees',
  wind: 'wind around the building',
  stream: 'water over stones',
  forest: 'woodland, midday, nobody about',
  shore: 'small waves on a pebble beach',
  cafe: 'the far end of a busy room',
  none: 'silence',
};

const AMBIENT_LOOP_NAMES: ReadonlySet<SoundName> = new Set(Object.values(SOUNDSCAPE_LOOPS));

interface SoundDef {
  readonly category: SoundCategory;
  readonly loop: boolean;
}

/** Build the manifest from the families so a new variant cannot be forgotten. */
function manifestFor(name: SoundName): SoundDef {
  if (name.startsWith('page-flip') || name.startsWith('typing-tick') || name === 'pencil-scratch') {
    return { category: 'pages', loop: name === 'pencil-scratch' };
  }
  if (name.startsWith('book-pull') || name.startsWith('book-return') || name.startsWith('shelf-whoosh') || name.startsWith('drop-thump')) {
    return { category: 'shelf', loop: false };
  }
  if (name.startsWith('ambient-')) return { category: 'ambient', loop: true };
  if (name.startsWith('chime-hour')) return { category: 'ambient', loop: false };
  return { category: 'ui', loop: false };
}

const ALL_SOUND_NAMES: readonly SoundName[] = [
  ...SOUND_FAMILIES['page-flip'],
  ...SOUND_FAMILIES['book-pull'],
  ...SOUND_FAMILIES['book-return'],
  ...SOUND_FAMILIES['shelf-whoosh'],
  ...SOUND_FAMILIES['pop-soft'],
  ...SOUND_FAMILIES['click-soft'],
  ...SOUND_FAMILIES['tick-hover'],
  ...SOUND_FAMILIES['check-done'],
  ...SOUND_FAMILIES['crumple-delete'],
  ...SOUND_FAMILIES['drop-thump'],
  'pencil-scratch',
  ...SOUND_FAMILIES.confetti,
  ...(Object.values(SOUNDSCAPE_LOOPS) as SoundName[]),
  ...SOUND_FAMILIES['typing-tick'],
  ...SOUND_FAMILIES['chime-hour'],
];

export const SOUND_MANIFEST: Record<SoundName, SoundDef> = Object.fromEntries(
  ALL_SOUND_NAMES.map((name) => [name, manifestFor(name)]),
) as Record<SoundName, SoundDef>;

export const SOUND_NAMES: readonly SoundName[] = ALL_SOUND_NAMES;

/** Sounds skipped entirely when the user prefers reduced sound. */
const REDUCED_SKIP: ReadonlySet<SoundName> = new Set<SoundName>([
  ...SOUND_FAMILIES['tick-hover'],
  'pencil-scratch',
  ...SOUND_FAMILIES['typing-tick'],
]);

/**
 * The ROLES a name-based skip list covers — derived, never listed twice: a
 * role is skipped when every take in its family is.
 *
 * Skipping has to be role-based as well as file-based now that a sound set
 * can voice a role with a different family. A reader who asked for reduced
 * sound wants no hover tick, whichever recording their set would have reached
 * for; and a set that voices the hover role with a crisp interface blip must
 * not smuggle that blip past the preference.
 */
const rolesFullyInside = (names: ReadonlySet<SoundName>): ReadonlySet<FamilyName> =>
  new Set(
    FAMILY_NAMES.filter((family) =>
      (SOUND_FAMILIES[family] as readonly SoundName[]).every((name) => names.has(name)),
    ),
  );

const REDUCED_SKIP_ROLES: ReadonlySet<FamilyName> = rolesFullyInside(REDUCED_SKIP);

export const soundUrl = (name: SoundName): string => `/sounds/${name}.wav`;

/* --------------------------- sound character ------------------------------ */

/** settings.soundCharacter — the user-facing voicing preset. */
export type SoundCharacter = 'calm' | 'rich' | 'minimal';

export const SOUND_CHARACTERS = ['calm', 'rich', 'minimal'] as const satisfies readonly SoundCharacter[];

export interface CharacterProfile {
  /** Extra gain per category, on top of the user's sliders. */
  readonly gain: Readonly<Record<SoundCategory, number>>;
  /** Half-width of the per-play playback-rate jitter (±, as a fraction). */
  readonly pitchJitter: number;
  /** Half-width of the per-play level jitter (±, as a fraction). */
  readonly levelJitter: number;
  /** Which slice of each family this character draws its variants from. */
  readonly pool: VariantWeight | 'all';
  /** Sounds this character never plays. */
  readonly skip: ReadonlySet<SoundName>;
  /** Human-readable one-liner for the settings row. */
  readonly blurb: string;
}

/** Decorative sounds — pleasant, but nothing depends on them. */
const DECORATIVE: readonly SoundName[] = [
  ...SOUND_FAMILIES['tick-hover'],
  ...SOUND_FAMILIES['typing-tick'],
  ...SOUND_FAMILIES['shelf-whoosh'],
  ...SOUND_FAMILIES.confetti,
  'pencil-scratch',
];

export const CHARACTER_PROFILES: Record<SoundCharacter, CharacterProfile> = {
  // The reference voicing. Every gain is exactly 1 so `calm` is a pure
  // pass-through of the user's own sliders.
  calm: {
    gain: { ui: 1, pages: 1, shelf: 1, ambient: 1 },
    pitchJitter: 0.03,
    levelJitter: 0.08,
    pool: 'all',
    skip: new Set(),
    blurb: 'soft and even — the whole set, gently varied',
  },
  rich: {
    gain: { ui: 1.1, pages: 1.1, shelf: 1.1, ambient: 1.35 },
    pitchJitter: 0.05,
    levelJitter: 0.12,
    pool: 'full',
    skip: new Set(),
    blurb: 'the longest, most textured takes, with more room around them',
  },
  minimal: {
    gain: { ui: 0.6, pages: 0.7, shelf: 0.65, ambient: 0.7 },
    pitchJitter: 0.015,
    levelJitter: 0.04,
    pool: 'plain',
    skip: new Set(DECORATIVE),
    blurb: 'only what an action needs, quieter — no hover or typing ticks',
  },
};

/** The same skip lists as roles, derived once (see `rolesFullyInside`). */
const CHARACTER_SKIP_ROLES: Record<SoundCharacter, ReadonlySet<FamilyName>> =
  Object.fromEntries(
    SOUND_CHARACTERS.map((name) => [name, rolesFullyInside(CHARACTER_PROFILES[name].skip)]),
  ) as Record<SoundCharacter, ReadonlySet<FamilyName>>;

/* --------------------------- injectable Howler ---------------------------- */

/**
 * Minimal structural slice of Howl the engine relies on. Tests provide a
 * stub matching this shape; production uses the real howler module.
 */
export interface HowlLike {
  play(): number;
  stop(id?: number): unknown;
  playing(id?: number): boolean;
  volume(vol: number, id?: number): unknown;
  rate(rate: number, id?: number): unknown;
  fade(from: number, to: number, duration: number, id?: number): unknown;
  once(event: string, fn: () => void, id?: number): unknown;
  unload(): unknown;
}

export interface HowlOptions {
  src: string[];
  loop: boolean;
  preload: boolean;
}

export type HowlConstructor = new (options: HowlOptions) => HowlLike;
export type HowlerLoader = () => Promise<{ Howl: HowlConstructor }>;

const defaultLoader: HowlerLoader = async () =>
  (await import('howler')) as unknown as { Howl: HowlConstructor };

let loadHowler: HowlerLoader = defaultLoader;
let howlerModule: Promise<{ Howl: HowlConstructor }> | undefined;

/** Test seam: swap the howler module (and drop any cached instances). */
export function setHowlerLoader(loader: HowlerLoader): void {
  loadHowler = loader;
  howlerModule = undefined;
  howls.clear();
  ambient = undefined;
}

/* ------------------------------ engine state ------------------------------ */

const AMBIENT_FADE_MS = 600;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Defaults mirror the settings-store defaults; the store overrides on init. */
const defaultVolumes = (): Volumes => ({
  master: 0.8,
  ui: 0.7,
  pages: 0.8,
  shelf: 0.7,
  ambient: 0.35,
});

let volumes: Volumes = defaultVolumes();
let muted = false;
let reducedSound = false;
let character: SoundCharacter = 'calm';
/** The reader's chosen voicing (see sound/soundSets.ts). */
let soundSet: SoundSetId = DEFAULT_SOUND_SET_ID;

const howls = new Map<SoundName, Promise<HowlLike>>();

interface AmbientState {
  howl: HowlLike;
  id: number;
  /** Which loop this bed is playing (soundscape switches crossfade between them). */
  name: SoundName;
}
let ambient: AmbientState | undefined;
/** Whether the ambient bed should be running (survives mute/unmute). */
let ambientWanted = false;
/**
 * The soundscape a NEW LIBRARY should open with.
 *
 * A fire in the grate rather than rain on the window. Both are quiet enough
 * to write under, and the difference is what they say about the room: rain is
 * weather happening TO a building, and a fire is somebody having lit one. The
 * app is a warm parchment library, so the bed that matches it is the hearth.
 * It is also the bed with the slowest irregular events in it — a settle, a
 * crack — which is what keeps a loop from turning into a hiss after an hour.
 *
 * ## This is NOT the variable below, and the difference is load-bearing
 *
 * `features/settings/apply.ts` calls `setSoundscape(settings.soundscape)` on
 * boot, so what a new install actually hears is `DEFAULT_SETTINGS.soundscape`
 * in `src/data/defaults.ts` — this module never gets to decide. That file
 * should import this constant rather than restate the word, so the product
 * decision has one home. (Whether the bed runs at all is `ambientLoop`, a
 * separate setting, and also lives there.)
 *
 * `soundscape` below stays `'rain'` on purpose: it is the placeholder the
 * engine holds in the milliseconds before settings apply, and seven cases in
 * `tests/sound.test.ts` call `startAmbient()` with no scape set and then look
 * for `ambient-rain`. Moving the placeholder is a test change, not an engine
 * change, and it changes nothing a reader can hear.
 */
export const DEFAULT_SOUNDSCAPE: SoundscapeName = 'fireplace';

/**
 * Which soundscape the bed realizes when it runs ('none' = silence).
 *
 * The engine's placeholder, overwritten by the settings store on boot — see
 * `DEFAULT_SOUNDSCAPE` above for the one a new library opens with.
 */
let soundscape: SoundscapeName = 'rain';

/** RNG behind variant choice, pitch jitter and level jitter. */
let playRng: () => number = Math.random;

const CLICK_NAMES: ReadonlySet<SoundName> = new Set(SOUND_FAMILIES['click-soft']);

/**
 * The button-press ROLE. Whether a play counts as "this control voiced
 * itself" is a question about the role, not about the file: a set that
 * presses buttons with a page turn must still let the delegated click handler
 * in `uiClicks.ts` know that was only a click, and a set that opens panels
 * with a board tap must still count that as a voice of its own.
 */
const CLICK_ROLE: FamilyName = 'click-soft';

/**
 * When a sound other than the button click last actually started.
 *
 * The delegated click handler reads this to stay out of the way: a control
 * that already voices itself (a shelf menu popping open, a checkbox ringing)
 * does not also get a click stacked under it. See `msSinceVoicedPlay`.
 */
let lastVoicedPlayMs = Number.NEGATIVE_INFINITY;

/** Milliseconds since the last non-click sound started. Infinity if none. */
export function msSinceVoicedPlay(nowMs: number = Date.now()): number {
  return nowMs - lastVoicedPlayMs;
}

/* -------------------------- variant rotation logic ------------------------- */

/**
 * Returns a picker over `variants` that chooses uniformly at random but never
 * yields the same variant twice in a row. Pure logic — `rng` is injectable
 * so tests can drive it deterministically.
 */
export function createVariantPicker<T>(variants: readonly T[], rng: () => number = Math.random): () => T {
  if (variants.length === 0) throw new Error('createVariantPicker: empty variant list');
  let last = -1;
  return () => {
    if (variants.length === 1) return variants[0] as T;
    let i: number;
    if (last < 0) {
      i = Math.min(Math.floor(rng() * variants.length), variants.length - 1);
    } else {
      // Uniform over all indices except `last`.
      i = Math.min(Math.floor(rng() * (variants.length - 1)), variants.length - 2);
      if (i >= last) i += 1;
    }
    last = i;
    return variants[i] as T;
  };
}

/**
 * The variants of `family` the current voicing is allowed to draw from. Falls
 * back to the whole family when the slice would be empty, so a one-variant
 * family can never starve the picker.
 *
 * Two things narrow the pool and the SET wins: it is the reader's own choice,
 * where the character is a refinement underneath it. A set that names no pool
 * leaves the question to the character, which is why the house set is a pure
 * pass-through of everything that came before it.
 */
export function poolFor(family: FamilyName, forCharacter: SoundCharacter = character): readonly SoundName[] {
  const all = SOUND_FAMILIES[family] as readonly SoundName[];
  const fromSet = soundSetPool(soundSet);
  const pool = fromSet === 'all' ? CHARACTER_PROFILES[forCharacter].pool : fromSet;
  if (pool === 'all') return all;
  const slice = all.filter((n) => VARIANT_WEIGHTS[n] === pool);
  return slice.length > 0 ? slice : all;
}

/**
 * One rotating picker per family per character per set. Keyed by all three so
 * switching any of them does not have to reset every family's rotation, and
 * so a family whose pool changed picks up the new pool immediately.
 *
 * The separators are load-bearing for the same reason they are in
 * `resolveVoice`: family names, character names and set ids all contain
 * hyphens, and a key glued together without them would let two different
 * (family, character, set) triples share one rotation. Nothing would throw —
 * the rotation would simply be wrong for the rest of the session.
 */
const pickers = new Map<string, () => SoundName>();

function pickVariant(family: FamilyName): SoundName {
  const key = `${family}|${character}|${soundSet}`;
  let pick = pickers.get(key);
  if (pick === undefined) {
    pick = createVariantPicker(poolFor(family), () => playRng());
    pickers.set(key, pick);
  }
  return pick();
}

const isFamily = (name: PlayableName): name is FamilyName =>
  Object.prototype.hasOwnProperty.call(SOUND_FAMILIES, name);

/* -------------------------------- internals -------------------------------- */

function ensureHowl(name: SoundName): Promise<HowlLike> {
  let entry = howls.get(name);
  if (!entry) {
    entry = (howlerModule ??= loadHowler()).then(
      ({ Howl }) =>
        new Howl({
          src: [soundUrl(name)],
          loop: SOUND_MANIFEST[name].loop,
          preload: true,
        }),
    );
    howls.set(name, entry);
  }
  return entry;
}

/**
 * `setGain` is the sound set's per-role trim and sits OUTSIDE the first clamp
 * on purpose: `requested` is a per-call 0..1 gain, but a set's trim is allowed
 * to be greater than one — that is how a set voices a button with the pencil
 * tick, which ships 8 dB under the board tap it replaces. It can only spend
 * headroom the reader's own sliders left; the single clamp at the end is what
 * keeps that honest.
 */
function effectiveVolume(name: SoundName, requested: number | undefined, setGain = 1): number {
  const category = SOUND_MANIFEST[name].category;
  const trim = CHARACTER_PROFILES[character].gain[category];
  return clamp01(clamp01(requested ?? 1) * volumes[category] * volumes.master * trim * setGain);
}

/** A symmetric ±half multiplier around 1, from the play RNG. */
const jitter = (half: number): number => 1 + (playRng() * 2 - 1) * half;

/* --------------------------------- API ------------------------------------ */

export interface PlayOptions {
  /** Per-call gain 0..1, multiplied with category and master gains. */
  volume?: number;
  /** Playback rate (1 = normal). When omitted the engine jitters it itself. */
  rate?: number;
  /** Opt out of the automatic per-play pitch/level jitter. */
  noJitter?: boolean;
}

/**
 * Preload every sound. Optional — play() lazily loads on demand — but calling
 * this after first paint hides any first-play latency.
 */
export async function init(): Promise<void> {
  await Promise.all(SOUND_NAMES.map((name) => ensureHowl(name)));
}

/**
 * Fire-and-forget playback. Resolves with the Howler sound id, or undefined
 * when the sound was skipped (muted, reduced-sound, character-skipped,
 * silenced by the sound set, or ambient delegation).
 *
 * A FAMILY name names a ROLE: the sound set decides which family actually
 * sounds for it, at what rate and gain, and with what (if anything) layered
 * underneath. A CONCRETE name is played exactly as asked — the set never
 * substitutes for a caller who named a file.
 *
 * Either way the play gets a small pitch and level nudge so repetition never
 * fatigues.
 */
export async function play(name: PlayableName, options: PlayOptions = {}): Promise<number | undefined> {
  if (isFamily(name)) return playRole(name, options);
  return playFile(name, options, {
    gain: 1,
    rate: undefined,
    stamp: !CLICK_NAMES.has(name),
    gateByName: true,
  });
}

/** What the set decided about this play, handed down to `playFile`. */
interface FilePlan {
  /** The set's per-role trim. */
  readonly gain: number;
  /** The set's playback rate, or undefined for "no opinion". */
  readonly rate: number | undefined;
  /** Whether this counts as a control voicing itself (see CLICK_ROLE). */
  readonly stamp: boolean;
  /**
   * Whether the file-name skip lists still apply.
   *
   * FALSE whenever a ROLE chose this file, and that is not an optimisation.
   * The skip lists name the files a preference is about — the hover ticks, the
   * pencil — and a set may voice a perfectly ordinary role with one of them
   * (the paper sets press buttons with a pencil tap). Re-checking by name
   * there would silence the button, not the hover. The role-level gates in
   * `roleSilent` have already asked the question that was actually meant.
   */
  readonly gateByName: boolean;
}

/**
 * Whether a role is inaudible right now, for every reason there is. Shared
 * with `keystroke()`, which has to make the same decision without playing —
 * otherwise a silenced role would still be counted as a tick.
 */
function roleSilent(role: FamilyName): boolean {
  if (muted) return true;
  if (reducedSound && REDUCED_SKIP_ROLES.has(role)) return true;
  if (CHARACTER_SKIP_ROLES[character].has(role)) return true;
  return resolveVoice(soundSet, role) === null;
}

/** Play one interaction role through the reader's sound set. */
async function playRole(role: FamilyName, options: PlayOptions): Promise<number | undefined> {
  if (roleSilent(role)) return undefined;
  const voice = resolveVoice(soundSet, role);
  if (voice === null) return undefined;
  // Reduced sound means one sound per action, so a set's body layer is the
  // first thing to go — it is exactly the "extra" that preference asks about.
  if (voice.layer !== null && !reducedSound) scheduleLayer(voice.layer);
  return playFile(pickVariant(voice.cue), options, {
    gain: voice.gain,
    rate: voice.rate,
    stamp: role !== CLICK_ROLE,
    gateByName: false,
  });
}

/**
 * A second, quieter cue under the first — a soft thump behind a book coming
 * off the shelf. Never stamps `lastVoicedPlayMs`: a layer is part of the
 * gesture that scheduled it, not an event of its own.
 */
function scheduleLayer(layer: SoundLayer): void {
  const fire = (): void => {
    void playFile(pickVariant(layer.cue), {}, {
      gain: layer.gain,
      rate: layer.rate,
      stamp: false,
      gateByName: false,
    });
  };
  if (layer.delayMs > 0) setTimeout(fire, layer.delayMs);
  else fire();
}

/** Play one concrete file, under a plan the caller (or the set) decided. */
async function playFile(
  name: SoundName,
  options: PlayOptions,
  plan: FilePlan,
): Promise<number | undefined> {
  if (AMBIENT_LOOP_NAMES.has(name)) {
    // Playing an ambient loop directly means "switch the bed to it".
    const entry = (Object.entries(SOUNDSCAPE_LOOPS) as Array<[SoundscapeName, SoundName]>).find(
      ([, loop]) => loop === name,
    );
    if (entry) soundscape = entry[0];
    await startAmbient();
    return ambient?.id;
  }
  if (muted) return undefined;
  const profile = CHARACTER_PROFILES[character];
  if (plan.gateByName) {
    if (reducedSound && REDUCED_SKIP.has(name)) return undefined;
    if (profile.skip.has(name)) return undefined;
  }
  // Stamped synchronously, before the first await, so the delegated button
  // click in `sound/uiClicks.ts` can tell whether the control it just saw
  // pressed already made a sound of its own.
  if (plan.stamp) lastVoicedPlayMs = Date.now();

  const jitterOn = options.noJitter !== true;
  const wobble = soundSetJitterScale(soundSet);
  const level = jitterOn ? jitter(profile.levelJitter * wobble) : 1;
  const nudge =
    jitterOn && profile.pitchJitter * wobble > 0 ? jitter(profile.pitchJitter * wobble) : undefined;
  // A set rate of exactly 1 is "no opinion", so the house set leaves rate()
  // untouched exactly as it did before sets existed.
  const base = plan.rate === undefined || plan.rate === 1 ? undefined : plan.rate;
  let rate = options.rate;
  if (rate === undefined) {
    if (base !== undefined) rate = nudge === undefined ? base : base * nudge;
    else rate = nudge;
  }

  const howl = await ensureHowl(name);
  const id = howl.play();
  howl.volume(effectiveVolume(name, (options.volume ?? 1) * level, plan.gain), id);
  if (rate !== undefined) howl.rate(rate, id);
  return id;
}

/**
 * Start the ambient bed for the current soundscape, fading in over 600 ms.
 * Idempotent; a no-op while the soundscape is 'none'. When a different loop
 * is already running the two beds crossfade.
 */
export async function startAmbient(): Promise<void> {
  ambientWanted = true;
  if (muted || soundscape === 'none') return;
  const name = SOUNDSCAPE_LOOPS[soundscape];
  const howl = await ensureHowl(name);
  // State may have changed while the module/file loaded (soundscape is
  // mutable across the await — re-read it through the accessor so control-flow
  // narrowing from the guard above cannot leak into this check).
  if (!ambientWanted || muted) return;
  const scapeNow = getSoundscape();
  if (scapeNow === 'none' || SOUNDSCAPE_LOOPS[scapeNow] !== name) return;
  if (ambient?.name === name && howl.playing(ambient.id)) return;
  if (ambient && ambient.name !== name) fadeOutAmbient(AMBIENT_FADE_MS); // crossfade out the old bed
  const id = howl.play();
  ambient = { howl, id, name };
  howl.volume(0, id);
  howl.fade(0, effectiveVolume(name, undefined), AMBIENT_FADE_MS, id);
}

/** Stop the ambient loop with a 600 ms fade-out. */
export function stopAmbient(): void {
  ambientWanted = false;
  fadeOutAmbient(AMBIENT_FADE_MS);
}

/**
 * Pick which ambient bed the app plays. Crossfades when a bed is running,
 * fades to silence on 'none'. Does not by itself decide *whether* the bed
 * runs — that stays with startAmbient/stopAmbient (the ambientLoop setting).
 */
export function setSoundscape(name: SoundscapeName): void {
  if (soundscape === name) return;
  soundscape = name;
  if (name === 'none') {
    fadeOutAmbient(AMBIENT_FADE_MS);
    return;
  }
  if (ambientWanted && !muted) void startAmbient();
}

export function getSoundscape(): SoundscapeName {
  return soundscape;
}

function fadeOutAmbient(fadeMs: number): void {
  const current = ambient;
  if (!current) return;
  ambient = undefined;
  const { howl, id, name } = current;
  howl.fade(effectiveVolume(name, undefined), 0, fadeMs, id);
  howl.once('fade', () => howl.stop(id), id);
}

/**
 * Setter surface for the settings store (soundMaster/soundUi/soundPages/
 * soundAmbient map straight onto these keys; shelf may mirror pages).
 */
export function setVolumes(partial: Partial<Volumes>): void {
  for (const key of Object.keys(volumes) as VolumeKey[]) {
    const v = partial[key];
    if (v !== undefined) volumes[key] = clamp01(v);
  }
  // Live-apply to the running ambient bed.
  if (ambient) ambient.howl.volume(effectiveVolume(ambient.name, undefined), ambient.id);
}

export function getVolumes(): Readonly<Volumes> {
  return { ...volumes };
}

/**
 * settings.soundCharacter -> here (via the settings apply step).
 * Live-applies to the running ambient bed so the change is audible at once.
 */
export function setSoundCharacter(next: SoundCharacter): void {
  if (character === next) return;
  character = next;
  if (ambient) ambient.howl.volume(effectiveVolume(ambient.name, undefined), ambient.id);
}

export function getSoundCharacter(): SoundCharacter {
  return character;
}

/**
 * The reader's chosen sound set (see sound/soundSets.ts). Total: an unknown
 * id resolves to the house set rather than leaving the engine unvoiced.
 *
 * `sound/soundSetPrefs.ts` owns the persisted value and calls this; the
 * engine itself still never imports src/data.
 */
export function setSoundSet(next: SoundSetId | string): void {
  const resolved = resolveSoundSetId(next);
  if (soundSet === resolved) return;
  soundSet = resolved;
}

export function getSoundSet(): SoundSetId {
  return soundSet;
}

/** Hard mute for every sound; restores the ambient bed on unmute. */
export function muteAll(mute: boolean): void {
  if (muted === mute) return;
  muted = mute;
  if (mute) {
    fadeOutAmbient(200);
  } else if (ambientWanted) {
    void startAmbient();
  }
}

export function isMuted(): boolean {
  return muted;
}

/** Reduced-sound preference: skips tick-hover, pencil-scratch, typing ticks. */
export function setReducedSound(reduced: boolean): void {
  reducedSound = reduced;
}

export function isReducedSound(): boolean {
  return reducedSound;
}

/* ------------------------------ typing sounds ------------------------------ */
/*
 * Feature 29 — velocity-varied pencil ticks on keystroke, off by default.
 *
 * Editor wiring (one line inside PageEditor's editorProps.handleDOMEvents,
 * plus adding `keystroke` to the existing engine import):
 *
 *   keydown: () => { keystroke(); return false; },
 *
 * The engine handles everything else: the enabled flag (settings.typingSounds
 * via setTypingSounds), rate limiting, variant rotation, velocity variation,
 * mute, reduced-sound and the character preset.
 */

/** Hard ceiling on tick playback rate — held keys stay a whisper. */
export const TYPING_MAX_TICKS_PER_S = 12;
const TYPING_MIN_INTERVAL_MS = 1000 / TYPING_MAX_TICKS_PER_S;

let typingSoundsEnabled = false;
let lastTypingTickMs = Number.NEGATIVE_INFINITY;
/** Total ticks actually played this session (observability for tests/E2E). */
let typingTicksPlayed = 0;
let typingRng: () => number = Math.random;

/** settings.typingSounds -> here (via the settings apply step). */
export function setTypingSounds(enabled: boolean): void {
  typingSoundsEnabled = enabled;
}

export function isTypingSounds(): boolean {
  return typingSoundsEnabled;
}

/**
 * Editor keystroke hook. Rate-limited to 12 ticks/s; each tick is a rotated
 * pencil-tap variant with velocity-varied gain. `nowMs` is injectable for
 * deterministic tests.
 */
export function keystroke(nowMs: number = Date.now()): void {
  // `roleSilent` covers mute, reduced sound, the character's skip list and a
  // set that voices the keystroke role as silence — the same decision play()
  // is about to make, asked before the tick is counted rather than after.
  if (!typingSoundsEnabled || roleSilent('typing-tick')) return;
  if (nowMs - lastTypingTickMs < TYPING_MIN_INTERVAL_MS) return;
  lastTypingTickMs = nowMs;
  typingTicksPlayed += 1;
  // Floor 0.6, not 0.45: the spread is there so a run of keystrokes does not
  // metronome, but at 0.45 the soft end of the range put a tick 7 dB under its
  // own family and review heard nothing at all. 0.6-1.0 keeps the unevenness
  // and costs 2.5 dB of it.
  const velocity = 0.6 + 0.4 * typingRng();
  void play('typing-tick', { volume: velocity });
}

/* ------------------------------- hourly chime ------------------------------ */
/*
 * Feature 30 — a single warm tube-bell note at the top of each hour.
 * Honors settings.hourlyChime (via setHourlyChime); fires only while the app
 * window is focused, and never within the first 10 minutes after launch.
 */

const CHIME_MIN_UPTIME_MS = 10 * 60_000;
const CHIME_POLL_MS = 20_000;

/** Injectable clock/focus so tests can drive the scheduler deterministically. */
export interface ChimeDeps {
  now(): number;
  hasFocus(): boolean;
}

const defaultChimeDeps: ChimeDeps = {
  now: () => Date.now(),
  hasFocus: () => (typeof document !== 'undefined' ? document.hasFocus() : false),
};

let chimeDeps: ChimeDeps = defaultChimeDeps;
/** App-launch instant — the module loads once, at boot. */
let launchedAtMs = Date.now();
let hourlyChimeEnabled = false;
let chimeTimer: ReturnType<typeof setInterval> | undefined;
let lastSeenHourKey = '';
/** Total chimes actually rung this session (observability for tests/E2E). */
let chimesPlayed = 0;

/** Local-clock hour bucket ("day 20293 hour 14") — chimes follow wall time. */
function hourKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
}

/** settings.hourlyChime -> here (via the settings apply step). Idempotent. */
export function setHourlyChime(enabled: boolean): void {
  if (hourlyChimeEnabled === enabled) return;
  hourlyChimeEnabled = enabled;
  if (enabled) {
    // Arm on the current hour so enabling mid-hour never fires immediately.
    lastSeenHourKey = hourKey(chimeDeps.now());
    chimeTimer = setInterval(chimeTick, CHIME_POLL_MS);
  } else if (chimeTimer !== undefined) {
    clearInterval(chimeTimer);
    chimeTimer = undefined;
  }
}

export function isHourlyChime(): boolean {
  return hourlyChimeEnabled;
}

/**
 * One scheduler poll (exported for tests; the interval calls it every 20 s).
 * Rings the bell exactly once per wall-clock hour boundary — skipped (not
 * deferred) when unfocused, muted, or within 10 minutes of launch.
 */
export function chimeTick(): void {
  if (!hourlyChimeEnabled) return;
  const now = chimeDeps.now();
  const key = hourKey(now);
  if (key === lastSeenHourKey) return;
  lastSeenHourKey = key;
  if (muted) return;
  if (now - launchedAtMs < CHIME_MIN_UPTIME_MS) return;
  if (!chimeDeps.hasFocus()) return;
  chimesPlayed += 1;
  void play('chime-hour', { volume: 0.8 });
}

/* ------------------------------ exposed state ------------------------------ */

/** Snapshot of the engine's routing state — E2E asserts wiring through this. */
export interface SoundEngineState {
  soundscape: SoundscapeName;
  ambientWanted: boolean;
  /** The loop the running bed is playing, or null when no bed runs. */
  ambientPlaying: SoundName | null;
  muted: boolean;
  reducedSound: boolean;
  character: SoundCharacter;
  /** The reader's chosen voicing — what QA asserts a picker actually applied. */
  set: SoundSetId;
  typingSounds: boolean;
  /** Ticks actually played this session — E2E asserts the rate limiter with it. */
  typingTicksPlayed: number;
  hourlyChime: boolean;
  /** Chimes actually rung this session. */
  chimesPlayed: number;
  volumes: Volumes;
}

export function getEngineState(): SoundEngineState {
  return {
    soundscape,
    ambientWanted,
    ambientPlaying: ambient?.name ?? null,
    muted,
    reducedSound,
    character,
    set: soundSet,
    typingSounds: typingSoundsEnabled,
    typingTicksPlayed,
    hourlyChime: hourlyChimeEnabled,
    chimesPlayed,
    volumes: { ...volumes },
  };
}

/**
 * Debug/E2E surface on window: Playwright specs call these and assert
 * getState() snapshots instead of listening to actual audio.
 */
declare global {
  interface Window {
    __nbSound?: {
      getState: typeof getEngineState;
      setSoundscape: typeof setSoundscape;
      startAmbient: typeof startAmbient;
      stopAmbient: typeof stopAmbient;
      setTypingSounds: typeof setTypingSounds;
      keystroke: typeof keystroke;
      setHourlyChime: typeof setHourlyChime;
      chimeTick: typeof chimeTick;
      setSoundCharacter: typeof setSoundCharacter;
      /**
       * Set the voicing WITHOUT persisting it — the engine-level seam.
       * A probe that wants to assert the picker's whole path (store → engine)
       * should use `__nbSoundSets.save` from `soundSetPrefs.ts` instead: a
       * probe's own `import('/src/sound/…')` on a dev server that has served
       * HMR updates can resolve to a second copy of the module, and writes to
       * that copy never reach the engine the app is actually playing through.
       */
      setSoundSet: typeof setSoundSet;
      getSoundSet: typeof getSoundSet;
      resolveVoice: (role: FamilyName) => SoundVoice | null;
      poolFor: typeof poolFor;
      play: typeof play;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__nbSound = {
    getState: getEngineState,
    setSoundscape,
    startAmbient,
    stopAmbient,
    setTypingSounds,
    keystroke,
    setHourlyChime,
    chimeTick,
    setSoundCharacter,
    setSoundSet,
    getSoundSet,
    resolveVoice: (role: FamilyName) => resolveVoice(soundSet, role),
    poolFor,
    play,
  };
}

/* ------------------------------- test seams -------------------------------- */

/** Swap the chime clock/focus check; re-anchors "launch" at deps.now(). */
export function setChimeDepsForTests(deps: ChimeDeps): void {
  chimeDeps = deps;
  launchedAtMs = deps.now();
}

/** Swap the typing velocity RNG for deterministic assertions. */
export function setTypingRngForTests(rng: () => number): void {
  typingRng = rng;
}

/** Swap the variant/pitch/level RNG for deterministic assertions. */
export function setPlayRngForTests(rng: () => number): void {
  playRng = rng;
  pickers.clear();
}

/** Reset all engine state (volumes, mute, caches, variant rotation). */
export function resetEngineForTests(): void {
  volumes = defaultVolumes();
  muted = false;
  reducedSound = false;
  character = 'calm';
  soundSet = DEFAULT_SOUND_SET_ID;
  ambient = undefined;
  ambientWanted = false;
  soundscape = 'rain';
  howls.clear();
  howlerModule = undefined;
  loadHowler = defaultLoader;
  pickers.clear();
  playRng = Math.random;
  lastVoicedPlayMs = Number.NEGATIVE_INFINITY;
  typingSoundsEnabled = false;
  lastTypingTickMs = Number.NEGATIVE_INFINITY;
  typingTicksPlayed = 0;
  typingRng = Math.random;
  if (chimeTimer !== undefined) clearInterval(chimeTimer);
  chimeTimer = undefined;
  hourlyChimeEnabled = false;
  lastSeenHourKey = '';
  chimesPlayed = 0;
  chimeDeps = defaultChimeDeps;
  launchedAtMs = Date.now();
}
