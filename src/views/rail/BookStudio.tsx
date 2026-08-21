/**
 * src/views/rail/BookStudio.tsx — the studio's "This book" tab.
 *
 * Every knob from docs/design/library-themes.md §4: binding material,
 * pigment + hue jitter, raised bands, endbands, ornament stamp, title plate
 * and face, wear, edge treatment, format/height/thickness, and the cover's
 * continuous frame. On top of
 * those sits the BINDING — the quality-safe bound books of `art/bookDesign.ts`,
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
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  ACTIVE_COVER_HANDS,
  ACTIVE_EDGE_TREATMENTS,
  ACTIVE_HEAD_TAIL_OPTIONS,
  ACTIVE_ORNAMENTS,
  ACTIVE_TITLE_PLATES,
  BINDING_MATERIALS,
  EDGE_LABELS,
  MATERIAL_LABELS,
  MAX_RAISED_BANDS,
  ORNAMENT_NONE,
  SPINE_FORMATS,
  SPINE_FORMAT_IDS,
  SPINE_HEIGHT_RANGE,
  SPINE_THICKNESS_RANGE,
  PIGMENT_LABELS,
  TITLE_PLATE_LABELS,
  WEAR_STOPS,
  formatForHeight,
  heightForFormat,
  normalizeBookStyleOverrides,
  randomBookStyleOverrides,
  resolveBookStyle,
  type BookStyle,
  type BookStyleOverrides,
} from '../../art/bookStyle';
import { CLOTHS } from '../../art/flat';
import {
  BOOK_PRESETS,
  BOOK_SURPRISE_DIRECTIONS,
  MATERIALS,
  ROLLABLE_DECORATIONS,
  ROLLABLE_MATERIALS,
  ROLLABLE_SHAPES,
  SHAPE_LABELS,
  bindingMaterialFor,
  bookPresetHasAuthoredFocal,
  bookDesignTag,
  bookPreset,
  materialLookFor,
  ownBindingId,
  parseOwnBinding,
  presetForSeed,
  resolveBookDesign,
  type BookDesign,
  type BookPresetId,
  type BookSurpriseDirectionId,
  type MaterialLook,
  type OwnBinding,
} from '../../art/bookDesign';
import {
  BOOK_SURPRISE_LOCK_DEFINITIONS,
  BOOK_SURPRISE_LOCK_IDS,
  normalizeBookSurpriseLocks,
  resolveBookSurpriseColourProjection,
  surpriseBookRecipe,
  type BookSurpriseLockId,
  type BookSurpriseLockSet,
  type BookSurprisePalette,
} from '../../art/bookSurprise';
import { ACTIVE_COVER_FRAMES, COVER_ASPECT, renderCoverInto } from '../../art/covers';
import { flatSpineFor } from '../../art/flatShelf';
import type { FlatScheme } from '../../art/flat';
import {
  coverOverridesFromStyle as resolvedCoverOverrides,
  themeSpineDefaults,
} from '../../features/bookshelf/bookIdentity';
import {
  normalizeBookSurpriseHistory,
  popBookSurpriseHistory,
  pushBookSurpriseHistory,
  type BookSurpriseHistoryEntry,
} from '../../features/bookshelf/bookStudioPrefs';
import type { CoverOverrides } from '../../art/covers';
import {
  PIGMENT_CLOTH_NAMES,
  clothForPalette,
  renderSpine,
  type Ctx2D,
} from '../../art/spines';
import { PALETTE_PAGE } from '../../art/customColour';
import { getTheme } from '../../art/themes';
import { libraryPrefs, resolveLibrary } from '../../features/bookshelf/libraryPrefs';
import DesignPicker, { type PickerOption } from './DesignPicker';
import DesignStrip, {
  CuratedChips,
  StarMark,
  cappedTo,
  createCuration,
  starWords,
} from './DesignStrip';
import { DesignCanvas } from './designArt';
import { ColourClipboardActions } from './OwnColour';
import {
  bindingOptions,
  drawBindingCard,
  ownAxisOptions,
  type BindingCardOptions,
} from './designOptions';
import {
  activeRoomDesign,
  bookBinding,
  loadDesignPrefs,
  shelfDesignOf,
} from '../../data/designPrefs';
import { shelfHeadroom, type ShelfHeadroom } from '../../features/bookshelf/bookFit';
import {
  hiddenIds,
  isHidden,
  rollPool,
  type CurationAxis,
} from '../../data/shelfOfMine';
import { stopShelfKeys } from './shelfKeys';
import {
  bookPreviewGeometry,
  previewRectStyle,
  type BookStudioControlTarget,
} from './bookStudioPreview';
import {
  reconcileBookStudioSectionRoll,
  styleAfterBindingChange,
} from './bookStudioComposition';
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

/** Long chip vocabularies show a useful first folio, then open on request. */
const COVER_CHIP_PAGE = 12;

/** A compact colour role: one well, one meaning, and an explicit way home. */
interface ColourRoleProps {
  label: string;
  hint: string;
  target: BookStudioControlTarget;
  lock?: JSX.Element;
  /** Persisted source, used only for pin/reset state. */
  value: string | null;
  /** Representative flat fill the painter actually shows. */
  visible: string;
  onPick(hex: string): void;
  onClear(): void;
}

function ColourRole(props: ColourRoleProps): JSX.Element {
  return (
    <div
      class="nb-book-colour-role"
      classList={{ 'is-pinned': props.value !== null }}
      data-book-control={props.target}
      tabIndex={-1}
    >
      <label class="nb-book-colour-role-main">
        <input
          type="color"
          class="nb-book-colour-role-well"
          value={props.visible}
          aria-label={`${props.label}: pick a colour; currently ${props.visible}`}
          onChange={(event) => props.onPick(event.currentTarget.value)}
        />
        <span>
          <strong class="font-ui">{props.label}</strong>
          <small class="font-ui">{props.hint}</small>
        </span>
      </label>
      <span class="nb-book-colour-role-value font-ui">
        {props.value === null
          ? `inherits · ${props.visible.toUpperCase()}`
          : props.visible.toUpperCase()}
      </span>
      <ColourClipboardActions
        label={props.label}
        value={props.visible}
        onPaste={props.onPick}
        compact
      />
      <Show when={props.value !== null}>
        <button
          type="button"
          class="nb-book-colour-role-reset font-ui"
          aria-label={`${props.label}: inherit the book's colour`}
          onClick={() => props.onClear()}
        >
          reset
        </button>
      </Show>
      {props.lock}
    </div>
  );
}

interface SurpriseLockButtonProps {
  id: BookSurpriseLockId;
  label: string;
  locked: boolean;
  /** A whole-binding lock makes its four component locks redundant. */
  covered?: boolean;
  onToggle(): void;
}

/**
 * One explicit promise to Surprise Me: closed means "keep this", open means
 * "you may change this". It stays a real pressed button (not a decorative
 * padlock glyph), so keyboard, touch, and assistive technology all get the
 * same operation and state.
 */
function SurpriseLockButton(props: SurpriseLockButtonProps): JSX.Element {
  const effective = (): boolean => props.locked || props.covered === true;
  const action = (): string =>
    props.covered === true
      ? `${props.label} is kept by the whole binding lock`
      : effective()
        ? `Let Surprise Me change ${props.label}`
        : `Keep ${props.label} when using Surprise Me`;

  return (
    <button
      type="button"
      class="nb-surprise-lock"
      classList={{ 'is-locked': effective(), 'is-covered': props.covered === true }}
      data-surprise-lock={props.id}
      aria-label={action()}
      aria-pressed={effective()}
      disabled={props.covered === true}
      data-tooltip={action().toLowerCase()}
      onClick={(event) => {
        // A lock is usually nested in a label row. Do not let its click also
        // activate that row's range/colour input.
        event.preventDefault();
        event.stopPropagation();
        props.onToggle();
      }}
    >
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <path
          class="nb-surprise-lock-body"
          d="M7.2 12.5 L21.2 12.2 L21.5 23.0 L6.8 23.4 Z"
        />
        <Show
          when={effective()}
          fallback={<path d="M10.1 12.4 L10.0 9.4 C9.9 5.8 12.0 3.6 15.1 3.7 C18.1 3.8 19.7 5.9 19.6 8.3" />}
        >
          <path d="M9.8 12.4 L9.8 8.9 C9.7 5.7 11.7 3.6 14.3 3.6 C17.2 3.6 19.0 5.7 19.0 8.8 L19.0 12.3" />
        </Show>
        <path d="M14.1 16.2 L14.2 19.7" />
      </svg>
    </button>
  );
}

