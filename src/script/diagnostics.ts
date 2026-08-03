/**
 * Notebook Script — diagnostic construction and source positions.
 *
 * Every warning the parser emits goes through `diag()` so that it carries a
 * stable machine-readable `code`, an optional `expected` (what the parser
 * wanted to see here) and — once `locateDiags()` has run over the finished
 * list — a 1-based line/column. The severity is always 'warn': there is no
 * 'error' severity by design, because parse() is total.
 *
 * Codes are the contract the Insert Script dialog (and tests) filter on;
 * messages are prose and may be reworded.
 */

import type { Diag, Span } from "./types";

/** Every diagnostic the parser can emit. Grouped by the area that raises it. */
export type DiagCode =
  // parser plumbing
  | "internal-error"
  // block structure
  | "heading-too-deep"
  | "unknown-container"
  | "container-corrected"
  | "container-unclosed"
  | "container-stray-close"
  | "container-too-deep"
  | "container-two-colon-open"
  | "col-outside-columns"
  | "fence-unclosed"
  | "fence-unknown-lang"
  | "fence-lang-corrected"
  | "table-align-extra"
  | "table-ragged"
  | "image-missing-src"
  | "fetch-missing-query"
  | "setext-heading"
  | "html-not-script"
  | "jsx-not-script"
  | "import-not-script"
  // frontmatter
  | "frontmatter-unclosed"
  | "frontmatter-invalid"
  | "frontmatter-nested"
  | "frontmatter-unknown-key"
  | "frontmatter-key-corrected"
  | "frontmatter-unknown-value"
  | "frontmatter-value-corrected"
  // attributes
  | "attr-unknown-key"
  | "attr-key-corrected"
  | "attr-unknown-value"
  | "attr-value-corrected"
  | "attr-missing-value"
  | "attr-not-a-number"
  | "attr-duplicate"
  | "attr-unclosed"
  | "attr-unclosed-quote"
  | "attr-junk"
  | "attr-nested-brace"
  | "attr-stray-marker"
  // inline
  | "inline-unclosed"
  // maths, footnotes and page references
  | "math-unclosed"
  | "math-empty"
  | "footnote-empty"
  | "footnote-undefined"
  | "footnote-duplicate"
  | "footnote-unused"
  | "pageref-empty"
  // diagram mini-languages
  | "timeline-missing-label"
  | "graph-missing-source"
  | "graph-dangling-arrow"
  | "mermaid-fence"
  | "mermaid-header"
  | "mermaid-node-label"
  // variables (::let) and reusable styles (::style)
  | "let-missing-name"
  | "let-missing-value"
  | "let-duplicate"
  | "let-wrong-fence"
  | "var-unknown"
  | "var-empty-reference"
  | "var-cycle"
  | "style-missing-name"
  | "style-missing-attrs"
  | "style-duplicate"
  | "style-wrong-fence"
  | "style-unknown"
  | "style-cycle";

/**
 * Build a diagnostic. `line`/`column` start at 0 (= "not located yet") and
 * are filled in by `locateDiags()` once the whole document is parsed.
 */
export function diag(
  code: DiagCode,
  message: string,
  span: Span,
  expected?: string,
): Diag {
  return {
    severity: "warn",
    code,
    message,
    span,
    line: 0,
    column: 0,
    ...(expected !== undefined ? { expected } : {}),
  };
}

/** `diag()` straight into a list — the shape every recognizer uses. */
export function pushDiag(
  diags: Diag[],
  code: DiagCode,
  message: string,
  span: Span,
  expected?: string,
): void {
  diags.push(diag(code, message, span, expected));
}

/** `a, b or c` — the phrasing used for every `expected` value list. */
export function expectedOneOf(values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

/**
 * Fill in 1-based line/column for every diagnostic from the document's line
 * starts (binary search; diagnostics arrive in no particular order).
 */
export function locateDiags(diags: Diag[], lineStarts: number[]): void {
  for (const d of diags) {
    const offset = Math.max(0, d.span.srcStart);
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    d.line = lo + 1;
    d.column = offset - lineStarts[lo] + 1;
  }
}

/**
 * Source order, stably — post-passes (variables, styles) run after the block
 * pass, so raw push order would jump around the note.
 */
export function sortDiags(diags: Diag[]): Diag[] {
  return diags
    .map((d, idx) => ({ d, idx }))
    .sort((a, b) => a.d.span.srcStart - b.d.span.srcStart || a.idx - b.idx)
    .map((e) => e.d);
}
