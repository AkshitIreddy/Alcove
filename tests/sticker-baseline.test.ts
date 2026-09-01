import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editorCss = readFileSync(new URL('../src/styles/editor.css', import.meta.url), 'utf8');

describe('inline sticker placement', () => {
  it('keeps a margin before the drawing and sits near the writing line', () => {
    const rule = editorCss.match(
      /\.nb-node-view\[data-node-view-root='sticker'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? '';
    expect(rule).toContain('margin-inline-start: 0.22em;');
    expect(rule).toContain('margin-inline-end: 0.04em;');
    expect(rule).toContain('vertical-align: -0.08em;');
    expect(rule).toContain('line-height: 0;');
    expect(rule).not.toMatch(/(?:padding|transform|position|top|bottom)\s*:/);
  });

  it('never applies photograph chrome to ProseMirror inline sentinels', () => {
    expect(editorCss).toContain('.nb-prose img:not(.ProseMirror-separator)');
    const sentinel = editorCss.match(
      /\.nb-prose img\.ProseMirror-separator\s*\{([^}]*)\}/s,
    )?.[1] ?? '';
    expect(sentinel).toContain('width: 0 !important;');
    expect(sentinel).toContain('height: 0 !important;');
    expect(sentinel).toContain('border: 0 !important;');
    expect(sentinel).toContain('box-shadow: none;');
  });
});
