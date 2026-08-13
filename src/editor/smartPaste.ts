/**
 * High-confidence clipboard structure recognition for the page editor.
 *
 * Browsers already hand rich HTML (including spreadsheet tables) to
 * ProseMirror.  This module is the plain-text fallback: it upgrades only
 * payloads whose structure is explicit enough that treating them as prose
 * would clearly lose information.  Everything else returns null and keeps
 * the editor's ordinary paste path.
 */
import type { TiptapNode } from './script/toTiptap';
import { scriptDocToTiptap } from './script/toTiptap';
import { parse } from '../script';

export type StructuredPasteKind =
  | 'table'
  | 'json-table'
  | 'code'
  | 'notebook-script';

export interface StructuredPaste {
  readonly kind: StructuredPasteKind;
  readonly script: string;
}

function parseDelimitedRows(source: string, delimiter: ',' | '\t'): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (delimiter === ',' && character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += character;
  }
  if (quoted) return null;
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  if (rows.length < 2) return null;
  const width = rows[0]?.length ?? 0;
  if (width < 2 || width > 24 || rows.some((candidate) => candidate.length !== width)) {
    return null;
  }
  return rows;
}

function safeCell(value: unknown): string {
  const text = typeof value === 'string'
    ? value
    : value === null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return text.replace(/\r?\n/g, ' ↵ ').replace(/\|/g, '\\|').trim();
}

const MAX_TABLE_ROWS_PER_BLOCK = 18;

function oneMarkdownTable(rows: readonly (readonly unknown[])[]): string {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  return [
    `| ${header.map(safeCell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.map(safeCell).join(' | ')} |`),
  ].join('\n');
}

/**
 * Preserve every row while keeping each native table shorter than one page.
 * The header is repeated on continuation blocks so a page break never severs
 * values from their column meaning.
 */
function rowsToMarkdown(rows: readonly (readonly unknown[])[]): string {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  if (body.length <= MAX_TABLE_ROWS_PER_BLOCK - 1) return oneMarkdownTable(rows);
  const chunks: string[] = [];
  for (let start = 0; start < body.length; start += MAX_TABLE_ROWS_PER_BLOCK - 1) {
    chunks.push(oneMarkdownTable([header, ...body.slice(start, start + MAX_TABLE_ROWS_PER_BLOCK - 1)]));
  }
  return chunks.join('\n\n');
}

function jsonTable(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const records = value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
  if (records.length !== value.length) return null;
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  if (columns.length < 2 || columns.length > 24) return null;
  return rowsToMarkdown([
    columns,
    ...records.map((record) => columns.map((column) => record[column])),
  ]);
}

function inferCodeLanguage(source: string): string | null {
  const trimmed = source.trim();
  if (/^(?:#!.*\b(?:bash|sh)|(?:export\s+)?(?:async\s+)?function\b|const\s+\w+\s*=|let\s+\w+\s*=|import\s.+\sfrom\s)/m.test(trimmed)) return 'javascript';
  if (/^(?:from\s+\S+\s+import\s+|import\s+\S+|def\s+\w+\s*\(|class\s+\w+.*:)/m.test(trimmed)) return 'python';
  if (/^(?:SELECT|WITH|INSERT|UPDATE|DELETE|CREATE\s+TABLE)\b[\s\S]*\b(?:FROM|INTO|SET|AS)\b/im.test(trimmed)) return 'sql';
  if (/^\s*<[!/?A-Za-z][\s\S]*>\s*$/.test(trimmed)) return 'html';
  if (/^(?:[.#]?[A-Za-z][\w .#:[\]="'-]*)\s*\{[\s\S]*:[^;{}]+;/m.test(trimmed)) return 'css';
  if (/^(?:fn\s+\w+|use\s+\S+|impl\s+\w+|struct\s+\w+)/m.test(trimmed)) return 'rust';
  if (/^(?:public|private|protected|class|interface|package)\s+[A-Za-z]/m.test(trimmed) && /[;{}]/.test(trimmed)) return 'java';
  if (/^[\t ]{2,}\S/m.test(source) && /(?:=>|==|:=|\breturn\b|[{};])/.test(source)) return 'plaintext';
  return null;
}

function looksLikeNotebookScript(source: string): boolean {
  const lines = source.trim().split(/\r?\n/);
  if (/^(?:```|:::|::page\b|---\s*$)/m.test(source)) return true;
  if (lines.some((line, index) => /^\|.*\|\s*$/.test(line) && /^\|?\s*:?-{3}/.test(lines[index + 1] ?? ''))) return true;
  const structural = lines.filter((line) =>
    /^(?:#{1,3}\s+|>\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/.test(line),
  ).length;
  return structural >= 2;
}

export function classifyStructuredPaste(source: string): StructuredPaste | null {
  const clean = source.replace(/\u0000/g, '').trim();
  if (clean === '') return null;

  // A compact JSON array copied from a console/API often occupies one line;
  // do not require a newline before giving record-shaped JSON its table form.
  if (/^[\[{]/.test(clean)) {
    try {
      const value: unknown = JSON.parse(clean);
      const table = jsonTable(value);
      if (table !== null) return { kind: 'json-table', script: table };
      return { kind: 'code', script: `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`` };
    } catch {
      // A brace at the start is not enough evidence to steal an ordinary paste.
    }
  }
  if (clean.includes('\t')) {
    const rows = parseDelimitedRows(clean, '\t');
    if (rows !== null) return { kind: 'table', script: rowsToMarkdown(rows) };
  }

  const csv = clean.includes(',') ? parseDelimitedRows(clean, ',') : null;
  // Two ordinary sentences containing commas are not a spreadsheet. CSV
  // needs a header plus two data rows; TSV retains the stronger clipboard
  // signal and may legitimately contain one data row.
  if (csv !== null && csv.length >= 3) {
    return { kind: 'table', script: rowsToMarkdown(csv) };
  }

  if (looksLikeNotebookScript(clean)) {
    return { kind: 'notebook-script', script: clean };
  }

  const language = inferCodeLanguage(clean);
  return language === null
    ? null
    : { kind: 'code', script: `\`\`\`${language}\n${clean}\n\`\`\`` };
}

export function structuredPasteContent(
  source: string,
  hasNode: (name: string) => boolean,
): { readonly kind: StructuredPasteKind; readonly content: readonly TiptapNode[] } | null {
  const classified = classifyStructuredPaste(source);
  if (classified === null) return null;
  const doc = scriptDocToTiptap(parse(classified.script), { hasNode });
  return {
    kind: classified.kind,
    content: (doc.content ?? []) as readonly TiptapNode[],
  };
}
