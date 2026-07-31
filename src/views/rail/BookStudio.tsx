/**
 * src/views/rail/BookStudio.tsx — the studio's "This book" tab.
 *
 * Every knob from docs/design/library-themes.md §4: binding material,
 * pigment + hue jitter, raised bands, endbands, ornament stamp, title plate
 * and face, wear, edge treatment, format/height/thickness, charms, and the
 * cover's frame · medallion · corner protectors · inset plate.
 *
 * One live preview that FLIPS between the spine and the cover, both painted
 * with the real renderers (`renderSpine` / `renderCoverInto`) fed by
 * `resolveBookStyle`, so the preview and the shelf cannot disagree.
 *
 * Persistence is two-headed on purpose:
 *  - the merged style goes to `cover_meta.style` (the shelf, the pull-out
 *    ghost and the studio all read it back through `resolveBookStyle`);
 *  - the cover-facing projection goes out through `onOverridesChange` to
 *    `cover_meta.cover`, which is what the OPEN book's cover art reads.
 * Writing both keeps a book recognisably itself in all three places.
 */
import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js';
import {
  BINDING_MATERIALS,
  CHARMS,
  CHARM_COLORS,
  CHARM_COLOR_LABELS,
  CHARM_LABELS,
  EDGE_LABELS,
  EDGE_TREATMENTS,
  MATERIAL_LABELS,
  MAX_RAISED_BANDS,
  ORNAMENT_LABELS,
  ORNAMENT_NONE,
  PIGMENT_COUNT,
  PIGMENT_LABELS,
  SPINE_FORMATS,
  SPINE_FORMAT_IDS,
  SPINE_THICKNESS_RANGE,
  TITLE_FONTS,
  TITLE_PLATES,
  TITLE_PLATE_LABELS,
  WEAR_STOPS,
  bookStyleToOverrides,
  heightForFormat,
  randomBookStyleOverrides,
  resolveBookStyle,
  type BookStyle,
  type BookStyleOverrides,
  type SpineFormat,
} from '../../art/bookStyle';
import { renderCoverInto } from '../../art/covers';
import {
  coverOverridesFromStyle,
  themeSpineDefaults,
} from '../../features/bookshelf/bookIdentity';
import { getSpinePalette, renderSpine, type Ctx2D } from '../../art/spines';
import { getTheme } from '../../art/themes';
import { libraryPrefs } from '../../features/bookshelf/libraryPrefs';

const PREVIEW_W = 214;
const PREVIEW_H = 292;

export { coverOverridesFromStyle };

export interface BookStudioProps {
  spineSeed: number;
  title: string;
  /** Persisted `cover_meta.style` blob (loose JSON; normalized on read). */
  style: Record<string, unknown> | null;
  onStyleChange(next: BookStyleOverrides | null): void;
  pageCount?: number;
}

