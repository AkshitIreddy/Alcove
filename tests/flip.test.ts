// @vitest-environment node
/**
 * tests/flip.test.ts — pure page-flip math (src/flip/math.ts) plus the curl
 * shader's sampling invariants (src/flip/curl.ts).
 *
 * Everything here runs without DOM or WebGL: fold-line sweep, radius easing,
 * gesture→p clamp mapping (incl. corner tilt), the release velocity-decision
 * matrix, tween-duration/sound-volume scaling, snapshot dpr capping, the
 * raster cache's LRU eviction order, and which page id lands on which face.
 *
 * The shader block cannot run GLSL in node, so it asserts on the shader
 * SOURCE instead. Both rules it locks down were shipped bugs: sampling a
 * premultiplied snapshot's .rgb painted transparent texels black, and
 * sampling a 'prev' leaf without mirroring rendered the spread reversed for
 * the length of the turn.
 */

import { describe, expect, it } from 'vitest';

import {
  CURL_FRAG_SRC,
  CURL_VERT_SRC,
  GROUND_FRAG_SRC,
  PAPER_CREAM_RGB,
} from '../src/flip/curl';
import {
  DPR_CAP_DEFAULT,
  DPR_CAP_LOW_MEMORY,
  HOTSPOT_CORNER_PX,
  HOTSPOT_STRIP_PX,
  LruMap,
  MAX_FOLD_TILT,
  RADIUS_MID_FRAC,
  VELOCITY_COMPLETE_THRESHOLD,
  clamp,
  clamp01,
  decideFlipTarget,
  dragToP,
  flipDuration,
  flipFaceIds,
  foldOffset,
  foldReach,
  foldTilt,
  foldTiltAtP,
  hitTestHotspot,
  mix,
  radiusForP,
  snapshotPixelRatio,
  soundVolumeForVelocity,
} from '../src/flip/math';

const W = 400; // leaf width used throughout
const H = 600;

/* ────────────────────── vertex shader, in TypeScript ───────────────────────
 * A line-for-line transliteration of CURL_VERT_SRC's deformation so the
 * geometry that decides whether the page stays attached to the book can be
 * asserted in node. Keep the two in step: this is the only executable check
 * on shader maths that never runs here.
 * ------------------------------------------------------------------------ */

interface DeformedVertex {
  /** Leaf-local position after the fold (x measured from the spine). */
  x: number;
  y: number;
  /** Lift off the page plane. */
  z: number;
}

function deform(
  x: number,
  y: number,
  p: number,
  w: number,
  h: number,
  baseTilt = 0,
): DeformedVertex {
  const tilt = foldTiltAtP(baseTilt, p);
  const foldD = foldOffset(p, w, h, tilt);
  const r = Math.max(radiusForP(p, w), w * 1e-6); // curl.ts's floor
  const n = { x: Math.cos(tilt), y: Math.sin(tilt) };
  const d = x * n.x + (y - h / 2) * n.y - foldD;
  if (d <= 0) return { x, y, z: 0 };
  const tangential = { x: x - d * n.x, y: y - d * n.y };
  const angle = d / r;
  if (angle < Math.PI) {
    return {
      x: tangential.x + n.x * Math.sin(angle) * r,
      y: tangential.y + n.y * Math.sin(angle) * r,
      z: (1 - Math.cos(angle)) * r,
    };
  }
  return {
    x: tangential.x - n.x * (d - Math.PI * r),
    y: tangential.y - n.y * (d - Math.PI * r),
    z: 2 * r,
  };
}

/** p values across the whole turn, ends included. */
const sweep = (step = 0.02): number[] => {
  const out: number[] = [];
  for (let p = 0; p <= 1.0001; p += step) out.push(Math.min(p, 1));
  return out;
};

/* ────────────────────────────── fold line ─────────────────────────────── */

