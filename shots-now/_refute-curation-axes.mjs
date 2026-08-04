/**
 * shots-now/_refute-curation-axes.mjs — the other direction of the audit.
 *
 * `shots-now/probe-curated-axes.mjs` proves the axes that DO name a picker can
 * be curated by clicking. This one exists to attack the opposite half of the
 * same claim: that 'tooling', 'wear' and 'icon-colour' were dropped from
 * `CURATION_AXES` because there is no list on screen for them to be the
 * curation OF. If any of the three turns out to be a real row of choices, the
 * words were not stale — they were the only thing pointing at a list nobody
 * wired, and deleting them buried the gap instead of closing it.
 *
 * So every check below is stated as the refutation it is looking for, and it
 * only ever LOOKS and right-clicks: a control that offers curation answers by
 * opening `.nb-cur-menu`, and one that offers none answers by staying silent.
 *
 * Usage: node shots-now/_refute-curation-axes.mjs [--url=http://localhost:1420]
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

const fails = [];
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail === '' ? '' : `  — ${detail}`}`);
  if (!ok) fails.push(what);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 980 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(60000);

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

/**
 * Right-click a control and say whether a curation menu came up.
 *
 * The wait is generous on purpose: a menu that opens on the frame AFTER the
 * assertion would let a curatable control pass as an uncuratable one, which is
 * the exact mistake this file is trying not to make in the app's favour.
 */
const menuAfterRightClick = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await locator.click({ button: 'right' });
  await page.waitForTimeout(1500);
  const open = await page.locator('.nb-cur-menu').count();
  if (open === 0) return null;
  const name = ((await page.locator('.nb-cur-menu-name').first().textContent()) ?? '').trim();
  const items = await page.$$eval('.nb-cur-menu button.nb-cur-menu-item', (b) =>
    b.map((x) => (x.textContent ?? '').trim()),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return { name, items };
};

/* ------------------------------------------------------------------ boot -- */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
await page.waitForFunction(() => globalThis.__shelfCuration !== undefined, null, { polling: 400 });

const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  if (list[0]) app.appState.openBook(list[0].id);
});
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForTimeout(1200);
await page.locator('.nb-rail-button[data-tool="customize"]').click();
await page.waitForSelector('.nb-book-studio', { timeout: 30000 });
await page.waitForTimeout(1000);

/* ------------------------------------------------------- 1. 'tooling' ----- */

console.log("\n1. 'tooling' — is it a list, or a switch?");
const tooling = page.locator('[aria-label="Tooling"]');
check((await tooling.count()) === 1, 'the studio has one Tooling group', `${await tooling.count()}`);
const toolingChips = await page.$$eval('[aria-label="Tooling"] button', (b) =>
  b.map((x) => (x.textContent ?? '').trim()),
);
console.log(`  the group holds: ${toolingChips.join(' | ')}`);
check(
  toolingChips.length === 1,
  'it is ONE control, not a row you could take an entry off',
  `${toolingChips.length} control(s)`,
);
const toolingMenu = await menuAfterRightClick(page.locator('[aria-label="Tooling"] button').first());
check(
  toolingMenu === null,
  'right-clicking it offers no curation menu',
  toolingMenu === null ? 'silent' : `menu said “${toolingMenu.name}”`,
);
// A switch has to actually be a switch: press it and it must come back saying
// the other of its two words, with no third state to prune.
const before = toolingChips[0];
await page.locator('[aria-label="Tooling"] button').first().click();
await page.waitForTimeout(500);
const after = (await page.locator('[aria-label="Tooling"] button').first().textContent())?.trim();
console.log(`  pressing it: “${before}” → “${after}”`);
check(before !== after, 'and it is two-position', `${before} / ${after}`);
await page.locator('[aria-label="Tooling"] button').first().click();
await page.waitForTimeout(400);

/* ---------------------------------------------------------- 2. 'wear' ----- */

