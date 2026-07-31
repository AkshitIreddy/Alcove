/**
 * src/views/rail/LibraryStudio.tsx — the studio's "This library" tab.
 *
 * The room, and everything in it that is not a book. Four things are chosen
 * here and they are deliberately independent:
 *
 *  - WHICH BOOKCASE you are standing in (the collection, top of the sheet);
 *  - the COLOUR SCHEME, whole-room or one part at a time;
 *  - how the case is BUILT and what is worked into its timber
 *    (art/shelfDesign.ts — twelve carpentries x twelve treatments);
 *  - what is on the WALL (art/wallpaperDesign.ts — nineteen motifs across
 *    five scales, four reliefs and six ink slots, every one of them offered
 *    here: the ink slot used to be reachable only by finding a named paper
 *    that happened to use it).
 *
 * Colour and carpentry are orthogonal on purpose: a gothic case is gothic in
 * every room, and repainting the room must not quietly rebuild the furniture.
 * That is also why they are separate rows rather than one long "style" list.
 *
 * The long axes do NOT live inline. Sixty named cases and fifty-five papers
 * dumped into a 376px sheet is a wall of tiles nobody reads, so each axis
 * shows eight real previews and a way through to the rest (DesignStrip →
 * DesignPicker). The sheet swaps to the picker rather than floating it above:
 * one sheet at a time keeps Escape, the panel push and the tab ring simple.
 *
 * Every tile is painted by the routine that paints the real thing —
 * `drawCaseCard` for the case, `drawWallpaperCard` for the wall — under the
 * room's own scheme. A picker that lies about what you get is worse than no
 * picker.
 */
