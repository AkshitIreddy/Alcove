/**
 * shots-now/effects-sweep.mjs — every one of the 472 effect values, on paper,
 * at the size a reader sees it.
 *
 * Reader report: "fix and verify the effects, for example look at how weird
 * this effect is" — a tape/washi strip lying ACROSS the words. One value was
 * photographed; there are four hundred and seventy-one others and no reason to
 * think the photographed one is the only bad one. So this renders the lot.
 *
 * ## What a specimen is
 *
 * THREE paragraphs, not one. The reported defect is a decoration colliding
 * with text, and half the ways that happens are collisions with the block
 * BEFORE or AFTER — a strip hung at `top: -10px` lands on the previous line,
 * because prose blocks carry `margin: 0` and ride the rule grid with no air
 * between them. A one-paragraph specimen cannot show that and would have
 * passed the bug the washi axis actually shipped with.
 *
 * The measure, the body face, the size, the line height, the ink and the ruled
 * ground are all COPIED off the live `.nb-prose` in the open book, so a strip
 * that is 74px on a 690px column is 74px on a 690px column here. The scope is
 * `.nb-fx-specimen`, the second selector every rule in effects.css answers to
 * (`.nb-prose` is resolved document-wide by the tutorial and the e2e helpers,
 * so a decoy carrying that class in the corner of the app is a trap).
 *
 * ## What is measured, and what only the eye can do
 *
 * Each board is shot TWICE — once with the attribute, once without, nothing
 * else changed — and the two are differenced per tile. From the difference:
 *
 *   paint     share of the tile the effect changed at all. 0 is INVISIBLE:
 *             the value exists in the vocabulary and draws nothing.
 *   overText  share of the middle paragraph's INK pixels the effect changed by
 *             more than 40 levels. A decoration lying across the words scores
 *             high; one hanging above or behind them scores ~0. Some values
 *             SHOULD score high (a `paper` fills the block's ground, a marker
 *             underline sweeps behind the line) — the number is a place to
 *             look, not a verdict.
 *   neighbour share of the ink of the paragraphs ABOVE and BELOW that changed.
 *             This one has no legitimate high scorers: a decoration on a block
 *             must not touch its neighbours' words.
 *   escaped   share of changed pixels landing outside the styled block's
 *             border box grown by 28px — off the block entirely.
 *   clipped   changed pixels touching the tile's own edge: on a real page that
 *             is a decoration running off the paper.
 *
 * ALL BUT `paint` ARE SUPPRESSED when the effect moved the layout — a value
 * that gives its block a rule of air shifts every glyph in the tile, and a
 * pixel diff then reports the whole paragraph as "covered". See the note at
 * the comparison itself; it is the difference between 485 findings and four.
 *
 * The boards are written whatever the numbers say, because the report is a
 * VISUAL one and "0.03 of the ink moved" does not tell you whether a strip
 * looks like tape or looks like a mistake. For the axes that move the layout,
 * the board is the ONLY instrument.
 *
 * Usage:
 *   node shots-now/effects-sweep.mjs                  every axis
 *   node shots-now/effects-sweep.mjs --axis=tape      one axis
 *   node shots-now/effects-sweep.mjs --only=band,seam one value at a time
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const AXIS_FILTER = opt('axis', null);
const ONLY = opt('only', null)?.split(',').map((s) => s.trim());
const OUT = 'shots-now/effects-sweep';
mkdirSync(OUT, { recursive: true });

/** Axes whose values decorate a block — the ones the metrics below can judge. */
const TRIM_AXES = ['tape', 'washi', 'shadow', 'frame', 'paper', 'underline'];

/** Tiles per board. Two columns keeps the block at its real page measure. */
const COLS = 2;
const ROWS = 8;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(120_000);
page.on('console', (m) => {
  if (m.type() === 'error' && !/\[vite\]/.test(m.text())) {
    console.log('  [page error]', m.text().slice(0, 160));
  }
});

/* --------------------------------------------------------------- open a book */

