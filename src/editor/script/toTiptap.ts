/**
 * Notebook Script → TipTap document JSON (the storage/editor format).
 *
 * `scriptDocToTiptap(doc)` maps every script Block/Inline onto the editor
 * schema (see src/editor/extensions.ts). It is total: unknown or unmappable
 * things degrade to styled paragraphs — it never throws.
 *
 * Fidelity notes:
 * - The decorative block attrs (rotate, tape, washi, shadow, frame, paper,
 *   underline) are REAL attributes on every block type via the BlockEffects
 *   global-attribute extension, so they survive the live editor. Attrs the
 *   schema still does not model (sticker on containers, unknown keys…) are
 *   emitted onto the node JSON so `tiptapToScriptDoc` can round-trip them;
 *   ProseMirror drops those on insertion into a real editor.
 * - Every vocab container maps to its real node (names match vocab.ts
 *   canonical names verbatim, so `options.hasNode` wires them
 *   automatically). The callout fallback with `containerName` +
 *   `containerAttrs` marker attrs remains ONLY for genuinely unknown names —
 *   or when a supplied hasNode() denies a container node.
 * - Diagrams emit a real `diagram` node only when `options.hasNode('diagram')`
 *   says one is registered; otherwise a placeholder paragraph carries the
 *   diagram JSON in a `data-diagram` attr.
 */

import type {
  AttrValue,
  Attrs,
  Block,
  ContainerBlock,
  ContainerName,
  DiagramBlock,
  Inline,
  ListItem,
  ScriptDoc,
  TableRow,
} from '../../script/types';
import type { PageDoc } from '../../data/types';
import { GAP_VALUES, WASH_COLORS } from '../../script/vocab';
import type { StickerId } from '../nodes/stickers';
import type { CalloutTint } from '../nodes/callout';

// ---------------------------------------------------------------------------
// JSON shapes
// ---------------------------------------------------------------------------

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
  text?: string;
}

export interface ToTiptapOptions {
  /**
   * Runtime schema lookup: return true when a node type (e.g. 'diagram') is
   * registered in the live editor. Callers with an editor instance should
   * pass `(name) => editor.schema.nodes[name] !== undefined`. Default: every
   * optional node is treated as absent (resilient placeholder path).
   */
  hasNode?: (name: string) => boolean;
  /**
   * Turn `[[Another page]]` into a real reference.
   *
   * A script can only name a page; page ids belong to a library and a
   * document has no way to know them, so whoever is doing the inserting is
   * the only one who can look them up. Return null (or supply nothing) and
   * the reference degrades to the words the writer wrote — which is still a
   * sentence, where a chip pointing at no page would be a dead end.
   */
  resolvePageLink?: (
    label: string,
  ) => { pageId: string; bookId: string; label?: string } | null;
}

// ---------------------------------------------------------------------------
// Vocabulary bridges (script names → editor enums)
// ---------------------------------------------------------------------------

/** Script sticker vocabulary (15 names) → the editor's 8 procedural stickers. */
export const SCRIPT_STICKER_TO_EDITOR = {
  star: 'star',
  bee: 'bee',
  leaf: 'leaf',
  heart: 'heart',
  sparkle: 'sparkle',
  cat: 'cat',
  sun: 'sun',
  flower: 'flower',
  microscope: 'sparkle',
  book: 'leaf',
  pin: 'star',
  moon: 'sun',
  coffee: 'heart',
  music: 'sparkle',
  arrow: 'star',
} satisfies Record<string, StickerId>;

export function mapStickerName(name: string): StickerId | null {
  // Wave 2: `user:<name>` script stickers pass through to the editor's
  // user-sticker registry (src/editor/nodes/stickers.ts) untouched.
  if (name.startsWith('user:') && name.length > 'user:'.length) {
    return name as StickerId;
  }
  const table: Record<string, StickerId> = SCRIPT_STICKER_TO_EDITOR;
  return table[name] ?? null;
}

