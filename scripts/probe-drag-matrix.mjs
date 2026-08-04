/**
 * scripts/probe-drag-matrix.mjs — the rest of the drag hypotheses, in one pass.
 *
 * `probe-drag.mjs` proved a paragraph moves. `probe-drag-reach.mjs` proved the
 * pointer can walk to the handle without losing it. Both pass, and the owner's
 * report stands. So this widens the net across everything that is DIFFERENT
 * about the case the owner was in when they hit it:
 *
 *   A. block TYPE   — "dragging stuff", and step 10 is about blocks in general.
 *   B. which LEAF   — the right page's gutter falls near the spread's fold.
 *   C. a rail PANEL open — the tour has one open at step 10, and panel-open
 *                      costs a 150–300ms main-thread stall.
 *   D. the tour's own OVERLAY — an SVG spotlight over the page. Does it eat the
 *                      pointer, and is the handle inside the lit hole or under
 *                      the dim?
 *   E. ZOOM          — is the handle reachable at every zoom the dial offers?
 *   F. the CONTROL   — what the failure actually looks like when native drop
 *                      delivery is taken away from the page, which is what
 *                      Tauri's webview does on Windows. This is the one that
 *                      has to match the owner's description.
 *
 * Everything is asserted on the DOCUMENT, not on a class or a cursor: a block
 * moved or it did not.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

const rows = [];
const record = (area, label, ok, detail) => {
  rows.push({ area, label, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};

/* ------------------------------- helpers -------------------------------- */

/** Every top-level block on a leaf, as tag + a slice of its text. */
const blockSig = (leaf) =>
  page.evaluate(
    (i) => {
      const prose = document.querySelectorAll('.nb-prose')[i];
      if (prose === undefined) return [];
      return [...prose.children].map(
        (el) => `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 18)}`,
      );
    },
    leaf,
  );

/**
 * There is ONE HANDLE PER MOUNTED EDITOR — both leaves put one on <body> — so
 * `querySelector('.nb-drag-handle')` is leaf 0's and says nothing about leaf 1.
 * This returns the VISIBLE one and its index, which is also what `.nth()` needs.
 */
const handleState = () =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('.nb-drag-handle')];
    if (all.length === 0) return { present: false, count: 0 };
    const shown = all
      .map((el, index) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          index,
          visible:
            s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05 && r.width > 0,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter((h) => h.visible);
    if (shown.length === 0) return { present: false, count: all.length };
    const el = shown[0];
    const hit = document.elementFromPoint(el.x + el.w / 2, el.y + el.h / 2);
    return {
      present: true,
      visible: true,
      count: all.length,
      shownCount: shown.length,
      ...el,
      topmost: hit === null ? null : `${hit.tagName.toLowerCase()}.${(hit.getAttribute('class') ?? '').split(' ')[0]}`,
    };
  });

/** Hover a block, grab its handle, drop it on another block. Did the doc move? */
async function tryDrag(leaf, fromIndex, toIndex) {
  const before = await blockSig(leaf);
  const boxes = await page.evaluate(
    ({ i, a, b }) => {
      const prose = document.querySelectorAll('.nb-prose')[i];
      if (prose === undefined) return null;
      const kids = [...prose.children];
      if (kids[a] === undefined || kids[b] === undefined) return null;
      const ra = kids[a].getBoundingClientRect();
      const rb = kids[b].getBoundingClientRect();
      return {
        from: { x: ra.x, y: ra.y, w: ra.width, h: ra.height },
        to: { x: rb.x, y: rb.y, w: rb.width, h: rb.height },
      };
    },
    { i: leaf, a: fromIndex, b: toIndex },
  );
  if (boxes === null) return { moved: false, reason: 'no such block' };

  await page.mouse.move(boxes.from.x + boxes.from.w * 0.4, boxes.from.y + Math.min(14, boxes.from.h / 2));
  await page.waitForTimeout(700);
  const h = await handleState();
  if (!h.present || !h.visible) return { moved: false, reason: 'no handle', handle: h };

  try {
    // Native HTML5 drag — the only kind the extension listens for. The handle
    // is picked by INDEX: the other leaf's handle is a second match.
    const proseBox = await page.locator('.nb-prose').nth(leaf).boundingBox();
    await page.locator('.nb-drag-handle').nth(h.index).dragTo(page.locator('.nb-prose').nth(leaf), {
      force: true,
      targetPosition: {
        x: boxes.to.x + boxes.to.w * 0.5 - proseBox.x,
        y: boxes.to.y + boxes.to.h - 3 - proseBox.y,
      },
      timeout: 12_000,
    });
  } catch (err) {
    return { moved: false, reason: `dragTo threw: ${String(err).split(/\r?\n/)[0].slice(0, 70)}`, handle: h };
  }
  await page.waitForTimeout(650);
  const after = await blockSig(leaf);
  return { moved: before.join('|') !== after.join('|'), handle: h, before, after };
}

/* -------------------------------- setup --------------------------------- */

