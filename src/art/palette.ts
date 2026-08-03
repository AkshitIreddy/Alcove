/**
 * art/palette.ts — the colour arithmetic a room is built out of.
 *
 * ## Why this exists
 *
 * A room used to be sixteen hand-picked hexes. Four rooms was just about
 * survivable that way; sixty is not, and hand-picking was never the real
 * problem anyway. The real problem was the JOINERY. Where two faces of the same
 * board meet — a shelf's top surface against its front edge, an upright's face
 * against its turned side, the case against the dark behind it — the flat style
 * has nothing but a colour step to say "this is the same board, turning". If
 * the two hexes were mixed by eye they drift in hue and in saturation as well
 * as in lightness, and the seam stops reading as a fold and starts reading as
 * two different objects butted together. Old Athenaeum's own recess is 8° of
 * hue and 31% of chroma away from its timber, which is most of why its corners
 * looked like collage.
 *
 * So a room is now authored as ONE timber colour, and the faces that turn away
 * from it are DERIVED — same hue, a measured step of lightness, a measured
 * amount of chroma lost into the dark. Every room in the library folds by the
 * same amount, so every corner in the app reads as the same carpenter's work.
 *
 * ## Why OKLCh and not HSL
 *
 * The obvious way to darken a colour is to drop HSL lightness, and it is wrong
 * in a way that shows: HSL is not perceptual, so the same −10% takes a yellow
 * almost to black and barely touches a blue, and blues swing visibly purple on
 * the way down. A library of sixty rooms darkened that way has sixty different
 * amounts of fold in it and a dozen rooms whose shadows have changed colour.
 *
 * OKLab was built for exactly this: equal steps of `L` look like equal steps of
 * lightness, and hue holds while you move. It costs a cube root and a 3x3
 * matrix, once per colour at module load. Nothing here runs in a hot path.
 *
 * ## The one hard floor
 *
 * `FLAT.ink` is the same brown outline on every shape in every room, which puts
 * a floor under how dark any room may go: an outline that has sunk into its own
 * fill is not a mood, it is a shape that has stopped having an edge. Rather than
 * ask sixty rooms to remember that, the derivation solves for it — a dark room
 * gets a shallower fold, and past a point is quietly LIFTED rather than allowed
 * to become a smear. That costs the library its very darkest end and is why
 * `Ebonised Oak` is a deep charcoal; the alternative, seen on the first
 * specimen board, is four brown rooms with their carpentry only implied.
 *
 * This module imports `flat.ts` for that one ink and nothing else, and is
 * imported by `themes.ts`. Both directions are leaves; there is no cycle.
 */

import { FLAT } from './flat';

/* ============================== sRGB <-> OKLab ============================ */

/**
 * A colour in OKLCh: perceptual lightness, chroma, hue angle.
 *
 * `L` runs 0 (black) to 1 (white). `C` is 0 (grey) to roughly 0.37 at the most
 * saturated sRGB can hold; everything in this app lives between 0.02 and 0.16.
 * `h` is degrees, 0–360, with roughly 30 = red, 90 = yellow, 145 = green,
 * 230 = blue, 330 = magenta.
 */
