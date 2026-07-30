/**
 * scripts/gen-sounds.mjs — procedural sound-effect synthesis for Notebook.
 *
 * Pure Node, zero dependencies. Renders every UI/ambience sound as
 * 44.1 kHz / 16-bit / mono PCM WAV into public/sounds/, plus a
 * peak/RMS/centroid/attack report at public/sounds/report.txt.
 *
 *   node scripts/gen-sounds.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SONIC BRIEF (rewritten after the "very rough, low quality" review)
 * ─────────────────────────────────────────────────────────────────────────
 * Smooth, calm, warm, high quality. The previous set was thin and harsh:
 * page turns had a 5.6 kHz spectral centroid with half their energy above
 * 4 kHz, envelopes snapped open in 3 ms, and nothing sat in a room. Every
 * sound here is rebuilt on four rules:
 *
 *   1. LAYERS, NOT A LAYER. Each one-shot is 3-6 stacked elements —
 *      body, transient, texture, air, tail — each with its own envelope
 *      and its own filter. A single filtered noise burst is what "cheap"
 *      sounds like.
 *   2. NO CLICKY ATTACKS. Every envelope opens on a raised cosine (C1
 *      continuous: value AND slope start at zero), minimum 6 ms, and
 *      closes on a long power-curve release. No linear ramps anywhere.
 *   3. WARMTH OVER BRIGHTNESS. Everything is voiced through the same warm
 *      bus: a presence dip at 3 kHz where harshness lives, a high shelf
 *      pulling the top down, a gentle 2.4:1 compressor so nothing peaks,
 *      and a final lowpass lid. Target centroid for one-shots is under
 *      2 kHz (was 5.4 kHz on page flips).
 *   4. AIR. A short, dark, diffuse FDN reverb on EVERY sound, so they sit
 *      in a library rather than on top of the speaker.
 *
 * Each one-shot family ships 3-6 variants with genuinely different seeds,
 * durations, filter tunings and texture densities. Variants are tagged
 * `plain` or `full`, which is what the engine's calm/rich/minimal
 * sound-character presets select between at play time.
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

/** Uniform in [lo, hi). */
const between = (rng, lo, hi) => lo + rng() * (hi - lo);

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
  const gain = Math.min(60, 1 / Math.sqrt(a));
  return () => {
    y += a * (white(rng) - y);
    return Math.max(-1, Math.min(1, y * gain));
  };
}

/* ═══════════════════════════ RBJ biquad filters ═══════════════════════════ */
/* Coefficients straight from the RBJ Audio-EQ-Cookbook, normalized by a0.   */

function lowpassCoeffs(f0, q) {
  const w0 = (TWO_PI * Math.min(f0, SR * 0.45)) / SR;
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
  const w0 = (TWO_PI * Math.min(f0, SR * 0.45)) / SR;
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

/** Peaking EQ — the surgical tool for scooping the 3 kHz harshness zone. */
function peakingCoeffs(f0, gainDb, q) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (TWO_PI * f0) / SR;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cw) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

function lowshelfCoeffs(f0, gainDb, slope = 1) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (TWO_PI * f0) / SR;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const sqA2a = 2 * Math.sqrt(A) * alpha;
  const a0 = A + 1 + (A - 1) * cw + sqA2a;
  return {
    b0: (A * (A + 1 - (A - 1) * cw + sqA2a)) / a0,
    b1: (2 * A * (A - 1 - (A + 1) * cw)) / a0,
    b2: (A * (A + 1 - (A - 1) * cw - sqA2a)) / a0,
    a1: (-2 * (A - 1 + (A + 1) * cw)) / a0,
    a2: (A + 1 + (A - 1) * cw - sqA2a) / a0,
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

/** Run a whole buffer through one biquad, out of place. */
function filterBuffer(x, coeffs) {
  const bq = new Biquad(coeffs);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = bq.process(x[i]);
  return out;
}

/** One-pole lowpass state object — cheap, phase-gentle, great for damping. */
function onePole(cutoffHz) {
  const a = 1 - Math.exp((-TWO_PI * cutoffHz) / SR);
  let y = 0;
  return (x) => {
    y += a * (x - y);
    return y;
  };
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
 * Raised-cosine rise over `ms` — THE anti-click primitive of this file.
 * Both the value and its first derivative start at exactly zero, so a layer
 * fading in through this can never produce a sample-level step. A linear
 * ramp (the old code's `i / attack`) has a non-zero slope at t=0 and that
 * corner is audible as a tick on a quiet sound.
 */
function rcRise(ms) {
  const n = Math.max(1, Math.round((ms / 1000) * SR));
  return (i) => (i >= n ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * i) / n));
}

/** Raised-cosine fall over `ms`, measured backwards from `total`. */
function rcFall(ms, total) {
  const n = Math.max(1, Math.round((ms / 1000) * SR));
  return (i) => {
    const left = total - 1 - i;
    return left >= n ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * left) / n);
  };
}

/**
 * The workhorse envelope: raised-cosine attack, exponential-ish decay to a
 * sustain floor, power-curve release, and a guaranteed raised-cosine tail
 * fade so the layer always lands on exact silence.
 *
 * Returns a function of sample index (not seconds) — layers are rendered
 * sample-by-sample and this keeps the call sites tight.
 */
function envelope({ dur, attackMs = 8, decayMs, sustain = 0, releaseMs, curve = 1.6 }) {
  const n = Math.round(dur * SR);
  const rise = rcRise(attackMs);
  const decayMsR = decayMs ?? dur * 700;
  const releaseMsR = releaseMs ?? dur * 350;
  const dN = Math.max(1, Math.round((decayMsR / 1000) * SR));
  const relN = Math.max(1, Math.round((releaseMsR / 1000) * SR));
  const relStart = Math.max(0, n - relN);
  const fall = rcFall(Math.max(6, releaseMsR * 0.25), n);
  // Level the decay has reached by the time the release takes over.
  const atRelease = sustain + (1 - sustain) * Math.pow(1 - Math.min(1, relStart / dN), curve);
  return (i) => {
    if (i < 0 || i >= n) return 0;
    let body;
    if (i < relStart) {
      const d = Math.min(1, i / dN);
      body = sustain + (1 - sustain) * Math.pow(1 - d, curve);
    } else {
      const u = (i - relStart) / relN;
      body = atRelease * Math.pow(1 - clamp01(u), curve);
    }
    return rise(i) * body * fall(i);
  };
}

/** Soft tanh saturation, normalized so drive only shapes, not boosts. */
const softSat = (x, drive = 1.5) => Math.tanh(x * drive) / Math.tanh(drive);

/* ═══════════════════════════ buffer arithmetic ═══════════════════════════ */

const buf = (n) => new Float64Array(Math.max(1, Math.round(n)));

/** Add `src` into `dest` at sample `at`, scaled by `gain`. */
function mixInto(dest, src, at = 0, gain = 1) {
  const start = Math.max(0, Math.round(at));
  for (let i = 0; i < src.length; i++) {
    const j = start + i;
    if (j >= dest.length) break;
    dest[j] += src[i] * gain;
  }
  return dest;
}

/** Sum any number of same-or-different-length layers into one buffer. */
function layer(...parts) {
  let n = 0;
  for (const p of parts) n = Math.max(n, p.length);
  const out = buf(n);
  for (const p of parts) mixInto(out, p);
  return out;
}

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > p) p = v; }
  return p;
}

/** Scale a buffer so its peak is exactly `target` (no-op when silent). */
function normalizeTo(x, target) {
  const p = peakOf(x);
  if (!(p > 0)) return x;
  const g = target / p;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/* ═══════════════════════════════ reverb (FDN) ═══════════════════════════════ */

/**
 * A short, dark, diffuse room. Four Schroeder allpasses smear the input into
 * a dense wash, then four damped feedback combs (mutually prime delays) grow
 * the tail, then two more allpasses break up any remaining flutter. Every
 * comb loop carries a one-pole lowpass, which is what makes the tail get
 * DARKER as it decays — the single most important cue for "warm room" rather
 * than "spring reverb on a toy".
 *
 * `size` scales all delay times; `damp` is the loop lowpass in Hz.
 */
function makeRoom({ size = 1, feedback = 0.72, damp = 2400, diffusion = 0.62 }) {
  const apDelays = [13.7, 19.3, 27.1, 35.9].map((ms) => Math.max(1, Math.round((ms * size / 1000) * SR)));
  const outApDelays = [7.3, 11.9].map((ms) => Math.max(1, Math.round((ms * size / 1000) * SR)));
  const combDelays = [41.3, 47.9, 55.1, 63.7].map((ms) => Math.max(1, Math.round((ms * size / 1000) * SR)));

  const aps = apDelays.map((d) => ({ b: new Float64Array(d), i: 0, d }));
  const outAps = outApDelays.map((d) => ({ b: new Float64Array(d), i: 0, d }));
  const combs = combDelays.map((d) => ({ b: new Float64Array(d), i: 0, d, lp: onePole(damp) }));

  const allpass = (st, x, g) => {
    const delayed = st.b[st.i];
    const v = x + delayed * -g;
    st.b[st.i] = v;
    st.i = (st.i + 1) % st.d;
    return delayed + v * g;
  };

  return (x) => {
    let s = x;
    for (const ap of aps) s = allpass(ap, s, diffusion);
    let acc = 0;
    for (const c of combs) {
      const delayed = c.b[c.i];
      c.b[c.i] = s + c.lp(delayed) * feedback;
      c.i = (c.i + 1) % c.d;
      acc += delayed;
    }
    let y = acc / combs.length;
    for (const ap of outAps) y = allpass(ap, y, 0.5);
    return y;
  };
}

/**
 * Convolve a one-shot with the room and append `tailMs` of decay.
 * The wet path is lowpassed twice (once in every comb loop, once here) so
 * the ambience never adds top end back on top of a carefully darkened dry
 * signal — the tail should be felt, not heard as hiss.
 */
function addRoom(x, {
  tailMs = 220,
  wet = 0.22,
  size = 1,
  feedback,
  damp = 2200,
  wetLowpassHz = 2600,
  predelayMs = 6,
} = {}) {
  const tail = Math.round((tailMs / 1000) * SR);
  const pre = Math.round((predelayMs / 1000) * SR);
  const n = x.length + tail;
  // Pick the comb feedback so the tail is ~45 dB down by the time the buffer
  // ends: a short room genuinely decays inside its tail instead of being
  // chopped off by the final fade.
  const avgDelayMs = 52 * size;
  const passes = Math.max(1.2, tailMs / avgDelayMs);
  const fb = feedback ?? Math.min(0.85, Math.pow(Math.pow(10, -45 / 20), 1 / passes));
  const room = makeRoom({ size, feedback: fb, damp });
  const lid = new Biquad(lowpassCoeffs(wetLowpassHz, 0.7));
  const cut = new Biquad(highpassCoeffs(120, 0.7)); // keep mud out of the tail
  const out = buf(n);
  for (let i = 0; i < n; i++) {
    const src = i - pre >= 0 && i - pre < x.length ? x[i - pre] : 0;
    out[i] = lid.process(cut.process(room(src)));
  }
  // Fade the very end of the wet so the appended tail lands on true silence.
  const fadeN = Math.min(tail, Math.round(0.04 * SR));
  for (let i = 0; i < fadeN; i++) {
    out[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeN);
  }
  // Level the wet against the dry peak, then mix. Scaling by the dry peak
  // (rather than a fixed gain) keeps the wet/dry ratio identical for a loud
  // thump and a whisper-quiet hover tick.
  const wetPeak = peakOf(out);
  const dryPeak = peakOf(x);
  const g = wetPeak > 0 && dryPeak > 0 ? (dryPeak / wetPeak) * wet : 0;
  for (let i = 0; i < n; i++) out[i] *= g;
  for (let i = 0; i < x.length; i++) out[i] += x[i];
  return out;
}

/**
 * Reverb for a seamless LOOP: run the room over three concatenated copies
 * and keep the middle one, so the tail that leaves the end has already
 * arrived at the start. Appending a tail (addRoom) would break the seam.
 */
function addRoomLooped(x, opts = {}) {
  const { wet = 0.16, size = 1, feedback = 0.68, damp = 2000, wetLowpassHz = 2200 } = opts;
  const n = x.length;
  const room = makeRoom({ size, feedback, damp });
  const lid = new Biquad(lowpassCoeffs(wetLowpassHz, 0.7));
  const cut = new Biquad(highpassCoeffs(120, 0.7));
  const wetBuf = buf(n);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      const y = lid.process(cut.process(room(x[i])));
      if (pass === 2) wetBuf[i] = y;
    }
  }
  const wetPeak = peakOf(wetBuf);
  const dryPeak = peakOf(x);
  const g = wetPeak > 0 && dryPeak > 0 ? (dryPeak / wetPeak) * wet : 0;
  const out = buf(n);
  for (let i = 0; i < n; i++) out[i] = x[i] + wetBuf[i] * g;
  return out;
}

