// @vitest-environment node
/**
 * tests/sound.test.ts — verifies the generated sound files (format, duration,
 * headroom, loop continuity) and the playback engine's routing/rotation logic
 * against a stub Howler injected through the engine's loader seam.
 *
 * Regenerate fixtures with: node scripts/gen-sounds.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  PAGE_FLIP_VARIANTS,
  SOUNDSCAPE_LOOPS,
  SOUND_MANIFEST,
  SOUND_NAMES,
  TYPING_TICK_VARIANTS,
  chimeTick,
  createVariantPicker,
  getEngineState,
  getSoundscape,
  getVolumes,
  init,
  keystroke,
  muteAll,
  play,
  resetEngineForTests,
  setChimeDepsForTests,
  setHourlyChime,
  setHowlerLoader,
  setReducedSound,
  setSoundscape,
  setTypingRngForTests,
  setTypingSounds,
  setVolumes,
  startAmbient,
  stopAmbient,
  type HowlLike,
  type HowlOptions,
  type SoundName,
} from '../src/sound/engine';

const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');

/* ────────────────────────────── WAV parsing ─────────────────────────────── */

interface ParsedWav {
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
  samples: Int16Array;
  durationMs: number;
  peakDb: number;
}

/** Minimal RIFF walker: finds fmt/data chunks, decodes 16-bit PCM. */
function parseWav(path: string): ParsedWav {
  const raw = readFileSync(path);
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const view = new DataView(buf);
  const tag = (off: number) => String.fromCharCode(...new Uint8Array(buf, off, 4));

  expect(tag(0)).toBe('RIFF');
  expect(tag(8)).toBe('WAVE');
  expect(view.getUint32(4, true)).toBe(raw.byteLength - 8);

  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | undefined;
  let data: Int16Array | undefined;
  let off = 12;
  while (off + 8 <= raw.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(off + 8, true),
        channels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        bits: view.getUint16(off + 22, true),
      };
    } else if (id === 'data') {
      data = new Int16Array(buf, off + 8, size / 2);
    }
    off += 8 + size + (size % 2);
  }

  if (!fmt || !data) throw new Error(`missing fmt/data chunk in ${path}`);
  expect(fmt.format).toBe(1); // linear PCM

  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i] as number) / 32768;
    if (v > peak) peak = v;
  }
  return {
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bits,
    channels: fmt.channels,
    samples: data,
    durationMs: (data.length / fmt.sampleRate) * 1000,
    peakDb: 20 * Math.log10(Math.max(peak, 1e-9)),
  };
}

function rmsDb(samples: Int16Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    const v = (samples[i] as number) / 32768;
    sum += v * v;
  }
  return 20 * Math.log10(Math.max(Math.sqrt(sum / (to - from)), 1e-9));
}

/* ───────────────────────────── generated files ──────────────────────────── */

/** Expected duration windows (ms) per sound. */
const DURATION_BOUNDS: Record<SoundName, readonly [number, number]> = {
  'page-flip-1': [80, 160],
  'page-flip-2': [80, 160],
  'page-flip-3': [80, 160],
  'book-pull': [220, 320],
  'book-return': [200, 320],
  'shelf-whoosh': [300, 420],
  'pop-soft': [45, 90],
  'tick-hover': [15, 45],
  'check-done': [150, 400],
  'crumple-delete': [250, 400],
  'drop-thump': [90, 180],
  'pencil-scratch': [180, 240],
  confetti: [340, 520],
  'ambient-library': [7990, 8010],
  'ambient-rain': [7990, 8010],
  'ambient-fireplace': [7990, 8010],
  'ambient-crickets': [7990, 8010],
  'typing-tick-1': [30, 70],
  'typing-tick-2': [25, 70],
  'typing-tick-3': [35, 80],
  'chime-hour': [4000, 5400],
};

