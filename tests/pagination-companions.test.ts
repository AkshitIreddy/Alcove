import { describe, expect, it } from 'vitest';
import { trailingCompanionCount } from '../src/editor/pagination';

describe('pagination semantic companions', () => {
  it('moves a colon lead-in and its heading with an overflowing feature', () => {
    const blocks = [
      { type: 'paragraph', text: 'Earlier explanation.' },
      { type: 'heading', text: 'Transmission example' },
      { type: 'paragraph', text: 'This gives the recursive structure:' },
      { type: 'diagram', text: '' },
    ];
    expect(trailingCompanionCount(blocks, 1)).toBe(2);
  });

  it('does not move ordinary prose or the only block left standing', () => {
    expect(
      trailingCompanionCount(
        [
          { type: 'paragraph', text: 'Earlier explanation.' },
          { type: 'paragraph', text: 'This is a complete thought.' },
          { type: 'table', text: 'A B' },
        ],
        1,
      ),
    ).toBe(0);
    expect(
      trailingCompanionCount(
        [
          { type: 'paragraph', text: 'Goals:' },
          { type: 'bulletList', text: 'One Two' },
        ],
        1,
      ),
    ).toBe(0);
  });
});
