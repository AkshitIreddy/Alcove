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

  it('optically seats H1 and H2 on their own rules without widening wrapped lines', () => {
    const ownRule = (level: 1 | 2): RegExpMatchArray | null =>
      [...editorCss.matchAll(new RegExp(`\\.nb-prose h${level}\\s*\\{([^}]+)\\}`, 'g'))]
        .find((match) => match[1]?.includes('--nb-heading-lead')) ?? null;
    const h1 = ownRule(1);
    const h2 = ownRule(2);

    for (const [name, rule] of [['H1', h1], ['H2', h2]] as const) {
      expect(rule, `${name} rhythm is missing`).not.toBeNull();
      expect(rule?.[1]).toMatch(/--nb-heading-lead:\s*calc\(/);
      expect(rule?.[1]).toMatch(
        /padding-top:\s*calc\(var\(--nb-heading-lead\) \+ var\(--nb-grid-snap, 0px\)\)/,
      );
      expect(rule?.[1]).toMatch(/margin-bottom:\s*0/);
      expect(rule?.[1]).not.toMatch(/margin-bottom:\s*calc\(-1/);
    }
  });
});
