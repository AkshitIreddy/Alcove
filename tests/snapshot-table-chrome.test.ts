import { describe, expect, it } from 'vitest';
import { tableChromeNeedsContainingBlock } from '../src/flip/snapshotChrome';

describe('snapshot table chrome positioning', () => {
  it('adds a containing block only when the wrapper is still static', () => {
    expect(tableChromeNeedsContainingBlock('static')).toBe(true);
    expect(tableChromeNeedsContainingBlock('relative')).toBe(false);
    expect(tableChromeNeedsContainingBlock('absolute')).toBe(false);
    expect(tableChromeNeedsContainingBlock('fixed')).toBe(false);
    expect(tableChromeNeedsContainingBlock('sticky')).toBe(false);
  });
});
