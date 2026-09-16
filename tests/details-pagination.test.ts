import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import UniqueID from '@tiptap/extension-unique-id';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { ReplaceStep } from '@tiptap/pm/transform';
import { detailsContinuationSlice, planDetailsSplit } from '../src/editor/detailsPagination';

const schema = getSchema([StarterKit, Details.configure({ persist: true }), DetailsContent, DetailsSummary,
  UniqueID.configure({ types: ['details', 'paragraph', 'orderedList', 'listItem', 'codeBlock'] }),
]);
const p = (text: string) => schema.nodes.paragraph!.create({ id: `p-${text}` }, schema.text(text));
const dropdown = (body: Node[], open = true) => schema.nodes.details!.create(
  { open, id: 'dropdown' }, [
    schema.nodes.detailsSummary!.create(null, schema.text('Heading')),
    schema.nodes.detailsContent!.create(null, body),
  ],
);

/** Deterministic vertical layout: ten characters to a line, 32px per line. */
function layout(root: Node) {
  const bottoms = new Map<number, number>();
  const lines = new Map<number, number>();
  const visit = (node: Node, pos: number, top: number): number => {
    let bottom = top;
    if (node.isTextblock) {
      for (let i = 0; i <= node.content.size; i++) lines.set(pos + 1 + i, top + (Math.floor(i / 10) + 1) * 32);
      bottom += Math.max(1, Math.ceil(node.content.size / 10)) * 32;
    } else {
      node.forEach((child, offset, index) => {
        if (node.type.name === 'details' && !node.attrs.open && index === 1) return;
        bottom = visit(child, pos + 1 + offset, bottom);
      });
    }
    bottoms.set(pos, bottom);
    return bottom;
  };
  visit(root, 0, 0);
  return {
    bottom: (_node: Node, pos: number) => bottoms.get(pos) ?? Infinity,
    lineBottom: (pos: number) => lines.get(pos) ?? Infinity,
  };
}

describe('dropdown pagination', () => {
  it('keeps fitting children on the first page and carries the rest with a summary', () => {
    const node = dropdown([p('one'), p('two'), p('three'), p('four')]);
    const split = planDetailsSplit(node, 0, 96, layout(node))!;
    expect(split.left.child(1).textContent).toBe('onetwo');
    expect(split.right.child(1).textContent).toBe('threefour');
    expect(split.right.child(0).eq(node.child(0))).toBe(true);
    split.left.check();
    split.right.check();
    expect(split.left.attrs.id).toBe('dropdown');
    expect(split.right.attrs.id).toBeNull();
    expect(split.right.child(1).firstChild!.attrs.id).toBe('p-three');
  });

  it('splits one oversized paragraph without losing text, marks or caret offsets', () => {
    const text = 'A long marked paragraph that must continue over several pages.';
    const paragraph = schema.nodes.paragraph!.create({ id: 'original' }, schema.text(text, [schema.marks.bold!.create()]));
    const node = dropdown([paragraph]);
    const split = planDetailsSplit(node, 0, 96, layout(node))!;
    const left = split.left.child(1).firstChild!;
    const right = split.right.child(1).firstChild!;
    expect(left.textContent + right.textContent).toBe(text);
    expect(left.firstChild!.marks[0]!.type.name).toBe('bold');
    expect(right.firstChild!.marks[0]!.type.name).toBe('bold');
    expect(right.attrs.id).toBeNull();
    const original = schema.nodes.doc!.create(null, node);
    const result = schema.nodes.doc!.create(null, [split.left, split.right]);
    for (let pos = split.cut; pos < node.nodeSize - 3; pos++) {
      const mapped = split.left.nodeSize + split.tailStart + pos - split.cut;
      expect(result.textBetween(mapped, mapped + 1)).toBe(original.textBetween(pos, pos + 1));
    }
  });

  it('does not strand a heading when there is no room for body text', () => {
    const node = dropdown([p('first'), p('second')]);
    expect(planDetailsSplit(node, 0, 32, layout(node))).toBeNull();
    expect(planDetailsSplit(node, 0, 96, layout(node))).toBeNull();
    const closed = dropdown([p('first'), p('second')], false);
    expect(planDetailsSplit(closed, 0, 10, layout(closed))).toBeNull();
  });

  it('continues nested dropdowns and ordered lists with valid structure and numbering', () => {
    const items = ['one', 'two', 'three'].map(text => schema.nodes.listItem!.create(null, p(text)));
    const list = schema.nodes.orderedList!.create({ start: 4 }, items);
    const node = dropdown([dropdown([list])]);
    const split = planDetailsSplit(node, 0, 96, layout(node))!;
    split.left.check();
    split.right.check();
    const carriedList = split.right.child(1).firstChild!.child(1).firstChild!;
    expect(carriedList.attrs.start).toBe(5);
    expect(carriedList.textContent).toBe('twothree');
  });

  it('keeps atomic body blocks whole and preserves hidden contents', () => {
    const closed = dropdown([p('hidden text')], false);
    const node = dropdown([p('visible'), closed, p('after')]);
    const split = planDetailsSplit(node, 0, 64, layout(node))!;
    expect(split.right.child(1).firstChild!.eq(closed)).toBe(true);
    expect(split.right.child(1).lastChild!.textContent).toBe('after');
  });

  it('preserves code newlines when a code block is split inside a dropdown', () => {
    const code = schema.nodes.codeBlock!.create(null, schema.text('first line\nsecond line\nthird line'));
    const node = dropdown([code]);
    const split = planDetailsSplit(node, 0, 96, layout(node))!;
    expect(split.left.child(1).firstChild!.textContent.endsWith('\n')).toBe(true);
    expect(split.left.child(1).textContent + split.right.child(1).textContent).toBe(code.textContent);
  });

  it('preserves typing history and maps the caret through the inserted page boundary', () => {
    const node = dropdown([p('first paragraph with a long body')]);
    let state = EditorState.create({ schema, doc: schema.nodes.doc!.create(null, node), plugins: [history()] });
    const at = node.nodeSize - 3;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)).insertText('typed'));
    const before = state.doc.firstChild!;
    const split = planDetailsSplit(before, 0, 96, layout(before))!;
    state = state.apply(state.tr.step(new ReplaceStep(split.cut, split.cut, detailsContinuationSlice(split))).setMeta('addToHistory', false));
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(0).eq(split.left)).toBe(true);
    expect(state.doc.child(1).eq(split.right)).toBe(true);
    expect(state.doc.resolve(state.selection.head).parent.textContent).toContain('typed');
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.textContent).not.toContain('typed');
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.textContent).toContain('typed');
  });
});
