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
 *   (paper backside); lighting is smoothstep bands — crest highlight,
 *   pre-fold darkening, self-shadow on the flat part — plus a paper-texture
 *   multiply (uPaperTex) so raster matches resting CSS.
 * - Every page sample goes through samplePage()/faceUv() in FRAG_COMMON:
 *   snapshots composite over paper cream (a transparent texel must read as
 *   paper, never black) and mirror per direction/face (leaf-local x runs
 *   from the spine, snapshots run from the page's left edge).
 * - Ground pass: opaque quad under the curl showing the revealed page's
 *   raster with the cast shadow composited in the same fragment — drawn
 *   first in the same GL frame, so shadow and mesh can never desync.
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

/**
 * Curl mesh resolution. The doc says 40x8; we run finer because the radius
 * now tightens toward the landing (a small cylinder needs more columns before
 * it facets) and because a tilted corner fold cuts diagonally across rows,
 * where too few rows smear the crease. 1024 quads is still nothing.
 */
export const CURL_GRID_COLS = 64;
export const CURL_GRID_ROWS = 16;

/** Camera field of view (doc: ~20°). */
export const CURL_FOV_RAD = (20 * Math.PI) / 180;

/** Paper cream (tokens.css --paper-cream #f7f1e3) as 0-255 RGB. */
export const PAPER_CREAM_RGB: readonly [number, number, number] = [247, 241, 227];

/** The same cream as a GLSL literal, so shader and CPU can never drift. */
const PAPER_CREAM_GLSL = PAPER_CREAM_RGB.map((channel) => (channel / 255).toFixed(6)).join(', ');

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
out float vD;      // signed distance from fold line (px, + = wrapped side)
out float vAngle;  // wrap angle around the cylinder (0 = flat)

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
  float angle = 0.0;
  if (d > 0.0) {
    vec2 tangential = local - d * n;
    angle = d / uRadius;
    if (angle < PI) {
      pos = tangential + n * (sin(angle) * uRadius);
      z = (1.0 - cos(angle)) * uRadius;
    } else {
      pos = tangential - n * (d - PI * uRadius);
      z = 2.0 * uRadius;
    }
  }

  vUv = a_uv;
  vD = d;
  vAngle = angle;
  gl_Position = project(pos, z);
}
`;

/**
 * Fragment prelude shared by both passes: page sampling + paper-fibre
 * multiply. Both passes must agree on face orientation and on what an
 * uncovered texel means, so the rules live in exactly one place.
 */
const FRAG_COMMON = /* glsl */ `
uniform float uDir;        // +1 = next (right leaf), -1 = prev (left leaf)
uniform sampler2D uPaperTex;
uniform vec2 uPaperScale;  // leaf size / paper tile css size (repeat count)
uniform float uPaperMix;   // fibre multiply strength (0 disables)
uniform float uPaperMean;  // mean luminance of the paper tile (normalizer)

const vec3 PAPER_CREAM = vec3(${PAPER_CREAM_GLSL});

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

export const CURL_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
in float vD;
in float vAngle;

uniform sampler2D uTexFront;
uniform sampler2D uTexBack;
uniform vec2 uLeafSize;
uniform float uLift;       // sin(p·π): 0 at rest/landed, 1 mid-flip
${FRAG_COMMON}
out vec4 outColor;

const float HALF_PI = 1.57079633;

