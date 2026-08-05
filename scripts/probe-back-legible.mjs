/**
 * scripts/probe-back-legible.mjs — can the reader still SEE the way out?
 *
 * The defect, found by looking at `qa/demo/frames/f0869.png`: with the Table
 * of contents sheet open, the only way out of a book is a pale grey arrow with
 * no words and no outline, sitting on the bare wall a hand's width from the
 * sheet's edge. It is DESIGNED to recede — the reader asked for a way back
 * that is *"placed in a way tasteful and goes away after it is used"*, and
 * spread.css fades it to a pencil mark — but at `opacity: 0.2` it had gone
 * past a pencil mark and into a smudge you have to already know about.
 *
 * ## Why this is measured optically and not off the stylesheet
 *
 * The receded arrow's ink, its plate and its alpha are three declarations in
 * two files, and the number a reader actually experiences is none of them: it
 * is what a 2.2px hand-drawn stroke composites to over whatever the wall is
 * painted this session. `check-control-contrast.mjs` cannot see it either —
 * that sweep gates rules that name a foreground AND a background in the same
 * block, and this rule names `background: transparent` over a Pixi canvas.
 *
 * So the probe takes the shot and reads the pixels:
 *
 *   - the DARKEST pixel inside the arrow's own box is the mark;
 *   - the MEDIAN pixel of a ring just outside that box is the ground it is
 *     drawn on (median, not mean: the ring straddles the wall and sometimes
 *     the sheet's edge, and one bright band must not drag the reading);
 *   - the WCAG ratio between them is what the reader gets.
 *
 * Gated at 3:1 — AA for a non-text mark, which is what an arrow glyph is. The
 * receded state before this fix measured about 1.3:1 on the wall, which is to
 * say invisible; the summoned state has always been fine and is measured too,
 * so a "fix" that simply stops the recede fails the second half of the run.
 *
 * Both states are also cropped out at 4x for a human to look at, because a
 * ratio says the mark is distinguishable and says nothing about whether it
 * reads as a door.
 *
 * Usage: node scripts/probe-back-legible.mjs [--url=http://localhost:1420]
 *                                            [--size=1440x900]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { contrastRatio } from './check-contrast.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const [WIDTH, HEIGHT] = opt('size', '1440x900').split('x').map(Number);

/** AA for a non-text mark. A glyph, not a word: 3:1, not 4.5:1. */
const AA_MARK = 3.0;

/** How far outside the arrow's box the ring that samples the ground sits, in CSS px. */
const RING_PAD_CSS = 14;

mkdirSync('qa/ui', { recursive: true });

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.log(`  FAIL  ${message}`);
};
const pass = (message) => console.log(`  ok    ${message}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

// The PNG decoder: an about:blank page with createImageBitmap, the same trick
// probe-return-to-shelf.mjs and shots-now/visual-suite.mjs use, so the repo
// needs no image dependency to read its own screenshots.
const cmp = await browser.newPage();
await cmp.goto('about:blank');

/**
 * Mark and ground, out of a shot of the whole window.
 *
 * The whole window and not `page.screenshot({ clip })`: a clip is given in CSS
 * px, comes back at the device scale, and is silently CLAMPED when it runs off
 * the glass — and the arrow lives 24px from the top edge, so a padded clip
 * around it is clamped every time and every offset inside it is then a lie.
 * Indexing into the full shot has no such edge case. `box` is the arrow's own
 * rect in DEVICE px; the ring is the same box grown by `pad`.
 */
async function sample(base64, inset) {
  return cmp.evaluate(
    async ([b64, box]) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const { data, width } = ctx.getImageData(0, 0, bmp.width, bmp.height);

      const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let mark = null;
      let markLum = Infinity;
      const groundLums = [];
      const groundPx = [];
      const y0 = Math.max(0, box.y - box.pad);
      const y1 = Math.min(bmp.height, box.y + box.h + box.pad);
      const x0 = Math.max(0, box.x - box.pad);
      const x1 = Math.min(bmp.width, box.x + box.w + box.pad);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          const px = { r: data[i], g: data[i + 1], b: data[i + 2] };
          const inside =
            x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
          const l = lum(px.r, px.g, px.b);
          if (inside) {
            // The mark is the darkest ink the stroke laid down. Antialiasing
            // makes most of a 2.2px stroke lighter than its own colour, and
            // the reader sees the stroke, not its skirt.
            if (l < markLum) {
              markLum = l;
              mark = px;
            }
          } else {
            groundLums.push(l);
            groundPx.push(px);
          }
        }
      }
      groundLums.sort((a, b) => a - b);
      const median = groundLums[Math.floor(groundLums.length / 2)];
      let ground = groundPx[0];
      let best = Infinity;
      for (const px of groundPx) {
        const d = Math.abs(lum(px.r, px.g, px.b) - median);
        if (d < best) {
          best = d;
          ground = px;
        }
      }
      return { mark, ground };
    },
    [base64, inset],
  );
}

const hex = (px) =>
  `#${[px.r, px.g, px.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
});
page.setDefaultTimeout(120_000);
const errors = new Map();
page.on('pageerror', (e) => {
  const key = e.message.split('\n')[0];
  errors.set(key, (errors.get(key) ?? 0) + 1);
});

