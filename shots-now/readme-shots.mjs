/**
 * shots-now/readme-shots.mjs — the README's own screenshots, captured from the
 * running app rather than described.
 *
 * Every picture in the README has to prove the sentence above it, so each one
 * here is taken after the app has actually reached the state that sentence
 * claims: a stocked shelf, a book open on its spread, the slash menu down, the
 * studio pushed the world aside. Output lands in docs/readme/img/.
 *
 * Usage: node shots-now/readme-shots.mjs [--url=http://localhost:1420] [--only=shelf,spread]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const ONLY = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const wanted = (name) => ONLY.length === 0 || ONLY.includes(name);

const OUT = 'docs/readme/img';
mkdirSync(OUT, { recursive: true });

const TITLES = [
  'Field Notes',
  'Kanji Practice',
  'Watercolour Basics',
  'Cell Biology',
  'Recipes',
  'Dream Journal',
  'The Long Walk',
  'Chess Openings',
  'Garden Log',
  'Letters Home',
];
const TITLES_2 = [
  'Sourdough',
  'Astronomy',
  'Bird Counts',
  'Icelandic',
  'Weekly Review',
  'Short Stories',
  'Tax 2026',
  'Piano Scales',
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled', caret: 'hide' });
  console.log(`  shot ${OUT}/${name}.png`);
};
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click({ force: true });
await wait(1200);

/* ---------------------------------------------------------------- the shelf */

console.log('\n1. stock the shelf');
await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 0), TITLES);
await wait(1500);
await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 1), TITLES_2);
await wait(3500);
if (wanted('shelf')) await shot('shelf');

/* --------------------------------------------------------------- the studio */

if (wanted('studio')) {
  console.log('\n2. the library studio');
  await page.getByRole('button', { name: /studio/i }).first().click({ force: true });
  await page.waitForSelector('.nb-library-studio', { timeout: 30000 });
  await wait(2200);
  await shot('studio');
  await page.keyboard.press('Escape');
  await wait(1200);
}

/* ------------------------------------------------------- open a book, pages */

console.log('\n3. open a book');
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForSelector('.nb-prose p', { timeout: 60000 });
await wait(2200);
if (wanted('spread')) await shot('spread');

/* ----------------------------------------------------------- the slash menu */

if (wanted('slash')) {
  console.log('\n4. the slash menu');
  await page.evaluate(async () => {
    const { activeEditor } = await import('/src/editor/insert/activeEditor.ts');
    const ed = activeEditor();
    if (!ed) return;
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'paragraph' });
    ed.commands.focus('end');
  });
  await wait(400);
  await page.keyboard.type('/');
  await wait(1400);
  await shot('slash');
  await page.keyboard.press('Escape');
  await wait(500);
}

/* ------------------------------------------------------------ the catalogue */

if (wanted('catalogue')) {
  console.log('\n5. the catalogue');
  await page.getByRole('button', { name: /Catalogue/i }).first().click({ force: true });
  await wait(2000);
  await shot('catalogue');
  await page.keyboard.press('Escape');
  await wait(800);
}

/* --------------------------------------------------------- the script sheet */

if (wanted('script')) {
  console.log('\n6. insert script');
  await page.getByRole('button', { name: /Insert script/i }).first().click({ force: true });
  await wait(1600);
  await shot('script-dialog');
  await page.keyboard.press('Escape');
  await wait(800);
}

/* ----------------------------------------------------------- quick switcher */

if (wanted('quickswitch')) {
  console.log('\n7. quick switch');
  await page.keyboard.press('Control+k');
  await wait(1400);
  await shot('quickswitch');
  await page.keyboard.press('Escape');
  await wait(600);
}

console.log('\nerrors:', errors.size === 0 ? 'none' : [...errors.entries()]);
await browser.close();
