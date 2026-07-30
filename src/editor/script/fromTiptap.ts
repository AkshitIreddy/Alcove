/**
 * TipTap document JSON → Notebook Script (export path).
 *
 * `tiptapToScriptDoc(json)` is the inverse of `scriptDocToTiptap` for the
 * supported subset; `docToScript(json)` prints it with the canonical printer
 * from src/script. Both are total: malformed nodes degrade to plain
 * paragraphs, never throw.
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
  TableAlign,
  TableRow,
} from '../../script/types';
import type { PageDoc } from '../../data/types';
import { print } from '../../script';
import { CONTAINER_NAMES, DIAGRAM_LANGS } from '../../script/vocab';
import type { TiptapMark, TiptapNode } from './toTiptap';

// ---------------------------------------------------------------------------
// Guards & small helpers
// ---------------------------------------------------------------------------

const ZERO = { srcStart: 0, srcEnd: 0 } as const;

/** Document `pageStyle` attr → frontmatter `paper:`. */
const PAGE_STYLE_TO_PAPER: Record<string, string> = {
  blank: 'cream',
  grid: 'grid',
  dotted: 'dotted',
  ruled: 'lined',
};

function isNode(value: unknown): value is TiptapNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function childNodes(node: TiptapNode): TiptapNode[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

function nodeAttrs(node: TiptapNode): Record<string, unknown> {
  return node.attrs !== null && typeof node.attrs === 'object'
    ? (node.attrs as Record<string, unknown>)
    : {};
}

function isAttrValue(value: unknown): value is AttrValue {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** Primitive attrs minus excluded keys (nulls — unset defaults — dropped). */
function attrsFrom(
  attrs: Record<string, unknown>,
  exclude: readonly string[] = [],
): Attrs {
  const out: Attrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!exclude.includes(key) && isAttrValue(value)) out[key] = value;
  }
  return out;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((v) => typeof v === 'string');
}

// ---------------------------------------------------------------------------
// Inline reconstruction
// ---------------------------------------------------------------------------

function findMark(marks: TiptapMark[], type: string): TiptapMark | undefined {
  return marks.find((m) => m !== null && typeof m === 'object' && m.type === type);
}

/** Wrap a text run's marks into nested inline nodes (canonical order). */
function inlineFromText(node: TiptapNode): Inline {
  const text = typeof node.text === 'string' ? node.text : '';
  const marks = Array.isArray(node.marks) ? node.marks : [];
  let inline: Inline =
    findMark(marks, 'code') !== undefined
      ? { kind: 'code', text, ...ZERO }
      : { kind: 'text', text, ...ZERO };
  if (findMark(marks, 'italic') !== undefined) {
    inline = { kind: 'em', children: [inline], ...ZERO };
  }
  if (findMark(marks, 'bold') !== undefined) {
    inline = { kind: 'strong', children: [inline], ...ZERO };
  }
  if (findMark(marks, 'strike') !== undefined) {
    inline = { kind: 'strike', children: [inline], ...ZERO };
  }
  const highlight = findMark(marks, 'highlight');
  if (highlight !== undefined) {
    const color = (highlight.attrs as Record<string, unknown> | undefined)?.color;
    inline = {
      kind: 'highlight',
      children: [inline],
      ...(typeof color === 'string' && color !== ''
        ? { attrs: { color } }
        : {}),
      ...ZERO,
    };
  }
  const link = findMark(marks, 'link');
  if (link !== undefined) {
    const href = (link.attrs as Record<string, unknown> | undefined)?.href;
    inline = {
      kind: 'link',
      href: typeof href === 'string' ? href : '',
      children: [inline],
      ...ZERO,
    };
  }
  return inline;
}

interface InlineResult {
  inlines: Inline[];
  /** Sticker id of a trailing inline sticker node, if any. */
  sticker: string | null;
}

function inlinesFrom(content: TiptapNode[]): InlineResult {
  const nodes = [...content];
  let sticker: string | null = null;
  const last = nodes[nodes.length - 1];
  if (last !== undefined && last.type === 'sticker') {
    const id = nodeAttrs(last).stickerId;
    sticker = typeof id === 'string' ? id : 'star';
    nodes.pop();
  }
  const inlines: Inline[] = [];
  for (const n of nodes) {
    if (n.type === 'text' && typeof n.text === 'string' && n.text !== '') {
      inlines.push(inlineFromText(n));
    } else if (n.type === 'hardBreak') {
      inlines.push({ kind: 'text', text: ' ', ...ZERO });
    }
    // Mid-run stickers and unknown inline atoms have no script form — dropped.
  }
  return { inlines, sticker };
}

