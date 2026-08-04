/**
 * shots-now/_sound-cold.mjs — onboarding from a SUSPENDED AudioContext.
 *
 * Every earlier tape (sound-grit, _sound-onboarding, _sound-bed) was recorded
 * in a browser launched with `--autoplay-policy=no-user-gesture-required`, so
 * howler's context was `running` from the first frame. The shipped app has no
 * such flag: `src-tauri` sets no additional browser arguments, so WebView2
 * uses Chromium's default policy and the AudioContext starts SUSPENDED until
 * the reader's first gesture.
 *
 * That is not a detail. `engine.ts`'s own `autoSuspend` docblock names this
 * path as the one where a play goes wrong — `Howl.play()` sees
 * `Howler.state !== 'running'`, sets `_playLock`, defers the sound into a
 * `once('resume')` callback, and every `volume()`/`rate()` behind it queues
 * and drains from a `setTimeout(0)`. The engine disables howler's 30-second
 * auto-suspend so the path is never re-entered later in a session — but the
 * FIRST resume of the app's life cannot be disabled, and it lands exactly
 * where the reader says they hear it: during onboarding.
 *
 * So this launches with the real policy, installs the recorder while the
 * context is still suspended, and lets a genuine Playwright click be the
 * activation. Everything from the first rendered quantum onward is on tape.
 *
 *   node shots-now/_sound-cold.mjs [--url=http://localhost:1420]
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

/*
 * `user-gesture-required` is the whole experiment. Omitting the flag is NOT
 * enough — headless Chromium under CDP comes up with the context already
 * running, so the suspended state has to be asked for explicitly to get the
 * shipped app's condition.
 */
const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=user-gesture-required',
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

/*
 * Make howler build its graph WITHOUT a user gesture — the app's own first
 * cue, exactly as it happens when a hover or a boot cue fires before the
 * reader has clicked anything.
 */
await p.evaluate(() => { void globalThis.__nbSound.play('click-soft'); });
await poll(() => globalThis.__nbAudioTap.ctx !== null, 20000, 'howler AudioContext');
const cold = await p.evaluate(() => {
  const H = globalThis.__nbSound.howlerGlobal();
  return { ctxState: globalThis.__nbAudioTap.ctx.state, howlerState: H?.state, howls: H?._howls?.length ?? 0, autoUnlock: H?.autoUnlock, audioUnlocked: H?._audioUnlocked };
});
console.log(`before any gesture: ${JSON.stringify(cold)}`);

