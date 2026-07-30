/**
 * Editor-local state — thin adapter over the app-shell store.
 *
 * The shelf records the open book via `appState.openBook(bookId)`; BookView
 * reads it through `editorState.openBookId`. Kept as its own module so editor
 * code has a single import point if editor-only state grows later.
 */
import { appState } from "../state/app";
import type { Accessor } from "solid-js";

export interface EditorState {
  /** Id of the book the BookView should show, or null when unset. */
  readonly openBookId: Accessor<string | null>;
  setOpenBookId(id: string | null): void;
}

export const editorState: EditorState = {
  openBookId: appState.openBookId,
  setOpenBookId: (id) =>
    id === null ? appState.clearOpenBook() : appState.openBook(id),
};
