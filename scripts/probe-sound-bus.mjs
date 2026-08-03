/**
 * scripts/probe-sound-bus.mjs — does a set's filter lever actually filter?
 *
 * `src/sound/filter.ts` claims it cuts into howler's own Web Audio graph and
 * installs a real BiquadFilterNode chain between `Howler.masterGain` and
 * `ctx.destination`. That claim is exactly the kind that unit tests cannot
 * settle: a stub AudioContext will happily report whatever `connect()` calls
 * we made without a single sample passing through anything.
 *
 * So this probe MEASURES. In the running app, with howler's real context:
 *
 *   1. pick a set that declares a filter (`next-room`, one lowpass at 1.5 kHz)
 *   2. feed a tone into `Howler.masterGain` — the exact node every playing
 *      sound in the app connects to
 *   3. read an AnalyserNode on the masterGain output (PRE) and another on the
 *      tail of the installed chain (POST)
 *   4. report the difference at that tone's frequency
 *
 * A set with no filter must show ~0 dB of difference and report `installed:
 * false`; `next-room` must show a deep cut at 8 kHz and almost none at 300 Hz.
 * The nodes are also asked for their own `getFrequencyResponse()`, which is
 * the browser's biquad maths on the node that is actually wired, so the
 * measured figure has something independent to agree with.
 *
 * Usage: node scripts/probe-sound-bus.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    // Web Audio otherwise starts suspended and nothing is ever rendered.
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});

const poll = async (fn, timeout = 60000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(200);
  }
};

const ready = async () => {
  await poll(() => globalThis.__nbSound !== undefined, 120000, 'sound engine bridge');
  await poll(() => globalThis.__nbSoundSets !== undefined, 120000, 'sound-set bridge');
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await ready();

/**
 * One measurement. Runs entirely in the page so the nodes never cross the
 * bridge: pick the set, force howler to build its graph, then tone-in /
 * analyse-out either side of the installed chain.
 */
const measureOnce = async (setId, freq) =>
  page.evaluate(
    async ([setId, freq]) => {
      const sound = globalThis.__nbSound;
      const sets = globalThis.__nbSoundSets;
      await sets.save(setId);
      // Howler builds its AudioContext on first play; the engine re-checks the
      // bus filter right after, which is the moment we are testing.
      await sound.play('click-soft', { volume: 0 });
      await new Promise((r) => setTimeout(r, 300));

      const howler = sound.howlerGlobal();
      const ctx = howler?.ctx ?? null;
      const master = howler?.masterGain ?? null;
      const nodes = sound.busFilterNodes();
      const state = sound.getState();
      if (ctx === null || master === null) {
        return { setId, freq, error: 'no web audio context', state: state.filter };
      }
      if (ctx.state === 'suspended') await ctx.resume();

      /**
       * Wait `seconds` of AUDIO time, not wall-clock time.
       *
       * This is the whole difference between a probe that measures and one
       * that reports NaN. A freshly built AudioContext answers `state ===
       * 'running'` before its render thread has produced a single quantum —
       * measured here, `ctx.currentTime` advanced 0.011 s across a 500 ms
       * `setTimeout` on the first set — and an AnalyserNode that has never
       * been fed returns -Infinity in every bin. Sleeping on the wall clock
       * therefore read silence, `post - pre` came out NaN, and the probe
       * failed the very claim it exists to confirm. `ctx.currentTime` only
       * moves when audio has actually been rendered, so it is the honest
       * clock to wait on; the wall-clock cap is there so a context that never
       * starts fails loudly instead of hanging.
       */
      const waitAudio = async (seconds, capMs = 5000) => {
        const from = ctx.currentTime;
        const wall = Date.now();
        while (ctx.currentTime - from < seconds) {
          if (Date.now() - wall > capMs) return false;
          await new Promise((r) => setTimeout(r, 25));
        }
        return true;
      };

      // Prove the render thread is alive BEFORE anything is measured.
      const clockRunning = await waitAudio(0.05);

      const mk = () => {
        const a = ctx.createAnalyser();
        a.fftSize = 8192;
        a.smoothingTimeConstant = 0;
        return a;
      };
      const pre = mk();
      const post = mk();
      master.connect(pre);
      const tail = nodes.length > 0 ? nodes[nodes.length - 1] : master;
      tail.connect(post);

      // A tone straight into the node every playing sound connects to.
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const trim = ctx.createGain();
      trim.gain.value = 0.25;
      osc.connect(trim);
      trim.connect(master);
      osc.start();
      // Long enough that the analyser's whole 8192-sample window (~0.17 s at
      // 48 kHz) is full of the tone and nothing before it.
      const toneRendered = await waitAudio(0.4);

      const read = (analyser) => {
        const bins = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(bins);
        const hz = ctx.sampleRate / 2 / bins.length;
        const at = Math.round(freq / hz);
        let peak = -Infinity;
        for (let i = Math.max(0, at - 2); i <= Math.min(bins.length - 1, at + 2); i += 1) {
          if (bins[i] > peak) peak = bins[i];
        }
        return peak;
      };
      let preDb = read(pre);
      let postDb = read(post);
      // One more render's worth if the window still looks like silence: the
      // analyser is fed by the same thread we just waited on, and reading it
      // one quantum early is the difference between a number and -Infinity.
      for (let i = 0; i < 4 && !Number.isFinite(preDb); i += 1) {
        await waitAudio(0.2);
        preDb = read(pre);
        postDb = read(post);
      }

      osc.stop();
      osc.disconnect();
      trim.disconnect();
      master.disconnect(pre);
      tail.disconnect(post);

      // The browser's own biquad maths on the nodes that are actually wired.
      let predictedDb = 0;
      for (const node of nodes) {
        const mag = new Float32Array(1);
        const phase = new Float32Array(1);
        node.getFrequencyResponse(new Float32Array([freq]), mag, phase);
        predictedDb += 20 * Math.log10(Math.max(mag[0], 1e-9));
      }

      return {
        setId,
        freq,
        sampleRate: ctx.sampleRate,
        stages: nodes.map((n) => `${n.type}@${Math.round(n.frequency.value)}Hz/Q${n.Q.value.toFixed(2)}${n.gain.value === 0 ? '' : `${n.gain.value > 0 ? '+' : ''}${n.gain.value}dB`}`),
        state: state.filter,
        preDb,
        postDb,
        measuredDb: postDb - preDb,
        predictedDb,
        // Did the rig itself work? A measurement taken off a graph that never
        // rendered must be reported as a broken rig, not as a filter result.
        clockRunning,
        toneRendered,
        live: Number.isFinite(preDb) && preDb > -120,
      };
    },
    [setId, freq],
  );

