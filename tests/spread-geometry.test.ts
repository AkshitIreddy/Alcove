import { describe, expect, it } from 'vitest';
import {
  MIN_SPREAD_SCALE,
  fitSpreadToRoom,
  retainInitialPageCapacity,
} from '../src/views/spread';

describe('canonical book geometry', () => {
  it('uses the tighter horizontal or vertical camera fit without relayout', () => {
    expect(fitSpreadToRoom({ left: 83, right: 1417 }, { left: 88, right: 1480 }, 0, 16, 1))
      .toEqual({ shift: 34, scale: 1 });
    expect(fitSpreadToRoom({ left: -187, right: 1147 }, { left: 88, right: 940 }, 0, 16, 0.6521))
      .toEqual({ shift: 34, scale: 0.6386 });
    expect(fitSpreadToRoom({ left: 83, right: 1417 }, { left: 88, right: 1480 }, 420, 16, 0.71))
      .toEqual({ shift: 208, scale: 0.71 });
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
});
