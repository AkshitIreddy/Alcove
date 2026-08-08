/**
 * src/diagrams/layout/tree.ts — tidy-tree layout (simplified Reingold–
 * Tilford) plus a radial mode for mindmaps. Pure functions: script TreeNode
 * ASTs in, positioned boxes out. No DOM, no side effects.
 *
 * Top-down mode invariants (tested):
 *  - deterministic for identical input,
 *  - sibling subtrees never overlap horizontally,
 *  - a parent is centered over the span of its children,
 *  - every node sits fully inside the reported width/height.
 */

import type { TreeNode } from '../../script/types';
import type { TextMeasurer } from '../measure';
import type { DiagramLayout, LaidEdge, LaidNode } from '../types';
import { nodeBox } from './size';

export interface TreeLayoutOptions {
  measure?: TextMeasurer;
  /** Horizontal gap between sibling subtrees (px). */
  gapX?: number;
  /** Vertical gap between depth rows (px). */
  gapY?: number;
  /** Outer margin around the whole drawing (px). */
  margin?: number;
}

interface SizedTree {
  node: TreeNode;
  id: string;
  parentId?: string;
  depth: number;
  w: number;
  h: number;
  children: SizedTree[];
  /** Width of the whole subtree block (>= w). */
  subtreeW: number;
  /** Count of leaves under (and including) this node — radial wedges. */
  leaves: number;
}

function buildSized(
  node: TreeNode,
  id: string,
  parentId: string | undefined,
  depth: number,
  gapX: number,
  measure: TextMeasurer | undefined,
): SizedTree {
  const box = nodeBox(node.label, node.note, node.attrs, { measure });
  const children = node.children.map((child, i) =>
    buildSized(child, `${id}.${i}`, id, depth + 1, gapX, measure),
  );
  const childrenW =
    children.reduce((sum, c) => sum + c.subtreeW, 0) +
    gapX * Math.max(0, children.length - 1);
  const leaves =
    children.length === 0
      ? 1
      : children.reduce((sum, c) => sum + c.leaves, 0);
  return {
    node,
    id,
    parentId,
    depth,
    w: box.width,
    h: box.height,
    children,
    subtreeW: Math.max(box.width, childrenW),
    leaves,
  };
}

function maxDepth(t: SizedTree): number {
  return t.children.reduce((m, c) => Math.max(m, maxDepth(c)), t.depth);
}

function collectRowHeights(t: SizedTree, rows: number[]): void {
  rows[t.depth] = Math.max(rows[t.depth] ?? 0, t.h);
  for (const c of t.children) collectRowHeights(c, rows);
}

/**
 * Top-down tidy tree. Multiple roots become a forest laid side by side.
 */
export function layoutTree(
  roots: TreeNode[],
  opts: TreeLayoutOptions = {},
): DiagramLayout {
  /* A default leaf is roughly 387px wide. Sixteen pixels still separates the
     hand-drawn node outlines, while keeping a useful two-branch tree at its
     authored 14/13px type instead of shrinking the whole SVG below the
     handwriting floor. */
  const gapX = opts.gapX ?? 16;
  const gapY = opts.gapY ?? 44;
  const margin = opts.margin ?? 10;

  const sized = roots.map((root, i) =>
    buildSized(root, String(i), undefined, 0, gapX, opts.measure),
  );
  if (sized.length === 0) {
    return { nodes: [], edges: [], width: 2 * margin, height: 2 * margin, warnings: [] };
  }

  // Row Y centers from per-depth max heights.
  const rowHeights: number[] = [];
  for (const t of sized) collectRowHeights(t, rowHeights);
  const rowCenterY: number[] = [];
  let cursorY = margin;
  for (const h of rowHeights) {
    rowCenterY.push(cursorY + h / 2);
    cursorY += h + gapY;
  }

  const nodes: LaidNode[] = [];
  const edges: LaidEdge[] = [];

  // Place a subtree block whose left edge is `left`; returns the node center x.
  const place = (t: SizedTree, left: number): number => {
    let centerX: number;
    if (t.children.length === 0) {
      centerX = left + t.subtreeW / 2;
    } else {
      // Children packed within the block; extra room is centered.
      const childrenW =
        t.children.reduce((sum, c) => sum + c.subtreeW, 0) +
        gapX * (t.children.length - 1);
      let childLeft = left + (t.subtreeW - childrenW) / 2;
      const childCenters: number[] = [];
      for (const child of t.children) {
        childCenters.push(place(child, childLeft));
        childLeft += child.subtreeW + gapX;
      }
      centerX = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    }
    const laid: LaidNode = {
      id: t.id,
      label: t.node.label,
      x: centerX,
      y: rowCenterY[t.depth],
      width: t.w,
      height: t.h,
      depth: t.depth,
      ...(t.node.note !== undefined ? { note: t.node.note } : {}),
      ...(t.node.attrs !== undefined ? { attrs: t.node.attrs } : {}),
    };
    nodes.push(laid);
    for (const child of t.children) {
      edges.push({
        from: t.id,
        to: child.id,
        points: [
          { x: centerX, y: rowCenterY[t.depth] + t.h / 2 },
          { x: 0, y: 0 }, // patched below once the child is known
        ],
      });
    }
    return centerX;
  };

  let forestLeft = margin;
  for (const t of sized) {
    place(t, forestLeft);
    forestLeft += t.subtreeW + gapX * 2;
  }

  // Patch edge endpoints (child top-center) now that all nodes exist.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const to = byId.get(edge.to);
    if (to) edge.points[1] = { x: to.x, y: to.y - to.height / 2 };
  }

  const width = forestLeft - gapX * 2 + margin;
  const deepest = Math.max(...sized.map(maxDepth));
  const height = rowCenterY[deepest] + rowHeights[deepest] / 2 + margin;
  return { nodes, edges, width, height, warnings: [] };
}