describe('generated WAV files', () => {
  const parsed = new Map<SoundName, ParsedWav>();
  const wav = (name: SoundName): ParsedWav => {
    let p = parsed.get(name);
    if (!p) {
      p = parseWav(join(SOUNDS_DIR, `${name}.wav`));
      parsed.set(name, p);
    }
    return p;
  };

  it.each(SOUND_NAMES.map((n) => [n] as const))('%s.wav: 44.1 kHz 16-bit mono, in duration bounds, no clipping', (name) => {
    const w = wav(name);
    expect(w.sampleRate).toBe(44100);
    expect(w.bitsPerSample).toBe(16);
    expect(w.channels).toBe(1);
    const [min, max] = DURATION_BOUNDS[name];
    expect(w.durationMs).toBeGreaterThanOrEqual(min);
    expect(w.durationMs).toBeLessThanOrEqual(max);
    // Mastered to -6 dBFS or below — comfortably clear of clipping.
    expect(w.peakDb).toBeLessThanOrEqual(-5.5);
    expect(w.samples.length).toBeGreaterThan(0);
  });

  it('quiet-by-design sounds actually sit far below the pack', () => {
    expect(wav('shelf-whoosh').peakDb).toBeLessThanOrEqual(-15);
    expect(wav('tick-hover').peakDb).toBeLessThanOrEqual(-20);
    expect(wav('ambient-library').peakDb).toBeLessThanOrEqual(-12);
    expect(wav('ambient-rain').peakDb).toBeLessThanOrEqual(-12);
    expect(wav('ambient-fireplace').peakDb).toBeLessThanOrEqual(-12);
    expect(wav('ambient-crickets').peakDb).toBeLessThanOrEqual(-12);
    for (const tick of TYPING_TICK_VARIANTS) {
      expect(wav(tick).peakDb).toBeLessThanOrEqual(-15);
    }
    expect(wav('chime-hour').peakDb).toBeLessThanOrEqual(-11);
  });

  it('edges are faded (no clicks at start or end)', () => {
    for (const name of SOUND_NAMES) {
      const s = wav(name).samples;
      // First and last samples must be at/near zero after the >=5 ms fades.
      expect(Math.abs(s[0] as number)).toBeLessThan(330); // < ~1% FS
      expect(Math.abs(s[s.length - 1] as number)).toBeLessThan(330);
    }
  });

  it('ambient-library loops seamlessly: head/tail RMS continuity within 3 dB', () => {
    const w = wav('ambient-library');
    const win = Math.round(0.4 * w.sampleRate); // 400 ms windows
    const head = rmsDb(w.samples, 0, win);
    const tail = rmsDb(w.samples, w.samples.length - win, w.samples.length);
    expect(Math.abs(head - tail)).toBeLessThanOrEqual(3);
  });

  it.each([['ambient-rain'], ['ambient-fireplace'], ['ambient-crickets']] as const)(
    '%s loops seamlessly: head/tail RMS continuity within 6 dB',
    (name) => {
      // Event-based textures (droplets, crackles, chirps) vary more per window
      // than the library room tone — 1 s windows, 6 dB tolerance.
      const w = wav(name);
      const win = w.sampleRate; // 1 s windows
      const head = rmsDb(w.samples, 0, win);
      const tail = rmsDb(w.samples, w.samples.length - win, w.samples.length);
      expect(Math.abs(head - tail)).toBeLessThanOrEqual(6);
    },
  );

  it('ambient loops keep continuous energy — no silent stretch mid-loop', () => {
    for (const name of ['ambient-rain', 'ambient-fireplace', 'ambient-crickets'] as const) {
      const w = wav(name);
      const win = w.sampleRate; // 1 s windows across the whole loop
      for (let from = 0; from + win <= w.samples.length; from += win) {
        expect(rmsDb(w.samples, from, from + win), `${name} @ ${from / w.sampleRate}s`).toBeGreaterThan(-60);
      }
    }
  });

  it('chime-hour decays into silence (a bell, not a drone)', () => {
    const w = wav('chime-hour');
    const win = Math.round(0.3 * w.sampleRate);
    const early = rmsDb(w.samples, 0, win);
    const late = rmsDb(w.samples, w.samples.length - win, w.samples.length);
    expect(early - late).toBeGreaterThan(20); // long natural decay
  });

  it('pencil-scratch loop keeps continuous energy across the seam', () => {
    const w = wav('pencil-scratch');
    const win = Math.round(0.05 * w.sampleRate);
    const head = rmsDb(w.samples, 0, win);
    const tail = rmsDb(w.samples, w.samples.length - win, w.samples.length);
    expect(Math.abs(head - tail)).toBeLessThanOrEqual(4.5);
  });
});

