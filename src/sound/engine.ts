/**
 * src/sound/engine.ts — typed procedural-sound playback engine.
 *
 * Wraps @pixi/sound behind a small typed surface. The library is loaded after
 * mount, critical interaction cues decode in the background, and every play
 * carries its volume and speed into Pixi's play options before the first
 * sample starts.
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
 * Shipped sets add no new recordings — they condition the shipped, licensed
 * cues at play time. See the header of soundSets.ts for why, and for the
 * credits consequence (there is none: a set plays a cue, so it plays that
 * cue's provenance).
 *
 * A set may also carry a master-bus FILTER, installed through Pixi Sound's
 * public `filtersAll` surface. Its limits live in `sound/filter.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE READER'S OWN SETS
 * ─────────────────────────────────────────────────────────────────────────
 * A selection may also be a `user:` id (`sound/userSoundSets.ts`): a shipped
 * BASE set plus the reader's own files for some of the roles. Everything the
 * base decides still applies — rate, gain, layering, pool, jitter, filter,
 * every skip list — the only difference is which bytes a role reaches for.
 * That is why `Cue` below exists: the engine plays a URL with a category, and
 * `/sounds/<name>.wav` is simply the shipped way of naming one.
 *
 * The Pixi Sound dependency and jitter RNG are injectable for focused tests.
 */

import {
  applyBusFilter,
  busFilterNodes,
  busFilterStatus,
  describeBusFilter,
  resetBusFilterForTests,
  type BusFilterStatus,
  type PixiFilterConstructor,
  type PixiSoundGlobal,
} from './filter';
import {
  DEFAULT_SOUND_SET_ID,
  resolveSoundSetId,
  resolveVoice,
  soundSetFilter,
  soundSetJitterScale,
  soundSetPool,
  type SoundLayer,
  type SoundSetId,
  type SoundVoice,
} from './soundSets';
import {
  baseSetIdOf,
  isUserSoundSetId,
  userCueFor,
  userSoundSet,
  type AnySoundSetId,
} from './userSoundSets';
import * as bundledPixiSound from '@pixi/sound';
import {
  getPageTurnAudioState,
  playPageTurn,
  preparePageTurnAudio,
  resetPageTurnAudioForTests,
  type PageTurnAudioState,
} from './pageTurnPlayer';
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
  // One measured, stable take. Rotating six recordings made the same action
  // vary by 2.9x RMS energy and turned an isolated slow page turn into a dice
  // roll. The other WAVs remain in the manifest for old concrete call sites,
  // but the semantic page-turn role always reaches this clean take.
  'page-flip': ['page-flip-2'],
  'book-pull': ['book-pull', 'book-pull-2', 'book-pull-3', 'book-pull-4'],
  'book-return': ['book-return', 'book-return-2', 'book-return-3', 'book-return-4'],
  'shelf-whoosh': ['shelf-whoosh', 'shelf-whoosh-2', 'shelf-whoosh-3'],
  'pop-soft': ['pop-soft', 'pop-soft-2', 'pop-soft-3', 'pop-soft-4', 'pop-soft-5'],
  'click-soft': ['click-soft', 'click-soft-2', 'click-soft-3', 'click-soft-4'],
  'tick-hover': ['tick-hover', 'tick-hover-2', 'tick-hover-3', 'tick-hover-4', 'tick-hover-5'],
  'check-done': ['check-done', 'check-done-2', 'check-done-3', 'check-done-4'],
  'crumple-delete': ['crumple-delete', 'crumple-delete-2', 'crumple-delete-3', 'crumple-delete-4'],
  'drop-thump': ['drop-thump', 'drop-thump-2', 'drop-thump-3', 'drop-thump-4'],
  // One genuine CC0 balloon take. Do not manufacture variant counts by
  // pitch-shifting it; silence is preferable to a mislabeled substitute.
  confetti: ['confetti'],
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

/* ------------------------ injectable Pixi Sound -------------------------- */

export interface PixiInstanceLike {
  readonly id: number;
  volume: number;
  speed: number;
  loop: boolean;
  muted: boolean;
  paused: boolean;
  stop(): void;
  once(event: 'end' | 'stop', fn: () => void): unknown;
}

export interface PixiSoundLike {
  readonly isLoaded: boolean;
  readonly isPlayable: boolean;
  readonly isPlaying: boolean;
  readonly instances: PixiInstanceLike[];
  readonly duration: number;
  volume: number;
  speed: number;
  loop: boolean;
  play(options?: {
    volume?: number;
    speed?: number;
    loop?: boolean;
    complete?: () => void;
  }): PixiInstanceLike | Promise<PixiInstanceLike>;
  stop(): unknown;
  destroy(): void;
}

export interface PixiSoundOptions {
  readonly url: string | string[];
  readonly loop?: boolean;
  readonly preload?: boolean;
  readonly volume?: number;
  readonly speed?: number;
  readonly loaded?: (error: Error | null, sound?: PixiSoundLike) => void;
}

export interface PixiSoundLibraryLike extends PixiSoundGlobal {
  readonly context: {
    readonly audioContext?: AudioContext | null;
    paused?: boolean;
    muted?: boolean;
    volume?: number;
    playEmptySound?: () => void;
  };
  disableAutoPause: boolean;
  volumeAll: number;
  add(alias: string, options: PixiSoundOptions): PixiSoundLike;
  exists(alias: string): boolean;
  find(alias: string): PixiSoundLike;
  remove(alias: string): unknown;
  removeAll(): unknown;
  muteAll(): unknown;
  unmuteAll(): unknown;
  pauseAll(): unknown;
  resumeAll(): unknown;
  close(): unknown;
  init(): unknown;
}

export interface PixiSoundModule {
  readonly sound: PixiSoundLibraryLike;
  readonly Filter?: PixiFilterConstructor;
}

export type PixiSoundLoader = () => Promise<PixiSoundModule>;

/**
 * This is deliberately a STATIC import.
 *
 * Vite gave the old dynamic import its own optimized-dependency URL. PixiJS
 * was already alive under the shelf's URL, so evaluating the second URL ran
 * Pixi's canvas extension registration twice and threw before SoundLibrary
 * could create a context (`canvas-system already has a handler`). Keeping
 * sound in the initial module graph gives both packages one Pixi module
 * identity and also guarantees the backend exists before the first gesture.
 */
const defaultLoader: PixiSoundLoader = async () =>
  bundledPixiSound as unknown as PixiSoundModule;

let loadPixiSound: PixiSoundLoader = defaultLoader;
let pixiModule: Promise<PixiSoundModule> | undefined;
let pixiLibrary: PixiSoundLibraryLike | undefined;
let pixiFilter: PixiFilterConstructor | undefined;
let lastTrustedGestureMs = Number.NEGATIVE_INFINITY;
let trustedGestures = 0;
let lastBackendError: string | null = null;
let contextRecoveries = 0;
let recoveringContext = false;

const userActivationIsActive = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? false;
};

/**
 * The small DOM surface needed to resume audio from a real gesture. Kept
 * structural so the lifecycle can be proved with a fake target in node tests.
 */
