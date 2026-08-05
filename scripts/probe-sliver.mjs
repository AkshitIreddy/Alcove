/**
 * scripts/probe-sliver.mjs — is a book ever drawn at a sliver width, and does
 * a floor ever draw fewer books than it holds?
 *
 * Written to settle demo-frame finding f295 ("a floor draws exactly one
 * hairline sliver of a book, while the floor above is half-populated with
 * featureless blocks") against the RUNNING app rather than against a
 * recording, because a running app can answer questions a video cannot: what
 * width the store says a book should have, how many books the floor holds, and
 * how long a spine spends on `placeholderTint` before its texture lands.
 *
 * Four measurements, all on the APPLIED side (the Pixi sprites), never on what
 * was merely stored:
 *
 *   1. WIDTH.  Every mounted book sprite's drawn width — |scale.x| × the
 *      texture's `orig.width`, which is exactly what Pixi rasterizes — against
 *      `visual.w`, the width `floorView` laid the row out with. A sliver is a
 *      ratio well under 1.
 *   2. POPULATION.  `fv.visuals.length` against `store.get(floor).length`, per
 *      floor, per frame — plus the blank window: how long a mounted floor that
 *      HOLDS books draws none of them.
 *   3. PLACEHOLDER.  Per book, the ms between the frame it first appears on
 *      `Texture.WHITE` and the frame its baked spine arrives.
 *   4. WHERE IT STANDS.  How far a spine's right edge reaches past the right
 *      rail — a book half behind the case frame is the other way to draw a
 *      sliver, and `layout.ts` gives up its spacing rules on an over-full row.
 *
 * The sampler runs INSIDE the page on rAF from before the app's first line
 * (addInitScript), so it sees the cold start and every mid-transition frame a
 * screenshot-and-measure loop would step straight over.
 *
 * The phases are the moments the shelf actually changes what it is drawing:
 * cold start, a static sweep across both LOD boundaries, a live wheel zoom
 * through them, a pan, a bookcase switch, and a room preset apply (which
 * retires every baked spine at once — the mechanism behind the sibling
 * flat-spines defect).
 *
 * A gate nobody has watched fail is not a gate, so `--sabotage` narrows one
 * live sprite and drops another floor's books on the floor, and the run prints
 * GATE ALIVE / GATE INERT for each of the two verdicts.
 *
 * Usage: node scripts/probe-sliver.mjs [--url=http://localhost:1420]
 *                                      [--out=<dir for screenshots>]
 *                                      [--sabotage]
 *
 * The full run is the default. The narrow modes each stock a case first and
 * then answer one question on its own:
 *
 *   --store        the store's thickness vs the row's width vs the pixels
 *   --cold=N       the untextured window on N cold starts, in ms
 *   --trace-cold   what the factory's queue, workers and atlases are doing
 *                  through that window
 *   --ab           colour-only vs carpentry-only vs wallpaper-only room
 *                  changes, counting placeholder flashes in each
 *   --f295         the reported composition photographed through a cold start:
 *                  a floor holding one thin book under a part-filled floor
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = opt('out', 'qa/sliver');
const SABOTAGE = args.includes('--sabotage');
/**
 * Run only the stocking phase and the colour-vs-carpentry A/B.
 *
 * The full run showed every book flashing back to a placeholder for 31–65ms on
 * a room apply, which the retirement generation is supposed to prevent. The
 * two halves of a room go through different doors — `setTheme` retires, and
 * `setBuild` drops — so this changes ONE axis at a time and counts the flashes.
 */
const AB = args.includes('--ab');
/**
 * Stock, then compare THREE numbers per book: the thickness the store holds
 * (`BookStyle.thickness`), the width the row laid out (`visual.w`), and the
 * width Pixi rasterizes (|scale.x| × texture.orig.width). The full run's width
 * check compares the last two, which are both `floorView`'s — this is the one
 * that closes the loop back to the store.
 */
const STORE = args.includes('--store');
/**
 * Photograph the f295 composition itself: a cold start, framed on a floor that
 * holds one thin book with a part-filled floor above it, shot every few hundred
 * ms through the window where the spines are still placeholders.
 */
const F295 = args.includes('--f295');

mkdirSync(OUT, { recursive: true });

/* ------------------------------ the sampler -------------------------------- */
/*
 * Installed with addInitScript so it is running before the shelf exists. It
 * reads `globalThis.__shelfWorld` every frame rather than closing over one
 * instance: the dev server is shared, and an HMR update tears the world down
 * and builds another.
 */
