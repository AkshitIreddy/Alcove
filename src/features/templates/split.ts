/**
 * src/features/templates/split.ts — pure page-splitting for imported
 * Markdown / template scripts (roadmap item 25: "one page per H1 or
 * capacity split"). DOM-free; unit-tested in tests/export.test.ts and
 * tests/split-calibration.test.ts.
 *
 * Strategy: walk the parsed ScriptDoc's top-level blocks.
 * - A level-1 heading starts a new page (unless the current page is empty).
 * - Each block gets an estimated line cost; when a page's total would blow
 *   past the budget, the page is cut *before* the block (capacity split) —
 *   so headingless documents still split into book-sized pages.
 * - A page's total is its blocks PLUS its foot: the strip of notes any
 *   footnotes on it will stand in (`footnoteRailLines`). That is not a block
 *   cost and it is not calibrated with them — see the long comment there.
 *
 * ## The costs below are MEASURED, not guessed
 *
 * Three probes produced every number here, and all three have to be re-run
 * after touching any of them:
 *
 *   probe-block-heights.mjs  one block per leaf, measured alone: builds a
 *                            specimen book through this very splitter, walks
 *                            it, and divides each block's laid-out height by
 *                            the leaf's own line height.
 *   probe-page-cost.mjs      whole seeded pages, measured whole. This is the
 *                            one that decides whether the constants are right,
 *                            because a specimen board says what a block draws
 *                            at and says nothing about what a PAGE of them
 *                            costs — margins collapse between siblings, and a
 *                            decorated block carries a line of margin above it
 *                            that lands on whatever is in front. Three of the
 *                            constants below are only right because the
 *                            whole-page numbers disagreed with the isolated
 *                            ones.
 *   probe-split-fill.mjs     a long import through the real create path,
 *                            asking the only question that matters: did every
 *                            page the splitter made fit the leaf it landed on.
 *
 * Two more produced the foot-of-the-page numbers, and belong to that same
 * rule — `probe-footnote-capacity.mjs` (what a rail reserves, and the same
 * authored page with and without its note) and `probe-footnote-fit.mjs` (how
 * many blocks the splitter put on page one against how many the app was still
 * holding there once it had settled).
 *
 * And two more again for the WINDOW, which is the axis all of the above were
 * blind to: `probe-leaf-capacity.mjs` (how tall a leaf is at five window sizes)
 * and `probe-leaf-column.mjs` (how wide, and what a paragraph of known length
 * wraps to in it). Those two are what the budget is now derived from rather
 * than compared against.
 *
 * `tests/split-calibration.test.ts` writes the readings down and checks the
 * estimator against them. Against the thirty-two seeded pages it is out by 0.7
 * of a line on average and never by more than 2.1.
 *
 * What the measurements found, and what the old estimator was doing instead:
 *
 *  - **A leaf holds 25.66 lines** (821px of capacity over 32px lines) *at a
 *    1600x1000 window* — and that qualifier turned out to be the whole story.
 *    `tauri.conf.json` opens the app at 1280x800, where the same leaf holds
 *    19.41, so the budget was written for a window nobody is given and every
 *    authored page arrived a third over capacity. The budget is now DERIVED
 *    from the window instead of written beside it; see `PAGE_LINE_BUDGET` and
 *    the two laws above it, both measured at five window sizes.
 *  - **A paragraph costs exactly the lines it wraps to** — `.nb-prose p` has
 *    `margin: 0` because paragraphs ride the rule grid. The old cost was
 *    `lines + 1`, so a page of short paragraphs was charged for twice what it
 *    drew and stopped at half a leaf.
 *  - **72 characters fit on a line**, not 62 (544px of column, ~7.4px a
 *    character in Patrick Hand at 20px). Measured against a ladder of
 *    paragraphs of graded length: 75 characters still fit on one line, 89 take
 *    two, 287 take four and 300 take five. 72 is the value that misplaces the
 *    fewest rungs of that ladder once greedy word wrap has eaten its half-word
 *    a line.
 *  - **Container chrome is nothing like uniform.** The old cost charged every
 *    container `2 + children`. Measured, a `marginalia` adds 0.6 of a line and
 *    a `card` adds 2.7 — and several of them have a MINIMUM: an index card is
 *    a card-sized object whether you write one line on it or five, so a
 *    one-line `pressed-flower` draws 6 lines and a one-line `postcard` 6.3.
 *    `max(min, chrome + children)` fits every reading in the table.
 *  - **A container narrows the text it holds, and some of them resize it.**
 *    287 characters wrap to 4 lines on the page, 5 in a card, 6 in a banner
 *    and 11 in a postcard. Costing a container's children at the page's width
 *    is what made a page of keepsakes overflow. So a cost is taken *in a
 *    frame* — characters per line, the height of one of those lines, and the
 *    width as a fraction of the page column so a picture can scale with it.
 *
 * The two failures this fixes are the same bug in opposite directions: the old
 * estimator was simultaneously too dear for small blocks (a page of callouts
 * was charged a full leaf and covered two thirds of one) and too cheap for
 * large ones (a page of keepsakes was charged two thirds and overflowed).
 *
 * ## What it still gets wrong, on purpose
 *
 * A cost is per block, and margin collapsing is a property of a SEQUENCE: two
 * containers standing together share one margin, so N of them in a row cost
 * N+1 margins' worth of gap and only N are charged. The under-count is about
 * 0.3 of a line a page, and closing it would mean either charging every
 * container its whole margin box (which over-states a run of five by a line
 * and a half — measured) or giving `blockLineCost` its neighbours, which it
 * has not got. The budget carries the difference instead.
 *
 * `fetchDirective` is the one cost here that is still a guess — it draws a
 * card fetched over the network, which a headless probe has nothing to fetch.
 */
import type {
  Block,
  ContainerBlock,
  DiagramBlock,
  Inline,
  ListItem,
  ScriptDoc,
  TreeNode,
} from '../../script/types';

// ---------------------------------------------------------------------------
// The window a page is cut for
// ---------------------------------------------------------------------------