/* ═════════════════════════ dynamics & the warm bus ═════════════════════════ */

/**
 * Gentle feed-forward compressor with a soft knee. Not for loudness — for
 * EVENNESS: it shaves the one transient in a texture that would otherwise
 * poke out and make the whole sound feel spiky. 2.4:1, slow-ish attack so
 * the character of the hit survives, long release so it never pumps.
 */
function compress(x, {
  thresholdDb = -24,
  ratio = 2.4,
  attackMs = 14,
  releaseMs = 260,
  kneeDb = 12,
} = {}) {
  const atk = Math.exp(-1 / ((attackMs / 1000) * SR));
  const rel = Math.exp(-1 / ((releaseMs / 1000) * SR));
  const out = buf(x.length);
  // Start at unity gain reduction. Starting at -120 dB (the obvious-looking
  // "silence" initial value) makes the release ramp the whole sound UP from
  // nothing over the first few hundred ms — a reverse envelope on every hit.
  let envDb = 0;
  for (let i = 0; i < x.length; i++) {
    const level = Math.abs(x[i]);
    const inDb = 20 * Math.log10(Math.max(level, 1e-7));
    // Soft-knee static curve.
    let overDb = inDb - thresholdDb;
    let grDb;
    if (overDb < -kneeDb / 2) grDb = 0;
    else if (overDb > kneeDb / 2) grDb = overDb * (1 / ratio - 1);
    else {
      const k = overDb + kneeDb / 2;
      grDb = ((1 / ratio - 1) * k * k) / (2 * kneeDb);
    }
    // Smooth the gain reduction, not the level (cleaner, no zipper).
    const coeff = grDb < envDb ? atk : rel;
    envDb = grDb + (envDb - grDb) * coeff;
    out[i] = x[i] * Math.pow(10, envDb / 20);
  }
  return out;
}

/**
 * The warm bus every sound is voiced through. In order:
 *   low shelf lift  — body and weight, so nothing feels papery-thin
 *   presence dip    — scoops 2.8-3.2 kHz, exactly where "cheap and harsh"
 *                     lives; the ear's most sensitive band
 *   high shelf cut  — pulls the whole top down
 *   lowpass lid     — a hard ceiling on brightness
 *   soft saturation — rounds any remaining edges into harmonics
 *
 * `bright` (0..1) scales how much top survives; ambience beds run darker
 * than interaction sounds so the room never competes with the interface.
 */
function warmBus(x, {
  lowShelfHz = 200,
  lowShelfDb = 2.2,
  presenceHz = 3000,
  presenceDb = -4.5,
  presenceQ = 1.1,
  highShelfHz = 3400,
  highShelfDb = -8,
  lidHz = 6000,
  bright = 1,
  drive = 1.25,
} = {}) {
  let y = filterBuffer(x, lowshelfCoeffs(lowShelfHz, lowShelfDb));
  y = filterBuffer(y, peakingCoeffs(presenceHz, presenceDb, presenceQ));
  y = filterBuffer(y, highshelfCoeffs(highShelfHz, highShelfDb * (2 - bright)));
  y = filterBuffer(y, lowpassCoeffs(lidHz * bright, 0.7));
  for (let i = 0; i < y.length; i++) y[i] = softSat(y[i], drive);
  return y;
}

/**
 * Finish an interaction sound: compress → warm EQ → room → gentle limit.
 * Every one-shot below ends with a call to this, which is what makes the
 * whole set sound like one family recorded in one place.
 */
function voice(x, {
  compressor = {},
  eq = {},
  room = {},
  limitDrive = 1.15,
} = {}) {
  // Normalize into the compressor so its threshold means the same thing for
  // every sound, however loudly its layers happened to sum. masterize()
  // sets the real output level at the very end.
  const staged = Float64Array.from(x);
  normalizeTo(staged, 0.5);
  let y = compress(staged, compressor);
  y = warmBus(y, eq);
  y = addRoom(y, room);
  for (let i = 0; i < y.length; i++) y[i] = softSat(y[i], limitDrive);
  return y;
}

/* ═══════════════════════ loop / DC / master / WAV ═══════════════════════ */

/**
 * Make a buffer loop seamlessly: equal-power crossfade of the final
 * fadeSamples into the head, trimming the buffer by fadeSamples.
 */
function crossfadeLoop(x, fadeSamples) {
  const n = x.length - fadeSamples;
  if (n <= 0) throw new Error('crossfadeLoop: fade longer than buffer');
  const out = buf(n);
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
  const out = buf(x.length);
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] - px + R * py;
    px = x[i]; py = y;
    out[i] = y;
  }
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length;
  for (let i = 0; i < out.length; i++) out[i] -= mean;
  return out;
}

/**
 * Master chain: DC removal, raised-cosine edge fades (generous by default —
 * 10 ms in, 40 ms out, so nothing ever starts or stops abruptly), then
 * peak-normalize to peakDb dBFS.
 */
function masterize(x, { peakDb = -8, fadeInMs = 10, fadeOutMs = 40 } = {}) {
  const y = dcBlock(x);
  const fi = Math.max(Math.round((fadeInMs / 1000) * SR), Math.round(0.004 * SR));
  const fo = Math.max(Math.round((fadeOutMs / 1000) * SR), Math.round(0.004 * SR));
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
  const b = Buffer.alloc(44 + dataBytes);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2);
  writeFileSync(path, b);
}

/* ═══════════════════════════ reusable sound bricks ═══════════════════════════ */

/**
 * A sine "body" with an exponential pitch glide and a soft envelope.
 * The foundation layer under every thump, pop, blip and tick — it is what
 * gives a sound a PITCH, and pitch is what makes a sound feel intentional
 * rather than like a burst of noise.
 */
function tone({ dur, f0, f1 = f0, attackMs = 7, decayMs, curve = 1.9, partials = [[1, 1]], phase0 = 0, lowpassHz = null, drift = 0, driftHz = 0.9, rng = null }) {
  const n = Math.round(dur * SR);
  const out = buf(n);
  const env = envelope({ dur, attackMs, decayMs: decayMs ?? dur * 800, curve, releaseMs: dur * 400 });
  const phases = partials.map(() => phase0);
  // Subtle slow pitch wobble (a few tenths of a percent) — the organic
  // imperfection that keeps a sustained note from sounding like a test tone.
  const wobble = drift > 0 ? makeSlowNoise(rng ?? mulberry32(97), driftHz) : null;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = expInterp(f0, f1, u) * (wobble === null ? 1 : 1 + drift * wobble());
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      const [ratio, amp] = partials[k];
      phases[k] += (TWO_PI * f * ratio) / SR;
      s += Math.sin(phases[k]) * amp;
    }
    out[i] = s * env(i);
  }
  return lowpassHz === null ? out : filterBuffer(out, lowpassCoeffs(lowpassHz, 0.7));
}

/**
 * A noise "air" bed shaped by a moving bandpass. The workhorse for anything
 * that moves through air: page swishes, friction slides, camera whooshes.
 * `sweep` gets normalized time and returns the centre frequency, so callers
 * can rise, fall or arc without extra plumbing.
 */
function airBand({ dur, rng, sweep, q = 0.9, source = 'pink', attackMs = 14, releaseMs, shape = null, lowpassHz = 4200 }) {
  const n = Math.round(dur * SR);
  const out = buf(n);
  const gen = source === 'brown' ? makeBrown(rng) : source === 'white' ? () => white(rng) : makePink(rng);
  const bp = new Biquad(bandpassCoeffs(sweep(0), q));
  const env = envelope({ dur, attackMs, releaseMs: releaseMs ?? dur * 450, curve: 1.4 });
  for (let i = 0; i < n; i++) {
    const u = i / n;
    bp.set(bandpassCoeffs(sweep(u), q));
    const amp = shape === null ? env(i) : shape(u) * rcRise(attackMs)(i) * rcFall(Math.max(8, dur * 200), n)(i);
    out[i] = bp.process(gen() * 2.2) * amp;
  }
  return filterBuffer(out, lowpassCoeffs(lowpassHz, 0.7));
}

/**
 * A single paper fibre letting go: a few milliseconds of noise rung through
 * a resonant bandpass. Unlike the old version this uses a raised-cosine
 * window (not a linear ramp squared), so a dense field of them reads as
 * texture instead of a handful of tiny clicks.
 */
function fibre(rng, { lenMs, freq, q, amp }) {
  const n = Math.max(2, Math.round((lenMs / 1000) * SR));
  const out = buf(n);
  const bp = new Biquad(bandpassCoeffs(freq, q));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    // Asymmetric raised cosine: quick-but-smooth in, longer out.
    const w = u < 0.22 ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.22) : Math.pow(1 - (u - 0.22) / 0.78, 1.8);
    out[i] = bp.process(white(rng)) * w * amp;
  }
  return out;
}

