/**
 * src/diagrams/layout/graph.ts — layered DAG layout for graph/flowchart.
 *
 * Pipeline: cycle detection (DFS, back-edges dropped from layering with a
 * warning) → longest-path layering → median-ordering sweeps → per-layer
 * horizontal packing. Edges come out as straight 2-point polylines the
 * renderer wobbles. Graphs whose edges are mostly cyclic fall back to a
 * deterministic seeded force layout.
 *
 * Pure and deterministic: no DOM, no Math.random (mulberry32 only).
 */

import { fnv1a, mulberry32 } from '../../art/noise';
import type { Graph } from '../../script/types';
import type { TextMeasurer } from '../measure';
import type { DiagramLayout, DiagramPoint, LaidEdge, LaidNode } from '../types';
import { nodeBox } from './size';

export interface GraphLayoutOptions {
  measure?: TextMeasurer;
  /** Horizontal gap between nodes in a layer (px). */
  gapX?: number;
  /** Vertical gap between layers (px). */
  gapY?: number;
  margin?: number;
  /** Force the fallback layout (used by tests). */
  forceMode?: boolean;
}

interface SizedNode {
  id: string;
  label: string;
  attrs?: LaidNode['attrs'];
  w: number;
  h: number;
  index: number;
}

// ---------------------------------------------------------------------------
// Cycle breaking
// ---------------------------------------------------------------------------

interface EdgeRef {
  from: string;
  to: string;
  label?: string;
  index: number;
  broken: boolean;
  selfLoop: boolean;
}

/** DFS over insertion order; edges closing a cycle are flagged `broken`. */
function markBackEdges(ids: string[], edges: EdgeRef[]): number {
  const out = new Map<string, EdgeRef[]>();
  for (const id of ids) out.set(id, []);
  for (const e of edges) {
    if (e.selfLoop) continue;
    out.get(e.from)?.push(e);
  }
  const state = new Map<string, 0 | 1 | 2>(); // 0 unvisited, 1 on stack, 2 done
  for (const id of ids) state.set(id, 0);
  let broken = 0;

  const visit = (id: string): void => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to);
      if (s === 1) {
        e.broken = true;
        broken++;
      } else if (s === 0) {
        visit(e.to);
      }
    }
    state.set(id, 2);
  };

  for (const id of ids) {
    if (state.get(id) === 0) visit(id);
  }
  return broken;
}

// ---------------------------------------------------------------------------
// Layered layout
// ---------------------------------------------------------------------------

function longestPathLayers(
  ids: string[],
  edges: EdgeRef[],
): Map<string, number> {
  const layer = new Map<string, number>();
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const id of ids) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const e of edges) {
    if (e.broken || e.selfLoop) continue;
    preds.get(e.to)?.push(e.from);
    succs.get(e.from)?.push(e.to);
  }
  // Kahn topological order over the acyclic edge set.
  const inDeg = new Map<string, number>();
  for (const id of ids) inDeg.set(id, (preds.get(id) ?? []).length);
  const queue = ids.filter((id) => inDeg.get(id) === 0);
  for (const id of queue) layer.set(id, 0);
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    const l = layer.get(id) ?? 0;
    for (const next of succs.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, l + 1));
      inDeg.set(next, (inDeg.get(next) ?? 1) - 1);
      if (inDeg.get(next) === 0) queue.push(next);
    }
  }
  // Anything unreached (shouldn't happen post cycle-break) lands on layer 0.
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);
  return layer;
}

function median(values: number[]): number {
  if (values.length === 0) return -1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A few median-ordering sweeps (down then up) to reduce crossings. */
function orderLayers(
  layers: string[][],
  edges: EdgeRef[],
): void {
  const active = edges.filter((e) => !e.broken && !e.selfLoop);
  const position = new Map<string, number>();
  const reindex = (): void => {
    for (const row of layers) row.forEach((id, i) => position.set(id, i));
  };
  reindex();

  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const rowIndices = down
      ? Array.from({ length: layers.length - 1 }, (_, i) => i + 1)
      : Array.from({ length: layers.length - 1 }, (_, i) => layers.length - 2 - i);
    for (const rowIndex of rowIndices) {
      const scored = layers[rowIndex].map((id, oldPos) => {
        const neighbors = active
          .filter((e) => (down ? e.to === id : e.from === id))
          .map((e) => position.get(down ? e.from : e.to) ?? -1)
          .filter((p) => p >= 0);
        const m = median(neighbors);
        return { id, key: m === -1 ? oldPos : m, oldPos };
      });
      scored.sort((a, b) => a.key - b.key || a.oldPos - b.oldPos);
      layers[rowIndex] = scored.map((s) => s.id);
      reindex();
    }
  }
}