/**
 * A window the book might be read in, in CSS pixels of the web view.
 *
 * `src-tauri/tauri.conf.json` is the authority for the two that matter — the
 * size the app opens at and the smallest it may be dragged to — and
 * `tests/split-calibration.test.ts` reads that file and refuses to pass if the
 * constants below have drifted from it. Same discipline as `src/version.ts`,
 * and for the same reason: a number written down in two places is a number
 * that is wrong in one of them. It is copied rather than imported because
 * `src-tauri/` is the Rust side of the tree and nothing in `src/` reaches
 * across that line at build time.
 */
export interface WindowSize {
  width: number;
  height: number;
}

/**
 * The window every measurement in this file was taken in.
 *
 * Not a window anybody gets — it is where the ruler was held. Every constant
 * below, and every entry in `CONTAINER`, `EFFECT_LINES` and the diagram costs,
 * is a reading from a 1600x1000 web view, and they stay that way: a
 * calibration is worth more the longer it is left alone.
 */
export const REFERENCE_WINDOW: WindowSize = { width: 1600, height: 1000 };

/**
 * The window the app opens at (`tauri.conf.json` → `app.windows[0]`), and the
 * one pages are cut for.
 *
 * **Why the default and not the minimum.** The choice is between authoring for
 * the window a new reader is handed and authoring for the smallest window the
 * app permits, and the two fail in opposite directions:
 *
 *   window       leaf holds   budget   a page cut for the default is...
 *   1600x1000    25.66        23.5     ...67% of the leaf. Roomier margins.
 *   1280x800     19.41        17.2     ...exactly right. The DEFAULT.
 *   960x620      13.78        11.6     ...over by three lines; the tail flows.
 *
 * Cutting for 960x620 would mean nothing ever reflows on open at any size the
 * app allows — and it would put every seeded page at 60% of the leaf a NEW
 * READER SEES, which is the "half-empty pages" the owner already reported
 * once. It buys a guarantee at the one window a reader has to drag the frame
 * to reach, and pays for it at the window everybody starts in.
 *
 * So: the default. A reader who shrinks the frame past it gets the flow-onward
 * behaviour the owner has already ruled correct — *"just make it work like any
 * other book — if it's too big it goes to the next page"* — and a reader who
 * grows it gets a page with more air around the writing, which is the failure
 * that costs least. It is also the size `shots-now/visual-suite.mjs` calls
 * "desk" and looks at every surface in, so it is the window this project
 * already treats as the app.
 */
export const TARGET_WINDOW: WindowSize = { width: 1280, height: 800 };

/**
 * The smallest window `tauri.conf.json` permits (`minWidth`/`minHeight`).
 *
 * Nothing is cut for it. It is here so the test can pin it, and so anything
 * asking "how badly does a page overflow at the worst size" has the size.
 */
export const MINIMUM_WINDOW: WindowSize = { width: 960, height: 620 };

/**
 * Window height that never reaches the leaf: everything above and below it.
 *
 * Measured, and it is a CONSTANT — `scripts/probe-leaf-capacity.mjs` read the
 * capacity the app itself computes at five window sizes and every one of them
 * came back at the height less exactly this:
 *
 *   1600x1000  821px      1280x800  621px      1360x850  671px
 *   1100x720   541px       960x620  441px
 *
 * Which is what one would hope: `.nb-book-view` is `100vh` with fixed padding,
 * the title plate above the spread is fixed, and the cover and the leaf inside
 * it are `flex: 1 1 auto` all the way down. The width plays no part at all.
 */
const LEAF_CHROME_PX = 179;

/**
 * The rule grid the whole estimator is denominated in.
 *
 * 32px at every window size measured — **the type does not scale with the
 * frame**. That is the fact that makes a small window expensive rather than
 * merely smaller: the leaf shrinks and the writing does not, so a page loses
 * room in both directions at once and keeps none of it back.
 */
const PAGE_LINE_PX = 32;

/** Capacity of one leaf in laid-out pixels, at a given window. */
export function leafCapacityPx(win: WindowSize): number {
  return win.height - LEAF_CHROME_PX;
}

/** Capacity of one leaf in page lines. */
export function leafLines(win: WindowSize): number {
  return leafCapacityPx(win) / PAGE_LINE_PX;
}

/**
 * The estimator's own error, in lines, held back from the budget.
 *
 * The budget is not the capacity, because the estimator is not exact and the
 * two ways of being wrong do not cost the same. A page cut early is a leaf
 * that stops a little short; a page cut LATE does not clip — leaves never
 * scroll, so the excess flows onward and the book comes back longer than it
 * was made, with every page after the guilty one carrying somebody else's
 * tail.
 *
 * The error is measured, against the seeded pages walked by
 * `scripts/probe-page-cost.mjs`: it is under a line on average and under-states
 * by at most 1.9. This leaves room for the worst of those, and
 * `scripts/probe-split-fill.mjs` is where it was settled — with only 0.16 of a
 * line held back a nine-page import arrived as ten, which is exactly the
 * failure above.
 */
const ESTIMATOR_SLACK = 2.16;

/** What the splitter is allowed to put on a page at a given window. */
export function lineBudgetFor(win: WindowSize): number {
  return leafLines(win) - ESTIMATOR_SLACK;
}

/**
 * What the splitter is allowed to put on a page.
 *
 * DERIVED, and that is the whole point of the arithmetic above. This used to be
 * the literal `23.5`, with a comment saying it came from a leaf that holds
 * 25.66 lines *"at a 1600x1000 window"* — a window `tauri.conf.json` never
 * opens and a reader would have to drag the frame out to reach. So every
 * authored page was cut a third over the capacity of the leaf it actually
 * landed on, and merely opening the welcome book grew it from 32 leaves to 46
 * as the drain pushed each page's tail onto the next one.
 *
 * At the reference window this law still gives 23.5 to two decimal places,
 * which is the check that it is the same model and not a new one; at the
 * window the app opens it gives 17.2.
 */
export const PAGE_LINE_BUDGET = lineBudgetFor(TARGET_WINDOW);

