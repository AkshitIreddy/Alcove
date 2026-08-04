/**
 * shots-now/_sound-bed.mjs — the onboarding recorded WITH the bed running.
 *
 * `_sound-onboarding.mjs` stopped the ambient loop so each cue could be
 * measured alone, and found nothing: 38 plays, no clip, no jump the source
 * file does not have, no truncated tail. That is exactly the measurement the
 * reader's report warns against — a graph edit made in silence is inaudible,
 * and the whole point of the bed is that it is NEVER silent.
 *
 * So: the bed runs, the real panel and the real tour are driven, and the tape
 * is measured in WINDOWS AROUND EACH GESTURE rather than around each play.
 * What a re-wire looks like in a continuous signal is a run of exact zeros or
 * a step the material cannot produce, so both are counted, against the bed's
 * own quiet-window statistics as the control.
 *
 * The whole tape is written to qa/sound/bed.wav so the claim can be checked
 * with something that is not this script.
 *
 *   node shots-now/_sound-bed.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { INIT, WORKLET, HOWL_HOOK } from './_sound-tap.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'qa/sound';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const p = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await p.addInitScript(INIT);
p.on('pageerror', (e) => console.log(`  page error: ${String(e).slice(0, 200)}`));

const poll = async (fn, ms = 60000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    if (await p.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await p.waitForTimeout(200);
  }
};

await p.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__nbSound !== undefined, 60000, 'sound engine bridge');
await poll(() => globalThis.__nbTaste !== undefined, 60000, 'taste bridge');
await poll(() => document.querySelector('[data-shelf-dock="studio"]') !== null, 60000, 'shelf dock');

await p.evaluate(async () => { await globalThis.__nbSound.play('click-soft'); });
await p.waitForTimeout(700);

const spliced = await p.evaluate(async (workletSrc) => {
  const tap = globalThis.__nbAudioTap;
  const ctx = tap.ctx;
  if (!ctx) return { ok: false, why: 'no AudioContext ever connected to a destination' };
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
  const url = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const rec = new AudioWorkletNode(ctx, 'nb-rec', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
  });
  rec.port.onmessage = (e) => {
    if (tap.recFrame0 === null) tap.recFrame0 = e.data.frame;
    tap.pcm.push(e.data);
  };
  const sink = ctx.__nbSink;
  sink.disconnect();
  tap.origConnect.call(sink, rec);
  tap.origConnect.call(rec, ctx.destination);
  tap.installed = true;
  tap.sampleRate = ctx.sampleRate;
  let cap = null;
  try {
    if (ctx.renderCapacity) {
      ctx.renderCapacity.onupdate = (ev) => { tap.cap = { average: ev.averageLoad, peak: ev.peakLoad, underrun: ev.underrunRatio }; };
      ctx.renderCapacity.start({ updateInterval: 0.5 });
      cap = 'started';
    }
  } catch (e) { cap = String(e).slice(0, 60); }
  return { ok: true, state: ctx.state, sampleRate: ctx.sampleRate, cap };
}, WORKLET);
if (!spliced.ok) { console.error(`FAIL: ${spliced.why}`); await browser.close(); process.exit(1); }
console.log(`tap installed: ctx ${spliced.state} @ ${spliced.sampleRate} Hz · renderCapacity ${spliced.cap}`);

const hooked = await p.evaluate(HOWL_HOOK);
console.log(`howl hook: ${JSON.stringify(hooked)}`);

/* THE BED RUNS. This is the whole difference from the first probe. */
await p.evaluate(async () => {
  globalThis.__nbSound.setSoundscape('fireplace');
  await globalThis.__nbSound.startAmbient();
});
await p.waitForTimeout(1500);
const bedOn = await p.evaluate(() => {
  const s = globalThis.__nbSound.getState();
  return { soundscape: s.soundscape, playing: s.ambientPlaying, filter: s.filter };
});
console.log(`ambient bed: ${JSON.stringify(bedOn)}`);
if (bedOn.playing === null) { console.error('FAIL: the bed is not playing — the whole point of this take'); await browser.close(); process.exit(1); }
if (!bedOn.filter.installed && bedOn.filter.wanted !== '') { console.error('FAIL: filter not installed'); await browser.close(); process.exit(1); }

