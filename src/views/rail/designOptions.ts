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
import { flatScheme, type FlatCtx, type FlatScheme } from '../../art/flat';
import { drawCaseCard, drawPlank, drawPost } from '../../art/flatShelf';
import { fnv1a } from '../../art/noise';
import { FLOOR_H, PLANK_H, RAIL_W } from '../../features/bookshelf/constants';
import {
  BUILDS,
  BUILD_IDS,
  DEFAULT_SHELF_DESIGN,
  PATTERNS,
  PATTERN_IDS,
  SHELF_PRESETS,
  type BuildId,
  type PatternId,
  type ShelfDesign,
} from '../../art/shelfDesign';
import { drawInScheme } from './designArt';
import {
  DEFAULT_WALLPAPER_ID,
  WALLPAPER_DEPTHS,
  WALLPAPER_INKS,
  WALLPAPER_PRESETS,
  WALLPAPER_SCALES,
  drawWallpaperCard,
  getWallpaper,
  renderWallpaperTile,
  wallpaperAxisKey,
  wallpaperColours,
  wallpaperTileKey,
  wallpaperTilePx,
  type WallpaperDepth,
  type WallpaperFamily,
  type WallpaperInk,
  type WallpaperScale,
  type WallpaperSpec,
} from '../../art/wallpaperDesign';
import {
  DEFAULT_THEME_ID,
  THEMES,
  THEME_IDS,
  getTheme,
  type ThemeId,
} from '../../art/themes';
import type { PickerOption } from './DesignPicker';

/** One seed for every case tile in the studio, so only the design varies. */
const CASE_SEED = fnv1a('studio|case');

/* ------------------------------ the presets ------------------------------ */

/**
 * A whole room in one value: its colours, its carpentry and its paper.
 *
 * This is NOT a new place to store anything. `RoomDesign` already carries the
 * build, the pattern and the wallpaper, and `LibraryPrefs.theme` already
 * carries the colours; a preset is a named bundle of values that already
 * exist, and applying one is two writes the studio was already making.
 *
 * It exists because a "room" was colour ONLY, and a reader reasonably expects
 * the thing at the top of the panel to set the look of the room rather than to
 * repaint it. The colour axis is still there underneath, still orthogonal —
 * you can repaint a preset without rebuilding it, which is the whole reason
 * the three vocabularies were kept independent in the first place.
 */
export interface RoomLook {
  theme: ThemeId;
  build: BuildId;
  pattern: PatternId;
  wallpaper: WallpaperSpec;
}

/**
 * How the presets are shelved in the picker.
 *
 * One word each, and every word is taken from a mood vocabulary the art
 * already carries (`BuildTag`, `ThemeTag`, `WallpaperMood`), because that is
 * how the presets were composed: a class is a steer applied to all four axes,
 * rolled with `withMood`, and then judged by eye. Searching the picker for
 * "cosy" therefore finds the cosy rooms as well as the cosy papers.
 */
export const ROOM_PRESET_GROUPS = [
  'Formal',
  'Grand',
  'Antique',
  'Quiet',
  'Cosy',
  'Botanical',
  'Coastal',
  'Storybook',
  'Rustic',
] as const;

export type RoomPresetGroup = (typeof ROOM_PRESET_GROUPS)[number];

export interface RoomPreset extends RoomLook {
  id: string;
  name: string;
  /** One line for the card. */
  blurb: string;
  group: RoomPresetGroup;
  /** The named paper this room hangs, kept so the blurb and search can use it. */
  paper: string;
}

/**
 * The wall a room card and the shelf both end up wearing.
 *
 * Papers are referenced by NAME rather than spelled out as four axes, so a
 * preset cannot quietly invent a paper that was never vetted — and so a paper
 * that carries a tone or a nib brings them along. `getWallpaper` is total, but
 * a typo would land on the bare wall silently, which is what
 * `tests/room-presets.test.ts` exists to catch.
 */
function room(
  id: string,
  name: string,
  blurb: string,
  group: RoomPresetGroup,
  theme: ThemeId,
  build: BuildId,
  pattern: PatternId,
  paper: string,
): RoomPreset {
  return { id, name, blurb, group, theme, build, pattern, paper, wallpaper: getWallpaper(paper).spec };
}

