/**
 * features/bookshelf/namePlate.ts — where the inline title editor stands when
 * a brand-new book lands on the plank. Pure geometry, no Solid, no DOM: the
 * unit test that guards it runs in node.
 *
 * ## The bug this module exists to make impossible
 *
 * Reported twice. *"For some reason the new book is white."* Then, after a
 * first fix: *"A brand-new book STILL reads as a blank white slab."* Both
 * times the book was fine — baked, bound, coloured, banded — and what the
 * reader was looking at was the title editor sitting on top of it. It is
 * cream (`--paper-cream`) with a dashed border, and it was sized
 *
 *     along  = clamp(rect.height * 0.62, 84, rect.height * 0.9)
 *     across = Math.max(rect.width, 26)          // ← the whole spine, always
 *
 * The first fix shortened the LENGTH and left the width alone. Over that 62%
 * the cloth was still covered edge to edge, so the first thing a reader ever
 * made appeared as a cream rectangle with two stubs of colour poking out of
 * the ends. Measured on the default room at zoom 0.8: a 33.6 × 204 spine
 * under a 33.6 × 126 plate.
 *
 * ## Why the editor stands BESIDE the book and not on it
 *
 * Writing the title straight up the spine is the nicer picture, and it is
 * what this used to reach for. The arithmetic says it cannot be had:
 *
 *   - 13px is the smallest a handwriting face may ever be drawn (CLAUDE.md),
 *     and an input around 13px of text cannot be thinner than ~19px;
 *   - a plate that leaves cloth showing needs another ~4px down each side, so
 *     the spine has to be ~27 screen px wide before it can carry one;
 *   - a BRAND-NEW book is one page long, and `blendThickness` folds that page
 *     count into the seeded thickness — the widest new book the roll can
 *     produce is ≈40 world px, ≈32 screen px at the default zoom, and 95% of
 *     them come out under 27.
 *
 * So an on-spine plate would have been unreachable for all but a handful of
 * books — this repo's signature defect, authored and reached by nobody — and
 * for the rest it would have been the slab all over again. One affordance,
 * off the book, correct at every thickness and every zoom.
 *
 * The tag goes to the RIGHT by default, and that is not arbitrary: `addBook`
 * lands a new book past its floor's last slot, so the plank to its right is
 * the empty stretch the ghost slot was just standing in. It flips to the left
 * only when the stage has no room.
 */

/** A spine's rect on screen, in canvas-local px. */
export interface SpineRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NamePlateBox {
  /** Which side of the spine the tag stands on. */
  side: 'left' | 'right';
  /** Centre of the tag, canvas-local px (the CSS translates by -50%, -50%). */
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  /** The dashed leader from the spine's edge to the tag. */
  tie: { left: number; top: number; width: number };
}

/**
 * Smallest a handwriting face may be drawn (CLAUDE.md, "Conventions"). Not a
 * taste dial — dropping under it is a defect, not a trade-off. The tag is
 * comfortably above it because it has no spine to fit inside.
 */
export const MIN_FONT_PX = 13;

/** The tag is a fixed, comfortable size: it stands on the wall, not the book. */
export const TAG_W = 138;
export const TAG_H = 30;
export const TAG_FONT_PX = 15;

/**
 * Gap between the spine's edge and the tag, spanned by the dashed leader.
 * Long enough for three dashes: at 14px the leader read as a stub of ink
 * caught between two objects rather than as a line drawn from one to the
 * other, which is the whole job it has.
 */
export const TIE_LEN = 22;

/**
 * Clearance the tag keeps from the stage's edge before it flips sides.
 * Smaller than the tag, so a book near the right rail flips rather than
 * hanging half off the window.
 */
const EDGE_PAD = 8;

/**
 * Place the inline title editor for the spine at `spine`.
 *
 * `bounds` is the stage the tag lives in (canvas-local, origin 0,0); it only
 * decides which side the tag stands on. Omitted ⇒ right.
 */
export function namePlateBox(
  spine: SpineRect,
  bounds?: { width: number; height: number },
): NamePlateBox {
  const cy = spine.y + spine.height / 2;
  const wantsRight = spine.x + spine.width + TIE_LEN + TAG_W + EDGE_PAD;
  const canGoLeft = spine.x - TIE_LEN - TAG_W - EDGE_PAD >= 0;
  const side: 'left' | 'right' =
    bounds !== undefined && wantsRight > bounds.width && canGoLeft ? 'left' : 'right';

  const left =
    side === 'right'
      ? spine.x + spine.width + TIE_LEN + TAG_W / 2
      : spine.x - TIE_LEN - TAG_W / 2;
  const tieLeft = side === 'right' ? spine.x + spine.width : spine.x - TIE_LEN;

  return {
    side,
    left,
    top: cy,
    width: TAG_W,
    height: TAG_H,
    // The floor is structural rather than a note in a comment: whatever
    // TAG_FONT_PX is edited to, nothing here can emit handwriting under 13px.
    fontSize: Math.max(TAG_FONT_PX, MIN_FONT_PX),
    tie: { left: tieLeft, top: cy, width: TIE_LEN },
  };
}

/**
 * Does this tag overlap the book it names? The whole point is that it never
 * does. Exported so `tests/name-plate.test.ts` can ask it of every spine the
 * shelf can produce — the two probes ask the same question of the running
 * app instead, one in DOM rects (`shots-now/newbook-bake.mjs`) and one in
 * pixels (`shots-now/new-book-is-a-book.mjs`), because a module that is
 * right and unused is how this got shipped twice.
 */
export function overlapsSpine(spine: SpineRect, box: NamePlateBox): boolean {
  const boxL = box.left - box.width / 2;
  const boxR = box.left + box.width / 2;
  const boxT = box.top - box.height / 2;
  const boxB = box.top + box.height / 2;
  return (
    boxL < spine.x + spine.width &&
    boxR > spine.x &&
    boxT < spine.y + spine.height &&
    boxB > spine.y
  );
}