const SAMPLER = () => {
  const state = {
    frames: 0,
    worlds: 0,
    mark: '',
    stopped: false,
    worstNarrow: null,
    worstWide: null,
    narrowSamples: [],
    shortfalls: [],
    blankSpells: [],
    spells: [],
    relapses: [],
    overhangs: [],
    open: new Map(),
    seenTextured: new Set(),
    mounts: new Map(),
  };
  globalThis.__sliver = state;

  const RAIL_W = 34;
  const SHELF_WIDTH = 1200;
  let lastWorld = null;

  const tick = () => {
    if (state.stopped) {
      requestAnimationFrame(tick);
      return;
    }
    const w = globalThis.__shelfWorld;
    if (w === undefined || w === null || w.floors === undefined) {
      requestAnimationFrame(tick);
      return;
    }
    if (w !== lastWorld) {
      lastWorld = w;
      state.worlds += 1;
      state.open.clear();
      state.mounts.clear();
    }
    const now = performance.now();
    state.frames += 1;
    const present = new Set();
    const live = new Set();

    for (const [index, fv] of w.floors) {
      live.add(index);
      let m = state.mounts.get(index);
      if (m === undefined || m.fv !== fv) {
        m = { fv, since: now, dataAt: null, firstSpriteAt: null, fullAt: null, texturedAt: null };
        state.mounts.set(index, m);
      }
      const stored = w.store.get(index);
      const holds = stored === undefined ? null : stored.length;
      if (holds !== null && m.dataAt === null) m.dataAt = now;
      if (fv.visuals.length > 0 && m.firstSpriteAt === null) m.firstSpriteAt = now;
      if (holds !== null && fv.visuals.length === holds && m.fullAt === null) m.fullAt = now;

      // A floor that HOLDS books and draws none, or draws fewer than it holds.
      if (holds !== null && holds > 0 && fv.visuals.length !== holds) {
        state.shortfalls.push({
          t: Math.round(now),
          floor: index,
          sprites: fv.visuals.length,
          holds,
          loaded: fv.loaded,
          sinceMount: Math.round(now - m.since),
          zoom: Number(w.camera.zoom.toFixed(3)),
          tier: fv.tier,
          mark: state.mark,
        });
      }

      let untextured = 0;
      for (const v of fv.visuals) {
        const s = v.sprite;
        const t = s.texture;
        const drawn = Math.abs(s.scale.x) * t.orig.width;
        const ratio = v.w > 0 ? drawn / v.w : 1;
        const rec = {
          t: Math.round(now),
          title: v.book.title,
          floor: index,
          expected: Number(v.w.toFixed(2)),
          drawn: Number(drawn.toFixed(2)),
          ratio: Number(ratio.toFixed(4)),
          origW: t.orig.width,
          scaleX: Number(s.scale.x.toFixed(4)),
          texture: t.label ?? '',
          destroyed: t.destroyed === true,
          tier: fv.tier,
          zoom: Number(w.camera.zoom.toFixed(3)),
          mark: state.mark,
        };
        if (state.worstNarrow === null || ratio < state.worstNarrow.ratio) state.worstNarrow = rec;
        if (state.worstWide === null || ratio > state.worstWide.ratio) state.worstWide = rec;
        if (ratio < 0.995 && state.narrowSamples.length < 200) state.narrowSamples.push(rec);

        // How far past the rails the row reaches (over-full floors overflow
        // right, and the rails are drawn IN FRONT of the books).
        const half = v.w / 2;
        const overRight = v.centerX + half - (SHELF_WIDTH - RAIL_W);
        const overLeft = RAIL_W - (v.centerX - half);
        const over = Math.max(overRight, overLeft);
        if (over > 0 && state.overhangs.length < 200) {
          state.overhangs.push({
            floor: index,
            title: v.book.title,
            centerX: Number(v.centerX.toFixed(1)),
            w: Number(v.w.toFixed(1)),
            hiddenPx: Number(over.toFixed(1)),
            visiblePx: Number(Math.max(0, v.w - over).toFixed(1)),
            holds: holds,
            mark: state.mark,
          });
        }

        const key = `${index}|${v.book.id}`;
        present.add(key);
        const placeholder = t.label === 'WHITE';
        if (placeholder) untextured += 1;
        const open = state.open.get(key);
        if (placeholder) {
          if (open === undefined) {
            state.open.set(key, {
              since: now,
              floor: index,
              title: v.book.title,
              zoom: Number(w.camera.zoom.toFixed(3)),
              tier: fv.tier,
              mark: state.mark,
              relapse: state.seenTextured.has(key),
            });
            if (state.seenTextured.has(key)) {
              state.relapses.push({
                t: Math.round(now),
                floor: index,
                title: v.book.title,
                zoom: Number(w.camera.zoom.toFixed(3)),
                mark: state.mark,
              });
            }
          }
        } else {
          state.seenTextured.add(key);
          if (open !== undefined) {
            state.spells.push({
              ms: Math.round(now - open.since),
              floor: open.floor,
              title: open.title,
              zoom: open.zoom,
              tier: open.tier,
              mark: open.mark,
              relapse: open.relapse,
            });
            state.open.delete(key);
          }
        }
      }
      if (untextured === 0 && fv.visuals.length > 0 && m.texturedAt === null) m.texturedAt = now;
    }

    // Retire mounts that went away, banking the blank window they showed.
    for (const [index, m] of [...state.mounts]) {
      if (live.has(index)) continue;
      state.mounts.delete(index);
      if (m.dataAt !== null && m.firstSpriteAt === null) {
        state.blankSpells.push({ floor: index, ms: null, note: 'held books, never drew one', mark: state.mark });
      }
    }
    for (const key of [...state.open.keys()]) {
      if (!present.has(key)) state.open.delete(key);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/* -------------------------------- harness ---------------------------------- */

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
await page.addInitScript(SAMPLER);

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
  await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'world hook');
};

const report = [];
const say = (line) => {
  console.log(line);
  report.push(line);
};

const mark = async (label) => {
  await page.evaluate((m) => {
    if (globalThis.__sliver !== undefined) globalThis.__sliver.mark = m;
  }, label);
};

const setCam = async (zoom, y) => {
  await ready();
  await page.evaluate(
    ({ z, camY }) => {
      const w = globalThis.__shelfWorld;
      const cam = w.camera;
      cam.vx = 0;
      cam.vy = 0;
      cam.anchor = null;
      cam.zoom = z;
      cam.logZoomTarget = Math.log(z);
      cam.y = camY;
      cam.x = (1200 - w.vp.width / z) / 2;
      w.dirty = true;
    },
    { z: zoom, camY: y },
  );
};

const audit = async () => {
  await ready();
  return page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const floors = [];
    for (const [index, fv] of w.floors) {
      const stored = w.store.get(index);
      floors.push({
        index,
        tier: fv.tier,
        loaded: fv.loaded,
        stored: stored === undefined ? null : stored.length,
        sprites: fv.visuals.length,
        placeholders: fv.visuals.filter((v) => v.sprite.texture.label === 'WHITE').length,
        widths: fv.visuals.map((v) => ({
          title: v.book.title,
          expected: Number(v.w.toFixed(1)),
          drawn: Number((Math.abs(v.sprite.scale.x) * v.sprite.texture.orig.width).toFixed(1)),
          height: Number(v.height.toFixed(1)),
          centerX: Number(v.centerX.toFixed(1)),
          placeholder: v.sprite.texture.label === 'WHITE',
        })),
      });
    }
    return {
      zoom: Number(w.camera.zoom.toFixed(3)),
      camY: Math.round(w.camera.y),
      tier: w.tier,
      floorCount: w.floorCount,
      floors: floors.sort((a, b) => a.index - b.index),
    };
  });
};

