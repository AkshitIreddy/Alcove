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
  SOUND_MANIFEST,
  SOUND_NAMES,
  createVariantPicker,
  getVolumes,
  init,
  muteAll,
  play,
  resetEngineForTests,
  setHowlerLoader,
  setReducedSound,
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

  it('init() preloads all 14 sounds with correct src and loop flags', async () => {
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
