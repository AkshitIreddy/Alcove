/**
 * art/wallpaperDesign.ts — the wall, given a vocabulary.
 *
 * The wall used to be ONE FLAT TINT, and it was a flat tint for a good reason:
 * every version that had a pattern also had a visible seam. The reader saw a
 * "weird tiling effect" and "white bands in the corners" while panning, and the
 * fix each time was to delete the pattern rather than to fix the tile. So the
 * bar this module has to clear is not "draw a nice damask" — it is "draw
 * anything at all whose repeat cannot be found by eye".
 *
 * ## How seamlessness is structural here, not a property to be tested for
 *
 * Every mark in a tile is emitted through {@link emit}, which knows the tile is
 * a TORUS. A mark declares the span its ink occupies; if that span reaches past
 * an edge, the emitter draws the mark AGAIN, translated by exactly one tile, so
 * the part that left the right edge re-enters at the left as the same curve
 * with the same seed. Nothing is clipped into place and nothing is mirrored —
 * the far copy is bit-identical geometry, which is the only thing that makes a
 * hand-drawn wobble safe to run over an edge.
 *
 * Marks that run the whole width or height of the tile (stripes, chevrons)
 * cannot be handled that way, because a shape with a start and an end has caps,
 * and a cap landing mid-seam is exactly the pale band that got reported. Those
 * declare `null` for the axis they run along and instead carry a profile that
 * is PERIODIC in that axis by construction — a sine or a triangle wave whose
 * wavelength divides the tile — so the geometry at t = 0 and t = size is the
 * same number, not merely a similar one. `wobbleRect`'s quadratic bow is not
 * periodic and is therefore never used on a running mark.
 *
 * Lattices are fitted to the tile rather than the tile to the lattice: the
 * caller asks for a size and the cell is `size / round(size / cell)`, so the
 * repeat is always an exact integer count and the motif merely comes out a few
 * percent off its nominal scale. Half-drop and brick lattices additionally
 * force an even count, or the drop would not close.
 *
 * ## The style
 *
 * Flat fills, one soft ink outline, rounded everything, edges that bow — the
 * icon's language (`flat.ts`), one step quieter, because a wall is a backdrop
 * and the books are the subject. The wallpaper's ink is `FLAT.ink` mixed back
 * toward the wall so the pattern never competes with the case standing on it.
 *
 * Relief (the depth axis) is a SECOND FLAT FACE offset behind the motif, in a
 * solid colour, drawn in its own pass so a neighbour's face always covers it.
 * It is not a shadow: no blur, no alpha, no light direction. It is the same
 * trick the icon plays with a book's spine beside its cover, applied to a
 * repeat.
 *
 * ## Colour, in two independent halves
 *
 * Everything is derived from `flatScheme()`, so redecorating the room repaints
 * the wall with it. A preset picks WHICH slot it borrows from — a shade of the
 * wall itself, the case timber, the recess, gilt, or one of the book cloths —
 * never a literal hex, so no preset can look wrong in a room it was not
 * designed against.
 *
 * There are TWO such choices, and the second is why this file stopped being a
 * book of beiges. `ink` sets the motif's own wash, and that wash has to stay
 * quiet: the wall is a backdrop and the books are the subject, so every ink
 * slot is a mix back toward the wall, damped further by how much of the wall
 * the pattern covers. `tone` sets the ELEMENTS inside the motif — the berry,
 * the pip, the roof, the seeds — and that one is allowed to be an actual
 * colour, because a detail is a few percent of the wall's area. A cream sprig
 * with a terracotta bud is a different paper from a cream sprig with a green
 * one, and until `tone` existed the only way to get either was to recolour the
 * whole motif.
 *
 * ## Sharpness
 *
 * `edge` runs from an engraved hairline to a soft blotted one. It is NOT a
 * blur: a blur would have to be clipped at the tile edge, and an antialiased
 * clip edge is the pale band this module exists to avoid. It is what a
 * different nib actually changes — line weight, line contrast, how far corners
 * round off, and how much the hand wobbles.
 *
 * ## The book
 *
 * A hundred and twenty-six papers, eighteen per design family. Balanced across
 * FAMILIES rather than across motifs, because an earlier book was built motif
 * by motif and came out twelve geometrics to five scenics. Every one carries
 * mood tags, so a roll of the dice can be steered ("something quiet",
 * "something gilded") instead of being a lottery over the whole book.
 *
 * Fifty motifs, fifty tones and a hundred and twenty-six named papers is a lot
 * of list, and the guard against it becoming a list is that every axis has to
 * be REACHABLE: `tests/art-wallpaper.test.ts` fails if a motif, a scale, a
 * depth, an ink slot, a tone or a nib exists that no paper in the book ever
 * asks for. A value nothing reaches is drawing code nobody will ever see.
 *
 * ## Ranking, and why a wall is judged differently
 *
 * A hundred and twenty-six papers that are all equally offered is a hundred and
 * twenty-six papers of which a dozen are the reason someone stops trusting the
 * picker. So every paper carries a {@link WallpaperTier} — `front`, `book` or
 * `back` — decided by rendering it onto a wall-sized patch at the pitch the app
 * actually shows it at and LOOKING at it (`scripts/probe-wallpapers.mjs`).
 *
 * The bar is not a book spine's. A spine is an inch of a shelf; a wall is the
 * largest flat area on screen and the thing a reader looks past all day, so a
 * paper fails three ways a spine cannot — by being BUSY, by having a motif that
 * reads as something else once it is a foot across (a row of headstones, a
 * chain-link fence, a stack of Christmas trees), or by being so faint that it
 * is Plain Parchment with extra steps.
 *
 * Nothing is deleted for it. `WALLPAPER_PRESETS` is DERIVED from the tier so
 * the good ones lead their section; {@link WALLPAPER_ROLL} drops the demoted
 * ones so "surprise me" never hands one to somebody who did not go looking; and
 * every one of the hundred and twenty-six is still there to be picked.
 */

import {
  FLAT,
  contactShadow,
  flatScheme,
  flatSchemeTag,
  stroke,
  type FlatCtx,
  type FlatScheme,
} from './flat';
import { fnv1a } from './noise';

/* ============================== the axes ================================= */

/**
 * The motifs. Roughly a wallpaper book's table of contents: a few stripes, a
 * few geometrics, a few florals, a few scenics.
 */
export const WALLPAPER_PATTERNS = [
  // ruled — hairlines, weaves and horizontal banding
  'plain',
  'pinstripe',
  'ticking',
  'moire',
  'grasscloth',
  'awning',
  'beading',
  // stripe — anything that runs the length of the wall
  'stripe',
  'chevron',
  'herringbone',
  'serpentine',
  'flamestitch',
  'bamboo',
  'rope',
  // check — two populations meeting edge to edge
  'gingham',
  'harlequin',
  'honeycomb',
  'tattersall',
  'argyle',
  'pinwheel',
  'basketweave',
  // lattice — a net, with or without something caught in it
  'trellis',
  'arch',
  'scallop',
  'diaper',
  'fret',
  'quatrefoil',
  'ogee',
  // spot — a small device, sown
  'polka',
  'star',
  'moonstar',
  'bee',
  'fleur',
  'sunburst',
  'constellation',
  // botanical — things that grew
  'sprig',
  'laurel',
  'pomegranate',
  'fern',
  'vine',
  'thistle',
  'rose',
  // figured — a device, a scene, or a creature
  'damask',
  'urn',
  'bird',
  'toile',
  'arabesque',
  'pagoda',
  'medallion',
  'hare',
] as const;

export type WallpaperPattern = (typeof WALLPAPER_PATTERNS)[number];

/**
 * The design families, in the order a wallpaper book prints them — and that
 * order is a JUDGEMENT, not the order the sections happened to be written in.
 *
 * A wall is the largest flat area on screen and the reader looks past it all
 * day, so the sections that lead are the ones that can be looked past: ruling
 * and stripes first, then the nets, then the figured papers a library actually
 * wants behind it. `spot` is last because it is where a motif is most likely to
 * read as a sticker — a hand-sized crescent or a five-point star at wall scale
 * is the loudest thing a paper in this book can be — and `check` is next to
 * last because its densest members read as a FLOOR rather than as a wall.
 *
 * `figured` is the odd one: damasks, urns, birds and toiles are four different
 * things, but they are all a DEVICE repeated rather than a geometry, and a
 * section of two papers each reads better than four sections of two.
 */
export const WALLPAPER_FAMILIES = [
  'ruled',
  'stripe',
  'lattice',
  'figured',
  'botanical',
  'check',
  'spot',
] as const;
export type WallpaperFamily = (typeof WALLPAPER_FAMILIES)[number];

/**
 * Where in its section a paper is printed — the quality axis.
 *
 * Every one of the hundred and twenty-six was rendered onto a wall-sized patch
 * at the pitch `world.ts` actually shows it at and LOOKED AT
 * (`scripts/probe-wallpapers.mjs`). A paper on a wall can fail three ways that
 * a paper on a picker card cannot: it can be BUSY, its motif can read as
 * something it is not once it is a foot across, and it can be so faint that it
 * is Plain Parchment with extra steps. All three land a paper at the back.
 *
 * Nothing was deleted. A demotion moves a paper down its section and takes it
 * out of the dice; it stays fully pickable, because the reader who goes looking
 * for a hand-sized gold crescent should find one.
 *
 *  - `front` — leads its section. The ones to reach for.
 *  - `book`  — the body of the book. Good papers, none of them the best.
 *  - `back`  — printed at the back, and never rolled. Odd, busy, or a motif
 *              that reads as something else at wall size.
 */
export const WALLPAPER_TIERS = ['front', 'book', 'back'] as const;
export type WallpaperTier = (typeof WALLPAPER_TIERS)[number];

/** Which family each motif belongs to. Seven each, eight for `figured`. */
const PATTERN_FAMILY: Record<WallpaperPattern, WallpaperFamily> = {
  plain: 'ruled',
  pinstripe: 'ruled',
  ticking: 'ruled',
  moire: 'ruled',
  grasscloth: 'ruled',
  awning: 'ruled',
  beading: 'ruled',
  stripe: 'stripe',
  chevron: 'stripe',
  herringbone: 'stripe',
  serpentine: 'stripe',
  flamestitch: 'stripe',
  bamboo: 'stripe',
  rope: 'stripe',
  gingham: 'check',
  harlequin: 'check',
  honeycomb: 'check',
  tattersall: 'check',
  argyle: 'check',
  pinwheel: 'check',
  basketweave: 'check',
  trellis: 'lattice',
  arch: 'lattice',
  scallop: 'lattice',
  diaper: 'lattice',
  fret: 'lattice',
  quatrefoil: 'lattice',
  ogee: 'lattice',
  polka: 'spot',
  star: 'spot',
  moonstar: 'spot',
  bee: 'spot',
  fleur: 'spot',
  sunburst: 'spot',
  constellation: 'spot',
  sprig: 'botanical',
  laurel: 'botanical',
  pomegranate: 'botanical',
  fern: 'botanical',
  vine: 'botanical',
  thistle: 'botanical',
  rose: 'botanical',
  damask: 'figured',
  urn: 'figured',
  bird: 'figured',
  toile: 'figured',
  arabesque: 'figured',
  pagoda: 'figured',
  medallion: 'figured',
  hare: 'figured',
};

/** The family a motif sits in. Exported so a picker can group by it. */
export function wallpaperFamily(pattern: WallpaperPattern): WallpaperFamily {
  return PATTERN_FAMILY[pattern];
}

/**
 * How big the motif is, as a nominal cell in CSS px at zoom 1.
 *
 * Five stops rather than a slider: the difference between a 34px sprig and a
 * 38px sprig is not a decision anyone wants to make, and a named stop is
 * something a preset can be built out of.
 */
export const WALLPAPER_SCALES = ['petite', 'small', 'medium', 'large', 'grand'] as const;
export type WallpaperScale = (typeof WALLPAPER_SCALES)[number];

const SCALE_CELL: Record<WallpaperScale, number> = {
  petite: 34,
  small: 52,
  medium: 78,
  large: 116,
  grand: 168,
};

/**
 * How much the motif reads as raised, as the offset of its second face in
 * fractions of the cell. `flat` draws no second face at all.
 */
export const WALLPAPER_DEPTHS = ['flat', 'low', 'raised', 'carved'] as const;
export type WallpaperDepth = (typeof WALLPAPER_DEPTHS)[number];

/**
 * Offsets are small on purpose. Past about a twentieth of the cell the second
 * face stops reading as the motif's own thickness and starts reading as a
 * shadow cast by a lamp — which is the one thing the style forbids.
 */
const DEPTH_OFFSET: Record<WallpaperDepth, number> = {
  flat: 0,
  low: 0.014,
  raised: 0.026,
  carved: 0.042,
};

/**
 * And an absolute ceiling on top of the proportional one.
 *
 * A fraction of the cell is the right RULE — a grand motif's thickness has to
 * grow with it — but a grand star's cell is 145px and five percent of that is
 * a seven-pixel offset, which stops being an edge and starts being a shadow
 * cast by a lamp. Nine pixels is about where a flat second face still reads as
 * the motif's own side.
 */
const DEPTH_MAX_PX = 9;

/**
 * Which slot of the live scheme the motif borrows its colour from.
 *
 * The wall is the lightest thing on screen and has to stay that way, so every
 * one of these is a MIX toward the wall rather than the slot's own hex — a
 * timber-inked trellis is a warm tea-stain of the case colour, not the case
 * colour.
 */
export const WALLPAPER_INKS = ['paper', 'deep', 'timber', 'recess', 'gilt', 'cloth'] as const;
export type WallpaperInk = (typeof WALLPAPER_INKS)[number];

/**
 * What the ELEMENTS inside the motif are coloured — the berry on the laurel,
 * the pip in the honeycomb, the roof on the toile cottage, the seeds in the
 * pomegranate.
 *
 * A separate axis from `ink` because `ink` decides the motif's own wash and
 * that wash has to stay quiet — the wall is a backdrop. The detail is the one
 * place a paper is allowed to be an actual colour, and until this axis existed
 * every paper in the book was a shade of the same beige with a gilt pip, which
 * is precisely what "more colour" was asking for.
 *
 * Most of these name a CLOTH SLOT rather than a hue, for the reason the ink
 * slots do: `ember` is terracotta in the athenaeum and coral in the reef, and
 * a paper built against one room should not look wrong in another.
 */
export const WALLPAPER_TONES = [
  // The eight this axis shipped with. Their recipes are unchanged, so every
  // paper written against them draws the pixels it always drew.
  'auto',
  'gilt',
  'chalk',
  'ember',
  'sea',
  'berry',
  'bay',
  'ink',
  // Warm — the first cloth, worked light and dark.
  'coral',
  'rust',
  'brick',
  'clay',
  // Gold — the gilt and the fourth cloth, which is the room's ochre.
  'honey',
  'amber',
  'straw',
  'bronze',
  'saffron',
  'brass',
  // Green — the fifth and sixth cloths.
  'moss',
  'forest',
  'olive',
  'fern',
  'verdigris',
  'myrtle',
  // Blue — the second cloth.
  'slate',
  'sky',
  'denim',
  'teal',
  'indigo',
  // Red-violet — the third cloth.
  'plum',
  'rose',
  'mulberry',
  'heather',
  'blush',
  // Neutral — the case, the recess, the ink and the paper.
  'oak',
  'walnut',
  'cocoa',
  'sepia',
  'soot',
  'linen',
  'pearl',
  'stone',
  'smoke',
  // Blends — two slots crossed, for the hues a six-cloth room has no slot for.
  'copper',
  'jade',
  'wine',
  'harvest',
  'mist',
  'peat',
  'ivory',
] as const;
export type WallpaperTone = (typeof WALLPAPER_TONES)[number];

/**
 * How sharp the drawn edge is, from a fine engraved line to a soft blotted one.
 *
 * NOT a blur. A blur would have to be clipped at the tile edge and an
 * antialiased clip edge is the pale band this whole module exists to avoid —
 * and it is a light-model move besides. Sharpness here is what a pen actually
 * changes: line WEIGHT, line CONTRAST, how far corners are rounded off, and how
 * much the hand wobbles. A blotted motif is a fat pale outline with round
 * corners and a shaky rim; an etched one is a hair-thin dark line with crisp
 * corners. Same shapes, different nib.
 */
export const WALLPAPER_EDGES = ['etched', 'crisp', 'soft', 'blotted'] as const;
export type WallpaperEdge = (typeof WALLPAPER_EDGES)[number];

/**
 * A wallpaper, fully specified.
 *
 * `tone` and `edge` are OPTIONAL, and that is a compatibility decision rather
 * than a taste one: `data/designPrefs.ts` rebuilds a spec field by field when
 * it reads one back off disk, and a required field there would be a type error
 * in a file this module does not own. Absent means `auto` / `crisp`, which is
 * exactly the paper the first fifty-five presets drew.
 */
export interface WallpaperSpec {
  pattern: WallpaperPattern;
  scale: WallpaperScale;
  depth: WallpaperDepth;
  ink: WallpaperInk;
  /** Element colour. Defaults to `auto`. */
  tone?: WallpaperTone;
  /** Edge sharpness. Defaults to `crisp`. */
  edge?: WallpaperEdge;
}

/**
 * The six axes as one short string.
 *
 * Exported because two callers outside this module need "is the reader looking
 * at a different paper" and both grew their own four-axis version of it while
 * the spec had four axes. A local copy that has fallen two axes behind serves a
 * stale wall off the bake cache, which is the same class of bug the scheme tag
 * exists to close.
 */
export function wallpaperAxisKey(spec: WallpaperSpec): string {
  return `${spec.pattern}.${spec.scale}.${spec.depth}.${spec.ink}.${spec.tone ?? 'auto'}.${spec.edge ?? 'crisp'}`;
}