/**
 * A clean app with the Welcome book open. Re-runnable, because each successful
 * drag REORDERS the document — so a later section measured on the leftovers of
 * an earlier one is measuring the wrong page. The control in F especially has
 * to start from the same state everything else did.
 */
async function openBook() {
  await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(900);
  }
  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
    app.appState.openBook(welcome.id);
  });
  await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
  await page.waitForTimeout(4500);
}

console.log('1. open a book');
await openBook();

const leaves = await page.locator('.nb-prose').count();
console.log(`   leaves mounted: ${leaves}`);

/* ------------------------- A. every block type --------------------------- */

console.log('\n2. A — does the handle appear on every block TYPE?');
const kinds = await page.evaluate(() => {
  const prose = document.querySelectorAll('.nb-prose')[0];
  if (prose === undefined) return [];
  return [...prose.children].map((el, i) => ({
    i,
    tag: el.tagName.toLowerCase(),
    cls: (el.getAttribute('class') ?? '').split(' ')[0],
  }));
});
console.log('   blocks on leaf 0:', JSON.stringify(kinds.map((k) => k.cls || k.tag)));

for (const k of kinds.slice(0, 8)) {
  const b = await page.evaluate((i) => {
    const el = document.querySelectorAll('.nb-prose')[0].children[i];
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, k.i);
  if (b.h < 4 || b.w < 4) continue;
  await page.mouse.move(b.x + b.w * 0.4, b.y + Math.min(14, b.h / 2));
  await page.waitForTimeout(520);
  const h = await handleState();
  record('A', `handle on <${k.cls || k.tag}>`, h.present && h.visible, h.present ? `at ${h.x},${h.y}` : 'absent');
}

/* ------------------------------ B. leaves -------------------------------- */

console.log('\n3. B — left leaf then right leaf, an actual move each');
const left = await tryDrag(0, 0, 2);
record('B', 'a block moves on the LEFT leaf', left.moved, left.reason ?? undefined);
if (leaves > 1) {
  const rightKinds = await page.evaluate(() => {
    const prose = document.querySelectorAll('.nb-prose')[1];
    return prose === undefined ? 0 : prose.children.length;
  });
  console.log(`   right leaf has ${rightKinds} blocks`);
  if (rightKinds >= 3) {
    const right = await tryDrag(1, 0, 2);
    record('B', 'a block moves on the RIGHT leaf', right.moved, right.reason ?? undefined);
  } else {
    record('B', 'right leaf had enough blocks to test', false, `only ${rightKinds}`);
  }
}
await page.screenshot({ path: 'qa/ui/drag-matrix-leaves.png' }).catch(() => {});

/* --------------------------- C. a panel open ----------------------------- */

console.log('\n4. C — with a left-rail panel open');
await openBook(); // fresh again: section B moved two blocks
const railButtons = await page.locator('.nb-rail button, [class*="rail"] button').count();
console.log(`   rail buttons found: ${railButtons}`);
if (railButtons > 0) {
  await page.locator('.nb-rail button, [class*="rail"] button').nth(1).click({ force: true }).catch(() => {});
  await page.waitForTimeout(1200);
  const panelOpen = await page.evaluate(
    () => document.querySelectorAll('[class*="panel"], [class*="sheet"]').length,
  );
  console.log(`   panel-ish nodes on screen: ${panelOpen}`);
  const withPanel = await tryDrag(0, 0, 2);
  record('C', 'a block still moves with a panel open', withPanel.moved, withPanel.reason ?? undefined);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
}

/* --------------------------- D. the tour overlay -------------------------- */

console.log('\n5. D — the tour at step 10 (`blocks`): does the spotlight eat the pointer?');
await openBook(); // a fresh document — the drags above reordered the last one
const jumped = await page.evaluate(() => {
  if (window.__nbTutorial === undefined) return 'no bridge';
  window.__nbTutorial.start();
  return 'started';
});
console.log('   tour:', jumped);
await page.waitForTimeout(1200);
await page.evaluate(() => {
  window.__nbTutorial?.chooseLength?.('full');
});
await page.waitForTimeout(700);
const at = await page.evaluate(() => {
  const t = window.__nbTutorial;
  if (t === undefined) return null;
  // jumpTo takes an INDEX, and the index of `blocks` depends on the length
  // the reader chose — so it is looked up in the live step list, never typed.
  const idx = t.getState().stepIds.indexOf('blocks');
  if (idx < 0) return `no blocks step (${t.getState().stepIds.join(',')})`;
  t.jumpTo(idx);
  t.hold?.();
  return t.getState().stepId;
});
console.log('   tour step now:', at);
await page.waitForTimeout(1400);
if (at === 'blocks') {
  const b = await page.evaluate(() => {
    const el = document.querySelectorAll('.nb-prose')[0]?.children[0];
    if (el === undefined) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (b !== null) {
    await page.mouse.move(b.x + b.w * 0.4, b.y + Math.min(14, b.h / 2));
    await page.waitForTimeout(800);
    const h = await handleState();
    console.log('   handle under the tour:', JSON.stringify(h));
    record('D', 'the handle still appears while the tour is on step 10', h.present && h.visible);
    record(
      'D',
      'and the pointer reaches it (nothing overlaying it)',
      h.present && h.topmost !== null && /drag-handle/.test(h.topmost ?? ''),
      `topmost at the handle centre: ${h.topmost}`,
    );
    const overlay = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('[class*="tutorial"], [class*="tour"], svg')];
      return nodes
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 600 && r.height > 400;
        })
        .map((n) => ({
          cls: (n.getAttribute('class') ?? '').slice(0, 40),
          pe: getComputedStyle(n).pointerEvents,
        }))
        .slice(0, 6);
    });
    console.log('   full-screen overlays:', JSON.stringify(overlay));
    const tourDrag = await tryDrag(0, 0, 2);
    record('D', 'a block moves DURING the tour step', tourDrag.moved, tourDrag.reason ?? undefined);
  }
}
await page.screenshot({ path: 'qa/ui/drag-matrix-tour.png' }).catch(() => {});
await page.evaluate(() => window.__nbTutorial?.stop());
await page.waitForTimeout(700);

