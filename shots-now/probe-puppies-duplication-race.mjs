/**
 * Stress the real Insert Script -> immediate page-turn path with the owner's
 * floating-point puppies fixture. This intentionally does not wait for the
 * pagination carry chain before asking for the next spread.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = 'http://127.0.0.1:1420';
const sourcePath =
  'C:/Users/akshi/Downloads/computer-systems-week4-floating-point-puppies.md';
const source = readFileSync(sourcePath, 'utf8');
const out = 'shots-now/out/puppies-duplication-race';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(120_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));

const readState = async (bookId) => page.evaluate((id) => {
  const text = (node) => {
    if (typeof node?.text === 'string') return node.text;
    return Array.isArray(node?.content) ? node.content.map(text).join(' ') : '';
  };
  const leaf = (side) => {
    const paper = document.querySelector(
      `.nb-leaf-paper[data-side="${side}"]:not(.nb-export-sheet)`,
    );
    return {
      id: paper?.getAttribute('data-page-id') ?? null,
      text: paper?.querySelector('.nb-prose')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  };
  const raw = localStorage.getItem('notebook.stubdb.v1');
  const db = raw === null ? {} : JSON.parse(raw);
  const pages = (db.pages ?? [])
    .filter((row) => row.book_id === id)
    .sort((a, b) => a.ord - b.ord)
    .map((row) => {
      const doc = JSON.parse(row.doc_json);
      return { id: row.id, ord: row.ord, text: text(doc).replace(/\s+/g, ' ').trim() };
    });
  return {
    at: performance.now(),
    spread: Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1),
    flipping: document.querySelector('.nb-flip-canvas.is-flipping') !== null,
    left: leaf('left'),
    right: leaf('right'),
    faces: globalThis.__flipCache?.facesFor?.('next') ?? null,
    pages,
  };
}, bookId);

await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('nb-tutorial-done', '1');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
await page.evaluate(async () => globalThis.__shelfWorld.ready);
for (let attempt = 0; attempt < 6; attempt += 1) {
  const skip = page.getByText('skip the tour', { exact: false });
  if ((await skip.count()) === 0) break;
  await skip.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(200);
}
const bookId = await page.evaluate(async () => {
  const made = await globalThis.__shelfAddBook?.(0);
  return made?.book?.id ?? null;
});
if (bookId === null) throw new Error('fresh book unavailable');
await page.evaluate(async (id) => {
  const app = await import('/src/state/app.ts');
  app.appState.openBook(id);
}, bookId);
await page.waitForSelector('.nb-book-view .nb-prose');
for (let attempt = 0; attempt < 6; attempt += 1) {
  const skip = page.getByText('skip the tour', { exact: false });
  if ((await skip.count()) === 0) break;
  await skip.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(200);
}

await page.locator('.nb-leaf-paper[data-side="left"]:not(.nb-export-sheet) .nb-prose').click({
  position: { x: 30, y: 30 },
});
await page.locator('.nb-rail-button[data-tool="share"]').click();
await page.getByText('Paste a script in', { exact: true }).click();
const dialog = page.getByRole('dialog', { name: 'Insert script', exact: true });
await dialog.locator('textarea').fill(source);
const insertStartedAt = performance.now();
await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
await dialog.waitFor({ state: 'detached' });
const insertDurationMs = performance.now() - insertStartedAt;

const states = [];
states.push({ event: 'dialog-closed', ...(await readState(bookId)) });
for (let turn = 0; turn < 15; turn += 1) {
  const hotspot = page.locator('.nb-flip-hotspot-next');
  if ((await hotspot.count()) === 0) break;
  const before = await readState(bookId);
  await hotspot.click({ force: true });
  for (let frame = 0; frame < 22; frame += 1) {
    await page.waitForTimeout(25);
    states.push({ event: `turn-${turn}-frame-${frame}`, ...(await readState(bookId)) });
  }
  await page.waitForFunction(
    (prior) =>
      !document.querySelector('.nb-flip-canvas.is-flipping') &&
      Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1) !== prior,
    before.spread,
    { polling: 20 },
  ).catch(() => {});
  states.push({ event: `turn-${turn}-landed`, ...(await readState(bookId)) });
  if (turn === 11 || turn === 13) {
    await page.locator('.nb-book-view').screenshot({
      path: `${out}/mips-spread-${turn}.png`,
      caret: 'hide',
    });
  }
}

await page.waitForTimeout(2500);
states.push({ event: 'final', ...(await readState(bookId)) });
await page.locator('.nb-book-view').screenshot({
  path: `${out}/final.png`,
  caret: 'hide',
});

const landed = states.filter((state) => state.event.endsWith('-landed'));
const repeats = [];
for (let index = 0; index < landed.length; index += 1) {
  for (let other = index + 1; other < landed.length; other += 1) {
    for (const a of ['left', 'right']) {
      for (const b of ['left', 'right']) {
        const first = landed[index][a];
        const second = landed[other][b];
        if (
          first.id !== null &&
          second.id !== null &&
          first.id !== second.id &&
          first.text.length > 80 &&
          first.text === second.text
        ) {
          repeats.push({ first: landed[index].event, firstSide: a, firstId: first.id,
            second: landed[other].event, secondSide: b, secondId: second.id,
            text: first.text.slice(0, 220) });
        }
      }
    }
  }
}

const report = { sourcePath, insertDurationMs, errors, repeats, states };
writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  states: states.length,
  landed: landed.length,
  repeats: repeats.length,
  insertDurationMs: Math.round(insertDurationMs),
  finalPages: states.at(-1)?.pages.length ?? null,
  errors: errors.length,
  report: `${out}/report.json`,
}, null, 2));
await browser.close();
