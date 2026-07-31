/**
 * src/views/rail/BookStudio.tsx — the studio's "This book" tab.
 *
 * Every knob from docs/design/library-themes.md §4: binding material,
 * pigment + hue jitter, raised bands, endbands, ornament stamp, title plate
 * and face, wear, edge treatment, format/height/thickness, charms, and the
 * cover's frame · medallion · corner protectors · inset plate. On top of
 * those sits the BINDING — the sixty-two bound books of `art/bookDesign.ts`,
 * three composable axes (silhouette × material × tooling) rolled into named
 * presets.
 *
 * One live preview that FLIPS between the spine and the cover, both painted
 * with the real renderers (`renderSpine` / `renderCoverInto`) fed by
 * `resolveBookStyle`, so the preview and the shelf cannot disagree. The
 * binding has its own previews for the same reason: it is drawn by
 * `drawBookSpine`, the routine that will draw it on the shelf.
 *
 * Persistence is three-headed:
 *  - the merged style goes to `cover_meta.style` (the shelf, the pull-out
 *    ghost and the studio all read it back through `resolveBookStyle`);
 *  - the cover-facing projection goes out through `onOverridesChange` to
 *    `cover_meta.cover`, which is what the OPEN book's cover art reads;
 *  - the binding goes to `designPrefs`, because `BookStyle` has no field for
 *    it and `normalizeBookStyleOverrides` — in a file this panel does not own
 *    — drops any key it does not know.
 */
import { For, Show, createEffect, createMemo, createSignal, on, onMount, type JSX } from 'solid-js';
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
import {
  BOOK_PRESETS,
  bookPreset,
  presetForSeed,
  resolveBookDesign,
  type BookDesign,
  type BookPresetId,
} from '../../art/bookDesign';
import { renderCoverInto } from '../../art/covers';
import { flatSpineFor } from '../../art/flatShelf';
import type { FlatScheme } from '../../art/flat';
import {
  coverOverridesFromStyle,
  themeSpineDefaults,
} from '../../features/bookshelf/bookIdentity';
import { clothForPalette, getSpinePalette, renderSpine, type Ctx2D } from '../../art/spines';
import { getTheme } from '../../art/themes';
import { libraryPrefs, resolveLibrary } from '../../features/bookshelf/libraryPrefs';
import DesignPicker from './DesignPicker';
import DesignStrip from './DesignStrip';
import { DesignCanvas } from './designArt';
import { bindingOptions, drawBindingCard } from './designOptions';
import { bookBinding, loadDesignPrefs, saveBookBinding } from '../../data/designPrefs';
import { stopShelfKeys } from './shelfKeys';
import '../../styles/studio.css';

const PREVIEW_W = 214;
const PREVIEW_H = 292;
/**
 * The binding's own preview. A spine's proportions, not a card's: the book
 * inside is drawn at a real 42 x 165, so a much wider card is mostly empty
 * bay and a much narrower one crops the yapp lips and ribbons that are
 * supposed to break the footprint.
 */
const BINDING_W = 106;
const BINDING_H = 190;

export { coverOverridesFromStyle };

export interface BookStudioProps {
  spineSeed: number;
  title: string;
  /** Persisted `cover_meta.style` blob (loose JSON; normalized on read). */
  style: Record<string, unknown> | null;
  onStyleChange(next: BookStyleOverrides | null): void;
  pageCount?: number;
  /**
   * The book's row id, for the binding store.
   *
   * Optional because the panel above this one (CustomizePanel, not owned
   * here) does not pass it yet. Falling back to the art seed is safe — it is
   * per-book, stable for the life of the book, and derivable anywhere a `Book`
   * is in hand — but an explicit id is better and should win when it arrives.
   */
  bookId?: string;
}

