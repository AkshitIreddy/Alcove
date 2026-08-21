import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const effectsCss = readFileSync(
  new URL('../src/styles/effects.css', import.meta.url),
  'utf8',
);

describe('headings inside self-contained special elements', () => {
  it('removes ruled-page baseline compensation inside a card', () => {
    const rule = effectsCss.match(
      /\[data-type='card'\]\s+:is\(h1, h2, h3, h4\)\s*\{([^}]+)\}/,
    );
    expect(rule, 'card H1-H4 reset is missing').not.toBeNull();
    expect(rule?.[1]).toMatch(/padding-top:\s*0\s*;/);
    expect(rule?.[1]).toMatch(/margin:\s*0\s+0\s+var\(--space-4\)\s*;/);
    expect(rule?.[1]).toMatch(/line-height:\s*1\.2\s*;/);
  });
});
