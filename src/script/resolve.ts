/**
 * Notebook Script v2 — variables (`::let`) and reusable styles (`::style`).
 *
 * Both are document-scoped leaf directives collected in a pre-pass *before*
 * the block pass, so a definition may appear anywhere in the note — after its
 * first use, inside a container, at the very bottom. The pre-pass records the
 * line indices it consumed; the block parser skips exactly those lines, which
 * keeps every other source offset untouched.
 *
 *   ::let course = Cell Biology
 *   ::let {teacher="Dr. Ito", week=3}
 *   ::style hero {color=amber, rotate=-2, tape=corner}
 *
 *   # {{course}} — week {{week}} {use=hero}
 *
 * Substitution happens after the block pass, over the finished tree: values
 * land as plain text (never re-parsed as markup, so a variable can never
 * inject structure) and named styles are merged *under* the attrs written on
 * the block, so an explicit attr always wins. Both passes are total: unknown
 * names and cycles produce diagnostics and leave the source text alone.
 */

import type {
  Attrs,
  Block,
  Diag,
  Inline,
  ScriptDoc,
  Span,
  SrcLine,
} from "./types";
import { parseAttrBlock } from "./attrParser";
import { expectedOneOf, pushDiag } from "./diagnostics";
import { normalizeName } from "./normalize";
import { LET_DIRECTIVE_NAMES, STYLE_DIRECTIVE_NAMES } from "./vocab";

// ---------------------------------------------------------------------------
// Pre-pass: collect definitions
// ---------------------------------------------------------------------------

interface VarDef {
  value: string;
  span: Span;
}

interface StyleDef {
  attrs: Attrs;
  span: Span;
}

export interface DirectiveScan {
  vars: Map<string, VarDef>;
  styles: Map<string, StyleDef>;
  /** `[^label]: note` definitions, label lowercased. */
  notes: Map<string, VarDef>;
  /** Line indices the block parser must skip. */
  consumed: Set<number>;
  diags: Diag[];
}

/** `::let`, `:: let`, `:::var` … — colons counted so we can warn about `:::`. */
const DIRECTIVE_RE = /^\s*(:{2,})\s*([A-Za-z][\w-]*)(?![\w-])\s*(.*)$/;
/**
 * `[^1]: the note` — Markdown's own footnote definition, on its own line.
 *
 * Notebook Script's canonical form puts the note inside the marker
 * (`[^ like this ]`), because that is how the editor stores it. But every
 * chatbot alive writes the two-part Markdown form, and a language that only
 * accepts its own canon is a language that gets slop and renders it as prose.
 * So both are read; only one is printed.
 */
const NOTE_DEF_RE = /^\s*\[\^([^\]\n]+)\]:[ \t]*(.*)$/;
const TICK_OPEN_RE = /^\s*`{3,}/;
const TICK_CLOSE_RE = /^\s*`{2,}\s*$/;

