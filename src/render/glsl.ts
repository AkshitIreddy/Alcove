/**
 * render/glsl.ts — the deferred scene-lighting shader, as source.
 *
 * This is the single place the lighting *maths* lives. It is emitted as GLSL
 * ES 3.00 source strings so that exactly the same code runs in two places:
 *
 *  - `render/deferredLighting.ts` wraps it in a PixiJS v8 `Filter`;
 *  - the offline contact-sheet harness wraps it in a raw WebGL2 program.
 *
 * If the harness says the light reads well, the app gets *that* light — not a
 * re-implementation of it.
 *
 * ## The model (painted-rendering.md, Pillar 2)
 *
 * Nothing shades itself. The scene is composited twice:
 *
 *  - **albedo** — flat local colour + texture, no light at all;
 *  - **NHB** (normal/height buffer) — `rg` = screen-space normal xy, `b` =
 *    height above the back plane, `a` = coverage.
 *
 * One fullscreen fragment shader then lights the composite:
 *
 * ```
 *  reconstruct N,h  →  key (wrapped lambert + hot-spot blow-out)
 *                   →  fill + ambient
 *                   →  height-cavity AO
 *                   →  screen-space contact / cast shadow march
 *                   →  rim
 *                   →  warm→cool temperature split
 *                   →  volumetric shafts (+ dust)
 *                   →  bloom (spiral taps on the hot mask)
 *                   →  vignette
 *                   →  filmic tonemap + lift/gamma/gain + sat + contrast
 * ```
 *
 * Everything is in normalized UV / texel space, so the pass is
 * **resolution-independent**: the same rig looks the same on a 320px contact
 * sheet cell and a 4K window, and costs one draw either way.
 *
 * ## Conventions
 *
 * Screen space has **y down** (canvas convention), and normals are encoded in
 * that same frame: `N.y > 0` means the surface tilts toward the bottom of the
 * screen. `N.z` always points *out* of the screen and is reconstructed, never
 * stored. `uKeyDir` points **toward the light source**.
 *
 * Height is 0–1 in the buffer; `uHeightScale` says how many screen pixels one
 * unit of height is worth, which is what makes the shadow march a *cast*
 * shadow rather than a smear.
 */

/* ========================================================================== *
 *                                  quality                                   *
 * ========================================================================== */

/**
 * How much the one pass is allowed to spend. Every level runs the *same*
 * lighting model — the knobs only change tap counts, so a low-end machine
 * gets a softer version of the same picture rather than a different one.
 */
export type LightingQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  /** Directions sampled for the height-cavity AO ring. */
  aoDirections: number;
  /** Radii per direction (the ring is sampled at several scales). */
  aoRings: number;
  /** Steps in the screen-space shadow march. */
  shadowSteps: number;
  /** Taps in the bloom spiral (0 disables the in-shader bloom entirely). */
  bloomTaps: number;
  /** Max shafts the loop is unrolled for. */
  maxShafts: number;
  /** Whether dust motes are evaluated inside shafts. */
  dust: boolean;
}

/** Tap budgets per quality level. Texture fetches ≈ aoDir*aoRings + steps + taps. */
export const QUALITY_PROFILES: Readonly<Record<LightingQuality, QualityProfile>> = {
  low: { aoDirections: 4, aoRings: 1, shadowSteps: 6, bloomTaps: 0, maxShafts: 2, dust: false },
  medium: { aoDirections: 6, aoRings: 2, shadowSteps: 10, bloomTaps: 8, maxShafts: 3, dust: true },
  high: { aoDirections: 8, aoRings: 2, shadowSteps: 14, bloomTaps: 12, maxShafts: 4, dust: true },
  ultra: { aoDirections: 12, aoRings: 3, shadowSteps: 22, bloomTaps: 20, maxShafts: 4, dust: true },
};

/** Resolve a quality name to its profile, falling back to `high`. */
export function qualityProfile(q: LightingQuality | undefined): QualityProfile {
  return QUALITY_PROFILES[q ?? 'high'] ?? QUALITY_PROFILES.high;
}

/* ========================================================================== *
 *                                  vertex                                    *
 * ========================================================================== */

