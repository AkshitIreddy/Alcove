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
import type { PageStyle } from '../../data/types';
import {
  DEFAULT_LINE_HEIGHT_PX,
  DEFAULT_PAGE_STYLE,
  isPageStyle,
} from '../document';

const [current, setCurrent] = createSignal<Editor | null>(null);

/** The live editor of the mounted page, or null. */
export const activeEditor: Accessor<Editor | null> = current;

/** Register (or clear with null) the live page editor. */
export function setActiveEditor(editor: Editor | null): void {
  setCurrent(editor);
}

// ---------------------------------------------------------------------------
// Page-appearance imperative surface — the BookView rail drives the page
// style through these instead of the removed in-page floating switcher.
// Reactive: they read through the activeEditor signal, so UI wrapped in a
// createEditorTransaction/createEffect updates after each change.
// ---------------------------------------------------------------------------

/** The active page's background style ('ruled' when no editor is live). */
export function getPageStyle(): PageStyle {
  const editor = activeEditor();
  const value: unknown = editor?.state.doc.attrs.pageStyle;
  return isPageStyle(value) ? value : DEFAULT_PAGE_STYLE;
}

/** Set the active page's background style. */
export function setPageStyle(style: PageStyle): boolean {
  const editor = activeEditor();
  if (!editor || !isPageStyle(style)) return false;
  if (getPageStyle() === style) return true;
  editor.view.dispatch(editor.state.tr.setDocAttribute('pageStyle', style));
  return true;
}

/** The active page's rule spacing in px (default 32). */
export function getLineHeight(): number {
  const editor = activeEditor();
  const value: unknown = editor?.state.doc.attrs.lineHeightPx;
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_LINE_HEIGHT_PX;
}

/** Set the active page's rule spacing (clamped 24..64, whole px). */
export function setLineHeight(px: number): boolean {
  const editor = activeEditor();
  if (!editor || !Number.isFinite(px)) return false;
  const clamped = Math.min(64, Math.max(24, Math.round(px)));
  if (getLineHeight() === clamped) return true;
  editor.view.dispatch(
    editor.state.tr.setDocAttribute('lineHeightPx', clamped),
  );
  return true;
}
