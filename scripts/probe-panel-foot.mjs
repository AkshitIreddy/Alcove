/**
 * scripts/probe-panel-foot.mjs — does the right page lose its foot when a
 * rail panel opens?
 *
 * The owner, watching the recorded demo: *"sometimes when a panel opens the
 * bottom content on the right page disappears"* — and then *"I didn't notice
 * any of the bugs I mentioned in the gif's video when I was testing in the web
 * server."* Both can be true. A rail sheet claims room through
 * `views/rail/panelPush.ts`, `BookView.fitSpread` answers it by SHIFTING and
 * SCALING the whole spread every frame of that tween, and a leaf is clipped by
 * `overflow: hidden` on `.nb-sheet-paper` — so anything that lags the scale by
 * a frame or two takes the foot of the page with it. At 60fps that is a blink;
 * at the GIF's 14fps it is a whole frame, and a whole frame is what the owner
 * was looking at.
 *
 * So: note every top-level block on the RIGHT leaf while the book is at rest,
 * then sample EVERY animation frame through the panel's slide (both ways) and
 * ask of each block —
 *
 *   - is it still in the document at all (a repagination would have carried it
 *     to the next page, and the pagination contract never pulls it back);
 *   - has it collapsed to zero height;
 *   - is any of it still inside the paper's clip rect, or has it been pushed
 *     past the bottom / off the side where `overflow: hidden` eats it.
 *
 * A block that fails any of those is timed: how many frames, how many ms, and
 * whether it came back. The verdict is deliberately three-valued — REPRODUCES
 * LIVE / TRANSIENT ONLY (with the duration) / DOES NOT REPRODUCE — because a
 * 60ms transient is not a non-finding, it is a finding about the recording.
 *
 * Pictures: a CDP screencast runs across each slide and the frames around the
 * worst moment are written out, so the number can be checked against a picture.
 * It has to be the screencast — `page.screenshot()` comes back as blank cream
 * paper on this app in headless Chromium, which would have made every picture
 * in this report evidence of a defect that is not there.
 *
 *   node scripts/probe-panel-foot.mjs [--url=…] [--out=<dir>] [--spreads=1,2,3]
 *                                     [--sabotage]
 *
 * `--sabotage` clips the bottom half off the right leaf for most of one slide
 * (a `clip-path` written from the probe, nothing in src/ touched) purely to
 * watch the checks below go red. A gate you have not watched fail is not a
 * gate — and this one WAS inert twice before it bit, once because the clip did
 * not reach the words and once because the hit test counted an ancestor.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = arg('url', 'http://localhost:1420');
const OUT = arg('out', 'qa/panel-foot');
const SPREADS = arg('spreads', '1,2,3').split(',').map(Number);
/**
 * Type N lines into the right leaf first.
 *
 * The Welcome book's pages stop well short of the foot, and a page with room
 * to spare cannot demonstrate losing its foot. `--fill` walks the page up to
 * the pagination contract's own boundary — the drain carries the excess
 * forward, so what is left is a page filled to just under capacity, with its
 * last block against the bottom edge. That is the page the report is about,
 * and it is the page whose capacity a panel's scale re-measures.
 */
const FILL = Number(arg('fill', '0'));
const ONLY = arg('only', '');
const SABOTAGE = process.argv.includes('--sabotage');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
// Full motion: with reduced motion the panel does not slide and the whole
// window this probe exists to measure never happens.
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
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, everyNthFrame: 1 });
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
/* -------------------------------- boot ------------------------------------- */
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
const opened = await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
  return w ? w.id : null;
});
if (!opened) { console.error('FAIL: no book on the shelf'); await browser.close(); process.exit(1); }
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForSelector('.nb-spread-stage', { timeout: 60_000 });
await page.waitForTimeout(6000);

const timeOrigin = await page.evaluate(() => performance.timeOrigin);
booted = true;

