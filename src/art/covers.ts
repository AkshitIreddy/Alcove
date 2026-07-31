/**
 * art/covers.ts — intricate procedural FRONT COVER art (L2, bake-once).
 *
 * A book's cover derives from the same 32-bit spine seed as its shelf spine
 * (deriveSpineParams), so a terracotta leather spine pulls out into a
 * terracotta leather cover: palette / texture / title face / gilt are shared,
 * the medallion inherits the spine's ornament vocabulary, and only the
 * cover-specific pieces (frame style, medallion dressing) come from extra
 * seeded rolls. Users can override any knob through the book's cover_meta
 * JSON (`{ cover: { palette, texture, frame, medallion, titleFont, gilt } }`
 * — see src/data/books.ts helpers); `deriveCoverParams(seed, overrides)`
 * folds a normalized override object on top of the derived params.
 *
 * renderCover paints with plain canvas 2d — layered multiply gradients,
 * jittered double-stroked "pencil" rules, the shared granulation tile —
 * NO SVG filters (CLAUDE.md: filters are bake-only). Layers, back to front:
 * base wash → texture (cloth weave / leather mottle / paper fibres) →
 * vignette → spine-edge shading + hinge groove → head/tail band hints →
 * ornamental double frame with corner flourishes → center medallion
 * (8 variants) → optional title plate (Caveat/Kalam, gilt trim) →
 * granulation overlay → pencil outline.
 *
 * Bake-once: `coverDataUrl` memoizes the rendered PNG per
 * (seed+overrides+size+title) key so overlays and backdrops never re-paint.
 */

import { charmColorCss, drawCoverCharm, type CharmKind } from './charms';
import {
  DEFAULT_LIGHT_RIG,
  applyAmbientOcclusion,
  applyKeyLight,
  applyRimLight,
  applySpecularCatch,
  keyToSource,
  type LightRig,
} from './lighting';
import { drawMaterialRect, getMaterialTile, materialDefaults } from './materials';
import { clamp, mulberry32, type RandomFn } from './noise';
import {
  applyOutlineWear,
  bindingMaterialSlug,
  deriveSpineParams,
  getGranulationTile,
  materialFromTexture,
  paintBindingMaterial,
  paintEdgeTreatment,
  paintWear,
  textureFromMaterial,
  type BindingMaterial,
  type Ctx2D,
  type EdgeTreatment,
  type MaterialTones,
  type TitlePlateStyle,
} from './spines';

/* --------------------------------- params -------------------------------- */

export const COVER_PALETTE_COUNT = 20;
export const COVER_FRAME_COUNT = 4;
export const COVER_MEDALLION_COUNT = 8;
export const COVER_TEXTURES = ['cloth', 'leather', 'paper'] as const;
export const COVER_FONTS = ['Caveat', 'Kalam', 'Patrick Hand'] as const;

export interface CoverParams {
  /** Seed the params were derived from (drives render-time jitter too). */
  seed: number;
  /** Index into the 12 warm pigment duos (same order as art/spines.ts). */
  palette: number;
  /** 0 = cloth, 1 = leather, 2 = paper. */
  texture: 0 | 1 | 2;
  /** Ornamental frame style 0–3: rules / corner-squares / scallop / stitch. */
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