/* ============================ colour plumbing ============================ */

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  if (!Number.isFinite(n)) return [233, 226, 208];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Straight linear mix, `t` of `b` into `a`. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Rough perceptual lightness 0–1, for keeping the wall the lightest surface. */
function luma(hex: string): number {
  const [r, g, b] = channels(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Roughly how much of the wall each pattern paints, as a damping factor on the
 * ink mix. 1 = a sprinkle of motifs on bare paper; 0.5 = the pattern IS the
 * wall and the mix has to be halved for the room to survive it.
 */
const COVERAGE: Record<WallpaperPattern, number> = {
  plain: 1,
  pinstripe: 1,
  ticking: 0.9,
  moire: 0.75,
  // Nothing but line, but there is a LOT of it — a grasscloth at full wash is
  // a brown wall with a weave scratched into it.
  grasscloth: 0.6,
  awning: 0.7,
  beading: 0.9,
  stripe: 0.7,
  chevron: 0.8,
  // A true parquet leaves no paper showing at all, so the wash has to come
  // most of the way back down or the wall turns into a floor.
  herringbone: 0.62,
  serpentine: 0.7,
  flamestitch: 0.55,
  bamboo: 0.72,
  rope: 0.82,
  gingham: 0.62,
  harlequin: 0.55,
  honeycomb: 0.5,
  tattersall: 0.85,
  argyle: 0.55,
  pinwheel: 0.5,
  basketweave: 0.6,
  trellis: 1,
  arch: 0.62,
  scallop: 1,
  diaper: 1,
  fret: 0.8,
  quatrefoil: 0.7,
  ogee: 0.86,
  polka: 1,
  star: 1,
  moonstar: 1,
  bee: 1,
  fleur: 1,
  sunburst: 1,
  constellation: 1,
  sprig: 1,
  laurel: 1,
  pomegranate: 1,
  fern: 1,
  vine: 1,
  thistle: 1,
  rose: 1,
  damask: 0.92,
  urn: 1,
  bird: 1,
  toile: 0.9,
  arabesque: 0.95,
  pagoda: 1,
  medallion: 0.95,
  hare: 1,
};

/**
 * The five colours a tile is drawn out of.
 *
 * Five, because the moment there is a sixth the wall starts competing with the
 * books. `ground` is the wall exactly as the room set it, so a wallpapered wall
 * and a plain one are the same colour at a distance.
 */
export interface WallpaperColours {
  /** The wall itself — `flatScheme().wall`, untouched. */
  ground: string;
  /** The motif's flat fill. */
  face: string;
  /** The motif's outline. Softer than `FLAT.ink`: a wall is not furniture. */
  ink: string;
  /** The second flat face behind the motif when depth > flat. */
  relief: string;
  /** The detail colour — a berry, an eye, a roof, a pip. Set by `tone`. */
  accent: string;
  /**
   * A darker face for shapes INSIDE the motif — a folded wing, a shaded niche,
   * the seeds of a pomegranate.
   *
   * A solid colour rather than the ink at `globalAlpha`, which is what the
   * first version used. Alpha over a flat fill is a grey with the hue washed
   * out of it, and three of the motifs had one; a second flat face beside a
   * lighter one is the style's own way of saying depth, and it holds its
   * colour.
   */
  bloom: string;
}

/**
 * How far each ink slot pulls the motif away from the wall colour.
 *
 * All modest, and that is the constraint rather than the taste: the wall has to
 * stay the lightest and quietest surface on screen or the books stop being the
 * subject. A half-strength gilt turned the whole room into a jewellery box the
 * first time these were tuned by eye alone.
 */
const INK_MIX: Record<WallpaperInk, { toward: (s: ReturnType<typeof flatScheme>) => string; t: number }> = {
  paper: { toward: () => FLAT.ink, t: 0.1 },
  deep: { toward: () => FLAT.ink, t: 0.24 },
  // The three HUED slots pull further than they used to. The first tuning was
  // so cautious that a timber trellis and a cloth trellis were the same wall
  // with a rounding error between them; the whole book read as one beige. They
  // are still nowhere near their own hex — `COVERAGE` takes a bite out of every
  // one of these — but a paper the reader picked for its colour now has one.
  timber: { toward: (s) => s.timber, t: 0.52 },
  recess: { toward: (s) => s.recess, t: 0.42 },
  gilt: { toward: () => FLAT.gilt, t: 0.46 },
  cloth: { toward: (s) => s.cloths[0]?.[0] ?? FLAT.terracotta, t: 0.46 },
};

/* ------------------------------- the tones ------------------------------- */

/** Everything a tone recipe is allowed to look at. */
interface ToneCtx {
  room: FlatScheme;
  ground: string;
  face: string;
  ink: string;
}

type ToneRecipe = (t: ToneCtx) => string;

/**
 * One cloth slot of the live room, with the house cloth as the fallback.
 *
 * Named rather than indexed at every call site because the index is the one
 * thing here that carries no meaning: `cloths[2]` is plum in the athenaeum and
 * something else entirely in the reef, and the whole reason a tone borrows a
 * SLOT is that the room is allowed to decide what lives there.
 */
function clothSlot(i: number, dark: boolean, fallback: string): (room: FlatScheme) => string {
  return (room) => room.cloths[i]?.[dark ? 1 : 0] ?? fallback;
}

const EMBER = clothSlot(0, false, FLAT.terracotta);
const EMBER_DARK = clothSlot(0, true, FLAT.terracottaDark);
const SEA = clothSlot(1, false, FLAT.slate);
const SEA_DARK = clothSlot(1, true, FLAT.slateDark);
const BERRY = clothSlot(2, false, FLAT.plum);
const BERRY_DARK = clothSlot(2, true, FLAT.plumDark);
const OCHRE = clothSlot(3, false, FLAT.ochre);
const OCHRE_DARK = clothSlot(3, true, FLAT.ochreDark);
const BAY = clothSlot(4, false, FLAT.sage);
const BAY_DARK = clothSlot(4, true, FLAT.sageDark);
const MOSS = clothSlot(5, false, FLAT.moss);
const MOSS_DARK = clothSlot(5, true, FLAT.mossDark);

/** A fixed colour, as a slot, so the two can be written the same way. */
function fixed(hex: string): (room: FlatScheme) => string {
  return () => hex;
}

/** Two slots crossed — how a six-cloth room gets a verdigris or a copper. */
function cross(
  a: (room: FlatScheme) => string,
  b: (room: FlatScheme) => string,
  t: number,
): (room: FlatScheme) => string {
  return (room) => mix(a(room), b(room), t);
}

/**
 * The shape of nearly every tone: take a slot, lift it toward the cream or
 * push it toward the ink, then settle it a little way back into the room.
 *
 * The settle is what stops a detail glowing out of the wall — but it is small,
 * and deliberately so. `ink` sets the motif's own wash and has to stay quiet
 * because the wall is a backdrop; a berry is a few percent of the wall's area
 * and can afford to be an actual colour. That asymmetry is the whole reason
 * this axis exists.
 */
function wash(
  pick: (room: FlatScheme) => string,
  lift = 0,
  settle = 0.2,
): ToneRecipe {
  return ({ room, ground }) => {
    const base = pick(room);
    const shifted =
      lift > 0 ? mix(base, FLAT.cream, lift) : lift < 0 ? mix(base, FLAT.ink, -lift) : base;
    return mix(shifted, ground, settle);
  };
}

/**
 * Where the detail colour comes from, per tone.
 *
 * Two entries are not a wash of a slot and cannot be:
 *
 * - `auto` is the original rule kept exactly — gilt over the motif's own face,
 *   with the reversal into the paper on a gilt motif handled by the caller.
 *   Every paper written before this axis existed therefore draws the pixels it
 *   always drew.
 * - `ink` is the motif's OWN outline pulled back toward its face, which is the
 *   one tone that has to follow the nib rather than the room.
 *
 * Everything else names a slot of the live scheme and never a literal hex, so
 * a paper built against the athenaeum cannot look wrong in the reef: `ember` is
 * terracotta in one room and coral in another because the ROOM decided what
 * lives in the first cloth slot, not this table.
 */
const TONE_RECIPE: Record<WallpaperTone, ToneRecipe> = {
  auto: ({ face }) => mix(face, FLAT.gilt, 0.62),
  gilt: wash(fixed(FLAT.gilt)),
  // Not the wall's own colour: on a pale ground a chalk pip has to be lighter
  // than the paper to read as cut out of the motif rather than as a hole in it.
  chalk: wash(fixed(FLAT.cream)),
  ember: wash(EMBER),
  sea: wash(SEA),
  berry: wash(BERRY),
  bay: wash(BAY),
  ink: ({ face, ink }) => mix(ink, face, 0.2),

  /* warm */
  coral: wash(EMBER, 0.34, 0.18),
  rust: wash(EMBER_DARK),
  brick: wash(EMBER_DARK, -0.24, 0.16),
  clay: wash(cross(EMBER, (r) => r.timber, 0.5), 0.12, 0.2),

  /* gold */
  honey: wash(OCHRE),
  amber: wash(OCHRE_DARK),
  straw: wash(fixed(FLAT.giltPale), 0, 0.22),
  bronze: wash(fixed(FLAT.gilt), -0.36, 0.16),
  saffron: wash(cross(fixed(FLAT.gilt), EMBER, 0.4), 0, 0.2),
  brass: wash(cross(fixed(FLAT.gilt), (r) => r.timberDark, 0.36), -0.1, 0.2),

  /* green */
  moss: wash(MOSS),
  forest: wash(MOSS_DARK, -0.16, 0.16),
  olive: wash(BAY_DARK),
  fern: wash(BAY, 0.38, 0.18),
  verdigris: wash(cross(SEA, MOSS, 0.52), 0.14, 0.2),
  myrtle: wash(MOSS, -0.28, 0.18),

  /* blue */
  slate: wash(SEA_DARK),
  sky: wash(SEA, 0.44, 0.18),
  denim: wash(SEA, -0.22, 0.18),
  teal: wash(cross(SEA, MOSS, 0.3), -0.12, 0.2),
  indigo: wash(SEA_DARK, -0.34, 0.14),

  /* red-violet */
  plum: wash(BERRY_DARK),
  rose: wash(BERRY, 0.4, 0.18),
  mulberry: wash(BERRY_DARK, -0.28, 0.16),
  heather: wash(cross(BERRY, SEA, 0.44), 0.18, 0.2),
  blush: wash(BERRY, 0.62, 0.16),

  /* neutral */
  oak: wash((r) => r.timber),
  walnut: wash((r) => r.timberDark),
  cocoa: wash((r) => r.recess),
  sepia: wash(fixed(FLAT.inkSoft)),
  soot: wash(fixed(FLAT.ink), -0.22, 0.14),
  linen: wash(fixed(FLAT.creamDeep), -0.16, 0.1),
  // The wall's own colour lifted most of the way to the cream. A pearl has to
  // be LIGHTER than the paper it sits on or it is a hole rather than a bead.
  pearl: wash((r) => r.wall, 0.72, 0),
  stone: wash(cross((r) => r.wall, fixed(FLAT.ink), 0.3), 0, 0.18),
  smoke: wash(cross(fixed(FLAT.ink), (r) => r.wall, 0.58), 0, 0.2),

  /* blends */
  copper: wash(cross(EMBER_DARK, fixed(FLAT.gilt), 0.42), -0.1, 0.2),
  jade: wash(MOSS, 0.46, 0.18),
  wine: wash(cross(BERRY_DARK, EMBER, 0.32), -0.2, 0.16),
  harvest: wash(cross(OCHRE, EMBER, 0.46), 0, 0.2),
  mist: wash(SEA, 0.64, 0.14),
  peat: wash(cross((r) => r.recess, MOSS, 0.42), -0.12, 0.18),
  ivory: wash(cross(fixed(FLAT.giltPale), fixed(FLAT.cream), 0.56), 0, 0.16),
};

function accentFor(
  tone: WallpaperTone,
  room: FlatScheme,
  ground: string,
  face: string,
  ink: string,
): string {
  return TONE_RECIPE[tone]({ room, ground, face, ink });
}

/**
 * Derive a tile's palette from the live scheme.
 *
 * Exported because `world.ts` needs the ground colour for the placeholder tint
 * it shows before the first bake lands, and a preview card needs the whole set.
 */
/**
 * What the chosen nib does to the drawing.
 *
 * Four multipliers rather than four hand-drawn variants of every motif: the
 * shapes are the same in every room and at every sharpness, and the difference
 * between an engraved damask and a blotted one is entirely in the pen.
 */
interface EdgeFeel {
  /** Outline weight multiplier. */
  weight: number;
  /** Extra pull of the outline toward the ground. Negative = darker line. */
  fade: number;
  /** Corner-radius multiplier for every rounded corner in the module. */
  round: number;
  /** Wobble amplitude multiplier — how much the hand shakes. */
  wobble: number;
}

const EDGE_FEEL: Record<WallpaperEdge, EdgeFeel> = {
  etched: { weight: 0.62, fade: -0.14, round: 0.4, wobble: 0.25 },
  crisp: { weight: 1, fade: 0, round: 1, wobble: 1 },
  soft: { weight: 1.38, fade: 0.11, round: 1.6, wobble: 1.5 },
  blotted: { weight: 1.95, fade: 0.22, round: 2.3, wobble: 2.2 },
};

function edgeFeel(spec: WallpaperSpec): EdgeFeel {
  return EDGE_FEEL[spec.edge ?? 'crisp'];
}

/**
 * The corner-rounding multiplier, capped, for a shape that MEETS its
 * neighbours.
 *
 * A blotted nib rounds corners off by more than twice, which is the point of
 * it — but on a honeycomb or a harlequin the corner IS the joint, and rounding
 * it that far reopens the little holes at every junction that this pass was
 * about closing. Free-standing motifs get the full round.
 */
function joinRound(c: Paint): number {
  return Math.min(c.edge.round, 1.25);
}

export function wallpaperColours(spec: WallpaperSpec): WallpaperColours {
  const room = flatScheme();
  const ground = room.wall;
  const rule = INK_MIX[spec.ink];
  const feel = edgeFeel(spec);
  // Damped by how much of the wall the pattern actually covers. The same mix
  // that reads as a sprinkle of gilt stars reads as a gold wall when it is a
  // honeycomb, because the honeycomb's cells meet edge to edge and there is no
  // paper left showing. The ink slot names a hue; coverage decides how much of
  // it the room can take.
  const face = mix(ground, rule.toward(room), rule.t * COVERAGE[spec.pattern]);

  // The outline is pulled back toward the wall so the repeat reads as a wash
  // rather than as a second set of furniture. Pulled back FURTHER on a dark
  // face, where a full-strength ink would only turn the motif into a blob.
  // The nib rides on top of that: a blotted line is a pale fat one, an etched
  // line is a fine dark one. Clamped, because past about two thirds the outline
  // IS the wall and the motif loses its silhouette entirely.
  const inkPull = 0.34 + (1 - luma(face)) * 0.22 + feel.fade;
  const ink = mix(FLAT.ink, ground, Math.max(0.1, Math.min(0.68, inkPull)));

  // The relief face sits between the motif and the wall in value, so the motif
  // reads as lifted OFF the wall rather than as casting anything onto it.
  const relief = mix(face, FLAT.ink, 0.2);

  // A gilt motif is the one case where the old rule has to stay: an accent
  // drawn out of the same gold the motif is already made of is not an accent,
  // so `auto` reverses into the paper there. Every other tone is chosen and is
  // therefore honoured as chosen.
  const tone = spec.tone ?? 'auto';
  const accent =
    tone === 'auto' && spec.ink === 'gilt'
      ? mix(face, ground, 0.55)
      : accentFor(tone, room, ground, face, ink);

  // A darker face carrying a trace of the detail colour, so an inner shape is
  // part of the same drawing as the pip beside it rather than a grey patch.
  const bloom = mix(mix(face, FLAT.ink, 0.28), accent, 0.18);

  return { ground, face, ink, relief, accent, bloom };
}

/**
 * Everything a motif draws with: the colours, plus the nib.
 *
 * The feel rides on the colour struct rather than being threaded as a seventh
 * argument through every motif, every helper and every wrapped copy — `c` is
 * already carried everywhere it is needed, and the alternative was a parameter
 * that existed purely to be forwarded.
 */
interface Paint extends WallpaperColours {
  edge: EdgeFeel;
}

/** The monochrome palette the relief pass draws with: one solid face, no ink. */
function reliefColours(c: Paint): Paint {
  return {
    ground: c.ground,
    face: c.relief,
    ink: c.relief,
    relief: c.relief,
    accent: c.relief,
    bloom: c.relief,
    edge: c.edge,
  };
}

/* ============================== the torus ================================ */

type Pass = 'relief' | 'face';

/**
 * One thing drawn into the tile.
 *
 * `spanX`/`spanY` are the extent of the mark's INK on that axis, in tile space,
 * and `null` means "this mark is already periodic on that axis" — a stripe that
 * runs off both ends, a chevron whose zigzag wavelength divides the tile. A
 * span that pokes past an edge earns the mark a second (or fourth) draw one
 * tile over; a `null` earns it nothing, because there is nothing to close.
 */
interface Mark {
  /** Draw at the current origin. The emitter has already translated. */
  draw(ctx: FlatCtx, pass: Pass, c: Paint): void;
  spanX: readonly [number, number] | null;
  spanY: readonly [number, number] | null;
}

const NO_SHIFT: readonly number[] = [0];

/** The tile offsets a span needs so its ink closes across the seam. */
function shifts(span: readonly [number, number] | null, size: number): readonly number[] {
  if (span === null) return NO_SHIFT;
  const out = [0];
  if (span[1] > size) out.push(-size);
  if (span[0] < 0) out.push(size);
  return out;
}

/**
 * The detail colour, damped, for use as a HAIRLINE.
 *
 * The same hex that sits quietly as a berry shouts as a rule down a whole
 * wall: a line has no interior for the eye to average, so it reads at close to
 * full chroma however thin it is. The first striped specimens came back
 * looking like candy canes for exactly this reason. Areas get `accent`; long
 * thin things get this.
 */
function thread(c: WallpaperColours): string {
  return mix(c.accent, c.ground, 0.42);
}

/**
 * Draw every mark, plus every wrapped copy it needs, for one pass.
 *
 * Run twice per tile — all relief faces, then all motif faces — so that where
 * two motifs are close enough to touch, the neighbour's face covers the relief
 * rather than the relief cutting into the neighbour. Doing it per-mark instead
 * (relief, face, relief, face) is what makes a dense damask look chewed.
 */
function emit(ctx: FlatCtx, size: number, marks: readonly Mark[], pass: Pass, c: Paint): void {
  for (const mark of marks) {
    for (const ox of shifts(mark.spanX, size)) {
      for (const oy of shifts(mark.spanY, size)) {
        if (ox === 0 && oy === 0) {
          mark.draw(ctx, pass, c);
          continue;
        }
        ctx.save();
        ctx.translate(ox, oy);
        mark.draw(ctx, pass, c);
        ctx.restore();
      }
    }
  }
}

/* ============================ drawing helpers ============================ */

/**
 * Fill the current path, then outline it. The one move every motif makes.
 *
 * `fillWith` exists so an inner shape can take the bloom or the accent without
 * every motif restating the four lines of stroke setup around it.
 */
function ink(ctx: FlatCtx, c: Paint, width: number, fill: boolean | string = true): void {
  if (fill !== false) {
    ctx.fillStyle = fill === true ? c.face : fill;
    ctx.fill();
  }
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * Outline weight for a motif of radius `r`, under the chosen nib.
 *
 * The floor is what matters: a wall motif is often 20px across and a purely
 * proportional rule draws it in half a pixel, which reads as a watercolour of
 * the pattern rather than as the pattern. The ceiling matters at the other end
 * — a blotted grand damask would otherwise be more outline than fill.
 */
function motifInk(r: number, c: Paint): number {
  return Math.max(0.8, Math.min(6.5, r * 0.13 * c.edge.weight));
}

/** A deterministic value in [-1, 1] from an integer — the wobble of `flat.ts`. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** A closed blob: a circle whose radius breathes by a few percent per lobe. */
function blob(ctx: FlatCtx, r: number, seed: number, lobes = 7, wobble = 0.07): void {
  ctx.beginPath();
  const steps = lobes * 6;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r * (1 + jitter(seed + Math.round((i / steps) * lobes) * 7) * wobble);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** A small filled disc with an outline — a berry, a pip, an eye. */
function pip(ctx: FlatCtx, x: number, y: number, r: number, fill: string, c: Paint, w: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.6, r), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (w > 0) {
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = w;
    ctx.stroke();
  }
}

/** An axis-aligned rounded rectangle from its top-left corner. */
function roundedRect(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** A leaf: two arcs meeting at a point at each end, tilted by `angle`. */
function leaf(ctx: FlatCtx, len: number, wide: number, angle: number): void {
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wide, len * 0.42, 0, len);
  ctx.quadraticCurveTo(-wide, len * 0.42, 0, 0);
  ctx.closePath();
  ctx.restore();
}

/** A five-pointed star, point up. */
function starPath(ctx: FlatCtx, r: number, points = 5, inner = 0.42): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * inner;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** A rounded polygon through the given points. */
function roundedPoly(ctx: FlatCtx, pts: readonly (readonly [number, number])[], radius: number): void {
  const n = pts.length;
  if (n < 3) return;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const inLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
    const outLen = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
    const ri = Math.min(radius, inLen / 2, outLen / 2);
    const ax = cur[0] + ((prev[0] - cur[0]) / inLen) * ri;
    const ay = cur[1] + ((prev[1] - cur[1]) / inLen) * ri;
    const bx = cur[0] + ((next[0] - cur[0]) / outLen) * ri;
    const by = cur[1] + ((next[1] - cur[1]) / outLen) * ri;
    if (i === 0) ctx.moveTo(ax, ay);
    else ctx.lineTo(ax, ay);
    ctx.quadraticCurveTo(cur[0], cur[1], bx, by);
  }
  ctx.closePath();
}

/**
 * The union outline of `n` circular lobes set at distance `d` from the centre
 * — a trefoil, a quatrefoil, a cinquefoil, a rosette.
 *
 * Drawn as ONE path made of the arcs that survive on the outside, rather than
 * as n overlapping discs, because a foil has to be filled and outlined like
 * every other shape in this language and n discs would print n outlines through
 * the middle of it. The arc half-angle `phi` is where two adjacent lobes cross,
 * solved rather than eyeballed: adjacent centres are `2·d·sin(π/n)` apart, so
 * the crossing sits `√(rr² − d²sin²(π/n))` out along their bisector.
 *
 * Requires `rr > d·sin(π/n)` — lobes that do not reach each other have no
 * union outline. Every caller here is comfortably inside that.
 */
function foilPath(ctx: FlatCtx, d: number, rr: number, n: number, rot = 0): void {
  const half = Math.PI / n;
  const k = d * Math.sin(half);
  const h = Math.sqrt(Math.max(0.0001, rr * rr - k * k));
  const q = d * Math.cos(half) + h;
  const phi = Math.atan2(q * Math.sin(half), q * Math.cos(half) - d);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const th = rot + (i * Math.PI * 2) / n;
    ctx.arc(Math.cos(th) * d, Math.sin(th) * d, rr, th - phi, th + phi);
  }
  ctx.closePath();
}

/**
 * A scroll: an open spiral stroke that starts at the origin and curls in.
 *
 * `dir` picks the hand, so a pair of them mirrors. Used for the volutes of the
 * arabesque and the crozier at the tip of a fern frond — the one shape in the
 * book that a bezier cannot fake, because the whole point of it is that the
 * radius keeps shrinking at a constant rate.
 */
function volute(ctx: FlatCtx, r: number, turns: number, dir: 1 | -1, a0 = 0): void {
  const steps = 44;
  const at = (t: number): [number, number] => {
    const a = a0 + dir * t * turns * Math.PI * 2;
    const rr = r * (1 - t * 0.84);
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  };
  const [ox, oy] = at(0);
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const [x, y] = at(i / steps);
    if (i === 0) ctx.moveTo(0, 0);
    else ctx.lineTo(x - ox, y - oy);
  }
}

/**
 * A stroked ribbon: the same path laid down fat in ink and then thin in the
 * face colour, so a line reads as a painted batten with an edge rather than as
 * a wire.
 *
 * `trace` is called twice rather than the path being reused, because a path
 * built with `beginPath` cannot be re-stroked after the style changes on every
 * context implementation this draws on.
 */
function ribbon(ctx: FlatCtx, c: Paint, weight: number, trace: () => void, core?: string): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  trace();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = weight;
  ctx.stroke();
  trace();
  ctx.strokeStyle = core ?? c.face;
  ctx.lineWidth = Math.max(0.6, weight * 0.46);
  ctx.stroke();
}

/**
 * A run of dashes along a straight line, laid by PARAMETER rather than by
 * `setLineDash`.
 *
 * The dash pattern has to close across a cell boundary — the overcheck of an
 * argyle runs corner to corner and continues into the next cell — and a dash
 * offset measured in pixels from wherever the path happened to start does not.
 * Spans given as fractions of the segment are the same in every cell at every
 * scale, so the gap at the joint is the gap everywhere else.
 */
const DASH_SPANS: readonly (readonly [number, number])[] = [
  [0.05, 0.2],
  [0.3, 0.45],
  [0.55, 0.7],
  [0.8, 0.95],
];

function dashedLine(
  ctx: FlatCtx,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  colour: string,
  width: number,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [t0, t1] of DASH_SPANS) {
    ctx.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0);
    ctx.lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1);
  }
  ctx.stroke();
}

/* ========================== periodic running marks ======================== */

/**
 * A displacement profile, carrying the largest displacement it can produce.
 *
 * The amplitude rides along because the marks that use a profile have to
 * declare how far their ink reaches, and a span that forgets the wave is a span
 * that fails to wrap a stripe which happened to bow past the edge. None of the
 * current patterns bow that far; the point is that the next one to be tuned
 * cannot break the wrap silently.
 */
interface Profile {
  (t: number): number;
  amp: number;
}

/**
 * A profile that is exactly periodic over the tile.
 *
 * `k` MUST be an integer: this is the whole reason a running stripe can cross
 * the tile edge at all. At t = 0 and t = size the sine has completed `k` whole
 * turns, so the two edges of the tile are the same number rather than two
 * numbers that happen to be close.
 */
function periodic(size: number, amp: number, k: number, phase: number): Profile {
  const w = (Math.PI * 2 * Math.max(1, Math.round(k))) / (size || 1);
  const f = (t: number): number => Math.sin(t * w + phase) * amp;
  f.amp = Math.abs(amp);
  return f;
}

/** Samples along the running axis. 96 is smooth at any tile we bake. */
const RUN_SAMPLES = 96;
/** How far a running mark overshoots the tile so its caps are never in shot. */
const RUN_OVERSHOOT = 6;

/**
 * A band running top-to-bottom (`axis = 'y'`) or left-to-right (`axis = 'x'`),
 * centred on `centre`, of half-width `half`, its centre-line displaced by a
 * periodic profile.
 *
 * The path closes OUTSIDE the tile at both ends, so the flat cap never lands
 * on the seam; only the two long edges are ever stroked.
 */
