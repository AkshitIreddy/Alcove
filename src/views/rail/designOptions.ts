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
  type ShelfDesign,
} from '../../art/shelfDesign';
import { drawInScheme } from './designArt';
import {
  WALLPAPER_DEPTHS,
  WALLPAPER_INKS,
  WALLPAPER_PRESETS,
  WALLPAPER_SCALES,
  drawWallpaperCard,
  wallpaperAxisKey,
  type WallpaperDepth,
  type WallpaperFamily,
  type WallpaperInk,
  type WallpaperScale,
  type WallpaperSpec,
} from '../../art/wallpaperDesign';
import { THEMES, THEME_IDS } from '../../art/themes';
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
 * and the studio would be offering fifty identical tiles. This crops the real
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

/**
 * The rooms, as cards — each one painted in ITS OWN colours.
 *
 * There were four of these and they lived inline as a grid of big cards, which
 * was right for four. There are now sixty, and sixty cards in a 376px sheet is
 * four thousand pixels of scrolling before the shelves section even starts —
 * the same wall of tiles the case and paper axes were taken behind a picker to
 * avoid. So the room joins them: eight inline, the rest a search away.
 *
 * `design` is the carpentry the room is currently built in, so a card shows the
 * reader's own bookcase repainted rather than a plank case they do not own.
 */
