import type { JSX } from "solid-js";
import "../styles/shelf.css";
import BookshelfWorld from "../features/bookshelf/BookshelfWorld";

/** The hand-drawn bookshelf world (PixiJS canvas + DOM overlay). */
export default function ShelfView(): JSX.Element {
  return <BookshelfWorld />;
}
