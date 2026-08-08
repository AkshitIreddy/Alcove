/**
 * src/flip/gl.ts — minimal WebGL2 wrapper for the page-flip overlay.
 *
 * Hand-rolled per the design doc (no three.js — protects cold start and
 * bundle size). Provides exactly what the curl renderer needs: context
 * creation with loss handling, program compilation, the 64x16 grid mesh, a
 * unit quad, ImageBitmap texture upload and cached uniform helpers.
 */

/* ----------------------------------------------------------------------------
   Context
   -------------------------------------------------------------------------- */

export interface FlipContextHandlers {
  /** GPU context lost mid-flight — abort the flip via the CSS path. */
  onLost?: () => void;
  /** Context came back — safe to lazily rebuild GL resources. */
  onRestored?: () => void;
}

export interface FlipContext {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  isLost(): boolean;
  /** Sets canvas backing-store size + viewport. No-op when unchanged. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  dispose(): void;
}

/**
 * Create a WebGL2 context on `canvas`. Returns null when WebGL2 is
 * unavailable (caller falls back to the CSS rigid fold).
 */
export function createFlipContext(
  canvas: HTMLCanvasElement,
  handlers: FlipContextHandlers = {},
): FlipContext | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    // A turning sheet OVERLAPS ITSELF: past a half turn its tail lies back
    // flat on top of the strip between the spine and the fold, and the
    // camera's perspective pushes that lifted tail up to ~38px off the
    // paper it covers. Without a depth buffer the winner was whatever the
    // index buffer drew last, and the mesh is indexed row-major — so row
    // j's lifted tail was painted over by row j+1's flat strip, once per
    // mesh row, everywhere below the canvas centre. That leak is the
    // "weird shadowey effect" in the bottom half of a turning page (see
    // the header of curl.ts). Depth makes draw order irrelevant: the paper
    // that is physically higher always wins, at every tilt and every p.
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  let lost = gl.isContextLost();

  const handleLost = (event: Event): void => {
    event.preventDefault(); // opt into restoration
    lost = true;
    handlers.onLost?.();
  };
  const handleRestored = (): void => {
    lost = false;
    handlers.onRestored?.();
  };
  canvas.addEventListener('webglcontextlost', handleLost);
  canvas.addEventListener('webglcontextrestored', handleRestored);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  // LEQUAL, not LESS: the ground quad and the un-deformed strip of the curl
  // mesh are BOTH at z=0, and the ground is drawn first. Under LESS the
  // mesh would lose the tie and the flat part of the moving page would
  // never be drawn at all — the revealed page would show through it. Under
  // LEQUAL the later draw wins a tie (the old, correct painter's order)
  // while anything genuinely lifted still wins outright.
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);

  let width = 0;
  let height = 0;

  return {
    gl,
    canvas,
    isLost: () => lost || gl.isContextLost(),
    resize(cssWidth, cssHeight, dpr) {
      const w = Math.max(1, Math.round(cssWidth * dpr));
      const h = Math.max(1, Math.round(cssHeight * dpr));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/* ----------------------------------------------------------------------------
   Program + uniforms
   -------------------------------------------------------------------------- */

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('flip/gl: createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`flip/gl: shader compile failed — ${log}`);
  }
  return shader;
}

/** Compiled program with cached uniform locations and typed setters. */
export class GlProgram {
  readonly program: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSrc: string,
    fragmentSrc: string,
  ) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
    const program = gl.createProgram();
    if (!program) throw new Error('flip/gl: createProgram failed');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown error';
      gl.deleteProgram(program);
      throw new Error(`flip/gl: program link failed — ${log}`);
    }
    this.program = program;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  private loc(name: string): WebGLUniformLocation | null {
    let cached = this.locations.get(name);
    if (cached === undefined) {
      cached = this.gl.getUniformLocation(this.program, name);
      this.locations.set(name, cached);
    }
    return cached;
  }

  set1f(name: string, x: number): void {
    this.gl.uniform1f(this.loc(name), x);
  }

  set2f(name: string, x: number, y: number): void {
    this.gl.uniform2f(this.loc(name), x, y);
  }

  set3f(name: string, x: number, y: number, z: number): void {
    this.gl.uniform3f(this.loc(name), x, y, z);
  }

  set4f(name: string, x: number, y: number, z: number, w: number): void {
    this.gl.uniform4f(this.loc(name), x, y, z, w);
  }

  setMat4(name: string, m: Float32Array): void {
    this.gl.uniformMatrix4fv(this.loc(name), false, m);
  }

  /** Binds `texture` to `unit` and points the sampler uniform at it. */
  setTexture(name: string, texture: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.loc(name), unit);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

