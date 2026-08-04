/**
 * art/covers.ts — the front cover, drawn in the icon's flat language.
 *
 * The app icon (`assets/brand/icon.svg`) *is* a book cover, seen at an angle,
 * and everything on it is a note about how a cover should be built: a flat
 * cloth board, a darker spine strip down one side, three gilt bands across
 * that spine, one pale ornamental frame inset from the edge with a dot at each
 * corner, a cream label carrying a few ruled lines, a small gilt medallion
 * below it, and a moss ribbon hanging out of the bottom. This file draws that,
 * parameterised, at any size.
 *
 * ## Why it is no longer painted
 *
 * The previous cover was a simulation: layered multiply gradients for the
 * board's form, photographic material tiles dyed to a pigment, a vignette, a
 * fore-edge highlight, blind-tooled relief passes, a granulation overlay and
 * four light-rig passes on top. It cost a second to bake a single cover and
 * still read as cheap, because a half-simulated leather sits in the uncanny
 * gap between drawing and photograph and gets no credit from either. A flat
 * illustration never makes that promise, so it never breaks it — and it bakes
 * in a couple of milliseconds.
 *
 * Depth here is what it is everywhere else in the app: a darker flat face
 * beside a lighter one. There is no light direction in this file, and there is
 * no gradient. See `art/flat.ts` for the vocabulary and the reasoning.
 *
 * ## What survived the restyle
 *
 * The whole parameter surface. `CoverParams` is unchanged — a book's cover
 * still derives from the same 32-bit seed as its shelf spine, users can still
 * override any knob through `cover_meta`, and the Book Studio still drives all
 * of it. Some knobs simply express themselves differently now: `wear` rounds
 * the boards' corners rather than grinding dirt into them.
 *
 * ## The five vocabularies a board wears
 *
 * Every one of them is fifty wide, and not one of them is a table of its own:
 *
 *   palette    50 pigments, DERIVED from `spines.PIGMENT_COUNT`
 *   covering   50 bindings, DERIVED from `bookDesign.MATERIAL_LOOKS`
 *   frame      50 tooled borders, COMPOSED from five orthogonal traits
 *   medallion  50 stamps, DERIVED from `spines.ORNAMENT_COUNT`
 *   titleFont  50 hands, COMPOSED from the five bundled faces
 *
 * Derived where the spine already has the vocabulary — a board and a spine are
 * two faces of ONE object, and a second table kept in step by hand is the
 * promise this file has already broken twice (see `COVER_PALETTE_COUNT`).
 * Composed where the cover is the only surface that has the room for it: a
 * frame and a hand are things a spine 25px wide cannot say at all.
 *
 * Every count is read off its own table. Not one of them is a literal.
 *
 * Bake-once: `coverDataUrl` memoizes the rendered PNG per
 * (seed+overrides+size+title) key so overlays and backdrops never re-paint.
 */

import { CHARM_COLORS, charmCloth, type CharmKind } from './charms';
import {
  MATERIALS,
  MATERIAL_LOOKS,
  bindingMaterialFor,
  materialLookFor,
  presetForSeed,
  type MaterialLook,
  type MaterialSpec,
} from './bookDesign';
import { normaliseHex } from './customColour';
import { clothPair as foldCloth } from './palette';
import { mixHex } from './shelfDesign';
import {
  CLOTHS,
  FLAT,
  flatSchemeTag,
  inkWidth,
  panel,
  stroke,
  wobbleRect,
  type FlatCtx,
} from './flat';
import { clamp, mulberry32 } from './noise';
import { textWidth } from './textMetrics';
import {
  ORNAMENT_COUNT,
  PIGMENT_COUNT,
  clothForPalette,
  deriveSpineParams,
  drawOrnament,
  materialFromTexture,
  textureFromMaterial,
  type BindingMaterial,
  type EdgeTreatment,
  type TitlePlateStyle,
} from './spines';

/* --------------------------------- params -------------------------------- */

/**
 * How wide a book's board is, as a fraction of its height.
 *
 * ONE number, because a book is a book: what changes between a folio and a
 * pocket duodecimo is how BIG the object is, not how differently shaped. The
 * pull-out overlay has always drawn its ghost at this ratio, so anything else
 * that shows a whole cover — the studio preview above all — has to use the
 * same one or the book changes proportion between two views of itself.
 *
 * That was the bug: the studio drew every cover into a fixed 214×292 box while
 * drawing the spine at the book's real height, so a pocket book previewed with
 * a short spine beside a folio-sized board.
 */
export const COVER_ASPECT = 0.72;

/**
 * How many pigment slots a cover's `palette` spans.
 *
 * DERIVED from `spines.PIGMENT_COUNT`, never written as a number. The spine
 * derives `palette` from the pigment table and `deriveCoverParams` copies it
 * across verbatim so the shelf and the pull-out agree about which book this is
 * — so the moment this constant disagrees with that table, the cover is
 * validating a range it does not actually receive. It was hard-coded 20, the
 * pigment table grew to 50, and covers started arriving with a palette outside
 * their own declared bound.
 */
export const COVER_PALETTE_COUNT = PIGMENT_COUNT;
/* COVER_FRAME_COUNT is exported beside the FRAMES table it counts, further
 * down. Restating it here as a literal is the exact mistake COVER_PALETTE_COUNT
 * made — it sat at 20 while the table it described grew to 50. */

/**
 * DERIVED from the spine's stamp table, not restated.
 *
 * The medallion IS the spine's ornament drawn large — one book, one tool. It
 * was hard-coded 8 and folded from a 12-then-50 entry table with `% 8`, so a
 * book's board carried a different device from its spine. Deriving it is also
 * the rule this file learned the hard way with COVER_PALETTE_COUNT, which sat
 * at 20 while the pigment table it described grew to 50.
 */
export const COVER_MEDALLION_COUNT = ORNAMENT_COUNT;

/**
 * The fifty coverings a board can be bound in.
 *
 * DERIVED from the spine's own table (`bookDesign.MATERIAL_LOOKS`), not a
 * cover-specific fifty — and that was the choice, deliberately. A board and a
 * spine are two faces of ONE object: if the shelf shows a book grained like
 * goatskin and the pull-out shows a smooth cloth, the reader is looking at two
 * books. A second table of fifty would have had to be kept in step with the
 * first by hand, which is the same promise `COVER_PALETTE_COUNT` and
 * `COVER_MEDALLION_COUNT` both failed to keep before they were derived.
 *
 * This used to be three strings — labels for the legacy `texture` bucket — and
 * nothing read them. Those three now live on as `COVER_TEXTURE_BUCKETS`, which
 * is what `CoverParams.texture` still means.
 */
export const COVER_TEXTURES: readonly MaterialLook[] = MATERIAL_LOOKS;
/** How many coverings a board can wear. Derived, never restated. */
export const COVER_TEXTURE_COUNT = COVER_TEXTURES.length;
/** Display names for the studio's covering picker. */
export const COVER_TEXTURE_LABELS: readonly string[] = COVER_TEXTURES.map(
  (id) => MATERIALS[id].name,
);
/* COVER_FONTS / COVER_FONT_COUNT / COVER_FONT_KIN are exported beside the HANDS
 * table they describe, further down — a table and its count have to be able to
 * disagree only by someone deleting a line, never by someone forgetting one. */

export interface CoverParams {
  /** Seed the params were derived from (drives render-time jitter too). */
  seed: number;
  /**
   * Which cloth the boards are bound in — a pigment slot, inherited from the
   * spine's own palette roll and folded onto the house cloths by
   * `spines.clothForPalette`. `COVER_PALETTE_COUNT` wide, whatever that is
   * today.
   */
  palette: number;
  /**
   * A cloth colour the READER typed, `#rrggbb`, overruling `palette`.
   *
   * It is here and not only on the spine because the shelf and the pull-out
   * are two views of ONE book: an override that reached the spine alone is
   * exactly the split `tests/covers.test.ts` exists to catch — a book that
   * changes colour when you pick it up.
   */
  clothHex?: string | null;
  /**
   * Legacy covering bucket: 0 = cloth, 1 = leather, 2 = paper. Kept because
   * `cover_meta` blobs in the wild carry it and `material` is derived from it.
   * `covering` is what actually grains a board now; this stays the three-way
   * bucket the older blobs and `spines.textureFromMaterial` speak in.
   */
  texture: 0 | 1 | 2;
  /**
   * Which of the fifty coverings the boards are bound in — an index into
   * `COVER_TEXTURES`, which IS the spine's table.
   *
   * Optional so that pre-covering `CoverParams` literals still render; absent,
   * `coveringSpecFor` falls back through the seven studio chips exactly as this
   * file did before the axis existed.
   */
  covering?: number;
  /** Tooled frame — an index into the fifty composed in `FRAMES`. */
  frame: number;
  /** Centre medallion — an index into the spine's fifty ornament stamps. */
  medallion: number;
  /**
   * Title hand — an index into `COVER_FONTS`, fifty of them.
   *
   * 0, 1 and 2 are still plain Caveat / Kalam / Patrick Hand, because the field
   * is index-addressed by saved `cover_meta` blobs; the other forty-seven are
   * those five bundled faces set as a binder letters a board (weight, tracking,
   * case, slope, size). It was typed `0 | 1 | 2` and is a plain number now.
   */
  titleFont: number;
  /** Gilt (gold) frame accents, medallion and title plate trim. */
  gilt: boolean;

  /* ---------------------- Book Studio additions (§4) ---------------------- */
  /* Optional, so pre-studio CoverParams literals still typecheck and render.
   * deriveCoverParams always fills them, inheriting from the spine so the
   * shelf → pull-out → open-book journey never changes the book's identity. */

  /**
   * Binding material. Flat art carries one distinction the eye can actually
   * make across a room: `vellum` and `paper` bind as a pale half-bound board,
   * everything else as dyed cloth.
   */
  material?: BindingMaterial;
  /** Title plate treatment (mirrors the spine's). */
  titlePlate?: TitlePlateStyle;
  /** Metal corner protectors on the four cover corners. */
  cornerProtectors?: boolean;
  /** Recess the title plate into a bevelled inset panel. */
  insetPlate?: boolean;
  /** Fore-edge treatment of the text block. */
  edge?: EdgeTreatment;
  /** Wear, 0 (pristine) → 1 (well-loved): rounder corners, less fine tooling. */
  wear?: number;
  /** The book's charm, drawn cover-side. */
  charm?: CharmKind;
  /** Index into charms.CHARM_COLORS, or a hex the reader chose themselves. */
  charmColor?: number | string;
  /**
   * Sub-treatment within the material (crackled vs pebbled leather, ribbed vs
   * flat cloth…), inherited from the spine. It described a grain, so nothing
   * on a flat board reads it; kept so the studio round-trips a book's saved
   * style untouched.
   */
  boardStyle?: number;
}

/** The user-overridable subset of CoverParams (everything but the seed). */
export type CoverOverrides = Partial<Omit<CoverParams, 'seed'>>;

/**
 * Tolerantly read a cover-override object out of untrusted JSON (the
 * `cover_meta.cover` blob). Unknown keys are dropped, invalid values are
 * dropped (never clamped into meaning), and a value-less result is null.
 */
export function normalizeCoverOverrides(raw: unknown): CoverOverrides | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out: CoverOverrides = {};

  const int = (value: unknown, max: number): number | undefined =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < max
      ? value
      : undefined;

  const palette = int(source.palette, COVER_PALETTE_COUNT);
  if (palette !== undefined) out.palette = palette;
  // A colour the reader typed. `null` is meaningful here and is NOT the same
  // as absent: it is "go back to the pigment", which a blob written by a
  // reader who cleared their own colour has to be able to say.
  if (source.clothHex === null) out.clothHex = null;
  else {
    const clothHex = normaliseHex(source.clothHex);
    if (clothHex !== null) out.clothHex = clothHex;
  }
  const texture = int(source.texture, 3);
  if (texture !== undefined) out.texture = texture as 0 | 1 | 2;
  const covering = int(source.covering, COVER_TEXTURE_COUNT);
  if (covering !== undefined) out.covering = covering;
  const frame = int(source.frame, COVER_FRAME_COUNT);
  if (frame !== undefined) out.frame = frame;
  const medallion = int(source.medallion, COVER_MEDALLION_COUNT);
  if (medallion !== undefined) out.medallion = medallion;
  const titleFont = int(source.titleFont, COVER_FONT_COUNT);
  if (titleFont !== undefined) out.titleFont = titleFont;
  if (typeof source.gilt === 'boolean') out.gilt = source.gilt;

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Derive the cover parameter set for one book. Shares palette / texture /
 * title face / gilt / ornament family with the spine derived from the same
 * seed (visual continuity shelf → pull-out), then rolls the cover-only
 * knobs from an offset stream. `overrides` (already normalized) wins last.
 */
export function deriveCoverParams(
  seed: number,
  overrides?: CoverOverrides | null,
): CoverParams {
  const spine = deriveSpineParams(seed >>> 0);
  const rnd = mulberry32((seed ^ 0x0c0feba1) >>> 0);
  // The covering the book's BINDING wears — the same call `renderSpine` makes
  // when the reader has not pinned one, so an untouched book is grained the
  // same way on both of its faces.
  const bound = presetForSeed(seed >>> 0).material;
  const derived: CoverParams = {
    seed: seed >>> 0,
    palette: spine.palette,
    clothHex: spine.clothHex ?? null,
    texture: spine.texture,
    covering: coveringIndex(bound),
    frame: Math.floor(rnd() * COVER_FRAME_COUNT),
    // The medallion IS the spine's stamp, and the two tables are the same table
    // now — the fold is kept because `ornament` is an index off a stream that
    // has no idea how wide the stamp table is.
    medallion: spine.ornament % COVER_MEDALLION_COUNT,
    titleFont: handForFace(spine.font, seed >>> 0),
    gilt: spine.gilt || rnd() < 0.18,
    // Studio fields: inherited from the spine wherever the book already has
    // an opinion, plus two cover-only rolls.
    material: spine.material ?? materialFromTexture(spine.texture),
    titlePlate: spine.titlePlate ?? 'none',
    cornerProtectors: rnd() < 0.24,
    insetPlate: rnd() < 0.4,
    edge: spine.edge ?? 'plain',
    wear: spine.wear ?? 0.12,
    charm: spine.charm ?? 'none',
    charmColor: spine.charmColor ?? 0,
    // Sub-treatment within the material: a spine bound in crackled leather
    // must pull out into a cover in crackled leather.
    boardStyle: spine.boardStyle ?? 0,
  };
  const merged = overrides ? { ...derived, ...overrides } : derived;
  // A material override must drag the legacy texture bucket along, or the
  // two disagree and the cover paints a cloth weave under a silk sheen.
  if (overrides?.material !== undefined && overrides.texture === undefined) {
    merged.texture = textureFromMaterial(overrides.material);
  }
  // …and the covering with it, but ONLY when the chip disagrees with what the
  // binding already wears.
  //
  // The studio hands `material` down on every save, pinned or not (it is how a
  // chip reports what the reader is looking at — see `bindingMaterialFor`), so
  // dragging unconditionally would collapse all fifty coverings onto the seven
  // chips the moment anybody opened the panel, while the spine kept its fifty.
  // That is the exact split this file exists to catch, arriving through the one
  // door left open. A chip that no longer matches the binding is the reader
  // having MOVED it, and that does say "make the whole book this".
  if (
    overrides?.material !== undefined &&
    overrides.covering === undefined &&
    overrides.material !== bindingMaterialFor(bound)
  ) {
    merged.covering = coveringIndex(materialLookFor(overrides.material));
  }
  return merged;
}

