// @vitest-environment node
/**
 * tests/split-calibration.test.ts — the page-splitting estimator against the
 * pixels it is a model of.
 *
 * `blockLineCost` (src/features/templates/split.ts) decides how much authored
 * content goes on a leaf, and every number in it was READ OFF THE RUNNING APP
 * rather than reasoned about. That is easy to say and easy to quietly stop
 * being true, so the readings themselves are written down here and the
 * estimator is checked against them.
 *
 * Four probes produced everything below, and they must be re-run after touching
 * the constants:
 *
 *   node scripts/probe-block-heights.mjs   one block per leaf, measured alone
 *   node scripts/probe-page-cost.mjs       whole seeded pages, measured whole
 *   node scripts/probe-leaf-capacity.mjs   how tall a leaf is, at five windows
 *   node scripts/probe-leaf-column.mjs     how wide, and what a paragraph wraps to
 *
 * The last two are the newest and the reason this file grew a first section.
 * `PAGE_LINE_BUDGET` used to be a literal with the window it was measured in
 * written in its comment, and the window was not the one the app opens at; it
 * is now DERIVED from `tauri.conf.json`'s window through two measured laws, and
 * those two probes are where the laws come from. A derivation is only as good
 * as its law, so the readings are written down here and checked.
 *
 * The second is the one that matters, because a specimen board proves a block
 * draws at a certain height and says nothing about what a PAGE of them costs:
 * margins collapse between siblings, a decorated block carries a line of
 * margin above it that lands on whatever is in front, and both are invisible
 * to a block measured on its own. Three of the constants here are only right
 * because the whole-page numbers disagreed with the isolated ones.
 *
 * Everything is in page lines — the leaf's own `--page-line-height`, 32px —
 * measured in LAID-OUT pixels, because a leaf carries a 3D transform and only
 * laid-out pixels are in the same units as the line height they divide by.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/script';
import {
  blockLineCost,
  footnoteRailLines,
  leafCapacityPx,
  leafLines,
  lineBudgetFor,
  pageFrameFor,
  pageLineCost,
  proseColumnPx,
  splitBlocksIntoPages,
  MINIMUM_WINDOW,
  PAGE_LINE_BUDGET,
  REFERENCE_FRAME,
  REFERENCE_WINDOW,
  TARGET_WINDOW,
  type WindowSize,
} from '../src/features/templates/split';
import { WELCOME_PAGE_SOURCES } from '../src/data/seed';

/** `.nb-leaf-paper` clientHeight less its padding, over a 32px line, at 1600x1000. */
const MEASURED_LEAF_LINES = 25.66;

/**
 * Every reading in this file was taken at 1600x1000, so every estimate checked
 * against one is asked for at the REFERENCE frame rather than at the default.
 *
 * That used to be implicit — `blockLineCost` had one frame, and it happened to
 * be this one. It is spelled out now, because the frame the splitter cuts in is
 * the window the app opens at, and the two differ by a third of a leaf.
 */
const cost = (source: string): number =>
  pageLineCost(parse(source).blocks, REFERENCE_FRAME);
const one = (source: string): number => {
  const blocks = parse(source).blocks;
  expect(blocks, `not a single block: ${source.slice(0, 40)}`).toHaveLength(1);
  return blockLineCost(blocks[0], REFERENCE_FRAME);
};

// ---------------------------------------------------------------------------
// The leaf itself
// ---------------------------------------------------------------------------

/** The probe's long payload, verbatim: 287 characters of ordinary prose. */
const LONG =
  'Lx and then a good deal more of it, because a container is narrower than ' +
  'the leaf it stands on and the only way to learn how much narrower is to ' +
  'let a real sentence wrap inside one and count the lines it took to say ' +
  'itself, which is what this paragraph is doing right now on your behalf.';

/**
 * The worst the estimator under-states a page by, over the seeded book — AT
 * EACH WINDOW, because it is not one number.
 *
 * 1.14 lines at 1600x1000 (`scripts/probe-page-cost.mjs`) and 2.85 at 1280x800
 * (`scripts/probe-welcome-windows.mjs`, which walks the same book at the window
 * the app opens at and measures what each leaf really spends). Same pages, same
 * estimator, two and a half times the error: everything the model misses is a
 * per-block residual, and a narrower column puts more lines under each block.
 * `estimatorSlack` in split.ts is the fit through these two points.
 */
