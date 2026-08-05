/**
 * MediaImage — the app's `image` node (extends @tiptap/extension-image),
 * replacing the plain `NotebookImage` in extensions.ts. Adds:
 *
 * - `widthPct` (kept from NotebookImage — flex-basis inside imageRow,
 *   width for standalone images), persisted after corner drag-resize;
 * - `align` left/center/right cycle (standalone images);
 * - `caption` (Kalam italic field below the image, part of node attrs);
 * - `frame` 'plain' | 'polaroid' toggle;
 * - a Solid node view with a selected halo + the controls above.
 */
import Image from '@tiptap/extension-image';
import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import {
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';

export const IMAGE_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type ImageAlign = (typeof IMAGE_ALIGNMENTS)[number];

export const IMAGE_FRAMES = ['plain', 'polaroid'] as const;
export type ImageFrame = (typeof IMAGE_FRAMES)[number];

export const MIN_WIDTH_PCT = 10;
export const MAX_WIDTH_PCT = 100;

export function clampWidthPct(value: number): number {
  return Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, value));
}

function isAlign(value: unknown): value is ImageAlign {
  return (
    typeof value === 'string' &&
    (IMAGE_ALIGNMENTS as readonly string[]).includes(value)
  );
}

function isFrame(value: unknown): value is ImageFrame {
  return (
    typeof value === 'string' && (IMAGE_FRAMES as readonly string[]).includes(value)
  );
}

