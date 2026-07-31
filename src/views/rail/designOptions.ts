/**
 * src/views/rail/designOptions.ts — the three vocabularies, turned into cards.
 *
 * One place that knows how each vocabulary is previewed, so the inline strip
 * and the long sheet cannot disagree about what a preset looks like. Every
 * `draw` here goes straight to the real renderer for its axis; every `artKey`
 * spells out the axes that drawing actually varies on, because the tile cache
 * keys on it and a key that forgets an axis serves the wrong picture forever.
 *
 * The seeds are FIXED, not random. A picker's job is to isolate one variable:
 * two build tiles drawn from different seeds differ in their book rows as well
 * as their carpentry, and the eye reads the books first.
 */
import type { BookDesign } from '../../art/bookDesign';
import {
  BOOK_PRESETS,
  MATERIAL_LOOK_LABELS,
  drawBookSpine,
  resolveBookDesign,
} from '../../art/bookDesign';
import { flatScheme, type FlatCtx } from '../../art/flat';
import { drawCaseCard, drawPlank, drawPost } from '../../art/flatShelf';
import { fnv1a } from '../../art/noise';
import { FLOOR_H, PLANK_H, RAIL_W } from '../../features/bookshelf/constants';
import {
  BUILDS,
  BUILD_IDS,
  PATTERNS,
  PATTERN_IDS,
  SHELF_PRESETS,
  type BuildId,
  type PatternId,
} from '../../art/shelfDesign';
import {
  WALLPAPER_DEPTHS,
  WALLPAPER_PRESETS,
  WALLPAPER_SCALES,
  drawWallpaperCard,
  type WallpaperDepth,
  type WallpaperScale,
  type WallpaperSpec,
} from '../../art/wallpaperDesign';
import type { PickerOption } from './DesignPicker';

/** One seed for every case tile in the studio, so only the design varies. */
const CASE_SEED = fnv1a('studio|case');

/* ------------------------------- the case -------------------------------- */

/** Build tiles, each shown wearing the pattern the room is currently in. */
export function buildOptions(pattern: PatternId): readonly PickerOption[] {
  return BUILD_IDS.map((id) => {
    const spec = BUILDS[id];
    return {
      id,
      name: spec.name,
      blurb: spec.blurb,
      artKey: `case|${id}|${pattern}`,
      terms: 'build carpentry structure case shelf',
      draw: (ctx: FlatCtx, w: number, h: number) =>
        drawCaseCard(ctx, w, h, CASE_SEED, { build: id, pattern }),
    };
  });
}

/**
 * A close look at the timber: one board and one upright, at TRUE world scale.
 *
 * The whole case is the wrong picture for this axis. A board is 40 world px
 * tall and an upright 34 wide, so on a 104x72 case card the board is five
 * pixels of a pattern that is beading or fluting or rope — indistinguishable,
 * and the studio would be offering twelve identical tiles. This crops the real
 * parts instead of shrinking them: same drawers, same seeds, same pads the
 * bake uses, just less of them in frame.
 */
export function drawTimberCard(
  ctx: FlatCtx,
  w: number,
  h: number,
  build: BuildId,
  pattern: PatternId,
): void {
  const design = { build, pattern };
  ctx.fillStyle = flatScheme().recess;
  ctx.fillRect(0, 0, w, h);

  // The upright is drawn over-tall and phase-locked to a whole floor, exactly
  // as textures.ts bakes it — that is what puts a capital or a rung where the
  // shelf puts it rather than 14px off.
  const postX = Math.max(2, w * 0.06);
  drawPost(ctx, postX, -12, RAIL_W, h + 24, 0x2f19, design, {
    x: postX,
    y: -12,
    w: RAIL_W,
    h: FLOOR_H,
  });

  // The board at its real height, running off both edges of the card the way
  // it runs the whole 1200px width of the case.
  const boardY = h - PLANK_H - Math.max(3, h * 0.06);
  drawPlank(ctx, -8, boardY, w + 16, PLANK_H, 0x51a1, design);
}

/** Pattern tiles, each worked into the build the room is currently made of. */
export function patternOptions(build: BuildId): readonly PickerOption[] {
  return PATTERN_IDS.map((id) => {
    const spec = PATTERNS[id];
    return {
      id,
      name: spec.name,
      blurb: spec.blurb,
      artKey: `timber|${build}|${id}`,
      terms: 'pattern timber carving moulding',
      draw: (ctx: FlatCtx, w: number, h: number) => drawTimberCard(ctx, w, h, build, id),
    };
  });
}

/** The sixty named cases — a build and a pattern already chosen together. */
export function shelfPresetOptions(): readonly PickerOption[] {
  return SHELF_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    blurb: preset.blurb,
    group: BUILDS[preset.build].name,
    artKey: `case|${preset.build}|${preset.pattern}`,
    terms: `${BUILDS[preset.build].name} ${PATTERNS[preset.pattern].name}`,
    draw: (ctx: FlatCtx, w: number, h: number) =>
      drawCaseCard(ctx, w, h, CASE_SEED, { build: preset.build, pattern: preset.pattern }),
  }));
}

