// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// engine.ts keeps Pixi Sound static in production to preserve one Pixi module
// identity. This focused node test injects its own structural backend and must
// not evaluate Pixi's browser adapter before `navigator` exists.
vi.mock('@pixi/sound', () => ({ sound: {} }));

import {
  getEngineState,
  resetEngineForTests,
  setAppHiddenInTray,
  setPixiSoundLoader,
  setPlayAmbienceInTray,
  setSoundscape,
  startAmbient,
  stopAmbient,
  type PixiInstanceLike,
  type PixiSoundLibraryLike,
  type PixiSoundLike,
  type PixiSoundOptions,
} from '../src/sound/engine';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

class FakeInstance implements PixiInstanceLike {
  readonly handlers = new Map<'end' | 'stop', Array<() => void>>();
  volume: number;
  speed: number;
  loop: boolean;
  muted = false;
  paused = false;
  stopped = false;

  constructor(
    readonly id: number,
    options: { volume?: number; speed?: number; loop?: boolean },
    private readonly detach: (instance: FakeInstance) => void,
  ) {
    this.volume = options.volume ?? 1;
    this.speed = options.speed ?? 1;
    this.loop = options.loop ?? false;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.detach(this);
    for (const handler of this.handlers.get('stop') ?? []) handler();
    this.handlers.delete('stop');
  }

  once(event: 'end' | 'stop', fn: () => void): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(fn);
    this.handlers.set(event, handlers);
  }
}

interface PendingInstance {
  readonly instance: FakeInstance;
  readonly result: Deferred<PixiInstanceLike>;
}

class FakeSound implements PixiSoundLike {
  readonly instances: FakeInstance[] = [];
  readonly pending: PendingInstance[] = [];
  readonly isLoaded = true;
  readonly isPlayable = true;
  readonly duration = 8;
  volume = 1;
  speed = 1;
  loop = true;
  private nextId = 1;

  get isPlaying(): boolean {
    return this.instances.some((instance) => !instance.stopped);
  }

  play(options: { volume?: number; speed?: number; loop?: boolean } = {}): Promise<PixiInstanceLike> {
    const instance = new FakeInstance(this.nextId++, options, (ended) => {
      const index = this.instances.indexOf(ended);
      if (index >= 0) this.instances.splice(index, 1);
    });
    const result = deferred<PixiInstanceLike>();
    this.instances.push(instance);
    this.pending.push({ instance, result });
    return result.promise;
  }

  resolveNext(): FakeInstance {
    const next = this.pending.shift();
    if (next === undefined) throw new Error('No pending ambient play to resolve');
    next.result.resolve(next.instance);
    return next.instance;
  }

  stop(): void {
    for (const instance of [...this.instances]) instance.stop();
  }

  destroy(): void {
    this.stop();
  }
}

class FakeLibrary {
  readonly context = {};
  readonly sounds = new Map<string, FakeSound>();
  filtersAll: [] = [];
  supported = false;
  disableAutoPause = false;
  volumeAll = 1;

  add(alias: string, options: PixiSoundOptions): FakeSound {
    const sound = new FakeSound();
    this.sounds.set(alias, sound);
    options.loaded?.(null, sound);
    return sound;
  }

  exists(alias: string): boolean {
    return this.sounds.has(alias);
  }

  find(alias: string): FakeSound {
    const sound = this.sounds.get(alias);
    if (sound === undefined) throw new Error(`Unknown fake sound ${alias}`);
    return sound;
  }

  remove(alias: string): void {
    this.sounds.get(alias)?.destroy();
    this.sounds.delete(alias);
  }

  removeAll(): void {
    for (const sound of this.sounds.values()) sound.destroy();
    this.sounds.clear();
  }

  muteAll(): void {}
  unmuteAll(): void {}
  pauseAll(): void {}
  resumeAll(): void {}
  close(): void {}
  init(): void {}
}

const flushMicrotasks = async (turns = 8): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

