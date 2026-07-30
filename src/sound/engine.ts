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
 * For tests, the Howler dependency is injectable via setHowlerLoader() and
 * the jitter RNG via setPlayRngForTests().
 */

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
  | 'ambient-library'
  | 'ambient-rain'
  | 'ambient-fireplace'
  | 'ambient-crickets'
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
  'ambient-library': 'full',
  'ambient-rain': 'full',
  'ambient-fireplace': 'full',
  'ambient-crickets': 'full',
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

/** The user-facing soundscape choice (settings.soundscape). */
export type SoundscapeName = 'library' | 'rain' | 'fireplace' | 'crickets' | 'none';

/** Soundscape -> the seamless ambient loop that realizes it. */
export const SOUNDSCAPE_LOOPS = {
  library: 'ambient-library',
  rain: 'ambient-rain',
  fireplace: 'ambient-fireplace',
  crickets: 'ambient-crickets',
} as const satisfies Record<Exclude<SoundscapeName, 'none'>, SoundName>;

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
  ...SOUND_FAMILIES['tick-hover'],
  ...SOUND_FAMILIES['check-done'],
  ...SOUND_FAMILIES['crumple-delete'],
  ...SOUND_FAMILIES['drop-thump'],
  'pencil-scratch',
  ...SOUND_FAMILIES.confetti,
  'ambient-library',
  'ambient-rain',
  'ambient-fireplace',
  'ambient-crickets',
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
/** Which soundscape the bed realizes when it runs ('none' = silence). */
let soundscape: SoundscapeName = 'library';

/** RNG behind variant choice, pitch jitter and level jitter. */
let playRng: () => number = Math.random;

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
 * The variants of `family` this character is allowed to draw from. Falls
 * back to the whole family when the character's slice would be empty, so a
 * one-variant family can never starve the picker.
 */
export function poolFor(family: FamilyName, forCharacter: SoundCharacter = character): readonly SoundName[] {
  const all = SOUND_FAMILIES[family] as readonly SoundName[];
  const { pool } = CHARACTER_PROFILES[forCharacter];
  if (pool === 'all') return all;
  const slice = all.filter((n) => VARIANT_WEIGHTS[n] === pool);
  return slice.length > 0 ? slice : all;
}

/**
 * One rotating picker per family per character. Keyed by both so switching
 * character does not have to reset every family's rotation, and so a family
 * whose pool changed picks up the new pool immediately.
 */
const pickers = new Map<string, () => SoundName>();

function pickVariant(family: FamilyName): SoundName {
  const key = `${family}|${character}`;
  let pick = pickers.get(key);
  if (pick === undefined) {
    pick = createVariantPicker(poolFor(family), () => playRng());
    pickers.set(key, pick);
  }
  return pick();
}

const isFamily = (name: PlayableName): name is FamilyName =>
  Object.prototype.hasOwnProperty.call(SOUND_FAMILIES, name);

/** Resolve a playable name to the concrete file this play() will use. */
function resolveName(name: PlayableName): SoundName {
  return isFamily(name) ? pickVariant(name) : name;
}

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

function effectiveVolume(name: SoundName, requested: number | undefined): number {
  const category = SOUND_MANIFEST[name].category;
  const trim = CHARACTER_PROFILES[character].gain[category];
  return clamp01(clamp01(requested ?? 1) * volumes[category] * volumes.master * trim);
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
 * when the sound was skipped (muted, reduced-sound, character-skipped, or
 * ambient delegation).
 *
 * A family name rotates through that family's variants; every play also gets
 * a small pitch and level nudge so repetition never fatigues.
 */
export async function play(name: PlayableName, options: PlayOptions = {}): Promise<number | undefined> {
  const resolved = resolveName(name);
  if (AMBIENT_LOOP_NAMES.has(resolved)) {
    // Playing an ambient loop directly means "switch the bed to it".
    const entry = (Object.entries(SOUNDSCAPE_LOOPS) as Array<[SoundscapeName, SoundName]>).find(
      ([, loop]) => loop === resolved,
    );
    if (entry) soundscape = entry[0];
    await startAmbient();
    return ambient?.id;
  }
  if (muted) return undefined;
  if (reducedSound && REDUCED_SKIP.has(resolved)) return undefined;
  const profile = CHARACTER_PROFILES[character];
  if (profile.skip.has(resolved)) return undefined;

  const jitterOn = options.noJitter !== true;
  const level = jitterOn ? jitter(profile.levelJitter) : 1;
  const rate =
    options.rate ?? (jitterOn && profile.pitchJitter > 0 ? jitter(profile.pitchJitter) : undefined);

  const howl = await ensureHowl(resolved);
  const id = howl.play();
  howl.volume(effectiveVolume(resolved, (options.volume ?? 1) * level), id);
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
  if (!typingSoundsEnabled || muted || reducedSound) return;
  if (CHARACTER_PROFILES[character].skip.has('typing-tick-1')) return;
  if (nowMs - lastTypingTickMs < TYPING_MIN_INTERVAL_MS) return;
  lastTypingTickMs = nowMs;
  typingTicksPlayed += 1;
  const velocity = 0.45 + 0.55 * typingRng();
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
  ambient = undefined;
  ambientWanted = false;
  soundscape = 'library';
  howls.clear();
  howlerModule = undefined;
  loadHowler = defaultLoader;
  pickers.clear();
  playRng = Math.random;
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