import { For, Show, createMemo, createSignal, onMount, type JSX } from 'solid-js';
import { type FlatScheme } from '../../art/flat';
import {
  BUILDS,
  BUILD_IDS,
  PATTERNS,
  PATTERN_IDS,
  SHELF_PRESETS,
  getShelfPreset,
  type BuildId,
  type PatternId,
} from '../../art/shelfDesign';
import {
  THEMES,
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
  libraryPrefs,
  loadLibraryPrefs,
  partTheme,
  resolveLibrary,
  saveLibraryPrefs,
  type LibraryPrefs,
} from '../../features/bookshelf/libraryPrefs';
import BookcasesPanel from './BookcasesPanel';
import DesignPicker, { type PickerOption } from './DesignPicker';
import DesignStrip from './DesignStrip';
import { DesignCanvas } from './designArt';
import {
  buildOptions,
  depthOptions,
  inkOptions,
  moodTags,
  patternOptions,
  scaleOptions,
  shelfPresetOptions,
  themeOptions,
  wallpaperOptions,
  withMood,
} from './designOptions';
import {
  DEFAULT_ROOM_DESIGN,
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
type Sheet = null | 'room' | 'build' | 'pattern' | 'named' | 'wallpaper';

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
 * One part's colour row: every room, as the colour that part would take.
 *
 * Keyed by the `LibraryPrefs` field it writes, so a row cannot drift from the
 * pref it edits. Sixty room names stacked twice would be a wall of text for
 * something the eye answers instantly, hence dots rather than labels — though
 * sixty dots is a wall of its own, and this row wants the same treatment the
 * room axis above it already got: a strip of featured colours with the rest
 * behind a picker.
 */
function ColourRow(props: {
  part: 'shelf' | 'wall';
  label: string;
  /** The row's own heading. The wall has two colour rows; they cannot both
      be called "colour" or neither says which half it moves. */
  title: string;
  colour(theme: LibraryTheme): string;
  onPick(id: ThemeId): void;
}): JSX.Element {
  return (
    <div class="nb-panel-row nb-panel-row-stack">
      <span class="nb-panel-row-label">
        {props.title}{' '}
        <em class="nb-panel-row-hint">
          {getTheme(partTheme(libraryPrefs, props.part)).name.toLowerCase()}
        </em>
      </span>
      <div class="nb-chip-row" role="group" aria-label={`${props.label} colours`}>
        <For each={THEME_IDS}>
          {(id) => (
            <button
              type="button"
              class="nb-chip nb-chip-swatch"
              aria-pressed={partTheme(libraryPrefs, props.part) === id}
              aria-label={`${props.label}: ${getTheme(id).name}`}
              title={getTheme(id).name}
              style={{ '--nb-swatch': props.colour(getTheme(id)) }}
              onClick={() => props.onPick(id)}
            >
              <span class="nb-chip-swatch-dot" aria-hidden="true" />
            </button>
          )}
        </For>
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

function pickOne<T>(list: readonly T[], notThis?: T): T {
  const pool = notThis === undefined ? list : list.filter((v) => v !== notThis);
  const from = pool.length > 0 ? pool : list;
  return from[Math.floor(Math.random() * from.length)] as T;
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

  /* --------------------------- the long sheets --------------------------- */

  const sheetOptions = createMemo<readonly PickerOption[]>(() => {
    switch (sheet()) {
      case 'room':
        return themeOptions(shelfDesignOf(design()));
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
      case 'room':
        return libraryPrefs.theme;
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
      case 'room':
        return 'the room';
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
      case 'room':
        return 'a colour scheme, and only that — the timber, the dark behind the books, the wall and the six cloths a new book is bound in. every card is your bookcase, repainted.';
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
      case 'room':
        // Only the preset. A borrowed shelf or wall colour survives a room
        // change on purpose — that is what "back to one room" is for — and the
        // inline strip has to agree with this, or the same card would mean two
        // different things depending on where it was pressed.
        patch({ theme: id as ThemeId });
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

  /* ------------------------------- the dice ------------------------------ */

  /**
   * The mood the dice are loaded toward, or '' for anything.
   *
   * The words come from the vocabularies themselves (`moodTags`), so this row
   * grows as they are tagged and simply does not appear while they are not —
   * see designOptions.ts. Eight is as many chips as fit two tidy lines in a
   * 376px sheet, and they arrive commonest-first, so the eight shown are the
   * eight that actually narrow anything.
   */
  const [mood, setMood] = createSignal('');
  const moods = createMemo<readonly string[]>(() => moodTags().slice(0, 8));

  /**
   * Somewhere else entirely — a different room, a different case, a different
   * paper. Ranging over every axis is the point: a "surprise" that nudges one
   * field is a slider with extra steps.
   *
   * The mood narrows each axis independently rather than the roll as a whole.
   * A reader asking for "goofy" wants a goofy ROOM, and if the papers happen
   * not to know that word they should still get a paper — an axis with no
   * match falls back to its whole vocabulary (`withMood`) instead of pinning
   * itself to whatever it was already wearing.
   */
  const surprise = (): void => {
    const wanted = mood();
    const rooms = withMood(THEME_IDS, wanted, (id) => THEMES[id]);
    const builds = withMood(BUILD_IDS, wanted, (id) => BUILDS[id]);
    const patterns = withMood(PATTERN_IDS, wanted, (id) => PATTERNS[id]);
    const papers = withMood(WALLPAPER_PRESETS, wanted, (paper) => paper);

    const nextTheme = pickOne(rooms, libraryPrefs.theme);
    const paper = pickOne(papers, getWallpaper(wallPresetId()));
    setBusy(true);
    void Promise.all([
      saveLibraryPrefs({ theme: nextTheme, shelf: null, wall: null }).then((p) =>
        props.onChanged?.(p),
      ),
      saveRoomDesign({
        build: pickOne(builds, design().build),
        pattern: pickOne(patterns, design().pattern),
        wallpaper: paper.spec,
      }),
    ]).finally(() => setBusy(false));
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

        <section class="nb-panel-section nb-panel-section-divided">
          <h3 class="nb-panel-section-title">
            the room <em class="nb-panel-row-hint">{theme().name.toLowerCase()}</em>
          </h3>
          {/*
            A strip, not the grid of big cards this used to be. There were four
            rooms when the grid was written; there are sixty now, and sixty
            cards in a 376px sheet put four thousand pixels of scrolling between
            the reader and everything below them. Same treatment as the other
            long axes.
          */}
          <DesignStrip
            label="Library theme"
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
          />
          <Swatches scheme={scheme()} name={theme().name} />
          <p class="nb-panel-footnote">
            books keep their own colours in every room — that is how you spot
            yours. to change one, right-click its spine and pick “dress this
            book”; to move it, right-click and pick “move”.
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
            colour={(t) => t.scheme.timber}
            /* Clearing back to "follow the room" when the pick IS the room's
               own keeps the preset driving it, instead of freezing a value
               that happens to match today. */
            onPick={(id) => patch({ shelf: id === libraryPrefs.theme ? null : id })}
          />

          <span class="nb-panel-row-label nb-strip-label">how it is built</span>
          <DesignStrip
            label="Bookcase build"
            options={buildOptions(design().pattern)}
            activeId={design().build}
            scheme={scheme()}
            onPick={(id) => patchDesign({ build: id as BuildId })}
            onMore={() => setSheet('build')}
          />

          <span class="nb-panel-row-label nb-strip-label">worked into the timber</span>
          <DesignStrip
            label="Timber pattern"
            options={patternOptions(design().build)}
            activeId={design().pattern}
            scheme={scheme()}
            onPick={(id) => patchDesign({ pattern: id as PatternId })}
            onMore={() => setSheet('pattern')}
          />

          <div class="nb-chip-row">
            <button type="button" class="nb-chip nb-chip-ghost" onClick={() => setSheet('named')}>
              or a named bookcase ({SHELF_PRESETS.length})
            </button>
          </div>
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
            colour={(t) => t.scheme.wall}
            onPick={(id) => patch({ wall: id === libraryPrefs.theme ? null : id })}
          />

          <span class="nb-panel-row-label nb-strip-label">the paper</span>
          <DesignStrip
            label="Wallpaper"
            options={wallpaperOptions()}
            activeId={wallPresetId()}
            scheme={scheme()}
            onPick={(id) => patchDesign({ wallpaper: getWallpaper(id).spec })}
            onMore={() => setSheet('wallpaper')}
          />

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
          />
          <p class="nb-panel-footnote">
            relief is the motif's own thickness — a second flat face beside the
            first. never a cast shadow: this room has no lamp in it.
          </p>
        </section>

        <section class="nb-panel-section nb-panel-section-divided">
          <h3 class="nb-panel-section-title">start somewhere else</h3>

          {/* Absent until the vocabularies carry mood words — see moodTags(). */}
          <Show when={moods().length > 0}>
            <div class="nb-panel-row nb-panel-row-stack">
              <span class="nb-panel-row-label">
                in the mood for{' '}
                <em class="nb-panel-row-hint">{mood() === '' ? 'anything' : mood()}</em>
              </span>
              <div class="nb-chip-row" role="group" aria-label="Surprise me mood">
                <button
                  type="button"
                  class="nb-chip"
                  aria-pressed={mood() === ''}
                  onClick={() => setMood('')}
                >
                  anything
                </button>
                <For each={moods()}>
                  {(word) => (
                    <button
                      type="button"
                      class="nb-chip"
                      aria-pressed={mood() === word}
                      onClick={() => setMood(word)}
                    >
                      {word}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="nb-chip-row">
            <button type="button" class="nb-chip nb-chip-gilt" onClick={surprise}>
              surprise me
            </button>
            <button
              type="button"
              class="nb-chip nb-chip-ghost"
              onClick={() => patch({ shelf: null, wall: null })}
            >
              back to one room
            </button>
            <button
              type="button"
              class="nb-chip nb-chip-ghost"
              onClick={() => patchDesign({ ...DEFAULT_ROOM_DESIGN })}
            >
              plain again
            </button>
          </div>
        </section>
          </>
        )}
      </Show>
    </div>
  );
}
