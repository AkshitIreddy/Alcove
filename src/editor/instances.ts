/**
 * Per-page editor registry — maps a mounted pageId to its live TipTap
 * instance so the spread host (BookView) can address a SPECIFIC page's
 * editor, not just "whichever editor focused last" (activeEditor.ts).
 *
 * Used by the pagination caret carry: when typing overflows a page, the
 * carried blocks land on the next page and BookView must drop the caret
 * inside that page's freshly (re)mounted editor. Plain Map — callers poll
 * across the remount (the keyed leaf disposes the old instance before the
 * new one mounts, so register/unregister order is safe with the
 * `only-if-current` guard on unregister).
 */
import type { Editor } from '@tiptap/core';

const instances = new Map<string, Editor>();

/** Register the live editor for a page (called on editor creation). */
export function registerPageEditor(pageId: string, editor: Editor): void {
  instances.set(pageId, editor);
}

/** Remove a page's editor, but only if `editor` is still the current one. */
export function unregisterPageEditor(pageId: string, editor: Editor): void {
  if (instances.get(pageId) === editor) instances.delete(pageId);
}

/** The live editor currently mounted for `pageId`, or null. */
export function getPageEditor(pageId: string): Editor | null {
  const editor = instances.get(pageId) ?? null;
  return editor !== null && !editor.isDestroyed ? editor : null;
}

/**
 * The page an editor is showing, or null.
 *
 * The reverse of the map, walked rather than kept as a second index: an
 * editor's page never changes (PageEditor remounts instead), so there is no
 * second map to keep in step, and the walk is over the two or three editors a
 * spread has mounted.
 *
 * The `[[` picker (src/editor/links) is what needs it — a page must not be
 * offered as a link target on itself, and a plugin only ever gets the editor.
 */
export function pageIdOfEditor(editor: Editor): string | null {
  for (const [pageId, instance] of instances) {
    if (instance === editor) return pageId;
  }
  return null;
}
