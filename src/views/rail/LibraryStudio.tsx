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
 *    five scales, four reliefs and six ink slots).
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
import { drawCaseCard } from '../../art/flatShelf';
import { fnv1a } from '../../art/noise';
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
  type WallpaperDepth,
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
  patternOptions,
  scaleOptions,
  shelfPresetOptions,
  wallpaperOptions,
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

const CARD_W = 168;
const CARD_H = 116;
const WALL_W = 328;
const WALL_H = 116;

/** Which long sheet has taken over the panel, if any. */
type Sheet = null | 'build' | 'pattern' | 'named' | 'wallpaper';

/**
 * A room card: the case, drawn in the app's one style, in the room's colours
 * AND in the carpentry the reader has chosen.
 *
 * The design is in there rather than fixed at plank because these four cards
 * are the reader's picture of "the room" — showing a plain case on them while
 * the shelf behind the panel is a gothic arcade is the same drift that had
 * the cards previewing a watercolour room after the shelf went flat.
 */
function ThemeCard(props: {
  id: ThemeId;
  design: RoomDesign;
  active: boolean;
  onPick(): void;
}): JSX.Element {
  const theme = (): (typeof THEMES)[ThemeId] => getTheme(props.id);
  const shelf = (): { build: BuildId; pattern: PatternId } => shelfDesignOf(props.design);

  return (
    <button
      type="button"
      class="nb-theme-card"
      classList={{ 'is-active': props.active }}
      aria-pressed={props.active}
      onClick={() => props.onPick()}
      title={theme().blurb}
    >
      <DesignCanvas
        class="nb-theme-card-art"
        key={`room|${props.id}|${shelf().build}|${shelf().pattern}`}
        w={CARD_W}
        h={CARD_H}
        scheme={theme().scheme}
        draw={(ctx, w, h) => drawCaseCard(ctx, w, h, fnv1a(`${props.id}|card`), shelf())}
      />
      <span class="nb-theme-card-name">{theme().name}</span>
      <span class="nb-theme-card-blurb">{theme().blurb}</span>
    </button>
  );
}

/**
 * The active room's palette, spelled out.
 *
 * Not a control — a legend. A reader who can see the six cloths their next
 * book might be bound in understands what the cards above actually chose.
 * Inline styles because every swatch's colour comes from the data.
 */
function Swatches(props: { scheme: ColourScheme; name: string }): JSX.Element {
  const chips = (): readonly { colour: string; label: string }[] => {
    const s = props.scheme;
    return [
      { colour: s.timber, label: 'case timber' },
      { colour: s.recess, label: 'behind the books' },
      { colour: s.wall, label: 'wall' },
      ...s.cloths.map(([face], i) => ({ colour: face, label: `book cloth ${i + 1}` })),
    ];
  };

  return (
    <div
      class="nb-swatch-row"
      role="img"
      aria-label={`${props.name} palette`}
      style={{ display: 'flex', gap: '4px', 'flex-wrap': 'wrap' }}
    >
      <For each={chips()}>
        {(chip) => (
          <span
            title={chip.label}
            style={{
              width: '18px',
              height: '18px',
              'border-radius': '5px',
              background: chip.colour,
              border: '1.5px solid #4f3120',
            }}
          />
        )}
      </For>
    </div>
  );
}

/**
 * One part's colour row: four rooms, as the colour that part would take.
 *
 * Keyed by the `LibraryPrefs` field it writes, so a row cannot drift from the
 * pref it edits. Four room names stacked twice reads as a wall of text for
 * something the eye answers instantly, hence dots rather than labels.
 */
function ColourRow(props: {
  part: 'shelf' | 'wall';
  label: string;
  colour(theme: LibraryTheme): string;
  onPick(id: ThemeId): void;
}): JSX.Element {
  return (
    <div class="nb-panel-row nb-panel-row-stack">
      <span class="nb-panel-row-label">
        colour{' '}
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

function sameSpec(a: WallpaperSpec, b: WallpaperSpec): boolean {
  return a.pattern === b.pattern && a.scale === b.scale && a.depth === b.depth && a.ink === b.ink;
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
      case 'build':
        return 'the case itself — its uprights, what fills the opening, and the cornice on top.';
      case 'pattern':
        return 'a treatment worked into the timber. it does not change the shape of the case.';
      case 'named':
        return 'a build and a treatment already chosen together.';
      case 'wallpaper':
        return 'sets the motif, its size, its relief and which colour it borrows. tune the last two below.';
      default:
        return '';
    }
  };

  const pickFromSheet = (id: string): void => {
    switch (sheet()) {
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
   * Somewhere else entirely — a different room, a different case, a different
   * paper. Ranging over every axis is the point: a "surprise" that nudges one
   * field is a slider with extra steps.
   */
  const surprise = (): void => {
    const nextTheme = pickOne(THEME_IDS, libraryPrefs.theme);
    const paper = pickOne(WALLPAPER_PRESETS, getWallpaper(wallPresetId()));
    setBusy(true);
    void Promise.all([
      saveLibraryPrefs({ theme: nextTheme, shelf: null, wall: null }).then((p) =>
        props.onChanged?.(p),
      ),
      saveRoomDesign({
        build: pickOne(BUILD_IDS, design().build),
        pattern: pickOne(PATTERN_IDS, design().pattern),
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
          <div class="nb-theme-grid" role="group" aria-label="Library theme">
            <For each={THEME_IDS}>
              {(id) => (
                <ThemeCard
                  id={id}
                  design={design()}
                  active={libraryPrefs.theme === id}
                  onPick={() => patch({ theme: id })}
                />
              )}
            </For>
          </div>
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
          <h3 class="nb-panel-section-title">the palette</h3>
          <Swatches scheme={scheme()} name={theme().name} />
          <p class="nb-panel-footnote">
            Books keep their own colours in every room — that is how you spot
            yours. To change one, right-click its spine and pick “dress this
            book”; to move it, right-click and pick “move”.
          </p>
        </section>

        <section class="nb-panel-section">
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