const mark = (label) => p.evaluate((l) => {
  const tap = globalThis.__nbAudioTap;
  const s = globalThis.__nbSound.getState();
  tap.marks.push({ label: l, wall: Date.now(), t: tap.ctx.currentTime, filter: s.filter.tag, set: s.baseSet, rewires: tap.rewires.length });
}, label);

/* ─────────────────────────────── drive it ───────────────────────────────── */

await p.evaluate(() => { globalThis.__nbTaste.open(); });
await p.waitForTimeout(600);
for (let i = 0; i < 12; i++) {
  const at = await p.evaluate(() => document.querySelector('[data-taste-step]')?.getAttribute('data-taste-step') ?? null);
  if (at === 'sound') break;
  const dots = await p.$$('.nbq-dots [role="tab"], .nbq-dots button');
  if (dots.length === 0) break;
  await dots[dots.length - 1].click().catch(() => undefined);
  await p.waitForTimeout(300);
}
const chips = await p.$$('[data-taste-step="sound"] .nbq-option');
console.log(`sound chips: ${chips.length}`);

/* Two seconds of the bed alone — the control window. */
await p.evaluate(() => { globalThis.__nbAudioTap.pcm.length = 0; globalThis.__nbAudioTap.recFrame0 = null; });
await mark('BED-ALONE');
await p.waitForTimeout(2500);

for (let i = 0; i < chips.length; i++) {
  await mark(`chip-${i}`);
  await chips[i].click().catch(() => undefined);
  await p.waitForTimeout(2000);
}

/* And the tour, stepped both ways. */
await p.evaluate(() => { globalThis.__nbTaste.close(); });
await p.waitForTimeout(400);
await mark('TOUR-START');
await p.evaluate(() => { globalThis.__nbTutorial?.start(); });
await p.waitForTimeout(900);
await p.evaluate(() => { globalThis.__nbTutorial?.chooseLength?.('long'); });
await p.waitForTimeout(1200);
for (let i = 0; i < 8; i++) {
  await mark(`tour-next-${i}`);
  await p.evaluate(() => { globalThis.__nbTutorial?.hold?.(); globalThis.__nbTutorial?.next?.(); });
  await p.waitForTimeout(1400);
}
await mark('TOUR-STOP');
await p.evaluate(() => { globalThis.__nbTutorial?.stop?.(); });
await p.waitForTimeout(1500);

/* ─────────────────────────────── measure ────────────────────────────────── */

const result = await p.evaluate(() => {
  const tap = globalThis.__nbAudioTap;
  const sr = tap.sampleRate;
  const blocks = tap.pcm.slice().sort((a, b) => a.frame - b.frame);
  const frame0 = blocks[0].frame;
  const last = blocks[blocks.length - 1];
  const total = last.frame + last.data.length - frame0;
  const pcm = new Float32Array(total);
  let gaps = 0; let expect = frame0;
  for (const b of blocks) {
    if (b.frame !== expect) gaps++;
    pcm.set(b.data, b.frame - frame0);
    expect = b.frame + b.data.length;
  }
  const at = (ctxT) => Math.round(ctxT * sr) - frame0;

  const win = (a, b) => {
    a = Math.max(0, a); b = Math.min(pcm.length, b);
    let peak = 0, sumsq = 0, maxStep = 0, stepAt = -1, zeroRun = 0, maxZero = 0, zeroAt = -1;
    for (let i = a; i < b; i++) {
      const v = pcm[i]; const m = Math.abs(v);
      if (m > peak) peak = m;
      sumsq += v * v;
      if (v === 0) { zeroRun++; if (zeroRun > maxZero) { maxZero = zeroRun; zeroAt = i - a; } } else zeroRun = 0;
      if (i > a) { const d = Math.abs(v - pcm[i - 1]); if (d > maxStep) { maxStep = d; stepAt = i - a; } }
    }
    return {
      ms: +(((b - a) / sr) * 1000).toFixed(1),
      peak: +peak.toFixed(5),
      rms: +Math.sqrt(sumsq / Math.max(1, b - a)).toFixed(6),
      maxStep: +maxStep.toFixed(5),
      stepAtMs: +((stepAt / sr) * 1000).toFixed(2),
      maxZeroRun: maxZero,
      zeroAtMs: +((zeroAt / sr) * 1000).toFixed(2),
    };
  };

  const marks = tap.marks.map((m) => ({
    label: m.label, filter: m.filter, set: m.set,
    ...win(at(m.t) - Math.round(0.05 * sr), at(m.t) + Math.round(0.45 * sr)),
  }));

  // The rewires themselves, windowed TIGHT on the render clock: ±10 ms around
  // the moment the master gain was disconnected or reconnected. If tearing the
  // bus down under a sounding bed puts a hole or a step in the signal, it is
  // in these 20 ms and nowhere else.
  const rewires = tap.rewires.map((r) => ({
    kind: r.kind, t: +r.t.toFixed(4),
    ...win(at(r.t) - Math.round(0.01 * sr), at(r.t) + Math.round(0.01 * sr)),
  }));

  // The control: every 500 ms slice of the whole tape, so the gesture windows
  // can be read against what this signal does when nothing is being pressed.
  const slice = Math.round(0.5 * sr);
  const all = [];
  for (let a = 0; a + slice <= pcm.length; a += slice) all.push(win(a, a + slice));
  const steps = all.map((x) => x.maxStep).sort((a, b) => a - b);
  const zeros = all.map((x) => x.maxZeroRun).sort((a, b) => a - b);

  // Ship the tape out as 16-bit so the claim can be checked elsewhere.
  const pk = Math.max(1e-6, Math.max(...all.map((x) => x.peak)));
  const i16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round((pcm[i] / pk) * 30000)));
  let bin = '';
  const u8 = new Uint8Array(i16.buffer);
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));

  return {
    sampleRate: sr, total, gaps,
    dead: blocks[blocks.length - 1].dead,
    cap: tap.cap ?? null,
    marks,
    rewires,
    control: {
      slices: all.length,
      maxStep: { p50: steps[Math.floor(steps.length / 2)], p95: steps[Math.floor(steps.length * 0.95)], max: steps[steps.length - 1] },
      maxZeroRun: { p50: zeros[Math.floor(zeros.length / 2)], p95: zeros[Math.floor(zeros.length * 0.95)], max: zeros[zeros.length - 1] },
      rmsRange: [Math.min(...all.map((x) => x.rms)), Math.max(...all.map((x) => x.rms))],
    },
    starts: tap.starts.length,
    normPeak: pk,
    wavB64: btoa(bin),
  };
});