/* -------------------------- the curated chip rows ------------------------- */

/** One chip, and what pressing it writes into the style. */
interface StyleChip {
  readonly id: string;
  readonly name: string;
  readonly chipClass?: string;
  readonly sets: Partial<BookStyleOverrides>;
}

/** The lists in this panel the reader can prune, star and get back. */
type StyleRowAxis = Extract<
  CurationAxis,
  | 'binding-material'
  | 'ornament'
  | 'title-plate'
  | 'lettering'
  | 'edge'
  | 'format'
  | 'cover-frame'
  | 'spine-cloth'
>;

/**
 * One curated list: the word the store keys it by, its entries, and the way
 * back from a style to the entry it is wearing.
 *
 * That last one is what makes the DICE honour a removal, and it is the half
 * that is easy to miss. `randomBookStyleOverrides` draws every knob at once
 * out of the full legal domain and knows nothing about the reader; `idOf`
 * turns a draw back into an entry id, so `respectingCuration` can ask the
 * store whether that entry is still on the list and re-draw from the pool when
 * it is not. Without it a removal means "gone from the row" and nothing more —
 * you throw a stamp away, reroll its section, and the app puts it back on the
 * book, which reads as the app ignoring you rather than as two features that
 * were never introduced.
 */
interface CuratedRow {
  readonly axis: StyleRowAxis;
  readonly chips: readonly StyleChip[];
  /** '' when the style landed outside this row — see the cover note above. */
  idOf(style: BookStyleOverrides): string;
}

const CURATED_ROWS: Readonly<Record<StyleRowAxis, CuratedRow>> = {
  'binding-material': {
    axis: 'binding-material',
    chips: BINDING_MATERIALS.map((m) => ({
      id: m,
      name: MATERIAL_LABELS[m].toLowerCase(),
      sets: { material: m },
    })),
    idOf: (s) => (typeof s.material === 'string' ? s.material : ''),
  },
  ornament: {
    axis: 'ornament',
    chips: [
      {
        id: String(ORNAMENT_NONE),
        name: 'none',
        chipClass: 'nb-chip-ghost',
        sets: { ornament: ORNAMENT_NONE, coverMedallion: ORNAMENT_NONE },
      },
      ...ACTIVE_ORNAMENTS.map(({ label, index }) => ({
        id: String(index),
        name: label.toLowerCase(),
        sets: { ornament: index, coverMedallion: index },
      })),
    ],
    idOf: (s) => (typeof s.ornament === 'number' ? String(s.ornament) : ''),
  },
  'title-plate': {
    axis: 'title-plate',
    chips: ACTIVE_TITLE_PLATES.map((p) => ({
      id: p,
      name: TITLE_PLATE_LABELS[p].toLowerCase(),
      sets: { titlePlate: p },
    })),
    idOf: (s) => (typeof s.titlePlate === 'string' ? s.titlePlate : ''),
  },
  lettering: {
    axis: 'lettering',
    chips: ACTIVE_COVER_HANDS.map(({ label, index }) => ({
      id: String(index),
      name: label,
      sets: { titleFont: index },
    })),
    idOf: (s) => (typeof s.titleFont === 'number' ? String(s.titleFont) : ''),
  },
  edge: {
    axis: 'edge',
    chips: ACTIVE_EDGE_TREATMENTS.map((e) => ({
      id: e,
      name: EDGE_LABELS[e].toLowerCase(),
      sets: { edge: e },
    })),
    idOf: (s) => (typeof s.edge === 'string' ? s.edge : ''),
  },
  format: {
    axis: 'format',
    // A format IS a height — `resolveBookStyle` derives one from the other —
    // so the chip writes both and the dice, which only ever draws a height,
    // is read back through `formatForHeight`.
    chips: SPINE_FORMAT_IDS.map((f) => ({
      id: f,
      name: String(SPINE_FORMATS[f]?.label ?? f).toLowerCase(),
      sets: { format: f, height: heightForFormat(f) },
    })),
    idOf: (s) => (typeof s.height === 'number' ? formatForHeight(s.height) : ''),
  },
  'cover-frame': {
    axis: 'cover-frame',
    chips: ACTIVE_COVER_FRAMES.map(({ label, index }) => ({
      id: String(index),
      name: label.toLowerCase(),
      sets: { coverFrame: index },
    })),
    idOf: (s) => (typeof s.coverFrame === 'number' ? String(s.coverFrame) : ''),
  },
  /* The cloth colour grid drives its own curation controller. */
  'spine-cloth': {
    axis: 'spine-cloth',
    chips: CLOTH_SWATCHES.map((swatch) => ({
      id: swatch.id,
      name: swatch.name,
      // A named pigment clears the reader's own colour in the same write, the
      // same as pressing the swatch does — a re-roll that left `clothHex` in
      // place would move a value nothing draws.
      sets: { pigment: swatch.pigment, clothHex: null },
    })),
    idOf: (s) => (typeof s.pigment === 'number' ? String(s.pigment) : ''),
  },
};

const CURATED_ROW_LIST: readonly CuratedRow[] = Object.values(CURATED_ROWS);

const QUIET_SURFACE_FRAMES: ReadonlySet<number> = new Set([0, 2, 24, 28]);
const QUIET_SURFACE_TITLES: ReadonlySet<string> = new Set([
  'none',
  'debossed',
  'blind-lettered',
  'gilt-direct',
  'twin-rules',
]);

interface SurfaceCompositionContext {
  readonly material: MaterialLook;
  readonly binding: BookPresetId | null | undefined;
}

function materialOwnsSurface(material: MaterialLook): boolean {
  const spec = MATERIALS[material];
  return spec.split !== 'none' || (spec.grain !== 'none' && spec.grainCount > 3);
}

/**
 * Final composition guard shared by manual chips and local section dice.
 * A figured covering or binding-authored centrepiece has already spent the
 * book's focal budget; it cannot accumulate a second emblem. Figured fields
 * also keep only quiet direct lettering and one structural fillet.
 */
function reconcileActiveSurfaceComposition(
  draw: BookStyleOverrides,
  context: SurfaceCompositionContext,
): BookStyleOverrides {
  const out = { ...(normalizeBookStyleOverrides(draw) ?? {}) };
  const surfaceLed = materialOwnsSurface(context.material);
  const authoredFocal = bookPresetHasAuthoredFocal(context.binding);

  if (surfaceLed || authoredFocal) {
    if (out.ornament !== undefined || out.coverMedallion !== undefined) {
      out.ornament = ORNAMENT_NONE;
      out.coverMedallion = ORNAMENT_NONE;
    }
  }
  if (surfaceLed) {
    if (out.coverFrame !== undefined && !QUIET_SURFACE_FRAMES.has(out.coverFrame)) {
      out.coverFrame = 2;
    }
    if (out.titlePlate !== undefined && !QUIET_SURFACE_TITLES.has(out.titlePlate)) {
      out.titlePlate = out.gilt === true ? 'gilt-direct' : 'blind-lettered';
    }
  }
  if (out.cornerProtectors !== undefined) out.cornerProtectors = false;
  if (out.insetPlate !== undefined) out.insetPlate = false;
  return out;
}

/**
 * A rolled style, with the reader's removals applied.
 *
 * `rollPool` is the store's own word for "what the dice may land on", and it
 * falls back to the whole vocabulary when a reader has removed all of it —
 * which is why this can re-draw without ever handing back nothing.
 *
 * Stars are deliberately not weighted in, for the reason `rollPool` states: a
 * reader who asked to be surprised did not ask to be surprised by the six
 * things they already told the app they like.
 */
