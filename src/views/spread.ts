/**
 * src/views/spread.ts — pure spread logic for the two-page BookView.
 *
 * Everything the spread host needs to *decide* lives here, DOM-free, so it
 * runs under plain-node vitest (tests/spread.test.ts): ord↔spread math, the
 * adjacent-page id window handed to FlipSurface, flip gating, the
 * auto-create-on-forward-flip decision, the keyboard guard and the starter
 * doc for new pages.
 *
 * Conventions
 * - "slot" is a page's position in the book's ord-ascending page list
 *   (contiguous 0-based; equals `ord` for books grown via createPage).
 * - Spread `i` shows slot `2i` on the left leaf and `2i + 1` on the right.
 */

import type { PageDoc, PageStyle } from '../data/types';
import type { FlipDirection } from '../flip/math';

/** Ids for the current spread plus both neighbours; null = no page there. */
export interface SpreadIds {
  left: string | null;
  right: string | null;
  /** Pages behind the current right leaf ('next' flip). */
  nextLeft: string | null;
  nextRight: string | null;
  /** Pages before the current left leaf ('prev' flip). */
  prevLeft: string | null;
  prevRight: string | null;
}

/* ----------------------------------------------------------------------------
   ord ↔ spread math
   -------------------------------------------------------------------------- */

/** Slot shown on the left leaf of spread `spreadIndex`. */
export const leftSlot = (spreadIndex: number): number => 2 * spreadIndex;

/** Slot shown on the right leaf of spread `spreadIndex`. */
export const rightSlot = (spreadIndex: number): number => 2 * spreadIndex + 1;

/** Which spread a slot lives on. */
export const spreadOfSlot = (slot: number): number => Math.floor(slot / 2);

/** Number of spreads a book occupies (an empty book still opens one). */
export const spreadCount = (pageCount: number): number =>
  Math.max(1, Math.ceil(pageCount / 2));

/** Index of the last spread. */
export const lastSpreadIndex = (pageCount: number): number =>
  spreadCount(pageCount) - 1;

/** True when `spreadIndex` is (at or past) the book's final spread. */
export const isLastSpread = (pageCount: number, spreadIndex: number): boolean =>
  spreadIndex >= lastSpreadIndex(pageCount);

/**
 * The six-page id window FlipSurface needs for spread `spreadIndex`:
 * current left/right plus the two ids behind the right leaf and the two
 * before the left leaf. Nulls where the book simply has no page.
 */
export function spreadPageIds(
  pageIds: readonly string[],
  spreadIndex: number,
): SpreadIds {
  const at = (slot: number): string | null =>
    slot >= 0 && slot < pageIds.length ? pageIds[slot] : null;
  const left = leftSlot(spreadIndex);
  return {
    left: at(left),
    right: at(left + 1),
    nextLeft: at(left + 2),
    nextRight: at(left + 3),
    prevLeft: at(left - 2),
    prevRight: at(left - 1),
  };
}

/* ----------------------------------------------------------------------------
   Flip gating + auto-create decision
   -------------------------------------------------------------------------- */

/**
 * Direction gating for the spread.
 * - 'prev' needs a spread before this one.
 * - 'next' is free while pages exist ahead; on the last spread it is allowed
 *   only when the right leaf holds ink (`rightLeafHasContent`) — that flip
 *   auto-creates the next page (see shouldAutoCreatePage). A content-less or
 *   absent right leaf keeps the book closed at its end.
 *
 * `rightLeafHasContent` must already fold in existence: a null right page
 * (cream blank face) is never "content".
 */
export function canFlipSpread(
  pageCount: number,
  spreadIndex: number,
  direction: FlipDirection,
  rightLeafHasContent: boolean,
): boolean {
  if (direction === 'prev') return spreadIndex > 0;
  if (!isLastSpread(pageCount, spreadIndex)) return true;
  return rightLeafHasContent;
}

/**
 * Whether committing a flip in `direction` from `spreadIndex` must create
 * the book's next page (ord = append): only forward, only off the last
 * spread, and only when the right leaf has content to flip away from.
 */
