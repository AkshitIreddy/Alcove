/**
 * src/diagrams/render/EdgeStroke.tsx — one laid-out edge as pencil strokes.
 *
 * Double-stroked wobbly segments with joint overshoot, an optional little
 * drawn-V arrowhead at the target end, and an optional label floating at the
 * midpoint on a paper halo (paint-order) so it stays readable over the line.
 */

import { createMemo, For, Index, Show, type JSX } from 'solid-js';
import type { LaidEdge } from '../types';
import {
  arrowheadStrokes,
  edgeStrokes,
  endAngle,
  nodeSeed,
} from './svgParts';

export interface EdgeStrokeProps {
  edge: LaidEdge;
  scope: string;
  /** Draw the V arrowhead at the target end (default true). */
  arrow?: boolean;
}

export function EdgeStroke(props: EdgeStrokeProps): JSX.Element {
  const seed = createMemo(() =>
    nodeSeed(props.scope, `edge|${props.edge.from}->${props.edge.to}`),
  );
  const strokes = createMemo(() => edgeStrokes(props.edge.points, seed()));
  const arrows = createMemo(() => {
    if (props.arrow === false) return [] as string[];
    const pts = props.edge.points;
    if (pts.length < 2) return [] as string[];
    return arrowheadStrokes(pts[pts.length - 1], endAngle(pts), seed());
  });
  const mid = createMemo(() => {
    const pts = props.edge.points;
    const a = pts[0];
    const b = pts[pts.length - 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });

  return (
    <g
      class="nb-dg-edge"
      classList={{ 'is-broken': props.edge.broken === true }}
    >
      <For each={strokes().passes}>
        {(d) => <path class="nb-dg-edge-stroke" d={d} />}
      </For>
      <Index each={arrows()}>
        {(d) => <path class="nb-dg-arrow" d={d()} />}
      </Index>
      <Show when={props.edge.label !== undefined}>
        <text
          class="nb-dg-edge-label"
          x={mid().x}
          y={mid().y - 6}
          text-anchor="middle"
        >
          {props.edge.label}
        </text>
      </Show>
    </g>
  );
}
