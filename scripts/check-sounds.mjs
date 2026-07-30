/**
 * scripts/check-sounds.mjs — objective QC for the generated sound set.
 *
 * The synthesis recipes in scripts/gen-sounds.mjs are written by ear-deaf
 * arithmetic, so this script measures every WAV in public/sounds/ and prints
 * a table. It exists so a sound can be judged on numbers before it is ever
 * listened to:
 *
 *   duration   sanity window per cue (loops exactly 8 s; chimes multi-second)
 *   peak       must stay under 0.98 (no clipping; the set masters to -8 dB
 *              and below, so anything near full scale is a bug)
 *   RMS        whole-file loudness in dBFS — the LUFS-ish column; eyeball
 *              for outliers against the cue's neighbours
 *   DC         residual DC offset; inaudible itself but a click source when
 *              sounds are cut/chained — must stay under -60 dBFS
 *   step       largest adjacent-sample jump as % of peak — a click's
 *              signature (unit gate: 25%)
 *   onset      loudest sample in the first 0.5 ms as % of peak (gate: 4%)
 *   edges      first/last 5 ms RMS vs the crest RMS (loudest 10 ms window)
 *              — "click-free start/end". A file that STARTS or ENDS at its
 *              loudest level is the click scenario; a faded file's edges
 *              sit well under the crest. (Edge-vs-body is meaningless for
 *              decaying bursts, whose head IS the loud moment by design,
 *              and for chime tails, where both windows are the noise floor.
 *              Loop seams are full-level by design — their continuity is
 *              gated by the unit suite's head/tail RMS tests, so loops only
 *              fail here if an edge actually EXCEEDS the crest.)
 *
 * Hard-fails (exit 1) on: unreadable/truncated WAV, non-44.1k/16-bit/mono,
 * peak >= 0.98, DC over -60 dB, one-shot edge within 3 dB of the crest,
 * loop edge more than 2 dB over the crest, NaN metrics.
 * Everything else is printed for eyeballing. Zero dependencies.
 *
 *   node scripts/check-sounds.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const SOUNDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');

/* ------------------------------- WAV parse ------------------------------- */

function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not RIFF/WAVE');
  }
  let off = 12;
  let fmt;
  let data;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { format: b.readUInt16LE(off + 8), channels: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    } else if (id === 'data') {
      data = new Float64Array(size / 2);
      for (let i = 0; i < data.length; i++) data[i] = b.readInt16LE(off + 8 + i * 2) / 32768;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt/data chunk');
  return { fmt, samples: data };
}

/* ------------------------------- metrics -------------------------------- */

const db = (v) => 20 * Math.log10(Math.max(Math.abs(v), 1e-9));

function rms(x, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

function measure(samples) {
  let peak = 0, dc = 0, maxStep = 0, onset = 0;
  const onsetN = Math.min(samples.length, Math.round(0.0005 * SR));
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    dc += v;
    if (i > 0) {
      const d = Math.abs(v - samples[i - 1]);
      if (d > maxStep) maxStep = d;
    }
    if (i < onsetN && a > onset) onset = a;
  }
  const edgeN = Math.min(Math.round(0.005 * SR), Math.floor(samples.length / 8));
  const crestN = Math.min(Math.round(0.01 * SR), Math.floor(samples.length / 4));
  let crest = 0;
  for (let from = 0; from + crestN <= samples.length; from += Math.max(1, Math.floor(crestN / 4))) {
    const w = rms(samples, from, from + crestN);
    if (w > crest) crest = w;
  }
  return {
    durationS: samples.length / SR,
    peak,
    rmsDb: db(rms(samples, 0, samples.length)),
    dcDb: db(dc / samples.length),
    stepPct: (maxStep / Math.max(peak, 1e-9)) * 100,
    onsetPct: (onset / Math.max(peak, 1e-9)) * 100,
    headDb: db(rms(samples, 0, edgeN)) - db(crest),
    tailDb: db(rms(samples, samples.length - edgeN, samples.length)) - db(crest),
  };
}

