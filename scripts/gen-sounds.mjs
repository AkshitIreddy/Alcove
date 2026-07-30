/**
 * scripts/gen-sounds.mjs — procedural sound-effect synthesis for Notebook.
 *
 * Pure Node, zero dependencies. Renders every UI/ambience sound as
 * 44.1 kHz / 16-bit / mono PCM WAV into public/sounds/, plus a
 * peak/RMS/duration report at public/sounds/report.txt.
 *
 * Sonic brief: soft, papery, warm. Never shrill, never game-y.
 *
 *   node scripts/gen-sounds.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SR = 44100;
const TWO_PI = Math.PI * 2;

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');

/* ═══════════════════════════════ random ═══════════════════════════════ */

/** Deterministic PRNG so re-running the script reproduces byte-identical audio. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** White noise in [-1, 1). */
const white = (rng) => rng() * 2 - 1;

/** Pink noise generator (Paul Kellet's refined filter). */
function makePink(rng) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = white(rng);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out * 0.11;
  };
}

/** Brown noise generator (leaky integrator of white noise). */
function makeBrown(rng) {
  let b = 0;
  return () => {
    b = (b + 0.02 * white(rng)) / 1.02;
    return b * 3.5;
  };
}

/**
 * Slowly varying noise in [-1, 1]: white noise through a one-pole lowpass,
 * for organic amplitude/frequency wobble.
 */
function makeSlowNoise(rng, cutoffHz) {
  const a = 1 - Math.exp((-TWO_PI * cutoffHz) / SR);
  let y = 0;
  // Rough gain compensation so output still reaches near +-1.
  const gain = Math.min(60, 1 / Math.sqrt(a));
  return () => {
    y += a * (white(rng) - y);
    return Math.max(-1, Math.min(1, y * gain));
  };
}

/* ═══════════════════════════ RBJ biquad filters ═══════════════════════════ */
/* Coefficients straight from the RBJ Audio-EQ-Cookbook, normalized by a0.   */

function lowpassCoeffs(f0, q) {
  const w0 = (TWO_PI * f0) / SR;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cw) / 2 / a0,
    b1: (1 - cw) / a0,
    b2: (1 - cw) / 2 / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  };
}

function highpassCoeffs(f0, q) {
  const w0 = (TWO_PI * f0) / SR;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cw) / 2 / a0,
    b1: -(1 + cw) / a0,
    b2: (1 + cw) / 2 / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Constant-0 dB-peak-gain bandpass. */
function bandpassCoeffs(f0, q) {
  const w0 = (TWO_PI * f0) / SR;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  };
}

function highshelfCoeffs(f0, gainDb, slope = 1) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (TWO_PI * f0) / SR;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const sqA2a = 2 * Math.sqrt(A) * alpha;
  const a0 = A + 1 - (A - 1) * cw + sqA2a;
  return {
    b0: (A * (A + 1 + (A - 1) * cw + sqA2a)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
    b2: (A * (A + 1 + (A - 1) * cw - sqA2a)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cw)) / a0,
    a2: (A + 1 - (A - 1) * cw - sqA2a) / a0,
  };
}

