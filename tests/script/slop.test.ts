/**
 * Slop corpus: deliberately broken inputs, each asserting a specific
 * recovery. parse() must be total — any input yields a doc + warnings,
 * never an exception, never an 'error' severity.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parse } from "../../src/script";
import type {
  Block,
  ContainerBlock,
  GraphDiagramBlock,
  ScriptDoc,
  TimelineDiagramBlock,
  TreeDiagramBlock,
} from "../../src/script";
import { MINI, stripSpans } from "./fixtures";

function kindOf<K extends Block["kind"]>(
  block: Block,
  kind: K,
): Extract<Block, { kind: K }> {
  expect(block.kind).toBe(kind);
  return block as Extract<Block, { kind: K }>;
}

function warned(doc: ScriptDoc, re: RegExp): boolean {
  return doc.diagnostics.some((d) => re.test(d.message));
}

describe("slop corpus — fences", () => {
  it("1. unclosed ::: container auto-closes at EOF", () => {
    const doc = parse("::: sticky-note\nStill works.");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.name).toBe("sticky-note");
    expect(c.children).toHaveLength(1);
    expect(warned(doc, /never closed/)).toBe(true);
  });

  it("2. unclosed ``` fence swallows the rest, with a warning", () => {
    const doc = parse("```tree\nRoot\n  Child");
    const d = kindOf(doc.blocks[0], "diagram") as TreeDiagramBlock;
    expect(d.roots[0].children[0].label).toBe("Child");
    expect(warned(doc, /never closed/)).toBe(true);
  });

  it("3. two-colon close still closes a container", () => {
    const doc = parse("::: card\nHi\n::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.children).toHaveLength(1);
    expect(doc.diagnostics).toEqual([]);
  });

  it("4. stray ::: closing nothing is ignored with a warning", () => {
    const doc = parse(":::");
    expect(doc.blocks).toEqual([]);
    expect(warned(doc, /closes nothing/)).toBe(true);
  });

  it("5. nested containers all auto-close at EOF", () => {
    const doc = parse("::: columns\n::: col\ntrapped text");
    const cols = kindOf(doc.blocks[0], "container") as ContainerBlock;
    const col = kindOf(cols.children[0], "container") as ContainerBlock;
    expect(col.children[0].kind).toBe("paragraph");
    expect(doc.diagnostics.filter((d) => /never closed/.test(d.message))).toHaveLength(2);
  });

  it("6. 4+ fence markers open, 2+ close", () => {
    const doc = parse("::::: banner\nBig news\n::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.name).toBe("banner");
    expect(doc.diagnostics).toEqual([]);
  });

  it("7. attrs on the first line inside the fence", () => {
    const doc = parse("::: sticky-note\n{color=lemon}\nText\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.attrs).toEqual({ color: "lemon" });
    expect(c.children).toHaveLength(1);
  });

  it("8. attrs on fence line AND first line inside merge", () => {
    const doc = parse("::: card {color=amber}\n{rotate=2}\nHi\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.attrs).toEqual({ color: "amber", rotate: 2 });
  });

  it("9. unclosed { on a container fence line still yields attrs", () => {
    const doc = parse("::: sticky-note {color=lemon\nHi\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.attrs).toEqual({ color: "lemon" });
    expect(warned(doc, /not closed/)).toBe(true);
  });

  it("10. a language fence is CODE, verbatim, and warns about nothing", () => {
    const doc = parse("```python\ndef f():\n\n    return {'a': 1}\n```");
    const c = kindOf(doc.blocks[0], "code");
    expect(c.lang).toBe("python");
    // The blank line, the four spaces and the braces all survive. Each one of
    // them used to be destroyed by a different pass — see CodeBlock in
    // src/script/types.ts.
    expect(c.code).toBe("def f():\n\n    return {'a': 1}");
    expect(doc.diagnostics).toEqual([]);
  });

  it("10b. an unknown language is still code, and says so once", () => {
    const doc = parse("```wobblescript\nblah\n```");
    const c = kindOf(doc.blocks[0], "code");
    expect(c.lang).toBeNull();
    expect(c.rawLang).toBe("wobblescript");
    expect(c.code).toBe("blah");
    expect(warned(doc, /unknown fence language/)).toBe(true);
  });

  it("11. bare ``` fence with no language is plain code, unwarned", () => {
    const doc = parse("```\nsome text\n```");
    const c = kindOf(doc.blocks[0], "code");
    expect(c.lang).toBeNull();
    expect(c.rawLang).toBeUndefined();
    expect(c.code).toBe("some text");
    // Nothing was misspelt — a fence with no language on it is a normal thing
    // to write, and it used to be warned about every single time.
    expect(doc.diagnostics).toEqual([]);
  });

  it("11b. ```json keeps a leading `{` line instead of eating it as attrs", () => {
    const doc = parse('```json\n{\n  "a": 1\n}\n```');
    const c = kindOf(doc.blocks[0], "code");
    expect(c.code).toBe('{\n  "a": 1\n}');
    expect(c.attrs).toEqual({});
  });

  it("11c. a wide fence survives a body that contains ```", () => {
    const doc = parse("````markdown\n```js\nx\n```\n````");
    const c = kindOf(doc.blocks[0], "code");
    expect(c.lang).toBe("markdown");
    expect(c.code).toBe("```js\nx\n```");
  });
});

describe("slop corpus — attrs", () => {
  it("12. ':' works as assignment", () => {
    const doc = parse("# H {color: amber}");
    expect(doc.blocks[0].attrs).toEqual({ color: "amber" });
    expect(doc.diagnostics).toEqual([]);
  });

  it("13. misspelled color 'ambr' fuzzy-corrects to amber", () => {
    const doc = parse("# H {color=ambr}");
    expect(doc.blocks[0].attrs).toEqual({ color: "amber" });
    expect(warned(doc, /ambr.*amber/)).toBe(true);
  });

  it("14. misspelled 'terracota' corrects to terracotta", () => {
    const doc = parse("# H {color=terracota}");
    expect(doc.blocks[0].attrs).toEqual({ color: "terracotta" });
    expect(warned(doc, /terracota/)).toBe(true);
  });

  it("15. hopelessly unknown enum value is kept, with a warning", () => {
    const doc = parse("# H {color=chartreuse}");
    expect(doc.blocks[0].attrs).toEqual({ color: "chartreuse" });
    expect(warned(doc, /chartreuse.*kept/)).toBe(true);
  });

  it("16. unknown attr key is kept and warned", () => {
    const doc = parse("# H {wobble=3}");
    expect(doc.blocks[0].attrs).toEqual({ wobble: 3 });
    expect(warned(doc, /wobble/)).toBe(true);
  });

  it("17. misspelled key 'colr' pulls toward 'color'", () => {
    const doc = parse("# H {colr=amber}");
    expect(doc.blocks[0].attrs).toEqual({ color: "amber" });
    expect(warned(doc, /colr.*color/)).toBe(true);
  });

  it("18. British 'colour' + misspelled value both normalize", () => {
    const doc = parse("# H {colour=ambr}");
    expect(doc.blocks[0].attrs).toEqual({ color: "amber" });
  });

  it("19. trailing commas are fine", () => {
    const doc = parse("# H {color=amber,}");
    expect(doc.blocks[0].attrs).toEqual({ color: "amber" });
    expect(doc.diagnostics).toEqual([]);
  });

  it("20. semicolon and space separators both work", () => {
    const a = parse("# H {color=amber; rotate=2}");
    const b = parse("# H {color=amber rotate=2}");
    expect(a.blocks[0].attrs).toEqual({ color: "amber", rotate: 2 });
    expect(b.blocks[0].attrs).toEqual({ color: "amber", rotate: 2 });
  });

  it("21. unclosed quote inside attrs recovers", () => {
    const doc = parse('# H {caption="oops}');
    expect(doc.blocks[0].attrs).toEqual({ caption: "oops" });
    expect(warned(doc, /unclosed quote/)).toBe(true);
  });

  it("22. bare attrs after a container name, no braces at all", () => {
    const doc = parse("::: sticky-note color=lemon rotate=-2\nHi\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.attrs).toEqual({ color: "lemon", rotate: -2 });
  });
});

describe("slop corpus — names", () => {
  it("23. 'Sticky Note' and 'stickynote' and 'note' all resolve", () => {
    for (const name of ["Sticky Note", "stickynote", "note", "sticky_note"]) {
      const doc = parse(`::: ${name}\nHi\n:::`);
      const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
      expect(c.name).toBe("sticky-note");
    }
  });

  it("24. unknown container renders as a generic box, never an error", () => {
    const doc = parse("::: wobbly-box {color=amber}\nHello\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.name).toBe("generic");
    expect(c.rawName).toBe("wobbly-box");
    expect(c.attrs).toEqual({ color: "amber" });
    expect(c.children).toHaveLength(1);
    expect(warned(doc, /plain box/)).toBe(true);
  });

  it("25. ::: tip shorthand becomes a callout variant", () => {
    const doc = parse(":::tip\nHydrate.\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.name).toBe("callout");
    expect(c.attrs.variant).toBe("tip");
  });

  it("26. '::shrug::' in prose stays a paragraph", () => {
    const doc = parse("::shrug:: whatever");
    const p = kindOf(doc.blocks[0], "paragraph");
    expect(p.content[0]).toMatchObject({ kind: "text", text: "::shrug:: whatever" });
  });

  it("27. misspelled diagram language fuzzy-matches", () => {
    const doc = parse("```timelien\n1900: stuff\n```");
    const d = kindOf(doc.blocks[0], "diagram") as TimelineDiagramBlock;
    expect(d.lang).toBe("timeline");
    expect(warned(doc, /timelien/)).toBe(true);
  });
});

describe("slop corpus — Mermaid compatibility ramp", () => {
  it("28. --> and ==> and → arrows all parse", () => {
    const doc = parse("```graph\nA -> B\nB --> C\nC ==> D\nD → E\n```");
    const g = kindOf(doc.blocks[0], "diagram") as GraphDiagramBlock;
    expect(g.graph.edges).toHaveLength(4);
    expect(g.graph.nodes.map((n) => n.id)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("29. 'graph TD' header line is ignored with a warning", () => {
    const doc = parse("```graph\ngraph TD\nA -> B\n```");
    const g = kindOf(doc.blocks[0], "diagram") as GraphDiagramBlock;
    expect(g.graph.edges).toHaveLength(1);
    expect(warned(doc, /Mermaid-style header/)).toBe(true);
  });

  it("30. a full ```mermaid fence parses via the graph grammar", () => {
    const doc = parse("```mermaid\nflowchart LR\nA --> B\n```");
    const g = kindOf(doc.blocks[0], "diagram") as GraphDiagramBlock;
    expect(g.lang).toBe("flowchart");
    expect(g.graph.edges).toEqual([
      expect.objectContaining({ from: "A", to: "B" }),
    ]);
    expect(warned(doc, /Mermaid fence/)).toBe(true);
  });

  it("31. Mermaid [bracket] node labels are accepted with a warning", () => {
    const doc = parse("```graph\nA[Start] --> B[End]\n```");
    const g = kindOf(doc.blocks[0], "diagram") as GraphDiagramBlock;
    expect(g.graph.nodes[0]).toMatchObject({ id: "A", label: "Start" });
    expect(g.graph.nodes[1]).toMatchObject({ id: "B", label: "End" });
    expect(warned(doc, /Mermaid-style node label/)).toBe(true);
  });

  it("32. Mermaid |edge label| syntax is accepted", () => {
    const doc = parse("```graph\nA -->|light| B\n```");
    const g = kindOf(doc.blocks[0], "diagram") as GraphDiagramBlock;
    expect(g.graph.edges[0]).toMatchObject({ from: "A", to: "B", label: "light" });
  });

  it("33. trailing semicolons and %% comments are tolerated", () => {
    const doc = parse("```graph\n%% a comment\nA -> B;\n```");
    const g = kindOf(doc.blocks[0], "diagram") as GraphDiagramBlock;
    expect(g.graph.edges).toHaveLength(1);
    expect(g.graph.nodes.map((n) => n.id)).toEqual(["A", "B"]);
  });
});

describe("slop corpus — structure", () => {
  it("34. #### and deeper clamp to ###", () => {
    const doc = parse("#### deep heading");
    const h = kindOf(doc.blocks[0], "heading");
    expect(h.level).toBe(3);
    expect(warned(doc, /###/)).toBe(true);
  });

  it("35. unclosed ** degrades to literal text with a warning", () => {
    const doc = parse("not **closed");
    const p = kindOf(doc.blocks[0], "paragraph");
    expect(p.content).toHaveLength(1);
    expect(p.content[0]).toMatchObject({ kind: "text", text: "not **closed" });
    expect(warned(doc, /unclosed '\*\*'/)).toBe(true);
  });

  it("36. unclosed == likewise", () => {
    const doc = parse("==half a highlight");
    const p = kindOf(doc.blocks[0], "paragraph");
    expect(p.content[0]).toMatchObject({ kind: "text", text: "==half a highlight" });
  });

  it("37. mixed plain/task bullets split into two blocks", () => {
    const doc = parse("- plain\n- [ ] task");
    expect(doc.blocks.map((b) => b.kind)).toEqual(["list", "taskList"]);
  });

  it("38. timeline entry without a colon keeps the text", () => {
    const doc = parse("```timeline\njust some text\n```");
    const d = kindOf(doc.blocks[0], "diagram") as TimelineDiagramBlock;
    expect(d.entries[0]).toMatchObject({ label: "", text: "just some text" });
    expect(warned(doc, /no 'label:'/)).toBe(true);
  });

  it("39. extra table alignment rows are dropped with a warning", () => {
    const doc = parse("| a |\n| --- |\n| b |\n| --- |");
    const t = kindOf(doc.blocks[0], "table");
    expect(t.rows).toHaveLength(1);
    expect(warned(doc, /alignment row/)).toBe(true);
  });

  it("40. frontmatter value typo 'gird' corrects to grid", () => {
    const doc = parse("---\npaper: gird\n---\n\nhello");
    expect(doc.frontmatter.paper).toBe("grid");
    expect(warned(doc, /gird/)).toBe(true);
  });

  it("41. frontmatter key typo 'papper' corrects to paper", () => {
    const doc = parse("---\npapper: grid\n---\n\nhello");
    expect(doc.frontmatter.paper).toBe("grid");
    expect(warned(doc, /papper/)).toBe(true);
  });

  it("42. ::fetch with no query still parses, with a warning", () => {
    const doc = parse("::fetch{count=2}");
    const f = kindOf(doc.blocks[0], "fetchDirective");
    expect(f.query).toBe("");
    expect(f.attrs).toEqual({ count: 2 });
    expect(warned(doc, /no query/)).toBe(true);
  });

  it("43. fetch: outside an image-row is ordinary prose", () => {
    const doc = parse("fetch: not a directive here");
    expect(doc.blocks[0].kind).toBe("paragraph");
  });

  it("44. tabs work as tree indentation", () => {
    const doc = parse("```tree\nRoot\n\tChild\n\t\tGrandchild\n```");
    const d = kindOf(doc.blocks[0], "diagram") as TreeDiagramBlock;
    expect(d.roots[0].children[0].children[0].label).toBe("Grandchild");
  });

  it("45. empty and whitespace-only inputs give empty docs", () => {
    expect(parse("")).toEqual({ frontmatter: {}, blocks: [], diagnostics: [] });
    expect(parse("   \n \n\t\n").blocks).toEqual([]);
  });
});

describe("line endings — Windows first", () => {
  it("CRLF parses identically to LF (modulo spans)", () => {
    const lf = parse(MINI);
    const crlf = parse(MINI.replace(/\n/g, "\r\n"));
    expect(stripSpans(crlf.blocks)).toEqual(stripSpans(lf.blocks));
    expect(crlf.frontmatter).toEqual(lf.frontmatter);
    expect(crlf.diagnostics).toHaveLength(lf.diagnostics.length);
  });

  it("lone CR (classic Mac) also parses identically", () => {
    const lf = parse(MINI);
    const cr = parse(MINI.replace(/\n/g, "\r"));
    expect(stripSpans(cr.blocks)).toEqual(stripSpans(lf.blocks));
    expect(cr.frontmatter).toEqual(lf.frontmatter);
  });

  it("mixed line endings in one document survive", () => {
    const doc = parse("# One\r\n\r\ntwo\nthree\r- four");
    expect(doc.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list"]);
  });
});

describe("parser totality (fuzz)", () => {
  it("random unicode soup never throws and always yields a doc", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.integer({ min: 0, max: 0x10ffff }), { maxLength: 300 })
          .map((cps) => cps.map((c) => String.fromCodePoint(c)).join("")),
        (src) => {
          const doc = parse(src);
          expect(Array.isArray(doc.blocks)).toBe(true);
          expect(doc.diagnostics.every((d) => d.severity === "warn")).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("adversarial syntax-token soup never throws", () => {
    const token = fc.constantFrom(
      ":::",
      "::",
      "```",
      "````",
      "{",
      "}",
      "**",
      "==",
      "~~",
      "^",
      "|",
      "->",
      "-->",
      "- [ ] ",
      "# ",
      "> ",
      "---",
      "![a](b)",
      "::fetch{",
      "fetch:",
      "image:",
      "text",
      "=",
      ":",
      ",",
      "\\",
      "\n",
      "\r\n",
      "\r",
      "\t",
      " ",
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 60 }), (tokens) => {
        const doc = parse(tokens.join(""));
        expect(Array.isArray(doc.blocks)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
