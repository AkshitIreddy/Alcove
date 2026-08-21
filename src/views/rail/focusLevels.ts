/**
 * src/views/rail/focusLevels.ts — focus mode as a RANGE, not a switch.
 *
 * The reader's words:
 *
 *   "focus mode should allow user to basically zoom in and also even just get
 *    into full page mode where the book isnt even visible and it just page and
 *    even go as far just making one page visible, so basically it should be
 *    controllable by user"
 *
 * So focus mode is a ladder the reader steps up and down, plus a zoom they set
 * themselves. Each rung takes one more layer of the world away:
 *
 *   off      the desk as it is — rail, title plate, thumbnails, the room
 *   spread   the chrome goes; the book sits alone on a dimmed desk
 *   page     the BOOK goes; two bare leaves, no board, no cover art
 *   leaf     one leaf, the other folded away — a single page, edge to edge
 *
 * The rungs are pure data so `BookView` (which applies them), `FocusRail`
 * (which offers them) and `tests/focus-range.test.ts` (which pins the ladder)
 * all read one table. Nothing here touches the DOM.
 *
 * ## Why the zoom is a transform and not a bigger box
 *
 * Zooming by growing the leaf's layout box would change `pageCapacityPx`, and
 * `pageCapacityPx` is what the pagination contract measures against — so
 * zooming OUT would shrink every page's capacity and repaginate the reader's
 * whole book behind their back. A transform leaves the box alone: the page
 * holds exactly as many words at 220% as it does at 70%, and the only thing
 * that changes is how big it looks. Panning exists for the same reason — at
 * 220% the leaf is bigger than the window, and something has to let the reader
 * reach the bottom of it.
 */

export const FOCUS_LEVELS = ['off', 'spread', 'page', 'leaf'] as const;

export type FocusLevel = (typeof FOCUS_LEVELS)[number];

export interface FocusLevelSpec {
  readonly id: FocusLevel;
  /** The word on the dial. */
  readonly name: string;
  /** One line under it, in the app's voice. */
  readonly blurb: string;
}

/**
 * The three rungs the dial offers. `off` is not on the dial — the dial only
 * exists once you are in focus mode, and the way out is the exit chip.
 */
export const FOCUS_RUNGS: readonly FocusLevelSpec[] = [
  {
    id: 'spread',
    name: 'the book',
    blurb: 'the desk goes quiet — the book stays',
  },
  {
    id: 'page',
    name: 'the pages',
    blurb: 'the boards come off; two bare leaves',
  },
  {
    id: 'leaf',
    name: 'one page',
    blurb: 'a single leaf, edge to edge',
  },
];

/** Rank on the ladder — `off` is 0, and each rung takes one more layer away. */
export function focusRank(level: FocusLevel): number {
  const at = FOCUS_LEVELS.indexOf(level);
  return at < 0 ? 0 : at;
}

/** Is this a focus level at all (an unknown string reads as `off`)? */
export function isFocusLevel(value: unknown): value is FocusLevel {
  return (
    typeof value === 'string' && (FOCUS_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * One step along the ladder, clamped at both ends.
 *
 * Stepping DOWN from `spread` stops at `spread` rather than falling out of
 * focus mode: leaving is the exit chip's job and Escape's, and a reader
 * tapping `[` to see a little more of the book should never be thrown all the
 * way back to the desk by one keystroke too many.
 */
export function stepFocusLevel(level: FocusLevel, direction: 1 | -1): FocusLevel {
  if (level === 'off') return direction > 0 ? 'spread' : 'off';
  const next = focusRank(level) + direction;
  const floor = focusRank('spread');
  const ceiling = FOCUS_LEVELS.length - 1;
  return FOCUS_LEVELS[Math.min(ceiling, Math.max(floor, next))] as FocusLevel;
}

/* ========================================================================== *
 *                                  the zoom                                  *
 * ========================================================================== */

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;
export const ZOOM_STEP = 0.1;
export const ZOOM_REST = 1;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_REST;
  // Rounded to the step so "100%" is reachable by tapping, and so the label
  // never reads 99.99999%.
  const snapped = Math.round(value / (ZOOM_STEP / 2)) * (ZOOM_STEP / 2);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(snapped * 100) / 100));
}

export function stepZoom(value: number, direction: 1 | -1): number {
  return clampZoom(clampZoom(value) + direction * ZOOM_STEP);
}

/** "140%" — the only place the number is turned into words. */
export function zoomLabel(value: number): string {
  return `${Math.round(clampZoom(value) * 100)}%`;
}

/**
 * How far the reader may drag the zoomed book around, as a fraction of the
 * window. Zero at rest: at 100% the book already fits, so panning it would only
 * ever be a way to lose it off the edge of the screen.
 */
export function panRange(zoom: number, extent: number): number {
  const over = clampZoom(zoom) - 1;
  return over <= 0 ? 0 : (over * extent) / 2;
}

/**
 * Whole pixels, and never `-0`.
 *
 * `Math.round(-0.4)` is `-0`, which prints into a custom property as `-0px`.
 * Harmless to the browser and confusing to everything else that reads the
 * value back — including the probe that asserts the book is centred.
 */
const whole = (value: number): number => Math.round(value) || 0;

/** Keep a pan offset inside {@link panRange} (both axes, one call). */
export function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  size: { width: number; height: number },
): { x: number; y: number } {
  const rx = panRange(zoom, size.width);
  const ry = panRange(zoom, size.height);
  return {
    x: whole(Math.min(rx, Math.max(-rx, pan.x))),
    y: whole(Math.min(ry, Math.max(-ry, pan.y))),
  };
}

/**
 * Focus is an infinite desk, not a bounded image crop. This helper is kept
 * separate from the legacy zoom clamp above so wheel and pointer paths share
 * the exact same whole-pixel, unbounded camera math.
 */
export function moveFocusPan(
  pan: { x: number; y: number },
  delta: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: whole(pan.x + delta.x),
    y: whole(pan.y + delta.y),
  };
}
