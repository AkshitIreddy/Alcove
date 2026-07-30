/**
 * Paste/drop decision matrix — pure logic, unit-tested in
 * tests/media.test.ts. The ProseMirror plugin (pastePlugin.ts) gathers the
 * facts from the DOM event and defers every decision here.
 */
import { isBareUrl } from './urlGuard';

export interface PasteContext {
  /** Number of image files on the clipboard / drag payload. */
  imageFileCount: number;
  /** Plain-text clipboard content ('' when absent). */
  text: string;
  /** True when the selection is a caret (no range selected). */
  selectionEmpty: boolean;
  /** True when pasting inside a code block (never upgrade there). */
  inCodeBlock: boolean;
}

export type PasteAction =
  | { kind: 'insert-images' }
  | { kind: 'insert-link-card'; url: string }
  | { kind: 'default' };

/**
 * Decide what a paste/drop should do:
 * - any image files → store them + insert image / imageRow blocks;
 * - a single bare URL pasted at an empty (caret) selection outside code
 *   → upgrade to a linkCard (typing over a selection keeps default paste,
 *   so link-on-selection still creates a text link);
 * - anything else → let ProseMirror handle it.
 */
export function classifyPaste(context: PasteContext): PasteAction {
  if (context.imageFileCount > 0) {
    return { kind: 'insert-images' };
  }
  if (
    !context.inCodeBlock &&
    context.selectionEmpty &&
    isBareUrl(context.text)
  ) {
    return { kind: 'insert-link-card', url: context.text.trim() };
  }
  return { kind: 'default' };
}

/** Split image sources into imageRow-sized groups (1 → single image). */
export function groupImageSources<T>(sources: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < sources.length; i += 4) {
    groups.push(sources.slice(i, i + 4));
  }
  return groups;
}
