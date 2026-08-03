/**
 * shots-now/sound-grit.mjs — CAPTURE the "jittery sand paper" defect.
 *
 * The reader: "when i click on studio its a nice tap when i click again to
 * close it becomes jittery sand paper (happens like maybe 2 times every 3
 * times)". A listening claim proves nothing, so this records the app's own
 * Web Audio output as PCM and measures every play.
 *
 * HOW THE TAP IS BUILT (and why it is built this way)
 * ──────────────────────────────────────────────────────────────────────────
 * `AudioNode.prototype.connect` is patched BEFORE any app script runs, so
 * every hop that howler (or `sound/filter.ts`) makes to `ctx.destination` is
 * re-pointed at a GainNode we own. That node is created synchronously inside
 * the patched connect — an AudioWorklet cannot be, and by the time an async
 * hook could run, howler has already wired its master gain. Once the page is
 * up we splice the worklet recorder in behind the sink:
 *
 *     masterGain ─▶ [filter…] ─▶ sink ─▶ recorder ─▶ destination
 *
 * The recorder is an AudioWorkletProcessor, NOT a ScriptProcessorNode: a
 * script processor runs on the main thread, and this app's main thread is
 * busy with Pixi — dropped blocks there would look exactly like the artefact
 * we are hunting and the measurement would be worthless.
 *
 * Every `AudioBufferSourceNode.start` is logged with the AudioContext time and
 * the file the buffer was decoded from (XHR response → AudioBuffer, tracked
 * through two WeakMaps), so each recorded burst can be attributed to a cue.
 * Every gain `setValueAtTime` is logged against the node it was written to, and
 * every bufferSource is tied to its own gain node when howler connects them —
 * that pairing is what makes "this voice began at X and was corrected to Y" a
 * fact about ONE play rather than about whatever happened next in the log.
 *
 * ── WHAT IT FOUND ────────────────────────────────────────────────────────
 * All 137 plays across five phases started at gain 1.000 and were pulled down
 * to 0.28–0.56 afterwards: howler writes the Howl's GROUP volume into a new
 * voice's gain node one statement before `bufferSource.start()`, and the
 * engine was setting the level per id after `play()` returned. Two
 * `setValueAtTime` calls at one AudioContext time replace each other and
 * nothing is heard; one render quantum apart and the cue opens 2–4× too loud
 * and steps mid-transient. Same control, one press clean and the next not.
 *
 * ── THE PHASES ───────────────────────────────────────────────────────────
 *   A  the reader's own gesture — the studio dock button, toggled N times
 *   B  one cue at a time, the clean baseline
 *   C  a cue every 120 ms — do voices stack into clipping (no: 1.2×)
 *   D  after the AudioContext has been suspended and resumed
 *   E  the SAME cue every 40 ms — the worst overlap the app can make
 *   F  the tour's "done" cue, and which files it actually reaches for
 *
 *   node shots-now/sound-grit.mjs [--url=http://localhost:1420] [--n=30]
 *
 * Exit code 1 when a play clips, jumps, starts at a level it was not asked to
 * start at, or when "done" rings a bell. It refuses to pass vacuously: zero
 * recorded plays is a failure, and so is a phase whose page reloaded under it.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const N = Number(opt('n', '30'));
const OUT = 'qa/sound';
mkdirSync(OUT, { recursive: true });

/* ───────────────────────── the in-page tap, verbatim ───────────────────── */

