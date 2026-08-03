/**
 * shots-now/tour-drive.mjs — drive the guided tour end to end, both lengths,
 * doing every step's task for real.
 *
 * This is a SEAM probe, not a specimen board. Everything it asserts is read
 * back out of the running app — the tour's own `getState()` for where it
 * thinks it is, and plain DOM queries for what is actually on screen — so a
 * step that "should" work but cannot be satisfied by a real click fails here.
 *
 * The four reported defects it exists to catch:
 *
 *  1. STEP 2 HAS NO GUARD. On an empty case the tour must stop at "write my
 *     first one" and must NOT count a shelf drag as progress. Run A empties
 *     the library and tries the wrong action first, on purpose.
 *  2. THE BLOCK STEP'S SPOTLIGHT WAS TOO SMALL TO DRAG IN. The hole must be
 *     the whole editable column, and every point in it must be somewhere a
 *     drop is legal — otherwise the reader gets the not-allowed cursor while
 *     following the tour. Sampled, not eyeballed.
 *  3. A STEP LEFT THE PREVIOUS STEP'S PANEL OPEN. On entering any step, no
 *     sheet, bar or menu may be standing except one the step itself points
 *     inside (only `customize-do` does).
 *  4. THE TOUR SKIPPED THE RAILS. Both rails are walked, and each of their
 *     steps has to be satisfiable by clicking the real control.
 *
 * Plus the fifth item: the short tour and the full one both have to run to
 * the end, and the short one has to be a subset of the long one.
 *
 * Usage: node shots-now/tour-drive.mjs        (reuses the dev server on :1420)
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:1420/?fx=force';
const OUT = 'shots-now/tour';

/* ------------------------------- plumbing --------------------------------- */

const failures = [];
const notes = [];
const fail = (what) => {
  failures.push(what);
  console.log(`  FAIL — ${what}`);
};
const ok = (what) => {
  notes.push(what);
  console.log(`  ok   — ${what}`);
};

/** Wait for the tour's QA bridge, then call it. It disappears for a moment
 *  whenever the dev server hot-swaps the overlay under a running probe. */
async function tour(p, fn) {
  await p.waitForFunction(() => typeof window.__nbTutorial?.getState === 'function', {
    timeout: 15_000,
  });
  return p.evaluate(fn);
}

const state = async (p) => {
  return tour(p, () => window.__nbTutorial.getState());
};

/** What the app is actually showing, independent of what the tour believes. */
const surfaces = (p) =>
  p.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.right > 0 && r.left < window.innerWidth;
    };
    const out = [];
    for (const el of document.querySelectorAll('.nb-rail-panel[aria-hidden="false"]')) {
      if (vis(el)) out.push(`panel:${el.getAttribute('aria-label')}`);
    }
    if (vis(document.querySelector('.nbs-sheet'))) out.push('settings');
    if (vis(document.querySelector('.nb-qs-bar'))) out.push('quick-switcher');
    if (vis(document.querySelector('.nb-ctx-menu'))) out.push('context-menu');
    if (vis(document.querySelector('.shelf-trash'))) out.push('trash');
    return out;
  });

/**
 * Run one phase, and start it over if the dev server reloaded underneath it.
 *
 * This probe reuses the dev server on :1420, which is shared with whoever else
 * is editing the app. A Vite full reload destroys the page mid-walk, and the
 * error that comes back describes the harness rather than the tour. Retried,
 * not tolerated: a phase that fails twice for that reason is reported.
 */
async function phase(name, body, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    const before = failures.length;
    try {
      await body();
      return;
    } catch (error) {
      const text = String(error?.message ?? error);
      failures.length = before; // a torn-down page's complaints are not findings
      if (attempt < tries) {
        console.log(`  … ${name} fell over (${text.split('\n')[0]}); starting again`);
        continue;
      }
      fail(`${name}: ${text.split('\n')[0]}`);
      return;
    }
  }
}

/** Poll until `check(state)` or the budget runs out. Returns the last state. */
async function until(p, check, ms = 6000) {
  const deadline = Date.now() + ms;
  let last = await state(p);
  while (Date.now() < deadline) {
    if (check(last)) return last;
    await p.waitForTimeout(120);
    last = await state(p);
  }
  return last;
}