export interface AudioGestureTarget {
  addEventListener(type: 'pointerdown' | 'keydown', listener: EventListener, capture: boolean): void;
  removeEventListener(type: 'pointerdown' | 'keydown', listener: EventListener, capture: boolean): void;
}

let disarmGestureResume: (() => void) | undefined;

function handleTrustedGesture(library: PixiSoundLibraryLike): void {
  // A trusted interaction inside the app is stronger focus evidence than
  // document.hasFocus(), which WebView2 can report one event-loop turn late.
  // This only clears focus-derived suppression; the reader's hard mute stays.
  if (!appFocused) setAppFocused(true);
  applyLibraryMute();
  const ctx = library.context.audioContext;
  if (ctx === undefined || ctx === null) {
    audioUnlocked = true;
    flushQueuedPlays(true);
    return;
  }
  if (ctx.state === 'closed') {
    audioUnlocked = false;
    lastBackendError = 'Pixi Sound AudioContext is closed';
    if (!recoveringContext) {
      recoveringContext = true;
      try {
        // Pixi documents close()+init() as its hardware-failure recovery path.
        // We are already inside a trusted gesture, so recreate synchronously,
        // discard every sound tied to the dead context, and unlock the new one.
        soundEntries.clear();
        invalidateAmbientStarts();
        fadeOutAmbient(0);
        preloadState = 'idle';
        library.init();
        if (library.supported !== false) library.disableAutoPause = true;
        library.volumeAll = 1;
        applyLibraryMute();
        contextRecoveries += 1;
        syncBusFilter();
        handleTrustedGesture(library);
        void preloadCriticalCues();
      } catch (error) {
        backendLoadFailures += 1;
        lastBackendError = `Pixi Sound context recovery failed: ${String(error)}`;
      } finally {
        recoveringContext = false;
      }
    }
    return;
  }

  // This call and resume() must occur before the trusted dispatch unwinds.
  // Starting queued BufferSources now is safe even while resume is pending:
  // AudioContext.currentTime is frozen while suspended, so they begin at the
  // resumed clock's first available quantum rather than expiring in silence.
  library.context.playEmptySound?.();
  flushQueuedPlays(true);
  if (ctx.state === 'running') {
    audioUnlocked = true;
    return;
  }
  void ctx.resume().then(() => {
    audioUnlocked = ctx.state === 'running';
    if (audioUnlocked) {
      unlocks += 1;
      lastBackendError = null;
      flushQueuedPlays(true);
    } else {
      resumeFailures += 1;
      lastBackendError = `AudioContext resume resolved in state ${ctx.state}`;
    }
  }).catch((error) => {
    audioUnlocked = false;
    resumeFailures += 1;
    lastBackendError = `AudioContext resume failed: ${String(error)}`;
  });
}

/**
 * Synchronous first-gesture latch. Pixi is a static dependency now, but the
 * injectable loader used by focused tests may still resolve asynchronously;
 * the latch keeps that seam honest without changing production timing.
 */
export function recordInteractionGesture(nowMs: number = Date.now()): void {
  if (!appFocused) setAppFocused(true);
  const isNewGesture = nowMs - lastTrustedGestureMs > 8;
  lastTrustedGestureMs = nowMs;
  if (isNewGesture) trustedGestures += 1;
  if (pixiLibrary !== undefined) {
    handleTrustedGesture(pixiLibrary);
    return;
  }
  void loadPixiSoundOnce().then(({ sound: library }) => {
    if (userActivationIsActive()) handleTrustedGesture(library);
  }).catch((error) => {
    lastBackendError = `Pixi Sound import failed after gesture: ${String(error)}`;
  });
}

/**
 * Arm capture-phase unlock on the EXISTING Pixi Sound AudioContext. MDN's
 * autoplay contract is literal: resume must be called inside the trusted
 * gesture dispatch, before any awaited preload or application handler.
 */
export function armAudioGestureResume(
  library: PixiSoundLibraryLike | undefined,
  target: AudioGestureTarget | undefined,
): () => void {
  disarmGestureResume?.();
  disarmGestureResume = undefined;
  if (library === undefined || target === undefined) return () => undefined;

  let armed = true;
  const disarm = (): void => {
    if (!armed) return;
    armed = false;
    target.removeEventListener('pointerdown', resume, true);
    target.removeEventListener('keydown', resume, true);
    if (disarmGestureResume === disarm) disarmGestureResume = undefined;
  };
  const resume: EventListener = (): void => {
    const now = Date.now();
    // App's synchronous broker normally sees this same event first. Do not
    // resume/play the empty unlock buffer twice for one physical gesture.
    if (now - lastTrustedGestureMs <= 8) return;
    trustedGestures += 1;
    lastTrustedGestureMs = now;
    handleTrustedGesture(library);
  };

  target.addEventListener('pointerdown', resume, true);
  target.addEventListener('keydown', resume, true);
  disarmGestureResume = disarm;
  return disarm;
}

