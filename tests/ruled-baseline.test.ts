import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editorCss = readFileSync(
  new URL('../src/styles/editor.css', import.meta.url),
  'utf8',
);
const pageEditorSource = readFileSync(
  new URL('../src/editor/PageEditor.tsx', import.meta.url),
  'utf8',
);

describe('ruled prose baseline', () => {
  it('keeps the visible writing edge in scale-aware contact with the rule', () => {
    expect(editorCss).toMatch(
      /--nb-rule-contact:\s*calc\(1px \* var\(--page-text-scale, 1\)\)/,
    );
    expect(editorCss).toMatch(
      /--nb-rule-lead:\s*calc\([\s\S]*?var\(--page-rule-gap, 0px\) \+\s*var\(--nb-rule-contact\)[\s\S]*?\);/,
    );
    expect(editorCss).toMatch(
      /\.nb-prose p\s*\{[\s\S]*?padding-top:\s*calc\(var\(--nb-rule-lead\)/,
    );
  });

  it('phase-checks prose after compact headings as well as feature blocks', () => {
    expect(pageEditorSource).toContain('if (!ordinary(child)) continue;');
    expect(pageEditorSource).not.toContain('ordinary(previous)');
    expect(pageEditorSource).toContain(
      'const pixels = gridSnapCorrection(laidOutTop, pitch);',
    );
    expect(pageEditorSource).toContain(
      'getComputedStyle(instance.view.dom).lineHeight',
    );
  });

  it('spends a nested-prose correction once instead of inheriting it per row', () => {
    expect(editorCss).toMatch(
      /\.nb-prose > :is\(ul, ol, blockquote, \[data-type='columns'\]\)\[data-nb-grid-snap\][\s\S]*?padding-top:\s*var\(--nb-grid-snap\)/,
    );
    expect(editorCss).toMatch(
      /\.nb-prose > :is\(ul, ol, blockquote, \[data-type='columns'\]\)\[data-nb-grid-snap\] \*[\s\S]*?--nb-grid-snap:\s*0px/,
    );
    expect(pageEditorSource).toContain('[data-type="columns"]');
  });

  it('masks page rules beneath independently spaced decorative writing', () => {
    const containers = readFileSync(
      new URL('../src/editor/nodes/containers.ts', import.meta.url),
      'utf8',
    );
    for (const type of ['marginalia', 'map-pin', 'wax-seal']) {
      expect(containers).toMatch(
        new RegExp(`'data-type': '${type}'[\\s\\S]{0,160}'data-nb-ruling-surface': ''`),
      );
    }
  });
});
