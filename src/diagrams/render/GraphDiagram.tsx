/**
 * src/diagrams/render/GraphDiagram.tsx — graph/flowchart renderer: layered
 * DAG layout, wobbly straight edges with drawn-V arrowheads.
 */

import { createMemo, For, Show, type JSX } from 'solid-js';
import type { Graph } from '../../script/types';
import { graphLayerBreaks } from '../../editor/nodes/diagramPagination';
import { layoutGraph } from '../layout/graph';
import { EdgeStroke } from './EdgeStroke';
import { NodeShape } from './NodeShape';

export interface GraphDiagramProps {
  graph: Graph;
  kind: 'graph' | 'flowchart';
  /** Intrinsic SVG y-window used by fixed-page continuation fragments. */
  continuationStart?: number | null;
  continuationEnd?: number | null;
}

export function GraphDiagram(props: GraphDiagramProps): JSX.Element {
  const layout = createMemo(() => layoutGraph(props.graph));
  const viewport = createMemo(() => {
    const full = layout().height;
    const start =
      typeof props.continuationStart === 'number' &&
      Number.isFinite(props.continuationStart)
        ? Math.max(0, Math.min(props.continuationStart, full))
        : 0;
    const end =
      typeof props.continuationEnd === 'number' &&
      Number.isFinite(props.continuationEnd)
        ? Math.max(start, Math.min(props.continuationEnd, full))
        : full;
    return { start, end, height: Math.max(1, end - start), full };
  });
  const pageBreaks = createMemo(() => graphLayerBreaks(layout().nodes));
  const continued = createMemo(
    () => viewport().start > 0 || viewport().end < viewport().full,
  );

  return (
    <svg
      class="nb-dg-svg"
      classList={{ 'is-continuation': continued() }}
      viewBox={`0 ${viewport().start} ${layout().width} ${viewport().height}`}
      style={{ 'max-width': `${layout().width}px` }}
      data-diagram-intrinsic-height={layout().height}
      data-diagram-page-breaks={JSON.stringify(pageBreaks())}
      data-diagram-slice-start={viewport().start}
      data-diagram-slice-end={viewport().end}
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
