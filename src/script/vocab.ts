/**
 * Notebook Script — shared vocabulary tables.
 *
 * Single source of truth for palettes, effects, container names and aliases.
 * The attr parser fuzzy-matches enum values against these tables
 * (Levenshtein ≤ 2, within the same value domain only).
 *
 * It is also the source of truth for the *AI-facing spec*: the doc tables at
 * the bottom of this file describe every name in the tables at the top, and
 * `scripts/gen-spec.mjs` renders them into
 * `src-tauri/resources/notebook-script-spec.md` (and the inlined
 * `src/editor/script/spec.ts`). Adding a name here and forgetting the spec is
 * a type error, not a silent bug — see the "Spec metadata" section.
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

/**
 * Wave 2 (custom stickers): the *live* sticker value domain. Starts as the
 * 15 built-in names and grows at runtime when the user imports custom
 * stickers (`user:<name>` — see src/editor/nodes/stickers.ts). Kept as a
 * mutable array so the attr parser's fuzzy matcher accepts registered user
 * stickers without a warning. The built-in table above stays frozen.
 */
export const SCRIPT_STICKER_DOMAIN: string[] = [...STICKER_NAMES];

/**
 * Register a script sticker value (e.g. `user:bunny`) into the live domain.
 * Idempotent; names should be pre-lowercased by the caller.
 */
export function registerScriptStickerName(name: string): void {
  if (name !== "" && !SCRIPT_STICKER_DOMAIN.includes(name)) {
    SCRIPT_STICKER_DOMAIN.push(name);
  }
}

/** True for values in the user-sticker namespace (`user:<name>`). */
export function isUserStickerName(value: string): boolean {
  return value.startsWith("user:") && value.length > "user:".length;
}

export const TAPE_VALUES = ["top", "corner", "both", "left", "right"] as const;
export const WASHI_VALUES = ["top", "left", "corner"] as const;
export const BLOCK_PAPER_VALUES = ["torn", "lined", "graph", "aged", "index"] as const;
export const SHADOW_VALUES = ["soft", "lifted", "stacked"] as const;
export const UNDERLINE_VALUES = [
  "squiggle",
  "marker",
  "dotted",
  "double",
  "circled",
] as const;
export const FRAME_VALUES = [
  "scallop",
  "stitch",
  "double",
  "rope",
  "ticket",
] as const;
export const CALLOUT_VARIANTS = ["info", "tip", "warn", "star"] as const;
export const GAP_VALUES = ["sm", "md", "lg"] as const;
export const IMAGE_STYLE_VALUES = ["polaroid", "plain", "washi", "watercolor"] as const;

/**
 * The lettering a block can be set in.
 *
 * Every one of these is a face the app already bundles through @fontsource —
 * a name here that nobody shipped is a block that silently falls back to the
 * body face, which is worse than not offering it. Ordered roughly as a
 * stationer would: the everyday hands first, then the display hands, then the
 * two printed faces for the times you want the page to look typeset.
 */
export const FONT_VALUES = [
  "hand",
  "casual",
  "marker",
  "script",
  "chalk",
  "note",
  "serif",
  "book",
  "mono",
] as const;

/** Ink a block is written in. The three page inks, plus two for emphasis. */
export const BLOCK_INK_VALUES = [
  "sepia",
  "graphite",
  "ink-blue",
  "crimson",
  "moss",
] as const;

/** Lettering size, relative to the page's body size. */
export const SIZE_VALUES = ["xs", "sm", "md", "lg", "xl"] as const;

/** Which way a block's lines are ranged. */
export const ALIGN_VALUES = ["left", "center", "right"] as const;

/**
 * Enum domain per attribute key. Values for these keys are fuzzy-matched
 * (Levenshtein ≤ 2) against their own domain only — never across domains.
 * `rotate`, `cols`, `count` etc. are free-form and never fuzzy-matched.
 */
export const ATTR_ENUM_DOMAINS: Record<string, readonly string[]> = {
  color: WASH_COLORS,
  // Live domain: built-ins + runtime-registered `user:` stickers (wave 2).
  sticker: SCRIPT_STICKER_DOMAIN,
  tape: TAPE_VALUES,
  washi: WASHI_VALUES,
  paper: BLOCK_PAPER_VALUES,
  shadow: SHADOW_VALUES,
  underline: UNDERLINE_VALUES,
  frame: FRAME_VALUES,
  font: FONT_VALUES,
  ink: BLOCK_INK_VALUES,
  size: SIZE_VALUES,
  align: ALIGN_VALUES,
  variant: CALLOUT_VARIANTS,
  gap: GAP_VALUES,
  style: IMAGE_STYLE_VALUES,
};

