import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const icons = readFileSync(resolve(ROOT, 'src/views/rail/icons.tsx'), 'utf8');
const agent = icons.match(
  /export function AgentIcon\(\): JSX\.Element \{([\s\S]*?)\n\}\n\n\/\*\*/,
)?.[1] ?? '';

describe('AgentIcon source contract', () => {
  it('is an authored toy robot face rather than the retired open-book mark', () => {
    expect(agent).not.toBe('');
    expect(agent).toContain('data-part="head"');
    expect(agent).toContain('data-part="antenna"');
    expect(agent).toContain('data-part="ears"');
    expect(agent).toContain('data-part="eyes"');
    expect(agent).toContain('data-part="smile"');
    expect(agent.match(/<path/g)).toHaveLength(5);
    expect(agent).not.toContain('open page');
    expect(agent).not.toContain('spark');
  });

  it('stays in the pre-wobbled, single-currentColor rail vocabulary', () => {
    expect(agent).toContain('{...S}');
    expect(agent).toContain('fill="currentColor"');
    expect(agent).not.toMatch(/filter=|gradient|shadow|#[0-9a-f]{3,8}/i);
    expect(agent).not.toMatch(/stroke="(?!currentColor)/);
    expect(agent).not.toMatch(/stroke-width="(?:0|[3-9]|\d{2,})/);
  });

  it('is instantiated by every real Agent surface and compact selection tool', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');
    const rail = readFileSync(resolve(ROOT, 'src/views/rail/BookRail.tsx'), 'utf8');
    const selection = readFileSync(resolve(ROOT, 'src/editor/toolbar/SelectionToolbar.tsx'), 'utf8');

    expect(rail).toContain('icon: AgentIcon');
    expect(panel.match(/<AgentIcon \/>/g)?.length).toBeGreaterThanOrEqual(5);
    expect(selection).toContain('<AgentIcon />');
  });
});
