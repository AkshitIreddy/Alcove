export type AgentMessageInlineToken =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly AgentMessageInlineToken[] }
  | { readonly kind: 'emphasis'; readonly children: readonly AgentMessageInlineToken[] }
  | { readonly kind: 'code'; readonly text: string }
  | {
      readonly kind: 'link';
      readonly children: readonly AgentMessageInlineToken[];
      readonly href: string;
    };

export type AgentMessageBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly kind: 'unordered-list'; readonly items: readonly string[] }
  | { readonly kind: 'ordered-list'; readonly start: number; readonly items: readonly string[] }
  | { readonly kind: 'blockquote'; readonly text: string }
  | { readonly kind: 'code-block'; readonly language?: string; readonly text: string }
  | { readonly kind: 'table'; readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'rule' };

function safeLink(href: string): string | null {
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:'
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function isWord(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/u.test(value);
}

function delimiterCanOpen(input: string, marker: string, from: number): boolean {
  if (marker[0] !== '_') return !isWhitespace(input[from + marker.length]);
  return !isWord(input[from - 1]) && !isWhitespace(input[from + marker.length]);
}

function delimiterCanClose(input: string, marker: string, at: number): boolean {
  if (isWhitespace(input[at - 1])) return false;
  return marker[0] !== '_' || !isWord(input[at + marker.length]);
}

function closingDelimiter(input: string, marker: string, from: number): number {
  if (!delimiterCanOpen(input, marker, from)) return -1;
  let at = input.indexOf(marker, from + marker.length);
  while (at > from + marker.length && !delimiterCanClose(input, marker, at)) {
    at = input.indexOf(marker, at + marker.length);
  }
  return at;
}

/**
 * Safe recursive inline Markdown projection. It never creates or parses HTML,
 * and recursion is deliberately bounded because provider prose is untrusted.
 */
function inlineTokens(input: string, depth: number): readonly AgentMessageInlineToken[] {
  if (depth > 8) return [{ kind: 'text', text: input }];
  const tokens: AgentMessageInlineToken[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain === '') return;
    tokens.push({ kind: 'text', text: plain });
    plain = '';
  };
  for (let index = 0; index < input.length;) {
    if (
      input[index] === '\\' &&
      index + 1 < input.length &&
      /[\\`*_[\]{}()#+\-.!]/u.test(input[index + 1]!)
    ) {
      plain += input[index + 1];
      index += 2;
      continue;
    }
    if (input[index] === '[') {
      const labelEnd = input.indexOf('](', index + 1);
      const hrefEnd = labelEnd < 0 ? -1 : input.indexOf(')', labelEnd + 2);
      if (labelEnd > index + 1 && hrefEnd > labelEnd + 2) {
        const href = safeLink(input.slice(labelEnd + 2, hrefEnd));
        if (href !== null) {
          flush();
          tokens.push({
            kind: 'link',
            children: inlineTokens(input.slice(index + 1, labelEnd), depth + 1),
            href,
          });
          index = hrefEnd + 1;
          continue;
        }
      }
    }
    if (input[index] === '`') {
      const end = input.indexOf('`', index + 1);
      if (end > index + 1) {
        flush();
        tokens.push({ kind: 'code', text: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    const triple = input.startsWith('***', index)
      ? '***'
      : input.startsWith('___', index)
        ? '___'
        : null;
    if (triple !== null) {
      const end = closingDelimiter(input, triple, index);
      if (end > index + triple.length) {
        flush();
        tokens.push({
          kind: 'strong',
          children: [{
            kind: 'emphasis',
            children: inlineTokens(
              input.slice(index + triple.length, end),
              depth + 1,
            ),
          }],
        });
        index = end + triple.length;
        continue;
      }
    }
    const strong = input.startsWith('**', index)
      ? '**'
      : input.startsWith('__', index)
        ? '__'
        : null;
    if (strong !== null) {
      const end = closingDelimiter(input, strong, index);
      if (end > index + strong.length) {
        flush();
        tokens.push({
          kind: 'strong',
          children: inlineTokens(input.slice(index + strong.length, end), depth + 1),
        });
        index = end + strong.length;
        continue;
      }
    }
    if (input[index] === '*' || input[index] === '_') {
      const marker = input[index]!;
      const end = closingDelimiter(input, marker, index);
      if (end > index + 1) {
        flush();
        tokens.push({
          kind: 'emphasis',
          children: inlineTokens(input.slice(index + 1, end), depth + 1),
        });
        index = end + 1;
        continue;
      }
    }
    plain += input[index];
    index += 1;
  }
  flush();
  return tokens;
}

export function agentMessageInlineTokens(input: string): readonly AgentMessageInlineToken[] {
  return inlineTokens(input, 0);
}

const unorderedItem = (line: string): string | null =>
  line.match(/^\s*[-+*]\s+(.+)$/u)?.[1]?.trim() ?? null;

const orderedItem = (line: string): { readonly number: number; readonly text: string } | null => {
  const match = line.match(/^\s*(\d+)[.)]\s+(.+)$/u);
  return match === null ? null : { number: Number(match[1]), text: match[2]!.trim() };
};

function tableCells(line: string): readonly string[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? '';
  return line.trim() === '' ||
    /^```/u.test(line.trim()) ||
    /^#{1,3}\s+/u.test(line) ||
    /^>\s?/u.test(line) ||
    /^\s*[-+*]\s+/u.test(line) ||
    /^\s*\d+[.)]\s+/u.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line) ||
    (line.includes('|') && isTableDivider(lines[index + 1] ?? ''));
}

/**
 * Safe block Markdown used for provider chat prose. Supported structures are
 * paragraphs, headings, lists, quotes, fenced code, rules and simple tables.
 * Unknown syntax and raw HTML remain inert text.
 */
export function agentMessageBlocks(input: string): readonly AgentMessageBlock[] {
  const lines = input.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: AgentMessageBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const fence = line.trim().match(/^```([\w.+#-]*)\s*$/u);
    if (fence !== null) {
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test((lines[index] ?? '').trim())) {
        content.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        kind: 'code-block',
        ...(fence[1] ? { language: fence[1] } : {}),
        text: content.join('\n'),
      });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!.trim(),
      });
      index += 1;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }
    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      const headers = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim() !== '') {
        const cells = [...tableCells(lines[index] ?? '')];
        while (cells.length < headers.length) cells.push('');
        rows.push(cells.slice(0, headers.length));
        index += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }
    const bullet = unorderedItem(line);
    if (bullet !== null) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = unorderedItem(lines[index] ?? '');
        if (item === null) break;
        items.push(item);
        index += 1;
      }
      blocks.push({ kind: 'unordered-list', items });
      continue;
    }
    const numbered = orderedItem(line);
    if (numbered !== null) {
      const items: string[] = [];
      const start = numbered.number;
      while (index < lines.length) {
        const item = orderedItem(lines[index] ?? '');
        if (item === null) break;
        items.push(item.text);
        index += 1;
      }
      blocks.push({ kind: 'ordered-list', start, items });
      continue;
    }
    if (/^>\s?/u.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/u.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^>\s?/u, ''));
        index += 1;
      }
      blocks.push({ kind: 'blockquote', text: quoted.join(' ') });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(line.trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}