/** Callout `variant` → editor callout icon + tint. */
export const CALLOUT_VARIANT_STYLE = {
  info: { icon: 'sparkle', tint: 'sky' },
  tip: { icon: 'leaf', tint: 'moss' },
  warn: { icon: 'bee', tint: 'terracotta' },
  star: { icon: 'star', tint: 'amber' },
} satisfies Record<string, { icon: StickerId; tint: CalloutTint }>;

const EDITOR_TINTS: readonly string[] = [
  'amber',
  'terracotta',
  'moss',
  'lemon',
  'sky',
  'blush',
];

function isEditorTint(value: unknown): value is CalloutTint {
  return typeof value === 'string' && EDITOR_TINTS.includes(value);
}

/**
 * Vocab container name → registered editor node name. New container nodes
 * use the canonical vocab name VERBATIM; only the legacy imageRow node
 * predates that convention.
 */
export const CONTAINER_NODE_NAMES: Record<
  Exclude<ContainerName, 'generic'>,
  string
> = {
  'sticky-note': 'sticky-note',
  polaroid: 'polaroid',
  'washi-box': 'washi-box',
  callout: 'callout',
  columns: 'columns',
  col: 'col',
  'image-row': 'imageRow',
  card: 'card',
  'quote-card': 'quote-card',
  spoiler: 'spoiler',
  banner: 'banner',
  'index-card': 'index-card',
  envelope: 'envelope',
  stamp: 'stamp',
  tag: 'tag',
  marginalia: 'marginalia',
  'pressed-flower': 'pressed-flower',
  'ticket-stub': 'ticket-stub',
  postcard: 'postcard',
  ledger: 'ledger',
  'photo-corner': 'photo-corner',
  'wax-seal': 'wax-seal',
  'map-pin': 'map-pin',
  // The one container whose editor node is not called what the script calls
  // it: TipTap's disclosure element is `details`, and its summary and body
  // are separate nodes (see mapToggle).
  toggle: 'details',
};

const WASH_NAMES: readonly string[] = WASH_COLORS;

function isWashName(value: unknown): value is string {
  return typeof value === 'string' && WASH_NAMES.includes(value);
}

/** Icon used when a container falls back to a callout node. */
const CONTAINER_FALLBACK_ICON: Record<string, StickerId> = {
  'sticky-note': 'star',
  polaroid: 'sun',
  'washi-box': 'flower',
  card: 'leaf',
  'quote-card': 'heart',
  spoiler: 'cat',
  banner: 'sun',
  'index-card': 'star',
  envelope: 'heart',
  stamp: 'flower',
  tag: 'leaf',
  marginalia: 'sparkle',
  'pressed-flower': 'flower',
  'ticket-stub': 'star',
  postcard: 'sun',
  ledger: 'leaf',
  'photo-corner': 'sun',
  'wax-seal': 'heart',
  'map-pin': 'pin',
  toggle: 'arrow',
  generic: 'sparkle',
};

/** Frontmatter `paper:` → Document `pageStyle` attr. */
const PAPER_TO_PAGE_STYLE: Record<string, string> = {
  cream: 'blank',
  grid: 'grid',
  dotted: 'dotted',
  lined: 'ruled',
};

// ---------------------------------------------------------------------------
// Attr helpers
// ---------------------------------------------------------------------------

/** Copy attrs minus the excluded keys (values are already primitives). */
function extraAttrs(
  attrs: Attrs,
  exclude: readonly string[] = [],
): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!exclude.includes(key)) out[key] = value;
  }
  return out;
}

/** Build a node, omitting empty attrs/content for canonical JSON. */
function node(
  type: string,
  attrs: Record<string, unknown>,
  content?: TiptapNode[],
): TiptapNode {
  const out: TiptapNode = { type };
  if (Object.keys(attrs).length > 0) out.attrs = attrs;
  if (content !== undefined && content.length > 0) out.content = content;
  return out;
}

// ---------------------------------------------------------------------------
// Inline mapping (script inline tree → flat text runs with marks)
// ---------------------------------------------------------------------------