// ---------------------------------------------------------------------------
// ...and how wide it is, which costs as much as how tall
// ---------------------------------------------------------------------------

/**
 * The prose column, in pixels, at a given window.
 *
 * A shorter window is a NARROWER book, because `.nb-spread-stage` takes its
 * width from its height (`min(100%, (100vh - 96px) * 1.58, 1760px)`, spread.css)
 * so the spread keeps the proportions of a book instead of stretching. The leaf
 * is half of that less the cover's padding, and the prose box inside it less
 * the drag-handle lane. Measured by `scripts/probe-leaf-column.mjs`:
 *
 *   1600x1000  592px      1280x800  434px      1360x850  474px
 *   1100x720   371px       960x620  292px
 *
 * ...and this expression reproduces all five to the pixel. It matters because
 * the type does NOT shrink with the column: 20px on a 32px rule at every one of
 * those sizes, so 287 characters of prose wrap to four lines on the reference
 * leaf, six at the default window and ten at the minimum. A budget alone would
 * have fixed half of this bug.
 *
 * The `100%` arm is the one that stops mattering below about a 4:3 window and
 * takes over above it — a tall narrow frame runs out of width before it runs
 * out of height. Every window between the minimum and the default is in the
 * height-driven regime; the clamp is here so that a reader who is not, is not
 * costed as though they were.
 */
const STAGE_HEADER_PX = 96;
const STAGE_ASPECT = 1.58;
const STAGE_MAX_PX = 1760;
/** The fixed rail lane and right padding of `.nb-book-view`. */
const VIEW_SIDE_PX = 108;
/** The cover board's padding and outline, per leaf. */
const COVER_INSET_PX = 18;
/** The sheet's own padding plus the prose box's drag lane and right margin. */
const LEAF_INSET_PX = 104;

export function proseColumnPx(win: WindowSize): number {
  const stage = Math.min(
    win.width - VIEW_SIDE_PX,
    (win.height - STAGE_HEADER_PX) * STAGE_ASPECT,
    STAGE_MAX_PX,
  );
  return stage / 2 - COVER_INSET_PX - LEAF_INSET_PX;
}

/**
 * ~chars per rendered line of body text across the full page column, at the
 * reference window.
 *
 * 72 rather than the 82 the column's width over the face's 7.25px a character
 * would say, and the difference is greedy word wrap eating half a word off the
 * end of every line: measured against a ladder of paragraphs of graded length,
 * 72 is the value that misplaces the fewest rungs of it.
 */
const CHARS_PER_LINE = 72;

/** Width of one character of the body hand, measured: Patrick Hand at 20px. */
const BODY_CHAR_PX = 7.25;

/**
 * The same, at any window.
 *
 * Anchored on the measured 72 and moved by the pixels the column has gained or
 * lost, rather than scaled by the ratio of the two columns. That is not a
 * stylistic choice: the half-word greedy wrap throws away is roughly a fixed
 * number of CHARACTERS, not a fixed fraction of the line, so the additive form
 * predicts all five measured wraps of the same 287-character paragraph
 * (4 / 6 / 6 / 7 / 10 lines) and the multiplicative one misses the narrowest by
 * a line. It also leaves the reference window costing exactly what it costed
 * before, so none of the calibration above had to be re-read.
 */
export function charsPerLine(win: WindowSize): number {
  return (
    CHARS_PER_LINE +
    (proseColumnPx(win) - proseColumnPx(REFERENCE_WINDOW)) / BODY_CHAR_PX
  );
}

/**
 * A picture with nothing constraining it fills the column, and a picture of
 * ordinary proportions is then about as tall as the column is wide: 15.1 lines
 * measured, for a square-ish drawing in a 544px column. Scaled by the frame's
 * width, which is how a picture in a column or a photo row costs a third of
 * one on the page.
 */
const IMAGE_LINES = 15;

/**
 * How wide, how tall and in what type a run of text is being set.
 *
 * Threaded down through containers so a paragraph inside a postcard is costed
 * at the postcard's 27 characters a line rather than the page's 72. Every
 * number a cost function returns is in PAGE lines, whatever the frame — `line`
 * converts, so a sticky note's 26.4px lines come back as 0.82 of a page line
 * each.
 */
export interface Frame {
  /** Characters that fit on one rendered line here. */
  chars: number;
  /** Height of one of those lines, in page lines. */
  line: number;
  /** Width as a fraction of the page's text column — pictures scale by it. */
  width: number;
}

/**
 * The page's own frame at a given window — the top of the chain every cost is
 * taken in.
 *
 * `width` is a fraction of the REFERENCE column rather than of itself, because
 * that is what the one thing reading it needs: `IMAGE_LINES` is the height of a
 * full-width picture measured on the reference leaf, and a picture in a column
 * two thirds as wide is two thirds as tall while the rule under it stays 32px.
 * `line` is 1 at every window, and that is measured rather than assumed — the
 * leaf shrinks, the writing does not.
 *
 * What does NOT move with the window: a container's `chrome` and `min`, the
 * decoration heights, the diagram heights. Those are all fixed furniture in
 * pixels — a card's plate is a card's plate — and where they are not (a diagram
 * is scaled to fit its column, so a narrower one draws shorter) the error is
 * an OVER-charge, which cuts a page early instead of overflowing it. That is
 * the direction this whole file leans in, so they are left alone.
 */
export function pageFrameFor(win: WindowSize): Frame {
  const column = proseColumnPx(win);
  return {
    chars: charsPerLine(win),
    line: 1,
    width: column / proseColumnPx(REFERENCE_WINDOW),
  };
}

/** The frame the calibration table was read in — `chars` 72, everything 1. */
export const REFERENCE_FRAME: Frame = pageFrameFor(REFERENCE_WINDOW);

/** The frame pages are cut in, unless a caller names another window. */
export const TARGET_FRAME: Frame = pageFrameFor(TARGET_WINDOW);

/** Narrow a frame to a fraction of itself (a column, a photo row cell). */
function narrow(frame: Frame, fraction: number): Frame {
  return {
    chars: Math.max(8, frame.chars * fraction),
    line: frame.line,
    width: frame.width * fraction,
  };
}

