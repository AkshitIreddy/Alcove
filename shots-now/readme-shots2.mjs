/**
 * shots-now/readme-shots2.mjs — the second half of the README's screenshots.
 *
 * These are the ones that need the app to have DONE something first: a script
 * typed into the insert sheet so the live preview has content to draw, the same
 * script inserted so the rendered page (diagram and all) can be photographed,
 * the book studio open on a real book, and the camera pulled back far enough
 * that the case reads as one object.
 *
 * Usage: node shots-now/readme-shots2.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'docs/readme/img';
mkdirSync(OUT, { recursive: true });

const SCRIPT = [
  '---',
  'title: Field Notes — Week 3',
  'paper: grid',
  'wash: moss',
  '---',
  '',
  '# Photosynthesis {sticker=leaf}',
  '',
  'Sunlight in, sugar out. The ==light-dependent=={color=amber} half runs in the thylakoid.',
  '',
  '::: sticky-note {color=lemon, rotate=-2, tape=corner}',
  'Exam **Friday** — learn both stages.',
  ':::',
  '',
  '```graph',
  'Sun -> Leaf: light',
  'Water -> Leaf',
  'Leaf -> Glucose, Oxygen',
  'Glucose {color=amber}',
  '```',
  '',
  '```timeline',
  '1771: Priestley — air is "restored"',
  '1779: Ingenhousz — only in the light',
  '1845: Mayer — sunlight becomes chemical energy',
  '```',
].join('\n');

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

console.log('\n1. stock a couple of floors and pull the camera back');
await page.evaluate(() =>
  globalThis.__shelfSeedBooks(
    ['Field Notes', 'Kanji Practice', 'Watercolour Basics', 'Cell Biology', 'Recipes',
     'Dream Journal', 'The Long Walk', 'Chess Openings', 'Garden Log', 'Letters Home'],
    0,
  ),
);
await wait(1500);
await page.evaluate(() =>
  globalThis.__shelfSeedBooks(
    ['Sourdough', 'Astronomy', 'Bird Counts', 'Icelandic', 'Weekly Review', 'Short Stories'],
    1,
  ),
);
await wait(1500);
await page.evaluate(() =>
  globalThis.__shelfSeedBooks(['Tax 2026', 'Piano Scales', 'Sketchbook', 'Quotes'], 2),
);
await wait(3000);
// Plain wheel is zoom in this app — scroll down on the canvas to pull back.
const canvas = page.locator('canvas').first();
await canvas.hover({ position: { x: 700, y: 400 } }).catch(() => {});
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 240);
  await wait(280);
}
await wait(3000);
await shot('shelf-zoomout');

console.log('\n2. open a book');
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForSelector('.nb-prose p', { timeout: 60000 });
await wait(2000);

console.log('\n3. the book studio');
await page.getByRole('button', { name: /Customize this book/i }).first().click({ force: true });
await wait(2000);
await shot('book-studio');
await page.keyboard.press('Escape');
await wait(1000);

console.log('\n4. the insert sheet, with a real script in it');
await page.getByRole('button', { name: /Insert script/i }).first().click({ force: true });
await wait(1200);
const box = page.locator('textarea').first();
await box.click({ force: true });
await box.fill(SCRIPT);
await wait(2500);
await shot('script-dialog');

console.log('\n5. insert it and photograph the page it makes');
await page.getByRole('button', { name: /^Insert$/i }).first().click({ force: true });
await wait(4000);
await shot('script-page');

console.log('\nerrors:', errors.size === 0 ? 'none' : [...errors.entries()]);
await browser.close();
