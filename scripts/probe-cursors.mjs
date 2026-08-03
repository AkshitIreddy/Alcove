/**
 * scripts/probe-cursors.mjs — the drawn cursors, on the real app.
 *
 * `scripts/board-cursors.mjs` proves the art draws well. This proves a chosen
 * set REACHES the app, which is a different question and the one that fails:
 * `cursor` is stated 117 times across `src/styles/`, plus inline by
 * `world.ts`, and every one of those beats an inherited value. So this asserts
 * on the APPLIED state (getComputedStyle) — never on what was merely saved —
 * over the three surfaces that each break differently:
 *
 *   - a shelf/rail button   a `cursor: pointer` in the app's own stylesheet,
 *                           rewritten by the sweep in features/settings/cursorSkin.ts
 *   - the Pixi canvas       an INLINE `cursor: grab` / `grabbing` written on
 *                           every pointer move — the hardest case, and the one
 *                           that matters most, because books drag out of the shelf
 *   - the editor prose      no rule at all: UA `auto`, which cursors.css has to
 *                           put back as a text cursor once <html> carries an arrow
 *
 * It then flips to `system` and asserts every one of them is a bare keyword
 * again, measures every hotspot against the drawn ink (a click lands where the
 * mouse is whatever the hotspot says, so "click a small target" can never fail
 * for a wrong hotspot — what a wrong hotspot does is put the drawn TIP
 * somewhere else, which is a thing you have to rasterise and measure), and
 * drives the settings picker by clicking it.
 *
 * Usage: node scripts/probe-cursors.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = opt('out', 'qa/ui');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 1,
});
const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

const poll = async (fn, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(
  () => typeof globalThis.__shelfSaveSettings === 'function',
  120000,
  'settings bridge',
);
await poll(() => document.querySelector('canvas') !== null, 120000, 'canvas');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1500);

const setCursorSet = async (id) => {
  await page.evaluate((id) => globalThis.__shelfSaveSettings({ cursorSet: id }), id);
  await page.waitForTimeout(500);
};

const probe = () =>
  page.evaluate(() => {
    const root = document.documentElement;
    const canvas = document.querySelector('canvas.shelf-canvas');
    const btn =
      document.querySelector('.nb-dock-btn') ??
      document.querySelector('button:not(:disabled)');
    const cs = (el) => (el === null ? null : getComputedStyle(el).cursor);
    return {
      attr: root.getAttribute('data-cursor-set'),
      rootVar: root.style.getPropertyValue('--nb-cur-default').slice(0, 40),
      html: cs(root),
      body: cs(document.body),
      canvasInline: canvas?.getAttribute('style') ?? null,
      canvas: cs(canvas),
      button: cs(btn),
      buttonTag: btn?.className ?? null,
      overrideRules: (document.getElementById('nb-cursor-overrides')?.textContent ?? '')
        .split('\n').length,
    };
  });

const isDrawn = (v) => typeof v === 'string' && v.startsWith('url("data:image/svg+xml');

/* ---------------- a drawn set on the shelf ---------------- */
await setCursorSet('quill');
let s = await probe();
console.log(JSON.stringify(s, null, 2).slice(0, 1400));
check('attribute reaches <html>', s.attr === 'quill', s.attr);
check('root default arrow is drawn', isDrawn(s.html), s.html?.slice(0, 34));
check('a real app button gets the drawn hand', isDrawn(s.button), `${s.buttonTag}`);
check('the sweep produced rules', s.overrideRules > 30, `${s.overrideRules} lines`);
check(
  'the Pixi canvas inline grab is overridden',
  isDrawn(s.canvas),
  `inline=${s.canvasInline} computed=${String(s.canvas).slice(0, 30)}`,
);

/* ---------------- the shelf's own grab, which is set INLINE ---------------- */
// world.ts writes `canvas.style.cursor` on pointer move and nowhere else, so
// the inline declaration this feature has to beat does not exist until the
// mouse has been over the shelf. Probing without moving first "passes" by
// inheriting the root arrow, which proves nothing about the hard case.
const canvasBox = await page.locator('canvas.shelf-canvas').boundingBox();
await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
await page.waitForTimeout(400);
let g = await probe();
await page.mouse.down();
await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 40, canvasBox.y + canvasBox.height / 2 + 10);
await page.waitForTimeout(300);
g = await probe();
check(
  'mid-drag it swaps to the drawn fist',
  /cursor:\s*grabbing/.test(g.canvasInline ?? '') && isDrawn(g.canvas),
  g.canvasInline,
);
await page.mouse.up();
await page.waitForTimeout(400);
g = await probe();
check(
  'at rest the canvas is on an inline grab',
  /cursor:\s*grab;/.test(g.canvasInline ?? ''),
  g.canvasInline,
);
check('...and the drawn open hand wins over it', isDrawn(g.canvas), String(g.canvas).slice(0, 34));

