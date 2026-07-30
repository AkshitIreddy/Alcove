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
  speciesFacing,
  speciesFitsAnchor,
  violatesKeepOut,
  type FloraAnchor,
  type FloraAnchorKind,
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

/* ---------------------------- facing & grounding -------------------------- */

/** Species that hang off what they grip; everything else stands upright. */
const HANGING: FloraSpeciesId[] = ['ivy', 'pothos', 'hearts', 'cobweb', 'herbBundle'];

describe('facing (which way a species grows off an anchor)', () => {
  it('nothing stands upright on an underside or a top corner', () => {
    for (const s of FLORA_SPECIES) {
      for (const kind of ['shelfUnderside', 'caseCorner'] as FloraAnchorKind[]) {
        expect(speciesFacing(s, kind), `${s} on ${kind}`).toBe('down');
      }
    }
  });

  it('on a rail or crown, trailers hang and everything else stands up', () => {
    for (const s of FLORA_SPECIES) {
      const want = HANGING.includes(s) ? 'down' : 'up';
      expect(speciesFacing(s, 'railTop'), `${s} on railTop`).toBe(want);
      expect(speciesFacing(s, 'crownTop'), `${s} on crownTop`).toBe(want);
    }
  });

  it('joint gaps and pot positions always grow upward', () => {
    for (const s of FLORA_SPECIES) {
      expect(speciesFacing(s, 'jointGap')).toBe('up');
      expect(speciesFacing(s, 'potPosition')).toBe('up');
    }
  });

  it('planFlora uses the per-species facing, not a per-anchor default', () => {
    // A rail with no explicit facing: moss must stand on it, ivy must hang.
    const anchors: FloraAnchor[] = Array.from({ length: 40 }, (_, i) => ({
      id: `rail${i}`,
      kind: 'railTop' as const,
      x: i * 50,
      y: 200,
    }));
    for (const [species, want] of [
      ['moss', 'up'],
      ['grassTuft', 'up'],
      ['potted', 'up'],
      ['fern', 'up'],
      ['ivy', 'down'],
      ['pothos', 'down'],
      ['hearts', 'down'],
    ] as const) {
      const plan = planFlora(basePlan({ anchors, spec: { species: [species], density: 'lush' } }));
      expect(plan.length, species).toBeGreaterThan(0);
      for (const p of plan) expect(p.facing, `${species} on a rail`).toBe(want);
    }
  });

  it('an explicit anchor.facing still wins', () => {
    const anchors: FloraAnchor[] = Array.from({ length: 20 }, (_, i) => ({
      id: `j${i}`,
      kind: 'jointGap' as const,
      x: i * 40,
      y: 100,
      facing: 'right' as const,
    }));
    const plan = planFlora(basePlan({ anchors, spec: { species: ['moss'], density: 'lush' } }));
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(p.facing).toBe('right');
  });

  it('upright growth actually goes up (and hanging growth goes down)', () => {
    const reach = (s: FloraSpeciesId, facing: 'up' | 'down') => {
      const g = growFlora(placementOf(s, { facing, seed: 99 }));
      return g.bounds.y + g.bounds.h / 2; // centre of mass, roughly
    };
    for (const s of ['moss', 'fern', 'grassTuft', 'potted'] as FloraSpeciesId[]) {
      expect(reach(s, 'up'), `${s} should grow upward (-y)`).toBeLessThan(0);
    }
    for (const s of ['ivy', 'pothos', 'hearts'] as FloraSpeciesId[]) {
      expect(reach(s, 'down'), `${s} should hang downward (+y)`).toBeGreaterThan(0);
    }
  });
});

describe('contact shadows & bodies', () => {
  it('every species that meets wood lays down a contact shadow', () => {
    // Cobwebs are the one exception: silk casts nothing.
    for (const s of FLORA_SPECIES.filter((x) => x !== 'cobweb')) {
      const g = growFlora(placementOf(s));
      expect(g.shades.length, `${s} has no contact shadow`).toBeGreaterThan(0);
      for (const sh of g.shades) {
        expect(sh.rx).toBeGreaterThan(0);
        expect(sh.ry).toBeGreaterThan(0);
        expect(sh.ry).toBeLessThan(sh.rx); // squashed onto the surface
        expect(sh.alpha).toBeGreaterThan(0);
        expect(sh.alpha).toBeLessThan(1);
      }
    }
    expect(growFlora(placementOf('cobweb')).shades).toHaveLength(0);
  });

  it('contact shadows scale with the specimen', () => {
    const small = growFlora(placementOf('grassTuft', { scale: 0.6 })).shades[0]!;
    const large = growFlora(placementOf('grassTuft', { scale: 1.2 })).shades[0]!;
    expect(large.rx).toBeCloseTo(small.rx * 2, 5);
  });

  it('moss grows a filled cushion body, and only moss does', () => {
    const moss = growFlora(placementOf('moss'));
    expect(moss.mounds.length).toBeGreaterThan(0);
    for (const m of moss.mounds) {
      expect(m.rx).toBeGreaterThan(0);
      expect(m.ry).toBeGreaterThan(0);
      expect(Math.abs(m.up)).toBe(1);
    }
    for (const s of FLORA_SPECIES.filter((x) => x !== 'moss')) {
      expect(growFlora(placementOf(s)).mounds, s).toHaveLength(0);
    }
  });

  it('a moss cushion domes away from the surface it sits on', () => {
    const up = growFlora(placementOf('moss', { facing: 'up' }));
    const down = growFlora(placementOf('moss', { facing: 'down' }));
    expect(up.mounds[0]!.up).toBe(1);
    expect(down.mounds[0]!.up).toBe(-1);
  });

  it('bounds still contain shadows and cushions', () => {
    for (const s of FLORA_SPECIES) {
      const g = growFlora(placementOf(s, { seed: 4242 }));
      const b = g.bounds;
      for (const sh of g.shades) {
        expect(sh.x - sh.rx).toBeGreaterThanOrEqual(b.x - 1e-6);
        expect(sh.x + sh.rx).toBeLessThanOrEqual(b.x + b.w + 1e-6);
      }
      for (const m of g.mounds) {
        expect(m.x - m.rx).toBeGreaterThanOrEqual(b.x - 1e-6);
        expect(m.y - m.up * m.ry).toBeGreaterThanOrEqual(b.y - 1e-6);
      }
    }
  });
});

