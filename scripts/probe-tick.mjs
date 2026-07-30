/**
 * scripts/probe-tick.mjs — where does the similarity between two typing-tick
 * WAVs actually live? Splits both into low (<300 Hz) and mid/high bands and
 * reports the variety metric per band and per time window, so the recipe can
 * be tuned on evidence instead of guesswork.
 *
 *   node scripts/probe-tick.mjs typing-tick-1 typing-tick-3
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const SOUNDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');

function readWav(path) {
  const b = readFileSync(path);
  const dataOff = 44;
  const n = (b.length - dataOff) / 2;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(dataOff + i * 2) / 32768;
  return out;
}

function lowpass(x, f0) {
  const w0 = (2 * Math.PI * f0) / SR;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * 0.7);
  const a0 = 1 + alpha;
  const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = (1 - cw) / 2 / a0;
  const a1 = (-2 * cw) / a0, a2 = (1 - alpha) / a0;
  const out = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

const peakOf = (x) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);

function diffMetric(a, b, from, to) {
  const pa = peakOf(a), pb = peakOf(b);
  let diff = 0, ref = 0;
  for (let i = from; i < to && i < a.length && i < b.length; i++) {
    const va = a[i] / pa, vb = b[i] / pb;
    diff += (va - vb) * (va - vb);
    ref += va * va + vb * vb;
  }
  return Math.sqrt(diff / Math.max(ref, 1e-12));
}

const [nameA, nameB] = process.argv.slice(2);
const a = readWav(join(SOUNDS, `${nameA}.wav`));
const b = readWav(join(SOUNDS, `${nameB}.wav`));
const n = Math.min(a.length, b.length);

const aLo = lowpass(a, 300), bLo = lowpass(b, 300);
const aHi = a.map((v, i) => v - aLo[i]), bHi = b.map((v, i) => v - bLo[i]);

console.log(`${nameA} vs ${nameB}  (window ${(n / SR).toFixed(3)}s)`);
console.log(`  full signal : ${diffMetric(a, b, 0, n).toFixed(3)}`);
console.log(`  <300 Hz     : ${diffMetric(aLo, bLo, 0, n).toFixed(3)}`);
console.log(`  >300 Hz     : ${diffMetric(aHi, bHi, 0, n).toFixed(3)}`);
for (const ms of [30, 60, 90, 130]) {
  const to = Math.min(n, Math.round((ms / 1000) * SR));
  console.log(`  0-${ms}ms    : ${diffMetric(a, b, 0, to).toFixed(3)}   low ${diffMetric(aLo, bLo, 0, to).toFixed(3)}`);
}
const tail = Math.round(0.06 * SR);
console.log(`  after 60ms  : ${diffMetric(a, b, tail, n).toFixed(3)}   low ${diffMetric(aLo, bLo, tail, n).toFixed(3)}`);
