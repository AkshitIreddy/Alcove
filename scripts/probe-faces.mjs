/**
 * scripts/probe-faces.mjs — the hand a page is written in, and the hand a
 * SELECTION is written in, both asserted on the APPLIED state.
 *
 * Two questions, and neither can be answered by reading the source:
 *
 *   1. THE DEFAULT. What face does a paragraph actually resolve to when a
 *      reader types into a page — not what `--font-body` says, what the
 *      paragraph's computed style says.
 *   2. THE PER-RUN FACE. Can a reader reach it by CLICKING (nothing here calls
 *      `setFace`), does it survive a save and a full reload, and does the
 *      13px/20px legibility floor bite in a context small enough to need it.
 *
 * Everything is driven through real input — keyboard for the selection, mouse
 * for the toolbar and for the right-click menu — because "authored but
 * unreachable" is the failure this repo has shipped eight times, and a probe
 * that calls the command itself would prove the command and nothing else.
 * Both surfaces are exercised: the selection toolbar's faces tray sets a RUN,
 * the block menu's Handwriting submenu sets a whole paragraph.
 *
 * Usage: node scripts/probe-faces.mjs [--url=http://localhost:1420]
 * Writes: qa/ui/faces-01-typed.png … faces-05-blockmenu.png
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

/** The two hands the probe asks for, and what each one has to prove. */
const FIRST_HAND = 'Caveat'; // signature tier, floorPx 20 — the floor case
const SECOND_HAND = 'Gochi Hand'; // signature tier, no floor — the plain case
const SENTENCE = 'The quick brown fox jumps over the lazy dog.';

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console-err]', m.text().slice(0, 160));
});

/** Boot the shelf and wait for the world, the way every other probe does. */
async function boot() {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    polling: 400,
  });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, {
    polling: 400,
  });
  // The tour card is modal and sits over the spread; a probe is not the reader
  // it was written for.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (/tour|tutorial|onboard/i.test(key)) localStorage.removeItem(key);
    }
  });
}

async function openBook(bookId) {
  await page.evaluate(async (id) => {
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
  }, bookId);
  await page.waitForSelector('.nb-prose', { timeout: 60000 });
  // BOTH halves of the spread, and then a beat.
  //
  // The right-hand page mounts its own editor a moment after the left one, and
  // a ProseMirror view taking focus as it mounts blurs the one being typed in
  // — which tears the selection toolbar down mid-probe. That is the app
  // behaving as it does, not a flake to retry around, so the probe waits for
  // the spread to stop arriving before it touches anything.
  await page.waitForFunction(
    () => {
      const now = document.querySelectorAll('.nb-prose').length;
      const was = globalThis.__proseSettle ?? -1;
      globalThis.__proseSettle = now;
      return now > 0 && now === was;
    },
    null,
    { polling: 700, timeout: 60000 },
  );
  await page.waitForTimeout(1200);
  // Anything modal that arrived with the book (the tour) gets dismissed by the
  // same key a reader would press.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/** The first editable paragraph on the left page. */
const PROSE = '.nb-prose';
/**
 * The toolbar that is showing.
 *
 * There is one plugin view per mounted PageEditor and a spread mounts two, so
 * an unscoped `.nb-seltool-…` selector is ambiguous the moment the right-hand
 * page has an editor on it. Only one portal ever carries `is-up`.
 */
const UP = '.nb-seltool-portal.is-up';

console.log('\n=== probe-faces ===\n');
await boot();

/* -------------------------------------------------------------------------
   A book of our own, so the probe never writes into the reader's Welcome.
   ------------------------------------------------------------------------- */
const bookId = await page.evaluate(async () => {
  const books = await import('/src/data/books.ts');
  const book = await books.createBook({ title: 'Face probe', floor: 3, slot: 0 });
  return book.id;
});
console.log(`[book] ${bookId}`);
await openBook(bookId);

/* -------------------------------------------------------------------------
   1. The default — what a paragraph is ACTUALLY written in.
   ------------------------------------------------------------------------- */
console.log('\n1. the default face');

/*
 * A real mouse press at real coordinates, rather than `page.click(PROSE)`.
 *
 * The spread is a transformed, animated surface; Playwright's actionability
 * check waits for the element to be "stable" and the left page never quite is.
 * The press below is the same two events a reader's click sends.
 */
const proseBox = await page.locator(PROSE).first().boundingBox();
await page.mouse.click(proseBox.x + 80, proseBox.y + 18);
await page.waitForTimeout(300);
await page.keyboard.type(SENTENCE, { delay: 8 });
await page.waitForTimeout(500);

const dflt = await page.evaluate(() => {
  const p = document.querySelector('.nb-prose p');
  const root = getComputedStyle(document.documentElement);
  const cs = p === null ? null : getComputedStyle(p);
  return {
    text: p?.textContent ?? '',
    family: cs?.fontFamily ?? '',
    size: cs?.fontSize ?? '',
    fontBody: root.getPropertyValue('--font-body').trim(),
    // A face that is DECLARED and not LOADED draws as the next thing down the
    // stack, which is the one way "it says Patrick Hand" can still be wrong.
    loaded: document.fonts.check(`20px "Patrick Hand"`),
  };
});
check(dflt.text.includes('quick brown fox'), 'the sentence reached the page', dflt.text.slice(0, 50));
check(/Patrick Hand/.test(dflt.family), 'body is a handwriting face', dflt.family);
check(dflt.loaded === true, 'that face is really loaded, not just named');
check(parseFloat(dflt.size) >= 13, 'and set above the 13px handwriting floor', dflt.size);
await page.screenshot({ path: 'qa/ui/faces-01-typed.png' });

/* -------------------------------------------------------------------------
   2. Two runs, two faces — by clicking, and nothing else.
   ------------------------------------------------------------------------- */
console.log('\n2. two runs, two faces, by clicking');

/**
 * Put the caret at `from` characters into the paragraph and select `len`.
 *
 * Keyboard only after the first click. A pointer press inside the prose is
 * what the toolbar treats as "a selection is being dragged" — it hides for the
 * duration and comes back a frame after `pointerup`, and rAF is throttled
 * under SwiftShader, so clicking before every selection is a race the probe
 * would lose intermittently rather than a step it needs.
 */
async function selectRun(from, len) {
  await page.keyboard.press('Home');
  for (let i = 0; i < from; i += 1) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < len; i += 1) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(500);
}

