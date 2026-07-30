/**
 * src/search/extract.ts — plain-text + heading extraction from page docs.
 *
 * Pure and DOM-free (unit-tested in tests/search.test.ts). Walks the TipTap
 * document JSON (the storage format — see docs/design/block-editor.md) and
 * flattens every text node into newline-separated block lines, collecting
 * heading texts (any depth — headings can live inside callouts/columns) for
 * the quick switcher's "page headings" source.
 */

import type { PageDoc } from '../data/types';

export interface PageHeading {
  text: string;
  /** 1–6; unknown/missing levels normalize to 1. */
  level: number;
}

export interface ExtractedPage {
  /** Newline-separated block text, whitespace-normalized. */
  text: string;
  headings: PageHeading[];
}

interface LooseNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: unknown;
}

function headingLevel(attrs: unknown): number {
  if (attrs !== null && typeof attrs === 'object') {
    const level = (attrs as { level?: unknown }).level;
    if (typeof level === 'number' && Number.isFinite(level)) {
      return Math.min(6, Math.max(1, Math.round(level)));
    }
  }
  return 1;
}

/**
 * Recursive walk. `out` receives text fragments and '\n' block separators;
 * headings are pushed as they close (so nested headings are found too).
 */
function gather(node: unknown, out: string[], headings: PageHeading[]): void {
  if (node === null || typeof node !== 'object') return;
  const n = node as LooseNode;

  if (typeof n.text === 'string') {
    out.push(n.text);
    return;
  }
  if (n.type === 'hardBreak') {
    out.push(' ');
    return;
  }

  const isHeading = n.type === 'heading';
  const before = out.length;
  if (Array.isArray(n.content)) {
    for (const child of n.content) gather(child, out, headings);
  }
  if (isHeading) {
    const text = out
      .slice(before)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text !== '') headings.push({ text, level: headingLevel(n.attrs) });
  }
  // Every non-inline node ends a line so block texts never fuse together.
  out.push('\n');
}

/** Flatten a page document to searchable plain text + its headings. */
export function extractPageText(doc: PageDoc | null | undefined): ExtractedPage {
  const out: string[] = [];
  const headings: PageHeading[] = [];
  if (doc && Array.isArray(doc.content)) {
    for (const node of doc.content) gather(node, out, headings);
  }
  const text = out
    .join('')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
  return { text, headings };
}
