import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parse, print } from "../../src/script";
import type {
  Attrs,
  Block,
  ContainerBlock,
  Inline,
  ListItem,
  ScriptDoc,
  TextNode,
  TreeNode,
} from "../../src/script";
import {
  INK_COLORS,
  PAGE_WASHES,
  PAPER_STYLES,
  WASH_COLORS,
} from "../../src/script";
import { MINI, stripSpans } from "./fixtures";

// ---------------------------------------------------------------------------
// Document generator (over the public types).
//
// Text is drawn from a safe word pool: the printer escapes inline markup but
// the source syntax has no escaping for structural collisions inside labels,
// urls, and attr values (e.g. a literal `|` in a tree label), so the
// generator stays within what the language can faithfully express.
// ---------------------------------------------------------------------------

const span0 = { srcStart: 0, srcEnd: 0 };
const txt = (s: string): TextNode => ({ kind: "text", text: s, ...span0 });

const wordArb = fc.constantFrom(
  "cell",
  "notes",
  "alpha",
  "beta",
  "study",
  "week",
  "zoe",
  "amber42",
);
const textArb = fc
  .array(wordArb, { minLength: 1, maxLength: 4 })
  .map((ws) => ws.join(" "));

const attrsArb: fc.Arbitrary<Attrs> = fc.record(
  {
    rotate: fc.integer({ min: -3, max: 3 }),
    cols: fc.integer({ min: 1, max: 4 }),
    caption: textArb,
    color: fc.constantFrom(...WASH_COLORS),
    tape: fc.constantFrom("top", "corner", "both"),
  },
  { requiredKeys: [] },
);
const someAttrsArb = attrsArb.filter((a) => Object.keys(a).length > 0);
const optAttrsArb = fc.option(someAttrsArb, { nil: undefined });

const withAttrs = (attrs: Attrs | undefined): { attrs?: Attrs } =>
  attrs !== undefined ? { attrs } : {};

const markArb: fc.Arbitrary<Inline> = fc
  .tuple(
    fc.constantFrom(
      "strong" as const,
      "em" as const,
      "strike" as const,
      "highlight" as const,
      "sup" as const,
      "sub" as const,
    ),
    textArb,
    optAttrsArb,
  )
  .map(([kind, text, attrs]) => ({
    kind,
    children: [txt(text)],
    ...span0,
    ...withAttrs(attrs),
  }));

const codeArb: fc.Arbitrary<Inline> = fc
  .tuple(textArb, optAttrsArb)
  .map(([text, attrs]) => ({ kind: "code", text, ...span0, ...withAttrs(attrs) }));

const linkArb: fc.Arbitrary<Inline> = fc
  .tuple(textArb, wordArb, optAttrsArb)
  .map(([text, w, attrs]) => ({
    kind: "link",
    href: `https://example.com/${w}`,
    children: [txt(text)],
    ...span0,
    ...withAttrs(attrs),
  }));

/**
 * The three leaf spans, and every one of them is a round-trip hazard of its
 * own kind: a formula is opaque text between dollars, a footnote is text
 * inside brackets the printer pads, and a page reference is a name. Generating
 * them here is what pins `parse(print(doc)) === doc` for all three.
 */
const mathArb: fc.Arbitrary<Inline> = fc
  .tuple(
    fc.constantFrom(
      "x^2",
      "\\pi r^2",
      "a_i + b_i",
      "\\frac{1}{2}",
      "\\sqrt{n}",
      "e^{i\\pi}",
    ),
    optAttrsArb,
  )
  .map(([text, attrs]) => ({ kind: "math", text, ...span0, ...withAttrs(attrs) }));

const footnoteArb: fc.Arbitrary<Inline> = fc
  .tuple(textArb, optAttrsArb)
  .map(([text, attrs]) => ({
    kind: "footnote",
    text,
    ...span0,
    ...withAttrs(attrs),
  }));

const pagerefArb: fc.Arbitrary<Inline> = fc
  .tuple(textArb, optAttrsArb)
  .map(([label, attrs]) => ({
    kind: "pageref",
    label,
    ...span0,
    ...withAttrs(attrs),
  }));

const spanNodeArb = fc.oneof(
  markArb,
  codeArb,
  linkArb,
  mathArb,
  footnoteArb,
  pagerefArb,
);

/** Alternating text/span sequence — never two adjacent text nodes, and a
 *  text separator between spans (adjacent emphasis markers are ambiguous). */
const inlineContentArb: fc.Arbitrary<Inline[]> = fc.oneof(
  textArb.map((t) => [txt(t)]),
  fc
    .tuple(
      fc.option(textArb, { nil: undefined }),
      spanNodeArb,
      fc.array(fc.tuple(textArb, spanNodeArb), { maxLength: 2 }),
      fc.option(textArb, { nil: undefined }),
    )
    .map(([lead, first, mid, tail]) => {
      const out: Inline[] = [];
      if (lead !== undefined) out.push(txt(lead));
      out.push(first);
      for (const [t, s] of mid) {
        out.push(txt(t));
        out.push(s);
      }
      if (tail !== undefined) out.push(txt(tail));
      return out;
    }),
);

