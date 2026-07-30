/**
 * art/lighting.ts — the shared light rig and its composable render passes.
 *
 * Per `docs/design/painterly-art-direction.md` §2, the single biggest gap
 * between our shelf and the reference painting was *light*: we had flat
 * ambient everywhere, no cast shadows, no rim, no temperature shift. This
 * module is the corrective, and it is shared by every art module (spines,
 * covers, wood, case, flora) so one room is lit by one sun.
 *
 * ## The model
 *
 * A `LightRig` describes one room's light: a directional **key**, a bounce
 * **fill**, an **ambient** floor, how dark recesses go (**ambient occlusion**),
 * how hot the edges facing the key get (**rim**), any **volumetric shafts**
 * crossing the frame, the warm→cool **temperature shift** between lit and
 * shadowed areas, plus **vignette**, **bloom** and a final **colour grade**.
 *
 * It is *artistic, not physically accurate*. Every helper here is tuned for
 * beauty: falloffs are shaped by eye, shadows are foreshortened by a fixed
 * ground factor rather than projected properly, and the grade is a painter's
 * split-tone rather than a filmic curve.
 *
 * ## Angle convention
 *
 * `keyAngle` is in **radians** and describes the direction light *travels* in
 * canvas space (y grows downward). So:
 *
 * ```
 *            key source          keyAngle
 *   upper-left   ↘              PI * 0.25   ( +x, +y )
 *   above        ↓              PI * 0.5    (  0, +y )
 *   upper-right  ↙              PI * 0.75   ( -x, +y )   ← the house default
 *   right        ←              PI          ( -x,  0 )
 * ```
 *
 * A surface's *normal* uses the same frame: normal angle 0 faces +x (right),
 * `-PI/2` faces up. A surface is fully lit when its normal points straight
 * back down the light's travel direction.
 *
 * ## Render order (per floor, per the spec)
 *
 * ambient base → AO in every recess and joint → cast shadows (books onto
 * neighbours and planks, flora onto wood) → key light pass with hot spots →
 * rim pass → light shafts → bloom → vignette → colour grade.
 *
 * `renderLitScene` runs exactly that order around a caller-supplied body.
 *
 * ## The contact-shadow rule
 *
 * > Every object that touches another casts a short, dark, soft-edged shadow
 * > at the contact point. This one addition does more for perceived quality
 * > than any other.
 *
 * `castContactShadow` is that rule. Use it everywhere two things touch: a
 * book's foot on the plank, a book's side against its neighbour, a leaf lying
 * on wood, a prop on a shelf. It is deliberately cheap — two or three
 * gradient fills — so it can be called hundreds of times per frame bake.
 */

import { clamp, lerp, mulberry32, type RandomFn } from './noise';

/* ========================================================================== *
 *                                   types                                    *
 * ========================================================================== */

/** A 2D vector in canvas space (y down). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Straight RGBA, channels 0–255, alpha 0–1. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Canvas kinds the passes accept (mirrors art/spines.ts). */
export type LightCanvas = OffscreenCanvas | HTMLCanvasElement;
/** 2D contexts the passes accept (mirrors art/spines.ts). */
export type LightCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * One volumetric light shaft ("god ray") crossing the frame.
 *
 * Coordinates are **normalized to the frame** (0–1 in both axes) so a rig can
 * be reused at any canvas size: a shaft authored for a 1200px case still
 * lands in the right place on a 300px specimen board.
 */
export interface ShaftSpec {
  /** Where the shaft enters the frame, normalized (0–1, 0–1). */
  origin: Vec2;
  /** Direction the shaft travels, radians (same convention as `keyAngle`). */
  angle: number;
  /** Shaft width at the origin, as a fraction of the frame's diagonal. */
  width: number;
  /** How far it reaches, as a fraction of the frame's diagonal. */
  length: number;
  /** Edge feather, 0 (hard blade) → 1 (pure haze). */
  softness: number;
  /** Peak opacity at the origin. */
  opacity: number;
  /** Shaft colour; defaults to the rig's key colour, warmed. */
  colour?: string;
  /** How much the shaft widens along its length (1 = parallel, 2 = doubles). */
  spread?: number;
  /** Dust-mote density inside the shaft, 0–1. Motes are static (baked). */
  dust?: number;
}

/**
 * A room's complete lighting description.
 *
 * Every field has a sane default in {@link DEFAULT_LIGHT_RIG}; partial rigs go
 * through {@link resolveLightRig}, which is total (it never throws) so a rig
 * can be read straight out of theme data.
 */
export interface LightRig {
  /** Stable id, e.g. `'golden-hour'`. */
  id: string;
  /** Human label for pickers. */
  label: string;

  /* --- key --------------------------------------------------------------- */
  /** Direction the key light travels, radians. See the angle convention. */
  keyAngle: number;
  /** Key colour — warm gold, cool moon, neon cyan… */
  keyColour: string;
  /** Key intensity, 0 (off) → ~1.6 (blinding). 1 is "a bright afternoon". */
  keyIntensity: number;
  /**
   * How readily surfaces facing the key blow out toward white.
   * 0 keeps everything in gamut; 1 gives the reference's hot spots.
   */
  hotSpot: number;

  /* --- fill & ambient ---------------------------------------------------- */
  /** Bounce light in shadow — usually the key's complement, always cooler. */
  fillColour: string;
  /** Fill intensity, 0–1. */
  fillIntensity: number;
  /** The floor tone nothing falls below. */
  ambientColour: string;
  /** Ambient level, 0–1. Low values give the reference's near-black recesses. */
  ambientLevel: number;

  /* --- occlusion & contact ----------------------------------------------- */
  /** How dark recesses and joints go, 0–1. */
  ambientOcclusion: number;
  /** Colour of contact shadows and AO (never pure black — always a deep hue). */
  shadowColour: string;
  /** Contact-shadow darkness multiplier, 0–1.5. */
  contactStrength: number;
  /**
   * Ground-plane foreshortening for cast shadows: a shadow thrown across a
   * horizontal plank is compressed vertically by this factor. 0.3–0.45 reads
   * best at shelf scale.
   */
  groundFlatten: number;

  /* --- rim --------------------------------------------------------------- */
  /** Edge light on surfaces facing the key, 0–1.5. */
  rimStrength: number;
  /** Rim colour — normally the key pushed hotter and paler. */
  rimColour: string;
  /** Rim falloff sharpness: higher = a thinner, crisper edge. */
  rimSharpness: number;

  /* --- volumetrics ------------------------------------------------------- */
  /** Volumetric shafts crossing the frame. */
  shafts: readonly ShaftSpec[];

  /* --- grade ------------------------------------------------------------- */
  /**
   * Warm→cool split across the light gradient, -1 → 1.
   * Positive = lit areas warm and shadows go cool (the reference's look).
   */
  temperatureShift: number;
  /** Corner darkening, 0–1. */
  vignette: number;
  /** Vignette tint. */
  vignetteColour: string;
  /** Vignette shape: 0 = circular, 1 = follows the frame's rectangle. */
  vignetteRoundness: number;
  /** Glow bleed from hot spots, 0–1. */
  bloom: number;
  /** Luminance above which a pixel blooms, 0–1. */
  bloomThreshold: number;
  /** Overall exposure multiplier applied by the grade, ~0.8–1.3. */
  exposure: number;
  /** S-curve contrast applied by the grade, 0 (off) → 1 (hard). */
  contrast: number;
  /** Saturation multiplier applied by the grade, 0–2. */
  saturation: number;
  /** Atmospheric haze colour for recessed/distant things. */
  hazeColour: string;
  /** How fast contrast is lost with depth, 0–1. */
  hazeStrength: number;
}

/** A partial rig, as themes and callers write them. */
export type LightRigInput = Partial<LightRig> & { shafts?: readonly Partial<ShaftSpec>[] };

/* ========================================================================== *
 *                             colour primitives                              *
 * ========================================================================== */

const NAMED: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  transparent: '#00000000',
  gold: '#c9a227',
  cream: '#f4ead2',
  ink: '#2c2419',
};

/** Opaque black — the safe fallback for any colour that cannot be parsed. */
export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

/**
 * Parse a CSS colour into straight RGBA. Accepts `#rgb`, `#rgba`, `#rrggbb`,
 * `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()` (comma or space separated,
 * with or without a `/ alpha`), and a handful of named colours.
 *
 * **Total**: anything unrecognised comes back as opaque black rather than
 * throwing, because rigs can carry user/theme data.
 */
export function parseColour(css: string): RGBA {
  if (typeof css !== 'string') return { ...BLACK };
  const raw = css.trim().toLowerCase();
  const named = NAMED[raw];
  const s = named ?? raw;

  if (s.startsWith('#')) {
    const hex = s.slice(1);
    const expand = (c: string): number => Number.parseInt(c + c, 16);
    if (hex.length === 3 || hex.length === 4) {
      const r = expand(hex[0] as string);
      const g = expand(hex[1] as string);
      const b = expand(hex[2] as string);
      const a = hex.length === 4 ? expand(hex[3] as string) / 255 : 1;
      if ([r, g, b].some((v) => Number.isNaN(v))) return { ...BLACK };
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = Number.parseInt(hex.slice(0, 6), 16);
      if (Number.isNaN(n)) return { ...BLACK };
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return {
        r: (n >> 16) & 0xff,
        g: (n >> 8) & 0xff,
        b: n & 0xff,
        a: Number.isNaN(a) ? 1 : a,
      };
    }
    return { ...BLACK };
  }

  const fn = /^(rgba?|hsla?)\s*\(([^)]*)\)$/.exec(s);
  if (fn === null) return { ...BLACK };
  const kind = fn[1] as string;
  const parts = (fn[2] as string)
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((p) => p.length > 0);
  if (parts.length < 3) return { ...BLACK };

  const readAlpha = (p: string | undefined): number => {
    if (p === undefined) return 1;
    const v = p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p);
    return Number.isFinite(v) ? clamp(v, 0, 1) : 1;
  };

  if (kind.startsWith('rgb')) {
    const chan = (p: string): number => {
      const v = p.endsWith('%') ? (Number.parseFloat(p) / 100) * 255 : Number.parseFloat(p);
      return Number.isFinite(v) ? clamp(Math.round(v), 0, 255) : 0;
    };
    return {
      r: chan(parts[0] as string),
      g: chan(parts[1] as string),
      b: chan(parts[2] as string),
      a: readAlpha(parts[3]),
    };
  }

  // hsl / hsla
  const h = (((Number.parseFloat(parts[0] as string) || 0) % 360) + 360) % 360 / 360;
  const sat = clamp((Number.parseFloat(parts[1] as string) || 0) / 100, 0, 1);
  const li = clamp((Number.parseFloat(parts[2] as string) || 0) / 100, 0, 1);
  if (sat === 0) {
    const v = Math.round(li * 255);
    return { r: v, g: v, b: v, a: readAlpha(parts[3]) };
  }
  const q = li < 0.5 ? li * (1 + sat) : li + sat - li * sat;
  const p = 2 * li - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    a: readAlpha(parts[3]),
  };
}

