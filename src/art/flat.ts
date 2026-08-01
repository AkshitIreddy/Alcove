/**
 * art/flat.ts — the app's one drawing vocabulary.
 *
 * Everything visible in the shelf world is built from the primitives here, in
 * the style of the app icon (`assets/brand/icon.svg`): flat colour, a thick
 * dark outline, corners that are always rounded, and edges that wobble just
 * enough to read as drawn by hand rather than by a rectangle function.
 *
 * ## Why this replaces the painting engine
 *
 * The previous approach tried to earn beauty from simulation — a brush engine
 * stamping thousands of dabs, procedural wood and foliage, a deferred
 * lighting pass, generated photoreal materials. It cost seconds of startup and
 * still read as cheap, because a half-simulated surface sits in the uncanny
 * gap between "drawing" and "photograph" and gets no credit from either.
 *
 * A flat illustration makes no such promise, so it never breaks it. The icon
 * already proved the style works at any size, and it costs a few dozen path
 * fills per floor instead of a million pixel writes.
 *
 * ## The rules, taken from the icon
 *
 * - **One outline colour.** Every shape is bounded by INK. Not a darker shade
 *   of itself — the same brown, everywhere. That single choice is most of why
 *   the icon reads as one drawing rather than a pile of clip art.
 * - **Outline weight scales with the shape**, roughly 1.5% of its short side,
 *   so a book spine and a whole bookcase feel drawn by the same pen.
 * - **No light MODEL.** Depth comes from a darker flat face (the icon's spine
 *   beside its cover) and one soft contact shadow — never from a key light, a
 *   specular highlight, or a shading pass.
 *
 *   This is not the same as "no gradients", which is what this comment used to
 *   say and what a sweep of `src/styles/` then went and enforced. The icon
 *   itself carries three `linearGradient`s — its cover, spine and page block
 *   are each a gentle two- or three-stop ramp. A soft wash reading as pigment
 *   or as tinted paper is inside the style; a highlight placed at 30% 12% to
 *   imply a lamp is not. The test in `tests/styles.test.ts` gates the things
 *   that are unambiguously a light model — blur, blend modes, soft shadows —
 *   and deliberately does not gate gradients.
 * - **Nothing is axis-true.** Every long edge bows by a hair.
 */

/* ----------------------------------------------------------------------------
   Palette
   -------------------------------------------------------------------------- */

/**
 * The whole app's colour vocabulary, lifted from the icon.
 *
 * Deliberately tiny. A short palette used consistently is what makes a set of
 * flat shapes look designed; the previous themes offered dozens of colourways
 * and every room ended up a slightly different mud.
 *
 * The one thing that outgrew it is the book cloth — see `CLOTH_SPECS` below.
 * That is not a second palette so much as the same one spread out: a room is
 * still built from the dozen hexes here, and the fifty cloths only ever appear
 * a spine at a time, on the one object in the app that is supposed to be
 * telling you apart from its neighbour.
 */
export const FLAT = {
  /** The one outline colour. Everything is drawn with this. */
  ink: '#4f3120',
  /** Softer ink for marks *inside* a shape (label ruling, small detail). */
  inkSoft: '#6b4a32',

  /** Book cloth / case body. */
  terracotta: '#c96f4a',
  terracottaDark: '#a8552f',
  /** Paper, labels, page block. */
  cream: '#f7f1e3',
  creamDeep: '#eee2c8',
  /** Gilt bands and small ornament. */
  gilt: '#e8b64c',
  giltPale: '#f0d9a8',
  /** The ribbon green. */
  moss: '#7d915c',
  mossDark: '#4f6138',

  /** Additional book cloths, same saturation and value as the terracotta. */
  slate: '#5f7d8c',
  slateDark: '#456170',
  plum: '#8a5a72',
  plumDark: '#6d4359',
  ochre: '#c9973f',
  ochreDark: '#a4762a',
  sage: '#8a9a6b',
  sageDark: '#6b7a4e',

  /** Case timber. */
  timber: '#c08a52',
  timberDark: '#9d6b3c',
  /** Inside the case, behind the books — always darker than the timber. */
  recess: '#7d5638',

  /** The wall. One flat colour; it is a backdrop, not a subject. */
  wall: '#e9e2d0',

  /** Contact shadow. Used at low alpha, never as a light model. */
  shadow: '#5d3a26',
} as const;

/* ----------------------------------------------------------------------------
   The book cloths
   -------------------------------------------------------------------------- */