/** Test seam: swap Pixi Sound and drop every decoded entry. */
export function setPixiSoundLoader(loader: PixiSoundLoader): void {
  disarmGestureResume?.();
  invalidateAmbientStarts();
  fadeOutAmbient(0);
  loadPixiSound = loader;
  pixiModule = undefined;
  pixiLibrary = undefined;
  pixiFilter = undefined;
  soundEntries.clear();
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
/** Reader preference: a background Alcove should not keep speaking. */
let muteWhenUnfocused = false;
/** Window/visibility state mirrored synchronously for every playback gate. */
let appFocused = true;
let reducedSound = false;
let character: SoundCharacter = 'calm';
/**
 * The reader's chosen voicing — a shipped id (`sound/soundSets.ts`) or one of
 * their own (`sound/userSoundSets.ts`).
 */
let soundSet: AnySoundSetId = DEFAULT_SOUND_SET_ID;

/**
 * ONE CONCRETE THING TO PLAY.
 *
 * The engine used to be able to say `SoundName` everywhere and derive the
 * rest, because every playable byte lived under `/sounds/`. A reader's own
 * file has no `SoundName` and never will, so the four facts a play needs —
 * where the bytes are, which slider owns them, whether they loop, and what to
 * cache them under — are carried explicitly. `shippedCue()` is the adaptor
 * for everything that still names a file.
 */
interface Cue {
  /** Cache key. A `SoundName` for shipped cues; `user:set|role` for the rest. */
  readonly key: string;
  readonly url: string;
  readonly category: SoundCategory;
  readonly loop: boolean;
  /** Known-good shipped take used when a custom or alternate cue cannot decode. */
  readonly fallback?: SoundName;
}

const shippedCue = (name: SoundName): Cue => ({
  key: name,
  url: soundUrl(name),
  category: SOUND_MANIFEST[name].category,
  loop: SOUND_MANIFEST[name].loop,
  fallback: name,
});

/**
 * Which volume slider a ROLE sits under — derived from the role's own first
 * take, so a reader's page-turn file rides the page slider exactly as the
 * shipped one does and no new mapping has to be maintained.
 */
const categoryOfRole = (role: FamilyName): SoundCategory =>
  SOUND_MANIFEST[(SOUND_FAMILIES[role] as readonly SoundName[])[0] as SoundName].category;

type LoadStatus = 'loading' | 'ready' | 'error';

interface SoundEntry {
  readonly cue: Cue;
  readonly sound: PixiSoundLike;
  readonly ready: Promise<PixiSoundLike>;
  status: LoadStatus;
  error: string | null;
}

const soundEntries = new Map<string, SoundEntry>();

interface AmbientState {
  sound: PixiSoundLike;
  instance: PixiInstanceLike;
  /** Which loop this bed is playing (soundscape switches crossfade between them). */
  name: SoundName;
}
let ambient: AmbientState | undefined;
/** Whether the ambient bed should be running (survives mute/unmute). */
let ambientWanted = false;
/**
 * Monotonic authority for an async ambient start.
 *
 * Loading and even `sound.play()` may cross task boundaries. Every preference
 * change invalidates the authority captured by older starts, so an instance
 * which arrives after a rapid soundscape switch or after "play ambience" was
 * turned off can only stop itself; it can never publish itself as the bed.
 * This deliberately never resets to zero -- a promise from before a test/app
 * reset must not collide with a request made after it.
 */
let ambientGeneration = 0;
/**
 * Every ambient instance the engine owns, including the outgoing half of a
 * crossfade. A single `ambient` pointer cannot stop a superseded voice once a
 * newer voice has replaced it, which was how rapid switches accumulated
 * several inaudible-to-state but very audible loops.
 */
const ambientVoices = new Set<PixiInstanceLike>();
/** One cancellable volume ramp per ambient instance. */
const ambientFadeTimers = new Map<PixiInstanceLike, ReturnType<typeof setTimeout>>();

type PreloadState = 'idle' | 'loading' | 'ready' | 'partial' | 'failed';
let preloadState: PreloadState = 'idle';
let audioUnlocked = false;
let cuesReady = 0;
let cueLoadFailures = 0;
let backendLoadFailures = 0;
let playFailures = 0;
let fallbacksUsed = 0;
let unlocks = 0;
let resumeFailures = 0;
let queuedPlays = 0;
let replayedPlays = 0;
let expiredPlays = 0;
let cooldownDrops = 0;
let concurrencyDrops = 0;

const CRITICAL_FAMILIES = ['page-flip', 'book-pull', 'click-soft'] as const satisfies readonly FamilyName[];
const CRITICAL_CUES: readonly SoundName[] = CRITICAL_FAMILIES.flatMap(
  (family) => [...SOUND_FAMILIES[family]],
);

async function preloadCriticalCues(): Promise<void> {
  if (preloadState === 'loading' || preloadState === 'ready') return;
  preloadState = 'loading';
  const results = await Promise.allSettled(CRITICAL_CUES.map((name) => ensureSound(shippedCue(name))));
  const ready = results.filter((result) => result.status === 'fulfilled').length;
  preloadState = ready === results.length ? 'ready' : ready === 0 ? 'failed' : 'partial';
}

/** Whether a sound is currently forbidden by either kind of mute. */
function soundsSuppressed(): boolean {
  return muted || (muteWhenUnfocused && !appFocused);
}

function detectAppFocus(): boolean {
  if (typeof document === 'undefined') return true;
  const visible = document.visibilityState === undefined || document.visibilityState === 'visible';
  const focused = typeof document.hasFocus !== 'function' || document.hasFocus();
  return visible && focused;
}

/**
 * Apply a focus transition without cutting a waveform at an arbitrary sample.
 * New one-shots are gated immediately; the long ambient bed leaves on a short
 * fade and returns only when it was wanted before the window went away.
 */
function setAppFocused(focused: boolean): void {
  if (appFocused === focused) return;
  appFocused = focused;
  applyLibraryMute();
  if (muteWhenUnfocused && !focused) {
    invalidateAmbientStarts();
    fadeOutAmbient(200);
  } else if (muteWhenUnfocused && focused && ambientWanted && !muted) {
    void startAmbient();
  }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  appFocused = detectAppFocus();
  document.addEventListener('visibilitychange', () => setAppFocused(detectAppFocus()));
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    // `document.hasFocus()` can still report the old value during the blur
    // dispatch in some webviews, so blur carries the known answer directly.
    window.addEventListener('blur', () => setAppFocused(false));
    window.addEventListener('focus', () => setAppFocused(true));
  }
}
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

/**
 * When the CLICK role last started, whoever asked for it.
 *
 * `lastVoicedPlayMs` deliberately ignores clicks — a control that voices itself
 * with a click must still let the delegated handler know that was only a click.
 * But that leaves a hole: a click played by anything OTHER than `uiClicks.ts`
 * is invisible to it, so it stacks a second one underneath.
 *
 * Measured, not theorised: a tape of the onboarding sound-set picker recorded
 * exactly seven same-family pairs within 20ms across 38 plays — one per chip
 * press. `previewSoundSet()`'s first beat is a click, the delegated handler
 * does not see it, and both land in the same task. Two takes of the same
 * broadband recording at ~0.55 each, roughly 0ms apart.
 *
 * It does not clip (worst burst peak 0.18) and there is no evidence it is the
 * static the reader reported — that was chased separately and is demonstrably
 * not in the graph at all. It is simply a doubled transient nobody asked for.
 */
let lastClickPlayMs = Number.NEGATIVE_INFINITY;

/** How long since a click was voiced by ANY caller. See `lastClickPlayMs`. */
export function msSinceClickPlay(nowMs: number = Date.now()): number {
  return nowMs - lastClickPlayMs;
}

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
  const fromSet = soundSetPool(baseSet());
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

/**
 * The shipped set behind the current selection: itself, or the base of the
 * reader's own set. Everything except *which bytes play* is decided here —
 * rate, gain, layering, pool, jitter, the skip lists and the bus filter.
 */
function baseSet(): SoundSetId {
  return baseSetIdOf(soundSet, DEFAULT_SOUND_SET_ID);
}

/**
 * Install (or re-install) the active set's master-bus filter.
 *
 * Cheap and idempotent by design — `applyBusFilter` compares the AudioContext
 * identity and requested chain and returns immediately when neither moved.
 */
function syncBusFilter(): void {
  applyBusFilter(pixiLibrary, pixiFilter, soundSetFilter(baseSet()));
}

function applyLibraryMute(): void {
  if (pixiLibrary === undefined) return;
  if (soundsSuppressed()) pixiLibrary.muteAll();
  else pixiLibrary.unmuteAll();
}

function loadPixiSoundOnce(): Promise<PixiSoundModule> {
  pixiModule ??= loadPixiSound().then((mod) => {
    pixiLibrary = mod.sound;
    pixiFilter = mod.Filter;
    // A notebook is routinely idle for minutes. Keep one stable device graph;
    // recreating it around a rapid page-turn burst is exactly the kind of seam
    // that can turn a short transient into noise.
    if (mod.sound.supported !== false) mod.sound.disableAutoPause = true;
    mod.sound.volumeAll = 1;
    const ctx = mod.sound.context.audioContext;
    audioUnlocked = ctx === undefined || ctx === null || ctx.state === 'running';
    armAudioGestureResume(
      mod.sound,
      typeof document === 'undefined' ? undefined : document,
    );
    applyLibraryMute();
    syncBusFilter();
    return mod;
  }).catch((error) => {
    backendLoadFailures += 1;
    lastBackendError = `Pixi Sound import failed: ${String(error)}`;
    pixiModule = undefined;
    throw error;
  });
  return pixiModule;
}

