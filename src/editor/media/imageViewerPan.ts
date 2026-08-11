export interface ViewerPan {
  readonly x: number;
  readonly y: number;
}

/**
 * Keep a zoomed picture reachable without letting it be flung out of sight.
 * Base dimensions are the fitted, untransformed image box; zoom is a percent.
 */
export function clampViewerPan(
  pan: ViewerPan,
  zoom: number,
  baseWidth: number,
  baseHeight: number,
  stageWidth: number,
  stageHeight: number,
): ViewerPan {
  const scale = Math.max(0.5, Math.min(3, zoom / 100));
  const maxX = Math.max(0, (baseWidth * scale - stageWidth) / 2 + 24);
  const maxY = Math.max(0, (baseHeight * scale - stageHeight) / 2 + 24);
  return {
    x: maxX === 0 ? 0 : Math.max(-maxX, Math.min(maxX, pan.x)),
    y: maxY === 0 ? 0 : Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}
