/**
 * features/bookshelf/floraPlan.ts — where plants take hold on the real case.
 *
 * `src/art/flora.ts` knows how to GROW a specimen; this module knows the
 * shelf's geometry, so it owns the anchor list, the theme→species adapter,
 * the title keep-outs — and the COMPOSITION model: which anchors get to
 * grow strongly and which fade away.
 *
 * ## The frame, not wallpaper
 *
 * The reference painting's flora FRAMES the bookcase: vines climb the side
 * rails, hang from the crown, trail along the bottom plank — while the
 * central book field keeps real negative space. That is modelled here as:
 *
 *   - an **edge-weighted density field** (`anchorFrameWeight`): a gaussian
 *     that peaks at the left/right frame rails and dies toward the centre,
 *     with per-kind framing values (the crown tops the frame wherever along
 *     it an anchor sits; joints and corners are the knots);
 *   - a per-floor **mood** (`floorMood`): seeded per (themeSeed, floor), each
 *     floor dresses its LEFT rail, its RIGHT rail, BOTH (quieter), or goes
 *     QUIET — so floors don't repeat identically and the planting has an
 *     asymmetric, composed feel rather than mirror symmetry;
 *   - the weight travels on the anchor into `planFlora`, where it gates
 *     acceptance, clump size and specimen scale.
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
import { clamp, fnv1a, mulberry32 } from '../../art/noise';
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

/* ------------------------------ composition ------------------------------ */

/**
 * The compositional mood of one floor: which side of the frame the flora
 * dresses, and how strongly. Seeded per (themeSeed, floorIndex) so every
 * floor composes differently — the reference is deliberately asymmetric (a
 * hero side and a quieter side), never mirrored.
 */
export interface FloorMood {
  /** 'left' | 'right' — one-sided floors; 'both' dresses both rails more
   * quietly; 'quiet' mutes the rails and lets the plank joints carry the floor. */
  style: 'left' | 'right' | 'both' | 'quiet';
  /** 0.85–1.15 overall strength wobble. */
  intensity: number;
}

/** Deterministic per-floor mood. Distribution: 36/36 one-sided, 16% both, 12% quiet. */
export function floorMood(themeSeedValue: number, floorIndex: number): FloorMood {
  const rnd = mulberry32(fnv1a(`floraMood|${themeSeedValue >>> 0}|${floorIndex}`));
  const roll = rnd();
  const style: FloorMood['style'] =
    roll < 0.36 ? 'left' : roll < 0.72 ? 'right' : roll < 0.88 ? 'both' : 'quiet';
  return { style, intensity: 0.85 + rnd() * 0.3 };
}

/** Per-kind framing value: how structural an anchor is to the frame. */
const KIND_FRAME: Readonly<Record<FloraAnchorKind, number>> = {
  railTop: 1,
  caseCorner: 1,
  crownTop: 0.92,
  shelfUnderside: 0.78,
  jointGap: 0.72,
  potPosition: 0.5,
};

/** Anchor kinds that sit ON the side rails (the verticals of the frame). */
const RAIL_KINDS: ReadonlySet<FloraAnchorKind> = new Set<FloraAnchorKind>([
  'railTop',
  'caseCorner',
  'jointGap',
  'potPosition',
]);

/**
 * How strongly an anchor participates in the frame around the book field,
 * 0–1. A gaussian centred on the case edges: full strength at the rails,
 * dying to ~nothing across the central book field — which is where the
 * reference's negative space comes from. Corners (where the frame's
 * verticals meet the plank) get a knot boost. The floor mood then biases
 * left/right so floors compose rather than repeat.
 */
export function anchorFrameWeight(anchor: FloraAnchor, mood: FloorMood): number {
  const u = clamp(anchor.x / SHELF_WIDTH, 0, 1);
  const dEdge = Math.min(u, 1 - u);
  let w = 0.015 + 0.985 * Math.exp(-((dEdge / 0.13) ** 2));

  // The crown is the top of the frame — full value wherever along it the
  // anchor sits (quiet floors still let a little crown through).
  if (anchor.kind === 'crownTop') {
    return clamp(0.9 * mood.intensity * (mood.style === 'quiet' ? 0.35 : 1), 0, 1);
  }

  w *= KIND_FRAME[anchor.kind];
  if (anchor.kind === 'caseCorner' || (anchor.kind === 'jointGap' && dEdge < 0.06)) {
    w = Math.min(1, w * 1.12);
  }

  let sideMul: number;
  switch (mood.style) {
    case 'both':
      sideMul = 0.82;
      break;
    case 'quiet':
      // Rails go sleepy; the plank joints keep the floor alive.
      sideMul = RAIL_KINDS.has(anchor.kind) ? 0.22 : 0.75;
      break;
    default: {
      const side = anchor.x < SHELF_WIDTH / 2 ? 'left' : 'right';
      sideMul = side === mood.style ? 1.12 : 0.12;
    }
  }
  return clamp(w * sideMul * mood.intensity, 0, 1);
}

/**
 * The floor's anchors with their compositional weights attached — the list
 * `planFloorFlora` actually plants from.
 */
export function composeFloorAnchors(floorIndex: number, themeSeedValue: number): FloraAnchor[] {
  const mood = floorMood(themeSeedValue, floorIndex);
  return floorAnchors(floorIndex).map((a) => ({ ...a, weight: anchorFrameWeight(a, mood) }));
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
  const anchors = composeFloorAnchors(o.floorIndex, seed);
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
