import type { JSX } from "solid-js";
import "../styles/shelf.css";
import BookshelfWorld from "../features/bookshelf/BookshelfWorld";
import QuickSwitcher from "../features/quickswitch/QuickSwitcher";

/** The hand-drawn bookshelf world (PixiJS canvas + DOM overlay). */
export default function ShelfView(): JSX.Element {
  return (
    <>
      <BookshelfWorld />
      {/* Ctrl+K quick switcher (single-instance; safe if also mounted in App). */}
      <QuickSwitcher />
    </>
  );
}
