/**
 * features/bookshelf/glow.ts — the textures the shelf's interaction feedback
 * is drawn with.
 *
 * This file used to hold exactly one thing: a soft radial gradient, additively
 * blended, standing in for every affordance the shelf needed — the hover halo,
 * the keyboard-selection halo, the contact shadow under a dragged book. That
 * was the last lighting model left in the world. A flat drawing cannot glow,
 * and two blurred bloom pools sitting on top of an ink-outlined bookcase read
 * as a different app leaking through.
 *
 * So every affordance is a mark now, drawn in the icon's vocabulary (art/flat):
 * flat fill, one ink outline, rounded corners, hard edges everywhere. The
 * feedback did not get quieter — a hard gilt outline around a book is louder
 * than a halo behind it — it just got honest.
 *
 * The frames are authored as small nine-slice boxes rather than stretched
 * sprites: a spine is ~30px wide and ~200px tall, and scaling one bitmap to
 * that would smear the corner radius and the ink weight into two different
 * pens. Nine-slice keeps corners and line weight constant at every size, which
 * is the whole point of a single-weight outline style.
 */

import { CanvasSource, ImageSource, NineSliceSprite, Texture } from 'pixi.js';
import { FLAT, wobbleRect, type FlatCtx } from '../../art/flat';

/* ------------------------------ canvas plumbing --------------------------- */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: AnyCanvas): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  return (c as OffscreenCanvas).getContext('2d');
}

/**
 * Ship a baked canvas to the GPU as an ImageBitmap (ImageSource) rather than a
 * live CanvasSource: direct canvas uploads deliver wrong pixels on some
 * renderers (headless SwiftShader garbles alpha), while the ImageBitmap path —
 * used by every baked env texture — renders correctly everywhere.
 *
 * `resolution` is what makes the nine-slice maths bearable: the marks bake at
 * 4× for crisp corners, and passing the scale here means `texture.width` and
 * the slice insets are still quoted in the world px the caller thinks in.
 */
function textureFromCanvas(canvas: AnyCanvas, resolution: number): Texture {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    get2d(canvas);
    return new Texture({
      source: new ImageSource({ resource: canvas.transferToImageBitmap(), resolution }),
    });
  }
  return new Texture({
    source: new CanvasSource({ resource: canvas as HTMLCanvasElement, resolution }),
  });
}

/** Bake `draw` into a texture whose logical size is w × h world px. */
function bake(w: number, h: number, scale: number, draw: (ctx: FlatCtx) => void): Texture {
  const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
  const ctx = get2d(canvas);
  if (ctx !== null) {
    ctx.scale(scale, scale);
    draw(ctx as FlatCtx);
  }
  return textureFromCanvas(canvas, scale);
}

/* --------------------------------- frames --------------------------------- */

/**
 * The frame's design box, in world px. Small on purpose: nine-slice only
 * stretches the middle, so the box only has to be big enough to hold two
 * corners and a sliver between them.
 */
const FRAME_BOX = 36;

/** Half the ink+halo line, so the outer edge never touches the canvas crop. */
const FRAME_PAD = 4;

/** Corner radius, matched to the roundness the icon gives a book-sized shape. */
const FRAME_RADIUS = 8;

/**
 * Nine-slice inset. Must contain a whole corner (pad + radius + half the line)
 * or the arc gets sliced and stretched into an oval.
 */
export const FRAME_SLICE = 13;

/**
 * A frame is two passes of the same rounded rectangle: a wide `halo` pass that
 * gives the mark its colour and lifts it off whatever it lands on, then the
 * ink line over it. The select caret on the plank is drawn exactly this way,
 * so the two selection marks look like one hand made them.
 *
 * The path is drawn with zero bow. Every other flat shape in the app wobbles,
 * but nine-slice repeats the middle column: a bowed edge would be sampled at
 * one x and smeared into a straight offset line, which is a wobble that reads
 * as a mistake instead of a hand.
 */
function drawFrame(ctx: FlatCtx, halo: string, weight: number): void {
  const inner = FRAME_BOX - FRAME_PAD * 2;
  ctx.lineJoin = 'round';
  for (const [colour, width] of [
    [halo, 6.4 * weight],
    [FLAT.ink, 2.4 * weight],
  ] as Array<[string, number]>) {
    wobbleRect(ctx, FRAME_PAD, FRAME_PAD, inner, inner, FRAME_RADIUS, 1, 0);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/* --------------------------------- marks ---------------------------------- */

/**
 * Every texture the shelf's interaction feedback needs, baked once per world.
 *
 * They live together because they are one design decision, not four: change
 * the hover colour and the selection colour has to move with it or the shelf
 * stops having a single feedback language.
 */
export interface ShelfMarks {
  /** Warm outline hugging the book under the pointer. */
  hoverFrame: Texture;
  /** Cream outline, standing further out, for the keyboard selection. */
  selectFrame: Texture;
  /** Flat ellipse: "this object is off the surface", and nothing more. */
  contactShadow: Texture;
  destroy(): void;
}

export function makeShelfMarks(): ShelfMarks {
  // 4× so the corner arcs and the ink line survive a zoomed-in shelf.
  //
  // The hover mark is drawn a touch heavier than the selection one and the
  // selection one a touch lighter, for the same reason: hover hides behind the
  // book and only its outer half is ever seen, while selection is drawn over
  // the book in cream and at full weight starts covering the art it is meant
  // to be pointing at.
  const hoverFrame = bake(FRAME_BOX, FRAME_BOX, 4, (ctx) => drawFrame(ctx, FLAT.gilt, 1.05));
  const selectFrame = bake(FRAME_BOX, FRAME_BOX, 4, (ctx) => drawFrame(ctx, FLAT.cream, 0.88));
  const contactShadow = bake(40, 20, 3, (ctx) => {
    // Full alpha here; the sprite's own alpha is the dial, so one texture can
    // serve a hovering book (barely there) and a carried one (heavier).
    ctx.fillStyle = FLAT.shadow;
    ctx.beginPath();
    ctx.ellipse(20, 10, 19, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  return {
    hoverFrame,
    selectFrame,
    contactShadow,
    destroy(): void {
      for (const tex of [hoverFrame, selectFrame, contactShadow]) {
        tex.destroy(true);
      }
    },
  };
}

/**
 * A frame sprite sized in world px, ready to be parked around a spine.
 *
 * Bottom-center anchored to match the spine sprites, so a frame rotates around
 * the same point a leaning book does and the two stay glued together.
 */
export function makeFrameSprite(texture: Texture): NineSliceSprite {
  const frame = new NineSliceSprite({
    texture,
    leftWidth: FRAME_SLICE,
    rightWidth: FRAME_SLICE,
    topHeight: FRAME_SLICE,
    bottomHeight: FRAME_SLICE,
    anchor: { x: 0.5, y: 1 },
  });
  frame.alpha = 0;
  frame.eventMode = 'none';
  return frame;
}