/** Open the faces tray from the toolbar and press one chip. */
async function pickFace(hand) {
  // The PORTAL is a 0×0 box holding a fixed-position card, so "visible" has to
  // be asked of the card. Waiting on the portal times out even when the
  // toolbar is plainly up.
  await page.waitForFunction(
    () => document.querySelectorAll('.nb-seltool-portal.is-up').length === 1,
    null,
    { polling: 200, timeout: 20000 },
  );
  await page.click(`${UP} .nb-seltool-btn[data-action="face"]`);
  await page.waitForSelector(`${UP} .nb-seltool-faces`, { timeout: 20000 });
  const chip = `${UP} .nb-seltool-face[data-hand="${hand}"]`;
  if ((await page.locator(chip).count()) === 0) {
    // Not in the shortlist — the reader would press "N more…" and so do we.
    await page.click(`${UP} .nb-seltool-more`);
    await page.waitForSelector(`${UP} .nb-seltool-faceall`, { timeout: 20000 });
  }
  await page.click(chip);
  await page.waitForTimeout(400);
}

// "quick brown" — characters 4..15 of the sentence.
await selectRun(4, 11);
// One toolbar per mounted PageEditor — a spread has two pages, so the count
// is "at least one", never exactly one. Every press below is scoped to the
// portal that is actually up.
const beforeTray = await page.locator('.nb-seltool-btn[data-action="face"]').count();
check(beforeTray >= 1, 'the toolbar carries a handwriting button', `${beforeTray} mounted`);
await pickFace(FIRST_HAND);
await page.screenshot({ path: 'qa/ui/faces-02-first.png' });

// "lazy dog" — characters 35..43.
await selectRun(35, 8);
await pickFace(SECOND_HAND);
// The tray stays open after a pick (choosing two hands in a row is one act),
// so this picture shows the control the reader said they could not find.
await page.waitForTimeout(400);
await page.screenshot({ path: 'qa/ui/faces-03-tray.png' });