/** Scatter `count` fibres across a buffer using the caller's placement rule. */
function fibreField(dest, rng, { count, at, lenMs, freq, q, amp }) {
  for (let k = 0; k < count; k++) {
    const u = k / Math.max(1, count - 1);
    mixInto(dest, fibre(rng, {
      lenMs: lenMs(u, rng),
      freq: freq(u, rng),
      q: q(u, rng),
      amp: amp(u, rng),
    }), at(u, rng) * SR);
  }
  return dest;
}

/**
 * A soft felt/leather thump: pitched-down sine, a pat of dark noise, and a
 * short woody resonance. Three layers where the old code had two, and every
 * one of them opens on a raised cosine.
 */
function thump(rng, { dur, f0, f1, amp = 1, noiseAmp = 0.28, woodHz = 0, woodAmp = 0.18 }) {
  const n = Math.round(dur * SR);
  const body = tone({ dur, f0, f1, attackMs: 6, decayMs: dur * 700, curve: 2.1 });
  const patN = Math.round(Math.min(dur, 0.05) * SR);
  const pat = buf(patN);
  const lp = new Biquad(lowpassCoeffs(520, 0.8));
  const patEnv = envelope({ dur: patN / SR, attackMs: 4, decayMs: (patN / SR) * 650, curve: 2.4 });
  for (let i = 0; i < patN; i++) pat[i] = lp.process(white(rng)) * patEnv(i) * noiseAmp;
  const parts = [body, pat];
  if (woodHz > 0) {
    const wood = buf(n);
    const bpw = new Biquad(bandpassCoeffs(woodHz, 3.2));
    const wEnv = envelope({ dur, attackMs: 5, decayMs: dur * 450, curve: 2.6 });
    for (let i = 0; i < n; i++) wood[i] = bpw.process(white(rng)) * wEnv(i) * woodAmp;
    parts.push(wood);
  }
  const out = layer(...parts);
  for (let i = 0; i < out.length; i++) out[i] *= amp;
  return out;
}

/* ═══════════════════════════════ the sounds ═══════════════════════════════ */
/*
 * Every render function below returns a raw float buffer. The build loop
 * masterizes and writes it. Each is documented with its layer stack so the
 * next person can see, without listening, what is meant to be in there.
 */

/**
 * page-flip — a sheet of paper arcing over.
 *
 * LAYERS
 *   1 air swish   pink noise through a bandpass falling ~2400 → 700 Hz
 *                 (was 5600 → 2050: that top octave is the harshness)
 *   2 body        brown noise under a 700 Hz lowpass — the sheet's mass
 *   3 fibres      a sparse field of soft crinkles, 500-1500 Hz
 *   4 settle      a low 90 → 62 Hz contact tone where the page lands
 *   5 room        180 ms dark tail
 */
function pageFlip({ dur, fStart, fEnd, q, fibres, seed, settle = 1 }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);

  const swish = airBand({
    dur, rng, q,
    sweep: (u) => expInterp(fStart, fEnd, smoothstep(u)),
    attackMs: 16,
    shape: (u) => Math.pow(u, 0.55) * Math.pow(1 - u, 1.15),
    lowpassHz: 5400,
  });

  const body = airBand({
    dur, rng, q: 0.55, source: 'brown',
    sweep: (u) => expInterp(fStart * 0.28, fEnd * 0.34, u),
    attackMs: 20,
    shape: (u) => Math.pow(u, 0.4) * Math.pow(1 - u, 0.9) * 0.85,
    lowpassHz: 1400,
  });

  const grain = buf(n);
  fibreField(grain, rng, {
    count: fibres,
    at: (u, r) => (0.1 + 0.62 * u + r() * 0.06) * dur,
    lenMs: (_, r) => between(r, 4, 9),
    freq: (u, r) => between(r, 900, 2600) * (1 - 0.3 * u),
    q: (_, r) => between(r, 2.4, 4.2),
    amp: (u, r) => between(r, 0.07, 0.15) * (1 - 0.4 * u),
  });

  const contact = tone({
    dur: Math.min(0.12, dur * 0.6), f0: 92, f1: 62,
    attackMs: 9, decayMs: 62, curve: 2.2,
    partials: [[1, 1], [2, 0.18]],
    lowpassHz: 420,
  });

  const dry = layer(swish, body, grain);
  mixInto(dry, contact, (dur - 0.1) * SR, 0.42 * settle);

  return voice(dry, {
    compressor: { thresholdDb: -26, ratio: 2.6, attackMs: 12, releaseMs: 200 },
    eq: { highShelfDb: -5.5, lidHz: 7200, presenceDb: -4, lowShelfDb: 2.6 },
    room: { tailMs: 150, wet: 0.2, size: 0.8, damp: 2400, wetLowpassHz: 2800 },
  });
}

/**
 * book-pull — a volume sliding out of a tight row of neighbours.
 *
 * LAYERS
 *   1 friction    pink noise through a bandpass rising 170 → 560 Hz
 *   2 stick-slip  slow-noise AM on the friction, gentle (0.78 + 0.22)
 *   3 leather     a soft 330 Hz resonance breathing under it
 *   4 release     the moment it clears the shelf — a short air puff
 *   5 landing     felt thump, 112 → 62 Hz, with woody 210 Hz resonance
 *   6 room        260 ms tail
 */
function bookPull({ seed, dur, fLo, fHi, grip, thumpAmp }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);

  const wobble = makeSlowNoise(rng, 18);
  const pink = makePink(rng);
  const friction = buf(n);
  const bp = new Biquad(bandpassCoeffs(fLo, 0.85));
  const fEnv = envelope({ dur, attackMs: 26, decayMs: dur * 700, sustain: 0.62, releaseMs: dur * 420, curve: 1.3 });
  for (let i = 0; i < n; i++) {
    const u = i / n;
    bp.set(bandpassCoeffs(expInterp(fLo, fHi, Math.pow(u, 0.8)), 0.85));
    const slip = 1 - grip + grip * (0.5 + 0.5 * wobble());
    friction[i] = bp.process(pink() * 2.1) * fEnv(i) * slip;
  }

  const leather = buf(n);
  const bpL = new Biquad(bandpassCoeffs(330, 2.4));
  const lDrift = makeSlowNoise(rng, 7);
  const lEnv = envelope({ dur, attackMs: 40, decayMs: dur * 800, sustain: 0.5, releaseMs: dur * 500, curve: 1.2 });
  for (let i = 0; i < n; i++) {
    bpL.set(bandpassCoeffs(330 * (1 + 0.1 * lDrift()), 2.4));
    leather[i] = bpL.process(white(rng)) * lEnv(i) * 0.22;
  }

  const puff = airBand({
    dur: dur * 0.42, rng, q: 0.7, source: 'pink',
    sweep: (u) => expInterp(420, 900, u),
    attackMs: 18,
    shape: (u) => Math.pow(hann(u), 1.4) * 0.5,
    lowpassHz: 2400,
  });

  const land = thump(rng, {
    dur: 0.16, f0: 112, f1: 62, amp: thumpAmp, noiseAmp: 0.3, woodHz: 210, woodAmp: 0.16,
  });

  const dry = layer(friction, leather);
  mixInto(dry, puff, dur * 0.42 * SR);
  mixInto(dry, land, (dur - 0.15) * SR);

  return voice(dry, {
    compressor: { thresholdDb: -24, ratio: 2.4, attackMs: 18, releaseMs: 280 },
    eq: { highShelfDb: -8, lidHz: 5000, lowShelfDb: 2.8 },
    room: { tailMs: 260, wet: 0.22, size: 1, damp: 1800, wetLowpassHz: 2000 },
  });
}

/**
 * book-return — the pull run backwards: contact first, friction settling.
 *
 * LAYERS
 *   1 arrival     a soft felt thump as the spine meets the shelf
 *   2 friction    bandpass falling 560 → 190 Hz as it slides home
 *   3 neighbours  a quiet second thump — the books either side closing up
 *   4 settle      low 84 Hz body under the last third
 *   5 room        280 ms tail
 */
function bookReturn({ seed, dur, fHi, fLo, thumpAmp }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);

  const arrive = thump(rng, {
    dur: 0.14, f0: 104, f1: 64, amp: thumpAmp, noiseAmp: 0.26, woodHz: 190, woodAmp: 0.14,
  });

  const pink = makePink(rng);
  const wobble = makeSlowNoise(rng, 15);
  const friction = buf(n);
  const bp = new Biquad(bandpassCoeffs(fHi, 0.8));
  const fEnv = envelope({ dur, attackMs: 22, decayMs: dur * 320, sustain: 0.35, releaseMs: dur * 560, curve: 1.5 });
  for (let i = 0; i < n; i++) {
    const u = i / n;
    bp.set(bandpassCoeffs(expInterp(fHi, fLo, smoothstep(u)), 0.8));
    friction[i] = bp.process(pink() * 2) * fEnv(i) * (0.76 + 0.24 * (0.5 + 0.5 * wobble()));
  }

  const neighbour = thump(rng, { dur: 0.1, f0: 88, f1: 58, amp: thumpAmp * 0.34, noiseAmp: 0.2 });
  const settle = tone({ dur: dur * 0.5, f0: 84, f1: 66, attackMs: 24, decayMs: dur * 400, curve: 1.8, lowpassHz: 300 });

  const dry = layer(friction);
  mixInto(dry, arrive, 0.008 * SR);
  mixInto(dry, neighbour, dur * 0.55 * SR);
  mixInto(dry, settle, dur * 0.45 * SR, 0.3);

  return voice(dry, {
    compressor: { thresholdDb: -24, ratio: 2.4, attackMs: 16, releaseMs: 300 },
    eq: { highShelfDb: -8.5, lidHz: 4800, lowShelfDb: 3 },
    room: { tailMs: 280, wet: 0.24, size: 1, damp: 1700, wetLowpassHz: 1900 },
  });
}

/**
 * shelf-whoosh — the camera gliding to another floor. Should be felt more
 * than heard: this is the quietest thing in the set by 12 dB.
 *
 * LAYERS
 *   1 air         brown noise, lowpass arcing 190 → 520 → 190 Hz
 *   2 sheen       a whisper of pink noise up around 900 Hz
 *   3 mass        a 62 → 44 Hz sub swell so the move has weight
 *   4 room        320 ms very dark tail
 */