/**
 * What a container adds to what it holds.
 *
 * `chrome`  lines of the container that are not its contents — plates, tape,
 *           padding, a title bar, a stamp.
 * `min`     the shortest the whole thing is ever drawn. A keepsake is a
 *           keepsake-sized object however little is written on it.
 * `chars`   characters per line inside it.
 * `line`    height of one of those lines, in page lines (a sticky note writes
 *           smaller; a quote card writes larger).
 * `width`   inside width as a fraction of the page column, for pictures.
 *
 * Measured by `scripts/probe-block-heights.mjs`; see the header. `chrome` is
 * read off the long-payload specimen and `min` off the short one, which is why
 * the two disagree for everything with a minimum height.
 */
interface ContainerCost {
  chrome: number;
  min: number;
  chars: number;
  line: number;
  width: number;
}

const CONTAINER: Record<string, ContainerCost> = {
  'sticky-note': { chrome: 1.8, min: 2.6, chars: 61, line: 0.82, width: 0.88 },
  'washi-box': { chrome: 1.7, min: 2.7, chars: 66, line: 1, width: 0.92 },
  callout: { chrome: 1.1, min: 2.2, chars: 61, line: 1, width: 0.85 },
  card: { chrome: 2.7, min: 3.7, chars: 66, line: 1, width: 0.92 },
  'quote-card': { chrome: 1.9, min: 2.9, chars: 50, line: 1.06, width: 0.82 },
  spoiler: { chrome: 2.3, min: 3.3, chars: 68, line: 1, width: 0.94 },
  banner: { chrome: 1.1, min: 2.1, chars: 50, line: 1, width: 0.85 },
  'index-card': { chrome: 2.8, min: 4.9, chars: 66, line: 1, width: 0.92 },
  envelope: { chrome: 1.8, min: 2.8, chars: 66, line: 1, width: 0.92 },
  stamp: { chrome: 2.0, min: 3.0, chars: 66, line: 1, width: 0.91 },
  tag: { chrome: 1.6, min: 2.6, chars: 49, line: 1, width: 0.9 },
  marginalia: { chrome: 0.6, min: 1.6, chars: 60, line: 1, width: 0.91 },
  'pressed-flower': { chrome: 2.4, min: 6.0, chars: 45, line: 1, width: 0.77 },
  'ticket-stub': { chrome: 1.8, min: 3.5, chars: 45, line: 1, width: 0.82 },
  // 24, where the canvas measurement of the postcard's column said 26: this
  // is the one entry taken from the line COUNT (287 characters wrapped to
  // twelve lines inside one) rather than from the width, because a postcard
  // sets its address side with enough inline padding that the two disagree.
  //
  // Was 27/eleven lines. The card's message column lost 33px when its reserve
  // was corrected to clear the printed divider instead of running 16px past it
  // (styles/effects.css, 6.16), and a narrower column is more lines for the
  // same words: re-measured with `PART=containers scripts/probe-block-heights`
  // in the same 1600×1000 window the rest of this table was read in.
  postcard: { chrome: 2.1, min: 6.3, chars: 24, line: 1, width: 0.5 },
  ledger: { chrome: 2.3, min: 3.3, chars: 68, line: 1, width: 0.94 },
  'wax-seal': { chrome: 1.6, min: 4.8, chars: 46, line: 1, width: 0.78 },
  'map-pin': { chrome: 1.8, min: 2.9, chars: 65, line: 1, width: 0.9 },
  toggle: { chrome: 1.0, min: 2.0, chars: 66, line: 1, width: 0.91 },
  // A picture in a white frame with a caption under it, and four paper corners
  // with a caption under those. Both are mostly the picture — the chrome here
  // is what is left once IMAGE_LINES at the frame's width has been taken out.
  polaroid: { chrome: 3.0, min: 3.0, chars: 60, line: 0.75, width: 0.76 },
  'photo-corner': { chrome: 4.2, min: 4.2, chars: 45, line: 1, width: 0.76 },
  // An unrecognised directive is drawn as a callout wearing its name.
  generic: { chrome: 1.1, min: 2.2, chars: 61, line: 1, width: 0.85 },
};

/** Side-by-side containers: as tall as their tallest child, not their sum. */
const SIDE_BY_SIDE: Record<string, number> = {
  // A row of columns costs a hairline of its own; the gap between them is
  // horizontal.
  columns: 1.0,
  // A photo row frames each picture and captions it.
  'image-row': 2.8,
};

/**
 * A column's share of the width. Two columns are 46% of the page column each
 * (measured), not 50: the gap between them comes out of both.
 */
function columnFraction(count: number): number {
  return Math.max(0.12, (1 - 0.08 * (count - 1)) / Math.max(1, count));
}

export function inlineText(content: readonly Inline[]): string {
  let out = '';
  for (const node of content) {
    if (node.kind === 'text' || node.kind === 'code') out += node.text;
    else if (node.kind === 'math' || node.kind === 'footnote') out += node.text;
    else if (node.kind === 'pageref') out += node.label;
    else out += inlineText(node.children);
  }
  return out;
}

/**
 * Inline code is set in a monospace face and boxed, and takes 1.85 times the
 * room the body hand takes for the same characters — measured: 287 characters
 * wrap to 4 lines as prose and 7.4 as code spans. Bold, by contrast, costs
 * nothing (also measured), which is why there is no weight for it.
 *
 * This is why every page of the welcome book came out under-predicted: it is a
 * manual, so nearly every line of it has a `\`fence\`` or a key name in it.
 */
const CODE_WIDTH = 1.85;

/**
 * Characters of a run of inline content, weighted by how wide they set.
 *
 * A FOOTNOTE IS ONE CHARACTER on the line, whatever is written in it. The note
 * is drawn at the foot of the page and the line only carries the raised number
 * that points at it (`.nb-prose .nb-footnote-ref`, a 13px digit) — so a note
 * of forty words was charging its paragraph forty words of wrap that nothing
 * on that line ever sets. Where the note's height IS charged is
 * `footnoteRailLines` below, against the strip it is actually drawn in.
 */