/** Where a covering sits in `COVER_TEXTURES`; unknown ones land on the first. */
function coveringIndex(look: MaterialLook): number {
  const i = COVER_TEXTURES.indexOf(look);
  return i < 0 ? 0 : i;
}

/**
 * The covering a set of params is bound in.
 *
 * Three answers, narrowest first: the `covering` index when there is one, the
 * seven studio chips when there is not (a pre-covering blob, or a caller that
 * only knows `material`), and the legacy three-way bucket under that. Total,
 * because a board with no covering at all is a board that cannot be drawn.
 */
export function coveringSpecFor(params: CoverParams): MaterialSpec {
  const i = params.covering;
  if (typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < COVER_TEXTURES.length) {
    return MATERIALS[COVER_TEXTURES[i] as MaterialLook];
  }
  return MATERIALS[materialLookFor(params.material ?? materialFromTexture(params.texture))];
}

/* --------------------------------- colors -------------------------------- */

/**
 * The board a covering makes of the book's own colour.
 *
 * This used to be a two-way switch — `PALE_BINDINGS` held vellum and paper, and
 * everything else got the plain dyed cloth. The reasoning was that flat art has
 * no grain, so a material can only say one thing. That was true when materials
 * were seven near-identical entries; `bookDesign` now carries fifty coverings,
 * each with a `body` tone saying how it RELATES to the book's hue — a buckram
 * is the same book in its own darker value, a wrapper is washed most of the way
 * to paper, vellum throws the pigment away and keeps it only on the label.
 *
 * So the cover asks the same table the spine reads rather than keeping its own
 * two-item opinion. Six relationships instead of two, and — the point — a board
 * that agrees with the spine it is bound to.
 *
 * It takes the resolved `MaterialSpec` rather than the studio's seven chips,
 * because the chips are a lossy REPORT of the fifty (`bindingMaterialFor`) and
 * folding through them threw away the forty-three the binding can actually
 * wear — a Library Buckram board came back as plain cloth while its own spine
 * stood there in the deep tone.
 */
function boardFor(
  spec: MaterialSpec,
  cloth: readonly [string, string],
): readonly [string, string] {
  const [face, dark] = cloth;
  switch (spec.body) {
    case 'pale':
      // Washed toward paper but still the book's own colour — a wrapper, not a
      // blank card.
      return [mixHex(face, FLAT.cream, 0.52), dark];
    case 'cream':
    case 'parchment':
      // The pigment is thrown away and lives on the label. Half-bound with a
      // timber spine, because cream-on-cream lost the hinge line and the label
      // had nothing to sit against — and a vellum board with a calf spine is
      // how these were actually made.
      return PALE_BOARD;
    case 'deep':
      return [dark, mixHex(dark, FLAT.ink, 0.35)];
    case 'accent':
      return [face, mixHex(dark, FLAT.ink, 0.25)];
    case 'cloth':
    default:
      return cloth;
  }
}

/**
 * The parchment board, standing in for every pale binding — and half-bound,
 * with a timber spine.
 *
 * The first cut paired cream with creamDeep, which is what a pale binding
 * literally is, and every vellum cover came back as a blank card: the spine
 * strip vanished, the hinge line read as a stray mark and the label had
 * nothing to sit against. Half binding is both the fix and the truth — a
 * vellum board with a calf spine is exactly how these were made.
 */
const PALE_BOARD: readonly [string, string] = [FLAT.cream, FLAT.timber];

/**
 * The cloth a palette index lands on.
 *
 * `palette` still spans twenty slots because the spine derives it from a
 * twenty-entry pigment table and `deriveCoverParams` copies it across verbatim
 * — the shelf and the pull-out have to agree about which book this is. So the
 * fold onto the six flat cloths is NOT done here: `spines.clothForPalette` owns
 * it, and this defers to it. A local `palette % CLOTHS.length` looked
 * equivalent and was not — it gave the same book two colours, terracotta in the
 * hand and ochre on the shelf.
 *
 * The hexes come from the HOUSE `CLOTHS`, because that is what the spine reads.
 *
 * This used to read `flatScheme().cloths` — the ROOM's palette — on the
 * reasoning that the spine did too. The spine stopped doing that when a book
 * was made to keep its own colours in every room (see flatShelf.drawSpine), and
 * this was left behind. It survived only because both tables had six entries
 * and the room's six were near enough to the house six to pass for them.
 *
 * The day `CLOTHS` grew to fifty it became a real bug: a room has six cloths, so
 * every slot from 6 up hit the `?? cloths[0]` fallback and the cover came out
 * terracotta while the spine wore whatever it had been dressed in. That is the
 * exact split `tests/covers.test.ts` exists to catch — a book that changes
 * colour when you pick it up.
 */
function clothFor(palette: number, clothHex?: string | null): readonly [string, string] {
  // A colour the reader typed is not in the table, so it is folded rather than
  // looked up — by `palette.clothPair`, the same routine `art/bookDesign.ts`
  // folds the spine's custom cloth with, so the two faces of one book are
  // arrived at by one piece of arithmetic and cannot disagree.
  const own = normaliseHex(clothHex);
  if (own !== null) return foldCloth(own);
  const slot = clothForPalette(palette);
  return (CLOTHS[slot] ?? CLOTHS[0]!) as readonly [string, string];
}

/**
 * The book's SECOND cloth — what a figured silk is figured in, what a flecked
 * cloth is flecked with.
 *
 * The arithmetic is `bookDesign.resolveBookDesign`'s, character for character,
 * including its "the accent must never equal the cloth" guard. That is the
 * point of copying it rather than rolling a fresh one here: the spine already
 * has an accent for this book, and a board figured in a different second
 * colour from its own spine is the split this file exists to catch, arriving
 * one shade at a time instead of all at once.
 *
 * It is a house `CLOTHS` slot even when the reader has typed their own cloth,
 * exactly as it is on the spine — a custom colour leaves the second colour
 * where the seed put it rather than dragging the figuring along with it.
 */
function accentFor(palette: number, seed: number): string {
  const len = CLOTHS.length;
  const wrap = (n: number): number => ((Math.trunc(n) % len) + len) % len;
  const slot = clothForPalette(palette);
  const accent = wrap(slot + 1 + (((seed >>> 5) % (len - 1)) | 0));
  const pair = CLOTHS[accent === slot ? wrap(slot + 1) : accent] ?? CLOTHS[0]!;
  return pair[0] as string;
}

/**
 * `#rrggbb` → `hsl(h s% l%)`.
 *
 * The customize panel wants CSS swatches, and `FLAT` is the single source of
 * truth for colour — so convert rather than keeping a parallel table that can
 * drift out of step with the art.
 */
function hexToHsl(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = (((g - b) / d) % 6 + 6) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return `hsl(${Math.round(hue)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%)`;
}

/** CSS color pair for one palette (UI swatches in the customize panel). */
export function coverPaletteCss(palette: number): { top: string; bottom: string } {
  const [face, dark] = clothFor(palette);
  return { top: hexToHsl(face), bottom: hexToHsl(dark) };
}


/* ------------------------------- the hands -------------------------------- */

/**
 * Fifty hands out of five faces.
 *
 * ## Why not fifty fonts
 *
 * The app bundles five (`tokens.css`), and it is going to keep bundling five —
 * every extra face is another webfont on the critical path for a mark that is
 * two words long. So a "hand" here is what it is in `scripts/gen-lettering.mjs`,
 * which solved this same problem for the page: a face plus a stationer's
 * treatment — weight, tracking, case, slope and set size. That is what the
 * names in a binder's specimen book describe anyway. "Widely spaced", "small
 * caps" and "shouting" are treatments, not typefaces.
 *
 * ## The two typographic floors are ENFORCED here, not trusted
 *
 * A hand carries a `scale`, and the label already shrinks type to fit its
 * plate, so the two multiply — which is exactly how `gen-lettering.mjs`
 * described putting "footnote hand" at "caption" size under 13px without
 * anybody writing a number below 13 anywhere. `paintLabel` therefore:
 *
 *   - floors the FINAL size (after scale, after the fit loop) rather than the
 *     starting one, so no combination can go under the handwriting floor; and
 *   - drops a Caveat hand to the body face when the fitted size lands under
 *     `--font-heading`'s documented 20px, which is the same fallback the
 *     generator emits as a block of two-attribute rules.
 *
 * ## Kin
 *
 * The spine letters its title in one of THREE faces (`spines.FONTS`), and the
 * board must be lettered with the same tool — that is what makes the two faces
 * one book rather than two objects. So every hand declares which spine face it
 * is a setting OF (`COVER_FONT_KIN`), `deriveCoverParams` rolls only among the
 * kin of the spine's own face, and the two faces the spine has no index for are
 * kin `-1`: offered to a reader who picks one, never handed out by the seed.
 */

/** The five bundled faces. 0–2 are the three the spine can also letter in. */
const FACE_STACKS: readonly string[] = [
  '"Caveat Variable", "Caveat", "Segoe Script", cursive',
  '"Kalam", "Segoe Print", cursive',
  '"Patrick Hand", "Segoe Print", cursive',
  '"Architects Daughter", "Segoe Print", cursive',
  '"Nunito Sans", "Segoe UI", system-ui, sans-serif',
];

/** Caveat's slot, which carries the >= 20px floor all of its own. */
const HEADING_FACE = 0;
/** Where a Caveat hand lands when the plate is too small for Caveat. */
const BODY_FACE = 2;
/** No handwriting below this, in the same unit the label's own floor uses. */
const HAND_FLOOR_PX = 14;
/** `--font-heading` is documented ">= 20px only". */
const HEADING_MIN_PX = 20;

interface HandSpec {
  id: string;
  name: string;
  /** Index into `FACE_STACKS`. */
  face: number;
  /** Set weight. Patrick Hand and Architects Daughter ship one; the browser
   * synthesises the rest, which is what the label has always done at 700. */
  weight: number;
  /** Oblique. Only Caveat and Kalam have a real italic; the rest are slanted. */
  slant: boolean;
  /** `upper` shouts; `small` is uppercase set down a size, which is as close to
   * small caps as a face without an sc axis gets. */
  caps: 'none' | 'upper' | 'small';
  /** Tracking, in ems of the set size. */
  track: number;
  /** Set size relative to what the plate would otherwise give the title. */
  scale: number;
}

const HAND_DEFAULTS: Omit<HandSpec, 'id' | 'name' | 'face'> = {
  weight: 700,
  slant: false,
  caps: 'none',
  track: 0,
  scale: 1,
};

function hand(
  id: string,
  name: string,
  face: number,
  spec: Partial<Omit<HandSpec, 'id' | 'name' | 'face'>> = {},
): HandSpec {
  return { ...HAND_DEFAULTS, ...spec, id, name, face };
}

/**
 * The fifty. **0, 1 and 2 are the originals and must stay where they are** —
 * `titleFont` is index-addressed by every `cover_meta` blob ever saved, and by
 * `bookStyle.TITLE_FONTS`, so reordering the head of this table re-letters
 * books people have already customised.
 */
const HANDS: readonly HandSpec[] = [
  /* --- the three the field has always meant, set exactly as they were --- */
  hand('caveat', 'Caveat', 0),
  hand('kalam', 'Kalam', 1),
  hand('patrick', 'Patrick Hand', 2),

  /* --- Caveat, set as a binder letters a presentation copy (kin 0) --- */
  hand('gilt-script', 'Gilt Script', 0, { scale: 1.1 }),
  hand('flourished', 'Flourished', 0, { slant: true }),
  hand('presentation', 'Presentation', 0, { slant: true, scale: 1.12 }),
  hand('titling', 'Titling', 0, { scale: 1.16, track: 0.02 }),
  hand('dedication', 'Dedication', 0, { weight: 400 }),
  hand('fine-script', 'Fine Script', 0, { weight: 400, slant: true, scale: 1.06 }),
  hand('rubric', 'Rubric', 0, { caps: 'upper', track: 0.07, scale: 0.94 }),
  hand('grand-manner', 'Grand Manner', 0, { scale: 1.28, track: 0.01 }),
  hand('spencerian', 'Spencerian', 0, { slant: true, track: 0.03, scale: 1.08 }),
  hand('vellum-hand', 'Vellum Hand', 0, { weight: 400, scale: 1.2 }),
  hand('scribed-caps', 'Scribed Caps', 0, { caps: 'small', track: 0.08 }),

  /* --- Kalam: the loud face, so the treatments are the loud ones (kin 1) --- */
  hand('light-kalam', 'Light Kalam', 1, { weight: 300 }),
  hand('wide-kalam', 'Wide Kalam', 1, { track: 0.12 }),
  hand('tight-kalam', 'Tight Kalam', 1, { track: -0.02 }),
  hand('marker', 'Marker', 1, { scale: 1.1 }),
  hand('shouted', 'Shouted', 1, { caps: 'upper', track: 0.06 }),
  hand('scrawl', 'Scrawl', 1, { slant: true, track: -0.01 }),
  hand('headline', 'Headline', 1, { scale: 1.24 }),
  hand('sharpie', 'Sharpie', 1, { scale: 1.14, track: 0.01 }),
  hand('crayon', 'Crayon', 1, { scale: 1.08, track: 0.04 }),
  hand('whisper', 'Whisper', 1, { weight: 300, scale: 0.92, track: 0.03 }),
  hand('kalam-caps', 'Kalam Caps', 1, { weight: 300, caps: 'small', track: 0.09 }),

  /* --- Patrick Hand: the quiet face, so the treatments are settings (kin 2) --- */
  hand('plain-set', 'Plain Set', 2, { weight: 400 }),
  hand('wide-set', 'Widely Set', 2, { track: 0.14 }),
  hand('close-set', 'Closely Set', 2, { track: -0.025 }),
  hand('quiet', 'Quiet', 2, { weight: 400, scale: 0.9 }),
  hand('bold-board', 'Bold Board', 2, { scale: 1.12 }),
  hand('slanted', 'Slanted', 2, { slant: true }),
  hand('small-caps', 'Small Caps', 2, { caps: 'small', track: 0.1 }),
  hand('shelf-label', 'Shelf Label', 2, { caps: 'upper', track: 0.08, scale: 0.92 }),
  hand('primer', 'Primer', 2, { scale: 1.06, track: 0.03 }),
  hand('pocket', 'Pocket', 2, { weight: 400, scale: 0.86, track: 0.02 }),
  hand('long-title', 'Long Title', 2, { slant: true, scale: 0.96, track: -0.01 }),

  /* --- Architects Daughter: drawn, upright, and NOT on the spine (kin -1) --- */
  hand('drawn', 'Drawn', 3),
  hand('drawn-wide', 'Drawn Wide', 3, { track: 0.12 }),
  hand('drafting', 'Drafting', 3, { caps: 'upper', track: 0.1, scale: 0.92 }),
  hand('copybook', 'Copybook', 3, { weight: 400, track: 0.04 }),
  hand('chalked', 'Chalked', 3, { scale: 1.08, track: 0.02 }),
  hand('field-note', 'Field Note', 3, { weight: 400, slant: true, scale: 0.94 }),
  hand('ticket', 'Ticket', 3, { caps: 'small', track: 0.09, scale: 0.9 }),

  /* --- Nunito Sans: the stamped trade board, the one printed voice (kin -1) --- */
  hand('printed', 'Printed', 4, { scale: 0.94 }),
  hand('engraved', 'Engraved', 4, { weight: 600, caps: 'upper', track: 0.16, scale: 0.86 }),
  hand('stencil', 'Stencil', 4, { weight: 800, caps: 'upper', track: 0.1, scale: 0.9 }),
  hand('imprint', 'Imprint', 4, { weight: 600, scale: 0.92, track: 0.01 }),
  hand('colophon', 'Colophon', 4, { weight: 600, caps: 'small', track: 0.14, scale: 0.86 }),
  hand('modern', 'Modern', 4, { weight: 400, scale: 0.96 }),
  hand('archive', 'Archive', 4, { weight: 600, caps: 'upper', track: 0.14, scale: 0.84 }),
];