function respectingCuration(
  draw: BookStyleOverrides,
  composition?: SurfaceCompositionContext,
): BookStyleOverrides {
  let out = draw;
  for (const row of CURATED_ROW_LIST) {
    const landed = row.idOf(out);
    if (landed === '' || !isHidden(row.axis, landed)) continue;
    const pool = rollPool(row.axis, row.chips, (chip) => chip.id);
    const chip = pool[Math.floor(Math.random() * pool.length)];
    if (chip === undefined || chip.id === landed) continue;
    out = { ...out, ...chip.sets };
  }
  return composition ? reconcileActiveSurfaceComposition(out, composition) : out;
}

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
export function coverOverridesFromStyle(
  over: BookStyleOverrides,
  binding?: BookPresetId | null,
  seed?: number,
): CoverOverrides {
  // Projected through `bookIdentity`'s mapping rather than a second copy of it:
  // the studio must not grow its own opinion about which cover field a spine
  // field feeds. Only the FILTER belongs here.
  const full = resolvedCoverOverrides(over as BookStyle, {
    binding,
    materialPinned: Object.prototype.hasOwnProperty.call(over, 'material'),
    seed,
    titlePlatePinned: Object.prototype.hasOwnProperty.call(over, 'titlePlate'),
  }) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(full)) {
    // `null` survives on purpose — on `clothHex` it is a value ("I cleared my
    // own colour"), and dropping it would make the clear a no-op.
    if (full[key] !== undefined) out[key] = full[key];
  }
  // `texture` is DERIVED from `material` rather than copied across, so it comes
  // out of that mapping with a real number even when the reader has pinned no
  // covering at all. It is the one key the filter cannot see is unset.
  if (over.material === undefined && binding === undefined) delete out.texture;
  return out as CoverOverrides;
}

export interface BookStudioProps {
  spineSeed: number;
  title: string;
  /** Persisted `cover_meta.style` blob (loose JSON; normalized on read). */
  style: Record<string, unknown> | null;
  onStyleChange(
    next: BookStyleOverrides | null,
    projectionBinding?: BookPresetId | null,
    /** True only when projectionBinding is the reader's stored binding. */
    bindingPinned?: boolean,
  ): void;
  /** Persist a binding and its matching style through one ordered parent lane. */
  onAppearanceChange?(
    next: BookStyleOverrides | null,
    binding: BookPresetId | null,
    projectionBinding: BookPresetId,
  ): void;
  pageCount?: number;
  /**
   * The book's row id, for the binding store.
   *
   * The app's two Studio hosts pass the database id. It remains optional for
   * isolated specimen/test surfaces; those can preview from the art seed but
   * deliberately cannot persist a binding under a pretend book key.
   */
  bookId?: string;
  /**
   * Whether the rail sheet that owns this studio is on screen.
   *
   * RailPanel deliberately keeps its contents mounted after the first open so
   * scroll position survives a close. The preview lives outside that scroller,
   * in a companion panel, so it needs the real visibility bit rather than the
   * component's mounted state or it would stay behind after the sheet left.
   */
  open?: boolean;
  /** The shelf sheet starts at the window edge; the in-book sheet starts after its icon rail. */
  host?: 'book' | 'shelf';
  /**
   * Per-book promises to the whole-book Surprise action. JSON-safe because the
   * parent stores them under `cover_meta.studio`, beside (not inside) style.
   */
  surpriseLocks?: BookSurpriseLockSet;
  onSurpriseLocksChange?(next: BookSurpriseLockSet): void;
  /** Previous whole-book Surprise appearances, newest last. */
  surpriseHistory?: readonly BookSurpriseHistoryEntry[];
  onSurpriseHistoryChange?(next: readonly BookSurpriseHistoryEntry[]): void;
}