function runningBand(
  size: number,
  axis: 'x' | 'y',
  centre: number,
  half: number,
  profile: Profile,
  width: number,
  relief = 0,
  /** Which colour the band takes. Defaults to the motif's own face. */
  fill: (c: Paint) => string = (c) => c.face,
): Mark {
  const t0 = -RUN_OVERSHOOT;
  const t1 = size + RUN_OVERSHOOT;
  const at = (t: number, side: -1 | 1): [number, number] => {
    const v = centre + profile(t) + side * half;
    return axis === 'y' ? [v, t] : [t, v];
  };

  const trace = (ctx: FlatCtx): void => {
    ctx.beginPath();
    for (let i = 0; i <= RUN_SAMPLES; i++) {
      const [x, y] = at(t0 + ((t1 - t0) * i) / RUN_SAMPLES, -1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = RUN_SAMPLES; i >= 0; i--) {
      const [x, y] = at(t0 + ((t1 - t0) * i) / RUN_SAMPLES, 1);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  const edge = (ctx: FlatCtx, side: -1 | 1): void => {
    ctx.beginPath();
    for (let i = 0; i <= RUN_SAMPLES; i++) {
      const [x, y] = at(t0 + ((t1 - t0) * i) / RUN_SAMPLES, side);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  const reach = half + width + relief + profile.amp;
  const span: [number, number] = [centre - reach, centre + reach];
  return {
    spanX: axis === 'y' ? span : null,
    spanY: axis === 'y' ? null : span,
    draw(ctx, pass, c) {
      if (pass === 'relief' && relief <= 0) return;
      ctx.save();
      // The second face is offset ACROSS the band only. Offsetting along the
      // run would slide the path's far-off caps toward the tile and put one on
      // screen; across, the band is infinite and there is nothing to expose.
      if (pass === 'relief') ctx.translate(axis === 'y' ? relief : 0, axis === 'y' ? 0 : relief);
      trace(ctx);
      ctx.fillStyle = pass === 'relief' ? c.relief : fill(c);
      ctx.fill();
      if (pass === 'face' && width > 0) {
        ctx.strokeStyle = c.ink;
        ctx.lineWidth = width;
        ctx.lineCap = 'butt';
        for (const side of [-1, 1] as const) {
          edge(ctx, side);
          ctx.stroke();
        }
        ctx.lineCap = 'round';
      }
      ctx.restore();
    },
  };
}

/** A single running line — a pinstripe, a chevron, a rule. No fill. */
function runningLine(
  size: number,
  axis: 'x' | 'y',
  centre: number,
  profile: Profile,
  width: number,
  colour: (c: Paint) => string,
): Mark {
  const t0 = -RUN_OVERSHOOT;
  const t1 = size + RUN_OVERSHOOT;
  const reach = width + profile.amp;
  const span: [number, number] = [centre - reach, centre + reach];
  return {
    spanX: axis === 'y' ? span : null,
    spanY: axis === 'y' ? null : span,
    draw(ctx, pass, c) {
      // A hairline has no silhouette worth a second face; the relief pass
      // widens it a hair instead of offsetting it, which would only read as a
      // doubled line.
      if (pass === 'relief') return;
      ctx.beginPath();
      for (let i = 0; i <= RUN_SAMPLES; i++) {
        const t = t0 + ((t1 - t0) * i) / RUN_SAMPLES;
        const v = centre + profile(t);
        const x = axis === 'y' ? v : t;
        const y = axis === 'y' ? t : v;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = colour(c);
      ctx.lineWidth = width;
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.lineCap = 'round';
    },
  };
}

/**
 * A zigzag running left-to-right, `k` full teeth across the tile.
 *
 * Integer `k` again: the triangle wave's value at x = 0 and x = size is the
 * same, so the chevron's point lands identically on both edges.
 */
interface ZigzagStyle {
  /** Which colour the ribbon takes. Defaults to the motif's own face. */
  fill?: (c: Paint) => string;
  /** Draw the braid hairline down the spine. On by default. */
  braid?: boolean;
}

function zigzagBand(
  size: number,
  centre: number,
  amp: number,
  k: number,
  half: number,
  phase: number,
  width: number,
  relief = 0,
  style: ZigzagStyle = {},
): Mark {
  const fill = style.fill ?? ((c: Paint) => c.face);
  const braid = style.braid ?? true;
  const teeth = Math.max(1, Math.round(k));
  const period = size / teeth;
  // The offset of a band edge from the centre line, measured VERTICALLY. A
  // constant vertical offset of `half` would give a ribbon that is thinner
  // than `2·half` where it slopes; dividing by cos θ makes the perpendicular
  // width constant, which is what stops a chevron looking pinched at the
  // diagonals and fat at the turns. The mitre at each peak then falls out of
  // the geometry rather than being faked with a round line join.
  const slope = (4 * amp) / period;
  const lift = half * Math.hypot(1, slope);
  const reach = amp + lift + width + relief;
  const span: [number, number] = [centre - reach, centre + reach];

  /** The zigzag centre line, displaced by `dy`, as an open polyline. */
  const wave = (ctx: FlatCtx, dy: number, back: boolean): void => {
    // Two extra teeth off each end so the mitre sitting on the seam is a real
    // mitre and not a line cap.
    const from = back ? teeth * 2 + 2 : -2;
    const to = back ? -2 : teeth * 2 + 2;
    const step = back ? -1 : 1;
    for (let i = from; back ? i >= to : i <= to; i += step) {
      const x = (i / 2) * period + phase;
      const y = centre + (i % 2 === 0 ? -amp : amp) + dy;
      if (i === from) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  return {
    spanX: null,
    spanY: span,
    draw(ctx, pass, c) {
      if (pass === 'relief' && relief <= 0) return;
      ctx.save();
      if (pass === 'relief') ctx.translate(0, relief);
      ctx.beginPath();
      ctx.moveTo(-2 * (period / 2) + phase, centre - amp - lift);
      wave(ctx, -lift, false);
      wave(ctx, lift, true);
      ctx.closePath();
      ctx.fillStyle = pass === 'relief' ? c.relief : fill(c);
      ctx.fill();
      if (pass === 'face' && width > 0) {
        // Only the two long edges are stroked, and both run off the tile, so
        // no cap ever lands on the seam.
        ctx.strokeStyle = c.ink;
        ctx.lineWidth = width;
        ctx.lineJoin = 'miter';
        ctx.miterLimit = 4;
        ctx.lineCap = 'butt';
        for (const dy of [-lift, lift] as const) {
          ctx.beginPath();
          ctx.moveTo(-2 * (period / 2) + phase, centre - amp + dy);
          wave(ctx, dy, false);
          ctx.stroke();
        }
        // A hairline down the spine in the detail colour — the braid that
        // turns a plain zigzag into a woven chevron tape.
        if (braid) {
          ctx.beginPath();
          ctx.moveTo(-2 * (period / 2) + phase, centre - amp);
          wave(ctx, 0, false);
          ctx.strokeStyle = c.accent;
          ctx.lineWidth = Math.max(0.8, half * 0.22);
          ctx.stroke();
        }
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
      }
      ctx.restore();
    },
  };
}

/* ============================== the motifs =============================== */

/**
 * Where a motif sits on the lattice.
 *
 * A motif that flips, mirrors or turns has to do it from the CELL, not from a
 * random seed: a herringbone whose bars lean at random is a heap of sticks, and
 * a laurel that mirrors at random reads as a mistake rather than as a repeat.
 */
interface CellAt {
  col: number;
  row: number;
  /** True for the interstitial point of a `diamond` lattice. */
  alt: boolean;
  /**
   * The pitch actually fitted, in tile space.
   *
   * A motif that has to MEET its neighbours — a harlequin lozenge, an arcade
   * pier, a honeycomb wall — cannot work from a single radius, because the
   * cell is rarely square and the joint has to land on the cell boundary to
   * the pixel. Those motifs measure from here; the free-standing ones ignore
   * it and stay inside `r`.
   */
  w: number;
  h: number;
}

/**
 * A motif draws itself around the origin, out to roughly `r`, in `c`.
 *
 * `seed` is derived from the LATTICE INDEX and never from the position, which
 * is what lets a wrapped copy come out identical: the copy is the same seed
 * under a translate.
 */
type MotifFn = (ctx: FlatCtx, r: number, seed: number, c: Paint, at: CellAt) => void;

/**
 * A dot — big and plain on the lattice point, small and coloured between.
 *
 * The interstitial population of a `diamond` lattice used to draw the same dot
 * as the main one, which is a grid of dots at 45° and reads as one. Two sizes
 * and two colours make it a scatter.
 */
const dot: MotifFn = (ctx, r, seed, c, at) => {
  if (at.alt) {
    blob(ctx, r * 0.26, seed, 6, 0.08 * c.edge.wobble);
    ink(ctx, c, motifInk(r * 0.3, c) * 0.8, c.accent);
    return;
  }
  blob(ctx, r * 0.5, seed, 6, 0.06 * c.edge.wobble);
  ink(ctx, c, motifInk(r * 0.5, c));
  // A smaller ring inside, in the detail colour: a plain disc is the one motif
  // in the book with nothing at all to look at.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = motifInk(r * 0.5, c) * 0.8;
  ctx.stroke();
};

/** Five-point star on the lattice, a small four-point sparkle between. */
const star: MotifFn = (ctx, r, seed, c, at) => {
  const w = motifInk(r * 0.5, c);
  if (at.alt) {
    ctx.save();
    ctx.rotate(jitter(seed) * 0.4);
    starPath(ctx, r * 0.22, 4, 0.3);
    ink(ctx, c, w * 0.7, c.accent);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.rotate(jitter(seed) * 0.16 * c.edge.wobble);
  starPath(ctx, r * 0.52);
  ink(ctx, c, w);
  ctx.restore();
  pip(ctx, 0, 0, r * 0.12, c.accent, c, w * 0.6);
};

/** A crescent moon with a small star tucked into its horn. */
const moonstar: MotifFn = (ctx, r, seed, c) => {
  const R = r * 0.72;
  const w = motifInk(R, c);
  // Crescent as a lune: outer circle minus a circle pushed off to the right.
  ctx.beginPath();
  ctx.arc(0, 0, R, Math.PI * 0.42, Math.PI * 1.58, false);
  ctx.arc(R * 0.52, 0, R * 0.92, Math.PI * 1.42, Math.PI * 0.58, true);
  ctx.closePath();
  ink(ctx, c, w);
  ctx.save();
  ctx.translate(R * 0.86, -R * 0.72);
  ctx.rotate(jitter(seed + 3) * 0.3);
  starPath(ctx, R * 0.34);
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = Math.max(0.7, w * 0.6);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
};

/**
 * A stem with two pairs of leaves and a bud. The workhorse floral.
 *
 * The leaves have to be BROAD to survive being drawn 40px tall on a wall that
 * is behind everything else — the first version had them at a fifth of the
 * motif and the whole repeat read as a field of lollipops.
 */
const sprig: MotifFn = (ctx, r, seed, c) => {
  const h = r * 0.96;
  const w = motifInk(r * 0.6, c);
  ctx.save();
  ctx.rotate(jitter(seed) * 0.2 * c.edge.wobble);
  // Stem.
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  ctx.quadraticCurveTo(r * 0.1, 0, 0, -h * 0.42);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();
  // Four leaves in two pairs, the lower pair larger — a plant, not a symbol.
  for (const [t, side, len] of [
    [0.44, 1, 0.72],
    [0.24, -1, 0.62],
    [0.02, 1, 0.5],
    [-0.16, -1, 0.42],
  ] as const) {
    ctx.save();
    ctx.translate(0, h * t);
    leaf(ctx, r * len * side, r * len * 0.42 * side, side > 0 ? -1.15 : 1.15);
    ink(ctx, c, w * 0.85);
    ctx.restore();
  }
  // The head. A single blob here was the whole reason the first field read as
  // lollipops: a dot on a stick is a lollipop no matter how small it is, and
  // shrinking it only made it a smaller lollipop. Five short petals around a
  // pip is a FLOWER at any size, because the silhouette is not a circle.
  ctx.save();
  ctx.translate(0, -h * 0.46);
  const petal = r * 0.2;
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i / 5) * Math.PI * 2 + jitter(seed + i) * 0.1 * c.edge.wobble);
    leaf(ctx, petal * 1.5, petal * 0.62, 0);
    ink(ctx, c, w * 0.7, c.accent);
    ctx.restore();
  }
  pip(ctx, 0, 0, r * 0.1, c.bloom, c, w * 0.65);
  ctx.restore();
  // Two buds lower down the stem, so the plant has a season in it.
  for (const [t, side] of [
    [0.3, -1],
    [0.1, 1],
  ] as const) {
    pip(ctx, side * r * 0.13, -h * t, r * 0.075, c.accent, c, w * 0.55);
  }
  ctx.restore();
};

/**
 * A laurel branch: an arc with broad leaves paired along it, a berry at the
 * tip.
 *
 * Mirrored by ROW rather than by seed. A laurel that flips at random reads as a
 * printing fault; flipped a row at a time it reads as a repeat with a rhythm,
 * which is what the real papers do.
 */
const laurel: MotifFn = (ctx, r, seed, c, at) => {
  const w = motifInk(r * 0.7, c);
  const flip = at.row % 2 === 0 ? 1 : -1;
  // The branch as a quadratic from tail to tip, so the leaves can be hung off
  // the curve itself rather than off an approximation of it.
  const p0 = [-r * 0.78, r * 0.52] as const;
  const p1 = [r * 0.06, r * 0.3] as const;
  const p2 = [r * 0.72, -r * 0.6] as const;
  const on = (t: number): [number, number] => [
    (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
  ];

  ctx.save();
  ctx.rotate(jitter(seed + 1) * 0.16 * c.edge.wobble);
  ctx.scale(flip, 1);
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();

  for (let i = 0; i < 4; i++) {
    const t = 0.1 + i * 0.24;
    const [bx, by] = on(t);
    const [nx, ny] = on(t + 0.01);
    const tilt = Math.atan2(ny - by, nx - bx);
    for (const side of [1, -1] as const) {
      ctx.save();
      ctx.translate(bx, by);
      // Leaves splay off the branch at a fixed angle to the tangent, so the
      // spray narrows toward the tip the way a real one does.
      ctx.rotate(tilt + side * 1.05);
      // `leaf` grows along +y, so -90° aims it down the rotation just applied.
      leaf(ctx, r * 0.52, r * 0.19, -Math.PI / 2);
      ink(ctx, c, w * 0.75);
      ctx.restore();
    }
  }
  // A berry at the tip and two smaller ones tucked behind it — one berry on a
  // branch reads as a full stop, three read as fruit.
  pip(ctx, p2[0], p2[1], r * 0.13, c.accent, c, w * 0.7);
  const [b1x, b1y] = on(0.86);
  pip(ctx, b1x - r * 0.05, b1y + r * 0.13, r * 0.085, c.accent, c, w * 0.6);
  pip(ctx, b1x + r * 0.12, b1y + r * 0.16, r * 0.07, c.bloom, c, w * 0.55);
  ctx.restore();
};

/**
 * The damask: an ogee frame with a fan of leaves inside and a crown on top.
 *
 * Mirror-symmetric about its axis because that is what makes a damask read as
 * a damask rather than as a plant — the whole style is a heraldic device
 * repeated, and asymmetry breaks it.
 */
const damask: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8, c);
  const H = r * 0.98;
  const W = r * 0.62;

  // The linking tendrils, drawn FIRST so the frame covers where they meet it.
  // A damask field is a continuous ogee net, not a scatter of badges: the
  // first version drew the device alone and the wall read as a row of fish
  // floating on parchment. These reach a third of the way to the neighbour
  // above and below, which is enough for the eye to close the lattice.
  for (const dir of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(0, dir * H);
    ctx.quadraticCurveTo(W * 0.1, dir * H * 1.12, 0, dir * H * 1.26);
    ctx.quadraticCurveTo(-W * 0.1, dir * H * 1.12, 0, dir * H);
    ctx.closePath();
    ink(ctx, c, w * 0.7);
  }

  // The ogee itself: a point at each end, shoulders that bow OUT high up and a
  // waist that draws IN low down. The old silhouette was a plain pointed oval,
  // and a pointed oval with two fins on it is a fish — the waist is the whole
  // difference between the two drawings.
  //
  // Both ends run CONCAVE out of the point before they flare — that is what an
  // ogee is, and a convex curve out of the point is what made the first fix a
  // lightbulb instead. The first control sits close to the axis (the curve
  // leaves the tip almost vertically), the second swings wide (the flare), and
  // the widest place is a little above centre.
  ctx.beginPath();
  ctx.moveTo(0, -H);
  ctx.bezierCurveTo(W * 0.12, -H * 0.84, W * 0.66, -H * 0.62, W * 0.94, -H * 0.08);
  ctx.bezierCurveTo(W * 1.0, H * 0.16, W * 0.5, H * 0.3, W * 0.3, H * 0.58);
  ctx.bezierCurveTo(W * 0.2, H * 0.8, W * 0.09, H * 0.88, 0, H);
  ctx.bezierCurveTo(-W * 0.09, H * 0.88, -W * 0.2, H * 0.8, -W * 0.3, H * 0.58);
  ctx.bezierCurveTo(-W * 0.5, H * 0.3, -W * 1.0, H * 0.16, -W * 0.94, -H * 0.08);
  ctx.bezierCurveTo(-W * 0.66, -H * 0.62, -W * 0.12, -H * 0.84, 0, -H);
  ctx.closePath();
  ink(ctx, c, w);

  // The palmette inside: five leaves fanning up out of the waist, longest in
  // the middle. Solid bloom rather than ink at half alpha — the old inner fan
  // was three grey smudges, which is what a flat fill turns into the moment it
  // is drawn transparent.
  for (const [tilt, len, wide] of [
    [0, 0.74, 0.3],
    [-0.52, 0.58, 0.26],
    [0.52, 0.58, 0.26],
    [-1.0, 0.4, 0.2],
    [1.0, 0.4, 0.2],
  ] as const) {
    ctx.save();
    ctx.translate(0, H * 0.46);
    leaf(ctx, -H * len, W * wide, tilt);
    ink(ctx, c, w * 0.6, c.bloom);
    ctx.restore();
  }

  // A trefoil under the top point, in the detail colour: the crown.
  for (const [dx, dy, rr] of [
    [0, -0.62, 0.085],
    [-0.26, -0.46, 0.06],
    [0.26, -0.46, 0.06],
  ] as const) {
    pip(ctx, W * dx, H * dy, r * rr, c.accent, c, w * 0.55);
  }

  // Two scrolls curling off the shoulders. Without them an ogee is an egg —
  // and they are what makes the neighbouring devices read as one net.
  for (const side of [1, -1] as const) {
    ctx.save();
    ctx.translate(side * W * 0.9, -H * 0.16);
    ctx.rotate(side * 0.55 + jitter(seed) * 0.06 * c.edge.wobble);
    leaf(ctx, r * 0.4, r * 0.14, side > 0 ? -1.9 : 1.9);
    ink(ctx, c, w * 0.7);
    ctx.restore();
    // A curl of the same scroll, tucked under, so it turns rather than points.
    ctx.save();
    ctx.translate(side * W * 0.72, H * 0.06);
    ctx.rotate(side * 1.5);
    leaf(ctx, r * 0.22, r * 0.09, side > 0 ? -1.9 : 1.9);
    ink(ctx, c, w * 0.6, c.bloom);
    ctx.restore();
  }
};

/** A perched bird on a twig — the chinoiserie note. Faces by column. */
const bird: MotifFn = (ctx, r, seed, c, at) => {
  const w = motifInk(r * 0.8, c);
  const flip = (at.col + at.row) % 2 === 0 ? 1 : -1;
  ctx.save();
  ctx.scale(flip, 1);
  ctx.rotate(jitter(seed) * 0.08 * c.edge.wobble);

  // Twig with two leaves, under the bird's feet.
  ctx.beginPath();
  ctx.moveTo(-r * 0.86, r * 0.5);
  ctx.quadraticCurveTo(0, r * 0.72, r * 0.8, r * 0.42);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.9;
  ctx.lineCap = 'round';
  ctx.stroke();
  for (const [bx, tilt] of [
    [-r * 0.5, 1.1],
    [r * 0.46, -1.1],
  ] as const) {
    ctx.save();
    ctx.translate(bx, r * 0.6);
    leaf(ctx, r * 0.3, r * 0.1, tilt);
    ink(ctx, c, w * 0.7);
    ctx.restore();
  }
  pip(ctx, -r * 0.74, r * 0.58, r * 0.08, c.accent, c, w * 0.6);

  // Body: a teardrop leaning forward, tail sweeping back and up.
  ctx.beginPath();
  ctx.moveTo(r * 0.42, -r * 0.36);
  ctx.bezierCurveTo(r * 0.66, -r * 0.1, r * 0.5, r * 0.34, r * 0.06, r * 0.42);
  ctx.bezierCurveTo(-r * 0.3, r * 0.48, -r * 0.52, r * 0.3, -r * 0.86, r * 0.06);
  ctx.bezierCurveTo(-r * 0.5, r * 0.06, -r * 0.28, -r * 0.12, -r * 0.06, -r * 0.34);
  ctx.bezierCurveTo(r * 0.08, -r * 0.5, r * 0.28, -r * 0.52, r * 0.42, -r * 0.36);
  ctx.closePath();
  ink(ctx, c, w);

  // Wing: two folded leaves on the flank, the longer one behind. A solid
  // second face, not the ink at 42% — the transparent version came out the
  // same grey on every paper in the book, so the bird had no plumage.
  for (const [len, wide, tilt, dx, fill] of [
    [0.58, 0.22, -2.42, -0.02, c.bloom],
    [0.44, 0.16, -2.62, 0.12, c.accent],
  ] as const) {
    ctx.save();
    ctx.translate(r * dx, r * 0.02);
    leaf(ctx, r * len, r * wide, tilt);
    ink(ctx, c, w * 0.65, fill);
    ctx.restore();
  }

  // Head, beak, eye.
  ctx.beginPath();
  ctx.arc(r * 0.44, -r * 0.44, r * 0.2, 0, Math.PI * 2);
  ink(ctx, c, w * 0.85);
  ctx.beginPath();
  ctx.moveTo(r * 0.6, -r * 0.48);
  ctx.lineTo(r * 0.92, -r * 0.38);
  ctx.lineTo(r * 0.6, -r * 0.32);
  ctx.closePath();
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r * 0.46, -r * 0.48, Math.max(0.8, r * 0.05), 0, Math.PI * 2);
  ctx.fillStyle = c.ink;
  ctx.fill();
  ctx.restore();
};

/**
 * A toile vignette: a cottage, a tree and a ground line inside an oval frame.
 *
 * Toile is a SCENE repeated, and the joke of it only lands if the scene is
 * legible at a glance — so this is drawn large and used only at the bigger
 * scales.
 */
const toile: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.9, c);
  const RX = r * 0.94;
  const RY = r * 0.8;
  ctx.save();
  ctx.rotate(jitter(seed) * 0.03 * c.edge.wobble);

  // The cartouche is a WINDOW, not a plate. Filling it with the motif's own
  // face is what buried the first version: the cottage, the tree and both
  // birds were drawn in ink over a solid disc the same value as they were, and
  // at shelf size the whole thing read as a grey egg. The scene sits on clean
  // paper and the frame is a ring around it.
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ink(ctx, c, w * 1.1, c.ground);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, RX * 0.99, RY * 0.99, 0, 0, Math.PI * 2);
  ctx.clip();

  const horizon = r * 0.34;

  // Two hills behind, in the second face, so the scene has a distance.
  for (const [hx, hy, hr] of [
    [-r * 0.42, horizon + r * 0.16, r * 0.44],
    [r * 0.3, horizon + r * 0.1, r * 0.34],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(hx, hy, hr, hr * 0.62, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    ink(ctx, c, w * 0.7, c.bloom);
  }

  // Ground line.
  ctx.beginPath();
  ctx.moveTo(-r, horizon);
  ctx.quadraticCurveTo(0, horizon - r * 0.08, r, horizon);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.9;
  ctx.stroke();

  // Cottage: gable wall, pitched roof, door, window, chimney and smoke.
  const cx = -r * 0.34;
  const cw = r * 0.5;
  const ch = r * 0.34;
  ctx.beginPath();
  ctx.rect(cx - cw / 2, horizon - ch, cw, ch);
  ink(ctx, c, w * 0.8, c.ground);
  // Chimney first, so the roof laps over its foot.
  ctx.beginPath();
  ctx.rect(cx + cw * 0.24, horizon - ch - r * 0.34, cw * 0.16, r * 0.24);
  ink(ctx, c, w * 0.7, c.bloom);
  ctx.beginPath();
  ctx.moveTo(cx - cw * 0.66, horizon - ch);
  ctx.lineTo(cx, horizon - ch - r * 0.28);
  ctx.lineTo(cx + cw * 0.66, horizon - ch);
  ctx.closePath();
  ink(ctx, c, w * 0.8, c.accent);
  ctx.beginPath();
  ctx.rect(cx - cw * 0.14, horizon - ch * 0.6, cw * 0.28, ch * 0.6);
  ink(ctx, c, w * 0.6, c.bloom);
  ctx.beginPath();
  ctx.rect(cx + cw * 0.22, horizon - ch * 0.78, cw * 0.2, ch * 0.3);
  ink(ctx, c, w * 0.55, c.ground);
  // Three puffs of smoke leaning with the wind.
  for (let i = 0; i < 3; i++) {
    pip(
      ctx,
      cx + cw * 0.32 + r * (0.05 + i * 0.09),
      horizon - ch - r * (0.4 + i * 0.11),
      r * (0.05 + i * 0.017),
      c.ground,
      c,
      w * 0.5,
    );
  }

  // Tree: a lobed crown on a short trunk, with a trunk line inside the crown.
  ctx.save();
  ctx.translate(r * 0.44, horizon - r * 0.3);
  ctx.beginPath();
  ctx.moveTo(0, r * 0.3);
  ctx.lineTo(0, -r * 0.04);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.9;
  ctx.lineCap = 'round';
  ctx.stroke();
  blob(ctx, r * 0.24, seed + 9, 9, 0.18 * c.edge.wobble);
  ink(ctx, c, w * 0.8, c.bloom);
  ctx.restore();

  // A paling fence along the ground, which is what makes it a place.
  for (let i = -3; i <= 3; i++) {
    const fx = cx + i * r * 0.11;
    ctx.beginPath();
    ctx.moveTo(fx, horizon + r * 0.02);
    ctx.lineTo(fx, horizon + r * 0.14);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = w * 0.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.36, horizon + r * 0.07);
  ctx.lineTo(cx + r * 0.36, horizon + r * 0.07);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.5;
  ctx.stroke();

  // Two birds, because an empty sky reads as an unfinished drawing.
  for (const [bx, by, s] of [
    [-r * 0.36, -r * 0.46, 1],
    [r * 0.08, -r * 0.58, 0.7],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.11 * s, by);
    ctx.quadraticCurveTo(bx - r * 0.05 * s, by - r * 0.07 * s, bx, by);
    ctx.quadraticCurveTo(bx + r * 0.05 * s, by - r * 0.07 * s, bx + r * 0.11 * s, by);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = w * 0.6;
    ctx.stroke();
  }
  ctx.restore();

  // The frame's own moulding: a second ring inside the first, and four pips on
  // the axes — a cartouche rather than an oval hole.
  ctx.beginPath();
  ctx.ellipse(0, 0, RX * 0.9, RY * 0.88, 0, 0, Math.PI * 2);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.5;
  ctx.stroke();
  for (const [px, py] of [
    [0, -RY],
    [0, RY],
    [-RX, 0],
    [RX, 0],
  ] as const) {
    pip(ctx, px, py, r * 0.07, c.accent, c, w * 0.6);
  }
  ctx.restore();
};

/**
 * One bay of an ARCADE: a pier, the arch it carries, and the ledge it stands
 * on.
 *
 * The first version drew a free-standing arch centred in its cell, and the
 * reader's headline note — "the area that connects different parts looks
 * unnatural" — is exactly what that produces: a colonnade is a row of arches
 * that SHARE their piers, and drawing each one whole leaves a strip of bare
 * wall between every pair. So the pier is drawn on the cell's left EDGE (the
 * neighbour draws the one on the right, and it is the same pier), the ledge
 * runs the full cell width, and every joint lands on a cell boundary the
 * lattice has already made exact.
 *
 * Everything is measured off the fitted cell rather than off `r`, because a
 * joint that is a percent out is a joint the eye finds immediately.
 */
const arcade: MotifFn = (ctx, r, seed, c, at) => {
  const W = at.w > 0 ? at.w : r * 2;
  const H = at.h > 0 ? at.h : r * 2;
  const w = motifInk(r * 0.8, c);
  const pier = Math.max(2.5, W * 0.16);
  // The bay does NOT fill its cell top to bottom. It used to: the ledge sat
  // flush on the bottom edge and the arch's crown poked out of the top, so at
  // one bay per tile the crown of the row below landed on the ledge of the row
  // above — and the horizontal seam became the single busiest line in the
  // whole tile. A band of plain wall at each end is both the fix and what a
  // real arcade has between its storeys.
  const foot = H * 0.42;
  const ledge = Math.max(2.5, H * 0.06);
  // Half a pixel of overlap on each side. Two rects that share an exact edge
  // still leave an antialiased hairline between them, and a hairline repeated
  // down a wall is the pale banding this module exists to avoid.
  const bleed = 0.6;

  // The ledge, running the full width of the bay.
  ctx.beginPath();
  ctx.rect(-W / 2 - bleed, foot - ledge, W + bleed * 2, ledge);
  ctx.fillStyle = c.bloom;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-W / 2 - bleed, foot - ledge);
  ctx.lineTo(W / 2 + bleed, foot - ledge);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.8;
  ctx.lineCap = 'butt';
  ctx.stroke();
  ctx.lineCap = 'round';

  const inner = W / 2 - pier;
  const spring = -H * 0.02;
  const crown = -H * 0.28;

  // The niche: the void the arch frames, as a second flat face. Depth in this
  // language is a darker face beside a lighter one, and an arcade with nothing
  // behind it is a row of croquet hoops.
  ctx.beginPath();
  ctx.moveTo(-inner, foot - ledge);
  ctx.lineTo(-inner, spring);
  ctx.quadraticCurveTo(-inner, crown, 0, crown);
  ctx.quadraticCurveTo(inner, crown, inner, spring);
  ctx.lineTo(inner, foot - ledge);
  ctx.closePath();
  ink(ctx, c, w * 0.7, c.bloom);

  // The arch band and its two piers, as one silhouette so the springing point
  // is a corner of the same shape rather than two shapes meeting.
  const outerTop = crown - Math.max(3, H * 0.1);
  ctx.beginPath();
  ctx.moveTo(-W / 2, foot);
  ctx.lineTo(-W / 2, spring - H * 0.03);
  ctx.quadraticCurveTo(-W / 2, outerTop, 0, outerTop);
  ctx.quadraticCurveTo(W / 2, outerTop, W / 2, spring - H * 0.03);
  ctx.lineTo(W / 2, foot);
  ctx.lineTo(inner, foot);
  ctx.lineTo(inner, spring);
  ctx.quadraticCurveTo(inner, crown, 0, crown);
  ctx.quadraticCurveTo(-inner, crown, -inner, spring);
  ctx.lineTo(-inner, foot);
  ctx.closePath();
  ink(ctx, c, w);

  // Keystone at the crown, and an impost block where each pier meets its arch.
  ctx.beginPath();
  ctx.moveTo(-W * 0.055, crown + H * 0.02);
  ctx.lineTo(W * 0.055, crown + H * 0.02);
  ctx.lineTo(W * 0.075, outerTop + H * 0.01);
  ctx.lineTo(-W * 0.075, outerTop + H * 0.01);
  ctx.closePath();
  ink(ctx, c, w * 0.7, c.accent);
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.rect(side * (W / 2) - (side > 0 ? pier * 1.2 : 0), spring, pier * 1.2, Math.max(2, H * 0.035));
    ink(ctx, c, w * 0.55, c.accent);
  }
  void seed;
};

/**
 * One scale of a fish-scale repeat: the rim, a shell line, and three ribs.
 *
 * Deliberately still an OUTLINE and not a filled overlapping scale. A filled
 * seigaiha is a cycle of overlaps — every row laps the one above it — and on a
 * torus that cycle has to break somewhere, which puts one row's overlap the
 * wrong way round at the seam. Drawn as a line, there is nothing to be behind
 * anything.
 */
const scallop: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8, c);
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.bezierCurveTo(-r, r * 1.28, r, r * 1.28, r, 0);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();
  // Two tighter arcs inside — the shell lines. The inner one takes the detail
  // colour, which is the only colour a line-drawn motif has anywhere to put.
  ctx.beginPath();
  ctx.moveTo(-r * 0.68, r * 0.1);
  ctx.bezierCurveTo(-r * 0.68, r * 0.94, r * 0.68, r * 0.94, r * 0.68, r * 0.1);
  ctx.lineWidth = w * 0.62;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.38, r * 0.2);
  ctx.bezierCurveTo(-r * 0.38, r * 0.66, r * 0.38, r * 0.66, r * 0.38, r * 0.2);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = w * 0.62;
  ctx.stroke();
  void seed;
  void c.face;
};

/**
 * One cell of a honeycomb. Every third one is capped, so the comb has honey
 * in it rather than being a field of identical empty hexagons.
 */
const honeycombCell: MotifFn = (ctx, r, seed, c, at) => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // Barely rounded: these cells MEET, and a corner rounded off by a fifth of
  // the cell leaves six triangles of bare wall at every junction.
  roundedPoly(ctx, pts, r * 0.12 * joinRound(c));
  // One cell in four, from the two parities — which is why `parity: 2` is on
  // the plan. Any rule with a longer period than the fitted count has puts the
  // wrong cells against the seam.
  const capped = at.col % 2 === 0 && at.row % 2 === 0;
  ink(ctx, c, motifInk(r, c), capped ? c.bloom : true);
  if (capped) {
    // A smaller hexagon inside the capped ones, in the detail colour.
    const inner = pts.map(([x, y]) => [x * 0.44, y * 0.44] as const);
    roundedPoly(ctx, inner, r * 0.08 * joinRound(c));
    ink(ctx, c, motifInk(r, c) * 0.7, c.accent);
  } else {
    pip(ctx, 0, 0, r * 0.13, c.accent, c, 0);
  }
  void seed;
};

/**
 * One diamond of a garden trellis, plus the knot where four of them meet.
 *
 * The old one rounded its corners by a third of the lozenge, so the four
 * diamonds around a junction all stopped short of it and left a little
 * four-pointed hole — the joinery complaint, in miniature, repeated across the
 * whole wall. The corners are now nearly sharp, and the junction gets a KNOT
 * on top: a rosette drawn at this cell's top and left corners only, which
 * covers every junction in the lattice exactly once.
 */
const trellisCell: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8, c);
  roundedPoly(
    ctx,
    [
      [0, -r],
      [r, 0],
      [0, r],
      [-r, 0],
    ],
    r * 0.08 * joinRound(c),
  );
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // A lighter core down the middle of the batten, so the lattice reads as a
  // strip of painted wood rather than as a wire.
  ctx.strokeStyle = c.face;
  ctx.lineWidth = w * 0.62;
  ctx.stroke();
  // Leaves hung inside the lozenge, off the two side corners.
  for (const side of [1, -1] as const) {
    ctx.save();
    ctx.translate(side * r * 0.6, 0);
    ctx.rotate(side * -0.5);
    leaf(ctx, r * 0.42 * side, r * 0.15 * side, side > 0 ? -1.57 : 1.57);
    ink(ctx, c, w * 0.7, c.bloom);
    ctx.restore();
  }
  for (const [kx, ky] of [
    [0, -r],
    [-r, 0],
  ] as const) {
    ctx.save();
    ctx.translate(kx, ky);
    ctx.rotate(Math.PI / 4);
    roundedPoly(
      ctx,
      [
        [0, -r * 0.17],
        [r * 0.17, 0],
        [0, r * 0.17],
        [-r * 0.17, 0],
      ],
      r * 0.06 * joinRound(c),
    );
    ink(ctx, c, w * 0.8, c.accent);
    ctx.restore();
  }
  void seed;
};

