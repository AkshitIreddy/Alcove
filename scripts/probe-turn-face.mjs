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
 *     document that page turns out to hold once it has mounted and published
 *     its pagination drain?
 *
 * If it is not, the reader was shown a page that does not exist — for the
 * whole gesture and for the landing frames after it — and then watched it
 * snap. The two sides are read the way the app reads them: the BEFORE side out
 * of the store through `data/pages` (which is literally what `loadPageDoc`
 * hands the capture), and the AFTER side from that same store after the live
 * leaf has published its drain. The live leaves are recorded beside the
 * result so a failure remains legible in prose and pictures.
 *
 * A screencast runs across every turn as well, and the frames either side of
 * the landing are written out, because a number is not a picture and this
 * defect was found by looking at one.
 *
 *   node scripts/probe-turn-face.mjs [--url=…] [--turns=6] [--viewport=WxH]
 *                                    [--out=qa/turn-face] [--shots] [--off]
 *
 * TWO THINGS TO KNOW BEFORE RUNNING IT. The window size decides everything: a
 * book whose pages have already been drained at this height is settled, and a
 * settled book cannot show this defect at all — the first run came back clean
 * at 1500x940 against a database a dozen probe runs had walked. Use a height
 * nothing has read the book at. And `--off` runs the same build with
 * `?settleahead=0`, which is the app before the fix: that is how this check
 * was watched going red, 0 of 6 turns to 6 of 6.
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
/*
 * `--off` runs the app with `?settleahead=0`, which is the app BEFORE the fix:
 * the flip photographs each page's stored document rather than draining it
 * first. Same build, same book, same window — the only honest A/B, and the way
 * to watch this check go red on purpose.
 */