function textWeight(content: readonly Inline[]): number {
  let total = 0;
  for (const node of content) {
    if (node.kind === 'code') total += node.text.length * CODE_WIDTH;
    else if (node.kind === 'text') total += node.text.length;
    else if (node.kind === 'math') total += node.text.length;
    else if (node.kind === 'footnote') total += 1;
    else if (node.kind === 'pageref') total += node.label.length;
    else total += textWeight(node.children);
  }
  return total;
}

// ---------------------------------------------------------------------------
// The foot of the page — what the footnote rail takes out of the leaf
// ---------------------------------------------------------------------------

/**
 * A page with footnotes is SHORTER THAN A PAGE WITHOUT THEM, and this is where
 * the estimator learns it.
 *
 * Everything else in this file costs a block. The rail is not a block: it is a
 * strip that `src/editor/nodes/footnote.ts` stands at the foot of the leaf and
 * pays for by adding its own measured height into the prose's padding-bottom,
 * which is the one quantity the overflow drain re-reads on every pass. The
 * drain is therefore always right about it; the SPLITTER never knew it existed,
 * and the splitter is what decides how much goes on a page in the first place.
 *
 * What that costs, measured with `scripts/probe-footnote-capacity.mjs`: the
 * same authored page, once with its footnote and once with the marker deleted,
 * built through `createBookFromScript` and opened at 1360x850. Without the note
 * all six blocks stood on the leaf. With it the page reserved 41px, and the
 * last block — an index card — was evicted by the drain the first time the page
 * was looked at. One marker, one block off the end of the page.
 *
 * The numbers here are read off the same probe:
 *
 *  - the rail reserves `18 + 23n` pixels for n note LINES (8px of padding above
 *    the foot-rule, 23px a line, and 10px of slack the rail adds so the last
 *    block never touches it). Six notes measured 156px, which is that formula
 *    exactly. Over a 32px page line that is 0.56 of a line of chrome and 0.72
 *    of a line each.
 *  - a note wraps at 82 characters: 454px of note column at 5.55px a character,
 *    Patrick Hand at 15px. Wider than the page's 72 because the rail runs the
 *    full width of the leaf — it has neither the prose's 40px drag-handle lane
 *    nor its right padding — and is set five points smaller.
 *
 * Charged, like everything else here, in the direction that hurts less: a note
 * always costs at least one line even when it is empty, because an empty note
 * still draws its placeholder and still stands the rail up.
 */
const FOOTNOTE_RAIL_CHROME = 0.56;
const FOOTNOTE_NOTE_LINE = 0.72;
const FOOTNOTE_NOTE_CHARS = 82;

/** Width of one character of the rail's hand — Patrick Hand at 15px. */
const NOTE_CHAR_PX = 5.55;

/**
 * How wide a note sets at a given window.
 *
 * The rail's column is the leaf's full width, so it loses exactly the pixels
 * the prose column loses when the frame shrinks — both come off the same half
 * of the same spread. Moved additively for the same reason as `charsPerLine`,
 * and at the reference window it is the measured 82 unchanged.
 */
function noteCharsFor(win: WindowSize): number {
  return (
    FOOTNOTE_NOTE_CHARS +
    (proseColumnPx(win) - proseColumnPx(REFERENCE_WINDOW)) / NOTE_CHAR_PX
  );
}

/** Every footnote's note text in a run of inline content, in reading order. */
function inlineNotes(content: readonly Inline[], out: string[]): void {
  for (const node of content) {
    if (node.kind === 'footnote') out.push(node.text);
    else if (
      node.kind !== 'text' &&
      node.kind !== 'code' &&
      node.kind !== 'math' &&
      node.kind !== 'pageref'
    ) {
      inlineNotes(node.children, out);
    }
  }
}

function listNotes(items: readonly ListItem[], out: string[]): void {
  for (const item of items) {
    inlineNotes(item.content, out);
    listNotes(item.children, out);
  }
}

/**
 * Every note one block carries, however deeply it is buried.
 *
 * It reaches into containers, list items and table cells for the same reason
 * `collectFootnotes` walks the whole document with `descendants`: a note
 * inside a toggle or a column is still a note on this page, and still stands
 * the rail up.
 */
function blockNotes(block: Block, out: string[]): void {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      inlineNotes(block.content, out);
      return;
    case 'list':
    case 'taskList':
      listNotes(block.items, out);
      return;
    case 'table':
      if (block.header !== null) {
        for (const cell of block.header.cells) inlineNotes(cell, out);
      }
      for (const row of block.rows) {
        for (const cell of row.cells) inlineNotes(cell, out);
      }
      return;
    case 'container':
      for (const child of block.children) blockNotes(child, out);
      return;
    default:
      // A divider, a picture, a code fence, a diagram and a fetch card have no
      // inline content of their own, so none of them can carry a note.
      return;
  }
}

/** What a run of note texts costs as a rail, in page lines. */
function railLines(notes: readonly string[], chars: number): number {
  if (notes.length === 0) return 0;
  let lines = 0;
  for (const note of notes) {
    lines += Math.max(1, Math.ceil(note.trim().length / chars));
  }
  return FOOTNOTE_RAIL_CHROME + FOOTNOTE_NOTE_LINE * lines;
}

/**
 * What the footnotes on a run of blocks take out of the leaf, in page lines.
 *
 * Kept out of `blockLineCost` and `pageLineCost` deliberately: those two model
 * what a block DRAWS, they are calibrated against measured block heights in
 * `tests/split-calibration.test.ts`, and the rail is not a block's height. It
 * is page furniture, like a margin — a page-level term, and the splitter adds
 * it to the page-level total.
 */
export function footnoteRailLines(
  blocks: readonly Block[],
  win: WindowSize = TARGET_WINDOW,
): number {
  const notes: string[] = [];
  for (const block of blocks) blockNotes(block, notes);
  return railLines(notes, noteCharsFor(win));
}

