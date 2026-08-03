// @vitest-environment node
/**
 * tests/sound.test.ts — verifies the generated sound files and the playback
 * engine's routing / rotation / character logic.
 *
 * The file assertions are the acceptance criteria for the sound redesign.
 * The old set was reviewed as "very rough low quality"; these tests encode
 * what was actually wrong with it, measured:
 *
 *   WARMTH      spectral centroid. The old page turns measured 5428 Hz with
 *               43% of their energy above 4 kHz — that is the harshness.
 *               Every one-shot now has to come in under 2 kHz and 3%.
 *   SMOOTHNESS  the largest sample-to-sample step, as a share of peak. The
 *               old page-flip-2 jumped 78% of full scale between adjacent
 *               samples; the old pencil loop 63%. That is what a click IS.
 *               Everything now has to stay under 25%.
 *   ONSET       the first half-millisecond must be under 4% of peak, so no
 *               sound can snap open.
 *   VARIETY     every family must ship several genuinely different takes.
 *
 * Regenerate fixtures with: node scripts/gen-sounds.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CHARACTER_PROFILES,
  PAGE_FLIP_VARIANTS,
  SOUNDSCAPE_LOOPS,
  SOUND_CHARACTERS,
  SOUND_FAMILIES,
  SOUND_MANIFEST,
  SOUND_NAMES,
  TYPING_TICK_VARIANTS,
  VARIANT_WEIGHTS,
  chimeTick,
  createVariantPicker,
  getEngineState,
  getSoundCharacter,
  getSoundscape,
  getVolumes,
  init,
  keystroke,
  muteAll,
  play,
  poolFor,
  resetEngineForTests,
  setChimeDepsForTests,
  setHourlyChime,
  setHowlerLoader,
  setPlayRngForTests,
  setReducedSound,
  setSoundCharacter,
  setSoundscape,
  setTypingRngForTests,
  setTypingSounds,
  setVolumes,
  startAmbient,
  stopAmbient,
  type FamilyName,
  type HowlLike,
  type HowlOptions,
  msSinceVoicedPlay,
  type SoundName,
} from '../src/sound/engine';
import { resolveVoice } from '../src/sound/soundSets';
import {
  SILENT_ATTR,
  isSoundedButton,
  shouldClick,
} from '../src/sound/uiClicks';
import {
  groupCredits,
  shortLicence,
  summariseCues,
  type CreditsManifest,
} from '../src/sound/credits';

const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');

/** Every ambient bed, derived from the engine so a new soundscape is covered. */
const SOUNDSCAPE_LOOP_NAMES = Object.values(SOUNDSCAPE_LOOPS) as readonly SoundName[];

/* ────────────────────────────── WAV parsing ─────────────────────────────── */

interface ParsedWav {
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
  samples: Int16Array;
  durationMs: number;
  peak: number;
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
    peak,
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

/* ─────────────────────────── spectral analysis ──────────────────────────── */

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number; re[i] = re[j] as number; re[j] = tr;
      const ti = im[i] as number; im[i] = im[j] as number; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k] as number;
        const ui = im[i + k] as number;
        const vr = (re[i + k + len / 2] as number) * cr - (im[i + k + len / 2] as number) * ci;
        const vi = (re[i + k + len / 2] as number) * ci + (im[i + k + len / 2] as number) * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

interface Spectrum {
  /** Amplitude-weighted mean frequency, Hz. Lower = warmer. */
  centroid: number;
  /** Share of energy above 4 kHz, 0..1. Lower = less harsh. */
  highShare: number;
}

function spectrum(w: ParsedWav): Spectrum {
  const N = 2048;
  const s = w.samples;
  let num = 0;
  let den = 0;
  let high = 0;
  let total = 0;
  for (let start = 0; start + N <= s.length; start += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      const v = ((s[start + i] as number) / 32768) * win;
      re[i] = v;
      energy += v * v;
    }
    if (energy < 1e-10) continue; // skip pure silence (the reverb tail's end)
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.hypot(re[k] as number, im[k] as number);
      const f = (k * w.sampleRate) / N;
      num += f * mag;
      den += mag;
      total += mag * mag;
      if (f > 4000) high += mag * mag;
    }
  }
  return {
    centroid: den > 0 ? num / den : 0,
    highShare: total > 0 ? high / total : 0,
  };
}

/** Largest single-sample jump anywhere, as a share of peak. A click's signature. */
function maxStepShare(w: ParsedWav): number {
  const s = w.samples;
  let max = 0;
  for (let i = 1; i < s.length; i++) {
    const d = Math.abs((s[i] as number) - (s[i - 1] as number));
    if (d > max) max = d;
  }
  return max / Math.max(w.peak * 32768, 1);
}

/** Loudest sample inside the first `ms`, as a share of peak. */
function onsetShare(w: ParsedWav, ms: number): number {
  const n = Math.min(w.samples.length, Math.round((ms / 1000) * w.sampleRate));
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(w.samples[i] as number);
    if (v > max) max = v;
  }
  return max / Math.max(w.peak * 32768, 1);
}

/* ───────────────────────────── generated files ──────────────────────────── */

