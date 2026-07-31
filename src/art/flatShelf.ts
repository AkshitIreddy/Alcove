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
  drawCrownBody,
  faceOf,
  paintCrownTrim,
  paintFacePattern,
  paintOpening,
  paintPlankTrim,
  paintPostTrim,
  resolveShelfDesign,
  withinFace,
  type Box,
  type ShelfDesignInput,
} from './shelfDesign';

/** How much of an upright's width reads as its turned-away edge. */
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
  const edge = h * spec.plankEdge;
  const radius = h * spec.plankRadius;
  const room = flatScheme();
  // Draw the darker edge first as one tall shape, then the lighter top over
  // it, so there is a single outline around the whole board rather than two
  // stacked rectangles with a seam between them.
  panel(ctx, x, y, w, h, room.timberDark, { radius, seed });
  withinFace(ctx, x, y, w, h, radius, seed, () => {
    wobbleRect(ctx, x, y, w, h - edge, radius, seed + 7);
    ctx.fillStyle = room.timber;
    ctx.fill();
    // Only the tile's x and w are read for a horizontal face, so the board's
    // own frame goes in unadjusted.
    const face = { x, y, w, h: h - edge };
    paintFacePattern(ctx, resolved.pattern, faceOf(face, 'x', frame), seed + 21);
    paintPlankTrim(ctx, spec, { x, y, w, h }, seed + 33);
  });
  // Re-stroke the outer edge so the clip cannot nibble it.
  wobbleRect(ctx, x, y, w, h, radius, seed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = inkWidth(h);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * A vertical side post. Same two-band trick, mirrored to the vertical.
 *
 * The build may narrow the shaft inside the width it is given — a ladder's
 * rail is half a post — and the leftover shows the opening behind it, which is
 * what makes the case read as built rather than as a border.
 *
 * `frame` matters here: this texture is ONE FLOOR and repeats down the case,
 * so it is drawn past both ends to keep its rounded cap off-canvas. Pass the
 * true floor rectangle and the pattern's pitch is snapped to divide it, which
 * is the difference between an upright and a chain of stutters.
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
  const room = flatScheme();
  const shaftW = w * spec.postShaft;
  const sx = x + (w - shaftW) / 2;
  const radius = shaftW * 0.3;
  const tile: Box = frame ?? { x, y, w, h };

  panel(ctx, sx, y, shaftW, h, room.timberDark, { radius, seed });
  withinFace(ctx, sx, y, shaftW, h, radius, seed, () => {
    const faceW = shaftW * (1 - EDGE_FRACTION);
    wobbleRect(ctx, sx, y, faceW, h, radius, seed + 7);
    ctx.fillStyle = room.timber;
    ctx.fill();
    paintFacePattern(
      ctx,
      resolved.pattern,
      faceOf({ x: sx, y, w: faceW, h }, 'y', tile),
      seed + 21,
    );
  });
  wobbleRect(ctx, sx, y, shaftW, h, radius, seed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = inkWidth(shaftW);
  ctx.lineJoin = 'round';
  ctx.stroke();
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
  panel(ctx, x, y, w, h, flatScheme().recess, { radius: Math.min(w, h) * 0.04, seed });
  paintOpening(ctx, BUILDS[resolveShelfDesign(design).build], frame ?? { x, y, w, h }, seed + 17);
}

/**
 * The board that caps the case.
 *
 * The one part with nothing flush above it, and therefore the one part whose
 * SILHOUETTE a build can really change — battlements, a scalloped cresting, a
 * pediment, or the house board with its lip line and gilt studs. The lip stays
 * a single ink line rather than a shaded bevel: the icon does the same on its
 * cover's cornice, and it survives being drawn at 20px tall.
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
  const { clip, face } = body;
  withinFace(ctx, clip.x, clip.y, clip.w, clip.h, body.radius, body.seed, () => {
    paintFacePattern(
      ctx,
      resolved.pattern,
      faceOf(face, 'x', frame),
      seed + 21,
    );
  });
  // Re-stroke the board the pattern was clipped into, with the same wobble it
  // was filled with, so the clip cannot nibble its outline.
  wobbleRect(ctx, clip.x, clip.y, clip.w, clip.h, body.radius, body.seed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = inkWidth(Math.min(clip.w, clip.h));
  ctx.lineJoin = 'round';
  ctx.stroke();
  // A row of small gilt studs along the cornice — the icon earns its charm
  // from ornament like this, and a bare board reads as a placeholder.
  paintCrownTrim(ctx, spec, box, face, seed);
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
  const bodyH = h - margin * 0.8 - bodyTop;
  const postW = Math.max(3, caseW * 0.05);

  // One contact shadow where the case meets the floor — the only shadow here.
  contactShadow(ctx, caseX + caseW / 2, bodyTop + bodyH, caseW * 0.5, Math.max(2, h * 0.022), 0.16);

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
  // boards. Sliced per floor and clipped, exactly as the shelf tiles them.
  const postOver = postW * 0.4 + 2;
  for (let f = 0; f < floors; f++) {
    const top = bodyTop + f * floorH;
    for (const px of [caseX, caseX + caseW - postW]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(px - postW, top, postW * 3, floorH);
      ctx.clip();
      drawPost(ctx, px, top - postOver, postW, floorH + postOver * 2, s + 3 + f * 29 + px, design, {
        x: px,
        y: top,
        w: postW,
        h: floorH,
      });
      ctx.restore();
    }
  }

  drawCrown(ctx, caseX - crownLip, crownY, caseW + crownLip * 2, crownH, s + 5, design);
}
