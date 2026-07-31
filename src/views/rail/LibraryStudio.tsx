/**
 * src/views/rail/LibraryStudio.tsx — the studio's "This library" tab.
 *
 * Picks the ROOM, and the room is a colour scheme: case timber, the recess
 * behind the books, the wall, and the six cloths new books are bound in.
 *
 * There is one control here now. The panel used to carry four — a theme grid, a
 * wall-finish row, an eighteen-button wallpaper row and a "surface depth"
 * slider — three of which had been inert since the flat restyle, and one of
 * which (the grid) only changed a seed because every room baked the identical
 * case. A picker whose buttons do nothing teaches readers to distrust the whole
 * panel, so the dead ones are gone and the live one now really repaints the room.
 *
 * The cards are painted from the REAL case art: `drawCaseCard` is the same
 * routine the shelf bakes its case from, run under the card's own scheme, so
 * what you preview is literally the room you get.
 */
import { For, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { flatScheme, setFlatScheme, type FlatCtx } from '../../art/flat';
import { drawCaseCard } from '../../art/flatShelf';
import { fnv1a } from '../../art/noise';
import {
  THEMES,
  THEME_IDS,
  getTheme,
  type ColourScheme,
  type LibraryTheme,
  type ThemeId,
} from '../../art/themes';
import {
  libraryPrefs,
  loadLibraryPrefs,
  partTheme,
  resolveLibrary,
  saveLibraryPrefs,
  type LibraryPrefs,
} from '../../features/bookshelf/libraryPrefs';

const CARD_W = 168;
const CARD_H = 116;

/**
 * Card art, drawn with the case's own vocabulary under the room's own scheme.
 *
 * `setFlatScheme` is module state in `art/flat.ts`, so the swap has to be
 * synchronous around the draw — no `await` between setting and restoring, or a
 * second card baking on the same tick would come out in the wrong palette. The
 * previous scheme is put back rather than cleared: the shelf's own bake sets it
 * too, and a card must not be able to repaint the room behind the panel.
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
      const previous = flatScheme();
      setFlatScheme(theme.scheme);
      try {
        drawCaseCard(ctx as FlatCtx, CARD_W, CARD_H, fnv1a(`${theme.id}|card`));
      } finally {
        setFlatScheme(previous);
      }
      return await createImageBitmap(canvas as OffscreenCanvas);
    } catch {
      return null;
    }
  })();
  cardCache.set(key, pending);
  return pending;
}

/** A room card: the case, drawn in the app's one style, in the room's colours. */
function ThemeCard(props: { id: ThemeId; active: boolean; onPick(): void }): JSX.Element {
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

/**
 * The active room's palette, spelled out.
 *
 * Not a control — a legend. A theme is now *only* colour, and a reader who can
 * see the six cloths their next book might be bound in understands what the
 * card above actually chose. Inline styles because every swatch's colour comes
 * from the data, not from the stylesheet.
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
 * The three things on screen, and the swatch colour that stands for each.
 *
 * Keyed by the `LibraryPrefs` field they write, so a row cannot drift from the
 * pref it edits. The swatch shows the colour that part would actually change:
 * picking a shelf shows timber, picking books shows the first cloth.
 */
const PARTS = [
  { key: 'shelf', label: 'shelves', colour: (t: LibraryTheme) => t.scheme.timber },
  { key: 'wall', label: 'wallpaper', colour: (t: LibraryTheme) => t.scheme.wall },
] as const satisfies readonly {
  key: 'shelf' | 'wall';
  label: string;
  colour: (t: LibraryTheme) => string;
}[];

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

  const theme = (): LibraryTheme => getTheme(libraryPrefs.theme);

  /** Surprise me — any room but the one you are standing in. */
  const surprise = (): void => {
    const others = THEME_IDS.filter((id) => id !== libraryPrefs.theme);
    const pick = others[Math.floor(Math.random() * others.length)];
    if (pick !== undefined) patch({ theme: pick });
  };

  return (
    <div class="nb-library-studio" data-busy={busy() ? 'true' : 'false'}>
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          the room <em class="nb-panel-row-hint">{theme().name.toLowerCase()}</em>
        </h3>
        <div class="nb-theme-grid" role="group" aria-label="Library theme">
          <For each={THEME_IDS}>
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
        The three parts, each free to come from a different room. A preset
        above sets all three at once; these override it one at a time, so
        liking one room's timber and another's books is finally expressible.
      */}
      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">mix it up</h3>
        <For each={PARTS}>
          {(part) => (
            <div class="nb-panel-row nb-panel-row-stack">
              <span class="nb-panel-row-label">
                {part.label}{' '}
                <em class="nb-panel-row-hint">
                  {getTheme(partTheme(libraryPrefs, part.key)).name.toLowerCase()}
                </em>
              </span>
              <div class="nb-chip-row" role="group" aria-label={`${part.label} colours`}>
                <For each={THEME_IDS}>
                  {(id) => (
                    <button
                      type="button"
                      class="nb-chip nb-chip-swatch"
                      aria-pressed={partTheme(libraryPrefs, part.key) === id}
                      aria-label={`${part.label}: ${getTheme(id).name}`}
                      title={getTheme(id).name}
                      style={{ '--nb-swatch': part.colour(getTheme(id)) }}
                      onClick={() =>
                        patch({
                          // Clear back to "follow the room" when the pick IS
                          // the room's own, so the preset keeps driving it.
                          [part.key]: id === libraryPrefs.theme ? null : id,
                        })
                      }
                    >
                      <span class="nb-chip-swatch-dot" aria-hidden="true" />
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
        <p class="nb-panel-footnote">
          Books keep their own colours in every room — that is how you spot
          yours. To change one, right-click its spine and pick “dress this
          book”; to move it, right-click and pick “move”.
        </p>
      </section>

      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">the palette</h3>
        <Swatches scheme={resolveLibrary(libraryPrefs).scheme} name={theme().name} />
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
        </div>
      </section>
    </div>
  );
}
