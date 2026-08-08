/**
 * A deliberately small, isolated playback lane for the page-turn cue.
 *
 * Page turns are the one interaction that can start while the WebGL flip is
 * occupying the main thread. They used to share Pixi Sound's renderer-owned
 * context, analyser, compressor and instance ticker. The WAVs themselves do
 * not clip, but that is still needless coupling between the busiest visual
 * frame in the app and the sound that accompanies it.
 *
 * Howler is the app's declared sound architecture (AGENTS.md) and keeps its
 * Web Audio scheduling independent of Pixi's ticker. This lane also makes the
 * two constraints that matter for a clean transient explicit:
 *
 * - one predecoded, measured take (`page-flip-2.wav`), not a random pick from
 *   six recordings with a 2.9x RMS spread;
 * - one voice at a time. A second turn never hard-stops a ringing waveform;
 *   it simply leaves the first clean turn intact.
 *
 * Volume and rate are written to the Howl before `play()`. Howler copies those
 * group values into the new AudioBufferSource/GainNode before its first sample,
 * avoiding the discontinuity caused by correcting an already-started voice.
 */

import type { Howl as HowlType } from 'howler';

interface HowlerModule {
  readonly Howl: typeof HowlType;
  readonly Howler: {
    autoSuspend: boolean;
    readonly ctx?: AudioContext | null;
    readonly state?: string;
  };
}

let modulePromise: Promise<HowlerModule> | undefined;
let pageTurn: HowlType | undefined;
let pageTurnReady: Promise<HowlType> | undefined;
let decoded = false;
let reserved = false;
let loadFailed = false;
let plays = 0;
let busyDrops = 0;
let failures = 0;

const loadHowler = (): Promise<HowlerModule> => {
  modulePromise ??= import('howler').then((loaded) => {
    const mod = loaded as unknown as HowlerModule;
    // A notebook can be quiet for minutes. Suspending a shared context after
    // 30 seconds turns the next cue into a queued resume operation, precisely
    // the wrong seam to put under the page-turn animation.
    mod.Howler.autoSuspend = false;
    return mod;
  }).catch((error) => {
    loadFailed = true;
    modulePromise = undefined;
    throw error;
  });
  return modulePromise;
};

const ensurePageTurn = async (): Promise<HowlType> => {
  if (pageTurnReady !== undefined) return pageTurnReady;
  pageTurnReady = loadHowler().then(({ Howl }) => new Promise<HowlType>((resolve, reject) => {
    const howl = new Howl({
      src: ['/sounds/page-flip-2.wav'],
      format: ['wav'],
      html5: false,
      preload: true,
      loop: false,
      volume: 1,
      rate: 1,
      onload: () => {
        decoded = true;
        resolve(howl);
      },
      onloaderror: (_id, error) => {
        loadFailed = true;
        reject(new Error(`page turn failed to decode: ${String(error)}`));
      },
    });
    pageTurn = howl;
  })).catch((error) => {
    pageTurnReady = undefined;
    throw error;
  });
  return pageTurnReady;
};

/** Begin decoding during app idle, before the first book turn. */
export async function preparePageTurnAudio(): Promise<void> {
  try {
    await ensurePageTurn();
  } catch {
    // Playback reports the failure through the engine state; app boot must not
    // fail because one optional interaction cue could not initialize.
  }
}

/**
 * Play one stable page turn. Returns the Howler id or undefined when an
 * existing turn is still ringing or the backend could not initialize.
 */
export async function playPageTurn(volume: number, rate: number): Promise<number | undefined> {
  // Reserve synchronously, before decode or context-resume awaits. Otherwise
  // two fast turns made while the WAV is still loading both enqueue and begin
  // together once decoding finishes — the exact first-use burst this lane is
  // meant to prevent.
  if (reserved || pageTurn?.playing() === true) {
    busyDrops += 1;
    return undefined;
  }
  reserved = true;
  try {
    const howl = await ensurePageTurn();
    const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    const safeRate = Number.isFinite(rate) ? Math.max(0.75, Math.min(1.25, rate)) : 1;
    // Group setters happen before play so the cloned voice starts at the final
    // values; there is no gain/rate correction after its first sample.
    howl.volume(safeVolume);
    howl.rate(safeRate);
    const id = howl.play();
    const release = (): void => {
      reserved = false;
    };
    howl.once('end', release, id);
    howl.once('stop', release, id);
    // A WebView autoplay/device failure must not leave the lane permanently
    // reserved and silence every later turn. The next trusted gesture gets a
    // clean retry after Howler has had a chance to unlock/recover its context.
    howl.once('playerror', release, id);
    plays += 1;
    return id;
  } catch {
    reserved = false;
    failures += 1;
    return undefined;
  }
}

export interface PageTurnAudioState {
  readonly backend: 'howler';
  readonly prepared: boolean;
  readonly loadingFailed: boolean;
  readonly playing: boolean;
  readonly plays: number;
  readonly busyDrops: number;
  readonly failures: number;
}

export function getPageTurnAudioState(): PageTurnAudioState {
  return {
    backend: 'howler',
    prepared: decoded,
    loadingFailed: loadFailed,
    playing: reserved || (pageTurn?.playing() ?? false),
    plays,
    busyDrops,
    failures,
  };
}

/** Test/HMR cleanup: never hard-stop a production turn from the play path. */
export function resetPageTurnAudioForTests(): void {
  pageTurn?.unload();
  pageTurn = undefined;
  pageTurnReady = undefined;
  decoded = false;
  reserved = false;
  modulePromise = undefined;
  loadFailed = false;
  plays = 0;
  busyDrops = 0;
  failures = 0;
}
