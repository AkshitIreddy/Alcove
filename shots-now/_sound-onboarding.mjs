/**
 * shots-now/_sound-onboarding.mjs — RECORD the onboarding, look for steps.
 *
 * The reader hears static during onboarding: walking the tour, and hardest
 * when the sound-profile chips are pressed and four cues fire inside 1.2 s.
 * Six theories have already been measured and killed (see engine.ts's
 * "WHAT WAS MEASURED AND RULED OUT"). What has never been recorded is the
 * onboarding ITSELF, and what has never been measured is a DISCONTINUITY —
 * a sample-to-sample jump the source file does not contain.
 *
 * This records howler's master output as PCM while the real panel is driven
 * by clicking, and reports per play:
 *   - the gain the voice STARTED at vs the gain it was corrected to
 *   - max |x[n] - x[n-1]| inside the burst, against the source file's own
 *   - the Howl's LOAD STATE at the moment play/volume/rate were issued
 *
 * That last one is the new instrument. `presetLevel` is written to land the
 * level before the first sample, and howler honours it only when the Howl is
 * `_state === 'loaded'`; every other call is pushed onto `_queue` and drained
 * later. Onboarding is the one part of the app's life where nothing is loaded
 * yet — and pressing a sound-set chip swaps in a whole set of files that have
 * never been fetched.
 *
 *   node shots-now/_sound-onboarding.mjs [--url=http://localhost:1420]
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

/* One play to make howler build its context, then splice the recorder in. */
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
  return { ok: true, state: ctx.state, sampleRate: ctx.sampleRate };
}, WORKLET);
if (!spliced.ok) { console.error(`FAIL: ${spliced.why}`); await browser.close(); process.exit(1); }
console.log(`tap installed: ctx ${spliced.state} @ ${spliced.sampleRate} Hz`);

const hooked = await p.evaluate(HOWL_HOOK);
console.log(`howl hook: ${JSON.stringify(hooked)}`);
if (!hooked.ok) { await browser.close(); process.exit(1); }

await p.evaluate(() => globalThis.__nbSound.stopAmbient());
await p.waitForTimeout(400);

/* ─────────────────────────────── measurement ────────────────────────────── */

