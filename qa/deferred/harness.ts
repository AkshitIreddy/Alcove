/**
 * Offline contact-sheet harness for the deferred lighting pass.
 * Raw WebGL2 — same GLSL the Pixi filter uses.
 */
import {
  DEFAULT_LIGHT_RIG,
  LIGHT_RIGS,
  KEY_ANGLE,
  resolveLightRig,
  type LightRig,
} from '../../src/art/lighting';
import { buildLightingFragment, RAW_VERTEX_SOURCE, type LightingQuality } from '../../src/render/glsl';
import { packLightingUniforms, type LightingUniforms } from '../../src/render/uniforms';
import { buildTestScene, type TestScene } from '../../src/render/testScene';

type Canvas = HTMLCanvasElement;

function el(w: number, h: number): Canvas {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* ------------------------------- GL renderer ------------------------------ */

class Renderer {
  gl: WebGL2RenderingContext;
  canvas: Canvas;
  programs = new Map<string, WebGLProgram>();
  texA: WebGLTexture;
  texN: WebGLTexture;

  constructor(w: number, h: number) {
    this.canvas = el(w, h);
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    this.texA = gl.createTexture()!;
    this.texN = gl.createTexture()!;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 2, 0, 0, 2]), gl.STATIC_DRAW);
  }

  program(quality: LightingQuality): WebGLProgram {
    const hit = this.programs.get(quality);
    if (hit) return hit;
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s) ?? '';
        const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
        throw new Error(`shader compile failed:\n${log}\n---\n${numbered}`);
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, RAW_VERTEX_SOURCE));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, buildLightingFragment({ quality, target: 'raw' })));
    gl.bindAttribLocation(p, 0, 'aPosition');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`link failed: ${gl.getProgramInfoLog(p)}`);
    }
    this.programs.set(quality, p);
    return p;
  }

  upload(tex: WebGLTexture, unit: number, src: Canvas | OffscreenCanvas): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  render(scene: TestScene, u: LightingUniforms, quality: LightingQuality = 'high'): Canvas {
    const gl = this.gl;
    if (this.canvas.width !== scene.width || this.canvas.height !== scene.height) {
      this.canvas.width = scene.width;
      this.canvas.height = scene.height;
    }
    const p = this.program(quality);
    gl.useProgram(p);
    gl.viewport(0, 0, scene.width, scene.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.upload(this.texA, 0, scene.albedo as Canvas);
    this.upload(this.texN, 1, scene.normals as Canvas);
    gl.uniform1i(gl.getUniformLocation(p, 'uTexture'), 0);
    gl.uniform1i(gl.getUniformLocation(p, 'uNormalMap'), 1);
    // Stand in for Pixi's global filter uniforms so the shared shader works.
    const li = gl.getUniformLocation(p, 'uInputSize');
    if (li) gl.uniform4f(li, scene.width, scene.height, 1 / scene.width, 1 / scene.height);
    const lo = gl.getUniformLocation(p, 'uOutputFrame');
    if (lo) gl.uniform4f(lo, 0, 0, scene.width, scene.height);

    for (const [name, value] of Object.entries(u)) {
      const arr = value as number[];
      const isArrayUniform = name.startsWith('uShaft');
      const loc = gl.getUniformLocation(p, isArrayUniform ? `${name}[0]` : name);
      if (!loc) continue;
      const f = new Float32Array(arr);
      if (isArrayUniform) gl.uniform4fv(loc, f);
      else if (arr.length === 3) gl.uniform3fv(loc, f);
      else if (arr.length === 4) gl.uniform4fv(loc, f);
      else if (arr.length === 2) gl.uniform2fv(loc, f);
      else gl.uniform1f(loc, arr[0]!);
    }

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const out = el(scene.width, scene.height);
    out.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return out;
  }
}

/* ------------------------------ contact sheet ----------------------------- */

export interface Cell {
  label: string;
  canvas: Canvas | OffscreenCanvas;
}

