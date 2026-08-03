/**
 * src/editor/effects/freePlacement.ts — a sticker placed ON the page rather
 * than IN the sentence.
 *
 * The reader's words:
 *
 *   "give user the option to drag and place stickers or any effects, like i
 *    mean click on it and put it anywhere on the page, not caring about where
 *    lines are"
 *
 * A sticker used to be an inline atom and nothing else: it sat between two
 * words, moved when they moved, and could only ever be where a caret could be.
 * A free-placed sticker keeps the same node — same id, same scale, same tilt —
 * and adds three attributes: `placement: 'free'`, and an `x`/`y` in PERCENT of
 * the leaf's own box. It is drawn into the leaf's `.nb-free-layer`, above the
 * ruling and above the text, and it answers to the pointer.
 *
 * ## THE PAGINATION CONTRACT (this is the part that has to be deliberate)
 *
 * Pages never scroll; overflow is peeled off the END of a page and carried to
 * the next one (`src/editor/pagination.ts` → `BookView.carryOverflow`). So the
 * question a free-placed sticker has to answer is: *what happens to it when the
 * text under it reflows?*
 *
 * The answer is: **nothing. A free-placed sticker belongs to the PAGE, not to
 * the paragraph.** Text can grow, carry onto the next leaf, come back — the
 * sticker stays at the same x/y on the same leaf. That is what "not caring
 * about where lines are" has to mean, and it is the only rule a reader can hold
 * in their head.
 *
 * Two mechanisms hold it up, and both are needed:
 *
 *  1. **It is anchored at the head of the page's FIRST top-level block.**
 *     `trailingOverflowCount` only ever removes TRAILING blocks and always
 *     leaves at least one, so the first block is the one place on a page that
 *     the carry provably cannot reach. {@link freeStickerNode} builds the node
 *     and `BookView` inserts it there, wherever on the leaf the reader clicked.
 *  2. **The carry rescues any that slipped anyway.** A carry PREPENDS blocks to
 *     the next page, so a leaf's first block is not first forever; enough
 *     writing above it and yesterday's anchor can end up in the tail. So every
 *     carry runs {@link splitFreeStickers} over the blocks on their way out,
 *     keeps the free-placed stickers behind, and re-anchors them. The blocks
 *     travel; the stickers do not.
 *
 * The zero-width inline anchor is also why the sticker costs pagination
 * nothing: it contributes no height to the block it lives in, so a page holds
 * exactly as much text with a hundred stickers on it as with none.
 *
 * Everything here is DOM-free and deterministic so `tests/free-placement.test.ts`
 * can run it in node.
 */
import { createSignal } from 'solid-js';
import type { StickerId } from '../nodes/stickers';

/* ========================================================================== *
 *                              the attributes                                *
 * ========================================================================== */

/** Where a sticker lives: in the text flow, or pinned to the leaf. */
export type StickerPlacement = 'inline' | 'free';

export function isStickerPlacement(value: unknown): value is StickerPlacement {
  return value === 'inline' || value === 'free';
}

/**
 * How close to the leaf's edge a free sticker may be pinned, in percent.
 *
 * Not zero: a sticker centred exactly on the edge is half outside the page and
 * `overflow: hidden` on the leaf eats the other half, which reads as a bug
 * rather than as a choice. Two percent of a page is about a finger-width.
 */
export const FREE_EDGE_MARGIN_PCT = 2;

/** Clamp a percentage onto the page, rounded to a tenth (JSON stays small). */
export function clampPlacePct(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 50;
  const bounded = Math.min(
    100 - FREE_EDGE_MARGIN_PCT,
    Math.max(FREE_EDGE_MARGIN_PCT, parsed),
  );
  return Math.round(bounded * 10) / 10;
}

/** A pointer position, as a percentage of the leaf it landed on. */
export function pointToPagePct(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const w = rect.width > 0 ? rect.width : 1;
  const h = rect.height > 0 ? rect.height : 1;
  return {
    x: clampPlacePct(((clientX - rect.left) / w) * 100),
    y: clampPlacePct(((clientY - rect.top) / h) * 100),
  };
}

/* ========================================================================== *
 *                        the node, and rescuing it                           *
 * ========================================================================== */

/** The ProseMirror node name. One string, so nobody has to remember it twice. */
export const STICKER_NODE = 'sticker';

export interface FreeStickerInit {
  readonly stickerId: StickerId;
  readonly x: number;
  readonly y: number;
  readonly scale?: number;
  readonly rotate?: number;
}

/** The JSON for a free-placed sticker, ready for `insertContentAt`. */
export function freeStickerNode(init: FreeStickerInit): Record<string, unknown> {
  return {
    type: STICKER_NODE,
    attrs: {
      stickerId: init.stickerId,
      placement: 'free' satisfies StickerPlacement,
      x: clampPlacePct(init.x),
      y: clampPlacePct(init.y),
      ...(init.scale === undefined ? {} : { scale: init.scale }),
      ...(init.rotate === undefined ? {} : { rotate: init.rotate }),
    },
  };
}

/** Is this bit of PM JSON a free-placed sticker? */
export function isFreeStickerJson(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const node = value as { type?: unknown; attrs?: unknown };
  if (node.type !== STICKER_NODE) return false;
  const attrs = node.attrs;
  if (attrs === null || typeof attrs !== 'object') return false;
  return (attrs as { placement?: unknown }).placement === 'free';
}

/**
 * Split free-placed stickers out of a run of blocks on their way off a page.
 *
 * Pure and non-mutating: the input JSON is left untouched, `kept` is a fresh
 * copy with every free sticker removed at any depth, and `freed` holds those
 * stickers in document order so the caller can re-anchor them.
 *
 * Nodes that end up empty are still returned — a paragraph whose only child was
 * a sticker is still a paragraph the reader typed, and silently deleting blocks
 * during a page break is exactly the kind of thing nobody would ever find.
 */
export function splitFreeStickers(blocks: readonly unknown[]): {
  kept: unknown[];
  freed: Record<string, unknown>[];
} {
  const freed: Record<string, unknown>[] = [];

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const entry of value) {
        if (isFreeStickerJson(entry)) {
          freed.push(entry as Record<string, unknown>);
          continue;
        }
        out.push(walk(entry));
      }
      return out;
    }
    if (value === null || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    if (!Array.isArray(node.content)) return { ...node };
    return { ...node, content: walk(node.content) };
  };

  const kept = walk(blocks) as unknown[];
  return { kept, freed };
}

/* ========================================================================== *
 *                            the armed sticker                               *
 * ========================================================================== */

/**
 * The catalogue arms a sticker; the next click on a leaf places it.
 *
 * A one-value store rather than a prop chain, because the two ends are a rail
 * panel and a page four components away, and the only thing they share is this
 * one fact. Cleared on placement, on Escape, and whenever the catalogue closes.
 */
const [armed, setArmed] = createSignal<StickerId | null>(null);

/** The sticker waiting for somewhere to land, or null. Reactive. */
export const armedSticker = armed;

export function armSticker(id: StickerId): void {
  setArmed(() => id);
}

export function disarmSticker(): void {
  setArmed(null);
}
