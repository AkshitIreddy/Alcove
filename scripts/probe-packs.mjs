/**
 * scripts/probe-packs.mjs — the reader's own packs, driven the way a reader
 * drives them.
 *
 * A unit test can prove the validator refuses a bad file and that the prompt
 * agrees with it. Neither says the reader can REACH any of it, and CLAUDE.md
 * is blunt about that gap: "a specimen board proves a module draws well in
 * isolation and says nothing about whether the app can reach it".
 *
 * So this one only clicks. Open the studio, press "+ add your own" in the
 * wallpaper row, paste a pack into the popup, import it, close, press one of
 * the resulting tiles, and check the WALL — through `__shelfDesign()`, the
 * applied state, never what was merely saved.
 *
 * The paste box is why this is possible at all: the file button opens an OS
 * dialog no browser automation can answer, so the popup carries a second route
 * in that ends in the same validator.
 *
 * Usage: node scripts/probe-packs.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/packs', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1500, height: 940 },
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

/*
 * Poll, and survive the page reloading underneath.
 *
 * Not defensive programming for its own sake: this probe runs against the ONE
 * dev server the whole workspace shares, and any save anywhere in src/ sends a
 * full reload through it mid-run. `page.evaluate` then throws "Execution
 * context was destroyed", which reads like a product failure and is not one.
 * The condition is re-asked; only the timeout ends the loop.
 */
