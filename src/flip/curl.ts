/**
 * src/flip/curl.ts — cylinder page-curl shaders + renderer.
 *
 * Implements the design doc's curl model:
 * - Vertex: classic cylinder deformation. Signed distance d from a fold line
 *   (swept by p, optionally tilted for corner grips); vertices past the fold
 *   wrap around a cylinder of radius r. Fixed perspective (fov ~20°) with the
 *   camera distance chosen so the z=0 plane is pixel-exact.
 * - The fold sweeps from the leaf's far edge to the GUTTER and stops there
 *   (math.ts foldOffset) instead of continuing to x=-W as the doc's sketch
 *   has it. A fold past the spine drags the leaf's inner edge onto the
 *   cylinder and the page visibly comes away from the book; with the sweep
 *   stopping at the gutter the inner strip is never deformed at all. The
 *   radius goes to 0 at both ends, so at p=1 the wrap degenerates into a
 *   reflection about the gutter — the exact mirrored page the land() swap
 *   needs, with no separate rigid-rotation blend to fight the cylinder.
 * - Fragment: back face samples the destination page 4% lighter/desaturated
 *   (paper backside), plus a paper-texture multiply (uPaperTex) so raster
 *   matches resting CSS. NO light model — see "the shading that was removed".
 * - Every page sample goes through samplePage()/faceUv() in FRAG_COMMON:
 *   snapshots composite over paper cream (a transparent texel must read as
 *   paper, never black) and mirror per direction/face (leaf-local x runs
 *   from the spine, snapshots run from the page's left edge).
 * - Ground pass: opaque quad under the curl showing the revealed page's
 *   raster with one flat contact shadow composited in the same fragment —
 *   drawn first in the same GL frame, so shadow and mesh can never desync.
 *
 * THE SHADING THAT WAS REMOVED (reader: "when i turn pages sometimes, mid
 * way, the bottom half of page with lines has some weird shadowey effect")
 *
 * The turning sheet used to carry the design doc's lighting model: a warm
 * crest highlight, a curvature darkening band before the crest, a
 * quarter-page-wide self-shadow on the still-flat paper, and a 26px-soft
 * cast shadow on the ground. All four are what CLAUDE.md's flat language
 * forbids — a highlight placed to imply a lamp, a shading pass, blurred
 * shadows — and the self-shadow is the one the reader actually saw, for a
 * reason worth writing down:
 *
 *   Past a half turn the sheet lies back flat at z = 2r, ON TOP of the
 *   un-deformed strip between the spine and the fold. Perspective scales
 *   that lifted paper outward from the canvas centre, so at the foot of the
 *   page it is pushed DOWN by ~38px while the flat strip underneath is not.
 *   The mesh is indexed row-major, so row j's lifted tail is drawn BEFORE
 *   row j+1's flat strip — and with no depth buffer the flat strip painted
 *   over the sheet lying on top of it. What showed through, once per mesh
 *   row, was the self-shadow's gradient: a soft slab, hard at the fold,
 *   fading toward the spine. Only ever BELOW the canvas centre, because
 *   above it the displacement runs upward into rows already drawn.
 *
 * So there were two defects stacked: painter's order that a lift can break,
 * and shading rich enough to make the break obvious. Both are fixed — the
 * context now has a depth buffer (gl.ts) so the physically-higher paper
 * always wins, and the lighting is down to one flat contact shadow at the
 * crease, the sanctioned depth cue (art/flat.ts contactShadow).
 *
 * Shaders are inline template strings (no loader), per the doc.
 */

import {
  createGridMesh,
  createQuadMesh,
  createSolidTexture,
  perspectiveMatrix,
  cameraDistanceForViewport,
  uploadTexture,
  GlProgram,
  type FlipContext,
  type GlMesh,
} from './gl';
import { foldOffset, foldTiltAtP, radiusForP, type FlipDirection } from './math';
import { DEFAULT_PAPER_CREAM_RGB, paperCreamRgb } from './paperTone';
import type {
  FlipSnapshotSceneBitmaps,
  FlipSnapshotSceneStyle,
  SceneRgba,
} from './scene';

/**
 * Curl mesh resolution. The radius tightens toward the landing (a small
 * cylinder needs enough columns not to facet), and a tilted corner fold cuts
 * diagonally across rows, where too few rows smear the crease. 1024 quads is
 * still tiny for a single draw.
 */
export const CURL_GRID_COLS = 64;
export const CURL_GRID_ROWS = 16;

/** Camera field of view (doc: ~20°). */
export const CURL_FOV_RAD = (20 * Math.PI) / 180;