async function openBook() {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });

  for (let i = 0; i < 4; i++) {
    const skip = page.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) break;
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  // Two clicks, not one. The a11y mirror's button PULLS the book out — it
  // stops in front of the case, and "the book itself is the button" from
  // there (PulledBookOverlay's header). An older flow put a "read it" plate
  // under the cover; it is tried second so this probe works either way.
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await page.locator('.nb-prose').count()) > 0) break;
    await page.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    const held = page.locator('[data-testid="pulled-book"]');
    await held.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {});
    if ((await held.count()) > 0) await held.click({ timeout: 8000 }).catch(() => {});
    const read = page.getByRole('button', { name: 'read it' });
    if ((await read.count()) > 0) await read.click().catch(() => {});
    await page.locator('.nb-prose').waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {});
  }
  await page.waitForSelector('.nb-prose p', { timeout: 30_000 });
}

let opened = false;
for (let attempt = 0; attempt < 4 && !opened; attempt++) {
  try {
    await openBook();
    opened = true;
  } catch (error) {
    console.log(`  open attempt ${attempt + 1} failed: ${String(error).split('\n')[0]}`);
    await page.waitForTimeout(2000);
  }
}
if (opened) await page.waitForTimeout(4000);

/* ------------------------------------------- lift the real page's typography */

/**
 * What a leaf of the open book measures, read off it once.
 *
 * The recorded fallback is what a run on 2026-08-04 measured — printed on
 * every run so it is never mistaken for a number somebody chose, and used only
 * when the book will not open (the dev server here is shared with other agents
 * and an HMR break can make the shelf unopenable for minutes at a time). The
 * boards are worth more than the wait; a run that fell back says so out loud.
 */
const MEASURED_PAGE = {
  width: 592,
  fontFamily: '"Patrick Hand", cursive',
  fontSize: '20px',
  lineHeight: '32px',
  letterSpacing: '0.01em',
  color: 'rgb(79, 49, 32)',
  band: '32px',
  paper: '#f7f1e3',
};

const pageStyle = opened
  ? await page.evaluate(() => {
      const prose =
        document.querySelector('.nb-flip-leaf-right .nb-prose') ??
        document.querySelector('.nb-prose');
      const cs = getComputedStyle(prose);
      const root = getComputedStyle(document.documentElement);
      return {
        width: Math.round(prose.getBoundingClientRect().width),
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        color: cs.color,
        band: root.getPropertyValue('--page-line-height').trim() || cs.lineHeight,
        paper: root.getPropertyValue('--paper-cream').trim() || '#f7f1e3',
      };
    })
  : MEASURED_PAGE;
if (!opened) {
  console.log('  !! the book would not open — falling back to the RECORDED page metrics');
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(4000);
}
console.log(
  `  page: ${pageStyle.width}px measure, ${pageStyle.fontSize} ` +
    `${pageStyle.fontFamily.split(',')[0]}, band ${pageStyle.band}` +
    `${opened ? ' (measured live)' : ' (RECORDED fallback)'}`,
);

const vocab = await page.evaluate(async () => {
  const v = await import('/src/editor/effects/vocabulary.ts');
  return v.EFFECT_AXES.map((axis) => ({
    key: axis.key,
    label: axis.label,
    shelf: axis.shelf,
    values: axis.values.map((entry) => entry.value),
  }));
});
console.log(`  vocabulary: ${vocab.reduce((n, a) => n + a.values.length, 0)} values across ${vocab.length} axes`);

/* -------------------------------------------------------------- board builder */

/**
 * Replace the document with one board and return each tile's geometry.
 *
 * `applied` false renders the identical board with the data-attribute left
 * off, which is the control every metric is measured against. Everything else — the
 * text, the widths, the fonts, the order — is byte-identical between the two
 * passes, so any pixel that moved moved because of the effect.
 */
