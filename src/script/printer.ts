/**
 * Notebook Script — deterministic canonical printer.
 *
 * Canon: stable attr order (id, class, then alphabetical), `=` assignment,
 * `, ` separator, 3-marker fences, 2-space indents, one blank line between
 * blocks. Invariant (property-tested): `parse(print(doc))` deep-equals `doc`
 * modulo spans and diagnostics.
 */

import type {
  Attrs,
  AttrValue,
  Block,
  Inline,
  ListItem,
  ScriptDoc,
  TableRow,
  TreeNode,
} from "./types";

// ---------------------------------------------------------------------------
// Attrs
// ---------------------------------------------------------------------------

const BARE_VALUE_RE = /^[A-Za-z0-9_./#-]+$/;
const NUMERIC_RE = /^[+-]?\d+(\.\d+)?$/;

function formatValue(v: AttrValue): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (
    v !== "" &&
    BARE_VALUE_RE.test(v) &&
    !NUMERIC_RE.test(v) &&
    v !== "true" &&
    v !== "false"
  ) {
    return v;
  }
  return `"${v}"`;
}

function attrKeys(attrs: Attrs): string[] {
  const keys = Object.keys(attrs);
  keys.sort((a, b) => {
    const rank = (k: string): number => (k === "id" ? 0 : k === "class" ? 1 : 2);
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  });
  return keys;
}

/** `{id=x, class=y, alpha=1}` — empty string when there are no attrs. */
export function printAttrs(attrs: Attrs): string {
  const keys = attrKeys(attrs);
  if (keys.length === 0) return "";
  return `{${keys.map((k) => `${k}=${formatValue(attrs[k])}`).join(", ")}}`;
}

/** Brace-less pipe form used by fetch/image/timeline lines: `k=v, k2=v2`. */
function printBareAttrs(attrs: Attrs): string {
  return attrKeys(attrs)
    .map((k) => `${k}=${formatValue(attrs[k])}`)
    .join(", ");
}

