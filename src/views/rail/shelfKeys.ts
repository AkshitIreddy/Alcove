/**
 * src/views/rail/shelfKeys.ts — keep the shelf's keyboard out of the studio.
 *
 * `ShelfWorld` binds its navigation keys on `document` in the bubble phase
 * (world.ts, "Keyboard shelf nav"): arrows move a selection halo between
 * books, Home jumps the camera to the first floor, and **Enter pulls the
 * selected book out and opens it**. It skips the keystroke only when the event
 * target is an editable field, which a button is not.
 *
 * So every key a picker needs also reaches the shelf. Driving the sixty-card
 * sheet by keyboard was measurably unusable: arrowing across the grid dragged
 * the halo around behind the panel, and Enter on a card picked the design and
 * then opened a book on top of the studio — verified in the browser, not
 * guessed.
 *
 * The panel is a dialog; while it is up, keys pressed inside it are its own.
 * Everything is stopped at the studio root except Escape, which has to carry
 * on reaching `window` where RailPanel listens for it, or the sheet would lose
 * its one way out.
 */

/**
 * Bubble-phase keydown guard for a studio root.
 *
 * **Attach with `on:keydown`, not `onKeyDown`.** Solid delegates `keydown` to
 * `document`, and a delegated handler runs on the same node as the shelf's own
 * listener — `stopPropagation` there is a no-op against a sibling listener, and
 * the first attempt at this guard did nothing at all for exactly that reason.
 * `on:keydown` puts a real listener on the element, which runs while the event
 * is still climbing and therefore actually stops it.
 *
 * `stopPropagation`, never `preventDefault`: a button still has to turn its
 * Enter and Space into a click, and Tab still has to move focus.
 *
 * The consequence for anything INSIDE the guarded root: it must use
 * `on:keydown` too, or it will never see the event — delegation happens at
 * document, and the guard now stops the event before it gets there.
 */
export function stopShelfKeys(event: Event): void {
  if (event instanceof KeyboardEvent && event.key === 'Escape') return;
  event.stopPropagation();
}