async function boot(browser, { viewport } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const p = await context.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof window.__nbTutorial?.getState === 'function', {
    timeout: 40_000,
  });
  await p.waitForFunction(() => typeof window.__shelfVisibleBooks === 'function', {
    timeout: 40_000,
  });
  await p.waitForTimeout(2500); // first bake settles
  return { context, p };
}

/* ------------------------------ the actions -------------------------------- */

/**
 * A board, and never a reason to fail the run. Screenshots are here to be
 * LOOKED at; a compositor that will not settle under SwiftShader is not a
 * finding about the tour.
 */
async function shoot(p, path) {
  try {
    await p.screenshot({ path, animations: 'disabled', timeout: 12_000 });
  } catch {
    console.log(`  (no board for ${path} — the renderer would not settle)`);
  }
}

/**
 * Click the middle of an element with the real mouse.
 *
 * NOT `page.click`: several of these controls delete themselves the moment
 * they are pressed (the first-run invite, a rail toggle that re-renders), and
 * Playwright's actionability retry then restarts the whole wait against a
 * selector that no longer matches — a 30s timeout on a click that worked.
 * Measure, then press the pixel.
 */
async function tap(p, selector) {
  await p.waitForSelector(selector, { state: 'visible', timeout: 15_000 });
  const box = await p.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`no box for ${selector}`);
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function dragShelf(p) {
  await p.mouse.move(720, 500);
  await p.mouse.down();
  for (let i = 1; i <= 6; i += 1) await p.mouse.move(720 - i * 18, 500 + i * 4);
  await p.mouse.up();
}

async function clickSpine(p) {
  // The step before this one drags the case about, so a spine can end up off
  // screen. Put the camera back the way the zoom pill would, then measure.
  const rect = await p.evaluate(() => {
    const visible = () => window.__shelfVisibleBooks?.() ?? [];
    if (visible().length === 0) window.__shelfWorld?.zoomReset?.();
    return null;
  });
  void rect;
  await p.waitForTimeout(600);
  const hit = await p.evaluate(() => {
    const books = window.__shelfVisibleBooks?.() ?? [];
    if (books.length === 0) return null;
    return window.__shelfSpineRect(books[0].id);
  });
  if (hit === null) return false;
  await p.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  return true;
}

/** Each step's task, done the way a reader would do it. */
const ACTIONS = {
  'first-book': async (p) => {
    // A big enough shelf drag can carry the empty floor — and with it the
    // invite — off screen. The card names the other way through for exactly
    // that case, so the probe takes it rather than pretending it never happens.
    const invite = (await p.locator('.shelf-firstrun__btn').count()) > 0;
    await tap(p, invite ? '.shelf-firstrun__btn' : '[data-shelf-dock="new-book"]');
    if (!invite) notes.push('(the invite had scrolled away; used "new book" instead)');
    await p.waitForTimeout(900);
    // The new spine asks for a title straight away.
    if ((await p.locator('.shelf-spine-name').count()) > 0) {
      await p.keyboard.type('First');
      await p.keyboard.press('Enter');
    }
  },
  'shelf-moves': dragShelf,
  'shelf-dock': async (p) => {
    await p.hover('[data-shelf-dock="add-floor"]');
    await p.hover('[data-shelf-dock="studio"]');
  },
  'shelf-studio': async (p) => tap(p, '[data-shelf-dock="studio"]'),
  'open-a-book': clickSpine,
  'the-rail': async (p) => {
    await p.hover('.nb-rail-button[data-tool="customize"]');
  },
  writing: async (p) => {
    const box = await p.locator('.nb-prose').first().boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height - 60);
    await p.keyboard.type('hello there');
  },
  blocks: async (p) => {
    const box = await p.locator('.nb-prose > *').first().boundingBox();
    await p.mouse.click(box.x + 40, box.y + box.height / 2, { button: 'right' });
  },
  pages: async (p) => {
    // ← → only turn when the caret is not in a page, so step out of it first.
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.press('ArrowRight');
  },
  'page-style': async (p) => tap(p, '.nb-rail-button[data-tool="page-style"]'),
  catalogue: async (p) => tap(p, '.nb-rail-button[data-tool="catalogue"]'),
  'finding-in-book': async (p) => tap(p, '.nb-rail-button[data-tool="toc"]'),
  'customize-open': async (p) => tap(p, '.nb-rail-button[data-tool="customize"]'),
  'customize-do': async (p) => {
    const tile = p.locator('.nb-rail-panel[aria-hidden="false"] .nb-strip-tile').nth(2);
    const box = await tile.boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  },
  'rail-actions': async (p) => tap(p, '.nb-rail-button[data-tool="thumbs"]'),
  'ai-script': async (p) => tap(p, '.nb-rail-button[data-tool="spec"]'),
  'quick-switch': async (p) => p.keyboard.press('Control+K'),
  settings: async (p) => tap(p, '.nbs-gear-button'),
};

