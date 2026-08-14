export type AgentMessageInlineToken =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'emphasis'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'break' };

/**
 * Tiny, deliberately non-HTML Markdown projection for provider chat prose.
 * The panel needs emphasis and inline code, not an HTML execution surface.
 * Unknown or incomplete markup remains visible as ordinary text.
 */
export function agentMessageInlineTokens(input: string): readonly AgentMessageInlineToken[] {
  const tokens: AgentMessageInlineToken[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain === '') return;
    tokens.push({ kind: 'text', text: plain });
    plain = '';
  };
  const paired = (
    marker: string,
    from: number,
    kind: 'strong' | 'emphasis' | 'code',
  ): number | null => {
    const end = input.indexOf(marker, from + marker.length);
    if (end <= from + marker.length) return null;
    const text = input.slice(from + marker.length, end);
    if (text.includes('\n')) return null;
    flush();
    tokens.push({ kind, text });
    return end + marker.length;
  };

  for (let index = 0; index < input.length;) {
    if (input[index] === '\n') {
      flush();
      tokens.push({ kind: 'break' });
      index += 1;
      continue;
    }
    if (input.startsWith('**', index) || input.startsWith('__', index)) {
      const next = paired(input.slice(index, index + 2), index, 'strong');
      if (next !== null) {
        index = next;
        continue;
      }
    }
    if (input[index] === '`') {
      const next = paired('`', index, 'code');
      if (next !== null) {
        index = next;
        continue;
      }
    }
    if (input[index] === '*' || input[index] === '_') {
      const next = paired(input[index]!, index, 'emphasis');
      if (next !== null) {
        index = next;
        continue;
      }
    }
    plain += input[index];
    index += 1;
  }
  flush();
  return tokens;
}
