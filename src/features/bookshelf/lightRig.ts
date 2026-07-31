/**
 * features/bookshelf/lightRig.ts — the room's light, as the deferred pass wants it.
 *
 * Split out of `sceneLight.ts` for the same reason `floraPlan` is split out of
 * `floraTextures`: this is pure arithmetic over theme data, and the unit tests
 * run in a node environment where importing PixiJS throws on `navigator`. The
 * numbers here are the ones the whole shelf is graded by, so they are worth
 * being able to test without a GPU.
 *
 * ## The house light (`docs/design/ART-BIBLE.md` §3)
 *
 * The bible does not describe *a* light. It describes **one specific light**,
 * and it is the largest single contributor to the reference image:
 *
 *   > Warm, soft, directional from the upper right. Selective, never even: it
 *   > picks out important areas and lets the rest fall into soft shadow.
 *   > Shadows are never pure black — they hold warm tone and reflected bounce.
 *
 * So the direction, the elevation, the falloff and the value structure are
 * **house constants**, not theme parameters. A theme may recolour the light —
 * an observatory's moon is blue, a hearth's fire is orange — and it may nudge
 * the key a little to one side of the window, but it may not turn the sun into
 * a ring light, and it may not flatten the falloff. That is the mistake the
 * previous version made: it derived `keyAngle` from whichever lamp pool a
 * theme happened to list first, which put the sun in the lower-left for the
 * default room (all the cast shadows climbed *up* the case) and gave every
 * other room a different, un-art-directed sun.
 *
 * ## Reading the numbers
 *
 * Four groups do almost all the work, and they are worth understanding before
 * touching any of them:
 *
 * | group                                     | what it buys                     |
 * |-------------------------------------------|----------------------------------|
 * | `keyOrigin` + `keyFalloff` + `keyRadius`  | the *compositional* gradient — a bright corner and a dark one, before a single object is shaded |
 * | `keyElevation` + `shadowReach`            | the rake: long shadows across the row, every spine turning |
 * | `ambientLevel` + `bounce` + `shadowColour`| what lives inside the dark — warm, not black |
 * | `saturation` + `contrast` + `temperature` | restraint: chroma concentrated in the accents, value doing the shouting |
 */

import { DEFAULT_LIGHT_RIG, KEY_ANGLE, type LightRig, type ShaftSpec } from '../../art/lighting';
import type { LibraryTheme } from '../../art/themes';

/* ========================================================================== *
 *                            the house key light                             *
 * ========================================================================== */

/**
 * Where the sun is, and it does not move.
 *
 * `KEY_ANGLE.upperRight` is π·0.75 — light *travelling* down-left from a source
 * up and to the right. A touch past it (0.79) drops the source slightly, which
 * is what pushes the cast shadows along the row instead of straight down it.
 */
export const SHELF_KEY_ANGLE = Math.PI * 0.79;

/**
 * The window, in frame fractions — just outside the top-right corner.
 *
 * Pinned rather than derived. `keyOrigin: 'auto'` puts the origin on the frame
 * edge implied by the angle, which is *approximately* here but drifts with
 * aspect ratio; the composition of the reference depends on the hot corner
 * being at a specific place, so it is stated.
 */
export const SHELF_KEY_ORIGIN = { x: 1.04, y: -0.12 } as const;

/**
 * How far a theme's own lamp may pull the key off the house angle, radians.
 *
 * ±22° is enough for a hearth-lit room to read as lit from the side and a
 * skylight to read as lit from nearly above, and small enough that every room
 * still has the reference's raking upper-right sun.
 */
export const KEY_ANGLE_SLACK = Math.PI * 0.12;

/**
 * Two warm shafts crossing down-left out of the same window.
 *
 * The bible asks for god rays; these are the house pair. The first is the
 * broad one that crosses the case, the second a thin bright companion — real
 * shafts come in families, and a single wedge reads as a decal.
 */
export const SHELF_SHAFTS: readonly ShaftSpec[] = [
  {
    origin: { x: 0.99, y: -0.06 },
    angle: Math.PI * 0.76,
    width: 0.15,
    length: 1.55,
    softness: 0.8,
    opacity: 0.15,
    spread: 2.1,
    dust: 0.62,
  },
  {
    origin: { x: 1.08, y: 0.1 },
    angle: Math.PI * 0.8,
    width: 0.065,
    length: 1.3,
    softness: 0.88,
    opacity: 0.1,
    spread: 2.5,
    dust: 0.4,
  },
  {
    origin: { x: 0.86, y: -0.1 },
    angle: Math.PI * 0.71,
    width: 0.04,
    length: 1.0,
    softness: 0.9,
    opacity: 0.07,
    spread: 3.0,
    dust: 0.3,
  },
];