/* ─────────────────────────── variant rotation ───────────────────────────── */

describe('createVariantPicker', () => {
  it('never repeats the previous pick and covers every variant', () => {
    let n = 0;
    const rng = () => {
      n = (n * 16807 + 12345) % 2147483647;
      return (n % 1000) / 1000;
    };
    const pick = createVariantPicker(['a', 'b', 'c'] as const, rng);
    const seen = new Set<string>();
    let prev: string | undefined;
    for (let i = 0; i < 300; i++) {
      const v = pick();
      expect(['a', 'b', 'c']).toContain(v);
      expect(v).not.toBe(prev);
      seen.add(v);
      prev = v;
    }
    expect(seen.size).toBe(3);
  });

  it('handles the single-variant edge case', () => {
    const pick = createVariantPicker(['only'] as const);
    expect(pick()).toBe('only');
    expect(pick()).toBe('only');
  });

  it('rejects an empty variant list', () => {
    expect(() => createVariantPicker([])).toThrow();
  });
});

/* ─────────────────────────── engine + stub Howler ───────────────────────── */

class StubHowl implements HowlLike {
  static instances: StubHowl[] = [];
  static playLog: string[] = []; // src of each play() in order

  readonly options: HowlOptions;
  nextId = 0;
  live = new Set<number>();
  volumes = new Map<number, number>();
  rates = new Map<number, number>();
  fades: { from: number; to: number; duration: number; id: number | undefined }[] = [];
  onceHandlers: { event: string; fn: () => void; id: number | undefined }[] = [];

  constructor(options: HowlOptions) {
    this.options = options;
    StubHowl.instances.push(this);
  }
  get src(): string {
    return this.options.src[0] as string;
  }
  play(): number {
    const id = ++this.nextId;
    this.live.add(id);
    StubHowl.playLog.push(this.src);
    return id;
  }
  stop(id?: number): void {
    if (id === undefined) this.live.clear();
    else this.live.delete(id);
  }
  playing(id?: number): boolean {
    return id === undefined ? this.live.size > 0 : this.live.has(id);
  }
  volume(vol: number, id?: number): void {
    this.volumes.set(id ?? -1, vol);
  }
  rate(rate: number, id?: number): void {
    this.rates.set(id ?? -1, rate);
  }
  fade(from: number, to: number, duration: number, id?: number): void {
    this.fades.push({ from, to, duration, id });
    this.volumes.set(id ?? -1, to);
  }
  once(event: string, fn: () => void, id?: number): void {
    this.onceHandlers.push({ event, fn, id });
  }
  unload(): void {
    this.live.clear();
  }
  /** Deliver a queued once-event (e.g. the end of a fade). */
  emit(event: string): void {
    const pending = this.onceHandlers.filter((h) => h.event === event);
    this.onceHandlers = this.onceHandlers.filter((h) => h.event !== event);
    for (const h of pending) h.fn();
  }
}

const findStub = (name: SoundName): StubHowl | undefined =>
  StubHowl.instances.find((h) => h.src === `/sounds/${name}.wav`);