/**
 * Paper cream (tokens.css --paper-cream #f7f1e3) as 0-255 RGB — the PARCHMENT
 * theme's paper, and the default the exported shader sources below are built
 * with.
 *
 * It is not "the" paper colour: settings.css remaps `--paper-cream` per theme
 * (night's is #2b211a), so the running renderer compiles its fragment shaders
 * against `paperTone.paperCreamRgb()` and recompiles them when that moves. See
 * setPaperCream() and the header of paperTone.ts — a page that turned
 * parchment mid-flip and went back on landing is the defect this split fixes.
 */
export const PAPER_CREAM_RGB: readonly [number, number, number] = DEFAULT_PAPER_CREAM_RGB;

/** A cream as a GLSL vec3 body, so shader and CPU can never drift. */
const creamGlsl = (rgb: readonly [number, number, number]): string =>
  rgb.map((channel) => (channel / 255).toFixed(6)).join(', ');

/**
 * art/flat.ts FLAT.shadow (#5d3a26) as 0-255 RGB — the app's ONE shadow
 * colour, and the only ink the flip is allowed to darken paper with. Warm
 * brown, never black, never a neutral grey.
 */
export const FLAT_SHADOW_RGB: readonly [number, number, number] = [93, 58, 38];

const FLAT_SHADOW_GLSL = FLAT_SHADOW_RGB.map((channel) => (channel / 255).toFixed(6)).join(', ');

/**
 * Contact-shadow alpha at full lift — art/flat.ts contactShadow()'s own
 * default, so the crease of a turning page is exactly as dark as the shadow
 * under a book on a shelf. The rigid CSS fold (cssFallback.ts) reads this
 * too: one turning page, one shadow, whichever path draws it.
 */
export const CONTACT_SHADOW_ALPHA = 0.22;

/**
 * How far the contact shadow reaches beyond the lifted sheet's edge, CSS px.
 * A contact shadow is a CONTACT: it hugs the paper and stops. The terms this
 * replaced ran 0.25·W (~165px) and a 26px-soft band, which are lighting
 * washes, not contacts. Fixed, so no value of p can grow it back into one.
 */
export const CONTACT_SHADOW_REACH_PX = 18;

/* ----------------------------------------------------------------------------
   Shader sources
   -------------------------------------------------------------------------- */

/**
 * Shared vertex prelude: maps leaf-local px → canvas px → clip space.
 * Leaf-local x runs 0 (spine) → W (outer edge); uDir mirrors the leaf for
 * 'prev' flips so one deformation code path serves both directions.
 */
const VERT_COMMON = /* glsl */ `
uniform vec2 uLeafSize;    // leaf W,H in css px
uniform vec2 uLeafOrigin;  // leaf top-left in canvas css px
uniform vec2 uCanvasSize;  // canvas css px
uniform float uDir;        // +1 = next (right leaf), -1 = prev (left leaf)
uniform mat4 uProj;
uniform float uCamDist;

vec4 project(vec2 localPx, float z) {
  float canvasX = uLeafOrigin.x + mix(uLeafSize.x - localPx.x, localPx.x, step(0.0, uDir));
  float canvasY = uLeafOrigin.y + localPx.y;
  float xc = canvasX - uCanvasSize.x * 0.5;
  float yc = uCanvasSize.y * 0.5 - canvasY;
  return uProj * vec4(xc, yc, z - uCamDist, 1.0);
}
`;

export const CURL_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_uv;

uniform float uFoldD;   // fold line's distance from the SPINE, leaf-local px
uniform float uTilt;    // fold-line tilt, radians (0 = vertical fold)
uniform float uRadius;  // cylinder radius, px (> 0; math.ts floors it)
${VERT_COMMON}
out vec2 vUv;

const float PI = 3.14159265;

void main() {
  vec2 local = a_uv * uLeafSize;

  // Distance from the SPINE line (leaf-local x=0, tilted by uTilt), then from
  // the fold line parallel to it. Anchoring on the spine rather than on the
  // fold's own x is what keeps x=0 pinned: uFoldD is never negative, so the
  // strip between the gutter and the fold always has d <= 0 and is left
  // exactly where the DOM drew it.
  vec2 n = vec2(cos(uTilt), sin(uTilt));
  float d = dot(local - vec2(0.0, uLeafSize.y * 0.5), n) - uFoldD;

  // Cylinder deformation for vertices past the fold: tangential component
  // stays, normal component wraps; beyond a half-turn the paper runs flat
  // upside-down back toward the spine. As uRadius → 0 (p → 1) this becomes a
  // pure reflection about the fold line, and the fold line is the gutter by
  // then — so the landing is the exact mirrored page, to sub-pixel.
  vec2 pos = local;
  float z = 0.0;
  if (d > 0.0) {
    vec2 tangential = local - d * n;
    float angle = d / uRadius;
    if (angle < PI) {
      pos = tangential + n * (sin(angle) * uRadius);
      z = (1.0 - cos(angle)) * uRadius;
    } else {
      pos = tangential - n * (d - PI * uRadius);
      z = 2.0 * uRadius;
    }
  }

  // z is the whole depth story now: the fragment pass carries no lighting,
  // so the fold distance and wrap angle stop at this shader.
  vUv = a_uv;
  gl_Position = project(pos, z);
}
`;

/**
 * Fragment prelude shared by both passes: page sampling + paper-fibre
 * multiply. Both passes must agree on face orientation and on what an
 * uncovered texel means, so the rules live in exactly one place.
 */
const fragCommon = (cream: readonly [number, number, number]): string => /* glsl */ `
uniform float uDir;        // +1 = next (right leaf), -1 = prev (left leaf)
uniform sampler2D uPaperTex;
uniform vec2 uPaperScale;  // leaf size / paper tile css size (repeat count)
uniform float uPaperMix;   // fibre multiply strength (0 disables)
uniform float uPaperMean;  // mean luminance of the paper tile (normalizer)
uniform float uLift;       // sin(p·π): 0 at both flat handoff states