const WORST_UNDER_ESTIMATE = 1.14;
const WORST_UNDER_ESTIMATE_AT_TARGET = 2.85;

/**
 * A leaf, measured at five window sizes: capacity in laid-out pixels
 * (`scripts/probe-leaf-capacity.mjs`), prose column in pixels
 * (`scripts/probe-leaf-column.mjs`), and the lines 287 characters wrap to in
 * that column.
 *
 * THIS TABLE IS THE GATE. `split.ts` no longer writes its budget down beside
 * the window it was measured in — it derives it from the window — and a
 * derivation is only as good as the law under it. Change the chrome constant,
 * the stage aspect or the leaf inset and one of these rows stops matching.
 */
const MEASURED_WINDOWS: ReadonlyArray<{
  win: WindowSize;
  capacity: number;
  column: number;
  wrap: number;
}> = [
  { win: { width: 1600, height: 1000 }, capacity: 821, column: 592, wrap: 4 },
  { win: { width: 1360, height: 850 }, capacity: 671, column: 474, wrap: 6 },
  { win: { width: 1280, height: 800 }, capacity: 621, column: 434, wrap: 6 },
  { win: { width: 1100, height: 720 }, capacity: 541, column: 371, wrap: 7 },
  { win: { width: 960, height: 620 }, capacity: 441, column: 292, wrap: 10 },
];

describe('the budget is derived from the window, not written beside it', () => {
  it('takes the target and the minimum from tauri.conf.json', () => {
    // The failure this exists for, exactly: the budget was measured at
    // 1600x1000, the app opens at 1280x800, so every authored page was cut a
    // third over the capacity of the leaf it landed on and the drain grew the
    // welcome book from 32 leaves to 46 the first time it was opened. Nothing
    // in src/ reaches across the Rust boundary at build time, so the two
    // window sizes are copied — and a copy is only safe if something checks.
    const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
      app: { windows: ReadonlyArray<Record<string, number>> };
    };
    const w = conf.app.windows[0];
    expect(
      { width: w.width, height: w.height },
      'TARGET_WINDOW has drifted from the window the app opens at',
    ).toEqual(TARGET_WINDOW);
    expect(
      { width: w.minWidth, height: w.minHeight },
      'MINIMUM_WINDOW has drifted from the smallest window the app allows',
    ).toEqual(MINIMUM_WINDOW);
  });

  it('reproduces every measured leaf, to the pixel', () => {
    for (const { win, capacity, column } of MEASURED_WINDOWS) {
      const where = `${win.width}x${win.height}`;
      expect(leafCapacityPx(win), `${where} capacity`).toBeCloseTo(capacity, 0);
      expect(proseColumnPx(win), `${where} column`).toBeCloseTo(column, 0);
    }
  });

  it('wraps a paragraph as many times as the window really wraps it', () => {
    // The half of this bug a budget alone would not have fixed: the type does
    // not scale with the frame, so a shorter window is a NARROWER column set in
    // the same 20px hand. The same 287 characters take four lines on the
    // reference leaf and ten at the smallest window the app allows.
    for (const { win, wrap } of MEASURED_WINDOWS) {
      expect(
        pageLineCost(parse(LONG).blocks, pageFrameFor(win)),
        `${win.width}x${win.height} wraps 287 characters`,
      ).toBe(wrap);
    }
  });

  it('still says 23.5 at the window 23.5 was measured in', () => {
    // The check that this is the same model rather than a new one: the law has
    // to land on the number the literal used to be.
    expect(leafLines(REFERENCE_WINDOW)).toBeCloseTo(MEASURED_LEAF_LINES, 2);
    expect(lineBudgetFor(REFERENCE_WINDOW)).toBeCloseTo(23.5, 1);
  });

  it('leaves room for the estimator being wrong in the direction that hurts', () => {
    // A page cut late does not clip: the excess flows onward and the book comes
    // back longer than it was made. So the budget at a window is that window's
    // leaf, less the most the estimator has been seen to under-state a page by
    // THERE — and the reference figure is not the one that matters, because
    // the reference is not where anybody reads.
    for (const [win, worst] of [
      [REFERENCE_WINDOW, WORST_UNDER_ESTIMATE],
      [TARGET_WINDOW, WORST_UNDER_ESTIMATE_AT_TARGET],
    ] as const) {
      const leaf = leafLines(win);
      const budget = lineBudgetFor(win);
      expect(budget, `${win.width}x${win.height} cuts too late`).toBeLessThanOrEqual(
        leaf - worst,
      );
      // ...and not far under it either, or every page stops a block short.
      // A line and a half of tolerance, because the slack is a two-point fit
      // and lands a little either side of each reading rather than on it.
      expect(
        budget,
        `${win.width}x${win.height} cuts too early`,
      ).toBeGreaterThan(leaf - worst - 1.5);
    }
  });

  it('costs a picture and a mindmap less when the column is narrower', () => {
    // Measured, `scripts/probe-diagram-scale.mjs`: an `.nb-dg-svg` is drawn at
    // `min(intrinsic width, column - 48)`, so a mindmap (663px of viewBox) is
    // clamped at every window and scales exactly with the column, while a
    // flowchart (125px) is narrower than any column and does not move at all.
    const mindmap = '```mindmap\nRoot\n  One\n  Two\n  Three\n```';
    const flowchart = '```flowchart\nA -> B\nB -> C\n```';
    const picture = '![A kitten](/kittens/ginger.svg)';
    const at = (source: string, win: WindowSize): number =>
      pageLineCost(parse(source).blocks, pageFrameFor(win));

    // 14.22 lines at 1600x1000 and 10.09 at 1280x800 — a ratio of 0.709, which
    // is 386/544, the two widths they were drawn at.
    expect(
      at(mindmap, TARGET_WINDOW) / at(mindmap, REFERENCE_WINDOW),
    ).toBeCloseTo(386 / 544, 2);
    expect(at(flowchart, TARGET_WINDOW)).toBe(at(flowchart, REFERENCE_WINDOW));
    // A picture fills the column outright, so it scales with the column itself.
    expect(
      at(picture, TARGET_WINDOW) / at(picture, REFERENCE_WINDOW),
    ).toBeCloseTo(434.16 / 592.16, 2);
  });
});

