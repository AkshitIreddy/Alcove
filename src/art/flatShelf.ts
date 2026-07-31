/**
 * art/flatShelf.ts — the bookcase and its books, drawn in the icon's style.
 *
 * Every function here is a handful of flat fills and ink outlines from
 * `flat.ts`. There is no baking to plan around: a whole floor costs a few
 * dozen path fills, which is cheaper than the *scheduling* the old bake
 * pipeline needed, let alone the painting.
 *
 * Depth is faked exactly the way the icon fakes it — a darker flat face beside
 * a lighter one, and one soft contact shadow where an object meets a surface.
 * There is no light direction anywhere in this file, and adding one would
 * break the style rather than enrich it.
 *
 * Colour comes from `flatScheme()`, not from `FLAT`, wherever a library theme
 * is allowed to repaint it — the timber pair, the recess, the wall, the book
 * cloths. The ink and the gilt stay hard-coded, because one outline colour on
 * everything is what holds the four rooms together as one drawing.
 *
 * ## Two axes, not one
 *
 * The four part drawers now take an optional DESIGN as well (`art/shelfDesign.ts`):
 * a build, which is the carpentry, and a pattern, which is what is worked into
 * the timber. Both are optional and both default to the house case, so every
 * existing call site draws exactly what it drew before. Anything that CACHES
 * these pixels has to key on `shelfDesignTag()` next to `flatSchemeTag()` — a
 * new axis of variation that is missing from a cache key is a stale PNG served
 * forever off the disk cache.
 */

import {
  CLOTHS,
  FLAT,
  contactShadow,
  flatScheme,
  inkWidth,
  panel,
  stroke,
  wobbleRect,
  type FlatCtx,
} from './flat';
import { mulberry32 } from './noise';
import {
  BUILDS,
  caseTimber,
  drawCrownBody,
  edgeLine,
  faceOf,
  flushShift,
  paintCrownTrim,
  paintFacePattern,
  paintOpening,
  paintPlankTrim,
  paintPostTrim,
  partPanel,
  resolveShelfDesign,
  strokePart,
  tracePart,
  withinPart,
  type Box,
  type PartOpts,
  type ShelfDesignInput,
} from './shelfDesign';

/**
 * How much of an upright's width reads as its turned-away edge.
 *
 * Also the fraction of a cornice's underside and, near enough, of a board's
 * front edge. Keeping them equal is what makes the case read as ONE piece of
 * furniture with one depth: three parts whose turned-away faces are 5, 11 and
 * 17 px look like three pieces of furniture standing in a line.
 */
const EDGE_FRACTION = 0.28;

/**
 * A shelf board seen face on.
 *
 * Two flat bands: the top surface and, below it, a darker front edge. That
 * pair is the entire illusion of thickness, and it holds at every zoom
 * because neither band is shaded. The build only moves how thick that edge
 * band is and how round the corners are; a board is 40 world px tall, and
 * anything more ambitious than that at this size is mush.
 *
 * `frame` is the un-cropped part rectangle, for callers that deliberately draw
 * the board oversize so an outline falls off-canvas. It only sets where the
 * pattern's repeat is measured from, and defaults to the drawn rectangle.
 */
