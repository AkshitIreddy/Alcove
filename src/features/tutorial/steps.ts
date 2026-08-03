/**
 * src/features/tutorial/steps.ts — the guided tour script.
 *
 * VOICE: plain and warm. Say what the thing is, not what it is like. The tour
 * is the first thing a new reader sees, and "a bookshelf you can actually live
 * in" tells them nothing about what happens when they click. Describe the
 * mechanism; the app's charm is in the app.
 *
 * SHAPE: almost every step asks for one concrete action and names the fact
 * (see ./probe.ts) that proves it happened. The card turns green the moment
 * the tour sees it, then moves on by itself. The two steps with nothing to do
 * — the greeting and the sign-off — carry no task at all rather than showing
 * a tick nobody earned.
 *
 * TWO LENGTHS: the greeting asks which tour the reader wants, and every step
 * carries `short`. The short tour is a real SUBSET — same steps, same order,
 * fewer of them — which is what lets one script serve both without a second
 * copy of the copy drifting out of sync. `tests/tutorial.test.ts` pins the
 * subset relation; `tourSteps()` is the only place that does the filtering.
 *
 * TARGETS: candidate selectors, most specific first, each able to carry its
 * own padding — a step often points at a different element depending on what
 * is on screen (the gear before Settings opens, the sheet afterwards). Nothing
 * here assumes a target exists: an unmatched step renders as a centred,
 * anchorless card so the lesson still lands. Selectors are owned by other
 * features and treated as hints, never contracts.
 *
 * A step's targets do double duty: on entering a step the tour closes every
 * panel, sheet and menu the reader has open EXCEPT the ones a target points
 * inside (see ./dismiss.ts). So "this step is about the customize sheet" is
 * said once, in the target list, rather than as a per-step close instruction.
 */

import { BOOK_PRESETS } from '../../art/bookDesign';
import { SHELF_PRESETS } from '../../art/shelfDesign';
import { WALLPAPER_PRESETS } from '../../art/wallpaperDesign';
import type { Inset, PadBox, Side } from './engine';
import type { TourFactKey } from './probe';

/**
 * The sign-off quotes real counts rather than an adjective.
 *
 * Read from the vocabularies, never typed here: a tour that says "over a
 * hundred" is a sentence somebody has to remember to update, and the first
 * time it goes stale it is the app lying to a reader in their first five
 * minutes. These three are pure data modules with no `window` at import, so
 * the tour can hold them.
 */
const OPENNESS = {
  cases: SHELF_PRESETS.length,
  papers: WALLPAPER_PRESETS.length,
  bindings: BOOK_PRESETS.length,
} as const;

/** Which top-level scene a step is really about. */
export type StepScene = 'shelf' | 'book' | 'any';

/** How much of the tour the reader asked for. */
export type TourLength = 'short' | 'full';

/**
 * One candidate spotlight. The long form exists because a single step often
 * has to frame very differently shaped things: an editor block needs 46px of
 * reach to the left to swallow the drag-handle gutter, while the book flying
 * out of the shelf on the same step wants a plain even margin.
 */
export interface StepTarget {
  readonly selector: string;
  /** Even padding around the matched box, px. */
  readonly pad?: number;
  /** Per-side padding, px. Applied after `pad`. */
  readonly padBox?: PadBox;
  /** Spotlight only a patch of the box (fractions of its own size). */
  readonly inset?: Inset | number;
}

/**
 * A wrong turn worth naming out loud.
 *
 * A step whose task cannot be satisfied by the obvious nearby gesture will
 * otherwise sit there looking broken: the reader drags the shelf, nothing goes
 * green, and the tour has said nothing about why. When `when` is observed and
 * the step's own fact still is not, the card says `say` instead of sulking.
 */
export interface StepNudge {
  readonly when: TourFactKey;
  readonly say: string;
}

