/**
 * src/diagrams/types.ts — shared types for the hand-drawn diagram renderers.
 *
 * Layout modules (layout/*) are pure: script diagram ASTs in, positioned
 * boxes out. Render modules (render/*) turn layouts into wobbly SVG.
 */

import type { Attrs, Graph, TimelineEntry, TreeNode } from '../script/types';

/** The diagram kinds the block node can host (mirrors script DiagramLang). */
export const DIAGRAM_KINDS = [
  'tree',
  'mindmap',
  'graph',
  'flowchart',
  'timeline',
] as const;

export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

export function isDiagramKind(value: unknown): value is DiagramKind {
  return (
    typeof value === 'string' &&
    (DIAGRAM_KINDS as readonly string[]).includes(value)
  );
}

/** Parsed diagram payload stored (JSON-stringified) in the node's `data` attr. */
export type DiagramData =
  | { kind: 'tree' | 'mindmap'; roots: TreeNode[] }
  | { kind: 'graph' | 'flowchart'; graph: Graph }
  | { kind: 'timeline'; entries: TimelineEntry[] };

/** Node shapes drawable by the renderer (`{shape=...}` attr). */
export const DIAGRAM_SHAPES = ['rect', 'cloud', 'circle'] as const;
export type DiagramShape = (typeof DIAGRAM_SHAPES)[number];

export function isDiagramShape(value: unknown): value is DiagramShape {
  return (
    typeof value === 'string' &&
    (DIAGRAM_SHAPES as readonly string[]).includes(value)
  );
}

/** Wash tints available for `{color=...}` (graphite = plain paper). */
export const DIAGRAM_WASHES = [
  'amber',
  'terracotta',
  'moss',
  'lemon',
  'sky',
  'blush',
  'plum',
  'graphite',
] as const;

export type DiagramWash = (typeof DIAGRAM_WASHES)[number];

export function isDiagramWash(value: unknown): value is DiagramWash {
  return (
    typeof value === 'string' &&
    (DIAGRAM_WASHES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Laid-out geometry
// ---------------------------------------------------------------------------

export interface DiagramPoint {
  x: number;
  y: number;
}

/** One positioned node box (x/y are the CENTER of the box). */
export interface LaidNode {
  /** Stable identity — tree path (`0.1.2`) or graph node id. */
  id: string;
  label: string;
  /** Optional second line (tree `label | note`). */
  note?: string;
  attrs?: Attrs;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface LaidEdge {
  from: string;
  to: string;
  label?: string;
  /** Polyline from source anchor to target anchor (≥ 2 points). */
  points: DiagramPoint[];
  /** True when this edge closed a cycle and was ignored for layering. */
  broken?: boolean;
}

export interface DiagramLayout {
  nodes: LaidNode[];
  edges: LaidEdge[];
  width: number;
  height: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Timeline layout (its own shape — spine + cards, no node/edge graph)
// ---------------------------------------------------------------------------

export interface LaidTimelineCard {
  index: number;
  side: 'left' | 'right';
  label: string;
  /** Body text wrapped into lines by the measurer. */
  textLines: string[];
  attrs?: Attrs;
  /** Card box (x/y = top-left corner). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the connector meets the spine. */
  dotY: number;
}

export interface TimelineLayout {
  spineX: number;
  cards: LaidTimelineCard[];
  width: number;
  height: number;
  warnings: string[];
}
