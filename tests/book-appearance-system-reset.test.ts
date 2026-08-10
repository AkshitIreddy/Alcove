import { describe, expect, it } from 'vitest';
import { FORMAL_BOOK_PRESET_ID } from '../src/art/bookDesign';
import {
  normalizeStoredBookBindings,
  normalizeStoredBookCoverMeta,
} from '../src/data/seed';

describe('v14 book appearance system reset', () => {
  it('replaces retired bindings without changing any room design', () => {
    const room = {
      build: 'moon-arch',
      pattern: 'walnut-burl',
      wallpaper: {
        pattern: 'willow-bough',
        scale: 'small',
        depth: 'embossed',
        ink: 4,
        tone: 17,
        edge: 'deckled',
      },
    };
    const normalized = JSON.parse(
      normalizeStoredBookBindings(
        JSON.stringify({
          rooms: { 'case-a': room },
          books: {
            current: 'plain-cloth',
            retiredOwn: 'own:rounded/smooth-cloth/plain/gilt',
            unknown: 'future-experimental-binding',
            junk: 42,
          },
        }),
      ),
    ) as {
      rooms: Record<string, unknown>;
      books: Record<string, string>;
    };

    expect(normalized.rooms['case-a']).toEqual(room);
    expect(normalized.books.current).toBe('plain-cloth');
    expect(normalized.books.retiredOwn).toBe(FORMAL_BOOK_PRESET_ID);
    expect(normalized.books.unknown).toBe(FORMAL_BOOK_PRESET_ID);
    expect(normalized.books).not.toHaveProperty('junk');
  });

  it('normalizes only the style section of book cover metadata', () => {
    const shelf = { floor: 7, slot: 3, leaning: true };
    const pageDefaults = { paper: 'warm-cream', rules: 'college' };
    const normalizedRaw = normalizeStoredBookCoverMeta(
      JSON.stringify({
        style: { pigment: 4, hueJitter: 999, wear: -2, hardwareHex: '#b38242' },
        cover: {
          frame: 1,
          medallion: 44,
          titlePlate: 'stippled-ground',
          edge: 'speckled',
          charm: 'wax-seal',
          cornerProtectors: true,
          insetPlate: true,
        },
        shelf,
        pageDefaults,
      }),
    );
    const normalized = JSON.parse(normalizedRaw as string) as Record<string, unknown>;

    expect(normalized.shelf).toEqual(shelf);
    expect(normalized.pageDefaults).toEqual(pageDefaults);
    expect(normalized.style).toMatchObject({ pigment: 4, hueJitter: 12, wear: 0 });
    expect(normalized.style).not.toHaveProperty('hardwareHex');
    expect(normalized.cover).toMatchObject({
      charm: 'none',
      cornerProtectors: false,
      insetPlate: false,
    });
    expect(normalized.cover).not.toMatchObject({
      frame: 1,
      medallion: 44,
      titlePlate: 'stippled-ground',
      edge: 'speckled',
    });
  });

  it('leaves corrupt metadata untouched rather than risking unrelated data', () => {
    expect(normalizeStoredBookCoverMeta('{not json')).toBe('{not json');
    expect(normalizeStoredBookBindings('{not json')).toBe('{not json');
  });
});
