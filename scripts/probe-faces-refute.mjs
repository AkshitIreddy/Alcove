/**
 * scripts/probe-faces-refute.mjs — an ADVERSARIAL probe of the `face` mark.
 *
 * `probe-faces.mjs` proves the happy path: a reader clicks a chip and the words
 * change hand. This one goes after the four claims that probe does NOT test,
 * every one of them stated in `src/editor/marks/face.ts`'s own header:
 *
 *   A. "an id the table does not know parses to nothing" — a `data-hand` the
 *      app has never heard of, arriving by PASTE, must not become a mark.
 *   B. "…and the run reads in the page's own hand rather than resolving to
 *      Patrick Hand". A doc written by some other version of the app carries
 *      an unknown id in the JSON, where `parseHTML` never sees it. The run must
 *      then follow whatever hand the PAGE is set in — which is only
 *      distinguishable from "hardcoded Patrick Hand" when the page is NOT set
 *      in Patrick Hand. So the app's own hand is changed first.
 *   C. "a system face re-resolves down its own fallback chain" — the stored
 *      attribute is an id and the DOM stack is rebuilt from `appearance.ts` at
 *      render time, so a doc round-tripped through HTML keeps the id.
 *   D. "`extensions.ts` passes `fontFamily: false` and this mark is the only
 *      way in" — a paste out of a word processor carrying a raw
 *      `font-family` + a 4px `font-size` must land as neither.
 *
 * Plus the rule CLAUDE.md states outright: every one of the 27 hands, dropped
 * into a context small enough to break it, still draws at 13px or more.
 *
 * Usage: node scripts/probe-faces-refute.mjs [--url=http://localhost:1420]
 * Writes: qa/ui/refute-faces-*.png
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

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

async function boot() {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
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
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/** Put HTML on the clipboard and paste it where the caret is — the real path. */
async function pasteHtml(html) {
  await page.evaluate((markup) => {
    const el = document.querySelector('.nb-prose');
    const dt = new DataTransfer();
    dt.setData('text/html', markup);
    dt.setData('text/plain', new DOMParser().parseFromString(markup, 'text/html').body.textContent);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, html);
  await page.waitForTimeout(600);
}

console.log('\n=== probe-faces-refute ===\n');
await boot();

const bookId = await page.evaluate(async () => {
  const books = await import('/src/data/books.ts');
  const book = await books.createBook({ title: 'Face refute', floor: 4, slot: 0 });
  return book.id;
});
console.log(`[book] ${bookId}`);
await openBook(bookId);

const proseBox = await page.locator('.nb-prose').first().boundingBox();
await page.mouse.click(proseBox.x + 80, proseBox.y + 18);
await page.waitForTimeout(300);

/* ---------------------------------------------------------------------------
   A. A face id the table has never heard of, arriving by PASTE.
   --------------------------------------------------------------------------- */
console.log('\nA. an unknown data-hand pasted in');

await pasteHtml(
  '<p>alpha <span data-hand="Wingdings Deluxe" style="--nb-face: Impact; --nb-face-floor: 4px">bravo</span> charlie</p>',
);

const pasted = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.nb-prose p')].find((el) =>
    (el.textContent ?? '').includes('bravo'),
  );
  const span = p?.querySelector('span.nb-face') ?? null;
  const word = p === null ? null : [...p.childNodes].map((n) => n.textContent).join('');
  return {
    text: word,
    faceSpans: p === null ? -1 : p.querySelectorAll('span.nb-face').length,
    anyHand: p === null ? null : (p.querySelector('[data-hand]')?.getAttribute('data-hand') ?? null),
    spanFamily: span === null ? null : getComputedStyle(span).fontFamily,
    paraFamily: p === null ? null : getComputedStyle(p).fontFamily,
  };
});
console.log('   pasted:', JSON.stringify(pasted));
check(pasted.text !== null && pasted.text.includes('bravo'), 'the words survived the paste', pasted.text ?? '');
check(pasted.faceSpans === 0, 'no face mark was created from the unknown id', `${pasted.faceSpans} span(s)`);
check(pasted.anyHand === null, 'and nothing carries a data-hand', String(pasted.anyHand));

