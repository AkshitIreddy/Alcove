/**
 * Notebook Script — tolerant `{attrs}` micro-parser.
 *
 * Accepts `=` or `:` assignment, comma/semicolon/space separators, bare or
 * quoted values, trailing commas, `#id` and `.class` shorthands. Unknown keys
 * are kept (with a warning); enum values are fuzzy-matched (Levenshtein ≤ 2)
 * against the vocab tables — always within the same value domain only.
 *
 * v2: nothing is swallowed silently. Junk characters, nested braces, missing
 * values, non-numeric numbers and duplicate keys all earn a diagnostic that
 * names what was expected, and the parse continues regardless.
 */

import type { Attrs, AttrValue, Diag, Span } from "./types";
import {
  ATTR_ENUM_DOMAINS,
  ATTR_KEY_ALIASES,
  KNOWN_ATTR_KEYS,
  NUMERIC_ATTR_KEYS,
} from "./vocab";
import { expectedOneOf, pushDiag } from "./diagnostics";
import { fuzzyMatch } from "./normalize";

export interface AttrParseResult {
  attrs: Attrs;
  diags: Diag[];
  /** Offset just past the closing `}` (relative to `base`), or end of text. */
  end: number;
  /** False when the closing `}` was missing (tolerated, warned). */
  closed: boolean;
}

export interface AttrParseOptions {
  /**
   * Raw mode: keys are lowercased and values coerced, but nothing is checked
   * against the vocabulary. Used for `::let {a=1, b=2}`, where the keys are
   * user-chosen variable names rather than language attributes.
   */
  raw?: boolean;
}

const NUM_RE = /^[+-]?\d+(\.\d+)?$/;

function coerce(raw: string, quoted: boolean): AttrValue {
  if (quoted) return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (NUM_RE.test(raw)) return Number(raw);
  return raw;
}

/** `key=value` form of a domain's first entry — used in "expected" prose. */
function sample(key: string, domain: readonly string[]): string {
  return domain.length > 0 ? `${key}=${domain[0]}` : `${key}=…`;
}

/**
 * Normalize one key/value pair into `attrs`, warning into `diags`.
 * Exported for reuse by the block parser (frontmatter shares the fuzzy rules).
 *
 * `assigned` is false when the source wrote a bare word with no `=value`.
 */
export function normalizeAttrPair(
  rawKey: string,
  value: AttrValue,
  attrs: Attrs,
  diags: Diag[],
  span: Span,
  domains: Record<string, readonly string[]> = ATTR_ENUM_DOMAINS,
  assigned = true,
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
        pushDiag(
          diags,
          "attr-key-corrected",
          `unknown attribute '${rawKey}' — did you mean '${fixed}'? Using it.`,
          span,
          fixed,
        );
        key = fixed;
      } else {
        pushDiag(
          diags,
          "attr-unknown-key",
          `unknown attribute '${rawKey}' (kept, the renderer ignores it)`,
          span,
          expectedOneOf(KNOWN_ATTR_KEYS),
        );
      }
    } else {
      pushDiag(
        diags,
        "attr-unknown-key",
        `unknown attribute '${rawKey}' (kept, the renderer ignores it)`,
        span,
        expectedOneOf(KNOWN_ATTR_KEYS),
      );
    }
  }

  const domain = domains[key];

  // a bare word where the language wants `key=value`
  if (!assigned && value === true && (KNOWN_ATTR_KEYS as readonly string[]).includes(key)) {
    pushDiag(
      diags,
      "attr-missing-value",
      `attribute '${key}' needs a value`,
      span,
      domain !== undefined
        ? sample(key, domain)
        : (NUMERIC_ATTR_KEYS as readonly string[]).includes(key)
          ? `${key}=<number>`
          : `${key}=<value>`,
    );
  }

  // enum-value fuzzy match, strictly within the key's own domain
  if (domain !== undefined && typeof value === "string") {
    const exact = domain.includes(value) ? value : null;
    if (exact === null) {
      const fixed = fuzzyMatch(value, domain);
      if (fixed !== null) {
        pushDiag(
          diags,
          "attr-value-corrected",
          `unknown ${key} '${value}' — using '${fixed}'`,
          span,
          expectedOneOf(domain),
        );
        value = fixed;
      } else {
        pushDiag(
          diags,
          "attr-unknown-value",
          `unknown ${key} '${value}' (kept)`,
          span,
          expectedOneOf(domain),
        );
      }
    }
  }

  // numeric keys: keep whatever was written, but say so
  if (
    (NUMERIC_ATTR_KEYS as readonly string[]).includes(key) &&
    typeof value === "string" &&
    value !== ""
  ) {
    pushDiag(
      diags,
      "attr-not-a-number",
      `'${key}' expects a number, got '${value}' (kept)`,
      span,
      `${key}=<number>`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(attrs, key)) {
    pushDiag(
      diags,
      "attr-duplicate",
      `attribute '${key}' is set twice — the last value wins`,
      span,
    );
  }

  attrs[key] = value;
}