export function drawPlank(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
  design?: ShelfDesignInput,
  frame?: Box,
): void {
  const resolved = resolveShelfDesign(design);
  const spec = BUILDS[resolved.build];
  const T = caseTimber();
  const ink = inkWidth(h);
  const shift = flushShift(h);

  // Three of the board's four sides BUTT something: an upright on the left,
  // an upright on the right, and the next floor's recess below. Only the top
  // arris — where the board meets the space the books stand in — is a real
  // silhouette, and even that one sits flush against the top of its own
  // bitmap, so it is nudged out by `flushShift` and its ink line lands on the
  // canvas rather than half off it.
  //
  // The bottom deserves its own line all the same: what is under it is the
  // next floor's recess, which is nearly as dark as the board's front edge,
  // and without a line between them the board dissolves into the case. So the
  // fill runs past the bottom as a join and the underside line is drawn on
  // afterwards, one ink width up, where it is certain to be on the bitmap.
  const b: Box = { x, y: y - shift, w, h: h + shift };
  const opts: PartOpts = {
    radius: h * spec.plankRadius,
    seed,
    joins: { left: true, right: true, bottom: true },
    width: ink,
  };
  const edge = b.h * spec.plankEdge;
  const faceH = b.h - edge;

  partPanel(ctx, b, T.edge, opts);
  withinPart(ctx, b, opts, () => {
    // The top surface: the face turned toward the reader, over the front edge
    // that turns away. One shape drawn over another rather than two stacked
    // rectangles, so there is one outline round the whole board.
    ctx.fillStyle = T.face;
    ctx.fillRect(b.x - 2, b.y - 2, b.w + 4, faceH + 2);
    // The chamfer between them. Not a highlight: a real arris is never sharp,
    // and this is the line that finally makes the front edge read as a second
    // face rather than as a stripe painted on the first.
    edgeLine(ctx, b.x, b.y + faceH, b.x + b.w, b.y + faceH, T.arris, Math.max(0.9, ink * 0.45), seed + 5, 0.7);
    edgeLine(ctx, b.x, b.y + faceH - ink * 0.55, b.x + b.w, b.y + faceH - ink * 0.55, FLAT.ink, Math.max(1, ink * 0.6), seed + 6, 0.7);
    // Only the tile's x and w are read for a horizontal face, so the board's
    // own frame goes in unadjusted.
    paintFacePattern(ctx, resolved.pattern, faceOf({ x: b.x, y: b.y, w: b.w, h: faceH }, 'x', frame), seed + 21);
    paintPlankTrim(ctx, spec, b, seed + 33);
  });
  // Re-ink the silhouette so the clip cannot nibble it, then the underside.
  strokePart(ctx, b, opts);
  const under = y + h - ink * 0.5;
  edgeLine(ctx, x, under, x + w, under, FLAT.ink, ink, seed + 9, 0.6);
}

/**
 * A vertical side post. Same two-band trick, mirrored to the vertical.
 *
 * ## x grows INWARD
 *
 * The right-hand upright is the same bitmap drawn mirrored, so inside this
 * function `x` is always the OUTBOARD side of the case and `x + w` always the
 * side facing the opening. Every asymmetric decision below leans on that.
 *
 * The build may narrow the shaft inside the width it is given — a ladder's
 * rail is half a post — and the leftover shows the opening behind it, which is
 * what makes the case read as built rather than as a border. It is flush to
 * the OUTBOARD edge for exactly that reason. Centred, which is how it used to
 * be, half the leftover fell on the case's outer face where there is no
 * opening to show, and painted a stripe of the case's own dark interior down
 * the outside of the bookcase — ten pixels of it on the ladder shelf.
 *
 * The outboard edge is then pushed out by `flushShift`, so its ink line's
 * outer half lands exactly on the canvas boundary. Inset by the bake's pad
 * instead, it left a two-pixel gap through which the recess sprite behind it
 * showed on every build.
 *
 * `frame` matters here: this texture is ONE FLOOR and repeats down the case,
 * so it is drawn past both ends to keep its ends off-canvas. Pass the true
 * floor rectangle and the pattern's pitch is snapped to divide it, which is
 * the difference between an upright and a chain of stutters.
 */
