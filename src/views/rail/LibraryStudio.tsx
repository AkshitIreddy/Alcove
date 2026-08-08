/**
 * src/views/rail/LibraryStudio.tsx — the studio's "This library" tab.
 *
 * The room, and everything in it that is not a book. Five things are chosen
 * here and they are deliberately independent:
 *
 *  - WHICH BOOKCASE you are standing in (the collection, top of the sheet);
 *  - a PRESET, which sets the next three at once — the whole room in one
 *    press, classified (formal, cosy, storybook…) so it can be browsed;
 *  - the COLOUR SCHEME, whole-room or one part at a time;
 *  - how the case is BUILT and what is worked into its timber
 *    (art/shelfDesign.ts — fifty-two carpentries x fifty treatments);
 *  - what is on the WALL (art/wallpaperDesign.ts — motifs across five scales,
 *    four reliefs and six ink slots, every one of them offered here: the ink
 *    slot used to be reachable only by finding a named paper that used it).
 *
 * The presets are why this order changed. The top of the sheet used to be
 * sixty ROOMS, and a room is a colour scheme — so the one control that looked
 * like "set the look of this library" repainted the case and left its
 * carpentry and its wall exactly as they were, which is the opposite of what
 * the word promises. Presets keep the promise; the colour row underneath now
 * says out loud that it is colour and only colour.
 *
 * Colour and carpentry are still orthogonal underneath: a gothic case is
 * gothic in every room, and repainting the room must not quietly rebuild the
 * furniture. A preset writes both — it is a bundle of values, not a coupling.
 *
 * The long axes do NOT live inline. Sixty named cases and fifty-five papers
 * dumped into a 376px sheet is a wall of tiles nobody reads, so each axis
 * shows eight real previews and a way through to the rest (DesignStrip →
 * DesignPicker). The sheet swaps to the picker rather than floating it above:
 * one sheet at a time keeps Escape, the panel push and the tab ring simple.
 *
 * That now includes the two PART colour rows. They are dots rather than cards,
 * so they looked short enough to expand in place — and they were, at four
 * rooms. At sixty they put a hundred and twenty 26px dots into the panel, none
 * of them named, between the reader and everything below. Same shape as
 * everything else here: a featured head, and a press through to the sheet.
 *
 * Every tile is painted by the routine that paints the real thing —
 * `drawCaseCard` for the case, `drawWallpaperCard` for the wall — under the
 * room's own scheme. A picker that lies about what you get is worse than no
 * picker.
 */
import { For, Show, createMemo, createSignal, onMount, type JSX } from 'solid-js';
import { type FlatCtx, type FlatScheme } from '../../art/flat';
import { drawCaseCard } from '../../art/flatShelf';
import { fnv1a } from '../../art/noise';
import {
  BUILDS,
  PATTERNS,
  SHELF_PRESETS,
  getShelfPreset,
  type BuildId,
  type PatternId,
} from '../../art/shelfDesign';
import {
  FEATURED_THEME_IDS,
  THEME_IDS,
  getTheme,
  type ColourScheme,
  type LibraryTheme,
  type ThemeId,
} from '../../art/themes';
import {
  WALLPAPER_PRESETS,
  drawWallpaperCard,
  getWallpaper,
  wallpaperAxisKey,
  type WallpaperDepth,
  type WallpaperInk,
  type WallpaperScale,
  type WallpaperSpec,
} from '../../art/wallpaperDesign';
import {
  curateList,
  saveRoomAsPreset,
  type CurationAxis,
  type Stars,
} from '../../data/shelfOfMine';
import {
  libraryPrefs,
  loadLibraryPrefs,
  partTheme,
  resolveLibrary,
  saveLibraryPrefs,
  type LibraryPrefs,
} from '../../features/bookshelf/libraryPrefs';
import YourDesigns from '../../features/packs/YourDesigns';
import BookcasesPanel from './BookcasesPanel';
import DesignPicker, { type PickerOption } from './DesignPicker';
import OwnColour from './OwnColour';
import DesignStrip, { cappedTo } from './DesignStrip';
import { DesignCanvas, drawInScheme } from './designArt';
import {
  ROOM_PRESETS,
  buildOptions,
  depthOptions,
  getRoomPreset,
  inkOptions,
  matchRoomPreset,
  patternOptions,
  roomPresetOptions,
  scaleOptions,
  shelfPresetOptions,
  themeOptions,
  wallpaperOptions,
  type RoomLook,
} from './designOptions';
import {
  activeRoomDesign,
  loadDesignPrefs,
  saveRoomDesign,
  saveWallpaper,
  shelfDesignOf,
  type RoomDesign,
} from '../../data/designPrefs';
import { stopShelfKeys } from './shelfKeys';
import '../../styles/studio.css';

