/**
 * scripts/probe-bookcases.mjs — visual QA probe for multiple bookcases and
 * the finite case height.
 *
 * There is no bookcase UI yet (the rail belongs to another agent), so this
 * drives the `__shelfBookcases` QA bridge the world exposes under ?fx=force.
 * What it is actually looking at:
 *
 *  - the case has a BOTTOM now: drag to the end and the last plank stops;
 *  - switching bookcase changes the room AND the books, with nothing from the
 *    previous case left standing;
 *  - "add floor" grows the case, and the growth survives a reload.
 *
 * Usage: node scripts/probe-bookcases.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
let step = 'boot';
const errorsByStep = new Map();
page.on('pageerror', (e) => {
  const key = `${step} :: ${e.message.split('\n')[0]}`;
  errorsByStep.set(key, (errorsByStep.get(key) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text());
});

const shot = async (name) => {
  step = name;
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`shot qa/ui/${name}.png`);
};

const poll = async (fn, arg, timeout = 60000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(300);
  }
};

const titles = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.shelf-a11y button')].map((b) => b.textContent?.trim()),
  );

/** Drag the canvas: the shelf pans with the pointer. */
const panBy = async (dy, steps = 12) => {
  await page.mouse.move(1180, 450);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(1180, 450 - (dy * i) / steps, { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
};

/** Pan hard against the bottom of the case several times over. */
const panToBottom = async () => {
  for (let i = 0; i < 8; i += 1) await panBy(700, 8);
  await page.waitForTimeout(900);
};

// A clean library every run, so the board is the same picture every time.
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });

await poll(() => globalThis.__shelfWorld !== undefined, null, 120000, 'world hook');
await poll(
  () => document.querySelector('.shelf-a11y button') !== null,
  null,
  120000,
  'a11y mirror',
);
// The first-run tour would sit over every frame of this board.
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(2500);

/* 1 — the default case, stocked ----------------------------------------- */

await page.evaluate(async () => {
  await globalThis.__shelfSeedBooks(
    ['Cell Biology', 'Kanji Practice', 'Watercolor Basics', 'Tea Tasting Journal'],
    0,
  );
  await globalThis.__shelfSeedBooks(['Linear Algebra', 'SQL Spellbook'], 1);
  await globalThis.__shelfSeedBooks(['Birdwatching Field Notes'], 3);
});
await page.waitForTimeout(1600);
await shot('bookcase-01-home-floor0');

/* 2 — the case has a bottom ---------------------------------------------- */

step = 'pan-to-bottom';
await panToBottom();
await shot('bookcase-02-case-bottom');
console.log(
  'at bottom',
  await page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    return { floors: w.caseFloors, bookcase: w.bookcaseId };
  }),
);

/* 3 — a second bookcase: its own room, its own books ---------------------- */

step = 'create+switch-to-attic';
const attic = await page.evaluate(async () => {
  const made = await globalThis.__shelfBookcases.create('Attic');
  await globalThis.__shelfBookcases.switch(made.id);
  return made;
});
await page.waitForTimeout(2000);
await page.evaluate(async () => {
  await globalThis.__shelfSeedBooks(['Cloud Shapes I Have Known', 'Letters Never Sent'], 0);
});
await page.waitForTimeout(1800);
await shot('bookcase-03-attic');
console.log('attic', attic.name, 'room', attic.room, 'titles', await titles());

/* 4 — back home: nothing from the attic came with us --------------------- */

step = 'switch-back-home';
await page.evaluate(async () => {
  const state = globalThis.__shelfBookcases.list();
  await globalThis.__shelfBookcases.switch(state.list[0].id);
});
await page.waitForTimeout(2000);
await shot('bookcase-04-back-home');
console.log('home titles', await titles());

/* 5 — add a floor: the case grows and keeps it --------------------------- */

step = 'add-floor';
const grown = await page.evaluate(() => {
  globalThis.__shelfBookcases.addFloor();
  return globalThis.__shelfWorld.caseFloors;
});
await page.waitForTimeout(2000);
await panToBottom();
await shot('bookcase-05-added-floor-bottom');
console.log('floors after add', grown);

await page.reload({ waitUntil: 'domcontentloaded' });
await poll(() => globalThis.__shelfWorld !== undefined, null, 120000, 'world hook (reload)');
await page.waitForTimeout(2800);
console.log(
  'after reload',
  await page.evaluate(() => ({
    floors: globalThis.__shelfWorld.caseFloors,
    active: globalThis.__shelfBookcases.active().name,
    cases: globalThis.__shelfBookcases.list().list.map((c) => `${c.name}:${c.floors}`),
  })),
);
await shot('bookcase-06-after-reload');

console.log('--- page errors by step ---');
for (const [key, count] of errorsByStep) console.log(`${count}x ${key}`);
if (errorsByStep.size === 0) console.log('none');

await browser.close();
