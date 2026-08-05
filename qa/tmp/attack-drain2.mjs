/**
 * qa/tmp/attack-drain2.mjs — narrow in on the leaf that KEPT its overflow.
 *
 * Run 1 found: turn six spreads, then shrink the window to 1000x560, and the
 * visible left leaf stands 803px tall inside a 380px capacity — under
 * `overflow: hidden`, and still there five seconds later. This asks what is on
 * that leaf, whether the STORED doc agrees with the DOM (i.e. whether the drain
 * ran at all), and what the app's own capacity signal is doing.
 */
import { chromium } from 'playwright';

const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) ?? 'run';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

await page.addInitScript(
  ([storageKey, tutorialKey]) => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const blob = raw === null ? {} : JSON.parse(raw);
      const rows = Array.isArray(blob.settings) ? blob.settings : [];
      const at = rows.findIndex((r) => r?.key === tutorialKey);
      const row = { key: tutorialKey, value: '1' };
      if (at >= 0) rows[at] = row; else rows.push(row);
      blob.settings = rows;
      window.localStorage.setItem(storageKey, JSON.stringify(blob));
    } catch {}
  },
  ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
);

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
await page.evaluate(() => window.__nbTutorial?.stop?.());
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }

const detail = () =>
  page.evaluate(async () => {
    const visualScale = (drawn, laidOut) => (laidOut > 0 && drawn > 0 ? drawn / laidOut : 1);
    const pagesMod = await import('/src/data/pages.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
    const stored = await pagesMod.listPages(welcome.id);
    const textOf = (n) => {
      if (n === null || typeof n !== 'object') return '';
      if (typeof n.text === 'string') return n.text;
      return (n.content ?? []).map(textOf).join('');
    };
    const out = [];
    for (const paper of document.querySelectorAll('.nb-leaf-paper')) {
      const root = paper.querySelector('.nb-prose');
      const chain = [];
      let el = paper;
      while (el && chain.length < 5) { chain.push(el.className?.toString?.().slice(0, 44) ?? '?'); el = el.parentElement; }
      if (!root) { out.push({ side: paper.getAttribute('data-side'), chain, mounted: false }); continue; }
      const ps = getComputedStyle(paper);
      const laidOut = paper.clientHeight - (parseFloat(ps.paddingTop) || 0) - (parseFloat(ps.paddingBottom) || 0);
      const scale = visualScale(paper.getBoundingClientRect().height, paper.clientHeight);
      const capacity = Math.floor(laidOut * scale);
      const rect = root.getBoundingClientRect();
      const kids = Array.from(root.children);
      const bottoms = kids.map((c) => c.getBoundingClientRect().bottom - rect.top);
      const pad = (parseFloat(getComputedStyle(root).paddingBottom) || 0) * scale;
      const domBlocks = kids.map((c) => ({
        tag: c.tagName.toLowerCase(),
        type: c.getAttribute('data-type') ?? c.getAttribute('data-node-type') ?? '',
        h: Math.round(c.getBoundingClientRect().height),
        t: (c.textContent ?? '').trim().slice(0, 34),
      }));
      // Which stored page is this? match on the first block's text.
      const first = domBlocks[0]?.t ?? '';
      const slot = stored.findIndex((pg) =>
        (pg.doc?.content ?? []).some((b) => textOf(b).trim().slice(0, 34) === first && first.length > 4),
      );
      out.push({
        side: paper.getAttribute('data-side'),
        chain,
        mounted: true,
        visible: paper.getBoundingClientRect().width > 4 && ps.visibility !== 'hidden',
        visibility: ps.visibility,
        capacity,
        scale: Number(scale.toFixed(3)),
        content: Math.round((bottoms[bottoms.length - 1] ?? 0) + pad),
        domBlocks,
        storedSlot: slot,
        storedBlocks: slot >= 0 ? (stored[slot].doc?.content ?? []).map((b) => textOf(b).trim().slice(0, 34)) : null,
      });
    }
    return { pages: stored.length, leaves: out };
  });

const show = async (label) => {
  const d = await detail();
  console.log(`\n=== ${label} — ${d.pages} stored pages ===`);
  for (const l of d.leaves) {
    if (!l.mounted) { console.log(`  leaf ${l.side}: blank  [${l.chain[1]}]`); continue; }
    console.log(
      `  leaf side=${l.side} vis=${l.visibility} scale=${l.scale} cap=${l.capacity} content=${l.content} over=${l.content - l.capacity}  parent=[${l.chain[1]}]`,
    );
    for (const b of l.domBlocks) console.log(`      DOM  ${String(b.h).padStart(5)}px ${b.tag}${b.type ? '/' + b.type : ''}  "${b.t}"`);
    console.log(`      stored slot ${l.storedSlot}: ${l.storedBlocks ? l.storedBlocks.length + ' blocks' : 'not matched'}`);
    if (l.storedBlocks) for (const s of l.storedBlocks) console.log(`      STORE  "${s}"`);
  }
  return d;
};

await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((x) => /welcome/i.test(x.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(6000);
await show('opened, 1440x900');

for (let i = 0; i < 6; i += 1) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(2200); }
await page.waitForTimeout(3000);
await show('after six turns, still 1440x900');

await page.setViewportSize({ width: 1000, height: 560 });
await page.waitForTimeout(6000);
await show('shrunk to 1000x560');

await page.waitForTimeout(6000);
await show('+6s idle');

// Does a keystroke wake the drain that the resize did not?
await page.click('.nb-prose', { force: true }).catch(() => {});
await page.waitForTimeout(500);
await page.keyboard.type('X');
await page.waitForTimeout(3000);
await show('after typing one character into the leaf');

console.log('\nerrors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
