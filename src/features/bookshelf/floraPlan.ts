/**
 * features/bookshelf/floraPlan.ts — where plants take hold on the real case.
 *
 * `src/art/flora.ts` knows how to GROW a specimen; this module knows the
 * shelf's geometry, so it owns the anchor list, the theme→species adapter and
 * the title keep-outs. Pure geometry — the GPU half lives in floraTextures.ts,
 * so unit tests can exercise the planner without Pixi.
 *
 * Two layers per floor (docs/design/library-themes.md §3):
 *  - `back`  — anchors inside the book zone (plank undersides, joint gaps,
 *              pots). Drawn BEHIND the books, keeping out of title bands.
 *  - `rail`  — anchors on the case furniture (rail tops, upper corners, the
 *              crown). Drawn over the rails so a trailing vine actually reads,
 *              and kept out of every spine rect entirely so it can never sit
 *              on a book.
 *
 * Everything is deterministic per `(floorIndex, anchorId, themeSeed)` and
 * baked once through `art/bake.ts`'s disk cache.
 */

import {
  planFlora,
  spineKeepOuts,
  type FloraAnchor,
  type FloraAnchorKind,
  type FloraPlacement,
  type FloraSpec,
  type FloraSpeciesId,
  type Rect,
} from '../../art/flora';
import { fnv1a } from '../../art/noise';
import type { FloraAnchor as ThemeAnchor, FloraSpecies, LibraryTheme } from '../../art/themes';
import {
  BOOK_BASELINE,
  BOOK_ZONE_H,
  CROWN_H,
  RAIL_W,
  SHELF_WIDTH,
} from './constants';

/** Which of the two per-floor layers a placement belongs to. */
export type FloraLayerId = 'back' | 'rail';

/* ------------------------------- adapters -------------------------------- */

/** themes.ts species vocabulary → flora.ts species ids. */
const SPECIES_MAP: Readonly<Record<FloraSpecies, FloraSpeciesId>> = {
  'ivy-trail': 'ivy',
  'pothos-trail': 'pothos',
  'moss-tuft': 'moss',
  'fern-frond': 'fern',
  'herb-bundle': 'herbBundle',
  'blossom-branch': 'blossom',
  'string-of-hearts': 'hearts',
  'potted-plant': 'potted',
  'grass-tuft': 'grassTuft',
  cobweb: 'cobweb',
};

/** themes.ts anchor vocabulary → flora.ts anchor kinds. */
const ANCHOR_MAP: Readonly<Record<ThemeAnchor, FloraAnchorKind>> = {
  'rail-top': 'railTop',
  'shelf-underside': 'shelfUnderside',
  'case-corner': 'caseCorner',
  'crown-top': 'crownTop',
  'joint-gap': 'jointGap',
  pot: 'potPosition',
};

/** Which layer each anchor kind draws into. */
const LAYER_OF: Readonly<Record<FloraAnchorKind, FloraLayerId>> = {
  railTop: 'rail',
  caseCorner: 'rail',
  crownTop: 'rail',
  shelfUnderside: 'back',
  jointGap: 'back',
  potPosition: 'back',
};

/** A theme's FloraSpec translated into the flora module's vocabulary. */
export function themeFloraSpec(theme: LibraryTheme): FloraSpec {
  return {
    species: theme.flora.species.map((s) => SPECIES_MAP[s]),
    density: theme.flora.density,
    eligibleAnchors: theme.flora.anchors.map((a) => ANCHOR_MAP[a]),
  };
}

/** Stable per-theme seed so two rooms never plant identically. */
export function themeSeed(theme: LibraryTheme): number {
  return fnv1a(`flora|${theme.id}`);
}

/* -------------------------------- anchors -------------------------------- */

/**
 * Every spot on ONE floor a plant may take hold, in floor-local world px
 * (x: 0..SHELF_WIDTH, y: 0 at the book-zone ceiling, BOOK_ZONE_H at the plank
 * top, negative above floor 0's crown).
 *
 * Ids are stable strings — they seed the growth, so they must not depend on
 * anything that changes between renders.
 */