/** Read the sampler's accumulator and clear it (survives across reloads). */
const drain = async () =>
  page.evaluate(() => {
    const st = globalThis.__sliver;
    if (st === undefined) return null;
    const out = {
      frames: st.frames,
      worlds: st.worlds,
      worstNarrow: st.worstNarrow,
      worstWide: st.worstWide,
      narrowSamples: st.narrowSamples.slice(),
      shortfalls: st.shortfalls.slice(),
      blankSpells: st.blankSpells.slice(),
      spells: st.spells.slice(),
      relapses: st.relapses.slice(),
      overhangs: st.overhangs.slice(),
      openNow: [...st.open.values()].map((o) => ({
        floor: o.floor,
        title: o.title,
        ms: Math.round(performance.now() - o.since),
      })),
      mounts: [...st.mounts.entries()].map(([i, m]) => ({
        floor: i,
        toData: m.dataAt === null ? null : Math.round(m.dataAt - m.since),
        toFirstSprite: m.firstSpriteAt === null ? null : Math.round(m.firstSpriteAt - m.since),
        toFull: m.fullAt === null ? null : Math.round(m.fullAt - m.since),
        toTextured: m.texturedAt === null ? null : Math.round(m.texturedAt - m.since),
      })),
    };
    st.frames = 0;
    st.narrowSamples.length = 0;
    st.shortfalls.length = 0;
    st.blankSpells.length = 0;
    st.spells.length = 0;
    st.relapses.length = 0;
    st.overhangs.length = 0;
    return out;
  });

const banked = [];
const bank = async (phase) => {
  const d = await drain();
  if (d !== null) banked.push({ phase, ...d });
  return d;
};