const WALL_W = 328;
const WALL_H = 116;

/** Which long sheet has taken over the panel, if any. */
type Sheet =
  | null
  | 'preset'
  | 'room'
  | 'shelf-colour'
  | 'wall-colour'
  | 'build'
  | 'pattern'
  | 'named'
  | 'wallpaper';

/**
 * The sheet's own word for a list, and the reader's.
 *
 * Two vocabularies rather than one because they answer different questions: a
 * `Sheet` is "which panel is up", scoped to this file and free to be renamed,
 * while a `CurationAxis` is a key written into the reader's SQLite row and can
 * never be renamed without splitting their curation in two. Spelled out as one
 * table so the strip below and the sheet above cannot drift — passing 'colour'
 * on the strip and 'room' on the sheet would give one list two arrangements,
 * which is precisely the bug the shared controller exists to make impossible.
 */
const SHEET_AXIS: Record<Exclude<Sheet, null>, CurationAxis> = {
  preset: 'room-preset',
  room: 'colour',
  'shelf-colour': 'shelf-colour',
  'wall-colour': 'wall-colour',
  build: 'build',
  pattern: 'pattern',
  named: 'named-case',
  wallpaper: 'wallpaper',
};

/** One seed for every part-colour card, so only the colour varies across them. */
const PART_CARD_SEED = fnv1a('studio|part-colour');

/**
 * The featured eight in front, then the other fifty-two.
 *
 * `FEATURED_THEME_IDS` is a curated SPAN of the library — dark wood, pale wood,
 * muted paint, a loud one — rather than the head of `THEME_IDS`, so `cappedTo`
 * cannot find it on its own. Put it in front and the shared helper's own rule
 * (the head of the list, with the reader's choice swapped into the last slot)
 * is exactly the rule these rows want, instead of a fourth hand-rolled copy of
 * it.
 */
const COLOUR_ORDER: readonly ThemeId[] = [
  ...FEATURED_THEME_IDS,
  ...THEME_IDS.filter((id) => !FEATURED_THEME_IDS.includes(id)),
];

/*
 * A `ThemeCard` component lived here: one big card per room, four of them, in a
 * two-across grid. It went when the rooms did — there are sixty now, and the
 * card is `themeOptions()` in designOptions.ts so that the inline strip and the
 * long sheet cannot disagree about what a room looks like. The rule it carried
 * survives intact: the card is painted by `drawCaseCard` in that room's own
 * colours AND in the carpentry the reader has chosen, because a picker that
 * shows a plain plank case while the shelf behind it is a gothic arcade is the
 * same drift that had the cards previewing a watercolour room after the shelf
 * went flat.
 */

/**
 * The active room's palette, spelled out — and now it says so.
 *
 * This used to be a bare row of nine colour chips under its own "the palette"
 * heading at the very foot of the sheet, two rows below the colour chips that
 * ARE buttons. Every reader who found it pressed it, nothing happened, and the
 * studio got reported as broken. It was never a control and there is nothing
 * for it to control: a room's colours come from its theme, and there is no
 * per-hex override in the model to offer without inventing one.
 *
 * So it stops pretending. Each swatch now carries the word for what it is, the
 * six cloths are captioned with the one thing a reader wants them for, and the
 * whole thing moved up under the four room cards — where it answers the
 * question those cards raise instead of trailing the sheet like an orphan.
 * Colours are inline because they come from the data; everything else is CSS.
 */
function Swatches(props: { scheme: ColourScheme; name: string }): JSX.Element {
  const parts = (): readonly { colour: string; label: string }[] => [
    { colour: props.scheme.timber, label: 'case' },
    { colour: props.scheme.recess, label: 'behind' },
    { colour: props.scheme.wall, label: 'wall' },
  ];

  return (
    <div class="nb-legend" role="img" aria-label={`${props.name} palette`}>
      <div class="nb-legend-line">
        <For each={parts()}>
          {(part) => (
            <span class="nb-legend-item">
              <span class="nb-legend-dot" style={{ background: part.colour }} />
              {part.label}
            </span>
          )}
        </For>
      </div>
      <div class="nb-legend-line">
        <span class="nb-legend-caption">new books here are bound in</span>
        <For each={props.scheme.cloths}>
          {(cloth) => <span class="nb-legend-dot" style={{ background: cloth[0] }} />}
        </For>
      </div>
    </div>
  );
}