// ---------------------------------------------------------------------------
// Radial (mindmap)
// ---------------------------------------------------------------------------

export interface RadialLayoutOptions {
  measure?: TextMeasurer;
  /** Radius step per depth ring (px). */
  ringGap?: number;
  margin?: number;
}

interface RadialPlacement {
  t: SizedTree;
  x: number;
  y: number;
}

/**
 * Radial mindmap layout: single root at the center, descendants on rings at
 * `depth * ringGap`, each subtree confined to an angular wedge sized by its
 * leaf count. Multiple roots share the first ring around an invisible hub.
 */
export function layoutMindmap(
  roots: TreeNode[],
  opts: RadialLayoutOptions = {},
): DiagramLayout {
  /* The former 130px rings made even a small, nine-node mind map more than
     600px wide. The page then scaled its nominal 14px labels to about 9px.
     Sixty-eight pixels leaves clear angular lanes for ordinary node boxes and
     fits the same useful specimen near native size in a default leaf. */
  const ringGap = opts.ringGap ?? 68;
  const margin = opts.margin ?? 10;

  const sized = roots.map((root, i) =>
    buildSized(root, String(i), undefined, 0, 24, opts.measure),
  );
  if (sized.length === 0) {
    return { nodes: [], edges: [], width: 2 * margin, height: 2 * margin, warnings: [] };
  }

  const placements: RadialPlacement[] = [];
  const edges: LaidEdge[] = [];

  // Forest mode pushes every ring out by one (roots occupy ring 1).
  const depthOffset = sized.length > 1 ? 1 : 0;

  // Place `t`'s children inside [a0, a1) radians; t itself is already placed.
  const placeChildren = (t: SizedTree, a0: number, a1: number): void => {
    const totalLeaves = t.children.reduce((sum, c) => sum + c.leaves, 0);
    if (totalLeaves === 0) return;
    let angle = a0;
    for (const child of t.children) {
      const span = ((a1 - a0) * child.leaves) / totalLeaves;
      const mid = angle + span / 2;
      const r = (child.depth + depthOffset) * ringGap;
      const x = Math.cos(mid) * r;
      const y = Math.sin(mid) * r;
      placements.push({ t: child, x, y });
      edges.push({ from: t.id, to: child.id, points: [] });
      placeChildren(child, angle, angle + span);
      angle += span;
    }
  };

  if (sized.length === 1) {
    const root = sized[0];
    placements.push({ t: root, x: 0, y: 0 });
    placeChildren(root, -Math.PI / 2, (3 * Math.PI) / 2);
  } else {
    // Forest: roots share ring 1 around an invisible hub. Give each root a
    // wedge by leaf weight; its subtree fans outward inside that wedge.
    const totalLeaves = sized.reduce((sum, t) => sum + t.leaves, 0);
    let angle = -Math.PI / 2;
    for (const root of sized) {
      const span = (2 * Math.PI * root.leaves) / totalLeaves;
      const mid = angle + span / 2;
      placements.push({
        t: root,
        x: Math.cos(mid) * ringGap,
        y: Math.sin(mid) * ringGap,
      });
      placeChildren(root, angle, angle + span);
      angle += span;
    }
  }

  // Normalize to positive coordinates.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    minX = Math.min(minX, p.x - p.t.w / 2);
    minY = Math.min(minY, p.y - p.t.h / 2);
    maxX = Math.max(maxX, p.x + p.t.w / 2);
    maxY = Math.max(maxY, p.y + p.t.h / 2);
  }
  const dx = margin - minX;
  const dy = margin - minY;

  const nodes: LaidNode[] = placements.map((p) => ({
    id: p.t.id,
    label: p.t.node.label,
    x: p.x + dx,
    y: p.y + dy,
    width: p.t.w,
    height: p.t.h,
    depth: p.t.depth,
    ...(p.t.node.note !== undefined ? { note: p.t.node.note } : {}),
    ...(p.t.node.attrs !== undefined ? { attrs: p.t.node.attrs } : {}),
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from && to) {
      edge.points = [
        { x: from.x, y: from.y },
        { x: to.x, y: to.y },
      ];
    }
  }

  return {
    nodes,
    edges,
    width: maxX + dx + margin,
    height: maxY + dy + margin,
    warnings: [],
  };
}
