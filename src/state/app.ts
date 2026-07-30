import { createSignal, type Accessor } from "solid-js";

/** Which top-level scene the shell is showing. */
export type ViewState = "shelf" | "book";

export interface AppState {
  /** Reactive accessor for the current top-level view. */
  readonly viewState: Accessor<ViewState>;
  /** Jump directly to a view. */
  setViewState(next: ViewState): void;
  /**
   * Open the focused book view. Pass a book id to record which book is open
   * (the shelf uses it to animate the book back on close); omitting it keeps
   * the previous id (legacy no-arg callers).
   */
  openBook(bookId?: string): void;
  /** Convenience: return to the bookshelf (keeps openBookId for the return animation). */
  closeBook(): void;
  /** Id of the currently open book, or null. */
  readonly openBookId: Accessor<string | null>;
  /** Called by the shelf once the close animation has landed the book. */
  clearOpenBook(): void;
}

const [viewState, setViewState] = createSignal<ViewState>("shelf");
const [openBookId, setOpenBookId] = createSignal<string | null>(null);

/**
 * App-shell state store. Later features (page flip progress, editor focus, …)
 * plug in alongside viewState here.
 */
export const appState: AppState = {
  viewState,
  setViewState: (next) => setViewState(next),
  openBook: (bookId) => {
    if (bookId !== undefined) setOpenBookId(bookId);
    setViewState("book");
  },
  closeBook: () => setViewState("shelf"),
  openBookId,
  clearOpenBook: () => setOpenBookId(null),
};