const INIT = `(() => {
  const g = globalThis;
  if (g.__nbAudioTap) return;

  // Other agents are editing src while this runs and every save makes Vite
  // call location.reload(), which throws the recorder out of the graph
  // mid-take. The tape has to come from ONE stable page, so a full reload is
  // refused; HMR patches still apply.
  try {
    const d = Object.getOwnPropertyDescriptor(Location.prototype, 'reload');
    if (d && d.configurable) {
      Object.defineProperty(Location.prototype, 'reload', {
        configurable: true,
        value: function () { g.__nbBlockedReloads = (g.__nbBlockedReloads || 0) + 1; },
      });
    }
  } catch {}

  const origConnect = AudioNode.prototype.connect;
  const origStart = AudioBufferSourceNode.prototype.start;
  const origSVAT = AudioParam.prototype.setValueAtTime;
  const origLinear = AudioParam.prototype.linearRampToValueAtTime;
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;

  const bufferUrl = new WeakMap();   // AudioBuffer  -> url
  const rawUrl = new WeakMap();      // ArrayBuffer  -> url
  const paramOwner = new WeakMap();  // AudioParam   -> {id, node}
  const srcGain = new WeakMap();     // AudioBufferSourceNode -> gain node id

  const tap = {
    origConnect,
    sinks: [],
    ctx: null,
    starts: [],
    gains: [],
    installed: false,
    pcm: [],          // {frame, data:Float32Array}
    sampleRate: 0,
    recFrame0: null,
  };
  g.__nbAudioTap = tap;

  // The listener is registered in open(), NOT in send(): howler assigns
  // xhr.onload between the two, and a property handler assigned later still
  // fires after a listener added earlier. Registering in send() meant howler
  // decoded the buffer before we could tag it, and every play came back
  // "(unknown)".
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__nbUrl = String(url);
    this.addEventListener('load', () => {
      try {
        if (this.response instanceof ArrayBuffer) rawUrl.set(this.response, this.__nbUrl);
      } catch {}
    });
    return origXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...a) {
    return origXhrSend.apply(this, a);
  };

  const patchDecode = (proto) => {
    const orig = proto.decodeAudioData;
    if (!orig || orig.__nbPatched) return;
    const wrapped = function (data, onOk, onErr) {
      const url = rawUrl.get(data) ?? '(unknown)';
      const tagIt = (buf) => { try { bufferUrl.set(buf, url); } catch {} return buf; };
      if (typeof onOk === 'function') {
        return orig.call(this, data, (buf) => { tagIt(buf); onOk(buf); }, onErr);
      }
      const p = orig.call(this, data);
      return p && p.then ? p.then(tagIt) : p;
    };
    wrapped.__nbPatched = true;
    proto.decodeAudioData = wrapped;
  };
  patchDecode(AudioContext.prototype);
  if (g.OfflineAudioContext) patchDecode(OfflineAudioContext.prototype);

  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      // howler builds a voice as bufferSource -> its own GainNode, and the
      // connect happens before the gain is written and before start(). Noting
      // the edge here is what lets a play be matched to ITS OWN gain events
      // instead of to whatever happened to be logged next — two cues fired in
      // one tick (a set's layer under its main cue) otherwise read as one cue
      // being corrected by the other's level.
      const own = paramOwner.get(dest && dest.gain);
      if (own && typeof AudioBufferSourceNode !== 'undefined' && this instanceof AudioBufferSourceNode) {
        srcGain.set(this, own.id);
      }
    } catch {}
    try {
      const ctx = this.context;
      if (dest && ctx && dest === ctx.destination) {
        let sink = ctx.__nbSink;
        if (!sink) {
          sink = ctx.createGain();
          sink.gain.value = 1;
          ctx.__nbSink = sink;
          tap.sinks.push(sink);
          tap.ctx = ctx;
          tap.sampleRate = ctx.sampleRate;
          origConnect.call(sink, ctx.destination);
        }
        return origConnect.call(this, sink, ...rest);
      }
    } catch {}
    return origConnect.call(this, dest, ...rest);
  };

  AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
    let url = '(no buffer)';
    let dur = 0;
    try {
      if (this.buffer) { url = bufferUrl.get(this.buffer) ?? '(untagged)'; dur = this.buffer.duration; }
    } catch {}
    const ctx = this.context;
    tap.starts.push({
      t: ctx.currentTime,
      when: when ?? 0,
      offset: offset ?? 0,
      duration: duration ?? null,
      bufDur: dur,
      rate: this.playbackRate.value,
      url,
      wall: Date.now(),
      // Which gain node this voice runs through, and where in the log it sits
      // — together they recover the level the sound STARTED at and the level
      // it was later corrected to, for this voice and no other.
      gainId: srcGain.get(this) ?? null,
      gainMark: tap.gains.length,
    });
    return origStart.call(this, when, offset, duration);
  };

  let gainSeq = 0;
  const origCreateGain = AudioContext.prototype.createGain;
  AudioContext.prototype.createGain = function (...a) {
    const node = origCreateGain.apply(this, a);
    try { paramOwner.set(node.gain, { id: 'g' + gainSeq++, node }); } catch {}
    return node;
  };

  AudioParam.prototype.setValueAtTime = function (value, when) {
    try {
      const own = paramOwner.get(this);
      if (own) tap.gains.push({ kind: 'set', id: own.id, value, when, now: own.node.context.currentTime });
    } catch {}
    return origSVAT.call(this, value, when);
  };
  AudioParam.prototype.linearRampToValueAtTime = function (value, when) {
    try {
      const own = paramOwner.get(this);
      if (own) tap.gains.push({ kind: 'ramp', id: own.id, value, when, now: own.node.context.currentTime });
    } catch {}
    return origLinear.call(this, value, when);
  };
})();`;