export function themeOptions(design: ShelfDesign): readonly PickerOption[] {
  return THEME_IDS.map((id) => {
    const theme = THEMES[id];
    return {
      id,
      name: theme.name,
      blurb: theme.blurb,
      artKey: `room|${id}|${design.build}|${design.pattern}`,
      terms: `${theme.blurb} ${tagsOf(theme).join(' ')}`,
      draw: (ctx: FlatCtx, w: number, h: number) =>
        drawInScheme(theme.scheme, () =>
          drawCaseCard(ctx, w, h, fnv1a(`${id}|card`), design),
        ),
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

/**
 * What a family is called on a picker heading. The ids are the words the art
 * file thinks in; these are the words a reader shops in.
 */
const WALLPAPER_FAMILY_LABELS: Record<WallpaperFamily, string> = {
  ruled: 'Ruled',
  stripe: 'Stripes',
  check: 'Checks',
  lattice: 'Lattice',
  spot: 'Spots & stars',
  botanical: 'Botanical',
  figured: 'Figured',
};

/**
 * Card art is cached on this string, so it has to carry EVERY axis the card
 * draws. It was a hand-spelled copy of the first four, and two papers that
 * differed only in tone or nib would have shared one tile — the picker showing
 * the reader a paper that is not the one they are about to hang. Borrowed from
 * the module that owns the spec so it cannot fall behind again.
 */
function wallpaperKey(spec: WallpaperSpec): string {
  return `wall|${wallpaperAxisKey(spec)}`;
}

/**
 * The fifty named papers, grouped by FAMILY — seven sections, not the
 * twenty-two the motif gives. A section per motif is two cards wide and the
 * sheet becomes a list of headings.
 */
export function wallpaperOptions(): readonly PickerOption[] {
  return WALLPAPER_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    blurb: preset.blurb,
    group: WALLPAPER_FAMILY_LABELS[preset.family],
    artKey: wallpaperKey(preset.spec),
    // The mood words go in too, so searching "cosy" finds the papers tagged
    // cosy rather than only the ones with it in the blurb.
    terms: `${preset.spec.pattern} ${preset.spec.scale} ${preset.spec.depth} ${preset.spec.ink} ${preset.tags.join(' ')}`,
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

/**
 * What the ink slots actually mean, in the reader's words.
 *
 * Named after where the colour is BORROWED from rather than after the colour
 * itself, because that is the only description that stays true in every room:
 * "timber" is warm oak in the athenaeum and sea-green in the reef, and calling
 * the slot "brown" would be a lie in three rooms out of four.
 */
const INK_BLURB: Record<WallpaperInk, string> = {
  paper: 'Barely there — the wall, faintly marked.',
  deep: 'The same ink, printed harder.',
  timber: "Borrowed from the case's own timber.",
  recess: 'The dark from behind the books.',
  gilt: 'A warm gold pass over the paper.',
  cloth: "The room's first book cloth.",
};

/**
 * Six ink tiles: the wall's whole colour range, at last offered as a control.
 *
 * The wall's colour is TWO choices, and only one of them was reachable. The
 * ground comes from the room (four of those, in the colour row above); the
 * motif's own colour comes from this slot, and until now it could only be
 * changed by choosing a whole different named paper — so a reader who liked
 * their trellis and wanted it in gold had to go and hunt for a gold trellis.
 * Four grounds x six inks is twenty-four walls, all of them already drawable.
 */
export function inkOptions(spec: WallpaperSpec): readonly PickerOption[] {
  return WALLPAPER_INKS.map((ink) => {
    const variant = { ...spec, ink };
    return {
      id: ink,
      name: ink,
      blurb: INK_BLURB[ink],
      artKey: wallpaperKey(variant),
      draw: (ctx: FlatCtx, w: number, h: number) => drawWallpaperCard(ctx, w, h, variant),
    };
  });
}

/* -------------------------------- moods ---------------------------------- */

/**
 * The mood words one vocabulary entry carries, read STRUCTURALLY.
 *
 * The tagging pass over `art/shelfDesign`, `art/wallpaperDesign` and
 * `art/themes` lands separately from this panel, so everything here has to be
 * true both before and after it arrives: an untagged vocabulary answers `[]`,
 * every filter built on it degrades to "all of them", and the chip row that
 * offers the moods simply does not appear. `moods` is accepted alongside
 * `tags` because either is a reasonable name for that pass to have chosen, and
 * guessing wrong should cost a fallback rather than a feature.
 */
export function tagsOf(spec: unknown): readonly string[] {
  if (spec === null || typeof spec !== 'object') return [];
  const record = spec as { tags?: unknown; moods?: unknown };
  const raw = Array.isArray(record.tags) ? record.tags : record.moods;
  if (!Array.isArray(raw)) return [];
  return raw.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
}

/**
 * Every mood word any vocabulary uses, commonest first.
 *
 * Commonest first because the row is offered as a way to STEER the dice: a tag
 * that only one of a hundred-odd designs carries narrows the roll to a single
 * answer, which is a preset with extra steps. Ties break alphabetically so the
 * row does not shuffle between reloads.
 *
 * Deliberately not memoised. It is a few hundred array reads over static data,
 * its one caller holds it in a `createMemo` already, and a module-level cache
 * would go stale the moment a vocabulary is hot-replaced underneath it — which
 * is exactly what happens while these lists are being tagged.
 */
export function moodTags(): readonly string[] {
  const counts = new Map<string, number>();
  const add = (spec: unknown): void => {
    for (const tag of tagsOf(spec)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  };
  for (const id of BUILD_IDS) add(BUILDS[id]);
  for (const id of PATTERN_IDS) add(PATTERNS[id]);
  for (const preset of SHELF_PRESETS) add(preset);
  for (const paper of WALLPAPER_PRESETS) add(paper);
  for (const id of THEME_IDS) add(THEMES[id]);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([tag]) => tag);
}

/**
 * The entries of one vocabulary that answer to `mood`.
 *
 * An empty mood means "anything". A mood NO entry on this axis carries also
 * means "anything" for that axis rather than nothing: a roll is made of four
 * independent picks, and a mood the papers know but the carpentry does not
 * should still steer the paper instead of leaving the case unrollable.
 */
export function withMood<T>(
  list: readonly T[],
  mood: string,
  specOf: (item: T) => unknown,
): readonly T[] {
  if (mood.length === 0) return list;
  const hits = list.filter((item) => tagsOf(specOf(item)).includes(mood));
  return hits.length > 0 ? hits : list;
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
