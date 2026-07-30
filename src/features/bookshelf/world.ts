/**
 * features/bookshelf/world.ts — the PixiJS shelf world controller.
 *
 * Owns the Application (webgl, autoStart:false), the render-on-demand loop
 * (dirty flag; idle frames cost nothing beyond the mote ticker), the camera,
 * virtualization, LOD switching, the pull-out choreography, and every
 * non-reactive Pixi object. Solid components talk to it through the
 * WorldEvents callbacks and its small public API; Solid never diffs Pixi.
 */

import gsap from 'gsap';
import { PixiPlugin } from 'gsap/PixiPlugin';
import * as PIXI from 'pixi.js';
import {
  Application,
  Container,
  Sprite,
  Texture,
  TilingSprite,
} from 'pixi.js';
import { clamp } from '../../art/noise';
import { SPINE_BASE_HEIGHT } from '../../art/spines';
import type { BookStyle } from '../../art/bookStyle';
import type { LightPool } from '../../art/themes';
import { play } from '../../sound/engine';
import { appState } from '../../state/app';
import {
  createBook,
  deleteBook,
  listBooksByFloorRange,
  moveBook,
  nextFreeSlot,
  touchBookOpened,
} from '../../data/books';
import {
  save as saveSettings,
  settings,
  subscribe as subscribeSettings,
} from '../../data/settings';
import type { Book } from '../../data/types';
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
  BOOK_BASELINE,
  CASE_SHADE_W,
  CROWN_H,
  CROWN_LIP,
  FLOOR_H,
  HIT_SLOP,
  SHELF_WIDTH,
  SLOT_MARGIN_X,
  SLOT_W,
  slotCenterX,
  X_SLACK,
  Y_MIN,
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
import { planFloorFlora, type FloorFloraPlan } from './floraPlan';
import { bakeFloraTexture, clearFloraTextures } from './floraTextures';
import {
  loadLibraryPrefs,
  resolveLibrary,
  saveLibraryPrefs as saveLibraryPrefsFn,
  snapshotLibraryPrefs,
  subscribeLibraryPrefs,
  warmthTint,
  type LibraryPrefs,
  type ResolvedLibrary,
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
import { DustMotes, makeGlowTexture } from './motes';
import { SpineFactory } from './spineFactory';
import {
  EnvTextures,
  PLACEHOLDER_TINTS,
  PLAQUE_H,
  PLAQUE_W,
  TRASH_DRAWER_H,
  TRASH_DRAWER_W,
} from './textures';
import { computeRange, diffWindow, Pool, type FloorRange } from './virtualizer';

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
  /** The trash drawer under the last floor was clicked. */
  onOpenTrash?(): void;
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
const BACKDROP_ALPHA = 0.45;
const WALLPAPER_ALPHA = 0.6;

/** Mid tone of the baked trash-drawer art — the base `ratioTint` divides out. */
const TRASH_ART_TONE = 0xddd0be;

/** Springy-lag constant for the dragged-book ghost (lerpExp k). */
const PULL_FOLLOW_K = 11;

/** '#rrggbb' (or 'rgba(...)') → 0xRRGGBB, defaulting to warm white. */
export function hexToInt(colour: string, fallback = 0xfff2d8): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(colour.trim());
  if (m !== null) return Number.parseInt(m[1] as string, 16);
  const short = /^#?([0-9a-f]{3})$/i.exec(colour.trim());
  if (short !== null) {
    const [r, g, b] = (short[1] as string).split('') as [string, string, string];
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }
  const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(colour);
  if (rgb !== null) {
    return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
  }
  return fallback;
}

/**
 * Renormalizing tint: what to multiply art whose average tone is `base` by so
 * it lands on `target`. Lets one baked brown sprite (the trash drawer) wear
 * every room's wood without re-baking.
 */
