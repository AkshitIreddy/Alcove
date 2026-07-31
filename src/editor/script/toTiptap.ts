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
): void {
  for (const n of nodes) {
    switch (n.kind) {
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
        pushInlines(n.children, out, [...marks, { type: 'bold' }]);
        break;
      case 'em':
        pushInlines(n.children, out, [...marks, { type: 'italic' }]);
        break;
      case 'strike':
        pushInlines(n.children, out, [...marks, { type: 'strike' }]);
        break;
      case 'highlight': {
        const mark: TiptapMark = { type: 'highlight' };
        if (typeof n.attrs?.color === 'string') {
          mark.attrs = { color: n.attrs.color };
        }
        pushInlines(n.children, out, [...marks, mark]);
        break;
      }
      case 'link':
        pushInlines(n.children, out, [
          ...marks,
          { type: 'link', attrs: { href: n.href } },
        ]);
        break;
      case 'sup':
      case 'sub':
        // No sub/superscript mark installed — degrade to plain text.
        pushInlines(n.children, out, marks);
        break;
    }
  }
}

function inlineNodes(content: Inline[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  pushInlines(content, out, []);
  return out;
}

function stickerNode(stickerId: StickerId): TiptapNode {
  return { type: 'sticker', attrs: { stickerId } };
}

/** Flatten an inline tree to plain text (degradation paths). */
function inlineText(content: Inline[]): string {
  let out = '';
  for (const n of content) {
    if (n.kind === 'text' || n.kind === 'code') out += n.text;
    else out += inlineText(n.children);
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
): { content: TiptapNode[]; exclude: string[] } {
  const sticker =
    typeof attrs.sticker === 'string' ? mapStickerName(attrs.sticker) : null;
  const nodes = inlineNodes(content);
  if (sticker !== null) nodes.push(stickerNode(sticker));
  return { content: nodes, exclude: sticker !== null ? ['sticker'] : [] };
}

function mapListItems(
  items: ListItem[],
  listType: 'bulletList' | 'orderedList' | 'taskList',
): TiptapNode[] {
  const itemType = listType === 'taskList' ? 'taskItem' : 'listItem';
  return items.map((item) => {
    const body: TiptapNode[] = [
      node('paragraph', {}, inlineNodes(item.content)),
    ];
    if (item.children.length > 0) {
      body.push(node(listType, {}, mapListItems(item.children, listType)));
    }
    const attrs: Record<string, unknown> =
      itemType === 'taskItem' ? { checked: item.checked === true } : {};
    return node(itemType, attrs, body);
  });
}

function mapTableRow(row: TableRow, cellType: string): TiptapNode {
  return node(
    'tableRow',
    {},
    row.cells.map((cell) =>
      node(cellType, {}, [node('paragraph', {}, inlineNodes(cell))]),
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
        );
        out.push(node('paragraph', extraAttrs(child.attrs, exclude), content));
        break;
      }
      case 'heading':
      case 'quote':
        out.push(node('paragraph', {}, inlineNodes(child.content)));
        break;
      case 'list':
      case 'taskList': {
        const flat = (items: ListItem[]): void => {
          for (const item of items) {
            out.push(node('paragraph', {}, inlineNodes(item.content)));
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
    case 'banner': {
      if (!hasContainerNode(block.name, options)) {
        return fallbackContainer(block, options);
      }
      const color = isWashName(block.attrs.color)
        ? { color: block.attrs.color }
        : {};
      return [
        node(
          block.name,
          { ...color, ...extraAttrs(block.attrs, 'color' in color ? ['color'] : []) },
          blockChildren(block.children, options),
        ),
      ];
    }

    case 'card': {
      if (!hasContainerNode('card', options)) {
        return fallbackContainer(block, options);
      }
      const title =
        typeof block.attrs.title === 'string' && block.attrs.title !== ''
          ? { title: block.attrs.title }
          : {};
      return [
        node(
          'card',
          { ...title, ...extraAttrs(block.attrs, 'title' in title ? ['title'] : []) },
          blockChildren(block.children, options),
        ),
      ];
    }

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
      );
      return [node('paragraph', extraAttrs(block.attrs, exclude), content)];
    }
    case 'quote': {
      const { content, exclude } = contentWithSticker(
        block.content,
        block.attrs,
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
          mapListItems(block.items, listType),
        ),
      ];
    }
    case 'taskList':
      return [
        node(
          'taskList',
          extraAttrs(block.attrs),
          mapListItems(block.items, 'taskList'),
        ),
      ];
    case 'table': {
      const rows: TiptapNode[] = [];
      if (block.header !== null) {
        rows.push(mapTableRow(block.header, 'tableHeader'));
      }
      for (const row of block.rows) rows.push(mapTableRow(row, 'tableCell'));
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