/** Expected duration windows (ms) per sound. */
const DURATION_BOUNDS: Record<SoundName, readonly [number, number]> = {
  'page-flip-1': [280, 440],
  'page-flip-2': [280, 440],
  'page-flip-3': [280, 440],
  'page-flip-4': [280, 440],
  'page-flip-5': [280, 440],
  'page-flip-6': [280, 440],
  'book-pull': [600, 820],
  'book-pull-2': [600, 820],
  'book-pull-3': [600, 820],
  'book-pull-4': [600, 820],
  'book-return': [600, 820],
  'book-return-2': [600, 820],
  'book-return-3': [600, 820],
  'book-return-4': [600, 820],
  'shelf-whoosh': [540, 840],
  'shelf-whoosh-2': [540, 840],
  'shelf-whoosh-3': [540, 840],
  'pop-soft': [280, 420],
  'pop-soft-2': [280, 420],
  'pop-soft-3': [280, 420],
  'pop-soft-4': [280, 420],
  'pop-soft-5': [280, 420],
  'click-soft': [110, 210],
  'click-soft-2': [110, 210],
  'click-soft-3': [110, 210],
  'click-soft-4': [110, 210],
  'tick-hover': [110, 210],
  'tick-hover-2': [110, 210],
  'tick-hover-3': [110, 210],
  'tick-hover-4': [110, 210],
  'tick-hover-5': [110, 210],
  'check-done': [840, 1100],
  'check-done-2': [840, 1100],
  'check-done-3': [840, 1100],
  'check-done-4': [840, 1100],
  'crumple-delete': [660, 920],
  'crumple-delete-2': [660, 920],
  'crumple-delete-3': [660, 920],
  'crumple-delete-4': [660, 920],
  'drop-thump': [480, 680],
  'drop-thump-2': [480, 680],
  'drop-thump-3': [480, 680],
  'drop-thump-4': [480, 680],
  'pencil-scratch': [180, 240],
  confetti: [820, 1140],
  'confetti-2': [820, 1140],
  'confetti-3': [820, 1140],
  'ambient-rain': [7990, 8010],
  'ambient-storm': [7990, 8010],
  'ambient-fireplace': [7990, 8010],
  'ambient-crickets': [7990, 8010],
  'ambient-wind': [7990, 8010],
  'ambient-stream': [7990, 8010],
  'ambient-forest': [7990, 8010],
  'ambient-cafe': [7990, 8010],
  // Twelve seconds, not eight: waves and a two-layer night bed both repeat
  // audibly inside an eight-second window.
  'ambient-shore': [11990, 12010],
  'ambient-night': [11990, 12010],
  'typing-tick-1': [110, 200],
  'typing-tick-2': [110, 200],
  'typing-tick-3': [110, 200],
  'typing-tick-4': [110, 200],
  'typing-tick-5': [110, 200],
  'typing-tick-6': [110, 200],
  'chime-hour': [5400, 6600],
  'chime-hour-2': [5400, 6600],
  'chime-hour-3': [5400, 6600],
};

/**
 * Warmth ceilings. Interaction sounds may carry a little more paper detail
 * than an ambience bed you sit inside for hours, so the beds are stricter.
 * For scale: the OLD set measured 5428 Hz (page-flip-1), 5225 Hz (pencil
 * loop) and 2332 Hz (crumple) — all three fail these thresholds outright.
 */
const CENTROID_MAX_ONESHOT_HZ = 2000;
/**
 * 1650, up from the 1400 that fitted the original four beds. Running water and
 * woodland carry genuine air — pull a stream under 1400 Hz and it stops being
 * water and becomes a hum. The gate that actually catches hiss is
 * HIGH_SHARE_MAX, which every bed clears by an order of magnitude (0.16-0.57%
 * against a 3% ceiling); the per-bed `centroidMax` in gen-sounds.mjs is the
 * tight, individual limit and this is only the outer bound.
 */
