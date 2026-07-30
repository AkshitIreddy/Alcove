import { describe, expect, it } from "vitest";
import { parse } from "../../src/script";
import type {
  Block,
  ContainerBlock,
  GraphDiagramBlock,
  HeadingBlock,
  Inline,
  ListBlock,
  ParagraphBlock,
  TimelineDiagramBlock,
  TreeDiagramBlock,
} from "../../src/script";

import { MINI } from "./fixtures";

function kindOf<K extends Block["kind"]>(
  block: Block,
  kind: K,
): Extract<Block, { kind: K }> {
  expect(block.kind).toBe(kind);
  return block as Extract<Block, { kind: K }>;
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

describe("mini-example golden parse", () => {
  const doc = parse(MINI);

  it("parses without a single warning", () => {
    expect(doc.diagnostics).toEqual([]);
  });

  it("reads flat frontmatter with inline comments stripped", () => {
    expect(doc.frontmatter).toEqual({
      title: "Cell Biology — Week 3",
      paper: "grid",
      ink: "sepia",
      wash: "amber",
    });
  });

  it("produces the expected block sequence", () => {
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "container",
      "container",
      "container",
      "diagram",
      "diagram",
      "quote",
    ]);
  });

  it("heading: level, text, sticker attr", () => {
    const h = kindOf(doc.blocks[0], "heading");
    expect(h.level).toBe(1);
    expect(inlineText(h.content)).toBe("The Cell");
    expect(h.attrs).toEqual({ sticker: "microscope" });
  });

  it("paragraph: highlight span attrs, strong, em, strike", () => {
    const p = kindOf(doc.blocks[1], "paragraph");
    const hl = p.content.find((n) => n.kind === "highlight");
    expect(hl).toBeDefined();
    expect(inlineText([hl as Inline])).toBe("basic unit of life");
    expect(hl?.attrs).toEqual({ color: "amber" });
    expect(p.content.some((n) => n.kind === "strong")).toBe(true);
    expect(p.content.some((n) => n.kind === "em")).toBe(true);
    expect(p.content.some((n) => n.kind === "strike")).toBe(true);
    expect(inlineText(p.content)).toContain("(outdated).");
  });

  it("sticky-note container with attrs and inner paragraph", () => {
    const c = kindOf(doc.blocks[2], "container") as ContainerBlock;
    expect(c.name).toBe("sticky-note");
    expect(c.attrs).toEqual({ color: "lemon", rotate: -2 });
    expect(c.children).toHaveLength(1);
    const p = kindOf(c.children[0], "paragraph") as ParagraphBlock;
    const strong = p.content.find((n) => n.kind === "strong");
    expect(inlineText([strong as Inline])).toBe("Friday!");
  });

  it("columns nest two col containers", () => {
    const cols = kindOf(doc.blocks[3], "container") as ContainerBlock;
    expect(cols.name).toBe("columns");
    expect(cols.attrs).toEqual({ gap: "lg" });
    expect(cols.children.map((b) => b.kind)).toEqual(["container", "container"]);
    const col1 = cols.children[0] as ContainerBlock;
    expect(col1.name).toBe("col");
    const h = kindOf(col1.children[0], "heading") as HeadingBlock;
    expect(h.level).toBe(2);
    expect(inlineText(h.content)).toBe("Prokaryotes");
    const list = kindOf(col1.children[1], "list") as ListBlock;
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(2);
    expect(inlineText(list.items[1].content)).toBe("Example: bacteria");
    const col2 = cols.children[1] as ContainerBlock;
    const h2 = kindOf(col2.children[0], "heading") as HeadingBlock;
    expect(h2.attrs).toEqual({ color: "moss" });
  });

  it("image-row holds three fetch directives with pipe attrs", () => {
    const row = kindOf(doc.blocks[4], "container") as ContainerBlock;
    expect(row.name).toBe("image-row");
    expect(row.attrs).toEqual({ style: "polaroid", cols: 3 });
    const kinds = row.children.map((b) => b.kind);
    expect(kinds).toEqual(["fetchDirective", "fetchDirective", "fetchDirective"]);
    const f1 = kindOf(row.children[0], "fetchDirective");
    expect(f1.query).toBe("fluffy kitten");
    expect(f1.attrs).toEqual({ caption: "Study break :3" });
    const f2 = kindOf(row.children[1], "fetchDirective");
    expect(f2.query).toBe("sleepy kitten");
    expect(f2.attrs).toEqual({});
    const f3 = kindOf(row.children[2], "fetchDirective");
    expect(f3.query).toBe("kitten in a box");
    expect(f3.attrs).toEqual({ rotate: 3 });
  });

  it("tree diagram: nesting, note annotation, fence attrs", () => {
    const d = kindOf(doc.blocks[5], "diagram") as TreeDiagramBlock;
    expect(d.lang).toBe("tree");
    expect(d.attrs).toEqual({ style: "watercolor" });
    expect(d.roots).toHaveLength(1);
    const cell = d.roots[0];
    expect(cell.label).toBe("Cell");
    expect(cell.children.map((n) => n.label)).toEqual([
      "Membrane",
      "Cytoplasm",
      "Nucleus",
    ]);
    const cytoplasm = cell.children[1];
    expect(cytoplasm.children[0].label).toBe("Organelles");
    const organelles = cytoplasm.children[0];
    expect(organelles.children.map((n) => n.label)).toEqual([
      "Mitochondria",
      "Ribosomes",
    ]);
    expect(organelles.children[0].note).toBe("powerhouse");
  });

  it("timeline: four entries, per-entry attrs", () => {
    const d = kindOf(doc.blocks[6], "diagram") as TimelineDiagramBlock;
    expect(d.lang).toBe("timeline");
    expect(d.entries.map((e) => e.label)).toEqual([
      "1665",
      "1838",
      "1839",
      "1855",
    ]);
    expect(d.entries[0].text).toBe('Hooke names the "cell"');
    expect(d.entries[2].attrs).toEqual({ color: "terracotta" });
    expect(d.entries[3].attrs).toBeUndefined();
  });

  it("quote with washi attr", () => {
    const q = kindOf(doc.blocks[7], "quote");
    expect(q.attrs).toEqual({ washi: "top" });
    expect(inlineText(q.content)).toBe('"Omnis cellula e cellula" — Virchow');
  });

  it("every block carries sane source spans", () => {
    for (const b of doc.blocks) {
      expect(b.srcStart).toBeGreaterThanOrEqual(0);
      expect(b.srcEnd).toBeGreaterThan(b.srcStart);
      expect(b.srcEnd).toBeLessThanOrEqual(MINI.length);
    }
    const h = doc.blocks[0];
    expect(MINI.slice(h.srcStart, h.srcEnd)).toBe(
      "# The Cell {sticker=microscope}",
    );
  });
});

