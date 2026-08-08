/**
 * features/bookshelf/bookIdentity.ts — one book, three places.
 *
 * "A customized book keeps its identity on the shelf, mid-pull-out, and open"
 * (docs/design/library-themes.md §5). All three renderers resolve the same
 * `ResolvedBookStyle` here:
 *
 *   shelf spine   → SpineParams   (spineFactory, from cover_meta.style)
 *   pull-out ghost→ CoverParams   (PulledBookOverlay, from cover_meta.style)
 *   opened book   → CoverParams    (BookView, from the same resolution)
 *
 * `cover_meta.style` is canonical; `cover_meta.cover` remains a compatibility
 * input, but opening never migrates it. Identity is a read-time invariant.
 */

import {
  resolveBookStyle,
  type BookStyle,
  type ResolveBookStyleOptions,
  type ResolvedBookStyle,
  type SpineThemeDefaults,
} from '../../art/bookStyle';
import {
  deriveCoverParams,
  normalizeCoverOverrides,
  type CoverOverrides,
} from '../../art/covers';
import { clamp } from '../../art/noise';
import {
  materialFromTexture,
  SPINE_BASE_HEIGHT,
  textureFromMaterial,
  type SpineParams,
} from '../../art/spines';
import type { LibraryTheme } from '../../art/themes';
import {
  readCoverOverrides,
  readBookStyleOverrides,
  saveBookStyleOverrides,
  saveCoverOverrides,
} from '../../data/books';
import type { Book } from '../../data/types';
import { mapPigmentRamp } from './spinePalette';

/*
 * The Pixi world stays mounted (and paused) while a book is open, so changing
 * cover_meta in the editor does not naturally travel through its paged
 * FloorStore. A small domain event closes that seam: it is emitted only after
 * both canonical style and cover projection have reached SQLite, and the
 * world can then re-read the row before invalidating its baked spine.
 */
export type BookAppearanceListener = (bookIds: readonly string[]) => void;

const appearanceListeners = new Set<BookAppearanceListener>();

/** Listen for successfully persisted book-appearance changes. */
export function subscribeBookAppearances(listener: BookAppearanceListener): () => void {
  appearanceListeners.add(listener);
  return () => appearanceListeners.delete(listener);
}

function publishBookAppearance(bookId: string): void {
  for (const listener of appearanceListeners) listener([bookId]);
}

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
 * Cover-only books predate the studio's shared style blob. Fold every field
 * that has a spine/style equivalent into the resolver so that respecting an
 * old cover choice does not make the shelf wear a different book.
 *
 * This is a read-time compatibility floor, not a migration. Cover-only knobs
 * with no BookStyle equivalent (for example one of the later lettering hands)
 * remain on the cover and are merged by `resolveBookAppearance` below.
 */
function legacyCoverStyleFloor(
  book: Pick<Book, 'coverMeta'>,
): Record<string, unknown> | null {
  const cover = normalizeCoverOverrides(readCoverOverrides(book));
  if (cover === null) return null;

  const style: Record<string, unknown> = {};
  if (cover.palette !== undefined) style.pigment = cover.palette;
  if ('clothHex' in cover) style.clothHex = cover.clothHex;
  if (cover.material !== undefined) style.material = cover.material;
  else if (cover.texture !== undefined) style.material = materialFromTexture(cover.texture);
  if (cover.frame !== undefined) style.coverFrame = cover.frame;
  if (cover.medallion !== undefined) style.coverMedallion = cover.medallion;
  // BookStyle has three base title faces. Later cover-only hands still survive
  // in the explicit cover merge even though a spine cannot represent them.
  if (cover.titleFont !== undefined && cover.titleFont <= 2) {
    style.titleFont = cover.titleFont;
  }
  if (cover.gilt !== undefined) style.gilt = cover.gilt;
  if (cover.titlePlate !== undefined) style.titlePlate = cover.titlePlate;
  if (cover.cornerProtectors !== undefined) {
    style.cornerProtectors = cover.cornerProtectors;
  }
  if (cover.insetPlate !== undefined) style.insetPlate = cover.insetPlate;
  if (cover.edge !== undefined) style.edge = cover.edge;
  if (cover.wear !== undefined) style.wear = cover.wear;
  if (cover.charm !== undefined) style.charm = cover.charm;
  if (cover.charmColor !== undefined) style.charmColor = cover.charmColor;

  return Object.keys(style).length > 0 ? style : null;
}

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
  // A style blob supersedes its old cover projection. When no style exists,
  // however, the cover is the user's only customization record and must feed
  // the shared identity rather than being discarded.
  const cover = style === null ? legacyCoverStyleFloor(book) : null;
  const legacy = book.coverMeta?.palette;
  const pigment =
    typeof legacy === 'string' ? LEGACY_PALETTE_PIGMENT[legacy] : undefined;
  const merged = {
    ...(pigment === undefined ? {} : { pigment }),
    ...(cover ?? {}),
    ...(style ?? {}),
  };
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Resolve one book once for every place it is drawn.
 *
 * A studio style is the source of truth and its possibly stale `cover`
 * projection is ignored. A pre-studio cover-only book keeps that explicit
 * face, layered over the same resolved style the shelf uses. No persistence
 * occurs here: opening an old library never rewrites or "upgrades" its data.
 */
export function resolveBookAppearance(
  book: Pick<Book, 'spineSeed' | 'coverMeta'>,
  theme: LibraryTheme,
  opts: ResolveBookStyleOptions = {},
): ResolvedBookStyle {
  const hasStudioStyle = readBookStyleOverrides(book) !== null;
  const resolved = resolveBookStyle(
    book.spineSeed,
    themeSpineDefaults(theme),
    bookStyleOverridesFor(book),
    opts,
  );
  if (hasStudioStyle) return resolved;

  const explicitCover = normalizeCoverOverrides(readCoverOverrides(book));
  if (explicitCover === null) return resolved;
  return {
    ...resolved,
    cover: deriveCoverParams(book.spineSeed, {
      ...coverOverridesFromStyle(resolved.style),
      ...explicitCover,
    }),
  };
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
  publishBookAppearance(bookId);
}