export default function BookStudio(props: BookStudioProps): JSX.Element {
  const [face, setFace] = createSignal<'spine' | 'cover'>('spine');
  let spineCanvas: HTMLCanvasElement | undefined;
  let coverCanvas: HTMLCanvasElement | undefined;

  const resolved = createMemo(() =>
    resolveBookStyle(props.spineSeed, themeSpineDefaults(getTheme(libraryPrefs.theme)), props.style, {
      pageCount: props.pageCount,
    }),
  );
  const style = (): BookStyle => resolved().style;

  /** Merge one field into the persisted override blob. */
  const patch = (partial: Partial<BookStyle>): void => {
    // Freezing the whole merged style makes every knob explicit, which is
    // exactly the "an override always wins, in every room" contract.
    props.onStyleChange({ ...bookStyleToOverrides(style()), ...partial });
  };

  /* --------------------------- live preview art -------------------------- */

  createEffect(
    on(
      () => [resolved(), props.title, face()] as const,
      () => {
        const r = resolved();
        const dpr = Math.min(2, window.devicePixelRatio || 1);

        const cover = coverCanvas;
        if (cover) {
          cover.width = Math.round(PREVIEW_W * dpr);
          cover.height = Math.round(PREVIEW_H * dpr);
          const ctx = cover.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, cover.width, cover.height);
            renderCoverInto(ctx, cover.width, cover.height, r.cover, props.title);
          }
        }

        const spine = spineCanvas;
        if (spine) {
          spine.width = Math.round(PREVIEW_W * dpr);
          spine.height = Math.round(PREVIEW_H * dpr);
          const ctx = spine.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, spine.width, spine.height);
            // Fill the preview box with the spine drawn at its true aspect —
            // a thin duodecimo really does look thin next to a folio.
            const artH = r.style.height;
            const scale = ((PREVIEW_H - 18) * dpr) / artH;
            const w = r.spine.w * scale;
            ctx.save();
            ctx.translate((spine.width - w) / 2, 9 * dpr);
            renderSpine(ctx as Ctx2D, r.spine, 0, 0, artH * scale, scale, props.title, {
              hiRes: true,
            });
            ctx.restore();
          }
        }
      },
    ),
  );

  const pigmentSwatch = (i: number): string => {
    const p = getSpinePalette({ ...resolved().spine, palette: i, hueJitter: 0 });
    return `linear-gradient(160deg, ${p.top}, ${p.bottom})`;
  };

  const randomise = (): void => {
    patch(randomBookStyleOverrides((Math.random() * 0xffffffff) >>> 0) as Partial<BookStyle>);
  };

  const surprise = (): void => {
    // A whole new book: reroll the style AND let the room's bias back in.
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const fresh = resolveBookStyle(seed, themeSpineDefaults(getTheme(libraryPrefs.theme)), null, {
      pageCount: props.pageCount,
    });
    props.onStyleChange(bookStyleToOverrides(fresh.style));
  };

  /**
   * Per-section luck: the knobs each section's dice re-rolls, keyed by the
   * section's aria label. Draws come from randomBookStyleOverrides so they
   * stay inside the same tasteful legal domain as the big "randomise".
   * Format re-rolls height only — resolveBookStyle derives format from it.
   */
  const REROLL_GROUPS = {
    binding: ['material'],
    pigment: ['pigment', 'hueJitter'],
    'bands & endbands': ['raisedBands', 'bandGilt', 'headTail', 'headTailStyle'],
    'ornament stamp': ['ornament'],
    'title plate': ['titlePlate', 'titleFont', 'gilt'],
    'wear & edges': ['wear', 'edge'],
    format: ['height'],
    charm: ['charm', 'charmColor'],
    cover: ['coverFrame', 'coverMedallion', 'cornerProtectors', 'insetPlate'],
  } as const satisfies Record<string, readonly (keyof BookStyle)[]>;

  const reroll = (keys: readonly (keyof BookStyle)[]): void => {
    // A press should visibly move: redraw a few times when the draw matches
    // the current value on every knob in the group.
    let draw = randomBookStyleOverrides((Math.random() * 0xffffffff) >>> 0);
    for (let tries = 0; tries < 3; tries += 1) {
      if (keys.some((key) => !Object.is(draw[key], style()[key]))) break;
      draw = randomBookStyleOverrides((Math.random() * 0xffffffff) >>> 0);
    }
    const partial: Record<string, unknown> = {};
    for (const key of keys) {
      const value = draw[key];
      if (value !== undefined) partial[key] = value;
    }
    patch(partial as Partial<BookStyle>);
  };

  return (
    <div class="nb-book-studio">
      {/* ------------------------- flipping preview ------------------------ */}
      <div class="nb-studio-stage">
        <div
          class="nb-studio-flip"
          classList={{ 'is-cover': face() === 'cover' }}
          style={{ width: `${PREVIEW_W}px`, height: `${PREVIEW_H}px` }}
        >
          <canvas
            class="nb-studio-face nb-studio-face-spine"
            ref={(el) => (spineCanvas = el)}
            width={PREVIEW_W}
            height={PREVIEW_H}
            aria-label="Spine preview"
          />
          <canvas
            class="nb-studio-face nb-studio-face-cover"
            ref={(el) => (coverCanvas = el)}
            width={PREVIEW_W}
            height={PREVIEW_H}
            aria-label="Cover preview"
          />
        </div>
        <div class="nb-chip-row nb-studio-facepick" role="group" aria-label="Preview face">
          <button
            type="button"
            class="nb-chip"
            aria-pressed={face() === 'spine'}
            onClick={() => setFace('spine')}
          >
            spine
          </button>
          <button
            type="button"
            class="nb-chip"
            aria-pressed={face() === 'cover'}
            onClick={() => setFace('cover')}
          >
            cover
          </button>
        </div>
      </div>

      {/* ------------------------------ binding ---------------------------- */}
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          binding
          <RerollDice section="binding" onClick={() => reroll(REROLL_GROUPS.binding)} />
        </h3>
        <div class="nb-chip-row" role="group" aria-label="Binding material">
          <For each={BINDING_MATERIALS}>
            {(m) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={style().material === m}
                onClick={() => patch({ material: m })}
              >
                {MATERIAL_LABELS[m].toLowerCase()}
              </button>
            )}
          </For>
        </div>
      </section>

      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          pigment <em class="nb-panel-row-hint">{PIGMENT_LABELS[style().pigment]}</em>
          <RerollDice section="pigment" onClick={() => reroll(REROLL_GROUPS.pigment)} />
        </h3>
        <div class="nb-swatch-grid" role="group" aria-label="Spine pigment">
          <For each={Array.from({ length: PIGMENT_COUNT }, (_, i) => i)}>
            {(i) => (
              <button
                type="button"
                class="nb-swatch"
                style={{ background: pigmentSwatch(i) }}
                aria-label={PIGMENT_LABELS[i] ?? `pigment ${i + 1}`}
                aria-pressed={style().pigment === i}
                classList={{ 'is-active': style().pigment === i }}
                onClick={() => patch({ pigment: i })}
              />
            )}
          </For>
        </div>
        <label class="nb-panel-row">
          <span class="nb-panel-row-label">
            hue shift <em class="nb-panel-row-hint">{style().hueJitter.toFixed(0)}°</em>
          </span>
          <input
            type="range"
            class="nb-panel-slider"
            min={-12}
            max={12}
            step={1}
            value={style().hueJitter}
            aria-label="Hue shift"
            onInput={(e) => patch({ hueJitter: Number(e.currentTarget.value) })}
          />
        </label>
      </section>

      {/* ------------------------------- bands ----------------------------- */}
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          bands & endbands
          <RerollDice section="bands & endbands" onClick={() => reroll(REROLL_GROUPS['bands & endbands'])} />
        </h3>
        <label class="nb-panel-row">
          <span class="nb-panel-row-label">
            raised cords <em class="nb-panel-row-hint">{style().raisedBands}</em>
          </span>
          <input
            type="range"
            class="nb-panel-slider"
            min={0}
            max={MAX_RAISED_BANDS}
            step={1}
            value={style().raisedBands}
            aria-label="Raised bands"
            onInput={(e) => patch({ raisedBands: Number(e.currentTarget.value) })}
          />
        </label>
        <div class="nb-chip-row">
          <button
            type="button"
            class="nb-chip nb-chip-gilt"
            role="switch"
            aria-checked={style().bandGilt}
            onClick={() => patch({ bandGilt: !style().bandGilt })}
          >
            gilt rules
          </button>
          <button
            type="button"
            class="nb-chip"
            role="switch"
            aria-checked={style().headTail}
            aria-pressed={style().headTail}
            onClick={() => patch({ headTail: !style().headTail })}
          >
            endbands
          </button>
          <Show when={style().headTail}>
            <For each={['blocks', 'chevron', 'cord']}>
              {(name, i) => (
                <button
                  type="button"
                  class="nb-chip"
                  aria-pressed={style().headTailStyle === i()}
                  onClick={() => patch({ headTailStyle: i() })}
                >
                  {name}
                </button>
              )}
            </For>
          </Show>
        </div>
      </section>

      {/* ----------------------------- ornament ---------------------------- */}
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          ornament stamp
          <RerollDice section="ornament stamp" onClick={() => reroll(REROLL_GROUPS['ornament stamp'])} />
        </h3>
        <div class="nb-chip-grid" role="group" aria-label="Ornament stamp">
          <button
            type="button"
            class="nb-chip nb-chip-ghost"
            aria-pressed={style().ornament === ORNAMENT_NONE}
            onClick={() => patch({ ornament: ORNAMENT_NONE })}
          >
            none
          </button>
          <For each={ORNAMENT_LABELS}>
            {(label, i) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={style().ornament === i()}
                onClick={() => patch({ ornament: i() })}
              >
                {label.toLowerCase()}
              </button>
            )}
          </For>
        </div>
      </section>

      {/* --------------------------- title & plate ------------------------- */}
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          title plate
          <RerollDice section="title plate" onClick={() => reroll(REROLL_GROUPS['title plate'])} />
        </h3>
        <div class="nb-chip-row" role="group" aria-label="Title plate">
          <For each={TITLE_PLATES}>
            {(p) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={style().titlePlate === p}
                onClick={() => patch({ titlePlate: p })}
              >
                {TITLE_PLATE_LABELS[p].toLowerCase()}
              </button>
            )}
          </For>
        </div>
        <div class="nb-chip-row" role="group" aria-label="Title lettering">
          <For each={TITLE_FONTS}>
            {(name, i) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={style().titleFont === i()}
                onClick={() => patch({ titleFont: i() as 0 | 1 | 2 })}
              >
                {name}
              </button>
            )}
          </For>
          <button
            type="button"
            class="nb-chip nb-chip-gilt"
            role="switch"
            aria-checked={style().gilt}
            onClick={() => patch({ gilt: !style().gilt })}
          >
            gold tooling
          </button>
        </div>
      </section>

      {/* ------------------------- wear & text block ----------------------- */}
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          wear <em class="nb-panel-row-hint">{wearLabel(style().wear)}</em>
          <RerollDice section="wear & edges" onClick={() => reroll(REROLL_GROUPS['wear & edges'])} />
        </h3>
        <input
          type="range"
          class="nb-panel-slider"
          min={0}
          max={1}
          step={0.05}
          value={style().wear}
          aria-label="Wear"
          onInput={(e) => patch({ wear: Number(e.currentTarget.value) })}
        />
        <h3 class="nb-panel-section-title nb-panel-section-title-sub">edges</h3>
        <div class="nb-chip-row" role="group" aria-label="Edge treatment">
          <For each={EDGE_TREATMENTS}>
            {(e) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={style().edge === e}
                onClick={() => patch({ edge: e })}
              >
                {EDGE_LABELS[e].toLowerCase()}
              </button>
            )}
          </For>
        </div>
      </section>

      {/* --------------------------- size & format ------------------------- */}
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          format <em class="nb-panel-row-hint">{Math.round(style().height)}px tall</em>
          <RerollDice section="format" onClick={() => reroll(REROLL_GROUPS.format)} />
        </h3>
        <div class="nb-chip-row" role="group" aria-label="Book format">
          <For each={SPINE_FORMAT_IDS}>
            {(f: SpineFormat) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={style().format === f}
                onClick={() => patch({ format: f, height: heightForFormat(f) })}
              >
                {String(SPINE_FORMATS[f]?.label ?? f).toLowerCase()}
              </button>
            )}
          </For>
        </div>
        <label class="nb-panel-row">
          <span class="nb-panel-row-label">
            thickness <em class="nb-panel-row-hint">{Math.round(style().thickness)}px</em>
          </span>
          <input
            type="range"
            class="nb-panel-slider"
            min={SPINE_THICKNESS_RANGE.min}
            max={SPINE_THICKNESS_RANGE.max}
            step={1}
            value={style().thickness}
            aria-label="Spine thickness"
            onInput={(e) => patch({ thickness: Number(e.currentTarget.value) })}
          />
        </label>
      </section>

      {/* ------------------------------- charms ---------------------------- */}
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          charm
          <RerollDice section="charm" onClick={() => reroll(REROLL_GROUPS.charm)} />
        </h3>
        <div class="nb-chip-grid" role="group" aria-label="Charm">
          <For each={CHARMS}>
            {(c) => (
              <button
                type="button"
                class="nb-chip"
                classList={{ 'nb-chip-ghost': c === 'none' }}
                aria-pressed={style().charm === c}
                onClick={() => patch({ charm: c })}
              >
                {CHARM_LABELS[c].toLowerCase()}
              </button>
            )}
          </For>
        </div>
        <Show when={style().charm !== 'none'}>
          <div class="nb-swatch-grid nb-swatch-grid-charm" role="group" aria-label="Charm colour">
            <For each={CHARM_COLORS}>
              {(hex, i) => (
                <button
                  type="button"
                  class="nb-swatch"
                  style={{ background: hex }}
                  aria-label={CHARM_COLOR_LABELS[i()] ?? `colour ${i() + 1}`}
                  aria-pressed={style().charmColor === i()}
                  classList={{ 'is-active': style().charmColor === i() }}
                  onClick={() => patch({ charmColor: i() })}
                />
              )}
            </For>
          </div>
        </Show>
      </section>

      {/* -------------------------------- cover ---------------------------- */}
      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">
          cover
          <RerollDice section="cover" onClick={() => reroll(REROLL_GROUPS.cover)} />
        </h3>
        <div class="nb-chip-row" role="group" aria-label="Cover frame">
          <For each={['rules', 'corners', 'scallop', 'stitch']}>
            {(name, i) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={style().coverFrame === i()}
                onClick={() => {
                  setFace('cover');
                  patch({ coverFrame: i() });
                }}
              >
                {name}
              </button>
            )}
          </For>
        </div>
        <div class="nb-chip-grid" role="group" aria-label="Cover medallion">
          <For each={['diamond', 'laurel', 'star', 'flower', 'chevron', 'sun', 'moon', 'keyhole']}>
            {(name, i) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={style().coverMedallion === i()}
                onClick={() => {
                  setFace('cover');
                  patch({ coverMedallion: i() });
                }}
              >
                {name}
              </button>
            )}
          </For>
        </div>
        <div class="nb-chip-row">
          <button
            type="button"
            class="nb-chip"
            role="switch"
            aria-checked={style().cornerProtectors}
            onClick={() => {
              setFace('cover');
              patch({ cornerProtectors: !style().cornerProtectors });
            }}
          >
            corner protectors
          </button>
          <button
            type="button"
            class="nb-chip"
            role="switch"
            aria-checked={style().insetPlate}
            onClick={() => {
              setFace('cover');
              patch({ insetPlate: !style().insetPlate });
            }}
          >
            inset plate
          </button>
        </div>
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
            onClick={() => props.onStyleChange(null)}
          >
            follow the room
          </button>
        </div>
        <p class="nb-panel-footnote">
          unset knobs follow the library theme; anything you touch stays yours in every room
        </p>
      </section>
    </div>
  );
}