async function renderBoard(axisKey, values, style, applied) {
  return page.evaluate(
    async ([key, vals, css, apply, cols]) => {
      if (globalThis.__fxStylesLoaded !== true) {
        // effects.css and editor.css are imported by components, not by the
        // entry, so a run that never mounted an editor would board up bare.
        await import('/src/styles/editor.css');
        await import('/src/styles/effects.css');
        globalThis.__fxStylesLoaded = true;
      }
      document.body.innerHTML = '';
      document.body.style.cssText = `margin:0;padding:0;background:${css.paper};overflow:hidden;`;

      // `.nb-prose p { margin: 0 }` — paragraphs ride the rule grid. It has to
      // be a STYLESHEET rule at that exact specificity (0,1,1), not an inline
      // style on the paragraph: several axes give a block a rule of air with
      // `margin-top` from a (0,2,0) selector, and an inline `margin:0` beats
      // every one of them. The first cut of this probe did exactly that and
      // reported the whole washi axis as landing on the line above, which is a
      // defect washi had already been fixed for. The probe was the bug.
      if (document.getElementById('fx-sweep-grid') === null) {
        const grid = document.createElement('style');
        grid.id = 'fx-sweep-grid';
        grid.textContent = '.nb-fx-specimen p { margin: 0; }';
        document.head.appendChild(grid);
      }

      const board = document.createElement('div');
      board.style.cssText =
        `display:grid;grid-template-columns:repeat(${cols},max-content);` +
        `gap:26px 40px;padding:26px;background:${css.paper};width:max-content;`;

      const rects = {};
      for (const value of vals) {
        const cell = document.createElement('div');
        cell.style.cssText = `width:${css.width}px;`;

        const tag = document.createElement('div');
        tag.textContent = `${key}=${value}`;
        tag.style.cssText =
          'font:600 11px/16px system-ui,sans-serif;color:#7a6a55;letter-spacing:.06em;' +
          'margin-bottom:4px;text-transform:uppercase;';

        // The page-shaped fragment. `.nb-fx-specimen` is the scope effects.css
        // answers to; the inline properties are the live page's own, read off
        // `.nb-prose` before the app was dismantled.
        const host = document.createElement('div');
        host.className = 'nb-fx-specimen';
        host.dataset.fxTile = value;
        host.style.cssText =
          `font-family:${css.fontFamily};font-size:${css.fontSize};` +
          `line-height:${css.lineHeight};letter-spacing:${css.letterSpacing};` +
          `color:${css.color};--page-line-height:${css.band};` +
          // A rule of air above and below, and the page's own side padding
          // (`.nb-page` keeps 40px): a fastener or a hinge that lives in the
          // margin has somewhere to live, and a mark clipped by the tile edge
          // means the mark really is off the paper.
          `background:${css.paper};padding:${css.band} 40px;` +
          `background-image:repeating-linear-gradient(to bottom,transparent 0 calc(${css.band} - 1px),` +
          `color-mix(in srgb, var(--paper-edge) 55%, transparent) calc(${css.band} - 1px) ${css.band});` +
          `background-position:0 0;`;

        const para = (text, styled) => {
          const p = document.createElement('p');
          p.textContent = text;
          if (styled && apply) p.setAttribute(`data-${key}`, value);
          if (styled) p.dataset.fxSubject = 'true';
          else p.dataset.fxNeighbour = 'true';
          return p;
        };
        // The subject wraps to TWO lines: a one-line block flatters nothing
        // (every full-height decoration would look like it crosses the text)
        // and a long one hides an overhang in its own white space. Two is the
        // ordinary paragraph on this page.
        host.append(
          para('The line above, so a strip that hangs too high shows.', false),
          para(
            'Pack my box with five dozen liquor jugs, and then a second line so ' +
              'the block is an ordinary paragraph rather than a single rule.',
            true,
          ),
          para('The line below, for anything that reaches downward.', false),
        );

        cell.append(tag, host);
        board.appendChild(cell);
      }
      document.body.appendChild(board);
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      for (const host of board.querySelectorAll('[data-fx-tile]')) {
        const r = host.getBoundingClientRect();
        const subject = host.querySelector('[data-fx-subject]').getBoundingClientRect();
        rects[host.dataset.fxTile] = {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          block: {
            x: Math.round(subject.x),
            y: Math.round(subject.y),
            w: Math.round(subject.width),
            h: Math.round(subject.height),
          },
          neighbours: [...host.querySelectorAll('[data-fx-neighbour]')].map((n) => {
            const nr = n.getBoundingClientRect();
            return {
              x: Math.round(nr.x),
              y: Math.round(nr.y),
              w: Math.round(nr.width),
              h: Math.round(nr.height),
            };
          }),
        };
      }
      return { rects, width: document.body.scrollWidth, height: document.body.scrollHeight };
    },
    [axisKey, values, style, applied, COLS],
  );
}