// The LIVE --paper-cream, baked in at compile time (paperTone.ts). A constant
// rather than a uniform because it changes only when the reader changes theme,
// and a uniform would cost a set on every frame of every turn to say the same
// thing. CurlRenderer.setPaperCream recompiles when it moves.
const vec3 PAPER_CREAM = vec3(${creamGlsl(cream)});
const vec3 FLAT_SHADOW = vec3(${FLAT_SHADOW_GLSL});

/**
 * Leaf-local uv → page-snapshot uv. Leaf-local x runs from the SPINE, but a
 * snapshot always starts at the page's LEFT edge — and on a 'prev' leaf the
 * spine IS the right edge. A face reads mirrored when exactly one of "the
 * leaf itself is mirrored" / "this is the sheet's backside" holds; sampling
 * it straight renders the whole spread reversed for the length of the turn.
 */
vec2 faceUv(vec2 uv, bool backside) {
  bool mirrored = (uDir < 0.0) != backside;
  return mirrored ? vec2(1.0 - uv.x, uv.y) : uv;
}

/**
 * Snapshots upload with PREMULTIPLIED alpha, so any texel the capture left
 * transparent arrives as rgb=0 — taking .rgb alone painted it pure BLACK
 * mid-turn. Compositing over cream makes a transparent (or partly
 * transparent, or wholly failed) capture read as blank paper instead, which
 * is the same fallback the missing-snapshot path already uses.
 */
vec3 samplePage(sampler2D tex, vec2 uv) {
  vec4 texel = texture(tex, uv);
  return texel.rgb + PAPER_CREAM * (1.0 - texel.a);
}

vec3 paperMultiply(vec3 color, vec2 uv) {
  // Same alpha guard: an uncovered fibre texel must read neutral, not black.
  vec4 tile = texture(uPaperTex, uv * uPaperScale);
  vec3 fibre = (tile.rgb + (1.0 - tile.a)) / max(uPaperMean, 0.001);
  return color * mix(vec3(1.0), fibre, uPaperMix);
}
`;

export const curlFragSrc = (
  cream: readonly [number, number, number],
): string => /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTexFront;
uniform sampler2D uTexBack;
${fragCommon(cream)}
out vec4 outColor;

void main() {
  // Face selection: mirroring flips winding once for the wrapped part and
  // once more for prev-direction leaves; XOR the two.
  bool isBack = (uDir > 0.0) ? !gl_FrontFacing : gl_FrontFacing;

  vec3 color;
  if (isBack) {
    // Paper backside = the sheet's other page, up to 4% lighter and slightly
    // desaturated. A flat face tint, not a light model: it is the same trick
    // as a lighter timber face beside a darker one in art/flat.ts, and it is
    // the ONLY depth cue the moving sheet carries. Fade it with the geometric
    // lift so both flat endpoints are the unmodified snapshot; otherwise the
    // p=1 landing holds a paler page and changes colour when the live DOM
    // replaces it. faceUv owns the mirroring for both directions.
    vec3 c = samplePage(uTexBack, faceUv(vUv, true));
    c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), 0.12 * uLift);
    color = mix(c, vec3(1.0), 0.04 * uLift);
  } else {
    color = samplePage(uTexFront, faceUv(vUv, false));
  }

  // Same tiled paper the resting CSS uses, normalized by its mean so only
  // the fibre relief modulates (base tone already lives in the snapshot).
  color = paperMultiply(color, vUv);

  // Nothing else. No crest highlight, no curvature band, no self-shadow —
  // the curl reads from its geometry (the rules bend, the ink foreshortens)
  // and from the flat backside tint above. See the header note.
  outColor = vec4(color, 1.0);
}
`;

/**
 * The curl fragment shader at the PARCHMENT default.
 *
 * Kept as a plain exported string because it is the shader's canonical text —
 * what tests read and what a reader greps for. The renderer compiles
 * `curlFragSrc(paperCreamRgb())` instead, which is the same source with the
 * live theme's paper in it.
 */
