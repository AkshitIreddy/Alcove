import { expect, it } from 'vitest';
import baseline from './fixtures/book-customisation-catalogue.json';
import * as spines from '../src/art/spines';
import * as covers from '../src/art/covers';
import * as bindings from '../src/art/bookDesign';

it('expands book art without removing, renaming or reordering existing choices', () => {
  const current = {
    titles: spines.ACTIVE_TITLE_PLATES.map(id => ({ id, label: spines.TITLE_PLATE_LABELS[id] })),
    frames: covers.ACTIVE_COVER_FRAMES,
    emblems: spines.ACTIVE_ORNAMENTS,
    lettering: covers.ACTIVE_COVER_HANDS,
    edges: spines.ACTIVE_EDGE_OPTIONS,
    endbands: spines.ACTIVE_HEAD_TAIL_OPTIONS,
    formats: spines.SPINE_FORMAT_IDS.map(id => ({ id, label: spines.SPINE_FORMATS[id].label })),
    materials: bindings.ROLLABLE_MATERIALS.map(id => ({ id, label: bindings.MATERIALS[id].name })),
    shapes: bindings.ROLLABLE_SHAPES,
    decorations: bindings.ROLLABLE_DECORATIONS,
    bindings: bindings.BOOK_PRESETS.map(p => ({ id: p.id, label: p.label, shape: p.shape, material: p.material, decorations: p.decorations })),
  };
  for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) {
    expect(current[key].slice(0, baseline[key].length), key).toEqual(baseline[key]);
  }
  expect(current.titles).toHaveLength(42);
  expect(current.frames).toHaveLength(42);
  expect(current.emblems).toHaveLength(61);
});
