/**
 * render/deferredLighting.ts — the one fullscreen pass, as a PixiJS v8 filter.
 *
 * Attach {@link DeferredLightingFilter} to the container holding the composed
 * **albedo** scene, hand it a {@link NormalBuffer}, and the whole picture gets
 * lit: key, ambient occlusion, cast shadows, rim, temperature, shafts, bloom,
 * vignette and grade, in a single draw.
 *
 * ## Why a filter and not a hundred bakes
 *
 * The old path shaded each element on the CPU at bake time — thousands of
 * gradient stacks, a 118-second startup, and a thousand independent lightings
 * that averaged out to no lighting at all. This is one shader over the
 * composed frame, so:
 *
 *  - the whole scene is lit by *one* light, which is the coherence the
 *    painted-rendering doc is asking for;
 *  - the cost is one fullscreen pass, independent of how many books are on
 *    the shelf;
 *  - the light is **live** — changing the rig, the time of day or the theme
 *    is a uniform upload, not a re-bake.
 *
 * ## Usage
 *
 * ```ts
 * const buffer = new CanvasNormalBuffer({ width, height });
 * // ... elements call emitHeight(buffer.ctx, shape, rect) ...
 * buffer.flush();
 *
 * const light = new DeferredLightingFilter({ rig: getLightRig('golden-hour'), normals: buffer });
 * world.filters = [light];
 * world.filterArea = new Rectangle(0, 0, width, height);
 *
 * // each frame (or only when something changes):
 * light.setTime(elapsedSeconds);
 * ```
 *
 * ## WebGL only
 *
 * The app initialises Pixi with `preference: 'webgl'`, so only a `GlProgram`
 * is provided. Under WebGPU this filter would need a WGSL twin; rather than
 * ship a second copy of the lighting maths that could silently drift from the
 * GLSL one, {@link isDeferredLightingSupported} lets a caller check and fall
 * back to unlit albedo.
 */

import {
  Filter,
  GlProgram,
  RendererType,
  UniformGroup,
  type FilterSystem,
  type Renderer,
  type RenderSurface,
  type Texture,
} from 'pixi.js';

import { DEFAULT_LIGHT_RIG, type LightRig } from '../art/lighting';
import {
  buildLightingFragment,
  debugModeId,
  PIXI_VERTEX_SOURCE,
  type DebugMode,
  type LightingQuality,
} from './glsl';
import { type NormalBuffer } from './gbuffer';
import {
  LIGHTING_UNIFORM_TYPES,
  normalUvTransform,
  packLightingUniforms,
  REFERENCE_WIDTH,
  type LightingUniforms,
} from './uniforms';

/* ========================================================================== *
 *                                  options                                   *
 * ========================================================================== */

export interface DeferredLightingOptions {
  /** The rig to light with. Defaults to the house golden-hour rig. */
  rig?: LightRig;
  /** The height field. Without one, everything reads as a flat back plane. */
  normals?: NormalBuffer;
  /** Tap budget. Default `'high'`. */
  quality?: LightingQuality;
  /**
   * Scene size in CSS pixels, used to align the normal buffer and to scale the
   * rig's pixel-valued knobs. Defaults to the filter input's size each frame.
   */
  sceneWidth?: number;
  sceneHeight?: number;
  /** Start in a debug view. Default `'final'`. */
  debug?: DebugMode;
  /** Filter padding, in pixels. Default 0 — the pass must not extend bounds. */
  padding?: number;
}

/* ========================================================================== *
 *                                   filter                                   *
 * ========================================================================== */

/** Build the `UniformGroup` matching {@link LightingUniforms}. */
function makeUniformGroup(values: LightingUniforms): UniformGroup {
  const decl: Record<string, { value: unknown; type: string; size?: number }> = {};
  for (const [name, value] of Object.entries(values)) {
    const type = LIGHTING_UNIFORM_TYPES[name] ?? 'vec4<f32>';
    const arr = value as number[];
    // The shaft arrays are four vec4s each; everything else is one.
    const size = name.startsWith('uShaft') ? 4 : 1;
    decl[name] = { value: new Float32Array(arr), type, ...(size > 1 ? { size } : {}) };
  }
  return new UniformGroup(decl as never);
}

/**
 * The deferred scene-lighting pass.
 *
 * One instance per lit scene. Changing the rig or the quality is cheap
 * (a uniform upload / a program rebuild), so a theme switch or a time-of-day
 * transition costs nothing per element.
 */
export class DeferredLightingFilter extends Filter {
  private _rig: LightRig;
  private _quality: LightingQuality;
  private _normals: NormalBuffer | undefined;
  private _time = 0;
  private _debug: number;
  private _sceneWidth: number | undefined;
  private _sceneHeight: number | undefined;
  private _programs = new Map<LightingQuality, GlProgram>();