/* ---------------- system gives everything back ---------------- */
await setCursorSet('system');
s = await probe();
check('system: attribute says so', s.attr === 'system', s.attr);
// `auto` is right and `default` would be WRONG here: `auto` is what a browser
// gives an I-beam over selectable text, and a reader on the system set must
// keep exactly that.
check('system: root is back to the UA default', s.html === 'auto', s.html);
check('system: the button is a bare keyword', s.button === 'pointer', s.button);
check(
  'system: the canvas is a bare keyword',
  s.canvas === 'grab' || s.canvas === 'grabbing' || s.canvas === 'auto',
  s.canvas,
);


/* ---------------- the same, over a page ---------------- */
await setCursorSet('paper');
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const cases = await import('/src/data/bookcases.ts');
  const active = await books.readActiveBookcaseId();
  const list = await books.listBooksInBookcase(active);
  void cases;
  if (list[0] !== undefined) app.appState.openBook(list[0].id);
});
let prose = null;
try {
  await page.waitForSelector('.nb-prose', { timeout: 30000 });
  prose = await page.evaluate(() => getComputedStyle(document.querySelector('.nb-prose')).cursor);
} catch {
  prose = null;
}
if (prose !== null) {
  check('prose keeps a text cursor, drawn', isDrawn(prose), prose.slice(0, 34));
  await page.screenshot({ path: `${OUT}/book-open.png` });
  // The editor's own writing cursor is a SEPARATE, finer-grained setting and
  // must still win inside a page. If the sweep or the :where() text rule had
  // outranked it, picking a quill to write with would silently stop working.
  await page.evaluate(() => globalThis.__shelfSaveSettings({ cursorStyle: 'quill' }));
  await page.waitForTimeout(500);
  const writing = await page.evaluate(() => {
    const el = document.querySelector('.nb-prose');
    return {
      attr: document.querySelector('.nb-book-view')?.getAttribute('data-cursor'),
      cur: getComputedStyle(el).cursor,
    };
  });
  check(
    'the editor’s own quill still beats the app-wide text cursor',
    writing.attr === 'quill' &&
      isDrawn(writing.cur) &&
      writing.cur !== prose &&
      writing.cur.trimEnd().endsWith('text'),
    JSON.stringify(writing).slice(0, 120),
  );
  await page.evaluate(() => globalThis.__shelfSaveSettings({ cursorStyle: 'standard' }));
} else {
  check('prose keeps a text cursor, drawn', false, 'no .nb-prose on screen');
}
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);

/* ---------------- the picker in the settings sheet ---------------- */
await page.locator('.nbs-gear-button').click();
await page.waitForTimeout(900);
const cards = await page.locator('.nb-cursorset-card:visible').count();
check('the picker is in the sheet', cards >= 7, `${cards} cards`);

if (cards > 0) {
  await page.locator('.nb-cursorset-card').nth(4).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.locator('.nb-cursorset-card').nth(4).click();
  await page.waitForTimeout(500);
  await page.locator('.nb-cursorset').scrollIntoViewIfNeeded();
  const pickerBox = await page.locator('.nb-cursorset-group').boundingBox();
  await page.screenshot({
    path: `${OUT}/picker-closeup.png`,
    clip: {
      x: pickerBox.x - 12,
      y: pickerBox.y - 30,
      width: pickerBox.width + 24,
      height: pickerBox.height + 42,
    },
  });
  const after = await probe();
  check(
    'clicking a card applies it',
    after.attr !== 'system' && isDrawn(after.html),
    `${after.attr}`,
  );
  const states = await page.locator('.nb-cursorset-state').count();
  check('the state strip shows every state', states === 16, `${states}`);
  const sheet = page.locator('.nbs-sheet, .nbs-panel, [class*="nbs"]').first();
  await page.screenshot({ path: `${OUT}/settings-picker.png` });
  console.log('shot ->', `${OUT}/settings-picker.png`);
  void sheet;
}