/**
 * Frontmatter enum domains (checked with the same fuzzy matcher). Declared
 * separately from the exported alias so the key literals survive for
 * `FrontmatterKey` — the exported `Record<string, …>` widens them away.
 */
const FRONTMATTER_DOMAIN_TABLE = {
  paper: PAPER_STYLES,
  ink: INK_COLORS,
  wash: PAGE_WASHES,
} as const;

export const FRONTMATTER_ENUM_DOMAINS: Record<string, readonly string[]> =
  FRONTMATTER_DOMAIN_TABLE;

/**
 * All attribute keys the language knows about. Slightly-misspelled keys are
 * pulled toward these (with a warning); unknown keys are kept as written.
 */
export const KNOWN_ATTR_KEYS = [
  "id",
  "class",
  // v2: apply a named `::style` set — `{use=hero}` / `{use="hero tilted"}`
  "use",
  "color",
  "sticker",
  "tape",
  "washi",
  "rotate",
  "paper",
  "shadow",
  "underline",
  "frame",
  "font",
  "ink",
  "size",
  "align",
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
  // The lettering axes, in the words a writer reaches for first.
  typeface: "font",
  face: "font",
  family: "font",
  fontfamily: "font",
  pen: "ink",
  inkcolor: "ink",
  textcolor: "ink",
  fontsize: "size",
  scale: "size",
  textalign: "align",
  alignment: "align",
  justify: "align",
  // v2 style application
  uses: "use",
  apply: "use",
  usestyle: "use",
};

/**
 * Keys whose value must be a number. A non-numeric value is kept (the parser
 * never rejects) but earns a precise diagnostic — `rotate=slightly` is the
 * kind of thing a chatbot writes and a user would otherwise never notice.
 */
export const NUMERIC_ATTR_KEYS = ["rotate", "cols", "count", "width"] as const;

/**
 * Directive names for the v2 leaf directives, and their tolerated spellings
 * (normalized: lowercase, spaces/`-`/`_` stripped).
 */
export const LET_DIRECTIVE_NAMES = ["let", "var"] as const;
export const STYLE_DIRECTIVE_NAMES = ["style", "styledef", "preset"] as const;
/** `::fetch{query=…}` — matched by name in blockParser's leaf-directive arm. */
export const FETCH_DIRECTIVE_NAMES = ["fetch"] as const;

/**
 * Every leaf (two-colon, no closing `:::`) directive, canonical name → the
 * spellings the parser accepts. Adding one here is what forces its entry in
 * LEAF_DIRECTIVE_DOCS, which is what puts it in the spec.
 */
export const LEAF_DIRECTIVE_NAMES = {
  let: LET_DIRECTIVE_NAMES,
  style: STYLE_DIRECTIVE_NAMES,
  fetch: FETCH_DIRECTIVE_NAMES,
} as const;