/**
 * Steps allowed to inherit an open surface, and which one.
 *
 * Exactly one: `customize-do` talks about the sheet `customize-open` asked
 * the reader to open, and says so by pointing at it. Everything else must
 * arrive on a clear screen — that is defect 3.
 */
const MAY_INHERIT = { 'customize-do': 'panel:Customize this book' };

/** Steps worth a board — the ones a person should look at before shipping. */
const SHOTS = [
  'shelf-dock',
  'shelf-studio',
  'blocks',
  'catalogue',
  'finding-in-book',
  'customize-do',
  'rail-actions',
  'settings',
];

/* -------------------------------- the walk --------------------------------- */

async function walk(p, label) {
  const seen = [];
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 40) {
      fail(`${label}: the tour never ended (looping on ${seen[seen.length - 1]})`);
      break;
    }
    const s = await state(p);
    if (!s.running) break;
    seen.push(s.stepId);

    // (3) What was left standing by the step before this one?
    //
    // Polled, not sampled once: a sheet the tour just dismissed is still
    // sliding off screen for a few hundred ms, and calling that a failure
    // would be timing the animation rather than testing the rule. A surface
    // still up a second and a half later is genuinely still up.
    const allowed = MAY_INHERIT[s.stepId];
    let stale = [];
    for (let wait = 0; wait <= 1500; wait += 250) {
      stale = (await surfaces(p)).filter((id) => id !== allowed);
      if (stale.length === 0) break;
      await p.waitForTimeout(250);
    }
    if (stale.length > 0) {
      fail(`${label}: step "${s.stepId}" opened with ${stale.join(', ')} still up`);
    }
    // The other half of the same rule: a step that IS about an open sheet has
    // to still have it. Closing everything on every step would pass the check
    // above and make `customize-do` describe a panel that is not there.
    if (allowed !== undefined) {
      const kept = await surfaces(p);
      if (!kept.includes(allowed)) {
        fail(`${label}: step "${s.stepId}" lost the ${allowed} it is about`);
      } else {
        ok(`"${s.stepId}" keeps the sheet it points at`);
      }
    }

    // (2) The block step's hole has to be somewhere a drop is legal.
    if (s.stepId === 'blocks') await checkDropTarget(p, label);
    // A few boards to actually look at, once the card has finished arriving.
    if (label === 'full' && SHOTS.includes(s.stepId)) {
      await p.waitForTimeout(700);
      await shoot(p, `${OUT}-${s.stepId}.png`);
    }

    const act = ACTIONS[s.stepId];
    if (act === undefined) {
      // The bookends have no task: step on by hand.
      if (s.fact !== null) fail(`${label}: no action written for "${s.stepId}"`);
      const at = s.stepIndex;
      if (s.stepIndex === s.total - 1) {
        await tap(p, '.nbt-btn--primary');
        await p.waitForTimeout(500);
        break;
      }
      await tap(p, '.nbt-btn--primary');
      await until(p, (n) => n.stepIndex !== at, 4000);
      continue;
    }

    // Let the previous step's sheet finish sliding away before pressing
    // anything: a scrim caught mid-exit eats the click aimed past it.
    await p.waitForTimeout(400);

    // Three goes, because this runs on SwiftShader with rAF throttled and a
    // dropped click is an artefact of the harness, not of the tour. A step
    // that cannot be satisfied in three real attempts is a real failure.
    let done = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await act(p);
      done = await until(p, (n) => n.done || n.stepId !== s.stepId, 8000);
      if (done.done || done.stepId !== s.stepId) {
        if (attempt > 1) notes.push(`(“${s.stepId}” needed ${attempt} tries)`);
        break;
      }
    }
    if (!done.done && done.stepId === s.stepId) {
      fail(`${label}: step "${s.stepId}" never went green (waiting on ${s.fact})`);
      // Do not stall the whole run on one bad step.
      await tour(p, () => window.__nbTutorial.next());
      await p.waitForTimeout(600);
      continue;
    }
    // It ticked; the tour walks on by itself after the celebration beat.
    await until(p, (n) => n.stepId !== s.stepId || !n.running, 6000);
  }
  return seen;
}

