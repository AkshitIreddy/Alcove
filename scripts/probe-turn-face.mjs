/**
 * scripts/probe-turn-face.mjs — is the page under the curl the page you land on?
 *
 * The temporal review of the demo found the same shape five times (frames 579,
 * 695, 926, 1043, 1089): the curl finishes, both leaves are fully painted with
 * no transition chrome, and for two or three frames the RIGHT leaf shows a
 * spread from ELSEWHERE in the book before snapping to the correct one. At
 * f579 the wrongly-shown page is one the demo does not legitimately reach for
 * another 120 frames.
 *
 * WHY NO PROBE HERE COULD SEE IT. During a curl the live leaves are
 * `visibility: hidden` with their text still in them, and what the reader is
 * looking at is a WebGL texture — so every probe that samples the DOM reports
 * an inked leaf however wrong the picture on screen is. The textures come from
 * `flip/rasterCache`, which for an unmounted page (the whole adjacent spread,
 * which is never in the DOM at rest) rasterizes the page's STORED document
 * through `flip/offscreenPages`.
 *
 * So the question this asks is not "what does the DOM say" but:
 *
 *     is the document the flip rasterized for the destination page the same
 *     document that page turns out to hold once it has mounted?
 *
 * If it is not, the reader was shown a page that does not exist — for the
 * whole gesture and for the landing frames after it — and then watched it
 * snap. The two sides are read the way the app reads them: the BEFORE side out
 * of the store through `data/pages` (which is literally what `loadPageDoc`
 * hands the capture), the AFTER side off the live leaves.
 *
 * A screencast runs across every turn as well, and the frames either side of
 * the landing are written out, because a number is not a picture and this
 * defect was found by looking at one.
 *
 *   node scripts/probe-turn-face.mjs [--url=…] [--turns=6] [--out=qa/turn-face]
 *                                    [--shots] [--sabotage]
 *
 * `--sabotage` edits the destination page's stored document behind the app's
 * back between the snapshot and the turn, which is exactly the failure mode in
 * different clothes: the flip's picture and the mounted page disagree. A gate
 * you have not watched fail is not a gate.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = arg('url', 'http://localhost:1420');
const TURNS = Number(arg('turns', '6'));
const OUT = arg('out', 'qa/turn-face');
const SHOTS = process.argv.includes('--shots');
/*
 * The window matters more than it looks. A book whose pages have already been
 * drained at THIS height is settled, and a settled book cannot show this
 * defect at all — the first run of this probe came back clean at 1500x940
 * against a database a dozen probe runs had already walked. The demo was
 * recorded on a smaller window and on a library that had never been read.
 */
const [VW, VH] = arg('viewport', '1500x940').split('x').map(Number);
const SABOTAGE = process.argv.includes('--sabotage');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
// Headless Chromium reports `reduce`, and the controller answers that with a
// crossfade — a path with no curl in it at all, i.e. not the thing under test.
await page.emulateMedia({ reducedMotion: 'no-preference' });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
let booted = false;
const reloads = [];
page.on('framenavigated', (f) => {
  if (booted && f === page.mainFrame()) reloads.push(new Date().toISOString());
});

/* ------------------------------ screencast -------------------------------- */
const cdp = await page.context().newCDPSession(page);
let capturing = false;
let shots = [];
cdp.on('Page.screencastFrame', (f) => {
  if (capturing) shots.push({ ts: f.metadata.timestamp * 1000, data: f.data });
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
const startCast = async () => {
  if (!SHOTS) return;
  shots = [];
  capturing = true;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
};
const stopCast = async () => {
  if (!SHOTS) return;
  capturing = false;
  await cdp.send('Page.stopScreencast').catch(() => {});
};

/* -------------------------------- boot ------------------------------------ */
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
const bookId = await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
  return w ? w.id : null;
});
if (bookId === null) { console.error('FAIL: no book on the shelf'); await browser.close(); process.exit(1); }
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(6000);
booted = true;

