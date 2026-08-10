import { describe, expect, it } from 'vitest';
import { historyWordLabel } from '../src/editor/history/pageHistory';

describe('page history labels', () => {
  it('spells out word counts instead of displaying a week-like suffix', () => {
    expect(historyWordLabel(1)).toBe('1 word');
    expect(historyWordLabel(56)).toBe('56 words');
    expect(historyWordLabel(56)).not.toContain('56w');
  });

  it('defensively normalizes invalid counts', () => {
    expect(historyWordLabel(Number.NaN)).toBe('0 words');
    expect(historyWordLabel(-4)).toBe('0 words');
  });
});