  constructor(options: DeferredLightingOptions = {}) {
    const rig = options.rig ?? DEFAULT_LIGHT_RIG;
    const quality: LightingQuality = options.quality ?? 'high';
    const width = options.sceneWidth ?? REFERENCE_WIDTH;
    const height = options.sceneHeight ?? Math.round(REFERENCE_WIDTH * 0.66);

    const values = packLightingUniforms(rig, { width, height }, quality);
    const group = makeUniformGroup(values);
    const glProgram = GlProgram.from({
      vertex: PIXI_VERTEX_SOURCE,
      fragment: buildLightingFragment({ quality, target: 'pixi' }),
      name: `deferred-lighting-${quality}`,
    });

    const normalSource = options.normals?.texture.source;

    super({
      glProgram,
      // Zero padding on purpose: this pass lights what is there, it does not
      // spread anything, and padding would put the input texture out of
      // alignment with the scene-space normal buffer for no benefit.
      padding: options.padding ?? 0,
      resources: {
        lightingUniforms: group,
        ...(normalSource !== undefined
          ? { uNormalMap: normalSource, uNormalMapSampler: normalSource.style }
          : {}),
      },
    });

    this._rig = rig;
    this._quality = quality;
    this._normals = options.normals;
    this._debug = debugModeId(options.debug);
    this._sceneWidth = options.sceneWidth;
    this._sceneHeight = options.sceneHeight;
    this._programs.set(quality, glProgram);
  }

  /**
   * WebGL only — there is no `GpuProgram`, by choice (see the module note).
   * Pixi reads this to skip the pass rather than failing to find a GPU program
   * at draw time.
   */
  override readonly compatibleRenderers = RendererType.WEBGL;

  /* ------------------------------- accessors ----------------------------- */

  get rig(): LightRig {
    return this._rig;
  }

  /** The height field currently being sampled, if any. */
  get normals(): NormalBuffer | undefined {
    return this._normals;
  }

  /** Swap the light. One uniform upload; no element touches the CPU. */
  setRig(rig: LightRig): void {
    this._rig = rig;
  }

  get quality(): LightingQuality {
    return this._quality;
  }

  /**
   * Change the tap budget. Rebuilds the program (the tap counts are compile-
   * time constants so the loops unroll), then caches it — flipping between
   * two qualities costs one compile each, ever.
   */
  setQuality(quality: LightingQuality): void {
    if (quality === this._quality) return;
    this._quality = quality;
    let program = this._programs.get(quality);
    if (program === undefined) {
      program = GlProgram.from({
        vertex: PIXI_VERTEX_SOURCE,
        fragment: buildLightingFragment({ quality, target: 'pixi' }),
        name: `deferred-lighting-${quality}`,
      });
      this._programs.set(quality, program);
    }
    this.glProgram = program;
  }

  /** Point the pass at a different height field. */
  setNormals(normals: NormalBuffer | undefined): void {
    this._normals = normals;
    const source = normals?.texture.source;
    if (source !== undefined) {
      this.resources.uNormalMap = source;
      this.resources.uNormalMapSampler = source.style;
    }
  }

  /** Drive dust drift and any animated light. Seconds. */
  setTime(seconds: number): void {
    this._time = Number.isFinite(seconds) ? seconds : 0;
  }

  /** Show a buffer instead of the final image. */
  setDebug(mode: DebugMode): void {
    this._debug = debugModeId(mode);
  }

  /** Tell the pass how big the scene is, for rig scaling and NHB alignment. */
  setSceneSize(width: number, height: number): void {
    this._sceneWidth = width;
    this._sceneHeight = height;
  }

  /* --------------------------------- apply ------------------------------- */

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    const src = input.source;
    const pixelW = src.pixelWidth;
    const pixelH = src.pixelHeight;
    const sceneW = this._sceneWidth ?? input.frame.width;
    const sceneH = this._sceneHeight ?? input.frame.height;

    // The shader rebuilds screen-space pixels from Pixi's own frame uniforms,
    // so all this has to supply is the scene's reciprocal size.
    const xform = normalUvTransform(sceneW, sceneH);

    const values = packLightingUniforms(
      this._rig,
      {
        width: pixelW,
        height: pixelH,
        // Rig radii are authored against a reference-width scene, and the
        // *scene* is what they mean — not the padded texture — so the scale
        // comes from the scene size and the device resolution.
        scale: (sceneW / REFERENCE_WIDTH) * (src.resolution || 1),
        aspect: sceneW / Math.max(1, sceneH),
        time: this._time,
        debug: this._debug,
        normalXform: xform,
      },
      this._quality,
    );

    const uniforms = (this.resources.lightingUniforms as UniformGroup).uniforms as unknown as Record<
      string,
      Float32Array
    >;
    for (const [name, value] of Object.entries(values)) {
      const target = uniforms[name];
      if (target === undefined) continue;
      target.set(value as number[]);
    }
    (this.resources.lightingUniforms as UniformGroup).update();

    filterManager.applyFilter(this, input, output, clearMode);
  }

  /** Release the cached programs. */
  override destroy(): void {
    this._programs.clear();
    super.destroy();
  }
}

/* ========================================================================== *
 *                                 support                                    *
 * ========================================================================== */

/**
 * Whether this renderer can run the pass.
 *
 * Only WebGL is provided (see the module note). A caller that might be on
 * WebGPU should check and leave the scene unlit rather than showing a black
 * screen.
 */
export function isDeferredLightingSupported(renderer: Renderer | null | undefined): boolean {
  if (renderer === null || renderer === undefined) return false;
  // RendererType.WEBGL covers both the WebGL1 and WebGL2 bits Pixi sets.
  return (renderer.type & RendererType.WEBGL) !== 0;
}
