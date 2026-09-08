import { describe, expect, it } from 'vitest';
import { snapshotGridCorrections } from '../src/flip/snapshotFidelity';
import { proseGridCorrections } from '../src/editor/proseGrid';

describe('destination page prose alignment', () => {
  it('aligns prose after a compact ordinary heading, just like the live editor', () => {
    expect(snapshotGridCorrections([
      { ordinary: true, top: 0 },
      { ordinary: true, top: 43 },
      { ordinary: false, top: 96 },
      { ordinary: true, top: 177 },
    ], 32)).toEqual([{ index: 1, pixels: 21 }, { index: 3, pixels: 26 }]);
  });

  it('does not move the opening block or already aligned writing', () => {
    expect(snapshotGridCorrections([
      { ordinary: true, top: 12 },
      { ordinary: true, top: 64.2 },
      { ordinary: true, top: 95.8 },
    ], 32)).toEqual([]);
  });

  it('keeps an already corrected live chain stable on the next measurement', () => {
    expect(proseGridCorrections([
      { ordinary: true, top: 0 },
      { ordinary: true, top: 43, appliedCorrection: 21 },
      { ordinary: false, top: 117 },
      { ordinary: true, top: 198, appliedCorrection: 26 },
    ], 32)).toEqual([{ index: 1, pixels: 21 }, { index: 3, pixels: 26 }]);
  });

  it('replaces stale upstream spacing after a heading changes height', () => {
    expect(proseGridCorrections([
      { ordinary: true, top: 0 },
      { ordinary: true, top: 50, appliedCorrection: 21 },
      { ordinary: false, top: 124 },
      { ordinary: true, top: 205, appliedCorrection: 26 },
    ], 32)).toEqual([{ index: 1, pixels: 14 }, { index: 3, pixels: 26 }]);
  });
});