/**
 * A harlequin lozenge — big diamonds meeting edge to edge, two colours.
 *
 * Measured off the fitted cell rather than off `r`: the diamonds have to share
 * their edges exactly, and the cell is not square (a harlequin is taller than
 * it is wide or it reads as a chessboard turned 45°).
 */
const harlequin: MotifFn = (ctx, r, seed, c, at) => {
  const hw = (at.w > 0 ? at.w : r * 2) / 2;
  const hh = (at.h > 0 ? at.h : r * 2) / 2;
  const w = motifInk(Math.min(hw, hh) * 0.8, c);
  const bleed = 0.5;
  roundedPoly(
    ctx,
    [
      [0, -hh - bleed],
      [hw + bleed, 0],
      [0, hh + bleed],
      [-hw - bleed, 0],
    ],
    Math.min(hw, hh) * 0.06 * joinRound(c),
  );
  const dark = (at.col + at.row) % 2 === 0;
  ink(ctx, c, w, dark ? c.bloom : true);
  // A slim inner lozenge, offset toward nothing in particular — it is a second
  // flat face, not a shadow. On the pale diamonds it takes the detail colour,
  // on the dark ones the face, so the two populations swap roles.
  roundedPoly(
    ctx,
    [
      [0, -hh * 0.44],
      [hw * 0.44, 0],
      [0, hh * 0.44],
      [-hw * 0.44, 0],
    ],
    Math.min(hw, hh) * 0.05 * joinRound(c),
  );
  ink(ctx, c, w * 0.7, dark ? c.face : c.accent);
  void seed;
};

/**
 * A gingham crossing — the square where warp meets weft.
 *
 * Rounded, because a hard-cornered rectangle is the one shape the icon's
 * language does not contain, and a wall of them reads as a spreadsheet.
 */
const ginghamCross: MotifFn = (ctx, r, seed, c) => {
  roundedPoly(
    ctx,
    [
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r],
    ],
    r * 0.36 * c.edge.round,
  );
  ctx.fillStyle = c.bloom;
  ctx.fill();
  void seed;
};

/**
 * The pomegranate — the fruit every sixteenth-century weaver put on everything.
 *
 * The one motif in the book with a real INSIDE: the fruit is cut away to show
 * a bed of seeds, which is where the detail colour finally gets a surface
 * rather than a pip.
 */
const pomegranate: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8, c);
  const H = r * 0.9;
  const W = r * 0.62;
  ctx.save();
  ctx.rotate(jitter(seed) * 0.06 * c.edge.wobble);

  // Two leaves behind the fruit, flanking the crown. Hung off the BELLY in the
  // first pass, where they read as a tail and turned the fruit into a chilli.
  for (const side of [1, -1] as const) {
    ctx.save();
    ctx.translate(side * W * 0.42, -H * 0.34);
    ctx.rotate(side * 1.15);
    leaf(ctx, r * 0.5 * side, r * 0.16 * side, side > 0 ? -1.57 : 1.57);
    ink(ctx, c, w * 0.7, c.bloom);
    ctx.restore();
  }

  // The body: broad and heavy at the bottom, drawn in to a shoulder at the top.
  ctx.beginPath();
  ctx.moveTo(0, -H * 0.42);
  ctx.bezierCurveTo(W * 0.72, -H * 0.34, W, H * 0.12, W * 0.78, H * 0.54);
  ctx.bezierCurveTo(W * 0.6, H * 0.86, -W * 0.6, H * 0.86, -W * 0.78, H * 0.54);
  ctx.bezierCurveTo(-W, H * 0.12, -W * 0.72, -H * 0.34, 0, -H * 0.42);
  ctx.closePath();
  ink(ctx, c, w);

  // The cut: a dome of seed-bed across the belly, with the seeds set into it.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-W * 0.66, H * 0.1);
  ctx.bezierCurveTo(-W * 0.5, -H * 0.24, W * 0.5, -H * 0.24, W * 0.66, H * 0.1);
  ctx.bezierCurveTo(W * 0.5, H * 0.68, -W * 0.5, H * 0.68, -W * 0.66, H * 0.1);
  ctx.closePath();
  ink(ctx, c, w * 0.7, c.bloom);
  ctx.clip();
  for (const [sx, sy] of [
    [-0.3, -0.02],
    [0, -0.1],
    [0.3, -0.02],
    [-0.16, 0.2],
    [0.16, 0.2],
    [0, 0.42],
  ] as const) {
    ctx.save();
    ctx.translate(W * sx, H * sy);
    ctx.rotate(sx * 0.5);
    leaf(ctx, H * 0.24, W * 0.11, 0);
    ink(ctx, c, w * 0.5, c.accent);
    ctx.restore();
  }
  ctx.restore();

  // The calyx: five sepals standing off the shoulder. It is the crown that
  // makes a pomegranate a pomegranate and not an apple.
  for (const [tilt, len] of [
    [0, 0.34],
    [-0.62, 0.28],
    [0.62, 0.28],
    [-1.15, 0.2],
    [1.15, 0.2],
  ] as const) {
    ctx.save();
    ctx.translate(0, -H * 0.36);
    leaf(ctx, -H * len, W * 0.13, tilt);
    ink(ctx, c, w * 0.6);
    ctx.restore();
  }
  ctx.restore();
};

/**
 * A classical urn with a spray of three sprigs — the mantelpiece motif.
 *
 * Drawn from a centre line out, because an urn that is a hair asymmetric reads
 * as a mistake rather than as a hand-drawn line.
 */
const urn: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8, c);
  const H = r * 0.92;
  const W = r * 0.54;

  // The spray first, so the urn's lip laps over the stems.
  for (const [tilt, len, bud] of [
    [0, 0.62, 0.11],
    [-0.62, 0.5, 0.09],
    [0.62, 0.5, 0.09],
  ] as const) {
    ctx.save();
    ctx.translate(0, -H * 0.16);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(W * 0.16, -H * len * 0.5, 0, -H * len);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = w * 0.7;
    ctx.lineCap = 'round';
    ctx.stroke();
    for (const [t, side] of [
      [0.34, 1],
      [0.6, -1],
    ] as const) {
      ctx.save();
      ctx.translate(0, -H * len * t);
      leaf(ctx, r * 0.24 * side, r * 0.09 * side, side > 0 ? -1.15 : 1.15);
      ink(ctx, c, w * 0.55, c.bloom);
      ctx.restore();
    }
    pip(ctx, 0, -H * len, r * bud, c.accent, c, w * 0.55);
    ctx.restore();
  }

  // Foot, stem, bowl, lip — bottom up, each lapping the one below it.
  ctx.beginPath();
  ctx.moveTo(-W * 0.52, H * 0.92);
  ctx.lineTo(W * 0.52, H * 0.92);
  ctx.lineTo(W * 0.3, H * 0.74);
  ctx.lineTo(-W * 0.3, H * 0.74);
  ctx.closePath();
  ink(ctx, c, w * 0.8);
  ctx.beginPath();
  ctx.rect(-W * 0.15, H * 0.52, W * 0.3, H * 0.24);
  ink(ctx, c, w * 0.7, c.bloom);
  ctx.beginPath();
  ctx.moveTo(-W * 0.72, H * 0.02);
  ctx.bezierCurveTo(-W * 0.86, H * 0.44, -W * 0.4, H * 0.6, 0, H * 0.6);
  ctx.bezierCurveTo(W * 0.4, H * 0.6, W * 0.86, H * 0.44, W * 0.72, H * 0.02);
  ctx.closePath();
  ink(ctx, c, w);
  // A band across the belly of the bowl, in the detail colour.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-W * 0.72, H * 0.02);
  ctx.bezierCurveTo(-W * 0.86, H * 0.44, -W * 0.4, H * 0.6, 0, H * 0.6);
  ctx.bezierCurveTo(W * 0.4, H * 0.6, W * 0.86, H * 0.44, W * 0.72, H * 0.02);
  ctx.closePath();
  ctx.clip();
  ctx.beginPath();
  ctx.rect(-W, H * 0.16, W * 2, H * 0.14);
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.restore();
  // Two handles, curling out of the shoulder.
  for (const side of [1, -1] as const) {
    ctx.beginPath();
    ctx.moveTo(side * W * 0.66, H * 0.04);
    ctx.quadraticCurveTo(side * W * 1.14, -H * 0.02, side * W * 0.92, H * 0.26);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = w * 0.9;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // The lip, wider than the bowl, which is what makes it an urn.
  roundedRect(ctx, -W * 0.86, -H * 0.14, W * 1.72, H * 0.18, r * 0.06 * c.edge.round);
  ink(ctx, c, w * 0.85);
  void seed;
};

/* ---------------------- motifs that fill their cell ---------------------- */

/**
 * A hair of overlap onto the neighbouring cell.
 *
 * Two fills that share an exact edge still leave an antialiased hairline
 * between them, and a hairline repeated across a wall is the pale banding this
 * module exists to avoid. Every motif that MEETS its neighbours grows by this
 * much; free-standing ones ignore it.
 */
const BLEED = 0.6;

/**
 * The widest a moire's comb may be drawn, and how many swells run down its
 * tile at each scale.
 *
 * A moire is not a motif — it is an INTERFERENCE, and it only exists while the
 * comb is fine enough that the eye averages the crossings into a band. Draw the
 * same construction at a 35px pitch and every hairline becomes an object, every
 * crossing becomes a knot, and the wall is a chain-link fence. So the comb is
 * pinned to a hairline in every room and `scale` moves the thing a reader can
 * actually see change: how broad the watering is.
 *
 * Nine, and the two pixels between nine and the eleven it was first set to were
 * the difference between silk and fencing on the real wall. The specimen board
 * draws a tile at 0.6 and the shelf draws it at the camera's zoom, so eleven
 * looked fine on the board and still knotted in the app — which is why a paper
 * gets driven through the running world before it is called done.
 */
const MOIRE_PITCH_MAX = 9;
const MOIRE_SWELLS: Record<WallpaperScale, number> = {
  petite: 5,
  small: 4,
  medium: 3,
  large: 2,
  grand: 1,
};

/**
 * A rule with a bead on it — the bead-and-reel moulding, run vertically.
 *
 * The rod is drawn a hair past the cell top and bottom, so a column reads as
 * one continuous rule rather than as a stack of dashes; everything else is
 * comfortably inside. Measured off the fitted cell because the rod has to meet
 * the rod above it exactly.
 *
 * The rod is FAT — two thirds of the bead rather than a third of it — and that
 * ratio is what makes this a moulding instead of a necklace. A thin rod with a
 * fat bead threaded on it is a string of beads, and a wall of them read as
 * hanging chains; a carved bead-and-reel is a rod that SWELLS, so the bead has
 * to be barely wider than the thing it grows out of.
 */
const beading: MotifFn = (ctx, r, seed, c, at) => {
  const W = at.w > 0 ? at.w : r * 2;
  const H = at.h > 0 ? at.h : r * 2;
  const w = motifInk(r * 0.7, c);
  const rod = Math.max(2.2, W * 0.22);
  roundedRect(ctx, -rod / 2, -H / 2 - BLEED, rod, H + BLEED * 2, rod * 0.4 * c.edge.round);
  ink(ctx, c, w * 0.7);
  // Reel, bead, reel. The reels are flat discs and the bead is round, which is
  // the whole joke of the moulding and the reason it is not just a dotted line.
  for (const s of [-1, 1] as const) {
    roundedRect(
      ctx,
      -W * 0.14,
      s * H * 0.3 - H * 0.035,
      W * 0.28,
      H * 0.07,
      W * 0.03 * c.edge.round,
    );
    ink(ctx, c, w * 0.55, c.bloom);
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 0.17, H * 0.13, 0, 0, Math.PI * 2);
  ink(ctx, c, w * 0.8, c.accent);
  void seed;
};

/**
 * One length of bamboo cane, with the node it grows from and a spray of leaves.
 *
 * The cane runs the whole height of the cell so the grove is continuous; the
 * node sits well inside it. Leaves spring off the node and alternate side by
 * ROW, which is what stops the grove reading as a printed barcode.
 *
 * The spray is THREE leaves, two up and one turned down, and they are half as
 * wide again as they were. Both changes answer the same report: a single narrow
 * blade tilted off the top of a straight rod is a sharpened pencil, and the
 * grand cane read as a box of them. A leaf has to be wide enough to have a
 * belly, and a spray has to fan rather than point, or the cane is a stick with
 * a nib on it.
 */
const bamboo: MotifFn = (ctx, r, seed, c, at) => {
  const W = at.w > 0 ? at.w : r * 2;
  const H = at.h > 0 ? at.h : r * 2;
  const w = motifInk(W * 0.55, c);
  const cane = W * 0.44;
  const flip = at.row % 2 === 0 ? 1 : -1;

  // Leaves first, so the cane laps their stalks.
  ctx.save();
  ctx.translate(0, H * 0.33);
  ctx.scale(flip, 1);
  for (const [tilt, len, wide, fill] of [
    [-0.58, 0.60, 0.40, true],
    [-1.14, 0.46, 0.36, false],
    [0.42, 0.34, 0.34, true],
  ] as const) {
    ctx.save();
    ctx.rotate(tilt);
    leaf(ctx, W * len * 1.5, W * len * wide, -Math.PI / 2);
    ink(ctx, c, w * 0.55, fill ? true : c.bloom);
    ctx.restore();
  }
  ctx.restore();

  roundedRect(ctx, -cane / 2, -H / 2 - BLEED, cane, H + BLEED * 2, cane * 0.24 * c.edge.round);
  ink(ctx, c, w * 0.8);
  // The node: a swollen collar, with a rule above and below it.
  roundedRect(ctx, -cane * 0.6, H * 0.28, cane * 1.2, H * 0.07, cane * 0.16 * c.edge.round);
  ink(ctx, c, w * 0.65, c.bloom);
  for (const dy of [0.17, 0.41] as const) {
    ctx.beginPath();
    ctx.moveTo(-cane * 0.42, H * dy);
    ctx.lineTo(cane * 0.42, H * dy);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = Math.max(0.7, w * 0.45);
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  void seed;
};

/**
 * An argyle lozenge: a diamond short of its cell, with the knit's dashed
 * overcheck running corner to corner through it.
 *
 * The gap is the whole difference between this and the harlequin, which meets
 * edge to edge. The overcheck runs on the CELL's diagonals rather than the
 * diamond's, so it carries on into the neighbour and the field reads as one
 * knitted plane.
 */
const argyle: MotifFn = (ctx, r, seed, c, at) => {
  const hw = (at.w > 0 ? at.w : r * 2) / 2;
  const hh = (at.h > 0 ? at.h : r * 2) / 2;
  const w = motifInk(Math.min(hw, hh) * 0.8, c);
  const dark = (at.col + at.row) % 2 === 0;
  roundedPoly(
    ctx,
    [
      [0, -hh * 0.9],
      [hw * 0.9, 0],
      [0, hh * 0.9],
      [-hw * 0.9, 0],
    ],
    Math.min(hw, hh) * 0.1 * c.edge.round,
  );
  ink(ctx, c, w, dark ? c.bloom : true);
  const thin = Math.max(0.8, w * 0.6);
  dashedLine(ctx, -hw, -hh, hw, hh, c.accent, thin);
  dashedLine(ctx, -hw, hh, hw, -hh, thread(c), thin);
  void seed;
};

/**
 * A pinwheel block: four quadrants, each cut on its diagonal, all turning the
 * same way. The turn reverses cell by cell, so the field spins both ways.
 *
 * Square cells only — the quadrants are drawn once and rotated, and a cell that
 * is not square would shear them.
 */
const pinwheel: MotifFn = (ctx, r, seed, c, at) => {
  const h = ((at.w > 0 ? Math.min(at.w, at.h) : r * 2) / 2) + BLEED;
  const w = motifInk(h * 0.55, c);
  const spin = (at.col + at.row) % 2 === 0 ? 1 : -1;
  ctx.save();
  ctx.scale(spin, 1);
  for (let q = 0; q < 4; q++) {
    ctx.save();
    ctx.rotate((q * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(h, -h);
    ctx.lineTo(h, 0);
    ctx.closePath();
    ink(ctx, c, w * 0.7);
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(h, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ink(ctx, c, w * 0.7, c.bloom);
    ctx.restore();
  }
  ctx.restore();
  pip(ctx, 0, 0, h * 0.14, c.accent, c, w * 0.6);
  void seed;
};

/**
 * A basketweave block: three slats, laid across in one cell and up in the next.
 *
 * The two populations take different faces, which is what makes the weave read
 * as over-and-under rather than as a grid of ticks. Slats run a hair past the
 * cell edge so the group butts into its neighbour without a pale joint.
 */
const basketweave: MotifFn = (ctx, r, seed, c, at) => {
  const W = at.w > 0 ? at.w : r * 2;
  const H = at.h > 0 ? at.h : r * 2;
  const short = Math.min(W, H);
  const w = motifInk(short * 0.34, c);
  const across = (at.col + at.row) % 2 === 0;
  const grout = Math.max(0.8, short * 0.055);
  const round = short * 0.055 * c.edge.round;
  for (let i = 0; i < 3; i++) {
    if (across) {
      roundedRect(
        ctx,
        -W / 2 - BLEED,
        -H / 2 + (i * H) / 3 + grout / 2,
        W + BLEED * 2,
        H / 3 - grout,
        round,
      );
    } else {
      roundedRect(
        ctx,
        -W / 2 + (i * W) / 3 + grout / 2,
        -H / 2 - BLEED,
        W / 3 - grout,
        H + BLEED * 2,
        round,
      );
    }
    ink(ctx, c, w * 0.8, across ? true : c.bloom);
  }
  // One thread of the detail colour down the middle slat, so the weave has a
  // warp rather than being three identical planks.
  ctx.beginPath();
  if (across) {
    ctx.moveTo(-W / 2, 0);
    ctx.lineTo(W / 2, 0);
  } else {
    ctx.moveTo(0, -H / 2);
    ctx.lineTo(0, H / 2);
  }
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = Math.max(0.7, w * 0.5);
  ctx.lineCap = 'butt';
  ctx.stroke();
  ctx.lineCap = 'round';
  void seed;
};

/**
 * A diaper compartment: a diamond ruled twice, a quatrefoil rosette caught in
 * it, and a lozenge covering each junction.
 *
 * The trellis it sits beside in the picker is a garden batten with a leaf; this
 * is the ruled diaper of an illuminated ground, so it is thinner, tighter, and
 * carries a foil rather than foliage.
 */
const diaper: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8, c);
  const corners = (k: number): readonly (readonly [number, number])[] => [
    [0, -r * k],
    [r * k, 0],
    [0, r * k],
    [-r * k, 0],
  ];
  ctx.lineJoin = 'round';
  roundedPoly(ctx, corners(1), r * 0.05 * joinRound(c));
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 1.05;
  ctx.stroke();
  roundedPoly(ctx, corners(0.8), r * 0.04 * joinRound(c));
  ctx.strokeStyle = thread(c);
  ctx.lineWidth = Math.max(0.7, w * 0.5);
  ctx.stroke();

  foilPath(ctx, r * 0.16, r * 0.25, 4, Math.PI / 4);
  ink(ctx, c, w * 0.8);
  pip(ctx, 0, 0, r * 0.09, c.accent, c, w * 0.55);

  // The top and left junctions only, which covers every junction of the
  // lattice exactly once.
  for (const [kx, ky] of [
    [0, -r],
    [-r, 0],
  ] as const) {
    ctx.save();
    ctx.translate(kx, ky);
    roundedPoly(ctx, corners(0.15), r * 0.04 * joinRound(c));
    ink(ctx, c, w * 0.7, c.accent);
    ctx.restore();
  }
  void seed;
};

/**
 * One unit of a Greek key.
 *
 * The baseline runs the full width of the cell and a line-weight past it, so
 * consecutive units join into one continuous band; the meander hooks back
 * inside the cell and never reaches an edge. Drawn as a ribbon — fat ink, thin
 * core — because a key drawn as a bare line reads as a diagram.
 */
const fret: MotifFn = (ctx, r, seed, c, at) => {
  const W = at.w > 0 ? at.w : r * 2;
  const H = at.h > 0 ? at.h : r * 2;
  const w = Math.max(1.3, Math.min(W, H) * 0.1 * c.edge.weight);
  const y0 = H * 0.42;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(-W / 2 - w, y0);
    ctx.lineTo(W / 2 + w, y0);
    ctx.moveTo(W * 0.3, y0);
    ctx.lineTo(W * 0.3, -H * 0.34);
    ctx.lineTo(-W * 0.3, -H * 0.34);
    ctx.lineTo(-W * 0.3, H * 0.06);
    ctx.lineTo(W * 0.05, H * 0.06);
    ctx.lineTo(W * 0.05, -H * 0.12);
  };
  ribbon(ctx, c, w * 1.5, trace);
  // The eye of the spiral, in the detail colour.
  pip(ctx, W * 0.05, -H * 0.12, Math.max(0.9, w * 0.6), c.accent, c, 0);
  void seed;
};

/**
 * One quatrefoil of an interlocking quatrefoil trellis.
 *
 * Sized so the lobes just kiss the neighbour's across the cell boundary, with
 * a half-pixel of overlap: exactly tangent leaves an antialiased hairline at
 * every joint, and any more than a half pixel starts printing one foil's
 * outline across the next one's face.
 */
const quatrefoil: MotifFn = (ctx, r, seed, c, at) => {
  const R = (at.w > 0 ? Math.min(at.w, at.h) : r * 2) / 2;
  const w = motifInk(R * 0.8, c);
  // The lobe radius is a little UNDER the offset, which is what puts a cusp
  // between the lobes. A fat lobe on a short offset unions into a disc, and a
  // field of discs is a spot paper, not a quatrefoil trellis.
  foilPath(ctx, R * 0.52, R * 0.48 + 0.5, 4);
  ink(ctx, c, w);
  foilPath(ctx, R * 0.3, R * 0.27, 4, Math.PI / 4);
  ink(ctx, c, w * 0.7, c.bloom);
  pip(ctx, 0, 0, R * 0.13, c.accent, c, w * 0.6);
  void seed;
};

/**
 * One compartment of an ogee net — the onion lattice, without the damask's
 * device hanging inside it.
 *
 * Drawn as a ribbon that reaches exactly to the four midpoints of its cell, so
 * four of them close around every junction; the boss is then drawn over the
 * top at the north and west junctions only, covering each one exactly once.
 */
const ogee: MotifFn = (ctx, r, seed, c, at) => {
  const hw = (at.w > 0 ? at.w : r * 2) / 2;
  const hh = (at.h > 0 ? at.h : r * 2) / 2;
  const w = motifInk(Math.min(hw, hh) * 0.8, c);
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.bezierCurveTo(hw * 0.1, -hh * 0.56, hw, -hh * 0.52, hw, 0);
    ctx.bezierCurveTo(hw, hh * 0.52, hw * 0.1, hh * 0.56, 0, hh);
    ctx.bezierCurveTo(-hw * 0.1, hh * 0.56, -hw, hh * 0.52, -hw, 0);
    ctx.bezierCurveTo(-hw, -hh * 0.52, -hw * 0.1, -hh * 0.56, 0, -hh);
  };
  ribbon(ctx, c, w * 1.7, trace);
  // A trefoil hanging from the crown of the compartment.
  ctx.save();
  ctx.translate(0, hh * 0.06);
  foilPath(ctx, Math.min(hw, hh) * 0.13, Math.min(hw, hh) * 0.2, 3, -Math.PI / 2);
  ink(ctx, c, w * 0.7, c.bloom);
  ctx.restore();
  pip(ctx, 0, hh * 0.06, Math.min(hw, hh) * 0.075, c.accent, c, w * 0.5);
  for (const [bx, by] of [
    [0, -hh],
    [-hw, 0],
  ] as const) {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.PI / 4);
    roundedRect(
      ctx,
      -Math.min(hw, hh) * 0.1,
      -Math.min(hw, hh) * 0.1,
      Math.min(hw, hh) * 0.2,
      Math.min(hw, hh) * 0.2,
      Math.min(hw, hh) * 0.05 * joinRound(c),
    );
    ink(ctx, c, w * 0.7, c.accent);
    ctx.restore();
  }
  void seed;
};

/* ------------------------ small devices, sown ---------------------------- */

/** The Empire bee: banded body, gauze wings, and a pair of antennae. */
const bee: MotifFn = (ctx, r, seed, c, at) => {
  const w = motifInk(r * 0.6, c);
  if (at.alt) {
    // Three specks between the bees, so the ground is not bare paper.
    for (const [dx, dy] of [
      [0, -0.13],
      [-0.13, 0.09],
      [0.13, 0.09],
    ] as const) {
      pip(ctx, r * dx, r * dy, Math.max(0.9, r * 0.07), c.accent, c, w * 0.4);
    }
    return;
  }
  ctx.save();
  ctx.rotate(jitter(seed) * 0.16 * c.edge.wobble);
  // Wings first, filled with the wall itself: a bee's wing is glass. Swept
  // well out to the side — a wing carried near the vertical is an EAR, which
  // is what the first pass of this drew.
  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.translate(side * r * 0.1, -r * 0.1);
    leaf(ctx, r * 0.74, r * 0.32, side > 0 ? -2.02 : 2.02);
    ink(ctx, c, w * 0.55, c.ground);
    ctx.restore();
  }
  // Body.
  ctx.beginPath();
  ctx.ellipse(0, r * 0.24, r * 0.29, r * 0.44, 0, 0, Math.PI * 2);
  ink(ctx, c, w);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, r * 0.24, r * 0.29, r * 0.44, 0, 0, Math.PI * 2);
  ctx.clip();
  for (const y of [0.08, 0.32, 0.54] as const) {
    ctx.beginPath();
    ctx.rect(-r * 0.4, r * y, r * 0.8, r * 0.12);
    ctx.fillStyle = c.accent;
    ctx.fill();
  }
  ctx.restore();
  // Head, and the two antennae.
  ctx.beginPath();
  ctx.arc(0, -r * 0.32, r * 0.21, 0, Math.PI * 2);
  ink(ctx, c, w * 0.8, c.bloom);
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.09, -r * 0.46);
    ctx.quadraticCurveTo(side * r * 0.26, -r * 0.72, side * r * 0.34, -r * 0.58);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = Math.max(0.7, w * 0.5);
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
};

