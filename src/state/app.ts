import { createSignal, type Accessor } from "solid-js";

/** Which top-level scene the shell is showing. */
export type ViewState = "shelf" | "book";

export interface AppState {
  /** Reactive accessor for the current top-level view. */
  readonly viewState: Accessor<ViewState>;
  /** Jump directly to a view. */
  setViewState(next: ViewState): void;
  /** Convenience: open the focused book view. */
  openBook(): void;
  /** Convenience: return to the bookshelf. */
  closeBook(): void;
}

const [viewState, setViewState] = createSignal<ViewState>("shelf");

/**
 * App-shell state store. Later features (shelf camera, open-book id,
 * flip progress, …) plug in alongside viewState here.
 */
export const appState: AppState = {
  viewState,
  setViewState: (next) => setViewState(next),
  openBook: () => setViewState("book"),
  closeBook: () => setViewState("shelf"),
};
