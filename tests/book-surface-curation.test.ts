import { describe, expect, it } from 'vitest';

import {
  ACTIVE_CHARMS,
  normalizeCharmKind,
} from '../src/art/charms';
import {
  ACTIVE_COVER_EMBLEM_INDICES,
  ACTIVE_COVER_EMBLEMS,
  ACTIVE_COVER_FRAME_INDICES,
  ACTIVE_COVER_FRAMES,
  normalizeCoverFrameIndex,
  normalizeCoverOverrides,
} from '../src/art/covers';
import {
  freshBookStyleOverrides,
  normalizeBookStyleOverrides,
  randomBookStyleOverrides,
  resolveBookStyle,
} from '../src/art/bookStyle';
import {
  ACTIVE_EDGE_TREATMENTS,
  ACTIVE_HEAD_TAIL_STYLES,
  ACTIVE_ORNAMENT_INDICES,
  ACTIVE_ORNAMENTS,
  ACTIVE_TITLE_PLATES,
  EDGE_TREATMENTS,
  MAX_RAISED_BANDS,
  ORNAMENT_COUNT,
  ORNAMENT_LABELS,
  TITLE_PLATES,
  edgeSpec,
  normalizeEdgeTreatment,
  normalizeHeadTailStyle,
  normalizeOrnamentIndex,
  normalizeTitlePlateStyle,
} from '../src/art/spines';

const APPROVED_ORNAMENTS = [
  0, 1, 2, 5, 12, 13, 14, 20,
  23, 26, 28, 29, 30, 31, 43, 56,
  66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
  76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
] as const;

const APPROVED_FRAMES = [
  0, 2, 5, 6, 8, 17, 20, 24, 26, 36, 43, 48,
] as const;