/** The fleur-de-lys: three petals, a band, and a tail. */
const fleur: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.7, c);
  ctx.save();
  ctx.rotate(jitter(seed) * 0.06 * c.edge.wobble);
  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.06);
    ctx.bezierCurveTo(r * 0.46, -r * 0.5, r * 0.86, -r * 0.06, r * 0.58, r * 0.34);
    ctx.bezierCurveTo(r * 0.6, -r * 0.02, r * 0.32, r * 0.04, 0, r * 0.16);
    ctx.closePath();
    ink(ctx, c, w * 0.8);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.94);
  ctx.bezierCurveTo(r * 0.3, -r * 0.5, r * 0.28, -r * 0.1, r * 0.2, r * 0.2);
  ctx.lineTo(-r * 0.2, r * 0.2);
  ctx.bezierCurveTo(-r * 0.28, -r * 0.1, -r * 0.3, -r * 0.5, 0, -r * 0.94);
  ctx.closePath();
  ink(ctx, c, w);
  ctx.beginPath();
  ctx.moveTo(-r * 0.24, r * 0.4);
  ctx.bezierCurveTo(-r * 0.1, r * 0.78, r * 0.1, r * 0.78, r * 0.24, r * 0.4);
  ctx.closePath();
  ink(ctx, c, w * 0.75, c.bloom);
  roundedRect(ctx, -r * 0.38, r * 0.16, r * 0.76, r * 0.2, r * 0.07 * c.edge.round);
  ink(ctx, c, w * 0.8, c.accent);
  ctx.restore();
};

/** A little sun: alternating long and short rays around a ringed disc. */
const sunburst: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.6, c);
  const rays = 12;
  ctx.save();
  ctx.rotate(jitter(seed) * 0.12 * c.edge.wobble);
  for (let i = 0; i < rays; i++) {
    ctx.save();
    ctx.rotate((i / rays) * Math.PI * 2);
    const long = i % 2 === 0;
    leaf(ctx, -r * (long ? 0.98 : 0.74), r * (long ? 0.11 : 0.08), 0);
    ink(ctx, c, w * 0.6, long ? true : c.accent);
    ctx.restore();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ink(ctx, c, w);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.21, 0, Math.PI * 2);
  ink(ctx, c, w * 0.7, c.accent);
  pip(ctx, 0, 0, r * 0.075, c.bloom, c, w * 0.5);
};

/**
 * A star with one link of a chain drawn off it — right or down, by cell.
 *
 * One link per cell rather than both is the whole design: two links per cell is
 * a ruled grid with stars at the crossings, and one is a line that wanders.
 * The link ends exactly on the neighbour's centre, where the neighbour's own
 * star covers the join.
 */
const constellation: MotifFn = (ctx, r, seed, c, at) => {
  const W = at.w > 0 ? at.w : r * 2;
  const H = at.h > 0 ? at.h : r * 2;
  const w = motifInk(r * 0.5, c);
  const along = (at.col + at.row) % 2 === 0;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  if (along) ctx.lineTo(W, 0);
  else ctx.lineTo(0, H);
  ctx.strokeStyle = thread(c);
  ctx.lineWidth = Math.max(0.7, w * 0.5);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.save();
  ctx.rotate(jitter(seed) * 0.4 * c.edge.wobble);
  starPath(ctx, r * 0.44, 5, 0.4);
  ink(ctx, c, w);
  ctx.restore();
  pip(ctx, 0, 0, r * 0.1, c.accent, c, w * 0.5);
  // A speck off the lattice, so the sky is not a grid of equal stars.
  pip(
    ctx,
    W * (along ? 0.42 : -0.3),
    H * 0.34,
    Math.max(0.9, r * 0.09),
    c.accent,
    c,
    w * 0.4,
  );
};

/* ---------------------------- things that grew --------------------------- */

/** A fern frond: eight pairs of pinnae up a curving rachis, crozier at the tip. */
const fern: MotifFn = (ctx, r, seed, c, at) => {
  const w = motifInk(r * 0.6, c);
  const flip = at.row % 2 === 0 ? 1 : -1;
  const p0 = [-r * 0.32, r * 0.95] as const;
  const p1 = [-r * 0.54, -r * 0.08] as const;
  const p2 = [r * 0.5, -r * 0.86] as const;
  const on = (t: number): [number, number] => [
    (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
  ];
  ctx.save();
  ctx.scale(flip, 1);
  ctx.rotate(jitter(seed) * 0.1 * c.edge.wobble);
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.85;
  ctx.lineCap = 'round';
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const t = 0.07 + i * 0.115;
    const [bx, by] = on(t);
    const [nx, ny] = on(t + 0.01);
    const tilt = Math.atan2(ny - by, nx - bx);
    const len = r * (0.52 - i * 0.046);
    for (const side of [1, -1] as const) {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(tilt + side * 1.02);
      leaf(ctx, len, len * 0.3, -Math.PI / 2);
      ink(ctx, c, w * 0.55, i % 2 === 0 ? true : c.bloom);
      ctx.restore();
    }
  }
  // The crozier — the tight curl a frond has before it opens. Nothing else in
  // the book has one, and it is what says "fern" rather than "leafy thing".
  ctx.save();
  ctx.translate(p2[0], p2[1]);
  volute(ctx, r * 0.2, 0.86, 1, Math.PI * 0.6);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.7;
  ctx.stroke();
  ctx.restore();
  pip(ctx, p2[0], p2[1], r * 0.07, c.accent, c, w * 0.5);
  ctx.restore();
};

/**
 * A length of trailing vine — leaves, tendril and berries on a stem that leaves
 * the cell at the same height and the same slope it entered it.
 *
 * That is the whole trick: a swag whose ends merely LINE UP gives a chain of
 * separate scallops with a kink at each joint, and matching the tangent as
 * well gives one continuous trail across the wall.
 */
const vine: MotifFn = (ctx, r, seed, c, at) => {
  const W = at.w > 0 ? at.w : r * 2;
  const H = at.h > 0 ? at.h : r * 2;
  const w = motifInk(r * 0.6, c);
  const flip = at.row % 2 === 0 ? 1 : -1;
  const a = [-W / 2 - BLEED, 0] as const;
  const b = [-W * 0.2, -H * 0.4] as const;
  const d = [W * 0.2, H * 0.4] as const;
  const e = [W / 2 + BLEED, 0] as const;
  const on = (t: number): [number, number] => {
    const u = 1 - t;
    return [
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * d[0] + t * t * t * e[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * d[1] + t * t * t * e[1],
    ];
  };
  ctx.save();
  ctx.scale(1, flip);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.bezierCurveTo(b[0], b[1], d[0], d[1], e[0], e[1]);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.8;
  ctx.lineCap = 'round';
  ctx.stroke();
  for (const [t, side, len] of [
    [0.13, 1, 0.5],
    [0.32, -1, 0.42],
    [0.5, 1, 0.34],
    [0.68, -1, 0.42],
    [0.87, 1, 0.5],
  ] as const) {
    const [bx, by] = on(t);
    const [nx, ny] = on(t + 0.01);
    const tilt = Math.atan2(ny - by, nx - bx);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(tilt + side * 1.15);
    leaf(ctx, r * len, r * len * 0.44, -Math.PI / 2);
    ink(ctx, c, w * 0.65, side > 0 ? true : c.bloom);
    ctx.restore();
  }
  // A tendril and a small bunch, hung off the middle of the run.
  const [mx, my] = on(0.5);
  ctx.save();
  ctx.translate(mx, my + r * 0.08);
  volute(ctx, r * 0.16, 0.78, -1, -Math.PI / 2);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = Math.max(0.7, w * 0.5);
  ctx.stroke();
  ctx.restore();
  for (const [bx, by, rr] of [
    [0.24, 0.2, 0.09],
    [0.34, 0.3, 0.075],
    [0.15, 0.32, 0.07],
  ] as const) {
    pip(ctx, mx + r * bx, my + r * by, r * rr, c.accent, c, w * 0.5);
  }
  ctx.restore();
  void seed;
};

/** A thistle: a spiked head over a scaled calyx, on a stem with cut leaves. */
const thistle: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.7, c);
  ctx.save();
  ctx.rotate(jitter(seed) * 0.09 * c.edge.wobble);
  ctx.beginPath();
  ctx.moveTo(0, r * 0.98);
  ctx.quadraticCurveTo(r * 0.1, r * 0.4, 0, r * 0.06);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.85;
  ctx.lineCap = 'round';
  ctx.stroke();
  // Two cut leaves down the stem — jagged, which is what a thistle's are.
  for (const [side, ty] of [
    [1, 0.52],
    [-1, 0.76],
  ] as const) {
    ctx.save();
    ctx.translate(0, r * ty);
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.2, -r * 0.12);
    ctx.lineTo(r * 0.28, r * 0.02);
    ctx.lineTo(r * 0.48, -r * 0.04);
    ctx.lineTo(r * 0.5, r * 0.12);
    ctx.lineTo(r * 0.24, r * 0.16);
    ctx.closePath();
    ink(ctx, c, w * 0.6, c.bloom);
    ctx.restore();
  }
  // The head: eight spines fanning out of the cup.
  for (const [tilt, len] of [
    [-0.88, 0.46],
    [-0.62, 0.6],
    [-0.36, 0.72],
    [-0.12, 0.8],
    [0.12, 0.8],
    [0.36, 0.72],
    [0.62, 0.6],
    [0.88, 0.46],
  ] as const) {
    ctx.save();
    ctx.translate(0, -r * 0.1);
    leaf(ctx, -r * len, r * 0.075, tilt);
    ink(ctx, c, w * 0.5, c.accent);
    ctx.restore();
  }
  // The cup, laid over the spines' feet.
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.14);
  ctx.bezierCurveTo(-r * 0.38, r * 0.34, r * 0.38, r * 0.34, r * 0.3, -r * 0.14);
  ctx.closePath();
  ink(ctx, c, w);
  for (const [dx, dy] of [
    [-0.13, -0.02],
    [0.13, -0.02],
    [0, 0.12],
  ] as const) {
    ctx.save();
    ctx.translate(r * dx, r * dy);
    ctx.rotate(Math.PI / 4);
    roundedRect(ctx, -r * 0.06, -r * 0.06, r * 0.12, r * 0.12, r * 0.03 * c.edge.round);
    ink(ctx, c, w * 0.45, c.bloom);
    ctx.restore();
  }
  ctx.restore();
};

/** A full-face rose: five outer petals around a spiralled heart, and two leaves. */
const rose: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.7, c);
  ctx.save();
  ctx.rotate(jitter(seed) * 0.3 * c.edge.wobble);
  for (const side of [1, -1] as const) {
    ctx.save();
    ctx.translate(side * r * 0.56, r * 0.6);
    ctx.rotate(side * 0.6);
    leaf(ctx, r * 0.52 * side, r * 0.2 * side, side > 0 ? -1.3 : 1.3);
    ink(ctx, c, w * 0.65, c.bloom);
    ctx.restore();
  }
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i / 5) * Math.PI * 2 + 0.32);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-r * 0.52, -r * 0.42, -r * 0.34, -r * 0.98, 0, -r * 0.84);
    ctx.bezierCurveTo(r * 0.34, -r * 0.98, r * 0.52, -r * 0.42, 0, 0);
    ctx.closePath();
    ink(ctx, c, w * 0.8);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.37, 0, Math.PI * 2);
  ink(ctx, c, w * 0.85, c.bloom);
  // The heart, as one spiral. A rose is a spiral; petals drawn round a disc
  // are a daisy, which is what the first draft of this came out as.
  ctx.beginPath();
  for (let i = 0; i <= 52; i++) {
    const t = i / 52;
    const a = t * Math.PI * 3.4;
    const rr = r * 0.33 * (1 - t * 0.84);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = Math.max(0.9, w * 0.7);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
};

/* --------------------------- devices and scenes -------------------------- */

/**
 * An arabesque: two mirrored scrolls climbing out of a foot, with a palmette
 * over them and leaves hung along the way.
 *
 * The damask beside it in the picker is a CLOSED cartouche — an ogee with a
 * device inside. This is the other half of the same tradition: open scrollwork
 * with nothing framed, which is why the two do not read as one another even
 * though both are gilt foliage on a wall.
 */
const arabesque: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8, c);
  const H = r * 0.94;
  const W = r * 0.66;
  for (const side of [1, -1] as const) {
    ctx.save();
    ctx.scale(side, 1);
    ribbon(ctx, c, w * 1.6, () => {
      ctx.beginPath();
      ctx.moveTo(0, H * 0.88);
      ctx.bezierCurveTo(W * 0.44, H * 0.56, W * 1.02, H * 0.06, W * 0.72, -H * 0.4);
      ctx.bezierCurveTo(W * 0.58, -H * 0.62, W * 0.24, -H * 0.54, W * 0.34, -H * 0.28);
    });
    for (const [lx, ly, tilt, len] of [
      [0.62, 0.34, -0.5, 0.4],
      [0.94, -0.12, 0.4, 0.34],
      [0.7, -0.5, 1.3, 0.26],
    ] as const) {
      ctx.save();
      ctx.translate(W * lx, H * ly);
      leaf(ctx, r * len, r * len * 0.4, tilt);
      ink(ctx, c, w * 0.6, c.bloom);
      ctx.restore();
    }
    ctx.restore();
  }
  // The palmette over the crown of the scrolls.
  for (const [tilt, len, wide] of [
    [0, 0.62, 0.24],
    [-0.55, 0.5, 0.2],
    [0.55, 0.5, 0.2],
    [-1.05, 0.36, 0.16],
    [1.05, 0.36, 0.16],
  ] as const) {
    ctx.save();
    ctx.translate(0, -H * 0.3);
    leaf(ctx, -H * len, W * wide, tilt);
    ink(ctx, c, w * 0.65);
    ctx.restore();
  }
  // The heart: a six-lobed rosette where the two scrolls spring from.
  foilPath(ctx, r * 0.11, r * 0.17, 6, jitter(seed) * 0.2);
  ink(ctx, c, w * 0.7, c.accent);
  ctx.save();
  ctx.translate(0, H * 0.86);
  foilPath(ctx, r * 0.08, r * 0.13, 3, Math.PI / 2);
  ink(ctx, c, w * 0.6, c.accent);
  ctx.restore();
};

/** A pagoda: three upswept roofs on a slender body, with a finial and bells. */
const pagoda: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.75, c);
  const H = r * 0.92;
  const tiers = [
    [-H * 0.36, r * 0.42, H * 0.19],
    [-H * 0.02, r * 0.62, H * 0.21],
    [H * 0.34, r * 0.84, H * 0.23],
  ] as const;

  // The finial, then the body, then the roofs from the bottom up, so each roof
  // laps the storey it covers.
  ctx.beginPath();
  ctx.moveTo(0, -H * 0.5);
  ctx.lineTo(0, -H * 0.86);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.7;
  ctx.lineCap = 'round';
  ctx.stroke();
  pip(ctx, 0, -H * 0.86, r * 0.1, c.accent, c, w * 0.6);
  pip(ctx, 0, -H * 0.72, r * 0.055, c.bloom, c, w * 0.45);

  for (const [y, hw] of tiers) {
    roundedRect(ctx, -hw * 0.38, y - H * 0.34, hw * 0.76, H * 0.34, r * 0.05 * c.edge.round);
    ink(ctx, c, w * 0.75, c.bloom);
  }
  // The plinth the whole thing stands on.
  roundedRect(ctx, -r * 0.66, H * 0.62, r * 1.32, H * 0.14, r * 0.05 * c.edge.round);
  ink(ctx, c, w * 0.8);

  for (let i = tiers.length - 1; i >= 0; i--) {
    const [y, hw, rh] = tiers[i]!;
    ctx.beginPath();
    ctx.moveTo(-hw, y - rh * 0.34);
    ctx.bezierCurveTo(-hw * 0.44, y - rh * 1.02, hw * 0.44, y - rh * 1.02, hw, y - rh * 0.34);
    ctx.bezierCurveTo(hw * 0.52, y + rh * 0.24, -hw * 0.52, y + rh * 0.24, -hw, y - rh * 0.34);
    ctx.closePath();
    ink(ctx, c, w, i === 1 ? c.accent : true);
    // A bell at each eave, which is the detail that makes it a pagoda rather
    // than a stack of hats.
    for (const side of [-1, 1] as const) {
      pip(ctx, side * hw * 0.94, y - rh * 0.16, r * 0.055, c.accent, c, w * 0.45);
    }
  }
  // The door.
  ctx.beginPath();
  ctx.moveTo(-r * 0.11, H * 0.62);
  ctx.lineTo(-r * 0.11, H * 0.4);
  ctx.quadraticCurveTo(0, H * 0.28, r * 0.11, H * 0.4);
  ctx.lineTo(r * 0.11, H * 0.62);
  ctx.closePath();
  ink(ctx, c, w * 0.6, c.ground);
  void seed;
};

/** A neoclassical patera: an oval medallion, a ribbon over it, husks below. */
const medallion: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8, c);
  const RX = r * 0.56;
  const RY = r * 0.44;
  // Husk drops, first, so the medallion laps their top.
  for (const [dy, len] of [
    [0.44, 0.2],
    [0.66, 0.16],
    [0.84, 0.12],
  ] as const) {
    ctx.save();
    ctx.translate(0, r * dy);
    leaf(ctx, r * len, r * len * 0.55, 0);
    ink(ctx, c, w * 0.55, c.bloom);
    ctx.restore();
  }
  // The ribbon: two loops and two tails, over the crown.
  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.58);
    ctx.bezierCurveTo(r * 0.3, -r * 0.94, r * 0.5, -r * 0.6, r * 0.16, -r * 0.5);
    ctx.closePath();
    ink(ctx, c, w * 0.65, c.accent);
    ctx.beginPath();
    ctx.moveTo(r * 0.06, -r * 0.5);
    ctx.quadraticCurveTo(r * 0.3, -r * 0.34, r * 0.24, -r * 0.16);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = w * 0.55;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
  // The medallion itself, as a window rather than a plate.
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ink(ctx, c, w * 1.1, c.ground);
  // A rim of pearls.
  const pearls = 18;
  for (let i = 0; i < pearls; i++) {
    const a = (i / pearls) * Math.PI * 2;
    pip(
      ctx,
      Math.cos(a) * RX * 0.86,
      Math.sin(a) * RY * 0.86,
      Math.max(0.8, r * 0.045),
      c.accent,
      c,
      0,
    );
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, RX * 0.68, RY * 0.68, 0, 0, Math.PI * 2);
  ink(ctx, c, w * 0.6, c.bloom);
  foilPath(ctx, r * 0.09, r * 0.14, 6, jitter(seed) * 0.2);
  ink(ctx, c, w * 0.6, c.accent);
};

/** A sitting hare, in profile, facing by cell — the one creature on the wall. */
const hare: MotifFn = (ctx, r, seed, c, at) => {
  const w = motifInk(r * 0.8, c);
  const flip = (at.col + at.row) % 2 === 0 ? 1 : -1;
  ctx.save();
  ctx.scale(flip, 1);
  ctx.rotate(jitter(seed) * 0.05 * c.edge.wobble);

  // Grass at the feet, so the hare is sitting on something.
  for (const [gx, tilt] of [
    [-0.66, 0.5],
    [0.62, -0.55],
    [0.82, -0.3],
  ] as const) {
    ctx.save();
    ctx.translate(r * gx, r * 0.62);
    leaf(ctx, -r * 0.3, r * 0.05, tilt);
    ink(ctx, c, w * 0.45, c.bloom);
    ctx.restore();
  }

  // Ears, behind the head.
  for (const [tilt, len] of [
    [-0.28, 0.66],
    [-0.6, 0.58],
  ] as const) {
    ctx.save();
    ctx.translate(r * 0.34, -r * 0.36);
    leaf(ctx, -r * len, r * 0.1, tilt);
    ink(ctx, c, w * 0.6);
    ctx.restore();
  }

  // Body, haunch, chest, head.
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, r * 0.2, r * 0.56, r * 0.4, -0.12, 0, Math.PI * 2);
  ink(ctx, c, w);
  ctx.beginPath();
  ctx.ellipse(-r * 0.26, r * 0.22, r * 0.3, r * 0.26, 0, 0, Math.PI * 2);
  ink(ctx, c, w * 0.7, c.bloom);
  ctx.beginPath();
  ctx.moveTo(r * 0.12, r * 0.16);
  ctx.bezierCurveTo(r * 0.4, r * 0.08, r * 0.46, -r * 0.14, r * 0.4, -r * 0.3);
  ctx.bezierCurveTo(r * 0.24, -r * 0.28, r * 0.14, -r * 0.06, r * 0.12, r * 0.16);
  ctx.closePath();
  ink(ctx, c, w * 0.8);
  ctx.beginPath();
  ctx.ellipse(r * 0.42, -r * 0.36, r * 0.24, r * 0.18, -0.3, 0, Math.PI * 2);
  ink(ctx, c, w * 0.85);
  // Tail, eye, nose.
  ctx.beginPath();
  ctx.arc(-r * 0.62, r * 0.06, r * 0.12, 0, Math.PI * 2);
  ink(ctx, c, w * 0.65, c.accent);
  pip(ctx, r * 0.44, -r * 0.42, Math.max(0.9, r * 0.055), c.ink, c, 0);
  pip(ctx, r * 0.62, -r * 0.3, Math.max(0.8, r * 0.045), c.accent, c, w * 0.4);
  ctx.restore();
};

const MOTIFS: Partial<Record<WallpaperPattern, MotifFn>> = {
  polka: dot,
  star,
  moonstar,
  sprig,
  laurel,
  pomegranate,
  damask,
  urn,
  bird,
  toile,
  arch: arcade,
  scallop,
  harlequin,
  honeycomb: honeycombCell,
  trellis: trellisCell,
  gingham: ginghamCross,
  beading,
  bamboo,
  argyle,
  pinwheel,
  basketweave,
  diaper,
  fret,
  quatrefoil,
  ogee,
  bee,
  fleur,
  sunburst,
  constellation,
  fern,
  vine,
  thistle,
  rose,
  arabesque,
  pagoda,
  medallion,
  hare,
};

/* ============================== the lattices ============================= */

/**
 * How a pattern arranges its cells.
 *
 * `halfdrop` shifts every other COLUMN down by half a cell, `brick` shifts
 * every other ROW along by half — the two arrangements that keep a repeat from
 * reading as a grid of stamps. Both need an EVEN count on the shifted axis or
 * the drop does not close across the tile, which `fitCount` enforces.
 */
type Lattice = 'grid' | 'halfdrop' | 'brick' | 'diamond';

/** Per-pattern nominal cell multiplier and arrangement. */
interface PatternPlan {
  lattice: Lattice;
  /** Cell size relative to the scale's nominal cell. */
  cell: number;
  /** Motif radius as a fraction of the pitch named by `radiusFrom`. */
  radius: number;
  /** Rows are this fraction of the column pitch (1 = square cells). */
  aspect: number;
  /**
   * Which fitted pitch the radius is measured against.
   *
   * `min` suits a motif that must not touch its neighbours. A motif that is
   * MEANT to meet its neighbours edge to edge — a hexagon, a fish-scale — has
   * to measure against the axis it meets along, or a non-square cell shrinks it
   * out of contact and the field falls apart into confetti.
   */
  radiusFrom: 'min' | 'col' | 'row';
  /**
   * How much of the depth axis this pattern actually takes, 0–1.
   *
   * A motif that MEETS its neighbours cannot carry much relief: the second
   * face has nowhere to sit except in the joint, where it shows as one cell
   * printed a hair off register rather than as thickness. Free-standing motifs
   * take the full offset; tessellating ones take a third of it, and the depth
   * picker still does something visible on both.
   */
  relief: number;
  /**
   * The period, in cells, of anything the motif decides from `col` / `row`.
   *
   * 1 for a motif that draws the same thing everywhere. 2 for one that
   * alternates — a harlequin's two colours, a bird's facing, a laurel's
   * mirror. The lattice is then fitted to a MULTIPLE of it, without which the
   * alternation lands out of phase across the seam.
   */
  parity: number;
}

