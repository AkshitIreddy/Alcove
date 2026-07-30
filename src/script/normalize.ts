/**
 * Notebook Script — directive-name canonicalization + fuzzy matching.
 *
 * `Sticky Note` = `sticky-note` = `stickynote`: names are normalized by
 * lowercasing and stripping spaces/`-`/`_`, then looked up in the alias
 * table, then fuzzy-matched (Levenshtein ≤ 2) as a last resort.
 */

import type { ContainerName } from "./types";
import {
  CONTAINER_ALIASES,
  DIAGRAM_LANGS,
  DIAGRAM_LANG_ALIASES,
  type ContainerAlias,
} from "./vocab";

/** Lowercase and strip spaces, hyphens and underscores. */
export function normalizeName(raw: string): string {
  return raw.toLowerCase().replace(/[\s\-_]+/g, "");
}

/**
 * Bounded Levenshtein distance. Returns `max + 1` when the true distance
 * exceeds `max` (early-out keeps this O(len·max)).
 */
export function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= max ? prev[b.length] : max + 1;
}

/**
 * Fuzzy-match `value` against `domain` (case-insensitive exact first, then
 * Levenshtein ≤ maxDist). Returns the canonical domain entry or null.
 */
export function fuzzyMatch(
  value: string,
  domain: readonly string[],
  maxDist = 2,
): string | null {
  const lower = value.toLowerCase();
  for (const d of domain) if (d === lower) return d;
  // very short tokens fuzz too easily — require the cap to stay meaningful
  const cap = Math.min(maxDist, Math.max(0, lower.length - 2));
  if (cap === 0) return null;
  let best: string | null = null;
  let bestDist = cap + 1;
  for (const d of domain) {
    const dist = levenshtein(lower, d, cap);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return bestDist <= cap ? best : null;
}

export interface ResolvedContainer {
  name: ContainerName;
  /** Extra attrs implied by the alias (e.g. `tip` → callout variant=tip). */
  impliedAttrs?: Record<string, string>;
  /** True when the name was corrected (alias hit or fuzzy match). */
  corrected: boolean;
}

/**
 * Resolve a raw container directive name to its canonical form.
 * Unknown names resolve to "generic" — never an error.
 */
export function resolveContainerName(raw: string): ResolvedContainer {
  const norm = normalizeName(raw);
  const exact: ContainerAlias | undefined = CONTAINER_ALIASES[norm];
  if (exact) {
    // aliases are intentional spellings, not slop — only fuzzy hits warn
    return { name: exact.name, impliedAttrs: exact.attrs, corrected: false };
  }
  const fuzzy = fuzzyMatch(norm, Object.keys(CONTAINER_ALIASES));
  if (fuzzy) {
    const alias = CONTAINER_ALIASES[fuzzy];
    return { name: alias.name, impliedAttrs: alias.attrs, corrected: true };
  }
  return { name: "generic", corrected: false };
}

export interface ResolvedDiagramLang {
  lang: (typeof DIAGRAM_LANGS)[number] | null;
  /** True when resolution went through an alias or fuzzy match. */
  corrected: boolean;
  /** True when the fence declared a Mermaid dialect (compat ramp). */
  mermaid: boolean;
}

/** Resolve a fence info-string language. Unknown → null (generic handling). */
export function resolveDiagramLang(raw: string): ResolvedDiagramLang {
  const norm = normalizeName(raw);
  if (norm === "") return { lang: null, corrected: false, mermaid: false };
  const exact = DIAGRAM_LANG_ALIASES[norm];
  if (exact) {
    return { lang: exact, corrected: false, mermaid: norm === "mermaid" };
  }
  const fuzzy = fuzzyMatch(norm, Object.keys(DIAGRAM_LANG_ALIASES));
  if (fuzzy) {
    return {
      lang: DIAGRAM_LANG_ALIASES[fuzzy],
      corrected: true,
      mermaid: fuzzy === "mermaid",
    };
  }
  return { lang: null, corrected: false, mermaid: false };
}