/* ---------------- hotspot: measured against the drawn ink ---------------- */
// The honest check. A click lands wherever the mouse is regardless of the
// hotspot, so "click a small target" can never FAIL for a wrong hotspot — what
// a wrong hotspot does is put the drawn tip somewhere other than the point the
// click uses. So: rasterise each cursor at 1:1, find the ink, and measure.
const hotspots = await page.evaluate(async () => {
  const m = await import('/src/art/cursors.ts');
  const load = (url) =>
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
  const out = [];
  for (const set of m.CURSOR_SET_IDS) {
    if (set === 'system') continue;
    for (const role of m.CURSOR_ROLES) {
      const img = m.cursorImage(set, role);
      const el = await load(img.url);
      const c = document.createElement('canvas');
      c.width = img.size;
      c.height = img.size;
      const ctx = c.getContext('2d');
      ctx.drawImage(el, 0, 0, img.size, img.size);
      const data = ctx.getImageData(0, 0, img.size, img.size).data;
      const opaque = (x, y) =>
        x >= 0 && y >= 0 && x < img.size && y < img.size &&
        data[(y * img.size + x) * 4 + 3] > 60;
      // nearest ink to the hotspot
      let near = 99;
      for (let dy = -6; dy <= 6; dy += 1) {
        for (let dx = -6; dx <= 6; dx += 1) {
          if (opaque(img.hotspot[0] + dx, img.hotspot[1] + dy)) {
            near = Math.min(near, Math.hypot(dx, dy));
          }
        }
      }
      // the drawn tip: the opaque pixel closest to the top-left corner
      let tip = null;
      let best = Infinity;
      for (let y = 0; y < img.size; y += 1) {
        for (let x = 0; x < img.size; x += 1) {
          if (!opaque(x, y)) continue;
          if (x + y < best) {
            best = x + y;
            tip = [x, y];
          }
        }
      }
      out.push({ set, role, size: img.size, hotspot: img.hotspot, near, tip });
    }
  }
  return out;
});

const floating = hotspots.filter((h) => h.near > 3.5);
check(
  'every hotspot sits on the drawn ink',
  floating.length === 0,
  floating.map((h) => `${h.set}/${h.role} ${h.near.toFixed(1)}px away`).join(', '),
);

const pointing = hotspots.filter((h) => h.role === 'default' || h.role === 'progress');
const offTip = pointing.filter(
  (h) => Math.hypot(h.tip[0] - h.hotspot[0], h.tip[1] - h.hotspot[1]) > 3.5,
);
check(
  'every arrow’s hotspot is at its drawn tip',
  offTip.length === 0,
  offTip
    .map((h) => `${h.set}/${h.role} tip=${h.tip} hotspot=${h.hotspot}`)
    .join(', ') ||
    pointing.map((h) => `${h.set} tip=${h.tip}`).join(' '),
);

// And the value the browser actually computed is the value the art module
// built — no rounding lost on the way through the custom property.
const roundTrip = await page.evaluate(async () => {
  const m = await import('/src/art/cursors.ts');
  const root = document.documentElement;
  const set = root.getAttribute('data-cursor-set');
  return {
    set,
    same: getComputedStyle(root).cursor === m.cursorValue(set, 'default'),
  };
});
check(
  'the applied value is byte-identical to the drawn one',
  roundTrip.same,
  roundTrip.set,
);

/* ---------------- hotspot: click a small target ---------------- */
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await setCursorSet('paper');
const hot = await page.evaluate(() => {
  const root = document.documentElement;
  const value = getComputedStyle(root).cursor;
  const m = value.match(/\)\s+(\d+)\s+(\d+)\s*,/);
  return m === null ? null : { x: Number(m[1]), y: Number(m[2]), value: value.slice(-40) };
});
check('the applied value carries a hotspot', hot !== null, JSON.stringify(hot));

// A real small target, clicked at a real coordinate: the click has to land on
// the element under the POINT, which is what the hotspot is supposed to mark.
const target = page.locator('.nb-dock-btn').first();
if (await target.count()) {
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  const under = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return { tag: el?.tagName, cls: el?.className, cur: el && getComputedStyle(el).cursor.slice(0, 30) };
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  check(
    'a small target under the pointer reports the drawn hand',
    isDrawn(under.cur ?? ''),
    JSON.stringify(under).slice(0, 160),
  );
}

if (errors.size > 0) console.log('page errors:', [...errors.entries()]);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