export const CURL_FRAG_SRC = curlFragSrc(PAPER_CREAM_RGB);

/**
 * Ground pass: opaque quad over the moving leaf's rect showing the revealed
 * page beneath the curl, with the crease's flat contact shadow composited in.
 */
export const GROUND_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_uv;
${VERT_COMMON}
out vec2 vUv;

void main() {
  vUv = a_uv;
  gl_Position = project(a_uv * uLeafSize, 0.0);
}
`;

export const groundFragSrc = (
  cream: readonly [number, number, number],
): string => /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTexPage;
uniform vec2 uLeafSize;
uniform float uFoldD;
uniform float uTilt;
uniform float uRadius;
uniform float uShadowStart; // leaf-local px past the fold where the sheet's
                            // silhouette ends — measured, not assumed
uniform float uContact;     // 1 for the revealed sheet, 0 for stationary
${fragCommon(cream)}
out vec4 outColor;

const float CONTACT_ALPHA = ${CONTACT_SHADOW_ALPHA.toFixed(3)};
const float CONTACT_REACH = ${CONTACT_SHADOW_REACH_PX.toFixed(1)};

void main() {
  // The revealed page sits the same way round as the leaf's front face.
  vec3 color = paperMultiply(samplePage(uTexPage, faceUv(vUv, false)), vUv);

  // Shadow geometry stays in LEAF-local space (vUv is unmirrored) so the
  // band tracks the fold line the vertex shader used — same spine-anchored
  // distance, or the shadow drifts off the crease.
  vec2 local = vUv * uLeafSize;
  vec2 n = vec2(cos(uTilt), sin(uTilt));
  float d = dot(local - vec2(0.0, uLeafSize.y * 0.5), n) - uFoldD;

  // Contact shadow: ONE flat band, hugging the outside of the lifted sheet's
  // silhouette and stopping CONTACT_REACH px later. Constant alpha inside —
  // the 1px smoothsteps are edge antialiasing, which is how a flat shape is
  // rasterized, not a soft falloff. uLift takes it to exactly 0 at p=0 and
  // p=1 so the landing frame stays pixel-identical to the DOM it swaps for.
  //
  // It starts at uShadowStart, not at the fold: the crease itself is UNDER
  // the paper (the cylinder covers the ground for its whole radius, and
  // perspective pushes that silhouette a further ~12px outward mid-flip), so
  // a band drawn at the fold is a band nobody ever sees. curl.ts's render()
  // projects the silhouette the same way the vertex shader does and hands
  // the answer over.
  float end = uShadowStart + CONTACT_REACH;
  float band =
    smoothstep(uShadowStart - 1.0, uShadowStart + 1.0, d) *
    (1.0 - smoothstep(end - 1.0, end + 1.0, d));
  float a = CONTACT_ALPHA * uLift * band * uContact;

  color *= mix(vec3(1.0), FLAT_SHADOW, a); // the app's one shadow colour
  outColor = vec4(color, 1.0);
}
`;

/** The ground fragment shader at the parchment default — see CURL_FRAG_SRC. */
export const GROUND_FRAG_SRC = groundFragSrc(PAPER_CREAM_RGB);

/**
 * Flat scene chrome. It uses the same perspective projection and z scale as
 * the sheets: binding paint sits a hair above flat paper, while any genuinely
 * lifted curl still occludes it through the shared depth buffer.
 */
export const SCENE_SOLID_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_uv;
${VERT_COMMON}
uniform float uSceneZ;
out vec2 vUv;

void main() {
  vUv = a_uv;
  gl_Position = project(a_uv * uLeafSize, uSceneZ);
}
`;

export const SCENE_SOLID_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uColor;
uniform vec2 uRectSize;
uniform float uRadius;
uniform float uShape; // 0 rounded rectangle, 1 hard-stop folded-corner band
out vec4 outColor;

void main() {
  if (uRadius > 0.0) {
    vec2 halfSize = uRectSize * 0.5;
    vec2 q = abs((vUv - 0.5) * uRectSize) - (halfSize - vec2(uRadius));
    float distanceToRound = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
    if (distanceToRound > 0.0) discard;
  }
  if (uShape > 0.5) {
    float along = (vUv.x + vUv.y) * 0.5;
    if (along < 0.49 || along > 0.77) discard;
  }
  outColor = uColor;
}
`;

/* ----------------------------------------------------------------------------
   Renderer
   -------------------------------------------------------------------------- */