/* ---------------------------------------------------------------------------
   D. A paste out of a word processor: a raw family and an illegible size.
   --------------------------------------------------------------------------- */
console.log('\nD. a raw font-family + 4px pasted in (fontFamily: false)');

await pasteHtml(
  '<p><span style="font-family: Impact, fantasy; font-size: 4px">smuggled</span></p>',
);

const smuggled = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.nb-prose p')].find((el) =>
    (el.textContent ?? '').includes('smuggled'),
  );
  const inner = p?.querySelector('span') ?? p ?? null;
  const cs = inner === null ? null : getComputedStyle(inner);
  return {
    text: p?.textContent ?? '',
    family: cs?.fontFamily ?? '',
    size: cs?.fontSize ?? '',
    inlineStyle: inner instanceof HTMLElement ? inner.getAttribute('style') : null,
  };
});
console.log('   smuggled:', JSON.stringify(smuggled));
check(smuggled.text.includes('smuggled'), 'the words arrived');
check(!/Impact/i.test(smuggled.family), 'the raw font-family did not come with them', smuggled.family);
check(parseFloat(smuggled.size) >= 13, 'and nothing landed below 13px', smuggled.size);

/* ---------------------------------------------------------------------------
   C. A known id round-trips through HTML: paste it back out of the DOM.
   --------------------------------------------------------------------------- */
console.log('\nC. a KNOWN id pasted in still resolves from the table');

await pasteHtml('<p>round <span data-hand="Gochi Hand">trip</span> back</p>');

const round = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.nb-prose p')].find((el) =>
    (el.textContent ?? '').includes('round'),
  );
  const span = p?.querySelector('span.nb-face') ?? null;
  return {
    hand: span?.getAttribute('data-hand') ?? null,
    style: span instanceof HTMLElement ? span.getAttribute('style') : null,
    family: span === null ? '' : getComputedStyle(span).fontFamily,
    size: span === null ? '' : getComputedStyle(span).fontSize,
    text: span?.textContent ?? '',
  };
});
console.log('   round:', JSON.stringify(round));
check(round.hand === 'Gochi Hand', 'the mark came back as an id', String(round.hand));
check(/Gochi Hand/.test(round.family), 'drawn in that face', round.family);
check(
  round.style !== null && round.style.includes('--nb-face') && !/font-family/i.test(round.style),
  'through custom properties, not a literal font-family',
  String(round.style),
);
await page.screenshot({ path: 'qa/ui/refute-faces-01-pastes.png' });

/* ---------------------------------------------------------------------------
   The floor: every one of the 27 hands, in a 9px context, inside real prose.
   --------------------------------------------------------------------------- */
console.log('\nE. the 13px floor, every hand, in a 9px context');

const floors = await page.evaluate(async () => {
  const { HANDS } = await import('/src/features/settings/appearance.ts');
  const { faceStyleAttr } = await import('/src/editor/marks/face.ts');
  const host = document.querySelector('.nb-prose');
  const holder = document.createElement('p');
  holder.style.fontSize = '9px';
  host.appendChild(holder);
  const out = [];
  for (const spec of HANDS) {
    const span = document.createElement('span');
    span.className = 'nb-face';
    span.setAttribute('data-hand', spec.id);
    span.setAttribute('style', faceStyleAttr(spec.id) ?? '');
    span.textContent = spec.label;
    holder.appendChild(span);
    out.push({ id: spec.id, px: parseFloat(getComputedStyle(span).fontSize) });
    holder.removeChild(span);
  }
  host.removeChild(holder);
  return out;
});
const under = floors.filter((f) => f.px < 13);
console.log(`   sizes: ${floors.length} hands, min ${Math.min(...floors.map((f) => f.px))}px`);
check(floors.length === 27, 'the table really holds 27 hands', `${floors.length}`);
check(under.length === 0, 'none of them draws below 13px in a 9px context', under.map((f) => `${f.id}=${f.px}`).join(', '));

/* ---------------------------------------------------------------------------
   B. An unknown id in the STORED JSON, where parseHTML never sees it —
   and a page NOT written in Patrick Hand, so "the page's own hand" and
   "hardcoded Patrick Hand" are two different answers.
   --------------------------------------------------------------------------- */
