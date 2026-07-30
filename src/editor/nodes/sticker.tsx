/**
 * Sticker — an inline atom rendering one of the 8 procedural hand-drawn SVG
 * stickers (see stickers.ts). Attrs: { stickerId, scale, rotate }.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import type { JSX } from 'solid-js';
import {
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';
import { isStickerId, stickerSvg, type StickerId } from './stickers';

export interface StickerAttributes {
  stickerId: StickerId;
  /** Multiplier on the 28px base size, clamped 0.5..3. */
  scale: number;
  /** Rotation in degrees, small tilts read as hand-placed. */
  rotate: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sticker: {
      /** Insert a sticker at the current position. */
      insertSticker: (attrs: Partial<StickerAttributes> & { stickerId: StickerId }) => ReturnType;
    };
  }
}

const BASE_SIZE_PX = 28;

function clampScale(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(3, Math.max(0.5, parsed));
}

function clampRotate(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(180, Math.max(-180, parsed));
}

function StickerView(props: SolidNodeViewProps): JSX.Element {
  const stickerId = (): StickerId => {
    const value: unknown = props.node.attrs.stickerId;
    return isStickerId(value) ? value : 'star';
  };
  const sizePx = (): number =>
    Math.round(BASE_SIZE_PX * clampScale(props.node.attrs.scale));
  const rotate = (): number => clampRotate(props.node.attrs.rotate);

  return (
    <NodeViewWrapper
      class="nb-sticker"
      classList={{ 'is-selected': props.selected }}
      data-sticker={stickerId()}
    >
      <span
        class="nb-sticker-box"
        style={{
          width: `${sizePx()}px`,
          height: `${sizePx()}px`,
          transform: `rotate(${rotate()}deg)`,
        }}
        innerHTML={stickerSvg(stickerId())}
      />
    </NodeViewWrapper>
  );
}

export const Sticker = Node.create({
  name: 'sticker',

  inline: true,

  group: 'inline',

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      stickerId: {
        default: 'star' satisfies StickerId,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-sticker-id');
          return isStickerId(raw) ? raw : 'star';
        },
        renderHTML: (attributes) => ({
          'data-sticker-id': String(attributes.stickerId),
        }),
      },
      scale: {
        default: 1,
        parseHTML: (element) => clampScale(element.getAttribute('data-scale')),
        renderHTML: (attributes) => ({ 'data-scale': String(attributes.scale) }),
      },
      rotate: {
        default: 0,
        parseHTML: (element) => clampRotate(element.getAttribute('data-rotate')),
        renderHTML: (attributes) => ({ 'data-rotate': String(attributes.rotate) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="sticker"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'sticker' })];
  },

  addCommands() {
    return {
      insertSticker:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(StickerView);
  },
});