/** Vertex shader for the Pixi filter (Pixi supplies the quad + matrices). */
export const PIXI_VERTEX_SOURCE = /* glsl */ `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

/** Vertex shader for the standalone harness (a plain fullscreen triangle). */
export const RAW_VERTEX_SOURCE = /* glsl */ `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;
void main(void) {
  vTextureCoord = aPosition;
  gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
}
`;

/* ========================================================================== *
 *                              uniform block                                 *
 * ========================================================================== */

/**
 * The uniform declarations, shared verbatim by both wrappers.
 *
 * Packed into vec3/vec4s rather than scalars because Pixi hoists custom filter
 * uniforms into a std140 UBO, where every scalar still costs a 16-byte slot —
 * packing keeps the block small enough to stay in one upload.
 */
export const LIGHTING_UNIFORMS = /* glsl */ `
uniform sampler2D uNormalMap;

// key
uniform vec3  uKeyDir;        // unit vector TOWARD the source (screen y down, +z out)
uniform vec3  uKeyColour;
uniform vec4  uKeyParams;     // intensity, wrap, hotSpot, specular

// fill / ambient
uniform vec3  uFillColour;
uniform vec3  uAmbientColour;
uniform vec3  uShadowColour;
uniform vec4  uAmbientParams; // fillIntensity, ambientLevel, bounce, skyFill

// occlusion + cast shadow
uniform vec4  uAOParams;      // strength, radiusPx, power, bias
uniform vec4  uShadowParams;  // strength, reachPx, softness, heightScale

// rim
uniform vec3  uRimColour;
uniform vec3  uRimParams;     // strength, sharpness, wrap

// grade
uniform vec3  uLift;
uniform vec3  uGamma;
uniform vec3  uGain;
uniform vec4  uGradeParams;   // exposure, contrast, saturation, tonemap
uniform vec4  uTempParams;    // temperature, pivot, shadowTint, highlightTint

// atmosphere
uniform vec3  uHazeColour;
uniform vec4  uHazeParams;    // strength, depthBias, localColour, grain
uniform vec3  uVignetteColour;
uniform vec4  uVignetteParams;// strength, roundness, feather, exposureComp
uniform vec4  uBloomParams;   // strength, threshold, radiusPx, knee

// volumetrics (xy = origin, zw = direction) / (width, length, softness, opacity)
uniform vec4  uShaftA[4];
uniform vec4  uShaftB[4];
uniform vec4  uShaftC[4];     // rgb = colour, w = spread
uniform vec4  uShaftD[4];     // dust, dustScale, phase, enabled

uniform vec4  uKeyGrad;       // origin.xy (uv), falloff, radius
uniform vec4  uNormalXform;   // 1/sceneWidth, 1/sceneHeight, offset.xy (NHB uv)

// Supplied automatically by Pixi's filter system; the raw harness sets them by
// hand to the same values so one shader serves both.
uniform vec4  uInputSize;     // input frame w, h, 1/w, 1/h
uniform vec4  uOutputFrame;   // input frame x, y, w, h — in screen pixels
uniform vec4  uFrame;         // texelWidth, texelHeight, aspect, time
uniform vec4  uDebug;         // mode, splitX, gamma-out, unused
`;

/* ========================================================================== *
 *                                  helpers                                   *
 * ========================================================================== */

const HELPERS = /* glsl */ `
const float PI = 3.14159265359;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/**
 * Interleaved gradient noise (Jimenez).
 *
 * White noise as a march dither leaves visible salt-and-pepper in every
 * penumbra — the exact speckle the first render had. IGN is spatially
 * correlated at the scale a human notices, so the same dithering budget
 * disappears into the image instead of crawling over it.
 */
