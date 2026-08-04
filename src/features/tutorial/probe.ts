/**
 * src/features/tutorial/probe.ts — did the reader actually do the thing?
 *
 * Every step of the tour asks for one concrete action, and the card only turns
 * green when that action has been observed. This module is the observer.
 *
 * Two rules shaped it:
 *
 *  - It watches the app from the OUTSIDE. Everything here is a DOM event on
 *    `window` (capture phase, passive, never cancelling) or a read of a class
 *    / attribute / element that already exists because some other feature
 *    renders it. The tour owns no hooks inside the editor, the shelf world or
 *    the rail, so none of those files have to know a tutorial exists and none
 *    of them can break it by refactoring their internals — a missing selector
 *    degrades to "not detected yet", never to a crash.
 *
 *  - It only claims what it can see. A fact is `true` because a contextmenu
 *    event fired inside the prose, or because the spread index changed, or
 *    because the cover's own generated art came back different — not because
 *    enough time passed. Steps with nothing observable to ask for (the welcome
 *    and the sign-off) declare no task at all rather than faking a tick.
 *
 * Facts are STICKY between `arm()` calls: the reader is allowed to right-click
 * a block, wander off, and come back to a step that is already satisfied.
 * `arm()` is what resets them, and it runs once per step entry.
 *
 * ONE FACT IS NOT A DOM READ, and it is worth saying why. `taste-chosen` asks
 * `./tasteStore` whether the questionnaire was finished, because the thing that
 * has to be observed — "the library was actually dressed" — leaves no mark on
 * screen that can be told apart from "the reader pressed I'll pick later": both
 * end with the panel gone. The store's own marker is written last, by
 * `tasteApply`, only after the writes land. It is a synchronous signal read, so
 * it is as safe on the rAF loop as a `querySelector`, and it stays inside this
 * feature — the outside-in rule is about not reaching into the editor, the
 * shelf world or the rail, none of which this touches.
 */

import { hasChosenTaste } from './tasteStore';

/** What a step can ask the reader to do. */
export type TourFactKey =
  | 'taste-chosen'
  | 'first-book-made'
  | 'shelf-moved'
  | 'shelf-dock-hovered'
  | 'shelf-studio-open'
  | 'book-pulled'
  | 'book-open'
  | 'rail-hovered'
  | 'typed'
  | 'block-handled'
  | 'page-turned'
  | 'page-style-open'
  | 'catalogue-open'
  | 'toc-open'
  | 'customize-open'
  | 'book-restyled'
  | 'thumbs-toggled'
  | 'spec-copied'
  | 'quick-switcher'
  | 'settings-open';

/** An OPEN rail sheet with this title. Closed sheets stay in the DOM. */
const openPanel = (label: string): string =>
  `.nb-rail-panel[aria-hidden="false"][aria-label="${label}"]`;

/** Selector for the customize sheet — matched on the OPEN one only. */
const CUSTOMIZE_PANEL = openPanel('Customize this book');

/** The shelf's own studio sheet (RailPanel with `is-shelf`). */
const SHELF_STUDIO_PANEL = '.nb-rail-panel.is-shelf[aria-hidden="false"]';

/**
 * A book that has come out of the case and is standing in front of it, waiting
 * for the second press that opens it.
 *
 * `is-held` and not `.pulled-book` alone: the same element carries the book
 * through the flight, and "it is in the air" is not a state the reader can be
 * told to press. `PulledBookOverlay` puts the class on at rest — the same
 * moment it gives the book `role="button"` and puts the corner arrow up.
 */
const HELD_BOOK = '.pulled-book.is-held';

/**
 * Facts that are true because a SURFACE IS ON SCREEN, rather than because a
 * gesture was seen.
 *
 * They tick the instant the thing appears — which is the moment the reader
 * starts looking at it, not the moment they have finished. A step naming one
 * of these must therefore give itself a reading `dwell` (steps.ts), or the
 * tour advances a second later and `./dismiss.ts` shuts the panel it just
 * asked for. `tests/tutorial.test.ts` pins the two lists against each other.
 */
export const SURFACE_FACTS: readonly TourFactKey[] = [
  'shelf-studio-open',
  'page-style-open',
  'catalogue-open',
  'toc-open',
  'customize-open',
  'quick-switcher',
  'settings-open',
];

/** The first-run invite that stands on an empty case. */
const FIRSTRUN_INVITE = '.shelf-firstrun';

/** Controls that put a new book on the shelf. */
const NEW_BOOK_CONTROL =
  '.shelf-firstrun__btn, .shelf-addslot, [data-shelf-dock="new-book"]';

/** Controls inside that sheet which restyle the book rather than navigate it. */
const RESTYLE_CONTROL = '.nb-strip-tile, .nb-swatch, .nb-reroll, .nb-design-tile';

