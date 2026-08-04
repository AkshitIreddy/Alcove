/**
 * scripts/probe-taste.mjs — the taste questionnaire, from the tour, on the real app.
 *
 * `tests/taste-onboarding.test.ts` proves the resolver picks a real library and
 * that `applyTasteWith` makes the five calls. It says nothing about whether a
 * reader can ever get there, which is exactly the failure this probe exists for:
 * the panel was complete and unit-tested while the app shell did not render it
 * and the tour had no step for it.
 *
 * So this drives the whole seam and asserts only on APPLIED state, read through
 * the bridges the owning modules hand out (`__shelfDesign`, `__libraryPrefs`,
 * `__shelfBinding`, `__nbSoundSets`) — never on what was merely saved:
 *
 *   fresh library  → the tour auto-starts
 *   pick a length  → the tour walks to the step whose id is `taste`
 *   (nothing else) → the panel puts ITSELF on screen
 *   four clicks    → "dress my library"
 *   read back      → the room, the wall, the welcome book's binding, the sound
 *                    set and the interface all changed
 *   …and the tour's own task went green and it walked on by itself.
 *
 * Run twice with different answers: two libraries that must not match.
 *
 * Usage: node scripts/probe-taste.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'qa/ui';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
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

const fails = [];
const check = (ok, line) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${line}`);
  if (!ok) fails.push(line);
};

/** Everything the answers are supposed to dress, read from the applied side. */
const readLibrary = () =>
  page.evaluate(() => {
    const design = window.__shelfDesign?.();
    const prefs = window.__libraryPrefs?.current?.();
    const books = window.__shelfVisibleBooks?.() ?? [];
    const welcome = books.find((b) => b.title.startsWith('Welcome to')) ?? books[0] ?? null;
    return {
      theme: prefs?.theme ?? null,
      build: design?.design?.build ?? null,
      pattern: design?.design?.pattern ?? null,
      // The wall, as the world actually baked it — not as the store holds it.
      wallpaperKey: design?.wallpaperKey ?? null,
      libraryKey: design?.libraryKey ?? null,
      welcomeId: welcome?.id ?? null,
      binding: welcome ? (window.__shelfBinding?.(welcome.id) ?? null) : null,
      soundSet: window.__nbSoundSets?.get?.() ?? null,
      uiTheme: document.documentElement.dataset.theme ?? null,
      ink: document.documentElement.dataset.ink ?? null,
    };
  });

const tourState = () => page.evaluate(() => window.__nbTutorial?.getState?.() ?? null);

/** Click the nth card of the question on screen. */
async function pickCard(n, shot) {
  const cards = page.locator('.nbq-options .nbq-option');
  await cards.nth(n).click();
  if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
}

/**
 * One whole run: fresh library, take the tour, answer, dress.
 * `picks` is the card index for each of the four questions.
 */