export function floorAnchors(floorIndex: number): FloraAnchor[] {
  const railMidL = RAIL_W / 2;
  const railMidR = SHELF_WIDTH - RAIL_W / 2;
  const anchors: FloraAnchor[] = [
    // Rail tops — a vine spills over the top of each side rail.
    { id: 'rail-l', kind: 'railTop', x: railMidL, y: 4, run: RAIL_W, flip: false },
    { id: 'rail-r', kind: 'railTop', x: railMidR, y: 4, run: RAIL_W, flip: true },
    // Upper case corners — cobwebs and short trailers.
    { id: 'corner-l', kind: 'caseCorner', x: RAIL_W + 6, y: 3, flip: false },
    { id: 'corner-r', kind: 'caseCorner', x: SHELF_WIDTH - RAIL_W - 6, y: 3, flip: true },
    // The underside of the plank above, three points across the case.
    { id: 'under-a', kind: 'shelfUnderside', x: SHELF_WIDTH * 0.26, y: 2 },
    { id: 'under-b', kind: 'shelfUnderside', x: SHELF_WIDTH * 0.54, y: 2 },
    { id: 'under-c', kind: 'shelfUnderside', x: SHELF_WIDTH * 0.79, y: 2 },
    // Joints where the rails meet the plank — moss and grass tufts.
    { id: 'joint-l', kind: 'jointGap', x: RAIL_W + 8, y: BOOK_BASELINE - 1, run: 26 },
    { id: 'joint-r', kind: 'jointGap', x: SHELF_WIDTH - RAIL_W - 8, y: BOOK_BASELINE - 1, run: 26, flip: true },
    { id: 'joint-m', kind: 'jointGap', x: SHELF_WIDTH * 0.62, y: BOOK_BASELINE - 1, run: 30 },
    // Pot stations on the plank.
    { id: 'pot-l', kind: 'potPosition', x: RAIL_W + 62, y: BOOK_BASELINE },
    { id: 'pot-r', kind: 'potPosition', x: SHELF_WIDTH - RAIL_W - 72, y: BOOK_BASELINE },
  ];
  // The crown only exists above floor 0 — a blossom branch arcs over it.
  if (floorIndex === 0) {
    anchors.push({ id: 'crown', kind: 'crownTop', x: SHELF_WIDTH * 0.71, y: -CROWN_H + 6 });
  }
  return anchors;
}

/* -------------------------------- planning ------------------------------- */

/** Floor-local spine rects for keep-out computation. */
export interface SpineRect {
  centerX: number;
  w: number;
  height: number;
}

export function spineRects(spines: readonly SpineRect[]): Rect[] {
  return spines.map((s) => ({
    x: s.centerX - s.w / 2,
    y: BOOK_BASELINE - s.height,
    w: s.w,
    h: s.height,
  }));
}

export interface FloorFloraPlan {
  back: FloraPlacement[];
  rail: FloraPlacement[];
}

export interface PlanFloorFloraOptions {
  floorIndex: number;
  theme: LibraryTheme;
  /** Settings slider, 0 (clean) → 2 (overgrown). */
  densityMultiplier: number;
  spines: readonly SpineRect[];
}

/**
 * Plan both layers for one floor. The back layer keeps out of TITLE bands
 * (the doc's occlusion rule); the rail layer keeps out of whole spines, since
 * it draws over the case furniture and must never land on a book at all.
 */
export function planFloorFlora(o: PlanFloorFloraOptions): FloorFloraPlan {
  const spec = themeFloraSpec(o.theme);
  const seed = themeSeed(o.theme);
  const anchors = floorAnchors(o.floorIndex);
  const rects = spineRects(o.spines);
  const titleKeepOut = spineKeepOuts(rects, 4);
  const wholeKeepOut = rects.map((r) => ({
    x: r.x - 3,
    y: r.y - 3,
    w: r.w + 6,
    h: r.h + 6,
  }));

  const split = (
    kinds: readonly FloraAnchorKind[],
    keepOut: readonly Rect[],
  ): FloraPlacement[] =>
    planFlora({
      floorIndex: o.floorIndex,
      themeSeed: seed,
      spec,
      anchors: anchors.filter((a) => kinds.includes(a.kind)),
      densityMultiplier: o.densityMultiplier,
      keepOut,
    });

  const backKinds = (Object.keys(LAYER_OF) as FloraAnchorKind[]).filter(
    (k) => LAYER_OF[k] === 'back',
  );
  const railKinds = (Object.keys(LAYER_OF) as FloraAnchorKind[]).filter(
    (k) => LAYER_OF[k] === 'rail',
  );

  return {
    back: split(backKinds, titleKeepOut),
    rail: split(railKinds, wholeKeepOut),
  };
}

/** Exposed for tests: the vertical span a floor's flora may occupy. */
export const FLORA_FLOOR_SPAN = { top: -CROWN_H, bottom: BOOK_ZONE_H + 40 } as const;
