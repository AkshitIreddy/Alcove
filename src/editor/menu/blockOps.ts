/**
 * Block operations — the imperative verbs shared by the right-click context
 * menu and the rail palette API (src/editor/api.ts). Every function operates
 * on ONE top-level block (identified by its doc position) of a live editor.
 */
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { PageDoc } from '../../data/types';
import { docToScript } from '../script/fromTiptap';

export interface BlockRef {
  /** Position immediately before the top-level block. */
  readonly pos: number;
  readonly node: ProseMirrorNode;
}

/** The top-level block containing the selection head (or an explicit pos). */
export function topLevelBlockAt(
  editor: Editor,
  pos?: number,
): BlockRef | null {
  const { doc, selection } = editor.state;
  const probe = pos ?? selection.head;
  if (probe < 0 || probe > doc.content.size) return null;
  const $pos = doc.resolve(probe);
  if ($pos.depth >= 1) {
    const before = $pos.before(1);
    const node = doc.nodeAt(before);
    return node ? { pos: before, node } : null;
  }
  // Depth 0: the position sits between top-level blocks (atoms, gaps).
  const after = $pos.nodeAfter;
  if (after) return { pos: probe, node: after };
  const beforeNode = $pos.nodeBefore;
  return beforeNode
    ? { pos: probe - beforeNode.nodeSize, node: beforeNode }
    : null;
}

/** Select the whole block (NodeSelection) — right-click select-first. */
export function selectBlock(editor: Editor, pos: number): boolean {
  const { doc } = editor.state;
  if (doc.nodeAt(pos) === null) return false;
  const tr = editor.state.tr.setSelection(NodeSelection.create(doc, pos));
  editor.view.dispatch(tr);
  return true;
}

/** Inner text range of a block (for mark commands like color/highlight). */
export function blockTextRange(
  block: BlockRef,
): { from: number; to: number } {
  if (block.node.isTextblock || block.node.isAtom) {
    return {
      from: block.pos + 1,
      to: block.pos + Math.max(1, block.node.nodeSize - 1),
    };
  }
  return { from: block.pos + 1, to: block.pos + block.node.nodeSize - 1 };
}

/** Merge one effect attribute into a block (BlockEffects global attrs). */
export function applyEffectAt(
  editor: Editor,
  pos: number,
  key: string,
  value: string | number | null,
): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  if (!(key in node.attrs)) return false;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    [key]: value,
  });
  editor.view.dispatch(tr);
  return true;
}

/**
 * Toggle-style quick apply: sets the effect, or clears it when it already
 * carries that exact value (so the menu item acts as an on/off switch).
 */
export function toggleEffectAt(
  editor: Editor,
  pos: number,
  key: string,
  value: string | number,
): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const current: unknown = node.attrs[key];
  return applyEffectAt(editor, pos, key, current === value ? null : value);
}

/** Duplicate the block right below itself (UniqueID re-mints the id). */
export function duplicateBlock(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  return editor
    .chain()
    .insertContentAt(pos + node.nodeSize, node.toJSON() as object)
    .focus()
    .run();
}

/** Delete the whole block. */
export function deleteBlock(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  return editor
    .chain()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .focus()
    .run();
}

/** Insert an empty paragraph above/below and put the caret in it. */
export function insertParagraphNear(
  editor: Editor,
  pos: number,
  where: 'above' | 'below',
): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const at = where === 'above' ? pos : pos + node.nodeSize;
  const ok = editor
    .chain()
    .insertContentAt(at, { type: 'paragraph' })
    .run();
  if (!ok) return false;
  const selection = TextSelection.create(editor.state.doc, at + 1);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  editor.view.focus();
  return true;
}

/** One block printed as Notebook Script (single-block doc → printer). */
export function blockToScript(editor: Editor, pos: number): string | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return null;
  const doc: PageDoc = {
    type: 'doc',
    attrs: { ...editor.state.doc.attrs },
    content: [node.toJSON()],
  };
  return docToScript(doc);
}

/**
 * Put a text selection inside the block, then run `command` — the pattern
 * for "turn into" verbs (setNode/toggle* act on the selection).
 */
export function withBlockSelection(
  editor: Editor,
  pos: number,
  command: (editor: Editor) => boolean,
): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const inner = Math.min(pos + 1, editor.state.doc.content.size);
  const ok = editor.chain().focus().setTextSelection(inner).run();
  if (!ok) return false;
  return command(editor);
}
