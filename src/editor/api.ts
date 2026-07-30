/**
 * Editor command surface for the BookView rail palette (built by another
 * module). Every function operates on the ACTIVE editor (the focused page)
 * and returns false when there is no live editor to act on.
 *
 *   import { editorApi } from '../editor/api';
 *   editorApi.insertSticker('bee');
 *   editorApi.applyBlockEffect('tape', 'top');   // null clears
 *   editorApi.setInk('ink-blue');                // null restores default
 *   editorApi.setHighlight('moss');              // null removes
 *
 * Selection rules: setInk/setHighlight apply to the current text selection
 * when one exists, otherwise to the whole block under the caret.
 * applyBlockEffect always targets the top-level block under the caret.
 */
import { activeEditor } from './insert/activeEditor';
import { isStickerId, type StickerId } from './nodes/stickers';
import {
  applyEffectAt,
  blockTextRange,
  topLevelBlockAt,
} from './menu/blockOps';
import {
  HIGHLIGHT_WASHES,
  INK_COLOR_TOKENS,
  type HighlightWash,
  type InkColor,
} from './menu/registry';

export type { HighlightWash, InkColor, StickerId };

/** BlockEffects attribute keys the rail can quick-apply. */
export const BLOCK_EFFECT_KEYS = [
  'rotate',
  'tape',
  'washi',
  'shadow',
  'frame',
  'paper',
  'underline',
] as const;

export type BlockEffectKey = (typeof BLOCK_EFFECT_KEYS)[number];

/** Insert a sticker at the caret of the active editor. */
export function insertSticker(id: StickerId): boolean {
  const editor = activeEditor();
  if (!editor || !isStickerId(id)) return false;
  return editor.chain().focus().insertSticker({ stickerId: id }).run();
}

/**
 * Set (or clear with null) one decorative effect on the block under the
 * caret. `rotate` takes a number in degrees (clamped -3..3 by the schema);
 * the enum effects take their vocab strings ('top', 'scallop', 'torn', …).
 */
export function applyBlockEffect(
  effect: BlockEffectKey,
  value: string | number | null,
): boolean {
  const editor = activeEditor();
  if (!editor) return false;
  const block = topLevelBlockAt(editor);
  if (!block) return false;
  return applyEffectAt(editor, block.pos, effect, value);
}

/** Ink color for the selection (or whole caret block). Null = default ink. */
export function setInk(color: InkColor | null): boolean {
  const editor = activeEditor();
  if (!editor) return false;
  const chain = editor.chain();
  if (editor.state.selection.empty) {
    const block = topLevelBlockAt(editor);
    if (!block) return false;
    chain.setTextSelection(blockTextRange(block));
  }
  if (color === null) chain.unsetColor();
  else chain.setColor(INK_COLOR_TOKENS[color]);
  return chain.focus().run();
}

/** Highlight wash for the selection (or whole caret block). Null removes. */
export function setHighlight(wash: HighlightWash | null): boolean {
  const editor = activeEditor();
  if (!editor) return false;
  if (
    wash !== null &&
    !(HIGHLIGHT_WASHES as readonly string[]).includes(wash)
  ) {
    return false;
  }
  const chain = editor.chain();
  if (editor.state.selection.empty) {
    const block = topLevelBlockAt(editor);
    if (!block) return false;
    chain.setTextSelection(blockTextRange(block));
  }
  if (wash === null) chain.unsetHighlight();
  else chain.setHighlight({ color: wash });
  return chain.focus().run();
}

/** The rail palette API, bundled. */
export const editorApi = {
  insertSticker,
  applyBlockEffect,
  setInk,
  setHighlight,
} as const;
