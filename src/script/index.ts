/**
 * Notebook Script — public API.
 *
 *   parse(source)  → ScriptDoc   (total: never throws, warnings only)
 *   print(doc)     → string      (deterministic canonical form)
 *
 * Invariant: parse(print(doc)) deep-equals doc modulo spans/diagnostics.
 */

import type { ScriptDoc } from "./types";
import { parseDoc } from "./blockParser";
import { printDoc } from "./printer";
import { diag } from "./diagnostics";

/** v2: `::let` variables, `::style` presets, coded/located diagnostics. */
export const NOTEBOOK_SCRIPT_VERSION = "2.0.0";

/**
 * Parse Notebook Script source. Total by construction — and belt-and-braces
 * wrapped so that even an internal parser bug degrades to a plain-text doc
 * with a warning instead of an exception.
 */
export function parse(source: string): ScriptDoc {
  try {
    return parseDoc(source);
  } catch (err) {
    return {
      frontmatter: {},
      blocks: [
        {
          kind: "paragraph",
          content: [
            { kind: "text", text: source, srcStart: 0, srcEnd: source.length },
          ],
          attrs: {},
          srcStart: 0,
          srcEnd: source.length,
        },
      ],
      diagnostics: [
        diag(
          "internal-error",
          `internal parser error — content kept as plain text (${String(err)})`,
          { srcStart: 0, srcEnd: source.length },
        ),
      ],
    };
  }
}

/** Print a document in canonical form. */
export function print(doc: ScriptDoc): string {
  return printDoc(doc);
}

export * from "./types";
export * from "./vocab";
export { normalizeName, resolveContainerName, resolveDiagramLang, levenshtein, fuzzyMatch } from "./normalize";
export { parseAttrBlock, parseBareAttrs } from "./attrParser";
export { parseInline } from "./inlineParser";
export {
  diag,
  expectedOneOf,
  locateDiags,
  pushDiag,
  sortDiags,
  type DiagCode,
} from "./diagnostics";
export {
  applyDefinitions,
  resolveStyles,
  resolveVars,
  scanDirectives,
  hasVarRef,
} from "./resolve";