const MEASURE = () => {
  const tap = globalThis.__nbAudioTap;
  const sr = tap.sampleRate;
  const blocks = tap.pcm.slice().sort((a, b) => a.frame - b.frame);
  if (blocks.length === 0) return { plays: [], why: 'recorder produced no audio' };
  const frame0 = blocks[0].frame;
  const last = blocks[blocks.length - 1];
  const total = last.frame + last.data.length - frame0;
  const pcm = new Float32Array(total);
  let gaps = 0;
  let expect = frame0;
  for (const b of blocks) {
    if (b.frame !== expect) gaps++;
    pcm.set(b.data, b.frame - frame0);
    expect = b.frame + b.data.length;
  }

  const stats = (a, b) => {
    let peak = 0, sumsq = 0, maxStep = 0, big = 0, clip = 0, stepAt = 0;
    for (let i = a; i < b; i++) {
      const v = pcm[i];
      const m = Math.abs(v);
      if (m > peak) peak = m;
      if (m >= 0.995) clip++;
      sumsq += v * v;
      if (i > a) {
        const d = Math.abs(v - pcm[i - 1]);
        if (d > maxStep) { maxStep = d; stepAt = i - a; }
        if (d > 0.12) big++;
      }
    }
    const rms = Math.sqrt(sumsq / Math.max(1, b - a));
    return { peak: +peak.toFixed(5), rms: +rms.toFixed(6), maxStep: +maxStep.toFixed(5), big, clip,
             stepAtMs: +((stepAt / sr) * 1000).toFixed(2),
             stepOverPeak: peak > 0 ? +(maxStep / peak).toFixed(3) : 0 };
  };

  const plays = tap.starts.map((s) => {
    const startFrame = Math.round(s.t * sr) - frame0;
    const len = Math.min(Math.round((s.bufDur || 0.3) * sr) + Math.round(0.30 * sr), 2 * sr);
    const a = Math.max(0, startFrame - Math.round(0.02 * sr));
    const b = Math.min(pcm.length, a + len);

    let before, after;
    for (let i = s.gainMark - 1; i >= 0; i--) {
      if (tap.gains[i].id === s.gainId) { before = tap.gains[i]; break; }
    }
    for (let i = s.gainMark; i < tap.gains.length; i++) {
      const gEv = tap.gains[i];
      if (gEv.id !== s.gainId) continue;
      if (gEv.now - s.t > 0.05) break;
      after = gEv; break;
    }
    // The howler calls that happened in the same breath as this start.
    const near = tap.howl.filter((h) => Math.abs(h.wall - s.wall) <= 40);
    const queuedCalls = near.filter((h) => h.state !== 'loaded' || h.playLock);
    return {
      url: String(s.url).split('/').pop().split('?')[0],
      t: +s.t.toFixed(4),
      wall: s.wall,
      rate: +s.rate.toFixed(4),
      bufMs: Math.round(s.bufDur * 1000),
      stoppedAfterMs: s.stoppedAt === null ? null : +((s.stoppedAt - s.t) * 1000).toFixed(1),
      startGain: before ? +before.value.toFixed(4) : null,
      fixGain: after ? +after.value.toFixed(4) : null,
      wrongForMs: before && after ? +((after.now - before.now) * 1000).toFixed(3) : null,
      nearCalls: near.map((h) => `${h.call}(${h.args.join(',')})@${h.state}${h.playLock ? '+lock' : ''}q${h.queue}`),
      queuedCalls: queuedCalls.length,
      ...(b - a < 32 ? { peak: null } : stats(a, b)),
    };
  });

  // Bursts found by energy — owes nothing to a main-thread clock.
  const FLOOR = 0.0006;
  const bursts = [];
  { let i = 0; const hold = Math.round(0.06 * sr);
    while (i < pcm.length) {
      if (Math.abs(pcm[i]) > FLOOR) {
        const a = i; let quiet = 0; let j = i;
        while (j < pcm.length && quiet < hold) { quiet = Math.abs(pcm[j]) > FLOOR ? 0 : quiet + 1; j++; }
        bursts.push({ atMs: +(((a) / sr) * 1000).toFixed(1), ms: +(((j - a) / sr) * 1000).toFixed(1), ...stats(a, j) });
        i = j;
      } else i++;
    }
  }

  return {
    plays, bursts, total, gaps, sampleRate: sr,
    dead: blocks.length ? blocks[blocks.length - 1].dead : -1,
    howlCalls: tap.howl.length,
    stops: tap.stops.map((s) => ({ url: String(s.url).split('/').pop(), sinceStartMs: +(s.sinceStart * 1000).toFixed(1), bufMs: Math.round(s.bufDur * 1000) })),
  };
};

/**
 * The same measurement on the SOURCE file, decoded fresh — the control.
 * A step in the tape that the file itself does not contain came from us.
 */
const SOURCE_STATS = async (names) => {
  const out = {};
  for (const name of names) {
    try {
      const res = await fetch(`/sounds/${name}`);
      const buf = await res.arrayBuffer();
      const ctx = new OfflineAudioContext(1, 128, 48000);
      const ab = await ctx.decodeAudioData(buf);
      const ch = ab.getChannelData(0);
      let peak = 0, maxStep = 0;
      for (let i = 0; i < ch.length; i++) {
        const m = Math.abs(ch[i]);
        if (m > peak) peak = m;
        if (i > 0) { const d = Math.abs(ch[i] - ch[i - 1]); if (d > maxStep) maxStep = d; }
      }
      out[name] = { peak: +peak.toFixed(5), maxStep: +maxStep.toFixed(5), stepOverPeak: +(maxStep / peak).toFixed(3), ms: Math.round(ab.duration * 1000) };
    } catch (e) { out[name] = { err: String(e).slice(0, 80) }; }
  }
  return out;
};

const clearTape = () => p.evaluate(() => {
  const tap = globalThis.__nbAudioTap;
  tap.starts.length = 0; tap.gains.length = 0; tap.pcm.length = 0; tap.howl.length = 0;
  tap.stops.length = 0; tap.recFrame0 = null;
});

/* ──────────────────────────────── drive it ──────────────────────────────── */

