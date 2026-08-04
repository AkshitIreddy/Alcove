/**
 * src/editor/effects/freePlacement.ts — a mark placed ON the page rather than
 * IN the sentence.
 *
 * The reader's words:
 *
 *   "give user the option to drag and place stickers or any effects, like i
 *    mean click on it and put it anywhere on the page, not caring about where
 *    lines are"
 *
 * Two kinds of mark answer to that sentence, and both live in the same layer:
 *
 *  - a **sticker** (`STICKER_NODE`). It used to be an inline atom and nothing
 *    else: it sat between two words, moved when they moved, and could only ever
 *    be where a caret could be. A free-placed sticker keeps the same node —
 *    same id, same scale, same tilt — and adds three attributes:
 *    `placement: 'free'`, and an `x`/`y` in PERCENT of the leaf's own box.
 *  - a **trim mark** (`PAGE_MARK_NODE`). Tape, washi, a frame, a scrap of
 *    paper, a pencil doodle: the effects that have an extent of their own on
 *    bare paper. `./placeableEffects.ts` is where that line is drawn and why.
 *    They were block ATTRIBUTES and only ever block attributes — `data-tape` on
 *    whichever top-level block the caret happened to be in — so "put it
 *    anywhere on the page" was answered for stickers and for nothing else.
 *
 * Both are drawn into the leaf's `.nb-free-layer`, above the ruling and above
 * the text, and both answer to the pointer. A trim mark carries a `w`/`h` in
 * percent as well, because a strip of tape is a size and a sticker is not.
 *
 * ## THE PAGINATION CONTRACT (this is the part that has to be deliberate)
 *
 * Pages never scroll; overflow is peeled off the END of a page and carried to
 * the next one (`src/editor/pagination.ts` → `BookView.carryOverflow`). So the
 * question a free-placed mark has to answer is: *what happens to it when the
 * text under it reflows?*
 *
 * The answer is: **nothing. A free-placed mark belongs to the PAGE, not to the
 * paragraph.** Text can grow, carry onto the next leaf, come back — the mark
 * stays at the same x/y, at the same size, on the same leaf. That is what "not
 * caring about where lines are" has to mean, and it is the only rule a reader
 * can hold in their head. A strip of tape that followed the sentence it
 * happened to be anchored in would be a strip of tape that moved to another
 * page while the reader was typing somewhere else entirely.
 *
 * The SIZE is the same decision said twice: `w`/`h` are percentages of the
 * leaf, never pixels, so a reflow, a window resize and the focus-mode zoom all
 * leave a mark exactly where and exactly as big as it was put.
 *
 * Two mechanisms hold it up, and both are needed:
 *
 *  1. **It is anchored at the head of the page's FIRST top-level block.**
 *     `trailingOverflowCount` only ever removes TRAILING blocks and always
 *     leaves at least one, so the first block is the one place on a page that
 *     the carry provably cannot reach. {@link freeStickerNode} and
 *     {@link pageMarkNode} build the nodes and `BookView` inserts them there,
 *     wherever on the leaf the reader clicked.
 *  2. **The carry rescues any that slipped anyway.** A carry PREPENDS blocks to
 *     the next page, so a leaf's first block is not first forever; enough
 *     writing above it and yesterday's anchor can end up in the tail. So every
 *     carry runs {@link splitFreeMarks} over the blocks on their way out, keeps
 *     the free-placed marks behind, and re-anchors them. The blocks travel; the
 *     marks do not.
 *
 * The zero-width inline anchor is also why a mark costs pagination nothing: it
 * contributes no height to the block it lives in, so a page holds exactly as
 * much text with a hundred marks on it as with none. That is the whole reason
 * the mark is an inline atom carrying percentages rather than an absolutely
 * positioned BLOCK — a block would be measured by `trailingOverflowCount` and a
 * page full of tape would start pushing its own words onto the next leaf.
 *
 * Everything here is DOM-free and deterministic so `tests/free-placement.test.ts`
 * can run it in node.
 */
import { createSignal } from 'solid-js';
import { fnv1a } from '../../art/noise';
import type { StickerId } from '../nodes/stickers';
import {
  clampMarkSize,
  placeableAxis,
  type PlaceableKey,
} from './placeableEffects';

/* ========================================================================== *
 *                              the attributes                                *
 * ========================================================================== */

/** Where a sticker lives: in the text flow, or pinned to the leaf. */
export type StickerPlacement = 'inline' | 'free';

export function isStickerPlacement(value: unknown): value is StickerPlacement {
  return value === 'inline' || value === 'free';
}

/**
 * How close to the leaf's edge a free mark may be pinned, in percent.
 *
 * Not zero: a mark centred exactly on the edge is half outside the page and
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
 *                        the nodes, and rescuing them                        *
 * ========================================================================== */

/** The ProseMirror node names. One string each, so nobody remembers them twice. */
export const STICKER_NODE = 'sticker';
export const PAGE_MARK_NODE = 'page-mark';