/**
 * Difference two shots of the same board, per tile.
 *
 * Decoded inside the page — there is no PNG decoder in this tree, and the
 * browser is already open.
 */
async function diffBoard(plainPng, effectPng, rects) {
  return page.evaluate(
    async ([a, b, boxes]) => {
      const load = async (data) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const plain = await load(a);
      const effect = await load(b);
      const W = plain.width;
      const H = plain.height;
      const lum = (px, i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const diffAt = (i) =>
        Math.max(
          Math.abs(plain.data[i] - effect.data[i]),
          Math.abs(plain.data[i + 1] - effect.data[i + 1]),
          Math.abs(plain.data[i + 2] - effect.data[i + 2]),
        );

      const out = {};
      for (const [value, box] of Object.entries(boxes)) {
        // The tile plus the gutter around it: a decoration that escapes has to
        // be visible in the window it escaped into.
        const x0 = Math.max(0, box.x - 20);
        const y0 = Math.max(0, box.y - 20);
        const x1 = Math.min(W, box.x + box.w + 20);
        const y1 = Math.min(H, box.y + box.h + 20);
        if (x1 <= x0 || y1 <= y0) continue;

        // Paper luminance of this tile at rest — the reference for "is this
        // pixel ink". Taken as the 90th percentile so glyphs cannot drag it.
        const sample = [];
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) sample.push(lum(plain.data, (y * W + x) * 4));
        }
        sample.sort((p, q) => p - q);
        const paperLum = sample[Math.floor(sample.length * 0.9)] ?? 240;
        const inkFloor = paperLum - 55;

        const grown = { x: box.block.x - 28, y: box.block.y - 28, w: box.block.w + 56, h: box.block.h + 56 };
        const inside = (x, y) =>
          x >= grown.x && x < grown.x + grown.w && y >= grown.y && y < grown.y + grown.h;
        const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

        let total = 0;
        let changed = 0;
        let escaped = 0;
        let subjectInk = 0;
        let subjectHit = 0;
        let neighbourInk = 0;
        let neighbourHit = 0;
        let touchesEdge = 0;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            total++;
            const d = diffAt(i);
            const isInk = lum(plain.data, i) < inkFloor;
            if (isInk && inRect(box.block, x, y)) {
              subjectInk++;
              if (d > 40) subjectHit++;
            }
            if (isInk && box.neighbours.some((n) => inRect(n, x, y))) {
              neighbourInk++;
              if (d > 40) neighbourHit++;
            }
            if (d <= 6) continue;
            changed++;
            if (!inside(x, y)) escaped++;
            if (x <= x0 + 1 || x >= x1 - 2 || y <= y0 + 1 || y >= y1 - 2) touchesEdge++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }

        out[value] = {
          paint: +(changed / total).toFixed(4),
          overText: subjectInk === 0 ? 0 : +(subjectHit / subjectInk).toFixed(3),
          neighbour: neighbourInk === 0 ? 0 : +(neighbourHit / neighbourInk).toFixed(3),
          escaped: changed === 0 ? 0 : +(escaped / changed).toFixed(3),
          clipped: touchesEdge,
          bbox:
            changed === 0
              ? null
              : { x: minX - box.x, y: minY - box.y, w: maxX - minX + 1, h: maxY - minY + 1 },
        };
      }
      return out;
    },
    [plainPng.toString('base64'), effectPng.toString('base64'), rects],
  );
}

/* -------------------------------------------------------------------- sweep */

const findings = [];
const rows = [];