void main() {
  // Face selection: mirroring flips winding once for the wrapped part and
  // once more for prev-direction leaves; XOR the two.
  bool isBack = (uDir > 0.0) ? !gl_FrontFacing : gl_FrontFacing;

  vec3 color;
  if (isBack) {
    // Paper backside = the sheet's other page, 4% lighter and slightly
    // desaturated. faceUv owns the mirroring for both directions.
    vec3 c = samplePage(uTexBack, faceUv(vUv, true));
    c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), 0.12);
    color = mix(c, vec3(1.0), 0.04);
  } else {
    color = samplePage(uTexFront, faceUv(vUv, false));
  }

  // Same tiled paper the resting CSS uses, normalized by its mean so only
  // the fibre relief modulates (base tone already lives in the snapshot).
  color = paperMultiply(color, vUv);

  // Crest highlight: 3-5% warm light on the cylinder crest (upper-left key
  // light per the art direction). Gaussian band around angle = π/2.
  float crest = exp(-pow((vAngle - HALF_PI) / 0.55, 2.0));
  color += vec3(0.050, 0.045, 0.035) * crest * uLift;

  // Pre-crest darkening: ~10% band as the surface turns away from the light,
  // just before the crest catches it.
  float preFold = smoothstep(0.0, 1.1, vAngle) * (1.0 - smoothstep(1.1, HALF_PI + 1.0, vAngle));
  color *= 1.0 - 0.10 * preFold * uLift;

  // Self-shadow: the lifted portion shades the still-flat paper just before
  // the fold — smoothstep over 0.25·W, strongest at the fold, ∝ sin(p·π).
  if (vD <= 0.0) {
    float s = 1.0 - smoothstep(0.0, 0.25 * uLeafSize.x, -vD);
    float amount = 0.22 * s * uLift;
    color *= vec3(1.0) - amount * vec3(0.78, 0.84, 0.95); // warm shadow
  }

  outColor = vec4(color, 1.0);
}
`;

/**
 * Ground pass: opaque quad over the moving leaf's rect showing the revealed
 * page beneath the curl, with the curl's soft cast shadow composited in.
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

export const GROUND_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTexRevealed;
uniform vec2 uLeafSize;
uniform float uFoldD;
uniform float uTilt;
uniform float uRadius;
uniform float uLift;
${FRAG_COMMON}
out vec4 outColor;

void main() {
  // The revealed page sits the same way round as the leaf's front face.
  vec3 color = paperMultiply(samplePage(uTexRevealed, faceUv(vUv, false)), vUv);

  // Shadow geometry stays in LEAF-local space (vUv is unmirrored) so the
  // band tracks the fold line the vertex shader used — same spine-anchored
  // distance, or the shadow drifts off the crease.
  vec2 local = vUv * uLeafSize;
  vec2 n = vec2(cos(uTilt), sin(uTilt));
  float d = dot(local - vec2(0.0, uLeafSize.y * 0.5), n) - uFoldD;

  // The curled sheet hovers just past the fold; its cast shadow is a soft
  // band centered under the cylinder. Width tracks curl height, softness
  // grows with lift.
  float center = uRadius * 0.6;
  float halfWidth = uRadius * 1.5 + uLift * 26.0;
  float a = 0.30 * uLift * (1.0 - smoothstep(0.0, halfWidth, abs(d - center)));

  color *= vec3(1.0) - a * vec3(0.70, 0.78, 0.87); // warm brown, never black
  outColor = vec4(color, 1.0);
}
`;

/* ----------------------------------------------------------------------------
   Renderer
   -------------------------------------------------------------------------- */

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
  /** Canvas css size. */
  canvasW: number;
  canvasH: number;
}

/**
 * Owns the two programs (curl mesh + ground pass), the 40x8 mesh, the quad,
 * and the four textures. One instance per FlipSurface; all GL objects are
 * created once at book-open so gesture start never compiles/allocates.
 */