describe('foldOffset', () => {
  it('parks beyond the whole leaf at rest and on the gutter at the landing', () => {
    expect(foldOffset(0, W, H, 0)).toBeCloseTo(W, 10); // nothing past the fold
    expect(foldOffset(1, W, H, 0)).toBe(0); // fold sits on the spine
  });

  it('never crosses the spine — the regression that detached the page', () => {
    for (const tilt of [0, MAX_FOLD_TILT, -MAX_FOLD_TILT]) {
      for (const p of sweep()) {
        expect(foldOffset(p, W, H, foldTiltAtP(tilt, p))).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('sweeps inward monotonically', () => {
    let previous = foldOffset(0, W, H, 0);
    for (const p of sweep(0.05).slice(1)) {
      const current = foldOffset(p, W, H, 0);
      expect(current).toBeLessThan(previous);
      previous = current;
    }
  });

  it('clears a tilted fold past the leaf corners at rest', () => {
    // With a corner grip the fold is diagonal, so parking it at x=W would
    // leave the near corner already folded before the drag has moved.
    const tilt = MAX_FOLD_TILT;
    const reach = foldReach(W, H, tilt);
    expect(reach).toBeGreaterThan(W);
    for (const y of [0, H / 2, H]) {
      const distance = W * Math.cos(tilt) + (y - H / 2) * Math.sin(tilt);
      expect(distance).toBeLessThanOrEqual(foldOffset(0, W, H, tilt) + 1e-9);
    }
  });

  it('clamps p outside [0,1]', () => {
    expect(foldOffset(-2, W, H, 0)).toBeCloseTo(W, 10);
    expect(foldOffset(3, W, H, 0)).toBe(0);
  });
});

/* ─────────────────────────── radius easing ────────────────────────────── */

describe('radiusForP', () => {
  it('peaks at 0.15W mid-flip and is exactly 0 at both ends', () => {
    expect(radiusForP(0, W)).toBe(0);
    expect(radiusForP(1, W)).toBe(0);
    expect(radiusForP(0.5, W)).toBeCloseTo(RADIUS_MID_FRAC * W, 10);
  });

  it('swells to mid-flip then tightens toward the landing', () => {
    let previous = radiusForP(0, W);
    for (const p of sweep(0.05).filter((p) => p > 0 && p <= 0.5)) {
      const current = radiusForP(p, W);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    for (const p of sweep(0.05).filter((p) => p > 0.5)) {
      const current = radiusForP(p, W);
      expect(current).toBeLessThan(previous);
      previous = current;
    }
  });

  it('never exceeds the mid-flip peak', () => {
    for (const p of sweep(0.01)) {
      expect(radiusForP(p, W)).toBeLessThanOrEqual(RADIUS_MID_FRAC * W + 1e-9);
    }
  });

  it('clamps p outside [0,1]', () => {
    expect(radiusForP(-1, W)).toBe(0);
    expect(radiusForP(2, W)).toBe(0);
  });
});

/* ──────────────────── fold geometry (vertex transform) ─────────────────── */

describe('curl deformation', () => {
  it('PINS the leaf inner edge to the gutter for the whole turn', () => {
    // The defect: at p≈0.85 the old model put leaf-local x=0 a sixth of a
    // page to the left of the spine, so the turning sheet visibly came away
    // from the book. Every y, every tilt, every p: x=0 must not move.
    for (const baseTilt of [0, MAX_FOLD_TILT, -MAX_FOLD_TILT]) {
      for (const p of sweep()) {
        for (const y of [0, H / 3, H / 2, H]) {
          const v = deform(0, y, p, W, H, baseTilt);
          expect(v.x).toBeCloseTo(0, 9);
          expect(v.y).toBeCloseTo(y, 9);
          expect(v.z).toBeCloseTo(0, 9);
        }
      }
    }
  });

  it('leaves the whole leaf untouched at p=0 (raster == resting DOM)', () => {
    for (const baseTilt of [0, MAX_FOLD_TILT, -MAX_FOLD_TILT]) {
      for (const x of [0, W / 4, W / 2, W]) {
        for (const y of [0, H / 2, H]) {
          const v = deform(x, y, 0, W, H, baseTilt);
          expect(v.x).toBeCloseTo(x, 9);
          expect(v.y).toBeCloseTo(y, 9);
          expect(v.z).toBeCloseTo(0, 9);
        }
      }
    }
  });

  it('lands on the exact mirrored page at p=1 (raster == swapped DOM)', () => {
    for (const x of [0, 1, W / 3, W / 2, W]) {
      const v = deform(x, H / 2, 1, W, H, MAX_FOLD_TILT);
      // Off by exactly π·(radius floor) — about a thousandth of a pixel.
      expect(v.x).toBeCloseTo(-x, 2);
      expect(v.z).toBeCloseTo(0, 2);
    }
  });

  it('keeps the grabbed outer edge under the pointer that drove p', () => {
    // dragToP maps pointer → p; the fold offset compensates for the arc the
    // curl eats, so the paper edge tracks the finger instead of lagging.
    for (const p of sweep(0.05).filter((v) => v >= 0.1)) {
      const edge = deform(W, H / 2, p, W, H);
      const pointerX = W * (1 - 2 * p); // inverse of dragToP
      expect(edge.x).toBeCloseTo(pointerX, 2);
    }
  });

  it('never lifts the paper below the page plane', () => {
    for (const p of sweep(0.05)) {
      for (const x of [0, W / 4, W / 2, (3 * W) / 4, W]) {
        expect(deform(x, H / 2, p, W, H).z).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('moves the sheet across the gutter as the turn completes', () => {
    // Sanity that the fix did not simply freeze the page: the free edge has
    // to end up over the facing leaf.
    expect(deform(W, H / 2, 0.25, W, H).x).toBeGreaterThan(0);
    expect(deform(W, H / 2, 0.9, W, H).x).toBeLessThan(0);
  });
});

/* ───────────────────────── gesture → p mapping ────────────────────────── */

describe('dragToP', () => {
  it('maps the outer edge to 0, the spine to 0.5, the far mirrored edge to 1', () => {
    expect(dragToP(W, W)).toBe(0); // pointer at the grabbed outer edge
    expect(dragToP(0, W)).toBe(0.5); // pointer at the spine
    expect(dragToP(-W, W)).toBe(1); // pointer across the whole mirrored arc
  });

  it('clamps beyond both ends', () => {
    expect(dragToP(W + 500, W)).toBe(0);
    expect(dragToP(-W - 500, W)).toBe(1);
  });

  it('is linear in between', () => {
    expect(dragToP(W / 2, W)).toBeCloseTo(0.25, 10);
    expect(dragToP(-W / 2, W)).toBeCloseTo(0.75, 10);
  });

  it('degrades safely for zero-width leaves', () => {
    expect(dragToP(10, 0)).toBe(0);
  });
});

describe('foldTilt (corner fold angle)', () => {
  it('edge grips never tilt', () => {
    for (const cy of [0, 0.3, 0.5, 1]) expect(foldTilt('edge', cy)).toBe(0);
  });

  it('tilts most while the pointer hugs the gripped corner', () => {
    expect(foldTilt('corner-bottom', 1)).toBeCloseTo(MAX_FOLD_TILT, 10);
    expect(foldTilt('corner-top', 0)).toBeCloseTo(-MAX_FOLD_TILT, 10);
  });

  it('straightens to zero by mid-height', () => {
    expect(foldTilt('corner-bottom', 0.5)).toBe(0);
    expect(foldTilt('corner-top', 0.5)).toBe(0);
    expect(foldTilt('corner-bottom', 0.2)).toBe(0); // past mid toward other corner
  });

  it('signs: bottom corner positive, top corner negative, magnitude clamped', () => {
    for (let cy = 0; cy <= 1.0001; cy += 0.1) {
      const bottom = foldTilt('corner-bottom', cy);
      const top = foldTilt('corner-top', cy);
      expect(bottom).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(0);
      expect(Math.abs(bottom)).toBeLessThanOrEqual(MAX_FOLD_TILT + 1e-12);
      expect(Math.abs(top)).toBeLessThanOrEqual(MAX_FOLD_TILT + 1e-12);
    }
  });

  it('clamps out-of-range cy', () => {
    expect(foldTilt('corner-bottom', 5)).toBeCloseTo(MAX_FOLD_TILT, 10);
    expect(foldTilt('corner-top', -5)).toBeCloseTo(-MAX_FOLD_TILT, 10);
  });
});

describe('foldTiltAtP', () => {
  it('keeps the base tilt at p=0 and fades to exactly 0 at p=1 (flat landing)', () => {
    expect(foldTiltAtP(MAX_FOLD_TILT, 0)).toBeCloseTo(MAX_FOLD_TILT, 10);
    expect(foldTiltAtP(MAX_FOLD_TILT, 1)).toBe(0);
    expect(foldTiltAtP(-MAX_FOLD_TILT, 1)).toBe(-0);
  });

  it('fades monotonically', () => {
    let previous = foldTiltAtP(MAX_FOLD_TILT, 0);
    for (let p = 0.1; p <= 1.0001; p += 0.1) {
      const current = foldTiltAtP(MAX_FOLD_TILT, p);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });
});

/* ──────────────────────── velocity decision matrix ────────────────────── */

describe('decideFlipTarget', () => {
  const T = VELOCITY_COMPLETE_THRESHOLD;

  it.each([
    // [p, v, expected] — slow releases: position decides
    [0.2, 0, 0],
    [0.49, 0.2, 0],
    [0.5, 0, 0], // exactly half stays (needs p > 0.5)
    [0.51, 0, 1],
    [0.8, -0.2, 1],
    // fast releases: velocity decides regardless of position
    [0.1, T + 0.1, 1], // early throw forward completes
    [0.9, -(T + 0.1), 0], // late throw backward cancels
    [0.3, T + 2, 1],
    [0.7, -(T + 2), 0],
    // exactly at the threshold: velocity does NOT win (strict >), position rules
    [0.2, T, 0],
    [0.8, -T, 1],
  ] as Array<[number, number, 0 | 1]>)('p=%f v=%f → %i', (p, v, expected) => {
    expect(decideFlipTarget(p, v)).toBe(expected);
  });
});

describe('flipDuration', () => {
  it('is 0.55s for a dead-stop release and shrinks with speed', () => {
    expect(flipDuration(0)).toBeCloseTo(0.55, 10);
    expect(flipDuration(1)).toBeCloseTo(0.45, 10);
    expect(flipDuration(-2)).toBeCloseTo(0.35, 10);
  });

  it('clamps to [0.25, 0.55]', () => {
    expect(flipDuration(100)).toBe(0.25);
    expect(flipDuration(-100)).toBe(0.25);
    for (let v = -6; v <= 6; v += 0.5) {
      const d = flipDuration(v);
      expect(d).toBeGreaterThanOrEqual(0.25);
      expect(d).toBeLessThanOrEqual(0.55);
    }
  });
});

describe('soundVolumeForVelocity', () => {
  it('whispers for gentle releases, snaps for throws, clamps at 1', () => {
    expect(soundVolumeForVelocity(0)).toBeCloseTo(0.55, 10);
    expect(soundVolumeForVelocity(-1)).toBeCloseTo(0.8, 10);
    expect(soundVolumeForVelocity(10)).toBe(1);
  });

  it('is monotone in |v|', () => {
    let previous = soundVolumeForVelocity(0);
    for (let v = 0.25; v <= 4; v += 0.25) {
      const current = soundVolumeForVelocity(v);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

/* ─────────────────────────────── hotspots ─────────────────────────────── */

describe('hitTestHotspot', () => {
  it('hits the outer-edge strip (48px)', () => {
    expect(hitTestHotspot(W - 1, H / 2, W, H)).toBe('edge');
    expect(hitTestHotspot(W - HOTSPOT_STRIP_PX, H / 2, W, H)).toBe('edge');
    expect(hitTestHotspot(W - HOTSPOT_STRIP_PX - 1, H / 2, W, H)).toBeNull();
  });

  it('corners win over the strip', () => {
    expect(hitTestHotspot(W - 1, 1, W, H)).toBe('corner-top');
    expect(hitTestHotspot(W - 1, H - 1, W, H)).toBe('corner-bottom');
    expect(hitTestHotspot(W - HOTSPOT_CORNER_PX, HOTSPOT_CORNER_PX, W, H)).toBe('corner-top');
  });

  it('spine side and out-of-bounds points miss', () => {
    expect(hitTestHotspot(1, H / 2, W, H)).toBeNull();
    expect(hitTestHotspot(W / 2, H / 2, W, H)).toBeNull();
    expect(hitTestHotspot(W + 1, H / 2, W, H)).toBeNull();
    expect(hitTestHotspot(W - 1, -1, W, H)).toBeNull();
    expect(hitTestHotspot(W - 1, H + 1, W, H)).toBeNull();
  });
});

/* ──────────────────────── face selection (which page) ─────────────────── */

describe('flipFaceIds', () => {
  const ids = {
    left: 'L',
    right: 'R',
    nextLeft: 'N1',
    nextRight: 'N2',
    prevLeft: 'P1',
    prevRight: 'P2',
  };

  it('turns the right leaf forward: face = current right, back = next left', () => {
    expect(flipFaceIds('next', ids)).toEqual({
      front: 'R',
      back: 'N1',
      revealed: 'N2',
    });
  });

  it('mirrors exactly for a backward turn (left leaf, prev RIGHT on its back)', () => {
    expect(flipFaceIds('prev', ids)).toEqual({
      front: 'L',
      back: 'P2',
      revealed: 'P1',
    });
  });

  it('never confuses the two spreads either side', () => {
    const next = flipFaceIds('next', ids);
    const prev = flipFaceIds('prev', ids);
    // A 'prev' flip must not touch a single next-spread id and vice versa.
    expect(Object.values(next)).not.toContain('P1');
    expect(Object.values(next)).not.toContain('P2');
    expect(Object.values(prev)).not.toContain('N1');
    expect(Object.values(prev)).not.toContain('N2');
  });

  it('reports missing neighbours as null (cream paper), never undefined', () => {
    const bare = { left: null, right: 'R' };
    expect(flipFaceIds('next', bare)).toEqual({
      front: 'R',
      back: null,
      revealed: null,
    });
    expect(flipFaceIds('prev', bare)).toEqual({
      front: null,
      back: null,
      revealed: null,
    });
  });
});

/* ─────────────────────── curl shader sampling rules ───────────────────── */

describe('curl shader sources', () => {
  /** Call sites where a page sampler is read (skips samplePage's own body). */
  const pageSamples = (src: string): string[] =>
    [...src.matchAll(/samplePage\(uTex\w+/g)].map((m) => m[0]);

  it('routes every page texture through samplePage (never bare .rgb)', () => {
    for (const src of [CURL_FRAG_SRC, GROUND_FRAG_SRC]) {
      // A bare texture() read of a page sampler is the black-page bug.
      expect(src).not.toMatch(/texture\(uTex(Front|Back|Revealed)/);
      expect(src).toMatch(/samplePage\(uTex/);
    }
    expect(pageSamples(CURL_FRAG_SRC)).toHaveLength(2); // front + back
    expect(pageSamples(GROUND_FRAG_SRC)).toHaveLength(1); // revealed
  });

  it('composites samples over paper cream, matching PAPER_CREAM_RGB', () => {
    const cream = PAPER_CREAM_RGB.map((c) => (c / 255).toFixed(6)).join(', ');
    expect(CURL_FRAG_SRC).toContain(`const vec3 PAPER_CREAM = vec3(${cream});`);
    // Premultiplied composite: rgb already carries alpha, cream fills the rest.
    expect(CURL_FRAG_SRC).toContain('texel.rgb + PAPER_CREAM * (1.0 - texel.a)');
  });

  it('mirrors faces per direction: front/revealed straight, back flipped', () => {
    // faceUv's rule — mirrored ⇔ exactly one of (prev leaf, backside).
    expect(CURL_FRAG_SRC).toContain('bool mirrored = (uDir < 0.0) != backside;');
    expect(CURL_FRAG_SRC).toContain('samplePage(uTexFront, faceUv(vUv, false))');
    expect(CURL_FRAG_SRC).toContain('samplePage(uTexBack, faceUv(vUv, true))');
    expect(GROUND_FRAG_SRC).toContain('samplePage(uTexRevealed, faceUv(vUv, false))');
  });

  it('agrees with the truth table the fix was derived from', () => {
    // Transliteration of faceUv's one expression; leaf-local x runs from the
    // spine, so a 'prev' leaf (spine on the right) reads every front/revealed
    // face backwards, while its BACKSIDE happens to line up straight.
    const mirrored = (dir: 'next' | 'prev', backside: boolean): boolean =>
      (dir === 'prev') !== backside;
    expect(mirrored('next', false)).toBe(false); // right leaf, its own face
    expect(mirrored('next', true)).toBe(true); // …its backside
    expect(mirrored('prev', false)).toBe(true); // left leaf, its own face
    expect(mirrored('prev', true)).toBe(false); // …its backside
  });

  it('keeps the ground pass shadow in unmirrored leaf-local space', () => {
    // The fold-line distance must use the same coords the vertex shader
    // deformed, or the cast shadow flips to the wrong side of the curl.
    expect(GROUND_FRAG_SRC).toContain('vec2 local = vUv * uLeafSize;');
  });

  it('treats an uncovered paper-fibre texel as neutral, not black', () => {
    expect(CURL_FRAG_SRC).toContain('vec3 fibre = (tile.rgb + (1.0 - tile.a))');
  });

  it('declares uDir in both fragment passes (faceUv needs it)', () => {
    for (const src of [CURL_FRAG_SRC, GROUND_FRAG_SRC]) {
      expect([...src.matchAll(/uniform float uDir;/g)]).toHaveLength(1);
    }
  });

  it('measures the fold from the SPINE, in both passes', () => {
    // The fold offset is a distance from leaf-local x=0. Anchoring on the
    // fold's own x (the old uFoldX) let it sweep past the spine, which is
    // what pulled the leaf's inner edge off the gutter.
    const spineAnchored = 'dot(local - vec2(0.0, uLeafSize.y * 0.5), n) - uFoldD';
    expect(CURL_VERT_SRC).toContain(spineAnchored);
    expect(GROUND_FRAG_SRC).toContain(spineAnchored);
    for (const src of [CURL_VERT_SRC, GROUND_FRAG_SRC]) {
      expect(src).not.toContain('uFoldX');
    }
  });

  it('has no rigid-rotation blend fighting the cylinder near the landing', () => {
    // radiusForP → 0 lands the wrap exactly on the mirrored page; the old
    // mix() toward a spine rotation is what made the last third of the turn
    // drift away from the gutter.
    expect(CURL_VERT_SRC).not.toContain('rigid');
    expect(CURL_VERT_SRC).not.toContain('flatten');
    expect(CURL_VERT_SRC).not.toMatch(/uniform float uP;/); // progress unused
  });
});

/* ─────────────────────────── dpr cap (snapshots) ──────────────────────── */

describe('snapshotPixelRatio', () => {
  it('caps at 2 on healthy machines', () => {
    expect(snapshotPixelRatio(3, 16)).toBe(DPR_CAP_DEFAULT);
    expect(snapshotPixelRatio(2.5, 8)).toBe(DPR_CAP_DEFAULT);
  });

  it('caps at 1.5 when deviceMemory < 8', () => {
    expect(snapshotPixelRatio(3, 4)).toBe(DPR_CAP_LOW_MEMORY);
    expect(snapshotPixelRatio(2, 7.9)).toBe(DPR_CAP_LOW_MEMORY);
  });

  it('assumes healthy when deviceMemory is unavailable', () => {
    expect(snapshotPixelRatio(3, undefined)).toBe(DPR_CAP_DEFAULT);
  });

  it('never raises a low device ratio (150% Windows scaling stays 1.5)', () => {
    expect(snapshotPixelRatio(1.5, 16)).toBe(1.5);
    expect(snapshotPixelRatio(1, 4)).toBe(1);
    expect(snapshotPixelRatio(1.25, undefined)).toBe(1.25);
  });

  it('floors degenerate ratios at 0.5', () => {
    expect(snapshotPixelRatio(0, 16)).toBe(0.5);
  });
});

/* ─────────────────────────────── LRU cache ────────────────────────────── */

describe('LruMap', () => {
  it('evicts the least-recently-used entry beyond capacity, in order', () => {
    const evicted: string[] = [];
    const lru = new LruMap<string, number>(3, (key) => evicted.push(key));
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    lru.set('d', 4); // evicts a
    lru.set('e', 5); // evicts b
    expect(evicted).toEqual(['a', 'b']);
    expect(lru.keys()).toEqual(['c', 'd', 'e']);
  });

  it('get() refreshes recency', () => {
    const evicted: string[] = [];
    const lru = new LruMap<string, number>(3, (key) => evicted.push(key));
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    expect(lru.get('a')).toBe(1); // a becomes most-recent
    lru.set('d', 4); // evicts b, not a
    expect(evicted).toEqual(['b']);
    expect(lru.keys()).toEqual(['c', 'a', 'd']);
  });

  it('peek() does not refresh recency', () => {
    const lru = new LruMap<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.peek('a')).toBe(1);
    lru.set('c', 3); // still evicts a
    expect(lru.has('a')).toBe(false);
    expect(lru.keys()).toEqual(['b', 'c']);
  });

  it('overwriting a key updates value and recency without eviction', () => {
    const evicted: string[] = [];
    const lru = new LruMap<string, number>(2, (key) => evicted.push(key));
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('a', 10);
    expect(evicted).toEqual([]);
    expect(lru.keys()).toEqual(['b', 'a']);
    expect(lru.get('a')).toBe(10);
  });

  it('delete() and clear() report through onEvict (bitmaps get closed)', () => {
    const evicted: string[] = [];
    const lru = new LruMap<string, number>(4, (key) => evicted.push(key));
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.delete('a')).toBe(true);
    expect(lru.delete('missing')).toBe(false);
    lru.clear();
    expect(evicted).toEqual(['a', 'b']);
    expect(lru.size).toBe(0);
  });

  it('rejects nonsense capacities', () => {
    expect(() => new LruMap(0)).toThrow();
    expect(() => new LruMap(1.5)).toThrow();
  });
});

/* ─────────────────────────────── utilities ────────────────────────────── */

describe('clamp helpers', () => {
  it('clamp and clamp01 behave at and beyond bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
  });

  it('mix interpolates linearly', () => {
    expect(mix(0, 10, 0.5)).toBe(5);
    expect(mix(2, 4, 0)).toBe(2);
    expect(mix(2, 4, 1)).toBe(4);
  });
});

/* ==========================================================================
 * The shader carries no light model
 * ========================================================================== */

/**
 * The reader reported *"when i turn pages sometimes, mid way, the bottom half
 * of page with lines has some weird shadowey effect"*, and the cause was the
 * curl shader's shading terms landing on ruled paper: a crest highlight, a
 * pre-fold darkening band and a self-shadow, each a light model on a drawing
 * that has none. They are gone.
 *
 * This is a TEXT test over the shader source rather than a rendering one on
 * purpose. There is no GL context in node, the artefact only appeared part-way
 * through a real turn, and the thing worth defending is not a pixel value — it
 * is the house rule from CLAUDE.md: no lighting, no glow, no blurred shadow.
 * A term that reintroduces one is visible in the source, so the source is where
 * to catch it.
 *
 * The agent that removed them asked for this gate and could not add it — tests/
 * was outside its file set.
 */
describe('the curl shader has no light model', () => {
  /**
   * Comments stripped first. The shader's own header says "no crest highlight,
   * no curvature band, no self-shadow" — which is exactly the right thing for
   * it to say and exactly what a naive text search trips over. Checking the
   * prose instead of the code would fail on a file that documents itself well.
   */
  const code = CURL_FRAG_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('carries no shading terms', () => {
    // `pow()` was how every one of them was shaped — a crest raised to a power,
    // a band falling off to one. Nothing else in this shader needs it.
    expect(code).not.toMatch(/\bpow\s*\(/);
  });

  it('names no highlight, shadow or shading uniform', () => {
    for (const banned of ['uShade', 'uHighlight', 'uShadow', 'crest', 'specular']) {
      expect(
        code.toLowerCase(),
        `${banned} is a light model — see CLAUDE.md`,
      ).not.toContain(banned.toLowerCase());
    }
  });

  it('still samples the page it is bending', () => {
    // The cheapest way to pass the two checks above would be to delete the
    // shader. It has to still do its job.
    expect(code).toMatch(/texture\s*\(/);
  });
});
