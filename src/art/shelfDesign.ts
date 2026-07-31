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
 *   crossed with every build without designing 144 cases by hand.
 *
 * Twelve builds × twelve patterns = 144 distinct cases; `SHELF_PRESETS` names
 * sixty of them for the studio to show, because a grid of 144 unlabelled
 * thumbnails is a worse product than sixty with names.
 *
 * ## The rules this file works under
 *
 * Everything here is `art/flat.ts` vocabulary and nothing else: flat colour,
 * ONE ink outline, rounded corners, edges that bow. Depth is a darker flat face
 * beside a lighter one. There is no light model — no groove is "shaded", it is
 * simply drawn in `timberDark`, which is the same trick the plank's front edge
 * has always played.
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
  panel,
  stroke,
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

/**
 * The twelve carpentries, in picker order.
 *
 * Ordered roughly plain → ornate → rustic, so the studio's grid reads as a
 * progression rather than an alphabet.
 */
export const BUILD_IDS = [
  'plank',
  'faceFrame',
  'arch',
  'gothic',
  'valance',
  'apothecary',
  'barrister',
  'pigeonhole',
  'colonnade',
  'crate',
  'ladder',
  'slab',
] as const;

export type BuildId = (typeof BUILD_IDS)[number];

/** The twelve timber treatments, in picker order (`none` first, always). */
export const PATTERN_IDS = [
  'none',
  'beaded',
  'fluted',
  'chevron',
  'herringbone',
  'chequer',
  'dotPunch',
  'rope',
  'dentil',
  'lattice',
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

/** The house carpentry: a plain plank case with nothing worked into it. */
export const DEFAULT_SHELF_DESIGN: ShelfDesign = { build: 'plank', pattern: 'none' };

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
type PlankTrim = 'none' | 'lip' | 'bead' | 'cleat' | 'rail' | 'peg' | 'knob' | 'scallop';

/** Extra carpentry on the upright. */
type PostTrim = 'none' | 'stile' | 'column' | 'ladder' | 'batten' | 'slab';

/** What fills the opening between the uprights, drawn over the recess. */
type OpeningKind =
  | 'plain'
  | 'frame'
  | 'arch'
  | 'gothic'
  | 'valance'
  | 'divided'
  | 'grid'
  | 'crate'
  | 'glass';

/** The cornice silhouette. The one part that may cut into its own outline. */
type CrownKind =
  | 'board'
  | 'stepped'
  | 'gothic'
  | 'scallop'
  | 'dentil'
  | 'pediment'
  | 'rail'
  | 'slab';

/**
 * One carpentry, as numbers the four part-drawers read.
 *
 * Deliberately data rather than four switch statements: a build has to hold
 * together ACROSS the parts — a gothic opening under a scalloped cottage
 * cornice is two builds fighting — and a table makes that legible in one
 * screenful.
 */
export interface BuildSpec {
  id: BuildId;
  name: string;
  /** One line for the studio card. */
  blurb: string;
  /** Board: fraction of its height that reads as the front edge. */
  plankEdge: number;
  /** Board: corner radius as a fraction of its height. */
  plankRadius: number;
  plankTrim: PlankTrim;
  /** Upright: fraction of the given width the shaft occupies, centred. */
  postShaft: number;
  postTrim: PostTrim;
  opening: OpeningKind;
  crown: CrownKind;
  /** Gilt studs along the cornice. Off for the builds that carry their own. */
  crownStuds: boolean;
}

function build(
  id: BuildId,
  name: string,
  blurb: string,
  spec: Omit<BuildSpec, 'id' | 'name' | 'blurb'>,
): BuildSpec {
  return { id, name, blurb, ...spec };
}

/** Every carpentry, keyed by id. */
export const BUILDS: Readonly<Record<BuildId, BuildSpec>> = {
  plank: build('plank', 'Plain Plank', 'A board, two uprights, nothing in the way of the books.', {
    plankEdge: 0.28,
    plankRadius: 0.22,
    plankTrim: 'none',
    postShaft: 1,
    postTrim: 'none',
    opening: 'plain',
    crown: 'board',
    crownStuds: true,
  }),

  faceFrame: build('faceFrame', 'Face Frame', 'Cabinet work: a proud rail on every board and a framed opening.', {
    plankEdge: 0.3,
    plankRadius: 0.16,
    plankTrim: 'lip',
    postShaft: 1,
    postTrim: 'stile',
    opening: 'frame',
    crown: 'stepped',
    crownStuds: true,
  }),

  arch: build('arch', 'Arch Opening', 'Round-headed bays, the way a reading room carries its ceiling.', {
    plankEdge: 0.26,
    plankRadius: 0.26,
    plankTrim: 'bead',
    postShaft: 1,
    postTrim: 'none',
    opening: 'arch',
    crown: 'board',
    crownStuds: true,
  }),

  gothic: build('gothic', 'Gothic Arch', 'Pointed bays under a battlemented cornice.', {
    plankEdge: 0.24,
    plankRadius: 0.14,
    plankTrim: 'bead',
    postShaft: 0.92,
    postTrim: 'column',
    opening: 'gothic',
    crown: 'gothic',
    crownStuds: false,
  }),

  valance: build('valance', 'Scalloped Valance', 'A fretted pelmet hangs over every shelf; the cornice waves back.', {
    plankEdge: 0.28,
    plankRadius: 0.3,
    plankTrim: 'scallop',
    postShaft: 1,
    postTrim: 'none',
    opening: 'valance',
    crown: 'scallop',
    crownStuds: true,
  }),

  apothecary: build('apothecary', 'Apothecary', 'Many small compartments behind the books, and a dentil course above.', {
    plankEdge: 0.32,
    plankRadius: 0.12,
    plankTrim: 'cleat',
    postShaft: 0.9,
    postTrim: 'batten',
    opening: 'divided',
    crown: 'dentil',
    crownStuds: false,
  }),

  barrister: build('barrister', 'Barrister', 'Glazed fronts hinted at by their sashes, with a pull on every board.', {
    plankEdge: 0.26,
    plankRadius: 0.18,
    plankTrim: 'knob',
    postShaft: 1,
    postTrim: 'stile',
    opening: 'glass',
    crown: 'stepped',
    crownStuds: true,
  }),

  pigeonhole: build('pigeonhole', 'Pigeonhole', 'A fine grid of cubbies — a sorting office that took up reading.', {
    plankEdge: 0.24,
    plankRadius: 0.14,
    plankTrim: 'none',
    postShaft: 0.85,
    postTrim: 'stile',
    opening: 'grid',
    crown: 'board',
    crownStuds: false,
  }),

  colonnade: build('colonnade', 'Cornice & Column', 'Columns with capitals, carrying a pedimented entablature.', {
    plankEdge: 0.26,
    plankRadius: 0.2,
    plankTrim: 'bead',
    postShaft: 0.86,
    postTrim: 'column',
    opening: 'frame',
    crown: 'pediment',
    crownStuds: true,
  }),

  crate: build('crate', 'Crate Stack', 'Stacked packing crates: corner blocks, batten ends, no ceremony.', {
    plankEdge: 0.34,
    plankRadius: 0.1,
    plankTrim: 'cleat',
    postShaft: 0.95,
    postTrim: 'batten',
    opening: 'crate',
    crown: 'slab',
    crownStuds: false,
  }),

  ladder: build('ladder', 'Ladder Shelf', 'Slim rails with rungs; the boards are simply laid across them.', {
    plankEdge: 0.22,
    plankRadius: 0.34,
    plankTrim: 'rail',
    postShaft: 0.5,
    postTrim: 'ladder',
    opening: 'plain',
    crown: 'rail',
    crownStuds: false,
  }),

  slab: build('slab', 'Rustic Slab', 'Thick pegged boards on rough uprights, planed once and left alone.', {
    plankEdge: 0.38,
    plankRadius: 0.34,
    plankTrim: 'peg',
    postShaft: 1,
    postTrim: 'slab',
    opening: 'plain',
    crown: 'slab',
    crownStuds: false,
  }),
};

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
}

