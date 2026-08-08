import {
  CONTINUE_RIBBON_H,
  CONTINUE_RIBBON_W,
  STAR_CHARM_H,
  STAR_CHARM_W,
  drawContinueRibbon,
  drawStarCharm,
} from './textures';

export type PulledBookStatusMark = 'star' | 'ribbon';

/** Held-cover ornaments are larger than shelf art, but still part of the book. */
const HELD_STATUS_SCALE = 2.4;

const STATUS_ART: Record<
  PulledBookStatusMark,
  {
    width: number;
    height: number;
    draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  }
> = {
  star: {
    width: STAR_CHARM_W,
    height: STAR_CHARM_H,
    draw: drawStarCharm,
  },
  ribbon: {
    width: CONTINUE_RIBBON_W,
    height: CONTINUE_RIBBON_H,
    draw: drawContinueRibbon,
  },
};

/** Paint the exact same flat source art into either DOM owner of the cover. */
export function paintPulledBookStatusMark(
  canvas: HTMLCanvasElement,
  mark: PulledBookStatusMark,
): void {
  const art = STATUS_ART[mark];
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssWidth = art.width * HELD_STATUS_SCALE;
  const cssHeight = art.height * HELD_STATUS_SCALE;
  canvas.width = Math.ceil(cssWidth * dpr);
  canvas.height = Math.ceil(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.setTransform(
    HELD_STATUS_SCALE * dpr,
    0,
    0,
    HELD_STATUS_SCALE * dpr,
    0,
    0,
  );
  art.draw(ctx, art.width, art.height);
}
