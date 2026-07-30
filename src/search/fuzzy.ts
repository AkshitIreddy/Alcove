/**
 * src/search/fuzzy.ts — tiny fuzzy matcher for the quick switcher.
 *
 * Pure (unit-tested in tests/search.test.ts). Scores are relative — only
 * comparisons between candidates for the SAME query are meaningful.
 *
 * Scoring model:
 * - Whole-query substring beats any scattered subsequence; prefix beats
 *   mid-string; word-start beats mid-word.
 * - Subsequence mode rewards consecutive runs and word-boundary hits,
 *   lightly penalizes gaps and long targets.
 */

export interface FuzzyResult {
  score: number;
  /** Matched character indices in the target (for optional highlighting). */
  positions: number[];
}

const WORD_BOUNDARY = /[\s\-_.,:;/()[\]"'`]/;

function isWordStart(target: string, index: number): boolean {
  return index === 0 || WORD_BOUNDARY.test(target[index - 1]);
}

/**
 * Match `query` against `target` (case-insensitive). Returns null when the
 * query is not a subsequence of the target; an empty query matches with
 * score 0.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return { score: 0, positions: [] };
  if (t.length === 0) return null;

  // Fast path — the whole query appears verbatim.
  const sub = t.indexOf(q);
  if (sub >= 0) {
    let score = 40 + q.length * 4 - sub * 0.3 - t.length * 0.02;
    if (sub === 0) score += 20;
    else if (isWordStart(t, sub)) score += 10;
    const positions: number[] = [];
    for (let i = 0; i < q.length; i += 1) positions.push(sub + i);
    return { score, positions };
  }

  // Greedy left-to-right subsequence (spaces in the query are free).
  let score = 0;
  let prev = -2;
  let from = 0;
  const positions: number[] = [];
  for (const ch of q) {
    if (ch === ' ') continue;
    const idx = t.indexOf(ch, from);
    if (idx < 0) return null;
    let gain = 1;
    if (idx === prev + 1) gain += 5;
    if (isWordStart(t, idx)) gain += 6;
    score += gain - Math.min(3, (idx - from) * 0.05);
    positions.push(idx);
    prev = idx;
    from = idx + 1;
  }
  score -= t.length * 0.02;
  return { score, positions };
}