/* --------------------------- what the leaf holds --------------------------- */
/**
 * Every top-level block on one leaf, with the geometry that decides whether a
 * reader can see it.
 *
 * `visible` is an AREA test, not a "does it have a box" test: the leaf is
 * clipped by `overflow: hidden` at `.nb-sheet-paper` AND at `.nb-page-editor`,
 * so a block can have a perfectly good rect and still be entirely eaten. The
 * fraction is against the block's own area, so a block half over the edge
 * reads 0.5 and the report can say how much of it went.
 */
const READ_LEAF = `(side) => {
  const paper = document.querySelector(
    '.nb-spread .nb-sheet-paper[data-side="' + side + '"]:not(.nb-export-sheet)'
  );
  if (paper === null) return null;
  const prose = paper.querySelector('.nb-prose');
  const editor = paper.querySelector('.nb-page-editor');
  const clipOf = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  };
  const clips = [clipOf(paper), { l: 0, t: 0, r: innerWidth, b: innerHeight }];
  if (editor !== null) clips.push(clipOf(editor));
  const clip = clips.reduce((a, c) => ({
    l: Math.max(a.l, c.l), t: Math.max(a.t, c.t),
    r: Math.min(a.r, c.r), b: Math.min(a.b, c.b),
  }));
  const blocks = [...(prose?.children ?? [])].map((el, i) => {
    const r = el.getBoundingClientRect();
    const area = Math.max(r.width, 0) * Math.max(r.height, 0);
    const ix = { l: Math.max(r.left, clip.l), t: Math.max(r.top, clip.t),
                 r: Math.min(r.right, clip.r), b: Math.min(r.bottom, clip.b) };
    const iw = Math.max(0, ix.r - ix.l);
    const ih = Math.max(0, ix.b - ix.t);
    const text = (el.textContent ?? '').trim();
    /*
     * AND A HIT TEST, because a rectangle is not a picture.
     *
     * The first version of this probe scored a block purely on where its box
     * was against its clipping ancestors' boxes — and it therefore reported a
     * block as perfectly visible while a deliberate 90px \`clip-path\` was
     * eating it, which is how the sabotage run came back GATE INERT. A rect
     * knows nothing about clip-path, visibility, opacity, or anything painted
     * over the top. Asking the document what is actually AT that point knows
     * about all four, and it is the question a screenshot answers.
     */
    let hit = null;
    if (iw > 2 && ih > 2) {
      const at = document.elementFromPoint((ix.l + ix.r) / 2, (ix.t + ix.b) / 2);
      // The topmost element at that point must BE the block or live inside it.
      // An at.contains(el) clause was in this line once and made it inert:
      // when a clip-path hides the block, the hit lands on its ANCESTOR leaf,
      // which of course contains the block, so every hidden block scored as a
      // hit. The sabotage run is what caught it.
      hit = at !== null && (at === el || el.contains(at));
    }
    return {
      i,
      tag: el.tagName.toLowerCase(),
      head: text.slice(0, 34),
      len: text.length,
      w: Math.round(r.width), h: Math.round(r.height),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      visible: area <= 0 ? 0 : Math.round(((iw * ih) / area) * 100) / 100,
      hit,
    };
  });
  const pr = paper.getBoundingClientRect();
  return {
    blocks,
    text: (prose?.textContent ?? '').trim().length,
    paper: { top: Math.round(pr.top), bottom: Math.round(pr.bottom),
             left: Math.round(pr.left), right: Math.round(pr.right),
             h: Math.round(pr.height), lay: paper.clientHeight },
    clip: { b: Math.round(clip.b), r: Math.round(clip.r) },
  };
}`;

const readLeaf = (side) => page.evaluate(`(${READ_LEAF})('${side}')`);