export type LeafDirectiveKind = keyof typeof LEAF_DIRECTIVE_NAMES;

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
  "index-card",
  "envelope",
  "stamp",
  "tag",
  "marginalia",
  // The keepsake drawer — things a hand-made notebook has stuck INTO it
  // rather than written on it. Each one is a different OCCASION, which is the
  // only reason a new container earns its name: a pressed flower is a day in
  // a field, a ticket stub is an evening out, a ledger is money. A set that
  // differed only in border radius would be one container with a colour attr.
  "pressed-flower",
  "ticket-stub",
  "postcard",
  "ledger",
  "photo-corner",
  // Two more keepsakes, and both are FASTENINGS rather than papers: a wax
  // seal closes something, a map pin holds a place down. That is why they
  // earn names next to the cards above instead of being another `frame=`
  // value — neither one is a box you write inside, they are objects that
  // arrive on top of writing.
  "wax-seal",
  "map-pin",
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
  indexcard: { name: "index-card" },
  envelope: { name: "envelope" },
  stamp: { name: "stamp" },
  tag: { name: "tag" },
  marginalia: { name: "marginalia" },
  pressedflower: { name: "pressed-flower" },
  ticketstub: { name: "ticket-stub" },
  postcard: { name: "postcard" },
  ledger: { name: "ledger" },
  photocorner: { name: "photo-corner" },
  waxseal: { name: "wax-seal" },
  mappin: { name: "map-pin" },
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
  recipe: { name: "index-card" },
  filecard: { name: "index-card" },
  flashcard: { name: "index-card" },
  letter: { name: "envelope" },
  // `postcard` USED to land on `stamp`, back when the stamp was the only
  // postal thing in the drawer. It is a container of its own now, and a
  // divided-back card is what anyone writing `::: postcard` meant; the stamp
  // keeps `postage`, which is what it actually is.
  postage: { name: "stamp" },
  luggagetag: { name: "tag" },
  label: { name: "tag" },
  sidenote: { name: "marginalia" },
  margin: { name: "marginalia" },
  aside: { name: "marginalia" },
  specimen: { name: "pressed-flower" },
  herbarium: { name: "pressed-flower" },
  botanical: { name: "pressed-flower" },
  pressed: { name: "pressed-flower" },
  ticket: { name: "ticket-stub" },
  stub: { name: "ticket-stub" },
  admitone: { name: "ticket-stub" },
  postalcard: { name: "postcard" },
  accounts: { name: "ledger" },
  tally: { name: "ledger" },
  expenses: { name: "ledger" },
  photocorners: { name: "photo-corner" },
  photomount: { name: "photo-corner" },
  snapshot: { name: "photo-corner" },
  seal: { name: "wax-seal" },
  wax: { name: "wax-seal" },
  sealingwax: { name: "wax-seal" },
  sealed: { name: "wax-seal" },
  pin: { name: "map-pin" },
  place: { name: "map-pin" },
  location: { name: "map-pin" },
  waypoint: { name: "map-pin" },
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

/**
 * Node shapes the diagram renderer can draw (`{shape=…}` on a graph node).
 * Documentation-only mirror of DIAGRAM_SHAPES in src/diagrams/types.ts —
 * `shape` is deliberately *not* in ATTR_ENUM_DOMAINS, because a shape the
 * renderer gains should not need a parser change to be writable. The two
 * lists are asserted equal in tests/script/spec-generated.test.ts.
 */
export const DIAGRAM_SHAPE_VALUES = ["rect", "cloud", "circle"] as const;

// ===========================================================================
// Spec metadata
// ===========================================================================

/**
 * Prose for every name above, keyed by the tables above.
 *
 * This is the trick that keeps the AI-facing spec honest. Each table below is
 * a `Record<Name, Doc>` over an `as const` array, so adding a sticker, a
 * container, an attribute, a diagram fence or a leaf directive *fails to
 * compile* until it has a description here — and once it does, `npm run spec`
 * publishes it. Nobody has to remember the spec file exists; they only have to
 * run one command and see it succeed.
 *
 * Voice: these strings land in a document handed to a chatbot. Lowercase,
 * no trailing period, describe what the reader gets — "a post-it note", not
 * "Renders a sticky note component."
 */

export type StickerName = (typeof STICKER_NAMES)[number];
export type KnownAttrKey = (typeof KNOWN_ATTR_KEYS)[number];
export type ContainerDirectiveName = (typeof CONTAINER_NAMES)[number];
export type DiagramLangName = (typeof DIAGRAM_LANGS)[number];
export type FrontmatterKey = "title" | keyof typeof FRONTMATTER_DOMAIN_TABLE;

/**
 * Value domains as the *spec* prints them. Identical to ATTR_ENUM_DOMAINS
 * except `sticker`: that domain grows at runtime with the user's imported
 * stickers, and the shipped spec documents the built-ins only.
 */
export const SPEC_ATTR_DOMAINS: Record<string, readonly string[]> = {
  ...ATTR_ENUM_DOMAINS,
  sticker: STICKER_NAMES,
};

// --- Frontmatter ------------------------------------------------------------

export interface FrontmatterKeyDoc {
  /** What the key controls, as a fenced-example comment. */
  does: string;
  /** The value shown in the spec's example frontmatter block. */
  example: string;
}

export const FRONTMATTER_DOCS: Record<FrontmatterKey, FrontmatterKeyDoc> = {
  title: { does: "the note's own title", example: "Cell Biology — Week 3" },
  paper: { does: "paper style", example: "grid" },
  ink: { does: "handwriting color", example: "sepia" },
  wash: { does: "page-edge watercolor", example: "amber" },
};

// --- Stickers ---------------------------------------------------------------

/**
 * What each sticker draws, and the excuse to reach for it. The second half
 * matters more than the first: a chatbot picking `bee` for a pollination note
 * is the difference between decoration and a note that looks considered.
 */
