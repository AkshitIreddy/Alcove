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
 * of it. Some knobs simply express themselves differently now: `material`
 * chooses between a coloured cloth and a pale parchment board rather than a
 * grain tile, and `wear` rounds the boards' corners rather than grinding dirt
 * into them.
 *
 * Bake-once: `coverDataUrl` memoizes the rendered PNG per
 * (seed+overrides+size+title) key so overlays and backdrops never re-paint.
 */

import type { CharmKind } from './charms';
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
/** Labels for the legacy `texture` bucket (see CoverParams.texture). */
export const COVER_TEXTURES = ['cloth', 'leather', 'paper'] as const;
export const COVER_FONTS = ['Caveat', 'Kalam', 'Patrick Hand'] as const;

export interface CoverParams {
  /** Seed the params were derived from (drives render-time jitter too). */
  seed: number;
  /**
   * Which cloth the boards are bound in. Twenty slots, inherited from the
   * spine's own palette roll, folded onto the six cloths in `FLAT`.
   */
  palette: number;
  /**
   * Legacy covering bucket: 0 = cloth, 1 = leather, 2 = paper. Kept because
   * `cover_meta` blobs in the wild carry it and `material` is derived from it,
   * but flat art has no grain, so it no longer changes a pixel by itself.
   */
  texture: 0 | 1 | 2;
  /** Frame style 0–3: rule / rule + corner dots / double rule / rule + lozenges. */
  frame: number;
  /** Center medallion variant 0–7 (spine ornament vocabulary). */
  medallion: number;
  /** Title face: 0 = Caveat, 1 = Kalam, 2 = Patrick Hand. */
  titleFont: 0 | 1 | 2;
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
  /** Index into charms.CHARM_COLORS. */
  charmColor?: number;
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
  const texture = int(source.texture, 3);
  if (texture !== undefined) out.texture = texture as 0 | 1 | 2;
  const frame = int(source.frame, COVER_FRAME_COUNT);
  if (frame !== undefined) out.frame = frame;
  const medallion = int(source.medallion, COVER_MEDALLION_COUNT);
  if (medallion !== undefined) out.medallion = medallion;
  const titleFont = int(source.titleFont, 3);
  if (titleFont !== undefined) out.titleFont = titleFont as 0 | 1 | 2;
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
  const derived: CoverParams = {
    seed: seed >>> 0,
    palette: spine.palette,
    texture: spine.texture,
    frame: Math.floor(rnd() * COVER_FRAME_COUNT),
    // The spine ornament vocabulary can outgrow the cover's 8 medallions
    // (it is 12 stamps wide today) — fold it back into range.
    medallion: spine.ornament % COVER_MEDALLION_COUNT,
    titleFont: spine.font,
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
  return merged;
}

/* --------------------------------- colors -------------------------------- */

/** Bindings that are pale board rather than dyed cloth. */
const PALE_BINDINGS: ReadonlySet<BindingMaterial> = new Set<BindingMaterial>(['vellum', 'paper']);

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
function clothFor(palette: number): readonly [string, string] {
  const slot = clothForPalette(palette);
  return (CLOTHS[slot] ?? CLOTHS[0]!) as readonly [string, string];
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

/**
 * The eight charm colourways, index-aligned with `charms.CHARM_COLORS` so a
 * book keeps the colour it was saved with. Each is a flat pair: the ribbon
 * face and the darker tone its knot and tail turn away in.
 */
const CHARM_CLOTHS: readonly (readonly [string, string])[] = [
  [FLAT.terracotta, FLAT.terracottaDark], // crimson
  [FLAT.moss, FLAT.mossDark], // forest
  [FLAT.slate, FLAT.slateDark], // navy
  [FLAT.cream, FLAT.creamDeep], // cream
  [FLAT.gilt, FLAT.ochreDark], // gold
  [FLAT.plum, FLAT.plumDark], // plum
  [FLAT.ochre, FLAT.ochreDark], // rust
  [FLAT.sage, FLAT.sageDark], // teal
];

const FONT_STACKS: readonly string[] = [
  '"Caveat Variable", "Caveat", cursive',
  '"Kalam", cursive',
  '"Patrick Hand", cursive',
];

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
  const band = spineW * 0.26;
  const x0 = bx + spineW * 0.16;
  const x1 = bx + spineW * 0.84;
  const gold = gilded ? FLAT.gilt : face;
  for (const [t, weight] of [
    [0.218, 1],
    [0.296, 0.58],
    [0.785, 1],
  ] as const) {
    stroke(ctx, x0, by + bh * t, x1, by + bh * t, gold, band * weight, seed + t * 100);
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
  if (turn === 'square') {
    wobbleRect(ctx, x, y, w, h, m * 0.008, seed);
    return;
  }
  if (turn === 'round') {
    wobbleRect(ctx, x, y, w, h, m * 0.16, seed);
    return;
  }
  if (turn === 'soft') {
    wobbleRect(ctx, x, y, w, h, m * 0.05, seed);
    return;
  }
  // ogee — the corner is drawn out into a shallow S, which is what separates a
  // "binding" frame from a rounded rectangle. Traced by hand because a radius
  // cannot express a reversing curve.
  const r = m * 0.13;
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
      dot(ctx, cx, cy, line * 1.6, colour);
      return;
    case 'stud':
      dot(ctx, cx, cy, line * 2.4, colour);
      return;
    case 'ring':
      pen(ctx, colour, line * 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      return;
    case 'lozenge':
      tracePoly(ctx, [
        { x: cx, y: cy - s },
        { x: cx + s * 0.68, y: cy },
        { x: cx, y: cy + s },
        { x: cx - s * 0.68, y: cy },
      ]);
      ctx.fillStyle = colour;
      ctx.fill();
      return;
    case 'bracket': {
      // Two strokes running back along the rules from the corner: the mark a
      // binder's corner tool actually leaves.
      pen(ctx, colour, line);
      ctx.beginPath();
      ctx.moveTo(cx + sx * s * 2.2, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * s * 2.2);
      ctx.stroke();
      return;
    }
    case 'fleuron': {
      // Three petals thrown inward along the diagonal. Filled, because a
      // hairline flourish disappears the moment the cover is a thumbnail.
      for (const a of [0, 1, 2]) {
        const ang = Math.atan2(sy, sx) + Math.PI + (a - 1) * 0.55;
        const px = cx + Math.cos(ang) * s * 1.5;
        const py = cy + Math.sin(ang) * s * 1.5;
        tracePoly(ctx, [
          { x: cx, y: cy },
          { x: px + Math.cos(ang + 0.5) * s * 0.5, y: py + Math.sin(ang + 0.5) * s * 0.5 },
          { x: px, y: py },
          { x: px + Math.cos(ang - 0.5) * s * 0.5, y: py + Math.sin(ang - 0.5) * s * 0.5 },
        ]);
        ctx.fillStyle = colour;
        ctx.fill();
      }
      return;
    }
  }
}

function paintFrameSide(
  ctx: FlatCtx,
  kind: FrameSide,
  mx: number,
  my: number,
  s: number,
  colour: string,
  line: number,
  horizontal: boolean,
): void {
  switch (kind) {
    case 'none':
      return;
    case 'dot':
      dot(ctx, mx, my, line * 1.5, colour);
      return;
    case 'lozenge':
      tracePoly(ctx, [
        { x: mx, y: my - s },
        { x: mx + s * 0.72, y: my },
        { x: mx, y: my + s },
        { x: mx - s * 0.72, y: my },
      ]);
      ctx.fillStyle = colour;
      ctx.fill();
      return;
    case 'tick': {
      // ACROSS the rule, never along it — a mark laid along a line is just a
      // thicker line.
      pen(ctx, colour, line);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(mx, my - s);
        ctx.lineTo(mx, my + s);
      } else {
        ctx.moveTo(mx - s, my);
        ctx.lineTo(mx + s, my);
      }
      ctx.stroke();
      return;
    }
    case 'pair': {
      pen(ctx, colour, line * 0.8);
      const off = s * 1.3;
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
      return;
    }
    case 'arc': {
      pen(ctx, colour, line * 0.9);
      ctx.beginPath();
      const a0 = horizontal ? Math.PI : Math.PI * 1.5;
      ctx.arc(mx, my, s * 1.1, a0, a0 + Math.PI);
      ctx.stroke();
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
  detail: boolean,
  seed: number,
): void {
  const spec = FRAMES[((Math.trunc(style) % FRAMES.length) + FRAMES.length) % FRAMES.length]!;
  const base = Math.max(1, Math.min(w, h) * 0.012);
  const gap = Math.min(w, h) * 0.042;

  // The band goes down FIRST, so the rules land on top of their own border
  // rather than being half-covered by it.
  if (spec.band === true && spec.rules.length > 1) {
    traceFrameRect(ctx, x, y, w, h, spec.turn, seed + 3);
    traceFrameRect(ctx, x + gap, y + gap, w - gap * 2, h - gap * 2, spec.turn, seed + 4);
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.16;
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
  }

  spec.rules.forEach((weight, i) => {
    const g = gap * i;
    if (w - g * 2 < base * 6 || h - g * 2 < base * 6) return;
    traceFrameRect(ctx, x + g, y + g, w - g * 2, h - g * 2, spec.turn, seed + i * 7);
    pen(ctx, colour, base * weight);
    ctx.stroke();
  });

  if (!detail) return;

  const s = Math.min(w, h) * 0.022;
  const inset = Math.min(w, h) * 0.035;
  for (const [cx, cy, sx, sy] of [
    [x + inset, y + inset, 1, 1],
    [x + w - inset, y + inset, -1, 1],
    [x + w - inset, y + h - inset, -1, -1],
    [x + inset, y + h - inset, 1, -1],
  ] as const) {
    paintFrameCorner(ctx, spec.corner, cx, cy, s, colour, base, sx, sy);
  }

  for (const [mx, my, horiz] of [
    [x + w / 2, y, true],
    [x + w / 2, y + h, true],
    [x, y + h / 2, false],
    [x + w, y + h / 2, false],
  ] as const) {
    paintFrameSide(ctx, spec.side, mx, my, s, colour, base, horiz);
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
): void {
  const k = ((Math.trunc(kind) % ORNAMENT_COUNT) + ORNAMENT_COUNT) % ORNAMENT_COUNT;
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
  /** Pale bindings need a label that is not the same cream as the board. */
  paleBoard: boolean;
  font: string;
  seed: number;
  /** Detail scale, only used to keep handwriting above its legibility floor. */
  s: number;
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
    // drawn rather than lit: one more line around the plate.
    const g = h * 0.16;
    wobbleRect(ctx, x - g, y - g, w + g * 2, h + g * 2, h * 0.2, spec.seed + 4);
    pen(ctx, spec.gilded ? FLAT.giltPale : spec.dark, line * 0.8);
    ctx.stroke();
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
  const maxWidth = w * 0.84;
  const floorPx = 14 * spec.s;
  let fontPx = Math.min(h * 0.46, 30 * spec.s);
  let fitted = text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (;;) {
    ctx.font = `700 ${fontPx.toFixed(1)}px ${spec.font}`;
    if (ctx.measureText(fitted).width <= maxWidth || fontPx <= floorPx) break;
    fontPx *= 0.92;
  }
  if (ctx.measureText(fitted).width > maxWidth) {
    while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) {
      fitted = fitted.slice(0, -1);
    }
    fitted = `${fitted}…`;
  }
  ctx.fillStyle = ink;
  ctx.fillText(fitted, x + w / 2, y + h * 0.44);

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
 * bevel, no rivet catchlight, nothing that implies a light source.
 */
function paintCornerPlates(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  gilded: boolean,
  ink: number,
): void {
  const size = Math.min(w * 0.17, h * 0.13);
  const fill = gilded ? FLAT.gilt : FLAT.timber;
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x + w, y + h, -1, -1],
    [x, y + h, 1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * size);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * size, cy);
    // The inner edge is scooped, exactly as a real corner piece is cut.
    ctx.quadraticCurveTo(cx + dx * size * 0.4, cy + dy * size * 0.4, cx, cy + dy * size);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    pen(ctx, FLAT.ink, ink * 0.7);
    ctx.stroke();
    dot(ctx, cx + dx * size * 0.24, cy + dy * size * 0.24, ink * 0.7, FLAT.ink);
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
  colourIndex: number,
  /** The board's own face, so the charm never disappears into it. */
  board: string,
  ink: number,
  seed: number,
): void {
  // A crimson ribbon on a terracotta board is a ribbon nobody can see. Rather
  // than tint it (which would put a colour outside FLAT on screen), step to the
  // next colourway — six of the eight are always safe.
  let slot = ((colourIndex % 8) + 8) % 8;
  if ((CHARM_CLOTHS[slot] ?? CHARM_CLOTHS[0]!)[0] === board) slot = (slot + 1) % 8;
  const [face, dark] = CHARM_CLOTHS[slot] ?? CHARM_CLOTHS[0]!;
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
  const material = params.material ?? materialFromTexture(params.texture);
  // Flat art has no grain, so a material can only say one thing — whether the
  // boards are dyed cloth or pale parchment. That is also the only difference
  // you can actually see across a room, which is the test the whole restyle
  // is built around.
  const pale = PALE_BINDINGS.has(material);
  const [face, dark] = pale ? PALE_BOARD : clothFor(params.palette);
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
  paintSpineStrip(ctx, bx, by, bw, bh, spineW, radius, face, dark, ink, gilded, seed);

  /* ---- ornament ---- */
  // The icon's frame is pale gilt on a terracotta board. A book with no foil
  // gets the same frame blind-tooled instead — the board's own darker tone,
  // which is what a binder without gold leaf actually does. A cream board
  // swallows both pale tones, so parchment tools in the deeper ochre.
  const frameInk = pale ? FLAT.ochreDark : gilded ? FLAT.giltPale : dark;
  const ornInk = pale ? FLAT.ochreDark : gilded ? FLAT.gilt : dark;
  // Fine ornament is the first thing to go as a book wears.
  const fineDetail = wear < 0.7;
  const fx = faceX + faceW * 0.085;
  const fy = by + bh * 0.055;
  paintFrame(ctx, fx, fy, faceW * 0.83, bh * 0.89, params.frame, frameInk, fineDetail, seed + 31);

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
      paleBoard: pale,
      font: FONT_STACKS[params.titleFont] ?? FONT_STACKS[0]!,
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
  // it, and the first specimen's contact ellipse read as a thumbprint.
  paintMedallion(ctx, medX, medY, medR, params.medallion, ornInk);

  /* ---- fittings ---- */
  if (params.cornerProtectors) {
    paintCornerPlates(ctx, bx, by, bw, bh, gilded, ink);
  }
  if (params.charm && params.charm !== 'none') {
    paintCharm(ctx, params.charm, bx, by, bw, bh, params.charmColor ?? 0, face, ink, seed + 51);
  }

  ctx.restore();
}

/* ------------------------------- bake cache ------------------------------- */

const urlCache = new Map<string, string>();

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
  // The room leads the key: a cover's cloth comes from the live scheme, so the
  // same params in two rooms are two different PNGs.
  const key = `${flatSchemeTag()}|${params.seed}|${params.palette}|${params.texture}|${params.frame}|${params.medallion}|${params.titleFont}|${params.gilt ? 1 : 0}|${params.material ?? '-'}|${params.titlePlate ?? '-'}|${params.cornerProtectors ? 1 : 0}|${params.insetPlate ? 1 : 0}|${params.edge ?? '-'}|${(params.wear ?? 0).toFixed(3)}|${params.charm ?? '-'}|${params.charmColor ?? 0}|${Math.round(w)}x${Math.round(h)}|${opts.plate === false ? 0 : 1}|${title}`;
  const cached = urlCache.get(key);
  if (cached !== undefined) return cached;
  const url = renderCover(w, h, params, title, opts).toDataURL('image/png');
  // Guard the cache: keep it bounded (covers are ~100-300KB each).
  if (urlCache.size > 24) {
    const first = urlCache.keys().next().value;
    if (first !== undefined) urlCache.delete(first);
  }
  urlCache.set(key, url);
  return url;
}