/**
 * Load Pixi Sound after mount, arm gesture-synchronous resume, and begin
 * decoding the interaction cues which must feel immediate. It never plays.
 */
export async function prepareInteractionAudio(): Promise<void> {
  await Promise.all([loadPixiSoundOnce(), preparePageTurnAudio()]);
  void preloadCriticalCues();
}

function ensureSound(cue: Cue): Promise<PixiSoundLike> {
  const cached = soundEntries.get(cue.key);
  if (cached !== undefined) return cached.ready;

  return loadPixiSoundOnce().then(({ sound: library }) => {
    const afterLoad = soundEntries.get(cue.key);
    if (afterLoad !== undefined) return afterLoad.ready;

    let resolveReady!: (sound: PixiSoundLike) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<PixiSoundLike>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    let entry: SoundEntry | undefined;
    let pendingResult: { error: Error | null; sound?: PixiSoundLike } | undefined;
    const loaded = (error: Error | null, decoded?: PixiSoundLike): void => {
      if (entry === undefined) {
        pendingResult = { error, sound: decoded };
        return;
      }
      if (entry.status !== 'loading') return;
      if (error !== null || decoded === undefined) {
        const failure = error ?? new Error(`Pixi Sound did not decode ${cue.key}`);
        entry.status = 'error';
        entry.error = failure.message;
        cueLoadFailures += 1;
        lastBackendError = `Cue ${cue.key} failed to decode: ${failure.message}`;
        rejectReady(failure);
        return;
      }
      entry.status = 'ready';
      entry.error = null;
      cuesReady += 1;
      lastBackendError = null;
      resolveReady(decoded);
    };
    const sound = library.add(cue.key, {
      url: cue.url,
      loop: cue.loop,
      preload: true,
      volume: 1,
      speed: 1,
      loaded,
    });
    entry = { cue, sound, ready, status: 'loading', error: null };
    soundEntries.set(cue.key, entry);
    // Cached/instant decodes are allowed to complete during library.add().
    if (pendingResult !== undefined) loaded(pendingResult.error, pendingResult.sound);
    else if (sound.isLoaded || sound.isPlayable) loaded(null, sound);
    return ready;
  });
}

/**
 * `setGain` is the sound set's per-role trim and sits OUTSIDE the first clamp
 * on purpose: `requested` is a per-call 0..1 gain, but a set's trim is allowed
 * to be greater than one — that is how a set voices a button with the pencil
 * tick, which ships 8 dB under the board tap it replaces. It can only spend
 * headroom the reader's own sliders left; the single clamp at the end is what
 * keeps that honest.
 */
function effectiveVolume(category: SoundCategory, requested: number | undefined, setGain = 1): number {
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
  /**
   * Cancel a queued or ringing play. Active audio fades briefly before it is
   * stopped, so cancelling a rapid sound-set preview cannot create the hard
   * waveform edge heard as a click/crackle.
   */
  signal?: AbortSignal;
}

/**
 * Preload every sound. Optional — play() lazily loads on demand — but calling
 * this after first paint hides any first-play latency.
 */
export async function init(): Promise<void> {
  await Promise.all([loadPixiSoundOnce(), preparePageTurnAudio()]);
  const results = await Promise.allSettled(SOUND_NAMES.map((name) => ensureSound(shippedCue(name))));
  if (results.every((result) => result.status === 'fulfilled')) preloadState = 'ready';
  else if (results.some((result) => result.status === 'fulfilled')) preloadState = 'partial';
  else preloadState = 'failed';
}

/**
 * Fire-and-forget playback. Resolves with the Pixi Sound instance id, or undefined
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
  if (options.signal?.aborted === true) return undefined;
  if (isFamily(name)) return playRole(name, options);
  return playFile(shippedCue(name), options, {
    gain: 1,
    rate: undefined,
    stamp: !CLICK_NAMES.has(name),
    gateByName: true,
    role: familyOfSound(name),
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
  /** Semantic role used for concurrency and cooldown policy. */
  readonly role: FamilyName | null;
}

/**
 * Whether a role is inaudible right now, for every reason there is. Shared
 * with `keystroke()`, which has to make the same decision without playing —
 * otherwise a silenced role would still be counted as a tick.
 */
function roleSilent(role: FamilyName): boolean {
  if (soundsSuppressed()) return true;
  if (reducedSound && REDUCED_SKIP_ROLES.has(role)) return true;
  if (CHARACTER_SKIP_ROLES[character].has(role)) return true;
  // A file the reader put here is heard even when the base set silences the
  // role. Anything else would mean importing a click into a set based on
  // `almost-nothing` and getting silence with no way to see why — and the
  // three preferences above are still absolute, because those are answers to
  // questions the reader asked more recently than "here is my click".
  if (userCueFor(soundSet, role) !== null) return false;
  return resolveVoice(baseSet(), role) === null;
}

/**
 * The bytes a role reaches for: the reader's own file when their set names
 * one, otherwise the next take in the rotation.
 *
 * Called with a ROLE at the top of a play and with a LAYER'S cue underneath
 * it, which is deliberate — replacing `drop-thump` also replaces the thump
 * the library sets put under a book coming off the shelf, and a reader who
 * recorded one thump should not have to notice there were two places it went.
 */
function cueForFamily(family: FamilyName): Cue {
  const own = userCueFor(soundSet, family);
  if (own === null) return shippedCue(pickVariant(family));
  return {
    key: `${soundSet}|${family}`,
    url: own.src,
    category: categoryOfRole(family),
    loop: false,
    fallback: (SOUND_FAMILIES[family] as readonly SoundName[])[0],
  };
}

function familyOfSound(name: SoundName): FamilyName | null {
  for (const family of FAMILY_NAMES) {
    if ((SOUND_FAMILIES[family] as readonly SoundName[]).includes(name)) return family;
  }
  return null;
}

/** The voice a role gets when only the reader's own file is speaking for it. */
const identityVoice = (role: FamilyName): SoundVoice => ({
  cue: role,
  rate: 1,
  gain: 1,
  layer: null,
});

/** Play one interaction role through the reader's sound set. */
async function playRole(role: FamilyName, options: PlayOptions): Promise<number | undefined> {
  if (options.signal?.aborted === true) return undefined;
  if (roleSilent(role)) return undefined;
  const voice = resolveVoice(baseSet(), role) ?? identityVoice(role);
  // Reduced sound means one sound per action, so a set's body layer is the
  // first thing to go — it is exactly the "extra" that preference asks about.
  if (voice.layer !== null && !reducedSound) scheduleLayer(voice.layer, options.signal);
  // The reader's file is attached to the ROLE, so it wins over the base set's
  // substitution: importing a click and then hearing a page turn because the
  // base voices buttons with paper would be indefensible. Only when they have
  // no file for the role does the base's choice of family get to decide.
  const cue = userCueFor(soundSet, role) !== null ? cueForFamily(role) : cueForFamily(voice.cue);
  return playFile(cue, options, {
    gain: voice.gain,
    rate: voice.rate,
    stamp: role !== CLICK_ROLE,
    gateByName: false,
    role,
  });
}

