/**
 * src/sound/engine.ts — typed procedural-sound playback engine.
 *
 * Wraps Howler behind a small typed surface. Fully lazy: the howler module
 * is dynamically imported and Howl instances are created only when a sound
 * is first needed, so cold start pays nothing until the first play().
 *
 * The settings store drives this from outside via setVolumes / muteAll /
 * setReducedSound — this module never imports src/data.
 *
 * For tests, the Howler dependency is injectable via setHowlerLoader().
 */

/* ------------------------------- sound names ------------------------------ */

export type SoundName =
  | 'page-flip-1'
  | 'page-flip-2'
  | 'page-flip-3'
  | 'book-pull'
  | 'book-return'
  | 'shelf-whoosh'
  | 'pop-soft'
  | 'tick-hover'
  | 'check-done'
  | 'crumple-delete'
  | 'drop-thump'
  | 'pencil-scratch'
  | 'confetti'
  | 'ambient-library'
  | 'ambient-rain'
  | 'ambient-fireplace'
  | 'ambient-crickets'
  | 'typing-tick-1'
  | 'typing-tick-2'
  | 'typing-tick-3'
  | 'chime-hour';

/** `play('page-flip')` picks a random variant with no immediate repeats. */
export type PlayableName = SoundName | 'page-flip';

export type SoundCategory = 'ui' | 'pages' | 'shelf' | 'ambient';
export type VolumeKey = SoundCategory | 'master';
export type Volumes = Record<VolumeKey, number>;

export const PAGE_FLIP_VARIANTS = ['page-flip-1', 'page-flip-2', 'page-flip-3'] as const satisfies readonly SoundName[];

/** Velocity-varied pencil ticks behind the optional typing sounds. */
export const TYPING_TICK_VARIANTS = ['typing-tick-1', 'typing-tick-2', 'typing-tick-3'] as const satisfies readonly SoundName[];

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

export const SOUND_MANIFEST: Record<SoundName, SoundDef> = {
  'page-flip-1': { category: 'pages', loop: false },
  'page-flip-2': { category: 'pages', loop: false },
  'page-flip-3': { category: 'pages', loop: false },
  'pencil-scratch': { category: 'pages', loop: true },
  'typing-tick-1': { category: 'pages', loop: false },
  'typing-tick-2': { category: 'pages', loop: false },
  'typing-tick-3': { category: 'pages', loop: false },
  'book-pull': { category: 'shelf', loop: false },
  'book-return': { category: 'shelf', loop: false },
  'shelf-whoosh': { category: 'shelf', loop: false },
  'drop-thump': { category: 'shelf', loop: false },
  'pop-soft': { category: 'ui', loop: false },
  'tick-hover': { category: 'ui', loop: false },
  'check-done': { category: 'ui', loop: false },
  'crumple-delete': { category: 'ui', loop: false },
  confetti: { category: 'ui', loop: false },
  'ambient-library': { category: 'ambient', loop: true },
  'ambient-rain': { category: 'ambient', loop: true },
  'ambient-fireplace': { category: 'ambient', loop: true },
  'ambient-crickets': { category: 'ambient', loop: true },
  'chime-hour': { category: 'ambient', loop: false },
};

export const SOUND_NAMES = Object.keys(SOUND_MANIFEST) as readonly SoundName[];

/** Sounds skipped entirely when the user prefers reduced sound. */
const REDUCED_SKIP: ReadonlySet<SoundName> = new Set([
  'tick-hover',
  'pencil-scratch',
  ...TYPING_TICK_VARIANTS,
]);

export const soundUrl = (name: SoundName): string => `/sounds/${name}.wav`;

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

let pickPageFlip = createVariantPicker(PAGE_FLIP_VARIANTS);

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
  return clamp01(requested ?? 1) * volumes[category] * volumes.master;
}

/* --------------------------------- API ------------------------------------ */

export interface PlayOptions {
  /** Per-call gain 0..1, multiplied with category and master gains. */
  volume?: number;
  /** Playback rate (1 = normal); callers can jitter ±10% to keep repeats organic. */
  rate?: number;
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
 * when the sound was skipped (muted, reduced-sound, or ambient delegation).
 */
export async function play(name: PlayableName, options: PlayOptions = {}): Promise<number | undefined> {
  const resolved: SoundName = name === 'page-flip' ? pickPageFlip() : name;
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
  const howl = await ensureHowl(resolved);
  const id = howl.play();
  howl.volume(effectiveVolume(resolved, options.volume), id);
  if (options.rate !== undefined) howl.rate(options.rate, id);
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
 * mute and reduced-sound.
 */

/** Hard ceiling on tick playback rate — held keys stay a whisper. */
export const TYPING_MAX_TICKS_PER_S = 12;
const TYPING_MIN_INTERVAL_MS = 1000 / TYPING_MAX_TICKS_PER_S;

let typingSoundsEnabled = false;
let lastTypingTickMs = Number.NEGATIVE_INFINITY;
/** Total ticks actually played this session (observability for tests/E2E). */
let typingTicksPlayed = 0;
let pickTypingTick = createVariantPicker(TYPING_TICK_VARIANTS);
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
 * pencil-tap variant with velocity-varied gain and a touch of rate jitter.
 * `nowMs` is injectable for deterministic tests.
 */
export function keystroke(nowMs: number = Date.now()): void {
  if (!typingSoundsEnabled || muted || reducedSound) return;
  if (nowMs - lastTypingTickMs < TYPING_MIN_INTERVAL_MS) return;
  lastTypingTickMs = nowMs;
  typingTicksPlayed += 1;
  const velocity = 0.45 + 0.55 * typingRng();
  void play(pickTypingTick(), { volume: velocity, rate: 0.94 + 0.12 * typingRng() });
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
  };
}

/* ------------------------------- test seams -------------------------------- */

/** Swap the chime clock/focus check; re-anchors "launch" at deps.now(). */
export function setChimeDepsForTests(deps: ChimeDeps): void {
  chimeDeps = deps;
  launchedAtMs = deps.now();
}

/** Swap the typing velocity/jitter RNG for deterministic assertions. */
export function setTypingRngForTests(rng: () => number): void {
  typingRng = rng;
}

/** Reset all engine state (volumes, mute, caches, variant rotation). */
export function resetEngineForTests(): void {
  volumes = defaultVolumes();
  muted = false;
  reducedSound = false;
  ambient = undefined;
  ambientWanted = false;
  soundscape = 'library';
  howls.clear();
  howlerModule = undefined;
  loadHowler = defaultLoader;
  pickPageFlip = createVariantPicker(PAGE_FLIP_VARIANTS);
  typingSoundsEnabled = false;
  lastTypingTickMs = Number.NEGATIVE_INFINITY;
  typingTicksPlayed = 0;
  pickTypingTick = createVariantPicker(TYPING_TICK_VARIANTS);
  typingRng = Math.random;
  if (chimeTimer !== undefined) clearInterval(chimeTimer);
  chimeTimer = undefined;
  hourlyChimeEnabled = false;
  lastSeenHourKey = '';
  chimesPlayed = 0;
  chimeDeps = defaultChimeDeps;
  launchedAtMs = Date.now();
}