function shelfWhoosh({ seed, dur, peakHz }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);

  const brown = makeBrown(rng);
  const air = buf(n);
  const lp = new Biquad(lowpassCoeffs(190, 0.8));
  const arc = (u) => expInterp(190, peakHz, Math.sin(Math.PI * u));
  const aEnv = envelope({ dur, attackMs: 60, decayMs: dur * 500, sustain: 0.8, releaseMs: dur * 480, curve: 1.2 });
  for (let i = 0; i < n; i++) {
    const u = i / n;
    lp.set(lowpassCoeffs(arc(u), 0.8));
    air[i] = lp.process(brown() * 2.4) * Math.pow(hann(u), 1.1) * aEnv(i) * 1.4;
  }

  const sheen = airBand({
    dur, rng, q: 0.6, source: 'pink',
    sweep: (u) => expInterp(620, 1050, Math.sin(Math.PI * u)),
    attackMs: 70,
    shape: (u) => Math.pow(hann(u), 1.6) * 0.16,
    lowpassHz: 1800,
  });

  const mass = tone({ dur, f0: 62, f1: 44, attackMs: 80, decayMs: dur * 600, curve: 1.3, lowpassHz: 180 });
  for (let i = 0; i < mass.length; i++) mass[i] *= hann(i / mass.length) * 0.5;

  const dry = layer(air, sheen, mass);

  return voice(dry, {
    compressor: { thresholdDb: -28, ratio: 2, attackMs: 30, releaseMs: 400 },
    eq: { highShelfDb: -11, lidHz: 3200, lowShelfDb: 2, presenceDb: -5 },
    room: { tailMs: 240, wet: 0.26, size: 1.2, damp: 1300, wetLowpassHz: 1500 },
  });
}

/**
 * pop-soft — a panel or menu opening. A wooden drawer knob, not a bubble.
 *
 * LAYERS
 *   1 body        sine gliding 300 → 205 Hz with a soft 2nd partial
 *   2 wood        a 1.5x overtone with its own faster decay
 *   3 transient   6 ms of 900 Hz-lowpassed noise, raised-cosine both ends
 *   4 breath      a tiny air puff around 700 Hz
 *   5 room        200 ms tail
 */
function popSoft({ seed, dur, f0, f1 }) {
  const rng = mulberry32(seed);

  const body = tone({
    dur, f0, f1, attackMs: 9, decayMs: dur * 700, curve: 2,
    partials: [[1, 1], [2, 0.16], [3, 0.05]],
    lowpassHz: 1600,
  });

  const wood = tone({
    dur: dur * 0.55, f0: f0 * 1.5, f1: f1 * 1.5, attackMs: 7, decayMs: dur * 330, curve: 2.6,
    lowpassHz: 2200,
  });

  const tN = Math.round(0.008 * SR);
  const trans = buf(tN);
  const tlp = new Biquad(lowpassCoeffs(900, 0.9));
  const tEnv = envelope({ dur: tN / SR, attackMs: 3.2, decayMs: 5.5, curve: 2.2 });
  for (let i = 0; i < tN; i++) trans[i] = tlp.process(white(rng)) * tEnv(i) * 0.3;

  const breath = airBand({
    dur: dur * 0.6, rng, q: 0.8, source: 'pink',
    sweep: (u) => expInterp(760, 520, u),
    attackMs: 10,
    shape: (u) => Math.pow(1 - u, 2.2) * 0.2,
    lowpassHz: 2000,
  });

  const dry = layer(body, breath);
  mixInto(dry, wood, 0, 0.3);
  mixInto(dry, trans, 0);

  return voice(dry, {
    compressor: { thresholdDb: -22, ratio: 2.2, attackMs: 10, releaseMs: 180 },
    eq: { highShelfDb: -6.5, lidHz: 6200, lowShelfDb: 2.4, presenceDb: -4 },
    room: { tailMs: 180, wet: 0.2, size: 0.85, damp: 2300, wetLowpassHz: 2600 },
  });
}

/**
 * tick-hover — the softest thing in the app. A fingertip on paper.
 *
 * LAYERS
 *   1 touch       bandpass noise around 780 Hz, Q 1.1 (was 1900 Hz, Q 4 —
 *                 that resonance was the "cheap UI beep" character)
 *   2 pitch       a barely-there 380 Hz sine so it has a note, not a hiss
 *   3 room        120 ms tail; even this gets air
 */
function tickHover({ seed, dur, freq, toneHz }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);

  const touch = buf(n);
  const bp = new Biquad(bandpassCoeffs(freq, 1.1));
  const env = envelope({ dur, attackMs: 6.5, decayMs: dur * 700, curve: 2.2, releaseMs: dur * 400 });
  for (let i = 0; i < n; i++) touch[i] = bp.process(white(rng)) * env(i);

  const pitch = tone({ dur: dur * 0.8, f0: toneHz, f1: toneHz * 0.9, attackMs: 6, decayMs: dur * 500, curve: 2.4, lowpassHz: 1200 });

  const dry = layer(touch);
  mixInto(dry, pitch, 0, 0.3);

  return voice(dry, {
    compressor: { thresholdDb: -30, ratio: 1.8, attackMs: 8, releaseMs: 140 },
    eq: { highShelfDb: -8, lidHz: 4600, lowShelfDb: 1.8 },
    room: { tailMs: 60, wet: 0.18, size: 0.4, damp: 2000, wetLowpassHz: 2000 },
  });
}

/**
 * check-done — ticking something off. A warm two-note resolve, not a chirp.
 *
 * LAYERS
 *   1 note A      523 Hz marimba-ish body (sine + 2nd + 3rd partial)
 *   2 note B      a perfect fifth above, 90 ms later — the "done" cadence
 *   3 pencil      two soft strokes bandpassed 620-1200 Hz (was 1350-2900)
 *   4 mallet      a felt tap of dark noise under note A's onset
 *   5 room        400 ms tail so the pair rings together
 */
function checkDone({ seed, dur, root, gapMs, strokeAmp }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);

  const mk = (f, len) => tone({
    dur: len, f0: f, f1: f * 0.998, attackMs: 10, decayMs: len * 820, curve: 2.1,
    partials: [[1, 1], [2, 0.22], [3, 0.07], [4.2, 0.03]],
    lowpassHz: 3200, drift: 0.003, driftHz: 0.8, rng,
  });

  const noteA = mk(root, dur * 0.62);
  const noteB = mk(root * 1.5, dur * 0.66);

  const strokeN = Math.round(0.16 * SR);
  const pencil = buf(strokeN);
  const bp = new Biquad(bandpassCoeffs(620, 1.6));
  const grain = makeSlowNoise(rng, 45);
  for (let i = 0; i < strokeN; i++) {
    const u = i / strokeN;
    bp.set(bandpassCoeffs(expInterp(620, 1180, u), 1.6));
    const strokes = bump(u, 0.26, 0.16) + 0.75 * bump(u, 0.68, 0.18);
    pencil[i] = bp.process(white(rng)) * strokes * (0.6 + 0.4 * Math.abs(grain())) * strokeAmp;
  }

  const malletN = Math.round(0.012 * SR);
  const mallet = buf(malletN);
  const mlp = new Biquad(lowpassCoeffs(700, 0.8));
  const mEnv = envelope({ dur: malletN / SR, attackMs: 3, decayMs: 8, curve: 2.4 });
  for (let i = 0; i < malletN; i++) mallet[i] = mlp.process(white(rng)) * mEnv(i) * 0.2;

  const dry = buf(n);
  mixInto(dry, pencil, 0);
  mixInto(dry, noteA, 0.03 * SR, 0.9);
  mixInto(dry, mallet, 0.03 * SR);
  mixInto(dry, noteB, (0.03 + gapMs / 1000) * SR, 0.62);

  return voice(dry, {
    compressor: { thresholdDb: -24, ratio: 2.4, attackMs: 14, releaseMs: 260 },
    eq: { highShelfDb: -6, lidHz: 6600, lowShelfDb: 1.8, presenceDb: -4 },
    room: { tailMs: 400, wet: 0.24, size: 1.1, damp: 2600, wetLowpassHz: 3000 },
  });
}

/**
 * crumple-delete — a page balled up and dropped. Should feel soft and final,
 * not like static.
 *
 * LAYERS
 *   1 bed         brown noise under a 460 Hz lowpass, decaying
 *   2 fibres      a Poisson field, rate 48 → 10/s, 350-1500 Hz (was up to
 *                 3400 Hz — that band is what made it sound like frying)
 *   3 grip        a low 96 Hz squeeze at the very start
 *   4 drop        a soft 78 Hz landing at the two-thirds mark
 *   5 room        300 ms tail
 */
function crumpleDelete({ seed, dur, rate0, rate1, fHi }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);

  const brown = makeBrown(rng);
  const bed = buf(n);
  const lp = new Biquad(lowpassCoeffs(1150, 0.75));
  const bEnv = envelope({ dur, attackMs: 12, decayMs: dur * 420, curve: 1.5, releaseMs: dur * 500 });
  for (let i = 0; i < n; i++) bed[i] = lp.process(brown() * 2) * bEnv(i) * 0.22;

  let t = 0.01;
  while (t < dur - 0.06) {
    const u = t / dur;
    const rate = rate0 + (rate1 - rate0) * u;
    mixInto(bed, fibre(rng, {
      lenMs: between(rng, 5, 12),
      freq: Math.max(620, fHi - (fHi - 720) * u + (rng() - 0.5) * 520),
      q: between(rng, 2.6, 4.6),
      amp: between(rng, 0.14, 0.3) * (1 - 0.5 * u),
    }), t * SR);
    t += -Math.log(1 - rng()) / rate;
  }

  const grip = tone({ dur: 0.14, f0: 96, f1: 70, attackMs: 10, decayMs: 90, curve: 2, lowpassHz: 320 });
  const drop = thump(rng, { dur: 0.16, f0: 78, f1: 54, amp: 0.28, noiseAmp: 0.26, woodHz: 260, woodAmp: 0.14 });

  mixInto(bed, grip, 0.005 * SR, 0.2);
  mixInto(bed, drop, dur * 0.62 * SR);

  return voice(bed, {
    compressor: { thresholdDb: -26, ratio: 2.8, attackMs: 12, releaseMs: 240 },
    eq: { highShelfDb: -6, lidHz: 7000, lowShelfDb: 2.2, presenceDb: -4.5 },
    room: { tailMs: 280, wet: 0.22, size: 1, damp: 2300, wetLowpassHz: 2700 },
  });
}

/**
 * drop-thump — a book landing on felt.
 *
 * LAYERS
 *   1 body        sine 104 → 56 Hz, the impact's pitch
 *   2 sub         an octave below at low level — weight you feel
 *   3 felt        25 ms of 480 Hz-lowpassed noise, the pad
 *   4 wood        a 205 Hz resonance, the shelf answering
 *   5 room        260 ms tail
 */
