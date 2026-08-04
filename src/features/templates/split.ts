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
 * `tests/split-calibration.test.ts` writes the readings down and checks the
 * estimator against them. Against the thirty-two seeded pages it is out by 0.7
 * of a line on average and never by more than 2.1.
 *
 * What the measurements found, and what the old estimator was doing instead:
 *
 *  - **A leaf holds 25.66 lines** (821px of capacity over 32px lines, at a
 *    1600x1000 window). `PAGE_LINE_BUDGET` was 26 and its comment said "26px
 *    lines on ~780px" — right number, wrong arithmetic underneath it.
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

/**
 * What the splitter is allowed to put on a page.
 *
 * A leaf holds **25.66** lines, measured: 821px of capacity (`.nb-leaf-paper`
 * clientHeight less its padding, which is what `BookView.measureCapacity`
 * compares block bottoms against) over 32px lines, at a 1600x1000 window.
 *
 * The budget is not that number, because the estimator is not exact and the
 * two ways of being wrong do not cost the same. A page cut early is a leaf
 * that stops a little short; a page cut LATE does not clip — leaves never
 * scroll, so the excess flows onward and the book comes back longer than it
 * was made, with every page after the guilty one carrying somebody else's
 * tail. So the budget is the capacity less the estimator's own error.
 *
 * That error is measured too, against the thirty-two seeded pages walked by
 * `scripts/probe-page-cost.mjs`: it is 0.7 of a line on average and it
 * under-states by at most 1.9. 23.5 leaves room for the worst of those, and
 * `scripts/probe-split-fill.mjs` is where the number was settled — at 25.5 a
 * nine-page import arrived as ten, which is exactly the failure above.
 */
export const PAGE_LINE_BUDGET = 23.5;

/** ~chars per rendered line of body text across the full page column. */
const CHARS_PER_LINE = 72;

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
interface Frame {
  /** Characters that fit on one rendered line here. */
  chars: number;
  /** Height of one of those lines, in page lines. */
  line: number;
  /** Width as a fraction of the page's text column — pictures scale by it. */
  width: number;
}

const PAGE_FRAME: Frame = { chars: CHARS_PER_LINE, line: 1, width: 1 };

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
  // 27, where the canvas measurement of the postcard's column said 30: this
  // is the one entry taken from the line COUNT (287 characters wrapped to
  // eleven lines inside one) rather than from the width, because a postcard
  // sets its address side with enough inline padding that the two disagree.
  postcard: { chrome: 2.1, min: 6.3, chars: 27, line: 1, width: 0.5 },
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

/** Characters of a run of inline content, weighted by how wide they set. */
function textWeight(content: readonly Inline[]): number {
  let total = 0;
  for (const node of content) {
    if (node.kind === 'code') total += node.text.length * CODE_WIDTH;
    else if (node.kind === 'text') total += node.text.length;
    else if (node.kind === 'math' || node.kind === 'footnote') {
      total += node.text.length;
    } else if (node.kind === 'pageref') total += node.label.length;
    else total += textWeight(node.children);
  }
  return total;
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

/** Estimated drawn height of a diagram, in page lines. */
function diagramLines(block: DiagramBlock): number {
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
      return Math.min(16.5, 4.9 * Math.max(1, treeDepth(block.roots)) - 0.6);
    case 'timeline':
      // 3.3 lines for two short entries, 8.7 for eight, 6.8 for four whose
      // text wraps — an entry's column is narrow, about 30 characters.
      return (
        1.4 +
        0.9 *
          block.entries.reduce(
            (n, entry) => n + Math.max(1, Math.ceil(entry.text.length / 30)),
            0,
          )
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
      return diagramLines(block);
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
 */
export function blockLineCost(block: Block): number {
  return blockLines(block, PAGE_FRAME);
}

/** What a run of blocks costs on one leaf. */
export function pageLineCost(blocks: readonly Block[]): number {
  let total = 0;
  for (const block of blocks) total += blockLineCost(block);
  return total;
}

export interface SplitOptions {
  /** Line budget per page (default PAGE_LINE_BUDGET). */
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
  const maxLines = options.maxLines ?? PAGE_LINE_BUDGET;
  const splitOnH1 = options.splitOnH1 ?? true;

  const pages: Block[][] = [];
  let current: Block[] = [];
  let currentLines = 0;

  const flush = (): void => {
    if (current.length > 0) {
      pages.push(current);
      current = [];
      currentLines = 0;
    }
  };

  for (const block of blocks) {
    const isH1 = block.kind === 'heading' && block.level === 1;
    if (splitOnH1 && isH1) flush();

    const cost = blockLineCost(block);
    if (current.length > 0 && currentLines + cost > maxLines) flush();

    current.push(block);
    currentLines += cost;
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