export const STICKER_DOCS: Record<StickerName, string> = {
  star: "a five-pointed doodle star — favourites, gold-star results",
  bee: "a little bee — nature, pollination, busywork",
  leaf: "a single leaf — biology, autumn, growth",
  microscope: "a microscope — lab work, close reading, science",
  heart: "a hand-drawn heart — things loved or cared about",
  flower: "a small bloom — spring, botany, something cheerful",
  book: "a closed book — reading lists, references, homework",
  pin: "a push-pin — pinned reminders, 'do not lose this'",
  sparkle: "a four-point sparkle — ideas, magic, a nice result",
  moon: "a crescent moon — night, sleep, phases, endings",
  sun: "a rayed sun — mornings, energy, weather",
  cat: "a curled cat — pets, comfort, a break",
  coffee: "a steaming mug — study breaks, mornings, long sessions",
  music: "an eighth note — songs, practice, rhythm",
  arrow: "a curved arrow — 'see this', a pointer to the next thing",
};

// --- Attributes -------------------------------------------------------------

export interface AttrDoc {
  /** What it does, table voice: "watercolor tint". */
  does: string;
  /**
   * How to describe the value when the key has no domain in
   * SPEC_ATTR_DOMAINS. Enum keys leave this undefined and print their domain,
   * so their listed values can never drift from what the parser accepts.
   */
  values?: string;
  /**
   * `effect` attrs work on any block and get the spec's headline table.
   * Everything else is listed by where it belongs.
   */
  group: "effect" | "layout" | "media" | "meta";
  /** Where a non-effect attr applies, e.g. "on `image-row`". */
  where?: string;
}

export const ATTR_DOCS: Record<KnownAttrKey, AttrDoc> = {
  // effects — the universal decorations
  color: { group: "effect", does: "watercolor tint" },
  sticker: { group: "effect", does: "doodle sticker in the margin" },
  tape: { group: "effect", does: "scotch-tape effect" },
  washi: { group: "effect", does: "washi tape strip" },
  rotate: {
    group: "effect",
    does: "slight tilt, in degrees",
    values: "number, `-3` to `3`",
  },
  paper: { group: "effect", does: "paper texture for this block" },
  shadow: { group: "effect", does: "soft drop shadow" },
  underline: { group: "effect", does: "hand-drawn underline" },
  frame: { group: "effect", does: "decorative border" },
  font: { group: "effect", does: "lettering this block is written in" },
  ink: { group: "effect", does: "ink colour for this block" },
  size: { group: "effect", does: "lettering size" },
  align: { group: "effect", does: "which way the lines are ranged" },
  // layout
  variant: { group: "layout", does: "which callout", where: "on `callout`" },
  gap: { group: "layout", does: "space between columns", where: "on `columns`" },
  cols: {
    group: "layout",
    does: "how many images per row",
    values: "number",
    where: "on `image-row`",
  },
  style: {
    group: "layout",
    does: "how images and diagram nodes are framed",
    where: "on `image-row`, images, diagram fences",
  },
  width: {
    group: "layout",
    does: "width in pixels",
    values: "number",
    where: "on images",
  },
  shape: {
    group: "layout",
    does: "node outline",
    values: DIAGRAM_SHAPE_VALUES.map((s) => `\`${s}\``).join(" "),
    where: "on `graph`/`flowchart` nodes",
  },
  // media
  src: {
    group: "media",
    does: "image path",
    values: "a path",
    where: "on images (usually written as `![alt](src)`)",
  },
  alt: {
    group: "media",
    does: "image description",
    values: "free text",
    where: "on images",
  },
  caption: {
    group: "media",
    does: "caption under the image",
    values: "free text",
    where: "on images and `fetch:` lines",
  },
  query: {
    group: "media",
    does: "what to search for",
    values: "free text",
    where: "on `::fetch`",
  },
  count: {
    group: "media",
    does: "how many images to fetch",
    values: "number",
    where: "on `::fetch`",
  },
  // meta
  id: { group: "meta", does: "anchor name", values: "a word (`#name` works too)" },
  class: {
    group: "meta",
    does: "extra class",
    values: "a word (`.name` works too)",
  },
  use: {
    group: "meta",
    does: "apply a named `::style`",
    values: "a style name, or several in quotes",
  },
};

// --- Containers -------------------------------------------------------------