function dropThump({ seed, dur, f0, f1, woodHz }) {
  const rng = mulberry32(seed);

  const body = tone({ dur, f0, f1, attackMs: 6, decayMs: dur * 700, curve: 2.2, partials: [[1, 1], [2, 0.12]], lowpassHz: 900 });
  const sub = tone({ dur: dur * 1.05, f0: f0 * 0.5, f1: f1 * 0.5, attackMs: 10, decayMs: dur * 820, curve: 1.8, lowpassHz: 160 });

  const feltN = Math.round(0.028 * SR);
  const felt = buf(feltN);
  const flp = new Biquad(lowpassCoeffs(480, 0.85));
  const fEnv = envelope({ dur: feltN / SR, attackMs: 3.5, decayMs: 18, curve: 2.4 });
  for (let i = 0; i < feltN; i++) felt[i] = flp.process(white(rng)) * fEnv(i) * 0.4;

  const woodN = Math.round(dur * 0.8 * SR);
  const wood = buf(woodN);
  const bpw = new Biquad(bandpassCoeffs(woodHz, 3));
  const wEnv = envelope({ dur: woodN / SR, attackMs: 5, decayMs: dur * 450, curve: 2.6 });
  for (let i = 0; i < woodN; i++) wood[i] = bpw.process(white(rng)) * wEnv(i) * 0.2;

  const dry = layer(body, felt, wood);
  mixInto(dry, sub, 0, 0.34);

  return voice(dry, {
    compressor: { thresholdDb: -20, ratio: 2.6, attackMs: 10, releaseMs: 220 },
    eq: { highShelfDb: -9, lidHz: 4200, lowShelfDb: 3.2 },
    room: { tailMs: 260, wet: 0.2, size: 1, damp: 1600, wetLowpassHz: 1700 },
  });
}

/**
 * pencil-scratch — the 200 ms seamless writing-texture loop.
 *
 * LAYERS
 *   1 graphite    bandpass around 820 Hz, drifting (was 1900 Hz — a full
 *                 octave lower is the whole difference between "pencil"
 *                 and "sandpaper")
 *   2 tooth       a quieter 1500 Hz band for the paper's grain
 *   3 desk        a brown-noise bed under 300 Hz so it has a floor
 *   4 room        looped reverb (wrap-around, so the seam survives)
 */
function pencilScratch() {
  const rng = mulberry32(1212);
  const genDur = 0.24;
  const fade = Math.round(0.04 * SR);
  const n = Math.round(genDur * SR);

  const out = buf(n);
  const bp = new Biquad(bandpassCoeffs(820, 1.3));
  const tooth = new Biquad(bandpassCoeffs(1500, 2.2));
  const desk = new Biquad(lowpassCoeffs(300, 0.8));
  const brown = makeBrown(rng);
  const drift = makeSlowNoise(rng, 6);
  const strokes = makeSlowNoise(rng, 11);
  for (let i = 0; i < n; i++) {
    bp.set(bandpassCoeffs(820 + 190 * drift(), 1.3));
    const w = white(rng);
    const amp = 0.55 + 0.45 * (0.5 + 0.5 * strokes());
    out[i] = (bp.process(w) + tooth.process(w) * 0.16 + desk.process(brown() * 1.4) * 0.5) * amp;
  }

  const warm = warmBus(out, { highShelfHz: 2600, highShelfDb: -9, lidHz: 3600, lowShelfDb: 2.4, presenceDb: -5 });
  const roomed = addRoomLooped(warm, { wet: 0.14, size: 0.7, damp: 1600, wetLowpassHz: 1700 });
  return crossfadeLoop(roomed, fade);
}

/**
 * confetti — a small celebration. Paper, not plastic.
 *
 * LAYERS
 *   1 pops        ~22 soft sine blips, 340-1150 Hz (was 650-2400), each
 *                 with its own raised-cosine attack and pitch droop. Kept
 *                 under ~1.5 kHz with weak upper partials: a pop whose
 *                 fundamental slews at a quarter of full scale per sample
 *                 is a click wearing a party hat.
 *   2 flutter     bandpassed noise around 950 Hz, gently AM'd
 *   3 lift        a rising airy swell under the first half
 *   4 bed         brown noise below 320 Hz so it has a floor
 *   5 room        380 ms tail — the biggest room in the set
 */
function confetti({ seed, dur, pops, fLo, fHi }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);
  const out = buf(n);

  for (let k = 0; k < pops; k++) {
    const t0 = Math.pow(rng(), 1.5) * (dur - 0.14);
    const f = between(rng, fLo, fHi);
    const len = between(rng, 0.06, 0.13);
    const amp = between(rng, 0.14, 0.3) * (1 - 0.35 * (t0 / dur));
    mixInto(out, tone({
      dur: len, f0: f, f1: f * 0.78, attackMs: between(rng, 8, 14),
      decayMs: len * 780, curve: 2.2,
      partials: [[1, 1], [2, 0.13], [3, 0.04]],
      lowpassHz: 2300,
    }), t0 * SR, amp);
    mixInto(out, fibre(rng, { lenMs: 7, freq: f * 1.15, q: 2.4, amp: amp * 0.1 }), t0 * SR);
  }

  const flutterBp = new Biquad(bandpassCoeffs(1150, 1));
  const flutterDrift = makeSlowNoise(rng, 3);
  const flutter = buf(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = i / n;
    const mod = 0.55 + 0.45 * Math.sin(TWO_PI * 7 * t + flutterDrift() * 2.2);
    flutter[i] = flutterBp.process(white(rng)) * mod * Math.pow(hann(u), 1.3) * 0.11;
  }

  const lift = airBand({
    dur: dur * 0.55, rng, q: 0.7, source: 'pink',
    sweep: (u) => expInterp(320, 780, u),
    attackMs: 30,
    shape: (u) => Math.pow(hann(u), 1.5) * 0.2,
    lowpassHz: 1800,
  });

  const brown = makeBrown(rng);
  const bedLp = new Biquad(lowpassCoeffs(320, 0.8));
  const bed = buf(n);
  for (let i = 0; i < n; i++) bed[i] = bedLp.process(brown() * 1.8) * Math.pow(hann(i / n), 1.2) * 0.18;

  const dry = layer(out, flutter, bed);
  mixInto(dry, lift, 0.02 * SR);

  return voice(dry, {
    compressor: { thresholdDb: -26, ratio: 3, attackMs: 12, releaseMs: 280 },
    eq: { highShelfDb: -6, lidHz: 6800, lowShelfDb: 2, presenceDb: -4 },
    room: { tailMs: 340, wet: 0.26, size: 1.2, damp: 2400, wetLowpassHz: 2800 },
  });
}

/**
 * typing-tick — a pencil meeting paper, once.
 *
 * LAYERS
 *   1 tap         bandpass 560-960 Hz (was 1320-1750), Q per variant
 *   2 desk        a ~150-215 Hz wooden body under it
 *   3 graphite    8 ms of 1300 Hz-lowpassed grain
 *   4 room        110 ms tail
 *
 * Six variants that are genuinely different pencils — soft HB, a sharp
 * clickier point, a long wooden drag, a light tap, a deep soft stroke and
 * a brisk flick — because a keystroke every 80 ms makes near-copies
 * obvious within a sentence.
 */
function typingTick({ seed, dur, freq, deskHz, q = 1.4, attackMs = 6, decayK = 650, deskGain = 0.45, grainAmp = 0.3 }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);

  const tap = buf(n);
  const bp = new Biquad(bandpassCoeffs(freq, q));
  const env = envelope({ dur, attackMs, decayMs: dur * decayK, curve: 2.3, releaseMs: dur * 400 });
  for (let i = 0; i < n; i++) tap[i] = bp.process(white(rng)) * env(i);

  const desk = tone({ dur: dur * 0.7, f0: deskHz, f1: deskHz * 0.7, attackMs: 5.5, decayMs: dur * 450, curve: 2.4, lowpassHz: 600 });

  const grainN = Math.round(0.008 * SR);
  const grain = buf(grainN);
  const glp = new Biquad(lowpassCoeffs(1300, 0.9));
  const gEnv = envelope({ dur: grainN / SR, attackMs: 2.8, decayMs: 5.5, curve: 2.4 });
  for (let i = 0; i < grainN; i++) grain[i] = glp.process(white(rng)) * gEnv(i) * grainAmp;

  const dry = layer(tap, grain);
  mixInto(dry, desk, 0, deskGain);

  return voice(dry, {
    compressor: { thresholdDb: -26, ratio: 2.2, attackMs: 8, releaseMs: 160 },
    eq: { highShelfDb: -8, lidHz: 4600, lowShelfDb: 2.6 },
    room: { tailMs: 55, wet: 0.16, size: 0.4, damp: 1900, wetLowpassHz: 2000 },
  });
}

/**
 * chime-hour — one warm tube-bell note at the top of the hour.
 *
 * LAYERS
 *   1 fundamental  a felt-struck bell partial set, lower modes ringing
 *                  longest, upper modes pulled well down from the old set
 *   2 detuned twin +0.3% on the fundamental — the slow warm beating that
 *                  makes a bell sound like metal rather than a sine
 *   3 hum          an octave below, the longest decay of all
 *   4 hammer       20 ms of 620 Hz-lowpassed felt (was 1400 Hz and 12 ms)
 *   5 room         1.1 s dark hall — the biggest space in the app
 */
function chimeHour({ seed, dur, f0, brightness }) {
  const rng = mulberry32(seed);
  const n = Math.round(dur * SR);
  const out = buf(n);

  const partials = [
    { r: 1, a: 1.0, tau: 2.9 },
    { r: 1.003, a: 0.58, tau: 3.3 },
    { r: 0.5, a: 0.26, tau: 3.9 },
    { r: 2.0, a: 0.2 * brightness, tau: 1.5 },
    { r: 2.76, a: 0.24 * brightness, tau: 1.15 },
    { r: 5.4, a: 0.07 * brightness, tau: 0.4 },
    { r: 8.93, a: 0.025 * brightness, tau: 0.18 },
  ];
  const phases = partials.map(() => rng() * TWO_PI);
  const rise = rcRise(9);
  const fall = rcFall(dur * 260, n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      const p = partials[k];
      phases[k] += (TWO_PI * f0 * p.r) / SR;
      s += Math.sin(phases[k]) * p.a * Math.exp(-t / p.tau);
    }
    out[i] = s * rise(i) * fall(i) * 0.24;
  }

  const hammerN = Math.round(0.02 * SR);
  const hammer = buf(hammerN);
  const hlp = new Biquad(lowpassCoeffs(620, 0.8));
  const hEnv = envelope({ dur: hammerN / SR, attackMs: 4, decayMs: 13, curve: 2.4 });
  for (let i = 0; i < hammerN; i++) hammer[i] = hlp.process(white(rng)) * hEnv(i) * 0.11;
  mixInto(out, hammer, 0);

  return voice(out, {
    compressor: { thresholdDb: -26, ratio: 2, attackMs: 24, releaseMs: 500 },
    eq: { highShelfDb: -9, lidHz: 4200, lowShelfDb: 1.8, presenceDb: -4 },
    room: { tailMs: 1100, wet: 0.3, size: 1.6, damp: 1600, wetLowpassHz: 1900, predelayMs: 18 },
  });
}

