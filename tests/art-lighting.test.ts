// @vitest-environment node
/**
 * tests/art-lighting.test.ts — the deferred scene-lighting system.
 *
 * `docs/design/painted-rendering.md` Pillar 2 moved lighting off the CPU and
 * into one fullscreen GPU pass. That split the system into three pieces with
 * very different testability, and this file covers all three in plain Node
 * with no canvas and no GPU:
 *
 *  - **`src/art/lighting.ts`** — the rig: what a light *is*. Pure data,
 *    normalized totally, so junk from a theme file can never reach a shader.
 *  - **`src/render/normals.ts`** — the height/normal contribution API. Closed
 *    -form profiles, so every claim about the height buffer can be checked by
 *    evaluating the function.
 *  - **`src/render/uniforms.ts`** + **`glsl.ts`** — the compile step. The
 *    shader is text here, but the *contract* between the packing and the
 *    source (every uniform declared, every name packed, no NaN) is exactly
 *    the kind of thing that silently produces a black screen on a GPU and is
 *    trivial to pin down off one.
 *
 * The visual claims — that a flat-box scene reads three-dimensional under this
 * pass — are proved by rendered contact sheets in `qa/deferred/`, not here;
 * an assertion cannot look at a picture.
 */

import { describe, expect, it } from 'vitest';

import {
  autoKeyOrigin,
  DEFAULT_LIGHT_RIG,
  FEATURED_LIGHT_RIG_IDS,
  getLightRig,
  KEY_ANGLE,
  LIGHT_RIGS,
  LIGHT_RIG_IDS,
  resolveLightRig,
  type LightRig,
} from '../src/art/lighting';
import {
  buildLightingFragment,
  DEBUG_MODES,
  debugModeId,
  LIGHTING_UNIFORMS,
  qualityProfile,
  QUALITY_PROFILES,
  type LightingQuality,
} from '../src/render/glsl';
import {
  decodeSurface,
  encodeSurface,
  EMPTY_SURFACE_BYTES,
  HEIGHT_SHAPE_KINDS,
  PROFILE_MAX,
  rasterizeShape,
  sampleShape,
  shapeKey,
  type HeightShape,
} from '../src/render/normals';
import {
  keyVector,
  LIGHTING_UNIFORM_NAMES,
  LIGHTING_UNIFORM_TYPES,
  normalUvTransform,
  packLightingUniforms,
  REFERENCE_WIDTH,
} from '../src/render/uniforms';

const QUALITIES: LightingQuality[] = ['low', 'medium', 'high', 'ultra'];

/* ========================================================================== *
 *                                  the rig                                   *
 * ========================================================================== */

