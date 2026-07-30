// @vitest-environment node
/**
 * tests/art-flora.test.ts — the flora & growth system (src/art/flora.ts +
 * src/art/leaves.ts).
 *
 * Everything asserted here is pure geometry/planning maths, so it runs in
 * plain Node with no canvas: leaf outlines, growth determinism, honest
 * bounds, density behaviour, and — the binding rule from
 * docs/design/library-themes.md §3 — the title keep-out logic.
 */

import { describe, expect, it } from 'vitest';

import {
  LEAF_SHAPES,
  leafAxis,
  leafBoundRadius,
  leafOutline,
  leafProfile,
  leafVeins,
  type LeafShape,
} from '../src/art/leaves';
import {
  DENSITY_COVERAGE,
  FLORA_ANCHOR_KINDS,
  FLORA_LABELS,
  FLORA_SPECIES,
  clearFloraMemo,
  enforceKeepOut,
  floraLayerBounds,
  floraLayerCacheKey,
  floraSeed,
  growFlora,
  inflateRect,
  placementBounds,
  planFlora,
  rectsOverlap,
  spineKeepOuts,
  spineTitleKeepOut,
  speciesAnchors,
  speciesFitsAnchor,
  violatesKeepOut,
  type FloraAnchor,
  type FloraPlacement,
  type FloraPlanOptions,
  type FloraSpeciesId,
  type Rect,
} from '../src/art/flora';

/* ------------------------------- fixtures -------------------------------- */

/** A believable case: rail tops, undersides, corners, crown, joints, pots. */
function makeAnchors(count = 24): FloraAnchor[] {
  const kinds = FLORA_ANCHOR_KINDS;
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    kind: kinds[i % kinds.length] as (typeof kinds)[number],
    x: 40 + i * 34,
    y: i % 2 === 0 ? 120 : 260,
    run: 60,
  }));
}

function basePlan(over: Partial<FloraPlanOptions> = {}): FloraPlanOptions {
  return {
    floorIndex: 2,
    themeSeed: 0xc0ffee,
    spec: { species: FLORA_SPECIES, density: 'lush' },
    anchors: makeAnchors(),
    ...over,
  };
}

function placementOf(species: FloraSpeciesId, over: Partial<FloraPlacement> = {}): FloraPlacement {
  const anchor: FloraAnchor = { id: 'x', kind: speciesAnchors(species)[0] as never, x: 100, y: 100 };
  const p: FloraPlacement = {
    id: `0:x`,
    anchor,
    species,
    seed: floraSeed(0, 'x', 7),
    scale: 1,
    flip: false,
    facing: 'down',
    palette: {},
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    ...over,
  };
  p.bounds = placementBounds(p);
  return p;
}

/* ================================ leaves ================================== */