export interface Oklch {
  L: number;
  C: number;
  h: number;
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toGamma(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** `#rgb` or `#rrggbb` → three 0–255 channels. Junk parses as mid grey. */
function channels(hex: string): readonly [number, number, number] {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [128, 128, 128];
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** Read a hex into OKLCh. */
export function toOklch(hex: string): Oklch {
  const [r8, g8, b8] = channels(hex);
  const r = toLinear(r8 / 255);
  const g = toLinear(g8 / 255);
  const b = toLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    L,
    C: Math.hypot(a, bb),
    h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  };
}

/** OKLCh → linear-light sRGB, un-clipped, so gamut can be tested honestly. */
function toLinearRgb(c: Oklch): readonly [number, number, number] {
  const rad = (c.h * Math.PI) / 180;
  const a = Math.cos(rad) * c.C;
  const b = Math.sin(rad) * c.C;
  const l = (c.L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (c.L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (c.L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(c: Oklch): boolean {
  const rgb = toLinearRgb(c);
  return rgb.every((v) => v >= -0.0004 && v <= 1.0004);
}

/**
 * OKLCh → hex, brought back into sRGB by giving up CHROMA, never lightness.
 *
 * A colour that has left the gamut is almost always too saturated for its
 * lightness rather than too light, and the naive fix — clipping each channel —
 * shifts hue, which is the one thing this whole module exists to hold still.
 * Sixteen halvings put chroma within 1/65536 of the gamut boundary, well under
 * a step of 8-bit colour.
 */
export function toHex(c: Oklch): string {
  let fitted = c;
  if (!inGamut(c)) {
    let lo = 0;
    let hi = c.C;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut({ L: c.L, C: mid, h: c.h })) lo = mid;
      else hi = mid;
    }
    fitted = { L: c.L, C: lo, h: c.h };
  }
  const rgb = toLinearRgb(fitted);
  return (
    '#' +
    rgb
      .map((v) => {
        const byte = Math.round(clamp01(toGamma(clamp01(v))) * 255);
        return byte.toString(16).padStart(2, '0');
      })
      .join('')
  );
}

/* ================================ brightness ============================== */

/**
 * Perceived brightness, 0–255, in the weighting the flat rules are judged in.
 *
 * NOT OKLab's `L`. The layering rule ("wall lightest, then timber, then the
 * face turning away, then the recess") predates this module and is asserted in
 * `tests/art-themes.test.ts` with this formula, so the derivation has to solve
 * against the same number the test reads or a room can pass by eye and fail by
 * arithmetic.
 */
export function lum(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * The darkest anything may be and still show the one brown ink around it.
 *
 * Not a guess and not the test's threshold. `tests/art-themes.test.ts` asks for
 * `lum(ink) + 15`, and the first specimen board proved that number is far too
 * generous: a recess sitting on it gives the outline about 1.5:1 of contrast,
 * and the whole inside of a dark bookcase came out as a brown smear with the
 * carpentry only implied. The icon's own recess (`#7d5638`, lum 94) manages
 * 1.83:1, which is what "you can see the pen" actually costs.
 *
 * So the floor is set just under the icon's, and rooms are held above it — see
 * `caseFaces`. It is the single most load-bearing number in this file: raise it
 * and the library loses its dark end, lower it and the dark end loses its
 * edges.
 */
export const INK_FLOOR = lum(FLAT.ink) + 32;

/**
 * The lightness at which `seed`'s hue and chroma reach `target` brightness.
 *
 * Bisection rather than algebra: `lum` is measured on the 8-bit hex AFTER
 * gamut fitting, and fitting can drop chroma, which moves brightness. Solving
 * the thing we actually measure is shorter than modelling it, and 24 steps is
 * finer than a single unit of 8-bit colour.
 */
function lightnessFor(seed: Oklch, target: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (lum(toHex({ ...seed, L: mid })) < target) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Raise a colour's lightness until it is at least `target` bright. */
export function liftTo(hex: string, target: number): string {
  if (lum(hex) >= target) return hex;
  const c = toOklch(hex);
  return toHex({ ...c, L: lightnessFor(c, target) });
}

/**
 * `pale` lifted until it clears `under` by a visible margin.
 *
 * The wall is the lightest thing on screen — that is not a preference, it is
 * what makes the case read as furniture standing in a room rather than as a
 * hole cut in a backdrop. Rooms author their own wall, so this is the guard
 * that stops a bold timber and a soft wall crossing over.
 */
export function paleAbove(pale: string, under: string, margin = 14): string {
  return liftTo(pale, lum(under) + margin);
}

/* ============================== the case fold ============================= */

/**
 * The three faces of one board: toward us, turning away, and the dark behind.
 *
 * Same names as `ColourScheme`'s first three fields, which is how `themes.ts`
 * spreads this straight into a room.
 */
export interface CaseFaces {
  timber: string;
  timberDark: string;
  recess: string;
}

/**
 * How far each face folds, measured off the app icon rather than invented.
 *
 * `assets/brand/icon.svg`'s own oak reads, in OKLCh:
 *
 *   timber      L 0.675  C 0.098  h 65.8
 *   timberDark  L 0.570  C 0.090  h 62.6   → −0.104 L, x0.91 C, −3.2°
 *   recess      L 0.488  C 0.068  h 57.9   → −0.187 L, x0.69 C, −7.9°
 *
 * The lightness steps are copied exactly. The chroma losses are not: a third
 * of the colour is the right amount to lose out of a soft oak and far too much
 * out of a lacquer, where it turns the inside of the case grey and the room
 * reads muddy — which is precisely the complaint this pass came to answer. So
 * the fold keeps more of the pigment than the icon does, and lets the hue turn
 * a couple of degrees warmer into the dark, the way a real shadow does.
 */
const FOLD = {
  face: { drop: 0.105, keep: 0.94, turn: -3 },
  recess: { drop: 0.19, keep: 0.82, turn: -7.5 },
} as const;

/**
 * How much of the fold a dark room is allowed to lose before it is lifted.
 *
 * A dark case genuinely has less room between its timber and the ink than a
 * birch one, and letting the fold COMPRESS is the honest answer to that — dark
 * furniture really does show less of its own turn. Letting it compress without
 * limit is not: the first specimen board had four brown rooms whose recess had
 * collapsed onto their timber, and a bookcase whose inside is the same colour
 * as its outside has stopped being a box.
 *
 * Below this fraction the room is made LIGHTER instead. That costs the library
 * its very darkest end — `Ebonised Oak` is a deep charcoal rather than black —
 * and buys every one of sixty rooms a seam you can see.
 */
const MIN_FOLD = 0.64;

/**
 * Derive a board's turned face and the dark behind it from its lit face.
 *
 * Two clamps, in this order: the recess may not go under the ink floor, and
 * the fold may not compress past `MIN_FOLD` — whichever bites, the timber is
 * raised until the room fits above the floor with a fold still in it.
 */
export function caseFaces(timber: string): CaseFaces {
  const asked = toOklch(timber);

  // The deepest this hue may go. Measured on the recess's own chroma, since
  // fitting a duller colour into sRGB moves its brightness.
  const floorL = lightnessFor({ ...asked, C: asked.C * FOLD.recess.keep }, INK_FLOOR);
  const base: Oklch =
    asked.L < floorL + FOLD.recess.drop * MIN_FOLD
      ? { ...asked, L: floorL + FOLD.recess.drop * MIN_FOLD }
      : asked;

  const recessL = Math.max(base.L - FOLD.recess.drop, floorL);
  const survives = Math.min(1, Math.max(0, (base.L - recessL) / FOLD.recess.drop));

  return {
    timber: toHex(base),
    timberDark: toHex({
      L: base.L - FOLD.face.drop * survives,
      C: base.C * (1 - (1 - FOLD.face.keep) * survives),
      h: base.h + FOLD.face.turn * survives,
    }),
    recess: toHex({
      L: recessL,
      C: base.C * (1 - (1 - FOLD.recess.keep) * survives),
      h: base.h + FOLD.recess.turn * survives,
    }),
  };
}

/* =============================== book cloth =============================== */

/**
 * The icon's cloths fold by almost exactly the same step as its timber does —
 * L −0.088 to −0.109 across five of the six, keeping 90–99% of their chroma.
 * A book is a smaller object than a bookcase, so its band of turned cloth is a
 * few pixels wide and needs the step to stay legible at that size; the gap is
 * held open below rather than merely aimed at.
 */
const CLOTH_FOLD = { drop: 0.1, keep: 0.95, turn: -2 } as const;

/** The narrowest brightness gap that still reads as a fold on a 25px spine. */
const CLOTH_GAP = 16;

/**
 * A cloth as the flat style wants it: the face, and the same cloth turning.
 *
 * Both ends are guarded. A dark cloth would otherwise fold its edge under the
 * ink; a cloth already near the floor would fold nowhere at all and hand back
 * two colours a reader cannot tell apart, so the FACE is lifted instead and the
 * book comes out a shade brighter rather than a shade flatter.
 */
export function clothPair(face: string): readonly [string, string] {
  const lifted = liftTo(face, INK_FLOOR + CLOTH_GAP);
  const base = toOklch(lifted);
  const folded: Oklch = {
    L: base.L - CLOTH_FOLD.drop,
    C: base.C * CLOTH_FOLD.keep,
    h: base.h + CLOTH_FOLD.turn,
  };
  const edgeL = Math.max(folded.L, lightnessFor(folded, INK_FLOOR));
  const edge = toHex({ ...folded, L: edgeL });
  // The fold is measured in OKLab and the gap is judged in sRGB brightness, so
  // a very light or very dark cloth can fold the right amount and still not
  // clear the gap. Lift the face until it does.
  const shortfall = CLOTH_GAP - (lum(lifted) - lum(edge));
  if (shortfall <= 0) return [lifted, edge] as const;
  return [toHex({ ...base, L: lightnessFor(base, lum(lifted) + shortfall) }), edge] as const;
}

/* ================================= mixing ================================= */

/**
 * Two colours mixed in OKLab, `t` of the way from `a` to `b`.
 *
 * Rectangular OKLab, NOT the polar arc, and that is a deliberate choice about
 * agreement rather than about colour. Mixed pigments in this app have to be
 * painted twice — once onto a canvas from a hex, once into the DOM as
 * `color-mix(in oklab, …)` so a library theme can retint the parents — and the
 * two renderings must land on the same colour or a swatch will disagree with
 * the block it paints. CSS's `oklab` interpolation is rectangular, so this is.
 *
 * The cost is the chord instead of the arc: a mix loses a little chroma the
 * further apart its parents' hues are. Measured on the eleven token families,
 * the widest gap any swatch below spans is 63° (sky → violet), where the chord
 * gives up about 15% of an already-quiet chroma of 0.05. That is under a step
 * of 8-bit colour on screen, and worth it to have one colour, not two.
 */
export function mixOklab(a: string, b: string, t: number): string {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const A = toOklch(a);
  const B = toOklch(b);
  const ax = Math.cos((A.h * Math.PI) / 180) * A.C;
  const ay = Math.sin((A.h * Math.PI) / 180) * A.C;
  const bx = Math.cos((B.h * Math.PI) / 180) * B.C;
  const by = Math.sin((B.h * Math.PI) / 180) * B.C;
  const x = ax + (bx - ax) * k;
  const y = ay + (by - ay) * k;
  return toHex({
    L: A.L + (B.L - A.L) * k,
    C: Math.hypot(x, y),
    h: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
  });
}

/* =============================== wash faces =============================== */

/**
 * A pigment as `styles/tokens.css` states it: the pale face, the face you see,
 * and the darker face set beside it. Same three rungs the eleven `--wash-*`
 * families are authored in.
 */
export interface WashFaces {
  light: string;
  base: string;
  deep: string;
}

/**
 * The band the app's own pigments occupy, MEASURED off `styles/tokens.css`
 * rather than chosen — the eleven families were hand-tuned to read as one
 * drawing, so the honest way to let a reader's own colour join them is to put
 * it on the rungs they already stand on.
 *
 * Read out of the eleven families in OKLCh:
 *
 *   base   L 0.528 (plum) … 0.822 (lemon),  mean 0.661;  C 0.041 … 0.144
 *   light  L 0.898 … 0.946, mean 0.916;     C = base's × 0.24 … 0.45, mean 0.36
 *   deep   L 0.382 … 0.513, mean 0.454;     C = base's × 0.74 … 1.03, mean 0.89
 *
 * So the light and deep faces are not a fixed STEP away from the base — they
 * are fixed LIGHTNESSES with the base's own hue and a measured amount of its
 * chroma. That is why an amber and a plum, whose bases are 0.29 of lightness
 * apart, still hand back light faces you can set the same ink on.
 */
export const WASH_BAND = {
  /** Base faces are clamped into this range, so nothing lands off the drawing. */
  baseMin: 0.528,
  baseMax: 0.822,
  /** Nothing may out-shout the loudest token family (coral, C 0.144). */
  chromaMax: 0.15,
  light: { L: 0.916, keep: 0.36 },
  deep: { L: 0.454, keep: 0.89 },
} as const;

/**
 * Pull any colour into the band the eleven token families live in.
 *
 * Lightness is clamped, not replaced: a reader who picks a pale sage and a
 * reader who picks a deep one should still get two different colours. Chroma
 * is only ever clamped DOWNWARD — a neon out of a system colour picker is the
 * one input that would visibly leave the drawing, and a grey is a legitimate
 * choice that must survive as a grey. Finally the result is held above
 * `INK_FLOOR`, because `FLAT.ink` has to sit on it in the art.
 */
export function intoWashBand(hex: string): string {
  const c = toOklch(hex);
  const L = c.L < WASH_BAND.baseMin ? WASH_BAND.baseMin : c.L > WASH_BAND.baseMax ? WASH_BAND.baseMax : c.L;
  const C = c.C > WASH_BAND.chromaMax ? WASH_BAND.chromaMax : c.C;
  return liftTo(toHex({ L, C, h: c.h }), INK_FLOOR);
}

/**
 * The three faces of one pigment, derived the way the token families fold.
 *
 * `base` is passed through `intoWashBand` first, so this is total for any hex
 * a reader can type — including `#000000`, which comes back as the darkest
 * pigment the drawing allows rather than as a hole in the page.
 */
export function washFaces(base: string): WashFaces {
  const fitted = intoWashBand(base);
  const c = toOklch(fitted);
  return {
    light: toHex({ L: WASH_BAND.light.L, C: c.C * WASH_BAND.light.keep, h: c.h }),
    base: fitted,
    deep: toHex({ L: WASH_BAND.deep.L, C: c.C * WASH_BAND.deep.keep, h: c.h }),
  };
}
