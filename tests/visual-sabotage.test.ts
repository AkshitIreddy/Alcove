import { describe, expect, it } from 'vitest';

import { sabotageColour } from '../shots-now/visual-sabotage.mjs';
import { beginSettle, observeSettle } from '../shots-now/visual-settle.mjs';

describe('visual-suite sabotage', () => {
  it('does not repeat a state inside the 30-second settle budget', () => {
    const states = Array.from({ length: 151 }, (_, tick) => sabotageColour(tick));
    expect(new Set(states).size).toBe(states.length);
  });

  it('has a full 256-tick period', () => {
    expect(sabotageColour(0)).toBe(sabotageColour(256));
    expect(sabotageColour(0)).not.toBe(sabotageColour(255));
  });
});

describe('visual-suite settling', () => {
  it('does not mistake the old aliased sample trace for rest', () => {
    const samples: Array<[string, number]> = [
      ['A', 0],
      ['B', 320],
      ['B', 640],
      ['A', 960],
      ['A', 1_280],
      ['A', 1_600],
      ['B', 1_920],
    ];
    let state = beginSettle(samples[0][0], samples[0][1]);
    const verdicts = samples.slice(1).map(([signature, at]) => {
      const result = observeSettle(state, signature, at, 1_200);
      state = result.state;
      return result.settled;
    });
    expect(verdicts).not.toContain(true);
  });

  it('requires three unchanged observations spanning the time floor', () => {
    let state = beginSettle('still', 0);
    for (const at of [400, 800]) {
      const result = observeSettle(state, 'still', at, 1_200);
      state = result.state;
      expect(result.settled).toBe(false);
    }
    expect(observeSettle(state, 'still', 1_200, 1_200).settled).toBe(true);
  });
});