/** Display names for the studio's title-hand picker. */
export const COVER_FONTS: readonly string[] = HANDS.map((f) => f.name);

/**
 * How many hands a title can be lettered in. DERIVED, never restated — the
 * mistake `COVER_PALETTE_COUNT`'s note describes, made once already in this
 * file, is a count that sat at 20 while its table grew to 50.
 */
export const COVER_FONT_COUNT = COVER_FONTS.length;

/**
 * Which of the spine's three faces each hand is a setting of, or `-1` for the
 * two faces the spine has no index for.
 *
 * Index-aligned with `COVER_FONTS`. It exists so a book's board and its spine
 * are lettered with the same tool: `deriveCoverParams` rolls only inside the
 * kin of `SpineParams.font`.
 */
export const COVER_FONT_KIN: readonly number[] = HANDS.map((f) =>
  f.face <= BODY_FACE ? f.face : -1,
);

/** Hands grouped by kin, built once — `deriveCoverParams` runs per book. */
const KIN_HANDS: readonly (readonly number[])[] = [0, 1, 2].map((face) =>
  HANDS.map((_, i) => i).filter((i) => COVER_FONT_KIN[i] === face),
);

/**
 * One hand for a spine face, rolled from the book's own seed.
 *
 * The spine's `font` is 0–2 and always will be; this is the widening. The roll
 * is on its own stream so that adding a hand re-letters some boards and moves
 * nothing else about a book, and an unknown face falls back to the plain
 * setting of face 0 rather than throwing — `deriveCoverParams` is total.
 */
export function handForFace(face: number, seed: number): number {
  const kin = KIN_HANDS[Math.trunc(face)] ?? KIN_HANDS[0]!;
  if (kin.length === 0) return 0;
  const roll = mulberry32((seed ^ 0x1e77e2ed) >>> 0)();
  return kin[Math.min(kin.length - 1, Math.floor(roll * kin.length))]!;
}

/** The hand a `titleFont` index means. Total: junk lands on plain Caveat. */
function handFor(index: number): HandSpec {
  const i = Math.trunc(index);
  return HANDS[i >= 0 && i < HANDS.length ? i : 0]!;
}

/**
 * Has the face this hand is set in actually arrived yet?
 *
 * Canvas does not trigger a webfont load — `ctx.font` with a face the document
 * has never used silently falls back and draws in the generic. That has always
 * been true here, and it stopped being harmless the day a hand could ask for a
 * face nothing else on screen is using: `coverDataUrl` MEMOIZES the PNG, so one
 * bake that lost the race gets served for the rest of the session. The bake
 * itself is fine to do — a fallback title is better than no cover — so the
 * answer is to refuse to CACHE it and let the next call re-bake.
 *
 * Fail-safe in the direction of caching: anything unexpected (no `document`, a
 * throw out of `check`) is treated as ready, because the cost of being wrong
 * that way is a stale face for one session and the cost of being wrong the
 * other way is never caching a cover again.
 */
function handLoaded(index: number, px: number): boolean {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (fonts === undefined || typeof fonts.check !== 'function') return true;
  const h = handFor(index);
  try {
    const slope = h.slant ? 'italic ' : '';
    return fonts.check(`${slope}${h.weight} ${Math.max(10, Math.round(px))}px ${FACE_STACKS[h.face]}`);
  } catch {
    return true;
  }
}

/* ------------------------------- geometry --------------------------------- */

interface Pt {
  x: number;
  y: number;
}

/** Trace a run of points as a path. Nothing is filled or stroked here. */
function tracePoly(ctx: FlatCtx, pts: readonly Pt[], close = true): void {
  const first = pts[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Pt;
    ctx.lineTo(p.x, p.y);
  }
  if (close) ctx.closePath();
}

function polyPts(cx: number, cy: number, r: number, n: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function starPts(cx: number, cy: number, outer: number, inner: number, spikes: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** A filled dot. The frame's corner marks and every ornament centre. */
function dot(ctx: FlatCtx, cx: number, cy: number, r: number, colour: string): void {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.6, r), 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

/** Set up the pen for an ornament run: one colour, one weight, round ends. */
function pen(ctx: FlatCtx, colour: string, width: number): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(0.8, width);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* ------------------------------ the covering ------------------------------ */

/**
 * The fifty coverings, struck on a BOARD instead of a strip.
 *
 * `COVER_TEXTURES` is `bookDesign.MATERIAL_LOOKS` — the same fifty the spine
 * wears — and until this existed that derivation only reached the board's
 * COLOUR, through `MaterialSpec.body`. Fifty names folding onto six tones is a
 * count, not a vocabulary, and a shelf-full of books whose spines were pebbled,
 * ribbed, watered and laid all pulled out into the same plain rectangle.
 *
 * So the board reads the rest of the spec: `split` (where a second covering
 * sits), `grain` (the one mark the covering carries) and `joints`. The
 * arrangement is the spine's, re-proportioned — NOT the spine's code reused.
 * A spine is a 25px strip where a grain has room for six marks before it turns
 * grey, and `bookDesign` sizes every mark for that; a board is the widest thing
 * in the app and the same numbers there would draw six lines across a hand's
 * width of cloth. Same vocabulary, same tones, same names, own scale.
 *
 * Everything here is flat: filled marks and single-weight strokes in colours
 * mixed from the board's own two, drawn under the frame and the label. There is
 * no light in it — a nap is a darker flat band along the fore edge, not a
 * sheen, which is the same trick the spine's `nap` plays and the same one the
 * icon plays with its spine strip.
 */

/** The colour a covering's grain is struck in — the spine's own switch. */
function grainInk(
  spec: MaterialSpec,
  face: string,
  dark: string,
  accent: string,
  gilded: boolean,
  pale: boolean,
): string {
  // A pale board is cream, so every pale tone on it is invisible: `pale` and
  // `cream` marks are folded to the timber the half binding already uses. The
  // frame does the same thing one screen down (`frameInk`), for the same
  // reason — a mark nobody can see is worse than no mark, because the reader
  // is told the covering changed and sees nothing.
  const paled = pale ? mixHex(FLAT.cream, FLAT.timber, 0.55) : mixHex(face, FLAT.cream, 0.42);
  switch (spec.grainTone) {
    case 'deeper':
      return mixHex(dark, FLAT.ink, 0.32);
    case 'pale':
      return paled;
    case 'cream':
      return pale ? mixHex(FLAT.cream, FLAT.timber, 0.4) : FLAT.cream;
    case 'ink':
      return FLAT.inkSoft;
    case 'accent':
      return accent;
    case 'foil':
      // Without leaf a gilt grain is not gold, it is blind tooling: the board's
      // own darker value. Never a highlight.
      return gilded ? FLAT.gilt : mixHex(dark, FLAT.ink, 0.16);
    default:
      return mixHex(dark, FLAT.ink, 0.16);
  }
}

/**
 * The second covering, where a binding has two.
 *
 * On a spine a split is a band across the strip. On a board it is the shape a
 * reader actually recognises a half binding by — leather down the hinge and
 * out over the corners, boards in between — so each name is drawn as the
 * region it names, in the board's darker value with one ink line where the two
 * coverings meet. That line is the whole point: without it the darker region
 * reads as a shadow, and a shadow is the one thing this app does not draw.
 */
function paintSplit(
  ctx: FlatCtx,
  spec: MaterialSpec,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  spineW: number,
  dark: string,
  ink: number,
  seed: number,
): void {
  if (spec.split === 'none') return;
  const faceX = bx + spineW;
  const faceW = bw - spineW;
  const line = Math.max(0.9, ink * 0.55);

  /** A band of the second covering butted against the hinge. */
  const hinge = (frac: number): void => {
    const bandW = faceW * frac;
    ctx.fillStyle = dark;
    ctx.fillRect(faceX, by, bandW, bh);
    stroke(ctx, faceX + bandW, by, faceX + bandW, by + bh, FLAT.ink, line, seed + 1);
  };

  switch (spec.split) {
    case 'quarter':
      hinge(0.1);
      return;
    case 'half':
      hinge(0.26);
      return;
    case 'threeQuarter':
      hinge(0.52);
      return;
    case 'headBand': {
      // A cap over the head of the board — the one split that runs the other
      // way, and the reason `split` is not just a width.
      const capH = bh * 0.16;
      ctx.fillStyle = dark;
      ctx.fillRect(faceX, by, faceW, capH);
      stroke(ctx, faceX, by + capH, bx + bw, by + capH, FLAT.ink, line, seed + 2);
      return;
    }
    default: {
      // tips: leather corners only, cut on the diagonal, which is exactly what
      // a tipped binding looks like from across a room.
      const t = Math.min(faceW, bh) * 0.34;
      for (const [cx, cy, sx, sy] of [
        [faceX, by, 1, 1],
        [bx + bw, by, -1, 1],
        [bx + bw, by + bh, -1, -1],
        [faceX, by + bh, 1, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + sy * t);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + sx * t, cy);
        ctx.closePath();
        ctx.fillStyle = dark;
        ctx.fill();
        stroke(ctx, cx, cy + sy * t, cx + sx * t, cy, FLAT.ink, line, seed + 3);
      }
    }
  }
}

/**
 * The one grain the covering carries, laid over the board's face.
 *
 * Clipped to the face so a mark cannot cross the hinge or leak past the
 * outline — a grain struck over the joint reads as a printing fault, which is
 * the note `bookDesign` leaves about the same problem on the strip.
 */
function paintGrain(
  ctx: FlatCtx,
  spec: MaterialSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
  seed: number,
): void {
  if (spec.grain === 'none') return;
  const rnd = mulberry32((seed ^ 0x9e37) >>> 0);
  // The spine's count is read for a strip six marks wide. A board is roughly
  // five times the width and one and a half times the height of one, so the
  // count is stretched rather than reused: a "sprinkle" of 26 that covered a
  // spine leaves a board almost bare.
  const n = Math.max(2, Math.round(spec.grainCount));
  const unit = Math.min(w, h);
  const fine = Math.max(0.9, unit * 0.006);
  const bold = Math.max(1.1, unit * 0.011);

  const hLine = (t: number, a: number, b: number, weight: number, k: number): void =>
    stroke(ctx, x + w * a, y + h * t, x + w * b, y + h * t, colour, weight, seed + 200 + k);
  const vLine = (a: number, t0: number, t1: number, weight: number, k: number): void =>
    stroke(ctx, x + w * a, y + h * t0, x + w * a, y + h * t1, colour, weight, seed + 260 + k);
  const mark = (cx: number, cy: number, r: number): void => dot(ctx, cx, cy, r, colour);

  /** A stratified field: one mark per cell of a rows × cols lattice. */
  const field = (
    rows: number,
    cols: number,
    draw: (cx: number, cy: number, i: number) => void,
  ): void => {
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        // Half-drop, the way a binder's roll actually repeats, plus a jitter
        // inside the cell so the lattice never reads as graph paper.
        const off = r % 2 === 0 ? 0 : 0.5;
        const cx = x + w * (((c + off + 0.5) % cols) / cols + (rnd() - 0.5) * 0.03);
        const cy = y + h * ((r + 0.5) / rows + (rnd() - 0.5) * 0.02);
        draw(cx, cy, i);
      }
    }
  };

  /** A column of wave, drawn as one path — the moiré / comb family. */
  const wave = (cx: number, amp: number, cycles: number, k: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx, y);
    const steps = Math.max(4, Math.round(cycles * 2));
    for (let i = 0; i < steps; i++) {
      const y0 = y + (h * i) / steps;
      const y1 = y + (h * (i + 1)) / steps;
      const dir = i % 2 === 0 ? 1 : -1;
      ctx.quadraticCurveTo(cx + amp * dir, (y0 + y1) / 2, cx, y1);
    }
    pen(ctx, colour, fine);
    ctx.stroke();
    void k;
  };

  /** A small filled lozenge — the tooling motif half the paper family uses. */
  const lozenge = (cx: number, cy: number, r: number): void => {
    tracePoly(ctx, [
      { x: cx, y: cy - r },
      { x: cx + r * 0.62, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r * 0.62, y: cy },
    ]);
    ctx.fillStyle = colour;
    ctx.fill();
  };

  switch (spec.grain) {
    /* ---- woven cloth: rules across, sometimes rules down ---- */
    case 'ribs':
      for (let i = 1; i < n * 2; i++) hLine(i / (n * 2), 0, 1, fine, i);
      break;
    case 'weave':
      for (let i = 1; i < n * 2; i++) hLine(i / (n * 2), 0, 1, fine * 0.8, i);
      for (let i = 1; i < n; i++) vLine(i / n, 0, 1, fine * 0.8, i);
      break;
    case 'twill':
      for (let i = 0; i < n * 2; i++) {
        const t = -0.3 + (i * 1.6) / (n * 2);
        stroke(ctx, x, y + h * t, x + w, y + h * (t + 0.34), colour, fine, seed + 300 + i);
      }
      break;
    case 'coarse':
      for (let i = 0; i < n * 2; i++) {
        hLine(0.03 + (i * 0.94) / (n * 2), rnd() * 0.08, 1 - rnd() * 0.1, bold, i);
      }
      break;
    case 'stitchRun':
      // Running stitch: a dashed rule, which is a row of marks and not a line.
      for (let i = 0; i < n; i++) {
        const t = 0.04 + (i * 0.92) / n;
        for (let d = 0; d < 9; d++) {
          hLine(t, d / 9 + 0.01, d / 9 + 0.07, fine, i * 10 + d);
        }
      }
      break;
    case 'fleck':
      field(Math.ceil(n / 3) + 2, 4, (cx, cy, i) => {
        hLine((cy - y) / h, (cx - x) / w, (cx - x) / w + 0.07, fine, i);
      });
      break;
    // The three naps. `bookDesign` split the old single `nap` because at spine
    // width the felt, the velvet and the suede were one drawing in three
    // colours; a cover is drawn ten times that size and has never told them
    // apart either, so all three keep the board treatment they already had.
    case 'napEdge':
    case 'pile':
    case 'brushed':
      // Pile: a broad darker band along the fore edge. Depth as a second flat
      // face, never as a sheen.
      ctx.fillStyle = colour;
      ctx.fillRect(x + w * 0.78, y, w * 0.22, h);
      for (let i = 1; i <= n * 3; i++) vLine((i / (n * 3 + 1)) * 0.76, 0.03, 0.97, fine * 0.7, i);
      break;

    /* ---- silk: waves and figures ---- */
    case 'watered':
      for (let i = 0; i < n * 2; i++) wave(x + (w * (i + 0.5)) / (n * 2), w * 0.02, 7, i);
      break;
    case 'figured':
      field(n, 4, (cx, cy) => {
        pen(ctx, colour, fine);
        ctx.beginPath();
        ctx.arc(cx, cy, unit * 0.035, 0.6, Math.PI * 1.5);
        ctx.stroke();
        mark(cx, cy, fine * 0.9);
      });
      break;
    case 'damask':
      field(n, 3, (cx, cy) => {
        for (const a of [0, 1, 2, 3]) {
          const ang = (a / 4) * Math.PI * 2 + Math.PI / 4;
          lozenge(cx + Math.cos(ang) * unit * 0.03, cy + Math.sin(ang) * unit * 0.03, unit * 0.018);
        }
      });
      break;

    /* ---- leather and skin: dot fields, veins, plates ---- */
    case 'pebble':
      field(Math.ceil(n / 2) + 3, 7, (cx, cy) => mark(cx, cy, unit * 0.011));
      break;
    case 'pinDot':
      field(Math.ceil(n / 2) + 2, 6, (cx, cy) => mark(cx, cy, unit * 0.006));
      break;
    case 'sprinkle':
      field(Math.ceil(n / 3) + 4, 8, (cx, cy) => mark(cx, cy, unit * 0.008 * (0.5 + rnd())));
      break;
    case 'mottle':
      field(n, 3, (cx, cy, i) => {
        const r = unit * (0.03 + rnd() * 0.025);
        tracePoly(
          ctx,
          polyPts(cx, cy, r, 9, i).map((p, k) => ({
            x: p.x + Math.cos(k * 2.4) * r * 0.22,
            y: p.y + Math.sin(k * 1.7) * r * 0.22,
          })),
        );
        ctx.fillStyle = colour;
        ctx.fill();
      });
      break;
    case 'panelled':
      // Blind panels ruled inside one another — the calf binder's whole idea of
      // ornament, and the reason this material's count is 1.
      for (let i = 0; i < n + 1; i++) {
        const g = 0.06 + i * 0.07;
        if (g > 0.4) break;
        pen(ctx, colour, fine);
        wobbleRect(ctx, x + w * g, y + h * g * 0.62, w * (1 - g * 2), h * (1 - g * 1.24), unit * 0.02, seed + i);
        ctx.stroke();
      }
      break;
    case 'flame':
      for (let i = 0; i < n * 2; i++) wave(x + (w * (i + 0.5)) / (n * 2), w * 0.045, 3, i);
      break;
    case 'scales':
      field(n + 2, 6, (cx, cy) => {
        pen(ctx, colour, fine);
        ctx.beginPath();
        ctx.arc(cx, cy, unit * 0.028, Math.PI * 0.05, Math.PI * 0.95);
        ctx.stroke();
      });
      break;
    case 'shagreen':
      field(n + 3, 8, (cx, cy) => {
        pen(ctx, colour, fine * 0.8);
        ctx.beginPath();
        ctx.arc(cx, cy, unit * 0.014, 0, Math.PI * 2);
        ctx.stroke();
      });
      break;
    case 'plates':
      for (let i = 1; i < n; i++) hLine(i / n, 0, 1, fine * 0.8, i);
      for (let i = 1; i < 5; i++) vLine(i / 5, 0, 1, fine * 0.8, i + 50);
      field(n, 5, (cx, cy) => mark(cx, cy, unit * 0.007));
      break;
    case 'creases':
      for (let i = 0; i < n * 2; i++) {
        const t = 0.1 + (i * 0.8) / (n * 2);
        stroke(ctx, x + w * 0.05, y + h * t, x + w * (0.5 + rnd() * 0.45), y + h * (t + 0.03), colour, bold, seed + 320 + i);
      }
      break;
    case 'scuffs':
      for (let i = 0; i < n * 2; i++) {
        const cx = x + w * (0.08 + rnd() * 0.84);
        const cy = y + h * (0.06 + rnd() * 0.88);
        const len = unit * (0.05 + rnd() * 0.06);
        stroke(ctx, cx, cy, cx + len, cy - len * 0.4, colour, fine, seed + 340 + i);
      }
      break;

    /* ---- marbled and decorated papers ---- */
    case 'combedVeins':
      for (let i = 0; i < n * 2; i++) wave(x + (w * (i + 0.5)) / (n * 2), w * 0.055, 5, i);
      break;
    case 'spanishWave':
      for (let i = 0; i < n * 2; i++) {
        const t = (i + 0.5) / (n * 2);
        ctx.beginPath();
        ctx.moveTo(x, y + h * t);
        for (let k = 0; k < 8; k++) {
          const x0 = x + (w * k) / 8;
          const x1 = x + (w * (k + 1)) / 8;
          ctx.quadraticCurveTo((x0 + x1) / 2, y + h * (t + (k % 2 === 0 ? 0.02 : -0.02)), x1, y + h * t);
        }
        pen(ctx, colour, fine);
        ctx.stroke();
      }
      break;
    case 'stoneVein':
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        let px = x + w * rnd();
        let py = y;
        ctx.moveTo(px, py);
        for (let k = 0; k < 6; k++) {
          const nx = px + (rnd() - 0.5) * w * 0.3;
          const ny = py + h / 6;
          ctx.quadraticCurveTo(px, (py + ny) / 2, nx, ny);
          px = nx;
          py = ny;
        }
        pen(ctx, colour, fine);
        ctx.stroke();
      }
      break;
    case 'shellSpots':
      field(n, 4, (cx, cy) => {
        pen(ctx, colour, fine * 0.9);
        ctx.beginPath();
        ctx.arc(cx, cy, unit * 0.03, 0, Math.PI * 2);
        ctx.stroke();
        mark(cx, cy, unit * 0.008);
      });
      break;
    case 'pasteComb':
      for (let i = 0; i < n * 2; i++) {
        const t = (i + 0.5) / (n * 2);
        ctx.beginPath();
        ctx.moveTo(x, y + h * t);
        for (let k = 0; k < 6; k++) {
          const x0 = x + (w * k) / 6;
          const x1 = x + (w * (k + 1)) / 6;
          ctx.quadraticCurveTo((x0 + x1) / 2, y + h * (t + 0.05), x1, y + h * t);
        }
        pen(ctx, colour, bold);
        ctx.stroke();
      }
      break;
    case 'lozenges':
      field(n, 4, (cx, cy) => lozenge(cx, cy, unit * 0.026));
      break;
    case 'floret':
      field(n, 4, (cx, cy) => {
        for (let p = 0; p < 5; p++) {
          const a = -Math.PI / 2 + (p / 5) * Math.PI * 2;
          mark(cx + Math.cos(a) * unit * 0.018, cy + Math.sin(a) * unit * 0.018, unit * 0.007);
        }
        mark(cx, cy, unit * 0.006);
      });
      break;
    case 'fibres':
      for (let i = 0; i < n * 2; i++) {
        const cx = x + w * (0.04 + rnd() * 0.92);
        const cy = y + h * (0.04 + rnd() * 0.92);
        const len = unit * (0.03 + rnd() * 0.04);
        const a = rnd() * Math.PI;
        stroke(ctx, cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, colour, fine * 0.8, seed + 360 + i);
      }
      break;
    case 'laidLines':
      // Laid paper: fine chain lines one way, a few heavier ones the other.
      for (let i = 1; i < n * 6; i++) vLine(i / (n * 6), 0, 1, fine * 0.7, i);
      for (let i = 1; i < 5; i++) hLine(i / 5, 0, 1, bold * 0.8, i + 60);
      break;
    case 'giltDots':
      field(n, 5, (cx, cy) => mark(cx, cy, unit * 0.012));
      break;
    case 'stripes':
      for (let i = 0; i < n * 3; i++) {
        const t = (i + 0.5) / (n * 3);
        ctx.fillStyle = colour;
        ctx.fillRect(x + w * (t - 0.02), y, w * 0.04, h);
      }
      break;
    case 'chequer': {
      const cells = Math.max(3, Math.round(n / 2));
      const cw = w / cells;
      const ch = h / Math.round(cells * 1.4);
      ctx.fillStyle = colour;
      for (let r = 0; r * ch < h; r++) {
        for (let c = 0; c < cells; c++) {
          if ((r + c) % 2 === 0) continue;
          ctx.fillRect(x + c * cw, y + r * ch, cw, Math.min(ch, y + h - (y + r * ch)));
        }
      }
      break;
    }
    case 'wrapperRules':
      // A printed wrapper: two heavy rules boxing the board, nothing else.
      for (let i = 0; i < Math.max(2, n); i++) {
        const g = 0.05 + i * 0.035;
        pen(ctx, colour, bold);
        wobbleRect(ctx, x + w * g, y + h * g * 0.7, w * (1 - g * 2), h * (1 - g * 1.4), unit * 0.01, seed + i);
        ctx.stroke();
      }
      break;
    case 'newsRules':
      for (let i = 1; i < n * 2; i++) hLine(i / (n * 2), 0.04, 0.96, fine * 0.7, i);
      vLine(0.5, 0.04, 0.96, fine * 0.7, 99);
      break;
  }
}

