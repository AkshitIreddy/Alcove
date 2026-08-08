/** Local video block with the same resize/alignment grammar as pictures. */
import { Node, mergeAttributes } from '@tiptap/core';
import { Show, createSignal, type JSX } from 'solid-js';
import {
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';
import { IMAGE_ALIGNMENTS, clampWidthPct, type ImageAlign } from './imageView';

function isAlign(value: unknown): value is ImageAlign {
  return typeof value === 'string' &&
    (IMAGE_ALIGNMENTS as readonly string[]).includes(value);
}

function VideoView(props: SolidNodeViewProps): JSX.Element {
  const src = (): string =>
    typeof props.node.attrs.src === 'string' ? props.node.attrs.src : '';
  const align = (): ImageAlign =>
    isAlign(props.node.attrs.align) ? props.node.attrs.align : 'center';
  const widthPct = (): number | null =>
    typeof props.node.attrs.widthPct === 'number'
      ? clampWidthPct(props.node.attrs.widthPct)
      : null;
  const caption = (): string =>
    typeof props.node.attrs.caption === 'string' ? props.node.attrs.caption : '';

  const [liveWidth, setLiveWidth] = createSignal<number | null>(null);
  const effectiveWidth = (): number | null => liveWidth() ?? widthPct();
  let wrapper: HTMLElement | undefined;

  const startResize = (event: PointerEvent, direction: 1 | -1): void => {
    event.preventDefault();
    event.stopPropagation();
    const parent = wrapper?.parentElement;
    if (parent === null || parent === undefined || parent.clientWidth === 0) return;
    const startX = event.clientX;
    const start = effectiveWidth() ??
      ((wrapper?.clientWidth ?? parent.clientWidth) / parent.clientWidth) * 100;
    const move = (next: PointerEvent): void => {
      setLiveWidth(clampWidthPct(
        start + ((next.clientX - startX) * direction * 100) / parent.clientWidth,
      ));
    };
    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      const value = liveWidth();
      setLiveWidth(null);
      if (value !== null) props.updateAttributes({ widthPct: Math.round(value) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  const cycleAlign = (): void => {
    const next = (IMAGE_ALIGNMENTS.indexOf(align()) + 1) % IMAGE_ALIGNMENTS.length;
    props.updateAttributes({ align: IMAGE_ALIGNMENTS[next] });
  };

  return (
    <NodeViewWrapper
      ref={(element: HTMLElement) => {
        wrapper = element;
      }}
      class="nb-video"
      classList={{
        'is-selected': props.selected,
        'is-resizing': liveWidth() !== null,
      }}
      data-nb-block-flow="feature"
      data-align={align()}
      style={{
        width: effectiveWidth() === null ? undefined : `${effectiveWidth()}%`,
      }}
    >
      <figure class="nb-video-figure" contenteditable={false}>
        <video
          class="nb-video-player"
          src={src()}
          controls
          playsinline
          preload="metadata"
        />
        <Show when={props.selected}>
          <div class="nb-video-controls">
            <button
              type="button"
              class="nb-video-tool"
              data-tooltip={`Align: ${align()} — click to cycle`}
              aria-label={`Alignment ${align()}, click to cycle`}
              onClick={cycleAlign}
            >
              {align() === 'left' ? '⇤' : align() === 'center' ? '↔' : '⇥'}
            </button>
            <button
              type="button"
              class="nb-video-tool is-remove"
              data-tooltip="Remove video"
              aria-label="Remove video"
              onClick={() => props.deleteNode()}
            >
              ×
            </button>
          </div>
          <span
            class="nb-video-handle is-sw"
            onPointerDown={(event) => startResize(event, -1)}
          />
          <span
            class="nb-video-handle is-se"
            onPointerDown={(event) => startResize(event, 1)}
          />
        </Show>
        <Show when={caption().length > 0}>
          <figcaption class="nb-video-caption">{caption()}</figcaption>
        </Show>
      </figure>
    </NodeViewWrapper>
  );
}

export const MediaVideo = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      widthPct: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = Number(element.getAttribute('data-width-pct'));
          return Number.isFinite(value) ? clampWidthPct(value) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.widthPct === 'number'
            ? { 'data-width-pct': String(attributes.widthPct) }
            : {},
      },
      align: {
        default: 'center' satisfies ImageAlign,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-align');
          return isAlign(value) ? value : 'center';
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-align': String(attributes.align ?? 'center'),
        }),
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-caption'),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.caption === 'string' && attributes.caption !== ''
            ? { 'data-caption': attributes.caption }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'video[data-nb-video]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { 'data-nb-video': '' })];
  },

  addNodeView() {
    return SolidNodeViewRenderer(VideoView);
  },
});
