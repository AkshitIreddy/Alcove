/**
 * src/features/tutorial/steps.ts — the guided tour script.
 *
 * Each step names CSS selectors it would *like* to point at (first visible
 * one wins). Nothing here assumes a target exists: a step whose target is
 * absent falls back to a centred, anchorless card so the tour still teaches
 * the idea instead of stalling. Steps that are meaningless without their
 * target can opt into `skipIfMissing` and the engine walks straight past them.
 *
 * Selectors are owned by other features; they are treated as hints, never
 * contracts. Adding a new one is safe — if it never matches, nothing breaks.
 */

import type { Inset, Side } from './engine';

/** Which top-level scene a step is really about. */
export type StepScene = 'shelf' | 'book' | 'any';

export interface TutorialStep {
  readonly id: string;
  /** Handwritten heading on the speech card. */
  readonly title: string;
  /** One or two sentences of body copy. */
  readonly body: string;
  /** Optional keycap/gesture line under the body. */
  readonly hint?: string;
  /** Candidate CSS selectors, most specific first. */
  readonly targets?: readonly string[];
  /** Spotlight only a patch of the matched element (fractions of its box). */
  readonly inset?: Inset | number;
  /** Extra padding around the spotlight hole, px. */
  readonly pad?: number;
  /** Preferred card side relative to the target. */
  readonly side?: Side;
  /** Scene this step describes — drives the "over in the …" ribbon. */
  readonly scene?: StepScene;
  /** Step over this entirely when the target is missing. */
  readonly skipIfMissing?: boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to your library',
    body: 'This is a bookshelf you can actually live in. Two minutes and you will know every corner of it.',
    hint: 'Enter to go on · Esc to slip away',
    scene: 'any',
  },
  {
    id: 'endless-shelf',
    title: 'The shelf never ends',
    body: 'Drag anywhere to pan the case. Spin the wheel to zoom in and out — new floors keep appearing below as you fill them.',
    hint: 'drag to pan · wheel to zoom · shift+wheel to slide',
    // A tall strip down the middle of the case: the spotlight itself shows
    // floors continuing past the bottom edge.
    targets: ['.shelf-root'],
    inset: { top: 0.14, bottom: 0.14, left: 0.34, right: 0.44 },
    side: 'right',
    scene: 'shelf',
  },
  {
    id: 'pull-a-book',
    title: 'Pull a book out',
    body: 'Grab a spine and drag it off the shelf — it tips out into your hands and opens. A plain click does the same, just faster.',
    hint: 'drag a spine · or click it',
    // Book-shaped patch over the top floor of the (centred) case, where the
    // seeded Welcome book stands.
    targets: ['.shelf-root'],
    inset: { top: 0.1, bottom: 0.66, left: 0.42, right: 0.42 },
    pad: 6,
    side: 'right',
    scene: 'shelf',
  },
  {
    id: 'left-rail',
    title: 'Everything lives on the left',
    body: 'No toolbars stealing your page. Book tools, page style, stickers, contents and history all hang on this rail — hover one for its label.',
    hint: 'hover an icon for its name',
    targets: ['.nb-rail'],
    pad: 8,
    side: 'right',
    scene: 'book',
  },
  {
    id: 'writing',
    title: 'Just start writing',
    body: 'Click any ruled line and type. A "/" opens the slash menu — headings, lists, quotes, tasks, tables, diagrams, all without leaving the keyboard.',
    hint: 'type / for the menu',
    targets: ['.nb-spread', '.nb-sheet-paper'],
    inset: { top: 0.12, bottom: 0.42, left: 0.08, right: 0.55 },
    side: 'right',
    scene: 'book',
  },
  {
    id: 'block-menu',
    title: 'Right-click any block',
    body: 'Turn it into something else, duplicate it, tint it, drag it by the handle, or send it to another page — the whole block menu is one click away.',
    hint: 'right-click · or grab the ⠿ handle',
    targets: ['.nb-spread', '.nb-sheet-paper'],
    inset: { top: 0.3, bottom: 0.34, left: 0.1, right: 0.5 },
    side: 'right',
    scene: 'book',
  },
  {
    id: 'page-turning',
    title: 'Pages turn like paper',
    body: 'Drag the corner, or use the arrows, and the sheet curls over. Write past the bottom and the overflow flows onto the next page by itself — no scrollbars, ever.',
    hint: '← → to turn · drag the corner',
    targets: ['.nb-page-curl', '.nb-spread-gutter', '.nb-spread'],
    pad: 10,
    side: 'left',
    scene: 'book',
  },
  {
    id: 'make-it-yours',
    title: 'Make it yours',
    body: 'Customize gives each book its own spine, cover and charms. The gear does the whole library: theme, wood stain, wallpaper, sound and motion.',
    hint: 'rail → customize · gear → settings',
    targets: ['.nb-rail-button[data-tool="customize"]', '.nbs-gear-button', '.nb-rail'],
    pad: 8,
    side: 'right',
    scene: 'any',
  },
  {
    id: 'ai-script',
    title: 'Let an AI fill a page',
    body: 'Copy AI spec puts the Notebook Script cheat-sheet on your clipboard. Hand it to any assistant, then paste what it writes back with Insert script — headings, trees, timelines and all.',
    hint: 'copy the spec → paste the result',
    targets: [
      '.nb-rail-button[data-tool="spec"]',
      '.nb-rail-button[data-tool="insert"]',
      '.nb-rail',
    ],
    pad: 8,
    side: 'right',
    scene: 'book',
  },
  {
    id: 'quick-switcher',
    title: 'Ctrl+K finds anything',
    body: 'One bar for the whole library: jump to a book or heading, or type ">" to search every word you have written and land right on the match.',
    hint: 'Ctrl+K · then Tab to search text',
    scene: 'any',
  },
  {
    id: 'youre-set',
    title: "You're all set",
    body: 'Go make a mess of it. If you ever want this walk again, it is waiting under the gear — Settings, right at the bottom.',
    hint: 'gear → replay the tour',
    targets: ['.nbs-gear-button'],
    pad: 10,
    side: 'left',
    scene: 'any',
  },
];

/** Step ids, in order — handy for tests and the e2e debug surface. */
export const TUTORIAL_STEP_IDS: readonly string[] = TUTORIAL_STEPS.map((s) => s.id);
