import { describe, expect, it } from 'vitest';
import {
  clampViewerPan,
  viewerWheelAction,
} from '../src/editor/media/imageViewerPan';

describe('large image viewer pan bounds', () => {
  it('allows a fitted picture to travel freely into the blank canvas', () => {
    expect(clampViewerPan({ x: 120, y: -90 }, 100, 600, 400, 800, 600)).toEqual({
      x: 120,
      y: -90,
    });

    expect(clampViewerPan({ x: 999, y: -999 }, 200, 600, 400, 800, 600)).toEqual({
      x: 999,
      y: -999,
    });
  });

  it('does not tie travel to the current zoom or image dimensions', () => {
    expect(clampViewerPan({ x: -800, y: 500 }, 300, 500, 300, 900, 700)).toEqual({
      x: -800,
      y: 500,
    });
  });

  it('recovers safely from invalid pointer coordinates', () => {
    expect(
      clampViewerPan({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, 100, 1, 1, 1, 1),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe('image viewer touchpad gestures', () => {
  it('uses ordinary wheel rotation for deliberate zoom rather than canvas travel', () => {
    expect(
      viewerWheelAction({
        deltaX: 0,
        deltaY: -42,
        deltaMode: 0,
        ctrlKey: false,
      }),
    ).toEqual({ kind: 'zoom', delta: 3.36 });
  });

  it('reserves zoom for pinch-style Ctrl+wheel and bounds its step', () => {
    expect(
      viewerWheelAction({
        deltaX: 0,
        deltaY: -1,
        deltaMode: 0,
        ctrlKey: true,
      }),
    ).toEqual({ kind: 'zoom', delta: 2 });
    expect(
      viewerWheelAction({
        deltaX: 0,
        deltaY: 900,
        deltaMode: 0,
        ctrlKey: true,
      }),
    ).toEqual({ kind: 'zoom', delta: -18 });
  });

  it('normalises line-wheel zoom and bounds a single step', () => {
    expect(
      viewerWheelAction({
        deltaX: -30,
        deltaY: 30,
        deltaMode: 1,
        ctrlKey: false,
      }),
    ).toEqual({ kind: 'zoom', delta: -18 });
  });

  it('does not turn a sideways precision-touchpad gesture into zoom', () => {
    expect(
      viewerWheelAction({
        deltaX: 96,
        deltaY: 0,
        deltaMode: 0,
        ctrlKey: false,
      }),
    ).toEqual({ kind: 'zoom', delta: 0 });
  });
});