// …and the whole shelf behind the "N more…" control, every chip drawn in the
// face it names.
await page.click(`${UP} .nb-seltool-more`);
await page.waitForSelector(`${UP} .nb-seltool-faceall`, { timeout: 20000 });
await page.waitForTimeout(500);
const shelf = await page.evaluate(() => ({
  chips: document.querySelectorAll('.nb-seltool-faceall .nb-seltool-face').length,
  shelves: [...document.querySelectorAll('.nb-seltool-faceshelf')].map((el) => el.textContent),
  // A chip drawn smaller than the house floor is the thing this must never do.
  tooSmall: [...document.querySelectorAll('.nb-seltool-face')].filter(
    (el) => !el.classList.contains('is-clear') &&
      parseFloat(getComputedStyle(el).fontSize) < 13,
  ).length,
  // …and two chips drawing the same letters would be a name that lies.
  distinct: new Set(
    [...document.querySelectorAll('.nb-seltool-faceall .nb-seltool-face')].map(
      (el) => getComputedStyle(el).fontFamily,
    ),
  ).size,
}));
console.log('   shelf:', JSON.stringify(shelf));
check(shelf.chips >= 9, 'the full shelf offers every bundled hand at least', `${shelf.chips}`);
check(shelf.shelves.length >= 2, 'grouped under family headings', shelf.shelves.join(' | '));
check(shelf.tooSmall === 0, 'no chip is drawn below the 13px handwriting floor');
check(shelf.distinct === shelf.chips, 'every chip draws a different face', `${shelf.distinct}/${shelf.chips}`);
await page.screenshot({ path: 'qa/ui/faces-03b-all.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

const applied = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.nb-prose span.nb-face')];
  return spans.map((el) => ({
    hand: el.getAttribute('data-hand'),
    text: el.textContent,
    family: getComputedStyle(el).fontFamily,
    size: getComputedStyle(el).fontSize,
  }));
});
console.log('   applied:', JSON.stringify(applied));
check(applied.length === 2, 'exactly two runs carry a face', `${applied.length}`);
check(
  applied[0]?.hand === FIRST_HAND && applied[1]?.hand === SECOND_HAND,
  'each run carries the hand it was given',
  applied.map((a) => a.hand).join(' / '),
);
check(
  applied[0]?.family !== applied[1]?.family,
  'the two runs really draw in different faces',
  applied.map((a) => a.family.split(',')[0]).join(' vs '),
);
check(
  new Set(applied.map((a) => a.family)).size === 2 &&
    !applied.some((a) => /Patrick Hand/.test(a.family)),
  'and neither of them is the page default',
);

/* -------------------------------------------------------------------------
   3. It is in the document, not in the DOM.
   ------------------------------------------------------------------------- */
console.log('\n3. the mark is part of the stored document');

await page.waitForTimeout(1400); // the 400ms autosave debounce, generously
const stored = await page.evaluate(async (id) => {
  const pages = await import('/src/data/pages.ts');
  const list = await pages.listPages(id);
  const first = list[0];
  if (first === undefined) return null;
  const doc = (await pages.getPage(first.id))?.doc ?? null;
  const marks = [];
  const walk = (node) => {
    for (const mark of node.marks ?? []) {
      if (mark.type === 'face') marks.push({ hand: mark.attrs?.hand, text: node.text });
    }
    for (const child of node.content ?? []) walk(child);
  };
  if (doc !== null) walk(doc);
  return { marks, json: JSON.stringify(doc).slice(0, 0) };
}, bookId);
console.log('   stored:', JSON.stringify(stored?.marks ?? null));
check(
  (stored?.marks.length ?? 0) === 2,
  'the doc JSON carries two face marks',
  `${stored?.marks.length ?? 0}`,
);
check(
  stored?.marks.every((m) => typeof m.hand === 'string' && m.hand !== '') === true,
  'each one stores a hand ID, not a CSS stack',
  (stored?.marks ?? []).map((m) => m.hand).join(' / '),
);

/* -------------------------------------------------------------------------
   4. The legibility floor, measured against the real stylesheet.
   ------------------------------------------------------------------------- */
console.log('\n4. the floor CLAUDE.md states');

const floor = await page.evaluate(async () => {
  const { faceFloorPx, faceStyleAttr } = await import('/src/editor/marks/face.ts');
  const host = document.querySelector('.nb-prose');
  if (host === null) return null;
  // A context small enough for the floor to matter: a footnote entry is 15px.
  const small = document.createElement('p');
  small.style.fontSize = '15px';
  const span = document.createElement('span');
  span.className = 'nb-face';
  span.setAttribute('data-hand', 'Caveat');
  span.setAttribute('style', faceStyleAttr('Caveat') ?? '');
  span.textContent = 'a note at the foot of the page';
  small.appendChild(span);
  host.appendChild(small);
  const drawn = parseFloat(getComputedStyle(span).fontSize);
  const family = getComputedStyle(span).fontFamily;
  host.removeChild(small);
  return { drawn, want: faceFloorPx('Caveat'), family, context: 15 };
});
console.log('   floor:', JSON.stringify(floor));
check(
  floor !== null && floor.drawn >= floor.want,
  `a ${floor?.want ?? '?'}px face dropped into 15px text is not drawn at 15px`,
  `${floor?.drawn ?? '?'}px`,
);
check(
  floor !== null && floor.drawn >= 13,
  'no handwriting face renders below the 13px house floor',
);

/* -------------------------------------------------------------------------
   5. A full reload — the only proof that survives a restart.
   ------------------------------------------------------------------------- */
