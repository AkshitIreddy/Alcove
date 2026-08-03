/**
 * features/bookshelf/world.ts — the PixiJS shelf world controller.
 *
 * Owns the Application (webgl, autoStart:false), the render-on-demand loop
 * (dirty flag; a settled shelf draws nothing at all), the camera,
 * virtualization, LOD switching, the pull-out choreography, and every
 * non-reactive Pixi object. Solid components talk to it through the
 * WorldEvents callbacks and its small public API; Solid never diffs Pixi.
 *
 * No filters, no additive layers, no light: every sprite draws exactly the
 * flat colours its art was authored in (see `art/flat.ts`).
 */

import gsap from 'gsap';
import { PixiPlugin } from 'gsap/PixiPlugin';
import * as PIXI from 'pixi.js';
import {
  Application,
  Container,
  ImageSource,
  NineSliceSprite,
  Sprite,
  Texture,
  TilingSprite,
} from 'pixi.js';
import { clamp } from '../../art/noise';
import { SPINE_BASE_HEIGHT } from '../../art/spines';
import type { BookStyle } from '../../art/bookStyle';
import { play } from '../../sound/engine';
import { appState } from '../../state/app';
import {
  createBook,
  deleteBook,
  listBooksByFloorRange,
  moveBook,
  moveBookToBookcase,
  nextFreeSlot,
  touchBookOpened,
} from '../../data/books';
import {
  activeBookcase,
  addBookcaseFloor,
  createBookcase,
  deleteBookcase,
  loadBookcases,
  renameBookcase,
  snapshotBookcases,
  subscribeBookcases,
  switchBookcase,
  type BookcaseState,
} from '../../data/bookcases';
import { save as saveSettings, subscribe as subscribeSettings } from '../../data/settings';
import type { Book } from '../../data/types';
import { flatScheme, setFlatScheme } from '../../art/flat';
import type { ColourScheme } from '../../art/themes';
import { floorLabel, loadFloorNames, onFloorNameChange } from './floorNames';
import {
  addWheelZoom,
  applyDragPosition,
  clampCamera,
  clampZoomBounds,
  createCamera,
  isOutOfBounds,
  lerpExp,
  LOG_MAX_ZOOM,
  minZoomFor,
  momentumTick,
  rubberBand,
  screenToWorld,
  weightedVelocity,
  worldToScreen,
  xBounds,
  yBounds,
  zoomTick,
  type CameraState,
  type DragSample,
  type Vec2,
  type Viewport,
} from './camera';
import {
  BASE_H,
  BOOK_BASELINE,
  caseBottomY,
  caseFootY,
  CROWN_H,
  CROWN_LIP,
  DEFAULT_FLOOR_COUNT,
  FLOOR_H,
  HIT_SLOP,
  SHELF_WIDTH,
  SLOT_MARGIN_X,
  SLOT_W,
  clampFloorCount,
  slotCenterX,
  X_SLACK,
  Y_MIN,
  yMaxFor,
} from './constants';
import { GHOST_H, GHOST_W, nextSpotX } from './addSpot';
import { FloorStore } from './data';
import {
  detectSoftwareRenderer,
  fxOverride,
  prefersReducedMotion,
  watchReducedMotion,
} from './env';
import { persistBookStyle } from './bookIdentity';
import { FloorStampCache } from './floorStamps';
import {
  loadLibraryPrefs,
  resolveLibrary,
  saveLibraryPrefs as saveLibraryPrefsFn,
  snapshotLibraryPrefs,
  subscribeLibraryPrefs,
  type LibraryPrefs,
} from './libraryPrefs';
import {
  FloorView,
  PLAQUE_CENTER_X,
  PLAQUE_CENTER_Y,
  type BookVisual,
  type WorldHooks,
} from './floorView';
import {
  classifyDrag,
  classifyKeyZoom,
  KEY_ZOOM_STEP,
  PULL_COMPLETE_TRAVEL_PX,
} from './gestures';
import { ShelfInput } from './input';
import { nextLodTier, type LodTier } from './lod';
import { makeFrameSprite, makeShelfMarks, type ShelfMarks } from './glow';
import { SpineFactory, type SpineRowContext } from './spineFactory';
import { paletteCss } from './spinePalette';
import { EnvTextures, PLACEHOLDER_TINTS, PLAQUE_H, PLAQUE_W } from './textures';
import { computeRange, diffWindow, Pool, type FloorRange } from './virtualizer';
import { shelfDesignTag } from '../../art/shelfDesign';
import {
  renderWallpaperTile,
  wallpaperAxisKey,
  wallpaperTileKey,
  wallpaperTilePx,
  type WallpaperSpec,
} from '../../art/wallpaperDesign';
import {
  bookBinding,
  loadDesignPrefs,
  saveBookBinding,
  saveRoomDesign,
  shelfDesignOf,
  snapshotRoomDesign,
  subscribeBookBindings,
  subscribeRoomDesign,
  type RoomDesign,
} from '../../data/designPrefs';
import { bakeCached } from '../../art/bake';

/* --------------------------- gsap registration ---------------------------- */

let gsapRegistered = false;
function ensureGsapPixi(): void {
  if (gsapRegistered) return;
  gsap.registerPlugin(PixiPlugin);
  PixiPlugin.registerPIXI(PIXI);
  gsapRegistered = true;
}

/* ------------------------------ shared types ------------------------------ */

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisibleBook {
  id: string;
  title: string;
  floor: number;
}

/**
 * The ghost "add a book here" slot, in screen (CSS px) coordinates.
 *
 * The world owns WHERE it belongs (which floor you are looking at, which
 * stretch of plank is free); the DOM overlay owns what it looks like.
 */
export interface AddSpot {
  floor: number;
  /** Screen rect of the ghost spine, CSS px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** True while the library holds no books at all (first-run invitation). */
  firstRun: boolean;
}

/** The title a freshly created book wears until you write over it. */
export const NEW_BOOK_TITLE = 'Untitled';

export interface WorldEvents {
  /** The a11y mirror re-renders from this. */
  onVisibleBooksChange(books: VisibleBook[]): void;
  /** Canvas pull-out finished; the DOM overlay takes over at `rect`. */
  onGhostReady(book: Book, rect: RectLike): void;
  /** Rounded zoom percent changed (drives the zoom pill readout). */
  onZoomChange?(percent: number): void;
  /** The applied library room changed (theme/wallpaper/backdrop key). */
  onLibraryChange?(key: string): void;
  /** Right-click on a spine: open the shelf book menu at `screen` (CSS px). */
  onBookMenu?(book: Book, screen: Vec2): void;
  /** Double-click on a floor plaque: open the label editor over `rect`. */
  onEditFloorPlate?(floor: number, rect: RectLike): void;
  /** The ghost add-a-book slot appeared, moved or vanished. */
  onAddSpotChange?(spot: AddSpot | null): void;
  /** Right-click on empty plank: the "new book here" menu at `screen`. */
  onShelfMenu?(floor: number, screen: Vec2): void;
}

/** Camera survives the shelf ↔ book unmount round-trip (module singleton). */
interface CameraSnapshot {
  x: number;
  y: number;
  zoom: number;
}
let sessionCamera: CameraSnapshot | null = null;

const PARALLAX = 0.85;

/**
 * The room's `scheme.wall` as a tint, for the placeholder only.
 *
 * The wall was ONE flat colour for a while, and for a good reason: a solid
 * fill has no tile and therefore no seam, and the pale banding reported in
 * the corners while panning was a seam in every version that had one —
 * procedural strip and generated panel alike.
 *
 * `art/wallpaperDesign.ts` is the version that earns a tile back. Every mark
 * on it is emitted through a torus-aware emitter and the lattice is fitted to
 * the tile, so it is seamless by construction and there is a test that abuts
 * two copies and measures it. This tint now only dresses the backdrop for the
 * handful of frames before the first tile lands.
 *
 * Parsed rather than tabulated so a hex edited in `art/themes.ts` reaches the
 * wall without a second copy of it here going stale.
 */
function wallTint(hex: string): number {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0xe9e2d0;
}

/**
 * Every wallpaper axis as one short string, for the applied-room key.
 *
 * Borrowed from the module that owns the spec rather than spelled here: this
 * used to be a local four-axis copy, and when `tone` and `edge` were added it
 * silently fell two axes behind — changing only the sharpness left the old
 * wall on screen because nothing thought the room had changed.
 *
 * Not `wallpaperTileKey`, which also carries the scheme and the pixel size:
 * this only has to answer "is the reader looking at a different paper", and
 * the scheme is already in the key this gets appended to.
 */
const wallpaperKeyOf = wallpaperAxisKey;

/** Springy-lag constant for the dragged-book ghost (lerpExp k). */
const PULL_FOLLOW_K = 11;

/** A dragged-out book. The ghost chases the pointer with springy lag. */
interface BookPull {
  fv: FloorView;
  visual: BookVisual;
  ghost: Sprite;
  shadow: Sprite;
  /** Where the spine sat on screen when the pull began. */
  startX: number;
  startY: number;
  /** Pointer target (screen px, spine bottom-center). */
  targetX: number;
  targetY: number;
  /** Current sprung position. */
  x: number;
  y: number;
  finishing: boolean;
}

/* --------------------------------- world ---------------------------------- */

export class ShelfWorld {
  readonly degrade: boolean;
  /** Resolves once floor data is loaded and the first sync has run. */
  readonly ready: Promise<void>;

  private readonly app: Application;
  private readonly host: HTMLElement;
  private readonly events: WorldEvents;
  private readonly dpr: number;
  private reducedMotion: boolean;

  private readonly camera: CameraState;
  private readonly vp: Viewport = { width: 1, height: 1 };
  private readonly store = new FloorStore();
  private readonly factory: SpineFactory;
  private readonly envTex = new EnvTextures();
  private readonly stamps = new FloorStampCache((floor) => this.floors.has(floor));
  private readonly input: ShelfInput;

  /**
   * Floors the open bookcase shows. Ten unless the reader grew it — the case
   * has a bottom, and this is where it is.
   */
  private floorCount = DEFAULT_FLOOR_COUNT;
  /** The bookcase on screen. Changing it reloads the case AND its books. */
  private caseId = '';
  /** Bumped per bookcase switch so stale async reloads drop. */
  private caseGen = 0;

  /** Bumped per theme application so stale async case bakes drop. */
  private libraryGen = 0;
  /** The room key whose art is actually on screen. */
  private appliedLibraryKey = '';
  /** Set while a coalesced `applyLibrary` is already queued for this tick. */
  private libraryQueued = false;
  /**
   * How many times the case + wall have actually been BAKED.
   *
   * Only meaningful to QA (`shots-now/preset-bakes.mjs`), and cheap enough to
   * carry always: the number is the whole evidence that applying a preset
   * costs one bake rather than two, and a claim like that needs a counter
   * rather than a stopwatch.
   */
  private roomBakes = 0;
  /** Full-viewport snapshot held over the stage during a theme crossfade. */
  private themeFade: Sprite | null = null;

  /** The wall: one TilingSprite carrying the room's baked wallpaper tile. */
  private readonly backdrop: TilingSprite;
  /**
   * The wallpaper currently ON the backdrop. A second parallax layer used to
   * hang over this one and was hidden on the first env-ready; two tiling
   * layers at different pitches beat against each other, so there is one.
   */
  private wallpaperKey = '';
  /** Bumped per wallpaper bake so a stale tile cannot land after a newer one. */
  private wallpaperGen = 0;
  /** The open case's carpentry + paper. Kept so a repaint can re-read it. */
  private roomDesign: RoomDesign = snapshotRoomDesign();
  /** World space: the case, under the camera transform. */
  private readonly world = new Container();
  /** Screen space, above everything: drag ghosts, drop-target hints. */
  private readonly fx = new Container();
  /** Flat interaction marks — hover/selection outlines, contact shadow. */
  private readonly marks: ShelfMarks;
  /** Crown/header board capping the case above floor 0. */
  private readonly crown: Sprite;
  /** The same board, mirrored, standing under the last floor. */
  private readonly plinth: Sprite;

  private readonly floors = new Map<number, FloorView>();
  private readonly pool: Pool<FloorView>;
  private tier: LodTier;
  private range: FloorRange = { first: 0, last: -1 };

  private dirty = true;
  private raf = 0;
  private lastTime = 0;
  private destroyed = false;
  private frozen = false;
  private dragging = false;
  private rawDragX = 0;
  private rawDragY = 0;
  private hovered: { fv: FloorView; visual: BookVisual } | null = null;
  private downHit: { fv: FloorView; visual: BookVisual } | null = null;
  private pull: BookPull | null = null;
  private ghost: Sprite | null = null;
  private ghostShadow: Sprite | null = null;
  private lastZoomPct = -1;
  private zoomTween: gsap.core.Tween | null = null;
  private springTween: gsap.core.Tween | null = null;
  private readonly tracked = new Set<gsap.core.Animation>();
  private a11ySignature = '';

  /* ------------------------- wave-2 shelf-life state ---------------------- */
  /** Menu-driven move mode: ghost follows the pointer, tap drops the book. */
  private move: {
    visual: BookVisual;
    ghost: Sprite;
    shadow: Sprite;
    targetFloor: number;
    targetSlot: number;
    committing: boolean;
  } | null = null;
  /** Drop-target slot highlight while moving (fx layer, screen space). */
  private movePreview: NineSliceSprite | null = null;
  /** The same mark, standing in the gap a pulled-out book came from. */
  private slotHint: NineSliceSprite | null = null;
  /** Row-mates dimmed while a book is out, with the tint each wore before. */
  private readonly dimmed: Array<{ sprite: Sprite; tint: number }> = [];
  /** Keyboard shelf-nav selection (floor + index into the floor's visuals). */
  private kbSel: { floor: number; index: number } | null = null;
  private kbVisual: { fv: FloorView; visual: BookVisual } | null = null;
  /** Previous tap (plaque double-click detection). */
  private lastTap: { x: number; y: number; t: number } | null = null;
  /** The ghost add-a-book slot last published to the overlay. */
  private addSpot: AddSpot | null = null;
  /** Change signature for the ghost slot (publish only on a real move). */
  private addSpotSig = '\0';

