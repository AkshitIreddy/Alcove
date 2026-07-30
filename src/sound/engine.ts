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
  | 'ambient-library';

/** `play('page-flip')` picks a random variant with no immediate repeats. */
export type PlayableName = SoundName | 'page-flip';

export type SoundCategory = 'ui' | 'pages' | 'shelf' | 'ambient';
export type VolumeKey = SoundCategory | 'master';
export type Volumes = Record<VolumeKey, number>;

export const PAGE_FLIP_VARIANTS = ['page-flip-1', 'page-flip-2', 'page-flip-3'] as const satisfies readonly SoundName[];

interface SoundDef {
  readonly category: SoundCategory;
  readonly loop: boolean;
}

export const SOUND_MANIFEST: Record<SoundName, SoundDef> = {
  'page-flip-1': { category: 'pages', loop: false },
  'page-flip-2': { category: 'pages', loop: false },
  'page-flip-3': { category: 'pages', loop: false },
  'pencil-scratch': { category: 'pages', loop: true },
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
};

export const SOUND_NAMES = Object.keys(SOUND_MANIFEST) as readonly SoundName[];

/** Sounds skipped entirely when the user prefers reduced sound. */
const REDUCED_SKIP: ReadonlySet<SoundName> = new Set(['tick-hover', 'pencil-scratch']);

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
}
let ambient: AmbientState | undefined;
/** Whether the ambient bed should be running (survives mute/unmute). */
let ambientWanted = false;

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
  if (resolved === 'ambient-library') {
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

/** Start the ambient library loop, fading in over 600 ms. Idempotent. */
export async function startAmbient(): Promise<void> {
  ambientWanted = true;
  if (muted) return;
  const howl = await ensureHowl('ambient-library');
  if (!ambientWanted || muted) return; // state changed while loading
  if (ambient && howl.playing(ambient.id)) return;
  const id = howl.play();
  ambient = { howl, id };
  howl.volume(0, id);
  howl.fade(0, effectiveVolume('ambient-library', undefined), AMBIENT_FADE_MS, id);
}

/** Stop the ambient loop with a 600 ms fade-out. */
export function stopAmbient(): void {
  ambientWanted = false;
  fadeOutAmbient(AMBIENT_FADE_MS);
}

function fadeOutAmbient(fadeMs: number): void {
  const current = ambient;
  if (!current) return;
  ambient = undefined;
  const { howl, id } = current;
  howl.fade(effectiveVolume('ambient-library', undefined), 0, fadeMs, id);
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
  if (ambient) ambient.howl.volume(effectiveVolume('ambient-library', undefined), ambient.id);
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

/** Reduced-sound preference: skips tick-hover and pencil-scratch entirely. */
export function setReducedSound(reduced: boolean): void {
  reducedSound = reduced;
}

export function isReducedSound(): boolean {
  return reducedSound;
}

/* ------------------------------- test seams -------------------------------- */

/** Reset all engine state (volumes, mute, caches, variant rotation). */
export function resetEngineForTests(): void {
  volumes = defaultVolumes();
  muted = false;
  reducedSound = false;
  ambient = undefined;
  ambientWanted = false;
  howls.clear();
  howlerModule = undefined;
  loadHowler = defaultLoader;
  pickPageFlip = createVariantPicker(PAGE_FLIP_VARIANTS);
}