const headingArb: fc.Arbitrary<Block> = fc
  .tuple(fc.constantFrom(1 as const, 2 as const, 3 as const), inlineContentArb, attrsArb)
  .map(([level, content, attrs]) => ({ kind: "heading", level, content, attrs, ...span0 }));

const paragraphArb: fc.Arbitrary<Block> = fc
  .tuple(inlineContentArb, attrsArb)
  .map(([content, attrs]) => ({ kind: "paragraph", content, attrs, ...span0 }));

const quoteArb: fc.Arbitrary<Block> = fc
  .tuple(inlineContentArb, attrsArb)
  .map(([content, attrs]) => ({ kind: "quote", content, attrs, ...span0 }));

const dividerArb: fc.Arbitrary<Block> = attrsArb.map((attrs) => ({
  kind: "divider",
  attrs,
  ...span0,
}));

const leafItemArb: fc.Arbitrary<ListItem> = inlineContentArb.map((content) => ({
  content,
  children: [],
  ...span0,
}));

const itemArb: fc.Arbitrary<ListItem> = fc
  .tuple(inlineContentArb, fc.array(leafItemArb, { maxLength: 2 }))
  .map(([content, children]) => ({ content, children, ...span0 }));

const listArb: fc.Arbitrary<Block> = fc
  .tuple(fc.boolean(), fc.array(itemArb, { minLength: 1, maxLength: 3 }))
  .map(([ordered, items]) => ({ kind: "list", ordered, items, attrs: {}, ...span0 }));

const taskItemArb: fc.Arbitrary<ListItem> = fc
  .tuple(inlineContentArb, fc.boolean(), fc.array(leafItemArb, { maxLength: 1 }))
  .map(([content, checked, children]) => ({ content, checked, children, ...span0 }));

const taskListArb: fc.Arbitrary<Block> = fc
  .array(taskItemArb, { minLength: 1, maxLength: 3 })
  .map((items) => ({ kind: "taskList", items, attrs: {}, ...span0 }));

const cellsArb = fc.array(inlineContentArb, { minLength: 1, maxLength: 3 });
const rowOf = (cells: Inline[][]) => ({ cells, ...span0 });

const tableArb: fc.Arbitrary<Block> = fc.oneof(
  // headerless
  fc
    .tuple(fc.array(cellsArb, { minLength: 1, maxLength: 2 }), attrsArb)
    .map(([rows, attrs]) => ({
      kind: "table" as const,
      header: null,
      align: [],
      rows: rows.map(rowOf),
      attrs,
      ...span0,
    })),
  // header + align + rows
  cellsArb.chain((headerCells) =>
    fc
      .tuple(
        fc.array(
          fc.constantFrom<"left" | "center" | "right" | null>(
            "left",
            "center",
            "right",
            null,
          ),
          { minLength: headerCells.length, maxLength: headerCells.length },
        ),
        fc.array(cellsArb, { minLength: 1, maxLength: 2 }),
        attrsArb,
      )
      .map(([align, rows, attrs]) => ({
        kind: "table" as const,
        header: rowOf(headerCells),
        align,
        rows: rows.map(rowOf),
        attrs,
        ...span0,
      })),
  ),
);

const imageArb: fc.Arbitrary<Block> = fc
  .tuple(textArb, wordArb, attrsArb)
  .map(([alt, w, attrs]) => ({
    kind: "image",
    alt,
    src: `assets/${w}.png`,
    attrs,
    ...span0,
  }));

const mathBlockArb: fc.Arbitrary<Block> = fc
  .tuple(
    fc.constantFrom(
      "e^{i\\pi} + 1 = 0",
      "\\sum_{n=1}^{\\infty} \\frac{1}{n^2}",
      "a^2 + b^2 = c^2",
    ),
    attrsArb,
  )
  .map(([latex, attrs]) => ({ kind: "mathBlock", latex, attrs, ...span0 }));

const fetchArb: fc.Arbitrary<Block> = fc
  .tuple(textArb, attrsArb)
  .map(([query, attrs]) => ({ kind: "fetchDirective", query, attrs, ...span0 }));

/**
 * A code fence, with bodies chosen to be exactly what the parser used to
 * destroy: leading indentation, a blank line in the middle, inline markup that
 * is NOT markup here, a `{…}` first line that is not attrs, a `{{var}}` that
 * must not be substituted, and a nested fence that the printer has to widen
 * its marker past.
 */