const CENTROID_MAX_AMBIENT_HZ = 1650;
/** Share of energy above 4 kHz. The old crickets bed measured 51%. */
const HIGH_SHARE_MAX = 0.03;
/** Largest adjacent-sample jump, as a share of peak. Old worst case: 78%. */
const MAX_STEP_SHARE = 0.25;
/** Loudest sample in the first half-millisecond, as a share of peak. */
const ONSET_SHARE_MAX = 0.04;

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

  it.each(SOUND_NAMES.map((n) => [n] as const))(
    '%s.wav: 44.1 kHz 16-bit mono, in duration bounds, no clipping',
    (name) => {
      const w = wav(name);
      expect(w.sampleRate).toBe(44100);
      expect(w.bitsPerSample).toBe(16);
      expect(w.channels).toBe(1);
      const [min, max] = DURATION_BOUNDS[name];
      expect(w.durationMs).toBeGreaterThanOrEqual(min);
      expect(w.durationMs).toBeLessThanOrEqual(max);
      // Mastered to -8 dBFS or below — the whole set now leaves real headroom.
      expect(w.peakDb).toBeLessThanOrEqual(-7.5);
      expect(w.samples.length).toBeGreaterThan(0);
    },
  );

  it('every declared sound has a file and the manifest covers every file', () => {
    expect(SOUND_NAMES.length).toBe(new Set(SOUND_NAMES).size);
    for (const name of SOUND_NAMES) {
      expect(SOUND_MANIFEST[name], name).toBeDefined();
      expect(VARIANT_WEIGHTS[name], name).toMatch(/^(plain|full)$/);
      expect(() => wav(name)).not.toThrow();
    }
  });

  /* ── warmth ─────────────────────────────────────────────────────────── */

  it.each(SOUND_NAMES.map((n) => [n] as const))(
    '%s.wav is warm: spectral centroid under the ceiling, little energy over 4 kHz',
    (name) => {
      const w = wav(name);
      const { centroid, highShare } = spectrum(w);
      const ceiling = SOUND_MANIFEST[name].category === 'ambient' && SOUND_MANIFEST[name].loop
        ? CENTROID_MAX_AMBIENT_HZ
        : CENTROID_MAX_ONESHOT_HZ;
      expect(centroid, `${name} centroid ${Math.round(centroid)} Hz`).toBeGreaterThan(50);
      expect(centroid, `${name} centroid ${Math.round(centroid)} Hz`).toBeLessThanOrEqual(ceiling);
      expect(highShare, `${name} >4kHz share ${(highShare * 100).toFixed(1)}%`).toBeLessThanOrEqual(
        HIGH_SHARE_MAX,
      );
    },
  );

  it('the papery sounds keep some detail — warm is not the same as muffled', () => {
    // A page turn that measured 300 Hz would be a pillow, not paper.
    for (const name of SOUND_FAMILIES['page-flip']) {
      expect(spectrum(wav(name)).centroid, name).toBeGreaterThan(900);
    }
    expect(spectrum(wav('pencil-scratch')).centroid).toBeGreaterThan(700);
    expect(spectrum(wav('confetti')).centroid).toBeGreaterThan(800);
  });

  /* ── smoothness ─────────────────────────────────────────────────────── */

  it.each(SOUND_NAMES.map((n) => [n] as const))(
    '%s.wav has no sample-level discontinuity and no clicky attack',
    (name) => {
      const w = wav(name);
      const step = maxStepShare(w);
      expect(step, `${name} max adjacent-sample step ${(step * 100).toFixed(1)}% of peak`)
        .toBeLessThanOrEqual(MAX_STEP_SHARE);
      const onset = onsetShare(w, 0.5);
      expect(onset, `${name} first 0.5 ms reaches ${(onset * 100).toFixed(2)}% of peak`)
        .toBeLessThanOrEqual(ONSET_SHARE_MAX);
    },
  );

  it('edges are faded (no clicks at start or end)', () => {
    for (const name of SOUND_NAMES) {
      const s = wav(name).samples;
      // First and last samples must be at/near zero after the fades.
      expect(Math.abs(s[0] as number), name).toBeLessThan(330); // < ~1% FS
      expect(Math.abs(s[s.length - 1] as number), name).toBeLessThan(330);
    }
  });

  /* ── loudness hierarchy ─────────────────────────────────────────────── */

  it('quiet-by-design sounds actually sit far below the pack', () => {
    for (const n of SOUND_FAMILIES['shelf-whoosh']) expect(wav(n).peakDb, n).toBeLessThanOrEqual(-19.5);
    for (const n of SOUND_FAMILIES['tick-hover']) expect(wav(n).peakDb, n).toBeLessThanOrEqual(-25.5);
    // −17.5, relaxed from −19.5: the ticks came up 3 dB after review reported
    // them inaudible. They are still the second-quietest one-shot in the set.
    for (const n of TYPING_TICK_VARIANTS) expect(wav(n).peakDb, n).toBeLessThanOrEqual(-17.5);
    for (const n of SOUNDSCAPE_LOOP_NAMES) {
      expect(wav(n).peakDb, n).toBeLessThanOrEqual(-18.5);
    }
    for (const n of ['ambient-crickets', 'ambient-night', 'ambient-forest', 'ambient-cafe'] as const) {
      expect(wav(n).peakDb, n).toBeLessThanOrEqual(-20.5);
    }
    for (const n of SOUND_FAMILIES['click-soft']) expect(wav(n).peakDb, n).toBeLessThanOrEqual(-18.5);
    for (const n of SOUND_FAMILIES['chime-hour']) expect(wav(n).peakDb, n).toBeLessThanOrEqual(-13.5);
    expect(wav('pencil-scratch').peakDb).toBeLessThanOrEqual(-17.5);
  });

  it('interaction sounds are gentle touches: hover is far under the action sounds', () => {
    // The hover tick must be at least 15 dB below anything you deliberately do.
    const hover = wav('tick-hover').peakDb;
    for (const n of [...SOUND_FAMILIES['book-pull'], ...SOUND_FAMILIES['drop-thump'], ...SOUND_FAMILIES['check-done']]) {
      expect(wav(n).peakDb - hover, n).toBeGreaterThan(15);
    }
    // And every ambience bed sits below the one-shots it plays under.
    for (const n of SOUNDSCAPE_LOOP_NAMES) {
      expect(wav(n).peakDb, n).toBeLessThan(wav('page-flip-1').peakDb - 6);
    }
  });

  it('the button click is a whisper under the panel pop it sits beside', () => {
    // Every button in the app fires click-soft, so it has to be clearly the
    // smaller gesture — but still above the hover tick, which is passive.
    const hover = wav('tick-hover').peakDb;
    for (const n of SOUND_FAMILIES['click-soft']) {
      expect(wav('pop-soft').peakDb - wav(n).peakDb, n).toBeGreaterThanOrEqual(4);
      expect(wav(n).peakDb - hover, n).toBeGreaterThan(4);
    }
  });

  /* ── variety ────────────────────────────────────────────────────────── */

  it('every family ships at least three genuinely different takes', () => {
    for (const [family, variants] of Object.entries(SOUND_FAMILIES) as Array<[FamilyName, readonly SoundName[]]>) {
      expect(variants.length, family).toBeGreaterThanOrEqual(3);
      for (let a = 0; a < variants.length; a++) {
        for (let b = a + 1; b < variants.length; b++) {
          const wa = wav(variants[a] as SoundName);
          const wb = wav(variants[b] as SoundName);
          const label = `${variants[a]} vs ${variants[b]}`;
          // Peak-normalized difference energy: near-copies would sit near 0.
          const n = Math.min(wa.samples.length, wb.samples.length);
          let diff = 0;
          let ref = 0;
          for (let i = 0; i < n; i++) {
            const va = (wa.samples[i] as number) / (wa.peak * 32768);
            const vb = (wb.samples[i] as number) / (wb.peak * 32768);
            diff += (va - vb) * (va - vb);
            ref += va * va + vb * vb;
          }
          expect(Math.sqrt(diff / Math.max(ref, 1e-12)), label).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it('each family spans both variant weights so every character has a pool', () => {
    for (const [family, variants] of Object.entries(SOUND_FAMILIES) as Array<[FamilyName, readonly SoundName[]]>) {
      const weights = new Set(variants.map((v) => VARIANT_WEIGHTS[v]));
      expect(weights, family).toContain('plain');
      expect(weights, family).toContain('full');
    }
  });

  it("the 'full' takes really are the longer ones", () => {
    for (const variants of Object.values(SOUND_FAMILIES) as Array<readonly SoundName[]>) {
      const plain = variants.filter((v) => VARIANT_WEIGHTS[v] === 'plain');
      const full = variants.filter((v) => VARIANT_WEIGHTS[v] === 'full');
      const mean = (list: readonly SoundName[]): number =>
        list.reduce((sum, n) => sum + wav(n).durationMs, 0) / list.length;
      expect(mean(full)).toBeGreaterThan(mean(plain));
    }
  });

  /* ── loops ──────────────────────────────────────────────────────────── */

  it.each(SOUNDSCAPE_LOOP_NAMES.map((n) => [n] as const))(
    '%s loops seamlessly: head/tail RMS continuity within 6 dB',
    (name) => {
      // Every bed is an event-based texture (droplets, crackles, chirps, a
      // wave arriving), so windows vary — 1 s windows, 6 dB tolerance. What
      // this catches is a loop point cut across a swell, where the head comes
      // back an octave louder than the tail it follows.
      const w = wav(name);
      const win = w.sampleRate; // 1 s windows
      const head = rmsDb(w.samples, 0, win);
      const tail = rmsDb(w.samples, w.samples.length - win, w.samples.length);
      expect(Math.abs(head - tail)).toBeLessThanOrEqual(6);
    },
  );

  it('ambient loops keep continuous energy — no silent stretch mid-loop', () => {
    for (const name of SOUNDSCAPE_LOOP_NAMES) {
      const w = wav(name);
      const win = w.sampleRate; // 1 s windows across the whole loop
      for (let from = 0; from + win <= w.samples.length; from += win) {
        expect(rmsDb(w.samples, from, from + win), `${name} @ ${from / w.sampleRate}s`).toBeGreaterThan(-60);
      }
    }
  });

  it('chime-hour decays into silence (a bell, not a drone)', () => {
    for (const name of SOUND_FAMILIES['chime-hour']) {
      const w = wav(name);
      const win = Math.round(0.3 * w.sampleRate);
      const early = rmsDb(w.samples, 0, win);
      const late = rmsDb(w.samples, w.samples.length - win, w.samples.length);
      expect(early - late, name).toBeGreaterThan(20); // long natural decay
    }
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

/** A deterministic spread-out RNG for rotation tests. */
function lcg(): () => number {
  let n = 1;
  return () => {
    n = (n * 16807 + 12345) % 2147483647;
    return (n % 1009) / 1009;
  };
}

const installStub = (): void => {
  resetEngineForTests();
  StubHowl.instances = [];
  StubHowl.playLog = [];
  setHowlerLoader(async () => ({ Howl: StubHowl as unknown as new (o: HowlOptions) => HowlLike }));
};

describe('sound engine (stub Howler)', () => {
  beforeEach(() => {
    installStub();
    // rng == 0.5 makes jitter() exactly 1, so volume maths stays exact.
    setPlayRngForTests(() => 0.5);
  });

  it('is lazy: no Howl instances exist before the first play', async () => {
    expect(StubHowl.instances).toHaveLength(0);
    await play('pop-soft-3');
    expect(StubHowl.instances).toHaveLength(1);
    expect(StubHowl.instances[0]?.src).toBe('/sounds/pop-soft-3.wav');
  });

  it('init() preloads every sound with correct src and loop flags', async () => {
    await init();
    expect(StubHowl.instances).toHaveLength(SOUND_NAMES.length);
    expect(SOUND_NAMES.length).toBeGreaterThanOrEqual(50);
    for (const name of SOUND_NAMES) {
      const stub = findStub(name);
      expect(stub, name).toBeDefined();
      expect(stub?.options.loop, name).toBe(SOUND_MANIFEST[name].loop);
      expect(stub?.options.preload).toBe(true);
    }
    // Re-init reuses cached instances.
    await init();
    expect(StubHowl.instances).toHaveLength(SOUND_NAMES.length);
  });

  it('routes volume: request x category x master x character trim', async () => {
    setVolumes({ master: 0.5, ui: 0.5 });
    const id = await play('pop-soft-2', { volume: 0.8 });
    expect(id).toBeDefined();
    const stub = findStub('pop-soft-2');
    expect(stub?.volumes.get(id as number)).toBeCloseTo(0.8 * 0.5 * 0.5, 10);
  });

  it('applies category gains per manifest and clamps volumes to 0..1', async () => {
    setVolumes({ master: 1, pages: 0.6, shelf: 7 as number, ambient: -2 as number });
    expect(getVolumes().shelf).toBe(1);
    expect(getVolumes().ambient).toBe(0);
    const flipId = await play('page-flip-1');
    expect(findStub('page-flip-1')?.volumes.get(flipId as number)).toBeCloseTo(0.6, 10);
    const thumpId = await play('drop-thump-3');
    expect(findStub('drop-thump-3')?.volumes.get(thumpId as number)).toBeCloseTo(1, 10);
  });

  it('forwards an explicit rate and never overrides it with jitter', async () => {
    const id = await play('check-done-2', { rate: 1.1 });
    expect(findStub('check-done-2')?.rates.get(id as number)).toBe(1.1);
  });

  it('jitters pitch and level per play, inside the character bounds', async () => {
    setPlayRngForTests(lcg());
    setVolumes({ master: 1, ui: 1 });
    for (let i = 0; i < 40; i++) await play('check-done-3');
    const stub = findStub('check-done-3') as StubHowl;
    const { pitchJitter, levelJitter } = CHARACTER_PROFILES.calm;
    for (const [, rate] of stub.rates) {
      expect(rate).toBeGreaterThanOrEqual(1 - pitchJitter - 1e-9);
      expect(rate).toBeLessThanOrEqual(1 + pitchJitter + 1e-9);
    }
    for (const [, vol] of stub.volumes) {
      expect(vol).toBeGreaterThanOrEqual(1 - levelJitter - 1e-9);
      expect(vol).toBeLessThanOrEqual(1);
    }
    // The whole point: repeats are not identical.
    expect(new Set([...stub.rates.values()].map((r) => r.toFixed(5))).size).toBeGreaterThan(5);
    expect(new Set([...stub.volumes.values()].map((v) => v.toFixed(5))).size).toBeGreaterThan(5);
  });

  it('noJitter gives an exactly reproducible play', async () => {
    setPlayRngForTests(lcg());
    setVolumes({ master: 1, ui: 1 });
    const a = await play('confetti-2', { noJitter: true });
    const b = await play('confetti-2', { noJitter: true });
    const stub = findStub('confetti-2') as StubHowl;
    expect(stub.volumes.get(a as number)).toBe(1);
    expect(stub.volumes.get(b as number)).toBe(1);
    // Neither voice was given a rate of its own. The group rate is stated as
    // the neutral 1 by `presetLevel` — see the note in sound-sets.test.ts.
    expect(stub.rates.has(a as number)).toBe(false);
    expect(stub.rates.has(b as number)).toBe(false);
    expect(stub.rates.get(-1)).toBe(1);
  });

  it.each(Object.keys(SOUND_FAMILIES).map((f) => [f] as const))(
    "play('%s') rotates that family with no immediate repeats",
    async (family) => {
      setPlayRngForTests(lcg());
      // A ROLE rotates the family the current set VOICES it with, which is its
      // own for every role but one — the house set answers `check-done` in
      // wood rather than with its bell (see tests/sound-sets.test.ts).
      const voiced = resolveVoice('house', family as FamilyName)?.cue ?? (family as FamilyName);
      const variants = SOUND_FAMILIES[voiced] as readonly SoundName[];
      await init(); // warm the cache so play order == call order
      StubHowl.playLog = [];
      for (let i = 0; i < 60; i++) await play(family as FamilyName);
      expect(StubHowl.playLog).toHaveLength(60);
      const srcs = new Set(variants.map((v) => `/sounds/${v}.wav`));
      for (const src of StubHowl.playLog) expect(srcs.has(src), src).toBe(true);
      for (let i = 1; i < StubHowl.playLog.length; i++) {
        expect(StubHowl.playLog[i]).not.toBe(StubHowl.playLog[i - 1]);
      }
      expect(new Set(StubHowl.playLog).size).toBe(variants.length);
    },
  );

  it('a concrete variant name still plays exactly that file', async () => {
    await play('page-flip-4');
    expect(StubHowl.playLog).toEqual(['/sounds/page-flip-4.wav']);
  });

  it('reducedSound skips hover and pencil sounds entirely (not even loaded)', async () => {
    setReducedSound(true);
    expect(await play('tick-hover')).toBeUndefined();
    expect(await play('pencil-scratch')).toBeUndefined();
    expect(await play('typing-tick-2')).toBeUndefined();
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
    const stub = findStub('ambient-rain');
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
    const stub = findStub('ambient-rain') as StubHowl;
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
    const stub = findStub('ambient-rain') as StubHowl;
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
    const stub = findStub('ambient-rain') as StubHowl;
    const id = stub.fades[0]?.id as number;
    setVolumes({ ambient: 0.1, master: 1 });
    expect(stub.volumes.get(id)).toBeCloseTo(0.1, 10);
  });

  it("play('ambient-rain') delegates to the fading ambient loop", async () => {
    const id = await play('ambient-rain');
    const stub = findStub('ambient-rain') as StubHowl;
    expect(id).toBeDefined();
    expect(stub.fades).toHaveLength(1); // faded in, not raw-played
  });
});

/* ────────────────────────── sound-character presets ─────────────────────── */

describe('sound-character presets (stub Howler)', () => {
  beforeEach(() => {
    installStub();
    setPlayRngForTests(() => 0.5);
  });

  it('defaults to calm, which is a pure pass-through of the user sliders', () => {
    expect(getSoundCharacter()).toBe('calm');
    for (const gain of Object.values(CHARACTER_PROFILES.calm.gain)) expect(gain).toBe(1);
    expect(CHARACTER_PROFILES.calm.skip.size).toBe(0);
    expect(getEngineState().character).toBe('calm');
  });

  it('every character is describable and has sane jitter widths', () => {
    for (const name of SOUND_CHARACTERS) {
      const p = CHARACTER_PROFILES[name];
      expect(p.blurb.length).toBeGreaterThan(10);
      expect(p.pitchJitter).toBeGreaterThan(0);
      expect(p.pitchJitter).toBeLessThanOrEqual(0.06);
      expect(p.levelJitter).toBeGreaterThan(0);
      expect(p.levelJitter).toBeLessThanOrEqual(0.15);
    }
  });

  it('the pool a character draws from matches its variant weight', () => {
    for (const family of Object.keys(SOUND_FAMILIES) as FamilyName[]) {
      expect(poolFor(family, 'calm')).toEqual(SOUND_FAMILIES[family]);
      for (const n of poolFor(family, 'minimal')) expect(VARIANT_WEIGHTS[n], n).toBe('plain');
      for (const n of poolFor(family, 'rich')) expect(VARIANT_WEIGHTS[n], n).toBe('full');
      expect(poolFor(family, 'minimal').length).toBeGreaterThan(0);
      expect(poolFor(family, 'rich').length).toBeGreaterThan(0);
    }
  });

  it('minimal plays only plain takes and drops the decorative layer', async () => {
    setSoundCharacter('minimal');
    setPlayRngForTests(lcg());
    expect(await play('tick-hover')).toBeUndefined();
    expect(await play('pencil-scratch')).toBeUndefined();
    expect(await play('confetti')).toBeUndefined();
    expect(await play('shelf-whoosh')).toBeUndefined();
    expect(StubHowl.playLog).toHaveLength(0);
    // The sounds an action depends on still play, from the plain pool only.
    for (let i = 0; i < 20; i++) await play('book-pull');
    expect(StubHowl.playLog.length).toBe(20);
    for (const src of StubHowl.playLog) {
      const name = src.replace('/sounds/', '').replace('.wav', '') as SoundName;
      expect(VARIANT_WEIGHTS[name], name).toBe('plain');
    }
  });

  it('rich leans on the full takes and lifts the ambience', async () => {
    setSoundCharacter('rich');
    setPlayRngForTests(lcg());
    for (let i = 0; i < 20; i++) await play('page-flip');
    for (const src of StubHowl.playLog) {
      const name = src.replace('/sounds/', '').replace('.wav', '') as SoundName;
      expect(VARIANT_WEIGHTS[name], name).toBe('full');
    }
    expect(CHARACTER_PROFILES.rich.gain.ambient).toBeGreaterThan(CHARACTER_PROFILES.calm.gain.ambient);
  });

  it('character gain trims the played volume', async () => {
    setPlayRngForTests(() => 0.5);
    setVolumes({ master: 1, ui: 1 });
    setSoundCharacter('minimal');
    const id = await play('check-done', { volume: 1 });
    // play('check-done') names the family: under minimal it rotates the
    // plain pool, so assert the trim on whichever concrete take was played.
    expect(StubHowl.playLog).toHaveLength(1);
    const playedSrc = StubHowl.playLog[0] as string;
    const playedName = playedSrc.replace('/sounds/', '').replace('.wav', '') as SoundName;
    // The house set answers `check-done` in wood, so the take that sounds is
    // from the family it VOICES the role with — see tests/sound-sets.test.ts.
    const voiced = resolveVoice('house', 'check-done')?.cue ?? 'check-done';
    expect(SOUND_FAMILIES[voiced] as readonly SoundName[]).toContain(playedName);
    expect(VARIANT_WEIGHTS[playedName]).toBe('plain');
    const stub = StubHowl.instances.find((h) => h.src === playedSrc);
    expect(stub?.volumes.get(id as number)).toBeCloseTo(
      CHARACTER_PROFILES.minimal.gain.ui,
      10,
    );
  });

  it('switching character live-updates the running ambient bed', async () => {
    setVolumes({ master: 1, ambient: 0.5 });
    await startAmbient();
    const stub = findStub('ambient-rain') as StubHowl;
    const id = stub.fades[0]?.id as number;
    setSoundCharacter('rich');
    expect(stub.volumes.get(id)).toBeCloseTo(
      Math.min(1, 0.5 * CHARACTER_PROFILES.rich.gain.ambient),
      10,
    );
    expect(getEngineState().character).toBe('rich');
  });
});

/* ───────────────────────────── soundscape picker ────────────────────────── */

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('soundscape picker (stub Howler)', () => {
  beforeEach(() => {
    installStub();
    setPlayRngForTests(() => 0.5);
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
    expect(findStub('ambient-rain')).toBeUndefined();
    expect(getEngineState().ambientPlaying).toBe('ambient-fireplace');
  });

  it('switching soundscapes crossfades: old bed out, new bed in', async () => {
    await startAmbient(); // default 'rain'
    const rain = findStub('ambient-rain') as StubHowl;
    const rainId = rain.fades[0]?.id as number;
    setSoundscape('storm');
    await flush();
    const storm = findStub('ambient-storm') as StubHowl;
    expect(rain.fades[rain.fades.length - 1]).toMatchObject({ to: 0, duration: 600 });
    rain.emit('fade');
    expect(rain.playing(rainId)).toBe(false);
    expect(storm.fades[0]).toMatchObject({ from: 0, duration: 600 });
    expect(getEngineState()).toMatchObject({ soundscape: 'storm', ambientPlaying: 'ambient-storm' });
  });

  it("setSoundscape('none') stops the bed; re-selecting a scape resumes it", async () => {
    await startAmbient();
    const bed = findStub('ambient-rain') as StubHowl;
    setSoundscape('none');
    expect(bed.fades[bed.fades.length - 1]).toMatchObject({ to: 0, duration: 600 });
    expect(getEngineState().ambientPlaying).toBeNull();
    await startAmbient();
    expect(getEngineState().ambientPlaying).toBeNull();
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
    installStub();
    setPlayRngForTests(lcg());
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
    for (let i = 0; i < 40; i++) keystroke(i * 10);
    await flush();
    expect(StubHowl.playLog.length).toBeLessThanOrEqual(6);
    expect(StubHowl.playLog.length).toBeGreaterThanOrEqual(4);
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
    const { pitchJitter, levelJitter } = CHARACTER_PROFILES.calm;
    for (const stub of StubHowl.instances) {
      for (const [, vol] of stub.volumes) {
        expect(vol).toBeGreaterThanOrEqual(0.45 * (1 - levelJitter) - 1e-9);
        expect(vol).toBeLessThanOrEqual(1);
      }
      for (const [, rate] of stub.rates) {
        expect(rate).toBeGreaterThanOrEqual(1 - pitchJitter - 1e-9);
        expect(rate).toBeLessThanOrEqual(1 + pitchJitter + 1e-9);
      }
    }
    const vols = StubHowl.instances.flatMap((s) => [...s.volumes.values()]);
    expect(new Set(vols.map((v) => v.toFixed(4))).size).toBeGreaterThan(1);
  });

  it('rotates tick variants with no immediate repeats', async () => {
    setTypingSounds(true);
    // Pre-warm the cache so every play() resolves in call order.
    await init();
    StubHowl.playLog = [];
    for (let i = 0; i < 30; i++) keystroke(i * 1000);
    await flush();
    expect(StubHowl.playLog).toHaveLength(30);
    for (const src of StubHowl.playLog) expect(tickSrcs.has(src)).toBe(true);
    for (let i = 1; i < StubHowl.playLog.length; i++) {
      expect(StubHowl.playLog[i]).not.toBe(StubHowl.playLog[i - 1]);
    }
  });

  it('muted, reduced-sound and the minimal character all silence typing ticks', async () => {
    setTypingSounds(true);
    muteAll(true);
    keystroke(0);
    muteAll(false);
    setReducedSound(true);
    keystroke(1000);
    setReducedSound(false);
    setSoundCharacter('minimal');
    keystroke(2000);
    await flush();
    expect(StubHowl.playLog).toHaveLength(0);
    expect(getEngineState().typingTicksPlayed).toBe(0);
  });
});

/* ─────────────────────────────── hourly chime ───────────────────────────── */

describe('hourly chime (stub Howler)', () => {
  let nowMs = 0;
  let focused = true;

  const at = (h: number, m: number, s = 0): number =>
    new Date(2026, 6, 30, h, m, s).getTime();

  beforeEach(() => {
    installStub();
    setPlayRngForTests(lcg());
    focused = true;
    nowMs = at(9, 40);
    setChimeDepsForTests({ now: () => nowMs, hasFocus: () => focused });
  });

  const chimes = (): number =>
    StubHowl.playLog.filter((src) => src.startsWith('/sounds/chime-hour')).length;

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

/* Guard: PAGE_FLIP_VARIANTS stays the page-flip family (legacy import path). */
describe('legacy exports', () => {
  it('PAGE_FLIP_VARIANTS and TYPING_TICK_VARIANTS still name their families', () => {
    expect(PAGE_FLIP_VARIANTS).toEqual(SOUND_FAMILIES['page-flip']);
    expect(TYPING_TICK_VARIANTS).toEqual(SOUND_FAMILIES['typing-tick']);
  });
});

/* ────────────────── button clicks (delegated, DOM-free half) ─────────────── */

/**
 * `installUiClickSounds` needs a document, which this environment does not
 * have; the two halves it is made of do not, and they are where the rules
 * live. `isSoundedButton` is fed the minimal shape it actually consumes.
 */
describe('button click delegation', () => {
  interface FakeNode {
    closest(selector: string): FakeNode | null;
    hasAttribute(name: string): boolean;
    getAttribute(name: string): string | null;
  }

  const node = (opts: {
    isButton?: boolean;
    silent?: boolean;
    disabled?: boolean;
    ariaDisabled?: boolean;
  }): FakeNode => {
    const self: FakeNode = {
      closest: (selector) => {
        if (selector.includes(SILENT_ATTR)) return opts.silent === true ? self : null;
        return opts.isButton === false ? null : self;
      },
      hasAttribute: (name) => name === 'disabled' && opts.disabled === true,
      getAttribute: (name) =>
        name === 'aria-disabled' && opts.ariaDisabled === true ? 'true' : null,
    };
    return self;
  };

  it('voices a button, and nothing else', () => {
    expect(isSoundedButton(node({}) as unknown as EventTarget)).toBe(true);
    expect(isSoundedButton(node({ isButton: false }) as unknown as EventTarget)).toBe(false);
    expect(isSoundedButton(null)).toBe(false);
    // A bare EventTarget (window, a media element) has no closest().
    expect(isSoundedButton({} as EventTarget)).toBe(false);
  });

  it('stays silent for disabled controls and anything opted out', () => {
    expect(isSoundedButton(node({ disabled: true }) as unknown as EventTarget)).toBe(false);
    expect(isSoundedButton(node({ ariaDisabled: true }) as unknown as EventTarget)).toBe(false);
    expect(isSoundedButton(node({ silent: true }) as unknown as EventTarget)).toBe(false);
  });

  it('steps aside for a control that already voiced itself', () => {
    // The shelf menu popping open is the whole reason this rule exists: the
    // click fires AFTER the element's own handler, so a recent non-click play
    // means "this control has a voice already".
    expect(shouldClick(1000, 20, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(shouldClick(1000, 179, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(shouldClick(1000, 180, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(shouldClick(1000, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)).toBe(true);
  });

  it('collapses a double-click into one sound', () => {
    const quiet = Number.POSITIVE_INFINITY;
    expect(shouldClick(1000, quiet, 980)).toBe(false); // 20 ms apart
    expect(shouldClick(1045, quiet, 1000)).toBe(true); // 45 ms apart
  });

  it('msSinceVoicedPlay ignores the click family itself', async () => {
    await init();
    const before = msSinceVoicedPlay(1_000_000);
    await play('click-soft', { noJitter: true });
    expect(msSinceVoicedPlay(1_000_000)).toBe(before); // unchanged: clicks do not count
    await play('pop-soft', { noJitter: true });
    expect(msSinceVoicedPlay(Date.now())).toBeLessThan(1000);
  });
});

/* ──────────────────────────── credits manifest ───────────────────────────── */

/**
 * The CC BY obligation is only satisfied if the credit reaches a reader, and
 * the panel renders whatever the last audio build wrote. So this reads the
 * REAL public/sounds/CREDITS.json rather than a fixture: a rebuild that
 * dropped the attribution, or shipped a cue with no provenance at all, has to
 * fail here rather than in a licence complaint.
 */
describe('public/sounds/CREDITS.json', () => {
  const manifest = JSON.parse(
    readFileSync(join(SOUNDS_DIR, 'CREDITS.json'), 'utf8'),
  ) as CreditsManifest;

  it('carries provenance for every shipped cue', () => {
    for (const name of SOUND_NAMES) {
      const entry = manifest.sounds?.[name];
      expect(Array.isArray(entry), `${name} has no credit`).toBe(true);
      for (const credit of entry ?? []) {
        expect(credit.title, name).toBeTruthy();
        expect(credit.author, name).toBeTruthy();
        expect(credit.licence, name).toMatch(/CC0|CC BY|Public domain/i);
        expect(credit.sourcePage, name).toMatch(/^https?:\/\//);
        expect(credit.licenceUrl, name).toMatch(/^https?:\/\//);
      }
    }
  });

  it('lists every attribution the licences actually require', () => {
    const required = new Set<string>();
    for (const credits of Object.values(manifest.sounds ?? {})) {
      for (const credit of credits) {
        if (credit.attributionRequired) required.add(credit.attributionText as string);
      }
    }
    expect(new Set(manifest.attributionsRequired ?? [])).toEqual(required);
    // Anything under a CC BY licence MUST be flagged, or the panel stays quiet
    // about the one credit that is not optional.
    for (const credits of Object.values(manifest.sounds ?? {})) {
      for (const credit of credits) {
        if (/CC BY/i.test(credit.licence)) expect(credit.attributionRequired).toBe(true);
      }
    }
  });

  it('regroups per-recording for display, obligations first', () => {
    const groups = groupCredits(manifest);
    expect(groups.length).toBeGreaterThan(5);
    expect(groups[0]?.credit.attributionRequired).toBe(true);
    // Every cue appears exactly once per recording it was built from.
    const seen = groups.flatMap((g) => g.cues);
    expect(new Set(seen).size).toBe(SOUND_NAMES.length);
    // A layered bed is credited to each of its sources.
    const night = groups.filter((g) => g.cues.includes('ambient-night'));
    expect(night).toHaveLength(2);
  });

  it('tolerates a manifest from another build shape', () => {
    expect(groupCredits(undefined)).toEqual([]);
    expect(groupCredits({ sounds: {} })).toEqual([]);
    // The pre-array shape (one object per cue) still renders.
    const legacy = {
      sounds: { 'pop-soft': { title: 'x', author: 'y' } },
    } as unknown as CreditsManifest;
    expect(groupCredits(legacy)).toHaveLength(1);
  });

  it('summarises cue lists and licences for the badge', () => {
    expect(summariseCues(['page-flip-1', 'page-flip-2', 'pencil-scratch'])).toBe(
      'page-flip ×2, pencil-scratch',
    );
    expect(shortLicence('Public domain (PD-author, via pdsounds.org)')).toBe('Public domain');
    expect(shortLicence('CC0 1.0')).toBe('CC0 1.0');
  });
});
