export interface ViewerPan {
  readonly x: number;
  readonly y: number;
}

export type ViewerWheelAction =
  | { readonly kind: 'pan'; readonly x: number; readonly y: number }
  | { readonly kind: 'zoom'; readonly delta: number };

export interface ViewerWheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey?: boolean;
}

/**
 * Interpret a mouse wheel or precision touchpad gesture for the canvas.
 * Ordinary two-axis movement pans; browser pinch gestures arrive as
 * Ctrl+wheel and are converted into deliberately small, bounded zoom steps.
 */
export function viewerWheelAction(input: ViewerWheelInput): ViewerWheelAction {
  const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 120 : 1;
  const x = Number.isFinite(input.deltaX) ? input.deltaX * unit : 0;
  const y = Number.isFinite(input.deltaY) ? input.deltaY * unit : 0;
  if (input.ctrlKey || input.metaKey === true) {
    if (y === 0) return { kind: 'zoom', delta: 0 };
    const magnitude = Math.min(18, Math.max(2, Math.abs(y) * 0.08));
    return { kind: 'zoom', delta: y < 0 ? magnitude : -magnitude };
  }
  return {
    kind: 'pan',
    x: Math.max(-240, Math.min(240, -x)),
    y: Math.max(-240, Math.min(240, -y)),
  };
}

/**
 * Normalise viewer pan without imposing an image-edge boundary.
 *
 * The image viewer is deliberately an infinite inspection desk: a reader may
 * move a fitted or zoomed image completely away and use the blank field as a
 * spatial scratch area. `Back to image` is the recovery affordance. The old
 * implementation clamped to the visible image bounds, which also meant that
 * a fitted image could not move at all.
 *
 * The geometry arguments remain in the public signature because older probes
 * and callers pass them, but panning no longer depends on zoom or image size.
 */
export function clampViewerPan(
  pan: ViewerPan,
  _zoom: number,
  _baseWidth: number,
  _baseHeight: number,
  _stageWidth: number,
  _stageHeight: number,
): ViewerPan {
  return {
    x: Number.isFinite(pan.x) ? pan.x : 0,
    y: Number.isFinite(pan.y) ? pan.y : 0,
  };
}