// ---------------------------------------------------------------------------
// One block at a time — scripts/probe-block-heights.mjs
// ---------------------------------------------------------------------------

describe('leaf blocks cost what they draw', () => {
  // [script, measured lines]
  const CASES: ReadonlyArray<readonly [string, number]> = [
    // A paragraph rides the rule grid — `margin: 0` — so it costs exactly the
    // lines it wraps to, and 287 characters wrap to four across the column.
    ['Sx', 1.0],
    [LONG, 4.0],
    ['## Sx a heading', 2.0],
    ['## Sx a heading long enough to have to wrap somewhere', 4.0],
    ['### Sx a heading', 1.0],
    ['> Sx', 1.0],
    [`> ${LONG}`, 5.0],
    ['- Sx\n- Sx\n- Sx', 3.0],
    [`- ${LONG}`, 5.0],
    ['- [ ] Sx\n- [x] Sx\n- [ ] Sx', 3.0],
    ['---', 1.0],
    ['```js\nconst v0 = 0;\n```', 2.34],
    ['```js\nconst v0 = 0;\nconst v1 = 1;\nconst v2 = 2;\nconst v3 = 3;\n```', 4.72],
    [
      '```js\n' +
        Array.from({ length: 10 }, (_, i) => `const v${i} = ${i};`).join('\n') +
        '\n```',
      9.47,
    ],
    ['| A | B |\n| --- | --- |\n| cell 0 | cell 0 |', 2.84],
    [
      '| A | B |\n| --- | --- |\n| cell 0 | cell 0 |\n| cell 1 | cell 1 |\n| cell 2 | cell 2 |',
      5.41,
    ],
    ['$$\ne^{i\\pi} + 1 = 0\n$$', 1.25],
    ['$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n$$', 2.66],
    ['$$\n\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$', 2.28],
    ['```tree\nRoot\n  Node 0\n  Node 1\n```', 5.13],
    ['```tree\nRoot\n  One\n  Two\n    Three\n```', 7.63],
    ['```mindmap\nRoot\n  One\n  Two\n  Three\n```', 9.22],
    ['```timeline\n1900 | Entry 0\n1901 | Entry 1\n```', 3.25],
    ['```timeline\n' + Array.from({ length: 8 }, (_, i) => `190${i} | Entry ${i}`).join('\n') + '\n```', 8.72],
    ['```graph\nN0 -> N1\nN1 -> N2\n```', 8.38],
    ['```graph\n' + Array.from({ length: 5 }, (_, i) => `N${i} -> N${i + 1}`).join('\n') + '\n```', 17.0],
    ['![A kitten](/kittens/ginger.svg)', 15.13],
  ];

  it.each(CASES)('%s', (source, measured) => {
    expect(one(source)).toBeCloseTo(measured, 0);
  });
});