// ---------------------------------------------------------------------------
// Edge anchoring
// ---------------------------------------------------------------------------

function anchor(from: LaidNode, to: LaidNode): DiagramPoint[] {
  if (Math.abs(to.y - from.y) < 1) {
    // Same row: connect facing sides.
    const dir = to.x >= from.x ? 1 : -1;
    return [
      { x: from.x + (dir * from.width) / 2, y: from.y },
      { x: to.x - (dir * to.width) / 2, y: to.y },
    ];
  }
  if (to.y > from.y) {
    return [
      { x: from.x, y: from.y + from.height / 2 },
      { x: to.x, y: to.y - to.height / 2 },
    ];
  }
  return [
    { x: from.x, y: from.y - from.height / 2 },
    { x: to.x, y: to.y + to.height / 2 },
  ];
}

/** Little lasso to the right of a node for `A -> A`. */
function selfLoopPoints(n: LaidNode): DiagramPoint[] {
  const r = 18;
  const x = n.x + n.width / 2;
  return [
    { x, y: n.y - 8 },
    { x: x + r, y: n.y - r * 0.9 },
    { x: x + r * 1.35, y: n.y },
    { x: x + r, y: n.y + r * 0.9 },
    { x, y: n.y + 8 },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function layoutGraph(
  graph: Graph,
  opts: GraphLayoutOptions = {},
): DiagramLayout {
  const gapX = opts.gapX ?? 36;
  const gapY = opts.gapY ?? 56;
  const margin = opts.margin ?? 16;
  const warnings: string[] = [];

  const sized: SizedNode[] = graph.nodes.map((n, index) => {
    const box = nodeBox(n.label ?? n.id, undefined, n.attrs, {
      measure: opts.measure,
    });
    return {
      id: n.id,
      label: n.label ?? n.id,
      w: box.width,
      h: box.height,
      index,
      ...(n.attrs !== undefined ? { attrs: n.attrs } : {}),
    };
  });
  if (sized.length === 0) {
    return { nodes: [], edges: [], width: 2 * margin, height: 2 * margin, warnings };
  }
  const ids = sized.map((s) => s.id);
  const byIdSized = new Map(sized.map((s) => [s.id, s]));

  const edgeRefs: EdgeRef[] = graph.edges
    .filter((e) => byIdSized.has(e.from) && byIdSized.has(e.to))
    .map((e, index) => ({
      from: e.from,
      to: e.to,
      index,
      broken: false,
      selfLoop: e.from === e.to,
      ...(e.label !== undefined ? { label: e.label } : {}),
    }));
  if (edgeRefs.length < graph.edges.length) {
    warnings.push('some edges reference unknown nodes and were dropped');
  }

  const brokenCount = markBackEdges(ids, edgeRefs);
  for (const e of edgeRefs) {
    if (e.broken) warnings.push(`cycle broken at ${e.from} -> ${e.to}`);
  }

  const realEdges = edgeRefs.filter((e) => !e.selfLoop).length;
  const useForce =
    opts.forceMode === true ||
    (brokenCount > 0 && realEdges > 0 && brokenCount * 2 >= realEdges);

  let nodes: LaidNode[];
  if (useForce) {
    if (opts.forceMode !== true) {
      warnings.push('graph is mostly cyclic — using force layout');
    }
    nodes = forcePlace(sized, edgeRefs, margin);
  } else {
    nodes = layeredPlace(sized, edgeRefs, gapX, gapY, margin);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LaidEdge[] = edgeRefs.map((e) => {
    const from = byId.get(e.from)!;
    const to = byId.get(e.to)!;
    return {
      from: e.from,
      to: e.to,
      points: e.selfLoop ? selfLoopPoints(from) : anchor(from, to),
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.broken ? { broken: true } : {}),
    };
  });

  let width = 0;
  let height = 0;
  for (const n of nodes) {
    width = Math.max(width, n.x + n.width / 2 + margin);
    height = Math.max(height, n.y + n.height / 2 + margin);
  }
  // Self-loops poke out to the right of their node.
  for (const e of edges) {
    for (const p of e.points) width = Math.max(width, p.x + margin);
  }
  return { nodes, edges, width, height, warnings };
}

function layeredPlace(
  sized: SizedNode[],
  edgeRefs: EdgeRef[],
  gapX: number,
  gapY: number,
  margin: number,
): LaidNode[] {
  const ids = sized.map((s) => s.id);
  const byId = new Map(sized.map((s) => [s.id, s]));
  const layerOf = longestPathLayers(ids, edgeRefs);

  const layerCount = Math.max(...ids.map((id) => layerOf.get(id) ?? 0)) + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const s of sized) layers[layerOf.get(s.id) ?? 0].push(s.id);
  orderLayers(layers, edgeRefs);

  // Row geometry.
  const rowH = layers.map((row) =>
    Math.max(...row.map((id) => byId.get(id)!.h)),
  );
  const rowW = layers.map(
    (row) =>
      row.reduce((sum, id) => sum + byId.get(id)!.w, 0) +
      gapX * Math.max(0, row.length - 1),
  );
  const maxRowW = Math.max(...rowW);

  const nodes: LaidNode[] = [];
  let y = margin;
  layers.forEach((row, li) => {
    let x = margin + (maxRowW - rowW[li]) / 2;
    const cy = y + rowH[li] / 2;
    for (const id of row) {
      const s = byId.get(id)!;
      nodes.push({
        id: s.id,
        label: s.label,
        x: x + s.w / 2,
        y: cy,
        width: s.w,
        height: s.h,
        depth: li,
        ...(s.attrs !== undefined ? { attrs: s.attrs } : {}),
      });
      x += s.w + gapX;
    }
    y += rowH[li] + gapY;
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// Seeded force fallback (deterministic)
// ---------------------------------------------------------------------------

function forcePlace(
  sized: SizedNode[],
  edgeRefs: EdgeRef[],
  margin: number,
): LaidNode[] {
  const n = sized.length;
  const rnd = mulberry32(fnv1a(sized.map((s) => s.id).join(' ')));
  const spread = Math.max(220, 90 * Math.sqrt(n));

  // Initial ring + seeded jitter.
  const px = new Array<number>(n);
  const py = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    px[i] = Math.cos(a) * spread * 0.5 + (rnd() - 0.5) * 40;
    py[i] = Math.sin(a) * spread * 0.5 + (rnd() - 0.5) * 40;
  }

  const index = new Map(sized.map((s, i) => [s.id, i]));
  const springs = edgeRefs
    .filter((e) => !e.selfLoop)
    .map((e) => [index.get(e.from)!, index.get(e.to)!] as const);

  const k = spread / Math.max(1, Math.sqrt(n));
  for (let iter = 0; iter < 160; iter++) {
    const fx = new Array<number>(n).fill(0);
    const fy = new Array<number>(n).fill(0);
    // Pairwise repulsion.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = px[i] - px[j];
        let dy = py[i] - py[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = 0.1 + ((i * 13 + j) % 7) * 0.03;
          dy = 0.1;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const rep = (k * k) / d;
        fx[i] += (dx / d) * rep;
        fy[i] += (dy / d) * rep;
        fx[j] -= (dx / d) * rep;
        fy[j] -= (dy / d) * rep;
      }
    }
    // Spring attraction.
    for (const [a, b] of springs) {
      const dx = px[a] - px[b];
      const dy = py[a] - py[b];
      const d = Math.max(0.1, Math.hypot(dx, dy));
      const att = (d * d) / k;
      fx[a] -= (dx / d) * att * 0.5;
      fy[a] -= (dy / d) * att * 0.5;
      fx[b] += (dx / d) * att * 0.5;
      fy[b] += (dy / d) * att * 0.5;
    }
    const temp = Math.max(2, spread * 0.1 * (1 - iter / 160));
    for (let i = 0; i < n; i++) {
      const d = Math.max(0.1, Math.hypot(fx[i], fy[i]));
      const step = Math.min(d, temp);
      px[i] += (fx[i] / d) * step;
      py[i] += (fy[i] / d) * step;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, px[i] - sized[i].w / 2);
    minY = Math.min(minY, py[i] - sized[i].h / 2);
  }
  return sized.map((s, i) => ({
    id: s.id,
    label: s.label,
    x: px[i] - minX + margin,
    y: py[i] - minY + margin,
    width: s.w,
    height: s.h,
    depth: 0,
    ...(s.attrs !== undefined ? { attrs: s.attrs } : {}),
  }));
}
