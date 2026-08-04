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
  charmColorCss,
  EDGE_LABELS,
  EDGE_TREATMENTS,
  MATERIAL_LABELS,
  MAX_RAISED_BANDS,
  ORNAMENT_LABELS,
  ORNAMENT_NONE,
  SPINE_FORMATS,
  SPINE_FORMAT_IDS,
  SPINE_HEIGHT_RANGE,
  SPINE_THICKNESS_RANGE,
  TITLE_FONTS,
  PIGMENT_LABELS,
  TITLE_PLATES,
  TITLE_PLATE_LABELS,
  WEAR_STOPS,
  bookStyleToOverrides,
  heightForFormat,
  normalizeBookStyleOverrides,
  randomBookStyleOverrides,
  resolveBookStyle,
  type BookStyle,
  type BookStyleOverrides,
  type SpineFormat,
} from '../../art/bookStyle';
import { CLOTHS } from '../../art/flat';
import {
  BOOK_PRESETS,
  ROLLABLE_DECORATIONS,
  ROLLABLE_MATERIALS,
  ROLLABLE_SHAPES,
  SHAPE_LABELS,
  bindingMaterialFor,
  bookPreset,
  materialLookFor,
  ownBindingId,
  parseOwnBinding,
  presetForSeed,
  resolveBookDesign,
  type BookDesign,
  type BookPresetId,
  type OwnBinding,
} from '../../art/bookDesign';
import { COVER_ASPECT, renderCoverInto } from '../../art/covers';
import { flatSpineFor } from '../../art/flatShelf';
import type { FlatScheme } from '../../art/flat';
import {
  coverOverridesFromStyle as resolvedCoverOverrides,
  themeSpineDefaults,
} from '../../features/bookshelf/bookIdentity';
import type { CoverOverrides } from '../../art/covers';
import { PIGMENT_CLOTH_NAMES, clothForPalette, renderSpine, type Ctx2D } from '../../art/spines';
import { PALETTE_PAGE } from '../../art/customColour';
import OwnColour from './OwnColour';
import { getTheme } from '../../art/themes';
import { libraryPrefs, resolveLibrary } from '../../features/bookshelf/libraryPrefs';
import DesignPicker, { type PickerOption } from './DesignPicker';
import DesignStrip, { StarMark, cappedTo, createCuration, starWords } from './DesignStrip';
import { DesignCanvas } from './designArt';
import { bindingOptions, drawBindingCard, ownAxisOptions } from './designOptions';
import { bookBinding, loadDesignPrefs, saveBookBinding } from '../../data/designPrefs';
import type { CurationAxis } from '../../data/shelfOfMine';
import { stopShelfKeys } from './shelfKeys';
import '../../styles/studio.css';

const PREVIEW_W = 214;
const PREVIEW_H = 292;
/**
 * Air above the tallest book and below every book, in preview px.
 *
 * The two faces are drawn to ONE scale and stood on ONE baseline, so a pocket
 * duodecimo previews short and a folio previews tall — which is the whole
 * point of the format chips, and which the preview used to deny by stretching
 * every spine to the full box and every board to a fixed 214×292.
 */
const STAGE_PAD_TOP = 12;
const STAGE_PAD_BOTTOM = 10;
/** Preview px per world px, set so the tallest legal book just fits. */
const STAGE_SCALE = (PREVIEW_H - STAGE_PAD_TOP - STAGE_PAD_BOTTOM) / SPINE_HEIGHT_RANGE.max;
/**
 * The binding's own preview. A spine's proportions, not a card's: the book
 * inside is drawn at a real 42 x 165, so a much wider card is mostly empty
 * bay and a much narrower one crops the yapp lips and ribbons that are
 * supposed to break the footprint.
 */
const BINDING_W = 106;
const BINDING_H = 190;
/**
 * How many cloth swatches show before "N more".
 *
 * Borrowed from `art/customColour.PALETTE_PAGE` rather than restated, so the
 * studio and the callout picker fold their palettes at the same place. That
 * module's own note explains why the number is twenty and why it is a
 * rendering budget as much as a layout one.
 */
const CLOTH_PAGE = PALETTE_PAGE;