/* ----------------------------------------------------------------------------
   Meshes
   -------------------------------------------------------------------------- */

export interface GlMesh {
  readonly vao: WebGLVertexArrayObject;
  readonly indexCount: number;
  draw(): void;
  dispose(): void;
}

/**
 * Grid mesh over the unit square (a_uv in [0,1]²), `cols` x `rows` cells
 * (64x16 in CurlRenderer). The vertex shader owns all deformation, so the only
 * attribute is uv at location 0.
 */
export function createGridMesh(gl: WebGL2RenderingContext, cols: number, rows: number): GlMesh {
  const vertsX = cols + 1;
  const vertsY = rows + 1;
  const uv = new Float32Array(vertsX * vertsY * 2);
  let o = 0;
  for (let j = 0; j < vertsY; j++) {
    for (let i = 0; i < vertsX; i++) {
      uv[o++] = i / cols;
      uv[o++] = j / rows;
    }
  }
  const indices = new Uint16Array(cols * rows * 6);
  o = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * vertsX + i;
      const b = a + 1;
      const c = a + vertsX;
      const d = c + 1;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }
  return buildMesh(gl, uv, indices);
}

/** Unit quad (two triangles) for the ground-shadow pass. */
export function createQuadMesh(gl: WebGL2RenderingContext): GlMesh {
  const uv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const indices = new Uint16Array([0, 2, 1, 1, 2, 3]);
  return buildMesh(gl, uv, indices);
}

function buildMesh(gl: WebGL2RenderingContext, uv: Float32Array, indices: Uint16Array): GlMesh {
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  if (!vao || !vbo || !ibo) throw new Error('flip/gl: buffer allocation failed');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const indexCount = indices.length;
  return {
    vao,
    indexCount,
    draw() {
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
    },
  };
}

/* ----------------------------------------------------------------------------
   Textures
   -------------------------------------------------------------------------- */

/**
 * Upload an ImageBitmap (or canvas) into `existing` if given, else a new
 * texture. LINEAR filtering, CLAMP_TO_EDGE — page snapshots are drawn
 * near 1:1 so no mips are needed (upload stays ~1ms at flip start).
 */
export function uploadTexture(
  gl: WebGL2RenderingContext,
  source: ImageBitmap | HTMLCanvasElement,
  existing?: WebGLTexture | null,
  repeat = false,
): WebGLTexture {
  const texture = existing ?? gl.createTexture();
  if (!texture) throw new Error('flip/gl: createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

/** 1x1 solid-color texture (fallback when a snapshot is missing). */
export function createSolidTexture(
  gl: WebGL2RenderingContext,
  r: number,
  g: number,
  b: number,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('flip/gl: createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([r, g, b, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

/* ----------------------------------------------------------------------------
   Projection
   -------------------------------------------------------------------------- */

/**
 * Perspective matrix (column-major) for the flip camera: fov ~20°, camera on
 * +z looking at the canvas plane, distance chosen by the caller so that the
 * z=0 plane maps 1:1 to the viewport — flat geometry stays pixel-exact and
 * only lifted (z>0) parts foreshorten.
 */
export function perspectiveMatrix(fovYRad: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovYRad / 2);
  const inv = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * inv, -1,
    0, 0, 2 * near * far * inv, 0,
  ]);
}

/** Camera distance that makes the z=0 plane fill the viewport at `fovY`. */
export function cameraDistanceForViewport(viewportHeight: number, fovYRad: number): number {
  return viewportHeight / 2 / Math.tan(fovYRad / 2);
}