const { wavB64, ...report } = result;
const pcmBytes = Buffer.from(wavB64, 'base64');
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcmBytes.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(report.sampleRate, 24); header.writeUInt32LE(report.sampleRate * 2, 28);
header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcmBytes.length, 40);
writeFileSync(`${OUT}/bed.wav`, Buffer.concat([header, pcmBytes]));
writeFileSync(`${OUT}/bed.json`, JSON.stringify(report, null, 2));

console.log(`\n${report.total} frames @ ${report.sampleRate} Hz · ${report.gaps} block gaps · ${report.dead} quanta with no input · ${report.starts} buffer starts`);
console.log(`renderCapacity: ${JSON.stringify(report.cap)}`);
console.log(`\ncontrol — every 500 ms slice of the whole tape (${report.control.slices} slices)`);
console.log(`  max |x[n]-x[n-1]| : p50 ${report.control.maxStep.p50}  p95 ${report.control.maxStep.p95}  max ${report.control.maxStep.max}`);
console.log(`  longest zero run  : p50 ${report.control.maxZeroRun.p50}  p95 ${report.control.maxZeroRun.p95}  max ${report.control.maxZeroRun.max}`);
console.log(`  rms range         : ${report.control.rmsRange.map((x) => x.toFixed(6)).join(' .. ')}`);
console.log(`\nwindows around each gesture (-50 ms .. +450 ms)`);
console.log(['mark', 'set', 'filter', 'peak', 'rms', 'maxStep', 'stepAt ms', 'zeroRun'].join('\t'));
for (const m of report.marks) {
  console.log([m.label, m.set, (m.filter ?? '').slice(0, 30) || '(none)', m.peak, m.rms, m.maxStep, m.stepAtMs, m.maxZeroRun].join('\t'));
}
console.log(`\nmaster-bus rewires, ±10 ms on the render clock (${report.rewires.length})`);
console.log(['kind', 'ctx t', 'peak', 'rms', 'maxStep', 'stepAt ms', 'zeroRun'].join('\t'));
for (const r of report.rewires) {
  console.log([r.kind, r.t, r.peak, r.rms, r.maxStep, r.stepAtMs, r.maxZeroRun].join('\t'));
}
console.log(`\nwrote ${OUT}/bed.wav and ${OUT}/bed.json`);
await browser.close();
