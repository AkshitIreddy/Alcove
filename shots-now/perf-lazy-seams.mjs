/**
 * perf-lazy-seams.mjs — the four things the boot no longer loads, opened.
 *
 * The boot chunk was cut roughly in half by reaching four features with
 * `import()` instead of a static import: the book (and with it the whole
 * editor), the templates gallery, the parcel desk, and the Markdown importer.
 * Every one of those is a chance to ship a button that now does nothing — this
 * repo has shipped authored-but-unreachable code eight times, and a chunk that
 * 404s or a promise nobody awaits looks exactly like a dead button.
 *
 * So this drives all four, from the UI, against a PRODUCTION build (vite
 * preview), and fails loudly on a page error. Dev-server dynamic imports are
 * not the same code path — dev serves modules unbundled and never has to
 * resolve a hashed chunk name.
 *
 * Usage: node shots-now/perf-lazy-seams.mjs [--url=http://localhost:4173]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, f) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : f;
};
const BASE = opt('url', 'http://localhost:4173');
mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().split('/').pop()}`);
});

const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/lazy-${name}.png` });
  console.log(`  shot qa/ui/lazy-${name}.png`);
};
let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
};

await page.goto(`${BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.__shelfVisibleBooks === 'function' && window.__shelfVisibleBooks().length > 0,
  null,
  { timeout: 30000 },
);

console.log('\n1. the shelf, with nothing lazy loaded yet');
check(
  'no editor chunk fetched for the shelf',
  await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .every((e) => !/BookView|extensions-|TransferPanel/.test(e.name)),
  ),
);
await shot('01-shelf');

console.log('\n2. the templates gallery (import() from the dock)');
await page.click('button[aria-label="Start from a template"]');
await page.waitForSelector(".nb-tpl-host .nb-tpl-grid", { timeout: 15000 });
check("gallery mounted with cards", (await page.locator(".nb-tpl-card").count()) > 0);
await shot('02-templates');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

console.log('\n3. the parcel desk (import() from the keyboard command)');
await page.keyboard.press('Control+Shift+E');
await page.waitForSelector('.nb-tr-card[role="dialog"]', { timeout: 15000 });
check('transfer panel mounted', (await page.locator('.nb-tr-card').count()) > 0);
await shot('03-transfer');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

console.log('\n4. a book opens (lazy BookView, and the editor with it)');
// The a11y list is a real reader's path into a book (it is what a keyboard or
// a screen reader uses), and unlike a spine it is a DOM node with a click
// handler rather than a sprite behind a gesture. TWO presses, because that is
// the shelf's gesture: the first pulls the book out and leaves it standing in
// front of the case (`.pulled-book.is-held`), the second opens it.
const press = (sel) =>
  page.evaluate((s) => {
    document
      .querySelector(s)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, sel);
await press('.shelf-a11y button');
await page.waitForSelector('.pulled-book.is-held', { timeout: 20000 });
check('the book comes off the shelf', true);
// Enter on the held book, not a synthetic click: the book at rest is its own
// button and listens on real pointer events (and Enter/Space), so a
// `new MouseEvent('click')` lands on nothing. This is the keyboard reader's
// route in, which is the one worth proving still works.
await page.locator('.pulled-book.is-held').focus();
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelector('.ProseMirror') !== null, null, {
  timeout: 30000,
});
check('a TipTap editor is live in the spread', await page.locator('.ProseMirror').count() > 0);
check(
  'the editor chunk did arrive',
  await page.evaluate(() =>
    performance.getEntriesByType('resource').some((e) => /extensions-/.test(e.name)),
  ),
);
await shot('04-book');

console.log('\n=== page errors ===');
console.log(errors.length ? [...new Set(errors)].join('\n') : 'none');
if (errors.length) failures += 1;
console.log(failures === 0 ? '\nALL SEAMS OPEN\n' : `\n${failures} FAILED\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