const poll = async (fn, arg, timeout = 60000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await page.evaluate(fn, arg);
      if (v) return v;
    } catch (error) {
      if (!/Execution context was destroyed|Target closed/.test(String(error))) throw error;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

const shot = async (name) => {
  await page.screenshot({ path: `qa/packs/${name}.png` });
  console.log(`  shot qa/packs/${name}.png`);
};

/**
 * Put the studio sheet back if a reload took it. Same reason as the poll's
 * catch above: a save anywhere in the tree closes the panel out from under the
 * next click, and a probe that reports that as a failure is a probe nobody
 * trusts. Packs live in SQLite, so what was imported is still imported.
 */
const ensureStudioOpen = async () => {
  const open = await page
    .evaluate(() => {
      const el = document.querySelector('.nb-library-studio');
      return el !== null && el.getBoundingClientRect().height > 0;
    })
    .catch(() => false);
  if (open) return;
  console.log('  (the panel was closed by a reload — opening it again)');
  await poll(() => document.querySelector('.shelf-a11y button') !== null, null, 120000, 'a11y');
  await page.getByRole('button', { name: /studio/i }).first().click();
  await page.waitForSelector('.nb-library-studio', { timeout: 30000 });
  await page.waitForTimeout(1200);
};

const GOOD_PACK = JSON.stringify({
  alcovePack: 1,
  category: 'wallpaper',
  name: 'Ferns and Fog',
  author: 'a probe',
  items: [
    { name: 'Fern Study', blurb: 'a botanist’s wall', pattern: 'fern', scale: 'small', depth: 'low', ink: 'timber', tone: 'moss', edge: 'soft' },
    { name: 'Long Gallery', blurb: 'plaster trellis', pattern: 'trellis', scale: 'grand', depth: 'carved', ink: 'paper' },
    { name: 'Hare and Thorn', pattern: 'hare', scale: 'medium', depth: 'flat', ink: 'cloth', tone: 'sepia' },
  ],
});

const STICKER_PACK = JSON.stringify({
  alcovePack: 1,
  category: 'sticker',
  name: 'Two Small Things',
  items: [
    {
      name: 'acorn',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M18 26c4-9 24-9 28 0 1 3-2 4-14 4s-15-1-14-4z" fill="#b7823f" stroke="#3a2a1d" stroke-width="3" stroke-linejoin="round"/><path d="M20 30c1 14 7 22 12 22s11-8 12-22c-6 2-18 2-24 0z" fill="#e8b567" stroke="#3a2a1d" stroke-width="3" stroke-linejoin="round"/></svg>',
    },
    {
      name: 'ink-pot',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M16 30c10-3 22-3 32 0 1 9 0 17-2 22-9 2-19 2-28 0-2-5-3-13-2-22z" fill="#3f5d72" stroke="#22303a" stroke-width="3" stroke-linejoin="round"/></svg>',
    },
  ],
});

const CASE_PACK = JSON.stringify({
  alcovePack: 1,
  category: 'carpentry',
  name: 'Two Rooms',
  items: [
    { name: 'Vestry Reeded', blurb: 'chapel joinery', build: 'vestry', pattern: 'reeded' },
    { name: 'Counting Bench', build: 'workbench', pattern: 'cockBead' },
  ],
});

const BAD_PACK = JSON.stringify({
  alcovePack: 1,
  category: 'wallpaper',
  name: 'Wrong in Four Ways',
  items: [
    { name: 'Nearly', pattern: 'ferns', scale: 'small', depth: 'low', ink: 'timber' },
    { name: 'Bad Key', pattern: 'fern', scale: 'small', depth: 'low', ink: 'timber', colour: 'moss' },
    { name: 'Missing', scale: 'small', depth: 'low', ink: 'timber' },
  ],
});

/* -- boot ------------------------------------------------------------------ */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, null, 120000, 'design bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, null, 120000, 'a11y');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);
await page.evaluate(() => globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice'], 0));
await page.waitForTimeout(1500);

/* 1 — the studio, and an empty "yours" row -------------------------------- */

console.log('\n1. the wallpaper row offers "add your own"');
await page.getByRole('button', { name: /studio/i }).first().click();
await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
await page.waitForTimeout(1200);
const yours = page.locator('[data-your-designs="wallpaper"]');
await yours.waitFor({ timeout: 20000 });
await yours.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
console.log('  empty copy:', JSON.stringify((await yours.textContent())?.trim().slice(0, 140)));
await shot('01-yours-empty');

/* 2 — the popup ----------------------------------------------------------- */

console.log('\n2. press it, and read the popup');
await yours.getByRole('button', { name: /add your own/i }).click();
await page.waitForSelector('[data-nb-pack-dialog] [role="dialog"]', { timeout: 20000 });
await page.waitForTimeout(700);
console.log(
  '  parts present:',
  await page.evaluate(() => ({
    upload: document.querySelector('[data-pack-upload]')?.textContent?.trim() ?? null,
    paste: document.querySelector('[data-pack-paste]') !== null,
    howto: document.querySelectorAll('.nb-pack-howto li').length,
    copyPrompt: document.querySelector('[data-pack-copy-prompt]')?.textContent?.trim() ?? null,
    promptChars: document.querySelector('[data-pack-prompt]')?.textContent?.length ?? 0,
    notYet: document.querySelectorAll('.nb-pack-notyet dt').length,
    exit: (() => {
      const b = document.querySelector('.nb-pack-card .nb-ins-close');
      if (b === null) return null;
      const card = document.querySelector('.nb-pack-card').getBoundingClientRect();
      const r = b.getBoundingClientRect();
      return { fromLeft: Math.round(r.left - card.left), fromTop: Math.round(r.top - card.top) };
    })(),
  })),
);
await shot('02-dialog-wallpaper');

/* 3 — a bad file is refused, in words ------------------------------------- */

console.log('\n3. paste a broken pack');
await page.locator('[data-pack-paste]').fill(BAD_PACK);
await page.locator('[data-pack-paste-go]').click();
await page.waitForSelector('[data-pack-refusal]', { timeout: 20000 });
await page.waitForTimeout(500);
console.log(
  '  problems shown:',
  await page.evaluate(() =>
    [...document.querySelectorAll('.nb-pack-problems li')].map((li) => li.textContent.trim()),
  ),
);
console.log(
  '  nothing imported:',
  await page.evaluate(() => globalThis.__nbPacks.list().length === 0),
);
await shot('03-refusal');

/* 4 — a good file lands ---------------------------------------------------- */

console.log('\n4. paste a good one');
await page.locator('[data-pack-paste]').fill(GOOD_PACK);
await page.locator('[data-pack-paste-go]').click();
await page.waitForSelector('[data-pack-done]', { timeout: 20000 });
await page.waitForTimeout(500);
console.log(
  '  said:',
  await page.evaluate(() =>
    [...document.querySelectorAll('.nb-pack-done-lines li')].map((li) => li.textContent.trim()),
  ),
);
console.log(
  '  registry:',
  await page.evaluate(() =>
    globalThis.__nbPacks.list().map((p) => `${p.name} (${p.category}, ${p.items.length})`),
  ),
);
await shot('04-imported');

/* 5 — the other categories say honest things ------------------------------ */

console.log('\n5. the sticker and sound tabs');
await page.locator('[data-pack-tab="sticker"]').click();
await page.waitForTimeout(600);
console.log('  sticker prompt chars:', await page.evaluate(() => document.querySelector('[data-pack-prompt]').textContent.length));
await shot('05-dialog-sticker');

// Stickers go through features/templates/userStickers.ts — the importer that
// already existed. This is the step that proves "folded in" rather than
// "reimplemented": the bytes end up in the asset store and the registry the
// catalogue reads, and only the FORMAT is new.
console.log('  paste a sticker pack');
await page.locator('[data-pack-paste]').fill(STICKER_PACK);
await page.locator('[data-pack-paste-go]').click();
await page.waitForSelector('[data-pack-done]', { timeout: 20000 });
await page.waitForTimeout(400);
console.log(
  '  said:',
  await page.evaluate(() =>
    [...document.querySelectorAll('.nb-pack-done-lines li')].map((li) => li.textContent.trim()),
  ),
);
await shot('05b-stickers-imported');

console.log('  paste a bookcase pack');
await page.locator('[data-pack-tab="carpentry"]').click();
await page.waitForTimeout(400);
await page.locator('[data-pack-paste]').fill(CASE_PACK);
await page.locator('[data-pack-paste-go]').click();
await page.waitForSelector('[data-pack-done]', { timeout: 20000 });
await page.waitForTimeout(400);
console.log(
  '  registry now:',
  await page.evaluate(() =>
    globalThis.__nbPacks.list().map((p) => `${p.name} (${p.category}, ${p.items.length})`),
  ),
);
await page.locator('[data-pack-tab="sticker"]').click();
await page.waitForTimeout(300);
await page.locator('[data-pack-tab="sound"]').click();
await page.waitForTimeout(600);
console.log(
  '  sound: paste box gone =',
  await page.evaluate(() => document.querySelector('[data-pack-paste]') === null),
  ', cue rows =',
  await page.evaluate(() => document.querySelectorAll('.nb-pack-fields dt').length),
);
await shot('06-dialog-sound');

/* 6 — close, and press one of the reader's own papers --------------------- */

console.log('\n6. close, then hang one of them');
// Escape must close the POPUP and leave the studio sheet behind it standing.
// It did not, once: RailPanel closes the sheet from a bubble-phase listener on
// window, so one press closed both and the reader was back on the shelf.
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
console.log(
  '  after Escape:',
  await page.evaluate(() => ({
    popup: document.querySelector('[data-nb-pack-dialog] [role="dialog"]') !== null,
    studio: document.querySelector('.nb-library-studio') !== null,
    studioVisible: (() => {
      const el = document.querySelector('.nb-library-studio');
      return el !== null && el.getBoundingClientRect().height > 0;
    })(),
  })),
);
await ensureStudioOpen();
await yours.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
const before = await page.evaluate(() => globalThis.__shelfDesign().design.wallpaper);
console.log('  wall before:', before.pattern, before.scale, before.ink, before.tone ?? 'auto');
await shot('07-yours-filled');

const tile = yours.locator('button.nb-strip-tile:not(.nb-strip-more)').first();
console.log('  clicking:', JSON.stringify((await tile.textContent())?.trim()));
await tile.click();
const after = await poll(
  (p) => {
    const w = globalThis.__shelfDesign().design.wallpaper;
    return w.pattern !== p ? w : null;
  },
  before.pattern,
  30000,
  'the reader’s paper to reach the wall',
);
console.log('  wall after :', after.pattern, after.scale, after.ink, after.tone ?? 'auto');
await page.waitForTimeout(1600);
await shot('08-applied-to-wall');

console.log('\n6b. and one of the reader’s own bookcases');
const yourCases = page.locator('[data-your-designs="carpentry"]');
await ensureStudioOpen();
await yourCases.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const caseBefore = await page.evaluate(() => globalThis.__shelfDesign().shelf);
const caseTile = yourCases.locator('button.nb-strip-tile:not(.nb-strip-more)').first();
console.log('  case before:', caseBefore, '— clicking', JSON.stringify((await caseTile.textContent())?.trim()));
await caseTile.click();
const caseAfter = await poll(
  (p) => {
    const s = globalThis.__shelfDesign().shelf;
    return s !== p ? s : null;
  },
  caseBefore,
  30000,
  'the reader’s carpentry to reach the case',
);
console.log('  case after :', caseAfter);
await page.waitForTimeout(1600);
await shot('08b-applied-to-case');

/* 7 — the studio's own tab ------------------------------------------------- */

console.log('\n7. the "your own" tab');
await ensureStudioOpen();
const ownTab = page.locator('[data-studio-tab="own"]');
await ownTab.click();
await page.waitForSelector('[data-packs-panel]', { timeout: 20000 });
await page.waitForTimeout(800);
console.log(
  '  rows:',
  await page.evaluate(() =>
    [...document.querySelectorAll('.nb-packs-row')].map((r) =>
      r.textContent.trim().replace(/\s+/g, ' '),
    ),
  ),
);
console.log(
  '  category cards:',
  await page.evaluate(() =>
    [...document.querySelectorAll('.nb-packs-card')].map((c) =>
      c.textContent.trim().replace(/\s+/g, ' '),
    ),
  ),
);
await shot('09-packs-panel');

/* 7b — forgetting takes two presses --------------------------------------- */

console.log('\n7b. forget asks once');
const forget = page.locator('.nb-packs-row .nb-packs-forget').last();
await forget.scrollIntoViewIfNeeded();
await forget.click();
await page.waitForTimeout(400);
console.log('  armed label:', (await forget.textContent())?.trim());
console.log('  still there:', await page.evaluate(() => globalThis.__nbPacks.list().length));
await shot('09b-forget-armed');
await forget.click();
await page.waitForTimeout(600);
console.log(
  '  after the second press:',
  await page.evaluate(() =>
    globalThis.__nbPacks.list().map((p) => `${p.name} (${p.category})`),
  ),
);

/* 8 — narrow window -------------------------------------------------------- */

console.log('\n8. narrow window');
await page.setViewportSize({ width: 900, height: 640 });
await page.waitForTimeout(900);
await page.evaluate(() => globalThis.__nbPacks && undefined);
await page.locator('[data-packs-open="wallpaper"]').first().click().catch(() => {});
await page.waitForTimeout(1000);
console.log(
  '  overflow:',
  await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  })),
);
await shot('10-narrow');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n} ${k}`);

await browser.close();
