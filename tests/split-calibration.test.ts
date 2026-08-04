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
 * Two probes produced everything below, and both must be re-run after
 * touching the constants:
 *
 *   node scripts/probe-block-heights.mjs   one block per leaf, measured alone
 *   node scripts/probe-page-cost.mjs       whole seeded pages, measured whole
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
import { describe, expect, it } from 'vitest';
import { parse } from '../src/script';
import {
  blockLineCost,
  pageLineCost,
  splitBlocksIntoPages,
  PAGE_LINE_BUDGET,
} from '../src/features/templates/split';
import { WELCOME_PAGE_SOURCES } from '../src/data/seed';

/** `.nb-leaf-paper` clientHeight less its padding, over a 32px line, at 1600x1000. */
const MEASURED_LEAF_LINES = 25.66;

const cost = (source: string): number => pageLineCost(parse(source).blocks);
const one = (source: string): number => {
  const blocks = parse(source).blocks;
  expect(blocks, `not a single block: ${source.slice(0, 40)}`).toHaveLength(1);
  return blockLineCost(blocks[0]);
};

// ---------------------------------------------------------------------------
// The leaf itself
// ---------------------------------------------------------------------------

/** The worst the estimator under-states a page by, over the seeded book. */
const WORST_UNDER_ESTIMATE = 1.9;

describe('the budget against a real leaf', () => {
  it('leaves room for the estimator being wrong in the direction that hurts', () => {
    // A page cut late does not clip: the excess flows onward and the book
    // comes back longer than it was made. So the budget is the leaf less the
    // most the estimator has been seen to under-state a page by...
    expect(PAGE_LINE_BUDGET).toBeLessThanOrEqual(
      MEASURED_LEAF_LINES - WORST_UNDER_ESTIMATE,
    );
    // ...and no more than that, or every page stops a block short.
    expect(PAGE_LINE_BUDGET).toBeGreaterThan(MEASURED_LEAF_LINES - 3);
  });
});

// ---------------------------------------------------------------------------
// One block at a time — scripts/probe-block-heights.mjs
// ---------------------------------------------------------------------------

/** The probe's long payload, verbatim: 287 characters of ordinary prose. */
const LONG =
  'Lx and then a good deal more of it, because a container is narrower than ' +
  'the leaf it stands on and the only way to learn how much narrower is to ' +
  'let a real sentence wrap inside one and count the lines it took to say ' +
  'itself, which is what this paragraph is doing right now on your behalf.';

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
    ['postcard', '{title="WISH YOU WERE HERE"}', 6.25, 13.06],
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
 */
const WELCOME_MEASURED_LINES: readonly number[] = [
  18.81, 20.38, 20.19, 20.72, 17.81, 18.69, 19.0, 18.69, 19.66, 22.94, 23.06,
  21.13, 19.22, 18.34, 20.56, 20.0, 19.72, 23.09, 21.06, 23.31, 21.34, 20.31,
  20.25, 20.28, 19.25, 19.5, 22.0, 18.31, 22.41, 20.75, 22.38, 19.31,
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

  it('is right about the average page to within half a line', () => {
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(Math.abs(mean)).toBeLessThan(0.5);
    const absolute =
      errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
    expect(absolute).toBeLessThan(1.0);
  });

  /**
   * The half of the old estimator's failure that made a page stop early: it
   * charged a container `2 + children` whatever the container was, so a leaf
   * of small blocks was billed for a full page and drew two thirds of one.
   * Every one of these pages was drawn at 69% of its leaf or more.
   */
  it('never says a full page is two thirds of one', () => {
    WELCOME_PAGE_SOURCES.forEach((source, i) => {
      expect(
        cost(source) / MEASURED_LEAF_LINES,
        `page ${i + 1} is drawn at ${(
          (WELCOME_MEASURED_LINES[i] / MEASURED_LEAF_LINES) *
          100
        ).toFixed(0)}% of its leaf`,
      ).toBeGreaterThan(0.6);
    });
  });

  /**
   * ...and the half that made a page overflow. A leaf never scrolls, so a page
   * costed under budget that draws over it pushes its tail onto the next leaf
   * and rearranges the book. None of these do, and the estimator must not
   * start saying they might.
   */
  it('never calls an over-long page short', () => {
    WELCOME_PAGE_SOURCES.forEach((source, i) => {
      if (WELCOME_MEASURED_LINES[i] <= PAGE_LINE_BUDGET) return;
      expect(cost(source), `page ${i + 1} really overflows`).toBeGreaterThan(
        PAGE_LINE_BUDGET,
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