/**
 * Which classification a build's own mood words put it in.
 *
 * Used for exactly one entry — the house room, whose carpentry is whatever
 * `DEFAULT_SHELF_DESIGN` currently is and therefore cannot be classified by
 * hand. Writing "Quiet" next to it was true on the morning it was written and
 * false by the afternoon, when the default moved to a scriptorium; a card
 * filed under Quiet that is a toothed classical arcade reads as a bug.
 *
 * It doubles as the written-down relationship between `BuildTag` and these
 * nine words, which was otherwise only in the roll script.
 */
const GROUP_FOR_BUILD_TAG: Readonly<Record<string, RoomPresetGroup>> = {
  formal: 'Formal',
  refined: 'Formal',
  ornate: 'Grand',
  fancy: 'Grand',
  antique: 'Antique',
  severe: 'Antique',
  heavy: 'Antique',
  cosy: 'Cosy',
  whimsical: 'Storybook',
  goofy: 'Storybook',
  rustic: 'Rustic',
  natural: 'Botanical',
  airy: 'Botanical',
  plain: 'Quiet',
  modern: 'Quiet',
  utilitarian: 'Quiet',
};

function groupForBuild(build: BuildId): RoomPresetGroup {
  for (const tag of BUILDS[build].tags) {
    const group = GROUP_FOR_BUILD_TAG[tag];
    if (group !== undefined) return group;
  }
  return 'Quiet';
}

/* --------------------------- drawing a whole room ------------------------ */

/**
 * How much bigger than life the paper is drawn on a card.
 *
 * A card is ~148px wide and the real case is 1200 world px, so a wall drawn to
 * true scale would be five-pixel motifs — honest, and useless, since a reader
 * is looking at these cards precisely to see WHICH paper a preset hangs.
 *
 * This is the tile's size as a fraction of the card's short side, so a paper
 * keeps its own scale relative to its neighbours (a petite pinstripe stays
 * finer than a grand damask) while the whole family is magnified to where it
 * reads. Started at 1.15 and came down to 0.85 by looking at the sheets from
 * `scripts/probe-room-presets.mjs --mode=table`: at 1.15 the wall band showed
 * a single enormous motif and read as a picture hung behind the case rather
 * than as paper on it.
 */
const PAPER_ZOOM = 0.85;

/** The case's share of the card. The rest is wall, and has to stay wall. */
const CASE_SHARE_W = 0.73;
const CASE_SHARE_H = 0.92;

type Scratch = OffscreenCanvas | HTMLCanvasElement;

/**
 * Rendered wallpaper tiles, keyed by scheme AND by every axis of the spec.
 *
 * Deliberately TINY, and the reason is worth knowing before anyone raises it:
 * a room card's tile is keyed on the paper AND the room's colours, and every
 * preset brings its own colours, so two different preset cards essentially
 * never share a tile. What this saves is the repeat — the same card drawn in
 * the inline strip and again in the sheet, or redrawn after `designArt`'s FIFO
 * evicted the finished tile. A big cache here would buy nothing and hold
 * megabytes: one 768px tile is ~2.3MB of backing store.
 */
const PAPER_TILES = new Map<string, Scratch | null>();
const MAX_PAPER_TILES = 8;

function paperTile(spec: WallpaperSpec): Scratch | null {
  const size = Math.max(8, Math.round(wallpaperTilePx(spec)));
  // The module's OWN key function, not a hand-spelled copy of its axes. It
  // already carries the live scheme (every colour in a tile is derived from
  // it), every axis of the spec, the size, and the art revision — and it is
  // the fourth place in this app to have spelled those out by hand and the
  // fourth to have fallen behind them.
  const key = wallpaperTileKey(spec, size);
  const hit = PAPER_TILES.get(key);
  if (hit !== undefined) return hit;

  let tile: Scratch | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      tile = new OffscreenCanvas(size, size);
    } else if (typeof document !== 'undefined') {
      const el = document.createElement('canvas');
      el.width = size;
      el.height = size;
      tile = el;
    }
    const ctx = (tile as OffscreenCanvas | null)?.getContext('2d') as FlatCtx | null;
    if (ctx === null || ctx === undefined) tile = null;
    else renderWallpaperTile(ctx, size, spec);
  } catch {
    tile = null;
  }

  PAPER_TILES.set(key, tile);
  if (PAPER_TILES.size > MAX_PAPER_TILES) {
    const oldest = PAPER_TILES.keys().next();
    if (oldest.done !== true) PAPER_TILES.delete(oldest.value);
  }
  return tile;
}

/**
 * The papered wall, full bleed.
 *
 * Through `createPattern` off one rendered tile, never by calling
 * `renderWallpaperTile` repeatedly at an offset — see the note on
 * `drawWallpaperCard`: the tile's own clip lands on a fractional pixel and
 * draws a pale cross through the card. Any caller tiling this art has the same
 * obligation.
 */