  private readonly hooks: WorldHooks = {
    markDirty: () => {
      this.dirty = true;
    },
    motion: () => (this.reducedMotion ? 0 : 1),
    track: (anim) => this.track(anim),
    marks: () => this.marks,
  };

  private readonly unsubs: Array<() => void> = [];

  /* ------------------------------- creation ------------------------------ */

  static async create(host: HTMLElement, events: WorldEvents): Promise<ShelfWorld> {
    ensureGsapPixi();
    const degrade = detectSoftwareRenderer();
    const dpr = degrade ? 1 : Math.min(globalThis.devicePixelRatio || 1, 2);
    const app = new Application();
    await app.init({
      preference: 'webgl',
      antialias: !degrade,
      resolution: dpr,
      autoDensity: true,
      autoStart: false,
      backgroundAlpha: 0,
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
    });
    return new ShelfWorld(host, events, app, degrade, dpr);
  }

  private constructor(
    host: HTMLElement,
    events: WorldEvents,
    app: Application,
    degrade: boolean,
    dpr: number,
  ) {
    this.host = host;
    this.events = events;
    this.app = app;
    this.degrade = degrade;
    this.dpr = dpr;
    this.reducedMotion = prefersReducedMotion();
    this.factory = new SpineFactory({ hiEnabled: !degrade });

    host.appendChild(app.canvas);
    app.canvas.classList.add('shelf-canvas');
    this.vp.width = Math.max(1, host.clientWidth);
    this.vp.height = Math.max(1, host.clientHeight);

    // Stage hierarchy per the doc: backdrop → world → fx.
    this.backdrop = new TilingSprite({
      texture: Texture.WHITE,
      width: this.vp.width,
      height: this.vp.height,
    });
    this.backdrop.tint = PLACEHOLDER_TINTS.backdrop;
    this.backdrop.alpha = 0;
    this.backdrop.eventMode = 'none';
    this.marks = makeShelfMarks();

    // The case crown above floor 0 — world-space, added before any FloorView
    // so floors always render above it.
    //
    // Flat timber until the bake lands; `syncCrown` swaps the art in.
    this.crown = new Sprite(Texture.WHITE);
    this.crown.tint = PLACEHOLDER_TINTS.crown;
    this.crown.eventMode = 'none';
    this.crown.position.set(-CROWN_LIP, -CROWN_H);
    this.crown.width = SHELF_WIDTH + CROWN_LIP * 2;
    this.crown.height = CROWN_H;
    this.world.addChild(this.crown);

    // The foot of the case. A bookcase that stops has to be SEEN to stop —
    // the camera bound alone only tells you once you push against it, and a
    // last plank flush with the window edge looks cut off, not finished.
    this.plinth = new Sprite(Texture.WHITE);
    this.plinth.tint = PLACEHOLDER_TINTS.crown;
    this.plinth.eventMode = 'none';
    this.world.addChild(this.plinth);
    this.layoutPlinth();

    // Stage: flat wall, the case, then screen-space affordances. No filters —
    // every sprite here draws exactly the colours its art was authored in.
    this.world.eventMode = 'none';
    app.stage.addChild(this.backdrop, this.world, this.fx);
    app.stage.eventMode = 'none';

    // Camera: session restore, else a friendly overview of the first floors.
    const snap = sessionCamera;
    this.camera = snap !== null
      ? createCamera(snap.zoom, snap.x, snap.y)
      : createCamera(0.8, 0, Y_MIN);
    if (snap === null) {
      const bx = xBounds(this.vp, this.camera.zoom);
      this.camera.x = clamp((SHELF_WIDTH - this.vp.width / this.camera.zoom) / 2, bx.min, bx.max);
    }
    // A restored zoom may undershoot the viewport-aware floor (window grew),
    // and a restored X may sit outside the bounds that zoom implies — so the
    // first painted frame is already centred rather than waiting for the loop.
    clampZoomBounds(this.camera, this.vp);
    clampCamera(this.camera, this.vp);
    this.tier = nextLodTier(0, this.camera.zoom);

    this.input = new ShelfInput(app.canvas, {
      onWheelZoom: (deltaY, cursor, sensitivity) =>
        this.handleWheelZoom(deltaY, cursor, sensitivity),
      onWheelPan: (dx, dy) => this.handleWheelPan(dx, dy),
      onPointerDown: (cursor) => this.handlePointerDown(cursor),
      onDragStart: (dx, dy, onBook) => this.handleDragStart(dx, dy, onBook),
      onDragMove: (dx, dy, cursor) => this.handleDragMove(dx, dy, cursor),
      onDragEnd: (samples) => this.handleDragEnd(samples),
      onDragCancel: () => this.handleDragCancel(),
      onTap: (cursor) => this.handleTap(cursor),
      onHover: (cursor) => this.handleHover(cursor),
      onContextMenu: (cursor) => this.handleContextMenu(cursor),
    });

    // Keyboard zoom: +/- and 0 work anywhere on the shelf (document-level;
    // classifyKeyZoom ignores keystrokes bound for editable fields).
    const onKeyDown = (e: KeyboardEvent): void => {
      if (this.frozen || this.destroyed) return;
      const target = e.target as HTMLElement | null;
      const editing =
        target !== null &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');
      // A side panel is a dialog: while one is out, arrows and Enter belong to
      // whatever is in it. This listener is on `document`, so without the
      // check every panel's keyboard also drove the shelf behind it — arrowing
      // a picker dragged the selection halo around, and Enter pulled a book
      // out and opened it on top of the open sheet. The studio roots stop the
      // event themselves (`views/rail/shelfKeys.ts`); this covers the trash,
      // the TOC, the sticker tray and everything added later, which is why it
      // reads the state flag rather than a list of selectors.
      const panelOpen = document.documentElement.dataset['nbPanel'] === 'open';
      // Wave-2 shelf nav (arrows/Enter/Home) + move-mode Escape.
      if (!editing && !panelOpen && this.handleNavKey(e.key)) {
        e.preventDefault();
        return;
      }
      const action = classifyKeyZoom({ key: e.key, altKey: e.altKey, editing });
      if (action === null) return;
      e.preventDefault();
      if (action === 'in') this.zoomIn();
      else if (action === 'out') this.zoomOut();
      else this.zoomReset();
    };
    document.addEventListener('keydown', onKeyDown);
    this.unsubs.push(() => document.removeEventListener('keydown', onKeyDown));

    this.unsubs.push(
      this.store.onChange((floorIndices) => this.handleFloorData(floorIndices)),
      this.factory.onTexturesChanged((bookIds) => this.handleTexturesChanged(bookIds)),
      this.envTex.onReady(() => this.handleEnvReady()),
      watchReducedMotion((reduced) => {
        this.reducedMotion = reduced;
        this.dirty = true;
      }),
      // Wave-2: live-apply sort / wheel mode on save. The wood stain and the
      // wallpaper used to be pushed at `envTex` from here and had been inert
      // for as long as the case has been flat; both are real choices again,
      // but they belong to the BOOKCASE now, not to app settings, and they
      // arrive through `subscribeRoomDesign` below.
      subscribeSettings((s) => {
        this.store.setSort(s.shelfSort);
        this.input.wheelMode = s.wheelMode;
      }),
      // Plaque label edits re-texture the mounted floor + its LOD2 stamp.
      onFloorNameChange((floor) => {
        const fv = this.floors.get(floor);
        if (fv !== undefined) {
          fv.setPlaque(this.envTex, this.dpr, floorLabel(floor));
          this.rebakeStamp(floor, fv);
          this.dirty = true;
        }
      }),
    );
    void loadFloorNames().then(() => {
      if (this.destroyed) return;
      for (const [index, fv] of this.floors) {
        fv.setPlaque(this.envTex, this.dpr, floorLabel(index));
      }
      this.dirty = true;
    });

    const ro = new ResizeObserver(() => this.handleResize());
    ro.observe(host);
    this.unsubs.push(() => ro.disconnect());

    const onVisibility = (): void => {
      this.dirty = true;
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.unsubs.push(() => document.removeEventListener('visibilitychange', onVisibility));

    this.pool = new Pool<FloorView>(
      () => {
        const fv = new FloorView(this.hooks);
        this.world.addChild(fv.root);
        return fv;
      },
      (fv) => fv.reset(),
      (fv) => fv.destroy(),
    );

    this.envTex.load(this.dpr, this.degrade);

    // The library theme (docs/design/library-themes.md). The first snapshot
    // arrives synchronously with the defaults, then again once the stored
    // prefs load — and after every studio edit. Since a room now belongs to a
    // bookcase, this also fires on every case switch.
    this.unsubs.push(
      subscribeLibraryPrefs(() => {
        this.queueApplyLibrary();
      }),
      // The carpentry and the wallpaper are the room's other two axes and they
      // live in their own store, so a build change never touches `prefs` and
      // the subscription above would never fire for it. This one fires
      // immediately, on every studio edit, AND on a bookcase switch.
      subscribeRoomDesign(() => {
        this.queueApplyLibrary();
      }),
      // A binding is persisted outside `cover_meta`, so the studio's save does
      // not travel the `persistBookStyle` → `invalidate` path the other style
      // knobs use. Without this, picking a binding repaints the studio's own
      // preview and nothing else on the shelf.
      subscribeBookBindings((ids) => {
        for (const id of ids) this.factory.invalidate(id);
        this.dirty = true;
      }),
    );
    void loadLibraryPrefs();
    void loadDesignPrefs();

    // Which bookcase is open has to be known BEFORE the first page load, and
    // the subscription is only attached afterwards: `subscribeBookcases` fires
    // immediately with whatever the store holds, and attaching it up here
    // would deliver the pre-load default and switch the world to a case the
    // reader did not ask for.
    this.ready = loadBookcases()
      .then((state) => {
        if (this.destroyed) return;
        this.adoptBookcase(state);
        this.unsubs.push(
          subscribeBookcases((next) => {
            void this.applyBookcase(next);
          }),
        );
        return this.store.init(state.activeId);
      })
      .then(() => {
        if (this.destroyed) return;
        this.clampCaseBottom();
        this.dirty = true;
      });

    this.updateCursor();
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);

    // QA hook: with an ?fx= override active (screenshot harness), expose the
    // world so headless probes can inspect camera/floor/sprite state, plus a
    // settings writer bound to the SAME settings module instance this world
    // subscribed to. (A probe's own `import('/src/data/settings.ts')` can
    // resolve to a second copy of the module on a dev server that has served
    // HMR updates — Vite appends ?t= to the app graph's import URLs — and
    // writes to that copy would never reach the shelf.)
    if (fxOverride() !== null) {
      const globals = globalThis as Record<string, unknown>;
      globals['__shelfWorld'] = this;
      globals['__shelfSaveSettings'] = saveSettings;
      // Library studio bridge — same module instance the world subscribed to.
      globals['__libraryPrefs'] = {
        save: (patch: Partial<LibraryPrefs>) => saveLibraryPrefsFn(patch),
        // The STORE, not the world's copy — the shelf unmounts while a book
        // is open, and the studio still writes to the store from there.
        current: () => snapshotLibraryPrefs(),
      };
      // Shelf-dressing helper for screenshot boards: the visual QA harness
      // needs a populated case, and creating books through the UI one at a
      // time is far too slow.
      globals['__shelfSeedBooks'] = async (
        titles: readonly string[],
        floor = 0,
      ): Promise<void> => {
        let slot = await nextFreeSlot(floor, 0, this.caseId);
        for (const title of titles) {
          await createBook({ title, bookcaseId: this.caseId, floor, slot });
          slot += 1;
        }
        await this.store.refreshAll();
      };
      // What the case is actually BUILT and PAPERED in right now, as opposed
      // to what the studio has stored. The two disagreeing is the whole class
      // of bug this wiring exists to close, so the probe has to be able to
      // read the applied side rather than the requested one.
      globals['__shelfDesign'] = (): {
        design: RoomDesign;
        shelf: string;
        wallpaperKey: string;
        libraryKey: string;
        bakes: number;
      } => ({
        design: this.roomDesign,
        shelf: shelfDesignTag(this.envTex.design),
        wallpaperKey: this.wallpaperKey,
        libraryKey: this.appliedLibraryKey,
        /** Case + wall bakes since launch — see `roomBakes`. */
        bakes: this.roomBakes,
      });
      // The WRITERS have to be handed out from here for the same reason
      // `__shelfSaveSettings` is: a probe's own `import('/src/data/…')` can
      // resolve to a second copy of the module on a dev server that has served
      // HMR updates, and a store written on that copy never reaches the world
      // that subscribed to this one. (Observed: the first run of
      // `probe-vocabularies.mjs` saved a gothic case and timed out waiting for
      // the shelf to notice.)
      globals['__shelfSaveDesign'] = (
        patch: Partial<RoomDesign>,
        bookcaseId?: string,
      ): Promise<RoomDesign> => saveRoomDesign(patch, bookcaseId);
      globals['__shelfSaveBinding'] = (
        bookId: string,
        preset: string | null,
      ): Promise<void> => saveBookBinding(bookId, preset);
      // The READER beside the writer. A probe that drives the studio by
      // clicking has no other way to ask what actually got pinned, and its own
      // `import('/src/data/designPrefs')` can land on a second copy of the
      // module — the same trap `__shelfSaveDesign` exists to avoid, one
      // direction over.
      globals['__shelfBinding'] = (bookId: string): string | null => bookBinding(bookId);
      // The bookcase collection, for switch/leak probes and specimen boards.
      globals['__shelfBookcases'] = {
        list: (): BookcaseState => snapshotBookcases(),
        active: () => activeBookcase(),
        floors: (): number => this.floorCount,
        create: (name?: string) => createBookcase(name === undefined ? {} : { name }),
        rename: (id: string, name: string) => renameBookcase(id, name),
        remove: (id: string, withBooks = false) => deleteBookcase(id, { withBooks }),
        switch: (id: string) => this.openBookcase(id),
        addFloor: (): number => this.addFloor(),
      };
      // Add-a-book affordance probes: where the ghost stands, creating a
      // book through the same path the UI uses, and emptying the case so
      // the first-run invitation can be photographed.
      globals['__shelfAddSpot'] = (): AddSpot | null => this.addSpot;
      globals['__shelfAddBook'] = (
        floor?: number,
      ): Promise<{ book: Book; rect: RectLike } | null> => this.addBook(floor);
      globals['__shelfEmptyLibrary'] = async (): Promise<void> => {
        // This case only — emptying every case would take the harness's other
        // fixtures with it.
        const books = await listBooksByFloorRange(-1, 999, this.caseId);
        for (const book of books) await deleteBook(book.id);
        await this.store.refreshAll();
      };
      globals['__shelfBookMeta'] = (bookId: string): unknown =>
        this.store.findBook(bookId)?.coverMeta ?? null;
      // The book's APPLIED face — the merged style the spine on screen was
      // baked from, room bias and all. `__shelfBookMeta` shows what is stored,
      // which for an undressed book is nothing at all; only this can answer
      // "does it still look like itself over here?".
      globals['__shelfBookStyle'] = (bookId: string): unknown => {
        const book = this.store.findBook(bookId);
        return book === null ? null : { ...this.factory.getStyle(book).style };
      };
      // Reshelving between cases, driven the way the right-click card drives
      // it — appearance guard, floor clamp and refresh included.
      globals['__shelfMoveBookToCase'] = (
        bookId: string,
        bookcaseId: string,
      ): Promise<boolean> => this.moveBookToCase(bookId, bookcaseId);
      globals['__shelfSpineRect'] = (bookId: string): RectLike | null =>
        this.spineRectOf(bookId);
      // Take a book off the shelf the way a click does, for probes that need
      // the held state without hunting for a spine's pixels.
      globals['__shelfPullOut'] = (bookId: string): void => this.pullOut(bookId);
      globals['__shelfVisibleBooks'] = (): Array<{ id: string; title: string }> =>
        [...this.floors.values()].flatMap((fv) =>
          fv.visuals.map((v) => ({ id: v.book.id, title: v.book.title })),
        );
      // Apply a Book Studio override blob straight to a book (screenshot
      // boards need a heavily customized book on the shelf).
      globals['__shelfSetBookStyle'] = async (
        bookId: string,
        overrides: Record<string, unknown> | null,
      ): Promise<void> => {
        await persistBookStyle(
          bookId,
          overrides === null ? null : (overrides as unknown as BookStyle),
        );
        this.factory.invalidate(bookId);
        await this.store.refreshAll();
      };
    }
  }