class Biquad {
  constructor(coeffs) {
    this.set(coeffs);
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  set(c) {
    this.b0 = c.b0; this.b1 = c.b1; this.b2 = c.b2; this.a1 = c.a1; this.a2 = c.a2;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/* ═══════════════════════════ envelopes & curves ═══════════════════════════ */

const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const hann = (u) => 0.5 - 0.5 * Math.cos(TWO_PI * clamp01(u));
const smoothstep = (u) => { const t = clamp01(u); return t * t * (3 - 2 * t); };
/** Exponential interpolation — natural for pitch and filter sweeps. */
const expInterp = (from, to, u) => from * Math.pow(to / from, clamp01(u));
/** Gaussian bump centred at c with width w (both in normalized time). */
const bump = (u, c, w) => Math.exp(-((u - c) * (u - c)) / (w * w));

/**
 * ADSR envelope factory. Times in seconds, sustain as level 0..1.
 * Attack/decay/release use smooth power curves (no zipper corners).
 */
function makeAdsr({ attack, decay, sustain, release, dur }) {
  const aEnd = attack;
  const dEnd = attack + decay;
  const rStart = dur - release;
  return (t) => {
    if (t < 0 || t >= dur) return 0;
    if (t < aEnd) return Math.pow(t / Math.max(aEnd, 1e-9), 0.7);
    if (t < dEnd) {
      const u = (t - aEnd) / Math.max(decay, 1e-9);
      return 1 + (sustain - 1) * smoothstep(u);
    }
    if (t < rStart) return sustain;
    const u = (t - rStart) / Math.max(release, 1e-9);
    return sustain * Math.pow(1 - clamp01(u), 1.4);
  };
}

/** Soft tanh saturation, normalized so drive only shapes, not boosts. */
const softSat = (x, drive = 1.5) => Math.tanh(x * drive) / Math.tanh(drive);

/* ═══════════════════════ reverb / loop / mastering ═══════════════════════ */

/**
 * Short damped feedback-delay reverb: three parallel feedback combs with a
 * one-pole lowpass in each loop. Returns input + wet with tailMs appended.
 */
function addReverbTail(x, { tailMs = 160, wet = 0.16, feedback = 0.5, damp = 0.45, delaysMs = [23.7, 31.9, 41.3] } = {}) {
  const tail = Math.round((tailMs / 1000) * SR);
  const n = x.length + tail;
  const out = new Float64Array(n);
  for (const dMs of delaysMs) {
    const d = Math.max(1, Math.round((dMs / 1000) * SR));
    const buf = new Float64Array(d);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const inp = i < x.length ? x[i] : 0;
      const delayed = buf[idx];
      lp += damp * (delayed - lp); // damped feedback path
      buf[idx] = inp + lp * feedback;
      out[i] += (delayed * wet) / delaysMs.length;
      idx = (idx + 1) % d;
    }
  }
  for (let i = 0; i < x.length; i++) out[i] += x[i];
  return out;
}

/**
 * Make a buffer loop seamlessly: equal-power crossfade of the final
 * fadeSamples into the head, trimming the buffer by fadeSamples.
 */
function crossfadeLoop(x, fadeSamples) {
  const n = x.length - fadeSamples;
  if (n <= 0) throw new Error('crossfadeLoop: fade longer than buffer');
  const out = new Float64Array(n);
  out.set(x.subarray(0, n));
  for (let i = 0; i < fadeSamples; i++) {
    const u = (i + 1) / (fadeSamples + 1);
    const inG = Math.sin((u * Math.PI) / 2);
    const outG = Math.cos((u * Math.PI) / 2);
    out[i] = out[i] * inG + x[n + i] * outG;
  }
  return out;
}

/** One-pole DC blocker (~10 Hz highpass) — removes offset and infrasonic drift. */
function dcBlock(x) {
  const R = 1 - (TWO_PI * 10) / SR;
  const out = new Float64Array(x.length);
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] - px + R * py;
    px = x[i]; py = y;
    out[i] = y;
  }
  // Remove any residual mean.
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length;
  for (let i = 0; i < out.length; i++) out[i] -= mean;
  return out;
}

/**
 * Master chain: DC removal, raised-cosine edge fades (>= 5 ms, guaranteeing
 * click-free starts/ends), then peak-normalize to peakDb dBFS.
 */