// The first-run tour drives the app itself and eats the pointer stream, so its
// completion flag goes into the stub DB before the first navigation.
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
      // Storage refused; the stop() below is the backstop.
    }
  },
  ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
);

await page.goto(`${URL_BASE}/?fx=force&dev=1`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => window.__nbTutorial?.stop?.());
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 120_000 });
await page.waitForTimeout(1500);

const receded = async () =>
  page.evaluate(
    () => document.querySelector('.nb-back-button')?.classList.contains('is-away') ?? false,
  );

/** Park the pointer far from the corner and let the arrival linger expire. */
async function settle() {
  await page.mouse.move(WIDTH - 200, HEIGHT - 200);
  const t0 = Date.now();
  while (!(await receded())) {
    if (Date.now() - t0 > 20_000) throw new Error('the way back never receded');
    await page.waitForTimeout(200);
  }
}

/** Shoot the window, measure the corner, and leave a crop for a human. */
async function measure(label) {
  const rect = await page.evaluate((padCss) => {
    const el = document.querySelector('.nb-back-arrow');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    return {
      css: { x: Math.round(r.left), y: Math.round(r.top) },
      x: Math.round(r.left * dpr),
      y: Math.round(r.top * dpr),
      w: Math.round(r.width * dpr),
      h: Math.round(r.height * dpr),
      pad: Math.round(padCss * dpr),
    };
  }, RING_PAD_CSS);
  if (rect === null) {
    fail(`${label}: no back arrow in the DOM at all`);
    return;
  }
  const shot = await page.screenshot();
  const { mark, ground } = await sample(shot.toString('base64'), rect);
  const ratio = contrastRatio({ ...mark, a: 1 }, ground);
  const ok = ratio >= AA_MARK;
  const line = `${label}: mark ${hex(mark)} on ${hex(ground)} = ${ratio.toFixed(2)}:1 (arrow at ${rect.css.x},${rect.css.y})`;
  if (ok) pass(line);
  else fail(`${line} (needs ${AA_MARK}:1 — the way out is not visible)`);

  // The crop a human looks at: the corner the arrow lives in, the sheet's edge
  // beside it, and enough wall to judge whether the mark reads as a door.
  await page.screenshot({
    path: `qa/ui/back-legible-${label}.png`,
    clip: {
      x: Math.max(0, rect.css.x - 130),
      y: 0,
      width: 320,
      height: 90,
    },
  });
}

// The ninety-per-cent case first: a book open, nothing else out, the reader
// settled in. The corner is bare wall here, which is the hardest ground the
// mark has to hold.
await settle();
await measure('receded');

// Then frame 869's state exactly: the Table of contents sheet out, which
// carries the arrow right to the sheet's edge and stands a whole lit page of
// cream next to the one mark that leaves the book.
await page.click('.nb-rail-button[data-tool="toc"]');
await page.waitForTimeout(900);
await settle();
await measure('receded-beside-sheet');
await page.screenshot({ path: 'qa/ui/back-legible-window.png' });

// The other half: summoning it must still produce the whole paper tab, words
// and all. A "fix" that only ever draws the pencil mark fails here.
await page.hover('.nb-back-button');
await page.waitForTimeout(400);
await measure('summoned');

const label = await page.evaluate(() => {
  const el = document.querySelector('.nb-back-label');
  return el === null ? -1 : Number(getComputedStyle(el).opacity);
});
if (label > 0.9) pass(`summoned: the words are back (label opacity ${label})`);
else fail(`summoned: the label never came back (opacity ${label})`);

await page.screenshot({ path: 'qa/ui/back-legible-window-summoned.png' });

// Focus mode melts every piece of chrome away, this one included — and it is
// the one place the recede must NOT keep the mark. The two rules have the same
// specificity, so whichever lands later in spread.css wins the tie; the old
// receded `opacity: 0.2` was winning it and leaving a grey arrow floating in
// the melted room. Checked here because it is a tie no unit test can see.
await page.mouse.move(WIDTH - 200, HEIGHT - 200);
await page.keyboard.press('F9');
await page.waitForTimeout(600);
const inFocus = await page.evaluate(() => {
  const el = document.querySelector('.nb-back-button');
  return el === null ? -1 : Number(getComputedStyle(el).opacity);
});
if (inFocus === 0) pass('focus mode: the way back melts away with the rest of the chrome');
else fail(`focus mode: the way back is still at opacity ${inFocus}`);
await page.screenshot({ path: 'qa/ui/back-legible-window-focus.png' });
await page.keyboard.press('F9');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [key, n] of errors) console.log(`  x${n}  ${key}`);

console.log('\n=== verdict ===');
if (failures.length === 0) {
  console.log('the way back is legible at rest and whole when summoned');
} else {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
}
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
