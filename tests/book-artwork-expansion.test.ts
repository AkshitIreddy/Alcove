import { expect, it } from 'vitest';
import { BOOK_SURPRISE_DIRECTIONS } from '../src/art/bookDesign';
import { surpriseBookRecipe } from '../src/art/bookSurprise';
import { resolveBookStyle } from '../src/art/bookStyle';
import { EXPANDED_BOOK_TITLES, EXPANDED_BOOK_EMBLEMS, EXPANDED_BOOK_FRAMES } from '../src/art/bookArtworkExpansion';
import { BOOK_EMBLEM_MASTERS } from '../src/art/bookEmblemArtwork';
import { REMASTERED_FRAME_MASTERS } from '../src/art/bookFrameArtwork';

it('preserves new artwork through saved-style resolution on both faces', () => {
  for (const direction of BOOK_SURPRISE_DIRECTIONS) {
    for (const ornament of EXPANDED_BOOK_EMBLEMS[direction.id]) {
      const resolved = resolveBookStyle(317, undefined, { ornament, coverMedallion:ornament }, {binding:'gilt-quarto'});
      expect(resolved.spine.ornament).toBe(ornament);
      expect(resolved.cover.medallion).toBe(ornament);
    }
    for (const frame of EXPANDED_BOOK_FRAMES[direction.id]) {
      expect(resolveBookStyle(317, undefined, {coverFrame:frame}, {binding:'gilt-quarto'}).cover.frame).toBe(frame);
    }
    for (const titlePlate of EXPANDED_BOOK_TITLES[direction.id]) {
      expect(resolveBookStyle(317, undefined, {titlePlate}, {binding:'gilt-quarto'}).cover.titlePlate).toBe(titlePlate);
    }
  }
});

it('ships distinct artwork paths rather than duplicate names for one drawing', () => {
  const emblems = Object.values(BOOK_EMBLEM_MASTERS).filter(m=>m.index>=86);
  const frames = REMASTERED_FRAME_MASTERS.filter(m=>m.index>=56);
  const paths = (svg:string) => [...svg.matchAll(/\sd="([^"]+)"/g)].map(m=>m[1]).join('|');
  expect(new Set(emblems.map(m=>paths(m.source))).size).toBe(32);
  expect(new Set(frames.map(m=>paths(m.svg))).size).toBe(24);
});

it('actually chooses expanded art in every Surprise direction', () => {
  const seen = new Set<string>();
  for (const [d,direction] of BOOK_SURPRISE_DIRECTIONS.entries()) {
    let expanded = 0;
    const silhouettes = new Set<string>();
    for (let i=0;i<32;i++) {
      const recipe = surpriseBookRecipe(direction.id,(0x61fa29 ^ Math.imul(i+1,7919) ^ Math.imul(d+1,104729))>>>0);
      const {ornament=-1,coverFrame=0,titlePlate='none'}=recipe.style;
      if (ornament>=86) {seen.add(`e${ornament}`);expanded++;}
      if (coverFrame>=56) {seen.add(`f${coverFrame}`);expanded++;}
      if (Object.values(EXPANDED_BOOK_TITLES).some(pool=>pool.includes(titlePlate))) {seen.add(titlePlate);expanded++;}
      silhouettes.add(`${recipe.preset}:${titlePlate}:${coverFrame}:${ornament}`);
    }
    expect(expanded,direction.id).toBeGreaterThan(0);
    expect(silhouettes.size,direction.id).toBeGreaterThanOrEqual(20);
  }
  expect(seen.size).toBeGreaterThanOrEqual(24);
  expect([...seen].filter(id=>/^e\d/.test(id)).length, 'new emblems actually drawn').toBeGreaterThanOrEqual(8);
  expect([...seen].filter(id=>/^f\d/.test(id)).length, 'new borders actually drawn').toBeGreaterThanOrEqual(8);
  expect([...seen].filter(id=>!/^\w\d/.test(id)).length, 'new title furniture actually drawn').toBeGreaterThanOrEqual(4);
},60000);