/* ------------------------- the two sides to compare ------------------------ */
/**
 * What the STORE holds for every page of the book, in order.
 *
 * This is the document `FlipSurface`'s `loadPageDoc` hands to
 * `offscreenPages`, which is the picture the curl draws. Reading it here is
 * not a second implementation of anything — it is the same query.
 */
const storedPages = () =>
  page.evaluate(async (id) => {
    const mod = await import('/src/data/pages.ts');
    const list = await mod.listPages(id);
    const textOf = (node) => {
      if (node === null || typeof node !== 'object') return '';
      if (typeof node.text === 'string') return node.text;
      const kids = Array.isArray(node.content) ? node.content : [];
      return kids.map(textOf).join('');
    };
    return list.map((p) => ({
      id: p.id,
      blocks: Array.isArray(p.doc?.content) ? p.doc.content.length : 0,
      heads: (Array.isArray(p.doc?.content) ? p.doc.content : []).map((b) =>
        textOf(b).trim().slice(0, 28),
      ),
    }));
  }, bookId);

/** What the LIVE leaves hold, once the spread has settled. */
const liveLeaves = () =>
  page.evaluate(() => {
    const read = (side) => {
      const prose = document.querySelector(
        `.nb-spread .nb-sheet-paper[data-side="${side}"]:not(.nb-export-sheet) .nb-prose`,
      );
      if (prose === null) return null;
      return {
        blocks: prose.children.length,
        heads: [...prose.children].map((c) => (c.textContent ?? '').trim().slice(0, 28)),
      };
    };
    const host = document.querySelector('[data-spread-index]');
    return {
      spread: Number(host?.getAttribute('data-spread-index') ?? -1),
      left: read('left'),
      right: read('right'),
    };
  });

/** Which faces the next flip will actually have textures for. */
const faces = () =>
  page.evaluate(() => globalThis.__flipCache?.facesFor('next') ?? null);

const blur = () =>
  page.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });

/* The outer-edge strip, never a key: arrow keys do not turn pages (the owner's
   ruling, views/spread.ts). Two probes in this folder still press ArrowRight
   and have been measuring a book that never turned. */
const turn = async () => {
  await blur();
  await page.waitForTimeout(150);
  const hot = await page.locator('.nb-flip-hotspot-next').first().boundingBox();
  if (hot === null) throw new Error('no next hotspot — the book is not open');
  await page.mouse.click(hot.x + hot.width / 2, hot.y + hot.height / 2);
};

/**
 * Do these two describe the same page?
 *
 * Two differences are NOISE and both were in the first run of this probe.
 * StarterKit's TrailingNode keeps an empty paragraph at the foot of a live
 * page that is not in the stored document, so every single turn came back
 * MISMATCH on an empty string. And a node view can render chrome of its own —
 * a spoiler's "psst… click to reveal" is in the leaf's textContent and nowhere
 * in the doc — so the text of one block is not always the text of the other.
 *
 * What the defect actually does is MOVE BLOCKS between pages, so the two
 * things compared are the number of blocks that carry ink and the ink of the
 * first and last of them. A carried block changes both; a trailing empty line
 * and a bit of node-view chrome change neither.
 */
const inked = (heads) => (heads ?? []).filter((h) => h !== '');
const near = (a, b) =>
  a === b || (a !== undefined && b !== undefined && (a.startsWith(b) || b.startsWith(a)));
const sameHeads = (a, b) => {
  if (a === null || b === null) return false;
  const x = inked(a);
  const y = inked(b);
  if (x.length !== y.length) return false;
  if (x.length === 0) return true;
  return near(x[0], y[0]) && near(x[x.length - 1], y[y.length - 1]);
};

