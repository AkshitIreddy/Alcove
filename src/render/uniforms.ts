/**
 * render/uniforms.ts — a `LightRig` compiled down to shader uniforms.
 *
 * The rig is authored in painter's language (`'#ffd79a'`, "upper right",
 * "0.62 hot spot"); the shader wants packed floats. This module is the one
 * translation between them, kept pure and free of both Pixi and WebGL so that:
 *
 *  - the Pixi filter and the offline harness upload *identical* values, and
 *  - the packing is unit-testable with no GPU in the room.
 *
 * Every value is a plain number array, ready to hand to `gl.uniform*` or drop
 * into a Pixi `UniformGroup`.
 */

import { autoKeyOrigin, parseColour, type LightRig, type ShaftSpec } from '../art/lighting';
import { qualityProfile, type LightingQuality } from './glsl';

/** A colour as three 0–1 floats. */
export type RGB = [number, number, number];

/** Every uniform the lighting pass takes, packed. */
export interface LightingUniforms {
  uKeyDir: [number, number, number];
  uKeyColour: RGB;
  uKeyParams: [number, number, number, number];
  uFillColour: RGB;
  uAmbientColour: RGB;
  uShadowColour: RGB;
  uAmbientParams: [number, number, number, number];
  uAOParams: [number, number, number, number];
  uShadowParams: [number, number, number, number];
  uRimColour: RGB;
  uRimParams: [number, number, number];
  uLift: RGB;
  uGamma: RGB;
  uGain: RGB;
  uGradeParams: [number, number, number, number];
  uTempParams: [number, number, number, number];
  uHazeColour: RGB;
  uHazeParams: [number, number, number, number];
  uVignetteColour: RGB;
  uVignetteParams: [number, number, number, number];
  uBloomParams: [number, number, number, number];
  /** Four shafts × four vec4s, flattened as the shader's arrays expect. */
  uShaftA: number[];
  uShaftB: number[];
  uShaftC: number[];
  uShaftD: number[];
  uKeyGrad: [number, number, number, number];
  uNormalXform: [number, number, number, number];
  uFrame: [number, number, number, number];
  uDebug: [number, number, number, number];
}

/** Frame-dependent inputs: everything the rig cannot know on its own. */
export interface FrameInfo {
  /** Frame width in device pixels. */
  width: number;
  /** Frame height in device pixels. */
  height: number;
  /**
   * Scale factor between "rig pixels" and this frame's pixels.
   *
   * A rig's `aoRadius`, `shadowReach`, `bloomRadius` and `heightScale` are
   * authored at a reference scale (a shelf about 1200px wide). Rendering the
   * same scene onto a 320px contact-sheet cell must *shrink* those radii or
   * the AO ring swallows the whole image — which is precisely how a lighting
   * pass stops being resolution-independent. Default: `width / 1200`.
   */
  scale?: number;
  /** Seconds, for dust drift and grain. */
  time?: number;
  /**
   * Aspect ratio of the **scene**, for the shafts and the vignette.
   *
   * Defaults to `width / height`, which is right standalone. Under a Pixi
   * filter, `width`/`height` are the pooled texture's dimensions — not the
   * scene's — so the caller must pass the real aspect or round vignettes come
   * out oval.
   */
  aspect?: number;
  /** Debug view id (see `glsl.ts` `debugModeId`). */
  debug?: number;
  /**
   * Scene size in CSS pixels — what screen-space pixel coordinates are divided
   * by to land in the normal buffer's UV space, plus an optional UV offset.
   *
   * `[1/sceneWidth, 1/sceneHeight, offsetX, offsetY]`. Defaults to the frame's
   * own size, which is right whenever the lit frame *is* the scene.
   */
  normalXform?: readonly [number, number, number, number];
}

/** The width every rig's pixel-valued knobs are authored against. */
export const REFERENCE_WIDTH = 1200;