describe('sound engine (stub Howler)', () => {
  beforeEach(() => {
    resetEngineForTests();
    StubHowl.instances = [];
    StubHowl.playLog = [];
    setHowlerLoader(async () => ({ Howl: StubHowl as unknown as new (o: HowlOptions) => HowlLike }));
  });

  it('is lazy: no Howl instances exist before the first play', async () => {
    expect(StubHowl.instances).toHaveLength(0);
    await play('pop-soft');
    expect(StubHowl.instances).toHaveLength(1);
    expect(StubHowl.instances[0]?.src).toBe('/sounds/pop-soft.wav');
  });

  it('init() preloads all 21 sounds with correct src and loop flags', async () => {
    await init();
    expect(StubHowl.instances).toHaveLength(SOUND_NAMES.length);
    for (const name of SOUND_NAMES) {
      const stub = findStub(name);
      expect(stub, name).toBeDefined();
      expect(stub?.options.loop).toBe(SOUND_MANIFEST[name].loop);
      expect(stub?.options.preload).toBe(true);
    }
    // Re-init reuses cached instances.
    await init();
    expect(StubHowl.instances).toHaveLength(SOUND_NAMES.length);
  });

  it('routes volume: request x category x master', async () => {
    setVolumes({ master: 0.5, ui: 0.5 });
    const id = await play('pop-soft', { volume: 0.8 });
    expect(id).toBeDefined();
    const stub = findStub('pop-soft');
    expect(stub?.volumes.get(id as number)).toBeCloseTo(0.8 * 0.5 * 0.5, 10);
  });

  it('applies category gains per manifest and clamps volumes to 0..1', async () => {
    setVolumes({ master: 1, pages: 0.6, shelf: 7 as number, ambient: -2 as number });
    expect(getVolumes().shelf).toBe(1);
    expect(getVolumes().ambient).toBe(0);
    const flipId = await play('page-flip-1');
    expect(findStub('page-flip-1')?.volumes.get(flipId as number)).toBeCloseTo(0.6, 10);
    const thumpId = await play('drop-thump');
    expect(findStub('drop-thump')?.volumes.get(thumpId as number)).toBeCloseTo(1, 10);
  });

  it('forwards the rate option to the played id', async () => {
    const id = await play('check-done', { rate: 1.1 });
    expect(findStub('check-done')?.rates.get(id as number)).toBe(1.1);
  });

  it('page-flip picks variants with no immediate repeats', async () => {
    for (let i = 0; i < 60; i++) await play('page-flip');
    expect(StubHowl.playLog).toHaveLength(60);
    const variantSrcs = new Set(PAGE_FLIP_VARIANTS.map((v) => `/sounds/${v}.wav`));
    for (const src of StubHowl.playLog) expect(variantSrcs.has(src)).toBe(true);
    for (let i = 1; i < StubHowl.playLog.length; i++) {
      expect(StubHowl.playLog[i]).not.toBe(StubHowl.playLog[i - 1]);
    }
    expect(new Set(StubHowl.playLog).size).toBe(3);
  });

  it('reducedSound skips tick-hover and pencil-scratch entirely (not even loaded)', async () => {
    setReducedSound(true);
    expect(await play('tick-hover')).toBeUndefined();
    expect(await play('pencil-scratch')).toBeUndefined();
    expect(findStub('tick-hover')).toBeUndefined();
    expect(findStub('pencil-scratch')).toBeUndefined();
    // Other sounds still play.
    expect(await play('pop-soft')).toBeDefined();
    setReducedSound(false);
    expect(await play('tick-hover')).toBeDefined();
  });

  it('muteAll blocks playback and unmute restores it', async () => {
    muteAll(true);
    expect(await play('pop-soft')).toBeUndefined();
    expect(StubHowl.playLog).toHaveLength(0);
    muteAll(false);
    expect(await play('pop-soft')).toBeDefined();
  });

  it('ambient loop starts with a 600 ms fade-in at the ambient gain', async () => {
    setVolumes({ master: 0.5, ambient: 0.4 });
    await startAmbient();
    const stub = findStub('ambient-library');
    expect(stub).toBeDefined();
    expect(stub?.options.loop).toBe(true);
    expect(stub?.fades).toHaveLength(1);
    expect(stub?.fades[0]).toMatchObject({ from: 0, duration: 600 });
    expect(stub?.fades[0]?.to).toBeCloseTo(0.4 * 0.5, 10);
    // Idempotent while already playing.
    await startAmbient();
    expect(stub?.fades).toHaveLength(1);
  });

  it('ambient stop fades out over 600 ms, then stops on fade completion', async () => {
    await startAmbient();
    const stub = findStub('ambient-library') as StubHowl;
    const id = stub.fades[0]?.id as number;
    expect(stub.playing(id)).toBe(true);
    stopAmbient();
    expect(stub.fades).toHaveLength(2);
    expect(stub.fades[1]).toMatchObject({ to: 0, duration: 600 });
    stub.emit('fade');
    expect(stub.playing(id)).toBe(false);
  });

  it('muteAll fades the ambient bed out and unmute resumes it', async () => {
    await startAmbient();
    const stub = findStub('ambient-library') as StubHowl;
    muteAll(true);
    const muteFade = stub.fades[stub.fades.length - 1];
    expect(muteFade?.to).toBe(0);
    stub.emit('fade');
    expect(stub.live.size).toBe(0);
    muteAll(false); // ambient was wanted -> restarts
    await Promise.resolve();
    expect(stub.live.size).toBe(1);
  });

  it('setVolumes live-updates the running ambient bed', async () => {
    await startAmbient();
    const stub = findStub('ambient-library') as StubHowl;
    const id = stub.fades[0]?.id as number;
    setVolumes({ ambient: 0.1, master: 1 });
    expect(stub.volumes.get(id)).toBeCloseTo(0.1, 10);
  });

  it("play('ambient-library') delegates to the fading ambient loop", async () => {
    const id = await play('ambient-library');
    const stub = findStub('ambient-library') as StubHowl;
    expect(id).toBeDefined();
    expect(stub.fades).toHaveLength(1); // faded in, not raw-played
  });
});