export class CurlRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly curlProgram: GlProgram;
  private readonly groundProgram: GlProgram;
  private readonly mesh: GlMesh;
  private readonly quad: GlMesh;
  private front: WebGLTexture;
  private back: WebGLTexture;
  private revealed: WebGLTexture;
  private paper: WebGLTexture;
  private paperTileCss = 512;
  private paperMix = 0;
  private disposed = false;

  constructor(private readonly ctx: FlipContext) {
    const gl = ctx.gl;
    this.gl = gl;
    this.curlProgram = new GlProgram(gl, CURL_VERT_SRC, CURL_FRAG_SRC);
    this.groundProgram = new GlProgram(gl, GROUND_VERT_SRC, GROUND_FRAG_SRC);
    this.mesh = createGridMesh(gl, CURL_GRID_COLS, CURL_GRID_ROWS);
    this.quad = createQuadMesh(gl);
    this.front = this.creamTexture();
    this.back = this.creamTexture();
    this.revealed = this.creamTexture();
    this.paper = createSolidTexture(gl, 255, 255, 255);
  }

  private creamTexture(): WebGLTexture {
    const [r, g, b] = PAPER_CREAM_RGB;
    return createSolidTexture(this.gl, r, g, b);
  }

  /**
   * Upload page snapshots at flip start (~1ms each). `null` falls back to
   * plain cream paper (e.g. flipping to a not-yet-rasterized page).
   * front = moving page's visible face; back = destination page printed on
   * the sheet's other side; revealed = page uncovered beneath the sheet.
   */
  setPageTextures(
    front: ImageBitmap | null,
    back: ImageBitmap | null,
    revealed: ImageBitmap | null,
  ): void {
    const gl = this.gl;
    gl.deleteTexture(this.front);
    gl.deleteTexture(this.back);
    gl.deleteTexture(this.revealed);
    this.front = front ? uploadTexture(gl, front) : this.creamTexture();
    this.back = back ? uploadTexture(gl, back) : this.creamTexture();
    this.revealed = revealed ? uploadTexture(gl, revealed) : this.creamTexture();
  }

  /** Same tiled paper texture the resting CSS uses; enables the multiply. */
  setPaperTexture(tile: ImageBitmap | HTMLCanvasElement, tileCssSize: number, mix = 0.35): void {
    this.gl.deleteTexture(this.paper);
    this.paper = uploadTexture(this.gl, tile, null, true);
    this.paperTileCss = tileCssSize;
    this.paperMix = mix;
  }

  /** Draw one frame: clear → ground pass (revealed + shadow) → curl mesh. */
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
    const proj = perspectiveMatrix(
      CURL_FOV_RAD,
      frame.canvasW / frame.canvasH,
      camDist * 0.1,
      camDist * 10,
    );

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const setCommon = (prog: GlProgram): void => {
      prog.set2f('uLeafSize', leafW, leafH);
      prog.set2f('uLeafOrigin', frame.leafX, frame.leafY);
      prog.set2f('uCanvasSize', frame.canvasW, frame.canvasH);
      prog.set1f('uDir', dirSign);
      prog.setMat4('uProj', proj);
      prog.set1f('uCamDist', camDist);
      prog.set1f('uFoldD', foldD);
      prog.set1f('uTilt', tilt);
      prog.set1f('uRadius', radius);
      prog.set1f('uLift', lift);
      prog.set2f('uPaperScale', leafW / this.paperTileCss, leafH / this.paperTileCss);
      prog.set1f('uPaperMix', this.paperMix);
      prog.set1f('uPaperMean', 0.94);
    };

    this.groundProgram.use();
    setCommon(this.groundProgram);
    this.groundProgram.setTexture('uTexRevealed', this.revealed, 0);
    this.groundProgram.setTexture('uPaperTex', this.paper, 2);
    this.quad.draw();

    this.curlProgram.use();
    setCommon(this.curlProgram);
    this.curlProgram.setTexture('uTexFront', this.front, 0);
    this.curlProgram.setTexture('uTexBack', this.back, 1);
    this.curlProgram.setTexture('uPaperTex', this.paper, 2);
    this.mesh.draw();
  }

  clear(): void {
    if (this.disposed || this.ctx.isLost()) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    this.curlProgram.dispose();
    this.groundProgram.dispose();
    this.mesh.dispose();
    this.quad.dispose();
    gl.deleteTexture(this.front);
    gl.deleteTexture(this.back);
    gl.deleteTexture(this.revealed);
    gl.deleteTexture(this.paper);
  }
}
