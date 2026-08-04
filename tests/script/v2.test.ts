/**
 * Notebook Script v2: precise diagnostics, `::let` variables and `::style`
 * reusable attribute sets.
 *
 * The whole point of v2 is that a person pastes AI-written script and is told
 * exactly what did not work — so most of this file asserts on diagnostic
 * codes, positions and "expected" text, and on the parser staying total while
 * doing it.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parse, print } from "../../src/script";
import type {
  Block,
  ContainerBlock,
  Diag,
  DiagCode,
  Inline,
  ScriptDoc,
  TimelineDiagramBlock,
  TreeDiagramBlock,
} from "../../src/script";
import { stripSpans } from "./fixtures";

function kindOf<K extends Block["kind"]>(
  block: Block,
  kind: K,
): Extract<Block, { kind: K }> {
  expect(block.kind).toBe(kind);
  return block as Extract<Block, { kind: K }>;
}

function codes(doc: ScriptDoc): DiagCode[] {
  return doc.diagnostics.map((d) => d.code);
}

function find(doc: ScriptDoc, code: DiagCode): Diag {
  const hit = doc.diagnostics.find((d) => d.code === code);
  expect(hit, `expected a '${code}' diagnostic, got ${codes(doc).join(", ")}`).toBeDefined();
  return hit as Diag;
}

/** Concatenated plain text of an inline tree. */
function inlineText(nodes: Inline[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text" || n.kind === "code") out += n.text;
    else out += inlineText(n.children);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Diagnostics
// ---------------------------------------------------------------------------

describe("diagnostics carry a code and a source position", () => {
  it("locates line and column 1-based at the start of the span", () => {
    const doc = parse("# ok\n\nfine\n\n# H {color=chartreuse}");
    const d = find(doc, "attr-unknown-value");
    expect(d.line).toBe(5);
    // "# H {color=chartreuse}" — the pair starts at the 'c' of color
    expect(d.column).toBe(6);
    expect(d.severity).toBe("warn");
    expect(d.expected).toContain("amber");
  });

  it("counts lines identically with CRLF endings", () => {
    const lf = parse("a\n\nb\n\n#### deep");
    const crlf = parse("a\r\n\r\nb\r\n\r\n#### deep");
    expect(find(lf, "heading-too-deep").line).toBe(5);
    expect(find(crlf, "heading-too-deep").line).toBe(5);
  });

  it("reports diagnostics in source order, not parse order", () => {
    const doc = parse(
      ["::let a = 1", "", "# H {color=nope}", "", "::: wobbly", "hi", ":::", "", "{{ghost}}"].join("\n"),
    );
    const lines = doc.diagnostics.map((d) => d.line);
    expect(lines).toEqual([...lines].sort((x, y) => x - y));
    expect(codes(doc)).toContain("var-unknown");
    expect(codes(doc)).toContain("unknown-container");
  });

  it("every diagnostic of a messy note is located and coded", () => {
    const doc = parse(
      [
        "---",
        "papper: gird",
        "---",
        "",
        "#### too deep {wobble, rotate=left}",
        "",
        "<div>html</div>",
        "",
        "::: wobbly-box",
        "unclosed",
      ].join("\n"),
    );
    expect(doc.diagnostics.length).toBeGreaterThan(4);
    for (const d of doc.diagnostics) {
      expect(d.severity).toBe("warn");
      expect(typeof d.code).toBe("string");
      expect(d.line).toBeGreaterThanOrEqual(1);
      expect(d.column).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("attribute diagnostics say what was expected", () => {
  it("bare known key that needs a value", () => {
    const doc = parse("# H {color}");
    const d = find(doc, "attr-missing-value");
    expect(d.expected).toBe("color=amber");
  });

  it("'=' with nothing after it", () => {
    const doc = parse("# H {color=}");
    expect(codes(doc)).toContain("attr-missing-value");
  });

  it("numeric key with a word value", () => {
    const doc = parse("# H {rotate=slightly}");
    const d = find(doc, "attr-not-a-number");
    expect(d.expected).toBe("rotate=<number>");
    expect(doc.blocks[0].attrs).toEqual({ rotate: "slightly" });
  });

  it("the same key twice", () => {
    const doc = parse("# H {color=amber, color=moss}");
    expect(codes(doc)).toContain("attr-duplicate");
    expect(doc.blocks[0].attrs).toEqual({ color: "moss" });
  });

  it("junk punctuation inside the braces", () => {
    const doc = parse("# H {=, color=amber}");
    const d = find(doc, "attr-junk");
    expect(d.expected).toBe("key=value");
    expect(doc.blocks[0].attrs).toEqual({ color: "amber" });
  });

  it("a stray '#' or '.' marker", () => {
    const doc = parse("# H {# color=amber}");
    expect(codes(doc)).toContain("attr-stray-marker");
  });

  it("unknown enum values list the domain", () => {
    const doc = parse("# H {sticker=dragon}");
    const d = find(doc, "attr-unknown-value");
    expect(d.expected).toContain("microscope");
  });

  it("'::: callout tip' is not an unknown attribute", () => {
    const doc = parse("::: callout tip\nHydrate.\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.attrs.variant).toBe("tip");
    expect(doc.diagnostics).toEqual([]);
  });
});

describe("wrong-language diagnostics (what a chatbot actually gets wrong)", () => {
  it("flags JSX components", () => {
    const doc = parse('<Callout type="info">Remember the exam!</Callout>');
    const d = find(doc, "jsx-not-script");
    expect(d.message).toContain("Callout");
    expect(d.expected).toContain(":::");
    expect(doc.blocks[0].kind).toBe("paragraph");
  });

  it("flags HTML tags", () => {
    const doc = parse('<img src="cell.png" width="300"/>');
    expect(codes(doc)).toContain("html-not-script");
  });

  it("flags ESM imports", () => {
    const doc = parse("import { Callout } from './ui'");
    expect(codes(doc)).toContain("import-not-script");
  });

  it("flags Setext underlines", () => {
    const doc = parse("My Title\n========");
    expect(codes(doc)).toContain("setext-heading");
  });

  it("warns once per paragraph, not once per tag", () => {
    const doc = parse("<div>a</div>\n<div>b</div>\n<div>c</div>");
    expect(codes(doc).filter((c) => c === "html-not-script")).toHaveLength(1);
  });

  it("leaves ordinary prose with angle brackets alone", () => {
    const doc = parse("If a < b and b > c then a < c.");
    expect(doc.diagnostics).toEqual([]);
  });
});

describe("structure diagnostics", () => {
  it("frontmatter that is not flat key: value is reported, not silently dropped", () => {
    const doc = parse("---\nnot a pair\npaper: grid\n---\n\nhi");
    const d = find(doc, "frontmatter-invalid");
    expect(d.line).toBe(2);
    expect(doc.frontmatter).toEqual({});
  });

  it("unclosed frontmatter is reported", () => {
    const doc = parse("---\npaper: grid\n\nhi");
    expect(codes(doc)).toContain("frontmatter-unclosed");
  });

  it("nested YAML is called out per indented line", () => {
    const doc = parse("---\nstyle:\n  paper: grid\n---\n\nhi");
    expect(codes(doc)).toContain("frontmatter-nested");
  });

  it("a note that merely opens with a divider stays silent", () => {
    const doc = parse("---\njust a divider and text\n---\n\nhi");
    expect(doc.diagnostics).toEqual([]);
  });

  it("unknown frontmatter keys are kept and reported", () => {
    const doc = parse("---\nauthor: zoe\n---\n\nhi");
    const d = find(doc, "frontmatter-unknown-key");
    expect(d.expected).toContain("paper");
    expect(doc.frontmatter.author).toBe("zoe");
  });

  it("::: col outside ::: columns", () => {
    const doc = parse("::: col\nlonely\n:::");
    expect(codes(doc)).toContain("col-outside-columns");
    const doc2 = parse("::: columns\n::: col\nfine\n:::\n:::");
    expect(codes(doc2)).not.toContain("col-outside-columns");
  });

  it("ragged table rows", () => {
    const doc = parse("| a | b |\n| --- | --- |\n| 1 | 2 | 3 |");
    const d = find(doc, "table-ragged");
    expect(d.expected).toBe("2 cells");
  });

  it("images with no source", () => {
    expect(codes(parse("![alt]()"))).toContain("image-missing-src");
  });

  it("runaway container nesting warns exactly once", () => {
    const doc = parse(Array.from({ length: 12 }, () => "::: card").join("\n"));
    expect(codes(doc).filter((c) => c === "container-too-deep")).toHaveLength(1);
  });

  it("unknown containers and fences name the alternatives", () => {
    const box = find(parse("::: wobbly-box\nhi\n:::"), "unknown-container");
    expect(box.expected).toContain("sticky-note");
    // `python` is a language the app knows, so it is code and nothing is
    // reported. The diagnostic is for a word that names nothing at all.
    const fence = find(parse("```wobbly\nprint(1)\n```"), "fence-unknown-lang");
    expect(fence.expected).toContain("timeline");
  });
});

// ---------------------------------------------------------------------------
// 2. Variables
// ---------------------------------------------------------------------------

describe("::let variables", () => {
  it("defines and substitutes, in both spellings", () => {
    const doc = parse(
      ['::let course = Cell Biology', '::let {week=3, teacher="Dr. Ito"}', "", "# {{course}} — week {{week}}", "", "Taught by {{teacher}}."].join("\n"),
    );
    expect(doc.vars).toEqual({
      course: "Cell Biology",
      week: "3",
      teacher: "Dr. Ito",
    });
    expect(inlineText(kindOf(doc.blocks[0], "heading").content)).toBe(
      "Cell Biology — week 3",
    );
    expect(inlineText(kindOf(doc.blocks[1], "paragraph").content)).toBe(
      "Taught by Dr. Ito.",
    );
    expect(doc.diagnostics).toEqual([]);
  });

  it("resolves a reference written before its definition", () => {
    const doc = parse("{{who}} says hi\n\n::let who = Zoe");
    expect(inlineText(kindOf(doc.blocks[0], "paragraph").content)).toBe("Zoe says hi");
  });

  it("resolves variables inside variables", () => {
    const doc = parse("::let a = deep\n::let b = very {{a}}\n::let c = {{b}} value\n\n{{c}}");
    expect(doc.vars?.c).toBe("very deep value");
  });

  it("matches names case- and dash-insensitively", () => {
    const doc = parse("::let Course_Name = Bio\n\n{{course-name}} / {{COURSENAME}}");
    expect(inlineText(kindOf(doc.blocks[0], "paragraph").content)).toBe("Bio / Bio");
  });

  it("substitutes into attrs, frontmatter, images and diagrams", () => {
    const doc = parse(
      [
        "---",
        "title: {{course}} notes",
        "---",
        "",
        "::let course = Bio",
        "::let tint = moss",
        "",
        "# H {color={{tint}}}",
        "",
        "![{{course}} diagram](assets/{{course}}.png)",
        "",
        "```tree",
        "{{course}}",
        "  Cells | of {{course}}",
        "```",
        "",
        "```timeline",
        "1665: {{course}} begins",
        "```",
      ].join("\n"),
    );
    expect(doc.frontmatter.title).toBe("Bio notes");
    expect(doc.blocks[0].attrs).toEqual({ color: "moss" });
    const img = kindOf(doc.blocks[1], "image");
    expect(img.src).toBe("assets/Bio.png");
    expect(img.alt).toBe("Bio diagram");
    const tree = kindOf(doc.blocks[2], "diagram") as TreeDiagramBlock;
    expect(tree.roots[0].label).toBe("Bio");
    expect(tree.roots[0].children[0].note).toBe("of Bio");
    const tl = kindOf(doc.blocks[3], "diagram") as TimelineDiagramBlock;
    expect(tl.entries[0].text).toBe("Bio begins");
  });

  it("never substitutes inside code spans", () => {
    const doc = parse("::let a = 1\n\nliteral `{{a}}` here");
    const p = kindOf(doc.blocks[0], "paragraph");
    const code = p.content.find((n) => n.kind === "code");
    expect(code?.kind === "code" && code.text).toBe("{{a}}");
  });

  it("reports an unknown reference with position and the known names", () => {
    const doc = parse("::let course = Bio\n\nsee {{topic}}");
    const d = find(doc, "var-unknown");
    expect(d.line).toBe(3);
    expect(d.column).toBe(5);
    expect(d.expected).toBe("course");
    expect(inlineText(kindOf(doc.blocks[0], "paragraph").content)).toBe("see {{topic}}");
  });

  it("says so when the note defines no variables at all", () => {
    const doc = parse("hello {{name}}");
    const d = find(doc, "var-unknown");
    expect(d.expected).toContain("no variables");
  });

  it("reports each unknown name once, however often it appears", () => {
    const doc = parse("{{x}} {{x}} {{x}}");
    expect(codes(doc).filter((c) => c === "var-unknown")).toHaveLength(1);
  });

  it("reports an empty reference", () => {
    expect(codes(parse("a {{}} b"))).toContain("var-empty-reference");
  });

  it("breaks cycles instead of looping", () => {
    const doc = parse("::let a = {{b}}\n::let b = {{a}}\n\n{{a}}");
    const d = find(doc, "var-cycle");
    expect(d.message).toContain("→");
    expect(doc.vars?.a).toContain("{{");
  });

  it("breaks a self-reference", () => {
    const doc = parse("::let a = {{a}}\n\n{{a}}");
    expect(codes(doc)).toContain("var-cycle");
  });

  it("warns on a duplicate definition; the last one wins", () => {
    const doc = parse("::let a = one\n::let a = two\n\n{{a}}");
    expect(codes(doc)).toContain("let-duplicate");
    expect(doc.vars?.a).toBe("two");
  });

  it("warns about a missing name or value but stays total", () => {
    const doc = parse("::let\n::let lonely\n::let = 5");
    expect(codes(doc)).toContain("let-missing-name");
    expect(codes(doc)).toContain("let-missing-value");
    expect(doc.vars).toEqual({ lonely: "" });
  });

  it("':::let' is corrected to a leaf directive, not an open container", () => {
    const doc = parse(":::let a = 1\n\n{{a}}");
    expect(codes(doc)).toEqual(["let-wrong-fence"]);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["paragraph"]);
    expect(inlineText(kindOf(doc.blocks[0], "paragraph").content)).toBe("1");
  });

  it("works from inside a container", () => {
    const doc = parse("::: card\n::let a = hi\n{{a}}\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(inlineText(kindOf(c.children[0], "paragraph").content)).toBe("hi");
    expect(doc.diagnostics).toEqual([]);
  });

  it("is literal text inside a fence — a fence body is not script", () => {
    const doc = parse("```tree\n::let a = 1\nRoot\n```");
    const tree = kindOf(doc.blocks[0], "diagram") as TreeDiagramBlock;
    expect(tree.roots.map((n) => n.label)).toEqual(["::let a = 1", "Root"]);
    expect(doc.vars).toBeUndefined();
  });

  it("does not touch the shape of a document without variables", () => {
    const doc = parse("# plain\n\ntext");
    expect(doc.vars).toBeUndefined();
    expect(doc.styles).toBeUndefined();
    expect(Object.keys(doc)).toEqual(["frontmatter", "blocks", "diagnostics"]);
  });

  it("round-trips through the printer", () => {
    const src = '::let course = Cell Biology\n::let n = 3\n\n# {{course}} {rotate=-2}\n';
    const doc = parse(src);
    const printed = print(doc);
    expect(printed).toContain("::let course = Cell Biology");
    const again = parse(printed);
    expect(again.vars).toEqual(doc.vars);
    expect(stripSpans(again.blocks)).toEqual(stripSpans(doc.blocks));
    expect(print(again)).toBe(printed);
  });

  it("quotes values that would otherwise be misread", () => {
    const doc: ScriptDoc = {
      frontmatter: {},
      blocks: [],
      diagnostics: [],
      vars: { a: "", b: "  padded  ", c: '"quoted"' },
    };
    const printed = print(doc);
    expect(parse(printed).vars).toEqual(doc.vars);
  });
});

// ---------------------------------------------------------------------------
// 3. Reusable styles
// ---------------------------------------------------------------------------

describe("::style reusable attribute sets", () => {
  it("applies a named set to any block", () => {
    const doc = parse(
      "::style hero {color=amber, rotate=-2, tape=corner}\n\n# Title {use=hero}\n\nbody {use=hero}",
    );
    expect(doc.styles).toEqual({
      hero: { color: "amber", rotate: -2, tape: "corner" },
    });
    expect(doc.blocks[0].attrs).toEqual({
      use: "hero",
      color: "amber",
      rotate: -2,
      tape: "corner",
    });
    expect(doc.blocks[1].attrs.color).toBe("amber");
    expect(doc.diagnostics).toEqual([]);
  });

  it("lets an explicit attribute beat the style", () => {
    const doc = parse("::style hero {color=amber, rotate=-2}\n\n# T {use=hero, color=moss}");
    expect(doc.blocks[0].attrs).toMatchObject({ color: "moss", rotate: -2 });
  });

  it("applies several styles left to right", () => {
    const doc = parse(
      '::style a {color=amber, rotate=1}\n::style b {rotate=3}\n\n# T {use="a b"}',
    );
    expect(doc.blocks[0].attrs).toMatchObject({ color: "amber", rotate: 3 });
  });

  it("works on containers and inline spans", () => {
    const doc = parse(
      "::style tint {color=moss}\n\n::: sticky-note {use=tint}\nSome ==term=={use=tint} here\n:::",
    );
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.attrs.color).toBe("moss");
    const p = kindOf(c.children[0], "paragraph");
    const hl = p.content.find((n) => n.kind === "highlight");
    expect(hl?.attrs).toMatchObject({ color: "moss" });
  });

  it("expands a style that uses another style", () => {
    const doc = parse(
      "::style base {color=amber}\n::style loud {use=base, sticker=star}\n\n# T {use=loud}",
    );
    expect(doc.blocks[0].attrs).toMatchObject({ color: "amber", sticker: "star" });
  });

  it("validates the attrs inside a definition", () => {
    const doc = parse("::style hero {colour=ambr}\n\n# T {use=hero}");
    expect(doc.styles).toEqual({ hero: { color: "amber" } });
    expect(codes(doc)).toContain("attr-value-corrected");
  });

  it("reports an unknown style once, with the known names", () => {
    const doc = parse("::style hero {color=amber}\n\n# A {use=ghost}\n\n# B {use=ghost}");
    const d = find(doc, "style-unknown");
    expect(d.expected).toBe("hero");
    expect(codes(doc).filter((c) => c === "style-unknown")).toHaveLength(1);
  });

  it("breaks style cycles", () => {
    const doc = parse("::style a {use=b, color=amber}\n::style b {use=a, rotate=1}\n\n# T {use=a}");
    expect(codes(doc)).toContain("style-cycle");
  });

  it("warns about a nameless or attr-less definition", () => {
    const doc = parse("::style\n::style empty");
    expect(codes(doc)).toContain("style-missing-name");
    expect(codes(doc)).toContain("style-missing-attrs");
  });

  it("accepts the brace-less definition form", () => {
    const doc = parse("::style hero color=amber, rotate=2\n\n# T {use=hero}");
    expect(doc.blocks[0].attrs).toMatchObject({ color: "amber", rotate: 2 });
  });

  it("round-trips through the printer and stays idempotent", () => {
    const doc = parse("::style hero {color=amber, rotate=-2}\n\n# T {use=hero}\n");
    const printed = print(doc);
    expect(printed).toContain("::style hero {color=amber, rotate=-2}");
    const again = parse(printed);
    expect(again.styles).toEqual(doc.styles);
    expect(stripSpans(again.blocks)).toEqual(stripSpans(doc.blocks));
    expect(print(again)).toBe(printed);
  });

  it("resolves variables inside style values", () => {
    const doc = parse("::let tint = moss\n::style hero {color={{tint}}}\n\n# T {use=hero}");
    expect(doc.blocks[0].attrs.color).toBe("moss");
  });
});

// ---------------------------------------------------------------------------
// The spec's own example must be exemplary
// ---------------------------------------------------------------------------

describe("the v2 example from the AI-facing spec", () => {
  const EXAMPLE = [
    "---",
    "title: Cell Biology — Week 3",
    "paper: grid",
    "ink: sepia",
    "wash: amber",
    "---",
    "",
    "::let course = Cell Biology",
    "::let week = 3",
    "::style pinned {color=lemon, rotate=-2, tape=corner}",
    "",
    "# The Cell {sticker=microscope}",
    "",
    "{{course}} — week {{week}}. Cells are the ==basic unit of life=={color=amber}.",
    "",
    "::: sticky-note {use=pinned}",
    "Exam on **Friday!** Focus on mitochondria.",
    ":::",
    "",
    "```tree {style=watercolor}",
    "{{course}}",
    "  Membrane",
    "```",
  ].join("\n");

  it("parses without a single warning", () => {
    expect(parse(EXAMPLE).diagnostics).toEqual([]);
  });

  it("resolves everything it demonstrates", () => {
    const doc = parse(EXAMPLE);
    expect(doc.vars).toEqual({ course: "Cell Biology", week: "3" });
    expect(inlineText(kindOf(doc.blocks[1], "paragraph").content)).toContain(
      "Cell Biology — week 3.",
    );
    const sticky = kindOf(doc.blocks[2], "container") as ContainerBlock;
    expect(sticky.attrs).toMatchObject({ color: "lemon", rotate: -2, tape: "corner" });
    const tree = kindOf(doc.blocks[3], "diagram") as TreeDiagramBlock;
    expect(tree.roots[0].label).toBe("Cell Biology");
  });

  it("canonicalizes to itself after one round trip", () => {
    const once = print(parse(EXAMPLE));
    expect(print(parse(once))).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// 4. Adversarial input — v2 features must not break totality
// ---------------------------------------------------------------------------

describe("adversarial v2 input", () => {
  const NASTY = [
    "::let",
    "::style",
    ":::let a = {{a}}",
    "::let a = {{b}}",
    "::let b = {{a}}",
    "::: columns",
    "::: col",
    "```tree",
    "{{unclosed",
    "}}",
    "{{ }}",
    "# H {use={{a}}, color={{",
    "| a | b",
    "<Callout>",
    "::style x {use=y}",
    "::style y {use=x}",
  ].join("\n");

  it("survives a note built entirely from broken v2 syntax", () => {
    const doc = parse(NASTY);
    expect(Array.isArray(doc.blocks)).toBe(true);
    expect(doc.diagnostics.every((d) => d.severity === "warn")).toBe(true);
    expect(doc.diagnostics.every((d) => d.line >= 1 && d.column >= 1)).toBe(true);
    // printing garbage must not throw either (byte-stability is only
    // promised for documents the language can actually express)
    expect(typeof print(doc)).toBe("string");
  });

  it("unterminated fences around definitions still parse", () => {
    const doc = parse("::: card\n::let a = 1\n```graph\nA ->\n{{a}}");
    expect(doc.blocks[0].kind).toBe("container");
    expect(codes(doc)).toContain("container-unclosed");
    expect(codes(doc)).toContain("fence-unclosed");
  });

  it("a thousand references resolve without blowing the stack", () => {
    const doc = parse(`::let a = x\n\n${"{{a}} ".repeat(1000)}`);
    expect(doc.diagnostics).toEqual([]);
  });

  it("a long variable chain resolves", () => {
    const defs: string[] = ["::let v0 = end"];
    for (let i = 1; i < 200; i++) defs.push(`::let v${i} = {{v${i - 1}}}`);
    const doc = parse(`${defs.join("\n")}\n\n{{v199}}`);
    expect(doc.vars?.v199).toBe("end");
  });

  it("deeply nested directives keep their nesting", () => {
    const depth = 6;
    const src = [
      ...Array.from({ length: depth }, () => "::: card"),
      "deep",
      ...Array.from({ length: depth }, () => ":::"),
    ].join("\n");
    const doc = parse(src);
    let node = kindOf(doc.blocks[0], "container") as ContainerBlock;
    for (let d = 1; d < depth; d++) {
      node = kindOf(node.children[0], "container") as ContainerBlock;
    }
    expect(node.children[0].kind).toBe("paragraph");
    expect(doc.diagnostics).toEqual([]);
  });

  it("fuzz: v2 tokens in random order never throw and always locate", () => {
    const token = fc.constantFrom(
      "::let ",
      "::style ",
      ":::let",
      "{{",
      "}}",
      "{{a}}",
      "{use=hero}",
      "a = 1",
      "=",
      "{",
      "}",
      ":::",
      "```tree",
      "<div>",
      "---",
      "\n",
      "\r\n",
      " ",
      "text",
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 60 }), (tokens) => {
        const doc = parse(tokens.join(""));
        expect(Array.isArray(doc.blocks)).toBe(true);
        for (const d of doc.diagnostics) {
          expect(d.severity).toBe("warn");
          expect(d.line).toBeGreaterThanOrEqual(1);
          expect(d.column).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: docs with vars and styles round-trip through the printer", () => {
    const nameArb = fc.constantFrom("course", "week", "teacher", "hero", "tint");
    const valueArb = fc.constantFrom("Bio", "3", "Dr. Ito", "two words", "-2");
    const docArb: fc.Arbitrary<ScriptDoc> = fc
      .tuple(
        fc.dictionary(nameArb, valueArb, { maxKeys: 3 }),
        fc.dictionary(
          nameArb,
          fc.constantFrom<Record<string, string | number>>(
            { color: "amber" },
            { rotate: -2, tape: "corner" },
            { color: "moss", sticker: "star" },
          ),
          { maxKeys: 2 },
        ),
      )
      .map(([vars, styles]) => ({
        frontmatter: {},
        blocks: [
          {
            kind: "paragraph" as const,
            content: [{ kind: "text" as const, text: "body", srcStart: 0, srcEnd: 0 }],
            attrs: {},
            srcStart: 0,
            srcEnd: 0,
          },
        ],
        diagnostics: [],
        ...(Object.keys(vars).length > 0 ? { vars } : {}),
        ...(Object.keys(styles).length > 0 ? { styles } : {}),
      }));
    fc.assert(
      fc.property(docArb, (doc) => {
        const printed = print(doc);
        const reparsed = parse(printed);
        expect(reparsed.vars).toEqual(doc.vars);
        expect(reparsed.styles).toEqual(doc.styles);
        expect(print(reparsed)).toBe(printed);
      }),
      { numRuns: 100 },
    );
  });
});
