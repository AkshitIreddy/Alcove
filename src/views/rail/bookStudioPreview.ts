/**
 * Geometry and navigation vocabulary for Book Studio's live preview.
 *
 * The preview is a real renderer canvas, so the interaction layer must use the
 * exact same book rectangle as `BookStudio`: one scale, one baseline, and the
 * real thickness/height. Renderer-owned spine targets are projected here,
 * away from JSX, so pixel geometry can change without disturbing keyboard /
 * focus behaviour or either responsive preview home.
 */

import { coverCompositionLayout } from '../../art/covers';
import type { TitlePlateStyle } from '../../art/spines';

export type BookPreviewFace = 'spine' | 'cover';

/** A stable destination in the long Studio sheet. */
export type BookStudioControlTarget =
  | 'binding'
  | 'binding-shape'
  | 'binding-material'
  | 'binding-decoration'
  | 'binding-gilt'
  | 'format'
  | 'thickness'
  | 'title-plate'
  | 'title-font'
  | 'title-gilt'
  | 'palette'
  | 'spine-base-colour'
  | 'spine-accent-colour'
  | 'cover-base-colour'
  | 'cover-accent-colour'
  | 'tooling-colour'
  | 'emblem-colour'
  | 'bands'
  | 'endbands'
  | 'ornament'
  | 'wear'
  | 'edge'
  | 'cover-frame';

export interface PreviewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BookPreviewHotspot {
  /** Unique within one face. */
  id: string;
  face: BookPreviewFace;
  label: string;
  /** Short visible callout shown on hover/focus. */
  shortLabel: string;
  target: BookStudioControlTarget;
  rect: PreviewRect;
  /** Optional feature is absent; the preview shows a small add affordance. */
  absent?: boolean;
  /** Background targets sit underneath the smaller, more specific marks. */
  layer: 'body' | 'detail' | 'fitting';
}

export interface BookPreviewGeometryInput {
  canvasWidth: number;
  canvasHeight: number;
  stageScale: number;
  baseline: number;
  height: number;
  thickness: number;
  coverAspect: number;
  raisedBands: number;
  headTail: boolean;
  ornament: number;
  /**
   * Cover furniture consumed by `coverCompositionLayout()`. Live Studio
   * callers provide all three so the transparent title and medallion buttons
   * follow the renderer when a plate changes family (round, heraldic, band,
   * ticket, ...). They remain optional for old isolated specimens.
   */
  coverTitlePlate?: TitlePlateStyle;
  coverFrame?: number;
  coverMedallion?: number;
  /** Optional exact boxes retained for older preview harnesses. */
  spineTargets?: {
    title?: PreviewRect | null;
    raisedBands: readonly PreviewRect[];
    ornament: PreviewRect | null;
    endbands: readonly PreviewRect[];
  };
}

export interface BookPreviewGeometry {
  spine: PreviewRect;
  cover: PreviewRect;
  hotspots: readonly BookPreviewHotspot[];
}

const MIN_HIT = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rect(left: number, top: number, width: number, height: number): PreviewRect {
  return { left, top, width, height };
}

/**
 * Keep a target easy to press without lying about where its rendered mark is.
 * The centre remains fixed and the expanded box stays inside the preview.
 */
function tappable(
  source: PreviewRect,
  canvasWidth: number,
  canvasHeight: number,
  minWidth = MIN_HIT,
  minHeight = MIN_HIT,
): PreviewRect {
  const width = Math.min(canvasWidth, Math.max(source.width, minWidth));
  const height = Math.min(canvasHeight, Math.max(source.height, minHeight));
  const cx = source.left + source.width / 2;
  const cy = source.top + source.height / 2;
  return rect(
    clamp(cx - width / 2, 0, canvasWidth - width),
    clamp(cy - height / 2, 0, canvasHeight - height),
    width,
    height,
  );
}

function inset(source: PreviewRect, x: number, y: number): PreviewRect {
  return rect(
    source.left + x,
    source.top + y,
    Math.max(1, source.width - x * 2),
    Math.max(1, source.height - y * 2),
  );
}