console.log("\n2. 'wear' — a range, or five things to choose between?");
const wear = page.locator('input[aria-label="Wear"]');
check((await wear.count()) === 1, 'the studio has one Wear control', `${await wear.count()}`);
const wearShape = await page.$eval('input[aria-label="Wear"]', (el) => ({
  type: el.type,
  min: el.min,
  max: el.max,
  step: el.step,
}));
console.log(`  ${JSON.stringify(wearShape)}`);
check(
  wearShape.type === 'range',
  'it is a slider, not a list of stops',
  `${wearShape.min}–${wearShape.max} step ${wearShape.step}`,
);
const wearMenu = await menuAfterRightClick(wear);
check(
  wearMenu === null,
  'right-clicking it offers no curation menu',
  wearMenu === null ? 'silent' : `menu said “${wearMenu.name}”`,
);
// The five stops `WEAR_STOPS` names, exactly as it names them. If the axis
// were really a list of five, these would be five buttons.
//
// Matched on the WHOLE label rather than by substring, which is the mistake
// this check made on its first run: 'foxed' is one of the fifty EDGE
// treatments, so a loose word list convicted the edge row of being the wear
// row.
const stopWords = ['pristine', 'gently read', 'read', 'worn', 'well-loved'];
const stopButtons = await page.$$eval(
  '.nb-book-studio button',
  (btns, words) =>
    btns
      .map((b) => (b.textContent ?? '').replace(/★/g, '').trim().toLowerCase())
      .filter((t) => words.includes(t)),
  stopWords,
);
check(
  stopButtons.length === 0,
  'and no wear stop is a button anywhere in the studio',
  stopButtons.join(', ') || 'none',
);

/* --------------------------------------------------- 3. 'icon-colour' ----- */

console.log("\n3. 'icon-colour' — is there a picker for it under any name?");
const panels = ['customize', 'page-style', 'catalogue'];
const iconish = [];
for (const tool of panels) {
  const button = page.locator(`.nb-rail-button[data-tool="${tool}"]`);
  if ((await button.count()) === 0) continue;
  await button.click();
  await page.waitForTimeout(900);
  // CONTROLS only, and never a class name: the rail's own artwork carries
  // `nb-rail-icon` on every glyph, and matching that reported seven icon
  // pickers per panel where there is not one. What an 'icon-colour' list would
  // look like is a button, an input or a group that SAYS icon.
  const hits = await page.$$eval('.nb-rail-panel, .nb-book-studio, .nb-catalogue, .nb-pagestyle', (roots) => {
    const out = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll('button, input, [role="group"], label, h3')) {
        const label = `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`;
        if (/\bicons?\b/i.test(label)) out.push(`${el.tagName.toLowerCase()} “${label.trim().slice(0, 40)}”`);
      }
    }
    return out;
  });
  if (hits.length > 0) iconish.push(`${tool}: ${hits.join(' / ')}`);
}
// Settings too — it is the one place an "app icon" choice would plausibly live.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const settings = page.getByRole('button', { name: 'Settings' });
if ((await settings.count()) > 0) {
  await settings.first().click();
  await page.waitForTimeout(1500);
  const hits = await page.$$eval('.nbs-sheet, .nbs-dialog, [role="dialog"]', (roots) => {
    const out = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll('button, input, [role="group"]')) {
        const label = `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`;
        if (/\bicons?\b/i.test(label)) out.push(`${el.tagName.toLowerCase()} “${label.trim().slice(0, 40)}”`);
      }
    }
    return out;
  });
  if (hits.length > 0) iconish.push(`settings: ${hits.join(' / ')}`);
  await page.screenshot({ path: 'qa/ui/refute-curation-settings.png' });
}
console.log(`  anything reading as an icon control: ${iconish.length === 0 ? 'nothing' : iconish.join('  |  ')}`);
check(iconish.length === 0, "no control anywhere reads as the 'icon-colour' list", iconish.join(' | '));

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${fails.length === 0 ? 'THE CLAIM SURVIVED' : `${fails.length} REFUTED`} ===`);
for (const f of fails) console.log(`  x ${f}`);

await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