console.log('\nB. an unknown id in the doc JSON, on a page set in Kalam');

const pageId = await page.evaluate(async (id) => {
  const pages = await import('/src/data/pages.ts');
  const list = await pages.listPages(id);
  const target = list[0];
  await pages.savePageDoc(target.id, {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'plain here ' },
          {
            type: 'text',
            text: 'ghosthand',
            marks: [{ type: 'face', attrs: { hand: 'Wingdings Deluxe' } }],
          },
          { type: 'text', text: ' and ' },
          {
            type: 'text',
            text: 'realhand',
            marks: [{ type: 'face', attrs: { hand: 'Gochi Hand' } }],
          },
        ],
      },
    ],
  });
  return target.id;
}, bookId);
console.log(`   page ${pageId} rewritten`);

// The app's own hand, changed the way the settings sheet changes it.
await page.evaluate(async () => {
  const settings = await import('/src/data/settings.ts');
  await settings.save({ handwritingFont: 'Kalam' });
});
await page.waitForTimeout(600);

await boot();
await page.evaluate(async () => {
  const settings = await import('/src/data/settings.ts');
  await settings.load();
});
await page.waitForTimeout(600);
await openBook(bookId);

const ghost = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.nb-prose p')].find((el) =>
    (el.textContent ?? '').includes('ghosthand'),
  );
  if (p === undefined) return null;
  const spans = [...p.querySelectorAll('span.nb-face')];
  const find = (word) => spans.find((el) => (el.textContent ?? '').includes(word)) ?? null;
  const g = find('ghosthand');
  const r = find('realhand');
  const read = (el) =>
    el === null
      ? null
      : {
          hand: el.getAttribute('data-hand'),
          style: el.getAttribute('style'),
          family: getComputedStyle(el).fontFamily,
          size: getComputedStyle(el).fontSize,
        };
  return {
    text: p.textContent,
    bodyVar: getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim(),
    para: { family: getComputedStyle(p).fontFamily, size: getComputedStyle(p).fontSize },
    ghost: read(g),
    real: read(r),
    spanCount: spans.length,
  };
});
console.log('   ghost:', JSON.stringify(ghost));
check(ghost !== null && ghost.text.includes('ghosthand'), 'the run with the unknown id still shows its words');
check(/Kalam/.test(ghost?.bodyVar ?? ''), 'the page is now written in Kalam, not the house hand', ghost?.bodyVar ?? '');
check(/Kalam/.test(ghost?.para.family ?? ''), 'and the paragraph really draws in it', ghost?.para.family ?? '');
check(
  ghost?.ghost === null || ghost?.ghost.hand === null,
  'the unknown id emitted no data-hand',
  String(ghost?.ghost?.hand),
);
check(
  ghost?.ghost === null || !/Patrick Hand/.test(ghost.ghost.family),
  'it did NOT silently resolve to Patrick Hand',
  ghost?.ghost?.family ?? '(no span)',
);
check(
  ghost?.ghost === null || ghost.ghost.family === ghost.para.family,
  'it reads in the page’s own hand',
  `${ghost?.ghost?.family ?? '(no span)'} vs ${ghost?.para.family ?? ''}`,
);
check(
  ghost?.ghost === null || parseFloat(ghost.ghost.size) >= 13,
  'and still above the 13px floor',
  ghost?.ghost?.size ?? '(no span)',
);
check(
  /Gochi Hand/.test(ghost?.real?.family ?? ''),
  'while the KNOWN id beside it kept its own face across the hand change',
  ghost?.real?.family ?? '(none)',
);
await page.screenshot({ path: 'qa/ui/refute-faces-02-ghost.png' });

/* Put the reader's hand back the way it was. */
await page.evaluate(async () => {
  const settings = await import('/src/data/settings.ts');
  await settings.save({ handwritingFont: 'Patrick Hand' });
});
await page.evaluate(async (id) => {
  const books = await import('/src/data/books.ts');
  await books.deleteBook(id);
}, bookId);

await browser.close();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
