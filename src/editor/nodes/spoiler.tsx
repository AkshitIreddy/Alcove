/**
 * Spoiler block — content stays blurred until clicked ("psst… click to
 * reveal"). Node name matches the script container name 'spoiler' verbatim
 * so the script bridge wires it automatically.
 *
 * Reveal state is ephemeral UI state (a Solid signal) — persisting it would
 * dirty the document for a purely visual toggle. The blur is pure CSS
 * (effects.css) keyed off the `is-revealed` class.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { createSignal, type JSX } from 'solid-js';
import {
  NodeViewContent,
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';

function SpoilerView(props: SolidNodeViewProps): JSX.Element {
  const [revealed, setRevealed] = createSignal(false);

  return (
    <NodeViewWrapper
      class="nb-spoiler"
      classList={{ 'is-revealed': revealed(), 'is-selected': props.selected }}
    >
      <button
        type="button"
        class="nb-spoiler-toggle"
        contenteditable={false}
        aria-expanded={revealed()}
        data-tooltip={revealed() ? 'Hide again' : 'Reveal'}
        onClick={() => setRevealed(!revealed())}
      >
        {revealed() ? 'shh — hide again' : 'psst… click to reveal'}
      </button>
      <NodeViewContent class="nb-spoiler-body" />
    </NodeViewWrapper>
  );
}

export const Spoiler = Node.create({
  name: 'spoiler',

  group: 'block',

  content: 'block+',

  defining: true,

  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="spoiler"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'spoiler' }),
      0,
    ];
  },

  addNodeView() {
    return SolidNodeViewRenderer(SpoilerView, {
      // Keep toggle clicks away from ProseMirror so they never turn into
      // node selections or caret moves.
      stopEvent: ({ event }) => {
        const target = event.target;
        return (
          target instanceof Element &&
          target.closest('.nb-spoiler-toggle') !== null
        );
      },
    });
  },
});
