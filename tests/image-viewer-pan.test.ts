import { describe, expect, it } from 'vitest';
import { clampViewerPan } from '../src/editor/media/imageViewerPan';

describe('large image viewer pan bounds', () => {
  it('centres a fitted picture and clamps a zoomed picture at both edges', () => {
    expect(clampViewerPan({ x: 120, y: -90 }, 100, 600, 400, 800, 600)).toEqual({
      x: 0,
      y: 0,
    });

    expect(clampViewerPan({ x: 999, y: -999 }, 200, 600, 400, 800, 600)).toEqual({
      x: 224,
      y: -124,
    });
  });

  it('keeps the final sliver reachable at the maximum zoom', () => {
    expect(clampViewerPan({ x: -800, y: 500 }, 300, 500, 300, 900, 700)).toEqual({
      x: -324,
      y: 124,
    });
  });
});