/* ───────────────────────────── soundscape picker ────────────────────────── */

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('soundscape picker (stub Howler)', () => {
  beforeEach(() => {
    resetEngineForTests();
    StubHowl.instances = [];
    StubHowl.playLog = [];
    setHowlerLoader(async () => ({ Howl: StubHowl as unknown as new (o: HowlOptions) => HowlLike }));
  });

  it('every soundscape maps to a looping ambient manifest entry', () => {
    for (const loop of Object.values(SOUNDSCAPE_LOOPS)) {
      expect(SOUND_MANIFEST[loop]).toEqual({ category: 'ambient', loop: true });
    }
  });

  it('startAmbient honors the selected soundscape', async () => {
    setSoundscape('fireplace');
    await startAmbient();
    expect(findStub('ambient-fireplace')?.fades[0]).toMatchObject({ from: 0, duration: 600 });
    expect(findStub('ambient-library')).toBeUndefined();
    expect(getEngineState().ambientPlaying).toBe('ambient-fireplace');
  });

  it('switching soundscapes crossfades: old bed out, new bed in', async () => {
    await startAmbient(); // default 'library'
    const lib = findStub('ambient-library') as StubHowl;
    const libId = lib.fades[0]?.id as number;
    setSoundscape('rain');
    await flush();
    const rain = findStub('ambient-rain') as StubHowl;
    // Old bed fading to silence and stopped once the fade lands.
    expect(lib.fades[lib.fades.length - 1]).toMatchObject({ to: 0, duration: 600 });
    lib.emit('fade');
    expect(lib.playing(libId)).toBe(false);
    // New bed fading in at the ambient gain.
    expect(rain.fades[0]).toMatchObject({ from: 0, duration: 600 });
    expect(getEngineState()).toMatchObject({ soundscape: 'rain', ambientPlaying: 'ambient-rain' });
  });

  it("setSoundscape('none') stops the bed; re-selecting a scape resumes it", async () => {
    await startAmbient();
    const lib = findStub('ambient-library') as StubHowl;
    setSoundscape('none');
    expect(lib.fades[lib.fades.length - 1]).toMatchObject({ to: 0, duration: 600 });
    expect(getEngineState().ambientPlaying).toBeNull();
    // While 'none', startAmbient stays a silent no-op (but remembers intent).
    await startAmbient();
    expect(getEngineState().ambientPlaying).toBeNull();
    // Picking a soundscape again resumes the wanted bed.
    setSoundscape('crickets');
    await flush();
    expect(findStub('ambient-crickets')?.fades[0]).toMatchObject({ from: 0, duration: 600 });
    expect(getEngineState().ambientPlaying).toBe('ambient-crickets');
  });

  it('selecting a soundscape while the bed is not wanted starts nothing', async () => {
    setSoundscape('rain');
    await flush();
    expect(StubHowl.playLog).toHaveLength(0);
    expect(getSoundscape()).toBe('rain');
    expect(getEngineState().ambientPlaying).toBeNull();
  });

  it('ambient volume changes live-apply to whichever bed is running', async () => {
    setSoundscape('rain');
    await startAmbient();
    const rain = findStub('ambient-rain') as StubHowl;
    const id = rain.fades[0]?.id as number;
    setVolumes({ ambient: 0.2, master: 1 });
    expect(rain.volumes.get(id)).toBeCloseTo(0.2, 10);
  });

  it("play('ambient-rain') switches the soundscape and starts that bed", async () => {
    await play('ambient-rain');
    expect(getSoundscape()).toBe('rain');
    expect(findStub('ambient-rain')?.fades).toHaveLength(1);
  });
});