/**
 * Everything a covering says about a board, in one call.
 *
 * Clipped to the board and confined to the FACE — the spine strip is the
 * board turning away from us and carries the icon's gilt bands, so a grain run
 * over it would be a mark on a surface the reader is meant to read as an edge.
 */
function paintCovering(
  ctx: FlatCtx,
  spec: MaterialSpec,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  spineW: number,
  radius: number,
  face: string,
  dark: string,
  accent: string,
  ink: number,
  gilded: boolean,
  pale: boolean,
  wear: number,
  seed: number,
): void {
  // The spine drops a covering's fine work below `floor` px of strip, because
  // under that the marks land on less than a pixel and read as dirt. The board
  // has the same rule against its own width: `floor` is written for a strip of
  // 8–20px, and a board is about four of those across. A thoroughly worn book
  // loses the grain for the reason it loses its gilt — it has been rubbed off.
  if (bw < spec.floor * 4 || wear >= 0.78) return;

  ctx.save();
  wobbleRect(ctx, bx, by, bw, bh, radius, seed);
  ctx.clip();

  paintSplit(ctx, spec, bx, by, bw, bh, spineW, dark, ink, seed + 3);

  const faceX = bx + spineW;
  const faceW = bw - spineW;
  // Inset a hair from the hinge and the fore edge so a round cap cannot land
  // on either outline.
  const gx = faceX + faceW * 0.03;
  const gw = faceW * 0.94;
  const gy = by + bh * 0.02;
  const gh = bh * 0.96;
  ctx.save();
  ctx.beginPath();
  ctx.rect(gx, gy, gw, gh);
  ctx.clip();
  paintGrain(
    ctx,
    spec,
    gx,
    gy,
    gw,
    gh,
    grainInk(spec, face, dark, accent, gilded, pale),
    seed + 71,
  );
  ctx.restore();

  // The joints: fine ink lines down the hinge, and on a two-joint binding down
  // the fore edge as well, which is what makes a back read as rounded.
  if (spec.joints > 0) {
    const line = Math.max(0.8, ink * 0.4);
    stroke(ctx, faceX + faceW * 0.035, by + bh * 0.03, faceX + faceW * 0.035, by + bh * 0.97, FLAT.ink, line, seed + 81);
    if (spec.joints > 1) {
      stroke(ctx, bx + bw * 0.965, by + bh * 0.03, bx + bw * 0.965, by + bh * 0.97, FLAT.ink, line, seed + 82);
    }
  }

  ctx.restore();
}

/* ------------------------------ render pieces ----------------------------- */

/**
 * The sliver of text block showing past the fore-edge.
 *
 * The icon puts the page block *behind* the cover and lets it peek out, and
 * that one overlap is most of why a flat rectangle reads as a book rather than
 * a card. It is drawn first so the board can sit in front of it.
 */
function paintTextBlock(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  edge: EdgeTreatment,
  seed: number,
): void {
  const gilded = edge === 'gilt';
  panel(ctx, x, y, w, h, gilded ? FLAT.gilt : FLAT.cream, {
    radius: w * 0.4,
    seed,
    width: Math.max(1, inkWidth(w) * 0.9),
  });

  // The icon draws the leaves as three pale curves down the block; only the
  // outer half of this strip is ever visible, so the lines live out there.
  const rule = Math.max(0.8, w * 0.1);
  const ruleInk = gilded ? FLAT.ochreDark : FLAT.creamDeep;
  for (const t of [0.58, 0.8]) {
    stroke(ctx, x + w * t, y + h * 0.05, x + w * t, y + h * 0.95, ruleInk, rule, seed + t * 10);
  }

  if (edge === 'speckled' || edge === 'marbled') {
    // Both treatments live in the OUTER half of the strip: the boards overlap
    // the inner half, and the first cut put the marks where nobody could see
    // them. Clipped to the block so a round cap cannot poke out past its own
    // outline and read as a printing fault.
    ctx.save();
    wobbleRect(ctx, x, y, w, h, w * 0.4, seed);
    ctx.clip();
    if (edge === 'speckled') {
      const flecks = Math.max(7, Math.round(h / (w * 1.4)));
      for (let i = 0; i < flecks; i++) {
        const t = (i + 0.5) / flecks;
        dot(ctx, x + w * (i % 2 === 0 ? 0.62 : 0.82), y + h * t, Math.max(0.7, w * 0.13), FLAT.inkSoft);
      }
    } else {
      // Combed marbling: warm and cool bands the whole way down. Four of them
      // read as three coloured tabs stuck to the edge; it takes a band every
      // tenth of the height before the sliver reads as a pattern.
      for (let i = 0; i < 9; i++) {
        const t = 0.06 + i * 0.105;
        stroke(
          ctx,
          x + w * 0.45,
          y + h * t,
          x + w * 1.05,
          y + h * (t + 0.025),
          i % 2 === 0 ? FLAT.terracotta : FLAT.slate,
          Math.max(0.9, w * 0.2),
          seed + i,
        );
      }
    }
    ctx.restore();
  }
}

/**
 * The darker strip down the hinge side, with its gilt bands.
 *
 * This is the icon's whole depth model in one shape: the board turns away from
 * us and becomes a second, darker flat colour. It is clipped to the board so
 * the outline stays a single unbroken line, then the board's edge is
 * re-stroked because a clip always nibbles the stroke it runs through.
 */