/* ───────────────────────────── ambience beds ───────────────────────────── */

/**
 * ambient-library — 8 s seamless warm room tone.
 *
 * LAYERS
 *   1 room tone   brown noise under a 260 Hz lowpass with a tidal swell
 *   2 building    a very low 52 Hz hum, the bones of an old house
 *   3 rustles     two distant page turns, heavily reverbed (= far away)
 *   4 clock       a soft pendulum tick every ~2.7 s, almost subliminal
 *   5 room        wrap-around reverb over the whole bed
 */
function ambientLibrary() {
  const rng = mulberry32(101010);
  const genDur = 9;
  const n = Math.round(genDur * SR);
  const out = buf(n);

  const brown = makeBrown(rng);
  const lp = new Biquad(lowpassCoeffs(260, 0.7));
  const swell = makeSlowNoise(rng, 0.13);
  for (let i = 0; i < n; i++) {
    out[i] = lp.process(brown()) * Math.pow(10, (swell() * 0.9) / 20);
  }

  // A 52 Hz hum. 52 x 8 s = 416 whole cycles, so it is exactly periodic on
  // the finished loop and the crossfade seam cannot beat against itself.
  for (let i = 0; i < n; i++) {
    out[i] += Math.sin((TWO_PI * 52 * i) / SR) * 0.06;
  }

  for (const [at, seed] of [[2.8, 11], [6.0, 22]]) {
    const rr = mulberry32(seed);
    const rDur = 0.34;
    const rustle = airBand({
      dur: rDur, rng: rr, q: 1.1, source: 'pink',
      sweep: (u) => expInterp(1200, 620, u),
      attackMs: 24,
      shape: (u) => Math.pow(hann(u), 1.4),
      lowpassHz: 2000,
    });
    const wet = addRoom(rustle, { tailMs: 600, wet: 0.85, size: 1.6, feedback: 0.78, damp: 1200, wetLowpassHz: 1400 });
    const start = Math.round(at * SR);
    let bedRms = 0;
    for (let i = start; i < start + Math.round(rDur * SR) && i < n; i++) bedRms += out[i] * out[i];
    bedRms = Math.sqrt(bedRms / Math.round(rDur * SR));
    const g = (bedRms * 2.6) / Math.max(peakOf(wet), 1e-9);
    mixInto(out, wet, start, g);
  }

  // Pendulum: a soft wooden tick, spaced so the last one clears the seam.
  for (let k = 0; k < 3; k++) {
    const at = 0.9 + k * 2.7;
    const tick = layer(
      tone({ dur: 0.05, f0: 240, f1: 170, attackMs: 5, decayMs: 30, curve: 2.4, lowpassHz: 700 }),
    );
    mixInto(out, addRoom(tick, { tailMs: 400, wet: 0.6, size: 1.4, damp: 1300 }), at * SR, 0.035);
  }

  const warm = warmBus(out, { highShelfHz: 2200, highShelfDb: -11, lidHz: 2600, lowShelfDb: 2.2, presenceDb: -5, bright: 0.9 });
  return crossfadeLoop(addRoomLooped(warm, { wet: 0.16, size: 1.5, damp: 1200, wetLowpassHz: 1400 }), SR);
}

/**
 * ambient-rain — 8 s seamless rain against a window.
 *
 * LAYERS
 *   1 hush        pink noise under a 420 Hz lowpass (was 640), slow swell
 *   2 far rain    a second, darker bed at half level for depth
 *   3 droplets    Poisson ticks at ~9/s, 500-1700 Hz (was 1500-4700 —
 *                 that band is what made it hiss rather than patter)
 *   4 runnels     occasional low gurgles down the glass
 *   5 room        wrap-around reverb
 */
function ambientRain() {
  const rng = mulberry32(424242);
  const genDur = 9;
  const n = Math.round(genDur * SR);
  const out = buf(n);

  const pink = makePink(rng);
  const lp = new Biquad(lowpassCoeffs(420, 0.7));
  const hp = new Biquad(highpassCoeffs(70, 0.7));
  const swell = makeSlowNoise(rng, 0.15);
  for (let i = 0; i < n; i++) {
    out[i] = hp.process(lp.process(pink() * 1.9)) * Math.pow(10, (swell() * 0.8) / 20);
  }

  const far = makeBrown(rng);
  const farLp = new Biquad(lowpassCoeffs(190, 0.7));
  for (let i = 0; i < n; i++) out[i] += farLp.process(far() * 1.6) * 0.45;

  let t = 0;
  while (t < genDur) {
    mixInto(out, fibre(rng, {
      lenMs: between(rng, 7, 18),
      freq: between(rng, 500, 1700),
      q: between(rng, 2.5, 5),
      amp: (0.07 + 0.15 * Math.pow(rng(), 1.6)),
    }), t * SR);
    t += -Math.log(1 - rng()) / 9;
  }

  let g = 0.4;
  while (g < genDur) {
    mixInto(out, airBand({
      dur: between(rng, 0.18, 0.4), rng, q: 1.2, source: 'brown',
      sweep: (u) => expInterp(240, 140, u),
      attackMs: 40,
      shape: (u) => Math.pow(hann(u), 1.5) * 0.5,
      lowpassHz: 700,
    }), g * SR, 0.3);
    g += between(rng, 1.1, 2.4);
  }

  const warm = warmBus(out, { highShelfHz: 2000, highShelfDb: -11, lidHz: 2600, lowShelfDb: 2, presenceDb: -5, bright: 0.9 });
  return crossfadeLoop(addRoomLooped(warm, { wet: 0.14, size: 1.2, damp: 1300, wetLowpassHz: 1500 }), SR);
}

/**
 * ambient-fireplace — 8 s seamless hearth.
 *
 * LAYERS
 *   1 ember bed   brown noise under 230 Hz, breathing slowly
 *   2 draw        a filtered air-draw up the chimney, very slow AM
 *   3 crackles    Poisson bursts of 1-3 sub-ticks, 480-1900 Hz (was up to
 *                 5000 — the old set spat)
 *   4 settling    occasional low 260 → 120 Hz log pops
 *   5 room        wrap-around reverb
 */
function ambientFireplace() {
  const rng = mulberry32(515151);
  const genDur = 9;
  const n = Math.round(genDur * SR);
  const out = buf(n);

  const brown = makeBrown(rng);
  const lp = new Biquad(lowpassCoeffs(230, 0.7));
  const swell = makeSlowNoise(rng, 0.2);
  for (let i = 0; i < n; i++) out[i] = lp.process(brown()) * Math.pow(10, (swell() * 1.2) / 20);

  const draw = makePink(rng);
  const drawBp = new Biquad(bandpassCoeffs(300, 0.6));
  const drawMod = makeSlowNoise(rng, 0.35);
  for (let i = 0; i < n; i++) out[i] += drawBp.process(draw() * 1.5) * (0.5 + 0.5 * drawMod()) * 0.28;

  let t = 0;
  while (t < genDur) {
    const subs = 1 + Math.floor(rng() * 3);
    let st = t;
    for (let k = 0; k < subs; k++) {
      mixInto(out, fibre(rng, {
        lenMs: between(rng, 4, 11),
        freq: between(rng, 480, 1900),
        q: between(rng, 2.2, 4.5),
        amp: 0.1 + 0.28 * Math.pow(rng(), 2),
      }), st * SR);
      st += between(rng, 0.006, 0.03);
    }
    if (rng() < 0.18) {
      mixInto(out, thump(rng, { dur: 0.1, f0: 260, f1: 120, amp: 0.16, noiseAmp: 0.18 }), t * SR);
    }
    t += -Math.log(1 - rng()) / 4.2;
  }

  const warm = warmBus(out, { highShelfHz: 1900, highShelfDb: -12, lidHz: 2400, lowShelfDb: 2.4, presenceDb: -5.5, bright: 0.9 });
  return crossfadeLoop(addRoomLooped(warm, { wet: 0.15, size: 1.1, damp: 1200, wetLowpassHz: 1400 }), SR);
}

/**
 * ambient-crickets — 8 s seamless summer night.
 *
 * LAYERS
 *   1 night air   pink noise under 300 Hz, rich enough to carry the bed
 *   2 chorus      three cricket voices at ~2.0-2.4 kHz (was 3.9-4.4 kHz —
 *                 the band that made the old set hiss — then 2.6-3.1 kHz,
 *                 whose carrier slew still measured a 35% adjacent-sample
 *                 step; at 44.1 kHz a sine's per-sample slew is 2πfA, so
 *                 calm crickets are LOW crickets sitting inside the air)
 *   3 far chorus  a fourth voice drowned in reverb, one field away
 *   4 breeze      a slow filtered swell moving through the grass
 *   5 room        wrap-around reverb over the whole bed
 */
