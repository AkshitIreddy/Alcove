/** The complete mini-example note from docs/design/script-language.md. */
export const MINI = [
  "---",
  "title: Cell Biology — Week 3",
  "paper: grid            # cream | grid | dotted | lined",
  "ink: sepia             # sepia | graphite | ink-blue",
  "wash: amber            # page-edge watercolor wash: amber | terracotta | moss | none",
  "---",
  "",
  "# The Cell {sticker=microscope}",
  "",
  "Cells are the ==basic unit of life=={color=amber}. Key terms: **organelle**, *cytoplasm*, ~~protoplasm~~ (outdated).",
  "",
  "::: sticky-note {color=lemon, rotate=-2}",
  "Exam on **Friday!** Focus on mitochondria.",
  ":::",
  "",
  "::: columns {gap=lg}",
  "::: col",
  "## Prokaryotes",
  "- No nucleus",
  "- Example: bacteria",
  ":::",
  "::: col",
  "## Eukaryotes {color=moss}",
  "- Nucleus present",
  "- Example: plants, animals",
  ":::",
  ":::",
  "",
  "::: image-row {style=polaroid, cols=3}",
  "fetch: fluffy kitten | caption=Study break :3",
  "fetch: sleepy kitten",
  "fetch: kitten in a box | rotate=3",
  ":::",
  "",
  "```tree {style=watercolor}",
  "Cell",
  "  Membrane",
  "  Cytoplasm",
  "    Organelles",
  "      Mitochondria | powerhouse",
  "      Ribosomes",
  "  Nucleus",
  "```",
  "",
  "```timeline",
  '1665: Hooke names the "cell"',
  "1838: Schleiden — plant cells",
  "1839: Schwann — animal cells | color=terracotta",
  "1855: Virchow — cells from cells",
  "```",
  "",
  '> "Omnis cellula e cellula" — Virchow {washi=top}',
].join("\n");

/** Recursively drop srcStart/srcEnd so ASTs can be compared modulo spans. */
export function stripSpans(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripSpans);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "srcStart" || k === "srcEnd") continue;
      out[k] = stripSpans(val);
    }
    return out;
  }
  return v;
}