function masterize(x, { peakDb = -6, fadeInMs = 5, fadeOutMs = 12 } = {}) {
  const y = dcBlock(x);
  const fi = Math.max(Math.round((fadeInMs / 1000) * SR), Math.round(0.005 * SR));
  const fo = Math.max(Math.round((fadeOutMs / 1000) * SR), Math.round(0.005 * SR));
  for (let i = 0; i < fi && i < y.length; i++) {
    y[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
  }
  for (let i = 0; i < fo && i < y.length; i++) {
    y[y.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
  }
  let peak = 0;
  for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
  if (!(peak > 0) || !Number.isFinite(peak)) throw new Error('masterize: silent or invalid buffer');
  const target = Math.pow(10, peakDb / 20);
  const g = target / peak;
  for (let i = 0; i < y.length; i++) y[i] *= g;
  return y;
}

/* ═══════════════════════════════ WAV writer ═══════════════════════════════ */

/** Quantize float [-1,1] to 16-bit PCM with a whisper of TPDF dither. */
function toPcm16(x, rng) {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const dither = (rng() + rng() - 1) * 0.5; // TPDF, +-0.5 LSB
    let v = Math.round(x[i] * 32767 + dither);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    out[i] = v;
  }
  return out;
}

/** Minimal RIFF/WAVE writer: 44.1 kHz, 16-bit, mono PCM. */
function writeWav(path, pcm) {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // audio format: PCM
  buf.writeUInt16LE(1, 22); // channels: mono
  buf.writeUInt32LE(SR, 24); // sample rate
  buf.writeUInt32LE(SR * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  writeFileSync(path, buf);
}

/* ═══════════════════════════ shared sound bricks ═══════════════════════════ */

/**
 * A tiny "crinkle": a few milliseconds of noise rung through a resonant
 * bandpass — the sound of one paper fiber snapping. Added in place at start.
 */
function addCrinkle(dest, rng, { start, lenMs, freq, q, amp }) {
  const n = Math.round((lenMs / 1000) * SR);
  const bp = new Biquad(bandpassCoeffs(freq, q));
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx >= dest.length) break;
    const u = i / n;
    dest[idx] += bp.process(white(rng)) * (1 - u) * (1 - u) * amp;
  }
}

/** A soft felt/leather thump: pitched-down sine + a pat of lowpassed noise. */
function renderThump(rng, { dur, f0, f1, amp = 1, noiseAmp = 0.3, drive = 2 }) {
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const lp = new Biquad(lowpassCoeffs(700, 0.8));
  let phase = 0;
  const attack = Math.round(0.002 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = i / n;
    const f = expInterp(f0, f1, u);
    phase += (TWO_PI * f) / SR;
    const env = (i < attack ? i / attack : 1) * Math.exp(-t / (dur * 0.32));
    const body = Math.sin(phase) * env;
    const pat = lp.process(white(rng)) * Math.exp(-t / (dur * 0.12)) * noiseAmp;
    out[i] = softSat(body + pat, drive) * amp;
  }
  return out;
}

/* ═══════════════════════════════ the sounds ═══════════════════════════════ */

/** page-flip 1/2/3 — filtered-noise swish, falling bandpass, crinkle layer. */
function pageFlip({ dur, fStart, fEnd, q, crinkles, seed }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const bpMain = new Biquad(bandpassCoeffs(fStart, q));
  const bpBody = new Biquad(bandpassCoeffs(fStart / 2, q * 0.9));
  const shelf = new Biquad(highshelfCoeffs(6200, -9)); // never shrill
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = expInterp(fStart, fEnd, smoothstep(u)); // falling sweep
    bpMain.set(bandpassCoeffs(f, q));
    bpBody.set(bandpassCoeffs(f / 2, q * 0.9));
    const w = white(rng);
    const env = Math.pow(u, 0.3) * Math.pow(1 - u, 1.25);
    out[i] = (bpMain.process(w) + bpBody.process(w) * 0.45) * env;
  }
  for (let k = 0; k < crinkles; k++) {
    addCrinkle(out, rng, {
      start: Math.round((0.06 + rng() * 0.5) * n),
      lenMs: 2 + rng() * 3,
      freq: 1400 + rng() * 2200,
      q: 7 + rng() * 4,
      amp: 0.16 + rng() * 0.2,
    });
  }
  for (let i = 0; i < n; i++) out[i] = softSat(shelf.process(out[i]), 1.3);
  return out;
}