/* -------------------------------- the drive -------------------------------- */
const rows = [];
for (let n = 0; n < TURNS; n += 1) {
  const before = await liveLeaves();
  const stored = await storedPages();
  const armed = await faces();
  const slot = before.spread * 2;
  const dest = { left: stored[slot + 2] ?? null, right: stored[slot + 3] ?? null };
  if (dest.left === null && dest.right === null) break;

  if (SABOTAGE && n === 0 && dest.right !== null) {
    /*
     * Rewrite the destination page in the store, behind the app's back, AFTER
     * the flip has cached its picture of it. The flip then draws a page that
     * the mounted leaf will not agree with — the same disagreement the defect
     * produces, arrived at from the other end.
     */
    await page.evaluate(async ([id]) => {
      const mod = await import('/src/data/pages.ts');
      const p = await mod.getPage(id);
      const doc = p?.doc ?? { type: 'doc', content: [] };
      await mod.savePageDoc(id, {
        ...doc,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'SABOTAGE — not the page you saw' }] },
          ...(Array.isArray(doc.content) ? doc.content : []),
        ],
      });
    }, [dest.right.id]);
    await page.waitForTimeout(400);
  }

  await startCast();
  const castStart = Date.now();
  await turn();
  await page.waitForTimeout(2600);
  await stopCast();
  const after = await liveLeaves();

  if (after.spread === before.spread) {
    console.log(`  turn ${n + 1}: the book did not turn (still spread ${after.spread})`);
    break;
  }

  const leftOk = sameHeads(dest.left?.heads ?? null, after.left?.heads ?? null);
  const rightOk = sameHeads(dest.right?.heads ?? null, after.right?.heads ?? null);
  rows.push({ n: n + 1, from: before.spread, to: after.spread, armed, dest, after, leftOk, rightOk });

  console.log(
    `  turn ${n + 1} (spread ${before.spread} → ${after.spread}): ` +
      `curl had front/back/revealed ${armed ? [armed.hasFront, armed.hasBack, armed.hasRevealed].map((b) => (b ? 'y' : 'n')).join('') : '???'} · ` +
      `left ${leftOk ? 'matches' : 'MISMATCH'} · right ${rightOk ? 'matches' : 'MISMATCH'}`,
  );
  if (!leftOk || !rightOk) {
    const show = (label, a, b) =>
      console.log(
        `        ${label}\n          drawn:  ${JSON.stringify((a?.heads ?? []).slice(0, 6))}` +
          `\n          landed: ${JSON.stringify((b?.heads ?? []).slice(0, 6))}`,
      );
    if (!leftOk) show('LEFT leaf', dest.left, after.left);
    if (!rightOk) show('RIGHT leaf', dest.right, after.right);
  }

  if (SHOTS && shots.length > 0 && (!leftOk || !rightOk)) {
    // Everything from the moment the gesture started to a second after it —
    // the landing frames are the ones the report is about.
    const keep = shots.filter((s) => s.ts - castStart > -100).slice(0, 60);
    keep.forEach((s, i) => {
      writeFileSync(
        join(OUT, `turn${String(n + 1).padStart(2, '0')}-${String(i).padStart(3, '0')}.jpg`),
        Buffer.from(s.data, 'base64'),
      );
    });
    console.log(`        ${keep.length} frames → ${OUT}`);
  }
}

/* -------------------------------- report ---------------------------------- */
writeFileSync(join(OUT, 'turns.json'), JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => !r.leftOk || !r.rightOk);
console.log('\n================ VERDICT ================');
console.log(
  bad.length === 0
    ? `every one of ${rows.length} turns landed on the page it drew.`
    : `${bad.length} of ${rows.length} turns DREW A PAGE THAT DOES NOT EXIST: ` +
        bad
          .map((r) => `spread ${r.to} (${!r.leftOk ? 'left' : ''}${!r.leftOk && !r.rightOk ? '+' : ''}${!r.rightOk ? 'right' : ''})`)
          .join(', '),
);
if (SABOTAGE) console.log(bad.length > 0 ? 'GATE ALIVE' : 'GATE INERT');
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
if (reloads.length) console.log(`WARNING: page reloaded ${reloads.length}x mid-run — re-run before trusting this`);
await browser.close();
process.exit(!SABOTAGE && bad.length > 0 ? 1 : 0);