/**
 * DEFECT 2: sample the spotlight and check every point is inside the editable
 * column. A point that is not is a point where the browser draws the
 * not-allowed cursor mid-drag, which is exactly what was reported.
 */
async function checkDropTarget(p, label) {
  const m = await p.evaluate(() => {
    const hole = window.__nbTutorial.getState().hole;
    if (hole === null) return { hole: null };
    const prose = document.querySelector('.nb-prose');
    const pr = prose?.getBoundingClientRect() ?? null;
    const bad = [];
    let sampled = 0;
    for (let fx = 0.08; fx <= 0.93; fx += 0.12) {
      for (let fy = 0.08; fy <= 0.93; fy += 0.12) {
        const x = hole.x + hole.width * fx;
        const y = hole.y + hole.height * fy;
        sampled += 1;
        const el = document.elementFromPoint(x, y);
        // Legal drop = the ProseMirror root or anything inside it.
        const legal = el !== null && (el === prose || prose?.contains(el) === true);
        if (!legal) bad.push({ x: Math.round(x), y: Math.round(y), el: el?.className ?? null });
      }
    }
    return {
      hole,
      prose: pr && { w: Math.round(pr.width), h: Math.round(pr.height) },
      sampled,
      bad,
      firstBlock: (() => {
        const b = document.querySelector('.nb-prose > *')?.getBoundingClientRect();
        return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null;
      })(),
    };
  });
  if (m.hole === null) {
    fail(`${label}: the block step had no spotlight at all`);
    return;
  }
  const area = m.hole.width * m.hole.height;
  const blockArea = m.firstBlock ? m.firstBlock.w * m.firstBlock.h : 0;
  if (blockArea > 0 && area < blockArea * 4) {
    fail(
      `${label}: the block spotlight is ${Math.round(area)}px², barely bigger ` +
        `than the ${Math.round(blockArea)}px² block — nowhere to drop`,
    );
  } else {
    ok(`block spotlight is ${Math.round(area / blockArea)}× one block`);
  }
  if (m.sampled < 40) {
    fail(`${label}: only ${m.sampled} sample points — the check proves nothing`);
  } else if (m.bad.length > 0) {
    fail(
      `${label}: ${m.bad.length}/${m.sampled} lit points are not a legal drop ` +
        `(first: ${JSON.stringify(m.bad[0])})`,
    );
  } else {
    ok(`all ${m.sampled} sampled points inside the spotlight accept a drop`);
  }
}

/* --------------------------------- runs ------------------------------------ */

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

/* ---- A. the first-run gate: the wrong action must not advance the tour ---- */
console.log('\nA — the empty case, and the wrong action first');
await phase('A', async () => {
  const { context, p } = await boot(browser);
  try {
  await tour(p, () => window.__nbTutorial.stop());
  // Seeding is async: empty the case before the Welcome book lands and the
  // case fills back up behind you, and the invite never appears.
  await p.waitForFunction(() => (window.__shelfVisibleBooks?.() ?? []).length > 0, {
    timeout: 30_000,
  });
  await p.evaluate(() => window.__shelfEmptyLibrary());
  await p.waitForFunction(() => document.querySelector('.shelf-firstrun') !== null, {
    timeout: 20_000,
  });
  await tour(p, () => window.__nbTutorial.start());
  await p.waitForTimeout(600);
  await tour(p, () => window.__nbTutorial.chooseLength('full'));

  let s = await until(p, (n) => n.stepId !== 'welcome');
  if (s.stepId !== 'first-book') {
    fail(`the empty case did not gate: step 2 is "${s.stepId}", not "first-book"`);
  } else {
    ok('an empty case gates the tour on "write my first one"');
  }

  await dragShelf(p); // THE WRONG ACTION
  await p.waitForTimeout(1800);
  s = await state(p);
  if (s.stepId !== 'first-book' || s.done) {
    fail(`dragging the shelf advanced the gate (now "${s.stepId}", done=${s.done})`);
  } else {
    ok('dragging the shelf does not satisfy the gate');
  }
  if (typeof s.nudge !== 'string' || s.nudge.length < 12) {
    fail(`the gate said nothing about the wrong action (nudge=${JSON.stringify(s.nudge)})`);
  } else {
    ok(`the card says what to do instead: "${s.nudge}"`);
  }
  await shoot(p, `${OUT}-guard.png`);

  await ACTIONS['first-book'](p);
  s = await until(p, (n) => n.stepId !== 'first-book', 9000);
  if (s.stepId === 'first-book') fail('making the first book did not clear the gate');
  else ok(`the right action clears it (on to "${s.stepId}")`);
  } finally {
    await context.close();
  }
});