const summarise = (phase, d) => {
  if (d === null) return;
  const spells = d.spells.map((s) => s.ms).sort((a, b) => a - b);
  const pct = (p) => (spells.length === 0 ? '-' : `${spells[Math.floor((spells.length - 1) * p)]}ms`);
  say(
    `  [${phase}] frames ${d.frames} | worst width ratio ${d.worstNarrow ? d.worstNarrow.ratio : '-'}` +
      ` | shortfall frames ${d.shortfalls.length}` +
      ` | placeholder spells ${spells.length} (p50 ${pct(0.5)}, p90 ${pct(0.9)}, max ${pct(1)})` +
      ` | relapses ${d.relapses.length}`,
  );
  for (const s of d.shortfalls.slice(0, 6)) say(`     shortfall ${JSON.stringify(s)}`);
  for (const m of d.mounts.filter((x) => x.toFull === null || x.toFull > 200).slice(0, 6)) {
    say(`     slow mount ${JSON.stringify(m)}`);
  }
  const longest = d.spells.slice().sort((a, b) => b.ms - a.ms)[0];
  if (longest !== undefined) say(`     longest placeholder ${JSON.stringify(longest)}`);
};

/* ------------------------ phase 0 — stock the case ------------------------- */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await ready();
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y mirror');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(2500);

say('## phase 0 — stocking the case');
await mark('stock');
const TITLES = [
  'The Salt Almanac', 'Fennel and the Long Wait', 'Marginalia', 'Kestrel',
  'A Field Guide to Rain', 'Inkwell', 'Cormorant', 'Dust', 'Eaves',
  'Gorse', 'Hollow', 'Juniper', 'Lantern', 'Mistle', 'Nettle', 'Orchard',
  'Pennyroyal', 'Quill', 'Rushlight', 'Sorrel', 'Tansy', 'Umber',
  'Vetch', 'Wold', 'Yarrow', 'Zephyr', 'Bindweed', 'Chalk',
];
await page.evaluate(async (titles) => {
  await globalThis.__shelfSeedBooks(titles, 0);
  await globalThis.__shelfSeedBooks(titles.slice(0, 12), 1);
  await globalThis.__shelfSeedBooks(titles.slice(0, 8), 2);
  await globalThis.__shelfSeedBooks(titles.slice(0, 4), 3);
  // The f295 signature itself: a floor holding exactly one book.
  await globalThis.__shelfSeedBooks(['A'], 4);
  await globalThis.__shelfSeedBooks(titles.slice(0, 20), 5);
}, TITLES);
await page.waitForTimeout(4000);
{
  const a = await audit();
  say(`  stocked: ${a.floors.map((f) => `${f.index}:${f.stored ?? '?'}`).join(' ')}`);
}
summarise('stock', await bank('stock'));

/* ------------- what the factory is doing during that window ---------------- */

if (args.includes('--trace-cold')) {
  say('');
  say('## the spine factory through a cold start (sampled every 100ms)');
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready();
  const trace = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const rows = [];
        const sample = () => {
          const w = globalThis.__shelfWorld;
          const f = w?.factory;
          if (f !== undefined) {
            let books = 0;
            let ph = 0;
            for (const [, fv] of w.floors) {
              for (const v of fv.visuals) {
                books += 1;
                if (v.sprite.texture.label === 'WHITE') ph += 1;
              }
            }
            rows.push({
              ms: Math.round(performance.now() - t0),
              books,
              placeholders: ph,
              queue: f.queue?.size ?? -1,
              inFlight: f.inFlight?.size ?? -1,
              lo: f.loTextures?.size ?? -1,
              hi: f.hiTextures?.size ?? -1,
              fontsReady: f.fontsReady === true,
              workers: f.offload?.size ?? -1,
              workersAvailable: f.offload?.available === true,
            });
          }
          if (performance.now() - t0 > 6000) resolve(rows);
          else setTimeout(sample, 100);
        };
        sample();
      }),
  );
  for (const r of trace) {
    if (r.ms % 200 !== 0 && r.ms > 400) continue;
    say(
      `  ${String(r.ms).padStart(4)}ms books ${String(r.books).padStart(2)} featureless ${String(r.placeholders).padStart(2)}` +
        ` | queue ${String(r.queue).padStart(3)} inFlight ${String(r.inFlight).padStart(2)}` +
        ` | lo ${String(r.lo).padStart(2)} hi ${String(r.hi).padStart(2)}` +
        ` | fonts ${r.fontsReady ? 'ready' : 'WAIT '} workers ${r.workers}${r.workersAvailable ? '' : ' (none)'}`,
    );
  }
  writeFileSync(join(OUT, 'cold-trace.json'), JSON.stringify(trace, null, 2), 'utf8');
  writeFileSync(join(OUT, 'cold-trace.txt'), report.join('\n'), 'utf8');
  await browser.close();
  process.exit(0);
}

