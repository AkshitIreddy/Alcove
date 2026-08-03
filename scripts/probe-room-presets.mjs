/**
 * scripts/probe-room-presets.mjs — the whole-room presets, looked at.
 *
 * Two modes, and the first one is how the shipped table was written:
 *
 *   --mode=roll   steer the dice with `withMood` (one mood word per axis, per
 *                 classification), roll N candidates, and draw them. The
 *                 tuples go to stdout in the same order the sheet draws them,
 *                 so a card that looks good can be read off and kept.
 *   --mode=table  draw `ROOM_PRESETS` as it stands, grouped, at the size the
 *                 picker actually uses. Re-run this after any edit to it.
 *   --mode=apply  the seam. Open the studio by clicking the dock, pick a
 *                 preset by clicking its card, and assert on what the WORLD
 *                 ended up holding (`__shelfDesign()`) — the carpentry, the
 *                 wall AND the colours. A preset that saves correctly and
 *                 leaves the shelf alone is the exact bug being fixed here,
 *                 and it looks identical to success from the store's side.
 *
 * Every card goes through `drawRoomCard`, the function the studio's strip and
 * sheet call — a board drawn any other way proves nothing about what the
 * reader will see.
 *
 * The sheets are composited into ONE canvas per slice and pulled out as a data
 * URL rather than screenshotted. `page.screenshot` hangs for minutes here: the
 * shelf's WebGL canvas is still in the page and SwiftShader is asked to
 * composite it for every capture.
 *
 * Usage: node scripts/probe-room-presets.mjs [--mode=table] [--url=…]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const MODE = opt('mode', 'table');
const PER = Number(opt('per', '8'));
const SEED = Number(opt('seed', '7'));
const DIR = opt('dir', 'qa/ui');

mkdirSync(DIR, { recursive: true });

/**
 * One steer per classification, per axis.
 *
 * `withMood` takes a single word and degrades to the whole vocabulary when
 * nothing on that axis carries it, so a class can name the word each
 * vocabulary actually uses rather than hoping one word spans all four.
 */
const CLASSES = [
  ['Formal', { theme: 'formal', build: 'formal', pattern: 'classical', paper: 'formal' }],
  ['Grand', { theme: 'grand', build: 'ornate', pattern: 'grand', paper: 'gilded' }],
  ['Antique', { theme: 'dark', build: 'antique', pattern: 'gothic', paper: 'antique' }],
  ['Quiet', { theme: 'quiet', build: 'plain', pattern: 'fine', paper: 'quiet' }],
  ['Cosy', { theme: 'cosy', build: 'cosy', pattern: 'cottage', paper: 'cosy' }],
  ['Botanical', { theme: 'botanical', build: 'airy', pattern: 'carved', paper: 'fresh' }],
  ['Coastal', { theme: 'coastal', build: 'rustic', pattern: 'nautical', paper: 'cool' }],
  ['Storybook', { theme: 'storybook', build: 'whimsical', pattern: 'folk', paper: 'playful' }],
  ['Rustic', { theme: 'natural', build: 'rustic', pattern: 'plain', paper: 'warm' }],
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: MODE === 'apply' ? { width: 1440, height: 900 } : { width: 1000, height: 800 },
});
page.setDefaultTimeout(120000);
const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
  console.log('[pageerror]', k);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
    console.log('[err]', m.text());
  }
});

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });

if (MODE === 'apply') {
  await applyProbe();
  console.log('\n=== page errors ===');
  if (errors.size === 0) console.log('none');
  else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);
  await browser.close();
  process.exit(errors.size === 0 ? 0 : 1);
}

/**
 * Drive the panel the way a reader does, and check the WORLD, not the store.
 *
 * Every assertion below reads `__shelfDesign()`, which reports what
 * `EnvTextures` and the backdrop are actually holding. The colours are checked
 * through `libraryKey`, which starts with the room's id (`libraryKey.ts`), so
 * "the case was repainted" is a real observation rather than a re-read of the
 * preference that asked for it.
 */
