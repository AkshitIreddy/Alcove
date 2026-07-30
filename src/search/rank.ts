/**
 * src/search/rank.ts — content-search ranking + snippet building.
 *
 * Pure and DOM-free (unit-tested in tests/search.test.ts). The full-text
 * panel loads the whole search index into memory (src/data/search.ts) and
 * ranks here in JS — see that module's header for the SQLite-FTS5 upgrade
 * path that would move ranking into the database.
 */

import type { PageHeading } from './extract';

/** Lowercased, deduped word terms from a raw query (capped at 8). */
export function tokenize(query: string): string[] {
  const seen = new Set<string>();
  for (const part of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (part !== '' && !seen.has(part)) seen.add(part);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

function occurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let from = 0;
  while (count < 50) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

export interface ContentDocInput {
  text: string;
  headings: readonly PageHeading[];
}

/**
 * Relevance score for one page against tokenized `terms` (plus the raw
 * lowercased `phrase` for exact-phrase bonus). 0 = no term present
 * (callers drop the page).
 */
export function scoreContent(
  input: ContentDocInput,
  terms: readonly string[],
  phrase: string,
): number {
  if (terms.length === 0) return 0;
  const lower = input.text.toLowerCase();
  const headingLowers = input.headings.map((h) => ({
    text: h.text.toLowerCase(),
    level: h.level,
  }));
  let score = 0;
  let found = 0;
  for (const term of terms) {
    const count = occurrences(lower, term);
    let hit = count > 0;
    if (count > 0) score += 4 + 3 * Math.min(count, 5);
    for (const heading of headingLowers) {
      if (heading.text.includes(term)) {
        hit = true;
        score += Math.max(2, 8 - heading.level);
      }
    }
    if (hit) found += 1;
  }
  if (found === 0) return 0;
  if (found === terms.length && terms.length > 1) score += 10;
  if (terms.length > 1 && phrase.length > 1 && lower.includes(phrase)) {
    score += 15;
  }
  return score;
}

export interface SnippetSegment {
  text: string;
  /** True when this segment is a query-term match (rendered as <mark>). */
  hit: boolean;
}

export interface Snippet {
  segments: SnippetSegment[];
  /** Text exists before/after the window (render an ellipsis). */
  leading: boolean;
  trailing: boolean;
}

/**
 * Build a match snippet: a word-aligned window of ~2×`radius` characters
 * around the earliest term hit, split into hit/miss segments (overlapping
 * term hits are merged). Null when no term occurs in the text.
 */
export function buildSnippet(
  text: string,
  terms: readonly string[],
  radius = 56,
): Snippet | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();

  let first = -1;
  let firstLen = 0;
  for (const term of terms) {
    if (term === '') continue;
    const idx = lower.indexOf(term);
    if (idx >= 0 && (first < 0 || idx < first)) {
      first = idx;
      firstLen = term.length;
    }
  }
  if (first < 0) return null;

  let start = Math.max(0, first - radius);
  let end = Math.min(flat.length, first + firstLen + radius);
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space >= 0 && space < first) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > first + firstLen) end = space;
  }

  const window = flat.slice(start, end);
  const windowLower = lower.slice(start, end);

  const marks: Array<[number, number]> = [];
  for (const term of terms) {
    if (term === '') continue;
    let from = 0;
    while (marks.length < 40) {
      const idx = windowLower.indexOf(term, from);
      if (idx < 0) break;
      marks.push([idx, idx + term.length]);
      from = idx + term.length;
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const mark of marks) {
    const last = merged[merged.length - 1];
    if (last !== undefined && mark[0] <= last[1]) {
      last[1] = Math.max(last[1], mark[1]);
    } else {
      merged.push([mark[0], mark[1]]);
    }
  }

  const segments: SnippetSegment[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) segments.push({ text: window.slice(cursor, s), hit: false });
    segments.push({ text: window.slice(s, e), hit: true });
    cursor = e;
  }
  if (cursor < window.length) {
    segments.push({ text: window.slice(cursor), hit: false });
  }
  return { segments, leading: start > 0, trailing: end < flat.length };
}