export function drawPost(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
  design?: ShelfDesignInput,
  frame?: Box,
): void {
  const resolved = resolveShelfDesign(design);
  const spec = BUILDS[resolved.build];
  const T = caseTimber();
  const shift = flushShift(w);
  const shaftW = w * spec.postShaft + shift;
  const sx = x - shift;
  const ink = inkWidth(shaftW);
  const tile: Box = frame ?? { x, y, w, h };

  // Top and bottom are joins — this slice is one floor of an upright that runs
  // the whole height of the case, and a rounded cap at either end would give
  // the case a chain of pill shapes down each side instead of two posts.
  const b: Box = { x: sx, y, w: shaftW, h };
  const opts: PartOpts = {
    radius: shaftW * 0.28,
    seed,
    joins: { top: true, bottom: true },
    width: ink,
  };
  const faceW = shaftW * (1 - EDGE_FRACTION);

  partPanel(ctx, b, T.edge, opts);
  withinPart(ctx, b, opts, () => {
    // The front face, and inboard of it the return going back into the case.
    ctx.fillStyle = T.face;
    ctx.fillRect(b.x - 2, b.y - 2, faceW + 2, b.h + 4);
    edgeLine(ctx, b.x + faceW, b.y, b.x + faceW, b.y + b.h, T.arris, Math.max(0.9, ink * 0.45), seed + 5, 0.7);
    edgeLine(ctx, b.x + faceW - ink * 0.55, b.y, b.x + faceW - ink * 0.55, b.y + b.h, FLAT.ink, Math.max(1, ink * 0.6), seed + 6, 0.7);
    paintFacePattern(
      ctx,
      resolved.pattern,
      faceOf({ x: b.x, y, w: faceW, h }, 'y', tile),
      seed + 21,
    );
  });
  strokePart(ctx, b, opts);
  // Capitals, rungs and pegs sit ON the upright, outside its clip, because a
  // capital that does not overhang its shaft is not a capital.
  paintPostTrim(ctx, spec, { x: sx, y, w: shaftW, h }, tile, seed + 45);
}

/**
 * The recess behind the books, and whatever the build stands inside it.
 *
 * Flat and darker than the timber. Its own job is to make the books in front
 * of it read as objects in a box, so the carpentry that goes in here is only
 * ever the kind that sits HIGH in the opening — arch heads, a valance, the top
 * rail of a compartment run — where the books are not.
 *
 * `frame` is the visible opening, between the uprights. It matters because
 * this texture is baked oversize so its own outline lands off-canvas, and an
 * arch springing from that rectangle springs from outside the bookcase.
 *
 * All four sides are joins: the inside of a box has no edge of its own. The
 * boards above and below and the uprights either side draw their ink lines
 * across it, so it is filled flat and never outlined.
 */
export function drawRecess(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
  design?: ShelfDesignInput,
  frame?: Box,
): void {
  const b: Box = { x, y, w, h };
  tracePart(ctx, b, {
    radius: Math.min(w, h) * 0.04,
    seed,
    joins: { top: true, right: true, bottom: true, left: true },
  });
  ctx.fillStyle = flatScheme().recess;
  ctx.fill();
  paintOpening(ctx, BUILDS[resolveShelfDesign(design).build], frame ?? b, seed + 17);
}

/**
 * The board that caps the case.
 *
 * The one part with nothing flush above it, and therefore the one part whose
 * SILHOUETTE a build can really change — battlements, a scalloped cresting, a
 * pediment, or the house board with its bed mould and gilt studs. Everything
 * below the crest stays a run of flat bands and a single ink line rather than
 * a shaded bevel: the icon does the same on its cover's cornice, and it
 * survives being drawn at 20px tall.
 *
 * Its underside is a join, so the FILL runs past the bottom of the box it is
 * given. That is what puts a square corner at each end of the cornice, sharing
 * a vertical edge with the upright below, instead of the rounded lozenge that
 * used to curl inboard of the case and leave the fourteen-pixel lip hanging
 * over nothing.
 *
 * The ink is the other half of the same argument, and it took looking at a
 * 12x crop to see it. A join that runs past the bottom and is never inked
 * leaves the two `CROWN_LIP` overhangs — the only stretch of that underside
 * with wall behind it rather than case — ending in a bare colour step, while
 * every other edge of the bookcase carries a line. Four corners of every case,
 * top and bottom (the plinth is this bitmap mirrored), each reading as a board
 * pasted on rather than one resting on the carcass.
 *
 * So the underside gets its line after all, drawn on afterwards exactly the
 * way `drawPlank` draws its own, and for the same reason: what a join buys is
 * an unbroken FILL across the seam, not the absence of a joint. The caller has
 * to hand in a box whose bottom edge is where the cornice's underside really
 * is — the bleed will carry the fill past it — because the line lands there.
 */
