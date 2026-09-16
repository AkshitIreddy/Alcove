import { Fragment, type Node as ProseMirrorNode, type Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { ReplaceStep } from '@tiptap/pm/transform';

interface Measurements {
  bottom(node: ProseMirrorNode, position: number): number;
  lineBottom(position: number): number;
}

export interface DetailsSplit {
  left: ProseMirrorNode;
  right: ProseMirrorNode;
  /** Original split position relative to the node's opening token. */
  cut: number;
  /** Corresponding position in the carried node, after its repeated wrappers. */
  tailStart: number;
}

/** Insert only the boundary wrappers, keeping original text positions mapped
 * through ProseMirror history and selections instead of replacing all text. */
export function detailsContinuationSlice(split: DetailsSplit): Slice {
  const document = split.left.type.schema.topNodeType.create(null, [split.left, split.right]);
  return document.slice(split.cut, split.left.nodeSize + split.tailStart);
}

const FLOW_CONTAINERS = new Set([
  'detailsContent', 'blockquote', 'bulletList', 'orderedList',
  'listItem', 'taskList', 'taskItem', 'callout',
]);

function half(node: ProseMirrorNode, content: Fragment, carried: boolean): ProseMirrorNode {
  return node.type.createChecked(
    carried && 'id' in node.attrs ? { ...node.attrs, id: null } : node.attrs,
    content,
    node.marks,
  );
}

/**
 * Split an expanded dropdown at the last fitting body boundary. Measurements
 * use client pixels throughout. Repeat the summary on the following page so
 * both pieces remain valid, editable dropdowns with their own working toggle.
 * Never split a closed dropdown or leave its summary stranded without a body.
 */
export function planDetailsSplit(
  node: ProseMirrorNode,
  position: number,
  limitY: number,
  measure: Measurements,
): DetailsSplit | null {
  if (node.type.name !== 'details' || node.attrs.open !== true) return null;
  return splitFlow(node, position, limitY, measure);
}

function splitFlow(
  node: ProseMirrorNode,
  position: number,
  limitY: number,
  measure: Measurements,
): DetailsSplit | null {
  if (node.isTextblock) {
    if (node.content.size < 2) return null;
    const start = position + 1;
    let low = 1;
    let high = node.content.size - 1;
    let offset = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (measure.lineBottom(start + mid) <= limitY) {
        offset = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (offset === 0) return null;
    if (node.type.spec.code) {
      const newline = node.textContent.lastIndexOf('\n', offset - 1);
      if (newline < 0) return null;
      offset = newline + 1;
    } else {
      while (offset < node.content.size && node.textBetween(offset, offset + 1) === ' ') offset++;
    }
    if (offset >= node.content.size) return null;
    return {
      left: half(node, node.content.cut(0, offset), false),
      right: half(node, node.content.cut(offset), true),
      cut: 1 + offset,
      tailStart: 1,
    };
  }

  if (node.type.name === 'details') {
    if (node.attrs.open !== true || node.childCount !== 2) return null;
    const summary = node.child(0);
    const body = node.child(1);
    const bodyStart = 1 + summary.nodeSize;
    const split = splitFlow(body, position + bodyStart, limitY, measure);
    if (!split) return null;
    return {
      left: half(node, Fragment.fromArray([summary, split.left]), false),
      right: half(node, Fragment.fromArray([summary, split.right]), true),
      cut: bodyStart + split.cut,
      tailStart: bodyStart + split.tailStart,
    };
  }
  if (!FLOW_CONTAINERS.has(node.type.name) || node.childCount === 0) return null;

  const children: ProseMirrorNode[] = [];
  node.forEach(child => children.push(child));
  const last = children[children.length - 1]!;
  const lastPosition = position + node.nodeSize - 1 - last.nodeSize;
  // Account for bottom padding/borders on nested body containers too.
  const innerLimit = limitY - Math.max(0,
    measure.bottom(node, position) - measure.bottom(last, lastPosition),
  );
  let childOffset = 1;
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    const childPosition = position + childOffset;
    if (measure.bottom(child, childPosition) <= innerLimit) {
      childOffset += child.nodeSize;
      continue;
    }
    const split = splitFlow(child, childPosition, innerLimit, measure);
    const left = [...children.slice(0, index), ...(split ? [split.left] : [])];
    const right = [...(split ? [split.right] : [child]), ...children.slice(index + 1)];
    if (!left.length) return null;
    const leftFragment = Fragment.fromArray(left);
    const rightFragment = Fragment.fromArray(right);
    if (!node.type.validContent(leftFragment) || !node.type.validContent(rightFragment)) return null;
    let carried = half(node, rightFragment, true);
    if (node.type.name === 'orderedList') {
      carried = carried.type.createChecked({ ...carried.attrs, start: Number(node.attrs.start ?? 1) + index }, carried.content, carried.marks);
    }
    return {
      left: half(node, leftFragment, false),
      right: carried,
      cut: childOffset + (split?.cut ?? 0),
      tailStart: 1 + (split?.tailStart ?? 0),
    };
  }
  return null;
}

export function splitOverflowingDetails(view: EditorView, limitY: number, index: number): boolean {
  const { state } = view;
  const node = state.doc.maybeChild(index);
  if (!node || node.type.name !== 'details' || node.attrs.open !== true) return false;
  let position = 0;
  for (let i = 0; i < index; i++) position += state.doc.child(i).nodeSize;
  try {
    const split = planDetailsSplit(node, position, limitY, {
      bottom: (_node, pos) => {
        const dom = view.nodeDOM(pos);
        return dom instanceof Element ? dom.getBoundingClientRect().bottom : Infinity;
      },
      lineBottom: pos => view.coordsAtPos(pos).bottom,
    });
    if (!split) return false;
    const at = position + split.cut;
    // Bypass paste-fitting: it would close the slice inside this isolating
    // dropdown. The exact step validates the already-planned schema split.
    const tr = state.tr.step(new ReplaceStep(at, at, detailsContinuationSlice(split)));
    view.dispatch(tr.setMeta('addToHistory', false));
    return true;
  } catch {
    // Node views can be between attachment and measurement; a later pass
    // retries. A schema refusal must never damage the original dropdown.
    return false;
  }
}
