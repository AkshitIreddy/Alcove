/**
 * art/shelfDesign.ts — the bookcase's carpentry, separate from its colour.
 *
 * A room used to be the only thing a reader could change, and a room is a
 * palette: same four shapes, different fills. That made every library the
 * identical bookcase in a new coat, which is a thin kind of ownership — you
 * cannot recognise *your* shelf across a screenshot when the only difference is
 * hue.
 *
 * So the case now has two more axes, and they are deliberately orthogonal:
 *
 * - a **build** is the carpentry — what the board, the upright, the opening and
 *   the cornice actually ARE. A gothic case and a crate stack are not the same
 *   drawing recoloured; they have different silhouettes.
 * - a **pattern** is what is worked into the timber faces — beading, fluting,
 *   a chequer inlay, a rope twist. It never changes a silhouette, so it can be
 *   crossed with every build without designing six hundred cases by hand.
 *
 * Fifty-two builds × fifty patterns; `SHELF_PRESETS` names a hundred and
 * eighteen of them for the studio to show, because a grid of two and a half
 * thousand unlabelled thumbnails is a worse product than a hundred with names.
 * Every build also carries TAGS (`BuildTag`) — formal, goofy, rustic, ornate —
 * so "surprise me, something cosy" can be answered without a lookup table
 * living somewhere else.
 *
 * ## Joinery comes before ornament
 *
 * The case is baked as four separate bitmaps and composited by the shelf, so
 * every part has neighbours it never sees. See the JOINERY section below for
 * the primitive that handles that, and for the list of things that went wrong
 * before it existed — they were all one bug.
 *
 * ## The rules this file works under
 *
 * Everything here is `art/flat.ts` vocabulary and nothing else: flat colour,
 * ONE ink outline, rounded corners, edges that bow. Depth is a darker flat face
 * beside a lighter one. There is no light model — no groove is "shaded", it is
 * drawn in a darker timber value, which is the same trick the plank's front
 * edge has always played. There are now four of those values rather than two
 * (see `caseTimber`): `timber` → `timberDark` alone is about a twelfth of a
 * luminance step, and a board's front edge drawn in it did not read as a face
 * turning away at all.
 *
 * Colour comes from `flatScheme()` at draw time, never captured, because a room
 * swap is synchronous around the draw (see the note on `flatScheme`).
 *
 * ## Scale is the hard constraint
 *
 * A plank is ~1200 × 40 world px and a post ~34 wide. Every motif below is
 * sized as a fraction of the face's SHORT side, so a pattern that reads on the
 * board also reads on the upright, and none of them are finer than about a
 * fortieth of the face's length. A pattern that turns to mush at shelf scale is
 * a failed pattern; these were checked on a specimen board at 1:1.
 *
 * ## Tiling
 *
 * The post texture is one floor tall and repeats down the case, so a periodic
 * pattern would break at every floor seam unless its pitch divides the tile.
 * That is what the `tile` argument to `faceOf` is for: the pitch is snapped to
 * an exact divisor of the tile and the phase is measured from the tile's
 * origin, not from the (deliberately over-drawn) rectangle the caller passes.
 */

import {
  FLAT,
  flatScheme,
  inkWidth,
  wobbleRect,
  type FlatCtx,
} from './flat';

/* ----------------------------------------------------------------------------
   Identifiers
   -------------------------------------------------------------------------- */

/** A plain rectangle in canvas coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One side of a part. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The sides of a part that BUTT another part rather than end in air.
 *
 * Absent means silhouette: rounded corners, a bowed edge, an ink line. Present
 * means join: square corners, no ink line, and the fill pushed past the
 * boundary so the neighbour's bitmap cannot leave a gap between them.
 */
export type Joins = Partial<Record<Side, boolean>>;

const NO_JOINS: Joins = {};

/* ----------------------------------------------------------------------------
   Joinery — the primitive the carpentry is built on
   -------------------------------------------------------------------------- */

/*
 * The case is baked as four separate bitmaps and composited by the shelf, so
 * every part has neighbours it never sees. The first version of this file drew
 * each part with `flat.panel`, which closes the path, rounds all four corners
 * and strokes the whole perimeter — so every part terminated in a rounded cap
 * and a second ink line at exactly the place it was supposed to be CONTINUOUS
 * with the part beside it. The case came out a pile of lozenges: a cornice
 * floating over its uprights, a transparent hairline running the whole 1200px
 * width of every shelf board, battlements glued onto a band whose own outline
 * ran underneath them, a three-pixel hole of bare wall at both top corners of
 * the face-frame case.
 *
 * All of that is one missing idea, so there is one primitive for it:
 *
 *   an edge is either a SILHOUETTE or a JOIN, and they are drawn differently.
 *
 * Silhouette: rounded corners, a bow, an ink line. Join: square corners, no ink
 * line, and the fill over-drawn past the nominal boundary so the two abutting
 * bitmaps always OVERLAP instead of meeting exactly. Every part drawer and
 * every applied ornament in this file declares which of its sides are joins.
 */

/**
 * How far past a join a part is over-drawn.
 *
 * Half an ink line (so a neighbour's outline has timber to sit on), plus the
 * outward bow this style puts in the middle of every edge, plus two pixels of
 * slack. It has to EXCEED the inset the bake applies on the same side
 * (`textures.outlinePad`, the same formula minus the slack) or the over-draw
 * lands inside the canvas and the seam is still a hole.
 */
export function jointBleed(shortSide: number): number {
  return inkWidth(shortSide) * 0.5 + shortSide * 0.012 + 2.5;
}

/**
 * How far a part moves OUTWARD to cancel the bake's inset, leaving its ink
 * line's outer edge exactly on the canvas boundary.
 *
 * For a side that is a true silhouette but sits flush against the edge of its
 * own bitmap — the outboard face of an upright, the top surface of a board —
 * being inset by `outlinePad` opens a transparent stripe of whatever is behind
 * the sprite, and being drawn dead flush loses half the line instead. This
 * shift is the difference between the two: `outlinePad` less half an ink width.
 */
export function flushShift(shortSide: number): number {
  return shortSide * 0.012 + 0.5;
}

/**
 * A deterministic wobble in [-1, 1] from an integer.
 *
 * The same generator `flat.wobbleRect` uses, written out again rather than
 * exported from there because it is three lines and this file needs it per
 * SIDE rather than per rectangle.
 */
