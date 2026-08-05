/**
 * scripts/probe-demo-turns.mjs — do the demo's two turn defects happen LIVE?
 *
 * The owner, watching the recorded GIF: *"sometimes it's like pages are
 * skipping during a turn, sometimes it's like future pages showing"* — and
 * then, decisively, *"I didn't notice any of the bugs I mentioned in the gif's
 * video when I was testing in the web server."*
 *
 * "Didn't notice" is weaker than "doesn't happen": a transient the eye misses
 * at 60fps is a WHOLE FRAME at the GIF's 14. So this measures the live app at
 * animation-frame resolution, driving the exact sequence `shots-now/demo-gif.mjs`
 * drives (blur → ArrowRight → wait, with a rail panel opened and closed between
 * turns), and asks two questions per frame:
 *
 *   1. SKIP — which pages does the app think the two leaves are, by SLOT, and
 *      does a commit ever move them by more than one spread? Slots come from
 *      the stored page order, not from the spread index alone, because a turn
 *      near the end of the book APPENDS pages and the index is then a
 *      different distance into a different book.
 *
 *   2. FUTURE PAGE — the three faces a curl was STARTED with (recorded inside
 *      the controller, from the very call that uploads the textures) against
 *      the three faces the app would name for the same flip on every later
 *      frame. Those diverge exactly when the store moves under a running curl,
 *      which is what "a page I have not reached is on screen" looks like.
 *      The documented end-of-turn artefact in probe-blank-spread — `ids()` has
 *      moved on, so `facesFor('next')` is answering about the NEXT turn — is
 *      excluded by only comparing while the canvas is still curling AND the
 *      controller has not yet committed (`landing === false`).
 *
 * Everything is read through bridges the app hands out (`__flipCache` from
 * FlipSurface) or through instrumentation appended to the REAL module by a
 * route intercept, per CLAUDE.md: a probe's own `import('/src/…')` can resolve
 * to a second module copy on a dev server that has served HMR.
 *
 * Pictures: a CDP screencast runs across each turn, and the frames either side
 * of anything suspicious are written out full size, so the finding can be
 * LOOKED at rather than inferred.
 *
 *   node scripts/probe-demo-turns.mjs [--url=http://localhost:1420]
 *                                     [--out=<dir>] [--turns=7]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = arg('url', 'http://localhost:1420');
const OUT = arg('out', 'qa/demo-defects');
const TURNS = Number(arg('turns', 7));
const PANELS_ON = arg('panels', '1') !== '0';
/**
 * A GATE YOU HAVE NOT WATCHED FAIL IS NOT A GATE (CLAUDE.md).
 *
 *   --sabotage=cache  empty the raster cache in the frame before the turn, so
 *                     the curl genuinely has no bitmap for any face. The "curl
 *                     with a blank face" check must go red, and the pictures
 *                     must show bare paper turning.
 *   --sabotage=jump   move the reader with the table of contents instead of a
 *                     turn, which really does cross several spreads at once.
 *                     The skip check must go red.
 *
 * Either way the run prints GATE ALIVE / GATE INERT instead of a verdict.
 */
const SABOTAGE = arg('sabotage', '');
mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------------------
   Instrumentation appended to the real flip modules.

   `beginFlip` is where the textures are chosen and uploaded, so the faces it
   was called with are the faces the reader is actually looking at for the
   length of the curl. Recording them anywhere else is recording a guess.
   --------------------------------------------------------------------------- */
const CONTROLLER_SNIPPET = `
;(function () {
  const P = PageFlipController.prototype;
  globalThis.__flipTrace = [];
  const T = (n, extra) => {
    globalThis.__flipTrace.push({ t: performance.now(), n, ...extra });
  };
  for (const n of ['flipNext', 'flipPrev']) {
    const o = P[n];
    P[n] = function (...a) { globalThis.__flipCtl = this; return o.apply(this, a); };
  }
  const beginFlip = P.beginFlip;
  P.beginFlip = function (dir, grip) {
    globalThis.__flipCtl = this;
    let pages = null;
    try { pages = this.options.getFlipPages(dir); } catch { pages = 'threw'; }
    const ok = beginFlip.call(this, dir, grip);
    T('beginFlip', { dir, grip, ok, phase: this.phase, pages, webgl: this.renderer !== null });
    // The faces this curl is committed to, for the sampler to compare against.
    globalThis.__curlFaces = ok ? pages : null;
    return ok;
  };
  const settle = P.settle;
  P.settle = function (target, d, e, v) {
    T('settle', { target, phase: this.phase, p: this.flip.p });
    return settle.call(this, target, d, e, v);
  };
  const land = P.land;
  P.land = function (target) {
    T('land', { target, phase: this.phase, p: this.flip.p, landing: this.landing });
    const r = land.call(this, target);
    globalThis.__curlFaces = null;
    return r;
  };
  const cf = P.crossfadeNavigate;
  P.crossfadeNavigate = function (dir) {
    T('crossfadeNavigate', { dir, phase: this.phase });
    return cf.call(this, dir);
  };
})();
`;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
// FULL MOTION. Without this the turn crossfades in 160ms instead of curling,
// and every number below would describe a code path no reader takes.
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