/* ------------------- how long is the untextured window? -------------------- */

if (args.some((a) => a.startsWith('--cold'))) {
  const runs = Number(opt('cold', '4'));
  say('');
  say(`## the untextured window on ${runs} cold starts (ms from first sprite to last texture)`);
  for (let i = 0; i < runs; i++) {
    await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await ready();
    await mark(`cold ${i + 1}`);
    // Watch the shelf until nothing on it is on a placeholder any more, from
    // inside the page so the answer is a frame number rather than a poll.
    const w = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const t0 = performance.now();
          let sawBooks = false;
          let firstBookAt = null;
          const tick = () => {
            const world = globalThis.__shelfWorld;
            if (world === undefined) {
              requestAnimationFrame(tick);
              return;
            }
            let books = 0;
            let placeholders = 0;
            for (const [, fv] of world.floors) {
              for (const v of fv.visuals) {
                books += 1;
                if (v.sprite.texture.label === 'WHITE') placeholders += 1;
              }
            }
            if (books > 0 && !sawBooks) {
              sawBooks = true;
              firstBookAt = performance.now();
            }
            if (sawBooks && placeholders === 0) {
              resolve({
                books,
                toFirstBook: Math.round(firstBookAt - t0),
                untexturedMs: Math.round(performance.now() - firstBookAt),
              });
              return;
            }
            if (performance.now() - t0 > 20000) {
              resolve({ books, placeholders, untexturedMs: -1, note: 'gave up at 20s' });
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    say(`  run ${i + 1}: ${w.books} books on screen, untextured for ${w.untexturedMs}ms`);
    await page.screenshot({ path: join(OUT, `cold-run${i + 1}.png`) });
    await page.waitForTimeout(1500);
  }
  writeFileSync(join(OUT, 'cold-window.txt'), report.join('\n'), 'utf8');
  await browser.close();
  process.exit(0);
}

/* --------------------- reproduce the f295 composition ---------------------- */

if (F295) {
  say('');
  say('## the f295 composition, photographed through a cold start');
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready();
  await mark('f295');
  // Frame floors 3 (four books), 4 (one thin book) and 5 (twenty).
  await setCam(0.78, 960);
  const shots = [];
  for (const at of [250, 500, 800, 1200, 1700, 2400, 4000]) {
    await page.waitForTimeout(at - (shots.at(-1) ?? 0));
    shots.push(at);
    await setCam(0.78, 960);
    const state = await page.evaluate(() => {
      const w = globalThis.__shelfWorld;
      const out = [];
      for (const [index, fv] of w.floors) {
        const stored = w.store.get(index);
        out.push({
          floor: index,
          holds: stored === undefined ? null : stored.length,
          sprites: fv.visuals.length,
          placeholders: fv.visuals.filter((v) => v.sprite.texture.label === 'WHITE').length,
        });
      }
      return out.sort((a, b) => a.floor - b.floor);
    });
    await page.screenshot({ path: join(OUT, `f295-repro-${at}ms.png`) });
    say(`  ${String(at).padStart(4)}ms  ${state.map((s) => `floor ${s.floor}: ${s.sprites}/${s.holds ?? '?'} drawn, ${s.placeholders} featureless`).join(' | ')}`);
  }
  writeFileSync(join(OUT, 'f295-repro.txt'), report.join('\n'), 'utf8');
  await browser.close();
  process.exit(0);
}

/* ------------- store vs layout vs pixels, for every mounted book ----------- */

if (STORE) {
  say('');
  say('## store thickness vs laid-out width vs drawn width');
  const rows = [];
  for (const [z, y] of [[1.2, -40], [0.8, 320], [0.8, 900], [0.5, 900], [0.3, 400]]) {
    await setCam(z, y);
    await page.waitForTimeout(1500);
    const got = await page.evaluate(() => {
      const w = globalThis.__shelfWorld;
      const out = [];
      for (const [index, fv] of w.floors) {
        for (const v of fv.visuals) {
          const style = globalThis.__shelfBookStyle(v.book.id);
          const s = v.sprite;
          out.push({
            floor: index,
            title: v.book.title,
            // The store's own number, clamped the way `spineArtWidth` clamps
            // it (whole world px, inside the legal spine range).
            stored: Math.min(58, Math.max(8, Math.round(style.thickness))),
            raw: Number(style.thickness.toFixed(2)),
            laid: Number(v.w.toFixed(2)),
            drawn: Number((Math.abs(s.scale.x) * s.texture.orig.width).toFixed(2)),
            zoom: Number(w.camera.zoom.toFixed(2)),
          });
        }
      }
      return out;
    });
    rows.push(...got);
  }
  const bad = rows.filter((r) => Math.abs(r.stored - r.laid) > 0.01 || Math.abs(r.laid - r.drawn) > 0.01);
  const thin = rows.slice().sort((a, b) => a.drawn - b.drawn).slice(0, 8);
  say(`  books measured (across 5 camera stops): ${rows.length}`);
  say(`  disagreements between store, layout and pixels: ${bad.length}`);
  for (const b of bad.slice(0, 15)) say(`    ${JSON.stringify(b)}`);
  say('  the eight thinnest books on the shelf:');
  for (const t of thin) {
    say(
      `    "${t.title}" floor ${t.floor}: store ${t.raw} → laid ${t.laid} → drawn ${t.drawn} world px` +
        ` (${(t.drawn * t.zoom).toFixed(1)} screen px at ${t.zoom}×)`,
    );
  }
  writeFileSync(join(OUT, 'store-vs-pixels.json'), JSON.stringify(rows, null, 2), 'utf8');
  writeFileSync(join(OUT, 'store-vs-pixels.txt'), report.join('\n'), 'utf8');
  await browser.close();
  process.exit(0);
}

/* ---------------- A/B — which half of a room drops the art? ---------------- */

if (AB) {
  say('');
  say('## A/B — colour-only vs carpentry-only room changes');
  await setCam(0.8, 100);
  await page.waitForTimeout(2500);
  await bank('ab settle');

  const round = async (label, patch) => {
    await mark(label);
    if (patch.theme !== undefined) {
      // The colour half lives in LibraryPrefs, not in RoomDesign.
      await page.evaluate((t) => globalThis.__libraryPrefs.save({ theme: t }), patch.theme);
    } else {
      await page.evaluate((d) => globalThis.__shelfSaveDesign(d), patch);
    }
    await page.waitForTimeout(2500);
    const d = await bank(label);
    const ms = d.spells.map((x) => x.ms).sort((a, b) => a - b);
    say(
      `  ${label.padEnd(22)} placeholder flashes ${String(ms.length).padStart(3)}` +
        ` (min ${ms[0] ?? '-'}ms max ${ms[ms.length - 1] ?? '-'}ms)` +
        `  relapses ${d.relapses.length}`,
    );
    return d;
  };

  // Colour only: same carpentry, same wall, a different scheme. `setTheme`
  // retires every spine and the books keep wearing the old art until each
  // replacement lands — so this should flash nothing.
  await round('colour only A', { theme: 'lapis' });
  await round('colour only B', { theme: 'garnet' });
  // Carpentry only: same colours, a different build. `setBuild` drops the
  // bakes of every book whose bay changed shape.
  await round('carpentry only A', { build: 'gothic-arcade' });
  await round('carpentry only B', { build: 'plank' });
  // Wallpaper only: touches neither, and is the control.
  await round('wallpaper only', {
    wallpaper: { pattern: 'trellis', scale: 'medium', depth: 'flat', ink: 'ink' },
  });

  writeFileSync(join(OUT, 'ab.json'), JSON.stringify(banked, null, 2), 'utf8');
  writeFileSync(join(OUT, 'ab.txt'), report.join('\n'), 'utf8');
  console.log(`\nwrote ${join(OUT, 'ab.txt')}`);
  await browser.close();
  process.exit(0);
}

/* --------------------------- phase 1 — cold start -------------------------- */
//
// The f295 moment. A reload with a stocked library: floors mount before their
// data exists, spines mount before their bakes exist.

say('');
say('## phase 1 — cold start (reload with a stocked library)');
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await ready();
await mark('cold');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, 'cold-1200ms.png') });
await page.waitForTimeout(5000);
await page.screenshot({ path: join(OUT, 'cold-settled.png') });
const cold = await bank('cold start');
summarise('cold start', cold);
say(`  per-floor mount timings: ${JSON.stringify(cold.mounts)}`);