const codeBlockArb: fc.Arbitrary<Block> = fc
  .tuple(
    fc.constantFrom(null, "python", "javascript", "json", "makefile"),
    fc.constantFrom(
      "def f(**kwargs):\n\n    return _private_",
      '{\n  "a": 1\n}',
      "const t = `${x}` // {{not a variable}}",
      "```js\nnested\n```",
      "a\n\n\nb",
      "\tstill\ttabs",
      "",
    ),
    attrsArb,
  )
  .map(([lang, code, attrs]) => ({
    kind: "code",
    lang,
    code,
    attrs,
    ...span0,
  }));

const simpleChildArb = fc.oneof(paragraphArb, headingArb, quoteArb, dividerArb, listArb);

const namedContainerArb: fc.Arbitrary<Block> = fc
  .tuple(
    fc.constantFrom(
      "sticky-note" as const,
      "polaroid" as const,
      "washi-box" as const,
      "callout" as const,
      "card" as const,
      "quote-card" as const,
      "spoiler" as const,
      "banner" as const,
      "toggle" as const,
    ),
    attrsArb,
    fc.array(simpleChildArb, { maxLength: 2 }),
  )
  .map(([name, attrs, children]) => ({ kind: "container", name, attrs, children, ...span0 }));

const columnsArb: fc.Arbitrary<Block> = fc
  .array(fc.array(paragraphArb, { minLength: 1, maxLength: 1 }), {
    minLength: 1,
    maxLength: 2,
  })
  .map((cols) => ({
    kind: "container" as const,
    name: "columns" as const,
    attrs: {},
    children: cols.map(
      (children): ContainerBlock => ({
        kind: "container",
        name: "col",
        attrs: {},
        children,
        ...span0,
      }),
    ),
    ...span0,
  }));

const imageRowArb: fc.Arbitrary<Block> = fc
  .tuple(attrsArb, fc.array(fc.oneof(fetchArb, imageArb), { minLength: 1, maxLength: 3 }))
  .map(([attrs, children]) => ({
    kind: "container" as const,
    name: "image-row" as const,
    attrs,
    children,
    ...span0,
  }));

const genericContainerArb: fc.Arbitrary<Block> = fc
  .tuple(
    fc.constantFrom("mystery", "zzzbox", "doodlepad"),
    fc.array(paragraphArb, { maxLength: 1 }),
  )
  .map(([rawName, children]) => ({
    kind: "container" as const,
    name: "generic" as const,
    rawName,
    attrs: {},
    children,
    ...span0,
  }));

const treeLeafArb: fc.Arbitrary<TreeNode> = fc
  .tuple(textArb, fc.option(textArb, { nil: undefined }), optAttrsArb)
  .map(([label, note, attrs]) => ({
    label,
    children: [],
    ...span0,
    ...(note !== undefined ? { note } : {}),
    ...withAttrs(attrs),
  }));

const treeNodeArb: fc.Arbitrary<TreeNode> = fc
  .tuple(textArb, fc.option(textArb, { nil: undefined }), optAttrsArb, fc.array(treeLeafArb, { maxLength: 2 }))
  .map(([label, note, attrs, children]) => ({
    label,
    children,
    ...span0,
    ...(note !== undefined ? { note } : {}),
    ...withAttrs(attrs),
  }));

const treeDiagramArb: fc.Arbitrary<Block> = fc
  .tuple(
    fc.constantFrom("tree" as const, "mindmap" as const),
    fc.array(treeNodeArb, { minLength: 1, maxLength: 2 }),
    attrsArb,
  )
  .map(([lang, roots, attrs]) => ({ kind: "diagram", lang, roots, attrs, ...span0 }));

const graphDiagramArb: fc.Arbitrary<Block> = fc
  .uniqueArray(fc.constantFrom("n1", "n2", "hub", "leafA", "leafB"), {
    minLength: 1,
    maxLength: 4,
  })
  .chain((ids) =>
    fc.tuple(
      fc.constant(ids),
      fc.array(fc.tuple(fc.option(textArb, { nil: undefined }), optAttrsArb), {
        minLength: ids.length,
        maxLength: ids.length,
      }),
      fc.array(
        fc.tuple(
          fc.constantFrom(...ids),
          fc.constantFrom(...ids),
          fc.option(textArb, { nil: undefined }),
        ),
        { maxLength: 3 },
      ),
      fc.constantFrom("graph" as const, "flowchart" as const),
      attrsArb,
    ),
  )
  .map(([ids, decor, edges, lang, attrs]) => ({
    kind: "diagram" as const,
    lang,
    graph: {
      nodes: ids.map((id, k) => ({
        id,
        ...span0,
        ...(decor[k][0] !== undefined ? { label: decor[k][0] } : {}),
        ...withAttrs(decor[k][1]),
      })),
      edges: edges.map(([from, to, label]) => ({
        from,
        to,
        ...span0,
        ...(label !== undefined ? { label } : {}),
      })),
    },
    attrs,
    ...span0,
  }));

