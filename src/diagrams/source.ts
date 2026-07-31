/**
 * src/diagrams/source.ts — diagram AST ⇄ fence-body source text.
 *
 * The diagram block node stores its AST as a JSON string (`data` attr). The
 * click-to-edit popover shows editable fence SOURCE, so this module can:
 *   - print a DiagramData back to canonical fence-body text (mirrors
 *     src/script/printer.ts's diagram cases, body only), and
 *   - reparse edited source through the real script diagram parsers
 *     (total — diagnostics, never throws).
 */

import type {
  Attrs,
  AttrValue,
  Diag,
  Graph,
  SrcLine,
  TimelineEntry,
  TreeNode,
} from '../script/types';
import { locateDiags, sortDiags } from '../script/diagnostics';
import { parseTree } from '../script/diagrams/tree';
import { parseGraph } from '../script/diagrams/graph';
import { parseTimeline } from '../script/diagrams/timeline';
import type { DiagramData, DiagramKind } from './types';

// ---------------------------------------------------------------------------
// Source lines
// ---------------------------------------------------------------------------

/** Split source into SrcLine[] with absolute offsets (mirrors blockParser). */
export function toSrcLines(source: string): SrcLine[] {
  const lines: SrcLine[] = [];
  let offset = 0;
  for (const raw of source.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ text, start: offset, end: offset + text.length });
    offset += raw.length + 1;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Parse (edited popover source → DiagramData)
// ---------------------------------------------------------------------------

export interface ParsedDiagramSource {
  data: DiagramData;
  diagnostics: Diag[];
}

/**
 * Parse fence-body source for `kind`. Total: never throws.
 *
 * The returned diagnostics honour the same contract as `script.parse()`'s —
 * located (1-based line/column) and in source order. That is not free here:
 * the mini-language parsers are called DIRECTLY rather than through
 * `parseDoc`, which is the pass that normally locates and sorts, so without
 * `finish()` the popover would show every warning at line 0.
 */
export function parseDiagramSource(
  kind: DiagramKind,
  source: string,
): ParsedDiagramSource {
  const diags: Diag[] = [];
  const lines = toSrcLines(source);
  const finish = (data: DiagramData): ParsedDiagramSource => {
    locateDiags(diags, lines.map((line) => line.start));
    return { data, diagnostics: sortDiags(diags) };
  };
  switch (kind) {
    case 'tree':
    case 'mindmap':
      return finish({ kind, roots: parseTree(lines, diags) });
    case 'graph':
    case 'flowchart':
      return finish({ kind, graph: parseGraph(lines, diags) });
    case 'timeline':
      return finish({ kind, entries: parseTimeline(lines, diags) });
  }
}

// ---------------------------------------------------------------------------
// Print (DiagramData → fence-body source)
// ---------------------------------------------------------------------------

function printAttrValue(value: AttrValue): string {
  if (typeof value === 'string') {
    return /[\s,}"=]/.test(value) ? JSON.stringify(value) : value;
  }
  return String(value);
}

function printAttrs(attrs: Attrs): string {
  const parts = Object.entries(attrs).map(
    ([k, v]) => `${k}=${printAttrValue(v)}`,
  );
  return `{${parts.join(', ')}}`;
}

function printBareAttrs(attrs: Attrs): string {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}=${printAttrValue(v)}`)
    .join(', ');
}

function printTreeLines(nodes: TreeNode[], depth: number, out: string[]): void {
  for (const n of nodes) {
    let line = '  '.repeat(depth) + n.label;
    if (n.note !== undefined) line += ` | ${n.note}`;
    if (n.attrs !== undefined) line += ' ' + printAttrs(n.attrs);
    out.push(line);
    printTreeLines(n.children, depth + 1, out);
  }
}

/** Canonical fence-body text for a DiagramData (round-trips through parse). */
export function printDiagramSource(data: DiagramData): string {
  const out: string[] = [];
  switch (data.kind) {
    case 'tree':
    case 'mindmap':
      printTreeLines(data.roots, 0, out);
      break;
    case 'graph':
    case 'flowchart':
      for (const n of data.graph.nodes) {
        if (n.label !== undefined) out.push(`${n.id}: ${n.label}`);
        if (n.attrs !== undefined) out.push(`${n.id} ${printAttrs(n.attrs)}`);
      }
      for (const e of data.graph.edges) {
        let line = `${e.from} -> ${e.to}`;
        if (e.label !== undefined) line += `: ${e.label}`;
        out.push(line);
      }
      break;
    case 'timeline':
      for (const e of data.entries) {
        let line = `${e.label}: ${e.text}`;
        if (e.attrs !== undefined) line += ` | ${printBareAttrs(e.attrs)}`;
        out.push(line);
      }
      break;
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// data attr (JSON string) helpers
// ---------------------------------------------------------------------------

function emptyData(kind: DiagramKind): DiagramData {
  switch (kind) {
    case 'tree':
    case 'mindmap':
      return { kind, roots: [] };
    case 'graph':
    case 'flowchart':
      return { kind, graph: { nodes: [], edges: [] } };
    case 'timeline':
      return { kind, entries: [] };
  }
}

/**
 * Decode the node's `data` attr for `kind`. Total: malformed JSON or a
 * mismatched payload degrades to an empty diagram of the right kind.
 */
export function decodeDiagramData(kind: DiagramKind, json: unknown): DiagramData {
  if (typeof json !== 'string' || json === '') return emptyData(kind);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return emptyData(kind);
  }
  if (raw === null || typeof raw !== 'object') return emptyData(kind);
  const obj = raw as Record<string, unknown>;
  switch (kind) {
    case 'tree':
    case 'mindmap':
      return Array.isArray(obj.roots)
        ? { kind, roots: obj.roots as TreeNode[] }
        : emptyData(kind);
    case 'graph':
    case 'flowchart': {
      const graph = obj.graph as { nodes?: unknown; edges?: unknown } | undefined;
      return graph !== undefined &&
        Array.isArray(graph.nodes) &&
        Array.isArray(graph.edges)
        ? {
            kind,
            graph: {
              nodes: graph.nodes as Graph['nodes'],
              edges: graph.edges as Graph['edges'],
            },
          }
        : emptyData(kind);
    }
    case 'timeline':
      return Array.isArray(obj.entries)
        ? { kind, entries: obj.entries as TimelineEntry[] }
        : emptyData(kind);
  }
}

/** Encode a DiagramData payload for storage in the node's `data` attr. */
export function encodeDiagramData(data: DiagramData): string {
  switch (data.kind) {
    case 'tree':
    case 'mindmap':
      return JSON.stringify({ roots: data.roots });
    case 'graph':
    case 'flowchart':
      return JSON.stringify({ graph: data.graph });
    case 'timeline':
      return JSON.stringify({ entries: data.entries });
  }
}
