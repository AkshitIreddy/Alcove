/**
 * scripts/probe-newbooks.mjs — does a new book arrive with a character?
 *
 * Makes twenty books through the real `createBook`, then reads back what each
 * one resolved to and counts how many distinct answers each axis produced.
 * The old global "new books wear this palette" setting is gone; this is the
 * measurement that says what replaced it is actually doing something.
 *
 * Usage: node scripts/probe-newbooks.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.waitForTimeout(2500);

const report = await page.evaluate(async () => {
  const books = await import('/src/data/books.ts');
  const bs = await import('/src/art/bookStyle.ts');
  const design = await import('/src/art/bookDesign.ts');

  const made = [];
  for (let i = 0; i < 20; i += 1) {
    made.push(await books.createBook({ title: `Specimen ${i}`, floor: 5, slot: i }));
  }

  const axes = {};
  const bump = (axis, value) => {
    (axes[axis] ??= new Set()).add(String(value));
  };
  for (const book of made) {
    const r = bs.resolveBookStyle(book.spineSeed, null, books.readBookStyleOverrides(book));
    for (const key of [
      'material',
      'pigment',
      'raisedBands',
      'headTail',
      'headTailStyle',
      'ornament',
      'titlePlate',
      'titleFont',
      'wear',
      'edge',
      'format',
      'charm',
      'coverFrame',
      'coverMedallion',
      'insetPlate',
    ]) {
      bump(key, r.style[key]);
    }
    bump('binding', design.presetForSeed(book.spineSeed).id);
    bump('hasStyle', books.readBookStyleOverrides(book) !== null);
  }
  const out = {};
  for (const [axis, set] of Object.entries(axes)) out[axis] = set.size;
  return out;
});

console.log('\ntwenty freshly created books — distinct values per axis (of 20)');
for (const [axis, n] of Object.entries(report)) {
  console.log(`  ${axis.padEnd(16)} ${String(n).padStart(2)}${n === 1 ? '   <<< all identical' : ''}`);
}

await browser.close();