export default function BookStudio(props: BookStudioProps): JSX.Element {
  const [face, setFace] = createSignal<'spine' | 'cover'>('spine');
  const [surpriseDirection, setSurpriseDirection] = createSignal<BookSurpriseDirectionId | null>(null);
  const [bindingSheet, setBindingSheet] = createSignal(false);
  /** Which single axis has its long sheet open, or null. */
  const [axisSheet, setAxisSheet] = createSignal<'shape' | 'material' | 'decoration' | null>(null);
  // Signals rather than plain `let`s: opening the binding sheet unmounts the
  // stage and remounting it hands back NEW canvases. With a bare ref the draw
  // effect kept painting the detached ones and the reader came back to two
  // blank rectangles.
  const [dockSpineCanvas, setDockSpineCanvas] = createSignal<HTMLCanvasElement | undefined>();
  const [dockCoverCanvas, setDockCoverCanvas] = createSignal<HTMLCanvasElement | undefined>();
  const [inlineSpineCanvas, setInlineSpineCanvas] = createSignal<HTMLCanvasElement | undefined>();
  const [inlineCoverCanvas, setInlineCoverCanvas] = createSignal<HTMLCanvasElement | undefined>();
  /** Binding shown immediately while the ordered persistence lane catches up. */
  const [pendingBinding, setPendingBinding] = createSignal<
    BookPresetId | null | undefined
  >(undefined);
  const [sessionLocks, setSessionLocks] = createSignal<BookSurpriseLockSet>(
    normalizeBookSurpriseLocks(props.surpriseLocks),
  );
  const [sessionHistory, setSessionHistory] = createSignal<readonly BookSurpriseHistoryEntry[]>(
    normalizeBookSurpriseHistory(props.surpriseHistory),
  );
  let studioRoot: HTMLDivElement | undefined;
  let highlightedControl: HTMLElement | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let revealFrame: number | undefined;
  let revealRetryFrame: number | undefined;

  /** Revoke any older preview click before a newer target is considered. */
  const cancelPendingControlReveal = (): void => {
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
    if (revealRetryFrame !== undefined) cancelAnimationFrame(revealRetryFrame);
    revealFrame = undefined;
    revealRetryFrame = undefined;
  };

  /**
   * Carry a click on the rendered book into the long control sheet.
   *
   * The companion preview lives in a Portal, so DOM ancestry cannot find the
   * sheet. The component ref is the authority instead: it also keeps two open
   * Studio specimens from stealing one another's focus. A target inside a
   * collapsed workshop is opened before it is measured, and focus follows the
   * scroll so keyboard/screen-reader users arrive at the same place as pointer
   * users. The transient wash is presentation only; the focus move is the
   * durable state.
   */
  const revealControl = (target: BookStudioControlTarget): void => {
    // A picker-return click waits two frames for the main sheet to remount. A
    // second click made during those frames is newer authority and must cancel
    // the queued target before it can steal focus/highlight back.
    cancelPendingControlReveal();
    const control = studioRoot?.querySelector<HTMLElement>(`[data-book-control="${target}"]`);
    if (control === undefined || control === null) {
      /*
       * The docked preview deliberately stays available while a long binding
       * picker replaces the normal sheet. A click on the still-visible book
       * must therefore come home from that picker before it can reveal the
       * requested control. Solid remounts the sheet synchronously, while two
       * animation frames give layout/focus geometry a stable turn before the
       * existing reveal path measures it.
       */
      if (bindingSheet() || axisSheet() !== null) {
        setBindingSheet(false);
        setAxisSheet(null);
        revealFrame = requestAnimationFrame(() => {
          revealFrame = undefined;
          revealRetryFrame = requestAnimationFrame(() => {
            revealRetryFrame = undefined;
            revealControl(target);
          });
        });
      }
      return;
    }

    const disclosure = control.closest<HTMLDetailsElement>('details');
    if (disclosure !== null && !disclosure.open) disclosure.open = true;

    if (highlightTimer !== undefined) clearTimeout(highlightTimer);
    highlightedControl?.classList.remove('is-preview-target');
    highlightedControl = control;

    // Restart the ink-wash animation when the same part is chosen twice.
    control.classList.remove('is-preview-target');
    void control.offsetWidth;
    control.classList.add('is-preview-target');
    const narrowPreview = window.matchMedia('(max-width: 700px)').matches;
    control.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: narrowPreview ? 'start' : 'center',
      inline: 'nearest',
    });
    requestAnimationFrame(() => control.focus({ preventScroll: true }));

    highlightTimer = setTimeout(() => {
      if (highlightedControl === control) highlightedControl = undefined;
      control.classList.remove('is-preview-target');
    }, 2_450);
  };

  onCleanup(() => {
    if (highlightTimer !== undefined) clearTimeout(highlightTimer);
    cancelPendingControlReveal();
    highlightedControl?.classList.remove('is-preview-target');
  });

  /*
   * The host is controlled and persists under `cover_meta.studio`; an isolated
   * specimen has no host, so the same component remains fully usable with a
   * session-only signal. Optimistic reflection matters here: a reader can tap
   * several adjacent locks more quickly than an SQLite write can round-trip,
   * and no tap may rebuild from an older prop array.
   */
  createEffect(
    on(
      () => props.surpriseLocks,
      (incoming) => {
        if (incoming !== undefined) setSessionLocks(normalizeBookSurpriseLocks(incoming));
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => props.surpriseHistory,
      (incoming) => {
        if (incoming !== undefined) setSessionHistory(normalizeBookSurpriseHistory(incoming));
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => props.bookId,
      () => {
        setSessionLocks(normalizeBookSurpriseLocks(props.surpriseLocks));
        setSessionHistory(normalizeBookSurpriseHistory(props.surpriseHistory));
      },
      { defer: true },
    ),
  );

  const surpriseLocks = (): BookSurpriseLockSet => sessionLocks();
  const lockSet = createMemo<ReadonlySet<BookSurpriseLockId>>(
    () => new Set(surpriseLocks()),
  );
  const lockIsExplicit = (id: BookSurpriseLockId): boolean => lockSet().has(id);
  const lockIsCovered = (id: BookSurpriseLockId): boolean =>
    id.startsWith('binding.') && id !== 'binding' && lockSet().has('binding');
  const setLocks = (next: BookSurpriseLockSet): void => {
    const normalized = normalizeBookSurpriseLocks(next);
    setSessionLocks(normalized);
    props.onSurpriseLocksChange?.(normalized);
  };
  const toggleLock = (id: BookSurpriseLockId): void => {
    const next = new Set(surpriseLocks());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLocks([...next] as BookSurpriseLockSet);
  };
  const unlockAll = (): void => setLocks([]);
  const surpriseHistory = (): readonly BookSurpriseHistoryEntry[] => sessionHistory();
  const setHistory = (next: readonly BookSurpriseHistoryEntry[]): void => {
    const normalized = normalizeBookSurpriseHistory(next);
    setSessionHistory(normalized);
    props.onSurpriseHistoryChange?.(normalized);
  };

  const Lock = (lockProps: { id: BookSurpriseLockId; label?: string }): JSX.Element => (
    <SurpriseLockButton
      id={lockProps.id}
      label={lockProps.label ?? BOOK_SURPRISE_LOCK_DEFINITIONS[lockProps.id].label.toLowerCase()}
      locked={lockIsExplicit(lockProps.id)}
      covered={lockIsCovered(lockProps.id)}
      onToggle={() => toggleLock(lockProps.id)}
    />
  );

  onMount(() => {
    void loadDesignPrefs();
  });

  /* The binding participates in both faces of the live preview, so resolve it
     before resolving the style. A cover now receives the preset's exact
     MaterialLook (unless the reader explicitly pinned the coarse material
     override), matching the shelf spine instead of merely sharing its colour. */
  const bindingKey = (): string => props.bookId ?? `seed:${props.spineSeed >>> 0}`;
  const storedBinding = (): BookPresetId | null => bookBinding(bindingKey());
  /** The pinned binding, or null while the book's seed is still choosing. */
  const pinned = (): BookPresetId | null => {
    const pending = pendingBinding();
    return pending === undefined ? storedBinding() : pending;
  };
  /** What the seed would pick on its own — the "follow the seed" answer. */
  const seedBinding = (): BookPresetId => presetForSeed(props.spineSeed).id;

  createEffect(
    on(
      bindingKey,
      () => setPendingBinding(undefined),
      { defer: true },
    ),
  );

  // Hand authority back to the shared store once the optimistic value lands.
  // Until then the preview never flashes the previous binding between a click
  // and the first awaited database operation.
  createEffect(() => {
    const pending = pendingBinding();
    if (pending !== undefined && storedBinding() === pending) {
      setPendingBinding(undefined);
    }
  });

  const resolved = createMemo(() =>
    resolveBookStyle(props.spineSeed, themeSpineDefaults(getTheme(libraryPrefs.theme)), props.style, {
      pageCount: props.pageCount,
      binding: pinned() ?? seedBinding(),
    }),
  );
  const style = (): BookStyle => resolved().style;

  /** Canvas-aligned interaction regions shared by the dock and sticky copy. */
  const previewGeometry = createMemo(() => {
    return bookPreviewGeometry({
      canvasWidth: PREVIEW_W,
      canvasHeight: PREVIEW_H,
      stageScale: STAGE_SCALE,
      baseline: PREVIEW_H - STAGE_PAD_BOTTOM,
      height: style().height,
      thickness: style().thickness,
      coverAspect: COVER_ASPECT,
      raisedBands: style().raisedBands,
      headTail: style().headTail,
      ornament: style().ornament,
      // Geometry follows the same effective plate the cover painter receives.
      // `style().titlePlate` is deliberately allowed to stay at the latent
      // `none` sentinel when an inherited binding (Library Buckram, for
      // example) authors a label plate. Using that latent value here moved the
      // clickable title outline away from the label actually on the canvas.
      coverTitlePlate: resolved().cover.titlePlate,
      coverFrame: style().coverFrame,
      coverMedallion: style().coverMedallion,
    });
  });

  /* ------------------------------- binding ------------------------------- */

  /**
   * The ground every card in this panel is painted in — the reader's dedicated
   * spine colour first, their legacy whole-book cloth next, then the fold of
   * their pigment.
   *
   * Exactly what `renderSpine` does with the same colour roles, spelled once
   * here and read by all three consumers (the big binding preview, the preset
   * strip, the three axis strips). Spelled per consumer it drifted: the
   * bindings and the axes each did their own `clothForPalette` and a custom
   * colour reached the preview at the top of the sheet and none of the tiles
   * under it, so the studio disagreed with itself in one glance.
   */
  const cardCloth = (): number | string =>
    resolved().spine.spineBaseHex ??
    resolved().spine.clothHex ??
    clothForPalette(resolved().spine.palette);

  /**
   * Every book-owned role shared by the binding stage, its preset cards and
   * the three component sheets. Keeping one projection is what makes a colour
   * picked above remain the same book while the reader shops below.
   */
  const cardOptions = (): BindingCardOptions => ({
    seed: props.spineSeed,
    cloth: cardCloth(),
    // A dedicated spine-face choice tints even naturally pale coverings. The
    // shared whole-book cloth beneath it must not dye vellum by accident.
    baseColourPinned: typeof resolved().spine.spineBaseHex === 'string',
    accent: resolved().spine.spineAccentHex ?? undefined,
    tooling: resolved().spine.toolingHex ?? null,
    emblem: resolved().spine.emblemHex ?? null,
    hardware: null,
    gilt: style().gilt,
    focusAt: flatSpineFor(props.spineSeed).labelAt,
  });

  /**
   * The design the shelf will draw. Built from the book's OWN cloth and gilt
   * rather than from the room, because a book keeps its colours wherever it
   * stands; only the ground behind the preview follows the room.
   */
  const design = createMemo<BookDesign>(() =>
    resolveBookDesign({
      ...cardOptions(),
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

  const currentSurfaceContext = (): SurfaceCompositionContext => ({
    material: design().material,
    binding: pinned() ?? seedBinding(),
  });
  const emblemUnavailable = (): boolean =>
    materialOwnsSurface(design().material) ||
    bookPresetHasAuthoredFocal(pinned() ?? seedBinding());
  const emblemUnavailableReason = (): string =>
    bookPresetHasAuthoredFocal(pinned() ?? seedBinding())
      ? 'this binding already carries its own focal tooling'
      : 'this figured covering is the book’s focal design';

  /** The shelf the binding cards stand on — the room's timber and recess. */
  const roomScheme = (): FlatScheme => resolveLibrary(libraryPrefs).scheme;

  const bindings = createMemo(() => bindingOptions(cardOptions()));

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
      cardOptions(),
      ownParts(),
      axis,
    );

  /**
   * Apply a binding and its matching style as one optimistic UI decision.
   * The parent owns the ordered persistence lane. A standalone/test surface
   * without a database book id still reflects the complete style locally.
   */
  const applyAppearance = (
    next: BookStyleOverrides | null,
    binding: BookPresetId | null,
    effectiveBinding: BookPresetId,
  ): void => {
    const reconciled =
      next === null
        ? null
        : reconcileActiveSurfaceComposition(next, {
            material:
              next.material !== undefined
                ? materialLookFor(next.material)
                : bookPreset(effectiveBinding).material,
            binding: effectiveBinding,
          });
    setPendingBinding(binding);
    if (props.onAppearanceChange !== undefined && props.bookId !== undefined) {
      props.onAppearanceChange(reconciled, binding, effectiveBinding);
      return;
    }
    props.onStyleChange(reconciled, effectiveBinding, binding !== null);
  };

  /** A complete binding owns its covering, construction and furniture. */
  const styleWithoutPriorBinding = (): BookStyleOverrides | null =>
    styleAfterBindingChange(normalizeBookStyleOverrides(props.style));

  /** Compose and pin, keeping the three axes the reader did not touch. */
  const pickOwn = (patch: Partial<OwnBinding>): void => {
    const binding = ownBindingId({ ...ownParts(), ...patch });
    applyAppearance(styleWithoutPriorBinding(), binding, binding);
  };

  const pickBinding = (id: BookPresetId): void => {
    // A binding brings its own covering. Hand it back the say: otherwise
    // picking "Antique Vellum" over a book whose cloth chip had been touched
    // draws a morocco-grained "vellum", which is the studio disagreeing with
    // itself in the same glance.
    applyAppearance(styleWithoutPriorBinding(), id, id);
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
    const draft = { ...current, ...partial };
    const material =
      draft.material !== undefined ? materialLookFor(draft.material) : design().material;
    props.onStyleChange(
      reconcileActiveSurfaceComposition(draft, {
        ...currentSurfaceContext(),
        material,
      }),
      pinned() ?? seedBinding(),
      pinned() !== null,
    );
  };

  /** Drop fields back to "whatever the seed and the room say". */
  const unpatch = (...keys: readonly (keyof BookStyle)[]): void => {
    const current = { ...(normalizeBookStyleOverrides(props.style) ?? {}) };
    for (const key of keys) delete current[key];
    props.onStyleChange(
      Object.keys(current).length > 0 ? current : null,
      pinned() ?? seedBinding(),
      pinned() !== null,
    );
  };

  /* ------------------------- does it fit the case? ----------------------- */

  /**
   * What the open bookcase's carpentry leaves for a book to stand in.
   *
   * A height is a request the case can refuse: an arcade, a gable, a plate
   * rail or a run of spindles hangs into the top of every bay, and the shelf
   * trims a book that will not clear it (`features/bookshelf/bookFit.ts`).
   * That has to be SAID, next to the control that caused it — a book quietly
   * drawn shorter than the number printed above the chips is the panel lying.
   *
   * `min` and not the height at some particular x: the shelf lays its own rows
   * out and no book owns a position, so the only promise that survives a
   * re-layout is the one that holds everywhere in the bay. Under an arcade the
   * book may well come out taller than this, which is why the copy says "at
   * least" — a pleasant surprise is allowed, a broken promise is not.
   */
  const headroom = (): ShelfHeadroom => shelfHeadroom(shelfDesignOf(activeRoomDesign()));

  /**
   * True when the height printed at the top of this section is one the case
   * cannot give.
   *
   * Deliberately not gated on the reader having TYPED it. The heading says
   * "290px tall" whatever put the number there — `createBook` dresses every
   * new book out of the format bands — and a panel that prints 290 next to a
   * shelf drawing 144 is a panel telling a lie it could have caught.
   */
  const overTall = (): boolean => style().height > headroom().min + 0.5;

  /** Their answer to that: keep the height and stand through the carpentry. */
  const overlapping = (): boolean => style().overlap === true;

  /* --------------------------- live preview art -------------------------- */

  createEffect(
    on(
      () => [
        resolved(),
        pinned(),
        props.title,
        face(),
        dockSpineCanvas(),
        dockCoverCanvas(),
        inlineSpineCanvas(),
        inlineCoverCanvas(),
      ] as const,
      () => {
        const r = resolved();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        // ONE scale, ONE baseline, for both faces. Everything below is in
        // preview px; the canvases are backing-store sized on top of that.
        const scale = STAGE_SCALE;
        const bookH = r.style.height * scale;
        const baseline = PREVIEW_H - STAGE_PAD_BOTTOM;

        const paintCover = (cover: HTMLCanvasElement | undefined): void => {
          if (!cover) return;
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
        };

        const paintSpine = (spine: HTMLCanvasElement | undefined): void => {
          if (!spine) return;
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
            // The binding is persisted beside the book rather than inside its
            // cover_meta style blob. The shelf injects it before renderSpine;
            // the preview used to omit that one field and therefore drew the
            // seed's plainer binding while the shelf showed the reader's saved
            // ornaments. Use the exact same resolved binding here.
            renderSpine(ctx as Ctx2D, {
              ...r.spine,
              binding: pinned() ?? seedBinding(),
            }, 0, 0, bookH, scale, {
              hiRes: true,
            });
            ctx.restore();
          }
        };

        // Desktop and narrow-window canvases are separate because the desktop
        // preview is portalled out of the scroller. Paint both from the same
        // resolved model so the responsive hand-off cannot show two books.
        paintCover(dockCoverCanvas());
        paintCover(inlineCoverCanvas());
        paintSpine(dockSpineCanvas());
        paintSpine(inlineSpineCanvas());
      },
    ),
  );

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
  /*
   * Cover art is fifty frames × fifty medallions. Keep the first folio quick,
   * always swap the current choice into it, and let the reader unfold the full
   * vocabulary in place. This is the same shortlist-plus-current rule used by
   * every long studio list; it exposes all the art without turning first open
   * into one hundred chips.
   */
  const [allCoverFrames, setAllCoverFrames] = createSignal(false);
  const coverFrameList = (): readonly StyleChip[] => CURATED_ROWS['cover-frame'].chips;
  const shownCoverFrames = createMemo<readonly StyleChip[]>(() =>
    allCoverFrames()
      ? coverFrameList()
      : cappedTo(
          coverFrameList(),
          COVER_CHIP_PAGE,
          (chip) => chip.id === String(style().coverFrame),
        ),
  );
  const coverFramesBehind = (): number => coverFrameList().length - shownCoverFrames().length;
  /** The reader's own colour, when they entered one. */
  const ownCloth = (): string | null => style().clothHex;
  /**
   * One projection with two deliberately different answers. The wells display
   * painter output; Surprise persists the source pigments and couples the
   * material/wear transforms which produced that output. Treating the visible
   * face as a source would darken buckram twice and cannot recolour vellum.
   */
  const colourProjection = createMemo(() =>
    resolveBookSurpriseColourProjection(design(), resolved().cover, style()),
  );
  const visibleColourRoles = (): BookSurprisePalette => colourProjection().visible;

  /**
   * One coherent recipe after the reader's four binding removals have had
   * their say. Component rows historically stored a complete `own:` id; the
   * art helper understands both that form and direct component ids.
   */
  const curatedSurpriseRecipe = (seed: number) => {
    const curation = {
      bindings: hiddenIds('binding'),
      shapes: hiddenIds('spine-shape'),
      materials: hiddenIds('covering'),
      decorations: hiddenIds('marks'),
      style: {
        'binding-material': hiddenIds('binding-material'),
        ornament: hiddenIds('ornament'),
        'title-plate': hiddenIds('title-plate'),
        lettering: hiddenIds('lettering'),
        edge: hiddenIds('edge'),
        format: hiddenIds('format'),
        'cover-frame': hiddenIds('cover-frame'),
        // The compatibility field follows the one emblem catalogue.
        'cover-medallion': hiddenIds('ornament'),
        'spine-cloth': hiddenIds('spine-cloth'),
      },
    };
    return surpriseBookRecipe({
      direction: surpriseDirection(),
      seed,
      current: {
        binding: pinned() ?? seedBinding(),
        style: style(),
        pinned: resolved().pinned,
        visibleColours: visibleColourRoles(),
        colourSources: colourProjection().sources,
      },
      locks: surpriseLocks(),
      curation,
      // Soft only: the engine may retain it when a binding/component lock says
      // that changing it would break the reader's explicit promise.
      avoidBinding: design().preset,
    });
  };

  /**
   * Dress the whole book from one of the design vocabulary's curated
   * directions. `surpriseBookRecipe` owns the compatible binding, proportions,
   * finishing and six-role palette as one art-directed decision. The recipe
   * is already lock- and curation-aware; post-processing it here would be able
   * to overwrite a value the reader explicitly asked Surprise to keep.
   */
  const surprise = (): void => {
    const effectiveBinding = pinned() ?? seedBinding();
    setHistory(pushBookSurpriseHistory(
      surpriseHistory(),
      {
        style: normalizeBookStyleOverrides(props.style),
        binding: pinned(),
        projectionBinding: effectiveBinding,
      },
    ));
    const recipe = curatedSurpriseRecipe((Math.random() * 0xffffffff) >>> 0);
    const current = { ...(normalizeBookStyleOverrides(props.style) ?? {}) };
    // The named preset owns its covering unless the reader locked the coarse
    // cover-material override. Remove a stale pin in the SAME write: the parent
    // is allowed to reflect props asynchronously, so patching and immediately
    // unpatching would otherwise rebuild from an older style blob.
    if (!lockSet().has('cover.material')) delete current.material;
    const next = {
      ...current,
      ...(recipe.style as Partial<BookStyle>),
    };
    applyAppearance(next, recipe.preset, recipe.preset);
  };

  const restorePreviousSurprise = (): void => {
    const { previous, remaining } = popBookSurpriseHistory(surpriseHistory());
    if (previous === null) return;
    setHistory(remaining);
    applyAppearance(previous.style, previous.binding, previous.projectionBinding);
  };

  /**
   * Per-section luck: the knobs each section's dice re-rolls, keyed by the
   * section's aria label. These deliberately use the low-level legal style
   * draw because one section is being changed in isolation; the whole-book
   * action above instead uses an art-directed recipe. Format re-rolls height
   * only — resolveBookStyle derives format from it.
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
    emblem: ['ornament', 'coverMedallion'],
    'title plate': ['titlePlate', 'titleFont', 'gilt'],
    'wear & edges': ['wear', 'edge'],
    format: ['height'],
    cover: ['coverFrame'],
  } as const satisfies Record<string, readonly (keyof BookStyle)[]>;

  const reroll = (keys: readonly (keyof BookStyle)[]): void => {
    // A press should visibly move: redraw a few times when the draw matches
    // the current value on every knob in the group. The removals are applied
    // BEFORE that comparison, so a section whose whole pool is one entry stops
    // re-drawing instead of spending three throws to arrive back where it was.
    const throwOnce = (): BookStyleOverrides =>
      respectingCuration(
        randomBookStyleOverrides((Math.random() * 0xffffffff) >>> 0),
        currentSurfaceContext(),
      );
    let draw = throwOnce();
    for (let tries = 0; tries < 3; tries += 1) {
      if (keys.some((key) => !Object.is(draw[key], style()[key]))) break;
      draw = throwOnce();
    }
    const partial: Record<string, unknown> = {};
    for (const key of keys) {
      const value = draw[key];
      if (value !== undefined) partial[key] = value;
    }
    patch(reconcileBookStudioSectionRoll(style(), partial as Partial<BookStyle>, keys));
  };

  /**
   * One preview, rendered in two physical homes.
   *
   * The desktop home is portalled beside the rail panel so the panel's own
   * overflow can never scroll or clip it. The narrow-window home is inline and
   * sticky; CSS shows exactly one. Both use the same signals and the same draw
   * effect above, so changing a breakpoint cannot change the book.
   */
  const PreviewStage = (stageProps: { variant: 'dock' | 'inline' }): JSX.Element => {
    const dock = stageProps.variant === 'dock';
    return (
      <aside
        class={`nb-book-preview nb-book-preview-${stageProps.variant}`}
        classList={{ 'is-shelf': props.host === 'shelf' }}
        aria-label="Live book preview"
      >
        <header class="nb-book-preview-head">
          <span>
            <strong>your book</strong>
            <small>{bookPreset(design().preset).label.toLowerCase()}</small>
          </span>
          <span class="nb-book-preview-measure font-ui">
            {Math.round(style().thickness)} × {Math.round(style().height)} px
          </span>
        </header>
        <div class="nb-book-preview-art">
          <div
            class="nb-book-preview-stack"
            style={{ width: `${PREVIEW_W}px`, height: `${PREVIEW_H}px` }}
          >
            <div
              class="nb-studio-flip"
              classList={{ 'is-cover': face() === 'cover' }}
            >
              <canvas
                class="nb-studio-face nb-studio-face-spine"
                ref={dock ? setDockSpineCanvas : setInlineSpineCanvas}
                width={PREVIEW_W}
                height={PREVIEW_H}
                role="img"
                aria-label="Spine preview"
                aria-hidden={face() !== 'spine'}
              />
              <canvas
                class="nb-studio-face nb-studio-face-cover"
                ref={dock ? setDockCoverCanvas : setInlineCoverCanvas}
                width={PREVIEW_W}
                height={PREVIEW_H}
                role="img"
                aria-label="Cover preview"
                aria-hidden={face() !== 'cover'}
              />
            </div>
            <div
              class="nb-book-preview-hotspots"
              role="group"
              aria-label={`${face() === 'spine' ? 'Spine' : 'Cover'} parts — choose one to edit`}
            >
              <For each={previewGeometry().hotspots.filter((hotspot) => hotspot.face === face())}>
                {(hotspot) => (
                  <button
                    type="button"
                    class={`nb-book-preview-hotspot is-${hotspot.layer}`}
                    classList={{ 'is-absent': hotspot.absent === true }}
                    style={previewRectStyle(hotspot.rect)}
                    aria-label={hotspot.label}
                    onClick={() => revealControl(hotspot.target)}
                  >
                    <span class="nb-book-preview-hotspot-mark" aria-hidden="true">
                      {hotspot.absent === true ? '+' : '↗'}
                    </span>
                    <span class="nb-book-preview-hotspot-label font-ui" aria-hidden="true">
                      {hotspot.shortLabel}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </div>
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
        <p class="nb-book-preview-note font-ui">
          live while you browse — click an outlined part to find its control
        </p>
      </aside>
    );
  };

  return (
    /* Same guard as the library tab: the shelf's document-level arrows/Enter
       must not reach past an open studio. See shelfKeys.ts. */
    <div class="nb-book-studio" ref={studioRoot} on:keydown={stopShelfKeys}>
      <Show when={props.open ?? true}>
        <Portal>
          <PreviewStage variant="dock" />
        </Portal>
      </Show>
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
      {/* Narrow windows cannot spare a companion lane. This copy pins inside
          the scroller; the desktop copy above lives beside the sheet. */}
      <PreviewStage variant="inline" />

      {/* ------------------------- first decisions ------------------------ */}
      <section class="nb-panel-section nb-book-essentials" aria-label="Book size and key colours">
        <h3 class="nb-panel-section-title">size & colours</h3>
        <div class="nb-panel-row" data-book-control="thickness" tabIndex={-1}>
          <span class="nb-book-setting-heading">
            <span class="nb-panel-row-label">
              thickness <em class="nb-panel-row-hint">{Math.round(style().thickness)}px</em>
            </span>
            <Lock id="thickness" />
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
        </div>
        <div class="nb-book-key-colours">
          <span class="nb-panel-row-label">
            key colours <em class="nb-panel-row-hint">spine and cover separately</em>
          </span>
          <div class="nb-book-colour-grid" role="group" aria-label="Key book colours">
            <ColourRole
              label="spine cloth"
              hint="main spine face"
              target="spine-base-colour"
              lock={<Lock id="colour.spine-base" />}
              value={style().spineBaseHex}
              visible={visibleColourRoles().spineBaseHex}
              onPick={(hex) => patch({ spineBaseHex: hex })}
              onClear={() => patch({ spineBaseHex: null })}
            />
            <ColourRole
              label="spine accent"
              hint="turn-ins and panels"
              target="spine-accent-colour"
              lock={<Lock id="colour.spine-accent" />}
              value={style().spineAccentHex}
              visible={visibleColourRoles().spineAccentHex}
              onPick={(hex) => patch({ spineAccentHex: hex })}
              onClear={() => patch({ spineAccentHex: null })}
            />
            <ColourRole
              label="cover cloth"
              hint="front board"
              target="cover-base-colour"
              lock={<Lock id="colour.cover-base" />}
              value={style().coverBaseHex}
              visible={visibleColourRoles().coverBaseHex}
              onPick={(hex) => {
                setFace('cover');
                patch({ coverBaseHex: hex });
              }}
              onClear={() => patch({ coverBaseHex: null })}
            />
            <ColourRole
              label="cover accent"
              hint="frame and board details"
              target="cover-accent-colour"
              lock={<Lock id="colour.cover-accent" />}
              value={style().coverAccentHex}
              visible={visibleColourRoles().coverAccentHex}
              onPick={(hex) => {
                setFace('cover');
                patch({ coverAccentHex: hex });
              }}
              onClear={() => patch({ coverAccentHex: null })}
            />
          </div>
        </div>

      </section>

      {/* ---------------------------- surprise --------------------------- */}
      <section class="nb-panel-section nb-library-surprise nb-book-surprise" aria-label="Surprise book direction">
        <h3 class="nb-panel-section-title">surprise me</h3>
        <div class="nb-panel-row nb-panel-row-stack">
          <span class="nb-panel-row-label">
            direction{' '}
            <em class="nb-panel-row-hint">
              {surpriseDirection() === null
                ? 'anything handsome'
                : BOOK_SURPRISE_DIRECTIONS.find((row) => row.id === surpriseDirection())?.label.toLowerCase()}
            </em>
          </span>
          <div class="nb-chip-row" role="group" aria-label="Surprise book direction">
            <button
              type="button"
              class="nb-chip"
              aria-pressed={surpriseDirection() === null}
              onClick={() => setSurpriseDirection(null)}
            >
              anything
            </button>
            <For each={BOOK_SURPRISE_DIRECTIONS}>
              {(direction) => (
                <button
                  type="button"
                  class="nb-chip"
                  aria-pressed={surpriseDirection() === direction.id}
                  onClick={() => setSurpriseDirection(direction.id)}
                >
                  {direction.label.toLowerCase()}
                </button>
              )}
            </For>
          </div>
          <Show when={BOOK_SURPRISE_DIRECTIONS.find((row) => row.id === surpriseDirection())} keyed>
            {(direction) => (
              <small class="nb-book-surprise-hint font-ui" aria-live="polite">
                {direction.hint}
              </small>
            )}
          </Show>
        </div>
        <div
          class="nb-book-lock-summary"
          classList={{ 'is-holding': surpriseLocks().length > 0 }}
          role="status"
          aria-live="polite"
        >
          <span class="nb-book-lock-summary-copy font-ui">
            <Show
              when={surpriseLocks().length > 0}
              fallback={<>open locks may change; close any lock to keep that setting</>}
            >
              {surpriseLocks().length} of {BOOK_SURPRISE_LOCK_IDS.length} settings kept
            </Show>
          </span>
          <Show when={surpriseLocks().length > 0}>
            <button type="button" class="nb-chip nb-chip-ghost font-ui" onClick={unlockAll}>
              unlock all
            </button>
          </Show>
        </div>
        <div class="nb-book-surprise-actions">
          <button type="button" class="nb-library-surprise-action" onClick={surprise}>
            <span aria-hidden="true">⚄</span>
            <span>
              <strong>dress this book</strong>
              <small>
                binding, cloth, proportions and finishing together
                <Show when={surpriseLocks().length > 0}> — except what you locked</Show>
              </small>
            </span>
          </button>
          <button
            type="button"
            class="nb-book-surprise-previous"
            disabled={surpriseHistory().length === 0}
            aria-label="Restore previous generated book look"
            onClick={restorePreviousSurprise}
          >
            <span class="nb-book-surprise-previous-mark" aria-hidden="true">↶</span>
            <span>
              <strong>previous look</strong>
              <small class="font-ui">
                {surpriseHistory().length === 0
                  ? 'dress the book to begin a history'
                  : `${surpriseHistory().length} saved ${surpriseHistory().length === 1 ? 'look' : 'looks'} for this book`}
              </small>
            </span>
          </button>
        </div>
      </section>

      {/* Height remains prominent, but below the whole-book shortcut. */}
      <section
        class="nb-panel-section"
        aria-label="Book format and shelf fit"
        data-book-control="format"
        tabIndex={-1}
      >

        <h3 class="nb-panel-section-title">
          format <em class="nb-panel-row-hint">{Math.round(style().height)}px tall</em>
          <span class="nb-book-section-tools">
            <RerollDice section="format" onClick={() => reroll(REROLL_GROUPS.format)} />
            <Lock id="format" />
          </span>
        </h3>
        <CuratedChips
          axis="format"
          label="Book format"
          options={CURATED_ROWS.format.chips}
          activeId={style().format}
          onPick={(chip) => patch(chip.sets as Partial<BookStyle>)}
        />
        <Show when={overTall()}>
          <div class="nb-fit-note" role="status">
            <p class="nb-panel-footnote nb-panel-footnote-tight">
              your {headroom().name.toLowerCase()} case leaves{' '}
              {headroom().varies ? 'at least ' : ''}
              {Math.round(headroom().min)}px of standing room
              {headroom().varies ? ' under its arches' : ''}.{' '}
              <Show when={overlapping()} fallback={<>this book is trimmed to fit.</>}>
                <>this book stands through the carpentry.</>
              </Show>
            </p>
            <button
              type="button"
              class="nb-chip"
              aria-pressed={overlapping()}
              onClick={() => patch({ overlap: !overlapping() })}
            >
              keep my height
            </button>
          </div>
        </Show>

      </section>

      <section class="nb-panel-section" aria-label="Cover title treatment">

        <h3 class="nb-panel-section-title">
          cover title
          <RerollDice section="title treatment" onClick={() => reroll(REROLL_GROUPS['title plate'])} />
        </h3>
        <div data-book-control="title-plate" tabIndex={-1}>
          <div class="nb-book-setting-subhead">
            <p class="nb-panel-row-label nb-strip-label font-ui">Title plate</p>
            <Lock id="title.plate" />
          </div>
          <CuratedChips
            axis="title-plate"
            label="Title plate"
            options={CURATED_ROWS['title-plate'].chips}
            activeId={style().titlePlate}
            onPick={(chip) => patch(chip.sets as Partial<BookStyle>)}
            limit={8}
          />
        </div>
        <div data-book-control="title-font" tabIndex={-1}>
          <div class="nb-book-setting-subhead">
            <p class="nb-panel-row-label nb-strip-label font-ui">Lettering</p>
            <Lock id="title.font" />
          </div>
          <CuratedChips
            axis="lettering"
            label="Title lettering"
            options={CURATED_ROWS.lettering.chips}
            activeId={String(style().titleFont)}
            onPick={(chip) => patch(chip.sets as Partial<BookStyle>)}
          >
            <span
              class="nb-book-setting-chip-pair"
              data-book-control="title-gilt"
              tabIndex={-1}
            >
              <button
                type="button"
                class="nb-chip nb-chip-gilt"
                role="switch"
                aria-checked={style().gilt}
                onClick={() => patch({ gilt: !style().gilt })}
              >
                gold tooling
              </button>
              <Lock id="title.gilt" />
            </span>
          </CuratedChips>
        </div>

      </section>

      {/* ------------------------------ binding ---------------------------- */}
      {/*
        The biggest manual design decision follows the quick whole-book path.
        Its previews are drawn by `drawBookSpine` — the routine that binds the
        book on the shelf — standing on the room's own timber, because a pale
        vellum against reef timber is a different book from the same vellum
        against athenaeum's.
      */}
      <section class="nb-panel-section" data-book-control="binding" tabIndex={-1}>
        <h3 class="nb-panel-section-title">
          binding <em class="nb-panel-row-hint">{bookPreset(design().preset).label.toLowerCase()}</em>
          <span class="nb-book-section-tools">
            <Lock id="binding" label="whole binding" />
          </span>
        </h3>
        <div class="nb-binding-stage">
          <DesignCanvas
            class="nb-binding-preview"
            key={`bind|${bookDesignTag(design())}|big`}
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
              onClick={() =>
                applyAppearance(styleWithoutPriorBinding(), null, seedBinding())
              }
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
        <div data-book-control="binding-shape" tabIndex={-1}>
          <div class="nb-book-setting-subhead">
            <p class="nb-panel-row-label nb-strip-label font-ui">Spine shape</p>
            <Lock id="binding.shape" />
          </div>
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
        </div>
        <div data-book-control="binding-material" tabIndex={-1}>
          <div class="nb-book-setting-subhead">
            <p class="nb-panel-row-label nb-strip-label font-ui">Covered in</p>
            <Lock id="binding.material" />
          </div>
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
        </div>
        <div data-book-control="binding-decoration" tabIndex={-1}>
          <div class="nb-book-setting-subhead">
            <p class="nb-panel-row-label nb-strip-label font-ui">Marks on the spine</p>
            <Lock id="binding.decoration" />
          </div>
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
        </div>
        <div
          class="nb-chip-row"
          role="group"
          aria-label="Tooling"
          data-book-control="binding-gilt"
          tabIndex={-1}
        >
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
          <Lock id="binding.gilt" />
        </div>
        <p class="nb-panel-footnote">
          {ROLLABLE_SHAPES.length} shapes × {ROLLABLE_MATERIALS.length} coverings ×{' '}
          {ROLLABLE_DECORATIONS.length + 1} marks, either tooling — your own
          binding, kept with the book.
        </p>
      </section>

      <section class="nb-panel-section" data-book-control="binding-material" tabIndex={-1}>
        <h3 class="nb-panel-section-title">
          covering
          <span class="nb-book-section-tools">
            <RerollDice section="covering" onClick={() => reroll(REROLL_GROUPS.material)} />
            <Lock id="cover.material" label="material override" />
          </span>
        </h3>
        <CuratedChips
          axis="binding-material"
          label="Binding material"
          options={CURATED_ROWS['binding-material'].chips}
          activeId={covering()}
          onPick={(chip) => patch(chip.sets as Partial<BookStyle>)}
        >
          {/* Not one of the coverings and deliberately outside the curated
              list: "as bound" is the way back to what the binding chose, so a
              reader who removed it would have removed their own escape. */}
          <Show when={resolved().pinned.has('material')}>
            <button
              type="button"
              class="nb-chip nb-chip-ghost"
              onClick={() => unpatch('material')}
            >
              as bound
            </button>
          </Show>
        </CuratedChips>
      </section>

      <section class="nb-panel-section" data-book-control="palette" tabIndex={-1}>
        <h3 class="nb-panel-section-title">
          base pigment
          <em class="nb-panel-row-hint">
            {ownCloth() ?? CLOTH_SWATCHES[style().pigment]?.name ?? ''}
          </em>
          <span class="nb-book-section-tools">
            <RerollDice section="pigment" onClick={() => reroll(REROLL_GROUPS.pigment)} />
            <Lock id="colour.palette" />
          </span>
        </h3>
        <small class="nb-book-surprise-hint font-ui">
          the dye beneath the covering — vellum, paper and deep cloth tint it
        </small>
        <div
          class="nb-swatch-grid"
          role="group"
          aria-label="Book base pigment"
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
        <p class="nb-panel-footnote">
          {/* The count the reader can check by opening the row, not the count
              the vocabulary ships: they may have taken some of these off it. */}
          {clothList().length} shared cloths for unpinned parts. use key colours
          above when the spine and cover should differ.
        </p>
      </section>

      <details class="nb-book-colour-workshop">
        <summary>colour workshop</summary>
        <p class="nb-panel-footnote">
          details inherit from the binding until you pin one here. reset hands
          that part back without disturbing the rest of the book.
        </p>
        <div class="nb-book-colour-grid" role="group" aria-label="Detailed book colours">
          <ColourRole
            label="tooling"
            hint="rules, type and foil"
            target="tooling-colour"
            lock={<Lock id="colour.tooling" />}
            value={style().toolingHex}
            visible={visibleColourRoles().toolingHex}
            onPick={(hex) => patch({ toolingHex: hex })}
            onClear={() => patch({ toolingHex: null })}
          />
          <ColourRole
            label="emblems"
            hint="stamps and medallions"
            target="emblem-colour"
            lock={<Lock id="colour.emblem" />}
            value={style().emblemHex}
            visible={visibleColourRoles().emblemHex}
            onPick={(hex) => patch({ emblemHex: hex })}
            onClear={() => patch({ emblemHex: null })}
          />
        </div>
      </details>

      {/* ------------------------------- bands ----------------------------- */}
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">
          bands & endbands
          <RerollDice section="bands & endbands" onClick={() => reroll(REROLL_GROUPS['bands & endbands'])} />
        </h3>
        <div class="nb-panel-row" data-book-control="bands" tabIndex={-1}>
          <span class="nb-book-setting-heading">
            <span class="nb-panel-row-label">
              raised cords <em class="nb-panel-row-hint">{style().raisedBands}</em>
            </span>
            <Lock id="bands" />
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
          </div>
        </div>
        <div data-book-control="endbands" tabIndex={-1}>
          <div class="nb-book-setting-subhead">
            <p class="nb-panel-row-label font-ui">Endbands</p>
            <Lock id="endbands" />
          </div>
          <div class="nb-chip-row">
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
              <For each={ACTIVE_HEAD_TAIL_OPTIONS}>
                {(option) => (
                  <button
                    type="button"
                    class="nb-chip"
                    aria-pressed={style().headTailStyle === option.index}
                    onClick={() => patch({ headTailStyle: option.index })}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </section>

      {/* ------------------------------ emblem ----------------------------- */}
      <section class="nb-panel-section" data-book-control="ornament" tabIndex={-1}>
        <h3 class="nb-panel-section-title">
          emblem
          <span class="nb-book-section-tools">
            <Show when={!emblemUnavailable()}>
              <RerollDice section="emblem" onClick={() => reroll(REROLL_GROUPS.emblem)} />
            </Show>
            <Lock id="ornament" />
          </span>
        </h3>
        <Show
          when={!emblemUnavailable()}
          fallback={
            <p class="nb-panel-footnote nb-panel-footnote-tight">
              {emblemUnavailableReason()}; a second emblem would compete with it
            </p>
          }
        >
          <CuratedChips
            grid
            axis="ornament"
            label="Book emblem"
            options={CURATED_ROWS.ornament.chips}
            activeId={String(style().ornament)}
            onPick={(chip) => patch(chip.sets as Partial<BookStyle>)}
            limit={12}
          />
        </Show>
      </section>

      {/* ------------------------- wear & text block ----------------------- */}
      <section class="nb-panel-section" data-book-control="wear" tabIndex={-1}>
        <h3 class="nb-panel-section-title">
          wear <em class="nb-panel-row-hint">{wearLabel(style().wear)}</em>
          <span class="nb-book-section-tools">
            <RerollDice section="wear & edges" onClick={() => reroll(REROLL_GROUPS['wear & edges'])} />
            <Lock id="wear" />
          </span>
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
        <div data-book-control="edge" tabIndex={-1}>
          <h3 class="nb-panel-section-title nb-panel-section-title-sub">
            edges
            <span class="nb-book-section-tools">
              <Lock id="edge" />
            </span>
          </h3>
          <CuratedChips
            axis="edge"
            label="Edge treatment"
            options={CURATED_ROWS.edge.chips}
            activeId={style().edge}
            onPick={(chip) => patch(chip.sets as Partial<BookStyle>)}
            limit={12}
          />
        </div>
      </section>

      {/* -------------------------------- cover ---------------------------- */}
      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">
          cover
          <RerollDice section="cover" onClick={() => reroll(REROLL_GROUPS.cover)} />
        </h3>
        <div data-book-control="cover-frame" tabIndex={-1}>
          <div class="nb-book-setting-subhead">
            <p class="nb-panel-row-label nb-strip-label font-ui">Frame</p>
            <Lock id="cover.frame" />
          </div>
          <CuratedChips
            axis="cover-frame"
            label="Cover frame"
            options={shownCoverFrames()}
            activeId={String(style().coverFrame)}
            onPick={(chip) => {
              // Turn the preview over first: a cover knob that moves nothing the
              // reader can see reads as a dead chip.
              setFace('cover');
              patch(chip.sets as Partial<BookStyle>);
            }}
          />
        </div>
        <Show when={allCoverFrames() || coverFramesBehind() > 0}>
          <div class="nb-chip-row nb-cover-more">
            <button
              type="button"
              class="nb-chip nb-chip-ghost font-ui"
              aria-expanded={allCoverFrames()}
              onClick={() => setAllCoverFrames(!allCoverFrames())}
            >
              {allCoverFrames() ? 'fewer frames' : `${coverFramesBehind()} more frames`}
            </button>
          </div>
        </Show>
        <p class="nb-panel-footnote nb-panel-footnote-tight">
          The emblem above is shared by spine and cover, so both faces stay one binding.
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
 * of the art-directed whole-book surprise. Same pre-wobbled stroke idiom as the shelf dock
 * icons (fill:none paths, so a missing stylesheet can't black-box it).
 */
function RerollDice(props: {
  section: string;
  onClick(): void;
}): JSX.Element {
  const label = (): string => `Reroll ${props.section}`;
  return (
    <button
      type="button"
      class="nb-reroll"
      aria-label={label()}
      data-tooltip={label()}
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