/** book-pull — rising friction slide, ending in a soft leather thump. */
function bookPull() {
  const rng = mulberry32(4242);
  const dur = 0.26;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const pink = makePink(rng);
  const bp = new Biquad(bandpassCoeffs(300, 1.3));
  const wobble = makeSlowNoise(rng, 28);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    bp.set(bandpassCoeffs(expInterp(300, 900, u), 1.3)); // rising friction
    const grip = 0.62 + 0.38 * Math.abs(wobble()); // stick-slip texture
    const env = Math.pow(u, 0.45) * Math.pow(1 - u, 0.35);
    out[i] = bp.process(pink() * 2.2) * env * grip;
  }
  const thump = renderThump(rng, { dur: 0.08, f0: 130, f1: 76, amp: 0.95, noiseAmp: 0.35 });
  const at = Math.round((dur - 0.082) * SR);
  for (let i = 0; i < thump.length && at + i < n; i++) out[at + i] += thump[i];
  for (let i = 0; i < n; i++) out[i] = softSat(out[i], 1.4);
  return out;
}

/** book-return — the pull mirrored: gentle thump first, friction settling down. */
function bookReturn() {
  const rng = mulberry32(2424);
  const dur = 0.24;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const pink = makePink(rng);
  const bp = new Biquad(bandpassCoeffs(850, 1.3));
  const wobble = makeSlowNoise(rng, 24);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    bp.set(bandpassCoeffs(expInterp(850, 320, u), 1.3)); // falling friction
    const grip = 0.68 + 0.32 * Math.abs(wobble());
    const env = Math.pow(u, 0.18) * Math.pow(1 - u, 0.9);
    out[i] = bp.process(pink() * 2.2) * env * grip;
  }
  const thump = renderThump(rng, { dur: 0.07, f0: 110, f1: 70, amp: 0.5, noiseAmp: 0.3 });
  const at = Math.round(0.012 * SR);
  for (let i = 0; i < thump.length && at + i < n; i++) out[at + i] += thump[i];
  for (let i = 0; i < n; i++) out[i] = softSat(out[i], 1.3);
  return out;
}

/** shelf-whoosh — very soft broadband air for the zoom-to-floor camera move. */
function shelfWhoosh() {
  const rng = mulberry32(7001);
  const dur = 0.35;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const pink = makePink(rng);
  const lp = new Biquad(lowpassCoeffs(350, 0.8));
  const lid = new Biquad(lowpassCoeffs(1200, 0.7));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    // Rise-and-fall sweep: darkest at the edges, opens mid-flight.
    lp.set(lowpassCoeffs(expInterp(330, 950, Math.sin(Math.PI * u)), 0.8));
    const env = Math.pow(hann(u), 1.15);
    out[i] = lid.process(lp.process(pink() * 2.4)) * env;
  }
  return out;
}

/** pop-soft — menu-open blip: descending sine through a lowpass, tiny tick. */
function popSoft() {
  const rng = mulberry32(880);
  const dur = 0.06;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const lp = new Biquad(lowpassCoeffs(1400, 0.8));
  const tickBp = new Biquad(bandpassCoeffs(2800, 2.5));
  let phase = 0;
  const attack = Math.round(0.003 * SR);
  const tickLen = Math.round(0.0025 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = i / n;
    phase += (TWO_PI * expInterp(380, 240, u)) / SR;
    const env = (i < attack ? i / attack : 1) * Math.exp(-t / 0.018);
    const blip = Math.sin(phase) * env;
    const tick = i < tickLen ? tickBp.process(white(rng)) * (1 - i / tickLen) * 0.14 : 0;
    out[i] = softSat(lp.process(blip + tick), 1.2);
  }
  return out;
}

/** tick-hover — a breath of a tick, barely audible by design. */
function tickHover() {
  const rng = mulberry32(31);
  const dur = 0.025;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const bp = new Biquad(bandpassCoeffs(1900, 4));
  const attack = Math.round(0.001 * SR);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const env = (i < attack ? i / attack : 1) * Math.pow(1 - u, 3);
    out[i] = bp.process(white(rng)) * env;
  }
  return out;
}

