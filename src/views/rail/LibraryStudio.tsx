/**
 * src/views/rail/LibraryStudio.tsx — the studio's "This library" tab.
 *
 * Picks the ROOM: which of the eight themes, what hangs on its wall (pattern
 * x colourway), how the wall itself is finished, how much grows on the case
 * and how warm the lamps burn (docs/design/library-themes.md §4).
 *
 * The theme cards are painted from the REAL case art — `bakeThemeThumbnail`
 * is the same renderer the shelf uses, so what you preview is literally the
 * room you get. Every control writes straight through `saveLibraryPrefs`, and
 * the Pixi world is subscribed to that store, so changes land on the shelf
 * the moment they are made.
 */
import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { renderCaseSection } from '../../art/caseArt';
import { fnv1a } from '../../art/noise';
import type { Ctx2D } from '../../art/spines';
import { COLOURWAYS, WALLPAPER_PATTERNS, type Colourway } from '../../art/wallpaper';
import {
  BACKDROP_IDS,
  BACKDROPS,
  COLOURWAY_IDS,
  THEME_IDS,
  THEMES,
  WALLPAPER_PATTERN_IDS,
  getTheme,
  resolveBackdrop,
  resolveWallpaper,
  type BackdropId,
  type ColourwayId,
  type LibraryTheme,
  type ThemeId,
  type WallpaperPatternId,
  type WallpaperSpec,
} from '../../art/themes';
import {
  DEFAULT_LIBRARY_PREFS,
  libraryPrefs,
  loadLibraryPrefs,
  saveLibraryPrefs,
  type LibraryPrefs,
} from '../../features/bookshelf/libraryPrefs';

const CARD_W = 168;
const CARD_H = 116;

/**
 * Painted card art. `renderCaseSection` is the same renderer the specimen
 * board and the shelf case use — we drive it directly rather than through
 * `bakeThemeThumbnail` for one reason: the baked helper stamps the theme's
 * full display name onto the floor plate, which overflows a 168px card. The
 * card prints the name underneath instead, so the plate stays blank.
 */
const cardCache = new Map<string, Promise<ImageBitmap | null>>();

function cardArt(
  theme: LibraryTheme,
  backdrop: BackdropId,
  wallpaper: WallpaperSpec,
  dpr: number,
): Promise<ImageBitmap | null> {
  const key = `${theme.id}|${backdrop}|${wallpaper.pattern}|${wallpaper.colourway}|${dpr}`;
  const hit = cardCache.get(key);
  if (hit !== undefined) return hit;
  const pending = (async (): Promise<ImageBitmap | null> => {
    try {
      const w = Math.round(CARD_W * dpr);
      const h = Math.round(CARD_H * dpr);
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = (canvas as OffscreenCanvas).getContext('2d');
      if (ctx === null) return null;
      ctx.scale(dpr, dpr);
      renderCaseSection(ctx as Ctx2D, theme, CARD_W, CARD_H, fnv1a(`${theme.id}|card`), {
        label: '',
        backdrop,
        wallpaper,
      });
      return await createImageBitmap(canvas as OffscreenCanvas);
    } catch {
      return null;
    }
  })();
  cardCache.set(key, pending);
  return pending;
}