const WORKLET = `
class NbRec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(16384);
    this.n = 0;
    // Set on the FIRST render quantum, not in the constructor: a node can be
    // built several quanta before the graph starts pulling it, and a frame
    // index taken at construction would slide every window in the tape.
    this.frame0 = -1;
    this.dead = 0;
  }
  flush() {
    if (this.n === 0) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ frame: this.frame0, data: out, dead: this.dead }, [out.buffer]);
    this.frame0 += this.n;
    this.n = 0;
  }
  process(inputs, outputs) {
    if (this.frame0 < 0) this.frame0 = currentFrame;
    const inp = inputs[0];
    const out = outputs[0];
    const a = inp && inp[0] ? inp[0] : null;
    const b = inp && inp[1] ? inp[1] : null;
    if (!a) this.dead++;
    const len = 128;
    for (let i = 0; i < len; i++) {
      let v = 0;
      if (a) v += a[i];
      if (b) v += b[i];
      if (a && b) v *= 0.5;
      this.buf[this.n++] = v;
      if (out && out[0]) out[0][i] = a ? a[i] : 0;
      if (out && out[1]) out[1][i] = b ? b[i] : (a ? a[i] : 0);
    }
    if (this.n >= this.buf.length - 256) this.flush();
    return true;
  }
}
registerProcessor('nb-rec', NbRec);
`;

/* ──────────────────────────────── drive it ─────────────────────────────── */

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await p.addInitScript(INIT);

// A reload throws the tap away. If one happens mid-run the numbers are not
// what they claim to be, so it is loud rather than silent.
let reloads = 0;
p.on('load', () => { reloads++; });
p.on('pageerror', (e) => console.log(`  page error: ${String(e).slice(0, 160)}`));

const poll = async (fn, ms = 60000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    if (await p.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await p.waitForTimeout(200);
  }
};

await p.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });

/**
 * Boot the app, make howler build its graph, splice the recorder in.
 * Re-runnable: a mid-run reload throws the tap away and this puts it back.
 */