/** check-done — pencil scratch flourish plus a warm marimba-ish blip. */
function checkDone() {
  const rng = mulberry32(5150);
  const dur = 0.3;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const scratchDur = 0.14;
  const sn = Math.round(scratchDur * SR);
  const bp = new Biquad(bandpassCoeffs(1350, 2.2));
  const texture = makeSlowNoise(rng, 60);
  for (let i = 0; i < sn; i++) {
    const u = i / sn;
    bp.set(bandpassCoeffs(expInterp(1350, 2900, u), 2.2));
    // Two pencil strokes: the tick's down-stroke and flick.
    const strokes = bump(u, 0.24, 0.15) + 0.8 * bump(u, 0.66, 0.17);
    const grain = 0.55 + 0.45 * Math.abs(texture());
    out[i] = bp.process(white(rng)) * strokes * grain * 0.55;
  }
  const lp = new Biquad(lowpassCoeffs(2600, 0.9));
  const blipStart = Math.round(0.11 * SR);
  const blipLen = Math.round(0.19 * SR);
  let p1 = 0, p2 = 0;
  const attack = Math.round(0.002 * SR);
  for (let i = 0; i < blipLen && blipStart + i < n; i++) {
    const t = i / SR;
    p1 += (TWO_PI * 520) / SR;
    p2 += (TWO_PI * 1040) / SR;
    const env = (i < attack ? i / attack : 1) * Math.exp(-t / 0.05);
    const tone = (Math.sin(p1) + 0.35 * Math.sin(p2)) * env; // sine + 2nd harmonic
    out[blipStart + i] += lp.process(softSat(tone, 1.4)) * 0.9;
  }
  return out;
}

/** crumple-delete — a fistful of paper: crinkle bursts, density falling away. */
function crumpleDelete() {
  const rng = mulberry32(6666);
  const dur = 0.3;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  // Low papery bed under the crinkles.
  const pink = makePink(rng);
  const bed = new Biquad(lowpassCoeffs(700, 0.8));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    out[i] = bed.process(pink() * 2) * Math.pow(1 - u, 1.2) * 0.16;
  }
  // Poisson-ish crinkle events, rate decaying ~95/s -> ~16/s.
  let t = 0.004;
  while (t < dur - 0.03) {
    const u = t / dur;
    const rate = 95 + (16 - 95) * u;
    addCrinkle(out, rng, {
      start: Math.round(t * SR),
      lenMs: 2.5 + rng() * 4.5,
      freq: Math.max(500, 3400 - 1800 * u + (rng() - 0.5) * 1200),
      q: 5 + rng() * 4,
      amp: (0.35 + 0.65 * rng()) * (1 - 0.55 * u),
    });
    t += -Math.log(1 - rng()) / rate;
  }
  for (let i = 0; i < n; i++) out[i] = softSat(out[i], 1.35);
  return out;
}

/** drop-thump — a book landing on felt. */
function dropThump() {
  const rng = mulberry32(808);
  const dur = 0.12;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const lp = new Biquad(lowpassCoeffs(850, 0.8));
  let phase = 0;
  const attack = Math.round(0.002 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = i / n;
    phase += (TWO_PI * expInterp(115, 68, u)) / SR; // pitch drop to ~80 Hz zone
    const env = (i < attack ? i / attack : 1) * Math.exp(-t / 0.04);
    const body = Math.sin(phase) * env;
    const pat = lp.process(white(rng)) * Math.exp(-t / 0.012) * 0.4; // noise pat
    out[i] = softSat(body + pat, 2.2);
  }
  return out;
}

/** pencil-scratch — 200 ms seamless writing-texture loop. */
function pencilScratch() {
  const rng = mulberry32(1212);
  const genDur = 0.24;
  const fade = Math.round(0.04 * SR); // trimmed to exactly 0.2 s by the crossfade
  const n = Math.round(genDur * SR);
  const out = new Float64Array(n);
  const bp = new Biquad(bandpassCoeffs(1900, 1.7));
  const tooth = new Biquad(bandpassCoeffs(3400, 3));
  const drift = makeSlowNoise(rng, 6);
  const strokes = makeSlowNoise(rng, 11);
  for (let i = 0; i < n; i++) {
    bp.set(bandpassCoeffs(1900 + 420 * drift(), 1.7));
    const w = white(rng);
    // Never fully silent: the loop must keep its grain everywhere.
    const amp = 0.45 + 0.55 * (0.5 + 0.5 * strokes());
    out[i] = (bp.process(w) + tooth.process(w) * 0.25) * amp;
  }
  return crossfadeLoop(out, fade);
}