/**
 * Where the lifted sheet's OUTER SILHOUETTE lands on the flat page beneath
 * it, as a leaf-local distance past the fold — i.e. where the ground stops
 * being hidden and the contact shadow may begin.
 *
 * Two corrections over the naive "the cylinder is r wide, so r":
 *
 * 1. The sheet only reaches angle π/2 (the widest point of the cylinder) if
 *    it is long enough. Early in a flip the fold is still out near the leaf
 *    edge, the paper past it is a shallow arc, and its own edge is the
 *    silhouette — sin(angle) of that, not sin(π/2).
 * 2. The silhouette is LIFTED (z = (1 − cos angle)·r), so the camera pushes
 *    it outward from the canvas centre. Skipping this puts the band up to
 *    ~12px inside the paper mid-flip, where it is invisible. This is the
 *    same projection the vertex shader's project() applies, evaluated for
 *    one point — including the 'prev' mirror, which flips which way
 *    "outward" runs.
 *
 * Returned in GROUND space (the ground quad is at z=0 and maps 1:1 to the
 * canvas), so the fragment shader can compare it against its own `d`.
 */
function silhouetteOffset(
  leafW: number,
  foldD: number,
  radius: number,
  camDist: number,
  frame: CurlFrame,
  dirSign: number,
): number {
  const angle = Math.min(Math.max(leafW - foldD, 0) / radius, Math.PI / 2);
  const localX = foldD + Math.sin(angle) * radius;
  const z = (1 - Math.cos(angle)) * radius;
  const scale = camDist / Math.max(camDist - z, 1e-3);
  const centreX = frame.canvasW * 0.5;
  // project()'s x mapping, for this one vertex.
  const canvasX = dirSign > 0 ? frame.leafX + localX : frame.leafX + leafW - localX;
  const screenX = centreX + (canvasX - centreX) * scale;
  const groundLocalX = dirSign > 0 ? screenX - frame.leafX : frame.leafX + leafW - screenX;
  return Math.max(groundLocalX - foldD, 0);
}

interface LeafGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CurlFrame {
  /** Flip progress 0..1. */
  p: number;
  /** Base fold tilt from the grip (radians); faded out internally near p=1. */
  baseTilt: number;
  dir: FlipDirection;
  /** Moving leaf rect relative to the canvas, css px. */
  leafX: number;
  leafY: number;
  leafW: number;
  leafH: number;
  /** Exact live-DOM leaf rects. Never derive the stationary sheet by
   * translating the moving one: fit transforms and fractional flex layout
   * make that translation visibly disagree with the landing DOM. */
  leftX: number;
  leftY: number;
  leftW: number;
  leftH: number;
  rightX: number;
  rightY: number;
  rightW: number;
  rightH: number;
  /** Canvas css size. */
  canvasW: number;
  canvasH: number;
}

/**
 * Owns the three programs (curl mesh + two-sheet ground + scene chrome), the
 * 64x16 mesh, the quad, and the complete four-page texture set. One instance
 * per FlipSurface; all GL objects are
 * created once at book-open so gesture start never compiles/allocates.
 */
export class CurlRenderer {
  private readonly gl: WebGL2RenderingContext;
  private curlProgram: GlProgram;
  private groundProgram: GlProgram;
  private readonly sceneSolidProgram: GlProgram;
  private readonly mesh: GlMesh;
  private readonly quad: GlMesh;
  private stationary: WebGLTexture;
  private front: WebGLTexture;
  private back: WebGLTexture;
  private revealed: WebGLTexture;
  private paper: WebGLTexture;
  private paperTileCss = 512;
  private paperMix = 0;
  private sceneStyle: FlipSnapshotSceneStyle;
  private disposed = false;

  /**
   * The paper cream the two fragment programs were compiled against. Blank
   * paper is a compile-time constant in the shader (see fragCommon), so a
   * theme change has to rebuild the programs — that is the whole of
   * setPaperCream below.
   */
  private cream: readonly [number, number, number];

  constructor(private readonly ctx: FlipContext) {
    const gl = ctx.gl;
    this.gl = gl;
    this.cream = paperCreamRgb();
    this.curlProgram = new GlProgram(gl, CURL_VERT_SRC, curlFragSrc(this.cream));
    this.groundProgram = new GlProgram(gl, GROUND_VERT_SRC, groundFragSrc(this.cream));
    this.sceneSolidProgram = new GlProgram(gl, SCENE_SOLID_VERT_SRC, SCENE_SOLID_FRAG_SRC);
    this.mesh = createGridMesh(gl, CURL_GRID_COLS, CURL_GRID_ROWS);
    this.quad = createQuadMesh(gl);
    this.stationary = this.creamTexture();
    this.front = this.creamTexture();
    this.back = this.creamTexture();
    this.revealed = this.creamTexture();
    this.paper = createSolidTexture(gl, 255, 255, 255);
    const [r, g, b] = this.cream;
    this.sceneStyle = {
      gutterWidth: 26,
      gutter: [93 / 255, 58 / 255, 38 / 255, 0.22],
      threadWidth: 2,
      thread: [93 / 255, 58 / 255, 38 / 255, 0.36],
      paper: [r / 255, g / 255, b / 255, 1],
      edgeRadius: 4,
      leftEdges: [],
      rightEdges: [],
      cornerSize: 34,
      cornerRadius: 4,
      cornerPaper: [229 / 255, 216 / 255, 187 / 255, 1],
      showCorner: true,
    };
  }

