/**
 * Callout block — a watercolor-washed aside with a sticker icon.
 *
 * Attrs: { id (UniqueID), icon: StickerId, tint: CalloutTint }.
 * The wash background is pure CSS (layered gradients in editor.css) — no
 * runtime SVG filters. Clicking the icon cycles stickers; the small dot in
 * the corner cycles the tint.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import type { JSX } from 'solid-js';
import {
  NodeViewContent,
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';
import { STICKER_IDS, isStickerId, stickerSvg, type StickerId } from './stickers';

export const CALLOUT_TINTS = [
  'amber',
  'terracotta',
  'moss',
  'lemon',
  'sky',
  'blush',
] as const;

export type CalloutTint = (typeof CALLOUT_TINTS)[number];

function isCalloutTint(value: unknown): value is CalloutTint {
  return (
    typeof value === 'string' && (CALLOUT_TINTS as readonly string[]).includes(value)
  );
}

export interface CalloutAttributes {
  icon: StickerId;
  tint: CalloutTint;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selection in a callout. */
      setCallout: (attrs?: Partial<CalloutAttributes>) => ReturnType;
      /** Wrap in / lift out of a callout. */
      toggleCallout: (attrs?: Partial<CalloutAttributes>) => ReturnType;
    };
  }
}

function next<T>(list: readonly T[], current: T): T {
  const index = list.indexOf(current);
  return list[(index + 1) % list.length];
}

function CalloutView(props: SolidNodeViewProps): JSX.Element {
  const icon = (): StickerId => {
    const value: unknown = props.node.attrs.icon;
    return isStickerId(value) ? value : 'leaf';
  };
  const tint = (): CalloutTint => {
    const value: unknown = props.node.attrs.tint;
    return isCalloutTint(value) ? value : 'amber';
  };

  return (
    <NodeViewWrapper class="nb-callout" data-tint={tint()}>
      <button
        type="button"
        class="nb-callout-icon"
        contenteditable={false}
        title="Change icon"
        aria-label={`Callout icon: ${icon()} — click to change`}
        innerHTML={stickerSvg(icon())}
        onClick={() => props.updateAttributes({ icon: next(STICKER_IDS, icon()) })}
      />
      <button
        type="button"
        class="nb-callout-tint"
        contenteditable={false}
        title="Change wash color"
        aria-label={`Callout wash: ${tint()} — click to change`}
        onClick={() => props.updateAttributes({ tint: next(CALLOUT_TINTS, tint()) })}
      />
      <NodeViewContent class="nb-callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: 'callout',

  group: 'block',

  content: 'paragraph+',

  defining: true,

  addAttributes() {
    return {
      icon: {
        default: 'leaf' satisfies StickerId,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-icon');
          return isStickerId(raw) ? raw : 'leaf';
        },
        renderHTML: (attributes) => ({ 'data-icon': String(attributes.icon) }),
      },
      tint: {
        default: 'amber' satisfies CalloutTint,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-tint');
          return isCalloutTint(raw) ? raw : 'amber';
        },
        renderHTML: (attributes) => ({ 'data-tint': String(attributes.tint) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attrs),
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(CalloutView);
  },
});