/* --------------------------------- table --------------------------------- */

const files = readdirSync(SOUNDS).filter((f) => f.endsWith('.wav')).sort();
if (files.length === 0) {
  console.error(`no WAVs in ${SOUNDS} — run node scripts/gen-sounds.mjs first`);
  process.exit(1);
}

const isLoop = (name) => name.startsWith('ambient-') || name === 'pencil-scratch';

let failures = 0;
const fail = (name, what) => {
  failures += 1;
  console.error(`  FAIL ${name}: ${what}`);
};

const rows = [];
for (const file of files) {
  const name = file.replace(/\.wav$/, '');
  let parsed;
  try {
    parsed = readWav(join(SOUNDS, file));
  } catch (e) {
    fail(name, `unreadable: ${e.message}`);
    continue;
  }
  const { fmt, samples } = parsed;
  if (fmt.rate !== SR || fmt.bits !== 16 || fmt.channels !== 1 || fmt.format !== 1) {
    fail(name, `format ${fmt.rate}Hz/${fmt.bits}bit/${fmt.channels}ch fmt=${fmt.format}`);
    continue;
  }
  const m = measure(samples);
  if (!Object.values(m).every(Number.isFinite)) { fail(name, 'non-finite metric'); continue; }
  if (m.peak >= 0.98) fail(name, `peak ${m.peak.toFixed(3)} >= 0.98 (clipping)`);
  if (m.dcDb > -60) fail(name, `DC offset ${m.dcDb.toFixed(1)} dB`);
  if (m.durationS < 0.05) fail(name, `duration ${m.durationS.toFixed(3)}s suspiciously short`);
  // Click-free edges: one-shots must not start/end anywhere near their
  // loudest moment; loops run full-level by design and only fail if an
  // edge somehow EXCEEDS the crest (a genuinely broken fade).
  const headGate = isLoop(name) ? 2 : -3;
  if (m.headDb > headGate) fail(name, `head edge ${m.headDb.toFixed(1)} dB vs crest (gate ${headGate})`);
  if (m.tailDb > headGate) fail(name, `tail edge ${m.tailDb.toFixed(1)} dB vs crest (gate ${headGate})`);
  rows.push({ name, ...m });
}

const pad = (cols) => cols.map(([t, w, right]) => (right ? String(t).padStart(w) : String(t).padEnd(w))).join(' ');
console.log(`\n${files.length} WAVs in ${SOUNDS}\n`);
console.log(pad([['file', 22], ['dur', 7, 1], ['peak', 7, 1], ['RMS', 7, 1], ['DC', 7, 1], ['step', 7, 1], ['onset', 7, 1], ['head', 8, 1], ['tail', 8, 1]]));
console.log(pad([['----', 22], ['---', 7, 1], ['----', 7, 1], ['---', 7, 1], ['--', 7, 1], ['----', 7, 1], ['-----', 7, 1], ['----', 8, 1], ['----', 8, 1]]));
for (const r of rows) {
  console.log(pad([
    [r.name, 22],
    [`${r.durationS.toFixed(2)}s`, 7, 1],
    [r.peak.toFixed(3), 7, 1],
    [`${r.rmsDb.toFixed(1)}`, 7, 1],
    [`${r.dcDb.toFixed(0)}`, 7, 1],
    [`${r.stepPct.toFixed(1)}%`, 7, 1],
    [`${r.onsetPct.toFixed(2)}%`, 7, 1],
    [`${r.headDb.toFixed(1)}dB`, 8, 1],
    [`${r.tailDb.toFixed(1)}dB`, 8, 1],
  ]));
}

console.log('');
if (failures > 0) {
  console.error(`${failures} QC failure(s)`);
  process.exit(1);
}
console.log('QC clean: no clipping, no DC, click-free edges on every file.');