/* -------------------------- phase 2 — static sweep ------------------------- */

say('');
say('## phase 2 — static sweep across both LOD boundaries');
const ZOOMS = [1.6, 1.0, 0.78, 0.73, 0.7, 0.68, 0.5, 0.3, 0.25, 0.22, 0.19, 0.12];
const CAM_YS = [-40, 640, 1400];
const stops = [];
for (const z of ZOOMS) {
  for (const y of CAM_YS) {
    await mark(`static z=${z} y=${y}`);
    await setCam(z, y);
    await page.waitForTimeout(900);
    const a = await audit();
    stops.push(a);
    const all = a.floors.flatMap((f) => f.widths.map((b) => ({ ...b, floor: f.index })));
    const worst = all.slice().sort((x, y2) => x.drawn / x.expected - y2.drawn / y2.expected)[0];
    const thinnest = all.slice().sort((x, y2) => x.drawn - y2.drawn)[0];
    say(
      `  z=${String(z).padEnd(5)} y=${String(y).padEnd(5)} tier=${a.tier} ` +
        `floors=${a.floors
          .map((f) => `${f.index}:${f.sprites}/${f.stored ?? '?'}${f.placeholders > 0 ? `(ph${f.placeholders})` : ''}`)
          .join(' ')}` +
        (worst ? ` | worst ratio ${(worst.drawn / worst.expected).toFixed(3)}` : '') +
        (thinnest
          ? ` | thinnest book ${thinnest.drawn}px world = ${(thinnest.drawn * a.zoom).toFixed(1)}px screen ("${thinnest.title}", floor ${thinnest.floor})`
          : ' | no books mounted'),
    );
  }
}
summarise('static sweep', await bank('static sweep'));

