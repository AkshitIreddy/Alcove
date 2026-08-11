import { describe, expect, it } from 'vitest';
import { PAGE_STYLES } from '../src/data/types';
import { parseAttrBlock } from '../src/script/attrParser';
import {
  ATTR_ENUM_DOMAINS,
  PAPER_STYLES,
  STICKER_NAMES,
} from '../src/script/vocab';
import { EFFECT_AXES } from '../src/editor/effects/vocabulary';
import { STICKER_IDS } from '../src/editor/nodes/stickers';
import { NOTEBOOK_SCRIPT_SPEC } from '../src/editor/script/spec';
import { scriptDocToTiptap } from '../src/editor/script/toTiptap';

describe('AI-facing Notebook Script catalogue', () => {
  it('exposes every built-in sticker instead of the old fifteen-name sampler', () => {
    expect(STICKER_NAMES).toEqual(STICKER_IDS);
    expect(STICKER_NAMES).toHaveLength(50);
    for (const sticker of STICKER_NAMES) {
      expect(NOTEBOOK_SCRIPT_SPEC).toContain(`\`${sticker}\``);
    }
  });

  it('registers and documents every live trim, lettering and colour value', () => {
    for (const axis of EFFECT_AXES) {
      const values = axis.values.map((entry) => entry.value);
      expect(new Set(ATTR_ENUM_DOMAINS[axis.key])).toEqual(new Set(values));
      for (const value of values) {
        expect(NOTEBOOK_SCRIPT_SPEC).toContain(`\`${value}\``);
        const parsed = parseAttrBlock(`{${axis.key}=${value}}`, 0);
        expect(parsed.diags.filter((diag) => diag.code === 'attr-unknown-value')).toEqual([]);
      }
    }
  });

  it('lets AI-authored frontmatter select every real page paper', () => {
    const paperGuide = NOTEBOOK_SCRIPT_SPEC
      .split('\n')
      .find((line) => line.startsWith('paper: grid')) ?? '';
    for (const style of PAGE_STYLES) {
      expect(PAPER_STYLES).toContain(style);
      expect(paperGuide.split(/\s+|\|/)).toContain(style);
      const json = scriptDocToTiptap({
        frontmatter: { paper: style },
        blocks: [],
        diagnostics: [],
      });
      expect(json.attrs?.pageStyle).toBe(style);
    }
  });

  it('frames the catalogue as choice, not as a decorative checklist', () => {
    expect(NOTEBOOK_SCRIPT_SPEC).toContain(
      'The catalogue later in this guide is a palette, not a checklist.',
    );
    expect(NOTEBOOK_SCRIPT_SPEC).toContain(
      'do not use `tape=` or `washi=` by default',
    );
    expect(NOTEBOOK_SCRIPT_SPEC).toContain('complete 50-sticker subject catalogue');
  });
});