/** Rendered lines of a run of inline content, in page lines. */
function textLines(content: readonly Inline[], frame: Frame): number {
  return Math.max(1, Math.ceil(textWeight(content) / frame.chars)) * frame.line;
}

function listLines(items: readonly ListItem[], frame: Frame): number {
  let lines = 0;
  for (const item of items) {
    lines += textLines(item.content, frame);
    lines += listLines(item.children, frame);
  }
  return lines;
}

/**
 * What a block's decoration attrs add to the room it takes, measured against
 * an undecorated paragraph of the same words.
 *
 * `underline` and `rotate` add nothing — the squiggle is drawn behind the
 * words and a tilt does not change what the block was laid out at. The other
 * five mount the block on something, and the room that costs is on BOTH sides
 * of it: a decorated block carries a full line of margin above as well as its
 * plate below.
 *
 * That second half is why the welcome book's decorations page came out three
 * lines short on the first pass. A specimen measured on its own reports the
 * distance to the next block, and with nothing after it the margin above it
 * lands on whatever was in front — so on a real page it was the UNDECORATED
 * paragraph above each of these that measured a line taller than it draws.
 * These numbers are the whole margin box, which is right whenever a decorated
 * block has plain ones either side of it, and over-charges by a margin when
 * two of them are stacked.
 *
 * They do not add up, either: torn paper inside a scalloped frame measured the
 * same as torn paper on its own, because the two share the padding. So the
 * biggest one wins rather than the sum.
 */
const EFFECT_LINES: Record<string, number> = {
  paper: 3.0,
  frame: 2.75,
  shadow: 2.56,
  tape: 1.0,
  washi: 1.0,
};

function effectLines(attrs: Record<string, unknown>): number {
  let most = 0;
  for (const [key, lines] of Object.entries(EFFECT_LINES)) {
    const value = attrs[key];
    if (value !== undefined && value !== null && value !== false) {
      most = Math.max(most, lines);
    }
  }
  return most;
}

/**
 * Deepest nesting of a tree diagram, which is what its height follows — a tree
 * grows DOWN by level and sideways by sibling, and the renderer scales a wide
 * one to fit rather than letting it grow taller (measured: eight siblings drew
 * SHORTER than two, because the fit kicked in).
 */
function treeDepth(nodes: readonly TreeNode[]): number {
  let deepest = 0;
  for (const node of nodes) {
    deepest = Math.max(deepest, 1 + treeDepth(node.children));
  }
  return deepest;
}

/**
 * Longest chain through a graph, in nodes — the layered layout stacks one rank
 * per link, so that is what sets its height. Cycle-safe: a node already on the
 * path being walked ends the walk rather than recurring forever.
 */
function graphLayers(diagram: DiagramBlock & { lang: 'graph' | 'flowchart' }): number {
  const out = new Map<string, string[]>();
  const ids = new Set<string>();
  for (const node of diagram.graph.nodes) ids.add(node.id);
  for (const edge of diagram.graph.edges) {
    ids.add(edge.from);
    ids.add(edge.to);
    const list = out.get(edge.from);
    if (list === undefined) out.set(edge.from, [edge.to]);
    else list.push(edge.to);
  }
  const memo = new Map<string, number>();
  const walk = (id: string, path: Set<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (path.has(id)) return 1;
    path.add(id);
    let deepest = 1;
    for (const next of out.get(id) ?? []) {
      deepest = Math.max(deepest, 1 + walk(next, path));
    }
    path.delete(id);
    memo.set(id, deepest);
    return deepest;
  };
  let longest = ids.size === 0 ? 0 : 1;
  for (const id of ids) longest = Math.max(longest, walk(id, new Set()));
  return longest;
}

/**
 * The gutter a diagram's canvas keeps inside the prose column, in pixels.
 *
 * Measured: at a 592px column the widest an `.nb-dg-svg` was ever drawn was
 * 544px, and at a 434px column it was 386px. The same 48 either time.
 */
const DIAGRAM_INSET_PX = 48;

/**
 * How much a diagram that runs to the width of its column is shrunk to fit it,
 * relative to the reference window everything here was measured in.
 *
 * `scripts/probe-diagram-scale.mjs` settled what a diagram does when the window
 * moves, and the answer is TWO answers. The SVG carries a viewBox sized by the
 * layout and is drawn at `min(intrinsic width, column - 48)`:
 *
 *   Mindmap    viewBox 663 wide   drawn 544 -> 386   14.22 lines -> 10.09
 *   Timeline   viewBox 580 wide   drawn 544 -> 386    6.34 lines ->  4.50
 *   Graph      viewBox 207 wide   drawn 207 -> 207    8.38 lines ->  8.38
 *   Flowchart  viewBox 125 wide   drawn 125 -> 125   10.75 lines -> 10.75
 *
 * So a layout that spreads SIDEWAYS is clamped by the column and scales with
 * it exactly (10.09/14.22 and 4.50/6.34 are both 386/544 to three places),
 * while a layout that stacks DOWNWARD is narrower than the column at any window
 * anyone uses and does not move at all.
 *
 * That is why this is applied to the mindmap and the timeline and not to the
 * graph, the flowchart or the tree. A tree is the awkward one — it was measured
 * at both, 7.63 lines shrinking to 6.53 (clamped) and 7.09 to 5.03 (clamped
 * harder) — and it is left unscaled deliberately, because a tree narrow enough
 * to escape the clamp would then be charged for a shrink that never happened,
 * and under-charging a page rearranges the book while over-charging one only
 * ends it early.
 */
function diagramFitScale(frame: Frame): number {
  const reference = proseColumnPx(REFERENCE_WINDOW);
  return Math.min(
    1,
    (frame.width * reference - DIAGRAM_INSET_PX) / (reference - DIAGRAM_INSET_PX),
  );
}