describe('a container costs its chrome plus what it holds', () => {
  /**
   * Every container, holding one short line and then holding 287 characters.
   * The pair is what separates the fixed chrome from the width the container
   * gives its contents: a card and a postcard have almost the same chrome and
   * the postcard is half as wide, so the same sentence costs it twice as much.
   *
   * The short reading is also where a MINIMUM shows: an index card is a
   * card-sized object whether one line is written on it or five, which is why
   * several of these are far above `chrome + 1`.
   */
  const CASES: ReadonlyArray<readonly [string, string, number, number]> = [
    ['sticky-note', '{color=lemon}', 2.63, 5.94],
    ['washi-box', '{color=sky}', 2.69, 6.69],
    ['callout', '{variant=tip}', 2.19, 6.06],
    ['card', '{title="A title"}', 3.69, 7.69],
    ['quote-card', '{color=amber}', 2.94, 8.22],
    ['spoiler', '', 3.31, 7.31],
    ['banner', '{color=moss}', 2.13, 7.13],
    ['index-card', '{title="A title"}', 4.88, 7.75],
    ['envelope', '{color=amber}', 2.81, 6.81],
    ['stamp', '{color=terracotta}', 3.0, 7.0],
    ['tag', '{color=moss}', 2.56, 7.56],
    ['marginalia', '', 1.63, 5.63],
    ['pressed-flower', '{title="A title"}', 6.0, 9.44],
    ['ticket-stub', '{title="ADMIT ONE"}', 3.5, 8.75],
    // 13.06 until the card's message was given its own half of the back: the
    // reserve for the address side used to stop 16px SHORT of the printed
    // divider, so every full line was set through the rule. Clearing it costs
    // the column 33px and the 287 characters a twelfth line. Re-measured in
    // the running app, not derived from the estimator it is checking.
    ['postcard', '{title="WISH YOU WERE HERE"}', 6.25, 14.06],
    ['ledger', '{title="A title"}', 3.31, 7.31],
    ['wax-seal', '{title=A}', 4.75, 8.63],
    ['map-pin', '{title="The blue door"}', 2.94, 6.75],
    ['toggle', '{title="A fold", open}', 2.0, 6.0],
  ];

  it.each(CASES)('%s', (name, attrs, short, long) => {
    expect(one(`::: ${name} ${attrs}\nSx\n:::`), `${name} holding one line`).toBeCloseTo(
      short,
      0,
    );
    expect(
      one(`::: ${name} ${attrs}\n${LONG}\n:::`),
      `${name} holding 287 characters`,
    ).toBeCloseTo(long, 0);
  });

  it('costs side-by-side containers by their tallest column, not their sum', () => {
    const columns = one(
      `::: columns {gap=lg}\n::: col\nSx\n:::\n::: col\n${LONG}\n:::\n:::`,
    );
    expect(columns).toBeCloseTo(10.0, 0);
    // ...and the same words in one column of two cost more than they do on the
    // page, because the column is 46% of its width.
    expect(columns).toBeGreaterThan(one(LONG) * 2);
  });

  it('costs a photo row once, not once per photograph', () => {
    const row = one(
      '::: image-row {style=polaroid, cols=3}\n' +
        '![A kitten](/kittens/ginger.svg){caption="One"}\n' +
        '![A kitten](/kittens/ginger.svg){caption="Two"}\n' +
        '![A kitten](/kittens/ginger.svg){caption="Three"}\n:::',
    );
    expect(row).toBeCloseTo(7.97, 0);
  });
});