describe("individual features", () => {
  it("task lists: checked state per item", () => {
    const doc = parse("- [ ] open task\n- [x] done task");
    const t = kindOf(doc.blocks[0], "taskList");
    expect(t.items.map((i) => i.checked)).toEqual([false, true]);
    expect(inlineText(t.items[0].content)).toBe("open task");
  });

  it("ordered lists", () => {
    const doc = parse("1. first\n2. second\n3. third");
    const l = kindOf(doc.blocks[0], "list") as ListBlock;
    expect(l.ordered).toBe(true);
    expect(l.items).toHaveLength(3);
  });

  it("nested lists via 2-space indent", () => {
    const doc = parse("- a\n  - b\n    - c\n- d");
    const l = kindOf(doc.blocks[0], "list") as ListBlock;
    expect(l.items).toHaveLength(2);
    expect(l.items[0].children).toHaveLength(1);
    expect(l.items[0].children[0].children).toHaveLength(1);
    expect(inlineText(l.items[0].children[0].children[0].content)).toBe("c");
  });

  it("tables: header, alignment, data rows", () => {
    const doc = parse("| a | b |\n| :--- | ---: |\n| 1 | 2 |");
    const t = kindOf(doc.blocks[0], "table");
    expect(t.header).not.toBeNull();
    expect(t.header?.cells.map((c) => inlineText(c))).toEqual(["a", "b"]);
    expect(t.align).toEqual(["left", "right"]);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].cells.map((c) => inlineText(c))).toEqual(["1", "2"]);
  });

  it("tables without a header row", () => {
    const doc = parse("| x | y |");
    const t = kindOf(doc.blocks[0], "table");
    expect(t.header).toBeNull();
    expect(t.align).toEqual([]);
    expect(t.rows).toHaveLength(1);
  });

  it("images with attrs", () => {
    const doc = parse("![a cat](cats/1.png){rotate=2}");
    const img = kindOf(doc.blocks[0], "image");
    expect(img.alt).toBe("a cat");
    expect(img.src).toBe("cats/1.png");
    expect(img.attrs).toEqual({ rotate: 2 });
  });

  it("standalone ::fetch leaf directive", () => {
    const doc = parse('::fetch{query="kitten", count=3, style=polaroid}');
    const f = kindOf(doc.blocks[0], "fetchDirective");
    expect(f.query).toBe("kitten");
    expect(f.attrs).toEqual({ count: 3, style: "polaroid" });
  });

  it("callout shorthand ::: tip", () => {
    const doc = parse("::: tip\nDrink water.\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.name).toBe("callout");
    expect(c.attrs.variant).toBe("tip");
  });

  it("explicit callout variant attr", () => {
    const doc = parse("::: callout {variant=warn}\nCareful.\n:::");
    const c = kindOf(doc.blocks[0], "container") as ContainerBlock;
    expect(c.attrs.variant).toBe("warn");
  });

  it("dividers, also with attrs", () => {
    const doc = parse("above\n\n---\n\nbelow\n\n--- {color=amber}");
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      "paragraph",
      "divider",
      "paragraph",
      "divider",
    ]);
    expect(doc.blocks[3].attrs).toEqual({ color: "amber" });
  });

  it("sup, sub, link, code inline", () => {
    const doc = parse("x^2^ and H~2~O and [docs](https://ex.com) and `let x`");
    const p = kindOf(doc.blocks[0], "paragraph");
    const kinds = p.content.map((n) => n.kind);
    expect(kinds).toContain("sup");
    expect(kinds).toContain("sub");
    expect(kinds).toContain("link");
    expect(kinds).toContain("code");
    const link = p.content.find((n) => n.kind === "link");
    expect(link !== undefined && link.kind === "link" && link.href).toBe(
      "https://ex.com",
    );
  });

  it("multi-line paragraphs join with a single space", () => {
    const doc = parse("first line\nsecond line");
    const p = kindOf(doc.blocks[0], "paragraph");
    expect(inlineText(p.content)).toBe("first line second line");
  });

  it("multi-line quotes join into one quote", () => {
    const doc = parse("> line one\n> line two");
    expect(doc.blocks).toHaveLength(1);
    const q = kindOf(doc.blocks[0], "quote");
    expect(inlineText(q.content)).toBe("line one line two");
  });

  it("graph diagram: chains, fan-out, labels, decorations", () => {
    const doc = parse(
      [
        "```graph",
        "Sun -> Photosynthesis: light",
        "Water -> Photosynthesis",
        "Photosynthesis -> Glucose, Oxygen",
        "Glucose {color=amber}",
        "```",
      ].join("\n"),
    );
    const g = kindOf(doc.blocks[0], "diagram") as GraphDiagramBlock;
    expect(g.lang).toBe("graph");
    expect(g.graph.nodes.map((n) => n.id)).toEqual([
      "Sun",
      "Photosynthesis",
      "Water",
      "Glucose",
      "Oxygen",
    ]);
    expect(g.graph.edges).toHaveLength(4);
    expect(g.graph.edges[0]).toMatchObject({
      from: "Sun",
      to: "Photosynthesis",
      label: "light",
    });
    const glucose = g.graph.nodes.find((n) => n.id === "Glucose");
    expect(glucose?.attrs).toEqual({ color: "amber" });
    expect(doc.diagnostics).toEqual([]);
  });

  it("mindmap shares the tree grammar", () => {
    const doc = parse("```mindmap\nTopic\n  Branch\n```");
    const d = kindOf(doc.blocks[0], "diagram") as TreeDiagramBlock;
    expect(d.lang).toBe("mindmap");
    expect(d.roots[0].children[0].label).toBe("Branch");
  });

  it("image: lines inside an image-row become image blocks", () => {
    const doc = parse(
      "::: image-row\nimage: cache/kitten.png | caption=hi, alt=a kitten\n:::",
    );
    const row = kindOf(doc.blocks[0], "container") as ContainerBlock;
    const img = kindOf(row.children[0], "image");
    expect(img.src).toBe("cache/kitten.png");
    expect(img.alt).toBe("a kitten");
    expect(img.attrs).toEqual({ caption: "hi" });
  });

  it("comments and blank lines are skipped inside diagram fences", () => {
    const doc = parse(
      "```tree\n// a comment\nRoot\n\n# also a comment\n  Child\n```",
    );
    const d = kindOf(doc.blocks[0], "diagram") as TreeDiagramBlock;
    expect(d.roots).toHaveLength(1);
    expect(d.roots[0].children.map((n) => n.label)).toEqual(["Child"]);
  });

  it("id and class shorthands", () => {
    const doc = parse("# Title {#intro .fancy .wide}");
    const h = kindOf(doc.blocks[0], "heading");
    expect(h.attrs).toEqual({ id: "intro", class: "fancy wide" });
  });

  it("frontmatter is only recognized at the top", () => {
    const doc = parse("some text\n\n---\ntitle: nope\n---");
    expect(doc.frontmatter).toEqual({});
    expect(doc.blocks[0].kind).toBe("paragraph");
  });
});