const IDENT_STOP = /[\s,;{}]/;
const KEY_STOP = /[\s,;:={}]/;

/**
 * Index of the `{` that opens an attribute block, skipping `{{variable}}`
 * references (a diagram label may be nothing but a reference). -1 when the
 * text carries no attribute block.
 */
export function findAttrBrace(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    if (text[i + 1] === "{") {
      const close = text.indexOf("}}", i + 2);
      if (close === -1) return i; // unterminated — let the attr parser warn
      i = close + 1;
      continue;
    }
    return i;
  }
  return -1;
}

/**
 * Parse an attribute block. `text` must start at the `{` character; parsing
 * stops at the first `}` or end of text (missing brace tolerated + warned).
 * `base` is the absolute source offset of `text[0]` (used for diag spans).
 */
export function parseAttrBlock(
  text: string,
  base: number,
  opts: AttrParseOptions = {},
): AttrParseResult {
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

  const record = (
    key: string,
    value: AttrValue,
    sp: Span,
    assigned: boolean,
  ): void => {
    if (opts.raw === true) {
      const k = key.trim().toLowerCase();
      if (k !== "") attrs[k] = value;
      return;
    }
    normalizeAttrPair(key, value, attrs, diags, sp, ATTR_ENUM_DOMAINS, assigned);
  };

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
    if (text[i] === "{") {
      // `{{name}}` is a variable reference, not an attribute list
      pushDiag(
        diags,
        "attr-nested-brace",
        "unexpected '{' inside an attribute list",
        span(tokStart, i + 1),
        "key=value",
      );
      i++;
      continue;
    }
    if (text[i] === "#" || text[i] === ".") {
      const marker = text[i];
      i++;
      let ident = "";
      while (i < text.length && !IDENT_STOP.test(text[i])) ident += text[i++];
      if (ident === "") {
        pushDiag(
          diags,
          "attr-stray-marker",
          `stray '${marker}' in attribute list`,
          span(tokStart, i),
          marker === "#" ? "#some-id" : ".some-class",
        );
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
      // an assignment character with nothing in front of it, or punctuation
      pushDiag(
        diags,
        "attr-junk",
        `unexpected '${text[i]}' in attribute list — skipped`,
        span(tokStart, i + 1),
        "key=value",
      );
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
        else
          pushDiag(
            diags,
            "attr-unclosed-quote",
            "unclosed quote in attribute value",
            span(tokStart, i),
            `a closing ${q}`,
          );
      } else {
        while (i < text.length && !/[\s,;}]/.test(text[i])) {
          // `{color={{tint}}}` — a variable reference is part of the value
          if (text[i] === "{" && text[i + 1] === "{") {
            const close = text.indexOf("}}", i + 2);
            if (close !== -1) {
              value += text.slice(i, close + 2);
              i = close + 2;
              continue;
            }
          }
          value += text[i++];
        }
        if (value === "") {
          pushDiag(
            diags,
            "attr-missing-value",
            `attribute '${key}' has an '=' but no value`,
            span(tokStart, i),
            `${key.trim().toLowerCase()}=<value>`,
          );
        }
      }
      record(key, coerce(value, quoted), span(tokStart, i), true);
    } else {
      // bare flag
      record(key, true, span(tokStart, i), false);
    }
  }

  if (!closed && text[0] === "{") {
    pushDiag(
      diags,
      "attr-unclosed",
      "attribute list not closed with '}'",
      span(0, Math.min(text.length, 1)),
      "}",
    );
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
export function parseBareAttrs(
  text: string,
  base: number,
): { attrs: Attrs; diags: Diag[] } {
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
        normalizeAttrPair(
          piece,
          true,
          attrs,
          diags,
          segSpan,
          ATTR_ENUM_DOMAINS,
          false,
        );
      }
    }
  }
  return { attrs, diags };
}
