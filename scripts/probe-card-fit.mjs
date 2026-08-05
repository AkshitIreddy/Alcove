/**
 * scripts/probe-card-fit.mjs — does a block's box actually HOLD its own words?
 *
 * The defect this exists for was found by looking at a frame of the recorded
 * demo (qa/demo/frames/f1198.png). Two containers on that spread were not the
 * size of what they contained:
 *
 *   1. the `postcard` on the postal-drawer page — its last line of message,
 *      "front, as usual.", is struck through by the card's own bottom border;
 *   2. the middle caption of the kitten `image-row` — "On the good chair" is
 *      cut mid-word to "On the good c", with nothing to say it was cut.
 *
 * Neither is visible from the source. Both boxes are declared with a
 * `min-height` or a `width: 100%` that reads as generous, and both are told
 * the truth only by laying real words out in them and measuring.
 *
 * What it found, and what the fixes are:
 *
 *   - the CAPTION was truly truncated, in the live DOM, at every window size:
 *     107px of Kalam in a 102px `<input>`, which neither wraps nor elides. It
 *     is a wrapping `<textarea>` now, and this probe fails if a caption's own
 *     box hides any of it.
 *   - the POSTCARD grows to hold its message perfectly well — measured at
 *     five, six and eighteen lines. What it did not do was keep the message on
 *     its own half: the reserve for the address side stopped 16px SHORT of the
 *     printed divider, so every full line was set through the rule. The frame
 *     itself is a page-flip RASTER artifact (the card is drawn there at its
 *     176px minimum while holding six lines, which no live layout can produce
 *     — a live card at six lines is 232px); that lives in src/flip, not here.
 *
 * ## What it measures
 *
 * Everything is LAID-OUT px (`offsetHeight` / `clientWidth` / `offsetLeft`),
 * never `getBoundingClientRect`: a leaf carries a 3D transform, so drawn px
 * and CSS px differ by whatever the spread is scaled to, and only laid-out px
 * are in the same units as the CSS the fix is written in.
 *
 *   - postcard: `overflowY = scrollHeight − clientHeight` and the gap from the
 *     last inner paragraph to the card's inner floor (a card that grew to fit
 *     reports 0 and 0), plus `pastRule` — how far the message's own content
 *     box runs past the divider at 50%, which is > 0 exactly when the message
 *     is being printed into the address lines.
 *   - caption: the text measured in the field's own font against the box it is
 *     given, and the field's hidden height. NOT `scrollWidth`: a form control
 *     reports its own client width there however much it is clipping, so the
 *     obvious measurement is the one that cannot see this bug.
 *
 * The specimen is built through the REAL authored path (`createBookFromScript`,
 * what the Markdown import and the templates gallery both call) with the
 * welcome book's own words, so the thing measured is the thing in the demo.
 *
 * Window size MATTERS here and is a parameter for that reason. A leaf is a
 * fraction of the window, the message column is a fraction of the leaf, and
 * the wrap point moves with both — the card holds its five lines at 1600×1000
 * with six pixels to spare and takes a sixth line at 1360×850, which is the
 * size the demo was recorded at (shots-now/demo-gif.mjs). A fit probe run at
 * one width proves nothing about the width the reader has.
 *
 * Usage: node scripts/probe-card-fit.mjs [outDir]
 *   URL=http://localhost:1420   the already-running dev server
 *   SIZES=1360x850,1600x1000    windows to measure at
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/card-fit';
const URL_BASE = process.env.URL ?? 'http://localhost:1420';
mkdirSync(outDir, { recursive: true });

const KITTENS = {
  ginger: '/kittens/ginger.svg',
  asleep: '/kittens/asleep.svg',
  box: '/kittens/in-a-box.svg',
};

/*
 * The words are the welcome book's, verbatim (src/data/seed.ts pages 10 and
 * 12) — a specimen written shorter would fit, and one written longer would
 * prove a defect the reader never actually meets — plus one deliberately long
 * postcard and one row of deliberately long captions, so the growing and the
 * wrapping are seen doing their work rather than merely not failing.
 *
 * The long postcard holds `LONG` below — the same 287 characters the split
 * estimator is calibrated against (tests/split-calibration.test.ts), so the
 * card's cost in page lines can be re-read here whenever its column changes
 * width. That number is `postcard.chars` in features/templates/split.ts, and
 * it is measured rather than derived.
 */
const LONG =
  'Lx and then a good deal more of it, because a container is narrower than ' +
  'the leaf it stands on and the only way to learn how much narrower is to ' +
  'let a real sentence wrap inside one and count the lines it took to say ' +
  'itself, which is what this paragraph is doing right now on your behalf.';