  private creamTexture(): WebGLTexture {
    const [r, g, b] = this.cream;
    return createSolidTexture(this.gl, r, g, b);
  }

  /**
   * Adopt the live `--paper-cream` (paperTone.ts), recompiling the two
   * fragment programs if it moved. A no-op on every call but the first after a
   * theme change, which is why the flip can afford to call it at gesture start
   * rather than watching for the change itself.
   *
   * The cream FALLBACK textures — what a face with no snapshot shows, and on
   * the night theme the difference between a dark sheet and a white one — pick
   * the new colour up on their own: setSnapshotScene rebuilds them from
   * `this.cream` and the controller calls it immediately after this, in the
   * same beginFlip.
   */
  setPaperCream(): void {
    if (this.disposed || this.ctx.isLost()) return;
    const cream = paperCreamRgb();
    // The COLOUR, not paperToneTag(): an ink change moves the tag (a snapshot
    // taken in sepia is stale under graphite) and leaves the paper exactly
    // where it was, and recompiling two programs to bake in the same number
    // would be work for nothing.
    if (cream.every((channel, i) => channel === this.cream[i])) return;
    const gl = this.gl;
    let curl: GlProgram;
    let ground: GlProgram;
    try {
      curl = new GlProgram(gl, CURL_VERT_SRC, curlFragSrc(cream));
      ground = new GlProgram(gl, GROUND_VERT_SRC, groundFragSrc(cream));
    } catch {
      // A failed recompile leaves the OLD programs in place and drawing, and
      // `this.cream` unchanged so the next flip tries again. The paper is then
      // one theme stale — the defect this method exists to fix — but that is a
      // great deal better than a flip that cannot draw at all.
      return;
    }
    this.curlProgram.dispose();
    this.groundProgram.dispose();
    this.curlProgram = curl;
    this.groundProgram = ground;
    this.cream = cream;
  }

  /**
   * Upload page snapshots at flip start (~1ms each). `null` falls back to
   * plain cream paper (e.g. flipping to a not-yet-rasterized page).
   * front = moving page's visible face; back = destination page printed on
   * the sheet's other side; revealed = page uncovered beneath the sheet.
   */
  setSnapshotScene(scene: FlipSnapshotSceneBitmaps, style: FlipSnapshotSceneStyle): void {
    const gl = this.gl;
    gl.deleteTexture(this.stationary);
    gl.deleteTexture(this.front);
    gl.deleteTexture(this.back);
    gl.deleteTexture(this.revealed);
    this.stationary = scene.stationary
      ? uploadTexture(gl, scene.stationary)
      : this.creamTexture();
    this.front = scene.front ? uploadTexture(gl, scene.front) : this.creamTexture();
    this.back = scene.back ? uploadTexture(gl, scene.back) : this.creamTexture();
    this.revealed = scene.revealed ? uploadTexture(gl, scene.revealed) : this.creamTexture();
    this.sceneStyle = style;
  }

  /** Same tiled paper texture the resting CSS uses; enables the multiply. */
  setPaperTexture(tile: ImageBitmap | HTMLCanvasElement, tileCssSize: number, mix = 0.35): void {
    this.gl.deleteTexture(this.paper);
    this.paper = uploadTexture(this.gl, tile, null, true);
    this.paperTileCss = tileCssSize;
    this.paperMix = mix;
  }

