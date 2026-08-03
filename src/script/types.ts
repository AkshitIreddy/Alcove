/**
 * Notebook Script — document model.
 *
 * Every node carries `srcStart`/`srcEnd` source offsets (UTF-16 code-unit
 * indices into the original source string). Diagnostics are warnings only:
 * there is no 'error' severity by design — parse() is total.
 */

import type { DiagCode } from "./diagnostics";

export type { DiagCode };

// ---------------------------------------------------------------------------
// Spans & diagnostics
// ---------------------------------------------------------------------------

export interface Span {
  srcStart: number;
  srcEnd: number;
}

/**
 * A warning. There is no 'error' severity by design — parse() is total.
 *
 * `code` is the stable identity (tests and the Insert Script dialog filter on
 * it), `message` is prose, `expected` says what the parser wanted here when it
 * can say it precisely, and `line`/`column` are 1-based positions filled in
 * once the document is parsed (0 while a sub-parser is still building them).
 */
export interface Diag {
  severity: "warn";
  code: DiagCode;
  message: string;
  span: Span;
  /** 1-based line of `span.srcStart`; 0 until the doc pass locates it. */
  line: number;
  /** 1-based column (UTF-16 code units) of `span.srcStart`. */
  column: number;
  /** What was expected here, e.g. "amber, terracotta or moss". */
  expected?: string;
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export type AttrValue = string | number | boolean;

/** Normalized attribute bag. `#id` → `id`, `.class` → `class` (space-joined). */
export type Attrs = Record<string, AttrValue>;

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

export interface InlineBase extends Span {
  /** Present only when the span carried a trailing `{attrs}`. */
  attrs?: Attrs;
}

export interface TextNode extends InlineBase {
  kind: "text";
  text: string;
}

export interface StrongNode extends InlineBase {
  kind: "strong";
  children: Inline[];
}

export interface EmNode extends InlineBase {
  kind: "em";
  children: Inline[];
}

export interface CodeNode extends InlineBase {
  kind: "code";
  text: string;
}

export interface StrikeNode extends InlineBase {
  kind: "strike";
  children: Inline[];
}

export interface HighlightNode extends InlineBase {
  kind: "highlight";
  children: Inline[];
}

export interface SupNode extends InlineBase {
  kind: "sup";
  children: Inline[];
}

export interface SubNode extends InlineBase {
  kind: "sub";
  children: Inline[];
}

export interface LinkNode extends InlineBase {
  kind: "link";
  href: string;
  children: Inline[];
}

export type Inline =
  | TextNode
  | StrongNode
  | EmNode
  | CodeNode
  | StrikeNode
  | HighlightNode
  | SupNode
  | SubNode
  | LinkNode;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface BlockBase extends Span {
  /** Normalized block attributes (always present; may be empty). */
  attrs: Attrs;
}

export interface HeadingBlock extends BlockBase {
  kind: "heading";
  /** Clamped to 1–3 (deeper headings are folded to 3 with a warning). */
  level: 1 | 2 | 3;
  content: Inline[];
}

export interface ParagraphBlock extends BlockBase {
  kind: "paragraph";
  content: Inline[];
}

export interface ListItem extends Span {
  content: Inline[];
  /** Defined only on task-list items: `- [ ]` → false, `- [x]` → true. */
  checked?: boolean;
  children: ListItem[];
}

export interface ListBlock extends BlockBase {
  kind: "list";
  ordered: boolean;
  items: ListItem[];
}

export interface TaskListBlock extends BlockBase {
  kind: "taskList";
  items: ListItem[];
}

export interface QuoteBlock extends BlockBase {
  kind: "quote";
  content: Inline[];
}

export interface DividerBlock extends BlockBase {
  kind: "divider";
}

export type TableAlign = "left" | "center" | "right" | null;

export interface TableRow extends Span {
  cells: Inline[][];
}

export interface TableBlock extends BlockBase {
  kind: "table";
  header: TableRow | null;
  align: TableAlign[];
  rows: TableRow[];
}

export interface ImageBlock extends BlockBase {
  kind: "image";
  src: string;
  alt: string;
}

/** Canonical container names. Unknown names become "generic" (never an error). */
export type ContainerName =
  | "sticky-note"
  | "polaroid"
  | "washi-box"
  | "callout"
  | "columns"
  | "col"
  | "image-row"
  | "card"
  | "quote-card"
  | "spoiler"
  | "banner"
  | "index-card"
  | "envelope"
  | "stamp"
  | "tag"
  | "marginalia"
  | "pressed-flower"
  | "ticket-stub"
  | "postcard"
  | "ledger"
  | "photo-corner"
  | "wax-seal"
  | "map-pin"
  | "generic";

export interface ContainerBlock extends BlockBase {
  kind: "container";
  name: ContainerName;
  /** Original directive name — kept only for generic (unrecognized) containers. */
  rawName?: string;
  children: Block[];
}

// --- Diagram data (produced by src/script/diagrams/*) ----------------------

export interface TreeNode extends Span {
  label: string;
  /** Optional annotation after `|` (e.g. `Mitochondria | powerhouse`). */
  note?: string;
  attrs?: Attrs;
  children: TreeNode[];
}

export interface GraphNode extends Span {
  id: string;
  /** Display label when it differs from the id. */
  label?: string;
  attrs?: Attrs;
}

export interface GraphEdge extends Span {
  from: string;
  to: string;
  label?: string;
  attrs?: Attrs;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TimelineEntry extends Span {
  label: string;
  text: string;
  attrs?: Attrs;
}

export interface TreeDiagramBlock extends BlockBase {
  kind: "diagram";
  /** mindmap shares the tree grammar (radial layout at render time). */
  lang: "tree" | "mindmap";
  roots: TreeNode[];
}

export interface GraphDiagramBlock extends BlockBase {
  kind: "diagram";
  /** flowchart shares the graph grammar. */
  lang: "graph" | "flowchart";
  graph: Graph;
}

export interface TimelineDiagramBlock extends BlockBase {
  kind: "diagram";
  lang: "timeline";
  entries: TimelineEntry[];
}

export type DiagramBlock =
  | TreeDiagramBlock
  | GraphDiagramBlock
  | TimelineDiagramBlock;

export type DiagramLang = DiagramBlock["lang"];

/**
 * Image fetch directive: `fetch: <query> | key=val…` inside an image-row,
 * or the standalone leaf `::fetch{query="kitten", count=3}`.
 */
export interface FetchDirectiveBlock extends BlockBase {
  kind: "fetchDirective";
  query: string;
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | TaskListBlock
  | QuoteBlock
  | DividerBlock
  | TableBlock
  | ImageBlock
  | ContainerBlock
  | DiagramBlock
  | FetchDirectiveBlock;

// ---------------------------------------------------------------------------
// Parser plumbing
// ---------------------------------------------------------------------------

/** One physical source line with absolute offsets (`\r`/`\n` excluded). */
export interface SrcLine {
  text: string;
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface ScriptDoc {
  /** Flat key→value frontmatter (hand-parsed; `#` comments stripped). */
  frontmatter: Record<string, string>;
  blocks: Block[];
  diagnostics: Diag[];
  /**
   * `::let name = value` definitions, names lowercased, values fully resolved
   * (references to other variables already substituted). Omitted entirely
   * when the note defines none, so documents without variables keep the
   * exact shape they had before v2.
   */
  vars?: Record<string, string>;
  /**
   * `::style name {attrs}` definitions — reusable attribute sets applied with
   * `{use=name}`. Also omitted when the note defines none.
   */
  styles?: Record<string, Attrs>;
}
