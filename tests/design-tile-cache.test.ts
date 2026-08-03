// @vitest-environment node
/**
 * tests/design-tile-cache.test.ts — the tile cache has to hold a whole picker.
 *
 * `designArt`'s tile store is a FIFO with a fixed ceiling, and the ceiling was
 * chosen against vocabulary sizes that have since roughly tripled. When the
 * largest sheet is bigger than the cache, scrolling it evicts tiles that are
 * still on screen and redraws them on the way back — the worst case for a FIFO,
 * because every eviction is a guaranteed future miss.
 *
 * Nothing about that fails. It is slower, and only on the axis with the most
 * entries, which is the one a reader is most likely to browse. So the check is
 * arithmetic rather than a benchmark: whatever the vocabularies grow to, the
 * cache has to be able to hold the biggest of them at once.
 */
import { describe, expect, it } from 'vitest';

import { MAX_TILES } from '../src/views/rail/designArt';
import { BOOK_PRESETS } from '../src/art/bookDesign';
import { SHELF_PRESETS } from '../src/art/shelfDesign';
import { WALLPAPER_PRESETS } from '../src/art/wallpaperDesign';

describe('the design tile cache', () => {
  const biggest = Math.max(
    BOOK_PRESETS.length,
    SHELF_PRESETS.length,
    WALLPAPER_PRESETS.length,
  );

  it('can hold the largest picker without evicting from it', () => {
    expect(
      MAX_TILES,
      `largest vocabulary is ${biggest}; a sheet of that size would thrash a ${MAX_TILES}-tile FIFO`,
    ).toBeGreaterThanOrEqual(biggest);
  });

  /**
   * …with room for what is behind the sheet. Opening the "more…" picker does
   * not discard the strip that opened it, and a reader can have a second axis
   * open behind. A ceiling exactly equal to the biggest list would evict those
   * on the last row.
   */
  it('leaves headroom for the strips behind the sheet', () => {
    expect(MAX_TILES).toBeGreaterThanOrEqual(biggest + 24);
  });

  /**
   * And it is still bounded. The point of a FIFO here is that an unbounded memo
   * over vocabularies this size is hundreds of megabytes of art nobody is
   * looking at — ~270kB per tile at dpr 2.
   */
  it('stays bounded', () => {
    expect(MAX_TILES).toBeLessThanOrEqual(400);
  });
});