function pushInlines(
  nodes: Inline[],
  out: TiptapNode[],
  marks: TiptapMark[],
  options: ToTiptapOptions = {},
): void {
  /** An inline atom, wearing whatever marks the run it sits in is wearing. */
  const atom = (type: string, attrs: Record<string, unknown>): TiptapNode => {
    const node: TiptapNode = { type, attrs };
    if (marks.length > 0) node.marks = [...marks];
    return node;
  };
  const available = (name: string): boolean =>
    options.hasNode === undefined || options.hasNode(name);

  for (const n of nodes) {
    switch (n.kind) {
      case 'math':
        if (available('mathInline')) {
          out.push(atom('mathInline', { latex: n.text }));
        } else if (n.text !== '') {
          // No maths in this schema — the formula is still what it says.
          out.push({ type: 'text', text: `$${n.text}$`, ...(marks.length > 0 ? { marks: [...marks] } : {}) });
        }
        break;
      case 'footnote':
        if (available('footnote')) {
          out.push(atom('footnote', { text: n.text }));
        } else if (n.text !== '') {
          out.push({ type: 'text', text: ` (${n.text})`, ...(marks.length > 0 ? { marks: [...marks] } : {}) });
        }
        break;
      case 'pageref': {
        const target =
          n.label === '' ? null : (options.resolvePageLink?.(n.label) ?? null);
        if (target !== null && available('pageLink')) {
          out.push(
            atom('pageLink', {
              pageId: target.pageId,
              bookId: target.bookId,
              label: target.label ?? n.label,
            }),
          );
        } else if (n.label !== '') {
          // Nothing to point at: keep the words. "see Photosynthesis for the
          // numbers" is a sentence; a chip pointing nowhere is a dead end.
          out.push({
            type: 'text',
            text: n.label,
            ...(marks.length > 0 ? { marks: [...marks] } : {}),
          });
        }
        break;
      }
      case 'text':
        if (n.text !== '') {
          const t: TiptapNode = { type: 'text', text: n.text };
          if (marks.length > 0) t.marks = [...marks];
          out.push(t);
        }
        break;
      case 'code':
        if (n.text !== '') {
          out.push({
            type: 'text',
            text: n.text,
            marks: [...marks, { type: 'code' }],
          });
        }
        break;
      case 'strong':
        pushInlines(n.children, out, [...marks, { type: 'bold' }], options);
        break;
      case 'em':
        pushInlines(n.children, out, [...marks, { type: 'italic' }], options);
        break;
      case 'strike':
        pushInlines(n.children, out, [...marks, { type: 'strike' }], options);
        break;
      case 'highlight': {
        const mark: TiptapMark = { type: 'highlight' };
        if (typeof n.attrs?.color === 'string') {
          mark.attrs = { color: n.attrs.color };
        }
        pushInlines(n.children, out, [...marks, mark], options);
        break;
      }
      case 'link':
        pushInlines(
          n.children,
          out,
          [...marks, { type: 'link', attrs: { href: n.href } }],
          options,
        );
        break;
      case 'sup':
      case 'sub':
        // No sub/superscript mark installed — degrade to plain text.
        pushInlines(n.children, out, marks, options);
        break;
    }
  }
}

function inlineNodes(
  content: Inline[],
  options: ToTiptapOptions = {},
): TiptapNode[] {
  const out: TiptapNode[] = [];
  pushInlines(content, out, [], options);
  return out;
}

function stickerNode(stickerId: StickerId): TiptapNode {
  return { type: 'sticker', attrs: { stickerId } };
}