/**
 * A tiny dice button pinned to a section title — the per-field counterpart
 * of the big "randomise". Same pre-wobbled stroke idiom as the shelf dock
 * icons (fill:none paths, so a missing stylesheet can't black-box it).
 */
function RerollDice(props: { section: string; onClick(): void }): JSX.Element {
  return (
    <button
      type="button"
      class="nb-reroll"
      aria-label={`Reroll ${props.section}`}
      title={`Reroll ${props.section}`}
      onClick={props.onClick}
    >
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5.3 4.8 L22.5 4.4 C23.3 4.4 23.9 5.0 24.0 5.8 L23.6 22.4 C23.6 23.2 23.0 23.8 22.2 23.9 L5.7 23.5 C4.9 23.5 4.3 22.9 4.2 22.1 L4.6 6.1 C4.6 5.3 4.9 4.9 5.3 4.8 Z" />
          <circle cx="10.0" cy="10.1" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="14.1" cy="14.1" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="18.3" cy="18.1" r="1.15" fill="currentColor" stroke="none" />
        </g>
      </svg>
    </button>
  );
}

/** Nearest named wear stop, for the slider's readout. */
function wearLabel(wear: number): string {
  const stops = WEAR_STOPS as readonly { label: string; value: number }[];
  let best = stops[0]?.label ?? '';
  let bestD = Infinity;
  for (const stop of stops) {
    const d = Math.abs(stop.value - wear);
    if (d < bestD) {
      bestD = d;
      best = stop.label;
    }
  }
  return best.toLowerCase();
}
