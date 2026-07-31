/**
 * render/gbuffer.ts — the normal/height buffer, as a Pixi resource.
 *
 * The deferred pass needs the NHB as a texture the shader can sample. Scene
 * elements produce their contributions in one of two ways, and this module
 * gives each a home:
 *
 *  - **{@link CanvasNormalBuffer}** — a 2D canvas that bake-time art draws
 *    into with `emitHeight`, wrapped in a Pixi texture. This is the cheap path
 *    and the one the shelf uses: the whole case's height field is one canvas,
 *    painted once when the composition changes, uploaded once.
 *
 *  - **{@link SpriteNormalBuffer}** — a Pixi `RenderTexture` plus a container.
 *    For anything that *moves* (a book being dragged out, a swaying frond), a
 *    normal sprite rides alongside the albedo sprite and the pair is rendered
 *    into the buffer each frame.
 *
 * Both expose the same {@link NormalBuffer} shape, so the filter does not care
 * which one it is looking at.
 *
 * ## Why this is cheap
 *
 * The buffer is **half resolution by default**. Normals and heights are
 * low-frequency by nature — a book's roll and a plank's bevel have no detail
 * at the pixel level — while the AO ring and the shadow march sample it a few
 * dozen times per pixel. Halving it quarters that bandwidth and costs nothing
 * visible, which is most of the reason the whole pass fits in one draw.
 */

import {
  CanvasSource,
  RenderTexture,
  Texture,
  type Container,
  type Renderer,
  type TextureSource,
} from 'pixi.js';

import { emitBackplane, type NormalCanvas, type NormalCtx } from './normals';

/** What the lighting filter needs from whatever produced the height field. */
export interface NormalBuffer {
  /** The texture to sample. */
  readonly texture: Texture;
  /** Width of the buffer in its own pixels. */
  readonly width: number;
  /** Height of the buffer in its own pixels. */
  readonly height: number;
  /** Buffer pixels per scene pixel (0.5 = half res). */
  readonly resolution: number;
  /** Release GPU resources. */
  destroy(): void;
}

/** How many buffer pixels per scene pixel. Halved because normals are smooth. */
export const DEFAULT_NORMAL_RESOLUTION = 0.5;

function makeCanvas(w: number, h: number): NormalCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* ========================================================================== *
 *                              canvas-backed                                 *
 * ========================================================================== */

export interface CanvasNormalBufferOptions {
  /** Scene width in CSS pixels. */
  width: number;
  /** Scene height in CSS pixels. */
  height: number;
  /** Buffer pixels per scene pixel. Default 0.5. */
  resolution?: number;
  /** Height of the back plane, 0–1. Default 0.04. */
  backHeight?: number;
}

/**
 * A height field painted on a 2D canvas.
 *
 * The context is pre-scaled to `resolution`, so callers draw in **scene
 * coordinates** and never think about the buffer being half size — a book at
 * x=940 emits at x=940 whatever the buffer resolution is.
 */
export class CanvasNormalBuffer implements NormalBuffer {
  readonly canvas: NormalCanvas;
  readonly ctx: NormalCtx;
  readonly texture: Texture;
  readonly resolution: number;

  private sceneW: number;
  private sceneH: number;
  private backHeight: number;
  private dirty = true;