/**
 * Mood words for a cloth, so "surprise me, something cosy" can be answered.
 *
 * Deliberately the same vocabulary `themes.ts` gives a room (`ThemeTag`) rather
 * than a private one: the studio's "in the mood for" row counts tags across
 * every design vocabulary at once, and two words meaning the same thing would
 * show up as two chips that each find half the answers.
 */
export type ClothTag =
  | 'warm'
  | 'cool'
  | 'muted'
  | 'vivid'
  | 'natural'
  | 'formal'
  | 'playful'
  | 'dark'
  | 'pale'
  | 'cosy'
  | 'quiet'
  | 'coastal'
  | 'botanical'
  | 'autumn'
  | 'winter'
  | 'spring'
  | 'summer';

/** Every cloth mood, in the order a picker should offer them. */
export const CLOTH_TAGS: readonly ClothTag[] = [
  'warm',
  'cool',
  'natural',
  'muted',
  'vivid',
  'pale',
  'dark',
  'quiet',
  'playful',
  'formal',
  'cosy',
  'botanical',
  'coastal',
  'spring',
  'summer',
  'autumn',
  'winter',
];

export function isClothTag(value: unknown): value is ClothTag {
  return typeof value === 'string' && (CLOTH_TAGS as readonly string[]).includes(value);
}

/** One bound cloth: what it is called, what it is, and what it feels like. */
export interface ClothSpec {
  /** Display name, for the studio's swatch caption. */
  label: string;
  /** The lit face. */
  face: string;
  /** The same cloth turning away — see the note on the fold below. */
  dark: string;
  /** Mood words. Never drawn; they only steer the dice. */
  tags: readonly ClothTag[];
}

function cloth(
  label: string,
  face: string,
  dark: string,
  tags: readonly ClothTag[],
): ClothSpec {
  return { label, face, dark, tags };
}

/**
 * Fifty book cloths — the HOUSE palette, and the whole colour vocabulary a
 * book has.
 *
 * ## Why fifty and not six
 *
 * Six was the icon's own count and it worked as long as a book's colour was
 * something the app chose. It stopped working the moment the reader could:
 * `spines.clothForPalette` folds twenty named pigments onto these cloths, so at
 * six, "oxblood", "rust" and "clay" were three chips in the Book Studio that
 * all painted the same terracotta. Every colour control in the app was sitting
 * on this array, and every one of them was lying about what it could do.
 *
 * ## How the pairs were made
 *
 * `dark` is not a second opinion about the colour — it is the SAME cloth
 * turning away from us, and the flat style has nothing but that step to say so.
 * Mixed by eye, fifty of them would drift in hue and saturation as well as
 * lightness and the fold would stop reading as a fold. So every pair below
 * except the first six is `palette.clothPair(face)`: one measured OKLCh step
 * of lightness (−0.10 L), a little chroma lost into the dark (×0.95), a couple
 * of degrees of hue turned warmer, and a floor that keeps the darker face above
 * the one brown ink. The hexes are baked in rather than computed here because
 * `palette.ts` imports THIS file — deriving them at runtime would be a cycle.
 *
 * The first six are the app icon's own cloths at the icon's own hand-authored
 * values, unchanged and first on purpose: they are what `FlatScheme` hands a
 * room, and other code and tests know them by index.
 *
 * ## What was vetted
 *
 * Every face clears the ink floor with room for its own turned edge, every pair
 * keeps at least 16 points of sRGB brightness between face and edge (the
 * narrowest step that still reads on a 25px spine), and the fifty were checked
 * against each other in OKLab: the closest two are the icon's own sage and moss,
 * and nothing added here comes nearer to a neighbour than that. They were also
 * checked against the things a book is always seen NEXT to — the cream page
 * block and label plate, the timber, the dark of the recess — so no cloth
 * disappears into the furniture it is standing in.
 *
 * A book keeps these colours in every room. That is the point: you find a book
 * by recognising its spine, and a shelf that repaints itself when the reader
 * redecorates is a shelf they have to learn twice.
 */
