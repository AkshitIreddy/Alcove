import { describe, expect, it } from 'vitest';
import {
  agentMessageBlocks,
  agentMessageInlineTokens,
} from '../src/views/rail/agentMessageMarkdown';

describe('AI agent message Markdown', () => {
  it('renders safe inline emphasis and code without HTML', () => {
    expect(agentMessageInlineTokens('**What content** — use `notes.md` or *plain text*.')).toEqual([
      { kind: 'strong', text: 'What content' },
      { kind: 'text', text: ' — use ' },
      { kind: 'code', text: 'notes.md' },
      { kind: 'text', text: ' or ' },
      { kind: 'emphasis', text: 'plain text' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('projects common response structures into safe semantic blocks', () => {
    const blocks = agentMessageBlocks([
      '## Limitations',
      '',
      '- Requires known frequencies',
      '- Not ideal for random data',
      '',
      '1. Count symbols',
      '2. Build the tree',
      '',
      '> A prefix code stays unambiguous.',
      '',
      '| Format | Uses Huffman |',
      '| --- | --- |',
      '| PNG | Yes |',
      '',
      '```ts',
      'const kitten = true;',
      '```',
    ].join('\n'));

    expect(blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Limitations' },
      { kind: 'unordered-list', items: ['Requires known frequencies', 'Not ideal for random data'] },
      { kind: 'ordered-list', start: 1, items: ['Count symbols', 'Build the tree'] },
      { kind: 'blockquote', text: 'A prefix code stays unambiguous.' },
      { kind: 'table', headers: ['Format', 'Uses Huffman'], rows: [['PNG', 'Yes']] },
      { kind: 'code-block', language: 'ts', text: 'const kitten = true;' },
    ]);
  });

  it('keeps malformed markup, raw HTML and unsafe links inert', () => {
    expect(agentMessageBlocks('**unfinished <img src=x onerror=alert(1)>')).toEqual([
      { kind: 'paragraph', text: '**unfinished <img src=x onerror=alert(1)>' },
    ]);
    expect(agentMessageInlineTokens('[click](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[click](javascript:alert(1))' },
    ]);
    expect(agentMessageInlineTokens('[Cohere](https://cohere.com)')).toEqual([
      { kind: 'link', text: 'Cohere', href: 'https://cohere.com/' },
    ]);
  });
});