export default function BookStudio(props: BookStudioProps): JSX.Element {
  const [face, setFace] = createSignal<'spine' | 'cover'>('spine');
  const [bindingSheet, setBindingSheet] = createSignal(false);
  let spineCanvas: HTMLCanvasElement | undefined;
  let coverCanvas: HTMLCanvasElement | undefined;

  onMount(() => {
    void loadDesignPrefs();
  });

  const resolved = createMemo(() =>
    resolveBookStyle(props.spineSeed, themeSpineDefaults(getTheme(libraryPrefs.theme)), props.style, {
      pageCount: props.pageCount,
    }),
  );
  const style = (): BookStyle => resolved().style;

  /* ------------------------------- binding ------------------------------- */

  const bindingKey = (): string => props.bookId ?? `seed:${props.spineSeed >>> 0}`;
  /** The pinned binding, or null while the book's seed is still choosing. */
  const pinned = (): BookPresetId | null => bookBinding(bindingKey());
  /** What the seed would pick on its own — the "follow the seed" answer. */
  const seedBinding = (): BookPresetId => presetForSeed(props.spineSeed).id;

  /**
   * The design the shelf will draw. Built from the book's OWN cloth and gilt
   * rather than from the room, because a book keeps its colours wherever it
   * stands; only the ground behind the preview follows the room.
   */
  const design = createMemo<BookDesign>(() =>
    resolveBookDesign({
      seed: props.spineSeed,
      cloth: clothForPalette(resolved().spine.palette),
      gilt: style().gilt,
      labelAt: flatSpineFor(props.spineSeed).labelAt,
      preset: pinned(),
    }),
  );

  /** The shelf the binding cards stand on — the room's timber and recess. */
  const roomScheme = (): FlatScheme => resolveLibrary(libraryPrefs).scheme;

  const bindings = createMemo(() =>
    bindingOptions({
      seed: props.spineSeed,
      cloth: clothForPalette(resolved().spine.palette),
      gilt: style().gilt,
      labelAt: flatSpineFor(props.spineSeed).labelAt,
    }),
  );

  const pickBinding = (id: BookPresetId): void => {
    void saveBookBinding(bindingKey(), id);
  };

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

  /**
   * The whole vocabulary, not one field.
   *
   * `randomBookStyleOverrides` already draws every knob in `BookStyle`; what
   * it cannot reach is the binding, which lives in its own store, and the
   * thickness, which it leaves to the page count. Rolling all three is the
   * difference between a dice that redresses the book and one that nudges it.
   * The binding is drawn WEIGHTED (`presetForSeed`), so the dice keeps landing
   * on plain cloth and wrappers most of the time — the same distribution a
   * real shelf has, and the reason the rare bindings feel rare.
   */
  const randomise = (): void => {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const draw = randomBookStyleOverrides(seed);
    patch({
      ...draw,
      thickness:
        SPINE_THICKNESS_RANGE.min +
        Math.round(Math.random() * (SPINE_THICKNESS_RANGE.max - SPINE_THICKNESS_RANGE.min)),
    } as Partial<BookStyle>);
    let binding = presetForSeed(seed).id;
    // A press has to visibly move. Redraw when the weighted pick happens to be
    // the binding already on the book.
    for (let tries = 0; tries < 4 && binding === design().preset; tries += 1) {
      binding = presetForSeed((Math.random() * 0xffffffff) >>> 0).id;
    }
    void saveBookBinding(bindingKey(), binding);
  };

  const surprise = (): void => {
    // A whole new book: reroll the style AND let the room's bias back in.
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const fresh = resolveBookStyle(seed, themeSpineDefaults(getTheme(libraryPrefs.theme)), null, {
      pageCount: props.pageCount,
    });
    props.onStyleChange(bookStyleToOverrides(fresh.style));
    // Unpin the binding too: "a whole new book" means the seed gets its say
    // back on every axis, not on all but one.
    void saveBookBinding(bindingKey(), null);
  };

  /**
   * Per-section luck: the knobs each section's dice re-rolls, keyed by the
   * section's aria label. Draws come from randomBookStyleOverrides so they
   * stay inside the same tasteful legal domain as the big "randomise".
   * Format re-rolls height only — resolveBookStyle derives format from it.
   */
  const REROLL_GROUPS = {
    /* "binding" now names the whole bound book (shape + material + tooling),
       so this narrower knob goes back to what it actually is: the cloth. */
    material: ['material'],
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
    /* Same guard as the library tab: the shelf's document-level arrows/Enter
       must not reach past an open studio. See shelfKeys.ts. */
    <div class="nb-book-studio" on:keydown={stopShelfKeys}>
      {/*
        Sibling Shows with callback children — see the same note in
        LibraryStudio. A picker built inside a Show's `fallback` is rebuilt
        every time the thing it edits changes, which threw focus to the body
        and scrolled the reader back to the top on every card press.
      */}
      <Show when={bindingSheet()}>
        {(_open) => (
          <DesignPicker
            title="how it is bound"
            hint="silhouette, covering and tooling, chosen together. the cloth stays this book's own."
            options={bindings()}
            activeId={design().preset}
            scheme={roomScheme()}
            onPick={(id) => pickBinding(id)}
            onBack={() => setBindingSheet(false)}
            cardW={100}
            cardH={150}
            columns={3}
            searchLabel="Search bindings"
          />
        )}
      </Show>

      <Show when={!bindingSheet()}>
        {(_closed) => (
          <>
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
      {/*
        The biggest decision on the sheet, so it comes first. Its previews are
        drawn by `drawBookSpine` — the routine that binds the book on the shelf
        — standing on the room's own timber, because a pale vellum against reef
        timber is a different book from the same vellum against athenaeum's.
      */}
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          binding <em class="nb-panel-row-hint">{bookPreset(design().preset).label.toLowerCase()}</em>
        </h3>
        <div class="nb-binding-stage">
          <DesignCanvas
            class="nb-binding-preview"
            key={`bind|${design().preset}|${design().cloth}|${design().accent}|${design().gilt ? 'g' : 'n'}|${design().labelAt.toFixed(2)}|big`}
            w={BINDING_W}
            h={BINDING_H}
            scheme={roomScheme()}
            alt={`${bookPreset(design().preset).label}, bound`}
            draw={(ctx, w, h) => drawBindingCard(ctx, w, h, design())}
          />
        </div>
        <DesignStrip
          label="Binding"
          options={bindings()}
          activeId={design().preset}
          scheme={roomScheme()}
          onPick={(id) => pickBinding(id)}
          onMore={() => setBindingSheet(true)}
          /* Seven and the way through fill two rows of four exactly; eight
             would leave the "more…" cell alone on a third row looking like an
             afterthought. */
          columns={4}
          limit={7}
          tileW={72}
          tileH={104}
        />
        <Show when={pinned() !== null && pinned() !== seedBinding()}>
          <div class="nb-chip-row">
            <button
              type="button"
              class="nb-chip nb-chip-ghost"
              onClick={() => void saveBookBinding(bindingKey(), null)}
            >
              back to {bookPreset(seedBinding()).label.toLowerCase()}
            </button>
          </div>
        </Show>
        <p class="nb-panel-footnote">
          {BOOK_PRESETS.length} bindings. the cloth, the gilt and the lettering
          stay yours — a binding changes how the book is MADE, not what colour
          it is.
        </p>
      </section>

      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          cloth
          <RerollDice section="cloth" onClick={() => reroll(REROLL_GROUPS.material)} />
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
            onClick={() => {
              props.onStyleChange(null);
              void saveBookBinding(bindingKey(), null);
            }}
          >
            follow the room
          </button>
        </div>
        <p class="nb-panel-footnote">
          unset knobs follow the library theme; anything you touch stays yours in every room
        </p>
      </section>
          </>
        )}
      </Show>
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