export function drawCrown(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
  design?: ShelfDesignInput,
  frame?: Box,
): void {
  const resolved = resolveShelfDesign(design);
  const spec = BUILDS[resolved.build];
  const box: Box = { x, y, w, h };
  const body = drawCrownBody(ctx, spec, box, seed);
  // Clipped to the SILHOUETTE, not to a rectangle: a pattern worked into the
  // corona must not spill out between the battlements.
  ctx.save();
  body.trace(ctx);
  ctx.clip();
  paintFacePattern(ctx, resolved.pattern, faceOf(body.face, 'x', frame), seed + 21);
  ctx.restore();
  body.outline(ctx);
  // Half an ink width up, so the whole line is inside the bitmap however tight
  // the bake is cropped — the same trick, and the same reason, as the board's.
  const ink = inkWidth(h);
  const under = y + h - ink * 0.5;
  edgeLine(ctx, x, under, x + w, under, FLAT.ink, ink, seed + 9, 0.6);
  // A row of small gilt studs along the frieze — the icon earns its charm from
  // ornament like this, and a bare board reads as a placeholder.
  paintCrownTrim(ctx, spec, box, body.frieze, seed);
}

/* ----------------------------------------------------------------------------
   Books
   -------------------------------------------------------------------------- */

/** Everything the spine renderer needs. All of it derived from the book seed. */
export interface FlatSpine {
  /** Index into CLOTHS. */
  cloth: number;
  /** 0 = no bands, 1 = a pair of gilt bands, 2 = bands plus a label. */
  dress: number;
  /** Where the label sits vertically, 0..1. */
  labelAt: number;
  seed: number;
}

/**
 * Derive a book's whole appearance from one integer.
 *
 * Deterministic on purpose: a book must look like itself across restarts, and
 * the old system's per-book style records existed largely to pin down a
 * randomness this design simply does not have.
 */
export function flatSpineFor(seed: number): FlatSpine {
  const s = seed >>> 0;
  return {
    cloth: s % CLOTHS.length,
    dress: (s >>> 4) % 3,
    labelAt: 0.22 + (((s >>> 8) % 100) / 100) * 0.2,
    seed: s,
  };
}

/**
 * One book spine, standing at (x, y) with its foot on y + h.
 *
 * The narrow left band is the same trick as the plank: a darker flat face that
 * reads as the board turning away from us, no shading involved.
 */
