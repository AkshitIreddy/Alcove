/**
 * Notebook Script — block parser.
 *
 * Line-oriented single forward pass with an explicit container stack and no
 * backtracking (Djot model). Recognizers run in priority order: frontmatter
 * (line 0 only), fence open/close, heading, divider, list item, quote, table
 * row, image, paragraph (fallthrough — any unrecognized line becomes text).
 *
 * parseDoc() is TOTAL: any input returns a doc + diagnostics, never throws.
 * `\r\n`, `\r` and `\n` line endings are treated identically.
 *
 * v2 adds a pre-pass (src/script/resolve.ts) that lifts `::let` / `::style`
 * leaf directives out of the line stream before the block pass, and a
 * post-pass that substitutes `{{variables}}` and expands `{use=style}`.
 */

import type {
  Attrs,
  Block,
  ContainerBlock,
  Diag,
  DiagramBlock,
  ListBlock,
  ListItem,
  ScriptDoc,
  Span,
  SrcLine,
  TableAlign,
  TableRow,
  TaskListBlock,
} from "./types";
import { parseAttrBlock, parseBareAttrs } from "./attrParser";
import {
  fuzzyMatch,
  normalizeName,
  resolveContainerName,
  resolveDiagramLang,
} from "./normalize";
import {
  CALLOUT_VARIANTS,
  CONTAINER_NAMES,
  DIAGRAM_LANGS,
  FRONTMATTER_ENUM_DOMAINS,
} from "./vocab";
import {
  expectedOneOf,
  locateDiags,
  pushDiag,
  sortDiags,
  type DiagCode,
} from "./diagnostics";
import {
  applyDefinitions,
  resolveStyles,
  resolveVars,
  scanDirectives,
} from "./resolve";
import { parseInline } from "./inlineParser";
import { parseTree } from "./diagrams/tree";
import { parseGraph } from "./diagrams/graph";
import { parseTimeline } from "./diagrams/timeline";

// ---------------------------------------------------------------------------
// Line utilities
// ---------------------------------------------------------------------------

function splitLines(src: string): SrcLine[] {
  const lines: SrcLine[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\n" || ch === "\r") {
      lines.push({ text: src.slice(start, i), start, end: i });
      if (ch === "\r" && src[i + 1] === "\n") i++;
      start = i + 1;
    }
  }
  lines.push({ text: src.slice(start), start, end: src.length });
  return lines;
}

/** Leading indentation width, tabs counting as 2 spaces. */
function indentOf(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 1;
    else if (ch === "\t") w += 2;
    else break;
  }
  return w;
}

// ---------------------------------------------------------------------------
// Recognizer patterns
// ---------------------------------------------------------------------------

/**
 * One `{…}` attribute block. `{{name}}` references are allowed inside it
 * (`{color={{tint}}}`), so the body is "anything but braces, or a reference".
 * Both alternatives start with a different character — no backtracking.
 */
const ATTR_BLOCK = "\\{(?:[^{}]|\\{\\{[^{}]*\\}\\})*\\}";