/* ========================================================================== *
 *                                 the grade                                  *
 * ========================================================================== */

/**
 * The shelf grade — every knob that is the *same in every room*.
 *
 * Authored against a full 49-book shelf under `qa/rigsheet.mjs`, not against
 * the prototype's specimen board. Every number here moves in one of two
 * directions relative to `DEFAULT_LIGHT_RIG`: **more separation** (falloff,
 * occlusion, contrast, reach) or **less indiscriminate colour** (saturation,
 * ambient, local colour). Both serve the same bible line — *vividness comes
 * from contrast and selective saturation, not global saturation*.
 */
const SHELF_GRADE = {
  /* --- the key ---------------------------------------------------------- *
   *
   * A window, not a sun. `keyFalloff` at 0.8 over a radius of barely one frame
   * width means the far bottom-left of the picture receives about a quarter of
   * the light the top-right does — which is the whole compositional gradient,
   * present before any object is shaded. This is the single change that most
   * separates the render from the flat, evenly-lit build.  */
  keyAngle: SHELF_KEY_ANGLE,
  keyOrigin: SHELF_KEY_ORIGIN,
  keyFalloff: 0.8,
  keyRadius: 1.0,
  keyIntensity: 1.34,
  /* A LOW sun rakes ACROSS the row instead of lighting it from the front,
   * which is what turns thirty rectangles into thirty cylinders. */
  keyElevation: 0.19,
  keyWrap: 0.33,
  hotSpot: 0.42,
  specular: 0.3,

  /* --- what lives in the dark ------------------------------------------- *
   *
   * "Shadows are never pure black — they hold warm tone and reflected bounce."
   * A low `ambientLevel` is what lets the key read as *selective*; `bounce`
   * and a warm `shadowColour` are what stop the result being a hole. The two
   * have to move together: drop the ambient without raising the bounce and the
   * recesses die.  */
  ambientLevel: 0.115,
  ambientColour: '#54402c',
  fillColour: '#7d8794',
  fillIntensity: 0.15,
  shadowColour: '#31200f',
  bounce: 0.26,
  skyFill: 0.32,

  /* --- occlusion and contact -------------------------------------------- */
  ambientOcclusion: 0.92,
  aoRadius: 22,
  aoPower: 1.5,
  aoBias: 0.012,
  contactStrength: 1.34,
  shadowReach: 178,
  shadowSoftness: 0.55,
  heightScale: 210,
  groundFlatten: 0.36,

  /* --- rim -------------------------------------------------------------- *
   * Half the prototype's rim. On a specimen board a strong rim reads as sun
   * catching an edge; over a whole shelf it outlines every silhouette at once
   * and the picture turns into a wireframe. */
  rimStrength: 0.52,
  rimColour: '#ffeec6',
  rimSharpness: 2.2,
  rimWrap: 0.22,

  /* --- temperature ------------------------------------------------------ *
   * Modest, and pivoting low. A big split sends the shadows blue, and the
   * reference's shadows are unmistakably *warm* brown. What the split is here
   * for is the last 10% of separation between the lit face of a book and the
   * gap beside it. */
  temperatureShift: 0.44,
  temperaturePivot: 0.42,
  shadowTint: 0.24,
  highlightTint: 0.24,

  /* --- bloom: haloes on the hot spots, and only there -------------------- */
  bloom: 0.3,
  bloomThreshold: 0.79,
  bloomRadius: 13,
  bloomKnee: 0.24,

  /* --- vignette: the dark surround the glow sings against ---------------- */
  vignette: 0.54,
  vignetteColour: '#251708',
  vignetteRoundness: 0.26,
  vignetteFeather: 0.8,
  vignetteExposure: 0.1,

  /* --- atmosphere ------------------------------------------------------- */
  hazeColour: '#5e4830',
  hazeStrength: 0.42,
  hazeDepthBias: 0.1,

  /* --- the grade -------------------------------------------------------- *
   * `saturation` BELOW 1 on purpose. Our spine palette is far more saturated
   * than the reference's; pulling the whole frame back is what makes the few
   * genuinely bright things — a flower, a gilt title, the lit arris of a plank
   * — read as accents instead of as more of the same. */
  exposure: 1.04,
  contrast: 0.34,
  saturation: 0.9,
  lift: [-0.075, -0.062, -0.03],
  gamma: [1.0, 0.985, 0.95],
  gain: [1.07, 1.0, 0.91],
  tonemap: 0.82,
  localColour: 0.34,
  grain: 0.011,
} as const;

