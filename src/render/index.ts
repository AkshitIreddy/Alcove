/**
 * render/ — deferred scene lighting.
 *
 * `docs/design/painted-rendering.md` Pillar 2, in four files:
 *
 * | file                  | what it owns                                      |
 * |-----------------------|---------------------------------------------------|
 * | `normals.ts`          | how an element contributes height + normal        |
 * | `glsl.ts`             | the lighting maths, as shader source               |
 * | `uniforms.ts`         | a `LightRig` compiled to shader uniforms           |
 * | `gbuffer.ts`          | the height field as a Pixi texture                 |
 * | `deferredLighting.ts` | the one fullscreen pass, as a Pixi filter          |
 * | `testScene.ts`        | flat boxes on a plank, for proving the pass works  |
 *
 * The shape of the whole thing, in one example:
 *
 * ```ts
 * import { CanvasNormalBuffer, DeferredLightingFilter, emitHeight } from './render';
 * import { getLightRig } from './art/lighting';
 *
 * const normals = new CanvasNormalBuffer({ width, height });
 * for (const book of books) {
 *   emitHeight(normals.ctx, { kind: 'roundedBox', radius: 0.24 }, book.rect);
 * }
 * normals.flush();
 *
 * world.filters = [new DeferredLightingFilter({ rig: getLightRig(theme.light), normals })];
 * ```
 *
 * Elements draw **albedo only**. Nothing shades itself.
 */

export {
  buildLightingFragment,
  debugModeId,
  DEBUG_MODES,
  LIGHTING_UNIFORMS,
  PIXI_VERTEX_SOURCE,
  QUALITY_PROFILES,
  qualityProfile,
  RAW_VERTEX_SOURCE,
  type DebugMode,
  type FragmentOptions,
  type LightingQuality,
  type QualityProfile,
} from './glsl';

export {
  clearShapeCache,
  decodeSurface,
  emitBackplane,
  emitHeight,
  emitSpines,
  EMPTY_SURFACE_BYTES,
  encodeSurface,
  HEIGHT_SHAPE_KINDS,
  PROFILE_MAX,
  rasterizeShape,
  sampleShape,
  shapeCacheSize,
  shapeCanvas,
  shapeKey,
  type BevelEdges,
  type EmitOptions,
  type HeightShape,
  type NormalCanvas,
  type NormalCtx,
  type ProfileAxis,
  type SpineContribution,
  type SurfacePoint,
} from './normals';

export {
  keyVector,
  normalUvTransform,
  LIGHTING_UNIFORM_NAMES,
  LIGHTING_UNIFORM_TYPES,
  packLightingUniforms,
  REFERENCE_WIDTH,
  type FrameInfo,
  type LightingUniforms,
  type RGB,
} from './uniforms';

export {
  CanvasNormalBuffer,
  DEFAULT_NORMAL_RESOLUTION,
  SpriteNormalBuffer,
  type CanvasNormalBufferOptions,
  type NormalBuffer,
  type SpriteNormalBufferOptions,
} from './gbuffer';

export {
  DeferredLightingFilter,
  isDeferredLightingSupported,
  type DeferredLightingOptions,
} from './deferredLighting';

export { buildTestScene, type TestScene, type TestSceneOptions } from './testScene';