/**
 * A row in one of the two colour grids, shaped so the reader's curation can key
 * on it.
 *
 * `id` and `name` are the whole of `CurationRow`; the third field is the value
 * the swatch actually writes. Naming the caption `name` rather than `label` is
 * not cosmetic — it is what lets the shared controller print a removed swatch
 * in the restore drawer without this panel handing it a translation table.
 */
interface ClothSwatch {
  readonly id: string;
  readonly name: string;
  readonly pigment: number;
}

interface CharmSwatch {
  readonly id: string;
  readonly name: string;
  readonly index: number;
  readonly hex: string;
}

/**
 * The three composable axes, in this panel's words and in the reader's.
 *
 * `art/bookDesign.ts` calls them shape / material / decoration; the reader is
 * shown "the shape of it", "what it is covered in" and "the marks on it", and
 * `CURATION_AXES` writes them down as 'spine-shape' / 'covering' / 'marks' —
 * named for what is being CHOSEN rather than for the module that implements it.
 * One table so a strip and the sheet it opens cannot pass different words for
 * the same list, which would give that list two arrangements.
 */
const OWN_AXIS_CURATION: Record<'shape' | 'material' | 'decoration', CurationAxis> = {
  shape: 'spine-shape',
  material: 'covering',
  decoration: 'marks',
};

/**
 * The cover-facing projection of what the reader has actually PINNED.
 *
 * `bookIdentity.coverOverridesFromStyle` takes a fully RESOLVED `BookStyle` —
 * every field a value, seed rolls and room bias already merged in. The panel
 * above this one (CustomizePanel) has no such object: it holds the OVERRIDE
 * blob, where a knob nobody has touched is simply absent. It handed that over
 * behind a cast, and the result was an object carrying every cover key with
 * most of them `undefined`.
 *
 * That is not harmless, because `covers.deriveCoverParams` merges with a
 * spread — and a spread copies keys whose value is `undefined`. So
 * `{ ...derived, ...overrides }` overwrote the seed's own `frame` with nothing,
 * `paintFrame` indexed `FRAMES[NaN]`, and the throw came back up through
 * `onStyleChange` and killed the `persistBookStyle` call that was supposed to
 * run on the next line. The visible symptom was that **the first edit a reader
 * made in a session was silently discarded** — the second onward stuck, because
 * Solid does not re-run a computation that has already thrown.
 *
 * Typing a colour of your own was the reliable way to meet it, colour being the
 * first thing most people reach for. The tell was that the hex field did not
 * clear on commit while the model had plainly taken the colour: the throw came
 * back through `onPick` and skipped the line after it, in both callers at once.
 * `shots-now/own-colour-book.mjs` keeps that honest — it types a colour as the
 * very first thing it does, and asserts on the row rather than on the panel.
 *
 * So the projection stays PARTIAL. A key the reader has not pinned is ABSENT,
 * not `undefined`, and the seed keeps its say — which is what the whole
 * `seed → theme → overrides` model promises anyway.
 */