export function drawSpine(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  spec: FlatSpine,
): void {
  // A book's cloth comes from the HOUSE palette, never from the room.
  //
  // It used to follow `flatScheme()`, so redecorating repainted every book on
  // every shelf at once. That is precisely the wrong thing for a bookshelf to
  // do: you find a book by recognising its spine, and a shelf whose colours
  // all move together is a shelf you have to re-learn. The room owns the case
  // and the wall; a book owns itself, and the way to change one is to dress
  // that one (right-click → dress this book).
  const [face, dark] = CLOTHS[spec.cloth] ?? CLOTHS[0]!;
  const radius = Math.min(w * 0.34, h * 0.03);
  const ink = inkWidth(w);

  panel(ctx, x, y, w, h, dark, { radius, seed: spec.seed, width: ink });
  ctx.save();
  wobbleRect(ctx, x, y, w, h, radius, spec.seed);
  ctx.clip();
  wobbleRect(ctx, x + w * 0.26, y, w * 0.74, h, radius, spec.seed + 11);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.restore();

  // Gilt bands across the spine. Two near the head, one near the tail — the
  // icon's proportions, which are also how real binding furniture sits.
  if (spec.dress >= 1 && w > 7) {
    const band = Math.max(1.2, w * 0.1);
    for (const t of [0.14, 0.2, 0.82]) {
      stroke(ctx, x + w * 0.18, y + h * t, x + w * 0.86, y + h * t, FLAT.gilt, band, spec.seed + t * 100);
    }
  }

  // A cream label with ruled lines standing in for a title. Only when there is
  // room for it to be legible as a label rather than a smudge.
  if (spec.dress >= 2 && w > 14 && h > 60) {
    const lw = w * 0.62;
    const lh = Math.min(h * 0.24, lw * 2.4);
    const lx = x + (w - lw) / 2;
    const ly = y + h * spec.labelAt;
    panel(ctx, lx, ly, lw, lh, FLAT.cream, {
      radius: lw * 0.18,
      seed: spec.seed + 3,
      width: Math.max(1, ink * 0.7),
    });
    const rules = 3;
    for (let i = 0; i < rules; i++) {
      const ry = ly + lh * (0.28 + i * 0.22);
      stroke(
        ctx,
        lx + lw * 0.2,
        ry,
        lx + lw * (0.8 - i * 0.12),
        ry,
        FLAT.inkSoft,
        Math.max(0.9, lw * 0.07),
        spec.seed + i,
      );
    }
  }

  // Where the book meets the plank.
  contactShadow(ctx, x + w / 2, y + h, w * 0.62, Math.max(1.5, w * 0.14), 0.18);
}

/**
 * A row of books standing on a shelf board, filling the width given.
 *
 * Widths and heights come off one seeded stream, so a row is the same row every
 * time it is drawn — which is what lets a preview thumbnail be cached by seed
 * alone. Books are laid left to right and the last one is dropped rather than
 * clipped, because a spine sliced in half by the post reads as a rendering bug.
 */
export function drawBookRow(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
): void {
  const rnd = mulberry32(seed >>> 0);
  const gap = Math.max(0.6, h * 0.012);
  let cx = x;
  // The width test is what ends the row; the counter is only a stop against a
  // degenerate `h` (a zero-height zone would give zero-width books forever).
  for (let i = 0; i < 512; i++) {
    const bw = h * (0.11 + rnd() * 0.075);
    if (bw <= 0 || cx + bw > x + w) break;
    const bh = h * (0.74 + rnd() * 0.26);
    // Math.imul, not `*`: the product overflows the 53-bit float mantissa and
    // the mixing degrades to whatever survived the rounding.
    const spec = flatSpineFor((Math.imul(seed, 2654435761) ^ Math.imul(i, 0x9e3779b1)) >>> 0);
    drawSpine(ctx, cx, y + h - bh, bw, bh, spec);
    cx += bw + gap;
  }
}

/* ----------------------------------------------------------------------------
   The whole case, small
   -------------------------------------------------------------------------- */

/**
 * A bookcase in a box: wall, cornice, posts, two dressed floors.
 *
 * This is the preview art — the Library Studio's room cards, and anything else
 * that needs to show "the shelf" without a Pixi world. It draws with exactly
 * the same four functions the real case bakes through, so a card cannot drift
 * away from the thing it is previewing. (It did: the cards kept painting a
 * wood-grained, wallpapered, watercolour room for a while after the shelf
 * itself had gone flat, and previewed a room you could no longer get.)
 *
 * Proportions are all fractions of the box, so it holds from a 168px card up
 * to a full-page specimen.
 *
 * The floor loop mirrors the real bake rather than simplifying it — one recess
 * and one upright slice PER FLOOR, each over-drawn and clipped the way
 * `textures.ts` bakes them. That is what makes an arched bay, a valance or a
 * column's capital land on the card exactly where it lands on the shelf; a
 * card that drew one tall recess showed a single arch across the whole case
 * and previewed a bookcase nobody could get.
 */
