/**
 * Active-editor registry — a single reactive slot holding the TipTap editor
 * of the currently mounted page.
 *
 * PageEditor registers itself here (see wiring note in the feature summary):
 *
 *   createEffect(() => setActiveEditor(editor() ?? null));
 *   onCleanup(() => setActiveEditor(null));
 *
 * The Insert Script dialog and the BookView toolbar read `activeEditor()` to
 * insert content at the cursor / export the live document. Both fall back to
 * the persisted page doc when no editor is registered.
 */
import type { Editor } from '@tiptap/core';
import { createSignal, type Accessor } from 'solid-js';

const [current, setCurrent] = createSignal<Editor | null>(null);

/** The live editor of the mounted page, or null. */
export const activeEditor: Accessor<Editor | null> = current;

/** Register (or clear with null) the live page editor. */
export function setActiveEditor(editor: Editor | null): void {
  setCurrent(editor);
}