/* ---- B. the full rundown, every step performed for real ------------------ */
console.log('\nB — the full rundown, driven step by step');
let fullSeen = [];
await phase('B', async () => {
  const { context, p } = await boot(browser);
  try {
  await tour(p, () => window.__nbTutorial.start());
  await p.waitForTimeout(500);
  await shoot(p, `${OUT}-chooser.png`);
  const before = await state(p);
  if (before.stepId !== 'welcome') fail(`the tour did not open on the greeting`);
  if (before.lengthChosen) fail('the greeting arrived with the length already chosen');
  await tour(p, () => window.__nbTutorial.chooseLength('full'));
  await p.waitForTimeout(400);
  const chosen = await state(p);
  if (chosen.length !== 'full' || chosen.total < 15) {
    fail(`choosing the full rundown gave ${chosen.total} steps of "${chosen.length}"`);
  } else {
    ok(`the full rundown is ${chosen.total} steps`);
  }
  fullSeen = ['welcome', ...(await walk(p, 'full'))];
  const end = await state(p);
  if (end.running) fail('the full tour never finished');
  else ok(`the full tour ran to the end (${fullSeen.length} steps visited)`);
  } finally {
    await context.close();
  }
});

/* ---- C. the short way ----------------------------------------------------- */
console.log('\nC — the short way');
let shortSeen = [];
await phase('C', async () => {
  const { context, p } = await boot(browser);
  try {
  await tour(p, () => window.__nbTutorial.start());
  await p.waitForTimeout(500);
  await tour(p, () => window.__nbTutorial.chooseLength('short'));
  await p.waitForTimeout(400);
  const chosen = await state(p);
  if (chosen.length !== 'short') fail('the short way was not taken');
  ok(`the short way is ${chosen.total} steps`);
  shortSeen = ['welcome', ...(await walk(p, 'short'))];
  const end = await state(p);
  if (end.running) fail('the short tour never finished');
  else ok(`the short tour ran to the end (${shortSeen.length} steps visited)`);
  } finally {
    await context.close();
  }
});

/* ---- the subset relation, measured on what actually ran ------------------- */
{
  const missing = shortSeen.filter((id) => !fullSeen.includes(id));
  // A subset check against an empty run is true and worthless.
  if (shortSeen.length < 5) {
    fail(`the short tour only got through ${shortSeen.length} steps`);
  } else if (missing.length > 0) {
    fail(`the short tour showed steps the full one never did: ${missing.join(', ')}`);
  } else if (shortSeen.length >= fullSeen.length) {
    fail(`the short tour is not shorter (${shortSeen.length} vs ${fullSeen.length})`);
  } else {
    ok(`the short tour is a real subset (${shortSeen.length} of ${fullSeen.length})`);
  }
  // Refuse to pass vacuously: a run that visited three steps proves nothing.
  if (fullSeen.length < 15) fail(`only ${fullSeen.length} steps were visited in the full tour`);
  // Both rails have to have been walked, in the app, not just written down.
  for (const id of ['shelf-dock', 'shelf-studio', 'page-style', 'catalogue', 'finding-in-book', 'rail-actions']) {
    if (!fullSeen.includes(id)) fail(`the full tour never reached "${id}"`);
  }
}

await browser.close();

console.log(`\n  ${notes.length} checks passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(failures.map((f) => `   · ${f}`).join('\n'));
  process.exit(1);
}
console.log('  PASS');
