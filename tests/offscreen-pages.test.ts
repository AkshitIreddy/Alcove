import { describe, expect, it } from 'vitest';
import type { PageDoc } from '../src/data/types';
import { planAheadSettlement } from '../src/flip/settleAhead';

const paragraph = (text?: string) => ({
  type: 'paragraph',
  ...(text === undefined
    ? {}
    : { content: [{ type: 'text', text }] }),
});

const doc = (...content: unknown[]): PageDoc => ({ type: 'doc', content });

describe('ahead-of-reader pagination', () => {
  it('moves the real overflow block and leaves a trailing phantom on its page', () => {
    const source = doc(paragraph('keep'), paragraph('move'), paragraph());

    expect(planAheadSettlement(source, source, 1, 1)).toEqual({
      trimmed: doc(paragraph('keep'), paragraph()),
      moved: [paragraph('move')],
    });
  });

  it('does not erase a leading empty paragraph that consumes a ruled line', () => {
    const source = doc(paragraph(), paragraph('keep'), paragraph('move'));

    expect(planAheadSettlement(source, source, 1, 0)).toEqual({
      trimmed: doc(paragraph(), paragraph('keep')),
      moved: [paragraph('move')],
    });
  });

  it('stands down after an equal-length edit instead of moving the wrong tail', () => {
    const measured = doc(paragraph('keep'), paragraph('old tail'));
    const current = doc(paragraph('keep'), paragraph('new tail'));

    expect(planAheadSettlement(current, measured, 1, 0)).toBeNull();
  });

  it('always leaves one real block standing', () => {
    const source = doc(paragraph('only'), paragraph());

    expect(planAheadSettlement(source, source, 1, 1)).toBeNull();
  });
});
