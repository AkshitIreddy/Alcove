/**
 * features/bookshelf/lightRig.ts — a room's light, as the deferred pass wants it.
 *
 * Split out of `sceneLight.ts` for the same reason `floraPlan` is split out of
 * `floraTextures`: this is pure arithmetic over theme data, and the unit tests
 * run in a node environment where importing PixiJS throws on `navigator`. The
 * numbers here are the ones the whole shelf is graded by, so they are worth
 * being able to test without a GPU.
 */

import { DEFAULT_LIGHT_RIG, type LightRig } from '../../art/lighting';
import type { LibraryTheme } from '../../art/themes';

/* ========================================================================== *
 *                               the rig, per room                            *
 * ========================================================================== */

/**
 * Fold a theme's painterly light description into a deferred rig.
 *
 * `LightSpec` (themes.ts) talks about lamp pools, an ambient cast, a rim and a
 * vignette — the vocabulary the old sprite-based fake used. The deferred pass
 * wants a physical rig. Rather than add a second, redundant light description
 * to every theme, this maps one onto the other so a room's existing art
 * direction drives the real light: an attic's warm pools become a warm key
 * with deep ambient occlusion, a moonlit study's cool cast becomes a cool key
 * with a hard rim.
 *
 * `warmth` is the user's own slider (0 = moonlight, 1 = candlelit).
 */
export function rigForTheme(theme: LibraryTheme, warmth: number): LightRig {
  const light = theme.light;
  const w = Number.isFinite(warmth) ? Math.min(1, Math.max(0, warmth)) : 0.5;
  // The brightest pool is the room's key; its position gives the key's angle.
  const key = [...light.pools].sort((a, b) => b.intensity - a.intensity)[0];
  // Pool coordinates are viewport fractions; a pool up and to the right means
  // light travelling down and to the left.
  const angle =
    key === undefined
      ? DEFAULT_LIGHT_RIG.keyAngle
      : Math.atan2(0.5 - key.y, 0.5 - key.x) + Math.PI;

  const ambient = light.ambient;
  const rim = light.rim;
  return {
    ...DEFAULT_LIGHT_RIG,
    id: `theme:${theme.id}`,
    label: theme.name,
    keyAngle: angle,
    keyColour: key?.colour ?? DEFAULT_LIGHT_RIG.keyColour,
    // A candlelit room is not a brighter room — it is a warmer, lower one, so
    // warmth moves the key only a little and the temperature split a lot.
    keyIntensity: 0.92 + (key?.intensity ?? 0.5) * 0.26,
    ambientColour: ambient.colour,
    fillIntensity: 0.2 + (1 - w) * 0.16,
    rimColour: rim?.colour ?? DEFAULT_LIGHT_RIG.rimColour,
    rimStrength: rim === null ? 0.26 : 0.24 + rim.intensity * 0.34,
    vignette: Math.min(0.46, light.vignette.amount * 0.8),
    vignetteColour: light.vignette.colour,
    temperatureShift: -0.25 + w * 0.85,
    shafts: light.shafts ? DEFAULT_LIGHT_RIG.shafts : [],

    /* --- the grade, retuned for THIS scene ------------------------------- *
     *
     * `DEFAULT_LIGHT_RIG` was authored against the prototype's specimen board:
     * a few objects on a neutral ground, where a hot key and a generous bloom
     * read as sunlight. Over a real shelf — a whole wall of saturated painted
     * spines against patterned paper — the same numbers blew the cornice and
     * the rails to white and pushed the spines to neon. Rendered six candidate
     * grades over an identical 22-book shelf and compared them side by side
     * (`qa/lit/sheet-rigs.png`); these are the winner.
     *
     * The direction of every change is the same: LESS glow, MORE separation.
     * The reference image's richness is not brightness — it is raking light on
     * form with near-black between the books. */
    ...SHELF_GRADE,
    ambientLevel: Math.min(0.2, 0.08 + ambient.amount * 0.16),
  };
}

/** See the note in {@link rigForTheme}. Shared with the pre-theme default. */
const SHELF_GRADE = {
  hotSpot: 0.34,
  ambientLevel: 0.14,
  ambientOcclusion: 0.82,
  aoPower: 1.45,
  contactStrength: 1.25,
  // A low sun rakes ACROSS the row instead of lighting it from the front,
  // which is what turns thirty rectangles into thirty cylinders.
  keyElevation: 0.22,
  shadowReach: 150,
  bloom: 0.12,
  bloomThreshold: 0.9,
  exposure: 0.98,
  contrast: 0.28,
  saturation: 1.04,
} as const;

/**
 * What the pass runs before a room has been resolved. Same grade as every
 * theme, so the first painted frames do not flash a hotter light than the one
 * that replaces it a moment later.
 */
export const SHELF_DEFAULT_RIG: LightRig = { ...DEFAULT_LIGHT_RIG, ...SHELF_GRADE };
