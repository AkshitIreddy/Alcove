/**
 * src/diagrams/render/NodeShape.tsx — one laid-out node as hand-drawn SVG.
 *
 * Draws (bottom → top): offset paper shadow (filter-free depth), wash fill,
 * pencil double-stroke outline, then the Architects Daughter label. The
 * wobble seed derives from the node's id + label so every node keeps its
 * exact hand tremor across re-layouts and re-mounts.
 */

import { createMemo, Show, type JSX } from 'solid-js';
import type { Attrs } from '../../script/types';
import { TINT_ALL } from '../../editor/effects/vocabulary';
import { shapeOf } from '../layout/size';
import type { LaidNode } from '../types';
import { nodeSeed, shapeStrokes } from './svgParts';

/**
 * Resolve the complete stationer's tint catalogue for diagram nodes.
 *
 * Diagrams originally predated the fifty-pigment colour shelf and checked
 * only the seven legacy washes. The parser therefore accepted values such as
 * `forest` and `coral`, while this last renderer boundary silently flattened
 * them to paper.
 */
export function washOf(attrs: Attrs | undefined): string | 'paper' {
  const raw = attrs?.color;
  return typeof raw === 'string' && TINT_ALL.includes(raw) ? raw : 'paper';
}

export interface NodeShapeProps {
  node: LaidNode;
  /** Seed scope — diagram kind, so tree node 0.1 ≠ graph node 0.1. */
  scope: string;
}

export function NodeShape(props: NodeShapeProps): JSX.Element {
  const seed = createMemo(() =>
    nodeSeed(props.scope, `${props.node.id}|${props.node.label}`),
  );
  const strokes = createMemo(() =>
    shapeStrokes(
      shapeOf(props.node.attrs),
      props.node.width,
      props.node.height,
      seed(),
    ),
  );
  const left = (): number => props.node.x - props.node.width / 2;
  const top = (): number => props.node.y - props.node.height / 2;
  const labelY = (): number =>
    props.node.note !== undefined
      ? props.node.height / 2 - 8
      : props.node.height / 2;
  const wash = createMemo(() => washOf(props.node.attrs));

  return (
    <g
      class="nb-dg-node"
      data-wash={wash()}
      data-color={wash() === 'paper' ? undefined : wash()}
      data-shape={shapeOf(props.node.attrs)}
      transform={`translate(${left()}, ${top()})`}
    >
      <path
        class="nb-dg-shadow"
        d={strokes().fill}
        transform="translate(2.5, 3.5)"
      />
      <path class="nb-dg-fill" d={strokes().fill} />
      <path class="nb-dg-stroke" d={strokes().passes[0]} />
      <path class="nb-dg-stroke is-second" d={strokes().passes[1]} />
      <text
        class="nb-dg-label"
        x={props.node.width / 2}
        y={labelY()}
        text-anchor="middle"
        dominant-baseline="central"
      >
        {props.node.label}
      </text>
      <Show when={props.node.note !== undefined}>
        <text
          class="nb-dg-note"
          x={props.node.width / 2}
          y={props.node.height / 2 + 10}
          text-anchor="middle"
          dominant-baseline="central"
        >
          {props.node.note}
        </text>
      </Show>
    </g>
  );
}