/** What the reader has to do before the step counts as finished. */
export interface StepTask {
  /** Imperative line, shown while the step is unfinished. */
  readonly ask: string;
  /** The observed fact that means "done". */
  readonly fact: TourFactKey;
  /** Line shown, in green, once it lands. */
  readonly done: string;
  /** Said when the reader tries the wrong thing (see StepNudge). */
  readonly nudge?: StepNudge;
}

export interface TutorialStep {
  readonly id: string;
  /** Handwritten heading on the speech card. */
  readonly title: string;
  /** Two or three sentences of body copy. */
  readonly body: string;
  /** Optional keycap/gesture line under the body. */
  readonly hint?: string;
  /** The thing to try, and how the tour knows you tried it. */
  readonly task?: StepTask;
  /** Candidate spotlights, most specific first. */
  readonly targets?: readonly (string | StepTarget)[];
  /** Preferred card side relative to the target. */
  readonly side?: Side;
  /** Scene this step describes — drives the "over on the shelf" ribbon. */
  readonly scene?: StepScene;
  /** Step over this entirely when the target is missing. */
  readonly skipIfMissing?: boolean;
  /** Part of the short tour too, not only the full rundown. */
  readonly short?: boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Alcove',
    body: 'Your books stand on a shelf. Open one and you get pages you can write on, and everything you write is saved as you go. Each step below asks you to try one thing — the card turns green once you have. How much would you like to see?',
    hint: 'Enter to go on · Esc to leave',
    scene: 'any',
    short: true,
  },
  {
    // FIRST RUN ONLY, and it is a gate on purpose.
    //
    // An empty case puts a "write my first one" invite in the middle of the
    // screen, and the tour used to walk straight past it: the next step asked
    // for a drag, the reader dragged, and the tour advanced to "click a spine"
    // on a case with no spines on it. The step now waits for the book — a
    // shelf gesture no longer counts as progress here, and the nudge says why
    // rather than leaving a card that looks broken.
    //
    // `skipIfMissing` plus targets that ONLY match the first-run invite is
    // what keeps it out of every other reader's tour: no invite, no step.
    id: 'first-book',
    title: 'Start with one book',
    body: 'The case is empty, so there is nothing to open yet. The invite makes your first book and lets you write its title straight up the spine — press Enter when you have named it, and it takes its place on the shelf. New book, on the rail to the left, does the same thing at any time.',
    hint: 'click "write my first one" · then name it',
    task: {
      ask: 'Click "write my first one" to make a book.',
      fact: 'first-book-made',
      done: 'Your first book is on the shelf.',
      nudge: {
        when: 'shelf-moved',
        // Names both controls rather than a position. The invite stands on
        // whichever floor the ghost slot is on, and a big enough drag can
        // carry that floor off screen — at which point "the one above" would
        // be pointing at nothing and "new book" is the way through.
        say: 'the shelf can wait — press "write my first one", or "new book" on the left rail',
      },
    },
    targets: [
      { selector: '.shelf-firstrun', pad: 14 },
      { selector: '.shelf-firstrun__btn', pad: 12 },
    ],
    side: 'right',
    scene: 'shelf',
    skipIfMissing: true,
    short: true,
  },
  {
    id: 'shelf-moves',
    title: 'Moving around the shelf',
    // The reader is only on the shelf once before they open a book, so this is
    // where the studio gets named — the case and the wall are the largest
    // things they can change and the least obvious, since the palette icon on
    // the left says nothing about how much is behind it. The spotlight below
    // reaches to 3% on the left rather than 16% so the dock is lit while this
    // is being read; a step that points at a tool in the dark is worse than one
    // that never mentions it.
    body: 'Drag the shelf to move it. Roll the wheel to zoom in and out, and hold Shift while you roll to slide sideways instead. New floors appear below as you fill the ones above, so the case grows with the library. The palette on the left opens the studio, and the bookcase is yours in there — how it is built, what is worked into the timber, its colours, and the paper on the wall, with dozens of each to choose from.',
    hint: 'drag to move · wheel to zoom · shift+wheel to slide',
    task: {
      ask: 'Drag the shelf, or zoom it with the wheel.',
      fact: 'shelf-moved',
      done: 'The shelf goes wherever you take it.',
    },
    targets: [
      { selector: '.shelf-root', inset: { top: 0.05, bottom: 0.11, left: 0.03, right: 0.16 } },
    ],
    side: 'right',
    scene: 'shelf',
    short: true,
  },
  {
    id: 'shelf-dock',
    title: 'The shelf has a rail too',
    body: 'Four tools stand on the wall to the left of the case, and they act on the library rather than on one book. New book puts one on the floor you are looking at. Studio dresses the room. Add floor grows the case downward. Trash keeps every book you crumple, so nothing you throw away is really gone until you say so.',
    hint: 'point at one for its name',
    task: {
      ask: 'Point at any tool on the shelf rail.',
      fact: 'shelf-dock-hovered',
      done: 'That is everything the shelf itself can do.',
    },
    targets: [{ selector: '.shelf-dock', pad: 12 }],
    side: 'right',
    scene: 'shelf',
  },
  {
    id: 'shelf-studio',
    title: 'The studio dresses the room',
    body: `The palette opens the studio, and it is the biggest set of choices in the app: ${OPENNESS.cases} bookcases to build, ${OPENNESS.papers} papers for the wall behind them, a colour scheme for the timber and the recess, and the bookcases themselves — you can keep more than one and switch between them. Nothing in here is permanent; pick another and the room repaints while you watch.`,
    hint: 'shelf rail → the palette',
    task: {
      ask: 'Open the studio — the palette on the shelf rail.',
      fact: 'shelf-studio-open',
      done: 'The whole room lives in here.',
    },
    targets: [
      { selector: '.nb-rail-panel.is-shelf[aria-hidden="false"]', pad: 6 },
      { selector: '.shelf-dock__btn[data-shelf-dock="studio"]', pad: 10 },
    ],
    side: 'right',
    scene: 'shelf',
  },
  {
    id: 'open-a-book',
    title: 'Opening a book',
    body: 'Click a spine and the book tips out of the case and opens. Wrong one? Catch it mid-flight and drag it back onto the case, or press Escape and it goes home. The way back to the shelf waits in the top-left corner.',
    hint: 'click a spine · Esc puts it back',
    task: {
      ask: 'Take the book off the shelf and open it.',
      fact: 'book-open',
      done: 'The book is open.',
    },
    // Three scenes, one step: the books standing on the shelf, the book in
    // flight, and — the moment it lands — the whole opened book. That last one
    // is why the highlight no longer ends up smaller than the thing it frames.
    //
    // The flight's padding used to reserve 150px below the cover for a plate of
    // two verbs ("read it" / "put it back") that sat under it. The reader threw
    // that plate out, so the padding is even again: a book in flight is now
    // just a cover.
    targets: [
      { selector: '.nb-book-cover', pad: 8 },
      { selector: '.pulled-book', pad: 12 },
      {
        selector: '.shelf-addslot',
        padBox: { left: 176, right: 18, top: 20, bottom: 20 },
      },
      { selector: '.shelf-root', inset: { top: 0.05, bottom: 0.62, left: 0.28, right: 0.28 } },
    ],
    side: 'right',
    scene: 'shelf',
    short: true,
  },
  {
    id: 'the-rail',
    title: 'The tools live on the left',
    body: 'Nothing sits across the top of a page. Every tool for this book is an icon on the left edge — point at one and its name appears beside it. The upper group opens a panel; below the little divider, the rest act the moment you press them.',
    hint: 'point at an icon for its name',
    task: {
      ask: 'Point at any icon on the rail.',
      fact: 'rail-hovered',
      done: 'That is every book tool there is.',
    },
    targets: [{ selector: '.nb-rail', pad: 8 }],
    side: 'right',
    scene: 'book',
    short: true,
  },
  {
    id: 'writing',
    title: 'Writing on a page',
    body: 'Click any line and type. A slash opens the block menu — headings, lists, quotes, tasks, tables, diagrams — without your hands leaving the keyboard. There is no save button: the pencil at the foot of the rail scribbles each time your work reaches the disk.',
    hint: 'type / for the block menu',
    task: {
      ask: 'Click a line and type a few words.',
      fact: 'typed',
      done: 'Written, and already saved.',
    },
    targets: [{ selector: '.nb-prose', pad: 10 }, { selector: '.nb-sheet-paper', pad: 8 }],
    side: 'right',
    scene: 'book',
    short: true,
  },
  {
    id: 'blocks',
    title: 'Every block can move',
    body: 'A paragraph, a heading, a list — each one is a block you can pick up. Right-click a block for its menu: change what kind of block it is, duplicate it, tint it, or send it to another page. Point at a block and six dots appear in the margin; that is its handle. Drag it and drop it anywhere on the lit page, between any two lines.',
    hint: 'right-click the block · then drag the ⠿ handle onto another line',
    task: {
      ask: 'Right-click a block, then drag it by the handle.',
      fact: 'block-handled',
      done: 'That is the block menu, and that is how blocks move.',
    },
    // THE WHOLE WRITING COLUMN, not one paragraph.
    //
    // This step used to frame a single block (`.nb-prose > p` plus 48px of
    // left gutter). It was reported as too small to drag in: the reader picks
    // the block up and has to drop it on ANOTHER block, which was outside the
    // lit patch and under the dim — and the moment the pointer leaves the
    // editor the browser draws the not-allowed cursor, so a legitimate move
    // read as forbidden.
    //
    // `.nb-prose` IS the ProseMirror root (PageEditor sets it as the editor's
    // own class), so its box is exactly the region where a drop is legal —
    // handle gutter included, since the first block sits 40px inside it. Padding
    // it would light paper that rejects the drop, so it gets `pad: 0`:
    // everything lit here can be dropped on, and everything droppable is lit.
    // `shots-now/tour-drive.mjs` samples the hole and checks that.
    targets: [
      { selector: '.nb-prose', pad: 0 },
      { selector: '.nb-sheet-paper', pad: 6 },
    ],
    side: 'right',
    scene: 'book',
  },
  {
    id: 'pages',
    title: 'Turning the page',
    body: 'Drag the corner of the page and it curls over; the arrow keys do the same thing without the flourish. Pages are a fixed height and never scroll — write past the bottom and the overflow moves onto the next page on its own, making one if there is none.',
    hint: '← → to turn · or drag the corner',
    task: {
      ask: 'Turn to the next page.',
      fact: 'page-turned',
      done: 'Turned. The rest of the book works the same way.',
    },
    targets: [
      { selector: '.nb-page-curl', pad: 16 },
      { selector: '.nb-spread', pad: 8 },
    ],
    side: 'left',
    scene: 'book',
    short: true,
  },
  {
    id: 'page-style',
    title: 'The paper itself',
    body: 'Page style is the second icon down. It sets what these pages are printed on: ruled, gridded, dotted or blank, how far apart the rules sit, the margin line, and the tint of the paper. It changes this book only, and every page in it at once.',
    hint: 'rail → the ruled page',
    task: {
      ask: 'Open Page style — the second icon down.',
      fact: 'page-style-open',
      done: 'That is the paper, and the rules on it.',
    },
    targets: [
      { selector: '.nb-rail-panel[aria-hidden="false"][aria-label="Page style"]', pad: 6 },
      { selector: '.nb-rail-button[data-tool="page-style"]', pad: 8 },
    ],
    side: 'right',
    scene: 'book',
  },
  {
    id: 'catalogue',
    title: 'Everything you can put on a page',
    body: 'The third icon opens the Catalogue: stickers and stamps, quote cards, callouts, dividers, tables, and the drawn diagrams — trees, graphs and timelines that lay themselves out. Press one and it lands where your caret is. This is the drawer to open when you want a page to be more than paragraphs.',
    hint: 'rail → the stamp',
    task: {
      ask: 'Open the Catalogue — the third icon down.',
      fact: 'catalogue-open',
      done: 'Seven shelves of things to add.',
    },
    targets: [
      { selector: '.nb-rail-panel[aria-hidden="false"][aria-label="Catalogue"]', pad: 6 },
      { selector: '.nb-rail-button[data-tool="catalogue"]', pad: 8 },
    ],
    side: 'right',
    scene: 'book',
  },
  {
    id: 'finding-in-book',
    title: 'Contents, history and ribbons',
    body: 'The next four icons are about getting back to something. Table of contents lists every heading in the book and jumps to it. Page history keeps earlier versions of the page you are on, so a paragraph you deleted this morning is still there. The ribbon marks this page, and the one under it chooses how your ribbons are cut and what charm hangs off them.',
    hint: 'rail → the contents list',
    task: {
      ask: 'Open the table of contents.',
      fact: 'toc-open',
      done: 'Contents, history and ribbons — all four live here.',
    },
    targets: [
      {
        selector: '.nb-rail-panel[aria-hidden="false"][aria-label="Table of contents"]',
        pad: 6,
      },
      {
        selector: '.nb-rail-button[data-tool="toc"]',
        padBox: { left: 8, right: 8, top: 8, bottom: 146 },
      },
    ],
    side: 'right',
    scene: 'book',
  },
  {
    id: 'customize-open',
    title: 'Making a book your own',
    body: 'The brush at the top of the rail opens Customize. It holds this book alone: how it is bound, what the cover is made of and coloured with, the charms on its spine, and the paper its pages are printed on.',
    hint: 'rail → the brush',
    task: {
      ask: 'Open Customize — the brush at the top of the rail.',
      fact: 'customize-open',
      done: 'There it is.',
    },
    targets: [
      { selector: '.nb-rail-button[data-tool="customize"]', pad: 8 },
      { selector: '.nb-rail', pad: 8 },
    ],
    side: 'right',
    scene: 'book',
  },
  {
    id: 'customize-do',
    title: 'Change how this book looks',
    body: 'Binding sets the shape of the cover — wrapper, cloth, boards. Below it, the material and pigment rows decide what it is made of and what colour it takes, and Reroll picks a fresh one for you. Every book carries its own, so no two have to match, and every change lands on the shelf immediately — the book will look different when you put it back.',
    hint: 'pick a binding · then a colour',
    task: {
      ask: 'Pick a binding, a material or a colour.',
      fact: 'book-restyled',
      done: 'The cover changed — and so did the spine on the shelf.',
    },
    targets: [
      {
        selector: '.nb-rail-panel[aria-hidden="false"][aria-label="Customize this book"]',
        pad: 6,
      },
      { selector: '.nb-rail-panel[aria-hidden="false"]', pad: 6 },
      { selector: '.nb-rail-button[data-tool="customize"]', pad: 8 },
    ],
    side: 'right',
    scene: 'book',
  },
  {
    id: 'rail-actions',
    title: 'The tools that act at once',
    body: 'Below the divider nothing opens a panel — each icon does its thing on the spot. Focus mode empties the screen down to the page you are writing on. The filmstrip shows every page of the book along the bottom so you can jump between them. And the last one adds a page to the end of the book.',
    hint: 'F9 is focus mode · the filmstrip is next to it',
    task: {
      ask: 'Turn the thumbnails strip on, or off again.',
      fact: 'thumbs-toggled',
      done: 'Both are toggles — press again to put it back.',
    },
    targets: [
      {
        selector: '.nb-rail-button[data-tool="focus"]',
        padBox: { left: 8, right: 8, top: 8, bottom: 52 },
      },
      { selector: '.nb-rail', pad: 8 },
    ],
    side: 'right',
    scene: 'book',
  },
  {
    id: 'ai-script',
    title: 'Have an assistant write a page',
    body: 'Every page can be read and written as plain text — a small format called Notebook Script, with headings, lists, tables, callouts, and fenced blocks for trees, graphs and timelines. Copy AI spec puts that whole format on your clipboard: paste it to any assistant, say what the page should contain, and it writes the script for you. Insert script turns what comes back into real blocks — diagrams drawn, tables built, nothing left to tidy. Export script does the reverse and hands you the page as text.',
    hint: 'copy the spec → paste it to an assistant → insert what it writes',
    task: {
      ask: 'Press Copy AI spec.',
      fact: 'spec-copied',
      done: 'The format is on your clipboard.',
    },
    targets: [
      {
        selector: '.nb-rail-button[data-tool="spec"]',
        padBox: { left: 8, right: 8, top: 104, bottom: 8 },
      },
      { selector: '.nb-rail', pad: 8 },
    ],
    side: 'right',
    scene: 'book',
  },
  {
    id: 'quick-switch',
    title: 'Finding anything',
    body: 'Ctrl+K opens one bar for the whole library. Type to jump to a book or a heading; press Tab and the same bar searches the text of every page you have written, landing you on the match itself.',
    hint: 'Ctrl+K · then Tab to search the text',
    task: {
      ask: 'Press Ctrl+K.',
      fact: 'quick-switcher',
      done: 'One bar, the whole library.',
    },
    targets: [{ selector: '.nb-qs-bar', pad: 12 }],
    side: 'bottom',
    scene: 'any',
    short: true,
  },
  {
    id: 'settings',
    title: 'Settings, and the whole library',
    // Named the wood stain and the wallpaper until 2026-08-01; both moved to
    // the library studio when they grew into real vocabularies, and settings
    // has not carried either row since. Sending a new reader to the gear to
    // look for them is the one thing a tour must not do.
    body: 'The gear in the corner covers everything that is not one book: how the app looks, how much of it moves, backups, import and export — and this walk again whenever you want it. The sounds are in here too, and they have their own choices: a bed to write under, and a preset for how loud and how busy everything else is. How the bookcase itself is built and painted lives in the studio on the shelf.',
    hint: 'gear → settings',
    task: {
      ask: 'Open Settings.',
      fact: 'settings-open',
      done: 'Everything else lives in here.',
    },
    targets: [
      { selector: '.nbs-sheet', pad: 6 },
      { selector: '.nbs-gear-button', pad: 10 },
    ],
    side: 'left',
    scene: 'any',
    short: true,
  },
  {
    id: 'youre-set',
    title: "You're set",
    // The sign-off is where the openness gets stated plainly rather than
    // implied. What the app opens with is one pick out of thousands of
    // combinations, and a reader who never learns that treats the shipped
    // library as the product instead of as a starting point.
    body: `That is the tour. Almost nothing here is fixed: ${OPENNESS.cases} bookcases to build and ${OPENNESS.papers} papers to hang behind them in the studio, ${OPENNESS.bindings} bindings for any book — or pick its shape, covering and tooling yourself — and the hand, ink and size change per block. What the app opened with is one pick out of all that. Nothing is permanent either — rename things, restyle them, throw a book in the trash and take it back out. If you want this walk again it is in Settings, under replay the tour — the long way round is in there too.`,
    hint: 'gear → replay the tour',
    targets: [{ selector: '.nbs-gear-button', pad: 10 }],
    side: 'right',
    scene: 'any',
    short: true,
  },
];

/** Step ids, in order — handy for tests and the e2e debug surface. */
export const TUTORIAL_STEP_IDS: readonly string[] = TUTORIAL_STEPS.map((s) => s.id);

/**
 * The steps for a chosen length. DERIVED from `short` rather than kept as a
 * second list: two lists is two places to add a step and one place to forget.
 */
export function tourSteps(length: TourLength): readonly TutorialStep[] {
  return length === 'full' ? TUTORIAL_STEPS : TUTORIAL_STEPS.filter((s) => s.short === true);
}

/** Ids of the short tour, in order. */
export const SHORT_TOUR_STEP_IDS: readonly string[] = tourSteps('short').map((s) => s.id);

/** Normalise a step's targets to the long form. */
export function stepTargets(step: TutorialStep): readonly StepTarget[] {
  return (step.targets ?? []).map((t) => (typeof t === 'string' ? { selector: t } : t));
}