function attrSuffix(attrs: Attrs): string {
  const s = printAttrs(attrs);
  return s === "" ? "" : ` ${s}`;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

/**
 * Escape everything the inline parser treats as markup.
 *
 * `$` is in the set because maths is: without it a sentence about money
 * ("$5 … $10") would come back from a round trip as a formula the moment the
 * spacing happened to allow it.
 */
function escapeText(s: string): string {
  return s.replace(/[\\`*_~^=$[\]{}|]/g, (m) => "\\" + m);
}

/**
 * A footnote's note and a page reference's label are plain text inside
 * brackets, and the scanner that reads them back honours backslash escapes —
 * so exactly the closer and the backslash need escaping, and nothing else.
 */
function escapeBracketed(s: string): string {
  return s.replace(/[\\\]]/g, (m) => "\\" + m);
}

function printCode(text: string): string {
  let fence = "`";
  while (text.includes(fence)) fence += "`";
  return fence + text + fence;
}

export function printInlines(nodes: Inline[]): string {
  let out = "";
  for (const n of nodes) {
    const attrs = n.attrs !== undefined ? printAttrs(n.attrs) : "";
    switch (n.kind) {
      case "text":
        out += escapeText(n.text) + attrs;
        break;
      case "code":
        out += printCode(n.text) + attrs;
        break;
      case "link":
        out += `[${printInlines(n.children)}](${n.href})` + attrs;
        break;
      case "strong":
        out += `**${printInlines(n.children)}**` + attrs;
        break;
      case "em":
        out += `*${printInlines(n.children)}*` + attrs;
        break;
      case "strike":
        out += `~~${printInlines(n.children)}~~` + attrs;
        break;
      case "highlight":
        out += `==${printInlines(n.children)}==` + attrs;
        break;
      case "sup":
        out += `^${printInlines(n.children)}^` + attrs;
        break;
      case "sub":
        out += `~${printInlines(n.children)}~` + attrs;
        break;
      case "math":
        out += `$${n.text}$` + attrs;
        break;
      case "footnote":
        // The canonical form is the note inside the marker; a `[^1]: …`
        // definition read on the way in has already been folded into it.
        out += `[^ ${escapeBracketed(n.text)} ]` + attrs;
        break;
      case "pageref":
        out += `[[${escapeBracketed(n.label)}]]` + attrs;
        break;
    }
  }
  return out;
}

/**
 * A paragraph line must not be mistaken for another block on reparse —
 * escape the deciding character when it would be.
 */
function guardBlockCollision(line: string): string {
  if (/^\d{1,9}[.)][ \t]/.test(line)) {
    return line.replace(/^(\d{1,9})([.)])/, "$1\\$2");
  }
  if (/^(fetch|image)\s*:/i.test(line)) return line.replace(":", "\\:");
  // `*`, `_`, `|`, and backticks are already escaped by escapeText where
  // they matter; a single leading backtick is a code span, not a fence.
  if (/^[#>\-:!+]/.test(line)) return "\\" + line;
  return line;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function printListItems(
  items: ListItem[],
  ordered: boolean,
  depth: number,
): string[] {
  const lines: string[] = [];
  items.forEach((item, idx) => {
    const marker = ordered ? `${idx + 1}.` : "-";
    const box =
      item.checked !== undefined ? (item.checked ? "[x] " : "[ ] ") : "";
    lines.push(
      "  ".repeat(depth) + marker + " " + box + printInlines(item.content),
    );
    lines.push(...printListItems(item.children, ordered, depth + 1));
  });
  return lines;
}

function printTree(nodes: TreeNode[], depth: number): string[] {
  const lines: string[] = [];
  for (const n of nodes) {
    let line = "  ".repeat(depth) + n.label;
    if (n.note !== undefined) line += ` | ${n.note}`;
    if (n.attrs !== undefined) line += " " + printAttrs(n.attrs);
    lines.push(line);
    lines.push(...printTree(n.children, depth + 1));
  }
  return lines;
}

function printTableRow(row: TableRow): string {
  return "| " + row.cells.map((c) => printInlines(c)).join(" | ") + " |";
}

function printBlock(block: Block, inImageRow: boolean): string {
  switch (block.kind) {
    case "heading":
      return (
        "#".repeat(block.level) +
        " " +
        printInlines(block.content) +
        attrSuffix(block.attrs)
      );
    case "paragraph":
      return guardBlockCollision(
        printInlines(block.content) + attrSuffix(block.attrs),
      );
    case "quote":
      return "> " + printInlines(block.content) + attrSuffix(block.attrs);
    case "divider":
      return "---" + attrSuffix(block.attrs);
    case "list":
      return printListItems(block.items, block.ordered, 0).join("\n");
    case "taskList":
      return printListItems(block.items, false, 0).join("\n");
    case "table": {
      const lines: string[] = [];
      if (block.header !== null) {
        lines.push(printTableRow(block.header) + attrSuffix(block.attrs));
        lines.push(
          "| " +
            block.align
              .map((a) =>
                a === "center"
                  ? ":---:"
                  : a === "right"
                    ? "---:"
                    : a === "left"
                      ? ":---"
                      : "---",
              )
              .join(" | ") +
            " |",
        );
        for (const row of block.rows) lines.push(printTableRow(row));
      } else {
        block.rows.forEach((row, idx) => {
          lines.push(
            printTableRow(row) + (idx === 0 ? attrSuffix(block.attrs) : ""),
          );
        });
      }
      return lines.join("\n");
    }
    case "image":
      return `![${block.alt}](${block.src})` + printAttrs(block.attrs);
    case "mathBlock":
      // Always the fenced form, even for a one-liner: the body is verbatim,
      // and `$$ … $$` on one line cannot hold a formula containing `$$`.
      return ["$$" + attrSuffix(block.attrs), block.latex, "$$"].join("\n");
    case "code": {
      /*
       * The fence marker grows past anything the body contains.
       *
       * A snippet about Markdown holds ``` of its own, and a three-marker
       * fence around it would close on the reader's first line. So the marker
       * grows past the longest run in the body — the same widening `printCode`
       * does for an inline code span one file up — and the parser's close rule
       * (`closesTick` in blockParser.ts) only lets a wide fence be closed by
       * one at least as wide.
       */
      let marker = "```";
      while (block.code.includes(marker)) marker += "`";
      const lang = block.lang ?? block.rawLang ?? "";
      return [
        marker + lang + attrSuffix(block.attrs),
        block.code,
        marker,
      ].join("\n");
    }
    case "fetchDirective": {
      if (inImageRow) {
        const tail =
          Object.keys(block.attrs).length > 0
            ? ` | ${printBareAttrs(block.attrs)}`
            : "";
        return `fetch: ${block.query}${tail}`;
      }
      return `::fetch${printAttrs({ query: block.query, ...block.attrs })}`;
    }
    case "container": {
      const name =
        block.name === "generic" ? (block.rawName ?? "generic") : block.name;
      const open = `::: ${name}${attrSuffix(block.attrs)}`;
      const children = block.children.map((c) =>
        printBlock(c, block.name === "image-row"),
      );
      return [open, ...children, ":::"].join("\n\n");
    }
    case "diagram": {
      const open = "```" + block.lang + attrSuffix(block.attrs);
      let body: string[];
      switch (block.lang) {
        case "timeline":
          body = block.entries.map((e) => {
            let line = `${e.label}: ${e.text}`;
            if (e.attrs !== undefined) line += ` | ${printBareAttrs(e.attrs)}`;
            return line;
          });
          break;
        case "graph":
        case "flowchart":
          body = [];
          for (const n of block.graph.nodes) {
            if (n.label !== undefined) body.push(`${n.id}: ${n.label}`);
            if (n.attrs !== undefined) body.push(`${n.id} ${printAttrs(n.attrs)}`);
            if (n.label === undefined && n.attrs === undefined) body.push(n.id);
          }
          for (const e of block.graph.edges) {
            let line = `${e.from} -> ${e.to}`;
            if (e.label !== undefined) line += `: ${e.label}`;
            body.push(line);
          }
          break;
        case "tree":
        case "mindmap":
          body = printTree(block.roots, 0);
          break;
      }
      return [open, ...body, "```"].join("\n");
    }
  }
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const FM_KEY_ORDER = ["title", "paper", "ink", "wash"];

/**
 * `::let` values are rest-of-line, so only ambiguity needs quoting: an empty
 * value, edge whitespace, a leading brace (would read as the `{a=1}` form) or
 * a leading quote (would be stripped as a quote pair on the way back in).
 */
function printLetValue(value: string): string {
  const needsQuotes =
    value === "" ||
    value !== value.trim() ||
    value.startsWith("{") ||
    value.startsWith('"') ||
    value.startsWith("'");
  if (!needsQuotes) return value;
  const q = value.startsWith('"') ? "'" : '"';
  return `${q}${value}${q}`;
}

export function printDoc(doc: ScriptDoc): string {
  const parts: string[] = [];
  const fmKeys = Object.keys(doc.frontmatter);
  if (fmKeys.length > 0) {
    fmKeys.sort((a, b) => {
      const rank = (k: string): number => {
        const idx = FM_KEY_ORDER.indexOf(k);
        return idx === -1 ? FM_KEY_ORDER.length : idx;
      };
      return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
    });
    parts.push(
      ["---", ...fmKeys.map((k) => `${k}: ${doc.frontmatter[k]}`), "---"].join(
        "\n",
      ),
    );
  }
  // definitions come before the prose that uses them (they are document-scoped
  // either way, but reading order matters to a human and to the next model)
  const varNames = Object.keys(doc.vars ?? {}).sort();
  if (varNames.length > 0) {
    const vars = doc.vars as Record<string, string>;
    parts.push(
      varNames.map((k) => `::let ${k} = ${printLetValue(vars[k])}`).join("\n"),
    );
  }
  const styleNames = Object.keys(doc.styles ?? {}).sort();
  if (styleNames.length > 0) {
    const styles = doc.styles as Record<string, Attrs>;
    parts.push(
      styleNames
        // an attr-less style is pointless but must still round-trip
        .map((k) => `::style ${k} ${printAttrs(styles[k]) || "{}"}`)
        .join("\n"),
    );
  }
  for (const block of doc.blocks) parts.push(printBlock(block, false));
  if (parts.length === 0) return "";
  return parts.join("\n\n") + "\n";
}