describe('decorations', () => {
  /**
   * Measured on the welcome book's own decorations page, not on a specimen:
   * a decorated block carries a line of margin ABOVE it, and a block measured
   * alone has nothing above it to give that line to. The isolated readings
   * said `tape` and `washi` were free; the page said they are not.
   */
  const PLAIN = 'A decorated line of ordinary length on the page';
  const base = one(PLAIN);

  it.each([
    ['{underline=squiggle}', 0],
    ['{underline=circled}', 0],
    ['{rotate=-2}', 0],
    ['{tape=top}', 1.0],
    ['{washi=top}', 1.0],
    ['{shadow=lifted}', 2.56],
    ['{frame=scallop}', 2.75],
    ['{paper=torn}', 3.0],
  ])('%s adds %s lines', (attrs, added) => {
    expect(one(`${PLAIN} ${attrs}`) - base).toBeCloseTo(added, 1);
  });

  it('does not add two decorations together — they share the padding', () => {
    expect(one(`${PLAIN} {paper=torn, frame=scallop}`)).toBeCloseTo(
      one(`${PLAIN} {paper=torn}`),
      1,
    );
  });
});

describe('inline code sets wider than the hand it sits in', () => {
  it('costs a line of code spans nearly twice a line of prose', () => {
    const asCode = LONG.split(' ')
      .map((word) => `\`${word}\``)
      .join(' ');
    expect(one(asCode)).toBeCloseTo(7.44, 0);
    expect(one(LONG)).toBeCloseTo(4.0, 0);
  });

  it('costs bold nothing at all', () => {
    expect(one(`**${LONG}**`)).toBeCloseTo(one(LONG), 1);
  });
});

// ---------------------------------------------------------------------------
// Whole pages — scripts/probe-page-cost.mjs
// ---------------------------------------------------------------------------

/**
 * What each leaf of the seeded welcome book ACTUALLY spends, walked in the
 * running app: for every top-level block the distance to the top of the next
 * one (margins collapse, so that is what the page spends on it) and for the
 * last one its own box plus the margin under it. Index-aligned with
 * `WELCOME_PAGE_SOURCES`.
 *
 * This is the calibration set. It is thirty-two real pages using nearly every
 * block the language has, which is a far better test of an estimator than any
 * fixture anyone would write on purpose.
 *
 * Read AT 1600x1000, like everything else here, and therefore compared against
 * the estimator at `REFERENCE_FRAME`. Re-read for the v7 pages, because the
 * pages moved: v6 was cut for a leaf a third bigger than the one it landed on,
 * and a calibration set is only a calibration set while the pages it names are
 * the pages that were measured.
 */
const WELCOME_MEASURED_LINES: readonly number[] = [
  16.75, 14.47, 16.31, 15.69, 15.69, 13.31, 15.0, 13.0, 15.88, 17.25, 17.0,
  13.75, 13.47, 16.66, 17.19, 18.31, 14.78, 20.84, 17.06, 16.38, 17.66,
  16.16, 14.88, 14.0, 14.31, 13.69, 17.06, 14.81, 15.31, 15.0, 16.19, 15.25,
];