console.log('\n5. after a full reload');

await boot();
await openBook(bookId);

const after = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.nb-prose span.nb-face')];
  const p = document.querySelector('.nb-prose p');
  return {
    para: p === null ? '' : getComputedStyle(p).fontFamily,
    spans: spans.map((el) => ({
      hand: el.getAttribute('data-hand'),
      text: el.textContent,
      family: getComputedStyle(el).fontFamily,
    })),
  };
});
console.log('   after reload:', JSON.stringify(after));
check(after.spans.length === 2, 'both runs came back', `${after.spans.length}`);
check(
  after.spans[0]?.hand === FIRST_HAND && after.spans[1]?.hand === SECOND_HAND,
  'wearing the same two hands',
  after.spans.map((s) => s.hand).join(' / '),
);
check(
  after.spans[0]?.family !== after.spans[1]?.family,
  'and still drawing as two different faces',
);
check(/Patrick Hand/.test(after.para), 'the page around them is still the house hand');
await page.screenshot({ path: 'qa/ui/faces-04-reloaded.png' });

/* -------------------------------------------------------------------------
   6. The other way in — the right-click menu's Handwriting submenu, which
   sets the hand for a WHOLE block.

   On the right-hand page, and last, so nothing above is disturbed: two
   surfaces reading one hand table is the point, and a submenu nobody can
   reach is the failure this repo keeps shipping.
   ------------------------------------------------------------------------- */
console.log('\n6. the right-click menu sets a whole block');

const rightBox = await page.locator(PROSE).nth(1).boundingBox();
await page.mouse.click(rightBox.x + 80, rightBox.y + 18);
await page.waitForTimeout(300);
await page.keyboard.type('A whole line in another hand.', { delay: 8 });
await page.waitForTimeout(400);
await page.keyboard.press('Escape');

await page.mouse.click(rightBox.x + 120, rightBox.y + 18, { button: 'right' });
await page.waitForSelector('.nb-ctx-menu', { timeout: 20000 });
// The submenu is rendered only while its parent row is open, so it has to be
// hovered exactly the way a hand would.
await page.hover('.nb-ctx-parent[data-ctx-id="lettering"]');
await page.waitForSelector('.nb-ctx-sub', { timeout: 20000 });
const ctx = await page.evaluate(() => {
  const parent = document.querySelector('.nb-ctx-parent[data-ctx-id="lettering"]');
  const sub = parent?.parentElement?.querySelector('.nb-ctx-sub') ?? null;
  return {
    found: parent !== null,
    hands: [...(sub?.querySelectorAll('.nb-ctx-item') ?? [])].map((el) =>
      (el.textContent ?? '').trim(),
    ),
  };
});
console.log('   ctx:', JSON.stringify(ctx));
check(ctx.found, 'the block menu has a Handwriting submenu');
check(ctx.hands.length >= 4, 'with hands in it', ctx.hands.join(' | '));
check(
  ctx.hands.some((h) => h.toLowerCase().includes('page')),
  'and a way back to the page’s own hand',
);

// Press one, and check the whole paragraph took it.
await page.click('.nb-ctx-sub .nb-ctx-item:has-text("quick note")');
await page.waitForTimeout(600);
const block = await page.evaluate(() => {
  const paras = [...document.querySelectorAll('.nb-prose p')];
  const target = paras.find((p) => (p.textContent ?? '').includes('another hand')) ?? null;
  const span = target?.querySelector('span.nb-face') ?? null;
  return {
    text: target?.textContent ?? '',
    hand: span?.getAttribute('data-hand') ?? null,
    covers: (span?.textContent ?? '').length === (target?.textContent ?? '').length,
    family: span === null ? '' : getComputedStyle(span).fontFamily,
  };
});
console.log('   block:', JSON.stringify(block));
check(block.hand === 'Caveat', 'the whole block took the hand that was pressed', `${block.hand}`);
check(block.covers, 'and it covers the whole line', block.text);
check(/Caveat/.test(block.family), 'drawing in that face', block.family);
await page.screenshot({ path: 'qa/ui/faces-05-blockmenu.png' });

/* -------------------------------------------------------------------------
   Tidy up: the probe's book does not belong in the reader's library.
   ------------------------------------------------------------------------- */
await page.evaluate(async (id) => {
  const books = await import('/src/data/books.ts');
  await books.deleteBook(id);
}, bookId);

await browser.close();
console.log(
  `\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}  ` +
    'shots: qa/ui/faces-01-typed.png … faces-05-blockmenu.png\n',
);
process.exit(failures === 0 ? 0 : 1);