/*
 * AND THE DEV SERVER'S OWN CHATTER.
 *
 * Vite announces every hot update on the console. With another agent editing
 * src/ this is the difference between "the app froze mid-turn" and "somebody
 * saved a file mid-turn", and without it the two are indistinguishable in the
 * numbers — a hot swap tears the book view down and back up, which looks
 * exactly like a stage that vanished on its own.
 */
const hmr = [];
page.on('console', (m) => {
  const text = m.text();
  if (/\[vite\]/i.test(text)) hmr.push({ at: Date.now(), text: text.slice(0, 160) });
});


await page.route('**/src/flip/PageFlipController.ts*', async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  await route.fulfill({ response: res, body: body + CONTROLLER_SNIPPET });
});

/* --------------------------- CDP screencast -------------------------------- */
const cdp = await page.context().newCDPSession(page);
let capturing = false;
let shots = [];
cdp.on('Page.screencastFrame', (f) => {
  if (capturing) shots.push({ ts: f.metadata.timestamp * 1000, data: f.data });
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
const startCast = async () => {
  shots = [];
  capturing = true;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, everyNthFrame: 1 });
};
const stopCast = async () => {
  capturing = false;
  await cdp.send('Page.stopScreencast').catch(() => {});
};


/*
 * A HOT-RELOAD GUARD, because another agent is editing src/ while this runs.
 *
 * Vite pushes a full page reload for a module it cannot swap hot, and a reload
 * in the middle of a run does not merely throw — it can quietly restart the
 * book and leave the numbers describing two different builds. Any navigation
 * after boot is recorded and shouted about at the end, so a clean-looking run
 * against a moving tree is never mistaken for a clean result.
 */
let booted = false;
const reloads = [];
page.on('framenavigated', (f) => {
  if (booted && f === page.mainFrame()) reloads.push(new Date().toISOString());
});
/* ------------------------------- boot -------------------------------------- */
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }

const bookId = await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
  return w ? w.id : null;
});
if (!bookId) { console.error('FAIL: no book on the shelf'); await browser.close(); process.exit(1); }
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForSelector('.nb-spread-stage', { timeout: 60_000 });
// The demo holds 2.4s on the open book before it turns anything; the raster
// cache warms in that window and a turn that outruns it measures the warm,
// not the turn.
await page.waitForTimeout(6000);

const timeOrigin = await page.evaluate(() => performance.timeOrigin);
booted = true;

/** id → slot, straight out of the stored page order. */
const slotMap = async () =>
  page.evaluate((id) => {
    try {
      const blob = JSON.parse(localStorage.getItem('notebook.stubdb.v1') ?? '{}');
      const rows = (blob.pages ?? [])
        .filter((r) => r.book_id === id)
        .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
      return Object.fromEntries(rows.map((r, i) => [r.id, i]));
    } catch { return {}; }
  }, bookId);