/** Project one renderer-normalized spine box into preview-canvas pixels. */
function spineTargetRect(spine: PreviewRect, normalized: PreviewRect): PreviewRect {
  return rect(
    spine.left + normalized.left * spine.width,
    spine.top + normalized.top * spine.height,
    normalized.width * spine.width,
    normalized.height * spine.height,
  );
}

/**
 * Reproduce the cover painter's *layout* projection, not a second aesthetic
 * guess. `renderCoverInto()` owns the composition decision through
 * `coverCompositionLayout()` and then derives its drawable face from the
 * board, page-edge and spine-strip measurements below. Keeping those exact
 * ratios here makes an invisible hit target agree with the pixels it edits.
 *
 * The returned rectangles are in preview-canvas coordinates. They describe
 * the painted title plate and the full medallion field before the 24px input
 * affordance is applied.
 */
export function coverCompositionTargetRects(
  cover: PreviewRect,
  options: Pick<
    BookPreviewGeometryInput,
    'coverTitlePlate' | 'coverFrame' | 'coverMedallion'
  >,
): { title: PreviewRect; medallion: PreviewRect } {
  const w = cover.width;
  const h = cover.height;
  const pad = Math.min(w, h) * 0.016;
  const pageW = Math.max(4, w * 0.055);
  const bx = pad;
  const by = pad;
  const bw = w - pad * 2 - pageW * 0.62;
  const bh = h - pad * 2;
  const spineW = bw * 0.13;
  const faceX = bx + spineW;
  const faceW = bw - spineW;
  const composition = coverCompositionLayout(
    options.coverTitlePlate ?? 'label',
    options.coverFrame ?? 0,
    options.coverMedallion ?? 0,
    false,
  );

  const labelW = faceW * composition.titleWidth;
  const labelH = Math.min(bh * composition.titleHeight, labelW * 0.62);
  const labelX = faceX + (faceW - labelW) / 2;
  const labelY = by + bh * composition.titleCenterY - labelH / 2;
  const medR = Math.min(faceW, bh) * composition.medallionScale;
  const medX = faceX + faceW * 0.5;
  const medY = by + bh * composition.medallionCenterY;

  return {
    title: rect(
      cover.left + labelX,
      cover.top + labelY,
      labelW,
      labelH,
    ),
    medallion: rect(
      cover.left + medX - medR,
      cover.top + medY - medR,
      medR * 2,
      medR * 2,
    ),
  };
}

/**
 * Calculate all preview hit regions from the same dimensions the painters use.
 * Optional binding structure remains reachable as compact `+` targets at the
 * place it would appear. Retired hardware and charms do not leave phantom
 * click regions behind.
 */
