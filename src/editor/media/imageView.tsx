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
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
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
import {
  clampViewerPan,
  viewerWheelAction,
  type ViewerPan,
} from './imageViewerPan';
import {
  imageFileDimensions,
  initialImageWidthForPage,
  safeManualImageResizeWidth,
} from './initialImageFit';
import {
  copyPortableImage,
  downloadPortableImage,
} from '../menu/blockPortability';
import {
  IMAGE_ANNOTATION_COLOURS,
  IMAGE_ANNOTATION_SIZES,
  IMAGE_ANNOTATION_TOOLS,
  parseImageAnnotations,
  serializeImageAnnotations,
  type ImageAnnotationColour,
  type ImageAnnotationPoint,
  type ImageAnnotationStroke,
  type ImageAnnotationTool,
} from './imageAnnotations';

export {
  IMAGE_ANNOTATION_COLOURS,
  IMAGE_ANNOTATION_SIZES,
  IMAGE_ANNOTATION_TOOLS,
  parseImageAnnotations,
  serializeImageAnnotations,
  type ImageAnnotationColour,
  type ImageAnnotationPoint,
  type ImageAnnotationStroke,
  type ImageAnnotationTool,
} from './imageAnnotations';

export const IMAGE_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type ImageAlign = (typeof IMAGE_ALIGNMENTS)[number];

export const IMAGE_FRAMES = ['plain', 'polaroid'] as const;
export type ImageFrame = (typeof IMAGE_FRAMES)[number];

export const MIN_WIDTH_PCT = 10;
export const MAX_WIDTH_PCT = 100;
export const MAX_STANDALONE_IMAGE_WIDTH_PCT = 132;

export function clampWidthPct(value: number): number {
  return Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, value));
}

function clampStandaloneImageWidthPct(
  value: number,
  maximum = MAX_STANDALONE_IMAGE_WIDTH_PCT,
): number {
  return Math.min(maximum, Math.max(MIN_WIDTH_PCT, value));
}

function annotationColourValue(colour: ImageAnnotationColour): string {
  return (
    IMAGE_ANNOTATION_COLOURS.find((candidate) => candidate.id === colour)?.value ??
    IMAGE_ANNOTATION_COLOURS[0].value
  );
}

function annotationStrokeAppearance(stroke: ImageAnnotationStroke): {
  readonly width: number;
  readonly opacity: number;
  readonly linecap: 'round' | 'square';
  readonly dash?: string;
} {
  if (stroke.tool === 'pencil') {
    return { width: Math.max(1, stroke.size * 0.62), opacity: 0.72, linecap: 'round' };
  }
  if (stroke.tool === 'brush') {
    return { width: stroke.size * 1.75, opacity: 0.9, linecap: 'round' };
  }
  if (stroke.tool === 'highlighter') {
    return { width: stroke.size * 3.2, opacity: 0.3, linecap: 'square' };
  }
  return { width: stroke.size, opacity: 0.96, linecap: 'round' };
}