await setCam(0.8, 320);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'shelf-z080.png') });
await setCam(0.5, 320);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'shelf-z050-tier1.png') });
await setCam(0.19, 200);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'shelf-z019.png') });

/* ------------------------ phase 3 — live wheel zoom ------------------------ */

say('');
say('## phase 3 — live wheel zoom through both boundaries');
await setCam(1.4, 200);
await page.waitForTimeout(1200);
await mark('wheel out');
await page.mouse.move(760, 450);
for (let i = 0; i < 40; i++) {
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, 'wheel-out-end.png') });
await mark('wheel in');
for (let i = 0; i < 40; i++) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(1500);
summarise('wheel zoom', await bank('wheel zoom'));

/* ---------------------------- phase 4 — panning ---------------------------- */

say('');
say('## phase 4 — panning floors in and out of the window');
await mark('pan');
await setCam(0.9, -40);
await page.waitForTimeout(1500);
for (let i = 0; i < 16; i++) {
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 240);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(180);
}
await page.waitForTimeout(1500);
for (let i = 0; i < 16; i++) {
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(180);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'after-pan.png') });
summarise('pan', await bank('pan'));

/* ------------------------ phase 5 — bookcase switch ------------------------ */

say('');
say('## phase 5 — a second bookcase, and switching between them');
await mark('case 2');
await ready();
const cases = await page.evaluate(async () => {
  const b = globalThis.__shelfBookcases;
  const before = b.active();
  const made = await b.create('Sliver probe case');
  const id = made?.id ?? made;
  await b.switch(id);
  return { first: before?.id ?? before, second: id };
});
await page.waitForTimeout(2500);
await ready();
await page.evaluate(async (titles) => {
  await globalThis.__shelfSeedBooks(titles.slice(0, 14), 0);
  await globalThis.__shelfSeedBooks(titles.slice(0, 7), 1);
  await globalThis.__shelfSeedBooks(['One'], 2);
}, TITLES);
await page.waitForTimeout(3500);
await setCam(0.8, -40);
await page.waitForTimeout(2000);
const case2 = await audit();
say(`  second case: ${case2.floors.map((f) => `${f.index}:${f.sprites}/${f.stored ?? '?'}`).join(' ')}`);
for (const f of case2.floors.filter((x) => x.sprites > 0)) {
  for (const b of f.widths) {
    say(
      `    floor ${f.index} "${b.title}" expected ${b.expected}px drawn ${b.drawn}px` +
        ` h ${b.height} centerX ${b.centerX}${b.placeholder ? ' PLACEHOLDER' : ''}`,
    );
  }
}
await page.screenshot({ path: join(OUT, 'case2.png') });
// The one-book floor at several zooms — the f295 signature, photographed.
for (const z of [1.2, 0.8, 0.5, 0.3]) {
  await setCam(z, 640);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: join(OUT, `onebook-z${String(z).replace('.', '')}.png`) });
}
await mark('case switch');
for (let i = 0; i < 3; i++) {
  await page.evaluate((id) => globalThis.__shelfBookcases.switch(id), cases.first);
  await page.waitForTimeout(1800);
  await page.evaluate((id) => globalThis.__shelfBookcases.switch(id), cases.second);
  await page.waitForTimeout(1800);
}
await page.waitForTimeout(1500);
summarise('bookcase switch', await bank('bookcase switch'));

/* ------------------- phase 6 — room swap (spine retirement) ---------------- */

