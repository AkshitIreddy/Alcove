/**
 * features/bookshelf/bookIdentity.ts — one book, three places.
 *
 * "A customized book keeps its identity on the shelf, mid-pull-out, and open"
 * (docs/design/library-themes.md §5). Three renderers read three different
 * things today:
 *
 *   shelf spine   → SpineParams   (spineFactory, from cover_meta.style)
 *   pull-out ghost→ CoverParams   (PulledBookOverlay, from cover_meta.style)
 *   opened book   → CoverOverrides(BookView, from cover_meta.cover)
 *
 * So the studio writes BOTH sections: the merged style under `style`, and its
 * cover-facing projection under `cover`. This module owns that projection and
 * the write, so the studio, the shelf and any QA harness agree byte for byte.
 */

import type { BookStyle, SpineThemeDefaults } from '../../art/bookStyle';
import type { CoverOverrides } from '../../art/covers';
import { clamp } from '../../art/noise';
import { SPINE_BASE_HEIGHT, textureFromMaterial, type SpineParams } from '../../art/spines';
import type { LibraryTheme } from '../../art/themes';
import {
  readBookStyleOverrides,
  saveBookStyleOverrides,
  saveCoverOverrides,
} from '../../data/books';
import type { Book } from '../../data/types';
import { mapPigmentRamp } from './spinePalette';

/**
 * A room's spine bias, in the vocabulary `resolveBookStyle` actually reads.
 *
 * `art/themes.ts` describes `spineDefaults` the way a designer would — a HEX
 * pigment ramp, a 0-1 "how banded is this room" dial — while
 * `normalizeThemeDefaults` wants pigment INDICES and a raised-cord range. Left
 * unbridged, three of the five theme fields are silently dropped and every
 * room's books look the same. This is that bridge, and it is why the
 * observatory's shelves read midnight-and-silver while the cottage's read
 * blush-and-butter.
 */
export function themeSpineDefaults(theme: LibraryTheme): SpineThemeDefaults {
  const d = theme.spineDefaults;
  const bands = Math.min(1, Math.max(0, d.bands));
  const wear = Math.min(1, Math.max(0, d.wear));
  return {
    materials: d.materials,
    pigments: mapPigmentRamp(d.pigments),
    hueJitter: 7,
    giltChance: Math.min(1, Math.max(0, d.gilt)),
    // A "flat" room still gets the odd corded book, a "banded" room rarely
    // gets a flat one — a range reads as a house style, a constant as a stamp.
    raisedBands: [Math.round(bands * 2), Math.round(1 + bands * 4)] as const,
    headTailChance: 0.35 + bands * 0.4,
    wear: [Math.max(0, wear - 0.12), Math.min(1, wear + 0.2)] as const,
    charmChance: 0.34,
  };
}

/**
 * World-px height the spine art is baked and drawn at. The studio's `height`
 * (150-290, from the bibliographic format band) wins; books from before the
 * studio fall back to the classic base height plus their seeded jitter.
 */
export function spineArtHeight(params: SpineParams): number {
  const h = params.height;
  if (typeof h === 'number' && Number.isFinite(h)) return clamp(h, 120, 300);
  return SPINE_BASE_HEIGHT + params.hJitter;
}

/**
 * Pigment names the pre-studio data layer used (`cover_meta.palette`), mapped
 * onto the 12 spine pigments.
 */
const LEGACY_PALETTE_PIGMENT: Readonly<Record<string, number>> = {
  amber: 0,
  terracotta: 1,
  moss: 2,
  sky: 3,
  plum: 4,
  lemon: 5,
  sage: 6,
  peach: 1,
  clay: 8,
  lavender: 4,
  sand: 8,
  slate: 10,
  blush: 11,
};

/**
 * The full override blob for a book: its studio style, sitting on top of the
 * legacy `cover_meta.palette` hint.
 *
 * That hint is how the seeded Welcome book asks to be amber, and the doc is
 * explicit that "an explicit per-book override always wins" — so a room may
 * not repaint a book whose colour was chosen for it, in any room, ever.
 */
export function bookStyleOverridesFor(
  book: Pick<Book, 'coverMeta'>,
): Record<string, unknown> | null {
  const style = readBookStyleOverrides(book);
  const legacy = book.coverMeta?.palette;
  const pigment =
    typeof legacy === 'string' ? LEGACY_PALETTE_PIGMENT[legacy] : undefined;
  if (pigment === undefined) return style;
  return { pigment, ...(style ?? {}) };
}

/**
 * The cover-art view of a resolved style. Every field the cover renderer
 * understands, so the open book cannot drift from the spine.
 */
export function coverOverridesFromStyle(style: BookStyle): CoverOverrides {
  return {
    palette: style.pigment,
    // The reader's own cloth colour, so the OPEN book's boards are the same
    // colour as the spine on the shelf. `cover_meta.cover` is a separate blob
    // from `cover_meta.style`, and a field that reaches one and not the other
    // is a book that changes colour when you pick it up.
    clothHex: style.clothHex,
    texture: textureFromMaterial(style.material),
    frame: style.coverFrame,
    medallion: style.coverMedallion,
    titleFont: style.titleFont,
    gilt: style.gilt,
    material: style.material,
    titlePlate: style.titlePlate,
    cornerProtectors: style.cornerProtectors,
    insetPlate: style.insetPlate,
    edge: style.edge,
    wear: style.wear,
    charm: style.charm,
    charmColor: style.charmColor,
  } as CoverOverrides;
}

/**
 * Persist a studio edit to both cover_meta sections. `null` clears them, which
 * puts the book back to "follow the room".
 */
export async function persistBookStyle(
  bookId: string,
  style: BookStyle | null,
): Promise<void> {
  await saveBookStyleOverrides(
    bookId,
    style === null ? null : ({ ...style } as unknown as Record<string, unknown>),
  );
  await saveCoverOverrides(
    bookId,
    style === null
      ? null
      : (coverOverridesFromStyle(style) as unknown as Record<string, unknown>),
  );
}
