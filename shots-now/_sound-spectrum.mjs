/**
 * shots-now/_sound-spectrum.mjs — a NULL TEST, not a click detector.
 *
 * The three tapes before this one measured max |x[n]-x[n-1]|, holes, clipping
 * and truncated tails, and found the onboarding clean. That is the right test
 * for a CLICK and the wrong test for STATIC: broadband hiss riding under a cue
 * never trips a step threshold, and low-level aliasing from a resampled buffer
 * never trips one either.
 *
 * So this asks a different question. For every play the app makes, the file,
 * the playback rate and the gain are all known from the tap. That is enough to
 * RENDER THE SAME PLAY OFFLINE — same AudioBuffer, same playbackRate, same
 * gain, same master-bus biquads — and compare the two in the frequency domain.
 * Energy in the tape that the reference cannot account for is the app's own,
 * and that is what "a sound rendering bug" would look like.
 *
 * Also measures the floor BETWEEN cues with the bed stopped: with nothing
 * playing the graph must emit exact zeros, and anything else is a source of
 * hiss that no per-play measurement would ever find.
 *
 *   node shots-now/_sound-spectrum.mjs [--url=http://localhost:1420]
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
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const p = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await p.addInitScript(INIT);
p.on('pageerror', (e) => console.log(`  page error: ${String(e).slice(0, 200)}`));
/*
 * Other agents edit src while this runs and the dev server replaces the page
 * under the tap. A take that lost its recorder is not a quiet take, so this is
 * loud and the run is abandoned rather than reported as evidence.
 */
let loads = 0;
p.on('load', () => { loads++; if (loads > 1) console.log(`  ! page reloaded (${loads}) — tape is void`); });
const bail = async (why) => { console.error(`ABANDONED: ${why}`); await browser.close(); process.exit(2); };

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
  if (!ctx) return { ok: false, why: 'no ctx' };
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
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
  globalThis.__nbRec = rec; // keep it reachable; a collected node stops feeding
  return { ok: true, state: ctx.state, sampleRate: ctx.sampleRate };
}, WORKLET);
console.log(`tap: ${JSON.stringify(spliced)}`);
if (!spliced.ok) { await browser.close(); process.exit(1); }
await p.evaluate(HOWL_HOOK);
await p.evaluate(() => globalThis.__nbSound.stopAmbient());
await p.waitForTimeout(600);

/* Walk to the sound question and press every chip, as a reader would. */
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
await p.evaluate(() => { const t = globalThis.__nbAudioTap; t.pcm.length = 0; t.starts.length = 0; t.gains.length = 0; t.recFrame0 = null; });

/*
 * Press every chip first — so each set's files are decoded and its filter has
 * been wired and re-wired exactly as the onboarding does it — and THEN sound
 * each role alone. The null test needs one cue per burst; the preview's four
 * beats land 260 ms apart and merge into one, which is a mix and not
 * comparable to a single-source reference render.
 */
for (const chip of chips) { await chip.click().catch(() => undefined); await p.waitForTimeout(2000); }
await p.waitForTimeout(1200);
if (loads > 1) await bail('the page reloaded during the warm-up walk');

const ROLES = ['click-soft', 'page-flip', 'book-pull', 'check-done', 'pop-soft', 'tick-hover', 'drop-thump'];
for (let i = 0; i < chips.length; i++) {
  await chips[i].click().catch(() => undefined);
  await p.waitForTimeout(1800);
  const set = await p.evaluate(() => globalThis.__nbSound.getState().baseSet);
  for (const role of ROLES) {
    await p.evaluate((r) => { void globalThis.__nbSound.play(r); }, role);
    await p.waitForTimeout(1500);
  }
  console.log(`  sounded ${ROLES.length} roles alone under set "${set}"`);
  if (loads > 1) await bail('the page reloaded mid-take');
}
await p.waitForTimeout(1000);
const tapeSize = await p.evaluate(() => ({ blocks: globalThis.__nbAudioTap.pcm.length, starts: globalThis.__nbAudioTap.starts.length }));
console.log(`tape: ${JSON.stringify(tapeSize)}`);
if (tapeSize.blocks === 0) await bail('recorder produced nothing');

