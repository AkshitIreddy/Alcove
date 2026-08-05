/**
 * scripts/probe-footnote-reserve.mjs — WHEN does the page learn how much room
 * the footnote rail needs, and when does the drain ask?
 *
 * Companion to probe-footnote-collision.mjs, which can SEE the collision from
 * frame 778 but cannot say what caused it: headless Chromium on SwiftShader
 * throttles rAF *and* timers to three or four ticks a second, and the thing
 * being caught lasts about four tenths of one. Polling is the wrong instrument.
 *
 * So this one does not poll. It patches the two calls that make up the whole
 * contract between the footnote rail and the pagination drain, and records
 * every one of them with a timestamp:
 *
 *   - `CSSStyleDeclaration.setProperty('--nb-footnote-rail', …)` — the rail
 *     publishing what it measured itself to be (src/editor/nodes/footnote.ts,
 *     `FootnoteRail.measure`);
 *   - a read of `paddingBottom` off a computed style of `.nb-prose` — the
 *     drain asking how much of the page is spoken for (PageEditor's
 *     `extractOverflow`, and editor.css adds the rail's height into it).
 *
 * Their ORDER is the answer. If the drain reads a padding that does not yet
 * carry the rail, it measures a page that is taller than the one the reader
 * will see, keeps a block that does not fit, and the note is printed under it
 * until something else happens to run the drain again.
 *
 * Usage: node scripts/probe-footnote-reserve.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/footnote-reserve';
const URL_BASE =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ??
  'http://localhost:1420';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage({
  viewport: { width: 1360, height: 850 },
  deviceScaleFactor: 1,
});
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

// Installed before a single module of the app has run, so the very first
// editor the book mounts is already being watched.
await page.addInitScript(() => {
  const trace = [];
  globalThis.__fnTrace = trace;
  const push = (row) => {
    if (trace.length < 20_000) trace.push(row);
  };
  const label = (el) => {
    const leaf = el.closest?.('.nb-leaf-paper');
    const side = leaf?.getAttribute('data-side') ?? 'off';
    const head = (el.textContent ?? '').trim().slice(0, 22);
    return `${side}:${head}`;
  };

  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function patched(name, value, priority) {
    if (name === '--nb-footnote-rail') {
      // Which page editor published it. `element.style` hands back the SAME
      // declaration object every time, so identity finds the host — and a
      // MutationObserver, which would have handed over the target for free,
      // fires at the end of the task and would have reported the publish as
      // happening after a drain read that in fact came later.
      let who = 'off';
      for (const el of document.querySelectorAll('.nb-page-editor')) {
        if (el.style === this) {
          who = label(el);
          break;
        }
      }
      push({
        t: Math.round(performance.now()),
        kind: 'reserve',
        value: String(value),
        who,
      });
    }
    return setProperty.call(this, name, value, priority);
  };

  const computed = window.getComputedStyle.bind(window);
  window.getComputedStyle = (el, pseudo) => {
    const style = computed(el, pseudo);
    if (!(el instanceof Element) || !el.classList.contains('nb-prose')) return style;
    // A Proxy rather than a copy: the drain re-reads this on every pass and a
    // snapshot would answer with the layout of whenever it was taken.
    return new Proxy(style, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop === 'paddingBottom') {
          push({
            t: Math.round(performance.now()),
            kind: 'drain-reads-padding',
            value: String(value),
            blocks: el.children.length,
            // How many notes the page is CARRYING at this instant, counted
            // off the markers in the prose rather than off the rail — the
            // whole question is whether the rail has caught up with them yet.
            markers: el.querySelectorAll('[data-type="footnote"]').length,
            who: label(el),
          });
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
});

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 400,
  timeout: 90_000,
});
await page.evaluate(async () => {
  await globalThis.__shelfWorld.ready;
});
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click({ force: true });
  await page.waitForTimeout(900);
}

await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
});
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) {
  await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
}
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(2500);

// Zero the trace at the first turn: everything before it is the book opening,
// which is a different (and much noisier) story than a leaf arriving.
await page.evaluate(() => {
  globalThis.__fnTrace.length = 0;
});

const TURNS = Number(process.env.TURNS ?? 20);
for (let i = 0; i < TURNS; i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1700);
}
await page.waitForTimeout(2500);

const trace = await page.evaluate(() => globalThis.__fnTrace);
writeFileSync(`${outDir}/trace.json`, `${JSON.stringify(trace, null, 1)}\n`);

/*
 * A leaf's story is the run of rows between one `reserve` and the next. What
 * matters is whether the drain read a padding that already carried the rail:
 * the reservation the rail publishes is `railHeight + 10`, and editor.css adds
 * it to a 32px foot, so a padding of 32px flat means the drain was looking at
 * a page with no room set aside for its notes.
 */
console.log('');
console.log(`  ${trace.length} traced calls`);
console.log('');

/*
 * A leaf's story, told per leaf. `who` is the side plus the first few words on
 * the paper, which is stable for as long as the leaf is mounted, so the rows
 * of one leaf can be pulled out of a trace that interleaves two of them.
 */
const byLeaf = new Map();
for (const row of trace) {
  const key = row.who ?? 'off';
  if (!byLeaf.has(key)) byLeaf.set(key, []);
  byLeaf.get(key).push(row);
}

let blind = 0;
for (const [leaf, rows] of byLeaf) {
  if (!rows.some((r) => r.kind === 'reserve' && Number.parseFloat(r.value) > 0)) {
    continue; // no notes on this leaf; nothing for the rail to reserve
  }
  console.log(`  --- ${leaf} ---`);
  let reserved = 0;
  for (const r of rows) {
    if (r.kind === 'reserve') {
      reserved = Number.parseFloat(r.value) || 0;
      console.log(`  ${String(r.t).padEnd(9)}rail publishes ${r.value}`);
      continue;
    }
    const pad = Number.parseFloat(r.value) || 0;
    // A drain reading 32px while the rail needs 41 is the whole defect in one
    // row: it is measuring a page 41px taller than the one on the paper.
    const isBlind = pad < 32 + reserved - 0.5;
    if (isBlind) blind += 1;
    console.log(
      `  ${String(r.t).padEnd(9)}drain reads padding ${r.value.padEnd(7)}` +
        `${String(r.blocks).padEnd(4)} blocks ${String(r.markers).padEnd(3)} markers` +
        `${isBlind ? '   <-- BLIND to the rail' : ''}`,
    );
  }
  console.log('');
}
console.log(
  `  ${blind} drain read(s) happened on a leaf whose rail was not yet in the padding`,
);
console.log('  errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