/**
 * A second, quieter cue under the first — a soft thump behind a book coming
 * off the shelf. Never stamps `lastVoicedPlayMs`: a layer is part of the
 * gesture that scheduled it, not an event of its own.
 */
function scheduleLayer(layer: SoundLayer, signal?: AbortSignal): void {
  const fire = (): void => {
    if (signal?.aborted === true) return;
    void playFile(cueForFamily(layer.cue), { signal }, {
      gain: layer.gain,
      rate: layer.rate,
      stamp: false,
      gateByName: false,
      role: layer.cue,
    });
  };
  if (layer.delayMs <= 0) {
    fire();
    return;
  }
  // Kept so the engine can be torn down with a layer still in the air. Left
  // untracked, a delayed layer fires into whatever comes next — in the unit
  // suite that meant one test's thump landing inside another's play log, and
  // in the app it means a cue arriving after the thing that asked for it is
  // gone. See `resetEngineForTests`.
  const timer = setTimeout(() => {
    layerTimers.delete(timer);
    fire();
  }, layer.delayMs);
  layerTimers.add(timer);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    layerTimers.delete(timer);
  }, { once: true });
}

/** Layer plays that have been scheduled but have not sounded yet. */
const layerTimers = new Set<ReturnType<typeof setTimeout>>();

/** Read through a function so TypeScript does not treat `aborted` as immutable across awaits. */
const wasAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted ?? false;

function isAudioReady(): boolean {
  const ctx = pixiLibrary?.context.audioContext;
  // Pixi's HTMLAudio fallback has no AudioContext and is already playable.
  return ctx === undefined || ctx === null || ctx.state === 'running';
}

const CANCEL_FADE_MS = 32;

interface PendingPlay {
  readonly cue: Cue;
  readonly options: PlayOptions;
  readonly plan: FilePlan;
  readonly expiresAt: number;
}

const MAX_PENDING_PLAYS = 8;
const PENDING_TTL_MS = 1200;
const pendingPlays: PendingPlay[] = [];

function queueUntilUnlocked(cue: Cue, options: PlayOptions, plan: FilePlan): void {
  if (wasAborted(options.signal)) return;
  const dedupe = plan.role ?? cue.key;
  const prior = pendingPlays.findIndex((item) => (item.plan.role ?? item.cue.key) === dedupe);
  if (prior >= 0) pendingPlays.splice(prior, 1);
  if (pendingPlays.length >= MAX_PENDING_PLAYS) {
    pendingPlays.shift();
    expiredPlays += 1;
  }
  pendingPlays.push({ cue, options, plan, expiresAt: Date.now() + PENDING_TTL_MS });
  queuedPlays += 1;
}

function flushQueuedPlays(fromTrustedGesture = false): void {
  if (!fromTrustedGesture && !isAudioReady()) return;
  const now = Date.now();
  const queued = pendingPlays.splice(0);
  for (const item of queued) {
    if (item.expiresAt < now || wasAborted(item.options.signal)) {
      expiredPlays += 1;
      continue;
    }
    replayedPlays += 1;
    void playFile(item.cue, item.options, item.plan, fromTrustedGesture);
  }
  if (ambientWanted && !soundsSuppressed()) void startAmbient();
}

interface VoicePolicy {
  readonly cooldownMs: number;
  readonly maxVoices: number;
  /** Keep a rapid gesture stream quiet until it has paused this long. */
  readonly burstQuietMs?: number;
}

const DEFAULT_VOICE_POLICY: VoicePolicy = { cooldownMs: 25, maxVoices: 3 };
const VOICE_POLICIES: Partial<Record<FamilyName, VoicePolicy>> = {
  // Reader-supplied page cues still pass through the generic backend. Allow
  // every isolated turn and cap only true overlap; the shipped page cue uses
  // the dedicated Howler lane above and never reaches this policy.
  'page-flip': { cooldownMs: 90, maxVoices: 1 },
  'book-pull': { cooldownMs: 90, maxVoices: 2 },
  'book-return': { cooldownMs: 90, maxVoices: 2 },
  'click-soft': { cooldownMs: 45, maxVoices: 2 },
  'pop-soft': { cooldownMs: 55, maxVoices: 2 },
  'tick-hover': { cooldownMs: 80, maxVoices: 1 },
  'typing-tick': { cooldownMs: 70, maxVoices: 2 },
};
const MAX_ACTIVE_VOICES = 12;
const activeVoices = new Map<number, { role: FamilyName | null; instance: PixiInstanceLike }>();
const reservations = new Map<FamilyName | null, number>();
const lastRoleStart = new Map<FamilyName | null, number>();
const lastRoleRequest = new Map<FamilyName | null, number>();
let burstDrops = 0;

function reserveVoice(role: FamilyName | null): boolean {
  const policy = role === null ? DEFAULT_VOICE_POLICY : VOICE_POLICIES[role] ?? DEFAULT_VOICE_POLICY;
  const now = Date.now();
  const lastRequest = lastRoleRequest.get(role) ?? Number.NEGATIVE_INFINITY;
  lastRoleRequest.set(role, now);
  if (policy.burstQuietMs !== undefined && now - lastRequest < policy.burstQuietMs) {
    burstDrops += 1;
    return false;
  }
  const last = lastRoleStart.get(role) ?? Number.NEGATIVE_INFINITY;
  if (now - last < policy.cooldownMs) {
    cooldownDrops += 1;
    return false;
  }
  let sameRole = reservations.get(role) ?? 0;
  for (const active of activeVoices.values()) if (active.role === role) sameRole += 1;
  const reservedTotal = [...reservations.values()].reduce((sum, count) => sum + count, 0);
  if (sameRole >= policy.maxVoices || activeVoices.size + reservedTotal >= MAX_ACTIVE_VOICES) {
    concurrencyDrops += 1;
    return false;
  }
  reservations.set(role, (reservations.get(role) ?? 0) + 1);
  lastRoleStart.set(role, now);
  return true;
}

function releaseReservation(role: FamilyName | null): void {
  const left = (reservations.get(role) ?? 1) - 1;
  if (left <= 0) reservations.delete(role);
  else reservations.set(role, left);
}

/** Fade a live voice to zero before stopping it; a hard stop is a new click. */
function stopOnAbort(
  signal: AbortSignal,
  instance: PixiInstanceLike,
): void {
  let retiring = false;
  const retire = (): void => {
    if (retiring) return;
    retiring = true;
    const start = instance.volume;
    const began = Date.now();
    const step = (): void => {
      const progress = Math.min(1, (Date.now() - began) / CANCEL_FADE_MS);
      instance.volume = start * (1 - progress);
      if (progress < 1) setTimeout(step, 8);
      else instance.stop();
    };
    step();
  };
  signal.addEventListener('abort', retire, { once: true });
  // Abort may have won the few instructions between play() and listener setup.
  if (signal.aborted) retire();
}

