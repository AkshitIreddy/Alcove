/**
 * src/diagrams/render/DiagramRenderer.tsx — dispatch a DiagramData payload
 * to the right hand-drawn renderer.
 */

import type { JSX } from 'solid-js';
import type { DiagramData } from '../types';
import { GraphDiagram } from './GraphDiagram';
import { TimelineDiagram } from './TimelineDiagram';
import { TreeDiagram } from './TreeDiagram';

export interface DiagramRendererProps {
  data: DiagramData;
}

export function DiagramRenderer(props: DiagramRendererProps): JSX.Element {
  // The JSX expression child is compiled to a reactive computation, so
  // reading props.data here re-dispatches whenever the payload changes.
  return (
    <>
      {((): JSX.Element => {
        const d = props.data;
        switch (d.kind) {
          case 'tree':
          case 'mindmap':
            return <TreeDiagram roots={d.roots} kind={d.kind} />;
          case 'graph':
          case 'flowchart':
            return <GraphDiagram graph={d.graph} kind={d.kind} />;
          case 'timeline':
            return <TimelineDiagram entries={d.entries} />;
        }
      })()}
    </>
  );
}