const openSoundQuestion = async () => {
  await p.evaluate(() => { globalThis.__nbTaste.open(); });
  await p.waitForTimeout(500);
  // Walk to the sound question by clicking the footer dot for it.
  for (let i = 0; i < 12; i++) {
    const at = await p.evaluate(() => document.querySelector('[data-taste-step]')?.getAttribute('data-taste-step') ?? null);
    if (at === 'sound') return true;
    if (at === null) return false;
    const dots = await p.$$('.nbq-dots [role="tab"], .nbq-dots button');
    if (dots.length === 0) return false;
    // last-but-one dot is the sound question (it is the fifth of five axes)
    await dots[dots.length - 1].click().catch(() => undefined);
    await p.waitForTimeout(350);
  }
  return false;
};

const ok = await openSoundQuestion();
console.log(`sound question reached: ${ok}`);
if (!ok) {
  const dump = await p.evaluate(() => ({
    layer: document.querySelector('[data-taste-step]')?.outerHTML.slice(0, 400) ?? null,
    open: globalThis.__nbTaste?.chosen?.(),
  }));
  console.log(JSON.stringify(dump, null, 2));
  await browser.close();
  process.exit(1);
}

const chips = await p.$$('[data-taste-step="sound"] .nbq-option');
console.log(`sound chips: ${chips.length}`);

const report = {};

/* ── PHASE COLD: every chip pressed for the first time in this session ──── */
await clearTape();
for (const chip of chips) {
  await chip.click().catch(() => undefined);
  await p.waitForTimeout(1700);
}
await p.waitForTimeout(600);
report.cold = await p.evaluate(MEASURE);

/* ── PHASE WARM: the identical presses, with every file now decoded ─────── */
await clearTape();
for (const chip of chips) {
  await chip.click().catch(() => undefined);
  await p.waitForTimeout(1700);
}
await p.waitForTimeout(600);
report.warm = await p.evaluate(MEASURE);

/* ── the control: what the source files themselves look like ───────────── */
const files = [...new Set([...report.cold.plays, ...report.warm.plays].map((x) => x.url))].filter((f) => f.endsWith('.wav'));
report.source = await p.evaluate(SOURCE_STATS, files);

writeFileSync(`${OUT}/onboarding-tape.json`, JSON.stringify(report, null, 2));

/* ──────────────────────────────── report ────────────────────────────────── */

const show = (label, r) => {
  console.log(`\n──────── ${label} ────────`);
  console.log(`${r.total} frames @ ${r.sampleRate} Hz · ${r.gaps} block gaps · ${r.dead} quanta with no input · ${r.plays.length} plays · ${r.bursts.length} bursts · ${r.howlCalls} howler calls`);
  const bad = r.plays.filter((x) => x.startGain !== null && x.fixGain !== null && Math.abs(x.startGain - x.fixGain) > 0.02);
  console.log(`plays whose voice STARTED at a different gain than it settled at: ${bad.length}/${r.plays.length}`);
  const queued = r.plays.filter((x) => x.queuedCalls > 0);
  console.log(`plays issued against a Howl that was not 'loaded' (or play-locked): ${queued.length}/${r.plays.length}`);
  console.log(['file', 'startG', 'fixG', 'wrongMs', 'peak', 'maxStep', 'step/peak', 'big', 'clip', 'stoppedMs/bufMs', 'howler calls'].join('\t'));
  for (const x of r.plays) {
    console.log([
      x.url, x.startGain, x.fixGain, x.wrongForMs, x.peak, x.maxStep, x.stepOverPeak, x.big, x.clip,
      `${x.stoppedAfterMs ?? '-'}/${x.bufMs}`, x.nearCalls.join(' '),
    ].join('\t'));
  }
};

show('COLD — first press of each sound family', report.cold);
show('WARM — the same presses, files already decoded', report.warm);

console.log('\n──────── SOURCE FILES (the control) ────────');
console.log(['file', 'peak', 'maxStep', 'step/peak', 'ms'].join('\t'));
for (const [f, s] of Object.entries(report.source)) {
  console.log([f, s.peak, s.maxStep, s.stepOverPeak, s.ms].join('\t'));
}

console.log(`\nwrote ${OUT}/onboarding-tape.json`);
await browser.close();
