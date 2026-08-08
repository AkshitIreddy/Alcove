/**
 * Postcard and ledger are stationery with two independently editable regions.
 *
 * Both store exactly two `col` children. `normalizeStationerySplits` upgrades
 * the old single-container shape before TipTap parses a stored page, so making
 * the schema honest does not strand existing notebooks.
 */
import { Extension, type CommandProps, type JSONContent } from '@tiptap/core';

export const STATIONERY_SPLIT_TYPES = ['postcard', 'ledger'] as const;
export type StationerySplitType = (typeof STATIONERY_SPLIT_TYPES)[number];

interface JsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
  [key: string]: unknown;
}

function isJsonNode(value: unknown): value is JsonNode {
  return value !== null && typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string';
}

export function isStationerySplitType(
  name: string,
): name is StationerySplitType {
  return (STATIONERY_SPLIT_TYPES as readonly string[]).includes(name);
}

const emptyParagraph = (): JsonNode => ({ type: 'paragraph' });

function column(
  blocks: readonly unknown[],
  attrs?: Record<string, unknown>,
): JsonNode {
  return {
    type: 'col',
    ...(attrs === undefined ? {} : { attrs }),
    content: blocks.length > 0 ? [...blocks] : [emptyParagraph()],
  };
}

/**
 * Upgrade legacy postcard/ledger JSON to the strict `col col` shape.
 *
 * Direct children belong to the message/description side. Existing columns
 * are preserved; surplus columns are merged into the second rather than
 * dropping anything. The walk is total and never mutates the input.
 */
export function normalizeStationerySplits(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStationerySplits);
  if (!isJsonNode(value)) return value;

  const rawChildren = Array.isArray(value.content) ? value.content : [];
  const children = rawChildren.map(normalizeStationerySplits);
  if (!isStationerySplitType(value.type)) {
    return children.length > 0 || value.content !== undefined
      ? { ...value, content: children }
      : { ...value };
  }

  const columns: JsonNode[] = [];
  const loose: unknown[] = [];
  for (const child of children) {
    if (isJsonNode(child) && child.type === 'col') columns.push(child);
    else loose.push(child);
  }

  const left = columns[0];
  const right = columns[1];
  const leftContent = [
    ...loose,
    ...(Array.isArray(left?.content) ? left.content : []),
  ];
  const rightContent = Array.isArray(right?.content) ? [...right.content] : [];
  for (const extra of columns.slice(2)) {
    if (Array.isArray(extra.content)) rightContent.push(...extra.content);
  }

  return {
    ...value,
    content: [
      column(leftContent, left?.attrs),
      column(rightContent, right?.attrs),
    ],
  };
}

function insertStationery(type: StationerySplitType) {
  return ({ commands }: CommandProps): boolean =>
    commands.insertContent({
      type,
      content: [column([]), column([])],
    } as JSONContent);
}

export const StationerySplit = Extension.create({
  name: 'stationerySplit',

  addCommands() {
    return {
      insertPostcard: () => insertStationery('postcard'),
      insertLedger: () => insertStationery('ledger'),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    stationerySplit: {
      insertPostcard: () => ReturnType;
      insertLedger: () => ReturnType;
    };
  }
}