describe('book-surface apocalypse catalogue', () => {
  it('has one exact active emblem catalogue and retires moon/compass pictograms', () => {
    expect(ACTIVE_ORNAMENT_INDICES).toEqual(APPROVED_ORNAMENTS);
    expect(ACTIVE_ORNAMENTS.map(({ index }) => index)).toEqual(APPROVED_ORNAMENTS);
    expect(ACTIVE_COVER_EMBLEM_INDICES).toBe(ACTIVE_ORNAMENT_INDICES);
    expect(ACTIVE_COVER_EMBLEMS).toBe(ACTIVE_ORNAMENTS);
    expect(ORNAMENT_LABELS[43]).toBe('Five-leaf anthemion');
    expect(ORNAMENT_LABELS.slice(66)).toEqual([
      'Acanthus spear',
      'Carnation bloom',
      'Iris fan',
      'Artichoke finial',
      'Poppy seedhead',
      'Olive spray',
      'Strawberry sprig',
      'Vine cluster',
      'Honeysuckle scroll',
      'Lotus palmette',
      'Maple samara spray',
      'Willow catkin',
      'Rowan spray',
      'Columbine bell',
      'Primrose stem',
      'Dog-rose branch',
      'Cedar cone spray',
      'Reed bundle',
      'Moresque knot',
      'Tudor rose standard',
    ]);

    for (let index = 0; index < ORNAMENT_COUNT; index += 1) {
      const normalized = normalizeOrnamentIndex(index);
      expect(ACTIVE_ORNAMENT_INDICES, `ornament ${index} -> ${normalized}`).toContain(normalized);
    }
    expect(normalizeOrnamentIndex(-1)).toBe(-1);
    expect(normalizeOrnamentIndex(6)).toBe(12);
    expect(normalizeOrnamentIndex(19)).toBe(12);
    expect(normalizeOrnamentIndex(26)).toBe(26);
    expect(normalizeOrnamentIndex(17)).toBe(0);
    expect(normalizeOrnamentIndex(3)).toBe(12);
    expect(normalizeOrnamentIndex(27)).toBe(1);
    expect(normalizeOrnamentIndex(38)).toBe(13);
    expect(normalizeOrnamentIndex(57)).toBe(31);
    expect(ACTIVE_ORNAMENT_INDICES).not.toContain(48); // snowflake never re-enters by name
  });

  it('has one exact frame catalogue built without dots, studs, rings or ticks', () => {
    expect(ACTIVE_COVER_FRAME_INDICES).toEqual(APPROVED_FRAMES);
    expect(ACTIVE_COVER_FRAMES.map(({ index }) => index)).toEqual(APPROVED_FRAMES);

    const forbiddenCorner = new Set(['dot', 'stud', 'ring']);
    const forbiddenSide = new Set(['dot', 'tick', 'pair', 'arc']);
    for (const frame of ACTIVE_COVER_FRAMES) {
      expect(forbiddenCorner.has(frame.corner), `${frame.index}:${frame.label}:corner`).toBe(false);
      expect(forbiddenSide.has(frame.side), `${frame.index}:${frame.label}:side`).toBe(false);
      expect(frame.rules.length, `${frame.index}:${frame.label}:rules`).toBeGreaterThan(0);
      expect(frame.id, `${frame.index}:${frame.label}:id`).not.toMatch(/dot|stud|ring|tick/i);
      expect(frame.label, `${frame.index}:${frame.label}:label`).not.toMatch(/dot|stud|ring|tick/i);
    }

    for (let index = 0; index < 50; index += 1) {
      expect(ACTIVE_COVER_FRAME_INDICES).toContain(normalizeCoverFrameIndex(index));
    }
  });

  it('keeps only continuous cover-title treatments and unpatterned physical page edges', () => {
    const forbiddenTitles = /bead|rope|dot|scallop|ribbon|hatch|stipple|slip|tag|copper|enamel|crest|roundel|wreath|star/i;
    for (const title of ACTIVE_TITLE_PLATES) expect(title).not.toMatch(forbiddenTitles);
    for (const historical of TITLE_PLATES) {
      expect(ACTIVE_TITLE_PLATES).toContain(normalizeTitlePlateStyle(historical));
    }

    expect(ACTIVE_EDGE_TREATMENTS).toEqual([
      'plain', 'gilt', 'stained-red', 'sepia-edge', 'deckle', 'red-under-gold',
    ]);
    const forbiddenEdges = /marbl|speck|sprinkl|spatter|stipple|stripe|band|chequer|landscape|fox|thumb|mottl|tree-calf|agate|nonpareil|peacock/i;
    for (const treatment of ACTIVE_EDGE_TREATMENTS) {
      expect(treatment).not.toMatch(forbiddenEdges);
      const spec = edgeSpec(treatment);
      if (treatment === 'red-under-gold') {
        expect(spec.pattern).toBe('band');
        expect(spec.gild).toBe('all');
      } else {
        expect(spec.pattern, treatment).toBe('none');
        expect(spec.density, treatment).toBe(0);
      }
    }
    expect(edgeSpec('plain').ground).not.toBe(edgeSpec('gilt').ground);
    for (const historical of EDGE_TREATMENTS) {
      expect(ACTIVE_EDGE_TREATMENTS).toContain(normalizeEdgeTreatment(historical));
    }
  });

  it('retires every applied charm while leaving old ids readable', () => {
    expect(ACTIVE_CHARMS).toEqual(['none']);
    for (const historical of [
      'none',
      'ribbon',
      'tassel',
      'pressed-flower',
      'clasp',
      'wax-seal',
      'tag',
      'future-sticker',
    ]) {
      expect(normalizeCharmKind(historical), historical).toBe('none');
    }
  });
});