describe('species character', () => {
  it('pothos is variegated and the other trails are not', () => {
    const pothos = growFlora(placementOf('pothos', { seed: 12 }));
    expect(pothos.leaves.some((l) => l.pale)).toBe(true);
    expect(pothos.leaves.every((l) => l.pale)).toBe(false);
    expect(growFlora(placementOf('ivy')).leaves.some((l) => l.pale)).toBe(false);
    expect(growFlora(placementOf('hearts')).leaves.some((l) => l.pale)).toBe(false);
  });

  it('ivy leaves are lobed and pothos leaves are hearts', () => {
    expect(growFlora(placementOf('ivy')).leaves.every((l) => l.shape === 'lobed')).toBe(true);
    expect(growFlora(placementOf('pothos')).leaves.every((l) => l.shape === 'heart')).toBe(true);
  });

  it('a fern is a clump of fronds whose rachis nods rather than flops over', () => {
    for (const seed of [3, 5, 77, 900]) {
      const g = growFlora(placementOf('fern', { seed, facing: 'up' }));
      expect(g.stems.length, 'a clump, not one sprig').toBeGreaterThanOrEqual(3);
      for (const st of g.stems) {
        const pts = st.pts;
        const a0 = Math.atan2(pts[1]!.y - pts[0]!.y, pts[1]!.x - pts[0]!.x);
        const n = pts.length;
        const a1 = Math.atan2(pts[n - 1]!.y - pts[n - 2]!.y, pts[n - 1]!.x - pts[n - 2]!.x);
        const turn = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
        // Gravity is integrated per step; left unchecked it swung a frond a
        // full 90°+ onto its side and the clump read as a moustache.
        expect(turn, `frond turned ${((turn * 180) / Math.PI).toFixed(0)}°`).toBeLessThan(
          Math.PI / 3,
        );
      }
      // And the whole clump still stands above the surface it grew from.
      expect(g.bounds.y + g.bounds.h).toBeLessThan(-g.bounds.y);
    }
  });

  it('a cobweb is threads only, and every strand carries a halo so it reads on parchment', () => {
    const g = growFlora(placementOf('cobweb'));
    expect(g.threads.length).toBeGreaterThan(8);
    expect(g.stems).toHaveLength(0);
    expect(g.leaves).toHaveLength(0);
    for (const t of g.threads) expect(t.halo).toBeTruthy();
    // Twine, by contrast, needs no halo.
    for (const t of growFlora(placementOf('herbBundle')).threads) expect(t.halo).toBeUndefined();
  });

  it('a herb bundle hangs from twine, is tied, and is sometimes tagged', () => {
    let tagged = 0;
    for (let seed = 0; seed < 24; seed++) {
      const g = growFlora(placementOf('herbBundle', { seed }));
      expect(g.threads.length).toBeGreaterThanOrEqual(6); // 2 hangers + 3 wraps + tail
      expect(g.stems.length).toBeGreaterThanOrEqual(4);
      if (g.tags.length > 0) tagged++;
    }
    expect(tagged).toBeGreaterThan(4);
    expect(tagged).toBeLessThan(24);
  });

  it('a blossom branch no longer dwarfs the rest of the planting', () => {
    const area = (s: FloraSpeciesId) => {
      const b = growFlora(placementOf(s, { seed: 21 })).bounds;
      return b.w * b.h;
    };
    const others = FLORA_SPECIES.filter((s) => s !== 'blossom').map(area);
    const mean = others.reduce((a, b) => a + b, 0) / others.length;
    // It used to be half again as long as anything else on the shelf.
    expect(area('blossom')).toBeLessThan(mean * 1.5);
    expect(area('blossom')).toBeGreaterThan(mean * 0.5); // still a real branch
  });

  it('the potted plant brings its own pot', () => {
    const g = growFlora(placementOf('potted'));
    expect(g.pots).toHaveLength(1);
    expect(g.pots[0]!.w).toBeGreaterThan(0);
    expect(g.leaves.length).toBeGreaterThan(6);
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