/** Strip one matching pair of surrounding quotes. */
function unquote(raw: string): string {
  if (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Scan `lines[from…]` for `::let` / `::style` leaf directives. Lines inside a
 * ``` fence are left alone — a fence body is literal text, not script.
 */
export function scanDirectives(lines: SrcLine[], from: number): DirectiveScan {
  const vars = new Map<string, VarDef>();
  const styles = new Map<string, StyleDef>();
  const notes = new Map<string, VarDef>();
  const consumed = new Set<number>();
  const diags: Diag[] = [];
  let inFence = false;

  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    const span: Span = { srcStart: line.start, srcEnd: line.end };

    if (inFence) {
      if (TICK_CLOSE_RE.test(line.text)) inFence = false;
      continue;
    }
    if (TICK_OPEN_RE.test(line.text)) {
      inFence = true;
      continue;
    }

    const note = NOTE_DEF_RE.exec(line.text);
    if (note !== null) {
      consumed.add(i);
      const label = note[1].trim().toLowerCase();
      if (notes.has(label)) {
        pushDiag(
          diags,
          "footnote-duplicate",
          `footnote '${note[1].trim()}' is defined twice — the later one wins`,
          span,
        );
      }
      notes.set(label, { value: note[2].trim(), span });
      continue;
    }

    const m = DIRECTIVE_RE.exec(line.text);
    if (m === null) continue;
    const norm = normalizeName(m[2]);
    const isLet = (LET_DIRECTIVE_NAMES as readonly string[]).includes(norm);
    const isStyle = (STYLE_DIRECTIVE_NAMES as readonly string[]).includes(norm);
    if (!isLet && !isStyle) continue;

    consumed.add(i);
    const colons = m[1].length;
    const rest = m[3].trim();
    const restBase = line.start + (line.text.length - m[3].length);

    if (colons !== 2) {
      pushDiag(
        diags,
        isLet ? "let-wrong-fence" : "style-wrong-fence",
        `'${m[1]}${m[2]}' is a leaf directive, not a container — write '::${isLet ? "let" : "style"}' (no closing ':::' needed)`,
        span,
        `::${isLet ? "let" : "style"} …`,
      );
    }

    if (isLet) collectLet(rest, restBase, span, vars, diags);
    else collectStyle(rest, restBase, span, styles, diags);
  }

  return { vars, styles, notes, consumed, diags };
}

/** Warn when a name is defined twice; the later definition still wins. */
function define(
  map: Map<string, VarDef> | Map<string, StyleDef>,
  name: string,
  diags: Diag[],
  span: Span,
  kind: "let" | "style",
): void {
  if (map.has(name)) {
    pushDiag(
      diags,
      kind === "let" ? "let-duplicate" : "style-duplicate",
      `${kind === "let" ? "variable" : "style"} '${name}' is defined twice — the last definition wins`,
      span,
    );
  }
}

function collectLet(
  rest: string,
  base: number,
  span: Span,
  vars: Map<string, VarDef>,
  diags: Diag[],
): void {
  // brace form: ::let {course="Cell Biology", week=3}
  if (rest.startsWith("{")) {
    const res = parseAttrBlock(rest, base, { raw: true });
    diags.push(...res.diags);
    const keys = Object.keys(res.attrs);
    if (keys.length === 0) {
      pushDiag(
        diags,
        "let-missing-name",
        "'::let {…}' defines no variables",
        span,
        "::let {name=value}",
      );
      return;
    }
    for (const key of keys) {
      define(vars, key, diags, span, "let");
      vars.set(key, { value: String(res.attrs[key]), span });
    }
    return;
  }

  // plain form: ::let course = Cell Biology
  const eq = rest.search(/[=:]/);
  if (rest === "") {
    pushDiag(diags, "let-missing-name", "'::let' has no variable name", span, "::let name = value");
    return;
  }
  if (eq === -1) {
    const name = normalizeName(rest.split(/\s+/)[0]);
    pushDiag(
      diags,
      "let-missing-value",
      `variable '${name}' has no value — using an empty string`,
      span,
      `::let ${name} = value`,
    );
    if (name !== "") {
      define(vars, name, diags, span, "let");
      vars.set(name, { value: "", span });
    }
    return;
  }
  const name = normalizeName(rest.slice(0, eq).trim());
  if (name === "") {
    pushDiag(diags, "let-missing-name", "'::let' has no variable name", span, "::let name = value");
    return;
  }
  define(vars, name, diags, span, "let");
  vars.set(name, { value: unquote(rest.slice(eq + 1).trim()), span });
}

function collectStyle(
  rest: string,
  base: number,
  span: Span,
  styles: Map<string, StyleDef>,
  diags: Diag[],
): void {
  const nameMatch = /^([^\s{]+)/.exec(rest);
  const name = nameMatch === null ? "" : normalizeName(nameMatch[1]);
  if (name === "") {
    pushDiag(
      diags,
      "style-missing-name",
      "'::style' has no name",
      span,
      "::style name {color=amber}",
    );
    return;
  }
  const after = rest.slice(nameMatch === null ? 0 : nameMatch[1].length).trim();
  let attrs: Attrs = {};
  if (after.startsWith("{")) {
    const res = parseAttrBlock(after, base + (rest.length - after.length));
    diags.push(...res.diags);
    attrs = res.attrs;
  } else if (after !== "") {
    // brace-less form: ::style hero color=amber, rotate=-2
    const res = parseAttrBlock(`{${after}}`, base + (rest.length - after.length));
    diags.push(...res.diags);
    attrs = res.attrs;
  }
  if (Object.keys(attrs).length === 0) {
    pushDiag(
      diags,
      "style-missing-attrs",
      `style '${name}' defines no attributes`,
      span,
      `::style ${name} {color=amber}`,
    );
  }
  define(styles, name, diags, span, "style");
  styles.set(name, { attrs, span });
}

// ---------------------------------------------------------------------------
// Resolution (definitions referring to definitions)
// ---------------------------------------------------------------------------

const REF_RE = /\{\{([^{}]*)\}\}/g;

/** True when the text holds at least one `{{reference}}`. */
export function hasVarRef(text: string): boolean {
  REF_RE.lastIndex = 0;
  return REF_RE.test(text);
}

/**
 * Resolve every variable value, substituting references to other variables.
 * Cycles are reported once and left literal (so the note still shows what the
 * author wrote instead of looping or blanking out).
 */
export function resolveVars(
  defs: Map<string, VarDef>,
  diags: Diag[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const state = new Map<string, "busy" | "done">();

  const walk = (name: string, trail: string[]): string => {
    const def = defs.get(name);
    if (def === undefined) return `{{${name}}}`;
    const mark = state.get(name);
    if (mark === "done") return out[name];
    if (mark === "busy") {
      pushDiag(
        diags,
        "var-cycle",
        `variable cycle: ${[...trail, name].join(" → ")} — left unresolved`,
        def.span,
      );
      return `{{${name}}}`;
    }
    state.set(name, "busy");
    const resolved = def.value.replace(REF_RE, (whole, inner: string) => {
      const ref = normalizeName(inner.trim());
      if (ref === "") return whole;
      if (!defs.has(ref)) {
        pushDiag(
          diags,
          "var-unknown",
          `unknown variable '${ref}' in the definition of '${name}'`,
          def.span,
          definedList(defs),
        );
        return whole;
      }
      return walk(ref, [...trail, name]);
    });
    state.set(name, "done");
    out[name] = resolved;
    return resolved;
  };

  for (const name of defs.keys()) walk(name, []);
  return out;
}

/** Expand `use=` inside style definitions, then hand back plain attr sets. */
export function resolveStyles(
  defs: Map<string, StyleDef>,
  diags: Diag[],
): Record<string, Attrs> {
  const out: Record<string, Attrs> = {};
  const state = new Map<string, "busy" | "done">();

  const walk = (name: string, trail: string[]): Attrs => {
    const def = defs.get(name);
    if (def === undefined) return {};
    const mark = state.get(name);
    if (mark === "done") return out[name];
    if (mark === "busy") {
      pushDiag(
        diags,
        "style-cycle",
        `style cycle: ${[...trail, name].join(" → ")} — left unexpanded`,
        def.span,
      );
      return {};
    }
    state.set(name, "busy");
    let merged: Attrs = {};
    for (const ref of styleRefs(def.attrs)) {
      if (!defs.has(ref)) {
        pushDiag(
          diags,
          "style-unknown",
          `unknown style '${ref}' used by style '${name}'`,
          def.span,
          definedList(defs),
        );
        continue;
      }
      merged = { ...merged, ...walk(ref, [...trail, name]) };
    }
    const result = { ...merged, ...def.attrs };
    state.set(name, "done");
    out[name] = result;
    return result;
  };

  for (const name of defs.keys()) walk(name, []);
  return out;
}

/** `use=hero` / `use="hero tilted"` → ["hero", "tilted"]. */
function styleRefs(attrs: Attrs): string[] {
  const raw = attrs.use;
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => normalizeName(s))
    .filter((s) => s !== "");
}

function definedList(defs: Map<string, unknown>): string {
  const names = [...defs.keys()].sort();
  return names.length === 0 ? "no definitions in this note" : expectedOneOf(names);
}

// ---------------------------------------------------------------------------
// Application pass over the parsed tree
// ---------------------------------------------------------------------------

interface ApplyCtx {
  vars: Record<string, string>;
  styles: Record<string, Attrs>;
  /** `[^label]: note` definitions, label lowercased. */
  notes: Map<string, VarDef>;
  /** Definitions a marker actually reached — the rest are reported unused. */
  notesUsed: Set<string>;
  diags: Diag[];
  /** Names already reported missing — one diagnostic per name is plenty. */
  reported: Set<string>;
}

/**
 * Substitute `{{name}}` in `text`. `base` is the source offset of `text[0]`
 * when known (spans are approximate inside escaped text, and clamped).
 */
function substitute(text: string, base: number, ctx: ApplyCtx): string {
  if (!text.includes("{{")) return text;
  REF_RE.lastIndex = 0;
  return text.replace(REF_RE, (whole, inner: string, index: number) => {
    const span: Span = {
      srcStart: base + index,
      srcEnd: base + index + whole.length,
    };
    const name = normalizeName(inner.trim());
    if (name === "") {
      pushDiag(ctx.diags, "var-empty-reference", "'{{}}' names no variable", span, "{{name}}");
      return whole;
    }
    const value = ctx.vars[name];
    if (value === undefined) {
      if (!ctx.reported.has(name)) {
        ctx.reported.add(name);
        const known = Object.keys(ctx.vars).sort();
        pushDiag(
          ctx.diags,
          "var-unknown",
          `unknown variable '${name}' — define it with '::let ${name} = …'`,
          span,
          known.length === 0
            ? "no variables are defined in this note"
            : expectedOneOf(known),
        );
      }
      return whole;
    }
    return value;
  });
}

/** Merge a named style under the attrs written on the block, then substitute. */
function applyAttrs(attrs: Attrs, span: Span, ctx: ApplyCtx): Attrs {
  let result = attrs;
  const refs = styleRefs(attrs);
  if (refs.length > 0) {
    let merged: Attrs = {};
    for (const ref of refs) {
      const style = ctx.styles[ref];
      if (style === undefined) {
        if (!ctx.reported.has(`style:${ref}`)) {
          ctx.reported.add(`style:${ref}`);
          const known = Object.keys(ctx.styles).sort();
          pushDiag(
            ctx.diags,
            "style-unknown",
            `unknown style '${ref}' — define it with '::style ${ref} {…}'`,
            span,
            known.length === 0
              ? "no styles are defined in this note"
              : expectedOneOf(known),
          );
        }
        continue;
      }
      merged = { ...merged, ...style };
    }
    // explicit attrs win over the style they name
    result = { ...merged, ...attrs };
  }
  for (const key of Object.keys(result)) {
    const v = result[key];
    if (typeof v === "string") result[key] = substitute(v, span.srcStart, ctx);
  }
  return result;
}

/**
 * Turn `[^1]` into the note `[^1]: …` defined for it.
 *
 * The marker's own text is the note UNLESS a definition claims that exact
 * label, which is what lets both spellings live in one language: a note
 * somebody wrote inline stays what they wrote, and a bare Markdown label
 * finds its definition. A label with no definition keeps its own text (there
 * is nothing better to show) and earns a warning naming what was defined.
 */
function resolveNote(node: { text: string }, span: Span, ctx: ApplyCtx): void {
  const label = node.text.trim().toLowerCase();
  if (label === "") return;
  const def = ctx.notes.get(label);
  if (def !== undefined) {
    ctx.notesUsed.add(label);
    node.text = def.value;
    return;
  }
  // Only a BARE label looks like a reference to a definition. Anything with a
  // space in it is prose, and prose is a note that was written in place.
  if (ctx.notes.size === 0 || /\s/.test(node.text.trim())) return;
  const key = `note:${label}`;
  if (ctx.reported.has(key)) return;
  ctx.reported.add(key);
  pushDiag(
    ctx.diags,
    "footnote-undefined",
    `footnote '${node.text.trim()}' has no '[^${node.text.trim()}]: …' line — the marker reads as its own note`,
    span,
    definedList(ctx.notes),
  );
}

function applyInlines(nodes: Inline[], ctx: ApplyCtx): void {
  for (const n of nodes) {
    if (n.attrs !== undefined) {
      n.attrs = applyAttrs(n.attrs, { srcStart: n.srcStart, srcEnd: n.srcEnd }, ctx);
    }
    switch (n.kind) {
      case "text":
        n.text = substitute(n.text, n.srcStart, ctx);
        break;
      case "code":
      case "math":
        // Literal by definition. A code span is the reader's own characters
        // and a formula is another language's source; substituting into
        // either would be this parser editing something it cannot read.
        break;
      case "footnote":
        resolveNote(n, { srcStart: n.srcStart, srcEnd: n.srcEnd }, ctx);
        n.text = substitute(n.text, n.srcStart, ctx);
        break;
      case "pageref":
        n.label = substitute(n.label, n.srcStart, ctx);
        break;
      case "link":
        n.href = substitute(n.href, n.srcStart, ctx);
        applyInlines(n.children, ctx);
        break;
      default:
        applyInlines(n.children, ctx);
        break;
    }
  }
}

function applyBlocks(blocks: Block[], ctx: ApplyCtx): void {
  for (const b of blocks) {
    const span: Span = { srcStart: b.srcStart, srcEnd: b.srcEnd };
    b.attrs = applyAttrs(b.attrs, span, ctx);
    switch (b.kind) {
      case "heading":
      case "paragraph":
      case "quote":
        applyInlines(b.content, ctx);
        break;
      case "list":
      case "taskList": {
        const items = [...b.items];
        while (items.length > 0) {
          const item = items.pop() as (typeof items)[number];
          applyInlines(item.content, ctx);
          items.push(...item.children);
        }
        break;
      }
      case "table":
        if (b.header !== null) {
          for (const cell of b.header.cells) applyInlines(cell, ctx);
        }
        for (const row of b.rows) {
          for (const cell of row.cells) applyInlines(cell, ctx);
        }
        break;
      case "image":
        b.src = substitute(b.src, b.srcStart, ctx);
        b.alt = substitute(b.alt, b.srcStart, ctx);
        break;
      case "fetchDirective":
        b.query = substitute(b.query, b.srcStart, ctx);
        break;
      case "container":
        applyBlocks(b.children, ctx);
        break;
      case "diagram":
        // switch (not if/else) so the union narrows on `lang`
        switch (b.lang) {
          case "timeline":
            for (const e of b.entries) {
              e.label = substitute(e.label, e.srcStart, ctx);
              e.text = substitute(e.text, e.srcStart, ctx);
              if (e.attrs !== undefined) {
                e.attrs = applyAttrs(
                  e.attrs,
                  { srcStart: e.srcStart, srcEnd: e.srcEnd },
                  ctx,
                );
              }
            }
            break;
          case "graph":
          case "flowchart":
            for (const n of b.graph.nodes) {
              const before = n.id;
              n.id = substitute(n.id, n.srcStart, ctx);
              if (n.label !== undefined) {
                n.label = substitute(n.label, n.srcStart, ctx);
              }
              if (n.attrs !== undefined) {
                n.attrs = applyAttrs(
                  n.attrs,
                  { srcStart: n.srcStart, srcEnd: n.srcEnd },
                  ctx,
                );
              }
              if (n.id !== before) {
                // keep edges pointing at the node they were written against
                for (const e of b.graph.edges) {
                  if (e.from === before) e.from = n.id;
                  if (e.to === before) e.to = n.id;
                }
              }
            }
            for (const e of b.graph.edges) {
              if (e.label !== undefined) {
                e.label = substitute(e.label, e.srcStart, ctx);
              }
            }
            break;
          case "tree":
          case "mindmap": {
            const stack = [...b.roots];
            while (stack.length > 0) {
              const node = stack.pop() as (typeof stack)[number];
              node.label = substitute(node.label, node.srcStart, ctx);
              if (node.note !== undefined) {
                node.note = substitute(node.note, node.srcStart, ctx);
              }
              if (node.attrs !== undefined) {
                node.attrs = applyAttrs(
                  node.attrs,
                  { srcStart: node.srcStart, srcEnd: node.srcEnd },
                  ctx,
                );
              }
              stack.push(...node.children);
            }
            break;
          }
        }
        break;
      default:
        break;
    }
  }
}

/**
 * Apply resolved variables and styles to a parsed document, in place.
 * Diagnostics are appended to `diags` — the caller sorts and locates them.
 */
export function applyDefinitions(
  doc: Pick<ScriptDoc, "frontmatter" | "blocks">,
  vars: Record<string, string>,
  styles: Record<string, Attrs>,
  diags: Diag[],
  frontmatterSpans: Record<string, Span> = {},
  notes: Map<string, { value: string; span: Span }> = new Map(),
): void {
  const ctx: ApplyCtx = {
    vars,
    styles,
    notes,
    notesUsed: new Set(),
    diags,
    reported: new Set(),
  };
  for (const key of Object.keys(doc.frontmatter)) {
    const span = frontmatterSpans[key];
    doc.frontmatter[key] = substitute(
      doc.frontmatter[key],
      span !== undefined ? span.srcStart : 0,
      ctx,
    );
  }
  applyBlocks(doc.blocks, ctx);
  // A definition nothing points at is a note the reader will never see: the
  // line was lifted out of the page, so silence would simply lose it.
  for (const [label, def] of notes) {
    if (ctx.notesUsed.has(label)) continue;
    pushDiag(
      diags,
      "footnote-unused",
      `'[^${label}]: …' is defined but never referenced — nothing on the page points at it`,
      def.span,
      `a '[^${label}]' marker in the text`,
    );
  }
}
