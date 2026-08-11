import { describe, expect, it } from 'vitest';
import { emojiTextRanges } from '../src/editor/emojiBaseline';

describe('inline emoji baseline ranges', () => {
  it('keeps whole emoji sequences in one visual wrapper', () => {
    const text = 'Sparkles ✨, cat 🐈‍⬛, flag 🇮🇳, key 1️⃣.';
    expect(emojiTextRanges(text).map(({ from, to }) => text.slice(from, to))).toEqual([
      '✨',
      '🐈‍⬛',
      '🇮🇳',
      '1️⃣',
    ]);
  });

  it('does not wrap ordinary text and punctuation', () => {
    expect(emojiTextRanges('No symbols © + = or handwritten words.')).toEqual([]);
  });
});