/** Painted theme card — the room's own art, baked once per card recipe. */
function ThemeCard(props: {
  id: ThemeId;
  active: boolean;
  pattern: WallpaperPatternId | null;
  colourway: ColourwayId | null;
  backdrop: BackdropId | null;
  onPick(): void;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const theme = (): (typeof THEMES)[ThemeId] => getTheme(props.id);

  createEffect(() => {
    const t = theme();
    // Only the ACTIVE card previews the user's wallpaper/wall picks; the rest
    // show each room as its author intended, so the grid reads as eight worlds.
    const wallpaper = props.active
      ? resolveWallpaper(t, { pattern: props.pattern, colourway: props.colourway })
      : t.wallpaper;
    const backdrop = props.active ? resolveBackdrop(t, props.backdrop) : t.backdrops[0];
    const el = canvas;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let stale = false;
    onCleanup(() => {
      stale = true;
    });
    void cardArt(t, backdrop, wallpaper, dpr).then((bitmap) => {
      if (stale || bitmap === null) return;
      el.width = Math.round(CARD_W * dpr);
      el.height = Math.round(CARD_H * dpr);
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.drawImage(bitmap, 0, 0, el.width, el.height);
    });
  });

  return (
    <button
      type="button"
      class="nb-theme-card"
      classList={{ 'is-active': props.active }}
      aria-pressed={props.active}
      onClick={() => props.onPick()}
      title={theme().blurb}
    >
      <canvas
        class="nb-theme-card-art"
        ref={(el) => (canvas = el)}
        width={CARD_W}
        height={CARD_H}
        aria-hidden="true"
      />
      <span class="nb-theme-card-name">{theme().name}</span>
      <span class="nb-theme-card-blurb">{theme().blurb}</span>
    </button>
  );
}

/** Little painted swatch for one colourway (its own paper + ink tones). */
function ColourwaySwatch(props: {
  id: ColourwayId;
  active: boolean;
  onPick(): void;
}): JSX.Element {
  const c = (): Colourway => COLOURWAYS[props.id];
  return (
    <button
      type="button"
      class="nb-swatch nb-swatch-colourway"
      aria-pressed={props.active}
      classList={{ 'is-active': props.active }}
      aria-label={c().name}
      title={c().name}
      style={{
        background: `linear-gradient(150deg, ${c().base} 56%, ${c().baseAlt} 56%)`,
        'box-shadow': `inset 0 0 0 2px ${c().accent}`,
      }}
      onClick={() => props.onPick()}
    />
  );
}

export interface LibraryStudioProps {
  /** Optional: notified after every change (sound cue, toast…). */
  onChanged?(prefs: LibraryPrefs): void;
}

export default function LibraryStudio(props: LibraryStudioProps): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  onMount(() => {
    void loadLibraryPrefs();
  });

  const patch = (next: Partial<LibraryPrefs>): void => {
    setBusy(true);
    void saveLibraryPrefs(next)
      .then((prefs) => props.onChanged?.(prefs))
      .finally(() => setBusy(false));
  };

  const theme = (): (typeof THEMES)[ThemeId] => getTheme(libraryPrefs.theme);
  const effectivePattern = (): WallpaperPatternId =>
    libraryPrefs.wallpaperPattern ?? theme().wallpaper.pattern;
  const effectiveColourway = (): ColourwayId =>
    libraryPrefs.colourway ?? theme().wallpaper.colourway;
  const effectiveBackdrop = (): BackdropId =>
    libraryPrefs.backdrop ?? theme().backdrops[0];

  /** Shuffle only the dressing — same room, new clothes. */
  const randomise = (): void => {
    const r = (n: number): number => Math.floor(Math.random() * n);
    patch({
      wallpaperPattern: WALLPAPER_PATTERN_IDS[r(WALLPAPER_PATTERN_IDS.length)] ?? null,
      colourway: COLOURWAY_IDS[r(COLOURWAY_IDS.length)] ?? null,
      backdrop: BACKDROP_IDS[r(BACKDROP_IDS.length)] ?? null,
    });
  };

  /** Surprise me — a whole different room, dressing and all. */
  const surprise = (): void => {
    const r = (n: number): number => Math.floor(Math.random() * n);
    const id = THEME_IDS[r(THEME_IDS.length)] as ThemeId;
    patch({
      theme: id,
      wallpaperPattern: null,
      colourway: null,
      backdrop: null,
      floraDensity: [0.4, 1, 1, 1.6][r(4)] ?? 1,
      lightWarmth: 0.25 + Math.random() * 0.6,
    });
  };

  const floraLabel = (): string => {
    const d = libraryPrefs.floraDensity;
    if (d <= 0.02) return 'bare';
    if (d < 0.7) return 'sparse';
    if (d < 1.35) return "the room's own";
    return 'overgrown';
  };

  const warmthLabel = (): string => {
    const w = libraryPrefs.lightWarmth;
    if (w < 0.25) return 'moonlight';
    if (w < 0.45) return 'cool';
    if (w < 0.6) return 'as built';
    if (w < 0.8) return 'warm';
    return 'candlelit';
  };

  return (
    <div class="nb-library-studio" data-busy={busy() ? 'true' : 'false'}>
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">the room</h3>
        <div class="nb-theme-grid" role="group" aria-label="Library theme">
          <For each={THEME_IDS}>
            {(id) => (
              <ThemeCard
                id={id}
                active={libraryPrefs.theme === id}
                pattern={libraryPrefs.wallpaperPattern}
                colourway={libraryPrefs.colourway}
                backdrop={libraryPrefs.backdrop}
                onPick={() => patch({ theme: id })}
              />
            )}
          </For>
        </div>
      </section>

      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">
          the wall <em class="nb-panel-row-hint">{BACKDROPS[effectiveBackdrop()].name}</em>
        </h3>
        <p class="nb-panel-footnote nb-panel-footnote-tight">
          {BACKDROPS[effectiveBackdrop()].blurb}
        </p>
        <div class="nb-chip-row" role="group" aria-label="Wall finish">
          <For each={BACKDROP_IDS}>
            {(id) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={effectiveBackdrop() === id}
                onClick={() => patch({ backdrop: id })}
              >
                {BACKDROPS[id].name.toLowerCase()}
              </button>
            )}
          </For>
          <button
            type="button"
            class="nb-chip nb-chip-ghost"
            onClick={() => patch({ backdrop: null })}
          >
            as built
          </button>
        </div>
      </section>

      <Show when={BACKDROPS[effectiveBackdrop()].usesPattern}>
        <section class="nb-panel-section">
          <h3 class="nb-panel-section-title">wallpaper</h3>
          <div class="nb-chip-grid" role="group" aria-label="Wallpaper pattern">
            <For each={WALLPAPER_PATTERN_IDS}>
              {(id) => (
                <button
                  type="button"
                  class="nb-chip"
                  aria-pressed={effectivePattern() === id}
                  onClick={() => patch({ wallpaperPattern: id })}
                >
                  {(WALLPAPER_PATTERNS[id]?.name ?? id).toLowerCase()}
                </button>
              )}
            </For>
          </div>
          <h3 class="nb-panel-section-title nb-panel-section-title-sub">colourway</h3>
          <div class="nb-swatch-grid" role="group" aria-label="Wallpaper colourway">
            <For each={COLOURWAY_IDS}>
              {(id) => (
                <ColourwaySwatch
                  id={id}
                  active={effectiveColourway() === id}
                  onPick={() => patch({ colourway: id })}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      <section class="nb-panel-section nb-panel-section-divided">
        <label class="nb-panel-row">
          <span class="nb-panel-row-label">
            things growing <em class="nb-panel-row-hint">{floraLabel()}</em>
          </span>
          <input
            type="range"
            class="nb-panel-slider"
            min={0}
            max={2}
            step={0.1}
            value={libraryPrefs.floraDensity}
            aria-label="Flora density"
            onInput={(e) => patch({ floraDensity: Number(e.currentTarget.value) })}
          />
        </label>
        <label class="nb-panel-row">
          <span class="nb-panel-row-label">
            lamp warmth <em class="nb-panel-row-hint">{warmthLabel()}</em>
          </span>
          <input
            type="range"
            class="nb-panel-slider nb-panel-slider-warmth"
            min={0}
            max={1}
            step={0.02}
            value={libraryPrefs.lightWarmth}
            aria-label="Light warmth"
            onInput={(e) => patch({ lightWarmth: Number(e.currentTarget.value) })}
          />
        </label>
      </section>

      <section class="nb-panel-section">
        <div class="nb-chip-row">
          <button type="button" class="nb-chip" onClick={randomise}>
            randomise
          </button>
          <button type="button" class="nb-chip nb-chip-gilt" onClick={surprise}>
            surprise me
          </button>
          <button
            type="button"
            class="nb-chip nb-chip-ghost"
            onClick={() => patch({ ...DEFAULT_LIBRARY_PREFS, theme: libraryPrefs.theme })}
          >
            reset room
          </button>
        </div>
        <p class="nb-panel-footnote">
          {`seed ${fnv1a(theme().id).toString(16)} · every plant grows in the same place every time`}
        </p>
      </section>
    </div>
  );
}
