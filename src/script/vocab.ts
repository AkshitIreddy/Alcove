/**
 * Notebook Script — shared vocabulary tables.
 *
 * Single source of truth for palettes, effects, container names and aliases.
 * The attr parser fuzzy-matches enum values against these tables
 * (Levenshtein ≤ 2, within the same value domain only).
 */

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

/** The 7 wash colors usable in `{color=…}` and friends. */
export const WASH_COLORS = [
  "amber",
  "terracotta",
  "moss",
  "lemon",
  "sky",
  "blush",
  "graphite",
] as const;

export type WashColor = (typeof WASH_COLORS)[number];

/** Page paper styles (frontmatter `paper:`). */
export const PAPER_STYLES = ["cream", "grid", "dotted", "lined"] as const;

/** Page ink colors (frontmatter `ink:`). */
export const INK_COLORS = ["sepia", "graphite", "ink-blue"] as const;

/** Page-edge watercolor wash (frontmatter `wash:`). */
export const PAGE_WASHES = ["amber", "terracotta", "moss", "none"] as const;

// ---------------------------------------------------------------------------
// Effects (universal block attrs)
// ---------------------------------------------------------------------------

export const STICKER_NAMES = [
  "star",
  "bee",
  "leaf",
  "microscope",
  "heart",
  "flower",
  "book",
  "pin",
  "sparkle",
  "moon",
  "sun",
  "cat",
  "coffee",
  "music",
  "arrow",
] as const;

export const TAPE_VALUES = ["top", "corner", "both"] as const;
export const WASHI_VALUES = ["top"] as const;
export const BLOCK_PAPER_VALUES = ["torn", "lined"] as const;
export const SHADOW_VALUES = ["soft"] as const;
export const UNDERLINE_VALUES = ["squiggle", "marker"] as const;
export const FRAME_VALUES = ["scallop", "stitch"] as const;
export const CALLOUT_VARIANTS = ["info", "tip", "warn", "star"] as const;
export const GAP_VALUES = ["sm", "md", "lg"] as const;
export const IMAGE_STYLE_VALUES = ["polaroid", "plain", "washi", "watercolor"] as const;

/**
 * Enum domain per attribute key. Values for these keys are fuzzy-matched
 * (Levenshtein ≤ 2) against their own domain only — never across domains.
 * `rotate`, `cols`, `count` etc. are free-form and never fuzzy-matched.
 */
export const ATTR_ENUM_DOMAINS: Record<string, readonly string[]> = {
  color: WASH_COLORS,
  sticker: STICKER_NAMES,
  tape: TAPE_VALUES,
  washi: WASHI_VALUES,
  paper: BLOCK_PAPER_VALUES,
  shadow: SHADOW_VALUES,
  underline: UNDERLINE_VALUES,
  frame: FRAME_VALUES,
  variant: CALLOUT_VARIANTS,
  gap: GAP_VALUES,
  style: IMAGE_STYLE_VALUES,
};

/** Frontmatter enum domains (checked with the same fuzzy matcher). */
export const FRONTMATTER_ENUM_DOMAINS: Record<string, readonly string[]> = {
  paper: PAPER_STYLES,
  ink: INK_COLORS,
  wash: PAGE_WASHES,
};

/**
 * All attribute keys the language knows about. Slightly-misspelled keys are
 * pulled toward these (with a warning); unknown keys are kept as written.
 */
export const KNOWN_ATTR_KEYS = [
  "id",
  "class",
  "color",
  "sticker",
  "tape",
  "washi",
  "rotate",
  "paper",
  "shadow",
  "underline",
  "frame",
  "variant",
  "gap",
  "cols",
  "style",
  "query",
  "count",
  "caption",
  "src",
  "alt",
  "shape",
  "width",
] as const;

/** Explicit key spellings that map to a canonical key (checked before fuzzy). */
export const ATTR_KEY_ALIASES: Record<string, string> = {
  colour: "color",
  color: "color",
  bg: "color",
  background: "color",
  rotation: "rotate",
  columns: "cols",
  highlight: "color",
};

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/** Canonical container directive names (see ContainerName in types.ts). */
export const CONTAINER_NAMES = [
  "sticky-note",
  "polaroid",
  "washi-box",
  "callout",
  "columns",
  "col",
  "image-row",
  "card",
  "quote-card",
  "spoiler",
  "banner",
] as const;

/**
 * Container alias table. Keys are *normalized* names (lowercase, with
 * spaces/`-`/`_` stripped — see normalize.ts). Values are canonical names,
 * optionally with attrs to merge (callout variants).
 */
export interface ContainerAlias {
  name: (typeof CONTAINER_NAMES)[number];
  attrs?: Record<string, string>;
}

export const CONTAINER_ALIASES: Record<string, ContainerAlias> = {
  // identity entries for every canonical name (normalized form)
  stickynote: { name: "sticky-note" },
  polaroid: { name: "polaroid" },
  washibox: { name: "washi-box" },
  callout: { name: "callout" },
  columns: { name: "columns" },
  col: { name: "col" },
  imagerow: { name: "image-row" },
  card: { name: "card" },
  quotecard: { name: "quote-card" },
  spoiler: { name: "spoiler" },
  banner: { name: "banner" },
  // friendly aliases
  note: { name: "sticky-note" },
  sticky: { name: "sticky-note" },
  postit: { name: "sticky-note" },
  picrow: { name: "image-row" },
  images: { name: "image-row" },
  photorow: { name: "image-row" },
  gallery: { name: "image-row" },
  column: { name: "col" },
  twocolumns: { name: "columns" },
  box: { name: "card" },
  panel: { name: "card" },
  details: { name: "spoiler" },
  hidden: { name: "spoiler" },
  quote: { name: "quote-card" },
  blockquote: { name: "quote-card" },
  photo: { name: "polaroid" },
  washi: { name: "washi-box" },
  // callout variants as their own directive names
  info: { name: "callout", attrs: { variant: "info" } },
  tip: { name: "callout", attrs: { variant: "tip" } },
  hint: { name: "callout", attrs: { variant: "tip" } },
  warn: { name: "callout", attrs: { variant: "warn" } },
  warning: { name: "callout", attrs: { variant: "warn" } },
  caution: { name: "callout", attrs: { variant: "warn" } },
  star: { name: "callout", attrs: { variant: "star" } },
  important: { name: "callout", attrs: { variant: "star" } },
};

// ---------------------------------------------------------------------------
// Diagram fence languages
// ---------------------------------------------------------------------------

export const DIAGRAM_LANGS = [
  "tree",
  "mindmap",
  "graph",
  "flowchart",
  "timeline",
] as const;

/** Normalized fence-language aliases → canonical diagram language. */
export const DIAGRAM_LANG_ALIASES: Record<
  string,
  (typeof DIAGRAM_LANGS)[number]
> = {
  tree: "tree",
  treediagram: "tree",
  mindmap: "mindmap",
  mind: "mindmap",
  graph: "graph",
  digraph: "graph",
  network: "graph",
  flowchart: "flowchart",
  flow: "flowchart",
  // Mermaid-compat ramp: mermaid fences are parsed by the graph grammar
  // (with a warning emitted by the block parser).
  mermaid: "flowchart",
  timeline: "timeline",
  chronology: "timeline",
};
