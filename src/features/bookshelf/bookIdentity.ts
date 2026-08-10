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
  effectiveBookTitlePlate,
  resolveBookStyle,
  type BookStyle,
  type ResolveBookStyleOptions,
  type ResolvedBookStyle,
  type SpineThemeDefaults,
} from '../../art/bookStyle';
import {
  COVER_TEXTURES,
  deriveCoverParams,
  normalizeCoverOverrides,
  type CoverOverrides,
} from '../../art/covers';
import {
  bindingMaterialFor,
  bookPreset,
  type BookPresetId,
} from '../../art/bookDesign';
import { clamp } from '../../art/noise';
import {
  materialFromTexture,
  SPINE_BASE_HEIGHT,
  textureFromMaterial,
  type SpineParams,
  type BindingMaterial,
} from '../../art/spines';
import type { LibraryTheme } from '../../art/themes';
import {
  readCoverOverrides,
  readBookStyleOverrides,
  saveBookAppearanceOverrides,
} from '../../data/books';
import {
  holdBookBindingPublication,
  publishedBookBinding,
} from '../../data/designPrefs';
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

interface AppearancePublicationBarrier {
  depth: number;
  dirty: boolean;
}

/** Per-book holds around combined binding + Book-row persistence. */
const appearancePublicationBarriers = new Map<
  string,
  AppearancePublicationBarrier
>();

/** Listen for successfully persisted book-appearance changes. */
export function subscribeBookAppearances(listener: BookAppearanceListener): () => void {
  appearanceListeners.add(listener);
  return () => appearanceListeners.delete(listener);
}

function publishBookAppearance(bookId: string): void {
  const barrier = appearancePublicationBarriers.get(bookId);
  if (barrier !== undefined) {
    barrier.dirty = true;
    return;
  }
  for (const listener of appearanceListeners) listener([bookId]);
}

/**
 * Defer the canonical appearance notification until one complete logical
 * write has settled. The returned release is idempotent; `force` is reserved
 * for a failed rollback, where the world must refresh whatever state really
 * survived rather than keep a confidently stale texture.
 */
function holdBookAppearancePublication(bookId: string): (force?: boolean) => void {
  const existing = appearancePublicationBarriers.get(bookId);
  if (existing === undefined) {
    appearancePublicationBarriers.set(bookId, { depth: 1, dirty: false });
  } else {
    existing.depth += 1;
  }

  let released = false;
  return (force = false) => {
    if (released) return;
    released = true;
    const barrier = appearancePublicationBarriers.get(bookId);
    if (barrier === undefined) return;
    if (force) barrier.dirty = true;
    barrier.depth -= 1;
    if (barrier.depth > 0) return;
    appearancePublicationBarriers.delete(bookId);
    if (!barrier.dirty) return;
    for (const listener of appearanceListeners) listener([bookId]);
  };
}

export interface BookAppearanceHydrationTicket {
  readonly bookId: string | undefined;
  readonly revision: number;
}

/**
 * Monotonic guard for the Studio's asynchronous compatibility hydration.
 *
 * A book read can finish after the reader has already changed the preview, or
 * even after the panel has moved to another book. A timeout/stale boolean is
 * not enough (and returning a cleanup function from Solid's `on()` callback
 * does not register that function as cleanup). Tickets make both invalidation
 * cases explicit and testable.
 */
export function createBookAppearanceHydrationGuard(): {
  begin(bookId: string | undefined): BookAppearanceHydrationTicket;
  invalidate(): void;
  accepts(ticket: BookAppearanceHydrationTicket): boolean;
} {
  let activeBookId: string | undefined;
  let revision = 0;
  return {
    begin(bookId) {
      activeBookId = bookId;
      revision += 1;
      return { bookId, revision };
    },
    invalidate() {
      revision += 1;
    },
    accepts(ticket) {
      return ticket.bookId === activeBookId && ticket.revision === revision;
    },
  };
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
  /* An exact `covering` is a binding/material-look projection, not a reader's
     coarse material pin. Treating its companion `material` bucket as a pin
     makes the shelf replace brocade/goatskin/vellum with generic cloth/leather/
     paper after reopening a binding-only book. Only legacy covers without the
     exact axis contribute a BookStyle material override. */
  if (cover.covering === undefined) {
    if (cover.material !== undefined) style.material = cover.material;
    else if (cover.texture !== undefined) style.material = materialFromTexture(cover.texture);
  }
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
  book: Pick<Book, 'spineSeed' | 'coverMeta'> & Partial<Pick<Book, 'id'>>,
  theme: LibraryTheme,
  opts: ResolveBookStyleOptions = {},
): ResolvedBookStyle {
  const hasStudioStyle = readBookStyleOverrides(book) !== null;
  const binding =
    opts.binding !== undefined
      ? opts.binding
      : book.id !== undefined
        ? publishedBookBinding(book.id)
        : null;
  const resolved = resolveBookStyle(
    book.spineSeed,
    themeSpineDefaults(theme),
    bookStyleOverridesFor(book),
    { ...opts, binding },
  );
  if (hasStudioStyle) return resolved;

  const explicitCover = normalizeCoverOverrides(readCoverOverrides(book));
  if (explicitCover === null) return resolved;
  return {
    ...resolved,
    cover: deriveCoverParams(book.spineSeed, {
      ...coverOverridesFromStyle(resolved.style, {
        binding,
        materialPinned: resolved.pinned.has('material'),
        seed: book.spineSeed,
        titlePlatePinned: resolved.pinned.has('titlePlate'),
      }),
      ...explicitCover,
    }),
  };
}