float ign(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

/**
 * Filter UV → **scene UV** (0–1 across the whole scene).
 *
 * Every frame-space effect — the key gradient, the shafts, the vignette, the
 * grain — has to agree about where the middle of the picture is, and
 * vTextureCoord does not know: under Pixi it spans a padded sub-rect of a
 * pooled texture. Route them all through here and the composition is the same
 * whether the pass runs standalone or as a filter.
 */
vec2 sceneUv(vec2 uv) {
  return (uv * uInputSize.xy + uOutputFrame.xy) * uNormalXform.xy;
}

/**
 * How much key reaches a point in the frame at all.
 *
 * A real interior is not lit by a sun at infinity: it is lit by a *window*,
 * and the far corner of the room genuinely receives less. This frame-wide
 * gradient is the single biggest compositional difference between a lit
 * diagram and a painting — it puts a bright side and a dark side on the whole
 * picture, before any individual object is shaded at all.
 */
float keyReach(vec2 uv) {
  float falloff = clamp(uKeyGrad.z, 0.0, 1.0);
  if (falloff <= 0.001) return 1.0;
  vec2 d = (sceneUv(uv) - uKeyGrad.xy) * vec2(uFrame.z, 1.0);
  float r = length(d) / max(0.08, uKeyGrad.w);
  float atten = 1.0 / (1.0 + r * r * 1.25);
  return mix(1.0, atten, falloff);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * valueNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

/**
 * Painter's temperature shift: warm lifts red, drags blue down, carries green
 * a third of the way, then renormalizes luminance so a shift is a shift and
 * not a secret exposure change.
 *
 * **Multiplicative, deliberately.** The obvious additive version
 * (c + offset * amount) puts an electric blue fringe on every dark texel in
 * the frame: on a near-black pixel the negative red clamps to zero while the
 * positive blue survives, and the luminance renormalization then amplifies
 * what is left. A channel gain cannot do that — black times anything is still
 * black — so the shift only ever bends colour that is already there.
 */
vec3 shiftTemp(vec3 c, float amount) {
  float before = luma(c);
  vec3 t = c * vec3(1.0 + 0.26 * amount, 1.0 + 0.06 * amount, 1.0 - 0.24 * amount);
  float after = max(1e-4, luma(t));
  return max(vec3(0.0), t * mix(1.0, before / after, 0.8));
}

/**
 * Split tone: shadows toward one hue, highlights toward another.
 *
 * Same trap, same answer — the tint is the *chroma* of the target colour
 * (colour minus its own luminance), added in proportion to how bright the
 * pixel already is. A black pixel gets no tint at all, so shadows deepen in
 * hue rather than glowing.
 */
vec3 splitTone(vec3 c, vec3 shadowHue, float shadowAmt, vec3 highHue, float highAmt) {
  float l = luma(c);
  vec3 sc = shadowHue - vec3(luma(shadowHue));
  vec3 hc = highHue - vec3(luma(highHue));
  vec3 outc = c;
  outc += sc * (shadowAmt * 0.9 * l * (1.0 - smoothstep(0.0, 0.55, l)));
  outc += hc * (highAmt * 0.55 * smoothstep(0.3, 0.95, l));
  return max(vec3(0.0), outc);
}

/** Blow a colour toward a hot version of its own hue (gold stays gold). */
vec3 blowOut(vec3 c, float k) {
  vec3 hot = mix(c, vec3(1.0, 0.985, 0.94), vec3(0.86, 0.78, 0.62));
  float t = clamp(k, 0.0, 1.0);
  return mix(c, hot, t * t * (3.0 - 2.0 * t));
}

/** Narkowicz ACES approximation — the filmic shoulder that stops clipping. */
vec3 tonemapACES(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/** Gentler Reinhard-with-white-point, for rigs that want to keep their mids. */
vec3 tonemapReinhard(vec3 x) {
  const float w = 2.4;
  return clamp((x * (1.0 + x / (w * w))) / (1.0 + x), 0.0, 1.0);
}

vec3 saturateBy(vec3 c, float k) {
  return max(vec3(0.0), mix(vec3(luma(c)), c, k));
}

/** Lift / gamma / gain, the standard colourist control triple. */
vec3 lgg(vec3 c, vec3 lift, vec3 gamma, vec3 gain) {
  vec3 v = clamp(c, 0.0, 1.0);
  v = v * (1.5 - 0.5 * lift) + 0.5 * lift;      // lift raises the floor
  v = clamp(v, 0.0, 1.0) * gain;                 // gain scales the ceiling
  v = pow(max(v, vec3(1e-5)), 1.0 / max(gamma, vec3(1e-3)));
  return v;
}

/** Symmetric S-curve around 0.5. */
vec3 sCurve(vec3 c, float k) {
  vec3 x = clamp(c, 0.0, 1.0);
  vec3 s = x * x * (3.0 - 2.0 * x);
  return mix(x, s, clamp(k, 0.0, 1.0));
}
`;

/* ========================================================================== *
 *                                 g-buffer                                   *
 * ========================================================================== */

const GBUFFER = /* glsl */ `
struct Surface {
  vec3 n;       // unit normal, screen frame (y down, z out)
  float height; // 0..1 above the back plane
  float cover;  // 0 = untouched backdrop, 1 = solid geometry
};

/**
 * Map a filter UV to a normal-buffer UV — via screen pixels, deliberately.
 *
 * vTextureCoord does *not* run 0 to 1. Pixi hands a filter a texture out of a
 * pool that is usually larger than the region being filtered, so the coord
 * spans only the used sub-rect; sampling a scene-space buffer with it directly
 * shows a zoomed crop of the height field, and every shadow ends up attached
 * to the wrong book. (That is exactly what the first Pixi render did — see
 * qa/deferred sheetPixi.)
 *
 * The reliable route is through screen space: vTextureCoord * uInputSize.xy
 * is the pixel offset inside the input frame, and uOutputFrame.xy is where
 * that frame sits on screen. uNormalXform.xy then carries 1/sceneSize.
 */
vec2 normalUv(vec2 uv) {
  return sceneUv(uv) + uNormalXform.zw;
}

Surface readSurface(vec2 uv) {
  vec4 nh = texture(uNormalMap, normalUv(uv));
  Surface s;
  s.cover = nh.w;
  s.height = nh.z;
  vec2 xy = nh.xy * 2.0 - 1.0;
  // Untouched texels decode to (0,0) which is already flat-facing; blending
  // toward the flat normal by coverage keeps element edges from ringing.
  xy *= s.cover;
  float len2 = dot(xy, xy);
  if (len2 > 1.0) xy /= sqrt(len2);
  s.n = normalize(vec3(xy, sqrt(max(1e-4, 1.0 - min(1.0, dot(xy, xy))))));
  return s;
}

float readHeight(vec2 uv) {
  return texture(uNormalMap, clamp(normalUv(uv), vec2(0.0), vec2(1.0))).z;
}
`;

/* ========================================================================== *
 *                             the lighting passes                            *
 * ========================================================================== */

function aoPass(p: QualityProfile): string {
  return /* glsl */ `
/**
 * Height-cavity ambient occlusion.
 *
 * Not SSAO (there is no depth buffer and no view matrix) — the cheaper,
 * better-behaved trick for a 2.5D painted scene: a texel is occluded to the
 * degree its neighbours stand *above* it. Recesses, the gap between two book
 * spines, the joint where a plank meets the case back all fall out for free,
 * and a flat surface costs nothing because every neighbour matches.
 */
float ambientOcclusion(vec2 uv, float h) {
  float radius = uAOParams.y;
  if (uAOParams.x <= 0.001 || radius <= 0.0) return 1.0;
  vec2 texel = uFrame.xy;
  float occ = 0.0;
  float wsum = 0.0;
  const int DIRS = ${p.aoDirections};
  const int RINGS = ${p.aoRings};
  // A golden-angle spiral rather than a regular ring: a regular ring on a
  // straight edge produces visible banding at the exact spacing of the ring.
  for (int r = 0; r < RINGS; r++) {
    float rf = (float(r) + 1.0) / float(RINGS);
    float w = mix(1.0, 0.45, rf);
    for (int i = 0; i < DIRS; i++) {
      float a = (float(i) + 0.5) / float(DIRS) * 6.2831853 + float(r) * 2.39996;
      vec2 off = vec2(cos(a), sin(a)) * radius * rf;
      float hs = readHeight(uv + off * texel);
      // Only *higher* neighbours occlude, and the further they are the less
      // they matter — that ratio is what separates a crease from a cliff.
      float d = max(0.0, hs - h - uAOParams.w);
      occ += w * (d / (d + 0.09 * rf + 0.02));
      wsum += w;
    }
  }
  float ao = 1.0 - clamp(occ / max(1.0, wsum) * uAOParams.x * 2.35, 0.0, 1.0);
  return pow(max(ao, 0.0), max(0.05, uAOParams.z));
}
`;
}

function shadowPass(p: QualityProfile): string {
  return /* glsl */ `
/**
 * Screen-space contact / cast shadow.
 *
 * March from the texel toward the light. If anything along the way pokes above
 * the ray climbing at the key's elevation, this texel is in its shadow. Books
 * shadow their neighbours, foliage drops onto wood, everything standing on a
 * plank gets the tight dark line where it meets it — the spec's contact-shadow
 * rule, computed rather than authored.
 *
 * Falls off with distance so the near shadow is dark and tight and the far one
 * fades, which is the whole reason contact shadows sell weight.
 */
float castShadow(vec2 uv, float h) {
  float strength = uShadowParams.x;
  float reach = uShadowParams.y;
  if (strength <= 0.001 || reach <= 0.25) return 0.0;
  vec2 lxy = uKeyDir.xy;
  float lxyLen = length(lxy);
  if (lxyLen < 1e-3) return 0.0;
  vec2 dir = lxy / lxyLen;
  vec2 texel = uFrame.xy;
  // Height gained per pixel travelled toward the source, in buffer units.
  float climb = (uKeyDir.z / max(0.15, lxyLen)) / max(1.0, uShadowParams.w);
  // Dither the ray start so banding becomes texture rather than terraces.
  // No stochastic jitter. Both white noise and IGN leave a visible lattice
  // across the large near-uniform regions a shelf is full of; a fixed
  // half-step offset with quadratic spacing and a weighted average is smooth
  // enough on its own, and smooth beats unbiased for a picture.
  float jitter = 0.5;
  float occ = 0.0;
  float wsum = 0.0;
  const int STEPS = ${p.shadowSteps};
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + jitter) / float(STEPS);
    float dist = t * t * reach;                 // quadratic: dense near contact
    float rayH = h + dist * climb;
    float hs = readHeight(uv + dir * dist * texel);
    float over = hs - rayH;
    float hit = smoothstep(0.0, max(0.006, uShadowParams.z * 0.26), over);
    // Weighted *average*, not a max: a max turns every dithered ray start into
    // a full-strength decision, which is what makes marched shadows crunch.
    // Near steps carry most of the weight, so contact stays tight and dark
    // while a distant occluder — the plank two hundred pixels above — only
    // veils. Without that steep a falloff the whole band under every shelf
    // crushes to black and the books in it stop being readable.
    float w = mix(1.0, 0.06, t * t);
    occ += hit * w;
    wsum += w;
  }
  occ /= max(1e-4, wsum);
  // Re-expand: the average lands low, so a soft knee puts the contact back
  // where it belongs without reintroducing the per-pixel decision.
  occ = smoothstep(0.03, 0.78, occ);
  // Never a total eclipse: 12% of the key survives even the deepest shadow, so
  // shapes inside it still turn. Fully black shadow shapes are the thing that
  // makes a render read as a diagram of lighting rather than as light.
  return clamp(occ * strength, 0.0, 0.88);
}
`;
}

function shaftPass(p: QualityProfile): string {
  return /* glsl */ `
/**
 * Volumetric shafts.
 *
 * Analytic, not marched: distance to a widening ray, feathered by softness and
 * faded along its length. Dust is fbm inside the band, drifting on uFrame.w,
 * so a shaft looks like air rather than a printed wedge.
 */
vec3 lightShafts(vec2 uv, float cover, float height) {
  vec3 acc = vec3(0.0);
  vec2 p = sceneUv(uv);
  const int N = ${p.maxShafts};
  for (int i = 0; i < N; i++) {
    if (uShaftD[i].w < 0.5) continue;
    vec2 origin = uShaftA[i].xy;
    vec2 dir = normalize(uShaftA[i].zw + vec2(1e-5, 0.0));
    float width = uShaftB[i].x;
    float len = uShaftB[i].y;
    float soft = clamp(uShaftB[i].z, 0.0, 1.0);
    float opacity = uShaftB[i].w;
    float spread = max(0.2, uShaftC[i].w);

    vec2 d = (p - origin) * vec2(uFrame.z, 1.0);
    float along = dot(d, normalize(dir * vec2(uFrame.z, 1.0)));
    if (along < -width) continue;
    float perp = abs(d.x * -dir.y + d.y * dir.x);
    float t = clamp(along / max(1e-3, len), 0.0, 1.0);
    float w = width * mix(1.0, spread, t);
    float band = 1.0 - smoothstep(w * (1.0 - soft * 0.92), w, perp);
    float reach = 1.0 - smoothstep(0.35, 1.0, t);
    float core = pow(band, 1.0 + soft * 2.0) * reach;
    ${
      p.dust
        ? `
    float dust = uShaftD[i].x;
    if (dust > 0.001) {
      vec2 dp = vec2(perp, along) * uShaftD[i].y;
      dp += vec2(uFrame.w * 0.02, -uFrame.w * 0.05);
      float m = fbm(dp * 22.0);
      core *= mix(1.0, 0.45 + 1.15 * m, dust);
    }`
        : ''
    }
    // Shafts read *through* air, so they dim over solid geometry — otherwise
    // they read as a decal laid on top of the books.
    float occlude = mix(1.0, 0.42, cover * (0.45 + 0.55 * height));
    acc += uShaftC[i].rgb * (opacity * core * occlude);
  }
  return acc;
}
`;
}

function bloomPass(p: QualityProfile): string {
  if (p.bloomTaps <= 0) {
    return /* glsl */ `
vec3 bloomGlow(vec2 uv, vec3 lit) { return vec3(0.0); }
`;
  }
  return /* glsl */ `
/**
 * Single-pass bloom.
 *
 * A real bloom is a downsample chain; we cannot afford a second target and the
 * spec says one pass. So: sample the *albedo* on a golden-angle spiral, weight
 * each tap by how hot it would be lit, and accumulate. It is not separable and
 * it is not physically a Gaussian, but a hot-spot glow only has to be soft and
 * hue-correct, and this is both — at ${p.bloomTaps} taps and no extra target.
 */
vec3 bloomGlow(vec2 uv, vec3 lit) {
  float strength = uBloomParams.x;
  if (strength <= 0.001) return vec3(0.0);
  float threshold = uBloomParams.y;
  float radius = uBloomParams.z;
  float knee = max(1e-3, uBloomParams.w);
  vec2 texel = uFrame.xy;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  const int TAPS = ${p.bloomTaps};
  // Fixed start angle, and a deliberately *tight* radius.
  //
  // Three failure modes bracket this. Per-pixel random rotation (white noise
  // or IGN) makes neighbouring pixels integrate different taps and paints a
  // fine dot lattice over every large bright surface. A smooth low-frequency
  // rotation interferes with itself and weaves a basket pattern. A fixed
  // rotation at a *wide* radius smears bright edges into streaks along the
  // tap directions. A fixed rotation at a tight radius has none of them: at
  // this scale the spiral is dense enough to be a real kernel, and a tight
  // glow around hot spots is what the reference actually shows anyway.
  float ang = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float fi = (float(i) + 0.5) / float(TAPS);
    float r = sqrt(fi) * radius;
    ang += 2.39996323;
    vec2 off = vec2(cos(ang), sin(ang)) * r;
    vec2 suv = uv + off * texel;
    vec3 a = texture(uTexture, clamp(suv, vec2(0.0), vec2(1.0))).rgb;
    Surface s = readSurface(clamp(suv, vec2(0.0), vec2(1.0)));
    float ndl = clamp((dot(s.n, uKeyDir) + uKeyParams.y) / (1.0 + uKeyParams.y), 0.0, 1.0);
    vec3 hot = a * (0.25 + ndl * uKeyParams.x * 1.35) * uKeyColour;
    float l = luma(hot);
    float w = smoothstep(threshold, threshold + knee, l) * (1.0 - fi * 0.55);
    acc += hot * w;
    wsum += w;
  }
  if (wsum <= 1e-4) return vec3(0.0);
  vec3 glow = acc / float(TAPS);
  // Keep the glow the hue of what is glowing, not white.
  return glow * strength * 2.6;
}
`;
}

/* ========================================================================== *
 *                                    main                                    *
 * ========================================================================== */

const MAIN = /* glsl */ `
vec3 lightScene(vec2 uv, out float alphaOut) {
  vec4 albedoSample = texture(uTexture, uv);
  vec3 albedo = albedoSample.rgb;
  // Premultiplied sources come back with rgb already scaled; undo it so the
  // lighting maths sees the real local colour.
  if (albedoSample.a > 0.003) albedo /= albedoSample.a;
  alphaOut = albedoSample.a;

  Surface s = readSurface(uv);

  /* ---- key ------------------------------------------------------------- */
  float ndl = dot(s.n, uKeyDir);
  float wrap = uKeyParams.y;
  float lambert = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  // A painter's terminator: soft in the mids, then it commits.
  lambert = lambert * lambert * (3.0 - 2.0 * lambert);
  float key = lambert * uKeyParams.x;

  /* ---- occlusion + cast shadow ----------------------------------------- */
  float ao = ambientOcclusion(uv, s.height);
  float shadow = castShadow(uv, s.height);
  float reach = keyReach(uv);
  float keyVis = key * (1.0 - shadow) * reach;

  /* ---- the light itself ------------------------------------------------ */
  float fillAmt = uAmbientParams.x;
  float ambientAmt = uAmbientParams.y;

  // Fill comes from the opposite side and is always the cooler complement;
  // it is what keeps shadow shapes readable instead of dead.
  float fillTerm = clamp((dot(s.n, vec3(-uKeyDir.x, -uKeyDir.y, 0.55)) + 0.75) / 1.75, 0.0, 1.0);
  // A dome term for skylight: surfaces that face up catch more.
  float skyTerm = clamp(0.5 - s.n.y * 0.5, 0.0, 1.0);

  // Indirect light carries a *softened* version of the frame gradient: bounce
  // light does travel, so the dark side of the room is not pitch black — but
  // it is measurably darker, which is what stops the picture reading flat.
  float indirectReach = mix(1.0, reach, 0.55);
  vec3 ambient = uAmbientColour * ambientAmt * mix(0.55, 1.0 + uAmbientParams.w * 0.6, skyTerm) * indirectReach;
  vec3 fill = uFillColour * (fillAmt * fillTerm * mix(0.4, 1.0, ao)) * indirectReach;
  vec3 bounce = uShadowColour * uAmbientParams.z * (1.0 - ao);

  // AO belongs to the *indirect* light only — occluding the key as well is the
  // classic mistake that turns every crease into a black hole.
  vec3 indirect = (ambient + fill) * ao + bounce;
  vec3 direct = uKeyColour * keyVis;

  vec3 lit = albedo * (indirect + direct);

  /* ---- local colour ---------------------------------------------------- *
   *
   * Multiplying albedo by a strongly tinted light is physically right and
   * pictorially fatal: under the neon or candle rigs every binding converges
   * on the same hue and the shelf stops being a shelf of *different books*.
   *
   * Painters solve this by holding onto local colour — a red book stays
   * recognisably red in orange light, it just gets darker or lighter. So:
   * take the value the lighting computed, put the albedo's own chroma back
   * under it, and cross-fade. At 0 this is pure physics; at 1 the light only
   * changes value, never hue.
   */
  float lc = uHazeParams.z;
  if (lc > 0.001) {
    float litLum = luma(lit);
    float albLum = max(0.02, luma(albedo));
    lit = mix(lit, albedo * (litLum / albLum), lc);
  }

  /* ---- hot spots ------------------------------------------------------- */
  //
  // Hot spots have to be *small*. The reference has maybe five per cent of its
  // area up near white; blowing every lit surface is the fastest way to lose
  // the value structure the whole design is for. So the threshold is high, the
  // ramp is short, and a dark binding blows less than a cream one — a black
  // leather spine in full sun is still dark, it just gains a sheen.
  float hotAmount = uKeyParams.z;
  if (hotAmount > 0.001) {
    float material = 0.35 + 0.65 * luma(albedo);
    float hot = smoothstep(0.82, 1.05, keyVis * material) * hotAmount;
    lit = mix(lit, blowOut(mix(albedo, uKeyColour, 0.5), 0.8), hot * 0.7);
  }

  /* ---- specular catch (gilt, varnish, wet leaves) ---------------------- */
  float specAmt = uKeyParams.w;
  if (specAmt > 0.001) {
    vec3 h = normalize(uKeyDir + vec3(0.0, 0.0, 1.0));
    float spec = pow(clamp(dot(s.n, h), 0.0, 1.0), 34.0);
    lit += uKeyColour * spec * specAmt * (1.0 - shadow) * s.cover;
  }

  /* ---- rim ------------------------------------------------------------- */
  float rimS = uRimParams.x;
  if (rimS > 0.001) {
    float graze = pow(clamp(1.0 - s.n.z, 0.0, 1.0), max(0.2, uRimParams.y));
    float facing = clamp(
      (dot(normalize(s.n.xy + vec2(1e-5)), normalize(uKeyDir.xy + vec2(1e-5))) + uRimParams.z)
        / (1.0 + uRimParams.z),
      0.0, 1.0);
    // Weighted by the material underneath: a rim is light *reflecting off the
    // object*, so a dark spine gets a dim rim and a cream one a bright one.
    // Unweighted, every silhouette in the frame glows equally and the scene
    // turns into a wireframe.
    float material = 0.28 + 0.72 * luma(albedo);
    float rim = graze * facing * rimS * s.cover * material * (1.0 - shadow * 0.7);
    lit += uRimColour * rim;
  }

  /* ---- warm → cool across the light gradient --------------------------- */
  float exposureLevel = clamp(keyVis * 0.75 + luma(indirect) * 0.55, 0.0, 1.0);
  float temp = (exposureLevel - uTempParams.y) * 2.0 * uTempParams.x;
  lit = shiftTemp(lit, temp);
  lit = splitTone(lit, uFillColour, uTempParams.z, uKeyColour, uTempParams.w);

  /* ---- atmosphere: recessed things lose contrast ----------------------- */
  float hazeAmt = uHazeParams.x;
  if (hazeAmt > 0.001) {
    // Depth proxy: low height + low coverage = far back in the case.
    float depth = clamp(1.0 - (s.height * 0.85 + s.cover * 0.15) - uHazeParams.y, 0.0, 1.0);
    lit = mix(lit, uHazeColour * (0.35 + 0.65 * luma(lit) + 0.35), depth * hazeAmt * 0.55);
  }

  /* ---- volumetrics ----------------------------------------------------- */
  vec3 shafts = lightShafts(uv, s.cover, s.height);
  lit += shafts * (1.0 - shadow * 0.35);

  /* ---- bloom ----------------------------------------------------------- */
  lit += bloomGlow(uv, lit);

  /* ---- vignette -------------------------------------------------------- */
  float vigS = uVignetteParams.x;
  if (vigS > 0.001) {
    vec2 nv = sceneUv(uv) * 2.0 - 1.0;
    nv.x *= mix(1.0, uFrame.z, 0.6);
    float circular = length(nv) / 1.41421356;
    float rect = max(abs(nv.x), abs(nv.y));
    float d = mix(circular, rect, clamp(uVignetteParams.y, 0.0, 1.0));
    float feather = clamp(uVignetteParams.z, 0.02, 1.2);
    float v = smoothstep(1.05 - feather, 1.06, d) * vigS;
    lit = mix(lit, uVignetteColour * (0.25 + 0.35 * luma(lit)), v);
    lit *= mix(1.0, 1.0 + uVignetteParams.w, 1.0 - v);
  }

  /* ---- grade ----------------------------------------------------------- */
  lit *= uGradeParams.x;
  vec3 graded = mix(tonemapReinhard(lit), tonemapACES(lit), clamp(uGradeParams.w, 0.0, 1.0));
  graded = lgg(graded, uLift, uGamma, uGain);
  graded = saturateBy(graded, uGradeParams.z);
  graded = sCurve(graded, uGradeParams.y);

  /* ---- grain: the last thing that stops it reading as vector ----------- */
  float grain = uHazeParams.w;
  if (grain > 0.0001) {
    float g = hash21(sceneUv(uv) * vec2(1873.0, 1471.0) + uFrame.w * 0.37) - 0.5;
    // Monochrome, and heaviest in the mid-tones. Per-channel grain reads as
    // colour noise, and grain in the darks reads as a broken sensor — real
    // film has its grain where the density is.
    float l = luma(graded);
    graded += vec3(g) * grain * (4.0 * l * (1.0 - l));
  }

  return clamp(graded, 0.0, 1.0);
}