function paintSpineStrip(
  ctx: FlatCtx,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  spineW: number,
  radius: number,
  face: string,
  dark: string,
  ink: number,
  gilded: boolean,
  seed: number,
): void {
  ctx.save();
  wobbleRect(ctx, bx, by, bw, bh, radius, seed);
  ctx.clip();
  // Overshoot on three sides so only the strip's inner edge shows a curve.
  wobbleRect(ctx, bx - radius, by - radius, spineW + radius, bh + radius * 2, radius, seed + 5);
  ctx.fillStyle = dark;
  ctx.fill();
  // The board TURNING AWAY: the outermost sliver of the strip is the round of
  // the back, a third flat face deeper again. The icon does exactly this and
  // the cover was drawing the spine as one flat slab, which is why it read as
  // a stripe painted on rather than as an edge.
  ctx.fillStyle = mixHex(dark, FLAT.ink, 0.3);
  ctx.fillRect(bx - radius, by - radius, spineW * 0.2 + radius, bh + radius * 2);
  stroke(
    ctx,
    bx + spineW * 0.2,
    by + bh * 0.012,
    bx + spineW * 0.2,
    by + bh * 0.988,
    FLAT.ink,
    Math.max(0.8, ink * 0.45),
    seed + 6,
  );
  ctx.restore();

  wobbleRect(ctx, bx, by, bw, bh, radius, seed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = ink;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // The hinge: one ink line where the strip meets the face.
  stroke(ctx, bx + spineW, by + bh * 0.012, bx + spineW, by + bh * 0.988, FLAT.ink, ink * 0.8, seed + 2);

  // Gilt bands, at the icon's proportions — a close pair near the head and one
  // alone near the tail, which is also where a real binder puts them. They
  // stop short of both edges: a round cap that lands on the outline reads as
  // a band leaking out of the book.
  //
  // Without foil the band becomes the board's own lighter face, so a raised
  // cord still shows as the strip stepping back up towards us. That is the
  // icon's depth model rather than a highlight.
  //
  // Each band is a CORD now, not a stripe: one ink hairline along each edge of
  // it, which is what a raised band under the leather actually shows and what
  // separates three painted lines from three ridges.
  const band = spineW * 0.26;
  const x0 = bx + spineW * 0.16;
  const x1 = bx + spineW * 0.84;
  const gold = gilded ? FLAT.gilt : face;
  const cord = Math.max(0.7, ink * 0.35);
  for (const [t, weight] of [
    [0.218, 1],
    [0.296, 0.58],
    [0.785, 1],
  ] as const) {
    const cy = by + bh * t;
    stroke(ctx, x0, cy, x1, cy, gold, band * weight, seed + t * 100);
    for (const s of [-1, 1] as const) {
      const ey = cy + (s * band * weight) / 2;
      stroke(ctx, x0, ey, x1, ey, FLAT.ink, cord, seed + t * 100 + s * 3);
    }
  }

  // Head and tail caps: the two short rules across the strip that every bound
  // book has and this one did not. They also stop the strip reading as a
  // rectangle that runs off the top and bottom of the board.
  for (const t of [0.035, 0.965] as const) {
    stroke(
      ctx,
      bx + spineW * 0.24,
      by + bh * t,
      bx + spineW * 0.94,
      by + bh * t,
      FLAT.ink,
      Math.max(0.8, ink * 0.5),
      seed + t * 70,
    );
  }
}

/**
 * The ornamental frame inset into the face — fifty of them.
 *
 * ## Composed, not enumerated
 *
 * Fifty hand-written branches would be fifty chances to draw a frame that does
 * not match its siblings, and the family resemblance is the point: every one of
 * these is the same pale rule the app icon carries, elaborated. So a frame is a
 * spec of five orthogonal traits and the painter reads them:
 *
 *   rules    how many concentric rules, and their relative weights
 *   corner   what sits at the four corners
 *   side     what sits at the middle of each side
 *   radius   how the rule turns — square, soft, or a drawn-out ogee
 *   band     an optional filled border between two of the rules
 *
 * Fifty combinations that a reader can tell apart, all provably siblings,
 * because they are made of the same four marks in different arrangements.
 *
 * ## Why these marks and not others
 *
 * A cover is seen LARGE — the pull-out overlay and the open book — which is the
 * opposite constraint to a spine, where an ornament has thirty pixels and has
 * to survive being a smudge. Here detail reads, so the marks can be finer. What
 * does NOT change is the flat rule: one ink colour, no shading, no blur. Depth
 * on a frame is a second rule at a different weight, never a shadow.
 *
 * The lozenge at the middle of each side is the one mark that was got wrong
 * first time and is worth keeping a note about: it started as a tick laid ALONG
 * the rule, which was invisible, because a mark drawn on top of a line reads as
 * a thicker line. A mark that sits ACROSS the rule is the only kind that reads
 * on a frame.
 */

/** What sits at the four corners of a frame. */
type FrameCorner = 'none' | 'dot' | 'ring' | 'lozenge' | 'bracket' | 'fleuron' | 'stud';

/** What sits at the middle of each side. */
type FrameSide = 'none' | 'lozenge' | 'tick' | 'dot' | 'arc' | 'pair';

/** How the rule turns at a corner. */
type FrameTurn = 'square' | 'soft' | 'round' | 'ogee';

interface FrameSpec {
  id: string;
  name: string;
  /** Relative weights of the concentric rules, outermost first. 1 = full. */
  rules: readonly number[];
  corner: FrameCorner;
  side: FrameSide;
  turn: FrameTurn;
  /** Fill the gap between rule 0 and rule 1 with a flat band. */
  band?: boolean;
}

/**
 * How far a rule's corner is rounded off, so a corner TOOL can be put where
 * the rule actually turns rather than where the maths corner is.
 *
 * Shared with `traceFrameRect` — the two read the same number, because a corner
 * ornament placed at the geometric corner of a `round` frame floats outside its
 * own rule, which is precisely how the first specimen's corner marks came to
 * look like specks flicked at the board.
 */
function frameTurnRadius(turn: FrameTurn, m: number): number {
  if (turn === 'square') return m * 0.008;
  if (turn === 'round') return m * 0.16;
  if (turn === 'soft') return m * 0.05;
  return m * 0.13; // ogee
}

function frame(
  id: string,
  name: string,
  rules: readonly number[],
  corner: FrameCorner,
  side: FrameSide,
  turn: FrameTurn,
  band = false,
): FrameSpec {
  return { id, name, rules, corner, side, turn, band };
}

/**
 * Fifty frames. The first four are the originals, hex-for-hex in behaviour —
 * `frame` is index-addressed by saved book data, so reordering the head of this
 * table silently redresses every book anyone has already customised.
 */
const FRAMES: readonly FrameSpec[] = [
  frame('plain-rule', 'Plain Rule', [1], 'none', 'none', 'soft'),
  frame('corner-dots', 'Corner Dots', [1], 'dot', 'none', 'soft'),
  frame('double-rule', 'Double Rule', [1, 0.7], 'none', 'none', 'soft'),
  frame('tooled-lozenge', 'Tooled Lozenge', [1], 'dot', 'lozenge', 'soft'),

  /* --- single rules, varying the corner --- */
  frame('ringed', 'Ringed Corners', [1], 'ring', 'none', 'soft'),
  frame('bracketed', 'Bracketed', [1], 'bracket', 'none', 'square'),
  frame('fleuron-corners', 'Fleuron Corners', [1], 'fleuron', 'none', 'soft'),
  frame('studded', 'Studded', [1], 'stud', 'none', 'square'),
  frame('lozenge-corners', 'Lozenge Corners', [1], 'lozenge', 'none', 'soft'),
  frame('round-rule', 'Round Rule', [1], 'none', 'none', 'round'),

  /* --- single rules, varying the side mark --- */
  frame('side-ticks', 'Side Ticks', [1], 'none', 'tick', 'soft'),
  frame('side-dots', 'Side Dots', [1], 'none', 'dot', 'soft'),
  frame('side-arcs', 'Side Arcs', [1], 'none', 'arc', 'round'),
  frame('side-pairs', 'Paired Sides', [1], 'none', 'pair', 'soft'),
  frame('centred-lozenge', 'Centred Lozenge', [1], 'none', 'lozenge', 'square'),

  /* --- double rules --- */
  frame('double-dots', 'Double with Dots', [1, 0.7], 'dot', 'none', 'soft'),
  frame('double-rings', 'Double with Rings', [1, 0.7], 'ring', 'none', 'soft'),
  frame('double-brackets', 'Double Bracketed', [1, 0.7], 'bracket', 'none', 'square'),
  frame('double-ticks', 'Double with Ticks', [1, 0.7], 'none', 'tick', 'soft'),
  frame('double-lozenge', 'Double Lozenge', [1, 0.7], 'lozenge', 'lozenge', 'soft'),
  frame('double-ogee', 'Double Ogee', [1, 0.7], 'none', 'none', 'ogee'),
  frame('double-fleuron', 'Double Fleuron', [1, 0.7], 'fleuron', 'none', 'soft'),
  frame('double-round', 'Double Round', [1, 0.7], 'none', 'arc', 'round'),
  frame('double-stud', 'Double Studded', [1, 0.7], 'stud', 'dot', 'square'),

  /* --- fillet: a heavy rule with a fine one inside --- */
  frame('fillet', 'Fillet', [1, 0.4], 'none', 'none', 'soft'),
  frame('fillet-dots', 'Fillet & Dots', [1, 0.4], 'dot', 'none', 'soft'),
  frame('fillet-fleuron', 'Fillet & Fleurons', [1, 0.4], 'fleuron', 'none', 'soft'),
  frame('fillet-ogee', 'Fillet Ogee', [1, 0.4], 'none', 'lozenge', 'ogee'),
  frame('fine-fillet', 'Fine Fillet', [0.5, 1], 'none', 'none', 'soft'),
  frame('fine-fillet-ring', 'Fine Fillet & Ring', [0.5, 1], 'ring', 'none', 'soft'),

  /* --- triple rules --- */
  frame('triple-rule', 'Triple Rule', [1, 0.7, 0.45], 'none', 'none', 'soft'),
  frame('triple-dots', 'Triple with Dots', [1, 0.7, 0.45], 'dot', 'none', 'soft'),
  frame('triple-lozenge', 'Triple Lozenge', [1, 0.7, 0.45], 'lozenge', 'lozenge', 'soft'),
  frame('triple-square', 'Triple Square', [1, 0.7, 0.45], 'stud', 'none', 'square'),
  frame('triple-ogee', 'Triple Ogee', [1, 0.6, 0.35], 'none', 'arc', 'ogee'),
  frame('triple-bracket', 'Triple Bracketed', [1, 0.7, 0.45], 'bracket', 'tick', 'square'),

  /* --- banded: a flat border between two rules --- */
  frame('banded', 'Banded', [1, 0.7], 'none', 'none', 'soft', true),
  frame('banded-dots', 'Banded & Dots', [1, 0.7], 'dot', 'none', 'soft', true),
  frame('banded-ring', 'Banded & Rings', [1, 0.7], 'ring', 'none', 'soft', true),
  frame('banded-lozenge', 'Banded Lozenge', [1, 0.7], 'lozenge', 'lozenge', 'soft', true),
  frame('banded-square', 'Banded Square', [1, 0.7], 'stud', 'none', 'square', true),
  frame('banded-ogee', 'Banded Ogee', [1, 0.7], 'none', 'arc', 'ogee', true),
  frame('banded-triple', 'Banded Triple', [1, 0.7, 0.4], 'dot', 'tick', 'soft', true),
  frame('banded-fleuron', 'Banded Fleuron', [1, 0.7], 'fleuron', 'none', 'round', true),

  /* --- the elaborate end --- */
  frame('panelled', 'Panelled', [1, 0.75, 0.5, 0.3], 'dot', 'lozenge', 'soft'),
  frame('cathedral', 'Cathedral', [1, 0.6, 0.35], 'fleuron', 'arc', 'ogee'),
  frame('coffered', 'Coffered', [1, 0.8, 0.55, 0.35], 'stud', 'dot', 'square', true),
  frame('rosace', 'Rosace', [1, 0.5], 'fleuron', 'pair', 'round'),
  frame('court', 'Court Binding', [1, 0.7, 0.45], 'ring', 'lozenge', 'soft', true),
  frame('gothic-panel', 'Gothic Panel', [1, 0.65, 0.4], 'bracket', 'arc', 'ogee', true),
];

/** How many tooled frames a cover can wear. Derived, never restated. */
export const COVER_FRAME_COUNT = FRAMES.length;

/** Display names for the studio's frame picker. */
export const FRAME_LABELS: readonly string[] = FRAMES.map((f) => f.name);

/** Trace one rectangle in the frame's turn style. */
function traceFrameRect(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  turn: FrameTurn,
  seed: number,
): void {
  const m = Math.min(w, h);
  if (turn !== 'ogee') {
    wobbleRect(ctx, x, y, w, h, frameTurnRadius(turn, m), seed);
    return;
  }
  // ogee — the corner is drawn out into a shallow S, which is what separates a
  // "binding" frame from a rounded rectangle. Traced by hand because a radius
  // cannot express a reversing curve.
  const r = frameTurnRadius('ogee', m);
  const k = r * 0.55;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.bezierCurveTo(x + w - k, y, x + w, y + k, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.bezierCurveTo(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.bezierCurveTo(x + k, y + h, x, y + h - k, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.bezierCurveTo(x, y + k, x + k, y, x + r, y);
  ctx.closePath();
}

/** A hairline circle. The collar on half the corner tools. */
function ringMark(ctx: FlatCtx, cx: number, cy: number, r: number, colour: string, line: number): void {
  pen(ctx, colour, line);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.8, r), 0, Math.PI * 2);
  ctx.stroke();
}

/** A filled lozenge, `r` tall and 0.68r wide. The binder's commonest tool. */
function lozengeMark(ctx: FlatCtx, cx: number, cy: number, r: number, colour: string): void {
  tracePoly(ctx, [
    { x: cx, y: cy - r },
    { x: cx + r * 0.68, y: cy },
    { x: cx, y: cy + r },
    { x: cx - r * 0.68, y: cy },
  ]);
  ctx.fillStyle = colour;
  ctx.fill();
}

/** The same lozenge, open. */
function lozengeOutline(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  r: number,
  colour: string,
  line: number,
): void {
  tracePoly(ctx, [
    { x: cx, y: cy - r },
    { x: cx + r * 0.68, y: cy },
    { x: cx, y: cy + r },
    { x: cx - r * 0.68, y: cy },
  ]);
  pen(ctx, colour, line);
  ctx.stroke();
}

/**
 * One petal of a fleuron: a teardrop thrown from (x0,y0) along `ang`.
 *
 * Two quadratics rather than the four-point polygon this used to be. The
 * polygon's petal was a kite — straight sides, a hard point at the base — and
 * three kites in a corner read as a scratch rather than a flower. A curve costs
 * the same and is the difference between "ornament" and "damage".
 */
function petal(
  ctx: FlatCtx,
  x0: number,
  y0: number,
  ang: number,
  len: number,
  wide: number,
  colour: string,
  /** How far the tip swings off the petal's own axis. 0 is a straight leaf. */
  curl = 0,
): void {
  const tx = x0 + Math.cos(ang + curl) * len;
  const ty = y0 + Math.sin(ang + curl) * len;
  const nx = Math.cos(ang + Math.PI / 2) * wide;
  const ny = Math.sin(ang + Math.PI / 2) * wide;
  const mx = x0 + Math.cos(ang) * len * 0.45;
  const my = y0 + Math.sin(ang) * len * 0.45;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx + nx, my + ny, tx, ty);
  ctx.quadraticCurveTo(mx - nx, my - ny, x0, y0);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/**
 * The four corner tools, drawn as TOOLS rather than as marks.
 *
 * ## Why each of these is now two or three shapes instead of one
 *
 * The first cut gave every corner a single primitive at `min(w,h) * 0.022` —
 * about two pixels on the studio preview and six on the pull-out. On the sheet
 * that mattered (`shots-now/out/*-frames-studio.png`) entries 0 through 14 were
 * one picture: fifty frames that a reader could sort into six. A dot the size
 * of a full stop cannot be told from a ring the size of a full stop, so the
 * vocabulary was real in the table and absent on the board.
 *
 * So each tool is a small COMPOSITION — a filled centre with a collar, a
 * bracket with an inner return, a fleuron with a heart and a tip — sized off
 * the frame rather than off nothing. That is richness by drawing: no shading
 * was added, and the only colour is still the frame's own.
 *
 * `sx`/`sy` point inward along the two rules, so a bracket knows which way its
 * arms run and a fleuron knows which way to throw its petals.
 */
function paintFrameCorner(
  ctx: FlatCtx,
  kind: FrameCorner,
  cx: number,
  cy: number,
  s: number,
  colour: string,
  line: number,
  sx: number,
  sy: number,
): void {
  switch (kind) {
    case 'none':
      return;
    case 'dot':
      // A dot struck inside a collar — the plainest corner tool there is, and
      // the one a plain rule wants. Two circles, not one.
      dot(ctx, cx, cy, s * 0.3, colour);
      ringMark(ctx, cx, cy, s * 0.74, colour, line * 0.7);
      return;
    case 'stud': {
      // A metal boss: a heavy centre, a collar, and two spurs running back
      // along the rules so it reads as fixed to the frame rather than laid on.
      dot(ctx, cx, cy, s * 0.46, colour);
      ringMark(ctx, cx, cy, s * 0.92, colour, line * 0.85);
      pen(ctx, colour, line * 0.8);
      ctx.beginPath();
      ctx.moveTo(cx + sx * s * 1.15, cy);
      ctx.lineTo(cx + sx * s * 1.95, cy);
      ctx.moveTo(cx, cy + sy * s * 1.15);
      ctx.lineTo(cx, cy + sy * s * 1.95);
      ctx.stroke();
      return;
    }
    case 'ring':
      // An eyelet: two concentric rules and a pip in the middle.
      ringMark(ctx, cx, cy, s * 0.95, colour, line * 0.85);
      ringMark(ctx, cx, cy, s * 0.5, colour, line * 0.6);
      dot(ctx, cx, cy, line * 0.85, colour);
      return;
    case 'lozenge':
      // A lozenge inside a lozenge, which is how a corner diaper is actually
      // built up; one alone was a speck.
      lozengeOutline(ctx, cx, cy, s * 1.2, colour, line * 0.7);
      lozengeMark(ctx, cx, cy, s * 0.62, colour);
      return;
    case 'bracket': {
      // The mark a binder's corner tool leaves: an L along both rules, a
      // shorter L returning inside it, and a pip in the elbow.
      pen(ctx, colour, line);
      ctx.beginPath();
      ctx.moveTo(cx + sx * s * 2.4, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * s * 2.4);
      ctx.stroke();
      const g = s * 0.72;
      pen(ctx, colour, line * 0.68);
      ctx.beginPath();
      ctx.moveTo(cx + sx * s * 1.9, cy + sy * g);
      ctx.lineTo(cx + sx * g, cy + sy * g);
      ctx.lineTo(cx + sx * g, cy + sy * s * 1.9);
      ctx.stroke();
      dot(ctx, cx + sx * s * 1.5, cy + sy * s * 1.5, line * 0.95, colour);
      return;
    }
    case 'fleuron': {
      // A palmette: five curved petals thrown inward off a heart, opening into
      // a fan, with a pip beyond the middle tip.
      //
      // Three petals at ±0.62rad with the middle one longest is an ARROWHEAD,
      // and that is exactly what the first specimen sheet showed — four little
      // arrows pointing at the label. A fleuron is wide and it curls; the fan
      // has to be wider than it is long before the eye reads a flower.
      const base = Math.atan2(sy, sx);
      for (const a of [-2, -1, 0, 1, 2]) {
        const m = Math.abs(a);
        petal(
          ctx,
          cx,
          cy,
          base + a * 0.56,
          s * (m === 0 ? 1.9 : m === 1 ? 1.62 : 1.1),
          // Leaves, not rays. At 0.36 the fan came back as a firework; a petal
          // has to be about a third as wide as it is long before it reads as
          // foliage at pull-out size.
          s * (m === 2 ? 0.4 : 0.52),
          colour,
          a * 0.36,
        );
      }
      dot(ctx, cx, cy, s * 0.4, colour);
      dot(ctx, cx + Math.cos(base) * s * 2.35, cy + Math.sin(base) * s * 2.35, line * 1.05, colour);
      return;
    }
  }
}

/**
 * The four side tools, at the middle of each rule.
 *
 * Same enlargement as the corners, and the same rule they were already written
 * to: a mark laid ALONG the rule is just a thicker rule, so every one of these
 * crosses it. The additions are flanking pips — a tool is struck between two
 * stops on a real board, and two pips are what turn one mark into a run.
 */
function paintFrameSide(
  ctx: FlatCtx,
  kind: FrameSide,
  mx: number,
  my: number,
  s: number,
  colour: string,
  line: number,
  horizontal: boolean,
  /** +1 if the board's middle lies in the positive direction across the rule. */
  dir: number,
): void {
  /** Step along the rule, whichever way it runs. */
  const along = (d: number): [number, number] =>
    horizontal ? [mx + d, my] : [mx, my + d];

  switch (kind) {
    case 'none':
      return;
    case 'dot': {
      dot(ctx, mx, my, s * 0.32, colour);
      ringMark(ctx, mx, my, s * 0.78, colour, line * 0.65);
      for (const d of [-s * 1.7, s * 1.7]) {
        const [px, py] = along(d);
        dot(ctx, px, py, line * 0.85, colour);
      }
      return;
    }
    case 'lozenge': {
      lozengeMark(ctx, mx, my, s * 1.05, colour);
      for (const d of [-s * 1.75, s * 1.75]) {
        const [px, py] = along(d);
        dot(ctx, px, py, line * 0.95, colour);
      }
      return;
    }
    case 'tick': {
      pen(ctx, colour, line);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(mx, my - s * 1.15);
        ctx.lineTo(mx, my + s * 1.15);
      } else {
        ctx.moveTo(mx - s * 1.15, my);
        ctx.lineTo(mx + s * 1.15, my);
      }
      ctx.stroke();
      // Stops at both ends, so the tick reads as a bar and not as a nick in
      // the rule it crosses.
      const ends: Array<[number, number]> = horizontal
        ? [[mx, my - s * 1.15], [mx, my + s * 1.15]]
        : [[mx - s * 1.15, my], [mx + s * 1.15, my]];
      for (const [px, py] of ends) dot(ctx, px, py, line * 0.9, colour);
      return;
    }
    case 'pair': {
      pen(ctx, colour, line * 0.85);
      const off = s * 1.5;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(mx - off, my - s);
        ctx.lineTo(mx - off, my + s);
        ctx.moveTo(mx + off, my - s);
        ctx.lineTo(mx + off, my + s);
      } else {
        ctx.moveTo(mx - s, my - off);
        ctx.lineTo(mx + s, my - off);
        ctx.moveTo(mx - s, my + off);
        ctx.lineTo(mx + s, my + off);
      }
      ctx.stroke();
      lozengeMark(ctx, mx, my, s * 0.72, colour);
      return;
    }
    case 'arc': {
      // A fan: two arcs one inside the other, with the tool's pip at the apex
      // and a foot at each end. It opens toward the middle of the board — the
      // first cut used one angle for all four sides, so the fan at the head
      // pointed off the board while the one at the tail pointed into it.
      const inward = horizontal
        ? dir > 0
          ? 0
          : Math.PI
        : dir > 0
          ? Math.PI * 1.5
          : Math.PI * 0.5;
      pen(ctx, colour, line * 0.9);
      ctx.beginPath();
      ctx.arc(mx, my, s * 1.35, inward, inward + Math.PI);
      ctx.stroke();
      pen(ctx, colour, line * 0.6);
      ctx.beginPath();
      ctx.arc(mx, my, s * 0.78, inward, inward + Math.PI);
      ctx.stroke();
      const [ax, ay] = horizontal ? [mx, my + dir * s * 1.35] : [mx + dir * s * 1.35, my];
      dot(ctx, ax, ay, line * 0.95, colour);
      for (const d of [-s * 1.35, s * 1.35]) {
        const [px, py] = along(d);
        dot(ctx, px, py, line * 0.8, colour);
      }
      return;
    }
  }
}

