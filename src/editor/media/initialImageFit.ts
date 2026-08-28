export interface InitialImageFitMeasurement {
  readonly currentWidthPct: number;
  readonly imageHeightPx: number;
  readonly blockHeightPx: number;
  readonly blockTopPx: number;
  readonly followingContentHeightPx: number;
  readonly pageCapacityPx: number;
  readonly pagePaddingBottomPx: number;
  readonly minimumWidthPct: number;
}

/**
 * Fit a newly uploaded image into the space its page can actually spare.
 *
 * This changes presentation width only. The stored asset, its intrinsic pixel
 * dimensions and the full-screen viewer source are deliberately outside this
 * calculation. Existing/manual widths are never enlarged, and the minimum
 * keeps an awkwardly crowded page from turning a photograph into a postage
 * stamp merely to save one more paragraph from normal pagination.
 */
export function initialImageWidthForPage(
  measurement: InitialImageFitMeasurement,
): number {
  const {
    currentWidthPct,
    imageHeightPx,
    blockHeightPx,
    blockTopPx,
    followingContentHeightPx,
    pageCapacityPx,
    pagePaddingBottomPx,
    minimumWidthPct,
  } = measurement;
  if (
    !Number.isFinite(currentWidthPct) ||
    !Number.isFinite(imageHeightPx) ||
    !Number.isFinite(blockHeightPx) ||
    !Number.isFinite(blockTopPx) ||
    !Number.isFinite(followingContentHeightPx) ||
    !Number.isFinite(pageCapacityPx) ||
    !Number.isFinite(pagePaddingBottomPx) ||
    imageHeightPx <= 0 ||
    blockHeightPx <= 0 ||
    pageCapacityPx <= 0
  ) {
    return currentWidthPct;
  }

  const chromeHeightPx = Math.max(0, blockHeightPx - imageHeightPx);
  const availableBlockHeightPx =
    pageCapacityPx -
    Math.max(0, blockTopPx) -
    Math.max(0, followingContentHeightPx) -
    Math.max(0, pagePaddingBottomPx);
  const availableImageHeightPx = availableBlockHeightPx - chromeHeightPx;
  if (availableImageHeightPx >= imageHeightPx) return currentWidthPct;

  const floor = Math.min(currentWidthPct, Math.max(1, minimumWidthPct));
  const fitted =
    currentWidthPct * (Math.max(0, availableImageHeightPx) / imageHeightPx);
  return Math.min(currentWidthPct, Math.max(floor, Math.floor(fitted)));
}

export interface ManualImageResizeMeasurement
  extends Omit<InitialImageFitMeasurement, 'currentWidthPct'> {
  /** Width represented by the measured image/block heights. */
  readonly measuredWidthPct: number;
  /** Width requested by the pointer before the page-fit ceiling is applied. */
  readonly requestedWidthPct: number;
}

/**
 * Clamp a live resize to the largest display width that can fit on an empty
 * leaf.
 *
 * The image's intrinsic bytes never enter this calculation. Its measured page
 * height scales linearly with display width; frame/caption chrome is retained
 * as a fixed conservative allowance. Following blocks are intentionally not
 * charged against the image: they may flow through the normal pagination
 * contract. Content above the image is charged, however, because a live drag
 * must never move the image itself to another leaf and leave it there after
 * the final width is clamped back down.
 */
export function safeManualImageResizeWidth({
  measuredWidthPct,
  requestedWidthPct,
  imageHeightPx,
  blockHeightPx,
  ...page
}: ManualImageResizeMeasurement): number {
  if (
    !Number.isFinite(measuredWidthPct) ||
    !Number.isFinite(requestedWidthPct) ||
    measuredWidthPct <= 0 ||
    requestedWidthPct <= 0
  ) {
    return requestedWidthPct;
  }
  const scale = requestedWidthPct / measuredWidthPct;
  const chromeHeightPx = Math.max(0, blockHeightPx - imageHeightPx);
  const projectedImageHeightPx = imageHeightPx * scale;
  return initialImageWidthForPage({
    ...page,
    followingContentHeightPx: 0,
    currentWidthPct: requestedWidthPct,
    imageHeightPx: projectedImageHeightPx,
    blockHeightPx: projectedImageHeightPx + chromeHeightPx,
  });
}

