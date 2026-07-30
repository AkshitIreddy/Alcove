/**
 * Vendored SolidJS bindings for TipTap v3 — transaction-driven selectors.
 *
 * Subscribes to the editor's 'transaction' event and re-runs a selector
 * into a memo. Use for selection-dependent UI (active marks, doc attrs,
 * toolbar state) without touching ProseMirror internals from JSX.
 */
import type { Editor } from '@tiptap/core';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
} from 'solid-js';

/**
 * Re-run `read` on every editor transaction (and whenever the editor
 * instance itself appears/changes), memoized into a signal accessor.
 */
export function createEditorTransaction<Result>(
  editor: Accessor<Editor | undefined>,
  read: (editor: Editor | undefined) => Result,
): Accessor<Result> {
  // Ticker signal: bumped (equals: false) on every transaction.
  const [tick, bump] = createSignal<undefined>(undefined, { equals: false });

  createEffect(() => {
    const instance = editor();
    if (!instance) return;
    const notify = (): void => bump(undefined);
    instance.on('transaction', notify);
    onCleanup(() => {
      instance.off('transaction', notify);
    });
  });

  return createMemo(() => {
    tick();
    return read(editor());
  });
}