export function drawCaseCard(
  ctx: FlatCtx,
  w: number,
  h: number,
  seed = 1,
  design?: ShelfDesignInput,
): void {
  ctx.fillStyle = flatScheme().wall;
  ctx.fillRect(0, 0, w, h);

  const s = seed >>> 0;
  const margin = Math.min(w, h) * 0.06;
  const caseX = margin * 1.5;
  const caseW = w - caseX * 2;
  const crownH = Math.max(5, h * 0.1);
  const crownLip = caseW * 0.03;
  const crownY = margin * 0.7;
  // The cornice's underside sits ON the case, so the body starts inside it.
  const bodyTop = crownY + crownH * 0.78;
  // The plinth is the cornice upside down and the same height, exactly as
  // `world.ts` stands one under the shelf. The card carries it because it is
  // half of what a build looks like: a crest that is charming on top can be a
  // row of broken teeth when it is turned over, and a preview that hid that
  // was previewing half a bookcase.
  const footY = h - margin * 0.5;
  const bodyH = footY - crownH - bodyTop;
  const postW = Math.max(3, caseW * 0.05);

  // One contact shadow where the case meets the floor — the only shadow here.
  contactShadow(ctx, caseX + caseW / 2, footY, caseW * 0.5, Math.max(2, h * 0.022), 0.16);

  const floors = 2;
  const floorH = bodyH / floors;
  const plankH = Math.max(3, floorH * 0.17);
  const innerX = caseX + postW;
  const innerW = caseW - postW * 2;
  const over = postW * 0.5 + 3;

  for (let f = 0; f < floors; f++) {
    const top = bodyTop + f * floorH;
    const zoneH = floorH - plankH;
    // Over-drawn so the recess's own outline lands outside the case, where the
    // uprights and boards draw across it — the inside of a box has no edge of
    // its own. The frame is the VISIBLE opening, which is what an arch springs
    // from.
    drawRecess(ctx, caseX - over, top - over, caseW + over * 2, zoneH + over * 2, s + 1 + f * 17, design, {
      x: innerX,
      y: top,
      w: innerW,
      h: zoneH,
    });
    // Headroom: without it the tallest spine in a row butts into the board
    // above and its rounded top reads as clipped rather than as a book.
    const head = zoneH * 0.08;
    drawBookRow(ctx, innerX + innerW * 0.03, top + head, innerW * 0.94, zoneH - head, s + f * 101 + 7);
    drawPlank(ctx, caseX, top + zoneH, caseW, plankH, s + f * 13, design);
  }

  // Uprights last of the body, so their ink lines close the recess and the
  // boards. Sliced per floor and clipped, exactly as the shelf tiles them —
  // and the RIGHT one mirrored, which is not a nicety: `drawPost` puts the
  // shaft flush to the outboard side and its return on the inboard one, so an
  // un-mirrored right upright turns the case inside out down one edge.
  const postOver = postW * 0.4 + 2;
  for (let f = 0; f < floors; f++) {
    const top = bodyTop + f * floorH;
    for (const mirror of [false, true]) {
      ctx.save();
      if (mirror) {
        ctx.translate(caseX * 2 + caseW, 0);
        ctx.scale(-1, 1);
      }
      ctx.beginPath();
      ctx.rect(caseX - postW, top, postW * 3, floorH);
      ctx.clip();
      drawPost(ctx, caseX, top - postOver, postW, floorH + postOver * 2, s + 3 + f * 29 + (mirror ? 71 : 0), design, {
        x: caseX,
        y: top,
        w: postW,
        h: floorH,
      });
      ctx.restore();
    }
  }

  drawCrown(ctx, caseX - crownLip, crownY, caseW + crownLip * 2, crownH, s + 5, design);
  // The plinth: the same bake, upside down. `scale(1, -1)` after translating
  // to the case's foot, so the cornice's underside lands on the last board.
  ctx.save();
  ctx.translate(0, footY);
  ctx.scale(1, -1);
  drawCrown(ctx, caseX - crownLip, 0, caseW + crownLip * 2, crownH, s + 5, design);
  ctx.restore();
}