/**
 * The cover-art view of a resolved style. Every field the cover renderer
 * understands, so the open book cannot drift from the spine.
 */
export interface CoverProjectionOptions {
  /** Exact named/composed binding worn by the book right now. */
  binding?: BookPresetId | null;
  /** Whether that binding is user-pinned (rather than merely the seed result). */
  bindingPinned?: boolean;
  /** A reader-picked coarse material deliberately outranks the binding. */
  materialPinned?: boolean;
  /** Seed authority for inherited title furniture when no binding is pinned. */
  seed?: number;
  /** Distinguishes explicit None from the old latent `none` sentinel. */
  titlePlatePinned?: boolean;
}

export function coverOverridesFromStyle(
  style: BookStyle,
  options: CoverProjectionOptions = {},
): CoverOverrides {
  const exact =
    options.binding !== undefined &&
    options.binding !== null &&
    options.materialPinned !== true
      ? bookPreset(options.binding)
      : null;
  const exactCovering = exact === null ? -1 : COVER_TEXTURES.indexOf(exact.material);
  const material =
    exact === null
      ? style.material
      : (bindingMaterialFor(exact.material) as BindingMaterial);
  const canResolveInheritedTitle =
    options.binding !== undefined || options.seed !== undefined;
  const titlePlate = canResolveInheritedTitle
    ? effectiveBookTitlePlate(
        options.seed ?? 0,
        { titlePlate: style.titlePlate ?? 'none' },
        options.binding ?? null,
        options.titlePlatePinned === true,
      )
    : style.titlePlate;

  return {
    palette: style.pigment,
    // The reader's own cloth colour, so the OPEN book's boards are the same
    // colour as the spine on the shelf. `cover_meta.cover` is a separate blob
    // from `cover_meta.style`, and a field that reaches one and not the other
    // is a book that changes colour when you pick it up.
    clothHex: style.clothHex,
    coverBaseHex: style.coverBaseHex,
    coverAccentHex: style.coverAccentHex,
    toolingHex: style.toolingHex,
    emblemHex: style.emblemHex,
    hardwareHex: style.hardwareHex,
    ...(material === undefined
      ? {}
      : { texture: textureFromMaterial(material), material }),
    ...(exactCovering < 0 ? {} : { covering: exactCovering }),
    frame: style.coverFrame,
    medallion: style.coverMedallion,
    titleFont: style.titleFont,
    gilt: style.gilt,
    titlePlate,
    cornerProtectors: style.cornerProtectors,
    insetPlate: style.insetPlate,
    edge: style.edge,
    wear: style.wear,
    charm: style.charm,
    charmColor: style.charmColor,
  } as CoverOverrides;
}

export type SaveBookAppearance = (
  bookId: string,
  style: Record<string, unknown> | null,
  cover: Record<string, unknown> | null,
) => Promise<unknown>;

/**
 * Provenance carried only by the loose compatibility-cover JSON.
 *
 * Older cover-only readers ignore the extra key and can paint the projected
 * plate. Current readers see it in `normalizeCoverOverrides` and know that the
 * value belongs to the binding rather than to the reader. Keeping this beside
 * the projected value makes a binding-only book round-trip without turning an
 * inherited label into a permanent title-plate pin.
 */
interface PersistedCoverProjection extends Record<string, unknown> {
  titlePlateSource?: 'inherited';
}

/**
 * Persist a Studio edit to both cover_meta sections in one row mutation.
 *
 * A null style still carries a compatibility cover when a user-pinned binding
 * is known. That is the binding-only/imported-book case: the canonical binding
 * remains in designPrefs, while older cover readers receive the same exact
 * covering instead of a seed-random board. A merely seed-derived binding must
 * not be projected into persistence or it would silently become frozen; that
 * case clears both sections and returns the book to inherited defaults.
 */
export async function persistBookStyle(
  bookId: string,
  style: BookStyle | null,
  projection: CoverProjectionOptions = {},
  saveAppearance: SaveBookAppearance = saveBookAppearanceOverrides,
): Promise<void> {
  const cover =
    style === null
      ? projection.binding === undefined ||
        projection.binding === null ||
        projection.bindingPinned === false
        ? null
        : coverOverridesFromStyle({} as BookStyle, projection)
      : coverOverridesFromStyle(style, projection);
  const persistedCover: PersistedCoverProjection | null =
    cover === null
      ? null
      : {
          ...(cover as unknown as Record<string, unknown>),
          ...(cover.titlePlate !== undefined && projection.titlePlatePinned !== true
            ? { titlePlateSource: 'inherited' as const }
            : {}),
        };
  await saveAppearance(
    bookId,
    style === null ? null : ({ ...style } as unknown as Record<string, unknown>),
    persistedCover,
  );
  publishBookAppearance(bookId);
}