/**
 * One part's colour row: the featured colours as dots, and the rest a press
 * away.
 *
 * Keyed by the `LibraryPrefs` field it writes, so a row cannot drift from the
 * pref it edits. Dots rather than names because sixty room names stacked twice
 * is a wall of text for something the eye answers instantly.
 *
 * It used to expand IN PLACE, and that was the wrong half of the studio's own
 * shape. Sixty 26px dots, twice, in a 376px sheet is a screen and a half of
 * confetti pushed in front of the wallpaper section — and sixty colours with no
 * name on any of them, so the only way to find "the mahogany one" was to hover
 * every dot in turn. It now does what every other long axis in this panel does:
 * a featured head inline, and a way through to `DesignPicker`, which has search,
 * names, and a card painted in the colours this press would actually produce.
 * The reader can still reach all sixty; they just arrive somewhere that can
 * hold sixty.
 *
 * The current choice is always among the head (`cappedTo`). Without that,
 * picking a colour from the sheet would leave no dot pressed, and the row would
 * read as though the choice had been forgotten.
 */
function ColourRow(props: {
  part: 'shelf' | 'wall';
  label: string;
  /** The row's own heading. The wall has two colour rows; they cannot both
      be called "colour" or neither says which half it moves. */
  title: string;
  /** The list this row is a window onto — the same word its sheet passes. */
  axis: CurationAxis;
  colour(theme: LibraryTheme): string;
  onPick(id: ThemeId): void;
  /** Hands the other fifty-two to the sheet. */
  onMore(): void;
}): JSX.Element {
  const active = (): ThemeId => partTheme(libraryPrefs, props.part);

  /**
   * The reader's arrangement, applied to the dots as well as to the sheet.
   *
   * Without this the row and the sheet it leads to are two views of one list
   * that disagree: a colour removed in the sheet would still be sitting in the
   * featured eight, one press from the wall, having plainly ignored them. The
   * dots are not `PickerOption`s, so the curated list is built out of bare
   * `{ id }` rows — `curateList` asks for nothing else — rather than by
   * re-implementing the filter here.
   */
  const arranged = (): readonly ThemeId[] =>
    curateList(
      props.axis,
      COLOUR_ORDER.map((id) => ({ id })),
      active(),
    ).map((row) => row.id as ThemeId);

  const shown = (): readonly ThemeId[] =>
    cappedTo(arranged(), FEATURED_THEME_IDS.length, (id) => id === active());
  /** What the way-through is offering. The REMAINING count, never the total —
      the reader can count the dots, so a chip that says sixty is a claim they
      can disprove. */
  const hidden = (): number => arranged().length - shown().length;

  return (
    <div class="nb-panel-row nb-panel-row-stack">
      <span class="nb-panel-row-label">
        {props.title}{' '}
        <em class="nb-panel-row-hint">{getTheme(active()).name.toLowerCase()}</em>
      </span>
      <div
        class="nb-chip-row nb-colour-row"
        role="group"
        aria-label={`${props.label} colours`}
      >
        <For each={shown()}>
          {(id) => (
            <button
              type="button"
              class="nb-chip nb-chip-swatch"
              aria-pressed={active() === id}
              aria-label={`${props.label}: ${getTheme(id).name}`}
              data-tooltip={getTheme(id).name}
              style={{ '--nb-swatch': props.colour(getTheme(id)) }}
              onClick={() => props.onPick(id)}
            >
              <span class="nb-chip-swatch-dot" aria-hidden="true" />
            </button>
          )}
        </For>
        <Show when={hidden() > 0}>
          <button
            type="button"
            class="nb-chip nb-chip-ghost nb-chip-more font-ui"
            /* Not `aria-expanded`: this opens a sheet, it does not unfold the
               row. The strip's ninth cell announces itself the same way. */
            aria-label={`${props.label} colours: browse all ${arranged().length}`}
            data-tooltip={`all ${arranged().length} colours, with their names`}
            onClick={() => props.onMore()}
          >
            <span class="nb-colour-more-count">{hidden()}</span> more…
          </button>
        </Show>
      </div>
    </div>
  );
}

/**
 * Is this the same paper? Through `wallpaperAxisKey`, because this answer
 * decides which card the strip shows as chosen and what the panel calls the
 * wall. Spelled out here as four comparisons it went stale the moment the
 * spec grew a tone and a nib: nudging either left the panel still naming the
 * preset the reader had moved away from.
 */
function sameSpec(a: WallpaperSpec, b: WallpaperSpec): boolean {
  return wallpaperAxisKey(a) === wallpaperAxisKey(b);
}

export interface LibraryStudioProps {
  /** Optional: notified after every change (sound cue, toast…). */
  onChanged?(prefs: LibraryPrefs): void;
}

