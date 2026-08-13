import { getSchema, type Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { topLevelBlocksInRange } from '../src/editor/menu/blockOps';

function editorWithBlocks(): Editor {
  const schema = getSchema([StarterKit]);
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'two' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'four' }] },
    ],
  });
  return { state: EditorState.create({ schema, doc }) } as unknown as Editor;
}

describe('multi-block page movement range', () => {
  it('returns complete top-level blocks touched by a partial text selection', () => {
    const editor = editorWithBlocks();

    const blocks = topLevelBlocksInRange(editor, { from: 7, to: 14 });

    expect(blocks.map(({ pos, index, node }) => ({
      pos,
      index,
      type: node.type.name,
      text: node.textContent,
    }))).toEqual([
      { pos: 5, index: 1, type: 'heading', text: 'two' },
      { pos: 10, index: 2, type: 'paragraph', text: 'three' },
    ]);
  });

  it('treats the selection end as exclusive at the next block boundary', () => {
    const editor = editorWithBlocks();

    expect(
      topLevelBlocksInRange(editor, { from: 1, to: 10 }).map((block) =>
        block.node.textContent,
      ),
    ).toEqual(['one', 'two']);
  });

  it('normalizes a backward selection without changing document order', () => {
    const editor = editorWithBlocks();

    expect(
      topLevelBlocksInRange(editor, { from: 14, to: 7 }).map((block) =>
        block.node.textContent,
      ),
    ).toEqual(['two', 'three']);
  });
});