export interface FitImageToRemainingPageMeasurement
  extends Omit<InitialImageFitMeasurement, 'currentWidthPct'> {
  /** Width represented by the measured image/block heights. */
  readonly measuredWidthPct: number;
  /** Horizontal leaf-safe ceiling supplied by the live node view. */
  readonly maximumWidthPct: number;
}

/**
 * Enlarge an image into the genuinely unused space around it on this leaf.
 *
 * Unlike manual resizing, this action reserves both preceding and following
 * content. It therefore cannot change either neighbour's page. The result is
 * growth-only: a crowded or already overfull leaf leaves the current width
 * untouched instead of unexpectedly shrinking the reader's picture.
 */
export function fitImageWidthToRemainingPage({
  measuredWidthPct,
  maximumWidthPct,
  imageHeightPx,
  blockHeightPx,
  blockTopPx,
  followingContentHeightPx,
  pageCapacityPx,
  pagePaddingBottomPx,
}: FitImageToRemainingPageMeasurement): number {
  if (
    !Number.isFinite(measuredWidthPct) ||
    !Number.isFinite(maximumWidthPct) ||
    !Number.isFinite(imageHeightPx) ||
    !Number.isFinite(blockHeightPx) ||
    !Number.isFinite(blockTopPx) ||
    !Number.isFinite(followingContentHeightPx) ||
    !Number.isFinite(pageCapacityPx) ||
    !Number.isFinite(pagePaddingBottomPx) ||
    measuredWidthPct <= 0 ||
    maximumWidthPct <= 0 ||
    imageHeightPx <= 0 ||
    blockHeightPx <= 0 ||
    pageCapacityPx <= 0
  ) {
    return measuredWidthPct;
  }

  const chromeHeightPx = Math.max(0, blockHeightPx - imageHeightPx);
  const availableImageHeightPx =
    pageCapacityPx -
    Math.max(0, blockTopPx) -
    Math.max(0, followingContentHeightPx) -
    Math.max(0, pagePaddingBottomPx) -
    chromeHeightPx;
  if (availableImageHeightPx <= imageHeightPx) return measuredWidthPct;

  const fittedWidthPct = Math.floor(
    measuredWidthPct * (availableImageHeightPx / imageHeightPx),
  );
  return Math.max(
    measuredWidthPct,
    Math.min(maximumWidthPct, fittedWidthPct),
  );
}

export interface SafeStandaloneUploadMeasurement {
  readonly intrinsicWidth: number;
  readonly intrinsicHeight: number;
  readonly pageWidthPx: number;
  readonly pageCapacityPx: number;
  readonly maximumPageShare?: number;
}

/** Conservative first display size for an image pasted/dropped without a placeholder. */
export function safeStandaloneUploadWidth({
  intrinsicWidth,
  intrinsicHeight,
  pageWidthPx,
  pageCapacityPx,
  maximumPageShare = 0.45,
}: SafeStandaloneUploadMeasurement): number {
  if (
    !Number.isFinite(intrinsicWidth) ||
    !Number.isFinite(intrinsicHeight) ||
    !Number.isFinite(pageWidthPx) ||
    !Number.isFinite(pageCapacityPx) ||
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0 ||
    pageWidthPx <= 0 ||
    pageCapacityPx <= 0
  ) {
    return 100;
  }
  const fullWidthHeight = pageWidthPx * (intrinsicHeight / intrinsicWidth);
  const safeHeight =
    pageCapacityPx * Math.max(0.2, Math.min(0.7, maximumPageShare));
  if (fullWidthHeight <= safeHeight) return 100;
  return Math.max(
    10,
    Math.min(100, Math.floor((safeHeight / fullWidthHeight) * 100)),
  );
}

/** Decode dimensions without resampling or rewriting the uploaded file. */
export async function imageFileDimensions(
  file: Blob,
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (dimensions.width > 0 && dimensions.height > 0) return dimensions;
    } catch {
      // Fall through to an ordinary image decode below.
    }
  }
  if (typeof document === 'undefined' || typeof URL === 'undefined') return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () =>
        resolve(
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? { width: image.naturalWidth, height: image.naturalHeight }
            : null,
        );
      image.onerror = () => resolve(null);
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
