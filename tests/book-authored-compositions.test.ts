import { describe, expect, it } from 'vitest';
import { BOOK_SURPRISE_PALETTES, surpriseBookRecipe } from '../src/art/bookSurprise';
import { resolveBookStyle, normalizeBookStyleOverrides } from '../src/art/bookStyle';

describe('artwork remaster preserves the established binding system', () => {
  it('uses the direction palettes without reviving the rejected sparse layout override', () => {
    for (const direction of Object.keys(BOOK_SURPRISE_PALETTES) as (keyof typeof BOOK_SURPRISE_PALETTES)[]) {
      for (let i = 0; i < 12; i++) {
        const recipe = surpriseBookRecipe(direction, 0x672ab + i * 7919);
        const selected = BOOK_SURPRISE_PALETTES[direction].find(e=>e.coverBaseHex===recipe.style.coverBaseHex);
        expect(selected, `${direction}/${recipe.preset}`).toBeDefined();
        expect(recipe.style.spineBaseHex).toBe(selected!.spineBaseHex);
        expect(recipe.style.composition).toBeNull();
        const saved = normalizeBookStyleOverrides(JSON.parse(JSON.stringify(recipe.style)));
        const resolved = resolveBookStyle(i, undefined, saved, {binding:recipe.preset});
        expect(resolved.cover.composition).toBe(recipe.style.composition);
        expect(resolved.spine.composition).toBe(recipe.style.composition);
        expect(resolved.spine.spineCharacter).toBeNull();
      }
    }
  });

  it('keeps locked spine construction on its manual renderer', () => {
    const recipe = surpriseBookRecipe({direction:'grand',seed:44,
      current:{binding:'gilt-quarto',style:{raisedBands:2,headTail:true,headTailStyle:1}},
      locks:['bands','endbands']});
    expect(recipe.style.spineCharacter).toBeNull();
    expect(recipe.style.raisedBands).toBe(2);
    expect(recipe.style.headTailStyle).toBe(1);
  });

  it('respects locked manual furniture rather than concealing it beneath a new layout', () => {
    const current = {binding:'gilt-quarto', style:resolveBookStyle(52, undefined, {
      coverFrame:24, titlePlate:'laid-paper-ticket', ornament:71,
    }, {binding:'gilt-quarto'}).style};
    const recipe = surpriseBookRecipe({direction:'grand',seed:51,current,
      locks:['cover.frame','title.plate','ornament']});
    expect(recipe.style.coverFrame).toBe(current.style.coverFrame);
    expect(recipe.style.titlePlate).toBe(current.style.titlePlate);
    expect(recipe.style.composition).toBeNull();
  });

  it('keeps a locked colour exact while improving automatic pigments', () => {
    const current = {binding:'gilt-quarto', style:resolveBookStyle(16, undefined,
      {coverBaseHex:'#674353'}, {binding:'gilt-quarto'}).style};
    const recipe = surpriseBookRecipe({direction:'botanical',seed:72,current,
      locks:['colour.cover-base']});
    expect(recipe.style.coverBaseHex).toBe('#674353');
    expect(recipe.style.composition).toBeNull();
  });
  it('retires a saved experimental layout without changing its explicit colours or furniture', () => {
    const resolved = resolveBookStyle(16, undefined, {
      composition:'quiet-title', spineCharacter:'quiet', coverBaseHex:'#674353',
      coverFrame:48, raisedBands:2,
    }, {binding:'gilt-quarto'});
    expect(resolved.style.composition).toBeNull();
    expect(resolved.spine.spineCharacter).toBeNull();
    expect(resolved.style.coverBaseHex).toBe('#674353');
    expect(resolved.style.coverFrame).toBe(48);
    expect(resolved.style.raisedBands).toBe(2);
  });
});
