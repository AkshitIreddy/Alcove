import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editorCss = readFileSync(
  new URL('../src/styles/editor.css', import.meta.url),
  'utf8',
);

describe('multiline page heading rhythm', () => {
  it('uses compact heading leading instead of a two-rule line box for H1 and H2', () => {
    const rule = editorCss.match(
      /\.nb-prose h1,\s*\.nb-prose h2\s*\{([^}]+)\}/,
    );

    expect(rule, 'shared page H1/H2 rhythm is missing').not.toBeNull();
    expect(rule?.[1]).toMatch(/line-height:\s*var\(--leading-heading\)\s*;/);
    expect(rule?.[1]).not.toMatch(/line-height:\s*calc\(2\s*\*/);
  });

  it('does not add ruled-page lead above an H1 or H2', () => {
    const rule = editorCss.match(
      /\.nb-prose h1,\s*\.nb-prose h2\s*\{([^}]+)\}/,
    );

    expect(rule, 'shared page H1/H2 rhythm is missing').not.toBeNull();
    expect(rule?.[1]).toMatch(
      /padding-top:\s*var\(--nb-grid-snap,\s*0px\)\s*;/,
    );
    expect(rule?.[1]).toMatch(/margin-bottom:\s*0\s*;/);
    expect(rule?.[1]).not.toMatch(/--nb-heading-lead\s*:/);
  });
});