describe('leaf shape vocabulary', () => {
  it('profiles stay inside the unit half-width and vanish at the tip', () => {
    for (const shape of LEAF_SHAPES) {
      for (let i = 0; i <= 20; i++) {
        const v = leafProfile(shape, i / 20);
        expect(v).toBeGreaterThanOrEqual(-0.0001);
        expect(v).toBeLessThanOrEqual(1.0001);
      }
      expect(leafProfile(shape, 0)).toBeLessThan(0.2);
      expect(leafProfile(shape, 1)).toBeLessThan(0.2);
    }
  });

  it('each shape has a distinct profile', () => {
    const sig = (s: LeafShape) =>
      Array.from({ length: 9 }, (_, i) => leafProfile(s, (i + 1) / 10).toFixed(3)).join(',');
    const sigs = LEAF_SHAPES.map(sig);
    expect(new Set(sigs).size).toBe(LEAF_SHAPES.length);
  });

  it('outlines are closed loops, deterministic per seed, and jitter-varied', () => {
    const o = { shape: 'heart' as const, len: 20, width: 18, seed: 42 };
    const a = leafOutline(o);
    const b = leafOutline(o);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    const c = leafOutline({ ...o, seed: 43 });
    expect(c).not.toEqual(a);
    // Same seed + zero jitter ⇒ exact mathematical outline.
    expect(leafOutline({ ...o, jitter: 0 })).toEqual(leafOutline({ ...o, jitter: 0, seed: 999 }));
  });

  it('leafBoundRadius conservatively contains the whole blade', () => {
    for (const shape of LEAF_SHAPES) {
      for (const [len, width] of [
        [8, 7],
        [20, 18],
        [40, 6],
      ] as const) {
        const r = leafBoundRadius(len, width);
        for (const p of leafOutline({ shape, len, width, seed: 5, bend: width * 0.2 })) {
          expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(r);
        }
      }
    }
  });

  it('curl narrows the near side without moving the tip', () => {
    const flat = leafOutline({ shape: 'oval', len: 20, width: 16, jitter: 0, curl: 0 });
    const curled = leafOutline({ shape: 'oval', len: 20, width: 16, jitter: 0, curl: 0.6 });
    const spread = (pts: { y: number }[]) => Math.max(...pts.map((p) => p.y));
    expect(spread(curled)).toBeLessThan(spread(flat));
    expect(curled[Math.floor(curled.length / 2) - 1]?.x).toBeCloseTo(
      flat[Math.floor(flat.length / 2) - 1]?.x ?? 0,
      5,
    );
  });

  it('axis and veins are well-formed', () => {
    const o = { shape: 'lobed' as const, len: 24, width: 22 };
    const axis = leafAxis(o);
    expect(axis[0]).toEqual({ x: -24 * 0.08, y: 0 });
    expect(axis[axis.length - 1]?.x).toBeCloseTo(24, 5);
    expect(leafVeins(o, 3)).toHaveLength(6);
  });
});

/* ================================ species ================================= */

describe('species table', () => {
  it('covers exactly the ten documented species', () => {
    expect(FLORA_SPECIES).toHaveLength(10);
    expect(new Set(FLORA_SPECIES).size).toBe(10);
    for (const s of FLORA_SPECIES) expect(FLORA_LABELS[s]).toBeTruthy();
  });

  it('every species declares at least one valid anchor kind', () => {
    for (const s of FLORA_SPECIES) {
      const anchors = speciesAnchors(s);
      expect(anchors.length).toBeGreaterThan(0);
      for (const a of anchors) expect(FLORA_ANCHOR_KINDS).toContain(a);
      expect(speciesFitsAnchor(s, anchors[0] as never)).toBe(true);
    }
  });

  it('every anchor kind can host something', () => {
    for (const kind of FLORA_ANCHOR_KINDS) {
      expect(FLORA_SPECIES.some((s) => speciesFitsAnchor(s, kind))).toBe(true);
    }
  });

  it('herb bundles only hang from shelf undersides', () => {
    expect(speciesAnchors('herbBundle')).toEqual(['shelfUnderside']);
    expect(speciesFitsAnchor('herbBundle', 'jointGap')).toBe(false);
  });
});

/* ================================ growth ================================== */

