/**
 * ImageRow block — 1-4 images side by side in a flex row.
 *
 * Child image nodes carry a `widthPct` attribute (rendered as flex-basis by
 * the extended Image extension in extensions.ts); images without one share
 * the remaining space evenly. Drag-to-resize dividers arrive with the media
 * pass alongside paste/drag-drop.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import type { JSX } from 'solid-js';
import {
  NodeViewContent,
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageRow: {
      /** Insert an image row with the given image sources. */
      insertImageRow: (sources: readonly string[]) => ReturnType;
    };
  }
}

function ImageRowView(props: SolidNodeViewProps): JSX.Element {
  return (
    <NodeViewWrapper
      class="nb-image-row"
      classList={{ 'is-selected': props.selected }}
      data-count={props.node.childCount}
    >
      <NodeViewContent class="nb-image-row-track" />
    </NodeViewWrapper>
  );
}

export const ImageRow = Node.create({
  name: 'imageRow',

  group: 'block',

  content: 'image{1,4}',

  draggable: true,

  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="image-row"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'image-row' }),
      0,
    ];
  },

  addCommands() {
    return {
      insertImageRow:
        (sources) =>
        ({ commands }) => {
          const images = sources.slice(0, 4).map((src) => ({
            type: 'image',
            attrs: { src },
          }));
          if (images.length === 0) return false;
          return commands.insertContent({ type: this.name, content: images });
        },
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(ImageRowView);
  },
});