export function shouldAutoCreatePage(
  pageCount: number,
  spreadIndex: number,
  direction: FlipDirection,
  rightLeafHasContent: boolean,
): boolean {
  return (
    direction === 'next' &&
    isLastSpread(pageCount, spreadIndex) &&
    rightLeafHasContent
  );
}

/* ----------------------------------------------------------------------------
   Doc content probe + starter doc
   -------------------------------------------------------------------------- */

function nodeHasInk(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  const { type, text, content } = node as {
    type?: unknown;
    text?: unknown;
    content?: unknown;
  };
  if (typeof text === 'string' && text.trim() !== '') return true;
  // Any non-paragraph block (image, table, callout, hr…) counts as content
  // even when it carries no text.
  if (typeof type === 'string' && type !== 'paragraph' && type !== 'text') {
    return true;
  }
  return Array.isArray(content) && content.some(nodeHasInk);
}

/**
 * True when a stored doc holds actual content. Empty docs and docs made only
 * of empty paragraphs (the shape normalizePageDoc gives a fresh page) are
 * "blank"; any text, or any non-paragraph node, is ink.
 */
export function docHasContent(doc: PageDoc | null | undefined): boolean {
  if (!doc || !Array.isArray(doc.content)) return false;
  return doc.content.some(nodeHasInk);
}

/**
 * Starter doc for a page created from the spread ("+ page" / auto-create):
 * empty content, page style inherited from the book's page defaults (falling
 * back to settings.pageStyleDefault at the call site). An explicit
 * `lineHeightPx` (the book's per-page line spacing default) is stamped into
 * the doc attrs so the editor opens with the book's spacing.
 */
export function newPageDoc(pageStyle: PageStyle, lineHeightPx?: number): PageDoc {
  const attrs: Record<string, unknown> = { pageStyle };
  if (typeof lineHeightPx === 'number' && Number.isFinite(lineHeightPx)) {
    attrs.lineHeightPx = Math.min(64, Math.max(24, Math.round(lineHeightPx)));
  }
  return { type: 'doc', attrs, content: [] };
}

/* ----------------------------------------------------------------------------
   Pagination overflow — merging carried blocks into the next page's doc
   -------------------------------------------------------------------------- */

/**
 * Prepend overflowed top-level blocks to the START of a page doc (pagination
 * contract: BookView appends the blocks PageEditor removed to the next
 * page's doc). Pure — returns a new doc, never mutates.
 *
 * - A missing doc becomes a fresh doc holding just the carried blocks
 *   (attrs from `fallbackAttrs`, e.g. the book's page defaults).
 * - A doc whose content is blank (empty, or only empty paragraphs — the
 *   normalizePageDoc starter shape) is REPLACED by the carried blocks, so
 *   carrying into a fresh page never leaves a stray empty paragraph between
 *   carried batches.
 */
export function prependBlocksToDoc(
  doc: PageDoc | null | undefined,
  blocks: readonly unknown[],
  fallbackAttrs?: Record<string, unknown>,
): PageDoc {
  if (!doc) {
    return {
      type: 'doc',
      ...(fallbackAttrs ? { attrs: { ...fallbackAttrs } } : {}),
      content: [...blocks],
    };
  }
  const existing = Array.isArray(doc.content) ? doc.content : [];
  const keep = docHasContent(doc) ? existing : [];
  return { ...doc, content: [...blocks, ...keep] };
}

/* ----------------------------------------------------------------------------
   Keyboard guard
   -------------------------------------------------------------------------- */

/**
 * Map a keydown to a flip direction. `isTyping` is the caller's guard —
 * true when document.activeElement sits inside `.nb-prose` or any editable
 * control (input/textarea/contenteditable) — and always wins: arrows must
 * keep moving the caret, never the page.
 */
export function arrowFlipAction(
  key: string,
  isTyping: boolean,
): FlipDirection | null {
  if (isTyping) return null;
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowLeft') return 'prev';
  return null;
}
