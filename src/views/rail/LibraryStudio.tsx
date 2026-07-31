/**
 * src/views/rail/LibraryStudio.tsx â€” the studio's "This library" tab.
 *
 * Picks the ROOM: which of the eight themes, what hangs on its wall (pattern
 * x colourway), how the wall itself is finished, how much grows on the case
 * and how warm the lamps burn (docs/design/library-themes.md Â§4).
 *
 * The theme cards are painted from the REAL case art â€” `bakeThemeThumbnail`
 * is the same renderer the shelf uses, so what you preview is literally the
 * room you get. Every control writes straight through `saveLibraryPrefs`, and
 * the Pixi world is subscribed to that store, so changes land on the shelf
 * the moment they are made.
 */
import { For, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import type { FlatCtx } from '../../art/flat';
import { drawCaseCard } from '../../art/flatShelf';
import { fnv1a } from '../../art/noise';
import { WALLPAPER_PATTERNS } from '../../art/wallpaper';
import {
  SHIPPED_THEME_IDS,
  THEMES,
  WALLPAPER_PATTERN_IDS,
  getTheme,
  type LibraryTheme,
  type ThemeId,
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
 * Card art, drawn with the case's own vocabulary.
 *
 * `drawCaseCard` is built from the same four shapes `EnvTextures` bakes the
 * real case from, so a card cannot preview a room you cannot get. It used to
 * call `caseArt.renderCaseSection` — seconds of brush work per card, and after
 * the shelf went flat it was previewing a wood-grained watercolour room that no
 * longer existed anywhere in the app.
 *
 * The room is one room now: the flat palette has a single timber and a plain
 * wall, so what still differs between cards is the seed — each theme gets its
 * own arrangement of books, which is what keeps the grid legible as a grid.
 * The lighting a theme carries (`theme.light`) is real and still applies to the
 * shelf; it is simply not something a 168px case section can show.
 */
const cardCache = new Map<string, Promise<ImageBitmap | null>>();

function cardArt(theme: LibraryTheme, dpr: number): Promise<ImageBitmap | null> {
  const key = `${theme.id}|${dpr}`;
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
      drawCaseCard(ctx as FlatCtx, CARD_W, CARD_H, fnv1a(`${theme.id}|card`));
      return await createImageBitmap(canvas as OffscreenCanvas);
    } catch {
      return null;
    }
  })();
  cardCache.set(key, pending);
  return pending;
}

/**
 * A theme card â€” the case, drawn in the app's one style, per theme seed.
 *
 * No `pattern` prop any more: it existed so the ACTIVE card could preview the
 * reader's wall pick, and the wall is now one flat colour with nothing on it.
 * Passing it in would have meant re-baking a card that cannot change.
 */
function ThemeCard(props: {
  id: ThemeId;
  active: boolean;
  onPick(): void;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const theme = (): (typeof THEMES)[ThemeId] => getTheme(props.id);

  createEffect(() => {
    const t = theme();
    const el = canvas;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let stale = false;
    onCleanup(() => {
      stale = true;
    });
    void cardArt(t, dpr).then((bitmap) => {
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

export interface LibraryStudioProps {
  /** Optional: notified after every change (sound cue, toastâ€¦). */
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

  /** Surprise me â€” a whole different room, dressing and all. */
  const surprise = (): void => {
    const r = (n: number): number => Math.floor(Math.random() * n);
    const id = SHIPPED_THEME_IDS[r(SHIPPED_THEME_IDS.length)] as ThemeId;
    patch({
      theme: id,
      // Plain is weighted: a wall is a background, and a patterned one every
      // time you roll turns the shelf into wallpaper with books in front.
      wallpaperPattern: r(3) === 0 ? WALLPAPER_PATTERN_IDS[r(WALLPAPER_PATTERN_IDS.length)] ?? null : null,
      wallDepth: 0.2 + Math.random() * 0.5,
      lightWarmth: 0.25 + Math.random() * 0.6,
    });
  };

  const patternLabel = (): string => {
    const id = libraryPrefs.wallpaperPattern;
    return id === null ? 'plain' : (WALLPAPER_PATTERNS[id]?.name ?? id).toLowerCase();
  };

  const depthLabel = (): string => {
    const d = libraryPrefs.wallDepth;
    if (d < 0.12) return 'flat paint';
    if (d < 0.4) return 'faint relief';
    if (d < 0.7) return 'raised';
    return 'deep relief';
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
          <For each={SHIPPED_THEME_IDS}>
            {(id) => (
              <ThemeCard
                id={id}
                active={libraryPrefs.theme === id}
                onPick={() => patch({ theme: id })}
              />
            )}
          </For>
        </div>
      </section>

      {/*
        One wall, two knobs. The old panel offered a "wall finish" row
        (papered / panelled / plastered / boarded / shoji) *and* a wallpaper
        row *and* a colourway row, and picking a wallpaper silently did
        nothing whenever the finish had nowhere to put one. Three controls for
        one surface, two of which could cancel the third.
      */}
      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">
          the wall <em class="nb-panel-row-hint">{patternLabel()}</em>
        </h3>
        <div class="nb-chip-row" role="group" aria-label="Wall pattern">
          {/* Plain comes first and is the default: a wall with no pattern has
              to be a real choice, not the absence of one. */}
          <button
            type="button"
            class="nb-chip"
            aria-pressed={libraryPrefs.wallpaperPattern === null}
            onClick={() => patch({ wallpaperPattern: null })}
          >
            plain
          </button>
          <For each={WALLPAPER_PATTERN_IDS}>
            {(id) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={libraryPrefs.wallpaperPattern === id}
                onClick={() => patch({ wallpaperPattern: id })}
              >
                {(WALLPAPER_PATTERNS[id]?.name ?? id).toLowerCase()}
              </button>
            )}
          </For>
        </div>
        <label class="nb-panel-row">
          <span class="nb-panel-row-label">
            surface depth <em class="nb-panel-row-hint">{depthLabel()}</em>
          </span>
          <input
            type="range"
            class="nb-panel-slider"
            min={0}
            max={1}
            step={0.05}
            value={libraryPrefs.wallDepth}
            aria-label="Wall surface depth"
            onInput={(e) => patch({ wallDepth: Number(e.currentTarget.value) })}
          />
        </label>
      </section>

      <section class="nb-panel-section nb-panel-section-divided">
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
          {`seed ${fnv1a(theme().id).toString(16)} Â· the room is laid out the same way every time`}
        </p>
      </section>
    </div>
  );
}