  /** Binding material; when set it supersedes the legacy `texture` bucket. */
  material?: BindingMaterial;
  /** Title plate treatment (mirrors the spine's). */
  titlePlate?: TitlePlateStyle;
  /** Metal corner protectors on the four cover corners. */
  cornerProtectors?: boolean;
  /** Recess the title plate into a bevelled inset panel. */
  insetPlate?: boolean;
  /** Fore-edge treatment of the text block. */
  edge?: EdgeTreatment;
  /** Wear, 0 (pristine) → 1 (well-loved). */
  wear?: number;
  /** The book's charm, drawn cover-side. */
  charm?: CharmKind;
  /** Index into charms.CHARM_COLORS. */
  charmColor?: number;
  /**
   * Sub-treatment within the material (crackled vs pebbled leather, ribbed vs
   * flat cloth, combed vs stone marbling…). Inherited from the spine.
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

interface HSL {
  h: number;
  s: number;
  l: number;
}

/**
 * The 20 curated pigment duos (top/light, bottom/dark) — same order and same
 * values as art/spines.ts PALETTES (not exported there; drift is cosmetic
 * only, but a spine and its own pull-out cover disagreeing is not, so keep
 * these two tables in step).
 */
const PALETTES: ReadonlyArray<readonly [HSL, HSL]> = [
  [{ h: 38, s: 64, l: 52 }, { h: 28, s: 62, l: 31 }], // 0  amber
  [{ h: 16, s: 58, l: 47 }, { h: 8, s: 56, l: 27 }], // 1  terracotta
  [{ h: 95, s: 30, l: 41 }, { h: 102, s: 34, l: 23 }], // 2  moss
  [{ h: 210, s: 28, l: 46 }, { h: 216, s: 34, l: 26 }], // 3  dusty blue
  [{ h: 315, s: 26, l: 39 }, { h: 322, s: 32, l: 21 }], // 4  plum
  [{ h: 44, s: 62, l: 46 }, { h: 38, s: 58, l: 27 }], // 5  ochre
  [{ h: 130, s: 18, l: 51 }, { h: 136, s: 22, l: 31 }], // 6  sage
  [{ h: 22, s: 62, l: 39 }, { h: 16, s: 62, l: 22 }], // 7  rust
  [{ h: 28, s: 40, l: 51 }, { h: 22, s: 38, l: 31 }], // 8  clay
  [{ h: 70, s: 32, l: 37 }, { h: 64, s: 36, l: 21 }], // 9  olive
  [{ h: 200, s: 20, l: 41 }, { h: 206, s: 24, l: 23 }], // 10 slate
  [{ h: 355, s: 34, l: 55 }, { h: 348, s: 34, l: 35 }], // 11 blush
  [{ h: 2, s: 54, l: 33 }, { h: 356, s: 56, l: 17 }], // 12 oxblood
  [{ h: 220, s: 46, l: 29 }, { h: 226, s: 50, l: 15 }], // 13 navy
  [{ h: 148, s: 36, l: 27 }, { h: 154, s: 40, l: 14 }], // 14 forest
  [{ h: 33, s: 46, l: 60 }, { h: 27, s: 42, l: 40 }], // 15 tan
  [{ h: 44, s: 40, l: 83 }, { h: 38, s: 32, l: 62 }], // 16 cream
  [{ h: 212, s: 12, l: 25 }, { h: 214, s: 14, l: 11 }], // 17 ink
  [{ h: 186, s: 36, l: 33 }, { h: 192, s: 40, l: 18 }], // 18 teal
  [{ h: 36, s: 76, l: 55 }, { h: 28, s: 72, l: 34 }], // 19 saffron
];

const FONT_STACKS: readonly string[] = [
  '"Caveat Variable", "Caveat", cursive',
  '"Kalam", cursive',
  '"Patrick Hand", cursive',
];

const GOLD = '#c9a227';
const GOLD_DEEP = '#8f6f14';
const GRAPHITE = 'rgba(58, 50, 42, 0.55)';
const CREAM = '#f2e7cd';

function hslStr(c: HSL, dl = 0, ds = 0, alpha = 1): string {
  const s = clamp(c.s + ds, 0, 100);
  const l = clamp(c.l + dl, 0, 100);
  return alpha >= 1 ? `hsl(${c.h} ${s}% ${l}%)` : `hsl(${c.h} ${s}% ${l}% / ${alpha})`;
}

/** CSS color pair for one palette (UI swatches in the customize panel). */
export function coverPaletteCss(palette: number): { top: string; bottom: string } {
  const duo = PALETTES[((palette % PALETTES.length) + PALETTES.length) % PALETTES.length] as readonly [HSL, HSL];
  return { top: hslStr(duo[0]), bottom: hslStr(duo[1]) };
}

/* ------------------------------- geometry --------------------------------- */

interface Pt {
  x: number;
  y: number;
}

function jitterLine(a: Pt, b: Pt, step: number, amp: number, rnd: RandomFn): Pt[] {
  const out: Pt[] = [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const segs = Math.max(1, Math.round(len / step));
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    out.push({
      x: a.x + (b.x - a.x) * t + (rnd() * 2 - 1) * amp,
      y: a.y + (b.y - a.y) * t + (rnd() * 2 - 1) * amp,
    });
  }
  return out;
}

function strokePts(ctx: Ctx2D, pts: readonly Pt[], close = false): void {
  const first = pts[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo((pts[i] as Pt).x, (pts[i] as Pt).y);
  if (close) ctx.closePath();
  ctx.stroke();
}

/** A jittered rectangle outline (four jittered edges). */
function strokeJitterRect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
  amp: number,
  rnd: RandomFn,
): void {
  const corners: Pt[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  for (let i = 0; i < 4; i++) {
    strokePts(ctx, jitterLine(corners[i] as Pt, corners[(i + 1) % 4] as Pt, step, amp, rnd));
  }
}

function polygon(cx: number, cy: number, r: number, n: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function star(cx: number, cy: number, outer: number, inner: number, spikes: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function jitterPoly(pts: readonly Pt[], amp: number, rnd: RandomFn): Pt[] {
  return pts.map((p) => ({
    x: p.x + (rnd() * 2 - 1) * amp,
    y: p.y + (rnd() * 2 - 1) * amp,
  }));
}

/* ------------------------------ render pieces ----------------------------- */

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function paintBase(ctx: Ctx2D, w: number, h: number, colA: HSL, colB: HSL): void {
  ctx.fillStyle = hslStr(colA);
  ctx.fillRect(0, 0, w, h);

  const g1 = ctx.createLinearGradient(0, 0, 0, h);
  g1.addColorStop(0, hslStr(colA, 9));
  g1.addColorStop(0.5, hslStr(colA));
  g1.addColorStop(1, hslStr(colB));
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);

  const g2 = ctx.createLinearGradient(0, 0, w, 0);
  g2.addColorStop(0, hslStr(colB, -8));
  g2.addColorStop(0.22, hslStr(colA, 8));
  g2.addColorStop(0.8, hslStr(colA, 5));
  g2.addColorStop(1, hslStr(colB, -6));
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function paintTexture(
  ctx: Ctx2D,
  w: number,
  h: number,
  texture: 0 | 1 | 2,
  colA: HSL,
  colB: HSL,
  s: number,
  rnd: RandomFn,
): void {
  if (texture === 0) {
    // Cloth: fine two-way weave.
    ctx.strokeStyle = hslStr(colB, -10, 0, 0.055);
    ctx.lineWidth = Math.max(0.5, 0.5 * s);
    const pitch = Math.max(2.5, 3.2 * s);
    ctx.beginPath();
    for (let y = pitch / 2; y < h; y += pitch) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = hslStr(colB, -6, 0, 0.035);
    ctx.beginPath();
    for (let x = pitch / 2; x < w; x += pitch) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
  } else if (texture === 1) {
    // Leather: coarse mottle — the granulation tile scaled up + multiplied,
    // two offset passes so the grain clumps.
    const tile = getGranulationTile();
    ctx.globalCompositeOperation = 'multiply';
    for (const [scaleMul, alpha] of [
      [2.4, 0.07],
      [1.3, 0.05],
    ] as const) {
      ctx.globalAlpha = alpha;
      const ts = 256 * scaleMul * s;
      for (let ty = -ts * rnd(); ty < h; ty += ts) {
        for (let tx = -ts * rnd(); tx < w; tx += ts) {
          ctx.drawImage(tile, tx, ty, ts, ts);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // Paper: sparse long fibre streaks.
    ctx.strokeStyle = hslStr(colA, 15, -10, 0.06);
    ctx.lineWidth = Math.max(0.5, 0.7 * s);
    for (let i = 0; i < 14; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const len = (0.1 + rnd() * 0.2) * h;
      const drift = (rnd() * 2 - 1) * 6 * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + drift, y + len * 0.5, x + drift * 0.4, y + len);
      ctx.stroke();
    }
  }
}

/**
 * Lay the generated covering material over the base wash, dyed to the book's
 * pigment. Returns true when a tile was available.
 *
 * The tile comes from `bindingMaterialSlug`, the *same* table the spine uses.
 * That is not deduplication for its own sake: a book's cover and its spine are
 * one piece of covering wrapped around the boards, and the shelf → pull-out →
 * open-book journey is only convincing if the grain on the spine is the grain
 * on the board.
 *
 * The cover is where this matters most. A spine is thirty pixels wide on a
 * shelf and can get away with a suggestion of grain, but a pulled-out board
 * fills a third of the window — and the procedural cover texture is three
 * hatched lines and a granulation tile, which at that size reads as exactly
 * what it is. A real 512² morocco tile at a 200 px repeat does not.
 *
 * `soft-light` rather than `source-over`: the base wash below already carries
 * the two directional gradients that give the board its form, and a normal
 * composite would flatten them. Soft-light keeps them and adds the tooth.
 */
function paintGeneratedBoard(
  ctx: Ctx2D,
  w: number,
  h: number,
  material: BindingMaterial,
  boardStyle: number,
  colA: HSL,
  s: number,
  seed: number,
): boolean {
  const slug = bindingMaterialSlug(material, boardStyle);
  if (slug === null || !getMaterialTile(slug)) return false;
  const tuned = materialDefaults(slug, 1);
  const marbled = material === 'marbled';
  // A board is roughly six spine-widths across, so the repeat opens up to
  // match: the same physical grain, seen across a much bigger surface.
  const tilePx = tuned.tilePx * Math.max(1.05, s * 1.7);
  const tint = hslStr(colA);

  // Pass 1: the covering itself, holding the base wash's modelling.
  const ok = drawMaterialRect(ctx as CanvasRenderingContext2D, 0, 0, w, h, {
    slug,
    tint,
    tilePx,
    strength: marbled ? 1 : 0.92,
    balance: 0.85,
    seed,
    flipX: (seed & 4) === 4,
    globalAlpha: marbled ? 0.9 : 0.78,
    composite: 'soft-light',
  });
  if (!ok) return false;

  // Pass 2: the same crop again at a lower alpha in `multiply`, which puts the
  // material's own darks back. Soft-light alone lifts the mid-tones and the
  // craquelure ends up as a ghost; this returns the crack to being a crack.
  drawMaterialRect(ctx as CanvasRenderingContext2D, 0, 0, w, h, {
    slug,
    tint,
    tilePx,
    strength: 1,
    contrast: 1.15,
    balance: 1,
    colourMix: marbled ? 0.7 : 0.06,
    seed,
    flipX: (seed & 4) === 4,
    globalAlpha: marbled ? 0.5 : 0.34,
    composite: 'multiply',
  });
  return true;
}

/**
 * Run a painting pass at partial weight.
 *
 * The cover's texture routines are canvas-native and set their own
 * `globalAlpha` and composite modes internally, so there is no outer knob to
 * turn them down with. Snapshotting the pixels either side of the pass and
 * mixing back is crude, but it is exact, it works for any pass regardless of
 * what it does inside, and a cover bakes once — the two `getImageData` calls
 * are nothing next to the tooling that follows.
 *
 * Used to pull the hand-painted weave/grain back when a real material tile is
 * already carrying it, keeping the brush marks that vary book to book while
 * dropping the part the tile does better.
 */
function atWeight(ctx: Ctx2D, w: number, h: number, weight: number, pass: () => void): void {
  const k = Math.max(0, Math.min(1, weight));
  if (k >= 0.999) {
    pass();
    return;
  }
  if (k <= 0.001) return;
  let before: ImageData | null = null;
  try {
    before = ctx.getImageData(0, 0, w, h);
  } catch {
    // Tainted canvas or no readback — fall back to the full-strength pass
    // rather than silently painting nothing.
    pass();
    return;
  }
  pass();
  const after = ctx.getImageData(0, 0, w, h);
  const a = after.data;
  const b = before.data;
  for (let i = 0; i < a.length; i++) a[i] = b[i] + (a[i] - b[i]) * k;
  ctx.putImageData(after, 0, 0);
}

function paintVignette(ctx: Ctx2D, w: number, h: number, colB: HSL): void {
  const g = ctx.createRadialGradient(
    w * 0.5,
    h * 0.46,
    Math.min(w, h) * 0.35,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.75,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, hslStr(colB, -16, 0, 0.4));
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

/** Spine-side darkening + hinge groove, and a bright fore-edge kiss. */
function paintSpineEdge(ctx: Ctx2D, w: number, h: number, colB: HSL, s: number, rnd: RandomFn): void {
  const bandW = w * 0.085;
  const g = ctx.createLinearGradient(0, 0, bandW * 1.6, 0);
  g.addColorStop(0, hslStr(colB, -22, 0, 0.5));
  g.addColorStop(0.55, hslStr(colB, -12, 0, 0.22));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, bandW * 1.6, h);

  // Hinge groove: two close jittered verticals.
  ctx.strokeStyle = hslStr(colB, -24, 0, 0.5);
  ctx.lineWidth = Math.max(0.8, 1 * s);
  strokePts(ctx, jitterLine({ x: bandW, y: h * 0.01 }, { x: bandW, y: h * 0.99 }, 9 * s, 0.7 * s, rnd));
  ctx.strokeStyle = hslStr(colB, 10, 0, 0.25);
  strokePts(
    ctx,
    jitterLine({ x: bandW + 2.2 * s, y: h * 0.02 }, { x: bandW + 2.2 * s, y: h * 0.98 }, 9 * s, 0.7 * s, rnd),
  );

  // Fore-edge highlight (right side).
  const e = ctx.createLinearGradient(w - 6 * s, 0, w, 0);
  e.addColorStop(0, 'rgba(255,255,255,0)');
  e.addColorStop(1, 'rgba(255, 250, 235, 0.28)');
  ctx.fillStyle = e;
  ctx.fillRect(w - 6 * s, 0, 6 * s, h);
}

/** Head/tail band hints: striped little bands tucked at top + bottom. */
function paintBands(ctx: Ctx2D, w: number, h: number, colB: HSL, gilt: boolean, s: number): void {
  const bandH = 5 * s;
  const bandW = w * 0.052;
  const x = w * 0.012;
  for (const y of [h * 0.012, h - bandH - h * 0.012]) {
    ctx.fillStyle = hslStr(colB, -24, 0, 0.85);
    ctx.fillRect(x, y, bandW, bandH);
    ctx.fillStyle = gilt ? GOLD : CREAM;
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(x + bandW * (0.12 + i * 0.24), y + bandH * 0.18, bandW * 0.1, bandH * 0.64);
    }
  }
}

/** Little curled corner flourish (petal + curl + dot) pointing inward. */
function cornerFlourish(
  ctx: Ctx2D,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  size: number,
  rnd: RandomFn,
): void {
  const j = (v: number): number => v + (rnd() * 2 - 1) * size * 0.05;
  // Diagonal stem into the corner.
  ctx.beginPath();
  ctx.moveTo(j(x), j(y));
  ctx.quadraticCurveTo(
    j(x + dirX * size * 0.55),
    j(y + dirY * size * 0.2),
    j(x + dirX * size),
    j(y + dirY * size),
  );
  ctx.stroke();
  // Curl off the stem.
  ctx.beginPath();
  ctx.arc(
    j(x + dirX * size * 0.72),
    j(y + dirY * size * 0.86),
    size * 0.26,
    0,
    Math.PI * 1.5,
  );
  ctx.stroke();
  // Two leaf ticks.
  ctx.beginPath();
  ctx.moveTo(j(x + dirX * size * 0.34), j(y + dirY * size * 0.3));
  ctx.lineTo(j(x + dirX * size * 0.52), j(y + dirY * size * 0.06));
  ctx.moveTo(j(x + dirX * size * 0.5), j(y + dirY * size * 0.48));
  ctx.lineTo(j(x + dirX * size * 0.76), j(y + dirY * size * 0.28));
  ctx.stroke();
  // Seed dot at the tip.
  ctx.beginPath();
  ctx.arc(j(x + dirX * size * 0.16), j(y + dirY * size * 0.1), size * 0.055, 0, Math.PI * 2);
  ctx.fill();
}

function paintFrame(
  ctx: Ctx2D,
  w: number,
  h: number,
  params: CoverParams,
  colB: HSL,
  s: number,
  rnd: RandomFn,
  /** Blind-tooling relief pass: draw everything in this one tone instead. */
  reliefInk?: string,
): { inset: number } {
  const spineBand = w * 0.085;
  const insetL = spineBand + w * 0.045;
  const insetR = w * 0.05;
  const insetY = h * 0.055;
  const inner = 9 * s;

  const ink = reliefInk ?? (params.gilt ? GOLD : hslStr(colB, -26, 0, 0.85));
  const inkSoft = reliefInk ?? (params.gilt ? GOLD_DEEP : hslStr(colB, -18, 0, 0.55));
  const step = 10 * s;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Outer rule.
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, 1.5 * s);
  strokeJitterRect(ctx, insetL, insetY, w - insetL - insetR, h - insetY * 2, step, 0.8 * s, rnd);

  // Inner rule.
  ctx.strokeStyle = inkSoft;
  ctx.lineWidth = Math.max(0.7, 0.9 * s);
  strokeJitterRect(
    ctx,
    insetL + inner,
    insetY + inner,
    w - insetL - insetR - inner * 2,
    h - insetY * 2 - inner * 2,
    step,
    0.6 * s,
    rnd,
  );

  const x0 = insetL + inner;
  const y0 = insetY + inner;
  const x1 = w - insetR - inner;
  const y1 = h - insetY - inner;

  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(0.8, 1.1 * s);

  if (params.frame === 1) {
    // Corner squares with inset diamonds.
    const sq = 12 * s;
    for (const [cx, cy] of [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ] as const) {
      strokeJitterRect(ctx, cx - sq / 2, cy - sq / 2, sq, sq, 5 * s, 0.5 * s, rnd);
      strokePts(ctx, jitterPoly(polygon(cx, cy, sq * 0.3, 4, -Math.PI / 2), 0.4 * s, rnd), true);
    }
  } else if (params.frame === 2) {
    // Scalloped inner border: little arcs marching along the inner rule.
    const r = 5.5 * s;
    ctx.lineWidth = Math.max(0.7, 0.9 * s);
    const scallop = (fromX: number, fromY: number, toX: number, toY: number): void => {
      const len = Math.hypot(toX - fromX, toY - fromY);
      const n = Math.floor(len / (r * 2.15));
      const ux = (toX - fromX) / len;
      const uy = (toY - fromY) / len;
      // Inward normal (frame runs clockwise).
      const nx = -uy;
      const ny = ux;
      for (let i = 0; i < n; i++) {
        const cx = fromX + ux * (i + 0.5) * (len / n);
        const cy = fromY + uy * (i + 0.5) * (len / n);
        ctx.beginPath();
        ctx.arc(
          cx + (rnd() * 2 - 1) * 0.5 * s,
          cy + (rnd() * 2 - 1) * 0.5 * s,
          r,
          Math.atan2(-ny, -nx) - Math.PI / 2,
          Math.atan2(-ny, -nx) + Math.PI / 2,
        );
        ctx.stroke();
      }
    };
    scallop(x0, y0, x1, y0);
    scallop(x1, y0, x1, y1);
    scallop(x1, y1, x0, y1);
    scallop(x0, y1, x0, y0);
  } else if (params.frame === 3) {
    // Stitch: short dashes between the rules, like saddle stitching.
    ctx.lineWidth = Math.max(0.7, 1 * s);
    const mid = inner / 2;
    const dash = (fromX: number, fromY: number, toX: number, toY: number, nx: number, ny: number): void => {
      const len = Math.hypot(toX - fromX, toY - fromY);
      const n = Math.floor(len / (7 * s));
      const ux = (toX - fromX) / len;
      const uy = (toY - fromY) / len;
      for (let i = 0; i < n; i++) {
        const cx = fromX + ux * (i + 0.5) * (len / n) + (rnd() * 2 - 1) * 0.6 * s;
        const cy = fromY + uy * (i + 0.5) * (len / n) + (rnd() * 2 - 1) * 0.6 * s;
        ctx.beginPath();
        ctx.moveTo(cx - ux * 2 * s, cy - uy * 2 * s);
        ctx.lineTo(cx + ux * 2 * s, cy + uy * 2 * s);
        ctx.stroke();
        void nx;
        void ny;
      }
    };
    dash(x0 - mid, y0 - mid, x1 + mid, y0 - mid, 0, 1);
    dash(x1 + mid, y0 - mid, x1 + mid, y1 + mid, -1, 0);
    dash(x1 + mid, y1 + mid, x0 - mid, y1 + mid, 0, -1);
    dash(x0 - mid, y1 + mid, x0 - mid, y0 - mid, 1, 0);
  }

  // Corner flourishes inside every frame style.
  const fl = 16 * s;
  ctx.lineWidth = Math.max(0.8, 1 * s);
  cornerFlourish(ctx, x0 + 4 * s, y0 + 4 * s, 1, 1, fl, rnd);
  cornerFlourish(ctx, x1 - 4 * s, y0 + 4 * s, -1, 1, fl, rnd);
  cornerFlourish(ctx, x1 - 4 * s, y1 - 4 * s, -1, -1, fl, rnd);
  cornerFlourish(ctx, x0 + 4 * s, y1 - 4 * s, 1, -1, fl, rnd);

  return { inset: inner };
}

/**
 * Center medallion — 8 variants sharing the spine ornament vocabulary
 * (diamond / laurel / star / flower-blot / chevron ring / sun / moon /
 * keyhole), each dressed with rosette rings + radial petals so it reads as
 * a tooled centerpiece rather than a small stamp.
 */
function paintMedallion(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  radius: number,
  params: CoverParams,
  colB: HSL,
  s: number,
  rnd: RandomFn,
  /** Blind-tooling relief pass: draw everything in this one tone instead. */
  reliefInk?: string,
): void {
  const ink = reliefInk ?? (params.gilt ? GOLD : hslStr(colB, -26, 0, 0.9));
  const inkSoft = reliefInk ?? (params.gilt ? GOLD_DEEP : hslStr(colB, -16, 0, 0.55));
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, 1.3 * s);

  // Shared dressing: double ring + petal ring + tick ring.
  strokePts(ctx, jitterPoly(polygon(cx, cy, radius, 28), 0.8 * s, rnd), true);
  ctx.strokeStyle = inkSoft;
  ctx.lineWidth = Math.max(0.7, 0.9 * s);
  strokePts(ctx, jitterPoly(polygon(cx, cy, radius * 0.86, 24), 0.6 * s, rnd), true);

  // Petal ring between the two circles.
  ctx.strokeStyle = ink;
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const px = cx + Math.cos(a) * radius * 0.93;
    const py = cy + Math.sin(a) * radius * 0.93;
    ctx.beginPath();
    ctx.arc(px, py, radius * 0.055, a + Math.PI * 0.5, a + Math.PI * 1.5);
    ctx.stroke();
  }
  // Radial ticks just outside the outer ring.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + Math.PI / 24;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * radius * 1.03, cy + Math.sin(a) * radius * 1.03);
    ctx.lineTo(cx + Math.cos(a) * radius * (i % 2 === 0 ? 1.12 : 1.08), cy + Math.sin(a) * radius * (i % 2 === 0 ? 1.12 : 1.08));
    ctx.stroke();
  }

  const r = radius * 0.62;
  const kind = ((params.medallion % 8) + 8) % 8;
  ctx.lineWidth = Math.max(1, 1.2 * s);

  switch (kind) {
    case 0: {
      // Diamond lozenge: nested diamonds + center dot.
      strokePts(ctx, jitterPoly(polygon(cx, cy, r, 4, -Math.PI / 2), 0.7 * s, rnd), true);
      strokePts(ctx, jitterPoly(polygon(cx, cy, r * 0.62, 4, -Math.PI / 2), 0.5 * s, rnd), true);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 1: {
      // Laurel wreath: two mirrored arcs of leaves.
      for (const side of [-1, 1]) {
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI * 0.42 + (i / 6) * Math.PI * 0.84;
          const bx = cx + side * Math.cos(a) * r * 0.8;
          const by = cy + Math.sin(a) * r * 0.9;
          const la = a + side * 0.8;
          ctx.beginPath();
          ctx.ellipse(bx, by, r * 0.16, r * 0.07, la, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 2: {
      // Five-point star over a pentagon.
      strokePts(ctx, jitterPoly(star(cx, cy, r, r * 0.45, 5), 0.6 * s, rnd), true);
      strokePts(ctx, jitterPoly(polygon(cx, cy, r * 0.45, 5, -Math.PI / 2), 0.4 * s, rnd), true);
      break;
    }
    case 3: {
      // Flower: 8 petal ellipses around a filled heart.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.34, r * 0.17, a, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 4: {
      // Chevron ring: zigzag band inside a circle.
      strokePts(ctx, jitterPoly(polygon(cx, cy, r * 0.95, 24), 0.5 * s, rnd), true);
      const zig: Pt[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = i % 2 === 0 ? r * 0.72 : r * 0.42;
        zig.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
      }
      strokePts(ctx, jitterPoly(zig, 0.5 * s, rnd), true);
      break;
    }
    case 5: {
      // Sun: circle + 12 wavy rays + smile-less face dot.
      strokePts(ctx, jitterPoly(polygon(cx, cy, r * 0.5, 16), 0.5 * s, rnd), true);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.58, cy + Math.sin(a) * r * 0.58);
        ctx.quadraticCurveTo(
          cx + Math.cos(a + 0.12) * r * 0.75,
          cy + Math.sin(a + 0.12) * r * 0.75,
          cx + Math.cos(a) * r * 0.95,
          cy + Math.sin(a) * r * 0.95,
        );
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 6: {
      // Crescent moon + three little stars.
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.72, -Math.PI * 0.6, Math.PI * 0.6);
      ctx.arc(cx + r * 0.34, cy, r * 0.52, Math.PI * 0.66, -Math.PI * 0.66, true);
      ctx.closePath();
      ctx.stroke();
      for (const [dx, dy, ss] of [
        [0.45, -0.4, 0.14],
        [0.58, 0.05, 0.09],
        [0.42, 0.45, 0.12],
      ] as const) {
        strokePts(ctx, jitterPoly(star(cx + r * dx, cy + r * dy, r * ss, r * ss * 0.42, 4), 0.3 * s, rnd), true);
      }
      break;
    }
    default: {
      // Keyhole in an escutcheon shield.
      const shield: Pt[] = [
        { x: cx - r * 0.62, y: cy - r * 0.6 },
        { x: cx + r * 0.62, y: cy - r * 0.6 },
        { x: cx + r * 0.56, y: cy + r * 0.2 },
        { x: cx, y: cy + r * 0.75 },
        { x: cx - r * 0.56, y: cy + r * 0.2 },
      ];
      strokePts(ctx, jitterPoly(shield, 0.6 * s, rnd), true);
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.18, r * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      strokePts(
        ctx,
        jitterPoly(
          [
            { x: cx - r * 0.08, y: cy - r * 0.02 },
            { x: cx - r * 0.16, y: cy + r * 0.42 },
            { x: cx + r * 0.16, y: cy + r * 0.42 },
            { x: cx + r * 0.08, y: cy - r * 0.02 },
          ],
          0.4 * s,
          rnd,
        ),
        true,
      );
      break;
    }
  }
}

/**
 * Metal corner protectors: right-angled brass/gilt plates on the four cover
 * corners, each with a curved inner edge, two rivets and a catchlight.
 */
function paintCornerProtectors(ctx: Ctx2D, w: number, h: number, gilt: boolean, s: number): void {
  const size = Math.min(w * 0.16, h * 0.12);
  const hi = gilt ? '#ffe9a8' : '#f0d68d';
  const mid = gilt ? GOLD : '#b8912f';
  const lo = gilt ? GOLD_DEEP : '#6f5312';
  const corners = [
    [0, 0, 1, 1],
    [w, 0, -1, 1],
    [w, h, -1, -1],
    [0, h, 1, -1],
  ] as const;
  for (const [cx, cy, dx, dy] of corners) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * size);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * size, cy);
    // Concave inner edge — a real corner piece is scooped, not a flat triangle.
    ctx.quadraticCurveTo(cx + dx * size * 0.42, cy + dy * size * 0.42, cx, cy + dy * size);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, cy, cx + dx * size, cy + dy * size);
    g.addColorStop(0, hi);
    g.addColorStop(0.4, mid);
    g.addColorStop(1, lo);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(58, 42, 12, 0.6)';
    ctx.lineWidth = Math.max(0.6, 0.9 * s);
    ctx.stroke();
    // Rivets.
    for (const [rx, ry] of [
      [cx + dx * size * 0.28, cy + dy * size * 0.12],
      [cx + dx * size * 0.12, cy + dy * size * 0.28],
    ] as const) {
      ctx.beginPath();
      ctx.arc(rx, ry, Math.max(1, 1.6 * s), 0, Math.PI * 2);
      ctx.fillStyle = hi;
      ctx.fill();
      ctx.strokeStyle = 'rgba(58, 42, 12, 0.55)';
      ctx.lineWidth = Math.max(0.4, 0.6 * s);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** A bevelled recess the title plate can sit down inside. */
function paintPlateInset(ctx: Ctx2D, x: number, y: number, w: number, h: number, colB: HSL, s: number): void {
  const b = Math.max(2, 3.5 * s);
  ctx.fillStyle = hslStr(colB, -14, 0, 0.5);
  ctx.fillRect(x - b, y - b, w + b * 2, h + b * 2);
  // Lit lower/right bevel, shadowed upper/left bevel.
  ctx.strokeStyle = hslStr(colB, -34, 0, 0.7);
  ctx.lineWidth = Math.max(0.8, 1.2 * s);
  ctx.beginPath();
  ctx.moveTo(x - b, y + h + b);
  ctx.lineTo(x - b, y - b);
  ctx.lineTo(x + w + b, y - b);
  ctx.stroke();
  ctx.strokeStyle = hslStr(colB, 26, -6, 0.55);
  ctx.beginPath();
  ctx.moveTo(x + w + b, y - b);
  ctx.lineTo(x + w + b, y + h + b);
  ctx.lineTo(x - b, y + h + b);
  ctx.stroke();
}

/** Title plate: four treatments, with the title text fitted inside. */
function paintTitlePlate(
  ctx: Ctx2D,
  w: number,
  h: number,
  params: CoverParams,
  colA: HSL,
  colB: HSL,
  title: string,
  s: number,
  rnd: RandomFn,
): void {
  const style: TitlePlateStyle = params.titlePlate ?? 'label';
  const plateW = w * 0.58;
  const plateH = Math.max(34 * s, h * 0.13);
  const px = w * 0.54 - plateW / 2;
  const py = h * 0.155 - plateH / 2;

  if (params.insetPlate && style !== 'none') {
    paintPlateInset(ctx, px, py, plateW, plateH, colB, s);
  }

  if (style === 'label') {
    // Plate shadow + paper.
    ctx.fillStyle = hslStr(colB, -20, 0, 0.35);
    ctx.fillRect(px + 2 * s, py + 3 * s, plateW, plateH);
    ctx.fillStyle = CREAM;
    ctx.fillRect(px, py, plateW, plateH);

    // Double rule border (gilt outer when gilt).
    ctx.strokeStyle = params.gilt ? GOLD : hslStr(colB, -18, 0, 0.8);
    ctx.lineWidth = Math.max(1, 1.3 * s);
    strokeJitterRect(ctx, px + 2.5 * s, py + 2.5 * s, plateW - 5 * s, plateH - 5 * s, 8 * s, 0.6 * s, rnd);
    ctx.strokeStyle = hslStr(colB, -12, 0, 0.45);
    ctx.lineWidth = Math.max(0.6, 0.8 * s);
    strokeJitterRect(ctx, px + 5.5 * s, py + 5.5 * s, plateW - 11 * s, plateH - 11 * s, 8 * s, 0.5 * s, rnd);
  } else if (style === 'gilt') {
    // Tooled gilt panel straight onto the binding.
    ctx.fillStyle = hslStr(colB, -10, 2, 0.4);
    ctx.fillRect(px, py, plateW, plateH);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1.1, 1.7 * s);
    strokeJitterRect(ctx, px, py, plateW, plateH, 8 * s, 0.6 * s, rnd);
    ctx.strokeStyle = 'rgba(201, 162, 39, 0.6)';
    ctx.lineWidth = Math.max(0.6, 0.9 * s);
    strokeJitterRect(ctx, px + 4 * s, py + 4 * s, plateW - 8 * s, plateH - 8 * s, 8 * s, 0.5 * s, rnd);
  } else if (style === 'debossed') {
    ctx.fillStyle = hslStr(colB, -12, 0, 0.45);
    ctx.fillRect(px, py, plateW, plateH);
    ctx.lineWidth = Math.max(0.9, 1.3 * s);
    ctx.strokeStyle = hslStr(colB, -34, 0, 0.75);
    ctx.beginPath();
    ctx.moveTo(px, py + plateH);
    ctx.lineTo(px, py);
    ctx.lineTo(px + plateW, py);
    ctx.stroke();
    ctx.strokeStyle = hslStr(colB, 28, -6, 0.5);
    ctx.beginPath();
    ctx.moveTo(px + plateW, py);
    ctx.lineTo(px + plateW, py + plateH);
    ctx.lineTo(px, py + plateH);
    ctx.stroke();
  }

  // Title text, fitted. Handwriting floor: never below 13px equivalent —
  // the plate is baked at scale s, so the floor is 14*s canvas px.
  const family = FONT_STACKS[params.titleFont] as string;
  const maxWidth = plateW - 18 * s;
  let fontPx = Math.min(plateH * 0.52, 30 * s);
  const floorPx = 14 * s;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let text = title.trim();
  for (;;) {
    ctx.font = `700 ${fontPx.toFixed(1)}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth || fontPx <= floorPx) break;
    fontPx *= 0.92;
  }
  if (ctx.measureText(text).width > maxWidth) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) {
      text = text.slice(0, -1);
    }
    text = `${text}…`;
  }
  // On a paper label the ground is cream, so deep ink always reads. Tooled
  // straight onto the binding it does not: dark pigments need gold or a pale
  // foil, exactly as a real binder would letter them.
  const onBinding = style !== 'label';
  const material: BindingMaterial = params.material ?? materialFromTexture(params.texture);
  const groundL = colB.l + (material === 'vellum' ? 22 : material === 'paper' ? 10 : 0);
  ctx.fillStyle = !onBinding
    ? hslStr(colB, -30, 8)
    : params.gilt || style === 'gilt'
      ? GOLD
      : groundL < 44
        ? hslStr(colA, clamp(100 - colA.l - 6, 0, 100), -46)
        : hslStr(colB, -30, 8);
  ctx.fillText(text, px + plateW / 2, py + plateH / 2 + 1 * s);

  // Tiny flourish under the text.
  ctx.strokeStyle = params.gilt ? GOLD : hslStr(colB, -16, 0, 0.6);
  ctx.lineWidth = Math.max(0.7, 0.9 * s);
  const fy = py + plateH - 7 * s;
  strokePts(ctx, jitterLine({ x: px + plateW * 0.3, y: fy }, { x: px + plateW * 0.7, y: fy }, 6 * s, 0.7 * s, rnd));
  ctx.beginPath();
  ctx.arc(px + plateW / 2, fy, 1.6 * s, 0, Math.PI * 2);
  ctx.fill();
}

/* --------------------------------- render --------------------------------- */

export interface RenderCoverOptions {
  /** Skip the title plate even when a title is given (page backdrops). */
  plate?: boolean;
  /**
   * The room's light rig, so a pulled-out book keeps the sun it was shelved
   * under. Defaults to the house golden-hour rig.
   */
  rig?: LightRig;
  /** Bake the light passes into the cover. Default true. */
  light?: boolean;
}

/**
 * Render one front cover at w×h onto a fresh canvas and return it.
 * Deterministic per (params, size, title). `s` (the detail scale) derives
 * from the canvas size so the same params bake crisp at any resolution.
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
  renderCoverInto(ctx as Ctx2D, canvas.width, canvas.height, params, title, opts);
  return canvas;
}

/** Paint a cover into an existing 2d context (harness/preview reuse). */
export function renderCoverInto(
  ctx: Ctx2D,
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): void {
  const duo = PALETTES[((params.palette % PALETTES.length) + PALETTES.length) % PALETTES.length] as readonly [HSL, HSL];
  const [colA, colB] = duo;
  const s = Math.max(0.5, Math.min(w / 380, h / 520));
  const rnd = mulberry32((params.seed ^ 0x000c07e5) >>> 0);

  const material: BindingMaterial = params.material ?? materialFromTexture(params.texture);
  const wear = clamp(params.wear ?? 0, 0, 1);
  const tones: MaterialTones = {
    light: (dl = 0, ds = 0, a = 1) => hslStr(colA, dl, ds, a),
    dark: (dl = 0, ds = 0, a = 1) => hslStr(colB, dl, ds, a),
  };

  ctx.save();
  paintBase(ctx, w, h, colA, colB);
  // The generated covering goes down between the base wash and the hand
  // treatment, so the tooling, the frame and the wear are all worked into a
  // material rather than onto a gradient.
  const boardMat = paintGeneratedBoard(
    ctx,
    w,
    h,
    material,
    params.boardStyle ?? 0,
    colA,
    s,
    (params.seed ^ 0x0b0a_2d17) >>> 0,
  );
  // With a real covering underneath, the hand-painted weave only has to break
  // the tile's regularity and add this book's own accidents — so it runs at a
  // third. With no tile it is the whole material and runs at full.
  //
  // Vellum and paper are the exceptions: their hand pass is not mostly weave,
  // it is a strong *lightening* — parchment is pale, and that pallor is how
  // you tell a vellum binding from a tan calf one at a glance. Cutting it to a
  // third turned every vellum cover into leather, so those two keep most of
  // their pass and let the tile add mottle underneath it.
  const handWeight = !boardMat ? 1 : material === 'vellum' || material === 'paper' ? 0.66 : 0.34;
  atWeight(ctx, w, h, handWeight, () => {
    if (params.material) {
      // Studio books use the seven-material vocabulary shared with the spine,
      // including the per-book sub-treatment (crackle / rib / marbling variant).
      paintBindingMaterial(ctx, w, h, material, tones, s, rnd, params.boardStyle ?? 0);
    } else {
      paintTexture(ctx, w, h, params.texture, colA, colB, s, rnd);
    }
  });
  paintVignette(ctx, w, h, colB);
  paintSpineEdge(ctx, w, h, colB, s, rnd);
  paintBands(ctx, w, h, colB, params.gilt, s);
  // Fore-edge: the text block's edge treatment, visible down the right side.
  if (params.edge && params.edge !== 'plain') {
    paintEdgeTreatment(ctx, w - 7 * s, h * 0.014, 7 * s, h * 0.972, params.edge, s, rnd);
  }
  // Frame + medallion are BLIND TOOLED: a lit impression offset down-right,
  // then the ink pass on top. Both passes use an identically-seeded PRNG so
  // the hand-drawn jitter lines up exactly and the pair reads as one pressed
  // line with a highlight, not as two sloppy strokes.
  const toolSeed = (params.seed ^ 0x700_1e60) >>> 0;
  const medallionY = title && opts.plate !== false ? h * 0.56 : h * 0.5;
  const medallionR = Math.min(w, h) * 0.19;
  const lit = hslStr(colA, 26, -10, 0.55);
  ctx.save();
  ctx.translate(1 * s, 1 * s);
  paintFrame(ctx, w, h, params, colB, s, mulberry32(toolSeed), lit);
  paintMedallion(ctx, w * 0.54, medallionY, medallionR, params, colB, s, mulberry32(toolSeed), lit);
  ctx.restore();
  paintFrame(ctx, w, h, params, colB, s, mulberry32(toolSeed));
  paintMedallion(ctx, w * 0.54, medallionY, medallionR, params, colB, s, mulberry32(toolSeed));

  if (title && opts.plate !== false) {
    paintTitlePlate(ctx, w, h, params, colA, colB, title, s, rnd);
  }

  if (params.cornerProtectors) {
    paintCornerProtectors(ctx, w, h, params.gilt, s);
  }

  // Wear, then the charm on top of it (charms are the newest thing on a book).
  paintWear(ctx, w, h, wear, tones, s, rnd);
  if (params.charm && params.charm !== 'none') {
    drawCoverCharm(ctx, params.charm, w, h, {
      color: charmColorCss(params.charmColor ?? 0),
      scale: s,
      rnd: mulberry32((params.seed ^ 0x0cba12) >>> 0),
      gilt: params.gilt,
    });
  }

  // Shared granulation overlay.
  const tile = getGranulationTile();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.07;
  for (let ty = 0; ty < h; ty += 256) {
    for (let tx = 0; tx < w; tx += 256) {
      ctx.drawImage(tile, tx, ty);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- the light rig ------------------------------------------------------
  // The pull-out cover has to be lit by the SAME sun as the shelf it came
  // from, or the book visibly changes material as it leaves the row. Same
  // pass order as the spine: AO into the board edges, key with a hot spot,
  // rim on the edges facing the source, and a specular catch on the gilt.
  if (opts.light !== false) {
    const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
    applyAmbientOcclusion(ctx, {
      rig,
      x: 0,
      y: 0,
      width: w,
      height: h,
      reach: Math.min(w, h) * 0.16,
      strength: 0.55,
      corners: true,
    });
    applyKeyLight(ctx, {
      rig,
      x: 0,
      y: 0,
      width: w,
      height: h,
      intensity: 0.92,
      hotSpot: rig.hotSpot * (material === 'silk' ? 1.25 : 0.85),
    });
    applyRimLight(ctx, {
      rig,
      x: 0,
      y: 0,
      width: w,
      height: h,
      thickness: Math.max(1.5, Math.min(w, h) * 0.02),
      strength: 0.85,
    });
    if (params.gilt) {
      const src = keyToSource(rig);
      applySpecularCatch(ctx, {
        rig,
        x: w * (src.x >= 0 ? 0.68 : 0.32),
        y: h * (src.y >= 0 ? 0.66 : 0.34),
        radius: Math.min(w, h) * 0.3,
        aspect: 1.9,
        strength: 0.34,
        colour: '#fff4cc',
      });
    }
  }

  // Pencil outline (double stroked, jittered) hugging the cover edge.
  ctx.strokeStyle = GRAPHITE;
  ctx.lineWidth = Math.max(0.9, 1.1 * s);
  ctx.lineJoin = 'round';
  strokeJitterRect(ctx, 1, 1, w - 2, h - 2, 11 * s, 0.8 * s, rnd);
  ctx.save();
  ctx.translate(0.6 * s, -0.5 * s);
  ctx.globalAlpha = 0.6;
  strokeJitterRect(ctx, 1, 1, w - 2, h - 2, 11 * s, 0.6 * s, rnd);
  ctx.restore();

  // Worn boards lose their corners — punch the rounded/bumped silhouette out
  // of the finished raster so the cover's outline matches its spine's.
  if (wear > 0.15) {
    const worn = applyOutlineWear(
      [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
      wear,
      s * 2.2,
      mulberry32((params.seed ^ 0x0e0d6e) >>> 0),
    );
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    const first = worn[0] as Pt;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < worn.length; i++) ctx.lineTo((worn[i] as Pt).x, (worn[i] as Pt).y);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}

/* ------------------------------- bake cache ------------------------------- */

const urlCache = new Map<string, string>();

/**
 * Bake-once data-URL for a cover. Keyed by seed, overrides, size and title —
 * repeated calls (overlay opens, backdrop re-renders) hit the cache.
 */
export function coverDataUrl(
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): string {
  const key = `${params.seed}|${params.palette}|${params.texture}|${params.frame}|${params.medallion}|${params.titleFont}|${params.gilt ? 1 : 0}|${params.material ?? '-'}|${params.titlePlate ?? '-'}|${params.cornerProtectors ? 1 : 0}|${params.insetPlate ? 1 : 0}|${params.edge ?? '-'}|${(params.wear ?? 0).toFixed(3)}|${params.charm ?? '-'}|${params.charmColor ?? 0}|${Math.round(w)}x${Math.round(h)}|${opts.plate === false ? 0 : 1}|${title}`;
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