say('');
say('## phase 6 — room preset applies (every baked spine retired at once)');
await page.evaluate((id) => globalThis.__shelfBookcases.switch(id), cases.first);
await page.waitForTimeout(2500);
await setCam(0.8, 100);
await page.waitForTimeout(1500);
await mark('room swap');
for (const design of [
  { build: 'gothic-arcade', pattern: 'quarter-sawn', wallpaper: { pattern: 'trellis', scale: 'medium', depth: 'flat', ink: 'ink' } },
  { build: 'pigeonhole', pattern: 'none', wallpaper: { pattern: 'plain', scale: 'medium', depth: 'flat', ink: 'paper' } },
  { build: 'plank', pattern: 'plain-sawn', wallpaper: { pattern: 'plain', scale: 'medium', depth: 'flat', ink: 'paper' } },
]) {
  await page.evaluate((d) => globalThis.__shelfSaveDesign(d), design);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `room-${design.build}-400ms.png`) });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, `room-${design.build}-settled.png`) });
}
summarise('room swap', await bank('room swap'));

/* ------------------------------- sabotage ---------------------------------- */

let sabotage = null;
if (SABOTAGE) {
  say('');
  say('## sabotage — break it on purpose and watch the gates go red');
  await setCam(0.8, 100);
  await page.waitForTimeout(1500);
  await bank('pre-sabotage');
  await mark('sabotage');
  await page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const floors = [...w.floors.entries()].filter(([, fv]) => fv.visuals.length > 2);
    // 1) one book narrowed to a hairline, the way a stale scale would leave it
    const [, fvA] = floors[0];
    fvA.visuals[1].sprite.scale.x *= 0.05;
    // 2) another floor loses half its sprites without the store changing
    const [, fvB] = floors[1] ?? floors[0];
    const half = Math.floor(fvB.visuals.length / 2);
    for (let i = 0; i < half; i++) {
      const v = fvB.visuals.pop();
      v.sprite.visible = false;
    }
    w.dirty = true;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'sabotaged.png') });
  sabotage = await bank('sabotage');
  const narrowFired = sabotage.worstNarrow !== null && sabotage.worstNarrow.ratio < 0.5;
  const shortFired = sabotage.shortfalls.length > 0;
  say(`  narrowest under sabotage: ${JSON.stringify(sabotage.worstNarrow)}`);
  say(`  shortfall frames under sabotage: ${sabotage.shortfalls.length}`);
  say(`  WIDTH GATE ${narrowFired ? 'ALIVE' : 'INERT'}`);
  say(`  POPULATION GATE ${shortFired ? 'ALIVE' : 'INERT'}`);
}

/* -------------------------------- verdicts --------------------------------- */

const real = banked.filter((b) => b.phase !== 'sabotage' && b.phase !== 'pre-sabotage');
const allSpells = real.flatMap((b) => b.spells);
const ms = allSpells.map((s) => s.ms).sort((a, b) => a - b);
const pct = (p) => (ms.length === 0 ? null : ms[Math.floor((ms.length - 1) * p)]);
const worst = real
  .map((b) => b.worstNarrow)
  .filter((x) => x !== null && x !== undefined)
  .sort((a, b) => a.ratio - b.ratio)[0];
const shortfalls = real.flatMap((b) => b.shortfalls);
const overhangs = real.flatMap((b) => b.overhangs);
const relapses = real.flatMap((b) => b.relapses);

say('');
say('## verdicts');
say(`frames sampled: ${real.reduce((a, b) => a + b.frames, 0)}`);
say(`1. narrowest drawn/expected width ratio: ${worst ? worst.ratio : 'n/a'} — ${JSON.stringify(worst)}`);
say(`   thinnest legitimate book seen: see the static sweep's "thinnest book" column`);
say(`2. frames where a floor drew fewer sprites than the store holds: ${shortfalls.length}`);
for (const s of shortfalls.slice(0, 10)) say(`     ${JSON.stringify(s)}`);
say(`   books overhanging a rail (drawn partly behind the case frame): ${overhangs.length}`);
for (const o of overhangs.slice(0, 10)) say(`     ${JSON.stringify(o)}`);
say(`3. placeholder spells: ${ms.length}  p50 ${pct(0.5)}ms  p90 ${pct(0.9)}ms  max ${pct(1)}ms`);
const worstSpell = allSpells.slice().sort((a, b) => b.ms - a.ms).slice(0, 8);
for (const w2 of worstSpell) say(`     ${JSON.stringify(w2)}`);
say(`   textured -> placeholder relapses: ${relapses.length}`);
for (const r of relapses.slice(0, 8)) say(`     ${JSON.stringify(r)}`);
say(`page errors: ${errors.size === 0 ? 'none' : JSON.stringify([...errors])}`);

writeFileSync(join(OUT, 'report.txt'), report.join('\n'), 'utf8');
writeFileSync(
  join(OUT, 'sliver.json'),
  JSON.stringify({ banked, stops, case2, sabotage }, null, 2),
  'utf8',
);
console.log(`\nwrote ${join(OUT, 'report.txt')} and ${join(OUT, 'sliver.json')}`);

await browser.close();
