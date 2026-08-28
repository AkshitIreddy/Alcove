/**
 * Pure continuation contract for graph/flowchart atoms that are taller than
 * one fixed-height page.
 *
 * The diagram's authored `data` remains complete in every fragment. A
 * fragment is only a viewport onto that source (`continuationStart` →
 * `continuationEnd`, in the layout's intrinsic SVG coordinates). That keeps
 * the source editable and means page/export/offscreen renderers all draw the
 * same geometry instead of trying to reverse a clipped SVG back into a graph.
 */

export interface DiagramContinuationAttributes {
  readonly id?: string | null;
  readonly kind: unknown;
  readonly data: unknown;
  readonly width?: unknown;
  readonly continuationId?: string | null;
  readonly continuationStart?: number | null;
  readonly continuationEnd?: number | null;
  readonly [key: string]: unknown;
}

export interface DiagramContinuationPlan {
  readonly head: DiagramContinuationAttributes;
  readonly tail: DiagramContinuationAttributes;
  /** Intrinsic SVG y-coordinate at which the two page viewports meet. */
  readonly cut: number;
}

export interface DiagramContinuationMeasurement {
  readonly attrs: DiagramContinuationAttributes;
  /** Height of the complete graph layout, in SVG viewBox coordinates. */
  readonly intrinsicHeight: number;
  /** Drawn height of this fragment in layout/CSS pixels. */
  readonly renderedHeight: number;
  /** Viewport coordinates the measured SVG actually reports this frame. */
  readonly renderedStart?: number;
  readonly renderedEnd?: number;
  /** Drawn height remaining before the page fold. */
  readonly availableHeight: number;
  /** Whitespace y-coordinates between graph layers. */
  readonly safeBreaks: readonly number[];
  /** Smallest useful visible piece on either page, in drawn pixels. */
  readonly minimumFragmentHeight?: number;
}

export interface LayeredDiagramNode {
  readonly y: number;
  readonly height: number;
  readonly depth: number;
}

const DEFAULT_MINIMUM_FRAGMENT_HEIGHT = 96;
const EPSILON = 0.01;

export const DIAGRAM_CONTINUATION_EDIT_EVENT =
  'alcove:edit-diagram-continuation';

export interface DiagramContinuationEditDetail {
  readonly continuationId: string;
  readonly data: string;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function diagramGroup(attrs: DiagramContinuationAttributes): string | null {
  if (
    typeof attrs.continuationId === 'string' &&
    attrs.continuationId.trim() !== ''
  ) {
    return attrs.continuationId;
  }
  if (typeof attrs.id === 'string' && attrs.id.trim() !== '') return attrs.id;
  return null;
}

export function diagramContinuationGroup(
  attrs: DiagramContinuationAttributes,
): string | null {
  return diagramGroup(attrs);
}

/** Graph and flowchart share the layered renderer and are safe to segment. */
export function isSplittableDiagram(
  attrs: DiagramContinuationAttributes,
): boolean {
  return attrs.kind === 'graph' || attrs.kind === 'flowchart';
}

/**
 * Midpoints of the whitespace between adjacent graph ranks. A cut here may
 * bisect a connector (which continues naturally on the next sheet), but never
 * cuts a labelled node/card in half.
 */
export function graphLayerBreaks(
  nodes: readonly LayeredDiagramNode[],
): number[] {
  const bands = new Map<number, { top: number; bottom: number }>();
  for (const node of nodes) {
    if (!finite(node.y) || !positive(node.height) || !finite(node.depth)) {
      continue;
    }
    const top = node.y - node.height / 2;
    const bottom = node.y + node.height / 2;
    const band = bands.get(node.depth);
    if (band === undefined) bands.set(node.depth, { top, bottom });
    else {
      band.top = Math.min(band.top, top);
      band.bottom = Math.max(band.bottom, bottom);
    }
  }
  const ordered = [...bands.entries()].sort(([a], [b]) => a - b);
  const breaks: number[] = [];
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const current = ordered[index]?.[1];
    const next = ordered[index + 1]?.[1];
    if (current === undefined || next === undefined) continue;
    if (next.top > current.bottom + EPSILON) {
      breaks.push((current.bottom + next.top) / 2);
    }
  }
  if (breaks.length > 0 || nodes.length < 2) return breaks;

  // A mostly cyclic graph uses the deterministic force fallback and assigns
  // every node depth 0. It still has honest vertical whitespace. Merge the
  // nodes' y-intervals and use those gaps so a cyclic flowchart is not the one
  // chart pagination cannot help.
  const intervals = nodes
    .filter((node) => finite(node.y) && positive(node.height))
    .map((node) => ({
      top: node.y - node.height / 2,
      bottom: node.y + node.height / 2,
    }))
    .sort((a, b) => a.top - b.top);
  if (intervals.length < 2) return [];
  let band = { ...intervals[0]! };
  for (let index = 1; index < intervals.length; index += 1) {
    const next = intervals[index]!;
    if (next.top > band.bottom + EPSILON) {
      breaks.push((band.bottom + next.top) / 2);
      band = { ...next };
    } else {
      band.bottom = Math.max(band.bottom, next.bottom);
    }
  }
  return breaks;
}

function continuationNodeId(group: string, cut: number): string {
  // Intrinsic layout coordinates are deterministic for a graph payload. The
  // coordinate therefore makes a stable id across remounts and repeated
  // pagination passes without introducing random identity during layout.
  return `${group}__continuation_${Math.round(cut * 100)}`;
}

/**
 * Split one rendered fragment at the latest graph-layer gap that fits.
 *
 * Returning null deliberately means “move the whole fragment onward”. We do
 * not cut through a node merely to fill a small scrap at the bottom of a page.
 */
