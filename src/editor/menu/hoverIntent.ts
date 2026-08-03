/**
 * `createHoverIntent()` — hover only counts once the pointer has actually moved.
 *
 * THE BUG THIS EXISTS FOR. A menu that opens where the caret is opens, quite
 * often, directly UNDER a stationary mouse — and Chromium dispatches
 * `mouseover`/`mouseenter` when an element appears beneath a pointer that has
 * not moved at all. A picker that treats every `mouseenter` as "the reader
 * chose this row" therefore hands the highlight to whichever row happened to
 * land under the cursor, and the next Enter inserts THAT one. The reader typed
 * a query, read the top row, pressed Enter and got the seventh: no error, no
 * animation, nothing to see afterwards except a wrong page in their sentence.
 *
 * It was caught in the `[[` picker (a screenshot with the last row lit and the
 * query still on the first), and the slash menu has always had the same shape,
 * so the guard lives here rather than in either card.
 *
 * WHY POINTERMOVE ON THE WINDOW and not `mousemove` on the card: the pointer
 * may enter the card from outside it, and the first move that matters can
 * happen anywhere. `pointermove` also covers pen and touch, where a "hover"
 * is a very deliberate act and should arm the guard immediately.
 *
 * Call inside a component (it registers an `onCleanup`), then gate the handler:
 *
 *     const moved = createHoverIntent();
 *     …
 *     onMouseEnter={() => { if (moved()) props.onHover(index()); }}
 */
import { onCleanup, type Accessor } from 'solid-js';

export function createHoverIntent(): Accessor<boolean> {
  let moved = false;
  if (typeof window === 'undefined') return () => true;

  const arm = (): void => {
    moved = true;
    window.removeEventListener('pointermove', arm);
  };
  window.addEventListener('pointermove', arm, { passive: true });
  onCleanup(() => window.removeEventListener('pointermove', arm));

  return () => moved;
}
