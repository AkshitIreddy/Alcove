/**
 * scripts/audition-sounds.mjs — one file you can listen to, so somebody finally does.
 *
 * TODO.md has carried "Nobody has listened to any of it. Every judgement so far
 * is spectral" for a long time, and it is the one item no amount of measuring
 * closes. `scripts/audit-sounds.mjs` says the bytes are well formed — no
 * clipping, no DC, no clicks, every ambient seam exact — and says nothing about
 * whether the task-complete cue sounds like a metal tong, which is a judgement
 * only an ear makes. The owner has made that call twice and been right twice.
 *
 * So this stitches the set into one WAV: every one-shot family once, then a few
 * seconds of each ambient bed, each preceded by a short spoken-position marker
 * (a click count) and a gap. Listening once, in order, is the cheapest way to
 * turn "nobody has heard these" into "somebody has".
 *
 * Variants (-2, -3, -4) are the same cue re-rolled to stop repetition fatigue,
 * so only the first of each family is included — hearing four near-identical
 * page flips teaches nothing and makes the file four times as long to sit
 * through.
 *
 *   node scripts/audition-sounds.mjs
 *   -> qa/sound/audition.wav  plus a printed running order
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIR = join(ROOT, 'public/sounds');
const OUT_DIR = join(ROOT, 'qa/sound');

const RATE = 44100;
/** Silence between cues: long enough to separate them, short enough to sit through. */
const GAP = 0.55;
/** How much of an 8–12 second bed is enough to judge its character. */
const AMBIENT_SECONDS = 5;

/* Reuses the decoder from the audit rather than carrying a second copy: one
   reader, so a WAV this can play is a WAV that one can measure. */
const { decodeWav } = await import('./wav.mjs');

const files = readdirSync(DIR).filter((f) => f.endsWith('.wav'));

/** The first of each family — "page-flip-3" and "page-flip-1" are one cue. */
const familyOf = (f) => f.replace(/\.wav$/, '').replace(/-\d+$/, '');
const families = new Map();
for (const f of files.sort()) {
  const key = familyOf(f);
  if (!families.has(key)) families.set(key, f);
}

const oneShots = [...families.entries()].filter(([k]) => !k.startsWith('ambient-'));
const ambients = [...families.entries()].filter(([k]) => k.startsWith('ambient-'));

/** A short tick so you can count position in the file without watching a clock. */
function marker(count) {
  const out = [];
  for (let c = 0; c < count; c += 1) {
    const n = Math.round(RATE * 0.035);
    for (let i = 0; i < n; i += 1) {
      const t = i / RATE;
      const env = Math.exp(-t * 90);
      out.push(Math.sin(2 * Math.PI * 1400 * t) * env * 0.07);
    }
    for (let i = 0; i < Math.round(RATE * 0.08); i += 1) out.push(0);
  }
  return out;
}

const track = [];
const order = [];
const silence = (s) => {
  for (let i = 0; i < Math.round(RATE * s); i += 1) track.push(0);
};

const push = (name, samples, label) => {
  order.push(`${String(order.length + 1).padStart(2, ' ')}. ${(track.length / RATE).toFixed(1).padStart(6)}s  ${label}`);
  for (const v of samples) track.push(v);
};

silence(0.4);
for (const [family, file] of oneShots) {
  const w = decodeWav(readFileSync(join(DIR, file)));
  push(family, marker(1), family);
  for (const v of w.mono) track.push(v);
  silence(GAP);
}

// A longer marker announces the change of section: one-shots are over, beds begin.
push('—', marker(3), 'ambient beds begin');
silence(0.5);

for (const [family, file] of ambients) {
  const w = decodeWav(readFileSync(join(DIR, file)));
  push(family, marker(1), family);
  const take = Math.min(w.mono.length, Math.round(w.sampleRate * AMBIENT_SECONDS));
  for (let i = 0; i < take; i += 1) track.push(w.mono[i]);
  // Fade the excerpt out so the cut is not itself a click the listener blames
  // on the bed — the real loop wraps seamlessly, which audit-sounds.mjs proves.
  const fade = Math.round(RATE * 0.25);
  for (let i = 0; i < fade; i += 1) {
    track[track.length - fade + i] *= 1 - i / fade;
  }
  silence(GAP);
}
silence(0.5);

/* ------------------------------- write it out ----------------------------- */

const n = track.length;
const buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0, 'ascii');
buf.writeUInt32LE(36 + n * 2, 4);
buf.write('WAVE', 8, 'ascii');
buf.write('fmt ', 12, 'ascii');
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(1, 22); // mono
buf.writeUInt32LE(RATE, 24);
buf.writeUInt32LE(RATE * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36, 'ascii');
buf.writeUInt32LE(n * 2, 40);

let peak = 0;
for (const v of track) peak = Math.max(peak, Math.abs(v));
/* Normalised to -3 dBFS. The cues are mixed far below full scale on purpose
   (nothing here peaks above 0.32), which is right in the app under a room bed
   and much too quiet to judge on laptop speakers. Every cue is scaled by the
   SAME factor, so their balance against each other is preserved — that balance
   is half of what an audition is for. */
const gain = peak > 0 ? 0.707 / peak : 1;
for (let i = 0; i < n; i += 1) {
  const v = Math.max(-1, Math.min(1, track[i] * gain));
  buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, 'audition.wav');
writeFileSync(out, buf);

console.log(`${oneShots.length} one-shot families + ${ambients.length} beds`);
console.log(`wrote qa/sound/audition.wav — ${(n / RATE).toFixed(1)}s, ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`every cue scaled by ${gain.toFixed(2)}x (their balance preserved)\n`);
console.log('running order — one tick before each, three ticks at the change of section:');
for (const line of order) console.log(`  ${line}`);