export function planDiagramContinuation(
  measurement: DiagramContinuationMeasurement,
): DiagramContinuationPlan | null {
  const {
    attrs,
    intrinsicHeight,
    renderedHeight,
    availableHeight,
    safeBreaks,
  } = measurement;
  if (!isSplittableDiagram(attrs)) return null;
  if (
    !positive(intrinsicHeight) ||
    !positive(renderedHeight) ||
    !positive(availableHeight)
  ) {
    return null;
  }
  const group = diagramGroup(attrs);
  if (group === null) return null;

  const start = finite(attrs.continuationStart)
    ? Math.max(0, Math.min(attrs.continuationStart, intrinsicHeight))
    : 0;
  const end = finite(attrs.continuationEnd)
    ? Math.max(start, Math.min(attrs.continuationEnd, intrinsicHeight))
    : intrinsicHeight;
  const span = end - start;
  if (span <= EPSILON) return null;

  /*
   * ProseMirror commits the new attrs synchronously; Solid can paint the
   * corresponding SVG viewBox a computation later. Measuring between those
   * two events pairs the OLD SVG height with the NEW attr span, inflating the
   * scale and repeatedly shaving one rank off an otherwise empty leaf. Do not
   * guess through that frame. ResizeObserver calls the drain again after the
   * SVG has caught up.
   */
  if (
    (finite(measurement.renderedStart) &&
      Math.abs(measurement.renderedStart - start) > EPSILON) ||
    (finite(measurement.renderedEnd) &&
      Math.abs(measurement.renderedEnd - end) > EPSILON)
  ) {
    return null;
  }

  const minimumDrawn = Math.max(
    1,
    measurement.minimumFragmentHeight ?? DEFAULT_MINIMUM_FRAGMENT_HEIGHT,
  );
  const drawnPerIntrinsic = renderedHeight / span;
  if (!positive(drawnPerIntrinsic)) return null;
  const minimumIntrinsic = minimumDrawn / drawnPerIntrinsic;
  const latestFit = start + availableHeight / drawnPerIntrinsic;
  const upper = Math.min(latestFit, end - minimumIntrinsic);
  const lower = start + minimumIntrinsic;
  if (upper + EPSILON < lower) return null;

  const candidates = [...safeBreaks]
    .filter(
      (value) =>
        finite(value) && value >= lower - EPSILON && value <= upper + EPSILON,
    )
    .sort((a, b) => a - b);
  const cut = candidates[candidates.length - 1];
  if (cut === undefined || cut <= start + EPSILON || cut >= end - EPSILON) {
    return null;
  }

  const common = {
    ...attrs,
    continuationId: group,
  };
  return {
    cut,
    head: {
      ...common,
      id: attrs.id ?? group,
      continuationStart: start,
      continuationEnd: cut,
    },
    tail: {
      ...common,
      id: continuationNodeId(group, cut),
      continuationStart: cut,
      continuationEnd: end,
    },
  };
}

interface JsonNode {
  readonly type?: unknown;
  readonly attrs?: unknown;
}

function nodeAttrs(value: unknown): DiagramContinuationAttributes | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const node = value as JsonNode;
  if (node.type !== 'diagram') return null;
  if (
    node.attrs === null ||
    typeof node.attrs !== 'object' ||
    Array.isArray(node.attrs)
  ) {
    return null;
  }
  return node.attrs as DiagramContinuationAttributes;
}

/**
 * Is a provisional backward-page spill only the tail created by splitting the
 * moved chart? Ordinary overflow remains an all-or-nothing rejection.
 */
export function isDiagramContinuationCarry(
  moved: readonly unknown[],
  carried: readonly unknown[],
): boolean {
  if (moved.length !== 1 || carried.length === 0) return false;
  const source = nodeAttrs(moved[0]);
  if (source === null || !isSplittableDiagram(source)) return false;
  const group = diagramGroup(source);
  if (group === null) return false;

  return carried.every((value) => {
    const attrs = nodeAttrs(value);
    return (
      attrs !== null &&
      isSplittableDiagram(attrs) &&
      attrs.continuationId === group &&
      finite(attrs.continuationStart) &&
      finite(attrs.continuationEnd) &&
      attrs.continuationEnd > attrs.continuationStart
    );
  });
}


interface JsonDoc {
  readonly type?: unknown;
  readonly attrs?: unknown;
  readonly content?: readonly unknown[];
}

export interface CollapsedDiagramContinuations {
  readonly docs: JsonDoc[];
  readonly changedIndices: number[];
}

/**
 * Reunite every viewport before applying a source edit. The earliest fragment
 * becomes the complete edited graph and later fragments disappear; normal
 * live pagination then derives a fresh set of cuts from the new layout.
 */
export function collapseDiagramContinuations(
  docs: readonly JsonDoc[],
  continuationId: string,
  data: string,
): CollapsedDiagramContinuations {
  if (continuationId.trim() === '') {
    return { docs: [...docs], changedIndices: [] };
  }
  let kept = false;
  const changedIndices: number[] = [];
  const next = docs.map((doc, docIndex): JsonDoc => {
    if (!Array.isArray(doc.content)) return doc;
    let changed = false;
    const content: unknown[] = [];
    for (const value of doc.content) {
      const attrs = nodeAttrs(value);
      if (attrs === null || attrs.continuationId !== continuationId) {
        content.push(value);
        continue;
      }
      changed = true;
      if (kept) continue;
      kept = true;
      const node = value as Record<string, unknown>;
      content.push({
        ...node,
        attrs: {
          ...attrs,
          id: continuationId,
          data,
          continuationId: null,
          continuationStart: null,
          continuationEnd: null,
        },
      });
    }
    if (!changed) return doc;
    changedIndices.push(docIndex);
    return { ...doc, content };
  });
  return { docs: next, changedIndices };
}