async function run(tag, picks, length) {
  console.log(`\n=== ${tag} — picks ${picks.join(',')} on the ${length} tour ===`);

  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await poll(() => window.__shelfDesign !== undefined, 60000, 'the shelf world');
  await poll(
    () => (window.__shelfVisibleBooks?.() ?? []).length > 0,
    60000,
    'the seeded welcome book',
  );

  const before = await readLibrary();
  console.log('  before:', JSON.stringify(before));

  // The tour runs itself on a fresh library. Nothing below asks for the
  // questionnaire — that is the whole point of the probe.
  await poll(() => window.__nbTutorial?.getState?.().running === true, 30000, 'the tour');
  const greeting = await tourState();
  check(greeting.stepId === 'welcome', `${tag}: the tour opens on the greeting`);
  await page.screenshot({ path: `${OUT}/taste-${tag}-1-greeting.png` });

  // Answer the greeting by CLICKING one of the two length buttons.
  await page.locator('.nbt-choice-btn', { hasText: length === 'short' ? 'the short way' : 'the full rundown' }).click();

  const reached = await poll(
    () => document.querySelector('.nbt-layer[data-tutorial-step]')?.getAttribute('data-tutorial-step') === 'taste',
    20000,
    "the tour to reach the 'taste' step",
  ).then(() => true).catch(() => false);
  check(reached, `${tag}: the tour walks to the step whose id is 'taste'`);

  const at = await tourState();
  check(at.stepIds[1] === 'taste', `${tag}: 'taste' is second in the ${at.length} tour`);
  check(at.fact === 'taste-chosen', `${tag}: the step waits on the taste marker`);
  check(at.done === false, `${tag}: …and it is outstanding before anything is answered`);

  // NOBODY OPENED THIS. The panel reads the tour's own step attribute.
  const opened = await page
    .waitForSelector('.nbq-sheet', { state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check(opened, `${tag}: the questionnaire puts itself on screen at that step`);
  if (!opened) return null;

  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/taste-${tag}-2-q1.png` });

  // Four questions. The first three walk on by themselves after the beat; the
  // sound question does not (the reader is meant to audition more than one).
  await pickCard(picks[0]);
  await poll(
    () => document.querySelector('.nbq-layer')?.getAttribute('data-taste-step') === 'pitch',
    15000,
    'question two',
  );
  await page.screenshot({ path: `${OUT}/taste-${tag}-3-q2.png` });
  await pickCard(picks[1]);
  await poll(
    () => document.querySelector('.nbq-layer')?.getAttribute('data-taste-step') === 'paper',
    15000,
    'question three',
  );
  await page.screenshot({ path: `${OUT}/taste-${tag}-4-q3.png` });
  await pickCard(picks[2]);
  await poll(
    () => document.querySelector('.nbq-layer')?.getAttribute('data-taste-step') === 'sound',
    15000,
    'question four',
  );
  await page.screenshot({ path: `${OUT}/taste-${tag}-5-q4.png` });
  await pickCard(picks[3]);
  await page.locator('.nbq-btn--primary').click(); // "see it"

  await poll(
    () => document.querySelector('.nbq-layer')?.getAttribute('data-taste-stage') === 'summary',
    15000,
    'the summary',
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/taste-${tag}-6-summary.png` });

  const summary = await page.evaluate(() => ({
    title: document.querySelector('.nbq-final .nbq-title')?.textContent ?? '',
    ledger: [...document.querySelectorAll('.nbq-ledger div')].map(
      (d) => `${d.querySelector('dt')?.textContent}: ${d.querySelector('dd')?.textContent}`,
    ),
  }));
  console.log('  summary:', summary.title, '|', summary.ledger.join(' · '));

  await page.locator('.nbq-btn--primary').click(); // "dress my library"
  await poll(() => document.querySelector('.nbq-sheet') === null, 20000, 'the panel to close');
  // The world repaints off the store, so read back the APPLIED library key and
  // wait for it to move rather than trusting a fixed pause.
  const wasKey = before.libraryKey;
  await page
    .waitForFunction(
      (key) => (window.__shelfDesign?.().libraryKey ?? null) !== key,
      wasKey,
      { timeout: 20000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(1200);

  const after = await readLibrary();
  console.log('  after: ', JSON.stringify(after));
  await page.screenshot({ path: `${OUT}/taste-${tag}-7-dressed.png` });

  // The five things the four answers are supposed to have dressed.
  check(after.theme !== before.theme, `${tag}: the room's colours changed (${before.theme} → ${after.theme})`);
  check(
    after.build !== before.build || after.pattern !== before.pattern,
    `${tag}: the carpentry changed (${before.build}/${before.pattern} → ${after.build}/${after.pattern})`,
  );
  check(
    after.wallpaperKey !== before.wallpaperKey,
    `${tag}: the wall the world baked changed`,
  );
  check(
    after.binding !== null && after.binding !== before.binding,
    `${tag}: the welcome book's binding changed (${before.binding} → ${after.binding})`,
  );
  check(after.soundSet !== before.soundSet, `${tag}: the sound set changed (${before.soundSet} → ${after.soundSet})`);

  // The stronger form of the same question: what the app is PLAYING is the set
  // the four answers resolve to, not merely a set that is not the old one. (The
  // audition while the sound question is on screen is engine-only, so a run
  // that never pressed "dress my library" would leave the reader's own set on.)
  const decided = await page.evaluate(() => {
    const bridge = window.__nbTaste;
    if (bridge === undefined) return null;
    const out = bridge.resolve(bridge.answers());
    return { set: out.soundSet, binding: out.binding.id, theme: out.room.theme };
  });
  check(
    decided !== null && decided.set === after.soundSet,
    `${tag}: the set playing is the one the answers resolve to (${decided?.set})`,
  );
  check(
    decided !== null && decided.binding === after.binding,
    `${tag}: the binding on the shelf is the one the answers resolve to (${decided?.binding})`,
  );
  check(
    decided !== null && decided.theme === after.theme,
    `${tag}: the room's colours are the ones the answers resolve to (${decided?.theme})`,
  );

  // …and the tour saw it. Green, then on by itself.
  const done = await poll(
    () => {
      const s = window.__nbTutorial?.getState?.();
      return s !== null && s !== undefined && s.finished.includes('taste');
    },
    15000,
    'the taste step to go green',
  )
    .then(() => true)
    .catch(() => false);
  check(done, `${tag}: the tour's own task ticked off the taste marker`);
  const moved = await poll(
    () => (window.__nbTutorial?.getState?.().stepId ?? 'taste') !== 'taste',
    20000,
    'the tour to walk on',
  )
    .then(() => true)
    .catch(() => false);
  check(moved, `${tag}: …and the tour walked on to the next step`);
  await page.screenshot({ path: `${OUT}/taste-${tag}-8-next-step.png` });

  return { before, after, summary };
}

/**
 * The reader who has already been asked. Replaying the tour must NOT hand them
 * the questionnaire again — the step is already satisfied and walks straight on.
 * Call on a page whose library has just been dressed.
 */
async function returningReader() {
  console.log('\n=== a reader who has already answered ===');
  await page.evaluate(() => window.__nbTutorial?.replay?.());
  await poll(() => window.__nbTutorial?.getState?.().running === true, 20000, 'the replayed tour');
  await page.locator('.nbt-choice-btn', { hasText: 'the full rundown' }).click();
  await poll(
    () => (window.__nbTutorial?.getState?.().stepId ?? '') === 'taste',
    20000,
    "the replayed tour to reach 'taste'",
  );
  const state = await tourState();
  check(state.done === true, 'the step is already green for a reader who answered');
  await page.waitForTimeout(1400); // longer than the panel's own 300ms poll
  const shown = await page.locator('.nbq-sheet').count();
  check(shown === 0, 'the questionnaire does not ask a second time');
  await page.screenshot({ path: `${OUT}/taste-c-returning.png` });
  await page.evaluate(() => window.__nbTutorial?.stop?.());
}

/** "I'll pick later": nothing is written, nothing reopens, and next still works. */
async function pickLater() {
  console.log('\n=== "I\'ll pick later" ===');
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await poll(() => window.__shelfDesign !== undefined, 60000, 'the shelf world');
  await poll(
    () => (window.__shelfVisibleBooks?.() ?? []).length > 0,
    60000,
    'the seeded welcome book',
  );
  const before = await readLibrary();
  await poll(() => window.__nbTutorial?.getState?.().running === true, 30000, 'the tour');
  await page.locator('.nbt-choice-btn', { hasText: 'the full rundown' }).click();
  await page.waitForSelector('.nbq-sheet', { state: 'visible', timeout: 20000 });

  // ESCAPE BELONGS TO THE PANEL, not to the tour underneath it. Both hold a
  // capture-phase keydown on `window` and both stop propagation, so this is
  // really a test of the mount order in App.tsx.
  await page.keyboard.press('Escape');
  await poll(() => document.querySelector('.nbq-sheet') === null, 10000, 'Escape to close the panel');
  const survived = await tourState();
  check(survived?.running === true, 'Escape closes the question, not the tour under it');
  check(survived?.stepId === 'taste', '…and leaves the tour where it was');

  // Walking away from the step and back offers the questions again.
  await page.evaluate(() => window.__nbTutorial?.jumpTo?.(0));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__nbTutorial?.jumpTo?.(1));
  const reoffered = await page
    .waitForSelector('.nbq-sheet', { state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check(reoffered, 'walking back to the step offers the questions again');
  if (!reoffered) return;

  await page.locator('.nbq-exit--quiet').click();
  await poll(() => document.querySelector('.nbq-sheet') === null, 10000, 'the panel to close');
  // The panel's watcher is still parked on the taste step; it must not barge
  // back in. Its own poll is 300ms, so this is five chances to get it wrong.
  await page.waitForTimeout(1600);
  check((await page.locator('.nbq-sheet').count()) === 0, 'declining does not reopen the panel');

  const parked = await tourState();
  check(parked.stepId === 'taste', 'the tour is still on the taste step');
  check(parked.done === false, '…with the task still outstanding');
  const after = await readLibrary();
  check(
    after.theme === before.theme && after.build === before.build && after.binding === before.binding,
    'nothing was written — the library is exactly as it came',
  );
  await page.screenshot({ path: `${OUT}/taste-d-declined.png` });

  // MANUALLY ADVANCEABLE: the card's own next button walks past an unfinished
  // step, exactly as it does on every other step.
  await page.locator('.nbt-btn--primary').click();
  const moved = await poll(
    () => (window.__nbTutorial?.getState?.().stepId ?? 'taste') !== 'taste',
    10000,
    'the tour to walk past an unanswered taste step',
  )
    .then(() => true)
    .catch(() => false);
  check(moved, 'next walks past the taste step without answering it');
}

/* --------------------------------- the runs -------------------------------- */

// Two very different readers: near the top of every list versus near the
// bottom. (Not card 0 for the sound question — its first family IS the shipped
// default, so "the set changed" would be a false alarm on a correct run.)
const a = await run('a', [0, 0, 0, 3], 'full');
await returningReader();
const b = await run('b', [7, 3, 4, 6], 'short');
await pickLater();

if (a !== null && b !== null) {
  console.log('\n=== two readers, two libraries ===');
  const differs = (k) => a.after[k] !== b.after[k];
  check(differs('theme'), `two answers give two colour schemes (${a.after.theme} vs ${b.after.theme})`);
  check(
    a.after.build !== b.after.build || a.after.pattern !== b.after.pattern,
    `two answers give two bookcases (${a.after.build}/${a.after.pattern} vs ${b.after.build}/${b.after.pattern})`,
  );
  check(differs('wallpaperKey'), 'two answers give two walls');
  check(differs('binding'), `two answers give two bindings (${a.after.binding} vs ${b.after.binding})`);
  check(differs('soundSet'), `two answers give two sound sets (${a.after.soundSet} vs ${b.after.soundSet})`);
  check(
    a.summary.title !== b.summary.title,
    `two answers name two rooms ("${a.summary.title}" vs "${b.summary.title}")`,
  );
}

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}

console.log(`\n${fails.length === 0 ? 'ALL CHECKS PASSED' : `${fails.length} CHECK(S) FAILED`}`);
for (const f of fails) console.log(`  - ${f}`);

await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
