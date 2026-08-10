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
import { pickMediaFiles } from './insert';
import {
  IMAGE_PLACEHOLDER_ATTRIBUTE,
  imagePlaceholderPrompt,
  persistPlaceholderImage,
} from './imagePlaceholder';
import {
  IMAGE_ASSET_REL_PATH_ATTRIBUTE,
  assetRelPathForImageAttrs,
} from './portableAssets';
import { MISSING_ASSET_SRC, resolveAssetSrc } from './resolver';

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
  const assetRelPath = (): string | null =>
    assetRelPathForImageAttrs(props.node.attrs);
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
  const placeholder = (): string | null =>
    imagePlaceholderPrompt(props.node.attrs);

  const [replacing, setReplacing] = createSignal(false);
  const [draggingOver, setDraggingOver] = createSignal(false);
  const [replacementError, setReplacementError] = createSignal<string | null>(null);
  let alive = true;
  let sourceGeneration = 0;
  onCleanup(() => {
    alive = false;
    sourceGeneration += 1;
  });

  /*
   * Script insertion can create a portable image node before a page-level
   * hydration pass has had a chance to materialize its display URL. Resolve
   * it in the node view too, but keep the result as presentation state: an
   * async `updateAttributes({ src })` here would make a just-inserted clean
   * Notebook Script dirty solely because its picture finished resolving.
   */
  const [portableSrc, setPortableSrc] = createSignal<string | null>(null);
  createEffect(() => {
    const relPath = assetRelPath();
    const generation = ++sourceGeneration;
    setPortableSrc(null);
    if (relPath === null) return;
    void resolveAssetSrc(relPath).then((resolved) => {
      if (alive && generation === sourceGeneration) setPortableSrc(resolved);
    });
  });
  const displaySrc = (): string => {
    if (assetRelPath() !== null) return portableSrc() ?? MISSING_ASSET_SRC;
    return src().trim() === '' ? MISSING_ASSET_SRC : src();
  };

  const replaceWith = async (file: File): Promise<void> => {
    if (replacing()) return;
    setReplacing(true);
    setReplacementError(null);
    try {
      const patch = await persistPlaceholderImage(file);
      if (alive) props.updateAttributes(patch);
    } catch {
      if (alive) {
        setReplacementError('That picture could not be saved. Try another image.');
      }
    } finally {
      if (alive) setReplacing(false);
    }
  };

  const chooseReplacement = async (event: MouseEvent): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    if (replacing()) return;
    const [file] = await pickMediaFiles('image/*', false);
    if (file !== undefined) await replaceWith(file);
  };

  const dropReplacement = (event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingOver(false);
    const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) =>
      candidate.type.startsWith('image/'),
    );
    if (file === undefined) {
      setReplacementError('Drop one image file here.');
      return;
    }
    void replaceWith(file);
  };

  /** Live width during a corner drag (null = use the persisted attr). */
  const [dragPct, setDragPct] = createSignal<number | null>(null);
  const effectivePct = (): number | null => dragPct() ?? widthPct();

  let wrapperEl: HTMLElement | undefined;
  const [rowHost, setRowHost] = createSignal<HTMLElement | undefined>();

  const detectRowHost = (): void => {
    const host = wrapperEl?.parentElement;
    setRowHost(
      host?.dataset.nodeViewRoot === 'image' &&
        host.parentElement?.classList.contains('nb-image-row-track')
        ? host
        : undefined,
    );
  };

  /*
   * ProseMirror owns one host around every Solid node view. In an image row
   * THAT host is the flex item, not `.nb-image` inside it. Width used to be
   * written only on the nested wrapper, so the row distributed anonymous
   * host boxes while the requested percentage shrank a child inside each box.
   * Place the basis on the real flex item and let the visible wrapper fill it.
   */
  createEffect(() => {
    const host = rowHost();
    if (host === undefined) return;
    const pct = effectivePct();
    host.style.flex = pct === null ? '1 1 0' : `0 0 ${pct}%`;
    host.style.minWidth = '0';
    onCleanup(() => {
      host.style.removeProperty('flex');
      host.style.removeProperty('min-width');
    });
  });

  const startResize = (event: PointerEvent, direction: 1 | -1): void => {
    event.preventDefault();
    event.stopPropagation();
    const host = rowHost();
    const container = host?.parentElement ?? wrapperEl?.parentElement;
    if (!container || container.clientWidth === 0) return;
    const containerWidth = container.clientWidth;
    const startX = event.clientX;
    const measured = host ?? wrapperEl;
    const startPct =
      effectivePct() ?? (measured ? (measured.clientWidth / containerWidth) * 100 : 100);

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
        // Solid mounts into the detached NodeView host before ProseMirror
        // inserts that host into the row. Check now for updates, then once at
        // the end of this task for first mount after the real parent exists.
        detectRowHost();
        queueMicrotask(() => {
          if (alive) detectRowHost();
        });
      }}
      class="nb-image"
      classList={{ 'is-selected': props.selected, 'is-resizing': dragPct() !== null }}
      data-nb-block-flow="feature"
      data-align={align()}
      data-media-frame={frame()}
      data-image-placeholder={placeholder() === null ? undefined : ''}
      /*
       * Whether anything is actually written under the picture. A polaroid's
       * white foot is reserved with padding when it is bare and given to the
       * caption's own flow when it is not — see media.css; a caption that can
       * wrap to two lines cannot be parked absolutely over the picture.
       */
      data-captioned={caption().length > 0 ? '' : undefined}
      style={{
        width:
          rowHost() !== undefined
            ? '100%'
            : effectivePct() === null
              ? undefined
              : `${effectivePct()}%`,
        'flex-basis':
          rowHost() !== undefined || effectivePct() === null
            ? undefined
            : `${effectivePct()}%`,
      }}
    >
      <figure class="nb-image-figure" contenteditable={false}>
        <Show
          when={placeholder()}
          keyed
          fallback={
            <img
              class="nb-image-img"
              src={displaySrc()}
              alt={alt()}
              draggable={false}
              ref={observeWidth}
            />
          }
        >
          {(prompt) => (
            <button
              type="button"
              class="nb-image-placeholder"
              classList={{
                'is-dragging': draggingOver(),
                'is-saving': replacing(),
              }}
              aria-label={`Choose an image for: ${prompt}`}
              title={prompt}
              aria-busy={replacing()}
              onClick={(event) => void chooseReplacement(event)}
              onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDraggingOver(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.dataTransfer !== null) {
                  event.dataTransfer.dropEffect = 'copy';
                }
                setDraggingOver(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
                  setDraggingOver(false);
                }
              }}
              onDrop={dropReplacement}
            >
              <svg
                class="nb-image-placeholder-glyph"
                viewBox="0 0 72 54"
                aria-hidden="true"
              >
                <path d="M7 9.5 Q7 6 11 6 L61 6 Q65 6 65 10 L65 44 Q65 48 61 48 L11 48 Q7 48 7 44 Z" />
                <circle cx="24" cy="21" r="5" />
                <path d="M13 40 L28 28 L37 36 L47 24 L60 40" />
                <path class="nb-image-placeholder-plus" d="M55 7 L55 19 M49 13 L61 13" />
              </svg>
              <span class="nb-image-placeholder-copy">
                <span class="nb-image-placeholder-kicker font-ui">
                  {replacing() ? 'saving picture…' : 'picture needed'}
                </span>
                <span class="nb-image-placeholder-prompt">{prompt}</span>
                <span class="nb-image-placeholder-action font-ui">
                  click to choose, or drop one image here
                </span>
              </span>
              <Show when={replacementError()} keyed>
                {(message) => (
                  <span class="nb-image-placeholder-error font-ui" role="status">
                    {message}
                  </span>
                )}
              </Show>
            </button>
          )}
        </Show>

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
          <Show when={placeholder() === null}>
            <span
              class="nb-image-handle is-sw"
              onPointerDown={(event) => startResize(event, -1)}
            />
            <span
              class="nb-image-handle is-se"
              onPointerDown={(event) => startResize(event, 1)}
            />
          </Show>
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

      /** Stable path relative to the active library's assets root. */
      assetRelPath: {
        ...IMAGE_ASSET_REL_PATH_ATTRIBUTE,
      },

      /**
       * Human-facing prompt carried by an intentionally empty-src image.
       * Once one picture is persisted, the node view clears this attribute
       * while leaving alt/caption/frame and every effect untouched.
       */
      placeholder: {
        ...IMAGE_PLACEHOLDER_ATTRIBUTE,
      },

      frame: {
        default: 'plain' satisfies ImageFrame,
        parseHTML: (element: HTMLElement) => {
          /* `data-frame` belongs to the block-decoration vocabulary. Older
             image HTML used it too, which accidentally wrapped every image in
             the universal decorative-frame padding. Read it only as a legacy
             fallback; new media owns a namespaced attribute. */
          const raw =
            element.getAttribute('data-media-frame') ??
            element.getAttribute('data-frame');
          return isFrame(raw) ? raw : 'plain';
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-media-frame': String(attributes.frame ?? 'plain'),
        }),
      },
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(ImageView);
  },
});