/**
 * The dev server reloads the page when a module it has served changes, and a
 * measurement takes ~800 ms of real time. One retry after re-establishing the
 * bridges is the difference between a probe you can run while you work and one
 * that only passes on a quiet tree.
 */
const measure = async (setId, freq) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await measureOnce(setId, freq);
    } catch (err) {
      if (attempt >= 2) throw err;
      console.log(`  …retrying ${setId} @ ${freq} Hz (${String(err).split('\n')[0]})`);
      await page.waitForTimeout(1500);
      await ready();
    }
  }
};

const rows = [];
for (const [setId, freq] of [
  ['house', 300],
  ['house', 8000],
  ['far-room', 300],
  ['far-room', 8000],
  ['music-box', 120],
  ['music-box', 3200],
  // A set with no `filter` of its own, inheriting its group's.
  ['drafting-table', 60],
]) {
  rows.push(await measure(setId, freq));
}

let bad = 0;
const say = (ok, line) => {
  if (!ok) bad += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${line}`);
};

console.log('\nmaster-bus filter, measured through howler\'s own graph\n');
for (const r of rows) {
  if (r.error !== undefined) {
    say(false, `${r.setId} @ ${r.freq} Hz — ${r.error}`);
    continue;
  }
  console.log(
    `${r.setId.padEnd(10)} @ ${String(r.freq).padStart(5)} Hz  ` +
      `installed=${r.state.installed}  wanted="${r.state.wanted}"  wired=[${r.stages.join(' + ')}]`,
  );
  console.log(
    `${''.padEnd(10)}    pre ${r.preDb.toFixed(1)} dB   post ${r.postDb.toFixed(1)} dB   ` +
      `measured ${r.measuredDb.toFixed(1)} dB   biquad says ${r.predictedDb.toFixed(1)} dB`,
  );

  // The rig before the result. Every dB below is read off an AnalyserNode, and
  // an analyser on a graph that has not rendered says -Infinity in every bin —
  // which subtracts to NaN and quietly fails whatever it is compared against.
  // So say plainly whether the tone was there at all.
  say(
    r.live,
    r.live
      ? `${r.setId} @ ${r.freq} Hz — the rig heard the tone (pre ${r.preDb.toFixed(1)} dB)`
      : `${r.setId} @ ${r.freq} Hz — RIG FAILURE: the analyser read silence ` +
          `(clock running: ${r.clockRunning}, tone rendered: ${r.toneRendered}). ` +
          'Nothing below this line is a measurement of the filter.',
  );

  if (r.setId === 'house') {
    say(r.state.installed === false, 'house declares no filter, so none is installed');
    // Not a measurement, and it would be dishonest to print it as one: with no
    // chain installed `tail === master`, so both analysers tap the SAME node
    // and the difference is 0 by construction. What is worth asserting is that
    // howler's own wiring is what the tone is passing through — i.e. that no
    // biquad exists — which is `nodes.length` and `installed === false` above.
    say(r.stages.length === 0, 'house leaves howler\'s own masterGain → destination hop alone');
  } else {
    say(r.state.installed === true, `${r.setId} installed a real chain`);
    say(
      Math.abs(r.measuredDb - r.predictedDb) < 3,
      `measured (${r.measuredDb.toFixed(1)} dB) agrees with the node's own response ` +
        `(${r.predictedDb.toFixed(1)} dB) within 3 dB`,
    );
  }
}

const at = (setId, freq) => rows.find((r) => r.setId === setId && r.freq === freq);

const cut = at('far-room', 8000);
const keep = at('far-room', 300);
if (cut?.error === undefined && keep?.error === undefined) {
  say(cut.measuredDb < -20, `far-room takes 8 kHz down ${cut.measuredDb.toFixed(1)} dB`);
  say(keep.measuredDb > -2, `far-room leaves 300 Hz alone (${keep.measuredDb.toFixed(1)} dB)`);
}
const box = at('music-box', 120);
const boxTop = at('music-box', 3200);
if (box?.error === undefined && boxTop?.error === undefined) {
  say(box.measuredDb < -12, `music-box takes the body out at 120 Hz (${box.measuredDb.toFixed(1)} dB)`);
  say(boxTop.measuredDb > 1, `music-box lifts 3.2 kHz (${boxTop.measuredDb.toFixed(1)} dB)`);
}
const inherited = at('drafting-table', 60);
if (inherited?.error === undefined) {
  say(
    inherited.state.installed === true && inherited.measuredDb < -15,
    `drafting-table inherits the studio group's highpass (${inherited.measuredDb.toFixed(1)} dB at 60 Hz)`,
  );
}

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}× ${k}`);
}

console.log(bad === 0 ? '\nALL CHECKS PASSED' : `\n${bad} CHECK(S) FAILED`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