function ambientCrickets() {
  const rng = mulberry32(616161);
  const genDur = 9;
  const n = Math.round(genDur * SR);
  const out = buf(n);

  // The night air is the LOUDEST layer, not a whisper: the chirps read as
  // events inside a warm room tone rather than needles on top of silence.
  const pink = makePink(rng);
  const lp = new Biquad(lowpassCoeffs(300, 0.7));
  const swell = makeSlowNoise(rng, 0.18);
  for (let i = 0; i < n; i++) out[i] = lp.process(pink() * 1.6) * Math.pow(10, (swell() * 0.7) / 20) * 0.52;

  const breeze = makeBrown(rng);
  const bLp = new Biquad(lowpassCoeffs(420, 0.7));
  const bMod = makeSlowNoise(rng, 0.22);
  for (let i = 0; i < n; i++) out[i] += bLp.process(breeze() * 1.4) * (0.4 + 0.6 * Math.abs(bMod())) * 0.36;

  const voices = [
    { f: 2060, pulse: 36, gapMin: 0.4, gapMax: 0.95, amp: 0.3, seed: 11, far: false },
    { f: 2230, pulse: 42, gapMin: 0.5, gapMax: 1.15, amp: 0.23, seed: 22, far: false },
    { f: 2380, pulse: 33, gapMin: 0.6, gapMax: 1.4, amp: 0.15, seed: 33, far: false },
    { f: 2160, pulse: 39, gapMin: 0.9, gapMax: 2.0, amp: 0.36, seed: 44, far: true },
  ];
  for (const v of voices) {
    const vr = mulberry32(v.seed);
    const dest = v.far ? buf(n) : out;
    let t = vr() * 0.6;
    while (t < genDur) {
      const syllables = 6 + Math.floor(vr() * 7);
      const chirpLen = syllables / v.pulse;
      const start = Math.round(t * SR);
      const len = Math.round(chirpLen * SR);
      const f = v.f * (0.985 + vr() * 0.03);
      let phase = vr() * TWO_PI;
      for (let i = 0; i < len && start + i < n; i++) {
        const tt = i / SR;
        const u = i / len;
        // Softer syllable window (^1.45) — the pulse onsets round off, so
        // each chirp sings instead of pecking.
        const syl = Math.pow(hann((tt * v.pulse) % 1), 1.45);
        phase += (TWO_PI * f) / SR;
        dest[start + i] += Math.sin(phase) * syl * Math.pow(hann(u), 1.2) * v.amp;
      }
      t += chirpLen + v.gapMin + vr() * (v.gapMax - v.gapMin);
    }
    if (v.far) {
      const wet = addRoomLooped(dest, { wet: 1.6, size: 1.8, feedback: 0.8, damp: 900, wetLowpassHz: 1100 });
      for (let i = 0; i < n; i++) out[i] += (wet[i] - dest[i]) * 0.5;
    }
  }

  // Round the chorus itself before the bus: what little top the sines have
  // left is not detail anyone misses, and it keeps the bed un-hissy.
  const rounded = filterBuffer(out, lowpassCoeffs(2700, 0.7));
  const warm = warmBus(rounded, { highShelfHz: 3400, highShelfDb: -8, lidHz: 4800, lowShelfDb: 2, presenceDb: -4, bright: 0.95 });
  return crossfadeLoop(addRoomLooped(warm, { wet: 0.16, size: 1.4, damp: 2000, wetLowpassHz: 2600 }), SR);
}

/* ═══════════════════════════════ the manifest ═══════════════════════════════ */
/*
 * `weight` tags each variant for the engine's sound-character presets:
 *   plain — shorter, fewer decorative layers; what `minimal` plays
 *   full  — the longest, most textured take; what `rich` leans on
 * `calm` (the default) draws from the whole pool.
 *
 * The first entry of every family keeps the ORIGINAL file name, so every
 * existing call site (`play('book-pull')`, `page-flip-1`, …) still resolves.
 */

const SOUNDS = [
  /* page turns — 6 variants -------------------------------------------- */
  { name: 'page-flip-1', peakDb: -9, weight: 'plain', render: () => pageFlip({ dur: 0.18, fStart: 3400, fEnd: 980, q: 0.85, fibres: 5, seed: 101 }) },
  { name: 'page-flip-2', peakDb: -9, weight: 'full', render: () => pageFlip({ dur: 0.23, fStart: 3700, fEnd: 1060, q: 0.95, fibres: 7, seed: 202 }) },
  { name: 'page-flip-3', peakDb: -9.5, weight: 'plain', render: () => pageFlip({ dur: 0.16, fStart: 3100, fEnd: 900, q: 0.8, fibres: 4, seed: 303 }) },
  { name: 'page-flip-4', peakDb: -9, weight: 'full', render: () => pageFlip({ dur: 0.21, fStart: 3550, fEnd: 1010, q: 0.9, fibres: 8, seed: 404 }) },
  { name: 'page-flip-5', peakDb: -9.5, weight: 'plain', render: () => pageFlip({ dur: 0.19, fStart: 3250, fEnd: 950, q: 0.88, fibres: 6, seed: 505, settle: 0.7 }) },
  { name: 'page-flip-6', peakDb: -9, weight: 'full', render: () => pageFlip({ dur: 0.25, fStart: 3850, fEnd: 1120, q: 1, fibres: 9, seed: 606 }) },

  /* pulling a book out — 4 variants ------------------------------------ */
  { name: 'book-pull', peakDb: -8, weight: 'plain', render: () => bookPull({ seed: 4242, dur: 0.42, fLo: 170, fHi: 560, grip: 0.3, thumpAmp: 0.85 }) },
  { name: 'book-pull-2', peakDb: -8, weight: 'full', render: () => bookPull({ seed: 4243, dur: 0.5, fLo: 155, fHi: 610, grip: 0.4, thumpAmp: 0.95 }) },
  { name: 'book-pull-3', peakDb: -8.5, weight: 'plain', render: () => bookPull({ seed: 4244, dur: 0.38, fLo: 190, fHi: 520, grip: 0.24, thumpAmp: 0.7 }) },
  { name: 'book-pull-4', peakDb: -8, weight: 'full', render: () => bookPull({ seed: 4245, dur: 0.47, fLo: 165, fHi: 590, grip: 0.36, thumpAmp: 0.9 }) },

  /* putting one back — 4 variants -------------------------------------- */
  { name: 'book-return', peakDb: -10, weight: 'plain', render: () => bookReturn({ seed: 2424, dur: 0.4, fHi: 560, fLo: 190, thumpAmp: 0.6 }) },
  { name: 'book-return-2', peakDb: -10, weight: 'full', render: () => bookReturn({ seed: 2425, dur: 0.48, fHi: 610, fLo: 175, thumpAmp: 0.7 }) },
  { name: 'book-return-3', peakDb: -10.5, weight: 'plain', render: () => bookReturn({ seed: 2426, dur: 0.36, fHi: 520, fLo: 205, thumpAmp: 0.5 }) },
  { name: 'book-return-4', peakDb: -10, weight: 'full', render: () => bookReturn({ seed: 2427, dur: 0.45, fHi: 590, fLo: 185, thumpAmp: 0.66 }) },

  /* camera moves — 3 variants, all whisper-quiet ------------------------ */
  { name: 'shelf-whoosh', peakDb: -20, weight: 'plain', render: () => shelfWhoosh({ seed: 7001, dur: 0.42, peakHz: 520 }) },
  { name: 'shelf-whoosh-2', peakDb: -20, weight: 'full', render: () => shelfWhoosh({ seed: 7002, dur: 0.52, peakHz: 580 }) },
  { name: 'shelf-whoosh-3', peakDb: -20.5, weight: 'plain', render: () => shelfWhoosh({ seed: 7003, dur: 0.37, peakHz: 470 }) },

  /* menus and panels — 5 variants --------------------------------------- */
  { name: 'pop-soft', peakDb: -11, weight: 'plain', render: () => popSoft({ seed: 880, dur: 0.16, f0: 300, f1: 205 }) },
  { name: 'pop-soft-2', peakDb: -11, weight: 'full', render: () => popSoft({ seed: 881, dur: 0.19, f0: 285, f1: 192 }) },
  { name: 'pop-soft-3', peakDb: -11.5, weight: 'plain', render: () => popSoft({ seed: 882, dur: 0.14, f0: 322, f1: 220 }) },
  { name: 'pop-soft-4', peakDb: -11, weight: 'full', render: () => popSoft({ seed: 883, dur: 0.18, f0: 268, f1: 184 }) },
  { name: 'pop-soft-5', peakDb: -11.5, weight: 'plain', render: () => popSoft({ seed: 884, dur: 0.15, f0: 340, f1: 232 }) },

  /* hover — 5 variants, the quietest family ----------------------------- */
  { name: 'tick-hover', peakDb: -26, weight: 'plain', render: () => tickHover({ seed: 31, dur: 0.09, freq: 780, toneHz: 380 }) },
  { name: 'tick-hover-2', peakDb: -26, weight: 'full', render: () => tickHover({ seed: 32, dur: 0.11, freq: 720, toneHz: 350 }) },
  { name: 'tick-hover-3', peakDb: -26.5, weight: 'plain', render: () => tickHover({ seed: 33, dur: 0.08, freq: 840, toneHz: 410 }) },
  { name: 'tick-hover-4', peakDb: -26, weight: 'full', render: () => tickHover({ seed: 34, dur: 0.1, freq: 760, toneHz: 365 }) },
  { name: 'tick-hover-5', peakDb: -26.5, weight: 'plain', render: () => tickHover({ seed: 35, dur: 0.085, freq: 810, toneHz: 395 }) },

  /* ticking a box — 4 variants ------------------------------------------ */
  { name: 'check-done', peakDb: -9, weight: 'plain', render: () => checkDone({ seed: 5150, dur: 0.55, root: 523.25, gapMs: 95, strokeAmp: 0.22 }) },
  { name: 'check-done-2', peakDb: -9, weight: 'full', render: () => checkDone({ seed: 5151, dur: 0.62, root: 493.88, gapMs: 110, strokeAmp: 0.26 }) },
  { name: 'check-done-3', peakDb: -9.5, weight: 'plain', render: () => checkDone({ seed: 5152, dur: 0.5, root: 587.33, gapMs: 85, strokeAmp: 0.18 }) },
  { name: 'check-done-4', peakDb: -9, weight: 'full', render: () => checkDone({ seed: 5153, dur: 0.6, root: 554.37, gapMs: 102, strokeAmp: 0.24 }) },

  /* deleting — 4 variants ------------------------------------------------ */
  { name: 'crumple-delete', peakDb: -10, weight: 'plain', render: () => crumpleDelete({ seed: 6666, dur: 0.5, rate0: 48, rate1: 10, fHi: 2600 }) },
  { name: 'crumple-delete-2', peakDb: -10, weight: 'full', render: () => crumpleDelete({ seed: 6667, dur: 0.58, rate0: 56, rate1: 12, fHi: 2850 }) },
  { name: 'crumple-delete-3', peakDb: -10.5, weight: 'plain', render: () => crumpleDelete({ seed: 6668, dur: 0.44, rate0: 42, rate1: 9, fHi: 2400 }) },
  { name: 'crumple-delete-4', peakDb: -10, weight: 'full', render: () => crumpleDelete({ seed: 6669, dur: 0.55, rate0: 52, rate1: 11, fHi: 2720 }) },

  /* landing — 4 variants ------------------------------------------------- */
  { name: 'drop-thump', peakDb: -8, weight: 'plain', render: () => dropThump({ seed: 808, dur: 0.3, f0: 104, f1: 56, woodHz: 205 }) },
  { name: 'drop-thump-2', peakDb: -8, weight: 'full', render: () => dropThump({ seed: 809, dur: 0.36, f0: 96, f1: 52, woodHz: 190 }) },
  { name: 'drop-thump-3', peakDb: -8.5, weight: 'plain', render: () => dropThump({ seed: 810, dur: 0.27, f0: 112, f1: 60, woodHz: 220 }) },
  { name: 'drop-thump-4', peakDb: -8, weight: 'full', render: () => dropThump({ seed: 811, dur: 0.34, f0: 100, f1: 54, woodHz: 198 }) },

  /* the writing loop ------------------------------------------------------ */
  { name: 'pencil-scratch', peakDb: -18, weight: 'plain', fadeInMs: 5, fadeOutMs: 5, render: pencilScratch },

  /* celebration — 3 variants ---------------------------------------------- */
  { name: 'confetti', peakDb: -11, weight: 'plain', render: () => confetti({ seed: 9999, dur: 0.6, pops: 20, fLo: 450, fHi: 1500 }) },
  { name: 'confetti-2', peakDb: -11, weight: 'full', render: () => confetti({ seed: 9998, dur: 0.72, pops: 26, fLo: 420, fHi: 1480 }) },
  { name: 'confetti-3', peakDb: -11.5, weight: 'plain', render: () => confetti({ seed: 9997, dur: 0.54, pops: 16, fLo: 480, fHi: 1400 }) },

  /* ambience beds --------------------------------------------------------- */
  { name: 'ambient-library', peakDb: -19, weight: 'full', fadeInMs: 5, fadeOutMs: 5, render: ambientLibrary },
  { name: 'ambient-rain', peakDb: -19, weight: 'full', fadeInMs: 5, fadeOutMs: 5, render: ambientRain },
  { name: 'ambient-fireplace', peakDb: -19, weight: 'full', fadeInMs: 5, fadeOutMs: 5, render: ambientFireplace },
  { name: 'ambient-crickets', peakDb: -21, weight: 'full', fadeInMs: 5, fadeOutMs: 5, render: ambientCrickets },

  /* keystrokes — 6 variants ------------------------------------------------ */
  { name: 'typing-tick-1', peakDb: -20, weight: 'plain', fadeOutMs: 12, render: () => typingTick({ seed: 71, dur: 0.088, freq: 680, deskHz: 145, q: 1.5, attackMs: 6, decayK: 500, deskGain: 0.28, grainAmp: 0.26 }) },
  { name: 'typing-tick-2', peakDb: -20, weight: 'plain', fadeOutMs: 12, render: () => typingTick({ seed: 72, dur: 0.082, freq: 900, deskHz: 205, q: 1.2, attackMs: 5.5, decayK: 620, grainAmp: 0.34, deskGain: 0.3 }) },
  { name: 'typing-tick-3', peakDb: -20, weight: 'full', fadeOutMs: 12, render: () => typingTick({ seed: 73, dur: 0.11, freq: 540, deskHz: 165, q: 1.6, attackMs: 7, decayK: 800, grainAmp: 0.24, deskGain: 0.58 }) },
  { name: 'typing-tick-4', peakDb: -20.5, weight: 'plain', fadeOutMs: 12, render: () => typingTick({ seed: 74, dur: 0.08, freq: 790, deskHz: 185, q: 1.1, attackMs: 5.5, decayK: 540, grainAmp: 0.3, deskGain: 0.26 }) },
  { name: 'typing-tick-5', peakDb: -20, weight: 'full', fadeOutMs: 12, render: () => typingTick({ seed: 75, dur: 0.106, freq: 610, deskHz: 222, q: 1.7, attackMs: 7.5, decayK: 820, grainAmp: 0.22, deskGain: 0.6 }) },
  { name: 'typing-tick-6', peakDb: -20.5, weight: 'plain', fadeOutMs: 12, render: () => typingTick({ seed: 76, dur: 0.076, freq: 1000, deskHz: 240, q: 1.0, attackMs: 5, decayK: 580, grainAmp: 0.36, deskGain: 0.3 }) },

  /* the hour — 3 variants --------------------------------------------------- */
  { name: 'chime-hour', peakDb: -14, weight: 'full', fadeOutMs: 120, render: () => chimeHour({ seed: 360360, dur: 5, f0: 329.63, brightness: 0.85 }) },
  { name: 'chime-hour-2', peakDb: -14, weight: 'plain', fadeOutMs: 120, render: () => chimeHour({ seed: 360361, dur: 4.6, f0: 293.66, brightness: 0.7 }) },
  { name: 'chime-hour-3', peakDb: -14, weight: 'full', fadeOutMs: 120, render: () => chimeHour({ seed: 360362, dur: 5.2, f0: 349.23, brightness: 0.9 }) },
];