function paintFrame(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  style: number,
  colour: string,
  /** The flat tone a `band` frame's border is filled in. */
  bandFill: string,
  detail: boolean,
  seed: number,
): void {
  const spec = FRAMES[((Math.trunc(style) % FRAMES.length) + FRAMES.length) % FRAMES.length]!;
  const m = Math.min(w, h);
  const base = Math.max(1, m * 0.012);
  const gap = m * 0.042;

  /**
   * The band, drawn as a band.
   *
   * It used to be two traced rects and one `fill('evenodd')`, which never drew
   * a border at all: `wobbleRect` opens a fresh path, so the second trace threw
   * the first away and the even-odd fill flooded the WHOLE panel with the frame
   * colour at 0.16 alpha. Every one of the ten banded frames therefore painted
   * the same picture — a board a shade lighter, with the covering's grain
   * washed out under it — and the sheet showed ten names and one entry.
   *
   * The fix is also the simpler drawing: the gap between rule 0 and rule 1 IS a
   * stroke of width `gap` down the middle of that gap, so one stroked path in a
   * flat opaque tone gives a real border, follows the turn for free, and leaves
   * the two rules to land on its edges.
   */
  if (spec.band === true && spec.rules.length > 1) {
    traceFrameRect(ctx, x + gap / 2, y + gap / 2, w - gap, h - gap, spec.turn, seed + 3);
    ctx.strokeStyle = bandFill;
    ctx.lineWidth = gap;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.lineCap = 'round';
  }

  spec.rules.forEach((weight, i) => {
    const g = gap * i;
    if (w - g * 2 < base * 6 || h - g * 2 < base * 6) return;
    traceFrameRect(ctx, x + g, y + g, w - g * 2, h - g * 2, spec.turn, seed + i * 7);
    pen(ctx, colour, base * weight);
    ctx.stroke();
  });

  if (!detail) return;

  // Tools are struck on the INNERMOST rule, and big enough to be a tool.
  //
  // 0.022 of the frame's short side is two pixels on the studio preview, which
  // is why fifty frames sorted into six pictures there: a two-pixel ring, dot,
  // stud and lozenge are one two-pixel speck. 0.048 is a mark a reader can name
  // at 160px and an ornament at pull-out size.
  const s = m * 0.048;
  const inner = gap * Math.max(0, spec.rules.length - 1);
  // …and pushed in far enough to clear the turn. A mark at the geometric corner
  // of a `round` frame floats outside its own rule.
  const off = inner + frameTurnRadius(spec.turn, m) * 0.34 + s * 0.55;

  for (const [cx, cy, sx, sy] of [
    [x + off, y + off, 1, 1],
    [x + w - off, y + off, -1, 1],
    [x + w - off, y + h - off, -1, -1],
    [x + off, y + h - off, 1, -1],
  ] as const) {
    paintFrameCorner(ctx, spec.corner, cx, cy, s, colour, base, sx, sy);
  }

  for (const [mx, my, horiz, dir] of [
    [x + w / 2, y + inner, true, 1],
    [x + w / 2, y + h - inner, true, -1],
    [x + inner, y + h / 2, false, 1],
    [x + w - inner, y + h / 2, false, -1],
  ] as const) {
    paintFrameSide(ctx, spec.side, mx, my, s, colour, base, horiz, dir);
  }
}

/**
 * The medallion below the label — the SAME device the spine wears, drawn large.
 *
 * It used to be eight stamps of its own, hand-written here and folded from the
 * spine's ornament with `% 8`. That was duplicate art with a lossy join: a
 * spine tooled with a beehive got whichever of the eight the modulo landed on,
 * so the two faces of one book carried different devices. A real binding
 * strikes the same tool on the spine and the board — that is what makes them
 * one book rather than two objects — so this now delegates to the spine's own
 * fifty stamps and `COVER_MEDALLION_COUNT` is `ORNAMENT_COUNT` by derivation.
 *
 * `drawOrnament` works in unit space scaled by `s`, so cover size is only a
 * bigger `s`. It takes a `rnd` for the per-book wobble the rest of the flat
 * vocabulary uses; seeding it from the stamp and the radius keeps one book's
 * medallion identical between redraws without making every book's identical.
 */
function paintMedallion(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  r: number,
  kind: number,
  colour: string,
  /** The sunk field the stamp is struck into: the board's own tone, deeper. */
  field: string,
  /** False once the book is worn enough to have lost its fine tooling. */
  detail: boolean,
): void {
  const k = ((Math.trunc(kind) % ORNAMENT_COUNT) + ORNAMENT_COUNT) % ORNAMENT_COUNT;
  const line = Math.max(0.9, r * 0.075);

  /**
   * The cartouche the stamp sits in — five of them, chosen by the stamp itself.
   *
   * Deliberately DERIVED from `kind` rather than added as a knob: the cover's
   * whole history in this file is counts and tables drifting apart, and a sixth
   * axis nothing stores is a sixth thing to keep in step. Derived, it is
   * already in `coverCacheKey` (through `medallion`) and already in the studio
   * (turning the stamp turns the surround with it), for free.
   *
   * It exists because the stamp on its own was a sticker. `drawOrnament` puts
   * one small gilt pictogram on the lower half of a board that has nothing else
   * on it, and at pull-out size — 420px, the size a reader actually holds —
   * that read as clip art dropped on cloth. A binder's centre tool is struck
   * into a field and ringed; the ring is what makes it tooling.
   */
  if (detail) {
    const lozengeField = k % 5 === 2;
    ctx.save();
    if (lozengeField) {
      tracePoly(ctx, [
        { x: cx, y: cy - r * 1.5 },
        { x: cx + r * 1.16, y: cy },
        { x: cx, y: cy + r * 1.5 },
        { x: cx - r * 1.16, y: cy },
      ]);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
    }
    // A second flat face, not a shadow: concentric, so it cannot read as a
    // light direction. The note this replaces is still true — the first
    // specimen put a contact ELLIPSE under the stamp, offset, and it read as a
    // thumbprint. A field the stamp sits IN is the opposite mark.
    ctx.fillStyle = field;
    ctx.fill();
    ctx.strokeStyle = FLAT.ink;
    ctx.lineWidth = line * 0.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    switch (k % 5) {
      case 0:
        ringMark(ctx, cx, cy, r * 1.56, colour, line);
        break;
      case 1:
        // Rayed: the ring, with the tool's own points struck outside it.
        ringMark(ctx, cx, cy, r * 1.54, colour, line);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          stroke(
            ctx,
            cx + Math.cos(a) * r * 1.7,
            cy + Math.sin(a) * r * 1.7,
            cx + Math.cos(a) * r * 2.02,
            cy + Math.sin(a) * r * 2.02,
            colour,
            line * 0.85,
            k * 7 + i,
          );
        }
        break;
      case 2:
        // Clear of the field by a real gap: at 1.78 the outline touched the
        // lozenge it surrounds and the two read as one thick diamond.
        lozengeOutline(ctx, cx, cy, r * 1.95, colour, line);
        break;
      case 3:
        ringMark(ctx, cx, cy, r * 1.48, colour, line);
        ringMark(ctx, cx, cy, r * 1.72, colour, line * 0.6);
        break;
      default:
        // Studded: the ring with four pips on the diagonals, the commonest
        // centre-piece on a nineteenth-century trade binding.
        ringMark(ctx, cx, cy, r * 1.5, colour, line);
        for (const a of [0.25, 0.75, 1.25, 1.75]) {
          const ang = a * Math.PI;
          dot(ctx, cx + Math.cos(ang) * r * 1.86, cy + Math.sin(ang) * r * 1.86, line * 1.3, colour);
        }
    }
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawOrnament(ctx as never, k, cx, cy, r, mulberry32((k * 2654435761) ^ Math.round(r * 16)));
  ctx.restore();
}