function sheet(cells: Cell[], cols: number, title: string): string {
  const cw = cells[0]!.canvas.width;
  const ch = cells[0]!.canvas.height;
  const pad = 10;
  const lab = 24;
  const rows = Math.ceil(cells.length / cols);
  const W = cols * (cw + pad) + pad;
  const H = rows * (ch + pad + lab) + pad + 34;
  const c = el(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#15120e';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8dcc4';
  g.font = 'bold 17px sans-serif';
  g.fillText(title, pad, 24);
  cells.forEach((cell, i) => {
    const cx = pad + (i % cols) * (cw + pad);
    const cy = 34 + pad + Math.floor(i / cols) * (ch + pad + lab);
    g.drawImage(cell.canvas as CanvasImageSource, cx, cy);
    g.strokeStyle = '#3a3128';
    g.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
    g.fillStyle = '#cfc3a8';
    g.font = '13px sans-serif';
    g.fillText(cell.label, cx + 2, cy + ch + 16);
  });
  return c.toDataURL('image/png');
}

/* --------------------------------- sheets --------------------------------- */

const CELL_W = 420;
const CELL_H = 300;

function unlit(scene: TestScene): Canvas {
  const c = el(scene.width, scene.height);
  c.getContext('2d')!.drawImage(scene.albedo as CanvasImageSource, 0, 0);
  return c;
}

function makeScene(w = CELL_W, h = CELL_H, seed = 0x51a7, flat = false): TestScene {
  return buildTestScene({ width: w, height: h, seed, shelves: 2, flatAlbedo: flat });
}

const R = new Renderer(CELL_W, CELL_H);

function render(scene: TestScene, rig: LightRig, quality: LightingQuality = 'high', debug = 0): Canvas {
  const u = packLightingUniforms(rig, {
    width: scene.width,
    height: scene.height,
    scale: scene.width / 1200,
    time: 3.2,
    debug,
  }, quality);
  return R.render(scene, u, quality);
}

export function sheetRigs(): string {
  const scene = makeScene();
  const cells: Cell[] = [{ label: 'UNLIT albedo (what elements draw)', canvas: unlit(scene) }];
  for (const id of Object.keys(LIGHT_RIGS)) {
    cells.push({ label: LIGHT_RIGS[id]!.label, canvas: render(scene, LIGHT_RIGS[id]!) });
  }
  return sheet(cells, 4, 'RIGS — same scene, every shipped light');
}

export function sheetAngles(): string {
  const scene = makeScene();
  const cells: Cell[] = [{ label: 'UNLIT albedo', canvas: unlit(scene) }];
  const angles: Array<[string, number]> = [
    ['upper-left  0.25π', KEY_ANGLE.upperLeft],
    ['above  0.50π', KEY_ANGLE.above],
    ['upper-right 0.75π', KEY_ANGLE.upperRight],
    ['right  1.00π', KEY_ANGLE.right],
    ['lower-right 1.25π', KEY_ANGLE.lowerRight],
    ['left  0.00π', 0],
    ['0.62π', Math.PI * 0.62],
    ['0.88π', Math.PI * 0.88],
  ];
  for (const [label, a] of angles) {
    cells.push({ label, canvas: render(scene, resolveLightRig({ keyAngle: a })) });
  }
  return sheet(cells, 3, 'KEY ANGLE — golden-hour rig, one angle per cell');
}

export function sheetElevation(): string {
  const scene = makeScene();
  const cells: Cell[] = [];
  for (const e of [0.08, 0.16, 0.26, 0.4, 0.6, 0.9]) {
    cells.push({ label: `keyElevation ${e}`, canvas: render(scene, resolveLightRig({ keyElevation: e })) });
  }
  for (const s of [40, 90, 140, 220]) {
    cells.push({ label: `shadowReach ${s}px`, canvas: render(scene, resolveLightRig({ shadowReach: s })) });
  }
  for (const hs of [110, 190, 280]) {
    cells.push({ label: `heightScale ${hs}`, canvas: render(scene, resolveLightRig({ heightScale: hs })) });
  }
  return sheet(cells, 4, 'RAKE — elevation, shadow reach, height scale');
}

export function sheetDebug(): string {
  const scene = makeScene();
  const rig = DEFAULT_LIGHT_RIG;
  const names = ['final', 'normals', 'height', 'ao', 'shadow', 'albedo', 'luminance'];
  const cells: Cell[] = names.map((label, i) => ({ label, canvas: render(scene, rig, 'high', i) }));
  return sheet(cells, 4, 'BUFFERS — what the one pass is actually reading');
}

export function sheetQuality(): string {
  const scene = makeScene();
  const cells: Cell[] = (['low', 'medium', 'high', 'ultra'] as LightingQuality[]).map((q) => ({
    label: q,
    canvas: render(scene, DEFAULT_LIGHT_RIG, q),
  }));
  cells.push({ label: 'FLAT albedo, lit', canvas: render(makeScene(CELL_W, CELL_H, 0x51a7, true), DEFAULT_LIGHT_RIG) });
  cells.push({ label: 'FLAT albedo, unlit', canvas: unlit(makeScene(CELL_W, CELL_H, 0x51a7, true)) });
  return sheet(cells, 3, 'QUALITY tiers + the flat-albedo torture test');
}

export function sheetHero(): string {
  const scene = makeScene(1100, 680, 0x9a17);
  return sheet(
    [
      { label: 'UNLIT — flat fillRect albedo, exactly what elements draw', canvas: unlit(scene) },
      { label: 'LIT — one fullscreen pass, golden hour', canvas: render(scene, DEFAULT_LIGHT_RIG) },
    ],
    1,
    'THE CLAIM — all depth in this picture comes from one shader',
  );
}
(window as any).H = (window as any).H || {};

export function sheetBig(rigId: string): string {
  const scene = makeScene(900, 620);
  const rig = LIGHT_RIGS[rigId] ?? DEFAULT_LIGHT_RIG;
  return sheet(
    [
      { label: 'unlit', canvas: unlit(scene) },
      { label: rig.label, canvas: render(scene, rig) },
    ],
    2,
    `DETAIL — ${rig.label} at 900×620`,
  );
}

export function timing(): string {
  const out: string[] = [];
  for (const [w, h] of [[1200, 800], [1920, 1080], [2560, 1440]] as Array<[number, number]>) {
    const scene = makeScene(w, h);
    for (const q of ['low', 'medium', 'high', 'ultra'] as LightingQuality[]) {
      const u = packLightingUniforms(DEFAULT_LIGHT_RIG, { width: w, height: h, time: 0 }, q);
      R.render(scene, u, q);
      R.gl.finish();
      const t0 = performance.now();
      for (let i = 0; i < 12; i++) R.render(scene, u, q);
      R.gl.finish();
      out.push(`${w}x${h} ${q}: ${((performance.now() - t0) / 12).toFixed(2)} ms/frame`);
    }
  }
  return out.join(String.fromCharCode(10));
}

// Expose everything to Playwright.
(window as unknown as Record<string, unknown>).H = {
  sheetRigs,
  sheetAngles,
  sheetElevation,
  sheetDebug,
  sheetQuality,
  sheetBig,
  timing,
};
(window as unknown as Record<string, unknown>).HREADY = true;

export function sheetDiagnose(): string {
  const scene = makeScene();
  const off = {
    rim: { rimStrength: 0 },
    spec: { specular: 0 },
    shafts: { shafts: [] },
    bloom: { bloom: 0 },
    splittone: { shadowTint: 0, highlightTint: 0 },
    hot: { hotSpot: 0 },
    haze: { hazeStrength: 0 },
    grain: { grain: 0 },
    vignette: { vignette: 0 },
    ao: { ambientOcclusion: 0 },
    shadow: { contactStrength: 0 },
    temp: { temperatureShift: 0 },
  } as Record<string, Record<string, unknown>>;
  const cells: Cell[] = [{ label: 'all on', canvas: render(scene, DEFAULT_LIGHT_RIG) }];
  for (const [k, v] of Object.entries(off)) {
    cells.push({ label: `no ${k}`, canvas: render(scene, resolveLightRig(v as never)) });
  }
  return sheet(cells, 4, 'DIAGNOSE — one term removed per cell');
}
(window as any).H.sheetDiagnose = sheetDiagnose;

export function sheetTune(): string {
  const scene = makeScene();
  const combos: Array<[string, Record<string, unknown>]> = [
    ['base', {}],
    ['ambient .46', { ambientLevel: 0.46 }],
    ['ambient .46 + exp 1.15', { ambientLevel: 0.46, exposure: 1.15 }],
    ['+ fill .4', { ambientLevel: 0.46, exposure: 1.15, fillIntensity: 0.4 }],
    ['+ ao .55 r16', { ambientLevel: 0.46, exposure: 1.15, fillIntensity: 0.4, ambientOcclusion: 0.55, aoRadius: 16 }],
    ['+ falloff .35', { ambientLevel: 0.46, exposure: 1.15, fillIntensity: 0.4, ambientOcclusion: 0.55, aoRadius: 16, keyFalloff: 0.35 }],
    ['+ reach 100', { ambientLevel: 0.46, exposure: 1.15, fillIntensity: 0.4, ambientOcclusion: 0.55, aoRadius: 16, keyFalloff: 0.35, shadowReach: 100 }],
    ['+ grain .01 hot .5', { ambientLevel: 0.46, exposure: 1.15, fillIntensity: 0.4, ambientOcclusion: 0.55, aoRadius: 16, keyFalloff: 0.35, shadowReach: 100, grain: 0.01, hotSpot: 0.5 }],
    ['+ contrast .18', { ambientLevel: 0.46, exposure: 1.15, fillIntensity: 0.4, ambientOcclusion: 0.55, aoRadius: 16, keyFalloff: 0.35, shadowReach: 100, grain: 0.01, hotSpot: 0.5, contrast: 0.18 }],
  ];
  const cells: Cell[] = combos.map(([label, o]) => ({ label, canvas: render(scene, resolveLightRig(o as never)) }));
  return sheet(cells, 3, 'TUNE — cumulative value-structure changes');
}
(window as any).H.sheetTune = sheetTune;

const TUNED = { ambientLevel: 0.46, exposure: 1.15, fillIntensity: 0.4, ambientOcclusion: 0.55, aoRadius: 16, keyFalloff: 0.35, shadowReach: 100, grain: 0.012, hotSpot: 0.5, contrast: 0.18 };

export function sheetWrap(): string {
  const scene = makeScene();
  const cells: Cell[] = [];
  for (const wrap of [0.2, 0.35, 0.5, 0.65]) {
    for (const elev of [0.22, 0.34]) {
      cells.push({
        label: `wrap ${wrap} / elev ${elev}`,
        canvas: render(scene, resolveLightRig({ ...TUNED, keyWrap: wrap, keyElevation: elev } as never)),
      });
    }
  }
  return sheet(cells, 4, 'TERMINATOR — wrap x elevation');
}
(window as any).H.sheetWrap = sheetWrap;
(window as any).TUNED = TUNED;

export function sheetBloom(): string {
  const scene = makeScene(620, 420);
  const cells: Cell[] = [];
  for (const r of [6, 10, 16, 24, 34, 48]) {
    cells.push({ label: `bloomRadius ${r}`, canvas: render(scene, resolveLightRig({ bloomRadius: r } as never)) });
  }
  return sheet(cells, 3, 'BLOOM RADIUS — where the spiral stops aliasing');
}
(window as any).H.sheetBloom = sheetBloom;

/* --------------------- the real Pixi filter, end to end -------------------- */

import { Application, CanvasSource, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { DeferredLightingFilter } from '../../src/render/deferredLighting';
import type { NormalBuffer } from '../../src/render/gbuffer';

export async function sheetPixi(): Promise<string> {
  const W = 900;
  const H = 620;
  const scene = makeScene(W, H);
  const app = new Application();
  await app.init({
    width: W,
    height: H,
    preference: 'webgl',
    backgroundAlpha: 0,
    antialias: false,
  } as never);

  const albedoTex = new Texture({ source: new CanvasSource({ resource: scene.albedo as HTMLCanvasElement }) });
  const normalTex = new Texture({
    source: new CanvasSource({
      resource: scene.normals as HTMLCanvasElement,
      scaleMode: 'linear',
      addressMode: 'clamp-to-edge',
      antialias: false,
    }),
  });
  const buffer: NormalBuffer = {
    texture: normalTex,
    width: W,
    height: H,
    resolution: 1,
    destroy() {},
  };

  const world = new Container();
  world.addChild(new Sprite(albedoTex));
  const filter = new DeferredLightingFilter({
    rig: DEFAULT_LIGHT_RIG,
    normals: buffer,
    quality: 'high',
    sceneWidth: W,
    sceneHeight: H,
  });
  world.filters = [filter];
  world.filterArea = new Rectangle(0, 0, W, H);
  app.stage.addChild(world);

  const shot = async (label: string, mode: any): Promise<Cell> => {
    filter.setDebug(mode);
    app.render();
    const c = await app.renderer.extract.canvas(world);
    const o = el(W, H);
    o.getContext('2d')!.drawImage(c as CanvasImageSource, 0, 0);
    return { label, canvas: o };
  };
  const dbg: Cell[] = [];
  dbg.push(await shot('pixi: albedo', 'albedo'));
  dbg.push(await shot('pixi: height', 'height'));
  dbg.push(await shot('pixi: normals', 'normals'));
  const finalCell = await shot('pixi: final', 'final');
  const out = finalCell.canvas as HTMLCanvasElement;

  const u = packLightingUniforms(DEFAULT_LIGHT_RIG, { width: W, height: H, scale: W / 1200, time: 3.2 }, 'high');
  const raw = R.render(scene, u, 'high');

  const png = sheet(
    [{ label: 'raw WebGL2 harness', canvas: raw }, { label: 'PixiJS v8 filter (the app path)', canvas: out }, ...dbg],
    3,
    'PIXI PARITY — same GLSL, both wrappers',
  );
  app.destroy(true, { children: true });
  return png;
}
(window as any).H.sheetPixi = sheetPixi;

(window as any).H.sheetHero = sheetHero;

/** Our render at the reference image's aspect, for a side-by-side. */
export function sheetReferenceMatch(): string {
  const scene = makeScene(800, 480, 0x3311);
  return sheet(
    [{ label: 'deferred pass, golden hour — 800x480', canvas: render(scene, DEFAULT_LIGHT_RIG) }],
    1,
    'FOR COMPARISON WITH docs/design/reference/bookshelf-reference.png',
  );
}
(window as any).H.sheetReferenceMatch = sheetReferenceMatch;
