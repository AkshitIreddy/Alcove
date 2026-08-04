/**
 * scripts/probe-fontfamily-off.mjs — REVIEW probe for the claim that TipTap's
 * own FontFamily is switched off.
 *
 * The claim under test:
 *
 *   "TextStyleKit.configure({ fontFamily: false }) in extensions.ts. It writes
 *    a raw stack into an inline `style`, from anywhere, at any size … and it is
 *    how a paste out of a word processor lands an unoffered face at an
 *    unreadable size. Nothing in src/ ever called setFontFamily, so no stored
 *    page loses anything; setColor (the ink rows) is untouched."
 *
 * The stated proof (scripts/probe-faces.mjs) never pastes anything, so the
 * paste half of the claim is unproven by it. This probe drives the RUNNING app
 * and asserts on the APPLIED state:
 *
 *   1. a word-processor paste carrying `font-family` lands NO face — the run
 *      still computes to the page's own hand;
 *   2. the stored doc JSON carries no `fontFamily` anywhere;
 *   3. `setColor` really is untouched — the same paste's `color` DOES land,
 *      which is the control that proves the kit is still on;
 *   4. what the paste's `font-size` does, measured — the size half of the
 *      claim, which `fontFamily: false` does not touch.
 *
 * Usage: node scripts/probe-fontfamily-off.mjs [--url=http://localhost:1420]
 * Writes: qa/ui/ff-01-pasted.png, qa/ui/ff-02-reloaded.png
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

const SMUGGLED = 'smuggledface';
/** Exactly what Word/Google Docs puts on the clipboard: a styled span. */
const PASTE_HTML =
  `<meta charset="utf-8"><span style="font-family:'Comic Sans MS',cursive;` +
  `font-size:7px;color:rgb(200,30,30)">${SMUGGLED}</span>`;

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};
const note = (what, detail) => console.log(`  ..   ${what} — ${detail}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));

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

console.log('\n=== probe-fontfamily-off ===\n');
await boot();

const bookId = await page.evaluate(async () => {
  const books = await import('/src/data/books.ts');
  const book = await books.createBook({ title: 'FontFamily probe', floor: 4, slot: 0 });
  return book.id;
});
console.log(`[book] ${bookId}`);
await openBook(bookId);

/* ---------------------------------------------------------------------------
   0. Type a line so the paste has somewhere to land.
   --------------------------------------------------------------------------- */
const proseBox = await page.locator('.nb-prose').first().boundingBox();
await page.mouse.click(proseBox.x + 80, proseBox.y + 18);
await page.waitForTimeout(300);
await page.keyboard.type('Pasted from a word processor: ', { delay: 8 });
await page.waitForTimeout(400);

/* ---------------------------------------------------------------------------
   1. The paste. A real `paste` event with real clipboardData, dispatched at
      the focused ProseMirror element — the same event Chromium delivers when a
      reader presses Ctrl+V, so ProseMirror's own clipboard parser runs.
   --------------------------------------------------------------------------- */
console.log('1. a word-processor paste');
const dispatched = await page.evaluate((html) => {
  const active = document.activeElement;
  const target =
    active !== null && active.classList?.contains('ProseMirror')
      ? active
      : document.querySelector('.nb-prose');
  if (target === null) return 'no editor';
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  dt.setData('text/plain', 'smuggledface');
  const ev = new ClipboardEvent('paste', {
    clipboardData: dt,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(ev);
  return 'sent';
}, PASTE_HTML);
check(dispatched === 'sent', 'the paste event reached the editor', dispatched);
await page.waitForTimeout(900);

const pasted = await page.evaluate((word) => {
  const walkText = (root) => {
    const spans = [...root.querySelectorAll('span')];
    return spans.find((el) => (el.textContent ?? '').includes(word)) ?? null;
  };
  const prose = document.querySelector('.nb-prose');
  const para = [...(prose?.querySelectorAll('p') ?? [])].find((p) =>
    (p.textContent ?? '').includes(word),
  );
  const span = prose === null ? null : walkText(prose);
  const paraCS = para === undefined ? null : getComputedStyle(para);
  const cs = span === null ? null : getComputedStyle(span);
  return {
    landed: para !== undefined,
    paraText: para?.textContent ?? '',
    spanFound: span !== null,
    inlineStyle: span?.getAttribute('style') ?? null,
    outerHTML: span?.outerHTML?.slice(0, 300) ?? null,
    spanFamily: cs?.fontFamily ?? null,
    spanSize: cs?.fontSize ?? null,
    spanColor: cs?.color ?? null,
    paraFamily: paraCS?.fontFamily ?? null,
    paraSize: paraCS?.fontSize ?? null,
    // Is Comic Sans even installed here? If it is not, "it did not draw in
    // Comic Sans" would be meaningless — the inline style attribute is the
    // real assertion, this is only context.
    comicInstalled: document.fonts.check('16px "Comic Sans MS"'),
  };
}, SMUGGLED);
console.log('   pasted:', JSON.stringify(pasted));

check(pasted.landed, 'the pasted word is on the page', pasted.paraText.slice(0, 60));
check(
  pasted.inlineStyle === null || !/font-family/i.test(pasted.inlineStyle),
  'NO raw font-family survived into the inline style',
  String(pasted.inlineStyle),
);
check(
  pasted.spanFamily === null || pasted.spanFamily === pasted.paraFamily,
  'the pasted run computes to the page’s own hand, not an unoffered face',
  `${pasted.spanFamily} vs para ${pasted.paraFamily}`,
);
check(
  pasted.spanFamily === null || !/Comic Sans/i.test(pasted.spanFamily),
  'and specifically not Comic Sans',
  String(pasted.spanFamily),
);
// The control: the kit is still on, so `color` — what the ink rows write — is
// still parsed off the same span. If this fails, `fontFamily: false` took the
// whole kit down with it and the claim is wrong in the other direction.
check(
  pasted.spanColor !== null && /200,\s*30,\s*30/.test(pasted.spanColor),
  'setColor is untouched — the same paste’s colour DID land',
  String(pasted.spanColor),
);
// The size half of the claim, measured rather than asserted.
note('pasted run font-size', `${pasted.spanSize} (paragraph is ${pasted.paraSize})`);
note('Comic Sans MS installed on this machine', String(pasted.comicInstalled));
if (pasted.spanSize !== null && parseFloat(pasted.spanSize) < 13) {
  note(
    'NOTE',
    `the paste still set ${pasted.spanSize} on a handwriting body face — ` +
      'fontFamily:false does not close the SIZE half',
  );
}
await page.screenshot({ path: 'qa/ui/ff-01-pasted.png' });

/* ---------------------------------------------------------------------------
   2. The stored document.
   --------------------------------------------------------------------------- */
console.log('\n2. the stored doc JSON');
await page.waitForTimeout(1500); // autosave debounce
const stored = await page.evaluate(async (id) => {
  const pages = await import('/src/data/pages.ts');
  const list = await pages.listPages(id);
  const first = list[0];
  if (first === undefined) return null;
  const doc = (await pages.getPage(first.id))?.doc ?? null;
  const raw = JSON.stringify(doc ?? {});
  const attrs = [];
  const walk = (node) => {
    for (const mark of node.marks ?? []) attrs.push({ type: mark.type, attrs: mark.attrs });
    for (const child of node.content ?? []) walk(child);
  };
  if (doc !== null) walk(doc);
  return {
    hasFontFamilyKey: /"fontFamily"/.test(raw),
    hasComic: /Comic Sans/i.test(raw),
    marks: attrs,
    len: raw.length,
  };
}, bookId);
console.log('   stored:', JSON.stringify(stored));
check(stored !== null, 'the page was stored');
check(stored?.hasFontFamilyKey === false, 'no `fontFamily` key anywhere in the stored doc');
check(stored?.hasComic === false, 'and no Comic Sans stack in it either');

/* ---------------------------------------------------------------------------
   3. After a full reload — the paste stays faceless.
   --------------------------------------------------------------------------- */
console.log('\n3. after a full reload');
await boot();
await openBook(bookId);
const after = await page.evaluate((word) => {
  const prose = document.querySelector('.nb-prose');
  const span =
    [...(prose?.querySelectorAll('span') ?? [])].find((el) =>
      (el.textContent ?? '').includes(word),
    ) ?? null;
  const para =
    [...(prose?.querySelectorAll('p') ?? [])].find((p) => (p.textContent ?? '').includes(word)) ??
    null;
  return {
    text: para?.textContent ?? '',
    inlineStyle: span?.getAttribute('style') ?? null,
    family: span === null ? null : getComputedStyle(span).fontFamily,
    paraFamily: para === null ? null : getComputedStyle(para).fontFamily,
    color: span === null ? null : getComputedStyle(span).color,
  };
}, SMUGGLED);
console.log('   after:', JSON.stringify(after));
check(after.text.includes(SMUGGLED), 'the pasted word survived the reload', after.text.slice(0, 60));
check(
  after.inlineStyle === null || !/font-family/i.test(after.inlineStyle),
  'still no raw font-family on it',
  String(after.inlineStyle),
);
check(
  after.family === null || after.family === after.paraFamily,
  'still drawing in the page’s own hand',
  `${after.family}`,
);
await page.screenshot({ path: 'qa/ui/ff-02-reloaded.png' });

/* ---------------------------------------------------------------------------
   Tidy up.
   --------------------------------------------------------------------------- */
await page.evaluate(async (id) => {
  const books = await import('/src/data/books.ts');
  await books.deleteBook(id);
}, bookId);

await browser.close();
console.log(
  `\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}  shots: qa/ui/ff-01-pasted.png, qa/ui/ff-02-reloaded.png\n`,
);
process.exit(failures === 0 ? 0 : 1);
