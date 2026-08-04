import { attach, watchErrors, dumpErrors, poll, tryPoll, shot, tourState, check, fails, URL_BASE } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

console.log('=== phase 1: a brand-new reader ===');
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});
// Also wipe the SQLite/in-memory library so this really is a first run.
await page.evaluate(async () => {
  const dbs = await indexedDB.databases?.();
  if (dbs) for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
});
await page.reload({ waitUntil: 'domcontentloaded' });

await shot(page, '01-first-paint-immediate');
await poll(page, () => window.__shelfDesign !== undefined, 60000, 'the shelf world');
await page.waitForTimeout(1500);
await shot(page, '02-shelf-loaded');

const books = await page.evaluate(() => (window.__shelfVisibleBooks?.() ?? []).map((b) => ({ id: b.id, title: b.title })));
console.log('  books on the shelf:', JSON.stringify(books));
check(books.length === 1, `a fresh library ships exactly one book (got ${books.length})`);

const st = await tryPoll(page, () => (window.__nbTutorial?.getState?.().running === true ? 1 : 0), 30000, 'the tour');
check(st === 1, 'the tour starts by itself on a fresh library');
await page.waitForTimeout(800);
const s = await tourState(page);
console.log('  tour:', JSON.stringify(s));
await shot(page, '03-tour-greeting');

// what does the greeting card actually say / offer?
const card = await page.evaluate(() => {
  const layer = document.querySelector('.nbt-layer');
  if (!layer) return null;
  return {
    step: layer.getAttribute('data-tutorial-step'),
    text: layer.innerText,
    buttons: [...layer.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean),
  };
});
console.log('  card:', JSON.stringify(card, null, 1));

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 1 ok');
process.exit(0);