describe('LightRig presets', () => {
  it('ships every featured rig', () => {
    for (const id of FEATURED_LIGHT_RIG_IDS) {
      expect(LIGHT_RIGS[id], `missing featured rig ${id}`).toBeDefined();
    }
    // The brief asks for 6–8 headline lights, one per *kind* of light.
    expect(FEATURED_LIGHT_RIG_IDS.length).toBeGreaterThanOrEqual(6);
    expect(FEATURED_LIGHT_RIG_IDS.length).toBeLessThanOrEqual(8);
  });

  it('covers the range the doc names', () => {
    // golden-hour rake, overcast soft, moonlit cool, candlelit warm,
    // greenhouse daylight, neon night.
    for (const id of [
      'golden-hour',
      'overcast-studio',
      'moonlit',
      'candlelit',
      'greenhouse',
      'neon-arcade',
    ]) {
      expect(LIGHT_RIG_IDS).toContain(id);
    }
  });

  it('gives every rig its own id and label', () => {
    const ids = new Set<string>();
    const labels = new Set<string>();
    for (const id of LIGHT_RIG_IDS) {
      const rig = LIGHT_RIGS[id] as LightRig;
      expect(rig.id).toBe(id);
      expect(rig.label.length).toBeGreaterThan(0);
      ids.add(rig.id);
      labels.add(rig.label);
    }
    expect(ids.size).toBe(LIGHT_RIG_IDS.length);
    expect(labels.size).toBe(LIGHT_RIG_IDS.length);
  });

  it('keeps every rig inside its documented ranges', () => {
    for (const id of LIGHT_RIG_IDS) {
      const rig = LIGHT_RIGS[id] as LightRig;
      const where = `rig ${id}`;
      expect(rig.keyElevation, where).toBeGreaterThan(0);
      expect(rig.keyElevation, where).toBeLessThanOrEqual(1.5);
      expect(rig.keyWrap, where).toBeGreaterThanOrEqual(0);
      expect(rig.keyWrap, where).toBeLessThanOrEqual(1);
      expect(rig.heightScale, where).toBeGreaterThan(0);
      expect(rig.shadowReach, where).toBeGreaterThanOrEqual(0);
      expect(rig.aoRadius, where).toBeGreaterThanOrEqual(0);
      expect(rig.lift, where).toHaveLength(3);
      expect(rig.gamma, where).toHaveLength(3);
      expect(rig.gain, where).toHaveLength(3);
      for (const g of rig.gamma) expect(g, where).toBeGreaterThan(0);
      expect(rig.shafts.length, where).toBeLessThanOrEqual(4);
    }
  });

  it('caps bloom radius where the single-pass spiral still reads as a kernel', () => {
    // Beyond ~18px at reference scale the 12-tap spiral streaks (qa/deferred
    // sheetBloom). Rigs are authored under that so the clamp never bites.
    for (const id of LIGHT_RIG_IDS) {
      expect((LIGHT_RIGS[id] as LightRig).bloomRadius, id).toBeLessThanOrEqual(18);
    }
  });

  it('lights every rig from somewhere — no rig is pure ambient', () => {
    for (const id of LIGHT_RIG_IDS) {
      const rig = LIGHT_RIGS[id] as LightRig;
      expect(rig.keyIntensity, id).toBeGreaterThan(0.2);
    }
  });
});

