/**
 * src/diagrams/render/TreeDiagram.tsx — tree (tidy top-down) and mindmap
 * (radial) renderers over the same TreeNode AST.
 */

import { createMemo, For, type JSX } from 'solid-js';
import type { TreeNode } from '../../script/types';
import { layoutMindmap, layoutTree } from '../layout/tree';
import { EdgeStroke } from './EdgeStroke';
import { NodeShape } from './NodeShape';

export interface TreeDiagramProps {
  roots: TreeNode[];
  kind: 'tree' | 'mindmap';
}

export function TreeDiagram(props: TreeDiagramProps): JSX.Element {
  const layout = createMemo(() =>
    props.kind === 'mindmap'
      ? layoutMindmap(props.roots)
      : layoutTree(props.roots),
  );

  return (
    <svg
      class="nb-dg-svg"
      viewBox={`0 0 ${layout().width} ${layout().height}`}
      style={{ 'max-width': `${layout().width}px` }}
      role="img"
    >
      <For each={layout().edges}>
        {(edge) => (
          <EdgeStroke edge={edge} scope={props.kind} arrow={false} />
        )}
      </For>
      <For each={layout().nodes}>
        {(node) => <NodeShape node={node} scope={props.kind} />}
      </For>
    </svg>
  );
}