const OFF = process.argv.includes('--off');
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
await page.goto(`${URL_BASE}/?fx=force&dev=0${OFF ? '&settleahead=0' : ''}`, { waitUntil: 'domcontentloaded' });
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
    /*
     * Compare the documents themselves, not DOM text.
     *
     * A diagram can have no text in JSON and still paint a whole SVG, while
     * StarterKit's trailing paragraph has no text and paints nothing. The old
     * heads-only comparison could not tell those apart: it discarded a
     * diagram at the end of a stored page, then counted its rendered labels as
     * a carried block. Conversely, a genuinely empty paragraph carried onto
     * the front of a page changed the DOM child count without changing a
     * single visible mark.
     *
     * The flip and the landing are both backed by PageDoc, so use a canonical
     * top-level block signature and ignore only empty paragraphs. This keeps
     * pictures/diagrams/cards structural even when their ink lives in attrs or
     * a node view, and removes the one DOM-only phantom the reader cannot see.
     */
    const marksOf = (doc) => {
      const blocks = [...(Array.isArray(doc?.content) ? doc.content : [])];
      // Only the FINAL empty paragraph is StarterKit bookkeeping. An empty
      // paragraph anywhere else is a visible ruled line with the editor's
      // placeholder and it shifts every block below it — turn 4 of the first
      // fixed run caught exactly that, so filtering every empty paragraph
      // would make this gate inert again.
      const tail = blocks[blocks.length - 1];
      if (
        blocks.length > 1 &&
        tail?.type === 'paragraph' &&
        textOf(tail).trim() === ''
      ) {
        blocks.pop();
      }
      return blocks.map((block) => {
        /*
         * Mounting a seeded doc fills schema defaults (`id`, null decoration
         * attrs, diagram width, sticker x/y) without changing its page. The
         * identity relevant here is the block kind, its complete text and the
         * attrs that name non-text content. This keeps a tree/image distinct
         * while refusing to call generated ids a different page.
         */
        const attrs = block?.attrs ?? {};
        const identity = {};
        for (const key of [
          'kind', 'data', 'src', 'assetId', 'url', 'href', 'stickerId',
          'title', 'language', 'checked', 'start', 'level',
        ]) {
          const value = attrs[key];
          // OrderedList's schema materialises its default `start: 1` on mount.
          if (key === 'start' && value === 1) continue;
          if (value !== undefined && value !== null) identity[key] = value;
        }
        return JSON.stringify([block?.type ?? null, textOf(block), identity]);
      });
    };
    return list.map((p) => ({
      id: p.id,
      blocks: Array.isArray(p.doc?.content) ? p.doc.content.length : 0,
      heads: (Array.isArray(p.doc?.content) ? p.doc.content : []).map((b) =>
        textOf(b).trim().slice(0, 28),
      ),
      marks: marksOf(p.doc),
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

const sameMarks = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every((mark, i) => mark === b[i]);

/* -------------------------------- the drive -------------------------------- */
const rows = [];
for (let n = 0; n < TURNS; n += 1) {
  const before = await liveLeaves();
  const stored = await storedPages();
  const armed = await faces();
  const slot = before.spread * 2;
  const dest = { left: stored[slot + 2] ?? null, right: stored[slot + 3] ?? null };
  if (dest.left === null && dest.right === null) break;

  await startCast();
  const castStart = Date.now();
  await turn();
  await page.waitForTimeout(2600);
  await stopCast();
  const after = await liveLeaves();
  /*
   * The store as it stands once the dust has settled.
   *
   * This tells the two failures apart, and they are not the same defect. If
   * the store AFTER matches the live leaves but the store BEFORE did not, the
   * document moved between the snapshot and the turn — a settle still in
   * flight, which is a question of how far ahead the reader is. If the store
   * after DISAGREES with the leaves, the picture and the page genuinely do not
   * match, which is the reported defect.
   */
  const storedAfter = await storedPages();

  if (after.spread === before.spread) {
    console.log(`  turn ${n + 1}: the book did not turn (still spread ${after.spread})`);
    break;
  }

  const landedLeft = dest.left === null
    ? null
    : storedAfter.find((p) => p.id === dest.left.id) ?? null;
  const landedRight = dest.right === null
    ? null
    : storedAfter.find((p) => p.id === dest.right.id) ?? null;
  const leftOk = sameMarks(dest.left?.marks ?? null, landedLeft?.marks ?? null);
  const rightOk = sameMarks(dest.right?.marks ?? null, landedRight?.marks ?? null);
  /*
   * HOW BADLY WRONG, not whether it was allowed to be wrong.
   *
   * There was a classifier here that asked whether the STORE had moved on by
   * the time everything settled, and called those turns "a settle still in
   * flight" rather than failures. It is inert by construction: the mounted
   * page publishes its own drain to the store, so the store always agrees with
   * the leaves a second later — every failure was excused, and the `--off` run
   * (the app WITH the defect) came back GATE INERT while reporting four
   * mismatched turns. Whatever the reason, a reader who was shown one page and
   * handed another was shown the wrong page.
   *
   * What is worth grading is the SIZE of it: a page whose first block differs
   * is a different page (the demo's "Four kinds of aside" where "The
   * stationery drawer" landed), while one that differs by a block at the edge
   * is the same page one carry out of date.
   */
  const grade = (a, b) => {
    const x = a?.marks ?? [];
    const y = b?.marks ?? [];
    if (x.length === 0 && y.length === 0) return 'ok';
    return x[0] === y[0] ? 'edge' : 'other page';
  };
  const how = [
    leftOk ? null : `left ${grade(dest.left, landedLeft)}`,
    rightOk ? null : `right ${grade(dest.right, landedRight)}`,
  ].filter((v) => v !== null);
  const otherPage = how.some((v) => v.endsWith('other page'));
  rows.push({
    n: n + 1, from: before.spread, to: after.spread, armed, dest, after,
    leftOk, rightOk, how, otherPage,
    storedAfterLeft: landedLeft,
    storedAfterRight: landedRight,
  });

  console.log(
    `  turn ${n + 1} (spread ${before.spread} → ${after.spread}): ` +
      `curl had front/back/revealed ${armed ? [armed.hasFront, armed.hasBack, armed.hasRevealed].map((b) => (b ? 'y' : 'n')).join('') : '???'} · ` +
      `left ${leftOk ? 'matches' : 'MISMATCH'} · right ${rightOk ? 'matches' : 'MISMATCH'}` +
      (how.length > 0 ? ` · ${how.join(', ')}` : ''),
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
const wrong = rows.filter((r) => !r.leftOk || !r.rightOk);
const otherPage = wrong.filter((r) => r.otherPage);
console.log('\n================ VERDICT ================');
const where = (r) => `spread ${r.to} (${r.how.join(', ')})`;
console.log(
  wrong.length === 0
    ? `every one of ${rows.length} turns landed on the page it drew.`
    : `${wrong.length} of ${rows.length} turns DREW A PAGE THEY DID NOT LAND ON: ` +
        wrong.map(where).join(', '),
);
if (wrong.length > 0) {
  console.log(
    `  of those, ${otherPage.length} showed a DIFFERENT PAGE (the first block does not ` +
      `even match — the reported defect) and ${wrong.length - otherPage.length} differed by ` +
      `a block at the edge (the same page, one carry out of date).`,
  );
}
/*
 * THE ONLY SABOTAGE THAT BITES, and the first one did not.
 *
 * The first version rewrote the destination page in the store behind the
 * app's back after the snapshot, on the theory that the flip would then draw
 * a page the mounted leaf disagreed with. It cannot: the leaf mounts from the
 * host's in-memory page list, which that write never touches, so both sides
 * moved together and the run came back green while claiming to be broken —
 * an inert gate of exactly the kind this repo keeps finding.
 *
 * `--off` is the real one. It puts the app back to photographing the stored
 * document (`?settleahead=0`), which is the defect itself, in the same build,
 * against the same book, at the same window size.
 */
if (OFF) console.log(wrong.length > 0 ? 'GATE ALIVE' : 'GATE INERT');
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
if (reloads.length) console.log(`WARNING: page reloaded ${reloads.length}x mid-run — re-run before trusting this`);
await browser.close();
process.exit(!OFF && wrong.length > 0 ? 1 : 0);