/** Serialize RGBA back to a CSS string (`rgb()` when opaque, else `rgba()`). */
export function rgbaToCss(c: RGBA): string {
  const r = clamp(Math.round(c.r), 0, 255);
  const g = clamp(Math.round(c.g), 0, 255);
  const b = clamp(Math.round(c.b), 0, 255);
  const a = clamp(c.a, 0, 1);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

/** The same colour at a different alpha. Accepts a CSS string or RGBA. */
export function withAlpha(colour: string | RGBA, alpha: number): string {
  const c = typeof colour === 'string' ? parseColour(colour) : colour;
  return rgbaToCss({ ...c, a: clamp(alpha, 0, 1) });
}

/**
 * Linear RGB mix a→b by t (t is clamped). Alpha mixes too, so fading a colour
 * to `transparent` works as expected.
 */
export function mixColour(a: string | RGBA, b: string | RGBA, t: number): RGBA {
  const ca = typeof a === 'string' ? parseColour(a) : a;
  const cb = typeof b === 'string' ? parseColour(b) : b;
  const k = clamp(t, 0, 1);
  return {
    r: lerp(ca.r, cb.r, k),
    g: lerp(ca.g, cb.g, k),
    b: lerp(ca.b, cb.b, k),
    a: lerp(ca.a, cb.a, k),
  };
}

/** `mixColour` returning a CSS string. */
export function mixColourCss(a: string | RGBA, b: string | RGBA, t: number): string {
  return rgbaToCss(mixColour(a, b, t));
}

/** Multiply every channel by k (a crude exposure change). Alpha untouched. */
export function scaleColour(colour: string | RGBA, k: number): RGBA {
  const c = typeof colour === 'string' ? parseColour(colour) : colour;
  return { r: c.r * k, g: c.g * k, b: c.b * k, a: c.a };
}

/** Rec. 709 relative luminance of a colour, 0–1. */
export function luminance(colour: string | RGBA): number {
  const c = typeof colour === 'string' ? parseColour(colour) : colour;
  return clamp((0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255, 0, 1);
}

/**
 * Push a colour warm (positive) or cool (negative), `amount` in -1…1.
 *
 * Painter's temperature, not Planck's: warm lifts red and drops blue while
 * nudging green a third of the way with red, so skin, wood and gold all move
 * plausibly. The result keeps roughly the same luminance, which is what makes
 * it usable as a *shift* rather than a tint.
 */
export function shiftTemperature(colour: string | RGBA, amount: number): RGBA {
  const c = typeof colour === 'string' ? parseColour(colour) : colour;
  const k = clamp(amount, -1, 1);
  const before = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const r = c.r + k * 46;
  const g = c.g + k * 14;
  const b = c.b - k * 44;
  const after = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Renormalize toward the original luminance so a shift does not double as
  // an exposure change (that is `exposure`'s job).
  const gain = after > 1 ? lerp(1, before / after, 0.75) : 1;
  return {
    r: clamp(r * gain, 0, 255),
    g: clamp(g * gain, 0, 255),
    b: clamp(b * gain, 0, 255),
    a: c.a,
  };
}

/** Saturate (k > 1) or desaturate (k < 1) around the colour's own luminance. */
export function saturateColour(colour: string | RGBA, k: number): RGBA {
  const c = typeof colour === 'string' ? parseColour(colour) : colour;
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return {
    r: clamp(lerp(l, c.r, k), 0, 255),
    g: clamp(lerp(l, c.g, k), 0, 255),
    b: clamp(lerp(l, c.b, k), 0, 255),
    a: c.a,
  };
}

/**
 * Blend a colour toward a hot, near-white version of itself — the "hot spot"
 * move from the spec, where surfaces facing the light blow out to white-gold
 * rather than merely getting lighter.
 */
export function blowOut(colour: string | RGBA, amount: number): RGBA {
  const c = typeof colour === 'string' ? parseColour(colour) : colour;
  const t = clamp(amount, 0, 1);
  // The target is not white but the colour's own hue driven to near-white,
  // which keeps gold gold instead of bleaching it grey.
  const hot: RGBA = {
    r: lerp(c.r, 255, 0.86),
    g: lerp(c.g, 255, 0.78),
    b: lerp(c.b, 250, 0.62),
    a: c.a,
  };
  return mixColour(c, hot, t * t * (3 - 2 * t));
}

/* ========================================================================== *
 *                             falloff & curves                               *
 * ========================================================================== */

/** The named falloff shapes the passes and callers share. */
export type FalloffCurve =
  | 'linear'
  | 'smooth'
  | 'smoother'
  | 'sqrt'
  | 'quadratic'
  | 'cubic'
  | 'inverseSquare'
  | 'exponential'
  | 'gaussian';

/**
 * Evaluate a normalized falloff at `t` ∈ [0, 1], where 0 = at the source
 * (full strength, returns 1) and 1 = at the edge (returns 0).
 *
 * Out-of-range `t` is clamped, so every curve is total and monotone
 * non-increasing on [0, 1] — a property the unit tests pin down, because a
 * non-monotone falloff shows up as a visible ring in a gradient.
 */
export function falloff(t: number, curve: FalloffCurve = 'smooth'): number {
  const x = clamp(t, 0, 1);
  switch (curve) {
    case 'linear':
      return 1 - x;
    case 'smooth': {
      const u = 1 - x;
      return u * u * (3 - 2 * u);
    }
    case 'smoother': {
      const u = 1 - x;
      return u * u * u * (u * (u * 6 - 15) + 10);
    }
    case 'sqrt':
      return Math.sqrt(1 - x);
    case 'quadratic':
      return (1 - x) * (1 - x);
    case 'cubic':
      return (1 - x) * (1 - x) * (1 - x);
    case 'inverseSquare':
      // Shifted so it actually reaches 0 at t = 1 (physics would asymptote).
      return clamp((1 / (1 + 8 * x * x) - 1 / 9) * (9 / 8), 0, 1);
    case 'exponential':
      return clamp((Math.exp(-4 * x) - Math.exp(-4)) / (1 - Math.exp(-4)), 0, 1);
    case 'gaussian': {
      const g = Math.exp(-4.5 * x * x);
      const edge = Math.exp(-4.5);
      return clamp((g - edge) / (1 - edge), 0, 1);
    }
    default:
      return 1 - x;
  }
}

/** Hermite smoothstep from `edge0`→`edge1`. Total; handles edge0 ≥ edge1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * A soft "knee" threshold, used by bloom: below `threshold` returns 0, above
 * it ramps smoothly to 1 over `knee`. Avoids the hard banding a step gives.
 */
export function bloomWeight(lum: number, threshold: number, knee = 0.25): number {
  return smoothstep(threshold, Math.min(1, threshold + Math.max(1e-4, knee)), clamp(lum, 0, 1));
}

/* ========================================================================== *
 *                                rig geometry                                *
 * ========================================================================== */

/** Convenience key angles, named by where the *source* sits. */
export const KEY_ANGLE = {
  /** Source upper-left; light travels down-right. */
  upperLeft: Math.PI * 0.25,
  /** Source directly above; light travels straight down. */
  above: Math.PI * 0.5,
  /** Source upper-right; light travels down-left. The house default. */
  upperRight: Math.PI * 0.75,
  /** Source to the right; light travels left. */
  right: Math.PI,
  /** Source to the left; light travels right. */
  left: 0,
  /** Source lower-right; light travels up-left (footlights, hearth). */
  lowerRight: Math.PI * 1.25,
  /** Source below; light travels up. */
  below: Math.PI * 1.5,
  /** Source lower-left; light travels up-right. */
  lowerLeft: Math.PI * 1.75,
} as const;

/** Unit vector along the key's direction of travel. */
export function keyDirection(rig: Pick<LightRig, 'keyAngle'>): Vec2 {
  return { x: Math.cos(rig.keyAngle), y: Math.sin(rig.keyAngle) };
}

/** Unit vector pointing back *toward* the key source (the shading L vector). */
export function keyToSource(rig: Pick<LightRig, 'keyAngle'>): Vec2 {
  return { x: -Math.cos(rig.keyAngle), y: -Math.sin(rig.keyAngle) };
}

/**
 * Lambert term for a surface whose outward normal points at `normalAngle`
 * (radians, same frame as `keyAngle`). Returns 0–1: 1 when the surface faces
 * the source head-on, 0 once it turns away.
 *
 * `wrap` softens the terminator the way a painter does — 0 is a hard physical
 * cosine, 0.5 wraps light a quarter turn around the object. Default 0.25.
 */
export function surfaceLambert(
  normalAngle: number,
  rig: Pick<LightRig, 'keyAngle'>,
  wrap = 0.25,
): number {
  const d = -Math.cos(normalAngle - rig.keyAngle);
  const w = clamp(wrap, 0, 1);
  return clamp((d + w) / (1 + w), 0, 1);
}

/**
 * How much key light a surface actually receives: the Lambert term times the
 * rig's intensity, clamped to 0–1 for use as an alpha.
 */
export function keyExposure(
  normalAngle: number,
  rig: Pick<LightRig, 'keyAngle' | 'keyIntensity'>,
  wrap = 0.25,
): number {
  return clamp(surfaceLambert(normalAngle, rig, wrap) * rig.keyIntensity, 0, 1);
}

/**
 * Rim strength for an edge whose outward normal points at `normalAngle`.
 *
 * A rim is *not* the Lambert term: it peaks at the grazing edge, where the
 * surface has almost turned away, which is why `rimSharpness` raises the
 * facing term to a power and then re-weights it toward the silhouette.
 */
export function rimFactor(
  normalAngle: number,
  rig: Pick<LightRig, 'keyAngle' | 'rimStrength' | 'rimSharpness'>,
): number {
  const facing = surfaceLambert(normalAngle, rig, 0.1);
  const graze = Math.pow(facing, Math.max(0.05, rig.rimSharpness));
  return clamp(graze * rig.rimStrength, 0, 1);
}

/**
 * Offset of a cast shadow for an object standing `distance` px above the
 * receiving surface.
 *
 * The vertical component is compressed by `rig.groundFlatten` because the
 * receiving surface (a plank, the case floor) is seen almost edge-on — this
 * one factor is what stops shelf shadows reading as a second, floating copy
 * of the book.
 */
export function shadowOffset(
  rig: Pick<LightRig, 'keyAngle' | 'groundFlatten'>,
  distance: number,
): Vec2 {
  const d = keyDirection(rig);
  return { x: d.x * distance, y: d.y * distance * clamp(rig.groundFlatten, 0, 1) };
}

/**
 * How far a contact shadow should spread given the size of the contact and
 * the gap between the two surfaces.
 *
 * The physical rule a painter internalises: a shadow is *tight and dark* where
 * the objects actually touch and widens/softens as they separate. Returns the
 * blur radius in px.
 */
export function contactShadowSpread(contactSize: number, gap = 0): number {
  const base = Math.max(1.2, contactSize * 0.22);
  return base + Math.max(0, gap) * 1.35;
}

/**
 * Ambient-occlusion darkness at a given recess depth (0 = flush with the
 * surface, 1 = deep in a corner). Uses a `smoother` falloff inverted, so the
 * darkening starts gently and then drops away fast — the way a real corner
 * reads.
 */
export function occlusionAt(depth: number, rig: Pick<LightRig, 'ambientOcclusion'>): number {
  return clamp((1 - falloff(clamp(depth, 0, 1), 'smoother')) * rig.ambientOcclusion, 0, 1);
}

/**
 * The colour of light landing on a surface at `exposure` (0 = full shadow,
 * 1 = full key). This is where the warm→cool temperature shift lives: shadows
 * drift cool and lit areas drift warm, by `rig.temperatureShift`.
 */
export function temperatureAt(rig: LightRig, exposure: number): RGBA {
  const t = clamp(exposure, 0, 1);
  const shadow = mixColour(rig.ambientColour, rig.fillColour, clamp(rig.fillIntensity, 0, 1));
  const lit = mixColour(shadow, rig.keyColour, clamp(rig.keyIntensity, 0, 1.4) * 0.85);
  const base = mixColour(shadow, lit, falloffInverse(t));
  // Cool the shadows, warm the lights, around the midpoint.
  return shiftTemperature(base, (t - 0.5) * 2 * rig.temperatureShift);
}

/** 1 - falloff(1 - t): a ramp that rises smoothly from 0→1 as t goes 0→1. */
function falloffInverse(t: number): number {
  return 1 - falloff(clamp(t, 0, 1), 'smooth');
}

/**
 * Sample the rig at a normalized frame position — what a module needs to tint
 * an object it is about to draw somewhere specific in the case.
 *
 * `x01`/`y01` are 0–1 across the frame. The result carries the light colour at
 * that point, its 0–1 exposure, and the shadow tone to pair with it.
 */
export interface LightSample {
  /** 0 (deep shadow) → 1 (full key). */
  exposure: number;
  /** Colour of the light landing there. */
  light: RGBA;
  /** The matching shadow tone (cool, ambient-derived). */
  shadow: RGBA;
  /** Rim colour to use for edges at this point. */
  rim: RGBA;
}

/**
 * Probe the rig at a normalized frame position.
 *
 * The gradient runs *from* the key source *toward* the far corner, so a
 * `keyAngle` of `upperRight` gives the reference's diagonal: hot at top-right,
 * falling away to near-black at bottom-left.
 */
export function lightProbe(rig: LightRig, x01: number, y01: number): LightSample {
  const src = keyToSource(rig);
  // Project the point onto the light axis; remap the -1…1 result to 0…1.
  const px = clamp(x01, 0, 1) - 0.5;
  const py = clamp(y01, 0, 1) - 0.5;
  const proj = (px * src.x + py * src.y) / Math.SQRT1_2; // ≈ -1…1
  const exposure = clamp(0.5 + proj * 0.72, 0, 1);
  const light = temperatureAt(rig, exposure);
  const shadow = shiftTemperature(
    mixColour(rig.shadowColour, rig.fillColour, rig.fillIntensity * 0.5),
    -rig.temperatureShift * 0.8,
  );
  const rim = blowOut(rig.rimColour, 0.25);
  return { exposure, light, shadow, rim };
}

/**
 * Atmospheric depth: how much haze veils something `depth` (0 = at the front
 * plane, 1 = at the back of the case). Distant things lose contrast and gain
 * the room's haze colour.
 */
export function atmosphericBlend(depth: number, rig: Pick<LightRig, 'hazeStrength'>): number {
  return clamp(falloffInverse(clamp(depth, 0, 1)) * rig.hazeStrength, 0, 1);
}

/**
 * Vignette factor at a pixel — 1 at the centre, falling to 0 at the corners.
 * `roundness` 0 gives a circular vignette, 1 follows the frame rectangle.
 */
export function vignetteFactor(
  x: number,
  y: number,
  w: number,
  h: number,
  strength: number,
  roundness = 0.35,
): number {
  if (w <= 0 || h <= 0) return 1;
  const nx = (x / w) * 2 - 1;
  const ny = (y / h) * 2 - 1;
  const circular = Math.hypot(nx, ny) / Math.SQRT2;
  const rect = Math.max(Math.abs(nx), Math.abs(ny));
  const d = lerp(circular, rect, clamp(roundness, 0, 1));
  return clamp(1 - clamp(strength, 0, 1) * smoothstep(0.35, 1.05, d), 0, 1);
}

/* ========================================================================== *
 *                                   rigs                                     *
 * ========================================================================== */

/**
 * The house rig: a warm late-afternoon sun entering high on the right, the
 * exact light the reference painting is made of. Everything else in this
 * module defaults to it.
 */
export const DEFAULT_LIGHT_RIG: LightRig = {
  id: 'golden-hour',
  label: 'Golden hour',
  keyAngle: KEY_ANGLE.upperRight,
  keyColour: '#ffd79a',
  keyIntensity: 1,
  hotSpot: 0.62,
  fillColour: '#7f93b8',
  fillIntensity: 0.3,
  ambientColour: '#4a3f33',
  ambientLevel: 0.34,
  ambientOcclusion: 0.72,
  shadowColour: '#2a1e14',
  contactStrength: 0.95,
  groundFlatten: 0.36,
  rimStrength: 0.8,
  rimColour: '#fff0c8',
  rimSharpness: 2.4,
  shafts: [
    {
      origin: { x: 0.88, y: -0.04 },
      angle: Math.PI * 0.72,
      width: 0.16,
      length: 1.5,
      softness: 0.72,
      opacity: 0.18,
      spread: 1.7,
      dust: 0.55,
    },
    {
      origin: { x: 1.02, y: 0.1 },
      angle: Math.PI * 0.78,
      width: 0.08,
      length: 1.35,
      softness: 0.85,
      opacity: 0.12,
      spread: 2.1,
      dust: 0.3,
    },
  ],
  temperatureShift: 0.55,
  vignette: 0.42,
  vignetteColour: '#231a11',
  vignetteRoundness: 0.35,
  bloom: 0.4,
  bloomThreshold: 0.72,
  exposure: 1.02,
  contrast: 0.28,
  saturation: 1.08,
  hazeColour: '#6d5b46',
  hazeStrength: 0.45,
};

/**
 * Twelve hand-authored rigs. These are *specified, not parameterised* — each
 * one was tuned by eye against a full shelf render, which is why the numbers
 * are not on a grid. Themes pick one by id.
 */
export const LIGHT_RIGS: Readonly<Record<string, LightRig>> = {
  /** The default: warm afternoon sun, upper right, deep cool shadows. */
  'golden-hour': DEFAULT_LIGHT_RIG,

  /** Cool white morning through a tall window; crisp, high-key, low haze. */
  'morning-window': {
    ...DEFAULT_LIGHT_RIG,
    id: 'morning-window',
    label: 'Morning window',
    keyAngle: Math.PI * 0.7,
    keyColour: '#fff4e2',
    keyIntensity: 1.1,
    hotSpot: 0.72,
    fillColour: '#9fb4d6',
    fillIntensity: 0.38,
    ambientColour: '#5a5b60',
    ambientLevel: 0.44,
    ambientOcclusion: 0.6,
    shadowColour: '#2c2a2e',
    rimColour: '#ffffff',
    rimStrength: 0.72,
    temperatureShift: 0.28,
    vignette: 0.3,
    bloom: 0.5,
    bloomThreshold: 0.68,
    saturation: 1.02,
    hazeStrength: 0.3,
    shafts: [
      {
        origin: { x: 0.82, y: -0.05 },
        angle: Math.PI * 0.66,
        width: 0.22,
        length: 1.6,
        softness: 0.8,
        opacity: 0.16,
        spread: 1.5,
        dust: 0.7,
      },
    ],
  },

  /** Flat north-light studio: gentle, almost shadowless, for legibility. */
  'overcast-studio': {
    ...DEFAULT_LIGHT_RIG,
    id: 'overcast-studio',
    label: 'Overcast studio',
    keyAngle: Math.PI * 0.55,
    keyColour: '#eef1f4',
    keyIntensity: 0.6,
    hotSpot: 0.16,
    fillColour: '#b9c3ce',
    fillIntensity: 0.55,
    ambientColour: '#6d6a66',
    ambientLevel: 0.6,
    ambientOcclusion: 0.42,
    shadowColour: '#3a3833',
    contactStrength: 0.6,
    rimStrength: 0.24,
    rimColour: '#f2f5f8',
    shafts: [],
    temperatureShift: 0.06,
    vignette: 0.18,
    bloom: 0.1,
    bloomThreshold: 0.86,
    exposure: 1.04,
    contrast: 0.12,
    saturation: 0.96,
    hazeStrength: 0.2,
  },

  /** A single candle low and close: hot orange core, near-black beyond. */
  candlelit: {
    ...DEFAULT_LIGHT_RIG,
    id: 'candlelit',
    label: 'Candlelit',
    keyAngle: Math.PI * 1.18,
    keyColour: '#ffb154',
    keyIntensity: 1.15,
    hotSpot: 0.8,
    fillColour: '#4a3a63',
    fillIntensity: 0.16,
    ambientColour: '#2a1d15',
    ambientLevel: 0.14,
    ambientOcclusion: 0.9,
    shadowColour: '#160d08',
    contactStrength: 1.15,
    rimStrength: 1.05,
    rimColour: '#ffd08a',
    rimSharpness: 3.2,
    shafts: [],
    temperatureShift: 0.85,
    vignette: 0.68,
    vignetteColour: '#120a06',
    bloom: 0.62,
    bloomThreshold: 0.6,
    exposure: 0.94,
    contrast: 0.42,
    saturation: 1.16,
    hazeColour: '#4a3220',
    hazeStrength: 0.62,
  },

  /** Cold blue moon through a high window; silver rims, ink shadows. */
  moonlit: {
    ...DEFAULT_LIGHT_RIG,
    id: 'moonlit',
    label: 'Moonlit',
    keyAngle: Math.PI * 0.8,
    keyColour: '#c4d8f2',
    keyIntensity: 0.72,
    hotSpot: 0.4,
    fillColour: '#3d4f76',
    fillIntensity: 0.24,
    ambientColour: '#1d2233',
    ambientLevel: 0.2,
    ambientOcclusion: 0.86,
    shadowColour: '#0d1120',
    contactStrength: 1.05,
    rimStrength: 0.95,
    rimColour: '#e8f2ff',
    rimSharpness: 3,
    shafts: [
      {
        origin: { x: 0.74, y: -0.06 },
        angle: Math.PI * 0.74,
        width: 0.13,
        length: 1.5,
        softness: 0.78,
        opacity: 0.2,
        spread: 1.9,
        dust: 0.8,
      },
    ],
    temperatureShift: -0.5,
    vignette: 0.6,
    vignetteColour: '#080c17',
    bloom: 0.46,
    bloomThreshold: 0.66,
    exposure: 0.92,
    contrast: 0.36,
    saturation: 0.86,
    hazeColour: '#2b3a58',
    hazeStrength: 0.58,
  },

  /** A brass reading lamp just off-frame left: pooled warm light. */
  'lamplit-desk': {
    ...DEFAULT_LIGHT_RIG,
    id: 'lamplit-desk',
    label: 'Lamplit desk',
    keyAngle: Math.PI * 0.3,
    keyColour: '#ffd9a0',
    keyIntensity: 1.05,
    hotSpot: 0.66,
    fillColour: '#6a7ba0',
    fillIntensity: 0.22,
    ambientColour: '#3a2e24',
    ambientLevel: 0.26,
    ambientOcclusion: 0.8,
    shadowColour: '#211609',
    contactStrength: 1.05,
    rimStrength: 0.86,
    rimColour: '#ffeec4',
    shafts: [
      {
        origin: { x: -0.05, y: 0.06 },
        angle: Math.PI * 0.26,
        width: 0.2,
        length: 1.4,
        softness: 0.88,
        opacity: 0.14,
        spread: 1.8,
        dust: 0.42,
      },
    ],
    temperatureShift: 0.7,
    vignette: 0.55,
    bloom: 0.5,
    bloomThreshold: 0.68,
    contrast: 0.32,
    saturation: 1.1,
    hazeStrength: 0.5,
  },

  /** Storm light: cold, high-contrast, a hard blade of sun through cloud. */
  stormlight: {
    ...DEFAULT_LIGHT_RIG,
    id: 'stormlight',
    label: 'Stormlight',
    keyAngle: Math.PI * 0.82,
    keyColour: '#e6ecf6',
    keyIntensity: 1.25,
    hotSpot: 0.85,
    fillColour: '#4d5f7d',
    fillIntensity: 0.2,
    ambientColour: '#2b3138',
    ambientLevel: 0.22,
    ambientOcclusion: 0.88,
    shadowColour: '#141920',
    contactStrength: 1.2,
    rimStrength: 1.1,
    rimColour: '#ffffff',
    rimSharpness: 3.6,
    shafts: [
      {
        origin: { x: 0.92, y: -0.08 },
        angle: Math.PI * 0.78,
        width: 0.09,
        length: 1.7,
        softness: 0.42,
        opacity: 0.3,
        spread: 1.35,
        dust: 0.5,
      },
    ],
    temperatureShift: -0.24,
    vignette: 0.58,
    vignetteColour: '#0e1319',
    bloom: 0.6,
    bloomThreshold: 0.62,
    exposure: 1.0,
    contrast: 0.46,
    saturation: 0.92,
    hazeColour: '#54637a',
    hazeStrength: 0.6,
  },

  /** Neon: magenta key, cyan fill, the complementary clash done deliberately. */
  'neon-arcade': {
    ...DEFAULT_LIGHT_RIG,
    id: 'neon-arcade',
    label: 'Neon arcade',
    keyAngle: Math.PI * 0.72,
    keyColour: '#ff5fb0',
    keyIntensity: 1.1,
    hotSpot: 0.8,
    fillColour: '#38e8ff',
    fillIntensity: 0.42,
    ambientColour: '#1a1030',
    ambientLevel: 0.24,
    ambientOcclusion: 0.82,
    shadowColour: '#120a24',
    contactStrength: 1.1,
    rimStrength: 1.2,
    rimColour: '#8ff6ff',
    rimSharpness: 3.4,
    shafts: [
      {
        origin: { x: 0.9, y: -0.05 },
        angle: Math.PI * 0.74,
        width: 0.14,
        length: 1.5,
        softness: 0.7,
        opacity: 0.22,
        spread: 1.7,
        dust: 0.6,
      },
      {
        origin: { x: 0.1, y: -0.05 },
        angle: Math.PI * 0.34,
        width: 0.1,
        length: 1.3,
        softness: 0.8,
        opacity: 0.16,
        colour: '#38e8ff',
        spread: 1.9,
        dust: 0.4,
      },
    ],
    temperatureShift: 0.1,
    vignette: 0.62,
    vignetteColour: '#0d0620',
    bloom: 0.8,
    bloomThreshold: 0.55,
    exposure: 1.0,
    contrast: 0.4,
    saturation: 1.3,
    hazeColour: '#3a2258',
    hazeStrength: 0.55,
  },

  /** Underwater: green-blue key from above, everything hazed and soft. */
  'reef-caustics': {
    ...DEFAULT_LIGHT_RIG,
    id: 'reef-caustics',
    label: 'Reef caustics',
    keyAngle: Math.PI * 0.56,
    keyColour: '#bff3ea',
    keyIntensity: 0.95,
    hotSpot: 0.55,
    fillColour: '#2f7fa8',
    fillIntensity: 0.5,
    ambientColour: '#123a4c',
    ambientLevel: 0.4,
    ambientOcclusion: 0.62,
    shadowColour: '#0b2634',
    contactStrength: 0.8,
    rimStrength: 0.7,
    rimColour: '#e6fffb',
    shafts: [
      {
        origin: { x: 0.3, y: -0.06 },
        angle: Math.PI * 0.54,
        width: 0.11,
        length: 1.6,
        softness: 0.85,
        opacity: 0.2,
        spread: 2.2,
        dust: 0.85,
      },
      {
        origin: { x: 0.62, y: -0.06 },
        angle: Math.PI * 0.5,
        width: 0.08,
        length: 1.5,
        softness: 0.9,
        opacity: 0.16,
        spread: 2.4,
        dust: 0.7,
      },
      {
        origin: { x: 0.86, y: -0.06 },
        angle: Math.PI * 0.58,
        width: 0.13,
        length: 1.4,
        softness: 0.86,
        opacity: 0.14,
        spread: 2,
        dust: 0.6,
      },
    ],
    temperatureShift: -0.42,
    vignette: 0.48,
    vignetteColour: '#07202c',
    bloom: 0.44,
    bloomThreshold: 0.7,
    exposure: 1.0,
    contrast: 0.2,
    saturation: 1.04,
    hazeColour: '#2a7390',
    hazeStrength: 0.82,
  },

  /** A forge/hearth from below-right: dramatic uplight, sooty shadows. */
  'ember-forge': {
    ...DEFAULT_LIGHT_RIG,
    id: 'ember-forge',
    label: 'Ember forge',
    keyAngle: Math.PI * 1.32,
    keyColour: '#ff8a3d',
    keyIntensity: 1.2,
    hotSpot: 0.86,
    fillColour: '#3c4d76',
    fillIntensity: 0.18,
    ambientColour: '#241812',
    ambientLevel: 0.16,
    ambientOcclusion: 0.92,
    shadowColour: '#150b06',
    contactStrength: 1.2,
    rimStrength: 1.15,
    rimColour: '#ffc06a',
    rimSharpness: 3,
    shafts: [],
    temperatureShift: 0.9,
    vignette: 0.7,
    vignetteColour: '#100704',
    bloom: 0.72,
    bloomThreshold: 0.58,
    exposure: 0.96,
    contrast: 0.5,
    saturation: 1.22,
    hazeColour: '#4d2a16',
    hazeStrength: 0.7,
  },

  /** Pale pink dawn with heavy mist — the softest rig in the set. */
  'dawn-mist': {
    ...DEFAULT_LIGHT_RIG,
    id: 'dawn-mist',
    label: 'Dawn mist',
    keyAngle: Math.PI * 0.86,
    keyColour: '#ffd8d0',
    keyIntensity: 0.8,
    hotSpot: 0.45,
    fillColour: '#a9b8d8',
    fillIntensity: 0.48,
    ambientColour: '#6b6472',
    ambientLevel: 0.5,
    ambientOcclusion: 0.5,
    shadowColour: '#3b3542',
    contactStrength: 0.7,
    rimStrength: 0.55,
    rimColour: '#fff2ec',
    shafts: [
      {
        origin: { x: 1.02, y: 0.14 },
        angle: Math.PI * 0.88,
        width: 0.3,
        length: 1.5,
        softness: 0.95,
        opacity: 0.2,
        spread: 1.4,
        dust: 0.9,
      },
    ],
    temperatureShift: 0.3,
    vignette: 0.26,
    vignetteColour: '#3a3040',
    bloom: 0.55,
    bloomThreshold: 0.64,
    exposure: 1.06,
    contrast: 0.14,
    saturation: 0.94,
    hazeColour: '#b0a8b8',
    hazeStrength: 0.9,
  },

  /** Blazing midday: the highest-contrast, most blown-out rig we ship. */
  'noon-blaze': {
    ...DEFAULT_LIGHT_RIG,
    id: 'noon-blaze',
    label: 'Noon blaze',
    keyAngle: Math.PI * 0.52,
    keyColour: '#fff6d8',
    keyIntensity: 1.35,
    hotSpot: 0.92,
    fillColour: '#8fa6c8',
    fillIntensity: 0.26,
    ambientColour: '#4d4235',
    ambientLevel: 0.3,
    ambientOcclusion: 0.84,
    shadowColour: '#241b12',
    contactStrength: 1.25,
    groundFlatten: 0.24,
    rimStrength: 0.9,
    rimColour: '#ffffff',
    rimSharpness: 3.8,
    shafts: [
      {
        origin: { x: 0.55, y: -0.08 },
        angle: Math.PI * 0.52,
        width: 0.26,
        length: 1.7,
        softness: 0.6,
        opacity: 0.16,
        spread: 1.3,
        dust: 0.65,
      },
    ],
    temperatureShift: 0.42,
    vignette: 0.5,
    bloom: 0.75,
    bloomThreshold: 0.6,
    exposure: 1.05,
    contrast: 0.44,
    saturation: 1.12,
    hazeStrength: 0.36,
  },
};

/** Ids of every shipped rig, for pickers. */
export const LIGHT_RIG_IDS: readonly string[] = Object.keys(LIGHT_RIGS);

/** Look a rig up by id, falling back to the house default. */
export function getLightRig(id: string | undefined): LightRig {
  if (typeof id !== 'string') return DEFAULT_LIGHT_RIG;
  return LIGHT_RIGS[id] ?? DEFAULT_LIGHT_RIG;
}

/* ------------------------------ normalization ----------------------------- */

function n(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim().length > 0 ? v : fallback;
}

/** Normalize one shaft spec, filling every field. Total. */
export function resolveShaft(raw: Partial<ShaftSpec> | undefined, base?: ShaftSpec): ShaftSpec {
  const b = base ?? {
    origin: { x: 0.85, y: -0.05 },
    angle: KEY_ANGLE.upperRight,
    width: 0.15,
    length: 1.4,
    softness: 0.75,
    opacity: 0.18,
    spread: 1.6,
    dust: 0.5,
  };
  const o = raw?.origin;
  return {
    origin: {
      x: n(o?.x, b.origin.x, -1, 2),
      y: n(o?.y, b.origin.y, -1, 2),
    },
    angle: n(raw?.angle, b.angle),
    width: n(raw?.width, b.width, 0.005, 2),
    length: n(raw?.length, b.length, 0.02, 4),
    softness: n(raw?.softness, b.softness, 0, 1),
    opacity: n(raw?.opacity, b.opacity, 0, 1),
    ...(raw?.colour !== undefined || b.colour !== undefined
      ? { colour: str(raw?.colour, b.colour ?? '#ffffff') }
      : {}),
    spread: n(raw?.spread, b.spread ?? 1.6, 0.2, 6),
    dust: n(raw?.dust, b.dust ?? 0, 0, 1),
  };
}

/**
 * Fill a partial rig into a complete one, on top of `base` (the house rig by
 * default). Total: junk fields fall back rather than throwing, so a rig can be
 * read straight out of theme JSON.
 */
export function resolveLightRig(input?: LightRigInput, base: LightRig = DEFAULT_LIGHT_RIG): LightRig {
  const i = (input ?? {}) as Record<string, unknown>;
  const shafts: ShaftSpec[] = Array.isArray(input?.shafts)
    ? (input.shafts as readonly Partial<ShaftSpec>[]).map((s, k) =>
        resolveShaft(s, base.shafts[k] as ShaftSpec | undefined),
      )
    : [...base.shafts];

  return {
    id: str(i.id, base.id),
    label: str(i.label, base.label),
    keyAngle: n(i.keyAngle, base.keyAngle),
    keyColour: str(i.keyColour, base.keyColour),
    keyIntensity: n(i.keyIntensity, base.keyIntensity, 0, 2),
    hotSpot: n(i.hotSpot, base.hotSpot, 0, 1),
    fillColour: str(i.fillColour, base.fillColour),
    fillIntensity: n(i.fillIntensity, base.fillIntensity, 0, 1),
    ambientColour: str(i.ambientColour, base.ambientColour),
    ambientLevel: n(i.ambientLevel, base.ambientLevel, 0, 1),
    ambientOcclusion: n(i.ambientOcclusion, base.ambientOcclusion, 0, 1),
    shadowColour: str(i.shadowColour, base.shadowColour),
    contactStrength: n(i.contactStrength, base.contactStrength, 0, 1.5),
    groundFlatten: n(i.groundFlatten, base.groundFlatten, 0.05, 1),
    rimStrength: n(i.rimStrength, base.rimStrength, 0, 1.5),
    rimColour: str(i.rimColour, base.rimColour),
    rimSharpness: n(i.rimSharpness, base.rimSharpness, 0.1, 12),
    shafts,
    temperatureShift: n(i.temperatureShift, base.temperatureShift, -1, 1),
    vignette: n(i.vignette, base.vignette, 0, 1),
    vignetteColour: str(i.vignetteColour, base.vignetteColour),
    vignetteRoundness: n(i.vignetteRoundness, base.vignetteRoundness, 0, 1),
    bloom: n(i.bloom, base.bloom, 0, 1),
    bloomThreshold: n(i.bloomThreshold, base.bloomThreshold, 0, 1),
    exposure: n(i.exposure, base.exposure, 0.2, 3),
    contrast: n(i.contrast, base.contrast, 0, 1),
    saturation: n(i.saturation, base.saturation, 0, 2),
    hazeColour: str(i.hazeColour, base.hazeColour),
    hazeStrength: n(i.hazeStrength, base.hazeStrength, 0, 1),
  };
}

/**
 * Derive a per-object rig variation from a seed: tiny jitters to angle and
 * intensity so a row of thirty books is not lit by thirty identical suns.
 * Deterministic; the deltas are small enough that the room still reads as one
 * light source.
 */
export function jitterRig(rig: LightRig, seed: number, amount = 1): LightRig {
  const rnd = mulberry32((seed ^ 0x11617) >>> 0);
  const k = clamp(amount, 0, 2);
  return {
    ...rig,
    keyAngle: rig.keyAngle + (rnd() * 2 - 1) * 0.06 * k,
    keyIntensity: clamp(rig.keyIntensity * (1 + (rnd() * 2 - 1) * 0.07 * k), 0, 2),
    rimStrength: clamp(rig.rimStrength * (1 + (rnd() * 2 - 1) * 0.14 * k), 0, 1.5),
    ambientOcclusion: clamp(rig.ambientOcclusion * (1 + (rnd() * 2 - 1) * 0.08 * k), 0, 1),
  };
}

/* ========================================================================== *
 *                              canvas plumbing                               *
 * ========================================================================== */

function makeLightCanvas(w: number, h: number): LightCanvas {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(cw, ch);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return c;
}

function ctxOf(c: LightCanvas): LightCtx | null {
  const ctx = (c as OffscreenCanvas).getContext('2d');
  return (ctx as LightCtx | null) ?? null;
}

/** True when the runtime supports `ctx.filter` (Chrome does; some do not). */
function supportsFilter(ctx: LightCtx): boolean {
  return typeof (ctx as { filter?: unknown }).filter === 'string';
}

/**
 * Blur helper: uses `ctx.filter` where available, otherwise fakes a blur with
 * a small ring of offset draws at reduced alpha. Never throws.
 */
function blurredDraw(
  ctx: LightCtx,
  source: LightCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  if (radius <= 0.2) {
    ctx.drawImage(source, x, y, w, h);
    return;
  }
  if (supportsFilter(ctx)) {
    const prev = ctx.filter;
    ctx.filter = `blur(${radius.toFixed(2)}px)`;
    ctx.drawImage(source, x, y, w, h);
    ctx.filter = prev;
    return;
  }
  const prevAlpha = ctx.globalAlpha;
  const ring = 8;
  ctx.globalAlpha = prevAlpha / (ring + 1);
  ctx.drawImage(source, x, y, w, h);
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    ctx.drawImage(source, x + Math.cos(a) * radius, y + Math.sin(a) * radius, w, h);
  }
  ctx.globalAlpha = prevAlpha;
}

/* ========================================================================== *
 *                             pass: contact shadow                           *
 * ========================================================================== */

/** Which way a contact shadow spills away from the contact line. */
export type ContactSide = 'below' | 'above' | 'left' | 'right';

export interface ContactShadowOptions {
  /** The rig. Defaults to the house rig. */
  rig?: LightRig;
  /** Contact line start, canvas px. */
  x: number;
  /** Contact line's y (for horizontal contacts) — the surface it lands on. */
  y: number;
  /** Length of the contact, canvas px (width for `below`/`above`). */
  length: number;
  /** How far the shadow spills away from the contact, canvas px. */
  depth: number;
  /** Direction the shadow spills. Default `'below'`. */
  side?: ContactSide;
  /** Extra darkness multiplier on top of the rig's `contactStrength`. */
  strength?: number;
  /**
   * Gap between the two surfaces, canvas px. A book standing flush has 0; one
   * pulled proud has a few px, which widens and softens the shadow.
   */
  gap?: number;
  /**
   * Push the shadow along the key direction by this many px. Contact shadows
   * are *mostly* symmetric (they come from occluded ambient, not from the
   * key), so keep this small — 10–25% of `depth` reads right.
   */
  skew?: number;
  /** Round the ends of the contact so it does not read as a printed bar. */
  taper?: number;
  /** Shadow colour override. */
  colour?: string;
}

/**
 * **The contact shadow.** A short, soft, dark shadow at the point where one
 * object touches another — the spec's single highest-value addition.
 *
 * Three stacked gradients: a tight near-opaque core right at the contact, a
 * mid falloff, and a wide haze. Stacking is what stops it reading as a printed
 * grey bar; a single gradient always does.
 *
 * The pass is *additive to whatever is underneath* (it multiplies), so it can
 * be called on already-finished artwork.
 */
export function castContactShadow(ctx: LightCtx, opts: ContactShadowOptions): void {
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const side: ContactSide = opts.side ?? 'below';
  const len = Math.max(0, opts.length);
  if (len <= 0) return;
  const gap = Math.max(0, opts.gap ?? 0);
  const spread = contactShadowSpread(len, gap);
  const depth = Math.max(1, opts.depth) + spread * 0.35;
  const strength = clamp((opts.strength ?? 1) * rig.contactStrength, 0, 2);
  if (strength <= 0.001) return;
  const base = opts.colour ?? rig.shadowColour;
  // Contact shadows are the coolest thing in the frame: the key never reaches
  // them, so only fill light does, and fill is always the cool complement.
  const tinted = shiftTemperature(
    mixColour(base, rig.fillColour, rig.fillIntensity * 0.22),
    -rig.temperatureShift * 0.55,
  );
  const skew = opts.skew ?? depth * 0.18;
  const dir = keyDirection(rig);

  const horizontal = side === 'below' || side === 'above';
  const sign = side === 'below' || side === 'right' ? 1 : -1;

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';

  // Three passes: core (dark, tight), body, haze (wide, faint).
  const passes: ReadonlyArray<readonly [number, number]> = [
    [0.3, 1],
    [0.72, 0.52],
    [1, 0.24],
  ];

  for (const [reach, alphaK] of passes) {
    const d = depth * reach;
    const ox = dir.x * skew * reach;
    const oy = dir.y * skew * reach * rig.groundFlatten;
    let grad: CanvasGradient;
    if (horizontal) {
      grad = ctx.createLinearGradient(0, opts.y, 0, opts.y + sign * d);
    } else {
      grad = ctx.createLinearGradient(opts.x, 0, opts.x + sign * d, 0);
    }
    const a = clamp(0.55 * strength * alphaK, 0, 1);
    grad.addColorStop(0, withAlpha(tinted, a));
    grad.addColorStop(0.34, withAlpha(tinted, a * 0.5));
    grad.addColorStop(0.68, withAlpha(tinted, a * 0.16));
    grad.addColorStop(1, withAlpha(tinted, 0));
    ctx.fillStyle = grad;

    // Taper the ends so the shadow does not stop dead — real contact shadows
    // wrap around the object's corners.
    const taper = clamp(opts.taper ?? Math.min(len * 0.16, spread * 1.6), 0, len * 0.45);
    ctx.save();
    ctx.beginPath();
    if (horizontal) {
      const x0 = opts.x - spread * 0.4 + ox;
      const x1 = opts.x + len + spread * 0.4 + ox;
      const y0 = opts.y + oy;
      const y1 = y0 + sign * d;
      ctx.moveTo(x0 + taper, y0);
      ctx.lineTo(x1 - taper, y0);
      ctx.quadraticCurveTo(x1, y0, x1, y1);
      ctx.lineTo(x0, y1);
      ctx.quadraticCurveTo(x0, y0, x0 + taper, y0);
    } else {
      const y0 = opts.y - spread * 0.4 + oy;
      const y1 = opts.y + len + spread * 0.4 + oy;
      const x0 = opts.x + ox;
      const x1 = x0 + sign * d;
      ctx.moveTo(x0, y0 + taper);
      ctx.lineTo(x0, y1 - taper);
      ctx.quadraticCurveTo(x0, y1, x1, y1);
      ctx.lineTo(x1, y0);
      ctx.quadraticCurveTo(x0, y0, x0, y0 + taper);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

/* ========================================================================== *
 *                          pass: projected cast shadow                       *
 * ========================================================================== */

export interface ObjectShadowOptions {
  rig?: LightRig;
  /** Object footprint on the receiving plane: left edge, canvas px. */
  x: number;
  /** The plane the shadow lands on, canvas px. */
  y: number;
  /** Footprint width. */
  width: number;
  /** Object height above the plane — sets how long the shadow is. */
  height: number;
  /** Extra darkness. */
  strength?: number;
  /** Softness of the far end, 0–1. Shadows always soften with distance. */
  softness?: number;
  /** Shadow colour override. */
  colour?: string;
}

/**
 * A longer, directional shadow thrown by an object standing on a plane —
 * complements {@link castContactShadow}, which handles only the tight dark
 * line at the join. Use both: contact first, then this.
 *
 * The shadow is a sheared quad, dark and fairly crisp at the object's foot and
 * fading as it runs out — the painterly approximation of an area light.
 */
export function castObjectShadow(ctx: LightCtx, opts: ObjectShadowOptions): void {
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const w = Math.max(0, opts.width);
  if (w <= 0 || opts.height <= 0) return;
  const strength = clamp((opts.strength ?? 1) * rig.contactStrength, 0, 2);
  if (strength <= 0.001) return;
  const off = shadowOffset(rig, opts.height);
  const soft = clamp(opts.softness ?? 0.6, 0, 1);
  const colour = shiftTemperature(
    mixColour(opts.colour ?? rig.shadowColour, rig.fillColour, rig.fillIntensity * 0.3),
    -rig.temperatureShift * 0.5,
  );

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';

  const steps = 4;
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    const ex = off.x * t;
    const ey = Math.abs(off.y) * t;
    const a = clamp(0.3 * strength * (1 - t * 0.72) * (1 - soft * 0.32), 0, 1);
    const g = ctx.createLinearGradient(opts.x, opts.y, opts.x + ex, opts.y + ey);
    g.addColorStop(0, withAlpha(colour, a));
    g.addColorStop(0.5, withAlpha(colour, a * 0.42));
    g.addColorStop(1, withAlpha(colour, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(opts.x, opts.y);
    ctx.lineTo(opts.x + w, opts.y);
    ctx.lineTo(opts.x + w + ex, opts.y + ey);
    ctx.lineTo(opts.x + ex, opts.y + ey);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/* ========================================================================== *
 *                           pass: ambient occlusion                          *
 * ========================================================================== */

export interface AmbientOcclusionOptions {
  rig?: LightRig;
  /** Region to occlude, canvas px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Which edges are recessed. Default: all four (a box inside a case). Pass a
   * subset for a joint — e.g. `['left','right']` for a book between neighbours.
   */
  edges?: readonly ('top' | 'bottom' | 'left' | 'right')[];
  /** How far in from each edge the darkening reaches, canvas px. */
  reach?: number;
  /** Extra darkness on top of the rig's `ambientOcclusion`. */
  strength?: number;
  /** Falloff curve into the recess. Default `'smoother'`. */
  curve?: FalloffCurve;
  /** Also darken the four corners extra (corners occlude from two sides). */
  corners?: boolean;
}

/**
 * Ambient occlusion: darken where a surface is shielded from the sky.
 *
 * This is the pass that gives the reference its "deep occlusion — the back of
 * the case falls to near-black". Apply it in every recess and joint *before*
 * the key light, so the key can still hit the parts that face it.
 */
export function applyAmbientOcclusion(ctx: LightCtx, opts: AmbientOcclusionOptions): void {
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const { x, y, width: w, height: h } = opts;
  if (w <= 0 || h <= 0) return;
  const strength = clamp((opts.strength ?? 1) * rig.ambientOcclusion, 0, 2);
  if (strength <= 0.001) return;
  const edges = opts.edges ?? (['top', 'bottom', 'left', 'right'] as const);
  const reach = opts.reach ?? Math.min(w, h) * 0.4;
  const curve = opts.curve ?? 'smoother';
  const colour = shiftTemperature(rig.shadowColour, -rig.temperatureShift * 0.6);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'multiply';

  // Sampling the falloff curve into gradient stops keeps every curve in
  // `FalloffCurve` usable here, not just the two canvas can express natively.
  const stops = 7;
  const addStops = (g: CanvasGradient, peak: number): void => {
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;
      g.addColorStop(t, withAlpha(colour, clamp(peak * falloff(t, curve), 0, 1)));
    }
  };

  const peak = clamp(0.62 * strength, 0, 0.95);

  for (const edge of edges) {
    let g: CanvasGradient;
    let rect: readonly [number, number, number, number];
    const rw = Math.min(reach, w);
    const rh = Math.min(reach, h);
    switch (edge) {
      case 'top':
        g = ctx.createLinearGradient(0, y, 0, y + rh);
        rect = [x, y, w, rh];
        break;
      case 'bottom':
        g = ctx.createLinearGradient(0, y + h, 0, y + h - rh);
        rect = [x, y + h - rh, w, rh];
        break;
      case 'left':
        g = ctx.createLinearGradient(x, 0, x + rw, 0);
        rect = [x, y, rw, h];
        break;
      default:
        g = ctx.createLinearGradient(x + w, 0, x + w - rw, 0);
        rect = [x + w - rw, y, rw, h];
        break;
    }
    addStops(g, peak);
    ctx.fillStyle = g;
    ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
  }

  if (opts.corners !== false) {
    const cr = Math.min(reach * 1.15, Math.min(w, h) * 0.7);
    for (const [cx, cy] of [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ] as const) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      addStops(g, peak * 0.62);
      ctx.fillStyle = g;
      ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
    }
  }

  ctx.restore();
}

/**
 * A single AO *crease*: the dark line where two planes meet at an angle (a
 * plank meeting the back panel, a board meeting the spine). Cheaper and more
 * precise than a full-rect AO when you know exactly where the joint is.
 */
export function applyCreaseOcclusion(
  ctx: LightCtx,
  opts: {
    rig?: LightRig;
    /** Crease start. */
    x: number;
    y: number;
    /** Crease length. */
    length: number;
    /** Crease direction: `'horizontal'` or `'vertical'`. */
    axis: 'horizontal' | 'vertical';
    /** How far the darkening reaches to each side. */
    reach: number;
    strength?: number;
    /** Bias the darkening to one side (-1 → 1). 0 = symmetric. */
    bias?: number;
  },
): void {
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const strength = clamp((opts.strength ?? 1) * rig.ambientOcclusion, 0, 2);
  if (strength <= 0.001 || opts.length <= 0 || opts.reach <= 0) return;
  const colour = shiftTemperature(rig.shadowColour, -rig.temperatureShift * 0.5);
  const bias = clamp(opts.bias ?? 0, -1, 1);
  const near = opts.reach * (1 - bias * 0.6);
  const far = opts.reach * (1 + bias * 0.6);

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const g =
    opts.axis === 'horizontal'
      ? ctx.createLinearGradient(0, opts.y - near, 0, opts.y + far)
      : ctx.createLinearGradient(opts.x - near, 0, opts.x + far, 0);
  const peak = clamp(0.55 * strength, 0, 0.92);
  g.addColorStop(0, withAlpha(colour, 0));
  g.addColorStop(0.32, withAlpha(colour, peak * 0.28));
  g.addColorStop(near / (near + far), withAlpha(colour, peak));
  g.addColorStop(0.72, withAlpha(colour, peak * 0.24));
  g.addColorStop(1, withAlpha(colour, 0));
  ctx.fillStyle = g;
  if (opts.axis === 'horizontal') {
    ctx.fillRect(opts.x, opts.y - near, opts.length, near + far);
  } else {
    ctx.fillRect(opts.x - near, opts.y, near + far, opts.length);
  }
  ctx.restore();
}

/* ========================================================================== *
 *                              pass: key light                               *
 * ========================================================================== */

export interface KeyLightOptions {
  rig?: LightRig;
  /** Region to light, canvas px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Extra intensity multiplier for this object. */
  intensity?: number;
  /**
   * The surface's dominant outward normal, radians. For a flat spine facing
   * the viewer this is undefined (use the frame gradient); for a cylinder or
   * a board turned away, pass the normal to modulate how much key it takes.
   */
  normalAngle?: number;
  /**
   * Add a hot spot where the key hits hardest. Defaults to the rig's
   * `hotSpot`; pass 0 to suppress it on a surface that should stay in gamut.
   */
  hotSpot?: number;
  /** Clip the pass to a caller-supplied path (already in ctx coordinates). */
  clip?: boolean;
}

/**
 * The key-light pass: a directional gradient across the region, warm on the
 * side facing the source, plus a blown-out hot spot where the light lands
 * hardest.
 *
 * Applied with `screen`, so it *adds* light without washing out the artwork's
 * own hue — the difference between "painted light" and "a white overlay".
 */
export function applyKeyLight(ctx: LightCtx, opts: KeyLightOptions): void {
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const { x, y, width: w, height: h } = opts;
  if (w <= 0 || h <= 0) return;
  let power = clamp((opts.intensity ?? 1) * rig.keyIntensity, 0, 2);
  if (opts.normalAngle !== undefined) power *= surfaceLambert(opts.normalAngle, rig);
  if (power <= 0.002) return;

  const src = keyToSource(rig);
  // Run the gradient from the far side of the region toward the source.
  const cx = x + w / 2;
  const cy = y + h / 2;
  const reach = Math.hypot(w, h) * 0.6;
  const x0 = cx - src.x * reach;
  const y0 = cy - src.y * reach;
  const x1 = cx + src.x * reach;
  const y1 = cy + src.y * reach;

  const warm = shiftTemperature(rig.keyColour, rig.temperatureShift * 0.5);
  const cool = shiftTemperature(rig.fillColour, -rig.temperatureShift * 0.7);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // 1. The lit gradient (screen — adds light).
  ctx.globalCompositeOperation = 'screen';
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const peak = clamp(0.42 * power, 0, 0.9);
  g.addColorStop(0, withAlpha(cool, 0));
  g.addColorStop(0.42, withAlpha(warm, peak * 0.16));
  g.addColorStop(0.74, withAlpha(warm, peak * 0.56));
  g.addColorStop(1, withAlpha(blowOut(warm, 0.3), peak));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  // 2. The shadow side (multiply — the light's *absence* is a cool tint, not
  //    just a lack of screen; this is what creates the temperature shift).
  ctx.globalCompositeOperation = 'multiply';
  const sg = ctx.createLinearGradient(x1, y1, x0, y0);
  const shade = clamp(0.4 * power * rig.ambientOcclusion, 0, 0.72);
  const shadowTone = shiftTemperature(
    mixColour(rig.shadowColour, rig.fillColour, rig.fillIntensity * 0.5),
    -rig.temperatureShift,
  );
  sg.addColorStop(0, withAlpha(shadowTone, 0));
  sg.addColorStop(0.55, withAlpha(shadowTone, shade * 0.32));
  sg.addColorStop(1, withAlpha(shadowTone, shade));
  ctx.fillStyle = sg;
  ctx.fillRect(x, y, w, h);

  // 3. The hot spot: a small blown-out kernel where the key actually lands.
  const hot = clamp(opts.hotSpot ?? rig.hotSpot, 0, 1) * power;
  if (hot > 0.02) {
    ctx.globalCompositeOperation = 'screen';
    const hx = cx + src.x * w * 0.42;
    const hy = cy + src.y * h * 0.42;
    const hr = Math.max(w, h) * (0.28 + hot * 0.3);
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
    const hotCol = blowOut(rig.keyColour, 0.72);
    hg.addColorStop(0, withAlpha(hotCol, clamp(hot * 0.55, 0, 0.85)));
    hg.addColorStop(0.4, withAlpha(hotCol, clamp(hot * 0.2, 0, 0.5)));
    hg.addColorStop(1, withAlpha(hotCol, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(x, y, w, h);
  }

  ctx.restore();
}

/**
 * Cylindrical shading for a round form (a raised cord, a stem, a rolled
 * spine). Returns the gradient rather than painting, so the caller can use it
 * as a fill for an arbitrary path.
 *
 * `axisAngle` is the direction the cylinder's *axis* runs; the shading runs
 * perpendicular to it.
 */
export function cylinderShading(
  ctx: LightCtx,
  rig: LightRig,
  cx: number,
  cy: number,
  radius: number,
  axisAngle: number,
): CanvasGradient {
  const perp = axisAngle + Math.PI / 2;
  const src = keyToSource(rig);
  // Project the light onto the shading axis so the crown lands on the lit side.
  const along = Math.cos(perp) * src.x + Math.sin(perp) * src.y;
  const px = Math.cos(perp) * radius;
  const py = Math.sin(perp) * radius;
  const s = along >= 0 ? 1 : -1;
  const g = ctx.createLinearGradient(cx - px * s, cy - py * s, cx + px * s, cy + py * s);
  const shadow = shiftTemperature(rig.shadowColour, -rig.temperatureShift * 0.7);
  const lit = blowOut(rig.keyColour, rig.hotSpot * 0.5);
  g.addColorStop(0, withAlpha(shadow, clamp(0.5 * rig.ambientOcclusion, 0, 0.8)));
  g.addColorStop(0.22, withAlpha(shadow, clamp(0.16 * rig.ambientOcclusion, 0, 0.4)));
  g.addColorStop(0.52, withAlpha(lit, clamp(0.34 * rig.keyIntensity, 0, 0.7)));
  g.addColorStop(0.72, withAlpha(lit, clamp(0.12 * rig.keyIntensity, 0, 0.35)));
  g.addColorStop(1, withAlpha(shadow, clamp(0.42 * rig.ambientOcclusion, 0, 0.75)));
  return g;
}

/* ========================================================================== *
 *                              pass: rim light                               *
 * ========================================================================== */

export interface RimLightOptions {
  rig?: LightRig;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rim thickness in px. Keep it thin — a fat rim reads as a border. */
  thickness?: number;
  /** Extra strength on top of the rig's `rimStrength`. */
  strength?: number;
  /**
   * Which edges exist to catch a rim. Default: the two that face the key,
   * computed from `keyAngle`.
   */
  edges?: readonly ('top' | 'bottom' | 'left' | 'right')[];
}

/** Which two box edges face the key, given its angle. */
export function litEdges(
  rig: Pick<LightRig, 'keyAngle'>,
): readonly ('top' | 'bottom' | 'left' | 'right')[] {
  const src = keyToSource(rig);
  const out: ('top' | 'bottom' | 'left' | 'right')[] = [];
  if (src.x > 0.15) out.push('right');
  if (src.x < -0.15) out.push('left');
  if (src.y > 0.15) out.push('bottom');
  if (src.y < -0.15) out.push('top');
  return out;
}

/**
 * Rim light: a thin hot line along the edges that face the key. The single
 * cheapest way to separate an object from the ground behind it — and, per the
 * spec, present on every leaf and spine edge facing the source in the
 * reference.
 */
export function applyRimLight(ctx: LightCtx, opts: RimLightOptions): void {
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const { x, y, width: w, height: h } = opts;
  if (w <= 0 || h <= 0) return;
  const strength = clamp((opts.strength ?? 1) * rig.rimStrength, 0, 2);
  if (strength <= 0.005) return;
  const t = Math.max(0.6, opts.thickness ?? Math.min(w, h) * 0.085);
  const edges = opts.edges ?? litEdges(rig);
  const colour = blowOut(rig.rimColour, 0.35);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'screen';

  for (const edge of edges) {
    // Grazing incidence: the more head-on the edge is to the key, the weaker
    // its rim (a rim is a *silhouette* effect).
    const normal =
      edge === 'right' ? 0 : edge === 'left' ? Math.PI : edge === 'top' ? -Math.PI / 2 : Math.PI / 2;
    const f = rimFactor(normal, { ...rig, rimStrength: 1 });
    const a = clamp(0.7 * strength * f, 0, 1);
    if (a < 0.01) continue;

    let g: CanvasGradient;
    let rect: readonly [number, number, number, number];
    switch (edge) {
      case 'top':
        g = ctx.createLinearGradient(0, y, 0, y + t);
        rect = [x, y, w, t];
        break;
      case 'bottom':
        g = ctx.createLinearGradient(0, y + h, 0, y + h - t);
        rect = [x, y + h - t, w, t];
        break;
      case 'left':
        g = ctx.createLinearGradient(x, 0, x + t, 0);
        rect = [x, y, t, h];
        break;
      default:
        g = ctx.createLinearGradient(x + w, 0, x + w - t, 0);
        rect = [x + w - t, y, t, h];
        break;
    }
    g.addColorStop(0, withAlpha(colour, a));
    g.addColorStop(0.28, withAlpha(colour, a * 0.52));
    g.addColorStop(0.62, withAlpha(colour, a * 0.14));
    g.addColorStop(1, withAlpha(colour, 0));
    ctx.fillStyle = g;
    ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
  }

  ctx.restore();
}

/**
 * A specular *catch* — the tight, bright, slightly elongated highlight a
 * polished surface (gold foil, a brass clasp, glazed leather) throws back at
 * the viewer. Not a rim and not a hot spot: this is the small hard glint.
 */
export function applySpecularCatch(
  ctx: LightCtx,
  opts: {
    rig?: LightRig;
    /** Centre of the highlight. */
    x: number;
    y: number;
    /** Radius along the highlight's long axis. */
    radius: number;
    /** How elongated it is (1 = round, 3 = a streak). */
    aspect?: number;
    /** Long-axis direction, radians. Defaults perpendicular to the key. */
    angle?: number;
    /** Peak alpha. */
    strength?: number;
    /** Highlight colour; defaults to the rig's rim colour blown out. */
    colour?: string;
  },
): void {
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const r = Math.max(0.4, opts.radius);
  const strength = clamp((opts.strength ?? 1) * (0.4 + rig.keyIntensity * 0.55), 0, 1.4);
  if (strength <= 0.01) return;
  const aspect = Math.max(0.2, opts.aspect ?? 2.2);
  const angle = opts.angle ?? rig.keyAngle + Math.PI / 2;
  const colour = blowOut(opts.colour ?? rig.rimColour, 0.6);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.translate(opts.x, opts.y);
  ctx.rotate(angle);
  ctx.scale(aspect, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, withAlpha(colour, clamp(0.85 * strength, 0, 1)));
  g.addColorStop(0.3, withAlpha(colour, clamp(0.4 * strength, 0, 1)));
  g.addColorStop(0.66, withAlpha(colour, clamp(0.12 * strength, 0, 1)));
  g.addColorStop(1, withAlpha(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

/* ========================================================================== *
 *                            pass: light shafts                              *
 * ========================================================================== */

export interface LightShaftOptions {
  rig?: LightRig;
  /** Overall opacity multiplier for the whole set. */
  strength?: number;
  /** Seed for the dust motes (deterministic). */
  seed?: number;
  /** Draw dust motes inside the shafts. Default true. */
  dust?: boolean;
}

/**
 * Volumetric light shafts ("god rays") crossing the frame — the spec's
 * headline atmospheric effect.
 *
 * Each shaft is drawn as a stack of soft-edged quads of decreasing opacity
 * along its length, then optionally seeded with dust motes that only exist
 * inside the beam. `screen` composite, so shafts add light over whatever is
 * beneath without hiding it.
 */
export function drawLightShafts(
  ctx: LightCtx,
  w: number,
  h: number,
  rig: LightRig = DEFAULT_LIGHT_RIG,
  opts: LightShaftOptions = {},
): void {
  if (w <= 0 || h <= 0 || rig.shafts.length === 0) return;
  const mult = clamp(opts.strength ?? 1, 0, 3);
  if (mult <= 0.001) return;
  const diag = Math.hypot(w, h);
  const rnd: RandomFn = mulberry32((opts.seed ?? 0x5a1f7d) >>> 0);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (const shaft of rig.shafts) {
    const ox = shaft.origin.x * w;
    const oy = shaft.origin.y * h;
    const dir: Vec2 = { x: Math.cos(shaft.angle), y: Math.sin(shaft.angle) };
    const perp: Vec2 = { x: -dir.y, y: dir.x };
    const len = shaft.length * diag;
    const w0 = shaft.width * diag;
    const w1 = w0 * (shaft.spread ?? 1.6);
    const colour = shiftTemperature(shaft.colour ?? rig.keyColour, rig.temperatureShift * 0.4);
    const peak = clamp(shaft.opacity * mult, 0, 1);

    // The beam body: a stack of narrowing/widening quads with a soft core.
    const layers = 5;
    for (let i = layers; i >= 1; i--) {
      const k = i / layers;
      // Outer layers are wider and fainter (that stacking IS the softness).
      const soft = 1 + shaft.softness * (k - 1) * -1.3;
      const a = peak * (1 - shaft.softness * 0.45) * (1 / layers) * (2.2 - k);
      const halfA = (w0 * soft) / 2;
      const halfB = (w1 * soft) / 2;
      const ex = ox + dir.x * len;
      const ey = oy + dir.y * len;

      const g = ctx.createLinearGradient(ox, oy, ex, ey);
      g.addColorStop(0, withAlpha(colour, clamp(a, 0, 1)));
      g.addColorStop(0.34, withAlpha(colour, clamp(a * 0.62, 0, 1)));
      g.addColorStop(0.72, withAlpha(colour, clamp(a * 0.22, 0, 1)));
      g.addColorStop(1, withAlpha(colour, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(ox + perp.x * halfA, oy + perp.y * halfA);
      ctx.lineTo(ox - perp.x * halfA, oy - perp.y * halfA);
      ctx.lineTo(ex - perp.x * halfB, ey - perp.y * halfB);
      ctx.lineTo(ex + perp.x * halfB, ey + perp.y * halfB);
      ctx.closePath();
      ctx.fill();
    }

    // Dust: motes only exist *inside* the beam, which is what sells it as
    // volume rather than a painted stripe.
    const dustAmount = opts.dust === false ? 0 : (shaft.dust ?? 0);
    if (dustAmount > 0.01) {
      const count = Math.round(dustAmount * 130);
      const mote = blowOut(colour, 0.5);
      for (let i = 0; i < count; i++) {
        const t = rnd();
        const across = (rnd() * 2 - 1) * 0.85;
        const halfHere = lerp(w0, w1, t) / 2;
        const px = ox + dir.x * len * t + perp.x * across * halfHere;
        const py = oy + dir.y * len * t + perp.y * across * halfHere;
        if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
        const r = (0.4 + rnd() * 1.5) * (1 + rnd() * rnd() * 2);
        const a = clamp(peak * (0.5 + rnd() * 1.6) * (1 - t * 0.6) * (1 - Math.abs(across) * 0.5), 0, 0.9);
        const mg = ctx.createRadialGradient(px, py, 0, px, py, r * 2.6);
        mg.addColorStop(0, withAlpha(mote, a));
        mg.addColorStop(0.4, withAlpha(mote, a * 0.35));
        mg.addColorStop(1, withAlpha(mote, 0));
        ctx.fillStyle = mg;
        ctx.fillRect(px - r * 2.6, py - r * 2.6, r * 5.2, r * 5.2);
      }
    }
  }

  ctx.restore();
}

/* ========================================================================== *
 *                                pass: bloom                                 *
 * ========================================================================== */

/**
 * Bloom: extract everything brighter than `rig.bloomThreshold`, blur it, and
 * screen it back over the frame.
 *
 * Implemented by downsampling to a scratch canvas (cheap blur for free), then
 * blurring and drawing back at full size. Threshold extraction uses a
 * `multiply`+`screen` sandwich rather than per-pixel maths so it stays fast on
 * large canvases.
 *
 * No-ops silently when a scratch canvas or 2D context is unavailable (node
 * unit tests), which is why every caller can apply it unconditionally.
 */
export function applyBloom(
  ctx: LightCtx,
  w: number,
  h: number,
  rig: LightRig = DEFAULT_LIGHT_RIG,
  opts: { strength?: number; source?: LightCanvas } = {},
): void {
  const strength = clamp((opts.strength ?? 1) * rig.bloom, 0, 2);
  if (strength <= 0.005 || w <= 2 || h <= 2) return;

  const scale = 0.28;
  const sw = Math.max(2, Math.round(w * scale));
  const sh = Math.max(2, Math.round(h * scale));

  let small: LightCanvas;
  let sctx: LightCtx | null;
  try {
    small = makeLightCanvas(sw, sh);
    sctx = ctxOf(small);
  } catch {
    return;
  }
  if (!sctx) return;

  // 1. Copy the frame down. `source` lets a caller pass the pre-composited
  //    canvas when `ctx` is not itself readable (e.g. mid-transform).
  const src = opts.source;
  try {
    if (src) {
      sctx.drawImage(src, 0, 0, sw, sh);
    } else {
      const own = (ctx as CanvasRenderingContext2D).canvas as unknown as LightCanvas | undefined;
      if (!own) return;
      sctx.drawImage(own, 0, 0, sw, sh);
    }
  } catch {
    return;
  }

  // 2. Threshold: crush everything below the knee toward black so only the
  //    hot spots survive to be blurred.
  const thr = clamp(rig.bloomThreshold, 0, 0.98);
  const crush = Math.round(thr * 255);
  sctx.globalCompositeOperation = 'multiply';
  sctx.fillStyle = `rgb(${crush}, ${crush}, ${crush})`;
  sctx.fillRect(0, 0, sw, sh);
  // Re-expand what is left so the surviving highlights keep their punch.
  sctx.globalCompositeOperation = 'screen';
  const lift = Math.round(thr * thr * 190);
  sctx.fillStyle = `rgb(${lift}, ${lift}, ${lift})`;
  sctx.globalAlpha = 0.4;
  sctx.fillRect(0, 0, sw, sh);
  sctx.globalAlpha = 1;
  sctx.globalCompositeOperation = 'multiply';
  sctx.fillStyle = 'rgb(70, 70, 70)';
  sctx.fillRect(0, 0, sw, sh);
  sctx.globalCompositeOperation = 'source-over';

  // 3. Tint toward the key colour — bloom is coloured by the light making it.
  sctx.globalCompositeOperation = 'multiply';
  sctx.fillStyle = withAlpha(blowOut(rig.keyColour, 0.35), 0.7);
  sctx.fillRect(0, 0, sw, sh);
  sctx.globalCompositeOperation = 'source-over';

  // 4. Screen it back, blurred, in two radii (tight glow + wide halo).
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = clamp(strength * 0.85, 0, 1);
  blurredDraw(ctx, small, 0, 0, w, h, Math.max(2, Math.min(w, h) * 0.012));
  ctx.globalAlpha = clamp(strength * 0.5, 0, 1);
  blurredDraw(ctx, small, -w * 0.02, -h * 0.02, w * 1.04, h * 1.04, Math.max(6, Math.min(w, h) * 0.045));
  ctx.restore();
}

/* ========================================================================== *
 *                               pass: vignette                               *
 * ========================================================================== */

/**
 * Vignette: darken toward the frame's corners, plus the spec's "soft-focus
 * falloff at frame edges" as a faint haze ring.
 */
export function applyVignette(
  ctx: LightCtx,
  w: number,
  h: number,
  rig: LightRig = DEFAULT_LIGHT_RIG,
  opts: { strength?: number; softFocus?: boolean } = {},
): void {
  const strength = clamp((opts.strength ?? 1) * rig.vignette, 0, 1.5);
  if (strength <= 0.004 || w <= 0 || h <= 0) return;
  const colour = shiftTemperature(rig.vignetteColour, -rig.temperatureShift * 0.5);

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';

  // Elliptical vignette, sampled from `vignetteFactor` so the shape matches
  // the pure helper the tests pin down.
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(cx, cy, r * 0.24, cx, cy, r * 1.02);
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Map the gradient's t back onto a diagonal sample position.
    const px = lerp(cx, w, t * 0.9);
    const py = lerp(cy, h, t * 0.9);
    const f = vignetteFactor(px, py, w, h, strength, rig.vignetteRoundness);
    g.addColorStop(t, withAlpha(colour, clamp(1 - f, 0, 1)));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // A rectangular assist so wide frames darken along their long edges too —
  // a purely radial vignette leaves the middle of a 3:1 shelf strip untouched.
  if (rig.vignetteRoundness > 0.05) {
    const edge = Math.min(w, h) * 0.32;
    const a = clamp(strength * rig.vignetteRoundness * 0.4, 0, 0.7);
    for (const [gx0, gy0, gx1, gy1, rx, ry, rw, rh] of [
      [0, 0, edge, 0, 0, 0, edge, h],
      [w, 0, w - edge, 0, w - edge, 0, edge, h],
      [0, 0, 0, edge, 0, 0, w, edge],
      [0, h, 0, h - edge, 0, h - edge, w, edge],
    ] as const) {
      const eg = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      eg.addColorStop(0, withAlpha(colour, a));
      eg.addColorStop(0.5, withAlpha(colour, a * 0.3));
      eg.addColorStop(1, withAlpha(colour, 0));
      ctx.fillStyle = eg;
      ctx.fillRect(rx, ry, rw, rh);
    }
  }

  ctx.restore();

  if (opts.softFocus !== false && strength > 0.15) {
    // Soft-focus falloff: a faint haze veil that only touches the outer band.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const hg = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.05);
    hg.addColorStop(0, withAlpha(rig.hazeColour, 0));
    hg.addColorStop(1, withAlpha(rig.hazeColour, clamp(strength * 0.14, 0, 0.3)));
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

/* ========================================================================== *
 *                             pass: colour grade                             *
 * ========================================================================== */

/**
 * The final grade: split-tone (cool shadows, warm highlights), a contrast
 * S-curve, saturation, and exposure.
 *
 * This is what makes a set of separately-drawn objects look like one painting.
 * Apply it last, over everything, at frame scale.
 */
export function applyColourGrade(
  ctx: LightCtx,
  w: number,
  h: number,
  rig: LightRig = DEFAULT_LIGHT_RIG,
  opts: { strength?: number } = {},
): void {
  if (w <= 0 || h <= 0) return;
  const k = clamp(opts.strength ?? 1, 0, 2);
  if (k <= 0.001) return;

  ctx.save();

  // 1. Split-tone. Shadows take the cool complement, highlights the warm key.
  const cool = shiftTemperature(rig.fillColour, -0.4);
  const warm = shiftTemperature(rig.keyColour, 0.25);
  const tone = clamp(Math.abs(rig.temperatureShift) * 0.5 * k, 0, 0.5);
  if (tone > 0.004) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = withAlpha(
      rig.temperatureShift >= 0 ? cool : warm,
      tone * 0.55,
    );
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = withAlpha(rig.temperatureShift >= 0 ? warm : cool, tone * 0.4);
    ctx.fillRect(0, 0, w, h);
  }

  // 2. Contrast S-curve, faked with a multiply/screen sandwich weighted by the
  //    mid grey — cheaper than a per-pixel LUT and visually indistinguishable
  //    at these strengths.
  const c = clamp(rig.contrast * k, 0, 1);
  if (c > 0.004) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(255, 250, 240, ${(1 - c * 0.26).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = `rgba(128, 126, 122, ${(c * 0.55).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }

  // 3. Saturation.
  const sat = rig.saturation;
  if (Math.abs(sat - 1) > 0.01) {
    ctx.globalCompositeOperation = 'saturation';
    // 'saturation' takes the S of the fill and the H/L of the backdrop, so a
    // grey fill desaturates and a vivid fill saturates.
    const s = clamp((sat - 1) * k, -1, 1);
    const pct = s >= 0 ? Math.round(50 + s * 50) : Math.round(50 + s * 50);
    ctx.globalAlpha = clamp(Math.abs(s) * 0.8, 0, 1);
    ctx.fillStyle = `hsl(30 ${clamp(pct, 0, 100)}% 50%)`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // 4. Exposure.
  const e = rig.exposure;
  if (Math.abs(e - 1) > 0.005) {
    if (e > 1) {
      ctx.globalCompositeOperation = 'screen';
      const lift = clamp((e - 1) * 0.5 * k, 0, 0.5);
      ctx.fillStyle = withAlpha(rig.keyColour, lift);
    } else {
      ctx.globalCompositeOperation = 'multiply';
      const drop = clamp((1 - e) * k, 0, 0.6);
      ctx.fillStyle = `rgba(255,255,255,${(1 - drop).toFixed(3)})`;
    }
    ctx.fillRect(0, 0, w, h);
  }

  ctx.restore();
}

/**
 * Atmospheric haze over a region — distant/recessed things lose contrast and
 * gain the room's haze colour. `depth` 0 = at the front plane, 1 = at the back
 * of the case.
 */
export function applyAtmosphericHaze(
  ctx: LightCtx,
  opts: {
    rig?: LightRig;
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
    strength?: number;
  },
): void {
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const a = atmosphericBlend(opts.depth, rig) * clamp(opts.strength ?? 1, 0, 2);
  if (a <= 0.004 || opts.width <= 0 || opts.height <= 0) return;
  ctx.save();
  // Haze lifts the blacks (screen) and mutes the colour (a grey multiply)
  // simultaneously — that pairing is what loses *contrast*, not just value.
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = withAlpha(rig.hazeColour, clamp(a * 0.42, 0, 0.7));
  ctx.fillRect(opts.x, opts.y, opts.width, opts.height);
  ctx.globalCompositeOperation = 'saturation';
  ctx.globalAlpha = clamp(a * 0.5, 0, 0.8);
  ctx.fillStyle = 'hsl(30 22% 50%)';
  ctx.fillRect(opts.x, opts.y, opts.width, opts.height);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Colour bleeding: let a neighbouring object's colour spill onto this one.
 * The reference has it everywhere — a red book warms the cream pages beside
 * it. Very low alpha; the effect should be felt, not seen.
 */
export function applyColourBleed(
  ctx: LightCtx,
  opts: {
    /** Region receiving the bleed. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** The neighbour's colour. */
    colour: string | RGBA;
    /** Which side the neighbour is on. */
    from: 'left' | 'right' | 'top' | 'bottom';
    /** How far the bleed reaches into the region, px. */
    reach?: number;
    /** Peak alpha, 0–1. Default 0.1 — keep it low. */
    strength?: number;
  },
): void {
  const { x, y, width: w, height: h } = opts;
  if (w <= 0 || h <= 0) return;
  const a = clamp(opts.strength ?? 0.1, 0, 0.6);
  if (a <= 0.003) return;
  const reach = Math.min(opts.reach ?? Math.min(w, h) * 0.45, opts.from === 'left' || opts.from === 'right' ? w : h);
  const col = typeof opts.colour === 'string' ? parseColour(opts.colour) : opts.colour;

  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  let g: CanvasGradient;
  let rect: readonly [number, number, number, number];
  switch (opts.from) {
    case 'left':
      g = ctx.createLinearGradient(x, 0, x + reach, 0);
      rect = [x, y, reach, h];
      break;
    case 'right':
      g = ctx.createLinearGradient(x + w, 0, x + w - reach, 0);
      rect = [x + w - reach, y, reach, h];
      break;
    case 'top':
      g = ctx.createLinearGradient(0, y, 0, y + reach);
      rect = [x, y, w, reach];
      break;
    default:
      g = ctx.createLinearGradient(0, y + h, 0, y + h - reach);
      rect = [x, y + h - reach, w, reach];
      break;
  }
  g.addColorStop(0, withAlpha(col, a));
  g.addColorStop(0.45, withAlpha(col, a * 0.4));
  g.addColorStop(1, withAlpha(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
  ctx.restore();
}

/* ========================================================================== *
 *                            the scene orchestrator                          *
 * ========================================================================== */

/**
 * What the caller's body gets: the rig plus every pass pre-bound to the frame,
 * so a body can, say, drop a contact shadow without repeating the rig.
 */
export interface LitSceneApi {
  rig: LightRig;
  width: number;
  height: number;
  contactShadow(opts: Omit<ContactShadowOptions, 'rig'>): void;
  objectShadow(opts: Omit<ObjectShadowOptions, 'rig'>): void;
  ao(opts: Omit<AmbientOcclusionOptions, 'rig'>): void;
  crease(opts: Omit<Parameters<typeof applyCreaseOcclusion>[1], 'rig'>): void;
  key(opts: Omit<KeyLightOptions, 'rig'>): void;
  rim(opts: Omit<RimLightOptions, 'rig'>): void;
  specular(opts: Omit<Parameters<typeof applySpecularCatch>[1], 'rig'>): void;
  haze(opts: Omit<Parameters<typeof applyAtmosphericHaze>[1], 'rig'>): void;
  probe(x01: number, y01: number): LightSample;
}

export interface RenderLitSceneOptions {
  /** Skip the ambient base fill (when the body paints its own ground). */
  skipAmbient?: boolean;
  /** Skip shafts / bloom / vignette / grade individually. */
  skipShafts?: boolean;
  skipBloom?: boolean;
  skipVignette?: boolean;
  skipGrade?: boolean;
  /** Seed for the shafts' dust. */
  seed?: number;
}

/**
 * Run the documented render order around a caller-supplied body:
 *
 * 1. ambient base
 * 2. *(body)* — which should do its own AO, contact shadows, key and rim per
 *    object, using the passed {@link LitSceneApi}
 * 3. light shafts
 * 4. bloom
 * 5. vignette
 * 6. colour grade
 *
 * The per-object passes live inside the body because only the body knows
 * where its objects are; the frame-wide passes live here because they must
 * run over the finished composite.
 */
export function renderLitScene(
  ctx: LightCtx,
  width: number,
  height: number,
  rig: LightRig,
  body: (api: LitSceneApi) => void,
  opts: RenderLitSceneOptions = {},
): void {
  const api: LitSceneApi = {
    rig,
    width,
    height,
    contactShadow: (o) => castContactShadow(ctx, { ...o, rig }),
    objectShadow: (o) => castObjectShadow(ctx, { ...o, rig }),
    ao: (o) => applyAmbientOcclusion(ctx, { ...o, rig }),
    crease: (o) => applyCreaseOcclusion(ctx, { ...o, rig }),
    key: (o) => applyKeyLight(ctx, { ...o, rig }),
    rim: (o) => applyRimLight(ctx, { ...o, rig }),
    specular: (o) => applySpecularCatch(ctx, { ...o, rig }),
    haze: (o) => applyAtmosphericHaze(ctx, { ...o, rig }),
    probe: (x01, y01) => lightProbe(rig, x01, y01),
  };

  if (opts.skipAmbient !== true) {
    ctx.save();
    ctx.fillStyle = rgbaToCss(
      scaleColour(
        mixColour(rig.ambientColour, rig.fillColour, rig.fillIntensity * 0.4),
        0.6 + rig.ambientLevel * 0.7,
      ),
    );
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  body(api);

  if (opts.skipShafts !== true) {
    drawLightShafts(ctx, width, height, rig, { seed: opts.seed ?? 0x5eed });
  }
  if (opts.skipBloom !== true) applyBloom(ctx, width, height, rig);
  if (opts.skipVignette !== true) applyVignette(ctx, width, height, rig);
  if (opts.skipGrade !== true) applyColourGrade(ctx, width, height, rig);
}