const SCRIPT = `# The postal drawer

::: postcard {title="WISH YOU WERE HERE"}
Message on the left, address lines on the right, and no room for either. Ran out on the front, as usual.
:::

# A long one

::: postcard {title="WISH YOU WERE HERE"}
${LONG}
:::

# Pictures

::: image-row {cols=3}
![A ginger kitten](${KITTENS.ginger}){caption="Has plans"}
![A grey kitten asleep](${KITTENS.asleep}){caption="On the good chair"}
![A cream kitten in a box](${KITTENS.box}){caption="His box now"}
:::

# Longer captions

::: image-row {cols=3}
![A ginger kitten](${KITTENS.ginger}){caption="Has plans, and will not be told otherwise"}
![A grey kitten asleep](${KITTENS.asleep}){caption="On the good chair, all afternoon"}
![A cream kitten in a box](${KITTENS.box}){caption="His box now, and the lid is his too"}
:::
`;


const SIZES = (process.env.SIZES ?? '1360x850,1600x1000').split(',').map((pair) => {
  const [width, height] = pair.split('x').map(Number);
  return { width, height };
});

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const ctx = await b.newContext({
  viewport: SIZES[0],
  deviceScaleFactor: 1,
});
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('  page error:', e.message));

const skipTour = async () => {
  for (let i = 0; i < 30; i++) {
    const skip = p.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) {
      if (i > 2) break;
    } else {
      await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    }
    await p.waitForTimeout(700);
  }
};

const settle = async () => {
  await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    polling: 500,
    timeout: 90_000,
  });
  await p.waitForTimeout(4000);
  await skipTour();
};

await p.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await settle();

const made = await p.evaluate(async (source) => {
  const mod = await import('/src/features/templates/createFromScript.ts');
  const res = await mod.createBookFromScript(source, 'Card fit');
  return { id: res.book.id, title: res.book.title, pages: res.pages.length };
}, SCRIPT);
console.log(`  specimen book: "${made.title}" — ${made.pages} pages`);

/** Pull the specimen off the shelf by its own label and open it. */
const openBook = async () => {
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await p.locator('.nb-book-view').count()) > 0) break;
    if ((await p.locator('[data-testid="pulled-book-hand"]').count()) === 0) {
      await p
        .locator('.shelf-a11y button', { hasText: made.title })
        .first()
        .dispatchEvent('click')
        .catch(() => {});
      await p
        .locator('[data-testid="pulled-book-hand"]')
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => {});
    }
    await p.keyboard.press('Enter');
    await p.waitForTimeout(2500);
  }
  await p
    .locator('.nb-leaf-paper')
    .first()
    .waitFor({ state: 'visible', timeout: 40_000 })
    .catch(() => {});
  await p.waitForTimeout(3000);
  return (await p.locator('.nb-book-view').count()) > 0;
};

/**
 * Both boxes, in laid-out px. `clientHeight`/`offsetLeft` rather than a
 * bounding rect: a leaf carries a 3D transform, and drawn px are the CSS px
 * the fix is written in only after dividing by whatever the spread is scaled
 * to. These do not need dividing.
 */
const read = () =>
  p.evaluate(() => {
    const cards = [];
    for (const el of document.querySelectorAll('[data-type="postcard"]')) {
      const cs = getComputedStyle(el);
      const kids = Array.from(el.children).filter(
        (k) => !k.classList.contains('ProseMirror-trailingBreak'),
      );
      const last = kids[kids.length - 1];
      const padBottom = Number.parseFloat(cs.paddingBottom) || 0;
      const lastBottom =
        last === undefined
          ? 0
          : last.offsetTop +
            last.offsetHeight +
            (Number.parseFloat(getComputedStyle(last).marginBottom) || 0);
      /*
       * The divider is drawn at 50% of the card by the ::before, so where the
       * message's own content box ends relative to that is the whole question
       * of whether the message stays on its half.
       */
      const columnRight = last === undefined ? 0 : last.offsetLeft + last.clientWidth;
      /* Cost in page lines, for the split estimator's table. */
      const prose = el.closest('.nb-prose');
      const line = prose === null ? 32 : Number.parseFloat(getComputedStyle(prose).lineHeight) || 32;
      const own =
        el.offsetHeight +
        (Number.parseFloat(cs.marginTop) || 0) +
        (Number.parseFloat(cs.marginBottom) || 0);
      cards.push({
        text: (el.textContent ?? '').trim().slice(0, 40),
        client: el.clientHeight,
        scroll: el.scrollHeight,
        overflowY: el.scrollHeight - el.clientHeight,
        /* Room left between the last word and the card's inner floor. */
        gap: el.clientHeight - padBottom - lastBottom,
        pastRule: columnRight - el.clientWidth / 2,
        columnW: last === undefined ? 0 : last.clientWidth,
        lines:
          last === undefined
            ? 0
            : Math.round(
                last.offsetHeight /
                  (Number.parseFloat(getComputedStyle(last).lineHeight) || 1),
              ),
        pageLines: own / line,
        minHeight: cs.minHeight,
        padBottom,
      });
    }

    /*
     * A caption's overflow CANNOT be read off scrollWidth: a form control
     * reports its own client width there whatever is inside it (measured —
     * "On the good chair" in a 102px box reported 102/102 while showing "On
     * the good chai"). So the text is measured in the field's own font and
     * compared with the box, which is the question actually being asked.
     */
    const caps = [];
    for (const el of document.querySelectorAll('.nb-image-caption')) {
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const value = el.value ?? el.textContent ?? '';
      const widest = Math.max(
        0,
        ...value.split(/\s+/).map((word) => Math.ceil(ctx.measureText(word).width)),
      );
      caps.push({
        tag: el.tagName.toLowerCase(),
        value,
        client: el.clientWidth,
        /* One line of it, laid out flat — what an unwrapped field would need. */
        textW: Math.ceil(ctx.measureText(value).width),
        /* The longest single word: what even a wrapping box has to hold. */
        widest,
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
        overflowY: el.scrollHeight - el.clientHeight,
        whiteSpace: cs.whiteSpace,
      });
    }
    return { cards, caps };
  });