describe('the estimator against thirty-two real leaves', () => {
  const errors = WELCOME_PAGE_SOURCES.map(
    (source, i) => cost(source) - WELCOME_MEASURED_LINES[i],
  );

  it('has a page for every measurement', () => {
    expect(WELCOME_PAGE_SOURCES).toHaveLength(WELCOME_MEASURED_LINES.length);
  });

  it('is right about every page to within a tenth of a leaf', () => {
    WELCOME_PAGE_SOURCES.forEach((source, i) => {
      const title = parse(source).blocks.find((b) => b.kind === 'heading');
      expect(
        Math.abs(errors[i]),
        `page ${i + 1} (${
          title?.kind === 'heading' ? JSON.stringify(title.content) : '?'
        }): estimated ${cost(source).toFixed(2)}, measured ${WELCOME_MEASURED_LINES[i]}`,
      ).toBeLessThan(2.6);
    });
  });

  it('is right about the average page to within two thirds of a line', () => {
    // Was half a line, and the bias is a KNOWN one that v7 made bigger rather
    // than a new one: margin collapsing is a property of a sequence, so N
    // containers standing together spend N+1 margins' worth of gap and are
    // charged N (see "What it still gets wrong, on purpose" in split.ts). The
    // v7 pages cut prose and kept their containers, so there are more of those
    // runs per leaf and the under-count grew from about 0.3 of a line to 0.5.
    // It is under-counting, which is the direction that hurts — and it is what
    // `ESTIMATOR_SLACK` is for, at four times the size of the worst of them.
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(Math.abs(mean)).toBeLessThan(0.67);
    const absolute =
      errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
    expect(absolute).toBeLessThan(1.0);
  });

  /**
   * The half of the old estimator's failure that made a page stop early: it
   * charged a container `2 + children` whatever the container was, so a leaf of
   * small blocks was billed for a full page and drew two thirds of one.
   *
   * Judged AT THE WINDOW THE PAGE WAS CUT FOR, which is the change v7 forced.
   * These pages are authored against a 1280x800 leaf and fill 87% to 100% of
   * it; the same pages measured on the 1600x1000 leaf above cover 60%, and
   * asking "is this page full" of a leaf a third bigger than the one it was
   * written for is the question that produced the bug in the first place.
   */
  it('never says a full page is two thirds of one', () => {
    const leaf = leafLines(TARGET_WINDOW);
    WELCOME_PAGE_SOURCES.forEach((source, i) => {
      const here = pageLineCost(parse(source).blocks);
      expect(
        here / leaf,
        `page ${i + 1} covers ${((here / leaf) * 100).toFixed(0)}% of the leaf ` +
          'it was cut for',
      ).toBeGreaterThan(0.6);
    });
  });

  /**
   * ...and the half that made a page overflow. A leaf never scrolls, so a page
   * costed under budget that draws over it pushes its tail onto the next leaf
   * and rearranges the book. None of these do, and the estimator must not start
   * saying they might.
   *
   * Both sides of this comparison are at the reference window: the measurement
   * was taken there, so the budget it is held against has to be the budget
   * there — `lineBudgetFor(REFERENCE_WINDOW)`, not the shipped one.
   */
  it('never calls an over-long page short', () => {
    const budget = lineBudgetFor(REFERENCE_WINDOW);
    WELCOME_PAGE_SOURCES.forEach((source, i) => {
      if (WELCOME_MEASURED_LINES[i] <= budget) return;
      expect(cost(source), `page ${i + 1} really overflows`).toBeGreaterThan(
        budget,
      );
    });
  });
});

describe('splitting authored content', () => {
  it('never emits a page the leaf cannot hold', () => {
    const wall = Array.from(
      { length: 60 },
      (_, i) =>
        `Paragraph ${i}. ${LONG}\n\n::: card {title="A title"}\n${LONG}\n:::`,
    ).join('\n\n');
    const pages = splitBlocksIntoPages(parse(wall).blocks);
    expect(pages.length).toBeGreaterThan(10);
    for (const page of pages) {
      // One block may exceed the budget on its own — it has to go somewhere —
      // but a page of several must not.
      if (page.length < 2) continue;
      expect(pageLineCost(page)).toBeLessThanOrEqual(
        PAGE_LINE_BUDGET + blockLineCost(page[page.length - 1]),
      );
    }
  });

  it('fills a page rather than cutting it early', () => {
    // The old estimator charged a one-line paragraph two lines, so a wall of
    // short ones was cut at thirteen — half a leaf, and the reader's report
    // that started all this. They are one line each.
    const wall = Array.from({ length: 80 }, (_, i) => `Line ${i}.`).join('\n\n');
    const pages = splitBlocksIntoPages(parse(wall).blocks);
    expect(pages[0].length).toBeGreaterThanOrEqual(Math.floor(PAGE_LINE_BUDGET));
  });
});

// ---------------------------------------------------------------------------
// The foot of the page — scripts/probe-footnote-capacity.mjs
// ---------------------------------------------------------------------------