/** Play one concrete cue, under a plan the caller (or the set) decided. */
async function playFile(
  cue: Cue,
  options: PlayOptions,
  plan: FilePlan,
  fromQueue = false,
): Promise<number | undefined> {
  if (wasAborted(options.signal)) return undefined;
  // Only a shipped cue can be an ambient bed, and its key IS its SoundName —
  // a reader's key carries a `|` and can never collide with one.
  const name = cue.key as SoundName;
  if (AMBIENT_LOOP_NAMES.has(name)) {
    // Playing an ambient loop directly means "switch the bed to it".
    const entry = (Object.entries(SOUNDSCAPE_LOOPS) as Array<[SoundscapeName, SoundName]>).find(
      ([, loop]) => loop === name,
    );
    if (entry) soundscape = entry[0];
    await startAmbient();
    return ambient?.instance.id;
  }
  if (soundsSuppressed()) return undefined;
  const profile = CHARACTER_PROFILES[character];
  if (plan.gateByName) {
    if (reducedSound && REDUCED_SKIP.has(name)) return undefined;
    if (profile.skip.has(name)) return undefined;
  }
  // Stamped synchronously, before the first await, so the delegated button
  // click in `sound/uiClicks.ts` can tell whether the control it just saw
  // pressed already made a sound of its own.
  if (plan.stamp) lastVoicedPlayMs = Date.now();
  // Stamped whether or not `stamp` is set: the click role deliberately does not
  // count as a "voiced play", and this is the separate note that stops it being
  // doubled. `CLICK_NAMES` is the click family's own file list, which is what a
  // cue key carries for a shipped sound; a user set voices the role through
  // `user:<set>|click-soft`, so both spellings are checked rather than only the
  // one the house set happens to use.
  if (CLICK_NAMES.has(cue.key as SoundName) || cue.key.endsWith(`|${CLICK_ROLE}`)) {
    lastClickPlayMs = Date.now();
  }

  const jitterOn = options.noJitter !== true;
  const wobble = soundSetJitterScale(baseSet());
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

  const vol = effectiveVolume(cue.category, (options.volume ?? 1) * level, plan.gain);

  // Page turns use their own predecoded Howler lane. This check happens
  // before Pixi Sound is touched, so the busiest WebGL animation in the app
  // cannot share a renderer-owned context/ticker/compressor with its cue.
  // A reader-supplied page sound has a `user:...|page-flip` key and therefore
  // keeps using the generic backend; only the measured shipped take is routed.
  if (plan.role === 'page-flip' && cue.key === 'page-flip-2') {
    return playPageTurn(vol, rate ?? 1);
  }

  try {
    await loadPixiSoundOnce();
  } catch {
    return undefined;
  }
  if (wasAborted(options.signal)) return undefined;
  const withinTrustedGestureWindow = Date.now() - lastTrustedGestureMs < 1500;
  if (!isAudioReady() && !fromQueue && !withinTrustedGestureWindow) {
    audioUnlocked = false;
    queueUntilUnlocked(cue, options, plan);
    return undefined;
  }
  // Focus/mute may have changed while either lazy load above was pending.
  if (soundsSuppressed()) return undefined;
  syncBusFilter();

  if (!reserveVoice(plan.role)) return undefined;
  try {
    let sound: PixiSoundLike;
    try {
      sound = await ensureSound(cue);
    } catch {
      const fallback = cue.fallback;
      if (fallback === undefined || fallback === cue.key) {
        releaseReservation(plan.role);
        return undefined;
      }
      fallbacksUsed += 1;
      sound = await ensureSound(shippedCue(fallback));
    }
    if (
      wasAborted(options.signal)
      || soundsSuppressed()
      || (!isAudioReady() && !fromQueue && !withinTrustedGestureWindow)
    ) {
      releaseReservation(plan.role);
      return undefined;
    }
    let instance: PixiInstanceLike | undefined;
    const cleanup = (): void => {
      if (instance !== undefined) activeVoices.delete(instance.id);
    };
    const result = sound.play({ volume: vol, speed: rate ?? 1, loop: cue.loop, complete: cleanup });
    instance = await Promise.resolve(result);
    releaseReservation(plan.role);
    activeVoices.set(instance.id, { role: plan.role, instance });
    instance.once('end', cleanup);
    instance.once('stop', cleanup);
    if (options.signal !== undefined) stopOnAbort(options.signal, instance);
    return instance.id;
  } catch (error) {
    releaseReservation(plan.role);
    playFailures += 1;
    lastBackendError = `Cue ${cue.key} failed to play: ${String(error)}`;
    return undefined;
  }
}

/** Give every already-running async start an authority it can no longer hold. */
function invalidateAmbientStarts(): number {
  ambientGeneration += 1;
  return ambientGeneration;
}

/** Whether an async start is still the exact bed the current settings ask for. */
function ambientStartIsCurrent(generation: number, name: SoundName): boolean {
  if (generation !== ambientGeneration || !ambientWanted || soundsSuppressed()) return false;
  const current = getSoundscape();
  return current !== 'none' && SOUNDSCAPE_LOOPS[current] === name;
}

function cancelAmbientFade(instance: PixiInstanceLike): void {
  const timer = ambientFadeTimers.get(instance);
  if (timer !== undefined) clearTimeout(timer);
  ambientFadeTimers.delete(instance);
}

/** Forget a voice from both the owner set and the public current-bed pointer. */
function releaseAmbientInstance(instance: PixiInstanceLike): void {
  cancelAmbientFade(instance);
  ambientVoices.delete(instance);
  if (ambient?.instance === instance) ambient = undefined;
}

/**
 * Stop a zero-volume or failed-authority instance synchronously.
 *
 * A stale start was created with volume zero, so this path cannot introduce a
 * waveform edge. It is important that it is synchronous: starting a second
 * fade for an instance which never had authority would briefly leave exactly
 * the orphan loop this guard exists to prevent.
 */
function stopAmbientInstance(instance: PixiInstanceLike): void {
  cancelAmbientFade(instance);
  instance.volume = 0;
  try {
    instance.stop();
  } catch {
    // A stale instance may belong to an AudioContext which was just closed.
    // Ownership still has to be released so it cannot poison later starts.
  } finally {
    releaseAmbientInstance(instance);
  }
}

/** Register cleanup before publishing an instance as the selected bed. */
function trackAmbientInstance(instance: PixiInstanceLike): void {
  if (ambientVoices.has(instance)) return;
  ambientVoices.add(instance);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    releaseAmbientInstance(instance);
  };
  instance.once('end', release);
  instance.once('stop', release);
}

/**
 * Start the ambient bed for the current soundscape, fading in over 600 ms.
 * Idempotent; a no-op while the soundscape is 'none'. When a different loop
 * is already running it leaves on a short de-click ramp while the selected
 * bed fades in. The generation checks on both sides of `play()` make the
 * operation latest-intent-wins.
 */