  constructor(opts: CanvasNormalBufferOptions) {
    this.resolution = Math.max(0.1, Math.min(2, opts.resolution ?? DEFAULT_NORMAL_RESOLUTION));
    this.sceneW = Math.max(1, Math.round(opts.width));
    this.sceneH = Math.max(1, Math.round(opts.height));
    this.backHeight = opts.backHeight ?? 0.04;

    this.canvas = makeCanvas(
      Math.max(1, Math.ceil(this.sceneW * this.resolution)),
      Math.max(1, Math.ceil(this.sceneH * this.resolution)),
    );
    this.ctx = this.canvas.getContext('2d') as NormalCtx;
    this.texture = new Texture({
      source: new CanvasSource({
        resource: this.canvas as HTMLCanvasElement,
        // Linear: the buffer is deliberately low-res and the shader wants a
        // smooth field, not visible buffer texels in every gradient.
        scaleMode: 'linear',
        // Never wrap — the AO ring and the shadow march both read past the
        // edge, and a wrapped read puts the opposite side of the shelf into
        // the occlusion test.
        addressMode: 'clamp-to-edge',
        antialias: false,
      }),
    });
    this.reset();
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /** Scene width in CSS pixels. */
  get sceneWidth(): number {
    return this.sceneW;
  }

  /** Scene height in CSS pixels. */
  get sceneHeight(): number {
    return this.sceneH;
  }

  /**
   * Clear to the back plane and restore the scene-coordinate transform.
   * Call before repainting the height field.
   */
  reset(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(this.resolution, this.resolution);
    emitBackplane(ctx, this.sceneW, this.sceneH, this.backHeight);
    this.dirty = true;
  }

  /** Mark the canvas changed; the texture uploads on the next {@link flush}. */
  touch(): void {
    this.dirty = true;
  }

  /** Upload the canvas to the GPU if anything changed. Cheap when clean. */
  flush(): void {
    if (!this.dirty) return;
    this.texture.source.update();
    this.dirty = false;
  }

  /** Resize, preserving nothing — the caller repaints. */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.sceneW && h === this.sceneH) return;
    this.sceneW = w;
    this.sceneH = h;
    this.canvas.width = Math.max(1, Math.ceil(w * this.resolution));
    this.canvas.height = Math.max(1, Math.ceil(h * this.resolution));
    this.texture.source.resize(this.canvas.width, this.canvas.height);
    this.reset();
  }

  destroy(): void {
    this.texture.destroy(true);
  }
}

/* ========================================================================== *
 *                           render-texture-backed                            *
 * ========================================================================== */

export interface SpriteNormalBufferOptions {
  width: number;
  height: number;
  resolution?: number;
}

/**
 * A height field composited from Pixi display objects.
 *
 * Add a normal sprite for every albedo sprite that moves; call {@link render}
 * once a frame. The container is *not* on the main scene graph, so nothing in
 * it is ever drawn to the screen.
 */
export class SpriteNormalBuffer implements NormalBuffer {
  readonly texture: RenderTexture;
  readonly resolution: number;

  constructor(opts: SpriteNormalBufferOptions) {
    this.resolution = Math.max(0.1, Math.min(2, opts.resolution ?? DEFAULT_NORMAL_RESOLUTION));
    this.texture = RenderTexture.create({
      width: Math.max(1, Math.round(opts.width)),
      height: Math.max(1, Math.round(opts.height)),
      resolution: this.resolution,
      scaleMode: 'linear',
      antialias: false,
    });
    (this.texture.source as TextureSource).addressMode = 'clamp-to-edge';
  }

  get width(): number {
    return this.texture.source.pixelWidth;
  }

  get height(): number {
    return this.texture.source.pixelHeight;
  }

  /**
   * Composite the container into the buffer.
   *
   * Cleared to the *empty surface* encoding rather than to zero: an all-zero
   * texel decodes to "uncovered, at the back plane", which is right for the
   * gaps but wrong for a normal — clearing to (0.5, 0.5, 0, 0) keeps the
   * decode stable everywhere.
   */
  render(renderer: Renderer, container: Container): void {
    renderer.render({
      container,
      target: this.texture,
      clear: true,
      clearColor: [0.5, 0.5, 0, 0],
    });
  }

  resize(width: number, height: number): void {
    this.texture.resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  destroy(): void {
    this.texture.destroy(true);
  }
}

/* ========================================================================== *
 *                                alignment                                   *
 * ========================================================================== */

// `normalUvTransform` lives in `uniforms.ts` — it is pure arithmetic, and the
// unit tests need it without dragging PixiJS (and therefore a DOM) into a Node
// test run. Re-exported here because this is where callers look for it.
export { normalUvTransform } from './uniforms';
