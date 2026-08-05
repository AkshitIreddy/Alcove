import type { JSX } from "solid-js";
import "../styles/shelf.css";
import BookshelfWorld from "../features/bookshelf/BookshelfWorld";
import QuickSwitcher from "../features/quickswitch/QuickSwitcher";

/**
 * The flat bookshelf world (PixiJS canvas + DOM overlay).
 *
 * Mounted for the life of the app, NOT switched in and out against BookView:
 * it was the fallback of a `<Show>` once, and rebuilding the Pixi world on
 * every return from a book is what put a blank cream second in front of the
 * reader each time they pressed "back to shelf". App.tsx carries the long
 * version; `BookshelfWorld` marks itself away while a book is open.
 */
export default function ShelfView(): JSX.Element {
  return (
    <>
      <BookshelfWorld />
      {/* Ctrl+K quick switcher (single-instance; safe if also mounted in App). */}
      <QuickSwitcher />
    </>
  );
}