const PLANS: Record<WallpaperPattern, PatternPlan> = {
  plain: { lattice: 'grid', cell: 1, radius: 0, aspect: 1, radiusFrom: 'min', relief: 0, parity: 1 },
  pinstripe: { lattice: 'grid', cell: 0.5, radius: 0, aspect: 1, radiusFrom: 'min', relief: 0, parity: 1 },
  ticking: { lattice: 'grid', cell: 1.05, radius: 0, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  // Watered silk: the pitch has to be FINE or the interference the whole thing
  // is made of never happens — two waves a centimetre apart are two waves.
  moire: { lattice: 'grid', cell: 0.3, radius: 0, aspect: 1, radiusFrom: 'min', relief: 0, parity: 1 },
  grasscloth: { lattice: 'grid', cell: 0.24, radius: 0, aspect: 1, radiusFrom: 'min', relief: 0, parity: 1 },
  awning: { lattice: 'grid', cell: 1.25, radius: 0, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  beading: { lattice: 'grid', cell: 0.72, radius: 0.5, aspect: 0.85, radiusFrom: 'col', relief: 0.5, parity: 1 },
  stripe: { lattice: 'grid', cell: 1.15, radius: 0, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  chevron: { lattice: 'grid', cell: 1.1, radius: 0, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  // `cell` here is the side of the whole 4a repeat block, not a bar — see
  // `herringboneMarks`, which is where the parquet is actually laid.
  herringbone: { lattice: 'grid', cell: 1.7, radius: 0, aspect: 1, radiusFrom: 'min', relief: 0.35, parity: 1 },
  serpentine: { lattice: 'grid', cell: 1.3, radius: 0, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  flamestitch: { lattice: 'grid', cell: 0.62, radius: 0, aspect: 1, radiusFrom: 'min', relief: 0.5, parity: 1 },
  // A tall narrow cell, measured off the ROW: the cane runs the full height of
  // it, so the pad the emitter wraps on has to be the long side.
  bamboo: { lattice: 'grid', cell: 0.78, radius: 0.5, aspect: 1.7, radiusFrom: 'row', relief: 0.5, parity: 2 },
  rope: { lattice: 'grid', cell: 1.2, radius: 0, aspect: 1, radiusFrom: 'min', relief: 0.5, parity: 1 },
  gingham: { lattice: 'grid', cell: 0.9, radius: 0.5, aspect: 1, radiusFrom: 'min', relief: 0.5, parity: 1 },
  harlequin: { lattice: 'grid', cell: 1.05, radius: 0.5, aspect: 1.4, radiusFrom: 'col', relief: 0.3, parity: 2 },
  // 0.866 and 0.577 are not taste: they are what makes a pointy-top hexagon
  // grid close. Width √3·R across, 1.5·R down.
  honeycomb: { lattice: 'brick', cell: 0.95, radius: 0.577, aspect: 0.866, radiusFrom: 'col', relief: 0.3, parity: 2 },
  tattersall: { lattice: 'grid', cell: 1.1, radius: 0, aspect: 1, radiusFrom: 'min', relief: 0, parity: 1 },
  argyle: { lattice: 'grid', cell: 1.15, radius: 0.5, aspect: 1.5, radiusFrom: 'col', relief: 0.3, parity: 2 },
  // Square cells, and not by taste: the quadrants are drawn once and rotated,
  // so a cell that is not square would shear them.
  pinwheel: { lattice: 'grid', cell: 0.95, radius: 0.5, aspect: 1, radiusFrom: 'col', relief: 0.25, parity: 2 },
  basketweave: { lattice: 'grid', cell: 1, radius: 0.5, aspect: 1, radiusFrom: 'col', relief: 0.3, parity: 2 },
  trellis: { lattice: 'grid', cell: 1, radius: 0.5, aspect: 1, radiusFrom: 'min', relief: 0.6, parity: 1 },
  arch: { lattice: 'grid', cell: 1.05, radius: 0.5, aspect: 1.3, radiusFrom: 'col', relief: 0.4, parity: 1 },
  scallop: { lattice: 'brick', cell: 1, radius: 0.5, aspect: 0.56, radiusFrom: 'col', relief: 0.3, parity: 1 },
  diaper: { lattice: 'grid', cell: 0.95, radius: 0.5, aspect: 1, radiusFrom: 'min', relief: 0.5, parity: 1 },
  fret: { lattice: 'grid', cell: 1.1, radius: 0.5, aspect: 0.62, radiusFrom: 'col', relief: 0.4, parity: 1 },
  quatrefoil: { lattice: 'grid', cell: 1, radius: 0.5, aspect: 1, radiusFrom: 'col', relief: 0.35, parity: 1 },
  ogee: { lattice: 'grid', cell: 1.2, radius: 0.5, aspect: 1.3, radiusFrom: 'col', relief: 0.4, parity: 1 },
  polka: { lattice: 'diamond', cell: 1.15, radius: 0.42, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  star: { lattice: 'diamond', cell: 1.25, radius: 0.46, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  moonstar: { lattice: 'halfdrop', cell: 1.1, radius: 0.46, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  bee: { lattice: 'diamond', cell: 1.2, radius: 0.42, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  fleur: { lattice: 'halfdrop', cell: 1.05, radius: 0.44, aspect: 1.05, radiusFrom: 'min', relief: 1, parity: 1 },
  sunburst: { lattice: 'halfdrop', cell: 1.15, radius: 0.42, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  constellation: { lattice: 'grid', cell: 1.05, radius: 0.4, aspect: 1, radiusFrom: 'min', relief: 0.6, parity: 2 },
  sprig: { lattice: 'halfdrop', cell: 1.05, radius: 0.44, aspect: 1.1, radiusFrom: 'min', relief: 1, parity: 1 },
  laurel: { lattice: 'halfdrop', cell: 1.2, radius: 0.44, aspect: 1, radiusFrom: 'min', relief: 1, parity: 2 },
  pomegranate: { lattice: 'halfdrop', cell: 1.25, radius: 0.44, aspect: 1.15, radiusFrom: 'min', relief: 1, parity: 1 },
  fern: { lattice: 'halfdrop', cell: 1.2, radius: 0.46, aspect: 1.15, radiusFrom: 'min', relief: 1, parity: 2 },
  // A grid rather than a drop, and a cell wider than it is tall: the vine has
  // to meet the vine beside it, and a half-drop would break every joint.
  vine: { lattice: 'grid', cell: 1.3, radius: 0.5, aspect: 0.72, radiusFrom: 'col', relief: 0.8, parity: 2 },
  thistle: { lattice: 'halfdrop', cell: 1.1, radius: 0.44, aspect: 1.1, radiusFrom: 'min', relief: 1, parity: 1 },
  rose: { lattice: 'halfdrop', cell: 1.15, radius: 0.44, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  damask: { lattice: 'halfdrop', cell: 1.5, radius: 0.44, aspect: 1.25, radiusFrom: 'min', relief: 1, parity: 1 },
  urn: { lattice: 'halfdrop', cell: 1.3, radius: 0.44, aspect: 1.15, radiusFrom: 'min', relief: 1, parity: 1 },
  // Both scenics used to nominate a cell so large that one bird filled a
  // 300px patch of wall, which is a poster, not a wallpaper. Halved, and the
  // presets that asked for them at `grand` now ask at `large`.
  bird: { lattice: 'halfdrop', cell: 1.15, radius: 0.44, aspect: 1, radiusFrom: 'min', relief: 1, parity: 2 },
  // Radius, not cell, is what had to come down: in a half-drop the tightest
  // neighbour is the DIAGONAL one at half a cell each way, and a round motif
  // wide enough to look right against its side neighbours ran straight into
  // it. Two cartouches were overlapping their frames.
  toile: { lattice: 'halfdrop', cell: 1.5, radius: 0.34, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  arabesque: { lattice: 'halfdrop', cell: 1.45, radius: 0.44, aspect: 1.15, radiusFrom: 'min', relief: 1, parity: 1 },
  pagoda: { lattice: 'halfdrop', cell: 1.3, radius: 0.44, aspect: 1.1, radiusFrom: 'min', relief: 1, parity: 1 },
  medallion: { lattice: 'halfdrop', cell: 1.25, radius: 0.42, aspect: 1, radiusFrom: 'min', relief: 1, parity: 1 },
  hare: { lattice: 'halfdrop', cell: 1.25, radius: 0.42, aspect: 1, radiusFrom: 'min', relief: 1, parity: 2 },
};

/**
 * How many cells fit across `size`, as an exact integer count.
 *
 * The lattice is fitted to the tile, never the other way round: whatever cell
 * the scale asked for, the one actually drawn is `size / count`, so the repeat
 * closes exactly and the motif merely comes out a few percent off nominal. A
 * lattice that shifts alternate rows or columns needs that count to be even,
 * or the shifted half lands on the unshifted half across the seam.
 */
function fitCount(size: number, cell: number, multiple: number, min = 2): number {
  const raw = Math.max(min, Math.round(size / Math.max(1, cell)));
  const m = Math.max(1, Math.round(multiple));
  if (m === 1) return raw;
  return Math.max(Math.ceil(min / m) * m, Math.ceil(raw / m) * m);
}

const ORIGIN_CELL: CellAt = { col: 0, row: 0, alt: false, w: 0, h: 0 };

/** A motif placed on the lattice, ready to be wrapped by {@link emit}. */
function motifMark(
  cx: number,
  cy: number,
  r: number,
  seed: number,
  relief: number,
  fn: MotifFn,
  at: CellAt = ORIGIN_CELL,
): Mark {
  // Generous: a motif's own paths stay inside r, but leaves, beaks and ink
  // width push past it, and a span that is too small is the one bug in this
  // module that produces a seam. Over-declaring costs an extra draw call.
  // A blotted nib strokes at two and a bit times the crisp weight and a motif
  // that meets its neighbours reaches a full cell, so the slack is generous.
  //
  // The two cell terms are not belt-and-braces. `r` is a fraction of ONE of the
  // fitted pitches, and the motifs added since — a cane running the height of
  // its cell, a vine crossing the width of it, a constellation link that ends
  // on the NEXT cell's centre — reach a whole pitch on an axis `r` was not
  // measured against. A full cell on each axis covers every one of them.
  const pad = Math.max(r * 1.7, at.w, at.h) + relief + 10;
  return {
    spanX: [cx - pad, cx + pad],
    spanY: [cy - pad, cy + pad],
    draw(ctx, pass, c) {
      const off = pass === 'relief' ? relief : 0;
      if (pass === 'relief' && relief <= 0) return;
      ctx.save();
      ctx.translate(cx + off, cy + off);
      fn(ctx, r, seed, pass === 'relief' ? reliefColours(c) : c, at);
      ctx.restore();
    },
  };
}

/**
 * Walk a lattice, handing each cell centre to `place` along with the pitch that
 * was actually fitted (which is never quite the nominal cell).
 */
function lattice(
  size: number,
  plan: PatternPlan,
  nominal: number,
  place: (cx: number, cy: number, index: number, colW: number, rowH: number, at: CellAt) => void,
): void {
  // A half-drop or brick lattice needs an EVEN count on the shifted axis, or
  // the shifted half meets the unshifted half across the seam. Everything else
  // may go down to a single cell, which is what lets a grand toile show one
  // large vignette in a tile rather than four small ones.
  //
  // `parity` piles onto that for the SAME reason one step further in: a motif
  // that reads `col` or `row` to decide which way it faces, or which of two
  // colours it takes, is a pattern with a period of its own, and a count that
  // is not a multiple of that period puts the wrong phase against the seam.
  // The harlequin's two-tone checker and the honeycomb's capped cells both
  // broke there — one gold diamond in the whole wall, in the wrong place.
  const colMul = Math.max(plan.lattice === 'halfdrop' ? 2 : 1, plan.parity);
  const rowMul = Math.max(plan.lattice === 'brick' ? 2 : 1, plan.parity);
  const cols = fitCount(size, nominal * plan.cell, colMul, colMul);
  const rows = fitCount(size, nominal * plan.cell * plan.aspect, rowMul, rowMul);
  const colW = size / cols;
  const rowH = size / rows;

  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dropY = plan.lattice === 'halfdrop' && col % 2 === 1 ? rowH / 2 : 0;
      const dropX = plan.lattice === 'brick' && row % 2 === 1 ? colW / 2 : 0;
      place((col + 0.5) * colW + dropX, (row + 0.5) * rowH + dropY, index++, colW, rowH, {
        col,
        row,
        alt: false,
        w: colW,
        h: rowH,
      });
      if (plan.lattice === 'diamond') {
        // The interstitial half-step, which is what turns a grid of dots into
        // a field of them. Offset index stream so the two populations wobble
        // independently rather than in lockstep.
        place((col + 1) * colW, (row + 1) * rowH, index++ + 0x5000, colW, rowH, {
          col,
          row,
          alt: true,
          w: colW,
          h: rowH,
        });
      }
    }
  }
}

/* ============================ the tile builder =========================== */

/** One parquet block: a rounded bar, filled flat, outlined. */
function barMark(x: number, y: number, w: number, h: number, fill: 'face' | 'bloom', relief: number): Mark {
  const pad = Math.max(w, h) * 0.2 + relief + 8;
  return {
    spanX: [x - pad, x + w + pad],
    spanY: [y - pad, y + h + pad],
    draw(ctx, pass, c) {
      if (pass === 'relief' && relief <= 0) return;
      const off = pass === 'relief' ? relief : 0;
      const weight = motifInk(Math.min(w, h), c) * 0.9;
      roundedRect(ctx, x + off, y + off, w, h, Math.min(w, h) * 0.2 * c.edge.round);
      if (pass === 'relief') {
        ctx.fillStyle = c.relief;
        ctx.fill();
        return;
      }
      ink(ctx, c, weight, fill === 'bloom' ? c.bloom : true);
    },
  };
}

/**
 * A TRUE herringbone, laid rather than scattered.
 *
 * The old one rotated a bar ±45° on a brick lattice and hoped the ends would
 * find the flanks. They did not — the specimen was a heap of sticks with wall
 * showing through every joint, and that heap is most of what the reader meant
 * by "the area that connects different parts looks unnatural".
 *
 * A herringbone of 2a×a blocks is a real tiling with a real period, so this
 * lays it out instead. Taking the horizontal block A = [0,2a]×[0,a] and the
 * vertical block B = [2a,3a]×[0,2a] as a pair, the pattern is that pair
 * translated by the lattice generated by (2a,2a) and (a,−a). That lattice
 * contains (4a,0) and (0,4a), so the whole thing closes exactly on a 4a
 * square — four copies of the pair, eight blocks, covering 16a² with nothing
 * left over and nothing overlapping. Fitting 4a to the tile is then the same
 * move every other lattice here makes.
 *
 * The blocks are inset by a hairline each side, which is the grout: without it
 * two abutting fills anti-alias into a seam of their own.
 */
function herringboneMarks(size: number, unit: number, relief: number): Mark[] {
  const blocks = Math.max(1, Math.round(size / Math.max(1, unit)));
  const a = size / (4 * blocks);
  const grout = Math.max(0.7, a * 0.07);
  const marks: Mark[] = [];
  // The four translations of the pair inside one 4a block, in units of a.
  const steps = [
    [0, 0],
    [1, 3],
    [2, 2],
    [3, 1],
  ] as const;
  for (let bx = 0; bx < blocks; bx++) {
    for (let by = 0; by < blocks; by++) {
      const ox = bx * 4 * a;
      const oy = by * 4 * a;
      for (const [tx, ty] of steps) {
        const x = ox + tx * a;
        const y = oy + ty * a;
        // Horizontal block, then the vertical one standing on its right end.
        marks.push(barMark(x + grout, y + grout, 2 * a - grout * 2, a - grout * 2, 'face', relief));
        marks.push(
          barMark(x + 2 * a + grout, y + grout, a - grout * 2, 2 * a - grout * 2, 'bloom', relief),
        );
      }
    }
  }
  return marks;
}

/**
 * Build the mark list for one tile.
 *
 * Separated from the drawing so a test can count and bound the marks without a
 * canvas, and so the two passes share one list rather than re-deriving it.
 */
function buildMarks(size: number, spec: WallpaperSpec, seed: number, paint: Paint): Mark[] {
  const plan = PLANS[spec.pattern];
  const nominal = SCALE_CELL[spec.scale];
  const relief = Math.min(
    DEPTH_MAX_PX,
    DEPTH_OFFSET[spec.depth] * nominal * plan.cell * plan.relief,
  );
  const feel = paint.edge;
  const marks: Mark[] = [];

  switch (spec.pattern) {
    case 'plain':
      break;

    case 'stripe': {
      // Broad bands with a lazy wave in them, half the pitch wide, and a pair
      // of fine rules in the gap between. A regency stripe is never one band
      // repeated — it is a wide one and a narrow one, and drawing only the
      // wide one is why the first specimen read as corduroy.
      const n = fitCount(size, nominal * plan.cell, 1);
      const pitch = size / n;
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        // The wave used to be nearly twice this and the bands looked drunk
        // rather than drawn. A hand-drawn line wavers; it does not stagger.
        const wave = periodic(size, pitch * 0.028 * feel.wobble, 1, i * 1.7);
        marks.push(
          runningBand(
            size,
            'y',
            centre,
            pitch * 0.27,
            wave,
            Math.max(0.9, pitch * 0.05 * feel.weight),
            relief,
          ),
        );
        for (const off of [-0.42, 0.42] as const) {
          marks.push(
            runningLine(
              size,
              'y',
              centre + pitch * off,
              wave,
              Math.max(0.8, pitch * 0.022 * feel.weight),
              thread,
            ),
          );
        }
      }
      break;
    }

    case 'pinstripe': {
      // A hairline every pitch, with a second, fainter one between — the
      // difference between "pinstripe" and "narrow stripe".
      const n = fitCount(size, nominal * plan.cell, 1, 4);
      const pitch = size / n;
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        const w = Math.max(0.9, pitch * 0.075 * feel.weight);
        marks.push(
          runningLine(
            size,
            'y',
            centre,
            periodic(size, pitch * 0.04 * feel.wobble, 1, i * 2.3),
            w,
            (c) => c.ink,
          ),
        );
        // The ghost between used to be drawn in the FACE colour, which on a
        // pale paper is the wall with a rounding error — half the pinstripe
        // was invisible. The detail colour is a real second rule.
        marks.push(
          runningLine(
            size,
            'y',
            centre + pitch * 0.5,
            periodic(size, pitch * 0.032 * feel.wobble, 1, i * 1.1 + 0.9),
            w * 0.75,
            thread,
          ),
        );
      }
      break;
    }

    case 'ticking': {
      // Mattress ticking: a solid band flanked by a thin twin.
      const n = fitCount(size, nominal * plan.cell, 1);
      const pitch = size / n;
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        const wave = periodic(size, pitch * 0.03 * feel.wobble, 1, i * 0.9);
        marks.push(
          runningBand(
            size,
            'y',
            centre,
            pitch * 0.17,
            wave,
            Math.max(0.8, pitch * 0.04 * feel.weight),
            relief,
          ),
        );
        // The twins are INK, not face: mattress ticking is a broad band with a
        // hairline either side of it, and a face-coloured twin on a
        // face-coloured band is nothing at all.
        for (const off of [-0.3, 0.3] as const) {
          marks.push(
            runningLine(
              size,
              'y',
              centre + pitch * off,
              wave,
              Math.max(0.8, pitch * 0.035 * feel.weight),
              (c) => c.ink,
            ),
          );
        }
        // A hair of the detail colour down the centre of the broad band, which
        // is the woven thread real mattress ticking has.
        marks.push(
          runningLine(
            size,
            'y',
            centre,
            wave,
            Math.max(0.7, pitch * 0.022 * feel.weight),
            thread,
          ),
        );
      }
      break;
    }

    case 'gingham': {
      // Warp, weft, then the deeper squares where they cross.
      const n = fitCount(size, nominal * plan.cell, 1);
      const pitch = size / n;
      const half = pitch * 0.26;
      // One shared wave per axis, so the crossing squares can be displaced by
      // exactly the same amount the two bands are and land back on the
      // intersection. A gingham whose checks slid off its stripes would read as
      // a rendering fault rather than as a hand-drawn check.
      const warp = periodic(size, pitch * 0.035, 1, 0.6);
      const weft = periodic(size, pitch * 0.035, 1, 2.1);
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        marks.push(runningBand(size, 'y', centre, half, warp, 0, relief));
        marks.push(runningBand(size, 'x', centre, half, weft, 0, relief));
      }
      for (let r = 0; r < n; r++) {
        for (let col = 0; col < n; col++) {
          const cx = (col + 0.5) * pitch;
          const cy = (r + 0.5) * pitch;
          marks.push(motifMark(cx + warp(cy), cy + weft(cx), half, 0, 0, ginghamCross));
        }
      }
      break;
    }

    case 'chevron': {
      const rows = fitCount(size, nominal * plan.cell, 1);
      const teeth = fitCount(size, nominal * plan.cell * 1.1, 1);
      const rowH = size / rows;
      for (let i = 0; i < rows; i++) {
        // Half-width is a little under half the row pitch, so a hair of wall
        // shows between the ribbons; at exactly half they merge into a field
        // and the zigzag stops reading as a tape.
        marks.push(
          zigzagBand(
            size,
            (i + 0.5) * rowH,
            rowH * 0.24,
            teeth,
            rowH * 0.2,
            0,
            Math.max(0.9, rowH * 0.05 * feel.weight),
            relief,
          ),
        );
      }
      break;
    }

    case 'herringbone':
      marks.push(...herringboneMarks(size, nominal * plan.cell, relief));
      break;

    case 'moire': {
      // Watered silk. Nothing here is a moire on its own: it is a dense comb
      // of hairlines whose wave amplitude is nearly the pitch, so the lines
      // bunch where their phases agree and open where they do not, and the
      // interference draws bands the marks themselves never contain.
      //
      // The phase drift is irrational-ish on purpose. A drift that divides the
      // count puts the same bunching in the same place every few lines and the
      // wall gets a visible vertical rhythm instead of a watered one.
      //
      // The comb PITCH is capped, and that cap is the whole difference between
      // silk and chain-link fencing. The interference only exists while the
      // eye averages the crossings; past about a dozen pixels each hairline is
      // an object in its own right, the crossings become knots, and a medium
      // moire came out as a diagonal net of cords — which is exactly what the
      // wall looked like before this line existed. So `scale` moves the size of
      // the WATERING (how many swells run down the tile) and never the comb.
      const pitchWanted = Math.max(6, Math.min(MOIRE_PITCH_MAX, nominal * plan.cell));
      const n = fitCount(size, pitchWanted, 1, 8);
      const pitch = size / n;
      const swell = MOIRE_SWELLS[spec.scale];
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        marks.push(
          runningLine(
            size,
            'y',
            centre,
            periodic(size, pitch * 0.78 * feel.wobble, swell, i * 0.618 * Math.PI),
            Math.max(0.85, pitch * 0.12 * feel.weight),
            (c) => c.ink,
          ),
        );
        marks.push(
          runningLine(
            size,
            'y',
            centre + pitch * 0.5,
            periodic(size, pitch * 0.62 * feel.wobble, swell + 1, i * 0.382 * Math.PI + 1.1),
            Math.max(0.75, pitch * 0.08 * feel.weight),
            thread,
          ),
        );
      }
      break;
    }

    case 'grasscloth': {
      // A woven natural paper: fine horizontal fibres, unevenly weighted, with
      // a heavier slub every few rows. The unevenness comes off the ROW index,
      // which the fitted count makes exact — there is nothing to close across
      // the seam because each fibre is its own mark at its own height.
      const n = fitCount(size, nominal * plan.cell, 1, 16);
      const pitch = size / n;
      for (let i = 0; i < n; i++) {
        const y = (i + 0.5) * pitch;
        const heavy = i % 9 === 4;
        const j = Math.abs(jitter(i * 13 + 5));
        marks.push(
          runningLine(
            size,
            'x',
            y,
            periodic(size, pitch * (0.12 + j * 0.26) * feel.wobble, 2 + (i % 3), i * 1.7),
            Math.max(0.75, pitch * (heavy ? 0.5 : 0.2 + j * 0.2) * feel.weight),
            heavy || i % 3 === 1 ? (c) => c.ink : thread,
          ),
        );
      }
      // A handful of vertical warps, far apart and faint. Enough that the
      // paper reads as WOVEN rather than as ruled, and no more: at full
      // strength they turn a grasscloth into a windowpane check.
      const warps = fitCount(size, nominal * plan.cell * 11, 1, 2);
      const wp = size / warps;
      for (let i = 0; i < warps; i++) {
        marks.push(
          runningLine(
            size,
            'y',
            (i + 0.5) * wp,
            periodic(size, pitch * 0.7, 1, i * 2.1),
            Math.max(0.8, pitch * 0.34 * feel.weight),
            (c) => mix(c.face, c.ground, 0.35),
          ),
        );
      }
      break;
    }

    case 'awning': {
      // Broad horizontal banding, with a narrow band of the detail colour
      // riding inside it — three colours across, which is what a real awning
      // has and what keeps this from being the vertical stripe rotated.
      const n = fitCount(size, nominal * plan.cell, 1);
      const pitch = size / n;
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        const wave = periodic(size, pitch * 0.02 * feel.wobble, 1, i * 1.3);
        marks.push(
          runningBand(
            size,
            'x',
            centre,
            pitch * 0.3,
            wave,
            Math.max(0.9, pitch * 0.045 * feel.weight),
            relief,
          ),
        );
        marks.push(
          runningBand(size, 'x', centre, pitch * 0.09, wave, 0, 0, (c) => c.accent),
        );
        marks.push(
          runningLine(
            size,
            'x',
            centre + pitch * 0.5,
            wave,
            Math.max(0.8, pitch * 0.028 * feel.weight),
            thread,
          ),
        );
      }
      break;
    }

    case 'serpentine': {
      // The undulating stripe. Amplitude near half the pitch, so the ribbons
      // swing right past one another's rest line and the wall reads as water
      // rather than as a stripe with a wobble in it.
      const n = fitCount(size, nominal * plan.cell, 1);
      const pitch = size / n;
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        const wave = periodic(size, pitch * 0.42, 2, i * Math.PI * 0.5);
        marks.push(
          runningBand(
            size,
            'y',
            centre,
            pitch * 0.19,
            wave,
            Math.max(0.9, pitch * 0.05 * feel.weight),
            relief,
          ),
        );
        marks.push(
          runningLine(size, 'y', centre, wave, Math.max(0.8, pitch * 0.03 * feel.weight), thread),
        );
      }
      break;
    }

    case 'flamestitch': {
      // Bargello. Rows of tall zigzag packed edge to edge in three graded
      // faces, which is what makes a flame stitch a flame rather than a
      // chevron: the eye reads the colour run up the peak, not the tape.
      //
      // The row count is fitted to a MULTIPLE OF THREE for the same reason
      // `parity` exists on the lattice — a colour cycle whose period does not
      // divide the count puts the wrong band against the seam.
      const rows = fitCount(size, nominal * plan.cell, 3, 6);
      const teeth = fitCount(size, nominal * plan.cell * 0.9, 1, 4);
      const rowH = size / rows;
      const amp = rowH * 0.92;
      // The half-width is SOLVED, not chosen. `zigzagBand` measures its edges
      // perpendicular to the run, so a band of half-width h occupies
      // `h·√(1+slope²)` vertically — and at the slope a flame stitch needs
      // that is nearly three times h. Picking h by eye leaves the rows either
      // overlapping into one colour or stranded on bare paper; solving it for
      // "one row pitch, plus a hair" makes the field close at any tile size.
      const slope = (4 * amp) / (size / teeth);
      const half = (rowH / 2 + 0.4) / Math.hypot(1, slope);
      const shades: readonly ((c: Paint) => string)[] = [
        (c) => c.face,
        (c) => c.bloom,
        (c) => mix(c.face, c.accent, 0.62),
      ];
      for (let i = 0; i < rows; i++) {
        marks.push(
          zigzagBand(
            size,
            (i + 0.5) * rowH,
            amp,
            teeth,
            half,
            0,
            Math.max(0.8, rowH * 0.05 * feel.weight),
            i % 3 === 0 ? relief : 0,
            { fill: shades[i % 3]!, braid: false },
          ),
        );
      }
      break;
    }

    case 'rope': {
      // A guilloche: two strands per column, the same wave a half period
      // apart, so they cross at fixed points and read as a twist. Both are
      // periodic in the run, which is the only reason a mark with no ends can
      // cross the tile edge at all.
      const n = fitCount(size, nominal * plan.cell, 1);
      const pitch = size / n;
      const turns = Math.max(2, Math.round(size / (pitch * 1.6)));
      const cordW = Math.max(1.6, pitch * 0.14 * feel.weight);
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        for (const phase of [0, Math.PI] as const) {
          const wave = periodic(size, pitch * 0.26, turns, phase);
          marks.push(runningLine(size, 'y', centre, wave, cordW * 1.9, (c) => c.ink));
          marks.push(runningLine(size, 'y', centre, wave, cordW, (c) => c.face));
        }
        // The knots, where the two strands cross — at the zeroes of the wave,
        // which land on exact multiples of the tile over twice the turn count.
        const knots = turns * 2;
        for (let j = 0; j < knots; j++) {
          marks.push(
            motifMark(centre, (j * size) / knots, pitch * 0.16, j, 0, (ctx, rr, _s, c) => {
              pip(ctx, 0, 0, rr * 0.62, c.accent, c, motifInk(rr, c) * 0.7);
            }),
          );
        }
      }
      break;
    }

    case 'tattersall': {
      // An overcheck of LINES rather than of bands — two colours crossing on
      // bare paper, which is the whole difference between this and the gingham
      // two cards along in the picker.
      const n = fitCount(size, nominal * plan.cell, 1, 3);
      const pitch = size / n;
      const heavy = Math.max(0.9, pitch * 0.045 * feel.weight);
      const light = Math.max(0.8, pitch * 0.03 * feel.weight);
      for (const axis of ['y', 'x'] as const) {
        for (let i = 0; i < n; i++) {
          const centre = (i + 0.5) * pitch;
          const wave = periodic(size, pitch * 0.018 * feel.wobble, 1, i * 1.9 + (axis === 'x' ? 0.7 : 0));
          marks.push(runningLine(size, axis, centre, wave, heavy, (c) => c.ink));
          // The second colour, as a close pair — a tattersall's overcheck is
          // always a pair, and a single line makes it a windowpane check.
          for (const off of [-0.44, -0.38] as const) {
            marks.push(runningLine(size, axis, centre + pitch * off, wave, light, thread));
          }
        }
      }
      break;
    }

    default: {
      // Everything else is a motif on a lattice.
      const fn = MOTIFS[spec.pattern];
      if (fn === undefined) break;
      // `colW`/`rowH` are only known once the lattice has been fitted, so the
      // radius is resolved inside the walk rather than up front.
      lattice(size, plan, nominal, (cx, cy, index, colW, rowH, at) => {
        const pitch =
          plan.radiusFrom === 'col' ? colW : plan.radiusFrom === 'row' ? rowH : Math.min(colW, rowH);
        // Math.imul: the plain product overflows the float mantissa and the
        // mixing degrades to whatever survived the rounding.
        const s = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
        marks.push(motifMark(cx, cy, pitch * plan.radius, s, relief, fn, at));
      });
      break;
    }
  }

  return marks;
}

/* ============================== the exports ============================== */

/**
 * Draw one wallpaper tile into `ctx`, filling `[0, size] × [0, size]`.
 *
 * `size` may be anything: the lattice is fitted to it. What the caller must
 * NOT do is draw the tile at a size other than the one it was rendered at and
 * expect it to still tile — the repeat closes at `size`, not at a multiple of
 * the cell.
 *
 * The context is clipped to the tile for the duration, so a caller may hand in
 * a bigger canvas (an atlas slot, a preview card) without the wrapped copies
 * leaking out of their box.
 */
export function renderWallpaperTile(ctx: FlatCtx, size: number, spec: WallpaperSpec): void {
  if (!(size > 0)) return;
  const c: Paint = { ...wallpaperColours(spec), edge: edgeFeel(spec) };
  const seed = fnv1a(wallpaperAxisKey(spec));

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();

  ctx.fillStyle = c.ground;
  ctx.fillRect(0, 0, size, size);

  const marks = buildMarks(size, spec, seed, c);
  emit(ctx, size, marks, 'relief', c);
  emit(ctx, size, marks, 'face', c);

  ctx.restore();
}

/**
 * A sensible pixel size for a baked tile of this spec.
 *
 * Two competing wants: enough cells that the eye cannot latch onto the repeat,
 * and a texture small enough to be worth caching. Aim for a tile around 320
 * CSS px, and — the part that matters — make it a WHOLE NUMBER OF CELLS.
 *
 * A tile 1.45 cells wide is not merely 45% wasteful: `fitCount` rounds it to
 * one cell and stretches that cell to the full tile. A grand toile asked for at
 * 640px came out as a single vignette floating over a band of empty wall,
 * because 640 ÷ 353 rounds down. Sizing the tile FROM the cell instead of
 * clamping it afterwards removes the whole class of that bug.
 */
const TILE_TARGET_PX = 320;
const TILE_MAX_PX = 768;

export function wallpaperTilePx(spec: WallpaperSpec, dpr = 1): number {
  const plan = PLANS[spec.pattern];
  const cell = SCALE_CELL[spec.scale] * plan.cell;
  // Half-drop and brick need two cells to show their offset at all.
  const min = plan.lattice === 'halfdrop' || plan.lattice === 'brick' ? 2 : 1;
  const repeats = Math.max(min, Math.round(TILE_TARGET_PX / Math.max(1, cell)));
  const css = Math.min(TILE_MAX_PX, Math.max(96, Math.round(cell * repeats)));
  return Math.round(css * Math.max(1, dpr));
}

/**
 * The revision of the DRAWING itself. Bump it when a motif's geometry changes.
 *
 * The axes were never the only way a tile's pixels move, and this is the hole
 * that left. `world.ts` bakes through `bakeCached(wallpaperTileKey(…))` onto
 * disk, and the disk cache validates NOTHING about a hit — so redrawing a motif
 * while leaving every axis alone means every machine that has already seen that
 * paper keeps the old art forever. Caught the honest way: the moire was fixed,
 * the tests passed, the specimen board showed watered silk, and the running app
 * carried on painting the chain-link fence it had baked an hour earlier.
 *
 * It rides on the TILE key and deliberately not on `wallpaperAxisKey`, which
 * answers a different question — "is the reader looking at a different paper" —
 * and is compared against stored specs by `world.ts`, `LibraryStudio` and
 * `matchRoomPreset`. A revision in there would make every saved room stop
 * matching the preset it was chosen from.
 *
 * Revisions:
 *  2 — moire pinned to a hairline comb (it read as chain-link past `small`);
 *      bamboo's single narrow blade became a three-leaf spray (it read as a
 *      pencil); bead-and-reel's rod fattened (it read as a hanging chain).
 *  3 — the moire's comb taken finer still. 12px was fine enough on a specimen
 *      board at 0.6 and not on the real wall at 0.8, which is the whole reason
 *      a paper gets judged in the running app and not only on a board.
 */
const WALLPAPER_ART_REV = 3;

/**
 * Cache key for a rendered tile.
 *
 * Carries `flatSchemeTag()` because every colour in the tile is derived from
 * the live scheme — without it the disk cache would serve the athenaeum's
 * damask forever after the reader moved to the reef, which is the exact bug the
 * cover memo had. And {@link WALLPAPER_ART_REV}, because a redrawn motif is the
 * same class of change with none of the same warning signs.
 */
export function wallpaperTileKey(spec: WallpaperSpec, size: number, dpr = 1): string {
  // Every axis, through `wallpaperAxisKey`, so a new one cannot be added
  // without entering the key — a tone that is not in the key is a tone the
  // disk cache overwrites with whatever it baked first. Plus the revision of
  // the DRAWING, which is the other way the same pixels change.
  return `wall|r${WALLPAPER_ART_REV}|${flatSchemeTag()}|${wallpaperAxisKey(spec)}|${Math.round(size)}|${dpr}`;
}

/* ============================== the presets ============================== */

/**
 * The mood words a paper answers to.
 *
 * A closed vocabulary, and typed, because the point of them is to STEER a
 * random roll (`withMood` in `views/rail/designOptions.ts`): a tag only one
 * paper carries narrows the dice to a single answer, which is a preset with
 * extra steps, and a typo makes a tag exactly that. Twelve words, each on
 * roughly six to fifteen papers.
 */
export const WALLPAPER_MOODS = [
  'quiet',
  'bold',
  'warm',
  'cool',
  'grand',
  'cosy',
  'playful',
  'formal',
  'gilded',
  'nocturnal',
  'antique',
  'fresh',
] as const;
export type WallpaperMood = (typeof WALLPAPER_MOODS)[number];

/** A named wallpaper, as offered in the picker. */
export interface WallpaperPreset {
  id: string;
  name: string;
  /** One line for the picker card. */
  blurb: string;
  /** Which section of the book this paper is printed in. */
  family: WallpaperFamily;
  /**
   * Where in that section it is printed, and whether the dice may hand it out.
   * See {@link WALLPAPER_TIERS}. Required, so a new paper cannot be added
   * without somebody having looked at it on a wall.
   */
  tier: WallpaperTier;
  /** Mood words, for filtering and for steering the dice. */
  tags: readonly WallpaperMood[];
  spec: WallpaperSpec;
}

/**
 * One paper.
 *
 * `tier` is LAST and required rather than defaulted, and that is the whole
 * mechanism behind the ranking: a default would let a new paper join the book
 * without anyone deciding whether it belongs at the front of its section or at
 * the back, and "which tier is this in" is exactly the question that stops the
 * book drifting back into a list.
 */
function paper(
  id: string,
  name: string,
  blurb: string,
  spec: WallpaperSpec,
  tags: readonly WallpaperMood[],
  tier: WallpaperTier,
): WallpaperPreset {
  return { id, name, blurb, family: PATTERN_FAMILY[spec.pattern], tier, tags, spec };
}

/**
 * The book of papers, AS AUTHORED.
 *
 * Composed rather than enumerated: fifty motifs across five scales, four
 * reliefs, six ink slots, fifty tones and four nibs is three hundred thousand
 * combinations, and the job of a preset list is to be the hundred-odd that are
 * actually worth hanging.
 *
 * Written by FAMILY, EIGHTEEN each, quiet → loud inside each — which is how a
 * person composes a section and NOT the order the picker shows. The shelf order
 * is derived from the `tier` on each entry by {@link WALLPAPER_PRESETS} below,
 * so ranking a paper is an edit to that paper rather than a move within this
 * array. A hand-sorted list is one somebody re-sorts by accident.
 *
 * The balance is the point: an earlier book was built motif by motif and ended
 * up twelve geometrics against five scenics, so the picker's geometry section
 * scrolled while its scenic section fitted on one row.
 *
 * Five constraints hold across the whole list, all tested:
 *  - no two papers agree on all four of pattern/scale/depth/ink, because a
 *    consumer that has not moved to `wallpaperAxisKey` would fail to notice
 *    the swap and would keep the old wall on screen;
 *  - no motif is hung more than three times, or a family turns into one motif
 *    recoloured;
 *  - every value of every axis is reachable from some paper — a tone or a nib
 *    the book never asks for is drawing code nobody will ever see;
 *  - every mood word lands on at least ten papers, or steering the dice with
 *    it is just a preset with extra steps;
 *  - every family leads with at least four `front` papers, and no more than a
 *    quarter of the book is at the `back` — a demotion is a demotion, not a
 *    quiet deletion.
 *
 * `plain` is the one motif deliberately hung ONCE. It draws no marks at all, so
 * a second plain paper would be the same wall under a different name however
 * its other axes were set.
 */
const WALLPAPER_BOOK: readonly WallpaperPreset[] = [
  /* ------------------------------- ruled -------------------------------- */
  paper('plain-parchment', 'Plain Parchment', 'The wall, and nothing on it.',
    { pattern: 'plain', scale: 'medium', depth: 'flat', ink: 'paper' }, ['quiet', 'warm'], 'front'),
  paper('pin-quiet', 'Quiet Pinstripe', 'A hairline every inch, and a paler one between.',
    { pattern: 'pinstripe', scale: 'petite', depth: 'flat', ink: 'paper', tone: 'gilt', edge: 'etched' }, ['quiet', 'formal'], 'front'),
  paper('pin-study', 'Study Pinstripe', 'Close-ruled in the case timber.',
    { pattern: 'pinstripe', scale: 'petite', depth: 'flat', ink: 'timber', tone: 'ember' }, ['quiet', 'warm', 'formal'], 'front'),
  paper('pin-wide', 'Drawing Room Rule', 'Wider ruling, with a blue thread between.',
    { pattern: 'pinstripe', scale: 'small', depth: 'flat', ink: 'deep', tone: 'sea' }, ['formal', 'cool'], 'book'),
  paper('moire-watered', 'Watered Silk', 'A comb of hairlines that interfere into bands.',
    { pattern: 'moire', scale: 'small', depth: 'flat', ink: 'deep', tone: 'soot', edge: 'etched' }, ['quiet', 'formal', 'nocturnal'], 'front'),
  paper('moire-tabby', 'Tabby Moire', 'The same watering, warmed and widened.',
    { pattern: 'moire', scale: 'medium', depth: 'flat', ink: 'timber', tone: 'cocoa' }, ['warm', 'antique', 'quiet'], 'book'),
  paper('moire-midnight', 'Midnight Moire', 'Broad watering, drawn in the recess colour.',
    { pattern: 'moire', scale: 'large', depth: 'flat', ink: 'recess', tone: 'mist' }, ['nocturnal', 'cool', 'grand'], 'book'),
  paper('grass-reed', 'Reed Cloth', 'Fine fibres, close-woven, a slub every ninth.',
    { pattern: 'grasscloth', scale: 'small', depth: 'flat', ink: 'recess', tone: 'olive', edge: 'etched' }, ['quiet', 'fresh', 'cool'], 'front'),
  paper('grass-sisal', 'Sisal Grasscloth', 'A woven natural paper in the case timber.',
    { pattern: 'grasscloth', scale: 'medium', depth: 'flat', ink: 'timber', tone: 'straw' }, ['warm', 'quiet', 'cosy'], 'book'),
  paper('grass-arrow', 'Arrowroot', 'The coarsest weave, pale and dry.',
    { pattern: 'grasscloth', scale: 'large', depth: 'flat', ink: 'paper', tone: 'linen' }, ['quiet', 'cosy', 'warm'], 'back'),
  paper('ticking-mattress', 'Mattress Ticking', 'A solid band flanked by its thin twin.',
    { pattern: 'ticking', scale: 'small', depth: 'flat', ink: 'deep', tone: 'ink' }, ['quiet', 'antique'], 'front'),
  paper('ticking-linen', 'Linen Ticking', 'Ticking in pale timber, chalk-threaded.',
    { pattern: 'ticking', scale: 'medium', depth: 'low', ink: 'timber', tone: 'chalk' }, ['warm', 'cosy'], 'book'),
  paper('ticking-cloth', 'Bindery Ticking', 'Ticking taken from the book cloth.',
    { pattern: 'ticking', scale: 'medium', depth: 'flat', ink: 'cloth', tone: 'berry' }, ['bold', 'warm'], 'back'),
  paper('bead-reel', 'Bead and Reel', 'The moulding, run in columns down the wall.',
    { pattern: 'beading', scale: 'small', depth: 'low', ink: 'paper', tone: 'pearl' }, ['formal', 'quiet', 'antique'], 'book'),
  paper('bead-gilt', 'Gilt Beading', 'The same rod and bead, in gold leaf.',
    { pattern: 'beading', scale: 'medium', depth: 'raised', ink: 'gilt' }, ['gilded', 'formal', 'grand'], 'book'),
  paper('awning-tearoom', 'Tea Room Awning', 'Sun-faded banding, blotted at the edge.',
    { pattern: 'awning', scale: 'small', depth: 'flat', ink: 'timber', tone: 'coral', edge: 'blotted' }, ['warm', 'cosy'], 'book'),
  paper('awning-deck', 'Deck Awning', 'Horizontal bands with a sky thread inside.',
    { pattern: 'awning', scale: 'medium', depth: 'low', ink: 'deep', tone: 'sky' }, ['fresh', 'cool'], 'front'),
  paper('awning-marquee', 'Marquee Stripe', 'Fairground banding in the book cloth.',
    { pattern: 'awning', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'chalk' }, ['bold', 'playful'], 'book'),

  /* ------------------------------- stripe ------------------------------- */
  paper('stripe-regency', 'Regency Stripe', 'A broad band, and a gilt rule either side.',
    { pattern: 'stripe', scale: 'medium', depth: 'low', ink: 'paper', tone: 'gilt' }, ['formal', 'quiet', 'gilded'], 'front'),
  paper('stripe-tea', 'Tea Room Stripe', 'Warm timber bands, gently raised.',
    { pattern: 'stripe', scale: 'medium', depth: 'raised', ink: 'timber', tone: 'ember' }, ['warm', 'cosy'], 'front'),
  paper('stripe-hall', 'Long Hall Stripe', 'Grand bands for a tall wall.',
    { pattern: 'stripe', scale: 'grand', depth: 'raised', ink: 'recess', tone: 'chalk' }, ['grand', 'formal'], 'front'),
  paper('serp-ripple', 'Ripple Stripe', 'A stripe that will not hold still.',
    { pattern: 'serpentine', scale: 'small', depth: 'flat', ink: 'paper', tone: 'sky', edge: 'soft' }, ['quiet', 'fresh', 'cool'], 'book'),
  paper('serp-current', 'Current', 'Undulating bands in the binding colour.',
    { pattern: 'serpentine', scale: 'medium', depth: 'low', ink: 'cloth', tone: 'teal' }, ['cool', 'bold'], 'back'),
  paper('serp-lagoon', 'Lagoon', 'Deep water, standing off the plaster.',
    { pattern: 'serpentine', scale: 'large', depth: 'raised', ink: 'deep', tone: 'verdigris' }, ['cool', 'grand', 'nocturnal'], 'back'),
  paper('chevron-zig', 'Chevron', 'Rows of tidy zigzag, braided down the middle.',
    { pattern: 'chevron', scale: 'small', depth: 'flat', ink: 'deep', tone: 'sea' }, ['cool', 'playful'], 'front'),
  paper('chevron-cadet', 'Cadet Chevron', 'Zigzag in the recess colour, denim-braided.',
    { pattern: 'chevron', scale: 'medium', depth: 'low', ink: 'recess', tone: 'denim' }, ['cool', 'formal'], 'book'),
  paper('chevron-bold', 'Bold Chevron', 'The same zigzag, three times the size.',
    { pattern: 'chevron', scale: 'large', depth: 'flat', ink: 'cloth', tone: 'chalk' }, ['bold', 'playful'], 'book'),
  paper('herring-tweed', 'Tweed Herringbone', 'A fine weave, close to the eye.',
    { pattern: 'herringbone', scale: 'petite', depth: 'flat', ink: 'recess', tone: 'bay', edge: 'etched' }, ['cool', 'formal'], 'front'),
  paper('herring-parquet', 'Parquet Herringbone', 'The floor pattern, laid on the wall.',
    { pattern: 'herringbone', scale: 'small', depth: 'low', ink: 'timber', tone: 'ember' }, ['warm', 'antique'], 'book'),
  paper('herring-slate', 'Slate Herringbone', 'A cool parquet, laid large.',
    { pattern: 'herringbone', scale: 'medium', depth: 'raised', ink: 'deep', tone: 'smoke' }, ['cool', 'grand', 'formal'], 'book'),
  paper('bamboo-grove', 'Bamboo Grove', 'Canes and nodes, a leaf pair at every joint.',
    { pattern: 'bamboo', scale: 'medium', depth: 'low', ink: 'paper', tone: 'jade' }, ['fresh', 'quiet', 'cosy'], 'book'),
  paper('bamboo-lacquer', 'Lacquer Cane', 'The grove in gold on a cloth ground.',
    { pattern: 'bamboo', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'gilt' }, ['gilded', 'bold', 'grand'], 'book'),
  paper('rope-guilloche', 'Guilloche', 'Two strands twisting, knotted where they cross.',
    { pattern: 'rope', scale: 'medium', depth: 'low', ink: 'gilt' }, ['gilded', 'formal'], 'front'),
  paper('rope-cable', 'Cable Twist', 'A heavier rope, knotted in copper.',
    { pattern: 'rope', scale: 'large', depth: 'raised', ink: 'timber', tone: 'copper' }, ['warm', 'grand', 'bold'], 'back'),
  paper('flame-bargello', 'Bargello', 'Rows of flame stitch in three graded faces.',
    { pattern: 'flamestitch', scale: 'medium', depth: 'low', ink: 'cloth', tone: 'rust' }, ['bold', 'warm', 'antique'], 'book'),
  paper('flame-florentine', 'Florentine Flame', 'The needlework, at full size.',
    { pattern: 'flamestitch', scale: 'large', depth: 'raised', ink: 'recess', tone: 'wine' }, ['grand', 'bold', 'antique'], 'back'),

  /* -------------------------------- check ------------------------------- */
  paper('tatter-shirting', 'Shirting Tattersall', 'Two crossing rules on bare paper.',
    { pattern: 'tattersall', scale: 'small', depth: 'flat', ink: 'paper', tone: 'slate', edge: 'etched' }, ['quiet', 'formal', 'cool'], 'front'),
  paper('tatter-country', 'Country Tattersall', 'The overcheck warmed to brick.',
    { pattern: 'tattersall', scale: 'medium', depth: 'flat', ink: 'timber', tone: 'brick' }, ['warm', 'cosy'], 'front'),
  paper('tatter-windowpane', 'Windowpane', 'A wide check, drawn once and left alone.',
    { pattern: 'tattersall', scale: 'large', depth: 'flat', ink: 'deep', tone: 'moss' }, ['quiet', 'fresh', 'formal'], 'book'),
  paper('gingham-kitchen', 'Kitchen Gingham', 'Warp, weft, and the darker square between.',
    { pattern: 'gingham', scale: 'small', depth: 'flat', ink: 'paper', tone: 'ember' }, ['cosy', 'fresh'], 'front'),
  paper('gingham-picnic', 'Picnic Check', 'A bolder check in book cloth.',
    { pattern: 'gingham', scale: 'medium', depth: 'flat', ink: 'cloth', tone: 'chalk' }, ['playful', 'bold', 'warm'], 'book'),
  paper('gingham-shadow', 'Shadow Check', 'Deep check, deeply set.',
    { pattern: 'gingham', scale: 'medium', depth: 'raised', ink: 'recess', tone: 'sea' }, ['cool', 'quiet'], 'book'),
  paper('pinwheel-nursery', 'Pinwheel', 'Four quadrants turning, and turning back.',
    { pattern: 'pinwheel', scale: 'small', depth: 'flat', ink: 'paper', tone: 'coral' }, ['playful', 'fresh'], 'book'),
  paper('pinwheel-quilt', 'Quilt Block', 'The same block in book cloth, chalk-lined.',
    { pattern: 'pinwheel', scale: 'medium', depth: 'low', ink: 'cloth', tone: 'chalk' }, ['cosy', 'playful', 'warm'], 'back'),
  paper('basket-rush', 'Rush Basketweave', 'Slats over and under, three at a time.',
    { pattern: 'basketweave', scale: 'medium', depth: 'low', ink: 'timber', tone: 'straw' }, ['warm', 'quiet', 'cosy'], 'back'),
  paper('basket-parquet', 'Basket Parquet', 'The weave laid large, in walnut.',
    { pattern: 'basketweave', scale: 'large', depth: 'raised', ink: 'recess', tone: 'walnut' }, ['grand', 'warm', 'formal'], 'back'),
  paper('argyle-lambswool', 'Lambswool Argyle', 'Knitted lozenges with a dashed overcheck.',
    { pattern: 'argyle', scale: 'medium', depth: 'low', ink: 'timber', tone: 'clay' }, ['cosy', 'warm'], 'front'),
  paper('argyle-links', 'Links Argyle', 'The golf sock, at wall scale.',
    { pattern: 'argyle', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'bay' }, ['playful', 'bold'], 'book'),
  paper('honey-comb', 'Honeycomb', 'Hexagons, and honey in one cell of five.',
    { pattern: 'honeycomb', scale: 'small', depth: 'flat', ink: 'gilt' }, ['gilded', 'warm'], 'book'),
  paper('honey-apiary', 'Apiary', 'A deeper comb, capped with honey.',
    { pattern: 'honeycomb', scale: 'medium', depth: 'raised', ink: 'deep', tone: 'honey' }, ['warm', 'gilded', 'cosy'], 'book'),
  paper('honey-grand', 'Grand Honeycomb', 'One big comb for a big room.',
    { pattern: 'honeycomb', scale: 'large', depth: 'low', ink: 'timber', tone: 'ember' }, ['bold', 'warm'], 'back'),
  paper('harlequin-pierrot', 'Pierrot', 'Small lozenges, two tones, a heather pip.',
    { pattern: 'harlequin', scale: 'small', depth: 'flat', ink: 'deep', tone: 'heather' }, ['playful', 'cool'], 'front'),
  paper('harlequin-carnival', 'Carnival Harlequin', 'Big two-tone lozenges, edge to edge.',
    { pattern: 'harlequin', scale: 'medium', depth: 'flat', ink: 'cloth', tone: 'chalk' }, ['playful', 'bold'], 'book'),
  paper('harlequin-court', 'Court Harlequin', 'The same diamonds, gilded and grave.',
    { pattern: 'harlequin', scale: 'large', depth: 'low', ink: 'recess', tone: 'gilt' }, ['grand', 'formal', 'gilded', 'nocturnal'], 'front'),

  /* ------------------------------- lattice ------------------------------ */
  paper('trellis-garden', 'Garden Trellis', 'Battens, knots, and a leaf at every waist.',
    { pattern: 'trellis', scale: 'medium', depth: 'flat', ink: 'paper', tone: 'bay' }, ['fresh', 'quiet'], 'front'),
  paper('trellis-conservatory', 'Conservatory Trellis', 'Trellis in painted timber.',
    { pattern: 'trellis', scale: 'large', depth: 'low', ink: 'timber', tone: 'bay' }, ['fresh', 'warm'], 'front'),
  paper('trellis-gilt', 'Gilt Trellis', 'A gilded lattice, raised.',
    { pattern: 'trellis', scale: 'medium', depth: 'raised', ink: 'gilt' }, ['gilded', 'formal'], 'front'),
  paper('quatre-cloister', 'Quatrefoil', 'Four-lobed foils, kissing at every joint.',
    { pattern: 'quatrefoil', scale: 'medium', depth: 'flat', ink: 'paper', tone: 'bay' }, ['quiet', 'fresh', 'formal'], 'book'),
  paper('quatre-morocco', 'Morocco Foil', 'The same foils in book cloth, raised.',
    { pattern: 'quatrefoil', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'teal' }, ['bold', 'cool', 'grand'], 'back'),
  paper('ogee-onion', 'Onion Lattice', 'An ogee net with a boss at every junction.',
    { pattern: 'ogee', scale: 'medium', depth: 'low', ink: 'paper', tone: 'oak' }, ['quiet', 'warm', 'antique'], 'front'),
  paper('ogee-damascene', 'Damascene Ogee', 'The onion net in brass on a deep ground.',
    { pattern: 'ogee', scale: 'large', depth: 'raised', ink: 'deep', tone: 'brass' }, ['grand', 'formal', 'gilded'], 'book'),
  paper('arch-crypt', 'Crypt Arcade', 'Low arches in stone, set close together.',
    { pattern: 'arch', scale: 'small', depth: 'flat', ink: 'recess', tone: 'stone' }, ['quiet', 'cool', 'antique'], 'back'),
  paper('arch-cloister', 'Cloister Arches', 'An arcade, drawn flat on.',
    { pattern: 'arch', scale: 'medium', depth: 'low', ink: 'paper', tone: 'chalk' }, ['formal', 'quiet'], 'book'),
  paper('arch-gilt', 'Gilded Arcade', 'Arches with a gilt keystone in every bay.',
    { pattern: 'arch', scale: 'large', depth: 'raised', ink: 'gilt' }, ['grand', 'gilded', 'formal'], 'book'),
  paper('scallop-shell', 'Scallop', 'Overlapping shells, small and even.',
    { pattern: 'scallop', scale: 'small', depth: 'flat', ink: 'paper', tone: 'sea' }, ['fresh', 'cool'], 'front'),
  paper('scallop-tide', 'Tide Scallop', 'Shells in the deeper wash, softly drawn.',
    { pattern: 'scallop', scale: 'medium', depth: 'low', ink: 'deep', tone: 'sea', edge: 'soft' }, ['cool', 'quiet', 'nocturnal'], 'book'),
  paper('scallop-seigaiha', 'Seigaiha', 'The wave crest, drawn large and indigo.',
    { pattern: 'scallop', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'indigo' }, ['bold', 'cool'], 'back'),
  paper('diaper-chapel', 'Chapel Diaper', 'A ruled diamond ground with a foil caught in it.',
    { pattern: 'diaper', scale: 'small', depth: 'flat', ink: 'deep', tone: 'mulberry', edge: 'etched' }, ['formal', 'quiet', 'antique'], 'back'),
  paper('diaper-illumination', 'Illuminated Diaper', 'The gilded ground of a book of hours.',
    { pattern: 'diaper', scale: 'medium', depth: 'low', ink: 'gilt' }, ['gilded', 'formal', 'antique'], 'book'),
  paper('diaper-scriptorium', 'Scriptorium', 'The same compartments, ivory on timber.',
    { pattern: 'diaper', scale: 'large', depth: 'raised', ink: 'timber', tone: 'ivory' }, ['grand', 'antique', 'warm'], 'book'),
  paper('fret-meander', 'Greek Key', 'A meander band, unit joined to unit.',
    { pattern: 'fret', scale: 'medium', depth: 'low', ink: 'paper', tone: 'ink' }, ['formal', 'quiet'], 'front'),
  paper('fret-empire', 'Empire Fret', 'The key run large, bronzed and raised.',
    { pattern: 'fret', scale: 'large', depth: 'raised', ink: 'recess', tone: 'bronze' }, ['grand', 'formal', 'gilded'], 'book'),

  /* -------------------------------- spot -------------------------------- */
  paper('polka-confetti', 'Confetti', 'Small dots sown close, blotted at the edge.',
    { pattern: 'polka', scale: 'petite', depth: 'flat', ink: 'deep', tone: 'rose', edge: 'blotted' }, ['playful', 'fresh'], 'book'),
  paper('polka-parlour', 'Parlour Spot', 'A ringed dot, with a small one between.',
    { pattern: 'polka', scale: 'small', depth: 'low', ink: 'paper', tone: 'ember' }, ['cosy', 'playful'], 'book'),
  paper('polka-cloth', 'Bindery Spot', 'Dots taken from the book cloth.',
    { pattern: 'polka', scale: 'medium', depth: 'raised', ink: 'cloth', tone: 'chalk' }, ['bold', 'playful'], 'book'),
  paper('star-night', 'Star Field', 'Small stars, evenly sown, sparks between.',
    { pattern: 'star', scale: 'small', depth: 'flat', ink: 'deep', tone: 'chalk' }, ['nocturnal', 'quiet'], 'front'),
  paper('star-gilt', 'Gilt Stars', 'Gold stars with a pale pip.',
    { pattern: 'star', scale: 'medium', depth: 'low', ink: 'gilt' }, ['gilded', 'playful'], 'front'),
  paper('star-grand', 'Grand Stars', 'Big stars, standing proud of the plaster.',
    { pattern: 'star', scale: 'large', depth: 'carved', ink: 'recess', tone: 'gilt' }, ['grand', 'nocturnal', 'gilded'], 'back'),
  paper('const-orrery', 'Orrery', 'Stars linked one to the next, right or down.',
    { pattern: 'constellation', scale: 'medium', depth: 'flat', ink: 'deep', tone: 'straw' }, ['nocturnal', 'quiet'], 'book'),
  paper('const-astrolabe', 'Astrolabe', 'The same chain, gilded and set back.',
    { pattern: 'constellation', scale: 'large', depth: 'low', ink: 'recess', tone: 'gilt' }, ['nocturnal', 'gilded', 'grand'], 'book'),
  paper('moon-nursery', 'Moon and Star', 'A crescent with a star in its horn.',
    { pattern: 'moonstar', scale: 'small', depth: 'flat', ink: 'paper', tone: 'sea' }, ['nocturnal', 'cosy'], 'book'),
  paper('moon-gilt', 'Gilded Crescents', 'Moons in gold leaf.',
    { pattern: 'moonstar', scale: 'medium', depth: 'raised', ink: 'gilt' }, ['gilded', 'nocturnal'], 'book'),
  paper('moon-eclipse', 'Eclipse', 'Great crescents carved into the plaster.',
    { pattern: 'moonstar', scale: 'large', depth: 'carved', ink: 'recess', tone: 'mist' }, ['nocturnal', 'grand', 'cool'], 'back'),
  paper('sun-marigold', 'Marigold', 'A little sun with long and short rays.',
    { pattern: 'sunburst', scale: 'small', depth: 'flat', ink: 'paper', tone: 'harvest' }, ['warm', 'playful', 'fresh'], 'front'),
  paper('sun-solstice', 'Solstice', 'The same sun, bronzed and raised.',
    { pattern: 'sunburst', scale: 'large', depth: 'raised', ink: 'timber', tone: 'bronze' }, ['grand', 'warm', 'gilded'], 'back'),
  paper('fleur-lys', 'Fleur-de-Lys', 'Three petals, a band and a tail.',
    { pattern: 'fleur', scale: 'medium', depth: 'low', ink: 'deep', tone: 'sky' }, ['formal', 'cool', 'antique'], 'front'),
  paper('fleur-royal', 'Royal Lys', 'The lys in gold on the binding cloth.',
    { pattern: 'fleur', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'gilt' }, ['grand', 'gilded', 'formal'], 'book'),
  paper('bee-skep', 'Skep Bees', 'Banded bodies and gauze wings, sown small.',
    { pattern: 'bee', scale: 'small', depth: 'flat', ink: 'timber', tone: 'amber' }, ['warm', 'cosy', 'playful'], 'front'),
  paper('bee-empire', 'Empire Bee', 'The emperor’s bee, in gold leaf.',
    { pattern: 'bee', scale: 'medium', depth: 'low', ink: 'gilt' }, ['gilded', 'formal', 'antique'], 'front'),
  paper('bee-coronation', 'Coronation Bee', 'Great bees on the recess, honey-winged.',
    { pattern: 'bee', scale: 'large', depth: 'raised', ink: 'recess', tone: 'honey' }, ['grand', 'gilded', 'nocturnal'], 'back'),

  /* ------------------------------ botanical ----------------------------- */
  paper('sprig-cottage', 'Cottage Sprig', 'A stem, four leaves and a five-petalled head.',
    { pattern: 'sprig', scale: 'small', depth: 'flat', ink: 'paper', tone: 'ember' }, ['cosy', 'fresh'], 'front'),
  paper('sprig-meadow', 'Meadow Sprig', 'The same sprig, larger and lifted.',
    { pattern: 'sprig', scale: 'medium', depth: 'low', ink: 'cloth', tone: 'bay' }, ['fresh', 'warm'], 'book'),
  paper('sprig-shade', 'Shaded Sprig', 'Sprigs in the recess colour, softly printed.',
    { pattern: 'sprig', scale: 'medium', depth: 'raised', ink: 'recess', tone: 'chalk', edge: 'soft' }, ['quiet', 'cool'], 'book'),
  paper('fern-frond', 'Fern Frond', 'Eight pairs of pinnae and a curled tip.',
    { pattern: 'fern', scale: 'medium', depth: 'flat', ink: 'paper', tone: 'fern' }, ['fresh', 'quiet'], 'front'),
  paper('fern-fossil', 'Fossil Fern', 'Fronds pressed into a peat ground.',
    { pattern: 'fern', scale: 'small', depth: 'raised', ink: 'recess', tone: 'peat', edge: 'soft' }, ['quiet', 'cool', 'antique'], 'book'),
  paper('fern-hothouse', 'Hothouse Fern', 'Big fronds in the deepest green.',
    { pattern: 'fern', scale: 'large', depth: 'low', ink: 'cloth', tone: 'forest' }, ['fresh', 'bold'], 'front'),
  paper('vine-trailing', 'Trailing Vine', 'One stem, crossing the wall without a joint.',
    { pattern: 'vine', scale: 'medium', depth: 'low', ink: 'paper', tone: 'myrtle' }, ['fresh', 'quiet'], 'front'),
  paper('vine-arbour', 'Arbour Vine', 'The trail in timber, berried and raised.',
    { pattern: 'vine', scale: 'large', depth: 'raised', ink: 'timber', tone: 'berry' }, ['warm', 'cosy', 'grand'], 'book'),
  paper('laurel-victory', 'Victory Laurel', 'Small branches, mossy, mirrored row by row.',
    { pattern: 'laurel', scale: 'small', depth: 'low', ink: 'deep', tone: 'moss' }, ['fresh', 'formal', 'quiet'], 'front'),
  paper('laurel-wreath', 'Laurel', 'Branches with three berries at every tip.',
    { pattern: 'laurel', scale: 'medium', depth: 'flat', ink: 'paper', tone: 'berry' }, ['formal', 'fresh'], 'front'),
  paper('laurel-gilt', 'Gilt Laurel', 'Laurel in gold, standing off the wall.',
    { pattern: 'laurel', scale: 'large', depth: 'raised', ink: 'gilt' }, ['grand', 'gilded', 'formal'], 'book'),
  paper('rose-chintz', 'Chintz Rose', 'A full-face rose, printed and blotted.',
    { pattern: 'rose', scale: 'medium', depth: 'low', ink: 'paper', tone: 'blush', edge: 'blotted' }, ['cosy', 'warm', 'playful'], 'book'),
  paper('rose-tudor', 'Tudor Rose', 'The rose gilded, on the binding cloth.',
    { pattern: 'rose', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'gilt' }, ['grand', 'gilded', 'antique'], 'back'),
  paper('thistle-braes', 'Braes Thistle', 'Spiked heads over a scaled calyx.',
    { pattern: 'thistle', scale: 'medium', depth: 'flat', ink: 'deep', tone: 'heather' }, ['cool', 'fresh'], 'back'),
  paper('thistle-highland', 'Highland Thistle', 'The same thistle at twice the size.',
    { pattern: 'thistle', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'plum' }, ['bold', 'grand'], 'back'),
  paper('pom-orchard', 'Orchard Pomegranate', 'The cut fruit, seeds and all.',
    { pattern: 'pomegranate', scale: 'medium', depth: 'low', ink: 'timber', tone: 'ember' }, ['warm', 'antique'], 'book'),
  paper('pom-velvet', 'Velvet Pomegranate', 'The weaver’s fruit, at velvet scale.',
    { pattern: 'pomegranate', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'berry' }, ['grand', 'bold', 'antique'], 'book'),
  paper('pom-granada', 'Granada', 'The cut fruit carved deep, seeded in wine.',
    { pattern: 'pomegranate', scale: 'grand', depth: 'carved', ink: 'recess', tone: 'wine' }, ['grand', 'bold', 'antique', 'nocturnal'], 'back'),

  /* ------------------------------- figured ------------------------------ */
  paper('damask-library', 'Library Damask', 'The house device, ruled fine and sepia.',
    { pattern: 'damask', scale: 'medium', depth: 'low', ink: 'recess', tone: 'sepia', edge: 'etched' }, ['formal', 'quiet', 'antique'], 'front'),
  paper('damask-athenaeum', 'Athenaeum Damask', 'The house damask — ogee, palmette and crown.',
    { pattern: 'damask', scale: 'large', depth: 'raised', ink: 'paper', tone: 'gilt' }, ['formal', 'grand', 'antique'], 'front'),
  paper('damask-gilt', 'Gilt Damask', 'The grand one. Gold, and carved.',
    { pattern: 'damask', scale: 'grand', depth: 'carved', ink: 'gilt' }, ['grand', 'gilded', 'formal'], 'front'),
  paper('medallion-adam', 'Adam Patera', 'An oval medallion, ribboned, with husks below.',
    { pattern: 'medallion', scale: 'medium', depth: 'low', ink: 'deep', tone: 'chalk' }, ['formal', 'quiet', 'antique'], 'front'),
  paper('medallion-gilt', 'Gilt Patera', 'The patera in gold, standing off the wall.',
    { pattern: 'medallion', scale: 'large', depth: 'raised', ink: 'gilt' }, ['gilded', 'grand', 'formal'], 'front'),
  paper('urn-mantel', 'Mantel Urn', 'A classical urn with a spray of three.',
    { pattern: 'urn', scale: 'medium', depth: 'low', ink: 'deep', tone: 'bay' }, ['formal', 'antique'], 'book'),
  paper('urn-gilt', 'Gilded Urn', 'The same urn, banded in gold.',
    { pattern: 'urn', scale: 'large', depth: 'raised', ink: 'gilt' }, ['grand', 'gilded', 'antique'], 'book'),
  paper('arab-alhambra', 'Alhambra', 'Open scrollwork, with nothing framed.',
    { pattern: 'arabesque', scale: 'medium', depth: 'low', ink: 'paper', tone: 'verdigris' }, ['formal', 'cool', 'quiet'], 'book'),
  paper('arab-gilt', 'Gilded Arabesque', 'The scrolls in gold, raised.',
    { pattern: 'arabesque', scale: 'large', depth: 'raised', ink: 'gilt' }, ['gilded', 'grand', 'formal'], 'book'),
  paper('arab-ottoman', 'Ottoman Scroll', 'Volutes and palmettes, carved and saffroned.',
    { pattern: 'arabesque', scale: 'grand', depth: 'carved', ink: 'cloth', tone: 'saffron' }, ['grand', 'bold', 'warm'], 'back'),
  paper('pagoda-garden', 'Garden Pagoda', 'Three upswept roofs, a finial and bells.',
    { pattern: 'pagoda', scale: 'medium', depth: 'flat', ink: 'paper', tone: 'sea' }, ['playful', 'fresh', 'cool'], 'book'),
  paper('pagoda-lacquer', 'Lacquer Pagoda', 'The pavilion in gold on book cloth.',
    { pattern: 'pagoda', scale: 'large', depth: 'raised', ink: 'cloth', tone: 'gilt' }, ['bold', 'gilded', 'grand'], 'back'),
  paper('bird-chinoiserie', 'Chinoiserie Birds', 'A bird on a berried twig, facing both ways.',
    { pattern: 'bird', scale: 'medium', depth: 'flat', ink: 'paper', tone: 'sea' }, ['playful', 'fresh'], 'book'),
  paper('bird-cloth', 'Aviary Cloth', 'Birds in the binding colour.',
    { pattern: 'bird', scale: 'large', depth: 'low', ink: 'cloth', tone: 'bay' }, ['warm', 'playful'], 'book'),
  paper('hare-meadow', 'Meadow Hare', 'A sitting hare, facing both ways by turn.',
    { pattern: 'hare', scale: 'medium', depth: 'flat', ink: 'timber', tone: 'clay' }, ['playful', 'warm', 'cosy'], 'book'),
  paper('hare-moonlit', 'Moonlit Hare', 'The hare set back, in a soft mist.',
    { pattern: 'hare', scale: 'large', depth: 'low', ink: 'recess', tone: 'mist', edge: 'soft' }, ['nocturnal', 'playful', 'quiet'], 'book'),
  paper('toile-cottage', 'Cottage Toile', 'A cottage, a fence and two birds, in a cartouche.',
    { pattern: 'toile', scale: 'large', depth: 'flat', ink: 'deep', tone: 'ember' }, ['antique', 'cosy'], 'front'),
  paper('toile-timber', 'Country Toile', 'The same vignette, washed warm and soft.',
    { pattern: 'toile', scale: 'grand', depth: 'low', ink: 'timber', tone: 'bay', edge: 'soft' }, ['antique', 'warm'], 'book'),
];

const FAMILY_RANK = new Map(WALLPAPER_FAMILIES.map((f, i) => [f, i] as const));
const TIER_RANK = new Map(WALLPAPER_TIERS.map((t, i) => [t, i] as const));
const AUTHORED_AT = new Map(WALLPAPER_BOOK.map((p, i) => [p.id, i] as const));

/**
 * The book as the reader is offered it: strongest section first, and inside
 * each section the papers that lead it first.
 *
 * DERIVED, from three pieces of data on the entries themselves — the family
 * order in {@link WALLPAPER_FAMILIES}, the `tier` on each paper, and finally
 * the order it was written in, which is the quiet → loud run a person composed
 * a section in. Nothing here is a hand-kept list, which is the point: the
 * previous version of this array was BOTH the ranking and the authoring order,
 * so re-ranking a paper meant moving a line, and moving a line by accident
 * silently re-ranked a paper.
 *
 * Every consumer that shows the papers in order gets the ranking for free —
 * `wallpaperOptions()` maps this straight onto picker cards and the picker
 * groups by first appearance, so the section order is this order.
 */
export const WALLPAPER_PRESETS: readonly WallpaperPreset[] = [...WALLPAPER_BOOK].sort(
  (a, b) =>
    (FAMILY_RANK.get(a.family) ?? 0) - (FAMILY_RANK.get(b.family) ?? 0) ||
    (TIER_RANK.get(a.tier) ?? 0) - (TIER_RANK.get(b.tier) ?? 0) ||
    (AUTHORED_AT.get(a.id) ?? 0) - (AUTHORED_AT.get(b.id) ?? 0),
);

/**
 * What an id we do not recognise resolves to.
 *
 * Always the bare wall. A saved paper that has since been renamed, or a setting
 * that got corrupted, should open on nothing rather than on a decision — a
 * library that quietly starts wearing stripes it was never given is worse than
 * one that opens plain and lets you choose.
 */
export const FALLBACK_WALLPAPER_ID = 'plain-parchment';

/**
 * The wallpaper a NEW library opens with.
 *
 * These were one constant doing two jobs, and the second job silently vetoed
 * the first: repointing it so a new reader sees something of the fifty also
 * repointed what a corrupt setting resolves to. Four tests pin "junk gives you
 * the plain wall" and they are right to, so the answer is two constants rather
 * than a compromise between them.
 *
 * `pin-quiet` is a hairline pinstripe — enough to say the wall is a surface
 * somebody chose, quiet enough to sit behind a shelf of books all day. The old
 * default said "the wall, and nothing on it", which meant a new reader saw a
 * blank wall and none of the fifty papers until they went looking for a picker
 * they had no reason to think existed. Plain Parchment is still first in the
 * picker for anyone who wants the bare wall back.
 */
export const DEFAULT_WALLPAPER_ID = 'pin-quiet';

const BY_ID = new Map(WALLPAPER_PRESETS.map((p) => [p.id, p]));

/**
 * The four values `settings.wallpaperPattern` has been storing since before
 * there was any wallpaper to draw, mapped to their nearest paper.
 *
 * Kept because the setting was live in the picker the whole time it was inert:
 * a reader who chose "botanical" three months ago picked something, and landing
 * them on a bare wall now would read as their choice having been thrown away.
 * Aliases only — none of these are offered, and nothing writes them back.
 */
const LEGACY_IDS: Readonly<Record<string, string>> = {
  plain: 'plain-parchment',
  damask: 'damask-athenaeum',
  stars: 'star-night',
  botanical: 'sprig-cottage',
  constellation: 'star-night',
  // The papers dropped when the book was rebalanced from fifty-five lumpy
  // presets to fifty even ones. A reader's WALL is unaffected either way — the
  // spec is what gets persisted, not the id — but the studio highlights the
  // card whose id matches, and an id that resolves to nothing highlights the
  // plain wall, which reads as the choice having been thrown away.
  'stripe-awning': 'chevron-bold',
  'herring-carved': 'herring-parquet',
  'honey-raised': 'honey-grand',
  'scallop-grand': 'scallop-tide',
  'arch-reading': 'arch-gilt',
  'polka-pin': 'polka-parlour',
  'moon-deep': 'moon-gilt',
  'laurel-grand': 'laurel-gilt',
  'damask-quiet': 'damask-athenaeum',
  'damask-timber': 'damask-athenaeum',
  'bird-gilt': 'bird-cloth',
  'pomegranate-orchard': 'pom-orchard',
};

/** Narrowing guard for persisted / user-supplied ids. Accepts legacy names. */
export function isWallpaperId(value: unknown): value is string {
  return typeof value === 'string' && (BY_ID.has(value) || value in LEGACY_IDS);
}

/**
 * Look up a preset. Unknown ids fall back to plain, the same way `getTheme`
 * falls back to the athenaeum — a library saved against a paper that has since
 * been renamed opens on a bare wall rather than failing to open.
 *
 * Resolves to `FALLBACK_WALLPAPER_ID`, NOT to the opening default. A reader
 * whose setting went bad should get the bare wall, not whichever paper a new
 * library happens to start on: the first is a visible nothing they can fix, the
 * second is a choice they never made and cannot tell from one they did.
 */
export function getWallpaper(id: string | null | undefined): WallpaperPreset {
  if (id === null || id === undefined) return BY_ID.get(FALLBACK_WALLPAPER_ID)!;
  return (
    BY_ID.get(id) ??
    BY_ID.get(LEGACY_IDS[id] ?? '') ??
    BY_ID.get(FALLBACK_WALLPAPER_ID)!
  );
}

/** The spec for an id, for callers that only want to draw. */
export function wallpaperSpec(id: string | null | undefined): WallpaperSpec {
  return getWallpaper(id).spec;
}

/* ------------------------------- the dice -------------------------------- */

/**
 * Whether "surprise me" is allowed to hand this paper out.
 *
 * Two exclusions, and they fail differently:
 *
 *  - a `back` paper was looked at on a wall and demoted. It stays in the
 *    picker, because somebody will want the hand-sized gold crescent; it does
 *    not come out of the dice, because the reader who rolled the dice did not
 *    ask for one.
 *  - the bare wall is excluded whatever its tier, and it has to be `front`
 *    because it is the first card in the picker. A "surprise me" that lands on
 *    Plain Parchment has taken the wallpaper OFF rather than chosen one, which
 *    reads as the button being broken.
 *
 * The rule lives here rather than in the studio for the same reason the mood
 * vocabulary does: the art file knows which of its papers are odd, and a
 * consumer that has to remember to filter is a consumer that will forget.
 */
export function isRollableWallpaper(preset: WallpaperPreset): boolean {
  return preset.tier !== 'back' && preset.id !== FALLBACK_WALLPAPER_ID;
}

/**
 * The papers the dice may return, in shelf order.
 *
 * This — not `WALLPAPER_PRESETS` — is what a "surprise me" rolls over, and what
 * anything picking a paper from a seed should read. Rolling the whole book is
 * how an average reader ends up looking at a wall of hand-sized bees they never
 * asked for.
 */
export const WALLPAPER_ROLL: readonly WallpaperPreset[] =
  WALLPAPER_PRESETS.filter(isRollableWallpaper);

/**
 * Roll one paper, optionally steered by a mood.
 *
 * `pick` returns a number in [0, 1) — `Math.random`, or a seeded generator when
 * the roll has to be reproducible. A mood no rollable paper carries degrades to
 * the whole pool rather than to nothing, exactly as `withMood` does for the
 * other vocabularies: a reader asking for "something goofy" wants a paper, and
 * an axis with no match should widen rather than refuse.
 *
 * Never returns a `back` paper and never returns the bare wall, whatever the
 * mood — the filter is applied to the pool, not to the book.
 */
export function rollWallpaper(pick: () => number, mood?: WallpaperMood | ''): WallpaperPreset {
  const steered =
    mood === undefined || mood === ''
      ? WALLPAPER_ROLL
      : WALLPAPER_ROLL.filter((p) => p.tags.includes(mood));
  const pool = steered.length > 0 ? steered : WALLPAPER_ROLL;
  const raw = pick();
  const i = Number.isFinite(raw) ? Math.floor(Math.abs(raw) * pool.length) % pool.length : 0;
  return pool[i] ?? pool[0]!;
}

/* ---------------------------- preview drawing ---------------------------- */

/**
 * An offscreen square canvas, wherever we happen to be running.
 *
 * Workers have `OffscreenCanvas` and no `document`; older embeddings have the
 * reverse. Returns null in neither, which only happens under node, where
 * nothing draws a card anyway.
 */
function scratchCanvas(size: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
  }
  return null;
}

/**
 * A picker card: the paper, with one shelf board sitting against it so the
 * reader can judge the pattern at the size it will actually be seen.
 *
 * Goes through an offscreen tile and `createPattern`, NOT through repeated
 * `translate` + `renderWallpaperTile` calls. That shortcut is what put a pale
 * cross through the middle of every card in the first specimen: the clip in
 * `renderWallpaperTile` lands on a fractional pixel when the tile pitch is not
 * an integer, and the antialiased clip edge shows as exactly the "white band"
 * this whole module exists to avoid. The tile itself was fine; the way it was
 * laid down was not. Any caller tiling this art has the same obligation —
 * integer texture, integer offsets.
 *
 * Uses the same tile renderer as the wall, so a card cannot preview a paper you
 * cannot get — the drift the case cards suffered when the shelf went flat and
 * the cards did not.
 */
export function drawWallpaperCard(ctx: FlatCtx, w: number, h: number, spec: WallpaperSpec): void {
  // The tile is drawn at its NATURAL size and then scaled DOWN through the
  // pattern transform, never re-rendered smaller: re-rendering refits the
  // lattice, which would show every paper at the same motif size and make the
  // scale picker look broken. Scaling the pattern keeps the ratio between motif
  // and card honest, and a repeat-mode pattern resamples with wraparound, so
  // the downscale cannot manufacture the seam this module exists to avoid.
  const size = Math.round(wallpaperTilePx(spec));
  const cell = SCALE_CELL[spec.scale] * PLANS[spec.pattern].cell;
  // Aim for a cell about half the card's short side — two-and-a-bit motifs,
  // which is the least that reads as a repeat rather than as a picture.
  const k = Math.max(0.18, Math.min(1, (Math.min(w, h) * 0.5) / cell));
  const scratch = scratchCanvas(size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  const sctx = scratch?.getContext('2d') ?? null;
  if (scratch !== null && sctx !== null) {
    renderWallpaperTile(sctx as FlatCtx, size, spec);
    const pattern = ctx.createPattern(scratch as CanvasImageSource, 'repeat');
    if (pattern !== null) {
      if (k < 1) pattern.setTransform({ a: k, b: 0, c: 0, d: k, e: 0, f: 0 });
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    ctx.fillStyle = wallpaperColours(spec).ground;
    ctx.fillRect(0, 0, w, h);
  }
  // A board and its contact shadow, so the paper is judged next to the timber
  // it has to live with rather than on its own.
  const room = flatScheme();
  const boardY = h * 0.74;
  const boardH = Math.max(4, h * 0.08);
  contactShadow(ctx, w / 2, boardY + boardH, w * 0.44, boardH * 0.4, 0.16);
  ctx.beginPath();
  ctx.rect(w * 0.06, boardY, w * 0.88, boardH);
  ctx.fillStyle = room.timberDark;
  ctx.fill();
  ctx.beginPath();
  ctx.rect(w * 0.06, boardY, w * 0.88, boardH * 0.72);
  ctx.fillStyle = room.timber;
  ctx.fill();
  stroke(ctx, w * 0.06, boardY, w * 0.94, boardY, FLAT.ink, Math.max(1, boardH * 0.14), 3);
  ctx.beginPath();
  ctx.rect(w * 0.06, boardY, w * 0.88, boardH);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = Math.max(1, boardH * 0.16);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}