describe('growth model', () => {
  it('is deterministic per (floorIndex, anchorId, themeSeed)', () => {
    expect(floraSeed(1, 'rail-3', 99)).toBe(floraSeed(1, 'rail-3', 99));
    expect(floraSeed(1, 'rail-3', 99)).not.toBe(floraSeed(2, 'rail-3', 99));
    expect(floraSeed(1, 'rail-3', 99)).not.toBe(floraSeed(1, 'rail-4', 99));
    expect(floraSeed(1, 'rail-3', 99)).not.toBe(floraSeed(1, 'rail-3', 100));
  });

  it('regrows byte-identical geometry after the memo is cleared', () => {
    for (const s of FLORA_SPECIES) {
      const p = placementOf(s);
      const a = growFlora(p);
      clearFloraMemo();
      const b = growFlora(p);
      expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
    }
  });

  it('produces real structure for every species', () => {
    for (const s of FLORA_SPECIES) {
      const g = growFlora(placementOf(s));
      const parts = g.stems.length + g.leaves.length + g.blooms.length + g.threads.length;
      expect(parts, `${s} grew nothing`).toBeGreaterThan(3);
      expect(g.bounds.w).toBeGreaterThan(4);
      expect(g.bounds.h).toBeGreaterThan(4);
    }
  });

  it('trails taper, alternate and branch', () => {
    const g = growFlora(placementOf('ivy'));
    expect(g.stems.length).toBeGreaterThanOrEqual(2); // main + side branch(es)
    expect(g.leaves.length).toBeGreaterThan(5);
    const main = g.stems[0]!;
    expect(main.widths[main.widths.length - 1]).toBeLessThan(main.widths[0]!);
    // Leaves fall on both sides of the stem (alternating).
    const sides = new Set(g.leaves.map((l) => Math.sign(Math.sin(l.angle - Math.PI / 2))));
    expect(sides.size).toBeGreaterThan(1);
    // Older/curled leaves exist but stay a minority.
    const curled = g.leaves.filter((l) => l.curl > 0).length;
    expect(curled).toBeGreaterThan(0);
    expect(curled).toBeLessThan(g.leaves.length * 0.5);
  });

  it('different seeds give visibly different specimens', () => {
    const a = growFlora(placementOf('ivy', { seed: 1 }));
    const b = growFlora(placementOf('ivy', { seed: 2 }));
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it('bounds contain every piece of geometry they claim to', () => {
    for (const s of FLORA_SPECIES) {
      for (const seed of [1, 7, 1337]) {
        const g = growFlora(placementOf(s, { seed }));
        const b = g.bounds;
        const inside = (x: number, y: number) =>
          x >= b.x - 1e-6 && x <= b.x + b.w + 1e-6 && y >= b.y - 1e-6 && y <= b.y + b.h + 1e-6;
        for (const st of g.stems) for (const p of st.pts) expect(inside(p.x, p.y)).toBe(true);
        for (const th of g.threads) for (const p of th.pts) expect(inside(p.x, p.y)).toBe(true);
        for (const l of g.leaves) {
          // Full blade extent, using the same conservative radius keep-out uses.
          const r = leafBoundRadius(l.len, l.width);
          expect(inside(l.x + Math.cos(l.angle) * r, l.y + Math.sin(l.angle) * r)).toBe(true);
        }
        for (const bl of g.blooms) expect(inside(bl.x + bl.r, bl.y + bl.r)).toBe(true);
      }
    }
  });

  it('scale scales the footprint', () => {
    const small = growFlora(placementOf('fern', { scale: 0.6 }));
    const large = growFlora(placementOf('fern', { scale: 1.2 }));
    expect(large.bounds.w).toBeGreaterThan(small.bounds.w * 1.4);
  });

  it('palette shifts propagate into the geometry tones', () => {
    const plain = growFlora(placementOf('ivy'));
    const shifted = growFlora(placementOf('ivy', { palette: { hueShift: 40, lightShift: 12 } }));
    expect(shifted.leaves[0]!.tone.h).toBeCloseTo(plain.leaves[0]!.tone.h + 40, 6);
    expect(shifted.leaves[0]!.tone.l).toBeCloseTo(plain.leaves[0]!.tone.l + 12, 6);
  });
});

/* =============================== planning ================================= */

describe('planning & density', () => {
  it('density none, or a zero multiplier, grows absolutely nothing', () => {
    expect(planFlora(basePlan({ spec: { species: FLORA_SPECIES, density: 'none' } }))).toEqual([]);
    expect(planFlora(basePlan({ densityMultiplier: 0 }))).toEqual([]);
    expect(DENSITY_COVERAGE.none).toBe(0);
  });

  it('sparse is a strict subset of lush (the slider only adds)', () => {
    const anchors = makeAnchors(60);
    const sparse = planFlora(
      basePlan({ anchors, spec: { species: FLORA_SPECIES, density: 'sparse' } }),
    );
    const lush = planFlora(basePlan({ anchors, spec: { species: FLORA_SPECIES, density: 'lush' } }));
    expect(sparse.length).toBeGreaterThan(0);
    expect(lush.length).toBeGreaterThan(sparse.length);
    const lushIds = new Set(lush.map((p) => p.id));
    for (const p of sparse) expect(lushIds.has(p.id)).toBe(true);
  });

  it('the density multiplier is monotone', () => {
    const anchors = makeAnchors(60);
    const counts = [0.25, 0.5, 1, 2].map(
      (m) =>
        planFlora(
          basePlan({
            anchors,
            spec: { species: FLORA_SPECIES, density: 'sparse' },
            densityMultiplier: m,
          }),
        ).length,
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
    expect(counts[counts.length - 1]!).toBeGreaterThan(counts[0]!);
  });

  it('is deterministic and floor/theme sensitive', () => {
    const a = planFlora(basePlan());
    const b = planFlora(basePlan());
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const otherFloor = planFlora(basePlan({ floorIndex: 3 }));
    const otherTheme = planFlora(basePlan({ themeSeed: 0xbeef }));
    expect(JSON.stringify(otherFloor)).not.toEqual(JSON.stringify(a));
    expect(JSON.stringify(otherTheme)).not.toEqual(JSON.stringify(a));
  });

  it('honours eligibleAnchors', () => {
    const plan = planFlora(
      basePlan({
        anchors: makeAnchors(60),
        spec: {
          species: FLORA_SPECIES,
          density: 'lush',
          eligibleAnchors: ['jointGap', 'crownTop'],
        },
      }),
    );
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(['jointGap', 'crownTop']).toContain(p.anchor.kind);
  });

  it('only plants species that fit the anchor they landed on', () => {
    for (const p of planFlora(basePlan({ anchors: makeAnchors(80) }))) {
      expect(speciesFitsAnchor(p.species, p.anchor.kind)).toBe(true);
    }
  });

  it('restricting the species list restricts what grows', () => {
    const plan = planFlora(
      basePlan({ anchors: makeAnchors(60), spec: { species: ['moss'], density: 'lush' } }),
    );
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(p.species).toBe('moss');
  });

  it('layer bounds cover every placement', () => {
    const plan = planFlora(basePlan());
    const layer = floraLayerBounds(plan)!;
    for (const p of plan) {
      expect(p.bounds.x).toBeGreaterThanOrEqual(layer.x);
      expect(p.bounds.y).toBeGreaterThanOrEqual(layer.y);
      expect(p.bounds.x + p.bounds.w).toBeLessThanOrEqual(layer.x + layer.w);
      expect(p.bounds.y + p.bounds.h).toBeLessThanOrEqual(layer.y + layer.h);
    }
    expect(floraLayerBounds([])).toBeNull();
    expect(floraLayerCacheKey(plan)).toContain('flora|v');
    expect(floraLayerCacheKey(plan)).not.toEqual(floraLayerCacheKey(plan.slice(1)));
  });
});

/* =============================== keep-out ================================= */

describe('title keep-out (the occlusion rule)', () => {
  it('rectsOverlap: touching edges do not count as overlap', () => {
    const a: Rect = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectsOverlap(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(rectsOverlap(a, { x: 9.9, y: 0, w: 5, h: 5 })).toBe(true);
    expect(rectsOverlap(a, { x: -5, y: -5, w: 20, h: 20 })).toBe(true);
    expect(rectsOverlap(a, { x: 0, y: 20, w: 10, h: 10 })).toBe(false);
  });

  it('inflateRect grows on every side', () => {
    expect(inflateRect({ x: 10, y: 10, w: 4, h: 4 }, 2)).toEqual({ x: 8, y: 8, w: 8, h: 8 });
  });

  it('spineTitleKeepOut protects the middle band of the spine, plus padding', () => {
    const spine: Rect = { x: 100, y: 50, w: 36, h: 200 };
    const k = spineTitleKeepOut(spine, 3);
    // Middle 70% of the spine height, full width, +3px pad.
    expect(k.x).toBe(97);
    expect(k.w).toBe(42);
    expect(k.y).toBeCloseTo(50 + 200 * 0.15 - 3, 6);
    expect(k.h).toBeCloseTo(200 * 0.7 + 6, 6);
    // Head and tail of the spine are NOT protected — flora may creep there.
    expect(k.y).toBeGreaterThan(spine.y);
    expect(k.y + k.h).toBeLessThan(spine.y + spine.h);
    expect(spineKeepOuts([spine, spine])).toHaveLength(2);
  });

  it('a specimen reaching into a title is pulled back off it', () => {
    const anchor: FloraAnchor = { id: 'r1', kind: 'railTop', x: 200, y: 200 };
    let shrunk = 0;
    for (let seed = 0; seed < 30; seed++) {
      const p = placementOf('ivy', { anchor, seed, facing: 'down' });
      // A title sitting exactly at the far corner of this specimen's reach.
      const keepOut: Rect[] = [
        { x: p.bounds.x + p.bounds.w - 4, y: p.bounds.y + p.bounds.h - 4, w: 6, h: 6 },
      ];
      expect(violatesKeepOut(p, keepOut)).toBe(true); // it really is in the way
      const [kept] = enforceKeepOut([p], keepOut);
      if (!kept) continue;
      shrunk++;
      expect(kept.scale).toBeLessThan(p.scale);
      expect(violatesKeepOut(kept, keepOut)).toBe(false);
    }
    expect(shrunk).toBeGreaterThan(20); // shrinking is the usual resolution
  });

  it('a specimen whose anchor sits inside a title is always dropped', () => {
    const anchor: FloraAnchor = { id: 'r2', kind: 'railTop', x: 200, y: 200 };
    const spine: Rect = { x: 130, y: 120, w: 150, h: 260 };
    const keepOut = [spineTitleKeepOut(spine)];
    for (let seed = 0; seed < 20; seed++) {
      const p = placementOf('ivy', { anchor, seed, facing: 'down' });
      expect(violatesKeepOut(p, keepOut)).toBe(true);
      expect(enforceKeepOut([p], keepOut)).toHaveLength(0);
    }
  });

  it('never returns a placement overlapping any keep-out rect', () => {
    const anchors = makeAnchors(60);
    // A dense wall of books across the whole floor.
    const spines: Rect[] = Array.from({ length: 24 }, (_, i) => ({
      x: 30 + i * 34,
      y: 90,
      w: 30,
      h: 190,
    }));
    const keepOut = spineKeepOuts(spines);
    const plan = planFlora(basePlan({ anchors, keepOut }));
    for (const p of plan) {
      for (const k of keepOut) {
        expect(rectsOverlap(p.bounds, k), `${p.id} (${p.species}) covers a title`).toBe(false);
      }
    }
    // And the unconstrained plan really did have violations to fix.
    const unconstrained = planFlora(basePlan({ anchors }));
    expect(unconstrained.some((p) => violatesKeepOut(p, keepOut))).toBe(true);
    expect(plan.length).toBeLessThan(unconstrained.length);
  });

  it('leaves non-colliding specimens completely untouched', () => {
    const anchors = makeAnchors(24);
    const far: Rect[] = [{ x: -5000, y: -5000, w: 10, h: 10 }];
    const plain = planFlora(basePlan({ anchors }));
    const withKeepOut = planFlora(basePlan({ anchors, keepOut: far }));
    expect(JSON.stringify(withKeepOut)).toEqual(JSON.stringify(plain));
  });

  it('an empty keep-out list is a no-op', () => {
    const plan = planFlora(basePlan());
    expect(enforceKeepOut(plan, [])).toEqual(plan);
  });

  it('minScale governs how hard it tries before dropping', () => {
    const anchor: FloraAnchor = { id: 'r9', kind: 'railTop', x: 200, y: 200 };
    const keepOut = [{ x: 120, y: 150, w: 160, h: 120 }];
    const p = placementOf('pothos', { anchor, seed: 3, facing: 'down' });
    const generous = enforceKeepOut([p], keepOut, { minScale: 0.05, attempts: 12 });
    const strict = enforceKeepOut([p], keepOut, { minScale: 0.99, attempts: 12 });
    expect(strict).toHaveLength(0);
    for (const k of generous) expect(violatesKeepOut(k, keepOut)).toBe(false);
  });
});