const COLON_RE = /^\s*(:{2,})\s*(.*)$/;
const TICK_OPEN_RE = /^\s*(`{3,})\s*(.*)$/;
const TICK_CLOSE_RE = /^\s*`{2,}\s*$/;
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;
const DIVIDER_RE = new RegExp(
  `^\\s*(-{3,}|\\*{3,}|_{3,})\\s*(${ATTR_BLOCK})?\\s*$`,
);
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TASK_RE = /^\[([ xX])\][ \t]?(.*)$/;
const QUOTE_RE = /^\s*>[ \t]?(.*)$/;
const TABLE_RE = /^\s*\|/;
const IMAGE_RE = /^\s*!\[([^\]]*)\]\(([^)]*)\)\s*(\{.*)?$/;
const FETCH_LINE_RE = /^\s*fetch\s*:\s*(.*)$/i;
/**
 * An equation on its own line. Both shapes a writer reaches for are here:
 * `$$` alone opens a block that runs to the next `$$`, and `$$ x = 1 $$` is
 * the whole thing on one line. The trailing ` {attrs}` is optional.
 */
const MATH_ONELINE_RE = new RegExp(
  `^\\s*\\$\\$(.+?)\\$\\$[ \\t]*(${ATTR_BLOCK})?\\s*$`,
);
const MATH_OPEN_RE = new RegExp(`^\\s*\\$\\$[ \\t]*(${ATTR_BLOCK})?\\s*$`);
const IMAGE_LINE_RE = /^\s*image\s*:\s*(.*)$/i;
const PURE_ATTR_RE = new RegExp(`^\\s*${ATTR_BLOCK}\\s*$`);
/** A block's trailing ` {attrs}` — the space before the brace is required. */
const TRAILING_ATTR_RE = new RegExp(`^(.*\\S)[ \\t]+(${ATTR_BLOCK})[ \\t]*$`);
const FM_FENCE_RE = /^-{3,}\s*$/;

/** Things a chatbot writes when it forgets which language it is writing. */
const HTML_TAG_RE = /^\s*<\/?([A-Za-z][\w.:-]*)(\s[^<>]*)?\/?>/;
const IMPORT_RE = /^\s*(import|export)\s+[\w{*]/;
const SETEXT_RE = /^\s*={3,}\s*$/;
/** Frontmatter attempt: `key: value` or an indented continuation. */
const FM_KEYISH_RE = /^\s*[\w-]+\s*:/;

/** Container nesting past this reads as runaway `:::` in AI output. */
const MAX_CONTAINER_DEPTH = 8;

type LineClass =
  | "blank"
  | "colon"
  | "tick"
  | "heading"
  | "divider"
  | "list"
  | "quote"
  | "table"
  | "image"
  | "math"
  | "fetchline"
  | "imageline"
  | "paragraph";

function classify(text: string, inImageRow: boolean): LineClass {
  if (text.trim() === "") return "blank";
  if (COLON_RE.test(text)) return "colon";
  if (TICK_OPEN_RE.test(text)) return "tick";
  // Before the heading test: `$$` cannot collide with anything else, and
  // putting it first keeps a formula starting with `#` out of the heading arm.
  if (MATH_ONELINE_RE.test(text) || MATH_OPEN_RE.test(text)) return "math";
  if (HEADING_RE.test(text)) return "heading";
  if (DIVIDER_RE.test(text)) return "divider";
  if (LIST_RE.test(text)) return "list";
  if (QUOTE_RE.test(text)) return "quote";
  if (TABLE_RE.test(text)) return "table";
  if (IMAGE_RE.test(text)) return "image";
  if (inImageRow && FETCH_LINE_RE.test(text)) return "fetchline";
  if (inImageRow && IMAGE_LINE_RE.test(text)) return "imageline";
  return "paragraph";
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface OpenContainer {
  block: ContainerBlock;
  /** True right after the fence line — a pure `{attrs}` line is absorbed. */
  awaitingAttrs: boolean;
}

export function parseDoc(source: string): ScriptDoc {
  const diags: Diag[] = [];
  const frontmatter: Record<string, string> = {};
  const blocks: Block[] = [];
  const stack: OpenContainer[] = [];
  const lines = splitLines(source);
  let depthWarned = false;

  const warn = (
    code: DiagCode,
    message: string,
    span: Span,
    expected?: string,
  ): void => {
    pushDiag(diags, code, message, span, expected);
  };
  const target = (): Block[] =>
    stack.length > 0 ? stack[stack.length - 1].block.children : blocks;
  const topIsImageRow = (): boolean =>
    stack.length > 0 && stack[stack.length - 1].block.name === "image-row";
  const lineSpan = (l: SrcLine): Span => ({ srcStart: l.start, srcEnd: l.end });

  /**
   * Strip a trailing ` {attrs}` (whitespace before the brace required —
   * that's what separates block attrs from inline span attrs).
   */
  const stripTrailingAttrs = (
    text: string,
    baseOffset: number,
  ): { text: string; attrs: Attrs } => {
    const m = TRAILING_ATTR_RE.exec(text);
    if (!m || m[1].endsWith("\\")) return { text, attrs: {} };
    const trimmed = text.trimEnd();
    const braceStart = trimmed.length - m[2].length;
    const res = parseAttrBlock(m[2], baseOffset + braceStart);
    diags.push(...res.diags);
    return { text: m[1], attrs: res.attrs };
  };

  const inline = (text: string, base: number) => {
    const res = parseInline(text, base);
    diags.push(...res.diags);
    return res.nodes;
  };

  // --- frontmatter (line 0 only; leading blank lines tolerated) ------------
  const fmSpans: Record<string, Span> = {};
  let i = 0;
  while (i < lines.length && lines[i].text.trim() === "") i++;
  if (i < lines.length && FM_FENCE_RE.test(lines[i].text.trim())) {
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (FM_FENCE_RE.test(lines[j].text.trim())) {
        close = j;
        break;
      }
    }
    // Does this look like an *attempt* at frontmatter? Only then is a broken
    // block worth a diagnostic — a note that simply opens with a `---`
    // divider must stay silent. A closed block only has to contain a
    // `key: value` line somewhere; an unclosed one has to start with one,
    // because "everything to the end of the note" would otherwise match.
    let firstBody = -1;
    let anyKeyish = false;
    for (let j = i + 1; j < (close === -1 ? lines.length : close); j++) {
      if (lines[j].text.trim() === "") continue;
      if (firstBody === -1) firstBody = j;
      if (FM_KEYISH_RE.test(lines[j].text)) anyKeyish = true;
    }
    const looksLikeFm =
      firstBody !== -1 &&
      (close === -1 ? FM_KEYISH_RE.test(lines[firstBody].text) : anyKeyish);

    let valid = close !== -1;
    let firstBad = -1;
    if (valid) {
      for (let j = i + 1; j < close; j++) {
        const t = lines[j].text.trim();
        if (t !== "" && !t.startsWith("#") && !t.includes(":")) {
          valid = false;
          firstBad = j;
          break;
        }
      }
    }
    if (valid) {
      const fmKeys = Object.keys(FRONTMATTER_ENUM_DOMAINS).concat("title");
      for (let j = i + 1; j < close; j++) {
        const t = lines[j].text.trim();
        if (t === "" || t.startsWith("#")) continue;
        // nested YAML: an indented key is read as a top-level one, warned
        if (/^[ \t]/.test(lines[j].text)) {
          warn(
            "frontmatter-nested",
            `indented '${t}' — page style is flat 'key: value' only, no nested YAML`,
            lineSpan(lines[j]),
            "key: value at column 1",
          );
        }
        const colonAt = t.indexOf(":");
        let key = t.slice(0, colonAt).trim().toLowerCase();
        // strip inline `# comment` (needs a space before the hash)
        let value = t
          .slice(colonAt + 1)
          .replace(/\s+#.*$/, "")
          .trim();
        if (key === "") continue;
        if (!fmKeys.includes(key)) {
          const fixed = fuzzyMatch(key, fmKeys);
          if (fixed !== null) {
            warn(
              "frontmatter-key-corrected",
              `unknown page style '${key}' — did you mean '${fixed}'? Using it.`,
              lineSpan(lines[j]),
              fixed,
            );
            key = fixed;
          } else {
            warn(
              "frontmatter-unknown-key",
              `unknown page style '${key}' (kept, the page ignores it)`,
              lineSpan(lines[j]),
              expectedOneOf(fmKeys),
            );
          }
        }
        const domain = FRONTMATTER_ENUM_DOMAINS[key];
        if (domain !== undefined && !domain.includes(value)) {
          const fixed = fuzzyMatch(value, domain);
          if (fixed !== null) {
            warn(
              "frontmatter-value-corrected",
              `unknown ${key} '${value}' — using '${fixed}'`,
              lineSpan(lines[j]),
              expectedOneOf(domain),
            );
            value = fixed;
          } else {
            warn(
              "frontmatter-unknown-value",
              `unknown ${key} '${value}' (kept)`,
              lineSpan(lines[j]),
              expectedOneOf(domain),
            );
          }
        }
        frontmatter[key] = value;
        fmSpans[key] = lineSpan(lines[j]);
      }
      i = close + 1;
    } else if (looksLikeFm) {
      // invalid frontmatter → the `---` falls through as a divider below,
      // but say *why* so the page style silently going missing is visible
      if (close === -1) {
        warn(
          "frontmatter-unclosed",
          "page style opened with '---' but never closed — it was read as page text",
          lineSpan(lines[i]),
          "a closing '---' line",
        );
      } else {
        warn(
          "frontmatter-invalid",
          `'${lines[firstBad].text.trim()}' is not a 'key: value' pair — the whole page-style block was ignored`,
          lineSpan(lines[firstBad]),
          "key: value",
        );
      }
    }
  }

  // --- v2 pre-pass: ::let / ::style leaf directives -------------------------
  const scan = scanDirectives(lines, i);
  diags.push(...scan.diags);
  const vars = resolveVars(scan.vars, diags);
  const styles = resolveStyles(scan.styles, diags);

  // --- helpers for the fence handlers --------------------------------------

  /**
   * A paragraph is the fallthrough, so it is also where a chatbot's wrong
   * language lands: HTML, JSX, ESM imports, Setext underlines. Those parse as
   * literal prose — say so once per paragraph and per kind, then move on.
   */
  const sniffWrongLanguage = (from: number, to: number): void => {
    const seen = new Set<DiagCode>();
    const once = (
      code: DiagCode,
      message: string,
      line: SrcLine,
      expected: string,
    ): void => {
      if (seen.has(code)) return;
      seen.add(code);
      warn(code, message, lineSpan(line), expected);
    };
    for (let j = from; j <= to; j++) {
      const text = lines[j].text;
      const tag = HTML_TAG_RE.exec(text);
      if (tag !== null) {
        const isComponent = /^[A-Z]/.test(tag[1]);
        once(
          isComponent ? "jsx-not-script" : "html-not-script",
          `'<${tag[1]}>' is ${isComponent ? "JSX" : "HTML"}, not Notebook Script — it stays literal text`,
          lines[j],
          isComponent
            ? "::: callout {variant=info} … :::"
            : "Markdown or a ':::' container",
        );
        continue;
      }
      if (IMPORT_RE.test(text)) {
        once(
          "import-not-script",
          "'import'/'export' statements are not part of Notebook Script",
          lines[j],
          "plain note content",
        );
        continue;
      }
      if (j > from && SETEXT_RE.test(text)) {
        once(
          "setext-heading",
          "'===' underlines are not headings here",
          lines[j],
          "# Heading",
        );
      }
    }
  };

  const makeParagraph = (from: number, to: number): void => {
    sniffWrongLanguage(from, to);
    // gather already-classified paragraph lines [from, to]
    const parts: string[] = [];
    for (let j = from; j <= to; j++) parts.push(lines[j].text.trim());
    const last = lines[to];
    const lastIdx = parts.length - 1;
    const stripped = stripTrailingAttrs(
      parts[lastIdx],
      last.start + indentOf(last.text),
    );
    parts[lastIdx] = stripped.text;
    const joined = parts.filter((p) => p !== "").join(" ");
    const first = lines[from];
    target().push({
      kind: "paragraph",
      content: inline(joined, first.start + indentOf(first.text)),
      attrs: stripped.attrs,
      srcStart: first.start,
      srcEnd: last.end,
    });
  };

  const handleFetchRest = (
    rest: string,
    base: number,
  ): { query: string; attrs: Attrs } => {
    let query = "";
    let attrs: Attrs = {};
    if (rest.startsWith("{")) {
      const res = parseAttrBlock(rest, base);
      diags.push(...res.diags);
      attrs = res.attrs;
      if (typeof attrs.query === "string") {
        query = attrs.query;
        delete attrs.query;
      } else {
        warn(
          "fetch-missing-query",
          "fetch directive has no query",
          { srcStart: base, srcEnd: base + rest.length },
          '::fetch{query="a fluffy kitten"}',
        );
      }
    } else {
      const pipeAt = rest.indexOf("|");
      query = (pipeAt === -1 ? rest : rest.slice(0, pipeAt)).trim();
      if (pipeAt !== -1) {
        const res = parseBareAttrs(rest.slice(pipeAt + 1), base + pipeAt + 1);
        diags.push(...res.diags);
        attrs = res.attrs;
      }
    }
    return { query, attrs };
  };

  /** Returns false when the line should fall through to paragraph. */
  const handleColon = (line: SrcLine): boolean => {
    const m = COLON_RE.exec(line.text);
    if (!m) return false;
    const colons = m[1].length;
    const rest = m[2].trim();

    if (rest === "") {
      // close fence (2+ colons)
      if (stack.length === 0) {
        warn(
          "container-stray-close",
          "':::' here closes nothing — there is no open container above it",
          lineSpan(line),
          "an opening '::: name' first",
        );
      } else {
        const open = stack.pop() as OpenContainer;
        open.block.srcEnd = line.end;
      }
      i++;
      return true;
    }

    // Multi-word names (`Sticky Note`) are tried first; when the full text
    // before any `{` resolves to a known container, it wins. Otherwise the
    // first token is the name and the remainder is treated as bare attrs.
    const braceIdx = rest.indexOf("{");
    const uptoBrace = (braceIdx === -1 ? rest : rest.slice(0, braceIdx)).trim();
    let rawName: string;
    let after: string;
    if (
      /\s/.test(uptoBrace) &&
      uptoBrace !== "" &&
      resolveContainerName(uptoBrace).name !== "generic"
    ) {
      rawName = uptoBrace;
      after = braceIdx === -1 ? "" : rest.slice(braceIdx).trim();
    } else {
      const nameMatch = /^([^\s{]+)/.exec(rest);
      rawName = nameMatch ? nameMatch[1] : "";
      after = rest.slice(rawName.length).trim();
    }

    // leaf fetch directive: ::fetch{query="kitten", count=3}
    if (normalizeName(rawName) === "fetch") {
      const braceAt = line.text.indexOf("{");
      const base = braceAt !== -1 ? line.start + braceAt : line.start;
      const { query, attrs } = handleFetchRest(after, base);
      target().push({
        kind: "fetchDirective",
        query,
        attrs,
        srcStart: line.start,
        srcEnd: line.end,
      });
      i++;
      return true;
    }

    const resolved = resolveContainerName(rawName);
    if (colons === 2 && resolved.name === "generic") return false;
    if (colons === 2) {
      warn(
        "container-two-colon-open",
        `container fences open with ':::' (got '::')`,
        lineSpan(line),
        `::: ${resolved.name}`,
      );
    }
    if (resolved.corrected) {
      warn(
        "container-corrected",
        `unknown container '${rawName}' — did you mean '${resolved.name}'? Using it.`,
        lineSpan(line),
        resolved.name,
      );
    } else if (resolved.name === "generic") {
      warn(
        "unknown-container",
        `unknown container '${rawName}' — rendered as a plain box`,
        lineSpan(line),
        expectedOneOf(CONTAINER_NAMES),
      );
    }
    if (resolved.name === "col" && !stack.some((o) => o.block.name === "columns")) {
      warn(
        "col-outside-columns",
        "':::col' outside a ':::columns' block — it renders as a plain box",
        lineSpan(line),
        "::: columns wrapping the ::: col blocks",
      );
    }
    // once per note: a runaway `:::` cascade would otherwise warn per level
    if (stack.length >= MAX_CONTAINER_DEPTH && !depthWarned) {
      depthWarned = true;
      warn(
        "container-too-deep",
        `containers are nested ${stack.length + 1} deep — did a ':::' close go missing?`,
        lineSpan(line),
        `at most ${MAX_CONTAINER_DEPTH} levels`,
      );
    }

    let attrs: Attrs = {};
    // `::: callout tip` — a bare variant word, not an attribute
    if (
      resolved.name === "callout" &&
      !after.startsWith("{") &&
      after !== "" &&
      fuzzyMatch(after.trim(), CALLOUT_VARIANTS) !== null
    ) {
      attrs.variant = fuzzyMatch(after.trim(), CALLOUT_VARIANTS) as string;
      after = "";
    }
    if (after.startsWith("{")) {
      const braceAt = line.text.indexOf("{");
      const res = parseAttrBlock(after, line.start + braceAt);
      diags.push(...res.diags);
      attrs = res.attrs;
    } else if (after !== "") {
      const res = parseBareAttrs(after, line.start + (line.text.length - after.length));
      diags.push(...res.diags);
      attrs = res.attrs;
    }
    if (resolved.impliedAttrs !== undefined) {
      attrs = { ...resolved.impliedAttrs, ...attrs };
    }
    // `::: callout tip` → bare flag that names a variant
    if (resolved.name === "callout" && attrs.variant === undefined) {
      for (const key of Object.keys(attrs)) {
        if (attrs[key] === true) {
          const v = fuzzyMatch(key, CALLOUT_VARIANTS);
          if (v !== null) {
            delete attrs[key];
            attrs.variant = v;
            break;
          }
        }
      }
    }

    const block: ContainerBlock = {
      kind: "container",
      name: resolved.name,
      children: [],
      attrs,
      srcStart: line.start,
      srcEnd: line.end,
      ...(resolved.name === "generic" ? { rawName } : {}),
    };
    target().push(block);
    stack.push({ block, awaitingAttrs: true });
    i++;
    return true;
  };

  const handleTick = (line: SrcLine): void => {
    const m = TICK_OPEN_RE.exec(line.text) as RegExpExecArray;
    const info = m[2].trim();
    let attrs: Attrs = {};
    let langPart = info;
    const braceAt = info.indexOf("{");
    if (braceAt !== -1) {
      const res = parseAttrBlock(info.slice(braceAt), line.start + line.text.indexOf("{"));
      diags.push(...res.diags);
      attrs = res.attrs;
      langPart = info.slice(0, braceAt).trim();
    }
    const spaceAt = langPart.search(/\s/);
    const rawLang = spaceAt === -1 ? langPart : langPart.slice(0, spaceAt);
    if (spaceAt !== -1) {
      // bare attrs after the language, without braces
      const res = parseBareAttrs(langPart.slice(spaceAt), line.start);
      diags.push(...res.diags);
      attrs = { ...res.attrs, ...attrs };
    }

    // collect the raw body
    let j = i + 1;
    while (j < lines.length && !TICK_CLOSE_RE.test(lines[j].text)) j++;
    const closed = j < lines.length;
    let body = lines.slice(i + 1, j);
    if (!closed) {
      warn(
        "fence-unclosed",
        "code fence never closed — everything to the end of the note is inside it",
        lineSpan(line),
        "a closing ``` line",
      );
    }
    if (body.length > 0 && PURE_ATTR_RE.test(body[0].text)) {
      const res = parseAttrBlock(
        body[0].text.trim(),
        body[0].start + indentOf(body[0].text),
      );
      diags.push(...res.diags);
      attrs = { ...attrs, ...res.attrs };
      body = body.slice(1);
    }

    const srcStart = line.start;
    const srcEnd = closed ? lines[j].end : source.length;
    const resolved = resolveDiagramLang(rawLang);
    if (resolved.mermaid) {
      warn(
        "mermaid-fence",
        "Mermaid fence parsed with the graph grammar — prefer ```graph",
        lineSpan(line),
        "```graph",
      );
    } else if (resolved.corrected) {
      warn(
        "fence-lang-corrected",
        `unknown diagram '${rawLang}' — did you mean '${resolved.lang}'? Using it.`,
        lineSpan(line),
        resolved.lang ?? "",
      );
    }

    if (resolved.lang !== null) {
      let block: DiagramBlock;
      if (resolved.lang === "tree" || resolved.lang === "mindmap") {
        block = {
          kind: "diagram",
          lang: resolved.lang,
          roots: parseTree(body, diags),
          attrs,
          srcStart,
          srcEnd,
        };
      } else if (resolved.lang === "timeline") {
        block = {
          kind: "diagram",
          lang: "timeline",
          entries: parseTimeline(body, diags),
          attrs,
          srcStart,
          srcEnd,
        };
      } else {
        block = {
          kind: "diagram",
          lang: resolved.lang,
          graph: parseGraph(body, diags),
          attrs,
          srcStart,
          srcEnd,
        };
      }
      target().push(block);
    } else {
      warn(
        "fence-unknown-lang",
        `unknown fence language '${rawLang === "" ? "(none)" : rawLang}' — kept as plain text in a box`,
        lineSpan(line),
        expectedOneOf(DIAGRAM_LANGS),
      );
      const container: ContainerBlock = {
        kind: "container",
        name: "generic",
        rawName: rawLang === "" ? "code" : rawLang,
        children: [],
        attrs,
        srcStart,
        srcEnd,
      };
      for (const b of body) {
        if (b.text.trim() === "") continue;
        container.children.push({
          kind: "paragraph",
          content: inline(b.text.trim(), b.start + indentOf(b.text)),
          attrs: {},
          srcStart: b.start,
          srcEnd: b.end,
        });
      }
      target().push(container);
    }
    i = closed ? j + 1 : j;
  };

  /**
   * `$$ … $$` — an equation block.
   *
   * The body is taken VERBATIM: no inline pass, no trimming of interior
   * lines, no `{{var}}` substitution. A formula is source for a different
   * renderer, and every one of those passes would be this parser editing a
   * language it does not speak. Unclosed is a warning, never a loss — the
   * rest of the note would otherwise vanish into an equation.
   */
  const handleMath = (line: SrcLine): void => {
    const attrsFrom = (raw: string | undefined): Attrs => {
      if (raw === undefined) return {};
      const res = parseAttrBlock(raw, line.start + line.text.lastIndexOf(raw));
      diags.push(...res.diags);
      return res.attrs;
    };

    const one = MATH_ONELINE_RE.exec(line.text);
    if (one !== null) {
      const latex = one[1].trim();
      if (latex === "") {
        warn(
          "math-empty",
          "'$$ $$' has no formula in it",
          lineSpan(line),
          "$$ e = mc^2 $$",
        );
      }
      target().push({
        kind: "mathBlock",
        latex,
        attrs: attrsFrom(one[2]),
        srcStart: line.start,
        srcEnd: line.end,
      });
      i++;
      return;
    }

    const open = MATH_OPEN_RE.exec(line.text) as RegExpExecArray;
    let j = i + 1;
    while (j < lines.length && !/^\s*\$\$\s*$/.test(lines[j].text)) j++;
    const closed = j < lines.length;
    if (!closed) {
      warn(
        "math-unclosed",
        "equation opened with '$$' but never closed — everything to the end of the note is inside it",
        lineSpan(line),
        "a closing '$$' line",
      );
    }
    const body = lines
      .slice(i + 1, j)
      .map((l) => l.text)
      .join("\n")
      .trim();
    if (body === "") {
      warn(
        "math-empty",
        "'$$' block has no formula in it",
        lineSpan(line),
        "$$ e = mc^2 $$",
      );
    }
    target().push({
      kind: "mathBlock",
      latex: body,
      attrs: attrsFrom(open[1]),
      srcStart: line.start,
      srcEnd: closed ? lines[j].end : source.length,
    });
    i = closed ? j + 1 : j;
  };

  const handleList = (): void => {
    let current: ListBlock | TaskListBlock | null = null;
    const istack: { indent: number; item: ListItem }[] = [];
    while (i < lines.length) {
      const line = lines[i];
      const m = LIST_RE.exec(line.text);
      if (!m) break;
      const indent = indentOf(m[1]);
      const ordered = /^\d/.test(m[2]);
      let contentText = m[3];
      let contentOff = line.start + (line.text.length - m[3].length);
      const task = TASK_RE.exec(contentText);
      let checked: boolean | undefined;
      if (task) {
        checked = task[1] !== " ";
        contentOff += contentText.length - task[2].length;
        contentText = task[2];
      }
      while (istack.length > 0 && istack[istack.length - 1].indent >= indent) {
        istack.pop();
      }
      const kind: "list" | "taskList" = task ? "taskList" : "list";
      if (istack.length === 0) {
        const needNew =
          current === null ||
          current.kind !== kind ||
          (current.kind === "list" && current.ordered !== ordered);
        if (needNew) {
          if (current !== null) target().push(current);
          current =
            kind === "taskList"
              ? { kind, items: [], attrs: {}, srcStart: line.start, srcEnd: line.end }
              : { kind, ordered, items: [], attrs: {}, srcStart: line.start, srcEnd: line.end };
        }
      }
      const item: ListItem = {
        content: inline(contentText.trim(), contentOff),
        children: [],
        srcStart: line.start,
        srcEnd: line.end,
        ...(checked !== undefined ? { checked } : {}),
      };
      const parent =
        istack.length > 0
          ? istack[istack.length - 1].item.children
          : (current as ListBlock | TaskListBlock).items;
      parent.push(item);
      (current as ListBlock | TaskListBlock).srcEnd = line.end;
      istack.push({ indent, item });
      i++;
    }
    if (current !== null) target().push(current);
  };

  const handleQuote = (): void => {
    const first = lines[i];
    const parts: { text: string; off: number }[] = [];
    let last = first;
    while (i < lines.length) {
      const qm = QUOTE_RE.exec(lines[i].text);
      if (!qm) break;
      parts.push({
        text: qm[1],
        off: lines[i].start + (lines[i].text.length - qm[1].length),
      });
      last = lines[i];
      i++;
    }
    let attrs: Attrs = {};
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      const stripped = stripTrailingAttrs(lastPart.text, lastPart.off);
      lastPart.text = stripped.text;
      attrs = stripped.attrs;
    }
    const joined = parts
      .map((p) => p.text.trim())
      .filter((t) => t !== "")
      .join(" ");
    target().push({
      kind: "quote",
      content: inline(joined, parts.length > 0 ? parts[0].off : first.start),
      attrs,
      srcStart: first.start,
      srcEnd: last.end,
    });
  };

  const splitCells = (line: SrcLine): { text: string; off: number }[] => {
    let t = line.text.trim();
    let off = line.start + indentOf(line.text);
    if (t.startsWith("|")) {
      t = t.slice(1);
      off += 1;
    }
    if (t.endsWith("|")) t = t.slice(0, -1);
    const cells: { text: string; off: number }[] = [];
    let cellStart = 0;
    for (let k = 0; k <= t.length; k++) {
      if (k === t.length || (t[k] === "|" && t[k - 1] !== "\\")) {
        cells.push({ text: t.slice(cellStart, k), off: off + cellStart });
        cellStart = k + 1;
      }
    }
    return cells;
  };

  const handleTable = (): void => {
    const first = lines[i];
    const rawRows: { line: SrcLine; cells: { text: string; off: number }[] }[] = [];
    let attrs: Attrs = {};
    let last = first;
    while (i < lines.length && TABLE_RE.test(lines[i].text)) {
      const line = lines[i];
      let text = line.text;
      if (rawRows.length === 0) {
        const stripped = stripTrailingAttrs(text, line.start);
        text = stripped.text;
        attrs = stripped.attrs;
      }
      rawRows.push({ line, cells: splitCells({ ...line, text }) });
      last = line;
      i++;
    }
    const isAlignCell = (c: string): boolean => /^:?-+:?$/.test(c.trim());
    const toRow = (r: (typeof rawRows)[number]): TableRow => ({
      cells: r.cells.map((c) => inline(c.text.trim(), c.off)),
      srcStart: r.line.start,
      srcEnd: r.line.end,
    });
    let header: TableRow | null = null;
    let align: TableAlign[] = [];
    const rows: TableRow[] = [];
    for (let r = 0; r < rawRows.length; r++) {
      const isAlign =
        rawRows[r].cells.length > 0 &&
        rawRows[r].cells.every((c) => isAlignCell(c.text));
      if (isAlign) {
        if (r === 1) {
          header = toRow(rawRows[0]);
          rows.pop();
          align = rawRows[r].cells.map((c): TableAlign => {
            const t = c.text.trim();
            const l = t.startsWith(":");
            const rr = t.endsWith(":");
            if (l && rr) return "center";
            if (rr) return "right";
            if (l) return "left";
            return null;
          });
        } else {
          warn(
            "table-align-extra",
            "extra table alignment row ignored — only the row under the header sets alignment",
            lineSpan(rawRows[r].line),
          );
        }
        continue;
      }
      rows.push(toRow(rawRows[r]));
    }
    // ragged rows silently lose (or invent) columns at render time
    if (header !== null) {
      const want = header.cells.length;
      for (let r = 0; r < rows.length; r++) {
        const got = rows[r].cells.length;
        if (got !== want) {
          warn(
            "table-ragged",
            `table row has ${got} cell${got === 1 ? "" : "s"} but the header has ${want}`,
            { srcStart: rows[r].srcStart, srcEnd: rows[r].srcEnd },
            `${want} cells`,
          );
        }
      }
    }
    target().push({
      kind: "table",
      header,
      align,
      rows,
      attrs,
      srcStart: first.start,
      srcEnd: last.end,
    });
  };

  // --- main loop ------------------------------------------------------------

  while (i < lines.length) {
    const line = lines[i];
    // skip the trailing pseudo-line for sources ending in a newline
    if (i === lines.length - 1 && line.text === "" && line.start >= source.length) break;

    // `::let` / `::style` lines were lifted out by the pre-pass; skipping them
    // here (before the awaiting-attrs check) leaves every other offset intact
    if (scan.consumed.has(i)) {
      i++;
      continue;
    }

    // a pure {attrs} line right inside a container fence is container attrs
    if (
      stack.length > 0 &&
      stack[stack.length - 1].awaitingAttrs &&
      PURE_ATTR_RE.test(line.text)
    ) {
      const open = stack[stack.length - 1];
      const res = parseAttrBlock(line.text.trim(), line.start + indentOf(line.text));
      diags.push(...res.diags);
      open.block.attrs = { ...open.block.attrs, ...res.attrs };
      open.awaitingAttrs = false;
      i++;
      continue;
    }
    if (stack.length > 0) stack[stack.length - 1].awaitingAttrs = false;

    const cls = classify(line.text, topIsImageRow());
    switch (cls) {
      case "blank":
        i++;
        break;
      case "colon": {
        if (!handleColon(line)) {
          makeParagraph(i, i);
          i++;
        }
        break;
      }
      case "tick":
        handleTick(line);
        break;
      case "math":
        handleMath(line);
        break;
      case "heading": {
        const m = HEADING_RE.exec(line.text) as RegExpExecArray;
        let level = m[1].length;
        if (level > 3) {
          warn(
            "heading-too-deep",
            `headings go down to ### only — '${m[1]}' treated as ###`,
            lineSpan(line),
            "#, ## or ###",
          );
          level = 3;
        }
        const contentOff = line.start + (line.text.length - m[2].length);
        const stripped = stripTrailingAttrs(m[2], contentOff);
        target().push({
          kind: "heading",
          level: level as 1 | 2 | 3,
          content: inline(stripped.text.trim(), contentOff),
          attrs: stripped.attrs,
          srcStart: line.start,
          srcEnd: line.end,
        });
        i++;
        break;
      }
      case "divider": {
        const m = DIVIDER_RE.exec(line.text) as RegExpExecArray;
        let attrs: Attrs = {};
        if (m[2] !== undefined) {
          const res = parseAttrBlock(m[2], line.start + line.text.indexOf("{"));
          diags.push(...res.diags);
          attrs = res.attrs;
        }
        target().push({
          kind: "divider",
          attrs,
          srcStart: line.start,
          srcEnd: line.end,
        });
        i++;
        break;
      }
      case "list":
        handleList();
        break;
      case "quote":
        handleQuote();
        break;
      case "table":
        handleTable();
        break;
      case "image": {
        const m = IMAGE_RE.exec(line.text) as RegExpExecArray;
        let attrs: Attrs = {};
        if (m[3] !== undefined) {
          const res = parseAttrBlock(m[3], line.start + line.text.lastIndexOf(m[3]));
          diags.push(...res.diags);
          attrs = res.attrs;
        }
        if (m[2].trim() === "") {
          warn(
            "image-missing-src",
            "image has no source — nothing will render",
            lineSpan(line),
            "![alt](path/to/image.png) or a 'fetch:' line",
          );
        }
        target().push({
          kind: "image",
          alt: m[1],
          src: m[2].trim(),
          attrs,
          srcStart: line.start,
          srcEnd: line.end,
        });
        i++;
        break;
      }
      case "fetchline": {
        const m = FETCH_LINE_RE.exec(line.text) as RegExpExecArray;
        const base = line.start + (line.text.length - m[1].length);
        const { query, attrs } = handleFetchRest(m[1].trim(), base);
        target().push({
          kind: "fetchDirective",
          query,
          attrs,
          srcStart: line.start,
          srcEnd: line.end,
        });
        i++;
        break;
      }
      case "imageline": {
        const m = IMAGE_LINE_RE.exec(line.text) as RegExpExecArray;
        const rest = m[1].trim();
        const base = line.start + (line.text.length - m[1].length);
        const pipeAt = rest.indexOf("|");
        const src = (pipeAt === -1 ? rest : rest.slice(0, pipeAt)).trim();
        let attrs: Attrs = {};
        if (pipeAt !== -1) {
          const res = parseBareAttrs(rest.slice(pipeAt + 1), base + pipeAt + 1);
          diags.push(...res.diags);
          attrs = res.attrs;
        }
        let alt = "";
        if (typeof attrs.alt === "string") {
          alt = attrs.alt;
          delete attrs.alt;
        }
        target().push({
          kind: "image",
          alt,
          src,
          attrs,
          srcStart: line.start,
          srcEnd: line.end,
        });
        i++;
        break;
      }
      case "paragraph": {
        let j = i;
        while (
          j + 1 < lines.length &&
          classify(lines[j + 1].text, topIsImageRow()) === "paragraph" &&
          !(j + 1 === lines.length - 1 && lines[j + 1].text === "" && lines[j + 1].start >= source.length)
        ) {
          j++;
        }
        makeParagraph(i, j);
        i = j + 1;
        break;
      }
    }
  }

  // auto-close containers left open at EOF
  while (stack.length > 0) {
    const open = stack.pop() as OpenContainer;
    open.block.srcEnd = source.length;
    warn(
      "container-unclosed",
      `container ':::${open.block.rawName ?? open.block.name}' was never closed — closed at end of note`,
      { srcStart: open.block.srcStart, srcEnd: open.block.srcStart + 3 },
      "a closing ':::' line",
    );
  }

  // --- v2 post-pass: {{variables}}, {use=style}, [^footnote]: definitions --
  // Runs even with no definitions: a stray `{{placeholder}}` an AI left behind
  // is exactly the kind of thing the author needs told about.
  const doc: ScriptDoc = { frontmatter, blocks, diagnostics: diags };
  applyDefinitions(doc, vars, styles, diags, fmSpans, scan.notes);
  if (Object.keys(vars).length > 0) doc.vars = vars;
  if (Object.keys(styles).length > 0) doc.styles = styles;

  locateDiags(diags, lines.map((l) => l.start));
  doc.diagnostics = sortDiags(diags);
  return doc;
}