/* ─────────────────────────────── typing sounds ──────────────────────────── */

describe('typing sounds (stub Howler)', () => {
  beforeEach(() => {
    resetEngineForTests();
    StubHowl.instances = [];
    StubHowl.playLog = [];
    setHowlerLoader(async () => ({ Howl: StubHowl as unknown as new (o: HowlOptions) => HowlLike }));
  });

  const tickSrcs = new Set(TYPING_TICK_VARIANTS.map((v) => `/sounds/${v}.wav`));

  it('plays nothing until typing sounds are enabled', async () => {
    keystroke(0);
    await flush();
    expect(StubHowl.playLog).toHaveLength(0);
    setTypingSounds(true);
    keystroke(1000);
    await flush();
    expect(StubHowl.playLog).toHaveLength(1);
    expect(tickSrcs.has(StubHowl.playLog[0] as string)).toBe(true);
  });

  it('rate-limits to 12 ticks/s', async () => {
    setTypingSounds(true);
    // 40 keystrokes hammered 10 ms apart = 400 ms of furious typing.
    for (let i = 0; i < 40; i++) keystroke(i * 10);
    await flush();
    // ceil(400 / 83.3) -> at most 5-6 ticks may land in that window.
    expect(StubHowl.playLog.length).toBeLessThanOrEqual(6);
    expect(StubHowl.playLog.length).toBeGreaterThanOrEqual(4);
    // Slow typing (100 ms apart) is under the limit — every stroke ticks.
    StubHowl.playLog = [];
    for (let i = 0; i < 5; i++) keystroke(10_000 + i * 100);
    await flush();
    expect(StubHowl.playLog).toHaveLength(5);
  });

  it('varies velocity (volume) and rate within gentle bounds', async () => {
    setTypingSounds(true);
    setVolumes({ master: 1, pages: 1 });
    const rolls = [0, 0.5, 0.999, 0.25, 0.75, 0.1];
    let i = 0;
    setTypingRngForTests(() => rolls[i++ % rolls.length] as number);
    keystroke(0);
    keystroke(1000);
    keystroke(2000);
    await flush();
    for (const stub of StubHowl.instances) {
      for (const [, vol] of stub.volumes) {
        expect(vol).toBeGreaterThanOrEqual(0.45);
        expect(vol).toBeLessThanOrEqual(1);
      }
      for (const [, rate] of stub.rates) {
        expect(rate).toBeGreaterThanOrEqual(0.94);
        expect(rate).toBeLessThanOrEqual(1.06);
      }
    }
    // Velocity actually varies across strokes.
    const vols = StubHowl.instances.flatMap((s) => [...s.volumes.values()]);
    expect(new Set(vols.map((v) => v.toFixed(4))).size).toBeGreaterThan(1);
  });

  it('rotates tick variants with no immediate repeats', async () => {
    setTypingSounds(true);
    // Pre-warm the cache so every play() resolves in call order — first-time
    // Howl creation has a deeper microtask chain and would shuffle the log.
    await init();
    for (let i = 0; i < 30; i++) keystroke(i * 1000);
    await flush();
    expect(StubHowl.playLog).toHaveLength(30);
    for (const src of StubHowl.playLog) expect(tickSrcs.has(src)).toBe(true);
    for (let i = 1; i < StubHowl.playLog.length; i++) {
      expect(StubHowl.playLog[i]).not.toBe(StubHowl.playLog[i - 1]);
    }
  });

  it('muted and reduced-sound both silence typing ticks', async () => {
    setTypingSounds(true);
    muteAll(true);
    keystroke(0);
    muteAll(false);
    setReducedSound(true);
    keystroke(1000);
    await flush();
    expect(StubHowl.playLog).toHaveLength(0);
  });
});

