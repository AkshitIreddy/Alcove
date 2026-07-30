/**
 * Vendored SolidJS bindings for TipTap v3 — editor lifecycle.
 *
 * Based on the @vrite/tiptap-solid (MIT) pattern, rewritten for TipTap 3.x:
 * the Editor is created in onMount (it needs a real DOM element) and torn
 * down in onCleanup. Consumers receive a signal accessor so downstream
 * reactive code (toolbars, switchers) re-runs once the editor exists.
 */
import { Editor, type EditorOptions } from '@tiptap/core';
import {
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from 'solid-js';

/**
 * Create a TipTap editor bound to the Solid owner's lifecycle.
 *
 * @param options Lazily evaluated so refs assigned during JSX creation
 *                (e.g. the mount element) are resolved at onMount time.
 * @returns Accessor that is `undefined` until mounted, then the Editor.
 */
export function createTiptapEditor(
  options: () => Partial<EditorOptions>,
): Accessor<Editor | undefined> {
  const [editor, setEditor] = createSignal<Editor | undefined>(undefined);

  onMount(() => {
    const instance = new Editor(options());
    setEditor(instance);

    onCleanup(() => {
      instance.destroy();
      setEditor(undefined);
    });
  });

  return editor;
}