  /* ------------------------------- bookcases ------------------------------ */

  /** Record the open case's identity and height. No reload. */
  private adoptBookcase(state: BookcaseState): boolean {
    const open = state.list.find((c) => c.id === state.activeId);
    const floors = clampFloorCount(open?.floors ?? DEFAULT_FLOOR_COUNT);
    const changed = floors !== this.floorCount;
    this.caseId = state.activeId;
    this.floorCount = floors;
    if (changed) this.layoutPlinth();
    return changed;
  }

  /**
   * Stand the plinth under the last floor.
   *
   * `height` on a Sprite is scale in disguise, so the mirroring has to come
   * after it or the flip is undone; with a negative Y scale the sprite draws
   * UPWARD from its position, which is why the anchor point is the plinth's
   * bottom edge rather than its top.
   */
  private layoutPlinth(): void {
    const top = caseBottomY(this.floorCount);
    this.plinth.width = SHELF_WIDTH + CROWN_LIP * 2;
    this.plinth.height = BASE_H;
    this.plinth.scale.y = -Math.abs(this.plinth.scale.y);
    this.plinth.position.set(-CROWN_LIP, top + BASE_H);
    this.dirty = true;
  }

  /** The bookcase currently on screen (QA probes, the rail's own bookkeeping). */
  get bookcaseId(): string {
    return this.caseId;
  }

  /** Floors the open bookcase shows (the case's height, not the mounted set). */
  get caseFloors(): number {
    return this.floorCount;
  }

  /**
   * The collection changed: a case was renamed, grown, added, deleted, or a
   * different one was opened.
   *
   * The books change through the SAME path a reload takes: the store drops
   * every cached floor and notifies each one that was loaded, so every mounted
   * FloorView is emptied by `handleFloorData` before a single row of the new
   * case arrives. Nothing is released to the pool and no texture is destroyed
   * here on purpose — the room swap running alongside this (a case carries its
   * own colours) is already re-baking the case parts, and remounting floors
   * into the middle of that hands sprites textures that are about to be freed.
   */
  private async applyBookcase(state: BookcaseState): Promise<void> {
    if (this.destroyed) return;
    const previous = this.caseId;
    const heightChanged = this.adoptBookcase(state);
    if (state.activeId === previous) {
      // Same case, but it may have grown a floor under us.
      if (heightChanged) {
        this.clampCaseBottom();
        this.dirty = true;
      }
      return;
    }

    const gen = ++this.caseGen;
    this.frozen = false;
    this.input.frozen = false;
    this.cancelMove();
    this.clearKbSelection();
    this.clearHover();
    this.killNavTweens();
    this.clearSlotHint();
    // The new case's rows are different sprites; whatever was dimmed in the
    // old one is about to be destroyed, so drop the bookkeeping with it.
    this.dimmed.length = 0;
    this.disposeGhost();
    this.pull = null;

    // Back to the top of the new case: a scroll position from a taller case
    // would otherwise open this one halfway down, or past its bottom.
    const cam = this.camera;
    const bx = xBounds(this.vp, cam.zoom);
    cam.vx = 0;
    cam.vy = 0;
    cam.x = clamp(cam.x, bx.min, bx.max);
    cam.y = Y_MIN;
    this.a11ySignature = '';
    this.addSpotSig = '\0';
    this.dirty = true;

    await this.store.setBookcase(state.activeId);
    if (this.destroyed || gen !== this.caseGen) return;
    this.clampCaseBottom();
    this.dirty = true;
  }

  /**
   * Open a different bookcase. Persists the choice; the subscription above
   * does the actual work, so calling this or `switchBookcase()` from the rail
   * are the same thing.
   */
  async openBookcase(id: string): Promise<void> {
    await switchBookcase(id);
  }

  /**
   * Send a book to ANOTHER bookcase, and let it keep the face it has here.
   *
   * Two things the data layer cannot do for itself, which is why this sits in
   * the world rather than in `moveBookToBookcase`:
   *
   *  1. **The appearance.** A book draws whatever it does not pin for itself
   *     from the ROOM's ramp (`themeSpineDefaults`) — and for almost every
   *     book that is the pigment, because `freshBookStyleOverrides` pins
   *     everything EXCEPT the colour. The same seed therefore comes out a
   *     different colour in a different case, and recognising a spine is how a
   *     reader finds a book. `keepAppearance` is that guard, and the style it
   *     wants is the one THIS room resolved: `factory.getStyle` is the very
   *     object the spine on screen was baked from, so what gets pinned is what
   *     the reader is looking at, not a second guess at it. It is offered for
   *     every book and merged UNDER the book's own entries by the data layer,
   *     so a reader's explicit choice is never overwritten.
   *  2. **The landing floor.** A book on floor 9 sent to an eight-floor case
   *     would stand on a floor that case does not draw: present in the table,
   *     invisible on the shelf. Clamped here because `data/books.ts` must not
   *     import `data/bookcases.ts` (that import already runs the other way, to
   *     cascade-delete a case's books).
   *
   * Returns false when there was nothing to move.
   */
  async moveBookToCase(bookId: string, bookcaseId: string): Promise<boolean> {
    if (this.destroyed || bookcaseId === this.caseId) return false;
    const book = this.store.findBook(bookId);
    if (book === null) return false;
    const target = snapshotBookcases().list.find((c) => c.id === bookcaseId);
    if (target === undefined) return false;

    const keepAppearance = { ...this.factory.getStyle(book).style } as unknown as
      Record<string, unknown>;
    const floor = clamp(book.floor, 0, clampFloorCount(target.floors) - 1);

    // A ghost following the pointer is about to lose the book underneath it.
    this.cancelMove();
    this.clearKbSelection();
    this.clearHover();
    void play('drop-thump');
    try {
      await moveBookToBookcase(bookId, bookcaseId, floor, keepAppearance);
    } catch {
      // DB failure: the refresh below re-syncs whatever state persisted.
    }
    if (this.destroyed) return false;
    // Its style is pinned now, so the baked spine has to be re-derived from
    // the override blob rather than from the room it just left.
    this.factory.invalidate(bookId);
    await this.refreshData();
    return true;
  }

  /* ---------------------------- case geometry ----------------------------- */

  /** Lowest camera Y allowed: the last plank resting on the viewport floor. */
  private maxCameraY(): number {
    return yMaxFor(this.floorCount, this.vp.height, this.camera.zoom);
  }

  /**
   * Hold the camera inside the case's bottom.
   *
   * The camera model itself still says "endless downward" — `yBounds()` is
   * shared with the tests and with a world that had no case height — so the
   * floor of the case is enforced here, where the open bookcase is known.
   * Returns true when the camera had to be moved.
   */
  private clampCaseBottom(): boolean {
    const cam = this.camera;
    const maxY = this.maxCameraY();
    if (cam.y <= maxY) return false;
    cam.y = maxY;
    if (cam.vy > 0) cam.vy = 0;
    return true;
  }

  /* ------------------------------ public API ----------------------------- */

  /**
   * Take a book off the shelf by id — the accessibility mirror, the shelf
   * menu, keyboard Enter. It does NOT open the book: it plays the same
   * pull-out the pointer plays and leaves it held in front of the case, where
   * the overlay asks whether to read it or put it back.
   *
   * The one case that still goes straight to the page is a book with no spine
   * on screen to pull (its floor unmounted, or the far-zoom stamp view). There
   * is nothing to animate there, and a list row that silently did nothing
   * would be worse than an abrupt open.
   */
  pullOut(bookId: string): void {
    if (this.frozen || this.destroyed) return;
    const book = this.store.findBook(bookId);
    if (book === null) return;
    const fv = this.floors.get(book.floor);
    const visual = fv?.visuals.find((v) => v.book.id === bookId);
    if (fv !== undefined && visual !== undefined && this.tier === 0) {
      this.pullOutBook(fv, visual);
      return;
    }
    void touchBookOpened(book.id);
    appState.openBook(book.id);
  }

  /** Screen rect of a book's spine where it stands in the row, or null. */
  spineRectOf(bookId: string): RectLike | null {
    const book = this.store.findBook(bookId);
    return book === null ? null : this.spineScreenRect(book);
  }