const timelineArb: fc.Arbitrary<Block> = fc
  .tuple(
    fc.array(
      fc.tuple(
        fc.constantFrom("1665", "1838", "2001", "day1", "wk2"),
        textArb,
        optAttrsArb,
      ),
      { minLength: 1, maxLength: 3 },
    ),
    attrsArb,
  )
  .map(([entries, attrs]) => ({
    kind: "diagram" as const,
    lang: "timeline" as const,
    entries: entries.map(([label, text, eattrs]) => ({
      label,
      text,
      ...span0,
      ...withAttrs(eattrs),
    })),
    attrs,
    ...span0,
  }));

const topBlockArb: fc.Arbitrary<Block> = fc.oneof(
  headingArb,
  paragraphArb,
  quoteArb,
  dividerArb,
  listArb,
  taskListArb,
  tableArb,
  imageArb,
  mathBlockArb,
  codeBlockArb,
  fetchArb,
  namedContainerArb,
  columnsArb,
  imageRowArb,
  genericContainerArb,
  treeDiagramArb,
  graphDiagramArb,
  timelineArb,
);

const frontmatterArb = fc.record(
  {
    title: textArb,
    paper: fc.constantFrom(...PAPER_STYLES),
    ink: fc.constantFrom(...INK_COLORS),
    wash: fc.constantFrom(...PAGE_WASHES),
  },
  { requiredKeys: [] },
);

const docArb: fc.Arbitrary<ScriptDoc> = fc
  .tuple(frontmatterArb, fc.array(topBlockArb, { maxLength: 5 }))
  .map(([frontmatter, blocks]) => ({
    frontmatter: frontmatter as Record<string, string>,
    blocks,
    diagnostics: [],
  }));

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("printer round-trip invariant", () => {
  it("parse(print(doc)) deep-equals doc modulo spans/diagnostics", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const printed = print(doc);
        const reparsed = parse(printed);
        expect(stripSpans(reparsed.blocks)).toEqual(stripSpans(doc.blocks));
        expect(reparsed.frontmatter).toEqual(doc.frontmatter);
      }),
      { numRuns: 150 },
    );
  });

  it("printing is idempotent: print(parse(print(doc))) === print(doc)", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const once = print(doc);
        expect(print(parse(once))).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it("the mini-example stabilizes after one canonicalization", () => {
    const once = print(parse(MINI));
    expect(print(parse(once))).toBe(once);
    // and the canonical form still parses to the same AST
    expect(stripSpans(parse(once).blocks)).toEqual(stripSpans(parse(MINI).blocks));
    expect(parse(once).frontmatter).toEqual(parse(MINI).frontmatter);
  });
});

describe("canonical formatting", () => {
  it("orders attrs id, class, then alphabetical, with = and comma-space", () => {
    const doc = parse("# H {rotate=2; color:amber, .fancy #top}");
    expect(print(doc)).toBe("# H {id=top, class=fancy, color=amber, rotate=2}\n");
  });

  it("normalizes ':' assignment and bare fences to canonical form", () => {
    const doc = parse("::: note {color: lemon}\nhi\n:::");
    expect(print(doc)).toBe("::: sticky-note {color=lemon}\n\nhi\n\n:::\n");
  });

  it("prints 3-marker fences and 2-space indents for trees", () => {
    const doc = parse("````tree\nA\n\tB\n````");
    expect(print(doc)).toBe("```tree\nA\n  B\n```\n");
  });

  it("renumbers ordered lists canonically", () => {
    const doc = parse("7. a\n9) b");
    expect(print(doc)).toBe("1. a\n2. b\n");
  });

  it("quotes attr values with spaces, keeps bare ones bare", () => {
    const doc = parse('# H {caption="two words", color=amber}');
    expect(print(doc)).toBe('# H {caption="two words", color=amber}\n');
  });

  it("escapes paragraph text that would collide with block syntax", () => {
    const doc: ScriptDoc = {
      frontmatter: {},
      blocks: [
        {
          kind: "paragraph",
          content: [txt("- not a list")],
          attrs: {},
          ...span0,
        },
      ],
      diagnostics: [],
    };
    const printed = print(doc);
    const reparsed = parse(printed);
    expect(reparsed.blocks[0].kind).toBe("paragraph");
    expect(stripSpans(reparsed.blocks)).toEqual(stripSpans(doc.blocks));
  });

  it("prints frontmatter with title first", () => {
    const doc = parse("---\nwash: moss\ntitle: My Note\npaper: grid\n---\n\nhi");
    expect(print(doc)).toBe(
      "---\ntitle: My Note\npaper: grid\nwash: moss\n---\n\nhi\n",
    );
  });
});