export const CLOTH_SPECS: readonly ClothSpec[] = [
  /* --- the icon's six, hex for hex (indices other code knows by heart) --- */
  cloth('Terracotta', FLAT.terracotta, FLAT.terracottaDark, ['warm', 'natural', 'cosy']),
  cloth('Slate', FLAT.slate, FLAT.slateDark, ['cool', 'muted', 'quiet']),
  cloth('Plum', FLAT.plum, FLAT.plumDark, ['muted', 'dark', 'formal']),
  cloth('Ochre', FLAT.ochre, FLAT.ochreDark, ['warm', 'natural', 'autumn']),
  cloth('Sage', FLAT.sage, FLAT.sageDark, ['natural', 'muted', 'botanical']),
  cloth('Moss', FLAT.moss, FLAT.mossDark, ['natural', 'botanical', 'quiet']),

  /* --- reds and oranges --- */
  cloth('Vermilion', '#d2543c', '#ac3727', ['warm', 'vivid', 'playful']),
  cloth('Oxblood', '#ae4e40', '#983f36', ['warm', 'dark', 'formal']),
  cloth('Rust', '#bc6427', '#99470b', ['warm', 'natural', 'autumn']),
  cloth('Tangerine', '#e08a3f', '#bd6c26', ['warm', 'vivid', 'playful']),
  cloth('Coral', '#e08063', '#bc634c', ['warm', 'playful', 'summer']),
  cloth('Blush', '#dfa393', '#bc8578', ['warm', 'pale', 'quiet']),
  cloth('Apricot', '#f2b694', '#cf9779', ['warm', 'pale', 'summer']),

  /* --- yellows --- */
  cloth('Saffron', '#e0a63a', '#bf861c', ['warm', 'vivid', 'autumn']),
  cloth('Butter', '#e8c25e', '#c8a144', ['warm', 'pale', 'playful']),
  cloth('Lemon', '#d6cd52', '#b8ac34', ['vivid', 'playful', 'spring']),

  /* --- greens --- */
  cloth('Pistachio', '#a8c96f', '#8da852', ['pale', 'botanical', 'spring']),
  cloth('Leaf', '#7fae5f', '#668e42', ['natural', 'botanical', 'spring']),
  cloth('Olive', '#8f8438', '#73661c', ['muted', 'natural', 'autumn']),
  cloth('Bottle green', '#5f8a63', '#466c47', ['natural', 'formal', 'botanical']),
  cloth('Forest', '#4e7a55', '#416844', ['dark', 'natural', 'botanical']),
  cloth('Emerald', '#3f9a68', '#267a4b', ['vivid', 'natural', 'formal']),

  /* --- blue-greens --- */
  cloth('Jade', '#6fb598', '#559579', ['cool', 'natural', 'quiet']),
  cloth('Seafoam', '#a3d0c1', '#87afa1', ['pale', 'cool', 'coastal']),
  cloth('Verdigris', '#46907f', '#2c7161', ['cool', 'muted', 'natural']),
  cloth('Turquoise', '#4fb0b4', '#329092', ['cool', 'vivid', 'coastal']),
  cloth('Teal', '#3f8f9c', '#21717b', ['cool', 'formal', 'coastal']),
  cloth('Peacock', '#347a99', '#246a85', ['cool', 'dark', 'vivid']),

  /* --- blues --- */
  cloth('Sky', '#7aa8c9', '#5d89a7', ['cool', 'pale', 'coastal']),
  cloth('Mist', '#b0cadf', '#91aabd', ['pale', 'quiet', 'winter']),
  cloth('Cornflower', '#7d95d0', '#5f78ad', ['cool', 'playful', 'summer']),
  cloth('Denim', '#6b8aab', '#4f6d8a', ['cool', 'muted', 'quiet']),
  cloth('Cobalt', '#4a72c4', '#335ca6', ['cool', 'vivid', 'formal']),
  cloth('Ink blue', '#566a94', '#455a80', ['cool', 'dark', 'formal']),
  cloth('Indigo', '#6f6fae', '#52538c', ['cool', 'dark', 'quiet']),

  /* --- purples and pinks --- */
  cloth('Violet', '#9a7fc4', '#7a63a3', ['cool', 'playful', 'spring']),
  cloth('Lavender', '#c3b3dc', '#a295bb', ['pale', 'cool', 'quiet']),
  cloth('Aubergine', '#7a5a92', '#664a7e', ['dark', 'formal', 'muted']),
  cloth('Mulberry', '#9c5a86', '#7c426c', ['muted', 'dark', 'cosy']),
  cloth('Magenta', '#c05f95', '#9b4479', ['vivid', 'playful', 'summer']),
  cloth('Blossom', '#eaadbe', '#c68fa0', ['pale', 'playful', 'spring']),
  cloth('Rose', '#d9799b', '#b45d80', ['warm', 'playful', 'summer']),
  cloth('Claret', '#a44c60', '#8e3e53', ['dark', 'formal', 'cosy']),

  /* --- browns --- */
  cloth('Chestnut', '#975841', '#834935', ['warm', 'dark', 'cosy']),
  cloth('Camel', '#c69771', '#a57957', ['warm', 'muted', 'natural']),
  cloth('Sand', '#dcb87a', '#bc9860', ['warm', 'pale', 'coastal']),

  /* --- neutrals --- */
  cloth('Bone', '#dcc9a0', '#bca984', ['pale', 'quiet', 'natural']),
  cloth('Ash', '#c6bfb4', '#a6a096', ['muted', 'pale', 'quiet']),
  cloth('Pewter', '#a3a8a8', '#858989', ['cool', 'muted', 'winter']),
  cloth('Graphite', '#6b6a70', '#58585d', ['dark', 'formal', 'winter']),
];

