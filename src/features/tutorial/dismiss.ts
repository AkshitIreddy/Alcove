/**
 * src/features/tutorial/dismiss.ts — put away what the last step opened.
 *
 * THE REPORTED BUG, twice: the tour asked the reader to open Customize, they
 * did, and the next step went on to talk about something else with the sheet
 * still covering half the screen. Same thing from the quick switcher into
 * Settings. Two reports, and the temptation is two fixes — "after the
 * customize step, close customize" — which is a rule that has to be
 * remembered every time a step is added, and was not remembered twice already.
 *
 * So the rule is general and lives here: **on entering a step, every panel,
 * sheet and menu that is open gets closed, unless the step being entered
 * points inside it.** A step says what it is about in exactly one place — its
 * target list (steps.ts) — and that is the same list the spotlight uses, so
 * the two can never disagree.
 *
 * A general rule is only as general as `DISMISSIBLE`, which is the third
 * report: the taste questionnaire — the one surface a tour STEP opens rather
 * than the reader — was not on the list, outlived its step, and covered both
 * the tour's own buttons and the shelf the next step was asking about. If a
 * step can leave it standing, it belongs below.
 *
 * HOW IT CLOSES: by the surface's own way out — the × in its header, the same
 * button the reader would press — or by Escape where a surface has no button.
 * Nothing here reaches into another feature's state; the tour still watches
 * and drives the app from the OUTSIDE (see ./probe.ts).
 *
 * Escape is dispatched with `isDismissing()` held true, because the tour's own
 * keyboard handler treats Escape as "leave the tour": without the flag, tidying
 * a context menu away would close the tour that asked for it.
 */

import { isVisible } from './probe';

/** A surface the tour can put away, and how. */
export interface Dismissible {
  readonly id: string;
  /** Matches every instance that is currently open. */
  readonly open: string;
  /** A control that closes it, or the Escape key. */
  readonly close: string | 'escape';
  /** Most close controls are inside; toggles such as filmstrip live elsewhere. */
  readonly closeFrom?: 'surface' | 'document';
}

/**
 * Everything a tour step can leave standing. Order is arbitrary — each entry
 * is independent — but the rail panels come first because they are the ones a
 * step actually asks for.
 */
export const DISMISSIBLE: readonly Dismissible[] = [
  // Every sheet the rail opens: customize, page style, catalogue, contents,
  // history, ribbons — and the shelf's studio, which is the same component
  // with `is-shelf` on it. Closed sheets keep `aria-hidden="true"`.
  {
    id: 'rail-panel',
    open: '.nb-rail-panel[aria-hidden="false"]',
    close: '.nb-rail-panel-close',
  },
  // THE TASTE QUESTIONNAIRE, and the reason this list needs the one surface a
  // tour STEP puts up rather than the reader.
  //
  // The reported bug: answer one question, press next, and the tour walks on to
  // shelf-dock with all five questions still standing. Its card covered the
  // tour's own next and skip, so there was no way forward, and `.nbq-scrim`
  // takes pointer events — so the drag the following steps ask for never
  // reached the shelf at all and the first-book nudge could never fire either.
  // Two reported defects, one surface nobody had put on this list.
  //
  // "I'll pick later" is the panel's own way out and the one that keeps the
  // answers, so reopening it later is a revision rather than a fresh
  // interrogation. The panel ALSO stands itself down when the tour's step
  // attribute moves off `taste` (see ./tourStep.ts) — this entry is what
  // catches it on the frame the step changes, before the reader can press
  // anything into a scrim.
  { id: 'taste', open: '.nbq-layer', close: '.nbq-exit--quiet' },
  // The filmstrip has no close button of its own: the rail toggle that opened
  // it is also its way out. Once the tour leaves the step that teaches the
  // toggle, put the strip away before it covers the next lesson.
  {
    id: 'thumb-strip',
    open: '.nb-thumb-strip',
    close: '.nb-rail-button[data-tool="thumbs"]',
    closeFrom: 'document',
  },
  { id: 'trash', open: '.shelf-trash', close: '.shelf-trash__close' },
  { id: 'settings', open: '.nbs-sheet', close: '.nbs-close' },
  { id: 'quick-switcher', open: '.nb-qs-bar', close: '.nb-qs-close' },
  // The block context menu has no × — it is dismissed by Escape or by
  // clicking away, and Escape is the one that cannot land on something else.
  { id: 'context-menu', open: '.nb-ctx-menu', close: 'escape' },
];

let dismissing = false;

/**
 * True only while this module is synthesising a key press. The overlay's
 * keydown handler checks it so a tidy-up Escape cannot be read as "the reader
 * pressed Escape, close the tour".
 */
export function isDismissing(): boolean {
  return dismissing;
}

function queryAll(selector: string): Element[] {
  if (typeof document === 'undefined') return [];
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch {
    return []; // a selector some other feature renamed must not break the tour
  }
}

/** Press Escape at the app, with the tour's own handler standing down. */
function pressEscape(): void {
  dismissing = true;
  try {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  } catch {
    /* a browser without KeyboardEvent constructors is not one we ship to */
  } finally {
    dismissing = false;
  }
}

function closeOne(
  surface: Element,
  how: string | 'escape',
  closeFrom: 'surface' | 'document' = 'surface',
): boolean {
  if (how === 'escape') {
    pressEscape();
    return true;
  }
  const button =
    closeFrom === 'document'
      ? document.querySelector<HTMLElement>(how)
      : surface.querySelector<HTMLElement>(how);
  if (button === null) return false;
  button.click();
  return true;
}

/**
 * Ids of every surface currently on screen. The QA bridge reports it so a
 * probe can assert "the previous step's panel is gone" against what the app is
 * actually showing, rather than against what the tour believes it closed.
 */
export function openSurfaceIds(): readonly string[] {
  const ids: string[] = [];
  for (const kind of DISMISSIBLE) {
    if (queryAll(kind.open).some(isVisible)) ids.push(kind.id);
  }
  return ids;
}

/**
 * Close every open surface the incoming step is not about.
 *
 * `keepSelectors` is the step's own target list. A surface survives when one
 * of those selectors resolves to it, or to anything inside it — which is how
 * "the step points at the open customize sheet" and "the step points at a
 * rail button that happens to sit beside it" tell themselves apart.
 *
 * Returns the ids it closed, for the QA bridge and the tests.
 */
export function dismissStale(keepSelectors: readonly string[]): readonly string[] {
  if (typeof document === 'undefined') return [];
  const wanted = keepSelectors.flatMap(queryAll);
  const closed: string[] = [];
  for (const kind of DISMISSIBLE) {
    for (const surface of queryAll(kind.open)) {
      if (!isVisible(surface)) continue;
      if (wanted.some((el) => el === surface || surface.contains(el))) continue;
      if (closeOne(surface, kind.close, kind.closeFrom)) closed.push(kind.id);
    }
  }
  return closed;
}
