/**
 * features/bookshelf/textures.ts — environment textures (wood, back panel,
 * rails, crown, shadow, paper, empty-floor doodles) as Pixi textures.
 *
 * All bitmap art bakes asynchronously through src/art (disk-cached inside
 * Tauri); consumers show flat token-colored placeholders until `onReady`
 * fires per kind, then crossfade the real bitmaps in. Tiny synchronous
 * gradient/doodle textures (wall shade, empty-floor hints) are baked inline
 * here — a few strokes on small canvases, no async round-trip needed.
 */

import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import { bakePaperTile, bakeWallpaperTile } from '../../art/paper';
import { PROP_H, PROP_W, renderProp, type PropKind } from '../../art/props';
import type { Ctx2D } from '../../art/spines';
import {
  bakeBackPanel,
  bakeCrown,
  bakeShelfPlank,
  bakeShelfShadowStrip,
  bakeSideRail,
} from '../../art/wood';
import { doubleStroke } from '../../art/wobble';
import { fnv1a, mulberry32 } from '../../art/noise';
import { BOOK_ZONE_H, CROWN_H, CROWN_LIP, FLOOR_H, RAIL_W, SHELF_WIDTH } from './constants';

export type EnvKind =
  | 'plank'
  | 'shadow'
  | 'paper'
  | 'back'
  | 'rail'
  | 'crown'
  | 'wallpaper';

/** Case wood stains (settings.shelfWoodStain). 'oak' = the baked base art. */
export type WoodStain = 'oak' | 'walnut' | 'cherry' | 'cream';

/** Wall patterns (settings.wallpaperPattern). 'plain' = paper only. */
export type WallpaperPattern = 'damask' | 'stars' | 'botanical' | 'plain';

/** The env kinds that receive a wood-stain tint pass. */
const STAINED_KINDS: ReadonlySet<EnvKind> = new Set(['plank', 'back', 'rail', 'crown']);

/** Flat placeholder tints (match the baked art's average tones). */
export const PLACEHOLDER_TINTS = {
  plank: 0x7d5e40,
  backdrop: 0xefe4cc,
  back: 0x604b35,
  rail: 0x7a5c3e,
  crown: 0x7d5e40,
} as const;

/** Number of distinct empty-floor doodle variants (see getEmptyDoodle). */
export const EMPTY_DOODLE_VARIANTS = 3;

/** World-px design size of the doodle textures. */
export const EMPTY_DOODLE_W = 200;
export const EMPTY_DOODLE_H = 130;

/** Deterministic doodle variant for a floor. */
export function doodleVariantFor(floorIndex: number): number {
  return fnv1a(`doodle|${floorIndex}`) % EMPTY_DOODLE_VARIANTS;
}

/**
 * Doodle "chalk pencil" tones — light warm strokes that read on the DARK
 * back panel (dark graphite vanishes against it). Opaque colors rather than
 * translucent white keep the look identical across renderers.
 */
const GRAPHITE_STROKE = '#c9bba1';
const GRAPHITE_SOFT = '#ab9d85';

function textureFromBitmap(bitmap: ImageBitmap, mipmaps: boolean): Texture {
  const source = new ImageSource({
    resource: bitmap,
    autoGenerateMipmaps: mipmaps,
  });
  return new Texture({ source });
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * IMPORTANT: small synchronously-authored art (shade gradients, doodles) must
 * reach the GPU as an ImageBitmap (ImageSource), NOT as a live CanvasSource.
 * Direct canvas uploads deliver wrong pixels on some renderers (headless
 * SwiftShader garbles both alpha and content — the original "invisible
 * empty-shelf hint" bug), while the ImageBitmap path — used by every baked
 * env texture (planks, rails, crown) — renders correctly everywhere.
 * OffscreenCanvas.transferToImageBitmap() makes that conversion synchronous.
 */
function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: AnyCanvas): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  return (c as OffscreenCanvas).getContext('2d');
}