const startSampler = () =>
  page.evaluate((src) => {
    const read = eval(src);
    globalThis.__P = [];
    globalThis.__on = true;
    const tick = () => {
      if (!globalThis.__on) return;
      const html = document.documentElement;
      const view = document.querySelector('.nb-book-view');
      globalThis.__P.push({
        t: performance.now(),
        edge: html.style.getPropertyValue('--nb-panel-edge'),
        fit: view?.style.getPropertyValue('--nb-spread-fit') ?? '',
        shift: view?.style.getPropertyValue('--nb-spread-shift') ?? '',
        R: read('right'),
        L: read('left'),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, READ_LEAF);

const stopSampler = () =>
  page.evaluate(() => { globalThis.__on = false; return globalThis.__P; });

/* ------------------------------ the drive ---------------------------------- */
const turn = async () => {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2600);
};

const PANELS = [
  ['Page style', '.nb-pagestyle'],
  ['Catalogue', '.nb-catalogue'],
  ['Table of contents', '.nb-toc'],
  ['Customize this book', '.nb-book-studio'],
  ['In and out', '.nb-share'],
];

/**
 * One block's worst moment across a slide: the frames where a reader could not
 * see it, why, and how long that lasted.
 */
const judge = (base, frames, sideKey) => {
  const rows = [];
  for (const b of base.blocks) {
    if (b.len === 0 || b.visible < 0.5 || b.hit === false) continue; // nothing to lose
    const bad = [];
    for (const f of frames) {
      const leaf = f[sideKey];
      if (leaf === null) continue;
      const now =
        leaf.blocks.find((x) => x.head === b.head && x.len === b.len) ??
        leaf.blocks.find((x) => x.head === b.head) ??
        null;
      const why =
        now === null ? 'gone from the page'
          : now.h <= 1 ? 'collapsed to zero height'
            : now.visible < 0.5 ? `clipped (${Math.round(now.visible * 100)}% showing)`
              : now.hit === false ? 'not the thing drawn at its own centre'
                : null;
      if (why !== null) bad.push({ t: f.t, why, edge: f.edge, fit: f.fit });
    }
    if (bad.length === 0) continue;
    // Longest contiguous run of bad frames, in ms.
    let runStart = 0;
    let best = { from: 0, to: 0, n: 0, why: '' };
    for (let k = 0; k < bad.length; k += 1) {
      const contiguous =
        k > 0 && frames.findIndex((f) => f.t === bad[k].t) ===
          frames.findIndex((f) => f.t === bad[k - 1].t) + 1;
      if (!contiguous) runStart = k;
      const n = k - runStart + 1;
      if (n > best.n) best = { from: bad[runStart].t, to: bad[k].t, n, why: bad[k].why };
    }
    const last = frames[frames.length - 1][sideKey];
    const recovered =
      last !== null &&
      (last.blocks.find((x) => x.head === b.head)?.visible ?? 0) >= 0.5;
    rows.push({
      head: b.head,
      frames: bad.length,
      of: frames.length,
      ms: Math.round(best.to - best.from) || Math.round(1000 / 60),
      why: best.why,
      at: best.from,
      recovered,
    });
  }
  return rows;
};

const results = [];
let spread = 0;
for (const target of SPREADS) {
  while (spread < target) { await turn(); spread += 1; }
  await page.waitForTimeout(900);

  if (FILL > 0) {
    // A real caret in the real editor, at the end of the last block, then
    // lines of prose until the leaf is packed. Typed rather than written
    // straight into the store so the pagination contract runs exactly as it
    // does for a reader.
    const paper = await page
      .locator('.nb-spread .nb-sheet-paper[data-side="right"] .nb-prose')
      .first()
      .boundingBox();
    if (paper !== null) {
      await page.mouse.click(paper.x + paper.width / 2, paper.y + paper.height - 12);
      await page.keyboard.press('Control+End');
      for (let n = 0; n < FILL; n += 1) {
        await page.keyboard.press('Enter');
        await page.keyboard.type(
          `Filler line ${n + 1} — the foot of the page, where a lost block would show.`,
          { delay: 2 },
        );
      }
      await page.waitForTimeout(1800);
      await page.evaluate(() => {
        const el = document.activeElement;
        if (el instanceof HTMLElement) el.blur();
      });
      await page.waitForTimeout(900);
    }
  }

  for (const [name, sel] of PANELS) {
    if (ONLY !== '' && !name.toLowerCase().includes(ONLY.toLowerCase())) continue;
    const btn = page.locator(`.nb-rail button[aria-label^="${name}"]`).first();
    if ((await btn.count()) === 0) { console.log(`  (no rail button for ${name})`); continue; }

    const base = await readLeaf('right');
    const baseL = await readLeaf('left');
    if (base === null) { console.log(`  (no right leaf to measure at spread ${target})`); continue; }

    /* ---- OPENING ---- */
    await startSampler();
    await startCast();
    await btn.click({ force: true });
    if (SABOTAGE) {
      /*
       * A deliberate bite out of the bottom HALF of the right leaf, held for
       * most of the slide and then let go. Nothing in src/ is touched — this
       * is an inline style written by the probe.
       *
       * Two earlier versions of this sabotage failed for reasons worth keeping:
       * 90px off the foot hid nothing, because the Welcome page's last line
       * stops a third of the way up; and applying it BEFORE the click hid
       * nothing that was sampled, because rAF does not run in a headless page
       * that is standing still — the sampler's first frame does not arrive
       * until the panel starts moving, by which time a short-lived clip has
       * already been let go. So it goes on AFTER the click, with the slide.
       */
      const sab = await page.evaluate(() => {
        const paper = document.querySelector(
          '.nb-spread .nb-sheet-paper[data-side="right"]:not(.nb-export-sheet)',
        );
        if (!(paper instanceof HTMLElement)) return { found: false };
        paper.style.clipPath = 'inset(0 0 55% 0)';
        setTimeout(() => { paper.style.clipPath = ''; }, 3000);
        return { found: true, at: performance.now(), cs: getComputedStyle(paper).clipPath };
      });
      console.log('    [sabotage]', JSON.stringify(sab));
    }
    await page.waitForSelector(sel, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const openFrames = await stopSampler();
    await stopCast();
    const openShots = shots.slice();
    const settledOpen = await readLeaf('right');

    /* ---- CLOSING ---- */
    await page.waitForTimeout(500);
    await startSampler();
    await startCast();
    const close = page.locator(`[aria-label^="Close ${name}"]`).first();
    await close.click({ force: true, timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const shutFrames = await stopSampler();
    await stopCast();
    const shutShots = shots.slice();
    const settledShut = await readLeaf('right');

    results.push({
      spread: target,
      panel: name,
      base,
      baseL,
      settledOpen,
      settledShut,
      open: { frames: openFrames, shots: openShots, rows: judge(base, openFrames, 'R'),
              rowsL: judge(baseL, openFrames, 'L') },
      shut: { frames: shutFrames, shots: shutShots, rows: judge(base, shutFrames, 'R') },
    });
    process.stdout.write(
      `  spread ${target} · ${name.padEnd(20)} ` +
        `open ${openFrames.length}f/${results[results.length - 1].open.rows.length} blocks lost · ` +
        `close ${shutFrames.length}f/${results[results.length - 1].shut.rows.length} lost\n`,
    );
    await page.waitForTimeout(600);
  }
}

/* ------------------------------ the report --------------------------------- */
console.log('\n=== the right leaf, block by block, through each panel slide ===');
let worst = null;
for (const r of results) {
  const scaleOpen = r.open.frames.map((f) => f.fit).filter((v) => v !== '');
  const head =
    `spread ${r.spread} · ${r.panel}: right leaf had ${r.base.blocks.length} blocks, ` +
    `${r.base.text} chars; fit ${scaleOpen[0] ?? '?'} → ${scaleOpen[scaleOpen.length - 1] ?? '?'}; ` +
    `settled open ${r.settledOpen?.text ?? '?'} chars, settled shut ${r.settledShut?.text ?? '?'} chars`;
  const all = [...r.open.rows.map((x) => ({ ...x, when: 'opening' })),
               ...r.shut.rows.map((x) => ({ ...x, when: 'closing' }))];
  if (all.length === 0) { console.log(`  ok   ${head}`); continue; }
  console.log(`  LOST ${head}`);
  for (const row of all) {
    console.log(
      `        ${row.when} · "${row.head}" ${row.why} for ${row.frames} of ${row.of} frames ` +
        `(worst run ${row.ms}ms) — ${row.recovered ? 'came back' : 'DID NOT come back'}`,
    );
    if (worst === null || row.ms > worst.row.ms) worst = { row, run: r, when: row.when };
  }
  // The left leaf, only as a control: the owner named the right one.
  for (const row of r.open.rowsL) {
    console.log(`        (left leaf) "${row.head}" ${row.why} for ${row.frames} frames`);
  }
}

/* ---------------------------- pictures to look at -------------------------- */
const dump = (label, shotList, fromMs, toMs) => {
  const dir = join(OUT, label);
  mkdirSync(dir, { recursive: true });
  /*
   * STRICTLY the frames inside the window, and the count is reported.
   *
   * This used to fall back to "then just write all of them" when the window
   * caught nothing, and that is how a picture from a perfectly healthy moment
   * ended up filed as the evidence for a defect. An empty window is a fact
   * about the capture (the screencast only emits a frame when the compositor
   * produces one) and has to read as empty.
   */
  const picks = shotList.filter((s) => s.ts >= fromMs && s.ts <= toMs);
  picks.forEach((s, k) =>
    writeFileSync(join(dir, `f${String(k).padStart(3, '0')}.jpg`), Buffer.from(s.data, 'base64')),
  );
  return `${dir} (${picks.length} of ${shotList.length} frames inside the window)`;
};

if (SABOTAGE) {
  // Every frame of the first sabotaged slide, so the checks can be held
  // against the pictures rather than trusted.
  const r = results[0];
  if (r) console.log('sabotage, all open frames → ' + dump('sab-all-open', r.open.shots, 0, Infinity));
}

if (worst !== null) {
  const { run, when, row } = worst;
  const bag = when === 'opening' ? run.open : run.shut;
  console.log(
    `\nworst: "${row.head}" ${row.why} for ${row.ms}ms while ${when} ${run.panel} ` +
      `on spread ${run.spread}`,
  );
  console.log(
    '  frames → ' +
      dump(
        `worst-${run.spread}-${run.panel.replace(/\W+/g, '-')}-${when}`,
        bag.shots,
        timeOrigin + row.at - 400,
        timeOrigin + row.at + 900,
      ),
  );
} else {
  // Nothing went missing — keep one slide anyway, so the report can show what
  // a clean panel open looks like at frame resolution.
  const r = results[0];
  if (r) console.log('\nclean slide → ' + dump('clean-open', r.open.shots, 0, Infinity));
}

const lost = results.reduce((n, r) => n + r.open.rows.length + r.shut.rows.length, 0);
const permanent = results.reduce(
  (n, r) => n + [...r.open.rows, ...r.shut.rows].filter((x) => !x.recovered).length,
  0,
);
const longest = Math.max(
  0,
  ...results.flatMap((r) => [...r.open.rows, ...r.shut.rows].map((x) => x.ms)),
);
console.log('\n================ VERDICT ================');
if (SABOTAGE) {
  console.log(
    `${lost > 0 ? 'GATE ALIVE' : 'GATE INERT'} — the deliberate 90px clip made ` +
      `${lost} block(s) report as lost; it must be > 0.`,
  );
} else if (lost === 0) {
  console.log('3 right page loses its foot on a panel open: DOES NOT REPRODUCE');
} else if (permanent === 0) {
  console.log(
    `3 right page loses its foot on a panel open: TRANSIENT ONLY — ` +
      `${lost} block-slide(s), longest ${longest}ms, all recovered`,
  );
} else {
  console.log(
    `3 right page loses its foot on a panel open: REPRODUCES LIVE — ` +
      `${permanent} block(s) never came back (longest bad run ${longest}ms)`,
  );
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
writeFileSync(
  join(OUT, 'panel-foot.json'),
  JSON.stringify(
    results.map((r) => ({
      spread: r.spread, panel: r.panel,
      base: r.base, settledOpen: r.settledOpen, settledShut: r.settledShut,
      open: { rows: r.open.rows, frames: r.open.frames },
      shut: { rows: r.shut.rows, frames: r.shut.frames },
    })),
    null,
    1,
  ),
);
await browser.close();
process.exit(SABOTAGE ? (lost > 0 ? 0 : 1) : 0);