/** How much typing counts as "you have written something". */
const TYPED_ENOUGH = 3;

/** Pointer travel (px) that counts as a deliberate drag rather than a click. */
const DRAG_THRESHOLD = 34;

/** Expensive DOM reads (the cover fingerprint) run at most this often. */
const POLL_MS = 120;

interface Observed {
  /** Shelf: asked for the first book, or the empty-case invite went away. */
  firstBook: boolean;
  /** Shelf: dragged the case, or zoomed it. */
  panned: boolean;
  zoomed: boolean;
  /** Shelf: pointed at (or pressed) one of the four library tools. */
  dockHovered: boolean;
  /** Book view: hovered/opened any tool on the left rail. */
  railHovered: boolean;
  /** Book view: pressed one of the two view toggles under the divider. */
  viewToggled: boolean;
  /** Printable characters typed inside the page editor. */
  typedChars: number;
  /** Right-clicked a block, or picked one up by its handle. */
  blockMenu: boolean;
  blockDragged: boolean;
  /** The spread index moved off the one this step started on. */
  pageTurned: boolean;
  /** A restyle control in the customize sheet was used. */
  restyleClicked: boolean;
  /** The generated cover art changed. */
  coverChanged: boolean;
  /** The "In and out" sheet was opened, or one of its script rows pressed. */
  specCopied: boolean;
  /** The Ctrl+K bar appeared. */
  quickSwitcher: boolean;
  /** The settings sheet appeared. */
  settings: boolean;
}

const blank = (): Observed => ({
  firstBook: false,
  panned: false,
  zoomed: false,
  dockHovered: false,
  railHovered: false,
  viewToggled: false,
  typedChars: 0,
  blockMenu: false,
  blockDragged: false,
  pageTurned: false,
  restyleClicked: false,
  coverChanged: false,
  specCopied: false,
  quickSwitcher: false,
  settings: false,
});

let seen = blank();

/** Baselines captured at `arm()` — "changed" is meaningless without them. */
let spreadAtArm: string | null = null;
let coverAtArm: string | null = null;
/** Was the empty-case invite on screen when this step began? */
let inviteAtArm = false;

/** Live pointer drag, for telling a shelf pan from a click on a spine. */
let dragFrom: { x: number; y: number } | null = null;
let dragOnShelf = false;

let lastPoll = 0;

/* ------------------------------- utilities -------------------------------- */

function el(selector: string): Element | null {
  if (typeof document === 'undefined') return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null; // a selector this file got wrong must not break the tour
  }
}

const present = (selector: string): boolean => el(selector) !== null;

/** Is this element visible enough to count as "on screen"? */
function onScreen(node: Element | null): boolean {
  if (node === null) return false;
  const style = getComputedStyle(node);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (Number.parseFloat(style.opacity || '1') < 0.05) return false;
  const r = node.getBoundingClientRect();
  return r.width > 8 && r.height > 8 && r.right > 0 && r.left < window.innerWidth;
}

function closestMatch(target: EventTarget | null, selector: string): Element | null {
  return target instanceof Element ? target.closest(selector) : null;
}

/**
 * A short, order-sensitive hash of the cover's generated data URL. The string
 * itself is ~26KB of base64 and would be re-compared on every poll; this keeps
 * the read O(1) in practice by sampling 64 evenly spaced characters, which is
 * plenty to notice a re-rolled cloth or a new pigment.
 */
