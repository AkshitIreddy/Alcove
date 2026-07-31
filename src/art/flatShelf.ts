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

/** How much of a board's height reads as its front edge. */
const EDGE_FRACTION = 0.28;

/**
 * A shelf board seen face on.
 *
 * Two flat bands: the top surface and, below it, a darker front edge. That
 * pair is the entire illusion of thickness, and it holds at every zoom
 * because neither band is shaded.
 */
export function drawPlank(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
): void {
  const edge = h * EDGE_FRACTION;
  const room = flatScheme();
  // Draw the darker edge first as one tall shape, then the lighter top over
  // it, so there is a single outline around the whole board rather than two
  // stacked rectangles with a seam between them.
  panel(ctx, x, y, w, h, room.timberDark, { radius: h * 0.22, seed });
  ctx.save();
  wobbleRect(ctx, x, y, w, h, h * 0.22, seed);
  ctx.clip();
  wobbleRect(ctx, x, y, w, h - edge, h * 0.22, seed + 7);
  ctx.fillStyle = room.timber;
  ctx.fill();
  ctx.restore();
  // Re-stroke the outer edge so the clip cannot nibble it.
  wobbleRect(ctx, x, y, w, h, h * 0.22, seed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = inkWidth(h);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** A vertical side post. Same two-band trick, mirrored to the vertical. */
export function drawPost(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
): void {
  const room = flatScheme();
  panel(ctx, x, y, w, h, room.timberDark, { radius: w * 0.3, seed });
  ctx.save();
  wobbleRect(ctx, x, y, w, h, w * 0.3, seed);
  ctx.clip();
  wobbleRect(ctx, x, y, w * (1 - EDGE_FRACTION), h, w * 0.3, seed + 7);
  ctx.fillStyle = room.timber;
  ctx.fill();
  ctx.restore();
  wobbleRect(ctx, x, y, w, h, w * 0.3, seed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = inkWidth(w);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * The recess behind the books.
 *
 * Flat and darker than the timber, with no texture at all. Its only job is to
 * make the books in front of it read as objects in a box; anything more
 * detailed competes with them.
 */
export function drawRecess(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
): void {
  panel(ctx, x, y, w, h, flatScheme().recess, { radius: Math.min(w, h) * 0.04, seed });
}

/**
 * The board that caps the case, with a lip along its underside.
 *
 * The lip is a single ink line rather than a shaded bevel — the icon does the
 * same on its cover's cornice, and it survives being drawn at 20px tall.
 */
export function drawCrown(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
): void {
  panel(ctx, x, y, w, h, flatScheme().timber, { radius: h * 0.28, seed });
  stroke(ctx, x + w * 0.04, y + h * 0.72, x + w * 0.96, y + h * 0.72, FLAT.ink, inkWidth(h) * 0.7, seed + 3);
  // A row of small gilt studs along the cornice — the icon earns its charm
  // from ornament like this, and a bare board reads as a placeholder.
  const studs = Math.max(3, Math.round(w / 150));
  for (let i = 0; i < studs; i++) {
    const cx = x + w * ((i + 0.5) / studs);
    ctx.beginPath();
    ctx.arc(cx, y + h * 0.36, Math.max(1.4, h * 0.09), 0, Math.PI * 2);
    ctx.fillStyle = FLAT.gilt;
    ctx.fill();
  }
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
 */
export function drawCaseCard(ctx: FlatCtx, w: number, h: number, seed = 1): void {
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

  drawRecess(ctx, caseX, bodyTop, caseW, bodyH, s + 1);

  const floors = 2;
  const floorH = bodyH / floors;
  const plankH = Math.max(3, floorH * 0.17);
  const innerX = caseX + postW;
  const innerW = caseW - postW * 2;
  for (let f = 0; f < floors; f++) {
    const top = bodyTop + f * floorH;
    const zoneH = floorH - plankH;
    // Headroom: without it the tallest spine in a row butts into the board
    // above and its rounded top reads as clipped rather than as a book.
    const head = zoneH * 0.08;
    drawBookRow(ctx, innerX + innerW * 0.03, top + head, innerW * 0.94, zoneH - head, s + f * 101 + 7);
    drawPlank(ctx, caseX, top + zoneH, caseW, plankH, s + f * 13);
  }

  // Posts last of the body, so their ink lines close the recess and the planks.
  drawPost(ctx, caseX, bodyTop, postW, bodyH, s + 3);
  drawPost(ctx, caseX + caseW - postW, bodyTop, postW, bodyH, s + 4);
  drawCrown(ctx, caseX - crownLip, crownY, caseW + crownLip * 2, crownH, s + 5);
}