/**
 * One logical Book Studio appearance change.
 *
 * `binding` is optional by presence: omitted means this is a style-only edit;
 * an explicit `null` means unpin the binding and return to the seeded one.
 */
export interface OrderedBookAppearanceWrite {
  bookId: string;
  style: BookStyle | null;
  binding?: BookPresetId | null;
  /** Binding used for the compatibility cover projection after this write. */
  projectionBinding?: BookPresetId | null;
  /** True only when projectionBinding is a stored user choice, not the seed. */
  bindingPinned?: boolean;
  materialPinned?: boolean;
  titlePlatePinned?: boolean;
}

export interface OrderedBookAppearanceWriterDeps {
  saveBinding(bookId: string, binding: BookPresetId | null): Promise<unknown>;
  saveStyle(write: OrderedBookAppearanceWrite): Promise<unknown>;
  /** Injectable for the temporal contract tests; production reads this store. */
  readBinding?(bookId: string): BookPresetId | null | Promise<BookPresetId | null>;
  /** Injectable publication gate; production withholds designPrefs listeners. */
  holdBindingPublication?(bookId: string): (commit?: boolean) => void;
}

/** Both persistence halves failed, including the compensating binding write. */
export class BookAppearanceRollbackError extends Error {
  readonly writeError: unknown;
  readonly rollbackError: unknown;

  constructor(writeError: unknown, rollbackError: unknown) {
    super('Could not save the book appearance or restore its previous binding.');
    this.name = 'BookAppearanceRollbackError';
    this.writeError = writeError;
    this.rollbackError = rollbackError;
  }
}

/**
 * Serialize complete appearance decisions in click order.
 *
 * A Surprise press changes a binding in `designPrefs` and a style in
 * `cover_meta`. Starting those writes independently lets a slow first press
 * finish after a fast second one and persist a binding from A beside the style
 * from B. This lane does not allow write B to start until both halves of A are
 * settled. A failed action does not poison the lane; the next reader action can
 * still repair the final state.
 */
export function createOrderedBookAppearanceWriter(
  deps: OrderedBookAppearanceWriterDeps,
): (write: OrderedBookAppearanceWrite) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();

  return (write: OrderedBookAppearanceWrite): Promise<void> => {
    const run = tail.catch(() => undefined).then(async () => {
      const writesBinding = Object.prototype.hasOwnProperty.call(write, 'binding');
      if (!writesBinding) {
        await deps.saveStyle(write);
        return;
      }

      // Once this hold exists, `saveBookBinding` may hydrate and mutate its
      // optimistic store, but renderers keep answering from the last published
      // snapshot. That published value is therefore also the exact rollback
      // target, even on the first click after a cold settings load.
      let previousBinding = deps.readBinding !== undefined
        ? await deps.readBinding(write.bookId)
        : null;
      const releaseBinding = (
        deps.holdBindingPublication ?? holdBookBindingPublication
      )(write.bookId);
      const releaseAppearance = holdBookAppearancePublication(write.bookId);
      let bindingSaved = false;
      let commitBindingSnapshot = false;
      let forceRefresh = false;
      try {
        await deps.saveBinding(write.bookId, write.binding ?? null);
        bindingSaved = true;
        if (deps.readBinding === undefined) {
          previousBinding = publishedBookBinding(write.bookId);
        }
        await deps.saveStyle(write);
        commitBindingSnapshot = true;
      } catch (writeError) {
        if (bindingSaved) {
          try {
            // Compensating write: a rejected second half must not leave a new
            // binding beside the old style in either the optimistic store or
            // persisted settings. It stays behind the same publication hold.
            await deps.saveBinding(write.bookId, previousBinding);
            commitBindingSnapshot = true;
          } catch (rollbackError) {
            // The final state is now genuinely uncertain. Release one forced
            // canonical refresh so the shelf displays what survived, then
            // surface both failures to the caller.
            commitBindingSnapshot = true;
            forceRefresh = true;
            throw new BookAppearanceRollbackError(writeError, rollbackError);
          }
        }
        throw writeError;
      } finally {
        // Release the binding gate first. Its optimistic notifications are
        // intentionally discarded; the appearance event below is the single
        // boundary that refreshes the Book row before invalidating the bake.
        releaseBinding(commitBindingSnapshot);
        releaseAppearance(forceRefresh);
      }
    });
    // Keep a handled tail for the next action while returning the real result
    // to callers that want to surface an error.
    tail = run.catch(() => undefined);
    return run;
  };
}