function coverFingerprint(): string | null {
  const cover = el('.nb-book-cover');
  if (cover === null) return null;
  const url = (cover as HTMLElement).style.backgroundImage || '';
  if (url.length < 32) return null;
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(url.length / 64));
  for (let i = 0; i < url.length; i += stride) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${url.length}:${(hash >>> 0).toString(36)}`;
}

/** Spread index currently on screen, as a string (the attribute's own form). */
function spreadIndex(): string | null {
  return el('.nb-spread-stage')?.getAttribute('data-spread-index') ?? null;
}

/* ------------------------------- listeners -------------------------------- */

function onPointerDown(event: PointerEvent): void {
  dragFrom = { x: event.clientX, y: event.clientY };
  dragOnShelf = closestMatch(event.target, '.shelf-stage, .shelf-root') !== null;
  // Grabbing a block by its handle is a drag we care about the moment it
  // starts — the handle is tiny and the drop may land off any element.
  if (closestMatch(event.target, '.nb-drag-handle') !== null) seen.blockDragged = true;
}

function onPointerMove(event: PointerEvent): void {
  if (dragFrom === null || event.buttons === 0) return;
  const travel = Math.hypot(event.clientX - dragFrom.x, event.clientY - dragFrom.y);
  if (travel < DRAG_THRESHOLD) return;
  if (dragOnShelf) seen.panned = true;
}

function onPointerUp(): void {
  dragFrom = null;
  dragOnShelf = false;
}

function onWheel(event: WheelEvent): void {
  if (closestMatch(event.target, '.shelf-stage, .shelf-root') === null) return;
  // Plain wheel zooms, shift+wheel slides — the step teaches both, and either
  // one proves the reader found the gesture.
  if (event.deltaY !== 0 || event.deltaX !== 0) {
    if (event.shiftKey) seen.panned = true;
    else seen.zoomed = true;
  }
}

function onPointerOver(event: PointerEvent): void {
  if (closestMatch(event.target, '.nb-rail-button') !== null) seen.railHovered = true;
  if (closestMatch(event.target, '[data-shelf-dock]') !== null) seen.dockHovered = true;
}

function onKeyDown(event: KeyboardEvent): void {
  // One printable character, typed into the page. Modifier combos are
  // shortcuts, not writing.
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.length !== 1) return;
  if (closestMatch(event.target, '.nb-prose, .ProseMirror') === null) return;
  seen.typedChars += 1;
}

function onInput(event: Event): void {
  // Catches pasting and IME composition, which never raise a printable
  // keydown. Deliberately generous: any input inside the prose counts.
  if (closestMatch(event.target, '.nb-prose, .ProseMirror') === null) return;
  seen.typedChars += TYPED_ENOUGH;
}

function onContextMenu(event: MouseEvent): void {
  if (closestMatch(event.target, '.nb-prose, .ProseMirror') !== null) seen.blockMenu = true;
}

function onDragStart(event: DragEvent): void {
  if (closestMatch(event.target, '.nb-drag-handle, .nb-prose, .ProseMirror') !== null) {
    seen.blockDragged = true;
  }
}

function onClick(event: MouseEvent): void {
  const tool = closestMatch(event.target, '.nb-rail-button');
  if (tool !== null) {
    seen.railHovered = true; // a click implies the reader found the rail
    const id = tool.getAttribute('data-tool');
    /*
     * `spec` and `insert` were rail buttons of their own; both are rows on the
     * "In and out" sheet now, so opening that sheet is what the step asks for.
     * (Checked below as well, for the reader who goes on and presses one.)
     */
    if (id === 'share') seen.specCopied = true;
    // Either view toggle counts: the step teaches both, and the filmstrip is
    // the one it asks for only because focus mode takes the rail away.
    if (id === 'thumbs' || id === 'focus') seen.viewToggled = true;
  }
  // The three script rows inside that sheet — the format, the paste box, and
  // the page back out — are the act the step is really about.
  const share = closestMatch(event.target, '.nb-share-row');
  if (share !== null) {
    const what = share.getAttribute('data-share');
    if (what === 'spec' || what === 'insert' || what === 'script') {
      seen.specCopied = true;
    }
  }
  if (closestMatch(event.target, '[data-shelf-dock]') !== null) seen.dockHovered = true;
  // The invite, the ghost slot and the dock's own button all make a book. The
  // fact is confirmed by the invite going away (see `poll`); this is what
  // makes it land the instant the reader presses, rather than a frame later.
  if (closestMatch(event.target, NEW_BOOK_CONTROL) !== null) seen.firstBook = true;
  if (closestMatch(event.target, '.shelf-zoom-pill') !== null) seen.zoomed = true;
  if (
    closestMatch(event.target, RESTYLE_CONTROL) !== null &&
    closestMatch(event.target, '.nb-rail-panel') !== null
  ) {
    seen.restyleClicked = true;
  }
}

/**
 * Install the whole listener set. Everything is passive and capture-phase, so
 * the tour observes gestures without ever changing what they do.
 */
export function attachProbe(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const pairs: Array<[string, EventListener]> = [
    ['pointerdown', onPointerDown as EventListener],
    ['pointermove', onPointerMove as EventListener],
    ['pointerup', onPointerUp as EventListener],
    ['pointercancel', onPointerUp as EventListener],
    ['wheel', onWheel as EventListener],
    ['pointerover', onPointerOver as EventListener],
    ['keydown', onKeyDown as EventListener],
    ['input', onInput as EventListener],
    ['contextmenu', onContextMenu as EventListener],
    ['dragstart', onDragStart as EventListener],
    ['click', onClick as EventListener],
  ];
  for (const [type, handler] of pairs) window.addEventListener(type, handler, opts);
  return () => {
    for (const [type, handler] of pairs) {
      window.removeEventListener(type, handler, { capture: true });
    }
  };
}

/**
 * A step just became current: forget what happened during the last one and
 * capture the baselines the "did it change?" facts are measured against.
 */
export function armProbe(): void {
  seen = blank();
  dragFrom = null;
  dragOnShelf = false;
  spreadAtArm = spreadIndex();
  coverAtArm = coverFingerprint();
  inviteAtArm = present(FIRSTRUN_INVITE);
  lastPoll = 0;
}

/**
 * Facts that can only be read (not listened for). Called from the overlay's
 * existing rAF loop, throttled to POLL_MS because two of these reads touch
 * layout and one hashes a data URL.
 */
function poll(now: number): void {
  // Inert without a DOM rather than a throw — the same contract ./dismiss.ts
  // keeps, and what lets a node test ask `factHolds` a question directly.
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (now - lastPoll < POLL_MS) return;
  lastPoll = now;

  if (!seen.pageTurned) {
    const index = spreadIndex();
    // Null-to-value is the book mounting, not a page turn.
    if (index !== null && spreadAtArm !== null && index !== spreadAtArm) {
      seen.pageTurned = true;
    }
    if (spreadAtArm === null) spreadAtArm = index;
  }
  // The empty-case invite is rendered only while the library IS empty, so it
  // going away is the library gaining its first book. Requires the baseline:
  // "absent now" on a shelf that never had one proves nothing.
  if (!seen.firstBook && inviteAtArm && !present(FIRSTRUN_INVITE)) seen.firstBook = true;
  // Naming the new spine happens between the press and the book landing.
  if (!seen.firstBook && present('.shelf-spine-name')) seen.firstBook = true;
  if (!seen.blockMenu && present('.nb-ctx-menu')) seen.blockMenu = true;
  if (!seen.blockDragged && document.documentElement.dataset.nbBlockDrag === 'true') {
    seen.blockDragged = true;
  }
  if (!seen.quickSwitcher && present('.nb-qs-bar')) seen.quickSwitcher = true;
  if (!seen.settings && onScreen(el('.nbs-sheet'))) seen.settings = true;
  if (!seen.coverChanged) {
    const print = coverFingerprint();
    if (print !== null && coverAtArm !== null && print !== coverAtArm) {
      seen.coverChanged = true;
    }
    if (coverAtArm === null) coverAtArm = print;
  }
}

/** True when the app is showing an opened book rather than the shelf. */
export function inBookView(): boolean {
  return present('.nb-rail');
}

/**
 * Is this element on screen? Exported for ./dismiss.ts, which has the same
 * question about the settings sheet (always mounted, `visibility: hidden`
 * while closed) and must not "close" something that is not open.
 */
export function isVisible(node: Element | null): boolean {
  return onScreen(node);
}

/**
 * Has this fact been observed? `now` is the rAF timestamp — passing it in
 * keeps the throttle honest without this module owning a clock.
 */
export function factHolds(fact: TourFactKey, now: number): boolean {
  poll(now);
  switch (fact) {
    // True only after "dress my library" wrote. Leaving by "I'll pick later"
    // deliberately does not set it, so that step stays outstanding — and, like
    // every other task, walkable past with next.
    case 'taste-chosen':
      return hasChosenTaste();
    case 'first-book-made':
      return seen.firstBook;
    case 'shelf-moved':
      return seen.panned || seen.zoomed;
    case 'shelf-dock-hovered':
      return seen.dockHovered;
    case 'shelf-studio-open':
      return present(SHELF_STUDIO_PANEL);
    // Out of the case but not open yet — the half-way state the reader lands
    // in after one click, and the one the tour has to name out loud.
    case 'book-pulled':
      return present(HELD_BOOK);
    case 'book-open':
      return inBookView();
    case 'rail-hovered':
      return seen.railHovered;
    case 'typed':
      return seen.typedChars >= TYPED_ENOUGH;
    case 'block-handled':
      return seen.blockMenu || seen.blockDragged;
    case 'page-turned':
      return seen.pageTurned;
    case 'page-style-open':
      return present(openPanel('Page style'));
    case 'catalogue-open':
      return present(openPanel('Catalogue'));
    // One step covers the four "get me back to something" tools, so any of
    // the three sheets among them satisfies it.
    case 'toc-open':
      return (
        present(openPanel('Table of contents')) ||
        present(openPanel('Turn back time')) ||
        present(openPanel('Ribbons'))
      );
    case 'customize-open':
      return present(CUSTOMIZE_PANEL);
    case 'book-restyled':
      return seen.coverChanged || seen.restyleClicked;
    case 'thumbs-toggled':
      return seen.viewToggled;
    case 'spec-copied':
      return seen.specCopied;
    case 'quick-switcher':
      return seen.quickSwitcher;
    case 'settings-open':
      return seen.settings;
    default:
      return false;
  }
}
