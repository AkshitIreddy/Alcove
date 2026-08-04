/**
 * scripts/probe-sound-clip.mjs — does the bus actually clip when cues overlap?
 *
 * The reader hears static in two places and named the distinction himself:
 * *"it's a sound rendering bug, not a sound source quality problem"*. He is
 * right that it is not the recordings — `scripts/audit-sounds.mjs` measured all
 * 66 and none clips, none carries DC, none starts or ends mid-waveform. So the
 * question is what happens to them on the way OUT, and the reproducible case he
 * gave is the sound-set picker: *"when you select a profile it plays sounds in
 * rapid succession, which causes some of them to sound like static"*.
 *
 * Static from clean sources almost always means SUMMING PAST FULL SCALE. Web
 * Audio does not limit; it hands the sum to the device, which wraps or crushes
 * it. So this taps the real graph — Howler's own AudioContext, in the running
 * app — with an AnalyserNode on the master, fires the real preview at the real
 * rate a reader clicks, and reports the peak sample the destination actually
 * sees.
 *
 * Measuring rather than reasoning, because the arithmetic is ambiguous: each cue
 * peaks near 0.32, which says four together clip and two do not, and whether
 * four are ever in flight together depends on cue lengths and click timing.
 *
 *   npm run dev
 *   node scripts/probe-sound-clip.mjs
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    // Let the graph run without a gesture, and give it a real output device so
    // Howler does not park the context in 'suspended'.
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

console.log('1. boot');
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.waitForTimeout(3000);

/**
 * Put an analyser between Howler's master gain and the destination.
 *
 * Howler exposes `Howler.ctx` and `Howler.masterGain`. Reading the peak off the
 * master is the honest place: it is after every voice has been summed and after
 * the group volumes, and before the device — exactly where clipping would
 * happen.
 */
console.log('2. tap the master bus');
const tapped = await page.evaluate(async () => {
  const mod = await import('/src/sound/engine.ts');
  // Force the graph to exist before tapping it.
  await mod.play('click-soft');
  const H = globalThis.Howler;
  if (H === undefined || H.ctx === undefined) return { ok: false, why: 'no Howler.ctx' };
  const an = H.ctx.createAnalyser();
  an.fftSize = 2048;
  H.masterGain.connect(an);
  globalThis.__an = an;
  // How section 7 asks 'is the bus alive'. An analyser fed by masterGain
  // stops receiving samples the moment masterGain is disconnected, so a
  // silent frame WHILE A CUE IS SOUNDING is the gap that makes the crack.
  globalThis.__busOutputs = () => {
    const b = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(b);
    let energy = 0;
    for (let i = 0; i < b.length; i += 1) energy += Math.abs(b[i]);
    return energy > 0 ? 1 : 0;
  };
  globalThis.__buf = new Float32Array(an.fftSize);
  return { ok: true, state: H.ctx.state, master: H.masterGain.gain.value };
});
console.log('  ', JSON.stringify(tapped));
if (!tapped.ok) {
  console.log('   cannot measure without the graph — is sound muted in settings?');
  await browser.close();
  process.exit(2);
}

/**
 * Watch the master for `ms`: the largest |sample|, and how NOISY the sum is.
 *
 * Peak answers "is it clipping". Spectral flatness answers "does it sound like
 * static", and they are different questions — a wash of several noise-based
 * cues at once is nowhere near full scale and is exactly what a reader would
 * call static. Flatness is the geometric mean of the spectrum over its
 * arithmetic mean: ~0 for a pure tone, toward 1 for white noise. Only the
 * frames with real signal in them are counted, or silence between beats drags
 * the average down and hides the thing being looked for.
 */
const watch = (ms) =>
  page.evaluate(async (dur) => {
    const an = globalThis.__an;
    const buf = globalThis.__buf;
    const spec = new Float32Array(an.frequencyBinCount);
    let peak = 0;
    let over = 0;
    let flatSum = 0;
    let flatFrames = 0;
    let worstFlat = 0;
    const until = performance.now() + dur;
    while (performance.now() < until) {
      an.getFloatTimeDomainData(buf);
      let framePeak = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const a = Math.abs(buf[i]);
        if (a > framePeak) framePeak = a;
        if (a >= 0.999) over += 1;
      }
      if (framePeak > peak) peak = framePeak;

      if (framePeak > 0.01) {
        an.getFloatFrequencyData(spec);      // dBFS
        let logSum = 0;
        let linSum = 0;
        let n = 0;
        for (let k = 1; k < spec.length; k += 1) {
          const mag = Math.pow(10, spec[k] / 20);
          logSum += Math.log(mag + 1e-12);
          linSum += mag;
          n += 1;
        }
        const flat = linSum > 0 ? Math.exp(logSum / n) / (linSum / n) : 0;
        flatSum += flat;
        flatFrames += 1;
        if (flat > worstFlat) worstFlat = flat;
      }
      await new Promise((r) => setTimeout(r, 8));
    }
    return {
      peak,
      over,
      flat: flatFrames > 0 ? flatSum / flatFrames : 0,
      worstFlat,
      frames: flatFrames,
    };
  }, ms);