const PATTERN_TABLE: readonly (readonly [PatternId, string, string])[] = [
  ['none', 'Plain', 'Bare timber. The books do the talking.'],
  ['beaded', 'Beaded', 'A run of half-round beads along every face.'],
  ['fluted', 'Fluted', 'Three grooves running the length of the timber.'],
  ['chevron', 'Chevron', 'Vs marching along the board.'],
  ['herringbone', 'Herringbone', 'Two courses of strokes leaning against each other.'],
  ['chequer', 'Chequer', 'A two-course chequered inlay.'],
  ['dotPunch', 'Dot Punch', 'Staggered rows of punched dots.'],
  ['rope', 'Rope Twist', 'A carved cord, twisting as it goes.'],
  ['dentil', 'Dentil', 'A course of little blocks, like teeth.'],
  ['lattice', 'Lattice', 'Crossed diagonals cutting the face into diamonds.'],
  ['tiled', 'Tiled', 'Coarse panelling: the face divided into offset tiles.'],
  ['notched', 'Notched', 'Notches chopped along the outer edge.'],
];

export const PATTERNS: Readonly<Record<PatternId, PatternSpec>> = Object.fromEntries(
  PATTERN_TABLE.map(([id, name, blurb]) => [id, { id, name, blurb }]),
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
 * Every pattern painter below is written once in this frame, so the same
 * twelve recipes serve the horizontal board and the vertical upright without a
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
 */
function cadence(face: Face, rawPitch: number): { pitch: number; starts: number[] } {
  const period = face.period > 0 ? face.period : Math.max(1, face.len);
  const n = Math.max(1, Math.round(period / Math.max(1, rawPitch)));
  const pitch = period / n;
  const kMin = Math.floor(face.phase / pitch) - 1;
  const kMax = Math.ceil((face.len + face.phase) / pitch) + 1;
  const starts: number[] = [];
  for (let k = kMin; k <= kMax; k++) starts.push(-face.phase + k * pitch);
  return { pitch, starts };
}

/** A hand-drawn line in face coordinates. */
function faceLine(
  ctx: FlatCtx,
  face: Face,
  t0: number,
  u0: number,
  t1: number,
  u1: number,
  colour: string,
  width: number,
  seed: number,
): void {
  const [x0, y0] = face.at(t0, u0);
  const [x1, y1] = face.at(t1, u1);
  stroke(ctx, x0, y0, x1, y1, colour, width, seed);
}

/** A flat block in face coordinates. No outline — patterns are fills. */
function faceBlock(
  ctx: FlatCtx,
  face: Face,
  t: number,
  u: number,
  dt: number,
  du: number,
  colour: string,
): void {
  const [x, y, w, h] = face.rect(t, u, dt, du);
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
}

/** A flat disc in face coordinates. */
function faceDot(
  ctx: FlatCtx,
  face: Face,
  t: number,
  u: number,
  r: number,
  colour: string,
): void {
  const [x, y] = face.at(t, u);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

/* ----------------------------------------------------------------------------
   The twelve pattern painters
   -------------------------------------------------------------------------- */

type PatternPainter = (ctx: FlatCtx, face: Face, seed: number) => void;

/**
 * Every painter draws INSIDE a clip the caller has already set to the timber
 * face, and never strokes an outline of its own: the one ink line belongs to
 * the part, and a motif with its own outline at 6px across is a smudge.
 *
 * Motifs are `timberDark` (the same darker face the plank's front edge uses)
 * and lines are `inkSoft`, so a pattern reads as worked timber rather than as
 * a second drawing competing with the case's outline.
 */
const PAINTERS: Readonly<Record<PatternId, PatternPainter>> = {
  none: () => undefined,

  beaded: (ctx, face, seed) => {
    const k = face.thick;
    const dark = flatScheme().timberDark;
    const r = k * 0.18;
    faceLine(ctx, face, 0, k * 0.16, face.len, k * 0.16, FLAT.inkSoft, Math.max(0.8, k * 0.04), seed);
    const { pitch, starts } = cadence(face, r * 2.6);
    for (const t of starts) faceDot(ctx, face, t + pitch / 2, k * 0.58, r, dark);
  },

  fluted: (ctx, face, seed) => {
    // Grooves run ALONG the timber, which is what makes this the one pattern
    // with no repeat at all — and therefore the one that is perfectly seamless
    // where two upright tiles meet.
    const k = face.thick;
    const dark = flatScheme().timberDark;
    for (let i = 0; i < 3; i++) {
      const u = k * (0.26 + i * 0.24);
      faceLine(ctx, face, 0, u, face.len, u, dark, Math.max(1.4, k * 0.11), seed + i * 5);
      faceLine(ctx, face, 0, u, face.len, u, FLAT.inkSoft, Math.max(0.7, k * 0.03), seed + i * 5 + 2);
    }
  },

  chevron: (ctx, face, seed) => {
    const k = face.thick;
    const dark = flatScheme().timberDark;
    const width = Math.max(1.4, k * 0.12);
    const { pitch, starts } = cadence(face, k * 0.85);
    for (const t of starts) {
      faceLine(ctx, face, t, k * 0.84, t + pitch / 2, k * 0.18, dark, width, seed + t);
      faceLine(ctx, face, t + pitch / 2, k * 0.18, t + pitch, k * 0.84, dark, width, seed + t + 1);
    }
  },

  herringbone: (ctx, face, seed) => {
    // Two courses leaning opposite ways, the lower one offset by half a cell.
    // The offset is the whole pattern: aligned courses meet in a point and the
    // eye reads a chevron, which is already the pattern next door. A true
    // brick-bond herringbone dissolves below about 30px of face, so this is
    // the reading of it that survives a 29px board.
    const k = face.thick;
    const dark = flatScheme().timberDark;
    const width = Math.max(1.3, k * 0.11);
    const { pitch, starts } = cadence(face, k * 0.42);
    for (const t of starts) {
      faceLine(ctx, face, t, k * 0.04, t + pitch, k * 0.46, dark, width, seed + t);
      const o = t + pitch * 0.5;
      faceLine(ctx, face, o + pitch, k * 0.54, o, k * 0.96, dark, width, seed + t + 3);
    }
    faceLine(ctx, face, 0, k * 0.5, face.len, k * 0.5, FLAT.inkSoft, Math.max(0.7, k * 0.03), seed + 9);
  },

  chequer: (ctx, face, seed) => {
    const k = face.thick;
    const dark = flatScheme().timberDark;
    const s = k * 0.4;
    const top = k * 0.5 - s;
    const { pitch, starts } = cadence(face, s * 2);
    for (const t of starts) {
      faceBlock(ctx, face, t, top, pitch / 2, s, dark);
      faceBlock(ctx, face, t + pitch / 2, top + s, pitch / 2, s, dark);
    }
    faceLine(ctx, face, 0, top, face.len, top, FLAT.inkSoft, Math.max(0.7, k * 0.03), seed);
    faceLine(ctx, face, 0, top + s * 2, face.len, top + s * 2, FLAT.inkSoft, Math.max(0.7, k * 0.03), seed + 1);
  },

  dotPunch: (ctx, face, seed) => {
    const k = face.thick;
    const r = Math.max(1, k * 0.08);
    const { pitch, starts } = cadence(face, k * 0.46);
    for (const t of starts) {
      faceDot(ctx, face, t + pitch * 0.25, k * 0.32, r, FLAT.inkSoft);
      faceDot(ctx, face, t + pitch * 0.75, k * 0.68, r, FLAT.inkSoft);
    }
    void seed;
  },

  rope: (ctx, face, seed) => {
    // A twisted cord: short slanted strokes, tight enough that the eye reads
    // the gaps as the twist rather than as separate marks.
    const k = face.thick;
    const dark = flatScheme().timberDark;
    const width = Math.max(1.6, k * 0.16);
    const { pitch, starts } = cadence(face, k * 0.34);
    for (const t of starts) {
      faceLine(ctx, face, t, k * 0.76, t + pitch * 1.5, k * 0.24, dark, width, seed + t);
    }
    for (const u of [k * 0.16, k * 0.84]) {
      faceLine(ctx, face, 0, u, face.len, u, FLAT.inkSoft, Math.max(0.7, k * 0.035), seed + u);
    }
  },

  dentil: (ctx, face, seed) => {
    const k = face.thick;
    const dark = flatScheme().timberDark;
    const { pitch, starts } = cadence(face, k * 0.62);
    for (const t of starts) faceBlock(ctx, face, t, k * 0.14, pitch * 0.56, k * 0.48, dark);
    faceLine(ctx, face, 0, k * 0.68, face.len, k * 0.68, FLAT.inkSoft, Math.max(0.8, k * 0.04), seed);
  },

  lattice: (ctx, face, seed) => {
    const k = face.thick;
    const dark = flatScheme().timberDark;
    const width = Math.max(1.1, k * 0.09);
    // The diagonals run one face-thickness per step, so the diamonds are
    // square whatever the face is: the same recipe on a 29px board and a 25px
    // upright, neither of them stretched.
    const { starts } = cadence(face, k * 0.72);
    for (const t of starts) {
      faceLine(ctx, face, t, 0, t + k, k, dark, width, seed + t);
      faceLine(ctx, face, t + k, 0, t, k, dark, width, seed + t + 4);
    }
  },

  tiled: (ctx, face, seed) => {
    // Deliberately the coarsest pattern in the set: two courses of big panels.
    // It is the one that still reads when the whole case is a thumbnail.
    const k = face.thick;
    const line = Math.max(0.9, k * 0.045);
    faceLine(ctx, face, 0, k * 0.5, face.len, k * 0.5, FLAT.inkSoft, line, seed);
    const { pitch, starts } = cadence(face, k * 2.2);
    for (const t of starts) {
      faceLine(ctx, face, t, 0, t, k * 0.5, FLAT.inkSoft, line, seed + t);
      faceLine(ctx, face, t + pitch / 2, k * 0.5, t + pitch / 2, k, FLAT.inkSoft, line, seed + t + 1);
    }
  },

  notched: (ctx, face, seed) => {
    // Notches chopped into the OUTER edge (the top of a board, the outboard
    // side of an upright) — the edge a plane or an adze would actually reach.
    const k = face.thick;
    const dark = flatScheme().timberDark;
    const d = k * 0.3;
    const { pitch, starts } = cadence(face, k * 0.62);
    for (const t of starts) {
      const [ax, ay] = face.at(t + pitch * 0.15, 0);
      const [bx, by] = face.at(t + pitch * 0.5, d);
      const [cx, cy] = face.at(t + pitch * 0.85, 0);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fillStyle = dark;
      ctx.fill();
    }
    faceLine(ctx, face, 0, d * 1.15, face.len, d * 1.15, FLAT.inkSoft, Math.max(0.7, k * 0.035), seed);
  },
};

/**
 * Work `pattern` into a timber face.
 *
 * The caller must already have clipped to the face (the part drawers do, with
 * the same `wobbleRect` they filled it with), and must re-stroke the part's
 * outline afterwards so the clip cannot nibble it.
 */
export function paintFacePattern(
  ctx: FlatCtx,
  pattern: PatternId,
  face: Face,
  seed: number,
): void {
  if (face.thick <= 3 || face.len <= 3) return;
  ctx.save();
  ctx.lineCap = 'round';
  PAINTERS[pattern](ctx, face, seed);
  ctx.restore();
}

/* ----------------------------------------------------------------------------
   Build trim: the board
   -------------------------------------------------------------------------- */

/**
 * The carpentry a build adds to the shelf board, drawn inside the board's clip.
 *
 * A board is only ~40 world px tall, so none of this can change its
 * silhouette — a scalloped apron has to live on the face rather than hang
 * below it, because the floor underneath starts at the board's own bottom
 * edge. What actually hangs into the opening is the valance, and that belongs
 * to `paintOpening` where there is room for it.
 */
export function paintPlankTrim(ctx: FlatCtx, spec: BuildSpec, b: Box, seed: number): void {
  const room = flatScheme();
  const edge = b.h * spec.plankEdge;
  const faceH = b.h - edge;

  switch (spec.plankTrim) {
    case 'none':
      break;

    case 'lip': {
      // A face-frame board shows a second reveal above its front edge.
      stroke(ctx, b.x + b.w * 0.006, b.y + faceH * 0.62, b.x + b.w * 0.994, b.y + faceH * 0.62, FLAT.ink, Math.max(1, inkWidth(b.h) * 0.55), seed);
      break;
    }

    case 'bead': {
      // Beads in the LIGHT timber, sitting on the dark front edge: the same
      // "lighter face beside a darker one" move the board itself is made of.
      const r = Math.max(1.2, edge * 0.3);
      const step = r * 3.4;
      for (let x = b.x + step * 0.5; x < b.x + b.w; x += step) {
        ctx.beginPath();
        ctx.arc(x, b.y + faceH + edge * 0.5, r, 0, Math.PI * 2);
        ctx.fillStyle = room.timber;
        ctx.fill();
      }
      break;
    }

    case 'cleat': {
      // Battens across the board at the crate's joints.
      const cleats = Math.max(2, Math.round(b.w / (b.h * 6)));
      const cw = Math.max(3, b.h * 0.3);
      for (let i = 0; i <= cleats; i++) {
        const cx = b.x + (b.w - cw) * (i / cleats);
        panel(ctx, cx, b.y, cw, b.h, room.timberDark, {
          radius: cw * 0.3,
          seed: seed + i * 13,
          width: Math.max(1, inkWidth(b.h) * 0.7),
        });
      }
      break;
    }

    case 'rail': {
      // A ladder's board is simply laid on its rungs: one reveal, and a pair
      // of brackets showing where it rests.
      stroke(ctx, b.x, b.y + faceH * 0.55, b.x + b.w, b.y + faceH * 0.55, FLAT.inkSoft, Math.max(0.9, inkWidth(b.h) * 0.5), seed);
      const bw = b.h * 1.5;
      for (const sx of [b.x + b.h * 0.4, b.x + b.w - b.h * 0.4 - bw]) {
        panel(ctx, sx, b.y + faceH * 0.5, bw, b.h - faceH * 0.5, room.timberDark, {
          radius: b.h * 0.2,
          seed: seed + sx,
          width: Math.max(1, inkWidth(b.h) * 0.6),
        });
      }
      break;
    }

    case 'peg': {
      const r = Math.max(1.2, b.h * 0.085);
      const step = b.h * 2.6;
      for (let x = b.x + step * 0.5; x < b.x + b.w; x += step) {
        ctx.beginPath();
        ctx.arc(x, b.y + faceH * 0.52, r, 0, Math.PI * 2);
        ctx.fillStyle = FLAT.inkSoft;
        ctx.fill();
      }
      break;
    }

    case 'knob': {
      stroke(ctx, b.x + b.w * 0.01, b.y + faceH * 0.7, b.x + b.w * 0.99, b.y + faceH * 0.7, FLAT.ink, Math.max(1, inkWidth(b.h) * 0.5), seed);
      // One pull, centred, the way a barrister's lift-up front carries one.
      const r = Math.max(2, b.h * 0.16);
      const cx = b.x + b.w / 2;
      const cy = b.y + faceH + edge * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = FLAT.gilt;
      ctx.fill();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = Math.max(1, inkWidth(b.h) * 0.6);
      ctx.stroke();
      break;
    }

    case 'scallop': {
      // Sized to the FRONT EDGE band, not the board: a scallop deeper than
      // that is cut off by the board's own bottom and comes back as a row of
      // spikes. There is nowhere below to hang it — the next floor starts at
      // this board's bottom edge — so the fretwork that really hangs is the
      // valance, in the opening.
      const r = Math.max(2, edge * 0.9);
      const step = r * 2;
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = Math.max(1, inkWidth(b.h) * 0.55);
      ctx.lineJoin = 'round';
      for (let x = b.x + r; x < b.x + b.w + r; x += step) {
        ctx.beginPath();
        ctx.arc(x, b.y + faceH, r, 0, Math.PI, false);
        ctx.closePath();
        ctx.fillStyle = room.timber;
        ctx.fill();
        ctx.stroke();
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
 * upright's texture is deliberately over-drawn past both ends so its rounded
 * cap falls off-canvas, and a capital positioned against that would sit a
 * dozen pixels too high on every floor.
 */
export function paintPostTrim(
  ctx: FlatCtx,
  spec: BuildSpec,
  shaft: Box,
  tile: Box,
  seed: number,
): void {
  const room = flatScheme();

  switch (spec.postTrim) {
    case 'none':
      break;

    case 'stile': {
      // The inner edge of a face-frame stile carries a bead line.
      const x = shaft.x + shaft.w * 0.74;
      stroke(ctx, x, shaft.y, x, shaft.y + shaft.h, FLAT.inkSoft, Math.max(0.9, inkWidth(shaft.w) * 0.5), seed);
      break;
    }

    case 'column': {
      // A capital and a base, one storey apart, drawn at the FULL width the
      // caller allowed rather than the shaft's — which is what makes a
      // narrowed shaft read as a column instead of a thin post.
      const blockH = Math.max(4, shaft.w * 0.62);
      const over = shaft.w * 0.16;
      for (const ty of [tile.y + blockH * 0.15, tile.y + tile.h - blockH * 1.15]) {
        panel(ctx, shaft.x - over, ty, shaft.w + over * 2, blockH, room.timber, {
          radius: blockH * 0.22,
          seed: seed + ty,
          width: Math.max(1, inkWidth(shaft.w) * 0.8),
        });
      }
      break;
    }

    case 'ladder': {
      const rungH = Math.max(3, shaft.w * 0.5);
      const over = shaft.w * 0.5;
      for (const ty of [tile.y + tile.h * 0.08, tile.y + tile.h * 0.72]) {
        panel(ctx, shaft.x - over, ty, shaft.w + over * 2, rungH, room.timberDark, {
          radius: rungH * 0.4,
          seed: seed + ty,
          width: Math.max(1, inkWidth(shaft.w) * 0.7),
        });
      }
      break;
    }

    case 'batten': {
      const r = Math.max(1.1, shaft.w * 0.1);
      const step = Math.max(8, tile.h / 8);
      for (let y = tile.y + step * 0.5; y < tile.y + tile.h; y += step) {
        ctx.beginPath();
        ctx.arc(shaft.x + shaft.w * 0.36, y, r, 0, Math.PI * 2);
        ctx.fillStyle = FLAT.inkSoft;
        ctx.fill();
      }
      break;
    }

    case 'slab': {
      const r = Math.max(1.4, shaft.w * 0.13);
      for (const t of [0.22, 0.78]) {
        ctx.beginPath();
        ctx.arc(shaft.x + shaft.w * 0.38, tile.y + tile.h * t, r, 0, Math.PI * 2);
        ctx.fillStyle = FLAT.inkSoft;
        ctx.fill();
      }
      break;
    }
  }
}

/* ----------------------------------------------------------------------------
   Build: the opening
   -------------------------------------------------------------------------- */

/**
 * Trace a band across the top of an opening whose underside is a run of arches.
 *
 * One path rather than N shapes so the spandrels between neighbouring bays are
 * continuous timber — drawn separately they show a seam where they meet, and
 * the case reads as stickers rather than joinery.
 */
function traceArcadeBand(
  ctx: FlatCtx,
  f: Box,
  bays: number,
  r: number,
  rise: number,
  pointed: boolean,
): void {
  const bayW = f.w / bays;
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(f.x + f.w, f.y);
  ctx.lineTo(f.x + f.w, f.y + rise);
  // Walk the underside right → left so the enclosed region is the timber
  // ABOVE the arch line.
  for (let i = bays - 1; i >= 0; i--) {
    const bx = f.x + i * bayW;
    const cx = bx + bayW / 2;
    ctx.lineTo(cx + r, f.y + rise);
    if (pointed) {
      ctx.quadraticCurveTo(cx + r * 0.52, f.y + rise - r * 1.2, cx, f.y + rise - r * 1.7);
      ctx.quadraticCurveTo(cx - r * 0.52, f.y + rise - r * 1.2, cx - r, f.y + rise);
    } else {
      // Angle 0 → PI counter-clockwise passes -PI/2, which is UP in canvas
      // coordinates: the arc goes over the opening, not under it.
      ctx.arc(cx, f.y + rise, r, 0, Math.PI, true);
    }
    ctx.lineTo(bx, f.y + rise);
  }
  ctx.lineTo(f.x, f.y);
  ctx.closePath();
}

/** Fill + outline an opening member. Everything here is timber over recess. */
function member(ctx: FlatCtx, b: Box, seed: number, fill?: string): void {
  panel(ctx, b.x, b.y, b.w, b.h, fill ?? flatScheme().timber, {
    radius: Math.min(b.w, b.h) * 0.28,
    seed,
    width: Math.max(1, inkWidth(Math.min(b.w, b.h)) * 0.85),
  });
}

/**
 * The carpentry inside one opening, drawn over the recess and behind the books.
 *
 * `frame` is the VISIBLE opening — between the uprights, not the whole texture
 * — because the recess is baked deliberately oversize so its own outline falls
 * off-canvas, and an arch springing from that would spring from nowhere.
 *
 * Everything here lives behind the books by construction (the recess sprite is
 * under them), so the ornament that pays off is whatever sits high in the
 * opening: arch heads, valances, the top rail of a compartment run. Members
 * that run to the floor are still drawn — they show through the gaps between
 * spines, which is exactly where a real one would.
 */
export function paintOpening(ctx: FlatCtx, spec: BuildSpec, frame: Box, seed: number): void {
  const f = frame;
  if (f.w <= 8 || f.h <= 8) return;
  const room = flatScheme();

  switch (spec.opening) {
    case 'plain':
      break;

    case 'frame': {
      const t = Math.max(3, Math.min(f.h * 0.075, f.w * 0.03));
      member(ctx, { x: f.x, y: f.y, w: f.w, h: t }, seed + 1);
      member(ctx, { x: f.x, y: f.y, w: t, h: f.h }, seed + 2);
      member(ctx, { x: f.x + f.w - t, y: f.y, w: t, h: f.h }, seed + 3);
      break;
    }

    case 'arch': {
      const bays = Math.max(1, Math.round(f.w / (f.h * 1.05)));
      const r = Math.min((f.w / bays) * 0.42, f.h * 0.32);
      const rise = r + f.h * 0.06;
      traceArcadeBand(ctx, f, bays, r, rise, false);
      ctx.fillStyle = room.timber;
      ctx.fill();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = inkWidth(rise);
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }

    case 'gothic': {
      const bays = Math.max(2, Math.round(f.w / (f.h * 0.72)));
      const r = Math.min((f.w / bays) * 0.44, f.h * 0.26);
      const rise = r * 1.75 + f.h * 0.05;
      traceArcadeBand(ctx, f, bays, r, rise, true);
      ctx.fillStyle = room.timber;
      ctx.fill();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = inkWidth(rise);
      ctx.lineJoin = 'round';
      ctx.stroke();
      // A boss where each pair of arcs meets.
      const bayW = f.w / bays;
      for (let i = 0; i < bays; i++) {
        ctx.beginPath();
        ctx.arc(f.x + bayW * (i + 0.5), f.y + rise - r * 1.7, Math.max(1.5, r * 0.09), 0, Math.PI * 2);
        ctx.fillStyle = FLAT.gilt;
        ctx.fill();
      }
      break;
    }

    case 'valance': {
      const cells = Math.max(4, Math.round(f.w / (f.h * 0.22)));
      const r = (f.w / cells) * 0.46;
      const rise = r + f.h * 0.05;
      traceArcadeBand(ctx, f, cells, r, rise, false);
      ctx.fillStyle = room.timber;
      ctx.fill();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = inkWidth(rise) * 0.9;
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }

    case 'divided': {
      const cells = Math.max(3, Math.round(f.w / (f.h * 0.62)));
      const dw = Math.max(4, f.h * 0.032);
      for (let i = 1; i < cells; i++) {
        member(ctx, { x: f.x + (f.w * i) / cells - dw / 2, y: f.y, w: dw, h: f.h }, seed + i * 7);
      }
      const rh = Math.max(4, f.h * 0.045);
      member(ctx, { x: f.x, y: f.y + f.h * 0.26, w: f.w, h: rh }, seed + 71);
      break;
    }

    case 'grid': {
      const cells = Math.max(5, Math.round(f.w / (f.h * 0.34)));
      const dw = Math.max(3, f.h * 0.022);
      for (let i = 1; i < cells; i++) {
        member(ctx, { x: f.x + (f.w * i) / cells - dw / 2, y: f.y, w: dw, h: f.h }, seed + i * 5);
      }
      const rh = Math.max(3, f.h * 0.03);
      for (const t of [0.2, 0.44]) {
        member(ctx, { x: f.x, y: f.y + f.h * t, w: f.w, h: rh }, seed + t * 100);
      }
      break;
    }

    case 'crate': {
      const t = Math.max(4, f.h * 0.085);
      member(ctx, { x: f.x, y: f.y, w: f.w, h: t }, seed + 1);
      member(ctx, { x: f.x, y: f.y + f.h - t, w: f.w, h: t }, seed + 2);
      member(ctx, { x: f.x, y: f.y, w: t, h: f.h }, seed + 3);
      member(ctx, { x: f.x + f.w - t, y: f.y, w: t, h: f.h }, seed + 4);
      const c = t * 1.7;
      for (const [cx, cy] of [
        [f.x, f.y],
        [f.x + f.w - c, f.y],
        [f.x, f.y + f.h - c],
        [f.x + f.w - c, f.y + f.h - c],
      ] as const) {
        member(ctx, { x: cx, y: cy, w: c, h: c }, seed + cx + cy, room.timberDark);
      }
      break;
    }

    case 'glass': {
      const t = Math.max(3, f.h * 0.05);
      member(ctx, { x: f.x, y: f.y, w: f.w, h: t }, seed + 1);
      member(ctx, { x: f.x, y: f.y, w: t, h: f.h }, seed + 2);
      member(ctx, { x: f.x + f.w - t, y: f.y, w: t, h: f.h }, seed + 3);
      // The sash: a top rail with two muntins under it. Books stand in front
      // of the glazing, which is the one compromise in this build — there is
      // no layer between the reader and the shelf to hang a door on.
      const rh = Math.max(3, f.h * 0.042);
      member(ctx, { x: f.x, y: f.y + f.h * 0.16, w: f.w, h: rh }, seed + 4);
      const mw = Math.max(3, f.h * 0.026);
      for (const t2 of [1 / 3, 2 / 3]) {
        member(ctx, { x: f.x + f.w * t2 - mw / 2, y: f.y, w: mw, h: f.h }, seed + t2 * 200);
      }
      break;
    }
  }
}

/* ----------------------------------------------------------------------------
   Build: the cornice
   -------------------------------------------------------------------------- */

/**
 * What `drawCrownBody` hands back so the caller can pattern and re-stroke it.
 *
 * `clip` carries the EXACT arguments the visible board was `panel`led with,
 * not an approximation of it. A clip traced with a different radius or seed
 * would let a pattern spill past a bowed edge, and re-stroking it afterwards
 * would leave a second outline floating inside the cornice.
 */
export interface CrownBody {
  /** The area a pattern is worked into (may be a band of the board). */
  face: Box;
  /** The drawn board, and the wobble it was drawn with. */
  clip: Box;
  radius: number;
  seed: number;
}

/**
 * Draw the cornice's body and hand back the face worth patterning.
 *
 * The cornice is the ONE part with transparency above it, so it is the one
 * part whose silhouette a build can genuinely change: battlements, a
 * scalloped cresting, a pediment. Everything else has a neighbour flush
 * against it and has to make its case within a rectangle.
 */
export function drawCrownBody(ctx: FlatCtx, spec: BuildSpec, b: Box, seed: number): CrownBody {
  const room = flatScheme();

  switch (spec.crown) {
    case 'board': {
      panel(ctx, b.x, b.y, b.w, b.h, room.timber, { radius: b.h * 0.28, seed });
      return {
        face: { x: b.x, y: b.y, w: b.w, h: b.h * 0.72 },
        clip: b,
        radius: b.h * 0.28,
        seed,
      };
    }

    case 'dentil': {
      panel(ctx, b.x, b.y, b.w, b.h, room.timber, { radius: b.h * 0.2, seed });
      return {
        face: { x: b.x, y: b.y, w: b.w, h: b.h * 0.5 },
        clip: b,
        radius: b.h * 0.2,
        seed,
      };
    }

    case 'slab': {
      panel(ctx, b.x, b.y, b.w, b.h, room.timber, { radius: b.h * 0.42, seed });
      return {
        face: { x: b.x, y: b.y, w: b.w, h: b.h * 0.72 },
        clip: b,
        radius: b.h * 0.42,
        seed,
      };
    }

    case 'stepped': {
      // A cornice steps OUT as it rises, so the wide board is the top one.
      //
      // The step is a fraction of the WIDTH, not of the height: the cornice
      // overhangs the case by a fixed lip, and a frieze inset by half its own
      // height ends up narrower than the bookcase under it — which opens a
      // stripe of bare wall above each upright.
      const step = Math.min(b.h * 0.5, b.w * 0.012);
      const lower = { x: b.x + step, y: b.y + b.h * 0.36, w: b.w - step * 2, h: b.h * 0.64 };
      panel(ctx, lower.x, lower.y, lower.w, lower.h, room.timberDark, {
        radius: lower.h * 0.2,
        seed: seed + 1,
      });
      const upper = { x: b.x, y: b.y, w: b.w, h: b.h * 0.46 };
      panel(ctx, upper.x, upper.y, upper.w, upper.h, room.timber, {
        radius: upper.h * 0.3,
        seed: seed + 2,
      });
      return { face: upper, clip: upper, radius: upper.h * 0.3, seed: seed + 2 };
    }

    case 'gothic': {
      const bandY = b.y + b.h * 0.44;
      const bandH = b.h - b.h * 0.44;
      const merlonH = b.h * 0.46;
      const cells = Math.max(6, Math.round(b.w / (b.h * 1.35)));
      const cellW = b.w / cells;
      for (let i = 0; i < cells; i++) {
        const mw = cellW * 0.56;
        panel(ctx, b.x + cellW * i + (cellW - mw) / 2, b.y + b.h * 0.02, mw, merlonH, room.timber, {
          radius: mw * 0.14,
          seed: seed + i * 11,
          width: Math.max(1, inkWidth(merlonH) * 0.8),
        });
      }
      const band = { x: b.x, y: bandY, w: b.w, h: bandH };
      panel(ctx, band.x, band.y, band.w, band.h, room.timber, {
        radius: bandH * 0.2,
        seed: seed + 3,
      });
      return { face: band, clip: band, radius: bandH * 0.2, seed: seed + 3 };
    }

    case 'scallop': {
      const board = { x: b.x, y: b.y + b.h * 0.34, w: b.w, h: b.h * 0.66 };
      const r = b.h * 0.32;
      // Bumps first, clipped to the space above the board, so their undersides
      // are cut cleanly by the board's own top edge rather than by an ellipse.
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x - r, b.y - r, b.w + r * 2, board.y - b.y + r * 1.2);
      ctx.clip();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = Math.max(1, inkWidth(b.h) * 0.8);
      for (let x = b.x + r; x < b.x + b.w + r; x += r * 2) {
        ctx.beginPath();
        ctx.arc(x, board.y + r * 0.1, r, 0, Math.PI, true);
        ctx.closePath();
        ctx.fillStyle = room.timber;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
      panel(ctx, board.x, board.y, board.w, board.h, room.timber, {
        radius: board.h * 0.26,
        seed: seed + 5,
      });
      return { face: board, clip: board, radius: board.h * 0.26, seed: seed + 5 };
    }

    case 'pediment': {
      const board = { x: b.x, y: b.y + b.h * 0.38, w: b.w, h: b.h * 0.62 };
      // A pediment on a 64px entablature has to be NARROW to have any pitch at
      // all — spread across the whole cornice it flattens into a hump that
      // reads as a mistake rather than as a gable. Straight lines, not a
      // quadratic, for the same reason: at this rise a curve is just a bulge.
      const pw = Math.min(b.w * 0.3, b.h * 7);
      const cx = b.x + b.w / 2;
      const baseY = board.y + b.h * 0.04;
      ctx.beginPath();
      ctx.moveTo(cx - pw / 2, baseY);
      ctx.lineTo(cx, b.y + b.h * 0.04);
      ctx.lineTo(cx + pw / 2, baseY);
      ctx.closePath();
      ctx.fillStyle = room.timber;
      ctx.fill();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = inkWidth(b.h);
      ctx.lineJoin = 'round';
      ctx.stroke();
      // Acroteria: the blocks at the ends are what makes the entablature read
      // as one at card size, where the gable is four pixels tall.
      const aw = b.h * 0.9;
      for (const ax of [b.x + b.h * 0.2, b.x + b.w - b.h * 0.2 - aw]) {
        panel(ctx, ax, b.y + b.h * 0.12, aw, b.h * 0.42, room.timber, {
          radius: b.h * 0.1,
          seed: seed + ax,
          width: Math.max(1, inkWidth(b.h) * 0.8),
        });
      }
      panel(ctx, board.x, board.y, board.w, board.h, room.timber, {
        radius: board.h * 0.22,
        seed: seed + 7,
      });
      return { face: board, clip: board, radius: board.h * 0.22, seed: seed + 7 };
    }

    case 'rail': {
      const bar = { x: b.x + b.h * 0.3, y: b.y + b.h * 0.5, w: b.w - b.h * 0.6, h: b.h * 0.42 };
      panel(ctx, bar.x, bar.y, bar.w, bar.h, room.timber, { radius: bar.h * 0.42, seed });
      for (const ex of [b.x + b.h * 0.1, b.x + b.w - b.h * 0.75]) {
        panel(ctx, ex, b.y + b.h * 0.3, b.h * 0.65, b.h * 0.68, room.timberDark, {
          radius: b.h * 0.2,
          seed: seed + ex,
          width: Math.max(1, inkWidth(b.h) * 0.7),
        });
      }
      return { face: bar, clip: bar, radius: bar.h * 0.42, seed };
    }
  }
}

/**
 * The ornament that goes ON the cornice, after its face has been patterned.
 *
 * The gilt studs are the app icon's own move and the reason a bare board did
 * not read as furniture; builds that carry their own crest (battlements, a
 * pediment boss) turn them off rather than stack two ornaments.
 */
export function paintCrownTrim(ctx: FlatCtx, spec: BuildSpec, b: Box, face: Box, seed: number): void {
  const room = flatScheme();

  if (spec.crown === 'board') {
    stroke(ctx, b.x + b.w * 0.04, b.y + b.h * 0.72, b.x + b.w * 0.96, b.y + b.h * 0.72, FLAT.ink, inkWidth(b.h) * 0.7, seed + 3);
  }

  if (spec.crown === 'dentil') {
    const cells = Math.max(8, Math.round(b.w / (b.h * 0.7)));
    const cw = b.w / cells;
    for (let i = 0; i < cells; i++) {
      ctx.fillStyle = room.timberDark;
      ctx.fillRect(b.x + cw * i + cw * 0.2, b.y + b.h * 0.56, cw * 0.6, b.h * 0.3);
    }
    stroke(ctx, b.x + b.w * 0.02, b.y + b.h * 0.52, b.x + b.w * 0.98, b.y + b.h * 0.52, FLAT.ink, inkWidth(b.h) * 0.6, seed + 4);
  }

  if (spec.crown === 'slab') {
    const r = Math.max(1.6, b.h * 0.09);
    for (const t of [0.14, 0.5, 0.86]) {
      ctx.beginPath();
      ctx.arc(b.x + b.w * t, b.y + b.h * 0.5, r, 0, Math.PI * 2);
      ctx.fillStyle = FLAT.inkSoft;
      ctx.fill();
    }
  }

  if (spec.crown === 'pediment') {
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h * 0.3, Math.max(2, b.h * 0.09), 0, Math.PI * 2);
    ctx.fillStyle = FLAT.gilt;
    ctx.fill();
    ctx.strokeStyle = FLAT.ink;
    ctx.lineWidth = Math.max(1, inkWidth(b.h) * 0.5);
    ctx.stroke();
  }

  if (spec.crownStuds) {
    const studs = Math.max(3, Math.round(b.w / 150));
    for (let i = 0; i < studs; i++) {
      ctx.beginPath();
      ctx.arc(b.x + b.w * ((i + 0.5) / studs), face.y + face.h * 0.5, Math.max(1.4, b.h * 0.09), 0, Math.PI * 2);
      ctx.fillStyle = FLAT.gilt;
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
 * Every part drawer needs this and none of them should own it: the clip has to
 * be the SAME `wobbleRect` the face was filled with, or a pattern spills past
 * a bowed edge and the case grows a fringe.
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