  /**
   * The whole bookcase in screen px, cornice lips and plinth included.
   *
   * The overlay uses it as the drop target for dragging a held book back:
   * "into the shelf" has to mean the piece of furniture you can see, not a
   * slot you have to hit.
   */
  caseScreenRect(): RectLike {
    const topLeft = worldToScreen(this.camera, { x: -CROWN_LIP, y: -CROWN_H });
    const bottomRight = worldToScreen(this.camera, {
      x: SHELF_WIDTH + CROWN_LIP,
      y: caseFootY(this.floorCount),
    });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  /**
   * Outline the gap a held book would drop back into.
   *
   * Deliberately the same mark as the move-mode drop preview: "this is where
   * it goes" should look identical wherever the reader meets it, and the gap
   * in the row is the one place on the shelf that answers "back where?".
   */
  showSlotHint(bookId: string, on: boolean): void {
    if (this.destroyed) return;
    if (!on) {
      this.clearSlotHint();
      return;
    }
    const book = this.store.findBook(bookId);
    if (book === null) return;
    const fv = this.floors.get(book.floor);
    const visual = fv?.visuals.find((v) => v.book.id === bookId);
    if (fv === undefined || visual === undefined) return;
    let hint = this.slotHint;
    if (hint === null) {
      hint = makeFrameSprite(this.marks.hoverFrame);
      hint.alpha = 0.95;
      this.fx.addChild(hint);
      this.slotHint = hint;
    }
    const cam = this.camera;
    const screen = worldToScreen(cam, {
      x: visual.centerX,
      y: fv.index * FLOOR_H + visual.baseY,
    });
    hint.position.set(screen.x, screen.y + 6 * cam.zoom);
    hint.width = (visual.w + 10) * cam.zoom;
    hint.height = (visual.height + 8) * cam.zoom;
    this.dirty = true;
  }

  private clearSlotHint(): void {
    if (this.slotHint === null) return;
    this.slotHint.destroy();
    this.slotHint = null;
    this.dirty = true;
  }

  /* --------------------------- zoom pill / keys --------------------------- */

  /** Current zoom as a percent (zoom pill readout). */
  get zoomPercent(): number {
    return Math.round(this.camera.zoom * 100);
  }

  /** Zoom in one step, anchored at the viewport center. */
  zoomIn(): void {
    this.nudgeZoom(KEY_ZOOM_STEP);
  }

  /** Zoom out one step, anchored at the viewport center. */
  zoomOut(): void {
    this.nudgeZoom(-KEY_ZOOM_STEP);
  }

  /** Reset to 100%. */
  zoomReset(): void {
    this.zoomToLog(0);
  }

  /** Fit the whole case width in the viewport. */
  zoomFit(): void {
    const fit = clamp(
      (this.vp.width * 0.94) / (SHELF_WIDTH + X_SLACK * 2),
      minZoomFor(this.vp),
      Math.exp(LOG_MAX_ZOOM),
    );
    this.zoomToLog(Math.log(fit));
  }

  private nudgeZoom(dLog: number): void {
    if (this.frozen || this.destroyed || this.pull !== null) return;
    this.zoomToLog(this.camera.logZoomTarget + dLog);
  }

  /** Retarget the smoothed zoom, anchored at the viewport center. */
  private zoomToLog(logTarget: number): void {
    if (this.frozen || this.destroyed || this.pull !== null) return;
    this.killNavTweens();
    const cam = this.camera;
    const center = { x: this.vp.width / 2, y: this.vp.height / 2 };
    cam.anchor = { screen: center, world: screenToWorld(cam, center) };
    cam.logZoomTarget = clamp(
      logTarget,
      Math.log(minZoomFor(this.vp)),
      LOG_MAX_ZOOM,
    );
    this.dirty = true;
  }

  /** Overlay crossfade started — fade the canvas ghost out (80ms). */
  fadeGhost(): void {
    const ghost = this.ghost;
    const shadow = this.ghostShadow;
    if (ghost === null) return;
    const m = this.hooks.motion();
    this.track(
      gsap.to([ghost, shadow].filter((s): s is Sprite => s !== null), {
        alpha: 0,
        duration: 0.08 * m,
        onUpdate: this.hooks.markDirty,
        onComplete: () => this.disposeGhost(),
      }),
    );
  }

  /**
   * Close flow, step 1: freeze input, hide the spine sprite, and return the
   * book + its current screen rect for the overlay to fly back to. Null when
   * the book is unknown or its floor is nowhere near the viewport.
   */
  prepareReturn(bookId: string): { book: Book; rect: RectLike } | null {
    const book = this.store.findBook(bookId);
    if (book === null) return null;
    const floorTop = book.floor * FLOOR_H;
    const visibleTop = this.camera.y - FLOOR_H;
    const visibleBottom = this.camera.y + this.vp.height / this.camera.zoom + FLOOR_H;
    if (floorTop < visibleTop || floorTop > visibleBottom) return null;
    this.frozen = true;
    this.input.frozen = true;
    const fv = this.floors.get(book.floor);
    const visual = fv?.visuals.find((v) => v.book.id === bookId);
    if (visual !== undefined) visual.sprite.visible = false;
    this.dirty = true;
    return { book, rect: this.spineScreenRect(book) };
  }

  /** Close flow, step 2: canvas ghost settles the book back into its slot. */
  pushInBook(book: Book, onDone: () => void): void {
    void play('book-return');
    this.clearSlotHint();
    // The row lights back up as the book arrives, not after it has landed —
    // the two are one movement.
    this.undimSiblings();
    const fv = this.floors.get(book.floor);
    const visual = fv?.visuals.find((v) => v.book.id === book.id);
    const m = this.hooks.motion();
    const finish = (): void => {
      if (visual !== undefined) visual.sprite.visible = true;
      this.disposeGhost();
      this.frozen = false;
      this.input.frozen = false;
      this.dirty = true;
      onDone();
    };
    if (visual === undefined || fv === undefined || m === 0) {
      finish();
      return;
    }
    const zoom = this.camera.zoom;
    const screen = worldToScreen(this.camera, {
      x: visual.centerX,
      y: fv.index * FLOOR_H + visual.baseY,
    });
    const ghost = new Sprite(visual.sprite.texture);
    ghost.tint = visual.sprite.tint;
    ghost.anchor.set(0.5, 1);
    ghost.width = visual.w * zoom;
    ghost.height = visual.height * zoom;
    // Arrives tipped the other way from how it left, and straightens INTO the
    // lean it lives at, so the book slots back between its neighbours instead
    // of being deposited on top of them.
    ghost.rotation = visual.baseRotation - 0.05;
    ghost.position.set(screen.x, screen.y - 24 * zoom);
    const targetScaleX = ghost.scale.x;
    const targetScaleY = ghost.scale.y;
    ghost.scale.set(targetScaleX * 1.16, targetScaleY * 1.16);
    this.ghost = ghost;
    this.fx.addChild(ghost);
    this.dirty = true;
    const tl = gsap.timeline({ onUpdate: this.hooks.markDirty, onComplete: finish });
    tl
      // Accelerating in: gravity, not a landing gear. `power3.out` had the
      // book crawling the last few pixels, which is what made the return feel
      // like a dialog closing rather than a book going away.
      .to(
        ghost,
        {
          pixi: { scaleX: targetScaleX, scaleY: targetScaleY, y: screen.y },
          duration: 0.3 * m,
          ease: 'power2.in',
        },
        0,
      )
      .to(ghost, { rotation: visual.baseRotation, duration: 0.42 * m, ease: 'power2.out' }, 0)
      // The plank stops it: one frame of compression, then a small rebound.
      .to(
        ghost,
        { pixi: { scaleY: targetScaleY * 0.955 }, duration: 0.06 * m, ease: 'power2.out' },
        0.3 * m,
      )
      .to(
        ghost,
        { pixi: { scaleY: targetScaleY }, duration: 0.2 * m, ease: 'elastic.out(1, 0.5)' },
        0.36 * m,
      );
    this.track(tl);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    sessionCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.input.destroy();
    for (const anim of this.tracked) anim.kill();
    this.tracked.clear();
    this.zoomTween?.kill();
    this.springTween?.kill();
    this.pull = null;
    this.move = null;
    this.movePreview?.destroy();
    this.movePreview = null;
    this.slotHint?.destroy();
    this.slotHint = null;
    this.dimmed.length = 0;
    this.disposeGhost();
    for (const fv of this.floors.values()) fv.destroy();
    this.floors.clear();
    this.pool.drain();
    this.stamps.clear();
    this.store.destroy();
    this.factory.destroy();
    this.envTex.destroy();
    this.marks.destroy();
    this.app.destroy({ removeView: true }, { children: true });
  }

  /* ------------------------------ frame loop ------------------------------ */

  private readonly frame = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = now;

    let moving = false;
    if (!this.frozen && !this.dragging) {
      moving = zoomTick(this.camera, dt, this.reducedMotion) || moving;
      moving = momentumTick(this.camera, dt, this.vp) || moving;
      // The camera's own bounds have to be enforced HERE, after both
      // integrators, rather than only where input arrives — this is what was
      // leaving the bookcase parked against one side of the window.
      //
      // A wheel zoom writes cam.x/cam.y straight from its anchor
      // (`zoomTick` → `applyAnchor`) so the world point under the cursor
      // holds still. Nothing downstream re-clamps: `momentumTick` returns on
      // its first line while the camera is at rest, and `clampCamera` was
      // only ever reached from a pan or a resize. So zooming out with the
      // cursor off to one side moved the camera past `xBounds` — which at
      // that zoom has collapsed to the single centred position — and it
      // stayed there for the rest of the session, through a book and back.
      //
      // The two nav tweens are excluded rather than fought: `springBack` IS
      // the rubber-band release, and clamping the camera under it would
      // delete the animation it exists to play.
      if (
        this.springTween === null &&
        this.zoomTween === null &&
        clampCamera(this.camera, this.vp)
      ) {
        moving = true;
      }
      // Zooming out grows the visible height, which can leave the camera
      // below a case that no longer needs the room — so the bottom is
      // enforced after both integrators, every frame, not just on input.
      if (this.clampCaseBottom()) moving = true;
    }
    if (this.pullTick(dt)) this.dirty = true;
    if (moving) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      this.applyCamera();
      this.sync();
      this.app.render();
    }
    // Cheap (one floor's visuals, a few adds) and it must also react to
    // state that never marks the stage dirty — a freeze during a pull-out,
    // a move mode starting — so it runs outside the render gate.
    this.publishAddSpot();
  };

  /* --------------------------- add-a-book affordance ---------------------- */

  /** The floor the camera is looking at (never negative). */
  get centerFloor(): number {
    const cam = this.camera;
    return Math.max(
      0,
      Math.floor((cam.y + this.vp.height / (2 * cam.zoom)) / FLOOR_H),
    );
  }

  /** The ghost slot as last published (QA probes, menus). */
  get addSpotNow(): AddSpot | null {
    return this.addSpot;
  }

  /** True when the whole case is bare — nothing on any floor, ever. */
  private libraryIsEmpty(): boolean {
    if (this.store.maxFloor > 0) return false;
    const ground = this.store.get(0);
    return ground !== undefined && ground.length === 0;
  }

  /**
   * Where the dashed "add a book" outline stands right now, or null when it
   * has no business being on screen (mid pull-out, whole-floor stamps, the
   * looked-at floor unloaded, or the slot panned out of the viewport).
   */
  private computeAddSpot(): AddSpot | null {
    if (this.destroyed || this.frozen || this.pull !== null || this.move !== null) {
      return null;
    }
    // Tier 2 is the whole-floor stamp view — individual spines are not even
    // drawn there, so a per-book ghost would read as a smudge.
    if (this.tier === 2) return null;

    // Books fill the case top-down, so the ghost stands on the FIRST floor
    // with room whose plank is fully on screen — reading order, not "wherever
    // the camera's midpoint happens to fall" (which put the invitation for a
    // brand-new library one floor below the empty floor 0).
    const cam = this.camera;
    const viewBottom = cam.y + this.vp.height / cam.zoom;
    const firstFloor = Math.max(0, Math.floor(cam.y / FLOOR_H));
    const lastFloor = Math.max(firstFloor, Math.floor(viewBottom / FLOOR_H));
    let floor = -1;
    let x: number | null = null;
    let fallbackFloor = -1;
    let fallbackX: number | null = null;
    for (let index = firstFloor; index <= lastFloor; index++) {
      const fv = this.floors.get(index);
      if (fv === undefined || !fv.loaded) continue;
      const candidate = nextSpotX(fv.visuals, index);
      if (candidate === null) continue; // full floor: try the next one down
      const top = index * FLOOR_H + BOOK_BASELINE - GHOST_H;
      const bottom = index * FLOOR_H + BOOK_BASELINE;
      if (top >= cam.y && bottom <= viewBottom) {
        floor = index;
        x = candidate;
        break;
      }
      if (fallbackX === null) {
        fallbackFloor = index;
        fallbackX = candidate;
      }
    }
    if (x === null) {
      floor = fallbackFloor;
      x = fallbackX;
    }
    if (x === null || floor < 0) return null;

    const topLeft = worldToScreen(cam, {
      x: x - GHOST_W / 2,
      y: floor * FLOOR_H + BOOK_BASELINE - GHOST_H,
    });
    const width = GHOST_W * cam.zoom;
    const height = GHOST_H * cam.zoom;
    if (
      topLeft.x + width < 0 ||
      topLeft.x > this.vp.width ||
      topLeft.y + height < 0 ||
      topLeft.y > this.vp.height
    ) {
      return null;
    }
    return {
      floor,
      x: topLeft.x,
      y: topLeft.y,
      width,
      height,
      firstRun: this.libraryIsEmpty(),
    };
  }

  private publishAddSpot(): void {
    const spot = this.computeAddSpot();
    const sig =
      spot === null
        ? ''
        : `${spot.floor}|${Math.round(spot.x)}|${Math.round(spot.y)}|` +
          `${Math.round(spot.width)}|${Math.round(spot.height)}|${spot.firstRun}`;
    if (sig === this.addSpotSig) return;
    this.addSpotSig = sig;
    this.addSpot = spot;
    this.events.onAddSpotChange?.(spot);
  }

  /**
   * Put a new book on the shelf. Lands on `floor` (default: wherever the
   * ghost slot currently stands), slides in from the right, and hands back
   * its spine rect so the caller can open the inline title editor right on
   * the spine. Null when the world is busy or already torn down.
   */
  async addBook(floor?: number): Promise<{ book: Book; rect: RectLike } | null> {
    if (this.destroyed || this.frozen || this.pull !== null) return null;
    const target = clamp(
      floor ?? this.addSpot?.floor ?? this.centerFloor,
      0,
      this.floorCount - 1,
    );
    // Land past the floor's last book so the spine appears where the ghost
    // was standing rather than in some historical slot gap.
    const existing = this.store.get(target) ?? [];
    const after = existing.reduce((max, b) => Math.max(max, b.slot + 1), 0);
    const slot = await nextFreeSlot(target, after, this.caseId);
    const book = await createBook({
      title: NEW_BOOK_TITLE,
      bookcaseId: this.caseId,
      floor: target,
      slot,
    });
    if (this.destroyed) return null;
    await this.store.refreshAll();
    if (this.destroyed) return null;
    void play('pop-soft');
    this.animateArrival(book);
    this.dirty = true;
    return { book, rect: this.spineScreenRect(book) };
  }

  /** The new spine slides in from the right and settles onto the plank. */
  private animateArrival(book: Book): void {
    const fv = this.floors.get(book.floor);
    const visual = fv?.visuals.find((v) => v.book.id === book.id);
    if (fv === undefined || visual === undefined) return;
    if (this.hooks.motion() === 0) return;
    const sprite = visual.sprite;
    gsap.killTweensOf(sprite);
    const from = {
      x: visual.centerX + 130,
      y: visual.baseY - 30,
      rotation: visual.baseRotation + 0.5,
    };
    const proxy = { t: 0 };
    sprite.alpha = 0;
    sprite.position.set(from.x, from.y);
    sprite.rotation = from.rotation;
    // A plain proxy, not the pixi plugin: PixiPlugin talks rotation in
    // degrees and every other rotation in this file is radians.
    this.track(
      gsap.to(proxy, {
        t: 1,
        duration: 0.66,
        ease: 'back.out(1.4)',
        onUpdate: () => {
          const t = proxy.t;
          sprite.position.set(
            from.x + (visual.centerX - from.x) * t,
            from.y + (visual.baseY - from.y) * t,
          );
          sprite.rotation = from.rotation + (visual.baseRotation - from.rotation) * t;
          sprite.alpha = Math.min(1, t * 2.4);
          this.dirty = true;
        },
        onComplete: () => {
          sprite.position.set(visual.centerX, visual.baseY);
          sprite.rotation = visual.baseRotation;
          sprite.alpha = 1;
          this.dirty = true;
        },
      }),
    );
  }

  /**
   * Extend the case downward by one floor, then fly to it. Returns the new
   * floor's index.
   *
   * This used to be pure camera work — the shelf was endless, so "add a
   * floor" only ever meant "look further down", and it did nothing at all
   * once you were already there. A case is finite now, so the control means
   * what it says: the bookcase grows by a floor and keeps it.
   */
  addFloor(): number {
    const target = this.floorCount;
    // Grow first, locally, so the fly-to below has somewhere to land; the
    // subscription confirms it once the row is written.
    this.floorCount = clampFloorCount(this.floorCount + 1);
    this.layoutPlinth();
    void addBookcaseFloor(this.caseId);
    this.clearKbSelection();
    this.zoomToFloor(Math.min(target, this.floorCount - 1));
    return target;
  }

  /** Springy-lag step for a dragged book ghost. True while a pull is live. */
  private pullTick(dt: number): boolean {
    const pull = this.pull;
    if (pull === null || pull.finishing) return false;
    const m = this.hooks.motion();
    pull.x = m === 0 ? pull.targetX : lerpExp(pull.x, pull.targetX, dt, PULL_FOLLOW_K);
    pull.y = m === 0 ? pull.targetY : lerpExp(pull.y, pull.targetY, dt, PULL_FOLLOW_K);
    pull.ghost.position.set(pull.x, pull.y);
    // Contact shadow stays on the shelf and fades as the book lifts away.
    const away = Math.hypot(pull.x - pull.startX, pull.y - pull.startY);
    pull.shadow.alpha = Math.max(0, 0.28 - away * 0.002);
    // Trail the pointer with a little tilt for life (capped ±0.14 rad), on top
    // of the lean the book still has while it is barely out of the row. The
    // lean bleeds off over the first 130px of travel, so a leaning book comes
    // free of the shelf rather than snapping upright the instant you grab it.
    const lag = pull.targetX - pull.x;
    const stillShelved = Math.max(0, 1 - away / 130);
    pull.ghost.rotation =
      pull.visual.baseRotation * stillShelved + clamp(lag * 0.004, -0.14, 0.14);
    return true;
  }

  /**
   * Tile scale for the wall.
   *
   * This briefly forced ONE copy of the texture to cover the whole viewport
   * (`cover * 1.15`), because the backdrop was then an authored panel that
   * could not tile and any repeat of it showed a seam. A real tile makes that
   * rule actively harmful: it blows the motif up to four or five times its
   * drawn size, so `petite` and `grand` land on screen at the same size and
   * the whole scale axis of the wallpaper vocabulary becomes invisible.
   *
   * So it is back to tracking the camera, with a floor. Below ~0.35 the motif
   * would be finer than the pixels available to draw it.
   */
  private wallTileScale(zoom: number): number {
    return Math.max(zoom, 0.35);
  }

  private applyCamera(): void {
    const { x, y, zoom } = this.camera;
    this.world.position.set(-x * zoom, -y * zoom);
    this.world.scale.set(zoom);
    this.backdrop.tilePosition.set(-x * PARALLAX * zoom, -y * PARALLAX * zoom);
    this.backdrop.tileScale.set(this.wallTileScale(zoom));
    const pct = Math.round(zoom * 100);
    if (pct !== this.lastZoomPct) {
      this.lastZoomPct = pct;
      this.events.onZoomChange?.(pct);
    }
  }

  /* ------------------------------- theming -------------------------------- */

  /**
   * Bake the room's wallpaper and put it on the backdrop.
   *
   * Four details here are each load-bearing, and three of them were the
   * reported "pale seam while panning" in one guise or another:
   *
   *  - the tile carries the wall COLOUR itself (`wallpaperColours().ground` is
   *    `flatScheme().wall`), so the sprite tint goes to white. Leave the old
   *    `wallTint` on and every mark is multiplied by the wall again;
   *  - `addressMode: 'repeat'` makes the GPU wrap the texture, which is the
   *    only way to lay it down that has no clip edge at all;
   *  - `autoGenerateMipmaps` MUST be off. A wrapped non-power-of-two texture
   *    bleeds across the wrap when a mip is sampled, and `tileScale < 1` is
   *    exactly when a mip is sampled — so mipmaps put a soft seam back on the
   *    wall at the zoom levels where you can see the most of it;
   *  - the bake key already carries `flatSchemeTag()`, so the disk cache
   *    cannot serve the athenaeum's damask into the reef.
   */
  private async applyWallpaper(spec: WallpaperSpec, scheme: ColourScheme): Promise<void> {
    if (this.destroyed) return;
    const css = wallpaperTilePx(spec, this.dpr) / this.dpr;
    // The scheme has to be live around `wallpaperTileKey` as well as around
    // the draw: the key is built from `flatSchemeTag()`, and reading it under
    // the outgoing room's colours files the new room's tile under the old
    // room's name.
    const previous = flatScheme();
    setFlatScheme(scheme);
    let key: string;
    try {
      key = wallpaperTileKey(spec, css, this.dpr);
    } finally {
      setFlatScheme(previous);
    }
    if (key === this.wallpaperKey) return;
    const gen = ++this.wallpaperGen;

    let bitmap: ImageBitmap;
    try {
      bitmap = await bakeCached(key, this.dpr, async () => {
        const px = Math.ceil(css * this.dpr);
        const canvas = new OffscreenCanvas(px, px);
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('world: 2d context unavailable for wallpaper');
        ctx.scale(this.dpr, this.dpr);
        // Synchronous set → draw → restore, same contract as every other bake:
        // `flatScheme()` is module state and anything that awaited in between
        // would let a second room repaint this one mid-flight.
        const before = flatScheme();
        setFlatScheme(scheme);
        try {
          renderWallpaperTile(ctx as unknown as Parameters<typeof renderWallpaperTile>[0], css, spec);
        } finally {
          setFlatScheme(before);
        }
        return canvas;
      });
    } catch {
      // A wall that stays the placeholder colour beats a shelf that does not
      // draw. The case parts are baked independently and are unaffected.
      return;
    }
    if (this.destroyed || gen !== this.wallpaperGen) return;

    const old = this.backdrop.texture;
    const source = new ImageSource({ resource: bitmap, autoGenerateMipmaps: false });
    source.addressMode = 'repeat';
    source.scaleMode = 'linear';
    this.backdrop.texture = new Texture({ source });
    this.backdrop.tint = 0xffffff;
    this.backdrop.alpha = 1;
    this.wallpaperKey = key;
    if (old !== Texture.WHITE && !old.destroyed) old.destroy(true);
    this.dirty = true;
  }

  /**
   * Dress the whole world in a library theme (§1). Order matters:
   *  1. snapshot the current frame so the swap crossfades rather than pops;
   *  2. re-spec the spine palette immediately (cheap);
   *  3. kick the case bakes — disk-cached, so a revisited room is instant;
   *  4. when they land, fade the snapshot out.
   */
  /**
   * Fold every room notification that lands in one tick into ONE application.
   *
   * A room lives in two stores — the colours in the bookcase's `room` blob,
   * the carpentry and paper in the studio's settings key — and neither
   * validator would accept the other's fields, so applying a preset is two
   * writes. Both publish synchronously, before their own persist await, so
   * both land in the same microtask drain; without this the world ran
   * `applyLibrary` twice and BAKED the case and wall twice for one click.
   *
   * `libraryGen` already made that safe — the first bake's result is dropped —
   * but safe is not the same as free, and dropping work you have already paid
   * for is the expensive way to be correct.
   *
   * END OF TASK, not `queueMicrotask`. The first cut used a microtask and
   * `shots-now/preset-bakes.mjs` still counted two bakes per click: each save
   * awaits its own store's `load…()` first, those resolve a different number
   * of ticks apart, and the queued call fired in the gap between them. A
   * `setTimeout(0)` runs only once the whole microtask drain is done, so every
   * notification whose write was started in this task is folded in. The cost
   * is a few milliseconds before a bake that takes far longer than that.
   *
   * Still degrades safely: if a notification genuinely arrives in a later task
   * (a cold store whose load has not resolved yet, a bookcase switch) it gets
   * its own application, exactly as before.
   *
   * Deliberately takes no prefs argument. The one snapshot worth applying is
   * the newest, and by the time this runs a captured one may be a write old.
   */
  private queueApplyLibrary(): void {
    if (this.destroyed || this.libraryQueued) return;
    this.libraryQueued = true;
    setTimeout(() => {
      this.libraryQueued = false;
      if (this.destroyed) return;
      void this.applyLibrary(snapshotLibraryPrefs());
    }, 0);
  }

  private async applyLibrary(prefs: LibraryPrefs): Promise<void> {
    if (this.destroyed) return;
    const next = resolveLibrary(prefs);
    // The room is colours AND carpentry AND paper, and only the colours come
    // through `prefs`. Fold the other two into the key here, or a reader who
    // changes nothing but the build gets `roomChanged === false` and the case
    // never re-bakes — which is precisely the shape of "the pickers persist
    // but the shelf does not repaint".
    const design = snapshotRoomDesign();
    this.roomDesign = design;
    const shelf = shelfDesignOf(design);
    const key = `${next.key}|${shelfDesignTag(shelf)}|${wallpaperKeyOf(design.wallpaper)}`;
    // Compare against what is actually ON SCREEN, not just against the last
    // request: the initial snapshot and the "stored prefs loaded" snapshot
    // arrive back to back, and the second one must not cancel the first's
    // bake bookkeeping (which is what left `libraryKey` empty forever).
    const roomChanged = this.appliedLibraryKey !== key;
    const gen = ++this.libraryGen;

    // The palette every flat draw on this thread reads, set BEFORE the factory
    // is told: `setTheme` invalidates every baked spine, and the re-bakes it
    // provokes must already be finding the new room's cloths.
    setFlatScheme(next.scheme);
    // Spine bias reacts instantly; it costs nothing to redo.
    this.factory.setTheme(next.theme, next.scheme.cloths.flat().join('|'));

    if (!roomChanged) {
      this.dirty = true;
      return;
    }

    // Only crossfade when a room is being REPLACED — the first dressing has
    // nothing to fade from.
    if (this.appliedLibraryKey !== '') this.beginThemeFade();

    // The case and the wall are baked together so they land on the same beat:
    // a gothic case against the outgoing room's wall, even for two frames,
    // reads as a glitch rather than as a transition.
    this.roomBakes += 1;
    await Promise.all([
      this.envTex.setTheme({ themeId: next.theme.id, scheme: next.scheme, design: shelf }),
      this.applyWallpaper(design.wallpaper, next.scheme),
    ]);
    if (this.destroyed || gen !== this.libraryGen) return;
    // The old room's case textures are gone; nothing pooled may still hold one.
    this.dropPooledFloors();

    // Re-plate every mounted floor in the new room's plate material.
    for (const [index, fv] of this.floors) {
      fv.setPlaque(this.envTex, this.dpr, floorLabel(index));
      this.rebakeStamp(index, fv);
    }
    this.endThemeFade();
    this.dirty = true;
    this.appliedLibraryKey = key;
    this.events.onLibraryChange?.(key);
  }

  /** The room key currently ON SCREEN (bakes landed). QA + tests read this. */
  get libraryKey(): string {
    return this.appliedLibraryKey;
  }

  /**
   * Grab the current frame into a sprite pinned over the stage. The case art
   * swaps underneath it, then `endThemeFade` dissolves it — so a theme switch
   * never shows a half-dressed bookcase.
   */
  private beginThemeFade(): void {
    if (this.degrade || this.reducedMotion) return;
    try {
      const texture = this.app.renderer.generateTexture({
        target: this.app.stage,
        frame: new PIXI.Rectangle(0, 0, this.vp.width, this.vp.height),
        resolution: 1,
      });
      const snap = new Sprite(texture);
      snap.eventMode = 'none';
      snap.width = this.vp.width;
      snap.height = this.vp.height;
      this.themeFade?.destroy(true);
      this.themeFade = snap;
      this.app.stage.addChild(snap);
    } catch {
      this.themeFade = null; // extraction unsupported — swap without the fade
    }
  }

  private endThemeFade(): void {
    const snap = this.themeFade;
    if (snap === null) return;
    this.themeFade = null;
    this.track(
      gsap.to(snap, {
        alpha: 0,
        duration: 0.42,
        ease: 'power2.out',
        onUpdate: this.hooks.markDirty,
        onComplete: () => {
          snap.destroy(true);
          this.dirty = true;
        },
      }),
    );
  }

  /* ---------------------------- virtualization ---------------------------- */

  private sync(): void {
    const cam = this.camera;
    const raw = computeRange(cam.y, this.vp.height, cam.zoom);
    // `computeRange` still windows an endless shelf (it is pure math shared
    // with the tests); the case's height is applied here. Without this the
    // virtualizer keeps mounting empty floors below the last plank and the
    // bookcase reads as a shelf that forgot to stop.
    const last = Math.min(raw.last, this.floorCount - 1);
    const range: FloorRange = { first: Math.min(raw.first, Math.max(0, last)), last };
    const prevTier = this.tier;
    this.tier = nextLodTier(this.tier, cam.zoom);
    const tierChanged = this.tier !== prevTier;

    const mounted = new Set(this.floors.keys());
    const diff = diffWindow(mounted, range);
    for (const index of diff.remove) {
      const fv = this.floors.get(index);
      if (fv !== undefined) {
        if (this.hovered !== null && this.hovered.fv === fv) this.hovered = null;
        this.floors.delete(index);
        this.pool.release(fv);
      }
    }
    const recentId = this.store.recentBookId();
    for (const index of diff.add) {
      const fv = this.pool.acquire();
      this.floors.set(index, fv);
      fv.populate(
        index,
        this.store.get(index),
        this.envTex,
        this.factory,
        this.tier,
        this.dpr,
        recentId,
      );
      fv.setPlaque(this.envTex, this.dpr, floorLabel(index));
      if (this.tier === 2) fv.showStamp(this.stampFor(index, fv));
      this.requestSpines(fv);
      this.applyKbHalo();
    }

    if (tierChanged) {
      if (this.tier !== 0) this.clearHover();
      for (const [index, fv] of this.floors) {
        fv.applyTier(this.tier, this.tier === 2 ? this.stampFor(index, fv) : null, this.factory);
      }
      if (this.tier === 0) {
        for (const fv of this.floors.values()) this.requestSpines(fv);
      }
      this.updateCursor();
    }

    this.range = range;
    this.store.ensureRange(range.first, range.last);
    this.publishVisibleBooks();
  }

  private stampFor(index: number, fv: FloorView): PIXI.RenderTexture {
    const cached = this.stamps.get(index);
    if (cached !== undefined) return cached;
    return this.stamps.bake(this.app.renderer, index, fv.content);
  }

  private requestSpines(fv: FloorView): void {
    const centerFloor =
      (this.camera.y + this.vp.height / (2 * this.camera.zoom)) / FLOOR_H;
    const priority = Math.abs(fv.index - centerFloor);
    const visuals = fv.visuals;
    for (let i = 0; i < visuals.length; i++) {
      const visual = visuals[i] as BookVisual;
      // Row context, baked into the spine: where this book sits under the
      // raking key (left end shaded, right end lit), and which touching
      // neighbours bleed into its joints. Baking it in is what turns thirty
      // identically-lit rectangles into one shelf sharing a single sun.
      const ctx: SpineRowContext = {
        rowPhase: clamp(visual.centerX / SHELF_WIDTH, 0, 1),
        neighbourLeft: this.bleedNeighbour(visuals, i, -1),
        neighbourRight: this.bleedNeighbour(visuals, i, 1),
      };
      this.factory.request(visual.book, 'lo', priority, ctx);
      if (this.tier === 0) this.factory.request(visual.book, 'hi', priority, ctx);
    }
  }

  /**
   * The touching neighbour's dark tone, for the edge bleed baked into a
   * spine. `null` at the ends of a run or across a cluster gap — a gap
   * breaks the bleed exactly the way it breaks the contact.
   */
  private bleedNeighbour(
    visuals: readonly BookVisual[],
    i: number,
    dir: -1 | 1,
  ): string | null {
    const j = i + dir;
    if (j < 0 || j >= visuals.length) return null;
    const a = visuals[i] as BookVisual;
    const b = visuals[j] as BookVisual;
    const gap =
      dir === 1
        ? b.centerX - b.w / 2 - (a.centerX + a.w / 2)
        : a.centerX - a.w / 2 - (b.centerX + b.w / 2);
    // Leaning neighbours close the visual gap toward the top; tolerate a
    // sliver of daylight before calling it a break.
    if (gap > 14) return null;
    return paletteCss(b.params).bottom;
  }

  /* ----------------------------- data arrivals ---------------------------- */

  private handleFloorData(floorIndices: readonly number[]): void {
    if (this.destroyed) return;
    let touched = false;
    const recentId = this.store.recentBookId();
    for (const index of floorIndices) {
      const fv = this.floors.get(index);
      if (fv === undefined) continue;
      fv.setBooks(this.store.get(index), this.factory, this.dpr, this.envTex, recentId);
      fv.refreshTextures(this.factory);
      this.rebakeStamp(index, fv);
      this.requestSpines(fv);
      touched = true;
    }
    if (touched) {
      this.kbVisual = null;
      this.applyKbHalo();
      this.dirty = true;
      this.publishVisibleBooks();
    }
  }

  private handleTexturesChanged(bookIds: readonly string[]): void {
    if (this.destroyed) return;
    const ids = new Set(bookIds);
    for (const [index, fv] of this.floors) {
      if (!fv.visuals.some((v) => ids.has(v.book.id))) continue;
      fv.refreshTextures(this.factory, ids);
      this.rebakeStamp(index, fv);
      // Evictions fall back to placeholders — queue a re-bake for visibles.
      this.requestSpines(fv);
    }
    this.dirty = true;
  }

  /**
   * Throw away every FloorView sitting in the pool.
   *
   * A pooled view is reset but not stripped: its plank, recess and rail
   * sprites still point at the room's case textures, and `EnvTextures` frees
   * those the moment a new room lands. The view is invisible, so nothing shows
   * — but Pixi still validates it, and a freed texture there takes the whole
   * renderer down on the next frame.
   *
   * It went unnoticed while a room swap left the mounted floors alone
   * (`handleEnvReady` repairs those). Opening a different bookcase returns the
   * camera to the top of the new case, which releases a screenful of floors
   * into the pool on the same beat the room repaints — and then it is every
   * frame. Rebuilding two or three FloorViews is far cheaper than tracking
   * texture ownership across a pool.
   */
  private dropPooledFloors(): void {
    if (this.pool.size === 0) return;
    this.pool.drain();
  }

  private handleEnvReady(): void {
    if (this.destroyed) return;
    this.dropPooledFloors();
    // Show the wall as soon as the case does. Only the PLACEHOLDER is set
    // here: this fires per case part, and re-asserting a tint over a landed
    // wallpaper would flatten it back to a colour four times a room.
    if (this.backdrop.texture === Texture.WHITE) {
      this.backdrop.tint = wallTint(this.envTex.scheme.wall);
    }
    this.backdrop.alpha = 1;
    this.syncCrown();
    this.dirty = true;
    // Floors still need telling that their env textures moved.
    for (const [index, fv] of this.floors) {
      fv.applyEnv(this.envTex, true);
      fv.refreshEnv(this.envTex);
      this.rebakeStamp(index, fv);
    }
    this.dirty = true;
  }

  /**
   * Put the baked cornice on the cornice sprite.
   *
   * This is the only place the crown's art is ever attached, and for a long
   * while nothing did it at all: the sprite was built on `Texture.WHITE` with a
   * placeholder tint, `EnvTextures` baked a cornice complete with its lip line
   * and gilt studs, and the two never met — the top of the case was a plain
   * tinted rectangle no matter how good the bake got.
   *
   * Two details that are easy to get wrong here:
   *  - the tint must return to white, or the art is multiplied by the
   *    placeholder timber and comes out muddy;
   *  - `width`/`height` are scale in disguise, so they have to be re-set after
   *    the texture changes or the sprite takes the raster's own pixel size.
   *
   * `EnvTextures.landPart` notifies its listeners BEFORE freeing the texture it
   * replaced, so swapping here can never leave a destroyed texture on screen.
   */
  private syncCrown(): void {
    const tex = this.envTex.crown;
    if (tex === null || tex.destroyed || this.crown.texture === tex) return;
    this.crown.texture = tex;
    this.crown.tint = 0xffffff;
    this.crown.position.set(-CROWN_LIP, -CROWN_H);
    this.crown.width = SHELF_WIDTH + CROWN_LIP * 2;
    this.crown.height = CROWN_H;
    // The plinth is the cornice upside down — one bake, two ends of the case,
    // and the room's timber reaches both without a second recipe to keep in
    // step with the first.
    this.plinth.texture = tex;
    this.plinth.tint = 0xffffff;
    this.layoutPlinth();
  }

  /**
   * A floor's content changed: refresh its LOD2 stamp. Off-tier, the stale
   * RenderTexture must be detached from the sprite BEFORE the cache destroys
   * it (a destroyed texture on a live sprite crashes the renderer).
   */
  private rebakeStamp(index: number, fv: FloorView): void {
    if (this.tier === 2) {
      this.stamps.invalidate(index);
      fv.showStamp(this.stampFor(index, fv));
    } else {
      fv.detachStamp();
      this.stamps.invalidate(index);
    }
  }

  /* -------------------------------- input --------------------------------- */

  private handleWheelZoom(deltaY: number, cursor: Vec2, sensitivity: number): void {
    if (this.frozen || this.pull !== null) return;
    this.killNavTweens();
    // Viewport-aware min zoom: the case never shrinks below ~30% of the
    // screen width, so max zoom-out is a readable bookcase tower.
    addWheelZoom(
      this.camera,
      deltaY,
      cursor,
      sensitivity,
      Math.log(minZoomFor(this.vp)),
    );
    this.dirty = true;
  }

  private handleWheelPan(dx: number, dy: number): void {
    if (this.frozen) return;
    this.killNavTweens();
    const cam = this.camera;
    cam.vx = 0;
    cam.vy = 0;
    cam.x += dx / cam.zoom;
    cam.y += dy / cam.zoom;
    clampCamera(cam, this.vp);
    this.clampCaseBottom();
    this.dirty = true;
  }

  /** Hit-test at pointerdown; the input layer widens the drag threshold on a hit. */
  private handlePointerDown(cursor: Vec2): boolean {
    this.downHit =
      this.frozen || this.tier !== 0 || this.move !== null
        ? null
        : this.hitBook(cursor);
    return this.downHit !== null;
  }

  private handleDragStart(dx: number, dy: number, onBook: boolean): void {
    if (this.frozen) return;
    if (this.move !== null) return; // move mode: the ghost follows, no pan/pull
    const hit = this.downHit;
    if (onBook && hit !== null && classifyDrag(true, dx, dy) === 'pull') {
      this.beginBookPull(hit.fv, hit.visual);
      return;
    }
    this.killNavTweens();
    this.clearHover();
    this.dragging = true;
    this.camera.vx = 0;
    this.camera.vy = 0;
    this.rawDragX = this.camera.x;
    this.rawDragY = this.camera.y;
    this.updateCursor();
  }

  private handleDragMove(dx: number, dy: number, cursor: Vec2): void {
    if (this.frozen) return;
    if (this.move !== null) {
      if (!this.move.committing) this.updateMove(cursor);
      return;
    }
    const pull = this.pull;
    if (pull !== null) {
      if (pull.finishing) return;
      pull.targetX = cursor.x;
      pull.targetY = cursor.y + (pull.visual.height * this.camera.zoom) / 2;
      const travel = Math.hypot(pull.targetX - pull.startX, pull.targetY - pull.startY);
      if (travel >= PULL_COMPLETE_TRAVEL_PX) this.finishBookPull();
      this.dirty = true;
      return;
    }
    if (!this.dragging) return;
    const cam = this.camera;
    this.rawDragX -= dx / cam.zoom;
    this.rawDragY -= dy / cam.zoom;
    applyDragPosition(cam, this.rawDragX, this.rawDragY, this.vp);
    // The case's bottom gets the same rubber band as its top: dragging past
    // the last plank pulls, and lets go.
    cam.y = rubberBand(cam.y, Y_MIN, this.maxCameraY());
    this.dirty = true;
  }

  private handleDragEnd(samples: readonly DragSample[]): void {
    if (this.move !== null) return; // move mode: only a tap (click) drops
    if (this.pull !== null) {
      if (!this.pull.finishing) this.finishBookPull();
      return;
    }
    this.dragging = false;
    this.updateCursor();
    if (this.frozen) return;
    const cam = this.camera;
    if (isOutOfBounds(cam, this.vp) || cam.y > this.maxCameraY()) {
      this.springBack();
    } else {
      const v = weightedVelocity(samples);
      cam.vx = -v.x / cam.zoom;
      cam.vy = -v.y / cam.zoom;
    }
    this.dirty = true;
  }

  private handleDragCancel(): void {
    if (this.move !== null) return;
    if (this.pull !== null) {
      if (!this.pull.finishing) this.cancelBookPull();
      return;
    }
    this.handleDragEnd([]);
  }

  private handleTap(cursor: Vec2): void {
    if (this.frozen) return;
    if (this.move !== null) {
      void this.commitMove(cursor);
      return;
    }
    const cam = this.camera;
    const wx = cursor.x / cam.zoom + cam.x;
    const wy = cursor.y / cam.zoom + cam.y;
    // Double-tap on a floor plaque (tier 0, where the label is legible)
    // opens the inline label editor.
    const prev = this.lastTap;
    const now = performance.now();
    this.lastTap = { x: cursor.x, y: cursor.y, t: now };
    if (
      prev !== null &&
      now - prev.t < 400 &&
      Math.hypot(cursor.x - prev.x, cursor.y - prev.y) < 24 &&
      this.tier === 0
    ) {
      const floor = Math.floor(wy / FLOOR_H);
      const localY = wy - floor * FLOOR_H;
      if (
        floor >= 0 &&
        Math.abs(wx - PLAQUE_CENTER_X) <= PLAQUE_W / 2 + 10 &&
        Math.abs(localY - PLAQUE_CENTER_Y) <= PLAQUE_H / 2 + 8
      ) {
        this.lastTap = null;
        this.events.onEditFloorPlate?.(floor, this.plaqueScreenRect(floor));
        return;
      }
    }
    this.clearKbSelection();
    if (this.tier === 0) {
      const hit = this.hitBook(cursor);
      if (hit !== null) this.pullOutBook(hit.fv, hit.visual);
      return;
    }
    // Clicking the plinth (or the wall under it) flies to the last floor
    // rather than to a floor the case does not have.
    const floor = Math.floor(wy / FLOOR_H);
    if (floor >= 0) this.zoomToFloor(Math.min(floor, this.floorCount - 1));
  }

  private handleContextMenu(cursor: Vec2): void {
    if (
      this.frozen ||
      this.destroyed ||
      this.tier !== 0 ||
      this.pull !== null ||
      this.move !== null
    ) {
      return;
    }
    const hit = this.hitBook(cursor);
    if (hit !== null) {
      void play('pop-soft');
      this.events.onBookMenu?.(hit.visual.book, { x: cursor.x, y: cursor.y });
      return;
    }
    // Empty plank: the shelf's own menu ("new book here", "add a floor").
    const cam = this.camera;
    const wx = cursor.x / cam.zoom + cam.x;
    const wy = cursor.y / cam.zoom + cam.y;
    // "New book here" has to name a floor that exists — the plinth is not one.
    const floor = Math.floor(wy / FLOOR_H);
    if (floor < 0 || floor >= this.floorCount || wx < 0 || wx > SHELF_WIDTH) return;
    void play('pop-soft');
    this.events.onShelfMenu?.(floor, { x: cursor.x, y: cursor.y });
  }

  /** Screen rect of a floor's plaque (label editor placement). */
  private plaqueScreenRect(floor: number): RectLike {
    const zoom = this.camera.zoom;
    const topLeft = worldToScreen(this.camera, {
      x: PLAQUE_CENTER_X - PLAQUE_W / 2,
      y: floor * FLOOR_H + PLAQUE_CENTER_Y - PLAQUE_H / 2,
    });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: PLAQUE_W * zoom,
      height: PLAQUE_H * zoom,
    };
  }

  private handleHover(cursor: Vec2 | null): void {
    if (this.move !== null) {
      if (cursor !== null && !this.move.committing) this.updateMove(cursor);
      return;
    }
    if (this.frozen || this.dragging || this.pull !== null || this.tier !== 0) {
      this.clearHover();
      return;
    }
    const hit = cursor === null ? null : this.hitBook(cursor);
    const current = this.hovered;
    if (hit === null) {
      this.clearHover();
      return;
    }
    if (current !== null && current.visual === hit.visual) return;
    this.clearHover();
    this.hovered = hit;
    hit.fv.setHover(hit.visual, true);
    this.updateCursor();
  }

  private clearHover(): void {
    const current = this.hovered;
    if (current === null) return;
    this.hovered = null;
    current.fv.setHover(current.visual, false);
    this.updateCursor();
  }

  private hitBook(cursor: Vec2): { fv: FloorView; visual: BookVisual } | null {
    const cam = this.camera;
    const wx = cursor.x / cam.zoom + cam.x;
    const wy = cursor.y / cam.zoom + cam.y;
    const floor = Math.floor(wy / FLOOR_H);
    const fv = this.floors.get(floor);
    if (fv === undefined) return null;
    const localY = wy - floor * FLOOR_H;
    for (const visual of fv.visuals) {
      const halfW = visual.w / 2 + HIT_SLOP;
      if (
        Math.abs(wx - visual.centerX) <= halfW &&
        localY >= BOOK_BASELINE - visual.height - HIT_SLOP &&
        localY <= BOOK_BASELINE + HIT_SLOP
      ) {
        return { fv, visual };
      }
    }
    return null;
  }

  private updateCursor(): void {
    // Books use grab/grabbing (they get dragged out); the shelf pans with the
    // same affordance, so the cursor is grab everywhere and grabbing mid-drag.
    const cursor =
      this.dragging || this.pull !== null || this.move !== null
        ? 'grabbing'
        : 'grab';
    this.app.canvas.style.cursor = cursor;
  }

  private killNavTweens(): void {
    this.zoomTween?.kill();
    this.zoomTween = null;
    this.springTween?.kill();
    this.springTween = null;
    this.camera.anchor = null;
  }

  /* ------------------------- camera choreography -------------------------- */

  private springBack(): void {
    const cam = this.camera;
    cam.vx = 0;
    cam.vy = 0;
    const bx = xBounds(this.vp, cam.zoom);
    const by = yBounds();
    const targetX = clamp(cam.x, bx.min, bx.max);
    const targetY = clamp(cam.y, by.min, Math.min(by.max, this.maxCameraY()));
    const m = this.hooks.motion();
    if (m === 0) {
      cam.x = targetX;
      cam.y = targetY;
      this.dirty = true;
      return;
    }
    this.springTween = gsap.to(cam, {
      x: targetX,
      y: targetY,
      duration: 0.35,
      ease: 'power2.out',
      onUpdate: this.hooks.markDirty,
      onComplete: () => {
        this.springTween = null;
      },
    });
    this.track(this.springTween);
  }

  /** Semantic zoom-in: GSAP tween in log-zoom space to center `floor` at 1×. */
  private zoomToFloor(floor: number): void {
    const cam = this.camera;
    this.killNavTweens();
    cam.vx = 0;
    cam.vy = 0;
    const targetZoom = 1;
    const bx = xBounds(this.vp, targetZoom);
    const targetX = clamp(
      (SHELF_WIDTH - this.vp.width / targetZoom) / 2,
      bx.min,
      bx.max,
    );
    const targetY = clamp(
      floor * FLOOR_H - (this.vp.height / targetZoom - FLOOR_H) / 2,
      Y_MIN,
      // At the destination zoom, not the current one — flying to the last
      // floor of a short case must not overshoot its bottom.
      yMaxFor(this.floorCount, this.vp.height, targetZoom),
    );
    const m = this.hooks.motion();
    const proxy = { lz: Math.log(cam.zoom), x: cam.x, y: cam.y };
    const apply = (): void => {
      cam.zoom = Math.exp(proxy.lz);
      cam.logZoomTarget = proxy.lz;
      cam.x = proxy.x;
      cam.y = proxy.y;
      this.dirty = true;
    };
    if (m === 0) {
      proxy.lz = 0;
      proxy.x = targetX;
      proxy.y = targetY;
      apply();
      return;
    }
    void play('shelf-whoosh');
    this.zoomTween = gsap.to(proxy, {
      lz: Math.log(targetZoom),
      x: targetX,
      y: targetY,
      duration: 0.6,
      ease: 'power3.inOut',
      onUpdate: apply,
      onComplete: () => {
        this.zoomTween = null;
      },
    });
    this.track(this.zoomTween);
  }

  /* ------------------------------- pull-out -------------------------------- */

  private spineScreenRect(book: Book): RectLike {
    const params = this.factory.getParams(book);
    const zoom = this.camera.zoom;
    // The seeded cluster layout owns spine positions; read them from the
    // mounted visual. Raw slot math is only a fallback for unmounted floors.
    const visual = this.floors
      .get(book.floor)
      ?.visuals.find((v) => v.book.id === book.id);
    const centerX = visual !== undefined ? visual.centerX : slotCenterX(book.slot);
    const height = visual !== undefined ? visual.height : SPINE_BASE_HEIGHT + params.hJitter;
    const screen = worldToScreen(this.camera, {
      x: centerX,
      y: book.floor * FLOOR_H + BOOK_BASELINE,
    });
    const w = (visual !== undefined ? visual.w : params.w) * zoom;
    const h = height * zoom;
    return { x: screen.x - w / 2, y: screen.y - h, width: w, height: h };
  }

  /**
   * Screen-space canvas ghost of a spine (fx layer). Hides the shelf sprite;
   * shared by the tap pull-out and the drag-to-pull gesture.
   */
  private spawnGhost(
    fv: FloorView,
    visual: BookVisual,
  ): { ghost: Sprite; shadow: Sprite; screen: Vec2 } {
    const zoom = this.camera.zoom;
    gsap.killTweensOf(visual.sprite);
    visual.sprite.position.set(visual.centerX, visual.baseY);
    visual.sprite.rotation = visual.baseRotation;
    const screen = worldToScreen(this.camera, {
      x: visual.centerX,
      y: fv.index * FLOOR_H + visual.baseY,
    });

    const ghost = new Sprite(visual.sprite.texture);
    ghost.tint = visual.sprite.tint;
    ghost.anchor.set(0.5, 1);
    ghost.width = visual.w * zoom;
    ghost.height = visual.height * zoom;
    ghost.position.set(screen.x, screen.y);
    // Inherit the lean. The ghost used to spawn bolt upright over a leaning
    // spine, so every pull-out began with the book snapping straight one frame
    // before it moved — the single loudest tell that this was two objects.
    // Anchored bottom-center like the shelf sprite, so it pivots on the plank.
    ghost.rotation = visual.baseRotation;

    const shadow = new Sprite(this.marks.contactShadow);
    shadow.anchor.set(0.5);
    shadow.width = visual.w * zoom * 1.6;
    shadow.height = 13 * zoom;
    shadow.position.set(screen.x, screen.y + 4 * zoom);
    shadow.alpha = 0;

    this.fx.addChild(shadow, ghost);
    this.ghost = ghost;
    this.ghostShadow = shadow;
    visual.sprite.visible = false;
    this.dirty = true;
    return { ghost, shadow, screen };
  }

  /** Dim the floor siblings for focus while a book comes out. */
  private dimSiblings(fv: FloorView, visual: BookVisual): void {
    if (this.degrade) return;
    const m = this.hooks.motion();
    for (const other of fv.visuals) {
      if (other === visual) continue;
      // Remember the tint rather than assuming white: a spine still waiting
      // for its bake wears `placeholderTint(params)`, and restoring that one
      // to white would bleach it.
      this.dimmed.push({ sprite: other.sprite, tint: other.sprite.tint });
      this.track(
        gsap.to(other.sprite, {
          pixi: { tint: 0xb9ab97 },
          duration: 0.3 * m,
          onUpdate: this.hooks.markDirty,
        }),
      );
    }
  }

  /**
   * Bring the row back up.
   *
   * There was nothing to undo while a pull-out always ran on into the book
   * view — the shelf unmounted a heartbeat later and took the dim with it.
   * Now that a book can come back, the row it left has to be exactly as it
   * found it, or every book put back leaves a stripe of grey behind it.
   */
  private undimSiblings(): void {
    if (this.dimmed.length === 0) return;
    const m = this.hooks.motion();
    for (const { sprite, tint } of this.dimmed) {
      if (sprite.destroyed) continue;
      if (m === 0) {
        sprite.tint = tint;
        continue;
      }
      this.track(
        gsap.to(sprite, {
          pixi: { tint },
          duration: 0.28 * m,
          onUpdate: this.hooks.markDirty,
        }),
      );
    }
    this.dimmed.length = 0;
    this.dirty = true;
  }

  /**
   * Tap pull-out: the full from-rest choreography.
   *
   * Taking a book off a shelf is not one movement, and animating it as one is
   * exactly what made this read as a sticker being enlarged. It is four:
   *
   *   1. **anticipation** — the book presses back into the row before it comes
   *      out at all. Nine frames, and it is most of the perceived weight.
   *   2. **extraction** — it rises fast and tips its top toward you as the
   *      shear it had while wedged between neighbours unwinds.
   *   3. **drift** — it does not go straight up: it leans toward the middle of
   *      the screen, which is where the DOM overlay is about to carry it, so
   *      the handoff continues a motion instead of starting one.
   *   4. **settle** — the overshoot resolves and the lean swings back through
   *      upright. Nothing in the old version ever came to rest; it just
   *      stopped, and stopping is what cheap animation does.
   */
  private pullOutBook(fv: FloorView, visual: BookVisual): void {
    if (this.frozen) return;
    void play('book-pull');
    // Note what is NOT here: `touchBookOpened`. Taking a book off the shelf is
    // no longer the same act as reading it, so the continue-reading ribbon
    // only moves when the reader actually opens it (BookshelfWorld.handleOpen).
    this.frozen = true;
    this.input.frozen = true;
    this.dragging = false;
    this.camera.vx = 0;
    this.camera.vy = 0;
    this.killNavTweens();
    if (this.hovered !== null) {
      gsap.killTweensOf(this.hovered.visual.sprite);
      this.hovered = null;
    }

    const zoom = this.camera.zoom;
    const m = this.hooks.motion();
    const { ghost, shadow, screen } = this.spawnGhost(fv, visual);
    ghost.skew.x = 0.06;
    const baseScaleX = ghost.scale.x;
    const baseScaleY = ghost.scale.y;
    const shadowScaleX = shadow.scale.x;
    this.dimSiblings(fv, visual);

    const liftedY = screen.y - 46 * zoom;
    // Beat 3: a few px toward the middle of the viewport — enough to bend the
    // path, not enough to look like the book was thrown.
    const liftedX = screen.x + Math.sign(this.vp.width / 2 - screen.x) * 7 * zoom;
    const finish = (): void => {
      const width = visual.w * zoom * 1.35;
      const height = visual.height * zoom * 1.35;
      this.events.onGhostReady(visual.book, {
        x: liftedX - width / 2,
        y: liftedY - height,
        width,
        height,
      });
    };
    if (m === 0) {
      ghost.scale.set(baseScaleX * 1.35, baseScaleY * 1.35);
      ghost.position.set(liftedX, liftedY);
      ghost.rotation = 0;
      ghost.skew.x = 0;
      shadow.alpha = 0.24;
      this.dirty = true;
      finish();
      return;
    }
    // m is 1 from here down — the reduced-motion path returned above — so the
    // beats below are plain seconds and read as the score they are.
    const tl = gsap.timeline({
      onUpdate: this.hooks.markDirty,
      onComplete: finish,
    });
    tl
      // 1. anticipation: sink into the row, squash a hair against the plank.
      .to(
        ghost,
        {
          pixi: { y: screen.y + 3 * zoom, scaleY: baseScaleY * 0.975 },
          duration: 0.09,
          ease: 'power2.in',
        },
        0,
      )
      .to(shadow, { alpha: 0.3, pixi: { scaleX: shadowScaleX * 0.82 }, duration: 0.09 }, 0)
      // 2. extraction: out of the row, overshooting the final size slightly.
      // Position and size are separate tweens so the size can hand over to the
      // settle beat cleanly instead of two tweens writing scale on one frame.
      .to(
        ghost,
        { pixi: { y: liftedY, x: liftedX }, duration: 0.27, ease: 'power3.out' },
        0.09,
      )
      .to(
        ghost,
        {
          pixi: { scaleX: baseScaleX * 1.42, scaleY: baseScaleY * 1.42 },
          duration: 0.22,
          ease: 'power3.out',
        },
        0.09,
      )
      // The lean unwinds into a tip toward the viewer, and the shear it was
      // holding against its neighbours goes past zero before it relaxes.
      .to(ghost, { rotation: -0.045, duration: 0.19, ease: 'power2.out' }, 0.09)
      .to(ghost.skew, { x: -0.018, duration: 0.22, ease: 'power2.out' }, 0.09)
      // The shadow widens and thins out as the book leaves the plank.
      .to(
        shadow,
        {
          alpha: 0.14,
          pixi: { scaleX: shadowScaleX * 1.55, x: liftedX },
          duration: 0.3,
          ease: 'power2.out',
        },
        0.09,
      )
      // 4. settle: size resolves, the tip swings back through upright.
      .to(
        ghost,
        {
          pixi: { scaleX: baseScaleX * 1.35, scaleY: baseScaleY * 1.35 },
          duration: 0.2,
          ease: 'power2.inOut',
        },
        0.31,
      )
      .to(ghost, { rotation: 0, duration: 0.23, ease: 'back.out(1.7)' }, 0.28)
      .to(ghost.skew, { x: 0, duration: 0.2, ease: 'power2.out' }, 0.3);
    this.track(tl);
  }

  /* ----------------------------- drag-to-pull ----------------------------- */

  /** The drag threshold was crossed on a spine: the ghost starts chasing. */
  private beginBookPull(fv: FloorView, visual: BookVisual): void {
    if (this.frozen || this.pull !== null) return;
    void play('book-pull');
    this.killNavTweens();
    this.clearHover();
    this.dragging = false;
    this.camera.vx = 0;
    this.camera.vy = 0;
    const { ghost, shadow, screen } = this.spawnGhost(fv, visual);
    shadow.alpha = 0.3;
    this.pull = {
      fv,
      visual,
      ghost,
      shadow,
      startX: screen.x,
      startY: screen.y,
      targetX: screen.x,
      targetY: screen.y,
      x: screen.x,
      y: screen.y,
      finishing: false,
    };
    this.updateCursor();
    this.dirty = true;
  }

  /** Release (or enough travel): finish the pull-out into the DOM overlay. */
  private finishBookPull(): void {
    const pull = this.pull;
    if (pull === null || pull.finishing) return;
    pull.finishing = true;
    this.frozen = true;
    this.input.frozen = true;
    this.camera.vx = 0;
    this.camera.vy = 0;
    const { ghost, shadow, visual, fv } = pull;
    const zoom = this.camera.zoom;
    const m = this.hooks.motion();
    this.dimSiblings(fv, visual);

    const liftX = pull.x;
    const liftY = pull.y - 26 * zoom;
    const targetScaleX = ghost.scale.x * 1.35;
    const targetScaleY = ghost.scale.y * 1.35;
    const finish = (): void => {
      this.pull = null;
      this.updateCursor();
      const width = visual.w * zoom * 1.35;
      const height = visual.height * zoom * 1.35;
      this.events.onGhostReady(visual.book, {
        x: liftX - width / 2,
        y: liftY - height,
        width,
        height,
      });
    };
    if (m === 0) {
      ghost.scale.set(targetScaleX, targetScaleY);
      ghost.position.set(liftX, liftY);
      ghost.rotation = 0;
      shadow.alpha = 0;
      this.dirty = true;
      finish();
      return;
    }
    // Released mid-drag, so there is no anticipation to play — the hand
    // already did it. What is missing from a release is the arrival: the book
    // overshoots the size it is going to be, then eases back down onto it
    // while the lean it was carried at swings through upright.
    const tl = gsap.timeline({ onUpdate: this.hooks.markDirty, onComplete: finish });
    tl.to(
      ghost,
      {
        pixi: {
          scaleX: targetScaleX * 1.05,
          scaleY: targetScaleY * 1.05,
          x: liftX,
          y: liftY - 5 * zoom,
        },
        duration: 0.22,
        ease: 'power3.out',
      },
      0,
    )
      .to(
        ghost,
        {
          pixi: { scaleX: targetScaleX, scaleY: targetScaleY, y: liftY },
          duration: 0.18,
          ease: 'power2.inOut',
        },
        0.2,
      )
      .to(ghost, { rotation: 0, duration: 0.34, ease: 'back.out(1.5)' }, 0)
      .to(ghost.skew, { x: 0, duration: 0.26, ease: 'power2.out' }, 0)
      .to(shadow, { alpha: 0, duration: 0.24, ease: 'power2.out' }, 0);
    this.track(tl);
  }

  /** Pointer cancelled mid-pull: slide the book back into its slot. */
  private cancelBookPull(): void {
    const pull = this.pull;
    if (pull === null) return;
    this.pull = null;
    this.updateCursor();
    const { ghost, shadow, visual } = pull;
    const m = this.hooks.motion();
    const done = (): void => {
      visual.sprite.visible = true;
      this.disposeGhost();
      this.dirty = true;
    };
    if (m === 0) {
      done();
      return;
    }
    const landedScaleY = ghost.scale.y;
    // Back into the row, and it lands: a book dropped into its slot compresses
    // against the plank for a frame or two. It also goes back to its LEAN, not
    // to upright — the row it belongs to is not a picket fence.
    const tl = gsap.timeline({ onUpdate: this.hooks.markDirty, onComplete: done });
    tl.to(
      ghost,
      { pixi: { x: pull.startX, y: pull.startY }, duration: 0.26, ease: 'power3.inOut' },
      0,
    )
      .to(ghost, { rotation: visual.baseRotation, duration: 0.26, ease: 'power2.inOut' }, 0)
      .to(ghost, { pixi: { scaleY: landedScaleY * 0.965 }, duration: 0.06, ease: 'power2.in' }, 0.24)
      .to(
        ghost,
        { pixi: { scaleY: landedScaleY }, duration: 0.16, ease: 'elastic.out(1, 0.55)' },
        0.3,
      )
      .to(shadow, { alpha: 0, duration: 0.2, ease: 'power2.in' }, 0.1);
    this.track(tl);
  }

  private disposeGhost(): void {
    if (this.ghost !== null) {
      gsap.killTweensOf(this.ghost);
      gsap.killTweensOf(this.ghost.skew);
      this.ghost.destroy();
      this.ghost = null;
    }
    if (this.ghostShadow !== null) {
      gsap.killTweensOf(this.ghostShadow);
      this.ghostShadow.destroy();
      this.ghostShadow = null;
    }
    this.dirty = true;
  }

  /* --------------------- wave-2: move mode & shelf nav --------------------- */

  /**
   * Menu-driven "Move": the spine ghost follows the pointer with a slot drop
   * preview; a click drops the book (slot collisions resolve to the next free
   * slot), Escape cancels. Only available at LOD0 with the floor mounted.
   */
  beginMove(bookId: string): void {
    if (this.frozen || this.destroyed || this.pull !== null || this.move !== null) {
      return;
    }
    const book = this.store.findBook(bookId);
    if (book === null) return;
    const fv = this.floors.get(book.floor);
    const visual = fv?.visuals.find((v) => v.book.id === bookId);
    if (fv === undefined || visual === undefined) return;
    void play('book-pull');
    this.killNavTweens();
    this.clearHover();
    this.clearKbSelection();
    const { ghost, shadow } = this.spawnGhost(fv, visual);
    shadow.alpha = 0.2;
    ghost.alpha = 0.9;
    this.move = {
      visual,
      ghost,
      shadow,
      targetFloor: book.floor,
      targetSlot: book.slot,
      committing: false,
    };
    this.updateCursor();
    this.dirty = true;
  }

  /** True while a move is following the pointer (QA + component guard). */
  get moveActive(): boolean {
    return this.move !== null;
  }

  private updateMove(cursor: Vec2): void {
    const move = this.move;
    if (move === null) return;
    const cam = this.camera;
    const wx = cursor.x / cam.zoom + cam.x;
    const wy = cursor.y / cam.zoom + cam.y;
    // A book cannot be dropped through the bottom of the case.
    move.targetFloor = clamp(Math.floor(wy / FLOOR_H), 0, this.floorCount - 1);
    move.targetSlot = Math.round(
      clamp((wx - SLOT_MARGIN_X - SLOT_W / 2) / SLOT_W, 0, 19),
    );
    move.ghost.position.set(cursor.x, cursor.y + (move.visual.height * cam.zoom) / 2);
    move.shadow.alpha = 0;
    if (this.movePreview === null) {
      // The drop hint is the hover mark, standing empty at the target slot: a
      // gilt-and-ink outline the size of the book about to land in it. It was
      // an additive blurred pool — the last lighting model in the shelf, and
      // the one thing left that read as a different app leaking through. An
      // outline also says something the pool could not, which is *how big* the
      // gap has to be.
      const p = makeFrameSprite(this.marks.hoverFrame);
      p.alpha = 0.95;
      this.fx.addChild(p);
      this.movePreview = p;
    }
    const screen = worldToScreen(cam, {
      x: slotCenterX(move.targetSlot),
      y: move.targetFloor * FLOOR_H + BOOK_BASELINE,
    });
    this.movePreview.position.set(screen.x, screen.y + 6 * cam.zoom);
    // A hair proud of the book on every side, so the outline frames the slot
    // rather than tracing the spine that is about to fill it.
    this.movePreview.width = (move.visual.w + 10) * cam.zoom;
    this.movePreview.height = (move.visual.height + 8) * cam.zoom;
    this.dirty = true;
  }

  private async commitMove(cursor: Vec2): Promise<void> {
    const move = this.move;
    if (move === null || move.committing) return;
    this.updateMove(cursor);
    move.committing = true;
    void play('drop-thump');
    try {
      const slot = await nextFreeSlot(move.targetFloor, move.targetSlot, this.caseId);
      await moveBook(move.visual.book.id, move.targetFloor, slot);
    } catch {
      // DB failure: the refresh below re-syncs whatever state persisted.
    }
    if (this.destroyed) return;
    move.visual.sprite.visible = true;
    this.endMove();
    await this.refreshData();
  }

  private cancelMove(): void {
    const move = this.move;
    if (move === null) return;
    move.visual.sprite.visible = true;
    this.endMove();
  }

  private endMove(): void {
    this.move = null;
    if (this.movePreview !== null) {
      this.movePreview.destroy();
      this.movePreview = null;
    }
    this.disposeGhost();
    this.updateCursor();
    this.dirty = true;
  }

  /** Re-fetch every loaded floor from the DB (after shelf-UI mutations). */
  async refreshData(): Promise<void> {
    await this.store.refreshAll();
  }

  /** Drop baked spine textures after a rename (title is baked into hi-res). */
  invalidateSpine(bookId: string): void {
    this.factory.invalidate(bookId);
  }

  /**
   * Keyboard shelf nav (wave-2 item 8): arrows move a selection halo between
   * books, Enter pulls the selected book out, Home jumps to floor 0, Escape
   * clears (or cancels a live move). Returns true when the key was consumed.
   */
  private handleNavKey(key: string): boolean {
    if (key === 'Escape') {
      if (this.move !== null) {
        this.cancelMove();
        return true;
      }
      if (this.kbSel !== null) {
        this.clearKbSelection();
        return true;
      }
      return false;
    }
    if (this.tier !== 0 || this.pull !== null || this.move !== null) return false;
    if (key === 'Enter') {
      const kv = this.kbVisual;
      if (kv === null) return false;
      this.clearKbSelection();
      this.pullOutBook(kv.fv, kv.visual);
      return true;
    }
    const isArrow =
      key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
    if (!isArrow && key !== 'Home') return false;

    const sel = this.kbSel;
    if (key === 'Home') {
      this.kbSel = { floor: 0, index: 0 };
    } else if (sel === null) {
      // First arrow press: select on the floor closest to the view center.
      const centerFloor =
        (this.camera.y + this.vp.height / (2 * this.camera.zoom)) / FLOOR_H;
      let best: number | null = null;
      for (const [index, fv] of this.floors) {
        if (fv.visuals.length === 0) continue;
        if (best === null || Math.abs(index - centerFloor) < Math.abs(best - centerFloor)) {
          best = index;
        }
      }
      if (best === null) return true;
      this.kbSel = { floor: best, index: 0 };
    } else {
      let { floor, index } = sel;
      if (key === 'ArrowLeft') index -= 1;
      else if (key === 'ArrowRight') index += 1;
      else if (key === 'ArrowUp') floor -= 1;
      else floor += 1;
      floor = clamp(floor, 0, this.floorCount - 1);
      if (index < 0) index = 0;
      this.kbSel = { floor, index };
    }
    this.ensureSelVisible();
    this.applyKbHalo();
    return true;
  }

  /** Current keyboard selection (QA probes). */
  get keyboardSelection(): { floor: number; index: number } | null {
    return this.kbSel;
  }

  /** Scroll the camera so the selected floor is fully visible. */
  private ensureSelVisible(): void {
    const sel = this.kbSel;
    if (sel === null) return;
    const cam = this.camera;
    const floorTop = sel.floor * FLOOR_H;
    const viewH = this.vp.height / cam.zoom;
    if (floorTop < cam.y || floorTop + FLOOR_H > cam.y + viewH) {
      this.killNavTweens();
      cam.vx = 0;
      cam.vy = 0;
      cam.y = clamp(
        floorTop - (viewH - FLOOR_H) / 2,
        Y_MIN,
        this.maxCameraY(),
      );
      this.dirty = true;
    }
  }

  /** (Re)apply the selection halo — also called when floors (re)mount. */
  private applyKbHalo(): void {
    const sel = this.kbSel;
    if (sel === null) return;
    const fv = this.floors.get(sel.floor);
    if (fv === undefined || fv.visuals.length === 0) return;
    sel.index = Math.min(sel.index, fv.visuals.length - 1);
    const visual = fv.visuals[sel.index] as BookVisual;
    const current = this.kbVisual;
    if (current !== null && current.visual === visual) return;
    if (current !== null && current.fv !== fv) {
      current.fv.setSelected(null, this.envTex, this.dpr);
    }
    this.kbVisual = { fv, visual };
    fv.setSelected(visual, this.envTex, this.dpr);
    this.dirty = true;
  }

  private clearKbSelection(): void {
    const current = this.kbVisual;
    if (current !== null) current.fv.setSelected(null, this.envTex, this.dpr);
    this.kbVisual = null;
    this.kbSel = null;
    this.dirty = true;
  }

  /* ------------------------------- utilities ------------------------------ */

  private handleResize(): void {
    if (this.destroyed) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.vp.width = w;
    this.vp.height = h;
    this.app.renderer.resize(w, h);
    this.backdrop.width = w;
    this.backdrop.height = h;
    clampZoomBounds(this.camera, this.vp);
    if (!this.dragging) {
      clampCamera(this.camera, this.vp);
      // A taller window shows more of the case, so its bottom moves up.
      this.clampCaseBottom();
    }
    this.dirty = true;
  }

  private publishVisibleBooks(): void {
    const books: VisibleBook[] = [];
    for (let i = this.range.first; i <= this.range.last; i++) {
      const list = this.store.get(i);
      if (list === undefined) continue;
      for (const book of list) {
        books.push({ id: book.id, title: book.title, floor: book.floor });
      }
    }
    // Titles are part of the signature so renames re-render the mirror.
    const signature = books.map((b) => `${b.id}:${b.title}`).join('|');
    if (signature === this.a11ySignature) return;
    this.a11ySignature = signature;
    this.events.onVisibleBooksChange(books);
  }

  private track<T extends gsap.core.Animation>(anim: T): T {
    // Opportunistic pruning keeps the set small without touching callbacks.
    for (const existing of this.tracked) {
      if (!existing.isActive() && existing.progress() === 1) this.tracked.delete(existing);
    }
    this.tracked.add(anim);
    return anim;
  }
}
