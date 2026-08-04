/**
 * scripts/audit-sounds.mjs — measure every shipped cue, because nobody has heard them.
 *
 * The owner has twice reported a sound by ear and been right both times: the
 * task-complete cue was "like a metal tong", and a wider fault turned cues into
 * "jittery sand paper". The second had nothing to do with the files — it was
 * `engine.ts` setting group gain AFTER `play()`, so every cue started at 1.0 and
 * was yanked down — but the first is a property of the recording, and neither
 * was found by reading code. Every judgement since has been spectral. This is
 * the spectral half done properly, on the bytes that actually ship.
 *
 * It reads the WAVs directly rather than rendering a graph, which is the right
 * call HERE and would be the wrong one for a synth: `scripts/gen-sounds.mjs`
 * has already been run, so the file on disk is what the reader hears, and a
 * hand-copied graph could drift from it.
 *
 * What each number is for is in REPORT below. Nothing here decides whether a
 * cue is PLEASANT — that still needs an ear, and saying so is the point.
 *
 *   node scripts/audit-sounds.mjs
 *   node scripts/audit-sounds.mjs --only=check-done
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { decodeWav } from './wav.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIR = join(ROOT, 'public/sounds');

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);

/* ------------------------------- spectrum -------------------------------- */

/** In-place iterative radix-2 FFT. Real input, complex in/out arrays. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Averaged magnitude spectrum over Hann-windowed frames.
 *
 * Averaged rather than taken from one frame because a cue is a transient: a
 * single window lands wherever it lands, and the brightness of a struck sound
 * measured at its attack is not the brightness anybody hears.
 */
function spectrum(x, sampleRate, size = 2048) {
  const hop = size / 2;
  const bins = new Float64Array(size / 2);
  let frames = 0;
  const win = new Float64Array(size);
  for (let i = 0; i < size; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));

  for (let start = 0; start + size <= x.length; start += hop) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i += 1) re[i] = x[start + i] * win[i];
    fft(re, im);
    for (let k = 0; k < size / 2; k += 1) bins[k] += Math.hypot(re[k], im[k]);
    frames += 1;
  }
  if (frames === 0) return null;
  for (let k = 0; k < bins.length; k += 1) bins[k] /= frames;
  return { bins, hz: (k) => (k * sampleRate) / size };
}

/* ------------------------------- measuring -------------------------------- */