describe('book-surface hard normalization', () => {
  it('forces old independent surface fields into one safe focal composition', () => {
    expect(
      normalizeBookStyleOverrides({
        ornament: 1,
        coverMedallion: 50,
        coverFrame: 7,
        titlePlate: 'dotted-rule',
        edge: 'speckled',
        charm: 'tassel',
        raisedBands: 9,
        headTailStyle: 0,
        cornerProtectors: true,
        insetPlate: true,
      }),
    ).toMatchObject({
      // The explicit cover compatibility field wins, then hard-normalizes.
      ornament: 1,
      coverMedallion: 1,
      coverFrame: 26,
      titlePlate: 'ruled-box',
      edge: 'plain',
      charm: 'none',
      raisedBands: MAX_RAISED_BANDS,
      headTailStyle: 1,
      cornerProtectors: false,
      insetPlate: false,
    });

    expect(
      normalizeBookStyleOverrides({ ornament: 1, coverMedallion: 20 }),
    ).toMatchObject({ ornament: 20, coverMedallion: 20 });
    expect(normalizeHeadTailStyle(0)).toBe(1);
    expect(normalizeHeadTailStyle(1)).toBe(1);
    expect(normalizeHeadTailStyle(2)).toBe(2);
    expect(normalizeHeadTailStyle(3)).toBe(3);
    expect(normalizeHeadTailStyle(99)).toBe(1);
  });

  it('protects the legacy cover-only path from retired surface art', () => {
    expect(
      normalizeCoverOverrides({
        frame: 38,
        medallion: 48,
        titlePlate: 'stippled-ground',
        edge: 'verdigris-edge',
        charm: 'wax-seal',
        cornerProtectors: true,
        insetPlate: true,
      }),
    ).toMatchObject({
      frame: 36,
      medallion: 23,
      titlePlate: 'blind-panel',
      edge: 'plain',
      charm: 'none',
      cornerProtectors: false,
      insetPlate: false,
    });
  });

  it('makes every fresh and random draw use only active, matched surface fields', () => {
    for (let seed = 0; seed < 8_192; seed += 1) {
      for (const draw of [freshBookStyleOverrides(seed), randomBookStyleOverrides(seed)]) {
        expect(draw.raisedBands, `${seed}:bands`).toBeLessThanOrEqual(MAX_RAISED_BANDS);
        expect(ACTIVE_HEAD_TAIL_STYLES, `${seed}:endband`).toContain(draw.headTailStyle);
        expect(ACTIVE_TITLE_PLATES, `${seed}:title`).toContain(draw.titlePlate);
        expect(ACTIVE_EDGE_TREATMENTS, `${seed}:edge`).toContain(draw.edge);
        expect(ACTIVE_COVER_FRAME_INDICES, `${seed}:frame`).toContain(draw.coverFrame);
        expect(draw.coverMedallion, `${seed}:emblem-match`).toBe(draw.ornament);
        if ((draw.ornament ?? -1) >= 0) {
          expect(ACTIVE_ORNAMENT_INDICES, `${seed}:emblem`).toContain(draw.ornament);
        }
        expect(draw.charm, `${seed}:charm`).toBe('none');
        expect(draw.cornerProtectors, `${seed}:corners`).toBe(false);
        expect(draw.insetPlate, `${seed}:inset`).toBe(false);
      }
    }
  });

  it('suppresses focal stacking on a figured material even under hostile overrides', () => {
    const resolved = resolveBookStyle(
      0x9e3779b9,
      { charms: ['ribbon'], charmChance: 1 },
      {
        material: 'marbled',
        ornament: 20,
        coverMedallion: 20,
        coverFrame: 49,
        titlePlate: 'gothic-panel',
        charm: 'ribbon',
        cornerProtectors: true,
        insetPlate: true,
      },
    ).style;

    expect(resolved.ornament).toBe(-1);
    expect(resolved.coverMedallion).toBe(-1);
    expect([0, 2, 24, 28]).toContain(resolved.coverFrame);
    expect(['none', 'debossed', 'blind-lettered', 'gilt-direct', 'twin-rules']).toContain(
      resolved.titlePlate,
    );
    expect(resolved.charm).toBe('none');
    expect(resolved.cornerProtectors).toBe(false);
    expect(resolved.insetPlate).toBe(false);
  });
});