/** confetti — a soft handful of paper pops and flutter. Festive, not fizzy. */
function confetti() {
  const rng = mulberry32(9999);
  const bodyDur = 0.32;
  const n = Math.round(bodyDur * SR);
  const out = new Float64Array(n);
  // ~26 tiny pops, denser early, drifting quieter and lower.
  for (let k = 0; k < 26; k++) {
    const t0 = Math.pow(rng(), 1.4) * (bodyDur - 0.035);
    const f0 = 650 * Math.pow(2, rng() * 1.9);
    const len = Math.round((0.015 + rng() * 0.013) * SR);
    const start = Math.round(t0 * SR);
    const amp = (0.25 + 0.55 * rng()) * (1 - 0.4 * (t0 / bodyDur));
    let phase = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const u = i / len;
      phase += (TWO_PI * expInterp(f0, f0 * 0.82, u)) / SR;
      out[start + i] += Math.sin(phase) * Math.pow(u, 0.12) * Math.pow(1 - u, 2.5) * amp;
    }
    addCrinkle(out, rng, { start, lenMs: 1.2, freq: f0 * 1.6, q: 4, amp: amp * 0.25 });
  }
  // Paper flutter underneath.
  const flutterBp = new Biquad(bandpassCoeffs(2300, 1.2));
  const flutterDrift = makeSlowNoise(rng, 3);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = i / n;
    const mod = 0.5 + 0.5 * Math.sin(TWO_PI * 15 * t + flutterDrift() * 2.5);
    out[i] += flutterBp.process(white(rng)) * mod * hann(u) * 0.16;
  }
  const lid = new Biquad(lowpassCoeffs(5200, 0.8));
  for (let i = 0; i < n; i++) out[i] = softSat(lid.process(out[i]), 1.2);
  // A whisper of room so it feels celebratory rather than dry. ~0.4 s total.
  return addReverbTail(out, { tailMs: 80, wet: 0.15, feedback: 0.45, damp: 0.5 });
}

/** ambient-library — 8 s seamless warm room tone with two distant rustles. */
function ambientLibrary() {
  const rng = mulberry32(101010);
  const genDur = 9; // 1 s gets crossfaded into the head -> exactly 8 s
  const n = Math.round(genDur * SR);
  const out = new Float64Array(n);
  const brown = makeBrown(rng);
  const lp = new Biquad(lowpassCoeffs(400, 0.7));
  const swell = makeSlowNoise(rng, 0.15); // tidal +-0.8 dB breathing
  for (let i = 0; i < n; i++) {
    const gain = Math.pow(10, (swell() * 0.8) / 20);
    out[i] = lp.process(brown()) * gain;
  }
  // Two faint page rustles from across the room (kept clear of the loop seam).
  for (const [at, seed] of [[2.8, 11], [6.0, 22]]) {
    const rr = mulberry32(seed);
    const rDur = 0.28;
    const rn = Math.round(rDur * SR);
    const rustle = new Float64Array(rn);
    const bp = new Biquad(bandpassCoeffs(2600, 1.4));
    const lid = new Biquad(lowpassCoeffs(3000, 0.8));
    for (let i = 0; i < rn; i++) {
      const u = i / rn;
      bp.set(bandpassCoeffs(expInterp(2600, 1500, u), 1.4));
      rustle[i] = lid.process(bp.process(white(rr))) * Math.pow(hann(u), 1.3);
    }
    // Distance = reverb + quiet.
    const wetRustle = addReverbTail(rustle, { tailMs: 300, wet: 0.35, feedback: 0.55, damp: 0.5 });
    const start = Math.round(at * SR);
    // Scale rustle to sit faintly above the bed.
    let bedRms = 0;
    for (let i = start; i < start + rn; i++) bedRms += out[i] * out[i];
    bedRms = Math.sqrt(bedRms / rn);
    let rPeak = 0;
    for (let i = 0; i < wetRustle.length; i++) rPeak = Math.max(rPeak, Math.abs(wetRustle[i]));
    const g = (bedRms * 3.2) / rPeak;
    for (let i = 0; i < wetRustle.length && start + i < n; i++) out[start + i] += wetRustle[i] * g;
  }
  return crossfadeLoop(out, SR); // 1 s equal-power seam blend -> 8.000 s
}

