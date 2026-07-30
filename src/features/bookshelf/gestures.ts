/**
 * features/bookshelf/gestures.ts — the input decision matrix (pure logic).
 *
 * Every "what does this wheel/drag/key mean?" question is answered here so it
 * can be regression-tested in node without Pixi or DOM:
 *
 *   wheel:  plain wheel      → zoom to cursor (primary expectation), or pan
 *                              the floors when settings.wheelMode = 'scroll'
 *           ctrl/meta wheel  → zoom (mouse ctrl+scroll AND touchpad pinch —
 *                              Chromium/WebView2 reports pinches as ctrlKey
 *                              wheels with small fractional deltas)
 *           shift + wheel    → the other one (vertical pan in 'zoom' mode,
 *                              zoom in 'scroll' mode) — shift always flips
 *           sideways deltas  → horizontal pan (touchpad two-finger sideways)
 *   drag:   started on spine + pulled toward the viewer (down) or sideways
 *                            → pull the book out
 *           started on spine + pushed firmly upward → pan (scrolling the case)
 *           started on wall/shelf → pan, always
 *   keys:   + / = zoom in, - / _ zoom out, 0 reset — unless typing in a field
 */

/** Drag threshold before a gesture on the shelf/wall becomes a pan. */
export const SHELF_DRAG_DIST_PX = 5;

/** Drag threshold before a gesture on a spine becomes a pull. */
export const BOOK_DRAG_DIST_PX = 8;

/** Dragged travel (screen px) after which the pull-out completes on its own. */
export const PULL_COMPLETE_TRAVEL_PX = 120;

/** Plain-wheel / ctrl+wheel (mouse notch) zoom sensitivity, log-zoom per deltaY. */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/**
 * Touchpad-pinch sensitivity. Chromium reports pinches as ctrlKey wheel
 * events with small deltas (usually well under one mouse notch of 120), so a
 * pinch at mouse sensitivity feels glacial.
 */
export const PINCH_ZOOM_SENSITIVITY = 0.008;

/** |deltaY| below this on a ctrlKey wheel is treated as a touchpad pinch. */
export const PINCH_DELTA_MAX = 40;

/** Log-zoom step for the +/- keys and the zoom pill buttons. */
export const KEY_ZOOM_STEP = 0.22;

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type WheelAction =
  | { kind: 'zoom'; deltaY: number; sensitivity: number }
  | { kind: 'pan'; dx: number; dy: number };

/** What a plain (unmodified) wheel spin does — settings.wheelMode. */
export type WheelMode = 'zoom' | 'scroll';

/**
 * Route one wheel event. The caller must ALWAYS preventDefault (the listener
 * is registered non-passive) so ctrl+wheel never page-zooms the webview.
 *
 * `mode` is settings.wheelMode: 'zoom' (default) makes a plain spin zoom to
 * the cursor and shift+spin pan the floors; 'scroll' swaps those two, for
 * people whose muscle memory says "the wheel scrolls". ctrl/meta always
 * zooms in both modes, and sideways touchpad deltas always pan sideways.
 */
export function classifyWheel(e: WheelLike, mode: WheelMode = 'zoom'): WheelAction {
  if (e.ctrlKey || e.metaKey) {
    const pinch = Math.abs(e.deltaY) < PINCH_DELTA_MAX;
    return {
      kind: 'zoom',
      deltaY: e.deltaY,
      sensitivity: pinch ? PINCH_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY,
    };
  }
  // Shift flips whatever the plain spin does.
  if (e.shiftKey) {
    if (mode === 'scroll') {
      return { kind: 'zoom', deltaY: e.deltaY, sensitivity: WHEEL_ZOOM_SENSITIVITY };
    }
    // Vertical pan. Some browsers pre-swap shift+wheel into deltaX.
    const dy = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    return { kind: 'pan', dx: 0, dy };
  }
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    // Touchpad sideways scroll pans horizontally (both modes).
    return { kind: 'pan', dx: e.deltaX, dy: 0 };
  }
  if (mode === 'scroll') return { kind: 'pan', dx: 0, dy: e.deltaY };
  return { kind: 'zoom', deltaY: e.deltaY, sensitivity: WHEEL_ZOOM_SENSITIVITY };
}

/** Threshold (px) a pointer must move before the gesture commits. */
export function dragThresholdFor(onBook: boolean): number {
  return onBook ? BOOK_DRAG_DIST_PX : SHELF_DRAG_DIST_PX;
}

export type DragIntent = 'pull' | 'pan';

/**
 * Decide what a drag that just crossed its threshold means.
 * (dx, dy) is the total displacement since pointerdown, screen px, +y down.
 *
 * On a spine: pulling down (toward the viewer on the shelf's implied plane)
 * or mostly sideways slides the book out; a firm upward push is the classic
 * "scroll the shelf" gesture and pans instead. Off a spine: always pan.
 */
export function classifyDrag(startedOnBook: boolean, dx: number, dy: number): DragIntent {
  if (!startedOnBook) return 'pan';
  if (dy > 0) return 'pull';
  if (Math.abs(dx) >= Math.abs(dy)) return 'pull';
  return 'pan';
}

export type KeyZoomAction = 'in' | 'out' | 'reset';

export interface KeyLike {
  key: string;
  altKey?: boolean;
  /** True when focus sits in an editable target (input/textarea/contenteditable). */
  editing?: boolean;
}

/**
 * Keyboard zoom: + / = zoom in, - / _ zoom out, 0 reset. Works with or
 * without ctrl (ctrl+± / ctrl+0 are intercepted so the webview never
 * page-zooms); alt combos and keystrokes inside editable fields are ignored.
 */
export function classifyKeyZoom(e: KeyLike): KeyZoomAction | null {
  if (e.altKey === true || e.editing === true) return null;
  switch (e.key) {
    case '+':
    case '=':
      return 'in';
    case '-':
    case '_':
      return 'out';
    case '0':
      return 'reset';
    default:
      return null;
  }
}
