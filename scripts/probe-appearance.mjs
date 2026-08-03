/**
 * scripts/probe-appearance.mjs — the Appearance section, driven by clicking.
 *
 * The reader's complaint was that the section offered four themes, three
 * hands and three inks. Counting the chips in a unit test proves the
 * VOCABULARY grew; it says nothing about whether a chip in the sheet reaches
 * the page. So this one only ever clicks, and every assertion is on the
 * APPLIED state — the attributes and the resolved custom properties on
 * <html> — never on what was merely saved.
 *
 * Usage: node scripts/probe-appearance.mjs [--url=http://localhost:1420]
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
  viewport: { width: 1440, height: 1000 },
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

const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

/** Everything the appearance settings are supposed to have changed. */
const applied = () =>
  page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const read = (n) => cs.getPropertyValue(n).trim();
    return {
      theme: root.dataset.theme ?? null,
      appearance: root.dataset.appearance ?? null,
      ink: root.dataset.ink ?? null,
      paperCream: read('--paper-cream'),
      paperAged: read('--paper-aged'),
      inkSepia: read('--ink-sepia'),
      accent: read('--accent'),
      fontBody: read('--font-body'),
    };
  });

const fails = [];
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) fails.push(label);
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('.shelf-a11y button', { timeout: 120000 });
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);

/* 1 — open the sheet ------------------------------------------------------ */

console.log('\n1. open settings');
await page.getByRole('button', { name: 'Settings' }).first().click();
await page.waitForSelector('.nbs-sheet[role="dialog"]', { timeout: 20000 });
await page.waitForTimeout(900);
const start = await applied();
console.log('  at rest:', start);
await shot('appearance-01-open');

/* 2 — how many chips does each row really offer? -------------------------- */

console.log('\n2. count what each picker offers');
const counts = async () =>
  page.evaluate(() => {
    const out = {};
    for (const label of ['theme', 'hand', 'ink', 'paper']) {
      const groups = [...document.querySelectorAll(`[role="group"]`)].filter((g) => {
        const name = g.getAttribute('aria-label') ?? '';
        return name === label || name.startsWith(`${label}:`);
      });
      out[label] = groups.reduce((n, g) => n + g.querySelectorAll('button').length, 0);
    }
    return out;
  });
console.log('  collapsed:', await counts());

for (const label of ['theme', 'hand', 'ink', 'paper']) {
  const more = page.getByRole('button', { name: new RegExp(`^show all \\d+$`) });
  const row = page.locator('.nbs-row', { hasText: new RegExp(`^more ${label}`) });
  if (await row.count()) {
    await row.first().locator('button').click();
    await page.waitForTimeout(250);
  }
  void more;
}
await page.waitForTimeout(400);
const open = await counts();
console.log('  expanded:', open);
check('theme offers >= 20', open.theme >= 20, open.theme);
check('hand offers >= 20', open.hand >= 20, open.hand);
check('ink offers >= 20', open.ink >= 20, open.ink);
check('paper offers >= 20', open.paper >= 20, open.paper);
await shot('appearance-02-expanded');

/* 3 — a theme reaches the page ------------------------------------------- */

console.log('\n3. pick a dark theme');
await page.getByRole('button', { name: 'midnight theme' }).first().click();
await page.waitForTimeout(700);
const dark = await applied();
console.log('  applied:', dark);
check('data-appearance is the id', dark.appearance === 'midnight', dark.appearance);
check('data-theme is the BASE room', dark.theme === 'night', dark.theme);
check('the paper really changed', dark.paperCream !== start.paperCream, dark.paperCream);
check('the accent really changed', dark.accent !== start.accent, dark.accent);
await shot('appearance-03-midnight');

/* 4 — an ink reaches the page -------------------------------------------- */

console.log('\n4. pick an ink the stylesheet has never heard of');
await page.getByRole('button', { name: 'burgundy ink' }).first().click();
await page.waitForTimeout(600);
const inked = await applied();
console.log('  applied:', inked);
check('data-ink carries the id', inked.ink === 'burgundy', inked.ink);
check('--ink-sepia is a real colour', /^#|rgb/.test(inked.inkSepia), inked.inkSepia);
check('the reading ink changed', inked.inkSepia !== dark.inkSepia, inked.inkSepia);

/* 5 — a paper stock reaches the page ------------------------------------- */

console.log('\n5. pick a paper stock');
await page.getByRole('button', { name: 'kraft board paper' }).first().click();
await page.waitForTimeout(700);
const stocked = await applied();
console.log('  applied:', stocked);
check('the stock changed the ground', stocked.paperCream !== inked.paperCream, stocked.paperCream);

console.log('   …and back to the room');
await page.getByRole('button', { name: 'paper as the room' }).first().click();
await page.waitForTimeout(700);
const unstocked = await applied();
check(
  'clearing the stock gives the room its paper back',
  unstocked.paperCream === inked.paperCream,
  `${unstocked.paperCream} vs ${inked.paperCream}`,
);

/* 6 — a hand reaches the page -------------------------------------------- */

console.log('\n6. pick a hand');
await page.getByRole('button', { name: /^book serif, Lora$/ }).first().click();
await page.waitForTimeout(600);
const handed = await applied();
console.log('  applied:', handed);
check('--font-body names the face', /Lora/.test(handed.fontBody), handed.fontBody);
await shot('appearance-04-picked');

/* 7 — back to a shipped room leaves NO inline override -------------------- */

console.log('\n7. back to parchment');
await page.getByRole('button', { name: 'parchment theme' }).first().click();
await page.getByRole('button', { name: 'sepia ink' }).first().click();
await page.waitForTimeout(800);
const home = await applied();
console.log('  applied:', home);
const inline = await page.evaluate(() =>
  ['--paper-cream', '--ink-sepia', '--accent'].map(
    (n) => `${n}=${document.documentElement.style.getPropertyValue(n)}`,
  ),
);
console.log('  inline on <html>:', inline);
check(
  'a shipped room writes nothing inline',
  inline.every((entry) => entry.endsWith('=')),
  inline.join(' '),
);
check('the page is back on cream', home.paperCream === start.paperCream, home.paperCream);
await shot('appearance-05-home');

/* 8 — the dice ------------------------------------------------------------ */

console.log('\n8. roll a whole look');
await page.getByRole('button', { name: 'roll a whole look' }).first().click();
await page.waitForTimeout(900);
const rolled = await applied();
console.log('  applied:', rolled);
check(
  'the dice moved something',
  rolled.appearance !== 'parchment' || rolled.ink !== 'sepia' || rolled.fontBody !== home.fontBody,
  `${rolled.appearance} / ${rolled.ink}`,
);
await shot('appearance-06-rolled');

console.log('\nerrors:', errors.size === 0 ? 'none' : [...errors.entries()]);
console.log(fails.length === 0 ? '\nALL CHECKS PASSED' : `\nFAILED: ${fails.join(', ')}`);
await browser.close();
process.exit(fails.length === 0 && errors.size === 0 ? 0 : 1);
