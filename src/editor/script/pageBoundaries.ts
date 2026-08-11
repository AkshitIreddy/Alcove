import { parse, type ScriptDoc } from '../../script';

/**
 * Split an AI-authored Notebook Script into deliberately anchored pages.
 *
 * `::page` is intentionally outside the ordinary parser: it controls the
 * book, not a block within one page. Only a top-level directive is structural;
 * examples inside fenced code or directive containers remain ordinary text.
 */
export interface NotebookScriptPageSlice {
  readonly source: string;
  /** Offsets into `NotebookScriptPageAnalysis.maskedSource`. */
  readonly start: number;
  readonly end: number;
}

export interface NotebookScriptPageAnalysis {
  /** CRLF-normalised source with structural `::page` lines blanked in place. */
  readonly maskedSource: string;
  readonly pages: readonly NotebookScriptPageSlice[];
}

export interface ParsedNotebookScriptPages {
  /** One complete preview with document-wide variables/styles resolved. */
  readonly preview: ScriptDoc;
  /** The same resolved document partitioned into the protected page slices. */
  readonly pages: readonly {
    readonly source: string;
    readonly doc: ScriptDoc;
  }[];
}

/**
 * Find page boundaries once, preserving source coordinates for diagnostics.
 *
 * The ordinary block parser intentionally knows nothing about `::page`.
 * Blanking the directive (rather than removing it) means its line and every
 * later line keep their original coordinates in preview diagnostics.
 */
export function analyzeNotebookScriptPages(source: string): NotebookScriptPageAnalysis {
  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const pages: NotebookScriptPageSlice[] = [];
  const masked = [...lines];
  let current: string[] = [];
  let pageStart = 0;
  let offset = 0;
  let fence: { marker: '`' | '~'; length: number } | null = null;
  let containerDepth = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const nextOffset = offset + line.length + (lineIndex < lines.length - 1 ? 1 : 0);
    const fenceRun = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      current.push(line);
      if (
        fenceRun?.[0] === fence.marker &&
        fenceRun.length >= fence.length
      ) {
        fence = null;
      }
      offset = nextOffset;
      continue;
    }
    if (fenceRun !== undefined) {
      fence = {
        marker: fenceRun[0] as '`' | '~',
        length: fenceRun.length,
      };
      current.push(line);
      offset = nextOffset;
      continue;
    }

    if (/^\s*:::\s*$/.test(line)) {
      containerDepth = Math.max(0, containerDepth - 1);
      current.push(line);
      offset = nextOffset;
      continue;
    }
    if (/^\s*:::\s*[a-z][\w-]*(?:\s|$)/i.test(line)) {
      containerDepth += 1;
      current.push(line);
      offset = nextOffset;
      continue;
    }

    if (containerDepth === 0 && /^\s*::page\s*(?:#.*)?$/.test(line)) {
      pages.push({ source: current.join('\n').trim(), start: pageStart, end: offset });
      // Preserve every diagnostic coordinate while making the structural
      // directive invisible to the ordinary block/container parser.
      masked[lineIndex] = ' '.repeat(line.length);
      current = [];
      pageStart = offset + line.length + (lineIndex < lines.length - 1 ? 1 : 0);
    } else {
      current.push(line);
    }
    offset = nextOffset;
  }
  pages.push({ source: current.join('\n').trim(), start: pageStart, end: normalized.length });
  return {
    maskedSource: masked.join('\n'),
    pages: pages.filter((page, index) => page.source !== '' || index === 0),
  };
}

export function splitNotebookScriptPages(source: string): string[] {
  return analyzeNotebookScriptPages(source).pages.map((page) => page.source);
}

/**
 * Parse a multi-page note as ONE document, then partition its already-resolved
 * blocks. This is what makes `::let`, `::style`, footnote definitions and page
 * frontmatter genuinely document-wide instead of silently disappearing after
 * the first protected boundary.
 */
export function parseNotebookScriptPages(source: string): ParsedNotebookScriptPages {
  const analysis = analyzeNotebookScriptPages(source);
  const preview = parse(analysis.maskedSource);
  return {
    preview,
    pages: analysis.pages.map((page) => ({
      source: page.source,
      doc: {
        ...preview,
        blocks: preview.blocks.filter(
          (block) => block.srcStart >= page.start && block.srcStart < page.end,
        ),
        diagnostics: preview.diagnostics.filter(
          (diag) => diag.span.srcStart >= page.start && diag.span.srcStart < page.end,
        ),
      },
    })),
  };
}