/** Everything the label needs to know about the book it belongs to. */
interface LabelSpec {
  style: TitlePlateStyle;
  inset: boolean;
  gilded: boolean;
  /** The board's darker tone, for plates tooled straight onto the binding. */
  dark: string;
  /**
   * The board's own colour taken a step toward the ink — the flat second face
   * used for the sunk panel behind an inset plate and for the offset plate
   * under a paper label. Never a blur, and never derived from a light
   * direction: it is the same "darker face beside a lighter one" the spine
   * strip and the medallion field are.
   */
  sunk: string;
  /** Pale bindings need a label that is not the same cream as the board. */
  paleBoard: boolean;
  /** Which of the fifty hands the title is lettered in. */
  hand: HandSpec;
  seed: number;
  /** Detail scale, only used to keep handwriting above its legibility floor. */
  s: number;
}

/**
 * Set the pen for one hand at one size, and hand back the string to draw.
 *
 * Tracking goes through `ctx.letterSpacing`, which `measureText` honours, so
 * the fit loop below stays correct for a widely-set hand. It is guarded rather
 * than assumed: the property is a recent addition to the 2D context, and a
 * hand that silently sets nothing is better than a throw that takes the whole
 * cover with it.
 */
function setHand(ctx: FlatCtx, hand: HandSpec, stack: string, px: number, text: string): string {
  const slope = hand.slant ? 'italic ' : '';
  // Small caps are uppercase set down a size: none of the five faces carries an
  // sc axis, and faking one by drawing two runs at two sizes would put a seam
  // in the middle of a two-word title.
  const size = hand.caps === 'small' ? px * 0.86 : px;
  ctx.font = `${slope}${hand.weight} ${size.toFixed(1)}px ${stack}`;
  const tracking = hand.track * size;
  if ('letterSpacing' in ctx) {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${tracking.toFixed(2)}px`;
  }
  return hand.caps === 'none' ? text : text.toUpperCase();
}

/**
 * The cream label — the icon's loudest mark, and the one thing on a cover a
 * reader looks at first.
 *
 * With a title it carries the title and one short rule beneath; without one it
 * carries the icon's three ruled lines, which is what an untitled book looks
 * like on a shelf anyway.
 */
function paintLabel(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  spec: LabelSpec,
): void {
  const line = Math.max(1, Math.min(w, h) * 0.03);

  if (spec.inset && spec.style !== 'none') {
    // A recess, flattened into what a recess actually looks like when it is
    // DRAWN rather than lit: a sunk face a step deeper than the board, its own
    // ink outline, a fine rule inside it, and a nick across each corner where
    // the panel is cut away. One stroked rounded rectangle — which is all this
    // was — reads as a stray box somebody forgot to erase.
    const g = h * 0.22;
    const px = x - g;
    const py = y - g * 0.86;
    const pw = w + g * 2;
    const ph = h + g * 1.72;
    panel(ctx, px, py, pw, ph, spec.sunk, {
      radius: h * 0.24,
      seed: spec.seed + 4,
      width: Math.max(1, line * 0.7),
    });
    const rule = spec.gilded ? FLAT.giltPale : spec.dark;
    const inset = g * 0.34;
    wobbleRect(ctx, px + inset, py + inset, pw - inset * 2, ph - inset * 2, h * 0.2, spec.seed + 6);
    pen(ctx, rule, line * 0.55);
    ctx.stroke();
    // The four cut corners: the mark that says "sunk" without a light source.
    const nick = g * 0.62;
    for (const [nx, ny, sx, sy] of [
      [px + inset, py + inset, 1, 1],
      [px + pw - inset, py + inset, -1, 1],
      [px + pw - inset, py + ph - inset, -1, -1],
      [px + inset, py + ph - inset, 1, -1],
    ] as const) {
      stroke(ctx, nx + sx * nick, ny, nx, ny + sy * nick, rule, line * 0.5, spec.seed + nx + ny);
    }
  }

  // Annotated: `FLAT` is `as const`, so an inferred `ink` would be pinned to
  // the literal type of whichever colour happened to be assigned first.
  let ink: string = FLAT.ink;
  if (spec.style !== 'none') {
    // 'label' is paper laid on the board; 'gilt' and 'debossed' are tooled
    // into the binding itself, so they keep the board's darker tone and differ
    // only in what outlines them.
    const paper = spec.style === 'label';
    const fill = paper ? (spec.paleBoard ? FLAT.creamDeep : FLAT.cream) : spec.dark;
    if (paper) {
      // An offset plate under the label — the app's whole shadow vocabulary
      // (`0 3px 0`, gated by tests/styles.test.ts), which is a hard flat face
      // and not a blur. A paper label is the one thing on this board that
      // genuinely SITS ON the binding rather than being tooled into it, and
      // without the offset it read as printed on.
      const lift = Math.max(1, h * 0.075);
      wobbleRect(ctx, x + lift * 0.5, y + lift, w, h, h * 0.2, spec.seed + 9);
      ctx.fillStyle = spec.sunk;
      ctx.fill();
    }
    panel(ctx, x, y, w, h, fill, {
      radius: h * 0.2,
      seed: spec.seed,
      ink: spec.style === 'gilt' ? FLAT.gilt : FLAT.ink,
      width: Math.max(1.2, inkWidth(Math.min(w, h)) * 0.9),
    });
    ink = paper ? FLAT.ink : spec.gilded || spec.style === 'gilt' ? FLAT.giltPale : FLAT.cream;
  } else if (spec.paleBoard) {
    // Nothing pale survives on a parchment board — a gilt-lettered title there
    // came back all but invisible. Ink it.
    ink = FLAT.inkSoft;
  } else {
    // No plate: the title is tooled straight onto the cloth, so it has to
    // carry itself in gilt or cream.
    ink = spec.gilded ? FLAT.giltPale : FLAT.cream;
  }

  const text = title.trim();
  if (!text) {
    // The icon's ruled label: three lines, each shorter than the last.
    for (let i = 0; i < 3; i++) {
      const ry = y + h * (0.32 + i * 0.2);
      stroke(
        ctx,
        x + w * 0.12,
        ry,
        x + w * (0.88 - i * 0.16),
        ry,
        FLAT.inkSoft,
        Math.max(1, h * 0.075),
        spec.seed + i,
      );
    }
    return;
  }

  // Fit the title. The floor is the handwriting legibility floor from
  // CLAUDE.md (13 CSS px), expressed in the canvas's own pixels.
  //
  // Both floors are applied to the size the title is ACTUALLY set at, after
  // the hand's own scale and after the fit loop — which is the whole reason
  // they are enforced here rather than declared in the table. `gen-lettering`
  // learned the same thing on the page: a hand's scale and a size's scale
  // multiply, so "small hand" at "small plate" goes under a floor nobody wrote
  // a number below.
  const maxWidth = w * 0.84;
  const floorPx = HAND_FLOOR_PX * spec.s;
  const hand = spec.hand;
  // The plate's vertical cap holds whatever the hand asks for: a hand set at
  // 1.28 that overflowed its own label would be a hand nobody would pick.
  const startPx = Math.min(h * 0.52, Math.min(h * 0.46, 30 * spec.s) * hand.scale);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let stack = FACE_STACKS[hand.face] ?? FACE_STACKS[0]!;
  let fontPx = startPx;
  let cased = text;
  // Two passes at most: fit, and if a Caveat hand fitted under Caveat's own
  // documented floor, drop to the body face and fit again. That is the same
  // fallback `gen-lettering.mjs` emits as its block of two-attribute rules —
  // the block keeps its size and gives up only the face.
  for (let pass = 0; pass < 2; pass++) {
    /*
     * SOLVE for the size instead of walking down to it.
     *
     * This used to shrink by 8% and measure again, round and round, which is up
     * to a dozen `measureText` calls per title — and each one is preceded by a
     * `setHand()`, so each is a fresh `ctx.font` and a fresh shaping pass with
     * nothing cached. Profiling the customize panel opening found `measureText`
     * the largest single cost on the main thread, and memoising it did nothing
     * at all: every iteration measures the SAME string at a DIFFERENT size, so
     * every call is a unique key by construction. The loop was the bug, not the
     * lookup.
     *
     * A run's width is linear in its font size for a given family and tracking
     * — twice the size is twice the width — so one measurement gives the exact
     * size that fits. Two calls, not twelve, and the second only confirms it.
     */
    fontPx = startPx;
    cased = setHand(ctx, hand, stack, fontPx, text);
    const atStart = textWidth(ctx, cased);
    if (atStart > maxWidth) {
      fontPx = Math.max(floorPx, (startPx * maxWidth) / atStart);
      cased = setHand(ctx, hand, stack, fontPx, text);
    }
    fontPx = Math.max(fontPx, floorPx);
    cased = setHand(ctx, hand, stack, fontPx, text);
    if (pass === 1 || hand.face !== HEADING_FACE || fontPx >= HEADING_MIN_PX * spec.s) break;
    stack = FACE_STACKS[BODY_FACE]!;
  }

  let fitted = cased;
  if (textWidth(ctx, fitted) > maxWidth) {
    while (fitted.length > 1 && textWidth(ctx, `${fitted}…`) > maxWidth) {
      fitted = fitted.slice(0, -1);
    }
    fitted = `${fitted}…`;
  }
  ctx.fillStyle = ink;
  ctx.fillText(fitted, x + w / 2, y + h * 0.44);
  // Tracking is part of the drawing state, so it would leak into the ruled
  // flourish below and out into whatever the caller draws next.
  ctx.restore();

  // The icon's shortest rule, kept as the flourish under the title.
  stroke(
    ctx,
    x + w * 0.34,
    y + h * 0.78,
    x + w * 0.66,
    y + h * 0.78,
    spec.style === 'label' ? FLAT.inkSoft : ink,
    Math.max(0.9, h * 0.05),
    spec.seed + 7,
  );
}

/**
 * Metal corner plates.
 *
 * Flat, so a plate is a filled corner shape with the one ink outline — no
 * bevel, no rivet catchlight, nothing that implies a light source. Depth is
 * where it is everywhere else: a darker flat face beside a lighter one, here a
 * lip of the second metal tone along the plate's cut edge.
 *
 * ## The silhouette was wrong, and that is what read as cheap
 *
 * The first cut turned a hard right angle at the board's corner while the board
 * itself is drawn with a `radius` — so every plate's point stuck out past the
 * cover's own outline, four times per book. A corner piece is dressed to the
 * board it protects; this one now follows the same curve, which is the whole
 * fix for "a gold triangle stuck on".
 *
 * The rest is drawing rather than lighting: a lip along the cut, a fine rule
 * inside it, and three rivets — one in the elbow and one down each arm, which
 * is where they are on a real plate because that is where the leather needs
 * holding.
 */
function paintCornerPlates(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  gilded: boolean,
  ink: number,
): void {
  const size = Math.min(w * 0.17, h * 0.13);
  const fill = gilded ? FLAT.gilt : FLAT.timber;
  const deep = gilded ? FLAT.ochreDark : FLAT.timberDark;
  // Never let the corner curve eat the plate: a well-worn book rounds to
  // `radius`, and a plate the size of its own corner is not a plate.
  const r = Math.min(radius, size * 0.55);

  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x + w, y + h, -1, -1],
    [x, y + h, 1, -1],
  ] as const) {
    /** The outer edge: down one side, round the board's own corner, out the other. */
    const traceOuter = (): void => {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * size);
      ctx.lineTo(cx, cy + dy * r);
      ctx.quadraticCurveTo(cx, cy, cx + dx * r, cy);
      ctx.lineTo(cx + dx * size, cy);
    };
    /** The cut, scooped toward the corner exactly as a real plate is cut. */
    const scoop = (): void => {
      ctx.quadraticCurveTo(cx + dx * size * 0.4, cy + dy * size * 0.4, cx, cy + dy * size);
    };

    traceOuter();
    scoop();
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // The lip: the second metal face, laid along the cut and clipped to the
    // plate so it cannot bleed onto the board.
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(cx + dx * size, cy);
    scoop();
    pen(ctx, deep, size * 0.19);
    ctx.stroke();
    ctx.restore();

    traceOuter();
    scoop();
    ctx.closePath();
    pen(ctx, FLAT.ink, ink * 0.7);
    ctx.stroke();

    // A fine rule inside the cut, and the three rivets.
    ctx.beginPath();
    ctx.moveTo(cx + dx * size * 0.72, cy + dy * size * 0.06);
    ctx.quadraticCurveTo(
      cx + dx * size * 0.3,
      cy + dy * size * 0.3,
      cx + dx * size * 0.06,
      cy + dy * size * 0.72,
    );
    pen(ctx, FLAT.ink, ink * 0.4);
    ctx.stroke();
    for (const [ax, ay] of [
      [0.26, 0.26],
      [0.6, 0.13],
      [0.13, 0.6],
    ] as const) {
      dot(ctx, cx + dx * size * ax, cy + dy * size * ay, ink * 0.6, FLAT.ink);
    }
  }
}

/**
 * The charm — the fastest identity cue a reader has, so it is drawn cover-side
 * as well as spine-side. Six kinds, all flat fills with one ink outline.
 */
function paintCharm(
  ctx: FlatCtx,
  kind: Exclude<CharmKind, 'none'>,
  x: number,
  y: number,
  w: number,
  h: number,
  colourway: number | string,
  /** The board's own face, so the charm never disappears into it. */
  board: string,
  ink: number,
  seed: number,
): void {
  // ONE folding of the colourway, shared with the spine and the studio swatch:
  // `charms.charmCloth` hands back the ribbon face and the tone its knot turns
  // away in. This used to be a local table of eight FLAT constants in an order
  // of its own, so the chip labelled *Crimson* painted a terracotta ribbon
  // here, a green one on the shelf, and a third colour in the panel.
  //
  // The wrap is the TABLE's length, not the literal 8 it used to be: the day
  // the colourways grew past eight, `% 8` would have quietly folded every new
  // choice back onto an old one, with nothing failing anywhere.
  const wrap = CHARM_COLORS.length;
  let slot: number | string = colourway;
  if (typeof slot === 'number') slot = ((Math.trunc(slot) % wrap) + wrap) % wrap;
  // A crimson ribbon on a crimson board is a ribbon nobody can see. Step to
  // the next colourway rather than tinting this one, which would put a colour
  // outside the palette on screen. A reader's own hex has no "next", so it is
  // folded darker instead — still their colour, still visible.
  if (charmCloth(slot)[0] === board) {
    slot = typeof slot === 'number' ? (slot + 1) % wrap : charmCloth(slot)[1];
  }
  const [face, dark] = charmCloth(slot);
  const unit = Math.min(w, h);

  switch (kind) {
    case 'ribbon': {
      // A marker slipped down the fore-edge side, notched at the tail — the
      // icon's ribbon, stood up rather than hanging out of the bottom. It runs
      // outboard of the label on purpose; a ribbon laid across the title was
      // the first thing that looked wrong in the specimen.
      const rw = w * 0.075;
      const rx = x + w * 0.848;
      const tail = y + h * 0.26;
      ctx.beginPath();
      ctx.moveTo(rx, y - unit * 0.02);
      ctx.lineTo(rx + rw, y - unit * 0.02);
      ctx.lineTo(rx + rw, tail);
      ctx.lineTo(rx + rw / 2, tail - rw * 0.55);
      ctx.lineTo(rx, tail);
      ctx.closePath();
      ctx.fillStyle = face;
      ctx.fill();
      pen(ctx, FLAT.ink, ink * 0.8);
      ctx.stroke();
      // The fold: one darker face, which is the whole depth model again.
      stroke(ctx, rx + rw * 0.72, y, rx + rw * 0.72, tail - rw * 0.3, dark, rw * 0.3, seed);
      break;
    }
    case 'tassel': {
      const cx = x + w * 0.85;
      const top = y + h * 0.05;
      const headR = unit * 0.045;
      pen(ctx, dark, ink * 0.9);
      ctx.beginPath();
      ctx.moveTo(cx - headR * 1.6, top);
      ctx.quadraticCurveTo(cx, top + headR * 1.2, cx + headR * 1.6, top);
      ctx.stroke();
      panel(ctx, cx - headR, top + headR * 0.9, headR * 2, headR * 1.9, face, {
        radius: headR * 0.6,
        seed,
        width: Math.max(1, ink * 0.7),
      });
      for (let i = 0; i < 5; i++) {
        const fx = cx - headR * 0.8 + (i / 4) * headR * 1.6;
        stroke(ctx, fx, top + headR * 2.6, fx, top + headR * 4.6, dark, headR * 0.3, seed + i);
      }
      break;
    }
    case 'pressed-flower': {
      const cx = x + w * 0.76;
      const cy = y + h * 0.84;
      const pr = unit * 0.055;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * pr * 0.7, cy + Math.sin(a) * pr * 0.7, pr * 0.6, pr * 0.38, a, 0, Math.PI * 2);
        ctx.fillStyle = face;
        ctx.fill();
        pen(ctx, FLAT.ink, ink * 0.6);
        ctx.stroke();
      }
      dot(ctx, cx, cy, pr * 0.3, FLAT.gilt);
      break;
    }
    case 'clasp': {
      // A strap reaching round the fore-edge with a small plate on the end.
      const cy = y + h * 0.52;
      const sh = unit * 0.055;
      panel(ctx, x + w * 0.78, cy - sh / 2, w * 0.22, sh, face, {
        radius: sh * 0.35,
        seed,
        width: Math.max(1, ink * 0.7),
      });
      panel(ctx, x + w * 0.74, cy - sh * 0.9, sh * 1.5, sh * 1.8, FLAT.gilt, {
        radius: sh * 0.4,
        seed: seed + 3,
        width: Math.max(1, ink * 0.7),
      });
      break;
    }
    case 'wax-seal': {
      const cx = x + w * 0.76;
      const cy = y + h * 0.84;
      const sr = unit * 0.06;
      // A wax blob is a circle a hand pressed: a many-sided polygon reads far
      // more like poured wax than ctx.arc does.
      const blob = polyPts(cx, cy, sr, 11).map((p, i) => ({
        x: p.x + Math.cos(i * 2.1) * sr * 0.09,
        y: p.y + Math.sin(i * 3.3) * sr * 0.09,
      }));
      tracePoly(ctx, blob);
      ctx.fillStyle = face;
      ctx.fill();
      pen(ctx, FLAT.ink, ink * 0.8);
      ctx.stroke();
      tracePoly(ctx, starPts(cx, cy, sr * 0.5, sr * 0.22, 5));
      pen(ctx, dark, ink * 0.7);
      ctx.stroke();
      break;
    }
    default: {
      // Dangling tag: string over the head of the board, then the card.
      const cx = x + w * 0.84;
      const top = y + h * 0.04;
      const tw = unit * 0.16;
      const th = unit * 0.1;
      stroke(ctx, cx, top, cx, top + th * 0.5, FLAT.inkSoft, Math.max(1, ink * 0.6), seed);
      panel(ctx, cx - tw / 2, top + th * 0.5, tw, th, face, {
        radius: th * 0.3,
        seed: seed + 2,
        width: Math.max(1, ink * 0.7),
      });
      stroke(
        ctx,
        cx - tw * 0.28,
        top + th * 1.05,
        cx + tw * 0.28,
        top + th * 1.05,
        dark,
        Math.max(0.9, th * 0.1),
        seed + 5,
      );
      break;
    }
  }
}

/* --------------------------------- render --------------------------------- */

export interface RenderCoverOptions {
  /** Skip the title plate even when a title is given (page backdrops). */
  plate?: boolean;
}

/**
 * Render one front cover at w×h onto a fresh canvas and return it.
 * Deterministic per (params, size, title).
 */
export function renderCover(
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): HTMLCanvasElement {
  const canvas = makeCanvas(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  renderCoverInto(ctx, canvas.width, canvas.height, params, title, opts);
  return canvas;
}

/**
 * Paint a cover into an existing 2d context (harness/preview reuse).
 *
 * Three call sites hand this three different aspect ratios — a 0.72 portrait
 * for the pull-out, a 720×500 landscape for the open book's backdrop, and the
 * studio's 214×292 preview — so every measurement below is a fraction of the
 * box rather than a fixed distance. Only type sizes use the detail scale `s`,
 * because a font has an absolute floor below which it stops being readable.
 */
export function renderCoverInto(
  ctx: FlatCtx,
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): void {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const seed = params.seed >>> 0;
  const s = Math.max(0.5, Math.min(w / 380, h / 520));
  const wear = clamp(params.wear ?? 0, 0, 1);
  // The covering — one of the fifty the SPINE wears, resolved through the same
  // table. It decides three things about a board: its tone (`boardFor`), where
  // a second covering sits, and the one grain it carries.
  const covering = coveringSpecFor(params);
  const board = boardFor(covering, clothFor(params.palette, params.clothHex));
  const pale = board === PALE_BOARD;
  const [face, dark] = board;
  const accent = accentFor(params.palette, seed);
  const gilded = params.gilt;

  /* ---- layout ---- */
  const pad = Math.min(w, h) * 0.016;
  // The text block peeks past the fore-edge. It has to show *enough* to read
  // as leaves rather than as a stray line, and the boards have to overlap it
  // by more than their own bow or the two shapes visibly come apart.
  const pageW = Math.max(4, w * 0.055);
  const bx = pad;
  const by = pad;
  const bw = w - pad * 2 - pageW * 0.62;
  const bh = h - pad * 2;
  // A well-loved book is a rounder book. That is the whole of `wear` now: the
  // old pass ground dirt and bleach into the boards, which is exactly the kind
  // of simulated grubbiness flat art cannot carry.
  const radius = Math.min(bw, bh) * (0.04 + wear * 0.03);
  const spineW = bw * 0.13;
  const faceX = bx + spineW;
  const faceW = bw - spineW;
  const ink = inkWidth(Math.min(bw, bh));

  /* ---- text block, then the board over it ---- */
  paintTextBlock(
    ctx,
    w - pad - pageW,
    by + bh * 0.035,
    pageW,
    bh * 0.93,
    params.edge ?? 'plain',
    seed + 21,
  );
  panel(ctx, bx, by, bw, bh, face, { radius, seed, width: ink });
  // The covering goes on before the strip, because a half binding's leather
  // runs UNDER the spine — the strip and the split band are one piece of skin,
  // and drawing the band on top of the strip put a seam through the middle of
  // it.
  paintCovering(
    ctx,
    covering,
    bx,
    by,
    bw,
    bh,
    spineW,
    radius,
    face,
    dark,
    accent,
    ink,
    gilded,
    pale,
    wear,
    seed + 61,
  );
  paintSpineStrip(ctx, bx, by, bw, bh, spineW, radius, face, dark, ink, gilded, seed);

  /* ---- ornament ---- */
  // The icon's frame is pale gilt on a terracotta board. A book with no foil
  // gets the same frame blind-tooled instead — the board's own darker tone,
  // which is what a binder without gold leaf actually does. A cream board
  // swallows both pale tones, so parchment tools in the deeper ochre.
  const frameInk = pale ? FLAT.ochreDark : gilded ? FLAT.giltPale : dark;
  const ornInk = pale ? FLAT.ochreDark : gilded ? FLAT.gilt : dark;
  /**
   * The board's own colour taken a step toward the ink.
   *
   * ONE tone, shared by the three places this file now shows depth as a second
   * flat face — a banded frame's border, the sunk panel behind an inset plate,
   * the field a medallion is struck into. Deriving all three from `face` is
   * what keeps them reading as the same board rather than as three
   * decorations: a board darkens one way, and it darkens by the same amount
   * wherever it is cut into.
   */
  const sunk = mixHex(face, FLAT.ink, 0.17);
  // Fine ornament is the first thing to go as a book wears.
  const fineDetail = wear < 0.7;
  const fx = faceX + faceW * 0.085;
  const fy = by + bh * 0.055;
  paintFrame(
    ctx,
    fx,
    fy,
    faceW * 0.83,
    bh * 0.89,
    params.frame,
    frameInk,
    sunk,
    fineDetail,
    seed + 31,
  );

  /* ---- label ---- */
  const labelW = faceW * 0.62;
  const labelH = Math.min(bh * 0.17, labelW * 0.62);
  const labelX = faceX + (faceW - labelW) / 2;
  const labelY = by + bh * 0.4 - labelH / 2;
  const plateStyle: TitlePlateStyle = params.titlePlate ?? 'label';
  if (opts.plate !== false) {
    paintLabel(ctx, labelX, labelY, labelW, labelH, title, {
      style: title ? plateStyle : 'label',
      inset: params.insetPlate === true,
      gilded,
      dark,
      sunk,
      paleBoard: pale,
      hand: handFor(params.titleFont),
      seed: seed + 41,
      s,
    });
  }

  /* ---- medallion ---- */
  // Sat where the icon sits it: below the label, on the lower third of the
  // board, so the two marks read as a pair rather than a stack.
  const medR = Math.min(faceW, bh) * 0.085;
  const medX = faceX + faceW * 0.5;
  const medY = by + bh * (opts.plate === false ? 0.62 : 0.72);
  // No shadow under it. A medallion is tooled *into* the board, not resting on
  // it, and the first specimen's contact ellipse read as a thumbprint. The
  // field it is struck into is concentric for exactly that reason.
  //
  // Which WAY the field steps is decided by the stamp, not by a light: a gilt
  // stamp is pale, so it wants the deeper face under it; a blind-tooled one is
  // the board's own dark, so a deeper field swallowed it — the specimen came
  // back with the lyre on the green Smooth Cloth board less visible than
  // before the field existed. Stepping the other way is the same depth model
  // (a flat face beside another) and keeps the stamp readable either way.
  const medField = gilded || pale ? sunk : mixHex(face, FLAT.cream, 0.24);
  paintMedallion(ctx, medX, medY, medR, params.medallion, ornInk, medField, fineDetail);

  /* ---- fittings ---- */
  if (params.cornerProtectors) {
    paintCornerPlates(ctx, bx, by, bw, bh, radius, gilded, ink);
  }
  if (params.charm && params.charm !== 'none') {
    paintCharm(ctx, params.charm, bx, by, bw, bh, params.charmColor ?? 0, face, ink, seed + 51);
  }

  ctx.restore();
}

/* ------------------------------- bake cache ------------------------------- */

const urlCache = new Map<string, string>();

/**
 * The identity of one baked cover.
 *
 * Exported so a node test can hold it up against `CoverParams` field by field
 * — `tests/covers.test.ts` turns every knob in turn and fails on any that does
 * not move the key. That gate is worth a named function, because getting this
 * wrong is INVISIBLE: a cache validates nothing about a hit, so a key missing
 * an axis serves the wrong board to everyone who already has the right one
 * under that key, and keeps serving it until the app is reloaded. This file
 * has met that failure twice already, both times through a count that had
 * stopped describing its own table.
 *
 * The room leads it: a cover's cloth comes from the live scheme, so the same
 * params in two rooms are two different PNGs.
 *
 * `covering` is folded through `coveringSpecFor` rather than written raw,
 * because that is the function the drawing reads — a book with no `covering`
 * and a book pinned to the covering its material resolves to are the same
 * picture, and they should be the same PNG.
 */
export function coverCacheKey(
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): string {
  return `${flatSchemeTag()}|${params.seed}|${params.palette}|${params.clothHex ?? '-'}|${params.texture}|${coveringSpecFor(params).id}|${params.frame}|${params.medallion}|${params.titleFont}|${params.gilt ? 1 : 0}|${params.material ?? '-'}|${params.titlePlate ?? '-'}|${params.cornerProtectors ? 1 : 0}|${params.insetPlate ? 1 : 0}|${params.edge ?? '-'}|${(params.wear ?? 0).toFixed(3)}|${params.charm ?? '-'}|${params.charmColor ?? 0}|${Math.round(w)}x${Math.round(h)}|${opts.plate === false ? 0 : 1}|${title}`;
}

/**
 * Bake-once data-URL for a cover. Keyed by seed, overrides, size and title —
 * repeated calls (overlay opens, backdrop re-renders) hit the cache.
 *
 * Every knob that changes a pixel has to appear in this key or the cover will
 * not re-bake when the studio turns it.
 */
export function coverDataUrl(
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): string {
  const key = coverCacheKey(w, h, params, title, opts);
  const cached = urlCache.get(key);
  if (cached !== undefined) return cached;
  const url = renderCover(w, h, params, title, opts).toDataURL('image/png');
  // A cover baked before its title face arrived is a cover lettered in the
  // generic. Draw it — a titled cover in the wrong hand beats a blank wait —
  // but do not let it become the answer for the rest of the session.
  if (title.trim() !== '' && !handLoaded(params.titleFont, h * 0.08)) return url;
  // Guard the cache: keep it bounded (covers are ~100-300KB each).
  if (urlCache.size > 24) {
    const first = urlCache.keys().next().value;
    if (first !== undefined) urlCache.delete(first);
  }
  urlCache.set(key, url);
  return url;
}
