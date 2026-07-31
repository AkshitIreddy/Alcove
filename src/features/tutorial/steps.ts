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
 * TARGETS: candidate selectors, most specific first, each able to carry its
 * own padding — a step often points at a different element depending on what
 * is on screen (the gear before Settings opens, the sheet afterwards). Nothing
 * here assumes a target exists: an unmatched step renders as a centred,
 * anchorless card so the lesson still lands. Selectors are owned by other
 * features and treated as hints, never contracts.
 */

import type { Inset, PadBox, Side } from './engine';
import type { TourFactKey } from './probe';

/** Which top-level scene a step is really about. */
export type StepScene = 'shelf' | 'book' | 'any';

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

/** What the reader has to do before the step counts as finished. */
export interface StepTask {
  /** Imperative line, shown while the step is unfinished. */
  readonly ask: string;
  /** The observed fact that means "done". */
  readonly fact: TourFactKey;
  /** Line shown, in green, once it lands. */
  readonly done: string;
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
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Bellanote',
    body: 'Your books stand on a shelf. Open one and you get pages you can write on, and everything you write is saved as you go. Each step below asks you to try one thing — the card turns green once you have.',
    hint: 'Enter to go on · Esc to leave',
    scene: 'any',
  },
  {
    id: 'shelf-moves',
    title: 'Moving around the shelf',
    body: 'Drag the shelf to move it. Roll the wheel to zoom in and out, and hold Shift while you roll to slide sideways instead. New floors appear below as you fill the ones above, so the case grows with the library.',
    hint: 'drag to move · wheel to zoom · shift+wheel to slide',
    task: {
      ask: 'Drag the shelf, or zoom it with the wheel.',
      fact: 'shelf-moved',
      done: 'The shelf goes wherever you take it.',
    },
    targets: [
      { selector: '.shelf-root', inset: { top: 0.05, bottom: 0.11, left: 0.16, right: 0.16 } },
    ],
    side: 'right',
    scene: 'shelf',
  },
  {
    id: 'open-a-book',
    title: 'Opening a book',
    body: 'Click a spine and the book tips out of the case and comes to rest in front of it, held. Now click the cover — or read it — to open it, or put it back if you picked the wrong one. You can also drag a book out by hand, and drag it back onto the case to shelve it again.',
    hint: 'click a spine · then read it',
    task: {
      ask: 'Take the book off the shelf and open it.',
      fact: 'book-open',
      done: 'The book is open.',
    },
    // Three scenes, one step: the books standing on the shelf, the book held
    // in front of the case (the bottom padding reaches down over its two
    // verbs, which are a sibling element rather than part of the cover), and
    // — the moment it lands — the whole opened book. That last one is why the
    // highlight no longer ends up smaller than the thing it is framing.
    targets: [
      { selector: '.nb-book-cover', pad: 8 },
      { selector: '.pulled-book', padBox: { top: 12, left: 12, right: 12, bottom: 150 } },
      {
        selector: '.shelf-addslot',
        padBox: { left: 176, right: 18, top: 20, bottom: 20 },
      },
      { selector: '.shelf-root', inset: { top: 0.05, bottom: 0.62, left: 0.28, right: 0.28 } },
    ],
    side: 'right',
    scene: 'shelf',
  },
  {
    id: 'the-rail',
    title: 'The tools live on the left',
    body: 'Nothing sits across the top of a page. Every tool for this book is an icon on the left edge — point at one and its name appears beside it. The upper group opens panels; the lower group acts straight away.',
    hint: 'point at an icon for its name',
    task: {
      ask: 'Point at any icon on the rail.',
      fact: 'rail-hovered',
      done: 'That is every book tool there is.',
    },
    targets: [{ selector: '.nb-rail', pad: 8 }],
    side: 'right',
    scene: 'book',
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
  },
  {
    id: 'blocks',
    title: 'Every block can move',
    body: 'A paragraph, a heading, a list — each one is a block you can pick up. Right-click a block for its menu: change what kind of block it is, duplicate it, tint it, or send it to another page. The six dots in the left margin are its handle; drag them to move the block somewhere else.',
    hint: 'right-click the block · then drag the ⠿ handle',
    task: {
      ask: 'Right-click this block, then drag it by the handle.',
      fact: 'block-handled',
      done: 'That is the block menu.',
    },
    // `.nb-prose` IS the ProseMirror root (PageEditor sets it as the editor's
    // own class), so its children are the blocks. The left padding reaches
    // across the 40px handle gutter: the six dots sit in the page margin,
    // outside the block's own box, and a highlight that stops at the text
    // frames a block whose handle is in the dark.
    targets: [
      { selector: '.nb-prose > p', padBox: { left: 48, right: 16, top: 10, bottom: 10 } },
      { selector: '.nb-prose > *', padBox: { left: 48, right: 16, top: 10, bottom: 10 } },
      { selector: '.nb-prose', pad: 10 },
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
    body: 'Binding sets the shape of the cover — wrapper, cloth, boards. Below it, the material and pigment rows decide what it is made of and what colour it takes, and Reroll picks a fresh one for you. Every change lands on the shelf immediately, so the book will look different when you put it back.',
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
  },
  {
    id: 'settings',
    title: 'Settings, and the whole library',
    // Named the wood stain and the wallpaper until 2026-08-01; both moved to
    // the library studio when they grew into real vocabularies, and settings
    // has not carried either row since. Sending a new reader to the gear to
    // look for them is the one thing a tour must not do.
    body: 'The gear in the corner covers everything that is not one book: how the app looks, the sounds the shelf makes, how much of it moves, backups, import and export — and this walk again whenever you want it. How the bookcase itself is built and painted lives in the studio on the shelf.',
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
  },
  {
    id: 'youre-set',
    title: "You're set",
    body: 'That is the tour. Nothing you do here is permanent — rename things, restyle them, throw a book in the trash and take it back out. If you want this walk again it is in Settings, under replay the tour.',
    hint: 'gear → replay the tour',
    targets: [{ selector: '.nbs-gear-button', pad: 10 }],
    side: 'right',
    scene: 'any',
  },
];

/** Step ids, in order — handy for tests and the e2e debug surface. */
export const TUTORIAL_STEP_IDS: readonly string[] = TUTORIAL_STEPS.map((s) => s.id);

/** Normalise a step's targets to the long form. */
export function stepTargets(step: TutorialStep): readonly StepTarget[] {
  return (step.targets ?? []).map((t) => (typeof t === 'string' ? { selector: t } : t));
}