/** Estimated drawn height of a diagram, in page lines. */
function diagramLines(block: DiagramBlock, frame: Frame): number {
  switch (block.lang) {
    case 'tree':
      // 5.1 lines at two levels, 7.6 at three. Capped because the renderer
      // shrinks a diagram to fit rather than running it off the leaf.
      return Math.min(12, 2.5 * Math.max(1, treeDepth(block.roots)));
    case 'mindmap':
      // The same grammar thrown outward costs almost twice as much room: 9.2
      // lines at two levels, 14.1 at three, 16.5 at four (where the fit
      // starts holding it back). Reading it as a tree is what left the
      // welcome book's mindmap page predicted at 57% of a leaf and drawn at
      // 90 — the largest single error the calibration turned up.
      //
      // Scaled by the fit, because a mindmap is always wider than the column
      // and is always shrunk into it — see `diagramFitScale`.
      return (
        Math.min(16.5, 4.9 * Math.max(1, treeDepth(block.roots)) - 0.6) *
        diagramFitScale(frame)
      );
    case 'timeline':
      // 3.3 lines for two short entries, 8.7 for eight, 6.8 for four whose
      // text wraps — an entry's column is narrow, about 30 characters.
      // Scaled by the fit for the same reason as the mindmap: a timeline runs
      // along the page and is clamped to the column at every window measured.
      return (
        (1.4 +
          0.9 *
            block.entries.reduce(
              (n, entry) => n + Math.max(1, Math.ceil(entry.text.length / 30)),
              0,
            )) *
        diagramFitScale(frame)
      );
    default:
      // 8.4 lines for a chain of three, 17.0 for a chain of six.
      return Math.min(18, 2.9 * graphLayers(block));
  }
}

/** Estimated line cost of one container, in page lines. */
function containerLines(block: ContainerBlock, frame: Frame): number {
  const side = SIDE_BY_SIDE[block.name];
  if (side !== undefined) {
    // Side-by-side: as tall as the tallest child, in a frame each child's
    // share of the width. A `col` is transparent — it is the shelf the blocks
    // stand on, not a thing that is drawn.
    const cells = block.children.length;
    const inner = narrow(frame, columnFraction(cells));
    let tallest = 0;
    for (const child of block.children) {
      tallest = Math.max(tallest, blockLines(child, inner));
    }
    return side + tallest;
  }
  if (block.name === 'col') {
    let lines = 0;
    for (const child of block.children) lines += blockLines(child, frame);
    return lines;
  }
  const cost = CONTAINER[block.name] ?? CONTAINER.generic;
  const inner: Frame = {
    chars: (cost.chars / CHARS_PER_LINE) * frame.chars,
    line: cost.line * frame.line,
    width: cost.width * frame.width,
  };
  let held = 0;
  for (const child of block.children) held += blockLines(child, inner);
  return Math.max(cost.min * frame.line, cost.chrome * frame.line + held);
}

/**
 * How wide a heading sets, as a fraction of the body's characters per line.
 * Measured: 46.7 characters across an H2's column against the body's 73.5, and
 * the H1 face is 42px to the H2's 33px.
 */
const HEADING_WIDTH = [0.5, 0.63, 0.8] as const;

/** Tall constructs — a stacked fraction or a big operator with limits. */
const TALL_MATH = /\\(frac|dfrac|sqrt|binom|sum|int|oint|prod|lim|over)\b|\\\\/;

/** Lines a table row takes: its tallest cell, at the column's share. */
function tableRowLines(cells: readonly (readonly Inline[])[], frame: Frame): number {
  const columns = Math.max(1, cells.length);
  const cellChars = Math.max(8, frame.chars / columns);
  let tallest = 1;
  for (const cell of cells) {
    tallest = Math.max(tallest, Math.ceil(textWeight(cell) / cellChars));
  }
  return tallest;
}

/** Estimated line cost of one block, in a given frame. */
function blockLines(block: Block, frame: Frame): number {
  return bareBlockLines(block, frame) + effectLines(block.attrs);
}

function bareBlockLines(block: Block, frame: Frame): number {
  switch (block.kind) {
    case 'heading': {
      // Measured: an H1 and an H2 own two rules each, an H3 one — and a
      // heading that carries a sticker is exactly as tall as one that does
      // not, which is worth saying because every leaf of the welcome book
      // opens with one and it looked like the obvious missing line.
      const chars = frame.chars * HEADING_WIDTH[block.level - 1];
      const lines = Math.max(1, Math.ceil(textWeight(block.content) / chars));
      return lines * (block.level <= 2 ? 2 : 1) * frame.line;
    }
    case 'paragraph':
      return textLines(block.content, frame);
    case 'quote':
      // A blockquote is indented to 91% of its column and adds nothing else.
      return textLines(block.content, narrow(frame, 0.91));
    case 'divider':
      return 1 * frame.line;
    case 'list':
    case 'taskList':
      // A marker lane takes 6% of the width; the items themselves cost their
      // own lines and nothing more.
      return listLines(block.items, narrow(frame, 0.94));
    case 'table': {
      // 2.8 lines for a header and one row, 6.7 for a header and four, 9.3
      // for a header and six — 1.28 a row, plus a third of a line of plate.
      // A row whose cells wrap is that many rows tall: the same four-row
      // table with code spans in it drew ten lines rather than six.
      let rows = block.header === null ? 0 : tableRowLines(block.header.cells, frame);
      for (const line of block.rows) rows += tableRowLines(line.cells, frame);
      return 0.3 + 1.28 * rows;
    }
    case 'image':
      return (
        IMAGE_LINES * frame.width +
        (typeof block.attrs.caption === 'string' ? 0.8 : 0)
      );
    case 'mathBlock':
      // 1.25 lines for `e^{i\pi} + 1 = 0`, 2.3 to 2.7 for one with a stacked
      // fraction, a radical or a big operator carrying limits.
      //
      // The per-extra-row term is the one number on this page that is not
      // measured: the probe's `aligned` environment did not render as one, so
      // what a working multi-line environment costs was never seen. It is
      // charged rather than assumed free because over-charging a page only
      // makes it break earlier, and under-charging it rearranges the book.
      return (
        1.25 +
        (TALL_MATH.test(block.latex) ? 1.1 : 0) +
        0.6 * (block.latex.split('\n').length - 1)
      );
    case 'code':
      // 2.3 lines for one line of code, 9.5 for ten: the plate and the
      // language tab cost ~1.5, and code is set a little tighter than prose.
      // Code does not reflow, so unlike a paragraph the newlines ARE the
      // height and there is no wrapping estimate to make.
      return 1.55 + 0.79 * block.code.split('\n').length;
    case 'diagram':
      return diagramLines(block, frame);
    case 'fetchDirective':
      // The one unmeasured cost left: it draws a card built from a network
      // fetch, which a headless probe has nothing to answer with.
      return 9;
    case 'container':
      return containerLines(block, frame);
  }
}

