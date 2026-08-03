/**
 * shots-now/blank-right-leaf.mjs — drive a real book past its last page and
 * try to WRITE on the bare right leaf.
 *
 * The claim under test is not "a fallback renders". It is:
 *   1. turning past the end leaves a bare right leaf,
 *   2. clicking that leaf creates the page row AND puts the caret in it,
 *   3. what you then type reaches a real page row (checked in the stub DB
 *      blob, then again by reloading and turning back to the spread).
 *
 * It refuses to pass vacuously: every step that cannot be reached fails loudly
 * with what was on screen instead. The whole scenario is retried when the dev
 * server yanks the execution context out from under it (other agents editing
 * src/ trigger vite full reloads); a retry is NOT a pass.
 *
 * Usage: node shots-now/blank-right-leaf.mjs [out.png]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'shots-now/blank-right-leaf.png';
const URL_BASE = 'http://localhost:1420';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const isReloadNoise = (err) =>
  /Execution context was destroyed|navigation|Target closed|frame was detached/i.test(
    String(err && err.message),
  );

async function attempt(round) {
  const MARK = `rightleaflives${Date.now().toString(36)}`;
  const failures = [];
  const fail = (msg) => {
    failures.push(msg);
    console.log(`  FAIL: ${msg}`);
  };

  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  p.setDefaultTimeout(60000);
  p.on('pageerror', (e) => console.log('  pageerror:', e.message.split('\n')[0]));

  try {
    const openBook = async ({ clear = false } = {}) => {
      await p.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
      if (clear) {
        await p.evaluate(() => localStorage.clear());
        await p.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
      }
      await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 300 });
      await p.evaluate(() => {
        globalThis.__worldReady = false;
        void globalThis.__shelfWorld.ready.then(() => {
          globalThis.__worldReady = true;
        });
      });
      await p.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 300 });
      const skip = p.getByText('skip the tour');
      if (await skip.count()) await skip.first().click();
      await p.waitForTimeout(600);
      await p.evaluate(async () => {
        const app = await import('/src/state/app.ts');
        const books = await import('/src/data/books.ts');
        const list = await books.listBooksByFloorRange(0, 20);
        app.appState.openBook(list[0].id);
      });
      await p.waitForFunction(
        () => document.querySelector('.nb-spread-stage') !== null,
        null,
        { polling: 200, timeout: 60000 },
      );
      await p.waitForTimeout(1400);
    };

    const spreadIndex = () =>
      p.evaluate(() =>
        Number(
          document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1,
        ),
      );
    const blank = (side) => p.locator(`.nb-leaf-paper[data-side="${side}"] .nb-leaf-blank`);
    const prose = (side) => p.locator(`.nb-leaf-paper[data-side="${side}"] .nb-prose`);
    const flipNext = async () => {
      await p.evaluate(() =>
        document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined,
      );
      await p.keyboard.press('ArrowRight');
      await p.waitForTimeout(1500);
    };

    await openBook({ clear: round === 1 });
    console.log(`  opened on spread ${await spreadIndex()}`);

    // 1. turn forward until the right leaf is bare
    let turns = 0;
    while ((await blank('right').count()) === 0 && turns < 8) {
      const before = await spreadIndex();
      await flipNext();
      const after = await spreadIndex();
      turns += 1;
      if (after === before) {
        fail(`ArrowRight stopped moving at spread ${before} before any bare right leaf appeared`);
        break;
      }
    }
    const targetSpread = await spreadIndex();
    if ((await blank('right').count()) === 0) {
      fail(`no bare right leaf after ${turns} forward turns (settled on spread ${targetSpread})`);
      await p.locator('.nb-book-view').screenshot({ path: out }).catch(() => {});
      return failures;
    }
    console.log(`  bare right leaf reached on spread ${targetSpread} after ${turns} turn(s)`);
    if ((await prose('left').count()) === 0) {
      fail('the LEFT leaf of the past-the-end spread has no editor either — different bug');
    }
    await p.locator('.nb-book-view').screenshot({ path: out.replace(/\.png$/, '-before.png'), caret: 'hide' }).catch(() => {});

    // 2. click the bare right leaf
    await blank('right').click();
    await prose('right').waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});
    if ((await prose('right').count()) === 0) {
      fail('clicking the bare right leaf created no page — the leaf is still bare');
      await p.locator('.nb-book-view').screenshot({ path: out }).catch(() => {});
      return failures;
    }

    // 3. the caret must be IN it (not on <body>)
    let caretIn = false;
    for (let i = 0; i < 60 && !caretIn; i++) {
      caretIn = await p.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement.closest('.nb-leaf-paper[data-side="right"] .nb-prose') !== null,
      );
      if (!caretIn) await p.waitForTimeout(150);
    }
    if (!caretIn) {
      const where = await p.evaluate(() => {
        const el = document.activeElement;
        return el instanceof HTMLElement ? `${el.tagName}.${el.className}` : String(el);
      });
      fail(`the page was created but the caret never landed in it (focus sat on ${where})`);
    }

    // 4. type, and check it reaches a page row
    await p.keyboard.type(MARK, { delay: 14 });
    await p.waitForTimeout(1600);

    const onLeaf = (await prose('right').innerText().catch(() => '')) ?? '';
    if (!onLeaf.includes(MARK)) {
      fail(`typing did not reach the right leaf — it reads ${JSON.stringify(onLeaf.slice(0, 80))}`);
    }
    const inDb = await p.evaluate((mark) => {
      const raw = localStorage.getItem('notebook.stubdb.v1');
      return typeof raw === 'string' && raw.includes(mark);
    }, MARK);
    if (!inDb) fail('the text never reached a stored page row (stub DB blob has no trace of it)');

    await p.locator('.nb-book-view').screenshot({ path: out, caret: 'hide' }).catch(() => {});
    console.log('  ->', out);

    // 5. reload and turn back to it
    await openBook();
    for (let i = 0; i < targetSpread; i++) await flipNext();
    const landed = await spreadIndex();
    const after = (await prose('right').innerText().catch(() => '')) ?? '';
    if (!after.includes(MARK)) {
      fail(
        `after reload, spread ${landed}'s right leaf does not show the text — it reads ${JSON.stringify(
          after.slice(0, 80),
        )}`,
      );
    } else {
      console.log(`  after reload spread ${landed}'s right leaf still reads the mark`);
    }
    if (failures.length === 0) {
      console.log(
        `\nPASS: the bare right leaf on spread ${targetSpread} became a writable page, took the caret, and the text survived a reload.`,
      );
    }
    return failures;
  } finally {
    await p.close().catch(() => {});
  }
}

let result = null;
for (let round = 1; round <= 4 && result === null; round += 1) {
  console.log(`\n--- round ${round} ---`);
  try {
    result = await attempt(round);
  } catch (err) {
    if (isReloadNoise(err) && round < 4) {
      console.log(`  (dev server reloaded mid-run: ${String(err.message).split('\n')[0]}) — retrying`);
      continue;
    }
    console.log('  ERROR:', err && err.message);
    result = ['probe could not complete: ' + String(err && err.message).split('\n')[0]];
  }
}
await b.close();
if (result === null || result.length > 0) {
  console.log(`\n${(result ?? ['never completed']).length} failure(s).`);
  process.exit(1);
}