describe('ambient latest-intent lifecycle', () => {
  let library: FakeLibrary;

  beforeEach(() => {
    vi.useFakeTimers();
    resetEngineForTests();
    library = new FakeLibrary();
    setPixiSoundLoader(async () => ({
      sound: library as unknown as PixiSoundLibraryLike,
    }));
  });

  afterEach(() => {
    resetEngineForTests();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps only the final soundscape when play promises resolve out of order', async () => {
    const rainStart = startAmbient();
    await flushMicrotasks();
    const rainSound = library.find('ambient-rain');
    const rain = rainSound.resolveNext();
    await rainStart;
    expect(getEngineState()).toMatchObject({
      ambientPlaying: 'ambient-rain',
      ambientActive: 1,
      ambientWanted: true,
    });

    setSoundscape('storm');
    await flushMicrotasks();
    const stormSound = library.find('ambient-storm');
    setSoundscape('fireplace');
    await flushMicrotasks();
    const fireSound = library.find('ambient-fireplace');
    setSoundscape('cafe');
    await flushMicrotasks();
    const cafeSound = library.find('ambient-cafe');

    // Deliberately finish the obsolete requests first and in the wrong order.
    const fire = fireSound.resolveNext();
    await flushMicrotasks();
    const storm = stormSound.resolveNext();
    await flushMicrotasks();
    expect(fire.stopped).toBe(true);
    expect(storm.stopped).toBe(true);
    expect(getEngineState().ambientPlaying).toBeNull();

    const cafe = cafeSound.resolveNext();
    await flushMicrotasks();
    expect(getEngineState()).toMatchObject({
      soundscape: 'cafe',
      ambientPlaying: 'ambient-cafe',
      ambientActive: 2,
    });

    // The intended 600 ms crossfade may overlap the old and selected bed,
    // but it settles to exactly one rather than retaining every prior pick.
    await vi.advanceTimersByTimeAsync(650);
    expect(rain.stopped).toBe(true);
    expect(cafe.stopped).toBe(false);
    expect(getEngineState()).toMatchObject({
      ambientPlaying: 'ambient-cafe',
      ambientActive: 1,
    });
  });

  it('turning ambience off wins over a play instance which arrives later', async () => {
    const start = startAmbient();
    await flushMicrotasks();
    const rainSound = library.find('ambient-rain');
    const pending = rainSound.pending[0]?.instance;
    expect(pending).toBeDefined();

    stopAmbient();
    expect(getEngineState()).toMatchObject({
      ambientWanted: false,
      ambientPlaying: null,
      ambientActive: 0,
    });

    const late = rainSound.resolveNext();
    await start;
    expect(late.stopped).toBe(true);
    expect(late.volume).toBe(0);
    expect(getEngineState()).toMatchObject({
      ambientWanted: false,
      ambientPlaying: null,
      ambientActive: 0,
    });
  });

  it('does not turn deliberate rapid picks into a long multi-bed crossfade', async () => {
    const rainStart = startAmbient();
    await flushMicrotasks();
    const rain = library.find('ambient-rain').resolveNext();
    await rainStart;
    await vi.advanceTimersByTimeAsync(650);

    const picks = [
      ['storm', 'ambient-storm'],
      ['fireplace', 'ambient-fireplace'],
      ['crickets', 'ambient-crickets'],
      ['cafe', 'ambient-cafe'],
    ] as const;
    let previous = rain;
    for (const [scape, cue] of picks) {
      setSoundscape(scape);
      await flushMicrotasks();
      const selected = library.find(cue).resolveNext();
      await flushMicrotasks();
      expect(getEngineState().ambientActive).toBe(2);

      // The superseded bed gets a 32 ms de-click, not another 600 ms lease.
      await vi.advanceTimersByTimeAsync(40);
      expect(previous.stopped).toBe(true);
      expect(selected.stopped).toBe(false);
      expect(getEngineState()).toMatchObject({
        ambientPlaying: cue,
        ambientActive: 1,
      });
      previous = selected;
    }
  });

  it('off stops both halves of an in-progress crossfade', async () => {
    const rainStart = startAmbient();
    await flushMicrotasks();
    const rain = library.find('ambient-rain').resolveNext();
    await rainStart;

    setSoundscape('forest');
    await flushMicrotasks();
    const forest = library.find('ambient-forest').resolveNext();
    await flushMicrotasks();
    expect(getEngineState().ambientActive).toBe(2);

    stopAmbient();
    await vi.advanceTimersByTimeAsync(40);
    expect(rain.stopped).toBe(true);
    expect(forest.stopped).toBe(true);
    expect(getEngineState()).toMatchObject({
      ambientWanted: false,
      ambientPlaying: null,
      ambientActive: 0,
    });
  });

  it('pauses a wanted bed in the tray and resumes it when the window returns', async () => {
    const start = startAmbient();
    await flushMicrotasks();
    const first = library.find('ambient-rain').resolveNext();
    await start;
    await vi.advanceTimersByTimeAsync(650);

    setAppHiddenInTray(true);
    expect(getEngineState()).toMatchObject({
      ambientWanted: true,
      appHiddenInTray: true,
      playAmbienceInTray: false,
      ambientPlaying: null,
    });
    await vi.advanceTimersByTimeAsync(220);
    expect(first.stopped).toBe(true);
    expect(getEngineState().ambientActive).toBe(0);

    setAppHiddenInTray(false);
    await flushMicrotasks();
    const resumed = library.find('ambient-rain').resolveNext();
    await flushMicrotasks();
    expect(resumed.stopped).toBe(false);
    expect(getEngineState()).toMatchObject({
      ambientWanted: true,
      appHiddenInTray: false,
      ambientPlaying: 'ambient-rain',
      ambientActive: 1,
    });
  });

  it('keeps ambience alive in the tray only after the reader opts in', async () => {
    setPlayAmbienceInTray(true);
    const start = startAmbient();
    await flushMicrotasks();
    const rain = library.find('ambient-rain').resolveNext();
    await start;
    await vi.advanceTimersByTimeAsync(650);

    setAppHiddenInTray(true);
    await vi.advanceTimersByTimeAsync(220);
    expect(rain.stopped).toBe(false);
    expect(getEngineState()).toMatchObject({
      ambientWanted: true,
      appHiddenInTray: true,
      playAmbienceInTray: true,
      ambientPlaying: 'ambient-rain',
      ambientActive: 1,
    });
  });
});