export function bookPreviewGeometry(input: BookPreviewGeometryInput): BookPreviewGeometry {
  const bookHeight = clamp(input.height * input.stageScale, 1, input.canvasHeight);
  const top = clamp(input.baseline - bookHeight, 0, input.canvasHeight - bookHeight);
  const spineWidth = clamp(input.thickness * input.stageScale, 1, input.canvasWidth);
  const coverWidth = clamp(bookHeight * input.coverAspect, 1, input.canvasWidth);
  const spine = rect((input.canvasWidth - spineWidth) / 2, top, spineWidth, bookHeight);
  const cover = rect((input.canvasWidth - coverWidth) / 2, top, coverWidth, bookHeight);

  const hasExactSpineTargets = input.spineTargets !== undefined;
  const exactBands = input.spineTargets?.raisedBands ?? [];
  const exactOrnament = input.spineTargets?.ornament;
  const exactEndbands = input.spineTargets?.endbands ?? [];
  const bandsPresent = hasExactSpineTargets
    ? exactBands.length > 0
    : input.raisedBands > 0;
  const endbandsPresent = hasExactSpineTargets
    ? exactEndbands.length > 0
    : input.headTail;
  const ornamentPresent = hasExactSpineTargets
    ? exactOrnament !== null && exactOrnament !== undefined
    : input.ornament >= 0;
  const cordY = spine.top + spine.height * 0.23;
  const ornamentY = spine.top + spine.height * 0.7;
  const coverInner = inset(cover, Math.max(10, cover.width * 0.09), Math.max(12, cover.height * 0.07));
  const coverCompositionTargets = coverCompositionTargetRects(cover, input);

  const bandHotspots: BookPreviewHotspot[] = exactBands.length > 0
    ? exactBands.map((band, index) => ({
        id: `spine-cord-${index + 1}`,
        face: 'spine',
        label: `Edit raised cord ${index + 1} of ${exactBands.length}`,
        shortLabel: exactBands.length > 1 ? `cord ${index + 1}` : 'cords',
        target: 'bands',
        rect: tappable(
          spineTargetRect(spine, band),
          input.canvasWidth,
          input.canvasHeight,
          Math.max(MIN_HIT, spine.width + 12),
        ),
        layer: 'fitting',
      }))
    : [{
        id: 'spine-cords',
        face: 'spine',
        label: bandsPresent ? 'Edit raised cords' : 'Add raised cords',
        shortLabel: bandsPresent ? 'cords' : 'add cords',
        target: 'bands',
        rect: tappable(
          rect(spine.left - 5, cordY - 5, spine.width + 10, 10),
          input.canvasWidth,
          input.canvasHeight,
          Math.max(MIN_HIT, spine.width + 12),
        ),
        absent: !bandsPresent,
        layer: 'fitting',
      }];

  const endbandHotspots: BookPreviewHotspot[] = exactEndbands.length > 0
    ? exactEndbands.map((band, index) => {
        const atTop = band.top + band.height / 2 < 0.5;
        return {
          id: `spine-endband-${atTop ? 'head' : 'tail'}-${index + 1}`,
          face: 'spine',
          label: `Edit ${atTop ? 'head' : 'tail'} endband`,
          shortLabel: atTop ? 'headband' : 'tailband',
          target: 'endbands',
          rect: tappable(
            spineTargetRect(spine, band),
            input.canvasWidth,
            input.canvasHeight,
            Math.max(MIN_HIT, spine.width + 10),
          ),
          layer: 'fitting',
        } satisfies BookPreviewHotspot;
      })
    : [{
        id: 'spine-endbands',
        face: 'spine',
        label: endbandsPresent ? 'Edit endbands' : 'Add endbands',
        shortLabel: endbandsPresent ? 'endbands' : 'add endbands',
        target: 'endbands',
        rect: tappable(
          rect(spine.left - 3, spine.top + spine.height - 7, spine.width + 6, 7),
          input.canvasWidth,
          input.canvasHeight,
          Math.max(MIN_HIT, spine.width + 10),
        ),
        absent: !endbandsPresent,
        layer: 'fitting',
      }];

  const frameEdges = [
    ['top', rect(coverInner.left, coverInner.top - 5, coverInner.width, 10)],
    ['right', rect(coverInner.left + coverInner.width - 5, coverInner.top, 10, coverInner.height)],
    ['bottom', rect(coverInner.left, coverInner.top + coverInner.height - 5, coverInner.width, 10)],
    ['left', rect(coverInner.left - 5, coverInner.top, 10, coverInner.height)],
  ] as const;
  const frameHotspots: BookPreviewHotspot[] = frameEdges.map(([edgeName, edgeRect]) => ({
    id: `cover-frame-${edgeName}`,
    face: 'cover',
    label: `Edit cover frame from its ${edgeName} edge`,
    shortLabel: 'frame',
    target: 'cover-frame',
    rect: tappable(
      edgeRect,
      input.canvasWidth,
      input.canvasHeight,
      edgeName === 'top' || edgeName === 'bottom' ? Math.min(coverInner.width, 72) : 18,
      edgeName === 'left' || edgeName === 'right' ? Math.min(coverInner.height, 72) : 18,
    ),
    layer: 'detail',
  }));

  const hotspots: BookPreviewHotspot[] = [
    // Spine body and silhouette are deliberately broad, low-layer targets.
    {
      id: 'spine-cloth',
      face: 'spine',
      label: 'Edit spine cloth colour',
      shortLabel: 'cloth',
      target: 'spine-base-colour',
      rect: tappable(
        rect(spine.left, spine.top + spine.height * 0.4, spine.width * 0.34, spine.height * 0.18),
        input.canvasWidth,
        input.canvasHeight,
      ),
      layer: 'body',
    },
    {
      id: 'spine-shape',
      face: 'spine',
      label: 'Edit spine shape',
      shortLabel: 'shape',
      target: 'binding-shape',
      rect: tappable(
        rect(spine.left, spine.top, spine.width, Math.min(22, spine.height * 0.1)),
        input.canvasWidth,
        input.canvasHeight,
      ),
      layer: 'detail',
    },
    ...bandHotspots,
    ...endbandHotspots,
    {
      id: 'spine-ornament',
      face: 'spine',
      label: ornamentPresent ? 'Edit the book emblem' : 'Add a book emblem',
      shortLabel: ornamentPresent ? 'emblem' : 'add emblem',
      target: 'ornament',
      rect: tappable(
        exactOrnament === undefined || exactOrnament === null
          ? rect(spine.left + spine.width * 0.18, ornamentY - 11, spine.width * 0.64, 22)
          : spineTargetRect(spine, exactOrnament),
        input.canvasWidth,
        input.canvasHeight,
      ),
      absent: !ornamentPresent,
      layer: 'fitting',
    },
    {
      id: 'spine-edge',
      face: 'spine',
      label: 'Edit page edges and wear',
      shortLabel: 'edge',
      target: 'edge',
      rect: tappable(
        rect(spine.left + spine.width - 5, spine.top + spine.height * 0.82, 7, 18),
        input.canvasWidth,
        input.canvasHeight,
      ),
      layer: 'detail',
    },
    // Cover: a quiet body target sits behind concrete fittings and tooling.
    {
      id: 'cover-cloth',
      face: 'cover',
      label: 'Edit cover cloth colour',
      shortLabel: 'cloth',
      target: 'cover-base-colour',
      rect: tappable(
        rect(coverInner.left, cover.top + cover.height * 0.4, cover.width * 0.22, cover.height * 0.18),
        input.canvasWidth,
        input.canvasHeight,
      ),
      layer: 'body',
    },
    ...frameHotspots,
    {
      id: 'cover-title',
      face: 'cover',
      label: 'Edit cover title treatment',
      shortLabel: 'title',
      target: 'title-plate',
      rect: tappable(
        coverCompositionTargets.title,
        input.canvasWidth,
        input.canvasHeight,
        42,
        34,
      ),
      layer: 'detail',
    },
    {
      id: 'cover-emblem',
      face: 'cover',
      label: ornamentPresent ? 'Edit the book emblem' : 'Add a book emblem',
      shortLabel: ornamentPresent ? 'emblem' : 'add emblem',
      target: 'ornament',
      rect: tappable(
        coverCompositionTargets.medallion,
        input.canvasWidth,
        input.canvasHeight,
        34,
        34,
      ),
      absent: !ornamentPresent,
      layer: 'fitting',
    },
    {
      id: 'cover-edge',
      face: 'cover',
      label: 'Edit page edges and wear',
      shortLabel: 'edge',
      target: 'edge',
      rect: tappable(
        // The closed-cover painter exposes the text block as the pale outer
        // strip on the fore edge. Keeping this behind the right frame target
        // makes both visible pieces independently selectable.
        rect(
          cover.left + cover.width - 7,
          cover.top + cover.height * 0.36,
          7,
          cover.height * 0.28,
        ),
        input.canvasWidth,
        input.canvasHeight,
      ),
      layer: 'body',
    },
  ];

  return { spine, cover, hotspots };
}

export function previewRectStyle(rectangle: PreviewRect): Record<string, string> {
  return {
    '--nb-hotspot-left': `${rectangle.left}px`,
    '--nb-hotspot-top': `${rectangle.top}px`,
    '--nb-hotspot-width': `${rectangle.width}px`,
    '--nb-hotspot-height': `${rectangle.height}px`,
  };
}