vec4 debugView(vec2 uv, vec4 lit) {
  int mode = int(uDebug.x + 0.5);
  if (mode == 0) return lit;
  Surface s = readSurface(uv);
  if (mode == 1) return vec4(s.n * 0.5 + 0.5, 1.0);
  if (mode == 2) return vec4(vec3(s.height), 1.0);
  if (mode == 3) return vec4(vec3(ambientOcclusion(uv, s.height)), 1.0);
  if (mode == 4) return vec4(vec3(1.0 - castShadow(uv, s.height)), 1.0);
  if (mode == 5) return texture(uTexture, uv);
  if (mode == 6) return vec4(vec3(luma(lit.rgb)), 1.0);
  return lit;
}
`;

/* ========================================================================== *
 *                                  assembly                                  *
 * ========================================================================== */

export interface FragmentOptions {
  quality?: LightingQuality;
  /** Emit the Pixi filter's uniform preamble (`uTexture` comes from Pixi). */
  target?: 'pixi' | 'raw';
}

/**
 * Assemble the complete fragment shader.
 *
 * Both targets get byte-identical lighting code; only the two lines that
 * declare the input texture and the output variable differ.
 */
export function buildLightingFragment(opts: FragmentOptions = {}): string {
  const p = qualityProfile(opts.quality);
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp sampler2D;',
    '',
    'in vec2 vTextureCoord;',
    'out vec4 finalColor;',
    '',
    'uniform sampler2D uTexture;',
    LIGHTING_UNIFORMS,
    HELPERS,
    GBUFFER,
    aoPass(p),
    shadowPass(p),
    shaftPass(p),
    bloomPass(p),
    MAIN,
    `
void main(void) {
  vec2 uv = vTextureCoord;
  float a;
  vec3 rgb = lightScene(uv, a);
  vec4 lit = vec4(rgb * a, a);
  finalColor = debugView(uv, lit);
}
`,
  ].join('\n');
}

/** The debug views the shader can render instead of the final image. */
export const DEBUG_MODES = [
  'final',
  'normals',
  'height',
  'ao',
  'shadow',
  'albedo',
  'luminance',
] as const;

export type DebugMode = (typeof DEBUG_MODES)[number];

/** Numeric id for `uDebug.x`. Unknown names fall back to `final`. */
export function debugModeId(mode: DebugMode | undefined): number {
  const i = DEBUG_MODES.indexOf((mode ?? 'final') as DebugMode);
  return i < 0 ? 0 : i;
}
