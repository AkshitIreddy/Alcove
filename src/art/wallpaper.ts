/**
 * art/wallpaper.ts — what is left of the wallpaper library: the names.
 *
 * Eighteen tileable patterns used to be *drawn* here — an ogee damask, a
 * pressed-herbarium toile, combed marble, a PCB trace — each seamless, each
 * crossed with any of eighteen colourways, each baked per (pattern × colourway
 * × size × DPR) and hung behind the case.
 *
 * There is no wall art any more. `world.ts` fills the wall with one flat colour
 * (`FLAT.wall`), which is the only version that never showed a tiling seam
 * while panning, and `EnvTextures.wallpaper` is permanently null. The renderers,
 * the colourways and the graded-print path into the generated sheet library all
 * went with the rest of the painting stack.
 *
 * The catalogue outlives the art because the Library Studio still offers the
 * pattern as a *preference*: `libraryPrefs.wallpaperPattern` is persisted, the
 * picker labels its buttons from this table, and the setting is waiting for
 * whatever the wall becomes next. `WALLPAPER_PATTERN_IDS` — the ids themselves,
 * and every theme's default pairing — live in `art/themes.ts`; this is only the
 * display name for each one.
 */

import type { WallpaperPatternId } from './themes';

/** A pattern the studio can offer, as far as anything still cares. */
export interface WallpaperPattern {
  id: WallpaperPatternId;
  /** Title-case label for the studio picker. */
  name: string;
}

export const WALLPAPER_PATTERNS: Readonly<Record<WallpaperPatternId, WallpaperPattern>> = {
  damask: { id: 'damask', name: 'Damask' },
  'botanical-toile': { id: 'botanical-toile', name: 'Botanical Toile' },
  constellation: { id: 'constellation', name: 'Constellation' },
  'ditsy-floral': { id: 'ditsy-floral', name: 'Ditsy Floral' },
  'gingham-floral': { id: 'gingham-floral', name: 'Gingham & Ditsy' },
  'rice-paper-bamboo': { id: 'rice-paper-bamboo', name: 'Rice Paper & Bamboo' },
  'lath-plaster': { id: 'lath-plaster', name: 'Lath & Plaster' },
  'apothecary-labels': { id: 'apothecary-labels', name: 'Apothecary Labels' },
  'art-nouveau-vine': { id: 'art-nouveau-vine', name: 'Art Nouveau Vine' },
  'marbled-endpaper': { id: 'marbled-endpaper', name: 'Marbled Endpaper' },
  'pin-dot': { id: 'pin-dot', name: 'Pin Dot' },
  'plain-limewash': { id: 'plain-limewash', name: 'Plain Limewash' },
  'blossom-sky': { id: 'blossom-sky', name: 'Blossom Sky' },
  'circuit-trace': { id: 'circuit-trace', name: 'Circuit Trace' },
  'fern-footprint': { id: 'fern-footprint', name: 'Fern & Footprint' },
  'peppermint-stripe': { id: 'peppermint-stripe', name: 'Peppermint Stripe' },
  'reef-bubble': { id: 'reef-bubble', name: 'Reef & Bubbles' },
  nebula: { id: 'nebula', name: 'Nebula' },
};