function wob(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** One traced piece of a boundary. The start point is carried so a run of them can be stroked alone. */
interface Seg {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  ex: number;
  ey: number;
  /** False where this piece of boundary is a join and must carry no ink. */
  free: boolean;
}

export interface PartOpts {
  /** Corner radius, applied only where BOTH adjoining sides are silhouette. */
  radius?: number;
  seed?: number;
  joins?: Joins;
  /** Over-draw past a join. Defaults to `jointBleed` of the short side. */
  bleed?: number;
  ink?: string;
  width?: number;
  /** Deflection at the middle of a silhouette edge. Always outward. */
  bow?: number;
}

function partSegments(b: Box, o: PartOpts): Seg[] {
  const j = o.joins ?? NO_JOINS;
  const bleed = o.bleed ?? jointBleed(Math.min(b.w, b.h));
  const x0 = b.x - (j.left === true ? bleed : 0);
  const x1 = b.x + b.w + (j.right === true ? bleed : 0);
  const y0 = b.y - (j.top === true ? bleed : 0);
  const y1 = b.y + b.h + (j.bottom === true ? bleed : 0);
  const w = x1 - x0;
  const h = y1 - y0;
  const seed = o.seed ?? 1;

  const freeTop = j.top !== true;
  const freeRight = j.right !== true;
  const freeBottom = j.bottom !== true;
  const freeLeft = j.left !== true;

  const r = Math.max(0, Math.min(o.radius ?? Math.min(w, h) * 0.16, Math.min(w, h) / 2));
  const rTL = freeTop && freeLeft ? r : 0;
  const rTR = freeTop && freeRight ? r : 0;
  const rBR = freeBottom && freeRight ? r : 0;
  const rBL = freeBottom && freeLeft ? r : 0;

  // Always OUTWARD, never inward. A silhouette edge that bows inward can pull
  // itself off the canvas boundary it was flushed against and re-open the seam
  // that flush was there to close; outward it can only run off the crop.
  const amp = o.bow ?? Math.min(w, h) * 0.012;
  const bow = (n: number): number => (0.3 + 0.7 * Math.abs(wob(seed + n))) * amp;

  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;

  return [
    { sx: x0 + rTL, sy: y0, cx: mx, cy: y0 - bow(1), ex: x1 - rTR, ey: y0, free: freeTop },
    { sx: x1 - rTR, sy: y0, cx: x1, cy: y0, ex: x1, ey: y0 + rTR, free: freeTop && freeRight },
    { sx: x1, sy: y0 + rTR, cx: x1 + bow(2), cy: my, ex: x1, ey: y1 - rBR, free: freeRight },
    { sx: x1, sy: y1 - rBR, cx: x1, cy: y1, ex: x1 - rBR, ey: y1, free: freeRight && freeBottom },
    { sx: x1 - rBR, sy: y1, cx: mx, cy: y1 + bow(3), ex: x0 + rBL, ey: y1, free: freeBottom },
    { sx: x0 + rBL, sy: y1, cx: x0, cy: y1, ex: x0, ey: y1 - rBL, free: freeBottom && freeLeft },
    { sx: x0, sy: y1 - rBL, cx: x0 - bow(4), cy: my, ex: x0, ey: y0 + rTL, free: freeLeft },
    { sx: x0, sy: y0 + rTL, cx: x0, cy: y0, ex: x0 + rTL, ey: y0, free: freeLeft && freeTop },
  ];
}

/** Trace a part's whole boundary as a closed path — for filling, and for clipping. */
export function tracePart(ctx: FlatCtx, b: Box, o: PartOpts = {}): void {
  const segs = partSegments(b, o);
  const first = segs[0]!;
  ctx.beginPath();
  ctx.moveTo(first.sx, first.sy);
  for (const s of segs) ctx.quadraticCurveTo(s.cx, s.cy, s.ex, s.ey);
  ctx.closePath();
}

/**
 * Ink only the sides that are silhouette.
 *
 * Runs of consecutive free segments are stroked as one open path, so a rounded
 * corner between two silhouette edges keeps its mitre. A run ends at a join,
 * where the line has already been carried `bleed` past the true boundary and
 * under the neighbour rather than stopping short of it.
 */
export function strokePart(ctx: FlatCtx, b: Box, o: PartOpts = {}): void {
  const segs = partSegments(b, o);
  ctx.strokeStyle = o.ink ?? FLAT.ink;
  ctx.lineWidth = o.width ?? inkWidth(Math.min(b.w, b.h));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (segs.every((s) => s.free)) {
    tracePart(ctx, b, o);
    ctx.stroke();
    return;
  }
  const n = segs.length;
  for (let i = 0; i < n; i++) {
    if (!segs[i]!.free || segs[(i + n - 1) % n]!.free) continue;
    const head = segs[i]!;
    ctx.beginPath();
    ctx.moveTo(head.sx, head.sy);
    for (let k = 0; k < n; k++) {
      const s = segs[(i + k) % n]!;
      if (!s.free) break;
      ctx.quadraticCurveTo(s.cx, s.cy, s.ex, s.ey);
    }
    ctx.stroke();
  }
}

/** Fill a part and ink its silhouette. `flat.panel` with joinery — the workhorse. */
export function partPanel(ctx: FlatCtx, b: Box, fill: string, o: PartOpts = {}): void {
  tracePart(ctx, b, o);
  ctx.fillStyle = fill;
  ctx.fill();
  strokePart(ctx, b, o);
}

/**
 * Run `paint` clipped to a part's own boundary.
 *
 * The clip has to be the SAME path the part was filled with — one traced with
 * a different radius or seed lets a face band spill past a bowed edge, and the
 * case grows a fringe.
 */
export function withinPart(ctx: FlatCtx, b: Box, o: PartOpts, paint: () => void): void {
  ctx.save();
  tracePart(ctx, b, o);
  ctx.clip();
  paint();
  ctx.restore();
}

/**
 * A line whose bow is measured in pixels rather than as a fraction of its run.
 *
 * `flat.stroke` deflects by 0.6% of the length, which is right for a 40px gilt
 * band and wrong for a 1200px board: there it sags seven pixels and the shelf
 * looks warped. Every arris, reveal and face line below uses this instead.
 */
export function edgeLine(
  ctx: FlatCtx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: string,
  width: number,
  seed: number,
  bow = 0.9,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const d = wob(seed) * bow;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + nx * d, (y0 + y1) / 2 + ny * d, x1, y1);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/* ----------------------------------------------------------------------------
   Timber values
   -------------------------------------------------------------------------- */

const MIX_CACHE = new Map<string, string>();

function channelAt(hex: string, at: number): number {
  return parseInt(hex.slice(at, at + 2), 16);
}

/** Blend two hexes. Memoized: every draw asks for the same handful of mixes. */
export function mixHex(a: string, b: string, t: number): string {
  const key = `${a}|${b}|${t}`;
  const hit = MIX_CACHE.get(key);
  if (hit !== undefined) return hit;
  const A = a.length === 7 ? a : '#c08a52';
  const B = b.length === 7 ? b : '#4f3120';
  const out =
    '#' +
    [1, 3, 5]
      .map((i) => {
        const v = Math.round(channelAt(A, i) + (channelAt(B, i) - channelAt(A, i)) * t);
        return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
      })
      .join('');
  if (MIX_CACHE.size > 512) MIX_CACHE.clear();
  MIX_CACHE.set(key, out);
  return out;
}

/**
 * The case's timber, as a ladder of flat values.
 *
 * A room gives three colours; this makes five out of them, all derived, so a
 * repaint still repaints everything. The reader's complaint that the shading
 * was poor was mostly this: `timber` → `timberDark` is about a twelfth of a
 * luminance step, so a board's front edge and its top surface read as one
 * shape with a line drawn across it rather than as two faces.
 *
 * The rule for using them is the icon's, and it is about ORIENTATION, never
 * about light:
 *
 * - `face`  — the face turned toward the reader.
 * - `arris` — the narrow chamfer where two faces meet. A real edge is never
 *   infinitely sharp; a fine lighter band there is carpentry, not a highlight,
 *   and it goes on EVERY face boundary rather than on the ones a lamp would
 *   happen to catch.
 * - `edge`  — the face that turns away: a board's front edge, an upright's
 *   return into the case, a cornice's bed mould.
 * - `deep`  — timber seen at the back of something: a housing, the ground under
 *   a dentil course, the inside of a compartment.
 * - `recess`— behind the books. The room's own colour, untouched.
 */
export interface Timber {
  face: string;
  arris: string;
  edge: string;
  deep: string;
  recess: string;
}

export function caseTimber(): Timber {
  const s = flatScheme();
  return {
    face: s.timber,
    arris: mixHex(s.timber, FLAT.cream, 0.34),
    edge: mixHex(s.timberDark, s.recess, 0.42),
    deep: mixHex(s.recess, FLAT.ink, 0.3),
    recess: s.recess,
  };
}

/**
 * The fifty-two carpentries, in picker order.
 *
 * Grouped rather than alphabetised, and the groups run plain → cabinet →
 * classical → gothic → whimsical → rustic, so the studio's grid reads as a
 * progression. The twelve original ids all survive and still mean what they
 * meant: a build is persisted per bookcase in SQLite, so retiring one would
 * silently rebuild somebody's library.
 */
export const BUILD_IDS = [
  // Quiet carpentry. Nothing between the reader and the books.
  'plank',
  'shaker',
  'schoolroom',
  'atelier',
  'ladder',
  'workbench',

  // Cabinet work: frames, stiles, reveals, glazing.
  'faceFrame',
  'barrister',
  'bookbinder',
  'conservatory',
  'orangery',
  'campaign',
  'vestry',

  // Compartments and grids.
  'apothecary',
  'pigeonhole',
  'mercantile',
  'rookery',
  'dovecote',
  'curiosity',

  // The classical orders.
  'arch',
  'cloister',
  'colonnade',
  'scriptorium',
  'observatory',
  'parlour',

  // Gothic and the middle ages.
  'gothic',
  'chapel',
  'minster',
  'refectory',
  'lychgate',

  // Cottage, fret and fancy.
  'valance',
  'cottage',
  'tearoom',
  'gingerbread',
  'chinoiserie',
  'pagoda',
  'seaside',
  'galleon',
  'carnival',
  'toybox',
  'beehive',
  'windmill',

  // Rustic, hewn and knocked together.
  'crate',
  'steamer',
  'slab',
  'cabin',
  'driftwood',
  'hayloft',
  'sawmill',
  'stable',
  'tavern',
  'treehouse',
] as const;

export type BuildId = (typeof BUILD_IDS)[number];

/**
 * The fifty timber treatments, in picker order (`none` first, always).
 *
 * Grouped rather than alphabetised, because the groups ARE the vocabulary a
 * furniture maker works in and a reader scrolling the picker learns it for
 * free: quiet edge work, then mouldings run along the timber, then the
 * classical enrichments, the gothic and Norman courses, the frets, the
 * veneers, and last the carved and worked surfaces.
 *
 * The twelve original ids are all still here and still mean what they meant.
 * They are persisted per library in SQLite, so retiring one would silently
 * repaint somebody's bookcase; every one of them was reimplemented in place
 * instead.
 */
export const PATTERN_IDS = [
  'none',

  // Edge work: what a joiner does to a face when he is not decorating it.
  'stringing',
  'cockBead',
  'beaded',
  'reeded',
  'fluted',
  'cableFlute',

  // Turned and twisted runs.
  'gadroon',
  'bobbin',
  'barleyTwist',
  'rope',

  // The classical enrichments, in the order they sit on an entablature.
  'dentil',
  'modillion',
  'eggDart',
  'beadReel',
  'waterLeaf',
  'guilloche',
  'vitruvian',
  'greekKey',

  // Gothic and Norman.
  'blindArcade',
  'trefoil',
  'quatrefoil',
  'dogtooth',
  'billet',
  'chevron',
  'lunette',

  // Frets and geometry.
  'lattice',
  'chineseFret',
  'lozenge',
  'diaper',
  'strapwork',
  'sunburst',

  // Veneer and inlay: contrasting timber laid in, never cut.
  'crossband',
  'chequer',
  'herringbone',
  'bookMatch',
  'cube',
  'marquetry',
  'oyster',
  'burl',

  // Worked surfaces — carved, punched, woven, hewn.
  'linenfold',
  'chipCarve',
  'gouged',
  'dotPunch',
  'cane',
  'adzed',
  'sawn',
  'wormy',
  'tiled',
  'notched',
] as const;

export type PatternId = (typeof PATTERN_IDS)[number];

/** What the shelf is made of and what is worked into it. */
export interface ShelfDesign {
  build: BuildId;
  pattern: PatternId;
}

/**
 * What a caller may hand in: anything, including junk out of the database.
 *
 * Persisted values reach these functions straight from SQLite, so `resolve`
 * has to be total. It is the same contract the script parser works under — a
 * bad row must give you the house bookcase, not an exception in a bake.
 */
export type ShelfDesignInput = Partial<ShelfDesign> | null | undefined;

/**
 * The carpentry a new library opens in.
 *
 * NOT `plank` + `none` any more, and the reason is the whole of the reader's
 * complaint that the opening bookcase looked "boring/bland/cheap". A plain
 * plank case is four boards, two uprights and a flat board of a cornice, so
 * the largest object on screen was a single uninterrupted rectangle of one
 * colour with a hairline across it every floor. No palette fixes that: twenty
 * rooms were photographed on the plank case and every one of them read as a
 * coloured slab (`shots-now/defaults/board-b.png`).
 *
 * `scriptorium` is the same four parts with carpentry in them. It brings three
 * things the plank has none of, and each was chosen by looking rather than by
 * reading the table:
 *
 *  - an ARCADE over the recess. Round-headed bays behind the books break the
 *    slab into a rhythm, which is what stops an empty shelf reading as a hole.
 *    Twelve builds were shot side by side and the arch-opening ones were the
 *    only group that solved it (`board-c.png`, `board-d.png`).
 *  - a STEPPED cornice under a DENTIL crest. The crest is the one edge in the
 *    case a build can genuinely change, and `world.ts` stands the plinth out
 *    of the same bitmap mirrored — teeth invert into a dentil apron, so the
 *    case gains a moulded top AND a moulded foot from one drawing.
 *  - COLUMNS on the uprights, which the fluting-family patterns can work on.
 *
 * `guilloche` is the pattern, and it was picked at 1:1 rather than magnified
 * (`board-pattern-1to1.png`): at real shelf zoom the edge-work patterns
 * (`stringing`, `cockBead`, `beaded`, `reeded`, `fluted`) are below the
 * threshold where anything reads at all, and the bold frets (`greekKey`,
 * `crossband`) read as a printed border. Guilloche lands between them — a run
 * of small rings with a boss in each, which at this size reads as a fine bead
 * chain along every board edge and down the posts, and its round beads agree
 * with both the round arches and the gilt cornice studs.
 *
 * ## This constant also answers "what does junk resolve to"
 *
 * `resolveShelfDesign` and `getBuild` fall back to it, so a corrupted row now
 * opens on the scriptorium rather than on the bare plank. That is the same
 * double duty `DEFAULT_WALLPAPER_ID` was split out of (see the note beside
 * `FALLBACK_WALLPAPER_ID`), and it wants the same split here — one constant
 * for the opening carpentry, one for the unknown-id fallback. It is left
 * merged only because the split moves assertions in
 * `tests/design-cache-keys.test.ts`, and unlike the wallpaper case nothing
 * misleads a reader in the meantime: both values are total, both are drawable,
 * and the cache key carries `shelfDesignTag` either way.
 */
export const DEFAULT_SHELF_DESIGN: ShelfDesign = {
  build: 'scriptorium',
  pattern: 'guilloche',
};

export function isBuildId(value: unknown): value is BuildId {
  return typeof value === 'string' && (BUILD_IDS as readonly string[]).includes(value);
}

export function isPatternId(value: unknown): value is PatternId {
  return typeof value === 'string' && (PATTERN_IDS as readonly string[]).includes(value);
}

/** Total: unknown ids fall back to the house case, field by field. */
export function resolveShelfDesign(input: ShelfDesignInput): ShelfDesign {
  if (input === null || input === undefined) return DEFAULT_SHELF_DESIGN;
  return {
    build: isBuildId(input.build) ? input.build : DEFAULT_SHELF_DESIGN.build,
    pattern: isPatternId(input.pattern) ? input.pattern : DEFAULT_SHELF_DESIGN.pattern,
  };
}

/**
 * A short stable tag for a design, for cache keys.
 *
 * The build and the pattern are a NEW axis of variation in every drawing this
 * module touches, which means every cache holding those pixels has to carry
 * this next to `flatSchemeTag()`. The disk cache in `art/bake.ts` validates
 * nothing about a hit: a plank baked as a gothic case and stored under a
 * design-blind key would be served to every case on the machine, forever.
 */
export function shelfDesignTag(design: ShelfDesignInput): string {
  const d = resolveShelfDesign(design);
  return `${d.build}.${d.pattern}`;
}

/* ----------------------------------------------------------------------------
   The builds
   -------------------------------------------------------------------------- */

/** Extra carpentry worked onto the shelf board itself. */
type PlankTrim =
  | 'none'
  | 'lip'
  | 'bead'
  | 'cleat'
  | 'rail'
  | 'peg'
  | 'knob'
  | 'scallop'
  | 'dentil'
  | 'nulling'
  | 'tray'
  | 'strap'
  | 'chamfer';

/** Extra carpentry on the upright. */
type PostTrim =
  | 'none'
  | 'stile'
  | 'column'
  | 'ladder'
  | 'batten'
  | 'slab'
  | 'pilaster'
  | 'chamfer'
  | 'turned'
  | 'bracket'
  | 'strap';

/** What fills the opening between the uprights, drawn over the recess. */
type OpeningKind =
  | 'plain'
  | 'frame'
  | 'arch'
  | 'gothic'
  | 'ogee'
  | 'trefoil'
  | 'valance'
  | 'divided'
  | 'grid'
  | 'crate'
  | 'glass'
  | 'fret'
  | 'spindle'
  | 'xbrace'
  | 'ledge'
  | 'panelled'
  | 'dovecote';

/**
 * The cornice's profile: how its face is banded from the corona down to the
 * underside. Always full width — see `drawCrownBody`.
 */
type CorniceKind = 'board' | 'bedMould' | 'stepped' | 'frieze' | 'reeded' | 'slab' | 'rail';

/**
 * The silhouette cut into the cornice's top edge.
 *
 * The one edge in the whole case with nothing above it, and therefore the one
 * a build can genuinely change. It is CUT, not applied: the crest and the body
 * are one path, filled once and inked once (see `crownPath`).
 *
 * Every crest is chosen to survive being turned upside down, because `world.ts`
 * stands the plinth under the case out of this same bitmap mirrored. A gable
 * inverts into an arrowhead and battlements into broken teeth, so the crests
 * here are the ones that invert into apron shapes a joiner would actually cut:
 * scallops become a valance, teeth become a dentil apron, blocks become feet.
 */
type CrestKind =
  | 'flat'
  | 'battlement'
  | 'scallop'
  | 'sawtooth'
  | 'pediment'
  | 'finial'
  | 'dentil'
  | 'wave'
  | 'steps';

/**
 * Words for what a build FEELS like, so randomisation can be steered.
 *
 * Multiple per build and deliberately overlapping — "give me something goofy"
 * and "give me something rustic" should both be able to reach the treehouse.
 */
export type BuildTag =
  | 'plain'
  | 'formal'
  | 'refined'
  | 'ornate'
  | 'fancy'
  | 'goofy'
  | 'rustic'
  | 'natural'
  | 'cosy'
  | 'severe'
  | 'airy'
  | 'heavy'
  | 'antique'
  | 'modern'
  | 'whimsical'
  | 'utilitarian';

/** Every tag, in the order a picker should offer them. */
export const BUILD_TAGS: readonly BuildTag[] = [
  'plain',
  'formal',
  'refined',
  'ornate',
  'fancy',
  'goofy',
  'whimsical',
  'cosy',
  'rustic',
  'natural',
  'antique',
  'modern',
  'severe',
  'airy',
  'heavy',
  'utilitarian',
];

export function isBuildTag(value: unknown): value is BuildTag {
  return typeof value === 'string' && (BUILD_TAGS as readonly string[]).includes(value);
}

/**
 * One carpentry, as numbers the four part-drawers read.
 *
 * Deliberately data rather than four switch statements: a build has to hold
 * together ACROSS the parts — a gothic opening under a scalloped cottage
 * cornice is two builds fighting — and a table makes that legible in one
 * screenful. It is also what makes fifty of them buildable at this quality:
 * every field names a piece of carpentry that was drawn once and vetted at
 * true shelf size, so a build is a composition rather than a fresh drawing.
 */
export interface BuildSpec {
  id: BuildId;
  name: string;
  /** One line for the studio card. */
  blurb: string;
  /** What this build feels like. At least two, so a steer has something to hit. */
  tags: readonly BuildTag[];
  /** Board: fraction of its height that reads as the front edge. */
  plankEdge: number;
  /** Board: corner radius as a fraction of its height, on its free corners only. */
  plankRadius: number;
  plankTrim: PlankTrim;
  /**
   * Upright: fraction of the given width the shaft occupies.
   *
   * Flush to the OUTBOARD side, never centred. The leftover has to fall inboard
   * where there is an opening behind it to show; centred, half of it landed on
   * the case's outer face and painted a stripe of the case's own interior down
   * the outside of the bookcase.
   */
  postShaft: number;
  postTrim: PostTrim;
  opening: OpeningKind;
  crown: CorniceKind;
  crest: CrestKind;
  /** Gilt studs along the cornice frieze. Off for builds that carry their own crest. */
  crownStuds: boolean;
}

function build(
  id: BuildId,
  name: string,
  blurb: string,
  tags: readonly BuildTag[],
  spec: Omit<BuildSpec, 'id' | 'name' | 'blurb' | 'tags'>,
): BuildSpec {
  return { id, name, blurb, tags, ...spec };
}

/** Every carpentry, keyed by id. */
export const BUILDS: Readonly<Record<BuildId, BuildSpec>> = {
  /* ---- quiet carpentry ---- */

  plank: build('plank', 'Plain Plank', 'A board, two uprights, nothing in the way of the books.',
    ['plain', 'natural', 'utilitarian'],
    { plankEdge: 0.28, plankRadius: 0.22, plankTrim: 'none', postShaft: 1, postTrim: 'none',
      opening: 'plain', crown: 'board', crest: 'flat', crownStuds: true }),

  shaker: build('shaker', 'Shaker', 'Every arris taken off with two strokes of a plane, and nothing else.',
    ['plain', 'refined', 'natural'],
    { plankEdge: 0.24, plankRadius: 0.1, plankTrim: 'chamfer', postShaft: 1, postTrim: 'chamfer',
      opening: 'plain', crown: 'board', crest: 'flat', crownStuds: false }),

  schoolroom: build('schoolroom', 'Schoolroom', 'A ledge along every shelf, worn smooth by a century of satchels.',
    ['plain', 'utilitarian', 'antique'],
    { plankEdge: 0.3, plankRadius: 0.12, plankTrim: 'lip', postShaft: 1, postTrim: 'stile',
      opening: 'ledge', crown: 'bedMould', crest: 'flat', crownStuds: true }),

  atelier: build('atelier', 'Atelier', 'Thin uprights, thin boards, and as much air as the books allow.',
    ['modern', 'plain', 'airy'],
    { plankEdge: 0.2, plankRadius: 0.06, plankTrim: 'none', postShaft: 0.72, postTrim: 'none',
      opening: 'plain', crown: 'rail', crest: 'flat', crownStuds: false }),

  ladder: build('ladder', 'Ladder Shelf', 'Slim rails with rungs; the boards are simply laid across them.',
    ['plain', 'airy', 'modern'],
    { plankEdge: 0.22, plankRadius: 0.3, plankTrim: 'rail', postShaft: 0.56, postTrim: 'ladder',
      opening: 'plain', crown: 'rail', crest: 'flat', crownStuds: false }),

  workbench: build('workbench', 'Workbench', 'Strapped and braced, built to be stood on rather than admired.',
    ['utilitarian', 'heavy', 'rustic'],
    { plankEdge: 0.36, plankRadius: 0.08, plankTrim: 'strap', postShaft: 1, postTrim: 'strap',
      opening: 'xbrace', crown: 'slab', crest: 'flat', crownStuds: false }),

  /* ---- cabinet work ---- */

  faceFrame: build('faceFrame', 'Face Frame', 'Cabinet work: a proud rail on every board and a framed opening.',
    ['formal', 'refined', 'plain'],
    { plankEdge: 0.3, plankRadius: 0.14, plankTrim: 'lip', postShaft: 1, postTrim: 'stile',
      opening: 'frame', crown: 'stepped', crest: 'flat', crownStuds: true }),

  barrister: build('barrister', 'Barrister', 'Glazed fronts hinted at by their sashes, with a pull on every board.',
    ['formal', 'refined', 'antique'],
    { plankEdge: 0.26, plankRadius: 0.16, plankTrim: 'knob', postShaft: 1, postTrim: 'stile',
      opening: 'glass', crown: 'stepped', crest: 'flat', crownStuds: true }),

  bookbinder: build('bookbinder', 'Bookbinder', 'Beaded boards between fielded pilasters, under a course of teeth.',
    ['refined', 'formal', 'antique'],
    { plankEdge: 0.28, plankRadius: 0.18, plankTrim: 'bead', postShaft: 1, postTrim: 'pilaster',
      opening: 'frame', crown: 'bedMould', crest: 'dentil', crownStuds: true }),

  conservatory: build('conservatory', 'Conservatory', 'Slender glazing bars and a finial at each end of the cornice.',
    ['airy', 'refined', 'formal'],
    { plankEdge: 0.22, plankRadius: 0.2, plankTrim: 'lip', postShaft: 0.9, postTrim: 'stile',
      opening: 'glass', crown: 'board', crest: 'finial', crownStuds: true }),

  orangery: build('orangery', 'Orangery', 'Round-headed bays under a scalloped cresting, all light and lime.',
    ['airy', 'refined', 'ornate'],
    { plankEdge: 0.24, plankRadius: 0.24, plankTrim: 'bead', postShaft: 0.9, postTrim: 'pilaster',
      opening: 'arch', crown: 'bedMould', crest: 'scallop', crownStuds: true }),

  campaign: build('campaign', 'Campaign Chest', 'Brass straps and corner brackets: a bookcase that has been shipped.',
    ['utilitarian', 'formal', 'antique'],
    { plankEdge: 0.32, plankRadius: 0.08, plankTrim: 'strap', postShaft: 1, postTrim: 'bracket',
      opening: 'panelled', crown: 'slab', crest: 'flat', crownStuds: true }),

  vestry: build('vestry', 'Vestry', 'Deep panels and a plain frieze. Sober, and rather good at it.',
    ['formal', 'severe', 'antique'],
    { plankEdge: 0.3, plankRadius: 0.1, plankTrim: 'lip', postShaft: 1, postTrim: 'pilaster',
      opening: 'panelled', crown: 'frieze', crest: 'flat', crownStuds: false }),

  /* ---- compartments and grids ---- */

  apothecary: build('apothecary', 'Apothecary', 'Many small compartments behind the books, and a dentil course above.',
    ['refined', 'utilitarian', 'antique'],
    { plankEdge: 0.32, plankRadius: 0.12, plankTrim: 'cleat', postShaft: 0.9, postTrim: 'batten',
      opening: 'divided', crown: 'bedMould', crest: 'dentil', crownStuds: false }),

  pigeonhole: build('pigeonhole', 'Pigeonhole', 'A fine grid of cubbies — a sorting office that took up reading.',
    ['utilitarian', 'plain', 'antique'],
    { plankEdge: 0.24, plankRadius: 0.12, plankTrim: 'none', postShaft: 0.85, postTrim: 'stile',
      opening: 'grid', crown: 'board', crest: 'flat', crownStuds: false }),

  mercantile: build('mercantile', 'Mercantile', 'Counter-shop carpentry: toothed boards over deep pigeon runs.',
    ['utilitarian', 'antique', 'formal'],
    { plankEdge: 0.3, plankRadius: 0.1, plankTrim: 'dentil', postShaft: 0.9, postTrim: 'batten',
      opening: 'divided', crown: 'stepped', crest: 'dentil', crownStuds: false }),

  rookery: build('rookery', 'Rookery', 'Too many small holes, arranged with more enthusiasm than plan.',
    ['whimsical', 'plain', 'cosy'],
    { plankEdge: 0.22, plankRadius: 0.16, plankTrim: 'none', postShaft: 0.8, postTrim: 'batten',
      opening: 'grid', crown: 'board', crest: 'scallop', crownStuds: false }),

  dovecote: build('dovecote', 'Dovecote', 'Little arched holes behind the books, as if something might nest.',
    ['whimsical', 'cosy', 'natural'],
    { plankEdge: 0.24, plankRadius: 0.2, plankTrim: 'bead', postShaft: 0.82, postTrim: 'batten',
      opening: 'dovecote', crown: 'board', crest: 'flat', crownStuds: false }),

  curiosity: build('curiosity', 'Curiosity Cabinet', 'Compartments, pulls and finials: everything is worth showing.',
    ['ornate', 'fancy', 'whimsical'],
    { plankEdge: 0.28, plankRadius: 0.14, plankTrim: 'knob', postShaft: 0.88, postTrim: 'pilaster',
      opening: 'divided', crown: 'bedMould', crest: 'finial', crownStuds: true }),

  /* ---- the classical orders ---- */

  arch: build('arch', 'Arch Opening', 'Round-headed bays, the way a reading room carries its ceiling.',
    ['formal', 'refined', 'airy'],
    { plankEdge: 0.26, plankRadius: 0.24, plankTrim: 'bead', postShaft: 1, postTrim: 'none',
      opening: 'arch', crown: 'board', crest: 'flat', crownStuds: true }),

  cloister: build('cloister', 'Cloister', 'An arcade on plain columns under a deep, undecorated frieze.',
    ['formal', 'severe', 'antique'],
    { plankEdge: 0.26, plankRadius: 0.18, plankTrim: 'bead', postShaft: 0.94, postTrim: 'column',
      opening: 'arch', crown: 'frieze', crest: 'flat', crownStuds: false }),

  colonnade: build('colonnade', 'Cornice & Column', 'Columns with capitals, carrying a pedimented entablature.',
    ['formal', 'ornate', 'antique'],
    { plankEdge: 0.26, plankRadius: 0.18, plankTrim: 'bead', postShaft: 0.86, postTrim: 'column',
      opening: 'frame', crown: 'frieze', crest: 'pediment', crownStuds: true }),

  scriptorium: build('scriptorium', 'Scriptorium', 'A stepped cornice with teeth, over an arcade you could work under.',
    ['formal', 'antique', 'refined'],
    { plankEdge: 0.28, plankRadius: 0.16, plankTrim: 'lip', postShaft: 0.92, postTrim: 'column',
      opening: 'arch', crown: 'stepped', crest: 'dentil', crownStuds: true }),

  observatory: build('observatory', 'Observatory', 'Turned uprights and finials, for instruments as much as books.',
    ['formal', 'ornate', 'fancy'],
    { plankEdge: 0.26, plankRadius: 0.2, plankTrim: 'bead', postShaft: 0.9, postTrim: 'turned',
      opening: 'arch', crown: 'bedMould', crest: 'finial', crownStuds: true }),

  parlour: build('parlour', 'Parlour', 'Nulled boards and a reeded cornice: the good room, kept for company.',
    ['cosy', 'refined', 'fancy'],
    { plankEdge: 0.26, plankRadius: 0.22, plankTrim: 'nulling', postShaft: 0.95, postTrim: 'pilaster',
      opening: 'frame', crown: 'reeded', crest: 'scallop', crownStuds: true }),

  /* ---- gothic ---- */

  gothic: build('gothic', 'Gothic Arch', 'Pointed bays under a battlemented cornice.',
    ['ornate', 'severe', 'antique'],
    { plankEdge: 0.24, plankRadius: 0.12, plankTrim: 'bead', postShaft: 0.92, postTrim: 'column',
      opening: 'gothic', crown: 'bedMould', crest: 'battlement', crownStuds: false }),

  chapel: build('chapel', 'Chapel', 'Trefoil heads in every bay, and battlements to finish the wall.',
    ['ornate', 'severe', 'formal'],
    { plankEdge: 0.26, plankRadius: 0.1, plankTrim: 'dentil', postShaft: 0.9, postTrim: 'pilaster',
      opening: 'trefoil', crown: 'frieze', crest: 'battlement', crownStuds: false }),

  minster: build('minster', 'Minster', 'Pointed bays under a gabled run — the whole nave, at shelf scale.',
    ['ornate', 'antique', 'severe'],
    { plankEdge: 0.28, plankRadius: 0.1, plankTrim: 'lip', postShaft: 0.9, postTrim: 'column',
      opening: 'gothic', crown: 'stepped', crest: 'sawtooth', crownStuds: false }),

  refectory: build('refectory', 'Refectory', 'Ogee heads on heavy pegged timber. Built to outlast the order.',
    ['heavy', 'antique', 'severe'],
    { plankEdge: 0.34, plankRadius: 0.1, plankTrim: 'peg', postShaft: 1, postTrim: 'slab',
      opening: 'ogee', crown: 'slab', crest: 'flat', crownStuds: false }),

  lychgate: build('lychgate', 'Lychgate', 'Strapped oak and an ogee opening, as if it stood out in the weather.',
    ['rustic', 'antique', 'heavy'],
    { plankEdge: 0.32, plankRadius: 0.14, plankTrim: 'strap', postShaft: 0.95, postTrim: 'strap',
      opening: 'ogee', crown: 'board', crest: 'sawtooth', crownStuds: false }),

  /* ---- cottage, fret and fancy ---- */

  valance: build('valance', 'Scalloped Valance', 'A fretted pelmet hangs over every shelf; the cornice waves back.',
    ['cosy', 'whimsical', 'fancy'],
    { plankEdge: 0.28, plankRadius: 0.28, plankTrim: 'scallop', postShaft: 1, postTrim: 'none',
      opening: 'valance', crown: 'board', crest: 'scallop', crownStuds: true }),

  cottage: build('cottage', 'Cottage', 'Chamfered posts, a pelmet, and a cornice that will not lie straight.',
    ['cosy', 'natural', 'whimsical'],
    { plankEdge: 0.26, plankRadius: 0.26, plankTrim: 'bead', postShaft: 1, postTrim: 'chamfer',
      opening: 'valance', crown: 'board', crest: 'wave', crownStuds: false }),

  tearoom: build('tearoom', 'Tea Room', 'Turned spindles across the top of every bay, and nulled boards under.',
    ['cosy', 'refined', 'fancy'],
    { plankEdge: 0.24, plankRadius: 0.24, plankTrim: 'nulling', postShaft: 0.92, postTrim: 'turned',
      opening: 'spindle', crown: 'reeded', crest: 'scallop', crownStuds: true }),

  gingerbread: build('gingerbread', 'Gingerbread', 'Scallops on the boards, scallops in the bays, a wave on top.',
    ['goofy', 'fancy', 'whimsical'],
    { plankEdge: 0.26, plankRadius: 0.3, plankTrim: 'scallop', postShaft: 0.88, postTrim: 'turned',
      opening: 'valance', crown: 'reeded', crest: 'wave', crownStuds: true }),

  chinoiserie: build('chinoiserie', 'Fretwork', 'A geometric fret across every opening, stepped at the cornice.',
    ['ornate', 'fancy', 'refined'],
    { plankEdge: 0.24, plankRadius: 0.16, plankTrim: 'lip', postShaft: 0.9, postTrim: 'pilaster',
      opening: 'fret', crown: 'stepped', crest: 'steps', crownStuds: true }),

  pagoda: build('pagoda', 'Pagoda', 'Stepped eaves and a run of spindles: a tea house that reads.',
    ['whimsical', 'ornate', 'fancy'],
    { plankEdge: 0.26, plankRadius: 0.2, plankTrim: 'tray', postShaft: 0.86, postTrim: 'turned',
      opening: 'spindle', crown: 'board', crest: 'steps', crownStuds: true }),

  seaside: build('seaside', 'Seaside', 'Beadboard, spindles and a rolling cornice. Salt not included.',
    ['cosy', 'airy', 'whimsical'],
    { plankEdge: 0.22, plankRadius: 0.28, plankTrim: 'bead', postShaft: 0.9, postTrim: 'chamfer',
      opening: 'spindle', crown: 'board', crest: 'wave', crownStuds: false }),

  galleon: build('galleon', 'Galleon', 'A carved wave along the top and an arcade like a stern gallery.',
    ['fancy', 'ornate', 'whimsical'],
    { plankEdge: 0.3, plankRadius: 0.26, plankTrim: 'nulling', postShaft: 0.94, postTrim: 'turned',
      opening: 'arch', crown: 'reeded', crest: 'wave', crownStuds: true }),

  carnival: build('carnival', 'Carnival', 'Pulls like brass buttons and a sawtooth awning. Loud, on purpose.',
    ['goofy', 'fancy', 'whimsical'],
    { plankEdge: 0.28, plankRadius: 0.32, plankTrim: 'knob', postShaft: 0.86, postTrim: 'turned',
      opening: 'valance', crown: 'board', crest: 'sawtooth', crownStuds: true }),

  toybox: build('toybox', 'Toy Box', 'Fat rounded boards, corner blocks and a big brass knob.',
    ['goofy', 'cosy', 'whimsical'],
    { plankEdge: 0.34, plankRadius: 0.34, plankTrim: 'knob', postShaft: 0.9, postTrim: 'bracket',
      opening: 'crate', crown: 'slab', crest: 'scallop', crownStuds: true }),

  beehive: build('beehive', 'Beehive', 'Rounded cells stacked in courses, and a reeded skep of a cornice.',
    ['whimsical', 'cosy', 'natural'],
    { plankEdge: 0.26, plankRadius: 0.3, plankTrim: 'bead', postShaft: 0.85, postTrim: 'turned',
      opening: 'dovecote', crown: 'reeded', crest: 'scallop', crownStuds: false }),

  windmill: build('windmill', 'Windmill', 'Braced bays and a sawtooth crest, like a sail caught mid-turn.',
    ['whimsical', 'rustic', 'goofy'],
    { plankEdge: 0.3, plankRadius: 0.18, plankTrim: 'strap', postShaft: 0.9, postTrim: 'strap',
      opening: 'xbrace', crown: 'board', crest: 'sawtooth', crownStuds: false }),

  /* ---- rustic ---- */

  crate: build('crate', 'Crate Stack', 'Stacked packing crates: corner blocks, batten ends, no ceremony.',
    ['rustic', 'plain', 'utilitarian'],
    { plankEdge: 0.34, plankRadius: 0.1, plankTrim: 'cleat', postShaft: 0.95, postTrim: 'batten',
      opening: 'crate', crown: 'slab', crest: 'flat', crownStuds: false }),

  steamer: build('steamer', 'Steamer Trunk', 'Banded and bossed, as though it had been round the world twice.',
    ['antique', 'utilitarian', 'heavy'],
    { plankEdge: 0.32, plankRadius: 0.12, plankTrim: 'strap', postShaft: 0.95, postTrim: 'strap',
      opening: 'crate', crown: 'slab', crest: 'flat', crownStuds: true }),

  slab: build('slab', 'Rustic Slab', 'Thick pegged boards on rough uprights, planed once and left alone.',
    ['rustic', 'heavy', 'natural'],
    { plankEdge: 0.38, plankRadius: 0.3, plankTrim: 'peg', postShaft: 1, postTrim: 'slab',
      opening: 'plain', crown: 'slab', crest: 'flat', crownStuds: false }),

  cabin: build('cabin', 'Log Cabin', 'Round uprights, braced bays, and boards pegged straight through.',
    ['rustic', 'heavy', 'natural'],
    { plankEdge: 0.36, plankRadius: 0.34, plankTrim: 'peg', postShaft: 1, postTrim: 'turned',
      opening: 'xbrace', crown: 'slab', crest: 'flat', crownStuds: false }),

  driftwood: build('driftwood', 'Driftwood', 'Every edge worn round and every line slightly out of true.',
    ['rustic', 'natural', 'plain'],
    { plankEdge: 0.3, plankRadius: 0.3, plankTrim: 'chamfer', postShaft: 0.92, postTrim: 'chamfer',
      opening: 'plain', crown: 'board', crest: 'wave', crownStuds: false }),

  hayloft: build('hayloft', 'Hayloft', 'Ladder rails and a braced back, with as much daylight as timber.',
    ['rustic', 'airy', 'natural'],
    { plankEdge: 0.26, plankRadius: 0.16, plankTrim: 'rail', postShaft: 0.6, postTrim: 'ladder',
      opening: 'xbrace', crown: 'rail', crest: 'flat', crownStuds: false }),

  sawmill: build('sawmill', 'Sawmill', 'Toothed boards and a sawtooth crest. The blade left its opinion.',
    ['rustic', 'utilitarian', 'heavy'],
    { plankEdge: 0.34, plankRadius: 0.06, plankTrim: 'dentil', postShaft: 0.96, postTrim: 'batten',
      opening: 'ledge', crown: 'slab', crest: 'sawtooth', crownStuds: false }),

  stable: build('stable', 'Stable', 'Strapped uprights and a plate rail, built for tack and taking books.',
    ['rustic', 'heavy', 'natural'],
    { plankEdge: 0.34, plankRadius: 0.12, plankTrim: 'strap', postShaft: 1, postTrim: 'strap',
      opening: 'ledge', crown: 'board', crest: 'flat', crownStuds: false }),

  tavern: build('tavern', 'Tavern', 'Turned posts, pegged boards and spindles over every bay.',
    ['rustic', 'cosy', 'antique'],
    { plankEdge: 0.32, plankRadius: 0.22, plankTrim: 'peg', postShaft: 0.95, postTrim: 'turned',
      opening: 'spindle', crown: 'board', crest: 'scallop', crownStuds: false }),

  treehouse: build('treehouse', 'Treehouse', 'Rungs, braces and pegs, nailed up by somebody in a hurry.',
    ['goofy', 'rustic', 'whimsical'],
    { plankEdge: 0.3, plankRadius: 0.34, plankTrim: 'peg', postShaft: 0.86, postTrim: 'ladder',
      opening: 'xbrace', crown: 'board', crest: 'sawtooth', crownStuds: false }),
};

/** Every build carrying `tag`, in picker order. For steered randomisation. */
export function buildsTagged(tag: BuildTag): readonly BuildSpec[] {
  return BUILD_IDS.map((id) => BUILDS[id]).filter((b) => b.tags.includes(tag));
}

/** What a build feels like. Empty for an unknown id, never a throw. */
export function tagsOf(id: unknown): readonly BuildTag[] {
  return isBuildId(id) ? BUILDS[id].tags : [];
}

/** All builds in picker order. */
export function allBuilds(): readonly BuildSpec[] {
  return BUILD_IDS.map((id) => BUILDS[id]);
}

/** Look up a carpentry; unknown ids give the house one. */
export function getBuild(id: unknown): BuildSpec {
  return BUILDS[isBuildId(id) ? id : DEFAULT_SHELF_DESIGN.build];
}

/* ----------------------------------------------------------------------------
   The patterns
   -------------------------------------------------------------------------- */

export interface PatternSpec {
  id: PatternId;
  name: string;
  blurb: string;
  /**
   * Mood words, read by `views/rail/designOptions.ts` → `tagsOf`.
   *
   * Their job is to STEER the dice, not to catalogue: the studio's roll picks
   * a build, a pattern, a paper and a palette independently, and a mood is
   * what stops "surprise me" from putting a Greek key on a crate. So the
   * vocabulary is deliberately short and shared with the builds — a word only
   * one design in a hundred carries narrows the roll to a preset with extra
   * steps.
   */
  tags: readonly string[];
}

/**
 * Every treatment: id, name, one line for the card, and its moods.
 *
 * The blurbs name the real thing — a cabinetmaker's word for it, not a
 * description of the marks. "Two courses of strokes leaning against each
 * other" is what the old herringbone drew; it is not what herringbone IS, and
 * writing the honest name is what forced the drawing to become honest too.
 */
const PATTERN_TABLE: readonly (readonly [PatternId, string, string, readonly string[]])[] = [
  ['none', 'Plain', 'Bare timber. The books do the talking.', ['plain']],

  ['stringing', 'Stringing', 'Two hair-fine lines of pale wood let into the face.', ['plain', 'fine', 'inlay']],
  ['cockBead', 'Cock Bead', 'A small half-round standing proud of each edge.', ['plain', 'fine', 'carved']],
  ['beaded', 'Bead & Quirk', 'A run of touching half-rounds, sunk between two quirks.', ['fine', 'carved', 'classical']],
  ['reeded', 'Reeded', 'Fluting inside out: the timber left proud in half-round reeds.', ['fine', 'carved', 'classical']],
  ['fluted', 'Fluted', 'Round-bottomed grooves with narrow fillets between them.', ['classical', 'carved', 'grand']],
  ['cableFlute', 'Cabled Flute', 'Flutes with a carved cord laid into every other one.', ['classical', 'grand', 'carved']],

  ['gadroon', 'Gadrooned', 'A run of fat lobes leaning together, as a silver rim does.', ['grand', 'carved', 'bold']],
  ['bobbin', 'Bobbin', 'Ball and reel, turned on a lathe and run along the timber.', ['cottage', 'carved', 'folk']],
  ['barleyTwist', 'Barley Twist', 'The spiral of a barley-sugar column, opened out flat.', ['grand', 'carved', 'nautical']],
  ['rope', 'Rope Twist', 'A tight carved cable between two quirks.', ['nautical', 'carved', 'bold']],

  ['dentil', 'Dentil', 'Teeth hanging below a corona, with the gaps cut clean through.', ['classical', 'grand', 'bold']],
  ['modillion', 'Modillion', 'Scrolled brackets carrying the corona, spaced wide.', ['classical', 'grand', 'bold']],
  ['eggDart', 'Egg & Dart', 'The oldest enrichment there is: an egg, an arrowhead, repeat.', ['classical', 'grand', 'carved']],
  ['beadReel', 'Bead & Reel', 'Two beads and a reel, the astragal enriched.', ['classical', 'fine', 'carved']],
  ['waterLeaf', 'Water Leaf', 'Leaf and dart, alternating along the moulding.', ['classical', 'fine', 'carved']],
  ['guilloche', 'Guilloche', 'Interlaced rings plaited along the band, a boss in every eye.', ['classical', 'grand', 'geometric']],
  ['vitruvian', 'Vitruvian Wave', 'A running scroll, breaking the same way every time.', ['classical', 'grand', 'carved']],
  ['greekKey', 'Greek Key', 'The meander, folded and folded back.', ['classical', 'geometric', 'bold']],

  ['blindArcade', 'Blind Arcade', 'A run of pointed arches cut into the solid.', ['gothic', 'carved', 'bold']],
  ['trefoil', 'Trefoil', 'Three-lobed tracery, pierced through the band.', ['gothic', 'fine', 'carved']],
  ['quatrefoil', 'Quatrefoil', 'Four lobes and a point: the tracery of a chantry screen.', ['gothic', 'geometric', 'carved']],
  ['dogtooth', 'Dog Tooth', 'Norman pyramids, each cut on four faces.', ['gothic', 'bold', 'carved']],
  ['billet', 'Billet', 'Short cylinders in two staggered rows. Pure Romanesque.', ['gothic', 'bold', 'geometric']],
  ['chevron', 'Chevron', 'The Norman zigzag, chopped as a V-groove.', ['gothic', 'bold', 'geometric']],
  ['lunette', 'Lunette', 'Jacobean half-moons, each with a fan struck inside it.', ['gothic', 'folk', 'carved']],

  ['lattice', 'Lattice', 'A trellis of crossed laths, square whatever it runs on.', ['geometric', 'cottage', 'fine']],
  ['chineseFret', 'Chinese Fret', 'Chippendale fretwork, alternating up and down.', ['geometric', 'fine', 'grand']],
  ['lozenge', 'Lozenge', 'Raised diamonds, point to point along the run.', ['geometric', 'bold', 'carved']],
  ['diaper', 'Diaper', 'An all-over Tudor grid, pricked at every crossing.', ['geometric', 'fine', 'gothic']],
  ['strapwork', 'Strapwork', 'Jacobean straps, buckled at intervals and pierced.', ['gothic', 'bold', 'geometric']],
  ['sunburst', 'Sunburst', 'A row of struck fans, rays out from the base line.', ['folk', 'bold', 'cottage']],

  ['crossband', 'Crossbanding', 'A border of short cross-grain strips around the field.', ['inlay', 'fine', 'grand']],
  ['chequer', 'Chequer Stringing', 'A fine two-course chequer, framed top and bottom.', ['inlay', 'fine', 'geometric']],
  ['herringbone', 'Herringbone', 'Parquetry: billets butted end to side, course against course.', ['inlay', 'geometric', 'grand']],
  ['bookMatch', 'Book-Match', 'Two leaves of veneer opened like a book about the centre.', ['inlay', 'grand', 'fine']],
  ['cube', 'Tumbling Block', 'Three tones of timber, and the eye insists they are cubes.', ['inlay', 'geometric', 'bold']],
  ['marquetry', 'Marquetry Band', 'Pale and dark triangles let in between two strings.', ['inlay', 'geometric', 'grand']],
  ['oyster', 'Oyster Veneer', 'Laburnum cut across the branch: rings, laid side by side.', ['inlay', 'grand', 'bold']],
  ['burl', 'Burr Panel', 'A burr of figured timber, framed by a string.', ['inlay', 'rustic', 'grand']],

  ['linenfold', 'Linenfold', 'Tudor panelling: cloth folded over and over, in oak.', ['gothic', 'carved', 'bold']],
  ['chipCarve', 'Chip Carving', 'Triangular chips taken out with a knife, row on row.', ['folk', 'rustic', 'carved']],
  ['gouged', 'Gouge Cut', 'Scallops bitten out of both edges with a gouge.', ['folk', 'rustic', 'carved']],
  ['dotPunch', 'Punched Ground', 'A sunk ground, matted all over with a ring punch.', ['folk', 'fine', 'carved']],
  ['cane', 'Caned', 'Laths woven over and under, with the holes between.', ['cottage', 'fine', 'folk']],
  ['adzed', 'Adzed', 'The scoops an adze leaves when a board is dressed by hand.', ['rustic', 'bold', 'folk']],
  ['sawn', 'Saw-Kerf', 'The fine slanting marks of a pit saw, left unplaned.', ['rustic', 'fine', 'plain']],
  ['wormy', 'Wormed Oak', 'Old timber: flight holes, and a track or two.', ['rustic', 'folk', 'fine']],
  ['tiled', 'Fielded Panels', 'Raised panels inside mitred frames, the way a wall is lined.', ['plain', 'bold', 'cottage']],
  ['notched', 'Notched', 'Vs chopped out of the edge until it is a saw.', ['rustic', 'folk', 'bold']],
];

export const PATTERNS: Readonly<Record<PatternId, PatternSpec>> = Object.fromEntries(
  PATTERN_TABLE.map(([id, name, blurb, tags]) => [id, { id, name, blurb, tags }]),
) as Record<PatternId, PatternSpec>;

/** All patterns in picker order. */
export function allPatterns(): readonly PatternSpec[] {
  return PATTERN_IDS.map((id) => PATTERNS[id]);
}

/* ----------------------------------------------------------------------------
   Named presets
   -------------------------------------------------------------------------- */

export interface ShelfPreset {
  /** `${build}.${pattern}`, which is also `shelfDesignTag` — stable forever. */
  id: string;
  name: string;
  blurb: string;
  build: BuildId;
  pattern: PatternId;
}

/**
 * Sixty named cases out of the hundred and forty-four the axes can make.
 *
 * A curated list rather than the full cross product, because most of the value
 * of a picker is that somebody already decided which combinations are good.
 * The remaining eighty-four are still reachable — `resolveShelfDesign` takes
 * any build with any pattern — they simply do not have names.
 *
 * `id` is derived from the pair, so a preset can never drift from what it
 * draws and a saved library keeps its case if this table is reordered.
 */
const PRESET_TABLE: readonly (readonly [BuildId, PatternId, string, string])[] = [
  ['plank', 'none', 'Reading Room', 'The house case. A board, an upright, and the books.'],
  ['plank', 'beaded', 'Beaded Board', 'The plain case with a bead run along every face.'],
  ['plank', 'dotPunch', 'Punchwork', 'Plain boards, pricked all over with a punch.'],
  ['plank', 'chequer', 'Chequer Run', 'A chequered inlay band down otherwise plain timber.'],
  ['plank', 'tiled', 'Panelled Plain', 'Plain carpentry divided into big offset panels.'],

  ['faceFrame', 'none', 'Cabinetmaker', 'Framed openings and proud rails, left undecorated.'],
  ['faceFrame', 'fluted', 'Fluted Frame', 'Cabinet work with grooves run down every stile.'],
  ['faceFrame', 'beaded', 'Beaded Frame', 'A bead on the frame, the way a joiner finishes an edge.'],
  ['faceFrame', 'dentil', 'Dentil Frame', 'Cabinet work with a course of small blocks along it.'],
  ['faceFrame', 'rope', 'Corded Frame', 'A carved cord following the framing.'],

  ['arch', 'none', 'Cloister', 'Round-headed bays and nothing else.'],
  ['arch', 'fluted', 'Fluted Cloister', 'Arched bays over fluted timber.'],
  ['arch', 'rope', 'Rope Cloister', 'Arched bays with a corded moulding.'],
  ['arch', 'chevron', 'Chevron Cloister', 'Romanesque: arches over a chevron band.'],
  ['arch', 'beaded', 'Bead & Arch', 'Arched bays with beading on every face.'],

  ['gothic', 'none', 'Chapter House', 'Pointed bays under battlements.'],
  ['gothic', 'lattice', 'Traceried', 'Pointed bays with lattice worked into the timber.'],
  ['gothic', 'dentil', 'Minster', 'Battlements over a dentil course.'],
  ['gothic', 'notched', 'Crenelled Oak', 'Notched timber under a notched cornice.'],
  ['gothic', 'chevron', 'Zigzag Norman', 'Pointed bays over the old zigzag.'],

  ['valance', 'none', 'Cottage Valance', 'A fretted pelmet over every shelf.'],
  ['valance', 'chequer', 'Chequered Valance', 'Scallops above a chequered band.'],
  ['valance', 'dotPunch', 'Punched Valance', 'Scallops over pricked timber.'],
  ['valance', 'herringbone', 'Weave & Scallop', 'A herringbone face under a fretted pelmet.'],
  ['valance', 'beaded', 'Beaded Valance', 'Scallops with a bead run beneath them.'],

  ['apothecary', 'none', 'Apothecary', 'Small compartments behind the books.'],
  ['apothecary', 'dentil', 'Dispensary', 'Compartments under a course of little blocks.'],
  ['apothecary', 'chequer', 'Chequered Apothecary', 'Compartments with a chequered inlay.'],
  ['apothecary', 'tiled', 'Tiled Apothecary', 'Compartments behind big panelled boards.'],
  ['apothecary', 'dotPunch', 'Pin-Punched Drawers', 'Compartments in timber pricked with a punch.'],

  ['barrister', 'none', 'Barrister', 'Sashed fronts and a pull on every board.'],
  ['barrister', 'fluted', 'Fluted Barrister', 'Glazed fronts over fluted uprights.'],
  ['barrister', 'dentil', 'Chambers', 'Sashed fronts with a dentil course.'],
  ['barrister', 'beaded', 'Beaded Barrister', 'Sashed fronts with beading on the boards.'],
  ['barrister', 'lattice', 'Latticed Barrister', 'Sashed fronts over a trellised face.'],

  ['pigeonhole', 'none', 'Pigeonhole', 'A fine grid of cubbies behind the books.'],
  ['pigeonhole', 'chequer', 'Chequered Pigeonhole', 'Cubbies with a chequered band on the boards.'],
  ['pigeonhole', 'tiled', 'Sorting Office', 'Cubbies behind coarse panelled boards.'],
  ['pigeonhole', 'dotPunch', 'Punched Pigeonhole', 'Cubbies in pricked timber.'],
  ['pigeonhole', 'beaded', 'Beaded Pigeonhole', 'Cubbies with beading along every board.'],

  ['colonnade', 'fluted', 'Cornice & Column', 'Fluted columns carrying a pediment.'],
  ['colonnade', 'none', 'Plain Order', 'Columns and a pediment, left unworked.'],
  ['colonnade', 'dentil', 'Corinthian', 'Columns under a dentilled pediment.'],
  ['colonnade', 'rope', 'Corded Order', 'Columns with a carved cord running through.'],
  ['colonnade', 'lattice', 'Latticed Order', 'Columns over a trellised face.'],

  ['crate', 'none', 'Crate Stack', 'Packing crates, corner blocks and all.'],
  ['crate', 'notched', 'Notched Crates', 'Crates chopped along every edge.'],
  ['crate', 'herringbone', 'Herringbone Crates', 'Crates built from cross-laid boards.'],
  ['crate', 'tiled', 'Stencilled Crates', 'Crates divided into big stencil panels.'],
  ['crate', 'dotPunch', 'Nailed Crates', 'Crates studded with nail heads.'],

  ['ladder', 'none', 'Ladder Shelf', 'Slim rails, rungs, and boards laid across.'],
  ['ladder', 'notched', 'Notched Ladder', 'Ladder rails with notches down them.'],
  ['ladder', 'rope', 'Corded Ladder', 'Ladder rails with a cord carved along them.'],
  ['ladder', 'chevron', 'Chevron Ladder', 'Ladder rails over a chevron band.'],
  ['ladder', 'fluted', 'Fluted Ladder', 'Ladder rails grooved down their length.'],

  ['slab', 'none', 'Rustic Slab', 'Thick pegged boards, planed once.'],
  ['slab', 'notched', 'Adzed Slab', 'Rough boards chopped along the edge.'],
  ['slab', 'herringbone', 'Chiselled Slab', 'Rough boards worked over with a chisel.'],
  ['slab', 'rope', 'Roped Slab', 'Rough boards with a cord cut into them.'],
  ['slab', 'chevron', 'Chevron Slab', 'Rough boards under a marching chevron.'],

  // One named case per carpentry added since, so no build reaches the studio
  // without a name — an unnamed tile is a tile nobody picks.
  ['shaker', 'none', 'Shaker', 'Chamfered and quiet. Nothing that is not doing a job.'],
  ['shaker', 'reeded', 'Reeded Shaker', 'Plain work with three reeds run down the timber.'],
  ['schoolroom', 'none', 'Schoolroom', 'A ledge on every shelf and no ceremony at all.'],
  ['atelier', 'none', 'Atelier', 'Thin uprights, thin boards, as much air as the books allow.'],
  ['workbench', 'none', 'Workbench', 'Braced and strapped. Built to be stood on.'],
  ['workbench', 'adzed', 'Hewn Bench', 'Braced timber left rough from the adze.'],

  ['bookbinder', 'none', 'Bookbinder', 'Beaded boards between pilasters, under a course of teeth.'],
  ['bookbinder', 'stringing', 'Inlaid Bindery', 'Cabinet work with a fine line of contrasting stringing.'],
  ['conservatory', 'none', 'Conservatory', 'Slender glazing bars and a finial at each end.'],
  ['orangery', 'none', 'Orangery', 'Arched bays under a scalloped cresting.'],
  ['orangery', 'guilloche', 'Braided Orangery', 'Arcades under a plaited band.'],
  ['campaign', 'none', 'Campaign Chest', 'Brass straps and corner brackets, packed for the voyage.'],
  ['vestry', 'none', 'Vestry', 'Deep panels and a plain frieze. Sober, and good at it.'],
  ['vestry', 'linenfold', 'Linenfold Vestry', 'Panelling carved as folded cloth.'],

  ['mercantile', 'none', 'Mercantile', 'Counter-shop carpentry over deep pigeon runs.'],
  ['rookery', 'none', 'Rookery', 'Too many small holes, arranged with more enthusiasm than plan.'],
  ['dovecote', 'none', 'Dovecote', 'Little arched holes, as if something might nest in them.'],
  ['curiosity', 'none', 'Curiosity Cabinet', 'Compartments, pulls and finials. Everything is worth showing.'],
  ['curiosity', 'marquetry', 'Marquetry Cabinet', 'A cabinet of curiosities, inlaid to match.'],

  ['cloister', 'none', 'Cloister', 'An arcade on plain columns under a deep frieze.'],
  ['cloister', 'blindArcade', 'Double Cloister', 'An arcade with a blind arcade worked into the timber.'],
  ['scriptorium', 'none', 'Scriptorium', 'A toothed cornice over an arcade you could work under.'],
  ['observatory', 'none', 'Observatory', 'Turned uprights and finials, for instruments as much as books.'],
  ['parlour', 'none', 'Parlour', 'Nulled boards and a reeded cornice. The good room.'],
  ['parlour', 'gadroon', 'Gadrooned Parlour', 'The good room, with every edge lobed.'],

  ['chapel', 'none', 'Chapel', 'Trefoil heads in every bay and battlements above.'],
  ['chapel', 'quatrefoil', 'Traceried Chapel', 'Tracery in the heads and tracery in the timber.'],
  ['minster', 'none', 'Minster', 'Pointed bays under a gabled run.'],
  ['refectory', 'none', 'Refectory', 'Ogee heads on heavy pegged timber.'],
  ['lychgate', 'none', 'Lychgate', 'Strapped oak, as if it had stood out in the weather.'],

  ['cottage', 'none', 'Cottage', 'A pelmet, chamfered posts, and a cornice that will not lie straight.'],
  ['tearoom', 'none', 'Tea Room', 'Turned spindles across every bay, nulled boards beneath.'],
  ['gingerbread', 'none', 'Gingerbread', 'Scallops on the boards, scallops in the bays, a wave on top.'],
  ['chinoiserie', 'none', 'Fretwork', 'A geometric fret across every opening.'],
  ['chinoiserie', 'chineseFret', 'Double Fret', 'Fretwork in the bays and fretwork in the timber.'],
  ['pagoda', 'none', 'Pagoda', 'Stepped eaves and a run of spindles.'],
  ['seaside', 'none', 'Seaside', 'Beadboard, spindles and a rolling cornice.'],
  ['galleon', 'none', 'Galleon', 'A carved wave on top and an arcade like a stern gallery.'],
  ['galleon', 'rope', 'Roped Galleon', 'A stern gallery with a cable moulding to match.'],
  ['carnival', 'none', 'Carnival', 'Brass buttons and a sawtooth awning. Loud, on purpose.'],
  ['toybox', 'none', 'Toy Box', 'Fat rounded boards, corner blocks and a big brass knob.'],
  ['beehive', 'none', 'Beehive', 'Rounded cells in courses under a reeded skep.'],
  ['windmill', 'none', 'Windmill', 'Braced bays and a crest like a sail caught mid-turn.'],

  ['steamer', 'none', 'Steamer Trunk', 'Banded and bossed, as though it had been round the world.'],
  ['cabin', 'none', 'Log Cabin', 'Round uprights, braced bays, boards pegged straight through.'],
  ['driftwood', 'none', 'Driftwood', 'Every edge worn round and every line out of true.'],
  ['driftwood', 'wormy', 'Wormy Driftwood', 'Worn timber, and something has been at it.'],
  ['hayloft', 'none', 'Hayloft', 'Ladder rails and a braced back, more daylight than timber.'],
  ['sawmill', 'none', 'Sawmill', 'Toothed boards and a sawtooth crest.'],
  ['sawmill', 'sawn', 'Green Sawmill', 'Straight off the blade and not sanded since.'],
  ['stable', 'none', 'Stable', 'Strapped uprights and a plate rail.'],
  ['tavern', 'none', 'Tavern', 'Turned posts, pegged boards, spindles over every bay.'],
  ['treehouse', 'none', 'Treehouse', 'Rungs, braces and pegs, nailed up by somebody in a hurry.'],
];

export const SHELF_PRESETS: readonly ShelfPreset[] = PRESET_TABLE.map(
  ([b, pattern, name, blurb]) => ({ id: `${b}.${pattern}`, name, blurb, build: b, pattern }),
);

/** Look up a preset by its `${build}.${pattern}` id. */
export function getShelfPreset(id: string): ShelfPreset | null {
  return SHELF_PRESETS.find((p) => p.id === id) ?? null;
}

/* ----------------------------------------------------------------------------
   Faces — the coordinate frame every pattern is written in
   -------------------------------------------------------------------------- */

/** Which way the timber runs. */
export type Axis = 'x' | 'y';

/**
 * A timber face, described in (along, across) coordinates.
 *
 * Every pattern painter below is written once in this frame, so the same fifty
 * recipes serve the horizontal board and the vertical upright without a
 * transposed copy of each.
 */
export interface Face {
  /** Length along the timber. */
  len: number;
  /** Thickness across it. This is the size every motif is a fraction of. */
  thick: number;
  /** Length of the repeating tile this face belongs to (see the file header). */
  period: number;
  /** Where this face's origin sits inside that tile. Usually negative. */
  phase: number;
  /** (along, across) → canvas point. */
  at(t: number, u: number): readonly [number, number];
  /** (along, across, along-extent, across-extent) → canvas rect. */
  rect(t: number, u: number, dt: number, du: number): readonly [number, number, number, number];
}

/**
 * Build a face over `box`, optionally phase-locked to a repeating `tile`.
 *
 * Pass `tile` for any part whose texture is repeated (the upright), and leave
 * it out for parts drawn once (the board, the cornice) — where the face is its
 * own tile and every pattern lands flush with both ends.
 */
export function faceOf(box: Box, axis: Axis, tile?: Box): Face {
  const t0 = tile ?? box;
  if (axis === 'x') {
    return {
      len: box.w,
      thick: box.h,
      period: t0.w,
      phase: box.x - t0.x,
      at: (t, u) => [box.x + t, box.y + u],
      rect: (t, u, dt, du) => [box.x + t, box.y + u, dt, du],
    };
  }
  return {
    len: box.h,
    thick: box.w,
    period: t0.h,
    phase: box.y - t0.y,
    at: (t, u) => [box.x + u, box.y + t],
    rect: (t, u, dt, du) => [box.x + u, box.y + t, du, dt],
  };
}

/**
 * Cell starts along a face, at a pitch snapped to divide the tile exactly.
 *
 * The snap is the whole reason this helper exists: the upright's texture is
 * one floor tall and repeats, and a pitch that does not divide the tile leaves
 * a visible stutter at every floor seam.
 *
 * `keys` are the cell's integer index in the tile, handed back so a painter
 * that wants a *seeded* cell — a burr blob, a worm hole, the lean of an adze
 * scoop — can vary it without the variation crawling at every floor seam.
 */
function cadence(
  face: Face,
  rawPitch: number,
): { pitch: number; starts: number[]; keys: number[] } {
  const period = face.period > 0 ? face.period : Math.max(1, face.len);
  const n = Math.max(1, Math.round(period / Math.max(1, rawPitch)));
  const pitch = period / n;
  const kMin = Math.floor(face.phase / pitch) - 1;
  const kMax = Math.ceil((face.len + face.phase) / pitch) + 1;
  const starts: number[] = [];
  const keys: number[] = [];
  for (let k = kMin; k <= kMax; k++) {
    starts.push(-face.phase + k * pitch);
    keys.push(k);
  }
  return { pitch, starts, keys };
}

/** Deterministic 0..1 from an integer. Same trick as `flat.ts`'s jitter. */
function noise(n: number): number {
  const x = Math.sin(n * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/* ----------------------------------------------------------------------------
   Timber tones — the values a carving is actually read from
   -------------------------------------------------------------------------- */

const HEX = /^#[0-9a-f]{6}$/i;
const mixCache = new Map<string, string>();

/**
 * Blend two of the palette's hexes.
 *
 * NOT a light model, and worth being clear about why: nothing here is placed
 * to imply a lamp. It manufactures the two flat values the scheme is missing —
 * one step deeper than `timberDark` for the bottom of a cut, one step paler
 * than `timber` for an inlaid string — so that a carving reads from a RAMP of
 * flat faces rather than from a single 12% step that vanishes at shelf size.
 * That is the icon's own move (cover, spine and page block are three values of
 * one hue), applied to the timber.
 *
 * Memoised because a scheme has four hexes and this is called a few thousand
 * times per bake; unknown formats fall through to `a` rather than throwing,
 * because a theme is data and data can be wrong.
 */
function mix(a: string, b: string, t: number): string {
  if (!HEX.test(a) || !HEX.test(b)) return a;
  const key = `${a}${b}${t}`;
  const hit = mixCache.get(key);
  if (hit !== undefined) return hit;
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const ca = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
    const cb = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
    out += Math.round(ca + (cb - ca) * t)
      .toString(16)
      .padStart(2, '0');
  }
  mixCache.set(key, out);
  return out;
}

/** The five flat values every pattern is drawn from. */
interface Tones {
  /** The show face — the ground a carving is cut into. */
  face: string;
  /** One step back: a quirk, a chamfer, the side of a bead. */
  mid: string;
  /** The bottom of a cut, deep enough to read as removed material. */
  deep: string;
  /** Contrasting pale timber, for stringing and inlay. Never a highlight. */
  pale: string;
  /** What shows through a genuinely pierced fret: the inside of the case. */
  through: string;
  /** Small ornament only, exactly as the icon uses it. */
  gilt: string;
}

/** Read at draw time, never captured — a room swap is synchronous around a bake. */
function tones(): Tones {
  const room = flatScheme();
  return {
    face: room.timber,
    mid: room.timberDark,
    deep: mix(room.timberDark, FLAT.ink, 0.46),
    pale: mix(room.timber, FLAT.cream, 0.44),
    through: room.recess,
    gilt: FLAT.gilt,
  };
}

/* ----------------------------------------------------------------------------
   Marks in face coordinates
   -------------------------------------------------------------------------- */

/**
 * A band running the whole length of the face, over-run at both ends.
 *
 * The over-run is not laziness: every face is drawn inside a clip that is the
 * part's own bowed outline, so a band that stopped at `len` would leave a
 * hairline of bare timber where the bow pushes the edge outward.
 */
function faceBand(ctx: FlatCtx, face: Face, u: number, du: number, colour: string): void {
  const [x, y, w, h] = face.rect(-6, u, face.len + 12, du);
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
}

/** Trace a rounded rectangle. Local because `flat.ts` only offers a bowed one. */
function roundPath(ctx: FlatCtx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (rr < 0.35) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * A rounded block in face coordinates.
 *
 * Rounded rather than `fillRect` because the one rule this drawing language
 * has no exceptions to is that nothing is a hard axis-true rectangle — the old
 * dentil course was exactly that, and read as a spreadsheet.
 */
function faceTile(
  ctx: FlatCtx,
  face: Face,
  t: number,
  u: number,
  dt: number,
  du: number,
  colour: string,
  radius = 0,
): void {
  const [x, y, w, h] = face.rect(t, u, dt, du);
  roundPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = colour;
  ctx.fill();
}

/** A flat disc in face coordinates. */
function faceDot(ctx: FlatCtx, face: Face, t: number, u: number, r: number, colour: string): void {
  const [x, y] = face.at(t, u);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

/** A ring in face coordinates — the punch, the guilloche strand. */
function faceRing(
  ctx: FlatCtx,
  face: Face,
  t: number,
  u: number,
  r: number,
  colour: string,
  width: number,
): void {
  const [x, y] = face.at(t, u);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.stroke();
}

type Pt = readonly [number, number];

/** Fill a polygon whose points are in face coordinates. */
function facePoly(ctx: FlatCtx, face: Face, pts: readonly Pt[], colour: string): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = face.at(pts[i]![0], pts[i]![1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/** Stroke an open polyline whose points are in face coordinates. */
function facePath(
  ctx: FlatCtx,
  face: Face,
  pts: readonly Pt[],
  colour: string,
  width: number,
): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = face.at(pts[i]![0], pts[i]![1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Points along an ellipse, in face coordinates. Curves are sampled, never bezier. */
function arcPts(
  ct: number,
  cu: number,
  rt: number,
  ru: number,
  a0: number,
  a1: number,
  steps = 12,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    out.push([ct + Math.cos(a) * rt, cu + Math.sin(a) * ru]);
  }
  return out;
}

/**
 * A run of leaning lens shapes — the primitive under gadrooning, the barley
 * twist and the rope.
 *
 * The half-width follows a sine, so each lobe pinches to nothing where it
 * meets the band's two edges and swells at mid-height. That is what makes a
 * carved cord read as a CYLINDER rather than as hazard hatching: consecutive
 * lobes touch at their fattest point and the ground between them narrows to a
 * groove, which is exactly what the eye uses to find the twist.
 */
function lensRun(
  ctx: FlatCtx,
  face: Face,
  u: number,
  h: number,
  starts: readonly number[],
  width: number,
  lean: number,
  colour: string,
  inset = 1,
): void {
  const N = 8;
  for (const t of starts) {
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      pts.push([t + lean * s + (width / 2) * Math.sin(Math.PI * s) * inset, u + h * (1 - s)]);
    }
    for (let i = N; i >= 0; i--) {
      const s = i / N;
      pts.push([t + lean * s - (width / 2) * Math.sin(Math.PI * s) * inset, u + h * (1 - s)]);
    }
    facePoly(ctx, face, pts, colour);
  }
}

/* ----------------------------------------------------------------------------
   Where a moulding sits — the fix for the worst structural fault
   -------------------------------------------------------------------------- */

/**
 * A moulding's section, in world pixels, and it is CONSTANT.
 *
 * The old set sized every motif as a fraction of `face.thick`, so one bookcase
 * carried the same bead at three different sizes — 48px on the cornice, 27 on
 * the board, 22 on the upright — and nothing looked like it had been run off
 * the same spindle. Real mouldings do the opposite: the section is fixed by
 * the cutter, and a wider member simply carries more of it, or carries it with
 * plain timber either side. Twelve px is a bead you can see on a 22px upright
 * and still a bead, not a stripe, on a 48px cornice.
 */
const SECTION = 12;

interface Run {
  /** Across-face start of the run. */
  u: number;
  /** Its height. */
  h: number;
}

/**
 * Where to run a constant-section moulding on this face, and how many times.
 *
 * A face with room for two runs gets two, spaced a quarter in from each edge
 * with plain frieze between them — which is what a cornice actually is, and
 * what stops a 48px crown face from reading as one enormous bead.
 */
function runsOf(face: Face, scale = 1): Run[] {
  const h = Math.min(SECTION * scale, face.thick * 0.86);
  if (face.thick < h * 2.7) return [{ u: (face.thick - h) / 2, h }];
  return [
    { u: face.thick * 0.24 - h / 2, h },
    { u: face.thick * 0.76 - h / 2, h },
  ];
}

/** Paint a moulding once per run the face has room for. */
function moulding(
  face: Face,
  seed: number,
  scale: number,
  paint: (u: number, h: number, seed: number) => void,
): void {
  const runs = runsOf(face, scale);
  for (let i = 0; i < runs.length; i++) paint(runs[i]!.u, runs[i]!.h, seed + i * 37);
}

/** The whole face, held a hair off its own ink line. For all-over treatments. */
function field(face: Face): Run {
  const pad = Math.min(1.8, face.thick * 0.07);
  return { u: pad, h: face.thick - pad * 2 };
}

/**
 * Clip to a run, for the treatments whose lattice must not be squeezed to fit.
 *
 * An isometric tiling has ONE vertical pitch that makes it isometric; force the
 * rows to divide the field exactly and the cubes shear. So those patterns keep
 * the true pitch, run over the bottom of the field, and are cut off here — a
 * partial row of cubes at the edge is what a veneered panel actually shows.
 */
function withinRun(ctx: FlatCtx, face: Face, run: Run, paint: () => void): void {
  const [x, y, w, h] = face.rect(-6, run.u, face.len + 12, run.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  paint();
  ctx.restore();
}

/* ----------------------------------------------------------------------------
   The fifty pattern painters
   -------------------------------------------------------------------------- */

type PatternPainter = (ctx: FlatCtx, face: Face, seed: number) => void;

/**
 * Every painter draws INSIDE a clip the caller has already set to the timber
 * face, and never strokes an outline of its own: the one ink line belongs to
 * the part, and a motif with its own outline at 6px across is a smudge.
 *
 * The grammar, and it is the same in all fifty:
 *
 * - **A cut is a darker face, and a deep cut is two of them.** `mid` is a
 *   chamfer or a quirk; `deep` is the bottom of a groove. Nothing is shaded.
 * - **A proud member is read from what surrounds it, never from itself.** A
 *   bead is the show colour; you know it is a bead because the ground behind
 *   it was sunk first. That is why almost every run here lays a band of `mid`
 *   or `deep` down before it draws anything.
 * - **Inlay is `pale` and `deep` against `face`,** because inlay is a
 *   different TIMBER, not a different depth — and the eye reads a value break
 *   with no groove as a join between woods.
 */
const PAINTERS: Readonly<Record<PatternId, PatternPainter>> = {
  none: () => undefined,

  /* ---- edge work ---- */

  stringing: (ctx, face, seed) => {
    // Boxwood stringing let into the show face: a hair-fine pale line with the
    // saw kerf still showing each side of it. The quietest thing in the set,
    // and it earns its slot precisely by being almost nothing — it is what
    // separates a cabinetmaker's board from a board.
    const T = tones();
    const k = face.thick;
    const inset = Math.max(2.4, Math.min(5.5, k * 0.17));
    for (const u of [inset, k - inset]) {
      faceBand(ctx, face, u - 1.6, 3.2, T.mid);
      faceBand(ctx, face, u - 0.7, 1.4, T.pale);
    }
    void seed;
  },

  cockBead: (ctx, face, seed) => {
    // A cock bead stands PROUD of the face it edges, so what you actually see
    // of it is the quirk each side: a sunk shadow line, then the half-round.
    const T = tones();
    const k = face.thick;
    const b = Math.max(2.6, Math.min(5.5, k * 0.19));
    for (const u of [b * 1.05, k - b * 1.05]) {
      faceBand(ctx, face, u - b, b * 2, T.deep);
      faceBand(ctx, face, u - b * 0.5, b, T.face);
    }
    void seed;
  },

  beaded: (ctx, face, seed) => {
    // Astragal. The old version drew separated DARK discs, which reads as a
    // board somebody has drilled; a bead is lighter than its ground, touches
    // its neighbours, and lives in a sunk quirk. Get those three right and it
    // stops being dots.
    const T = tones();
    moulding(face, seed, 1, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      faceBand(ctx, face, u + h * 0.12, h * 0.76, T.mid);
      const { pitch, starts } = cadence(face, h * 0.82);
      const r = pitch / 2;
      for (const t of starts) faceDot(ctx, face, t + r, u + h / 2, Math.min(r, h * 0.42), T.face);
      void s;
    });
  },

  reeded: (ctx, face, seed) => {
    // Fluting inside out: the timber is left proud in half-rounds and only the
    // quirks between them are cut. Constant reed width, so a wide member
    // carries more reeds — which is exactly what a real one does.
    const T = tones();
    const f = field(face);
    const n = Math.max(2, Math.round(f.h / 6.4));
    const p = f.h / n;
    faceBand(ctx, face, f.u, f.h, T.deep);
    for (let i = 0; i < n; i++) {
      faceBand(ctx, face, f.u + p * i + p * 0.14, p * 0.72, T.face);
      faceBand(ctx, face, f.u + p * i + p * 0.14, p * 0.16, T.mid);
    }
    void seed;
  },

  fluted: (ctx, face, seed) => {
    // The flute is CONCAVE and round-bottomed, and the fillet between two of
    // them is narrower than either. Three even hairlines — what this used to
    // be — read as scratches because they got that ratio backwards.
    //
    // Depth without a light model: `mid` for the hollow, `deep` for the quirk
    // at the bottom of it. Two flat faces, no lamp.
    const T = tones();
    const f = field(face);
    const n = Math.max(2, Math.round((f.h - 2.6) / 8.4));
    const p = (f.h - 2.6) / n;
    for (let i = 0; i < n; i++) {
      const u = f.u + 2.6 + p * i;
      faceBand(ctx, face, u + p * 0.12, p * 0.76, T.mid);
      faceBand(ctx, face, u + p * 0.33, p * 0.34, T.deep);
    }
    void seed;
  },

  cableFlute: (ctx, face, seed) => {
    // Cabling: a carved cord laid into alternate flutes. Roman, and the one
    // pattern in the set that reads as two mouldings working together.
    const T = tones();
    const f = field(face);
    const n = Math.max(2, Math.round((f.h - 2.6) / 8.6));
    const p = (f.h - 2.6) / n;
    const { pitch, starts } = cadence(face, p * 0.72);
    for (let i = 0; i < n; i++) {
      const u = f.u + 2.6 + p * i;
      faceBand(ctx, face, u + p * 0.12, p * 0.76, T.mid);
      faceBand(ctx, face, u + p * 0.33, p * 0.34, T.deep);
      if (i % 2 === 1) continue;
      const r = Math.min(pitch / 2, p * 0.34);
      for (const t of starts) faceDot(ctx, face, t + pitch / 2, u + p * 0.5, r, T.face);
    }
    void seed;
  },

  /* ---- turned and twisted runs ---- */

  gadroon: (ctx, face, seed) => {
    // Fat lobes leaning together, the way a silver rim is gadrooned. Only a
    // slight lean — steepen it and it becomes the barley twist next door.
    const T = tones();
    moulding(face, seed, 1.1, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 0.62);
      lensRun(ctx, face, u, h, starts, pitch, h * 0.42, T.face);
      lensRun(ctx, face, u, h, starts.map((t) => t + pitch * 0.2), pitch, h * 0.42, T.mid, 0.4);
      void s;
    });
  },

  bobbin: (ctx, face, seed) => {
    // Ball and reel: what comes off a lathe when a country joiner is showing
    // off. The reel has to be MUCH narrower than the ball or the run reads as
    // a string of identical blobs.
    const T = tones();
    moulding(face, seed, 1, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 1.25);
      for (const t of starts) {
        faceTile(ctx, face, t + pitch * 0.62, u + h * 0.22, pitch * 0.26, h * 0.56, T.mid, h * 0.12);
        faceDot(ctx, face, t + pitch * 0.32, u + h * 0.5, h * 0.44, T.face);
        faceDot(ctx, face, t + pitch * 0.32, u + h * 0.5, h * 0.2, T.mid);
      }
      void s;
    });
  },

  barleyTwist: (ctx, face, seed) => {
    // The spiral of a barley-sugar column, opened out flat. Each strand
    // pinches to a point where it meets the containing edge and swells at
    // mid-height; the darker inner lens is the strand's own far side, the same
    // trick the icon plays with a book's spine beside its cover.
    const T = tones();
    moulding(face, seed, 1.25, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 0.86);
      lensRun(ctx, face, u, h, starts, pitch, h * 1.45, T.face);
      lensRun(
        ctx,
        face,
        u,
        h,
        starts.map((t) => t + pitch * 0.26),
        pitch,
        h * 1.45,
        T.mid,
        0.42,
      );
      void s;
    });
  },

  rope: (ctx, face, seed) => {
    // A tight cable between two quirks. Same primitive as the barley twist,
    // wound about twice as fast and confined to a narrower band — which is the
    // whole difference between a cord laid on a moulding and a turned column.
    const T = tones();
    moulding(face, seed, 0.92, (u, h, s) => {
      faceBand(ctx, face, u - h * 0.16, h * 1.32, T.mid);
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 0.5);
      lensRun(ctx, face, u, h, starts, pitch, h * 0.9, T.face);
      lensRun(ctx, face, u, h, starts.map((t) => t + pitch * 0.3), pitch, h * 0.9, T.mid, 0.4);
      void s;
    });
  },

  /* ---- classical enrichments ---- */

  dentil: (ctx, face, seed) => {
    // Real dentils hang BELOW a corona with the gaps cut clean through, which
    // is why the ground here is sunk to `deep` before a single tooth is drawn:
    // the gap has to be darker than anything else in the run or the teeth read
    // as blocks painted on a board.
    const T = tones();
    moulding(face, seed, 1, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      faceBand(ctx, face, u, h * 0.28, T.face);
      faceBand(ctx, face, u + h * 0.28, h * 0.09, T.mid);
      const { pitch, starts } = cadence(face, h * 0.66);
      for (const t of starts) {
        faceTile(ctx, face, t + pitch * 0.22, u + h * 0.3, pitch * 0.56, h * 0.56, T.face, 0.9);
      }
      void s;
    });
  },

  modillion: (ctx, face, seed) => {
    // Brackets rather than teeth: wider, spaced far apart, and each carrying a
    // little volute at its foot. The volute is the whole reason a modillion
    // does not read as a fat dentil.
    const T = tones();
    moulding(face, seed, 1.2, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      faceBand(ctx, face, u, h * 0.24, T.face);
      const { pitch, starts } = cadence(face, h * 1.7);
      for (const t of starts) {
        faceTile(ctx, face, t + pitch * 0.24, u + h * 0.24, pitch * 0.44, h * 0.62, T.face, h * 0.14);
        // The volute at the bracket's foot, cut deep enough to survive: in
        // `mid` it was a 12% smudge on a face the same colour.
        faceDot(ctx, face, t + pitch * 0.3, u + h * 0.72, h * 0.17, T.deep);
        faceDot(ctx, face, t + pitch * 0.3, u + h * 0.72, h * 0.08, T.mid);
        faceTile(ctx, face, t + pitch * 0.46, u + h * 0.4, pitch * 0.2, h * 0.1, T.mid, 0.6);
      }
      void s;
    });
  },

  eggDart: (ctx, face, seed) => {
    // The oldest enrichment there is. Three shapes, and all three have to be
    // present or the eye files it as "some blobs": the shell (a sunk ring),
    // the egg inside it, and the dart between two shells.
    const T = tones();
    moulding(face, seed, 1.35, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 1.35);
      for (const t of starts) {
        // The shell must not fill the band or it reads as a rounded square
        // with a hole in it; there has to be sunk ground above and below it.
        const ct = t + pitch * 0.32;
        facePoly(ctx, face, arcPts(ct, u + h * 0.5, pitch * 0.25, h * 0.42, 0, Math.PI * 2, 16), T.mid);
        facePoly(ctx, face, arcPts(ct, u + h * 0.53, pitch * 0.16, h * 0.3, 0, Math.PI * 2, 16), T.face);
        // The dart is a spearhead on a stem, not a lozenge: without the stem
        // the eye reads a second, smaller egg and the alternation is lost.
        const dt = t + pitch * 0.79;
        facePoly(
          ctx,
          face,
          [
            [dt - pitch * 0.15, u + h * 0.04],
            [dt + pitch * 0.15, u + h * 0.04],
            [dt, u + h * 0.62],
          ],
          T.face,
        );
        faceTile(ctx, face, dt - pitch * 0.04, u + h * 0.55, pitch * 0.08, h * 0.41, T.face, 0.5);
      }
      void s;
    });
  },

  beadReel: (ctx, face, seed) => {
    // Bead, bead, reel — the astragal enriched. The reel is drawn on edge, so
    // it is a bar rather than a disc, and that alternation of round and
    // straight is the entire rhythm.
    const T = tones();
    moulding(face, seed, 0.95, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 2.05);
      for (const t of starts) {
        faceDot(ctx, face, t + pitch * 0.16, u + h * 0.5, h * 0.32, T.face);
        faceDot(ctx, face, t + pitch * 0.44, u + h * 0.5, h * 0.32, T.face);
        // Two beads that touch must still show the groove where they meet, or
        // the pair fuses into one long rounded bar and the reel is left
        // punctuating nothing.
        facePath(ctx, face, [[t + pitch * 0.3, u + h * 0.16], [t + pitch * 0.3, u + h * 0.84]], T.deep, 1.2);
        faceTile(ctx, face, t + pitch * 0.72, u + h * 0.08, pitch * 0.12, h * 0.84, T.face, h * 0.08);
      }
      void s;
    });
  },

  waterLeaf: (ctx, face, seed) => {
    // Leaf and dart. The leaf is a pointed oval with a sunk vein; the dart is
    // the same shape at half the size, dropped between two of them.
    const T = tones();
    moulding(face, seed, 1.1, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      // Leaf, dart, leaf. The first attempt drew the dart INSIDE the leaf's own
      // span, so it was invisible and the run came back as a row of eyes; the
      // dart has to occupy its own cell at half the leaf's height.
      const { pitch, starts } = cadence(face, h * 1.9);
      const leaves = starts;
      const darts = starts.map((t) => t + pitch * 0.5);
      lensRun(ctx, face, u + h * 0.02, h * 0.96, leaves, pitch * 0.4, 0, T.face);
      lensRun(ctx, face, u + h * 0.3, h * 0.4, leaves, pitch * 0.13, 0, T.mid);
      lensRun(ctx, face, u + h * 0.24, h * 0.52, darts, pitch * 0.19, 0, T.face);
      void s;
    });
  },

  guilloche: (ctx, face, seed) => {
    // A plait, and the cheapest honest way to draw one is to overlap rings
    // hard enough that the eye supplies the over-and-under itself. The gilt
    // boss in each eye is not decoration for its own sake — it is what tells
    // you the rings are a chain and not a row of Os.
    const T = tones();
    moulding(face, seed, 1.35, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const r = h * 0.42;
      // The EYES are the motif. A thick strand at a tight pitch closes them and
      // the band comes back as a chain of dark squares — so the strand is thin
      // and the rings only just overlap.
      const { pitch, starts } = cadence(face, r * 1.85);
      for (const t of starts) faceRing(ctx, face, t + pitch / 2, u + h / 2, r, T.face, h * 0.15);
      for (const t of starts) faceDot(ctx, face, t + pitch / 2, u + h / 2, h * 0.11, T.gilt);
      void s;
    });
  },

  vitruvian: (ctx, face, seed) => {
    // A running wave: every scroll breaks the same way, and the eye of each
    // one is what stops it from being a row of commas.
    const T = tones();
    moulding(face, seed, 1.2, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 1.5);
      const w = h * 0.2;
      for (const t of starts) {
        const pts: Pt[] = [
          [t, u + h * 0.9],
          [t + pitch * 0.16, u + h * 0.4],
          ...arcPts(t + pitch * 0.5, u + h * 0.46, pitch * 0.24, h * 0.32, Math.PI, -Math.PI * 0.55, 10),
          [t + pitch * 0.86, u + h * 0.86],
          [t + pitch, u + h * 0.9],
        ];
        facePath(ctx, face, pts, T.face, w);
        faceDot(ctx, face, t + pitch * 0.5, u + h * 0.46, h * 0.1, T.face);
      }
      void s;
    });
  },

  greekKey: (ctx, face, seed) => {
    // The meander. It survives at twelve px only if the fret keeps a
    // continuous base rail — without it the folds float apart into unrelated
    // ticks at the first pixel of rounding.
    const T = tones();
    moulding(face, seed, 1.2, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const w = h * 0.19;
      faceBand(ctx, face, u + h - w, w, T.face);
      const { pitch, starts } = cadence(face, h * 1.55);
      for (const t of starts) {
        facePath(
          ctx,
          face,
          [
            [t + pitch * 0.12, u + h],
            [t + pitch * 0.12, u + w * 0.6],
            [t + pitch * 0.86, u + w * 0.6],
            [t + pitch * 0.86, u + h * 0.62],
            [t + pitch * 0.4, u + h * 0.62],
            [t + pitch * 0.4, u + h * 0.34],
          ],
          T.face,
          w,
        );
      }
      void s;
    });
  },

  /* ---- gothic and Norman ---- */

  blindArcade: (ctx, face, seed) => {
    // Blind arcading is cut INTO the solid, so the timber is the ground and
    // the arches are the holes — the opposite of drawing arches onto a board,
    // which is what makes the difference between a screen and a stencil.
    const T = tones();
    moulding(face, seed, 1.3, (u, h, s) => {
      faceBand(ctx, face, u, h, T.face);
      const { pitch, starts } = cadence(face, h * 0.76);
      const w = pitch * 0.62;
      for (const t of starts) {
        const c = t + pitch / 2;
        facePoly(
          ctx,
          face,
          [
            [c - w / 2, u + h],
            [c - w / 2, u + h * 0.52],
            [c - w * 0.44, u + h * 0.34],
            [c - w * 0.22, u + h * 0.13],
            [c, u + h * 0.04],
            [c + w * 0.22, u + h * 0.13],
            [c + w * 0.44, u + h * 0.34],
            [c + w / 2, u + h * 0.52],
            [c + w / 2, u + h],
          ],
          T.deep,
        );
      }
      faceBand(ctx, face, u, h * 0.07, T.mid);
      void s;
    });
  },

  trefoil: (ctx, face, seed) => {
    // Three lobes and a stem, pierced. Pierced means pierced: the holes show
    // `through`, which is the colour of the inside of the case, so the band
    // reads as tracery with the shelf behind it.
    const T = tones();
    moulding(face, seed, 1.15, (u, h, s) => {
      faceBand(ctx, face, u, h, T.face);
      const { pitch, starts } = cadence(face, h * 1.05);
      const r = h * 0.22;
      for (const t of starts) {
        const c = t + pitch / 2;
        faceDot(ctx, face, c, u + h * 0.3, r, T.deep);
        faceDot(ctx, face, c - r * 1.05, u + h * 0.62, r, T.deep);
        faceDot(ctx, face, c + r * 1.05, u + h * 0.62, r, T.deep);
        facePoly(
          ctx,
          face,
          [
            [c, u + h * 0.34],
            [c - r * 1.05, u + h * 0.62],
            [c + r * 1.05, u + h * 0.62],
          ],
          T.deep,
        );
        faceDot(ctx, face, c, u + h * 0.82, h * 0.09, T.mid);
      }
      void s;
    });
  },

  quatrefoil: (ctx, face, seed) => {
    // Four lobes about a centre — a chantry screen's tracery, and the one
    // gothic motif that still reads when it is nine pixels across.
    const T = tones();
    moulding(face, seed, 1.4, (u, h, s) => {
      faceBand(ctx, face, u, h, T.face);
      const { pitch, starts } = cadence(face, h * 1.15);
      // Four lobes on a circle, NOT four lobes a lobe-radius from the centre —
      // that is what the first attempt drew, and four overlapping circles at
      // 3px is one blob. The cusps between the lobes are the whole motif.
      const R = Math.min(h, pitch) * 0.46;
      const r = R * 0.56;
      for (const t of starts) {
        const c = t + pitch / 2;
        const cu = u + h * 0.5;
        // Lobes big enough to OVERLAP each other, and a centre only just large
        // enough to join them. Small lobes on a big centre draw a Greek cross,
        // which is what the first attempt shipped.
        for (const [dt, du] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ] as const) {
          faceDot(ctx, face, c + dt * R * 0.54, cu + du * R * 0.54, r, T.deep);
        }
        facePoly(
          ctx,
          face,
          [
            [c, cu - R * 0.62],
            [c + R * 0.62, cu],
            [c, cu + R * 0.62],
            [c - R * 0.62, cu],
          ],
          T.deep,
        );
      }
      void s;
    });
  },

  dogtooth: (ctx, face, seed) => {
    // A Norman dog-tooth is a little pyramid cut on four faces. Two of those
    // faces get `face` and two get `mid` — not because a lamp is shining on
    // it, but because a folded form genuinely HAS faces pointing different
    // ways, which is the one kind of value break this language allows.
    const T = tones();
    moulding(face, seed, 1.05, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 0.98);
      const r = Math.min(pitch, h) * 0.46;
      for (const t of starts) {
        const c = t + pitch / 2;
        const cu = u + h / 2;
        facePoly(ctx, face, [[c, cu], [c - r, cu], [c, cu - r]], T.face);
        facePoly(ctx, face, [[c, cu], [c, cu - r], [c + r, cu]], T.mid);
        facePoly(ctx, face, [[c, cu], [c + r, cu], [c, cu + r]], T.face);
        facePoly(ctx, face, [[c, cu], [c, cu + r], [c - r, cu]], T.mid);
        // The arrises. Without them four triangles at 12% apart are a smudge;
        // with them the pyramid has edges and the run reads as cut.
        facePath(ctx, face, [[c - r, cu], [c + r, cu]], T.deep, 1);
        facePath(ctx, face, [[c, cu - r], [c, cu + r]], T.deep, 1);
      }
      void s;
    });
  },

  billet: (ctx, face, seed) => {
    // Two staggered rows of short cylinders. Pure Romanesque, trivially cheap,
    // and it reads at any size because the stagger is the motif.
    const T = tones();
    moulding(face, seed, 1, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts, keys } = cadence(face, h * 0.9);
      const rh = h * 0.38;
      starts.forEach((t, i) => {
        const odd = (keys[i]! & 1) === 1;
        faceTile(ctx, face, t, u + (odd ? h - rh - h * 0.06 : h * 0.06), pitch * 0.52, rh, T.face, rh * 0.45);
      });
      void s;
    });
  },

  chevron: (ctx, face, seed) => {
    // The Norman zigzag, chopped as a V-GROOVE rather than painted as a line:
    // a wide `mid` gouge with a `deep` quick along its bottom. The old one was
    // a single dark stroke, which is a decal.
    const T = tones();
    moulding(face, seed, 1.15, (u, h, s) => {
      const { pitch, starts } = cadence(face, h * 1.05);
      for (const t of starts) {
        const zig: Pt[] = [
          [t, u + h * 0.88],
          [t + pitch / 2, u + h * 0.12],
          [t + pitch, u + h * 0.88],
        ];
        facePath(ctx, face, zig, T.mid, h * 0.34);
        facePath(ctx, face, zig, T.deep, h * 0.13);
      }
      void s;
    });
  },

  lunette: (ctx, face, seed) => {
    // Jacobean half-moons with a fan struck inside each. English, provincial,
    // and instantly datable — which is exactly what a pattern is for.
    const T = tones();
    moulding(face, seed, 1.2, (u, h, s) => {
      faceBand(ctx, face, u, h, T.face);
      const { pitch, starts } = cadence(face, h * 1.1);
      for (const t of starts) {
        const c = t + pitch / 2;
        const top = u + h * 0.16;
        facePoly(ctx, face, arcPts(c, top, pitch * 0.44, h * 0.72, 0, Math.PI, 12), T.mid);
        for (const a of [0.22, 0.5, 0.78]) {
          facePath(
            ctx,
            face,
            [
              [c, top + 0.5],
              [c + Math.cos(Math.PI * a) * pitch * 0.34, top + Math.sin(Math.PI * a) * h * 0.56],
            ],
            T.face,
            Math.max(1, h * 0.09),
          );
        }
        facePath(ctx, face, arcPts(c, top, pitch * 0.44, h * 0.72, 0, Math.PI, 12), T.deep, 1.1);
      }
      void s;
    });
  },

  /* ---- frets and geometry ---- */

  lattice: (ctx, face, seed) => {
    // A trellis whose diamonds are square and STAY square. The old one ran its
    // diagonals at one face-thickness per step while snapping the start pitch
    // to something else, so every crossing drifted and the diamonds came out
    // truncated; here the diagonal rises exactly one pitch, and the pitch is
    // what divides the tile.
    const T = tones();
    moulding(face, seed, 1.25, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h);
      const w = h * 0.19;
      for (const t of starts) {
        facePath(ctx, face, [[t, u], [t + pitch, u + h]], T.face, w);
        facePath(ctx, face, [[t + pitch, u], [t, u + h]], T.face, w);
      }
      faceBand(ctx, face, u, w * 0.7, T.face);
      faceBand(ctx, face, u + h - w * 0.7, w * 0.7, T.face);
      void s;
    });
  },

  chineseFret: (ctx, face, seed) => {
    // Chippendale fretwork. The alternation is the point: cell up, cell down,
    // and the two interlock instead of marching, which is what separates it
    // from the Greek key three rows up in the picker.
    const T = tones();
    moulding(face, seed, 1.25, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const w = h * 0.17;
      const { pitch, starts, keys } = cadence(face, h * 1.25);
      starts.forEach((t, i) => {
        const flip = (keys[i]! & 1) === 1;
        const at = (uu: number): number => (flip ? u + h - uu : u + uu);
        facePath(
          ctx,
          face,
          [
            [t, at(w * 0.6)],
            [t + pitch * 0.82, at(w * 0.6)],
            [t + pitch * 0.82, at(h * 0.66)],
            [t + pitch * 0.3, at(h * 0.66)],
            [t + pitch * 0.3, at(h * 0.34)],
          ],
          T.face,
          w,
        );
      });
      void s;
    });
  },

  lozenge: (ctx, face, seed) => {
    // Raised diamonds meeting point to point, with the ground sunk between
    // them. A single tone would be a printed harlequin; the sunk ground is
    // what makes it carving.
    const T = tones();
    moulding(face, seed, 1.05, (u, h, s) => {
      // Sunk to `deep`, not `mid`: at a 12% step the diamonds and the ground
      // are the same grey once the edges antialias, and the run came back as a
      // string of ovals. The triangles of ground left above and below each
      // lozenge are what the eye actually counts.
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 0.95);
      for (const t of starts) {
        const c = t + pitch / 2;
        facePoly(
          ctx,
          face,
          [
            [c, u + h * 0.04],
            [c + pitch * 0.5, u + h * 0.5],
            [c, u + h * 0.96],
            [c - pitch * 0.5, u + h * 0.5],
          ],
          T.face,
        );
        facePoly(
          ctx,
          face,
          [
            [c, u + h * 0.28],
            [c + pitch * 0.28, u + h * 0.5],
            [c, u + h * 0.72],
            [c - pitch * 0.28, u + h * 0.5],
          ],
          T.mid,
        );
      }
      void s;
    });
  },

  diaper: (ctx, face, seed) => {
    // Tudor diaper: an all-over grid pricked at every crossing. A FIELD, not a
    // band — it is a ground treatment, and half its charm is that it runs
    // right up under everything else on the piece.
    const T = tones();
    const f = field(face);
    const { pitch, starts } = cadence(face, 7.4);
    const rows = Math.max(1, Math.round(f.h / pitch));
    const rh = f.h / rows;
    // One diagonal per ROW, not one across the whole field. Run across the
    // full thickness they stand up nearly vertical on a 45px cornice and the
    // diaper comes back as a picket fence — which is exactly what the first
    // specimen showed.
    for (let r = 0; r < rows; r++) {
      const a = f.u + rh * r;
      for (const t of starts) {
        facePath(ctx, face, [[t, a], [t + pitch, a + rh]], T.mid, 1.1);
        facePath(ctx, face, [[t + pitch, a], [t, a + rh]], T.mid, 1.1);
      }
    }
    for (const t of starts) {
      for (let r = 0; r <= rows; r++) faceDot(ctx, face, t, f.u + rh * r, 1.15, T.deep);
      for (let r = 0; r < rows; r++) {
        faceDot(ctx, face, t + pitch / 2, f.u + rh * (r + 0.5), 1, T.pale);
      }
    }
    void seed;
  },

  strapwork: (ctx, face, seed) => {
    // Jacobean straps: a flat band buckled at intervals by a pierced boss.
    // Interlacing properly at twelve px is illegible, so the buckle carries
    // the idea — which is how the joiners drew it on the small members too.
    const T = tones();
    moulding(face, seed, 1.3, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      faceBand(ctx, face, u + h * 0.32, h * 0.36, T.face);
      faceBand(ctx, face, u + h * 0.32, h * 0.09, T.mid);
      const { pitch, starts } = cadence(face, h * 1.5);
      for (const t of starts) {
        const c = t + pitch / 2;
        faceTile(ctx, face, c - h * 0.4, u + h * 0.1, h * 0.8, h * 0.8, T.face, h * 0.16);
        faceTile(ctx, face, c - h * 0.19, u + h * 0.31, h * 0.38, h * 0.38, T.through, h * 0.1);
        faceDot(ctx, face, c, u + h * 0.5, h * 0.08, T.gilt);
      }
      void s;
    });
  },

  sunburst: (ctx, face, seed) => {
    // A row of struck fans. Folk carving, a compass and a gouge, and the
    // reason it works small is that a fan is legible from its rays alone.
    const T = tones();
    moulding(face, seed, 1.2, (u, h, s) => {
      faceBand(ctx, face, u, h, T.face);
      const { pitch, starts } = cadence(face, h * 1.15);
      for (const t of starts) {
        const c = t + pitch / 2;
        const base = u + h * 0.9;
        facePoly(ctx, face, arcPts(c, base, pitch * 0.46, h * 0.74, Math.PI, Math.PI * 2, 12), T.mid);
        for (const a of [1.16, 1.38, 1.62, 1.84]) {
          facePath(
            ctx,
            face,
            [
              [c, base],
              [c + Math.cos(Math.PI * a) * pitch * 0.4, base + Math.sin(Math.PI * a) * h * 0.64],
            ],
            T.face,
            Math.max(1, h * 0.1),
          );
        }
        facePath(ctx, face, arcPts(c, base, pitch * 0.46, h * 0.74, Math.PI, Math.PI * 2, 12), T.deep, 1.1);
      }
      void s;
    });
  },

  /* ---- veneer and inlay ---- */

  crossband: (ctx, face, seed) => {
    // Crossbanding: a border of short cross-grain strips run round the field,
    // strung on its inner edge. Inlay is a different TIMBER, not a different
    // depth, so nothing here is sunk — the joints are the drawing.
    const T = tones();
    const f = field(face);
    const b = Math.min(6.8, f.h * 0.34);
    const { pitch, starts, keys } = cadence(face, 6.2);
    for (const u of [f.u, f.u + f.h - b]) {
      faceBand(ctx, face, u, b, T.deep);
      starts.forEach((t, i) => {
        // `pale` against `mid`, not `face` against `mid`: crossbanding is two
        // different TIMBERS butted end-grain out, and at a 12% step nobody can
        // see the joints that are the entire ornament.
        faceTile(ctx, face, t + 0.5, u + 0.4, pitch - 1, b - 0.8, (keys[i]! & 1) === 0 ? T.pale : T.mid, 0.6);
      });
    }
    faceBand(ctx, face, f.u + b + 0.7, 1.3, T.pale);
    faceBand(ctx, face, f.u + f.h - b - 2, 1.3, T.pale);
    void seed;
  },

  chequer: (ctx, face, seed) => {
    // Chequer STRINGING — a narrow inlaid band framed by two lines, which is
    // what a chequer is on furniture. The old one was four courses eating
    // eighty per cent of the board and reading as a tablecloth.
    const T = tones();
    moulding(face, seed, 0.62, (u, h, s) => {
      const { pitch, starts, keys } = cadence(face, h);
      faceBand(ctx, face, u, h, T.pale);
      starts.forEach((t, i) => {
        const odd = (keys[i]! & 1) === 1;
        faceTile(ctx, face, t, u, pitch / 2, h / 2, odd ? T.deep : T.pale, 0.4);
        faceTile(ctx, face, t + pitch / 2, u, pitch / 2, h / 2, odd ? T.pale : T.deep, 0.4);
        faceTile(ctx, face, t, u + h / 2, pitch / 2, h / 2, odd ? T.pale : T.deep, 0.4);
        faceTile(ctx, face, t + pitch / 2, u + h / 2, pitch / 2, h / 2, odd ? T.deep : T.pale, 0.4);
      });
      faceBand(ctx, face, u - 2.2, 1.2, T.pale);
      faceBand(ctx, face, u + h + 1, 1.2, T.pale);
      void s;
    });
  },

  herringbone: (ctx, face, seed) => {
    // Parquetry, which is what herringbone IS: short billets of timber butted
    // end to side, course against course, with the joints showing. The old
    // version drew parallel strokes and an ink centre line that no herringbone
    // has ever had — a braid, not a floor.
    //
    // Constant billet section again: a 48px cornice gets four courses, not
    // two enormous ones.
    const T = tones();
    const f = field(face);
    const courses = Math.max(2, Math.round(f.h / 11.5));
    const hc = f.h / courses;
    const { pitch, starts, keys } = cadence(face, hc * 1.15);
    faceBand(ctx, face, f.u, f.h, T.deep);
    for (let c = 0; c < courses; c++) {
      const u0 = f.u + hc * c;
      const up = c % 2 === 0;
      // Alternate courses are STAGGERED by half a billet. Aligned, the leans
      // meet point to point and you have drawn chevron parquet, which is a
      // different floor and already the pattern six rows up in the picker.
      const shift = (c & 1) === 1 ? pitch / 2 : 0;
      starts.forEach((t0, i) => {
        const t = t0 + shift;
        const fill = ((keys[i]! + c) & 1) === 0 ? T.face : T.mid;
        const a = up ? u0 + hc : u0;
        const b = up ? u0 : u0 + hc;
        facePoly(
          ctx,
          face,
          [
            [t + 0.5, a],
            [t + hc, b],
            [t + hc + pitch - 1, b],
            [t + pitch - 0.5, a],
          ],
          fill,
        );
      });
    }
    for (let c = 0; c <= courses; c++) faceBand(ctx, face, f.u + hc * c - 0.5, 1, T.deep);
    faceBand(ctx, face, f.u - 1.4, 1.3, T.pale);
    faceBand(ctx, face, f.u + f.h + 0.1, 1.3, T.pale);
    void seed;
  },

  bookMatch: (ctx, face, seed) => {
    // Two leaves of veneer opened like a book about the centre line, so the
    // figure mirrors. The flames are seeded per CELL INDEX rather than per
    // draw, which is what keeps them from crawling at every floor seam.
    const T = tones();
    const f = field(face);
    const half = f.h / 2;
    const { pitch, starts, keys } = cadence(face, 15);
    faceBand(ctx, face, f.u, f.h, T.face);
    starts.forEach((t, i) => {
      const k = keys[i]!;
      const w = pitch * (0.3 + noise(k) * 0.42);
      const lean = half * (0.5 + noise(k * 3 + 1) * 0.8);
      const off = pitch * noise(k * 7 + 2) * 0.5;
      const tone = noise(k * 11 + 3) > 0.55 ? T.mid : T.deep;
      lensRun(ctx, face, f.u, half, [t + off], w, lean, tone);
      lensRun(ctx, face, f.u + half, half, [t + off + lean], w, -lean, tone);
    });
    faceBand(ctx, face, f.u + half - 0.7, 1.4, T.pale);
    void seed;
  },

  cube: (ctx, face, seed) => {
    // Tumbling block: three tones of timber laid as rhombi, and the eye simply
    // refuses to see anything but cubes. The one pattern in the set that is a
    // genuine optical trick, which is why it earns a slot over a fourth
    // variety of stripe.
    const T = tones();
    const f = field(face);
    const r = Math.min(7, f.h * 0.5);
    const { pitch, starts } = cadence(face, r * 1.732);
    faceBand(ctx, face, f.u, f.h, T.deep);
    // 1.5r is the isometric lattice's vertical pitch and is not negotiable —
    // squeezing the rows to divide the field left a dark seam between every
    // course and the cubes stopped being cubes.
    const rows = Math.max(1, Math.ceil(f.h / (r * 1.5)));
    withinRun(ctx, face, f, () => {
      for (let j = 0; j < rows; j++) {
        const cu = f.u + r * (0.5 + j * 1.5);
        const off = (j & 1) === 1 ? pitch / 2 : 0;
        for (const t of starts) {
          const c = t + off;
          facePoly(ctx, face, [[c, cu - r], [c + pitch / 2, cu - r / 2], [c, cu], [c - pitch / 2, cu - r / 2]], T.pale);
          facePoly(ctx, face, [[c - pitch / 2, cu - r / 2], [c, cu], [c, cu + r], [c - pitch / 2, cu + r / 2]], T.mid);
          facePoly(ctx, face, [[c + pitch / 2, cu - r / 2], [c, cu], [c, cu + r], [c + pitch / 2, cu + r / 2]], T.face);
        }
      }
    });
    void seed;
  },

  marquetry: (ctx, face, seed) => {
    // A sawtooth banding let in between two strings: pale and dark triangles,
    // alternating, no relief at all. It is the flattest thing in the set and
    // that is correct — a marquetry band IS flat.
    const T = tones();
    moulding(face, seed, 0.8, (u, h, s) => {
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts } = cadence(face, h * 0.85);
      for (const t of starts) {
        facePoly(ctx, face, [[t, u + h], [t + pitch / 2, u], [t + pitch, u + h]], T.pale);
        facePoly(
          ctx,
          face,
          [
            [t + pitch / 2, u],
            [t + pitch, u + h],
            [t + pitch * 1.5, u],
          ],
          T.face,
        );
      }
      faceBand(ctx, face, u - 2, 1.3, T.pale);
      faceBand(ctx, face, u + h + 0.7, 1.3, T.pale);
      void s;
    });
  },

  oyster: (ctx, face, seed) => {
    // Laburnum cut across the branch and laid side by side — rings, and each
    // oyster a slightly different size because it came off a different branch.
    // Unmistakable at a glance, which is the whole test.
    const T = tones();
    const f = field(face);
    // Oysters are a constant size, so a deep member carries MORE ROWS of them.
    // Stretched to fill a 45px cornice with one row they became a dark band
    // with a line of buttons down the middle.
    const d = 17;
    const rows = Math.max(1, Math.round(f.h / d));
    const rh = f.h / rows;
    const { pitch, starts, keys } = cadence(face, d * 0.94);
    faceBand(ctx, face, f.u, f.h, T.deep);
    for (let j = 0; j < rows; j++) {
      const rowU = f.u + rh * (j + 0.5);
      starts.forEach((t, i) => {
        const k = keys[i]! + j * 61;
        const c = t + pitch * ((j & 1) === 1 ? 1 : 0.5);
        const cu = rowU + (noise(k) - 0.5) * rh * 0.12;
        const rt = pitch * (0.5 + noise(k * 5 + 1) * 0.08);
        const ru = (rh / 2) * (0.94 + noise(k * 9 + 2) * 0.16);
        for (let g = 0; g < 3; g++) {
          const s = 1 - g / 3;
          facePoly(ctx, face, arcPts(c, cu, rt * s, ru * s, 0, Math.PI * 2, 16), g % 2 === 0 ? T.mid : T.face);
        }
        faceDot(ctx, face, c, cu, 1.3, T.deep);
      });
    }
    void seed;
  },

  burl: (ctx, face, seed) => {
    // A burr panel: figure with no direction at all, framed by a string
    // because a burr is always a panel let into something calmer.
    const T = tones();
    const f = field(face);
    const { pitch, starts, keys } = cadence(face, 9.5);
    faceBand(ctx, face, f.u, f.h, T.face);
    starts.forEach((t, i) => {
      const k = keys[i]!;
      for (let b = 0; b < 2; b++) {
        const n0 = noise(k * 3 + b * 17);
        const n1 = noise(k * 7 + b * 23 + 1);
        const n2 = noise(k * 13 + b * 29 + 2);
        const ct = t + pitch * n0;
        const cu = f.u + f.h * (0.16 + n1 * 0.68);
        const rr = (b === 0 ? 2.6 : 1.5) + n2 * 3.2;
        const pts = arcPts(ct, cu, rr, rr, 0, Math.PI * 2, 9).map(
          ([pt, pu], j) => [pt + (noise(k + j * 5 + b) - 0.5) * rr * 0.7, pu + (noise(k + j * 9 + b) - 0.5) * rr * 0.7] as Pt,
        );
        facePoly(ctx, face, pts, b === 0 ? T.mid : T.deep);
      }
      // The burr's eyes, but only on some cells: on every one they stop being
      // eyes and the panel reads as mould rather than figure.
      if (noise(k * 31) > 0.6) {
        faceDot(ctx, face, t + pitch * 0.5, f.u + f.h * (0.3 + noise(k * 37) * 0.4), 1.2, T.deep);
      }
    });
    faceBand(ctx, face, f.u - 0.8, 1.4, T.pale);
    faceBand(ctx, face, f.u + f.h - 0.6, 1.4, T.pale);
    void seed;
  },

  /* ---- worked surfaces ---- */

  linenfold: (ctx, face, seed) => {
    // Tudor linenfold: cloth folded over and over, in oak. The giveaway is not
    // the ridges — anything gives you ridges — it is the rolled END of each
    // fold, so both ends of every fold get their little turned-over tab.
    const T = tones();
    const f = field(face);
    const { pitch, starts } = cadence(face, 11);
    faceBand(ctx, face, f.u, f.h, T.face);
    for (const t of starts) {
      faceTile(ctx, face, t + pitch * 0.58, f.u, pitch * 0.42, f.h, T.mid, 0);
      faceTile(ctx, face, t + pitch * 0.55, f.u, 1.2, f.h, T.deep, 0);
      for (const uu of [f.u + f.h * 0.03, f.u + f.h * 0.85]) {
        faceTile(ctx, face, t + pitch * 0.06, uu, pitch * 0.86, f.h * 0.12, T.mid, f.h * 0.05);
        faceTile(ctx, face, t + pitch * 0.06, uu, pitch * 0.86, f.h * 0.045, T.deep, f.h * 0.02);
      }
    }
    void seed;
  },

  chipCarve: (ctx, face, seed) => {
    // Chip carving: a knife, three cuts, one triangular chip out. Each chip is
    // two planes meeting in the middle, so it gets two values — the same
    // honest reason the dog-tooth gets four.
    const T = tones();
    const f = field(face);
    const rows = Math.max(1, Math.round(f.h / 7.5));
    const rh = f.h / rows;
    const { pitch, starts, keys } = cadence(face, 8.2);
    for (let r = 0; r < rows; r++) {
      const u0 = f.u + rh * r;
      starts.forEach((t, i) => {
        const c = t + pitch * (((keys[i]! + r) & 1) === 0 ? 0.28 : 0.72);
        const down = ((keys[i]! + r) & 1) === 0;
        const a = down ? u0 + rh * 0.12 : u0 + rh * 0.88;
        const b = down ? u0 + rh * 0.88 : u0 + rh * 0.12;
        facePoly(ctx, face, [[c - pitch * 0.24, a], [c + pitch * 0.24, a], [c, b]], T.mid);
        facePoly(ctx, face, [[c - pitch * 0.24, a], [c, a], [c, b]], T.deep);
      });
    }
    void seed;
  },

  gouged: (ctx, face, seed) => {
    // Scallops bitten out of both edges with a gouge, leaving the middle
    // plain. A gouge cuts a HOLLOW, so each bite is a `mid` scoop with the
    // deepest part of it darker still.
    const T = tones();
    const f = field(face);
    // A gouge takes a BITE. The first attempt used a 4px radius, which at
    // shelf size is a dotted line along the edge and nothing else; the scallop
    // has to eat a third of the member before the eye calls it a cut.
    const { pitch, starts } = cadence(face, 15);
    const r = Math.min(pitch * 0.48, f.h * 0.42);
    for (const t of starts) {
      const c = t + pitch / 2;
      facePoly(ctx, face, arcPts(c, f.u, r, r, 0, Math.PI, 10), T.mid);
      facePoly(ctx, face, arcPts(c, f.u, r * 0.62, r * 0.62, 0, Math.PI, 10), T.deep);
      facePoly(ctx, face, arcPts(c, f.u + f.h, r, r, Math.PI, Math.PI * 2, 10), T.mid);
      facePoly(ctx, face, arcPts(c, f.u + f.h, r * 0.62, r * 0.62, Math.PI, Math.PI * 2, 10), T.deep);
    }
    void seed;
  },

  dotPunch: (ctx, face, seed) => {
    // A matted ground. Punched work is confined to a SUNK background — you
    // never mat a show face — and it is dense: two sparse rows of dots on bare
    // timber, which is what this used to be, read as fly dirt.
    const T = tones();
    moulding(face, seed, 0.95, (u, h, s) => {
      faceBand(ctx, face, u - 1.2, h + 2.4, T.mid);
      faceBand(ctx, face, u, h, T.deep);
      const { pitch, starts, keys } = cadence(face, 2.9);
      const rows = Math.max(2, Math.round(h / 2.9));
      const rh = h / rows;
      starts.forEach((t, i) => {
        for (let r = 0; r < rows; r++) {
          const stagger = ((keys[i]! + r) & 1) === 0 ? 0 : pitch / 2;
          faceDot(ctx, face, t + stagger, u + rh * (r + 0.5), 0.95, T.mid);
        }
      });
      void s;
    });
  },

  cane: (ctx, face, seed) => {
    // Laths woven over and under, with the holes between them. The weave is
    // the whole point: draw both directions flat and you have a grid, so the
    // along-laths are re-laid over alternate crossings.
    const T = tones();
    const f = field(face);
    const { pitch, starts, keys } = cadence(face, 6.6);
    const rows = Math.max(2, Math.round(f.h / 6.6));
    const rh = f.h / rows;
    const w = Math.min(3.4, rh * 0.56);
    faceBand(ctx, face, f.u, f.h, T.deep);
    for (let r = 0; r < rows; r++) faceBand(ctx, face, f.u + rh * r + (rh - w) / 2, w, T.face);
    starts.forEach((t) => {
      faceTile(ctx, face, t + (pitch - w) / 2, f.u, w, f.h, T.face, 0.8);
    });
    starts.forEach((t, i) => {
      for (let r = 0; r < rows; r++) {
        if (((keys[i]! + r) & 1) !== 0) continue;
        faceTile(ctx, face, t + (pitch - w) / 2 - 1.4, f.u + rh * r + (rh - w) / 2, w + 2.8, w, T.face, 0.8);
        faceTile(ctx, face, t + (pitch - w) / 2 - 1.4, f.u + rh * r + (rh - w) / 2, 1, w, T.mid, 0);
      }
    });
    void seed;
  },

  adzed: (ctx, face, seed) => {
    // The scoops an adze leaves when a board is dressed by hand: shallow,
    // overlapping, and never the same twice — the lean and the reach of each
    // one come off the cell index so a floor seam cannot show a repeat.
    const T = tones();
    const f = field(face);
    const { pitch, starts, keys } = cadence(face, 13);
    starts.forEach((t, i) => {
      const k = keys[i]!;
      const lean = f.h * (0.18 + noise(k) * 0.4);
      const w = pitch * (0.62 + noise(k * 3 + 1) * 0.3);
      lensRun(ctx, face, f.u, f.h, [t + pitch * 0.2], w, lean, T.mid);
      lensRun(ctx, face, f.u + f.h * 0.12, f.h * 0.76, [t + pitch * 0.2 + lean * 0.1], w * 0.5, lean, T.deep);
    });
    void seed;
  },

  sawn: (ctx, face, seed) => {
    // Pit-saw marks: fine, near-perpendicular, and left because nobody planed
    // the board. Deliberately the faintest thing in the set — it is a surface,
    // not an ornament, and it exists so a rustic case can look sawn rather
    // than carved.
    const T = tones();
    const f = field(face);
    const { starts, keys } = cadence(face, 5.6);
    starts.forEach((t, i) => {
      const k = keys[i]!;
      const lean = f.h * (0.32 + noise(k) * 0.22);
      const tone = noise(k * 3 + 1) > 0.78 ? T.deep : T.mid;
      facePath(ctx, face, [[t, f.u], [t + lean, f.u + f.h]], tone, 1.1);
    });
    faceBand(ctx, face, f.u + f.h * 0.34, 1, T.mid);
    void seed;
  },

  wormy: (ctx, face, seed) => {
    // Old timber. Flight holes, and one track where a worm broke the surface.
    // Sparse on purpose — the charm is that you find them rather than see a
    // pattern.
    const T = tones();
    const f = field(face);
    const { pitch, starts, keys } = cadence(face, 11);
    starts.forEach((t, i) => {
      const k = keys[i]!;
      const n = noise(k);
      const holes = n > 0.72 ? 3 : n > 0.34 ? 2 : 1;
      for (let b = 0; b < holes; b++) {
        const ct = t + pitch * noise(k * 5 + b * 13);
        const cu = f.u + f.h * (0.15 + noise(k * 9 + b * 17) * 0.7);
        const rr = 1 + noise(k * 11 + b * 19) * 1.1;
        faceDot(ctx, face, ct, cu, rr + 0.7, T.mid);
        faceDot(ctx, face, ct, cu, rr, T.deep);
      }
      if (n > 0.86) {
        const cu = f.u + f.h * (0.25 + noise(k * 23) * 0.5);
        facePath(
          ctx,
          face,
          [
            [t + pitch * 0.1, cu],
            [t + pitch * 0.35, cu + f.h * 0.12],
            [t + pitch * 0.62, cu - f.h * 0.1],
            [t + pitch * 0.86, cu + f.h * 0.05],
          ],
          T.mid,
          1.3,
        );
      }
    });
    void seed;
  },

  tiled: (ctx, face, seed) => {
    // Fielded panels: a raised centre inside a mitred frame, which is what
    // "panelled" means on furniture. The old one was a running-bond brick
    // wall, drawn in hairlines — a wall, not a wainscot.
    const T = tones();
    const f = field(face);
    const { pitch, starts } = cadence(face, Math.max(26, f.h * 2.6));
    const m = Math.min(4.2, f.h * 0.18);
    faceBand(ctx, face, f.u, f.h, T.mid);
    for (const t of starts) {
      faceTile(ctx, face, t + m, f.u + m, pitch - m * 2, f.h - m * 2, T.deep, m * 0.4);
      faceTile(ctx, face, t + m + 1.1, f.u + m + 1.1, pitch - m * 2 - 2.2, f.h - m * 2 - 2.2, T.face, m * 0.4);
      faceTile(ctx, face, t - 0.7, f.u, 1.4, f.h, T.deep, 0);
    }
    void seed;
  },

  notched: (ctx, face, seed) => {
    // Vs chopped out of the edge until it is a saw. A notch REMOVES material,
    // so each one is cut to the deepest value in the palette and carries the
    // part's own ink along its two sloping sides — that ink line is what makes
    // the eye read a serrated edge rather than triangles printed under a rule.
    const T = tones();
    const f = field(face);
    const { pitch, starts } = cadence(face, 9.4);
    const d = Math.min(f.h * 0.36, 7);
    for (const t of starts) {
      for (const [u0, dir] of [
        [f.u, 1],
        [f.u + f.h, -1],
      ] as const) {
        const dd = dir > 0 ? d : d * 0.72;
        const pts: Pt[] = [
          [t + pitch * 0.06, u0],
          [t + pitch * 0.5, u0 + dd * dir],
          [t + pitch * 0.94, u0],
        ];
        facePoly(ctx, face, pts, T.deep);
        facePath(ctx, face, pts, FLAT.ink, 1.3);
      }
    }
    void seed;
  },
};