/**
 * A page with footnotes is shorter than a page without them, and the splitter
 * has to know it.
 *
 * Found by looking at frame 778 of the recorded demo: the welcome book's
 * "Every mark there is" leaf, with the note *"1 like this one"* printed under
 * "The seven washes" card. Two of the three obvious explanations were measured
 * in the running app and both came back clean — the rail paints ABOVE the card
 * (probe-footnote-stacking.mjs, elementsFromPoint), and across a walk of the
 * whole book not one of a hundred and forty drain reads saw a padding-bottom
 * that was missing its page's rail (probe-footnote-reserve.mjs). The third was
 * the answer: `probe-footnote-capacity.mjs` builds the same authored page
 * twice, once with its footnote and once with the marker deleted, and opens
 * both at 1360x850. Without the note all six blocks stood on the leaf. With it
 * the page reserved 41px and the drain evicted the last block the first time
 * the page was looked at — which is the block standing on the note in the
 * frame.
 *
 * The rail's own arithmetic, measured by the same probe: `18 + 23n` pixels for
 * n note lines (six notes measured 156px exactly), over a 32px page line.
 */
describe('the foot of the page', () => {
  // At the reference window, where the 82 characters below were measured. The
  // rail is the leaf's full width, so it narrows with the leaf exactly as the
  // prose column does — 82 characters there, 54 at the window the app opens.
  const notesOf = (source: string): number =>
    footnoteRailLines(parse(source).blocks, REFERENCE_WINDOW);

  it('charges nothing for a page with no notes on it', () => {
    expect(notesOf('Just a line of prose.')).toBe(0);
  });

  it('charges one note the rail plus one of its lines', () => {
    // 18px of chrome and 23px of note over a 32px line.
    expect(notesOf('A word[^ a short note ] here.')).toBeCloseTo(
      (18 + 23) / 32,
      2,
    );
  });

  it('charges a second note a line and not a second rail', () => {
    const one = notesOf('A word[^ one ].');
    const two = notesOf('A word[^ one ] and another[^ two ].');
    expect(two - one).toBeCloseTo(23 / 32, 2);
  });

  it('charges a note that wraps for both its lines', () => {
    // 82 characters to a line of the rail — wider than the page's 72, because
    // the rail runs the full width of the leaf and is set five points smaller.
    const short = notesOf(`A word[^ ${'x'.repeat(80)} ].`);
    const long = notesOf(`A word[^ ${'x'.repeat(90)} ].`);
    expect(long - short).toBeCloseTo(23 / 32, 2);
  });

  it('finds a note buried in a container, a list and a table cell', () => {
    const one = notesOf('A word[^ one ].');
    expect(notesOf('::: card {title="T"}\nA word[^ one ].\n:::')).toBeCloseTo(one, 5);
    expect(notesOf('- A word[^ one ].')).toBeCloseTo(one, 5);
    expect(notesOf('| a[^ one ] | b |\n| --- | --- |\n| 1 | 2 |')).toBeCloseTo(
      one,
      5,
    );
  });

  it('does not charge the line the marker sits on for the note text', () => {
    // The line carries a raised number, not the note. A page of long notes was
    // being charged their words twice: once as wrap on the paragraph, where
    // nothing is drawn, and never at the foot, where it is.
    const bare = pageLineCost(parse('One short sentence.').blocks);
    const noted = pageLineCost(
      parse(`One short sentence[^ ${'x'.repeat(300)} ].`).blocks,
    );
    expect(noted).toBeCloseTo(bare, 5);
  });

  it('cuts a page early enough that its notes have somewhere to stand', () => {
    // The failure this exists for: a page filled to the budget with blocks,
    // one of which carries a note, so the rail has to come out of a leaf that
    // is already full and the last block is evicted at read time.
    const wall = Array.from(
      { length: 40 },
      (_, i) => (i === 0 ? `Line ${i}[^ a note ].` : `Line ${i}.`),
    ).join('\n\n');
    const pages = splitBlocksIntoPages(parse(wall).blocks);
    for (const page of pages) {
      if (page.length < 2) continue;
      expect(
        pageLineCost(page) + footnoteRailLines(page),
        'blocks plus the rail they need',
      ).toBeLessThanOrEqual(PAGE_LINE_BUDGET + blockLineCost(page[page.length - 1]));
    }
    // ...and the same wall without the note fills its first page fuller,
    // which is the rail, and only the rail, coming out of the leaf.
    const plain = splitBlocksIntoPages(
      parse(wall.replace('[^ a note ]', '')).blocks,
    );
    expect(pages[0].length).toBeLessThan(plain[0].length);
  });
});