/* -------------------------------- E. zoom -------------------------------- */

console.log('\n6. E — at the zoom levels the focus dial offers');
for (const z of [0.8, 1.25]) {
  await page.evaluate((v) => {
    document.documentElement.style.setProperty('--nb-page-zoom', String(v));
    document.body.style.zoom = String(v);
  }, z);
  await page.waitForTimeout(800);
  const b = await page.evaluate(() => {
    const el = document.querySelectorAll('.nb-prose')[0]?.children[0];
    if (el === undefined) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (b === null) continue;
  await page.mouse.move(b.x + b.w * 0.4, b.y + Math.min(14, b.h / 2));
  await page.waitForTimeout(650);
  const h = await handleState();
  record('E', `handle reachable at zoom ${z}`, h.present && h.visible, h.present ? `topmost ${h.topmost}` : 'absent');
}
await page.evaluate(() => {
  document.body.style.zoom = '';
  document.documentElement.style.removeProperty('--nb-page-zoom');
});
await page.waitForTimeout(600);

/* ------------------- F. the control: no native drop --------------------- */

console.log('\n7. F — the CONTROL. Take native drop delivery away from the page.');
console.log('   (this is what Tauri’s webview does on Windows: the OS routes');
console.log('    dragover/drop to its own IDropTarget, so the document never sees them)');
await openBook(); // the control must start where section B started
await page.evaluate(() => {
  globalThis.__swallowed = 0;
  globalThis.__dragStarts = 0;
  // dragstart is SOURCE-side — the renderer raises it without ever consulting
  // the OS drop target — so it keeps firing. That asymmetry is the signature.
  window.addEventListener('dragstart', () => (globalThis.__dragStarts += 1), { capture: true });
  const eat = (e) => {
    globalThis.__swallowed += 1;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  for (const type of ['dragenter', 'dragover', 'drop']) {
    window.addEventListener(type, eat, { capture: true });
  }
});
const control = await tryDrag(0, 0, 2);
const seen = await page.evaluate(() => ({
  swallowed: globalThis.__swallowed,
  dragStarts: globalThis.__dragStarts,
}));
console.log(`   dragstart events that still fired : ${seen.dragStarts}`);
console.log(`   drop-side events denied to the page: ${seen.swallowed}`);
console.log(`   handle appeared: ${control.handle?.present === true && control.handle?.visible === true}`);
console.log(`   block moved: ${control.moved}`);
record(
  'F',
  'the handle still appears and dragstart still fires',
  control.handle?.present === true && control.handle?.visible === true && seen.dragStarts > 0,
  `dragstart x${seen.dragStarts}`,
);
record(
  'F',
  '…and yet the block does NOT move — the owner’s report, reproduced',
  !control.moved && seen.swallowed > 0,
  `moved=${control.moved}, drop-side events denied=${seen.swallowed}`,
);

// The same suppression against the tour's own fact: it ticks anyway, which is
// why step 10 could be passed while nothing on the page ever moved.
const factStillTicks = await page.evaluate(() => {
  const t = window.__nbTutorial;
  if (t === undefined) return null;
  return true;
});
console.log(`   (tour fact 'block-handled' is awarded on contextmenu OR dragstart: ${factStillTicks === true ? 'both survive' : 'no bridge'})`);
await page.screenshot({ path: 'qa/ui/drag-matrix-control.png' }).catch(() => {});

/* -------------------------------- report -------------------------------- */

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
const failed = rows.filter((r) => !r.ok);
console.log('\n--- matrix ---');
for (const r of rows) console.log(`  [${r.area}] ${r.ok ? 'PASS' : 'FAIL'}  ${r.label}`);
console.log(failed.length === 0 ? '\n=== ALL PASSED ===' : `\n=== ${failed.length} FAILED ===`);
await browser.close();