export function coverOverridesFromStyle(over: BookStyleOverrides): CoverOverrides {
  // Projected through `bookIdentity`'s mapping rather than a second copy of it:
  // the studio must not grow its own opinion about which cover field a spine
  // field feeds. Only the FILTER belongs here.
  const full = resolvedCoverOverrides(over as BookStyle) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(full)) {
    // `null` survives on purpose — on `clothHex` it is a value ("I cleared my
    // own colour"), and dropping it would make the clear a no-op.
    if (full[key] !== undefined) out[key] = full[key];
  }
  // `texture` is DERIVED from `material` rather than copied across, so it comes
  // out of that mapping with a real number even when the reader has pinned no
  // covering at all. It is the one key the filter cannot see is unset.
  if (over.material === undefined) delete out.texture;
  return out as CoverOverrides;
}

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
  /** Which single axis has its long sheet open, or null. */
  const [axisSheet, setAxisSheet] = createSignal<'shape' | 'material' | 'decoration' | null>(null);
  // Signals rather than plain `let`s: opening the binding sheet unmounts the
  // stage and remounting it hands back NEW canvases. With a bare ref the draw
  // effect kept painting the detached ones and the reader came back to two
  // blank rectangles.
  const [spineCanvas, setSpineCanvas] = createSignal<HTMLCanvasElement | undefined>();
  const [coverCanvas, setCoverCanvas] = createSignal<HTMLCanvasElement | undefined>();

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
   * The cloth every card in this panel is painted in — the reader's own colour
   * when they entered one, the fold of their pigment otherwise.
   *
   * Exactly what `renderSpine` does with the same two fields, spelled once
   * here and read by all three consumers (the big binding preview, the preset
   * strip, the three axis strips). Spelled per consumer it drifted: the
   * bindings and the axes each did their own `clothForPalette` and a custom
   * colour reached the preview at the top of the sheet and none of the tiles
   * under it, so the studio disagreed with itself in one glance.
   */
  const cardCloth = (): number | string =>
    resolved().spine.clothHex ?? clothForPalette(resolved().spine.palette);

  /**
   * The design the shelf will draw. Built from the book's OWN cloth and gilt
   * rather than from the room, because a book keeps its colours wherever it
   * stands; only the ground behind the preview follows the room.
   */
  const design = createMemo<BookDesign>(() =>
    resolveBookDesign({
      seed: props.spineSeed,
      cloth: cardCloth(),
      gilt: style().gilt,
      labelAt: flatSpineFor(props.spineSeed).labelAt,
      preset: pinned(),
      // The same four axes `renderSpine` feeds it, so the binding card and the
      // live preview are one book rather than two.
      material: resolved().pinned.has('material') ? materialLookFor(style().material) : null,
      bands: style().raisedBands,
      bandGilt: style().bandGilt,
      headTail: style().headTail ? style().headTailStyle : null,
      wear: style().wear,
    }),
  );

  /** The shelf the binding cards stand on — the room's timber and recess. */
  const roomScheme = (): FlatScheme => resolveLibrary(libraryPrefs).scheme;

  const bindings = createMemo(() =>
    bindingOptions({
      seed: props.spineSeed,
      cloth: cardCloth(),
      gilt: style().gilt,
      labelAt: flatSpineFor(props.spineSeed).labelAt,
    }),
  );

  /**
   * The binding the axis pickers below are editing.
   *
   * A reader can arrive at those pickers from a curated preset ("Half
   * Morocco") rather than from a composed one, so the starting point is
   * whatever is bound NOW, decomposed — its shape, its covering, its first
   * mark, its foil. Touching one axis then keeps the other three, which is the
   * whole point of picking an axis at a time.
   *
   * `decorations[0]`, because a composed binding carries one mark and several
   * presets carry two. Dropping the second is visible and honest — the tile
   * shows the book you would get — where silently keeping it would make the
   * marks picker disagree with what is on the shelf.
   */
  const ownParts = createMemo<OwnBinding>(() => {
    const now = bookPreset(pinned() ?? seedBinding());
    return {
      shape: now.shape,
      material: now.material,
      decoration: now.decorations[0] ?? 'none',
      gilt: now.gilt,
    };
  });

  const axisOptions = (axis: 'shape' | 'material' | 'decoration'): readonly PickerOption[] =>
    ownAxisOptions(
      {
        seed: props.spineSeed,
        cloth: cardCloth(),
        gilt: style().gilt,
        labelAt: flatSpineFor(props.spineSeed).labelAt,
      },
      ownParts(),
      axis,
    );

  /** Compose and pin, keeping the three axes the reader did not touch. */
  const pickOwn = (patch: Partial<OwnBinding>): void => {
    void saveBookBinding(bindingKey(), ownBindingId({ ...ownParts(), ...patch }));
    // Same reason `pickBinding` does it: a composed binding names its own
    // covering, so a stale material override would redraw it as something
    // else and the sheet would disagree with itself in one glance.
    unpatch('material');
  };

  const pickBinding = (id: BookPresetId): void => {
    void saveBookBinding(bindingKey(), id);
    // A binding brings its own covering. Hand it back the say: otherwise
    // picking "Antique Vellum" over a book whose cloth chip had been touched
    // draws a morocco-grained "vellum", which is the studio disagreeing with
    // itself in the same glance.
    unpatch('material');
  };

  /**
   * The covering the reader is actually looking at: their own pick when they
   * made one, the binding's otherwise. The chips read off this rather than off
   * the merged style, whose `material` is a seed roll that nothing draws.
   */
  const covering = (): string =>
    resolved().pinned.has('material') ? style().material : bindingMaterialFor(design().material);

  /**
   * Merge one field into the persisted override blob.
   *
   * Genuinely a MERGE, over the blob as stored — not over the merged style.
   * The sheet's own footnote promises "unset knobs follow the library theme;
   * anything you touch stays yours", and freezing all twenty-two knobs the
   * first time one of them moved broke that promise on the first click. It
   * also destroyed the only record of what the reader actually chose, which is
   * what tells a binding whether its own covering has been overruled.
   */
  const patch = (partial: Partial<BookStyle>): void => {
    const current = normalizeBookStyleOverrides(props.style) ?? {};
    props.onStyleChange({ ...current, ...partial });
  };

  /** Drop fields back to "whatever the seed and the room say". */
  const unpatch = (...keys: readonly (keyof BookStyle)[]): void => {
    const current = { ...(normalizeBookStyleOverrides(props.style) ?? {}) };
    for (const key of keys) delete current[key];
    props.onStyleChange(Object.keys(current).length > 0 ? current : null);
  };

  /* --------------------------- live preview art -------------------------- */

  createEffect(
    on(
      () => [resolved(), props.title, face(), spineCanvas(), coverCanvas()] as const,
      () => {
        const r = resolved();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        // ONE scale, ONE baseline, for both faces. Everything below is in
        // preview px; the canvases are backing-store sized on top of that.
        const scale = STAGE_SCALE;
        const bookH = r.style.height * scale;
        const baseline = PREVIEW_H - STAGE_PAD_BOTTOM;

        const cover = coverCanvas();
        if (cover) {
          cover.width = Math.round(PREVIEW_W * dpr);
          cover.height = Math.round(PREVIEW_H * dpr);
          const ctx = cover.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, cover.width, cover.height);
            const boardW = bookH * COVER_ASPECT;
            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.translate((PREVIEW_W - boardW) / 2, baseline - bookH);
            renderCoverInto(ctx, boardW, bookH, r.cover, props.title);
            ctx.restore();
          }
        }

        const spine = spineCanvas();
        if (spine) {
          spine.width = Math.round(PREVIEW_W * dpr);
          spine.height = Math.round(PREVIEW_H * dpr);
          const ctx = spine.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, spine.width, spine.height);
            // The spine is drawn at the book's real thickness, so a pamphlet
            // is a sliver beside a tome — and at the same height as the cover
            // beside it, because they are two views of one object.
            const w = r.spine.w * scale;
            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.translate((PREVIEW_W - w) / 2, baseline - bookH);
            renderSpine(ctx as Ctx2D, r.spine, 0, 0, bookH, scale, props.title, {
              hiRes: true,
            });
            ctx.restore();
          }
        }
      },
    ),
  );

  /**
   * Every pigment, painted in the colour the book will ACTUALLY be.
   *
   * This was six entries, hand-listed, and the note above them explained why:
   * `clothForPalette` used to fold twenty pigments onto SIX cloths, so fourteen
   * of the twenty swatches repainted the book in a colour it already was, and
   * cutting the row to six was the honest thing to do about it.
   *
   * The fold is one-to-one now — fifty pigments, fifty cloths — so the reason
   * has expired and the list is derived rather than written: a pigment added to
   * `art/spines.ts` appears here, and a swatch can no longer name a colour the
   * spine does not paint. The label is the CLOTH's name (`PIGMENT_CLOTH_NAMES`)
   * and not the pigment's, because twenty-four of the fifty still land on a
   * cloth of another name and the tooltip has to answer "what colour is the
   * book", not "which row of a table did this come from".
   */
  const CLOTH_SWATCHES: readonly ClothSwatch[] = PIGMENT_LABELS.map((name, pigment) => ({
    // The curation is keyed by (axis, entry id) and the id goes into the
    // reader's SQLite row, so it is the pigment's INDEX as a string rather than
    // its label: a cloth renamed under a removal must come back as the same
    // removal, and the fifty labels are exactly the thing most likely to be
    // reworded.
    id: String(pigment),
    pigment,
    name: PIGMENT_CLOTH_NAMES[pigment] === '' ? name : (PIGMENT_CLOTH_NAMES[pigment] as string),
  }));

  /**
   * The pigment row is a list like any other, so the reader gets the same hand
   * on it: right-click to remove one they will never use, star one they always
   * do, and the drawer to take a removal back. It is a swatch grid rather than
   * a strip of cards, which is why it drives `createCuration` directly instead
   * of going through `DesignStrip` — same controller, different furniture.
   */
  const clothCuration = createCuration<ClothSwatch>(() => ({
    axis: 'spine-cloth',
    label: 'pigments',
    options: CLOTH_SWATCHES,
    activeId: String(style().pigment),
  }));

  /**
   * Twenty, then the rest behind a count — the house rule for a long list, and
   * the same fold `art/customColour.ts` states for every picker in the app.
   * The current pigment is always among the shown ones, or collapsing the grid
   * after picking from its tail would leave no swatch pressed and read as
   * though the choice had been forgotten.
   *
   * `cappedTo` rather than the slice-and-swap this used to spell out by hand:
   * the rule ("the head, with the reader's choice swapped into the last slot")
   * is the same one every capped list in the app follows, and a fourth copy of
   * it is a fourth place for it to go stale.
   */
  const [allCloths, setAllCloths] = createSignal(false);
  const clothList = createMemo<readonly ClothSwatch[]>(() => clothCuration.list());
  const shownCloths = createMemo<readonly ClothSwatch[]>(() =>
    allCloths()
      ? clothList()
      : cappedTo(clothList(), CLOTH_PAGE, (row) => row.pigment === style().pigment),
  );
  /** What the "more" chip is offering. The REMAINING count, never the total. */
  const clothsBehind = (): number => clothList().length - shownCloths().length;
  /* ------------------------------ charm colour ---------------------------- */

  /**
   * The charm's twenty-four colourways, carrying their own index.
   *
   * Paired with the index rather than read back out of a `For`'s position,
   * because the row folds at twenty like every other long list in the app and
   * a folded row's third tile is not colourway three.
   */
  const CHARM_SWATCHES: readonly CharmSwatch[] = CHARM_COLORS.map((hex, index) => ({
    id: String(index),
    index,
    hex,
    name: CHARM_COLOR_LABELS[index] ?? `colour ${index + 1}`,
  }));

  /** The ribbon's colourways, curated exactly like the pigments above. */
  const charmCuration = createCuration<CharmSwatch>(() => ({
    axis: 'charm-colour',
    label: 'charm colours',
    options: CHARM_SWATCHES,
    activeId: typeof style().charmColor === 'number' ? String(style().charmColor) : '',
  }));

  const [allCharms, setAllCharms] = createSignal(false);
  /**
   * Twenty, then the rest behind a count — and never without the current one.
   *
   * A hex of the reader's own is not in the table at all, so there is nothing
   * to swap forward: `cappedTo` is handed a predicate that matches nothing, no
   * named swatch is lit, and the plain head is the honest thing to show.
   */
  const charmList = createMemo<readonly CharmSwatch[]>(() => charmCuration.list());
  const shownCharms = createMemo<readonly CharmSwatch[]>(() =>
    allCharms()
      ? charmList()
      : cappedTo(charmList(), PALETTE_PAGE, (row) => row.index === style().charmColor),
  );
  const charmsBehind = (): number => charmList().length - shownCharms().length;
  /** The reader's own charm colour, when they typed one. */
  const ownCharm = (): string | null =>
    typeof style().charmColor === 'string' ? (style().charmColor as string) : null;
  /**
   * The colour the charm's well opens on — theirs, else the ribbon's actual
   * colour, resolved by the same fold the spine and the cover use.
   */
  const charmNow = (): string => charmColorCss(style().charmColor);

  /** Which swatch the current pigment folds onto. */
  const activeCloth = (): number => clothForPalette(style().pigment);
  /** The reader's own colour, when they entered one. */
  const ownCloth = (): string | null => style().clothHex;
  /** The colour the well opens on: theirs, else the cloth they are wearing. */
  const clothNow = (): string => (CLOTHS[activeCloth()] ?? CLOTHS[0]!)[0];

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
    // `material` is left out on purpose: the dice rolls a BINDING two lines
    // down, and a covering rolled beside it would overrule the very thing it
    // just chose — a "Limp Vellum" in morocco grain.
    const { material: _material, hueJitter: _hue, ...draw } = randomBookStyleOverrides(seed);
    patch({
      ...draw,
      thickness:
        SPINE_THICKNESS_RANGE.min +
        Math.round(Math.random() * (SPINE_THICKNESS_RANGE.max - SPINE_THICKNESS_RANGE.min)),
    } as Partial<BookStyle>);
    unpatch('material');
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
    const { material: _material, ...frozen } = bookStyleToOverrides(fresh.style);
    props.onStyleChange(frozen);
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
    /* `hueJitter` is deliberately absent — the flat palette has no hue
       rotation, so rolling it wrote a field nothing draws. `clothHex` is
       present for the opposite reason: it DOES draw, and it outranks the
       pigment, so a dice that left it in place would roll a colour nobody
       could see. */
    pigment: ['pigment', 'clothHex'],
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
            /* The same word the strip below passes, so the sheet and the strip
               are two views of ONE arranged list. */
            axis="binding"
          />
        )}
      </Show>

      {/*
        One sheet per axis, keyed so switching axes rebuilds it rather than
        re-labelling the one already open.
      */}
      <Show when={axisSheet()} keyed>
        {(axis) => (
          <DesignPicker
            title={
              axis === 'shape' ? 'the shape of it' : axis === 'material' ? 'what it is covered in' : 'the marks on it'
            }
            hint="one axis at a time — the rest of the binding stays as it is."
            options={axisOptions(axis)}
            activeId={ownBindingId(ownParts())}
            scheme={roomScheme()}
            onPick={(id) => {
              const parts = parseOwnBinding(id);
              if (parts === null) return;
              if (axis === 'shape') pickOwn({ shape: parts.shape });
              else if (axis === 'material') pickOwn({ material: parts.material });
              else pickOwn({ decoration: parts.decoration });
            }}
            onBack={() => setAxisSheet(null)}
            cardW={100}
            cardH={150}
            columns={3}
            searchLabel={`Search ${axis === 'decoration' ? 'marks' : axis}s`}
            axis={OWN_AXIS_CURATION[axis]}
          />
        )}
      </Show>

      <Show when={!bindingSheet() && axisSheet() === null}>
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
            ref={setSpineCanvas}
            width={PREVIEW_W}
            height={PREVIEW_H}
            aria-label="Spine preview"
          />
          <canvas
            class="nb-studio-face nb-studio-face-cover"
            ref={setCoverCanvas}
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
          axis="binding"
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

      {/* --------------------------- bind it yourself ---------------------- */}
      {/*
        The same three axes the presets are built from, pickable one at a time.
        Each strip holds the other two still, so a reader can keep the shape
        they like and try every covering against it.
        Each list is the ROLLABLE half of its axis — the odd ones are all still
        there in the preset sheet above, where somebody finds them on purpose
        rather than being handed one.
      */}
      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">
          bind it yourself{' '}
          <em class="nb-panel-row-hint">{SHAPE_LABELS[ownParts().shape].toLowerCase()}</em>
        </h3>
        {/*
          Visible captions, not just the strips' aria-labels: `DesignStrip`
          renders its `label` only to assistive tech, so three stacked strips
          read to the eye as one 24-tile grid with no idea which four tiles
          answer which question.
        */}
        <p class="nb-panel-row-label nb-strip-label font-ui">Spine shape</p>
        <DesignStrip
          label="Spine shape"
          options={axisOptions('shape')}
          activeId={ownBindingId(ownParts())}
          scheme={roomScheme()}
          onPick={(id) => {
            const parts = parseOwnBinding(id);
            if (parts !== null) pickOwn({ shape: parts.shape });
          }}
          onMore={() => setAxisSheet('shape')}
          columns={4}
          limit={7}
          tileW={72}
          tileH={104}
          axis="spine-shape"
        />
        <p class="nb-panel-row-label nb-strip-label font-ui">Covered in</p>
        <DesignStrip
          label="Covering"
          options={axisOptions('material')}
          activeId={ownBindingId(ownParts())}
          scheme={roomScheme()}
          onPick={(id) => {
            const parts = parseOwnBinding(id);
            if (parts !== null) pickOwn({ material: parts.material });
          }}
          onMore={() => setAxisSheet('material')}
          columns={4}
          limit={7}
          tileW={72}
          tileH={104}
          axis="covering"
        />
        <p class="nb-panel-row-label nb-strip-label font-ui">Marks on the spine</p>
        <DesignStrip
          label="Marks"
          options={axisOptions('decoration')}
          activeId={ownBindingId(ownParts())}
          scheme={roomScheme()}
          onPick={(id) => {
            const parts = parseOwnBinding(id);
            if (parts !== null) pickOwn({ decoration: parts.decoration });
          }}
          onMore={() => setAxisSheet('decoration')}
          columns={4}
          limit={7}
          tileW={72}
          tileH={104}
          axis="marks"
        />
        <div class="nb-chip-row" role="group" aria-label="Tooling">
          {/*
            Gilt is its own axis and not a consequence of the other two — the
            preset table has `double-bands` struck in foil on one binding and
            blind on another, so this is a choice, not a derivation.
          */}
          <button
            type="button"
            class="nb-chip"
            aria-pressed={ownParts().gilt}
            classList={{ 'is-active': ownParts().gilt }}
            onClick={() => pickOwn({ gilt: !ownParts().gilt })}
          >
            {ownParts().gilt ? 'struck in gilt' : 'blind tooled'}
          </button>
        </div>
        <p class="nb-panel-footnote">
          {ROLLABLE_SHAPES.length} shapes × {ROLLABLE_MATERIALS.length} coverings ×{' '}
          {ROLLABLE_DECORATIONS.length + 1} marks, either tooling — your own
          binding, kept with the book.
        </p>
      </section>

      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          covering
          <RerollDice section="covering" onClick={() => reroll(REROLL_GROUPS.material)} />
        </h3>
        <div class="nb-chip-row" role="group" aria-label="Binding material">
          <For each={BINDING_MATERIALS}>
            {(m) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={covering() === m}
                onClick={() => patch({ material: m })}
              >
                {MATERIAL_LABELS[m].toLowerCase()}
              </button>
            )}
          </For>
          <Show when={resolved().pinned.has('material')}>
            <button
              type="button"
              class="nb-chip nb-chip-ghost"
              onClick={() => unpatch('material')}
            >
              as bound
            </button>
          </Show>
        </div>
      </section>

      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          pigment
          <em class="nb-panel-row-hint">
            {ownCloth() ?? CLOTH_SWATCHES[style().pigment]?.name ?? ''}
          </em>
          <RerollDice section="pigment" onClick={() => reroll(REROLL_GROUPS.pigment)} />
        </h3>
        <div
          class="nb-swatch-grid"
          role="group"
          aria-label="Spine pigment"
          on:contextmenu={(event) => clothCuration.onListContext(event)}
        >
          <For each={shownCloths()}>
            {(swatch) => {
              const cloth = clothForPalette(swatch.pigment);
              const pair = CLOTHS[cloth] ?? CLOTHS[0]!;
              /* Pressed only while the book is actually wearing it. A colour
                 of the reader's own outranks every pigment, so leaving one of
                 these lit under it would have the row claiming credit for a
                 colour it did not paint. */
              const on = (): boolean => ownCloth() === null && style().pigment === swatch.pigment;
              return (
                <button
                  type="button"
                  class="nb-swatch"
                  /* Two flat halves, not a ramp: the face and the turned board,
                     which is exactly what the spine will show. */
                  style={{ background: `linear-gradient(105deg, ${pair[0]} 62%, ${pair[1]} 62%)` }}
                  aria-label={`${swatch.name}${starWords(clothCuration.starsFor(swatch.id))}`}
                  data-tooltip={swatch.name.toLowerCase()}
                  aria-pressed={on()}
                  classList={{
                    'is-active': on(),
                    'nb-cur-gone': clothCuration.removed(swatch.id),
                  }}
                  /* A named pigment clears the reader's own colour in the same
                     write. Two fields, one intent: without it, pressing a
                     swatch would move a value nothing draws and the row would
                     look broken in exactly the way it used to. */
                  onClick={() => patch({ pigment: swatch.pigment, clothHex: null })}
                  on:contextmenu={(event) => clothCuration.onEntryContext(event, swatch.id)}
                >
                  {/* The wrapper is the star's positioning context — see
                      curation.css. A swatch is a bare coloured box otherwise. */}
                  <span class="nb-mark-wrap">
                    <StarMark stars={clothCuration.starsFor(swatch.id)} />
                  </span>
                </button>
              );
            }}
          </For>
        </div>
        <Show when={allCloths() || clothsBehind() > 0}>
          <div class="nb-chip-row">
            <button
              type="button"
              class="nb-chip nb-chip-ghost font-ui"
              aria-expanded={allCloths()}
              onClick={() => setAllCloths(!allCloths())}
            >
              {allCloths() ? 'fewer' : `${clothsBehind()} more`}
            </button>
          </div>
        </Show>
        <clothCuration.Overlay />
        {/*
          The door out of the table. The fifty above are a vocabulary and a
          vocabulary cannot contain the colour a particular reader already has
          in mind — so this takes any hex, folds it into two faces the way the
          fifty were folded (`palette.clothPair`), and binds the book in it.
        */}
        <OwnColour
          label="Spine cloth"
          value={ownCloth()}
          fallback={ownCloth() ?? clothNow()}
          onPick={(hex) => patch({ clothHex: hex })}
          onClear={() => patch({ clothHex: null })}
          clearLabel="back to the pigment"
        />
        <p class="nb-panel-footnote">
          {/* The count the reader can check by opening the row, not the count
              the vocabulary ships: they may have taken some of these off it. */}
          {clothList().length} cloths and any colour you like — and a book
          keeps its own in every room
        </p>
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
          <div
            class="nb-swatch-grid nb-swatch-grid-charm"
            role="group"
            aria-label="Charm colour"
            on:contextmenu={(event) => charmCuration.onListContext(event)}
          >
            <For each={shownCharms()}>
              {(swatch) => (
                <button
                  type="button"
                  class="nb-swatch"
                  style={{ background: swatch.hex }}
                  aria-label={`${swatch.name}${starWords(charmCuration.starsFor(swatch.id))}`}
                  data-tooltip={swatch.name.toLowerCase()}
                  /* A colour of the reader's own outranks every colourway, so
                     none of these is lit under one — the same rule the cloth
                     row follows, and for the same reason: a swatch left lit
                     would be claiming credit for a colour it did not paint. */
                  aria-pressed={style().charmColor === swatch.index}
                  classList={{
                    'is-active': style().charmColor === swatch.index,
                    'nb-cur-gone': charmCuration.removed(swatch.id),
                  }}
                  onClick={() => patch({ charmColor: swatch.index })}
                  on:contextmenu={(event) => charmCuration.onEntryContext(event, swatch.id)}
                >
                  <span class="nb-mark-wrap">
                    <StarMark stars={charmCuration.starsFor(swatch.id)} />
                  </span>
                </button>
              )}
            </For>
          </div>
          <Show when={allCharms() || charmsBehind() > 0}>
            <div class="nb-chip-row">
              <button
                type="button"
                class="nb-chip nb-chip-ghost font-ui"
                aria-expanded={allCharms()}
                onClick={() => setAllCharms(!allCharms())}
              >
                {allCharms() ? 'fewer' : `${charmsBehind()} more`}
              </button>
            </div>
          </Show>
          <charmCuration.Overlay />
          {/*
            The door out of the charm's own table. A ribbon is the one thing on
            a book a reader is likeliest to want to MATCH — to a cover, to a
            room, to another book — and twenty-four names cannot contain that.
            The hex goes straight into `charmColor`; `charms.charmColorCss`
            lifts it onto CHARM_FLOOR so the one ink outline still has an edge
            to be, and the cover's bake key carries it verbatim.
          */}
          <OwnColour
            label="Charm colour"
            value={ownCharm()}
            fallback={ownCharm() ?? charmNow()}
            onPick={(hex) => patch({ charmColor: hex })}
            /* Drops the PIN, not just the hex — the charm goes back to the
               colour the seed and the room chose for it. There is no named
               colourway to fall back to the way `clothHex` falls back to a
               pigment: this field holds one value, and an index the reader
               pressed earlier is not a second opinion the model kept. */
            onClear={() => unpatch('charmColor')}
            clearLabel="back to the rolled colour"
          />
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
      data-tooltip={`Reroll ${props.section}`}
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