export function drawPaperWall(ctx: FlatCtx, w: number, h: number, spec: WallpaperSpec): void {
  const tile = paperTile(spec);
  const pattern = tile === null ? null : ctx.createPattern(tile as CanvasImageSource, 'repeat');
  if (pattern === null) {
    ctx.fillStyle = wallpaperColours(spec).ground;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const size = (tile as HTMLCanvasElement).width;
  const k = Math.max(0.08, Math.min(1, (Math.min(w, h) * PAPER_ZOOM) / size));
  pattern.setTransform({ a: k, b: 0, c: 0, d: k, e: 0, f: 0 });
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
}

/**
 * A room, as one card: the paper on the wall, and the case standing against it.
 *
 * The case is drawn by `drawCaseCard` — the routine that draws every other case
 * preview in the studio — with ONE change, and it is worth spelling out because
 * it looks like a trick: the scheme handed in has a transparent `wall`. That
 * field is read in exactly one place in the whole case drawing (`flatShelf.ts`
 * fills the card's background with it), so a transparent value leaves the paper
 * showing through and every other pixel identical. The alternative was to clip
 * the case to its own silhouette, which means this file guessing the margins
 * `drawCaseCard` uses internally — a 1.8px arithmetic clearance of exactly the
 * kind this codebase has already shipped a bug for.
 */
export function drawRoomCard(ctx: FlatCtx, w: number, h: number, look: RoomLook): void {
  const scheme = getTheme(look.theme).scheme as FlatScheme;

  drawInScheme(scheme, () => drawPaperWall(ctx, w, h, look.wallpaper));

  drawInScheme({ ...scheme, wall: 'rgba(0,0,0,0)' }, () => {
    const caseW = w * CASE_SHARE_W;
    const caseH = h * CASE_SHARE_H;
    ctx.save();
    ctx.translate(w - caseW, h - caseH);
    drawCaseCard(ctx, caseW, caseH, CASE_SEED, { build: look.build, pattern: look.pattern });
    ctx.restore();
  });
}

/**
 * The rooms, already decorated.
 *
 * ## How these were composed, because it is not by taste alone
 *
 * Each classification is a STEER — one mood word per axis, taken from the
 * words the vocabularies already carry (`BuildTag`, `PatternSpec.tags`,
 * `ThemeTag`, `WallpaperMood`). `scripts/probe-room-presets.mjs --mode=roll`
 * applies that steer through `withMood`, rolls candidates, and draws them
 * through `drawRoomCard`; what survived being LOOKED at is below. Neither half
 * is optional — the dice found pairings nobody would have typed (a beehive
 * case under a honeycomb paper), and the eye threw out most of what the dice
 * offered (a gothic case in fairground pink).
 *
 * ## What the table is checked against
 *
 * Every build (52) and every timber pattern (50) appears at least once, so a
 * reader who only ever presses preset cards still meets the whole carpentry
 * vocabulary; no two presets share a paper; and no two are the same room. All
 * three are pinned by `tests/room-presets.test.ts` — a preset list that
 * quietly stopped covering the vocabulary would look exactly like one that
 * still did.
 *
 * ## The house room
 *
 * `quiet.house` is DERIVED from the three defaults rather than spelled out.
 * The room a fresh library opens in has to be a card the strip can show as
 * pressed, and writing today's default into this table by hand would make it
 * a second source of truth that goes stale the day somebody repoints one.
 */
export const ROOM_PRESETS: readonly RoomPreset[] = [
  /* ------------------------------- Formal -------------------------------- */
  room('formal.reading-room', 'The Reading Room', 'Walnut cabinet work and a wide drawing-room rule.',
    'Formal', 'walnut', 'faceFrame', 'greekKey', 'pin-wide'),
  room('formal.chambers', 'Chambers', 'Glazed barrister fronts under a broad regency stripe.',
    'Formal', 'mahogany', 'barrister', 'beaded', 'stripe-regency'),
  room('formal.athenaeum', 'Old Athenaeum', 'Beaded boards, scrolled brackets, and the house damask in sepia.',
    'Formal', 'athenaeum', 'bookbinder', 'modillion', 'damask-library'),
  room('formal.card-room', 'Card Room', 'Deep green panels and a cool herringbone, for long evenings.',
    'Formal', 'cardroom', 'vestry', 'linenfold', 'herring-slate'),
  room('formal.common-room', 'Common Room', 'A fumed oak arcade, fluted, under a running Greek key.',
    'Formal', 'fumed', 'cloister', 'fluted', 'fret-meander'),
  room('formal.blue-cabinet', 'Blue Cabinet', 'Brass straps and corner brackets against an Adam patera.',
    'Formal', 'lapis', 'campaign', 'strapwork', 'medallion-adam'),

  /* -------------------------------- Grand -------------------------------- */
  room('grand.gilt-salon', 'Gilt Salon', 'Columns and egg-and-dart, under a damask carved in gold.',
    'Grand', 'topaz', 'colonnade', 'eggDart', 'damask-gilt'),
  room('grand.observatory', 'The Observatory', 'Turned uprights and finials, beneath a gilded chain of stars.',
    'Grand', 'indigoroom', 'observatory', 'barleyTwist', 'const-astrolabe'),
  room('grand.orangery', 'The Orangery', 'Round-headed bays and a scalloped cresting on a gilt arcade.',
    'Grand', 'malachite', 'orangery', 'gadroon', 'arch-gilt'),
  room('grand.state-room', 'State Room', 'A stepped, toothed cornice over a wall of gold paterae.',
    'Grand', 'aubergine', 'scriptorium', 'guilloche', 'medallion-gilt'),
  room('grand.curiosity', 'Cabinet of Curiosities', 'Compartments, pulls and finials on gilded scrollwork.',
    'Grand', 'garnet', 'curiosity', 'marquetry', 'arab-gilt'),
  room('grand.lacquer-room', 'The Lacquer Room', 'A geometric fret, and a gold grove on a cloth ground.',
    'Grand', 'souk', 'chinoiserie', 'chineseFret', 'bamboo-lacquer'),

  /* ------------------------------- Antique ------------------------------- */
  room('antique.chapter-house', 'Chapter House', 'Pointed bays and battlements on a ruled chapel diaper.',
    'Antique', 'ebonised', 'gothic', 'trefoil', 'diaper-chapel'),
  room('antique.chantry', 'The Chantry', 'Trefoil heads, battlements, and a fleur-de-lys wall.',
    'Antique', 'tulipwood', 'chapel', 'quatrefoil', 'fleur-lys'),
  room('antique.refectory', 'Refectory', 'Ogee heads on heavy pegged timber, and a soft country toile.',
    'Antique', 'orchard', 'refectory', 'adzed', 'toile-timber'),
  room('antique.minster', 'The Minster', 'A gabled run over pointed bays, and low arches in stone.',
    'Antique', 'slateroof', 'minster', 'dogtooth', 'arch-crypt'),
  room('antique.counting-house', 'Counting House', 'Toothed boards over deep runs, on an illuminated ground.',
    'Antique', 'bramble', 'mercantile', 'blindArcade', 'diaper-illumination'),
  room('antique.lychgate', 'Lychgate', 'Strapped oak left out in the weather, and orchard pomegranates.',
    'Antique', 'cedar', 'lychgate', 'billet', 'pom-orchard'),

  /* -------------------------------- Quiet -------------------------------- */
  room('quiet.house', 'The House Room', 'Where every new bookcase starts, before you change a thing.',
    groupForBuild(DEFAULT_SHELF_DESIGN.build), DEFAULT_THEME_ID, DEFAULT_SHELF_DESIGN.build,
    DEFAULT_SHELF_DESIGN.pattern, DEFAULT_WALLPAPER_ID),
  /*
   * The plainest room there is, and it is spelled out rather than left to the
   * house room above. The house room follows `DEFAULT_SHELF_DESIGN`, which
   * moved from a plank case to a scriptorium while this table was being
   * written — taking the only plank preset with it, and with it the guarantee
   * that a reader who only presses preset cards can reach every carpentry.
   */
  room('quiet.plank', 'Plain Plank', 'A board, two uprights, and a finely woven paper behind them.',
    'Quiet', 'heather', 'plank', 'none', 'grass-reed'),
  room('quiet.atelier', 'Atelier', 'Thin uprights, thin boards, and a wall with nothing on it.',
    'Quiet', 'bone', 'atelier', 'cockBead', 'plain-parchment'),
  room('quiet.limed-study', 'Limed Study', 'Planed arrises, close ruling, and no other decisions.',
    'Quiet', 'limed', 'shaker', 'stringing', 'pin-study'),
  room('quiet.snowline', 'Snowline', 'Slim rails, and small even shells drifting up the wall.',
    'Quiet', 'snowline', 'ladder', 'reeded', 'scallop-shell'),
  room('quiet.drawing-office', 'Drawing Office', 'A fine grid of cubbies, and two crossing rules.',
    'Quiet', 'hallway', 'pigeonhole', 'chequer', 'tatter-shirting'),
  room('quiet.smoke-room', 'Smoke Room', 'Blue-grey boards with a ledge, under watered silk.',
    'Quiet', 'smoke', 'schoolroom', 'oyster', 'moire-watered'),

  /* --------------------------------- Cosy -------------------------------- */
  room('cosy.parlour', 'The Good Parlour', 'Nulled boards, a reeded cornice, and full-face chintz roses.',
    'Cosy', 'plaster', 'parlour', 'bobbin', 'rose-chintz'),
  room('cosy.tea-room', 'Tea Room', 'Turned spindles over every bay, and a sun-faded awning.',
    'Cosy', 'clotted', 'tearoom', 'beadReel', 'awning-tearoom'),
  room('cosy.scullery', 'Scullery', 'A fretted pelmet on every shelf, and a kitchen gingham.',
    'Cosy', 'pantry', 'valance', 'cane', 'gingham-kitchen'),
  room('cosy.inglenook', 'Inglenook', 'A cornice that will not lie straight, and a country check.',
    'Cosy', 'beech', 'cottage', 'lunette', 'tatter-country'),
  room('cosy.lantern', 'Paper Lantern', 'Little arched holes behind the books, and a cottage sprig.',
    'Cosy', 'lantern', 'dovecote', 'dotPunch', 'sprig-cottage'),
  room('cosy.hearthside', 'Hearthside', 'Turned posts, pegged boards, and knitted lozenges.',
    'Cosy', 'cherry', 'tavern', 'chipCarve', 'argyle-lambswool'),

  /* ------------------------------ Botanical ------------------------------ */
  room('botanical.conservatory', 'The Conservatory', 'Slender glazing bars against a garden trellis.',
    'Botanical', 'duckegg', 'conservatory', 'lattice', 'trellis-garden'),
  room('botanical.fernery', 'The Fernery', 'Round-headed bays, leaf and dart, and hothouse fronds.',
    'Botanical', 'forest', 'arch', 'waterLeaf', 'fern-hothouse'),
  room('botanical.potting-shed', 'Potting Shed', 'Ladder rails, sawn boards, one vine crossing the wall.',
    'Botanical', 'lichen', 'hayloft', 'sawn', 'vine-trailing'),
  room('botanical.tea-house', 'The Tea House', 'Stepped eaves and spindles, with canes and nodes behind.',
    'Botanical', 'ash', 'pagoda', 'lozenge', 'bamboo-grove'),
  room('botanical.apiary', 'The Apiary', 'Rounded cells in courses, and honey in one comb of five.',
    'Botanical', 'pistachio', 'beehive', 'burl', 'honey-comb'),
  room('botanical.herbarium', 'Herbarium', 'Small compartments, and mossy branches mirrored row by row.',
    'Botanical', 'laurel', 'apothecary', 'diaper', 'laurel-victory'),

  /* ------------------------------- Coastal ------------------------------- */
  room('coastal.harbour', 'Harbour Light', 'Beadboard and spindles, under two strands twisting in gold.',
    'Coastal', 'harbour', 'seaside', 'rope', 'rope-guilloche'),
  room('coastal.driftwood', 'Driftwood', 'Every edge worn round, against a woven natural paper.',
    'Coastal', 'driftwood', 'driftwood', 'wormy', 'grass-sisal'),
  room('coastal.boathouse', 'Boathouse', 'Strapped uprights and a plate rail, and mattress ticking.',
    'Coastal', 'chalkblue', 'stable', 'notched', 'ticking-mattress'),
  room('coastal.tide-pool', 'Tide Pool', 'Round uprights and braced bays, under indigo wave crests.',
    'Coastal', 'turquoise', 'cabin', 'gouged', 'scallop-seigaiha'),
  room('coastal.stern-gallery', 'Stern Gallery', 'A carved wave along the top, and deep water behind it.',
    'Coastal', 'reef', 'galleon', 'vitruvian', 'serp-lagoon'),
  room('coastal.sea-fret', 'Sea Fret', 'Banded and bossed, with shells drawn softly in the haze.',
    'Coastal', 'seafret', 'steamer', 'herringbone', 'scallop-tide'),

  /* ------------------------------ Storybook ------------------------------ */
  room('storybook.toy-box', 'The Toy Box', 'Fat rounded boards, a big brass knob, and spots in book cloth.',
    'Storybook', 'watermelon', 'toybox', 'sunburst', 'polka-cloth'),
  room('storybook.carnival', 'Carnival', 'A sawtooth awning, brass buttons, and harlequin lozenges.',
    'Storybook', 'carousel', 'carnival', 'chevron', 'harlequin-carnival'),
  room('storybook.gingerbread', 'Gingerbread', 'Scallops everywhere, and pinwheels turning on the wall.',
    'Storybook', 'cornflower', 'gingerbread', 'cableFlute', 'pinwheel-nursery'),
  room('storybook.treehouse', 'Treehouse', 'Rungs, braces and pegs, under a crescent moon and star.',
    'Storybook', 'violetroom', 'treehouse', 'tiled', 'moon-nursery'),
  room('storybook.windmill', 'Windmill', 'Braced bays and a sawtooth crest, with a little sun above.',
    'Storybook', 'marigold', 'windmill', 'bookMatch', 'sun-marigold'),
  room('storybook.rookery', 'Rookery', 'Too many small holes, and bees sown small across the wall.',
    'Storybook', 'lemongrove', 'rookery', 'cube', 'bee-skep'),

  /* -------------------------------- Rustic ------------------------------- */
  room('rustic.crate-stack', 'Crate Stack', 'Stacked packing crates, and slats woven over and under.',
    'Rustic', 'teak', 'crate', 'crossband', 'basket-rush'),
  room('rustic.slab', 'Rustic Slab', 'Thick pegged boards, planed once, over pale linen ticking.',
    'Rustic', 'birch', 'slab', 'adzed', 'ticking-linen'),
  room('rustic.sawmill', 'Sawmill', 'Toothed boards and a sawtooth crest, and rows of flame stitch.',
    'Rustic', 'pine', 'sawmill', 'sawn', 'flame-bargello'),
  room('rustic.workbench', 'Workbench', 'Strapped and braced, with one big comb of a wall behind it.',
    'Rustic', 'apothecary', 'workbench', 'strapwork', 'honey-grand'),
  room('rustic.tavern', 'Tavern', 'Turned posts and spindles over every bay, and a picnic check.',
    'Rustic', 'tangerine', 'tavern', 'bobbin', 'gingham-picnic'),
  room('rustic.country-store', 'Country Store', 'Counter-shop carpentry, and the weaver’s fruit behind it.',
    'Rustic', 'lacquerred', 'mercantile', 'dentil', 'pom-velvet'),
];

/** Look up a preset by id. Null rather than a fallback — the caller decides. */
export function getRoomPreset(id: string): RoomPreset | null {
  return ROOM_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Which preset the room is currently wearing, or '' for a room of your own.
 *
 * Compared through `wallpaperAxisKey` rather than field by field, for the same
 * reason `LibraryStudio.sameSpec` is: a spec that grows an axis leaves a
 * hand-spelled comparison quietly stale, and this answer decides which card the
 * strip shows as chosen.
 */
export function matchRoomPreset(look: RoomLook): string {
  const wall = wallpaperAxisKey(look.wallpaper);
  return (
    ROOM_PRESETS.find(
      (p) =>
        p.theme === look.theme &&
        p.build === look.build &&
        p.pattern === look.pattern &&
        wallpaperAxisKey(p.wallpaper) === wall,
    )?.id ?? ''
  );
}

/** The presets, as cards — each one painted in ITS OWN colours and paper. */
export function roomPresetOptions(): readonly PickerOption[] {
  return ROOM_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    blurb: preset.blurb,
    group: preset.group,
    // Every axis the drawing varies on. The theme has to be here because the
    // card paints itself in a scheme the tile cache knows nothing about (see
    // `drawInScheme`), and the paper has to be here through `wallpaperAxisKey`
    // because two papers can differ in only a tone or a nib.
    artKey: `preset|${preset.theme}|${preset.build}.${preset.pattern}|${wallpaperAxisKey(preset.wallpaper)}`,
    terms: `${preset.group} ${getTheme(preset.theme).name} ${BUILDS[preset.build].name} ${
      PATTERNS[preset.pattern].name
    } ${getWallpaper(preset.paper).name} ${getTheme(preset.theme).tags.join(' ')}`,
    draw: (ctx: FlatCtx, w: number, h: number) => drawRoomCard(ctx, w, h, preset),
  }));
}

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
