/**
 * Notebook Script — tolerant `{attrs}` micro-parser.
 *
 * Accepts `=` or `:` assignment, comma/semicolon/space separators, bare or
 * quoted values, trailing commas, `#id` and `.class` shorthands. Unknown keys
 * are kept (with a warning); enum values are fuzzy-matched (Levenshtein ≤ 2)
 * against the vocab tables — always within the same value domain only.
 */

import type { Attrs, AttrValue, Diag, Span } from "./types";
import { ATTR_ENUM_DOMAINS, ATTR_KEY_ALIASES, KNOWN_ATTR_KEYS } from "./vocab";
import { fuzzyMatch } from "./normalize";

export interface AttrParseResult {
  attrs: Attrs;
  diags: Diag[];
  /** Offset just past the closing `}` (relative to `base`), or end of text. */
  end: number;
  /** False when the closing `}` was missing (tolerated, warned). */
  closed: boolean;
}

const NUM_RE = /^[+-]?\d+(\.\d+)?$/;

function coerce(raw: string, quoted: boolean): AttrValue {
  if (quoted) return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (NUM_RE.test(raw)) return Number(raw);
  return raw;
}

function warn(diags: Diag[], message: string, span: Span): void {
  diags.push({ severity: "warn", message, span });
}

/**
 * Normalize one key/value pair into `attrs`, warning into `diags`.
 * Exported for reuse by the block parser (frontmatter shares the fuzzy rules).
 */
export function normalizeAttrPair(
  rawKey: string,
  value: AttrValue,
  attrs: Attrs,
  diags: Diag[],
  span: Span,
  domains: Record<string, readonly string[]> = ATTR_ENUM_DOMAINS,
): void {
  let key = rawKey.trim().toLowerCase();
  if (key === "") return;

  if (key === "id" || key === "class") {
    attrs[key] = value;
    return;
  }

  const aliased = ATTR_KEY_ALIASES[key];
  if (aliased !== undefined && aliased !== key) {
    key = aliased;
  } else if (!(KNOWN_ATTR_KEYS as readonly string[]).includes(key)) {
    // single-word slightly-misspelled keys get pulled to a known key
    if (!/[\s]/.test(key)) {
      const fixed = fuzzyMatch(key, KNOWN_ATTR_KEYS);
      if (fixed !== null) {
        warn(diags, `unknown attribute '${rawKey}' — did you mean '${fixed}'? Using it.`, span);
        key = fixed;
      } else {
        warn(diags, `unknown attribute '${rawKey}' (kept)`, span);
      }
    } else {
      warn(diags, `unknown attribute '${rawKey}' (kept)`, span);
    }
  }

  // enum-value fuzzy match, strictly within the key's own domain
  const domain = domains[key];
  if (domain !== undefined && typeof value === "string") {
    const exact = domain.includes(value) ? value : null;
    if (exact === null) {
      const fixed = fuzzyMatch(value, domain);
      if (fixed !== null) {
        warn(diags, `unknown ${key} '${value}' — using '${fixed}'`, span);
        value = fixed;
      } else {
        warn(diags, `unknown ${key} '${value}' (kept)`, span);
      }
    }
  }

  attrs[key] = value;
}

const IDENT_STOP = /[\s,;{}]/;
const KEY_STOP = /[\s,;:={}]/;

/**
 * Parse an attribute block. `text` must start at the `{` character; parsing
 * stops at the first `}` or end of text (missing brace tolerated + warned).
 * `base` is the absolute source offset of `text[0]` (used for diag spans).
 */