/* ═══════════════════════════════ analysis ═══════════════════════════════ */

/** In-place radix-2 FFT (used only for the report's spectral centroid). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function analyze(pcm) {
  let peak = 0, sum = 0, dc = 0, maxStep = 0, onset = 0;
  const onsetN = Math.min(pcm.length, Math.round(0.0005 * SR));
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
    dc += v;
    if (i > 0) {
      const d = Math.abs(v - pcm[i - 1] / 32768);
      if (d > maxStep) maxStep = d;
    }
    if (i < onsetN && a > onset) onset = a;
  }
  const rms = Math.sqrt(sum / pcm.length);

  // Spectral centroid + share of energy above 4 kHz, Hann-windowed frames.
  const N = 2048;
  let num = 0, den = 0, hf = 0, tot = 0;
  for (let start = 0; start + N <= pcm.length; start += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let e = 0;
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((TWO_PI * i) / N);
      re[i] = (pcm[start + i] / 32768) * w;
      e += re[i] * re[i];
    }
    if (e < 1e-10) continue;
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const f = (k * SR) / N;
      num += f * mag;
      den += mag;
      tot += mag * mag;
      if (f > 4000) hf += mag * mag;
    }
  }

  // Attack: time for a 1 ms envelope follower to reach half its peak.
  const a = 1 - Math.exp(-1 / (0.001 * SR));
  let y = 0, envMax = 0;
  const env = new Float64Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    y += a * (Math.abs(pcm[i] / 32768) - y);
    env[i] = y;
    if (y > envMax) envMax = y;
  }
  let atk = 0;
  for (let i = 0; i < env.length; i++) {
    if (env[i] >= 0.5 * envMax) { atk = (i / SR) * 1000; break; }
  }

  return {
    durationS: pcm.length / SR,
    peakDb: 20 * Math.log10(Math.max(peak, 1e-9)),
    rmsDb: 20 * Math.log10(Math.max(rms, 1e-9)),
    centroid: den > 0 ? num / den : 0,
    hfPct: tot > 0 ? (hf / tot) * 100 : 0,
    attackMs: atk,
    // Click metrics — the same measurements the unit suite gates on.
    stepPct: (maxStep / Math.max(peak, 1e-9)) * 100,
    onsetPct: (onset / Math.max(peak, 1e-9)) * 100,
    dcDb: 20 * Math.log10(Math.max(Math.abs(dc / pcm.length), 1e-9)),
  };
}

/* ═══════════════════════════════ build all ═══════════════════════════════ */

mkdirSync(OUT_DIR, { recursive: true });
const ditherRng = mulberry32(0xd17e);

function padCols([a, b, c, d, e, f, g, h, i, j]) {
  return a.padEnd(24) + b.padStart(9) + c.padStart(10) + d.padStart(9) + e.padStart(11) + f.padStart(8) + g.padStart(9) + h.padStart(8) + i.padStart(8) + j.padStart(8);
}

const reportLines = [
  'Notebook procedural sound report — generated by scripts/gen-sounds.mjs',
  'format: 44100 Hz / 16-bit / mono PCM WAV',
  '',
  'Every sound is 3-6 layered elements (body / transient / texture / air / tail),',
  'each with its own envelope and filter, bussed through a 2.4:1 soft-knee',
  'compressor, a warm EQ (3 kHz presence dip + high shelf cut + lowpass lid)',
  'and a short dark FDN reverb. Attacks are raised-cosine, never linear.',
  '',
  'centroid = spectral centroid (lower = warmer).  >4k = share of energy above',
  '4 kHz (lower = less harsh).  atk = time to half-peak envelope (higher = softer).',
  'step = largest adjacent-sample jump as % of peak (click signature; gate 25%).',
  'onset = loudest sample in the first 0.5 ms as % of peak (gate 4%).',
  'DC = residual DC offset (gate: silence).  A trailing ! marks a gate breach.',
  '',
  padCols(['file', 'duration', 'peak dB', 'RMS dB', 'centroid', '>4kHz', 'attack', 'step', 'onset', 'DC']),
  padCols(['----', '--------', '-------', '------', '--------', '-----', '------', '----', '-----', '--']),
];

const seen = new Set();
for (const s of SOUNDS) {
  if (seen.has(s.name)) throw new Error(`duplicate sound name: ${s.name}`);
  seen.add(s.name);
  const raw = s.render();
  for (let i = 0; i < raw.length; i++) {
    if (!Number.isFinite(raw[i])) throw new Error(`${s.name}: non-finite sample at ${i}`);
  }
  const mastered = masterize(raw, {
    peakDb: s.peakDb,
    fadeInMs: s.fadeInMs ?? 10,
    fadeOutMs: s.fadeOutMs ?? 40,
  });
  const pcm = toPcm16(mastered, ditherRng);
  writeWav(join(OUT_DIR, `${s.name}.wav`), pcm);
  const a = analyze(pcm);
  // The acceptance gates the unit suite enforces — flagged here so a breach
  // is visible at generation time instead of at test time.
  const breaches = [
    a.stepPct > 25 ? `step ${a.stepPct.toFixed(1)}%>25%` : '',
    a.onsetPct > 4 ? `onset ${a.onsetPct.toFixed(1)}%>4%` : '',
    a.dcDb > -60 ? `DC ${a.dcDb.toFixed(1)}dB` : '',
  ].filter(Boolean).join(', ');
  const flag = breaches === '' ? '' : `  !! ${breaches}`;
  reportLines.push(
    padCols([
      `${s.name}.wav`,
      `${a.durationS.toFixed(3)}s`,
      a.peakDb.toFixed(2),
      a.rmsDb.toFixed(2),
      `${Math.round(a.centroid)}Hz`,
      `${a.hfPct.toFixed(1)}%`,
      `${a.attackMs.toFixed(1)}ms`,
      `${a.stepPct.toFixed(1)}%`,
      `${a.onsetPct.toFixed(1)}%`,
      `${a.dcDb.toFixed(0)}dB`,
    ]) + (flag === '' ? '' : ' !'),
  );
  console.log(
    `  ${s.name}.wav  ${a.durationS.toFixed(3)}s  peak ${a.peakDb.toFixed(1)}  ` +
    `centroid ${Math.round(a.centroid)}Hz  >4k ${a.hfPct.toFixed(1)}%  atk ${a.attackMs.toFixed(1)}ms  ` +
    `step ${a.stepPct.toFixed(1)}%  onset ${a.onsetPct.toFixed(2)}%${flag}`,
  );
}
if (reportLines.some((l) => l.endsWith(' !'))) {
  console.log('\nWARNING: gate breaches flagged above — the unit suite will fail on these.');
}

reportLines.push('');
writeFileSync(join(OUT_DIR, 'report.txt'), reportLines.join('\n'));
console.log(`\nWrote ${SOUNDS.length} sounds + report.txt to ${OUT_DIR}`);
