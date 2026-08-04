/**
 * tests/e2e/pagination-probe.mjs — press the pagination contract against the
 * running app instead of against its arithmetic.
 *
 * `tests/pagination.test.ts` covers the pure math and `pages.spec.ts` covers
 * "no scrollbar" and "the marker landed somewhere". Neither one asks whether
 * ink that could NOT leave a page is still on screen, and that is the
 * reader-visible half of "pages never scroll": the prose root is
 * `overflow: hidden`, so anything the drain declines to peel is not scrolled
 * to — it is gone. That is how one long paragraph came to swallow its own last
 * three hundred words and the caret with them (check 3), which is what this
 * file was written to catch.
 *
 * Checks, all on the applied state:
 *   1. typed lines: every top-level block on a leaf ends inside the leaf's box
 *      (nothing clipped below the fold), and no layer scrolls;
 *   2. the caret carries to the exact spot — a marker typed straight after the
 *      break appends to the line it was typing, never lands mid-word;
 *   3. one long paragraph (no Enter) — the block the trailing drain may never
 *      peel; its words must survive intact and in order;
 *   4. a big paste: many blocks in ONE transaction, cascading over pages;
 *   5. a code block taller than a page — cut at newlines, never at a wrap;
 *   6. a full page beside an open rail sheet — the fit SCALES the book, so
 *      carrying on typing with a sheet out must not move a block.
 *
 * Each check gets its OWN browser context, i.e. its own stub database and its
 * own freshly seeded welcome book. Sharing one had them stepping on each
 * other: check 4 leaves the book long enough that "add a page" lands the blank
 * somewhere check 5 was not looking, and the failure reads as a bug in the app.
 *
 * Lives beside the Playwright specs rather than in `scripts/` on purpose: it is
 * a probe, but `scripts/probe-*.mjs` is a COUNTED set (check-readme.mjs) and
 * the README's number for it is not this task's to move.
 *
 * Usage: node tests/e2e/pagination-probe.mjs [--url=http://localhost:1420]
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

const failures = [];
const fail = (m) => {
  failures.push(m);
  console.log(`  FAIL  ${m}`);
};
const pass = (m) => console.log(`  ok    ${m}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

/** A booted book view on a fresh stub database, tour already suppressed. */
async function openBook() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  // The flag has to be in the stub DB before the first navigation: the tour
  // owns the pointer stream and a 350x600 card sits over the middle of the
  // view, so dismissing it afterwards races its own mount.
  await page.addInitScript(
    ([storageKey, tutorialKey]) => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        const blob = raw === null ? {} : JSON.parse(raw);
        const rows = Array.isArray(blob.settings) ? blob.settings : [];
        const at = rows.findIndex((r) => r?.key === tutorialKey);
        const row = { key: tutorialKey, value: '1' };
        if (at >= 0) rows[at] = row;
        else rows.push(row);
        blob.settings = rows;
        window.localStorage.setItem(storageKey, JSON.stringify(blob));
      } catch {
        /* the stop() below is the backstop */
      }
    },
    ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
  );
  await page.goto(`${URL_BASE}/?fx=force&dev=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__nbTutorial?.stop?.());
  await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
  await page.waitForSelector('.nb-prose', { timeout: 120_000 });
  await page.waitForTimeout(1200);
  return { page, context, errors };
}

/**
 * Append a blank page, land on it, and hand back its editor. WHICH leaf it
 * arrives on depends on the parity of the book's page count (the welcome book
 * seeds sixteen), so ask the DOM rather than assuming the right one.
 */
async function blankPage(page) {
  await page.getByRole('button', { name: 'Add a page' }).click();
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(250);
    const side = await page.evaluate(() => {
      for (const leaf of document.querySelectorAll('.nb-leaf-paper')) {
        const prose = leaf.querySelector('.nb-prose');
        if (prose && (prose.textContent ?? '').trim().length === 0) {
          return leaf.getAttribute('data-side');
        }
      }
      return null;
    });
    if (side) {
      const prose = page.locator(`.nb-leaf-paper[data-side="${side}"] .nb-prose`);
      await prose.click();
      return prose;
    }
  }
  throw new Error('no blank page arrived after "Add a page"');
}

/**
 * Every top-level block on both leaves, with how far past its leaf's paper it
 * ends. Positive `over` means the reader cannot see the bottom of that block:
 * a paginated page clips, it does not scroll.
 */
const clipReport = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const leaf of document.querySelectorAll('.nb-leaf-paper')) {
      const side = leaf.getAttribute('data-side');
      const box = leaf.getBoundingClientRect();
      const prose = leaf.querySelector('.nb-prose');
      if (!prose) continue;
      for (const child of prose.children) {
        const r = child.getBoundingClientRect();
        if (r.height < 1) continue;
        out.push({
          side,
          text: (child.textContent ?? '').trim().slice(0, 48),
          over: Math.round(r.bottom - box.bottom),
        });
      }
    }
    return out;
  });

const scrollers = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.nb-leaf-paper')]
      .flatMap((leaf) => [leaf, ...leaf.querySelectorAll('*')])
      .filter((el) => el.scrollHeight > el.clientHeight + 4)
      .map((el) => `${el.className} ${el.scrollHeight}>${el.clientHeight}`),
  );

const spreadText = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.nb-leaf-paper .nb-prose')]
      .map((el) => el.textContent ?? '')
      .join('\n'),
  );

/**
 * Paste `text` into the focused editor as a reader would.
 *
 * NOT `keyboard.insertText`: that is CDP `Input.insertText`, which writes
 * straight into the contenteditable, and inside a code block ProseMirror never
 * reads it back — the DOM ends up holding 1544 characters the document has
 * never heard of, so the drain measures one thing and reasons about another.
 * A real `paste` event goes through the editor's own clipboard handling, which
 * is the path a person actually uses.
 */
const pasteInto = (page, text) =>
  page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    const el =
      document.querySelector('.ProseMirror-focused') ??
      document.querySelector('.nb-prose');
    el?.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);

/**
 * Runs of empty paragraphs across every page in the book, read out of the stub
 * database. The drain used to shuttle StarterKit's trailing empty line off a
 * page sixty-four times over (it is put straight back), and every one of those
 * empty paragraphs was prepended to the FOLLOWING page and then pushed on from
 * there — junk, in the reader's own document, that nothing ever cleans up.
 */
const emptyParagraphRuns = (page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('notebook.stubdb.v1');
    const rows = raw ? (JSON.parse(raw).pages ?? []) : [];
    let worst = 0;
    for (const row of rows) {
      let doc;
      try {
        doc = JSON.parse(row.doc_json ?? '{}');
      } catch {
        continue;
      }
      let run = 0;
      for (const node of doc.content ?? []) {
        const empty =
          node?.type === 'paragraph' &&
          (node.content === undefined || node.content.length === 0);
        run = empty ? run + 1 : 0;
        if (run > worst) worst = run;
      }
    }
    return worst;
  });

/** Run one check on its own app, and never let a throw skip browser.close(). */
async function check(name, body) {
  console.log(`\n=== ${name} ===`);
  const session = await openBook();
  try {
    await body(session.page);
  } catch (error) {
    fail(`${name}: threw — ${String(error).split('\n')[0]}`);
  } finally {
    if (session.errors.length > 0) {
      console.log(`  note  page errors ${JSON.stringify([...new Set(session.errors)])}`);
    }
    await session.context.close();
  }
}

// ---------------------------------------------------------------------------
// 1 + 2 — typed lines, then the caret marker
// ---------------------------------------------------------------------------
await check('typed overflow', async (page) => {
  await blankPage(page);
  for (let i = 1; i <= 34; i += 1) {
    await page.keyboard.type(`line ${i} of the overflow torture test`);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('line 35 of the overflow torture test');
  await page.waitForTimeout(1500);

  const clipped = (await clipReport(page)).filter((b) => b.over > 2);
  if (clipped.length > 0) {
    fail(
      `typed overflow: ${clipped.length} block(s) hang below the paper — e.g. ` +
        clipped
          .slice(0, 3)
          .map((b) => `${b.side} "${b.text}" +${b.over}px`)
          .join(', '),
    );
  } else pass('typed overflow: nothing clipped below the paper');

  const s = await scrollers(page);
  if (s.length > 0) fail(`typed overflow: scrollable layers ${JSON.stringify(s)}`);
  else pass('typed overflow: no leaf layer scrolls');

  // The caret must still be at the END of "line 35", on whichever page that
  // line was carried to. Typing a marker proves where it actually is.
  await page.keyboard.type('<<MARK>>');
  await page.waitForTimeout(600);
  const marked = await page.evaluate(() => {
    const hits = [];
    for (const prose of document.querySelectorAll('.nb-prose')) {
      for (const child of prose.children) {
        const t = child.textContent ?? '';
        if (t.includes('<<MARK>>')) hits.push(t.trim());
      }
    }
    return hits;
  });
  if (marked.length === 0) {
    fail('caret carry: the marker was typed into nothing on screen');
  } else if (
    !marked.some((t) => t === 'line 35 of the overflow torture test<<MARK>>')
  ) {
    fail(`caret carry: marker landed wrong — ${JSON.stringify(marked)}`);
  } else pass('caret carry: marker appended to the end of line 35');

  await page.screenshot({ path: 'qa/ui/pagination-typed.png' });
});

// ---------------------------------------------------------------------------
// 3 — one long paragraph: the block the trailing drain may never peel
// ---------------------------------------------------------------------------
await check('one long paragraph', async (page) => {
  await blankPage(page);
  // Numbered words so the order they come back in is checkable, and not one
  // line break in the lot — the whole thing is ONE top-level block.
  const words = Array.from({ length: 420 }, (_, i) => `w${i + 1}`);
  await page.keyboard.insertText(words.join(' '));
  await page.waitForTimeout(2500);

  const clipped = (await clipReport(page)).filter((b) => b.over > 2);
  if (clipped.length > 0) {
    fail(
      `long paragraph: ${clipped[0].over}px of one block hangs below the paper ` +
        `(overflow:hidden, so the reader cannot see or reach it)`,
    );
  } else pass('long paragraph: nothing clipped below the paper');
  const s = await scrollers(page);
  if (s.length > 0) fail(`long paragraph: scrollable layers ${JSON.stringify(s)}`);
  else pass('long paragraph: no leaf layer scrolls');

  // Every word still in the book, once, in order — a split that eats or
  // reorders a word is worse than the clipping it replaced.
  const flat = (await spreadText(page)).match(/w\d+/g) ?? [];
  const expected = words.slice(0, flat.length);
  if (flat.length === 0) {
    fail('long paragraph: no words on either leaf');
  } else if (flat.join(' ') !== expected.join(' ')) {
    const at = flat.findIndex((w, i) => w !== expected[i]);
    fail(
      `long paragraph: word order broke at index ${at} — ` +
        `saw ${flat[at]}, expected ${expected[at]}`,
    );
  } else if (flat.length < 200) {
    fail(
      `long paragraph: only ${flat.length} of 420 words are on the spread; ` +
        `the rest are neither shown nor carried`,
    );
  } else pass(`long paragraph: ${flat.length}/420 words on the spread, in order`);
  await page.screenshot({ path: 'qa/ui/pagination-longpara.png' });
});

// ---------------------------------------------------------------------------
// 4 — a big paste: many blocks in one transaction, cascading across pages
// ---------------------------------------------------------------------------
await check('big paste', async (page) => {
  await blankPage(page);
  const lines = Array.from({ length: 90 }, (_, i) => `pasted line ${i + 1}`);
  await pasteInto(page, lines.join('\n'));
  await page.waitForTimeout(3000);

  const clipped = (await clipReport(page)).filter((b) => b.over > 2);
  if (clipped.length > 0) {
    fail(
      `big paste: ${clipped.length} block(s) clipped — e.g. ` +
        clipped.slice(0, 3).map((b) => `"${b.text}" +${b.over}px`).join(', '),
    );
  } else pass('big paste: nothing clipped below the paper');
  const s = await scrollers(page);
  if (s.length > 0) fail(`big paste: scrollable layers ${JSON.stringify(s)}`);
  else pass('big paste: no leaf layer scrolls');
  await page.screenshot({ path: 'qa/ui/pagination-paste.png' });
});

// ---------------------------------------------------------------------------
// 5 — a code block taller than the page: cut at newlines, never at a wrap
// ---------------------------------------------------------------------------
await check('long code block', async (page) => {
  await blankPage(page);
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  const code = Array.from({ length: 70 }, (_, i) => `const v${i + 1} = ${i + 1};`);
  await pasteInto(page, code.join('\n'));
  await page.waitForTimeout(3000);

  const clipped = (await clipReport(page)).filter((b) => b.over > 2);
  if (clipped.length > 0) {
    fail(`long code block: ${clipped[0].over}px hangs below the paper`);
  } else pass('long code block: nothing clipped below the paper');

  // Every statement whole: a cut at a soft wrap rather than at a newline would
  // leave `const v1 = ` on one page and `1;` at the top of the next.
  const text = await spreadText(page);
  const broken = code.slice(0, 20).filter((line) => !text.includes(line));
  if (broken.length > 0) {
    fail(
      `long code block: ${broken.length} statement(s) cut apart, e.g. "${broken[0]}"`,
    );
  } else pass('long code block: statements survive the page break intact');

  // The block above the trailing empty line is what has to move. Peeling that
  // empty line instead made no progress and pumped one empty paragraph per
  // pass into the next page — 64 of them, then 43 onto the page after that.
  const runs = await emptyParagraphRuns(page);
  if (runs > 2) {
    fail(`long code block: a page holds a run of ${runs} empty paragraphs`);
  } else pass(`long code block: no junk empty-paragraph runs (worst ${runs})`);
  await page.screenshot({ path: 'qa/ui/pagination-code.png' });
});

// ---------------------------------------------------------------------------
// 6 — a full page beside an open rail sheet: the book is SCALED, not reflowed
// ---------------------------------------------------------------------------
// The drain compares two distances that used to be in different pixels. Block
// bottoms come off `getBoundingClientRect` (drawn px — a scaled spread scales
// them) and the capacity is quoted in drawn px to match; the prose root's
// padding-bottom came off `getComputedStyle`, which a transform never touches.
// So with a sheet open the page charged itself a full-size foot on a shrunken
// page and peeled a line it still had room for — and the contract only ever
// peels FORWARD, so closing the sheet did not put it back. The gap is measured
// below, and the invariant asserted is the one a reader would notice: opening
// a colour picker must not move their words onto another page.
await check('full page beside an open sheet', async (page) => {
  await page.setViewportSize({ width: 960, height: 620 });
  await page.waitForTimeout(800);
  await blankPage(page);

  // Fill until one more line will not fit, asking the page itself rather than
  // guessing a line count for a window this small.
  const room = () =>
    page.evaluate(() => {
      const prose = document.querySelector('.nb-leaf-paper .nb-prose:not(:empty)')
        ?? document.querySelector('.nb-leaf-paper .nb-prose');
      if (!prose) return null;
      const rect = prose.getBoundingClientRect();
      const scale = prose.clientHeight > 0 ? rect.height / prose.clientHeight : 1;
      const style = getComputedStyle(prose);
      const padLayout = Number.parseFloat(style.paddingBottom) || 0;
      // The LAST BLOCK WITH INK, not the last element: StarterKit keeps an
      // empty trailing line below the content and the drain (rightly) reasons
      // about the page without it, so measuring to it reports a page ~a line
      // tighter than the drain believes it is.
      const inked = [...prose.children].filter(
        (el) => (el.textContent ?? '').trim().length > 0,
      );
      const last = inked[inked.length - 1]?.getBoundingClientRect();
      const paper = prose.closest('.nb-leaf-paper');
      const paperStyle = paper ? getComputedStyle(paper) : null;
      const capacity = paper
        ? (paper.clientHeight -
            (Number.parseFloat(paperStyle.paddingTop) || 0) -
            (Number.parseFloat(paperStyle.paddingBottom) || 0)) *
          scale
        : 0;
      const bottom = last ? last.bottom - rect.top : 0;
      return {
        blocks: prose.children.length,
        scale,
        padLayout,
        padDrawn: padLayout * scale,
        left: capacity - bottom - padLayout * scale,
        line: Number.parseFloat(style.lineHeight) || 32,
      };
    });

  for (let i = 0; i < 40; i += 1) {
    const state = await room();
    if (state === null || state.left < state.line) break;
    await page.keyboard.type(`fill line ${i + 1}`);
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(1200);

  const sheet = page.getByRole('button', { name: /^Customize this book/ });
  const closeSheet = page.getByRole('button', { name: 'Close Customize this book' });

  // A window HEIGHT sweep, because the leftover room on a filled page is
  // quantised to a whole line and the gap this is about is only ~12px wide, so
  // one fill level lands wherever it happens to land. Two px at a time walks
  // the room through the gap.
  //
  // Two details the first attempt got wrong, both of which made the bug pass:
  //   - the drain only runs on a TRANSACTION, so opening the sheet on its own
  //     never repaginates. What has to be driven is the reader CARRYING ON
  //     WRITING with the sheet open — one character into the page's first line,
  //     the smallest edit that cannot itself add height.
  //   - shrinking the window also legitimately shrinks the page, so the
  //     baseline has to be taken after a transaction with the sheet SHUT.
  //     Otherwise an honest repagination at the new height gets blamed on the
  //     sheet, because nothing had asked the page to reflow yet.
  const firstLineEndsWithX = () =>
    page.evaluate(() =>
      (
        document.querySelector('.nb-leaf-paper .nb-prose')?.firstElementChild
          ?.textContent ?? ''
      ).endsWith('x'),
    );

  // Retried once: the click has to land inside a page that a sheet may still
  // be sliding, and a missed click types into nothing.
  const nudge = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // Click, then End — and deliberately NOT Ctrl+Home first: that is a
      // book shortcut (jump to the first page), so it moved the spread and the
      // next measurement read a different page's block count entirely.
      await page.locator('.nb-leaf-paper .nb-prose > *').first().click();
      await page.keyboard.press('End');
      await page.keyboard.type('x');
      await page.waitForTimeout(1100);
      if (await firstLineEndsWithX()) {
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
        return true;
      }
      await page.waitForTimeout(600);
    }
    return false;
  };

  let worst = null;
  for (let height = 620; height >= 592; height -= 2) {
    await page.setViewportSize({ width: 960, height });
    await page.waitForTimeout(900);
    if (!(await nudge())) {
      fail(`full page beside a sheet: at ${height}px the keystroke never landed`);
      return;
    }
    const shut = await room();

    await sheet.click();
    await page.waitForTimeout(1300);
    await nudge();
    const open = await room();
    if (worst === null || (open && open.left < worst.left)) worst = open;
    if (shut && open && open.blocks < shut.blocks) {
      fail(
        `full page beside a sheet: at ${height}px, typing with Customize open ` +
          `peeled ${shut.blocks - open.blocks} block(s) the same keystroke left ` +
          `alone with it shut (${shut.blocks} → ${open.blocks}); ` +
          `${(open.padLayout - open.padDrawn).toFixed(1)}px of phantom foot at ` +
          `scale ${open.scale.toFixed(3)}`,
      );
      await page.screenshot({ path: 'qa/ui/pagination-panel.png' });
      return;
    }
    await closeSheet.click();
    await page.waitForTimeout(900);
  }

  console.log(
    `  note  scale ${worst?.scale.toFixed(3)}, padding layout ${worst?.padLayout}px ` +
      `vs drawn ${worst?.padDrawn.toFixed(1)}px — ` +
      `${(worst ? worst.padLayout - worst.padDrawn : 0).toFixed(1)}px of phantom foot; ` +
      `tightest page swept had ${worst?.left.toFixed(1)}px to spare`,
  );
  pass('full page beside a sheet: no block moved at any window height swept');
  await page.screenshot({ path: 'qa/ui/pagination-panel.png' });
});

await browser.close();
console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`);
process.exit(failures.length === 0 ? 0 : 1);