/** Every node type that lives in the free layer rather than in the text. */
export const FREE_NODE_TYPES: readonly string[] = [STICKER_NODE, PAGE_MARK_NODE];

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

export interface PageMarkInit {
  readonly fx: PlaceableKey;
  readonly value: string;
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  readonly rotate?: number;
}

/**
 * The JSON for a free-placed trim mark.
 *
 * The box defaults come from the AXIS rather than from one number here, because
 * a strip of tape and a scrap of paper are not the same size and handing both
 * the same box would make one of them wrong on placement — which is the moment
 * a reader decides whether the feature works.
 */
export function pageMarkNode(init: PageMarkInit): Record<string, unknown> {
  const axis = placeableAxis(init.fx);
  const x = clampPlacePct(init.x);
  const y = clampPlacePct(init.y);
  return {
    type: PAGE_MARK_NODE,
    attrs: {
      fx: init.fx,
      value: init.value,
      x,
      y,
      w: clampMarkSize(init.w ?? axis?.w, axis?.w ?? 30),
      h: clampMarkSize(init.h ?? axis?.h, axis?.h ?? 8),
      rotate: init.rotate ?? 0,
      // Fixed HERE rather than derived from the attrs at draw time. A doodle's
      // linework is wobbled per seed, and a seed read off x/y would re-roll the
      // whole sketch on every pixel of a drag — the mark would appear to redraw
      // itself in the reader's hand.
      seed: fnv1a(`${init.fx}:${init.value}:${String(x)}:${String(y)}`),
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
 * Is this bit of PM JSON anything that lives in the free layer?
 *
 * A sticker has to say so (`placement: 'free'`) because the same node is also
 * the inline one. A trim mark does not: there is no inline form of a page mark
 * — a strip of tape between two words is `data-tape` on the block, which is a
 * different thing entirely — so every one of them is free by construction.
 */
export function isFreeMarkJson(value: unknown): boolean {
  if (isFreeStickerJson(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  return (value as { type?: unknown }).type === PAGE_MARK_NODE;
}

/**
 * Split free-placed marks out of a run of blocks on their way off a page.
 *
 * Pure and non-mutating: the input JSON is left untouched, `kept` is a fresh
 * copy with every free mark removed at any depth, and `freed` holds those marks
 * in document order so the caller can re-anchor them.
 *
 * Nodes that end up empty are still returned — a paragraph whose only child was
 * a sticker is still a paragraph the reader typed, and silently deleting blocks
 * during a page break is exactly the kind of thing nobody would ever find.
 */
export function splitFreeMarks(blocks: readonly unknown[]): {
  kept: unknown[];
  freed: Record<string, unknown>[];
} {
  const freed: Record<string, unknown>[] = [];

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const entry of value) {
        if (isFreeMarkJson(entry)) {
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
 *                             the armed mark                                 *
 * ========================================================================== */

/**
 * What the catalogue has picked up and is waiting to put down.
 *
 * A discriminated union rather than two signals, because the two are exclusive
 * — arming a strip of tape has to put a half-armed sticker back down — and two
 * signals is how you end up with a crosshair cursor and two things landing on
 * one click.
 */
export type ArmedMark =
  | { readonly kind: 'sticker'; readonly stickerId: StickerId }
  | { readonly kind: 'effect'; readonly fx: PlaceableKey; readonly value: string };

/**
 * The catalogue arms a mark; the next click on a leaf places it.
 *
 * A one-value store rather than a prop chain, because the two ends are a rail
 * panel and a page four components away, and the only thing they share is this
 * one fact. Cleared on placement, on Escape, and whenever the catalogue closes.
 */
const [armed, setArmed] = createSignal<ArmedMark | null>(null);

/** The mark waiting for somewhere to land, or null. Reactive. */
export const armedMark = armed;

export function armSticker(id: StickerId): void {
  setArmed(() => ({ kind: 'sticker', stickerId: id }));
}

export function armEffect(fx: PlaceableKey, value: string): void {
  setArmed(() => ({ kind: 'effect', fx, value }));
}

export function disarmMark(): void {
  setArmed(null);
}

/** The armed STICKER's id, or null when nothing (or a trim mark) is armed. */
export function armedStickerId(): StickerId | null {
  const current = armed();
  return current?.kind === 'sticker' ? current.stickerId : null;
}

/** Is this exact trim value the one waiting for somewhere to land? */
export function isArmedEffect(fx: string, value: string): boolean {
  const current = armed();
  return current?.kind === 'effect' && current.fx === fx && current.value === value;
}

/**
 * What to call the armed mark in the hint at the foot of the page.
 *
 * Here rather than in `BookView` because the union is here: a third arm kind
 * added without a name would otherwise reach the reader as "undefined — click
 * anywhere on the page".
 */
export function armedMarkLabel(mark: ArmedMark): string {
  return mark.kind === 'sticker' ? mark.stickerId : `${mark.fx} · ${mark.value}`;
}