/**
 * Every book-cloth colour, as [face, darker edge] pairs.
 *
 * Derived from `CLOTH_SPECS` rather than written twice: the label, the mood and
 * the two hexes are one decision, and two parallel arrays of fifty rows would
 * be one rename away from a book whose swatch says Cobalt and whose spine is
 * indigo.
 */
export const CLOTHS: readonly (readonly [string, string])[] = CLOTH_SPECS.map(
  (c) => [c.face, c.dark] as const,
);

/** Display names for the fifty cloths, index-aligned with `CLOTHS`. */
export const CLOTH_LABELS: readonly string[] = CLOTH_SPECS.map((c) => c.label);

/** Every cloth carrying `tag`, as indices into `CLOTHS`. For steered dice. */
export function clothsTagged(tag: ClothTag): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < CLOTH_SPECS.length; i++) {
    if ((CLOTH_SPECS[i] as ClothSpec).tags.includes(tag)) out.push(i);
  }
  return out;
}

/**
 * The six a ROOM is dressed in — the icon's own, and the default `FlatScheme`.
 *
 * Not the same concept as `CLOTHS`, which is why it is a separate export rather
 * than "the array, obviously". `CLOTHS` is the house palette a BOOK owns and
 * carries from room to room; a scheme's `cloths` are what a ROOM offers a book
 * that has not been dressed yet, and there are always exactly six of them (see
 * `FlatScheme.cloths` for why the count is fixed).
 */
export const HOUSE_CLOTHS: readonly (readonly [string, string])[] = CLOTHS.slice(0, 6);

/* ----------------------------------------------------------------------------
   The one thing a room may change
   -------------------------------------------------------------------------- */

/**
 * The subset of the palette a library theme is allowed to repaint.
 *
 * Structurally identical to `ColourScheme` in `art/themes.ts`, and deliberately
 * NOT imported from it: themes.ts is the data root and imports nothing, so the
 * two agree by shape rather than by dependency. Everything absent here — the
 * ink, the cream, the gilt, the contact shadow — is fixed in every room on
 * purpose. One outline colour on everything is most of why the app reads as a
 * single drawing; letting a room pick its own would turn four palettes into
 * four unrelated illustrations.
 */
export interface FlatScheme {
  timber: string;
  timberDark: string;
  recess: string;
  wall: string;
  /**
   * Exactly six, always — `HOUSE_CLOTHS` for the default room.
   *
   * A book picks its cloth by `seed % length`, so a scheme with a different
   * count would re-roll every book on the shelf instead of merely recolouring
   * it. This is emphatically NOT the fifty in `CLOTHS`: those are the house
   * palette a book owns and keeps in every room, and a scheme is the six a room
   * offers a book it is dressing for the first time.
   */
  cloths: readonly (readonly [string, string])[];
}

/** The house palette — Old Athenaeum, and what every drawing falls back to. */
const DEFAULT_SCHEME: FlatScheme = {
  timber: FLAT.timber,
  timberDark: FLAT.timberDark,
  recess: FLAT.recess,
  wall: FLAT.wall,
  cloths: HOUSE_CLOTHS,
};

let currentScheme: FlatScheme = DEFAULT_SCHEME;
let currentTag = 'house';

/**
 * The scheme every drawing function reads.
 *
 * Module state rather than a parameter threaded through forty call sites: the
 * shapes are the same in every room, so a scheme argument would have to be
 * carried by `drawPlank`, `drawSpine`, `drawCaseCard`, `renderSpine` and every
 * private helper under them purely to be forwarded. The cost of that choice is
 * that a swap must be SYNCHRONOUS around its draw — set, draw, restore, with no
 * `await` in between, or a second bake on the same tick comes out in the wrong
 * palette. Both callers (`textures.ts`, `LibraryStudio.tsx`) do exactly that.
 */