/* ------------------------------ the wallpaper ---------------------------- */

function wallpaperKey(spec: WallpaperSpec): string {
  return `wall|${spec.pattern}|${spec.scale}|${spec.depth}|${spec.ink}`;
}

/** The fifty-five named papers, grouped by motif. */
export function wallpaperOptions(): readonly PickerOption[] {
  return WALLPAPER_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    blurb: preset.blurb,
    group: preset.spec.pattern,
    artKey: wallpaperKey(preset.spec),
    terms: `${preset.spec.pattern} ${preset.spec.scale} ${preset.spec.depth} ${preset.spec.ink}`,
    draw: (ctx: FlatCtx, w: number, h: number) => drawWallpaperCard(ctx, w, h, preset.spec),
  }));
}

const SCALE_BLURB: Record<WallpaperScale, string> = {
  petite: 'A fine repeat, close to the eye.',
  small: 'Small motif, quiet wall.',
  medium: 'The middle of the road.',
  large: 'Big enough to see across the room.',
  grand: 'Ballroom scale.',
};

const DEPTH_BLURB: Record<WallpaperDepth, string> = {
  flat: 'One face. Printed, not moulded.',
  low: 'A hairline of thickness.',
  raised: 'The motif stands off the wall.',
  carved: 'Cut deep, like a plaster relief.',
};

/** Five scale tiles, each drawn in the paper the wall is already wearing. */
export function scaleOptions(spec: WallpaperSpec): readonly PickerOption[] {
  return WALLPAPER_SCALES.map((scale) => {
    const variant = { ...spec, scale };
    return {
      id: scale,
      name: scale,
      blurb: SCALE_BLURB[scale],
      artKey: wallpaperKey(variant),
      draw: (ctx: FlatCtx, w: number, h: number) => drawWallpaperCard(ctx, w, h, variant),
    };
  });
}

/** Four relief tiles. Depth is thickness, never a shadow — see the module. */
export function depthOptions(spec: WallpaperSpec): readonly PickerOption[] {
  return WALLPAPER_DEPTHS.map((depth) => {
    const variant = { ...spec, depth };
    return {
      id: depth,
      name: depth,
      blurb: DEPTH_BLURB[depth],
      artKey: wallpaperKey(variant),
      draw: (ctx: FlatCtx, w: number, h: number) => drawWallpaperCard(ctx, w, h, variant),
    };
  });
}

/* ------------------------------ the bindings ----------------------------- */

/**
 * A binding, shown as one book standing on a board.
 *
 * The recess behind it and the plank under it come from the live scheme, so a
 * card is judged against the shelf it will actually stand on — a pale vellum
 * reads very differently against reef timber than against athenaeum's.
 */
export function drawBindingCard(
  ctx: FlatCtx,
  w: number,
  h: number,
  design: BookDesign,
): void {
  const room = flatScheme();
  ctx.fillStyle = room.recess;
  ctx.fillRect(0, 0, w, h);

  const plankH = Math.max(4, h * 0.1);
  const boardY = h - plankH;
  // Wide enough that the material's fine work clears its 11px floor, narrow
  // enough that the silhouette still reads as a book rather than a panel.
  const spineW = Math.max(18, Math.min(w * 0.34, 42));
  const spineH = boardY - h * 0.08;
  drawBookSpine(ctx, (w - spineW) / 2, boardY - spineH, spineW, spineH, design);
  drawPlank(ctx, 0, boardY, w, plankH, 0x51a1);
}

export interface BindingCardOptions {
  /** The book's own cloth index, so the card previews THIS book rebound. */
  cloth?: number;
  accent?: number;
  gilt?: boolean;
  labelAt?: number;
  /** The book's art seed — decides the accent and the material's grain. */
  seed: number;
}

/** The sixty-two bindings, grouped by the material they are covered in. */
export function bindingOptions(book: BindingCardOptions): readonly PickerOption[] {
  return BOOK_PRESETS.map((preset) => {
    const design = resolveBookDesign({ ...book, preset: preset.id });
    return {
      id: preset.id,
      name: preset.label,
      blurb: `${MATERIAL_LOOK_LABELS[preset.material]} · ${preset.decorations.join(', ')}`,
      group: MATERIAL_LOOK_LABELS[preset.material],
      // The cloth and the gilt are the book's, not the preset's, so two books
      // showing the same preset are two different pictures.
      artKey: `bind|${preset.id}|${design.cloth}|${design.accent}|${design.gilt ? 'g' : 'n'}|${design.labelAt.toFixed(2)}`,
      terms: `${preset.shape} ${preset.material} ${preset.decorations.join(' ')}`,
      draw: (ctx: FlatCtx, w: number, h: number) => drawBindingCard(ctx, w, h, design),
    };
  });
}
