/**
 * Shared screen-space geometry for the DOM half of a shelf/book handoff.
 *
 * BookView owns the spread-to-cover closing beat, while PulledBookOverlay owns
 * the cover-to-shelf flight. Keeping the centred box here makes their route
 * boundary a change of owner, not a change of size or position.
 */

export interface PulledBookRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PulledBookCenterLayout extends PulledBookRect {}

/** The closed cover's resting box, clamped so tall windows do not make a poster. */
export function pulledBookCenterLayout(
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): PulledBookCenterLayout {
  const height = Math.max(220, Math.min(viewportHeight * 0.82, 720));
  const width = height * 0.72;
  return {
    width,
    height,
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
  };
}

/**
 * `ShelfWorld.pushInBook` creates its canvas copy 16% large and 24 world-px
 * above the slot before settling it. The DOM face must arrive at that pose,
 * not at the final slot, or an opacity crossfade exposes two displaced books.
 *
 * These two constants deliberately mirror the canvas values. A focused test
 * pins both call sites so changing the landing remains an explicit two-owner
 * decision until the world can expose this rect directly.
 */
export const RETURN_GHOST_SCALE = 1.16;
export const RETURN_GHOST_LIFT_WORLD = 24;

export function returnGhostHandoffRect(
  home: PulledBookRect,
  zoom: number,
): PulledBookRect {
  const width = home.width * RETURN_GHOST_SCALE;
  const height = home.height * RETURN_GHOST_SCALE;
  return {
    x: home.x - (width - home.width) / 2,
    y:
      home.y -
      (height - home.height) -
      RETURN_GHOST_LIFT_WORLD * Math.max(0, zoom),
    width,
    height,
  };
}