async function ensureTap() {
  // Other agents edit src while this runs, and a half-written HMR update can
  // leave the page dead. Reload rather than time out on somebody else's edit.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await poll(() => globalThis.__nbSound !== undefined, 40000, 'sound engine bridge');
      await poll(() => document.querySelector('[data-shelf-dock="studio"]') !== null, 40000, 'shelf dock');
      break;
    } catch (err) {
      if (attempt === 3) throw err;
      console.log(`  boot attempt ${attempt + 1} failed (${String(err.message)}); reloading`);
      await p.waitForTimeout(2000);
      await p
        .goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 })
        .catch(() => undefined);
    }
  }
  const already = await p.evaluate(() => globalThis.__nbAudioTap?.installed === true);
  if (already) return;
  await p.evaluate(async () => { await globalThis.__nbSound.play('click-soft'); });
  await p.waitForTimeout(600);
  const spliced = await p.evaluate(async (workletSrc) => {
    const tap = globalThis.__nbAudioTap;
    const ctx = tap.ctx;
    if (!ctx) return { ok: false, why: 'no AudioContext ever connected to a destination' };
    if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
    const url = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const rec = new AudioWorkletNode(ctx, 'nb-rec', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
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
  if (!spliced.ok) {
    console.error(`FAIL: could not tap the audio graph — ${spliced.why}`);
    await browser.close();
    process.exit(1);
  }
  console.log(`tap installed: ctx ${spliced.state} @ ${spliced.sampleRate} Hz`);
  // Quiet the bed so each burst is the cue alone.
  await p.evaluate(() => globalThis.__nbSound.stopAmbient());
  await p.waitForTimeout(400);
}

await ensureTap();

/**
 * Play one cue, surviving a page the dev server replaced under us. Parallel
 * agents edit src while this runs; a lost page is a re-boot, not a crash.
 */
const playCue = async (name) => {
  for (let i = 0; i < 2; i++) {
    const ok = await p
      .evaluate((n) => { globalThis.__nbSound.play(n); return true; }, name)
      .catch(() => false);
    if (ok) return true;
    await ensureTap();
  }
  return false;
};

const clearTape = () =>
  p.evaluate(() => {
    const tap = globalThis.__nbAudioTap;
    tap.starts.length = 0;
    tap.gains.length = 0;
    tap.pcm.length = 0;
    tap.recFrame0 = null;
  });

/* ───────────────────────────── measure in page ─────────────────────────── */

/** Stitch the tape, window it by every logged start, measure each window. */
const MEASURE = () => {
  const tap = globalThis.__nbAudioTap;
  const sr = tap.sampleRate;
  const blocks = tap.pcm.slice().sort((a, b) => a.frame - b.frame);
  if (blocks.length === 0) return { plays: [], total: 0, why: 'recorder produced no audio' };
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

  // Every burst in the tape, found by energy — independent of when the main
  // thread THOUGHT a play started. `ctx.currentTime` on the main thread lags
  // the render thread, so a window anchored only on it slides off the cue and
  // reports a perfectly good play as silence.
  const FLOOR = 0.0006;
  const bursts = [];
  {
    let i = 0;
    const hold = Math.round(0.06 * sr);
    while (i < pcm.length) {
      if (Math.abs(pcm[i]) > FLOOR) {
        const a = i;
        let quiet = 0;
        let j = i;
        while (j < pcm.length && quiet < hold) {
          quiet = Math.abs(pcm[j]) > FLOOR ? 0 : quiet + 1;
          j++;
        }
        bursts.push({ a, b: j });
        i = j;
      } else i++;
    }
  }

  const plays = [];
  for (const s of tap.starts) {
    const startFrame = Math.round(s.t * sr) - frame0;
    const len = Math.min(Math.round((s.bufDur || 0.3) * sr) + Math.round(0.35 * sr), 2 * sr);
    const a = Math.max(0, startFrame - Math.round(0.02 * sr));
    const b = Math.min(pcm.length, a + len);
    if (b - a < 32) continue;
    let peak = 0;
    let clip = 0;
    let maxStep = 0;
    let bigSteps = 0;
    let sumsq = 0;
    let peakAt = 0;
    for (let i = a; i < b; i++) {
      const v = pcm[i];
      const m = Math.abs(v);
      if (m > peak) { peak = m; peakAt = i - a; }
      if (m >= 0.995) clip++;
      sumsq += v * v;
      if (i > a) {
        const d = Math.abs(v - pcm[i - 1]);
        if (d > maxStep) maxStep = d;
        if (d > 0.12) bigSteps++;
      }
    }
    // The gain the sound was STARTED at vs. the gain it was corrected to,
    // read out of the log for THIS voice's own gain node.
    let before;
    let after;
    for (let i = s.gainMark - 1; i >= 0; i--) {
      if (tap.gains[i].id === s.gainId) { before = tap.gains[i]; break; }
    }
    for (let i = s.gainMark; i < tap.gains.length; i++) {
      const g = tap.gains[i];
      if (g.id !== s.gainId) continue;
      // Only a correction lands in the same breath as the start; anything a
      // fade or a later play does to this node is a different event.
      if (g.now - s.t > 0.05) break;
      after = g;
      break;
    }
    plays.push({
      url: s.url.split('/').pop().split('?')[0],
      t: +s.t.toFixed(4),
      rate: +s.rate.toFixed(4),
      bufMs: Math.round(s.bufDur * 1000),
      peak: +peak.toFixed(5),
      peakAtMs: +((peakAt / sr) * 1000).toFixed(1),
      clip,
      maxStep: +maxStep.toFixed(5),
      bigSteps,
      rms: +Math.sqrt(sumsq / (b - a)).toFixed(6),
      startGain: before ? +before.value.toFixed(4) : null,
      startGainAt: before ? +before.now.toFixed(4) : null,
      fixGain: after ? +after.value.toFixed(4) : null,
      fixGainAt: after ? +after.now.toFixed(4) : null,
      // How long the sound ran at the wrong level, in whole render quanta.
      wrongForMs: before && after ? +(((after.now - before.now)) * 1000).toFixed(3) : null,
    });
  }
  // Same measurement, but over the bursts the tape actually contains — the
  // answer that owes nothing to main-thread clocks.
  const burstStats = bursts.map(({ a, b }) => {
    let peak = 0, clip = 0, maxStep = 0, bigSteps = 0, sumsq = 0;
    for (let i = a; i < b; i++) {
      const v = pcm[i];
      const m = Math.abs(v);
      if (m > peak) peak = m;
      if (m >= 0.995) clip++;
      sumsq += v * v;
      if (i > a) {
        const d = Math.abs(v - pcm[i - 1]);
        if (d > maxStep) maxStep = d;
        if (d > 0.12) bigSteps++;
      }
    }
    return {
      atMs: +(((a + frame0) / sr) * 1000).toFixed(1),
      ms: +(((b - a) / sr) * 1000).toFixed(1),
      peak: +peak.toFixed(5),
      clip,
      maxStep: +maxStep.toFixed(5),
      bigSteps,
      rms: +Math.sqrt(sumsq / (b - a)).toFixed(6),
    };
  });

  return {
    plays,
    bursts: burstStats,
    total,
    gaps,
    dead: blocks.length ? blocks[blocks.length - 1].dead : -1,
    sampleRate: sr,
    gainEvents: tap.gains.length,
    starts: tap.starts.length,
  };
};

const summarise = (label, report) => {
  const byFile = new Map();
  for (const pl of report.plays) {
    if (!byFile.has(pl.url)) byFile.set(pl.url, []);
    byFile.get(pl.url).push(pl);
  }
  console.log(`\n──── ${label} ────`);
  console.log(
    `${report.total} frames @ ${report.sampleRate} Hz, ${report.gaps} block gaps, ` +
      `${report.dead} quanta with no input, ${report.plays.length} plays, ${report.bursts?.length ?? 0} bursts in the tape`,
  );
  if (report.bursts?.length) {
    const bp = report.bursts.map((x) => x.peak);
    console.log(
      `  bursts: peak ${Math.min(...bp).toFixed(4)}..${Math.max(...bp).toFixed(4)}, ` +
        `clip ${report.bursts.reduce((a, x) => a + x.clip, 0)}, ` +
        `jumps ${report.bursts.reduce((a, x) => a + x.bigSteps, 0)}`,
    );
  }
  console.log(['file', 'n', 'peak lo..hi', 'spread', 'clip', 'jumps', 'startGain lo..hi'].join('\t'));
  for (const [file, list] of byFile) {
    const peaks = list.map((x) => x.peak);
    const sg = list.map((x) => x.startGain).filter((x) => x !== null);
    const lo = Math.min(...peaks);
    const hi = Math.max(...peaks);
    console.log(
      [
        file,
        list.length,
        `${lo.toFixed(4)}..${hi.toFixed(4)}`,
        `${(hi / Math.max(lo, 1e-9)).toFixed(2)}x`,
        list.reduce((a, x) => a + x.clip, 0),
        list.reduce((a, x) => a + x.bigSteps, 0),
        sg.length ? `${Math.min(...sg).toFixed(3)}..${Math.max(...sg).toFixed(3)}` : '-',
      ].join('\t'),
    );
  }
  return byFile;
};

/* ── phase A: the reader's own gesture, the studio button, N times ─────── */

await clearTape();
await p.waitForTimeout(250);

const reloadsBefore = reloads;
const studio = p.locator('[data-shelf-dock="studio"]');
let toggles = 0;
for (let i = 0; i < N; i++) {
  await studio.click({ force: true, timeout: 15000 }).then(
    () => { toggles++; },
    () => undefined,
  );
  await p.waitForTimeout(600);
}
await p.waitForTimeout(800);
const phaseA = reloads === reloadsBefore ? await p.evaluate(MEASURE) : { plays: [], total: 0, gaps: 0, sampleRate: 0, why: 'the page reloaded mid-phase' };
await p.screenshot({ path: `${OUT}/grit-studio.png` });

/* ── phase B: one cue, 30 times, nothing else in the way ──────────────── */

await ensureTap();
await clearTape();
await p.waitForTimeout(250);
for (let i = 0; i < N; i++) {
  await playCue('click-soft');
  await p.waitForTimeout(450);
}
await p.waitForTimeout(700);
const phaseB = await p.evaluate(MEASURE);

/* ── phase C: the same cue hammered — overlapping voices, if any ───────── */

await ensureTap();
await clearTape();
await p.waitForTimeout(250);
for (let i = 0; i < N; i++) {
  await playCue('pop-soft');
  await p.waitForTimeout(120);
}
await p.waitForTimeout(700);
const phaseC = await p.evaluate(MEASURE);

/* ── phase D: the context suspended between presses ────────────────────── */
/* howler's autoSuspend puts the graph to sleep after 30 s of quiet, and the
 * resume path defers the play AND queues the level correction behind it. This
 * is the same code path, forced. */

await ensureTap();
await clearTape();
await p.waitForTimeout(250);
for (let i = 0; i < 10; i++) {
  await p.evaluate(async () => {
    const H = globalThis.__nbSound.howlerGlobal();
    await H.ctx.suspend();
    globalThis.Howler && (globalThis.Howler.state = 'suspended');
  }).catch(() => undefined);
  await p.waitForTimeout(200);
  await playCue('click-soft');
  await p.waitForTimeout(500);
}
await p.waitForTimeout(700);
const phaseD = await p.evaluate(MEASURE);

/* ── phase E: the SAME cue retriggered inside its own length ───────────── */

await ensureTap();
await clearTape();
await p.waitForTimeout(250);
for (let i = 0; i < N; i++) {
  await playCue('click-soft');
  await p.waitForTimeout(40);
}
await p.waitForTimeout(700);
const phaseE = await p.evaluate(MEASURE);

/* ── phase F: the tour's "you did the thing" — which FILES actually sound ─ */
/* A voicing table proves nothing about what the app can reach. This drives
 * the real engine and reads the decoded file names off the tape. */

await ensureTap();
await clearTape();
await p.waitForTimeout(250);
for (let i = 0; i < 10; i++) {
  await playCue('check-done');
  await p.waitForTimeout(700);
}
await p.waitForTimeout(700);
const phaseF = await p.evaluate(MEASURE);

writeFileSync(
  `${OUT}/grit-report.json`,
  JSON.stringify({ toggles, phaseA, phaseB, phaseC, phaseD, phaseE, phaseF }, null, 2),
);

console.log(`\n${toggles}/${N} studio toggles landed`);
summarise('A — studio button toggled', phaseA);
summarise('B — click-soft, one at a time', phaseB);
summarise('C — pop-soft every 120 ms', phaseC);
summarise('D — after the context was suspended', phaseD);
summarise('E — click-soft every 40 ms (same cue, overlapping)', phaseE);
summarise('F — the tour\'s "done" cue', phaseF);

// The reader: "the sound effects for onboarding when completing a task is very
// weird, its like a metal tong". `check-done`'s own takes ARE a struck metal
// bell; the house voicing now answers "done" in wood with a settle under it.
// Assert on the files the running app actually decoded and played.
const doneFiles = new Set(phaseF.plays.map((x) => x.url.replace(/-\d+\.wav$|\.wav$/, '')));
const rang = [...doneFiles].filter((f) => f === 'check-done' || f === 'chime-hour');
const wood = [...doneFiles].filter((f) => f === 'pop-soft' || f === 'drop-thump');
console.log(`\ntour "done" played: ${[...doneFiles].join(', ') || '(nothing)'}`);
const doneWrong =
  phaseF.plays.length === 0 || rang.length > 0 || wood.length < 2;
if (doneWrong) {
  console.log(
    `  FAILED: expected wood (pop-soft with a drop-thump under it) and no bell — ` +
      `got ${phaseF.plays.length} plays, bell: [${rang.join(', ')}], wood: [${wood.join(', ')}]`,
  );
}

const all = [...phaseA.plays, ...phaseB.plays, ...phaseC.plays, ...phaseD.plays, ...phaseE.plays, ...phaseF.plays];
if (all.length === 0) {
  console.error('\nFAIL: recorded no plays at all — the probe proved nothing.');
  await browser.close();
  process.exit(1);
}
const bad = all.filter((x) => x.clip > 0 || x.bigSteps > 0);
// The ambient bed is deliberately started silent and faded up, so its own
// first gain event is 0 and a later one is the bed's level. That is a fade,
// not a correction, and it is the only cue allowed to move after it starts.
const cues = all.filter((x) => !x.url.startsWith('ambient-') && x.bufMs > 0);
const mislevelled = cues.filter(
  (x) => x.startGain !== null && x.fixGain !== null && Math.abs(x.startGain - x.fixGain) > 0.02,
);
console.log(`\n${bad.length}/${all.length} plays clipped or jumped`);
console.log(
  `${mislevelled.length}/${cues.length} cues STARTED at a level they were then corrected away from`,
);
for (const x of mislevelled.slice(0, 8)) console.log('  ' + JSON.stringify(x));
console.log(`\nfull report: ${OUT}/grit-report.json`);

const failed = bad.length > 0 || mislevelled.length > 0 || doneWrong;
console.log(
  failed
    ? '\nFAIL'
    : '\nPASS — every recorded cue began at the level it ended at, and "done" no longer rings',
);
await browser.close();
process.exit(failed ? 1 : 0);