/** Inlines of all child paragraphs joined with single spaces. */
function joinedParagraphInlines(paragraphs: TiptapNode[]): InlineResult {
  const inlines: Inline[] = [];
  let sticker: string | null = null;
  paragraphs.forEach((p, index) => {
    const res = inlinesFrom(childNodes(p));
    if (index > 0 && res.inlines.length > 0 && inlines.length > 0) {
      inlines.push({ kind: 'text', text: ' ', ...ZERO });
    }
    inlines.push(...res.inlines);
    if (res.sticker !== null) sticker = res.sticker;
  });
  return { inlines, sticker };
}

/** Deep plain-text of a node (last-resort degradation). */
function flattenText(node: TiptapNode): string {
  if (typeof node.text === 'string') return node.text;
  return childNodes(node)
    .map(flattenText)
    .filter((t) => t !== '')
    .join(' ');
}

// ---------------------------------------------------------------------------
// Diagram payload restore
// ---------------------------------------------------------------------------

function restoreDiagram(payload: unknown): DiagramBlock | null {
  try {
    const parsed: unknown =
      typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (parsed === null || typeof parsed !== 'object') return null;
    const block = parsed as Record<string, unknown>;
    if (block.kind !== 'diagram') return null;
    if (!(DIAGRAM_LANGS as readonly string[]).includes(String(block.lang))) {
      return null;
    }
    const lang = block.lang as DiagramBlock['lang'];
    const shapeOk =
      lang === 'tree' || lang === 'mindmap'
        ? Array.isArray(block.roots)
        : lang === 'timeline'
          ? Array.isArray(block.entries)
          : block.graph !== null && typeof block.graph === 'object';
    if (!shapeOk) return null;
    if (block.attrs === null || typeof block.attrs !== 'object') {
      block.attrs = {};
    }
    if (typeof block.srcStart !== 'number') block.srcStart = 0;
    if (typeof block.srcEnd !== 'number') block.srcEnd = 0;
    return block as unknown as DiagramBlock;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Containers (callout + fallback markers)
// ---------------------------------------------------------------------------

const CALLOUT_MARKER_KEYS = ['icon', 'tint', 'containerName', 'containerAttrs'];

/** Editor tint → callout variant (only the unambiguous variant tints). */
const TINT_TO_VARIANT: Record<string, string> = {
  sky: 'info',
  moss: 'tip',
  terracotta: 'warn',
};

function containerFromName(name: string): {
  name: ContainerName;
  rawName?: string;
} {
  if ((CONTAINER_NAMES as readonly string[]).includes(name)) {
    return { name: name as ContainerName };
  }
  return { name: 'generic', rawName: name };
}

function calloutToContainer(node: TiptapNode): ContainerBlock {
  const attrs = nodeAttrs(node);
  const children = childNodes(node).flatMap(blockFromNode);
  const markerName = attrs.containerName;

  if (typeof markerName === 'string' && markerName !== '') {
    // Fallback container round-trip: restore name + original attrs.
    const resolved = containerFromName(markerName);
    const raw = attrs.containerAttrs;
    const restored =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? attrsFrom(raw as Record<string, unknown>)
        : {};
    return {
      kind: 'container',
      name: resolved.name,
      ...(resolved.rawName !== undefined ? { rawName: resolved.rawName } : {}),
      children,
      attrs: restored,
      ...ZERO,
    };
  }

  const extras = attrsFrom(attrs, CALLOUT_MARKER_KEYS);
  if (extras.variant === undefined && extras.color === undefined) {
    // Live-editor callout: derive attrs from the tint the user picked.
    const tint = typeof attrs.tint === 'string' ? attrs.tint : 'amber';
    const variant = TINT_TO_VARIANT[tint];
    if (variant !== undefined) extras.variant = variant;
    else if (tint !== 'amber') extras.color = tint;
  }
  return {
    kind: 'container',
    name: 'callout',
    children,
    attrs: extras,
    ...ZERO,
  };
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function listItemsFrom(node: TiptapNode, task: boolean): ListItem[] {
  const items: ListItem[] = [];
  for (const item of childNodes(node)) {
    if (item.type !== 'listItem' && item.type !== 'taskItem') continue;
    const body = childNodes(item);
    const paragraphs = body.filter((c) => c.type === 'paragraph');
    const nested = body.filter(
      (c) =>
        c.type === 'bulletList' ||
        c.type === 'orderedList' ||
        c.type === 'taskList',
    );
    const { inlines } = joinedParagraphInlines(paragraphs);
    const checked = task
      ? nodeAttrs(item).checked === true
      : undefined;
    items.push({
      content: inlines,
      children: nested.flatMap((n) => listItemsFrom(n, task)),
      ...(checked !== undefined ? { checked } : {}),
      ...ZERO,
    });
  }
  return items;
}

function tableFrom(node: TiptapNode): Block {
  const rowNodes = childNodes(node).filter((r) => r.type === 'tableRow');
  const toRow = (row: TiptapNode): TableRow => ({
    cells: childNodes(row).map(
      (cell) =>
        joinedParagraphInlines(
          childNodes(cell).filter((c) => c.type === 'paragraph'),
        ).inlines,
    ),
    ...ZERO,
  });
  let header: TableRow | null = null;
  let rows = rowNodes;
  const first = rowNodes[0];
  if (
    first !== undefined &&
    childNodes(first).length > 0 &&
    childNodes(first).every((cell) => cell.type === 'tableHeader')
  ) {
    header = toRow(first);
    rows = rowNodes.slice(1);
  }
  const align: TableAlign[] =
    header !== null ? header.cells.map(() => null) : [];
  return {
    kind: 'table',
    header,
    align,
    rows: rows.map(toRow),
    attrs: attrsFrom(nodeAttrs(node)),
    ...ZERO,
  };
}

function paragraphLike(
  node: TiptapNode,
  kind: 'paragraph' | 'heading' | 'quote',
  extraExclude: readonly string[] = [],
): Block {
  const attrs = nodeAttrs(node);
  const source =
    kind === 'quote'
      ? joinedParagraphInlines(
          childNodes(node).filter((c) => c.type === 'paragraph'),
        )
      : inlinesFrom(childNodes(node));
  const scriptAttrs = attrsFrom(attrs, ['level', ...extraExclude]);
  if (source.sticker !== null) scriptAttrs.sticker = source.sticker;
  if (kind === 'heading') {
    const rawLevel = attrs.level;
    const level =
      typeof rawLevel === 'number' && rawLevel >= 1 && rawLevel <= 3
        ? (rawLevel as 1 | 2 | 3)
        : rawLevel === 4
          ? 3
          : 1;
    return {
      kind: 'heading',
      level,
      content: source.inlines,
      attrs: scriptAttrs,
      ...ZERO,
    };
  }
  if (kind === 'quote') {
    return {
      kind: 'quote',
      content: source.inlines,
      attrs: scriptAttrs,
      ...ZERO,
    };
  }
  return {
    kind: 'paragraph',
    content: source.inlines,
    attrs: scriptAttrs,
    ...ZERO,
  };
}

function blockFromNode(node: TiptapNode): Block[] {
  try {
    switch (node.type) {
      case 'paragraph': {
        const diagram = restoreDiagram(nodeAttrs(node)['data-diagram']);
        if (diagram !== null) return [diagram];
        return [paragraphLike(node, 'paragraph', ['data-diagram'])];
      }
      case 'heading':
        return [paragraphLike(node, 'heading')];
      case 'blockquote':
        return [paragraphLike(node, 'quote')];
      case 'horizontalRule':
        return [{ kind: 'divider', attrs: attrsFrom(nodeAttrs(node)), ...ZERO }];
      case 'bulletList':
      case 'orderedList':
        return [
          {
            kind: 'list',
            ordered: node.type === 'orderedList',
            items: listItemsFrom(node, false),
            attrs: attrsFrom(nodeAttrs(node)),
            ...ZERO,
          },
        ];
      case 'taskList':
        return [
          {
            kind: 'taskList',
            items: listItemsFrom(node, true),
            attrs: attrsFrom(nodeAttrs(node)),
            ...ZERO,
          },
        ];
      case 'table':
        return [tableFrom(node)];
      case 'image': {
        const attrs = nodeAttrs(node);
        return [
          {
            kind: 'image',
            src: typeof attrs.src === 'string' ? attrs.src : '',
            alt: typeof attrs.alt === 'string' ? attrs.alt : '',
            attrs: attrsFrom(attrs, ['src', 'alt', 'title', 'widthPct']),
            ...ZERO,
          },
        ];
      }
      case 'imageRow': {
        const children = childNodes(node)
          .filter((c) => c.type === 'image')
          .flatMap(blockFromNode);
        return [
          {
            kind: 'container',
            name: 'image-row',
            children,
            attrs: attrsFrom(nodeAttrs(node)),
            ...ZERO,
          },
        ];
      }
      case 'callout':
        return [calloutToContainer(node)];
      // Real container nodes — names match the script vocab verbatim.
      case 'sticky-note':
      case 'polaroid':
      case 'washi-box':
      case 'card':
      case 'quote-card':
      case 'spoiler':
      case 'banner': {
        const raw = nodeAttrs(node);
        const attrs = attrsFrom(raw, ['title']);
        if (node.type === 'card' && typeof raw.title === 'string' && raw.title !== '') {
          attrs.title = raw.title;
        }
        return [
          {
            kind: 'container',
            name: node.type as ContainerName,
            children: childNodes(node).flatMap(blockFromNode),
            attrs,
            ...ZERO,
          },
        ];
      }
      case 'columns': {
        const cols: Block[] = childNodes(node)
          .filter((child) => child.type === 'col')
          .map((child) => ({
            kind: 'container' as const,
            name: 'col' as const,
            children: childNodes(child).flatMap(blockFromNode),
            attrs: attrsFrom(nodeAttrs(child)),
            ...ZERO,
          }));
        return [
          {
            kind: 'container',
            name: 'columns',
            children: cols,
            attrs: attrsFrom(nodeAttrs(node)),
            ...ZERO,
          },
        ];
      }
      case 'col':
        // A col outside columns has no script form of its own — flatten.
        return childNodes(node).flatMap(blockFromNode);
      case 'details': {
        const body = childNodes(node);
        const summary = body.find((c) => c.type === 'detailsSummary');
        const content = body.find((c) => c.type === 'detailsContent');
        const children: Block[] = [];
        const summaryText = summary !== undefined ? flattenText(summary) : '';
        if (summaryText.trim() !== '') {
          children.push({
            kind: 'paragraph',
            content: [
              {
                kind: 'strong',
                children: [{ kind: 'text', text: summaryText, ...ZERO }],
                ...ZERO,
              },
            ],
            attrs: {},
            ...ZERO,
          });
        }
        if (content !== undefined) {
          children.push(...childNodes(content).flatMap(blockFromNode));
        }
        return [
          {
            kind: 'container',
            name: 'spoiler',
            children,
            attrs: attrsFrom(nodeAttrs(node), ['open']),
            ...ZERO,
          },
        ];
      }
      case 'codeBlock': {
        // Script has no plain code fence — mirror the parser's treatment of
        // unknown fences: a generic box with one paragraph per line.
        const attrs = nodeAttrs(node);
        const language =
          typeof attrs.language === 'string' && attrs.language !== ''
            ? attrs.language
            : 'code';
        const text = childNodes(node)
          .map((c) => (typeof c.text === 'string' ? c.text : ''))
          .join('');
        const children: Block[] = text
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => ({
            kind: 'paragraph',
            content: [{ kind: 'text', text: line, ...ZERO }],
            attrs: {},
            ...ZERO,
          }));
        return [
          {
            kind: 'container',
            name: 'generic',
            rawName: language,
            children,
            attrs: attrsFrom(attrs, ['language']),
            ...ZERO,
          },
        ];
      }
      case 'diagram': {
        const diagram = restoreDiagram(nodeAttrs(node).data);
        if (diagram !== null) return [diagram];
        return [];
      }
      default: {
        const text = flattenText(node);
        if (text.trim() === '') return [];
        return [
          {
            kind: 'paragraph',
            content: [{ kind: 'text', text, ...ZERO }],
            attrs: {},
            ...ZERO,
          },
        ];
      }
    }
  } catch {
    const text = flattenText(node);
    if (text.trim() === '') return [];
    return [
      {
        kind: 'paragraph',
        content: [{ kind: 'text', text, ...ZERO }],
        attrs: {},
        ...ZERO,
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/** Inverse of scriptDocToTiptap for the supported subset. Total. */
export function tiptapToScriptDoc(json: PageDoc): ScriptDoc {
  const frontmatter: Record<string, string> = {};
  const attrs =
    json.attrs !== null && typeof json.attrs === 'object'
      ? (json.attrs as Record<string, unknown>)
      : {};
  if (isStringRecord(attrs.scriptFrontmatter)) {
    Object.assign(frontmatter, attrs.scriptFrontmatter);
  } else if (typeof attrs.pageStyle === 'string' && attrs.pageStyle !== 'ruled') {
    const paper = PAGE_STYLE_TO_PAPER[attrs.pageStyle];
    if (paper !== undefined) frontmatter.paper = paper;
  }
  const content = Array.isArray(json.content)
    ? json.content.filter(isNode)
    : [];
  const blocks = content.flatMap(blockFromNode);
  return { frontmatter, blocks, diagnostics: [] };
}

/** Export a TipTap document as canonical Notebook Script text. */
export function docToScript(json: PageDoc): string {
  return print(tiptapToScriptDoc(json));
}