/* Splice the recorder in while the context is still suspended. */
const spliced = await p.evaluate(async (workletSrc) => {
  const tap = globalThis.__nbAudioTap;
  const ctx = tap.ctx;
  const url = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const rec = new AudioWorkletNode(ctx, 'nb-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  rec.port.onmessage = (e) => { if (tap.recFrame0 === null) tap.recFrame0 = e.data.frame; tap.pcm.push(e.data); };
  const sink = ctx.__nbSink;
  sink.disconnect();
  tap.origConnect.call(sink, rec);
  tap.origConnect.call(rec, ctx.destination);
  tap.installed = true;
  tap.sampleRate = ctx.sampleRate;
  return { ok: true, state: ctx.state, sampleRate: ctx.sampleRate };
}, WORKLET);
console.log(`tap installed while ctx ${spliced.state} @ ${spliced.sampleRate} Hz`);
const hooked = await p.evaluate(HOWL_HOOK);
console.log(`howl hook: ${JSON.stringify(hooked)}`);

/* Two more cues with NO gesture: they must pile up behind the resume. */
await p.evaluate(() => { void globalThis.__nbSound.play('pop-soft'); void globalThis.__nbSound.play('check-done'); });
await p.waitForTimeout(600);
const stillCold = await p.evaluate(() => {
  const H = globalThis.__nbSound.howlerGlobal();
  return {
    ctxState: globalThis.__nbAudioTap.ctx.state,
    howlerState: H?.state,
    locked: (H?._howls ?? []).filter((h) => h._playLock).map((h) => String(h._src).split('/').pop()),
    groupVols: (H?._howls ?? []).map((h) => [String(h._src).split('/').pop(), +h._volume.toFixed(4)]),
    starts: globalThis.__nbAudioTap.starts.length,
    frames: globalThis.__nbAudioTap.pcm.reduce((a, b) => a + b.data.length, 0),
  };
});
console.log(`after 3 gestureless plays: ${JSON.stringify(stillCold)}`);

/* THE ACTIVATION: a real click, which is what the reader's first press is. */
await p.evaluate(() => { globalThis.__nbTaste.open(); });
await p.waitForTimeout(600);
await p.mouse.click(20, 20);
await p.waitForTimeout(1500);
const afterGesture = await p.evaluate(() => {
  const H = globalThis.__nbSound.howlerGlobal();
  return { ctxState: globalThis.__nbAudioTap.ctx.state, howlerState: H?.state, starts: globalThis.__nbAudioTap.starts.length };
});
console.log(`after the first real click: ${JSON.stringify(afterGesture)}`);

/* Now walk the real panel to the sound question and press every chip. */
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
for (const chip of chips) {
  await chip.click().catch(() => undefined);
  await p.waitForTimeout(1800);
}
await p.waitForTimeout(800);

/* ─────────────────────────────── measure ────────────────────────────────── */

const report = await p.evaluate(() => {
  const tap = globalThis.__nbAudioTap;
  const sr = tap.sampleRate;
  const blocks = tap.pcm.slice().sort((a, b) => a.frame - b.frame);
  if (blocks.length === 0) return { why: 'recorder produced no audio', plays: [] };
  const frame0 = blocks[0].frame;
  const last = blocks[blocks.length - 1];
  const total = last.frame + last.data.length - frame0;
  const pcm = new Float32Array(total);
  let gaps = 0; let expect = frame0;
  for (const b of blocks) { if (b.frame !== expect) gaps++; pcm.set(b.data, b.frame - frame0); expect = b.frame + b.data.length; }

  const stats = (a, b) => {
    a = Math.max(0, a); b = Math.min(pcm.length, b);
    let peak = 0, sumsq = 0, maxStep = 0, big = 0, clip = 0;
    for (let i = a; i < b; i++) {
      const v = pcm[i]; const m = Math.abs(v);
      if (m > peak) peak = m;
      if (m >= 0.995) clip++;
      sumsq += v * v;
      if (i > a) { const d = Math.abs(v - pcm[i - 1]); if (d > maxStep) maxStep = d; if (d > 0.12) big++; }
    }
    return { peak: +peak.toFixed(5), rms: +Math.sqrt(sumsq / Math.max(1, b - a)).toFixed(6), maxStep: +maxStep.toFixed(5), big, clip };
  };

  const plays = tap.starts.map((s, n) => {
    const a = Math.max(0, Math.round(s.t * sr) - frame0 - Math.round(0.02 * sr));
    const b = a + Math.min(Math.round((s.bufDur || 0.3) * sr) + Math.round(0.2 * sr), 2 * sr);
    let before, after;
    for (let i = s.gainMark - 1; i >= 0; i--) if (tap.gains[i].id === s.gainId) { before = tap.gains[i]; break; }
    for (let i = s.gainMark; i < tap.gains.length; i++) {
      const gEv = tap.gains[i];
      if (gEv.id !== s.gainId) continue;
      if (gEv.now - s.t > 0.05) break;
      after = gEv; break;
    }
    const near = tap.howl.filter((h) => Math.abs(h.wall - s.wall) <= 40);
    return {
      n, url: String(s.url).split('/').pop().split('?')[0], t: +s.t.toFixed(4),
      startGain: before ? +before.value.toFixed(4) : null,
      fixGain: after ? +after.value.toFixed(4) : null,
      wrongForMs: before && after ? +((after.now - before.now) * 1000).toFixed(3) : null,
      lockedCalls: near.filter((h) => h.playLock).length,
      loadingCalls: near.filter((h) => h.state !== 'loaded').length,
      ...stats(a, b),
    };
  });
  return { sampleRate: sr, total, gaps, dead: blocks[blocks.length - 1].dead, plays, howlCalls: tap.howl.length };
});

writeFileSync(`${OUT}/cold.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.total} frames @ ${report.sampleRate} Hz · ${report.gaps} block gaps · ${report.dead} quanta with no input · ${report.plays.length} plays`);
const wrong = report.plays.filter((x) => x.startGain !== null && x.fixGain !== null && Math.abs(x.startGain - x.fixGain) > 0.02);
console.log(`voices that STARTED at a gain they were not asked to start at: ${wrong.length}/${report.plays.length}`);
console.log(['#', 'file', 'startG', 'fixG', 'wrongMs', 'lockedCalls', 'loadingCalls', 'peak', 'maxStep', 'big', 'clip'].join('\t'));
for (const x of report.plays) {
  console.log([x.n, x.url, x.startGain, x.fixGain, x.wrongForMs, x.lockedCalls, x.loadingCalls, x.peak, x.maxStep, x.big, x.clip].join('\t'));
}
console.log(`\nwrote ${OUT}/cold.json`);
await browser.close();