/* ═══════════════════════════════ build all ═══════════════════════════════ */

const SOUNDS = [
  { name: 'page-flip-1', peakDb: -6, render: () => pageFlip({ dur: 0.105, fStart: 5600, fEnd: 2050, q: 1.05, crinkles: 5, seed: 101 }) },
  { name: 'page-flip-2', peakDb: -6, render: () => pageFlip({ dur: 0.128, fStart: 6100, fEnd: 2350, q: 1.2, crinkles: 6, seed: 202 }) },
  { name: 'page-flip-3', peakDb: -6, render: () => pageFlip({ dur: 0.093, fStart: 5100, fEnd: 1900, q: 0.95, crinkles: 4, seed: 303 }) },
  { name: 'book-pull', peakDb: -6, render: bookPull },
  { name: 'book-return', peakDb: -9, render: bookReturn },
  { name: 'shelf-whoosh', peakDb: -18, render: shelfWhoosh }, // -12 dB under the pack
  { name: 'pop-soft', peakDb: -6, render: popSoft },
  { name: 'tick-hover', peakDb: -24, render: tickHover }, // barely audible by design
  { name: 'check-done', peakDb: -6, render: checkDone },
  { name: 'crumple-delete', peakDb: -7, render: crumpleDelete },
  { name: 'drop-thump', peakDb: -6, render: dropThump },
  { name: 'pencil-scratch', peakDb: -14, fadeInMs: 5, fadeOutMs: 5, render: pencilScratch },
  { name: 'confetti', peakDb: -7.5, render: confetti },
  { name: 'ambient-library', peakDb: -17, fadeInMs: 5, fadeOutMs: 5, render: ambientLibrary },
];

function analyze(pcm) {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]) / 32768;
    if (v > peak) peak = v;
    sum += (pcm[i] / 32768) * (pcm[i] / 32768);
  }
  const rms = Math.sqrt(sum / pcm.length);
  return {
    durationS: pcm.length / SR,
    peakDb: 20 * Math.log10(Math.max(peak, 1e-9)),
    rmsDb: 20 * Math.log10(Math.max(rms, 1e-9)),
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const ditherRng = mulberry32(0xd17e);
const reportLines = [
  'Notebook procedural sound report — generated by scripts/gen-sounds.mjs',
  `format: 44100 Hz / 16-bit / mono PCM WAV    (all peaks <= -6 dBFS by design)`,
  '',
  padCols(['file', 'duration', 'peak dBFS', 'RMS dBFS']),
  padCols(['----', '--------', '---------', '--------']),
];

function padCols([a, b, c, d]) {
  return a.padEnd(22) + b.padStart(9) + c.padStart(11) + d.padStart(10);
}

for (const s of SOUNDS) {
  const raw = s.render();
  for (let i = 0; i < raw.length; i++) {
    if (!Number.isFinite(raw[i])) throw new Error(`${s.name}: non-finite sample at ${i}`);
  }
  const mastered = masterize(raw, { peakDb: s.peakDb, fadeInMs: s.fadeInMs ?? 5, fadeOutMs: s.fadeOutMs ?? 12 });
  const pcm = toPcm16(mastered, ditherRng);
  writeWav(join(OUT_DIR, `${s.name}.wav`), pcm);
  const a = analyze(pcm);
  reportLines.push(
    padCols([`${s.name}.wav`, `${a.durationS.toFixed(3)} s`, a.peakDb.toFixed(2), a.rmsDb.toFixed(2)]),
  );
  console.log(`  ${s.name}.wav  ${a.durationS.toFixed(3)}s  peak ${a.peakDb.toFixed(2)} dBFS  rms ${a.rmsDb.toFixed(2)} dBFS`);
}

reportLines.push('');
writeFileSync(join(OUT_DIR, 'report.txt'), reportLines.join('\n'));
console.log(`\nWrote ${SOUNDS.length} sounds + report.txt to ${OUT_DIR}`);
