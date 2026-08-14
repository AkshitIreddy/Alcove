import { describe, expect, it } from 'vitest';
import { agentMessageInlineTokens } from '../src/views/rail/agentMessageMarkdown';

describe('AI agent message Markdown', () => {
  it('renders safe inline emphasis and preserves line breaks without HTML', () => {
    expect(agentMessageInlineTokens('1. **What content**\nUse `notes.md` or *plain text*.')).toEqual([
      { kind: 'text', text: '1. ' },
      { kind: 'strong', text: 'What content' },
      { kind: 'break' },
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: 'notes.md' },
      { kind: 'text', text: ' or ' },
      { kind: 'emphasis', text: 'plain text' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves incomplete or HTML-looking markup inert as text', () => {
    expect(agentMessageInlineTokens('**unfinished <img src=x onerror=alert(1)>')).toEqual([
      { kind: 'text', text: '**unfinished <img src=x onerror=alert(1)>' },
    ]);
  });
});
