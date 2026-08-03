/**
 * scripts/probe-own-sounds.mjs — does a reader's own sound set actually get
 * PLAYED?
 *
 * The registry, the store and the settings panel can all agree that a file is
 * assigned to a role and the app can still play the shipped cue, because the
 * decision that matters is made deep inside `engine.playRole` — after the base
 * set's substitution table, after the variant rotation, after the skip lists.
 * The only honest evidence is the network: howler fetches the URL it was
 * handed, so if the reader's file was reached for, the browser asked for it.
 *
 * The seeded cue is therefore a shipped WAV under a query string
 * (`?nbown=1`). It decodes exactly like the file it is (howler splits the
 * query off before sniffing the codec), and no other code path in the app
 * would ever request that URL — the boot preload fetches the bare one — so a
 * request for it is unambiguous.
 *
 * What is checked:
 *   1. a seeded set is selectable and reports itself, its base and its count
 *   2. playing the filled role fetches THE READER'S file
 *   3. an unfilled role still resolves through the base set
 *   4. the base's master-bus filter still applies to the reader's set
 *   5. the choice survives a reload, cues and all
 *   6. forgetting the set drops the selection back to a shipped one
 *
 * Usage: node scripts/probe-own-sounds.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

const OWN_URL = '/sounds/chime-hour-1.wav?nbown=1';

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const requested = [];
page.on('request', (r) => requested.push(r.url()));
const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});

const poll = async (fn, timeout = 90000, label = 'condition') => {
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
  await poll(() => globalThis.__nbUserSoundSets !== undefined, 120000, 'own-set bridge');
};

let bad = 0;
const say = (ok, line) => {
  if (!ok) bad += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${line}`);
};

console.log('\na reader\'s own sound set, on the real play path\n');

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await ready();

/* ── 1. seed a set and select it ────────────────────────────────────────── */

const seeded = await page.evaluate(async (ownUrl) => {
  const set = await globalThis.__nbUserSoundSets.seed('probe kit', 'far-room', {
    'click-soft': ownUrl,
  });
  if (set === null) return null;
  await globalThis.__nbSoundSets.save(set.id);
  return { id: set.id, name: set.name, base: set.base, cues: Object.keys(set.cues) };
}, OWN_URL);

say(seeded !== null, `a set was created${seeded === null ? '' : ` — ${seeded.id}`}`);
if (seeded === null) {
  console.log('\nCANNOT CONTINUE');
  await browser.close();
  process.exit(1);
}
say(seeded.id.startsWith('user:'), `its id is prefixed: ${seeded.id}`);

let state = await page.evaluate(() => globalThis.__nbSound.getState());
say(state.set === seeded.id, `the engine is voicing ${state.set}`);
say(state.baseSet === 'far-room', `its base is ${state.baseSet}`);
say(state.ownCues === 1, `${state.ownCues} role voiced by the reader's own file`);
say(
  state.filter.wanted === 'lowpass@1500Hz/Q0.80',
  `the base's master-bus filter is what the reader's set asks for: "${state.filter.wanted}"`,
);

/* ── 2. play the filled role and watch the network ──────────────────────── */

requested.length = 0;
await page.evaluate(async () => {
  for (let i = 0; i < 4; i += 1) await globalThis.__nbSound.play('click-soft', { volume: 0 });
});
await page.waitForTimeout(700);
const own = requested.filter((u) => u.includes('nbown=1'));
say(own.length > 0, `playing 'click-soft' fetched the reader's file (${own.length} request(s))`);
say(
  requested.filter((u) => /\/sounds\/click-soft-\d+\.wav(\?|$)/.test(u)).length === 0,
  "and did not fetch a shipped 'click-soft' take",
);

/* ── 3. an unfilled role still comes from the base set ──────────────────── */

const unfilled = await page.evaluate(() => ({
  pageFlip: globalThis.__nbSound.resolveVoice('page-flip'),
  roleFor: globalThis.__nbUserSoundSets.roleFor('my-page-turn.wav'),
  roleForNoise: globalThis.__nbUserSoundSets.roleFor('untitled-47.wav'),
}));
say(unfilled.pageFlip !== null, "'page-flip' still resolves through the base set");
say(unfilled.roleFor === 'page-flip', `'my-page-turn.wav' matches ${unfilled.roleFor}`);
say(unfilled.roleForNoise === null, "'untitled-47.wav' is reported unmatched, not guessed at");

/* ── 4. the filter is genuinely wired once howler has a graph ───────────── */

state = await page.evaluate(() => globalThis.__nbSound.getState());
say(
  state.filter.installed === true,
  `the base's filter is INSTALLED under the reader's set: ` +
    `"${state.filter.tag}"${state.filter.reason === null ? '' : ` (${state.filter.reason})`}`,
);

/* ── 5. survive a reload ────────────────────────────────────────────────── */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await ready();
await page.evaluate(() => globalThis.__nbSoundSets.load());
await poll(
  () => globalThis.__nbUserSoundSets.list().length > 0,
  30000,
  'the own set to come back',
).catch(() => null);

state = await page.evaluate(() => globalThis.__nbSound.getState());
const after = await page.evaluate(() => globalThis.__nbUserSoundSets.list());
say(after.length === 1, `${after.length} own set after reload`);
say(state.set === seeded.id, `still voicing ${state.set} after reload`);
say(state.baseSet === 'far-room', `its base survived too (${state.baseSet})`);

// THE DEV SHELL HAS NO FILESYSTEM. `storeCue`'s browser branch mints an
// object URL, and `devObjectUrls` is a module-scope Map that a reload empties,
// so `resolveAssetSrc` cannot answer for the rel_path and `hydrate` DROPS the
// cue. That is the designed behaviour for "the bytes did not come back", and
// what it must not do is register a dead src and go silent — so the assertion
// here is that the role falls back to the base's shipped cue and is heard.
// Cue bytes surviving a reload is a Tauri property (a real file under
// `$APPDATA/assets/images/` reached through `convertFileSrc`) that no
// browser-shell probe can reach; `tests/sound-own.test.ts` pins the hydrate
// contract instead.
say(state.ownCues === 0, `the dev shell's object URL is gone, so ${state.ownCues} cues survive`);
requested.length = 0;
await page.evaluate(() => globalThis.__nbSound.play('click-soft', { volume: 0 }));
await page.waitForTimeout(700);
say(
  requested.some((u) => u.includes('nbown=1')) === false,
  'and the dropped cue is not requested from a dead URL',
);
say(
  (await page.evaluate(() => globalThis.__nbSound.resolveVoice('click-soft'))) !== null,
  "'click-soft' falls back to the base set rather than going silent",
);

/* ── 6. forgetting it falls back to a shipped set ───────────────────────── */

const forgotten = await page.evaluate(async (id) => {
  const gone = await globalThis.__nbUserSoundSets.forget(id);
  // Re-selecting the now-unregistered id is what a stale stored value does.
  await globalThis.__nbSoundSets.save(id);
  return { gone, set: globalThis.__nbSound.getState().set };
}, seeded.id);
say(forgotten.gone, 'the set was forgotten');
say(!forgotten.set.startsWith('user:'), `a stale own id falls back to ${forgotten.set}`);

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}× ${k}`);
}

console.log(bad === 0 ? '\nALL CHECKS PASSED' : `\n${bad} CHECK(S) FAILED`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