/* ------------------------------ sampler ------------------------------------ */
const startSampler = () =>
  page.evaluate(() => {
    globalThis.__S = [];
    globalThis.__on = true;
    const leaf = (side) => {
      const el = document.querySelector(
        `.nb-spread .nb-sheet-paper[data-side="${side}"]:not(.nb-export-sheet)`,
      );
      if (el === null) return null;
      const prose = el.querySelector('.nb-prose');
      const txt = (prose?.textContent ?? '').trim();
      return { prose: prose !== null, len: txt.length, head: txt.slice(0, 30) };
    };
    const tick = () => {
      if (!globalThis.__on) return;
      const stage = document.querySelector('.nb-spread-stage');
      const fc = globalThis.__flipCache;
      const nx = fc?.facesFor?.('next') ?? null;
      const pv = fc?.facesFor?.('prev') ?? null;
      const ctl = globalThis.__flipCtl;
      const canvas = document.querySelector('canvas.nb-flip-canvas');
      globalThis.__S.push({
        t: performance.now(),
        idx: stage === null ? -1 : Number(stage.getAttribute('data-spread-index')),
        phase: ctl?.phase ?? 'rest',
        p: ctl?.flip?.p ?? 0,
        landing: ctl?.landing ?? false,
        flipping: canvas !== null && canvas.classList.contains('is-flipping'),
        // ids() as the app names them right now
        right: nx?.front ?? null,
        nextL: nx?.back ?? null,
        nextR: nx?.revealed ?? null,
        left: pv?.front ?? null,
        has: nx === null ? null : [nx.hasFront ? 1 : 0, nx.hasBack ? 1 : 0, nx.hasRevealed ? 1 : 0],
        // the faces the RUNNING curl was started with
        curl: globalThis.__curlFaces ?? null,
        L: leaf('left'),
        R: leaf('right'),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const stopSampler = () =>
  page.evaluate(() => { globalThis.__on = false; return globalThis.__S; });

const traceSince = (t0) =>
  page.evaluate((from) => (globalThis.__flipTrace ?? []).filter((e) => e.t >= from), t0);

/* ------------------------------ the drive ---------------------------------- */
// Exactly what shots-now/demo-gif.mjs does: blur, ArrowRight, let it run.
const turn = async () => {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
};

const PANELS = [
  ['Page style', '.nb-pagestyle'],
  ['Catalogue', '.nb-catalogue'],
  ['Table of contents', '.nb-toc'],
  ['Customize this book', '.nb-book-studio'],
  ['In and out', '.nb-share'],
];

/** The sabotage that is supposed to make the skip check go red. */
const jumpAhead = async () => {
  const btn = page.locator('.nb-rail button[aria-label^="Table of contents"]').first();
  await btn.click({ force: true });
  await page.waitForSelector('.nb-toc', { timeout: 20_000 });
  await page.waitForTimeout(900);
  // Whatever the TOC's fifth entry is — several spreads from here by
  // construction, which is the point.
  const entry = page.locator('.nb-toc button').nth(5);
  if (await entry.count()) await entry.click({ force: true });
  await page.waitForTimeout(600);
  // Best effort: clicking an entry may already have put the sheet away.
  const close = page.locator('[aria-label^="Close Table of contents"]').first();
  await close.click({ force: true, timeout: 2000 }).catch(() => {});
};

const runs = [];
for (let i = 0; i < TURNS; i += 1) {
  // The demo opens one panel between turns; do the same before turns 2..6 so
  // a turn that follows a panel close is measured too.
  const panel = PANELS_ON && i >= 1 && i <= PANELS.length ? PANELS[i - 1] : null;
  if (panel !== null) {
    const [name, sel] = panel;
    const btn = page.locator(`.nb-rail button[aria-label^="${name}"]`).first();
    if (await btn.count()) {
      await btn.click({ force: true });
      await page.waitForSelector(sel, { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2200);
      const close = page.locator(`[aria-label^="Close ${name}"]`).first();
      if (await close.count()) await close.click({ force: true });
      await page.waitForTimeout(1400);
    }
  }

  const before = await slotMap();
  if (SABOTAGE === 'cold') {
    // Nothing cached at all: beginFlip's `canCurl` says no and the turn takes
    // the rigid CSS fold, whose faces are the live leaves.
    await page.evaluate(() => globalThis.__flipCache?.clear?.());
  }
  await startSampler();
  await startCast();
  const t0 = await page.evaluate(() => performance.now());
  if (SABOTAGE === 'jump') await jumpAhead();
  else await turn();
  if (SABOTAGE === 'midcurl') {
    // Textures were uploaded, THEN taken away: the canvas keeps curling and
    // the cache now answers "no bitmap" for the faces it is drawing. This is
    // the state the blank-face check exists to catch.
    await page.waitForTimeout(150);
    await page.evaluate(() => globalThis.__flipCache?.clear?.());
  }
  await page.waitForTimeout(3200);
  // A full reload wipes the page globals, so the sampler can come back empty.
  // That is a fact about the dev server, not about the turn — it is recorded
  // and reported rather than crashing the run half way through.
  const frames = (await stopSampler().catch(() => null)) ?? [];
  await stopCast();
  const trace = (await traceSince(t0).catch(() => null)) ?? [];
  const after = await slotMap();
  runs.push({
    i: i + 1,
    panel: panel?.[0] ?? null,
    before,
    after,
    frames,
    trace,
    shots: shots.slice(),
  });
  process.stdout.write(
    `  turn ${i + 1}${panel ? ` (after ${panel[0]})` : ''}: ` +
      `${frames.length} frames, ${trace.length} controller events, ${shots.length} pictures\n`,
  );
}

/* ------------------------------ analysis ----------------------------------- */
const short = (id, map) => (id === null || id === undefined ? '—' : `#${map[id] ?? '?'}`);
const findings = { skips: [], future: [], overlap: [], missingFace: [], crossfade: [] };

console.log('\n=== 1. SKIPPING: how far do the leaves move per turn? ===');
for (const run of runs) {
  const map = { ...run.before, ...run.after };
  const pairs = [];
  for (const f of run.frames) {
    const key = `${short(f.left, map)}/${short(f.right, map)}`;
    if (pairs.length === 0 || pairs[pairs.length - 1].key !== key) {
      pairs.push({ key, t: f.t, idx: f.idx, l: map[f.left], r: map[f.right] });
    }
  }
  const idxs = [];
  for (const f of run.frames) {
    if (idxs.length === 0 || idxs[idxs.length - 1] !== f.idx) idxs.push(f.idx);
  }
  const moves = [];
  for (let k = 1; k < pairs.length; k += 1) {
    const a = pairs[k - 1];
    const b = pairs[k];
    if (Number.isFinite(a.l) && Number.isFinite(b.l)) moves.push(b.l - a.l);
  }
  const bad = moves.filter((m) => m !== 2 && m !== 0);
  const idxMoves = [];
  for (let k = 1; k < idxs.length; k += 1) idxMoves.push(idxs[k] - idxs[k - 1]);
  const idxBad = idxMoves.filter((m) => m !== 1);
  const line =
    `turn ${run.i}${run.panel ? ` (after ${run.panel})` : ''}: ` +
    `spread ${idxs.join(' → ')} | leaves ${pairs.map((p) => p.key).join(' → ')} ` +
    `| pages ${Object.keys(run.before).length} → ${Object.keys(run.after).length}`;
  if (bad.length > 0 || idxBad.length > 0) {
    findings.skips.push(line + ` | slot jumps ${bad.join(',')} idx jumps ${idxBad.join(',')}`);
    console.log(`  BAD  ${line}`);
  } else {
    console.log(`  ok   ${line}`);
  }
}

console.log('\n=== 2. FUTURE PAGES: does the store move under a running curl? ===');
for (const run of runs) {
  const map = { ...run.before, ...run.after };
  // Only frames where the curl is genuinely mid-flight: the canvas is up and
  // the controller has NOT committed navigation yet. The post-commit frames
  // are the artefact probe-blank-spread already documents.
  const mid = run.frames.filter((f) => f.flipping && f.landing === false && f.curl !== null);
  const drift = mid.filter(
    (f) =>
      f.curl !== null &&
      (f.curl.front !== f.right || f.curl.back !== f.nextL || f.curl.revealed !== f.nextR),
  );
  const noTexture = mid.filter((f) => f.has !== null && (f.has[0] === 0 || f.has[2] === 0));
  const span = (l) => (l.length === 0 ? 0 : Math.round(l[l.length - 1].t - l[0].t));
  const cross = run.trace.filter((e) => e.n === 'crossfadeNavigate');
  const webgl = run.trace.find((e) => e.n === 'beginFlip')?.webgl ?? null;
  console.log(
    `  turn ${run.i}: ${mid.length} mid-curl frames (webgl ${webgl}) · ` +
      `faces drifted on ${drift.length} (~${span(drift)}ms) · ` +
      `a face with no bitmap on ${noTexture.length} (~${span(noTexture)}ms)` +
      (cross.length > 0 ? ` · CROSSFADED (no curl)` : ''),
  );
  if (drift.length > 0) {
    const f = drift[0];
    findings.future.push(
      `turn ${run.i}: curl started on ${short(f.curl.front, map)}/${short(f.curl.back, map)}/` +
        `${short(f.curl.revealed, map)} but the app named ` +
        `${short(f.right, map)}/${short(f.nextL, map)}/${short(f.nextR, map)} ` +
        `for ${span(drift)}ms of the curl`,
    );
  }
  if (noTexture.length > 0) {
    findings.missingFace.push(
      `turn ${run.i}: ${noTexture.length} mid-curl frames (~${span(noTexture)}ms) with a face ` +
        `that has no bitmap — the shader draws bare paper there`,
    );
  }
  if (cross.length > 0) findings.crossfade.push(`turn ${run.i} crossfaded instead of curling`);
}

console.log('\n=== 3. OVERLAP: two turns in flight at once? ===');
for (const run of runs) {
  const begins = run.trace.filter((e) => e.n === 'beginFlip' && e.ok !== false);
  const lands = run.trace.filter((e) => e.n === 'land');
  if (begins.length > 1 || lands.length > 1) {
    findings.overlap.push(
      `turn ${run.i}: ${begins.length} beginFlip / ${lands.length} land in one ArrowRight`,
    );
  }
  console.log(
    `  turn ${run.i}: ${run.trace.map((e) => `${Math.round(e.t)}·${e.n}`).join(' ')}`,
  );
}

/* --------------------------- pictures to look at --------------------------- */
// Every turn gets a strip: the frames across the curl, tiled, plus the single
// worst frame full size when there is one.
const writeFrames = (run, label, picks) => {
  const dir = join(OUT, `turn-${String(run.i).padStart(2, '0')}-${label}`);
  mkdirSync(dir, { recursive: true });
  picks.forEach((s, k) => {
    writeFileSync(join(dir, `f${String(k).padStart(3, '0')}.jpg`), Buffer.from(s.data, 'base64'));
  });
  return dir;
};

for (const run of runs) {
  // The curl's own window, in epoch ms, from the sampler.
  const mid = run.frames.filter((f) => f.flipping);
  if (mid.length === 0 || run.shots.length === 0) continue;
  const from = timeOrigin + mid[0].t - 120;
  const to = timeOrigin + mid[mid.length - 1].t + 420;
  const picks = run.shots.filter((s) => s.ts >= from && s.ts <= to);
  const dir = writeFrames(run, 'curl', picks.length > 0 ? picks : run.shots.slice(0, 12));
  console.log(`  turn ${run.i}: ${picks.length} curl pictures → ${dir}`);
}

if (SABOTAGE !== '') {
  const curling = runs.reduce((n, r) => n + r.frames.filter((f) => f.flipping).length, 0);
  const expected =
    SABOTAGE === 'midcurl'
      ? { name: 'curl with a blank face', hits: findings.missingFace.length }
      : SABOTAGE === 'jump'
        ? { name: 'pages skipping', hits: findings.skips.length }
        : // cold: the app is supposed to REFUSE to curl, so the evidence is the
          // absence of curling frames, not a finding.
          { name: 'no WebGL curl at all (rigid fold instead)', hits: curling === 0 ? 1 : 0 };
  console.log(
    `\n${expected.hits > 0 ? 'GATE ALIVE' : 'GATE INERT'} — sabotage=${SABOTAGE} ` +
      `made "${expected.name}" report ${expected.hits}; it must be > 0. ` +
      `(${curling} curling frames across the run)`,
  );
  for (const line of [...findings.missingFace, ...findings.skips]) console.log(`   ${line}`);
  await browser.close();
  process.exit(expected.hits > 0 ? 0 : 1);
}

console.log('\n================ VERDICT ================');
const say = (name, list) =>
  console.log(
    `${name.padEnd(28)} ${list.length === 0 ? 'DOES NOT REPRODUCE' : `${list.length} finding(s)`}`,
  );
say('1 pages skipping', findings.skips);
say('2 future pages (face drift)', findings.future);
say('2b curl with a blank face', findings.missingFace);
say('3 overlapping turns', findings.overlap);
say('  crossfade instead of curl', findings.crossfade);
for (const [k, list] of Object.entries(findings)) {
  for (const line of list) console.log(`   [${k}] ${line}`);
}
console.log('errors:', errors.length ? errors.slice(0, 4) : 'none');
console.log(
  hmr.length === 0
    ? 'no Vite hot update reached the page during the run'
    : `WARNING: ${hmr.length} Vite hot update(s) DURING the run — another agent is editing src/: ` +
      hmr.map((h) => `${new Date(h.at).toISOString().slice(11, 23)} ${h.text}`).join(' | '),
);
console.log(
  reloads.length === 0
    ? 'the page never reloaded mid-run — the numbers are all from one build'
    : `WARNING: the page RELOADED ${reloads.length}x mid-run (${reloads.join(', ')}) — ` +
      'a dev server serving edits from another agent; re-run before trusting this',
);
writeFileSync(join(OUT, 'turns.json'), JSON.stringify(
  runs.map((r) => ({ i: r.i, panel: r.panel, trace: r.trace, frames: r.frames, before: r.before, after: r.after })),
  null,
  1,
));
await browser.close();