export function ratioTint(target: number, base: number): number {
  const ch = (shift: number): number => {
    const t = (target >> shift) & 0xff;
    const b = (base >> shift) & 0xff;
    return Math.max(0, Math.min(255, Math.round((t / Math.max(1, b)) * 255)));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Multiply two 0xRRGGBB tints channel-wise (Pixi's own tint semantics). */
export function mixTint(a: number, b: number): number {
  const r = (((a >> 16) & 0xff) * ((b >> 16) & 0xff)) / 255;
  const g = (((a >> 8) & 0xff) * ((b >> 8) & 0xff)) / 255;
  const bl = ((a & 0xff) * (b & 0xff)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

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

  /** The room currently applied (null until the first prefs snapshot). */
  private library: ResolvedLibrary | null = null;
  /** Bumped per theme application so stale async flora bakes drop. */
  private libraryGen = 0;
  /** The room key whose art is actually on screen. */
  private appliedLibraryKey = '';
  /** Full-viewport snapshot held over the stage during a theme crossfade. */
  private themeFade: Sprite | null = null;

  private readonly backdrop: TilingSprite;
  /** Damask wallpaper pattern tiled over the paper (parallax with backdrop). */
  private wallpaper: TilingSprite | null = null;
  /** Screen-space wall lighting between backdrop and world. */
  private readonly wallFx = new Container();
  /**
   * The theme's lamp pools, ABOVE the case (additive) so light actually falls
   * on the wood and the books rather than only on the wall behind them.
   */
  private readonly lightFx = new Container();
  /** Warm falloff pooled behind the case (tracks the case each frame). */
  private caseGlow: Sprite | null = null;
  /** Whole-room colour cast from the theme's LightSpec.ambient. */
  private ambientWash: Sprite | null = null;
  /** 2–3 large lamp-glow pools that drift very slowly (baked radial glows). */
  private readonly lightPools: Sprite[] = [];
  private readonly world = new Container();
  private readonly fx = new Container();
  private readonly motes: DustMotes;
  private readonly glowTexture: Texture;
  /** Crown/header board capping the case above floor 0. */
  private readonly crown: Sprite;
  private crownWood = false;

  private readonly floors = new Map<number, FloorView>();
  private readonly pool: Pool<FloorView>;
  private tier: LodTier;
  private range: FloorRange = { first: 0, last: -1 };

  private dirty = true;
  private raf = 0;
  private lastTime = 0;
  private elapsed = 0;
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
  private movePreview: Sprite | null = null;
  /** Keyboard shelf-nav selection (floor + index into the floor's visuals). */
  private kbSel: { floor: number; index: number } | null = null;
  private kbVisual: { fv: FloorView; visual: BookVisual } | null = null;
  /** Trash drawer front under the last occupied floor (world space). */
  private trashSprite: Sprite | null = null;
  /** Previous tap (plaque double-click detection). */
  private lastTap: { x: number; y: number; t: number } | null = null;
  /** The ghost add-a-book slot last published to the overlay. */
  private addSpot: AddSpot | null = null;
  /** Change signature for the ghost slot (publish only on a real move). */
  private addSpotSig = ' ';

  private readonly hooks: WorldHooks = {
    markDirty: () => {
      this.dirty = true;
    },
    motion: () => (this.reducedMotion ? 0 : 1),
    track: (anim) => this.track(anim),
    glow: () => this.glowTexture,
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
    this.glowTexture = makeGlowTexture();
    this.motes = new DustMotes(this.glowTexture);
    this.fx.addChild(this.motes.container);

    // Wall lighting: a broad warm falloff hugging the case plus 2–3 large
    // baked radial lamp-glow pools (additive, slow drift when motion is on).
    this.wallFx.eventMode = 'none';
    // Whole-room colour cast (theme.light.ambient) — a flat wash under the
    // pools, so a night study reads blue-cool and a cottage reads honey.
    const ambient = new Sprite(Texture.WHITE);
    ambient.eventMode = 'none';
    ambient.alpha = 0;
    this.ambientWash = ambient;
    this.wallFx.addChild(ambient);
    const caseGlow = new Sprite(this.glowTexture);
    caseGlow.anchor.set(0.5);
    caseGlow.tint = 0xffe3ae;
    caseGlow.alpha = 0.5;
    this.caseGlow = caseGlow;
    this.wallFx.addChild(caseGlow);
    const poolSpecs = [
      { tint: 0xffd98f, alpha: 0.26, fx: 0.18, fy: 0.16, r: 0.62 },
      { tint: 0xffe7b0, alpha: 0.2, fx: 0.86, fy: 0.4, r: 0.55 },
      { tint: 0xffd27a, alpha: 0.16, fx: 0.5, fy: 0.94, r: 0.7 },
    ];
    this.lightFx.eventMode = 'none';
    for (const spec of poolSpecs) {
      const pool = new Sprite(this.glowTexture);
      pool.anchor.set(0.5);
      pool.blendMode = 'add';
      pool.tint = spec.tint;
      pool.alpha = spec.alpha;
      (pool as Sprite & { __spec?: typeof spec }).__spec = spec;
      this.lightPools.push(pool);
      this.lightFx.addChild(pool);
    }
    this.layoutWallLighting();

    // The case crown above floor 0 (flat placeholder until the bake lands)
    // and the soft wall shading around the case top — all world-space,
    // added before any FloorView so floors always render above them. The
    // shade texture is a translucent warm gradient (normal blending, see
    // getWallShade); side pieces beside the crown connect the per-floor AO
    // strips so the halo reads as one continuous shadow.
    const shadeTex = this.envTex.getWallShade();
    const topShade = new Sprite(shadeTex);
    topShade.rotation = -Math.PI / 2;
    topShade.position.set(-CROWN_LIP, -CROWN_H);
    topShade.width = 44; // vertical extent after rotation
    topShade.height = SHELF_WIDTH + CROWN_LIP * 2;
    this.world.addChild(topShade);
    for (const side of [-1, 1] as const) {
      const s = new Sprite(shadeTex);
      s.width = CASE_SHADE_W - CROWN_LIP;
      s.height = CROWN_H;
      if (side === -1) {
        s.scale.x = -s.scale.x;
        s.position.set(-CROWN_LIP, -CROWN_H);
      } else {
        s.position.set(SHELF_WIDTH + CROWN_LIP, -CROWN_H);
      }
      this.world.addChild(s);
    }
    this.crown = new Sprite(Texture.WHITE);
    this.crown.tint = PLACEHOLDER_TINTS.crown;
    this.crown.position.set(-CROWN_LIP, -CROWN_H);
    this.crown.width = SHELF_WIDTH + CROWN_LIP * 2;
    this.crown.height = CROWN_H;
    this.world.addChild(this.crown);

    app.stage.addChild(this.backdrop, this.wallFx, this.world, this.lightFx, this.fx);
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
    // A restored zoom may undershoot the viewport-aware floor (window grew).
    clampZoomBounds(this.camera, this.vp);
    this.tier = nextLodTier(0, this.camera.zoom);

    this.motes.setEnabled(!degrade && !this.reducedMotion);
    this.motes.resize(this.vp.width, this.vp.height);

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
      // Wave-2 shelf nav (arrows/Enter/Home) + move-mode Escape.
      if (!editing && this.handleNavKey(e.key)) {
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
        this.motes.setEnabled(!this.degrade && !reduced);
        this.dirty = true;
      }),
      // Wave-2: live-apply wood stain / wallpaper / sort / wheel mode on save.
      subscribeSettings((s) => {
        this.envTex.setStain(s.shelfWoodStain);
        this.envTex.setWallpaper(s.wallpaperPattern);
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

    this.envTex.load(
      this.dpr,
      this.degrade,
      settings.shelfWoodStain,
      settings.wallpaperPattern,
    );

    // The library theme (docs/design/library-themes.md). The first snapshot
    // arrives synchronously with the defaults, then again once the stored
    // prefs load — and after every studio edit.
    this.unsubs.push(
      subscribeLibraryPrefs((prefs) => {
        void this.applyLibrary(prefs);
      }),
    );
    void loadLibraryPrefs();

    this.ready = this.store.init().then(() => {
      if (this.destroyed) return;
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
        let slot = await nextFreeSlot(floor, 0);
        for (const title of titles) {
          await createBook({ title, floor, slot });
          slot += 1;
        }
        await this.store.refreshAll();
      };
      // Add-a-book affordance probes: where the ghost stands, creating a
      // book through the same path the UI uses, and emptying the case so
      // the first-run invitation can be photographed.
      globals['__shelfAddSpot'] = (): AddSpot | null => this.addSpot;
      globals['__shelfAddBook'] = (
        floor?: number,
      ): Promise<{ book: Book; rect: RectLike } | null> => this.addBook(floor);
      globals['__shelfEmptyLibrary'] = async (): Promise<void> => {
        const books = await listBooksByFloorRange(-1, 64);
        for (const book of books) await deleteBook(book.id);
        await this.store.refreshAll();
      };
      globals['__shelfBookMeta'] = (bookId: string): unknown =>
        this.store.findBook(bookId)?.coverMeta ?? null;
      globals['__shelfSpineRect'] = (bookId: string): RectLike | null => {
        const book = this.store.findBook(bookId);
        return book === null ? null : this.spineScreenRect(book);
      };
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

  /* ------------------------------ public API ----------------------------- */

  /** Open a book from the accessibility mirror (Enter/click on a list row). */
  openFromList(bookId: string): void {
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
    ghost.rotation = visual.baseRotation;
    ghost.position.set(screen.x, screen.y - 20 * zoom);
    const targetScaleX = ghost.scale.x;
    const targetScaleY = ghost.scale.y;
    ghost.scale.set(targetScaleX * 1.15, targetScaleY * 1.15);
    this.ghost = ghost;
    this.fx.addChild(ghost);
    this.dirty = true;
    this.track(
      gsap.to(ghost, {
        pixi: { scaleX: targetScaleX, scaleY: targetScaleY, y: screen.y },
        duration: 0.4 * m,
        ease: 'power3.out',
        onUpdate: this.hooks.markDirty,
        onComplete: finish,
      }),
    );
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
    this.trashSprite?.destroy();
    this.trashSprite = null;
    this.disposeGhost();
    for (const fv of this.floors.values()) fv.destroy();
    this.floors.clear();
    this.pool.drain();
    this.motes.destroy();
    this.stamps.clear();
    this.store.destroy();
    this.factory.destroy();
    this.envTex.destroy();
    this.glowTexture.destroy(true);
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
    }
    if (this.motes.enabled && !document.hidden) {
      this.elapsed += dt;
      this.motes.update(dt);
      this.driftLightPools();
      this.dirty = true;
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
    const target = Math.max(0, floor ?? this.addSpot?.floor ?? this.centerFloor);
    // Land past the floor's last book so the spine appears where the ghost
    // was standing rather than in some historical slot gap.
    const existing = this.store.get(target) ?? [];
    const after = existing.reduce((max, b) => Math.max(max, b.slot + 1), 0);
    const slot = await nextFreeSlot(target, after);
    const book = await createBook({ title: NEW_BOOK_TITLE, floor: target, slot });
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
   * Extend the case downward: fly to the first floor past the last book,
   * where the ghost slot is waiting. Returns the floor index.
   */
  addFloor(): number {
    const target = this.store.maxFloor + 1;
    this.clearKbSelection();
    this.zoomToFloor(target);
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
    // Trail the pointer with a little tilt for life (capped ±0.14 rad).
    const lag = pull.targetX - pull.x;
    pull.ghost.rotation = clamp(lag * 0.004, -0.14, 0.14);
    // Contact shadow stays on the shelf and fades as the book lifts away.
    const away = Math.hypot(pull.x - pull.startX, pull.y - pull.startY);
    pull.shadow.alpha = Math.max(0, 0.3 - away * 0.002);
    return true;
  }

  /** Very slow sinusoidal drift of the wall light pools (motion mode only). */
  private driftLightPools(): void {
    const t = this.elapsed;
    for (let i = 0; i < this.lightPools.length; i++) {
      const pool = this.lightPools[i] as Sprite & {
        __spec?: { fx: number; fy: number };
        __base?: { x: number; y: number };
      };
      const base = pool.__base;
      if (base === undefined) continue;
      const amp = 18 + i * 7;
      pool.position.set(
        base.x + Math.sin(t * 0.07 + i * 2.1) * amp,
        base.y + Math.cos(t * 0.055 + i * 1.3) * amp * 0.7,
      );
    }
  }

  private applyCamera(): void {
    const { x, y, zoom } = this.camera;
    this.world.position.set(-x * zoom, -y * zoom);
    this.world.scale.set(zoom);
    this.backdrop.tilePosition.set(-x * PARALLAX * zoom, -y * PARALLAX * zoom);
    this.backdrop.tileScale.set(Math.max(zoom, 0.35));
    if (this.wallpaper !== null) {
      this.wallpaper.tilePosition.set(-x * PARALLAX * zoom, -y * PARALLAX * zoom);
      this.wallpaper.tileScale.set(Math.max(zoom, 0.35));
    }
    // The warm falloff tracks the case: centered on it, wider than it, so
    // the wall dims away from the shelf like lamplight pooling behind it.
    const glow = this.caseGlow;
    if (glow !== null) {
      const caseCenterX = (SHELF_WIDTH / 2 - x) * zoom;
      glow.position.set(caseCenterX, this.vp.height * 0.42);
      glow.width = Math.max((SHELF_WIDTH + 900) * zoom, this.vp.width * 0.9);
      glow.height = this.vp.height * 1.7;
    }
    const pct = Math.round(zoom * 100);
    if (pct !== this.lastZoomPct) {
      this.lastZoomPct = pct;
      this.events.onZoomChange?.(pct);
    }
  }

  /* ------------------------------- theming -------------------------------- */

  /**
   * Dress the whole world in a library theme (§1). Order matters:
   *  1. snapshot the current frame so the swap crossfades rather than pops;
   *  2. re-spec the light rig, motes and spine bias immediately (cheap);
   *  3. kick the case bakes — disk-cached, so a revisited room is instant;
   *  4. when they land, fade the snapshot out and replant the flora.
   */
  private async applyLibrary(prefs: LibraryPrefs): Promise<void> {
    if (this.destroyed) return;
    const next = resolveLibrary(prefs);
    const prev = this.library;
    // Compare against what is actually ON SCREEN, not just against the last
    // request: the initial snapshot and the "stored prefs loaded" snapshot
    // arrive back to back, and the second one must not cancel the first's
    // bake bookkeeping (which is what left `libraryKey` empty forever).
    const roomChanged = this.appliedLibraryKey !== next.key;
    const densityChanged = prev !== null && prev.prefs.floraDensity !== prefs.floraDensity;
    this.library = next;
    const gen = ++this.libraryGen;

    // Light + motes + spine bias react instantly; they cost nothing to redo.
    this.applyLightRig(next);
    if (this.trashSprite !== null) {
      this.trashSprite.tint = ratioTint(hexToInt(next.theme.wood.light), TRASH_ART_TONE);
    }
    this.factory.setTheme(next.theme);

    if (!roomChanged) {
      if (densityChanged) void this.refreshFlora(gen);
      this.dirty = true;
      return;
    }

    // Only crossfade when a room is being REPLACED — the first dressing has
    // nothing to fade from.
    if (this.appliedLibraryKey !== '') this.beginThemeFade();
    clearFloraTextures();
    for (const fv of this.floors.values()) fv.clearFlora();

    await this.envTex.setTheme({
      themeId: next.theme.id,
      wallpaper: next.wallpaper,
      backdrop: next.backdrop,
    });
    if (this.destroyed || gen !== this.libraryGen) return;

    // Re-plate every mounted floor in the new room's plate material.
    for (const [index, fv] of this.floors) {
      fv.setPlaque(this.envTex, this.dpr, floorLabel(index));
      this.rebakeStamp(index, fv);
    }
    this.endThemeFade();
    this.dirty = true;
    this.appliedLibraryKey = next.key;
    this.events.onLibraryChange?.(next.key);
    void this.refreshFlora(gen);
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

  /**
   * Re-spec the wall lighting, ambient cast and motes from the theme's
   * LightSpec/MoteSpec, warmed by the studio's light slider.
   */
  private applyLightRig(lib: ResolvedLibrary): void {
    const light = lib.theme.light;
    const warmth = warmthTint(lib.prefs.lightWarmth);
    const pools = light.pools.length > 0 ? light.pools : [];

    // Grow/shrink the sprite pool to match the theme.
    while (this.lightPools.length < pools.length) {
      const extra = new Sprite(this.glowTexture);
      extra.anchor.set(0.5);
      extra.blendMode = 'add';
      extra.eventMode = 'none';
      this.lightPools.push(extra);
      this.lightFx.addChild(extra);
    }
    for (let i = 0; i < this.lightPools.length; i++) {
      const sprite = this.lightPools[i] as Sprite & {
        __spec?: { fx: number; fy: number; r: number };
        __base?: { x: number; y: number };
      };
      const pool = pools[i] as LightPool | undefined;
      if (pool === undefined) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.tint = mixTint(hexToInt(pool.colour), warmth);
      sprite.alpha = clamp(pool.intensity, 0, 1) * 0.6;
      sprite.__spec = { fx: pool.x, fy: pool.y, r: pool.radius * 1.6 };
    }
    this.layoutWallLighting();

    if (this.caseGlow !== null) {
      this.caseGlow.tint = mixTint(hexToInt(light.ambient.colour), warmth);
      this.caseGlow.alpha = 0.28 + light.ambient.amount * 0.5;
    }
    if (this.ambientWash !== null) {
      this.ambientWash.tint = hexToInt(light.ambient.colour);
      this.ambientWash.alpha = Math.min(0.4, light.ambient.amount * 0.55);
      this.ambientWash.width = this.vp.width;
      this.ambientWash.height = this.vp.height;
    }

    const motes = lib.theme.motes;
    this.motes.setStyle({
      colour: hexToInt(motes.colour),
      density: motes.density,
      drift: motes.drift,
      twinkle: motes.kind === 'sparkle',
    });
    this.motes.setEnabled(!this.degrade && !this.reducedMotion && motes.kind !== 'none');
  }

  /* -------------------------------- flora --------------------------------- */

  /**
   * Replant every mounted floor. Deterministic per (floor, anchor, theme), so
   * a floor keeps its plants across remounts; keep-outs come from the floor's
   * live spine rects, so flora never lands on a title (§3 occlusion rule).
   */
  private async refreshFlora(gen: number): Promise<void> {
    const lib = this.library;
    if (lib === null || this.destroyed || gen !== this.libraryGen) return;
    for (const [index, fv] of [...this.floors]) {
      await this.growFloor(index, fv, gen);
    }
  }

  /** Plan + bake + attach one floor's two flora layers. */
  private async growFloor(index: number, fv: FloorView, gen: number): Promise<void> {
    const lib = this.library;
    if (lib === null || this.destroyed || gen !== this.libraryGen) return;
    if (this.degrade && lib.prefs.floraDensity <= 0) return;
    const plan: FloorFloraPlan = planFloorFlora({
      floorIndex: index,
      theme: lib.theme,
      densityMultiplier: lib.prefs.floraDensity,
      spines: fv.visuals.map((v) => ({ centerX: v.centerX, w: v.w, height: v.height })),
    });
    for (const layer of ['back', 'rail'] as const) {
      const baked = await bakeFloraTexture(plan[layer], this.dpr);
      if (this.destroyed || gen !== this.libraryGen) return;
      // The floor may have been recycled while the bake ran.
      if (this.floors.get(index) !== fv) return;
      fv.setFlora(layer, baked?.texture ?? null, baked?.bounds ?? null);
    }
    this.dirty = true;
  }

  /** Re-seat the wall lighting after a resize (bases; drift offsets from them). */
  private layoutWallLighting(): void {
    const { width, height } = this.vp;
    if (this.ambientWash !== null) {
      this.ambientWash.width = width;
      this.ambientWash.height = height;
    }
    for (const raw of this.lightPools) {
      const pool = raw as Sprite & {
        __spec?: { fx: number; fy: number; r: number };
        __base?: { x: number; y: number };
      };
      const spec = pool.__spec;
      if (spec === undefined) continue;
      const d = Math.max(width, height) * spec.r;
      pool.width = d;
      pool.height = d * 0.82;
      pool.__base = { x: width * spec.fx, y: height * spec.fy };
      pool.position.set(pool.__base.x, pool.__base.y);
    }
  }

  /* ---------------------------- virtualization ---------------------------- */

  private sync(): void {
    const cam = this.camera;
    const range = computeRange(cam.y, this.vp.height, cam.zoom);
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
        this.degrade,
        recentId,
      );
      fv.setPlaque(this.envTex, this.dpr, floorLabel(index));
      if (this.tier === 2) fv.showStamp(this.stampFor(index, fv));
      this.requestSpines(fv);
      void this.growFloor(index, fv, this.libraryGen);
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
    this.syncTrashDrawer();
    this.publishVisibleBooks();
  }

  /**
   * The trash drawer front sits just under the last occupied floor's plank
   * (wave-2 item 22). World-space sprite, re-appended after floor mounts so
   * it always renders above the next floor's back panel.
   */
  private syncTrashDrawer(): void {
    const floor = this.store.maxFloor;
    const y = (floor + 1) * FLOOR_H + 3;
    if (this.trashSprite === null) {
      this.trashSprite = new Sprite(this.envTex.getTrashDrawer(this.dpr));
      this.trashSprite.anchor.set(0.5, 0);
      this.trashSprite.width = TRASH_DRAWER_W;
      this.trashSprite.height = TRASH_DRAWER_H;
      const wood = this.library?.theme.wood.light;
      this.trashSprite.tint =
        wood === undefined ? TRASH_ART_TONE : ratioTint(hexToInt(wood), TRASH_ART_TONE);
    }
    this.trashSprite.position.set(SHELF_WIDTH / 2, y);
    // Keep on top of floor containers (mounts re-order world children). Only
    // re-append when it is not already last — addChild every frame would
    // churn the child array on the hot path.
    const kids = this.world.children;
    if (kids[kids.length - 1] !== this.trashSprite) {
      this.world.addChild(this.trashSprite);
    }
  }

  /** World-space rect of the trash drawer (hit-testing). */
  private trashDrawerHit(wx: number, wy: number): boolean {
    if (this.trashSprite === null) return false;
    const y0 = (this.store.maxFloor + 1) * FLOOR_H + 3;
    return (
      Math.abs(wx - SHELF_WIDTH / 2) <= TRASH_DRAWER_W / 2 &&
      wy >= y0 &&
      wy <= y0 + TRASH_DRAWER_H
    );
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
    for (const visual of fv.visuals) {
      this.factory.request(visual.book, 'lo', priority);
      if (this.tier === 0) this.factory.request(visual.book, 'hi', priority);
    }
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
      // Spine rects moved, so the flora keep-outs have to be recomputed.
      void this.growFloor(index, fv, this.libraryGen);
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

  private handleEnvReady(): void {
    if (this.destroyed) return;
    const m = this.hooks.motion();
    // The room's own wall (papered · panelled · plastered · boarded · shoji ·
    // glazed) supersedes the old paper+damask pair entirely.
    const strip = this.envTex.backdropStrip;
    if (strip !== null) {
      if (this.backdrop.texture !== strip) {
        this.backdrop.texture = strip;
        this.backdrop.tint = 0xffffff;
      }
      this.backdrop.alpha = 1;
      if (this.wallpaper !== null) this.wallpaper.visible = false;
    } else if (this.envTex.paper !== null && this.backdrop.texture !== this.envTex.paper) {
      this.backdrop.texture = this.envTex.paper;
      this.backdrop.tint = 0xffffff;
      this.track(
        gsap.to(this.backdrop, {
          alpha: BACKDROP_ALPHA,
          duration: 0.5 * m,
          onUpdate: this.hooks.markDirty,
        }),
      );
      if (m === 0) this.backdrop.alpha = BACKDROP_ALPHA;
    }
    if (strip !== null) {
      // Themed wall — nothing else to hang on it.
    } else if (this.envTex.wallpaper !== null && this.wallpaper === null) {
      // Damask pencil pattern over the paper: its own tiling layer so the
      // pattern scale stays independent of the paper fibre tile.
      const wp = new TilingSprite({
        texture: this.envTex.wallpaper,
        width: this.vp.width,
        height: this.vp.height,
      });
      wp.eventMode = 'none';
      wp.alpha = 0;
      this.app.stage.addChildAt(wp, this.app.stage.getChildIndex(this.backdrop) + 1);
      this.wallpaper = wp;
      this.track(
        gsap.to(wp, {
          alpha: WALLPAPER_ALPHA,
          duration: 0.5 * m,
          onUpdate: this.hooks.markDirty,
        }),
      );
      if (m === 0) wp.alpha = WALLPAPER_ALPHA;
    } else if (this.wallpaper !== null) {
      // Wave-2 wallpaper picker: pattern swap or 'plain' (layer hidden).
      if (this.envTex.wallpaper === null) {
        this.wallpaper.visible = false;
      } else {
        this.wallpaper.visible = true;
        this.wallpaper.alpha = WALLPAPER_ALPHA;
        if (this.wallpaper.texture !== this.envTex.wallpaper) {
          this.wallpaper.texture = this.envTex.wallpaper;
        }
      }
    }
    if (this.envTex.crown !== null) {
      const firstArrival = !this.crownWood;
      this.crownWood = true;
      if (this.crown.texture !== this.envTex.crown) {
        this.crown.texture = this.envTex.crown;
        this.crown.tint = 0xffffff;
        this.crown.width = SHELF_WIDTH + CROWN_LIP * 2;
        this.crown.height = CROWN_H;
        if (firstArrival && m > 0) {
          this.crown.alpha = 0;
          this.track(
            gsap.to(this.crown, { alpha: 1, duration: 0.4 * m, onUpdate: this.hooks.markDirty }),
          );
        }
      }
    }
    for (const [index, fv] of this.floors) {
      fv.applyEnv(this.envTex, this.degrade, true);
      fv.refreshEnv(this.envTex);
      this.rebakeStamp(index, fv);
    }
    this.dirty = true;
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
    if (isOutOfBounds(cam, this.vp)) {
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
    if (this.trashDrawerHit(wx, wy)) {
      void play('pop-soft');
      this.events.onOpenTrash?.();
      return;
    }
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
    const floor = Math.floor(wy / FLOOR_H);
    if (floor >= 0) this.zoomToFloor(floor);
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
    const floor = Math.floor(wy / FLOOR_H);
    if (floor < 0 || wx < 0 || wx > SHELF_WIDTH) return;
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
    const targetY = clamp(cam.y, by.min, by.max);
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
    const targetY = Math.max(
      Y_MIN,
      floor * FLOOR_H - (this.vp.height / targetZoom - FLOOR_H) / 2,
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

    const shadow = new Sprite(this.glowTexture);
    shadow.tint = 0x2e241a;
    shadow.anchor.set(0.5);
    shadow.width = visual.w * zoom * 1.7;
    shadow.height = 16 * zoom;
    shadow.position.set(screen.x, screen.y + 5 * zoom);
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
      this.track(
        gsap.to(other.sprite, {
          pixi: { tint: 0xb9ab97 },
          duration: 0.3 * m,
          onUpdate: this.hooks.markDirty,
        }),
      );
    }
  }

  /** Tap pull-out: the full from-rest choreography. */
  private pullOutBook(fv: FloorView, visual: BookVisual): void {
    if (this.frozen) return;
    void play('book-pull');
    void touchBookOpened(visual.book.id);
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

    const liftedY = screen.y - 40 * zoom;
    const finish = (): void => {
      const width = visual.w * zoom * 1.35;
      const height = visual.height * zoom * 1.35;
      this.events.onGhostReady(visual.book, {
        x: screen.x - width / 2,
        y: liftedY - height,
        width,
        height,
      });
    };
    if (m === 0) {
      ghost.scale.set(baseScaleX * 1.35, baseScaleY * 1.35);
      ghost.position.y = liftedY;
      ghost.skew.x = 0;
      shadow.alpha = 0.3;
      this.dirty = true;
      finish();
      return;
    }
    const tl = gsap.timeline({
      onUpdate: this.hooks.markDirty,
      onComplete: finish,
    });
    tl.to(
      ghost,
      {
        pixi: { scaleX: baseScaleX * 1.35, scaleY: baseScaleY * 1.35, y: liftedY },
        duration: 0.45 * m,
        ease: 'back.out(1.4)',
      },
      0,
    )
      .to(ghost.skew, { x: 0, duration: 0.45 * m, ease: 'power2.out' }, 0)
      .to(
        shadow,
        {
          alpha: 0.3,
          pixi: { scaleX: shadowScaleX * 1.35 },
          duration: 0.45 * m,
          ease: 'power2.out',
        },
        0,
      );
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
    void touchBookOpened(pull.visual.book.id);
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
    const tl = gsap.timeline({ onUpdate: this.hooks.markDirty, onComplete: finish });
    tl.to(
      ghost,
      {
        pixi: { scaleX: targetScaleX, scaleY: targetScaleY, x: liftX, y: liftY },
        duration: 0.3,
        ease: 'back.out(1.3)',
      },
      0,
    )
      .to(ghost, { rotation: 0, duration: 0.3, ease: 'power2.out' }, 0)
      .to(shadow, { alpha: 0, duration: 0.3 }, 0);
    this.track(tl);
  }

  /** Pointer cancelled mid-pull: slide the book back into its slot. */
  private cancelBookPull(): void {
    const pull = this.pull;
    if (pull === null) return;
    this.pull = null;
    this.updateCursor();
    const { ghost, visual } = pull;
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
    this.track(
      gsap.to(ghost, {
        pixi: { x: pull.startX, y: pull.startY },
        rotation: 0,
        duration: 0.22,
        ease: 'power2.out',
        onUpdate: this.hooks.markDirty,
        onComplete: done,
      }),
    );
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
    move.targetFloor = Math.max(0, Math.floor(wy / FLOOR_H));
    move.targetSlot = Math.round(
      clamp((wx - SLOT_MARGIN_X - SLOT_W / 2) / SLOT_W, 0, 19),
    );
    move.ghost.position.set(cursor.x, cursor.y + (move.visual.height * cam.zoom) / 2);
    move.shadow.alpha = 0;
    if (this.movePreview === null) {
      const p = new Sprite(this.glowTexture);
      p.anchor.set(0.5, 1);
      p.blendMode = 'add';
      p.tint = 0xffd98f;
      p.alpha = 0.55;
      this.fx.addChild(p);
      this.movePreview = p;
    }
    const screen = worldToScreen(cam, {
      x: slotCenterX(move.targetSlot),
      y: move.targetFloor * FLOOR_H + BOOK_BASELINE,
    });
    this.movePreview.position.set(screen.x, screen.y + 6 * cam.zoom);
    this.movePreview.width = move.visual.w * 2.8 * cam.zoom;
    this.movePreview.height = move.visual.height * 1.2 * cam.zoom;
    this.dirty = true;
  }

  private async commitMove(cursor: Vec2): Promise<void> {
    const move = this.move;
    if (move === null || move.committing) return;
    this.updateMove(cursor);
    move.committing = true;
    void play('drop-thump');
    try {
      const slot = await nextFreeSlot(move.targetFloor, move.targetSlot);
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
      if (floor < 0) floor = 0;
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
      cam.y = Math.max(Y_MIN, floorTop - (viewH - FLOOR_H) / 2);
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
    if (this.wallpaper !== null) {
      this.wallpaper.width = w;
      this.wallpaper.height = h;
    }
    this.layoutWallLighting();
    this.motes.resize(w, h);
    clampZoomBounds(this.camera, this.vp);
    if (!this.dragging) clampCamera(this.camera, this.vp);
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