function measure(name, buf) {
  const w = decodeWav(buf);
  const x = w.mono;
  const sr = w.sampleRate;
  const n = x.length;
  const seconds = n / sr;

  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let clipped = 0;
  let maxJump = 0;
  for (let i = 0; i < n; i += 1) {
    const v = x[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped += 1;
    sumSq += v * v;
    sum += v;
    if (i > 0) {
      const d = Math.abs(v - x[i - 1]);
      if (d > maxJump) maxJump = d;
    }
  }
  const rms = Math.sqrt(sumSq / n);
  const dc = sum / n;

  // Attack: first crossing of 90% of peak, and the energy inside the first ms.
  let attackIdx = 0;
  for (let i = 0; i < n; i += 1) {
    if (Math.abs(x[i]) >= peak * 0.9) {
      attackIdx = i;
      break;
    }
  }
  const oneMs = Math.max(1, Math.round(sr / 1000));
  let firstMsPeak = 0;
  for (let i = 0; i < Math.min(oneMs, n); i += 1) firstMsPeak = Math.max(firstMsPeak, Math.abs(x[i]));

  // Tail: energy still present in the last 5 ms. High means chopped.
  const tailLen = Math.min(n, Math.round(sr * 0.005));
  let tailSq = 0;
  for (let i = n - tailLen; i < n; i += 1) tailSq += x[i] * x[i];
  const tailRms = Math.sqrt(tailSq / tailLen);

  const sp = spectrum(x, sr);
  let centroid = 0;
  let hissShare = 0;
  let flatness = 0;
  if (sp) {
    let num = 0;
    let den = 0;
    let hi = 0;
    let all = 0;
    let logSum = 0;
    let linSum = 0;
    for (let k = 1; k < sp.bins.length; k += 1) {
      const m = sp.bins[k];
      const f = sp.hz(k);
      num += f * m;
      den += m;
      all += m;
      if (f > 5000) hi += m;
      logSum += Math.log(m + 1e-12);
      linSum += m;
    }
    centroid = den > 0 ? num / den : 0;
    hissShare = all > 0 ? hi / all : 0;
    const cnt = sp.bins.length - 1;
    flatness = linSum > 0 ? Math.exp(logSum / cnt) / (linSum / cnt) : 0;
  }

  return {
    name,
    seconds,
    sr,
    channels: w.channels,
    bits: w.bits,
    peak,
    clipped,
    rms,
    dc,
    maxJump,
    attackMs: (attackIdx / sr) * 1000,
    onsetRatio: peak > 0 ? firstMsPeak / peak : 0,
    tailRms,
    edgeStart: Math.abs(x[0]),
    edgeEnd: Math.abs(x[n - 1]),
    centroid,
    hissShare,
    flatness,
  };
}

/* -------------------------------- verdicts -------------------------------- */

/**
 * The thresholds, and why each one is where it is.
 *
 * These are deliberately conservative: this run exists to FIND candidates for a
 * human to listen to, not to fail a build. A cue flagged here is a cue worth
 * playing, not a cue proven bad.
 */
const CHECKS = [
  ['clipping', (m) => m.clipped > 0, (m) => `${m.clipped} sample(s) at full scale — audible crunch`],
  ['hot', (m) => m.peak > 0.99, (m) => `peak ${m.peak.toFixed(3)} leaves no headroom for two cues at once`],
  ['dc-offset', (m) => Math.abs(m.dc) > 0.01, (m) => `mean ${m.dc.toFixed(4)} — a DC step thumps on start and stop`],
  ['click-in', (m) => m.edgeStart > 0.02, (m) => `first sample ${m.edgeStart.toFixed(3)} — starts mid-waveform, which ticks`],
  ['click-out', (m) => m.edgeEnd > 0.02, (m) => `last sample ${m.edgeEnd.toFixed(3)} — ends mid-waveform, which ticks`],
  // One-shots only. A LOOPED bed is supposed to still be sounding at its last
  // sample — that is what makes the wrap seamless — so this check fired on
  // ambient-night for doing exactly the right thing. Loops are judged at their
  // seam instead, further down, which is the question that actually applies.
  ['truncated', (m) => !m.name.startsWith('ambient-') && m.tailRms > m.rms * 0.5 && m.tailRms > 0.01, (m) => `tail rms ${m.tailRms.toFixed(4)} vs overall ${m.rms.toFixed(4)} — cut off mid-sound`],
  ['hard-onset', (m) => m.onsetRatio > 0.9 && m.attackMs < 1, (m) => `${(m.onsetRatio * 100).toFixed(0)}% of peak inside 1 ms — no fade in`],
  ['grit', (m) => m.maxJump > 0.5, (m) => `largest sample-to-sample step ${m.maxJump.toFixed(3)} — a discontinuity, the shape of "sand paper"`],
  ['brittle', (m) => m.hissShare > 0.5, (m) => `${(m.hissShare * 100).toFixed(0)}% of energy above 5 kHz — thin and harsh`],
  ['metallic', (m) => m.centroid > 4500 && m.flatness < 0.06, (m) => `centroid ${Math.round(m.centroid)} Hz with flatness ${m.flatness.toFixed(3)} — tonal and very bright, the shape of "metal tong"`],
  ['inaudible', (m) => m.rms < 0.0015, (m) => `rms ${m.rms.toFixed(5)} — will be lost under the room bed`],
];

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.wav'))
  .filter((f) => !only || f.includes(only))
  .sort();

const rows = [];
const flagged = [];
for (const f of files) {
  try {
    const m = measure(f, readFileSync(join(DIR, f)));
    rows.push(m);
    const hits = CHECKS.filter(([, test]) => test(m)).map(([id, , say]) => `${id}: ${say(m)}`);
    if (hits.length) flagged.push({ name: f, hits });
  } catch (e) {
    flagged.push({ name: f, hits: [`unreadable: ${e.message}`] });
  }
}

const pad = (s, w) => String(s).padEnd(w);
const num = (v, d = 3, w = 8) => String(v.toFixed(d)).padStart(w);

console.log(`${files.length} cue(s) in public/sounds/\n`);
const head = (s, w) => String(s).padStart(w);
console.log(
  pad('file', 26) + head('peak', 8) + head('rms', 9) + head('dc', 9) +
    head('jump', 8) + head('cent', 8) + head('hiss', 7) + head('flat', 7) + '  s',
);
for (const m of rows) {
  console.log(
    pad(m.name.replace(/\.wav$/, ''), 26) +
      num(m.peak) + num(m.rms, 4, 9) + num(m.dc, 4, 9) + num(m.maxJump) +
      String(Math.round(m.centroid)).padStart(8) + num(m.hissShare, 2, 7) + num(m.flatness, 3, 7) +
      '  ' + m.seconds.toFixed(2),
  );
}

console.log(`\n--- flagged: ${flagged.length} of ${files.length} ---`);
for (const f of flagged) {
  console.log(`\n${f.name}`);
  for (const h of f.hits) console.log(`   ${h}`);
}
if (!flagged.length) console.log('nothing tripped a threshold.');

/* ------------------------------ the loop seam ----------------------------- */

/**
 * The ambient beds are LOOPED (`SOUNDSCAPE_LOOPS` in src/sound/engine.ts), and a
 * loop is judged at a place no other measurement looks: the joint where its last
 * sample meets its first.
 *
 * Two ways it goes wrong, and they sound different:
 *
 *  - a STEP at the wrap — the waveform jumps, which is a click once per lap. A
 *    fireplace that ticks every eight seconds is the sort of thing a reader
 *    hears for an hour before working out what it is.
 *  - a LEVEL mismatch — the bed is louder at its end than at its start, so it
 *    swells and drops on a fixed cycle. No click, but it breathes, and once
 *    noticed it cannot be unnoticed.
 *
 * The step is measured against the file's OWN largest ordinary sample-to-sample
 * move, not an absolute number: a rain bed is full of big steps and a wind bed
 * is not, so a threshold that suits one is meaningless for the other.
 */
const looped = rows.filter((m) => m.name.startsWith('ambient-'));
if (looped.length) {
  console.log('\n--- loop seams (the ambient beds wrap; everything else is one-shot) ---');
  console.log(pad('file', 22) + head('wrapStep', 10) + head('vs own max', 12) + head('head rms', 10) + head('tail rms', 10) + head('ratio', 8));
  const seamProblems = [];
  for (const m of looped) {
    const w = decodeWav(readFileSync(join(DIR, m.name)));
    const x = w.mono;
    const n = x.length;
    const win = Math.round(w.sampleRate * 0.05); // 50 ms of each end
    const rmsOf = (from, to) => {
      let s = 0;
      for (let i = from; i < to; i += 1) s += x[i] * x[i];
      return Math.sqrt(s / (to - from));
    };
    const headRms = rmsOf(0, win);
    const tailRms = rmsOf(n - win, n);
    const wrapStep = Math.abs(x[0] - x[n - 1]);
    const relative = m.maxJump > 0 ? wrapStep / m.maxJump : 0;
    const ratio = headRms > 0 ? tailRms / headRms : 0;
    console.log(
      pad(m.name.replace(/\.wav$/, ''), 22) +
        num(wrapStep, 5, 10) + num(relative, 2, 12) +
        num(headRms, 5, 10) + num(tailRms, 5, 10) + num(ratio, 2, 8),
    );
    // A wrap step over a third of the file's own biggest move is a real edge,
    // not the material. A level ratio outside 0.5..2 is an audible breath.
    if (relative > 0.33) seamProblems.push(`${m.name}: wrap step ${wrapStep.toFixed(5)} is ${relative.toFixed(2)}x its own largest ordinary step — clicks once per lap`);
    if (ratio < 0.5 || ratio > 2) seamProblems.push(`${m.name}: ends at ${ratio.toFixed(2)}x the level it starts at — the bed breathes once per lap`);
  }
  console.log(seamProblems.length ? '' : '\nevery seam is clean.');
  for (const p of seamProblems) console.log(`   ${p}`);
}

console.log(
  '\nNote: none of this says whether a cue is PLEASANT. That needs an ear.\n' +
    'What it says is which cues are worth listening to first.',
);
