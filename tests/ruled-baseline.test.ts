import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROSE_GRID_SELECTOR, proseGridCorrections } from '../src/editor/proseGrid';

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
    expect(proseGridCorrections([
      { ordinary: true, top: 0 },
      { ordinary: true, top: 43 },
      { ordinary: false, top: 96 },
      { ordinary: true, top: 177 },
    ], 32)).toEqual([{ index: 1, pixels: 21 }, { index: 3, pixels: 26 }]);
    expect(pageEditorSource).toContain('proseGridCorrections(');
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
    expect(PROSE_GRID_SELECTOR).toContain('[data-type="columns"]');
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