export async function startAmbient(): Promise<void> {
  ambientWanted = true;
  const generation = invalidateAmbientStarts();
  if (soundsSuppressed() || soundscape === 'none') return;
  const name = SOUNDSCAPE_LOOPS[soundscape];
  let sound: PixiSoundLike;
  try {
    await loadPixiSoundOnce();
    if (!isAudioReady() || !ambientStartIsCurrent(generation, name)) return;
    sound = await ensureSound(shippedCue(name));
  } catch {
    return;
  }
  syncBusFilter();
  // State may have changed while the module/file loaded (soundscape is
  // mutable across the await — re-read it through the accessor so control-flow
  // narrowing from the guard above cannot leak into this check).
  if (!ambientStartIsCurrent(generation, name)) return;
  if (ambient?.name === name && sound.isPlaying) return;

  let instance: PixiInstanceLike;
  try {
    instance = await Promise.resolve(sound.play({ volume: 0, speed: 1, loop: true }));
  } catch (error) {
    playFailures += 1;
    lastBackendError = `Ambient ${name} failed to play: ${String(error)}`;
    return;
  }
  if (!ambientStartIsCurrent(generation, name)) {
    stopAmbientInstance(instance);
    return;
  }

  // Keep the old bed through decode, then retire every superseded bed promptly
  // once the selected replacement exists. A 600 ms fade on every rapid picker
  // choice lets five field recordings pile up; 32 ms is still a de-click ramp
  // but is over before the next deliberate choice can become another layer.
  fadeOutAmbient(CANCEL_FADE_MS);
  trackAmbientInstance(instance);
  ambient = { sound, instance, name };
  fadeInstance(instance, effectiveVolume(SOUND_MANIFEST[name].category, undefined), AMBIENT_FADE_MS);
}

/** Stop every ambient voice with a short de-click fade. */
export function stopAmbient(): void {
  ambientWanted = false;
  invalidateAmbientStarts();
  // A preference toggle should sound off immediately, while a very short
  // de-click ramp avoids cutting a field recording at an arbitrary sample.
  fadeOutAmbient(CANCEL_FADE_MS);
}

/**
 * Pick which ambient bed the app plays. Crossfades when a bed is running,
 * fades to silence on 'none'. Does not by itself decide *whether* the bed
 * runs — that stays with startAmbient/stopAmbient (the ambientLoop setting).
 */
export function setSoundscape(name: SoundscapeName): void {
  if (soundscape === name) return;
  soundscape = name;
  invalidateAmbientStarts();
  // A picker choice withdraws the previous bed immediately. Keeping it alive
  // until the replacement decodes means a failed or rapidly superseded load
  // leaves audio which no longer matches the visible selection.
  fadeOutAmbient(CANCEL_FADE_MS);
  if (name === 'none') return;
  if (ambientWanted && !soundsSuppressed()) void startAmbient();
}

export function getSoundscape(): SoundscapeName {
  return soundscape;
}

function fadeOutAmbient(fadeMs: number): void {
  ambient = undefined;
  for (const instance of [...ambientVoices]) fadeInstance(instance, 0, fadeMs, true);
}

function fadeInstance(
  instance: PixiInstanceLike,
  target: number,
  durationMs: number,
  stopAfter = false,
): void {
  cancelAmbientFade(instance);
  const start = instance.volume;
  const began = Date.now();
  // The prompt 32 ms retirement needs more than two coarse 16 ms jumps.
  // Four-millisecond steps keep the shipped beds' worst adjacent output jump
  // at their own waveform baseline while the long 600 ms fade stays cheap.
  const stepMs = durationMs <= CANCEL_FADE_MS ? 4 : 16;
  const step = (): void => {
    const progress = durationMs <= 0 ? 1 : Math.min(1, (Date.now() - began) / durationMs);
    instance.volume = start + (target - start) * progress;
    if (progress < 1) {
      const timer = setTimeout(() => {
        if (ambientFadeTimers.get(instance) !== timer) return;
        ambientFadeTimers.delete(instance);
        step();
      }, stepMs);
      ambientFadeTimers.set(instance, timer);
    } else if (stopAfter) {
      stopAmbientInstance(instance);
    } else {
      ambientFadeTimers.delete(instance);
    }
  };
  step();
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
  if (ambient) ambient.instance.volume = effectiveVolume(SOUND_MANIFEST[ambient.name].category, undefined);
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
  if (ambient) ambient.instance.volume = effectiveVolume(SOUND_MANIFEST[ambient.name].category, undefined);
}

export function getSoundCharacter(): SoundCharacter {
  return character;
}

/**
 * The reader's chosen sound set — a shipped id (`sound/soundSets.ts`) or one
 * of their own (`sound/userSoundSets.ts`).
 *
 * Total, and total in a specific way: a `user:` id is accepted only while it
 * is REGISTERED. That is the whole guard against a stored choice outliving
 * the files behind it — the reader deleted their set, or the row survived a
 * restore the assets did not — and it resolves to the house set the same way
 * an unknown shipped id does.
 *
 * `sound/soundSetPrefs.ts` owns the persisted value and calls this; the
 * engine itself still never imports src/data.
 */
export function setSoundSet(next: AnySoundSetId | string): void {
  const resolved: AnySoundSetId =
    isUserSoundSetId(next) && userSoundSet(next) !== null ? next : resolveSoundSetId(next);
  soundSet = resolved;
  // Not guarded by "did it change": the base of a reader's set can move under
  // a stable id (they re-based it, or an import landed), and the bus filter
  // follows the base.
  syncBusFilter();
}

export function getSoundSet(): AnySoundSetId {
  return soundSet;
}

/** The shipped set the current choice resolves to for everything but bytes. */
export function getBaseSoundSet(): SoundSetId {
  return baseSet();
}

/**
 * What the master-bus filter is actually doing right now.
 *
 * The honest surface for a feature whose availability depends on the browser:
 * `installed` is false with a `reason` whenever Web Audio is not there, and
 * QA asserts this rather than assuming the node exists.
 */
export function getBusFilter(): BusFilterStatus {
  return busFilterStatus();
}

/** Hard mute for every sound; restores the ambient bed on unmute. */
export function muteAll(mute: boolean): void {
  if (muted === mute) return;
  muted = mute;
  applyLibraryMute();
  if (mute) {
    invalidateAmbientStarts();
    fadeOutAmbient(200);
  } else if (ambientWanted && !soundsSuppressed()) {
    void startAmbient();
  }
}

/**
 * Silence the sound engine while another window has focus. The setting is
 * independent from mute-all: turning either one off must not override the
 * other, and a wanted ambience bed resumes only when sound is allowed again.
 */
export function setMuteWhenUnfocused(mute: boolean): void {
  if (muteWhenUnfocused === mute) return;
  muteWhenUnfocused = mute;
  applyLibraryMute();
  if (soundsSuppressed()) {
    invalidateAmbientStarts();
    fadeOutAmbient(200);
  } else if (ambientWanted) {
    void startAmbient();
  }
}