/**
 * Estimated rendered line cost of one block on a full-width page.
 *
 * The public surface, and the one the seed test and the splitter both use.
 * Costs inside a container go through `blockLines` with that container's
 * frame instead.
 *
 * The frame defaults to the window the app opens at, which is the question
 * anybody costing a page is really asking. Pass `REFERENCE_FRAME` to ask the
 * other one — what this block measured at, in the window the table was read
 * in — which is what `tests/split-calibration.test.ts` does.
 */
export function blockLineCost(block: Block, frame: Frame = TARGET_FRAME): number {
  return blockLines(block, frame);
}

/**
 * What a run of blocks DRAWS on one leaf.
 *
 * Blocks only. The foot of the page — the footnote rail — is
 * `footnoteRailLines`, and it is deliberately not added in here: this number is
 * checked against measured block heights in `tests/split-calibration.test.ts`,
 * and folding page furniture into it would make that comparison compare two
 * different things. Anything asking "does this fit a leaf" wants both.
 */
export function pageLineCost(
  blocks: readonly Block[],
  frame: Frame = TARGET_FRAME,
): number {
  let total = 0;
  for (const block of blocks) total += blockLineCost(block, frame);
  return total;
}

export interface SplitOptions {
  /**
   * The window the pages are being cut for — default `TARGET_WINDOW`, the size
   * the app opens at. Sets the budget, the wrap and the width of a picture all
   * at once, because at a smaller window all three move together.
   */
  window?: WindowSize;
  /** Line budget per page (default: the budget for `window`). */
  maxLines?: number;
  /** Start a new page on every level-1 heading (default true). */
  splitOnH1?: boolean;
}

/**
 * Split top-level blocks into page-sized runs. Always returns at least one
 * page (an empty doc yields one empty page).
 */
export function splitBlocksIntoPages(
  blocks: readonly Block[],
  options: SplitOptions = {},
): Block[][] {
  const win = options.window ?? TARGET_WINDOW;
  const frame = options.window === undefined ? TARGET_FRAME : pageFrameFor(win);
  const noteChars = noteCharsFor(win);
  const maxLines = options.maxLines ?? lineBudgetFor(win);
  const splitOnH1 = options.splitOnH1 ?? true;

  const pages: Block[][] = [];
  let current: Block[] = [];
  let currentLines = 0;
  /* The notes the page in hand is carrying, so the foot can be priced without
     re-walking every block on it for each new one. */
  let currentNotes: string[] = [];

  const flush = (): void => {
    if (current.length > 0) {
      pages.push(current);
      current = [];
      currentLines = 0;
      currentNotes = [];
    }
  };

  for (const block of blocks) {
    const isH1 = block.kind === 'heading' && block.level === 1;
    if (splitOnH1 && isH1) flush();

    const cost = blockLineCost(block, frame);
    // The foot of the page is charged against the WHOLE page, not against the
    // block that happens to carry the marker: a note anywhere on the leaf
    // stands the same rail up, and a second note on the same page costs one
    // more line rather than another rail. So the test is the page as it would
    // be with this block on it — blocks, plus the rail those blocks' notes
    // would need.
    const notes: string[] = [];
    blockNotes(block, notes);
    const foot = railLines([...currentNotes, ...notes], noteChars);
    if (current.length > 0 && currentLines + cost + foot > maxLines) flush();

    current.push(block);
    currentLines += cost;
    currentNotes = [...currentNotes, ...notes];
  }
  flush();

  if (pages.length === 0) pages.push([]);
  return pages;
}

/** Book title: frontmatter `title:`, else the first H1, else the fallback. */
export function deriveBookTitle(doc: ScriptDoc, fallback: string): string {
  const fromFrontmatter = doc.frontmatter.title?.trim();
  if (fromFrontmatter !== undefined && fromFrontmatter !== '') {
    return fromFrontmatter.slice(0, 80);
  }
  for (const block of doc.blocks) {
    if (block.kind === 'heading' && block.level === 1) {
      const text = inlineText(block.content).trim();
      if (text !== '') return text.slice(0, 80);
    }
  }
  const clean = fallback.trim();
  return clean === '' ? 'Imported notes' : clean.slice(0, 80);
}

/** `notes.study.md` → `notes.study`; path separators tolerated. */
export function titleFromFileName(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return base.replace(/\.(md|markdown|txt)$/i, '');
}

// ---------------------------------------------------------------------------
// Shelf placement — first free slot scanning floors downward.
// ---------------------------------------------------------------------------

/** Matches the shelf world geometry (bookshelf/constants.ts): ~19 slots. */
export const SLOTS_PER_FLOOR = 19;

export interface ShelfSpot {
  floor: number;
  slot: number;
}

/** First free slot on the lowest-indexed floor with room. Pure. */
export function nextShelfSpot(
  books: ReadonlyArray<{ floor: number; slot: number }>,
  slotsPerFloor = SLOTS_PER_FLOOR,
): ShelfSpot {
  const used = new Map<number, Set<number>>();
  for (const book of books) {
    let slots = used.get(book.floor);
    if (slots === undefined) {
      slots = new Set();
      used.set(book.floor, slots);
    }
    slots.add(book.slot);
  }
  for (let floor = 0; floor < 10_000; floor += 1) {
    const slots = used.get(floor);
    if (slots === undefined) return { floor, slot: 0 };
    for (let slot = 0; slot < slotsPerFloor; slot += 1) {
      if (!slots.has(slot)) return { floor, slot };
    }
  }
  return { floor: 0, slot: 0 };
}