let bad = 0;
for (const size of SIZES) {
  const label = `${size.width}x${size.height}`;
  await p.setViewportSize(size);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await settle();
  if (!(await openBook())) {
    console.log(`  ${label}: book view never opened — is the dev server up on ${URL_BASE}?`);
    await p.screenshot({ path: `${outDir}/failed-${label}.png` });
    bad += 1;
    continue;
  }

  /*
   * The specimens are on three leaves; walk, and keep each one the first time
   * it is seen — a spread shows two leaves and a page turn shows some of them
   * twice, so they are keyed by their own words rather than counted.
   */
  const found = { cards: [], caps: [] };
  const seen = new Set();
  for (let spread = 0; spread < 8; spread++) {
    await p.waitForTimeout(1200);
    const r = await read();
    for (const c of r.cards) {
      if (seen.has(`card:${c.text}`)) continue;
      seen.add(`card:${c.text}`);
      found.cards.push(c);
    }
    for (const c of r.caps) {
      if (c.value === '' || seen.has(`cap:${c.value}`)) continue;
      seen.add(`cap:${c.value}`);
      found.caps.push(c);
    }
    await p
      .locator('.nb-book-view')
      .screenshot({
        path: `${outDir}/${label}-spread-${String(spread + 1).padStart(2, '0')}.png`,
        animations: 'disabled',
        timeout: 15_000,
      })
      .catch(() => {});
    if (found.cards.length >= 2 && found.caps.length >= 6) break;
    await p.keyboard.press('ArrowRight');
  }

  console.log('');
  console.log(`  === ${label} ===`);
  console.log('  --- postcard ---');
  for (const c of found.cards) {
    /*
     * Two ways a card can fail its message: hold less than it contains, or
     * hold it on the wrong half. `pastRule` > 0 is the message printed
     * through the divider and into the address lines.
     */
    const short = c.overflowY > 1 || c.gap < -1;
    const crosses = c.pastRule > 1;
    if (short) bad += 1;
    if (crosses) bad += 1;
    console.log(
      `  "${c.text}…"\n    client ${c.client}  overflowY ${c.overflowY}  ` +
        `gap-to-floor ${c.gap.toFixed(1)}  min-height ${c.minHeight}  →  ` +
        `${short ? 'OVERFLOWS' : 'fits'}\n    column ${c.columnW}px  ` +
        `${c.lines} lines  ${c.pageLines.toFixed(2)} page lines  ` +
        `past-the-rule ${c.pastRule.toFixed(1)}px  →  ` +
        `${crosses ? 'CROSSES THE DIVIDER' : 'stays on its half'}`,
    );
  }
  if (found.cards.length === 0) console.log('  (none on the pages walked)');

  console.log('  --- image-row captions ---');
  for (const c of found.caps) {
    /*
     * A wrapping field passes on two counts: nothing hidden below the fold of
     * its own box, and the longest word narrower than the box — the second is
     * what says the words were WRAPPED rather than merely spilled somewhere
     * out of sight.
     */
    const hidden = c.overflowY > 1;
    const wordTooWide = c.widest > c.client + 1;
    if (hidden) bad += 1;
    if (wordTooWide) bad += 1;
    console.log(
      `  <${c.tag}> "${c.value}"  box ${c.client}×${c.clientH}  ` +
        `flat text ${c.textW}px  widest word ${c.widest}px  ` +
        `hidden ${c.overflowY}px  →  ` +
        `${hidden || wordTooWide ? 'TRUNCATED' : `fits${c.textW > c.client ? ' (wrapped)' : ''}`}`,
    );
  }
  if (found.caps.length === 0) console.log('  (none on the pages walked)');

  /* Back to the shelf, so the next size opens the book from the same place. */
  await p.keyboard.press('Escape');
  await p.waitForTimeout(1500);
}

console.log('');
console.log(`  shots: ${outDir}/`);
console.log(
  bad === 0
    ? '  PASS — every box holds its words at every size.'
    : `  FAIL — ${bad} box(es) short of their content.`,
);

await b.close();
process.exit(bad === 0 ? 0 : 1);