/* ────────────────────────── the null test, in page ─────────────────────── */

const report = await p.evaluate(async () => {
  const tap = globalThis.__nbAudioTap;
  const sr = tap.sampleRate;
  const blocks = tap.pcm.slice().sort((a, b) => a.frame - b.frame);
  const frame0 = blocks[0].frame;
  const lastB = blocks[blocks.length - 1];
  const total = lastB.frame + lastB.data.length - frame0;
  const pcm = new Float32Array(total);
  for (const b of blocks) pcm.set(b.data, b.frame - frame0);

  /* ---- radix-2 FFT, real input ---- */
  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  };
  const EDGES = [0, 500, 2000, 6000, 12000, 20000, 24000];
  /** Energy per band, normalised so the bands sum to 1 — shape, not level. */
  const bands = (buf, a, b) => {
    const N = 8192;
    const re = new Float64Array(N), im = new Float64Array(N);
    const n = Math.min(N, b - a);
    for (let i = 0; i < n; i++) re[i] = buf[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    fft(re, im);
    const out = new Array(EDGES.length - 1).fill(0);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sr) / N;
      const e = re[k] * re[k] + im[k] * im[k];
      for (let bnd = 0; bnd < out.length; bnd++) if (f >= EDGES[bnd] && f < EDGES[bnd + 1]) { out[bnd] += e; break; }
    }
    const sum = out.reduce((x, y) => x + y, 0) || 1;
    return { frac: out.map((x) => +(x / sum).toFixed(5)), energy: sum };
  };

  /* ---- the bursts the tape actually contains ---- */
  const FLOOR = 0.0006;
  const bursts = [];
  { let i = 0; const hold = Math.round(0.08 * sr);
    while (i < pcm.length) {
      if (Math.abs(pcm[i]) > FLOOR) {
        const a = i; let quiet = 0; let j = i;
        while (j < pcm.length && quiet < hold) { quiet = Math.abs(pcm[j]) > FLOOR ? 0 : quiet + 1; j++; }
        bursts.push([a, j]); i = j;
      } else i++;
    }
  }

  /* ---- the floor BETWEEN bursts: with the bed stopped it must be zero ---- */
  let nonZeroQuiet = 0, quietPeak = 0, quietSamples = 0;
  { let prev = 0;
    for (const [a, b] of bursts) {
      for (let i = prev; i < a; i++) { quietSamples++; const m = Math.abs(pcm[i]); if (m > 0) nonZeroQuiet++; if (m > quietPeak) quietPeak = m; }
      prev = b;
    }
    for (let i = prev; i < pcm.length; i++) { quietSamples++; const m = Math.abs(pcm[i]); if (m > 0) nonZeroQuiet++; if (m > quietPeak) quietPeak = m; }
  }

  /* ---- the reference: the same play, rendered offline ---- */
  const filterTag = globalThis.__nbSound.getState().filter;
  const cache = new Map();
  const decode = async (url) => {
    if (cache.has(url)) return cache.get(url);
    const res = await fetch(url);
    const ab = await res.arrayBuffer();
    const oc = new OfflineAudioContext(1, 128, sr);
    const buf = await oc.decodeAudioData(ab);
    cache.set(url, buf);
    return buf;
  };

  const rows = [];
  for (const s of tap.starts) {
    const file = String(s.url).split('/').pop().split('?')[0];
    if (!file.endsWith('.wav')) continue;
    const startFrame = Math.round(s.t * sr) - frame0;
    // Only isolated plays can be compared: a burst holding two cues is a mix.
    const owns = bursts.filter(([a, b]) => startFrame >= a - 2048 && startFrame < b);
    if (owns.length !== 1) continue;
    const [ba, bb] = owns[0];
    const inBurst = tap.starts.filter((o) => {
      const f = Math.round(o.t * sr) - frame0;
      return f >= ba - 2048 && f < bb;
    });
    if (inBurst.length !== 1) continue;

    let gain = null;
    for (let i = s.gainMark - 1; i >= 0; i--) if (tap.gains[i].id === s.gainId) { gain = tap.gains[i].value; break; }
    if (gain === null) continue;

    const buf = await decode(`/sounds/${file}`);
    const rate = s.rate || 1;
    const len = Math.ceil((buf.duration / rate) * sr) + 4096;
    const oc = new OfflineAudioContext(1, len, sr);
    const src = oc.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = oc.createGain();
    g.gain.value = gain;
    let head = src.connect(g) ? g : g;
    src.connect(g);
    let tail = g;
    for (const st of (s.stages || [])) {
      const bq = oc.createBiquadFilter();
      bq.type = st.type; bq.frequency.value = st.frequency; bq.Q.value = st.Q; bq.gain.value = st.gain;
      tail.connect(bq); tail = bq;
    }
    tail.connect(oc.destination);
    src.start(0);
    const ref = (await oc.startRendering()).getChannelData(0);

    const recB = bands(pcm, ba, bb);
    const refB = bands(ref, 0, ref.length);
    let refPeak = 0, refSq = 0;
    for (let i = 0; i < ref.length; i++) { const m = Math.abs(ref[i]); if (m > refPeak) refPeak = m; refSq += ref[i] * ref[i]; }
    let recPeak = 0, recSq = 0;
    for (let i = ba; i < bb; i++) { const m = Math.abs(pcm[i]); if (m > recPeak) recPeak = m; recSq += pcm[i] * pcm[i]; }
    rows.push({
      file, rate: +rate.toFixed(4), gain: +gain.toFixed(4),
      recPeak: +recPeak.toFixed(5), refPeak: +refPeak.toFixed(5),
      peakRatio: +(recPeak / (refPeak || 1e-9)).toFixed(3),
      recRms: +Math.sqrt(recSq / (bb - ba)).toFixed(6),
      refRms: +Math.sqrt(refSq / ref.length).toFixed(6),
      recBands: recB.frac, refBands: refB.frac,
      // The number that matters: how much MORE of the burst's energy sits
      // above 6 kHz in the tape than the reference says it should.
      hfExcess: +((recB.frac[3] + recB.frac[4] + recB.frac[5]) - (refB.frac[3] + refB.frac[4] + refB.frac[5])).toFixed(5),
    });
  }

  return {
    sampleRate: sr, total, bursts: bursts.length, comparable: rows.length,
    filter: filterTag,
    quiet: { samples: quietSamples, nonZero: nonZeroQuiet, peak: +quietPeak.toFixed(8) },
    rows,
  };
});

writeFileSync(`${OUT}/spectrum.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.total} frames @ ${report.sampleRate} Hz · ${report.bursts} bursts · ${report.comparable} isolated enough to compare`);
console.log(`between cues, bed stopped: ${report.quiet.nonZero} non-zero of ${report.quiet.samples} samples (peak ${report.quiet.peak})`);
console.log(`bus filter at the end: ${JSON.stringify(report.filter)}`);
console.log(`\nbands are fractions of burst energy in 0–.5k / .5–2k / 2–6k / 6–12k / 12–20k / 20–24k`);
console.log(['file', 'rate', 'gain', 'recPeak/refPeak', 'recRms', 'refRms', 'HF excess', 'recorded bands', 'reference bands'].join('\t'));
for (const r of report.rows) {
  console.log([r.file, r.rate, r.gain, r.peakRatio, r.recRms, r.refRms, r.hfExcess, r.recBands.join('/'), r.refBands.join('/')].join('\t'));
}
console.log(`\nwrote ${OUT}/spectrum.json`);
await browser.close();