  /**
   * Draw one complete scene frame:
   * stationary + revealed sheets → binding → moving curl.
   *
   * Nothing first appears at landing. The opposite page, destination page,
   * paper behind the translucent gutter and its center thread are submitted in
   * every frame from p=0. The moving mesh is last and wins wherever it lifts.
   */
  render(frame: CurlFrame): void {
    if (this.disposed || this.ctx.isLost()) return;
    const gl = this.gl;
    const { p, leafW, leafH } = frame;
    const dirSign = frame.dir === 'next' ? 1 : -1;
    const tilt = foldTiltAtP(frame.baseTilt, p);
    const foldD = foldOffset(p, leafW, leafH, tilt);
    // The radius is 0 at both ends by design; the shader divides by it, so
    // floor it — but far below a pixel. The wrap leaves the landing short by
    // exactly π·r, so a 1px floor would offset the p=1 frame by 3px and the
    // raster→DOM swap would show it as a pop; this leaves ~1/1000 px.
    const radius = Math.max(radiusForP(p, leafW), leafW * 1e-6);
    const lift = Math.sin(Math.min(Math.max(p, 0), 1) * Math.PI);

    const camDist = cameraDistanceForViewport(frame.canvasH, CURL_FOV_RAD);
    const shadowStart = silhouetteOffset(leafW, foldD, radius, camDist, frame, dirSign);
    const proj = perspectiveMatrix(
      CURL_FOV_RAD,
      frame.canvasW / frame.canvasH,
      camDist * 0.1,
      camDist * 10,
    );

    gl.clearColor(0, 0, 0, 0);
    // DEPTH too, every frame: without it the previous frame's curl height
    // rejects this frame's fragments and the sheet stops redrawing where it
    // used to be higher. (gl.ts turns the test on and picks LEQUAL.)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const setCommon = (
      prog: GlProgram,
      geometry: LeafGeometry = {
        x: frame.leafX,
        y: frame.leafY,
        w: leafW,
        h: leafH,
      },
      sign = dirSign,
    ): void => {
      prog.set2f('uLeafSize', geometry.w, geometry.h);
      prog.set2f('uLeafOrigin', geometry.x, geometry.y);
      prog.set2f('uCanvasSize', frame.canvasW, frame.canvasH);
      prog.set1f('uDir', sign);
      prog.setMat4('uProj', proj);
      prog.set1f('uCamDist', camDist);
      prog.set1f('uFoldD', foldD);
      prog.set1f('uTilt', tilt);
      prog.set1f('uRadius', radius);
      prog.set1f('uLift', lift);
      prog.set1f('uShadowStart', shadowStart);
      prog.set2f(
        'uPaperScale',
        geometry.w / this.paperTileCss,
        geometry.h / this.paperTileCss,
      );
      prog.set1f('uPaperMix', this.paperMix);
      prog.set1f('uPaperMean', 0.94);
    };

    const drawGround = (
      texture: WebGLTexture,
      geometry: LeafGeometry,
      sign: number,
      contact: 0 | 1,
    ): void => {
      this.groundProgram.use();
      setCommon(this.groundProgram, geometry, sign);
      this.groundProgram.set1f('uContact', contact);
      this.groundProgram.setTexture('uTexPage', texture, 0);
      this.groundProgram.setTexture('uPaperTex', this.paper, 2);
      this.quad.draw();
    };

    const drawSolid = (
      x: number,
      y: number,
      width: number,
      height: number,
      color: SceneRgba,
      z: number,
      radius = 0,
      shape: 0 | 1 = 0,
    ): void => {
      if (width <= 0 || height <= 0 || color[3] <= 0) return;
      const program = this.sceneSolidProgram;
      program.use();
      program.set2f('uLeafSize', width, height);
      program.set2f('uLeafOrigin', x, y);
      program.set2f('uCanvasSize', frame.canvasW, frame.canvasH);
      program.set1f('uDir', 1);
      program.setMat4('uProj', proj);
      program.set1f('uCamDist', camDist);
      program.set1f('uSceneZ', z);
      program.set2f('uRectSize', width, height);
      program.set1f('uRadius', Math.max(0, Math.min(radius, width * 0.5, height * 0.5)));
      program.set1f('uShape', shape);
      // createFlipContext uses premultiplied-alpha blending.
      program.set4f(
        'uColor',
        color[0] * color[3],
        color[1] * color[3],
        color[2] * color[3],
        color[3],
      );
      this.quad.draw();
    };

    const leftLeaf: LeafGeometry = {
      x: frame.leftX,
      y: frame.leftY,
      w: frame.leftW,
      h: frame.leftH,
    };
    const rightLeaf: LeafGeometry = {
      x: frame.rightX,
      y: frame.rightY,
      w: frame.rightW,
      h: frame.rightH,
    };
    const movingLeaf: LeafGeometry = {
      x: frame.leafX,
      y: frame.leafY,
      w: leafW,
      h: leafH,
    };
    const stationaryLeaf = dirSign > 0 ? leftLeaf : rightLeaf;

    // CSS paints its first box shadow on top; draw the list backwards so the
    // nearest cream/deep hairline wins exactly the same way.
    for (const edge of [...this.sceneStyle.leftEdges].reverse()) {
      drawSolid(
        leftLeaf.x + edge.x,
        leftLeaf.y + edge.y,
        leftLeaf.w,
        leftLeaf.h,
        edge.color,
        -0.02,
        this.sceneStyle.edgeRadius,
      );
    }
    for (const edge of [...this.sceneStyle.rightEdges].reverse()) {
      drawSolid(
        rightLeaf.x + edge.x,
        rightLeaf.y + edge.y,
        rightLeaf.w,
        rightLeaf.h,
        edge.color,
        -0.02,
        this.sceneStyle.edgeRadius,
      );
    }

    drawGround(this.stationary, stationaryLeaf, -dirSign, 0);
    drawGround(this.revealed, movingLeaf, dirSign, 1);