function textureFromCanvas(canvas: AnyCanvas): Texture {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return new Texture({
      source: new ImageSource({ resource: canvas.transferToImageBitmap() }),
    });
  }
  return new Texture({
    source: new CanvasSource({ resource: canvas as HTMLCanvasElement }),
  });
}

/**
 * Stain a baked wood bitmap into a new canvas (cheap composite passes; no
 * SVG filters — the art-pipeline bake-once rule stays intact since the base
 * bitmap comes from the disk-cached bake).
 */
function applyStain(bitmap: ImageBitmap, stain: WoodStain): AnyCanvas {
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const ctx = get2d(canvas);
  if (!ctx) return canvas;
  ctx.drawImage(bitmap, 0, 0);
  if (stain === 'walnut') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(96, 66, 40, 0.5)';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  } else if (stain === 'cherry') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(173, 74, 48, 0.38)';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(150, 40, 26, 0.14)';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  } else if (stain === 'cream') {
    // Painted case: a coat of cream over the wood, grain ghosting through.
    ctx.fillStyle = 'rgba(241, 231, 210, 0.72)';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.3;
    ctx.drawImage(bitmap, 0, 0);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

export class EnvTextures {
  plank: Texture | null = null;
  shadow: Texture | null = null;
  paper: Texture | null = null;
  back: Texture | null = null;
  rail: Texture | null = null;
  crown: Texture | null = null;
  wallpaper: Texture | null = null;

  private readonly doodles = new Map<number, Texture>();
  private readonly props = new Map<number, Texture>();
  private readonly plaques = new Map<string, Texture>();
  private wallShade: Texture | null = null;
  private starCharm: Texture | null = null;
  private ribbon: Texture | null = null;
  private trashDrawer: Texture | null = null;
  private readonly listeners = new Set<(kind: EnvKind) => void>();
  private destroyed = false;

  /** Untinted bake results, kept so stains can re-derive without re-baking. */
  private readonly baseBitmaps = new Map<EnvKind, ImageBitmap>();
  /** Baked pattern tiles per wallpaper pattern ('plain' never enters). */
  private readonly wallpaperTiles = new Map<WallpaperPattern, Texture>();
  private stain: WoodStain = 'oak';
  private pattern: WallpaperPattern = 'damask';
  private loadDpr = 1;

  /** Current stain (QA probes + world sync). */
  get currentStain(): WoodStain {
    return this.stain;
  }

  /** Current wallpaper pattern. */
  get currentPattern(): WallpaperPattern {
    return this.pattern;
  }

  /**
   * Kick off the async bakes. Shadow is skipped entirely in degrade mode.
   * `stain`/`pattern` (wave-2) pick the initial case theme; both can change
   * later via setStain/setWallpaper without re-running the disk bakes.
   */
  load(
    dpr: number,
    degrade: boolean,
    stain: WoodStain = 'oak',
    pattern: WallpaperPattern = 'damask',
  ): void {
    this.loadDpr = dpr;
    this.stain = stain;
    this.pattern = pattern;
    void bakeShelfPlank(SHELF_WIDTH, dpr)
      .then((bitmap) => this.deliverBitmap('plank', bitmap, true))
      .catch(() => undefined);
    if (!degrade) {
      void bakeShelfShadowStrip(dpr)
        .then((bitmap) => this.deliverBitmap('shadow', bitmap, false))
        .catch(() => undefined);
    }
    void bakePaperTile(dpr, 'aged')
      .then((bitmap) => this.deliverBitmap('paper', bitmap, true))
      .catch(() => undefined);
    void bakeBackPanel(SHELF_WIDTH, BOOK_ZONE_H, dpr)
      .then((bitmap) => this.deliverBitmap('back', bitmap, true))
      .catch(() => undefined);
    void bakeSideRail(RAIL_W, FLOOR_H, dpr)
      .then((bitmap) => this.deliverBitmap('rail', bitmap, true))
      .catch(() => undefined);
    void bakeCrown(SHELF_WIDTH + CROWN_LIP * 2, CROWN_H, dpr)
      .then((bitmap) => this.deliverBitmap('crown', bitmap, true))
      .catch(() => undefined);
    void bakeWallpaperTile(dpr)
      .then((bitmap) => this.deliverBitmap('wallpaper', bitmap, true))
      .catch(() => undefined);
  }

  /**
   * Switch the case wood stain: re-derive tinted textures from the cached
   * base bitmaps (no disk bake) and notify listeners per wood kind so live
   * sprites re-texture. Old textures are destroyed AFTER listeners ran.
   */
  setStain(stain: WoodStain): void {
    if (this.destroyed || stain === this.stain) return;
    this.stain = stain;
    for (const kind of STAINED_KINDS) {
      const base = this.baseBitmaps.get(kind);
      if (base === undefined) continue;
      const old = this[kind as 'plank' | 'back' | 'rail' | 'crown'];
      this.assign(kind, this.stainedTexture(base, kind));
      for (const cb of this.listeners) cb(kind);
      old?.destroy(true);
    }
  }

  /**
   * Switch the wallpaper pattern. 'plain' clears the layer (wallpaper = null);
   * stars/botanical tiles are baked synchronously on first use. Listeners get
   * a 'wallpaper' notification either way.
   */
  setWallpaper(pattern: WallpaperPattern): void {
    if (this.destroyed || pattern === this.pattern) return;
    this.pattern = pattern;
    this.wallpaper = pattern === 'plain' ? null : this.wallpaperTile(pattern);
    for (const cb of this.listeners) cb('wallpaper');
  }

  onReady(cb: (kind: EnvKind) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Soft horizontal shade gradient — translucent warm-dark at the left edge
   * fading to fully transparent. Rendered with NORMAL blending (do NOT use
   * multiply: the shelf canvas is transparent over the CSS paper body, so
   * multiply would darken against premultiplied backdrop pixels and read
   * as a heavy gray slab). Flanks the case as wall ambient occlusion and,
   * rotated, caps it above the crown. Shared 64×8 texture, baked once.
   */
  getWallShade(): Texture {
    if (this.wallShade !== null) return this.wallShade;
    const w = 64;
    const h = 8;
    const canvas = makeCanvas(w, h);
    const ctx = get2d(canvas);
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(122, 94, 58, 0.26)');
      g.addColorStop(0.4, 'rgba(128, 101, 64, 0.11)');
      g.addColorStop(1, 'rgba(132, 106, 70, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    this.wallShade = textureFromCanvas(canvas);
    return this.wallShade;
  }

  /**
   * Empty-floor doodle texture. Three quietly charming variants, deterministic
   * per floor via doodleVariantFor:
   *   0 — a leaning penciled ghost-book with a dust curl,
   *   1 — a little potted plant,
   *   2 — a lying two-book stack with the "~ empty shelf ~" label.
   * All graphite pencil linework, drawn once per variant per session.
   */
  getEmptyDoodle(dpr: number, variant: number): Texture {
    const v = ((variant % EMPTY_DOODLE_VARIANTS) + EMPTY_DOODLE_VARIANTS) % EMPTY_DOODLE_VARIANTS;
    const cached = this.doodles.get(v);
    if (cached !== undefined) return cached;

    const w = EMPTY_DOODLE_W;
    const h = EMPTY_DOODLE_H;
    const scale = Math.max(1, dpr);
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.strokeStyle = GRAPHITE_STROKE;
      ctx.fillStyle = GRAPHITE_SOFT;
      ctx.lineWidth = 1.3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const rnd = mulberry32((0xe321 + v * 0x9d7) >>> 0);
      const wob = { seed: (0xd00d + v) >>> 0, amplitude: 1, frequency: 0.05 };
      const strokePath = (d: string): void => {
        const [a, b] = doubleStroke(d, { ...wob, seed: (wob.seed + Math.floor(rnd() * 1e4)) >>> 0 });
        ctx.stroke(new Path2D(a));
        ctx.stroke(new Path2D(b));
      };

      if (v === 0) {
        // Ghost book: an outlined spine leaning at ~8°, baseline y = h - 4.
        const bw = 34;
        const bh = 92;
        const x0 = w * 0.42;
        const yb = h - 4;
        const leanDx = 14;
        strokePath(
          `M ${x0} ${yb} L ${x0 + bw} ${yb} L ${x0 + bw + leanDx} ${yb - bh} L ${x0 + leanDx} ${yb - bh} Z`,
        );
        // A couple of faint band rules on the ghost spine.
        strokePath(`M ${x0 + leanDx * 0.75} ${yb - bh * 0.72} L ${x0 + bw + leanDx * 0.75} ${yb - bh * 0.72}`);
        // Dust curl beside it.
        ctx.strokeStyle = GRAPHITE_SOFT;
        strokePath(
          `M ${x0 - 38} ${yb - 8} C ${x0 - 30} ${yb - 22}, ${x0 - 16} ${yb - 20}, ${x0 - 20} ${yb - 10} C ${x0 - 23} ${yb - 4}, ${x0 - 32} ${yb - 5}, ${x0 - 30} ${yb - 12}`,
        );
        // Three tiny dust flecks.
        for (let i = 0; i < 3; i++) {
          const fx = x0 + bw + 26 + rnd() * 26;
          const fy = yb - 6 - rnd() * 18;
          ctx.beginPath();
          ctx.arc(fx, fy, 0.9 + rnd() * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (v === 1) {
        // Potted plant: trapezoid pot, rim, three leaf arcs.
        const cx = w / 2;
        const yb = h - 4;
        strokePath(`M ${cx - 20} ${yb - 30} L ${cx + 20} ${yb - 30} L ${cx + 14} ${yb} L ${cx - 14} ${yb} Z`);
        strokePath(`M ${cx - 24} ${yb - 30} L ${cx + 24} ${yb - 30}`);
        const leaves = [
          `M ${cx} ${yb - 32} C ${cx - 4} ${yb - 52}, ${cx - 22} ${yb - 58}, ${cx - 26} ${yb - 74}`,
          `M ${cx} ${yb - 32} C ${cx + 2} ${yb - 56}, ${cx + 16} ${yb - 62}, ${cx + 24} ${yb - 78}`,
          `M ${cx} ${yb - 32} C ${cx - 1} ${yb - 50}, ${cx + 3} ${yb - 62}, ${cx - 2} ${yb - 80}`,
        ];
        for (const d of leaves) strokePath(d);
        // Leaf blobs at the tips.
        for (const [lx, ly] of [
          [cx - 26, yb - 74],
          [cx + 24, yb - 78],
          [cx - 2, yb - 80],
        ]) {
          strokePath(`M ${lx} ${ly} C ${lx - 7} ${ly - 8}, ${lx + 2} ${ly - 16}, ${lx + 4} ${ly - 6} C ${lx + 5} ${ly - 1}, ${lx + 2} ${ly + 2}, ${lx} ${ly}`);
        }
      } else {
        // Two lying books + label.
        const cx = w / 2;
        const yb = h - 4;
        strokePath(`M ${cx - 46} ${yb} L ${cx + 40} ${yb} L ${cx + 40} ${yb - 13} L ${cx - 46} ${yb - 13} Z`);
        strokePath(`M ${cx - 38} ${yb - 13} L ${cx + 46} ${yb - 13} L ${cx + 46} ${yb - 26} L ${cx - 38} ${yb - 26} Z`);
        strokePath(`M ${cx + 30} ${yb - 2} L ${cx + 30} ${yb - 11}`);
        ctx.font = '21px "Architects Daughter", "Segoe Print", cursive';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#d3c6ad';
        ctx.fillText('~ empty shelf ~', cx, h * 0.28);
        ctx.strokeStyle = GRAPHITE_SOFT;
        for (const [x0, x1] of [
          [w * 0.06, w * 0.2],
          [w * 0.8, w * 0.94],
        ]) {
          strokePath(`M ${x0} ${h * 0.28} L ${x1} ${h * 0.28}`);
        }
      }
    }
    const texture = textureFromCanvas(canvas);
    this.doodles.set(v, texture);
    return texture;
  }

  /**
   * Shelf-dressing prop texture (baked once per kind per session, ImageBitmap
   * path — see the makeCanvas note). `variant` seeds the small strokes so the
   * same kind can appear twice without reading as a stamp; only a few
   * variants per kind are ever baked (kind*8 + variant%8 cache slots).
   */
  getProp(dpr: number, kind: PropKind, variant: number): Texture {
    const v = ((variant % 8) + 8) % 8;
    const key = kind * 8 + v;
    const cached = this.props.get(key);
    if (cached !== undefined) return cached;
    const scale = Math.max(1, dpr);
    const canvas = makeCanvas(Math.ceil(PROP_W * scale), Math.ceil(PROP_H * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      renderProp(ctx as Ctx2D, kind, (0x9a75 + kind * 131 + v * 977) >>> 0);
    }
    const texture = textureFromCanvas(canvas);
    this.props.set(key, texture);
    return texture;
  }

  /* -------------------- wave-2 shelf-life prop textures ------------------- */

  /**
   * Tiny gold star charm hung on pinned spines (favorites). ~18×18 world px,
   * warm gold fill with a graphite pencil outline and a little string loop.
   */
  getStarCharm(dpr: number): Texture {
    if (this.starCharm !== null) return this.starCharm;
    const w = 20;
    const h = 24;
    const scale = Math.max(1, dpr) * 2; // small art: bake crisp at 2×
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // String loop from the spine top.
      ctx.strokeStyle = 'rgba(60, 48, 34, 0.75)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0.8);
      ctx.quadraticCurveTo(w / 2 + 1.6, 3.2, w / 2, 6);
      ctx.stroke();
      // Five-point star.
      const cx = w / 2;
      const cy = 14.4;
      const rOut = 8.2;
      const rIn = 3.4;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? rOut : rIn;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(cx - rOut, cy - rOut, cx + rOut, cy + rOut);
      g.addColorStop(0, '#f4d06f');
      g.addColorStop(1, '#c9982e');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(84, 62, 26, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Catchlight.
      ctx.fillStyle = 'rgba(255, 246, 220, 0.85)';
      ctx.beginPath();
      ctx.arc(cx - 2.4, cy - 2.8, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.starCharm = textureFromCanvas(canvas);
    return this.starCharm;
  }

  /**
   * Continue-reading ribbon peeking out of the last-opened book's pages —
   * a warm terracotta strip with a notched tail and pencil edges.
   */
  getRibbon(dpr: number): Texture {
    if (this.ribbon !== null) return this.ribbon;
    const w = 12;
    const h = 34;
    const scale = Math.max(1, dpr) * 2;
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineJoin = 'round';
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#b7563c');
      g.addColorStop(0.5, '#d17a5a');
      g.addColorStop(1, '#a34d34');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(1, 0);
      ctx.lineTo(w - 1, 0);
      ctx.lineTo(w - 1, h - 7);
      ctx.lineTo(w / 2, h - 1.5);
      ctx.lineTo(1, h - 7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(64, 30, 20, 0.65)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Fold shadow at the top (where it leaves the pages).
      ctx.fillStyle = 'rgba(46, 20, 12, 0.28)';
      ctx.fillRect(1, 0, w - 2, 2.4);
    }
    this.ribbon = textureFromCanvas(canvas);
    return this.ribbon;
  }

  /**
   * Brass floor plaque with an engraved label. Cached per label text; the
   * cache is bounded (LRU-ish clear) since labels are user-editable.
   */
  getPlaque(dpr: number, label: string): Texture {
    const key = label;
    const cached = this.plaques.get(key);
    if (cached !== undefined) return cached;
    if (this.plaques.size > 48) {
      for (const tex of this.plaques.values()) tex.destroy(true);
      this.plaques.clear();
    }
    const w = PLAQUE_W;
    const h = PLAQUE_H;
    const scale = Math.max(1, dpr) * 2;
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineJoin = 'round';
      // Brass plate with slightly clipped corners.
      const inset = 1.5;
      const cut = 3;
      const plate = new Path2D(
        `M ${inset + cut} ${inset} L ${w - inset - cut} ${inset} L ${w - inset} ${inset + cut} ` +
          `L ${w - inset} ${h - inset - cut} L ${w - inset - cut} ${h - inset} ` +
          `L ${inset + cut} ${h - inset} L ${inset} ${h - inset - cut} L ${inset} ${inset + cut} Z`,
      );
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#e4c06a');
      g.addColorStop(0.45, '#c39a44');
      g.addColorStop(1, '#a67f30');
      ctx.fillStyle = g;
      ctx.fill(plate);
      ctx.strokeStyle = 'rgba(74, 54, 22, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke(plate);
      // Inner engraved rule.
      ctx.strokeStyle = 'rgba(94, 68, 26, 0.45)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(4.5, 3.5, w - 9, h - 7);
      // Screw dots.
      ctx.fillStyle = 'rgba(84, 60, 24, 0.75)';
      for (const sx of [6.5, w - 6.5]) {
        ctx.beginPath();
        ctx.arc(sx, h / 2, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Engraved label.
      ctx.font = '13px "Architects Daughter", "Segoe Print", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 240, 200, 0.55)';
      ctx.fillText(label, w / 2, h / 2 + 1.6, w - 22);
      ctx.fillStyle = 'rgba(62, 42, 14, 0.9)';
      ctx.fillText(label, w / 2, h / 2 + 0.6, w - 22);
    }
    const texture = textureFromCanvas(canvas);
    this.plaques.set(key, texture);
    return texture;
  }

  /**
   * Trash-drawer front: a wooden drawer face with a brass pull handle and a
   * small crumpled-paper doodle, drawn once. Lives under the last floor.
   */
  getTrashDrawer(dpr: number): Texture {
    if (this.trashDrawer !== null) return this.trashDrawer;
    const w = TRASH_DRAWER_W;
    const h = TRASH_DRAWER_H;
    const scale = Math.max(1, dpr);
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Drawer face.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#8a6a48');
      g.addColorStop(0.5, '#75573a');
      g.addColorStop(1, '#5c422b');
      ctx.fillStyle = g;
      ctx.fillRect(1, 1, w - 2, h - 2);
      // Doubled pencil outline + inner panel line.
      ctx.strokeStyle = 'rgba(50, 38, 26, 0.7)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
      ctx.strokeStyle = 'rgba(40, 30, 20, 0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(7.5, 6.5, w - 15, h - 13);
      // Brass pull handle (arc) at center.
      const cx = w / 2;
      const hy = h / 2 + 3;
      ctx.strokeStyle = '#c9a23e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, hy - 4, 11, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(74, 54, 22, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, hy - 4, 12.4, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      for (const bx of [cx - 10.4, cx + 10.4]) {
        ctx.fillStyle = '#b08c34';
        ctx.beginPath();
        ctx.arc(bx, hy - 3.4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // "waste paper" label, engraved-style, left of the handle.
      ctx.font = '12px "Architects Daughter", "Segoe Print", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(240, 224, 194, 0.8)';
      ctx.fillText('~ waste paper ~', cx, h - 11);
      // Crumpled-ball doodle right of the handle.
      ctx.strokeStyle = 'rgba(235, 222, 198, 0.6)';
      ctx.lineWidth = 1;
      const bx = w - 34;
      const by = h / 2 - 2;
      ctx.beginPath();
      ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx - 4, by - 2);
      ctx.lineTo(bx + 1, by + 1);
      ctx.lineTo(bx - 2, by + 3.4);
      ctx.moveTo(bx + 4, by - 3);
      ctx.lineTo(bx + 1.4, by + 0.4);
      ctx.stroke();
    }
    this.trashDrawer = textureFromCanvas(canvas);
    return this.trashDrawer;
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    this.plank?.destroy(true);
    this.shadow?.destroy(true);
    this.paper?.destroy(true);
    this.back?.destroy(true);
    this.rail?.destroy(true);
    this.crown?.destroy(true);
    this.wallpaper?.destroy(true);
    this.wallShade?.destroy(true);
    this.starCharm?.destroy(true);
    this.ribbon?.destroy(true);
    this.trashDrawer?.destroy(true);
    for (const tex of this.doodles.values()) tex.destroy(true);
    this.doodles.clear();
    for (const tex of this.props.values()) tex.destroy(true);
    this.props.clear();
    for (const tex of this.plaques.values()) tex.destroy(true);
    this.plaques.clear();
    for (const [pattern, tex] of this.wallpaperTiles) {
      // The damask tile doubles as this.wallpaper (already destroyed above)
      // only when it is the active pattern; guard double-destroys.
      if (tex !== this.wallpaper && !tex.destroyed) tex.destroy(true);
      this.wallpaperTiles.delete(pattern);
    }
    this.baseBitmaps.clear();
    this.plank = null;
    this.shadow = null;
    this.paper = null;
    this.back = null;
    this.rail = null;
    this.crown = null;
    this.wallpaper = null;
    this.wallShade = null;
    this.starCharm = null;
    this.ribbon = null;
    this.trashDrawer = null;
  }

  /* ------------------------------ internals ------------------------------- */

  /** Store the base bake, derive the (possibly stained) texture, notify. */
  private deliverBitmap(kind: EnvKind, bitmap: ImageBitmap, mipmaps: boolean): void {
    if (this.destroyed) return;
    this.baseBitmaps.set(kind, bitmap);
    if (kind === 'wallpaper') {
      const damask = textureFromBitmap(bitmap, mipmaps);
      this.wallpaperTiles.set('damask', damask);
      this.wallpaper =
        this.pattern === 'plain' ? null : this.wallpaperTile(this.pattern);
    } else if (STAINED_KINDS.has(kind)) {
      this.assign(kind, this.stainedTexture(bitmap, kind));
    } else {
      this.assign(kind, textureFromBitmap(bitmap, mipmaps));
    }
    for (const cb of this.listeners) cb(kind);
  }

  private assign(kind: EnvKind, texture: Texture): void {
    if (kind === 'plank') this.plank = texture;
    else if (kind === 'shadow') this.shadow = texture;
    else if (kind === 'paper') this.paper = texture;
    else if (kind === 'back') this.back = texture;
    else if (kind === 'rail') this.rail = texture;
    else if (kind === 'wallpaper') this.wallpaper = texture;
    else this.crown = texture;
  }

  /** Wood texture for the current stain ('oak' = base bitmap untouched). */
  private stainedTexture(base: ImageBitmap, kind: EnvKind): Texture {
    if (this.stain === 'oak') return textureFromBitmap(base, kind !== 'shadow');
    return textureFromCanvas(applyStain(base, this.stain));
  }

  /** Pattern tile for stars/botanical/damask (damask needs its bake done). */
  private wallpaperTile(pattern: WallpaperPattern): Texture | null {
    if (pattern === 'plain') return null;
    const cached = this.wallpaperTiles.get(pattern);
    if (cached !== undefined) return cached;
    if (pattern === 'damask') return null; // bake not landed yet
    const tex = bakePatternTile(pattern, this.loadDpr);
    this.wallpaperTiles.set(pattern, tex);
    return tex;
  }
}

/* ------------------------- wallpaper pattern tiles ------------------------- */

/** Plaque design size, world px (drawn on the plank face). */
export const PLAQUE_W = 132;
export const PLAQUE_H = 22;

/** Trash-drawer front design size, world px. */
export const TRASH_DRAWER_W = 340;
export const TRASH_DRAWER_H = 56;

const PATTERN_INK = 'rgba(140, 110, 72, 0.16)';
const PATTERN_INK_SOFT = 'rgba(150, 122, 86, 0.10)';
const PATTERN_GOLD = 'rgba(196, 158, 82, 0.14)';

/**
 * Synchronously bake the stars/botanical wallpaper tiles — quiet penciled
 * patterns at whisper contrast matching the damask tile's tone. 256px tile,
 * seamless by construction (motifs placed on a wrap-aligned grid).
 */
function bakePatternTile(pattern: 'stars' | 'botanical', dpr: number): Texture {
  const s = 256;
  const scale = Math.max(1, dpr);
  const canvas = makeCanvas(Math.ceil(s * scale), Math.ceil(s * scale));
  const ctx = get2d(canvas);
  if (!ctx) return Texture.WHITE;
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const rnd = mulberry32(pattern === 'stars' ? 0x57a125 : 0xb07a41);

  if (pattern === 'stars') {
    // Scattered pencil stars + tiny dots on a wrap-aligned jittered grid.
    const cell = 64;
    for (let gy = 0; gy < s / cell; gy++) {
      for (let gx = 0; gx < s / cell; gx++) {
        const cx = gx * cell + cell * (0.3 + rnd() * 0.4);
        const cy = gy * cell + cell * (0.3 + rnd() * 0.4);
        const r = 5 + rnd() * 5;
        const big = rnd() < 0.4;
        ctx.strokeStyle = big ? PATTERN_INK : PATTERN_INK_SOFT;
        ctx.lineWidth = 1;
        // Four-point sparkle star.
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.quadraticCurveTo(cx + r * 0.18, cy - r * 0.18, cx + r, cy);
        ctx.quadraticCurveTo(cx + r * 0.18, cy + r * 0.18, cx, cy + r);
        ctx.quadraticCurveTo(cx - r * 0.18, cy + r * 0.18, cx - r, cy);
        ctx.quadraticCurveTo(cx - r * 0.18, cy - r * 0.18, cx, cy - r);
        ctx.closePath();
        ctx.stroke();
        if (big) {
          ctx.fillStyle = PATTERN_GOLD;
          ctx.beginPath();
          ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        // A companion dot drifting nearby.
        ctx.fillStyle = PATTERN_INK_SOFT;
        ctx.beginPath();
        ctx.arc(
          cx + (rnd() * 2 - 1) * 18,
          cy + (rnd() * 2 - 1) * 18,
          1,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  } else {
    // Botanical: gentle vine waves with leaf pairs, two columns per tile.
    ctx.strokeStyle = PATTERN_INK;
    ctx.lineWidth = 1;
    for (const colX of [s * 0.25, s * 0.75]) {
      // Vine: full-height sine wave (period = tile height → seamless wrap).
      ctx.beginPath();
      for (let y = 0; y <= s; y += 4) {
        const x = colX + Math.sin((y / s) * Math.PI * 2) * 14;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Leaf pairs along the vine.
      for (let y = 16; y < s; y += 32) {
        const x = colX + Math.sin((y / s) * Math.PI * 2) * 14;
        const dir = ((y / 32) | 0) % 2 === 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 12 * dir, y - 8, x + 17 * dir, y - 1);
        ctx.quadraticCurveTo(x + 10 * dir, y + 5, x, y);
        ctx.stroke();
        // Gold berry at alternating nodes.
        if (((y / 32) | 0) % 3 === 0) {
          ctx.fillStyle = PATTERN_GOLD;
          ctx.beginPath();
          ctx.arc(x - 4 * dir, y + 5, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  return textureFromCanvas(canvas);
}
