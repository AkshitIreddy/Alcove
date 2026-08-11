import { describe, expect, it } from 'vitest';
import {
  AI_SPEC_STYLE_PRESETS,
  composeNotebookScriptSpec,
  createCustomAiSpecStyle,
} from '../src/editor/script/aiStylePresets';

describe('AI guide creative directions', () => {
  it('ships distinct non-prescriptive moods and inserts one before the guide', () => {
    expect(AI_SPEC_STYLE_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(AI_SPEC_STYLE_PRESETS.map((preset) => preset.prompt)).size).toBe(
      AI_SPEC_STYLE_PRESETS.length,
    );
    const result = composeNotebookScriptSpec(AI_SPEC_STYLE_PRESETS[0], '# Notebook Script\n\nRules');
    expect(result).toContain('## Creative direction chosen by the reader');
    expect(result).toContain('### Intent');
    expect(result).toContain('### Creative latitude');
    expect(result).toContain('### Quality bar');
    expect(result).toContain('Prefer meaningful variation over repeated motifs');
    expect(result.indexOf('Creative direction')).toBeLessThan(result.indexOf('Rules'));
    expect(result).toContain('not a rigid recipe');
    expect(result).toContain('return only the improved final file');
  });

  it('gives every direction enough context without dictating page furniture', () => {
    for (const preset of AI_SPEC_STYLE_PRESETS) {
      expect(preset.prompt.length).toBeGreaterThan(350);
      expect(preset.prompt).not.toMatch(/must use|always use|exactly [0-9]/i);
    }
  });

  it('trims and bounds a borrowed custom direction', () => {
    const custom = createCustomAiSpecStyle({
      name: '  My bright seminar  ',
      prompt: `  ${'warm '.repeat(700)}  `,
      basedOn: 'visual-learning',
    });
    expect(custom?.name).toBe('My bright seminar');
    expect(custom?.prompt.length).toBeLessThanOrEqual(2400);
    expect(custom?.custom).toBe(true);
    expect(custom?.basedOn).toBe('visual-learning');
  });
});