/**
 * Work `pattern` into a timber face.
 *
 * The caller must already have clipped to the face (the part drawers do, with
 * the same `wobbleRect` they filled it with), and must re-stroke the part's
 * outline afterwards so the clip cannot nibble it.
 *
 * The floor is 6px rather than 3: a moulding whose constant section no longer
 * fits inside the member is not a small moulding, it is a smear, and a
 * bookcase drawn on a studio card at thumbnail size is better off plain.
 */
export function paintFacePattern(
  ctx: FlatCtx,
  pattern: PatternId,
  face: Face,
  seed: number,
): void {
  if (face.thick <= 6 || face.len <= 6) return;
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  PAINTERS[pattern](ctx, face, seed);
  ctx.restore();
}

/* ----------------------------------------------------------------------------
   Build trim: the board
   -------------------------------------------------------------------------- */

/**
 * Where the opening ends and the shelf board begins, as a fraction of one
 * floor: `BOOK_ZONE_H / FLOOR_H`.
 *
 * The upright's texture is one whole floor, board included, so anything that
 * has to stand ON the board — a column's base, a bracket — needs to know where
 * that is. Written as a ratio rather than imported because `art/` renders and
 * `features/bookshelf/constants.ts` owns layout; the studio card uses the same
 * proportion, so a capital lands in the same place on a 168px card as on the
 * shelf.
 */