async function applyProbe() {
  const poll = async (fn, arg, timeout = 45000, label = 'condition') => {
    const t0 = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg);
      if (v) return v;
      if (Date.now() - t0 > timeout) {
        const now = await page.evaluate(() => globalThis.__shelfDesign());
        throw new Error(`timed out waiting for ${label}; world holds ${JSON.stringify(now)}`);
      }
      await page.waitForTimeout(250);
    }
  };
  const wantOf = (id) =>
    page.evaluate(async (presetId) => {
      const o = await import('/src/views/rail/designOptions.ts');
      const p = o.ROOM_PRESETS.find((x) => x.id === presetId);
      return p === undefined
        ? null
        : {
            id: p.id,
            name: p.name,
            shelf: `${p.build}.${p.pattern}`,
            paper: p.wallpaper.pattern,
            theme: p.theme,
          };
    }, id);

  await page.evaluate(() => localStorage.clear());
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await poll(() => globalThis.__shelfDesign !== undefined, null, 120000, 'design bridge');
  await poll(
    () => document.querySelector('.shelf-a11y button') !== null,
    null,
    120000,
    'a11y mirror',
  );
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click();
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice', 'Watercolor Basics'], 0),
  );
  await page.waitForTimeout(1600);

  const before = await page.evaluate(() => globalThis.__shelfDesign());
  console.log('\n0. the house room');
  console.log('  ', JSON.stringify({ shelf: before.shelf, paper: before.design.wallpaper.pattern }));

  /**
   * Get to the studio's own sheet, whatever is currently up.
   *
   * Not "click the dock button": that TOGGLES, so pressing it when the panel
   * is already open closes it, and Escape's meaning depends on whether a long
   * sheet is showing (it means "back" there, not "close"). Asking what is on
   * screen first is the difference between a probe that passes on timing and
   * one that passes on behaviour.
   */
  const showing = (sel) =>
    page
      .locator(sel)
      .first()
      .isVisible()
      .catch(() => false);

  async function backToStudio() {
    if (await showing('.nb-pick-back')) {
      await page.locator('.nb-pick-back').first().click();
      await page.waitForTimeout(600);
    }
  }
  async function openStudio() {
    // Checked by VISIBILITY, never by attachment: the rail leaves the studio's
    // markup in the document when it is closed (its canvases sit there at
    // `visibility: hidden`), so `count() === 0` reads as "already open" and the
    // dock click then toggles it shut. That cost twenty minutes; the strip
    // resolved for twenty seconds and was hidden every time.
    for (let i = 0; i < 4; i += 1) {
      if (await showing('[aria-label="Room presets"]')) break;
      if (await showing('.nb-pick-back')) await backToStudio();
      else await page.getByRole('button', { name: /studio/i }).first().click();
      await page.waitForTimeout(1200);
    }
    await page
      .locator('[aria-label="Room presets"]')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(700);
  }

  console.log('\n1. open the studio from the dock');
  await openStudio();

  const strip = page.locator('[aria-label="Room presets"]');
  await strip.waitFor({ timeout: 20000 });
  console.log('  preset strip tiles:', await strip.locator('button.nb-strip-tile').count());
  await page.screenshot({ path: `${DIR}/preset-01-panel.png` });
  console.log(`  shot ${DIR}/preset-01-panel.png`);

  /* -- 2. through the long sheet ------------------------------------------ */

  console.log('\n2. browse all of them and pick one');
  await strip.locator('button.nb-strip-more').click();
  await page.waitForSelector('.nb-pick', { timeout: 20000 });
  await page.waitForTimeout(900);
  console.log('  sheet title:', (await page.locator('.nb-pick-title').textContent())?.trim());
  console.log('  groups:', await page.locator('.nb-pick-group').allTextContents());
  await page.screenshot({ path: `${DIR}/preset-02-sheet.png` });
  console.log(`  shot ${DIR}/preset-02-sheet.png`);

  const want = await wantOf('grand.gilt-salon');
  const card = page.locator('button.nb-pick-card', { hasText: want.name });
  await card.first().scrollIntoViewIfNeeded();
  await card.first().click();
  console.log(`  clicked "${want.name}" — wants ${want.shelf} / ${want.paper} / ${want.theme}`);

  const got = await poll(
    (w) => {
      const d = globalThis.__shelfDesign();
      return d.shelf === w.shelf &&
        d.wallpaperKey.includes(w.paper) &&
        d.libraryKey.includes(w.theme)
        ? d
        : null;
    },
    want,
    45000,
    'the preset to reach the case, the wall AND the colours',
  );
  console.log('  applied:', JSON.stringify({ shelf: got.shelf, key: got.libraryKey.slice(0, 40) }));
  if (got.shelf === before.shelf) throw new Error('the carpentry did not move');
  if (got.wallpaperKey === before.wallpaperKey) throw new Error('the wall did not move');
  if (got.libraryKey === before.libraryKey) throw new Error('the colours did not move');

  // With the sheet still up first: the world is visible beside it, and a
  // headless SwiftShader capture of the bare canvas comes back blank often
  // enough that it cannot be the only evidence. Then again with it closed.
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${DIR}/preset-03-applied.png` });
  console.log(`  shot ${DIR}/preset-03-applied.png`);
  await backToStudio();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${DIR}/preset-03b-shelf.png` });
  console.log(`  shot ${DIR}/preset-03b-shelf.png`);

  /* -- 3. and straight off the inline strip -------------------------------- */

  console.log('\n3. a second preset, off the inline strip this time');
  await openStudio();
  const want2 = await wantOf('formal.card-room');
  // No `scrollIntoViewIfNeeded` first: the strip re-renders on every design
  // change, and a handle resolved before that detaches. `click` re-resolves.
  await page
    .locator('[aria-label="Room presets"] button.nb-strip-tile', { hasText: want2.name })
    .first()
    .click({ timeout: 30000 });
  console.log(`  clicked "${want2.name}" — wants ${want2.shelf} / ${want2.paper} / ${want2.theme}`);
  const got2 = await poll(
    (w) => {
      const d = globalThis.__shelfDesign();
      return d.shelf === w.shelf &&
        d.wallpaperKey.includes(w.paper) &&
        d.libraryKey.includes(w.theme)
        ? d
        : null;
    },
    want2,
    45000,
    'the second preset to land',
  );
  console.log('  applied:', JSON.stringify({ shelf: got2.shelf }));

  /* -- 4. the panel says which room you are in ----------------------------- */

  const heading = await page
    .locator('.nb-panel-section-title', { hasText: 'presets' })
    .first()
    .textContent();
  console.log('\n4. panel heading:', JSON.stringify(heading?.trim()));
  if (!heading?.toLowerCase().includes(want2.name.toLowerCase())) {
    throw new Error(`the panel does not name the preset it is wearing: ${heading ?? ''}`);
  }

  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${DIR}/preset-04-second.png` });
  console.log(`  shot ${DIR}/preset-04-second.png`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${DIR}/preset-04b-shelf.png` });
  console.log(`  shot ${DIR}/preset-04b-shelf.png`);
}

