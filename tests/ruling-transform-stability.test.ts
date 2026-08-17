import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rulings = readFileSync(new URL('../src/styles/rulings.css', import.meta.url), 'utf8');
const spread = readFileSync(new URL('../src/styles/spread.css', import.meta.url), 'utf8');
const rail = readFileSync(new URL('../src/styles/rail.css', import.meta.url), 'utf8');

function block(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `${selector} must exist`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  expect(open, `${selector} must open a declaration block`).toBeGreaterThan(start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`${selector} declaration block is unclosed`);
}

describe('ruled paper under the canonical camera transform', () => {
  it('paints ruled paper from one explicit layout-pitch tile', () => {
    const ruled = block(rulings, ".nb-page[data-style='ruled']");
    expect(ruled).toContain('--rule-image: linear-gradient(');
    expect(ruled).not.toContain('repeating-linear-gradient(');
    expect(ruled).toContain('--rule-size: 100% var(--rule);');
    expect(ruled).toContain('--rule-pos: 0 0;');
    expect(ruled).toContain('--rule-repeat: repeat-y;');
  });

  it('keeps the page ruling plane on the untransformed fixed leaf', () => {
    const page = block(spread, '.nb-spread .nb-page[data-style]');
    expect(page).toContain('background-image: var(--rule-image, none);');
    expect(page).toContain('background-size: var(--rule-size, auto);');
    expect(page).toContain('background-position: var(--rule-pos, 0 0);');
    expect(page).toContain('background-repeat: var(--rule-repeat, repeat);');

    const frame = block(spread, '.nb-spread-fit-frame');
    expect(frame).toContain('width: 1334px;');
    expect(frame).toContain('height: 869px;');
    expect(frame).not.toMatch(/\b(?:max-)?width\s*:\s*(?:min|clamp)\(/);
    expect(frame).not.toMatch(/\b(?:max-)?height\s*:\s*(?:min|clamp)\(/);

    const camera = block(rail, '.nb-book-view .nb-spread-fit-frame');
    expect(camera).toContain('scale(var(--nb-spread-fit))');
  });
});
