import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emojiTextRanges } from '../src/editor/emojiBaseline';

const editorCss = readFileSync(new URL('../src/styles/editor.css', import.meta.url), 'utf8');

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

  it('gives emoji illustration spacing and keeps it close to the ruled line', () => {
    const rule = editorCss.match(/\.nb-prose \.nb-inline-emoji\s*\{([^}]*)\}/s)?.[1] ?? '';

    expect(rule).toContain('display: inline-block;');
    expect(rule).toContain('font-size: 0.9em;');
    expect(rule).toContain('line-height: 1;');
    expect(rule).toContain('margin-inline-start: 0.24em;');
    expect(rule).toContain('margin-inline-end: 0.04em;');
    expect(rule).toContain('vertical-align: 0.1em;');
    expect(rule).not.toMatch(/(?:padding|transform|position|top|bottom)\s*:/);
  });
});