const result = await page.evaluate(
  async ({ mode, per, seed, classes }) => {
    const opts = await import('/src/views/rail/designOptions.ts');
    const shelf = await import('/src/art/shelfDesign.ts');
    const themes = await import('/src/art/themes.ts');
    const paper = await import('/src/art/wallpaperDesign.ts');

    /** Deterministic 32-bit PRNG, so a board can be re-rolled identically. */
    const rng = (s) => () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const log = [];
    const CARD_W = 148;
    const CARD_H = 102;
    const GAP = 8;
    const CAP = 17;
    const HEAD = 22;
    const DPR = 2;

    /** Build the sheet as data: one section per class, cards in a row. */
    const sections = [];
    if (mode === 'roll') {
      let n = 0;
      for (const [name, steer] of classes) {
        const pick = rng(seed * 977 + name.length * 31 + n * 13);
        const rooms = opts.withMood(themes.THEME_IDS, steer.theme, (id) => themes.THEMES[id]);
        const builds = opts.withMood(shelf.BUILD_IDS, steer.build, (id) => shelf.BUILDS[id]);
        const pats = opts.withMood(shelf.PATTERN_IDS, steer.pattern, (id) => shelf.PATTERNS[id]);
        const papers = opts.withMood(paper.WALLPAPER_PRESETS, steer.paper, (p) => p);
        const one = (list) => list[Math.floor(pick() * list.length) % list.length];
        const cards = [];
        for (let i = 0; i < per; i += 1) {
          const p = one(papers);
          const look = {
            theme: one(rooms),
            build: one(builds),
            pattern: one(pats),
            wallpaper: p.spec,
          };
          const label = `${name.slice(0, 3).toUpperCase()}-${String(i).padStart(2, '0')}`;
          log.push(`${label}  ${look.theme} / ${look.build} / ${look.pattern} / ${p.id}`);
          cards.push({ look, label });
          n += 1;
        }
        sections.push({ title: name, cards });
      }
    } else {
      const byGroup = new Map();
      for (const p of opts.ROOM_PRESETS) {
        const list = byGroup.get(p.group) ?? [];
        list.push(p);
        byGroup.set(p.group, list);
      }
      for (const [name, list] of byGroup) {
        const cards = list.map((p) => {
          log.push(`${p.id}  ${p.theme} / ${p.build} / ${p.pattern} / ${p.paper}`);
          return { look: p, label: p.name };
        });
        sections.push({ title: `${name} (${list.length})`, cards });
      }
    }

    // Three slices, so detail survives being looked at.
    const perSlice = Math.ceil(sections.length / 3);
    const urls = [];
    for (let s = 0; s < 3; s += 1) {
      const mine = sections.slice(s * perSlice, (s + 1) * perSlice);
      if (mine.length === 0) continue;
      const cols = Math.max(...mine.map((sec) => sec.cards.length));
      const w = GAP + cols * (CARD_W + GAP);
      const h = GAP + mine.length * (HEAD + CARD_H + CAP + GAP);
      const sheet = document.createElement('canvas');
      sheet.width = w * DPR;
      sheet.height = h * DPR;
      const ctx = sheet.getContext('2d');
      ctx.scale(DPR, DPR);
      ctx.fillStyle = '#efe9dc';
      ctx.fillRect(0, 0, w, h);

      let y = GAP;
      for (const sec of mine) {
        ctx.fillStyle = '#3a2a1c';
        ctx.font = '700 14px "Nunito Sans", system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(sec.title, GAP, y);
        y += HEAD;
        let x = GAP;
        for (const card of sec.cards) {
          ctx.save();
          ctx.translate(x, y);
          ctx.beginPath();
          ctx.rect(0, 0, CARD_W, CARD_H);
          ctx.clip();
          try {
            opts.drawRoomCard(ctx, CARD_W, CARD_H, card.look);
          } catch (e) {
            log.push(`DRAW FAILED ${card.label}: ${String(e && e.message)}`);
          }
          ctx.restore();
          ctx.fillStyle = '#3a2a1c';
          ctx.font = '600 11px "Nunito Sans", system-ui, sans-serif';
          ctx.fillText(card.label, x, y + CARD_H + 3);
          x += CARD_W + GAP;
        }
        y += CARD_H + CAP + GAP;
      }
      urls.push(sheet.toDataURL('image/png'));
    }
    return { log, urls };
  },
  { mode: MODE, per: PER, seed: SEED, classes: CLASSES },
);

console.log(result.log.join('\n'));
result.urls.forEach((url, i) => {
  const path = `${DIR}/room-presets-${MODE}-${i + 1}.png`;
  writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`shot ${path}`);
});

await browser.close();
