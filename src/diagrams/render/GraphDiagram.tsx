/**
 * src/diagrams/render/GraphDiagram.tsx — graph/flowchart renderer: layered
 * DAG layout, wobbly straight edges with drawn-V arrowheads.
 */

import { createMemo, For, Show, type JSX } from 'solid-js';
import type { Graph } from '../../script/types';
import { layoutGraph } from '../layout/graph';
import { EdgeStroke } from './EdgeStroke';
import { NodeShape } from './NodeShape';

export interface GraphDiagramProps {
  graph: Graph;
  kind: 'graph' | 'flowchart';
}

export function GraphDiagram(props: GraphDiagramProps): JSX.Element {
  const layout = createMemo(() => layoutGraph(props.graph));

  return (
    <svg
      class="nb-dg-svg"
      viewBox={`0 0 ${layout().width} ${layout().height}`}
      style={{ 'max-width': `${layout().width}px` }}
      role="img"
    >
      <For each={layout().edges}>
        {(edge) => <EdgeStroke edge={edge} scope={props.kind} />}
      </For>
      <For each={layout().nodes}>
        {(node) => <NodeShape node={node} scope={props.kind} />}
      </For>
      <Show when={layout().warnings.length > 0}>
        <title>{layout().warnings.join('; ')}</title>
      </Show>
    </svg>
  );
}