for (const axis of vocab) {
  if (AXIS_FILTER && axis.key !== AXIS_FILTER) continue;
  const values = ONLY ? axis.values.filter((v) => ONLY.includes(v)) : axis.values;
  if (values.length === 0) continue;
  const judged = TRIM_AXES.includes(axis.key);
  const perBoard = COLS * ROWS;

  for (let start = 0; start < values.length; start += perBoard) {
    const slice = values.slice(start, start + perBoard);
    const boardNo = Math.floor(start / perBoard) + 1;
    const name = `${axis.key}-${String(boardNo).padStart(2, '0')}`;

    const plainInfo = await renderBoard(axis.key, slice, pageStyle, false);
    await page.setViewportSize({
      width: Math.min(2400, plainInfo.width),
      height: Math.min(2400, plainInfo.height),
    });
    await page.waitForTimeout(150);
    const plainShot = await page.screenshot({ fullPage: true });

    const info = await renderBoard(axis.key, slice, pageStyle, true);
    await page.waitForTimeout(150);
    const shot = await page.screenshot({ fullPage: true });
    writeFileSync(`${OUT}/${name}.png`, shot);

    const stats = judged ? await diffBoard(plainShot, shot, info.rects) : {};
    for (const value of slice) {
      const s = stats[value];
      /*
       * DOES THE PIXEL DIFF MEAN ANYTHING FOR THIS VALUE?
       *
       * Only if the effect left the layout alone. Several axes give the block
       * a rule of air (`margin-top`) or turn it into a padded card, and then
       * every glyph in the tile has MOVED between the two shots: the diff
       * lights up on all of it and reports "lies across its own words, 99.9%",
       * which is a statement about the paragraph having been nudged 32px down,
       * not about anything lying across anything. The first version of this
       * probe printed 485 such findings and every one of them was noise.
       *
       * So the subject's own rect is compared between the passes, and when it
       * moved the numbers are recorded but not turned into findings — the
       * board is the instrument for those. `paint === 0` survives either way:
       * a value that draws nothing moves nothing either.
       */
      const before = plainInfo.rects[value]?.block;
      const after = info.rects[value]?.block;
      const layoutMoved =
        before === undefined ||
        after === undefined ||
        Math.abs(before.y - after.y) > 1 ||
        Math.abs(before.h - after.h) > 1 ||
        Math.abs(before.w - after.w) > 1;
      rows.push({ axis: axis.key, value, board: name, layoutMoved, ...(s ?? {}) });
      if (!judged || s === undefined) continue;
      if (s.paint === 0) {
        findings.push({ axis: axis.key, value, board: name, why: 'INVISIBLE — draws nothing' });
      }
      if (layoutMoved) continue; // see above — the rest cannot be read here
      if (s.neighbour > 0.02) {
        findings.push({
          axis: axis.key,
          value,
          board: name,
          why: `lands on the NEIGHBOURING paragraphs' words (${(s.neighbour * 100).toFixed(1)}% of their ink moved)`,
        });
      }
      if (s.overText > 0.35) {
        findings.push({
          axis: axis.key,
          value,
          board: name,
          why: `lies across its own words (${(s.overText * 100).toFixed(1)}% of the block's ink moved)`,
        });
      }
      if (s.escaped > 0.25 && s.paint > 0.0005) {
        findings.push({
          axis: axis.key,
          value,
          board: name,
          why: `${(s.escaped * 100).toFixed(0)}% of what it draws is off the block`,
        });
      }
    }
    console.log(
      `  ${name}: ${slice.length} values, board ${plainInfo.width}x${plainInfo.height}` +
        (judged ? '' : ' (lettering/colour — eye only)'),
    );
  }
}

writeFileSync(`${OUT}/report.json`, JSON.stringify({ pageStyle, rows, findings }, null, 2));

console.log(`\n  ${rows.length} values rendered, boards in ${OUT}/`);
if (findings.length === 0) {
  console.log('  nothing flagged by measurement — the boards still need looking at.');
} else {
  console.log(`\n  ${findings.length} flagged:`);
  for (const f of findings) console.log(`    ${f.axis}=${f.value.padEnd(14)} ${f.why}   [${f.board}]`);
}
await browser.close();