function annotationPath(
  stroke: ImageAnnotationStroke,
  viewHeight: number,
): string {
  return stroke.points
    .map((point, index) => {
      const x = Math.round(point.x * 1000 * 10) / 10;
      const y = Math.round(point.y * viewHeight * 10) / 10;
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');
}

function ImageAnnotationLayer(props: {
  readonly strokes: readonly ImageAnnotationStroke[];
  readonly aspect: number;
  readonly class?: string;
}): JSX.Element {
  const viewHeight = (): number => Math.max(1, 1000 * props.aspect);
  return (
    <svg
      class={props.class ?? 'nb-image-annotations'}
      viewBox={`0 0 1000 ${viewHeight()}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <For each={props.strokes}>
        {(stroke) => {
          const appearance = annotationStrokeAppearance(stroke);
          return (
            <path
              d={annotationPath(stroke, viewHeight())}
              fill="none"
              stroke={annotationColourValue(stroke.colour)}
              stroke-width={appearance.width}
              stroke-opacity={appearance.opacity}
              stroke-linecap={appearance.linecap}
              stroke-linejoin="round"
              stroke-dasharray={appearance.dash}
            />
          );
        }}
      </For>
    </svg>
  );
}

type ImageToolGlyphKind =
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'frame'
  | 'expand'
  | 'copy'
  | 'download';

/** App-drawn image chrome; avoids baseline-dependent platform text glyphs. */
function ImageToolGlyph(props: { readonly kind: ImageToolGlyphKind }): JSX.Element {
  if (props.kind === 'copy') {
    return (
      <svg class="nb-image-tool-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 8 H18 V18 H8 Z M5 15 H4 V5 H14 V6" />
      </svg>
    );
  }
  if (props.kind === 'download') {
    return (
      <svg class="nb-image-tool-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4 V15 M8 11 L12 15 L16 11 M5 19 H19" />
      </svg>
    );
  }
  if (props.kind === 'frame') {
    return (
      <svg class="nb-image-tool-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 5.5 Q4.5 4.5 5.8 4.5 H18.2 Q19.5 4.5 19.5 5.8 V18.2 Q19.5 19.5 18.2 19.5 H5.8 Q4.5 19.5 4.5 18.2 Z" />
        <path d="M7.5 16 L10.4 12.8 L12.7 15 L15.4 10.8 L17.3 16" />
      </svg>
    );
  }
  if (props.kind === 'expand') {
    return (
      <svg class="nb-image-tool-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 4.5 H4.5 V9 M15 4.5 H19.5 V9 M19.5 15 V19.5 H15 M9 19.5 H4.5 V15" />
      </svg>
    );
  }
  const left = props.kind === 'align-left';
  const right = props.kind === 'align-right';
  const segment = (length: number): { x1: number; x2: number } => {
    if (left) return { x1: 4.5, x2: 4.5 + length };
    if (right) return { x1: 19.5 - length, x2: 19.5 };
    return { x1: 12 - length / 2, x2: 12 + length / 2 };
  };
  const long = segment(15);
  const medium = segment(11);
  const short = segment(8);
  return (
    <svg class="nb-image-tool-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={`M${long.x1} 6 H${long.x2} M${medium.x1} 10 H${medium.x2} M${long.x1} 14 H${long.x2} M${short.x1} 18 H${short.x2}`}
      />
    </svg>
  );
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
      ? clampStandaloneImageWidthPct(props.node.attrs.widthPct)
      : null;
  const caption = (): string =>
    typeof props.node.attrs.caption === 'string' ? props.node.attrs.caption : '';
  const placeholder = (): string | null =>
    imagePlaceholderPrompt(props.node.attrs);

  const [replacing, setReplacing] = createSignal(false);
  const [draggingOver, setDraggingOver] = createSignal(false);
  const [replacementError, setReplacementError] = createSignal<string | null>(null);
  const [portableNotice, setPortableNotice] = createSignal<string | null>(null);
  const [viewerOpen, setViewerOpen] = createSignal(false);
  const [viewerFullscreen, setViewerFullscreen] = createSignal(false);
  const [viewerZoom, setViewerZoom] = createSignal(100);
  const [viewerPan, setViewerPan] = createSignal<ViewerPan>({ x: 0, y: 0 });
  const [viewerDragging, setViewerDragging] = createSignal(false);
  const [viewerMode, setViewerMode] = createSignal<'move' | 'mark'>('move');
  const [annotationTool, setAnnotationTool] =
    createSignal<ImageAnnotationTool>('pen');
  const [annotationColour, setAnnotationColour] =
    createSignal<ImageAnnotationColour>('terracotta');
  const [annotationSize, setAnnotationSize] = createSignal<number>(7);
  const [annotations, setAnnotations] = createSignal<ImageAnnotationStroke[]>(
    parseImageAnnotations(props.node.attrs.annotations),
  );
  const [pageAnnotations, setPageAnnotations] = createSignal<ImageAnnotationStroke[]>(
    parseImageAnnotations(props.node.attrs.annotations),
  );
  const [annotationUndo, setAnnotationUndo] =
    createSignal<ImageAnnotationStroke[][]>([]);
  const [annotationRedo, setAnnotationRedo] =
    createSignal<ImageAnnotationStroke[][]>([]);
  const [imageAspect, setImageAspect] = createSignal(1);
  const [viewerBaseSize, setViewerBaseSize] = createSignal<{
    width: number;
    height: number;
  } | null>(null);
  let viewerStageEl: HTMLDivElement | undefined;
  let viewerImageEl: HTMLImageElement | undefined;
  let viewerArtEl: HTMLDivElement | undefined;
  let viewerDrag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        panX: number;
        panY: number;
      }
    | undefined;
  let annotationGesture:
    | {
        pointerId: number;
        before: ImageAnnotationStroke[];
        strokeId?: string;
        changed: boolean;
      }
    | undefined;
  let annotationsDirty = false;
  let alive = true;
  let sourceGeneration = 0;
  onCleanup(() => {
    alive = false;
    sourceGeneration += 1;
  });

  createEffect(() => {
    const raw = props.node.attrs.annotations;
    const incoming = parseImageAnnotations(raw);
    if (
      serializeImageAnnotations(incoming) !==
      serializeImageAnnotations(untrack(pageAnnotations))
    ) {
      setPageAnnotations(incoming);
    }
    if (annotationGesture !== undefined || annotationsDirty) return;
    if (
      serializeImageAnnotations(incoming) !==
      serializeImageAnnotations(untrack(annotations))
    ) {
      setAnnotations(incoming);
      setAnnotationUndo([]);
      setAnnotationRedo([]);
    }
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

  const measuredViewerPan = (candidate: ViewerPan): ViewerPan => {
    const stage = viewerStageEl;
    const image = viewerImageEl;
    if (stage === undefined || image === undefined) return candidate;
    return clampViewerPan(
      candidate,
      viewerZoom(),
      image.offsetWidth,
      image.offsetHeight,
      stage.clientWidth,
      stage.clientHeight,
    );
  };

  const settleViewerPan = (): void => {
    requestAnimationFrame(() => setViewerPan((current) => measuredViewerPan(current)));
  };

  /** Fit the complete intrinsic picture inside the stage at the 100% setting. */
  const fitViewerImage = (): void => {
    const stage = viewerStageEl;
    const image = viewerImageEl;
    if (
      stage === undefined ||
      image === undefined ||
      image.naturalWidth <= 0 ||
      image.naturalHeight <= 0
    ) {
      return;
    }
    const style = getComputedStyle(stage);
    const availableWidth = Math.max(
      1,
      stage.clientWidth -
        (Number.parseFloat(style.paddingLeft) || 0) -
        (Number.parseFloat(style.paddingRight) || 0),
    );
    const availableHeight = Math.max(
      1,
      stage.clientHeight -
        (Number.parseFloat(style.paddingTop) || 0) -
        (Number.parseFloat(style.paddingBottom) || 0),
    );
    const scale = Math.min(
      1,
      availableWidth / image.naturalWidth,
      availableHeight / image.naturalHeight,
    );
    setViewerBaseSize({
      width: Math.max(1, image.naturalWidth * scale),
      height: Math.max(1, image.naturalHeight * scale),
    });
    setImageAspect(image.naturalHeight / image.naturalWidth);
  };

  const observeViewerStage = (stage: HTMLDivElement): void => {
    viewerStageEl = stage;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fitViewerImage);
    observer.observe(stage);
    onCleanup(() => observer.disconnect());
  };

  const resetViewer = (): void => {
    setViewerZoom(100);
    setViewerPan({ x: 0, y: 0 });
  };

  const recenterViewer = (): void => {
    setViewerPan({ x: 0, y: 0 });
  };

  const changeViewerZoom = (delta: number): void => {
    setViewerZoom((current) => Math.max(50, Math.min(300, current + delta)));
    settleViewerPan();
  };

  const openViewer = (): void => {
    if (placeholder() !== null) return;
    resetViewer();
    setViewerMode('move');
    setViewerOpen(true);
  };

  const nudgeViewerPan = (x: number, y: number): void => {
    setViewerPan((current) =>
      measuredViewerPan({ x: current.x + x, y: current.y + y }),
    );
  };

  const beginViewerDrag = (event: PointerEvent): void => {
    const isMiddleButton = event.button === 1;
    if (!isMiddleButton && viewerMode() === 'mark') {
      beginAnnotationGesture(event);
      return;
    }
    if (!isMiddleButton && event.button !== 0) return;
    event.preventDefault();
    const pan = viewerPan();
    viewerDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget instanceof Element &&
      event.currentTarget.setPointerCapture(event.pointerId);
    setViewerDragging(true);
  };

  const moveViewerDrag = (event: PointerEvent): void => {
    if (annotationGesture !== undefined) {
      moveAnnotationGesture(event);
      return;
    }
    const drag = viewerDrag;
    if (drag === undefined || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setViewerPan(
      measuredViewerPan({
        x: drag.panX + event.clientX - drag.startX,
        y: drag.panY + event.clientY - drag.startY,
      }),
    );
  };

  const endViewerDrag = (event: PointerEvent): void => {
    if (annotationGesture !== undefined) {
      endAnnotationGesture(event);
      return;
    }
    if (viewerDrag?.pointerId !== event.pointerId) return;
    const target = event.currentTarget;
    if (target instanceof Element && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    viewerDrag = undefined;
    setViewerDragging(false);
  };

  const annotationPointAt = (event: PointerEvent): ImageAnnotationPoint | null => {
    const art = viewerArtEl;
    if (art === undefined) return null;
    const rect = art.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  };

  const persistAnnotations = (next: readonly ImageAnnotationStroke[]): void => {
    props.updateAttributes({ annotations: serializeImageAnnotations(next) });
  };

  /*
   * TipTap attribute transactions can invalidate the page snapshot and node
   * view behind this portal. Doing that at every pointer-up made the picture
   * flash even though the workspace itself had not changed. Keep the active
   * SVG draft local, then commit only after the portal is hidden.
   */
  const commitAnnotations = (): void => {
    if (!annotationsDirty) return;
    const next = annotations();
    annotationsDirty = false;
    setPageAnnotations(next);
    persistAnnotations(next);
  };

  const closeViewer = (): void => {
    setViewerFullscreen(false);
    setViewerOpen(false);
    queueMicrotask(commitAnnotations);
  };

  const recordAnnotationChange = (
    before: ImageAnnotationStroke[],
    next: ImageAnnotationStroke[],
  ): void => {
    if (serializeImageAnnotations(before) === serializeImageAnnotations(next)) return;
    setAnnotationUndo((history) => [...history.slice(-49), before]);
    setAnnotationRedo([]);
    setAnnotations(next);
    annotationsDirty = true;
  };

  const eraseAt = (
    source: ImageAnnotationStroke[],
    point: ImageAnnotationPoint,
  ): ImageAnnotationStroke[] => {
    const aspect = Math.max(0.1, imageAspect());
    const radius = Math.max(0.009, annotationSize() / 500);
    return source.filter((stroke) =>
      !stroke.points.some((candidate) => {
        const dx = candidate.x - point.x;
        const dy = (candidate.y - point.y) * aspect;
        return Math.hypot(dx, dy) <= radius;
      }),
    );
  };

  const beginAnnotationGesture = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const point = annotationPointAt(event);
    if (point === null) return;
    event.preventDefault();
    event.stopPropagation();
    const before = annotations();
    const tool = annotationTool();
    if (tool === 'eraser') {
      const next = eraseAt(before, point);
      annotationGesture = {
        pointerId: event.pointerId,
        before,
        changed: next.length !== before.length,
      };
      setAnnotations(next);
    } else {
      const stroke: ImageAnnotationStroke = {
        id: `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        tool,
        colour: annotationColour(),
        size: annotationSize(),
        points: [point],
      };
      annotationGesture = {
        pointerId: event.pointerId,
        before,
        strokeId: stroke.id,
        changed: true,
      };
      setAnnotations([...before, stroke]);
    }
    event.currentTarget instanceof Element &&
      event.currentTarget.setPointerCapture(event.pointerId);
    setViewerDragging(true);
  };

  const moveAnnotationGesture = (event: PointerEvent): void => {
    const gesture = annotationGesture;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    const point = annotationPointAt(event);
    if (point === null) return;
    event.preventDefault();
    const tool = annotationTool();
    if (tool === 'eraser') {
      setAnnotations((current) => {
        const next = eraseAt(current, point);
        if (next.length !== current.length) gesture.changed = true;
        return next;
      });
      return;
    }
    setAnnotations((current) =>
      current.map((stroke) => {
        if (stroke.id !== gesture.strokeId) return stroke;
        const last = stroke.points[stroke.points.length - 1];
        const minStep = Math.max(0.0008, 1 / Math.max(800, viewerZoom() * 12));
        if (last !== undefined && Math.hypot(last.x - point.x, last.y - point.y) < minStep) {
          return stroke;
        }
        return { ...stroke, points: [...stroke.points, point] };
      }),
    );
  };

  const endAnnotationGesture = (event: PointerEvent): void => {
    const gesture = annotationGesture;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    const target = event.currentTarget;
    if (target instanceof Element && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    annotationGesture = undefined;
    setViewerDragging(false);
    if (gesture.changed) {
      recordAnnotationChange(gesture.before, annotations());
    }
  };

  const undoAnnotation = (): void => {
    const history = annotationUndo();
    const previous = history[history.length - 1];
    if (previous === undefined) return;
    const current = annotations();
    setAnnotationUndo(history.slice(0, -1));
    setAnnotationRedo((redo) => [...redo.slice(-49), current]);
    setAnnotations(previous);
    annotationsDirty = true;
  };

  const redoAnnotation = (): void => {
    const history = annotationRedo();
    const next = history[history.length - 1];
    if (next === undefined) return;
    const current = annotations();
    setAnnotationRedo(history.slice(0, -1));
    setAnnotationUndo((undo) => [...undo.slice(-49), current]);
    setAnnotations(next);
    annotationsDirty = true;
  };

  const clearAnnotations = (): void => {
    if (annotations().length === 0) return;
    recordAnnotationChange(annotations(), []);
  };

  createEffect(() => {
    if (!viewerOpen()) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === 'Escape') {
        if (viewerFullscreen()) setViewerFullscreen(false);
        else closeViewer();
      }
      if (event.key === '+' || event.key === '=') changeViewerZoom(25);
      if (event.key === '-') changeViewerZoom(-25);
      if (event.key === '0') resetViewer();
      if (event.key.toLowerCase() === 'm') {
        setViewerMode((current) => (current === 'mark' ? 'move' : 'mark'));
      }
      if (event.key.toLowerCase() === 'f') {
        setViewerFullscreen((current) => !current);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoAnnotation();
        else undoAnnotation();
      }
      if (event.key === 'ArrowLeft') nudgeViewerPan(40, 0);
      if (event.key === 'ArrowRight') nudgeViewerPan(-40, 0);
      if (event.key === 'ArrowUp') nudgeViewerPan(0, 40);
      if (event.key === 'ArrowDown') nudgeViewerPan(0, -40);
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const replaceWith = async (file: File): Promise<void> => {
    if (replacing()) return;
    setReplacing(true);
    setReplacementError(null);
    try {
      const [patch, dimensions] = await Promise.all([
        persistPlaceholderImage(file),
        imageFileDimensions(file),
      ]);
      if (alive) {
        const currentPct = widthPct() ?? 100;
        const wrapperWidth = wrapperEl?.getBoundingClientRect().width ?? 0;
        const estimatedImageHeight =
          dimensions !== null && dimensions.width > 0
            ? wrapperWidth * (dimensions.height / dimensions.width)
            : 0;
        const fittedPct =
          estimatedImageHeight > 0
            ? fitUploadMeasurement(
                estimatedImageHeight,
                estimatedImageHeight + estimatedImageChromePx(),
              )
            : currentPct;
        props.updateAttributes({
          ...patch,
          widthPct: fittedPct < currentPct ? fittedPct : props.node.attrs.widthPct,
          initialFitPending: dimensions === null,
        });
      }
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

  let wrapperEl: HTMLElement | undefined;
  const [rowHost, setRowHost] = createSignal<HTMLElement | undefined>();
  const effectivePct = (): number | null => {
    const value = dragPct() ?? widthPct();
    return value === null || rowHost() === undefined
      ? value
      : Math.min(MAX_WIDTH_PCT, value);
  };

  const detectRowHost = (): void => {
    const host = wrapperEl?.parentElement;
    setRowHost(
      host?.dataset.nodeViewRoot === 'image' &&
        host.parentElement?.classList.contains('nb-image-row-track')
        ? host
        : undefined,
    );
  };

  /**
   * The prose column is intentionally narrower than the paper. Standalone
   * pictures may use that quiet margin, but never the binding, dog-ear, or
   * outer paper edge. This is measured from the live leaf so focus zoom and
   * responsive book sizing produce the same physical inset.
   */
  const leafSafeStandaloneWidthPct = (): number => {
    if (rowHost() !== undefined) return MAX_WIDTH_PCT;
    const root = wrapperEl?.closest('.nb-prose');
    const leaf = wrapperEl?.closest('.nb-leaf-paper');
    if (!(root instanceof HTMLElement) || !(leaf instanceof HTMLElement)) {
      return MAX_STANDALONE_IMAGE_WIDTH_PCT;
    }
    const rootWidth = root.getBoundingClientRect().width;
    const leafWidth = leaf.getBoundingClientRect().width;
    if (rootWidth <= 0 || leafWidth <= 0) return MAX_STANDALONE_IMAGE_WIDTH_PCT;
    const safeInset = Math.max(24, leafWidth * 0.055);
    const safeWidth = Math.max(rootWidth, leafWidth - safeInset * 2);
    return Math.max(
      MAX_WIDTH_PCT,
      Math.min(MAX_STANDALONE_IMAGE_WIDTH_PCT, (safeWidth / rootWidth) * 100),
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
    /* Pointer deltas arrive in drawn pixels. The book itself may be camera-
     * scaled to fit a small window, so use the drawn container width too;
     * the ratio then remains identical on every monitor/viewport. */
    const containerWidth = container.getBoundingClientRect().width;
    if (containerWidth === 0) return;
    const startX = event.clientX;
    const measured = host ?? wrapperEl;
    const startPct =
      effectivePct() ?? (measured ? (measured.clientWidth / containerWidth) * 100 : 100);
    const startImageHeight =
      wrapperEl?.querySelector<HTMLImageElement>('.nb-image-img')?.getBoundingClientRect()
        .height ?? 0;
    const startBlockHeight = wrapperEl?.getBoundingClientRect().height ?? 0;
    const maximumPct = leafSafeStandaloneWidthPct();

    const onMove = (move: PointerEvent): void => {
      const deltaPct = ((move.clientX - startX) * direction * 100) / containerWidth;
      const requested = clampStandaloneImageWidthPct(
        startPct + deltaPct,
        maximumPct,
      );
      const fitted = fitManualResizeMeasurement(
        startPct,
        requested,
        startImageHeight,
        startBlockHeight,
      );
      setDragPct(
        clampStandaloneImageWidthPct(Math.min(requested, fitted), maximumPct),
      );
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

  const runPortableAction = async (kind: 'copy' | 'download'): Promise<void> => {
    setPortableNotice(kind === 'copy' ? 'copying…' : 'opening save dialog…');
    try {
      const message = kind === 'copy'
        ? await copyPortableImage(props.node.attrs)
        : await downloadPortableImage(props.node.attrs);
      setPortableNotice(message);
    } catch {
      setPortableNotice(kind === 'copy' ? 'could not copy image' : 'could not save image');
    }
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

  const estimatedImageChromePx = (): number => {
    const captionChrome = caption().trim().length > 0 ? 42 : 0;
    const frameChrome = frame() === 'polaroid' ? 38 : 8;
    return captionChrome + frameChrome;
  };

  const pageFitContext = (): {
    scale: number;
    blockTopPx: number;
    followingContentHeightPx: number;
    pageCapacityPx: number;
    pagePaddingBottomPx: number;
  } | null => {
    const wrapper = wrapperEl;
    const root = wrapper?.closest('.nb-prose');
    const capacity =
      root instanceof HTMLElement
        ? Number(root.dataset.pageCapacityPx)
        : Number.NaN;

    if (!(root instanceof HTMLElement) || !Number.isFinite(capacity)) return null;

    let block: HTMLElement | null = wrapper ?? null;
    while (block?.parentElement !== root) block = block?.parentElement ?? null;
    if (block === null) return null;

    const rootRect = root.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    const scale =
      root.clientHeight > 0 && rootRect.height > 0
        ? rootRect.height / root.clientHeight
        : 1;
    const following = Array.from(root.children).slice(
      Array.prototype.indexOf.call(root.children, block) + 1,
    );
    const lastFollowing = following[following.length - 1];
    const followingHeight =
      lastFollowing instanceof HTMLElement
        ? Math.max(
            0,
            (lastFollowing.getBoundingClientRect().bottom - blockRect.bottom) /
              scale,
          )
        : 0;
    return {
      scale,
      blockTopPx: (blockRect.top - rootRect.top) / scale,
      followingContentHeightPx: followingHeight,
      pageCapacityPx: capacity,
      pagePaddingBottomPx:
        Number.parseFloat(getComputedStyle(root).paddingBottom) || 0,
    };
  };

  const fitUploadMeasurement = (
    imageHeightPx: number,
    blockHeightPx: number,
  ): number => {
    const context = pageFitContext();
    if (context === null) return widthPct() ?? 100;
    const currentPct = widthPct() ?? 100;
    return initialImageWidthForPage({
      currentWidthPct: currentPct,
      imageHeightPx: imageHeightPx / context.scale,
      blockHeightPx: blockHeightPx / context.scale,
      blockTopPx: context.blockTopPx,
      followingContentHeightPx: context.followingContentHeightPx,
      pageCapacityPx: context.pageCapacityPx,
      pagePaddingBottomPx: context.pagePaddingBottomPx,
      minimumWidthPct: MIN_WIDTH_PCT,
    });
  };

  const fitManualResizeMeasurement = (
    measuredWidthPct: number,
    requestedWidthPct: number,
    imageHeightPx: number,
    blockHeightPx: number,
  ): number => {
    const context = pageFitContext();
    if (context === null || imageHeightPx <= 0 || blockHeightPx <= 0) {
      return requestedWidthPct;
    }
    return safeManualImageResizeWidth({
      measuredWidthPct,
      requestedWidthPct,
      imageHeightPx: imageHeightPx / context.scale,
      blockHeightPx: blockHeightPx / context.scale,
      blockTopPx: context.blockTopPx,
      followingContentHeightPx: context.followingContentHeightPx,
      pageCapacityPx: context.pageCapacityPx,
      pagePaddingBottomPx: context.pagePaddingBottomPx,
      minimumWidthPct: MIN_WIDTH_PCT,
    });
  };

  const fitNewUploadToPage = (img: HTMLImageElement): void => {
    if (props.node.attrs.initialFitPending !== true) return;
    const imageRect = img.getBoundingClientRect();
    const blockHeight = wrapperEl?.getBoundingClientRect().height ?? imageRect.height;
    const currentPct = widthPct() ?? 100;
    const fittedPct = fitUploadMeasurement(imageRect.height, blockHeight);
    if (fittedPct < currentPct && wrapperEl !== undefined) {
      // Make the fitted geometry visible to PageEditor synchronously. The
      // attribute transaction below invokes overflow measurement before the
      // Solid node view would otherwise have reflected its new percentage.
      wrapperEl.style.width = `${fittedPct}%`;
      wrapperEl.style.flexBasis = `${fittedPct}%`;
    }
    props.updateAttributes({
      widthPct: fittedPct < currentPct ? fittedPct : props.node.attrs.widthPct,
      initialFitPending: false,
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
      data-wide={
        rowHost() === undefined && (effectivePct() ?? 0) > MAX_WIDTH_PCT
          ? ''
          : undefined
      }
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
            <span class="nb-image-visual">
              <img
                class="nb-image-img"
                src={displaySrc()}
                alt={alt()}
                draggable={false}
                ref={observeWidth}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setImageAspect(image.naturalHeight / image.naturalWidth);
                  }
                  fitNewUploadToPage(image);
                }}
                onDblClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openViewer();
                }}
              />
              <Show when={pageAnnotations().length > 0}>
                <ImageAnnotationLayer
                  strokes={pageAnnotations()}
                  aspect={imageAspect()}
                  class="nb-image-annotations"
                />
              </Show>
            </span>
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
              <ImageToolGlyph kind={`align-${align()}`} />
            </button>
            <button
              type="button"
              class="nb-image-tool"
              data-tooltip={frame() === 'polaroid' ? 'Plain frame' : 'Polaroid frame'}
              aria-label="Toggle polaroid frame"
              onClick={toggleFrame}
            >
              <ImageToolGlyph kind="frame" />
            </button>
            <Show when={placeholder() === null}>
              <button
                type="button"
                class="nb-image-tool"
                data-tooltip="Copy image"
                aria-label="Copy image"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void runPortableAction('copy');
                }}
              >
                <ImageToolGlyph kind="copy" />
              </button>
              <button
                type="button"
                class="nb-image-tool"
                data-tooltip="Download original image"
                aria-label="Download original image"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void runPortableAction('download');
                }}
              >
                <ImageToolGlyph kind="download" />
              </button>
              <button
                type="button"
                class="nb-image-tool"
                data-tooltip="View larger"
                aria-label="View image larger"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openViewer();
                }}
              >
                <ImageToolGlyph kind="expand" />
              </button>
            </Show>
          </div>
          <Show when={portableNotice()} keyed>
            {(message) => (
              <span class="nb-image-portability-note font-ui" role="status">
                {message}
              </span>
            )}
          </Show>
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

      <Show when={viewerOpen()}>
        <Portal>
          <div
            class="nb-image-viewer-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeViewer();
              }
            }}
          >
            <section
              class="nb-image-viewer"
              classList={{ 'is-fullscreen': viewerFullscreen() }}
              role="dialog"
              aria-modal="true"
              aria-label={alt().trim() === '' ? 'Image viewer' : `Image viewer: ${alt()}`}
            >
              <header class="nb-image-viewer-header">
                <div class="nb-image-viewer-title">
                  <strong>{caption().trim() || alt().trim() || 'Image'}</strong>
                  <span class="font-ui">{viewerZoom()}%</span>
                </div>
                <div class="nb-image-viewer-mode" role="group" aria-label="Image workspace mode">
                  <button
                    type="button"
                    classList={{ 'is-active': viewerMode() === 'move' }}
                    aria-pressed={viewerMode() === 'move'}
                    aria-label="Move image"
                    onClick={() => setViewerMode('move')}
                  >
                    <span aria-hidden="true">↔</span> Move
                  </button>
                  <button
                    type="button"
                    classList={{ 'is-active': viewerMode() === 'mark' }}
                    aria-pressed={viewerMode() === 'mark'}
                    aria-label="Mark up image"
                    onClick={() => setViewerMode('mark')}
                  >
                    <span aria-hidden="true">✎</span> Mark up
                  </button>
                </div>
                <div class="nb-image-viewer-actions">
                  <button
                    type="button"
                    class="is-recenter"
                    aria-label="Center"
                    onClick={recenterViewer}
                  >
                    <span aria-hidden="true">⌖</span> Center
                  </button>
                  <button type="button" aria-label="Zoom out" onClick={() => changeViewerZoom(-25)}>−</button>
                  <button type="button" aria-label="Reset zoom and position" onClick={resetViewer}>100%</button>
                  <button type="button" aria-label="Zoom in" onClick={() => changeViewerZoom(25)}>+</button>
                  <button
                    type="button"
                    aria-label={viewerFullscreen() ? 'Exit full screen' : 'Full screen image workspace'}
                    onClick={() => setViewerFullscreen((current) => !current)}
                  >
                    {viewerFullscreen() ? 'Restore' : 'Full screen'}
                  </button>
                  <button
                    type="button"
                    class="is-close"
                    aria-label="Close image viewer"
                    onClick={closeViewer}
                  >×</button>
                </div>
              </header>
              <Show when={viewerMode() === 'mark'}>
                <div class="nb-image-annotation-bar font-ui" aria-label="Marker tools">
                  <div class="nb-image-annotation-tools" role="group" aria-label="Brush type">
                    <For each={IMAGE_ANNOTATION_TOOLS}>
                      {(tool) => (
                        <button
                          type="button"
                          class="nb-image-annotation-tool"
                          classList={{ 'is-active': annotationTool() === tool }}
                          aria-pressed={annotationTool() === tool}
                          aria-label={tool === 'eraser' ? 'Eraser' : `${tool} brush`}
                          onClick={() => setAnnotationTool(tool)}
                        >
                          <span class={`is-${tool}`} aria-hidden="true" />
                          {tool}
                        </button>
                      )}
                    </For>
                  </div>
                  <span class="nb-image-annotation-divider" aria-hidden="true" />
                  <div class="nb-image-annotation-colours" role="group" aria-label="Marker colour">
                    <For each={IMAGE_ANNOTATION_COLOURS}>
                      {(colour) => (
                        <button
                          type="button"
                          class="nb-image-colour"
                          classList={{ 'is-active': annotationColour() === colour.id }}
                          style={{ '--marker-colour': colour.value }}
                          aria-label={`${colour.label} marker`}
                          aria-pressed={annotationColour() === colour.id}
                          title={colour.label}
                          onClick={() => setAnnotationColour(colour.id)}
                        />
                      )}
                    </For>
                  </div>
                  <span class="nb-image-annotation-divider" aria-hidden="true" />
                  <div class="nb-image-annotation-sizes" role="group" aria-label="Marker size">
                    <For each={IMAGE_ANNOTATION_SIZES}>
                      {(size, index) => (
                        <button
                          type="button"
                          class="nb-image-marker-size"
                          classList={{ 'is-active': annotationSize() === size }}
                          aria-label={`Marker size ${index() + 1}, ${size} pixels`}
                          aria-pressed={annotationSize() === size}
                          onClick={() => setAnnotationSize(size)}
                        >
                          <span style={{ width: `${Math.max(3, size)}px`, height: `${Math.max(3, size)}px` }} />
                        </button>
                      )}
                    </For>
                  </div>
                  <span class="nb-image-annotation-divider" aria-hidden="true" />
                  <div class="nb-image-annotation-history" role="group" aria-label="Annotation history">
                    <button type="button" disabled={annotationUndo().length === 0} aria-label="Undo marker stroke" onClick={undoAnnotation}>↶ Undo</button>
                    <button type="button" disabled={annotationRedo().length === 0} aria-label="Redo marker stroke" onClick={redoAnnotation}>↷ Redo</button>
                    <button type="button" disabled={annotations().length === 0} aria-label="Clear all image marks" onClick={clearAnnotations}>Clear</button>
                  </div>
                </div>
              </Show>
              <div
                ref={observeViewerStage}
                class="nb-image-viewer-stage"
                data-mode={viewerMode()}
                data-dragging={viewerDragging() ? '' : undefined}
                tabindex={0}
                aria-label={
                  viewerMode() === 'mark'
                    ? 'Image annotation canvas. Draw directly on the image.'
                    : 'Image canvas. Drag freely in any direction.'
                }
                onWheel={(event) => {
                  event.preventDefault();
                  const action = viewerWheelAction(event);
                  changeViewerZoom(action.delta);
                }}
                onAuxClick={(event) => event.preventDefault()}
                onPointerDown={beginViewerDrag}
                onPointerMove={moveViewerDrag}
                onPointerUp={endViewerDrag}
                onPointerCancel={endViewerDrag}
              >
                <div
                  ref={viewerArtEl}
                  class="nb-image-viewer-art"
                  style={{
                    width:
                      viewerBaseSize() === null
                        ? undefined
                        : `${viewerBaseSize()?.width}px`,
                    height:
                      viewerBaseSize() === null
                        ? undefined
                        : `${viewerBaseSize()?.height}px`,
                    transform: `translate3d(${viewerPan().x}px, ${viewerPan().y}px, 0) scale(${viewerZoom() / 100})`,
                  }}
                >
                  <img
                    ref={viewerImageEl}
                    class="nb-image-viewer-image"
                    src={displaySrc()}
                    alt={alt()}
                    draggable={false}
                    onLoad={fitViewerImage}
                  />
                  <ImageAnnotationLayer
                    strokes={annotations()}
                    aspect={imageAspect()}
                    class="nb-image-viewer-annotations"
                  />
                </div>
              </div>
              <footer class="nb-image-viewer-help font-ui">
                <Show
                  when={viewerMode() === 'mark'}
                  fallback={<>Hold the scroll wheel and drag anywhere to pan. Wheel or +/− zooms; arrows nudge; 0 fits.</>}
                >
                  Draw with pen, pencil, brush or highlighter. Hold the scroll wheel to pan; marks save with the image when you close.
                </Show>
              </footer>
            </section>
          </div>
        </Portal>
      </Show>
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
          return Number.isFinite(parsed)
            ? clampStandaloneImageWidthPct(parsed)
            : null;
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

      /**
       * Versioned vector strokes in normalised image coordinates. Keeping the
       * small JSON document on the node makes marks survive page turns,
       * restarts, library export/import, and source URL regeneration.
       */
      annotations: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-image-annotations');
          return serializeImageAnnotations(parseImageAnnotations(raw));
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const normalized = serializeImageAnnotations(
            parseImageAnnotations(attributes.annotations),
          );
          return normalized === null ? {} : { 'data-image-annotations': normalized };
        },
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

      /** One-shot display fitting for a newly uploaded full-resolution asset. */
      initialFitPending: {
        default: false,
        rendered: false,
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