export function flatScheme(): FlatScheme {
  return currentScheme;
}

/** Swap the palette. `null` restores the house one. */
export function setFlatScheme(scheme: FlatScheme | null): void {
  currentScheme = scheme ?? DEFAULT_SCHEME;
  currentTag = scheme === null ? 'house' : tagOf(scheme);
}

/**
 * A short stable tag for the live scheme, for memo keys.
 *
 * Every cache that stores drawn pixels has to carry this or it will serve one
 * room's art in another — the cover data-url memo did exactly that, handing
 * back a terracotta board after the reader had moved to the reef. Derived from
 * the hexes rather than from any theme id, so editing a colour invalidates the
 * memo too.
 */
export function flatSchemeTag(): string {
  return currentTag;
}

function tagOf(scheme: FlatScheme): string {
  const source = [
    scheme.timber,
    scheme.timberDark,
    scheme.recess,
    scheme.wall,
    ...scheme.cloths.flat(),
  ].join('');
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ----------------------------------------------------------------------------
   Geometry
   -------------------------------------------------------------------------- */

/** The 2D context shape we draw into (canvas or offscreen). */
export type FlatCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Outline weight for a shape of the given short side.
 *
 * The icon strokes a 760px cover at 16px — about 2% — and the confidence of
 * that line is most of the style. A purely proportional rule fails on the
 * shelf, though: a book spine is ~25px wide, 2% of which is half a pixel, and
 * the first specimen came back looking like a watercolour of the icon rather
 * than the icon. So the FLOOR is what matters at shelf scale, and it is set
 * where a small object still reads as outlined.
 */
export function inkWidth(shortSide: number): number {
  return Math.max(2, Math.min(10, shortSide * 0.02));
}

/**
 * A deterministic wobble in [-1, 1] from an integer.
 *
 * Hand-drawn means *not straight*, but it must also mean *the same every
 * frame* — a shelf whose edges shimmered as you panned would be far worse
 * than one drawn with a ruler.
 */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Trace a rounded rectangle whose edges bow slightly outward.
 *
 * `bow` is the deflection at the middle of each side in pixels; the icon uses
 * roughly 0.5% of the side's length, which is invisible as a curve and
 * unmistakable as a feeling.
 */
export function wobbleRect(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  seed = 1,
  bow = Math.min(w, h) * 0.012,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const b = (n: number): number => jitter(seed + n) * bow;

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  // top
  ctx.quadraticCurveTo(x + w / 2, y + b(1), x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  // right
  ctx.quadraticCurveTo(x + w + b(2), y + h / 2, x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  // bottom
  ctx.quadraticCurveTo(x + w / 2, y + h + b(3), x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  // left
  ctx.quadraticCurveTo(x + b(4), y + h / 2, x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ----------------------------------------------------------------------------
   The three marks everything is made of
   -------------------------------------------------------------------------- */

/** Flat-filled, ink-outlined rounded rectangle. The workhorse. */
export function panel(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  opts: { radius?: number; seed?: number; ink?: string; width?: number } = {},
): void {
  const radius = opts.radius ?? Math.min(w, h) * 0.16;
  wobbleRect(ctx, x, y, w, h, radius, opts.seed ?? 1);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = opts.ink ?? FLAT.ink;
  ctx.lineWidth = opts.width ?? inkWidth(Math.min(w, h));
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * A hand-drawn line: rounded caps, a single bow, no dead-straight run.
 * Used for gilt bands, label ruling and plank edges.
 */
export function stroke(
  ctx: FlatCtx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: string,
  width: number,
  seed = 1,
): void {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const bow = jitter(seed) * len * 0.006;
  // Deflect perpendicular to the line, so the bow reads the same whether the
  // stroke is horizontal, vertical or neither.
  const nx = -(y1 - y0) / (len || 1);
  const ny = (x1 - x0) / (len || 1);

  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx + nx * bow, my + ny * bow, x1, y1);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * The one shadow in the app: a soft flat ellipse under an object.
 *
 * Not a light model, and deliberately not derived from any light direction —
 * it says "this sits on that" and nothing more. The icon uses exactly one,
 * at 28% opacity.
 */
export function contactShadow(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha = 0.22,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = FLAT.shadow;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