export interface ContainerDoc {
  /** What it renders as, table voice. */
  renders: string;
  /** Appended to the table cell, e.g. a pointer to the section below. */
  note?: string;
}

export const CONTAINER_DOCS: Record<ContainerDirectiveName, ContainerDoc> = {
  "sticky-note": { renders: "a post-it note (great for reminders)" },
  polaroid: { renders: "white-framed photo card" },
  "washi-box": { renders: "box held to the page by washi tape" },
  callout: { renders: "callout with a hand-drawn icon in the margin" },
  columns: { renders: "side-by-side layout", note: "holds `col` children" },
  col: { renders: "one column", note: "only inside `columns`" },
  "image-row": { renders: "row of images", note: "see below" },
  card: { renders: "simple bordered card (good for definitions)" },
  "quote-card": { renders: "decorated pull-quote" },
  spoiler: { renders: "click-to-reveal box (good for self-quizzing)" },
  banner: { renders: "full-width ribbon banner" },
  "index-card": {
    renders: "ruled index card with a red header rule",
    note: "recipes, flashcards, one fact per card",
  },
  envelope: { renders: "paper envelope with an open flap (letters, keepsakes)" },
  stamp: { renders: "perforated postage stamp with a postmark" },
  tag: { renders: "luggage tag on a string (a short label for what follows)" },
  marginalia: {
    renders: "small side note in a ruled margin",
    note: "an afterthought, in a smaller hand",
  },
  "pressed-flower": {
    renders: "a botanical specimen taped to a mount card",
    note: "`title` is the label — species, place, date",
  },
  "ticket-stub": {
    renders: "a torn ticket with a perforated stub",
    note: "concerts, trains, cinemas; `title` is the stub legend",
  },
  postcard: {
    renders: "a divided-back postcard — message left, address lines right",
    note: "`title` is the postmark",
  },
  ledger: {
    renders: "a ruled accounts strip with a figures column",
    note: "money, tallies, scores; `title` names the account",
  },
  "photo-corner": {
    renders: "a print held to the page by four paper corners",
    note: "`title` is the pencil caption underneath",
  },
  "wax-seal": {
    renders: "a blob of sealing wax over a ribbon, pressed with a monogram",
    note: "`title` is the monogram — one or two letters",
  },
  "map-pin": {
    renders: "a pin dropped in the margin with the walk in behind it",
    note: "places, travel notes; `title` is the place name",
  },
};

// --- Diagram fences ---------------------------------------------------------

export interface DiagramDoc {
  /** The grammar in one line: "indentation only, 2 spaces per level". */
  grammar: string;
  /** Gloss for the quick-reference card, ≤ 22 chars. */
  card: string;
}

export const DIAGRAM_DOCS: Record<DiagramLangName, DiagramDoc> = {
  tree: { grammar: "indentation only, 2 spaces per level", card: "indent = nesting" },
  mindmap: { grammar: "the `tree` grammar, laid out radially", card: "same, radial" },
  graph: { grammar: "`A -> B: label`, one edge per line", card: "A -> B: label" },
  flowchart: { grammar: "the `graph` grammar, for processes", card: "same as graph" },
  timeline: { grammar: "one `label: text` per line", card: "label: text | attrs" },
};

// --- Leaf directives --------------------------------------------------------

export interface LeafDirectiveLine {
  /** Written verbatim in the quick-reference card. */
  syntax: string;
  /** What that line does, card voice. */
  does: string;
}

export interface LeafDirectiveDoc extends LeafDirectiveLine {
  /** The other spellings worth showing: how it is used, shorthand forms. */
  more?: readonly LeafDirectiveLine[];
}

export const LEAF_DIRECTIVE_DOCS: Record<LeafDirectiveKind, LeafDirectiveDoc> = {
  let: {
    syntax: "::let course = Cell Biology",
    does: "define a variable",
    more: [
      { syntax: "::let {week=3, room=B12}", does: "define several at once" },
      { syntax: "{{course}}", does: "use one, anywhere" },
    ],
  },
  style: {
    syntax: "::style hero {color=amber}",
    does: "name a set of attrs",
    more: [
      { syntax: "{use=hero}", does: "apply it to a block or span" },
      { syntax: '{use="hero quiet"}', does: "apply several" },
    ],
  },
  fetch: {
    syntax: '::fetch{query="a kitten"}',
    does: "ask the app to find an image",
    more: [
      { syntax: "fetch: a kitten | caption=hi", does: "one per line in an image-row" },
    ],
  },
};