const say = (label, r) =>
  console.log(
    `   ${r.peak >= 0.999 ? 'CLIPS' : 'ok   '}  ${label.padEnd(38)} ` +
      `peak ${r.peak.toFixed(3)}   flatness ${r.flat.toFixed(3)} (worst ${r.worstFlat.toFixed(3)})` +
      (r.over > 0 ? `  ${r.over} samples at full scale` : ''),
  );

console.log('\n3. one cue on its own — the control');
await page.evaluate(async () => {
  const m = await import('/src/sound/engine.ts');
  await m.play('click-soft');
});
say('a single click', await watch(500));

console.log('\n4. one whole preview signature, undisturbed');
await page.evaluate(async () => {
  const p = await import('/src/sound/preview.ts');
  p.previewSoundSet();
});
say('previewSoundSet() once', await watch(1600));

console.log('\n5. the reader’s case: chips pressed in rapid succession');
for (const gap of [300, 200, 120]) {
  await page.evaluate(async (g) => {
    const p = await import('/src/sound/preview.ts');
    for (let i = 0; i < 6; i += 1) {
      p.previewSoundSet();
      await new Promise((r) => setTimeout(r, g));
    }
  }, gap);
  say(`six chips ${gap}ms apart`, await watch(1800));
}

console.log('\n6. and the tour: a step cue fired repeatedly');
await page.evaluate(async () => {
  const m = await import('/src/sound/engine.ts');
  for (let i = 0; i < 8; i += 1) {
    void m.play('check-done');
    await new Promise((r) => setTimeout(r, 90));
  }
});
say('eight check-done 90ms apart', await watch(1800));


/*
 * 7. The actual defect: does changing the SET break the bus mid-render?
 *
 * Neither measurement above can see this. A gap in the graph is not a loud
 * sample or a noisy one, it is a MISSING one, and it lasts a single render
 * quantum — 128 frames, about 2.7 ms at 48 kHz. Polling an AnalyserNode from
 * the main thread cannot catch that, and the first attempt to do so reported
 * "the bus stayed connected" against the BROKEN code exactly as happily as
 * against the fixed one. A check that passes for the wrong reason is worse than
 * no check, so it was thrown away rather than kept for the comfort.
 *
 * This tap is a ScriptProcessorNode, which is handed EVERY block the graph
 * renders. It records each block's energy, and a dropout shows up as a block of
 * exact silence with signal on both sides of it. It is spliced
 * masterGain -> tap -> destination, so when masterGain is disconnected the tap
 * keeps being called and reports silence — which is the whole point.
 */
console.log('\n7. changing the sound set while a cue is still ringing');
const gapReport = await page.evaluate(async () => {
  const engine = await import('/src/sound/engine.ts');
  const prefs = await import('/src/sound/soundSetPrefs.ts');
  const sets = await import('/src/sound/soundSets.ts');
  const H = globalThis.Howler;
  const ctx = H.ctx;

  const tap = ctx.createScriptProcessor(256, 2, 2);
  const blocks = [];
  tap.onaudioprocess = (e) => {
    const inp = e.inputBuffer.getChannelData(0);
    let energy = 0;
    for (let i = 0; i < inp.length; i += 1) energy += Math.abs(inp[i]);
    blocks.push(energy);
    e.outputBuffer.getChannelData(0).set(inp);          // pass through
    if (e.outputBuffer.numberOfChannels > 1) {
      e.outputBuffer.getChannelData(1).set(e.inputBuffer.getChannelData(1));
    }
  };
  H.masterGain.connect(tap);
  tap.connect(ctx.destination);

  for (const id of sets.SOUND_SET_IDS.slice(0, 6)) {
    void engine.play('page-flip');
    await new Promise((r) => setTimeout(r, 70));
    await prefs.saveSoundSet(id);        // the act that used to rewire the bus
    void engine.play('book-pull');
    await new Promise((r) => setTimeout(r, 160));
  }
  await new Promise((r) => setTimeout(r, 300));
  tap.disconnect();
  try {
    H.masterGain.disconnect(tap);
  } catch {
    // already gone
  }

  // Silence at the head or tail is just the gap between cues; only a silent
  // block with LOUD NEIGHBOURS on both sides is a hole punched in a sound.
  let dropouts = 0;
  for (let i = 1; i < blocks.length - 1; i += 1) {
    if (blocks[i] === 0 && blocks[i - 1] > 1e-4 && blocks[i + 1] > 1e-4) dropouts += 1;
  }
  return { dropouts, blocks: blocks.length, loud: blocks.filter((b) => b > 1e-4).length };
});
console.log(
  `   ${gapReport.dropouts > 0 ? 'DROPOUT' : 'ok     '}  ` +
    `${gapReport.dropouts} silent block(s) with signal either side ` +
    `(${gapReport.loud} of ${gapReport.blocks} blocks carried audio)`,
);
if (gapReport.loud < 20) {
  console.log('   NOT A RESULT — too little audio was captured for this to mean anything');
}
console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