function ImageView(props: SolidNodeViewProps): JSX.Element {
  const src = (): string =>
    typeof props.node.attrs.src === 'string' ? props.node.attrs.src : '';
  const alt = (): string =>
    typeof props.node.attrs.alt === 'string' ? props.node.attrs.alt : '';
  const align = (): ImageAlign =>
    isAlign(props.node.attrs.align) ? props.node.attrs.align : 'center';
  const frame = (): ImageFrame =>
    isFrame(props.node.attrs.frame) ? props.node.attrs.frame : 'plain';
  const widthPct = (): number | null =>
    typeof props.node.attrs.widthPct === 'number'
      ? clampWidthPct(props.node.attrs.widthPct)
      : null;
  const caption = (): string =>
    typeof props.node.attrs.caption === 'string' ? props.node.attrs.caption : '';

  /** Live width during a corner drag (null = use the persisted attr). */
  const [dragPct, setDragPct] = createSignal<number | null>(null);
  const effectivePct = (): number | null => dragPct() ?? widthPct();

  let wrapperEl: HTMLElement | undefined;

  const startResize = (event: PointerEvent, direction: 1 | -1): void => {
    event.preventDefault();
    event.stopPropagation();
    const container = wrapperEl?.parentElement;
    if (!container || container.clientWidth === 0) return;
    const containerWidth = container.clientWidth;
    const startX = event.clientX;
    const startPct = effectivePct() ?? (wrapperEl ? (wrapperEl.clientWidth / containerWidth) * 100 : 100);

    const onMove = (move: PointerEvent): void => {
      const deltaPct = ((move.clientX - startX) * direction * 100) / containerWidth;
      setDragPct(clampWidthPct(startPct + deltaPct));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const final = dragPct();
      setDragPct(null);
      if (final !== null) {
        props.updateAttributes({ widthPct: Math.round(final) });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const cycleAlign = (): void => {
    const order = IMAGE_ALIGNMENTS;
    const nextIndex = (order.indexOf(align()) + 1) % order.length;
    props.updateAttributes({ align: order[nextIndex] });
  };

  const toggleFrame = (): void => {
    props.updateAttributes({
      frame: frame() === 'polaroid' ? 'plain' : 'polaroid',
    });
  };

  const commitCaption = (value: string): void => {
    const trimmed = value.trim();
    props.updateAttributes({ caption: trimmed.length > 0 ? trimmed : null });
  };

  /*
   * THE CAPTION WRAPS, AND THE FIELD GROWS TO WHAT IT WRAPPED TO.
   *
   * It was an `<input type="text">`, which can do neither. A caption is as
   * wide as its picture and a picture in a row of four is narrow, so the
   * welcome book's own middle kitten — "On the good chair", 107px of Kalam in
   * a 102px box — was shown to the reader as "On the good chai", cut mid-word
   * with nothing to say it had been cut. An input clips silently: no wrap, no
   * ellipsis, and the missing tail only reachable by clicking in and arrowing
   * right, which nobody does to a label they cannot see is incomplete.
   *
   * Growing beats clipping here. A caption exists to be read, it is one short
   * line of prose, and a second line under a photograph is what a caption
   * looks like anyway — whereas an ellipsis would simply lose the words. So:
   * a textarea, wrapping, with the scroll bar off and the height measured.
   *
   * `rows` cannot express "as tall as the text": a textarea's height is set in
   * whole rows from the CSS box, so it is measured instead — collapse to
   * `auto` first, because scrollHeight of an already-tall box reports the box.
   */
  let captionEl: HTMLTextAreaElement | undefined;

  const fitCaption = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  /* Re-fit whenever the words change... */
  createEffect(() => {
    const text = caption();
    const el = captionEl;
    if (el === undefined) return;
    if (el.value !== text && document.activeElement !== el) el.value = text;
    fitCaption(el);
  });

  /*
   * ...and whenever the picture changes width, which is what changes where
   * the caption wraps. The IMAGE is what is observed, deliberately: observing
   * the caption's own box (or the wrapper that contains it) would feed the
   * height this callback sets back into the callback that set it.
   */
  const observeWidth = (img: HTMLImageElement): void => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (captionEl !== undefined) fitCaption(captionEl);
    });
    ro.observe(img);
    onCleanup(() => {
      ro.disconnect();
    });
  };

  return (
    <NodeViewWrapper
      ref={(el: HTMLElement) => {
        wrapperEl = el;
      }}
      class="nb-image"
      classList={{ 'is-selected': props.selected, 'is-resizing': dragPct() !== null }}
      data-align={align()}
      data-frame={frame()}
      /*
       * Whether anything is actually written under the picture. A polaroid's
       * white foot is reserved with padding when it is bare and given to the
       * caption's own flow when it is not — see media.css; a caption that can
       * wrap to two lines cannot be parked absolutely over the picture.
       */
      data-captioned={caption().length > 0 ? '' : undefined}
      style={{
        width: effectivePct() === null ? undefined : `${effectivePct()}%`,
        'flex-basis': effectivePct() === null ? undefined : `${effectivePct()}%`,
      }}
    >
      <figure class="nb-image-figure" contenteditable={false}>
        <img
          class="nb-image-img"
          src={src()}
          alt={alt()}
          draggable={false}
          ref={observeWidth}
        />

        <Show when={props.selected}>
          <div class="nb-image-controls">
            <button
              type="button"
              class="nb-image-tool"
              data-tooltip={`Align: ${align()} — click to cycle`}
              aria-label={`Alignment ${align()}, click to cycle`}
              onClick={cycleAlign}
            >
              {align() === 'left' ? '⇤' : align() === 'center' ? '↔' : '⇥'}
            </button>
            <button
              type="button"
              class="nb-image-tool"
              data-tooltip={frame() === 'polaroid' ? 'Plain frame' : 'Polaroid frame'}
              aria-label="Toggle polaroid frame"
              onClick={toggleFrame}
            >
              ▭
            </button>
          </div>
          <span
            class="nb-image-handle is-sw"
            onPointerDown={(event) => startResize(event, -1)}
          />
          <span
            class="nb-image-handle is-se"
            onPointerDown={(event) => startResize(event, 1)}
          />
        </Show>

        <Show when={props.selected || caption().length > 0}>
          <figcaption class="nb-image-captionbox">
            <textarea
              class="nb-image-caption"
              rows={1}
              placeholder="Add a caption…"
              value={caption()}
              ref={(el: HTMLTextAreaElement) => {
                captionEl = el;
              }}
              onInput={(event) => fitCaption(event.currentTarget)}
              onKeyDown={(event) => {
                event.stopPropagation();
                /*
                 * Enter still commits and leaves, exactly as it did when this
                 * was an input. A caption wraps by itself; a newline typed
                 * into one would be a line break the attribute cannot hold.
                 */
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitCaption(event.currentTarget.value);
                  event.currentTarget.blur();
                }
              }}
              onChange={(event) => commitCaption(event.currentTarget.value)}
            />
          </figcaption>
        </Show>
      </figure>
    </NodeViewWrapper>
  );
}

/**
 * Drop-in replacement for `NotebookImage` in extensions.ts — same node name
 * (`image`), same `widthPct` contract, plus align/caption/frame + node view.
 */
export const MediaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),

      /** Percentage of the row/page this image takes (null = natural). */
      widthPct: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-width-pct');
          const parsed = raw === null ? NaN : Number(raw);
          return Number.isFinite(parsed) ? clampWidthPct(parsed) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const value = attributes.widthPct;
          if (typeof value !== 'number') return {};
          return {
            'data-width-pct': String(value),
            style: `flex-basis: ${value}%`,
          };
        },
      },

      align: {
        default: 'center' satisfies ImageAlign,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-align');
          return isAlign(raw) ? raw : 'center';
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-align': String(attributes.align ?? 'center'),
        }),
      },

      caption: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-caption'),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.caption === 'string' && attributes.caption.length > 0
            ? { 'data-caption': attributes.caption }
            : {},
      },

      frame: {
        default: 'plain' satisfies ImageFrame,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-frame');
          return isFrame(raw) ? raw : 'plain';
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-frame': String(attributes.frame ?? 'plain'),
        }),
      },
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(ImageView);
  },
});