function rgb(css: string): RGB {
  const c = parseColour(css);
  return [c.r / 255, c.g / 255, c.b / 255];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Unit vector pointing **toward the key source**, in the shader's frame
 * (screen y down, +z out of the screen).
 *
 * `keyAngle` is the direction the light *travels*, so the source is the other
 * way; `keyElevation` lifts it out of the plane, and that lift is what decides
 * whether the scene is raked or flat-lit.
 */
export function keyVector(rig: Pick<LightRig, 'keyAngle' | 'keyElevation'>): [number, number, number] {
  const sx = -Math.cos(rig.keyAngle);
  const sy = -Math.sin(rig.keyAngle);
  const z = Math.max(0.01, rig.keyElevation);
  const len = Math.hypot(sx, sy, z);
  return [sx / len, sy / len, z / len];
}

function packShafts(
  shafts: readonly ShaftSpec[],
  fallbackColour: string,
  max: number,
): Pick<LightingUniforms, 'uShaftA' | 'uShaftB' | 'uShaftC' | 'uShaftD'> {
  const A: number[] = [];
  const B: number[] = [];
  const C: number[] = [];
  const D: number[] = [];
  for (let i = 0; i < 4; i++) {
    const s = i < max ? shafts[i] : undefined;
    if (s === undefined) {
      A.push(0, 0, 0, 1);
      B.push(0.1, 1, 0.5, 0);
      C.push(0, 0, 0, 1);
      D.push(0, 1, 0, 0);
      continue;
    }
    const dx = Math.cos(s.angle);
    const dy = Math.sin(s.angle);
    const dl = Math.hypot(dx, dy) || 1;
    A.push(s.origin.x, s.origin.y, dx / dl, dy / dl);
    B.push(
      clamp(s.width, 0.005, 2),
      clamp(s.length, 0.02, 4),
      clamp(s.softness, 0, 1),
      clamp(s.opacity, 0, 1),
    );
    const col = rgb(s.colour ?? fallbackColour);
    C.push(col[0], col[1], col[2], clamp(s.spread ?? 1.6, 0.2, 6));
    // dustScale rises with dust so a dustier shaft also gets finer motes.
    D.push(clamp(s.dust ?? 0, 0, 1), 0.6 + (s.dust ?? 0) * 1.6, 0, 1);
  }
  return { uShaftA: A, uShaftB: B, uShaftC: C, uShaftD: D };
}

/**
 * Compile a rig for a specific frame.
 *
 * **Total** — a rig with junk in it still produces finite uniforms, because a
 * NaN reaching a shader is a black screen with no error message.
 */
export function packLightingUniforms(
  rig: LightRig,
  frame: FrameInfo,
  quality: LightingQuality = 'high',
): LightingUniforms {
  const w = Math.max(1, frame.width);
  const h = Math.max(1, frame.height);
  const scale = frame.scale ?? w / REFERENCE_WIDTH;
  const s = clamp(Number.isFinite(scale) ? scale : 1, 0.06, 8);
  const p = qualityProfile(quality);

  const keyDir = keyVector(rig);
  const shafts = packShafts(rig.shafts, rig.keyColour, p.maxShafts);
  const origin = rig.keyOrigin === 'auto' ? autoKeyOrigin(rig.keyAngle) : rig.keyOrigin;

  return {
    uKeyDir: keyDir,
    uKeyColour: rgb(rig.keyColour),
    uKeyParams: [
      clamp(rig.keyIntensity, 0, 2),
      clamp(rig.keyWrap, 0, 1),
      clamp(rig.hotSpot, 0, 1),
      clamp(rig.specular, 0, 1),
    ],
    uFillColour: rgb(rig.fillColour),
    uAmbientColour: rgb(rig.ambientColour),
    uShadowColour: rgb(rig.shadowColour),
    uAmbientParams: [
      clamp(rig.fillIntensity, 0, 1),
      clamp(rig.ambientLevel, 0, 1),
      clamp(rig.bounce, 0, 1),
      clamp(rig.skyFill, 0, 1),
    ],
    uAOParams: [
      clamp(rig.ambientOcclusion, 0, 1),
      clamp(rig.aoRadius * s, 0, 160),
      clamp(rig.aoPower, 0.05, 4),
      clamp(rig.aoBias, 0, 0.2),
    ],
    uShadowParams: [
      clamp(rig.contactStrength, 0, 1.5),
      clamp(rig.shadowReach * s, 0, 1200),
      clamp(rig.shadowSoftness, 0, 1),
      // heightScale is a *height* in pixels, so it scales with the frame too;
      // without this the same book casts a longer shadow on a bigger canvas.
      clamp(rig.heightScale * s, 1, 4096),
    ],
    uRimColour: rgb(rig.rimColour),
    uRimParams: [
      clamp(rig.rimStrength, 0, 1.5),
      clamp(rig.rimSharpness, 0.1, 12),
      clamp(rig.rimWrap, 0, 1),
    ],
    uLift: [rig.lift[0], rig.lift[1], rig.lift[2]],
    uGamma: [rig.gamma[0], rig.gamma[1], rig.gamma[2]],
    uGain: [rig.gain[0], rig.gain[1], rig.gain[2]],
    uGradeParams: [
      clamp(rig.exposure, 0.2, 3),
      clamp(rig.contrast, 0, 1),
      clamp(rig.saturation, 0, 2),
      clamp(rig.tonemap, 0, 1),
    ],
    uTempParams: [
      clamp(rig.temperatureShift, -1, 1),
      clamp(rig.temperaturePivot, 0, 1),
      clamp(rig.shadowTint, 0, 1),
      clamp(rig.highlightTint, 0, 1),
    ],
    uHazeColour: rgb(rig.hazeColour),
    uHazeParams: [
      clamp(rig.hazeStrength, 0, 1),
      clamp(rig.hazeDepthBias, 0, 1),
      clamp(rig.localColour, 0, 1),
      clamp(rig.grain, 0, 0.1),
    ],
    uVignetteColour: rgb(rig.vignetteColour),
    uVignetteParams: [
      clamp(rig.vignette, 0, 1),
      clamp(rig.vignetteRoundness, 0, 1),
      clamp(rig.vignetteFeather, 0.02, 1.2),
      clamp(rig.vignetteExposure, 0, 0.5),
    ],
    uBloomParams: [
      clamp(rig.bloom, 0, 1),
      clamp(rig.bloomThreshold, 0, 1),
      // Hard cap, and tighter the stronger the glow. Past ~18px the 12-tap
      // spiral is too sparse to be a kernel and the glow visibly streaks along
      // its tap directions — and the brighter the bloom, the more obvious
      // those streaks are. So a rig asking for a big hot glow gets a *tight*
      // hot glow, which is what a hot spot looks like anyway.
      // (See qa/deferred sheetBloom.)
      clamp(rig.bloomRadius * s * (1 - clamp(rig.bloom, 0, 1) * 0.45), 0, 18),
      clamp(rig.bloomKnee, 0.001, 1),
    ],
    ...shafts,
    uKeyGrad: [
      origin.x,
      origin.y,
      clamp(rig.keyFalloff, 0, 1),
      clamp(rig.keyRadius, 0.1, 4),
    ],
    uNormalXform: [
      frame.normalXform?.[0] ?? 1 / w,
      frame.normalXform?.[1] ?? 1 / h,
      frame.normalXform?.[2] ?? 0,
      frame.normalXform?.[3] ?? 0,
    ],
    // xy: texel size of the *sampled texture* (uv-space offsets);
    // z: aspect of the *scene* (frame-space composition).
    uFrame: [1 / w, 1 / h, frame.aspect ?? w / h, frame.time ?? 0],
    uDebug: [frame.debug ?? 0, 0, 0, 0],
  };
}

/** Every uniform name the shader declares — used to build the Pixi group. */
export const LIGHTING_UNIFORM_NAMES = [
  'uKeyDir',
  'uKeyColour',
  'uKeyParams',
  'uFillColour',
  'uAmbientColour',
  'uShadowColour',
  'uAmbientParams',
  'uAOParams',
  'uShadowParams',
  'uRimColour',
  'uRimParams',
  'uLift',
  'uGamma',
  'uGain',
  'uGradeParams',
  'uTempParams',
  'uHazeColour',
  'uHazeParams',
  'uVignetteColour',
  'uVignetteParams',
  'uBloomParams',
  'uShaftA',
  'uShaftB',
  'uShaftC',
  'uShaftD',
  'uKeyGrad',
  'uNormalXform',
  'uFrame',
  'uDebug',
] as const;

/** The GLSL type of each uniform, for the Pixi `UniformGroup` declaration. */
export const LIGHTING_UNIFORM_TYPES: Readonly<Record<string, string>> = {
  uKeyDir: 'vec3<f32>',
  uKeyColour: 'vec3<f32>',
  uKeyParams: 'vec4<f32>',
  uFillColour: 'vec3<f32>',
  uAmbientColour: 'vec3<f32>',
  uShadowColour: 'vec3<f32>',
  uAmbientParams: 'vec4<f32>',
  uAOParams: 'vec4<f32>',
  uShadowParams: 'vec4<f32>',
  uRimColour: 'vec3<f32>',
  uRimParams: 'vec3<f32>',
  uLift: 'vec3<f32>',
  uGamma: 'vec3<f32>',
  uGain: 'vec3<f32>',
  uGradeParams: 'vec4<f32>',
  uTempParams: 'vec4<f32>',
  uHazeColour: 'vec3<f32>',
  uHazeParams: 'vec4<f32>',
  uVignetteColour: 'vec3<f32>',
  uVignetteParams: 'vec4<f32>',
  uBloomParams: 'vec4<f32>',
  uShaftA: 'vec4<f32>',
  uShaftB: 'vec4<f32>',
  uShaftC: 'vec4<f32>',
  uShaftD: 'vec4<f32>',
  uKeyGrad: 'vec4<f32>',
  uNormalXform: 'vec4<f32>',
  // uInputSize / uOutputFrame come from Pixi's own global filter group and
  // must NOT be declared in ours, or the two collide.
  uFrame: 'vec4<f32>',
  uDebug: 'vec4<f32>',
};

/* ========================================================================== *
 *                                 alignment                                  *
 * ========================================================================== */

/**
 * The transform taking **screen pixels** to normal-buffer UV.
 *
 * The shader reconstructs screen pixels from Pixi's own frame uniforms, so all
 * this has to carry is the scene's reciprocal size (plus an offset, if the
 * buffer does not start at the scene origin). Feed it to
 * {@link packLightingUniforms}'s `normalXform`.
 *
 * Lives here rather than beside the buffers because it is pure arithmetic and
 * the unit tests must reach it without importing PixiJS.
 */
export function normalUvTransform(
  sceneWidth: number,
  sceneHeight: number,
  offsetX = 0,
  offsetY = 0,
): [number, number, number, number] {
  const sw = Math.max(1, sceneWidth);
  const sh = Math.max(1, sceneHeight);
  return [1 / sw, 1 / sh, offsetX / sw, offsetY / sh];
}