describe('resolveLightRig', () => {
  it('is total on junk', () => {
    const junk = {
      keyAngle: Number.NaN,
      keyElevation: 'high',
      keyColour: 42,
      lift: 'nope',
      gamma: [Number.POSITIVE_INFINITY, 1, 1],
      shafts: [{ width: Number.NaN }],
      aoRadius: -900,
      localColour: {},
    } as unknown as Parameters<typeof resolveLightRig>[0];
    const rig = resolveLightRig(junk);
    for (const [k, v] of Object.entries(rig)) {
      if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
    }
    expect(rig.keyAngle).toBe(DEFAULT_LIGHT_RIG.keyAngle);
    expect(rig.keyColour).toBe(DEFAULT_LIGHT_RIG.keyColour);
    expect(rig.aoRadius).toBe(0);
    for (const g of rig.gamma) expect(Number.isFinite(g)).toBe(true);
  });

  it('is total on nothing at all', () => {
    expect(resolveLightRig()).toEqual(DEFAULT_LIGHT_RIG);
    expect(resolveLightRig({})).toEqual(DEFAULT_LIGHT_RIG);
  });

  it('is idempotent on every shipped rig', () => {
    for (const id of LIGHT_RIG_IDS) {
      const rig = LIGHT_RIGS[id] as LightRig;
      expect(resolveLightRig(rig, rig), id).toEqual(rig);
    }
  });

  it('keeps overrides and inherits the rest', () => {
    const rig = resolveLightRig({ keyElevation: 0.9, shadowReach: 42 });
    expect(rig.keyElevation).toBeCloseTo(0.9);
    expect(rig.shadowReach).toBe(42);
    expect(rig.keyColour).toBe(DEFAULT_LIGHT_RIG.keyColour);
  });

  it('accepts an explicit keyOrigin or the auto sentinel', () => {
    expect(resolveLightRig({ keyOrigin: 'auto' }).keyOrigin).toBe('auto');
    expect(resolveLightRig({ keyOrigin: { x: 0.2, y: 1.4 } }).keyOrigin).toEqual({
      x: 0.2,
      y: 1.4,
    });
    // Junk falls back rather than producing NaN in a gradient centre.
    expect(
      resolveLightRig({ keyOrigin: { x: Number.NaN, y: 0.5 } } as never).keyOrigin,
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it('falls back for an unknown rig id', () => {
    expect(getLightRig('no-such-rig')).toBe(DEFAULT_LIGHT_RIG);
    expect(getLightRig(undefined)).toBe(DEFAULT_LIGHT_RIG);
  });
});

describe('key geometry', () => {
  it('points the key vector back at the source, out of the screen', () => {
    // Screen y is DOWN, so an upper-right source is +x, -y.
    const [x, y, z] = keyVector({ keyAngle: KEY_ANGLE.upperRight, keyElevation: 0.3 });
    expect(x).toBeGreaterThan(0);
    expect(y).toBeLessThan(0);
    expect(z).toBeGreaterThan(0);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
  });

  it('rakes at low elevation and faces on at high', () => {
    const raking = keyVector({ keyAngle: KEY_ANGLE.upperRight, keyElevation: 0.1 });
    const facing = keyVector({ keyAngle: KEY_ANGLE.upperRight, keyElevation: 1.4 });
    expect(raking[2]).toBeLessThan(0.2);
    expect(facing[2]).toBeGreaterThan(0.8);
  });

  it('derives an auto origin outside the frame on the source side', () => {
    const upperRight = autoKeyOrigin(KEY_ANGLE.upperRight);
    expect(upperRight.x).toBeGreaterThan(0.9);
    expect(upperRight.y).toBeLessThan(0.1);

    const left = autoKeyOrigin(0);
    expect(left.x).toBeLessThan(0);
    expect(left.y).toBeCloseTo(0.5, 5);

    const above = autoKeyOrigin(KEY_ANGLE.above);
    expect(above.y).toBeLessThan(0);
    expect(above.x).toBeCloseTo(0.5, 5);
  });

  it('moves the auto origin when the angle moves', () => {
    // This is what makes the bright side of the *picture* follow the key.
    const a = autoKeyOrigin(KEY_ANGLE.upperRight);
    const b = autoKeyOrigin(KEY_ANGLE.upperLeft);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5);
  });
});

/* ========================================================================== *
 *                          height / normal profiles                          *
 * ========================================================================== */

const ALL_SHAPES: HeightShape[] = [
  { kind: 'plane', height: 0.2 },
  { kind: 'roundedBox', radius: 0.25, height: 0.7 },
  { kind: 'roundedBox', axis: 'y', radius: 0.3, height: 0.5 },
  { kind: 'bevel', size: 0.2, height: 0.8 },
  { kind: 'dome', height: 0.6, rib: 0.5 },
  { kind: 'cylinder', height: 0.5 },
  { kind: 'sphere', height: 0.7 },
  { kind: 'wedge', from: 0.1, to: 0.9 },
  { kind: 'groove', depth: 0.25 },
  { kind: 'ribs', count: 5, amplitude: 0.2 },
];

describe('sampleShape', () => {
  it('has a profile for every documented kind', () => {
    const kinds = new Set(ALL_SHAPES.map((s) => s.kind));
    for (const k of HEIGHT_SHAPE_KINDS) expect(kinds.has(k), k).toBe(true);
  });

  it('returns a finite, in-range, near-unit surface everywhere', () => {
    // Collected rather than asserted per sample: this is ~2500 points, and an
    // `expect` per point spends more time in the matcher than in the maths.
    const bad: string[] = [];
    for (const shape of ALL_SHAPES) {
      for (let i = 0; i <= 16; i++) {
        for (let j = 0; j <= 16; j++) {
          const p = sampleShape(shape, i / 16, j / 16);
          const where = `${shape.kind}@${i},${j}`;
          if (!Number.isFinite(p.nx) || !Number.isFinite(p.ny)) bad.push(`${where}: non-finite normal`);
          if (!(p.h >= 0 && p.h <= 1)) bad.push(`${where}: height ${p.h}`);
          if (!(p.a >= 0 && p.a <= 1)) bad.push(`${where}: coverage ${p.a}`);
          // nx² + ny² ≤ 1 so the shader can always reconstruct a real nz.
          if (p.nx * p.nx + p.ny * p.ny > 1.0001) bad.push(`${where}: normal too long`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('is total on garbage', () => {
    const bad = [
      [{ kind: 'nope' } as unknown as HeightShape, 0.5, 0.5],
      [{ kind: 'dome', height: Number.NaN } as HeightShape, 0.5, 0.5],
      [{ kind: 'roundedBox', radius: 0 } as HeightShape, 0.5, 0.5],
      [{ kind: 'plane' } as HeightShape, Number.NaN, Number.POSITIVE_INFINITY],
      [{ kind: 'ribs', count: -3 } as HeightShape, 0.5, 0.5],
    ] as const;
    for (const [shape, u, v] of bad) {
      const p = sampleShape(shape as HeightShape, u as number, v as number);
      expect(Number.isFinite(p.nx + p.ny + p.h + p.a)).toBe(true);
    }
  });

  it('makes a plane flat and a tilted plane tilted', () => {
    const flat = sampleShape({ kind: 'plane', height: 0.3 }, 0.4, 0.6);
    expect(flat.nx).toBeCloseTo(0, 6);
    expect(flat.ny).toBeCloseTo(0, 6);
    expect(flat.h).toBeCloseTo(0.3, 6);

    const tilted = sampleShape({ kind: 'plane', tiltX: 0.5 }, 0.5, 0.5);
    expect(Math.abs(tilted.nx)).toBeGreaterThan(0.2);
  });

  it('rolls a book spine away on both sides and keeps a flat face', () => {
    const spine: HeightShape = { kind: 'roundedBox', radius: 0.25, height: 0.8 };
    const left = sampleShape(spine, 0.02, 0.5);
    const centre = sampleShape(spine, 0.5, 0.5);
    const right = sampleShape(spine, 0.98, 0.5);

    // The flat front face is highest and faces the viewer.
    expect(centre.h).toBeGreaterThan(left.h);
    expect(centre.h).toBeGreaterThan(right.h);
    expect(Math.abs(centre.nx)).toBeLessThan(0.05);

    // The two shoulders turn opposite ways — that is the whole point: under a
    // side key one catches the light and the other falls into shadow.
    expect(left.nx).toBeLessThan(-0.2);
    expect(right.nx).toBeGreaterThan(0.2);
    expect(left.h).toBeCloseTo(right.h, 2);
  });

  it('honours the roundedBox axis', () => {
    const acrossY: HeightShape = { kind: 'roundedBox', axis: 'y', radius: 0.25 };
    const top = sampleShape(acrossY, 0.5, 0.02);
    const bottom = sampleShape(acrossY, 0.5, 0.98);
    expect(top.ny).toBeLessThan(-0.2);
    expect(bottom.ny).toBeGreaterThan(0.2);
  });

  it('gives a plank a plateau with sloped edges', () => {
    const plank: HeightShape = { kind: 'bevel', size: 0.15, height: 0.9, edgeHeight: 0.3 };
    const middle = sampleShape(plank, 0.5, 0.5);
    const topEdge = sampleShape(plank, 0.5, 0.01);
    expect(middle.h).toBeCloseTo(0.9, 2);
    expect(topEdge.h).toBeLessThan(0.5);
    // The top bevel faces up-screen (negative y).
    expect(topEdge.ny).toBeLessThan(-0.1);
  });

  it('respects which bevel edges are cut', () => {
    const shape: HeightShape = {
      kind: 'bevel',
      size: 0.2,
      height: 0.8,
      edgeHeight: 0.2,
      edges: { top: true, bottom: true, left: false, right: false },
    };
    // Left/right uncut: full plateau height right up to the edge.
    expect(sampleShape(shape, 0.01, 0.5).h).toBeCloseTo(0.8, 2);
    expect(sampleShape(shape, 0.5, 0.01).h).toBeLessThan(0.4);
  });

  it('domes a leaf and leaves nothing outside its silhouette', () => {
    const leaf: HeightShape = { kind: 'dome', height: 0.8, edgeHeight: 0.2 };
    const centre = sampleShape(leaf, 0.5, 0.5);
    expect(centre.h).toBeCloseTo(0.8, 2);
    expect(centre.a).toBe(1);
    // Corners of the unit square are outside the inscribed circle.
    expect(sampleShape(leaf, 0.02, 0.02).a).toBe(0);
    expect(sampleShape(leaf, 0.98, 0.98).a).toBe(0);
    // The dome's slope points outward from the centre.
    expect(sampleShape(leaf, 0.25, 0.5).nx).toBeLessThan(0);
    expect(sampleShape(leaf, 0.75, 0.5).nx).toBeGreaterThan(0);
  });

  it('cuts a groove below the surface', () => {
    const groove: HeightShape = { kind: 'groove', height: 0.6, depth: 0.3, width: 0.5 };
    expect(sampleShape(groove, 0.5, 0.5).h).toBeCloseTo(0.3, 2);
    expect(sampleShape(groove, 0.02, 0.5).h).toBeCloseTo(0.6, 2);
  });

  it('ripples ribs around the base height', () => {
    const ribs: HeightShape = { kind: 'ribs', height: 0.5, amplitude: 0.3, count: 4 };
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) samples.push(sampleShape(ribs, i / 39, 0.5).h);
    expect(Math.max(...samples)).toBeGreaterThan(0.58);
    expect(Math.min(...samples)).toBeLessThan(0.42);
  });

  it('makes a wedge monotone', () => {
    const wedge: HeightShape = { kind: 'wedge', from: 0.1, to: 0.9 };
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const h = sampleShape(wedge, i / 20, 0.5).h;
      expect(h).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = h;
    }
  });
});

describe('surface encoding', () => {
  it('round-trips through the buffer', () => {
    for (const p of [
      { nx: 0, ny: 0, h: 0, a: 1 },
      { nx: 1, ny: -1, h: 1, a: 0 },
      { nx: -0.5, ny: 0.25, h: 0.5, a: 0.5 },
    ]) {
      const [r, g, b, a] = encodeSurface(p);
      const back = decodeSurface(r, g, b, a);
      expect(back.nx).toBeCloseTo(p.nx, 2);
      expect(back.ny).toBeCloseTo(p.ny, 2);
      expect(back.h).toBeCloseTo(p.h, 2);
      expect(back.a).toBeCloseTo(p.a, 2);
    }
  });

  it('decodes the empty texel as an uncovered back plane', () => {
    const [r, g, b, a] = EMPTY_SURFACE_BYTES;
    const p = decodeSurface(r, g, b, a);
    expect(p.a).toBe(0);
    expect(p.h).toBe(0);
    expect(p.nx).toBeCloseTo(0, 2);
    expect(p.ny).toBeCloseTo(0, 2);
  });

  it('clamps out-of-range input rather than wrapping', () => {
    const [r, g, b, a] = encodeSurface({ nx: 9, ny: -9, h: 9, a: -9 });
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(255);
    expect(a).toBe(0);
  });
});

describe('rasterizeShape', () => {
  it('caps the raster however big the element is', () => {
    // A 4000px plank and a 40px book share one cached profile — the reason
    // adding books to a shelf costs draw calls and not shading loops.
    const big = rasterizeShape({ kind: 'dome' }, 4000, 4000);
    expect(big.width).toBeLessThanOrEqual(PROFILE_MAX);
    expect(big.height).toBeLessThanOrEqual(PROFILE_MAX);
    expect(big.data.length).toBe(big.width * big.height * 4);
  });

  it('collapses the invariant axis of a directional profile', () => {
    const ramp = rasterizeShape({ kind: 'wedge', axis: 'x' }, 500, 500);
    expect(ramp.height).toBeLessThanOrEqual(2);
    const rampY = rasterizeShape({ kind: 'wedge', axis: 'y' }, 500, 500);
    expect(rampY.width).toBeLessThanOrEqual(2);
  });

  it('never emits a zero-sized raster', () => {
    for (const shape of ALL_SHAPES) {
      const r = rasterizeShape(shape, 0, 0);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });

  it('keys the cache on every parameter that changes the picture', () => {
    const a = shapeKey({ kind: 'roundedBox', radius: 0.2 }, 100, 100);
    const b = shapeKey({ kind: 'roundedBox', radius: 0.3 }, 100, 100);
    const c = shapeKey({ kind: 'roundedBox', radius: 0.2 }, 100, 100);
    expect(a).not.toBe(b);
    expect(a).toBe(c);
    expect(shapeKey({ kind: 'bevel', edges: { left: false } }, 50, 50)).not.toBe(
      shapeKey({ kind: 'bevel', edges: { left: true } }, 50, 50),
    );
  });
});

/* ========================================================================== *
 *                            the shader contract                             *
 * ========================================================================== */

describe('packLightingUniforms', () => {
  const frame = { width: 1200, height: 800 };

  it('packs every rig into finite numbers', () => {
    for (const id of LIGHT_RIG_IDS) {
      const u = packLightingUniforms(LIGHT_RIGS[id] as LightRig, frame);
      for (const [name, value] of Object.entries(u)) {
        for (const v of value as number[]) {
          expect(Number.isFinite(v), `${id}.${name}`).toBe(true);
        }
      }
    }
  });

  it('packs a name for every uniform the shader declares', () => {
    const u = packLightingUniforms(DEFAULT_LIGHT_RIG, frame);
    for (const name of LIGHTING_UNIFORM_NAMES) {
      expect(u, `packed ${name}`).toHaveProperty(name);
      expect(LIGHTING_UNIFORM_TYPES[name], `typed ${name}`).toBeDefined();
    }
    expect(Object.keys(u).sort()).toEqual([...LIGHTING_UNIFORM_NAMES].sort());
  });

  it('declares every packed uniform in the GLSL', () => {
    for (const name of LIGHTING_UNIFORM_NAMES) {
      expect(LIGHTING_UNIFORMS, `declared ${name}`).toContain(name);
    }
  });

  it('always sends four shafts, enabled flag and all', () => {
    const u = packLightingUniforms(resolveLightRig({ shafts: [] }), frame);
    expect(u.uShaftA).toHaveLength(16);
    expect(u.uShaftB).toHaveLength(16);
    expect(u.uShaftC).toHaveLength(16);
    expect(u.uShaftD).toHaveLength(16);
    // Every slot disabled when the rig has no shafts.
    for (let i = 0; i < 4; i++) expect(u.uShaftD[i * 4 + 3]).toBe(0);

    const lit = packLightingUniforms(getLightRig('golden-hour'), frame);
    expect(lit.uShaftD[3]).toBe(1);
  });

  it('normalizes shaft directions', () => {
    const u = packLightingUniforms(getLightRig('golden-hour'), frame);
    const dx = u.uShaftA[2] as number;
    const dy = u.uShaftA[3] as number;
    expect(Math.hypot(dx, dy)).toBeCloseTo(1, 5);
  });

  it('scales pixel-valued knobs with the frame so the pass is resolution-independent', () => {
    const rig = DEFAULT_LIGHT_RIG;
    const small = packLightingUniforms(rig, { width: 600, height: 400 });
    const big = packLightingUniforms(rig, { width: 2400, height: 1600 });
    // Four times the width, four times the AO radius in pixels — so the ring
    // covers the same *fraction* of the picture either way.
    expect(big.uAOParams[1] / (small.uAOParams[1] as number)).toBeCloseTo(4, 1);
    expect(big.uShadowParams[1] / (small.uShadowParams[1] as number)).toBeCloseTo(4, 1);
    expect(big.uShadowParams[3] / (small.uShadowParams[3] as number)).toBeCloseTo(4, 1);
  });

  it('treats the reference width as scale 1', () => {
    const u = packLightingUniforms(DEFAULT_LIGHT_RIG, {
      width: REFERENCE_WIDTH,
      height: 800,
    });
    expect(u.uAOParams[1]).toBeCloseTo(DEFAULT_LIGHT_RIG.aoRadius, 5);
  });

  it('caps the bloom radius at the streak threshold', () => {
    const u = packLightingUniforms(resolveLightRig({ bloomRadius: 200 }), {
      width: 4800,
      height: 3200,
    });
    expect(u.uBloomParams[2]).toBeLessThanOrEqual(18);
  });

  it('resolves an auto key origin and passes an explicit one through', () => {
    const auto = packLightingUniforms(
      resolveLightRig({ keyAngle: KEY_ANGLE.upperLeft, keyOrigin: 'auto' }),
      frame,
    );
    const expected = autoKeyOrigin(KEY_ANGLE.upperLeft);
    expect(auto.uKeyGrad[0]).toBeCloseTo(expected.x, 5);
    expect(auto.uKeyGrad[1]).toBeCloseTo(expected.y, 5);

    const pinned = packLightingUniforms(
      resolveLightRig({ keyOrigin: { x: 0.25, y: 0.75 } }),
      frame,
    );
    expect(pinned.uKeyGrad[0]).toBeCloseTo(0.25, 5);
    expect(pinned.uKeyGrad[1]).toBeCloseTo(0.75, 5);
  });

  it('defaults the normal transform to the frame itself', () => {
    const u = packLightingUniforms(DEFAULT_LIGHT_RIG, frame);
    expect(u.uNormalXform[0]).toBeCloseTo(1 / 1200, 8);
    expect(u.uNormalXform[1]).toBeCloseTo(1 / 800, 8);
    expect(u.uNormalXform[2]).toBe(0);
    expect(u.uNormalXform[3]).toBe(0);
  });

  it('carries the scene aspect separately from the texture size', () => {
    // Under a Pixi filter the sampled texture is a pooled atlas page, so its
    // dimensions are not the scene's; a round vignette depends on this.
    const u = packLightingUniforms(DEFAULT_LIGHT_RIG, {
      width: 2048,
      height: 2048,
      aspect: 16 / 9,
    });
    expect(u.uFrame[0]).toBeCloseTo(1 / 2048, 8);
    expect(u.uFrame[2]).toBeCloseTo(16 / 9, 5);
  });

  it('survives a degenerate frame', () => {
    const u = packLightingUniforms(DEFAULT_LIGHT_RIG, { width: 0, height: 0 });
    for (const value of Object.values(u)) {
      for (const v of value as number[]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('normalUvTransform', () => {
  it('maps screen pixels into buffer UV', () => {
    const [sx, sy, ox, oy] = normalUvTransform(1600, 900);
    expect(1600 * sx).toBeCloseTo(1, 6);
    expect(900 * sy).toBeCloseTo(1, 6);
    expect(ox).toBe(0);
    expect(oy).toBe(0);
  });

  it('carries an offset when the buffer does not start at the origin', () => {
    const [, , ox, oy] = normalUvTransform(1000, 500, 100, 50);
    expect(ox).toBeCloseTo(0.1, 6);
    expect(oy).toBeCloseTo(0.1, 6);
  });

  it('never divides by zero', () => {
    for (const v of normalUvTransform(0, 0)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('shader source', () => {
  it('builds a complete GLSL ES 3.00 fragment shader at every quality', () => {
    for (const q of QUALITIES) {
      const src = buildLightingFragment({ quality: q });
      expect(src.startsWith('#version 300 es')).toBe(true);
      expect(src).toContain('void main(void)');
      expect(src).toContain('out vec4 finalColor;');
      expect(src).toContain('uniform sampler2D uTexture;');
      expect(src).toContain('uniform sampler2D uNormalMap;');
      // Balanced braces is a cheap proxy for "this will actually compile".
      const open = (src.match(/\{/g) ?? []).length;
      const close = (src.match(/\}/g) ?? []).length;
      expect(open, q).toBe(close);
    }
  });

  it('runs every documented pass', () => {
    const src = buildLightingFragment({ quality: 'high' });
    for (const fn of [
      'ambientOcclusion',
      'castShadow',
      'lightShafts',
      'bloomGlow',
      'readSurface',
      'shiftTemp',
      'splitTone',
      'keyReach',
      'sceneUv',
      'tonemapACES',
      'lgg',
    ]) {
      expect(src, fn).toContain(fn);
    }
  });

  it('spends more taps at higher quality', () => {
    for (let i = 1; i < QUALITIES.length; i++) {
      const lo = qualityProfile(QUALITIES[i - 1]);
      const hi = qualityProfile(QUALITIES[i]);
      const cost = (p: typeof lo): number =>
        p.aoDirections * p.aoRings + p.shadowSteps + p.bloomTaps;
      expect(cost(hi), `${QUALITIES[i - 1]} -> ${QUALITIES[i]}`).toBeGreaterThan(cost(lo));
    }
  });

  it('compiles the tap counts in as literals so the loops unroll', () => {
    const low = buildLightingFragment({ quality: 'low' });
    const ultra = buildLightingFragment({ quality: 'ultra' });
    expect(low).toContain(`const int STEPS = ${QUALITY_PROFILES.low.shadowSteps};`);
    expect(ultra).toContain(`const int STEPS = ${QUALITY_PROFILES.ultra.shadowSteps};`);
    expect(low).not.toBe(ultra);
  });

  it('drops the bloom loop entirely when the budget is zero', () => {
    expect(QUALITY_PROFILES.low.bloomTaps).toBe(0);
    const low = buildLightingFragment({ quality: 'low' });
    expect(low).toContain('vec3 bloomGlow');
    expect(low).not.toContain('const int TAPS');
  });

  it('falls back to high for an unknown quality', () => {
    expect(qualityProfile(undefined)).toBe(QUALITY_PROFILES.high);
    expect(qualityProfile('nonsense' as LightingQuality)).toBe(QUALITY_PROFILES.high);
  });

  it('numbers the debug views the way the shader branches on them', () => {
    expect(debugModeId('final')).toBe(0);
    expect(debugModeId(undefined)).toBe(0);
    expect(debugModeId('nonsense' as never)).toBe(0);
    DEBUG_MODES.forEach((mode, i) => {
      expect(debugModeId(mode), mode).toBe(i);
    });
    const src = buildLightingFragment({ quality: 'high' });
    for (let i = 1; i < DEBUG_MODES.length; i++) {
      expect(src, DEBUG_MODES[i]).toContain(`mode == ${i}`);
    }
  });

  it('exposes the buffers the visual QA sheets rely on', () => {
    for (const mode of ['normals', 'height', 'ao', 'shadow', 'albedo'] as const) {
      expect(DEBUG_MODES).toContain(mode);
    }
  });
});