    /*
     * The binding lives ON the flat paper but UNDER a lifted turning sheet.
     *
     * This pass used to paint an opaque cream rectangle first and then draw
     * the translucent gutter last with depth disabled. The rectangle erased
     * both pages' rules at the spine, and the last-pass stripe showed through
     * paper that had not revealed it yet: exactly the pasted-on sticker the
     * reader reported. The DOM gutter itself is translucent over the paper, so
     * the GL scene must be the same composition: no backing rectangle, and the
     * curl drawn afterwards so real paper occludes it.
     */
    const bindingX = (leftLeaf.x + leftLeaf.w + rightLeaf.x) * 0.5;
    const bindingY = Math.min(leftLeaf.y, rightLeaf.y);
    const bindingH = Math.max(leftLeaf.y + leftLeaf.h, rightLeaf.y + rightLeaf.h) - bindingY;
    const gutterW = Math.max(this.sceneStyle.gutterWidth, 1);
    const threadW = Math.min(Math.max(this.sceneStyle.threadWidth, 1), gutterW);
    const drawBinding = (): void => {
      drawSolid(bindingX - gutterW * 0.5, bindingY, gutterW, bindingH, this.sceneStyle.gutter, 0.001);
      drawSolid(bindingX - threadW * 0.5, bindingY, threadW, bindingH, this.sceneStyle.thread, 0.002);
    };
    drawBinding();

    this.curlProgram.use();
    setCommon(this.curlProgram, movingLeaf);
    this.curlProgram.setTexture('uTexFront', this.front, 0);
    this.curlProgram.setTexture('uTexBack', this.back, 1);
    this.curlProgram.setTexture('uPaperTex', this.paper, 2);
    this.mesh.draw();

    // At the two EXACTLY-flat handoffs the settled DOM owns the gutter above
    // both leaves. Repeat only those endpoint pixels above the mesh so the
    // p=1 scene already equals the destination before land() releases it. Do
    // not fade this in during the turn: while p is genuinely between pages the
    // moving paper must occlude the binding, rather than a stripe appearing
    // through a sheet that has not revealed it.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    if (p <= 1e-6 || p >= 1 - 1e-6) drawBinding();

    // The dog-ear belongs to the stationary book chrome, but unlike the
    // binding it never intersects the moving sheet's route. Keep it a final
    // screen-space mark so its apparent size cannot pulse with perspective.
    if (this.sceneStyle.showCorner) {
      const corner = Math.min(
        Math.max(this.sceneStyle.cornerSize, 1),
        rightLeaf.w,
        rightLeaf.h,
      );
      drawSolid(
        rightLeaf.x + rightLeaf.w - corner - 2,
        rightLeaf.y + rightLeaf.h - corner - 2,
        corner,
        corner,
        this.sceneStyle.cornerPaper,
        0,
        this.sceneStyle.cornerRadius,
        1,
      );
    }
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    /*
     * Chromium may otherwise leave several WebGL command batches queued while
     * the main thread immediately starts mounting the destination editors.
     * The JS-side progress has already reached p=1, but the compositor can
     * keep presenting an older curl frame and then drain those old frames
     * after navigation — the visible "page turned behind the cover" failure.
     *
     * flush() only submits the batch; unlike finish() it does not wait for the
     * GPU and therefore does not turn every animation frame into a blocking
     * synchronization point. The landing code still owns the paint boundary.
     */
    gl.flush();
  }

  /**
   * Run `ready` only after every draw submitted before this call has finished
   * on the GPU. Landing uses this before it swaps the live DOM: two rAFs alone
   * only prove that the main thread reached a paint boundary, not that
   * Chromium's WebGL command queue reached the p=1 frame.
   *
   * Polling a fence is intentionally asynchronous. `gl.finish()` would prove
   * the same fact by blocking the main thread—and turn a busy GPU into a
   * frozen page. A lost context / failed fence releases the caller so the
   * controller's existing context-loss fallback can take over.
   */
  afterSubmittedFrame(ready: () => void): void {
    if (this.disposed || this.ctx.isLost()) {
      ready();
      return;
    }
    const gl = this.gl;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) {
      ready();
      return;
    }
    gl.flush();

    const poll = (): void => {
      if (this.disposed || this.ctx.isLost()) {
        gl.deleteSync(fence);
        ready();
        return;
      }
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
        gl.deleteSync(fence);
        ready();
        return;
      }
      if (status === gl.WAIT_FAILED) {
        gl.deleteSync(fence);
        ready();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  clear(): void {
    if (this.disposed || this.ctx.isLost()) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    this.curlProgram.dispose();
    this.groundProgram.dispose();
    this.sceneSolidProgram.dispose();
    this.mesh.dispose();
    this.quad.dispose();
    gl.deleteTexture(this.stationary);
    gl.deleteTexture(this.front);
    gl.deleteTexture(this.back);
    gl.deleteTexture(this.revealed);
    gl.deleteTexture(this.paper);
  }
}