/* ========================================================================== *
 *                               the rig, per room                            *
 * ========================================================================== */

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle difference into (-π, π]. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The direction a theme's brightest lamp implies, as a key angle.
 *
 * `LightPool` coordinates are viewport fractions with y measured DOWNWARD
 * (`layoutWallLighting` places them at `height * fy`). `keyAngle` is the
 * direction the light *travels*, so it is simply the vector from the lamp
 * toward the middle of the frame — no half-turn. The old code added π here,
 * which is what put the default room's sun in the lower left.
 */
export function themeKeyAngle(theme: LibraryTheme): number | null {
  const key = [...theme.light.pools].sort((a, b) => b.intensity - a.intensity)[0];
  if (key === undefined) return null;
  const dx = 0.5 - key.x;
  const dy = 0.5 - key.y;
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return null;
  return Math.atan2(dy, dx);
}

/**
 * Fold a theme's painterly light description into a deferred rig.
 *
 * `LightSpec` (themes.ts) talks about lamp pools, an ambient cast, a rim and a
 * vignette — the vocabulary the old sprite-based fake used. The deferred pass
 * wants a physical rig, so this maps one onto the other. What a theme gets to
 * change:
 *
 *  - **colour** — key hue, ambient cast, rim, vignette tint;
 *  - **the last 22°** of key direction, around the house upper-right;
 *  - **how much** ambient and rim, within the house's band;
 *  - whether the volumetric shafts are in the room at all.
 *
 * What it does not get to change is the value structure: the falloff, the
 * elevation, the occlusion, the contrast and the saturation are the bible's,
 * and they are the same in every room.
 *
 * `warmth` is the user's own slider (0 = moonlight, 1 = candlelit).
 */
export function rigForTheme(theme: LibraryTheme, warmth: number): LightRig {
  const light = theme.light;
  const w = Number.isFinite(warmth) ? clamp(warmth, 0, 1) : 0.5;
  const key = [...light.pools].sort((a, b) => b.intensity - a.intensity)[0];

  // The room may lean the sun a little, never move it.
  const wanted = themeKeyAngle(theme);
  const keyAngle =
    wanted === null
      ? SHELF_KEY_ANGLE
      : SHELF_KEY_ANGLE +
        clamp(angleDelta(wanted, SHELF_KEY_ANGLE), -KEY_ANGLE_SLACK, KEY_ANGLE_SLACK);

  const ambient = light.ambient;
  const rim = light.rim;
  return {
    ...DEFAULT_LIGHT_RIG,
    ...SHELF_GRADE,
    id: `theme:${theme.id}`,
    label: theme.name,

    keyAngle,
    keyColour: key?.colour ?? DEFAULT_LIGHT_RIG.keyColour,
    // A candlelit room is not a brighter room — it is a warmer, lower one, so
    // warmth moves the key only a little and the temperature split a lot.
    keyIntensity: SHELF_GRADE.keyIntensity * (0.9 + (key?.intensity ?? 0.5) * 0.2),

    // The room's own cast tints the fill and the floor tone, but the LEVEL
    // stays the house's — a room does not get to flood its own shadows.
    ambientColour: ambient.colour,
    ambientLevel: clamp(0.085 + ambient.amount * 0.09, 0.07, 0.185),
    fillIntensity: SHELF_GRADE.fillIntensity + (1 - w) * 0.07,

    rimColour: rim?.colour ?? SHELF_GRADE.rimColour,
    rimStrength: rim === null ? 0.38 : clamp(0.34 + rim.intensity * 0.3, 0.3, 0.72),

    vignette: clamp(SHELF_GRADE.vignette * (0.72 + light.vignette.amount * 0.62), 0.4, 0.66),
    vignetteColour: light.vignette.colour,

    temperatureShift: SHELF_GRADE.temperatureShift + (w - 0.5) * 0.5,

    shafts: light.shafts ? SHELF_SHAFTS : [],
  };
}

/**
 * What the pass runs before a room has been resolved. Same grade and the same
 * sun as every theme, so the first painted frames do not flash a different
 * light from the one that replaces them a moment later.
 */
export const SHELF_DEFAULT_RIG: LightRig = {
  ...DEFAULT_LIGHT_RIG,
  ...SHELF_GRADE,
  shafts: SHELF_SHAFTS,
};

/** Re-exported so callers can talk about the house sun without the constant. */
export { KEY_ANGLE };