export default function LibraryStudio(props: LibraryStudioProps): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [sheet, setSheet] = createSignal<Sheet>(null);

  onMount(() => {
    void loadLibraryPrefs();
    void loadDesignPrefs();
  });

  const patch = (next: Partial<LibraryPrefs>): void => {
    setBusy(true);
    void saveLibraryPrefs(next)
      .then((prefs) => props.onChanged?.(prefs))
      .finally(() => setBusy(false));
  };

  const patchDesign = (next: Partial<RoomDesign>): void => {
    setBusy(true);
    void saveRoomDesign(next).finally(() => setBusy(false));
  };

  const patchWall = (next: Partial<WallpaperSpec>): void => {
    setBusy(true);
    void saveWallpaper(next).finally(() => setBusy(false));
  };

  const theme = (): LibraryTheme => getTheme(libraryPrefs.theme);
  const scheme = (): FlatScheme => resolveLibrary(libraryPrefs).scheme;
  const design = (): RoomDesign => activeRoomDesign();
  const wall = (): WallpaperSpec => design().wallpaper;

  /*
   * Borrowing one part's colour from another room. Written ONCE and called from
   * both the inline dots and the sheet: the same card in two places has to mean
   * the same thing, which is the rule the room strip and the room sheet already
   * follow, and two copies of this expression is exactly how they would come to
   * disagree.
   *
   * Clearing back to "follow the room" when the pick IS the room's own keeps the
   * preset driving it, instead of freezing a value that happens to match today.
   * The reader's own hex goes too: the dot they just pressed is a picture of a
   * colour, and leaving a custom hex over it would light a swatch that paints
   * nothing.
   */
  const pickShelfColour = (id: ThemeId): void =>
    patch({ shelf: id === libraryPrefs.theme ? null : id, timberHex: null });
  const pickWallColour = (id: ThemeId): void =>
    patch({ wall: id === libraryPrefs.theme ? null : id, wallHex: null });

  /**
   * The sixty rooms, as cards for ONE part's colour: the reader's own bookcase
   * and their own paper, with only that half repainted.
   *
   * Deliberately NOT `themeOptions`. Those cards are a picture of room X — its
   * timber and its wall together — which is the right card for the axis above
   * that swaps both. These rows borrow one half, so a card that also repaints
   * the other half is showing a room the reader is not about to get, and a
   * picker that lies about what you get is worse than no picker.
   *
   * The colours on each card are composed by `resolveLibrary` from the prefs
   * this press would actually write — the same function the shelf composes with
   * — so a card cannot drift from the room it lands you in. That matters most
   * on the wall: an ink slot of `timber` or `cloth` borrows from the CASE, so a
   * wall card painted in the candidate room's own scheme would print the motif
   * in a colour the reader's case will never lend it.
   */
  const partColourOptions = (part: 'shelf' | 'wall'): readonly PickerOption[] => {
    const spec = wall();
    const carpentry = shelfDesignOf(design());
    return THEME_IDS.map((id) => {
      const room = getTheme(id);
      const next: LibraryPrefs =
        part === 'shelf'
          ? { ...libraryPrefs, shelf: id, timberHex: null }
          : { ...libraryPrefs, wall: id, wallHex: null };
      const resolved = resolveLibrary(next);
      return {
        id,
        name: room.name,
        blurb: room.blurb,
        /* Every axis the drawing varies on. `resolveLibrary`'s own key spells
           out the composed colours — it is the string the case bake itself is
           keyed on — and the carpentry or the paper is the other half of what
           these two cards draw. The room id alone would not do it: two rooms
           lending the same timber to one wall are one picture. */
        artKey:
          part === 'shelf'
            ? `shelfcol|${resolved.key}|${carpentry.build}.${carpentry.pattern}`
            : `wallcol|${resolved.key}|${wallpaperAxisKey(spec)}`,
        terms: `${room.blurb} ${room.tags.join(' ')}`,
        draw: (ctx: FlatCtx, w: number, h: number) =>
          drawInScheme(resolved.scheme, () => {
            if (part === 'shelf') drawCaseCard(ctx, w, h, PART_CARD_SEED, carpentry);
            else drawWallpaperCard(ctx, w, h, spec);
          }),
      };
    });
  };

  /** The named paper the wall is wearing, or '' once an axis has been nudged. */
  const wallPresetId = createMemo(() => {
    const spec = wall();
    return WALLPAPER_PRESETS.find((p) => sameSpec(p.spec, spec))?.id ?? '';
  });
  const wallName = (): string => {
    const id = wallPresetId();
    return id === '' ? `${wall().pattern}, your way` : getWallpaper(id).name;
  };

  /** Named-case id when the pair happens to have a name; '' otherwise. */
  const namedCaseId = (): string => {
    const id = `${design().build}.${design().pattern}`;
    return getShelfPreset(id) === null ? '' : id;
  };

  /* ------------------------------ the presets ----------------------------- */

  /** Everything a preset sets, as the room currently stands. */
  const look = (): RoomLook => ({
    theme: libraryPrefs.theme,
    build: design().build,
    pattern: design().pattern,
    wallpaper: wall(),
  });

  /**
   * Keep the room as it stands, under a name, starred in the same action.
   *
   * The reader's words were "save their current room as preset and also star it
   * simuntaosuly to make sure it stays up top", which is why the stars come in
   * as an argument rather than as a second trip through the menu — and why this
   * hangs off the PRESET strip rather than off a button of its own. The preset
   * row is the one control that means "the whole room"; a "save" anywhere else
   * would have to explain which parts of the room it was saving.
   *
   * The named paper travels with it (`wallPresetId()`), so a kept room can still
   * be found by searching for the paper it hangs.
   */
  const keepThisRoom = (name: string, stars: Stars): void => {
    setBusy(true);
    void saveRoomAsPreset(name, { ...look(), paper: wallPresetId() }, stars).finally(() =>
      setBusy(false),
    );
  };

  /**
   * The preset the room is wearing, or '' for a room of the reader's own.
   *
   * A borrowed part colour disqualifies it. That is not pedantry: the card
   * shown as pressed is a picture of a room, and a library whose shelves have
   * been repainted out of another scheme is not that picture any more. Read
   * through `partTheme` rather than off the raw fields so an override that
   * happens to name the room's own scheme still counts as following it.
   */
  const presetId = createMemo<string>(() => {
    if (partTheme(libraryPrefs, 'shelf') !== libraryPrefs.theme) return '';
    if (partTheme(libraryPrefs, 'wall') !== libraryPrefs.theme) return '';
    // A colour the reader mixed disqualifies it for the same reason a borrowed
    // one does, and more strongly: the card is a picture of a room, and this
    // room is now wearing a colour that exists in no card at all.
    if (libraryPrefs.timberHex !== null || libraryPrefs.wallHex !== null) return '';
    return matchRoomPreset(look());
  });

  const presetName = (): string => {
    const id = presetId();
    return id === '' ? 'a room of your own' : getRoomPreset(id)!.name;
  };

  /**
   * One press, a whole room: the colours, the carpentry and the paper.
   *
   * Two writes rather than one, because the two halves have two owners — the
   * scheme belongs to the bookcase's `room` blob and the rest to the studio's
   * own settings key — and neither validator would accept the other's fields.
   * They go out together so the shelf re-bakes once.
   *
   * The borrowed part colours are cleared with the whole-room choice. Leaving
   * them would hand the reader a room that does not look like
   * the card they just pressed, and no way to tell why.
   */
  const applyPreset = (id: string): void => {
    const preset = getRoomPreset(id);
    if (preset === null) return;
    setBusy(true);
    void Promise.all([
      saveLibraryPrefs({
        theme: preset.theme,
        shelf: null,
        wall: null,
        timberHex: null,
        wallHex: null,
      }).then((p) => props.onChanged?.(p)),
      saveRoomDesign({
        build: preset.build,
        pattern: preset.pattern,
        wallpaper: preset.wallpaper,
      }),
    ]).finally(() => setBusy(false));
  };

  /* --------------------------- the long sheets --------------------------- */

  const sheetOptions = createMemo<readonly PickerOption[]>(() => {
    switch (sheet()) {
      case 'preset':
        return roomPresetOptions();
      case 'room':
        return themeOptions(shelfDesignOf(design()));
      case 'shelf-colour':
        return partColourOptions('shelf');
      case 'wall-colour':
        return partColourOptions('wall');
      case 'build':
        return buildOptions(design().pattern);
      case 'pattern':
        return patternOptions(design().build);
      case 'named':
        return shelfPresetOptions();
      case 'wallpaper':
        return wallpaperOptions();
      default:
        return [];
    }
  });

  const sheetActive = (): string => {
    switch (sheet()) {
      case 'preset':
        return presetId();
      case 'room':
        return libraryPrefs.theme;
      // Through `partTheme`, so a part that is simply following the room shows
      // the room's own card as pressed rather than nothing at all.
      case 'shelf-colour':
        return partTheme(libraryPrefs, 'shelf');
      case 'wall-colour':
        return partTheme(libraryPrefs, 'wall');
      case 'build':
        return design().build;
      case 'pattern':
        return design().pattern;
      case 'named':
        return namedCaseId();
      case 'wallpaper':
        return wallPresetId();
      default:
        return '';
    }
  };

  const sheetTitle = (): string => {
    switch (sheet()) {
      case 'preset':
        return 'presets';
      case 'room':
        return 'the colour scheme';
      case 'shelf-colour':
        return 'the colour of the shelves';
      case 'wall-colour':
        return 'the colour of the wall';
      case 'build':
        return 'how it is built';
      case 'pattern':
        return 'worked into the timber';
      case 'named':
        return 'named bookcases';
      case 'wallpaper':
        return 'the paper on the wall';
      default:
        return '';
    }
  };

  const sheetHint = (): string => {
    switch (sheet()) {
      case 'preset':
        return 'a whole room in one press: the colours, how the case is built, what is worked into its timber and the paper behind it. every card is the room you would get. change any of it below afterwards.';
      case 'room':
        return 'a colour scheme, and only that — the timber, the dark behind the books, the wall and the six cloths a new book is bound in. every card is your bookcase, repainted.';
      case 'shelf-colour':
        return 'borrow one room’s timber and leave the rest of yours alone. every card is your own bookcase, in your own carpentry, standing against the wall you already have.';
      case 'wall-colour':
        return 'borrow one room’s wall and leave the case in front of it alone. every card is the paper you have hung, on that room’s ground.';
      case 'build':
        return 'the case itself — its uprights, what fills the opening, and the cornice on top.';
      case 'pattern':
        return 'a treatment worked into the timber. it does not change the shape of the case.';
      case 'named':
        return 'a build and a treatment already chosen together.';
      case 'wallpaper':
        return 'sets the motif, its size, its relief and which colour it borrows. tune the last three below.';
      default:
        return '';
    }
  };

  const pickFromSheet = (id: string): void => {
    switch (sheet()) {
      case 'preset':
        applyPreset(id);
        break;
      case 'room':
        // Only the preset. A borrowed shelf or wall colour survives a room
        // change on purpose, and the inline strip has to agree with this, or
        // the same card would mean two
        // different things depending on where it was pressed.
        patch({ theme: id as ThemeId });
        break;
      // The same two functions the inline dots call, for the same reason the
      // room sheet defers to the room strip: one card, one meaning.
      case 'shelf-colour':
        pickShelfColour(id as ThemeId);
        break;
      case 'wall-colour':
        pickWallColour(id as ThemeId);
        break;
      case 'build':
        patchDesign({ build: id as BuildId });
        break;
      case 'pattern':
        patchDesign({ pattern: id as PatternId });
        break;
      case 'named': {
        const preset = getShelfPreset(id);
        if (preset !== null) patchDesign({ build: preset.build, pattern: preset.pattern });
        break;
      }
      case 'wallpaper':
        patchDesign({ wallpaper: getWallpaper(id).spec });
        break;
      default:
        break;
    }
  };

  return (
    <div
      class="nb-library-studio"
      /* The shelf listens for arrows/Home/Enter on `document`; while this
         sheet is up those keys belong to it. See shelfKeys.ts. */
      on:keydown={stopShelfKeys}
      data-busy={busy() ? 'true' : 'false'}
      /* Published so the host can stand down while a full-axis sheet is out:
         ShelfStudio's "want to dress one book instead?" line sits below this
         element and reads as a stray caption under a sixty-card gallery. */
      data-sheet={sheet() ?? 'none'}
    >
      {/*
        Two sibling Shows with callback children, NOT one Show with the picker
        in `fallback`.

        Solid evaluates `fallback` inside the Show's own memo, so every
        reactive read the picker makes while it is being built belongs to that
        memo — and `sheetOptions()` depends on the design, which is exactly
        what a pick changes. The panel measurably re-created the whole picker
        on every card press: focus was thrown to the body, and the
        scroll-to-top in DesignPicker fired again and yanked the reader back to
        the first row mid-browse. A callback child is called under `untrack`,
        which is the documented way out.
      */}
      <Show when={sheet() !== null}>
        {(_open) => (
          <DesignPicker
            title={sheetTitle()}
            hint={sheetHint()}
            options={sheetOptions()}
            activeId={sheetActive()}
            scheme={scheme()}
            onPick={pickFromSheet}
            onBack={() => setSheet(null)}
            cardW={148}
            cardH={102}
            columns={2}
            /* The same word the strip that led here passes, off one table —
               see SHEET_AXIS. */
            axis={SHEET_AXIS[sheet() ?? 'preset']}
            onSaveCurrent={sheet() === 'preset' ? keepThisRoom : undefined}
            saveLabel="keep this room…"
            savePlaceholder="name this room…"
          />
        )}
      </Show>

      <Show when={sheet() === null}>
        {(_closed) => (
          <>
        <section class="nb-panel-section">
          <h3 class="nb-panel-section-title">bookcases</h3>
          <BookcasesPanel />
        </section>

        {/* ------------------------------ presets --------------------------- */}
        <section class="nb-panel-section nb-panel-section-divided">
          <h3 class="nb-panel-section-title">
            presets <em class="nb-panel-row-hint">{presetName().toLowerCase()}</em>
          </h3>
          {/*
            The one control in the panel that sets the WHOLE room, and it is
            first because it is the answer to "make this library mine" — the
            rows below it are for afterwards. Each card is painted by
            `drawRoomCard`: the case in its own carpentry and colours, standing
            on its own paper, so the card is the room rather than a swatch of
            it.
          */}
          <DesignStrip
            label="Room presets"
            options={roomPresetOptions()}
            activeId={presetId()}
            scheme={scheme()}
            showNames
            columns={2}
            tileW={148}
            tileH={96}
            limit={5}
            onPick={applyPreset}
            onMore={() => setSheet('preset')}
            axis="room-preset"
            /* The one list that can GROW: right-click offers to keep the room
               you are standing in, named and starred in one action. */
            onSaveCurrent={keepThisRoom}
            saveLabel="keep this room…"
            savePlaceholder="name this room…"
          />
          <p class="nb-panel-footnote nb-panel-footnote-tight">
            {ROOM_PRESETS.length} rooms, sorted by the kind of room they are.
            each one sets the colours, the carpentry and the paper together —
            and everything under here stays yours to change afterwards.
          </p>
        </section>

        <section class="nb-panel-section nb-panel-section-divided">
          <h3 class="nb-panel-section-title">
            colour <em class="nb-panel-row-hint">{theme().name.toLowerCase()}</em>
          </h3>
          {/*
            A strip, not the grid of big cards this used to be. There were four
            rooms when the grid was written; there are sixty now, and sixty
            cards in a 376px sheet put four thousand pixels of scrolling between
            the reader and everything below them. Same treatment as the other
            long axes.

            It is called "colour" and not "the room" because that is all it is,
            and calling it the room was read — correctly — as a promise that
            picking one would restyle the library. The presets above keep that
            promise; this repaints, on purpose, without touching the carpentry.
          */}
          <DesignStrip
            label="Library colours"
            options={themeOptions(shelfDesignOf(design()))}
            activeId={libraryPrefs.theme}
            scheme={scheme()}
            showNames
            columns={2}
            tileW={148}
            tileH={96}
            limit={5}
            onPick={(id) => patch({ theme: id as ThemeId })}
            onMore={() => setSheet('room')}
            axis="colour"
          />
          <Swatches scheme={scheme()} name={theme().name} />
          <p class="nb-panel-footnote">
            a colour scheme only — it repaints the case and the wall and leaves
            the carpentry alone. books keep their own colours in every room:
            that is how you spot yours. to change one, right-click its spine and
            pick “dress this book”; to move it, right-click and pick “move”.
          </p>
        </section>

        {/* ------------------------------ shelves --------------------------- */}
        <section class="nb-panel-section nb-panel-section-divided">
          <h3 class="nb-panel-section-title">
            shelves{' '}
            <em class="nb-panel-row-hint">
              {BUILDS[design().build].name.toLowerCase()}
              {design().pattern === 'none'
                ? ''
                : ` · ${PATTERNS[design().pattern].name.toLowerCase()}`}
            </em>
          </h3>

          <ColourRow
            part="shelf"
            label="shelves"
            title="colour"
            axis="shelf-colour"
            colour={(t) => t.scheme.timber}
            onPick={pickShelfColour}
            onMore={() => setSheet('shelf-colour')}
          />
          {/*
            Sixty rooms is a vocabulary, and a vocabulary does not contain the
            oak somebody already has in mind. One colour, not three: the turned
            face and the dark of the recess are folded off it by
            `palette.caseFaces` — the same fold the sixty authored rooms use —
            so a case picked this way still reads as one object.
          */}
          <OwnColour
            label="Shelf timber"
            value={libraryPrefs.timberHex}
            fallback={scheme().timber}
            onPick={(hex) => patch({ timberHex: hex })}
            onClear={() => patch({ timberHex: null })}
            clearLabel="back to the room"
          />

          <span class="nb-panel-row-label nb-strip-label">how it is built</span>
          <DesignStrip
            label="Bookcase build"
            options={buildOptions(design().pattern)}
            activeId={design().build}
            scheme={scheme()}
            onPick={(id) => patchDesign({ build: id as BuildId })}
            onMore={() => setSheet('build')}
            axis="build"
          />

          <span class="nb-panel-row-label nb-strip-label">worked into the timber</span>
          <DesignStrip
            label="Timber pattern"
            options={patternOptions(design().build)}
            activeId={design().pattern}
            scheme={scheme()}
            onPick={(id) => patchDesign({ pattern: id as PatternId })}
            onMore={() => setSheet('pattern')}
            axis="pattern"
          />

          <div class="nb-chip-row">
            <button type="button" class="nb-chip nb-chip-ghost" onClick={() => setSheet('named')}>
              or a named bookcase ({SHELF_PRESETS.length})
            </button>
          </div>

          {/* The reader's own carpentry, where carpentry is chosen. See the
              header of features/packs/YourDesigns.tsx: a vocabulary reachable
              only from a panel nobody opens is the failure this tree keeps
              having, and it is the same one tests/roll-gates.test.ts watches. */}
          {/* `pack`, not `axis`: this names a pack CATEGORY, and everywhere
              else in the tree an `axis` prop is a CurationAxis. See the header
              of YourDesigns.tsx — the two words collided in this very file. */}
          <YourDesigns pack="carpentry" />
        </section>

        {/* ----------------------------- wallpaper -------------------------- */}
        <section class="nb-panel-section nb-panel-section-divided">
          <h3 class="nb-panel-section-title">
            wallpaper <em class="nb-panel-row-hint">{wallName().toLowerCase()}</em>
          </h3>

          <DesignCanvas
            class="nb-wall-preview"
            key={`wall|${wall().pattern}|${wall().scale}|${wall().depth}|${wall().ink}`}
            w={WALL_W}
            h={WALL_H}
            scheme={scheme()}
            alt={`${wallName()} on the wall`}
            draw={(ctx, w, h) => drawWallpaperCard(ctx, w, h, wall())}
          />

          <ColourRow
            part="wall"
            label="wallpaper"
            title="the wall behind it"
            axis="wall-colour"
            colour={(t) => t.scheme.wall}
            onPick={pickWallColour}
            onMore={() => setSheet('wall-colour')}
          />
          <OwnColour
            label="Wall ground"
            value={libraryPrefs.wallHex}
            fallback={scheme().wall}
            onPick={(hex) => patch({ wallHex: hex })}
            onClear={() => patch({ wallHex: null })}
            clearLabel="back to the room"
          />
          {/*
            Said out loud, because it is the one place a colour does not arrive
            exactly as typed and a reader who picked a deep navy wall and got a
            lighter one deserves to know why rather than conclude the field is
            broken. It only bites when the wall would have gone under the case.
          */}
          <p class="nb-panel-footnote nb-panel-footnote-tight">
            a wall of your own is kept lighter than the case in front of it —
            otherwise the bookcase stops reading as furniture and starts reading
            as a hole cut in the backdrop.
          </p>

          <span class="nb-panel-row-label nb-strip-label">the paper</span>
          <DesignStrip
            label="Wallpaper"
            options={wallpaperOptions()}
            activeId={wallPresetId()}
            scheme={scheme()}
            onPick={(id) => patchDesign({ wallpaper: getWallpaper(id).spec })}
            onMore={() => setSheet('wallpaper')}
            axis="wallpaper"
          />

          <YourDesigns pack="wallpaper" />

          {/*
            The three rows below all tune a MOTIF, and `plain` is the absence of
            one — so on the paper a fresh library opens with, all three come out
            as identical empty tiles. Say so rather than let the reader conclude
            the rows are broken; it is the same mistake the palette legend was
            making at the foot of the sheet.
          */}
          <Show when={wall().pattern === 'plain'}>
            <p class="nb-panel-footnote nb-panel-footnote-tight">
              plain is a bare wall. pick a paper above and the three rows below
              start doing something.
            </p>
          </Show>

          {/*
            The other half of the wall's colour, and until now the half nobody
            could reach: the ground comes from the room, the MOTIF's colour
            comes from here. A reader who liked their trellis and wanted it in
            gold used to have to go and hunt for a gold trellis among fifty-five
            papers. Four grounds x six inks is twenty-four walls.
          */}
          <span class="nb-panel-row-label nb-strip-label">
            what colour <em class="nb-panel-row-hint">{wall().ink}</em>
          </span>
          <DesignStrip
            label="Paper colour"
            options={inkOptions(wall())}
            activeId={wall().ink}
            scheme={scheme()}
            showNames
            columns={3}
            tileW={100}
            tileH={62}
            onPick={(id) => patchWall({ ink: id as WallpaperInk })}
            axis="wallpaper-ink"
          />

          <span class="nb-panel-row-label nb-strip-label">
            how big <em class="nb-panel-row-hint">{wall().scale}</em>
          </span>
          <DesignStrip
            label="Motif size"
            options={scaleOptions(wall())}
            activeId={wall().scale}
            scheme={scheme()}
            showNames
            columns={5}
            tileW={62}
            tileH={44}
            onPick={(id) => patchWall({ scale: id as WallpaperScale })}
            axis="wallpaper-scale"
          />

          <span class="nb-panel-row-label nb-strip-label">
            how deep <em class="nb-panel-row-hint">{wall().depth}</em>
          </span>
          <DesignStrip
            label="Relief"
            options={depthOptions(wall())}
            activeId={wall().depth}
            scheme={scheme()}
            showNames
            columns={4}
            tileW={78}
            tileH={54}
            onPick={(id) => patchWall({ depth: id as WallpaperDepth })}
            axis="wallpaper-relief"
          />
          <p class="nb-panel-footnote">
            relief is the motif's own thickness — a second flat face beside the
            first. never a cast shadow: this room has no lamp in it.
          </p>
        </section>

          </>
        )}
      </Show>
    </div>
  );
}