export function parseAttrBlock(text: string, base: number): AttrParseResult {
  const attrs: Attrs = {};
  const diags: Diag[] = [];
  const classes: string[] = [];
  let i = 0;
  let closed = false;
  if (text[i] === "{") i++;

  const span = (s: number, e: number): Span => ({
    srcStart: base + s,
    srcEnd: base + e,
  });

  while (i < text.length) {
    // separators
    if (/[\s,;]/.test(text[i])) {
      i++;
      continue;
    }
    if (text[i] === "}") {
      closed = true;
      i++;
      break;
    }
    const tokStart = i;
    if (text[i] === "#" || text[i] === ".") {
      const marker = text[i];
      i++;
      let ident = "";
      while (i < text.length && !IDENT_STOP.test(text[i])) ident += text[i++];
      if (ident === "") {
        warn(diags, `stray '${marker}' in attribute list`, span(tokStart, i));
        continue;
      }
      if (marker === "#") attrs.id = ident;
      else classes.push(ident);
      continue;
    }
    // key
    let key = "";
    while (i < text.length && !KEY_STOP.test(text[i])) key += text[i++];
    if (key === "") {
      // unparseable character — skip it, stay total
      i++;
      continue;
    }
    // optional assignment (= or :)
    while (i < text.length && text[i] === " ") i++;
    if (text[i] === "=" || text[i] === ":") {
      i++;
      while (i < text.length && text[i] === " ") i++;
      let value = "";
      let quoted = false;
      if (text[i] === '"' || text[i] === "'") {
        const q = text[i];
        quoted = true;
        i++;
        while (i < text.length && text[i] !== q && text[i] !== "}") {
          value += text[i++];
        }
        if (text[i] === q) i++;
        else warn(diags, `unclosed quote in attribute value`, span(tokStart, i));
      } else {
        while (i < text.length && !/[\s,;}]/.test(text[i])) value += text[i++];
      }
      normalizeAttrPair(key, coerce(value, quoted), attrs, diags, span(tokStart, i));
    } else {
      // bare flag
      normalizeAttrPair(key, true, attrs, diags, span(tokStart, i));
    }
  }

  if (!closed && text[0] === "{") {
    warn(diags, "attribute list not closed with '}'", span(0, Math.min(text.length, 1)));
  }
  if (classes.length > 0) {
    const prev = typeof attrs.class === "string" ? attrs.class + " " : "";
    attrs.class = prev + classes.join(" ");
  }
  return { attrs, diags, end: i, closed };
}

/**
 * Parse a brace-less attr fragment, e.g. the tail of
 * `fetch: fluffy kitten | caption=Study break :3 | rotate=3`.
 *
 * Each `|`-separated segment is either `key=value` (value may contain
 * unquoted spaces — everything after the first `=`/`:` belongs to the value)
 * or, when a segment packs several `k=v` pairs, they may be separated by
 * commas/semicolons or whitespace.
 */
export function parseBareAttrs(text: string, base: number): { attrs: Attrs; diags: Diag[] } {
  const attrs: Attrs = {};
  const diags: Diag[] = [];
  const segments = text.split("|");
  let offset = 0;
  for (const seg of segments) {
    const segBase = base + offset;
    offset += seg.length + 1;
    const trimmed = seg.trim();
    if (trimmed === "") continue;
    const segSpan: Span = { srcStart: segBase, srcEnd: segBase + seg.length };
    // split into pieces when the segment clearly holds several k=v pairs
    // (only `=` counts here — a stray `:` inside a value must not split it)
    const pieces = trimmed
      .split(/[,;]+/)
      .flatMap((p) => {
        const assignments = p.match(/[A-Za-z_][\w.-]*\s*=/g);
        if (assignments !== null && assignments.length > 1) {
          return p.split(/\s+(?=[A-Za-z_][\w.-]*\s*=)/);
        }
        return [p];
      })
      .map((p) => p.trim())
      .filter((p) => p !== "");
    for (const piece of pieces) {
      const m = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(piece);
      if (m) {
        let raw = m[2].trim();
        let quoted = false;
        if (
          raw.length >= 2 &&
          ((raw.startsWith('"') && raw.endsWith('"')) ||
            (raw.startsWith("'") && raw.endsWith("'")))
        ) {
          raw = raw.slice(1, -1);
          quoted = true;
        }
        normalizeAttrPair(m[1], coerce(raw, quoted), attrs, diags, segSpan);
      } else if (piece.startsWith("#") && piece.length > 1) {
        attrs.id = piece.slice(1);
      } else if (piece.startsWith(".") && piece.length > 1) {
        const prev = typeof attrs.class === "string" ? attrs.class + " " : "";
        attrs.class = prev + piece.slice(1);
      } else {
        // bare word → boolean flag (warned if unknown by normalizeAttrPair)
        normalizeAttrPair(piece, true, attrs, diags, segSpan);
      }
    }
  }
  return { attrs, diags };
}