const OPENING_FRAC = 280 / 320;

/**
 * The carpentry a build adds to the shelf board, drawn inside the board's clip.
 *
 * A board is only ~40 world px tall and it has a neighbour flush against three
 * of its four sides, so none of this can change its silhouette — a scalloped
 * apron has to live on the face rather than hang below it, because the floor
 * underneath starts at this board's own bottom edge. What actually hangs into
 * the opening is the valance, and that belongs to `paintOpening` where there is
 * room for it.
 *
 * Everything applied here declares its joins. A batten housed across a board is
 * cut into it: no rounded cap at the top where it meets the board's top arris,
 * no second ink line running beside the board's own. Drawn with `flat.panel`
 * instead — which is how they were drawn — they read as luggage tags stuck on.
 */
export function paintPlankTrim(ctx: FlatCtx, spec: BuildSpec, b: Box, seed: number): void {
  const T = caseTimber();
  const edge = b.h * spec.plankEdge;
  const faceH = b.h - edge;
  const ink = inkWidth(b.h);
  const arrisY = b.y + faceH;

  switch (spec.plankTrim) {
    case 'none':
      break;

    case 'chamfer': {
      // The plane taken twice along the front arris. A wider band of `arris`
      // than the hairline every board gets, so it reads as a deliberate stop.
      ctx.fillStyle = T.arris;
      ctx.fillRect(b.x, arrisY - edge * 0.22, b.w, edge * 0.34);
      edgeLine(ctx, b.x, arrisY + edge * 0.14, b.x + b.w, arrisY + edge * 0.14, T.deep, Math.max(0.9, ink * 0.4), seed, 0.5);
      break;
    }

    case 'lip': {
      // A face-frame board shows a second reveal above its front edge: a
      // shallow rebate, so it is a dark line with a light one under it rather
      // than a single scratch.
      const y = b.y + faceH * 0.6;
      edgeLine(ctx, b.x, y, b.x + b.w, y, T.deep, Math.max(1, ink * 0.55), seed, 0.6);
      edgeLine(ctx, b.x, y + ink * 0.6, b.x + b.w, y + ink * 0.6, T.arris, Math.max(0.8, ink * 0.35), seed + 1, 0.6);
      break;
    }

    case 'tray': {
      // A lipped board: a fillet standing proud of the top surface, so the
      // books sit in a shallow tray.
      const y = b.y + faceH * 0.34;
      edgeLine(ctx, b.x, y, b.x + b.w, y, T.deep, Math.max(1, ink * 0.5), seed, 0.6);
      edgeLine(ctx, b.x, y - ink * 0.55, b.x + b.w, y - ink * 0.55, T.arris, Math.max(0.8, ink * 0.35), seed + 2, 0.6);
      break;
    }

    case 'bead': {
      // A run of half-round beads along the front edge, TOUCHING, so the eye
      // reads a continuous moulding. Separated discs read as holes punched in
      // the board instead — which is what they were.
      const r = Math.max(1.6, edge * 0.34);
      const step = r * 2;
      ctx.fillStyle = T.face;
      for (let x = b.x + r; x < b.x + b.w + r; x += step) {
        ctx.beginPath();
        ctx.arc(x, arrisY + edge * 0.52, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // The quirk: the small square groove that stops a bead run at each side.
      edgeLine(ctx, b.x, arrisY + edge * 0.06, b.x + b.w, arrisY + edge * 0.06, T.deep, Math.max(0.8, ink * 0.35), seed, 0.5);
      break;
    }

    case 'nulling': {
      // Gadrooned: a run of shallow lobes cut along the front edge, each
      // separated by a fine groove. Nearly a bead run, but flatter and wider.
      const step = Math.max(6, edge * 2.3);
      ctx.fillStyle = T.arris;
      for (let x = b.x; x < b.x + b.w; x += step) {
        ctx.beginPath();
        ctx.ellipse(x + step * 0.5, arrisY + edge * 0.5, step * 0.44, edge * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = T.deep;
      ctx.lineWidth = Math.max(0.8, ink * 0.4);
      for (let x = b.x; x < b.x + b.w + step; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, arrisY + edge * 0.12);
        ctx.lineTo(x, arrisY + edge * 0.9);
        ctx.stroke();
      }
      break;
    }

    case 'scallop': {
      // Scallops cut UP into the front edge, so the arris is what waves.
      // Sized to the front edge band rather than the board: anything deeper is
      // cut off by the board's own bottom and comes back as a row of spikes.
      const r = Math.max(2.4, edge * 0.85);
      const step = r * 2;
      for (let x = b.x + r; x < b.x + b.w + r; x += step) {
        ctx.beginPath();
        ctx.arc(x, arrisY + edge * 0.9, r, Math.PI, 0, false);
        ctx.closePath();
        ctx.fillStyle = T.face;
        ctx.fill();
        ctx.strokeStyle = FLAT.ink;
        ctx.lineWidth = Math.max(1, ink * 0.5);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      break;
    }

    case 'dentil': {
      // A proper dentil course: the ground is dark and the TEETH are the light
      // timber standing in front of it, which is the only way a course of
      // blocks reads as projecting rather than as a row of stains.
      ctx.fillStyle = T.deep;
      ctx.fillRect(b.x, arrisY + edge * 0.16, b.w, edge * 0.64);
      const step = Math.max(7, edge * 1.5);
      ctx.fillStyle = T.face;
      for (let x = b.x; x < b.x + b.w; x += step) {
        ctx.fillRect(x, arrisY + edge * 0.16, step * 0.55, edge * 0.64);
      }
      break;
    }

    case 'cleat': {
      // Battens housed ACROSS the board. Top and bottom are joins: a cleat is
      // let into the board, so it shares the board's arrises rather than
      // floating inside them with a gap and a cap of its own at each end.
      const cleats = Math.max(2, Math.round(b.w / (b.h * 6)));
      const cw = Math.max(4, b.h * 0.34);
      for (let i = 0; i <= cleats; i++) {
        const cx = b.x + (b.w - cw) * (i / cleats);
        partPanel(ctx, { x: cx, y: b.y, w: cw, h: b.h }, T.edge, {
          radius: cw * 0.16,
          seed: seed + i * 13,
          joins: { top: true, bottom: true },
          width: Math.max(1, ink * 0.75),
        });
        edgeLine(ctx, cx + cw * 0.5, b.y, cx + cw * 0.5, b.y + b.h, T.deep, Math.max(0.8, ink * 0.35), seed + i, 0.4);
      }
      break;
    }

    case 'strap': {
      // Iron bands over the board, with a stud at each end. Straps sit ON the
      // timber, so they carry their own outline — but their top and bottom are
      // still joins, because a strap wraps the board rather than stopping on
      // its face.
      const bands = Math.max(2, Math.round(b.w / (b.h * 7)));
      const bw = Math.max(4, b.h * 0.24);
      for (let i = 0; i <= bands; i++) {
        const cx = b.x + (b.w - bw) * (i / bands);
        partPanel(ctx, { x: cx, y: b.y, w: bw, h: b.h }, T.deep, {
          radius: bw * 0.2,
          seed: seed + i * 17,
          joins: { top: true, bottom: true },
          width: Math.max(1, ink * 0.6),
        });
        ctx.beginPath();
        ctx.arc(cx + bw * 0.5, arrisY + edge * 0.5, Math.max(1.3, bw * 0.24), 0, Math.PI * 2);
        ctx.fillStyle = FLAT.gilt;
        ctx.fill();
      }
      break;
    }

    case 'rail': {
      // A ladder's board is simply laid across its rungs: one reveal, and a
      // bracket under each end. The bracket's top is a join — it is holding
      // the board up, not resting beside it.
      const y = b.y + faceH * 0.55;
      edgeLine(ctx, b.x, y, b.x + b.w, y, T.deep, Math.max(0.9, ink * 0.45), seed, 0.6);
      const bw = b.h * 1.6;
      for (const sx of [b.x + b.h * 0.5, b.x + b.w - b.h * 0.5 - bw]) {
        partPanel(ctx, { x: sx, y: arrisY - edge * 0.1, w: bw, h: edge * 1.1 }, T.edge, {
          radius: edge * 0.3,
          seed: seed + sx,
          joins: { top: true, bottom: true },
          width: Math.max(1, ink * 0.6),
        });
      }
      break;
    }

    case 'peg': {
      // Draw-bored pegs. Big enough to read at 1:1 — at two pixels across they
      // were invisible on the shelf and only ever showed up on a studio card.
      const r = Math.max(2.4, b.h * 0.11);
      const step = Math.max(b.h * 2.6, r * 8);
      for (let x = b.x + step * 0.5; x < b.x + b.w; x += step) {
        const cy = b.y + faceH * 0.5;
        ctx.beginPath();
        ctx.arc(x, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = T.edge;
        ctx.fill();
        ctx.strokeStyle = FLAT.ink;
        ctx.lineWidth = Math.max(0.9, ink * 0.42);
        ctx.stroke();
        // The peg's own end grain: a lighter crescent, the same chamfer trick
        // every arris in the case gets.
        ctx.beginPath();
        ctx.arc(x, cy, r * 0.44, 0, Math.PI * 2);
        ctx.fillStyle = T.arris;
        ctx.fill();
      }
      break;
    }

    case 'knob': {
      const y = b.y + faceH * 0.68;
      edgeLine(ctx, b.x, y, b.x + b.w, y, T.deep, Math.max(1, ink * 0.5), seed, 0.6);
      // A pull per section, the way a barrister's lift-up fronts carry them.
      // One in the middle of a 1200px board reads as a blemish rather than as
      // a handle: there is nothing to say what it is the middle OF.
      const r = Math.max(2.4, b.h * 0.17);
      const cy = arrisY + edge * 0.5;
      for (const t of [0.25, 0.5, 0.75]) {
        const cx = b.x + b.w * t;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = FLAT.gilt;
        ctx.fill();
        ctx.strokeStyle = FLAT.ink;
        ctx.lineWidth = Math.max(1, ink * 0.55);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - r * 0.22, cy - r * 0.18, r * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = FLAT.giltPale;
        ctx.fill();
      }
      break;
    }
  }
}

/* ----------------------------------------------------------------------------
   Build trim: the upright
   -------------------------------------------------------------------------- */

/**
 * The carpentry a build adds to an upright.
 *
 * `tile` is the repeating unit (one floor), NOT the rectangle drawn — the
 * upright's texture is deliberately over-drawn past both ends so its ends fall
 * off-canvas, and a capital positioned against that would sit a dozen pixels
 * too high on every floor.
 *
 * `shaft` arrives flush to the OUTBOARD side of the given width, and the post
 * texture is mirrored for the right-hand upright, so in here x grows INWARD on
 * both sides of the case. That is what lets a capital overhang toward the
 * opening and a chamfer run down the outer arris without a second code path.
 */
export function paintPostTrim(
  ctx: FlatCtx,
  spec: BuildSpec,
  shaft: Box,
  tile: Box,
  seed: number,
): void {
  const T = caseTimber();
  const ink = inkWidth(shaft.w);
  /** Where this floor's board starts: everything that stands must stand on it. */
  const boardY = tile.y + tile.h * OPENING_FRAC;

  switch (spec.postTrim) {
    case 'none':
      break;

    case 'chamfer': {
      // The outer arris planed off. A band rather than a line, so it reads as
      // a stopped chamfer and not as a scratch down the case.
      ctx.fillStyle = T.arris;
      ctx.fillRect(shaft.x + shaft.w * 0.08, shaft.y, shaft.w * 0.16, shaft.h);
      edgeLine(ctx, shaft.x + shaft.w * 0.26, shaft.y, shaft.x + shaft.w * 0.26, shaft.y + shaft.h, T.deep, Math.max(0.8, ink * 0.35), seed, 0.5);
      break;
    }

    case 'stile': {
      // A face-frame stile: the frame's inner edge carries a bead, so the post
      // and the stile read as one member with a moulding worked on it rather
      // than as two uprights with a gap between them.
      const x = shaft.x + shaft.w * 0.7;
      edgeLine(ctx, x, shaft.y, x, shaft.y + shaft.h, T.deep, Math.max(1, ink * 0.5), seed, 0.5);
      edgeLine(ctx, x - ink * 0.55, shaft.y, x - ink * 0.55, shaft.y + shaft.h, T.arris, Math.max(0.8, ink * 0.35), seed + 1, 0.5);
      break;
    }

    case 'pilaster': {
      // A fielded panel run down the upright: a sunk border with a raised
      // field inside it. Top and bottom are joins — the panel runs on past
      // this floor into the next one.
      // Clamped to the shaft's SHOW FACE (`flatShelf.EDGE_FRACTION` of the
      // shaft is its return into the case): a panel that runs across the
      // return is a panel wrapped round a corner.
      const faceW = shaft.w * 0.72;
      const inset = faceW * 0.2;
      const b: Box = { x: shaft.x + inset, y: tile.y + tile.h * 0.06, w: faceW - inset * 2, h: tile.h * OPENING_FRAC - tile.h * 0.12 };
      if (b.w > 3 && b.h > 8) {
        partPanel(ctx, b, T.deep, { radius: b.w * 0.22, seed, width: Math.max(0.9, ink * 0.5) });
        const f: Box = { x: b.x + b.w * 0.24, y: b.y + b.w * 0.5, w: b.w * 0.52, h: b.h - b.w };
        if (f.w > 1.5 && f.h > 4) {
          ctx.fillStyle = T.face;
          tracePart(ctx, f, { radius: f.w * 0.3, seed: seed + 3 });
          ctx.fill();
          edgeLine(ctx, f.x, f.y, f.x, f.y + f.h, T.arris, Math.max(0.7, ink * 0.3), seed + 4, 0.4);
        }
      }
      break;
    }

    case 'column': {
      // A capital under the board above and a base standing ON the board
      // below, both drawn at the FULL width the caller allowed rather than the
      // shaft's — an overhang is what makes a narrowed shaft read as a column.
      //
      // The base used to be placed a whole block-height above the tile's
      // bottom, which is the middle of the board's FACE: the column appeared
      // to be standing in mid-air halfway down a shelf.
      const blockH = Math.max(5, shaft.w * 0.66);
      const over = shaft.w * 0.2;
      const w = shaft.w + over * 2;
      for (const [ty, joins] of [
        [tile.y, { top: true } as Joins],
        [boardY - blockH, { bottom: true } as Joins],
      ] as const) {
        partPanel(ctx, { x: shaft.x - over, y: ty, w, h: blockH }, T.face, {
          radius: blockH * 0.16,
          seed: seed + ty,
          joins,
          width: Math.max(1, ink * 0.8),
        });
        edgeLine(ctx, shaft.x - over, ty + blockH * 0.34, shaft.x - over + w, ty + blockH * 0.34, T.deep, Math.max(0.8, ink * 0.35), seed + ty, 0.4);
      }
      break;
    }

    case 'turned': {
      // Collars at intervals down a turned upright. Left and right are joins:
      // a collar is turned FROM the post, not glued round it.
      const h = Math.max(4, shaft.w * 0.42);
      for (const t of [0.1, 0.46, 0.8]) {
        const ty = tile.y + tile.h * OPENING_FRAC * t;
        partPanel(ctx, { x: shaft.x - shaft.w * 0.12, y: ty, w: shaft.w * 1.24, h }, T.face, {
          radius: h * 0.44,
          seed: seed + ty,
          joins: { left: true, right: true },
          width: Math.max(0.9, ink * 0.65),
        });
      }
      break;
    }

    case 'bracket': {
      // A shaped bracket where the board lands. Its bottom is a join into the
      // board, its inboard side runs free into the opening.
      const h = Math.max(6, shaft.w * 0.9);
      const w = shaft.w * 1.5;
      partPanel(ctx, { x: shaft.x, y: boardY - h, w, h }, T.edge, {
        radius: h * 0.7,
        seed: seed + 9,
        joins: { left: true, bottom: true },
        width: Math.max(1, ink * 0.7),
      });
      break;
    }

    case 'ladder': {
      // Rungs. Both ends are joins — a rung is tenoned into its rails, so it
      // must not carry a rounded cap where it enters one.
      const rungH = Math.max(4, shaft.w * 0.52);
      const over = shaft.w * 0.55;
      for (const t of [0.1, 0.72]) {
        const ty = tile.y + tile.h * OPENING_FRAC * t;
        partPanel(ctx, { x: shaft.x - over, y: ty, w: shaft.w + over * 2, h: rungH }, T.edge, {
          radius: rungH * 0.4,
          seed: seed + ty,
          joins: { left: true, right: true },
          width: Math.max(1, ink * 0.7),
        });
      }
      break;
    }

    case 'strap': {
      // Iron bands round the upright, with a stud on each.
      const h = Math.max(4, shaft.w * 0.34);
      for (const t of [0.16, 0.62]) {
        const ty = tile.y + tile.h * OPENING_FRAC * t;
        partPanel(ctx, { x: shaft.x - shaft.w * 0.1, y: ty, w: shaft.w * 1.2, h }, T.deep, {
          radius: h * 0.3,
          seed: seed + ty,
          joins: { left: true, right: true },
          width: Math.max(0.9, ink * 0.6),
        });
        ctx.beginPath();
        ctx.arc(shaft.x + shaft.w * 0.42, ty + h * 0.5, Math.max(1.3, h * 0.26), 0, Math.PI * 2);
        ctx.fillStyle = FLAT.gilt;
        ctx.fill();
      }
      break;
    }

    case 'batten': {
      const r = Math.max(1.6, shaft.w * 0.11);
      const step = Math.max(10, (tile.h * OPENING_FRAC) / 7);
      for (let y = tile.y + step * 0.6; y < boardY; y += step) {
        ctx.beginPath();
        ctx.arc(shaft.x + shaft.w * 0.4, y, r, 0, Math.PI * 2);
        ctx.fillStyle = T.deep;
        ctx.fill();
      }
      break;
    }

    case 'slab': {
      const r = Math.max(2.2, shaft.w * 0.15);
      for (const t of [0.24, 0.74]) {
        const cy = tile.y + tile.h * OPENING_FRAC * t;
        ctx.beginPath();
        ctx.arc(shaft.x + shaft.w * 0.42, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = T.edge;
        ctx.fill();
        ctx.strokeStyle = FLAT.ink;
        ctx.lineWidth = Math.max(0.9, ink * 0.4);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(shaft.x + shaft.w * 0.42, cy, r * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = T.arris;
        ctx.fill();
      }
      break;
    }
  }
}

/* ----------------------------------------------------------------------------
   Build: the opening
   -------------------------------------------------------------------------- */

/** The head shape an arcade band springs into. */
type ArchHead = 'round' | 'pointed' | 'ogee' | 'trefoil' | 'segmental';

/**
 * Trace a band across the top of an opening whose underside is a run of arches.
 *
 * One path rather than N shapes so the spandrels between neighbouring bays are
 * continuous timber — drawn separately they show a seam where they meet, and
 * the case reads as stickers rather than joinery. The band's own top, left and
 * right are joins into the board above and the uprights either side, so it is
 * over-drawn past all three and carries ink only along the arch line.
 */
function traceArcadeBand(
  ctx: FlatCtx,
  f: Box,
  bays: number,
  r: number,
  rise: number,
  head: ArchHead,
  bleed: number,
): void {
  const bayW = f.w / bays;
  const x0 = f.x - bleed;
  const x1 = f.x + f.w + bleed;
  ctx.beginPath();
  ctx.moveTo(x0, f.y - bleed);
  ctx.lineTo(x1, f.y - bleed);
  ctx.lineTo(x1, f.y + rise);
  // Walk the underside right → left so the enclosed region is the timber
  // ABOVE the arch line.
  for (let i = bays - 1; i >= 0; i--) {
    const bx = f.x + i * bayW;
    const cx = bx + bayW / 2;
    ctx.lineTo(cx + r, f.y + rise);
    switch (head) {
      case 'pointed':
        ctx.quadraticCurveTo(cx + r * 0.52, f.y + rise - r * 1.2, cx, f.y + rise - r * 1.7);
        ctx.quadraticCurveTo(cx - r * 0.52, f.y + rise - r * 1.2, cx - r, f.y + rise);
        break;
      case 'ogee':
        // S-curved: concave off the springing, convex into the point.
        ctx.quadraticCurveTo(cx + r * 1.05, f.y + rise - r * 0.72, cx + r * 0.34, f.y + rise - r * 1.22);
        ctx.quadraticCurveTo(cx, f.y + rise - r * 1.5, cx, f.y + rise - r * 1.9);
        ctx.quadraticCurveTo(cx, f.y + rise - r * 1.5, cx - r * 0.34, f.y + rise - r * 1.22);
        ctx.quadraticCurveTo(cx - r * 1.05, f.y + rise - r * 0.72, cx - r, f.y + rise);
        break;
      case 'trefoil': {
        // Three lobes with a cusp between each — the tracery a chapel window
        // has. Written as quadratics rather than as arcs: three `ctx.arc`
        // calls with mixed sweep directions join through whatever straight
        // line the path needs to reach the next arc's start, and what came out
        // was a row of small birds rather than tracery.
        const yr = f.y + rise;
        ctx.quadraticCurveTo(cx + r * 1.12, yr - r * 0.78, cx + r * 0.46, yr - r * 1.02);
        ctx.lineTo(cx + r * 0.34, yr - r * 0.66);
        ctx.quadraticCurveTo(cx + r * 0.46, yr - r * 1.3, cx, yr - r * 1.38);
        ctx.quadraticCurveTo(cx - r * 0.46, yr - r * 1.3, cx - r * 0.34, yr - r * 0.66);
        ctx.lineTo(cx - r * 0.46, yr - r * 1.02);
        ctx.quadraticCurveTo(cx - r * 1.12, yr - r * 0.78, cx - r, yr);
        break;
      }
      case 'segmental':
        // A shallow arc: a bay wider than it is tall.
        ctx.quadraticCurveTo(cx, f.y + rise - r * 0.9, cx - r, f.y + rise);
        break;
      default:
        // Angle 0 → PI counter-clockwise passes -PI/2, which is UP in canvas
        // coordinates: the arc goes over the opening, not under it.
        ctx.arc(cx, f.y + rise, r, 0, Math.PI, true);
        break;
    }
    ctx.lineTo(bx, f.y + rise);
  }
  ctx.lineTo(x0, f.y - bleed);
  ctx.closePath();
}

/** Fill an arcade band and ink only its underside — its other three sides are joins. */
function paintArcade(
  ctx: FlatCtx,
  f: Box,
  bays: number,
  r: number,
  rise: number,
  head: ArchHead,
): void {
  const T = caseTimber();
  const bleed = jointBleed(rise);
  traceArcadeBand(ctx, f, bays, r, rise, head, bleed);
  ctx.fillStyle = T.face;
  ctx.fill();
  // Clip to the band and re-trace, so the ink lands on the arch line only:
  // the top and the two sides are inside the neighbouring parts and must carry
  // no line of their own.
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x, f.y, f.w, rise + r * 2.4);
  ctx.clip();
  traceArcadeBand(ctx, f, bays, r, rise, head, bleed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = inkWidth(rise);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
  // The soffit of the arch: a fine darker line just inside the head, which is
  // the thickness of the timber the arch is cut from.
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x, f.y, f.w, rise + r * 2.4);
  ctx.clip();
  traceArcadeBand(ctx, f, bays, r, rise - inkWidth(rise) * 1.4, head, bleed);
  ctx.strokeStyle = T.arris;
  ctx.lineWidth = Math.max(0.8, inkWidth(rise) * 0.4);
  ctx.stroke();
  ctx.restore();
}

/**
 * One member inside an opening — a rail, a stile, a muntin, a divider.
 *
 * `joins` is not optional in spirit: every member of a frame runs INTO
 * something at both ends, and a member drawn with four rounded corners and a
 * full outline is the single reason the old openings read as a pile of applied
 * strips rather than as joinery.
 */
function member(ctx: FlatCtx, b: Box, seed: number, joins: Joins, fill?: string): void {
  const T = caseTimber();
  partPanel(ctx, b, fill ?? T.face, {
    radius: Math.min(b.w, b.h) * 0.2,
    seed,
    joins,
    width: Math.max(1, inkWidth(Math.min(b.w, b.h)) * 0.85),
  });
}

/** An upright member: top and bottom always run into the boards. */
function stileAt(ctx: FlatCtx, x: number, f: Box, w: number, seed: number, fill?: string): void {
  member(ctx, { x, y: f.y, w, h: f.h }, seed, { top: true, bottom: true }, fill);
}

/** A horizontal member: left and right always run into the uprights. */
function railAt(ctx: FlatCtx, y: number, f: Box, h: number, seed: number, fill?: string): void {
  member(ctx, { x: f.x, y, w: f.w, h }, seed, { left: true, right: true }, fill);
}

/**
 * The carpentry inside one opening, drawn over the recess and behind the books.
 *
 * `frame` is the VISIBLE opening — between the uprights, not the whole texture
 * — because the recess is baked deliberately oversize so its own outline falls
 * off-canvas, and an arch springing from that would spring from nowhere.
 *
 * Everything here lives behind the books by construction (the recess sprite is
 * under them), so the ornament that pays off is whatever sits HIGH in the
 * opening: arch heads, valances, the top rail of a compartment run. Members
 * that run to the floor are still drawn — they show through the gaps between
 * spines, which is exactly where a real one would.
 */
export function paintOpening(ctx: FlatCtx, spec: BuildSpec, frame: Box, seed: number): void {
  const f = frame;
  if (f.w <= 8 || f.h <= 8) return;
  const T = caseTimber();

  switch (spec.opening) {
    case 'plain':
      break;

    case 'frame': {
      const t = Math.max(3, Math.min(f.h * 0.075, f.w * 0.03));
      railAt(ctx, f.y, f, t, seed + 1);
      stileAt(ctx, f.x, f, t, seed + 2);
      stileAt(ctx, f.x + f.w - t, f, t, seed + 3);
      break;
    }

    case 'panelled': {
      // Fielded panels standing in the back of the case: a sunk surround with
      // a raised field inside it, which is what timber panelling actually is.
      const cells = Math.max(2, Math.round(f.w / (f.h * 0.85)));
      const gap = Math.max(4, f.h * 0.045);
      const pw = (f.w - gap * (cells + 1)) / cells;
      for (let i = 0; i < cells; i++) {
        const b: Box = { x: f.x + gap + i * (pw + gap), y: f.y + gap, w: pw, h: f.h - gap * 2 };
        partPanel(ctx, b, T.deep, { radius: gap * 0.7, seed: seed + i * 7, joins: { bottom: true }, width: Math.max(1, inkWidth(gap) * 0.8) });
        const inset = gap * 0.9;
        const field: Box = { x: b.x + inset, y: b.y + inset, w: b.w - inset * 2, h: b.h - inset };
        if (field.w > 4) {
          partPanel(ctx, field, T.edge, { radius: inset * 0.6, seed: seed + i * 11, joins: { bottom: true }, width: Math.max(0.9, inkWidth(inset) * 0.6) });
        }
      }
      break;
    }

    case 'arch': {
      const bays = Math.max(1, Math.round(f.w / (f.h * 1.05)));
      const r = Math.min((f.w / bays) * 0.42, f.h * 0.32);
      paintArcade(ctx, f, bays, r, r + f.h * 0.06, 'round');
      break;
    }

    case 'gothic': {
      const bays = Math.max(2, Math.round(f.w / (f.h * 0.72)));
      const r = Math.min((f.w / bays) * 0.44, f.h * 0.26);
      const rise = r * 1.75 + f.h * 0.05;
      paintArcade(ctx, f, bays, r, rise, 'pointed');
      // A gilt boss where each pair of arcs meets.
      const bayW = f.w / bays;
      for (let i = 0; i < bays; i++) {
        ctx.beginPath();
        ctx.arc(f.x + bayW * (i + 0.5), f.y + rise - r * 1.7, Math.max(1.6, r * 0.1), 0, Math.PI * 2);
        ctx.fillStyle = FLAT.gilt;
        ctx.fill();
      }
      break;
    }

    case 'ogee': {
      const bays = Math.max(2, Math.round(f.w / (f.h * 0.78)));
      const r = Math.min((f.w / bays) * 0.42, f.h * 0.24);
      paintArcade(ctx, f, bays, r, r * 1.95 + f.h * 0.05, 'ogee');
      break;
    }

    case 'trefoil': {
      const bays = Math.max(2, Math.round(f.w / (f.h * 0.66)));
      const r = Math.min((f.w / bays) * 0.44, f.h * 0.26);
      paintArcade(ctx, f, bays, r, r * 1.7 + f.h * 0.06, 'trefoil');
      break;
    }

    case 'dovecote': {
      // Small round-headed holes in courses. The band between the courses is
      // one piece of timber, so the arcade tracer draws it whole.
      const rows = 2;
      const rowH = f.h * 0.34;
      for (let row = 0; row < rows; row++) {
        const band: Box = { x: f.x, y: f.y + row * rowH * 1.02, w: f.w, h: rowH };
        const bays = Math.max(4, Math.round(f.w / (rowH * 0.92)));
        const r = Math.min((f.w / bays) * 0.36, rowH * 0.42);
        paintArcade(ctx, band, bays, r, r + rowH * 0.16, 'round');
      }
      break;
    }

    case 'valance': {
      const cells = Math.max(4, Math.round(f.w / (f.h * 0.22)));
      const r = (f.w / cells) * 0.46;
      paintArcade(ctx, f, cells, r, r + f.h * 0.05, 'round');
      break;
    }

    case 'ledge': {
      // A plate rail: one deep board across the top of the bay with a lip.
      const h = Math.max(5, f.h * 0.1);
      railAt(ctx, f.y, f, h, seed + 1);
      edgeLine(ctx, f.x, f.y + h * 0.68, f.x + f.w, f.y + h * 0.68, T.deep, Math.max(1, inkWidth(h) * 0.5), seed, 0.6);
      break;
    }

    case 'divided': {
      const cells = Math.max(3, Math.round(f.w / (f.h * 0.62)));
      const dw = Math.max(4, f.h * 0.032);
      for (let i = 1; i < cells; i++) {
        stileAt(ctx, f.x + (f.w * i) / cells - dw / 2, f, dw, seed + i * 7);
      }
      railAt(ctx, f.y + f.h * 0.26, f, Math.max(4, f.h * 0.045), seed + 71);
      break;
    }

    case 'grid': {
      const cells = Math.max(5, Math.round(f.w / (f.h * 0.34)));
      const dw = Math.max(3, f.h * 0.022);
      for (let i = 1; i < cells; i++) {
        stileAt(ctx, f.x + (f.w * i) / cells - dw / 2, f, dw, seed + i * 5);
      }
      const rh = Math.max(3, f.h * 0.03);
      for (const t of [0.2, 0.44]) {
        railAt(ctx, f.y + f.h * t, f, rh, seed + t * 100);
      }
      break;
    }

    case 'crate': {
      const t = Math.max(4, f.h * 0.085);
      railAt(ctx, f.y, f, t, seed + 1);
      railAt(ctx, f.y + f.h - t, f, t, seed + 2);
      stileAt(ctx, f.x, f, t, seed + 3);
      stileAt(ctx, f.x + f.w - t, f, t, seed + 4);
      // Corner blocks are CUT INTO the corner, so two of their sides are joins
      // and they share the frame's outline instead of laying a third one over
      // the two already crossing there.
      const c = t * 1.7;
      const corners: readonly (readonly [number, number, Joins])[] = [
        [f.x, f.y, { top: true, left: true }],
        [f.x + f.w - c, f.y, { top: true, right: true }],
        [f.x, f.y + f.h - c, { bottom: true, left: true }],
        [f.x + f.w - c, f.y + f.h - c, { bottom: true, right: true }],
      ];
      for (const [cx, cy, joins] of corners) {
        member(ctx, { x: cx, y: cy, w: c, h: c }, seed + cx + cy, joins, T.edge);
      }
      break;
    }

    case 'xbrace': {
      // A pair of diagonal braces across the back of the bay. Drawn as filled
      // parallelograms rather than thick strokes so their ends are cut square
      // against the frame, the way a housed brace is.
      const t = Math.max(4, f.h * 0.05);
      railAt(ctx, f.y, f, t, seed + 1);
      railAt(ctx, f.y + f.h - t, f, t, seed + 2);
      const bw = Math.max(4, f.h * 0.05);
      const y0 = f.y + t;
      const y1 = f.y + f.h - t;
      for (const dir of [1, -1]) {
        const ax = dir === 1 ? f.x : f.x + f.w;
        const bx = dir === 1 ? f.x + f.w : f.x;
        ctx.beginPath();
        ctx.moveTo(ax, y0);
        ctx.lineTo(ax + dir * bw * 1.6, y0);
        ctx.lineTo(bx, y1);
        ctx.lineTo(bx - dir * bw * 1.6, y1);
        ctx.closePath();
        ctx.fillStyle = T.face;
        ctx.fill();
        ctx.strokeStyle = FLAT.ink;
        ctx.lineWidth = Math.max(1, inkWidth(bw) * 0.8);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      break;
    }

    case 'spindle': {
      // Turned spindles under the top rail. Each is a join at both ends, so
      // they read as tenoned into the rails rather than dropped in.
      const rh = Math.max(4, f.h * 0.06);
      railAt(ctx, f.y, f, rh, seed + 1);
      const band = f.h * 0.2;
      railAt(ctx, f.y + band, f, rh * 0.8, seed + 2);
      const step = Math.max(10, f.h * 0.12);
      const sw = Math.max(3, step * 0.3);
      for (let x = f.x + step * 0.5; x < f.x + f.w - sw; x += step) {
        member(ctx, { x, y: f.y + rh, w: sw, h: band - rh + rh * 0.8 }, seed + x, { top: true, bottom: true });
        // The turned belly: a wider collar halfway down.
        member(
          ctx,
          { x: x - sw * 0.28, y: f.y + rh + (band - rh) * 0.42, w: sw * 1.56, h: Math.max(2.5, sw * 0.7) },
          seed + x + 5,
          { left: true, right: true },
        );
      }
      break;
    }

    case 'fret': {
      // A geometric fret across the head of the bay: a band of squared
      // meanders, all of it one continuous member run.
      const bandH = f.h * 0.2;
      const rh = Math.max(3.5, f.h * 0.035);
      railAt(ctx, f.y, f, rh, seed + 1);
      railAt(ctx, f.y + bandH, f, rh, seed + 2);
      const step = Math.max(14, bandH * 1.15);
      const t = Math.max(3, rh * 0.85);
      for (let x = f.x; x < f.x + f.w; x += step) {
        member(ctx, { x, y: f.y, w: t, h: bandH }, seed + x, { top: true, bottom: true });
        member(ctx, { x, y: f.y + bandH * 0.46, w: step * 0.56, h: t }, seed + x + 3, { left: true });
        member(ctx, { x: x + step * 0.5, y: f.y + bandH * 0.2, w: t, h: bandH * 0.32 }, seed + x + 7, { bottom: true });
      }
      break;
    }

    case 'glass': {
      const t = Math.max(3, f.h * 0.05);
      railAt(ctx, f.y, f, t, seed + 1);
      stileAt(ctx, f.x, f, t, seed + 2);
      stileAt(ctx, f.x + f.w - t, f, t, seed + 3);
      // The sash: a top rail with muntins under it. Books stand in front of
      // the glazing, which is the one compromise in this build — there is no
      // layer between the reader and the shelf to hang a door on.
      railAt(ctx, f.y + f.h * 0.16, f, Math.max(3, f.h * 0.042), seed + 4);
      const mw = Math.max(3, f.h * 0.026);
      for (const t2 of [1 / 3, 2 / 3]) {
        stileAt(ctx, f.x + f.w * t2 - mw / 2, f, mw, seed + t2 * 200);
      }
      break;
    }
  }
}

/* ----------------------------------------------------------------------------
   Build: the cornice
   -------------------------------------------------------------------------- */

/**
 * What `drawCrownBody` hands back so the caller can pattern and close it.
 *
 * `trace` and `outline` are closures over the EXACT path the body was drawn
 * with, not a rectangle that approximates it. The cornice is the one part
 * whose silhouette is cut rather than rectangular, so a caller that clipped to
 * a box would let a pattern spill through the battlements, and one that
 * re-stroked a box would draw a straight line across them.
 */
export interface CrownBody {
  /** The band worth working a pattern into — the corona, never the crest. */
  face: Box;
  /** The band the gilt studs and a build's own ornament go on. */
  frieze: Box;
  /** Re-trace the whole silhouette, for clipping. */
  trace: (ctx: FlatCtx) => void;
  /** Ink the silhouette's free edges — everything but its underside. */
  outline: (ctx: FlatCtx) => void;
}

/**
 * How much of the cornice's height the crest occupies, per crest.
 *
 * This is also how much of the PLINTH's height goes missing at the two ends,
 * because the plinth is this bitmap upside down: whatever the crest cuts away
 * above the cornice is cut away below the plinth. A crest with a deep rise and
 * a narrow raised feature — a gable — therefore reads as a plinth that has
 * been trimmed short at both ends, so the gable's rise is kept small and its
 * span wide.
 */
const CREST_RISE: Readonly<Record<CrestKind, number>> = {
  flat: 0,
  battlement: 0.3,
  scallop: 0.28,
  sawtooth: 0.26,
  pediment: 0.26,
  finial: 0.26,
  dentil: 0.18,
  wave: 0.22,
  steps: 0.28,
};

/**
 * Where each cornice profile's corona ends and where its ornament sits, as
 * fractions of the body below the crest.
 *
 * The gilt studs used to be placed at the middle of the patterned band, which
 * is the one band guaranteed to have a moulding running through it: they
 * landed on top of whatever the pattern was doing. They go on the band BELOW
 * the corona instead — a frieze or a bed mould — which is where furniture puts
 * its nailheads anyway.
 */
const CORNICE_BANDS: Readonly<Record<CorniceKind, { corona: number; stud: number }>> = {
  board: { corona: 0.74, stud: 0.87 },
  bedMould: { corona: 0.52, stud: 0.66 },
  stepped: { corona: 0.4, stud: 0.64 },
  frieze: { corona: 0.34, stud: 0.6 },
  reeded: { corona: 0.7, stud: 0.85 },
  slab: { corona: 0.84, stud: 0.45 },
  rail: { corona: 0.66, stud: 0.33 },
};

/** How far below the cornice's top the BODY starts, per profile. */
const BODY_DROP: Readonly<Record<CorniceKind, number>> = {
  board: 0,
  bedMould: 0,
  stepped: 0,
  frieze: 0,
  reeded: 0,
  slab: 0,
  // A ladder's head rail is a slim bar, not a cornice: less of the slot is
  // timber and the rest is wall.
  rail: 0.34,
};

/**
 * Draw the crest, left to right, from (x0, yBase) to (x1, yBase).
 *
 * Returns the y the RIGHT-hand edge should carry on down from, which is the
 * base for every crest except `flat` — that one has no crest at all and hands
 * back its own rounded corner instead.
 *
 * Everything here is `lineTo`/`quadraticCurveTo` on a path the caller opened:
 * the crest and the cornice body are ONE path, filled once and inked once.
 * Drawn as separate panels standing on a band — which is how the battlements
 * were drawn — the band's own outline runs underneath them and every merlon
 * shows two rounded bottom corners against it.
 */
function crestProfile(
  ctx: FlatCtx,
  crest: CrestKind,
  x0: number,
  x1: number,
  yTop: number,
  yBase: number,
  r: number,
  seed: number,
): number {
  const w = x1 - x0;
  const rise = yBase - yTop;

  if (crest === 'flat') {
    // A plain cornice: rounded top corners and a hair of bow across the top.
    ctx.quadraticCurveTo(x0, yTop, x0 + r, yTop);
    ctx.quadraticCurveTo((x0 + x1) / 2, yTop - Math.max(0.6, rise * 0.02 + w * 0.0015), x1 - r, yTop);
    ctx.quadraticCurveTo(x1, yTop, x1, yTop + r);
    return yTop + r;
  }

  /** Soft corner on a cut edge: nothing in this style is a true right angle. */
  const q = Math.max(1, Math.min(rise * 0.16, 3.5));

  switch (crest) {
    case 'battlement':
    case 'dentil': {
      // Merlons cut from the board. Wide and few for the battlement, small and
      // many for the dentil course, but the same cut.
      // Battlements are FEW and wide, dentils many and small. A crenellation
      // pitched like a dentil course reads as a comb, and it is the plinth
      // that suffers most: eighty little square feet under a bookcase.
      const cell = crest === 'battlement' ? Math.max(54, rise * 3.4) : Math.max(11, rise * 1.5);
      const cells = Math.max(3, Math.round(w / cell));
      const cw = w / cells;
      const mw = cw * (crest === 'battlement' ? 0.58 : 0.54);
      for (let i = 0; i < cells; i++) {
        const a = x0 + i * cw + (cw - mw) / 2;
        ctx.lineTo(a - q, yBase);
        ctx.quadraticCurveTo(a, yBase, a, yBase - q);
        ctx.lineTo(a, yTop + q);
        ctx.quadraticCurveTo(a, yTop, a + q, yTop);
        ctx.lineTo(a + mw - q, yTop);
        ctx.quadraticCurveTo(a + mw, yTop, a + mw, yTop + q);
        ctx.lineTo(a + mw, yBase - q);
        ctx.quadraticCurveTo(a + mw, yBase, a + mw + q, yBase);
      }
      ctx.lineTo(x1, yBase);
      return yBase;
    }

    case 'scallop': {
      const cells = Math.max(6, Math.round(w / Math.max(20, rise * 2.1)));
      const cw = w / cells;
      const rr = cw / 2;
      for (let i = 0; i < cells; i++) {
        const cx = x0 + cw * (i + 0.5);
        // PI → 2PI passes 3PI/2, which is UP in canvas coordinates.
        ctx.arc(cx, yBase, rr, Math.PI, 0, false);
      }
      ctx.lineTo(x1, yBase);
      return yBase;
    }

    case 'sawtooth': {
      // Gables, not saw teeth: pitched about 3:2, which is a roof line.
      const cells = Math.max(5, Math.round(w / Math.max(44, rise * 3.2)));
      const cw = w / cells;
      for (let i = 0; i < cells; i++) {
        const a = x0 + i * cw;
        ctx.lineTo(a + cw * 0.5 - q * 0.5, yTop + q);
        ctx.quadraticCurveTo(a + cw * 0.5, yTop, a + cw * 0.5 + q * 0.5, yTop + q);
        ctx.lineTo(a + cw, yBase);
      }
      return yBase;
    }

    case 'wave': {
      // A serpentine cresting: shallow enough to invert into an apron, which
      // is what it becomes when `world.ts` stands this bitmap on its head.
      // Long and slow. Pitched tighter it stops being a serpentine and turns
      // into a second scallop crest, which the set already has.
      const cells = Math.max(3, Math.round(w / Math.max(155, rise * 11)));
      const cw = w / cells;
      for (let i = 0; i < cells; i++) {
        const a = x0 + i * cw;
        ctx.quadraticCurveTo(a + cw * 0.25, yBase, a + cw * 0.5, (yBase + yTop) / 2);
        ctx.quadraticCurveTo(a + cw * 0.75, yTop, a + cw, yBase);
      }
      return yBase;
    }

    case 'steps': {
      // Stepped eaves: two steps up to a flat centre and two back down. It
      // inverts into a stepped plinth, which is a real base for a case.
      const s = Math.min(w * 0.11, Math.max(42, rise * 3));
      const h = rise / 2;
      ctx.lineTo(x0 + s, yBase);
      ctx.lineTo(x0 + s, yBase - h);
      ctx.lineTo(x0 + s * 2, yBase - h);
      ctx.lineTo(x0 + s * 2, yTop);
      ctx.lineTo(x1 - s * 2, yTop);
      ctx.lineTo(x1 - s * 2, yBase - h);
      ctx.lineTo(x1 - s, yBase - h);
      ctx.lineTo(x1 - s, yBase);
      ctx.lineTo(x1, yBase);
      return yBase;
    }

    case 'finial': {
      // Blocks at the two ends and one in the middle. Upside down they are the
      // feet the case stands on, which is why this crest is the safest of all.
      const bw = Math.max(14, rise * 1.5);
      const centres = [x0 + bw * 0.8, (x0 + x1) / 2, x1 - bw * 0.8];
      for (const cx of centres) {
        ctx.lineTo(cx - bw / 2 - q, yBase);
        ctx.quadraticCurveTo(cx - bw / 2, yBase, cx - bw / 2, yBase - q);
        ctx.lineTo(cx - bw / 2, yTop + q);
        ctx.quadraticCurveTo(cx - bw / 2, yTop, cx - bw / 2 + q, yTop);
        ctx.lineTo(cx + bw / 2 - q, yTop);
        ctx.quadraticCurveTo(cx + bw / 2, yTop, cx + bw / 2, yTop + q);
        ctx.lineTo(cx + bw / 2, yBase - q);
        ctx.quadraticCurveTo(cx + bw / 2, yBase, cx + bw / 2 + q, yBase);
      }
      ctx.lineTo(x1, yBase);
      return yBase;
    }

    case 'pediment': {
      // A raised centre tablet with sloped shoulders, not a true gable.
      //
      // A gable cannot work here twice over. A cornice 1228 world px wide and
      // 66 tall gives an apex of about a fortieth of its span, which flattens
      // into a hump that reads as a mistake; and the plinth is this bitmap
      // upside down, so a point in the middle becomes an arrowhead hanging
      // under the bookcase. A flat-topped tablet is legible at 1:1 and inverts
      // into a centre drop, which is a shape a joiner actually cuts.
      const cx = (x0 + x1) / 2;
      const flat = Math.max(60, w * 0.22);
      const slope = Math.max(18, rise * 1.9);
      ctx.lineTo(cx - flat / 2 - slope, yBase);
      ctx.lineTo(cx - flat / 2 - q, yTop + q);
      ctx.quadraticCurveTo(cx - flat / 2, yTop, cx - flat / 2 + q, yTop);
      ctx.lineTo(cx + flat / 2 - q, yTop);
      ctx.quadraticCurveTo(cx + flat / 2, yTop, cx + flat / 2 + q, yTop + q);
      ctx.lineTo(cx + flat / 2 + slope, yBase);
      ctx.lineTo(x1, yBase);
      return yBase;
    }
  }
  void seed;
  ctx.lineTo(x1, yBase);
  return yBase;
}

/** The cornice's whole outline: crest on top, joins underneath. */
function crownPath(
  ctx: FlatCtx,
  b: Box,
  spec: BuildSpec,
  bleed: number,
  r: number,
  seed: number,
  close: boolean,
): void {
  const drop = b.h * BODY_DROP[spec.crown];
  const yTop = b.y + drop;
  const yBase = yTop + (b.h - drop) * CREST_RISE[spec.crest];
  // The underside is a JOIN: the case is flush under it, so the fill runs past
  // and no ink line is drawn there. That square underside is what finally
  // gives the cornice a vertical edge shared with the upright below it — the
  // rounded bottom corner it used to have curled inboard of the case's own
  // side and left the lip hanging in mid-air.
  const yBot = b.y + b.h + bleed;
  const amp = Math.max(0.5, b.h * 0.012);

  ctx.beginPath();
  ctx.moveTo(b.x, yBot);
  const leftTop = spec.crest === 'flat' ? yTop + r : yBase;
  ctx.quadraticCurveTo(b.x - amp, (yBot + leftTop) / 2, b.x, leftTop);
  const rightTop = crestProfile(ctx, spec.crest, b.x, b.x + b.w, yTop, yBase, r, seed);
  ctx.quadraticCurveTo(b.x + b.w + amp, (yBot + rightTop) / 2, b.x + b.w, yBot);
  if (close) {
    ctx.lineTo(b.x, yBot);
    ctx.closePath();
  }
}

/**
 * Draw the cornice's body and hand back the face worth patterning.
 *
 * The cornice is the ONE part with transparency above it, so it is the one
 * part whose silhouette a build can genuinely change. Everything else has a
 * neighbour flush against it and has to make its case within a rectangle.
 *
 * Every profile below is FULL WIDTH and banded horizontally. It used to be
 * possible for a profile to step its lower board inward — and the face-frame
 * cornice did, by a fraction of the width tuned to the cornice's own lip. It
 * came out about three pixels narrow, which opened a hole of bare wall above
 * each upright at both top corners of the case: the defect the reader named.
 * A cornice that only ever varies vertically cannot open one.
 */
export function drawCrownBody(ctx: FlatCtx, spec: BuildSpec, b: Box, seed: number): CrownBody {
  const T = caseTimber();
  const bleed = jointBleed(b.h);
  const ink = inkWidth(b.h);
  const r = b.h * 0.18;
  const drop = b.h * BODY_DROP[spec.crown];
  const top = b.y + drop;
  const h = b.h - drop;
  const yBase = top + h * CREST_RISE[spec.crest];
  const trace = (c: FlatCtx): void => crownPath(c, b, spec, bleed, r, seed, true);

  trace(ctx);
  ctx.fillStyle = T.face;
  ctx.fill();

  // The bands, inside the silhouette. `u` is measured from the crest's base,
  // so a profile reads the same under a battlement as under a plain top.
  // Measured to the box the CALLER asked for, not to the bled edge. The bleed
  // exists so the fill runs under the case; measuring bands against it puts
  // every boundary — and the gilt studs sitting on one — a few pixels lower
  // than the cornice actually is, and the bake crops them in half.
  const bodyH = b.y + b.h - yBase;
  const bandAt = (t: number): number => yBase + bodyH * t;
  const wide = { x: b.x - bleed, w: b.w + bleed * 2 };

  ctx.save();
  trace(ctx);
  ctx.clip();

  /** A face turning away, plus the chamfer that stops it. */
  const band = (from: number, colour: string, arris: boolean, s: number): void => {
    const y = bandAt(from);
    ctx.fillStyle = colour;
    ctx.fillRect(wide.x, y, wide.w, b.y + b.h + bleed - y);
    if (arris) {
      edgeLine(ctx, wide.x, y, wide.x + wide.w, y, T.arris, Math.max(0.9, ink * 0.4), s, 0.7);
    }
    edgeLine(ctx, wide.x, y - ink * 0.5, wide.x + wide.w, y - ink * 0.5, FLAT.ink, Math.max(1, ink * 0.55), s + 1, 0.7);
  };

  switch (spec.crown) {
    case 'board':
      // Corona over a plain soffit.
      band(0.74, T.edge, true, seed + 3);
      break;
    case 'bedMould':
      // Corona, a bed mould, then the soffit under it: three faces, each one
      // stepping further away from the reader.
      band(0.52, T.edge, true, seed + 3);
      band(0.82, T.deep, false, seed + 5);
      break;
    case 'stepped':
      // A cornice steps OUT as it rises, so the light face is the top one and
      // each band below it is set back.
      band(0.4, T.arris, false, seed + 2);
      band(0.5, T.edge, false, seed + 3);
      band(0.8, T.deep, false, seed + 5);
      break;
    case 'frieze':
      // A tall plain frieze under a thin corona: the entablature proportion.
      band(0.34, T.edge, true, seed + 3);
      band(0.86, T.deep, false, seed + 5);
      break;
    case 'reeded': {
      // Reeds run along the corona, then the soffit.
      band(0.7, T.edge, true, seed + 3);
      for (let i = 0; i < 3; i++) {
        const y = bandAt(0.14 + i * 0.18);
        edgeLine(ctx, wide.x, y, wide.x + wide.w, y, T.edge, Math.max(1.4, ink * 0.7), seed + i * 7, 0.7);
        edgeLine(ctx, wide.x, y - ink * 0.45, wide.x + wide.w, y - ink * 0.45, T.arris, Math.max(0.8, ink * 0.32), seed + i * 7 + 1, 0.7);
      }
      break;
    }
    case 'slab':
      // One thick board. Only an arris, near the bottom, where the plane ran.
      band(0.84, T.edge, true, seed + 3);
      break;
    case 'rail':
      band(0.66, T.edge, true, seed + 3);
      break;
  }
  ctx.restore();

  const outline = (c: FlatCtx): void => {
    crownPath(c, b, spec, bleed, r, seed, false);
    c.strokeStyle = FLAT.ink;
    c.lineWidth = ink;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.stroke();
  };

  const coronaTop = spec.crest === 'flat' ? top + ink : yBase;
  const bands = CORNICE_BANDS[spec.crown];
  const studY = bandAt(bands.stud);
  return {
    face: { x: b.x, y: coronaTop, w: b.w, h: Math.max(4, bandAt(bands.corona) - coronaTop) },
    // A band centred on where the ornament goes, so `paintCrownTrim` can keep
    // placing at its middle without knowing the profile.
    frieze: { x: b.x, y: studY - bodyH * 0.1, w: b.w, h: Math.max(4, bodyH * 0.2) },
    trace,
    outline,
  };
}

/**
 * The ornament that goes ON the cornice, after its face has been patterned.
 *
 * The gilt studs are the app icon's own move and the reason a bare board did
 * not read as furniture. They sit on the FRIEZE rather than on the corona,
 * which is where the pattern lives: they used to be placed at the middle of
 * the patterned band and landed on top of whatever moulding was running there.
 */
export function paintCrownTrim(ctx: FlatCtx, spec: BuildSpec, b: Box, face: Box, seed: number): void {
  const T = caseTimber();
  // Ornament here is placed, not wobbled: a stud whose position jittered would
  // read as a mistake at 1:1 rather than as a hand. The seed stays in the
  // signature because every other part drawer takes one and the four are
  // called together.
  void seed;

  if (spec.crest === 'pediment') {
    // The boss in the tympanum: what tells you the gable is deliberate.
    const cy = b.y + b.h * CREST_RISE.pediment * 0.72;
    const rr = Math.max(2.2, b.h * 0.075);
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, cy, rr, 0, Math.PI * 2);
    ctx.fillStyle = FLAT.gilt;
    ctx.fill();
    ctx.strokeStyle = FLAT.ink;
    ctx.lineWidth = Math.max(1, inkWidth(b.h) * 0.5);
    ctx.stroke();
  }

  if (spec.crown === 'slab' && !spec.crownStuds) {
    // Draw-bored pegs through a slab cornice — the alternative to gilt studs,
    // never both: two kinds of ornament on one 66px board is a jumble.
    const rr = Math.max(2.2, b.h * 0.075);
    for (const t of [0.14, 0.5, 0.86]) {
      const cx = b.x + b.w * t;
      const cy = face.y + face.h * 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fillStyle = T.edge;
      ctx.fill();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = Math.max(0.9, inkWidth(b.h) * 0.38);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, rr * 0.44, 0, Math.PI * 2);
      ctx.fillStyle = T.arris;
      ctx.fill();
    }
  }

  if (spec.crownStuds) {
    const studs = Math.max(3, Math.round(b.w / 150));
    const rr = Math.max(1.6, b.h * 0.075);
    for (let i = 0; i < studs; i++) {
      const cx = b.x + b.w * ((i + 0.5) / studs);
      const cy = face.y + face.h * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fillStyle = FLAT.gilt;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx - rr * 0.24, cy - rr * 0.24, rr * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = FLAT.giltPale;
      ctx.fill();
    }
  }
}

/* ----------------------------------------------------------------------------
   Small shared helper for the part drawers
   -------------------------------------------------------------------------- */

/**
 * Run `paint` clipped to a face, with the face's own wobble.
 *
 * Kept beside `withinPart` because a pattern is worked into a FACE — the band
 * of a part that is turned toward the reader — which is not the same rectangle
 * as the part. The clip has to be the same shape the face was filled with, or
 * a pattern spills past a bowed edge and the case grows a fringe.
 */
export function withinFace(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  seed: number,
  paint: () => void,
): void {
  ctx.save();
  wobbleRect(ctx, x, y, w, h, radius, seed);
  ctx.clip();
  paint();
  ctx.restore();
}