/** Flatten an inline tree to plain text (degradation paths). */
function inlineText(content: Inline[]): string {
  let out = '';
  for (const n of content) {
    if (n.kind === 'text' || n.kind === 'code' || n.kind === 'footnote') {
      out += n.text;
    } else if (n.kind === 'math') {
      out += `$${n.text}$`;
    } else if (n.kind === 'pageref') {
      out += n.label;
    } else {
      out += inlineText(n.children);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block mapping
// ---------------------------------------------------------------------------

/**
 * Inline content for a block that hosts text, converting a mappable
 * `{sticker=…}` attr into a trailing inline sticker node.
 */
function contentWithSticker(
  content: Inline[],
  attrs: Attrs,
  options: ToTiptapOptions = {},
): { content: TiptapNode[]; exclude: string[] } {
  const sticker =
    typeof attrs.sticker === 'string' ? mapStickerName(attrs.sticker) : null;
  const nodes = inlineNodes(content, options);
  if (sticker !== null) nodes.push(stickerNode(sticker));
  return { content: nodes, exclude: sticker !== null ? ['sticker'] : [] };
}

function mapListItems(
  items: ListItem[],
  listType: 'bulletList' | 'orderedList' | 'taskList',
  options: ToTiptapOptions = {},
): TiptapNode[] {
  const itemType = listType === 'taskList' ? 'taskItem' : 'listItem';
  return items.map((item) => {
    const body: TiptapNode[] = [
      node('paragraph', {}, inlineNodes(item.content, options)),
    ];
    if (item.children.length > 0) {
      body.push(
        node(listType, {}, mapListItems(item.children, listType, options)),
      );
    }
    const attrs: Record<string, unknown> =
      itemType === 'taskItem' ? { checked: item.checked === true } : {};
    return node(itemType, attrs, body);
  });
}

function mapTableRow(
  row: TableRow,
  cellType: string,
  options: ToTiptapOptions = {},
): TiptapNode {
  return node(
    'tableRow',
    {},
    row.cells.map((cell) =>
      node(cellType, {}, [node('paragraph', {}, inlineNodes(cell, options))]),
    ),
  );
}

function diagramPayload(block: DiagramBlock): string {
  return JSON.stringify(block);
}

function diagramLabel(block: DiagramBlock): string {
  switch (block.lang) {
    case 'tree':
    case 'mindmap': {
      let count = 0;
      const walk = (nodes: typeof block.roots): void => {
        for (const n of nodes) {
          count += 1;
          walk(n.children);
        }
      };
      walk(block.roots);
      return `[${block.lang} diagram — ${count} node${count === 1 ? '' : 's'}]`;
    }
    case 'graph':
    case 'flowchart':
      return `[${block.lang} diagram — ${block.graph.edges.length} edge${
        block.graph.edges.length === 1 ? '' : 's'
      }]`;
    case 'timeline':
      return `[timeline — ${block.entries.length} entr${
        block.entries.length === 1 ? 'y' : 'ies'
      }]`;
  }
}

function mapDiagram(
  block: DiagramBlock,
  options: ToTiptapOptions,
  forcePlaceholder: boolean,
): TiptapNode {
  const id = typeof block.attrs.id === 'string' ? block.attrs.id : null;
  const idAttrs = id !== null ? { id } : {};
  if (!forcePlaceholder && options.hasNode?.('diagram') === true) {
    return node('diagram', {
      ...idAttrs,
      kind: block.lang,
      data: diagramPayload(block),
    });
  }
  return node('paragraph', { ...idAttrs, 'data-diagram': diagramPayload(block) }, [
    { type: 'text', text: diagramLabel(block) },
  ]);
}

/** Degrade arbitrary blocks to paragraphs (callout content is paragraph+). */
function degradeToParagraphs(
  blocks: Block[],
  options: ToTiptapOptions,
): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const child of blocks) {
    switch (child.kind) {
      case 'paragraph': {
        const { content, exclude } = contentWithSticker(
          child.content,
          child.attrs,
          options,
        );
        out.push(node('paragraph', extraAttrs(child.attrs, exclude), content));
        break;
      }
      case 'heading':
      case 'quote':
        out.push(node('paragraph', {}, inlineNodes(child.content, options)));
        break;
      case 'list':
      case 'taskList': {
        const flat = (items: ListItem[]): void => {
          for (const item of items) {
            out.push(node('paragraph', {}, inlineNodes(item.content, options)));
            flat(item.children);
          }
        };
        flat(child.items);
        break;
      }
      case 'image': {
        const text = child.alt !== '' ? child.alt : child.src;
        if (text !== '') {
          out.push(node('paragraph', {}, [{ type: 'text', text }]));
        }
        break;
      }
      case 'container':
        out.push(...degradeToParagraphs(child.children, options));
        break;
      case 'diagram':
        out.push(mapDiagram(child, options, true));
        break;
      case 'mathBlock':
        out.push(
          node('paragraph', {}, [
            { type: 'text', text: `$$${child.latex}$$` },
          ]),
        );
        break;
      case 'fetchDirective':
        out.push(
          node('paragraph', {}, [
            { type: 'text', text: `fetch: ${child.query}` },
          ]),
        );
        break;
      case 'table':
        for (const row of [
          ...(child.header !== null ? [child.header] : []),
          ...child.rows,
        ]) {
          const text = row.cells.map((c) => inlineText(c)).join(' — ');
          if (text.trim() !== '') {
            out.push(node('paragraph', {}, [{ type: 'text', text }]));
          }
        }
        break;
      case 'divider':
        break;
    }
  }
  if (out.length === 0) out.push({ type: 'paragraph' });
  return out;
}

/**
 * Is the real node for a container available? Container nodes are part of
 * the default editor schema now, so with no hasNode supplied we assume
 * presence; an explicit hasNode() can still deny (degradation path).
 */
function hasContainerNode(
  name: Exclude<ContainerName, 'generic'>,
  options: ToTiptapOptions,
): boolean {
  return (
    options.hasNode === undefined ||
    options.hasNode(CONTAINER_NODE_NAMES[name]) === true
  );
}

/** Map container children as full blocks, guaranteeing `block+` validity. */
function blockChildren(blocks: Block[], options: ToTiptapOptions): TiptapNode[] {
  const out = mapBlocks(blocks, options);
  if (out.length === 0) out.push({ type: 'paragraph' });
  return out;
}

/** Callout fallback carrying containerName/containerAttrs marker attrs. */
function fallbackContainer(
  block: ContainerBlock,
  options: ToTiptapOptions,
): TiptapNode[] {
  const name =
    block.name === 'generic' ? (block.rawName ?? 'generic') : block.name;
  const tint: CalloutTint = isEditorTint(block.attrs.color)
    ? block.attrs.color
    : 'amber';
  const icon = CONTAINER_FALLBACK_ICON[block.name] ?? 'sparkle';
  const id = typeof block.attrs.id === 'string' ? { id: block.attrs.id } : {};
  return [
    node(
      'callout',
      {
        icon,
        tint,
        ...id,
        containerName: name,
        containerAttrs: { ...block.attrs },
      },
      degradeToParagraphs(block.children, options),
    ),
  ];
}

/**
 * Which containers declare a `color` attribute, and which declare a `title`.
 *
 * These mirror `addAttributes()` in src/editor/nodes/containers.ts. They are
 * tables rather than a `case` per container because the mapping had already
 * drifted once: index-card, envelope, stamp, tag and marginalia are REAL nodes
 * and were nowhere in this switch, so every one of them arrived from script as
 * a callout wearing a `containerName` marker — the script round-tripped, and
 * the page showed the wrong object. `CONTAINER_NODE_NAMES` above is
 * compile-checked against `ContainerName`; the switch that fed it was not.
 */
const COLOR_CONTAINERS: readonly string[] = [
  'sticky-note',
  'washi-box',
  'quote-card',
  'banner',
  'envelope',
  'stamp',
  'tag',
  'pressed-flower',
  'ticket-stub',
  'postcard',
  'ledger',
  'photo-corner',
  'wax-seal',
  'map-pin',
];

const TITLE_CONTAINERS: readonly string[] = [
  'card',
  'index-card',
  'pressed-flower',
  'ticket-stub',
  'postcard',
  'ledger',
  'photo-corner',
  'wax-seal',
  'map-pin',
];

/**
 * The ordinary case: a block container whose children map straight through,
 * with `color` and/or `title` promoted to real node attrs where the node
 * declares them. Everything else on the block stays in the extras so the
 * export round-trips.
 */
function plainContainer(
  block: ContainerBlock,
  options: ToTiptapOptions,
): TiptapNode[] {
  const name = block.name as Exclude<ContainerName, 'generic'>;
  if (!hasContainerNode(name, options)) return fallbackContainer(block, options);
  const promoted: Record<string, unknown> = {};
  const used: string[] = [];
  if (COLOR_CONTAINERS.includes(name) && isWashName(block.attrs.color)) {
    promoted.color = block.attrs.color;
    used.push('color');
  }
  if (
    TITLE_CONTAINERS.includes(name) &&
    typeof block.attrs.title === 'string' &&
    block.attrs.title !== ''
  ) {
    promoted.title = block.attrs.title;
    used.push('title');
  }
  return [
    node(
      CONTAINER_NODE_NAMES[name],
      { ...promoted, ...extraAttrs(block.attrs, used) },
      blockChildren(block.children, options),
    ),
  ];
}

/**
 * `::: toggle {title=…}` → TipTap's `details` triple.
 *
 * Three nodes, not one: `details` holds a `detailsSummary` (the line you
 * click, text only) and a `detailsContent` (everything folded away, block+).
 * The summary comes from `title`; a toggle with no title still gets a summary
 * node, because the schema requires one and a fold with no handle cannot be
 * opened.
 */
function mapToggle(
  block: ContainerBlock,
  options: ToTiptapOptions,
): TiptapNode[] {
  if (
    !hasContainerNode('toggle', options) ||
    options.hasNode?.('detailsSummary') === false ||
    options.hasNode?.('detailsContent') === false
  ) {
    return fallbackContainer(block, options);
  }
  const title =
    typeof block.attrs.title === 'string' && block.attrs.title !== ''
      ? block.attrs.title
      : 'More';
  const open = block.attrs.open === true ? { open: true } : {};
  return [
    node('details', { ...open, ...extraAttrs(block.attrs, ['title', 'open']) }, [
      node('detailsSummary', {}, [{ type: 'text', text: title }]),
      node('detailsContent', {}, blockChildren(block.children, options)),
    ]),
  ];
}

/** One `col` node from a script col container. */
function mapColumn(block: ContainerBlock, options: ToTiptapOptions): TiptapNode {
  const width =
    typeof block.attrs.width === 'number' && block.attrs.width > 0
      ? { width: block.attrs.width }
      : {};
  return node(
    'col',
    { ...width, ...extraAttrs(block.attrs, 'width' in width ? ['width'] : []) },
    blockChildren(block.children, options),
  );
}

function mapContainer(
  block: ContainerBlock,
  options: ToTiptapOptions,
): TiptapNode[] {
  switch (block.name) {
    case 'callout': {
      const variant =
        typeof block.attrs.variant === 'string' ? block.attrs.variant : null;
      const style =
        variant !== null &&
        Object.prototype.hasOwnProperty.call(CALLOUT_VARIANT_STYLE, variant)
          ? CALLOUT_VARIANT_STYLE[variant as keyof typeof CALLOUT_VARIANT_STYLE]
          : null;
      let icon: StickerId = style?.icon ?? 'leaf';
      let tint: CalloutTint = style?.tint ?? 'amber';
      if (isEditorTint(block.attrs.color)) tint = block.attrs.color;
      if (typeof block.attrs.sticker === 'string') {
        const mapped = mapStickerName(block.attrs.sticker);
        if (mapped !== null) icon = mapped;
      }
      // variant/color/sticker stay in the extras so the export round-trips.
      return [
        node(
          'callout',
          { icon, tint, ...extraAttrs(block.attrs) },
          degradeToParagraphs(block.children, options),
        ),
      ];
    }

    case 'image-row': {
      const out: TiptapNode[] = [];
      const images: TiptapNode[] = [];
      const rest: Block[] = [];
      for (const child of block.children) {
        if (child.kind === 'image' && images.length < 4) {
          images.push(
            node('image', {
              src: child.src,
              alt: child.alt,
              ...extraAttrs(child.attrs),
            }),
          );
        } else {
          rest.push(child);
        }
      }
      if (images.length > 0) {
        out.push(node('imageRow', extraAttrs(block.attrs), images));
      }
      for (const child of rest) out.push(...mapBlock(child, options));
      return out;
    }

    case 'sticky-note':
    case 'washi-box':
    case 'quote-card':
    case 'banner':
    case 'card':
    case 'index-card':
    case 'envelope':
    case 'stamp':
    case 'tag':
    case 'marginalia':
    case 'pressed-flower':
    case 'ticket-stub':
    case 'postcard':
    case 'ledger':
    case 'photo-corner':
    case 'wax-seal':
    case 'map-pin':
      return plainContainer(block, options);

    case 'toggle':
      return mapToggle(block, options);

    case 'spoiler': {
      if (!hasContainerNode('spoiler', options)) {
        return fallbackContainer(block, options);
      }
      return [
        node(
          'spoiler',
          extraAttrs(block.attrs),
          blockChildren(block.children, options),
        ),
      ];
    }

    case 'polaroid': {
      if (!hasContainerNode('polaroid', options)) {
        return fallbackContainer(block, options);
      }
      // Schema: image? paragraph+ — first image wins, the rest degrades.
      let image: TiptapNode | null = null;
      const rest: Block[] = [];
      for (const child of block.children) {
        if (image === null && child.kind === 'image') {
          image = node('image', {
            src: child.src,
            alt: child.alt,
            ...extraAttrs(child.attrs),
          });
        } else {
          rest.push(child);
        }
      }
      const content: TiptapNode[] = [];
      if (image !== null) content.push(image);
      content.push(...degradeToParagraphs(rest, options));
      return [node('polaroid', extraAttrs(block.attrs), content)];
    }

    case 'columns': {
      if (
        !hasContainerNode('columns', options) ||
        !hasContainerNode('col', options)
      ) {
        // Degradation path: flatten children into the normal flow.
        return mapBlocks(block.children, options);
      }
      const cols: TiptapNode[] = [];
      const stray: Block[] = [];
      for (const child of block.children) {
        if (child.kind === 'container' && child.name === 'col') {
          cols.push(mapColumn(child, options));
        } else {
          stray.push(child);
        }
      }
      if (stray.length > 0) {
        cols.push(node('col', {}, blockChildren(stray, options)));
      }
      // Schema: col{2,4}. Too few → flatten; too many → merge into the 4th.
      if (cols.length < 2) return mapBlocks(block.children, options);
      while (cols.length > 4) {
        const extra = cols.pop();
        const target = cols[3];
        target.content = [
          ...(target.content ?? []),
          ...(extra?.content ?? []),
        ];
      }
      const gap =
        typeof block.attrs.gap === 'string' &&
        (GAP_VALUES as readonly string[]).includes(block.attrs.gap)
          ? { gap: block.attrs.gap }
          : {};
      return [
        node(
          'columns',
          { ...gap, ...extraAttrs(block.attrs, 'gap' in gap ? ['gap'] : []) },
          cols,
        ),
      ];
    }

    case 'col':
      // A stray col outside columns has no valid slot — flatten.
      return mapBlocks(block.children, options);

    default:
      // Genuinely unknown containers → callout fallback with marker attrs.
      return fallbackContainer(block, options);
  }
}

function mapBlock(block: Block, options: ToTiptapOptions): TiptapNode[] {
  switch (block.kind) {
    case 'heading': {
      const { content, exclude } = contentWithSticker(
        block.content,
        block.attrs,
        options,
      );
      return [
        node(
          'heading',
          { level: block.level, ...extraAttrs(block.attrs, exclude) },
          content,
        ),
      ];
    }
    case 'paragraph': {
      const { content, exclude } = contentWithSticker(
        block.content,
        block.attrs,
        options,
      );
      return [node('paragraph', extraAttrs(block.attrs, exclude), content)];
    }
    case 'quote': {
      const { content, exclude } = contentWithSticker(
        block.content,
        block.attrs,
        options,
      );
      return [
        node('blockquote', extraAttrs(block.attrs, exclude), [
          node('paragraph', {}, content),
        ]),
      ];
    }
    case 'divider':
      return [node('horizontalRule', extraAttrs(block.attrs))];
    case 'list': {
      const listType = block.ordered ? 'orderedList' : 'bulletList';
      return [
        node(
          listType,
          extraAttrs(block.attrs),
          mapListItems(block.items, listType, options),
        ),
      ];
    }
    case 'taskList':
      return [
        node(
          'taskList',
          extraAttrs(block.attrs),
          mapListItems(block.items, 'taskList', options),
        ),
      ];
    case 'table': {
      const rows: TiptapNode[] = [];
      if (block.header !== null) {
        rows.push(mapTableRow(block.header, 'tableHeader', options));
      }
      for (const row of block.rows) {
        rows.push(mapTableRow(row, 'tableCell', options));
      }
      if (rows.length === 0) return [];
      return [node('table', extraAttrs(block.attrs), rows)];
    }
    case 'image':
      return [
        node('image', {
          src: block.src,
          alt: block.alt,
          ...extraAttrs(block.attrs),
        }),
      ];
    case 'mathBlock':
      // No maths node in this schema: the formula is kept as its own source,
      // which is exactly what the reader typed and still says everything.
      if (options.hasNode?.('math') === false) {
        return [
          node('paragraph', extraAttrs(block.attrs), [
            { type: 'text', text: `$$${block.latex}$$` },
          ]),
        ];
      }
      return [node('math', { latex: block.latex, ...extraAttrs(block.attrs) })];
    case 'code': {
      /*
       * The body is ONE text node, newlines and all.
       *
       * `codeBlock` is `content: 'text*'` with `code: true`, so the document
       * model stores a program the way a file does — a single run of
       * characters — rather than as a paragraph per line. That is what lets
       * the indentation survive the trip, and it is why this case cannot go
       * through `contentWithSticker` or any other inline pass.
       *
       * An empty fence gets NO text child: a zero-length text node is invalid
       * in ProseMirror and `nodeFromJSON` throws on one, which would turn a
       * reader's stray ```` ``` ```` into a page that will not open.
       */
      const language =
        block.lang ?? (typeof block.rawLang === 'string' ? block.rawLang : null);
      return [
        node(
          'codeBlock',
          { language, ...extraAttrs(block.attrs) },
          block.code === '' ? [] : [{ type: 'text', text: block.code }],
        ),
      ];
    }
    case 'container':
      return mapContainer(block, options);
    case 'diagram':
      return [mapDiagram(block, options, false)];
    case 'fetchDirective':
      // Image fetching resolves at a later integration stage — degrade to a
      // visible placeholder paragraph for now.
      return [
        node('paragraph', {}, [
          { type: 'text', text: `fetch: ${block.query}` },
        ]),
      ];
  }
}

function mapBlocks(blocks: Block[], options: ToTiptapOptions): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const block of blocks) {
    try {
      out.push(...mapBlock(block, options));
    } catch {
      // Belt-and-braces: a mapping bug must never lose the note.
      const text = 'content' in block ? inlineText(block.content) : '';
      out.push(
        node('paragraph', {}, [
          { type: 'text', text: text !== '' ? text : '[unsupported block]' },
        ]),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * Map a parsed ScriptDoc onto TipTap document JSON. Total: degrades, never
 * throws. Frontmatter is kept wholesale in `attrs.scriptFrontmatter` (for
 * export round-trips) and `paper:` additionally maps onto `pageStyle`.
 */
export function scriptDocToTiptap(
  doc: ScriptDoc,
  options: ToTiptapOptions = {},
): PageDoc {
  const attrs: Record<string, unknown> = {};
  const paper = doc.frontmatter.paper;
  if (paper !== undefined && PAPER_TO_PAGE_STYLE[paper] !== undefined) {
    attrs.pageStyle = PAPER_TO_PAGE_STYLE[paper];
  }
  if (Object.keys(doc.frontmatter).length > 0) {
    attrs.scriptFrontmatter = { ...doc.frontmatter };
  }
  const out: PageDoc = { type: 'doc', content: mapBlocks(doc.blocks, options) };
  if (Object.keys(attrs).length > 0) out.attrs = attrs;
  return out;
}