/** Reduced-sound preference: skips tick-hover, pencil-scratch, typing ticks. */
export function setReducedSound(reduced: boolean): void {
  reducedSound = reduced;
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
  if (soundsSuppressed()) return;
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
  /** Current plus retiring crossfade voices; settles to 1 on, 0 off. */
  ambientActive: number;
  muted: boolean;
  muteWhenUnfocused: boolean;
  appFocused: boolean;
  reducedSound: boolean;
  character: SoundCharacter;
  /** The reader's chosen voicing — what QA asserts a picker actually applied. */
  set: AnySoundSetId;
  /** The shipped set behind it — the same id unless `set` is one of theirs. */
  baseSet: SoundSetId;
  /** How many roles the chosen set voices with the reader's own files. */
  ownCues: number;
  /**
   * The master-bus filter, as it actually is: `installed` false with a
   * `reason` is a real answer and QA is expected to read it rather than
   * assume a BiquadFilterNode exists in every environment.
   */
  filter: {
    wanted: string;
    installed: boolean;
    supported: boolean;
    tag: string;
    reason: string | null;
  };
  typingSounds: boolean;
  /** Ticks actually played this session — E2E asserts the rate limiter with it. */
  typingTicksPlayed: number;
  hourlyChime: boolean;
  /** Chimes actually rung this session. */
  chimesPlayed: number;
  backend: {
    name: '@pixi/sound';
    loaded: boolean;
    preload: PreloadState;
    unlocked: boolean;
    contextState: string;
    suppressedBy: 'mute' | 'focus' | null;
    trustedGestures: number;
    lastGestureAgeMs: number | null;
    lastError: string | null;
    cached: number;
    ready: number;
    active: number;
    queued: number;
    queuedTotal: number;
    loadFailures: number;
    backendLoadFailures: number;
    playFailures: number;
    fallbacksUsed: number;
    unlocks: number;
    resumeFailures: number;
    replayed: number;
    expired: number;
    cooldownDrops: number;
    concurrencyDrops: number;
    contextRecoveries: number;
    burstDrops: number;
  };
  /** Page turns are isolated from Pixi's render-owned sound graph. */
  pageTurns: PageTurnAudioState;
  volumes: Volumes;
}

export function getEngineState(): SoundEngineState {
  const bus = busFilterStatus();
  return {
    soundscape,
    ambientWanted,
    ambientPlaying: ambient?.name ?? null,
    ambientActive: ambientVoices.size,
    muted,
    muteWhenUnfocused,
    appFocused,
    reducedSound,
    character,
    set: soundSet,
    baseSet: baseSet(),
    ownCues: Object.keys(userSoundSet(soundSet)?.cues ?? {}).length,
    filter: {
      wanted: describeBusFilter(soundSetFilter(baseSet())),
      installed: bus.installed,
      supported: bus.supported,
      tag: bus.tag,
      reason: bus.reason,
    },
    typingSounds: typingSoundsEnabled,
    typingTicksPlayed,
    hourlyChime: hourlyChimeEnabled,
    chimesPlayed,
    backend: {
      name: '@pixi/sound',
      loaded: pixiLibrary !== undefined,
      preload: preloadState,
      unlocked: isAudioReady() && audioUnlocked,
      contextState: pixiLibrary?.context.audioContext?.state ?? (pixiLibrary === undefined ? 'not-loaded' : 'legacy'),
      suppressedBy: muted ? 'mute' : muteWhenUnfocused && !appFocused ? 'focus' : null,
      trustedGestures,
      lastGestureAgeMs: Number.isFinite(lastTrustedGestureMs)
        ? Math.max(0, Date.now() - lastTrustedGestureMs)
        : null,
      lastError: lastBackendError,
      cached: soundEntries.size,
      ready: cuesReady,
      active: activeVoices.size,
      queued: pendingPlays.length,
      queuedTotal: queuedPlays,
      loadFailures: cueLoadFailures,
      backendLoadFailures,
      playFailures,
      fallbacksUsed,
      unlocks,
      resumeFailures,
      replayed: replayedPlays,
      expired: expiredPlays,
      cooldownDrops,
      concurrencyDrops,
      contextRecoveries,
      burstDrops,
    },
    pageTurns: getPageTurnAudioState(),
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
      /**
       * The live BiquadFilterNodes, so a probe can tap the REAL chain with an
       * AnalyserNode and measure what the filter does to the app's own output
       * — rather than asserting that we called `createBiquadFilter`.
       */
      busFilterNodes: () => readonly BiquadFilterNode[];
      /** Public Pixi Sound library for device/context diagnostics. */
      pixiSound: () => PixiSoundLibraryLike | undefined;
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
    resolveVoice: (role: FamilyName) => resolveVoice(baseSet(), role),
    poolFor,
    play,
    busFilterNodes,
    pixiSound: () => pixiLibrary,
  };
}

/* ------------------------------- test seams -------------------------------- */

/** Swap the chime clock/focus check; re-anchors "launch" at deps.now(). */
export function setChimeDepsForTests(deps: ChimeDeps): void {
  chimeDeps = deps;
  launchedAtMs = deps.now();
}

/** Drive the focus gate in node tests, where there is no real window. */
export function setAppFocusedForTests(focused: boolean): void {
  setAppFocused(focused);
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
  disarmGestureResume?.();
  disarmGestureResume = undefined;
  invalidateAmbientStarts();
  fadeOutAmbient(0);
  volumes = defaultVolumes();
  muted = false;
  muteWhenUnfocused = false;
  appFocused = true;
  reducedSound = false;
  character = 'calm';
  soundSet = DEFAULT_SOUND_SET_ID;
  ambientWanted = false;
  soundscape = 'rain';
  resetPageTurnAudioForTests();
  try {
    pixiLibrary?.removeAll();
  } catch {
    // A test adapter may already have torn itself down.
  }
  soundEntries.clear();
  pendingPlays.length = 0;
  activeVoices.clear();
  reservations.clear();
  lastRoleStart.clear();
  lastRoleRequest.clear();
  for (const timer of layerTimers) clearTimeout(timer);
  layerTimers.clear();
  pixiModule = undefined;
  pixiLibrary = undefined;
  pixiFilter = undefined;
  loadPixiSound = defaultLoader;
  preloadState = 'idle';
  audioUnlocked = false;
  cuesReady = 0;
  cueLoadFailures = 0;
  backendLoadFailures = 0;
  playFailures = 0;
  fallbacksUsed = 0;
  unlocks = 0;
  resumeFailures = 0;
  queuedPlays = 0;
  replayedPlays = 0;
  expiredPlays = 0;
  cooldownDrops = 0;
  concurrencyDrops = 0;
  contextRecoveries = 0;
  recoveringContext = false;
  burstDrops = 0;
  lastTrustedGestureMs = Number.NEGATIVE_INFINITY;
  trustedGestures = 0;
  lastBackendError = null;
  resetBusFilterForTests();
  pickers.clear();
  playRng = Math.random;
  lastVoicedPlayMs = Number.NEGATIVE_INFINITY;
  lastClickPlayMs = Number.NEGATIVE_INFINITY;
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
