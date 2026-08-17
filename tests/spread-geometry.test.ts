import { describe, expect, it } from 'vitest';
import {
  MAX_SPREAD_SCALE,
  MIN_SPREAD_SCALE,
  fitSpreadToRoom,
  retainInitialPageCapacity,
  stepDeskZoom,
  MIN_DESK_ZOOM,
  MAX_DESK_ZOOM,
} from '../src/views/spread';

describe('canonical book geometry', () => {
  it('uses the tighter horizontal or vertical camera fit without relayout', () => {
    expect(fitSpreadToRoom({ left: 83, right: 1417 }, { left: 88, right: 1480 }, 0, 16, 1))
      .toEqual({ shift: 34, scale: 1 });
    expect(fitSpreadToRoom({ left: -187, right: 1147 }, { left: 88, right: 940 }, 0, 16, 0.6521))
      .toEqual({ shift: 34, scale: 0.6386 });
    expect(fitSpreadToRoom({ left: 83, right: 1417 }, { left: 88, right: 1480 }, 420, 16, 0.71))
      .toEqual({ shift: 208, scale: 0.71 });
    expect(fitSpreadToRoom({ left: 186, right: 1520 }, { left: 88, right: 1686 }, 0, 16, 1.2))
      .toEqual({ shift: 34, scale: MAX_SPREAD_SCALE });
  });

  it('fails safely for hidden or degenerate rooms', () => {
    expect(fitSpreadToRoom({ left: 0, right: 0 }, { left: 88, right: 940 }, 0, 16, 1))
      .toEqual({ shift: 0, scale: 1 });
    expect(fitSpreadToRoom({ left: 0, right: 1334 }, { left: 600, right: 500 }, 0, 16, 1))
      .toEqual({ shift: 0, scale: MIN_SPREAD_SCALE });
  });

  it('never lets a later viewport measurement rewrite page capacity', () => {
    expect(retainInitialPageCapacity(0, 777.8)).toBe(777);
    expect(retainInitialPageCapacity(777, 540)).toBe(777);
    expect(retainInitialPageCapacity(777, 920)).toBe(777);
  });

  it('zooms the writing-desk camera without changing layout geometry', () => {
    expect(stepDeskZoom(1, -120, 1)).toBeGreaterThan(1);
    expect(stepDeskZoom(1, 120, 1)).toBeLessThan(1);
    expect(stepDeskZoom(1, -100_000, 3)).toBe(MAX_DESK_ZOOM);
    expect(stepDeskZoom(1, 100_000, 3)).toBe(MIN_DESK_ZOOM);
    expect(stepDeskZoom(0.9, 0, 1)).toBe(0.9);
  });
});
