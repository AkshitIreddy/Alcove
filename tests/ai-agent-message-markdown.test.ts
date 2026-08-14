import { describe, expect, it } from 'vitest';
import {
  agentMessageBlocks,
  agentMessageInlineTokens,
} from '../src/views/rail/agentMessageMarkdown';

describe('AI agent message Markdown', () => {
  it('renders safe inline emphasis and code without HTML', () => {
    expect(agentMessageInlineTokens('**What content** — use `notes.md` or *plain text*.')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'What content' }] },
      { kind: 'text', text: ' — use ' },
      { kind: 'code', text: 'notes.md' },
      { kind: 'text', text: ' or ' },
      { kind: 'emphasis', children: [{ kind: 'text', text: 'plain text' }] },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps underscores inside tool and file identifiers while supporting bounded emphasis', () => {
    expect(agentMessageInlineTokens(
      'finish_conversation and read_draft_preview_pages keep my_file_name.txt; `_code_id_`, _italic_, and __strong__.',
    )).toEqual([
      {
        kind: 'text',
        text: 'finish_conversation and read_draft_preview_pages keep my_file_name.txt; ',
      },
      { kind: 'code', text: '_code_id_' },
      { kind: 'text', text: ', ' },
      { kind: 'emphasis', children: [{ kind: 'text', text: 'italic' }] },
      { kind: 'text', text: ', and ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'strong' }] },
      { kind: 'text', text: '.' },
    ]);
    expect(agentMessageInlineTokens(String.raw`Open C:\Users\akshi\notes and show \*literal stars\*.`)).toEqual([
      {
        kind: 'text',
        text: String.raw`Open C:\Users\akshi\notes and show *literal stars*.`,
      },
    ]);
  });

  it('renders nested emphasis, code and formatted safe-link labels without marker leaks', () => {
    expect(agentMessageInlineTokens(
      '***Important takeaway***: **Huffman coding is *efficient*; use `finish_conversation`.** [**Cohere docs**](https://cohere.com)',
    )).toEqual([
      {
        kind: 'strong',
        children: [{
          kind: 'emphasis',
          children: [{ kind: 'text', text: 'Important takeaway' }],
        }],
      },
      { kind: 'text', text: ': ' },
      {
        kind: 'strong',
        children: [
          { kind: 'text', text: 'Huffman coding is ' },
          { kind: 'emphasis', children: [{ kind: 'text', text: 'efficient' }] },
          { kind: 'text', text: '; use ' },
          { kind: 'code', text: 'finish_conversation' },
          { kind: 'text', text: '.' },
        ],
      },
      { kind: 'text', text: ' ' },
      {
        kind: 'link',
        href: 'https://cohere.com/',
        children: [{
          kind: 'strong',
          children: [{ kind: 'text', text: 'Cohere docs' }],
        }],
      },
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

  it('renders the provider\'s Kirby comparison shape without leaking Markdown markers', () => {
    const blocks = agentMessageBlocks([
      '**Kirby**',
      '- **Origin**: Dream Land',
      '- **Abilities**: inhales and copies powers',
      '',
      '**Key differences**',
      '- Kirby adapts while the Powerpuff Girls coordinate',
    ].join('\n'));

    expect(blocks).toEqual([
      { kind: 'paragraph', text: '**Kirby**' },
      {
        kind: 'unordered-list',
        items: [
          '**Origin**: Dream Land',
          '**Abilities**: inhales and copies powers',
        ],
      },
      { kind: 'paragraph', text: '**Key differences**' },
      {
        kind: 'unordered-list',
        items: ['Kirby adapts while the Powerpuff Girls coordinate'],
      },
    ]);
    expect(agentMessageInlineTokens(blocks[0]!.kind === 'paragraph' ? blocks[0]!.text : '')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'Kirby' }] },
    ]);
    expect(agentMessageInlineTokens(
      blocks[1]!.kind === 'unordered-list' ? blocks[1]!.items[0]! : '',
    )).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'Origin' }] },
      { kind: 'text', text: ': Dream Land' },
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
      {
        kind: 'link',
        children: [{ kind: 'text', text: 'Cohere' }],
        href: 'https://cohere.com/',
      },
    ]);
  });
});