/* ─────────────────────────────── hourly chime ───────────────────────────── */

describe('hourly chime (stub Howler)', () => {
  let nowMs = 0;
  let focused = true;

  const at = (h: number, m: number, s = 0): number =>
    new Date(2026, 6, 30, h, m, s).getTime();

  beforeEach(() => {
    resetEngineForTests();
    StubHowl.instances = [];
    StubHowl.playLog = [];
    setHowlerLoader(async () => ({ Howl: StubHowl as unknown as new (o: HowlOptions) => HowlLike }));
    focused = true;
    nowMs = at(9, 40);
    setChimeDepsForTests({ now: () => nowMs, hasFocus: () => focused });
  });

  const chimes = (): number =>
    StubHowl.playLog.filter((src) => src === '/sounds/chime-hour.wav').length;

  it('rings once at the top of the hour, focused, past the launch grace', async () => {
    setHourlyChime(true);
    chimeTick(); // still 9:40 — nothing
    nowMs = at(10, 0, 15); // launch was 9:40 -> 20 min uptime
    chimeTick();
    await flush();
    expect(chimes()).toBe(1);
    // Later polls in the same hour never double-ring.
    nowMs = at(10, 30);
    chimeTick();
    await flush();
    expect(chimes()).toBe(1);
    expect(getEngineState().hourlyChime).toBe(true);
  });

  it('never rings within 10 minutes of launch (skipped, not deferred)', async () => {
    nowMs = at(9, 55);
    setChimeDepsForTests({ now: () => nowMs, hasFocus: () => focused }); // launch 9:55
    setHourlyChime(true);
    nowMs = at(10, 0, 30); // boundary at 5.5 min uptime -> skip
    chimeTick();
    nowMs = at(10, 20); // grace has passed, but the 10:00 chime is gone
    chimeTick();
    await flush();
    expect(chimes()).toBe(0);
    nowMs = at(11, 0, 10); // the next boundary rings normally
    chimeTick();
    await flush();
    expect(chimes()).toBe(1);
  });

  it('skips while the app is unfocused or muted', async () => {
    setHourlyChime(true);
    focused = false;
    nowMs = at(10, 0, 10);
    chimeTick();
    await flush();
    expect(chimes()).toBe(0);
    focused = true;
    muteAll(true);
    nowMs = at(11, 0, 10);
    chimeTick();
    await flush();
    expect(chimes()).toBe(0);
    muteAll(false);
    nowMs = at(12, 0, 10);
    chimeTick();
    await flush();
    expect(chimes()).toBe(1);
  });

  it('enabling mid-hour arms on the current hour (no instant ring)', async () => {
    nowMs = at(14, 59, 50);
    setChimeDepsForTests({ now: () => nowMs, hasFocus: () => focused });
    nowMs = at(15, 30); // well past a boundary before enabling
    setHourlyChime(true);
    chimeTick();
    await flush();
    expect(chimes()).toBe(0);
  });

  it('disabling stops future chimes', async () => {
    setHourlyChime(true);
    setHourlyChime(false);
    nowMs = at(10, 0, 10);
    chimeTick();
    await flush();
    expect(chimes()).toBe(0);
    expect(getEngineState().hourlyChime).toBe(false);
  });
});
